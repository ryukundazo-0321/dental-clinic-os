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

    const systemPrompt = `あなたは歯科放射線の専門医AIです。パノラマX線画像またはデンタルX線画像を詳細に分析し、全ての歯の状態を報告してください。

【重要な分析指針】
1. 画像に写っている全ての歯を必ずスキャンし、異常があれば全て報告すること
2. 見落としを防ぐため、左上→右上→右下→左下の順に系統的に確認すること
3. 健全歯以外は全てtooth_findingsに含めること（補綴・欠損・う蝕・治療中など）
4. 信頼度が低い場合でも所見として報告し、confidenceを0.5〜0.6に設定すること

【FDI歯番号】
上顎右: 18,17,16,15,14,13,12,11
上顎左: 21,22,23,24,25,26,27,28
下顎左: 31,32,33,34,35,36,37,38
下顎右: 41,42,43,44,45,46,47,48

【判定ステータス一覧】
- caries: う蝕（黒い陰影、歯質の欠損、不透過像の消失）
- treated: 処置歯（充填あり、CR・インレー・金属補綴）
- crown: 金属冠・セラミック冠（歯全体を覆う補綴物）
- bridge: ブリッジ（複数歯にまたがる補綴物）
- missing: 欠損（歯がない、抜歯後）
- implant: インプラント（金属ポスト状の構造物）
- root_remain: 残根（歯冠部がなく根のみ残存）
- in_treatment: 治療中（根管治療中、仮封あり）
- watch: 要観察（軽度の陰影、初期う蝕疑い）
- rct: 根管治療済み（根管内に不透過性充填材あり）

【詳細(detail)の書き方】
- 具体的な所見を日本語で記載
- 例: "近心面に象牙質に達するう蝕陰影あり"
- 例: "金属冠が確認できる、辺縁部に二次う蝕の疑いあり"
- 例: "根管充填済み、根尖部に透過像なし"
- 例: "歯槽骨の水平的吸収あり"

【出力JSON形式】
{
  "tooth_findings": [
    {
      "tooth": "16",
      "status": "crown",
      "confidence": 0.9,
      "detail": "金属冠が確認できる"
    }
  ],
  "summary": "全体所見の要約（200字程度）",
  "missing_teeth": ["18", "28", "38", "48"],
  "notable_findings": ["特に重要な所見を箇条書き"],
  "tooth_chart": {
    "16": "crown",
    "18": "missing"
  },
  "bone_level": "正常 or 軽度吸収 or 中等度吸収 or 高度吸収",
  "overall_risk": "低 or 中 or 高"
}

【注意事項】
- healthy(正常)の歯はtooth_findingsに含めない
- tooth_chartにも健全歯は含めない
- 画像が不鮮明な箇所はconfidenceを低く設定（0.5〜0.6）
- 補綴物（金属冠・クラウン）は必ず全て報告すること
- 欠損歯（歯がない部位）は必ず全て報告すること
- 親知らず(18,28,38,48)も必ず確認すること`;

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
                  text: `このX線画像を詳細に分析してください。
全ての歯を系統的にスキャンし、補綴物・欠損・う蝕・治療痕など健全歯以外の所見を全て報告してください。
見落としがないよう、上顎右→上顎左→下顎左→下顎右の順に確認してください。
JSON形式のみで回答してください。`,
                },
                imageContent,
              ],
            },
          ],
          temperature: 0.1,
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

    // AI出力のステータスをフロントエンドのTOOTH_STATUSキーにマッピング
    const statusMap: Record<string, string> = {
      caries: "caries", cavity: "caries", decay: "caries",
      treated: "crown", filled: "crown", filling: "crown", restoration: "crown",
      crown: "crown", cap: "crown",
      bridge: "bridge",
      missing: "missing", absent: "missing",
      implant: "implant",
      root_remain: "rct", residual_root: "rct",
      in_treatment: "rct",
      watch: "caries",
      rct: "rct",
      c0: "healthy", c1: "caries", c2: "caries", c3: "caries", c4: "caries",
      cr: "crown", inlay: "crown",
    };

    const rawChart = result.tooth_chart || {};
    const mappedChart: Record<string, string> = {};
    for (const [tooth, status] of Object.entries(rawChart)) {
      const s = String(status).toLowerCase().trim();
      mappedChart[tooth] = statusMap[s] || s;
    }

    // tooth_findingsにmissing_teethを追加（欠損歯が漏れないように）
    const toothFindings = result.tooth_findings || [];
    const existingTeeth = new Set(toothFindings.map((f: { tooth: string }) => f.tooth));
    for (const missingTooth of (result.missing_teeth || [])) {
      if (!existingTeeth.has(String(missingTooth))) {
        toothFindings.push({
          tooth: String(missingTooth),
          status: "missing",
          confidence: 0.95,
          detail: "欠損（歯がない）",
        });
      }
    }

    return NextResponse.json({
      success: true,
      analysis: result,
      tooth_chart: mappedChart,
      findings: toothFindings,
      summary: result.summary || "",
      bone_level: result.bone_level || "",
      overall_risk: result.overall_risk || "",
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
