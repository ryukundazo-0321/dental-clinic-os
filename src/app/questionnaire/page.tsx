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

function QuestionnaireContent() {
  const searchParams = useSearchParams();
  const appointmentId = searchParams.get("appointment_id");

  const [step, setStep] = useState<Step>("loading");
  const [patientName, setPatientName] = useState("");
  const [appointmentDate, setAppointmentDate] = useState("");
  const [saving, setSaving] = useState(false);

  // フォーム
  const [form, setForm] = useState({
    chief_complaint: "",
    pain_location: "",
    pain_type: [] as string[],
    symptom_onset: "",
    pain_level: 5,
    medical_history: "",
    current_medications: "",
    allergies: "",
    is_pregnant: false,
    additional_notes: "",
  });

  useEffect(() => {
    if (!appointmentId) {
      setStep("error");
      return;
    }
    checkAppointment();
  }, [appointmentId]);

  async function checkAppointment() {
    // 予約情報を取得
    const { data: apt } = await supabase
      .from("appointments")
      .select(`
        id, scheduled_at,
        patients ( name_kanji )
      `)
      .eq("id", appointmentId)
      .single();

    if (!apt) {
      setStep("error");
      return;
    }

    setPatientName((apt.patients as unknown as { name_kanji: string })?.name_kanji || "");
    setAppointmentDate(
      new Date(apt.scheduled_at).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })
    );

    // 既に回答済みかチェック
    const { data: existing } = await supabase
      .from("questionnaire_responses")
      .select("id")
      .eq("appointment_id", appointmentId)
      .limit(1);

    if (existing && existing.length > 0) {
      setStep("already_done");
      return;
    }

    setStep("intro");
  }

  // 痛みの種類トグル
  function togglePainType(id: string) {
    setForm((prev) => ({
      ...prev,
      pain_type: prev.pain_type.includes(id)
        ? prev.pain_type.filter((t) => t !== id)
        : [...prev.pain_type, id],
    }));
  }

  // 送信
  async function submitQuestionnaire() {
    setSaving(true);

    // 予約からpatient_idを取得
    const { data: apt } = await supabase
      .from("appointments")
      .select("patient_id")
      .eq("id", appointmentId)
      .single();

    if (!apt) {
      setSaving(false);
      return;
    }

    // 問診回答を保存
    await supabase.from("questionnaire_responses").insert({
      appointment_id: appointmentId,
      patient_id: apt.patient_id,
      chief_complaint: form.chief_complaint,
      pain_location: form.pain_location,
      pain_type: form.pain_type,
      symptom_onset: form.symptom_onset,
      pain_level: form.pain_level,
      medical_history: form.medical_history,
      current_medications: form.current_medications,
      allergies: form.allergies,
      is_pregnant: form.is_pregnant,
      additional_notes: form.additional_notes,
    });

    // ===== SOAP-Sに自動反映 =====
    const painTypeLabels = form.pain_type
      .map((id) => PAIN_TYPES.find((p) => p.id === id)?.label)
      .filter(Boolean)
      .join("、");
    const painLocationLabel = PAIN_LOCATIONS.find((l) => l.id === form.pain_location)?.label || "";

    const soapS = [
      form.chief_complaint && `【主訴】${form.chief_complaint}`,
      painLocationLabel && `【部位】${painLocationLabel}`,
      painTypeLabels && `【症状】${painTypeLabels}`,
      form.symptom_onset && `【発症時期】${form.symptom_onset}`,
      form.pain_level && `【痛みの程度】${form.pain_level}/10`,
      form.medical_history && `【既往歴】${form.medical_history}`,
      form.current_medications && `【服用薬】${form.current_medications}`,
      form.allergies && `【アレルギー】${form.allergies}`,
      form.is_pregnant && `【妊娠】あり`,
      form.additional_notes && `【その他】${form.additional_notes}`,
    ]
      .filter(Boolean)
      .join("\n");

    // カルテのSOAP-Sを更新
    await supabase
      .from("medical_records")
      .update({ soap_s: soapS })
      .eq("appointment_id", appointmentId);

    // 問診回答を反映済みに
    await supabase
      .from("questionnaire_responses")
      .update({ synced_to_soap: true })
      .eq("appointment_id", appointmentId);

    setSaving(false);
    setStep("complete");
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-sky-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-5 text-center">
          <h1 className="text-xl font-bold">🦷 WEB問診票</h1>
          <p className="text-sky-200 text-sm mt-1">ご来院前にご記入ください</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6">
        {/* ローディング */}
        {step === "loading" && (
          <div className="text-center py-12"><p className="text-gray-400">読み込み中...</p></div>
        )}

        {/* エラー */}
        {step === "error" && (
          <div className="text-center py-12">
            <p className="text-4xl mb-4">⚠️</p>
            <p className="text-gray-500">問診票のリンクが正しくありません</p>
            <p className="text-gray-400 text-sm mt-2">予約完了画面のリンクからアクセスしてください</p>
          </div>
        )}

        {/* 回答済み */}
        {step === "already_done" && (
          <div className="text-center py-12">
            <p className="text-4xl mb-4">✅</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">回答済みです</h2>
            <p className="text-gray-500">この予約の問診票は既にご回答いただいております。</p>
          </div>
        )}

        {/* イントロ */}
        {step === "intro" && (
          <div className="text-center">
            <div className="bg-sky-50 rounded-2xl p-6 mb-6">
              <p className="text-sm text-gray-500">ご予約日</p>
              <p className="text-lg font-bold text-gray-900">{appointmentDate}</p>
              <p className="text-sm text-gray-500 mt-2">{patientName} 様</p>
            </div>
            <p className="text-sm text-gray-500 mb-6">
              ご来院前に問診票にご回答いただくと、よりスムーズに診察を受けていただけます。所要時間は約2分です。
            </p>
            <button onClick={() => setStep("form")}
              className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 active:scale-[0.98]">
              問診票に回答する
            </button>
          </div>
        )}

        {/* フォーム */}
        {step === "form" && (
          <div className="space-y-6">
            {/* 主訴 */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">
                本日はどのような症状でご来院されますか？ <span className="text-red-500">*</span>
              </label>
              <textarea
                value={form.chief_complaint}
                onChange={(e) => setForm({ ...form, chief_complaint: e.target.value })}
                placeholder="例: 右下の奥歯が痛い、定期検診"
                rows={3}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100 resize-none"
              />
            </div>

            {/* 痛みの部位 */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">痛みのある場所（該当する場合）</label>
              <div className="grid grid-cols-2 gap-2">
                {PAIN_LOCATIONS.map((loc) => (
                  <button key={loc.id} onClick={() => setForm({ ...form, pain_location: loc.id })}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                      form.pain_location === loc.id ? "bg-sky-600 text-white" : "bg-white border border-gray-200 text-gray-700 hover:border-sky-300"
                    }`}>
                    {loc.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 痛みの種類 */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">症状（複数選択可）</label>
              <div className="grid grid-cols-2 gap-2">
                {PAIN_TYPES.map((pt) => (
                  <button key={pt.id} onClick={() => togglePainType(pt.id)}
                    className={`py-2.5 rounded-xl text-sm font-bold transition-all ${
                      form.pain_type.includes(pt.id) ? "bg-sky-600 text-white" : "bg-white border border-gray-200 text-gray-700 hover:border-sky-300"
                    }`}>
                    {pt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* いつから */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">いつ頃から症状がありますか？</label>
              <input type="text" value={form.symptom_onset}
                onChange={(e) => setForm({ ...form, symptom_onset: e.target.value })}
                placeholder="例: 3日前から、1週間前から、以前から"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400" />
            </div>

            {/* 痛みの程度 */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">
                痛みの程度 <span className="text-sky-600 font-bold text-lg ml-2">{form.pain_level}</span> / 10
              </label>
              <input type="range" min={0} max={10} value={form.pain_level}
                onChange={(e) => setForm({ ...form, pain_level: parseInt(e.target.value) })}
                className="w-full accent-sky-600" />
              <div className="flex justify-between text-xs text-gray-400">
                <span>痛みなし</span><span>非常に痛い</span>
              </div>
            </div>

            {/* 既往歴 */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">現在治療中の病気・過去の大きな病気</label>
              <textarea value={form.medical_history}
                onChange={(e) => setForm({ ...form, medical_history: e.target.value })}
                placeholder="例: 高血圧、糖尿病、心臓病など（なければ「なし」）"
                rows={2}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400 resize-none" />
            </div>

            {/* 服用薬 */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">現在服用中のお薬</label>
              <textarea value={form.current_medications}
                onChange={(e) => setForm({ ...form, current_medications: e.target.value })}
                placeholder="例: アムロジピン5mg、バイアスピリン（なければ「なし」）"
                rows={2}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400 resize-none" />
            </div>

            {/* アレルギー */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">アレルギー</label>
              <input type="text" value={form.allergies}
                onChange={(e) => setForm({ ...form, allergies: e.target.value })}
                placeholder="例: ペニシリン、ラテックス、金属（なければ「なし」）"
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400" />
            </div>

            {/* 妊娠 */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">妊娠の可能性</label>
              <div className="flex gap-3">
                <button onClick={() => setForm({ ...form, is_pregnant: false })}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold ${!form.is_pregnant ? "bg-sky-600 text-white" : "bg-white border border-gray-200 text-gray-700"}`}>
                  なし
                </button>
                <button onClick={() => setForm({ ...form, is_pregnant: true })}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-bold ${form.is_pregnant ? "bg-sky-600 text-white" : "bg-white border border-gray-200 text-gray-700"}`}>
                  あり・可能性あり
                </button>
              </div>
            </div>

            {/* その他 */}
            <div>
              <label className="block text-sm font-bold text-gray-900 mb-2">その他伝えたいこと</label>
              <textarea value={form.additional_notes}
                onChange={(e) => setForm({ ...form, additional_notes: e.target.value })}
                placeholder="気になることがあればご記入ください"
                rows={3}
                className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400 resize-none" />
            </div>

            {/* 送信 */}
            <div className="space-y-3 pt-2">
              <button onClick={() => {
                if (!form.chief_complaint) { alert("「本日の症状」をご記入ください"); return; }
                setStep("confirm");
              }} className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 active:scale-[0.98]">
                確認画面へ
              </button>
              <button onClick={() => setStep("intro")}
                className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">戻る</button>
            </div>
          </div>
        )}

        {/* 確認 */}
        {step === "confirm" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">回答内容の確認</h2>
            <div className="bg-gray-50 rounded-2xl p-5 space-y-3 mb-6">
              <div><p className="text-xs text-gray-400">主訴</p><p className="text-sm font-bold text-gray-900">{form.chief_complaint}</p></div>
              {form.pain_location && (
                <div><p className="text-xs text-gray-400">痛みの部位</p><p className="text-sm text-gray-900">{PAIN_LOCATIONS.find((l) => l.id === form.pain_location)?.label}</p></div>
              )}
              {form.pain_type.length > 0 && (
                <div><p className="text-xs text-gray-400">症状</p><p className="text-sm text-gray-900">{form.pain_type.map((t) => PAIN_TYPES.find((p) => p.id === t)?.label).join("、")}</p></div>
              )}
              {form.symptom_onset && <div><p className="text-xs text-gray-400">発症時期</p><p className="text-sm text-gray-900">{form.symptom_onset}</p></div>}
              <div><p className="text-xs text-gray-400">痛みの程度</p><p className="text-sm text-gray-900">{form.pain_level} / 10</p></div>
              {form.medical_history && <div><p className="text-xs text-gray-400">既往歴</p><p className="text-sm text-gray-900">{form.medical_history}</p></div>}
              {form.current_medications && <div><p className="text-xs text-gray-400">服用薬</p><p className="text-sm text-gray-900">{form.current_medications}</p></div>}
              {form.allergies && <div><p className="text-xs text-gray-400">アレルギー</p><p className="text-sm text-gray-900">{form.allergies}</p></div>}
              <div><p className="text-xs text-gray-400">妊娠の可能性</p><p className="text-sm text-gray-900">{form.is_pregnant ? "あり" : "なし"}</p></div>
              {form.additional_notes && <div><p className="text-xs text-gray-400">その他</p><p className="text-sm text-gray-900">{form.additional_notes}</p></div>}
            </div>
            <div className="space-y-3">
              <button onClick={submitQuestionnaire} disabled={saving}
                className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 disabled:opacity-50">
                {saving ? "送信中..." : "この内容で送信する"}
              </button>
              <button onClick={() => setStep("form")}
                className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">修正する</button>
            </div>
          </div>
        )}

        {/* 完了 */}
        {step === "complete" && (
          <div className="text-center py-8">
            <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">✅</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">回答が完了しました</h2>
            <p className="text-gray-500 text-sm mb-4">ご回答ありがとうございます。</p>
            <p className="text-gray-400 text-sm">ご来院時にスムーズに診察いたします。</p>
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
