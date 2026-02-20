"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";

// ===== Types =====
type PatientInfo = {
  id: string;
  patient_number: string;
  name_kanji: string;
  name_kana: string;
};

type PatientFull = {
  id: string;
  patient_number: string;
  name_kanji: string;
  name_kana: string;
  date_of_birth: string | null;
  sex: string | null;
  phone: string | null;
  insurance_type: string | null;
  burden_ratio: number | null;
  allergies: unknown;
  current_tooth_chart: Record<string, ToothData> | null;
};

type ToothData = {
  status?: string;
};

type Appointment = {
  id: string;
  scheduled_at: string;
  status: string;
  patient_type: string;
  medical_records: MedicalRecord[] | null;
};

type MedicalRecord = {
  soap_s: string | null;
  soap_o: string | null;
  soap_a: string | null;
  soap_p: string | null;
  doctor_confirmed: boolean;
};

// ===== Constants =====
const UR = ["18", "17", "16", "15", "14", "13", "12", "11"];
const UL = ["21", "22", "23", "24", "25", "26", "27", "28"];
const LR = ["48", "47", "46", "45", "44", "43", "42", "41"];
const LL = ["31", "32", "33", "34", "35", "36", "37", "38"];

const TOOTH_COLORS: Record<string, { bg: string; border: string; label: string }> = {
  normal: { bg: "bg-white", border: "border-gray-200", label: "" },
  caries: { bg: "bg-red-100", border: "border-red-400", label: "要治療" },
  in_treatment: { bg: "bg-orange-100", border: "border-orange-400", label: "治療中" },
  treated: { bg: "bg-green-100", border: "border-green-400", label: "完了" },
  crown: { bg: "bg-yellow-100", border: "border-yellow-400", label: "冠" },
  missing: { bg: "bg-gray-200", border: "border-gray-300", label: "×" },
  root_remain: { bg: "bg-pink-100", border: "border-pink-400", label: "残根" },
  watch: { bg: "bg-amber-100", border: "border-amber-400", label: "観察" },
};

// ===== Helper Functions =====
function formatDate(d: string | null) {
  if (!d) return "-";
  const dt = new Date(d);
  const y = dt.getFullYear();
  const m = dt.getMonth() + 1;
  const day = dt.getDate();
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const w = weekdays[dt.getDay()];
  return `${y}/${m}/${day}（${w}）`;
}

function formatTime(d: string | null) {
  if (!d) return "";
  const dt = new Date(d);
  const h = String(dt.getHours()).padStart(2, "0");
  const m = String(dt.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function formatDateShort(d: string | null) {
  if (!d) return "-";
  const dt = new Date(d);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function getAge(d: string | null) {
  if (!d) return "-";
  const b = new Date(d);
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (
    t.getMonth() < b.getMonth() ||
    (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())
  )
    a--;
  return `${a}歳`;
}

// ===== Main Component =====
export default function MyPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
  const [patientNumber, setPatientNumber] = useState("");
  const [pin, setPin] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  // Post-login data
  const [patientFull, setPatientFull] = useState<PatientFull | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "home" | "history" | "info" | "book"
  >("home");
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);

  // Booking state
  const [bookStep, setBookStep] = useState<
    "select_date" | "select_time" | "confirm" | "complete"
  >("select_date");
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [bookingLoading, setBookingLoading] = useState(false);

  // ===== Login =====
  async function handleLogin() {
    if (!patientNumber.trim() || !pin.trim()) {
      setLoginError("患者番号とPINを入力してください");
      return;
    }

    setLoginLoading(true);
    setLoginError("");

    try {
      const res = await fetch("/api/mypage-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_number: patientNumber.trim().toUpperCase(),
          pin: pin.trim(),
        }),
      });

      const data = await res.json();

      if (data.success) {
        setPatientInfo(data.patient);
        setLoggedIn(true);
        // Save to sessionStorage
        sessionStorage.setItem("mypage_patient", JSON.stringify(data.patient));
      } else {
        setLoginError(data.error || "ログインに失敗しました");
      }
    } catch {
      setLoginError("通信エラーが発生しました");
    }

    setLoginLoading(false);
  }

  // Check session on mount
  useEffect(() => {
    const saved = sessionStorage.getItem("mypage_patient");
    if (saved) {
      try {
        const p = JSON.parse(saved);
        setPatientInfo(p);
        setLoggedIn(true);
      } catch {
        // ignore
      }
    }
  }, []);

  // Load data after login
  useEffect(() => {
    if (loggedIn && patientInfo) {
      loadPatientData(patientInfo.id);
    }
  }, [loggedIn, patientInfo]);

  async function loadPatientData(patientId: string) {
    setLoading(true);

    // Patient full data
    const { data: pData } = await supabase
      .from("patients")
      .select(
        "id, patient_number, name_kanji, name_kana, date_of_birth, sex, phone, insurance_type, burden_ratio, allergies, current_tooth_chart"
      )
      .eq("id", patientId)
      .single();

    if (pData) {
      setPatientFull(pData as PatientFull);
    }

    // Appointments with medical records
    const { data: aData } = await supabase
      .from("appointments")
      .select(
        "id, scheduled_at, status, patient_type, medical_records(soap_s, soap_o, soap_a, soap_p, doctor_confirmed)"
      )
      .eq("patient_id", patientId)
      .order("scheduled_at", { ascending: false });

    if (aData) {
      setAppointments(aData as Appointment[]);
    }

    setLoading(false);
  }

  function handleLogout() {
    setLoggedIn(false);
    setPatientInfo(null);
    setPatientFull(null);
    setAppointments([]);
    sessionStorage.removeItem("mypage_patient");
    setPatientNumber("");
    setPin("");
  }

  async function cancelAppointment(aptId: string) {
    await supabase
      .from("appointments")
      .update({ status: "cancelled" })
      .eq("id", aptId);

    setAppointments((prev) =>
      prev.map((a) => (a.id === aptId ? { ...a, status: "cancelled" } : a))
    );
    setCancelConfirm(null);
  }

  // ===== Booking =====
  function getAvailableDates() {
    const dates: string[] = [];
    const now = new Date();
    for (let i = 1; i <= 30; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      // Skip Sundays (0)
      if (d.getDay() === 0) continue;
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      dates.push(`${y}-${m}-${day}`);
    }
    return dates;
  }

  function getAvailableTimes() {
    const times: string[] = [];
    // 9:00 - 12:30, 14:00 - 17:30 (30min slots)
    for (let h = 9; h <= 12; h++) {
      times.push(`${String(h).padStart(2, "0")}:00`);
      if (h < 12 || (h === 12 && true)) {
        times.push(`${String(h).padStart(2, "0")}:30`);
      }
    }
    for (let h = 14; h <= 17; h++) {
      times.push(`${String(h).padStart(2, "0")}:00`);
      times.push(`${String(h).padStart(2, "0")}:30`);
    }
    return times;
  }

  function formatDateFull(d: string) {
    const dt = new Date(d + "T00:00:00");
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const w = weekdays[dt.getDay()];
    return `${dt.getMonth() + 1}/${dt.getDate()}（${w}）`;
  }

  async function confirmBooking() {
    if (!patientFull || !selectedDate || !selectedTime) return;
    setBookingLoading(true);

    try {
      const scheduledAt = `${selectedDate}T${selectedTime}:00`;

      const { error } = await supabase.from("appointments").insert({
        patient_id: patientFull.id,
        scheduled_at: scheduledAt,
        patient_type: "returning",
        status: "scheduled",
        duration_min: 30,
      });

      if (error) {
        console.error("Booking error:", error);
        alert("予約の登録に失敗しました。お電話でお問い合わせください。");
      } else {
        // Create medical record
        const { data: aptData } = await supabase
          .from("appointments")
          .select("id")
          .eq("patient_id", patientFull.id)
          .eq("scheduled_at", scheduledAt)
          .single();

        if (aptData) {
          await supabase.from("medical_records").insert({
            appointment_id: aptData.id,
            patient_id: patientFull.id,
            status: "pending",
          });
        }

        setBookStep("complete");
        // Reload appointments
        await loadPatientData(patientFull.id);
      }
    } catch (e) {
      console.error("Booking error:", e);
      alert("予約の登録に失敗しました");
    }

    setBookingLoading(false);
  }

  // ===== Login Screen =====
  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          {/* Logo */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-sky-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-sky-200">
              <span className="text-3xl">🦷</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900">
              DentalOS マイページ
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              患者番号とPINでログイン
            </p>
          </div>

          {/* Login Form */}
          <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6">
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">
                  患者番号
                </label>
                <input
                  type="text"
                  value={patientNumber}
                  onChange={(e) => setPatientNumber(e.target.value)}
                  placeholder="P-00001"
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-sky-400 transition-colors"
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 mb-1 block">
                  PIN（4桁）
                </label>
                <input
                  type="password"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="****"
                  maxLength={4}
                  className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-mono tracking-widest focus:outline-none focus:border-sky-400 transition-colors"
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                />
              </div>

              {loginError && (
                <div className="bg-red-50 text-red-600 text-xs font-bold px-4 py-2 rounded-lg">
                  {loginError}
                </div>
              )}

              <button
                onClick={handleLogin}
                disabled={loginLoading}
                className="w-full bg-sky-500 hover:bg-sky-600 text-white py-3 rounded-xl text-sm font-bold disabled:opacity-50 transition-colors shadow-lg shadow-sky-200"
              >
                {loginLoading ? "ログイン中..." : "ログイン"}
              </button>
            </div>

            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 text-center">
                初期PINは生年月日の月日4桁です（例: 3月15日 → 0315）
              </p>
              <p className="text-[10px] text-gray-400 text-center mt-1">
                PINがわからない場合は受付にお問い合わせください
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== Dashboard =====
  if (loading || !patientFull) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">読み込み中...</p>
      </div>
    );
  }

  // Separate appointments
  const upcoming = appointments.filter(
    (a) =>
      a.status === "scheduled" &&
      new Date(a.scheduled_at) >= new Date()
  );

  const past = appointments.filter(
    (a) =>
      a.status === "completed" ||
      (a.status === "scheduled" && new Date(a.scheduled_at) < new Date())
  );

  const cancelled = appointments.filter((a) => a.status === "cancelled");

  // Last treatment plan
  const lastCompleted = past.find((a) => a.status === "completed");
  const lastPlan =
    lastCompleted?.medical_records?.[0]?.soap_p || null;

  // Tooth chart
  const tc = (patientFull.current_tooth_chart || {}) as Record<
    string,
    ToothData
  >;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center text-base font-bold">
              {patientFull.name_kanji.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">
                {patientFull.name_kanji}さん
              </p>
              <p className="text-[10px] text-gray-400">
                {patientFull.patient_number}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-xs text-gray-400 hover:text-gray-600 font-bold px-3 py-1.5 rounded-lg hover:bg-gray-100"
          >
            ログアウト
          </button>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="max-w-lg mx-auto px-4 pt-3">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {(
            [
              { k: "home" as const, l: "🏠 ホーム" },
              { k: "book" as const, l: "📅 予約" },
              { k: "history" as const, l: "📋 治療経過" },
              { k: "info" as const, l: "👤 基本情報" },
            ]
          ).map((t) => (
            <button
              key={t.k}
              onClick={() => setActiveTab(t.k)}
              className={`flex-1 py-2 rounded-md text-xs font-bold transition-all ${
                activeTab === t.k
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500"
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* ===== Home Tab ===== */}
        {activeTab === "home" && (
          <>
            {/* Next Appointment */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-3">
                📅 次回のご予約
              </h2>
              {upcoming.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-gray-400 text-sm">
                    現在予約はありません
                  </p>
                  <button
                    onClick={() => setActiveTab("book")}
                    className="mt-3 bg-sky-500 hover:bg-sky-600 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-lg shadow-sky-200 transition-colors"
                  >
                    📅 新しい予約を取る
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {upcoming.map((apt) => (
                    <div
                      key={apt.id}
                      className="bg-sky-50 rounded-xl p-4 border border-sky-200"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-lg font-bold text-sky-800">
                            {formatDate(apt.scheduled_at)}
                          </p>
                          <p className="text-2xl font-bold text-sky-600">
                            {formatTime(apt.scheduled_at)}
                          </p>
                        </div>
                        <span className="text-[10px] bg-sky-200 text-sky-800 px-2 py-1 rounded-full font-bold">
                          {apt.patient_type === "new" ? "初診" : "再診"}
                        </span>
                      </div>
                      {lastPlan && (
                        <div className="bg-white rounded-lg px-3 py-2 mt-2">
                          <p className="text-[10px] text-gray-400 font-bold">
                            予定内容
                          </p>
                          <p className="text-xs text-gray-700">{lastPlan}</p>
                        </div>
                      )}
                      <div className="flex gap-2 mt-3">
                        {cancelConfirm === apt.id ? (
                          <>
                            <button
                              onClick={() => cancelAppointment(apt.id)}
                              className="flex-1 bg-red-500 text-white py-2.5 rounded-xl text-xs font-bold"
                            >
                              本当にキャンセル
                            </button>
                            <button
                              onClick={() => setCancelConfirm(null)}
                              className="flex-1 bg-gray-100 text-gray-500 py-2.5 rounded-xl text-xs font-bold"
                            >
                              戻る
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => setCancelConfirm(apt.id)}
                            className="flex-1 bg-white text-red-500 border border-red-200 py-2.5 rounded-xl text-xs font-bold hover:bg-red-50"
                          >
                            予約をキャンセル
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tooth Chart Mini */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-3">
                🦷 お口の状態
              </h2>
              <div className="flex flex-col items-center gap-1">
                <MiniToothRow teeth={[...UR, ...UL]} tc={tc} />
                <div className="w-full border-t border-gray-300 my-0.5" />
                <MiniToothRow teeth={[...LR, ...LL]} tc={tc} />
              </div>
              <div className="flex flex-wrap gap-2 mt-3 justify-center">
                {["caries", "in_treatment", "treated", "missing"].map((s) => {
                  const c = TOOTH_COLORS[s];
                  if (!c) return null;
                  return (
                    <span
                      key={s}
                      className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${c.border} ${c.bg} text-gray-600`}
                    >
                      {c.label}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard
                label="通院回数"
                value={`${past.filter((a) => a.status === "completed").length}回`}
                icon="📊"
              />
              <StatCard
                label="次回予約"
                value={
                  upcoming.length > 0
                    ? formatDateShort(upcoming[0].scheduled_at)
                    : "なし"
                }
                icon="📅"
              />
              <StatCard
                label="残存歯"
                value={`${
                  32 -
                  Object.values(tc).filter(
                    (d) => d?.status === "missing"
                  ).length
                }/32`}
                icon="🦷"
              />
            </div>
          </>
        )}

        {/* ===== History Tab ===== */}
        {activeTab === "history" && (
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-gray-900">📋 治療経過</h2>
            {past.length === 0 && cancelled.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
                <p className="text-sm text-gray-400">
                  治療履歴はまだありません
                </p>
              </div>
            ) : (
              <>
                {past.map((apt) => {
                  const mr = apt.medical_records?.[0];
                  return (
                    <div
                      key={apt.id}
                      className="bg-white rounded-xl border border-gray-200 p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-gray-900">
                            {formatDate(apt.scheduled_at)}
                          </span>
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-bold">
                            {apt.patient_type === "new" ? "初診" : "再診"}
                          </span>
                          {mr?.doctor_confirmed && (
                            <span className="text-[10px] bg-green-100 text-green-600 px-2 py-0.5 rounded font-bold">
                              ✓ 確定
                            </span>
                          )}
                        </div>
                      </div>
                      {mr && (
                        <div className="space-y-1.5 text-xs">
                          {mr.soap_s && (
                            <div>
                              <span className="font-bold text-pink-600">
                                症状:
                              </span>{" "}
                              <span className="text-gray-600">
                                {mr.soap_s}
                              </span>
                            </div>
                          )}
                          {mr.soap_a && (
                            <div>
                              <span className="font-bold text-blue-600">
                                診断:
                              </span>{" "}
                              <span className="text-gray-600">
                                {mr.soap_a}
                              </span>
                            </div>
                          )}
                          {mr.soap_p && (
                            <div>
                              <span className="font-bold text-purple-600">
                                処置・計画:
                              </span>{" "}
                              <span className="text-gray-600">
                                {mr.soap_p}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {cancelled.length > 0 && (
                  <>
                    <p className="text-xs text-gray-400 font-bold mt-4">
                      キャンセル済み
                    </p>
                    {cancelled.map((apt) => (
                      <div
                        key={apt.id}
                        className="bg-gray-50 rounded-xl border border-gray-200 p-3 opacity-60"
                      >
                        <span className="text-sm text-gray-500 line-through">
                          {formatDate(apt.scheduled_at)}{" "}
                          {formatTime(apt.scheduled_at)}
                        </span>
                        <span className="text-[10px] bg-red-100 text-red-500 px-2 py-0.5 rounded font-bold ml-2">
                          キャンセル
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ===== Book Tab ===== */}
        {activeTab === "book" && (
          <div className="space-y-4">
            {bookStep === "complete" ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm text-center">
                <span className="text-5xl">✅</span>
                <h2 className="text-lg font-bold text-gray-900 mt-3">
                  予約が完了しました
                </h2>
                <p className="text-sm text-gray-500 mt-2">
                  {formatDateFull(selectedDate)} {selectedTime}
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  キャンセル・変更はホーム画面から行えます
                </p>
                <button
                  onClick={() => {
                    setActiveTab("home");
                    setBookStep("select_date");
                    setSelectedDate("");
                    setSelectedTime("");
                  }}
                  className="mt-4 bg-sky-500 text-white px-6 py-3 rounded-xl text-sm font-bold"
                >
                  ホームに戻る
                </button>
              </div>
            ) : bookStep === "confirm" ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-bold text-gray-900 mb-4">
                  📅 予約内容の確認
                </h2>
                <div className="bg-sky-50 rounded-xl p-4 border border-sky-200 mb-4">
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">お名前</span>
                      <span className="text-sm font-bold text-gray-900">
                        {patientFull?.name_kanji}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">日付</span>
                      <span className="text-sm font-bold text-sky-700">
                        {formatDateFull(selectedDate)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">時間</span>
                      <span className="text-sm font-bold text-sky-700">
                        {selectedTime}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-gray-500">種別</span>
                      <span className="text-sm font-bold text-gray-700">
                        再診
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={confirmBooking}
                    disabled={bookingLoading}
                    className="flex-1 bg-sky-500 hover:bg-sky-600 text-white py-3 rounded-xl text-sm font-bold disabled:opacity-50 shadow-lg shadow-sky-200"
                  >
                    {bookingLoading ? "予約中..." : "✅ この内容で予約する"}
                  </button>
                  <button
                    onClick={() => setBookStep("select_time")}
                    className="px-4 bg-gray-100 text-gray-500 py-3 rounded-xl text-sm font-bold"
                  >
                    戻る
                  </button>
                </div>
              </div>
            ) : bookStep === "select_time" ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-bold text-gray-900 mb-1">
                  🕐 時間を選択
                </h2>
                <p className="text-xs text-gray-400 mb-4">
                  {formatDateFull(selectedDate)}
                </p>
                <div className="mb-3">
                  <p className="text-[10px] text-gray-400 font-bold mb-2">
                    午前
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {getAvailableTimes()
                      .filter((t) => parseInt(t) < 13)
                      .map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            setSelectedTime(t);
                            setBookStep("confirm");
                          }}
                          className="py-2.5 rounded-lg border-2 border-gray-200 text-sm font-bold text-gray-700 hover:border-sky-400 hover:bg-sky-50 transition-all"
                        >
                          {t}
                        </button>
                      ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] text-gray-400 font-bold mb-2">
                    午後
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {getAvailableTimes()
                      .filter((t) => parseInt(t) >= 13)
                      .map((t) => (
                        <button
                          key={t}
                          onClick={() => {
                            setSelectedTime(t);
                            setBookStep("confirm");
                          }}
                          className="py-2.5 rounded-lg border-2 border-gray-200 text-sm font-bold text-gray-700 hover:border-sky-400 hover:bg-sky-50 transition-all"
                        >
                          {t}
                        </button>
                      ))}
                  </div>
                </div>
                <button
                  onClick={() => setBookStep("select_date")}
                  className="mt-4 w-full bg-gray-100 text-gray-500 py-2.5 rounded-xl text-xs font-bold"
                >
                  ← 日付選択に戻る
                </button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-bold text-gray-900 mb-4">
                  📅 予約日を選択
                </h2>
                <div className="space-y-2 max-h-[400px] overflow-y-auto">
                  {getAvailableDates().map((d) => {
                    const dt = new Date(d + "T00:00:00");
                    const isSat = dt.getDay() === 6;
                    return (
                      <button
                        key={d}
                        onClick={() => {
                          setSelectedDate(d);
                          setBookStep("select_time");
                        }}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all hover:border-sky-400 hover:bg-sky-50 ${
                          isSat
                            ? "border-blue-200 bg-blue-50"
                            : "border-gray-200"
                        }`}
                      >
                        <span className="text-sm font-bold text-gray-800">
                          {formatDateFull(d)}
                        </span>
                        <span className="text-xs text-gray-400">
                          {isSat ? "午前のみ" : "9:00〜18:00"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== Info Tab ===== */}
        {activeTab === "info" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900 mb-4">
              👤 基本情報
            </h2>
            <div className="space-y-3">
              <InfoRow label="お名前" value={patientFull.name_kanji} />
              <InfoRow label="フリガナ" value={patientFull.name_kana} />
              <InfoRow label="患者番号" value={patientFull.patient_number} />
              <InfoRow
                label="生年月日"
                value={
                  patientFull.date_of_birth
                    ? `${patientFull.date_of_birth} (${getAge(patientFull.date_of_birth)})`
                    : null
                }
              />
              <InfoRow label="性別" value={patientFull.sex} />
              <InfoRow label="電話番号" value={patientFull.phone} />
              <InfoRow
                label="保険種別"
                value={patientFull.insurance_type}
              />
              <InfoRow
                label="負担割合"
                value={
                  patientFull.burden_ratio
                    ? `${Math.round(patientFull.burden_ratio * 100)}%`
                    : null
                }
              />
            </div>

            <div className="mt-6 pt-4 border-t border-gray-100">
              <p className="text-[10px] text-gray-400 text-center">
                情報の変更は受付窓口にてお願いいたします
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-lg mx-auto px-4 py-6 text-center">
        <p className="text-[10px] text-gray-300">
          DentalOS Patient Portal v1.0
        </p>
      </footer>
    </div>
  );
}

// ===== Sub Components =====
function MiniToothRow({
  teeth,
  tc,
}: {
  teeth: string[];
  tc: Record<string, ToothData>;
}) {
  return (
    <div className="flex gap-[2px]">
      {teeth.map((t) => {
        const d = tc[t];
        const s = d?.status || "normal";
        const c = TOOTH_COLORS[s] || TOOTH_COLORS.normal;
        return (
          <div
            key={t}
            className={`w-5 h-5 rounded border text-[7px] font-bold flex items-center justify-center ${c.bg} ${c.border}`}
            title={`#${t} ${c.label || "健全"}`}
          >
            {s !== "normal" ? c.label.charAt(0) : ""}
          </div>
        );
      })}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-3 text-center shadow-sm">
      <span className="text-lg">{icon}</span>
      <p className="text-base font-bold text-gray-900 mt-1">{value}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-50">
      <span className="text-xs text-gray-400 font-bold">{label}</span>
      <span className="text-sm text-gray-700 font-bold">{value || "-"}</span>
    </div>
  );
}
