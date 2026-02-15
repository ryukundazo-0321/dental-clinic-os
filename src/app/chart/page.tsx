"use client";

import { useState, useEffect, Suspense, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Patient = {
  id: string; name_kanji: string; name_kana: string;
  date_of_birth: string; phone: string; insurance_type: string;
  burden_ratio: number; is_new: boolean; created_at?: string;
  sex?: string; insurer_number?: string; insured_symbol?: string;
  insured_number?: string; insured_branch?: string;
  public_insurer?: string; public_recipient?: string;
};

type MedicalRecord = {
  id: string; appointment_id: string; patient_id: string; status: string;
  soap_s: string | null; soap_o: string | null; soap_a: string | null; soap_p: string | null;
  tooth_chart: Record<string, string> | null; doctor_confirmed: boolean; created_at: string;
  appointments: { scheduled_at: string; patient_type: string; status: string; doctor_id: string | null } | null;
};

const UPPER_RIGHT = ["18","17","16","15","14","13","12","11"];
const UPPER_LEFT  = ["21","22","23","24","25","26","27","28"];
const LOWER_RIGHT = ["48","47","46","45","44","43","42","41"];
const LOWER_LEFT  = ["31","32","33","34","35","36","37","38"];

const UPPER_RIGHT_D = ["55","54","53","52","51"];
const UPPER_LEFT_D  = ["61","62","63","64","65"];
const LOWER_RIGHT_D = ["85","84","83","82","81"];
const LOWER_LEFT_D  = ["71","72","73","74","75"];

const TOOTH_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  normal:   { label: "健全",   color: "text-green-700",  bg: "bg-green-100" },
  caries:   { label: "C",     color: "text-red-700",    bg: "bg-red-100" },
  treated:  { label: "処置済", color: "text-blue-700",   bg: "bg-blue-100" },
  crown:    { label: "冠",    color: "text-yellow-700", bg: "bg-yellow-100" },
  missing:  { label: "欠損",   color: "text-gray-500",   bg: "bg-gray-200" },
  implant:  { label: "Imp",   color: "text-purple-700", bg: "bg-purple-100" },
  bridge:   { label: "Br",    color: "text-orange-700", bg: "bg-orange-100" },
  deciduous:{ label: "乳",    color: "text-pink-700",   bg: "bg-pink-100" },
  erupting: { label: "萌出",   color: "text-teal-700",   bg: "bg-teal-100" },
};

type Tab = "today" | "all" | "search";
type ToothMode = "permanent" | "deciduous" | "both";

type Diagnosis = {
  id: string; patient_id: string; diagnosis_code: string; diagnosis_name: string;
  tooth_number: string; start_date: string; end_date: string | null;
  outcome: string; is_primary: boolean; notes: string;
};

type DiagnosisMaster = { code: string; name: string; category: string };
type DiagnosisModifier = { id: string; modifier_code: string; modifier_name: string; modifier_position: string };

function ChartContent() {
  const [tab, setTab] = useState<Tab>("today");
  const [searchQuery, setSearchQuery] = useState("");
  const [allPatients, setAllPatients] = useState<Patient[]>([]);
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [editingTooth, setEditingTooth] = useState<string | null>(null);
  const [todayPatients, setTodayPatients] = useState<{ patient: Patient; appointment_status: string; record_id: string | null }[]>([]);
  const [showInsurance, setShowInsurance] = useState(false);
  const [insForm, setInsForm] = useState({ sex: "2", insurer_number: "", insured_symbol: "", insured_number: "", insured_branch: "", public_insurer: "", public_recipient: "" });
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [diagMaster, setDiagMaster] = useState<DiagnosisMaster[]>([]);
  const [diagModifiers, setDiagModifiers] = useState<DiagnosisModifier[]>([]);
  const [showDiagForm, setShowDiagForm] = useState(false);
  const [diagSearch, setDiagSearch] = useState("");
  const [newDiag, setNewDiag] = useState({ diagnosis_code: "", diagnosis_name: "", tooth_number: "", start_date: new Date().toISOString().split("T")[0], outcome: "continuing", is_primary: false, notes: "" });
  const [selectedPrefix, setSelectedPrefix] = useState("");
  const [selectedSuffix, setSelectedSuffix] = useState("");
  const [toothMode, setToothMode] = useState<ToothMode>("permanent");
  const [baseDiagName, setBaseDiagName] = useState("");
  const soapORef = useRef<HTMLTextAreaElement>(null);
  const searchParams = useSearchParams();

  useEffect(() => { loadTodayPatients(); loadAllPatients(); loadDiagMaster(); loadDiagModifiers(); }, []);

  useEffect(() => {
    const pid = searchParams.get("patient_id");
    if (pid && allPatients.length > 0 && !selectedPatient) {
      const found = allPatients.find(p => p.id === pid);
      if (found) selectPatient(found);
    }
  }, [allPatients, searchParams]);

  useEffect(() => {
    if (baseDiagName) {
      const combined = `${selectedPrefix}${baseDiagName}${selectedSuffix}`;
      setNewDiag(prev => ({ ...prev, diagnosis_name: combined }));
    }
  }, [selectedPrefix, selectedSuffix, baseDiagName]);

  async function loadDiagMaster() {
    const { data } = await supabase.from("diagnosis_master").select("code, name, category").order("sort_order");
    if (data) setDiagMaster(data);
  }

  async function loadDiagModifiers() {
    try {
      const { data } = await supabase.from("diagnosis_modifiers").select("*").eq("is_active", true).order("sort_order");
      if (data) setDiagModifiers(data as DiagnosisModifier[]);
    } catch { /* テーブルが存在しない場合はスキップ */ }
  }

  async function loadDiagnoses(patientId: string) {
    const { data } = await supabase.from("patient_diagnoses").select("*").eq("patient_id", patientId).order("start_date", { ascending: false });
    if (data) setDiagnoses(data as Diagnosis[]);
  }

  async function loadTodayPatients() {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase.from("appointments")
      .select("status, patients ( id, name_kanji, name_kana, date_of_birth, phone, insurance_type, burden_ratio, is_new, sex, insurer_number, insured_symbol, insured_number, insured_branch, public_insurer, public_recipient ), medical_records ( id )")
      .gte("scheduled_at", `${today}T00:00:00`).lte("scheduled_at", `${today}T23:59:59`)
      .in("status", ["checked_in", "in_consultation", "completed", "billing_done"])
      .order("scheduled_at", { ascending: true });
    if (data) {
      setTodayPatients(data.filter((d: Record<string, unknown>) => d.patients).map((d: Record<string, unknown>) => ({
        patient: d.patients as unknown as Patient,
        appointment_status: d.status as string,
        record_id: (d.medical_records as { id: string }[])?.[0]?.id || null,
      })));
    }
  }

  async function loadAllPatients() {
    const { data } = await supabase.from("patients").select("*").order("created_at", { ascending: false });
    if (data) setAllPatients(data);
  }

  async function searchPatients(query: string) {
    setSearchQuery(query);
    if (query.length < 1) { setSearchResults([]); return; }
    const { data } = await supabase.from("patients").select("*")
      .or(`name_kanji.ilike.%${query}%,name_kana.ilike.%${query}%,phone.ilike.%${query}%`)
      .order("created_at", { ascending: false }).limit(20);
    if (data) setSearchResults(data);
  }

  async function selectPatient(patient: Patient) {
    setSelectedPatient(patient);
    setInsForm({ sex: patient.sex || "2", insurer_number: patient.insurer_number || "", insured_symbol: patient.insured_symbol || "", insured_number: patient.insured_number || "", insured_branch: patient.insured_branch || "", public_insurer: patient.public_insurer || "", public_recipient: patient.public_recipient || "" });
    setShowInsurance(false);
    setShowDiagForm(false);
    const age = getAge(patient.date_of_birth);
    if (age <= 12) setToothMode("both");
    else if (age <= 6) setToothMode("deciduous");
    else setToothMode("permanent");
    loadDiagnoses(patient.id);
    const { data } = await supabase.from("medical_records")
      .select("id, appointment_id, patient_id, status, soap_s, soap_o, soap_a, soap_p, tooth_chart, doctor_confirmed, created_at, appointments ( scheduled_at, patient_type, status, doctor_id )")
      .eq("patient_id", patient.id).order("created_at", { ascending: false });
    if (data) {
      setRecords(data as unknown as MedicalRecord[]);
      setSelectedRecord(data.length > 0 ? data[0] as unknown as MedicalRecord : null);
    }
  }

  async function saveSOAP() {
    if (!selectedRecord) return; setSaving(true);
    await supabase.from("medical_records").update({ soap_s: selectedRecord.soap_s, soap_o: selectedRecord.soap_o, soap_a: selectedRecord.soap_a, soap_p: selectedRecord.soap_p, tooth_chart: selectedRecord.tooth_chart, status: "soap_complete" }).eq("id", selectedRecord.id);
    setSaveMsg("保存しました ✅"); setTimeout(() => setSaveMsg(""), 2000); setSaving(false);
  }

  async function confirmRecord() {
    if (!selectedRecord) return; setSaving(true);
    await supabase.from("medical_records").update({ soap_s: selectedRecord.soap_s, soap_o: selectedRecord.soap_o, soap_a: selectedRecord.soap_a, soap_p: selectedRecord.soap_p, tooth_chart: selectedRecord.tooth_chart, status: "confirmed", doctor_confirmed: true }).eq("id", selectedRecord.id);
    if (selectedRecord.appointment_id) await supabase.from("appointments").update({ status: "completed" }).eq("id", selectedRecord.appointment_id);
    setSelectedRecord({ ...selectedRecord, status: "confirmed", doctor_confirmed: true });
    setSaveMsg("カルテを確定しました ✅"); setTimeout(() => setSaveMsg(""), 2000); setSaving(false);
  }

  async function unlockRecord() {
    if (!selectedRecord || !confirm("確定を解除して再編集しますか？")) return; setSaving(true);
    await supabase.from("medical_records").update({ status: "soap_complete", doctor_confirmed: false }).eq("id", selectedRecord.id);
    setSelectedRecord({ ...selectedRecord, status: "soap_complete", doctor_confirmed: false });
    setSaveMsg("編集可能にしました ✅"); setTimeout(() => setSaveMsg(""), 2000); setSaving(false);
  }

  async function deleteRecord() {
    if (!selectedRecord || !selectedPatient) return;
    if (!confirm(`このカルテ（${selectedRecord.appointments?.scheduled_at ? formatDate(selectedRecord.appointments.scheduled_at) : formatDate(selectedRecord.created_at)}）を削除しますか？`)) return;
    setSaving(true);
    await supabase.from("billing").delete().eq("record_id", selectedRecord.id);
    await supabase.from("medical_records").delete().eq("id", selectedRecord.id);
    const newRecords = records.filter(r => r.id !== selectedRecord.id);
    setRecords(newRecords);
    setSelectedRecord(newRecords.length > 0 ? newRecords[0] : null);
    setSaveMsg("カルテを削除しました 🗑️"); setTimeout(() => setSaveMsg(""), 2000); setSaving(false);
  }

  async function saveInsurance() {
    if (!selectedPatient) return; setSaving(true);
    await supabase.from("patients").update(insForm).eq("id", selectedPatient.id);
    setSelectedPatient({ ...selectedPatient, ...insForm });
    setAllPatients(allPatients.map(p => p.id === selectedPatient.id ? { ...p, ...insForm } : p));
    setSaveMsg("保険情報を保存しました ✅"); setTimeout(() => setSaveMsg(""), 2000); setSaving(false); setShowInsurance(false);
  }

  async function addDiagnosis() {
    if (!selectedPatient || !newDiag.diagnosis_name) return;
    setSaving(true);
    await supabase.from("patient_diagnoses").insert({ patient_id: selectedPatient.id, ...newDiag });
    await loadDiagnoses(selectedPatient.id);
    setNewDiag({ diagnosis_code: "", diagnosis_name: "", tooth_number: "", start_date: new Date().toISOString().split("T")[0], outcome: "continuing", is_primary: false, notes: "" });
    setSelectedPrefix(""); setSelectedSuffix(""); setBaseDiagName("");
    setShowDiagForm(false); setDiagSearch("");
    setSaveMsg("傷病名を追加しました ✅"); setTimeout(() => setSaveMsg(""), 2000); setSaving(false);
  }

  async function deleteDiagnosis(id: string) {
    if (!selectedPatient || !confirm("この傷病名を削除しますか？")) return;
    await supabase.from("patient_diagnoses").delete().eq("id", id);
    await loadDiagnoses(selectedPatient.id);
  }

  async function updateOutcome(id: string, outcome: string) {
    if (!selectedPatient) return;
    const endDate = outcome !== "continuing" ? new Date().toISOString().split("T")[0] : null;
    await supabase.from("patient_diagnoses").update({ outcome, end_date: endDate }).eq("id", id);
    await loadDiagnoses(selectedPatient.id);
  }

  async function deletePatient() {
    if (!selectedPatient) return;
    if (!confirm(`⚠️ 「${selectedPatient.name_kanji}」さんの患者データを完全に削除しますか？\n\n関連するカルテ・予約・会計データも全て削除されます。`)) return;
    if (!confirm(`本当に削除してよろしいですか？\n患者名: ${selectedPatient.name_kanji}`)) return;
    setSaving(true);
    const pid = selectedPatient.id;
    const { data: recs } = await supabase.from("medical_records").select("id").eq("patient_id", pid);
    if (recs) { for (const r of recs) { await supabase.from("billing").delete().eq("record_id", r.id); } }
    const { data: apts } = await supabase.from("appointments").select("id").eq("patient_id", pid);
    if (apts) { for (const a of apts) { await supabase.from("queue").delete().eq("appointment_id", a.id); } }
    await supabase.from("medical_records").delete().eq("patient_id", pid);
    await supabase.from("appointments").delete().eq("patient_id", pid);
    await supabase.from("patients").delete().eq("id", pid);
    setSelectedPatient(null); setSelectedRecord(null); setRecords([]);
    setAllPatients(allPatients.filter(p => p.id !== pid));
    setTodayPatients(todayPatients.filter(tp => tp.patient.id !== pid));
    setSaveMsg("患者データを削除しました 🗑️"); setTimeout(() => setSaveMsg(""), 3000); setSaving(false);
  }

  function onToothClickForSOAP(toothNum: string) {
    if (!selectedRecord || selectedRecord.status === "confirmed") return;
    const tag = `#${toothNum} `;
    const currentO = selectedRecord.soap_o || "";
    if (!currentO.includes(`#${toothNum}`)) {
      setSelectedRecord({ ...selectedRecord, soap_o: currentO + (currentO && !currentO.endsWith(" ") ? " " : "") + tag });
    }
    setTimeout(() => soapORef.current?.focus(), 100);
  }

  function setToothStatus(toothNum: string, status: string) {
    if (!selectedRecord) return;
    const chart = { ...(selectedRecord.tooth_chart || {}) };
    if (status === "normal") delete chart[toothNum]; else chart[toothNum] = status;
    setSelectedRecord({ ...selectedRecord, tooth_chart: chart });
  }

  function formatDate(dateStr: string) { return new Date(dateStr).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" }); }
  function getAge(dob: string) { const b = new Date(dob), t = new Date(); let a = t.getFullYear() - b.getFullYear(); if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--; return a; }

  const filteredDiagMaster = diagSearch.length > 0 ? diagMaster.filter(d => d.name.includes(diagSearch) || d.code.includes(diagSearch)) : diagMaster;
  const OUTCOME_LABEL: Record<string, { text: string; color: string }> = { continuing: { text: "継続", color: "bg-blue-100 text-blue-700" }, cured: { text: "治癒", color: "bg-green-100 text-green-700" }, suspended: { text: "中止", color: "bg-yellow-100 text-yellow-700" }, died: { text: "死亡", color: "bg-gray-200 text-gray-600" } };
  const prefixModifiers = diagModifiers.filter(m => m.modifier_position === "prefix");
  const suffixModifiers = diagModifiers.filter(m => m.modifier_position === "suffix");

  function renderTooth(toothNum: string, isDeciduous = false) {
    const status = selectedRecord?.tooth_chart?.[toothNum] || "normal";
    const cfg = TOOTH_STATUS[status] || TOOTH_STATUS.normal;
    const isEditing = editingTooth === toothNum;
    const size = isDeciduous ? "w-7 h-7 text-[9px]" : "w-9 h-9 text-[10px]";
    return (
      <div key={toothNum} className="relative">
        <button onClick={() => { setEditingTooth(isEditing ? null : toothNum); onToothClickForSOAP(toothNum); }}
          className={`${size} rounded-lg font-bold border transition-all ${status === "normal" ? `bg-white border-gray-200 ${isDeciduous ? "text-pink-400" : "text-gray-500"} hover:border-sky-300` : `${cfg.bg} border-transparent ${cfg.color}`} ${isEditing ? "ring-2 ring-sky-400" : ""}`}>
          {status === "normal" ? toothNum : cfg.label}
        </button>
        {isEditing && (
          <div className="absolute z-20 top-full mt-1 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-lg border border-gray-200 p-2 min-w-[120px]">
            <p className="text-[10px] text-gray-400 text-center mb-1">#{toothNum}{isDeciduous ? " (乳歯)" : ""}</p>
            {Object.entries(TOOTH_STATUS).map(([key, val]) => (
              <button key={key} onClick={() => { setToothStatus(toothNum, key); setEditingTooth(null); }}
                className={`w-full text-left px-2 py-1 rounded text-xs font-bold hover:bg-gray-50 ${status === key ? "bg-sky-50 text-sky-700" : "text-gray-700"}`}>
                <span className={`inline-block w-4 h-4 rounded text-center text-[9px] leading-4 mr-1.5 ${val.bg} ${val.color}`}>{val.label.charAt(0)}</span>{val.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const statusBadge: Record<string, { text: string; color: string }> = {
    checked_in: { text: "来院済", color: "bg-green-100 text-green-700" },
    in_consultation: { text: "診察中", color: "bg-orange-100 text-orange-700" },
    completed: { text: "完了", color: "bg-purple-100 text-purple-700" },
    billing_done: { text: "会計済", color: "bg-gray-100 text-gray-500" },
  };

  function PatientRow({ patient, extra, onClick }: { patient: Patient; extra?: React.ReactNode; onClick: () => void }) {
    return (
      <button onClick={onClick}
        className={`w-full text-left bg-white rounded-xl border p-3.5 hover:border-sky-300 hover:shadow-md transition-all ${selectedPatient?.id === patient.id ? "border-sky-400 shadow-md bg-sky-50/30" : "border-gray-200"}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-sky-100 to-sky-200 text-sky-700 w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0">{patient.name_kanji.charAt(0)}</div>
            <div>
              <div className="flex items-center gap-1.5"><p className="font-bold text-gray-900 text-sm">{patient.name_kanji}</p><span className="text-[10px] text-gray-400">{patient.name_kana}</span></div>
              <p className="text-[10px] text-gray-400">{getAge(patient.date_of_birth)}歳 / {patient.phone}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">{extra}<span className="text-gray-300">›</span></div>
        </div>
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-full mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">📋 電子カルテ</h1>
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && <span className="text-green-600 text-sm font-bold">{saveMsg}</span>}
            <span className="text-xs text-gray-400">患者数: {allPatients.length}名</span>
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto flex" style={{ height: "calc(100vh - 57px)" }}>
        {/* 左サイドバー */}
        <div className="w-[360px] flex-shrink-0 border-r border-gray-200 bg-white flex flex-col">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300 text-sm">🔍</span>
              <input type="text" value={searchQuery}
                onChange={(e) => { searchPatients(e.target.value); if (e.target.value.length > 0) setTab("search"); else setTab("today"); }}
                placeholder="患者名・カナ・電話番号で検索..."
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 focus:bg-white" />
            </div>
          </div>
          <div className="flex border-b border-gray-100">
            {([{ key: "today" as Tab, label: "本日の来院", count: todayPatients.length }, { key: "all" as Tab, label: "全患者", count: allPatients.length }]).map((t) => (
              <button key={t.key} onClick={() => { setTab(t.key); setSearchQuery(""); setSearchResults([]); }}
                className={`flex-1 py-2.5 text-xs font-bold text-center border-b-2 transition-colors ${tab === t.key ? "border-sky-500 text-sky-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
                {t.label} <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${tab === t.key ? "bg-sky-100 text-sky-600" : "bg-gray-100 text-gray-400"}`}>{t.count}</span>
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {tab === "search" && (searchResults.length > 0 ? searchResults.map((p) => <PatientRow key={p.id} patient={p} onClick={() => selectPatient(p)} />) : searchQuery.length > 0 ? <div className="text-center py-8"><p className="text-gray-400 text-sm">該当なし</p></div> : null)}
            {tab === "today" && (todayPatients.length > 0 ? todayPatients.map((tp, idx) => { const st = statusBadge[tp.appointment_status] || { text: tp.appointment_status, color: "bg-gray-100 text-gray-500" }; return <PatientRow key={`${tp.patient.id}-${idx}`} patient={tp.patient} onClick={() => selectPatient(tp.patient)} extra={<span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${st.color}`}>{st.text}</span>} />; }) : <div className="text-center py-12"><p className="text-3xl mb-2">📅</p><p className="text-gray-400 text-sm">本日の来院なし</p></div>)}
            {tab === "all" && (allPatients.length > 0 ? allPatients.map((p) => <PatientRow key={p.id} patient={p} onClick={() => selectPatient(p)} />) : <div className="text-center py-12"><p className="text-3xl mb-2">👤</p><p className="text-gray-400 text-sm">患者データなし</p></div>)}
          </div>
        </div>

        {/* 右メインエリア */}
        <div className="flex-1 overflow-y-auto">
          {!selectedPatient ? (
            <div className="h-full flex items-center justify-center"><div className="text-center"><p className="text-6xl mb-4">📋</p><p className="text-gray-400 text-lg font-bold">左から患者を選択してください</p></div></div>
          ) : (
            <div className="p-4">
              {/* 患者ヘッダー */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="bg-gradient-to-br from-sky-100 to-sky-200 text-sky-700 w-14 h-14 rounded-full flex items-center justify-center font-bold text-xl">{selectedPatient.name_kanji.charAt(0)}</div>
                    <div>
                      <div className="flex items-center gap-2"><h2 className="text-xl font-bold text-gray-900">{selectedPatient.name_kanji}</h2><span className="text-sm text-gray-400">({selectedPatient.name_kana})</span>{selectedPatient.is_new && <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded font-bold">初診</span>}</div>
                      <p className="text-sm text-gray-400">{selectedPatient.date_of_birth} ({getAge(selectedPatient.date_of_birth)}歳) / {selectedPatient.phone} / {selectedPatient.insurance_type} {selectedPatient.burden_ratio * 10}割</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-center"><p className="text-2xl font-bold text-sky-600">{records.length}</p><p className="text-[10px] text-gray-400">来院回数</p></div>
                    <button onClick={() => setShowInsurance(!showInsurance)} className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors ${showInsurance ? "bg-sky-100 text-sky-700" : "text-sky-500 hover:bg-sky-50"}`}>🏥 保険証情報</button>
                    <Link href={`/management-plan?patient_id=${selectedPatient.id}`} className="text-xs px-2.5 py-1.5 rounded-lg text-emerald-500 hover:bg-emerald-50 transition-colors">📄 管理計画書</Link>
                    <button onClick={deletePatient} disabled={saving} className="text-xs text-red-400 hover:text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50">🗑️ 患者削除</button>
                  </div>
                </div>
                {showInsurance && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div><label className="text-[10px] text-gray-400 block mb-1">性別</label><select value={insForm.sex} onChange={e => setInsForm({...insForm, sex: e.target.value})} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm"><option value="1">男</option><option value="2">女</option></select></div>
                      <div><label className="text-[10px] text-gray-400 block mb-1">保険者番号（8桁）</label><input value={insForm.insurer_number} onChange={e => setInsForm({...insForm, insurer_number: e.target.value})} placeholder="01130012" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-1">被保険者記号</label><input value={insForm.insured_symbol} onChange={e => setInsForm({...insForm, insured_symbol: e.target.value})} placeholder="751-743" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-1">被保険者番号</label><input value={insForm.insured_number} onChange={e => setInsForm({...insForm, insured_number: e.target.value})} placeholder="1045" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-1">枝番</label><input value={insForm.insured_branch} onChange={e => setInsForm({...insForm, insured_branch: e.target.value})} placeholder="01" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-1">公費負担者番号</label><input value={insForm.public_insurer} onChange={e => setInsForm({...insForm, public_insurer: e.target.value})} placeholder="82230004" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
                      <div><label className="text-[10px] text-gray-400 block mb-1">公費受給者番号</label><input value={insForm.public_recipient} onChange={e => setInsForm({...insForm, public_recipient: e.target.value})} placeholder="9999996" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
                      <div className="flex items-end"><button onClick={saveInsurance} disabled={saving} className="w-full bg-sky-600 text-white py-1.5 rounded-lg text-xs font-bold hover:bg-sky-700 disabled:opacity-50">💾 保存</button></div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-4">
                {/* カルテ履歴 */}
                <div className="w-48 flex-shrink-0">
                  <h3 className="text-xs font-bold text-gray-400 mb-2 px-1">カルテ履歴</h3>
                  <div className="space-y-1">
                    {records.map((rec) => (
                      <button key={rec.id} onClick={() => setSelectedRecord(rec)}
                        className={`w-full text-left p-2.5 rounded-lg text-sm transition-all ${selectedRecord?.id === rec.id ? "bg-sky-50 border border-sky-300 shadow-sm" : "bg-white border border-gray-200 hover:border-gray-300"}`}>
                        <p className="font-bold text-gray-900 text-xs">{rec.appointments?.scheduled_at ? formatDate(rec.appointments.scheduled_at) : formatDate(rec.created_at)}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${rec.status === "confirmed" ? "bg-green-100 text-green-600" : rec.status === "soap_complete" ? "bg-yellow-100 text-yellow-600" : "bg-gray-100 text-gray-400"}`}>{rec.status === "confirmed" ? "確定" : rec.status === "soap_complete" ? "SOAP済" : "下書き"}</span>
                          {rec.appointments?.patient_type === "new" && <span className="text-[10px] text-red-500 font-bold">初診</span>}
                        </div>
                      </button>
                    ))}
                    {records.length === 0 && <p className="text-xs text-gray-400 p-3 text-center">カルテなし</p>}
                  </div>
                </div>

                {/* メインカルテ */}
                <div className="flex-1">
                  {selectedRecord ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${selectedRecord.status === "confirmed" ? "bg-green-100 text-green-700" : selectedRecord.status === "soap_complete" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>{selectedRecord.status === "confirmed" ? "✅ 確定済み" : selectedRecord.status === "soap_complete" ? "📝 SOAP入力済み" : "📋 下書き"}</span>
                          <button onClick={deleteRecord} disabled={saving} className="text-[10px] text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors disabled:opacity-50">🗑️ このカルテを削除</button>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={saveSOAP} disabled={saving || selectedRecord.status === "confirmed"} className="bg-sky-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-sky-700 disabled:opacity-50">{saving ? "保存中..." : "一時保存"}</button>
                          {selectedRecord.status === "confirmed" ? <button onClick={unlockRecord} disabled={saving} className="bg-yellow-500 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-yellow-600 disabled:opacity-50">🔓 編集する</button> : <button onClick={confirmRecord} disabled={saving} className="bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-green-700 disabled:opacity-50">カルテ確定</button>}
                        </div>
                      </div>

                      {/* SOAP */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        {([
                          { key: "soap_s" as const, l: "S", t: "主観的情報", c: "bg-red-100 text-red-700", p: "例: 右下奥歯が痛い" },
                          { key: "soap_o" as const, l: "O", t: "客観的情報（歯式クリックで自動入力）", c: "bg-blue-100 text-blue-700", p: "例: #46 遠心面にC2" },
                          { key: "soap_a" as const, l: "A", t: "評価", c: "bg-yellow-100 text-yellow-700", p: "例: #46 C2" },
                          { key: "soap_p" as const, l: "P", t: "計画", c: "bg-green-100 text-green-700", p: "例: CR充填、次回経過観察" },
                        ]).map((s) => (
                          <div key={s.key} className="bg-white rounded-xl border border-gray-200 p-3">
                            <div className="flex items-center gap-2 mb-2"><span className={`${s.c} text-xs font-bold w-6 h-6 rounded flex items-center justify-center`}>{s.l}</span><h4 className="text-xs font-bold text-gray-700">{s.t}</h4></div>
                            <textarea ref={s.key === "soap_o" ? soapORef : undefined} value={selectedRecord[s.key] || ""} onChange={(e) => setSelectedRecord({ ...selectedRecord, [s.key]: e.target.value })} disabled={selectedRecord.status === "confirmed"} placeholder={s.p} rows={4} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 resize-none disabled:bg-gray-50" />
                          </div>
                        ))}
                      </div>

                      {/* 傷病名セクション */}
                      <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-bold text-gray-900">🏷️ 傷病名</h4>
                          <button onClick={() => setShowDiagForm(!showDiagForm)} className={`text-xs px-3 py-1 rounded-lg font-bold transition-colors ${showDiagForm ? "bg-gray-200 text-gray-600" : "bg-sky-100 text-sky-700 hover:bg-sky-200"}`}>{showDiagForm ? "✕ 閉じる" : "＋ 追加"}</button>
                        </div>
                        {showDiagForm && (
                          <div className="mb-4 bg-sky-50 rounded-xl p-3 border border-sky-200">
                            <div className="mb-2">
                              <input value={diagSearch} onChange={e => setDiagSearch(e.target.value)} placeholder="傷病名を検索（例: う蝕、歯周炎）" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" />
                            </div>
                            {diagSearch.length > 0 && (
                              <div className="max-h-32 overflow-y-auto mb-2 bg-white rounded-lg border border-gray-200">
                                {filteredDiagMaster.map(d => (
                                  <button key={d.code} onClick={() => { setNewDiag({ ...newDiag, diagnosis_code: d.code, diagnosis_name: d.name }); setBaseDiagName(d.name); setSelectedPrefix(""); setSelectedSuffix(""); setDiagSearch(""); }}
                                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-sky-50 border-b border-gray-50 last:border-0">
                                    <span className="text-xs text-gray-400 mr-2">{d.code}</span><span className="font-bold text-gray-700">{d.name}</span>
                                    <span className="text-[10px] text-gray-300 ml-2">{d.category}</span>
                                  </button>
                                ))}
                                {filteredDiagMaster.length === 0 && <p className="text-xs text-gray-400 p-2 text-center">該当なし</p>}
                              </div>
                            )}
                            {newDiag.diagnosis_name && (
                              <div className="space-y-2">
                                <div className="bg-white rounded-lg p-2 border border-sky-200">
                                  <p className="text-sm font-bold text-sky-700">{newDiag.diagnosis_name} <span className="text-xs text-gray-400">({newDiag.diagnosis_code})</span></p>
                                </div>
                                {/* 修飾語セクション */}
                                {diagModifiers.length > 0 && (
                                  <div className="bg-white rounded-lg p-2 border border-gray-200">
                                    <p className="text-[10px] text-gray-400 font-bold mb-1">修飾語</p>
                                    {prefixModifiers.length > 0 && (
                                      <div className="mb-1.5">
                                        <p className="text-[9px] text-gray-300 mb-0.5">前置修飾語</p>
                                        <div className="flex flex-wrap gap-1">
                                          <button onClick={() => setSelectedPrefix("")} className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${selectedPrefix === "" ? "bg-sky-100 border-sky-300 text-sky-700" : "bg-white border-gray-200 text-gray-500 hover:border-sky-200"}`}>なし</button>
                                          {prefixModifiers.map(m => (
                                            <button key={m.id} onClick={() => setSelectedPrefix(m.modifier_name)}
                                              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${selectedPrefix === m.modifier_name ? "bg-sky-100 border-sky-300 text-sky-700" : "bg-white border-gray-200 text-gray-500 hover:border-sky-200"}`}>
                                              {m.modifier_name}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                    {suffixModifiers.length > 0 && (
                                      <div>
                                        <p className="text-[9px] text-gray-300 mb-0.5">後置修飾語</p>
                                        <div className="flex flex-wrap gap-1">
                                          <button onClick={() => setSelectedSuffix("")} className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${selectedSuffix === "" ? "bg-sky-100 border-sky-300 text-sky-700" : "bg-white border-gray-200 text-gray-500 hover:border-sky-200"}`}>なし</button>
                                          {suffixModifiers.map(m => (
                                            <button key={m.id} onClick={() => setSelectedSuffix(m.modifier_name)}
                                              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${selectedSuffix === m.modifier_name ? "bg-sky-100 border-sky-300 text-sky-700" : "bg-white border-gray-200 text-gray-500 hover:border-sky-200"}`}>
                                              {m.modifier_name}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="grid grid-cols-3 gap-2">
                                  <div><label className="text-[10px] text-gray-400 block mb-0.5">歯番</label>
                                    <input value={newDiag.tooth_number} onChange={e => setNewDiag({...newDiag, tooth_number: e.target.value})} placeholder="#46" className="w-full border border-gray-200 rounded px-2 py-1 text-xs" /></div>
                                  <div><label className="text-[10px] text-gray-400 block mb-0.5">開始日</label>
                                    <input type="date" value={newDiag.start_date} onChange={e => setNewDiag({...newDiag, start_date: e.target.value})} className="w-full border border-gray-200 rounded px-2 py-1 text-xs" /></div>
                                  <div className="flex items-end">
                                    <button onClick={addDiagnosis} disabled={saving} className="w-full bg-sky-600 text-white py-1 rounded text-xs font-bold hover:bg-sky-700 disabled:opacity-50">追加</button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {diagnoses.length > 0 ? (
                          <div className="space-y-1.5">
                            {diagnoses.map(d => {
                              const oc = OUTCOME_LABEL[d.outcome] || OUTCOME_LABEL.continuing;
                              return (
                                <div key={d.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                                  <div className="flex items-center gap-2 flex-1">
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${oc.color}`}>{oc.text}</span>
                                    <span className="text-sm font-bold text-gray-800">{d.diagnosis_name}</span>
                                    {d.tooth_number && <span className="text-xs text-sky-600 font-bold">{d.tooth_number}</span>}
                                    <span className="text-[10px] text-gray-400">{d.start_date}</span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <select value={d.outcome} onChange={e => updateOutcome(d.id, e.target.value)} className="text-[10px] border border-gray-200 rounded px-1 py-0.5">
                                      <option value="continuing">継続</option><option value="cured">治癒</option><option value="suspended">中止</option>
                                    </select>
                                    <button onClick={() => deleteDiagnosis(d.id)} className="text-[10px] text-red-400 hover:text-red-600 px-1">✕</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400 text-center py-2">傷病名が登録されていません</p>
                        )}
                      </div>

                      {/* 歯式チャート */}
                      <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-sm font-bold text-gray-900">🦷 歯式チャート</h4>
                          <div className="flex items-center gap-2">
                            <p className="text-[10px] text-gray-400">タップで状態変更＆SOAP O欄に自動入力</p>
                            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
                              <button onClick={() => setToothMode("permanent")} className={`text-[10px] px-2 py-0.5 rounded font-bold transition-colors ${toothMode === "permanent" ? "bg-white text-gray-700 shadow-sm" : "text-gray-400"}`}>永久歯</button>
                              <button onClick={() => setToothMode("both")} className={`text-[10px] px-2 py-0.5 rounded font-bold transition-colors ${toothMode === "both" ? "bg-white text-gray-700 shadow-sm" : "text-gray-400"}`}>混合</button>
                              <button onClick={() => setToothMode("deciduous")} className={`text-[10px] px-2 py-0.5 rounded font-bold transition-colors ${toothMode === "deciduous" ? "bg-white text-gray-700 shadow-sm" : "text-gray-400"}`}>乳歯</button>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          {/* 半顎ラベル */}
                          <div className="w-full flex justify-between px-4 mb-0.5">
                            <span className="text-[9px] text-gray-400 font-bold">右上</span>
                            <span className="text-[9px] text-gray-400 font-bold">左上</span>
                          </div>
                          {/* 永久歯 上顎 */}
                          {(toothMode === "permanent" || toothMode === "both") && (
                            <div className="flex gap-0.5">
                              <div className="flex gap-0.5 border-r-2 border-gray-400 pr-1">{UPPER_RIGHT.map(t => renderTooth(t))}</div>
                              <div className="flex gap-0.5 pl-1">{UPPER_LEFT.map(t => renderTooth(t))}</div>
                            </div>
                          )}
                          {/* 乳歯 上顎 */}
                          {(toothMode === "deciduous" || toothMode === "both") && (
                            <div className="flex gap-0.5">
                              <div className="flex gap-0.5 border-r-2 border-pink-300 pr-1">{UPPER_RIGHT_D.map(t => renderTooth(t, true))}</div>
                              <div className="flex gap-0.5 pl-1">{UPPER_LEFT_D.map(t => renderTooth(t, true))}</div>
                            </div>
                          )}
                          <div className="w-full border-t-2 border-gray-400 my-1" />
                          {/* 乳歯 下顎 */}
                          {(toothMode === "deciduous" || toothMode === "both") && (
                            <div className="flex gap-0.5">
                              <div className="flex gap-0.5 border-r-2 border-pink-300 pr-1">{LOWER_RIGHT_D.map(t => renderTooth(t, true))}</div>
                              <div className="flex gap-0.5 pl-1">{LOWER_LEFT_D.map(t => renderTooth(t, true))}</div>
                            </div>
                          )}
                          {/* 永久歯 下顎 */}
                          {(toothMode === "permanent" || toothMode === "both") && (
                            <div className="flex gap-0.5">
                              <div className="flex gap-0.5 border-r-2 border-gray-400 pr-1">{LOWER_RIGHT.map(t => renderTooth(t))}</div>
                              <div className="flex gap-0.5 pl-1">{LOWER_LEFT.map(t => renderTooth(t))}</div>
                            </div>
                          )}
                          <div className="w-full flex justify-between px-4 mt-0.5">
                            <span className="text-[9px] text-gray-400 font-bold">右下</span>
                            <span className="text-[9px] text-gray-400 font-bold">左下</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-3 justify-center">
                          {Object.entries(TOOTH_STATUS).map(([k, v]) => (
                            <span key={k} className={`text-[10px] font-bold px-2 py-0.5 rounded ${v.bg} ${v.color}`}>{v.label}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : <div className="bg-white rounded-xl border border-gray-200 p-12 text-center"><p className="text-3xl mb-2">📝</p><p className="text-gray-400">カルテ履歴がありません</p></div>}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
      {editingTooth && <div className="fixed inset-0 z-10" onClick={() => setEditingTooth(null)} />}
    </div>
  );
}

export default function ChartPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>}>
      <ChartContent />
    </Suspense>
  );
}
