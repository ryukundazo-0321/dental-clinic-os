import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const openaiForm = new FormData();
    openaiForm.append("file", file, "recording.webm");
    openaiForm.append("model", "whisper-1");
    openaiForm.append("language", "ja");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: openaiForm,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      console.error("Whisper error:", err);
      return NextResponse.json({ error: "Whisper API error", detail: err }, { status: 500 });
    }

    const data = await whisperRes.json();
    return NextResponse.json({ text: data.text || "" });
  } catch (err) {
    console.error("whisper route error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
