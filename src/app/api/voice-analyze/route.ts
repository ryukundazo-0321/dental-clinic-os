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
      return NextResponse.json({ error: "APIキーが設定されていません" }, { status: 500 });
    }

    // ===== Step 1: Whisper API で音声→テキスト変換 =====
    const whisperFormData = new FormData();
    whisperFormData.append("file", audioFile, "recording.webm");
    whisperFormData.append("model", "whisper-1");
    whisperFormData.append("language", "ja");
    whisperFormData.append("prompt", "歯科診療の会話です。歯科用語: う蝕、齲蝕、CR、インレー、クラウン、抜髄、根管治療、P検、BOP、歯周ポケット、スケーリング、SRP、印象、TEK、デンチャー、ブリッジ、インプラント、咬合、顎関節");

    const whisperResponse = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: whisperFormData,
    });

    if (!whisperResponse.ok) {
      const err = await whisperResponse.text();
      return NextResponse.json({ error: `音声認識エラー: ${err}` }, { status: 500 });
    }

    const whisperResult = await whisperResponse.json();
    const transcript = whisperResult.text;

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json({ error: "音声を認識できませんでした" }, { status: 400 });
    }

    // ===== Step 2: GPT-4o でテキスト→SOAP+歯式変換 =====
    const soapPrompt = `あなたは歯科クリニックの電子カルテAIアシスタントです。
以下は歯科診察中のドクターと患者の会話を文字起こししたテキストです。
この会話内容を歯科SOAPノートに変換してください。

【既存のSOAP-S（問診票から）】
${existingSoapS || "（なし）"}

【会話テキスト】
${transcript}

以下のJSON形式で出力してください。必ず有効なJSONのみを出力し、それ以外のテキストは含めないでください。

{
  "soap_s": "Subjective: 患者の主訴・自覚症状。既存のSOAP-Sがあればそれを活かしつつ、会話で得られた追加情報を統合",
  "soap_o": "Objective: 検査所見・口腔内所見。歯番号はFDI表記（#11, #46等）で記載",
  "soap_a": "Assessment: 診断名・評価。例: #46 C2（象牙質う蝕）",
  "soap_p": "Plan: 治療計画・本日の処置内容・次回予定",
  "tooth_updates": {
    "歯番号": "状態コード",
    "例: 46": "caries"
  },
  "procedures": ["本日実施した処置のリスト"]
}

tooth_updatesの状態コードは以下のみ使用:
- caries: う蝕あり(C)
- treated: 処置済(CR/インレー等)
- crown: クラウン/冠
- missing: 欠損/抜歯済
- implant: インプラント
- bridge: ブリッジ

会話に含まれない情報は空文字にしてください。推測で情報を追加しないでください。`;

    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "あなたは歯科専門の電子カルテAIアシスタントです。必ず有効なJSONのみを出力してください。" },
          { role: "user", content: soapPrompt },
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!gptResponse.ok) {
      const err = await gptResponse.text();
      return NextResponse.json({ error: `SOAP変換エラー: ${err}`, transcript }, { status: 500 });
    }

    const gptResult = await gptResponse.json();
    const content = gptResult.choices?.[0]?.message?.content || "";

    // JSONをパース
    let soapData;
    try {
      const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      soapData = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json({
        error: "SOAP変換結果のパースに失敗しました",
        transcript,
        raw_content: content,
      }, { status: 500 });
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
    });

  } catch (error) {
    console.error("Voice analyze error:", error);
    return NextResponse.json({ error: "サーバーエラーが発生しました" }, { status: 500 });
  }
}
