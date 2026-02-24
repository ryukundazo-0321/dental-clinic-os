import { NextResponse } from "next/server";

export async function POST() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY not set" }, { status: 500 });

    // GA API: POST /v1/realtime/client_secrets
    // type: "transcription" for transcription-only (no AI audio response)
    const sessionConfig = {
      session: {
        type: "transcription",
        input: {
          noise_reduction: { type: "near_field" },
          transcription: {
            model: "gpt-4o-transcribe",
            language: "ja",
            prompt: "歯科診療の会話です。",
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 800,
          },
        },
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
    // GA API returns { value: "ek_xxx", expires_at: ... } at top level
    // or { client_secret: { value: "ek_xxx", expires_at: ... } }
    return NextResponse.json(data);
  } catch (e) {
    console.error("Realtime token error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
