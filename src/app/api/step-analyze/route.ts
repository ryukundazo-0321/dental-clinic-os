import { NextRequest, NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export async function POST(request: NextRequest) {
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ success: false, error: "OPENAI_API_KEY not set" }, { status: 500 });
    }

    const body = await request.json();
    const { step, transcript, existing_soap, tooth_chart, perio_summary, context } = body;

    if (!step) {
      return NextResponse.json({ success: false, error: "step is required" }, { status: 400 });
    }

    let systemPrompt = "";
    let userPrompt = "";

    switch (step) {
      case "dh_record": {
        systemPrompt = `あなたは歯科衛生士（DH）のカルテ記録を支援するAIです。
DHが患者にフィードバックした音声の文字起こしから、SOAP形式のO欄（客観的所見）を生成してください。

出力はJSON形式で:
{
  "soap_o": "O欄の内容"
}

O欄に含めるべき内容:
- 実施した処置（スケーリング、SRP、PMTC等）
- 口腔内の状態（プラーク付着状況、歯肉の状態等）
- ブラッシング指導の内容
- 所見（歯石、着色、歯肉出血等）

簡潔かつ専門的に記述してください。`;

        userPrompt = `DHの音声記録: ${transcript || "(なし)"}
S欄（主訴）: ${existing_soap?.s || "(なし)"}
歯式: ${tooth_chart ? JSON.stringify(tooth_chart) : "(なし)"}
P検サマリ: ${perio_summary ? JSON.stringify(perio_summary) : "(なし)"}`;
        break;
      }

      case "dr_exam": {
        systemPrompt = `あなたは歯科医師（Dr）のカルテ記録を支援するAIです。
Drが患者に説明した音声の文字起こしから、SOAP形式のA欄（評価）とP欄（計画）を生成してください。

出力はJSON形式で:
{
  "soap_a": "A欄（評価・診断名）",
  "soap_p": "P欄（治療計画・次回予定）"
}

A欄に含めるべき内容:
- 診断名（う蝕症、歯周炎、根尖性歯周炎等）
- 病態の評価

P欄に含めるべき内容:
- 本日実施した処置
- 次回の治療予定
- 患者への指示事項
- メンテナンス計画

簡潔かつ専門的に記述してください。`;

        userPrompt = `Drの音声記録: ${transcript || "(なし)"}
S欄: ${existing_soap?.s || "(なし)"}
O欄: ${existing_soap?.o || "(なし)"}
歯式: ${tooth_chart ? JSON.stringify(tooth_chart) : "(なし)"}
P検サマリ: ${perio_summary ? JSON.stringify(perio_summary) : "(なし)"}`;
        break;
      }

      case "treatment_plan": {
        const ctx = context || {};
        systemPrompt = `あなたは歯科の治療計画を立案するAIです。
SOAP記録、歯式、P検データから包括的な治療計画書を作成してください。

出力はJSON形式で:
{
  "summary": "治療計画の概要（1-2文）",
  "diagnosis_summary": "診断まとめ",
  "procedures": [
    {
      "name": "処置名",
      "tooth": "対象歯（例: #16）",
      "priority": 1,
      "estimated_visits": 1,
      "description": "処置の説明"
    }
  ],
  "estimated_total_visits": 5,
  "estimated_duration_months": 3,
  "goals": "治療目標",
  "patient_instructions": "患者さんへの説明（平易な日本語）"
}

priorityは1=高（緊急）、2=中、3=低。
処置は優先度順に並べてください。`;

        userPrompt = `SOAP:
S: ${ctx.soap?.s || "(なし)"}
O: ${ctx.soap?.o || "(なし)"}
A: ${ctx.soap?.a || "(なし)"}
P: ${ctx.soap?.p || "(なし)"}

歯式: ${ctx.tooth_chart ? JSON.stringify(ctx.tooth_chart) : "(なし)"}
P検: ${ctx.perio_summary ? JSON.stringify(ctx.perio_summary) : "(なし)"}
患者: ${ctx.patient ? JSON.stringify(ctx.patient) : "(なし)"}`;
        break;
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown step: ${step}` }, { status: 400 });
    }

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI error:", errText);
      return NextResponse.json({ success: false, error: "OpenAI API error" }, { status: 500 });
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "{}";

    let result;
    try {
      result = JSON.parse(content);
    } catch {
      result = { soap_o: content };
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    console.error("step-analyze error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
