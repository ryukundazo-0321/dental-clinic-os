import { NextRequest, NextResponse } from "next/server";
import { parseUKEBuffer } from "@/lib/uke-parser";
import { matchUKE } from "@/lib/uke-matcher";

// ============================================================
// CP-6: UKE分析API
// INPUT : multipart/form-data { file: UKEファイル（Shift-JIS） }
// 処理  : parse（uke-parser）→ match（uke-matcher）→ OpenAI分析
// OUTPUT: { success, analysis, matched_summary, unmatched_codes }
// CP-7（アップロードUI）がこのAPIを1回呼ぶだけで完結する
// ============================================================

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OPENAI_API_KEY未設定" }, { status: 500 });
    }

    // === 1. ファイル受信 ===
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "UKEファイルが見つかりません。multipart/form-dataの'file'フィールドで送信してください。" },
        { status: 400 }
      );
    }

    // === 2. パース（uke-parser.ts・HTTPリクエストなし）===
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const parsed = parseUKEBuffer(buffer);

    if (parsed.patients.length === 0) {
      return NextResponse.json(
        { error: "レセプトデータが見つかりませんでした。正しいUKEファイルか確認してください。" },
        { status: 400 }
      );
    }

    // === 3. 公式マスタ照合（uke-matcher.ts・HTTPリクエストなし）===
    const matched = await matchUKE(parsed);

    // === 4. OpenAI分析用プロンプト生成 ===
    // 患者名・生年月日は送らない（個人情報保護）
    // 処置コード・病名・点数・回数のみ送る
    const patientSummaries = matched.patients.map((p, i) => {
      const diagnoses  = p.hs.map(h => h.diagnosis_name || h.diagnosis_code).join("、");
      const procedures = p.ss.map(s =>
        `${s.procedure_name || s.fee_code}（${s.points}点×${s.count}回）`
      ).join("、");
      const drugs = p.iy.map(d => d.drug_name || d.drug_code).join("、");
      return `患者${i + 1}: 傷病名[${diagnoses}] 処置[${procedures}] 薬剤[${drugs}]`;
    });

    const prompt = `
あなたは歯科医院の診療報酬請求の専門家です。
以下は歯科医院1ヶ月分のレセプトデータ（${matched.summary.total_patients}名分）です。

${patientSummaries.join("\n")}

照合できなかったコード（算定漏れ候補）:
SS: ${matched.unmatched_codes.ss.join(", ") || "なし"}
HS: ${matched.unmatched_codes.hs.join(", ") || "なし"}

以下をJSON形式で回答してください（日本語）:
{
  "patterns": [
    {
      "pattern_name": "パターン名（例：C2充填1回完結）",
      "diagnosis_codes": ["傷病名コード"],
      "diagnosis_names": ["傷病名"],
      "fee_codes": ["9桁コード"],
      "procedure_names": ["処置名"],
      "use_count": 出現回数,
      "total_points": 合計点数
    }
  ],
  "missing_claims": [
    {
      "fee_code": "9桁コード",
      "procedure_name": "処置名",
      "reason": "算定漏れと考えられる理由"
    }
  ],
  "insights": ["気づき・改善提案（最大5件）"]
}
JSONのみ返してください。マークダウンや説明文は不要です。
`.trim();

    // === 5. OpenAI API呼び出し ===
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 4096,
      }),
    });

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      console.error("[analyze-uke] OpenAI error:", errText);
      return NextResponse.json(
        { error: "OpenAI API呼び出しに失敗しました", detail: errText },
        { status: 500 }
      );
    }

    const openaiData = await openaiRes.json();
    const rawText = openaiData.choices[0]?.message?.content || "{}";

    // === 6. JSONパース ===
    let analysis: {
      patterns: {
        pattern_name: string;
        diagnosis_codes: string[];
        diagnosis_names: string[];
        fee_codes: string[];
        procedure_names: string[];
        use_count: number;
        total_points: number;
      }[];
      missing_claims: { fee_code: string; procedure_name: string; reason: string }[];
      insights: string[];
    };

    try {
      const clean = rawText.replace(/^```json\s*/i, "").replace(/\s*```$/i, "").trim();
      analysis = JSON.parse(clean);
    } catch {
      console.error("[analyze-uke] JSONパースエラー:", rawText);
      return NextResponse.json(
        { error: "OpenAI応答のJSONパースに失敗しました", raw: rawText },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      analysis,
      matched_summary: matched.summary,
      unmatched_codes: matched.unmatched_codes,
    });

  } catch (e) {
    console.error("[analyze-uke] エラー:", e);
    return NextResponse.json(
      { error: `分析に失敗しました: ${String(e)}` },
      { status: 500 }
    );
  }
}
