import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image_base64 } = body;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "OPENAI_API_KEY未設定" }, { status: 500 });
    }

    if (!image_base64) {
      return NextResponse.json({ success: false, error: "画像データがありません" }, { status: 400 });
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `日本の健康保険証の画像からOCRで情報を読み取ってください。
以下のJSON形式で出力してください:
{
  "insurance_type": "社保 or 国保 or 後期高齢 or 公費 or 不明",
  "insurer_number": "保険者番号（8桁）",
  "insured_symbol": "記号",
  "insured_number": "番号",
  "name_kanji": "被保険者氏名",
  "date_of_birth": "YYYY-MM-DD",
  "sex": "男 or 女",
  "burden_ratio": 0.3,
  "valid_from": "資格取得日（YYYY-MM-DD or null）",
  "valid_until": "有効期限（YYYY-MM-DD or null）",
  "confidence": 0.9,
  "notes": "読み取り上の注意事項"
}

burden_ratioの判定:
- 6歳以下 → 0.2
- 70歳未満 → 0.3
- 70-74歳 → 0.2（現役並み所得者は0.3）
- 75歳以上（後期高齢） → 0.1

読み取れない項目はnullにしてください。`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "この保険証画像から情報を読み取ってください。" },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image_base64}`, detail: "high" } },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ success: false, error: `Vision API Error: ${res.status}` }, { status: 500 });
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const result = JSON.parse(content);

    return NextResponse.json({ success: true, ocr: result });
  } catch (e) {
    console.error("insurance-ocr error:", e);
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : "Unknown error" }, { status: 500 });
  }
}
