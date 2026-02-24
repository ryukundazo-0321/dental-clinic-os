import { NextResponse } from "next/server";

export async function POST() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

    // Exact structure from official docs:
    // https://platform.openai.com/docs/guides/realtime-webrtc
    // Keep it minimal - enable transcription via session.update after connect
    const sessionConfig = {
      session: {
        type: "realtime",
        model: "gpt-4o-realtime-preview",
        output_modalities: ["text"],
        instructions: "あなたは歯科診療の文字起こしアシスタントです。何も返答しないでください。",
      },
    };

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionConfig),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Realtime token error:", response.status, errText);
      return NextResponse.json({ error: `Token failed: ${response.status}`, detail: errText }, { status: 500 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error("Realtime token error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
