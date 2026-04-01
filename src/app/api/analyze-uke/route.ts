import { NextRequest, NextResponse } from "next/server";
import { parseUKEBuffer } from "@/lib/uke-parser";
import { matchUKE } from "@/lib/uke-matcher";
import type { MatchedPatientReceipt } from "@/lib/uke-matcher";

// ============================================================
// CP-6: UKE分析API（2ステップ設計）
//
// step=parse（POST multipart/form-data）:
//   parse -> match -> groupPatterns（ロジック集計・OpenAIなし・即時）
//   -> matched_patients + grouped_patterns を返す
//
// step=name（POST application/json）:
//   grouped_patternsを受け取りOpenAIで命名
//   -> named_patterns + missing_claims + insights を返す
//
// 設計方針：
//   fee_codeはロジックで集計（ハルシネーションなし）
//   OpenAIはネーミングと分析だけ担当
// ============================================================

export interface GroupedPattern {
  key: string;
  diagnosis_codes: string[];
  diagnosis_names: string[];
  fee_codes: string[];
  procedure_names: string[];
  use_count: number;
  pattern_name: string;
}

// ============================================================
// groupPatterns: 傷病名×fee_codesの組み合わせをロジックで集計
// ハードコードなし・純粋な集計関数
// ============================================================
function groupPatterns(patients: MatchedPatientReceipt[]): GroupedPattern[] {
  const map = new Map<string, GroupedPattern>();

  for (const p of patients) {
    const diagCodes = p.hs.map(h => h.diagnosis_code).filter(Boolean).sort();
    const diagNames = p.hs.map(h => h.diagnosis_name).filter(Boolean);
    const feeCodes  = p.ss.map(s => s.fee_code).filter(c => c && c.length === 9).sort();
    const procNames = p.ss.map(s => s.procedure_name).filter(Boolean);

    if (feeCodes.length === 0) continue;

    const key = `${diagCodes.join("|")}::${feeCodes.join("|")}`;

    if (map.has(key)) {
      map.get(key)!.use_count++;
    } else {
      map.set(key, {
        key,
        diagnosis_codes: diagCodes,
        diagnosis_names: diagNames,
        fee_codes: feeCodes,
        procedure_names: procNames,
        use_count: 1,
        pattern_name: "",
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.use_count - a.use_count);
}

// ============================================================
// POST /api/analyze-uke
// ============================================================
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(req.url);
    const step = searchParams.get("step") || "parse";

    // ============================================================
    // step=parse: parse -> match -> groupPatterns（OpenAIなし・即時）
    // ============================================================
    if (step === "parse") {
      const formData = await req.formData();
      const file = formData.get("file");
      if (!file || !(file instanceof Blob)) {
        return NextResponse.json(
          { error: "UKEファイルが見つかりません。" },
          { status: 400 }
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const parsed = parseUKEBuffer(buffer);

      if (parsed.patients.length === 0) {
        return NextResponse.json(
          { error: "レセプトデータが見つかりませんでした。正しいUKEファイルか確認してください。" },
          { status: 400 }
        );
      }

      const matched = await matchUKE(parsed);
      const grouped = groupPatterns(matched.patients);

      return NextResponse.json({
        success: true,
        matched_patients: matched.patients,
        grouped_patterns: grouped,
        matched_summary: matched.summary,
        unmatched_codes: matched.unmatched_codes,
      });
    }

    // ============================================================
    // step=name: grouped_patternsを受け取りOpenAIで命名
    // ============================================================
    if (step === "name") {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return NextResponse.json({ error: "OPENAI_API_KEY未設定" }, { status: 500 });
      }

      const body = await req.json() as { grouped_patterns: GroupedPattern[] };
      const grouped = body.grouped_patterns;

      if (!grouped || grouped.length === 0) {
        return NextResponse.json({ error: "grouped_patternsが空です" }, { status: 400 });
      }

      const patternList = grouped.map((g, i) =>
        `パターン${i + 1}（${g.use_count}回）: 傷病名[${g.diagnosis_names.join("、")}] 処置[${g.procedure_names.join("、")}]`
      ).join("\n");

      const prompt = `あなたは歯科医院の診療報酬請求の専門家です。
以下は歯科医院1ヶ月分のレセプトから抽出した処置パターン一覧です。

${patternList}

以下をJSON形式で回答してください（日本語）:
{
  "pattern_names": [
    "パターン1の名前（例：慢性辺縁性歯周炎・歯周基本治療）",
    "パターン2の名前"
  ],
  "missing_claims": [
    {
      "procedure_name": "処置名",
      "reason": "算定漏れと考えられる理由"
    }
  ],
  "insights": ["気づき・改善提案（最大5件）"]
}
pattern_namesの配列はパターンと同じ順番・同じ件数で返してください。
JSONのみ返してください。マークダウンや説明文は不要です。`.trim();

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
          max_tokens: 16384,
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

      let analysis: {
        pattern_names: string[];
        missing_claims: { procedure_name: string; reason: string }[];
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

      const named_patterns: GroupedPattern[] = grouped.map((g, i) => ({
        ...g,
        pattern_name: analysis.pattern_names?.[i] || `パターン${i + 1}`,
      }));

      return NextResponse.json({
        success: true,
        named_patterns,
        missing_claims: analysis.missing_claims || [],
        insights: analysis.insights || [],
      });
    }

    return NextResponse.json({ error: "stepはparse or nameを指定してください" }, { status: 400 });

  } catch (e) {
    console.error("[analyze-uke] エラー:", e);
    return NextResponse.json(
      { error: `分析に失敗しました: ${String(e)}` },
      { status: 500 }
    );
  }
}
