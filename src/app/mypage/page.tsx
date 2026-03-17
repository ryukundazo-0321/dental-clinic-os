"use client";

import { useState, useEffect, useRef } from "react";
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
  notes: string | null;
};

type ToothData = { status?: string };

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

type PatientDiagnosis = {
  id: string;
  diagnosis_name: string;
  tooth_number: string | null;
  start_date: string;
  outcome: string;
  session_total: number | null;
  session_current: number | null;
};

type ChatMessage = {
  id: string; patient_id: string; sender_type: string;
  sender_name: string | null; content: string; is_read: boolean; created_at: string;
};
type PatientImage = {
  id: string;
  image_type: string;
  file_name: string | null;
  storage_path: string;
  created_at: string;
};

type ClinicBlock = {
  id: string;
  block_type: "date" | "weekly" | "daily" | "datetime";
  block_date: string | null;
  day_of_week: number | null;
  time_from: string | null;
  time_to: string | null;
  is_active: boolean;
};

type Tab = "appointment" | "status" | "notice" | "chat" | "documents";

// ===== Constants =====
const UR = ["18","17","16","15","14","13","12","11"];
const UL = ["21","22","23","24","25","26","27","28"];
const LR = ["48","47","46","45","44","43","42","41"];
const LL = ["31","32","33","34","35","36","37","38"];

const TOOTH_COLORS: Record<string, { bg: string; border: string; label: string; dot: string }> = {
  normal:       { bg:"bg-white",       border:"border-gray-200",  label:"健全",   dot:"bg-gray-200" },
  caries:       { bg:"bg-red-100",     border:"border-red-400",   label:"要治療", dot:"bg-red-400" },
  c0:           { bg:"bg-red-50",      border:"border-red-300",   label:"C0",    dot:"bg-red-300" },
  c1:           { bg:"bg-red-100",     border:"border-red-400",   label:"C1",    dot:"bg-red-400" },
  c2:           { bg:"bg-red-100",     border:"border-red-400",   label:"C2",    dot:"bg-red-400" },
  c3:           { bg:"bg-red-200",     border:"border-red-500",   label:"C3",    dot:"bg-red-500" },
  c4:           { bg:"bg-red-200",     border:"border-red-600",   label:"C4",    dot:"bg-red-600" },
  in_treatment: { bg:"bg-orange-100",  border:"border-orange-400",label:"治療中", dot:"bg-orange-400" },
  cr:           { bg:"bg-blue-100",    border:"border-blue-400",  label:"CR",    dot:"bg-blue-400" },
  crown:        { bg:"bg-yellow-100",  border:"border-yellow-400",label:"冠",    dot:"bg-yellow-400" },
  inlay:        { bg:"bg-cyan-100",    border:"border-cyan-400",  label:"In",    dot:"bg-cyan-400" },
  rct:          { bg:"bg-indigo-100",  border:"border-indigo-400",label:"RCT",   dot:"bg-indigo-400" },
  missing:      { bg:"bg-gray-200",    border:"border-gray-300",  label:"欠損",  dot:"bg-gray-400" },
  bridge:       { bg:"bg-orange-100",  border:"border-orange-400",label:"Br",    dot:"bg-orange-400" },
  implant:      { bg:"bg-purple-100",  border:"border-purple-400",label:"IP",    dot:"bg-purple-400" },
  root_remain:  { bg:"bg-pink-100",    border:"border-pink-400",  label:"残根",  dot:"bg-pink-400" },
  watch:        { bg:"bg-amber-100",   border:"border-amber-400", label:"観察",  dot:"bg-amber-400" },
};

// ===== Helpers =====
function formatDate(d: string | null) {
  if (!d) return "-";
  const dt = new Date(d);
  const weekdays = ["日","月","火","水","木","金","土"];
  return `${dt.getFullYear()}/${dt.getMonth()+1}/${dt.getDate()}（${weekdays[dt.getDay()]}）`;
}
function formatTime(d: string | null) {
  if (!d) return "";
  const dt = new Date(d);
  return `${String(dt.getHours()).padStart(2,"0")}:${String(dt.getMinutes()).padStart(2,"0")}`;
}
function formatDateFull(d: string) {
  const dt = new Date(d+"T00:00:00");
  const weekdays = ["日","月","火","水","木","金","土"];
  return `${dt.getMonth()+1}/${dt.getDate()}（${weekdays[dt.getDay()]}）`;
}
function getAge(d: string | null) {
  if (!d) return "-";
  const b = new Date(d), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return `${a}歳`;
}

// ===== Main =====
export default function MyPage() {
  const [loggedIn, setLoggedIn] = useState(false);
  const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
  const [patientNumber, setPatientNumber] = useState("");
  const [pin, setPin] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [patientFull, setPatientFull] = useState<PatientFull | null>(null);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [diagnoses, setDiagnoses] = useState<PatientDiagnosis[]>([]);
  const [images, setImages] = useState<PatientImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<Tab>("appointment");
  const [cancelConfirm, setCancelConfirm] = useState<string | null>(null);

  // 予約シャッター
  const [clinicBlocks, setClinicBlocks] = useState<ClinicBlock[]>([]);

  // 予約
  const [bookStep, setBookStep] = useState<"select_date"|"select_time"|"confirm"|"complete">("select_date");
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [bookingLoading, setBookingLoading] = useState(false);

  // ===== ログイン =====
  async function handleLogin() {
    if (!patientNumber.trim() || !pin.trim()) { setLoginError("患者番号とPINを入力してください"); return; }
    setLoginLoading(true); setLoginError("");
    try {
      const res = await fetch("/api/mypage-login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_number: patientNumber.trim().toUpperCase(), pin: pin.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setPatientInfo(data.patient); setLoggedIn(true);
        sessionStorage.setItem("mypage_patient", JSON.stringify(data.patient));
      } else { setLoginError(data.error || "ログインに失敗しました"); }
    } catch { setLoginError("通信エラーが発生しました"); }
    setLoginLoading(false);
  }

  useEffect(() => {
    const saved = sessionStorage.getItem("mypage_patient");
    if (saved) { try { const p = JSON.parse(saved); setPatientInfo(p); setLoggedIn(true); } catch {} }
  }, []);

  useEffect(() => {
    if (loggedIn && patientInfo) loadPatientData(patientInfo.id);
  }, [loggedIn, patientInfo]);

  async function loadPatientData(patientId: string) {
    setLoading(true);
    const [pRes, aRes, dRes, imgRes, blockRes] = await Promise.all([
      supabase.from("patients").select("id,patient_number,name_kanji,name_kana,date_of_birth,sex,phone,insurance_type,burden_ratio,allergies,current_tooth_chart,notes").eq("id", patientId).single(),
      supabase.from("appointments").select("id,scheduled_at,status,patient_type,medical_records(soap_s,soap_o,soap_a,soap_p,doctor_confirmed)").eq("patient_id", patientId).order("scheduled_at", { ascending: false }),
      supabase.from("patient_diagnoses").select("id,diagnosis_name,tooth_number,start_date,outcome,session_total,session_current").eq("patient_id", patientId).eq("outcome", "continuing").order("start_date", { ascending: false }),
      supabase.from("patient_images").select("id,image_type,file_name,storage_path,created_at").eq("patient_id", patientId).order("created_at", { ascending: false }),
      supabase.from("clinic_blocks").select("*").eq("is_active", true),
    ]);
    if (pRes.data) setPatientFull(pRes.data as PatientFull);
    if (aRes.data) setAppointments(aRes.data as Appointment[]);
    if (dRes.data) setDiagnoses(dRes.data as PatientDiagnosis[]);
    if (imgRes.data) setImages(imgRes.data as PatientImage[]);
    if (blockRes.data) setClinicBlocks(blockRes.data as ClinicBlock[]);
    setLoading(false);
  }

  // チャットメッセージ取得 + Realtime
  useEffect(() => {
    if (!patientFull?.id) return;
    async function fetchChat() {
      const { data } = await supabase.from("chat_messages")
        .select("*").eq("patient_id", patientFull!.id).order("created_at", { ascending: true });
      if (data) setChatMessages(data as ChatMessage[]);
    }
    fetchChat();

    const channel = supabase.channel(`chat-patient-${patientFull.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "chat_messages",
        filter: `patient_id=eq.${patientFull.id}`,
      }, (payload) => {
        setChatMessages(prev => [...prev, payload.new as ChatMessage]);
        setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [patientFull?.id]);

  async function sendChatMessage() {
    if (!chatInput.trim() || chatSending || !patientFull) return;
    setChatSending(true);
    await supabase.from("chat_messages").insert({
      patient_id: patientFull.id,
      sender_type: "patient",
      sender_name: patientFull.name_kanji,
      content: chatInput.trim(),
      is_read: false,
    });
    setChatInput("");
    setChatSending(false);
    setTimeout(() => chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }

  function handleLogout() {
    setLoggedIn(false); setPatientInfo(null); setPatientFull(null);
    setAppointments([]); setDiagnoses([]); setImages([]);
    sessionStorage.removeItem("mypage_patient");
    setPatientNumber(""); setPin("");
  }

  async function cancelAppointment(aptId: string) {
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", aptId);
    setAppointments(prev => prev.map(a => a.id === aptId ? { ...a, status: "cancelled" } : a));
    setCancelConfirm(null);
  }

  // シャッターチェック
  function isDateBlocked(dateStr: string): boolean {
    const dt = new Date(dateStr + "T00:00:00");
    const dow = dt.getDay();
    return clinicBlocks.some(b => {
      if (b.block_type === "date") return b.block_date === dateStr;
      if (b.block_type === "weekly") return b.day_of_week === dow && !b.time_from && !b.time_to;
      return false;
    });
  }

  function isTimeBlocked(dateStr: string, timeStr: string): boolean {
    const dt = new Date(dateStr + "T00:00:00");
    const dow = dt.getDay();
    const [h, m] = timeStr.split(":").map(Number);
    const minutes = h * 60 + m;
    return clinicBlocks.some(b => {
      if (!b.time_from || !b.time_to) return false;
      const [fh, fm] = b.time_from.split(":").map(Number);
      const [th, tm] = b.time_to.split(":").map(Number);
      const from = fh * 60 + fm;
      const to = th * 60 + tm;
      const inRange = minutes >= from && minutes < to;
      if (b.block_type === "daily") return inRange;
      if (b.block_type === "weekly") return b.day_of_week === dow && inRange;
      if (b.block_type === "datetime") return b.block_date === dateStr && inRange;
      return false;
    });
  }

  function getAvailableDates() {
    const dates: string[] = [];
    const now = new Date();
    for (let i = 1; i <= 30; i++) {
      const d = new Date(now); d.setDate(d.getDate() + i);
      if (d.getDay() === 0) continue;
      dates.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`);
    }
    return dates;
  }

  function getAvailableTimes() {
    const times: string[] = [];
    for (let h = 9; h <= 12; h++) { times.push(`${String(h).padStart(2,"0")}:00`); if (h < 13) times.push(`${String(h).padStart(2,"0")}:30`); }
    for (let h = 14; h <= 17; h++) { times.push(`${String(h).padStart(2,"0")}:00`); times.push(`${String(h).padStart(2,"0")}:30`); }
    return times;
  }

  async function confirmBooking() {
    if (!patientFull || !selectedDate || !selectedTime) return;
    setBookingLoading(true);
    try {
      const scheduledAt = `${selectedDate}T${selectedTime}:00`;
      const { error } = await supabase.from("appointments").insert({ patient_id: patientFull.id, scheduled_at: scheduledAt, patient_type: "returning", status: "reserved", duration_min: 30 });
      if (error) { alert("予約の登録に失敗しました。お電話にてご連絡ください。"); }
      else {
        const { data: aptData } = await supabase.from("appointments").select("id").eq("patient_id", patientFull.id).eq("scheduled_at", scheduledAt).single();
        if (aptData) await supabase.from("medical_records").insert({ appointment_id: aptData.id, patient_id: patientFull.id, status: "pending" });
        setBookStep("complete");
        await loadPatientData(patientFull.id);
      }
    } catch { alert("予約の登録に失敗しました"); }
    setBookingLoading(false);
  }

  // ===== ログイン画面 =====
  if (!loggedIn) return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-sky-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-sky-200">
            <span className="text-3xl">🦷</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">DentalOS マイページ</h1>
          <p className="text-sm text-gray-400 mt-1">患者番号とPINでログイン</p>
        </div>
        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-500 mb-1 block">患者番号</label>
            <input type="text" value={patientNumber} onChange={e => setPatientNumber(e.target.value)}
              placeholder="P-00001" onKeyDown={e => e.key === "Enter" && handleLogin()}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-sky-400" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 mb-1 block">PIN（4桁）</label>
            <input type="password" value={pin} onChange={e => setPin(e.target.value)}
              placeholder="****" maxLength={4} onKeyDown={e => e.key === "Enter" && handleLogin()}
              className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 text-sm font-mono tracking-widest focus:outline-none focus:border-sky-400" />
          </div>
          {loginError && <div className="bg-red-50 text-red-600 text-xs font-bold px-4 py-2 rounded-lg">{loginError}</div>}
          <button onClick={handleLogin} disabled={loginLoading}
            className="w-full bg-sky-500 hover:bg-sky-600 text-white py-3 rounded-xl text-sm font-bold disabled:opacity-50 shadow-lg shadow-sky-200">
            {loginLoading ? "ログイン中..." : "ログイン"}
          </button>
          <div className="pt-2 border-t border-gray-100 text-center space-y-1">
            <p className="text-[10px] text-gray-400">初期PINは生年月日の月日4桁です（例: 3月15日 → 0315）</p>
            <p className="text-[10px] text-gray-400">PINがわからない場合は受付にお問い合わせください</p>
          </div>
        </div>
      </div>
    </div>
  );

  if (loading || !patientFull) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-400">読み込み中...</p>
    </div>
  );

  const tc = (patientFull.current_tooth_chart || {}) as Record<string, ToothData>;
  const upcoming = appointments.filter(a => a.status === "reserved" && new Date(a.scheduled_at) >= new Date());
  const past = appointments.filter(a => a.status === "completed" || (a.status === "reserved" && new Date(a.scheduled_at) < new Date()));
  const lastPlan = past.find(a => a.medical_records?.[0]?.soap_p)?.medical_records?.[0]?.soap_p || null;

  // 未処置歯カウント
  const needTreatment = Object.values(tc).filter(d => ["caries","c0","c1","c2","c3","c4","in_treatment"].includes(d.status||"")).length;

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center text-base font-bold">
              {patientFull.name_kanji.charAt(0)}
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">{patientFull.name_kanji}さん</p>
              <p className="text-[10px] text-gray-400">{patientFull.patient_number}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="text-xs text-gray-400 hover:text-gray-600 font-bold px-3 py-1.5 rounded-lg hover:bg-gray-100">
            ログアウト
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-4">

        {/* ===== タブ1: 次回予約 ===== */}
        {activeTab === "appointment" && (
          <div className="space-y-4">
            {/* 次回予約カード */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-3">📅 次回のご予約</h2>
              {upcoming.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-gray-400 text-sm mb-3">現在予約はありません</p>
                  <button onClick={() => { setBookStep("select_date"); setActiveTab("appointment"); }}
                    className="bg-sky-500 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-lg shadow-sky-200">
                    📅 予約を取る
                  </button>
                </div>
              ) : upcoming.map(apt => (
                <div key={apt.id} className="bg-sky-50 rounded-xl p-4 border border-sky-200 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-lg font-bold text-sky-800">{formatDate(apt.scheduled_at)}</p>
                      <p className="text-2xl font-bold text-sky-600">{formatTime(apt.scheduled_at)}</p>
                    </div>
                    <span className="text-[10px] bg-sky-200 text-sky-800 px-2 py-1 rounded-full font-bold">
                      {apt.patient_type === "new" ? "初診" : "再診"}
                    </span>
                  </div>
                  {lastPlan && (
                    <div className="bg-white rounded-lg px-3 py-2 mt-2">
                      <p className="text-[10px] text-gray-400 font-bold">前回の予定内容</p>
                      <p className="text-xs text-gray-700">{lastPlan}</p>
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    {cancelConfirm === apt.id ? (
                      <>
                        <button onClick={() => cancelAppointment(apt.id)} className="flex-1 bg-red-500 text-white py-2.5 rounded-xl text-xs font-bold">本当にキャンセル</button>
                        <button onClick={() => setCancelConfirm(null)} className="flex-1 bg-gray-100 text-gray-500 py-2.5 rounded-xl text-xs font-bold">戻る</button>
                      </>
                    ) : (
                      <button onClick={() => setCancelConfirm(apt.id)} className="flex-1 bg-white text-red-500 border border-red-200 py-2.5 rounded-xl text-xs font-bold hover:bg-red-50">
                        予約をキャンセル
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* 新しい予約を取る */}
            {bookStep === "complete" ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center shadow-sm">
                <span className="text-5xl">✅</span>
                <h2 className="text-lg font-bold text-gray-900 mt-3">予約が完了しました</h2>
                <p className="text-sm text-gray-500 mt-2">{formatDateFull(selectedDate)} {selectedTime}</p>
                <button onClick={() => { setBookStep("select_date"); setSelectedDate(""); setSelectedTime(""); }}
                  className="mt-4 bg-sky-500 text-white px-6 py-3 rounded-xl text-sm font-bold">
                  別の予約を取る
                </button>
              </div>
            ) : bookStep === "confirm" ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-bold text-gray-900 mb-4">📅 予約内容の確認</h2>
                <div className="bg-sky-50 rounded-xl p-4 border border-sky-200 mb-4 space-y-2">
                  <div className="flex justify-between"><span className="text-xs text-gray-500">お名前</span><span className="text-sm font-bold">{patientFull.name_kanji}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-gray-500">日付</span><span className="text-sm font-bold text-sky-700">{formatDateFull(selectedDate)}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-gray-500">時間</span><span className="text-sm font-bold text-sky-700">{selectedTime}</span></div>
                  <div className="flex justify-between"><span className="text-xs text-gray-500">種別</span><span className="text-sm font-bold">再診</span></div>
                </div>
                <div className="flex gap-2">
                  <button onClick={confirmBooking} disabled={bookingLoading}
                    className="flex-1 bg-sky-500 text-white py-3 rounded-xl text-sm font-bold disabled:opacity-50 shadow-lg shadow-sky-200">
                    {bookingLoading ? "予約中..." : "✅ この内容で予約する"}
                  </button>
                  <button onClick={() => setBookStep("select_time")} className="px-4 bg-gray-100 text-gray-500 py-3 rounded-xl text-sm font-bold">戻る</button>
                </div>
              </div>
            ) : bookStep === "select_time" ? (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-bold text-gray-900 mb-1">🕐 時間を選択</h2>
                <p className="text-xs text-gray-400 mb-4">{formatDateFull(selectedDate)}</p>
                <p className="text-[10px] text-gray-400 font-bold mb-2">午前</p>
                <div className="grid grid-cols-4 gap-2 mb-4">
                  {getAvailableTimes().filter(t => parseInt(t) < 13).map(t => {
                    const blocked = isTimeBlocked(selectedDate, t);
                    return (
                      <button key={t} disabled={blocked}
                        onClick={() => { if (!blocked) { setSelectedTime(t); setBookStep("confirm"); } }}
                        className={`py-2.5 rounded-lg border-2 text-sm font-bold transition-all ${blocked ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed" : "border-gray-200 text-gray-700 hover:border-sky-400 hover:bg-sky-50"}`}>
                        {blocked ? "✕" : t}
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-400 font-bold mb-2">午後</p>
                <div className="grid grid-cols-4 gap-2">
                  {getAvailableTimes().filter(t => parseInt(t) >= 14).map(t => {
                    const blocked = isTimeBlocked(selectedDate, t);
                    return (
                      <button key={t} disabled={blocked}
                        onClick={() => { if (!blocked) { setSelectedTime(t); setBookStep("confirm"); } }}
                        className={`py-2.5 rounded-lg border-2 text-sm font-bold transition-all ${blocked ? "border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed" : "border-gray-200 text-gray-700 hover:border-sky-400 hover:bg-sky-50"}`}>
                        {blocked ? "✕" : t}
                      </button>
                    );
                  })}
                </div>
                <button onClick={() => setBookStep("select_date")} className="mt-4 w-full bg-gray-100 text-gray-500 py-2.5 rounded-xl text-xs font-bold">← 日付に戻る</button>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
                <h2 className="text-sm font-bold text-gray-900 mb-4">📅 新しく予約を取る</h2>
                <div className="space-y-2 max-h-[360px] overflow-y-auto">
                  {getAvailableDates().map(d => {
                    const dt = new Date(d+"T00:00:00");
                    const isSat = dt.getDay() === 6;
                    const blocked = isDateBlocked(d);
                    return (
                      <button key={d}
                        disabled={blocked}
                        onClick={() => { if (!blocked) { setSelectedDate(d); setBookStep("select_time"); } }}
                        className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 text-left transition-all ${blocked ? "border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed" : isSat ? "border-blue-200 bg-blue-50 hover:border-sky-400 hover:bg-sky-50" : "border-gray-200 hover:border-sky-400 hover:bg-sky-50"}`}>
                        <span className={`text-sm font-bold ${blocked ? "text-gray-400" : "text-gray-800"}`}>{formatDateFull(d)}</span>
                        <span className="text-xs text-gray-400">{blocked ? "🚫 受付不可" : isSat ? "午前のみ" : "9:00〜18:00"}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== タブ2: 今の治療状況 ===== */}
        {activeTab === "status" && (
          <div className="space-y-4">
            {/* 全顎チャート */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold text-gray-900">🦷 お口の状態</h2>
                <div className="flex items-center gap-3 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />要治療</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />治療中</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />冠</span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-1 mb-3">
                <p className="text-[9px] text-gray-400 self-start">上顎 ← R</p>
                <MiniToothRow teeth={[...UR,...UL]} tc={tc} />
                <div className="w-full border-t border-gray-200 my-0.5" />
                <MiniToothRow teeth={[...LR,...LL]} tc={tc} />
                <p className="text-[9px] text-gray-400 self-start">下顎 ← R</p>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-3">
                <div className="bg-red-50 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-red-600">{needTreatment}</p>
                  <p className="text-[10px] text-red-400">要治療・治療中</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-gray-700">{32 - Object.values(tc).filter(d => d.status === "missing").length}</p>
                  <p className="text-[10px] text-gray-400">残存歯数</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-2.5 text-center">
                  <p className="text-lg font-bold text-blue-600">{past.filter(a => a.status === "completed").length}</p>
                  <p className="text-[10px] text-blue-400">通院回数</p>
                </div>
              </div>
            </div>

            {/* 現在の治療中傷病 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-3">📋 現在の治療状況</h2>
              {diagnoses.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-3">現在治療中の傷病はありません</p>
              ) : (
                <div className="space-y-2">
                  {diagnoses.map(d => {
                    const progress = (d.session_total && d.session_current)
                      ? Math.round((d.session_current / d.session_total) * 100)
                      : null;
                    return (
                      <div key={d.id} className="bg-orange-50 rounded-xl border border-orange-100 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            {d.tooth_number && <span className="text-[10px] bg-orange-200 text-orange-800 px-1.5 py-0.5 rounded font-bold">{d.tooth_number}番</span>}
                            <span className="text-sm font-bold text-gray-800">{d.diagnosis_name}</span>
                          </div>
                          <span className="text-[10px] text-orange-600 font-bold">治療中</span>
                        </div>
                        {progress !== null && (
                          <div>
                            <div className="flex justify-between text-[9px] text-gray-400 mb-0.5">
                              <span>進捗</span>
                              <span>{d.session_current}/{d.session_total}回</span>
                            </div>
                            <div className="w-full bg-orange-100 rounded-full h-1.5">
                              <div className="bg-orange-400 h-1.5 rounded-full transition-all" style={{ width: `${progress}%` }} />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 治療履歴 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-3">🕐 治療履歴</h2>
              {past.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-3">治療履歴はまだありません</p>
              ) : (
                <div className="space-y-2">
                  {past.slice(0, 10).map(apt => {
                    const mr = apt.medical_records?.[0];
                    return (
                      <div key={apt.id} className="border-b border-gray-100 pb-2 last:border-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold text-gray-700">{formatDate(apt.scheduled_at)}</span>
                          <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold">{apt.patient_type === "new" ? "初診" : "再診"}</span>
                          {mr?.doctor_confirmed && <span className="text-[9px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded font-bold">✓ 確定</span>}
                        </div>
                        {mr?.soap_p && <p className="text-[11px] text-gray-500">{mr.soap_p.slice(0, 60)}{mr.soap_p.length > 60 ? "..." : ""}</p>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== タブ3: 先生からのお知らせ ===== */}
        {activeTab === "notice" && (
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-3">🔔 先生からのお知らせ</h2>
              {patientFull.notes ? (
                <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
                  <p className="text-xs font-bold text-sky-700 mb-1">担当医からのメモ</p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{patientFull.notes}</p>
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-3xl mb-3">📭</p>
                  <p className="text-sm text-gray-400">現在お知らせはありません</p>
                </div>
              )}
            </div>

            {/* リコール案内 */}
            {upcoming.length === 0 && (
              <div className="bg-yellow-50 rounded-2xl border border-yellow-200 p-5">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">🦷</span>
                  <div>
                    <p className="text-sm font-bold text-yellow-800 mb-1">定期検診のご案内</p>
                    <p className="text-xs text-yellow-700 leading-relaxed">
                      定期的なメンテナンスが虫歯・歯周病の予防に効果的です。
                      3〜6ヶ月に一度のご来院をお勧めします。
                    </p>
                    <button onClick={() => { setActiveTab("appointment"); setBookStep("select_date"); }}
                      className="mt-3 bg-yellow-500 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-yellow-600">
                      予約を取る →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ===== タブ4: チャット ===== */}
        {activeTab === "chat" && (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col" style={{ height: "calc(100vh - 220px)" }}>
            {/* ヘッダー */}
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <span className="text-base">💬</span>
              <span className="text-sm font-bold text-gray-900">クリニックとのチャット</span>
              {chatMessages.filter(m => !m.is_read && m.sender_type === "staff").length > 0 && (
                <span className="bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                  {chatMessages.filter(m => !m.is_read && m.sender_type === "staff").length}
                </span>
              )}
            </div>
            {/* メッセージ一覧 */}
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50">
              {chatMessages.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-3xl mb-3">💬</p>
                  <p className="text-sm text-gray-400">まだメッセージはありません</p>
                  <p className="text-xs text-gray-300 mt-1">治療に関するご質問などお気軽にどうぞ</p>
                </div>
              ) : chatMessages.map(msg => (
                <div key={msg.id} className={`flex ${msg.sender_type === "patient" ? "justify-end" : "justify-start"}`}>
                  {msg.sender_type === "staff" && (
                    <div className="w-7 h-7 bg-sky-100 text-sky-600 rounded-full flex items-center justify-center text-xs font-bold mr-2 shrink-0 mt-1">
                      🦷
                    </div>
                  )}
                  <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${msg.sender_type === "patient" ? "bg-sky-500 text-white rounded-br-sm" : "bg-white text-gray-800 border border-gray-200 rounded-bl-sm"}`}>
                    <p className="leading-relaxed">{msg.content}</p>
                    <p className={`text-[9px] mt-1 ${msg.sender_type === "patient" ? "text-sky-200" : "text-gray-400"}`}>
                      {new Date(msg.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                      {msg.sender_type === "staff" && " · スタッフ"}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={chatBottomRef} />
            </div>
            {/* 入力エリア */}
            <div className="px-3 py-3 border-t border-gray-200 bg-white flex items-end gap-2">
              <textarea
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChatMessage(); } }}
                placeholder="メッセージを入力..."
                rows={2}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:border-sky-400"
              />
              <button onClick={sendChatMessage} disabled={chatSending || !chatInput.trim()}
                className="bg-sky-500 text-white w-10 h-10 rounded-xl flex items-center justify-center hover:bg-sky-600 disabled:opacity-40 shrink-0">
                {chatSending ? "⏳" : "→"}
              </button>
            </div>
          </div>
        )}

        {/* ===== タブ5: 書類確認 ===== */}
        {activeTab === "documents" && (
          <div className="space-y-4">
            {/* 画像・資料 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-3">📄 書類・資料</h2>
              {images.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-3xl mb-2">📂</p>
                  <p className="text-sm text-gray-400">書類・資料はまだありません</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {images.map(img => {
                    const pubUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL || ""}/storage/v1/object/public/patient-images/${img.storage_path}`;
                    return (
                      <div key={img.id} className="flex items-center justify-between bg-gray-50 rounded-xl p-3 border border-gray-200">
                        <div className="flex items-center gap-3">
                          <span className="text-2xl">
                            {img.image_type === "panorama" ? "🦷" : img.image_type === "xray" ? "📷" : "📄"}
                          </span>
                          <div>
                            <p className="text-sm font-bold text-gray-700">{img.file_name || img.image_type}</p>
                            <p className="text-[10px] text-gray-400">{new Date(img.created_at).toLocaleDateString("ja-JP")}</p>
                          </div>
                        </div>
                        <a href={pubUrl} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-bold text-sky-600 bg-sky-50 border border-sky-200 px-3 py-1.5 rounded-lg hover:bg-sky-100">
                          確認 →
                        </a>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 基本情報確認 */}
            <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
              <h2 className="text-sm font-bold text-gray-900 mb-3">👤 ご登録情報</h2>
              <div className="space-y-2">
                {[
                  { l:"お名前", v: patientFull.name_kanji },
                  { l:"フリガナ", v: patientFull.name_kana },
                  { l:"患者番号", v: patientFull.patient_number },
                  { l:"生年月日", v: patientFull.date_of_birth ? `${patientFull.date_of_birth}（${getAge(patientFull.date_of_birth)}）` : "-" },
                  { l:"性別", v: patientFull.sex },
                  { l:"電話番号", v: patientFull.phone },
                  { l:"保険種別", v: patientFull.insurance_type },
                  { l:"負担割合", v: patientFull.burden_ratio ? `${Math.round(patientFull.burden_ratio*100)}%` : "-" },
                ].map(({ l, v }) => (
                  <div key={l} className="flex justify-between py-1.5 border-b border-gray-50">
                    <span className="text-xs text-gray-400 font-bold">{l}</span>
                    <span className="text-xs text-gray-700 font-bold">{v || "-"}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 text-center mt-4">情報の変更は受付窓口にてお願いいたします</p>
            </div>
          </div>
        )}
      </main>

      {/* ===== ボトムナビゲーション ===== */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-20">
        <div className="max-w-lg mx-auto flex">
          {([
            { k: "appointment" as Tab, icon: "📅", label: "予約" },
            { k: "status" as Tab,      icon: "🦷", label: "治療状況" },
            { k: "notice" as Tab,      icon: "🔔", label: "お知らせ" },
            { k: "chat" as Tab,        icon: "💬", label: "チャット" },
            { k: "documents" as Tab,   icon: "📄", label: "書類" },
          ] as { k: Tab; icon: string; label: string }[]).map(t => (
            <button key={t.k} onClick={() => setActiveTab(t.k)}
              className={`flex-1 flex flex-col items-center py-2.5 transition-all ${activeTab === t.k ? "text-sky-600" : "text-gray-400"}`}>
              <span className="text-xl">{t.icon}</span>
              <span className={`text-[9px] font-bold mt-0.5 ${activeTab === t.k ? "text-sky-600" : "text-gray-400"}`}>{t.label}</span>
              {activeTab === t.k && <span className="w-1 h-1 bg-sky-500 rounded-full mt-0.5" />}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

// ===== サブコンポーネント =====
function MiniToothRow({ teeth, tc }: { teeth: string[]; tc: Record<string, ToothData> }) {
  return (
    <div className="flex gap-[2px]">
      {teeth.map(t => {
        const d = tc[t]; const s = d?.status || "normal";
        const c = TOOTH_COLORS[s] || TOOTH_COLORS.normal;
        return (
          <div key={t} title={`#${t} ${c.label}`}
            className={`w-6 h-6 rounded border text-[7px] font-bold flex items-center justify-center ${c.bg} ${c.border}`}>
            {s !== "normal" ? c.label.charAt(0) : ""}
          </div>
        );
      })}
    </div>
  );
}
