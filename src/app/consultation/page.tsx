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
  memo: string | null;
  patients: { id: string; name_kanji: string; name_kana: string; phone: string; is_new: boolean; date_of_birth?: string } | null;
  medical_records: { id: string; status: string }[] | null;
};

type ViewMode = "day" | "week";

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; textOnBlock: string; icon: string }> = {
  reserved:        { label: "予約済",     color: "text-blue-700",   bg: "bg-blue-50",    border: "border-l-blue-500",   textOnBlock: "bg-blue-500",    icon: "📅" },
  checked_in:      { label: "来院済",     color: "text-green-700",  bg: "bg-green-50",   border: "border-l-green-500",  textOnBlock: "bg-green-500",   icon: "📱" },
  in_consultation: { label: "診察中",     color: "text-orange-700", bg: "bg-orange-50",  border: "border-l-orange-500", textOnBlock: "bg-orange-500",  icon: "🩺" },
  completed:       { label: "完了",       color: "text-purple-700", bg: "bg-purple-50",  border: "border-l-purple-500", textOnBlock: "bg-purple-500",  icon: "✅" },
  billing_done:    { label: "会計済",     color: "text-gray-500",   bg: "bg-gray-100",   border: "border-l-gray-400",   textOnBlock: "bg-gray-400",    icon: "💰" },
  cancelled:       { label: "キャンセル", color: "text-red-700",    bg: "bg-red-50",     border: "border-l-red-500",    textOnBlock: "bg-red-500",     icon: "❌" },
};

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8:00 ~ 20:00

export default function ConsultationPage() {
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(true);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [showPanel, setShowPanel] = useState(false);

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

  const fetchAppointments = useCallback(async () => {
    const startDate = selectedDate;
    let endDate = selectedDate;
    if (viewMode === "week") {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + 6);
      endDate = d.toISOString().split("T")[0];
    }
    const { data } = await supabase.from("appointments")
      .select(`id, scheduled_at, patient_type, status, duration_min, doctor_id, unit_id, memo,
        patients ( id, name_kanji, name_kana, phone, is_new, date_of_birth ),
        medical_records ( id, status )`)
      .gte("scheduled_at", `${startDate}T00:00:00`)
      .lte("scheduled_at", `${endDate}T23:59:59`)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    if (data) setAppointments(data as unknown as Appointment[]);
  }, [selectedDate, viewMode]);

  useEffect(() => { fetchAppointments(); }, [fetchAppointments]);

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
    return d.getUTCHours().toString().padStart(2, "0") + ":" + d.getUTCMinutes().toString().padStart(2, "0");
  }

  function getAptEndTime(apt: Appointment) {
    const d = new Date(apt.scheduled_at);
    d.setMinutes(d.getMinutes() + (apt.duration_min || 30));
    return d.getUTCHours().toString().padStart(2, "0") + ":" + d.getUTCMinutes().toString().padStart(2, "0");
  }

  function getAge(dob?: string) {
    if (!dob) return null;
    const b = new Date(dob), t = new Date();
    let a = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
    return a;
  }

  // カラム（担当医またはユニット）ごとにアポをグループ化
  const columns = useMemo(() => {
    // 担当医をカラムとして使用
    const cols: { id: string; label: string; type: string }[] = [];
    doctors.forEach(d => cols.push({ id: d.id, label: d.name, type: "doctor" }));
    if (cols.length === 0) {
      // 医師が未登録ならユニットを使用
      units.forEach(u => cols.push({ id: u.id, label: u.name, type: "unit" }));
    }
    // 未割当カラム
    cols.push({ id: "__unassigned__", label: "未割当", type: "unassigned" });
    return cols;
  }, [doctors, units]);

  const aptsByColumn = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    columns.forEach(c => map.set(c.id, []));

    appointments.forEach(apt => {
      const colType = columns[0]?.type;
      let assignedCol: string | null = null;
      if (colType === "doctor") {
        assignedCol = apt.doctor_id;
      } else if (colType === "unit") {
        assignedCol = apt.unit_id;
      }
      const key = assignedCol && map.has(assignedCol) ? assignedCol : "__unassigned__";
      map.get(key)?.push(apt);
    });
    return map;
  }, [appointments, columns]);

  // 今日の日付情報
  const selectedDateObj = new Date(selectedDate + "T00:00:00");
  const dayLabel = selectedDateObj.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });

  // ミニカレンダー
  const miniCalDays = useMemo(() => {
    const d = new Date(selectedDate + "T00:00:00");
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

  // 受付リスト（右パネル）
  const checkedInApts = appointments.filter(a => ["checked_in", "in_consultation", "completed"].includes(a.status));

  if (loading || !config) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;

  return (
    <div className="min-h-screen bg-[#1a1f2e] text-white flex">
      {/* === 左サイドバー === */}
      <div className="w-16 flex-shrink-0 bg-[#141824] flex flex-col items-center py-4 gap-4 border-r border-gray-700/50">
        <Link href="/" className="text-2xl hover:scale-110 transition-transform" title="ホーム">🏠</Link>
        <Link href="/consultation" className="bg-sky-600 rounded-xl p-2.5 text-xl" title="予定">📅</Link>
        <Link href="/chart" className="text-2xl opacity-60 hover:opacity-100 transition-opacity" title="カルテ">📋</Link>
        <Link href="/billing" className="text-2xl opacity-60 hover:opacity-100 transition-opacity" title="会計">💰</Link>
        <Link href="/patients-management" className="text-2xl opacity-60 hover:opacity-100 transition-opacity" title="患者">👤</Link>
        <div className="flex-1" />
        <Link href="/settings" className="text-xl opacity-60 hover:opacity-100 transition-opacity" title="設定">⚙️</Link>
      </div>

      {/* === メインエリア === */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* ヘッダー */}
        <header className="bg-[#1e2538] border-b border-gray-700/50 px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-base font-bold text-white">{dayLabel}</h1>
            <div className="flex items-center gap-1">
              <button onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
                className="text-xs px-2.5 py-1 bg-gray-700/50 hover:bg-gray-600/50 rounded text-gray-300">今日</button>
              <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().split("T")[0]); }}
                className="text-xs px-2 py-1 bg-gray-700/50 hover:bg-gray-600/50 rounded text-gray-300">‹</button>
              <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().split("T")[0]); }}
                className="text-xs px-2 py-1 bg-gray-700/50 hover:bg-gray-600/50 rounded text-gray-300">›</button>
            </div>
            <div className="flex bg-gray-700/50 rounded-lg overflow-hidden">
              <button onClick={() => setViewMode("day")} className={`text-xs px-3 py-1 font-bold ${viewMode === "day" ? "bg-sky-600 text-white" : "text-gray-400 hover:text-white"}`}>日</button>
              <button onClick={() => setViewMode("week")} className={`text-xs px-3 py-1 font-bold ${viewMode === "week" ? "bg-sky-600 text-white" : "text-gray-400 hover:text-white"}`}>週</button>
            </div>
          </div>
          <div className="flex gap-2">
            {["checked_in", "in_consultation", "completed", "billing_done"].map((s) => (
              <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}`}>
                {STATUS_CONFIG[s].icon} {statusCounts[s] || 0}
              </span>
            ))}
          </div>
        </header>

        {/* タイムテーブル */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-[800px]">
            {/* カラムヘッダー */}
            <div className="sticky top-0 z-10 bg-[#1e2538] border-b border-gray-700/50 flex">
              <div className="w-16 flex-shrink-0" />
              {columns.filter(c => c.id !== "__unassigned__" || (aptsByColumn.get("__unassigned__")?.length || 0) > 0).map(col => (
                <div key={col.id} className="flex-1 min-w-[180px] px-2 py-2 border-l border-gray-700/30 text-center">
                  <p className="text-xs font-bold text-gray-300">{col.label}</p>
                </div>
              ))}
            </div>

            {/* 時間グリッド */}
            {HOURS.map(hour => (
              <div key={hour} className="flex border-b border-gray-700/20 relative" style={{ minHeight: "120px" }}>
                {/* 時間ラベル */}
                <div className="w-16 flex-shrink-0 pr-2 pt-1 text-right">
                  <span className="text-[10px] text-gray-500 font-bold">{hour}:00</span>
                </div>
                {/* 各カラム */}
                {columns.filter(c => c.id !== "__unassigned__" || (aptsByColumn.get("__unassigned__")?.length || 0) > 0).map(col => {
                  const colApts = (aptsByColumn.get(col.id) || []).filter(apt => {
                    const d = new Date(apt.scheduled_at);
                    return d.getUTCHours() === hour;
                  });
                  return (
                    <div key={col.id} className="flex-1 min-w-[180px] border-l border-gray-700/20 relative px-1 py-0.5">
                      {colApts.map(apt => {
                        const st = STATUS_CONFIG[apt.status] || STATUS_CONFIG.reserved;
                        const duration = apt.duration_min || 30;
                        const blockHeight = Math.max(duration * 2, 44);
                        const minuteOffset = new Date(apt.scheduled_at).getUTCMinutes();
                        const topOffset = minuteOffset * 2;
                        const age = getAge(apt.patients?.date_of_birth);
                        const doctorName = doctors.find(d => d.id === apt.doctor_id)?.name;
                        const unitName = units.find(u => u.id === apt.unit_id)?.name;

                        return (
                          <div key={apt.id}
                            onClick={() => { setSelectedApt(apt); setShowPanel(true); }}
                            className={`absolute left-1 right-1 rounded-lg border-l-4 ${st.border} ${st.bg} cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all overflow-hidden`}
                            style={{ top: `${topOffset}px`, height: `${blockHeight}px`, zIndex: selectedApt?.id === apt.id ? 5 : 1 }}>
                            <div className="px-2 py-1 h-full flex flex-col">
                              <div className="flex items-center justify-between">
                                <span className={`text-[9px] font-bold text-white px-1.5 py-0.5 rounded ${st.textOnBlock}`}>{st.label}</span>
                                <span className="text-[9px] text-gray-500">{getAptTime(apt)} - {getAptEndTime(apt)}</span>
                              </div>
                              <p className="text-xs font-bold text-gray-800 mt-0.5 truncate">
                                {apt.patients?.name_kanji || "未登録"}
                                {age !== null && <span className="text-[9px] font-normal text-gray-500 ml-1">({age})</span>}
                              </p>
                              {blockHeight > 50 && (
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {apt.patient_type === "new" && <span className="text-[8px] font-bold bg-red-100 text-red-600 px-1 rounded">初診</span>}
                                  {doctorName && <span className="text-[8px] bg-indigo-100 text-indigo-600 px-1 rounded">{doctorName}</span>}
                                  {unitName && <span className="text-[8px] bg-emerald-100 text-emerald-600 px-1 rounded">{unitName}</span>}
                                </div>
                              )}
                              {blockHeight > 70 && apt.memo && (
                                <p className="text-[9px] text-gray-500 mt-0.5 truncate">{apt.memo}</p>
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
      <div className="w-72 flex-shrink-0 bg-[#1e2538] border-l border-gray-700/50 flex flex-col overflow-y-auto">
        {/* ミニカレンダー */}
        <div className="p-3 border-b border-gray-700/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-300">{miniCalDays.year}年{miniCalDays.month + 1}月</span>
            <div className="flex gap-1">
              <button onClick={() => { const d = new Date(selectedDate); d.setMonth(d.getMonth() - 1); setSelectedDate(d.toISOString().split("T")[0]); }}
                className="text-[10px] text-gray-400 hover:text-white px-1">‹</button>
              <button onClick={() => { const d = new Date(selectedDate); d.setMonth(d.getMonth() + 1); setSelectedDate(d.toISOString().split("T")[0]); }}
                className="text-[10px] text-gray-400 hover:text-white px-1">›</button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {["日","月","火","水","木","金","土"].map(d => <span key={d} className="text-[9px] text-gray-500">{d}</span>)}
            {miniCalDays.days.map((day, i) => {
              if (!day) return <span key={`e-${i}`} />;
              const dateStr = `${miniCalDays.year}-${String(miniCalDays.month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isSelected = dateStr === selectedDate;
              const isToday = dateStr === new Date().toISOString().split("T")[0];
              return (
                <button key={day} onClick={() => setSelectedDate(dateStr)}
                  className={`text-[10px] w-6 h-6 rounded-full flex items-center justify-center transition-colors
                    ${isSelected ? "bg-sky-600 text-white font-bold" : isToday ? "bg-sky-900/50 text-sky-300 font-bold" : "text-gray-400 hover:bg-gray-700/50"}`}>
                  {day}
                </button>
              );
            })}
          </div>
        </div>

        {/* 受付一覧 */}
        <div className="p-3 border-b border-gray-700/50">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-gray-300">受付一覧</h3>
            <div className="flex gap-1">
              {["checked_in", "in_consultation", "completed"].map(s => (
                <span key={s} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}`}>
                  {STATUS_CONFIG[s].label} {statusCounts[s] || 0}
                </span>
              ))}
            </div>
          </div>

          {checkedInApts.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">受付患者なし</p>
          ) : (
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {checkedInApts.map(apt => {
                const st = STATUS_CONFIG[apt.status] || STATUS_CONFIG.reserved;
                return (
                  <button key={apt.id} onClick={() => { setSelectedApt(apt); setShowPanel(true); }}
                    className={`w-full text-left rounded-lg p-2 transition-colors ${selectedApt?.id === apt.id ? "bg-gray-700/70 ring-1 ring-sky-500" : "bg-gray-800/40 hover:bg-gray-700/50"}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-[8px] font-bold text-white px-1.5 py-0.5 rounded ${st.textOnBlock}`}>{st.label}</span>
                        <span className="text-xs font-bold text-gray-200 truncate">{apt.patients?.name_kanji || "未登録"}</span>
                      </div>
                      <span className="text-[10px] text-gray-500 flex-shrink-0">{getAptTime(apt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 選択中の詳細パネル */}
        {selectedApt && showPanel && (
          <div className="p-3 flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-300">患者詳細</h3>
              <button onClick={() => setShowPanel(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="bg-sky-600 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white">
                  {(selectedApt.patients?.name_kanji || "?").charAt(0)}
                </div>
                <div>
                  <p className="font-bold text-white text-sm">{selectedApt.patients?.name_kanji || "未登録"}</p>
                  <p className="text-[10px] text-gray-400">{selectedApt.patients?.name_kana}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-gray-500">時間</p><p className="text-gray-200 font-bold">{getAptTime(selectedApt)} - {getAptEndTime(selectedApt)}</p></div>
                <div><p className="text-gray-500">区分</p><p className="text-gray-200 font-bold">{selectedApt.patient_type === "new" ? "初診" : "再診"}</p></div>
              </div>

              <div>
                <p className="text-[10px] text-gray-500 mb-1">ユニット</p>
                <select value={selectedApt.unit_id || ""} onChange={(e) => assignUnit(selectedApt.id, e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-sky-500">
                  <option value="">未割り当て</option>
                  {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>

              <div>
                <p className="text-[10px] text-gray-500 mb-1">担当医</p>
                <select value={selectedApt.doctor_id || ""} onChange={(e) => assignDoctor(selectedApt.id, e.target.value)}
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-sky-500">
                  <option value="">未割り当て</option>
                  {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div>
                <p className="text-[10px] text-gray-500 mb-1">カルテ</p>
                {selectedApt.medical_records?.length ? (
                  <p className="text-[10px] text-green-400 font-bold">✅ {selectedApt.medical_records[0].status}</p>
                ) : <p className="text-[10px] text-gray-500">未作成</p>}
              </div>

              {/* アクションボタン */}
              <div className="space-y-2 pt-2 border-t border-gray-700/50">
                {selectedApt.status === "reserved" && (
                  <button onClick={() => updateStatus(selectedApt, "checked_in")}
                    className="w-full py-2 rounded-lg text-xs font-bold bg-green-600 text-white hover:bg-green-700">📱 来院済にする</button>
                )}
                {selectedApt.status === "checked_in" && (
                  <button onClick={async () => {
                    await updateStatus(selectedApt, "in_consultation");
                    window.location.href = `/consultation/session?appointment_id=${selectedApt.id}`;
                  }}
                    className="w-full py-2.5 rounded-lg text-xs font-bold bg-orange-600 text-white hover:bg-orange-700">🩺 呼び出し（診察開始）→</button>
                )}
                {selectedApt.status === "in_consultation" && (
                  <>
                    <a href={`/consultation/session?appointment_id=${selectedApt.id}`}
                      className="block w-full py-2.5 rounded-lg text-xs font-bold bg-sky-600 text-white hover:bg-sky-700 text-center">📋 診察画面を開く →</a>
                    <button onClick={() => updateStatus(selectedApt, "completed")}
                      className="w-full py-2 rounded-lg text-xs font-bold bg-purple-600/30 text-purple-300 hover:bg-purple-600/50">✅ 診察完了</button>
                  </>
                )}
                {selectedApt.status === "completed" && (
                  <button onClick={() => updateStatus(selectedApt, "billing_done")}
                    className="w-full py-2 rounded-lg text-xs font-bold bg-gray-600 text-gray-200 hover:bg-gray-500">💰 会計済にする</button>
                )}
                {selectedApt.patients?.id && (
                  <Link href={`/chart?patient_id=${selectedApt.patients.id}`}
                    className="block w-full py-2 rounded-lg text-xs font-bold bg-gray-700/50 text-gray-300 hover:bg-gray-600/50 text-center">📋 カルテを開く</Link>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
