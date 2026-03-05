import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const { transcript, medical_record_id, field_key, patient_id } = await req.json();

    if (!transcript) {
      return NextResponse.json({ error: "transcript is required" }, { status: 400 });
    }

    // 傷病名マスタを取得（音声からの傷病名検出に使用）
    const { data: diagnosisMaster } = await supabase
      .from("diagnosis_master")
      .select("code, name, category")
      .order("category", { ascending: true });

    const diagnosisList = (diagnosisMaster || [])
      .map((d: { code: string; name: string; category: string }) => `${d.code}:${d.name}(${d.category})`)
      .join("\n");

    const systemPrompt = `あなたは歯科クリニックの音声記録を解析するAIです。
スタッフの発言を解析し、以下のJSON形式で出力してください。

## 出力形式（必ずこのJSON形式のみ出力）
{
  "s": "患者の主訴・症状（SOAPのS）",
  "tooth": "歯式・歯の状態に関する所見",
  "perio": "歯周組織の所見（ポケット深さ等）",
  "dh": "歯科衛生士の処置記録",
  "dr": "ドクターの処置・診断記録",
  "detected_diagnoses": [
    {
      "tooth": "歯番（例: 46、16、全顎等）",
      "code": "傷病名コード（diagnosis_masterより）",
      "name": "傷病名（diagnosis_masterより）",
      "confidence": 0.0〜1.0の信頼度,
      "reason": "検出理由（音声中の根拠となった発言）"
    }
  ]
}

## 傷病名検出ルール
- 音声から歯番と症状を組み合わせて傷病名を推定する
- 「虫歯」「むし歯」「カリエス」→ C1/C2/C3/C4のいずれか（深さの言及で判断）
- 「歯髄炎」「神経が死んでいる」「神経を取る」→ Pul（慢性/急性）
- 「根尖病巣」「膿が出ている」「根っこの炎症」→ Per/Perico
- 「歯周病」「ポケットが深い」「グラグラ」→ P1/P2/P3
- 「歯肉炎」「歯ぐきが腫れている」→ G
- 「抜歯」「抜く」→ 根拠となる病名を推定（C4/Per等）
- 「詰め物が取れた」「クラウンが外れた」→ 脱離
- 信頼度0.7未満の場合でも出力（フロントでフィルタリング）
- 歯番が不明な場合は tooth を "" にする
- detected_diagnosesは最大5件まで

## 傷病名マスタ（参照用）
${diagnosisList.slice(0, 3000)}
...（他多数）

## 注意事項
- 余分な説明文は不要、JSONのみ出力
- 傷病名が検出できない場合はdetected_diagnosesを空配列にする
- 歯番は「右上6番」→「16」、「左下4番」→「34」のように歯科用番号に変換`;

    const userPrompt = `以下の音声テキストを解析してください：

${transcript}`;

    // OpenAI APIを呼び出し
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
        temperature: 0.3,
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
      s?: string;
      tooth?: string;
      perio?: string;
      dh?: string;
      dr?: string;
      detected_diagnoses?: Array<{
        tooth: string;
        code: string;
        name: string;
        confidence: number;
        reason: string;
      }>;
    };
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      parsed = { s: rawContent, detected_diagnoses: [] };
    }

    // detected_diagnosesを信頼度でソート
    if (parsed.detected_diagnoses) {
      parsed.detected_diagnoses.sort((a, b) => b.confidence - a.confidence);
    }

    // medical_record_idがある場合はドラフト保存
    if (medical_record_id && field_key) {
      const fieldsToSave = ["s", "tooth", "perio", "dh", "dr"];
      for (const key of fieldsToSave) {
        const value = parsed[key as keyof typeof parsed];
        if (value && typeof value === "string" && value.trim()) {
          await supabase.from("karte_ai_drafts").upsert(
            {
              medical_record_id,
              field_key: key,
              content: value,
              status: "draft",
              source: "voice",
            },
            { onConflict: "medical_record_id,field_key" }
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      classified: parsed,
      detected_diagnoses: parsed.detected_diagnoses || [],
    });
  } catch (error) {
    console.error("classify-and-draft error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
