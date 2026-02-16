"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Suspense } from "react";

type Step = "loading" | "intro" | "form" | "confirm" | "complete" | "error" | "already_done";

const PAIN_TYPES = [
  { id: "sharp", label: "ズキズキする" },
  { id: "dull", label: "鈍い痛み" },
  { id: "cold", label: "冷たいものがしみる" },
  { id: "hot", label: "熱いものがしみる" },
  { id: "bite", label: "噛むと痛い" },
  { id: "spontaneous", label: "何もしなくても痛い" },
  { id: "swelling", label: "腫れている" },
  { id: "bleeding", label: "出血する" },
];

const PAIN_LOCATIONS = [
  { id: "upper_right", label: "右上" },
  { id: "upper_left", label: "左上" },
  { id: "lower_right", label: "右下" },
  { id: "lower_left", label: "左下" },
  { id: "upper_front", label: "上の前歯" },
  { id: "lower_front", label: "下の前歯" },
  { id: "whole", label: "全体的に" },
  { id: "unknown", label: "はっきりわからない" },
];

const VISIT_REASONS = [
  { id: "pain", label: "痛み・しみる" },
  { id: "checkup", label: "定期検診" },
  { id: "cleaning", label: "クリーニング" },
  { id: "filling", label: "詰め物がとれた" },
  { id: "crown", label: "被せ物がとれた" },
  { id: "denture", label: "入れ歯の不具合" },
  { id: "gum", label: "歯ぐきが腫れた" },
  { id: "cosmetic", label: "見た目が気になる" },
  { id: "wisdom", label: "親知らず" },
  { id: "child", label: "お子様の診察" },
  { id: "other", label: "その他" },
];

const MEDICAL_HISTORY_OPTIONS = [
  { id: "hypertension", label: "高血圧" },
  { id: "diabetes", label: "糖尿病" },
  { id: "heart", label: "心臓病" },
  { id: "liver", label: "肝臓疾患" },
  { id: "kidney", label: "腎臓疾患" },
  { id: "asthma", label: "喘息" },
  { id: "epilepsy", label: "てんかん" },
  { id: "blood_thin", label: "血が止まりにくい" },
  { id: "osteoporosis", label: "骨粗しょう症" },
  { id: "cancer", label: "がん治療中" },
  { id: "mental", label: "精神疾患" },
  { id: "rheumatism", label: "リウマチ" },
];

const ALLERGY_OPTIONS = [
  { id: "none", label: "なし" },
  { id: "penicillin", label: "ペニシリン系" },
  { id: "cephem", label: "セフェム系" },
  { id: "nsaid", label: "鎮痛剤(NSAIDs)" },
  { id: "latex", label: "ラテックス" },
  { id: "metal", label: "金属" },
  { id: "iodine", label: "ヨード" },
  { id: "local_anesthetic", label: "局所麻酔薬" },
  { id: "food", label: "食物" },
  { id: "other", label: "その他" },
];

function QuestionnaireContent() {
  const searchParams = useSearchParams();
  const appointmentId = searchParams.get("appointment_id");

  const [step, setStep] = useState<Step>("loading");
  const [patientName, setPatientName] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [formPage, setFormPage] = useState(1);

  const [form, setForm] = useState({
    sex: "",
    postal_code: "",
    address: "",
    occupation: "",
    visit_reasons: [] as string[],
    chief_complaint: "",
    pain_location: "",
    pain_type: [] as string[],
    symptom_onset: "",
    pain_level: 5,
    medical_history: [] as string[],
    medical_history_other: "",
    current_medications: "",
    allergies: [] as string[],
    allergy_other: "",
    is_pregnant: false,
    smoking: "none" as "none" | "current" | "past",
    smoking_detail: "",
    drinking: "none" as "none" | "sometimes" | "daily",
    referring_clinic: "",
    additional_notes: "",
  });

  useEffect(() => {
    if (!appointmentId) { setStep("error"); return; }
    checkAppointment();
  }, [appointmentId]);

  async function checkAppointment() {
    const { data: apt } = await supabase.from("appointments")
      .select("id, scheduled_at, patients ( name_kanji, sex, postal_code, address, occupation )")
      .eq("id", appointmentId).single();
    if (!apt) { setStep("error"); return; }
    const p = apt.patients as unknown as { name_kanji: string; sex?: string; postal_code?: string; address?: string; occupation?: string };
    setPatientName(p?.name_kanji || "");
    setAppointmentDate(new Date(apt.scheduled_at).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" }));
    if (p?.sex) setForm(f => ({ ...f, sex: p.sex || "" }));
    if (p?.postal_code) setForm(f => ({ ...f, postal_code: p.postal_code || "" }));
    if (p?.address) setForm(f => ({ ...f, address: p.address || "" }));
    if (p?.occupation) setForm(f => ({ ...f, occupation: p.occupation || "" }));

    const { data: existing } = await supabase.from("questionnaire_responses").select("id").eq("appointment_id", appointmentId).limit(1);
    if (existing && existing.length > 0) { setStep("already_done"); return; }
    setStep("intro");
  }

  async function fetchAddress(zipcode: string) {
    const clean = zipcode.replace(/[^0-9]/g, "");
    if (clean.length !== 7) return;
    setAddressLoading(true);
    try {
      const res = await fetch(`https://zipcloud.ibsnet.co.jp/api/search?zipcode=${clean}`);
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const r = data.results[0];
        const addr = `${r.address1}${r.address2}${r.address3}`;
        setForm(f => ({ ...f, address: addr }));
      }
    } catch (e) {
      console.error("住所検索エラー:", e);
    }
    setAddressLoading(false);
  }

  function toggleArray(field: "pain_type" | "medical_history" | "allergies" | "visit_reasons", id: string) {
    setForm(prev => {
      const arr = prev[field] as string[];
      if (field === "allergies" && id === "none") return { ...prev, [field]: arr.includes("none") ? [] : ["none"] };
      if (field === "allergies" && arr.includes("none")) return { ...prev, [field]: [id] };
      return { ...prev, [field]: arr.includes(id) ? arr.filter(t => t !== id) : [...arr, id] };
    });
  }

  async function submitQuestionnaire() {
    setSaving(true);
    const { data: apt } = await supabase.from("appointments").select("patient_id").eq("id", appointmentId).single();
    if (!apt) { setSaving(false); return; }

    const medHistLabels = form.medical_history.map(id => MEDICAL_HISTORY_OPTIONS.find(o => o.id === id)?.label).filter(Boolean);
    const medHistText = [...medHistLabels, form.medical_history_other].filter(Boolean).join("、") || "なし";
    const allergyLabels = form.allergies.filter(a => a !== "none" && a !== "other").map(id => ALLERGY_OPTIONS.find(o => o.id === id)?.label).filter(Boolean);
    const allergyText = [...allergyLabels, form.allergy_other].filter(Boolean).join("、") || "なし";

    await supabase.from("questionnaire_responses").insert({
      appointment_id: appointmentId,
      patient_id: apt.patient_id,
      chief_complaint: form.chief_complaint,
      pain_location: form.pain_location,
      pain_type: form.pain_type,
      symptom_onset: form.symptom_onset,
      pain_level: form.pain_level,
      medical_history: medHistText,
      current_medications: form.current_medications,
      allergies: allergyText,
      is_pregnant: form.is_pregnant,
      additional_notes: form.additional_notes,
    });

    const painTypeLabels = form.pain_type.map(id => PAIN_TYPES.find(p => p.id === id)?.label).filter(Boolean).join("、");
    const painLocationLabel = PAIN_LOCATIONS.find(l => l.id === form.pain_location)?.label || "";
    const visitReasonLabels = form.visit_reasons.map(id => VISIT_REASONS.find(r => r.id === id)?.label).filter(Boolean).join("、");
    const smokingText = form.smoking === "current" ? `喫煙あり${form.smoking_detail ? `(${form.smoking_detail})` : ""}` : form.smoking === "past" ? `過去に喫煙${form.smoking_detail ? `(${form.smoking_detail})` : ""}` : "";
    const drinkingText = form.drinking === "daily" ? "飲酒: 毎日" : form.drinking === "sometimes" ? "飲酒: 時々" : "";

    const soapS = [
      visitReasonLabels && `【来院理由】${visitReasonLabels}`,
      form.chief_complaint && `【主訴】${form.chief_complaint}`,
      painLocationLabel && `【部位】${painLocationLabel}`,
      painTypeLabels && `【症状】${painTypeLabels}`,
      form.symptom_onset && `【発症時期】${form.symptom_onset}`,
      form.pain_level && `【痛みの程度】${form.pain_level}/10`,
      medHistText !== "なし" && `【既往歴】${medHistText}`,
      form.current_medications && `【服用薬】${form.current_medications}`,
      allergyText !== "なし" && `【アレルギー】${allergyText}`,
      form.is_pregnant && `【妊娠】あり`,
      smokingText && `【喫煙】${smokingText}`,
      drinkingText && `【飲酒】${drinkingText}`,
      form.referring_clinic && `【紹介元】${form.referring_clinic}`,
      form.additional_notes && `【その他】${form.additional_notes}`,
    ].filter(Boolean).join("\n");

    await supabase.from("medical_records").update({ soap_s: soapS }).eq("appointment_id", appointmentId);
    await supabase.from("questionnaire_responses").update({ synced_to_soap: true }).eq("appointment_id", appointmentId);

    const patientUpdate: Record<string, unknown> = {};
    if (form.sex) patientUpdate.sex = form.sex;
    if (form.postal_code) patientUpdate.postal_code = form.postal_code;
    if (form.address) patientUpdate.address = form.address;
    if (form.occupation) patientUpdate.occupation = form.occupation;
    if (allergyText !== "なし") patientUpdate.allergies = allergyLabels.concat(form.allergy_other ? [form.allergy_other] : []);
    if (medHistText !== "なし") patientUpdate.medications = form.current_medications ? [form.current_medications] : [];
    if (form.additional_notes) patientUpdate.notes = form.additional_notes;
    if (Object.keys(patientUpdate).length > 0) {
      await supabase.from("patients").update(patientUpdate).eq("id", apt.patient_id);
    }

    setSaving(false);
    setStep("complete");
  }

  const btnSelected = "bg-sky-600 text-white shadow-sm";
  const btnDefault = "bg-white border border-gray-200 text-gray-700 hover:border-sky-300";
  const progressPct = formPage === 1 ? 33 : formPage === 2 ? 66 : 100;

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-sky-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-5 text-center">
          <h1 className="text-xl font-bold">🦷 WEB問診票</h1>
          <p className="text-sky-200 text-sm mt-1">ご来院前にご記入ください</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        {step === "loading" && <div className="text-center py-12"><p className="text-gray-400">読み込み中...</p></div>}

        {step === "error" && (
          <div className="text-center py-12">
            <p className="text-4xl mb-4">⚠️</p>
            <p className="text-gray-500">問診票のリンクが正しくありません</p>
            <p className="text-gray-400 text-sm mt-2">予約完了画面のリンクからアクセスしてください</p>
          </div>
        )}

        {step === "already_done" && (
          <div className="text-center py-12">
            <p className="text-4xl mb-4">✅</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">回答済みです</h2>
            <p className="text-gray-500">この予約の問診票は既にご回答いただいております。</p>
          </div>
        )}

        {step === "intro" && (
          <div className="text-center">
            <div className="bg-sky-50 rounded-2xl p-6 mb-6">
              <p className="text-sm text-gray-500">ご予約日</p>
              <p className="text-lg font-bold text-gray-900">{appointmentDate}</p>
              <p className="text-sm text-gray-500 mt-2">{patientName} 様</p>
            </div>
            <p className="text-sm text-gray-500 mb-6">ご来院前に問診票にご回答いただくと、よりスムーズに診察を受けていただけます。所要時間は約3分です。</p>
            <button onClick={() => { setStep("form"); setFormPage(1); }}
              className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 active:scale-[0.98]">問診票に回答する</button>
          </div>
        )}

        {step === "form" && (
          <div className="space-y-6">
            <div>
              <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
                <span className={formPage >= 1 ? "text-sky-600 font-bold" : ""}>1. 基本情報</span>
                <span className={formPage >= 2 ? "text-sky-600 font-bold" : ""}>2. 症状</span>
                <span className={formPage >= 3 ? "text-sky-600 font-bold" : ""}>3. 既往歴・生活</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-sky-500 rounded-full transition-all duration-300" style={{ width: `${progressPct}%` }} />
              </div>
            </div>

            {/* === ページ1: 基本情報 === */}
            {formPage === 1 && (
              <div className="space-y-5">
                <h2 className="text-base font-bold text-gray-900">基本情報をご確認ください</h2>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">性別 <span className="text-red-500">*</span></label>
                  <div className="flex gap-3">
                    {[{ v: "1", l: "男性" }, { v: "2", l: "女性" }].map(o => (
                      <button key={o.v} onClick={() => setForm({ ...form, sex: o.v })}
                        className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${form.sex === o.v ? btnSelected : btnDefault}`}>{o.l}</button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-1">
                    <label className="block text-sm font-bold text-gray-900 mb-2">〒 郵便番号</label>
                    <input value={form.postal_code} onChange={e => {
                      const v = e.target.value;
                      setForm({ ...form, postal_code: v });
                      fetchAddress(v);
                    }}
                      placeholder="123-4567" className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400" />
                    {addressLoading && <p className="text-[10px] text-sky-500 mt-1">🔍 住所を検索中...</p>}
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-bold text-gray-900 mb-2">住所</label>
                    <input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })}
                      placeholder="東京都○○区..." className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400" />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">ご職業</label>
                  <input value={form.occupation} onChange={e => setForm({ ...form, occupation: e.target.value })}
                    placeholder="会社員、主婦、学生 など" className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400" />
                </div>

                <div className="space-y-3 pt-2">
                  <button onClick={() => {
                    if (!form.sex) { alert("性別を選択してください"); return; }
                    setFormPage(2);
                  }} className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 active:scale-[0.98]">次へ →</button>
                  <button onClick={() => setStep("intro")} className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">戻る</button>
                </div>
              </div>
            )}

            {/* === ページ2: 症状 === */}
            {formPage === 2 && (
              <div className="space-y-5">
                <h2 className="text-base font-bold text-gray-900">今回の症状について教えてください</h2>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">来院理由（複数選択可）<span className="text-red-500">*</span></label>
                  <div className="grid grid-cols-3 gap-2">
                    {VISIT_REASONS.map(r => (
                      <button key={r.id} onClick={() => toggleArray("visit_reasons", r.id)}
                        className={`py-2.5 rounded-xl text-xs font-bold transition-all ${form.visit_reasons.includes(r.id) ? btnSelected : btnDefault}`}>{r.label}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">具体的な症状を教えてください <span className="text-red-500">*</span></label>
                  <textarea value={form.chief_complaint} onChange={e => setForm({ ...form, chief_complaint: e.target.value })}
                    placeholder="例: 右下の奥歯が3日前から痛い" rows={3}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400 resize-none" />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">痛みのある場所</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PAIN_LOCATIONS.map(loc => (
                      <button key={loc.id} onClick={() => setForm({ ...form, pain_location: loc.id })}
                        className={`py-2.5 rounded-xl text-sm font-bold transition-all ${form.pain_location === loc.id ? btnSelected : btnDefault}`}>{loc.label}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">症状の種類（複数選択可）</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PAIN_TYPES.map(pt => (
                      <button key={pt.id} onClick={() => toggleArray("pain_type", pt.id)}
                        className={`py-2.5 rounded-xl text-sm font-bold transition-all ${form.pain_type.includes(pt.id) ? btnSelected : btnDefault}`}>{pt.label}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">いつ頃から？</label>
                  <input type="text" value={form.symptom_onset} onChange={e => setForm({ ...form, symptom_onset: e.target.value })}
                    placeholder="例: 3日前から、1週間前から" className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400" />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">
                    痛みの程度 <span className="text-sky-600 font-bold text-lg ml-2">{form.pain_level}</span> / 10
                  </label>
                  <input type="range" min={0} max={10} value={form.pain_level}
                    onChange={e => setForm({ ...form, pain_level: parseInt(e.target.value) })} className="w-full accent-sky-600" />
                  <div className="flex justify-between text-xs text-gray-400"><span>痛みなし</span><span>非常に痛い</span></div>
                </div>

                <div className="space-y-3 pt-2">
                  <button onClick={() => {
                    if (form.visit_reasons.length === 0) { alert("来院理由を1つ以上選択してください"); return; }
                    if (!form.chief_complaint) { alert("具体的な症状をご記入ください"); return; }
                    setFormPage(3);
                  }} className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 active:scale-[0.98]">次へ →</button>
                  <button onClick={() => setFormPage(1)} className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">← 戻る</button>
                </div>
              </div>
            )}

            {/* === ページ3: 既往歴・生活習慣 === */}
            {formPage === 3 && (
              <div className="space-y-5">
                <h2 className="text-base font-bold text-gray-900">お体のことについて教えてください</h2>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">現在治療中・過去の病気（複数選択可）</label>
                  <div className="grid grid-cols-3 gap-2">
                    {MEDICAL_HISTORY_OPTIONS.map(o => (
                      <button key={o.id} onClick={() => toggleArray("medical_history", o.id)}
                        className={`py-2.5 rounded-xl text-xs font-bold transition-all ${form.medical_history.includes(o.id) ? btnSelected : btnDefault}`}>{o.label}</button>
                    ))}
                  </div>
                  <input value={form.medical_history_other} onChange={e => setForm({ ...form, medical_history_other: e.target.value })}
                    placeholder="その他の病気があればご記入" className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base mt-2 focus:outline-none focus:border-sky-400" />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">現在服用中のお薬</label>
                  <textarea value={form.current_medications} onChange={e => setForm({ ...form, current_medications: e.target.value })}
                    placeholder="お薬の名前をご記入ください（なければ「なし」）" rows={2}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400 resize-none" />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">アレルギー（複数選択可）</label>
                  <div className="grid grid-cols-3 gap-2">
                    {ALLERGY_OPTIONS.map(o => (
                      <button key={o.id} onClick={() => toggleArray("allergies", o.id)}
                        className={`py-2.5 rounded-xl text-xs font-bold transition-all ${form.allergies.includes(o.id) ? (o.id === "none" ? "bg-green-600 text-white shadow-sm" : btnSelected) : btnDefault}`}>{o.label}</button>
                    ))}
                  </div>
                  {form.allergies.includes("other") && (
                    <input value={form.allergy_other} onChange={e => setForm({ ...form, allergy_other: e.target.value })}
                      placeholder="具体的にご記入ください" className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base mt-2 focus:outline-none focus:border-sky-400" />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">妊娠の可能性</label>
                  <div className="flex gap-3">
                    <button onClick={() => setForm({ ...form, is_pregnant: false })}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold ${!form.is_pregnant ? btnSelected : btnDefault}`}>なし</button>
                    <button onClick={() => setForm({ ...form, is_pregnant: true })}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold ${form.is_pregnant ? "bg-pink-600 text-white shadow-sm" : btnDefault}`}>あり・可能性あり</button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">喫煙について</label>
                  <div className="flex gap-2">
                    {([{ v: "none", l: "吸わない" }, { v: "past", l: "過去に吸っていた" }, { v: "current", l: "現在吸っている" }] as const).map(o => (
                      <button key={o.v} onClick={() => setForm({ ...form, smoking: o.v })}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${form.smoking === o.v ? (o.v === "current" ? "bg-orange-500 text-white shadow-sm" : btnSelected) : btnDefault}`}>{o.l}</button>
                    ))}
                  </div>
                  {form.smoking !== "none" && (
                    <input value={form.smoking_detail} onChange={e => setForm({ ...form, smoking_detail: e.target.value })}
                      placeholder="例: 1日10本×5年、3年前にやめた" className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base mt-2 focus:outline-none focus:border-sky-400" />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">飲酒について</label>
                  <div className="flex gap-2">
                    {([{ v: "none", l: "飲まない" }, { v: "sometimes", l: "時々飲む" }, { v: "daily", l: "毎日飲む" }] as const).map(o => (
                      <button key={o.v} onClick={() => setForm({ ...form, drinking: o.v })}
                        className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${form.drinking === o.v ? btnSelected : btnDefault}`}>{o.l}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">紹介元・かかりつけ医</label>
                  <input value={form.referring_clinic} onChange={e => setForm({ ...form, referring_clinic: e.target.value })}
                    placeholder="紹介元の医院名（なければ空欄）" className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400" />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-900 mb-2">その他伝えたいこと</label>
                  <textarea value={form.additional_notes} onChange={e => setForm({ ...form, additional_notes: e.target.value })}
                    placeholder="気になることがあればご記入ください" rows={3}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400 resize-none" />
                </div>

                <div className="space-y-3 pt-2">
                  <button onClick={() => setStep("confirm")}
                    className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 active:scale-[0.98]">確認画面へ →</button>
                  <button onClick={() => setFormPage(2)} className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">← 戻る</button>
                </div>
              </div>
            )}
          </div>
        )}

        {step === "confirm" && (() => {
          const medLabels = form.medical_history.map(id => MEDICAL_HISTORY_OPTIONS.find(o => o.id === id)?.label).filter(Boolean);
          const allLabels = form.allergies.filter(a => a !== "other").map(id => ALLERGY_OPTIONS.find(o => o.id === id)?.label).filter(Boolean);
          return (
            <div>
              <h2 className="text-lg font-bold text-gray-900 mb-4">回答内容の確認</h2>
              <div className="bg-gray-50 rounded-2xl p-5 space-y-3 mb-6">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200 pb-1">基本情報</p>
                <div className="grid grid-cols-2 gap-2">
                  <div><p className="text-xs text-gray-400">性別</p><p className="text-sm font-bold text-gray-900">{form.sex === "1" ? "男性" : "女性"}</p></div>
                  {form.postal_code && <div><p className="text-xs text-gray-400">〒</p><p className="text-sm text-gray-900">{form.postal_code}</p></div>}
                  {form.address && <div className="col-span-2"><p className="text-xs text-gray-400">住所</p><p className="text-sm text-gray-900">{form.address}</p></div>}
                  {form.occupation && <div><p className="text-xs text-gray-400">職業</p><p className="text-sm text-gray-900">{form.occupation}</p></div>}
                </div>

                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200 pb-1 pt-2">症状</p>
                {form.visit_reasons.length > 0 && <div><p className="text-xs text-gray-400">来院理由</p><p className="text-sm text-gray-900">{form.visit_reasons.map(id => VISIT_REASONS.find(r => r.id === id)?.label).join("、")}</p></div>}
                <div><p className="text-xs text-gray-400">主訴</p><p className="text-sm font-bold text-gray-900">{form.chief_complaint}</p></div>
                {form.pain_location && <div><p className="text-xs text-gray-400">部位</p><p className="text-sm text-gray-900">{PAIN_LOCATIONS.find(l => l.id === form.pain_location)?.label}</p></div>}
                {form.pain_type.length > 0 && <div><p className="text-xs text-gray-400">症状</p><p className="text-sm text-gray-900">{form.pain_type.map(t => PAIN_TYPES.find(p => p.id === t)?.label).join("、")}</p></div>}
                {form.symptom_onset && <div><p className="text-xs text-gray-400">発症時期</p><p className="text-sm text-gray-900">{form.symptom_onset}</p></div>}
                <div><p className="text-xs text-gray-400">痛みの程度</p><p className="text-sm text-gray-900">{form.pain_level} / 10</p></div>

                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-200 pb-1 pt-2">既往歴・生活習慣</p>
                <div><p className="text-xs text-gray-400">既往歴</p><p className="text-sm text-gray-900">{[...medLabels, form.medical_history_other].filter(Boolean).join("、") || "なし"}</p></div>
                {form.current_medications && <div><p className="text-xs text-gray-400">服用薬</p><p className="text-sm text-gray-900">{form.current_medications}</p></div>}
                <div><p className="text-xs text-gray-400">アレルギー</p><p className="text-sm text-gray-900">{[...allLabels, form.allergy_other].filter(Boolean).join("、") || "なし"}</p></div>
                <div><p className="text-xs text-gray-400">妊娠</p><p className="text-sm text-gray-900">{form.is_pregnant ? "あり・可能性あり" : "なし"}</p></div>
                <div><p className="text-xs text-gray-400">喫煙</p><p className="text-sm text-gray-900">{form.smoking === "current" ? `吸っている ${form.smoking_detail}` : form.smoking === "past" ? `過去に ${form.smoking_detail}` : "吸わない"}</p></div>
                <div><p className="text-xs text-gray-400">飲酒</p><p className="text-sm text-gray-900">{form.drinking === "daily" ? "毎日" : form.drinking === "sometimes" ? "時々" : "飲まない"}</p></div>
                {form.referring_clinic && <div><p className="text-xs text-gray-400">紹介元</p><p className="text-sm text-gray-900">{form.referring_clinic}</p></div>}
                {form.additional_notes && <div><p className="text-xs text-gray-400">その他</p><p className="text-sm text-gray-900">{form.additional_notes}</p></div>}
              </div>
              <div className="space-y-3">
                <button onClick={submitQuestionnaire} disabled={saving}
                  className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 disabled:opacity-50">
                  {saving ? "送信中..." : "この内容で送信する"}</button>
                <button onClick={() => { setStep("form"); setFormPage(3); }}
                  className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">修正する</button>
              </div>
            </div>
          );
        })()}

        {step === "complete" && (
          <div className="text-center py-8">
            <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">✅</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">回答が完了しました</h2>
            <p className="text-gray-500 text-sm mb-4">ご回答ありがとうございます。</p>
            <div className="bg-sky-50 rounded-xl p-4 text-left">
              <p className="text-xs font-bold text-sky-600 mb-1">反映される情報</p>
              <p className="text-xs text-gray-500">ご回答いただいた内容は、診察カルテおよび患者情報に自動反映されます。ご来院時にスムーズに診察いたします。</p>
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-100 mt-auto">
        <div className="max-w-lg mx-auto px-4 py-4 text-center text-xs text-gray-300">Powered by DENTAL CLINIC OS</div>
      </footer>
    </div>
  );
}

export default function QuestionnairePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>}>
      <QuestionnaireContent />
    </Suspense>
  );
}
