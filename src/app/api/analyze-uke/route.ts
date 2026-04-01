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

// バリエーション型
export interface PatternVariant {
  variant_key: string;
  variant_name: string;   // m_feesの正式名称を「・」で結合（ハルシネーションなし）
  fee_codes: string[];
  procedure_names: string[];
  variant_count: number;
}

// 集計済みパターン型（傷病名単位）
export interface GroupedPattern {
  key: string;
  diagnosis_codes: string[];
  diagnosis_names: string[];
  use_count: number;
  variants: PatternVariant[];  // 処置のバリエーション一覧
}

// ============================================================
// groupPatterns: 傷病名単位で集計・処置の組み合わせをvariantとして持つ
// ハードコードなし・純粋な集計関数
// ============================================================
function groupPatterns(patients: MatchedPatientReceipt[]): GroupedPattern[] {
  // 傷病名コードをキーにしたMap
  const diagMap = new Map<string, GroupedPattern>();

  for (const p of patients) {
    const diagCodes = p.hs.map(h => h.diagnosis_code).filter(Boolean).sort();
    const diagNames = p.hs.map(h => h.diagnosis_name).filter(Boolean);
    const feeCodes  = p.ss.map(s => s.fee_code).filter(c => c && c.length === 9).sort();
    const procNames = p.ss.map(s => s.procedure_name).filter(Boolean);

    if (feeCodes.length === 0) continue;

    // 傷病名コードの組み合わせをキーに
    const diagKey = diagCodes.join("|");
    // 処置の組み合わせをvariantキーに
    const variantKey = feeCodes.join("|");
    // variant_name = m_feesの正式名称を「・」で結合
    const variantName = procNames.join("・");

    if (!diagMap.has(diagKey)) {
      diagMap.set(diagKey, {
        key: diagKey,
        diagnosis_codes: diagCodes,
        diagnosis_names: diagNames,
        use_count: 0,
        variants: [],
      });
    }

    const pattern = diagMap.get(diagKey)!;
    pattern.use_count++;

    // 同じvariantKeyがあればvariant_countを増やす
    const existingVariant = pattern.variants.find(v => v.variant_key === variantKey);
    if (existingVariant) {
      existingVariant.variant_count++;
    } else {
      pattern.variants.push({
        variant_key: variantKey,
        variant_name: variantName,
        fee_codes: feeCodes,
        procedure_names: procNames,
        variant_count: 1,
      });
    }
  }

  // 各パターンのvariantsをvariant_count降順でソート
  for (const pattern of diagMap.values()) {
    pattern.variants.sort((a, b) => b.variant_count - a.variant_count);
  }

  // use_count降順で返す
  return Array.from(diagMap.values()).sort((a, b) => b.use_count - a.use_count);
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

      // variant設計：傷病名単位のパターン一覧をOpenAIに渡す
      // variant_nameはm_feesの正式名称結合済み（OpenAIに命名させない）
      // OpenAIは算定漏れ指摘とinsightsだけ担当
      const patternList = grouped.map((g, i) => {
        const variantSummary = g.variants.slice(0, 3).map(v =>
          `  - ${v.variant_name}（${v.variant_count}回）`
        ).join("\n");
        return `パターン${i + 1}: 傷病名[${g.diagnosis_names.join("、")}]（計${g.use_count}回）\n${variantSummary}`;
      }).join("\n");

      const prompt = `あなたは歯科医院の診療報酬請求の専門家です。
以下は歯科医院1ヶ月分のレセプトから抽出した処置パターン一覧です。

${patternList}

以下をJSON形式で回答してください（日本語）:
{
  "missing_claims": [
    {
      "procedure_name": "処置名",
      "reason": "算定漏れと考えられる理由"
    }
  ],
  "insights": ["気づき・改善提案（最大5件）"]
}
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

      // grouped_patternsをそのまま返す（variant_nameはm_fees正式名称結合済み）
      return NextResponse.json({
        success: true,
        named_patterns: grouped,
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
