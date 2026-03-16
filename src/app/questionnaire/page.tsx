"use client";

import { useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";

// ─── 型定義 ────────────────────────────────────────────────────────────────

type ChiefComplaintType =
  | "shimi" | "kamu_ita" | "hareguki" | "shukketsu"
  | "toreta" | "kekka" | "kenshin" | "whitening"
  | "ceramic" | "hagishiri";

type Phase = "welcome" | "q1" | "branch" | "medical_safety" | "profile" | "complete";

interface Answers {
  chief_complaint?: ChiefComplaintType;
  branch_answers: Record<string, string | string[]>;
  medical: {
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
  };
  profile: {
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
  };
}

interface Option { value: string; label: string }

interface SubQuestion {
  key: string;
  question: string;
  type: "single" | "multi" | "text";
  options?: Option[];
  sub?: string;
}

// ─── 症状ブランチ別サブ質問（PDFの詳細設計書に基づく） ───────────────────

const BRANCH_QUESTIONS: Record<ChiefComplaintType, SubQuestion[]> = {
  shimi: [
    { key: "trigger", question: "どのような時にしみますか？", type: "multi",
      options: [{ value: "cold_water", label: "冷たい水" }, { value: "ice", label: "アイス" }, { value: "brush", label: "歯ブラシ" }, { value: "air", label: "空気" }, { value: "hot", label: "温かいものでもしみる" }] },
    { key: "duration", question: "しみた後どのくらい続きますか？", type: "single",
      options: [{ value: "instant", label: "すぐ消える" }, { value: "seconds", label: "数秒続く" }, { value: "sec30", label: "30秒以上続く" }, { value: "long", label: "長く続く" }] },
    { key: "progression", question: "最近しみ方は強くなっていますか？", type: "single",
      options: [{ value: "worse", label: "強くなっている" }, { value: "same", label: "変わらない" }, { value: "unknown", label: "分からない" }] },
    { key: "night_pain", question: "夜に痛むことはありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }] },
    { key: "spontaneous", question: "何もしなくても痛むことはありますか？（自発痛）", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }] },
  ],
  kamu_ita: [
    { key: "timing", question: "どのような時に痛みますか？", type: "single",
      options: [{ value: "bite", label: "噛んだ瞬間" }, { value: "release", label: "噛んで離した瞬間" }, { value: "constant", label: "常に違和感" }] },
    { key: "severity", question: "硬いものを噛んだ時の痛みはどの程度ですか？", type: "single",
      options: [{ value: "mild", label: "軽く痛い" }, { value: "clear", label: "はっきり痛い" }, { value: "severe", label: "強く痛くて噛めない" }] },
    { key: "only_hard", question: "硬いものだけで痛いですか？", type: "single",
      options: [{ value: "yes", label: "はい" }, { value: "no", label: "いいえ" }] },
    { key: "nerve_treated", question: "その歯は神経の治療をしていますか？", type: "single",
      options: [{ value: "yes", label: "はい" }, { value: "no", label: "いいえ" }, { value: "unknown", label: "分からない" }] },
    { key: "crown", question: "被せ物は入っていますか？", type: "single",
      options: [{ value: "yes", label: "入っている" }, { value: "no", label: "入っていない" }, { value: "unknown", label: "分からない" }] },
    { key: "swelling", question: "腫れた感じはありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }] },
    { key: "pus", question: "膿が出る感じはありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "分からない" }] },
    { key: "smell", question: "変なにおいや味を感じることがありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }] },
    { key: "press_pain", question: "その部分を押すと痛いですか？", type: "single",
      options: [{ value: "yes", label: "はい" }, { value: "no", label: "いいえ" }] },
  ],
  hareguki: [
    { key: "location", question: "腫れている場所はどこですか？", type: "single",
      options: [{ value: "whole", label: "歯ぐき全体" }, { value: "one_tooth", label: "1本の歯の周り" }, { value: "cheek", label: "頬まで腫れている" }, { value: "unknown", label: "分からない" }] },
    { key: "pain", question: "痛みはありますか？", type: "single",
      options: [{ value: "strong", label: "強く痛い" }, { value: "little", label: "少し痛い" }, { value: "none", label: "痛くない" }] },
    { key: "bite_pain", question: "噛むと痛いですか？", type: "single",
      options: [{ value: "yes", label: "はい" }, { value: "no", label: "いいえ" }] },
    { key: "pus", question: "膿が出る感じはありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "分からない" }] },
    { key: "press_pain", question: "その部分を押すと痛いですか？", type: "single",
      options: [{ value: "yes", label: "はい" }, { value: "no", label: "いいえ" }] },
    { key: "loose", question: "その歯が揺れている感じはありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "分からない" }] },
    { key: "recurrence", question: "以前にも同じように腫れたことがありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "分からない" }] },
  ],
  shukketsu: [
    { key: "timing", question: "いつ出血しますか？", type: "multi",
      options: [{ value: "brushing", label: "歯磨きの時" }, { value: "floss", label: "フロスの時" }, { value: "eating", label: "食事中" }, { value: "spontaneous", label: "何もしなくても" }] },
    { key: "location", question: "出血する場所はどこですか？", type: "single",
      options: [{ value: "whole", label: "全体" }, { value: "partial", label: "一部" }] },
    { key: "swelling", question: "歯ぐきが腫れることはありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }] },
  ],
  toreta: [
    { key: "type", question: "取れたものはどちらですか？", type: "single",
      options: [{ value: "filling", label: "詰め物" }, { value: "crown", label: "被せ物" }, { value: "unknown", label: "分からない" }] },
    { key: "have_it", question: "取れたものは手元にありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "分からない" }] },
    { key: "pain", question: "痛みはありますか？", type: "single",
      options: [{ value: "pain", label: "痛みがある" }, { value: "shimi", label: "しみる" }, { value: "none", label: "ない" }] },
    { key: "bite", question: "取れた歯で噛めますか？", type: "single",
      options: [{ value: "yes", label: "噛める" }, { value: "little", label: "少し痛い" }, { value: "no", label: "噛めない" }] },
    { key: "wish", question: "今回どのような対応を希望しますか？", type: "single",
      options: [{ value: "restore", label: "元に戻してほしい" }, { value: "emergency", label: "応急処置" }, { value: "redo", label: "新しくやり直したい" }, { value: "consult", label: "相談して決めたい" }] },
    { key: "aesthetic", question: "見た目をきれいにしたい希望はありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }] },
  ],
  kekka: [
    { key: "location", question: "歯がない場所はどこですか？", type: "single",
      options: [{ value: "front", label: "前歯" }, { value: "back", label: "奥歯" }, { value: "both", label: "前歯と奥歯の両方" }, { value: "all", label: "すべての歯" }] },
    { key: "timing", question: "歯が抜けたのはいつ頃ですか？", type: "single",
      options: [{ value: "recent", label: "最近（1か月以内）" }, { value: "months", label: "数か月前" }, { value: "year", label: "1年以上前" }, { value: "long", label: "かなり前" }] },
    { key: "current", question: "現在その場所には何か入っていますか？", type: "single",
      options: [{ value: "denture", label: "入れ歯" }, { value: "bridge", label: "ブリッジ" }, { value: "implant", label: "インプラント" }, { value: "none", label: "何も入っていない" }] },
    { key: "trouble", question: "現在の歯で困っていることはありますか？", type: "multi",
      options: [{ value: "loose", label: "よく外れる" }, { value: "cant_bite", label: "噛みにくい" }, { value: "pain", label: "痛い" }, { value: "aesthetic", label: "見た目が気になる" }, { value: "none", label: "特に困っていない" }] },
    { key: "removable_ok", question: "取り外し式の歯（入れ歯）について", type: "single",
      options: [{ value: "ok", label: "問題ない" }, { value: "avoid_if", label: "できれば避けたい" }, { value: "no", label: "取り外し式は避けたい" }] },
    { key: "surgery_ok", question: "手術を伴う治療（インプラント）について", type: "single",
      options: [{ value: "ok", label: "問題ない" }, { value: "nervous", label: "少し不安" }, { value: "no", label: "手術は避けたい" }] },
    { key: "wish", question: "今のお気持ちに一番近いものを教えてください", type: "single",
      options: [{ value: "denture", label: "入れ歯を希望している" }, { value: "bridge", label: "ブリッジを希望している" }, { value: "implant", label: "インプラントを希望している" }, { value: "consult", label: "まだ決めていないので相談したい" }] },
    { key: "priority", question: "治療で一番大事にしたいことは何ですか？", type: "single",
      options: [{ value: "function", label: "よく噛めること" }, { value: "aesthetic", label: "見た目" }, { value: "cost", label: "費用" }, { value: "period", label: "治療期間" }, { value: "no_surgery", label: "手術を避けたい" }] },
  ],
  kenshin: [
    { key: "purpose", question: "今回の来院目的はどれに近いですか？", type: "multi",
      options: [{ value: "checkup", label: "定期検診" }, { value: "cleaning", label: "歯石・クリーニング" }, { value: "stain", label: "着色を取りたい" }, { value: "odor", label: "口臭が気になる" }, { value: "gum", label: "歯ぐきの状態をチェックしたい" }, { value: "overall", label: "全体をチェックしてほしい" }] },
    { key: "last_visit", question: "最後に歯科医院を受診したのはいつですか？", type: "single",
      options: [{ value: "3months", label: "3か月以内" }, { value: "6months", label: "半年以内" }, { value: "1year", label: "1年以内" }, { value: "over1year", label: "1年以上前" }] },
    { key: "gum_symptom", question: "歯ぐきの症状はありますか？", type: "multi",
      options: [{ value: "bleeding", label: "歯磨きで出血する" }, { value: "swelling", label: "歯ぐきが腫れる" }, { value: "recession", label: "歯ぐきが下がってきた" }, { value: "none", label: "特にない" }] },
    { key: "stain", question: "歯の着色は気になりますか？", type: "single",
      options: [{ value: "very", label: "とても気になる" }, { value: "little", label: "少し気になる" }, { value: "none", label: "気にならない" }] },
    { key: "if_found", question: "もし虫歯など問題が見つかった場合", type: "single",
      options: [{ value: "today", label: "今日治療したい" }, { value: "later", label: "後日相談したい" }, { value: "checkup_only", label: "検診のみ希望" }] },
  ],
  whitening: [
    { key: "concern", question: "歯の色についてどの程度気になりますか？", type: "single",
      options: [{ value: "very", label: "とても気になる" }, { value: "little", label: "少し気になる" }, { value: "none", label: "気にならない" }] },
    { key: "goal", question: "歯をどのくらい白くしたいですか？", type: "single",
      options: [{ value: "natural", label: "自然な白さ" }, { value: "little_more", label: "今より少し白く" }, { value: "very_white", label: "かなり白く" }] },
    { key: "experience", question: "ホワイトニング経験はありますか？", type: "single",
      options: [{ value: "first", label: "初めて" }, { value: "done", label: "以前やったことがある" }] },
    { key: "type", question: "希望するホワイトニング", type: "single",
      options: [{ value: "clinic", label: "歯科医院で行うホワイトニング" }, { value: "home", label: "自宅で行うホワイトニング" }, { value: "consult", label: "相談して決めたい" }] },
    { key: "cause", question: "歯の着色原因で思い当たるもの", type: "multi",
      options: [{ value: "coffee", label: "コーヒー" }, { value: "tea", label: "紅茶" }, { value: "wine", label: "ワイン" }, { value: "smoke", label: "喫煙" }, { value: "none", label: "特にない" }] },
    { key: "sensitivity", question: "歯のしみやすさはありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "little", label: "少しある" }, { value: "none", label: "ない" }] },
  ],
  ceramic: [
    { key: "location", question: "気になるのはどこですか？", type: "single",
      options: [{ value: "front", label: "前歯" }, { value: "back", label: "奥歯" }, { value: "all", label: "全体" }] },
    { key: "reason", question: "気になる理由は何ですか？", type: "multi",
      options: [{ value: "silver", label: "銀歯を白くしたい" }, { value: "color", label: "歯の色" }, { value: "shape", label: "歯の形" }, { value: "chip", label: "欠けている" }, { value: "old", label: "詰め物が古い" }] },
    { key: "interest", question: "セラミック治療について", type: "single",
      options: [{ value: "detail", label: "詳しく説明を聞きたい" }, { value: "interested", label: "興味がある" }, { value: "not_now", label: "今は検討していない" }] },
    { key: "priority", question: "治療で優先したいこと", type: "single",
      options: [{ value: "aesthetic", label: "見た目" }, { value: "durability", label: "長持ち" }, { value: "cost", label: "費用" }, { value: "speed", label: "早さ" }] },
  ],
  hagishiri: [
    { key: "told", question: "歯ぎしりや食いしばりを指摘されたことがありますか？", type: "single",
      options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "わからない" }] },
    { key: "symptoms", question: "次の症状はありますか？", type: "multi",
      options: [{ value: "jaw_tired", label: "朝あごが疲れる" }, { value: "headache", label: "頭痛" }, { value: "shoulder", label: "肩こり" }, { value: "wear", label: "歯がすり減っている" }, { value: "filling_off", label: "詰め物がよく取れる" }] },
    { key: "mouthguard", question: "就寝時マウスピースを使用していますか？", type: "single",
      options: [{ value: "using", label: "使用している" }, { value: "used", label: "使用したことがある" }, { value: "never", label: "使用したことがない" }] },
    { key: "jaw_botox", question: "エラの張りが気になりますか？", type: "single",
      options: [{ value: "very", label: "とても気になる" }, { value: "little", label: "少し気になる" }, { value: "none", label: "気にならない" }] },
    { key: "botox_interest", question: "咬筋ボトックスについて", type: "single",
      options: [{ value: "interested", label: "興味がある" }, { value: "want_info", label: "説明を聞きたい" }, { value: "not_now", label: "今は考えていない" }] },
  ],
};

// ─── 全身問診（14問・条件分岐あり） ──────────────────────────────────────

interface MedicalQuestion {
  key: keyof Answers["medical"];
  question: string;
  type: "single" | "multi" | "text";
  options?: Option[];
  sub?: string;
  condition?: (m: Answers["medical"]) => boolean;
}

const MEDICAL_QUESTIONS: MedicalQuestion[] = [
  { key: "medications", question: "現在服用しているお薬はありますか？", type: "single",
    options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "分からない" }] },
  { key: "medication_names", question: "お薬の名前を分かる範囲でご記入ください", type: "text",
    sub: "分からない場合は「血圧の薬」など種類でもOKです",
    condition: (m) => m.medications === "yes" },
  { key: "blood_thinner", question: "血液をサラサラにする薬を飲んでいますか？", type: "single",
    sub: "例：ワーファリン、バイアスピリン、エリキュース など",
    options: [{ value: "yes", label: "飲んでいる" }, { value: "no", label: "飲んでいない" }, { value: "unknown", label: "分からない" }] },
  { key: "diseases", question: "これまでに診断されたご病気はありますか？", type: "multi",
    options: [
      { value: "hypertension", label: "高血圧" }, { value: "diabetes", label: "糖尿病" },
      { value: "heart", label: "心臓の病気" }, { value: "stroke", label: "脳梗塞・脳出血" },
      { value: "kidney", label: "腎臓病" }, { value: "liver", label: "肝臓病" },
      { value: "osteoporosis", label: "骨粗しょう症" }, { value: "cancer", label: "がん" },
      { value: "thyroid", label: "甲状腺の病気" }, { value: "none", label: "特にない" }, { value: "other", label: "その他" },
    ] },
  { key: "osteoporosis_drug", question: "骨粗しょう症の薬を使用していますか？", type: "single",
    sub: "例：ビスフォスフォネート（アクトネル・ボナロン）、デノスマブ など",
    options: [{ value: "oral", label: "飲み薬を使用している" }, { value: "injection", label: "注射薬を使用している" }, { value: "none", label: "使用していない" }, { value: "unknown", label: "分からない" }] },
  { key: "drug_allergy", question: "お薬や麻酔でアレルギーが出たことはありますか？", type: "single",
    options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "分からない" }] },
  { key: "allergy_detail", question: "どの薬でアレルギーが出ましたか？", type: "text",
    condition: (m) => m.drug_allergy === "yes" },
  { key: "anesthesia_bad", question: "歯科麻酔で気分が悪くなったことはありますか？", type: "single",
    options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "分からない" }] },
  { key: "bleeding_hard", question: "出血が止まりにくいことはありますか？", type: "single",
    options: [{ value: "yes", label: "ある" }, { value: "no", label: "ない" }, { value: "unknown", label: "分からない" }] },
  { key: "pregnancy", question: "現在妊娠していますか？（女性の方のみ）", type: "single",
    options: [{ value: "pregnant", label: "妊娠している" }, { value: "maybe", label: "妊娠の可能性がある" }, { value: "no", label: "妊娠していない" }] },
  { key: "breastfeeding", question: "授乳中ですか？", type: "single",
    options: [{ value: "yes", label: "はい" }, { value: "no", label: "いいえ" }] },
  { key: "infection", question: "感染症の既往はありますか？", type: "multi",
    options: [{ value: "hbv", label: "B型肝炎" }, { value: "hcv", label: "C型肝炎" }, { value: "hiv", label: "HIV" }, { value: "none", label: "特にない" }, { value: "unknown", label: "分からない" }] },
  { key: "smoking", question: "喫煙習慣はありますか？", type: "single",
    options: [{ value: "current", label: "吸っている" }, { value: "former", label: "以前吸っていた" }, { value: "never", label: "吸っていない" }] },
  { key: "condition_today", question: "現在の体調はいかがですか？", type: "single",
    options: [{ value: "good", label: "良好" }, { value: "bit_bad", label: "少し不調" }, { value: "treating", label: "治療中の病気がある" }] },
];

// ─── プロファイル問診（10問） ─────────────────────────────────────────────

interface ProfileQuestion {
  key: keyof Answers["profile"];
  question: string;
  type: "single" | "slider";
  options?: Option[];
  sub?: string;
}

const PROFILE_QUESTIONS: ProfileQuestion[] = [
  { key: "dental_fear", question: "歯医者は苦手ですか？", type: "single",
    options: [{ value: "very", label: "とても苦手" }, { value: "little", label: "少し苦手" }, { value: "normal", label: "普通" }, { value: "fine", label: "苦手ではない" }] },
  { key: "tension_level", question: "今どのくらい緊張していますか？", type: "slider",
    sub: "0（全く緊張していない）〜 10（非常に緊張）" },
  { key: "pain_anxiety", question: "治療の痛みに不安はありますか？", type: "single",
    options: [{ value: "very", label: "とても不安" }, { value: "little", label: "少し不安" }, { value: "not_much", label: "あまりない" }, { value: "none", label: "全くない" }] },
  { key: "explanation_style", question: "診療中の説明はどちらが良いですか？", type: "single",
    options: [{ value: "detail", label: "詳しく説明してほしい" }, { value: "simple", label: "必要なことだけ" }, { value: "quick", label: "なるべく早く終わってほしい" }] },
  { key: "conversation_style", question: "診療中の会話はどちらが良いですか？", type: "single",
    options: [{ value: "chatty", label: "会話がある方が安心" }, { value: "quiet", label: "必要最低限で良い" }] },
  { key: "treatment_priority", question: "治療で一番大事にしたいことは何ですか？", type: "single",
    options: [{ value: "cost", label: "費用" }, { value: "durability", label: "長持ち" }, { value: "aesthetic", label: "見た目" }, { value: "painless", label: "痛くない" }, { value: "speed", label: "早く終わる" }] },
  { key: "investment_attitude", question: "歯や健康への治療についてどのようにお考えですか？", type: "single",
    options: [
      { value: "minimum", label: "必要最低限でよい" },
      { value: "if_needed", label: "必要な治療なら検討する" },
      { value: "good_ok", label: "良い治療なら費用がかかっても検討したい" },
      { value: "best", label: "できるだけ良い治療を受けたい" },
    ] },
  { key: "budget_range", question: "歯の治療に使える費用の目安を教えてください", type: "single",
    options: [
      { value: "1man", label: "〜1万円" }, { value: "3man", label: "〜3万円" },
      { value: "10man", label: "〜10万円" }, { value: "30man", label: "10〜30万円" },
      { value: "over30man", label: "30万円以上" }, { value: "unknown", label: "分からない" },
    ] },
  { key: "multi_tooth_policy", question: "もし複数の歯に問題が見つかった場合", type: "single",
    options: [
      { value: "pain_only", label: "痛いところだけ治療したい" },
      { value: "stepwise", label: "必要なところは順番に治療したい" },
      { value: "all", label: "全体的にしっかり治療したい" },
      { value: "after_consult", label: "医師の提案を聞いて決めたい" },
    ] },
  { key: "most_important", question: "歯科医院で一番大事にしていることは？", type: "single",
    options: [{ value: "painless", label: "痛くないこと" }, { value: "explanation", label: "丁寧な説明" }, { value: "speed", label: "早く終わること" }, { value: "advanced", label: "最新の治療" }, { value: "safety", label: "安心感" }] },
];

// ─── メインコンポーネント ──────────────────────────────────────────────────

export default function QuestionnairePage() {
  const searchParams = useSearchParams();
  const appointmentId = searchParams.get("appointment_id");
  const patientId = searchParams.get("patient_id"); // なくても動く

  const [phase, setPhase] = useState<Phase>("welcome");
  const [answers, setAnswers] = useState<Answers>({
    branch_answers: {}, medical: {}, profile: {},
  });
  const [branchStep, setBranchStep] = useState(0);
  const [medicalStep, setMedicalStep] = useState(0);
  const [profileStep, setProfileStep] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fade, setFade] = useState(true);

  const go = useCallback((fn: () => void) => {
    setFade(false);
    setTimeout(() => { fn(); setFade(true); }, 200);
  }, []);

  const selectQ1 = (v: ChiefComplaintType) => {
    setAnswers((p) => ({ ...p, chief_complaint: v }));
    setBranchStep(0);
    go(() => setPhase("branch"));
  };

  const setBranchAnswer = (key: string, val: string | string[]) =>
    setAnswers((p) => ({ ...p, branch_answers: { ...p.branch_answers, [key]: val } }));

  const activeMedical = MEDICAL_QUESTIONS.filter(
    (q) => !q.condition || q.condition(answers.medical)
  );

  const nextBranch = () => {
    const qs = BRANCH_QUESTIONS[answers.chief_complaint!] || [];
    if (branchStep < qs.length - 1) go(() => setBranchStep((s) => s + 1));
    else go(() => { setMedicalStep(0); setPhase("medical_safety"); });
  };

  const nextMedical = () => {
    if (medicalStep < activeMedical.length - 1) go(() => setMedicalStep((s) => s + 1));
    else go(() => { setProfileStep(0); setPhase("profile"); });
  };

  const nextProfile = () => {
    if (profileStep < PROFILE_QUESTIONS.length - 1) go(() => setProfileStep((s) => s + 1));
    else submit(answers);
  };

  // ─── DB保存 + API呼び出し ───────────────────────────────────────────────
  const submit = useCallback(async (finalAnswers: Answers) => {
    setIsSubmitting(true);
    try {
      const supabase = createClient();

      // 1. questionnaire_responses に保存
      const { data: qr, error } = await supabase
        .from("questionnaire_responses")
        .insert({
          appointment_id: appointmentId || null,
          patient_id: patientId || null,
          questionnaire_type: "initial",
          input_method: "web",
          chief_complaint: finalAnswers.chief_complaint || "",
          pain_types: Array.isArray(finalAnswers.branch_answers["trigger"])
            ? finalAnswers.branch_answers["trigger"] : [],
          pain_location: (finalAnswers.branch_answers["location"] as string) || "",
          // 詳細回答を全格納 → 診察ページのSOAP-Sに自動反映される
          diagnosis_tree_answers: {
            chief_complaint: finalAnswers.chief_complaint,
            branch_answers: finalAnswers.branch_answers,
          },
          profile_answers: finalAnswers.profile,
          submitted_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      // 2. 傷病名予測（症状系ブランチのみ）
      // branch_answersを全部渡す → predict-diagnosis内でClaudeが自然言語として解釈
      const NON_DIAGNOSTIC = ["kenshin", "whitening", "ceramic"];
      const isPainBranch = !NON_DIAGNOSTIC.includes(finalAnswers.chief_complaint || "");

      if (isPainBranch) {
        // awaitしない（バックグラウンド実行、完了画面表示をブロックしない）
        fetch("/api/predict-diagnosis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chief_complaint: finalAnswers.chief_complaint,
            // 後方互換のために従来パラメータも渡す
            pain_types: Array.isArray(finalAnswers.branch_answers["trigger"])
              ? finalAnswers.branch_answers["trigger"] : [],
            pain_location: finalAnswers.branch_answers["location"] || "",
            // 詳細回答 → Claudeが読んで動的に傷病名を判断する
            branch_answers: finalAnswers.branch_answers,
            questionnaire_response_id: qr?.id,
            patient_id: patientId || null,
          }),
        }).catch((e) => console.error("predict-diagnosis error:", e));
      }

      // 3. パーソナリティー分析（全患者対象）
      // awaitしない（バックグラウンド実行）
      // patient_idがなくてもAPIは動く（DBへの保存はスキップされるだけ）
      fetch("/api/analyze-personality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId || null,          // nullでも動く
          profile_answers: finalAnswers.profile,  // プロファイル10問の回答
          medical_answers: finalAnswers.medical,  // 全身問診14問の回答（医療安全アラート生成に使う）
        }),
      }).catch((e) => console.error("analyze-personality error:", e));

      go(() => setPhase("complete"));
    } catch (err) {
      console.error("問診保存エラー:", err);
      setIsSubmitting(false);
    }
  }, [appointmentId, patientId, go]);

  // プログレス計算
  let progress = 0;
  if (phase === "q1") progress = 5;
  else if (phase === "branch") {
    const qs = BRANCH_QUESTIONS[answers.chief_complaint!] || [];
    progress = 10 + Math.round((branchStep / Math.max(qs.length, 1)) * 25);
  } else if (phase === "medical_safety") {
    progress = 35 + Math.round((medicalStep / Math.max(activeMedical.length, 1)) * 35);
  } else if (phase === "profile") {
    progress = 70 + Math.round((profileStep / Math.max(PROFILE_QUESTIONS.length, 1)) * 28);
  } else if (phase === "complete") {
    progress = 100;
  }

  const branchQs = answers.chief_complaint ? BRANCH_QUESTIONS[answers.chief_complaint] : [];
  const branchQ = branchQs[branchStep];
  const medicalQ = activeMedical[medicalStep];
  const profileQ = PROFILE_QUESTIONS[profileStep];

  return (
    <div className="qr">
      <style>{CSS}</style>

      {phase !== "welcome" && (
        <header className="qr-header">
          <div className="qr-logo">🦷 Dental Clinic OS</div>
          <div className="qr-phase-label">
            {phase === "q1" && "主症状の確認"}
            {phase === "branch" && "症状の詳細"}
            {phase === "medical_safety" && "お体の状態の確認"}
            {phase === "profile" && "ご希望・ご状況"}
            {phase === "complete" && "完了"}
          </div>
          {phase !== "complete" && (
            <div className="qr-prog-wrap">
              <div className="qr-prog-bar">
                <div className="qr-prog-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="qr-prog-pct">{progress}%</div>
            </div>
          )}
        </header>
      )}

      <main className={`qr-card ${fade ? "fi" : "fo"}`}>

        {phase === "welcome" && (
          <div className="welcome">
            <span className="wi">🦷</span>
            <div className="wt">ご来院ありがとうございます</div>
            <div className="ws">より良い診察のために、簡単な問診にお答えください。<br />所要時間は約<strong>3〜5分</strong>です。</div>
            <div className="wb">
              <span>🔒 個人情報は安全に管理</span>
              <span>⏱ 約3〜5分</span>
              <span>📋 診察に活用されます</span>
            </div>
            <button className="btn-p" onClick={() => go(() => setPhase("q1"))}>問診を始める →</button>
          </div>
        )}

        {phase === "q1" && (
          <div>
            <div className="ql">Q1 / 主症状</div>
            <div className="qt">本日はどのような症状ですか？</div>
            <div className="qo">
              {([
                ["shimi",     "🥶", "冷たいものがしみる"],
                ["kamu_ita",  "😬", "噛むと痛い"],
                ["hareguki",  "🫦", "歯や歯ぐきが腫れている"],
                ["shukketsu", "🩸", "歯ぐきから出血する"],
                ["toreta",    "🦷", "詰め物・被せ物が取れた"],
                ["kekka",     "🔲", "歯がない場所の相談"],
                ["kenshin",   "😊", "クリーニング・定期検診"],
                ["whitening", "✨", "ホワイトニング"],
                ["ceramic",   "💎", "セラミック相談"],
                ["hagishiri", "😤", "歯ぎしり・食いしばり・ボトックス"],
              ] as [ChiefComplaintType, string, string][]).map(([v, icon, l]) => (
                <button key={v} className="qob" onClick={() => selectQ1(v)}>
                  <span className="qoi">{icon}</span>{l}
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "branch" && branchQ && (
          <BranchStep
            q={branchQ}
            step={branchStep}
            total={branchQs.length}
            val={answers.branch_answers[branchQ.key]}
            onSet={setBranchAnswer}
            onNext={nextBranch}
          />
        )}

        {phase === "medical_safety" && medicalQ && (
          <MedicalStep
            q={medicalQ}
            step={medicalStep}
            total={activeMedical.length}
            val={answers.medical[medicalQ.key as keyof Answers["medical"]]}
            onSet={(key, val) =>
              setAnswers((p) => ({ ...p, medical: { ...p.medical, [key]: val } }))
            }
            onNext={nextMedical}
          />
        )}

        {phase === "profile" && profileQ && (
          <ProfileStep
            q={profileQ}
            step={profileStep}
            total={PROFILE_QUESTIONS.length}
            val={answers.profile[profileQ.key as keyof Answers["profile"]]}
            onSet={(key, val) =>
              setAnswers((p) => ({ ...p, profile: { ...p.profile, [key]: val } }))
            }
            onNext={() => {
              if (profileStep === PROFILE_QUESTIONS.length - 1) submit({ ...answers });
              else nextProfile();
            }}
            isLast={profileStep === PROFILE_QUESTIONS.length - 1}
            isSubmitting={isSubmitting}
          />
        )}

        {phase === "complete" && (
          <div className="complete">
            <span className="ci">✅</span>
            <div className="ct">問診が完了しました</div>
            <div className="cs">ご回答ありがとうございました。<br />受付にお声がけいただくか、<br />お座席でスタッフをお待ちください。</div>
            <div className="cn">📋 ご回答内容は診察に活用されます<br />🔒 個人情報は適切に管理されます</div>
          </div>
        )}

      </main>
    </div>
  );
}

// ─── サブコンポーネント ────────────────────────────────────────────────────

function BranchStep({ q, step, total, val, onSet, onNext }: {
  q: SubQuestion; step: number; total: number;
  val: string | string[] | undefined;
  onSet: (key: string, val: string | string[]) => void;
  onNext: () => void;
}) {
  const [text, setText] = useState((val as string) || "");

  if (q.type === "single") return (
    <div>
      <div className="ql">症状の詳細 {step + 1}/{total}</div>
      <div className="qt">{q.question}</div>
      <div className="qo">
        {q.options!.map((o) => (
          <button key={o.value} className={`qob ${val === o.value ? "sel" : ""}`}
            onClick={() => { onSet(q.key, o.value); setTimeout(onNext, 150); }}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (q.type === "multi") {
    const arr = (Array.isArray(val) ? val : []) as string[];
    return (
      <div>
        <div className="ql">症状の詳細 {step + 1}/{total}</div>
        <div className="qt">{q.question}</div>
        <div className="qs">複数選択可</div>
        <div className="qg">
          {q.options!.map((o) => {
            const chk = arr.includes(o.value);
            return (
              <button key={o.value} className={`qcb ${chk ? "chk" : ""}`}
                onClick={() => onSet(q.key, chk ? arr.filter(v => v !== o.value) : [...arr, o.value])}>
                <span className="cki">{chk ? "✓" : ""}</span>{o.label}
              </button>
            );
          })}
        </div>
        <button className="btn-p" disabled={arr.length === 0} onClick={onNext}>次へ →</button>
      </div>
    );
  }

  return (
    <div>
      <div className="ql">症状の詳細 {step + 1}/{total}</div>
      <div className="qt">{q.question}</div>
      {q.sub && <div className="qs">{q.sub}</div>}
      <textarea className="qta" rows={3} value={text}
        onChange={(e) => { setText(e.target.value); onSet(q.key, e.target.value); }} />
      <button className="btn-p" disabled={!text.trim()} onClick={onNext}>次へ →</button>
      <div className="skip" onClick={onNext}>スキップする</div>
    </div>
  );
}

function MedicalStep({ q, step, total, val, onSet, onNext }: {
  q: MedicalQuestion; step: number; total: number;
  val: string | string[] | undefined;
  onSet: (key: keyof Answers["medical"], val: string | string[]) => void;
  onNext: () => void;
}) {
  const [text, setText] = useState((val as string) || "");

  if (q.type === "single") return (
    <div>
      <div className="ql">お体の状態 {step + 1}/{total}</div>
      <div className="qt">{q.question}</div>
      {q.sub && <div className="qs">{q.sub}</div>}
      <div className="qo">
        {q.options!.map((o) => (
          <button key={o.value} className={`qob ${val === o.value ? "sel" : ""}`}
            onClick={() => { onSet(q.key, o.value); setTimeout(onNext, 150); }}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (q.type === "multi") {
    const arr = (Array.isArray(val) ? val : []) as string[];
    return (
      <div>
        <div className="ql">お体の状態 {step + 1}/{total}</div>
        <div className="qt">{q.question}</div>
        <div className="qs">複数選択可</div>
        <div className="qg">
          {q.options!.map((o) => {
            const chk = arr.includes(o.value);
            return (
              <button key={o.value} className={`qcb ${chk ? "chk" : ""}`}
                onClick={() => onSet(q.key, chk ? arr.filter(v => v !== o.value) : [...arr, o.value])}>
                <span className="cki">{chk ? "✓" : ""}</span>{o.label}
              </button>
            );
          })}
        </div>
        <button className="btn-p" disabled={arr.length === 0} onClick={onNext}>次へ →</button>
      </div>
    );
  }

  return (
    <div>
      <div className="ql">お体の状態 {step + 1}/{total}</div>
      <div className="qt">{q.question}</div>
      {q.sub && <div className="qs">{q.sub}</div>}
      <textarea className="qta" rows={3} value={text}
        onChange={(e) => { setText(e.target.value); onSet(q.key, e.target.value); }} />
      <button className="btn-p" disabled={!text.trim()} onClick={onNext}>次へ →</button>
      <div className="skip" onClick={onNext}>スキップする</div>
    </div>
  );
}

function ProfileStep({ q, step, total, val, onSet, onNext, isLast, isSubmitting }: {
  q: ProfileQuestion; step: number; total: number;
  val: string | number | undefined;
  onSet: (key: keyof Answers["profile"], val: string | number) => void;
  onNext: () => void;
  isLast: boolean;
  isSubmitting: boolean;
}) {
  const [sliderVal, setSliderVal] = useState((val as number) ?? 5);

  if (q.type === "single") return (
    <div>
      <div className="ql">ご希望・ご状況 {step + 1}/{total}</div>
      <div className="qt">{q.question}</div>
      {q.sub && <div className="qs">{q.sub}</div>}
      <div className="qo">
        {q.options!.map((o) => (
          <button key={o.value} className={`qob ${val === o.value ? "sel" : ""}`}
            disabled={isSubmitting}
            onClick={() => { onSet(q.key, o.value); setTimeout(onNext, 150); }}>
            {o.label}
            {isSubmitting && val === o.value && <span className="spin" />}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div>
      <div className="ql">ご希望・ご状況 {step + 1}/{total}</div>
      <div className="qt">{q.question}</div>
      {q.sub && <div className="qs">{q.sub}</div>}
      <div className="sld-wrap">
        <input type="range" min={0} max={10} step={1} value={sliderVal} className="sld"
          onChange={(e) => { const n = Number(e.target.value); setSliderVal(n); onSet(q.key, n); }} />
        <div className="sld-row">
          <span>0<br /><small>リラックス</small></span>
          <span className="sld-val">{sliderVal}</span>
          <span style={{ textAlign: "right" }}>10<br /><small>非常に緊張</small></span>
        </div>
      </div>
      <button className="btn-p" disabled={isSubmitting} onClick={onNext}>
        {isLast ? (isSubmitting ? "送信中..." : "送信する ✓") : "次へ →"}
      </button>
    </div>
  );
}

// ─── CSS ──────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@300;400;500&family=Zen+Kaku+Gothic+New:wght@300;400;500;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
.qr{min-height:100vh;background:#f7f4ef;font-family:'Zen Kaku Gothic New','Noto Sans JP',sans-serif;color:#2d2926;display:flex;flex-direction:column;align-items:center;padding:0 16px 48px}
.qr-header{width:100%;max-width:600px;padding:20px 0 0}
.qr-logo{font-family:'Noto Serif JP',serif;font-size:12px;font-weight:300;color:#8a7e72;letter-spacing:.12em;margin-bottom:4px}
.qr-phase-label{font-size:12px;font-weight:700;letter-spacing:.14em;color:#b08d6e;text-transform:uppercase;display:block;margin-bottom:10px}
.qr-prog-wrap{width:100%}
.qr-prog-bar{width:100%;height:3px;background:#e2ddd7;border-radius:2px;overflow:hidden}
.qr-prog-fill{height:100%;background:linear-gradient(90deg,#b08d6e,#7a5c40);border-radius:2px;transition:width .5s cubic-bezier(.4,0,.2,1)}
.qr-prog-pct{font-size:11px;color:#a09488;text-align:right;margin-top:4px}
.qr-card{width:100%;max-width:600px;background:#fff;border-radius:16px;padding:32px 28px 28px;box-shadow:0 2px 24px rgba(45,41,38,.07);transition:opacity .2s ease,transform .2s ease;margin-top:16px}
.qr-card.fi{opacity:1;transform:translateY(0)}
.qr-card.fo{opacity:0;transform:translateY(8px)}
.ql{font-size:11px;font-weight:700;letter-spacing:.14em;color:#b08d6e;text-transform:uppercase;margin-bottom:8px}
.qt{font-family:'Noto Serif JP',serif;font-size:19px;font-weight:400;line-height:1.6;color:#2d2926;margin-bottom:6px}
.qs{font-size:13px;color:#8a7e72;margin-bottom:18px;line-height:1.6}
.qo{display:flex;flex-direction:column;gap:8px;margin-top:4px}
.qob{width:100%;padding:14px 18px;border:1.5px solid #e2ddd7;border-radius:10px;background:#fdfcfb;cursor:pointer;text-align:left;font-family:'Zen Kaku Gothic New',sans-serif;font-size:14px;color:#2d2926;transition:all .14s ease;display:flex;align-items:center;gap:10px}
.qob:hover:not(:disabled){border-color:#b08d6e;background:#fdf8f4;transform:translateX(2px)}
.qob.sel{border-color:#b08d6e;background:#fdf3eb;color:#7a5c40;font-weight:500}
.qob:disabled{opacity:.5;cursor:not-allowed}
.qoi{font-size:17px;flex-shrink:0;width:24px;text-align:center}
.qg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px;margin-bottom:20px}
.qcb{padding:12px 14px;border:1.5px solid #e2ddd7;border-radius:10px;background:#fdfcfb;cursor:pointer;text-align:left;font-family:'Zen Kaku Gothic New',sans-serif;font-size:13px;color:#2d2926;transition:all .14s ease;display:flex;align-items:flex-start;gap:8px}
.qcb.chk{border-color:#b08d6e;background:#fdf3eb;color:#7a5c40}
.cki{width:16px;height:16px;flex-shrink:0;border:1.5px solid #c9c0b7;border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:10px;margin-top:1px}
.qcb.chk .cki{background:#b08d6e;border-color:#b08d6e;color:#fff}
.qta{width:100%;padding:12px 14px;border:1.5px solid #e2ddd7;border-radius:10px;font-family:'Zen Kaku Gothic New',sans-serif;font-size:14px;color:#2d2926;background:#fdfcfb;resize:none;outline:none;transition:border-color .14s;line-height:1.6;margin-bottom:16px;display:block}
.qta:focus{border-color:#b08d6e}
.qta::placeholder{color:#c9c0b7}
.btn-p{margin-top:8px;width:100%;padding:15px;background:#2d2926;color:#fff;border:none;border-radius:10px;font-family:'Zen Kaku Gothic New',sans-serif;font-size:14px;font-weight:500;cursor:pointer;transition:all .14s;letter-spacing:.04em;display:flex;align-items:center;justify-content:center;gap:8px}
.btn-p:hover:not(:disabled){background:#b08d6e}
.btn-p:disabled{opacity:.4;cursor:not-allowed}
.skip{text-align:center;font-size:12px;color:#a09488;cursor:pointer;text-decoration:underline;text-underline-offset:3px;margin-top:12px}
.skip:hover{color:#7a5c40}
.sld-wrap{margin:8px 0 20px}
.sld{width:100%;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;background:#e2ddd7;outline:none;cursor:pointer;margin-bottom:12px}
.sld::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:22px;height:22px;border-radius:50%;background:#b08d6e;cursor:pointer;box-shadow:0 1px 4px rgba(176,141,110,.4)}
.sld-row{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:#8a7e72}
.sld-val{font-family:'Noto Serif JP',serif;font-size:28px;color:#2d2926;font-weight:400}
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.welcome{text-align:center;padding:8px 0}
.wi{font-size:48px;display:block;margin-bottom:20px}
.wt{font-family:'Noto Serif JP',serif;font-size:22px;font-weight:400;color:#2d2926;margin-bottom:10px}
.ws{font-size:14px;color:#8a7e72;line-height:1.8;margin-bottom:20px}
.ws strong{color:#2d2926}
.wb{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:28px}
.wb span{font-size:12px;color:#8a7e72;background:#f7f4ef;padding:5px 12px;border-radius:20px}
.complete{text-align:center;padding:16px 0}
.ci{font-size:52px;display:block;margin-bottom:20px;animation:pop .5s cubic-bezier(.34,1.56,.64,1)}
@keyframes pop{from{transform:scale(.5);opacity:0}to{transform:scale(1);opacity:1}}
.ct{font-family:'Noto Serif JP',serif;font-size:24px;font-weight:400;color:#2d2926;margin-bottom:10px}
.cs{font-size:14px;color:#8a7e72;line-height:1.8;margin-bottom:20px}
.cn{padding:14px 18px;background:#f7f4ef;border-radius:10px;font-size:13px;color:#8a7e72;line-height:1.8}
@media(max-width:480px){.qr-card{padding:24px 18px 20px}.qt{font-size:17px}.qg{grid-template-columns:1fr}}
`;
