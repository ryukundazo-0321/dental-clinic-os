import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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

    const { data: diagnosisMaster } = await supabase
      .from("diagnosis_master")
      .select("code, name, category")
      .order("category", { ascending: true });

    const diagnosisList = (diagnosisMaster || [])
      .map((d: { code: string; name: string; category: string }) => `${d.code}:${d.name}(${d.category})`)
      .join("\n");

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
diagnosis_masterの中から最も適切なコードと名称を選択します。

### 3. 処置の特定
「今日は〇〇します」「〇〇していきましょう」などの処置予定を抽出します。

## 出力形式（JSONのみ・余分な説明不要）
{
  "detected_diagnoses": [
    {
      "tooth": "FDI歯番（例: 46）。全顎・複数歯は空文字",
      "code": "diagnosis_masterのコード",
      "name": "diagnosis_masterの傷病名",
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

## 傷病名マスタ（必ずここから選択）
${diagnosisList.slice(0, 3000)}`;

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
      const updates: Record<string, string> = {};
      if (parsed.soap_o) updates["soap_o"] = parsed.soap_o;
      if (parsed.soap_p) updates["soap_p"] = parsed.soap_p;
      if (Object.keys(updates).length > 0) {
        await supabase.from("medical_records").update(updates).eq("id", medical_record_id);
      }
    }

    return NextResponse.json({
      success: true,
      classified: parsed,
      detected_diagnoses: parsed.detected_diagnoses || [],
      detected_procedures: parsed.detected_procedures || [],
    });
  } catch (error) {
    console.error("classify-and-draft error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
