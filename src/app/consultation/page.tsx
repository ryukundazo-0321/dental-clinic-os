"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getClinicConfig, generateTimeSlots, getDoctors, type ClinicConfig, type DoctorOption } from "@/lib/reservation-utils";

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

type ViewMode = "unit" | "doctor";

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
  const [viewMode, setViewMode] = useState<ViewMode>("unit");
  const [loading, setLoading] = useState(true);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);

  // 初期化
  useEffect(() => {
    async function init() {
      const c = await getClinicConfig();
      setConfig(c);
      if (c) {
        const docs = await getDoctors(c.clinicId);
        setDoctors(docs);
        const { data: unitsData } = await supabase.from("units").select("*").eq("clinic_id", c.clinicId).eq("is_active", true).order("sort_order");
        if (unitsData) setUnits(unitsData);
      }
      setLoading(false);
    }
    init();
  }, []);

  // 予約データ取得
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
      .gte("scheduled_at", `${selectedDate}T00:00:00`)
      .lte("scheduled_at", `${selectedDate}T23:59:59`)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    if (data) setAppointments(data as unknown as Appointment[]);
  }

  // ステータス変更
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

  // ユニット割り当て
  async function assignUnit(aptId: string, unitId: string) {
    await supabase.from("appointments").update({ unit_id: unitId || null }).eq("id", aptId);
    setAppointments((prev) => prev.map((a) => a.id === aptId ? { ...a, unit_id: unitId || null } : a));
    if (selectedApt?.id === aptId) setSelectedApt((prev) => prev ? { ...prev, unit_id: unitId || null } : null);
  }

  // ドクター割り当て
  async function assignDoctor(aptId: string, doctorId: string) {
    await supabase.from("appointments").update({ doctor_id: doctorId || null }).eq("id", aptId);
    setAppointments((prev) => prev.map((a) => a.id === aptId ? { ...a, doctor_id: doctorId || null } : a));
    if (selectedApt?.id === aptId) setSelectedApt((prev) => prev ? { ...prev, doctor_id: doctorId || null } : null);
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  function getAptTime(apt: Appointment) {
    return new Date(apt.scheduled_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", hour12: false });
  }

  if (loading || !config) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;

  // タイムスロット生成
  const timeSlots = generateTimeSlots(config);
  const columns: { id: string; label: string; sub: string; color?: string }[] = viewMode === "unit"
    ? units.map((u) => ({ id: u.id, label: u.name, sub: u.unit_type === "general" ? "" : u.unit_type }))
    : doctors.map((d) => ({ id: d.id, label: d.name, sub: "", color: d.color }));

  // 未割り当ての予約
  const unassignedApts = viewMode === "unit"
    ? appointments.filter((a) => !a.unit_id)
    : appointments.filter((a) => !a.doctor_id);

  // サマリー
  const statusCounts = appointments.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-full mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">🩺 診察カレンダー</h1>
          </div>
          <div className="flex items-center gap-3">
            {/* 表示切り替え */}
            <div className="flex bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setViewMode("unit")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === "unit" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                🪥 ユニット別
              </button>
              <button onClick={() => setViewMode("doctor")}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${viewMode === "doctor" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                👨‍⚕️ ドクター別
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-3">
        {/* 日付 + サマリー */}
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().split("T")[0]); }}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">◀</button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-bold text-sm" />
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().split("T")[0]); }}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">▶</button>
          <button onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-xs text-gray-500">今日</button>

          <div className="flex gap-2 ml-auto">
            {["reserved", "checked_in", "in_consultation", "completed", "billing_done"].map((s) => (
              <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}`}>
                {STATUS_CONFIG[s].icon} {statusCounts[s] || 0}
              </span>
            ))}
          </div>
        </div>

        {/* 未割り当て警告 */}
        {unassignedApts.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-3">
            <p className="text-sm text-yellow-700 font-bold">
              ⚠ {viewMode === "unit" ? "ユニット" : "ドクター"}未割り当ての予約が {unassignedApts.length} 件あります
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {unassignedApts.map((apt) => (
                <button key={apt.id} onClick={() => setSelectedApt(apt)}
                  className="bg-white border border-yellow-300 rounded-lg px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-yellow-100">
                  {formatTime(apt.scheduled_at)} {apt.patients?.name_kanji || "未登録"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-3">
          {/* タイムテーブル */}
          <div className="flex-1 overflow-x-auto">
            <div className="min-w-[600px]">
              {/* ヘッダー（列名） */}
              <div className="flex sticky top-0 z-10 bg-gray-50">
                <div className="w-16 flex-shrink-0 border-r border-gray-200 bg-gray-100 rounded-tl-lg p-2">
                  <p className="text-[10px] text-gray-400 font-bold text-center">時間</p>
                </div>
                {columns.length > 0 ? columns.map((col, idx) => (
                  <div key={col.id} className={`flex-1 min-w-[140px] p-2 text-center border-r border-gray-200 bg-gray-100 ${idx === columns.length - 1 ? "rounded-tr-lg" : ""}`}>
                    <p className="text-sm font-bold text-gray-900" style={viewMode === "doctor" && col.color ? { color: col.color } : {}}>
                      {col.label}
                    </p>
                    {col.sub && <p className="text-[10px] text-gray-400">{col.sub}</p>}
                  </div>
                )) : (
                  <div className="flex-1 p-2 text-center bg-gray-100 rounded-tr-lg">
                    <p className="text-sm text-gray-400">{viewMode === "unit" ? "ユニットを設定画面で追加してください" : "ドクターを設定画面で追加してください"}</p>
                  </div>
                )}
              </div>

              {/* タイムテーブル本体 */}
              {columns.length > 0 && timeSlots.map((slot, slotIdx) => {
                const isHourStart = slot.time.endsWith(":00");
                const isPeriodBreak = slotIdx > 0 && timeSlots[slotIdx - 1].period !== slot.period;

                return (
                  <div key={slot.time}>
                    {isPeriodBreak && (
                      <div className="flex bg-gray-200/50">
                        <div className="w-16 flex-shrink-0 p-1 text-center"><p className="text-[10px] text-gray-400 font-bold">休憩</p></div>
                        {columns.map((col) => <div key={col.id} className="flex-1 min-w-[140px] border-r border-gray-200" />)}
                      </div>
                    )}
                    <div className={`flex ${isHourStart ? "border-t border-gray-300" : "border-t border-gray-100"}`}>
                      {/* 時間ラベル */}
                      <div className="w-16 flex-shrink-0 border-r border-gray-200 p-1 flex items-start justify-center">
                        <p className={`text-xs ${isHourStart ? "font-bold text-gray-700" : "text-gray-400"}`}>{slot.time}</p>
                      </div>

                      {/* 各列 */}
                      {columns.map((col) => {
                        const cellApts = appointments.filter((apt) => {
                          const aptTime = getAptTime(apt);
                          const matchColumn = viewMode === "unit" ? apt.unit_id === col.id : apt.doctor_id === col.id;
                          return aptTime === slot.time && matchColumn;
                        });

                        return (
                          <div key={col.id} className="flex-1 min-w-[140px] border-r border-gray-100 p-0.5 min-h-[48px]">
                            {cellApts.map((apt) => {
                              const status = STATUS_CONFIG[apt.status] || STATUS_CONFIG.reserved;
                              return (
                                <button key={apt.id} onClick={() => setSelectedApt(apt)}
                                  className={`w-full text-left rounded-lg border-l-4 px-2 py-1.5 mb-0.5 transition-all hover:shadow-sm ${status.bg} ${status.border} ${selectedApt?.id === apt.id ? "ring-2 ring-sky-400" : ""}`}>
                                  <div className="flex items-center justify-between">
                                    <p className="text-xs font-bold text-gray-900 truncate">
                                      {apt.patients?.name_kanji || "未登録"}
                                    </p>
                                    <span className={`text-[9px] font-bold ${status.color}`}>{status.icon}</span>
                                  </div>
                                  <p className="text-[10px] text-gray-400 truncate">
                                    {apt.patient_type === "new" ? "初診" : "再診"}
                                    {apt.duration_min && ` / ${apt.duration_min}分`}
                                  </p>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 詳細パネル */}
          {selectedApt && (
            <div className="w-72 flex-shrink-0 hidden lg:block">
              <div className="bg-white rounded-xl border border-gray-200 p-4 sticky top-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-gray-900 text-sm">詳細</h3>
                  <button onClick={() => setSelectedApt(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-400">患者名</p>
                    <p className="font-bold text-gray-900">{selectedApt.patients?.name_kanji || "未登録"}</p>
                    <p className="text-xs text-gray-400">{selectedApt.patients?.name_kana}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div><p className="text-xs text-gray-400">時間</p><p className="text-sm font-bold">{formatTime(selectedApt.scheduled_at)}</p></div>
                    <div><p className="text-xs text-gray-400">区分</p><p className="text-sm font-bold">{selectedApt.patient_type === "new" ? "初診" : "再診"}</p></div>
                  </div>
                  <div><p className="text-xs text-gray-400">電話</p><p className="text-sm">{selectedApt.patients?.phone || "-"}</p></div>

                  {/* ユニット割り当て */}
                  <div>
                    <p className="text-xs text-gray-400 mb-1">ユニット</p>
                    <select value={selectedApt.unit_id || ""} onChange={(e) => assignUnit(selectedApt.id, e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-sky-400">
                      <option value="">未割り当て</option>
                      {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>

                  {/* ドクター割り当て */}
                  <div>
                    <p className="text-xs text-gray-400 mb-1">担当医</p>
                    <select value={selectedApt.doctor_id || ""} onChange={(e) => assignDoctor(selectedApt.id, e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:border-sky-400">
                      <option value="">未割り当て</option>
                      {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                    </select>
                  </div>

                  {/* カルテ */}
                  <div className="border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-400 mb-1">カルテ</p>
                    {selectedApt.medical_records?.length ? (
                      <p className="text-xs text-green-600 font-bold">✅ {selectedApt.medical_records[0].status}</p>
                    ) : <p className="text-xs text-gray-400">未作成</p>}
                  </div>

                  {/* ステータス */}
                  <div className="border-t border-gray-100 pt-2">
                    <p className="text-xs text-gray-400 mb-1">ステータス</p>
                    <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${STATUS_CONFIG[selectedApt.status]?.bg} ${STATUS_CONFIG[selectedApt.status]?.color}`}>
                      {STATUS_CONFIG[selectedApt.status]?.icon} {STATUS_CONFIG[selectedApt.status]?.label}
                    </span>
                  </div>

                  {/* アクションボタン */}
                  <div className="border-t border-gray-100 pt-2 space-y-1.5">
                    {selectedApt.status === "reserved" && (
                      <button onClick={() => updateStatus(selectedApt, "checked_in")}
                        className="w-full py-2 rounded-lg text-xs font-bold bg-green-100 text-green-700 hover:bg-green-200">📱 来院済にする</button>
                    )}
                    {selectedApt.status === "checked_in" && (
                      <button onClick={() => updateStatus(selectedApt, "in_consultation")}
                        className="w-full py-2 rounded-lg text-xs font-bold bg-orange-100 text-orange-700 hover:bg-orange-200">🩺 呼び出し（診察開始）</button>
                    )}
                    {selectedApt.status === "in_consultation" && (
                      <button onClick={() => updateStatus(selectedApt, "completed")}
                        className="w-full py-2 rounded-lg text-xs font-bold bg-purple-100 text-purple-700 hover:bg-purple-200">✅ 診察完了</button>
                    )}
                    {selectedApt.status === "completed" && (
                      <button onClick={() => updateStatus(selectedApt, "billing_done")}
                        className="w-full py-2 rounded-lg text-xs font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">💰 会計済にする</button>
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
