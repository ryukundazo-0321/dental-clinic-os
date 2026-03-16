import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ─── branch_answers を医師が読める自然言語に変換 ──────────────────────────
// コードに「この値=この病名」は一切書かない。
// Claudeに渡すための読みやすいサマリーを作るだけ。

const CHIEF_COMPLAINT_LABEL: Record<string, string> = {
  shimi: "冷たいものがしみる",
  kamu_ita: "噛むと痛い",
  hareguki: "歯や歯ぐきが腫れている",
  shukketsu: "歯ぐきから出血する",
  toreta: "詰め物・被せ物が取れた",
  kekka: "歯がない場所の相談",
  kenshin: "クリーニング・定期検診",
  whitening: "ホワイトニング",
  ceramic: "セラミック相談",
  hagishiri: "歯ぎしり・食いしばり",
};

// 各ブランチの回答キーと選択肢ラベルのマップ
const ANSWER_LABELS: Record<string, Record<string, string>> = {
  // しみる
  trigger: {
    cold_water: "冷たい水でしみる", ice: "アイスでしみる",
    brush: "歯ブラシでしみる", air: "空気でしみる", hot: "温かいものでもしみる",
  },
  duration: {
    instant: "すぐ消える（数秒以内）", seconds: "数秒続く",
    sec30: "30秒以上続く", long: "長く続く",
  },
  progression: { worse: "しみ方が強くなっている", same: "変わらない", unknown: "不明" },
  night_pain: { yes: "夜間痛あり", no: "夜間痛なし" },
  spontaneous: { yes: "自発痛あり（何もしなくても痛む）", no: "自発痛なし" },
  // 噛むと痛い
  timing: {
    bite: "噛んだ瞬間に痛い", release: "噛んで離した瞬間に痛い", constant: "常に違和感",
  },
  severity: { mild: "軽く痛い", clear: "はっきり痛い", severe: "強く痛くて噛めない" },
  only_hard: { yes: "硬いものだけで痛い", no: "軟らかいものでも痛い" },
  nerve_treated: { yes: "根管治療済み", no: "根管治療なし", unknown: "不明" },
  crown: { yes: "被せ物あり", no: "被せ物なし", unknown: "不明" },
  swelling: { yes: "腫れあり", no: "腫れなし" },
  pus: { yes: "排膿あり", no: "排膿なし", unknown: "不明" },
  smell: { yes: "異臭・異味あり", no: "なし" },
  press_pain: { yes: "圧迫痛あり", no: "圧迫痛なし" },
  // 腫れ
  location: {
    whole: "歯ぐき全体", one_tooth: "1本の歯の周り",
    cheek: "頬まで腫れている", unknown: "不明",
    front: "前歯", back: "奥歯", both: "前歯と奥歯",
  },
  pain: { strong: "強く痛い", little: "少し痛い", none: "痛みなし", pain: "痛みあり", shimi: "しみる" },
  bite_pain: { yes: "咬合痛あり", no: "咬合痛なし" },
  loose: { yes: "動揺あり", no: "動揺なし", unknown: "不明" },
  recurrence: { yes: "再発あり", no: "初回", unknown: "不明" },
  // 出血
  // (timingはarrayなので別処理)
  // 取れた
  type: { filling: "詰め物", crown: "被せ物", unknown: "不明" },
  have_it: { yes: "取れたものを保持している", no: "紛失", unknown: "不明" },
  bite: { yes: "噛める", little: "少し痛いが噛める", no: "噛めない" },
  wish: {
    restore: "元に戻してほしい", emergency: "応急処置希望",
    redo: "やり直し希望", consult: "相談して決めたい",
  },
  aesthetic: { yes: "審美希望あり", no: "審美希望なし" },
};

function buildSymptomSummary(
  chiefComplaint: string,
  branchAnswers: Record<string, unknown>
): string {
  const lines: string[] = [];
  lines.push(`主訴: ${CHIEF_COMPLAINT_LABEL[chiefComplaint] || chiefComplaint}`);
  lines.push("詳細問診の回答:");

  for (const [key, val] of Object.entries(branchAnswers)) {
    if (!val) continue;
    if (Array.isArray(val)) {
      // 複数選択（timing, trigger, symptoms等）
      const labels = val
        .map((v) => ANSWER_LABELS[key]?.[v] || v)
        .filter(Boolean)
        .join("、");
      if (labels) lines.push(`  - ${key}: ${labels}`);
    } else {
      const label = ANSWER_LABELS[key]?.[String(val)] || String(val);
      lines.push(`  - ${key}: ${label}`);
    }
  }

  return lines.join("\n");
}

// ─── API ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await request.json();

    const {
      chief_complaint,
      pain_types,       // 後方互換（古い呼び出し元のため残す）
      pain_location,    // 後方互換
      pain_level,       // 後方互換
      symptom_onset,    // 後方互換
      branch_answers,
      questionnaire_response_id,
      patient_id,
    } = body as {
      chief_complaint?: string;
      pain_types?: string[];
      pain_location?: string | string[];
      pain_level?: number | string;
      symptom_onset?: string;
      branch_answers?: Record<string, unknown>;
      questionnaire_response_id?: string;
      patient_id?: string;
    };

    if (!chief_complaint && (!pain_types || pain_types.length === 0)) {
      return NextResponse.json(
        { error: "chief_complaint or pain_types required" },
        { status: 400 }
      );
    }

    // 予防系（傷病名予測不要）はスキップして空を返す
    const NON_DIAGNOSTIC = ["kenshin", "whitening", "ceramic"];
    if (chief_complaint && NON_DIAGNOSTIC.includes(chief_complaint)) {
      return NextResponse.json({ predictions: [], message: "Non-diagnostic branch" });
    }

    // 1. symptom_diagnosis_mapping から傷病名候補を全件取得（母集合）
    const { data: mappings } = await supabase
      .from("symptom_diagnosis_mapping")
      .select("*")
      .eq("is_active", true);

    // 候補一覧を Claudeへ渡すテキストに整形
    const candidateLines: string[] = [];
    if (mappings && mappings.length > 0) {
      const seen = new Set<string>();
      for (const m of mappings) {
        const candidates = m.candidate_diagnoses as {
          code: string; name: string; short: string;
        }[];
        for (const c of candidates) {
          if (!seen.has(c.code)) {
            seen.add(c.code);
            candidateLines.push(`  ${c.short}（${c.name}）code:${c.code}`);
          }
        }
      }
    }

    // 2. 症状サマリーを作成
    const symptomSummary = buildSymptomSummary(
      chief_complaint || "",
      branch_answers || {}
    );

    // pain_types / pain_location / symptom_onset も補足として追加（後方互換）
    const extras: string[] = [];
    if (pain_types && pain_types.length > 0) {
      extras.push(`痛みの種類: ${pain_types.join("、")}`);
    }
    if (pain_location) {
      const locs = Array.isArray(pain_location) ? pain_location : [pain_location];
      extras.push(`部位: ${locs.join("、")}`);
    }
    if (pain_level !== undefined) extras.push(`痛みの強さ: ${pain_level}/10`);
    if (symptom_onset) extras.push(`発症時期: ${symptom_onset}`);

    // 3. GPT-4oで傷病名を動的判断
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const systemPrompt = `あなたは歯科医師のアシスタントAIです。
患者の問診回答から、最も可能性の高い傷病名候補を最大5つ選んでください。

ルール:
- 必ずJSONのみ返す（マークダウン不要）
- 候補一覧から選ぶが、候補にない場合は歯科の知識から追加してよい
- probabilityは0.0〜0.99（合計が1を超えてもよい）
- reasonは日本語で15字以内

出力形式:
{
  "predictions": [
    {
      "code": "候補のcode（候補外の場合はshort名をそのまま）",
      "name": "傷病名（日本語）",
      "short": "レセプト略称",
      "probability": 0.0〜0.99,
      "reason": "選んだ理由（15字以内）"
    }
  ]
}`;

    const userContent = `以下の患者の問診回答から傷病名候補を選んでください。

${symptomSummary}
${extras.length > 0 ? "\n補足情報:\n" + extras.map((e) => "  " + e).join("\n") : ""}

参考にできる傷病名候補一覧（symptom_diagnosis_mappingより）:
${candidateLines.length > 0 ? candidateLines.join("\n") : "（データなし）"}

上記候補から最も可能性の高いものを最大5つ選び、確率と理由を付けてJSON形式で返してください。`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 600,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    const rawText = completion.choices[0]?.message?.content?.trim() || "{}";

    let predictions: {
      code: string; name: string; short: string; probability: number; reason?: string;
    }[] = [];

    try {
      const parsed = JSON.parse(rawText);
      predictions = parsed.predictions || [];
    } catch {
      console.error("GPT-4o parse error:", rawText);
      // フォールバック：symptom_diagnosis_mappingの単純マッチ（既存ロジック）
      predictions = fallbackMatch(chief_complaint, pain_types, mappings || []);
    }

    // 4. 部位推定
    let estimatedArea = "";
    if (pain_location) {
      const locs = Array.isArray(pain_location) ? pain_location : [pain_location];
      estimatedArea = locs.join(", ");
    } else if (branch_answers?.["location"]) {
      estimatedArea = String(branch_answers["location"]);
    }

    return NextResponse.json({
      predictions,
      estimated_area: estimatedArea,
      input: { chief_complaint, pain_types, pain_location, pain_level, symptom_onset },
    });
  } catch (e) {
    console.error("predict-diagnosis error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── フォールバック（Claude失敗時の最低限マッチ） ─────────────────────────
// ハードコードではなく、DBのsymptom_diagnosis_mappingのみを使う

function fallbackMatch(
  chiefComplaint: string | undefined,
  painTypes: string[] | undefined,
  mappings: Record<string, unknown>[]
): { code: string; name: string; short: string; probability: number }[] {
  const scoreMap: Record<string, { code: string; name: string; short: string; probability: number }> = {};
  const searchTexts = [chiefComplaint, ...(painTypes || [])].filter(Boolean) as string[];
  const searchAll = searchTexts.join(" ").toLowerCase();

  for (const mapping of mappings) {
    const keyword = (mapping.symptom_keyword as string).toLowerCase();
    if (!searchAll.includes(keyword) && !keyword.includes(searchAll)) continue;

    const candidates = mapping.candidate_diagnoses as {
      code: string; name: string; short: string; probability: number;
    }[];
    for (const c of candidates) {
      if (!scoreMap[c.code]) {
        scoreMap[c.code] = { code: c.code, name: c.name, short: c.short, probability: 0 };
      }
      scoreMap[c.code].probability += c.probability;
    }
  }

  return Object.values(scoreMap)
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 5)
    .map((p) => ({ ...p, probability: Math.min(Math.round(p.probability * 100) / 100, 0.99) }));
}
