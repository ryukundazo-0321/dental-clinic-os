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
            prompt: "歯科診療所での医師・衛生士と患者の会話。う蝕 C1 C2 C3 C4 FMC CR充填 インレー 抜髄 根管治療 感根治 根充 TEK SC SRP PMTC TBI P検 BOP PPD 浸麻 印象 咬合採得 形成 装着 ロキソニン フロモックス カロナール クラビット 右上 左上 右下 左下 1番 2番 3番 4番 5番 6番 7番 8番",
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
