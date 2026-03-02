"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// SpeechRecognition型宣言
interface SpeechRecognitionEvent {
  resultIndex: number;
  results: { isFinal: boolean; [index: number]: { transcript: string } }[];
}
interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type Patient = {
  id: string; name_kanji: string; name_kana: string;
  date_of_birth: string; phone: string; insurance_type: string; burden_ratio: number;
  allergies?: string[] | null;
};
type MedicalRecord = {
  id: string; appointment_id: string; patient_id: string; status: string;
  soap_s: string | null; soap_o: string | null; soap_a: string | null; soap_p: string | null;
  tooth_chart: Record<string, string | string[]> | null;
};

// 歯式ヘルパー: string | string[] どちらでも配列で返す
function getToothStatuses(chart: Record<string, string | string[]> | null, tooth: string): string[] {
  if (!chart || !chart[tooth]) return ["normal"];
  const v = chart[tooth];
  if (Array.isArray(v)) return v.length > 0 ? v : ["normal"];
  return [v];
}
// 歯に特定ステータスがあるか
function hasStatus(chart: Record<string, string | string[]> | null, tooth: string, status: string): boolean {
  return getToothStatuses(chart, tooth).includes(status);
}
// 歯のプライマリステータス（表示色に使う最も優先度の高いもの）
function primaryStatus(chart: Record<string, string | string[]> | null, tooth: string): string {
  const statuses = getToothStatuses(chart, tooth);
  const priority = ["c4","c3","c2","c1","c0","in_treatment","missing","root_remain","br_pontic","br_abutment","implant","crown","inlay","cr","watch","normal"];
  for (const p of priority) { if (statuses.includes(p)) return p; }
  return statuses[0] || "normal";
}
// 歯にステータスをトグル
function toggleToothStatus(chart: Record<string, string | string[]>, tooth: string, status: string): Record<string, string | string[]> {
  const current = getToothStatuses(chart, tooth);
  const newChart = { ...chart };
  if (status === "normal") {
    newChart[tooth] = ["normal"];
    return newChart;
  }
  // normalを除外
  let updated = current.filter(s => s !== "normal");
  if (updated.includes(status)) {
    updated = updated.filter(s => s !== status);
  } else {
    updated.push(status);
  }
  if (updated.length === 0) updated = ["normal"];
  newChart[tooth] = updated;
  return newChart;
}
type BillingItem = { code: string; name: string; points: number; count: number; tooth?: string };
type TranscriptEntry = { id: string; recording_number: number; transcript_text: string; duration_seconds: number | null; is_edited: boolean; created_at: string };
type PreviousVisit = { date: string; soap_a: string; soap_p: string; procedures: string[]; nextPlan: string; toothNumbers: string[] };
type PlannedProcedure = { name: string; checked: boolean };

// P検データ型
type PerioData = {
  buccal: [number, number, number]; // MB, B, DB
  lingual: [number, number, number]; // ML, L, DL
  bop: boolean;
  mobility: number; // 0-3
  furcation?: number; // 0-3 (B13)
};

const UPPER_RIGHT = ["18","17","16","15","14","13","12","11"];
const UPPER_LEFT = ["21","22","23","24","25","26","27","28"];
const LOWER_RIGHT = ["48","47","46","45","44","43","42","41"];
const LOWER_LEFT = ["31","32","33","34","35","36","37","38"];
const DECID_UPPER_RIGHT = ["55","54","53","52","51"];
const DECID_UPPER_LEFT = ["61","62","63","64","65"];
const DECID_LOWER_RIGHT = ["85","84","83","82","81"];
const DECID_LOWER_LEFT = ["71","72","73","74","75"];
const ALL_TEETH = [...UPPER_RIGHT,...UPPER_LEFT,...LOWER_RIGHT,...LOWER_LEFT];

const TOOTH_STATUS: Record<string, { label: string; color: string; bg: string; border: string; shortLabel?: string }> = {
  normal:       { label: "健全",   color: "text-gray-500",   bg: "bg-white",      border: "border-gray-200",  shortLabel: "○" },
  c0:           { label: "C0",     color: "text-red-400",    bg: "bg-red-50",     border: "border-red-200",   shortLabel: "C0" },
  c1:           { label: "C1",     color: "text-red-500",    bg: "bg-red-50",     border: "border-red-300",   shortLabel: "C1" },
  c2:           { label: "C2",     color: "text-red-600",    bg: "bg-red-100",    border: "border-red-400",   shortLabel: "C2" },
  c3:           { label: "C3",     color: "text-red-700",    bg: "bg-red-200",    border: "border-red-500",   shortLabel: "C3" },
  c4:           { label: "C4",     color: "text-red-800",    bg: "bg-red-300",    border: "border-red-600",   shortLabel: "C4" },
  in_treatment: { label: "治療中", color: "text-orange-700", bg: "bg-orange-50",  border: "border-orange-300",shortLabel: "🔧" },
  cr:           { label: "CR",     color: "text-blue-700",   bg: "bg-blue-50",    border: "border-blue-300",  shortLabel: "CR" },
  inlay:        { label: "In",     color: "text-cyan-700",   bg: "bg-cyan-50",    border: "border-cyan-300",  shortLabel: "In" },
  crown:        { label: "Cr",     color: "text-yellow-700", bg: "bg-yellow-50",  border: "border-yellow-300",shortLabel: "Cr" },
  missing:      { label: "欠損",   color: "text-gray-400",   bg: "bg-gray-100",   border: "border-gray-300",  shortLabel: "/" },
  implant:      { label: "IP",     color: "text-purple-700", bg: "bg-purple-50",  border: "border-purple-300",shortLabel: "IP" },
  br_abutment:  { label: "Br支台", color: "text-orange-700", bg: "bg-orange-50",  border: "border-orange-300",shortLabel: "Br" },
  br_pontic:    { label: "Brポン", color: "text-orange-500", bg: "bg-orange-100", border: "border-orange-400",shortLabel: "Br欠" },
  root_remain:  { label: "残根",   color: "text-pink-700",   bg: "bg-pink-50",    border: "border-pink-300",  shortLabel: "残" },
  watch:        { label: "要注意", color: "text-amber-700",  bg: "bg-amber-50",   border: "border-amber-300", shortLabel: "△" },
};
const CHECK_STATUSES = ["normal","c0","c1","c2","c3","c4","in_treatment","cr","inlay","crown","missing","implant","br_abutment","br_pontic","root_remain","watch"] as const;

type SessionTab = "chief" | "tooth" | "perio" | "dh_record" | "dr_exam" | "confirm";
type DentitionMode = "permanent" | "mixed";

const STEP_LABELS: { key: SessionTab; icon: string; label: string; who: string }[] = [
  { key: "chief", icon: "💬", label: "主訴確認", who: "DH" },
  { key: "tooth", icon: "🦷", label: "歯式記録", who: "DH" },
  { key: "perio", icon: "📊", label: "P検・BOP", who: "DH" },
  { key: "dh_record", icon: "📝", label: "DH記録", who: "DH" },
  { key: "dr_exam", icon: "🩺", label: "Dr診察", who: "Dr" },
  { key: "confirm", icon: "✅", label: "確定", who: "Dr" },
];

function SessionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const appointmentId = searchParams.get("appointment_id");
  const flowParam = searchParams.get("flow") as "continue" | "new_chief" | "maintenance" | null;

  // Core state
  const [patient, setPatient] = useState<Patient | null>(null);
  const [record, setRecord] = useState<MedicalRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // Timer & Recording
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);
  const recordingStartRef = useRef<number>(0);
  const [isRecording, setIsRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Transcripts & SOAP
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [generatingSOAP, setGeneratingSOAP] = useState(false);
  const [aiResult, setAiResult] = useState<{ soap: { s: string; o: string; a: string; p: string }; tooth_updates: Record<string, string>; procedures: string[]; diagnoses: { name: string; tooth: string; code: string }[]; soap_s_undetected?: boolean } | null>(null);
  const [showAiPreview, setShowAiPreview] = useState(false);

  // Tooth chart
  const [editingTooth, setEditingTooth] = useState<string | null>(null);
  const [dentitionMode, setDentitionMode] = useState<DentitionMode>("permanent");
  const [checkMode, setCheckMode] = useState(false);
  const [checkBrush, setCheckBrush] = useState<string>("normal");
  // ★ ベースラインチェック
  const [baselineMode, setBaselineMode] = useState(false);
  const [baselineIndex, setBaselineIndex] = useState(0);

  // 歯面管理（5面: M=近心, D=遠心, B=頬側, L=舌側, O=咬合面）
  const [toothSurfaces, setToothSurfaces] = useState<Record<string, string[]>>({});

  // 口腔内写真5枚法
  const [intraoralPhotos, setIntraoralPhotos] = useState<Record<string, { url: string; id: string }>>({});

  // P検データ
  const [perioData, setPerioData] = useState<Record<string, PerioData>>({});
  const [perioEditTooth, setPerioEditTooth] = useState<string | null>(null);

  // P検音声入力
  const [perioVoiceMode, setPerioVoiceMode] = useState(false);
  const [perioProbePoints, setPerioProbePoints] = useState(6);
  const [perioOrderType, setPerioOrderType] = useState<string>("U");
  // U=コの字, Z=Z型, S=S型, TB=頬→舌(1歯ずつ)
  const [perioCurrentIdx, setPerioCurrentIdx] = useState(0);
  const [perioSide, setPerioSide] = useState<"buccal" | "lingual">("buccal");
  const [perioListening, setPerioListening] = useState(false);
  const [perioRecogRef] = useState<{ current: unknown }>({ current: null });
  const [perioInputBuffer, setPerioInputBuffer] = useState<number[]>([]);

  // Step4/5専用録音
  const [stepRecording, setStepRecording] = useState(false);
  const [stepRecorder, setStepRecorder] = useState<MediaRecorder | null>(null);
  const [stepChunks, setStepChunks] = useState<Blob[]>([]);
  const [stepTranscript, setStepTranscript] = useState("");
  const [stepAnalyzing, setStepAnalyzing] = useState(false);

  // 治療計画書
  const [treatmentPlan, setTreatmentPlan] = useState<{
    summary?: string;
    diagnosis_summary?: string;
    procedures?: { name: string; tooth?: string; priority?: number; estimated_visits?: number; description?: string }[];
    estimated_total_visits?: number;
    estimated_duration_months?: number;
    goals?: string;
    patient_instructions?: string;
    notes?: string;
  } | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);

  // Billing
  const [billingItems, setBillingItems] = useState<BillingItem[]>([]);
  const [billingTotal, setBillingTotal] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewDone, setPreviewDone] = useState(false);
  const [previewWarnings, setPreviewWarnings] = useState<string[]>([]);
  const [matchedProcedures, setMatchedProcedures] = useState<string[]>([]);
  const [showBillingEdit, setShowBillingEdit] = useState(false);

  // 通院モード
  const [patientType, setPatientType] = useState<string>("new");
  const [previousVisit, setPreviousVisit] = useState<PreviousVisit | null>(null);
  const [plannedProcedures, setPlannedProcedures] = useState<PlannedProcedure[]>([]);
  const [visitCondition, setVisitCondition] = useState<"as_planned" | "changed" | "">("");
  const [changeNote, setChangeNote] = useState("");
  const [quickSoapApplied, setQuickSoapApplied] = useState(false);

  // ★ タブ — flowに応じて初期タブを変える
  const initialTab: SessionTab = flowParam === "continue" ? "dr_exam" : flowParam === "maintenance" ? "perio" : "chief";
  const [activeTab, setActiveTab] = useState<SessionTab>(initialTab);

  const isReturning = patientType === "returning";
  const hasPreviousPlan = previousVisit && previousVisit.nextPlan;

  useEffect(() => { if (appointmentId) loadSession(); }, [appointmentId]);
  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); }; }, []);

  // ===== データ読み込み（既存ロジックそのまま） =====
  async function loadSession() {
    setLoading(true);
    let aptData: Record<string, unknown> | null = null;
    const { data: apt1, error: err1 } = await supabase.from("appointments").select(`id, patient_id, patient_type, patients ( id, name_kanji, name_kana, date_of_birth, phone, insurance_type, burden_ratio, allergies )`).eq("id", appointmentId).single();
    if (apt1 && !err1) aptData = apt1 as Record<string, unknown>;
    else { const { data: apt2 } = await supabase.from("appointments").select(`id, patient_id, patients ( id, name_kanji, name_kana, date_of_birth, phone, insurance_type, burden_ratio, allergies )`).eq("id", appointmentId).single(); if (apt2) aptData = apt2 as Record<string, unknown>; }
    if (aptData) {
      const p = aptData.patients as unknown as Patient; setPatient(p);
      setPatientType(String(aptData.patient_type || "new"));
      const { data: rec } = await supabase.from("medical_records").select("*").eq("appointment_id", appointmentId).limit(1).single();
      if (rec) { setRecord(rec as unknown as MedicalRecord);
        // 歯面データの読み込み
        const recAny = rec as Record<string, unknown>;
        if (recAny.tooth_surfaces && typeof recAny.tooth_surfaces === "object") {
          setToothSurfaces(recAny.tooth_surfaces as Record<string, string[]>);
        }
        const { data: billing } = await supabase.from("billing").select("procedures_detail, total_points").eq("record_id", (rec as Record<string, unknown>).id).limit(1).single();
        if (billing) { setBillingItems((billing.procedures_detail || []) as BillingItem[]); setBillingTotal(billing.total_points || 0); }
      }
      await loadTranscripts();
      // 口腔内写真の読み込み
      if (rec) {
        const { data: photos } = await supabase.from("patient_images").select("id, image_type, image_url").eq("record_id", (rec as Record<string, unknown>).id).in("image_type", ["intraoral_front", "intraoral_upper", "intraoral_lower", "intraoral_left", "intraoral_right"]);
        if (photos) {
          const photoMap: Record<string, { url: string; id: string }> = {};
          for (const p of photos) { photoMap[p.image_type] = { url: p.image_url, id: p.id }; }
          setIntraoralPhotos(photoMap);
        }
      }
      if (String(aptData.patient_type || "") === "returning") {
        await loadPreviousVisit(p.id);
        // ★ 再診時: 前回の歯式を読み込む
        const { data: ptData } = await supabase.from("patients").select("current_tooth_chart").eq("id", p.id).single();
        if (ptData?.current_tooth_chart && rec) {
          const prevChart: Record<string, string> = {};
          Object.entries(ptData.current_tooth_chart as Record<string, unknown>).forEach(([k, v]) => {
            if (typeof v === "string") prevChart[k] = v;
            else if (typeof v === "object" && v && "status" in (v as Record<string, string>)) prevChart[k] = (v as Record<string, string>).status;
          });
          if (!rec.tooth_chart || Object.keys(rec.tooth_chart as object).length === 0) {
            setRecord({ ...(rec as unknown as MedicalRecord), tooth_chart: prevChart });
          }
        }
      }
      // ★ フローモードに応じてS欄自動入力
      if (flowParam === "continue" && rec) {
        const { data: prevAptForS } = await supabase.from("appointments")
          .select("scheduled_at, medical_records(soap_p)")
          .eq("patient_id", p.id).eq("status", "completed")
          .order("scheduled_at", { ascending: false }).limit(1).single();
        if (prevAptForS) {
          const prevMr = ((prevAptForS as Record<string, unknown>).medical_records as Record<string, string>[])?.[0];
          const prevDate = new Date((prevAptForS as Record<string, unknown>).scheduled_at as string).toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
          const autoS = `前回（${prevDate}）からの継続治療。特に症状の変化なし。\n前回予定: ${prevMr?.soap_p || ""}`;
          if (!(rec as unknown as MedicalRecord).soap_s) {
            setRecord({ ...(rec as unknown as MedicalRecord), soap_s: autoS });
            await supabase.from("medical_records").update({ soap_s: autoS }).eq("id", (rec as Record<string, unknown>).id);
          }
        }
      } else if (flowParam === "maintenance" && rec) {
        const autoS = "定期メンテナンス来院。";
        if (!(rec as unknown as MedicalRecord).soap_s) {
          setRecord({ ...(rec as unknown as MedicalRecord), soap_s: autoS });
          await supabase.from("medical_records").update({ soap_s: autoS }).eq("id", (rec as Record<string, unknown>).id);
        }
      }
    }
    setLoading(false);
  }

  async function loadTranscripts() { const { data } = await supabase.from("consultation_transcripts").select("*").eq("appointment_id", appointmentId).order("recording_number", { ascending: true }); if (data) setTranscripts(data as TranscriptEntry[]); }

  async function loadPreviousVisit(patientId: string) {
    const { data: prevApt } = await supabase.from("appointments").select("scheduled_at, medical_records ( soap_a, soap_p )").eq("patient_id", patientId).eq("status", "completed").order("scheduled_at", { ascending: false }).limit(1).single();
    if (!prevApt) return;
    const mr = (prevApt.medical_records as unknown as { soap_a: string; soap_p: string }[])?.[0]; if (!mr) return;
    const soapP = mr.soap_p || ""; const soapA = mr.soap_a || "";
    const nextMatch = soapP.match(/次回[：:\s]*(.+)/); const nextPlan = nextMatch ? nextMatch[1].trim() : "";
    const proceduresPart = nextMatch ? soapP.substring(0, nextMatch.index) : soapP;
    const procedures = proceduresPart.split(/[・、,\s]+/).map((s: string) => s.trim()).filter((s: string) => s && s !== "次回" && s.length > 1 && s.length < 20);
    const toothMatches = soapA.match(/#(\d{2})/g) || []; const toothNumbers = toothMatches.map((t: string) => t.replace("#", ""));
    setPreviousVisit({ date: prevApt.scheduled_at, soap_a: soapA, soap_p: soapP, procedures, nextPlan, toothNumbers });
    if (nextPlan) { const planItems = nextPlan.split(/[・、,\s]+/).map((s: string) => s.trim()).filter((s: string) => s && s.length > 1 && s.length < 20); setPlannedProcedures(planItems.map((name: string) => ({ name, checked: true }))); }
  }

  // ===== 通院モード（既存） =====
  function applyQuickSOAP() { if (!record || !previousVisit) return; const checkedProcs = plannedProcedures.filter(p => p.checked).map(p => p.name); const procsText = checkedProcs.join("・"); const teethText = previousVisit.toothNumbers.map(t => `#${t}`).join(" "); setRecord({ ...record, soap_s: "特に症状の変化なし", soap_o: `${teethText} 予定処置を実施 ${procsText}`, soap_a: previousVisit.soap_a || "", soap_p: `${procsText} 実施完了` }); setQuickSoapApplied(true); setVisitCondition("as_planned"); showMsg("✅ SOAP自動入力しました"); }
  function applyChangeNote() { if (!record || !changeNote.trim()) return; setRecord({ ...record, soap_s: changeNote }); setVisitCondition("changed"); showMsg("✅ S欄に入力しました"); }
  function togglePlannedProcedure(index: number) { setPlannedProcedures(prev => prev.map((p, i) => i === index ? { ...p, checked: !p.checked } : p)); }

  // ===== タイマー（既存） =====
  function startTimer() { if (timerRunning) return; setTimerRunning(true); timerRef.current = setInterval(() => setElapsedSeconds(prev => prev + 1), 1000); }
  function formatTimer(s: number) { return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`; }
  function formatDateJP(dateStr: string) { if (!dateStr) return ""; return new Date(dateStr).toLocaleDateString("ja-JP", { month: "short", day: "numeric" }); }

  // ===== 録音（既存ロジック完全保持） =====
  async function whisperTranscribe(blob: Blob, apiKey: string): Promise<string> {
    const mimeType = blob.type || "audio/wav"; let fileName = "recording.wav";
    if (mimeType.includes("webm")) fileName = "recording.webm"; else if (mimeType.includes("mp4") || mimeType.includes("m4a")) fileName = "recording.m4a"; else if (mimeType.includes("ogg")) fileName = "recording.ogg";
    const whisperFd = new FormData(); whisperFd.append("file", blob, fileName); whisperFd.append("model", "whisper-1"); whisperFd.append("language", "ja");
    whisperFd.append("prompt", "歯科診療所での医師・衛生士と患者の会話。「右下6番、C2ですね。CR充填しましょう。浸麻します。」「痛みはどうですか？」「冷たいものがしみます。」う蝕 C1 C2 C3 C4 FMC CAD/CAM冠 CR充填 インレー 抜髄 根管治療 感根治 根充 TEK SC SRP PMTC TBI P検 BOP 印象 咬合採得 形成 装着 ロキソニン フロモックス カロナール 右上 左上 右下 左下 1番 2番 3番 4番 5番 6番 7番 8番 歯周炎 歯髄炎 根尖性歯周炎");
    whisperFd.append("temperature", "0");
    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: whisperFd });
    if (!whisperRes.ok) { console.error("Whisper error:", whisperRes.status); return ""; }
    const result = await whisperRes.json(); return result.text || "";
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); streamRef.current = stream; chunksRef.current = []; recordingStartRef.current = Date.now();
      const mimeTypes = ["audio/webm;codecs=opus","audio/webm","audio/ogg;codecs=opus","audio/mp4","audio/wav"]; let selectedMime = "";
      for (const mime of mimeTypes) { if (MediaRecorder.isTypeSupported(mime)) { selectedMime = mime; break; } }
      const mrOptions: MediaRecorderOptions = {}; if (selectedMime) mrOptions.mimeType = selectedMime;
      const mr = new MediaRecorder(stream, mrOptions); mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => { const actualMime = mr.mimeType || "audio/webm"; const blob = new Blob(chunksRef.current, { type: actualMime }); stream.getTracks().forEach(t => t.stop());
        if (blob.size < 1000) { showMsg("⚠️ 音声が短すぎます"); return; }
        if (blob.size / 1024 / 1024 > 3) await compressAndTranscribe(blob); else await transcribeAudio(blob);
      };
      mr.start(1000); setIsRecording(true); startTimer(); showMsg("🔴 録音中...");
    } catch { showMsg("⚠️ マイクへのアクセスが拒否されました"); }
  }

  function audioBufferToWav(buffer: AudioBuffer): Blob {
    const sampleRate = buffer.sampleRate; const samples = buffer.getChannelData(0); const dataLength = samples.length * 2; const totalLength = 44 + dataLength;
    const wav = new ArrayBuffer(totalLength); const view = new DataView(wav);
    const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    ws(0,"RIFF"); view.setUint32(4,totalLength-8,true); ws(8,"WAVE"); ws(12,"fmt "); view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); ws(36,"data"); view.setUint32(40,dataLength,true);
    let offset = 44; for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true); offset += 2; }
    return new Blob([wav], { type: "audio/wav" });
  }

  async function compressAndTranscribe(blob: Blob) {
    setTranscribing(true); showMsg("📝 音声を処理中...");
    try {
      const tokenRes = await fetch("/api/whisper-token"); const tokenData = await tokenRes.json();
      if (!tokenData.key) { showMsg("❌ APIキーの取得に失敗"); setTranscribing(false); return; }
      const arrayBuffer = await blob.arrayBuffer();
      const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const targetSampleRate = 16000;
      const offlineCtx = new OfflineAudioContext(1, Math.ceil(audioBuffer.duration * targetSampleRate), targetSampleRate);
      const source = offlineCtx.createBufferSource(); source.buffer = audioBuffer; source.connect(offlineCtx.destination); source.start(0);
      const rendered = await offlineCtx.startRendering(); audioCtx.close();
      const samples = rendered.getChannelData(0);
      const chunkDurationSec = 5 * 60; const samplesPerChunk = chunkDurationSec * targetSampleRate;
      const numChunks = Math.ceil(samples.length / samplesPerChunk); const allTexts: string[] = [];
      for (let i = 0; i < numChunks; i++) {
        const start = i * samplesPerChunk; const end = Math.min(start + samplesPerChunk, samples.length);
        const chunkSamples = samples.slice(start, end);
        const chunkBuffer = new AudioBuffer({ numberOfChannels: 1, length: chunkSamples.length, sampleRate: targetSampleRate });
        chunkBuffer.getChannelData(0).set(chunkSamples);
        const wavBlob = audioBufferToWav(chunkBuffer);
        showMsg(`📝 文字起こし中... (${i + 1}/${numChunks})`);
        let text = await whisperTranscribe(wavBlob, tokenData.key);
        if (text && !detectHallucination(text)) {
          try { const corrRes = await fetch("/api/voice-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ whisper_only: true, raw_transcript: text }) });
            if (corrRes.ok) { const corrData = await corrRes.json(); if (corrData.success && corrData.transcript && corrData.transcript.length > text.length * 0.4) text = corrData.transcript; }
          } catch (e) { console.log("Chunk correction skipped:", e); }
          allTexts.push(text);
        }
      }
      const combinedText = allTexts.join("\n");
      if (!combinedText || combinedText.trim().length < 5) { showMsg("⚠️ 音声を認識できませんでした"); setTranscribing(false); return; }
      const durationSec = Math.round((Date.now() - recordingStartRef.current) / 1000); const nextNum = transcripts.length + 1;
      const { data: saved, error } = await supabase.from("consultation_transcripts").insert({ appointment_id: appointmentId, patient_id: patient?.id, recording_number: nextNum, transcript_text: combinedText, duration_seconds: durationSec }).select().single();
      if (saved && !error) { setTranscripts(prev => [...prev, saved as TranscriptEntry]); showMsg(`✅ 録音${nextNum}完了（${formatTimer(durationSec)}）`); }
    } catch (e) {
      console.error("Audio processing failed:", e);
      if (blob.size < 24 * 1024 * 1024) await transcribeAudio(blob); else showMsg("❌ 音声処理失敗");
    }
    setTranscribing(false);
  }

  function stopRecording() { if (mediaRecorderRef.current && isRecording) { if (isPaused) mediaRecorderRef.current.resume(); mediaRecorderRef.current.stop(); setIsRecording(false); setIsPaused(false); } }
  function pauseRecording() { if (mediaRecorderRef.current && isRecording && !isPaused) { mediaRecorderRef.current.pause(); setIsPaused(true); if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; setTimerRunning(false); } showMsg("⏸️ 一時停止中"); } }
  function resumeRecording() { if (mediaRecorderRef.current && isRecording && isPaused) { mediaRecorderRef.current.resume(); setIsPaused(false); startTimer(); showMsg("🔴 録音再開"); } }

  function detectHallucination(text: string): boolean {
    const patterns = ["購読ボタン","チャンネル登録","ご視聴ありがとう","いいねボタン","この動画","次の動画","Thank you for watching","Subscribe","Subtitles by","字幕"];
    for (const p of patterns) { if (text.includes(p)) return true; }
    const segments = text.split(/[。！!？?\s]+/).filter(s => s.length > 2);
    if (segments.length >= 3) { const freq: Record<string, number> = {}; for (const s of segments) freq[s] = (freq[s] || 0) + 1; for (const count of Object.values(freq)) { if (count >= 3 && count / segments.length > 0.4) return true; } }
    return false;
  }

  async function transcribeAudio(blob: Blob) {
    setTranscribing(true); showMsg("📝 文字起こし中...");
    try {
      const mimeType = blob.type || "audio/webm"; let fileName = "recording.webm";
      if (mimeType.includes("mp4") || mimeType.includes("m4a")) fileName = "recording.m4a"; else if (mimeType.includes("ogg")) fileName = "recording.ogg"; else if (mimeType.includes("wav")) fileName = "recording.wav";
      const tokenRes = await fetch("/api/whisper-token"); const tokenData = await tokenRes.json();
      if (!tokenData.key) { showMsg("❌ APIキーの取得に失敗"); setTranscribing(false); return; }
      const whisperFd = new FormData(); whisperFd.append("file", blob, fileName); whisperFd.append("model", "whisper-1"); whisperFd.append("language", "ja");
      whisperFd.append("prompt", "歯科診療所での医師と患者の会話。「右下6番、C2ですね。CR充填しましょう。浸麻します。」「痛みはどうですか？」「冷たいものがしみます。」う蝕 FMC CR充填 抜髄 根管治療 SC SRP インレー 印象 右上 左上 右下 左下 1番 2番 3番 4番 5番 6番 7番 8番");
      whisperFd.append("temperature", "0");
      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: `Bearer ${tokenData.key}` }, body: whisperFd });
      if (!whisperRes.ok) { showMsg(`❌ 音声認識エラー（${whisperRes.status}）`); setTranscribing(false); return; }
      const whisperResult = await whisperRes.json(); const transcript = whisperResult.text || "";
      if (!transcript || transcript.trim().length < 5) { showMsg("⚠️ 音声を認識できませんでした"); setTranscribing(false); return; }
      if (detectHallucination(transcript)) { showMsg("⚠️ 音声認識がうまくいきませんでした"); setTranscribing(false); return; }
      let correctedTranscript = transcript;
      try { const corrRes = await fetch("/api/voice-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ whisper_only: true, raw_transcript: transcript }) });
        if (corrRes.ok) { const corrData = await corrRes.json(); if (corrData.success && corrData.transcript) correctedTranscript = corrData.transcript; }
      } catch (e) { console.log("Correction skipped:", e); }
      const durationSec = Math.round((Date.now() - recordingStartRef.current) / 1000); const nextNum = transcripts.length + 1;
      const { data: saved, error } = await supabase.from("consultation_transcripts").insert({ appointment_id: appointmentId, patient_id: patient?.id, recording_number: nextNum, transcript_text: correctedTranscript, duration_seconds: durationSec }).select().single();
      if (saved && !error) { setTranscripts(prev => [...prev, saved as TranscriptEntry]); showMsg(`✅ 録音${nextNum}完了（${formatTimer(durationSec)}）`); }
    } catch (err) { console.error("文字起こしエラー:", err); showMsg("❌ 文字起こしに失敗"); }
    setTranscribing(false);
  }

  function startEditTranscript(entry: TranscriptEntry) { setEditingTranscriptId(entry.id); setEditingText(entry.transcript_text); }
  async function saveEditTranscript() { if (!editingTranscriptId) return; await supabase.from("consultation_transcripts").update({ transcript_text: editingText, is_edited: true }).eq("id", editingTranscriptId); setTranscripts(prev => prev.map(t => t.id === editingTranscriptId ? { ...t, transcript_text: editingText, is_edited: true } : t)); setEditingTranscriptId(null); showMsg("✅ 修正を保存"); }
  async function deleteTranscript(id: string) { if (!confirm("この録音を削除しますか？")) return; await supabase.from("consultation_transcripts").delete().eq("id", id); setTranscripts(prev => prev.filter(t => t.id !== id)); showMsg("🗑️ 削除しました"); }

  // ===== SOAP生成（既存） =====
  async function generateSOAPFromTranscripts() {
    if (transcripts.length === 0) { showMsg("⚠️ 文字起こしがありません"); return; }
    const fullText = transcripts.map(t => t.transcript_text).join("\n\n");
    setGeneratingSOAP(true); showMsg("🤖 SOAP生成中...");
    try {
      const res = await fetch("/api/voice-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full_transcript: fullText, existing_soap_s: record?.soap_s || "" }) });
      const data = await res.json();
      if (data.success) {
        setAiResult({ soap: data.soap, tooth_updates: data.tooth_updates || {}, procedures: data.procedures || [], diagnoses: data.diagnoses || [], soap_s_undetected: data.soap_s_undetected === true });
        setShowAiPreview(true);
        if (data.soap_s_undetected) showMsg("⚠️ 音声から主訴を十分に読み取れませんでした。内容を確認してください");
        else showMsg("✅ SOAP生成完了");
      }
      else showMsg(`❌ ${data.error || "SOAP生成失敗"}`);
    } catch { showMsg("❌ SOAP生成に失敗"); }
    setGeneratingSOAP(false);
  }

  async function applyAiResult() {
    if (!record || !aiResult) return;
    if (aiResult.soap_s_undetected) {
      if (!confirm("⚠️ 音声から主訴を十分に読み取れませんでした。\n\n反映後、S欄の内容を必ず確認・修正してください。\n\nこのまま反映しますか？")) return;
    }
    const chart = { ...(record.tooth_chart || {}) };
    if (aiResult.tooth_updates) Object.entries(aiResult.tooth_updates).forEach(([t, s]) => { const num = t.replace("#", ""); if (TOOTH_STATUS[s]) chart[num] = [s]; });
    setRecord({ ...record, soap_s: aiResult.soap.s || record.soap_s, soap_o: aiResult.soap.o || record.soap_o, soap_a: aiResult.soap.a || record.soap_a, soap_p: aiResult.soap.p || record.soap_p, tooth_chart: chart });
    if (aiResult.diagnoses && aiResult.diagnoses.length > 0 && record.patient_id) {
      try { for (const d of aiResult.diagnoses) { const { data: dup } = await supabase.from("patient_diagnoses").select("id").eq("patient_id", record.patient_id).eq("diagnosis_code", d.code || "").eq("tooth_number", d.tooth || "").eq("outcome", "continuing").limit(1); if (dup && dup.length > 0) continue; await supabase.from("patient_diagnoses").insert({ patient_id: record.patient_id, diagnosis_code: d.code || "", diagnosis_name: d.name || "", tooth_number: d.tooth || "", start_date: new Date().toISOString().split("T")[0], outcome: "continuing" }); } } catch (e) { console.error("傷病名エラー:", e); }
    }
    setShowAiPreview(false); showMsg(aiResult.soap_s_undetected ? "⚠️ SOAPに反映しました — S欄を確認してください" : "✅ SOAPに反映しました");
  }

  function showMsg(msg: string) { setSaveMsg(msg); setTimeout(() => setSaveMsg(""), 5000); }
  function updateSOAP(field: "soap_s" | "soap_o" | "soap_a" | "soap_p", value: string) { if (record) setRecord({ ...record, [field]: value }); }
  function setToothState(num: string, status: string) { if (!record) return; const chart = { ...(record.tooth_chart || {}) }; if (status === "normal") delete chart[num]; else chart[num] = [status]; setRecord({ ...record, tooth_chart: chart }); }
  function onCheckTap(num: string) { if (!checkMode) return; setToothState(num, checkBrush); }

  // ★ ベースラインチェック: 次の歯に進む
  function baselineNext(status: string) {
    const tooth = ALL_TEETH[baselineIndex];
    setToothState(tooth, status);
    if (baselineIndex < ALL_TEETH.length - 1) setBaselineIndex(baselineIndex + 1);
    else { setBaselineMode(false); showMsg("✅ ベースライン記録完了！"); }
  }
  function baselinePrev() { if (baselineIndex > 0) setBaselineIndex(baselineIndex - 1); }

  // ★ P検データ更新
  function updatePerio(tooth: string, field: keyof PerioData, value: unknown) {
    setPerioData(prev => {
      const defaults: PerioData = { buccal: [2,2,2], lingual: [2,2,2], bop: false, mobility: 0 };
      const existing = prev[tooth] || defaults;
      return { ...prev, [tooth]: { ...existing, [field]: value } };
    });
  }
  function updatePerioPocket(tooth: string, side: "buccal" | "lingual", index: number, value: number) {
    setPerioData(prev => {
      const current = prev[tooth] || { buccal: [2,2,2] as [number,number,number], lingual: [2,2,2] as [number,number,number], bop: false, mobility: 0 };
      const arr = [...current[side]] as [number, number, number];
      arr[index] = value;
      return { ...prev, [tooth]: { ...current, [side]: arr } };
    });
  }

  async function saveRecord() {
    if (!record) return; setSaving(true);
    await supabase.from("medical_records").update({ soap_s: record.soap_s, soap_o: record.soap_o, soap_a: record.soap_a, soap_p: record.soap_p, tooth_chart: record.tooth_chart, tooth_surfaces: toothSurfaces, status: "soap_complete" }).eq("id", record.id);
    showMsg("保存しました ✅"); setSaving(false);
  }

  async function completeSession() {
    if (!record || !appointmentId) return;
    if (!confirm("診察を完了してカルテを確定しますか？\n確定後、自動的に点数算定が行われます。")) return;
    setSaving(true);
    // CRM連携: 歯式変更を検出
    let toothChanges: { tooth: string; from: string; to: string }[] = [];
    try {
      const { data: ptData } = await supabase.from("patients").select("current_tooth_chart").eq("id", record.patient_id).single();
      const prevChart: Record<string, string> = {};
      if (ptData?.current_tooth_chart && typeof ptData.current_tooth_chart === "object") {
        Object.entries(ptData.current_tooth_chart as Record<string, unknown>).forEach(([k, v]) => { if (typeof v === "string") prevChart[k] = v; else if (typeof v === "object" && v && "status" in (v as Record<string, string>)) prevChart[k] = (v as Record<string, string>).status; });
      }
      const newChart = record.tooth_chart || {};
      const allTeethSet = new Set([...Object.keys(prevChart), ...Object.keys(newChart)]);
      allTeethSet.forEach(tooth => { const prevVal = prevChart[tooth] || "normal"; const prev = typeof prevVal === "string" ? prevVal : String(prevVal); const nextVal = newChart[tooth] || "normal"; const next = Array.isArray(nextVal) ? nextVal.join(",") : String(nextVal); if (prev !== next) toothChanges.push({ tooth, from: prev, to: next }); });
    } catch (e) { console.error("歯式変更検出エラー:", e); }

    // ★ P検実施時: O欄にP検サマリを自動追記（保険算定に必要）
    let finalSoapO = record.soap_o || "";
    if (Object.keys(perioData).length > 0) {
      let bopP = 0, bopT = 0, d4 = 0, d6 = 0;
      Object.values(perioData).forEach(pd => { if (pd.bop) bopP++; bopT++;
        [...pd.buccal, ...pd.lingual].forEach(v => { if (v >= 4) d4++; if (v >= 6) d6++; });
      });
      const bopRate = bopT > 0 ? Math.round(bopP / bopT * 1000) / 10 : 0;
      const perioNote = `\n【P検実施】${Object.keys(perioData).length}歯測定 / BOP率${bopRate}% / PPD≧4mm: ${d4}部位 / PPD≧6mm: ${d6}部位`;
      finalSoapO = finalSoapO + perioNote;
    }

    await supabase.from("medical_records").update({ soap_s: record.soap_s, soap_o: finalSoapO, soap_a: record.soap_a, soap_p: record.soap_p, tooth_chart: record.tooth_chart, tooth_surfaces: toothSurfaces, tooth_changes: toothChanges, status: "confirmed", doctor_confirmed: true }).eq("id", record.id);
    await supabase.from("appointments").update({ status: "completed" }).eq("id", appointmentId);
    await supabase.from("queue").update({ status: "done" }).eq("appointment_id", appointmentId);

    // CRM: current_tooth_chart更新
    try { const ntc: Record<string, { status: string }> = {}; Object.entries(record.tooth_chart || {}).forEach(([k, v]) => { ntc[k] = { status: Array.isArray(v) ? v.join(",") : v }; }); await supabase.from("patients").update({ current_tooth_chart: ntc }).eq("id", record.patient_id); } catch (e) { console.error("CRM歯式エラー:", e); }

    // CRM: tooth_history
    try { if (toothChanges.length > 0) await supabase.from("tooth_history").insert(toothChanges.map(tc => ({ patient_id: record.patient_id, record_id: record.id, tooth_number: tc.tooth, change_type: "status_change", previous_status: tc.from, new_status: tc.to }))); } catch (e) { console.error("CRM履歴エラー:", e); }

    // CRM: P検データ保存
    if (Object.keys(perioData).length > 0) {
      try {
        // perio_snapshots
        let bopP = 0, bopT = 0, d4 = 0, d6 = 0;
        Object.values(perioData).forEach(pd => { if (pd.bop) bopP++; bopT++;
          [...pd.buccal, ...pd.lingual].forEach(v => { if (v >= 4) d4++; if (v >= 6) d6++; });
        });
        await supabase.from("perio_snapshots").insert({ patient_id: record.patient_id, record_id: record.id, perio_data: perioData, total_teeth_probed: Object.keys(perioData).length, deep_4mm_plus: d4, deep_6mm_plus: d6, bop_positive: bopP, bop_total: bopT, bop_rate: bopT > 0 ? Math.round(bopP / bopT * 1000) / 10 : 0 });
        // tooth_history perio entries
        const perioHistoryRows = Object.entries(perioData).map(([tooth, pd]) => ({ patient_id: record.patient_id, record_id: record.id, tooth_number: tooth, change_type: "perio_update", pocket_buccal: pd.buccal, pocket_lingual: pd.lingual, bop: pd.bop, mobility: pd.mobility }));
        await supabase.from("tooth_history").insert(perioHistoryRows);
        // current_perio_chart更新
        await supabase.from("patients").update({ current_perio_chart: perioData }).eq("id", record.patient_id);
      } catch (e) { console.error("P検保存エラー:", e); }
    }

    // 自動算定（プレビュー済みの場合はプレビュー結果を使用、未プレビューならbilling-previewを先に走らせる）
    let billingResult = "";
    try {
      const billingBody: Record<string, unknown> = { record_id: record.id };
      if (previewDone && billingItems.length > 0) {
        billingBody.preview_items = billingItems.map(i => ({ code: i.code, name: i.name, points: i.points, count: i.count, tooth_numbers: i.tooth ? i.tooth.replace(/[#\s]/g, "").split("") : [] }));
        billingBody.use_preview = true;
      } else {
        // プレビューなし → billing-previewを自動実行してその結果を使う
        const prevRes = await fetch("/api/billing-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ record_id: record.id }) });
        const prevData = await prevRes.json();
        if (prevData.success && prevData.items?.length > 0) {
          billingBody.preview_items = prevData.items;
          billingBody.use_preview = true;
        }
      }
      const res = await fetch("/api/auto-billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(billingBody) });
      const data = await res.json();
      if (data.success) { billingResult = `✅ 算定完了: ${data.total_points}点 / 患者負担¥${data.patient_burden}`; if (data.items) { setBillingItems(data.items); setBillingTotal(data.total_points); } }
      else billingResult = `⚠️ 算定エラー: ${data.error || "不明"}`;
    } catch (e) { billingResult = `⚠️ 算定API失敗: ${e instanceof Error ? e.message : "不明"}`; }
    if (timerRef.current) clearInterval(timerRef.current);
    setSaving(false);
    const changeMsg = toothChanges.length > 0 ? `\n\n🦷 歯式変更: ${toothChanges.map(c => `#${c.tooth} ${c.from}→${c.to}`).join(", ")}` : "";
    const perioMsg = Object.keys(perioData).length > 0 ? `\n📊 P検: ${Object.keys(perioData).length}歯記録` : "";
    alert(`カルテ確定しました。\n\n${billingResult}${changeMsg}${perioMsg}\n\n会計画面に移動します。`);
    router.push("/billing");
  }

  function getAge(dob: string) { const b = new Date(dob), t = new Date(); let a = t.getFullYear() - b.getFullYear(); if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--; return a; }

  function renderTooth(num: string, isDeciduous = false) {
    const statuses = getToothStatuses(record?.tooth_chart || null, num);
    const primary = primaryStatus(record?.tooth_chart || null, num);
    const cfg = TOOTH_STATUS[primary] || TOOTH_STATUS.normal;
    const editing = editingTooth === num && !checkMode && !baselineMode;
    const size = isDeciduous ? "w-8 h-8 text-xs" : "w-9 h-9 text-xs";
    const isBaselineCurrent = baselineMode && ALL_TEETH[baselineIndex] === num;
    const hasMultiple = statuses.length > 1 || (statuses.length === 1 && statuses[0] !== "normal");
    // ラベル表示: 複数の場合はショートラベルを連結
    const displayLabel = statuses.includes("normal") && statuses.length === 1
      ? num
      : statuses.filter(s => s !== "normal").map(s => TOOTH_STATUS[s]?.shortLabel || TOOTH_STATUS[s]?.label || s).join("/");
    return (
      <div key={num} className="relative">
        <button onClick={() => { if (checkMode) onCheckTap(num); else if (!baselineMode) setEditingTooth(editing ? null : num); }}
          className={`${size} rounded-lg font-bold border-2 transition-all ${cfg.bg} ${cfg.border} ${cfg.color} ${isBaselineCurrent ? "ring-4 ring-sky-400 scale-125 shadow-lg" : checkMode ? "hover:ring-2 hover:ring-sky-300 active:scale-95" : editing ? "ring-2 ring-sky-400 scale-110" : "hover:scale-105"}`}>
          <span className="text-xs leading-none">{displayLabel}</span>
        </button>
        {/* 複数ステータスドット */}
        {hasMultiple && statuses.length > 1 && (
          <div className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 flex gap-[1px]">
            {statuses.filter(s => s !== "normal").slice(0, 3).map((s, i) => (
              <span key={i} className={`w-1.5 h-1.5 rounded-full ${TOOTH_STATUS[s]?.bg || "bg-gray-300"} border ${TOOTH_STATUS[s]?.border || "border-gray-300"}`} />
            ))}
          </div>
        )}
        {/* 歯面情報インジケーター */}
        {(toothSurfaces[num] || []).length > 0 && (
          <div className="absolute -top-1 -right-1 bg-sky-500 text-white text-[7px] w-3.5 h-3.5 rounded-full flex items-center justify-center font-bold shadow-sm">
            {(toothSurfaces[num] || []).length}
          </div>
        )}
        {/* 編集ポップアップ: 複数選択対応 + 歯面管理（5面） */}
        {editing && !checkMode && !baselineMode && (
          <div className="absolute z-30 top-full mt-1 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-xl border border-gray-200 p-2 min-w-[180px]">
            <p className="text-xs text-gray-400 text-center mb-1 font-bold">#{num}（複数選択可）</p>
            {Object.entries(TOOTH_STATUS).map(([k, v]) => {
              const isActive = statuses.includes(k);
              return (
                <button key={k} onClick={() => {
                  if (!record) return;
                  const newChart = toggleToothStatus(record.tooth_chart || {}, num, k);
                  setRecord({ ...record, tooth_chart: newChart });
                }} className={`w-full text-left px-2 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 ${isActive ? "bg-sky-50 text-sky-700" : "text-gray-600 hover:bg-gray-50"}`}>
                  <span className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center text-xs ${isActive ? "bg-sky-500 border-sky-500 text-white" : "border-gray-300"}`}>
                    {isActive ? "✓" : ""}
                  </span>
                  <span className={`${v.color}`}>{v.shortLabel}</span>
                  <span>{v.label}</span>
                </button>
              );
            })}
            {/* 歯面管理（5面）— う蝕・充填・インレー関連ステータスがある場合のみ表示 */}
            {statuses.some(s => ["c1","c2","c3","c4","cr","inlay","in_treatment"].includes(s)) && (
              <div className="mt-2 pt-2 border-t border-gray-200">
                <p className="text-xs text-gray-400 font-bold mb-1.5">🦷 罹患面（5面）</p>
                <div className="flex justify-center gap-1 mb-1">
                  {(["M","D","B","L","O"] as const).map(surface => {
                    const surfaceLabels: Record<string, string> = { M: "近心", D: "遠心", B: "頬側", L: "舌側", O: "咬合" };
                    const currentSurfaces = toothSurfaces[num] || [];
                    const isOn = currentSurfaces.includes(surface);
                    return (
                      <button key={surface} onClick={() => {
                        const cur = toothSurfaces[num] || [];
                        const updated = isOn ? cur.filter(s => s !== surface) : [...cur, surface];
                        setToothSurfaces({ ...toothSurfaces, [num]: updated });
                      }} className={`w-9 h-9 rounded-lg text-xs font-bold border-2 transition-all flex flex-col items-center justify-center leading-tight ${isOn ? "bg-sky-500 text-white border-sky-500 shadow-sm" : "bg-gray-50 text-gray-400 border-gray-200 hover:border-sky-300"}`}>
                        <span className="text-xs">{surface}</span>
                        <span className="text-[7px]">{surfaceLabels[surface]}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-center text-gray-400">
                  {(toothSurfaces[num] || []).length === 0 ? "未選択" :
                   (toothSurfaces[num] || []).length === 1 ? "単純（1面）" :
                   `複雑（${(toothSurfaces[num] || []).length}面）`}
                </p>
              </div>
            )}
            <button onClick={() => setEditingTooth(null)} className="w-full mt-1 text-center text-xs text-gray-400 hover:text-gray-600 py-1">閉じる</button>
          </div>
        )}
      </div>
    );
  }

  // 算定プレビュー
  async function runBillingPreview() {
    if (!record) return;
    setPreviewLoading(true);
    setPreviewDone(false);
    try {
      // まずSOAPを保存
      await supabase.from("medical_records").update({ soap_s: record.soap_s, soap_o: record.soap_o, soap_a: record.soap_a, soap_p: record.soap_p }).eq("id", record.id);
      const res = await fetch("/api/billing-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ record_id: record.id }) });
      const data = await res.json();
      if (data.success) {
        const items: BillingItem[] = (data.items || []).map((i: { code: string; name: string; points: number; count: number; source: string; tooth_numbers: string[] }) => ({
          code: i.code, name: i.name, points: i.points, count: i.count,
          tooth: i.tooth_numbers?.length > 0 ? i.tooth_numbers.map((t: string) => `#${t}`).join(" ") : undefined,
          source: i.source,
        }));
        setBillingItems(items);
        setBillingTotal(data.total_points || 0);
        setPreviewWarnings(data.warnings || []);
        setMatchedProcedures(data.matched_procedures || []);
        setPreviewDone(true);
        showMsg(`✅ ${items.length}件の算定項目を検出 / 合計${data.total_points}点`);
      } else {
        showMsg(`⚠️ プレビューエラー: ${data.error}`);
      }
    } catch (e) { showMsg(`⚠️ プレビュー失敗: ${e instanceof Error ? e.message : "不明"}`); }
    setPreviewLoading(false);
  }

  // fee_master検索で手動追加
  const [feeSearchQuery, setFeeSearchQuery] = useState("");
  const [feeSearchResults, setFeeSearchResults] = useState<{ code: string; name: string; points: number }[]>([]);
  async function searchFeeItems(q: string) {
    setFeeSearchQuery(q);
    if (q.length < 2) { setFeeSearchResults([]); return; }
    const { data } = await supabase.from("fee_master_v2").select("kubun_code,sub_code,name,name_short,points").or(`name.ilike.%${q}%,name_short.ilike.%${q}%,kubun_code.ilike.%${q}%`).limit(8);
    if (data) setFeeSearchResults(data.map((d: { kubun_code: string; sub_code: string; name: string; name_short: string; points: number }) => ({ code: d.sub_code ? `${d.kubun_code}-${d.sub_code}` : d.kubun_code, name: d.name_short || d.name, points: d.points })));
  }
  function addFeeItem(item: { code: string; name: string; points: number }) {
    const newItems = [...billingItems, { code: item.code, name: item.name, points: item.points, count: 1 }];
    setBillingItems(newItems);
    setBillingTotal(newItems.reduce((s, i) => s + i.points * i.count, 0));
    setFeeSearchQuery(""); setFeeSearchResults([]);
    showMsg(`✅ ${item.name} を追加`);
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
  const chartStats = (() => { const c = record.tooth_chart || {}; const counts: Record<string, number> = {}; Object.keys(c).forEach(t => { const sts = getToothStatuses(c, t); sts.forEach(s => { if (s !== "normal") counts[s] = (counts[s] || 0) + 1; }); }); return counts; })();

  // P検サマリ
  const perioSummary = (() => {
    let bopP = 0, bopT = 0, d4 = 0, d6 = 0, totalSites = 0, mobC = 0;
    Object.values(perioData).forEach(pd => { if (pd.bop) bopP++; bopT++;
      [...pd.buccal, ...pd.lingual].forEach(v => { totalSites++; if (v >= 4) d4++; if (v >= 6) d6++; });
      if (pd.mobility > 0) mobC++;
    });
    return { bopP, bopT, bopRate: bopT > 0 ? Math.round(bopP / bopT * 1000) / 10 : 0, d4, d6, totalSites, d4pct: totalSites > 0 ? Math.round(d4 / totalSites * 1000) / 10 : 0, mobC, count: Object.keys(perioData).length };
  })();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20">
        <div className="max-w-full mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-5">
            <Link href={`/consultation/hub?appointment_id=${appointmentId}`} className="text-gray-400 hover:text-gray-600 text-base font-bold">← 戻る</Link>
            <div className="flex items-center gap-4">
              <div className={`${isReturning ? "bg-green-500" : "bg-sky-500"} text-white w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold`}>{patient.name_kanji.charAt(0)}</div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold text-gray-900">{patient.name_kanji}</h1>
                  <span className="text-sm text-gray-400">({patient.name_kana})</span>
                  {isReturning
                    ? <span className="bg-green-100 text-green-700 text-xs px-3 py-1 rounded-lg font-bold">再診</span>
                    : <span className="bg-red-100 text-red-600 text-xs px-3 py-1 rounded-lg font-bold">初診</span>}
                  {flowParam && <span className="bg-purple-100 text-purple-700 text-xs px-3 py-1 rounded-lg font-bold">{flowParam === "continue" ? "🩺 継続" : flowParam === "maintenance" ? "🪥 メンテ" : "⚡ 新規主訴"}</span>}
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-400 mt-0.5">
                  <span>{getAge(patient.date_of_birth)}歳</span>
                  <span>{patient.insurance_type} {patient.burden_ratio * 10}割</span>
                  <span>{patient.phone}</span>
                  <span>{patient.date_of_birth}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saveMsg && <span className="text-sm font-bold text-green-600 bg-green-50 px-4 py-2 rounded-full">{saveMsg}</span>}
            <div className={`flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-xl font-bold ${isRecording ? "bg-red-50 text-red-600 border-2 border-red-200" : "bg-gray-100 text-gray-600"}`}>
              {isRecording && <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />}{formatTimer(elapsedSeconds)}
            </div>
            {transcribing ? <div className="bg-amber-100 text-amber-700 px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2"><span className="animate-spin">⚙️</span> 処理中...</div>
            : isRecording ? <div className="flex items-center gap-2">
                {isPaused ? <button onClick={resumeRecording} className="bg-sky-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold">▶️ 再開</button> : <button onClick={pauseRecording} className="bg-amber-500 text-white px-5 py-2.5 rounded-xl text-sm font-bold">⏸️ 一時停止</button>}
                <button onClick={stopRecording} className="bg-red-600 text-white px-5 py-2.5 rounded-xl text-sm font-bold">⏹️ 停止</button>
              </div>
            : <button onClick={startRecording} className="bg-sky-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-sky-200 hover:bg-sky-700">🎙️ 録音開始</button>}
          </div>
        </div>
      </header>

      {/* アレルギー警告バナー */}
      {patient.allergies && Array.isArray(patient.allergies) && patient.allergies.length > 0 && !patient.allergies.includes("なし") && (
        <div className="bg-red-50 border-b-2 border-red-300 px-6 py-3 flex items-center gap-4 sticky top-[68px] z-10">
          <span className="text-2xl">⚠️</span>
          <div>
            <span className="text-sm font-bold text-red-700">アレルギー: </span>
            <span className="text-sm font-bold text-red-600">{patient.allergies.join("、")}</span>
          </div>
          <span className="text-xs text-red-400 ml-auto">処方・麻酔時に注意</span>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-6 py-4">
        <div className="space-y-4">
            {/* ★ ステップ進行バー — 大きく */}
            <div className="flex gap-2 bg-white rounded-2xl border border-gray-200 p-2 shadow-sm">
              {STEP_LABELS.map((s, i) => {
                const stepIdx = STEP_LABELS.findIndex(x => x.key === activeTab);
                const isActive = activeTab === s.key;
                const isDone = i < stepIdx;
                return (
                  <button key={s.key} onClick={() => setActiveTab(s.key)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-3.5 rounded-xl text-sm font-bold transition-all ${
                      isActive ? "bg-sky-500 text-white shadow-lg shadow-sky-200"
                      : isDone ? "bg-green-50 text-green-600 border-2 border-green-200"
                      : "bg-gray-50 text-gray-400 hover:bg-gray-100"
                    }`}>
                    <span className="text-lg">{isDone ? "✓" : s.icon}</span>
                    <span>{s.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      isActive ? "bg-white/30 text-white"
                      : isDone ? "bg-green-100 text-green-500"
                      : "bg-gray-100 text-gray-400"
                    }`}>{s.who}</span>
                  </button>
                );
              })}
            </div>

            {/* ===== ① 主訴確認 ===== */}
            {activeTab === "chief" && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">
                  💬 Step 1: 主訴確認（S）
                </h3>
                <p className="text-sm text-gray-400 mb-4">
                  患者さんの訴えを確認・記録します。問診票の内容がある場合は表示されます。
                </p>

                {/* 再診時: 前回情報 */}
                {isReturning && previousVisit && (
                  <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
                    <p className="text-xs text-blue-500 font-bold mb-1">
                      前回（{formatDateJP(previousVisit.date)}）の計画
                    </p>
                    <p className="text-sm text-blue-800 font-bold">
                      {previousVisit.nextPlan || previousVisit.soap_p}
                    </p>
                    {plannedProcedures.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {plannedProcedures.map((p, i) => (
                          <button key={i}
                            onClick={() => togglePlannedProcedure(i)}
                            className={`text-xs font-bold px-2.5 py-1 rounded-full border transition-all ${
                              p.checked
                                ? "bg-blue-100 text-blue-700 border-blue-300"
                                : "bg-gray-100 text-gray-400 border-gray-200 line-through"
                            }`}>
                            {p.checked ? "✓ " : ""}{p.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {!quickSoapApplied && (
                      <div className="mt-3 flex gap-2">
                        <button onClick={applyQuickSOAP}
                          className="bg-blue-500 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-600">
                          ✅ 予定通り進行
                        </button>
                        <button onClick={() => setVisitCondition("changed")}
                          className="bg-white text-orange-600 border border-orange-300 px-4 py-2 rounded-lg text-xs font-bold hover:bg-orange-50">
                          ⚠ 内容変更あり
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* S欄入力 */}
                <div className="mb-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-red-500 text-white text-sm font-bold w-7 h-7 rounded flex items-center justify-center">S</span>
                    <span className="text-sm font-bold text-gray-600">主観（患者さんの訴え）</span>
                  </div>
                  <textarea
                    value={record.soap_s || ""}
                    onChange={e => updateSOAP("soap_s", e.target.value)}
                    placeholder="患者さんの訴え・主訴を入力..."
                    className="w-full border-2 border-gray-200 rounded-xl px-4 py-4 text-base focus:outline-none focus:border-sky-400 resize-none"
                    rows={4}
                  />
                </div>

                {/* 専用録音 → AI分析 → S欄比較 */}
                <div className="bg-sky-50 rounded-xl p-5 border border-sky-200">
                  <p className="text-sm font-bold text-sky-700 mb-4">
                    🎙 音声で主訴を記録
                  </p>
                  <p className="text-xs text-sky-500 mb-3">
                    ヘッダーの録音ボタンで録音 → 文字起こし完了後、下のボタンでS分析
                  </p>
                  {transcripts.length > 0 && (
                    <div className="mb-3 bg-white rounded-lg p-3 border border-sky-100">
                      <p className="text-xs text-gray-400 font-bold mb-1">
                        文字起こし（{transcripts.length}件）
                      </p>
                      <p className="text-xs text-gray-600 line-clamp-3">
                        {transcripts.map(t => t.transcript_text).join(" ")}
                      </p>
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      if (transcripts.length === 0) {
                        showMsg("⚠️ 先に録音してください");
                        return;
                      }
                      showMsg("🤖 S欄を分析中...");
                      try {
                        const full = transcripts.map(
                          t => t.transcript_text
                        ).join("\n");
                        const res = await fetch("/api/step-analyze", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            step: "chief",
                            transcript: full,
                            existing_soap: { s: record.soap_s || "" },
                          }),
                        });
                        const data = await res.json();
                        if (data.success && data.result) {
                          const r = data.result;
                          const merged = r.merged_s || r.analyzed_s || "";
                          if (record.soap_s && record.soap_s.trim()) {
                            const ok = confirm(
                              `問診票のS:\n${record.soap_s}\n\nAI分析のS:\n${merged}\n\nAI分析の内容でS欄を更新しますか？`
                            );
                            if (ok) updateSOAP("soap_s", merged);
                          } else {
                            updateSOAP("soap_s", merged);
                          }
                          showMsg("✅ S欄を更新しました");
                        } else {
                          showMsg("❌ 分析失敗: " + (data.error || ""));
                        }
                      } catch (e) {
                        showMsg("❌ 分析エラー");
                        console.error(e);
                      }
                    }}
                    disabled={transcripts.length === 0}
                    className="w-full bg-sky-500 text-white py-3.5 rounded-xl text-sm font-bold hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    🤖 音声からS欄を分析・更新
                  </button>
                </div>

                {/* 次のステップへ */}
                <div className="mt-4 flex justify-end">
                  <button onClick={() => setActiveTab("tooth")}
                    className="bg-sky-500 text-white px-8 py-3.5 rounded-xl text-base font-bold hover:bg-sky-600 shadow-md shadow-sky-200">
                    次へ: 歯式記録 →
                  </button>
                </div>
              </div>
            )}

            {/* ===== ② 歯式タブ ===== */}
            {activeTab === "tooth" && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold text-gray-700">🦷 歯式チャート</h3>
                    <div className="flex bg-gray-100 rounded-lg p-0.5">
                      <button onClick={() => setDentitionMode("permanent")} className={`px-2.5 py-1 rounded-md text-xs font-bold ${dentitionMode === "permanent" ? "bg-white text-gray-800 shadow-sm" : "text-gray-400"}`}>永久歯</button>
                      <button onClick={() => setDentitionMode("mixed")} className={`px-2.5 py-1 rounded-md text-xs font-bold ${dentitionMode === "mixed" ? "bg-white text-gray-800 shadow-sm" : "text-gray-400"}`}>混合歯列</button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {Object.keys(chartStats).length > 0 && <div className="flex gap-1">{Object.entries(chartStats).map(([s, c]) => (<span key={s} className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${TOOTH_STATUS[s]?.bg} ${TOOTH_STATUS[s]?.color} ${TOOTH_STATUS[s]?.border} border`}>{TOOTH_STATUS[s]?.label} {c}</span>))}</div>}
                    {!isReturning && !baselineMode && <button onClick={() => { setBaselineMode(true); setBaselineIndex(0); setCheckMode(false); }} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-sky-50 text-sky-600 border border-sky-200 hover:bg-sky-100">📋 ベースライン記録</button>}
                    {!baselineMode && <button onClick={() => { setCheckMode(!checkMode); setEditingTooth(null); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${checkMode ? "bg-orange-500 text-white" : "bg-orange-50 text-orange-600 border border-orange-200"}`}>{checkMode ? "✓ チェック中" : "🖊 一括チェック"}</button>}
                  </div>
                </div>

                {/* レントゲン画像アップロード & AI分析 */}
                <div className="mb-3 p-3 bg-purple-50 rounded-xl border border-purple-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-purple-700">
                      📷 レントゲン画像 → AI歯式分析
                    </span>
                    <div className="flex gap-2">
                      <label className="cursor-pointer">
                        <span className="text-xs font-bold bg-purple-500 text-white px-3 py-1.5 rounded-lg hover:bg-purple-600 inline-block">
                          📸 カメラで撮影
                        </span>
                        <input type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !patient || !record) return;
                            showMsg("📤 アップロード中...");
                            try {
                              const fd = new FormData();
                              fd.append("file", file);
                              fd.append("patient_id", patient.id);
                              fd.append("record_id", record.id);
                              fd.append("image_type", "panorama");
                              const upRes = await fetch(
                                "/api/image-upload",
                                { method: "POST", body: fd }
                              );
                              const upData = await upRes.json();
                              if (!upData.success) {
                                showMsg("❌ アップロード失敗");
                                return;
                              }
                              showMsg("🤖 AI分析中...");
                              const aiRes = await fetch(
                                "/api/xray-analyze",
                                {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    image_base64: upData.image.base64,
                                    patient_id: patient.id,
                                  }),
                                }
                              );
                              const aiData = await aiRes.json();
                              if (aiData.success && aiData.tooth_chart) {
                                const chart = {
                                  ...(record.tooth_chart || {}),
                                };
                                Object.entries(
                                  aiData.tooth_chart
                                ).forEach(([t, s]) => {
                                  if (TOOTH_STATUS[s as string]) {
                                    chart[t] = [s as string];
                                  }
                                });
                                setRecord({
                                  ...record, tooth_chart: chart,
                                });
                                const cnt = Object.keys(
                                  aiData.tooth_chart
                                ).length;
                                showMsg(
                                  `✅ AI分析完了！${cnt}歯を更新`
                                );
                                if (upData.image?.id) {
                                  await supabase
                                    .from("patient_images")
                                    .update({
                                      ai_analysis: aiData.analysis,
                                    })
                                    .eq("id", upData.image.id);
                                }
                              } else {
                                showMsg(`❌ 分析失敗: ${aiData.error || "不明なエラー"}`);
                              }
                            } catch (err) {
                              showMsg("❌ エラーが発生");
                              console.error(err);
                            }
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <label className="cursor-pointer">
                        <span className="text-xs font-bold bg-purple-100 text-purple-700 px-3 py-1.5 rounded-lg border border-purple-200 hover:bg-purple-200 inline-block">
                          📤 ファイル選択
                        </span>
                        <input type="file" accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !patient || !record) return;
                            showMsg("📤 アップロード中...");
                            try {
                              const fd = new FormData();
                              fd.append("file", file);
                              fd.append("patient_id", patient.id);
                              fd.append("record_id", record.id);
                              fd.append("image_type", "panorama");
                              const upRes = await fetch(
                                "/api/image-upload",
                                { method: "POST", body: fd }
                              );
                              const upData = await upRes.json();
                              if (!upData.success) {
                                showMsg("❌ アップロード失敗");
                                return;
                              }
                              showMsg("🤖 AI分析中...");
                              const aiRes = await fetch(
                                "/api/xray-analyze",
                                {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    image_base64: upData.image.base64,
                                    patient_id: patient.id,
                                  }),
                                }
                              );
                              const aiData = await aiRes.json();
                              if (aiData.success && aiData.tooth_chart) {
                                const chart = {
                                  ...(record.tooth_chart || {}),
                                };
                                Object.entries(
                                  aiData.tooth_chart
                                ).forEach(([t, s]) => {
                                  if (TOOTH_STATUS[s as string]) {
                                    chart[t] = [s as string];
                                  }
                                });
                                setRecord({
                                  ...record, tooth_chart: chart,
                                });
                                const cnt = Object.keys(
                                  aiData.tooth_chart
                                ).length;
                                showMsg(
                                  `✅ AI分析完了！${cnt}歯を更新`
                                );
                                if (upData.image?.id) {
                                  await supabase
                                    .from("patient_images")
                                    .update({
                                      ai_analysis: aiData.analysis,
                                    })
                                    .eq("id", upData.image.id);
                                }
                              } else {
                                showMsg(`❌ 分析失敗: ${aiData.error || "不明なエラー"}`);
                              }
                            } catch (err) {
                              showMsg("❌ エラーが発生");
                              console.error(err);
                            }
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <p className="text-xs text-purple-500">
                    📸 カメラ: モニターに表示されたレントゲンを直接撮影して分析　|　📤 ファイル: 画像ファイルを選択
                  </p>
                </div>

                {/* ベースラインモード */}
                {baselineMode && (
                  <div className="mb-3 p-3 bg-sky-50 rounded-xl border-2 border-sky-200">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-sky-700">ベースライン記録</span>
                        <span className="text-xs text-sky-500">{baselineIndex + 1} / {ALL_TEETH.length}</span>
                      </div>
                      <button onClick={() => setBaselineMode(false)} className="text-xs text-gray-400 hover:text-gray-600">✕ 終了</button>
                    </div>
                    <p className="text-lg font-bold text-center text-sky-800 mb-2">#{ALL_TEETH[baselineIndex]}（{toothLabel(ALL_TEETH[baselineIndex])}）</p>
                    <div className="flex gap-1.5 flex-wrap justify-center mb-2">
                      {CHECK_STATUSES.map(s => { const cfg = TOOTH_STATUS[s]; return (
                        <button key={s} onClick={() => baselineNext(s)} className={`px-3 py-2 rounded-lg text-xs font-bold border-2 transition-all ${cfg.bg} ${cfg.border} ${cfg.color} hover:scale-105 active:scale-95`}>{cfg.label}</button>
                      ); })}
                    </div>
                    <div className="flex justify-center gap-2">
                      <button onClick={baselinePrev} disabled={baselineIndex === 0} className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-30">← 前の歯</button>
                      <button onClick={() => baselineNext("normal")} className="text-xs text-sky-600 font-bold hover:text-sky-800">スキップ（健全）→</button>
                    </div>
                    <div className="mt-2 bg-gray-100 rounded-full h-1.5"><div className="bg-sky-500 h-1.5 rounded-full transition-all" style={{ width: `${(baselineIndex / ALL_TEETH.length) * 100}%` }} /></div>
                  </div>
                )}

                {checkMode && !baselineMode && (
                  <div className="mb-3 p-2.5 bg-orange-50 rounded-xl border border-orange-200">
                    <p className="text-xs text-orange-600 font-bold mb-2">状態を選んで歯をタップ → 一括記録</p>
                    <div className="flex gap-1.5 flex-wrap">{CHECK_STATUSES.map(s => { const cfg = TOOTH_STATUS[s]; return (<button key={s} onClick={() => setCheckBrush(s)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 ${checkBrush === s ? `${cfg.bg} ${cfg.border} ${cfg.color} ring-2 ring-offset-1 ring-sky-400` : "bg-white border-gray-200 text-gray-500"}`}>{cfg.label}</button>); })}</div>
                  </div>
                )}

                {/* 歯式表示 */}
                <div className="flex justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex items-center gap-0.5"><span className="text-xs text-gray-300 w-6 text-right mr-1">右</span><div className="flex gap-1">{UPPER_RIGHT.map(t => renderTooth(t))}</div><div className="w-px h-10 bg-gray-300 mx-2" /><div className="flex gap-1">{UPPER_LEFT.map(t => renderTooth(t))}</div><span className="text-xs text-gray-300 w-6 ml-1">左</span></div>
                    {dentitionMode === "mixed" && <div className="flex items-center gap-0.5 mt-0.5"><span className="text-xs text-gray-300 w-6 text-right mr-1" /><div className="flex gap-1" style={{ marginLeft: "108px" }}>{DECID_UPPER_RIGHT.map(t => renderTooth(t, true))}</div><div className="w-px h-8 bg-gray-200 mx-2" /><div className="flex gap-1" style={{ marginRight: "108px" }}>{DECID_UPPER_LEFT.map(t => renderTooth(t, true))}</div><span className="text-xs text-gray-300 w-6 ml-1" /></div>}
                    <div className="flex items-center gap-1 my-1" style={{ width: "100%" }}><span className="text-xs text-gray-300 w-6 text-right mr-1" /><div className="flex-1 border-t-2 border-gray-400" /><span className="text-xs text-gray-300 w-6 ml-1" /></div>
                    {dentitionMode === "mixed" && <div className="flex items-center gap-0.5 mb-0.5"><span className="text-xs text-gray-300 w-6 text-right mr-1" /><div className="flex gap-1" style={{ marginLeft: "108px" }}>{DECID_LOWER_RIGHT.map(t => renderTooth(t, true))}</div><div className="w-px h-8 bg-gray-200 mx-2" /><div className="flex gap-1" style={{ marginRight: "108px" }}>{DECID_LOWER_LEFT.map(t => renderTooth(t, true))}</div><span className="text-xs text-gray-300 w-6 ml-1" /></div>}
                    <div className="flex items-center gap-0.5"><span className="text-xs text-gray-300 w-6 text-right mr-1">右</span><div className="flex gap-1">{LOWER_RIGHT.map(t => renderTooth(t))}</div><div className="w-px h-10 bg-gray-300 mx-2" /><div className="flex gap-1">{LOWER_LEFT.map(t => renderTooth(t))}</div><span className="text-xs text-gray-300 w-6 ml-1">左</span></div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-4 justify-center">{Object.entries(TOOTH_STATUS).map(([k, v]) => (<span key={k} className={`text-xs font-bold px-2.5 py-1 rounded-full border ${v.border} ${v.bg} ${v.color}`}>{v.label}</span>))}</div>
                {/* 歯面記録サマリ */}
                {Object.keys(toothSurfaces).filter(t => (toothSurfaces[t] || []).length > 0).length > 0 && (
                  <div className="mt-3 p-3 bg-sky-50 rounded-xl border border-sky-200">
                    <p className="text-xs text-sky-600 font-bold mb-2">🦷 歯面記録（罹患面）</p>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(toothSurfaces).filter(([, surfaces]) => surfaces.length > 0).map(([tooth, surfaces]) => (
                        <span key={tooth} className="bg-white border border-sky-200 px-2 py-1 rounded-lg text-xs font-bold text-sky-700">
                          #{tooth}: {surfaces.join("")} <span className="text-sky-400">({surfaces.length}面{surfaces.length >= 2 ? "・複雑" : "・単純"})</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-4 flex justify-between">
                  <button onClick={() => setActiveTab("chief")} className="text-base text-gray-400 hover:text-gray-600 font-bold">← 主訴確認</button>
                  <button onClick={() => setActiveTab("perio")} className="bg-sky-500 text-white px-8 py-3.5 rounded-xl text-base font-bold hover:bg-sky-600 shadow-md shadow-sky-200">次へ: P検・BOP →</button>
                </div>
              </div>
            )}

            {/* ===== 📊 P検タブ ===== */}
            {activeTab === "perio" && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-gray-700">
                    📊 歯周検査（6点法）
                  </h3>
                  <div className="flex items-center gap-2">
                    {perioSummary.count > 0 && (
                      <div className="flex gap-2 text-xs">
                        <span className={`font-bold px-2 py-0.5 rounded ${
                          perioSummary.bopRate > 30
                            ? "bg-red-100 text-red-600"
                            : "bg-green-100 text-green-600"
                        }`}>
                          BOP {perioSummary.bopRate}%
                        </span>
                        <span className="font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                          PPD≧4mm {perioSummary.d4pct}%
                        </span>
                        <span className="font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                          {perioSummary.count}歯
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded bg-red-500" />
                        BOP(+)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded bg-red-200 border border-red-300" />
                        PPD≧4
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2.5 h-2.5 rounded bg-red-500" />
                        PPD≧6
                      </span>
                    </div>
                  </div>
                </div>

                {/* ===== 🎙 音声P検入力パネル ===== */}
                <div className="mb-4 p-4 bg-sky-50 rounded-xl border-2 border-sky-200">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-sky-700">🎙 音声P検入力</span>
                    <div className="flex items-center gap-2">
                      <select className="text-xs border border-sky-200 rounded-lg px-2 py-1 bg-white font-bold text-sky-700"
                        value={perioProbePoints}
                        onChange={(e) => { setPerioProbePoints(Number(e.target.value)); showMsg(`P検方式: ${e.target.value}点式`); }}>
                        <option value={1}>1点式</option>
                        <option value={4}>4点式</option>
                        <option value={6}>6点式</option>
                      </select>
                      <select className="text-xs border border-sky-200 rounded-lg px-2 py-1 bg-white font-bold text-sky-700"
                        value={perioOrderType}
                        onChange={(e) => { setPerioOrderType(e.target.value); setPerioCurrentIdx(0); setPerioSide("buccal"); }}>
                        <option value="U">コの字</option>
                        <option value="Z">Z型</option>
                        <option value="S">S型</option>
                        <option value="TB">頬→舌(1歯ずつ)</option>
                      </select>
                    </div>
                  </div>
                  {(() => {
                    const chart = record.tooth_chart || {};
                    const excluded = Object.entries(chart)
                      .filter(([, s]) => {
                        const arr = Array.isArray(s) ? s : [s];
                        return arr.includes("missing") || arr.includes("root_remain");
                      })
                      .map(([t]) => t);
                    const ur = UPPER_RIGHT.filter(t => !excluded.includes(t));
                    const ul = UPPER_LEFT.filter(t => !excluded.includes(t));
                    const lr = LOWER_RIGHT.filter(t => !excluded.includes(t));
                    const ll = LOWER_LEFT.filter(t => !excluded.includes(t));
                    let order: string[] = [];
                    if (perioOrderType === "U") order = [...ur, ...ul, ...[...ll].reverse(), ...[...lr].reverse()];
                    else if (perioOrderType === "Z") order = [...ur, ...ul, ...lr, ...ll];
                    else if (perioOrderType === "S") order = [...ur, ...ul, ...[...ll].reverse(), ...[...lr].reverse()];
                    else order = [...ur, ...ul, ...lr, ...ll];
                    const curT = order[perioCurrentIdx] || order[0] || "11";
                    const hasCur = !!perioData[curT];
                    const totalDone = order.filter(t => !!perioData[t]).length;
                    const pct = order.length > 0 ? Math.round((totalDone / order.length) * 100) : 0;
                    return (<div>
                      {excluded.length > 0 && <p className="text-xs text-gray-400 mb-2">除外歯: {excluded.join(", ")}</p>}
                      <div className="mb-3">
                        <div className="flex justify-between mb-1">
                          <span className="text-xs text-sky-600 font-bold">進捗: {totalDone}/{order.length}歯</span>
                          <span className="text-xs text-sky-500">{pct}%</span>
                        </div>
                        <div className="bg-gray-200 rounded-full h-2">
                          <div className="bg-sky-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-3">
                        {order.map((t, i) => {
                          const done = !!perioData[t];
                          const isCur = i === perioCurrentIdx;
                          return (<button key={t} onClick={() => { setPerioCurrentIdx(i); setPerioSide("buccal"); }}
                            className={`text-xs px-1.5 py-1 rounded font-bold transition-all ${
                              isCur ? "bg-sky-500 text-white ring-2 ring-sky-300 scale-110"
                              : done ? "bg-green-100 text-green-700"
                              : "bg-white text-gray-400 border border-gray-200"
                            }`}>{t}{done ? "✓" : ""}</button>);
                        })}
                      </div>
                      <div className="bg-white rounded-xl p-4 border-2 border-sky-300 mb-3">
                        <div className="text-center mb-3">
                          <span className="text-2xl font-bold text-sky-700">#{curT}</span>
                          <span className="text-sm text-gray-400 ml-2">({toothLabel(curT)})</span>
                          {perioOrderType === "TB" && (
                            <span className={`ml-2 text-xs font-bold px-2 py-0.5 rounded-full ${
                              perioSide === "buccal" ? "bg-sky-100 text-sky-700" : "bg-purple-100 text-purple-700"
                            }`}>{perioSide === "buccal" ? "頬側" : "舌側"}</span>
                          )}
                        </div>
                        {hasCur && (<div className="flex justify-center gap-6 mb-3">
                          <div className="text-center">
                            <p className="text-xs text-gray-400 mb-1">頬側(MB/B/DB)</p>
                            <div className="flex gap-1 justify-center">
                              {(perioData[curT]?.buccal || [2,2,2]).map((v, i) => (
                                <span key={i} className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold text-sm ${
                                  v >= 6 ? "bg-red-500 text-white" : v >= 4 ? "bg-red-200 text-red-800" : "bg-gray-100 text-gray-600"
                                }`}>{v}</span>
                              ))}
                            </div>
                          </div>
                          <div className="text-center">
                            <p className="text-xs text-gray-400 mb-1">舌側(ML/L/DL)</p>
                            <div className="flex gap-1 justify-center">
                              {(perioData[curT]?.lingual || [2,2,2]).map((v, i) => (
                                <span key={i} className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold text-sm ${
                                  v >= 6 ? "bg-red-500 text-white" : v >= 4 ? "bg-red-200 text-red-800" : "bg-gray-100 text-gray-600"
                                }`}>{v}</span>
                              ))}
                            </div>
                          </div>
                        </div>)}
                        {/* === リアルタイム音声入力 === */}
                        <div className="mb-3 p-3 bg-green-50 rounded-xl border border-green-200">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-green-700">
                              🎤 リアルタイム音声入力
                            </span>
                            <div className="flex gap-1">
                              <button onClick={() => setPerioVoiceMode(false)}
                                className={`text-xs px-2 py-1 rounded font-bold ${!perioVoiceMode ? "bg-green-500 text-white" : "bg-white text-gray-400 border"}`}>
                                手動
                              </button>
                              <button onClick={() => setPerioVoiceMode(true)}
                                className={`text-xs px-2 py-1 rounded font-bold ${perioVoiceMode ? "bg-green-500 text-white" : "bg-white text-gray-400 border"}`}>
                                音声
                              </button>
                            </div>
                          </div>
                          {perioVoiceMode && (
                            <div>
                              <p className="text-xs text-green-600 mb-2">
                                数字を読み上げると自動入力されます。
                                {perioProbePoints === 1
                                  ? "1つ言うと次の歯へ"
                                  : perioProbePoints === 6
                                    ? "6つ（頬側3+舌側3）言うと次の歯へ"
                                    : "4つ言うと次の歯へ"}
                              </p>
                              {perioInputBuffer.length > 0 && (
                                <div className="flex gap-1 mb-2 items-center">
                                  <span className="text-xs text-gray-400">バッファ:</span>
                                  {perioInputBuffer.map((v, i) => (
                                    <span key={i} className="bg-green-200 text-green-800 text-xs font-bold px-1.5 py-0.5 rounded">{v}</span>
                                  ))}
                                </div>
                              )}
                              <button
                                onClick={() => {
                                  if (perioListening) {
                                    // 停止
                                    const r = perioRecogRef.current as { stop?: () => void } | null;
                                    if (r?.stop) r.stop();
                                    setPerioListening(false);
                                    showMsg("⏹ 音声認識を停止");
                                    return;
                                  }
                                  // 開始
                                  const SR = (window as unknown as Record<string, unknown>).SpeechRecognition
                                    || (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
                                  if (!SR) {
                                    showMsg("❌ このブラウザは音声認識非対応です");
                                    return;
                                  }
                                  const recognition = new (SR as new () => SpeechRecognition)();
                                  recognition.lang = "ja-JP";
                                  recognition.continuous = true;
                                  recognition.interimResults = true;
                                  perioRecogRef.current = recognition;

                                  const numMap: Record<string, number> = {
                                    "いち": 1, "に": 2, "さん": 3, "し": 4, "よん": 4,
                                    "ご": 5, "ろく": 6, "なな": 7, "しち": 7,
                                    "はち": 8, "きゅう": 9, "く": 9, "じゅう": 10,
                                    "1": 1, "2": 2, "3": 3, "4": 4, "5": 5,
                                    "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
                                    "一": 1, "二": 2, "三": 3, "四": 4, "五": 5,
                                    "六": 6, "七": 7, "八": 8, "九": 9, "十": 10,
                                  };
                                  // Patterns to IGNORE (tooth references, not PPD values)
                                  const ignorePatterns = /右上|左上|右下|左下|番|ばん|歯|しか|ミリ|mm/;

                                  let buffer: number[] = [];

                                  recognition.onresult = (event: SpeechRecognitionEvent) => {
                                    for (let i = event.resultIndex; i < event.results.length; i++) {
                                      if (!event.results[i].isFinal) continue;
                                      const text = event.results[i][0].transcript.trim();
                                      
                                      // BOP voice detection: 出血/BOP/プラス/bleeding → set BOP on current tooth & advance
                                      if (/出血|びーおーぴー|BOP|ビーオーピー|プラス|ブリーディング|bleeding/i.test(text)) {
                                        setPerioData(prev => {
                                          const pd = prev[curT] || { buccal: [2,2,2] as [number,number,number], lingual: [2,2,2] as [number,number,number], bop: false, mobility: 0 };
                                          return { ...prev, [curT]: { ...pd, bop: true } };
                                        });
                                        showMsg(`#${curT}: BOP(+) 出血あり`);
                                        setPerioCurrentIdx(prev => { const next = prev + 1; return next < order.length ? next : prev; });
                                        setPerioSide("buccal");
                                        continue;
                                      }
                                      
                                      // Skip if it sounds like a tooth reference (右上7番 etc)
                                      if (ignorePatterns.test(text)) continue;
                                      // テキストから数字を抽出
                                      const words = text.split(/[\s,、。．.]+/);
                                      for (const w of words) {
                                        const cleaned = w.trim();
                                        if (!cleaned) continue;
                                        // Skip 2-digit numbers (likely tooth numbers like 17, 46)
                                        const parsed = parseInt(cleaned);
                                        if (parsed >= 11 && parsed <= 48) continue;
                                        const num = numMap[cleaned] || (parsed >= 1 && parsed <= 10 ? parsed : 0);
                                        if (num >= 1 && num <= 10) {
                                          buffer.push(num);
                                          setPerioInputBuffer([...buffer]);

                                          const needed = perioProbePoints === 1 ? 1
                                            : perioProbePoints === 4 ? 4 : 6;

                                          if (buffer.length >= needed) {
                                            // 必要数に達した → 現在の歯に入力
                                            const vals = buffer.slice(0, needed);
                                            buffer = buffer.slice(needed);
                                            setPerioInputBuffer([...buffer]);

                                            setPerioData(prev => {
                                              const pd = prev[curT] || {
                                                buccal: [2,2,2] as [number,number,number],
                                                lingual: [2,2,2] as [number,number,number],
                                                bop: false, mobility: 0,
                                              };
                                              if (needed === 1) {
                                                const v = vals[0];
                                                return { ...prev, [curT]: {
                                                  ...pd,
                                                  buccal: [v,v,v] as [number,number,number],
                                                  lingual: [v,v,v] as [number,number,number],
                                                }};
                                              } else if (needed === 4) {
                                                return { ...prev, [curT]: {
                                                  ...pd,
                                                  buccal: [vals[0],vals[1],vals[2]] as [number,number,number],
                                                  lingual: [vals[3],vals[3],vals[3]] as [number,number,number],
                                                }};
                                              } else {
                                                return { ...prev, [curT]: {
                                                  ...pd,
                                                  buccal: [vals[0],vals[1],vals[2]] as [number,number,number],
                                                  lingual: [vals[3],vals[4],vals[5]] as [number,number,number],
                                                }};
                                              }
                                            });
                                            // 次の歯へ
                                            setPerioCurrentIdx(prev => {
                                              const next = prev + 1;
                                              return next < order.length ? next : prev;
                                            });
                                            setPerioSide("buccal");
                                          }
                                        }
                                      }
                                    }
                                  };
                                  recognition.onerror = () => {
                                    setPerioListening(false);
                                  };
                                  recognition.onend = () => {
                                    // continuous modeで終了した場合再開
                                    if (perioListening) {
                                      try { recognition.start(); } catch {}
                                    }
                                  };
                                  recognition.start();
                                  setPerioListening(true);
                                  setPerioInputBuffer([]);
                                  showMsg("🎤 音声認識開始 — 数字を読み上げてください");
                                }}
                                className={`w-full py-3 rounded-xl text-sm font-bold transition-all ${
                                  perioListening
                                    ? "bg-red-500 text-white animate-pulse"
                                    : "bg-green-500 text-white hover:bg-green-600"
                                }`}
                              >
                                {perioListening ? "⏹ 音声認識を停止" : "🎤 音声認識を開始"}
                              </button>
                            </div>
                          )}
                        </div>

                        <p className="text-xs text-gray-400 text-center mb-2">タップで数値入力（手動 / 音声の補助用）</p>
                        <div className="flex justify-center gap-1 mb-2">
                          {[1,2,3,4,5,6,7,8,9,10].map(v => (
                            <button key={v} onClick={() => {
                              const pd = perioData[curT] || { buccal: [2,2,2] as [number,number,number], lingual: [2,2,2] as [number,number,number], bop: false, mobility: 0 };
                              if (perioProbePoints === 1) {
                                setPerioData({ ...perioData, [curT]: { ...pd, buccal: [v,v,v] as [number,number,number], lingual: [v,v,v] as [number,number,number] } });
                                showMsg(`#${curT}: ${v}mm`);
                              } else if (perioSide === "buccal") {
                                setPerioData({ ...perioData, [curT]: { ...pd, buccal: [v,v,v] as [number,number,number] } });
                                setPerioSide("lingual");
                                showMsg(`#${curT} 頬側: ${v}mm → 舌側へ`);
                              } else {
                                setPerioData({ ...perioData, [curT]: { ...pd, lingual: [v,v,v] as [number,number,number] } });
                                showMsg(`#${curT} 舌側: ${v}mm`);
                              }
                            }} className={`w-8 h-8 rounded-lg text-xs font-bold border-2 hover:scale-110 ${
                              v >= 6 ? "border-red-400 bg-red-50 text-red-700" : v >= 4 ? "border-orange-300 bg-orange-50 text-orange-700" : "border-gray-200 bg-white text-gray-600"
                            }`}>{v}</button>
                          ))}
                        </div>
                        {/* BOP + 次の歯ボタン */}
                        <div className="flex justify-center gap-2 mb-3">
                          <button onClick={() => {
                            const pd = perioData[curT] || { buccal: [2,2,2] as [number,number,number], lingual: [2,2,2] as [number,number,number], bop: false, mobility: 0 };
                            setPerioData({ ...perioData, [curT]: { ...pd, bop: !pd.bop } });
                            if (!pd.bop) {
                              // BOP ON → 自動で次の歯へ
                              showMsg(`#${curT}: BOP(+) 出血あり`);
                              if (perioCurrentIdx < order.length - 1) { setPerioCurrentIdx(perioCurrentIdx + 1); setPerioSide("buccal"); }
                            } else {
                              showMsg(`#${curT}: BOP(-) 出血なし`);
                            }
                          }} className={`px-4 py-2 rounded-lg text-xs font-bold border-2 ${
                            (perioData[curT]?.bop) ? "bg-red-500 text-white border-red-500" : "bg-white border-red-300 text-red-400"
                          }`}>🩸 {(perioData[curT]?.bop) ? "BOP(+)" : "BOP(-)"}</button>
                          <button onClick={() => {
                            if (perioCurrentIdx < order.length - 1) { setPerioCurrentIdx(perioCurrentIdx + 1); setPerioSide("buccal"); }
                          }} disabled={perioCurrentIdx >= order.length - 1}
                            className="px-4 py-2 rounded-lg text-xs font-bold bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-30">次の歯 →</button>
                        </div>
                        <div className="flex justify-between items-center">
                          <button onClick={() => { if (perioCurrentIdx > 0) { setPerioCurrentIdx(perioCurrentIdx - 1); setPerioSide("buccal"); } }}
                            disabled={perioCurrentIdx === 0} className="text-xs text-gray-400 hover:text-gray-600 font-bold disabled:opacity-30">← 前の歯</button>
                          <span className="text-xs text-gray-400">{perioCurrentIdx + 1} / {order.length}</span>
                          <button onClick={() => { if (perioCurrentIdx < order.length - 1) { setPerioCurrentIdx(perioCurrentIdx + 1); setPerioSide("buccal"); } }}
                            disabled={perioCurrentIdx >= order.length - 1} className="text-xs text-sky-600 hover:text-sky-800 font-bold disabled:opacity-30">次の歯 →</button>
                        </div>
                      </div>
                      <p className="text-xs text-sky-600 mb-2">📌 録音→解析で一括入力もOK</p>
                      <div className="flex gap-2">
                        <button onClick={async () => {
                          if (transcripts.length === 0) { showMsg("⚠️ 先に録音してください"); return; }
                          showMsg("🤖 P検解析中...");
                          try {
                            const full = transcripts.map(t => t.transcript_text).join("\n");
                            const res = await fetch("/api/perio-voice", { method: "POST", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ transcript: full, probe_points: perioProbePoints, excluded_teeth: excluded, exam_order: order, mode: "pocket" }) });
                            const data = await res.json();
                            if (data.success && data.result?.readings) {
                              const np = { ...perioData };
                              for (const r of data.result.readings) {
                                const vl = r.values || [];
                                np[r.tooth] = { buccal: vl.length >= 3 ? [vl[0],vl[1],vl[2]] : [2,2,2], lingual: vl.length >= 6 ? [vl[3],vl[4],vl[5]] : [2,2,2],
                                  bop: np[r.tooth]?.bop || false, mobility: np[r.tooth]?.mobility || 0 };
                              }
                              setPerioData(np); showMsg(`✅ ${data.result.readings.length}歯入力`);
                            } else { showMsg("❌ 解析失敗"); }
                          } catch { showMsg("❌ P検解析エラー"); }
                        }} disabled={transcripts.length === 0}
                          className="flex-1 bg-sky-500 text-white py-2.5 rounded-lg text-xs font-bold hover:bg-sky-600 disabled:opacity-40">🎙 ポケット値を解析</button>
                        <button onClick={async () => {
                          if (transcripts.length === 0) { showMsg("⚠️ 先にBOP録音"); return; }
                          showMsg("🤖 BOP解析中...");
                          try {
                            const full = transcripts.map(t => t.transcript_text).join("\n");
                            const res = await fetch("/api/perio-voice", { method: "POST", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ transcript: full, mode: "bop" }) });
                            const data = await res.json();
                            if (data.success && data.result?.bop_teeth) {
                              const np = { ...perioData };
                              for (const t of data.result.bop_teeth) {
                                np[t] = np[t] ? { ...np[t], bop: true } : { buccal: [2,2,2], lingual: [2,2,2], bop: true, mobility: 0 };
                              }
                              setPerioData(np); showMsg(`✅ BOP ${data.result.bop_teeth.length}箇所`);
                            } else { showMsg("❌ BOP解析失敗"); }
                          } catch { showMsg("❌ BOP解析エラー"); }
                        }} disabled={transcripts.length === 0}
                          className="flex-1 bg-red-500 text-white py-2.5 rounded-lg text-xs font-bold hover:bg-red-600 disabled:opacity-40">🩸 BOP箇所を解析</button>
                      </div>
                    </div>);
                  })()}
                </div>

                {/* 上顎 P検チャート */}
                <div className="text-xs text-gray-400 mb-0.5 ml-10">上顎</div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse min-w-[640px]"><tbody>
                    <tr className="h-5"><td className="text-xs text-gray-400 font-bold w-10 pr-1 text-right">TM</td>
                      {[...UPPER_RIGHT,...UPPER_LEFT].map(t => { const pd = perioData[t]; return <td key={t} className="text-center text-xs"><span className={(pd?.mobility||0)>0?"text-amber-600 font-bold bg-amber-100 px-1 rounded":"text-gray-300"}>{(pd?.mobility||0)>0?pd?.mobility:""}</span></td>; })}
                    </tr>
                    <tr className="h-5"><td className="text-xs text-gray-400 font-bold w-10 pr-1 text-right">EPP</td>
                      {[...UPPER_RIGHT,...UPPER_LEFT].map(t => { const pd = perioData[t]; const isM = hasStatus(record?.tooth_chart||null, t, "missing") || hasStatus(record?.tooth_chart||null, t, "root_remain");
                        return <td key={t} className="text-center px-0">{isM?<span className="text-xs text-gray-300">—</span>:<div className="flex justify-center gap-[1px]">{(pd?.buccal||[]).length>0?(pd?.buccal||[]).map((v,i)=><span key={i} className={`text-xs w-[13px] text-center rounded-sm ${v>=6?"bg-red-500 text-white font-bold":v>=4?"bg-red-200 text-red-800 font-bold":"text-gray-400"}`}>{v}</span>):<span className="text-xs text-gray-300">· · ·</span>}</div>}</td>; })}
                    </tr>
                    <tr><td className="text-xs text-gray-400 font-bold w-10 pr-1 text-right">上顎</td>
                      {[...UPPER_RIGHT,...UPPER_LEFT].map(t => { const primary_st = primaryStatus(record?.tooth_chart||null, t); const cfg = TOOTH_STATUS[primary_st]||TOOTH_STATUS.normal; const pd = perioData[t]; const isM = hasStatus(record?.tooth_chart||null, t, "missing") || hasStatus(record?.tooth_chart||null, t, "root_remain"); const isE = perioEditTooth===t;
                        return <td key={t} className="text-center px-[1px] py-[2px]"><button onClick={()=>setPerioEditTooth(isE?null:t)} className={`w-full min-w-[36px] h-8 rounded border-2 flex flex-col items-center justify-center text-xs font-bold transition-all hover:scale-105 ${isM?"bg-gray-200 border-gray-300 text-gray-400":pd?.bop?"bg-red-50 border-red-300 text-gray-700":primary_st!=="normal"?`${cfg.bg} ${cfg.border} ${cfg.color}`:"bg-white border-gray-200 text-gray-600"} ${isE?"ring-2 ring-sky-400 scale-110":""}`}><span className="text-xs text-gray-400">{t}</span>{primary_st!=="normal"&&<span className="text-[7px]">{cfg.label}</span>}{pd?.bop&&<span className="text-[7px] text-red-500">●</span>}</button></td>; })}
                    </tr>
                    <tr className="h-5"><td className="text-xs text-gray-400 font-bold w-10 pr-1 text-right">EPP</td>
                      {[...UPPER_RIGHT,...UPPER_LEFT].map(t => { const pd = perioData[t]; const isM = hasStatus(record?.tooth_chart||null, t, "missing") || hasStatus(record?.tooth_chart||null, t, "root_remain");
                        return <td key={t} className="text-center px-0">{isM?<span className="text-xs text-gray-300">—</span>:<div className="flex justify-center gap-[1px]">{(pd?.lingual||[]).length>0?(pd?.lingual||[]).map((v,i)=><span key={i} className={`text-xs w-[13px] text-center rounded-sm ${v>=6?"bg-red-500 text-white font-bold":v>=4?"bg-red-200 text-red-800 font-bold":"text-gray-400"}`}>{v}</span>):<span className="text-xs text-gray-300">· · ·</span>}</div>}</td>; })}
                    </tr>
                  </tbody></table>
                </div>

                <div className="my-2 border-t border-gray-200" />

                {/* 下顎 P検チャート */}
                <div className="text-xs text-gray-400 mb-0.5 ml-10">下顎</div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse min-w-[640px]"><tbody>
                    <tr className="h-5"><td className="text-xs text-gray-400 font-bold w-10 pr-1 text-right">EPP</td>
                      {[...LOWER_RIGHT,...LOWER_LEFT].map(t => { const pd = perioData[t]; const isM = hasStatus(record?.tooth_chart||null, t, "missing") || hasStatus(record?.tooth_chart||null, t, "root_remain");
                        return <td key={t} className="text-center px-0">{isM?<span className="text-xs text-gray-300">—</span>:<div className="flex justify-center gap-[1px]">{(pd?.buccal||[]).length>0?(pd?.buccal||[]).map((v,i)=><span key={i} className={`text-xs w-[13px] text-center rounded-sm ${v>=6?"bg-red-500 text-white font-bold":v>=4?"bg-red-200 text-red-800 font-bold":"text-gray-400"}`}>{v}</span>):<span className="text-xs text-gray-300">· · ·</span>}</div>}</td>; })}
                    </tr>
                    <tr><td className="text-xs text-gray-400 font-bold w-10 pr-1 text-right">下顎</td>
                      {[...LOWER_RIGHT,...LOWER_LEFT].map(t => { const primary_st = primaryStatus(record?.tooth_chart||null, t); const cfg = TOOTH_STATUS[primary_st]||TOOTH_STATUS.normal; const pd = perioData[t]; const isM = hasStatus(record?.tooth_chart||null, t, "missing") || hasStatus(record?.tooth_chart||null, t, "root_remain"); const isE = perioEditTooth===t;
                        return <td key={t} className="text-center px-[1px] py-[2px]"><button onClick={()=>setPerioEditTooth(isE?null:t)} className={`w-full min-w-[36px] h-8 rounded border-2 flex flex-col items-center justify-center text-xs font-bold transition-all hover:scale-105 ${isM?"bg-gray-200 border-gray-300 text-gray-400":pd?.bop?"bg-red-50 border-red-300 text-gray-700":primary_st!=="normal"?`${cfg.bg} ${cfg.border} ${cfg.color}`:"bg-white border-gray-200 text-gray-600"} ${isE?"ring-2 ring-sky-400 scale-110":""}`}><span className="text-xs text-gray-400">{t}</span>{primary_st!=="normal"&&<span className="text-[7px]">{cfg.label}</span>}{pd?.bop&&<span className="text-[7px] text-red-500">●</span>}</button></td>; })}
                    </tr>
                    <tr className="h-5"><td className="text-xs text-gray-400 font-bold w-10 pr-1 text-right">EPP</td>
                      {[...LOWER_RIGHT,...LOWER_LEFT].map(t => { const pd = perioData[t]; const isM = hasStatus(record?.tooth_chart||null, t, "missing") || hasStatus(record?.tooth_chart||null, t, "root_remain");
                        return <td key={t} className="text-center px-0">{isM?<span className="text-xs text-gray-300">—</span>:<div className="flex justify-center gap-[1px]">{(pd?.lingual||[]).length>0?(pd?.lingual||[]).map((v,i)=><span key={i} className={`text-xs w-[13px] text-center rounded-sm ${v>=6?"bg-red-500 text-white font-bold":v>=4?"bg-red-200 text-red-800 font-bold":"text-gray-400"}`}>{v}</span>):<span className="text-xs text-gray-300">· · ·</span>}</div>}</td>; })}
                    </tr>
                    <tr className="h-5"><td className="text-xs text-gray-400 font-bold w-10 pr-1 text-right">TM</td>
                      {[...LOWER_RIGHT,...LOWER_LEFT].map(t => { const pd = perioData[t]; return <td key={t} className="text-center text-xs"><span className={(pd?.mobility||0)>0?"text-amber-600 font-bold bg-amber-100 px-1 rounded":"text-gray-300"}>{(pd?.mobility||0)>0?pd?.mobility:""}</span></td>; })}
                    </tr>
                  </tbody></table>
                </div>

                {/* 歯タップ時の個別編集パネル */}
                {perioEditTooth && (() => {
                  const t = perioEditTooth; const pd = perioData[t];
                  if (hasStatus(record?.tooth_chart || null, t, "missing") || hasStatus(record?.tooth_chart || null, t, "root_remain")) { setPerioEditTooth(null); return null; }
                  return (
                    <div className="mt-3 p-3 bg-sky-50 rounded-xl border-2 border-sky-200">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-bold text-sky-700">#{t}（{toothLabel(t)}）</span>
                        <button onClick={() => setPerioEditTooth(null)} className="text-xs text-gray-400 hover:text-gray-600">✕ 閉じる</button>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs text-gray-500 font-bold mb-1">頬側 (MB / B / DB)</p>
                          <div className="flex gap-1">{[0,1,2].map(i => <input key={i} type="number" min={0} max={15} value={pd?.buccal[i] ?? 2} onChange={e => updatePerioPocket(t, "buccal", i, parseInt(e.target.value)||0)} className={`w-10 text-center border-2 rounded-lg py-1 text-sm font-bold ${(pd?.buccal[i]??2)>=6?"bg-red-500 text-white border-red-500":(pd?.buccal[i]??2)>=4?"bg-red-100 text-red-700 border-red-300":"border-gray-200"}`} />)}</div>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 font-bold mb-1">舌側 (ML / L / DL)</p>
                          <div className="flex gap-1">{[0,1,2].map(i => <input key={i} type="number" min={0} max={15} value={pd?.lingual[i] ?? 2} onChange={e => updatePerioPocket(t, "lingual", i, parseInt(e.target.value)||0)} className={`w-10 text-center border-2 rounded-lg py-1 text-sm font-bold ${(pd?.lingual[i]??2)>=6?"bg-red-500 text-white border-red-500":(pd?.lingual[i]??2)>=4?"bg-red-100 text-red-700 border-red-300":"border-gray-200"}`} />)}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 mt-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 font-bold">BOP:</span>
                          <button onClick={() => updatePerio(t, "bop", !(pd?.bop))} className={`px-3 py-1 rounded-lg text-xs font-bold border-2 ${pd?.bop ? "bg-red-500 text-white border-red-500" : "bg-white border-gray-300 text-gray-400"}`}>{pd?.bop ? "(+) 出血あり" : "(-) 出血なし"}</button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 font-bold">動揺:</span>
                          {[0,1,2,3].map(m => <button key={m} onClick={() => updatePerio(t, "mobility", m)} className={`w-7 h-7 rounded-lg text-xs font-bold border-2 ${(pd?.mobility??0)===m ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-500"}`}>{m}</button>)}
                        </div>
                        {/* B13 根分岐部病変 (臼歯のみ) */}
                        {["16","17","18","26","27","28","36","37","38","46","47","48","14","15","24","25","34","35","44","45"].includes(t) && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 font-bold">分岐部:</span>
                            {[0,1,2,3].map(f => <button key={f} onClick={() => updatePerio(t, "furcation", f)} className={`w-7 h-7 rounded-lg text-xs font-bold border-2 ${(pd as Record<string, unknown>)?.furcation===f ? "bg-purple-500 text-white border-purple-500" : "bg-white border-gray-200 text-gray-500"}`}>{f === 0 ? "—" : `F${f}`}</button>)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}
                <div className="mt-4 flex justify-between">
                  <button onClick={() => setActiveTab("tooth")} className="text-base text-gray-400 hover:text-gray-600 font-bold">← 歯式記録</button>
                  <button onClick={() => setActiveTab("dh_record")} className="bg-sky-500 text-white px-8 py-3.5 rounded-xl text-base font-bold hover:bg-sky-600 shadow-md shadow-sky-200">次へ: DH記録 →</button>
                </div>
              </div>
            )}

            {/* ===== 🎙 SOAPタブ → ④ DH記録 ===== */}
            {activeTab === "dh_record" && (
              <div className="space-y-3">
                <div className="bg-sky-50 border border-sky-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-sky-700">
                    📝 Step 4: DH記録 — クリーニング後のO入力・文字起こし
                  </p>
                  <p className="text-xs text-sky-500 mt-1">
                    患者さんにフィードバックする内容を音声で記録 → O欄に反映
                  </p>
                </div>

                {/* Step1で確定したS表示 */}
                {record.soap_s && (
                  <div className="bg-red-50 rounded-xl border border-red-200 p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="bg-red-500 text-white text-sm font-bold w-7 h-7 rounded flex items-center justify-center">S</span>
                      <span className="text-xs font-bold text-red-600">確定済みの主訴</span>
                    </div>
                    <p className="text-sm text-gray-700">{record.soap_s}</p>
                  </div>
                )}

                {/* 予定処置パネル（再診時） */}
                {isReturning && hasPreviousPlan && !quickSoapApplied && visitCondition === "" && (
                  <div className="bg-white rounded-xl border-2 border-purple-200 p-4">
                    <div className="flex items-center gap-2 mb-3"><span className="text-lg">📋</span><h3 className="text-sm font-bold text-gray-900">今日の予定処置</h3><span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-bold">前回 {formatDateJP(previousVisit!.date)} より</span></div>
                    {previousVisit!.soap_a && <div className="bg-gray-50 rounded-lg px-3 py-2 mb-3"><p className="text-xs text-gray-400 font-bold mb-0.5">前回の診断</p><p className="text-sm text-gray-700">{previousVisit!.soap_a}</p></div>}
                    <div className="space-y-1.5 mb-4">{plannedProcedures.map((proc, idx) => (<button key={idx} onClick={() => togglePlannedProcedure(idx)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border-2 text-left ${proc.checked ? "border-purple-300 bg-purple-50" : "border-gray-200 bg-white"}`}><span className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold border-2 flex-shrink-0 ${proc.checked ? "bg-purple-500 border-purple-500 text-white" : "border-gray-300 text-transparent"}`}>✓</span><span className={`text-sm font-bold ${proc.checked ? "text-gray-800" : "text-gray-400 line-through"}`}>{proc.name}</span></button>))}</div>
                    <div className="flex gap-2"><button onClick={applyQuickSOAP} disabled={plannedProcedures.filter(p => p.checked).length === 0} className="flex-1 bg-green-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-50">✅ 予定通り完了</button><button onClick={() => setVisitCondition("changed")} className="flex-1 bg-orange-50 text-orange-700 border-2 border-orange-200 py-3 rounded-xl text-sm font-bold hover:bg-orange-100">⚠️ 変化あり</button></div>
                  </div>
                )}
                {isReturning && visitCondition === "changed" && !quickSoapApplied && (
                  <div className="bg-white rounded-xl border-2 border-orange-200 p-4">
                    <div className="flex items-center gap-2 mb-3"><span className="text-lg">⚠️</span><h3 className="text-sm font-bold text-gray-900">変化の内容</h3></div>
                    <textarea value={changeNote} onChange={e => setChangeNote(e.target.value)} placeholder="例: 前回治療した歯が痛む" rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 resize-none mb-3" />
                    <div className="flex gap-2"><button onClick={applyChangeNote} disabled={!changeNote.trim()} className="flex-1 bg-orange-500 text-white py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">S欄に反映</button><button onClick={() => { setVisitCondition(""); setChangeNote(""); }} className="px-4 bg-gray-100 text-gray-500 py-2.5 rounded-xl text-sm font-bold">戻る</button></div>
                  </div>
                )}
                {quickSoapApplied && <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-lg">✅</span><p className="text-sm font-bold text-green-800">予定処置のSOAP自動入力済み</p></div><button onClick={() => { setQuickSoapApplied(false); setVisitCondition(""); }} className="text-xs text-green-600 hover:text-green-800 font-bold px-2 py-1 rounded hover:bg-green-100">やり直す</button></div>}

                {/* ===== Step4専用録音 → O自動入力 ===== */}
                <div className="bg-blue-50 rounded-xl border-2 border-blue-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-blue-700">🎤 DH専用録音 → O欄自動入力</span>
                    {stepTranscript && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">文字起こし済</span>}
                  </div>
                  <p className="text-xs text-blue-500 mb-3">患者さんへのフィードバックを話すだけでO欄に自動入力されます</p>

                  {stepTranscript && (
                    <div className="bg-white rounded-lg p-3 mb-3 border border-blue-100">
                      <p className="text-xs text-gray-400 font-bold mb-1">文字起こし結果</p>
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">{stepTranscript}</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={async () => {
                      if (stepRecording) {
                        // 停止
                        if (stepRecorder) stepRecorder.stop();
                        setStepRecording(false);
                        return;
                      }
                      // 録音開始
                      try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
                        const chunks: Blob[] = [];
                        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
                        recorder.onstop = async () => {
                          stream.getTracks().forEach(t => t.stop());
                          const blob = new Blob(chunks, { type: "audio/webm" });
                          showMsg("🤖 文字起こし中...");
                          try {
                            const tokenRes = await fetch("/api/whisper-token");
                            const { key: token } = await tokenRes.json();
                            const fd = new FormData();
                            fd.append("file", blob, "dh_record.webm");
                            fd.append("model", "whisper-1");
                            fd.append("language", "ja");
                            const wRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                              method: "POST",
                              headers: { Authorization: `Bearer ${token}` },
                              body: fd,
                            });
                            const wData = await wRes.json();
                            const text = wData.text || "";
                            setStepTranscript(text);
                            showMsg("✅ 文字起こし完了");
                          } catch (err) {
                            showMsg("❌ 文字起こしエラー");
                            console.error(err);
                          }
                        };
                        recorder.start();
                        setStepRecorder(recorder);
                        setStepRecording(true);
                        setStepTranscript("");
                        showMsg("🎤 DH録音開始...");
                      } catch (err) {
                        showMsg("❌ マイクアクセスエラー");
                        console.error(err);
                      }
                    }} className={`flex-1 py-3 rounded-xl text-sm font-bold ${
                      stepRecording ? "bg-red-500 text-white animate-pulse" : "bg-blue-500 text-white hover:bg-blue-600"
                    }`}>
                      {stepRecording ? "⏹ 録音停止" : "🎤 DH録音開始"}
                    </button>

                    <button onClick={async () => {
                      if (!stepTranscript) { showMsg("⚠️ 先に録音してください"); return; }
                      setStepAnalyzing(true);
                      showMsg("🤖 O欄を分析中...");
                      try {
                        const res = await fetch("/api/step-analyze", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            step: "dh_record",
                            transcript: stepTranscript,
                            existing_soap: { s: record.soap_s || "" },
                            tooth_chart: record.tooth_chart,
                            perio_summary: perioSummary,
                          }),
                        });
                        const data = await res.json();
                        if (data.success && data.result) {
                          const o = data.result.soap_o || "";
                          if (o) {
                            updateSOAP("soap_o", o);
                            showMsg("✅ O欄を自動入力しました");
                          }
                        } else {
                          showMsg("❌ 分析失敗: " + (data.error || ""));
                        }
                      } catch (e) {
                        showMsg("❌ 分析エラー");
                        console.error(e);
                      }
                      setStepAnalyzing(false);
                    }} disabled={!stepTranscript || stepAnalyzing}
                      className="flex-1 bg-purple-500 text-white py-3 rounded-xl text-sm font-bold hover:bg-purple-600 disabled:opacity-40">
                      {stepAnalyzing ? "⚙️ 分析中..." : "🤖 O欄を自動生成"}
                    </button>
                  </div>
                </div>

                {/* 口腔内写真5枚法 */}
                <div className="bg-white rounded-2xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-gray-700">📷 口腔内写真（5枚法）</span>
                    <span className="text-xs text-gray-400">{Object.keys(intraoralPhotos).length}/5 撮影済</span>
                  </div>
                  <div className="grid grid-cols-5 gap-2">
                    {([
                      { key: "intraoral_front", label: "正面観", icon: "😁" },
                      { key: "intraoral_upper", label: "上顎咬合面", icon: "⬆️" },
                      { key: "intraoral_lower", label: "下顎咬合面", icon: "⬇️" },
                      { key: "intraoral_right", label: "右側方", icon: "➡️" },
                      { key: "intraoral_left", label: "左側方", icon: "⬅️" },
                    ] as const).map(photo => {
                      const existing = intraoralPhotos[photo.key];
                      return (
                        <div key={photo.key} className="flex flex-col items-center">
                          <div className={`w-full aspect-square rounded-xl border-2 flex items-center justify-center overflow-hidden ${existing ? "border-green-300 bg-green-50" : "border-dashed border-gray-300 bg-gray-50"}`}>
                            {existing ? (
                              <img src={existing.url} alt={photo.label} className="w-full h-full object-cover rounded-lg" />
                            ) : (
                              <span className="text-2xl">{photo.icon}</span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 font-bold mt-1 text-center">{photo.label}</p>
                          <label className="cursor-pointer mt-1">
                            <span className={`text-xs font-bold px-2 py-1 rounded-lg inline-block ${existing ? "bg-green-100 text-green-600 border border-green-200" : "bg-sky-500 text-white"}`}>
                              {existing ? "✓ 撮り直し" : "📸 撮影"}
                            </span>
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file || !patient || !record) return;
                              showMsg(`📤 ${photo.label}アップロード中...`);
                              try {
                                const fd = new FormData();
                                fd.append("file", file);
                                fd.append("patient_id", patient.id);
                                fd.append("record_id", record.id);
                                fd.append("image_type", photo.key);
                                const res = await fetch("/api/image-upload", { method: "POST", body: fd });
                                const data = await res.json();
                                if (data.success && data.image) {
                                  setIntraoralPhotos(prev => ({ ...prev, [photo.key]: { url: data.image.url || data.image.image_url || data.image.public_url, id: data.image.id } }));
                                  showMsg(`✅ ${photo.label}を保存しました`);
                                } else { showMsg(`❌ ${data.error || "アップロード失敗"}`); }
                              } catch { showMsg("❌ エラーが発生"); }
                              e.target.value = "";
                            }} />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* S, O入力 */}
                <div className="grid grid-cols-2 gap-3">
                  {[soapItems[0], soapItems[1]].map(item => (
                    <div key={item.key} className={`bg-white rounded-xl border ${item.borderColor} overflow-hidden`}>
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100"><span className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center text-white ${item.color}`}>{item.label}</span><span className="text-sm font-bold text-gray-700">{item.title}</span>{record[item.key] && <span className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}</div>
                      <textarea value={record[item.key] || ""} onChange={e => updateSOAP(item.key, e.target.value)} placeholder={item.placeholder} rows={5} className="w-full px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none resize-none leading-relaxed" />
                    </div>
                  ))}
                </div>

                {/* ナビ */}
                <div className="flex justify-between">
                  <button onClick={() => setActiveTab("perio")} className="text-base text-gray-400 hover:text-gray-600 font-bold">← P検・BOP</button>
                  <button onClick={() => setActiveTab("dr_exam")} className="bg-orange-500 text-white px-8 py-3.5 rounded-xl text-base font-bold hover:bg-orange-600 shadow-md shadow-orange-200">🩺 Dr引継ぎ →</button>
                </div>
              </div>
            )}

            {/* ===== ⑤ Dr診察 ===== */}
            {activeTab === "dr_exam" && (
              <div className="space-y-3">
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-orange-700">
                    🩺 Step 5: Dr診察 — 治療後のまとめ・A,P入力
                  </p>
                  <p className="text-xs text-orange-500 mt-1">
                    患者さんに行った内容のまとめを音声で記録 → A(評価)・P(計画)に反映
                  </p>
                </div>

                {/* DH引継ぎサマリ */}
                <div className="bg-white rounded-xl border-2 border-sky-200 p-4">
                  <h4 className="text-xs font-bold text-sky-600 mb-2">📋 DHからの引継ぎ</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="font-bold text-red-500">S:</span>
                      <span className="text-gray-600 ml-1">{record.soap_s || "未入力"}</span>
                    </div>
                    <div>
                      <span className="font-bold text-blue-500">O:</span>
                      <span className="text-gray-600 ml-1">{record.soap_o || "未入力"}</span>
                    </div>
                  </div>
                  {perioSummary.count > 0 && (
                    <div className="mt-2 flex gap-2 text-xs">
                      <span className={`font-bold px-2 py-0.5 rounded ${perioSummary.bopRate > 30 ? "bg-red-100 text-red-600" : "bg-green-100 text-green-600"}`}>BOP {perioSummary.bopRate}%</span>
                      <span className="font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600">PPD≧4mm {perioSummary.d4pct}%</span>
                      <span className="font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600">{perioSummary.count}歯測定</span>
                    </div>
                  )}
                  {Object.keys(chartStats).length > 0 && (
                    <div className="mt-2 flex gap-1 flex-wrap">
                      {Object.entries(chartStats).map(([s, c]) => (
                        <span key={s} className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${TOOTH_STATUS[s]?.bg} ${TOOTH_STATUS[s]?.color} ${TOOTH_STATUS[s]?.border} border`}>{TOOTH_STATUS[s]?.label} {c}</span>
                      ))}
                    </div>
                  )}
                </div>

                {/* ===== Step5専用録音 → A,P自動入力 ===== */}
                <div className="bg-orange-50 rounded-xl border-2 border-orange-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-orange-700">🎤 Dr専用録音 → A,P欄自動入力</span>
                    {stepTranscript && activeTab === "dr_exam" && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-bold">文字起こし済</span>}
                  </div>
                  <p className="text-xs text-orange-500 mb-3">患者さんへのフィードバックを話すだけでA(評価)・P(計画)に自動入力されます</p>

                  {stepTranscript && activeTab === "dr_exam" && (
                    <div className="bg-white rounded-lg p-3 mb-3 border border-orange-100">
                      <p className="text-xs text-gray-400 font-bold mb-1">文字起こし結果</p>
                      <p className="text-xs text-gray-700 whitespace-pre-wrap">{stepTranscript}</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={async () => {
                      if (stepRecording) {
                        if (stepRecorder) stepRecorder.stop();
                        setStepRecording(false);
                        return;
                      }
                      try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
                        const chunks: Blob[] = [];
                        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
                        recorder.onstop = async () => {
                          stream.getTracks().forEach(t => t.stop());
                          const blob = new Blob(chunks, { type: "audio/webm" });
                          showMsg("🤖 文字起こし中...");
                          try {
                            const tokenRes = await fetch("/api/whisper-token");
                            const { key: token } = await tokenRes.json();
                            const fd = new FormData();
                            fd.append("file", blob, "dr_exam.webm");
                            fd.append("model", "whisper-1");
                            fd.append("language", "ja");
                            const wRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
                              method: "POST",
                              headers: { Authorization: `Bearer ${token}` },
                              body: fd,
                            });
                            const wData = await wRes.json();
                            setStepTranscript(wData.text || "");
                            showMsg("✅ 文字起こし完了");
                          } catch (err) {
                            showMsg("❌ 文字起こしエラー");
                            console.error(err);
                          }
                        };
                        recorder.start();
                        setStepRecorder(recorder);
                        setStepRecording(true);
                        setStepTranscript("");
                        showMsg("🎤 Dr録音開始...");
                      } catch (err) {
                        showMsg("❌ マイクアクセスエラー");
                        console.error(err);
                      }
                    }} className={`flex-1 py-3 rounded-xl text-sm font-bold ${
                      stepRecording ? "bg-red-500 text-white animate-pulse" : "bg-orange-500 text-white hover:bg-orange-600"
                    }`}>
                      {stepRecording ? "⏹ 録音停止" : "🎤 Dr録音開始"}
                    </button>

                    <button onClick={async () => {
                      if (!stepTranscript) { showMsg("⚠️ 先に録音してください"); return; }
                      setStepAnalyzing(true);
                      showMsg("🤖 A,P欄を分析中...");
                      try {
                        const res = await fetch("/api/step-analyze", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            step: "dr_exam",
                            transcript: stepTranscript,
                            existing_soap: {
                              s: record.soap_s || "",
                              o: record.soap_o || "",
                            },
                            tooth_chart: record.tooth_chart,
                            perio_summary: perioSummary,
                          }),
                        });
                        const data = await res.json();
                        if (data.success && data.result) {
                          const r = data.result;
                          if (r.soap_a) updateSOAP("soap_a", r.soap_a);
                          if (r.soap_p) updateSOAP("soap_p", r.soap_p);
                          showMsg("✅ A,P欄を自動入力しました");
                        } else {
                          showMsg("❌ 分析失敗: " + (data.error || ""));
                        }
                      } catch (e) {
                        showMsg("❌ 分析エラー");
                        console.error(e);
                      }
                      setStepAnalyzing(false);
                    }} disabled={!stepTranscript || stepAnalyzing}
                      className="flex-1 bg-purple-500 text-white py-3 rounded-xl text-sm font-bold hover:bg-purple-600 disabled:opacity-40">
                      {stepAnalyzing ? "⚙️ 分析中..." : "🤖 A,P欄を自動生成"}
                    </button>
                  </div>
                </div>

                {/* AI プレビュー */}
                {showAiPreview && aiResult && (
                  <div className="bg-purple-50 border-2 border-purple-300 rounded-xl p-4">
                    <h4 className="text-sm font-bold text-purple-700 mb-3">🤖 AI SOAP生成結果</h4>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      <div className="bg-white rounded-lg p-2"><span className="font-bold text-red-500">S:</span> {aiResult.soap.s}</div>
                      <div className="bg-white rounded-lg p-2"><span className="font-bold text-blue-500">O:</span> {aiResult.soap.o}</div>
                      <div className="bg-white rounded-lg p-2"><span className="font-bold text-yellow-600">A:</span> {aiResult.soap.a}</div>
                      <div className="bg-white rounded-lg p-2"><span className="font-bold text-green-500">P:</span> {aiResult.soap.p}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={applyAiResult} className="flex-1 bg-purple-600 text-white py-2.5 rounded-xl text-xs font-bold">✅ SOAPに反映</button>
                      <button onClick={() => setShowAiPreview(false)} className="px-4 bg-gray-100 text-gray-500 py-2.5 rounded-xl text-xs font-bold">キャンセル</button>
                    </div>
                  </div>
                )}

                {/* A, P入力 */}
                <div className="grid grid-cols-2 gap-3">
                  {[soapItems[2], soapItems[3]].map(item => (
                    <div key={item.key} className={`bg-white rounded-xl border ${item.borderColor} overflow-hidden`}>
                      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100"><span className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center text-white ${item.color}`}>{item.label}</span><span className="text-sm font-bold text-gray-700">{item.title}</span>{record[item.key] && <span className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}</div>
                      <textarea value={record[item.key] || ""} onChange={e => updateSOAP(item.key, e.target.value)} placeholder={item.placeholder} rows={5} className="w-full px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none resize-none leading-relaxed" />
                    </div>
                  ))}
                </div>

                {/* ナビ */}
                <div className="flex justify-between">
                  <button onClick={() => setActiveTab("dh_record")} className="text-base text-gray-400 hover:text-gray-600 font-bold">← DH記録</button>
                  <button onClick={() => setActiveTab("confirm")} className="bg-green-600 text-white px-6 py-2.5 rounded-xl text-sm font-bold hover:bg-green-700 shadow-md shadow-green-200">確定画面へ →</button>
                </div>
              </div>
            )}

            {/* ===== ⑥ 確定 ===== */}
            {activeTab === "confirm" && (
              <div className="space-y-3">
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <p className="text-xs font-bold text-green-700">
                    ✅ Step 6: 確定 — 算定プレビュー・確認・カルテ確定
                  </p>
                </div>

                {/* SOAP最終確認 */}
                <div className="bg-white rounded-2xl border border-gray-200 p-6">
                  <h4 className="text-sm font-bold text-gray-900 mb-3">📋 SOAP最終確認</h4>
                  <div className="grid grid-cols-2 gap-3">
                    {soapItems.map(item => (
                      <div key={item.key} className={`bg-white rounded-xl border ${item.borderColor} overflow-hidden`}>
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100"><span className={`w-6 h-6 rounded-md text-xs font-bold flex items-center justify-center text-white ${item.color}`}>{item.label}</span><span className="text-sm font-bold text-gray-700">{item.title}</span>{record[item.key] && <span className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}</div>
                        <textarea value={record[item.key] || ""} onChange={e => updateSOAP(item.key, e.target.value)} placeholder={item.placeholder} rows={3} className="w-full px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none resize-none leading-relaxed" />
                      </div>
                    ))}
                  </div>
                </div>

                {/* 算定プレビュー */}
                <div className="bg-white rounded-2xl border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-gray-700">📋 算定プレビュー</h3>
                    <div className="flex items-center gap-2">
                      {billingTotal > 0 && <span className="text-sm font-bold text-sky-600 bg-sky-50 px-3 py-1 rounded-full">合計 {billingTotal.toLocaleString()}点</span>}
                      <button onClick={runBillingPreview} disabled={previewLoading} className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-blue-700 disabled:opacity-50">
                        {previewLoading ? "🔄 分析中..." : previewDone ? "🔄 再分析" : "🔍 算定プレビュー"}
                      </button>
                    </div>
                  </div>

                  {/* マッチした治療パターン */}
                  {matchedProcedures.length > 0 && (
                    <div className="mb-3 p-2 bg-blue-50 rounded-lg">
                      <p className="text-xs font-bold text-blue-700 mb-1">🔍 検出した処置</p>
                      <div className="flex flex-wrap gap-1">
                        {matchedProcedures.map((p, i) => <span key={i} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">{p}</span>)}
                      </div>
                    </div>
                  )}

                  {/* 警告 */}
                  {previewWarnings.length > 0 && (
                    <div className="mb-3 space-y-1">
                      {previewWarnings.map((w, i) => <div key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">{w}</div>)}
                    </div>
                  )}

                  {billingItems.length === 0
                    ? <div className="text-center py-6"><p className="text-xs text-gray-400">{previewLoading ? "分析中..." : "「算定プレビュー」を押してSOAPから算定項目を自動検出します"}</p></div>
                    : <div className="space-y-1">
                      <div className="flex items-center px-2 py-1 text-xs text-gray-400 font-bold border-b border-gray-100"><span className="w-20">コード</span><span className="flex-1">項目名</span><span className="w-14 text-right">点数</span><span className="w-12 text-center">回数</span><span className="w-14 text-right">小計</span><span className="w-8"></span></div>
                      {billingItems.map((item, idx) => (
                        <div key={idx} className="flex items-center px-2 py-1.5 rounded-lg hover:bg-gray-50 text-xs group">
                          <span className="w-20 text-gray-400 font-mono text-xs truncate">{item.code}</span>
                          <span className="flex-1 text-gray-700 font-bold">{item.name}{item.tooth && <span className="text-xs text-gray-400 ml-1">({item.tooth})</span>}</span>
                          <span className="w-14 text-right text-gray-600">{item.points}</span>
                          <span className="w-12 text-center">
                            <input type="number" min="1" max="99" value={item.count} onChange={e => updateBillingItemCount(idx, parseInt(e.target.value) || 1)} className="w-10 text-center text-xs border border-gray-200 rounded px-1 py-0.5" />
                          </span>
                          <span className="w-14 text-right font-bold text-gray-800">{(item.points * item.count).toLocaleString()}</span>
                          <button onClick={() => removeBillingItem(idx)} className="w-8 text-center text-red-400 opacity-0 group-hover:opacity-100 hover:text-red-600 font-bold">✕</button>
                        </div>
                      ))}
                      <div className="flex items-center px-2 py-2 border-t-2 border-gray-300 mt-1"><span className="flex-1 text-sm font-bold text-gray-800">合計</span><span className="text-sm font-bold text-sky-600">{billingTotal.toLocaleString()}点</span><span className="text-xs text-gray-400 ml-2">(¥{Math.round(billingTotal * 10 * patient.burden_ratio).toLocaleString()})</span></div>
                    </div>
                  }

                  {/* 手動追加 */}
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <div className="relative">
                      <input type="text" value={feeSearchQuery} onChange={e => searchFeeItems(e.target.value)} placeholder="＋ 項目を手動追加（名前やコードで検索）" className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-blue-400" />
                      {feeSearchResults.length > 0 && (
                        <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-48 overflow-y-auto mt-1">
                          {feeSearchResults.map((r, i) => (
                            <button key={i} onClick={() => addFeeItem(r)} className="w-full text-left px-3 py-2 hover:bg-blue-50 text-xs border-b border-gray-50 flex justify-between">
                              <span className="text-gray-700 font-bold">{r.name}</span>
                              <span className="text-gray-400">{r.points}pt</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* AI処方提案 (AI09) */}
                <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-blue-700">🤖 AI処方提案</h3>
                      <p className="text-xs text-blue-500 mt-0.5">SOAP内容から適切な処方薬を提案します</p>
                    </div>
                    <button onClick={async () => {
                      showMsg("🤖 処方提案を生成中...");
                      try {
                        const tokenRes = await fetch("/api/whisper-token"); const tk = await tokenRes.json();
                        if (!tk.key) { showMsg("❌ APIキー取得失敗"); return; }
                        const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
                          method: "POST",
                          headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk.key}` },
                          body: JSON.stringify({
                            model: "gpt-4o-mini",
                            messages: [
                              { role: "system", content: `歯科医師として、SOAP内容から処方薬を提案してください。JSON形式で出力:
{"drugs":[{"name":"薬名","dosage":"用量","frequency":"用法","days":"日数","reason":"処方理由"}],"notes":"注意事項"}
一般的な歯科処方: ロキソプロフェン60mg(鎮痛), カロナール200mg(妊婦可), フロモックス100mg(感染予防), アモキシシリン250mg(感染), レバミピド100mg(胃保護), アズノール(うがい薬)
アレルギー情報を必ず考慮し、禁忌がある場合は代替薬を提案。` },
                              { role: "user", content: `S: ${record?.soap_s || ""}\nO: ${record?.soap_o || ""}\nA: ${record?.soap_a || ""}\nP: ${record?.soap_p || ""}\nアレルギー: ${patient ? JSON.stringify(patient.allergies) : "不明"}` }
                            ],
                            temperature: 0.2, max_tokens: 1000, response_format: { type: "json_object" },
                          }),
                        });
                        if (aiRes.ok) {
                          const data = await aiRes.json();
                          const content = JSON.parse(data.choices?.[0]?.message?.content || "{}");
                          if (content.drugs?.length > 0) {
                            const drugText = content.drugs.map((d: { name: string; dosage: string; frequency: string; days: string; reason: string }) =>
                              `${d.name} ${d.dosage} ${d.frequency} ${d.days} (${d.reason})`).join("\n");
                            const msg = `処方提案:\n${drugText}${content.notes ? "\n\n注意: " + content.notes : ""}`;
                            if (confirm(msg + "\n\nP欄に反映しますか？")) {
                              const curP = record?.soap_p || "";
                              updateSOAP("soap_p", curP + (curP ? "\n" : "") + "【処方】\n" + drugText);
                              showMsg("✅ P欄に反映しました");
                            }
                          } else { showMsg("💊 処方不要と判断されました"); }
                        } else { showMsg("❌ AI提案失敗"); }
                      } catch { showMsg("❌ エラーが発生"); }
                    }} className="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-blue-700">
                      💊 処方を提案
                    </button>
                  </div>
                </div>

                {/* 処方箋印刷 */}
                {billingItems.some(i => i.code.startsWith("DRUG-") || i.code.startsWith("MED-") || i.name.includes("処方") || i.name.includes("薬") || i.name.includes("錠") || i.name.includes("カプセル") || i.name.includes("うがい") || i.name.includes("軟膏")) && (
                  <div className="bg-green-50 rounded-xl border border-green-200 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-green-700">💊 処方箋</h3>
                        <p className="text-xs text-green-500 mt-0.5">
                          {billingItems.filter(i => i.code.startsWith("DRUG-") || i.code.startsWith("MED-") || i.name.includes("錠") || i.name.includes("カプセル") || i.name.includes("うがい") || i.name.includes("軟膏")).length}品目の処方あり
                        </p>
                      </div>
                      <button onClick={() => {
                        const drugItems = billingItems.filter(i =>
                          i.code.startsWith("DRUG-") || i.code.startsWith("MED-") ||
                          i.name.includes("錠") || i.name.includes("カプセル") ||
                          i.name.includes("うがい") || i.name.includes("軟膏") || i.name.includes("頓服")
                        );
                        const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" });
                        const dob = patient ? new Date(patient.date_of_birth).toLocaleDateString("ja-JP") : "";
                        const age = patient ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)) : 0;
                        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>処方箋</title>
<style>@media print{.no-print{display:none!important}@page{size:A5 landscape;margin:8mm}}body{font-family:"Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif;max-width:600px;margin:0 auto;padding:15px;font-size:11px;color:#333}h1{text-align:center;font-size:16px;border:2px solid #333;padding:6px;margin-bottom:12px}table{width:100%;border-collapse:collapse;margin-bottom:10px}td,th{border:1px solid #999;padding:4px 8px;text-align:left;font-size:10px}th{background:#f5f5f5;width:90px;font-weight:bold}.drug-row{font-size:12px;font-weight:bold}.section{font-weight:bold;background:#e8f5e9;color:#2e7d32}.sig{margin-top:15px;text-align:right;font-size:10px}</style></head><body>
<div class="no-print" style="text-align:center;margin-bottom:12px"><button onclick="window.print()" style="padding:8px 24px;font-size:13px;background:#2e7d32;color:#fff;border:none;border-radius:6px;cursor:pointer">🖨️ 印刷する</button><button onclick="window.close()" style="padding:8px 16px;font-size:11px;background:#eee;border:none;border-radius:6px;cursor:pointer;margin-left:6px">閉じる</button></div>
<h1>処 方 箋</h1>
<table>
<tr><th>交付年月日</th><td>${today}</td><th>処方箋の使用期間</th><td>交付日含め4日以内</td></tr>
<tr><th>患者氏名</th><td>${patient?.name_kanji || ""} 様</td><th>生年月日・年齢</th><td>${dob}（${age}歳）</td></tr>
<tr><th>保険種別</th><td>${patient?.insurance_type || ""}</td><th>負担割合</th><td>${Math.round((patient?.burden_ratio || 0.3) * 100)}%</td></tr>
</table>
<table>
<tr class="section"><td colspan="5">■ 処方内容</td></tr>
<tr><th>No.</th><th>薬剤名</th><th>用法</th><th>用量</th><th>日数</th></tr>
${drugItems.map((d, i) => {
  const isAntibiotic = d.name.includes("シリン") || d.name.includes("フロモックス") || d.name.includes("メイアクト") || d.name.includes("ジスロマック") || d.name.includes("クラリス");
  const isPainkiller = d.name.includes("ロキソ") || d.name.includes("ボルタレン") || d.name.includes("カロナール") || d.name.includes("セレコックス");
  const isGargle = d.name.includes("うがい") || d.name.includes("ガーグル") || d.name.includes("アズノール");
  const isOintment = d.name.includes("軟膏") || d.name.includes("デキサ");
  const usage = isAntibiotic ? "毎食後" : isPainkiller ? "疼痛時" : isGargle ? "1日3〜4回含嗽" : isOintment ? "1日2〜4回患部塗布" : "指示通り";
  const dose = isAntibiotic ? "1回1錠" : isPainkiller ? "1回1錠" : isGargle ? "適量" : isOintment ? "適量" : "1回1錠";
  const days = isAntibiotic ? "3日分" : isPainkiller ? "3日分（頓服）" : isGargle ? "1本" : isOintment ? "1本" : `${d.count}日分`;
  return `<tr class="drug-row"><td style="text-align:center">${i + 1}</td><td>${d.name}</td><td>${usage}</td><td>${dose}</td><td>${days}</td></tr>`;
}).join("")}
</table>
<table>
<tr><th>備考</th><td>${(record?.soap_p || "").includes("抗菌薬") ? "抗菌薬は用法用量を守り、必ず飲みきってください。" : ""}</td></tr>
</table>
<div class="sig"><p>医療機関名: ______________________</p><p style="margin-top:6px">歯科医師: ______________________ 印</p></div>
</body></html>`;
                        const pw = window.open("", "_blank");
                        if (pw) { pw.document.write(html); pw.document.close(); }
                      }} className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-xs font-bold hover:bg-green-700 shadow-md shadow-green-200">
                        🖨️ 処方箋を印刷
                      </button>
                    </div>
                  </div>
                )}

                {/* ===== 🤖 治療計画書の自動生成 ===== */}
                <div className="bg-purple-50 rounded-xl border-2 border-purple-200 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-purple-700">📋 治療計画書の自動生成</h4>
                    <button
                      onClick={async () => {
                        setGeneratingPlan(true);
                        showMsg("🤖 治療計画書を生成中...");
                        try {
                          const res = await fetch("/api/step-analyze", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              step: "treatment_plan",
                              transcript: "",
                              context: {
                                soap: {
                                  s: record.soap_s || "",
                                  o: record.soap_o || "",
                                  a: record.soap_a || "",
                                  p: record.soap_p || "",
                                },
                                tooth_chart: record.tooth_chart || {},
                                perio_summary: perioSummary,
                                perio_data: perioData,
                                patient: {
                                  name: patient.name_kanji,
                                  age: patient.date_of_birth,
                                  insurance: patient.insurance_type,
                                },
                              },
                            }),
                          });
                          const data = await res.json();
                          if (data.success && data.result) {
                            setTreatmentPlan(data.result);
                            showMsg("✅ 治療計画書を生成しました");
                          } else {
                            showMsg("❌ 生成失敗: " + (data.error || ""));
                          }
                        } catch (e) {
                          showMsg("❌ 生成エラー");
                          console.error(e);
                        }
                        setGeneratingPlan(false);
                      }}
                      disabled={generatingPlan || (!record.soap_s && !record.soap_o && !record.soap_a)}
                      className="bg-purple-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-purple-700 disabled:opacity-40"
                    >
                      {generatingPlan ? "⚙️ 生成中..." : "🤖 AI生成"}
                    </button>
                  </div>
                  <p className="text-xs text-purple-500 mb-3">
                    SOAP・歯式・P検の全データからAIが治療計画書を自動生成します
                  </p>

                  {!treatmentPlan && !generatingPlan && (
                    <div className="text-center py-4">
                      <p className="text-gray-400 text-xs">
                        SOAPを入力後「AI生成」ボタンで治療計画書を作成できます
                      </p>
                    </div>
                  )}

                  {treatmentPlan && (
                    <div className="space-y-3">
                      {/* サマリ */}
                      <div className="bg-white rounded-lg p-3 border border-purple-100">
                        <p className="text-xs text-purple-400 font-bold mb-1">概要</p>
                        <p className="text-sm text-gray-800">{treatmentPlan.summary}</p>
                      </div>

                      {/* 診断まとめ */}
                      {treatmentPlan.diagnosis_summary && (
                        <div className="bg-white rounded-lg p-3 border border-purple-100">
                          <p className="text-xs text-purple-400 font-bold mb-1">診断まとめ</p>
                          <p className="text-sm text-gray-800">{treatmentPlan.diagnosis_summary}</p>
                        </div>
                      )}

                      {/* 処置一覧 */}
                      {treatmentPlan.procedures && treatmentPlan.procedures.length > 0 && (
                        <div className="bg-white rounded-lg p-3 border border-purple-100">
                          <p className="text-xs text-purple-400 font-bold mb-2">治療項目</p>
                          <div className="space-y-2">
                            {treatmentPlan.procedures.map((p, i) => (
                              <div key={i} className="flex items-start gap-2">
                                <span className={`flex-shrink-0 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white ${
                                  p.priority === 1 ? "bg-red-500"
                                  : p.priority === 2 ? "bg-orange-500"
                                  : "bg-gray-400"
                                }`}>{p.priority || i + 1}</span>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-gray-800">{p.name}</span>
                                    {p.tooth && (
                                      <span className="text-xs bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold">{p.tooth}</span>
                                    )}
                                    {p.estimated_visits && (
                                      <span className="text-xs text-gray-400">約{p.estimated_visits}回</span>
                                    )}
                                  </div>
                                  {p.description && (
                                    <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* 予想来院回数・期間 */}
                      <div className="grid grid-cols-2 gap-2">
                        {treatmentPlan.estimated_total_visits && (
                          <div className="bg-white rounded-lg p-3 border border-purple-100 text-center">
                            <p className="text-xs text-purple-400 font-bold">予想来院回数</p>
                            <p className="text-xl font-bold text-purple-700">{treatmentPlan.estimated_total_visits}回</p>
                          </div>
                        )}
                        {treatmentPlan.estimated_duration_months && (
                          <div className="bg-white rounded-lg p-3 border border-purple-100 text-center">
                            <p className="text-xs text-purple-400 font-bold">予想期間</p>
                            <p className="text-xl font-bold text-purple-700">{treatmentPlan.estimated_duration_months}ヶ月</p>
                          </div>
                        )}
                      </div>

                      {/* 治療目標 */}
                      {treatmentPlan.goals && (
                        <div className="bg-white rounded-lg p-3 border border-purple-100">
                          <p className="text-xs text-purple-400 font-bold mb-1">治療目標</p>
                          <p className="text-sm text-gray-800">{treatmentPlan.goals}</p>
                        </div>
                      )}

                      {/* 患者さんへの説明 */}
                      {treatmentPlan.patient_instructions && (
                        <div className="bg-green-50 rounded-lg p-3 border border-green-200">
                          <p className="text-xs text-green-600 font-bold mb-1">患者さんへの説明</p>
                          <p className="text-sm text-gray-800">{treatmentPlan.patient_instructions}</p>
                        </div>
                      )}

                      {/* 保存ボタン */}
                      <button
                        onClick={async () => {
                          if (!treatmentPlan || !patient) return;
                          showMsg("💾 治療計画書を保存中...");
                          try {
                            const { error } = await supabase
                              .from("treatment_plans")
                              .insert({
                                patient_id: patient.id,
                                record_id: record.id,
                                plan_type: "initial",
                                summary: treatmentPlan.summary || "",
                                diagnosis_summary: treatmentPlan.diagnosis_summary || "",
                                procedures: treatmentPlan.procedures || [],
                                estimated_total_visits: treatmentPlan.estimated_total_visits,
                                estimated_duration_months: treatmentPlan.estimated_duration_months,
                                goals: treatmentPlan.goals || "",
                                notes: treatmentPlan.patient_instructions || "",
                                status: "draft",
                              });
                            if (error) {
                              showMsg("❌ 保存失敗: " + error.message);
                            } else {
                              showMsg("✅ 治療計画書を保存しました");
                            }
                          } catch (e) {
                            showMsg("❌ 保存エラー");
                            console.error(e);
                          }
                        }}
                        className="w-full bg-purple-500 text-white py-2.5 rounded-lg text-xs font-bold hover:bg-purple-600"
                      >
                        💾 治療計画書を保存
                      </button>
                    </div>
                  )}
                </div>

                {/* ナビ + 確定ボタン */}
                <div className="flex justify-between items-center">
                  <button onClick={() => setActiveTab("dr_exam")} className="text-base text-gray-400 hover:text-gray-600 font-bold">← Dr診察</button>
                  <div className="flex gap-2">
                    <button onClick={saveRecord} disabled={saving} className="bg-white border-2 border-sky-500 text-sky-600 px-4 py-3 rounded-xl text-sm font-bold hover:bg-sky-50 disabled:opacity-50">💾 一時保存</button>
                    <button onClick={() => { if (!previewDone) { if (!confirm("算定プレビューを実行していません。\nプレビューなしで確定しますか？")) return; } completeSession(); }} disabled={saving} className="bg-green-600 text-white px-8 py-3.5 rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200">{previewDone ? "✅ 確定して会計へ" : "✅ 診察完了（カルテ確定）"}</button>
                  </div>
                </div>
              </div>
            )}
          {/* 固定フッター: 一時保存 + 診察完了 */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-3">
              {isReturning && previousVisit && previousVisit.nextPlan && (
                <div className="bg-purple-50 border border-purple-200 rounded-xl px-4 py-2">
                  <span className="text-xs text-purple-500 font-bold">前回予定: </span>
                  <span className="text-sm text-purple-800 font-bold">{previousVisit.nextPlan}</span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={saveRecord} disabled={saving} className="bg-white border-2 border-sky-500 text-sky-600 px-6 py-3 rounded-xl text-base font-bold hover:bg-sky-50 disabled:opacity-50">💾 一時保存</button>
              <button onClick={() => { if (!previewDone) { if (!confirm("算定プレビューを実行していません。\nプレビューなしで確定しますか？")) return; } completeSession(); }} disabled={saving} className="bg-green-600 text-white px-8 py-3.5 rounded-xl text-base font-bold hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200">{previewDone ? "✅ 確定して会計へ" : "✅ 診察完了（カルテ確定）"}</button>
            </div>
          </div>
        </div>
      </main>

      {/* AI結果プレビューモーダル */}
      {showAiPreview && aiResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="text-center mb-5"><span className="text-4xl">🤖</span><h3 className="text-xl font-bold text-gray-900 mt-2">SOAP生成結果</h3></div>
            {aiResult.soap_s_undetected && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 mb-4 flex items-start gap-2">
                <span className="text-lg">⚠️</span>
                <div><p className="text-sm font-bold text-amber-800">音声から主訴を十分に読み取れませんでした</p><p className="text-xs text-amber-600 mt-0.5">反映後、S欄の内容を必ず確認・修正してください</p></div>
              </div>
            )}
            <div className="space-y-3 mb-6">
              {[{ label: "S 主観", value: aiResult.soap.s, color: "border-red-400", bg: "bg-red-50" }, { label: "O 客観", value: aiResult.soap.o, color: "border-blue-400", bg: "bg-blue-50" }, { label: "A 評価", value: aiResult.soap.a, color: "border-yellow-400", bg: "bg-yellow-50" }, { label: "P 計画", value: aiResult.soap.p, color: "border-green-400", bg: "bg-green-50" }].map(item => (
                <div key={item.label} className={`border-l-4 ${item.color} ${item.bg} rounded-r-xl p-3`}><p className="text-xs text-gray-500 font-bold mb-1">{item.label}</p><p className="text-sm text-gray-800 whitespace-pre-wrap">{item.value || "（該当なし）"}</p></div>
              ))}
              {aiResult.tooth_updates && Object.keys(aiResult.tooth_updates).length > 0 && <div className="bg-gray-50 rounded-xl p-3 border border-gray-200"><p className="text-xs text-gray-500 font-bold mb-1">🦷 歯式更新</p><div className="flex flex-wrap gap-2">{Object.entries(aiResult.tooth_updates).map(([t, s]) => (<span key={t} className="bg-white border border-gray-200 px-2.5 py-1 rounded-lg text-xs font-bold text-gray-700">#{t.replace("#", "")}: {TOOTH_STATUS[s]?.label || s}</span>))}</div></div>}
              {aiResult.procedures.length > 0 && <div className="bg-gray-50 rounded-xl p-3 border border-gray-200"><p className="text-xs text-gray-500 font-bold mb-1">🔧 本日の処置</p><div className="flex flex-wrap gap-2">{aiResult.procedures.map((p, i) => (<span key={i} className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">{p}</span>))}</div></div>}
              {aiResult.diagnoses && aiResult.diagnoses.length > 0 && <div className="bg-purple-50 rounded-xl p-3 border border-purple-200"><p className="text-xs text-purple-600 font-bold mb-1">🏷️ 傷病名</p><div className="flex flex-wrap gap-2">{aiResult.diagnoses.map((d, i) => (<span key={i} className="bg-white border border-purple-200 px-3 py-1 rounded-full text-sm font-bold text-purple-700">{d.name}{d.tooth ? ` ${d.tooth}` : ""}</span>))}</div></div>}
            </div>
            <div className="flex gap-3"><button onClick={applyAiResult} className="flex-1 bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 shadow-lg shadow-green-200">✅ 反映する</button><button onClick={() => { setShowAiPreview(false); showMsg("手動で修正してください"); }} className="flex-1 bg-gray-100 text-gray-700 py-4 rounded-xl font-bold hover:bg-gray-200">✏️ 修正が必要</button></div>
          </div>
        </div>
      )}
      {editingTooth && !checkMode && !baselineMode && <div className="fixed inset-0 z-10" onClick={() => setEditingTooth(null)} />}
    </div>
  );
}

function toothLabel(t: string) { const n = parseInt(t); if (isNaN(n)) return t; const q = Math.floor(n / 10), p = n % 10; return `${q===1?"右上":q===2?"左上":q===3?"左下":q===4?"右下":""}${p}番`; }

export default function ConsultationSessionPage() {
  return (<Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>}><SessionContent /></Suspense>);
}
