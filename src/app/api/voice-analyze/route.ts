import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    const existingSoapS = formData.get("existing_soap_s") as string || "";
    const whisperOnly = formData.get("whisper_only") as string || "";
    const fullTranscript = formData.get("full_transcript") as string || "";

    if (!audioFile && !fullTranscript) {
      return NextResponse.json({ error: "音声ファイルがありません" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI APIキーが設定されていません。Vercelの環境変数を確認してください。" }, { status: 500 });
    }

    // ★ full_transcriptモード: テキストが既にある場合、Whisperスキップ → SOAP生成のみ
    if (fullTranscript && fullTranscript.trim().length > 5) {
      return await generateSOAP(apiKey, fullTranscript, existingSoapS);
    }

    // ===== Step 1: Whisper API で音声→テキスト変換 =====
    let transcript = "";
    try {
      const whisperFormData = new FormData();
      whisperFormData.append("file", audioFile, "recording.webm");
      whisperFormData.append("model", "whisper-1");
      whisperFormData.append("language", "ja");
      // ★ Whisperプロンプト改善: 会話例+誤認識しやすい用語を重点配置
      whisperFormData.append("prompt", [
        "以下は歯科診療所での歯科医師と患者の診察中の会話です。歯科専門用語が頻出します。",
        "医師「右下6番を見ますね。C2ですね、FMC形成しましょう。浸麻します。」",
        "患者「はい、お願いします。」",
        "医師「左上3番もCR充填が必要ですね。」",

        "1番 2番 3番 4番 5番 6番 7番 8番",
        "右上 左上 右下 左下",
        "右上1番 右上2番 右上3番 右上4番 右上5番 右上6番 右上7番 右上8番",
        "左上1番 左上2番 左上3番 左上4番 左上5番 左上6番 左上7番 左上8番",
        "右下1番 右下2番 右下3番 右下4番 右下5番 右下6番 右下7番 右下8番",
        "左下1番 左下2番 左下3番 左下4番 左下5番 左下6番 左下7番 左下8番",

        "う蝕 C1 C2 C3 C4 シーワン シーツー シーサン シーフォー",
        "FMC エフエムシー 全部金属冠",
        "CR充填 シーアールじゅうてん コンポジットレジン レジン充填",
        "CAD/CAM冠 キャドキャムかん",
        "TEK テック 仮歯",
        "抜髄 ばつずい 根管治療 こんかんちりょう 根治 感根治",
        "根充 こんじゅう 根管充填",
        "SRP エスアールピー ルートプレーニング",
        "SC スケーリング 歯石除去",
        "PMTC ピーエムティーシー",
        "BOP ビーオーピー プロービング 歯周ポケット",
        "浸潤麻酔 浸麻 しんま 伝達麻酔",
        "印象 いんしょう 型取り 連合印象 精密印象 アルジネート シリコン",
        "咬合採得 バイト 咬合紙",
        "装着 セット 合着 セメント",
        "インレー メタルインレー クラウン ブリッジ Br",
        "前装冠 メタルボンド ジルコニア",
        "支台築造 コア メタルコア ファイバーポスト",
        "歯周病 歯周炎 歯肉炎 P Peri ペリオ",
        "抜歯 ばっし 普通抜歯 難抜歯 埋伏歯",
        "親知らず 智歯 智歯周囲炎 ペリコ",
        "切開 排膿 縫合 抜糸",
        "打診痛 冷水痛 温熱痛 自発痛 咬合痛",
        "パノラマ デンタル X線 レントゲン",
        "歯周組織検査 P検 6点法 動揺度",
        "処方 ロキソニン カロナール フロモックス ムコスタ サワシリン",
        "TBI 歯磨き指導 PCR 口腔衛生指導",
        "二次カリエス 二次う蝕 不適合 脱離 PZ脱離",
      ].join("\n"));

      // ★ temperature=0で最も安定した認識結果
      whisperFormData.append("temperature", "0");

      const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: whisperFormData,
      });

      if (!whisperResponse.ok) {
        const errText = await whisperResponse.text();
        console.error("Whisper error:", errText);
        return NextResponse.json({ 
          error: `音声認識エラー: ${whisperResponse.status}。APIキーとクレジット残高を確認してください。`,
          detail: errText
        }, { status: 500 });
      }

      const whisperResult = await whisperResponse.json();
      transcript = whisperResult.text || "";
    } catch (whisperErr) {
      console.error("Whisper exception:", whisperErr);
      return NextResponse.json({ error: "音声認識処理でエラーが発生しました" }, { status: 500 });
    }

    if (!transcript || transcript.trim().length < 5) {
      return NextResponse.json({ 
        error: "音声が短すぎるか認識できませんでした。もう少し長く、はっきり話してみてください。",
        transcript: transcript || "(認識テキストなし)"
      }, { status: 400 });
    }

    // ===== Step 1.5: ★新規★ 文字起こし自動補正AI =====
    transcript = await correctTranscript(apiKey, transcript);

    // whisper_onlyモード: 補正済みテキストを返す
    if (whisperOnly === "true") {
      return NextResponse.json({ success: true, transcript });
    }

    // ===== Step 2: SOAP生成 =====
    return await generateSOAP(apiKey, transcript, existingSoapS);

  } catch (error) {
    console.error("Voice analyze error:", error);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}

// =====================================================
// ★ 新規: 文字起こし自動補正AI（Step 1.5）
// Whisperの誤認識を歯科専門用語に補正する
// =====================================================
async function correctTranscript(apiKey: string, rawTranscript: string): Promise<string> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `あなたは歯科診療の音声書き起こしを補正する専門家です。
Whisper APIの出力を受け取り、歯科用語の誤認識のみを最小限に修正します。

## 補正ルール

### 歯番号の補正（最重要）
- 「市場にばん」→「4番2番」、「五番」→「5番」、「6版」→「6番」
- 「右下の6」→「右下6番」（「番」を補完）
- 数字+「番」パターンは必ず保持

### 歯科専門用語の補正
- 「えふえむしー」「FMS」→「FMC」
- 「CR中点」「CR充電」→「CR充填」
- 「浸魔」「新魔」→「浸麻」
- 「罰随」「抜水」→「抜髄」
- 「コン中」→「根充」
- 「感根地」「感根知」→「感根治」
- 「印傷」→「印象」
- 「咬合再得」→「咬合採得」
- 「テク」→「TEK」
- 「P県」→「P検」
- 「VOP」→「BOP」

### 薬名の補正
- 「録そにん」→「ロキソニン」
- 「フロモクス」→「フロモックス」
- 「むこすた」→「ムコスタ」

## 出力
補正後のテキストのみ出力。説明不要。原文の意味・内容は絶対に変えない。`
          },
          { role: "user", content: rawTranscript }
        ],
        temperature: 0,
        max_tokens: 4000,
      }),
    });

    if (!res.ok) {
      console.error("Transcript correction failed:", await res.text());
      return rawTranscript;
    }

    const result = await res.json();
    const corrected = result.choices?.[0]?.message?.content?.trim();
    return (corrected && corrected.length > 5) ? corrected : rawTranscript;
  } catch (err) {
    console.error("Transcript correction error:", err);
    return rawTranscript;
  }
}

// =====================================================
// SOAP生成（Step 2）
// =====================================================
async function generateSOAP(apiKey: string, transcript: string, existingSoapS: string): Promise<NextResponse> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  var soapData: any = null;
  var gptSuccess = false;
  try {
    const systemPrompt = `あなたは日本の歯科診療所で使用される電子カルテのAIアシスタントです。
歯科医師の診察会話を正確にSOAPノートに変換する専門家です。
10年以上の経験を持つ歯科衛生士と同等の知識で、漏れなく正確に記録します。

## 最重要ルール
1. 会話中の全ての処置・診断・歯番号を漏れなく記録する
2. 保険請求に必要な傷病名を処置に対応させて全て記録する
3. 歯番号は会話中の発話をそのまま使い、推測で変更しない

## 歯番号のルール（FDI表記）
右上: 18,17,16,15,14,13,12,11
左上: 21,22,23,24,25,26,27,28
右下: 48,47,46,45,44,43,42,41
左下: 31,32,33,34,35,36,37,38

「右下5番」→ 45、「左上6番」→ 26、「右上1番」→ 11
番号が明示されている場合は必ずその番号を使用。変更禁止。
位置の言及がない場合のみ文脈から推測可。

## 処置の分類

【歯冠修復・補綴】
- FMC: 形成+印象+次回セット = 2回以上 → procedures: ["FMC形成"] or ["FMCセット"]
- CAD/CAM冠: キャドキャム冠
- インレー: 金属の詰め物
- CR充填: レジン修復、光重合 = 1回完結 → procedures: ["CR充填"]
- ブリッジ: Br

【歯内療法】
- 抜髄: 麻酔抜髄 → procedures: ["抜髄"]
- 感根治: 感染根管治療 → procedures: ["感根治"]
- 根充: 根管充填 → procedures: ["根充"]

【歯周治療】
- SC: スケーリング → procedures: ["SC"]
- SRP: ルートプレーニング → procedures: ["SRP"]
- P検: 歯周組織検査 → procedures: ["P検"]
- TBI: 歯磨き指導 → procedures: ["TBI"]
- PMTC: 機械的歯面清掃 → procedures: ["PMTC"]

【外科】
- 普通抜歯 / 難抜歯 / 切開排膿

【その他】
- 装着: セット → procedures: ["装着"]
- TEK: 仮歯 → procedures: ["TEK"]
- 印象 / 連合印象 / 咬合採得 / 浸麻 / 伝麻 / 処方

## 傷病名（診断名）のルール ★保険請求のため漏れ厳禁★

### 明示的な傷病名: 会話で言及されたものは全て記録
### 処置から推定される傷病名（★必須追加★）:
- FMC/インレー/CR充填 → う蝕(C2) ※C1/C3/C4が明示されていればそちら
- 抜髄 → 歯髄炎(Pul)
- 感根治 → 根尖性歯周炎(Per)
- SC/SRP → 歯周炎(P)
- 普通抜歯（親知らず以外）→ 該当傷病名
- 親知らず抜歯 → 智歯周囲炎(Perico)
- 装着（FMCセット等）→ 対応する歯の傷病名を継続

### 複数歯は各歯ごとに記録
#45 CR充填 + #46 FMC形成 → 2つの傷病名を記録

## SOAP記載ルール

S: 患者の主訴・訴え。複数あれば全て記録。
O: 医師の所見+実施した処置の詳細。歯番号+所見、処置内容を全て記録。略語OK。
A: 歯番号+診断名を全て列挙。
P: 本日の処置（全て）+ 処方薬（薬名・用量・日数）+ 次回予定。

## 出力形式
必ずJSON形式のみ出力。説明文やマークダウン禁止。`;

    const userPrompt = `以下の歯科診察の会話テキストをSOAPノートに変換してください。
★ 会話中の全ての処置・診断・歯番号を漏れなく記録すること。1つでも漏れたらNG。

【既存のSOAP-S（問診票から入力済み）】
${existingSoapS || "（なし）"}

【診察中の会話テキスト（音声書き起こし）】
${transcript}

JSON形式で出力:
{
  "soap_s": "患者の主訴と自覚症状（既存のSOAP-Sも統合）",
  "soap_o": "全ての検査所見・口腔内所見・実施した処置の詳細",
  "soap_a": "全ての歯番号+診断名",
  "soap_p": "全ての本日処置 + 処方薬（薬名・用量・日数）+ 次回予定",
  "tooth_updates": {"46": "in_treatment", "45": "treated"},
  "procedures": ["FMC形成", "連合印象", "浸麻", "CR充填", "SC"],
  "diagnoses": [
    {"name": "う蝕(C2)", "tooth": "46", "code": "K022"},
    {"name": "う蝕(C2)", "tooth": "45", "code": "K022"},
    {"name": "歯周炎(P)", "tooth": "", "code": "K051"}
  ]
}

★ diagnoses:
- 全処置に対応する傷病名を記録。漏れ厳禁。
- 処置した歯ごとに1つ以上の傷病名
- コード: K020=CO, K021=C1, K022=C2, K023=C3, K024=C4, K040=Pul, K045=Per, K046=歯根嚢胞, K050=G, K051=P, K052=歯周膿瘍, K081=Perico, K083=埋伏歯, K076=TMD, K120=Hys, K003=破折, K001=欠損, K300=不適合, K301=二次う蝕

★ procedures: 会話中の全処置を記録。正確な名称を使用:
FMC, FMCセット, CAD/CAM冠, インレー, CR充填, ブリッジ, 抜髄, 感根治, 根充, 根管貼薬, SC, SRP, PMTC, P検, TBI, 普通抜歯, 難抜歯, 装着, TEK, 印象, 連合印象, 浸麻, 伝麻, 咬合採得, 処方, 切開排膿, 縫合, 抜糸

★ tooth_updates: caries / in_treatment / treated / crown / missing / implant / bridge
- in_treatment: FMC形成, インレー形成, 抜髄, 感根治, 根充, TEK, 印象, SRP
- treated: CR充填, SC, PMTC, TBI, P検
- crown: FMCセット, クラウンセット, インレーセット, 装着
- caries: 未治療う蝕の発見`;

    const models = ["gpt-4o", "gpt-4o-mini"];
    for (const model of models) {
      try {
        const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.05,
            max_tokens: 3000,
            response_format: { type: "json_object" },
          }),
        });

        if (!gptResponse.ok) {
          console.error(`${model} error:`, await gptResponse.text());
          continue;
        }

        const gptResult = await gptResponse.json();
        const content = gptResult.choices?.[0]?.message?.content || "";
        const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        soapData = JSON.parse(jsonStr);
        gptSuccess = true;
        break;
      } catch (modelErr) {
        console.error(`${model} parse error:`, modelErr);
        continue;
      }
    }

    if (!gptSuccess || !soapData) {
      return NextResponse.json({
        success: true, transcript,
        soap: { s: existingSoapS ? `${existingSoapS}\n\n【音声記録】${transcript}` : transcript, o: "", a: "", p: "" },
        tooth_updates: {}, procedures: [], diagnoses: [],
        warning: "AI SOAP変換に失敗しました。手動で編集してください。"
      });
    }
  } catch (gptErr) {
    console.error("GPT exception:", gptErr);
    return NextResponse.json({
      success: true, transcript,
      soap: { s: transcript, o: "", a: "", p: "" },
      tooth_updates: {}, procedures: [], diagnoses: [],
      warning: "SOAP変換でエラーが発生しました"
    });
  }

  return NextResponse.json({
    success: true, transcript,
    soap: { s: soapData.soap_s || "", o: soapData.soap_o || "", a: soapData.soap_a || "", p: soapData.soap_p || "" },
    tooth_updates: soapData.tooth_updates || {},
    procedures: soapData.procedures || [],
    diagnoses: soapData.diagnoses || [],
  });
}
