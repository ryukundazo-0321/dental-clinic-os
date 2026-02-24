import { NextResponse } from "next/server";

export async function POST() {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OpenAI API key not set" }, { status: 500 });

    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: "gpt-4o-transcribe",
          input_audio_transcription: {
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
          input_audio_noise_reduction: {
            type: "near_field",
          },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Realtime token error:", response.status, errText);
      return NextResponse.json({ error: `Token generation failed: ${response.status}` }, { status: 500 });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (e) {
    console.error("Realtime token error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
