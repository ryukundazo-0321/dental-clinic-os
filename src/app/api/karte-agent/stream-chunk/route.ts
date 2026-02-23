import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 60;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const CLASSIFY_PROMPT = `あなたは歯科診療の音声文字起こしを分類するアシスタントです。

入力テキストを以下のフィールドに分類し、話者を判定してください。

フィールド:
- "s": 患者の訴え、症状、痛み、しみる等の主観的情報
- "tooth": 歯番号+状態の記録（C1,C2,C3,CR,FMC,欠損,残根等）
- "perio": P検の数値、BOP、PPD、歯周ポケット検査
- "dh": 衛生士の処置（SC,TBI,PMTC等）、Dr申し送り
- "dr": 医師の診断、処置実施、処方、次回計画
- null: 挨拶、雑談、分類不能

話者:
- "dr": 医師
- "dh": 衛生士
- "patient": 患者
- "unknown": 不明

歯科用語の誤変換も補正してください（例: 「6版」→「6番」、「CR充電」→「CR充填」）

JSONのみ返してください:
{"field":"s","role":"patient","confidence":0.95,"corrected":"補正後テキスト"}`;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OpenAI API key not set" }, { status: 500 });

    const body = await request.json();
    const { appointment_id, chunk_index, audio_base64, raw_text_input, unit_id } = body;

    if (!appointment_id) return NextResponse.json({ error: "appointment_id required" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    let rawText = raw_text_input || "";

    // Step 1: Whisper transcription (if audio provided)
    if (audio_base64 && !rawText) {
      const audioBuffer = Buffer.from(audio_base64, "base64");
      const audioBlob = new Blob([audioBuffer], { type: "audio/webm" });
      
      const whisperFd = new FormData();
      whisperFd.append("file", audioBlob, "chunk.webm");
      whisperFd.append("model", "whisper-1");
      whisperFd.append("language", "ja");
      whisperFd.append("prompt", "歯科診療所での会話。う蝕 C1 C2 C3 CR充填 抜髄 根管治療 SC SRP P検 BOP PPD 浸麻 印象 FMC インレー 右上 左上 右下 左下");
      whisperFd.append("temperature", "0");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: whisperFd,
      });

      if (!whisperRes.ok) {
        return NextResponse.json({ error: `Whisper error: ${whisperRes.status}` }, { status: 500 });
      }

      const whisperResult = await whisperRes.json();
      rawText = whisperResult.text || "";
    }

    if (!rawText || rawText.trim().length < 2) {
      return NextResponse.json({ success: true, skipped: true, reason: "empty text" });
    }

    // Filter hallucinations
    const hallucinations = [
      "ご視聴ありがとうございました", "チャンネル登録", "お願いします。",
      "ありがとうございました。", "ご視聴ありがとうございます",
      "チャンネル登録お願いします", "高評価お願いします",
      "おやすみなさい", "それではまた",
    ];
    const trimmed = rawText.trim();
    if (hallucinations.some(h => trimmed === h || trimmed === h.replace("。", ""))) {
      return NextResponse.json({ success: true, skipped: true, reason: "hallucination" });
    }
    // Also skip very short/meaningless text
    if (trimmed.length < 4) {
      return NextResponse.json({ success: true, skipped: true, reason: "too short" });
    }

    // Step 2: AI classification with GPT-4o-mini
    let classifyResult = { field: null as string | null, role: "unknown", confidence: 0.5, corrected: rawText };

    try {
      const classifyRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: CLASSIFY_PROMPT },
            { role: "user", content: rawText },
          ],
          temperature: 0,
          max_tokens: 200,
          response_format: { type: "json_object" },
        }),
      });

      if (classifyRes.ok) {
        const classifyData = await classifyRes.json();
        const content = classifyData.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          classifyResult = {
            field: parsed.field || null,
            role: parsed.role || "unknown",
            confidence: parsed.confidence || 0.5,
            corrected: parsed.corrected || rawText,
          };
        }
      }
    } catch (e) {
      console.error("Classification error:", e);
      // Continue with unclassified chunk
    }

    // Step 3: Insert into DB
    const { data: chunk, error } = await supabase
      .from("karte_transcript_chunks")
      .insert({
        appointment_id,
        unit_id: unit_id || null,
        chunk_index: chunk_index || 0,
        raw_text: rawText,
        corrected_text: classifyResult.corrected,
        speaker_role: classifyResult.role,
        classified_field: classifyResult.field,
        confidence: classifyResult.confidence,
      })
      .select()
      .single();

    if (error) {
      console.error("DB insert error:", error);
      return NextResponse.json({ error: "DB insert failed", detail: error.message }, { status: 500 });
    }

    // Step 4: Check if we should auto-generate draft
    // Count chunks for the classified field
    if (classifyResult.field) {
      const { count } = await supabase
        .from("karte_transcript_chunks")
        .select("*", { count: "exact", head: true })
        .eq("appointment_id", appointment_id)
        .eq("classified_field", classifyResult.field);

      // Auto-trigger draft generation when 3+ chunks exist for a field
      if (count && count >= 3) {
        // Fire and forget - don't wait for draft generation
        fetch(new URL("/api/karte-agent/generate-draft", request.url).toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id, field_key: classifyResult.field }),
        }).catch(() => {});
      }
    }

    return NextResponse.json({
      success: true,
      chunk_id: chunk.id,
      corrected_text: classifyResult.corrected,
      classified_field: classifyResult.field,
      speaker_role: classifyResult.role,
      confidence: classifyResult.confidence,
    });
  } catch (e) {
    console.error("Stream chunk error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
