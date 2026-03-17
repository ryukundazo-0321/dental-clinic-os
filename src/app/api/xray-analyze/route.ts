import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image_base64, image_url, media_type, image_hint } = body;
    const resolvedMediaType = media_type || "image/jpeg";

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "APIキー未設定" }, { status: 500 });
    }

    const imageContent = image_base64
      ? { type: "image_url" as const, image_url: { url: `data:${resolvedMediaType};base64,${image_base64}`, detail: "high" as const } }
      : { type: "image_url" as const, image_url: { url: image_url, detail: "high" as const } };

    const systemPrompt = `あなたは20年以上の臨床経験を持つ日本の歯科放射線専門医AIです。
パノラマX線・デンタルX線・口腔内写真・モニター撮影写真など、あらゆる歯科画像を高精度で分析します。

【画像形式への対応と読影方針】
■ パターンA: デジタルX線（panorama_xray / dental_xray）
  - 画像が直接アップロードされた高品質X線
  - 最高精度の読影が可能
  - 根尖病変・歯槽骨吸収・初期う蝕も積極的に検出する
  - confidence 0.85以上を基準に報告

■ パターンB: モニター撮影（monitor_photo）
  - タブレット等でX線モニターを撮影した画像
  - グレア・反射・コントラスト低下が生じている可能性あり
  - 見えている情報を最大限に活用する
  - 不鮮明な部分はconfidence 0.6〜0.7で報告（省略しない）
  - 「グレアで確認困難だが〜の可能性あり」という形で積極的に報告する

■ パターンC: 口腔内写真（intraoral_photo）
  - カラー画像から視覚的所見を報告
  - 変色・欠損・補綴物の形態を確認

→ いずれのパターンでも見える情報を最大限活用して所見を報告すること
→ 画像が不鮮明でも「報告しない」より「疑いとして報告する」を優先する

【FDI歯番号体系】
上顎右: 18,17,16,15,14,13,12,11
上顎左: 21,22,23,24,25,26,27,28
下顎左: 31,32,33,34,35,36,37,38
下顎右: 41,42,43,44,45,46,47,48

【判定ステータスと読影基準】
caries: う蝕（X線透過像・変色・歯質欠損）
c0: 初期脱灰（白濁・要観察）
c1: エナメル質限局う蝕
c2: 象牙質達するう蝕（三角形透過像）
c3: 歯髄腔達するう蝕
c4: 残根（歯冠崩壊）
watch: 要観察（軽度陰影・初期う蝕疑い）
cr: コンポジットレジン充填（歯質類似透過性）
inlay: インレー・アンレー（金属修復）
crown: クラウン（金属冠・セラミック冠）
bridge: ブリッジ（複数歯連結補綴）
rct: 根管治療済み（根管内充填材あり）
in_treatment: 根管治療中（仮封・ファイル）
root_remain: 残根（歯冠なく根のみ）
missing: 欠損（歯が存在しない）
implant: インプラント（金属ポスト状構造物）

【信頼度設定基準】
0.95〜0.99: 明確（金属冠・欠損・インプラント等）
0.80〜0.94: ほぼ確実（明瞭なう蝕・根管充填等）
0.65〜0.79: ある程度確認（初期う蝕・疑い病変）
0.50〜0.64: 不鮮明・判断困難（モニター撮影グレア部分等）

【分析手順（必須）】
1. 画像形式をimage_typeに記録
2. 上顎右(18→11)→上顎左(21→28)→下顎左(31→38)→下顎右(41→48)の順に全歯をスキャン
3. 補綴物・欠損・う蝕・根管治療・歯周病変を全て記録（健全歯のみ省略）
4. 親知らず(18,28,38,48)の扱い：
   - 画像に写っていない・存在しない → missing（欠損）として報告
   - 埋伏・水平埋伏 → in_treatmentまたはwatchとして報告
   - 日本人成人の多くは親知らずが欠損または未萌出のため、写っていなければ欠損と判断する
5. 欠損歯の判定ポリシー（重要）：
   - 歯が存在しない部位は必ずmissing_teethに追加する
   - 「歯があるかどうかわからない」場合は欠損（missing、confidence 0.6）として報告する
   - 見落としより多めに報告することを優先する
6. 特に重要な所見をnotable_findingsに列挙

【detail記載例（30字以内）】
良い例: "近心面に象牙質達するう蝕陰影"
良い例: "金属冠、辺縁部に二次う蝕疑い"
良い例: "根管充填済み、根尖透過像なし"
良い例: "水平埋伏智歯、萌出困難"

【出力JSON形式（厳守・JSONのみ返すこと）】
{
  "image_type": "panorama_xray | dental_xray | monitor_photo | intraoral_photo | screenshot | unknown",
  "tooth_findings": [
    {
      "tooth": "16",
      "status": "crown",
      "confidence": 0.92,
      "detail": "金属冠確認、辺縁部良好"
    }
  ],
  "summary": "全体所見の要約（200字程度）",
  "missing_teeth": ["18", "28"],
  "notable_findings": ["46番: 根尖透過像あり根尖性歯周炎疑い", "36番: 辺縁部に二次う蝕疑い"],
  "tooth_chart": { "16": "crown", "18": "missing" },
  "bone_level": "正常 | 軽度吸収 | 中等度吸収 | 高度吸収 | 不明",
  "overall_risk": "低 | 中 | 高 | 不明"
}`;

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
                text: image_hint === "monitor_photo"
                  ? `この画像はX線モニターをカメラで撮影した写真です。
グレア・反射・低コントラストがある可能性がありますが、見える情報を全て活用して歯科所見を報告してください。

【モニター撮影の読影方針】
- 白く光って見える部分 → 金属補綴物（クラウン・インレー）の可能性が高い
- 黒い部分・影 → 欠損歯またはう蝕の可能性
- グレアで不鮮明でも「〜の疑い」として積極的に報告する
- 見落としより多めに報告することを優先する
- 親知らず(18,28,38,48)は写っていなければ欠損として報告する

分析手順：上顎右(18→11)→上顎左(21→28)→下顎左(31→38)→下顎右(41→48)の順に全歯をスキャン。JSONのみで回答。`
                  : `このパノラマX線画像（またはデンタルX線）を専門医レベルで分析してください。

【X線読影の方針】
- 白く高輝度な部分 → 金属補綴物（クラウン・ブリッジ・インレー・インプラント）
- 黒い透過像 → う蝕・骨吸収・根尖病変
- 歯が存在しない部位 → 欠損（missing）
- 根管内の高輝度像 → 根管充填済み（RCT）
- 見落としより多めに報告することを優先する
- 親知らず(18,28,38,48)は写っていなければ欠損として報告する

分析手順：上顎右(18→11)→上顎左(21→28)→下顎左(31→38)→下顎右(41→48)の順に全歯をスキャン。補綴物・欠損・う蝕・根管治療・歯周病変を全て記録。JSONのみで回答。`,
              },
              imageContent,
            ],
          },
        ],
        temperature: 0.05,
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

    // ステータスマッピング（AI出力 → フロントエンドのTOOTH_STATUSキー）
    const statusMap: Record<string, string> = {
      caries: "caries", cavity: "caries", decay: "caries",
      c0: "c0", c1: "c1", c2: "c2", c3: "c3", c4: "c4",
      watch: "watch",
      cr: "cr", composite: "cr", filled: "cr", filling: "cr", restoration: "cr", treated: "cr",
      inlay: "inlay", onlay: "inlay",
      crown: "crown", cap: "crown", metal_crown: "crown", ceramic_crown: "crown",
      bridge: "bridge",
      rct: "rct", root_canal: "rct",
      root_remain: "root_remain", residual_root: "root_remain",
      in_treatment: "in_treatment",
      missing: "missing", absent: "missing",
      implant: "implant",
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
        toothFindings.push({ tooth: String(missingTooth), status: "missing", confidence: 0.95, detail: "欠損（歯がない）" });
        mappedChart[String(missingTooth)] = "missing";
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
      notable_findings: result.notable_findings || [],
    });
  } catch (e) {
    console.error("xray-analyze error:", e);
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
