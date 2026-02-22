import { NextRequest, NextResponse } from "next/server";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export const maxDuration = 120;

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

    // 共通の歯科用語誤認識パターン
    const DENTAL_CORRECTION_GUIDE = `
## 音声認識の誤変換パターン（必ず補正してください）
歯番号: 6版/六版→6番、市場→4番、碁盤→5番、1万→1番、に版→2番
処置: CR充電→CR充填、FMS→FMC、印傷/印象→印象、テク→TEK、形勢→形成
      根幹治療→根管治療、バツ随→抜髄、感根地/完根地→感根治、コン中/根中→根充
      エス下→SC、SOP/エスオーピー→SRP、PMDC→PMTC、TDI→TBI
薬名: 録そにん/六曽人→ロキソニン、フロモクス→フロモックス、メイアクト
      サワシリン/砂割新→サワシリン、カロナール/加論ある→カロナール
材料: パラジウム/パラ→金パラ、CADカム→CAD/CAM、ジルコ/ジルコニア
その他: 浸魔/新魔/親魔→浸麻、ラバー/ラバーダム、把抜/抜歯
`;

    switch (step) {
      case "dh_record": {
        systemPrompt = `あなたは10年以上の経験を持つ歯科衛生士（DH）のカルテ記録支援AIです。
DHが患者にフィードバックした音声の文字起こしから、正確なSOAP形式のO欄（客観的所見）を生成してください。

${DENTAL_CORRECTION_GUIDE}

## O欄の記述ルール
1. 実施処置を必ず先頭に（SC、SRP、PMTC、TBI、フッ素塗布 等）
2. 部位を明記（全顎、上顎臼歯部、#16遠心 等）
3. 口腔内所見（プラーク付着状況、歯肉発赤・腫脹・出血、歯石、着色）
4. ブラッシング指導内容（磨き残し部位、ワンタフト推奨 等）
5. P検結果があれば要約（最大ポケット値、BOP陽性歯数）

## 重要
- 音声の内容に**ない処置を勝手に追加しない**
- 曖昧な表現は「〜の疑い」「〜と思われる」で記述
- 専門用語と略語を適切に使用（SC、SRP、BOP、PPD等）

出力はJSON形式で:
{
  "soap_o": "O欄の内容（改行区切りで箇条書き）",
  "corrected_transcript": "誤認識を補正した音声テキスト"
}`;

        userPrompt = `以下のDH音声記録を分析してO欄を生成してください。音声認識の誤変換に注意してください。

【DHの音声記録】
${transcript || "(なし)"}

【参考情報】
S欄（主訴）: ${existing_soap?.s || "(なし)"}
歯式: ${tooth_chart ? JSON.stringify(tooth_chart) : "(なし)"}
P検サマリ: ${perio_summary ? JSON.stringify(perio_summary) : "(なし)"}`;
        break;
      }

      case "dr_exam": {
        systemPrompt = `あなたは10年以上の経験を持つ歯科医師（Dr）のカルテ記録支援AIです。
Drが患者に説明・指示した音声の文字起こしから、SOAP形式のA欄（評価）とP欄（計画）を正確に生成してください。

${DENTAL_CORRECTION_GUIDE}

## 歯番号（FDI表記）変換ルール
「右上」=1x, 「左上」=2x, 「右下」=4x, 「左下」=3x
例: 右下6番→#46、左上3番→#23、右上1番→#11

## A欄の記述ルール（★最重要 - 必ず出力すること）
- A欄は「診断名」を書く欄です。必ず最低1つは診断を記述してください
- 歯番号＋確定診断名を**全て**列挙（漏れ厳禁）
- 処置から診断名を推定:
  CR充填/インレー → う蝕(C1〜C4)
  抜髄 → 急性歯髄炎(Pul)または慢性歯髄炎
  感根治/根管治療 → 根尖性歯周炎(Per)
  SC/SRP → 慢性歯周炎(P)
  抜歯(智歯) → 智歯周囲炎(Perico)
  知覚過敏処置 → 象牙質知覚過敏症(Hys)
- 複数歯は各歯ごとに記載: "#46 C3(う蝕) → 歯髄炎(Pul)疑い、#47 C2(う蝕)"
- S欄やO欄の情報も参照して診断名を確定する
- A欄が空はエラーです。音声から処置内容がわかれば、それに対応する診断名を必ず記載

## P欄の記述ルール
1. 本日実施した処置（部位+処置名）
2. 処方薬（薬名・用量・日数・用法）※言及があれば
3. 次回の治療予定（具体的に）
4. 患者への注意事項

## 重要
- A欄は必ず記載してください（空は許容しません）
- 「次回〜」と言われたら次回予定に反映
- 処方薬の言及があれば漏れなく記載

出力はJSON形式で:
{
  "soap_a": "A欄（歯番号+診断名を全て列挙。必ず記載）",
  "soap_p": "P欄（処置+処方+次回予定）",
  "corrected_transcript": "誤認識を補正した音声テキスト"
}`;

        userPrompt = `以下のDr音声記録を分析してA欄・P欄を生成してください。音声認識の誤変換に注意してください。

【Drの音声記録】
${transcript || "(なし)"}

【参考情報】
S欄: ${existing_soap?.s || "(なし)"}
O欄: ${existing_soap?.o || "(なし)"}
歯式: ${tooth_chart ? JSON.stringify(tooth_chart) : "(なし)"}
P検サマリ: ${perio_summary ? JSON.stringify(perio_summary) : "(なし)"}`;
        break;
      }

      case "treatment_plan": {
        const ctx = context || {};
        systemPrompt = `あなたは歯科の治療計画を立案する専門AIです。
SOAP記録、歯式、P検データから包括的な治療計画書を作成してください。

${DENTAL_CORRECTION_GUIDE}

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
  "patient_instructions": "患者さんへの説明（平易な日本語）",
  "notes": "補足事項"
}

priorityは1=高（緊急・疼痛あり）、2=中（早期対応が望ましい）、3=低（経過観察可）。
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

      case "chief": {
        systemPrompt = `あなたは10年以上の経験を持つ歯科衛生士のカルテ記録支援AIです。
患者との会話の文字起こしから、SOAP形式のS欄（主観的情報）を正確に構造化してください。

${DENTAL_CORRECTION_GUIDE}

## S欄の記述ルール
1. 【主訴】患者が最も訴えている症状を簡潔に
2. 【部位】痛みや症状がある歯・部位（右上/左下 等 + 歯番号があれば）
3. 【症状】具体的な症状（ズキズキ、しみる、腫れ、出血 等）
4. 【発症時期】いつから症状があるか
5. 【痛みの程度】軽度/中度/重度 or 1-10のスケール
6. 【増悪因子】冷たいもの、熱いもの、噛んだ時、夜間 等
7. 【服薬】痛み止めの服用有無、効果
8. 【その他】患者が気にしていること

## 重要
- 患者の言葉をベースに、医療用語に適切に変換
- 音声に**ない情報は追加しない**
- 既存のS欄がある場合はそれとマージして構造化

出力はJSON形式で:
{
  "merged_s": "構造化されたS欄テキスト（改行区切り）",
  "analyzed_s": "分析結果のS欄テキスト",
  "corrected_transcript": "誤認識を補正した音声テキスト"
}`;

        userPrompt = `以下の患者との会話から、S欄を生成してください。

【音声記録】
${transcript || "(なし)"}

【既存のS欄（問診票等）】
${existing_soap?.s || "(なし)"}`;
        break;
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown step: ${step}` }, { status: 400 });
    }

    // ★ gpt-4o-miniを使用（高速化のため）。治療計画のみmini
    const model = step === "treatment_plan" ? "gpt-4o-mini" : "gpt-4o-mini";

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.15,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI error:", errText);
      return NextResponse.json({ success: false, error: `OpenAI API error: ${response.status}` }, { status: 500 });
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
