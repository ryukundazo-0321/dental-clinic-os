import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image_base64, image_url, patient_id } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "APIキー未設定" },
        { status: 500 }
      );
    }

    const imageContent = image_base64
      ? {
          type: "image_url" as const,
          image_url: {
            url: `data:image/jpeg;base64,${image_base64}`,
            detail: "high" as const,
          },
        }
      : {
          type: "image_url" as const,
          image_url: {
            url: image_url,
            detail: "high" as const,
          },
        };

    const systemPrompt = `あなたは歯科放射線専門のAIアシスタントです。
パノラマX線画像（またはデンタルX線画像）を分析し、各歯の状態を判定してください。

FDI歯番号（11-18, 21-28, 31-38, 41-48）を使用して、以下の状態を判定：
- normal: 健全歯
- caries: う蝕（虫歯）
- treated: 処置歯（充填あり）
- crown: 冠（クラウン/被せ物）
- missing: 欠損（歯がない）
- implant: インプラント
- bridge: ブリッジ
- root_remain: 残根
- in_treatment: 治療中（根管治療中など）
- watch: 要注意（軽度の異常）

出力はJSON形式で:
{
  "tooth_findings": [
    {
      "tooth": "16",
      "status": "caries",
      "confidence": 0.85,
      "detail": "遠心面にう蝕陰影あり、象牙質に達する"
    }
  ],
  "summary": "全体所見の要約",
  "missing_teeth": ["18", "28", "38", "48"],
  "notable_findings": ["重要な所見1", "所見2"],
  "tooth_chart": {
    "16": "caries",
    "18": "missing"
  }
}

注意:
- 画像が不鮮明な場合はconfidenceを低くしてください
- 健全な歯は省略してtooth_findingsに含めなくてOK
- tooth_chartには健全(normal)以外の歯のみ含めてください`;

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
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "このパノラマX線画像を分析し、各歯の状態をJSON形式で報告してください。",
                },
                imageContent,
              ],
            },
          ],
          temperature: 0.2,
          max_tokens: 4000,
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        {
          success: false,
          error: `Vision API Error: ${res.status} ${errText}`,
        },
        { status: 500 }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(content);

    return NextResponse.json({
      success: true,
      analysis: result,
      tooth_chart: result.tooth_chart || {},
      findings: result.tooth_findings || [],
      summary: result.summary || "",
    });
  } catch (e) {
    console.error("xray-analyze error:", e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
