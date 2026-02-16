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
  notes: string | null;
  patients: {
    id: string; name_kanji: string; name_kana: string; phone: string;
    date_of_birth: string; insurance_type: string; burden_ratio: number; is_new: boolean;
  } | null;
  medical_records: { id: string; status: string; soap_s: string | null }[] | null;
};

// 治療サマリー情報の型
type TreatmentSummary = {
  diagnoses: { name: string; tooth_number: string; start_date: string }[];
  lastVisit: {
    date: string;
    soap_p: string;
    soap_a: string;
    procedures: string[];
  } | null;
  nextPlan: string;
  activeTeeth: string[];
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

// FDI歯番号を日本語で表示
function toothLabel(tooth: string) {
  if (!tooth) return "";
  const num = parseInt(tooth);
  if (isNaN(num)) return tooth;
  const quadrant = Math.floor(num / 10);
  const position = num % 10;
  const qLabel = quadrant === 1 ? "右上" : quadrant === 2 ? "左上" : quadrant === 3 ? "左下" : quadrant === 4 ? "右下" : "";
  return `${qLabel}${position}番`;
}

export default function ReservationManagePage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(true);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

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

  // ★ 再診照合 + 治療サマリー用state
  const [matchedPatient, setMatchedPatient] = useState<{ id: string; name_kanji: string } | null>(null);
  const [treatmentSummary, setTreatmentSummary] = useState<TreatmentSummary | null>(null);
  const [lookupDone, setLookupDone] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [visitReason, setVisitReason] = useState<"continuing" | "new_complaint" | "">(""); 
  const [newComplaint, setNewComplaint] = useState("");

  // ===== 初期化 =====
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
      .select(`id, scheduled_at, patient_type, status, duration_min, doctor_id, notes,
        patients ( id, name_kanji, name_kana, phone, date_of_birth, insurance_type, burden_ratio, is_new ),
        medical_records ( id, status, soap_s )`)
      .gte("scheduled_at", `${selectedDate}T00:00:00`)
      .lte("scheduled_at", `${selectedDate}T23:59:59`)
      .order("scheduled_at", { ascending: true });
    if (data) setAppointments(data as unknown as Appointment[]);
    setLoading(false);
  }

  // ===== ステータス変更 =====
  async function updateStatus(appointment: Appointment, newStatus: string) {
    await supabase.from("appointments").update({ status: newStatus }).eq("id", appointment.id);

    switch (newStatus) {
      case "checked_in":
        const today = new Date().toISOString().split("T")[0];
        const { data: maxQueue } = await supabase.from("queue").select("queue_number")
          .gte("checked_in_at", `${today}T00:00:00`).order("queue_number", { ascending: false }).limit(1);
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

  // ============================================================
  // ★ 再診患者照合 + 治療サマリー取得
  // ============================================================
  async function lookupReturningPatient() {
    setLookupLoading(true);
    setAddError("");
    try {
      const { data: patient } = await supabase.from("patients").select("id, name_kanji")
        .eq("name_kanji", addForm.name_kanji).eq("date_of_birth", addForm.date_of_birth).eq("phone", addForm.phone).single();

      if (!patient) {
        setAddError("患者情報が見つかりません。入力内容を確認するか、初診として登録してください。");
        setLookupLoading(false);
        return;
      }

      setMatchedPatient(patient);

      // 治療サマリー取得
      const summary = await fetchTreatmentSummary(patient.id);
      setTreatmentSummary(summary);
      setLookupDone(true);
    } catch {
      setAddError("照合中にエラーが発生しました");
    }
    setLookupLoading(false);
  }

  async function fetchTreatmentSummary(patientId: string): Promise<TreatmentSummary> {
    // (a) 現在の傷病名（outcome が null = 治療中）
    const { data: diagData } = await supabase
      .from("patient_diagnoses")
      .select("diagnosis_name, tooth_number, start_date, outcome")
      .eq("patient_id", patientId)
      .is("outcome", null)
      .order("start_date", { ascending: false });

    const diagnoses = (diagData || []).map((d: { diagnosis_name: string; tooth_number: string; start_date: string }) => ({
      name: d.diagnosis_name,
      tooth_number: d.tooth_number || "",
      start_date: d.start_date || "",
    }));

    const activeTeeth = Array.from(
      new Set(diagnoses.map((d: { tooth_number: string }) => d.tooth_number).filter(Boolean))
    );

    // (b) 前回の来院情報
    const { data: lastApt } = await supabase
      .from("appointments")
      .select("scheduled_at, medical_records ( soap_a, soap_p, procedures_text )")
      .eq("patient_id", patientId)
      .eq("status", "completed")
      .order("scheduled_at", { ascending: false })
      .limit(1)
      .single();

    let lastVisit = null;
    let nextPlan = "";

    if (lastApt) {
      const mr = (lastApt.medical_records as unknown as { soap_a: string; soap_p: string; procedures_text: string }[])?.[0];
      const soapP = mr?.soap_p || "";
      const soapA = mr?.soap_a || "";

      const nextMatch = soapP.match(/次回[：:\s]*(.+)/);
      nextPlan = nextMatch ? nextMatch[1].trim() : "";

      const proceduresPart = nextMatch ? soapP.substring(0, nextMatch.index) : soapP;
      const procedures = proceduresPart
        .split(/[・、,\s]+/)
        .map((s: string) => s.trim())
        .filter((s: string) => s && s !== "次回" && s.length < 20);

      lastVisit = { date: lastApt.scheduled_at, soap_p: soapP, soap_a: soapA, procedures };
    }

    return { diagnoses, lastVisit, nextPlan, activeTeeth };
  }

  // ===== 手動予約追加 =====
  async function handleAddAppointment() {
    setAddLoading(true);
    setAddError("");
    if (!addForm.name_kanji || !addForm.date_of_birth || !addForm.phone) { setAddError("必須項目を入力してください"); setAddLoading(false); return; }

    try {
      let patientId: string;
      if (addForm.patient_type === "returning") {
        if (!matchedPatient) { setAddError("患者照合を行ってください"); setAddLoading(false); return; }
        patientId = matchedPatient.id;
        await supabase.from("patients").update({ is_new: false }).eq("id", patientId);
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

      const scheduledAt = `${selectedDate}T${addForm.time}:00`;

      // 来院目的をnotes に保存
      let notes = "";
      if (addForm.patient_type === "returning" && visitReason === "continuing" && treatmentSummary?.nextPlan) {
        notes = `【継続治療】${treatmentSummary.nextPlan}`;
      } else if (addForm.patient_type === "returning" && visitReason === "new_complaint" && newComplaint) {
        notes = `【新しい主訴】${newComplaint}`;
      }

      const { data: appointment, error: aptErr } = await supabase.from("appointments").insert({
        patient_id: patientId, clinic_id: config?.clinicId, doctor_id: addForm.doctor_id || null,
        scheduled_at: scheduledAt, patient_type: addForm.patient_type, status: "reserved",
        duration_min: config?.slotDurationMin || 30,
        ...(notes ? { notes } : {}),
      }).select("id").single();
      if (aptErr || !appointment) { setAddError("予約登録に失敗しました"); setAddLoading(false); return; }

      // medical_record作成
      const mrData: Record<string, unknown> = { appointment_id: appointment.id, patient_id: patientId, status: "draft" };
      if (addForm.patient_type === "returning" && visitReason === "new_complaint" && newComplaint) {
        mrData.soap_s = `【主訴】${newComplaint}`;
      }
      await supabase.from("medical_records").insert(mrData);

      resetAddModal();
      fetchAppointments();
    } catch { setAddError("エラーが発生しました"); }
    setAddLoading(false);
  }

  function resetAddModal() {
    setShowAddModal(false);
    setAddForm({ name_kanji: "", name_kana: "", date_of_birth: "", phone: "", time: timeSlotOptions[0] || "09:00", insurance_type: "社保", burden_ratio: "0.3", patient_type: "new", doctor_id: "" });
    setAddError("");
    setMatchedPatient(null);
    setTreatmentSummary(null);
    setLookupDone(false);
    setVisitReason("");
    setNewComplaint("");
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr); return d.getUTCHours().toString().padStart(2, "0") + ":" + d.getUTCMinutes().toString().padStart(2, "0");
  }

  function formatDateJP(dateStr: string) {
    if (!dateStr) return "";
    return new Date(dateStr).toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
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
                              {apt.notes && <span className="ml-2 text-purple-500">{apt.notes.length > 20 ? apt.notes.substring(0, 20) + "…" : apt.notes}</span>}
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
                  {/* 来院目的 */}
                  {selectedApt.notes && (
                    <div className="border-t border-gray-100 pt-3">
                      <p className="text-xs text-gray-400 mb-0.5">来院目的</p>
                      <p className="text-sm font-bold text-purple-700">{selectedApt.notes}</p>
                    </div>
                  )}
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

      {/* ============================================================ */}
      {/* ===== 手動追加モーダル（★治療サマリー統合版）===== */}
      {/* ============================================================ */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-lg">予約を追加</h3>
              <button onClick={resetAddModal} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {/* 初診/再診 切替 */}
              <div className="flex gap-2">
                <button onClick={() => { setAddForm({ ...addForm, patient_type: "new" }); setLookupDone(false); setMatchedPatient(null); setTreatmentSummary(null); setVisitReason(""); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold ${addForm.patient_type === "new" ? "bg-sky-600 text-white" : "bg-gray-100 text-gray-500"}`}>🆕 初診</button>
                <button onClick={() => { setAddForm({ ...addForm, patient_type: "returning" }); setLookupDone(false); setMatchedPatient(null); setTreatmentSummary(null); setVisitReason(""); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold ${addForm.patient_type === "returning" ? "bg-sky-600 text-white" : "bg-gray-100 text-gray-500"}`}>🔄 再診</button>
              </div>

              {addForm.patient_type === "returning" && !lookupDone && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-2.5">
                  <p className="text-xs text-blue-700">💡 氏名・生年月日・電話番号で照合します。「照合」ボタンを押してください。</p>
                </div>
              )}

              {/* 氏名 */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">氏名（漢字）<span className="text-red-500">*</span></label>
                <input type="text" value={addForm.name_kanji} onChange={(e) => { setAddForm({ ...addForm, name_kanji: e.target.value }); if (addForm.patient_type === "returning") { setLookupDone(false); setMatchedPatient(null); setTreatmentSummary(null); } }}
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
                <input type="date" value={addForm.date_of_birth} onChange={(e) => { setAddForm({ ...addForm, date_of_birth: e.target.value }); if (addForm.patient_type === "returning") { setLookupDone(false); setMatchedPatient(null); setTreatmentSummary(null); } }}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">電話番号<span className="text-red-500">*</span></label>
                <input type="tel" value={addForm.phone} onChange={(e) => { setAddForm({ ...addForm, phone: e.target.value }); if (addForm.patient_type === "returning") { setLookupDone(false); setMatchedPatient(null); setTreatmentSummary(null); } }}
                  placeholder="09012345678" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
              </div>

              {/* ★ 再診: 照合ボタン */}
              {addForm.patient_type === "returning" && !lookupDone && (
                <button onClick={lookupReturningPatient}
                  disabled={lookupLoading || !addForm.name_kanji || !addForm.date_of_birth || !addForm.phone}
                  className="w-full bg-green-600 text-white py-2.5 rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                  {lookupLoading ? "照合中..." : "🔍 患者を照合"}
                </button>
              )}

              {/* ★ 照合成功 → 治療サマリーカード */}
              {addForm.patient_type === "returning" && lookupDone && treatmentSummary && (
                <div className="space-y-3">
                  {/* 照合結果 */}
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                    <span className="text-lg">✅</span>
                    <div>
                      <p className="text-sm font-bold text-green-800">{matchedPatient?.name_kanji} 様</p>
                      <p className="text-xs text-green-600">患者情報が一致しました</p>
                    </div>
                  </div>

                  {/* 治療サマリーカード */}
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 px-3 py-2 border-b border-gray-200">
                      <p className="text-xs font-bold text-gray-700">📋 治療状況</p>
                    </div>
                    <div className="p-3 space-y-2.5">
                      {/* 治療中の傷病名 */}
                      {treatmentSummary.diagnoses.length > 0 ? (
                        <div>
                          <p className="text-[10px] font-bold text-gray-400 mb-1">治療中</p>
                          <div className="space-y-1">
                            {treatmentSummary.diagnoses.slice(0, 4).map((d, i) => (
                              <div key={i} className="flex items-center gap-1.5 text-xs">
                                {d.tooth_number && (
                                  <span className="bg-orange-100 text-orange-700 font-bold px-1.5 py-0.5 rounded text-[10px]">
                                    #{d.tooth_number} {toothLabel(d.tooth_number)}
                                  </span>
                                )}
                                <span className="text-gray-800 font-bold">{d.name}</span>
                              </div>
                            ))}
                            {treatmentSummary.diagnoses.length > 4 && (
                              <p className="text-[10px] text-gray-400">他{treatmentSummary.diagnoses.length - 4}件</p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400">治療中の傷病名なし</p>
                      )}

                      {/* 前回来院 */}
                      {treatmentSummary.lastVisit && (
                        <div className="border-t border-gray-100 pt-2">
                          <p className="text-[10px] font-bold text-gray-400 mb-1">前回: {formatDateJP(treatmentSummary.lastVisit.date)}</p>
                          {treatmentSummary.lastVisit.procedures.length > 0 && (
                            <div className="flex flex-wrap gap-1">
                              {treatmentSummary.lastVisit.procedures.slice(0, 4).map((p, i) => (
                                <span key={i} className="bg-sky-50 text-sky-700 text-[10px] font-bold px-1.5 py-0.5 rounded">{p}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 次回予定 */}
                      {treatmentSummary.nextPlan && (
                        <div className="border-t border-gray-100 pt-2">
                          <p className="text-[10px] font-bold text-gray-400 mb-1">次回予定</p>
                          <p className="text-xs font-bold text-purple-700">{treatmentSummary.nextPlan}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 来院目的選択 */}
                  <div>
                    <p className="text-xs font-bold text-gray-700 mb-1.5">来院目的</p>
                    <div className="flex gap-2">
                      <button onClick={() => { setVisitReason("continuing"); setNewComplaint(""); }}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${visitReason === "continuing" ? "bg-sky-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                        🔄 継続治療
                      </button>
                      <button onClick={() => setVisitReason("new_complaint")}
                        className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${visitReason === "new_complaint" ? "bg-sky-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                        🆕 新しい主訴
                      </button>
                    </div>
                  </div>

                  {/* 新しい主訴の内容入力 */}
                  {visitReason === "new_complaint" && (
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">主訴の内容</label>
                      <textarea value={newComplaint} onChange={(e) => setNewComplaint(e.target.value)}
                        placeholder="例: 左上の奥歯が痛い" rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 resize-none" />
                    </div>
                  )}
                </div>
              )}

              {/* 予約時間 */}
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

              {/* 初診のみ: 保険情報 */}
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
                <button onClick={resetAddModal} className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-lg font-bold">キャンセル</button>
                <button onClick={handleAddAppointment} disabled={addLoading || (addForm.patient_type === "returning" && !lookupDone)}
                  className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold hover:bg-sky-700 disabled:opacity-50">
                  {addLoading ? "登録中..." : "予約を登録"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
