import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio") as File;
    const existingSoapS = formData.get("existing_soap_s") as string || "";

    if (!audioFile) {
      return NextResponse.json({ error: "音声ファイルがありません" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenAI APIキーが設定されていません。Vercelの環境変数を確認してください。" }, { status: 500 });
    }

    // ===== Step 1: Whisper API で音声→テキスト変換 =====
    let transcript = "";
    try {
      const whisperFormData = new FormData();
      whisperFormData.append("file", audioFile, "recording.webm");
      whisperFormData.append("model", "whisper-1");
      whisperFormData.append("language", "ja");
      whisperFormData.append("prompt", "歯科診療の会話。歯科用語: う蝕 C1 C2 C3 CR充填 インレー クラウン 抜髄 根管治療 歯周ポケット スケーリング SRP 印象 TEK デンチャー ブリッジ インプラント 咬合 レジン 光重合 打診 冷水痛 温熱痛 自発痛 歯番号 右上 右下 左上 左下 1番 2番 3番 4番 5番 6番 7番 8番");

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

    // ===== Step 2: GPT-4o でテキスト→SOAP+歯式変換 =====
    let soapData = null;
    try {
      const soapPrompt = `あなたは歯科クリニックの電子カルテAIです。
以下の歯科診察の会話テキストをSOAPノートに変換してください。

【既存のSOAP-S（問診票から入力済み）】
${existingSoapS || "（なし）"}

【診察中の会話テキスト】
${transcript}

重要ルール:
- 必ずSOAPの4項目すべてを埋めてください
- 会話から読み取れる情報で各項目を記述してください
- S: 患者の主訴・症状の訴え（既存のSOAP-Sの内容も統合すること）
- O: ドクターが確認した客観的所見（検査結果、歯の状態等）
- A: 診断名（歯番号 + 病名）
- P: 本日の処置内容 + 次回の予定
- 歯番号はFDI表記の数字のみ（例: "46", "11"）
- JSONのみ出力。マークダウンや説明文は不要

以下のJSON形式で出力:
{
  "soap_s": "患者の主訴と自覚症状",
  "soap_o": "検査所見・口腔内所見",
  "soap_a": "診断名",
  "soap_p": "治療計画・本日の処置・次回予定",
  "tooth_updates": {"46": "treated"},
  "procedures": ["CR充填"],
  "diagnoses": [
    {"name": "う蝕（C2）", "tooth": "#46", "code": "K022"},
    {"name": "歯周炎（P）", "tooth": "", "code": "K051"}
  ]
}

diagnoses: 会話から推定される傷病名のリスト。各項目にname（傷病名）、tooth（対象歯番、なければ空）、code（歯科病名コード K021=C1, K022=C2, K023=C3, K024=C4, K040=Pul, K045=Per, K050=G, K051=P, K081=Perico, K076=TMD, K120=Hys 等）を含める。
tooth_updatesの値: caries / treated / crown / missing / implant / bridge`;

      // まずGPT-4oで試行
      const models = ["gpt-4o", "gpt-4o-mini"];
      let gptSuccess = false;

      for (const model of models) {
        try {
          const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: model,
              messages: [
                { role: "system", content: "歯科カルテAI。必ず有効なJSONのみを出力。説明文やマークダウンは不要。" },
                { role: "user", content: soapPrompt },
              ],
              temperature: 0.2,
              max_tokens: 2000,
            }),
          });

          if (!gptResponse.ok) {
            console.error(`${model} error:`, await gptResponse.text());
            continue;
          }

          const gptResult = await gptResponse.json();
          const content = gptResult.choices?.[0]?.message?.content || "";
          
          // JSONをパース
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
        // SOAP変換失敗でもtranscriptは返す
        return NextResponse.json({
          success: true,
          transcript,
          soap: {
            s: existingSoapS ? `${existingSoapS}\n\n【音声記録】${transcript}` : transcript,
            o: "",
            a: "",
            p: "",
          },
          tooth_updates: {},
          procedures: [],
          diagnoses: [],
          warning: "AI SOAP変換に失敗しました。文字起こしテキストをS欄に追加しました。手動で編集してください。"
        });
      }
    } catch (gptErr) {
      console.error("GPT exception:", gptErr);
      return NextResponse.json({
        success: true,
        transcript,
        soap: { s: transcript, o: "", a: "", p: "" },
        tooth_updates: {},
        procedures: [],
        diagnoses: [],
        warning: "SOAP変換でエラーが発生しました"
      });
    }

    return NextResponse.json({
      success: true,
      transcript,
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

  } catch (error) {
    console.error("Voice analyze error:", error);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}
