import { verifyAuth } from "@/lib/api-auth";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ─── branch_answers を医師が読める自然言語に変換 ────────────────────────────
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

const ANSWER_LABELS: Record<string, Record<string, string>> = {
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
  location: {
    whole: "歯ぐき全体", one_tooth: "1本の歯の周り",
    cheek: "頬まで腫れている", unknown: "不明",
    front: "前歯", back: "奥歯", both: "前歯と奥歯",
  },
  pain: { strong: "強く痛い", little: "少し痛い", none: "痛みなし", pain: "痛みあり", shimi: "しみる" },
  bite_pain: { yes: "咬合痛あり", no: "咬合痛なし" },
  loose: { yes: "動揺あり", no: "動揺なし", unknown: "不明" },
  recurrence: { yes: "再発あり", no: "初回", unknown: "不明" },
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
      const labels = val.map((v) => ANSWER_LABELS[key]?.[v] || v).filter(Boolean).join("、");
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
    const { user, error: authError } = await verifyAuth(request);
    if (authError) return authError;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await request.json();

    const {
      chief_complaint,
      pain_types,
      pain_location,
      pain_level,
      symptom_onset,
      branch_answers,
    } = body as {
      chief_complaint?: string;
      pain_types?: string[];
      pain_location?: string | string[];
      pain_level?: number | string;
      symptom_onset?: string;
      branch_answers?: Record<string, unknown>;
    };

    if (!chief_complaint && (!pain_types || pain_types.length === 0)) {
      return NextResponse.json(
        { error: "chief_complaint or pain_types required" },
        { status: 400 }
      );
    }

    // 予防系は傷病名予測不要
    const NON_DIAGNOSTIC = ["kenshin", "whitening", "ceramic"];
    if (chief_complaint && NON_DIAGNOSTIC.includes(chief_complaint)) {
      return NextResponse.json({ predictions: [], message: "Non-diagnostic branch" });
    }

    // symptom_diagnosis_mappingは廃止。
    // m_diagnosesから歯科傷病名を取得してGPT-4oの候補として使用する
    const symptomSummary = buildSymptomSummary(
      chief_complaint || "",
      branch_answers || {}
    );

    // m_diagnosesから歯科傷病名を候補として取得
    // 歯科傷病名はICD10コードのK00〜K14（口腔・唾液腺・顎の疾患）が中心
    const { data: diagnosisData } = await supabase
      .from("m_diagnoses")
      .select("diagnosis_code, diagnosis_name, abbreviation, icd10_code")
      .eq("is_active", true)
      .or("icd10_code.like.K0%,icd10_code.like.K1%,icd10_code.like.S0%")
      .limit(300);

    const candidateLines: string[] = [];
    if (diagnosisData && diagnosisData.length > 0) {
      for (const d of diagnosisData) {
        const short = d.abbreviation || d.diagnosis_name;
        candidateLines.push(`  ${short}（${d.diagnosis_name}）code:${d.diagnosis_code}`);
      }
    }

    const extras: string[] = [];
    if (pain_types && pain_types.length > 0) extras.push(`痛みの種類: ${pain_types.join("、")}`);
    if (pain_location) {
      const locs = Array.isArray(pain_location) ? pain_location : [pain_location];
      extras.push(`部位: ${locs.join("、")}`);
    }
    if (pain_level !== undefined) extras.push(`痛みの強さ: ${pain_level}/10`);
    if (symptom_onset) extras.push(`発症時期: ${symptom_onset}`);

    const systemPrompt = `あなたは歯科医師のアシスタントAIです。
患者の問診回答から、最も可能性の高い傷病名候補を最大5つ選んでください。

出力形式（JSONのみ・余分な説明不要）:
{
  "predictions": [
    {
      "code": "候補のcode（候補外の場合はshort名をそのまま）",
      "name": "傷病名（日本語）",
      "short": "レセプト略称",
      "probability": 0.0から0.99の数値,
      "reason": "選んだ理由（15字以内）"
    }
  ]
}

ルール:
- 候補一覧から選ぶが、候補にない場合は歯科の知識から追加してよい
- probabilityは0.0〜0.99（合計が1を超えてもよい）
- reasonは日本語で15字以内`;

    const userContent = `以下の患者の問診回答から傷病名候補を選んでください。

${symptomSummary}
${extras.length > 0 ? "\n補足情報:\n" + extras.map((e) => "  " + e).join("\n") : ""}

参考にできる傷病名候補一覧（m_diagnosesより・歯科関連）:
${candidateLines.length > 0 ? candidateLines.slice(0, 150).join("\n") : "（データなし）"}

上記候補から最も可能性の高いものを最大5つ選び、確率と理由を付けてJSON形式で返してください。`;

    // GPT-4oで傷病名を動的判断（fetchで直接呼び出し・SDKは使わない）
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
      }),
    });

    let predictions: {
      code: string; name: string; short: string; probability: number; reason?: string;
    }[] = [];

    if (openaiRes.ok) {
      const openaiData = await openaiRes.json();
      const rawText = openaiData.choices[0]?.message?.content || "{}";
      try {
        const parsed = JSON.parse(rawText);
        predictions = parsed.predictions || [];
      } catch {
        predictions = [];
      }
    }

    // 部位推定
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

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "predict-diagnosis エラー", detail: msg }, { status: 500 });
  }
}
