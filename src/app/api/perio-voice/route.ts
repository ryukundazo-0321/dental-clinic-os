import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      transcript,
      probe_points,
      current_tooth,
      excluded_teeth,
      exam_order,
      mode,
    } = body;
    // mode: "pocket" (ポケット測定) or "bop" (BOP記録)
    // probe_points: 1, 4, or 6
    // excluded_teeth: ["18", "28"] (欠損・残根で除外する歯)
    // exam_order: ["18","17","16",...] (検査順)

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "APIキー未設定" },
        { status: 500 }
      );
    }

    let systemPrompt = "";

    if (mode === "bop") {
      systemPrompt = `あなたは歯科P検（歯周検査）のBOP記録を解析するAIです。
歯科衛生士がBOP（出血）のある部位を読み上げた音声の文字起こしを解析してください。

読み上げパターン:
- "16 BOP" → 16番にBOPあり
- "26出血" → 26番にBOPあり
- "33、34、35 BOP" → 33,34,35にBOPあり

出力はJSON形式で:
{
  "bop_teeth": ["16", "26", "33", "34", "35"],
  "raw_interpretation": "解析内容の説明"
}`;
    } else {
      const pointsDesc =
        probe_points === 1
          ? "1点式（最深部の値のみ）"
          : probe_points === 4
            ? "4点式（頬側近心、頬側中央、頬側遠心、舌側中央）"
            : "6点式（頬側近心MB、頬側中央B、頬側遠心DB、舌側近心ML、舌側中央L、舌側遠心DL）";

      systemPrompt = `あなたは歯科P検（歯周検査）の音声解析AIです。
歯科衛生士がポケット深さを読み上げた音声の文字起こしを解析してください。

検査方式: ${pointsDesc}
${current_tooth ? `現在の検査歯: #${current_tooth}` : ""}
${excluded_teeth?.length ? `除外歯（欠損・残根）: ${excluded_teeth.join(", ")}` : ""}

読み上げパターン例（6点式）:
- "3, 2, 3, 2, 2, 3" → MB=3, B=2, DB=3, ML=2, L=2, DL=3
- "3 2 3 2 2 3" → 同上
- "さん に さん に に さん" → 同上（日本語数字）

重要ルール:
- ${probe_points}点式で解析してください
- 1つの歯で複数の値が読まれた場合、${probe_points}個の数値として解釈
- 数字以外のノイズは無視
- 確信度が低い場合はconfidenceを下げてください

出力はJSON形式で:
{
  "readings": [
    {
      "tooth": "16",
      "values": [3, 2, 3, 2, 2, 3],
      "max_value": 3,
      "confidence": 0.9
    }
  ],
  "current_values": [3, 2, 3, 2, 2, 3],
  "max_value": 3,
  "raw_interpretation": "解析内容の説明"
}`;
    }

    const res = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: `文字起こし:\n${transcript}`,
            },
          ],
          temperature: 0.1,
          response_format: { type: "json_object" },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json(
        {
          success: false,
          error: `OpenAI Error: ${res.status} ${errText}`,
        },
        { status: 500 }
      );
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(content);

    return NextResponse.json({
      success: true,
      mode: mode || "pocket",
      result,
    });
  } catch (e) {
    console.error("perio-voice error:", e);
    return NextResponse.json(
      {
        success: false,
        error: e instanceof Error ? e.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
