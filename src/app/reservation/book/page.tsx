"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type Step =
  | "select_type"
  | "new_patient_info"
  | "returning_lookup"
  | "select_date"
  | "select_time"
  | "confirm"
  | "complete";

export default function PatientBookingPage() {
  const [step, setStep] = useState<Step>("select_type");
  const [patientType, setPatientType] = useState<"new" | "returning">("new");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 新規患者フォーム
  const [form, setForm] = useState({
    name_kanji: "",
    name_kana: "",
    date_of_birth: "",
    phone: "",
    insurance_type: "社保",
    burden_ratio: "0.3",
  });

  // 通院患者の照合フォーム
  const [lookupForm, setLookupForm] = useState({
    name_kanji: "",
    date_of_birth: "",
    phone: "",
  });

  // 照合された患者
  const [matchedPatient, setMatchedPatient] = useState<{
    id: string;
    name_kanji: string;
  } | null>(null);

  // 予約日時
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");

  // 利用可能な日付（今日から14日間）
  function getAvailableDates() {
    const dates = [];
    const today = new Date();
    for (let i = 1; i <= 14; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      // 日曜日を除外（クリニックの休診日として）
      if (d.getDay() !== 0) {
        dates.push(d);
      }
    }
    return dates;
  }

  // 時間枠
  const morningSlots = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];
  const afternoonSlots = ["13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30"];

  // 日付フォーマット
  function formatDate(date: Date) {
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    return {
      month: date.getMonth() + 1,
      day: date.getDate(),
      weekday: weekdays[date.getDay()],
      iso: date.toISOString().split("T")[0],
    };
  }

  // 通院患者照合
  async function lookupPatient() {
    setLoading(true);
    setError("");

    const { data, error: err } = await supabase
      .from("patients")
      .select("id, name_kanji")
      .eq("name_kanji", lookupForm.name_kanji)
      .eq("date_of_birth", lookupForm.date_of_birth)
      .eq("phone", lookupForm.phone)
      .single();

    if (err || !data) {
      setError(
        "患者情報が見つかりませんでした。入力内容をご確認いただくか、「はじめての方」からご予約ください。"
      );
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

      // 新規患者の場合
      if (patientType === "new") {
        const { data: newPatient, error: patientErr } = await supabase
          .from("patients")
          .insert({
            name_kanji: form.name_kanji,
            name_kana: form.name_kana,
            date_of_birth: form.date_of_birth,
            phone: form.phone,
            insurance_type: form.insurance_type,
            burden_ratio: parseFloat(form.burden_ratio),
            is_new: true,
          })
          .select("id")
          .single();

        if (patientErr || !newPatient) {
          setError("登録に失敗しました。お手数ですがお電話にてご予約ください。");
          setLoading(false);
          return;
        }
        patientId = newPatient.id;
      }

      // 予約レコード作成
      const scheduledAt = `${selectedDate}T${selectedTime}:00`;
      const { data: appointment, error: aptErr } = await supabase
        .from("appointments")
        .insert({
          patient_id: patientId,
          scheduled_at: scheduledAt,
          patient_type: patientType === "new" ? "new" : "returning",
          status: "reserved",
          duration_min: 30,
        })
        .select("id")
        .single();

      if (aptErr || !appointment) {
        setError("予約の登録に失敗しました。お手数ですがお電話にてご予約ください。");
        setLoading(false);
        return;
      }

      // カルテ自動作成（設計書 3.1.2）
      await supabase.from("medical_records").insert({
        appointment_id: appointment.id,
        patient_id: patientId,
        status: "draft",
      });

      setStep("complete");
    } catch {
      setError("エラーが発生しました。お手数ですがお電話にてご予約ください。");
    }
    setLoading(false);
  }

  // 患者名の取得
  function getPatientName() {
    return patientType === "new" ? form.name_kanji : matchedPatient?.name_kanji || "";
  }

  // プログレスバー
  function getProgress() {
    const steps: Step[] =
      patientType === "new"
        ? ["select_type", "new_patient_info", "select_date", "select_time", "confirm", "complete"]
        : ["select_type", "returning_lookup", "select_date", "select_time", "confirm", "complete"];
    const idx = steps.indexOf(step);
    return Math.round(((idx + 1) / steps.length) * 100);
  }

  return (
    <div className="min-h-screen bg-white">
      {/* ヘッダー */}
      <header className="bg-sky-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-5 text-center">
          <h1 className="text-xl font-bold">🦷 Web予約</h1>
          <p className="text-sky-200 text-sm mt-1">24時間いつでもご予約いただけます</p>
        </div>
      </header>

      {/* プログレスバー */}
      {step !== "complete" && (
        <div className="w-full bg-gray-100 h-1">
          <div
            className="bg-sky-500 h-1 transition-all duration-300"
            style={{ width: `${getProgress()}%` }}
          />
        </div>
      )}

      <main className="max-w-lg mx-auto px-4 py-6">
        {/* ========== はじめて or 通院 ========== */}
        {step === "select_type" && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
              ご予約はこちらから
            </h2>
            <p className="text-sm text-gray-500 text-center mb-8">
              該当するボタンを選んでください
            </p>

            <div className="space-y-4">
              <button
                onClick={() => {
                  setPatientType("new");
                  setStep("new_patient_info");
                }}
                className="w-full bg-white border-2 border-gray-200 rounded-2xl p-6 text-left hover:border-sky-400 hover:bg-sky-50 transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-sky-100 w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                    🆕
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">
                      はじめての方
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      当院への来院が初めての方はこちら
                    </p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => {
                  setPatientType("returning");
                  setStep("returning_lookup");
                }}
                className="w-full bg-white border-2 border-gray-200 rounded-2xl p-6 text-left hover:border-sky-400 hover:bg-sky-50 transition-all active:scale-[0.98]"
              >
                <div className="flex items-center gap-4">
                  <div className="bg-green-100 w-14 h-14 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
                    🔄
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">
                      通院中の方
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">
                      以前にご来院いただいたことがある方
                    </p>
                  </div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* ========== 新規患者：情報入力 ========== */}
        {step === "new_patient_info" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              患者さま情報のご入力
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              <span className="text-red-500">*</span> は必須項目です
            </p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">
                  お名前（漢字）<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name_kanji}
                  onChange={(e) => setForm({ ...form, name_kanji: e.target.value })}
                  placeholder="山田 太郎"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">
                  お名前（カナ）<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={form.name_kana}
                  onChange={(e) => setForm({ ...form, name_kana: e.target.value })}
                  placeholder="ヤマダ タロウ"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">
                  生年月日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">
                  電話番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="09012345678"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">
                    保険種別
                  </label>
                  <select
                    value={form.insurance_type}
                    onChange={(e) => setForm({ ...form, insurance_type: e.target.value })}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 bg-white"
                  >
                    <option value="社保">社保</option>
                    <option value="国保">国保</option>
                    <option value="後期高齢">後期高齢</option>
                    <option value="自費">自費</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1.5">
                    負担割合
                  </label>
                  <select
                    value={form.burden_ratio}
                    onChange={(e) => setForm({ ...form, burden_ratio: e.target.value })}
                    className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 bg-white"
                  >
                    <option value="0.3">3割負担</option>
                    <option value="0.2">2割負担</option>
                    <option value="0.1">1割負担</option>
                  </select>
                </div>
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setError(""); setStep("select_type"); }}
                  className="flex-1 bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  戻る
                </button>
                <button
                  onClick={() => {
                    if (!form.name_kanji || !form.name_kana || !form.date_of_birth || !form.phone) {
                      setError("必須項目をすべて入力してください");
                      return;
                    }
                    setError("");
                    setStep("select_date");
                  }}
                  className="flex-1 bg-sky-600 text-white py-3.5 rounded-xl font-bold hover:bg-sky-700 transition-colors"
                >
                  次へ
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== 通院患者：照合 ========== */}
        {step === "returning_lookup" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              患者情報の確認
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              ご登録済みの情報で照合いたします
            </p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">
                  お名前（漢字）<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={lookupForm.name_kanji}
                  onChange={(e) => setLookupForm({ ...lookupForm, name_kanji: e.target.value })}
                  placeholder="山田 太郎"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">
                  生年月日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={lookupForm.date_of_birth}
                  onChange={(e) => setLookupForm({ ...lookupForm, date_of_birth: e.target.value })}
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">
                  電話番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={lookupForm.phone}
                  onChange={(e) => setLookupForm({ ...lookupForm, phone: e.target.value })}
                  placeholder="09012345678"
                  className="w-full border border-gray-300 rounded-xl px-4 py-3.5 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                  <p className="text-red-600 text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setError(""); setStep("select_type"); }}
                  className="flex-1 bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold hover:bg-gray-200 transition-colors"
                >
                  戻る
                </button>
                <button
                  onClick={lookupPatient}
                  disabled={loading || !lookupForm.name_kanji || !lookupForm.date_of_birth || !lookupForm.phone}
                  className="flex-1 bg-sky-600 text-white py-3.5 rounded-xl font-bold hover:bg-sky-700 transition-colors disabled:opacity-50"
                >
                  {loading ? "確認中..." : "次へ"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== 日付選択 ========== */}
        {step === "select_date" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              ご希望の日付を選択
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              ご都合の良い日をタップしてください
            </p>

            <div className="grid grid-cols-3 gap-2">
              {getAvailableDates().map((date) => {
                const d = formatDate(date);
                const isSelected = selectedDate === d.iso;
                const isSaturday = date.getDay() === 6;
                return (
                  <button
                    key={d.iso}
                    onClick={() => {
                      setSelectedDate(d.iso);
                      setStep("select_time");
                    }}
                    className={`rounded-xl p-3 text-center transition-all active:scale-[0.97] ${
                      isSelected
                        ? "bg-sky-600 text-white shadow-md"
                        : "bg-white border border-gray-200 hover:border-sky-300"
                    }`}
                  >
                    <p className={`text-xs ${isSelected ? "text-sky-200" : "text-gray-400"}`}>
                      {d.month}月
                    </p>
                    <p className={`text-2xl font-bold ${isSelected ? "text-white" : "text-gray-900"}`}>
                      {d.day}
                    </p>
                    <p
                      className={`text-xs font-bold ${
                        isSelected
                          ? "text-sky-200"
                          : isSaturday
                          ? "text-blue-500"
                          : "text-gray-400"
                      }`}
                    >
                      {d.weekday}
                    </p>
                  </button>
                );
              })}
            </div>

            <button
              onClick={() => {
                setStep(
                  patientType === "new" ? "new_patient_info" : "returning_lookup"
                );
              }}
              className="w-full mt-6 bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold hover:bg-gray-200 transition-colors"
            >
              戻る
            </button>
          </div>
        )}

        {/* ========== 時間選択 ========== */}
        {step === "select_time" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              ご希望の時間を選択
            </h2>
            <p className="text-sm text-gray-500 mb-6">
              {selectedDate &&
                new Date(selectedDate + "T00:00:00").toLocaleDateString("ja-JP", {
                  month: "long",
                  day: "numeric",
                  weekday: "short",
                })}
              のご予約
            </p>

            {/* 午前 */}
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              午前
            </p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {morningSlots.map((time) => (
                <button
                  key={time}
                  onClick={() => {
                    setSelectedTime(time);
                    setStep("confirm");
                  }}
                  className="bg-white border border-gray-200 rounded-xl py-3 text-center font-bold text-gray-900 hover:border-sky-400 hover:bg-sky-50 transition-all active:scale-[0.97]"
                >
                  {time}
                </button>
              ))}
            </div>

            {/* 午後 */}
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              午後
            </p>
            <div className="grid grid-cols-3 gap-2">
              {afternoonSlots.map((time) => (
                <button
                  key={time}
                  onClick={() => {
                    setSelectedTime(time);
                    setStep("confirm");
                  }}
                  className="bg-white border border-gray-200 rounded-xl py-3 text-center font-bold text-gray-900 hover:border-sky-400 hover:bg-sky-50 transition-all active:scale-[0.97]"
                >
                  {time}
                </button>
              ))}
            </div>

            <button
              onClick={() => {
                setSelectedTime("");
                setStep("select_date");
              }}
              className="w-full mt-6 bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold hover:bg-gray-200 transition-colors"
            >
              日付を選び直す
            </button>
          </div>
        )}

        {/* ========== 確認 ========== */}
        {step === "confirm" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-6">
              ご予約内容の確認
            </h2>

            <div className="bg-gray-50 rounded-2xl p-5 space-y-4 mb-6">
              <div>
                <p className="text-xs text-gray-400 mb-0.5">お名前</p>
                <p className="text-lg font-bold text-gray-900">
                  {getPatientName()} 様
                </p>
              </div>
              <div className="border-t border-gray-200 pt-4">
                <p className="text-xs text-gray-400 mb-0.5">ご予約日時</p>
                <p className="text-lg font-bold text-gray-900">
                  {selectedDate &&
                    new Date(selectedDate + "T00:00:00").toLocaleDateString("ja-JP", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                      weekday: "short",
                    })}
                </p>
                <p className="text-2xl font-bold text-sky-600">{selectedTime}</p>
              </div>
              <div className="border-t border-gray-200 pt-4">
                <p className="text-xs text-gray-400 mb-0.5">区分</p>
                <p className="font-bold text-gray-900">
                  {patientType === "new" ? "初診" : "再診"}
                </p>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <div className="space-y-3">
              <button
                onClick={confirmBooking}
                disabled={loading}
                className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 transition-colors disabled:opacity-50 active:scale-[0.98]"
              >
                {loading ? "予約を登録中..." : "この内容で予約する"}
              </button>
              <button
                onClick={() => setStep("select_time")}
                className="w-full bg-gray-100 text-gray-600 py-3.5 rounded-xl font-bold hover:bg-gray-200 transition-colors"
              >
                時間を選び直す
              </button>
            </div>
          </div>
        )}

        {/* ========== 完了 ========== */}
        {step === "complete" && (
          <div className="text-center py-8">
            <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">
              ✅
            </div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              ご予約が完了しました
            </h2>
            <div className="bg-gray-50 rounded-2xl p-5 mt-6 mb-6 text-left">
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-400">お名前</p>
                  <p className="font-bold text-gray-900">{getPatientName()} 様</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">ご予約日時</p>
                  <p className="font-bold text-gray-900">
                    {selectedDate &&
                      new Date(selectedDate + "T00:00:00").toLocaleDateString("ja-JP", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        weekday: "short",
                      })}{" "}
                    {selectedTime}
                  </p>
                </div>
              </div>
            </div>
            <p className="text-gray-500 text-sm mb-8">
              ご来院をお待ちしております。
            </p>
          </div>
        )}
      </main>

      {/* フッター */}
      <footer className="border-t border-gray-100 mt-auto">
        <div className="max-w-lg mx-auto px-4 py-4 text-center text-xs text-gray-300">
          Powered by DENTAL CLINIC OS
        </div>
      </footer>
    </div>
  );
}
