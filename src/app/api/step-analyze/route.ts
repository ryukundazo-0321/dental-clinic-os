import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      step,
      transcript,
      existing_soap,
      tooth_chart,
      perio_summary,
      context,
    } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "APIキー未設定" },
        { status: 500 }
      );
    }

    let systemPrompt = "";
    let userPrompt = "";

    switch (step) {
      case "chief":
        systemPrompt = `あなたは歯科クリニックの音声分析AIです。
患者の主訴に関する会話の文字起こしから、SOAPのS（主観）を抽出してください。
既存の問診票の内容がある場合、それと比較して差分を明確にしてください。

出力はJSON形式で:
{
  "analyzed_s": "分析から抽出した主訴",
  "original_s": "問診票の内容（あれば）",
  "differences": ["差分1", "差分2"],
  "merged_s": "統合した最終的なS欄テキスト",
  "confidence": 0.95
}`;
        userPrompt = `文字起こし:\n${transcript}\n\n問診票のS:\n${existing_soap?.s || "なし"}`;
        break;

      case "dh_record":
        systemPrompt = `あなたは歯科衛生士の記録分析AIです。
DHが患者にフィードバックしている内容の文字起こしから、SOAPのO（客観的所見）を生成してください。
歯式やP検の情報がある場合はそれも参考にしてください。

出力はJSON形式で:
{
  "soap_o": "客観的所見テキスト",
  "procedures_done": ["実施した処置1", "処置2"],
  "findings": ["所見1", "所見2"],
  "recommendations": ["推奨事項1"]
}`;
        userPrompt = `文字起こし:\n${transcript}`;
        if (tooth_chart) {
          userPrompt += `\n\n歯式状態:\n${JSON.stringify(tooth_chart)}`;
        }
        if (perio_summary) {
          userPrompt += `\n\nP検サマリ:\n${JSON.stringify(perio_summary)}`;
        }
        break;

      case "dr_exam":
        systemPrompt = `あなたは歯科医師の診察記録分析AIです。
医師が患者に説明している内容の文字起こしから、SOAPのA（評価）とP（計画）を生成してください。
既存のS（主訴）とO（所見）がある場合はそれも参考にしてください。

出力はJSON形式で:
{
  "soap_a": "評価・診断テキスト",
  "soap_p": "計画・次回予定テキスト",
  "diagnoses": [{"name": "診断名", "tooth": "#16", "code": "K02"}],
  "next_visit_plan": "次回の予定内容",
  "tooth_updates": {"16": "treated", "17": "in_treatment"}
}`;
        userPrompt = `文字起こし:\n${transcript}`;
        if (existing_soap) {
          userPrompt += `\n\n既存SOAP:\nS: ${existing_soap.s || ""}\nO: ${existing_soap.o || ""}`;
        }
        if (tooth_chart) {
          userPrompt += `\n\n歯式:\n${JSON.stringify(tooth_chart)}`;
        }
        break;

      case "treatment_plan":
        systemPrompt = `あなたは歯科治療計画作成AIです。
本日の診察結果（SOAP全体、歯式、P検）から治療計画書を生成してください。

出力はJSON形式で:
{
  "summary": "治療計画の概要",
  "diagnosis_summary": "診断のまとめ",
  "procedures": [
    {
      "name": "処置名",
      "tooth": "#16",
      "priority": 1,
      "estimated_visits": 2,
      "description": "説明"
    }
  ],
  "estimated_total_visits": 5,
  "estimated_duration_months": 3,
  "goals": "治療目標",
  "patient_instructions": "患者さんへの説明",
  "notes": "備考"
}`;
        userPrompt = `本日の診察結果:\n${JSON.stringify(context)}`;
        break;

      default:
        return NextResponse.json(
          { success: false, error: "不正なstep" },
          { status: 400 }
        );
    }

    const res = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
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
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        { success: false, error: `OpenAI Error: ${res.status} ${errText}` },
        { status: 500 }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(content);

    return NextResponse.json({
      success: true,
      step,
      result,
    });
  } catch (e) {
    console.error("step-analyze error:", e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
