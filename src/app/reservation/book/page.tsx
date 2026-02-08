"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase";

type Step = "select_type" | "new_patient_form" | "returning_patient_form" | "select_datetime" | "confirm" | "complete";

export default function BookingPage() {
  const [step, setStep] = useState<Step>("select_type");
  const [patientType, setPatientType] = useState<"new" | "returning">("new");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 新規患者フォーム
  const [newForm, setNewForm] = useState({
    name_kanji: "",
    name_kana: "",
    date_of_birth: "",
    phone: "",
    email: "",
    insurance_type: "社保",
    burden_ratio: "0.3",
  });

  // 通院患者の照合フォーム
  const [returningForm, setReturningForm] = useState({
    name_kanji: "",
    date_of_birth: "",
    phone: "",
  });

  // 照合された患者情報
  const [matchedPatient, setMatchedPatient] = useState<{
    id: string;
    name_kanji: string;
    name_kana: string;
  } | null>(null);

  // 予約日時
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");

  // 作成された予約ID
  const [createdAppointmentId, setCreatedAppointmentId] = useState("");

  // 利用可能な時間枠
  const timeSlots = [
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
    "16:00", "16:30", "17:00", "17:30",
  ];

  // 通院患者の照合
  async function lookupPatient() {
    setLoading(true);
    setError("");

    const { data, error: err } = await supabase
      .from("patients")
      .select("id, name_kanji, name_kana")
      .eq("name_kanji", returningForm.name_kanji)
      .eq("date_of_birth", returningForm.date_of_birth)
      .eq("phone", returningForm.phone)
      .single();

    if (err || !data) {
      setError("患者情報が見つかりませんでした。入力内容をご確認ください。");
      setLoading(false);
      return;
    }

    setMatchedPatient(data);
    setStep("select_datetime");
    setLoading(false);
  }

  // 予約確定処理
  async function confirmBooking() {
    setLoading(true);
    setError("");

    try {
      let patientId = matchedPatient?.id;

      // 新規患者の場合：患者レコード作成
      if (patientType === "new") {
        const { data: newPatient, error: patientErr } = await supabase
          .from("patients")
          .insert({
            name_kanji: newForm.name_kanji,
            name_kana: newForm.name_kana,
            date_of_birth: newForm.date_of_birth,
            phone: newForm.phone,
            email: newForm.email || null,
            insurance_type: newForm.insurance_type,
            burden_ratio: parseFloat(newForm.burden_ratio),
            is_new: true,
          })
          .select("id")
          .single();

        if (patientErr || !newPatient) {
          setError("患者情報の登録に失敗しました。");
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
        setError("予約の登録に失敗しました。");
        setLoading(false);
        return;
      }

      // カルテの自動作成（設計書3.1.2: 予約確定でカルテ自動作成）
      await supabase.from("medical_records").insert({
        appointment_id: appointment.id,
        patient_id: patientId,
        status: "draft",
      });

      setCreatedAppointmentId(appointment.id);
      setStep("complete");
    } catch (e) {
      setError("エラーが発生しました。もう一度お試しください。");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900 text-center">
            🦷 ご予約
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {/* ========== STEP 1: 患者区分の選択 ========== */}
        {step === "select_type" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 text-center mb-6">
              ご予約の種類を選択してください
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button
                onClick={() => {
                  setPatientType("new");
                  setStep("new_patient_form");
                }}
                className="bg-white border-2 border-gray-200 rounded-xl p-6 text-center hover:border-sky-400 hover:shadow-md transition-all"
              >
                <div className="text-4xl mb-3">🆕</div>
                <h3 className="text-lg font-bold text-gray-900">
                  はじめての方
                </h3>
                <p className="text-sm text-gray-500 mt-2">
                  当院への来院が初めての方
                </p>
              </button>

              <button
                onClick={() => {
                  setPatientType("returning");
                  setStep("returning_patient_form");
                }}
                className="bg-white border-2 border-gray-200 rounded-xl p-6 text-center hover:border-sky-400 hover:shadow-md transition-all"
              >
                <div className="text-4xl mb-3">🔄</div>
                <h3 className="text-lg font-bold text-gray-900">
                  通院中の方
                </h3>
                <p className="text-sm text-gray-500 mt-2">
                  以前に来院されたことがある方
                </p>
              </button>
            </div>
          </div>
        )}

        {/* ========== STEP 2a: 新規患者 情報入力 ========== */}
        {step === "new_patient_form" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-6">
              患者情報を入力してください
            </h2>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  氏名（漢字）<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newForm.name_kanji}
                  onChange={(e) =>
                    setNewForm({ ...newForm, name_kanji: e.target.value })
                  }
                  placeholder="山田 太郎"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  氏名（カナ）<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={newForm.name_kana}
                  onChange={(e) =>
                    setNewForm({ ...newForm, name_kana: e.target.value })
                  }
                  placeholder="ヤマダ タロウ"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  生年月日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={newForm.date_of_birth}
                  onChange={(e) =>
                    setNewForm({ ...newForm, date_of_birth: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  電話番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={newForm.phone}
                  onChange={(e) =>
                    setNewForm({ ...newForm, phone: e.target.value })
                  }
                  placeholder="090-1234-5678"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  メールアドレス
                </label>
                <input
                  type="email"
                  value={newForm.email}
                  onChange={(e) =>
                    setNewForm({ ...newForm, email: e.target.value })
                  }
                  placeholder="example@email.com"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    保険種別
                  </label>
                  <select
                    value={newForm.insurance_type}
                    onChange={(e) =>
                      setNewForm({ ...newForm, insurance_type: e.target.value })
                    }
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                  >
                    <option value="社保">社保</option>
                    <option value="国保">国保</option>
                    <option value="後期高齢">後期高齢</option>
                    <option value="自費">自費</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">
                    負担割合
                  </label>
                  <select
                    value={newForm.burden_ratio}
                    onChange={(e) =>
                      setNewForm({ ...newForm, burden_ratio: e.target.value })
                    }
                    className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                  >
                    <option value="0.3">3割</option>
                    <option value="0.2">2割</option>
                    <option value="0.1">1割</option>
                  </select>
                </div>
              </div>

              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep("select_type")}
                  className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-lg font-bold hover:bg-gray-200 transition-colors"
                >
                  戻る
                </button>
                <button
                  onClick={() => {
                    if (!newForm.name_kanji || !newForm.name_kana || !newForm.date_of_birth || !newForm.phone) {
                      setError("必須項目を入力してください");
                      return;
                    }
                    setError("");
                    setStep("select_datetime");
                  }}
                  className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold hover:bg-sky-700 transition-colors"
                >
                  日時選択へ →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== STEP 2b: 通院患者 照合 ========== */}
        {step === "returning_patient_form" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-6">
              患者情報の照合
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              以下の3項目で患者情報を照合します。
            </p>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  氏名（漢字）<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={returningForm.name_kanji}
                  onChange={(e) =>
                    setReturningForm({ ...returningForm, name_kanji: e.target.value })
                  }
                  placeholder="山田 太郎"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  生年月日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={returningForm.date_of_birth}
                  onChange={(e) =>
                    setReturningForm({ ...returningForm, date_of_birth: e.target.value })
                  }
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  電話番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={returningForm.phone}
                  onChange={(e) =>
                    setReturningForm({ ...returningForm, phone: e.target.value })
                  }
                  placeholder="090-1234-5678"
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                />
              </div>

              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setError("");
                    setStep("select_type");
                  }}
                  className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-lg font-bold hover:bg-gray-200 transition-colors"
                >
                  戻る
                </button>
                <button
                  onClick={lookupPatient}
                  disabled={loading}
                  className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold hover:bg-sky-700 transition-colors disabled:opacity-50"
                >
                  {loading ? "照合中..." : "照合する →"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== STEP 3: 日時選択 ========== */}
        {step === "select_datetime" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-6">
              予約日時を選択してください
            </h2>

            {matchedPatient && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-4">
                <p className="text-sm text-green-700">
                  ✅ 患者照合完了：
                  <span className="font-bold">{matchedPatient.name_kanji}</span>
                  （{matchedPatient.name_kana}）
                </p>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  予約日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full border border-gray-300 rounded-lg px-4 py-3 focus:outline-none focus:border-sky-400"
                />
              </div>

              {selectedDate && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">
                    時間帯 <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {timeSlots.map((time) => (
                      <button
                        key={time}
                        onClick={() => setSelectedTime(time)}
                        className={`py-2 rounded-lg text-sm font-bold transition-colors ${
                          selectedTime === time
                            ? "bg-sky-600 text-white"
                            : "bg-gray-50 text-gray-700 hover:bg-sky-50 border border-gray-200"
                        }`}
                      >
                        {time}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => {
                    setError("");
                    setStep(
                      patientType === "new"
                        ? "new_patient_form"
                        : "returning_patient_form"
                    );
                  }}
                  className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-lg font-bold hover:bg-gray-200 transition-colors"
                >
                  戻る
                </button>
                <button
                  onClick={() => {
                    if (!selectedDate || !selectedTime) {
                      setError("日付と時間を選択してください");
                      return;
                    }
                    setError("");
                    setStep("confirm");
                  }}
                  className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold hover:bg-sky-700 transition-colors"
                >
                  確認へ →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== STEP 4: 確認画面 ========== */}
        {step === "confirm" && (
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-6">
              予約内容の確認
            </h2>
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
              <div className="border-b border-gray-100 pb-3">
                <p className="text-xs text-gray-400">患者区分</p>
                <p className="font-bold text-gray-900">
                  {patientType === "new" ? "はじめての方（初診）" : "通院中の方（再診）"}
                </p>
              </div>
              <div className="border-b border-gray-100 pb-3">
                <p className="text-xs text-gray-400">患者名</p>
                <p className="font-bold text-gray-900">
                  {patientType === "new"
                    ? newForm.name_kanji
                    : matchedPatient?.name_kanji}
                </p>
              </div>
              <div className="border-b border-gray-100 pb-3">
                <p className="text-xs text-gray-400">予約日時</p>
                <p className="font-bold text-gray-900">
                  {selectedDate} {selectedTime}
                </p>
              </div>

              {error && (
                <p className="text-red-500 text-sm">{error}</p>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setStep("select_datetime")}
                  className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-lg font-bold hover:bg-gray-200 transition-colors"
                >
                  戻る
                </button>
                <button
                  onClick={confirmBooking}
                  disabled={loading}
                  className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold hover:bg-sky-700 transition-colors disabled:opacity-50"
                >
                  {loading ? "予約登録中..." : "予約を確定する"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========== STEP 5: 完了画面 ========== */}
        {step === "complete" && (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              予約が完了しました
            </h2>
            <p className="text-gray-500 mb-2">
              {selectedDate} {selectedTime}
            </p>
            <p className="text-sm text-gray-400 mb-8">
              ご来院をお待ちしております。
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  setStep("select_type");
                  setNewForm({
                    name_kanji: "",
                    name_kana: "",
                    date_of_birth: "",
                    phone: "",
                    email: "",
                    insurance_type: "社保",
                    burden_ratio: "0.3",
                  });
                  setReturningForm({ name_kanji: "", date_of_birth: "", phone: "" });
                  setMatchedPatient(null);
                  setSelectedDate("");
                  setSelectedTime("");
                  setError("");
                }}
                className="bg-sky-600 text-white px-6 py-3 rounded-lg font-bold hover:bg-sky-700 transition-colors"
              >
                別の予約を追加
              </button>
              <a
                href="/reservation"
                className="bg-gray-100 text-gray-600 px-6 py-3 rounded-lg font-bold hover:bg-gray-200 transition-colors"
              >
                予約一覧へ
              </a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
