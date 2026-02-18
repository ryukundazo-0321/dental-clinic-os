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

    // ★ full_transcriptモード: Whisperスキップ → 統合SOAP生成
    if (fullTranscript && fullTranscript.trim().length > 5) {
      return await generateSOAP(apiKey, fullTranscript, existingSoapS);
    }

    // ===================================================================
    // Step 1: Whisper API — 音声→テキスト
    // ===================================================================
    let transcript = "";
    try {
      console.log("Audio file info:", { name: audioFile.name, size: audioFile.size, type: audioFile.type });

      if (audioFile.size < 1000) {
        return NextResponse.json({
          error: "音声ファイルが小さすぎます。もう少し長く録音してください。",
        }, { status: 400 });
      }

      // MIMEタイプに応じた拡張子
      const mimeType = audioFile.type || "audio/webm";
      let fileName = "recording.webm";
      if (mimeType.includes("mp4") || mimeType.includes("m4a")) fileName = "recording.m4a";
      else if (mimeType.includes("ogg")) fileName = "recording.ogg";
      else if (mimeType.includes("wav")) fileName = "recording.wav";

      // Buffer→Blob変換（Next.js互換性向上）
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioBlob = new Blob([arrayBuffer], { type: mimeType });

      const whisperFormData = new FormData();
      whisperFormData.append("file", audioBlob, fileName);
      whisperFormData.append("model", "whisper-1");
      whisperFormData.append("language", "ja");

      // ★★ プロンプトは短く！長すぎるとハルシネーションの原因になる
      whisperFormData.append("prompt",
        "歯科診療所での医師と患者の会話。" +
        "「右下6番、C2ですね。CR充填しましょう。浸麻します。」" +
        "「痛みはどうですか？」「冷たいものがしみます。」" +
        "う蝕 FMC CR充填 抜髄 根管治療 SC SRP インレー 印象 " +
        "右上 左上 右下 左下 1番 2番 3番 4番 5番 6番 7番 8番"
      );
      whisperFormData.append("temperature", "0");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: whisperFormData,
      });

      if (!whisperRes.ok) {
        const errText = await whisperRes.text();
        console.error("Whisper error:", errText);
        return NextResponse.json({
          error: `音声認識エラー: ${whisperRes.status}`,
          detail: errText
        }, { status: 500 });
      }

      const whisperResult = await whisperRes.json();
      transcript = whisperResult.text || "";
      console.log("Whisper raw:", { len: transcript.length, text: transcript.substring(0, 200) });

    } catch (whisperErr) {
      console.error("Whisper exception:", whisperErr);
      return NextResponse.json({ error: "音声認識処理でエラーが発生しました" }, { status: 500 });
    }

    // ===================================================================
    // Step 1.1: ハルシネーション検出・除去
    // ===================================================================
    transcript = filterHallucinations(transcript);

    if (!transcript || transcript.trim().length < 3) {
      return NextResponse.json({
        error: "音声を認識できませんでした。マイクに近づいて、はっきり話してみてください。",
        transcript: "(認識テキストなし)"
      }, { status: 400 });
    }

    // ===================================================================
    // whisper_onlyモード → 軽量補正して返す
    // ===================================================================
    if (whisperOnly === "true") {
      const corrected = await quickCorrect(apiKey, transcript);
      return NextResponse.json({ success: true, transcript: corrected });
    }

    // ===================================================================
    // Step 2: 統合SOAP生成
    // ===================================================================
    return await generateSOAP(apiKey, transcript, existingSoapS);

  } catch (error) {
    console.error("Voice analyze error:", error);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}


// =====================================================
// ハルシネーション検出・除去
// =====================================================
function filterHallucinations(text: string): string {
  if (!text) return "";

  // 既知のハルシネーションパターン
  const patterns = [
    /【[^】]*購読[^】]*】/g,
    /購読ボタン[をに]?押してね[!！]?/g,
    /チャンネル登録[をお]?お?願い[しい]?[まます]*/g,
    /ご視聴[いただき]*ありがとう[ございます]*/g,
    /字幕[はを]?.*?作成/g,
    /Thank you for watching\.?/gi,
    /Please subscribe\.?/gi,
    /Subtitles by.*$/gim,
    /Amara\.org/gi,
    /いいねボタン/g,
    /コメント欄/g,
    /チャンネル登録/g,
    /この動画[はをで]/g,
    /次の動画/g,
    /最後まで.*?見て/g,
    /購読ボタン/g,
    /お願いします。\s*お願いします。/g,  // 繰り返し
  ];

  let filtered = text;
  for (const p of patterns) {
    filtered = filtered.replace(p, "");
  }

  // 同じフレーズの大量繰り返し → 全体がハルシネーション
  const segs = filtered.split(/[。！!？?\s、\n]+/).filter(s => s.length > 1);
  if (segs.length >= 3) {
    const freq: Record<string, number> = {};
    for (const s of segs) freq[s] = (freq[s] || 0) + 1;
    for (const [word, count] of Object.entries(freq)) {
      if (count >= 3 && count / segs.length > 0.4) {
        console.log(`Hallucination detected: "${word}" x${count}/${segs.length}`);
        return "";
      }
    }
  }

  // ユニーク文字が極端に少ない → ハルシネーション
  const unique = new Set(filtered.replace(/[\s、。！!？?\n]/g, "")).size;
  if (filtered.length > 20 && unique < 8) {
    console.log(`Hallucination: ${unique} unique chars in ${filtered.length} chars`);
    return "";
  }

  return filtered.trim();
}


// =====================================================
// 軽量補正（whisper_onlyモード用 — gpt-4o-mini）
// =====================================================
async function quickCorrect(apiKey: string, raw: string): Promise<string> {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `歯科診療の音声書き起こしを補正してください。
誤認識された歯科用語のみ修正し、原文の意味は変えないでください。
ハルシネーション（「チャンネル登録」「購読ボタン」等のYouTube系フレーズ）は削除してください。

主な補正例:
- 歯番号: 6版→6番、五番→5番、市場→4番
- 処置: FMS→FMC、CR充電→CR充填、印傷→印象、テク→TEK
- 用語: 浸魔/新魔→浸麻、罰随→抜髄、感根地→感根治、コン中→根充
- 薬名: 録そにん→ロキソニン、フロモクス→フロモックス

補正後テキストのみ出力。説明不要。`
          },
          { role: "user", content: raw }
        ],
        temperature: 0,
        max_tokens: 4000,
      }),
    });
    if (!res.ok) return raw;
    const result = await res.json();
    const corrected = result.choices?.[0]?.message?.content?.trim();
    return (corrected && corrected.length > 3) ? corrected : raw;
  } catch {
    return raw;
  }
}


// =====================================================
// ★★★ 統合SOAP生成（核心の改善）
//
// 従来: 補正(gpt-4o-mini) → SOAP生成(gpt-4o) の2段階
//   → 情報が分断され、ChatGPTに貼ったときより精度が落ちた
//
// 改善: 「補正しながらSOAP生成」を1回のgpt-4oで同時実行
//   → ChatGPTに貼り付けたのと同じ体験を再現
// =====================================================
async function generateSOAP(
  apiKey: string,
  transcript: string,
  existingSoapS: string
): Promise<NextResponse> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let soapData: any = null;

  const systemPrompt = `あなたは日本の歯科診療所で10年以上の経験を持つ電子カルテAIアシスタントです。

## あなたの仕事
音声認識で文字起こしされた歯科診察の会話テキストを受け取ります。
音声認識は完璧ではないので、**まず内容を正しく理解・補正し**、その上でSOAPノートに変換します。

## Step 1: テキストの理解と補正
以下のような誤変換が含まれている可能性があります。文脈から正しい意味を推測してください：
- 歯番号: 「6版」→6番、「市場にばん」→4番2番、「碁盤」→5番
- 処置: 「CR充電」→CR充填、「FMS」→FMC、「印傷」→印象、「テク」→TEK
- 用語: 「浸魔」→浸麻、「罰随」→抜髄、「感根地」→感根治、「コン中」→根充
- 薬名: 「録そにん」→ロキソニン、「フロモクス」→フロモックス
- フィラー: 「あー」「えっと」は無視
例: 「右下の6の充電する」→ 「右下6番のCR充填をする」

## Step 2: SOAP変換

### 歯番号（FDI表記）
右上: 11-18, 左上: 21-28, 右下: 41-48, 左下: 31-38
「右下6番」→46, 「左上3番」→23, 「右上1番」→11

### SOAP各項目の書き方
- **S**: 患者の主訴・症状。「冷たいものがしみる」「痛い」等
- **O**: 歯番号＋所見＋実施した全処置を具体的に。略語OK
- **A**: 歯番号＋確定診断名を全て列挙
- **P**: 本日の処置一覧＋処方薬（薬名・用量・日数）＋次回予定

### 傷病名（★保険請求のため漏れ厳禁★）
処置 → 必ず対応する傷病名をつける：
| 処置 | 傷病名 | コード |
|------|--------|--------|
| CR充填/インレー/FMC | う蝕(C2)※明示あればそれ | K022 |
| 抜髄 | 歯髄炎(Pul) | K040 |
| 感根治 | 根尖性歯周炎(Per) | K045 |
| SC/SRP | 歯周炎(P) | K051 |
| 親知らず抜歯 | 智歯周囲炎(Perico) | K081 |
複数歯の処置 → 各歯ごとに傷病名を記録

### 歯式ステータス
- in_treatment: FMC形成, 抜髄, 感根治, 根充, TEK, 印象, SRP
- treated: CR充填, SC, PMTC, TBI, P検, 咬合調整
- crown: FMCセット, インレーセット, 装着
- caries: 未治療う蝕の発見

## 重要な注意
- テキストが歯科診療と無関係（ハルシネーション等）なら、全フィールドを空にする
- 会話に含まれない処置を追加しない（推測で処置を増やさない）
- 歯番号が明示されている場合はそのまま使う（勝手に変更しない）

## 出力形式
JSON形式のみ。余計な説明は不要。`;

  const userPrompt = `以下は歯科診察中の会話を音声認識で書き起こしたテキストです。
誤認識が含まれている可能性があります。文脈から正しく読み取ってSOAPに変換してください。

${existingSoapS ? `【問診票の情報】\n${existingSoapS}\n\n` : ""}【音声書き起こし】
${transcript}

以下のJSON形式で出力:
{
  "corrected_transcript": "補正後の会話テキスト（誤認識を修正したもの）",
  "soap_s": "患者の主訴・症状",
  "soap_o": "所見・実施した処置の詳細（歯番号含む）",
  "soap_a": "歯番号+診断名（全て列挙）",
  "soap_p": "本日の処置+処方薬+次回予定",
  "tooth_updates": {"歯番号": "ステータス"},
  "procedures": ["処置名"],
  "diagnoses": [{"name": "傷病名", "tooth": "歯番号", "code": "コード"}]
}

コード: K021=C1, K022=C2, K023=C3, K024=C4, K040=Pul, K045=Per, K050=G, K051=P, K081=Perico, K120=Hys, K003=破折`;

  try {
    // gpt-4oを最優先、失敗時gpt-4o-miniにフォールバック
    const models = ["gpt-4o", "gpt-4o-mini"];

    for (const model of models) {
      try {
        console.log(`Trying SOAP generation with ${model}...`);

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.1,
            max_tokens: 3000,
            response_format: { type: "json_object" },
          }),
        });

        if (!res.ok) {
          console.error(`${model} HTTP error:`, res.status, await res.text());
          continue;
        }

        const result = await res.json();
        const content = result.choices?.[0]?.message?.content || "";
        const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        soapData = JSON.parse(jsonStr);

        if (soapData.corrected_transcript) {
          console.log("Corrected:", soapData.corrected_transcript.substring(0, 150));
        }
        console.log(`SOAP generated with ${model} ✅`);
        break;

      } catch (modelErr) {
        console.error(`${model} failed:`, modelErr);
        continue;
      }
    }

    if (!soapData) {
      return NextResponse.json({
        success: true,
        transcript,
        soap: {
          s: existingSoapS || transcript,
          o: "",
          a: "",
          p: "",
        },
        tooth_updates: {},
        procedures: [],
        diagnoses: [],
        warning: "SOAP変換に失敗しました。手動で入力してください。",
      });
    }

  } catch (err) {
    console.error("generateSOAP exception:", err);
    return NextResponse.json({
      success: true,
      transcript,
      soap: { s: transcript, o: "", a: "", p: "" },
      tooth_updates: {},
      procedures: [],
      diagnoses: [],
      warning: "SOAP変換でエラーが発生しました",
    });
  }

  return NextResponse.json({
    success: true,
    transcript: soapData.corrected_transcript || transcript,
    soap: {
      s: soapData.soap_s || "",
      o: soapData.soap_o || "",
      a: soapData.soap_a || "",
      p: soapData.soap_p || "",
    },
    tooth_updates: soapData.tooth_updates || {},
    procedures: soapData.procedures || [],
    diagnoses: soapData.diagnoses || [],
  });
}
