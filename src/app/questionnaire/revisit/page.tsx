"use client";
import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RevisitQuestionnairePage() {
  const sp = useSearchParams();
  const aptId = sp.get("appointment_id") || "";
  const patientId = sp.get("patient_id") || "";
  const [patient, setPatient] = useState<{ name_kanji: string } | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    condition_change: "",
    pain_location: "",
    pain_level: 3,
    new_symptoms: [] as string[],
    medication_change: "",
    pregnancy: "",
    other: "",
  });

  useEffect(() => {
    if (patientId) {
      supabase.from("patients").select("name_kanji").eq("id", patientId).single().then(({ data }) => {
        if (data) setPatient(data);
      });
    }
  }, [patientId]);

  const toggleSymptom = (s: string) => {
    setForm(prev => ({
      ...prev,
      new_symptoms: prev.new_symptoms.includes(s)
        ? prev.new_symptoms.filter(x => x !== s)
        : [...prev.new_symptoms, s],
    }));
  };

  const handleSubmit = async () => {
    const soapS = [
      form.condition_change && `前回からの変化: ${form.condition_change}`,
      form.pain_location && `痛みの部位: ${form.pain_location}（${form.pain_level}/10）`,
      form.new_symptoms.length > 0 && `新しい症状: ${form.new_symptoms.join(", ")}`,
      form.medication_change && `服薬変更: ${form.medication_change}`,
      form.pregnancy && `妊娠: ${form.pregnancy}`,
      form.other && `その他: ${form.other}`,
    ].filter(Boolean).join("\n");

    await supabase.from("questionnaire_responses").insert({
      appointment_id: aptId || null,
      patient_id: patientId || null,
      questionnaire_type: "revisit",
      responses: form,
      soap_s_generated: soapS,
    });

    if (aptId) {
      const { data: rec } = await supabase.from("medical_records").select("id, soap_s").eq("appointment_id", aptId).single();
      if (rec) {
        const existing = rec.soap_s || "";
        await supabase.from("medical_records").update({
          soap_s: existing ? existing + "\n---\n" + soapS : soapS,
        }).eq("id", rec.id);
      }
    }
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center shadow-xl">
          <p className="text-5xl mb-4">✅</p>
          <h2 className="text-xl font-bold text-gray-900 mb-2">問診票の入力が完了しました</h2>
          <p className="text-gray-500 text-sm">受付にお声がけください</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      <header className="bg-white border-b border-gray-200 px-4 py-4">
        <h1 className="text-lg font-bold text-gray-900 text-center">📋 再診問診票</h1>
        {patient && <p className="text-center text-sm text-gray-500 mt-1">{patient.name_kanji} 様</p>}
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* 前回からの変化 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-sm font-bold text-gray-700 block mb-2">前回の治療から変わったことはありますか？</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {["特になし", "痛みが出た", "腫れが出た", "詰め物が取れた", "歯が欠けた", "出血がある"].map(opt => (
              <button key={opt} onClick={() => setForm({ ...form, condition_change: opt })}
                className={`text-sm px-3 py-2 rounded-lg border-2 font-bold transition-all ${form.condition_change === opt ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                {opt}
              </button>
            ))}
          </div>
          <input type="text" value={form.condition_change} onChange={e => setForm({ ...form, condition_change: e.target.value })}
            placeholder="その他（自由入力）" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" />
        </div>

        {/* 痛みの部位 */}
        {form.condition_change !== "特になし" && form.condition_change && (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <label className="text-sm font-bold text-gray-700 block mb-2">痛みや異常がある場所</label>
            <input type="text" value={form.pain_location} onChange={e => setForm({ ...form, pain_location: e.target.value })}
              placeholder="例: 右下の奥歯、前歯" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:border-sky-400" />
            <label className="text-sm font-bold text-gray-700 block mb-2">痛みの強さ（0=なし〜10=最大）</label>
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400">0</span>
              <input type="range" min={0} max={10} value={form.pain_level}
                onChange={e => setForm({ ...form, pain_level: parseInt(e.target.value) })}
                className="flex-1" />
              <span className="text-xs text-gray-400">10</span>
              <span className={`text-lg font-bold w-10 text-center ${form.pain_level >= 7 ? "text-red-600" : form.pain_level >= 4 ? "text-orange-500" : "text-green-600"}`}>
                {form.pain_level}
              </span>
            </div>
          </div>
        )}

        {/* 新しい症状 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-sm font-bold text-gray-700 block mb-2">最近気になる症状（複数選択可）</label>
          <div className="flex flex-wrap gap-2">
            {["歯がしみる", "歯ぐきが腫れる", "歯ぐきから血が出る", "口臭が気になる", "噛み合わせが変", "顎が痛い", "口が開きにくい", "特になし"].map(s => (
              <button key={s} onClick={() => toggleSymptom(s)}
                className={`text-sm px-3 py-2 rounded-lg border-2 font-bold ${form.new_symptoms.includes(s) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-600"}`}>
                {form.new_symptoms.includes(s) ? "✓ " : ""}{s}
              </button>
            ))}
          </div>
        </div>

        {/* 服薬変更 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-sm font-bold text-gray-700 block mb-2">前回から服用中のお薬に変更はありますか？</label>
          <div className="flex gap-2 mb-2">
            {["変更なし", "変更あり"].map(opt => (
              <button key={opt}
                onClick={() => setForm({ ...form, medication_change: opt === "変更なし" ? "" : form.medication_change || "変更あり" })}
                className={`text-sm px-4 py-2 rounded-lg border-2 font-bold ${(opt === "変更なし" && !form.medication_change) || (opt === "変更あり" && form.medication_change) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-600"}`}>
                {opt}
              </button>
            ))}
          </div>
          {form.medication_change && (
            <input type="text" value={form.medication_change} onChange={e => setForm({ ...form, medication_change: e.target.value })}
              placeholder="変更内容を入力" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" />
          )}
        </div>

        {/* その他 */}
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <label className="text-sm font-bold text-gray-700 block mb-2">先生に伝えたいこと</label>
          <textarea value={form.other} onChange={e => setForm({ ...form, other: e.target.value })}
            rows={3} placeholder="ご自由にお書きください"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 resize-none" />
        </div>

        <button onClick={handleSubmit}
          className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 shadow-lg shadow-green-200">
          ✅ 入力完了
        </button>
      </main>
    </div>
  );
}
