import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const maxDuration = 180;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const CLASSIFY_AND_DRAFT_PROMPT = `あなたは日本の歯科診療所で10年以上の経験を持つ電子カルテAIアシスタントです。

## あなたの仕事
歯科診察の文字起こしテキストを受け取り、5つのカルテフィールドに振り分けて整形します。

## Step 1: テキストの理解と補正
音声認識の誤変換を補正してください：
- 歯番号: 「6版」→6番、「市場にばん」→4番2番、「碁盤」→5番
- 処置: 「CR充電」→CR充填、「FMS」→FMC、「印傷」→印象、「テク」→TEK
- 用語: 「浸魔」→浸麻、「罰随」→抜髄、「感根地」→感根治、「コン中」→根充
- 薬名: 「録そにん」→ロキソニン、「フロモクス」→フロモックス

## Step 2: 5フィールドへの振り分けと整形

### 歯番号（FDI表記）
右上: 11-18, 左上: 21-28, 右下: 41-48, 左下: 31-38
「右下6番」→#46, 「左上3番」→#23

### 各フィールド

**s（主訴・S欄）**: 患者の訴え・症状を簡潔に。
例: "右下臼歯部の疼痛（冷水痛+）。2週間前から発症。"

**tooth（歯式）**: 歯番号とステータスの一覧。
例: "#46 C3（治療中）/ #47 C2"

**perio（P検）**: PPD値、BOP、歯周検査所見。
例: "#46 PPD 4,5,4 / 3,4,3 BOP(+)"

**dh（DH記録・O欄）**: 衛生士の処置、所見、Dr申し送り。
例: "SC全顎実施 / TBI実施 / 申し送り: #46 PPD4-5mm BOP(+)"

**dr（Dr診察・A/P欄）**: 【A】に歯番号+確定診断名、【P】に処置内容・処方・次回予定。
保険請求に必要な傷病名を必ず記載。
例:
【A】#46 急性歯髄炎(Pul)
【P】本日: #46 浸麻・抜髄 / 処方: ロキソプロフェン60mg 3T/5日 / 次回: 根充

## 重要
- テキストに含まれない情報は追加しない
- 該当する内容がないフィールドは空文字にする
- 歯番号が明示されている場合はそのまま使う

## 出力形式
JSON形式のみ。余計な説明は不要。
{
  "s": "...",
  "tooth": "...",
  "perio": "...",
  "dh": "...",
  "dr": "..."
}`;

export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return NextResponse.json({ error: "OpenAI API key not set" }, { status: 500 });

    const { appointment_id, transcript } = await request.json();
    if (!appointment_id || !transcript) {
      return NextResponse.json({ error: "appointment_id and transcript required" }, { status: 400 });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Step 1: Save full transcript as a chunk
    await supabase.from("karte_transcript_chunks").insert({
      appointment_id,
      chunk_index: 0,
      raw_text: transcript,
      corrected_text: transcript,
      speaker_role: "mixed",
      classified_field: null,
    });

    // Step 2: GPT-4o classification + drafting in one call
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: CLASSIFY_AND_DRAFT_PROMPT },
          { role: "user", content: transcript },
        ],
        temperature: 0,
        max_tokens: 3000,
        response_format: { type: "json_object" },
      }),
    });

    if (!gptRes.ok) {
      const errText = await gptRes.text();
      console.error("GPT error:", gptRes.status, errText);
      return NextResponse.json({ error: `GPT error: ${gptRes.status}` }, { status: 500 });
    }

    const gptData = await gptRes.json();
    const content = gptData.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "Empty GPT response" }, { status: 500 });
    }

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error("JSON parse error:", e, content);
      return NextResponse.json({ error: "Failed to parse GPT response" }, { status: 500 });
    }

    // Step 3: Upsert drafts for each field
    const fields = ["s", "tooth", "perio", "dh", "dr"];
    let fieldsGenerated = 0;

    for (const field of fields) {
      const text = parsed[field]?.trim();
      if (!text) continue;

      const { error } = await supabase
        .from("karte_ai_drafts")
        .upsert(
          {
            appointment_id,
            field_key: field,
            draft_text: text,
            status: "draft",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "appointment_id,field_key" }
        );

      if (error) {
        console.error(`Draft upsert error for ${field}:`, error);
      } else {
        fieldsGenerated++;
      }
    }

    return NextResponse.json({
      success: true,
      fields_generated: fieldsGenerated,
      drafts: parsed,
    });
  } catch (e) {
    console.error("classify-and-draft error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
