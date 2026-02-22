"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
  patients: { id: string; name_kanji: string; name_kana: string; phone: string; is_new: boolean; date_of_birth?: string } | null;
  medical_records: { id: string; status: string }[] | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; blockBg: string; icon: string }> = {
  reserved:        { label: "予約済",     color: "text-blue-700",   bg: "bg-blue-50",    border: "border-l-blue-500",   blockBg: "bg-blue-50",     icon: "📅" },
  checked_in:      { label: "来院済",     color: "text-green-700",  bg: "bg-green-50",   border: "border-l-green-500",  blockBg: "bg-green-50",    icon: "📱" },
  in_consultation: { label: "診察中",     color: "text-orange-700", bg: "bg-orange-50",  border: "border-l-orange-500", blockBg: "bg-orange-50",   icon: "🩺" },
  completed:       { label: "完了",       color: "text-purple-700", bg: "bg-purple-50",  border: "border-l-purple-500", blockBg: "bg-purple-50",   icon: "✅" },
  billing_done:    { label: "会計済",     color: "text-gray-500",   bg: "bg-gray-50",    border: "border-l-gray-400",   blockBg: "bg-gray-100",    icon: "💰" },
  cancelled:       { label: "キャンセル", color: "text-red-700",    bg: "bg-red-50",     border: "border-l-red-500",    blockBg: "bg-red-50",      icon: "❌" },
};

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);

type ViewMode = "doctor" | "chair";

// 日本時間の今日の日付をYYYY-MM-DD形式で取得
function getTodayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
}

export default function ConsultationPage() {
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(getTodayJST);
  const [loading, setLoading] = useState(true);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("doctor");

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

  const fetchAppointments = useCallback(async () => {
    const { data } = await supabase.from("appointments")
      .select(`id, scheduled_at, patient_type, status, duration_min, doctor_id, unit_id,
        patients ( id, name_kanji, name_kana, phone, is_new, date_of_birth ),
        medical_records ( id, status )`)
      .gte("scheduled_at", `${selectedDate}T00:00:00+00`)
      .lte("scheduled_at", `${selectedDate}T23:59:59+00`)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    if (data) setAppointments(data as unknown as Appointment[]);
  }, [selectedDate]);

  useEffect(() => {
    fetchAppointments();
    const channel = supabase.channel("consultation-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => fetchAppointments())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue" }, () => fetchAppointments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedDate, fetchAppointments]);

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

  // scheduled_atの文字列から時:分を直接取得（タイムゾーン変換を回避）
  function parseScheduledHourMin(apt: Appointment): [number, number] {
    const raw = apt.scheduled_at;
    const match = raw.match(/(\d{2}):(\d{2}):\d{2}/);
    if (match) return [parseInt(match[1]), parseInt(match[2])];
    return [0, 0];
  }

  function getAptTime(apt: Appointment) {
    const [h, m] = parseScheduledHourMin(apt);
    return h.toString().padStart(2, "0") + ":" + m.toString().padStart(2, "0");
  }

  function getAptEndTime(apt: Appointment) {
    const [h, m] = parseScheduledHourMin(apt);
    const totalMin = h * 60 + m + (apt.duration_min || 30);
    const eh = Math.floor(totalMin / 60);
    const em = totalMin % 60;
    return eh.toString().padStart(2, "0") + ":" + em.toString().padStart(2, "0");
  }

  function getAge(dob?: string) {
    if (!dob) return null;
    const b = new Date(dob), t = new Date();
    let a = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
    return a;
  }

  function goToday() { setSelectedDate(getTodayJST()); }
  function goPrev() { const d = new Date(selectedDate + "T12:00:00"); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().split("T")[0]); }
  function goNext() { const d = new Date(selectedDate + "T12:00:00"); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().split("T")[0]); }

  // カラム: viewModeに応じて担当医別 or チェア別
  const columns = useMemo(() => {
    const cols: { id: string; label: string }[] = [];
    if (viewMode === "doctor") {
      if (doctors.length > 0) {
        doctors.forEach(d => cols.push({ id: d.id, label: d.name }));
      }
    } else {
      if (units.length > 0) {
        units.forEach(u => cols.push({ id: u.id, label: u.name }));
      }
    }
    cols.push({ id: "__unassigned__", label: "未割当" });
    return cols;
  }, [doctors, units, viewMode]);

  const aptsByColumn = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    columns.forEach(c => map.set(c.id, []));
    appointments.forEach(apt => {
      const key = viewMode === "doctor" ? apt.doctor_id : apt.unit_id;
      const target = key && map.has(key) ? key : "__unassigned__";
      map.get(target)?.push(apt);
    });
    return map;
  }, [appointments, columns, viewMode]);

  // ミニカレンダー
  const miniCalDays = useMemo(() => {
    const d = new Date(selectedDate + "T12:00:00");
    const year = d.getFullYear(), month = d.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const lastDate = new Date(year, month + 1, 0).getDate();
    const days: (number | null)[] = [];
    for (let i = 0; i < firstDay; i++) days.push(null);
    for (let i = 1; i <= lastDate; i++) days.push(i);
    return { year, month, days };
  }, [selectedDate]);

  const statusCounts: Record<string, number> = {};
  appointments.forEach((a) => { statusCounts[a.status] = (statusCounts[a.status] || 0) + 1; });

  const checkedInApts = appointments.filter(a => ["checked_in", "in_consultation", "completed"].includes(a.status));

  if (loading || !config) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* === メインエリア === */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ヘッダー */}
        <header className="bg-white border-b border-gray-200 shadow-sm px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">🩺 診察カレンダー</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={goPrev} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">◀</button>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-bold text-sm" />
              <button onClick={goNext} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">▶</button>
              <button onClick={goToday} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-xs text-gray-500">今日</button>
            </div>
            <span className="text-xs text-gray-400">本日の予約: {appointments.length}件</span>
            <div className="flex gap-1.5">
              {["reserved", "checked_in", "in_consultation", "completed", "billing_done"].map((s) => (
                <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}`}>
                  {STATUS_CONFIG[s].icon} {statusCounts[s] || 0}
                </span>
              ))}
            </div>
          </div>
        </header>

        {/* ビュー切替タブ */}
        <div className="bg-white border-b border-gray-200 px-4 py-1.5 flex items-center gap-1">
          <button
            onClick={() => setViewMode("doctor")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              viewMode === "doctor"
                ? "bg-sky-500 text-white shadow-sm"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            👨‍⚕️ 担当医別
          </button>
          <button
            onClick={() => setViewMode("chair")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
              viewMode === "chair"
                ? "bg-emerald-500 text-white shadow-sm"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            🪥 チェア別
          </button>
        </div>

        {/* タイムテーブル */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-[700px]">
            {/* カラムヘッダー */}
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex shadow-sm">
              <div className="w-16 flex-shrink-0 border-r border-gray-200" />
              {columns.map(col => {
                // チェアビュー時のリアルタイム状態
                const colApts = aptsByColumn.get(col.id) || [];
                const inUse = colApts.find(a => a.status === "in_consultation");
                const waiting = colApts.filter(a => a.status === "checked_in");
                const chairStatus = viewMode === "chair" && col.id !== "__unassigned__"
                  ? inUse ? "in_use" : waiting.length > 0 ? "waiting" : "empty"
                  : null;
                return (
                <div key={col.id} className={`flex-1 min-w-[160px] px-2 py-2.5 border-r border-gray-100 text-center ${col.id === "__unassigned__" ? "bg-amber-50" : ""}`}>
                  <p className={`text-xs font-bold ${col.id === "__unassigned__" ? "text-amber-700" : "text-gray-700"}`}>{col.label}</p>
                  {chairStatus === "in_use" && <span className="text-[9px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full mt-0.5 inline-block">🩺 使用中 — {inUse?.patients?.name_kanji}</span>}
                  {chairStatus === "waiting" && <span className="text-[9px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full mt-0.5 inline-block">📱 待機{waiting.length}人</span>}
                  {chairStatus === "empty" && <span className="text-[9px] font-bold bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full mt-0.5 inline-block">空き</span>}
                </div>
                );
              })}
            </div>

            {/* 時間グリッド */}
            {HOURS.map(hour => (
              <div key={hour} className="flex border-b border-gray-100" style={{ minHeight: "120px" }}>
                <div className="w-16 flex-shrink-0 border-r border-gray-200 pr-2 pt-1 text-right">
                  <span className="text-[10px] text-gray-400 font-bold">{hour}:00</span>
                </div>
                {columns.map(col => {
                  const colApts = (aptsByColumn.get(col.id) || []).filter(apt => {
                    return parseScheduledHourMin(apt)[0] === hour;
                  });
                  return (
                    <div key={col.id}
                      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; (e.currentTarget as HTMLElement).classList.add("bg-sky-50"); }}
                      onDragLeave={(e) => { (e.currentTarget as HTMLElement).classList.remove("bg-sky-50"); }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).classList.remove("bg-sky-50");
                        const aptId = e.dataTransfer.getData("apt_id");
                        if (!aptId || col.id === "__unassigned__") return;
                        if (viewMode === "chair") {
                          await assignUnit(aptId, col.id);
                        } else {
                          await assignDoctor(aptId, col.id);
                        }
                      }}
                      className={`flex-1 min-w-[160px] border-r border-gray-50 relative px-1 py-0.5 transition-colors ${col.id === "__unassigned__" ? "bg-amber-50/30" : ""}`}>
                      {colApts.map(apt => {
                        const st = STATUS_CONFIG[apt.status] || STATUS_CONFIG.reserved;
                        const duration = apt.duration_min || 30;
                        const blockHeight = Math.max(duration * 2, 48);
                        const minuteOffset = parseScheduledHourMin(apt)[1];
                        const topOffset = minuteOffset * 2;
                        const age = getAge(apt.patients?.date_of_birth);
                        const unitName = units.find(u => u.id === apt.unit_id)?.name;
                        const doctorName = doctors.find(d => d.id === apt.doctor_id)?.name;

                        return (
                          <div key={apt.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("apt_id", apt.id);
                              e.dataTransfer.effectAllowed = "move";
                              (e.currentTarget as HTMLElement).style.opacity = "0.5";
                            }}
                            onDragEnd={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; }}
                            onClick={() => setSelectedApt(apt)}
                            className={`absolute left-1 right-1 rounded-lg border-l-4 ${st.border} ${st.blockBg} border border-gray-200 cursor-grab hover:shadow-md hover:scale-[1.01] transition-all overflow-hidden ${selectedApt?.id === apt.id ? "ring-2 ring-sky-400 shadow-md" : ""}`}
                            style={{ top: `${topOffset}px`, height: `${blockHeight}px`, zIndex: selectedApt?.id === apt.id ? 5 : 1 }}>
                            <div className="px-2 py-1 h-full flex flex-col">
                              <div className="flex items-center justify-between">
                                <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${st.bg} ${st.color}`}>{st.label}</span>
                                <span className="text-[9px] text-gray-400">{getAptTime(apt)}-{getAptEndTime(apt)}</span>
                              </div>
                              <p className="text-xs font-bold text-gray-900 mt-0.5 truncate">
                                {apt.patients?.name_kanji || "未登録"}
                                {age !== null && <span className="text-[9px] font-normal text-gray-400 ml-1">({age})</span>}
                              </p>
                              {blockHeight > 55 && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {apt.patient_type === "new" && <span className="text-[8px] font-bold bg-red-100 text-red-600 px-1 rounded">初診</span>}
                                  {viewMode === "chair" && doctorName && (
                                    <span className="text-[8px] bg-indigo-50 text-indigo-600 px-1 rounded">{doctorName}</span>
                                  )}
                                  {viewMode === "doctor" && unitName && (
                                    <span className="text-[8px] bg-emerald-50 text-emerald-600 px-1 rounded">{unitName}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* === 右サイドバー === */}
      <div className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
        {/* ミニカレンダー */}
        <div className="p-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-700">{miniCalDays.year}年{miniCalDays.month + 1}月</span>
            <div className="flex gap-1">
              <button onClick={() => { const d = new Date(selectedDate + "T12:00:00"); d.setMonth(d.getMonth() - 1); setSelectedDate(d.toISOString().split("T")[0]); }}
                className="text-xs text-gray-400 hover:text-gray-700 px-1">‹</button>
              <button onClick={() => { const d = new Date(selectedDate + "T12:00:00"); d.setMonth(d.getMonth() + 1); setSelectedDate(d.toISOString().split("T")[0]); }}
                className="text-xs text-gray-400 hover:text-gray-700 px-1">›</button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {["日","月","火","水","木","金","土"].map(d => <span key={d} className="text-[9px] text-gray-400 font-bold">{d}</span>)}
            {miniCalDays.days.map((day, i) => {
              if (!day) return <span key={`e-${i}`} />;
              const dateStr = `${miniCalDays.year}-${String(miniCalDays.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isSelected = dateStr === selectedDate;
              const isToday = dateStr === getTodayJST();
              return (
                <button key={day} onClick={() => setSelectedDate(dateStr)}
                  className={`text-[10px] w-6 h-6 rounded-full flex items-center justify-center transition-colors
                    ${isSelected ? "bg-sky-500 text-white font-bold" : isToday ? "bg-sky-100 text-sky-700 font-bold" : "text-gray-600 hover:bg-gray-100"}`}>
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* 受付一覧 */}
        <div className="p-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-gray-700">受付一覧</h3>
            <div className="flex gap-1">
              {["checked_in", "in_consultation", "completed"].map(s => (
                <span key={s} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}`}>
                  {STATUS_CONFIG[s].label} {statusCounts[s] || 0}
                </span>
              ))}
            </div>
          </div>
          {checkedInApts.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">受付患者なし</p>
          ) : (
            <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
              {checkedInApts.map(apt => {
                const st = STATUS_CONFIG[apt.status] || STATUS_CONFIG.reserved;
                return (
                  <button key={apt.id} onClick={() => setSelectedApt(apt)}
                    className={`w-full text-left rounded-lg p-2 border transition-colors ${selectedApt?.id === apt.id ? "border-sky-400 bg-sky-50" : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${st.bg} ${st.color}`}>{st.label}</span>
                        <span className="text-xs font-bold text-gray-800 truncate">{apt.patients?.name_kanji || "未登録"}</span>
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0">{getAptTime(apt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 詳細パネル */}
        {selectedApt ? (
          <div className="p-3 flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-700">患者詳細</h3>
              <button onClick={() => setSelectedApt(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-br from-sky-100 to-sky-200 text-sky-700 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold">
                  {(selectedApt.patients?.name_kanji || "?").charAt(0)}
                </div>
                <div>
                  <p className="font-bold text-gray-900 text-sm">{selectedApt.patients?.name_kanji || "未登録"}</p>
                  <p className="text-[10px] text-gray-400">{selectedApt.patients?.name_kana}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-gray-400">時間</p><p className="text-gray-900 font-bold">{getAptTime(selectedApt)} - {getAptEndTime(selectedApt)}</p></div>
                <div><p className="text-gray-400">区分</p><p className="text-gray-900 font-bold">{selectedApt.patient_type === "new" ? "初診" : "再診"}</p></div>
              </div>

              <div><p className="text-[10px] text-gray-400">電話</p><p className="text-xs text-gray-700">{selectedApt.patients?.phone || "-"}</p></div>

              <div>
                <p className="text-[10px] text-gray-400 mb-1">ユニット</p>
                <select value={selectedApt.unit_id || ""} onChange={(e) => assignUnit(selectedApt.id, e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                  <option value="">未割り当て</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>

              <div>
                <p className="text-[10px] text-gray-400 mb-1">担当医</p>
                <select value={selectedApt.doctor_id || ""} onChange={(e) => assignDoctor(selectedApt.id, e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                  <option value="">未割り当て</option>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div className="border-t border-gray-100 pt-2">
                <p className="text-[10px] text-gray-400 mb-1">カルテ</p>
                {selectedApt.medical_records?.length ? (
                  <p className="text-[10px] text-green-600 font-bold">✅ {selectedApt.medical_records[0].status}</p>
                ) : <p className="text-[10px] text-gray-400">未作成</p>}
              </div>

              <div className="border-t border-gray-100 pt-2">
                <p className="text-[10px] text-gray-400 mb-1">ステータス</p>
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
                  <button onClick={async () => {
                    await updateStatus(selectedApt, "in_consultation");
                    window.location.href = `/consultation/session?appointment_id=${selectedApt.id}`;
                  }}
                    className="w-full py-3 rounded-lg text-sm font-bold bg-orange-500 text-white hover:bg-orange-600 text-center shadow-lg shadow-orange-200">🩺 呼び出し（診察開始）→</button>
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
                {selectedApt.patients?.id && (
                  <Link href={`/chart?patient_id=${selectedApt.patients.id}`}
                    className="block w-full py-2 rounded-lg text-xs font-bold bg-sky-50 text-sky-700 hover:bg-sky-100 text-center">📋 カルテを開く</Link>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 flex-1 flex items-center justify-center">
            <p className="text-xs text-gray-400 text-center">予約ブロックをクリックすると<br />詳細が表示されます</p>
          </div>
        )}
      </div>
    </div>
  );
}
