import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image_base64, image_url, patient_id, media_type } = body;
    const resolvedMediaType = media_type || "image/jpeg";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "APIキー未設定" }, { status: 500 });
    }

    const imageContent = image_base64
      ? { type: "image_url" as const, image_url: { url: `data:${resolvedMediaType};base64,${image_base64}`, detail: "high" as const } }
      : { type: "image_url" as const, image_url: { url: image_url, detail: "high" as const } };

    const systemPrompt = `あなたは歯科診断AIアシスタントです。
送られてくる画像は以下のいずれかです：
- デジタルX線画像（パノラマ・デンタル）
- モニターに表示されたX線をカメラで撮影した写真
- 口腔内カラー写真
- スクリーンショット

【重要】画像の種類に関わらず、歯科的所見を可能な限り読み取ってください。
X線でなくても、口腔内写真・モニター撮影写真から読み取れる情報を報告してください。
画像が不鮮明・斜め・グレアがあっても、読み取れる範囲で所見を報告してください。

【FDI歯番号】
上顎右: 18,17,16,15,14,13,12,11
上顎左: 21,22,23,24,25,26,27,28
下顎左: 31,32,33,34,35,36,37,38
下顎右: 41,42,43,44,45,46,47,48

【判定ステータス一覧】
- caries: う蝕・虫歯（変色・欠損・陰影）
- treated: 処置歯（充填・CR・インレー・金属）
- crown: クラウン・金属冠・被せ物
- bridge: ブリッジ
- missing: 欠損（歯がない）
- implant: インプラント
- root_remain: 残根
- in_treatment: 治療中・仮封
- watch: 要観察（軽度変色・初期う蝕疑い）
- rct: 根管治療済み

【分析手順】
1. 画像の種類を判断（X線 / 口腔内写真 / モニター撮影 / その他）
2. 上顎右→上顎左→下顎左→下顎右の順に全歯をスキャン
3. 健全歯以外の所見を全て報告
4. モニター撮影・不鮮明な場合はconfidenceを低め（0.5〜0.7）に設定
5. 読み取れる所見が少ない場合でも、見えている補綴物・欠損は必ず報告

【出力JSON形式（必須）】
{
  "image_type": "panorama_xray / dental_xray / monitor_photo / intraoral_photo / screenshot / unknown",
  "tooth_findings": [
    {
      "tooth": "46",
      "status": "crown",
      "confidence": 0.85,
      "detail": "金属冠が確認できる"
    }
  ],
  "summary": "全体所見の要約（100〜200字）",
  "missing_teeth": ["18", "28"],
  "notable_findings": ["特に重要な所見"],
  "tooth_chart": { "46": "crown", "18": "missing" },
  "bone_level": "正常 or 軽度吸収 or 中等度吸収 or 高度吸収 or 不明",
  "overall_risk": "低 or 中 or 高 or 不明"
}

健全歯・正常歯はtooth_findingsとtooth_chartに含めないこと。
所見が全くない場合はtooth_findingsを空配列にし、summaryに「明確な所見は確認できませんでした」と記載すること。`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `この画像を歯科的に分析してください。
X線画像・口腔内写真・モニター撮影写真・スクリーンショットのいずれでも構いません。
見える範囲で歯の状態を読み取り、補綴物・欠損・う蝕・治療痕などを全て報告してください。
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
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ success: false, error: `Vision API Error: ${res.status} ${errText}` }, { status: 500 });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(content);

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

    const toothFindings = result.tooth_findings || [];
    const existingTeeth = new Set(toothFindings.map((f: { tooth: string }) => f.tooth));
    for (const missingTooth of (result.missing_teeth || [])) {
      if (!existingTeeth.has(String(missingTooth))) {
        toothFindings.push({ tooth: String(missingTooth), status: "missing", confidence: 0.95, detail: "欠損（歯がない）" });
      }
    }

    return NextResponse.json({
      success: true,
      analysis: result,
      image_type: result.image_type || "unknown",
      tooth_chart: mappedChart,
      findings: toothFindings,
      summary: result.summary || "",
      bone_level: result.bone_level || "",
      overall_risk: result.overall_risk || "",
    });
  } catch (e) {
    console.error("xray-analyze error:", e);
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
