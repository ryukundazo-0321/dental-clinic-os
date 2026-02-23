import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 120;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const FIELD_PROMPTS: Record<string, string> = {
  s: `歯科カルテのS欄（主訴・主観）を作成してください。
患者の訴え・症状を簡潔にまとめてください。
例: "右下臼歯部の疼痛（冷水痛+）。2週間前から発症。"`,

  tooth: `歯科カルテの歯式記録をまとめてください。
歯番号とステータスを一覧にしてください。FDI表記で。
例: "#46 C3 / #47 C2 / #16 CR / #28 欠損"`,

  perio: `歯科カルテのP検（歯周検査）結果をまとめてください。
PPD値、BOP、その他所見を整理してください。
例: "#46 PPD 4,5,4 / 3,4,3 BOP(+)"`,

  dh: `歯科カルテのDH記録（衛生士記録・O欄）を作成してください。
実施した処置、所見、Dr申し送り事項をまとめてください。
例: "SC全顎実施 / TBI実施 / 申し送り: #46 PPD4-5mm BOP(+)"`,

  dr: `歯科カルテのA欄（評価・診断）とP欄（治療計画）を作成してください。
【A】に歯番号+確定診断名、【P】に本日の処置内容・処方・次回予定を記載。
保険請求に必要な傷病名を必ず記載（う蝕→K022、歯髄炎→K040、歯周炎→K051等）。
例:
【A】#46 急性歯髄炎(Pul)
【P】本日: #46 浸麻・抜髄 / 処方: ロキソプロフェン60mg 3T/5日 / 次回: 根充`,
};

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OpenAI API key not set" }, { status: 500 });

    const { appointment_id, field_key } = await request.json();
    if (!appointment_id || !field_key) {
      return NextResponse.json({ error: "appointment_id and field_key required" }, { status: 400 });
    }

    const fieldPrompt = FIELD_PROMPTS[field_key];
    if (!fieldPrompt) {
      return NextResponse.json({ error: `Unknown field_key: ${field_key}` }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all chunks for this field
    const { data: chunks, error: chunkError } = await supabase
      .from("karte_transcript_chunks")
      .select("*")
      .eq("appointment_id", appointment_id)
      .eq("classified_field", field_key)
      .order("chunk_index", { ascending: true });

    if (chunkError || !chunks || chunks.length === 0) {
      return NextResponse.json({ error: "No chunks found for this field" }, { status: 404 });
    }

    // Combine chunk texts
    const combinedText = chunks
      .map((c: { corrected_text: string; raw_text: string; speaker_role: string }) => 
        `[${c.speaker_role}] ${c.corrected_text || c.raw_text}`)
      .join("\n");

    // Generate draft with GPT-4o
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `あなたは歯科カルテ作成の専門AIアシスタントです。
文字起こしテキストを受け取り、正確なカルテ記載に整形します。

${fieldPrompt}

重要:
- 文字起こしに含まれない情報は追加しない
- 歯科用語の誤変換は正しく補正する
- 簡潔かつ正確に記載する
- テキストのみ返してください（JSON不要）`,
          },
          { role: "user", content: `以下の文字起こしから${field_key}欄を作成してください:\n\n${combinedText}` },
        ],
        temperature: 0.1,
        max_tokens: 1000,
      }),
    });

    if (!gptRes.ok) {
      return NextResponse.json({ error: `GPT error: ${gptRes.status}` }, { status: 500 });
    }

    const gptData = await gptRes.json();
    const draftText = gptData.choices?.[0]?.message?.content?.trim() || "";

    if (!draftText) {
      return NextResponse.json({ error: "Empty draft generated" }, { status: 500 });
    }

    const chunkIds = chunks.map((c: { id: string }) => c.id);

    // Upsert draft
    const { data: draft, error: draftError } = await supabase
      .from("karte_ai_drafts")
      .upsert(
        {
          appointment_id,
          field_key,
          draft_text: draftText,
          source_chunk_ids: chunkIds,
          status: "draft",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "appointment_id,field_key" }
      )
      .select()
      .single();

    if (draftError) {
      console.error("Draft upsert error:", draftError);
      return NextResponse.json({ error: "Draft save failed", detail: draftError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      draft_id: draft.id,
      draft_text: draftText,
      field_key,
      chunk_count: chunks.length,
    });
  } catch (e) {
    console.error("Generate draft error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
