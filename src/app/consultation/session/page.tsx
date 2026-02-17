"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Patient = {
  id: string; name_kanji: string; name_kana: string;
  date_of_birth: string; phone: string; insurance_type: string; burden_ratio: number;
};

type MedicalRecord = {
  id: string; appointment_id: string; patient_id: string; status: string;
  soap_s: string | null; soap_o: string | null; soap_a: string | null; soap_p: string | null;
  tooth_chart: Record<string, string> | null;
};

type BillingItem = { code: string; name: string; points: number; count: number; tooth?: string };

type TranscriptEntry = {
  id: string;
  recording_number: number;
  transcript_text: string;
  duration_seconds: number | null;
  is_edited: boolean;
  created_at: string;
};

type PreviousVisit = {
  date: string; soap_a: string; soap_p: string;
  procedures: string[]; nextPlan: string; toothNumbers: string[];
};

type PlannedProcedure = { name: string; checked: boolean };

const UPPER_RIGHT = ["18","17","16","15","14","13","12","11"];
const UPPER_LEFT = ["21","22","23","24","25","26","27","28"];
const LOWER_RIGHT = ["48","47","46","45","44","43","42","41"];
const LOWER_LEFT = ["31","32","33","34","35","36","37","38"];
const DECID_UPPER_RIGHT = ["55","54","53","52","51"];
const DECID_UPPER_LEFT = ["61","62","63","64","65"];
const DECID_LOWER_RIGHT = ["85","84","83","82","81"];
const DECID_LOWER_LEFT = ["71","72","73","74","75"];

const TOOTH_STATUS: Record<string, { label: string; color: string; bg: string; border: string; shortLabel?: string }> = {
  normal:       { label: "健全",   color: "text-gray-500",   bg: "bg-white",      border: "border-gray-200",  shortLabel: "○" },
  caries:       { label: "C",      color: "text-red-700",    bg: "bg-red-50",     border: "border-red-300",   shortLabel: "C" },
  in_treatment: { label: "治療中", color: "text-orange-700", bg: "bg-orange-50",  border: "border-orange-300",shortLabel: "🔧" },
  treated:      { label: "処置済", color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-300",  shortLabel: "●" },
  crown:        { label: "冠",     color: "text-yellow-700", bg: "bg-yellow-50",  border: "border-yellow-300",shortLabel: "冠" },
  missing:      { label: "欠損",   color: "text-gray-400",   bg: "bg-gray-100",   border: "border-gray-300",  shortLabel: "/" },
  implant:      { label: "Imp",    color: "text-purple-700", bg: "bg-purple-50",  border: "border-purple-300",shortLabel: "I" },
  bridge:       { label: "Br",     color: "text-orange-700", bg: "bg-orange-50",  border: "border-orange-300",shortLabel: "Br" },
};
const CHECK_STATUSES = ["normal", "caries", "in_treatment", "treated", "crown", "missing"] as const;
type DentitionMode = "permanent" | "mixed";

function SessionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const appointmentId = searchParams.get("appointment_id");

  // Core state
  const [patient, setPatient] = useState<Patient | null>(null);
  const [record, setRecord] = useState<MedicalRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Timer
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const recordingStartRef = useRef<number>(0);

  // Recording
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // ★ 文字起こし蓄積（新フロー）
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  // SOAP生成
  const [generatingSOAP, setGeneratingSOAP] = useState(false);
  const [aiResult, setAiResult] = useState<{
    soap: { s: string; o: string; a: string; p: string };
    tooth_updates: Record<string, string>;
    procedures: string[];
    diagnoses: { name: string; tooth: string; code: string }[];
  } | null>(null);
  const [showAiPreview, setShowAiPreview] = useState(false);

  // Tooth chart
  const [editingTooth, setEditingTooth] = useState<string | null>(null);
  const [dentitionMode, setDentitionMode] = useState<DentitionMode>("permanent");
  const [checkMode, setCheckMode] = useState(false);
  const [checkBrush, setCheckBrush] = useState<string>("normal");

  // Billing
  const [billingItems, setBillingItems] = useState<BillingItem[]>([]);
  const [billingTotal, setBillingTotal] = useState(0);
  const [showBillingEdit, setShowBillingEdit] = useState(false);

  // 通院モード
  const [patientType, setPatientType] = useState<string>("new");
  const [previousVisit, setPreviousVisit] = useState<PreviousVisit | null>(null);
  const [plannedProcedures, setPlannedProcedures] = useState<PlannedProcedure[]>([]);
  const [visitCondition, setVisitCondition] = useState<"as_planned" | "changed" | "">("");
  const [changeNote, setChangeNote] = useState("");
  const [quickSoapApplied, setQuickSoapApplied] = useState(false);

  const isReturning = patientType === "returning";
  const hasPreviousPlan = previousVisit && previousVisit.nextPlan;

  useEffect(() => { if (appointmentId) loadSession(); }, [appointmentId]);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ===== データ読み込み =====
  async function loadSession() {
    setLoading(true);
    let aptData: Record<string, unknown> | null = null;
    const { data: apt1, error: err1 } = await supabase
      .from("appointments")
      .select(`id, patient_id, patient_type, patients ( id, name_kanji, name_kana, date_of_birth, phone, insurance_type, burden_ratio )`)
      .eq("id", appointmentId).single();
    if (apt1 && !err1) { aptData = apt1 as Record<string, unknown>; }
    else {
      const { data: apt2 } = await supabase
        .from("appointments")
        .select(`id, patient_id, patients ( id, name_kanji, name_kana, date_of_birth, phone, insurance_type, burden_ratio )`)
        .eq("id", appointmentId).single();
      if (apt2) aptData = apt2 as Record<string, unknown>;
    }
    if (aptData) {
      const p = aptData.patients as unknown as Patient;
      setPatient(p);
      setPatientType(String(aptData.patient_type || "new"));
      const { data: rec } = await supabase.from("medical_records").select("*").eq("appointment_id", appointmentId).limit(1).single();
      if (rec) {
        setRecord(rec as unknown as MedicalRecord);
        const { data: billing } = await supabase.from("billing").select("procedures_detail, total_points").eq("record_id", (rec as Record<string, unknown>).id).limit(1).single();
        if (billing) { setBillingItems((billing.procedures_detail || []) as BillingItem[]); setBillingTotal(billing.total_points || 0); }
      }
      // 文字起こし履歴を読み込む
      await loadTranscripts();
      if (String(aptData.patient_type || "") === "returning") {
        await loadPreviousVisit(p.id);
      }
    }
    setLoading(false);
  }

  async function loadTranscripts() {
    const { data } = await supabase.from("consultation_transcripts")
      .select("*").eq("appointment_id", appointmentId)
      .order("recording_number", { ascending: true });
    if (data) setTranscripts(data as TranscriptEntry[]);
  }

  async function loadPreviousVisit(patientId: string) {
    const { data: prevApt } = await supabase.from("appointments")
      .select("scheduled_at, medical_records ( soap_a, soap_p )")
      .eq("patient_id", patientId).eq("status", "completed")
      .order("scheduled_at", { ascending: false }).limit(1).single();
    if (!prevApt) return;
    const mr = (prevApt.medical_records as unknown as { soap_a: string; soap_p: string }[])?.[0];
    if (!mr) return;
    const soapP = mr.soap_p || "";
    const soapA = mr.soap_a || "";
    const nextMatch = soapP.match(/次回[：:\s]*(.+)/);
    const nextPlan = nextMatch ? nextMatch[1].trim() : "";
    const proceduresPart = nextMatch ? soapP.substring(0, nextMatch.index) : soapP;
    const procedures = proceduresPart.split(/[・、,\s]+/).map((s: string) => s.trim()).filter((s: string) => s && s !== "次回" && s.length > 1 && s.length < 20);
    const toothMatches = soapA.match(/#(\d{2})/g) || [];
    const toothNumbers = toothMatches.map((t: string) => t.replace("#", ""));
    setPreviousVisit({ date: prevApt.scheduled_at, soap_a: soapA, soap_p: soapP, procedures, nextPlan, toothNumbers });
    if (nextPlan) {
      const planItems = nextPlan.split(/[・、,\s]+/).map((s: string) => s.trim()).filter((s: string) => s && s.length > 1 && s.length < 20);
      setPlannedProcedures(planItems.map((name: string) => ({ name, checked: true })));
    }
  }

  // ===== 通院モード =====
  function applyQuickSOAP() {
    if (!record || !previousVisit) return;
    const checkedProcs = plannedProcedures.filter(p => p.checked).map(p => p.name);
    const procsText = checkedProcs.join("・");
    const teethText = previousVisit.toothNumbers.map(t => `#${t}`).join(" ");
    setRecord({ ...record, soap_s: "特に症状の変化なし", soap_o: `${teethText} 予定処置を実施 ${procsText}`, soap_a: previousVisit.soap_a || "", soap_p: `${procsText} 実施完了` });
    setQuickSoapApplied(true); setVisitCondition("as_planned");
    setSaveMsg("✅ SOAP自動入力しました"); setTimeout(() => setSaveMsg(""), 3000);
  }
  function applyChangeNote() {
    if (!record || !changeNote.trim()) return;
    setRecord({ ...record, soap_s: changeNote }); setVisitCondition("changed");
    setSaveMsg("✅ S欄に入力しました"); setTimeout(() => setSaveMsg(""), 3000);
  }
  function togglePlannedProcedure(index: number) { setPlannedProcedures(prev => prev.map((p, i) => i === index ? { ...p, checked: !p.checked } : p)); }

  // ===== タイマー =====
  function startTimer() { if (timerRunning) return; setTimerRunning(true); timerRef.current = setInterval(() => setElapsedSeconds(prev => prev + 1), 1000); }
  function formatTimer(s: number) { return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`; }
  function formatDateJP(dateStr: string) { if (!dateStr) return ""; return new Date(dateStr).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }); }

  // ===================================================================
  // ★★★ 新録音フロー: 録音 → 文字起こし → DB保存 → 画面表示 ★★★
  // ===================================================================

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      recordingStartRef.current = Date.now();
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        if (blob.size > 1000) {
          await transcribeAudio(blob);
        } else {
          showMsg("⚠️ 音声が短すぎます。もう少し長く録音してください。");
        }
      };
      mr.start();
      setIsRecording(true);
      startTimer();
      showMsg("🔴 録音中...");
    } catch {
      showMsg("⚠️ マイクへのアクセスが拒否されました。ブラウザ設定を確認してください。");
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  // Step 1: 音声 → Whisper → 文字起こしテキスト → DB保存
  async function transcribeAudio(blob: Blob) {
    setTranscribing(true);
    showMsg("📝 文字起こし中...");
    try {
      const fd = new FormData();
      fd.append("audio", blob, "recording.webm");
      fd.append("whisper_only", "true");
      const res = await fetch("/api/voice-analyze", { method: "POST", body: fd });
      const data = await res.json();

      if (data.success && data.transcript && data.transcript.trim().length >= 5) {
        const durationSec = Math.round((Date.now() - recordingStartRef.current) / 1000);
        const nextNum = transcripts.length + 1;

        // DB保存
        const { data: saved, error } = await supabase.from("consultation_transcripts").insert({
          appointment_id: appointmentId,
          patient_id: patient?.id,
          recording_number: nextNum,
          transcript_text: data.transcript,
          duration_seconds: durationSec,
        }).select().single();

        if (saved && !error) {
          setTranscripts(prev => [...prev, saved as TranscriptEntry]);
          showMsg(`✅ 録音${nextNum}の文字起こし完了（${formatTimer(durationSec)}）`);
        } else {
          console.error("DB保存エラー:", error);
          showMsg("⚠️ 文字起こしは成功しましたがDB保存に失敗しました");
        }
      } else if (data.error) {
        showMsg(`❌ ${data.error}`);
      } else {
        showMsg("⚠️ 音声を認識できませんでした。もう少しはっきり話してみてください。");
      }
    } catch (err) {
      console.error("文字起こしエラー:", err);
      showMsg("❌ 文字起こしに失敗しました。ネットワーク接続を確認してください。");
    }
    setTranscribing(false);
  }

  // 文字起こし編集
  function startEditTranscript(entry: TranscriptEntry) {
    setEditingTranscriptId(entry.id);
    setEditingText(entry.transcript_text);
  }
  async function saveEditTranscript() {
    if (!editingTranscriptId) return;
    await supabase.from("consultation_transcripts")
      .update({ transcript_text: editingText, is_edited: true })
      .eq("id", editingTranscriptId);
    setTranscripts(prev => prev.map(t => t.id === editingTranscriptId ? { ...t, transcript_text: editingText, is_edited: true } : t));
    setEditingTranscriptId(null);
    setEditingText("");
    showMsg("✅ 修正を保存しました");
  }
  async function deleteTranscript(id: string) {
    if (!confirm("この録音の文字起こしを削除しますか？")) return;
    await supabase.from("consultation_transcripts").delete().eq("id", id);
    setTranscripts(prev => prev.filter(t => t.id !== id));
    showMsg("🗑️ 削除しました");
  }

  // Step 2: 全文字起こし → GPT-4o → SOAP生成
  async function generateSOAPFromTranscripts() {
    if (transcripts.length === 0) { showMsg("⚠️ 文字起こしがありません。先に録音してください。"); return; }
    const fullText = transcripts.map(t => t.transcript_text).join("\n\n");
    setGeneratingSOAP(true);
    showMsg("🤖 SOAP生成中...");
    try {
      const fd = new FormData();
      fd.append("audio", new Blob(["dummy"], { type: "text/plain" }), "dummy.webm");
      fd.append("existing_soap_s", record?.soap_s || "");
      fd.append("full_transcript", fullText);
      const res = await fetch("/api/voice-analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        setAiResult({ soap: data.soap, tooth_updates: data.tooth_updates || {}, procedures: data.procedures || [], diagnoses: data.diagnoses || [] });
        setShowAiPreview(true);
        showMsg(data.warning ? `⚠️ ${data.warning}` : "✅ SOAP生成完了！内容を確認してください");
      } else {
        showMsg(`❌ ${data.error || "SOAP生成失敗"}`);
      }
    } catch {
      showMsg("❌ SOAP生成に失敗しました");
    }
    setGeneratingSOAP(false);
  }

  // AI結果をカルテに反映
  async function applyAiResult() {
    if (!record || !aiResult) return;
    const chart = { ...(record.tooth_chart || {}) };
    if (aiResult.tooth_updates) { Object.entries(aiResult.tooth_updates).forEach(([t, s]) => { const num = t.replace("#", ""); if (TOOTH_STATUS[s]) chart[num] = s; }); }
    setRecord({ ...record, soap_s: aiResult.soap.s || record.soap_s, soap_o: aiResult.soap.o || record.soap_o, soap_a: aiResult.soap.a || record.soap_a, soap_p: aiResult.soap.p || record.soap_p, tooth_chart: chart });
    if (aiResult.diagnoses && aiResult.diagnoses.length > 0 && record.patient_id) {
      try {
        for (const d of aiResult.diagnoses) {
          const { data: dup } = await supabase.from("patient_diagnoses").select("id").eq("patient_id", record.patient_id).eq("diagnosis_code", d.code || "").eq("tooth_number", d.tooth || "").eq("outcome", "continuing").limit(1);
          if (dup && dup.length > 0) continue;
          await supabase.from("patient_diagnoses").insert({ patient_id: record.patient_id, diagnosis_code: d.code || "", diagnosis_name: d.name || "", tooth_number: d.tooth || "", start_date: new Date().toISOString().split("T")[0], outcome: "continuing" });
        }
      } catch (e) { console.error("傷病名登録エラー:", e); }
    }
    setShowAiPreview(false);
    showMsg("✅ SOAPに反映しました");
  }

  function showMsg(msg: string) { setSaveMsg(msg); setTimeout(() => setSaveMsg(""), 5000); }

  // ===== SOAP・歯式・保存 =====
  function updateSOAP(field: "soap_s" | "soap_o" | "soap_a" | "soap_p", value: string) { if (record) setRecord({ ...record, [field]: value }); }
  function setToothState(num: string, status: string) { if (!record) return; const chart = { ...(record.tooth_chart || {}) }; if (status === "normal") delete chart[num]; else chart[num] = status; setRecord({ ...record, tooth_chart: chart }); }
  function onCheckTap(num: string) { if (!checkMode) return; setToothState(num, checkBrush); }

  async function saveRecord() {
    if (!record) return; setSaving(true);
    await supabase.from("medical_records").update({ soap_s: record.soap_s, soap_o: record.soap_o, soap_a: record.soap_a, soap_p: record.soap_p, tooth_chart: record.tooth_chart, status: "soap_complete" }).eq("id", record.id);
    showMsg("保存しました ✅"); setSaving(false);
  }

  async function completeSession() {
    if (!record || !appointmentId) return;
    if (!confirm("診察を完了してカルテを確定しますか？\n確定後、自動的に点数算定が行われます。")) return;
    setSaving(true);
    await supabase.from("medical_records").update({ soap_s: record.soap_s, soap_o: record.soap_o, soap_a: record.soap_a, soap_p: record.soap_p, tooth_chart: record.tooth_chart, status: "confirmed", doctor_confirmed: true }).eq("id", record.id);
    await supabase.from("appointments").update({ status: "completed" }).eq("id", appointmentId);
    await supabase.from("queue").update({ status: "done" }).eq("appointment_id", appointmentId);
    let billingResult = "";
    try {
      const res = await fetch("/api/auto-billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ record_id: record.id }) });
      const data = await res.json();
      if (data.success) { billingResult = `✅ 算定完了: ${data.total_points}点 / 患者負担¥${data.patient_burden}`; if (data.items) { setBillingItems(data.items); setBillingTotal(data.total_points); } }
      else { billingResult = `⚠️ 算定エラー: ${data.error || "不明"}`; }
    } catch (e) { billingResult = `⚠️ 算定API呼び出し失敗: ${e instanceof Error ? e.message : "不明"}`; }
    if (timerRef.current) clearInterval(timerRef.current);
    setSaving(false);
    alert(`カルテ確定しました。\n\n${billingResult}\n\n会計画面（/billing）で確認してください。`);
    router.push("/consultation");
  }

  function getAge(dob: string) { const b = new Date(dob), t = new Date(); let a = t.getFullYear() - b.getFullYear(); if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--; return a; }

  function renderTooth(num: string, isDeciduous = false) {
    const status = record?.tooth_chart?.[num] || "normal";
    const cfg = TOOTH_STATUS[status] || TOOTH_STATUS.normal;
    const editing = editingTooth === num && !checkMode;
    const size = isDeciduous ? "w-8 h-8 text-[9px]" : "w-9 h-9 text-[10px]";
    return (
      <div key={num} className="relative">
        <button onClick={() => { if (checkMode) { onCheckTap(num); } else { setEditingTooth(editing ? null : num); } }}
          className={`${size} rounded-lg font-bold border-2 transition-all ${cfg.bg} ${cfg.border} ${cfg.color} ${checkMode ? "hover:ring-2 hover:ring-sky-300 active:scale-95" : editing ? "ring-2 ring-sky-400 scale-110" : "hover:scale-105"}`}>
          {status === "normal" ? num : (isDeciduous ? (cfg.shortLabel || cfg.label) : cfg.label)}
        </button>
        {editing && !checkMode && (
          <div className="absolute z-30 top-full mt-1 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-xl border border-gray-200 p-2 min-w-[110px]">
            <p className="text-[10px] text-gray-400 text-center mb-1 font-bold">#{num}</p>
            {Object.entries(TOOTH_STATUS).map(([k, v]) => (
              <button key={k} onClick={() => { setToothState(num, k); setEditingTooth(null); }}
                className={`w-full text-left px-2 py-1 rounded-lg text-[11px] font-bold hover:bg-gray-50 ${status === k ? "bg-sky-50 text-sky-700" : "text-gray-700"}`}>{v.label}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  function removeBillingItem(index: number) { const n = billingItems.filter((_, i) => i !== index); setBillingItems(n); setBillingTotal(n.reduce((s, i) => s + i.points * i.count, 0)); }
  function updateBillingItemCount(index: number, count: number) { const n = [...billingItems]; n[index] = { ...n[index], count: Math.max(1, count) }; setBillingItems(n); setBillingTotal(n.reduce((s, i) => s + i.points * i.count, 0)); }

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;
  if (!patient || !record) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">予約情報が見つかりません</p></div>;

  const soapItems = [
    { key: "soap_s" as const, label: "S", title: "主観", color: "bg-red-500", borderColor: "border-red-200", placeholder: "患者さんの訴え・主訴" },
    { key: "soap_o" as const, label: "O", title: "客観", color: "bg-blue-500", borderColor: "border-blue-200", placeholder: "検査所見・口腔内所見" },
    { key: "soap_a" as const, label: "A", title: "評価", color: "bg-yellow-500", borderColor: "border-yellow-200", placeholder: "診断名・評価" },
    { key: "soap_p" as const, label: "P", title: "計画", color: "bg-green-500", borderColor: "border-green-200", placeholder: "治療計画・処置内容・次回予定" },
  ];
  const chartStats = (() => { const c = record.tooth_chart || {}; const counts: Record<string, number> = {}; Object.values(c).forEach(s => { counts[s] = (counts[s] || 0) + 1; }); return counts; })();
  const totalTranscriptText = transcripts.map(t => t.transcript_text).join("\n");

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20">
        <div className="max-w-full mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/consultation" className="text-gray-400 hover:text-gray-600 text-sm font-bold">← 戻る</Link>
            <div className="flex items-center gap-3">
              <div className="bg-sky-100 text-sky-700 w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold">{patient.name_kanji.charAt(0)}</div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-gray-900">{patient.name_kanji}</h1>
                  <span className="text-xs text-gray-400">({patient.name_kana})</span>
                  {isReturning
                    ? <span className="bg-green-100 text-green-700 text-[10px] px-2 py-0.5 rounded font-bold">再診</span>
                    : <span className="bg-red-100 text-red-600 text-[10px] px-2 py-0.5 rounded font-bold">初診</span>}
                </div>
                <p className="text-xs text-gray-400">{getAge(patient.date_of_birth)}歳 / {patient.insurance_type} {patient.burden_ratio * 10}割</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saveMsg && <span className="text-sm font-bold text-green-600 bg-green-50 px-3 py-1 rounded-full">{saveMsg}</span>}
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-lg font-bold ${isRecording ? "bg-red-50 text-red-600 border border-red-200" : "bg-gray-100 text-gray-600"}`}>
              {isRecording && <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />}
              {formatTimer(elapsedSeconds)}
            </div>
            {transcribing ? (
              <div className="bg-amber-100 text-amber-700 px-5 py-2.5 rounded-full text-sm font-bold flex items-center gap-2"><span className="animate-spin">⚙️</span> 文字起こし中...</div>
            ) : isRecording ? (
              <button onClick={stopRecording} className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-full text-sm font-bold flex items-center gap-2 shadow-lg shadow-red-200 animate-pulse">⏹️ 録音停止</button>
            ) : (
              <button onClick={startRecording} className="bg-sky-600 hover:bg-sky-700 text-white px-5 py-2.5 rounded-full text-sm font-bold flex items-center gap-2 shadow-lg shadow-sky-200">🎙️ 録音開始</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-4">
        <div className="flex gap-4">
          <div className="flex-1 space-y-3">

            {/* ★ 予定処置パネル */}
            {isReturning && hasPreviousPlan && !quickSoapApplied && visitCondition === "" && (
              <div className="bg-white rounded-xl border-2 border-purple-200 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-lg">📋</span>
                  <h3 className="text-sm font-bold text-gray-900">今日の予定処置</h3>
                  <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold">前回 {formatDateJP(previousVisit!.date)} のP欄より</span>
                </div>
                {previousVisit!.soap_a && (<div className="bg-gray-50 rounded-lg px-3 py-2 mb-3"><p className="text-[10px] text-gray-400 font-bold mb-0.5">前回の診断</p><p className="text-sm text-gray-700">{previousVisit!.soap_a}</p></div>)}
                <div className="space-y-1.5 mb-4">
                  {plannedProcedures.map((proc, idx) => (
                    <button key={idx} onClick={() => togglePlannedProcedure(idx)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 transition-all text-left ${proc.checked ? "border-purple-300 bg-purple-50" : "border-gray-200 bg-white"}`}>
                      <span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold border-2 flex-shrink-0 ${proc.checked ? "bg-purple-500 border-purple-500 text-white" : "border-gray-300 text-transparent"}`}>✓</span>
                      <span className={`text-sm font-bold ${proc.checked ? "text-gray-800" : "text-gray-400 line-through"}`}>{proc.name}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button onClick={applyQuickSOAP} disabled={plannedProcedures.filter(p => p.checked).length === 0} className="flex-1 bg-green-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200">✅ 予定通り完了</button>
                  <button onClick={() => setVisitCondition("changed")} className="flex-1 bg-orange-50 text-orange-700 border-2 border-orange-200 py-3 rounded-xl text-sm font-bold hover:bg-orange-100">⚠️ 変化あり</button>
                </div>
              </div>
            )}

            {/* 変化あり入力パネル */}
            {isReturning && visitCondition === "changed" && !quickSoapApplied && (
              <div className="bg-white rounded-xl border-2 border-orange-200 p-4">
                <div className="flex items-center gap-2 mb-3"><span className="text-lg">⚠️</span><h3 className="text-sm font-bold text-gray-900">変化の内容を入力</h3></div>
                <textarea value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="例: 前回治療した歯が痛む / 別の歯が欠けた" rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 resize-none mb-3" />
                <div className="flex gap-2">
                  <button onClick={applyChangeNote} disabled={!changeNote.trim()} className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-50">S欄に反映</button>
                  <button onClick={() => { setVisitCondition(""); setChangeNote(""); }} className="px-4 bg-gray-100 text-gray-500 py-2.5 rounded-xl text-sm font-bold hover:bg-gray-200">戻る</button>
                </div>
              </div>
            )}

            {quickSoapApplied && (
              <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2"><span className="text-lg">✅</span><p className="text-sm font-bold text-green-800">予定処置のSOAPを自動入力しました</p></div>
                <button onClick={() => { setQuickSoapApplied(false); setVisitCondition(""); }} className="text-xs text-green-600 hover:text-green-800 font-bold px-2 py-1 rounded hover:bg-green-100">やり直す</button>
              </div>
            )}

            {/* ★★★ 文字起こしパネル（新） ★★★ */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
                <div className="flex items-center gap-2">
                  <span className="text-lg">📝</span>
                  <h3 className="text-sm font-bold text-gray-800">音声文字起こし</h3>
                  {transcripts.length > 0 && <span className="text-[10px] font-bold bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">{transcripts.length}件の録音</span>}
                </div>
                <div className="flex items-center gap-2">
                  {transcripts.length > 0 && (
                    <button onClick={generateSOAPFromTranscripts} disabled={generatingSOAP}
                      className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50 shadow-md shadow-purple-200 flex items-center gap-1.5 transition-colors">
                      {generatingSOAP ? <><span className="animate-spin">⚙️</span> 生成中...</> : <>🤖 SOAP生成</>}
                    </button>
                  )}
                </div>
              </div>

              {transcripts.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <p className="text-3xl mb-2">🎙️</p>
                  <p className="text-sm text-gray-400 font-bold">右上の「録音開始」で診察内容を記録</p>
                  <p className="text-xs text-gray-300 mt-1">録音を停止すると自動で文字起こしされます</p>
                  <p className="text-xs text-gray-300">複数回の録音も蓄積できます</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
                  {transcripts.map((entry) => (
                    <div key={entry.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">録音{entry.recording_number}</span>
                          {entry.duration_seconds && <span className="text-[10px] text-gray-400">{formatTimer(entry.duration_seconds)}</span>}
                          {entry.is_edited && <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded font-bold">修正済</span>}
                        </div>
                        <div className="flex items-center gap-1">
                          {editingTranscriptId === entry.id ? (
                            <>
                              <button onClick={saveEditTranscript} className="text-[10px] text-green-600 hover:text-green-800 font-bold px-2 py-1 rounded hover:bg-green-50">✅ 保存</button>
                              <button onClick={() => setEditingTranscriptId(null)} className="text-[10px] text-gray-400 hover:text-gray-600 font-bold px-2 py-1 rounded hover:bg-gray-100">取消</button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEditTranscript(entry)} className="text-[10px] text-gray-400 hover:text-sky-600 font-bold px-2 py-1 rounded hover:bg-sky-50">✏️ 修正</button>
                              <button onClick={() => deleteTranscript(entry.id)} className="text-[10px] text-gray-300 hover:text-red-500 font-bold px-1 py-1 rounded hover:bg-red-50">✕</button>
                            </>
                          )}
                        </div>
                      </div>
                      {editingTranscriptId === entry.id ? (
                        <textarea value={editingText} onChange={(e) => setEditingText(e.target.value)} rows={4}
                          className="w-full border-2 border-sky-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-sky-400 resize-none" />
                      ) : (
                        <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{entry.transcript_text}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* SOAP 4分割 */}
            <div className="grid grid-cols-2 gap-3">
              {soapItems.map((item) => (
                <div key={item.key} className={`bg-white rounded-xl border ${item.borderColor} overflow-hidden`}>
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
                    <span className={`w-6 h-6 rounded-md text-[11px] font-bold flex items-center justify-center text-white ${item.color}`}>{item.label}</span>
                    <span className="text-sm font-bold text-gray-700">{item.title}</span>
                    {record[item.key] && <span className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}
                  </div>
                  <textarea value={record[item.key] || ""} onChange={(e) => updateSOAP(item.key, e.target.value)} placeholder={item.placeholder} rows={5}
                    className="w-full px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none resize-none leading-relaxed" />
                </div>
              ))}
            </div>

            {/* 歯式チャート */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-bold text-gray-700">🦷 歯式チャート</h3>
                  <div className="flex bg-gray-100 rounded-lg p-0.5">
                    <button onClick={() => setDentitionMode("permanent")} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${dentitionMode === "permanent" ? "bg-white text-gray-800 shadow-sm" : "text-gray-400"}`}>永久歯</button>
                    <button onClick={() => setDentitionMode("mixed")} className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${dentitionMode === "mixed" ? "bg-white text-gray-800 shadow-sm" : "text-gray-400"}`}>混合歯列</button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {Object.keys(chartStats).length > 0 && <div className="flex gap-1 mr-2">{Object.entries(chartStats).map(([s, c]) => (<span key={s} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${TOOTH_STATUS[s]?.bg} ${TOOTH_STATUS[s]?.color} ${TOOTH_STATUS[s]?.border} border`}>{TOOTH_STATUS[s]?.label} {c}</span>))}</div>}
                  <button onClick={() => { setCheckMode(!checkMode); setEditingTooth(null); }}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${checkMode ? "bg-orange-500 text-white shadow-md shadow-orange-200" : "bg-orange-50 text-orange-600 border border-orange-200 hover:bg-orange-100"}`}>{checkMode ? "✓ チェック中" : "📋 初診チェック"}</button>
                </div>
              </div>
              {checkMode && (
                <div className="mb-3 p-2.5 bg-orange-50 rounded-xl border border-orange-200">
                  <p className="text-[10px] text-orange-600 font-bold mb-2">状態を選んで歯をタップ → 一括記録</p>
                  <div className="flex gap-1.5 flex-wrap">{CHECK_STATUSES.map((s) => { const cfg = TOOTH_STATUS[s]; return (<button key={s} onClick={() => setCheckBrush(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition-all ${checkBrush === s ? `${cfg.bg} ${cfg.border} ${cfg.color} ring-2 ring-offset-1 ring-sky-400 scale-105` : "bg-white border-gray-200 text-gray-500"}`}>{cfg.label}</button>); })}</div>
                </div>
              )}
              <div className="flex justify-center">
                <div className="flex flex-col items-center gap-1">
                  <div className="flex items-center gap-0.5">
                    <span className="text-[9px] text-gray-300 w-6 text-right mr-1">右</span>
                    <div className="flex gap-1">{UPPER_RIGHT.map(t => renderTooth(t))}</div>
                    <div className="w-px h-10 bg-gray-300 mx-2" />
                    <div className="flex gap-1">{UPPER_LEFT.map(t => renderTooth(t))}</div>
                    <span className="text-[9px] text-gray-300 w-6 ml-1">左</span>
                  </div>
                  {dentitionMode === "mixed" && (<div className="flex items-center gap-0.5 mt-0.5"><span className="text-[9px] text-gray-300 w-6 text-right mr-1" /><div className="flex gap-1" style={{ marginLeft: "108px" }}>{DECID_UPPER_RIGHT.map(t => renderTooth(t, true))}</div><div className="w-px h-8 bg-gray-200 mx-2" /><div className="flex gap-1" style={{ marginRight: "108px" }}>{DECID_UPPER_LEFT.map(t => renderTooth(t, true))}</div><span className="text-[9px] text-gray-300 w-6 ml-1" /></div>)}
                  <div className="flex items-center gap-1 my-1" style={{ width: "100%" }}><span className="text-[9px] text-gray-300 w-6 text-right mr-1" /><div className="flex-1 border-t-2 border-gray-400" /><span className="text-[9px] text-gray-300 w-6 ml-1" /></div>
                  {dentitionMode === "mixed" && (<div className="flex items-center gap-0.5 mb-0.5"><span className="text-[9px] text-gray-300 w-6 text-right mr-1" /><div className="flex gap-1" style={{ marginLeft: "108px" }}>{DECID_LOWER_RIGHT.map(t => renderTooth(t, true))}</div><div className="w-px h-8 bg-gray-200 mx-2" /><div className="flex gap-1" style={{ marginRight: "108px" }}>{DECID_LOWER_LEFT.map(t => renderTooth(t, true))}</div><span className="text-[9px] text-gray-300 w-6 ml-1" /></div>)}
                  <div className="flex items-center gap-0.5">
                    <span className="text-[9px] text-gray-300 w-6 text-right mr-1">右</span>
                    <div className="flex gap-1">{LOWER_RIGHT.map(t => renderTooth(t))}</div>
                    <div className="w-px h-10 bg-gray-300 mx-2" />
                    <div className="flex gap-1">{LOWER_LEFT.map(t => renderTooth(t))}</div>
                    <span className="text-[9px] text-gray-300 w-6 ml-1">左</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">{Object.entries(TOOTH_STATUS).map(([k, v]) => (<span key={k} className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${v.border} ${v.bg} ${v.color}`}>{v.label}</span>))}</div>
            </div>

            {/* 治療項目一覧 */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700">💊 治療項目・算定内容</h3>
                <div className="flex items-center gap-2">
                  {billingTotal > 0 && <span className="text-sm font-bold text-sky-600 bg-sky-50 px-3 py-1 rounded-full">合計 {billingTotal.toLocaleString()}点</span>}
                  {billingItems.length > 0 && <button onClick={() => setShowBillingEdit(!showBillingEdit)} className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${showBillingEdit ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{showBillingEdit ? "✓ 編集中" : "✏️ 編集"}</button>}
                </div>
              </div>
              {billingItems.length === 0 ? (
                <div className="text-center py-6"><p className="text-xs text-gray-400">診察完了後に自動算定されます</p></div>
              ) : (
                <div className="space-y-1">
                  <div className="flex items-center px-2 py-1 text-[10px] text-gray-400 font-bold border-b border-gray-100">
                    <span className="w-24">コード</span><span className="flex-1">項目名</span><span className="w-16 text-right">点数</span><span className="w-12 text-center">回数</span><span className="w-16 text-right">小計</span>{showBillingEdit && <span className="w-8" />}
                  </div>
                  {billingItems.map((item, idx) => (
                    <div key={idx} className="flex items-center px-2 py-1.5 rounded-lg hover:bg-gray-50 text-xs">
                      <span className="w-24 text-gray-400 font-mono text-[10px]">{item.code}</span>
                      <span className="flex-1 text-gray-700 font-bold">{item.name}{item.tooth && <span className="text-[10px] text-gray-400 ml-1">({item.tooth})</span>}</span>
                      <span className="w-16 text-right text-gray-600">{item.points}</span>
                      {showBillingEdit ? <span className="w-12 text-center"><input type="number" min={1} value={item.count} onChange={(e) => updateBillingItemCount(idx, parseInt(e.target.value) || 1)} className="w-10 text-center border border-gray-200 rounded text-xs py-0.5" /></span>
                        : <span className="w-12 text-center text-gray-500">×{item.count}</span>}
                      <span className="w-16 text-right font-bold text-gray-800">{(item.points * item.count).toLocaleString()}</span>
                      {showBillingEdit && <button onClick={() => removeBillingItem(idx)} className="w-8 text-center text-red-400 hover:text-red-600 text-sm">✕</button>}
                    </div>
                  ))}
                  <div className="flex items-center px-2 py-2 border-t-2 border-gray-300 mt-1">
                    <span className="flex-1 text-sm font-bold text-gray-800">合計</span>
                    <span className="text-sm font-bold text-sky-600">{billingTotal.toLocaleString()}点</span>
                    <span className="text-xs text-gray-400 ml-2">(患者負担 ¥{Math.round(billingTotal * 10 * (patient.burden_ratio)).toLocaleString()})</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 右サイドバー */}
          <div className="w-[220px] flex-shrink-0 space-y-3">
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <h3 className="text-xs font-bold text-gray-400 mb-2">患者情報</h3>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-400">生年月日</span><span className="text-gray-700 font-bold">{patient.date_of_birth}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">電話</span><span className="text-gray-700 font-bold">{patient.phone}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">保険</span><span className="text-gray-700 font-bold">{patient.insurance_type} {patient.burden_ratio * 10}割</span></div>
              </div>
            </div>
            {isReturning && previousVisit && (
              <div className="bg-purple-50 rounded-xl border border-purple-200 p-3">
                <h3 className="text-xs font-bold text-purple-700 mb-2">📋 前回の情報</h3>
                <div className="space-y-1.5 text-xs">
                  <div><span className="text-purple-400">前回</span><p className="text-purple-800 font-bold">{formatDateJP(previousVisit.date)}</p></div>
                  {previousVisit.soap_a && <div><span className="text-purple-400">診断</span><p className="text-purple-800 font-bold">{previousVisit.soap_a}</p></div>}
                  {previousVisit.nextPlan && <div><span className="text-purple-400">次回予定</span><p className="text-purple-800 font-bold">{previousVisit.nextPlan}</p></div>}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <button onClick={saveRecord} disabled={saving} className="w-full bg-white border-2 border-sky-500 text-sky-600 py-3 rounded-xl text-sm font-bold hover:bg-sky-50 disabled:opacity-50 transition-colors">💾 一時保存</button>
              <button onClick={completeSession} disabled={saving} className="w-full bg-green-600 text-white py-3.5 rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200 transition-colors">✅ 診察完了（カルテ確定）</button>
            </div>
          </div>
        </div>
      </main>

      {/* AI結果プレビューモーダル */}
      {showAiPreview && aiResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="text-center mb-5"><span className="text-4xl">🤖</span><h3 className="text-xl font-bold text-gray-900 mt-2">SOAP生成結果</h3><p className="text-sm text-gray-400 mt-1">内容を確認してください</p></div>
            <div className="space-y-3 mb-6">
              {[
                { label: "S 主観（患者の訴え）", value: aiResult.soap.s, color: "border-red-400", bg: "bg-red-50" },
                { label: "O 客観（検査所見）", value: aiResult.soap.o, color: "border-blue-400", bg: "bg-blue-50" },
                { label: "A 評価（診断名）", value: aiResult.soap.a, color: "border-yellow-400", bg: "bg-yellow-50" },
                { label: "P 計画（処置・次回予定）", value: aiResult.soap.p, color: "border-green-400", bg: "bg-green-50" },
              ].map((item) => (
                <div key={item.label} className={`border-l-4 ${item.color} ${item.bg} rounded-r-xl p-3`}>
                  <p className="text-xs text-gray-500 font-bold mb-1">{item.label}</p>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap">{item.value || "（該当なし）"}</p>
                </div>
              ))}
              {aiResult.tooth_updates && Object.keys(aiResult.tooth_updates).length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <p className="text-xs text-gray-500 font-bold mb-1">🦷 歯式更新</p>
                  <div className="flex flex-wrap gap-2">{Object.entries(aiResult.tooth_updates).map(([tooth, status]) => (<span key={tooth} className="bg-white border border-gray-200 px-2.5 py-1 rounded-lg text-xs font-bold text-gray-700">#{tooth.replace("#", "")}: {TOOTH_STATUS[status]?.label || status}</span>))}</div>
                </div>
              )}
              {aiResult.procedures.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <p className="text-xs text-gray-500 font-bold mb-1">🔧 本日の処置</p>
                  <div className="flex flex-wrap gap-2">{aiResult.procedures.map((p, i) => (<span key={i} className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">{p}</span>))}</div>
                </div>
              )}
              {aiResult.diagnoses && aiResult.diagnoses.length > 0 && (
                <div className="bg-purple-50 rounded-xl p-3 border border-purple-200">
                  <p className="text-xs text-purple-600 font-bold mb-1">🏷️ 傷病名（自動登録されます）</p>
                  <div className="flex flex-wrap gap-2">{aiResult.diagnoses.map((d, i) => (<span key={i} className="bg-white border border-purple-200 px-3 py-1 rounded-full text-sm font-bold text-purple-700">{d.name}{d.tooth ? ` ${d.tooth}` : ""}</span>))}</div>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={applyAiResult} className="flex-1 bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 shadow-lg shadow-green-200 active:scale-[0.98]">✅ OKです！反映する</button>
              <button onClick={() => { setShowAiPreview(false); showMsg("手動で修正してください"); }} className="flex-1 bg-gray-100 text-gray-700 py-4 rounded-xl font-bold hover:bg-gray-200">✏️ 修正が必要</button>
            </div>
          </div>
        </div>
      )}

      {editingTooth && !checkMode && <div className="fixed inset-0 z-10" onClick={() => setEditingTooth(null)} />}
    </div>
  );
}

export default function ConsultationSessionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>}>
      <SessionContent />
    </Suspense>
  );
}
