import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const CATEGORIES = [
  "C",        // う蝕（虫歯）
  "Pul",      // 歯髄炎・歯髄壊死（神経の炎症）
  "Per",      // 根尖性歯周炎・根管疾患（根っこの炎症）
  "P・G",     // 歯周病・歯肉炎（歯茎の病気）
  "脱離",     // 補綴物の脱離・不適合
  "破損",     // 補綴物の破損・過高・低位
  "MT",       // 欠損歯
  "外傷",     // 外傷性疾患・歯冠破折
  "炎症",     // 骨髄炎・蜂窩織炎
  "口内炎",   // 口腔粘膜疾患
  "外科処置", // 嚢胞・抜歯後・唾液腺・顎関節
  "咬合異常", // 不正咬合・矯正
  "その他",   // 上記以外
] as const;

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  try {
    const { transcript, medical_record_id, field_key, patient_id } = await req.json();

    if (!transcript) {
      return NextResponse.json({ error: "transcript is required" }, { status: 400 });
    }

    // ========================================================
    // 【1段階目】音声テキストから関連カテゴリを判定する
    // 軽い呼び出しでカテゴリだけを特定する
    // ========================================================
    const categoryPrompt = `あなたは歯科専門のAIです。
以下のドクターの発言を読んで、関連する傷病名カテゴリを選んでください。

## 選択肢（複数選択可）
${CATEGORIES.join(" / ")}

## カテゴリの意味
- C: 虫歯・う蝕
- Pul: 神経の炎症・歯髄炎（「神経まで来てる」「神経を取る」等）
- Per: 根っこの炎症・根尖性歯周炎（「根の先まで」「根管治療」等）
- P・G: 歯周病・歯肉炎（「歯茎が腫れてる」「歯周病」等）
- 脱離: 詰め物・被せ物が取れた
- 破損: 詰め物・被せ物が割れた・高い・低い
- MT: 歯が無い・欠損
- 外傷: 歯が折れた・ぶつけた
- 炎症: 顎が腫れてる・膿が出てる
- 口内炎: 口内炎・口腔粘膜
- 外科処置: 親知らず・嚢胞・顎関節・抜歯後
- 咬合異常: 噛み合わせ・矯正
- その他: 上記に当てはまらない

## 出力形式（JSONのみ）
{"categories": ["C", "Pul"]}

## ドクターの発言
${transcript}`;

    const stage1Res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini", // 軽いモデルで十分
        messages: [{ role: "user", content: categoryPrompt }],
        temperature: 0,
        response_format: { type: "json_object" },
      }),
    });

    // カテゴリ判定が失敗した場合はデフォルトで歯科主要カテゴリを使用
    let selectedCategories: string[] = ["C", "Pul", "Per", "P・G"];
    if (stage1Res.ok) {
      try {
        const stage1Data = await stage1Res.json();
        const stage1Content = JSON.parse(stage1Data.choices[0]?.message?.content || "{}");
        const detected = stage1Content.categories || [];
        // 有効なカテゴリのみ受け付ける
        const valid = detected.filter((c: string) => CATEGORIES.includes(c as typeof CATEGORIES[number]));
        if (valid.length > 0) selectedCategories = valid;
      } catch {
        // パース失敗時はデフォルトを使用
      }
    }

    // ========================================================
    // 【DBから絞り込み取得】
    // 選択されたカテゴリの傷病名だけ取得する
    // ========================================================
    const { data: diagnosisMaster } = await supabase
      .from("m_diagnoses")
      .select("diagnosis_code, diagnosis_name, category")
      .in("category", selectedCategories)
      .eq("is_active", true)
      .order("category", { ascending: true });

    const diagnosisList = (diagnosisMaster || [])
      .map((d: { diagnosis_code: string; diagnosis_name: string; category: string }) =>
        `${d.diagnosis_code}:${d.diagnosis_name}(${d.category})`
      )
      .join("\n");

    // ========================================================
    // 【2段階目】絞り込んだ傷病名から正確なコードを選ぶ
    // ========================================================
    const systemPrompt = `あなたは歯科専門のカルテ記録AIです。
豊富な歯科臨床知識を持ち、日本の歯科用番号体系（FDI方式）を完全に理解しています。

## 入力の性質
これは「ドクターが患者に向けて診察内容をわかりやすく説明している発言」の文字起こしです。
患者向けの平易な言葉（「虫歯」「神経を取る」「右下の奥歯」等）で話されています。

## あなたのタスク
歯科医師として以下を推論・抽出してください：

### 1. 歯番の特定
日本語の口語表現から、FDI方式の歯番（11〜18, 21〜28, 31〜38, 41〜48）に変換します。
- 上顎右側=1X、上顎左側=2X、下顎左側=3X、下顎右側=4X
- 「一番奥」=8番、「奥から2番目」=7番、「奥歯」=6〜8番、「前歯」=1〜3番
- 「右」「左」「上」「下」の組み合わせで象限を特定
- 複数の歯への言及はそれぞれ個別に抽出

### 2. 傷病名の特定
患者向けの平易な表現を臨床診断名に変換します。
歯科医師が患者に話す言葉と実際の病名の対応を、臨床知識に基づき推論してください。
下記の傷病名マスタの中から最も適切なコードと名称を選択します。

### 3. 処置の特定
「今日は〇〇します」「〇〇していきましょう」などの処置予定を抽出します。

## 出力形式（JSONのみ・余分な説明不要）
{
  "detected_diagnoses": [
    {
      "tooth": "FDI歯番（例: 46）。全顎・複数歯は空文字",
      "code": "傷病名コード（diagnosis_code）",
      "name": "傷病名（diagnosis_name）",
      "confidence": 明言なら1.0・推論なら0.85,
      "reason": "発言中の根拠となった表現をそのまま引用"
    }
  ],
  "detected_procedures": [
    {
      "tooth": "FDI歯番",
      "procedure": "処置名（臨床用語で）"
    }
  ],
  "soap_o": "ドクターの客観的所見（SOAP-O）",
  "soap_p": "治療計画（SOAP-P）"
}

## 傷病名マスタ（必ずここから選択・${diagnosisMaster?.length || 0}件）
${diagnosisList}`;

    const userPrompt = `以下のドクターの発言を解析してください：\n\n${transcript}`;

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.text();
      console.error("OpenAI error:", err);
      return NextResponse.json({ error: "OpenAI API error" }, { status: 500 });
    }

    const openaiData = await openaiRes.json();
    const rawContent = openaiData.choices[0]?.message?.content || "{}";

    let parsed: {
      detected_diagnoses?: Array<{
        tooth: string;
        code: string;
        name: string;
        confidence: number;
        reason: string;
      }>;
      detected_procedures?: Array<{
        tooth: string;
        procedure: string;
      }>;
      soap_o?: string;
      soap_p?: string;
    };
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = { detected_diagnoses: [] };
    }

    if (parsed.detected_diagnoses) {
      parsed.detected_diagnoses.sort((a, b) => b.confidence - a.confidence);
    }

    // SOAP自動保存
    if (medical_record_id) {
      try {
        const updates: Record<string, string> = {};
        if (parsed.soap_o) updates["soap_o"] = parsed.soap_o;
        if (parsed.soap_p) updates["soap_p"] = parsed.soap_p;
        if (Object.keys(updates).length > 0) {
          await supabase.from("medical_records").update(updates).eq("id", medical_record_id);
        }
      } catch (e) {
        console.error("SOAP保存エラー:", e);
      }
    }

    return NextResponse.json({
      success: true,
      classified: parsed,
      detected_diagnoses: parsed.detected_diagnoses || [],
      detected_procedures: parsed.detected_procedures || [],
      debug: {
        selected_categories: selectedCategories,
        diagnosis_count: diagnosisMaster?.length || 0,
      },
    });

  } catch (error) {
    console.error("classify-and-draft error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
