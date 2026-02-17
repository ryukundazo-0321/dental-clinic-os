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
      console.log("Audio file info:", {
        name: audioFile.name,
        size: audioFile.size,
        type: audioFile.type
      });

      if (audioFile.size < 1000) {
        return NextResponse.json({
          error: "音声ファイルが小さすぎます。もう少し長く録音してください。",
          detail: `File size: ${audioFile.size} bytes`
        }, { status: 400 });
      }

      // ★ MIMEタイプに応じた拡張子を決定
      const mimeType = audioFile.type || "audio/webm";
      let fileName = "recording.webm";
      if (mimeType.includes("mp4") || mimeType.includes("m4a")) fileName = "recording.m4a";
      else if (mimeType.includes("ogg")) fileName = "recording.ogg";
      else if (mimeType.includes("wav")) fileName = "recording.wav";

      // ★ audioFileをBufferに変換してBlobとして送信（互換性向上）
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioBlob = new Blob([arrayBuffer], { type: mimeType });

      const whisperFormData = new FormData();
      whisperFormData.append("file", audioBlob, fileName);
      whisperFormData.append("model", "whisper-1");
      whisperFormData.append("language", "ja");

      // ★ Whisperプロンプト: 短めにして会話形式を重視（長すぎるプロンプトはハルシネーションの原因になる）
      whisperFormData.append("prompt", 
        "歯科診療所での歯科医師と患者の診察会話。" +
        "「右下6番、C2ですね。FMC形成しましょう。浸麻します。」" +
        "「左上3番のCR充填をします。」" +
        "「痛みはどうですか？」「冷たいものがしみます。」" +
        "う蝕 C1 C2 C3 C4 FMC CR充填 抜髄 根管治療 感根治 根充 SC SRP " +
        "インレー クラウン ブリッジ TEK 印象 連合印象 咬合採得 浸麻 " +
        "歯周病 歯周炎 抜歯 智歯周囲炎 ペリコ 装着 セット " +
        "右上 左上 右下 左下 1番 2番 3番 4番 5番 6番 7番 8番"
      );

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
      console.log("Whisper raw result:", { length: transcript.length, text: transcript.substring(0, 200) });

    } catch (whisperErr) {
      console.error("Whisper exception:", whisperErr);
      return NextResponse.json({ error: "音声認識処理でエラーが発生しました" }, { status: 500 });
    }

    // ===== Step 1.1: ★ ハルシネーション検出 =====
    transcript = filterHallucinations(transcript);

    if (!transcript || transcript.trim().length < 5) {
      return NextResponse.json({
        error: "音声を認識できませんでした。もう少しはっきり話してみてください。マイクが正しく接続されているか確認してください。",
        transcript: transcript || "(認識テキストなし)"
      }, { status: 400 });
    }

    // ===== Step 1.5: ★ 文字起こし自動補正AI =====
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
// ★★★ 新規: ハルシネーション検出・除去
// Whisperが無音区間で生成する偽テキストを検出
// =====================================================
function filterHallucinations(text: string): string {
  if (!text) return "";

  // ★ 既知のハルシネーションパターン（日本語・英語）
  const HALLUCINATION_PATTERNS = [
    /【購読ボタンを押してね[!！]?】/g,
    /チャンネル登録.*お願い/g,
    /ご視聴.*ありがとう/g,
    /字幕.*作成/g,
    /Thank you for watching/gi,
    /Subscribe.*channel/gi,
    /Subtitles by/gi,
    /Amara\.org/gi,
    /Please subscribe/gi,
    /いいねボタン/g,
    /コメント欄/g,
    /チャンネル登録/g,
    /この動画/g,
    /次の動画/g,
    /最後まで.*見て/g,
  ];

  let filtered = text;
  for (const pattern of HALLUCINATION_PATTERNS) {
    filtered = filtered.replace(pattern, "");
  }

  // ★ 同じフレーズの繰り返しを検出（3回以上の繰り返しはハルシネーション）
  // 例: 「購読ボタンを押してね!」が10回繰り返される
  const words = filtered.split(/[\s、。！!]+/).filter(w => w.length > 0);
  if (words.length > 0) {
    const freq: Record<string, number> = {};
    for (const w of words) {
      freq[w] = (freq[w] || 0) + 1;
    }
    const totalWords = words.length;
    for (const [word, count] of Object.entries(freq)) {
      // 同じ単語/フレーズが全体の50%以上 → ハルシネーション
      if (count >= 3 && count / totalWords > 0.5) {
        console.log(`Hallucination detected: "${word}" appears ${count}/${totalWords} times`);
        return ""; // 全体がハルシネーション
      }
    }
  }

  // ★ テキスト全体が短い定型文の繰り返しかチェック
  const uniqueChars = new Set(filtered.replace(/[\s、。！!？?]/g, "")).size;
  if (filtered.length > 20 && uniqueChars < 10) {
    console.log(`Hallucination detected: only ${uniqueChars} unique chars in ${filtered.length} char text`);
    return "";
  }

  return filtered.trim();
}

// =====================================================
// ★ 文字起こし自動補正AI（Step 1.5）
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

## 最重要ルール
- 原文の意味・内容は絶対に変えない
- 誤認識の修正のみ行う
- 歯科と無関係なフレーズ（「チャンネル登録」「購読ボタン」「ご視聴ありがとう」等）はWhisperのハルシネーションなので削除する

## 歯番号の補正
- 「市場にばん」→「4番2番」、「五番」→「5番」、「6版」→「6番」
- 「右下の6」→「右下6番」（「番」を補完）

## 歯科専門用語の補正
- 「えふえむしー」「FMS」→「FMC」
- 「CR中点」「CR充電」→「CR充填」
- 「浸魔」「新魔」→「浸麻」
- 「罰随」「抜水」→「抜髄」
- 「コン中」→「根充」
- 「感根地」→「感根治」
- 「印傷」→「印象」
- 「テク」→「TEK」
- 「P県」→「P検」

## 薬名の補正
- 「録そにん」→「ロキソニン」
- 「フロモクス」→「フロモックス」

## 出力
補正後のテキストのみ出力。説明不要。`
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
    return (corrected && corrected.length > 3) ? corrected : rawTranscript;
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
4. ★ 会話テキストが歯科診療の内容を含まない場合（ハルシネーション等）は、全フィールドを空にする

## 歯番号のルール（FDI表記）
右上: 18,17,16,15,14,13,12,11
左上: 21,22,23,24,25,26,27,28
右下: 48,47,46,45,44,43,42,41
左下: 31,32,33,34,35,36,37,38

「右下5番」→ 45、「左上6番」→ 26、「右上1番」→ 11
番号が明示されている場合は必ずその番号を使用。変更禁止。

## 処置の分類

【歯冠修復・補綴】
- FMC: 形成+印象+次回セット = 2回以上
- CR充填: レジン修復、光重合 = 1回完結
- インレー / CAD/CAM冠 / ブリッジ

【歯内療法】
- 抜髄 / 感根治 / 根充

【歯周治療】
- SC / SRP / P検 / TBI / PMTC

【外科】
- 普通抜歯 / 難抜歯 / 切開排膿

【その他】
- 装着 / TEK / 印象 / 連合印象 / 咬合採得 / 浸麻 / 伝麻 / 処方

## 傷病名のルール ★保険請求のため漏れ厳禁★

### 処置から推定される傷病名（★必須追加★）:
- FMC/インレー/CR充填 → う蝕(C2) ※C1/C3/C4が明示されていればそちら
- 抜髄 → 歯髄炎(Pul)
- 感根治 → 根尖性歯周炎(Per)
- SC/SRP → 歯周炎(P)
- 親知らず抜歯 → 智歯周囲炎(Perico)
- 装着 → 対応する歯の傷病名を継続

### 複数歯は各歯ごとに記録

## SOAP記載ルール
S: 患者の主訴・訴え。複数あれば全て記録。
O: 医師の所見+実施した処置の詳細。歯番号+所見、処置内容を全て記録。
A: 歯番号+診断名を全て列挙。
P: 本日の処置（全て）+ 処方薬（薬名・用量・日数）+ 次回予定。

## 出力形式
必ずJSON形式のみ出力。説明文やマークダウン禁止。`;

    const userPrompt = `以下の歯科診察の会話テキストをSOAPノートに変換してください。
★ 会話中の全ての処置・診断・歯番号を漏れなく記録すること。

★★ 重要: テキストが歯科診療と無関係な内容の場合（ハルシネーション等）は、全フィールドを空文字列にしてください。

【既存のSOAP-S（問診票から入力済み）】
${existingSoapS || "（なし）"}

【診察中の会話テキスト（音声書き起こし）】
${transcript}

JSON形式で出力:
{
  "soap_s": "患者の主訴と自覚症状",
  "soap_o": "全ての検査所見・実施した処置の詳細",
  "soap_a": "全ての歯番号+診断名",
  "soap_p": "全ての本日処置 + 処方薬 + 次回予定",
  "tooth_updates": {"46": "in_treatment", "45": "treated"},
  "procedures": ["FMC形成", "CR充填", "浸麻"],
  "diagnoses": [
    {"name": "う蝕(C2)", "tooth": "46", "code": "K022"}
  ]
}

★ diagnoses: 全処置に対応する傷病名を記録。漏れ厳禁。
コード: K020=CO, K021=C1, K022=C2, K023=C3, K024=C4, K040=Pul, K045=Per, K050=G, K051=P, K081=Perico, K083=埋伏歯, K120=Hys, K003=破折

★ procedures: 正確な名称を使用:
FMC, FMCセット, CAD/CAM冠, インレー, CR充填, ブリッジ, 抜髄, 感根治, 根充, SC, SRP, PMTC, P検, TBI, 普通抜歯, 難抜歯, 装着, TEK, 印象, 連合印象, 浸麻, 伝麻, 咬合採得, 処方

★ tooth_updates: caries / in_treatment / treated / crown / missing
- in_treatment: FMC形成, 抜髄, 感根治, 根充, TEK, 印象, SRP
- treated: CR充填, SC, PMTC, TBI, P検
- crown: FMCセット, インレーセット, 装着`;

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
