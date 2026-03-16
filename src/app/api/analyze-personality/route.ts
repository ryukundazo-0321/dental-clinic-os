import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ─── 型定義 ────────────────────────────────────────────────────────────────

interface ProfileAnswers {
  dental_fear?: string;
  tension_level?: number;
  pain_anxiety?: string;
  explanation_style?: string;
  conversation_style?: string;
  treatment_priority?: string;
  investment_attitude?: string;
  budget_range?: string;
  multi_tooth_policy?: string;
  most_important?: string;
}

interface MedicalAnswers {
  medications?: string;
  medication_names?: string;
  blood_thinner?: string;
  diseases?: string[];
  osteoporosis_drug?: string;
  drug_allergy?: string;
  allergy_detail?: string;
  anesthesia_bad?: string;
  bleeding_hard?: string;
  pregnancy?: string;
  breastfeeding?: string;
  infection?: string[];
  smoking?: string;
  condition_today?: string;
}

export interface PersonalityProfile {
  anxiety_level: "high" | "medium" | "low";
  anxiety_label: string;
  jishu_potential: "high" | "medium" | "low";
  jishu_label: string;
  comm_style: "detail" | "simple" | "quick";
  comm_label: string;
  action_tips: string[];
  one_line: string;
  safety_alerts: string[];
  analyzed_at: string;
  raw_profile_answers: ProfileAnswers;
  raw_medical_answers: MedicalAnswers;
}

// ─── 医療安全アラート：コードで確定生成（AIに依存しない） ─────────────────

function buildSafetyAlerts(medical: MedicalAnswers): string[] {
  const alerts: string[] = [];

  if (medical.diseases?.includes("diabetes"))
    alerts.push("糖尿病あり（感染リスク・創傷治癒遅延）");
  if (medical.blood_thinner === "yes")
    alerts.push(`抗凝固薬服用あり${medical.medication_names ? "（" + medical.medication_names + "）" : ""}｜抜歯・外科処置で出血リスク`);
  if (medical.osteoporosis_drug && !["none", "unknown"].includes(medical.osteoporosis_drug))
    alerts.push("骨粗しょう症薬使用あり｜BRONJ/MONJリスク・外科前に主治医確認推奨");
  if (medical.drug_allergy === "yes")
    alerts.push(`薬剤アレルギー歴あり${medical.allergy_detail ? "（" + medical.allergy_detail + "）" : "（詳細要確認）"}`);
  if (medical.anesthesia_bad === "yes")
    alerts.push("歯科麻酔で気分不良の既往｜投与速度・量に配慮");
  if (medical.bleeding_hard === "yes")
    alerts.push("出血が止まりにくい既往｜外科処置前に確認");
  if (medical.pregnancy === "pregnant")
    alerts.push("妊娠中｜X線・薬剤・侵襲的処置に配慮");
  if (medical.pregnancy === "maybe")
    alerts.push("妊娠の可能性あり｜処置・薬剤に配慮");
  if (medical.breastfeeding === "yes")
    alerts.push("授乳中｜使用薬剤に配慮");
  if (medical.diseases?.includes("heart"))
    alerts.push("心臓病・不整脈あり｜エピネフリン含有麻酔薬に注意");
  if (medical.diseases?.includes("kidney"))
    alerts.push("腎臓病あり｜NSAIDs・抗菌薬の用量調整要確認");
  if (medical.infection?.includes("hbv")) alerts.push("B型肝炎既往｜感染予防対策を徹底");
  if (medical.infection?.includes("hcv")) alerts.push("C型肝炎既往｜感染予防対策を徹底");
  if (medical.infection?.includes("hiv")) alerts.push("HIV既往｜感染予防対策を徹底");

  return alerts;
}

// ─── プロファイルを自然言語サマリーに変換 ────────────────────────────────

function buildProfileSummary(p: ProfileAnswers, m: MedicalAnswers): string {
  const FEAR: Record<string, string> = { very: "とても苦手", little: "少し苦手", normal: "普通", fine: "苦手ではない" };
  const PAIN_ANX: Record<string, string> = { very: "とても不安", little: "少し不安", not_much: "あまりない", none: "全くない" };
  const EXP: Record<string, string> = { detail: "詳しく説明してほしい", simple: "必要なことだけ", quick: "なるべく早く終わってほしい" };
  const CONV: Record<string, string> = { chatty: "会話がある方が安心", quiet: "必要最低限で良い" };
  const PRIORITY: Record<string, string> = { cost: "費用を抑えたい", durability: "長持ちを重視", aesthetic: "見た目を重視", painless: "痛くないことを重視", speed: "早く終わることを重視" };
  const INVEST: Record<string, string> = { minimum: "必要最低限でよい", if_needed: "必要な治療なら検討する", good_ok: "良い治療なら費用がかかっても検討したい", best: "できるだけ良い治療を受けたい" };
  const BUDGET: Record<string, string> = { "1man": "〜1万円", "3man": "〜3万円", "10man": "〜10万円", "30man": "10〜30万円", over30man: "30万円以上", unknown: "不明" };
  const MULTI: Record<string, string> = { pain_only: "痛いところだけ", stepwise: "順番に治療", all: "全体的に治療したい", after_consult: "医師の提案を聞いて決めたい" };
  const IMPORTANT: Record<string, string> = { painless: "痛くないこと", explanation: "丁寧な説明", speed: "早く終わること", advanced: "最新の治療", safety: "安心感" };

  return [
    `歯科の苦手意識: ${FEAR[p.dental_fear || ""] || "未回答"}`,
    `緊張度: ${p.tension_level ?? "未回答"}/10`,
    `痛みへの不安: ${PAIN_ANX[p.pain_anxiety || ""] || "未回答"}`,
    `説明スタイル希望: ${EXP[p.explanation_style || ""] || "未回答"}`,
    `会話スタイル希望: ${CONV[p.conversation_style || ""] || "未回答"}`,
    `治療の優先事項: ${PRIORITY[p.treatment_priority || ""] || "未回答"}`,
    `治療への投資意識: ${INVEST[p.investment_attitude || ""] || "未回答"}`,
    `想定予算: ${BUDGET[p.budget_range || ""] || "未回答"}`,
    `複数歯に問題時: ${MULTI[p.multi_tooth_policy || ""] || "未回答"}`,
    `歯科医院で一番大事なこと: ${IMPORTANT[p.most_important || ""] || "未回答"}`,
    ``,
    `服薬: ${m.medications === "yes" ? `あり（${m.medication_names || "詳細不明"}）` : "なし"}`,
    `抗凝固薬: ${m.blood_thinner === "yes" ? "服用あり" : "なし"}`,
    `既往歴: ${(m.diseases || []).join("、") || "特になし"}`,
    `薬剤アレルギー: ${m.drug_allergy === "yes" ? `あり（${m.allergy_detail || "詳細不明"}）` : "なし"}`,
    `妊娠: ${m.pregnancy === "pregnant" ? "妊娠中" : m.pregnancy === "maybe" ? "可能性あり" : "なし"}`,
    `喫煙: ${m.smoking === "current" ? "現在喫煙中" : m.smoking === "former" ? "過去に喫煙" : "なし"}`,
    `本日の体調: ${m.condition_today === "good" ? "良好" : m.condition_today === "bit_bad" ? "少し不調" : m.condition_today === "treating" ? "治療中の病気あり" : "未回答"}`,
  ].join("\n");
}

// ─── API ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { patient_id, profile_answers, medical_answers }: {
      patient_id?: string;
      profile_answers: ProfileAnswers;
      medical_answers: MedicalAnswers;
    } = body;

    if (!profile_answers) {
      return NextResponse.json({ error: "profile_answers is required" }, { status: 400 });
    }

    const medical = medical_answers || {};

    // 医療安全アラートはコードで確定生成（AIに依存しない）
    const safetyAlerts = buildSafetyAlerts(medical);

    const profileSummary = buildProfileSummary(profile_answers, medical);

    const systemPrompt = `あなたは歯科クリニックのスタッフ向けに患者プロファイルを分析するAIです。
患者の問診回答から、診察前にスタッフが把握すべき患者特性をJSONで出力してください。

出力形式（JSONのみ・余分な説明不要）:
{
  "anxiety_level": "high" または "medium" または "low",
  "anxiety_label": "歯科不安度のラベル（例：かなり不安、やや不安、落ち着いている）",
  "jishu_potential": "high" または "medium" または "low",
  "jishu_label": "自費提案適性のラベル（例：自費積極検討、条件次第で検討、保険診療優先）",
  "comm_style": "detail" または "simple" または "quick",
  "comm_label": "コミュニケーションスタイルのラベル",
  "action_tips": ["推奨アクション1（20字以内）", "推奨アクション2（20字以内）", "推奨アクション3（20字以内）"],
  "one_line": "患者の特徴を端的に表す一言（40字以内）"
}

判断基準:
- anxiety_level high: 緊張度7以上 OR 歯科がとても苦手 OR 痛みにとても不安
- anxiety_level low: 緊張度3以下 かつ 苦手ではない/普通 かつ 痛み不安なし/あまりない
- jishu_potential high: 投資意識が「良い治療なら検討」以上 かつ 予算10万円以上
- jishu_potential low: 投資意識が「必要最低限」または 予算〜3万円以下
- action_tipsは「〜してください」形式の具体的なスタッフ行動を3つ`;

    // GPT-4oでパーソナリティー分析（fetchで直接呼び出し）
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 700,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `以下の患者プロファイルを分析してください:\n\n${profileSummary}` },
        ],
      }),
    });

    let aiResult: Omit<PersonalityProfile, "safety_alerts" | "analyzed_at" | "raw_profile_answers" | "raw_medical_answers">;

    if (openaiRes.ok) {
      const openaiData = await openaiRes.json();
      const rawText = openaiData.choices[0]?.message?.content || "{}";
      try {
        aiResult = JSON.parse(rawText);
      } catch {
        console.error("GPT-4o personality parse error:", rawText);
        aiResult = getDefaultProfile();
      }
    } else {
      console.error("OpenAI API error:", await openaiRes.text());
      aiResult = getDefaultProfile();
    }

    const result: PersonalityProfile = {
      ...aiResult,
      safety_alerts: safetyAlerts,
      analyzed_at: new Date().toISOString(),
      raw_profile_answers: profile_answers,
      raw_medical_answers: medical,
    };

    // patient_idがある場合のみDBに保存
    if (patient_id) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { error } = await supabase
        .from("patients")
        .update({ personality_profile: result })
        .eq("id", patient_id);

      if (error) {
        console.error("personality_profile save error:", error);
        // DB保存失敗でもAPIレスポンスは返す
      }
    }

    return NextResponse.json(result);
  } catch (err) {
    console.error("analyze-personality error:", err);
    return NextResponse.json({ error: "分析に失敗しました", details: String(err) }, { status: 500 });
  }
}

function getDefaultProfile() {
  return {
    anxiety_level: "medium" as const,
    anxiety_label: "やや不安",
    jishu_potential: "medium" as const,
    jishu_label: "条件次第で検討",
    comm_style: "simple" as const,
    comm_label: "必要なことを丁寧に",
    action_tips: ["丁寧な声がけを心がけてください", "治療前に流れを説明してください", "患者のペースに合わせてください"],
    one_line: "プロファイル分析中。丁寧な対応を心がけてください。",
  };
}
