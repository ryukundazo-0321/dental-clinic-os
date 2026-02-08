"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getClinicConfig, getDoctors, type ClinicConfig, type DoctorOption } from "@/lib/reservation-utils";

type Unit = { id: string; unit_number: number; name: string; unit_type: string; is_active: boolean };

type Appointment = {
  id: string;
  scheduled_at: string;
  patient_type: string;
  status: string;
  duration_min: number;
  doctor_id: string | null;
  unit_id: string | null;
  patients: { id: string; name_kanji: string; name_kana: string; phone: string; is_new: boolean } | null;
  medical_records: { id: string; status: string }[] | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; icon: string }> = {
  reserved:        { label: "予約済",     color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-300",   icon: "📅" },
  checked_in:      { label: "来院済",     color: "text-green-700",  bg: "bg-green-50",   border: "border-green-300",  icon: "📱" },
  in_consultation: { label: "診察中",     color: "text-orange-700", bg: "bg-orange-50",  border: "border-orange-300", icon: "🩺" },
  completed:       { label: "完了",       color: "text-purple-700", bg: "bg-purple-50",  border: "border-purple-300", icon: "✅" },
  billing_done:    { label: "会計済",     color: "text-gray-500",   bg: "bg-gray-50",    border: "border-gray-300",   icon: "💰" },
  cancelled:       { label: "キャンセル", color: "text-red-700",    bg: "bg-red-50",     border: "border-red-300",    icon: "❌" },
};

export default function ConsultationPage() {
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(true);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);

  useEffect(() => {
    async function init() {
      const c = await getClinicConfig();
      setConfig(c);
      if (c) {
        const docs = await getDoctors(c.clinicId);
        setDoctors(docs);
        const { data: u } = await supabase.from("units").select("*").eq("is_active", true).order("unit_number");
        if (u) setUnits(u as Unit[]);
      }
      setLoading(false);
    }
    init();
  }, []);

  useEffect(() => {
    fetchAppointments();
    const channel = supabase.channel("consultation-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => fetchAppointments())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue" }, () => fetchAppointments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedDate]);

  async function fetchAppointments() {
    const { data } = await supabase.from("appointments")
      .select(`id, scheduled_at, patient_type, status, duration_min, doctor_id, unit_id,
        patients ( id, name_kanji, name_kana, phone, is_new ),
        medical_records ( id, status )`)
      .gte("scheduled_at", `${selectedDate}T00:00:00+09:00`)
      .lte("scheduled_at", `${selectedDate}T23:59:59+09:00`)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    if (data) setAppointments(data as unknown as Appointment[]);
  }

  async function updateStatus(apt: Appointment, newStatus: string) {
    await supabase.from("appointments").update({ status: newStatus }).eq("id", apt.id);
    if (newStatus === "in_consultation") {
      await supabase.from("queue").update({ status: "in_room", called_at: new Date().toISOString() }).eq("appointment_id", apt.id);
    } else if (newStatus === "completed") {
      if (apt.medical_records?.length) {
        await supabase.from("medical_records").update({ status: "confirmed", doctor_confirmed: true }).eq("appointment_id", apt.id);
      }
      await supabase.from("queue").update({ status: "done" }).eq("appointment_id", apt.id);
    }
    setAppointments((prev) => prev.map((a) => a.id === apt.id ? { ...a, status: newStatus } : a));
    if (selectedApt?.id === apt.id) setSelectedApt((prev) => prev ? { ...prev, status: newStatus } : null);
  }

  async function assignUnit(aptId: string, unitId: string) {
    await supabase.from("appointments").update({ unit_id: unitId || null }).eq("id", aptId);
    setAppointments((prev) => prev.map((a) => a.id === aptId ? { ...a, unit_id: unitId || null } : a));
    if (selectedApt?.id === aptId) setSelectedApt((prev) => prev ? { ...prev, unit_id: unitId || null } : null);
  }

  async function assignDoctor(aptId: string, doctorId: string) {
    await supabase.from("appointments").update({ doctor_id: doctorId || null }).eq("id", aptId);
    setAppointments((prev) => prev.map((a) => a.id === aptId ? { ...a, doctor_id: doctorId || null } : a));
    if (selectedApt?.id === aptId) setSelectedApt((prev) => prev ? { ...prev, doctor_id: doctorId || null } : null);
  }

  function getAptTime(apt: Appointment) {
    const d = new Date(apt.scheduled_at);
    return d.getHours().toString().padStart(2, "0") + ":" + d.getMinutes().toString().padStart(2, "0");
  }

  if (loading || !config) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;

  const statusCounts: Record<string, number> = {};
  appointments.forEach((a) => { statusCounts[a.status] = (statusCounts[a.status] || 0) + 1; });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-full mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">🩺 診察カレンダー</h1>
          </div>
          <div className="flex gap-2">
            {["reserved", "checked_in", "in_consultation", "completed", "billing_done"].map((s) => (
              <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}`}>
                {STATUS_CONFIG[s].icon} {statusCounts[s] || 0}
              </span>
            ))}
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-3">
        {/* 日付ナビ */}
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().split("T")[0]); }}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">◀</button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-bold text-sm" />
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().split("T")[0]); }}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">▶</button>
          <button onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-xs text-gray-500">今日</button>
          <span className="text-xs text-gray-400 ml-2">本日の予約: {appointments.length}件</span>
        </div>

        <div className="flex gap-3">
          {/* 左: 予約リスト */}
          <div className="flex-1 overflow-auto">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* テーブルヘッダー */}
              <div className="grid grid-cols-[70px_1fr_130px_130px_90px] bg-gray-50 border-b border-gray-200 px-3 py-2">
                <p className="text-[10px] font-bold text-gray-500">時間</p>
                <p className="text-[10px] font-bold text-gray-500">患者名</p>
                <p className="text-[10px] font-bold text-gray-500">ユニット</p>
                <p className="text-[10px] font-bold text-gray-500">担当医</p>
                <p className="text-[10px] font-bold text-gray-500">状態</p>
              </div>

              {appointments.length === 0 ? (
                <div className="text-center py-16">
                  <p className="text-gray-300 text-4xl mb-2">📅</p>
                  <p className="text-gray-400 text-sm">本日の予約はありません</p>
                </div>
              ) : (
                appointments.map((apt) => {
                  const status = STATUS_CONFIG[apt.status] || STATUS_CONFIG.reserved;
                  const isSelected = selectedApt?.id === apt.id;
                  return (
                    <button key={apt.id} onClick={() => setSelectedApt(apt)}
                      className={`w-full grid grid-cols-[70px_1fr_130px_130px_90px] items-center px-3 py-3 border-b border-gray-100 text-left hover:bg-sky-50 transition-colors ${isSelected ? "bg-sky-50 ring-inset ring-2 ring-sky-400" : ""}`}>
                      <p className="text-sm font-bold text-gray-800">{getAptTime(apt)}</p>
                      <div>
                        <p className="text-sm font-bold text-gray-900">{apt.patients?.name_kanji || "未登録"}</p>
                        <p className="text-[10px] text-gray-400">{apt.patients?.name_kana} / {apt.patient_type === "new" ? "初診" : "再診"}</p>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <select value={apt.unit_id || ""} onChange={(e) => assignUnit(apt.id, e.target.value)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs bg-white w-full focus:border-sky-400 focus:outline-none">
                          <option value="">未割当</option>
                          {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                        </select>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <select value={apt.doctor_id || ""} onChange={(e) => assignDoctor(apt.id, e.target.value)}
                          className="border border-gray-200 rounded px-1.5 py-1 text-xs bg-white w-full focus:border-purple-400 focus:outline-none">
                          <option value="">未割当</option>
                          {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-2 py-1 rounded-full ${status.bg} ${status.color}`}>
                        {status.icon} {status.label}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* 右: 詳細パネル */}
          {selectedApt && (
            <div className="w-80 flex-shrink-0 hidden lg:block">
              <div className="bg-white rounded-xl border border-gray-200 p-4 sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-900 text-sm">詳細</h3>
                  <button onClick={() => setSelectedApt(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-sky-100 text-sky-700 w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold">
                      {(selectedApt.patients?.name_kanji || "?").charAt(0)}
                    </div>
                    <div>
                      <p className="font-bold text-gray-900 text-base">{selectedApt.patients?.name_kanji || "未登録"}</p>
                      <p className="text-xs text-gray-400">{selectedApt.patients?.name_kana}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div><p className="text-xs text-gray-400">時間</p><p className="text-sm font-bold">{getAptTime(selectedApt)}</p></div>
                    <div><p className="text-xs text-gray-400">区分</p><p className="text-sm font-bold">{selectedApt.patient_type === "new" ? "初診" : "再診"}</p></div>
                  </div>
                  <div><p className="text-xs text-gray-400">電話</p><p className="text-sm">{selectedApt.patients?.phone || "-"}</p></div>

                  <div>
                    <p className="text-xs text-gray-400 mb-1">ユニット</p>
                    <select value={selectedApt.unit_id || ""} onChange={(e) => assignUnit(selectedApt.id, e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-sky-400">
                      <option value="">未割り当て</option>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>

                  <div>
                    <p className="text-xs text-gray-400 mb-1">担当医</p>
                    <select value={selectedApt.doctor_id || ""} onChange={(e) => assignDoctor(selectedApt.id, e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-sky-400">
                      <option value="">未割り当て</option>
                      {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>

                  <div className="border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-400 mb-1">カルテ</p>
                    {selectedApt.medical_records?.length ? (
                      <p className="text-xs text-green-600 font-bold">✅ {selectedApt.medical_records[0].status}</p>
                    ) : <p className="text-xs text-gray-400">未作成</p>}
                  </div>

                  <div className="border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-400 mb-1">ステータス</p>
                    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${STATUS_CONFIG[selectedApt.status]?.bg} ${STATUS_CONFIG[selectedApt.status]?.color}`}>
                      {STATUS_CONFIG[selectedApt.status]?.icon} {STATUS_CONFIG[selectedApt.status]?.label}
                    </span>
                  </div>

                  {/* アクションボタン */}
                  <div className="border-t border-gray-100 pt-3 space-y-2">
                    {selectedApt.status === "reserved" && (
                      <button onClick={() => updateStatus(selectedApt, "checked_in")}
                        className="w-full py-2.5 rounded-lg text-sm font-bold bg-green-500 text-white hover:bg-green-600 shadow-lg shadow-green-200">📱 来院済にする</button>
                    )}
                    {selectedApt.status === "checked_in" && (
                      <a href={`/consultation/session?appointment_id=${selectedApt.id}`}
                        onClick={() => updateStatus(selectedApt, "in_consultation")}
                        className="block w-full py-3 rounded-lg text-sm font-bold bg-orange-500 text-white hover:bg-orange-600 text-center shadow-lg shadow-orange-200">🩺 呼び出し（診察開始）→</a>
                    )}
                    {selectedApt.status === "in_consultation" && (
                      <>
                        <a href={`/consultation/session?appointment_id=${selectedApt.id}`}
                          className="block w-full py-3 rounded-lg text-sm font-bold bg-sky-500 text-white hover:bg-sky-600 text-center shadow-lg shadow-sky-200">📋 診察画面を開く →</a>
                        <button onClick={() => updateStatus(selectedApt, "completed")}
                          className="w-full py-2 rounded-lg text-xs font-bold bg-purple-100 text-purple-700 hover:bg-purple-200">✅ 診察完了</button>
                      </>
                    )}
                    {selectedApt.status === "completed" && (
                      <button onClick={() => updateStatus(selectedApt, "billing_done")}
                        className="w-full py-2.5 rounded-lg text-sm font-bold bg-gray-200 text-gray-700 hover:bg-gray-300">💰 会計済にする</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
