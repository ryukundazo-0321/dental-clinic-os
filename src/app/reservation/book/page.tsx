"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import {
  getClinicConfig, getTimeSlotsWithAvailability, getAvailableDates, getDoctors,
  type ClinicConfig, type TimeSlot, type DoctorOption,
} from "@/lib/reservation-utils";

type Step = "select_type" | "new_patient_info" | "returning_lookup" | "select_date" | "select_time" | "confirm" | "complete";

export default function PatientBookingPage() {
  const [step, setStep] = useState<Step>("select_type");
  const [patientType, setPatientType] = useState<"new" | "returning">("new");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // クリニック設定
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);

  // 新規患者フォーム
  const [form, setForm] = useState({
    name_kanji: "", name_kana: "", date_of_birth: "", phone: "",
    insurance_type: "社保", burden_ratio: "0.3",
  });

  // 通院患者の照合
  const [lookupForm, setLookupForm] = useState({ name_kanji: "", date_of_birth: "", phone: "" });
  const [matchedPatient, setMatchedPatient] = useState<{ id: string; name_kanji: string } | null>(null);

  // 予約日時
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  // ===== クリニック設定の読み込み =====
  useEffect(() => {
    async function loadConfig() {
      setConfigLoading(true);
      const c = await getClinicConfig();
      setConfig(c);
      if (c) {
        const docs = await getDoctors(c.clinicId);
        setDoctors(docs);
      }
      setConfigLoading(false);
    }
    loadConfig();
  }, []);

  // ===== 日付選択時に空き状況を取得 =====
  async function onSelectDate(date: string) {
    setSelectedDate(date);
    setSelectedTime("");
    setSlotsLoading(true);
    if (config) {
      const slots = await getTimeSlotsWithAvailability(config, date);
      setTimeSlots(slots);
    }
    setSlotsLoading(false);
    setStep("select_time");
  }

  // 通院患者照合
  async function lookupPatient() {
    setLoading(true);
    setError("");
    const { data, error: err } = await supabase
      .from("patients").select("id, name_kanji")
      .eq("name_kanji", lookupForm.name_kanji)
      .eq("date_of_birth", lookupForm.date_of_birth)
      .eq("phone", lookupForm.phone).single();
    if (err || !data) {
      setError("患者情報が見つかりませんでした。入力内容をご確認いただくか、「はじめての方」からご予約ください。");
      setLoading(false);
      return;
    }
    setMatchedPatient(data);
    setStep("select_date");
    setLoading(false);
  }

  // 予約確定
  async function confirmBooking() {
    setLoading(true);
    setError("");
    try {
      let patientId = matchedPatient?.id;
      if (patientType === "new") {
        const { data: newPatient, error: patientErr } = await supabase
          .from("patients").insert({
            name_kanji: form.name_kanji, name_kana: form.name_kana,
            date_of_birth: form.date_of_birth, phone: form.phone,
            insurance_type: form.insurance_type, burden_ratio: parseFloat(form.burden_ratio),
            is_new: true, clinic_id: config?.clinicId,
          }).select("id").single();
        if (patientErr || !newPatient) { setError("登録に失敗しました。お電話にてご予約ください。"); setLoading(false); return; }
        patientId = newPatient.id;
      }

      const scheduledAt = `${selectedDate}T${selectedTime}:00`;
      const { data: appointment, error: aptErr } = await supabase
        .from("appointments").insert({
          patient_id: patientId, clinic_id: config?.clinicId,
          doctor_id: selectedDoctor || null,
          scheduled_at: scheduledAt,
          patient_type: patientType === "new" ? "new" : "returning",
          status: "reserved", duration_min: config?.slotDurationMin || 30,
        }).select("id").single();

      if (aptErr || !appointment) { setError("予約の登録に失敗しました。お電話にてご予約ください。"); setLoading(false); return; }

      // カルテ自動作成
      await supabase.from("medical_records").insert({
        appointment_id: appointment.id, patient_id: patientId, status: "draft",
      });

      setStep("complete");
    } catch { setError("エラーが発生しました。お電話にてご予約ください。"); }
    setLoading(false);
  }

  function getPatientName() {
    return patientType === "new" ? form.name_kanji : matchedPatient?.name_kanji || "";
  }

  function getProgress() {
    const steps: Step[] = patientType === "new"
      ? ["select_type", "new_patient_info", "select_date", "select_time", "confirm", "complete"]
      : ["select_type", "returning_lookup", "select_date", "select_time", "confirm", "complete"];
    return Math.round(((steps.indexOf(step) + 1) / steps.length) * 100);
  }

  function formatDateDisplay(date: Date) {
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return { month: date.getMonth() + 1, day: date.getDate(), weekday: weekdays[date.getDay()], iso: date.toISOString().split("T")[0], isSaturday: date.getDay() === 6 };
  }

  // ローディング
  if (configLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <p className="text-gray-400">読み込み中...</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-gray-500 mb-2">クリニック情報が設定されていません</p>
          <p className="text-gray-400 text-sm">管理画面から設定を行ってください</p>
        </div>
      </div>
    );
  }

  const availableDates = getAvailableDates(config);

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-sky-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-5 text-center">
          <h1 className="text-xl font-bold">🦷 {config.clinicName || "Web予約"}</h1>
          <p className="text-sky-200 text-sm mt-1">24時間いつでもご予約いただけます</p>
        </div>
      </header>

      {step !== "complete" && (
        <div className="w-full bg-gray-100 h-1">
          <div className="bg-sky-500 h-1 transition-all duration-300" style={{ width: `${getProgress()}%` }} />
        </div>
      )}

      <main className="max-w-lg mx-auto px-4 py-6">
        {/* ===== はじめて or 通院 ===== */}
        {step === "select_type" && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 text-center mb-2">ご予約はこちらから</h2>
            <p className="text-sm text-gray-500 text-center mb-8">該当するボタンを選んでください</p>
            <div className="space-y-4">
              <button onClick={() => { setPatientType("new"); setStep("new_patient_info"); }}
                className="w-full bg-white border-2 border-gray-200 rounded-2xl p-6 text-left hover:border-sky-400 hover:bg-sky-50 transition-all active:scale-[0.98]">
                <div className="flex items-center gap-4">
                  <div className="bg-sky-100 w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">🆕</div>
                  <div><h3 className="text-lg font-bold text-gray-900">はじめての方</h3><p className="text-sm text-gray-500 mt-0.5">当院への来院が初めての方はこちら</p></div>
                </div>
              </button>
              <button onClick={() => { setPatientType("returning"); setStep("returning_lookup"); }}
                className="w-full bg-white border-2 border-gray-200 rounded-2xl p-6 text-left hover:border-sky-400 hover:bg-sky-50 transition-all active:scale-[0.98]">
                <div className="flex items-center gap-4">
                  <div className="bg-green-100 w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">🔄</div>
                  <div><h3 className="text-lg font-bold text-gray-900">通院中の方</h3><p className="text-sm text-gray-500 mt-0.5">以前にご来院いただいたことがある方</p></div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ===== 新規患者：情報入力 ===== */}
        {step === "new_patient_info" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">患者さま情報のご入力</h2>
            <p className="text-sm text-gray-500 mb-6"><span className="text-red-500">*</span> は必須項目です</p>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">お名前（漢字）<span className="text-red-500">*</span></label>
                <input type="text" value={form.name_kanji} onChange={(e) => setForm({ ...form, name_kanji: e.target.value })}
                  placeholder="山田 太郎" className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">お名前（カナ）<span className="text-red-500">*</span></label>
                <input type="text" value={form.name_kana} onChange={(e) => setForm({ ...form, name_kana: e.target.value })}
                  placeholder="ヤマダ タロウ" className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">生年月日 <span className="text-red-500">*</span></label>
                <input type="date" value={form.date_of_birth} onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">電話番号 <span className="text-red-500">*</span></label>
                <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="09012345678" className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">保険種別</label>
                  <select value={form.insurance_type} onChange={(e) => setForm({ ...form, insurance_type: e.target.value })}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 bg-white">
                    <option value="社保">社保</option><option value="国保">国保</option><option value="後期高齢">後期高齢</option><option value="自費">自費</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">負担割合</label>
                  <select value={form.burden_ratio} onChange={(e) => setForm({ ...form, burden_ratio: e.target.value })}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 bg-white">
                    <option value="0.3">3割負担</option><option value="0.2">2割負担</option><option value="0.1">1割負担</option>
                  </select>
                </div>
              </div>
              {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3"><p className="text-red-600 text-sm">{error}</p></div>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setError(""); setStep("select_type"); }} className="flex-1 bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold">戻る</button>
                <button onClick={() => {
                  if (!form.name_kanji || !form.name_kana || !form.date_of_birth || !form.phone) { setError("必須項目をすべて入力してください"); return; }
                  setError(""); setStep("select_date");
                }} className="flex-1 bg-sky-600 text-white py-3.5 rounded-xl font-bold hover:bg-sky-700">次へ</button>
              </div>
            </div>
          </div>
        )}

        {/* ===== 通院患者：照合 ===== */}
        {step === "returning_lookup" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">患者情報の確認</h2>
            <p className="text-sm text-gray-500 mb-6">ご登録済みの情報で照合いたします</p>
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">お名前（漢字）<span className="text-red-500">*</span></label>
                <input type="text" value={lookupForm.name_kanji} onChange={(e) => setLookupForm({ ...lookupForm, name_kanji: e.target.value })}
                  placeholder="山田 太郎" className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">生年月日 <span className="text-red-500">*</span></label>
                <input type="date" value={lookupForm.date_of_birth} onChange={(e) => setLookupForm({ ...lookupForm, date_of_birth: e.target.value })}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">電話番号 <span className="text-red-500">*</span></label>
                <input type="tel" value={lookupForm.phone} onChange={(e) => setLookupForm({ ...lookupForm, phone: e.target.value })}
                  placeholder="09012345678" className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>
              {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3"><p className="text-red-600 text-sm">{error}</p></div>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setError(""); setStep("select_type"); }} className="flex-1 bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold">戻る</button>
                <button onClick={lookupPatient} disabled={loading || !lookupForm.name_kanji || !lookupForm.date_of_birth || !lookupForm.phone}
                  className="flex-1 bg-sky-600 text-white py-3.5 rounded-xl font-bold hover:bg-sky-700 disabled:opacity-50">{loading ? "確認中..." : "次へ"}</button>
              </div>
            </div>
          </div>
        )}

        {/* ===== 日付選択（設定連動） ===== */}
        {step === "select_date" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">ご希望の日付を選択</h2>
            <p className="text-sm text-gray-500 mb-6">ご都合の良い日をタップしてください</p>
            <div className="grid grid-cols-3 gap-2">
              {availableDates.map((date) => {
                const d = formatDateDisplay(date);
                return (
                  <button key={d.iso} onClick={() => onSelectDate(d.iso)}
                    className="bg-white border border-gray-200 rounded-xl p-3 text-center hover:border-sky-300 transition-all active:scale-[0.97]">
                    <p className="text-xs text-gray-400">{d.month}月</p>
                    <p className="text-2xl font-bold text-gray-900">{d.day}</p>
                    <p className={`text-xs font-bold ${d.isSaturday ? "text-blue-500" : "text-gray-400"}`}>{d.weekday}</p>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setStep(patientType === "new" ? "new_patient_info" : "returning_lookup")}
              className="w-full mt-6 bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold">戻る</button>
          </div>
        )}

        {/* ===== 時間選択（設定連動 + 空き状況表示） ===== */}
        {step === "select_time" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">ご希望の時間を選択</h2>
            <p className="text-sm text-gray-500 mb-4">
              {selectedDate && new Date(selectedDate + "T00:00:00").toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })} のご予約
            </p>

            {/* ドクター選択 */}
            {doctors.length > 0 && (
              <div className="mb-5">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">担当医（任意）</p>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => setSelectedDoctor("")}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${!selectedDoctor ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500"}`}>
                    指定なし
                  </button>
                  {doctors.map((doc) => (
                    <button key={doc.id} onClick={() => setSelectedDoctor(doc.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${selectedDoctor === doc.id ? "text-white" : "bg-white border border-gray-200 text-gray-500"}`}
                      style={selectedDoctor === doc.id ? { backgroundColor: doc.color } : {}}>
                      {doc.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {slotsLoading ? (
              <div className="text-center py-8 text-gray-400">空き状況を確認中...</div>
            ) : (
              <>
                {/* 午前 */}
                {timeSlots.filter((s) => s.period === "morning").length > 0 && (
                  <>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">午前</p>
                    <div className="grid grid-cols-3 gap-2 mb-5">
                      {timeSlots.filter((s) => s.period === "morning").map((slot) => (
                        <button key={slot.time} disabled={slot.isFull}
                          onClick={() => { setSelectedTime(slot.time); setStep("confirm"); }}
                          className={`rounded-xl py-3 text-center font-bold transition-all active:scale-[0.97] ${
                            slot.isFull
                              ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                              : "bg-white border border-gray-200 text-gray-900 hover:border-sky-400 hover:bg-sky-50"
                          }`}>
                          <span className="text-sm">{slot.time}</span>
                          {slot.isFull ? (
                            <p className="text-[10px] text-red-400 mt-0.5">✕ 満枠</p>
                          ) : (
                            <p className="text-[10px] text-green-500 mt-0.5">◎ 空きあり</p>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* 午後 */}
                {timeSlots.filter((s) => s.period === "afternoon").length > 0 && (
                  <>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">午後</p>
                    <div className="grid grid-cols-3 gap-2">
                      {timeSlots.filter((s) => s.period === "afternoon").map((slot) => (
                        <button key={slot.time} disabled={slot.isFull}
                          onClick={() => { setSelectedTime(slot.time); setStep("confirm"); }}
                          className={`rounded-xl py-3 text-center font-bold transition-all active:scale-[0.97] ${
                            slot.isFull
                              ? "bg-gray-100 text-gray-300 cursor-not-allowed"
                              : "bg-white border border-gray-200 text-gray-900 hover:border-sky-400 hover:bg-sky-50"
                          }`}>
                          <span className="text-sm">{slot.time}</span>
                          {slot.isFull ? (
                            <p className="text-[10px] text-red-400 mt-0.5">✕ 満枠</p>
                          ) : (
                            <p className="text-[10px] text-green-500 mt-0.5">◎ 空きあり</p>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            <button onClick={() => { setSelectedTime(""); setStep("select_date"); }}
              className="w-full mt-6 bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold">日付を選び直す</button>
          </div>
        )}

        {/* ===== 確認 ===== */}
        {step === "confirm" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-6">ご予約内容の確認</h2>
            <div className="bg-gray-50 rounded-2xl p-5 space-y-4 mb-6">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">お名前</p>
                <p className="text-lg font-bold text-gray-900">{getPatientName()} 様</p>
              </div>
              <div className="border-t border-gray-200 pt-4">
                <p className="text-xs text-gray-400 mb-0.5">ご予約日時</p>
                <p className="text-lg font-bold text-gray-900">
                  {selectedDate && new Date(selectedDate + "T00:00:00").toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })}
                </p>
                <p className="text-2xl font-bold text-sky-600">{selectedTime}</p>
              </div>
              {selectedDoctor && doctors.find((d) => d.id === selectedDoctor) && (
                <div className="border-t border-gray-200 pt-4">
                  <p className="text-xs text-gray-400 mb-0.5">担当医</p>
                  <p className="font-bold text-gray-900">{doctors.find((d) => d.id === selectedDoctor)?.name}</p>
                </div>
              )}
              <div className="border-t border-gray-200 pt-4">
                <p className="text-xs text-gray-400 mb-0.5">区分</p>
                <p className="font-bold text-gray-900">{patientType === "new" ? "初診" : "再診"}</p>
              </div>
            </div>
            {error && <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4"><p className="text-red-600 text-sm">{error}</p></div>}
            <div className="space-y-3">
              <button onClick={confirmBooking} disabled={loading}
                className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 disabled:opacity-50 active:scale-[0.98]">
                {loading ? "予約を登録中..." : "この内容で予約する"}
              </button>
              <button onClick={() => setStep("select_time")} className="w-full bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold">時間を選び直す</button>
            </div>
          </div>
        )}

        {/* ===== 完了 ===== */}
        {step === "complete" && (
          <div className="text-center py-8">
            <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">✅</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">ご予約が完了しました</h2>
            <div className="bg-gray-50 rounded-2xl p-5 mt-6 mb-6 text-left space-y-3">
              <div><p className="text-xs text-gray-400">お名前</p><p className="font-bold text-gray-900">{getPatientName()} 様</p></div>
              <div>
                <p className="text-xs text-gray-400">ご予約日時</p>
                <p className="font-bold text-gray-900">
                  {selectedDate && new Date(selectedDate + "T00:00:00").toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" })} {selectedTime}
                </p>
              </div>
              {selectedDoctor && doctors.find((d) => d.id === selectedDoctor) && (
                <div><p className="text-xs text-gray-400">担当医</p><p className="font-bold text-gray-900">{doctors.find((d) => d.id === selectedDoctor)?.name}</p></div>
              )}
            </div>
            <p className="text-gray-500 text-sm mb-8">ご来院をお待ちしております。</p>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-100 mt-auto">
        <div className="max-w-lg mx-auto px-4 py-4 text-center text-xs text-gray-300">Powered by DENTAL CLINIC OS</div>
      </footer>
    </div>
  );
}
