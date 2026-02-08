"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import {
  getClinicConfig, generateTimeSlots, getDoctors,
  type ClinicConfig, type DoctorOption,
} from "@/lib/reservation-utils";

type Appointment = {
  id: string;
  scheduled_at: string;
  patient_type: string;
  status: string;
  duration_min: number;
  doctor_id: string | null;
  patients: {
    id: string; name_kanji: string; name_kana: string; phone: string;
    date_of_birth: string; insurance_type: string; burden_ratio: number; is_new: boolean;
  } | null;
  medical_records: { id: string; status: string; soap_s: string | null }[] | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  reserved:        { label: "予約済",     color: "text-blue-700",   bg: "bg-blue-100",   icon: "📅" },
  checked_in:      { label: "来院済",     color: "text-green-700",  bg: "bg-green-100",  icon: "📱" },
  in_consultation: { label: "診察中",     color: "text-orange-700", bg: "bg-orange-100", icon: "🩺" },
  completed:       { label: "完了",       color: "text-purple-700", bg: "bg-purple-100", icon: "✅" },
  billing_done:    { label: "会計済",     color: "text-gray-500",   bg: "bg-gray-100",   icon: "💰" },
  cancelled:       { label: "キャンセル", color: "text-red-700",    bg: "bg-red-100",    icon: "❌" },
};

const STATUS_TRANSITIONS: Record<string, { next: string; label: string }[]> = {
  reserved:        [{ next: "checked_in", label: "来院済にする（チェックイン）" }, { next: "cancelled", label: "キャンセル" }],
  checked_in:      [{ next: "in_consultation", label: "診察中にする（呼び出し）" }, { next: "cancelled", label: "キャンセル" }],
  in_consultation: [{ next: "completed", label: "完了にする（カルテ確定）" }],
  completed:       [{ next: "billing_done", label: "会計済にする" }],
  billing_done:    [],
  cancelled:       [{ next: "reserved", label: "予約を復活" }],
};

const STATUS_ORDER = ["reserved", "checked_in", "in_consultation", "completed", "billing_done", "cancelled"];

export default function ReservationManagePage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(true);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // 設定情報
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [timeSlotOptions, setTimeSlotOptions] = useState<string[]>([]);

  // 手動追加フォーム
  const [addForm, setAddForm] = useState({
    name_kanji: "", name_kana: "", date_of_birth: "", phone: "",
    time: "", insurance_type: "社保", burden_ratio: "0.3",
    patient_type: "new" as "new" | "returning", doctor_id: "",
  });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");

  // ===== 初期化: 設定読み込み =====
  useEffect(() => {
    async function loadConfig() {
      const c = await getClinicConfig();
      setConfig(c);
      if (c) {
        const slots = generateTimeSlots(c);
        const slotTimes = slots.map((s) => s.time);
        setTimeSlotOptions(slotTimes);
        setAddForm((prev) => ({ ...prev, time: slotTimes[0] || "09:00" }));
        const docs = await getDoctors(c.clinicId);
        setDoctors(docs);
      }
    }
    loadConfig();
  }, []);

  // ===== 予約データ取得 =====
  useEffect(() => {
    fetchAppointments();
    const channel = supabase
      .channel("reservation-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => fetchAppointments())
      .on("postgres_changes", { event: "*", schema: "public", table: "medical_records" }, () => fetchAppointments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedDate]);

  async function fetchAppointments() {
    setLoading(true);
    const { data } = await supabase
      .from("appointments")
      .select(`id, scheduled_at, patient_type, status, duration_min, doctor_id,
        patients ( id, name_kanji, name_kana, phone, date_of_birth, insurance_type, burden_ratio, is_new ),
        medical_records ( id, status, soap_s )`)
      .gte("scheduled_at", `${selectedDate}T00:00:00+09:00`)
      .lte("scheduled_at", `${selectedDate}T23:59:59+09:00`)
      .order("scheduled_at", { ascending: true });
    if (data) setAppointments(data as unknown as Appointment[]);
    setLoading(false);
  }

  // ===== ステータス変更 + イベント発火 =====
  async function updateStatus(appointment: Appointment, newStatus: string) {
    await supabase.from("appointments").update({ status: newStatus }).eq("id", appointment.id);

    switch (newStatus) {
      case "checked_in":
        const today = new Date().toISOString().split("T")[0];
        const { data: maxQueue } = await supabase.from("queue").select("queue_number")
          .gte("checked_in_at", `${today}T00:00:00+09:00`).order("queue_number", { ascending: false }).limit(1);
        const nextNumber = (maxQueue && maxQueue.length > 0) ? maxQueue[0].queue_number + 1 : 1;
        await supabase.from("queue").insert({ appointment_id: appointment.id, queue_number: nextNumber, status: "waiting", checked_in_at: new Date().toISOString() });
        break;
      case "in_consultation":
        await supabase.from("queue").update({ status: "in_room", called_at: new Date().toISOString() }).eq("appointment_id", appointment.id);
        break;
      case "completed":
        if (appointment.medical_records?.length) {
          await supabase.from("medical_records").update({ status: "confirmed", doctor_confirmed: true }).eq("appointment_id", appointment.id);
        }
        await supabase.from("queue").update({ status: "done" }).eq("appointment_id", appointment.id);
        break;
      case "billing_done":
        if (appointment.medical_records?.length) {
          await supabase.from("billing").update({ payment_status: "paid" }).eq("record_id", appointment.medical_records[0].id);
        }
        break;
    }

    setAppointments((prev) => prev.map((a) => a.id === appointment.id ? { ...a, status: newStatus } : a));
    if (selectedApt?.id === appointment.id) setSelectedApt((prev) => prev ? { ...prev, status: newStatus } : null);
  }

  // ===== 手動予約追加 =====
  async function handleAddAppointment() {
    setAddLoading(true);
    setAddError("");
    if (!addForm.name_kanji || !addForm.date_of_birth || !addForm.phone) { setAddError("必須項目を入力してください"); setAddLoading(false); return; }

    try {
      let patientId: string;
      if (addForm.patient_type === "returning") {
        const { data: existing } = await supabase.from("patients").select("id")
          .eq("name_kanji", addForm.name_kanji).eq("date_of_birth", addForm.date_of_birth).eq("phone", addForm.phone).single();
        if (existing) { patientId = existing.id; await supabase.from("patients").update({ is_new: false }).eq("id", patientId); }
        else { setAddError("患者情報が見つかりません。初診として登録するか、入力内容を確認してください。"); setAddLoading(false); return; }
      } else {
        if (!addForm.name_kana) { setAddError("カナを入力してください"); setAddLoading(false); return; }
        const { data: newPatient, error: patientErr } = await supabase.from("patients").insert({
          name_kanji: addForm.name_kanji, name_kana: addForm.name_kana, date_of_birth: addForm.date_of_birth,
          phone: addForm.phone, insurance_type: addForm.insurance_type, burden_ratio: parseFloat(addForm.burden_ratio),
          is_new: true, clinic_id: config?.clinicId,
        }).select("id").single();
        if (patientErr || !newPatient) { setAddError("患者登録に失敗しました"); setAddLoading(false); return; }
        patientId = newPatient.id;
      }

      const scheduledAt = `${selectedDate}T${addForm.time}:00+09:00`;
      const { data: appointment, error: aptErr } = await supabase.from("appointments").insert({
        patient_id: patientId, clinic_id: config?.clinicId, doctor_id: addForm.doctor_id || null,
        scheduled_at: scheduledAt, patient_type: addForm.patient_type, status: "reserved",
        duration_min: config?.slotDurationMin || 30,
      }).select("id").single();
      if (aptErr || !appointment) { setAddError("予約登録に失敗しました"); setAddLoading(false); return; }

      await supabase.from("medical_records").insert({ appointment_id: appointment.id, patient_id: patientId, status: "draft" });

      setShowAddModal(false);
      setAddForm({ name_kanji: "", name_kana: "", date_of_birth: "", phone: "", time: timeSlotOptions[0] || "09:00", insurance_type: "社保", burden_ratio: "0.3", patient_type: "new", doctor_id: "" });
      fetchAppointments();
    } catch { setAddError("エラーが発生しました"); }
    setAddLoading(false);
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  const filteredAppointments = filterStatus === "all" ? appointments : appointments.filter((a) => a.status === filterStatus);
  const statusCounts = appointments.reduce((acc, a) => { acc[a.status] = (acc[a.status] || 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">📅 予約管理</h1>
            {config && <span className="text-xs text-gray-400">（{config.slotDurationMin}分枠 / 上限{config.maxPatientsPerSlot}人）</span>}
          </div>
          <button onClick={() => setShowAddModal(true)} className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-700">＋ 予約追加</button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* 日付選択 */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().split("T")[0]); }}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">◀</button>
          <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-bold text-sm" />
          <button onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().split("T")[0]); }}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">▶</button>
          <button onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-xs text-gray-500">今日</button>
          {config && config.closedDays.includes(new Date(selectedDate + "T00:00:00").getDay()) && (
            <span className="bg-red-100 text-red-600 px-2.5 py-1 rounded-lg text-xs font-bold">⚠ 休診日</span>
          )}
          <span className="text-sm text-gray-400 ml-auto">全 {appointments.length} 件</span>
        </div>

        {/* ステータスフロー */}
        <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 overflow-x-auto">
          <div className="flex items-center gap-1 min-w-max justify-center">
            {STATUS_ORDER.filter((s) => s !== "cancelled").map((key, idx, arr) => (
              <div key={key} className="flex items-center gap-1">
                <div className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${STATUS_CONFIG[key].bg} ${STATUS_CONFIG[key].color}`}>
                  <span>{STATUS_CONFIG[key].icon}</span><span>{STATUS_CONFIG[key].label}</span>
                  <span className="ml-1 bg-white/50 px-1.5 rounded-full">{statusCounts[key] || 0}</span>
                </div>
                {idx < arr.length - 1 && <span className="text-gray-300 text-xs">→</span>}
              </div>
            ))}
          </div>
        </div>

        {/* フィルター */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button onClick={() => setFilterStatus("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${filterStatus === "all" ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500"}`}>
            すべて ({appointments.length})
          </button>
          {STATUS_ORDER.map((key) => (
            <button key={key} onClick={() => setFilterStatus(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap ${filterStatus === key ? `${STATUS_CONFIG[key].bg} ${STATUS_CONFIG[key].color}` : "bg-white border border-gray-200 text-gray-500"}`}>
              {STATUS_CONFIG[key].icon} {STATUS_CONFIG[key].label} ({statusCounts[key] || 0})
            </button>
          ))}
        </div>

        {/* メイン */}
        <div className="flex gap-4">
          <div className="flex-1">
            {loading ? (
              <div className="text-center py-12 text-gray-400">読み込み中...</div>
            ) : filteredAppointments.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-400 mb-1">予約はありません</p>
                <p className="text-gray-300 text-sm">「＋ 予約追加」または患者さんのWeb予約をお待ちください</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAppointments.map((apt) => {
                  const status = STATUS_CONFIG[apt.status] || STATUS_CONFIG.reserved;
                  const isSelected = selectedApt?.id === apt.id;
                  const hasRecord = apt.medical_records && apt.medical_records.length > 0;
                  const recordStatus = hasRecord ? apt.medical_records![0].status : null;
                  const doctor = doctors.find((d) => d.id === apt.doctor_id);

                  return (
                    <button key={apt.id} onClick={() => setSelectedApt(apt)}
                      className={`w-full text-left bg-white rounded-xl border p-4 hover:shadow-sm transition-all ${isSelected ? "border-sky-400 shadow-sm" : "border-gray-200"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="text-center min-w-[50px]">
                            <p className="text-base font-bold text-gray-900">{formatTime(apt.scheduled_at)}</p>
                            <p className="text-xs text-gray-400">{apt.duration_min}分</p>
                          </div>
                          <div className="w-px h-10 bg-gray-200" />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-gray-900 text-sm">{apt.patients?.name_kanji || "未登録"}</p>
                              {apt.patient_type === "new" && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-bold">初診</span>}
                              {hasRecord && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                                  recordStatus === "confirmed" ? "bg-green-100 text-green-600" : recordStatus === "soap_complete" ? "bg-yellow-100 text-yellow-600" : "bg-gray-100 text-gray-400"
                                }`}>{recordStatus === "confirmed" ? "カルテ確定" : recordStatus === "soap_complete" ? "SOAP完了" : "カルテ作成済"}</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">
                              {apt.patients?.name_kana}
                              {doctor && <span className="ml-2" style={{ color: doctor.color }}>● {doctor.name}</span>}
                            </p>
                          </div>
                        </div>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${status.bg} ${status.color}`}>{status.icon} {status.label}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 詳細パネル */}
          {selectedApt && (
            <div className="w-80 flex-shrink-0 hidden lg:block">
              <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900">予約詳細</h3>
                  <button onClick={() => setSelectedApt(null)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">患者名</p>
                    <p className="font-bold text-gray-900 text-lg">{selectedApt.patients?.name_kanji || "未登録"}</p>
                    <p className="text-sm text-gray-400">{selectedApt.patients?.name_kana}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-xs text-gray-400 mb-0.5">予約時間</p><p className="font-bold text-gray-900">{formatTime(selectedApt.scheduled_at)}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">区分</p><p className="font-bold text-gray-900">{selectedApt.patient_type === "new" ? "初診" : "再診"}</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-xs text-gray-400 mb-0.5">電話番号</p><p className="text-sm text-gray-900">{selectedApt.patients?.phone || "-"}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">生年月日</p><p className="text-sm text-gray-900">{selectedApt.patients?.date_of_birth || "-"}</p></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><p className="text-xs text-gray-400 mb-0.5">保険種別</p><p className="text-sm text-gray-900">{selectedApt.patients?.insurance_type || "-"}</p></div>
                    <div><p className="text-xs text-gray-400 mb-0.5">負担割合</p><p className="text-sm text-gray-900">{selectedApt.patients?.burden_ratio ? `${selectedApt.patients.burden_ratio * 10}割` : "-"}</p></div>
                  </div>
                  {/* 担当医 */}
                  {selectedApt.doctor_id && doctors.find((d) => d.id === selectedApt.doctor_id) && (
                    <div className="border-t border-gray-100 pt-3">
                      <p className="text-xs text-gray-400 mb-0.5">担当医</p>
                      <p className="text-sm font-bold" style={{ color: doctors.find((d) => d.id === selectedApt.doctor_id)?.color }}>
                        {doctors.find((d) => d.id === selectedApt.doctor_id)?.name}
                      </p>
                    </div>
                  )}
                  {/* カルテ */}
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs text-gray-400 mb-1.5">カルテ</p>
                    {selectedApt.medical_records?.length ? (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                        <p className="text-sm text-green-700 font-bold">✅ カルテ作成済</p>
                        <p className="text-xs text-green-600 mt-0.5">
                          ステータス: {selectedApt.medical_records[0].status}
                          {selectedApt.medical_records[0].soap_s && " / SOAP-S入力済"}
                        </p>
                      </div>
                    ) : <p className="text-sm text-gray-400">カルテ未作成</p>}
                  </div>
                  {/* ステータス */}
                  <div className="border-t border-gray-100 pt-3">
                    <p className="text-xs text-gray-400 mb-1.5">現在のステータス</p>
                    <span className={`inline-flex items-center gap-1 text-sm font-bold px-3 py-1.5 rounded-full ${STATUS_CONFIG[selectedApt.status]?.bg} ${STATUS_CONFIG[selectedApt.status]?.color}`}>
                      {STATUS_CONFIG[selectedApt.status]?.icon} {STATUS_CONFIG[selectedApt.status]?.label}
                    </span>
                  </div>
                  {/* ステータス変更 */}
                  {STATUS_TRANSITIONS[selectedApt.status]?.length > 0 && (
                    <div className="border-t border-gray-100 pt-3">
                      <p className="text-xs text-gray-400 mb-2">次のアクション</p>
                      <div className="space-y-2">
                        {STATUS_TRANSITIONS[selectedApt.status].map(({ next, label }) => (
                          <button key={next} onClick={() => updateStatus(selectedApt, next)}
                            className={`w-full py-2.5 rounded-lg text-sm font-bold transition-colors ${next !== "cancelled" ? "bg-sky-600 text-white hover:bg-sky-700" : "bg-red-50 text-red-600 hover:bg-red-100"}`}>
                            {STATUS_CONFIG[next].icon} {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== 手動追加モーダル ===== */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-lg">予約を追加</h3>
              <button onClick={() => { setShowAddModal(false); setAddError(""); }} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex gap-2">
                <button onClick={() => setAddForm({ ...addForm, patient_type: "new" })}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold ${addForm.patient_type === "new" ? "bg-sky-600 text-white" : "bg-gray-100 text-gray-500"}`}>🆕 初診</button>
                <button onClick={() => setAddForm({ ...addForm, patient_type: "returning" })}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold ${addForm.patient_type === "returning" ? "bg-sky-600 text-white" : "bg-gray-100 text-gray-500"}`}>🔄 再診</button>
              </div>

              {addForm.patient_type === "returning" && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                  <p className="text-xs text-blue-700">💡 再診: 氏名・生年月日・電話番号で既存の患者を照合します</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">氏名（漢字）<span className="text-red-500">*</span></label>
                <input type="text" value={addForm.name_kanji} onChange={(e) => setAddForm({ ...addForm, name_kanji: e.target.value })}
                  placeholder="山田 太郎" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
              </div>
              {addForm.patient_type === "new" && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">氏名（カナ）<span className="text-red-500">*</span></label>
                  <input type="text" value={addForm.name_kana} onChange={(e) => setAddForm({ ...addForm, name_kana: e.target.value })}
                    placeholder="ヤマダ タロウ" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                </div>
              )}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">生年月日<span className="text-red-500">*</span></label>
                <input type="date" value={addForm.date_of_birth} onChange={(e) => setAddForm({ ...addForm, date_of_birth: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">電話番号<span className="text-red-500">*</span></label>
                <input type="tel" value={addForm.phone} onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                  placeholder="09012345678" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">予約時間<span className="text-red-500">*</span></label>
                <select value={addForm.time} onChange={(e) => setAddForm({ ...addForm, time: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                  {timeSlotOptions.map((t) => (<option key={t} value={t}>{t}</option>))}
                </select>
              </div>
              {/* 担当医 */}
              {doctors.length > 0 && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">担当医</label>
                  <select value={addForm.doctor_id} onChange={(e) => setAddForm({ ...addForm, doctor_id: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                    <option value="">指定なし</option>
                    {doctors.map((d) => (<option key={d.id} value={d.id}>{d.name}</option>))}
                  </select>
                </div>
              )}

              {addForm.patient_type === "new" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">保険種別</label>
                    <select value={addForm.insurance_type} onChange={(e) => setAddForm({ ...addForm, insurance_type: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                      <option value="社保">社保</option><option value="国保">国保</option><option value="後期高齢">後期高齢</option><option value="自費">自費</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">負担割合</label>
                    <select value={addForm.burden_ratio} onChange={(e) => setAddForm({ ...addForm, burden_ratio: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                      <option value="0.3">3割</option><option value="0.2">2割</option><option value="0.1">1割</option>
                    </select>
                  </div>
                </div>
              )}

              {addError && <div className="bg-red-50 border border-red-200 rounded-lg p-2.5"><p className="text-red-600 text-sm">{addError}</p></div>}
              <div className="flex gap-3 pt-2">
                <button onClick={() => { setShowAddModal(false); setAddError(""); }} className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-lg font-bold">キャンセル</button>
                <button onClick={handleAddAppointment} disabled={addLoading}
                  className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold hover:bg-sky-700 disabled:opacity-50">{addLoading ? "登録中..." : "予約を登録"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
