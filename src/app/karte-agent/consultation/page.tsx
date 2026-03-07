"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ==============================
// 型定義
// ==============================
interface Patient {
  id: string;
  name: string;
  birth_date: string;
  insurance_type: string;
  current_tooth_chart: Record<string, ToothStatus> | null;
}

interface Appointment {
  id: string;
  patient_id: string;
  doctor_id: string;
  appointment_date: string;
  visit_type: string;
  chief_complaint: string;
  status: string;
}

interface MedicalRecord {
  id: string;
  appointment_id: string;
  patient_id: string;
  soap_s: string;
  soap_o: string;
  soap_a: string;
  soap_p: string;
  tooth_chart: Record<string, ToothStatus> | null;
  previous_tooth_chart: Record<string, ToothStatus> | null;
  structured_procedures: StructuredProcedure[];
  predicted_diagnoses: PredictedDiagnosis[];
  status: string;
}

interface ToothStatus {
  status: string;
  treatment?: string;
  notes?: string;
}

interface StructuredProcedure {
  id: string;
  tooth: string;
  diagnosis_code: string;
  diagnosis_name: string;
  procedure_name: string;
  points: number;
  category: string;
  timestamp: string;
}

interface PredictedDiagnosis {
  tooth?: string;
  code: string;
  name: string;
  short?: string;
  confidence: number;
  source?: string;
}

interface DetectedDiagnosis {
  tooth: string;
  code: string;
  name: string;
  short?: string;
  confidence: number;
  reason: string;
  suspected_teeth?: string[]; // レントゲン由来の候補歯番リスト
}

interface PatientDiagnosis {
  id: string;
  tooth: string | null;
  diagnosis_code: string;
  diagnosis_name: string;
  status: "planned" | "in_treatment" | "completed" | "watching";
  session_total?: number;    // 全何回の計画か
  session_current?: number;  // 今何回目か
  medical_record_id: string;
  created_at: string;
}

interface DiagnosisWithTooth {
  tooth: string;
  code: string;
  name: string;
  short?: string;
  confidence: number;
  reason: string;
}

interface TreatmentScheduleItem {
  sessionNo: number; // 何回目
  teeth: string[];   // その回でやる歯番
  diagnoses: DiagnosisWithTooth[]; // その回でやる傷病
  label: string;     // 例: "第1回: 16番 C2"
}

interface ProcedurePattern {
  id: string;
  procedure_name: string;
  category: string;
  points: number;
  fee_items: string[];
  applicable_diagnoses: string[];
}

interface BillingMissItem {
  procedure_name: string;
  reason: string;
  points: number;
  procedure_id: string;
}

type PopupType =
  | null
  | "photo"
  | "perio"
  | "voice"
  | "diagnosis"
  | "treatment"
  | "billing";

// ==============================
// 歯番ユーティリティ
// ==============================
const TOOTH_NUMBERS = [
  18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28,
  48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38,
];

const UPPER_TEETH = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const LOWER_TEETH = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

function toothStatusColor(status?: string) {
  switch (status) {
    // 健全
    case "healthy": return "bg-white border border-gray-200";
    case "c0": return "bg-yellow-100 border border-yellow-300";
    // う蝕
    case "c1": return "bg-red-200 text-red-800";
    case "c2": return "bg-red-400 text-white";
    case "c3": return "bg-red-600 text-white";
    case "c4": return "bg-red-900 text-white";
    case "caries": return "bg-red-400 text-white"; // 後方互換
    // 処置歯
    case "cr": return "bg-blue-200 text-blue-800";
    case "inlay": return "bg-cyan-300 text-cyan-900";
    // 補綴
    case "crown": return "bg-yellow-400 text-yellow-900";
    case "cr_crown": return "bg-yellow-300 text-yellow-900";
    // ブリッジ
    case "bridge": return "bg-orange-400 text-white";
    case "bridge_missing": return "bg-orange-200 text-orange-800"; // Br欠（ポンティック）
    // インプラント
    case "implant": return "bg-blue-500 text-white";
    // 根管治療
    case "rct": return "bg-purple-400 text-white";
    case "root_remain": return "bg-purple-700 text-white"; // 残根
    case "in_treatment": return "bg-pink-400 text-white"; // 治療中
    // 欠損
    case "missing": return "bg-gray-600 text-white";
    // 要注意
    case "watch": return "bg-yellow-500 text-white";
    default: return "bg-white border border-gray-200";
  }
}

// ステータスの表示ラベル
function toothStatusLabel(status?: string): string {
  const labels: Record<string, string> = {
    healthy: "", c0: "C0", c1: "C1", c2: "C2", c3: "C3", c4: "C4",
    caries: "C", cr: "CR", inlay: "In", crown: "Cr", cr_crown: "Cr",
    bridge: "Br", bridge_missing: "Br欠", implant: "IP",
    rct: "RCT", root_remain: "残根", in_treatment: "治療",
    missing: "欠", watch: "注意",
  };
  return labels[status || ""] ?? status?.slice(0, 3) ?? "";
}

function calcAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ==============================
// メインコンポーネント
// ==============================
export default function ConsultationPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const appointmentId = searchParams.get("appointment_id");

  // データ
  const [patient, setPatient] = useState<Patient | null>(null);
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [medicalRecord, setMedicalRecord] = useState<MedicalRecord | null>(null);
  const [pastRecords, setPastRecords] = useState<MedicalRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // UI状態
  const [popup, setPopup] = useState<PopupType>(null);
  const [showPastRecords, setShowPastRecords] = useState(false);
  const [showSoap, setShowSoap] = useState(false);
  const [activityLog, setActivityLog] = useState<string[]>([]);

  // バナー状態
  const [detectedDiagnoses, setDetectedDiagnoses] = useState<DetectedDiagnosis[]>([]);
  const [billingMissItems, setBillingMissItems] = useState<BillingMissItem[]>([]);
  const [voiceConfirmList, setVoiceConfirmList] = useState<DetectedDiagnosis[]>([]);
  const [showVoiceConfirm, setShowVoiceConfirm] = useState(false);
  const [suggestedTreatments, setSuggestedTreatments] = useState<ProcedurePattern[]>([]);
  const [confirmedDiagnosis, setConfirmedDiagnosis] = useState<DetectedDiagnosis | null>(null);
  // patient_diagnosesテーブルのデータ
  const [patientDiagnoses, setPatientDiagnoses] = useState<PatientDiagnosis[]>([]);
  const [pastPatientDiagnoses, setPastPatientDiagnoses] = useState<PatientDiagnosis[]>([]);
  // 複数傷病名リスト（確定済み）
  const [confirmedDiagnosesList, setConfirmedDiagnosesList] = useState<DiagnosisWithTooth[]>([]);
  // 治療スケジュール
  const [treatmentSchedule, setTreatmentSchedule] = useState<TreatmentScheduleItem[]>([]);
  const [showSchedulePopup, setShowSchedulePopup] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState<TreatmentScheduleItem[]>([]);
  // 今日やる歯番リスト
  const [todayTeeth, setTodayTeeth] = useState<string[]>([]);
  const [scheduleConfirmed, setScheduleConfirmed] = useState(false);

  // 音声録音
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [voiceLoading, setVoiceLoading] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 写真
  const [photoLoading, setPhotoLoading] = useState(false);
  const [aiToothFindings, setAiToothFindings] = useState<Array<{ tooth: string; finding: string; confidence: number; detail?: string; suggestedDiagnosis?: string }>>([]);
  const [xraySummary, setXraySummary] = useState<string>("");
  const [xrayNotableFindings, setXrayNotableFindings] = useState<string[]>([]);
  const [showXrayConfirm, setShowXrayConfirm] = useState(false);
  const [xrayConfirmChart, setXrayConfirmChart] = useState<Record<string, ToothStatus>>({});
  const [showIntegratedDiagnosis, setShowIntegratedDiagnosis] = useState(false);
  const [integratedDiagnoses, setIntegratedDiagnoses] = useState<DetectedDiagnosis[]>([]);

  // P検
  const perioRTCRef = useRef<RTCPeerConnection | null>(null);
  const perioStreamRef = useRef<MediaStream | null>(null);
  const [perioRecording, setPerioRecording] = useState(false);
  const [perioInterimText, setPerioInterimText] = useState("");
  const [perioData, setPerioData] = useState<Record<string, number>>({});
  const [perioBOP, setPerioBOP] = useState<Record<string, boolean>>({});
  const [perioMobility, setPerioMobility] = useState<Record<string, number>>({});
  const [perioRecession, setPerioRecession] = useState<Record<string, number>>({});
  const [perioMode, setPerioMode] = useState<1 | 3 | 6>(3);
  const [perioStep, setPerioStep] = useState<"pocket" | "bop" | "mobility" | "recession">("pocket");
  const [showPerioFull, setShowPerioFull] = useState(false);
  const [perioVoiceToothIdx, setPerioVoiceToothIdx] = useState(0); // 現在入力中の歯インデックス（表示用）
  const perioVoiceToothIdxRef = useRef(0); // 実際の進捗（クロージャ対策）
  const [perioVoiceBuffer, setPerioVoiceBuffer] = useState<number[]>([]); // 入力バッファ
  const perioVoiceBufferRef = useRef<number[]>([]); // バッファ（クロージャ対策）
  const [perioStepPopup, setPerioStepPopup] = useState<string>(""); // ステップ完了ポップアップ

  // 歯式編集
  const [editingTooth, setEditingTooth] = useState<number | null>(null);
  const [toothChartDraft, setToothChartDraft] = useState<Record<string, ToothStatus>>({});

  // 傷病名選択
  const [diagnosisSearch, setDiagnosisSearch] = useState("");
  const [diagnosisMaster, setDiagnosisMaster] = useState<Array<{ code: string; name: string; category: string }>>([]);
  const [selectedTooth, setSelectedTooth] = useState("");

  // フォーカス制御
  const [focusStep, setFocusStep] = useState<"photo" | "perio" | "voice" | "diagnosis" | "treatment" | "billing" | null>(null);

  // ==============================
  // データ取得
  // ==============================
  useEffect(() => {
    if (!appointmentId) return;
    fetchAll();
  }, [appointmentId]);

  async function fetchAll() {
    setLoading(true);
    try {
      const { data: appt } = await supabase
        .from("appointments")
        .select("*")
        .eq("id", appointmentId)
        .single();
      if (!appt) throw new Error("appointment not found");
      setAppointment(appt);

      const { data: pt } = await supabase
        .from("patients")
        .select("*")
        .eq("id", appt.patient_id)
        .single();
      setPatient(pt);

      const { data: mr } = await supabase
        .from("medical_records")
        .select("*")
        .eq("appointment_id", appointmentId)
        .single();

      if (mr) {
        setMedicalRecord(mr);
        setToothChartDraft(mr.tooth_chart || pt?.current_tooth_chart || {});

        // 問診票由来の傷病名があれば即バナー表示
        if (mr.predicted_diagnoses?.length > 0) {
          setDetectedDiagnoses(
            mr.predicted_diagnoses.map((pd: PredictedDiagnosis) => ({
              tooth: pd.tooth || "",
              code: pd.code,
              name: pd.name,
              short: pd.short || pd.code,
              confidence: pd.confidence,
              reason: "問診票より予測",
            }))
          );
          setFocusStep("photo");
          // soap_sから主訴を取り出してログ表示
          const mainComplaint = (mr.soap_s || "").split("\n").find((l: string) => l.includes("主訴"))?.replace("【主訴】", "") || "";
          if (mainComplaint) addLog(`📋 主訴: ${mainComplaint}`);
          addLog(`🦷 問診票から傷病名候補${mr.predicted_diagnoses.length}件を検出 → まずレントゲンをアップロードしてください`);
        }
      }

      // 今回カルテの傷病名を取得
      if (mr) {
        const { data: currentDiags } = await supabase
          .from("patient_diagnoses")
          .select("*")
          .eq("medical_record_id", mr.id)
          .order("created_at");
        if (currentDiags && currentDiags.length > 0) {
          setPatientDiagnoses(currentDiags);
          // confirmedDiagnosesListにも反映
          setConfirmedDiagnosesList(currentDiags.map((d: PatientDiagnosis) => ({
            tooth: d.tooth || "",
            code: d.diagnosis_code,
            name: d.diagnosis_name,
            short: d.diagnosis_code,
            confidence: 1,
            reason: "カルテより",
          })));
        }
      }

      // 過去カルテの傷病名（前回分）
      const { data: pastMrList } = await supabase
        .from("medical_records")
        .select("id")
        .eq("patient_id", appt.patient_id)
        .neq("appointment_id", appointmentId)
        .order("created_at", { ascending: false })
        .limit(1);
      if (pastMrList && pastMrList.length > 0) {
        const { data: pastDiags } = await supabase
          .from("patient_diagnoses")
          .select("*")
          .eq("medical_record_id", pastMrList[0].id);
        setPastPatientDiagnoses(pastDiags || []);
      }

      const { data: past } = await supabase
        .from("medical_records")
        .select("*")
        .eq("patient_id", appt.patient_id)
        .neq("appointment_id", appointmentId)
        .order("created_at", { ascending: false })
        .limit(5);
      setPastRecords(past || []);

      // ==============================
      // 初診料・再診料の自動追加
      // ==============================
      if (mr && (mr.structured_procedures || []).length === 0) {
        const isFirst = appt.visit_type === "initial" || (past || []).length === 0;
        const feeProc: StructuredProcedure = isFirst
          ? { id: `fee-${Date.now()}`, diagnosis_code: "", diagnosis_name: "初診", procedure_name: "歯科初診料", points: 267, tooth: "", category: "basic", timestamp: new Date().toISOString() }
          : { id: `fee-${Date.now()}`, diagnosis_code: "", diagnosis_name: "再診", procedure_name: "歯科再診料", points: 58, tooth: "", category: "basic", timestamp: new Date().toISOString() };
        const updated = [feeProc];
        await supabase.from("medical_records").update({ structured_procedures: updated }).eq("id", mr.id);
        setMedicalRecord((prev) => prev ? { ...prev, structured_procedures: updated } : prev);
        addLog(`💰 ${feeProc.procedure_name}（${feeProc.points}点）を自動追加`);
      }

      const { data: dm } = await supabase
        .from("diagnosis_master")
        .select("code, name, category")
        .order("category");
      setDiagnosisMaster(dm || []);

      addLog("カルテを読み込みました");
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }

  function addLog(msg: string) {
    const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    setActivityLog((prev) => [`${time} ${msg}`, ...prev].slice(0, 50));
  }

  const totalPoints = (medicalRecord?.structured_procedures || []).reduce(
    (sum, p) => sum + (p.points || 0),
    0
  );

  // ==============================
  // 音声録音
  // ==============================
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      audioChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mr.start(1000);
      mediaRecorderRef.current = mr;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
      addLog("🎙 録音開始");
    } catch (err) {
      alert("マイクへのアクセスが必要です");
    }
  }

  async function stopRecording() {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    setIsRecording(false);
    setVoiceLoading(true);
    addLog("🎙 録音停止 → AI解析中...");

    await new Promise((r) => setTimeout(r, 500));
    const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
    await analyzeVoice(blob);
  }

  async function analyzeVoice(blob: Blob) {
    try {
      const formData = new FormData();
      formData.append("file", blob, "recording.webm");
      formData.append("model", "whisper-1");
      formData.append("language", "ja");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.NEXT_PUBLIC_OPENAI_API_KEY || ""}` },
        body: formData,
      });

      let transcribedText = "";
      if (whisperRes.ok) {
        const wData = await whisperRes.json();
        transcribedText = wData.text || "";
      }

      setTranscript(transcribedText);
      addLog(`📝 文字起こし: "${transcribedText.slice(0, 30)}..."`);

      const classifyRes = await fetch("/api/karte-agent/classify-and-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: transcribedText,
          medical_record_id: medicalRecord?.id,
          field_key: "s",
          patient_id: patient?.id,
        }),
      });

      if (classifyRes.ok) {
        const classifyData = await classifyRes.json();
        const detected = classifyData.detected_diagnoses || [];

        if (detected.length > 0) {
          // 確認リストに入れてポップアップ表示
          setVoiceConfirmList(detected);
          setShowVoiceConfirm(true);
          addLog(`🦷 傷病名${detected.length}件検出 → 確認してください`);
          setPopup(null);
        }

        if (classifyData.classified?.s) {
          await updateSoap("soap_s", classifyData.classified.s);
        }
      }
    } catch (err) {
      addLog("⚠️ 音声解析に失敗しました");
    } finally {
      setVoiceLoading(false);
    }
  }

  // ==============================
  // SOAP更新
  // ==============================
  async function updateSoap(field: string, value: string) {
    if (!medicalRecord) return;
    await supabase
      .from("medical_records")
      .update({ [field]: value })
      .eq("id", medicalRecord.id);
    setMedicalRecord((prev) => prev ? { ...prev, [field]: value } : prev);
  }

  // ==============================
  // 写真 → AI歯式
  // ==============================
  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoLoading(true);
    addLog("📸 写真アップロード → AI解析中...");

    try {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/xray-analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image_base64: base64,
          patient_id: patient?.id,
          medical_record_id: medicalRecord?.id,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const rawFindings = data.findings || [];

        // APIが返すdetailと傷病名候補をマッピング
        const statusToDiagnosis: Record<string, string> = {
          caries: "う蝕", c0: "CO", c1: "C1", c2: "C2", c3: "C3", c4: "C4",
          crown: "補綴(クラウン)", missing: "欠損", implant: "インプラント",
          bridge: "ブリッジ", root_remain: "残根", in_treatment: "治療中",
          treated: "処置歯(CR/インレー)", watch: "要観察", rct: "根管治療済",
        };

        // APIステータス → 歯式チャートステータスのマッピング
        const statusToChart: Record<string, string> = {
          caries: "c2", c0: "c0", c1: "c1", c2: "c2", c3: "c3", c4: "c4", watch: "watch",
          crown: "crown", treated: "cr", filled: "cr", cr: "cr", inlay: "inlay",
          bridge: "bridge", bridge_missing: "bridge_missing",
          missing: "missing",
          implant: "implant",
          rct: "rct", root_remain: "root_remain", in_treatment: "in_treatment",
        };

        const enrichedFindings = rawFindings.map((f: { tooth: string; status: string; confidence: number; detail?: string }) => ({
          tooth: f.tooth,
          finding: f.status,
          confidence: f.confidence,
          detail: f.detail || "",
          suggestedDiagnosis: statusToDiagnosis[f.status?.toLowerCase()] || f.status,
          chartStatus: statusToChart[f.status?.toLowerCase()] || "crown",
        }));

        setAiToothFindings(enrichedFindings);
        setXraySummary(data.summary || "");
        setXrayNotableFindings(data.analysis?.notable_findings || []);
        addLog(`🦷 AI歯式解析完了: ${enrichedFindings.length}件の所見`);
        // 0件でもポップアップ表示（内容確認のため）
        setPopup("photo");
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || `HTTP ${res.status}`;
        addLog(`⚠️ レントゲン解析エラー: ${errMsg}`);
      }
    } catch (err) {
      addLog("⚠️ 写真解析に失敗しました");
    } finally {
      setPhotoLoading(false);
    }
  }

  async function applyAiFindings(findingIdx: number) {
    const finding = aiToothFindings[findingIdx];
    if (!finding) return;

    const newChart = { ...toothChartDraft };
    newChart[finding.tooth] = {
      status: (finding as { chartStatus?: string }).chartStatus || "crown",
      notes: finding.detail || finding.finding,
    };
    setToothChartDraft(newChart);
    await saveToothChart(newChart);
    addLog(`✅ AI所見を歯式に反映: ${finding.tooth}番 ${finding.suggestedDiagnosis || finding.finding}`);
    setAiToothFindings((prev) => prev.filter((_, i) => i !== findingIdx));

    if (aiToothFindings.length <= 1) {
      setPopup(null);
      setFocusStep("perio");
      addLog("→ 次: P検を行ってください");
    }
  }

  async function applyAllAiFindings() {
    const newChart = { ...toothChartDraft };
    for (const finding of aiToothFindings) {
      newChart[finding.tooth] = {
        status: (finding as { chartStatus?: string }).chartStatus || "crown",
        notes: finding.detail || finding.finding,
      };
    }
    // 確認ポップアップ表示（まだ保存しない）
    setXrayConfirmChart(newChart);
    setShowXrayConfirm(true);
  }

  async function confirmApplyAll() {
    setToothChartDraft(xrayConfirmChart);
    await saveToothChart(xrayConfirmChart);
    addLog(`✅ AI所見を一括反映: ${aiToothFindings.length}件`);

    // 問診票＋レントゲンを統合して傷病名候補を生成
    const integrated: DetectedDiagnosis[] = [];

    // 問診票由来
    const fromRecord = (medicalRecord?.predicted_diagnoses || []).map((pd: PredictedDiagnosis) => ({
      tooth: pd.tooth || "",
      code: pd.code,
      name: pd.name,
      short: pd.short || pd.code,
      confidence: pd.confidence,
      reason: "問診票より予測",
    }));

    // レントゲン由来（う蝕・残根・治療中のみ傷病名候補に）
    const xrayDiagMap: Record<string, { code: string; name: string; short: string }> = {
      c1: { code: "C1", name: "う蝕(C1)", short: "C1" },
      c2: { code: "C2", name: "う蝕(C2)", short: "C2" },
      c3: { code: "C3", name: "う蝕(C3)", short: "C3" },
      c4: { code: "C4", name: "う蝕(C4)", short: "C4" },
      caries: { code: "C2", name: "う蝕(C2)", short: "C2" },
      watch: { code: "C0", name: "要観察(C0)", short: "C0" },
      root_remain: { code: "残根", name: "残根", short: "残根" },
      in_treatment: { code: "Pul", name: "歯髄炎(治療中)", short: "Pul" },
      rct: { code: "Per", name: "根尖性歯周炎", short: "Per" },
    };

    for (const f of aiToothFindings) {
      const mapped = xrayDiagMap[f.finding?.toLowerCase()];
      if (mapped) {
        integrated.push({
          tooth: f.tooth,
          code: mapped.code,
          name: mapped.name,
          short: mapped.short,
          confidence: f.confidence,
          reason: `レントゲン: ${f.detail || f.finding}`,
        });
      }
    }

    // 問診票と統合（重複コードは信頼度を加算）
    for (const rec of fromRecord) {
      const existing = integrated.find(d => d.code === rec.code);
      if (existing) {
        existing.confidence = Math.min(existing.confidence + 0.2, 0.99);
        existing.reason = "問診票＋レントゲン一致";
      } else {
        integrated.push(rec);
      }
    }

    // 同じ傷病コードのレントゲン歯番を suspected_teeth としてまとめる
    // （問診票由来で tooth が空のものに対して、レントゲン由来の歯番候補を付与）
    for (const item of integrated) {
      if (!item.tooth) {
        const sameCode = aiToothFindings
          .filter(f => {
            const mapped = xrayDiagMap[f.finding?.toLowerCase()];
            return mapped && mapped.code === item.code;
          })
          .map(f => f.tooth)
          .filter(Boolean);
        if (sameCode.length > 0) {
          item.suspected_teeth = sameCode;
        }
      }
    }

    // 信頼度降順ソート
    integrated.sort((a, b) => b.confidence - a.confidence);

    setAiToothFindings([]);
    setXraySummary("");
    setXrayNotableFindings([]);
    setShowXrayConfirm(false);

    if (integrated.length > 0) {
      setIntegratedDiagnoses(integrated);
      setShowIntegratedDiagnosis(true);
    } else {
      setPopup(null);
      setFocusStep("perio");
      addLog("→ 次: P検を行ってください");
    }
  }

  async function saveToothChart(chart: Record<string, ToothStatus>) {
    if (!medicalRecord) return;
    await supabase
      .from("medical_records")
      .update({ tooth_chart: chart })
      .eq("id", medicalRecord.id);
    setMedicalRecord((prev) => prev ? { ...prev, tooth_chart: chart } : prev);
  }

  // ==============================
  // 傷病名ステータス変更
  // ==============================
  async function updateDiagnosisStatus(diagId: string, status: PatientDiagnosis["status"]) {
    await supabase.from("patient_diagnoses").update({ status }).eq("id", diagId);
    setPatientDiagnoses(prev => prev.map(d => d.id === diagId ? { ...d, status } : d));
    addLog(`🔄 ステータス更新: ${status}`);
  }

  // ==============================
  // 傷病名確定
  // ==============================
  async function confirmDiagnosis(diag: DetectedDiagnosis) {
    if (!patient || !medicalRecord) return;
    setConfirmedDiagnosis(diag);

    // 複数傷病リストに追加（重複チェック）
    setConfirmedDiagnosesList(prev => {
      const exists = prev.some(d => d.tooth === diag.tooth && d.code === diag.code);
      if (exists) return prev;
      return [...prev, { tooth: diag.tooth, code: diag.code, name: diag.name, short: diag.short, confidence: diag.confidence, reason: diag.reason }];
    });

    addLog(`✅ 傷病名確定: ${diag.tooth ? `${diag.tooth}番 ` : ""}${diag.name}`);

    const { data: insertedDiag } = await supabase.from("patient_diagnoses").insert({
      patient_id: patient.id,
      medical_record_id: medicalRecord.id,
      tooth: diag.tooth || null,
      diagnosis_code: diag.code,
      diagnosis_name: diag.name,
      status: "planned",
    }).select().single();
    if (insertedDiag) {
      setPatientDiagnoses(prev => {
        const exists = prev.some(d => d.tooth === insertedDiag.tooth && d.diagnosis_code === insertedDiag.diagnosis_code);
        return exists ? prev : [...prev, insertedDiag];
      });
    }

    setFocusStep("treatment");
    const shortCode = diag.short || diag.code;
    await fetchTreatmentPatterns(shortCode);
    setDetectedDiagnoses([]);
  }

  // ==============================
  // ★ 修正: fetchTreatmentPatterns
  // APIは diagnosis_short を要求し、treatments を返す
  // ==============================
  async function fetchTreatmentPatterns(diagnosisCode: string) {
    try {
      const res = await fetch("/api/suggest-treatment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          diagnosis_code: diagnosisCode,
          diagnosis_short: diagnosisCode, // ← APIはこちらを参照
        }),
      });
      if (res.ok) {
        const data = await res.json();
        // APIは treatments を返す（procedures ではない）
        const treatments = data.treatments || [];
        const converted: ProcedurePattern[] = treatments.map((t: {
          procedure_id: string;
          procedure_name: string;
          category: string;
          fee_items: { code: string; name: string; points: number; count: number }[];
          total_points: number;
          is_default: boolean;
        }) => ({
          id: t.procedure_id,
          procedure_name: t.procedure_name,
          category: t.category,
          points: t.total_points,
          fee_items: t.fee_items.map((f) => f.name),
          applicable_diagnoses: [diagnosisCode],
        }));
        // display_orderはAPIが既にソート済みなので順序をそのまま維持
        setSuggestedTreatments(converted);
        addLog(`💊 治療パターン${converted.length}件を提案`);
      }
    } catch (err) {
    }
  }

  // ==============================
  // 治療パターン選択
  // ==============================
  async function selectTreatment(proc: ProcedurePattern) {
    if (!medicalRecord || !confirmedDiagnosis) return;

    const newProc: StructuredProcedure = {
      id: crypto.randomUUID(),
      tooth: confirmedDiagnosis.tooth || "",
      diagnosis_code: confirmedDiagnosis.code,
      diagnosis_name: confirmedDiagnosis.name,
      procedure_name: proc.procedure_name,
      points: proc.points,
      category: proc.category,
      timestamp: new Date().toISOString(),
    };

    const updated = [...(medicalRecord.structured_procedures || []), newProc];
    await supabase
      .from("medical_records")
      .update({ structured_procedures: updated })
      .eq("id", medicalRecord.id);
    setMedicalRecord((prev) => prev ? { ...prev, structured_procedures: updated } : prev);
    addLog(`➕ 処置追加: ${proc.procedure_name}（${proc.points}点）`);

    const soapP = `${confirmedDiagnosis.tooth ? `${confirmedDiagnosis.tooth}番 ` : ""}${confirmedDiagnosis.name}: ${proc.procedure_name}`;
    await updateSoap("soap_p", soapP);

    await checkBillingMiss(updated);
    setSuggestedTreatments([]);
    setFocusStep("billing");
  }

  // ==============================
  // 算定漏れチェック
  // ==============================
  async function checkBillingMiss(procedures: StructuredProcedure[]) {
    const procedureNames = procedures.map((p) => p.procedure_name);
    const misses: BillingMissItem[] = [];

    const rules: Array<{
      trigger: string;
      missing: string;
      reason: string;
      points: number;
      id: string;
    }> = [
      { trigger: "抜髄", missing: "浸麻", reason: "抜髄には浸麻が必要です", points: 45, id: "sinma" },
      { trigger: "抜髄", missing: "ラバーダム", reason: "抜髄には感染防止のためラバーダムを検討してください", points: 25, id: "rubber" },
      { trigger: "CR充填", missing: "歯科疾患管理料", reason: "CR充填時は歯科疾患管理料の算定が可能です", points: 102, id: "shikan" },
      { trigger: "抜歯", missing: "浸麻", reason: "抜歯には浸麻が必要です", points: 45, id: "sinma2" },
      { trigger: "スケーリング", missing: "歯科疾患管理料", reason: "歯周治療時は歯科疾患管理料の算定が可能です", points: 102, id: "shikan2" },
      { trigger: "根管充填", missing: "根管貼薬", reason: "根管充填前に根管貼薬が必要です", points: 40, id: "konkan" },
    ];

    for (const rule of rules) {
      const hasTrigger = procedureNames.some((n) => n.includes(rule.trigger));
      const hasMissing = procedureNames.some((n) => n.includes(rule.missing));
      if (hasTrigger && !hasMissing) {
        misses.push({
          procedure_name: rule.missing,
          reason: rule.reason,
          points: rule.points,
          procedure_id: rule.id,
        });
      }
    }

    setBillingMissItems(misses);
    if (misses.length > 0) {
      addLog(`⚠️ 算定漏れ候補: ${misses.map((m) => m.procedure_name).join(", ")}`);
    }
  }

  async function addMissingProcedure(miss: BillingMissItem) {
    if (!medicalRecord || !confirmedDiagnosis) return;
    const newProc: StructuredProcedure = {
      id: crypto.randomUUID(),
      tooth: confirmedDiagnosis?.tooth || "",
      diagnosis_code: confirmedDiagnosis?.code || "",
      diagnosis_name: confirmedDiagnosis?.name || "",
      procedure_name: miss.procedure_name,
      points: miss.points,
      category: "basic",
      timestamp: new Date().toISOString(),
    };
    const updated = [...(medicalRecord.structured_procedures || []), newProc];
    await supabase
      .from("medical_records")
      .update({ structured_procedures: updated })
      .eq("id", medicalRecord.id);
    setMedicalRecord((prev) => prev ? { ...prev, structured_procedures: updated } : prev);
    setBillingMissItems((prev) => prev.filter((m) => m.procedure_id !== miss.procedure_id));
    addLog(`✅ ${miss.procedure_name} を追加しました`);
  }

  // ==============================
  // P検
  // ==============================
  // P検音声解析（歯番なし連続入力対応）
  const PERIO_TEETH = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
                       48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

  function getActivePeriTeeth() {
    return PERIO_TEETH.filter(t => {
      const s = toothChartDraft[String(t)]?.status;
      return s !== "missing";
    });
  }

  function perioAdvanceStep(nextStep: "pocket" | "bop" | "mobility" | "recession" | "done") {
    const labels: Record<string, string> = {
      bop: "② BOP（出血）",
      mobility: "③ 動揺度",
      recession: "④ 歯肉退縮",
      done: "完了！保存します",
    };
    if (nextStep === "done") {
      setPerioStepPopup("✅ 全ステップ完了！保存します");
      setTimeout(() => { setPerioStepPopup(""); savePerioData(); }, 2000);
    } else {
      setPerioStepPopup(`✅ ポケット検査終了！\n${labels[nextStep] ?? nextStep}に進みます`);
      setTimeout(() => {
        setPerioStepPopup("");
        setPerioStep(nextStep);
        perioVoiceToothIdxRef.current = 0;
        perioVoiceBufferRef.current = [];
        setPerioVoiceToothIdx(0);
        setPerioVoiceBuffer([]);
      }, 1800);
    }
  }

  function parsePerioVoice(text: string) {
    addLog(`🎙 P検: "${text}"`);
    const activTeeth = getActivePeriTeeth();
    const nums = Array.from(text.matchAll(/(\d+(?:\.\d+)?)/g))
      .map(m => parseFloat(m[1])).filter(n => !isNaN(n));

    if (perioStep === "pocket") {
      const ptsPerTooth = perioMode;
      const newBuf = [...perioVoiceBufferRef.current, ...nums];
      let buf = [...newBuf];
      let idx = perioVoiceToothIdxRef.current;
      while (buf.length >= ptsPerTooth && idx < activTeeth.length) {
        const tooth = activTeeth[idx];
        const vals = buf.splice(0, ptsPerTooth).filter(v => v >= 0 && v <= 12);
        if (perioMode === 1) {
          setPerioData(prev => ({ ...prev, [`${tooth}`]: vals[0] }));
        } else if (perioMode === 3) {
          vals.forEach((v, i) => setPerioData(prev => ({ ...prev, [`${tooth}-b${i+1}`]: v })));
        } else {
          vals.slice(0,3).forEach((v, i) => setPerioData(prev => ({ ...prev, [`${tooth}-b${i+1}`]: v })));
          vals.slice(3,6).forEach((v, i) => setPerioData(prev => ({ ...prev, [`${tooth}-l${i+1}`]: v })));
        }
        addLog(`✅ ${tooth}番 ${vals.join("/")}mm`);
        idx++;
      }
      perioVoiceBufferRef.current = buf;
      perioVoiceToothIdxRef.current = idx;
      setPerioVoiceBuffer(buf);
      setPerioVoiceToothIdx(idx);
      if (idx >= activTeeth.length) perioAdvanceStep("bop");

    } else if (perioStep === "bop") {
      let idx = perioVoiceToothIdxRef.current;
      const tokens = text.split(/[、,\s]+/);
      for (const token of tokens) {
        if (idx >= activTeeth.length) break;
        const tooth = activTeeth[idx];
        if (/あり|出血|プラス|\+|BOP/.test(token)) {
          setPerioBOP(prev => ({ ...prev, [`${tooth}`]: true }));
          addLog(`🩸 ${tooth}番 BOP+`); idx++;
        } else if (/なし|マイナス|-/.test(token)) {
          setPerioBOP(prev => ({ ...prev, [`${tooth}`]: false })); idx++;
        }
      }
      perioVoiceToothIdxRef.current = idx;
      setPerioVoiceToothIdx(idx);
      if (idx >= activTeeth.length) perioAdvanceStep("mobility");

    } else if (perioStep === "mobility") {
      let idx = perioVoiceToothIdxRef.current;
      for (const n of nums) {
        if (idx >= activTeeth.length) break;
        if (n >= 0 && n <= 3) {
          const tooth = activTeeth[idx];
          setPerioMobility(prev => ({ ...prev, [`${tooth}`]: n }));
          addLog(`↔️ ${tooth}番 動揺${n}度`); idx++;
        }
      }
      perioVoiceToothIdxRef.current = idx;
      setPerioVoiceToothIdx(idx);
      if (idx >= activTeeth.length) perioAdvanceStep("recession");

    } else if (perioStep === "recession") {
      let idx = perioVoiceToothIdxRef.current;
      for (const n of nums) {
        if (idx >= activTeeth.length) break;
        if (n >= 0 && n <= 10) {
          const tooth = activTeeth[idx];
          setPerioRecession(prev => ({ ...prev, [`${tooth}`]: n }));
          addLog(`📉 ${tooth}番 退縮${n}mm`); idx++;
        }
      }
      perioVoiceToothIdxRef.current = idx;
      setPerioVoiceToothIdx(idx);
      if (idx >= activTeeth.length) perioAdvanceStep("done");
    }
  }

  async function startPerioVoice() {
    try {
      // サーバーからephemeral tokenを取得（APIキーを隠蔽）
      addLog("🔑 Realtime API接続中...");
      // Supabaseセッショントークンを取得してサーバーに送る（認証チェック用）
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { addLog("⚠️ ログインが必要です"); return; }

      const tokenRes = await fetch("/api/realtime-token", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.json();
        addLog(`⚠️ トークン取得失敗: ${err.error || tokenRes.status}`);
        return;
      }
      const { client_secret } = await tokenRes.json();

      // マイク取得
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      perioStreamRef.current = stream;

      // WebRTC接続
      const pc = new RTCPeerConnection();
      perioRTCRef.current = pc;

      // 音声トラック追加
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      // DataChannel（テキスト受信用）
      const dc = pc.createDataChannel("oai-events");
      dc.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);

          // 音声文字起こし（途中）
          if (msg.type === "conversation.item.input_audio_transcription.delta") {
            setPerioInterimText(prev => prev + (msg.delta || ""));
          }
          // 音声文字起こし（確定）
          if (msg.type === "conversation.item.input_audio_transcription.completed") {
            const text = msg.transcript || "";
            setPerioInterimText("");
            if (text.trim()) {
              addLog(`✅ 認識: "${text}"`);
              parsePerioVoice(text);
            }
          }
          // ※ response.text.done は使わない（AIが数字を繰り返すため二重入力になる）
        } catch { /* ignore */ }
      };

      // セッション設定（接続後に送信）
      dc.onopen = () => {
        dc.send(JSON.stringify({
          type: "session.update",
          session: {
            modalities: ["text"],
            // AIの自動返答を無効化（文字起こしのみ使用）
            instructions: "何も返答しないでください。文字起こしのみ行ってください。",
            input_audio_transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.3,
              silence_duration_ms: 400,
              prefix_padding_ms: 200,
            },
          },
        }));
        setPerioRecording(true);
        addLog("🎙 Realtime API接続完了 — 話してください");
      };

      // SDP交換
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(
        "https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client_secret}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        }
      );
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    } catch (err) {
      addLog("⚠️ Realtime API接続エラー");
      setPerioRecording(false);
    }
  }

  function stopPerioVoice() {
    perioRTCRef.current?.close();
    perioRTCRef.current = null;
    perioStreamRef.current?.getTracks().forEach(t => t.stop());
    perioStreamRef.current = null;
    setPerioRecording(false);
    setPerioInterimText("");
    addLog("🛑 音声入力終了");
  }


  async function savePerioData() {
    if (!medicalRecord) return;

    const TEETH = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28,
                   48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

    // ポケット深さのサマリー
    const pocketEntries = TEETH.flatMap((t) => {
      if (perioMode === 6) {
        const pts = ["b1","b2","b3","l1","l2","l3"].map(p => perioData[`${t}-${p}`]).filter(Boolean);
        return pts.length > 0 ? [`${t}(${pts.join("/")})`] : [];
      } else if (perioMode === 3) {
        const pts = ["b1","b2","b3"].map(p => perioData[`${t}-${p}`]).filter(Boolean);
        return pts.length > 0 ? [`${t}(${pts.join("/")})`] : [];
      } else {
        return perioData[`${t}`] ? [`${t}(${perioData[`${t}`]})`] : [];
      }
    });

    const bopTeeth = Object.entries(perioBOP).filter(([,v]) => v).map(([k]) => k).join(",");
    const mobilityEntries = Object.entries(perioMobility).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}度`).join(",");
    const recessionEntries = Object.entries(perioRecession).filter(([,v]) => v > 0).map(([k,v]) => `${k}:${v}mm`).join(",");

    const lines = [
      pocketEntries.length > 0 && `【ポケット】${pocketEntries.join(" ")}`,
      bopTeeth && `【BOP】${bopTeeth}`,
      mobilityEntries && `【動揺度】${mobilityEntries}`,
      recessionEntries && `【歯肉退縮】${recessionEntries}`,
    ].filter(Boolean).join("\n");

    await updateSoap("soap_o", lines || "P検データなし");

    // 検査歯数を数えて点数計算（残根・欠損は除く）
    const missingTeeth = new Set(
      Object.entries(toothChartDraft)
        .filter(([,v]) => v.status === "missing" || v.status === "root_remain")
        .map(([k]) => k)
    );
    const checkedTeeth = new Set([
      ...Object.keys(perioData).map(k => k.split("-")[0]),
      ...Object.keys(perioBOP),
      ...Object.keys(perioMobility),
    ].filter(t => !missingTeeth.has(t)));
    const teethCount = checkedTeeth.size;

    // 歯周基本検査(1-3点法) or 精密検査(4-6点法)
    const isSeimitsu = perioMode >= 4;
    let examPoints = 0;
    let examName = "";
    if (teethCount === 0) {
      examPoints = 0;
    } else if (teethCount < 10) {
      examPoints = isSeimitsu ? 100 : 50;
    } else if (teethCount < 20) {
      examPoints = isSeimitsu ? 220 : 110;
    } else {
      examPoints = isSeimitsu ? 400 : 200;
    }
    examName = isSeimitsu ? `歯周精密検査（${teethCount}歯）` : `歯周基本検査（${teethCount}歯）`;

    // 処置記録に追加
    if (examPoints > 0 && patient) {
      const newProc: StructuredProcedure = {
        id: crypto.randomUUID(),
        tooth: "",
        diagnosis_code: "P",
        diagnosis_name: "歯周病",
        procedure_name: examName,
        points: examPoints,
        category: "perio",
        timestamp: new Date().toISOString(),
      };
      const updated = [...(medicalRecord.structured_procedures || []), newProc];
      await supabase.from("medical_records").update({ structured_procedures: updated }).eq("id", medicalRecord.id);
      setMedicalRecord(prev => prev ? { ...prev, structured_procedures: updated } : prev);
      addLog(`➕ 処置追加: ${examName}（${examPoints}点）`);
    }

    const highPockets = Object.entries(perioData).filter(([,v]) => v >= 4).length;
    addLog(`📊 P検保存: ${teethCount}歯記録 / ${highPockets}箇所4mm以上 / BOP ${Object.values(perioBOP).filter(Boolean).length}箇所`);
    setShowPerioFull(false);
    setFocusStep("voice");
    addLog("→ 次: 音声録音を行ってください");
  }

  // ==============================
  // 歯式チャート クリック
  // ==============================
  function handleToothClick(toothNum: number) {
    setEditingTooth(toothNum);
  }

  async function setToothStatus(toothNum: number, status: string) {
    const newChart = { ...toothChartDraft, [String(toothNum)]: { status } };
    setToothChartDraft(newChart);
    await saveToothChart(newChart);
    setEditingTooth(null);
    addLog(`🦷 歯式更新: ${toothNum}番 → ${status}`);
  }

  // ==============================
  // 算定確定
  // ==============================
  async function finalizeBilling() {
    if (!medicalRecord || !appointment) return;
    try {
      const procs = medicalRecord.structured_procedures || [];
      await supabase.from("billing").insert({
        patient_id: appointment.patient_id,
        appointment_id: appointment.id,
        medical_record_id: medicalRecord.id,
        procedures: procs,
        total_points: totalPoints,
        status: "pending",
      });

      await supabase
        .from("appointments")
        .update({ status: "completed" })
        .eq("id", appointment.id);

      await supabase
        .from("patients")
        .update({ current_tooth_chart: toothChartDraft })
        .eq("id", appointment.patient_id);

      addLog("💰 算定確定完了 → 会計へ");
      router.push(`/billing?appointment_id=${appointment.id}`);
    } catch (err) {
      addLog("⚠️ 算定確定に失敗しました");
    }
  }

  // ==============================
  // ローディング
  // ==============================
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">カルテを読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!patient || !appointment || !medicalRecord) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center text-red-600">
          <p className="text-xl">カルテが見つかりません</p>
          <button
            onClick={() => router.back()}
            className="mt-4 px-4 py-2 bg-gray-600 text-white rounded"
          >
            戻る
          </button>
        </div>
      </div>
    );
  }

  const age = calcAge(patient.birth_date);
  const isFirstVisit = appointment.visit_type === "initial" || pastRecords.length === 0;

  // ==============================
  // レンダリング
  // ==============================
  return (
    <div className="flex flex-col h-screen bg-gray-50 overflow-hidden">


      {/* ===== P検フルスクリーン ===== */}
      {showPerioFull && (() => {
        const activTeeth = getActivePeriTeeth();
        const upper = activTeeth.filter(t => t >= 11 && t <= 28);
        const lower = activTeeth.filter(t => t >= 31 && t <= 48);

        const getCellVal = (tooth: number, point: string) => {
          if (perioMode === 1) return perioData[`${tooth}`];
          return perioData[`${tooth}-${point}`];
        };
        const getCellColor = (v: number | undefined) => {
          if (!v) return "border-gray-200 bg-white";
          if (v >= 6) return "border-red-600 bg-red-600 text-white font-bold";
          if (v >= 4) return "border-red-400 bg-red-100 text-red-700 font-bold";
          if (v === 3) return "border-orange-300 bg-orange-50";
          return "border-gray-300 bg-white";
        };
        const bPoints = perioMode === 6 ? ["b1","b2","b3"] : perioMode === 3 ? ["b1","b2","b3"] : ["b1"];
        const lPoints = perioMode === 6 ? ["l1","l2","l3"] : [];
        const currentTooth = activTeeth[perioVoiceToothIdx];

        const renderTooth = (tooth: number) => {
          const isCurrent = tooth === currentTooth && perioRecording;
          const isMissing = toothChartDraft[String(tooth)]?.status === "missing";
          if (isMissing) return (
            <div key={tooth} className="flex flex-col items-center opacity-30 min-w-[44px]">
              <div className="text-xs text-gray-400">{tooth}</div>
              <div className="text-[10px] text-gray-300">欠損</div>
            </div>
          );

          return (
            <div key={tooth} className={`flex flex-col items-center min-w-[44px] rounded-lg p-0.5 transition-all ${isCurrent ? "ring-2 ring-purple-500 bg-purple-50" : ""}`}>
              <div className={`text-xs font-bold mb-0.5 ${isCurrent ? "text-purple-700" : "text-gray-500"}`}>{tooth}</div>

              {perioStep === "pocket" && (
                <div className="flex flex-col gap-0.5 w-full">
                  {perioMode === 6 && <div className="text-[8px] text-gray-400 text-center">頬</div>}
                  <div className="flex gap-0.5 justify-center">
                    {bPoints.map(p => {
                      const k = perioMode === 1 ? `${tooth}` : `${tooth}-${p}`;
                      const v = perioData[k];
                      return (
                        <input key={p} type="number" min={0} max={12}
                          value={v || ""}
                          placeholder="-"
                          onChange={e => setPerioData(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                          className={`w-7 h-7 border rounded text-center text-xs ${getCellColor(v)}`}
                        />
                      );
                    })}
                  </div>
                  {perioMode === 6 && (
                    <>
                      <div className="text-[8px] text-gray-400 text-center mt-0.5">舌</div>
                      <div className="flex gap-0.5 justify-center">
                        {lPoints.map(p => {
                          const k = `${tooth}-${p}`;
                          const v = perioData[k];
                          return (
                            <input key={p} type="number" min={0} max={12}
                              value={v || ""}
                              placeholder="-"
                              onChange={e => setPerioData(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                              className={`w-7 h-7 border rounded text-center text-xs ${getCellColor(v)}`}
                            />
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}

              {perioStep === "bop" && (
                <div className="flex flex-col items-center gap-1">
                  <button
                    onClick={() => setPerioBOP(prev => ({ ...prev, [`${tooth}`]: !prev[`${tooth}`] }))}
                    className={`w-8 h-8 rounded-full border-2 transition-colors ${perioBOP[`${tooth}`] ? "bg-red-500 border-red-600 text-white text-xs" : "border-gray-300 bg-white text-gray-300 text-xs"}`}
                  >{perioBOP[`${tooth}`] ? "+" : "-"}</button>
                  {/* ポケット深さ参照表示 */}
                  {(() => {
                    const maxV = Math.max(...[...bPoints,...lPoints].map(p => getCellVal(tooth, p) || 0));
                    return maxV > 0 ? <div className={`text-[9px] px-1 rounded ${maxV >= 4 ? "text-red-600 font-bold" : "text-gray-400"}`}>{maxV}mm</div> : null;
                  })()}
                </div>
              )}

              {perioStep === "mobility" && (
                <div className="flex flex-col items-center gap-1">
                  <select value={perioMobility[`${tooth}`] || 0}
                    onChange={e => setPerioMobility(prev => ({ ...prev, [`${tooth}`]: Number(e.target.value) }))}
                    className={`w-10 text-xs border rounded px-1 py-0.5 ${(perioMobility[`${tooth}`] || 0) > 0 ? "border-orange-400 bg-orange-50" : ""}`}>
                    <option value={0}>0</option>
                    <option value={1}>1°</option>
                    <option value={2}>2°</option>
                    <option value={3}>3°</option>
                  </select>
                </div>
              )}

              {perioStep === "recession" && (
                <div className="flex flex-col items-center">
                  <input type="number" min={0} max={10}
                    value={perioRecession[`${tooth}`] || ""}
                    placeholder="-"
                    onChange={e => setPerioRecession(prev => ({ ...prev, [`${tooth}`]: Number(e.target.value) }))}
                    className={`w-8 h-7 border rounded text-center text-xs ${(perioRecession[`${tooth}`] || 0) > 0 ? "border-yellow-400 bg-yellow-50" : "border-gray-200"}`}
                  />
                </div>
              )}
            </div>
          );
        };

        return (
          <div className="fixed inset-0 z-50 bg-white flex flex-col overflow-hidden">
            <style>{`
              @keyframes slideDown { from { transform:translateY(-20px);opacity:0; } to { transform:translateY(0);opacity:1; } }
              @keyframes bounceIn { 0%{transform:scale(0.5);opacity:0} 60%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
            `}</style>

            {/* ステップ完了ポップアップ */}
            {perioStepPopup && (
              <div className="absolute inset-0 z-60 flex items-center justify-center bg-black bg-opacity-50">
                <div className="bg-white rounded-2xl shadow-2xl px-8 py-6 text-center max-w-xs"
                  style={{animation:"bounceIn 0.4s ease-out"}}>
                  <div className="text-4xl mb-3">🎉</div>
                  {perioStepPopup.split("\n").map((l, i) => (
                    <p key={i} className={i === 0 ? "font-black text-lg text-green-600" : "text-gray-600 text-sm mt-1"}>{l}</p>
                  ))}
                </div>
              </div>
            )}

            {/* ヘッダー */}
            <div className="bg-white border-b px-4 py-3 flex items-center justify-between shadow-sm">
              <div className="flex items-center gap-3">
                <button onClick={() => setShowPerioFull(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                <h2 className="font-bold text-gray-900">🦷 歯周検査（P検）</h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">計測点数:</span>
                {([1,3,6] as const).map(m => (
                  <button key={m} onClick={() => { setPerioMode(m); setPerioVoiceToothIdx(0); setPerioVoiceBuffer([]); }}
                    className={`px-2 py-1 rounded text-xs font-bold border ${perioMode === m ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600"}`}>
                    {m}点法
                  </button>
                ))}
              </div>
              <button onClick={savePerioData} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-700">
                💾 保存して終了
              </button>
            </div>

            {/* ステップタブ */}
            <div className="flex border-b bg-gray-50">
              {([
                { key: "pocket", label: "① ポケット", icon: "📏" },
                { key: "bop", label: "② BOP", icon: "🩸" },
                { key: "mobility", label: "③ 動揺度", icon: "↔️" },
                { key: "recession", label: "④ 歯肉退縮", icon: "📉" },
              ] as const).map(s => (
                <button key={s.key} onClick={() => { setPerioStep(s.key); setPerioVoiceToothIdx(0); setPerioVoiceBuffer([]); }}
                  className={`flex-1 py-2.5 text-sm font-bold border-b-2 transition-colors ${perioStep === s.key ? "border-blue-600 text-blue-600 bg-white" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                  {s.icon} {s.label}
                </button>
              ))}
            </div>

            {/* 音声入力バー */}
            <div className="px-4 py-2 bg-purple-50 border-b flex items-center gap-3">
              <button
                onClick={() => perioRecording ? stopPerioVoice() : startPerioVoice()}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold min-w-[120px] justify-center ${perioRecording ? "bg-red-500 text-white animate-pulse" : "bg-purple-600 text-white hover:bg-purple-700"}`}
              >
                🎙 {perioRecording ? "録音中 ■" : "音声入力 ▶"}
              </button>
              <div className="flex-1 text-xs text-gray-500">
                {perioStep === "pocket" && `数字を読み上げてください（${perioMode}点法: ${perioMode}つで次の歯へ）— 現在: ${currentTooth ? `${currentTooth}番` : "完了"}`}
                {perioStep === "bop" && `「あり」「なし」で答えてください — 現在: ${currentTooth ? `${currentTooth}番` : "完了"}`}
                {perioStep === "mobility" && `0〜3の数字を言ってください — 現在: ${currentTooth ? `${currentTooth}番` : "完了"}`}
                {perioStep === "recession" && `退縮量(mm)を言ってください — 現在: ${currentTooth ? `${currentTooth}番` : "完了"}`}
              </div>
              {/* 進捗 & リアルタイムテキスト */}
              <div className="flex flex-col items-end gap-1">
                <div className="text-xs text-gray-400">{perioVoiceToothIdx}/{activTeeth.length}歯</div>
                {perioInterimText && <div className="text-xs text-purple-600 animate-pulse max-w-[200px] truncate">🎙 {perioInterimText}</div>}
              </div>
            </div>

            {/* メインチャート */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {/* 上顎 */}
              <div>
                <div className="text-xs font-bold text-gray-400 mb-2">上顎</div>
                <div className="flex gap-1 flex-wrap">
                  {upper.map(t => renderTooth(t))}
                </div>
              </div>
              {/* 下顎 */}
              <div>
                <div className="text-xs font-bold text-gray-400 mb-2">下顎</div>
                <div className="flex gap-1 flex-wrap">
                  {lower.map(t => renderTooth(t))}
                </div>
              </div>
              {/* 凡例 */}
              {perioStep === "pocket" && (
                <div className="flex gap-4 text-xs text-gray-500 pt-2 border-t">
                  <span><span className="inline-block w-3 h-3 bg-orange-50 border border-orange-300 rounded mr-1"/>3mm</span>
                  <span><span className="inline-block w-3 h-3 bg-red-100 border border-red-400 rounded mr-1"/>4-5mm</span>
                  <span><span className="inline-block w-3 h-3 bg-red-600 rounded mr-1"/>6mm+</span>
                </div>
              )}
            </div>

            {/* フッター統計 */}
            <div className="border-t px-4 py-2 bg-gray-50 flex items-center gap-6 text-xs text-gray-600">
              <span>📏 記録: <b>{Object.keys(perioData).length}</b>点</span>
              <span className="text-red-600">🔴 4mm+: <b>{Object.values(perioData).filter(v => v >= 4).length}</b></span>
              <span className="text-orange-600">🩸 BOP: <b>{Object.values(perioBOP).filter(Boolean).length}</b></span>
              <span>↔️ 動揺: <b>{Object.values(perioMobility).filter(v => v > 0).length}</b>歯</span>
              <span className="ml-auto text-gray-400">
                {perioMode === 1 ? "基本検査(1点法)" : perioMode === 3 ? "基本検査(3点法)" : "精密検査(6点法)"}
              </span>
            </div>
          </div>
        );
      })()}

      {/* ===== 統合診断「これかも！」ポップアップ ===== */}
      {showIntegratedDiagnosis && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
            style={{ animation: "slideUp 0.3s ease-out" }}>
            <style>{`
              @keyframes slideUp {
                from { transform: translateY(40px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
              }
              @keyframes pulse-ring {
                0% { transform: scale(0.8); opacity: 1; }
                100% { transform: scale(1.4); opacity: 0; }
              }
            `}</style>

            {/* ヘッダー */}
            <div className="bg-gradient-to-r from-green-500 to-blue-600 px-6 py-5 text-white relative overflow-hidden">
              <div className="absolute inset-0 bg-white opacity-5 rounded-full w-64 h-64 -top-20 -right-20" />
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-14 h-14 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-3xl">💡</div>
                  <div className="absolute inset-0 rounded-full border-2 border-white border-opacity-50"
                    style={{ animation: "pulse-ring 1.5s ease-out infinite" }} />
                </div>
                <div>
                  <h3 className="font-black text-xl">これかも！</h3>
                  <p className="text-sm text-green-100">問診票＋レントゲンの統合分析結果</p>
                </div>
              </div>
            </div>

            {/* 傷病名候補リスト */}
            <div className="px-6 py-4 max-h-80 overflow-y-auto">
              <p className="text-sm text-gray-500 mb-3">以下の傷病名が疑われます。仮確定する傷病名を選んでください。</p>
              <div className="space-y-2">
                {integratedDiagnoses.slice(0, 6).map((diag, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      confirmDiagnosis(diag);
                      setShowIntegratedDiagnosis(false);
                      setPopup(null);
                      addLog(`✅ 傷病名仮確定: ${diag.tooth ? `${diag.tooth}番 ` : ""}${diag.name}`);
                    }}
                    className="w-full text-left border-2 border-gray-100 hover:border-green-400 hover:bg-green-50 rounded-xl p-3 transition-all group"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        {/* 信頼度バー */}
                        <div className="w-1 h-10 rounded-full bg-gray-200 overflow-hidden">
                          <div className="w-full bg-green-500 rounded-full transition-all"
                            style={{ height: `${Math.round((diag.confidence || 0) * 100)}%`, marginTop: `${100 - Math.round((diag.confidence || 0) * 100)}%` }} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            {diag.tooth && (
                              <span className="bg-gray-100 text-gray-700 text-xs font-bold px-2 py-0.5 rounded">{diag.tooth}番</span>
                            )}
                            <span className="font-bold text-gray-900">{diag.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                              diag.reason.includes("一致") ? "bg-green-100 text-green-700" :
                              diag.reason.includes("レントゲン") ? "bg-purple-100 text-purple-700" :
                              "bg-blue-100 text-blue-700"
                            }`}>{diag.reason.includes("一致") ? "🎯 問診票×レントゲン" : diag.reason.includes("レントゲン") ? "📸 レントゲン" : "📋 問診票"}</span>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">{diag.reason}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-black text-green-600">{Math.round((diag.confidence || 0) * 100)}%</div>
                        <div className="text-xs text-gray-400 group-hover:text-green-600 font-medium">仮確定 →</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ボタン */}
            <div className="px-6 py-4 border-t flex gap-3">
              <button
                onClick={() => {
                  setShowIntegratedDiagnosis(false);
                  setDetectedDiagnoses(integratedDiagnoses);
                  setPopup(null);
                  setFocusStep("diagnosis");
                }}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-600 font-medium hover:bg-gray-50 text-sm"
              >
                後で選ぶ
              </button>
              <button
                onClick={() => {
                  setShowIntegratedDiagnosis(false);
                  setPopup("diagnosis");
                }}
                className="flex-1 py-3 rounded-xl border border-blue-300 text-blue-600 font-medium hover:bg-blue-50 text-sm"
              >
                🔍 手動で選択
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== AI歯式確認ポップアップ ===== */}
      {showXrayConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 ">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
            style={{ animation: "slideUp 0.3s ease-out" }}>
            <style>{`
              @keyframes slideUp {
                from { transform: translateY(40px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
              }
              @keyframes checkPop {
                0% { transform: scale(0); opacity: 0; }
                60% { transform: scale(1.2); }
                100% { transform: scale(1); opacity: 1; }
              }
            `}</style>

            {/* ヘッダー */}
            <div className="bg-gradient-to-r from-purple-600 to-blue-600 px-6 py-4 text-white">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-xl"
                  style={{ animation: "checkPop 0.4s ease-out 0.2s both" }}>
                  🦷
                </div>
                <div>
                  <h3 className="font-bold text-lg">AI歯式解析完了</h3>
                  <p className="text-sm text-purple-100">{aiToothFindings.length}件の所見を検出しました</p>
                </div>
              </div>
            </div>

            {/* 所見リスト */}
            <div className="px-6 py-4 max-h-96 overflow-y-auto space-y-4">

              {/* ① 問診票由来の傷病名候補 */}
              {(medicalRecord?.predicted_diagnoses?.length > 0 || medicalRecord?.soap_s) && (
                <div>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">📋 問診票からの傷病名候補</p>
                  {medicalRecord?.soap_s && (
                    <div className="bg-sky-50 border border-sky-200 rounded-lg p-2 mb-2">
                      <p className="text-xs text-gray-500 font-medium mb-0.5">主訴</p>
                      <p className="text-xs text-gray-700">{medicalRecord.soap_s.split("\n").find(l => l.includes("主訴"))?.replace("【主訴】", "") || medicalRecord.soap_s.slice(0, 60)}</p>
                    </div>
                  )}
                  {(medicalRecord?.predicted_diagnoses || []).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {(medicalRecord?.predicted_diagnoses || []).slice(0, 5).map((pd: PredictedDiagnosis, i: number) => (
                        <div key={i} className="flex items-center gap-1 bg-yellow-50 border border-yellow-300 rounded-lg px-2 py-1">
                          <span className="text-xs font-bold text-yellow-800">{pd.name}</span>
                          {(pd.confidence > 0) && <span className="text-xs text-gray-400">({Math.round(pd.confidence * 100)}%)</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ② レントゲンAI歯式所見 */}
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">🦷 レントゲン所見（{aiToothFindings.length}件）</p>
                <p className="text-sm text-gray-600 mb-2">この内容で歯式チャートに反映しますか？</p>
                <div className="space-y-2">
                  {aiToothFindings.map((f, i) => (
                    <div key={i} className="flex items-start gap-3 p-2 bg-gray-50 rounded-lg">
                      <span className={`text-xs px-2 py-1 rounded font-bold min-w-12 text-center ${
                        f.finding === "missing" ? "bg-gray-600 text-white" :
                        f.finding === "caries" || f.finding === "watch" ? "bg-red-400 text-white" :
                        f.finding === "rct" || f.finding === "root_remain" ? "bg-purple-400 text-white" :
                        f.finding === "implant" ? "bg-blue-400 text-white" :
                        f.finding === "bridge" ? "bg-orange-400 text-white" :
                        "bg-yellow-400 text-gray-800"
                      }`}>{f.tooth}番</span>
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-800">{f.suggestedDiagnosis || f.finding}</span>
                        <span className="text-xs text-gray-400 ml-2">{Math.round((f.confidence || 0) * 100)}%</span>
                        {f.detail && <p className="text-xs text-gray-500 mt-0.5">└ {f.detail}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                {xraySummary && (
                  <div className="mt-2 p-3 bg-purple-50 rounded-lg">
                    <p className="text-xs font-medium text-purple-700 mb-1">📋 全体所見</p>
                    <p className="text-xs text-gray-600">{xraySummary}</p>
                  </div>
                )}
              </div>

            </div>

            {/* ボタン */}
            <div className="px-6 py-4 border-t flex gap-3">
              <button
                onClick={() => setShowXrayConfirm(false)}
                className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-600 font-medium hover:bg-gray-50"
              >
                修正する
              </button>
              <button
                onClick={confirmApplyAll}
                className="flex-2 px-8 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 text-white font-bold hover:opacity-90 shadow-lg"
              >
                ✅ この内容で反映する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ヘッダー */}
      <header className="bg-white border-b px-4 py-2 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="text-gray-500 hover:text-gray-700">←</button>
          <div>
            <span className="font-bold text-lg">{patient.name}</span>
            <span className="ml-2 text-sm text-gray-500">{age}歳</span>
            <span className="ml-2 text-sm bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
              {patient.insurance_type || "社保"}
            </span>
            <span className={`ml-2 text-sm px-2 py-0.5 rounded ${isFirstVisit ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"}`}>
              {isFirstVisit ? "初診" : "再診"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-2xl font-bold text-blue-700">{totalPoints}<span className="text-sm text-gray-500 ml-1">点</span></div>
            <div className="text-xs text-gray-500">({Math.round(totalPoints * 10)}円)</div>
          </div>
          <button
            onClick={finalizeBilling}
            disabled={(medicalRecord.structured_procedures || []).length === 0}
            className={`px-4 py-2 rounded-lg font-medium text-sm ${
              focusStep === "billing" && (medicalRecord.structured_procedures || []).length > 0
                ? "bg-blue-600 text-white animate-pulse shadow-lg"
                : "bg-gray-200 text-gray-600"
            }`}
          >
            算定確定 →
          </button>
        </div>
      </header>

      {/* バナーエリア */}
      <div className="bg-white border-b px-4 py-1 space-y-1">
        {/* 傷病名検出バナー */}
        {detectedDiagnoses.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-300 rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap">
            <span className="text-yellow-700 font-medium text-sm">🦷 仮傷病名:</span>
            {detectedDiagnoses.slice(0, 3).map((d, i) => {
              // tooth がある場合はそのまま、ない場合は reason からエリアヒントを抽出
              const toothLabel = d.tooth ? `${d.tooth}番` : null;
              const areaHint = !d.tooth && d.reason ? (() => {
                const r = d.reason;
                if (r.includes("右上")) return "右上あたり？";
                if (r.includes("左上")) return "左上あたり？";
                if (r.includes("右下")) return "右下あたり？";
                if (r.includes("左下")) return "左下あたり？";
                if (r.includes("前歯")) return "前歯あたり？";
                if (r.includes("奥歯")) return "奥歯あたり？";
                if (r.includes("上顎")) return "上顎あたり？";
                if (r.includes("下顎")) return "下顎あたり？";
                return null;
              })() : null;
              return (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-sm">
                    {toothLabel && <span className="font-bold text-yellow-800">{toothLabel} </span>}
                    {d.name}
                    {areaHint && <span className="text-xs text-yellow-600 ml-1">📍 {areaHint}</span>}
                    {!toothLabel && d.suspected_teeth && d.suspected_teeth.length > 0 && (
                      <span className="text-xs text-purple-600 ml-1">📍 {d.suspected_teeth.join("・")}番あたり？</span>
                    )}
                    {(d.confidence > 0) && <span className="text-xs text-gray-400 ml-1">({Math.round(d.confidence * 100)}%)</span>}
                  </span>
                  <button
                    onClick={() => confirmDiagnosis(d)}
                    className="bg-yellow-500 text-white text-xs px-2 py-0.5 rounded hover:bg-yellow-600"
                  >
                    決定
                  </button>
                </div>
              );
            })}
            <button onClick={() => setPopup("diagnosis")} className="text-xs text-yellow-700 underline">変更する</button>
            <button onClick={() => setDetectedDiagnoses([])} className="text-xs text-gray-400 ml-auto">✕</button>
          </div>
        )}

        {/* 治療パターン提案バナー */}
        {suggestedTreatments.length > 0 && confirmedDiagnosis && (
          <div className="bg-blue-50 border border-blue-300 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-blue-700 font-medium text-sm">💊 治療パターン（{confirmedDiagnosis.name}）:</span>
              <button onClick={() => setSuggestedTreatments([])} className="text-xs text-gray-400 ml-auto">✕</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestedTreatments.slice(0, 6).map((proc, i) => (
                <button
                  key={i}
                  onClick={() => selectTreatment(proc)}
                  className="bg-blue-600 text-white text-xs px-3 py-1 rounded-full hover:bg-blue-700"
                >
                  {proc.procedure_name} <span className="opacity-75">({proc.points}点)</span>
                </button>
              ))}
              <button onClick={() => setPopup("treatment")} className="text-xs text-blue-600 underline">全て見る</button>
            </div>
          </div>
        )}

        {/* 音声解析 確認ポップアップ */}
        {showVoiceConfirm && voiceConfirmList.length > 0 && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowVoiceConfirm(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-gray-800 mb-1">🦷 以下を確定しますか？</h2>
              <p className="text-xs text-gray-400 mb-4">不要な項目は✕で除外できます</p>
              <div className="space-y-2 mb-5">
                {voiceConfirmList.map((d, i) => (
                  <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                    <div>
                      {d.tooth && <span className="font-bold text-gray-800 mr-2">{d.tooth}番</span>}
                      <span className="text-sm text-gray-700">{d.name}</span>
                      <span className="text-xs text-gray-400 ml-2">({Math.round((d.confidence || 0) * 100)}%)</span>
                    </div>
                    <button
                      onClick={() => setVoiceConfirmList(prev => prev.filter((_, idx) => idx !== i))}
                      className="text-gray-300 hover:text-red-400 text-lg leading-none ml-2"
                    >✕</button>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowVoiceConfirm(false); setVoiceConfirmList([]); }}
                  className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-500 text-sm hover:bg-gray-50"
                >キャンセル</button>
                <button
                  onClick={async () => {
                    for (const d of voiceConfirmList) {
                      await confirmDiagnosis(d);
                    }
                    setShowVoiceConfirm(false);
                    setVoiceConfirmList([]);
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-green-600 text-white font-bold text-sm hover:bg-green-700"
                >✅ まとめてOK</button>
              </div>
            </div>
          </div>
        )}

        {/* 治療スケジュールポップアップ */}
        {showSchedulePopup && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowSchedulePopup(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 transition-all" onClick={e => e.stopPropagation()}>
              <h2 className="text-lg font-bold text-gray-800 mb-1">📅 治療スケジュール</h2>
              <p className="text-xs text-gray-500 mb-4">各回に治療する歯をドラッグで入れ替えられます。セッションの追加・削除も可能です。</p>

              <div className="space-y-3 max-h-80 overflow-y-auto">
                {scheduleDraft.map((session, si) => (
                  <div key={si} className="border rounded-xl p-3 bg-gray-50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-indigo-700">第{session.sessionNo}回</span>
                      <button
                        onClick={() => setScheduleDraft(prev => prev.filter((_, i) => i !== si).map((s, i) => ({ ...s, sessionNo: i + 1 })))}
                        className="text-xs text-red-400 hover:text-red-600"
                      >削除</button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {session.diagnoses.map((d, di) => (
                        <div key={di} className="flex items-center gap-1 bg-indigo-100 text-indigo-800 text-xs px-2 py-1 rounded-full">
                          <span>{d.tooth ? `${d.tooth}番 ` : ""}{d.name}</span>
                          {/* 別セッションに移動 */}
                          {scheduleDraft.length > 1 && (
                            <select
                              className="text-xs bg-transparent border-none outline-none cursor-pointer"
                              value={si}
                              onChange={e => {
                                const targetSession = parseInt(e.target.value);
                                setScheduleDraft(prev => {
                                  const next = prev.map(s => ({ ...s, diagnoses: [...s.diagnoses] }));
                                  next[si].diagnoses = next[si].diagnoses.filter((_, i) => i !== di);
                                  next[si].teeth = next[si].diagnoses.map(x => x.tooth).filter(Boolean);
                                  next[targetSession].diagnoses.push(d);
                                  next[targetSession].teeth = next[targetSession].diagnoses.map(x => x.tooth).filter(Boolean);
                                  return next.filter(s => s.diagnoses.length > 0).map((s, i) => ({ ...s, sessionNo: i + 1, label: `第${i + 1}回` }));
                                });
                              }}
                            >
                              {scheduleDraft.map((_, idx) => (
                                <option key={idx} value={idx}>→ 第{idx + 1}回</option>
                              ))}
                            </select>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* セッション追加 */}
              <button
                onClick={() => setScheduleDraft(prev => [...prev, { sessionNo: prev.length + 1, teeth: [], diagnoses: [], label: `第${prev.length + 1}回` }])}
                className="mt-3 w-full border-2 border-dashed border-gray-300 text-gray-400 text-sm py-2 rounded-xl hover:border-indigo-400 hover:text-indigo-500"
              >＋ 回を追加</button>

              <div className="flex gap-3 mt-5">
                <button onClick={() => setShowSchedulePopup(false)} className="flex-1 border border-gray-300 text-gray-600 py-2 rounded-xl text-sm">キャンセル</button>
                <button
                  onClick={() => {
                    setTreatmentSchedule(scheduleDraft);
                    // 第1回の歯を「今日やる歯」に設定
                    const firstSession = scheduleDraft[0];
                    const todayList = firstSession?.diagnoses.map(d => d.tooth).filter(Boolean) || [];
                    setTodayTeeth(todayList);
                    setScheduleConfirmed(true);
                    setShowSchedulePopup(false);
                    addLog(`📅 スケジュール確定: ${scheduleDraft.length}回に分けて治療（今日: ${todayList.join(", ")}番）`);
                  }}
                  className="flex-2 flex-1 bg-indigo-600 text-white py-2 rounded-xl text-sm font-semibold hover:bg-indigo-700"
                >✅ 確定</button>
              </div>
            </div>
          </div>
        )}

        {/* 算定漏れチェックバナー */}
        {billingMissItems.length > 0 && (
          <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-red-700 font-medium text-sm">⚠️ 算定漏れ候補:</span>
              <button onClick={() => setBillingMissItems([])} className="text-xs text-gray-400 ml-auto">✕</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {billingMissItems.map((miss, i) => (
                <div key={i} className="flex items-center gap-1 bg-white border border-red-200 rounded px-2 py-1">
                  <span className="text-xs text-red-700">{miss.procedure_name}（{miss.points}点）</span>
                  <button onClick={() => addMissingProcedure(miss)} className="bg-red-500 text-white text-xs px-1.5 py-0.5 rounded hover:bg-red-600">追加</button>
                  <button onClick={() => setBillingMissItems((prev) => prev.filter((_, j) => j !== i))} className="text-xs text-gray-400">✕</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI写真所見バナー */}
        {aiToothFindings.length > 0 && (
          <div className="bg-purple-50 border border-purple-300 rounded-lg px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-purple-700 font-medium text-sm">📸 AI歯式所見:</span>
              <button onClick={applyAllAiFindings} className="bg-purple-600 text-white text-xs px-2 py-0.5 rounded hover:bg-purple-700">一括反映</button>
              <button onClick={() => setPopup("photo")} className="text-xs text-purple-600 underline">詳細を見る</button>
              <button onClick={() => setAiToothFindings([])} className="text-xs text-gray-400 ml-auto">✕</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {aiToothFindings.map((f, i) => (
                <div key={i} className="flex items-center gap-1 bg-white border border-purple-200 rounded px-2 py-1">
                  <span className="text-xs font-medium">{f.tooth}番</span>
                  <span className="text-xs text-purple-700">{f.suggestedDiagnosis || f.finding}</span>
                  {(f.confidence > 0) && <span className="text-xs text-gray-400">({Math.round(f.confidence * 100)}%)</span>}
                  <button onClick={() => applyAiFindings(i)} className="bg-purple-500 text-white text-xs px-1.5 py-0.5 rounded">反映</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* メインエリア */}
      <div className="flex flex-1 overflow-hidden">
        {/* カルテ左エリア */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* 過去カルテ */}
          {pastRecords.length > 0 && !isFirstVisit && (
            <div className="bg-white rounded-lg border">
              <button
                onClick={() => setShowPastRecords(!showPastRecords)}
                className="w-full px-4 py-3 text-left flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <span>📋 過去カルテ（{pastRecords.length}件）</span>
                <span>{showPastRecords ? "▲" : "▼"}</span>
              </button>
              {showPastRecords && (
                <div className="px-4 pb-3 space-y-2">
                  {pastRecords.map((pr) => (
                    <div key={pr.id} className="border-l-2 border-gray-200 pl-3 py-1">
                      <div className="text-xs text-gray-500">{new Date(pr.soap_s || "").toLocaleDateString("ja-JP")}</div>
                      <div className="text-sm">{pr.soap_s?.slice(0, 80) || "記録なし"}</div>
                      {(pr.structured_procedures || []).slice(0, 3).map((p, i) => (
                        <span key={i} className="text-xs bg-gray-100 text-gray-600 px-1 py-0.5 rounded mr-1">{p.procedure_name}</span>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 歯式チャート */}
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-700">🦷 歯式チャート</h3>
              <span className="text-xs text-gray-400">タップして状態変更</span>
            </div>
            {medicalRecord.previous_tooth_chart && (
              <div className="mb-2">
                <div className="text-xs text-gray-400 mb-1">前回</div>
                <ToothChart chart={medicalRecord.previous_tooth_chart} dim onToothClick={() => {}} editingTooth={null} onSetStatus={() => {}} />
              </div>
            )}
            <div>
              <div className="text-xs text-gray-500 mb-1">今回</div>
              <ToothChart chart={toothChartDraft} dim={false} onToothClick={handleToothClick} editingTooth={editingTooth} onSetStatus={setToothStatus} />
            </div>
          </div>

          {/* 傷病歯式チャート（常時表示） */}
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-medium text-gray-700">🗺 傷病歯式チャート</h3>
                  {/* 録音ボタン（常時表示） */}
                  {voiceLoading ? (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs bg-blue-100 text-blue-600 border border-blue-300">
                      <span className="animate-spin">⏳</span> AI解析中...
                    </span>
                  ) : (
                    <button
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                        isRecording
                          ? "bg-red-500 text-white animate-pulse shadow-md shadow-red-200"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200 border border-gray-300"
                      }`}
                    >
                      🎙 {isRecording
                        ? `録音中 ${Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:${(recordingSeconds % 60).toString().padStart(2, "0")} ■`
                        : "録音開始"}
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-400">歯にホバーでステータス変更 · 録音してドクターの説明を自動解析</p>
              </div>
              {confirmedDiagnosesList.length > 0 && (
                <button
                  onClick={() => {
                    const draft = confirmedDiagnosesList.map((d, i) => ({
                      sessionNo: i + 1,
                      teeth: [d.tooth].filter(Boolean),
                      diagnoses: [d],
                      label: `第${i + 1}回: ${d.tooth ? `${d.tooth}番 ` : ""}${d.name}`,
                    }));
                    setScheduleDraft(draft);
                    setShowSchedulePopup(true);
                  }}
                  className="text-xs bg-indigo-600 text-white px-3 py-1 rounded-lg hover:bg-indigo-700"
                >
                  📅 治療スケジュールを組む
                </button>
              )}
            </div>
            {/* 前回の傷病歯式チャート */}
            {pastPatientDiagnoses.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-gray-400 mb-1">前回</p>
                <DiagnosisToothChart
                  patientDiagnoses={pastPatientDiagnoses}
                  pastDiagnoses={[]}
                  predictedDiagnoses={[]}
                  todayTeeth={[]}
                  scheduleConfirmed={false}
                />
              </div>
            )}
            {/* 今回の傷病歯式チャート */}
            <div>
              {pastPatientDiagnoses.length > 0 && <p className="text-xs text-gray-500 mb-1">今回</p>}
              <DiagnosisToothChart
                patientDiagnoses={patientDiagnoses}
                pastDiagnoses={pastPatientDiagnoses}
                predictedDiagnoses={[
                  // 問診票予測（patient_diagnosesに未登録のもの）
                  ...(medicalRecord?.predicted_diagnoses || [])
                    .filter((pd: PredictedDiagnosis) =>
                      pd.tooth && !patientDiagnoses.some(d => d.tooth === pd.tooth)
                    )
                    .map((pd: PredictedDiagnosis) => ({
                      tooth: pd.tooth || "", code: pd.code, name: pd.name,
                      short: pd.short || pd.code, confidence: pd.confidence, reason: "予測",
                    })),
                  // バナーに出ている検出済み候補（未確定）
                  ...detectedDiagnoses
                    .filter(d => d.tooth && !patientDiagnoses.some(p => p.tooth === d.tooth))
                    .map(d => ({ tooth: d.tooth, code: d.code, name: d.name, short: d.short || d.code, confidence: d.confidence, reason: d.reason })),
                ]}
                todayTeeth={todayTeeth}
                scheduleConfirmed={scheduleConfirmed}
                onStatusChange={updateDiagnosisStatus}
                toothChart={toothChartDraft}
                onToothClick={(tooth, diagName) => {
                  // すでにpatient_diagnosesに登録済みの歯はステータス変更のみ
                  const existing = patientDiagnoses.find(d => d.tooth === String(tooth));
                  if (existing) return; // ホバーメニューで対応
                  // 未登録の歯 → 傷病名追加ポップアップを開く（歯番をプリセット）
                  setPopup("diagnosis");
                  addLog(`🦷 ${tooth}番 傷病名追加`);
                }}
              />
              {/* 傷病リスト */}
              <div className="mt-3 flex flex-wrap gap-2">
                {confirmedDiagnosesList.map((d, i) => (
                  <div key={i} className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border ${todayTeeth.includes(d.tooth) ? "bg-indigo-100 border-indigo-400 text-indigo-800" : "bg-gray-50 border-gray-200 text-gray-600"}`}>
                    <span>{d.tooth ? `${d.tooth}番` : ""} {d.name}</span>
                    {todayTeeth.includes(d.tooth) && <span className="text-indigo-600 font-bold">今日</span>}
                  </div>
                ))}
              </div>

              {/* スケジュール確定後 → 今日やる歯ごとに治療パターン呼び出しボタン */}
              {scheduleConfirmed && todayTeeth.length > 0 && (
                <div className="mt-4 border-t pt-3">
                  <p className="text-xs text-gray-500 mb-2">今日治療する歯をタップして治療パターンを選択してください：</p>
                  <div className="flex flex-wrap gap-2">
                    {confirmedDiagnosesList
                      .filter(d => todayTeeth.includes(d.tooth))
                      .map((d, i) => (
                        <button
                          key={i}
                          onClick={async () => {
                            setConfirmedDiagnosis(d as DetectedDiagnosis);
                            const shortCode = d.short || d.code;
                            await fetchTreatmentPatterns(shortCode);
                            addLog(`🦷 ${d.tooth}番 ${d.name} の治療パターンを表示`);
                          }}
                          className="bg-indigo-600 text-white text-sm px-4 py-2 rounded-xl hover:bg-indigo-700 shadow-sm flex items-center gap-2"
                        >
                          <span className="font-bold">{d.tooth}番</span>
                          <span>{d.name}</span>
                          <span className="text-indigo-200 text-xs">→ 治療パターン</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 処置記録 */}
          <div className="bg-white rounded-lg border p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-700">📋 処置記録</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    if (!medicalRecord) return;
                    const fee: StructuredProcedure = { id: `fee-${Date.now()}`, diagnosis_code: "", diagnosis_name: "初診", procedure_name: "歯科初診料", points: 267, tooth: "", category: "basic", timestamp: new Date().toISOString() };
                    const updated = [...(medicalRecord.structured_procedures || []), fee];
                    await supabase.from("medical_records").update({ structured_procedures: updated }).eq("id", medicalRecord.id);
                    setMedicalRecord(prev => prev ? { ...prev, structured_procedures: updated } : prev);
                    addLog("💰 歯科初診料（267点）を追加");
                  }}
                  className="text-xs bg-green-50 text-green-600 px-2 py-1 rounded hover:bg-green-100"
                >＋初診料</button>
                <button
                  onClick={async () => {
                    if (!medicalRecord) return;
                    const fee: StructuredProcedure = { id: `fee-${Date.now()}`, diagnosis_code: "", diagnosis_name: "再診", procedure_name: "歯科再診料", points: 58, tooth: "", category: "basic", timestamp: new Date().toISOString() };
                    const updated = [...(medicalRecord.structured_procedures || []), fee];
                    await supabase.from("medical_records").update({ structured_procedures: updated }).eq("id", medicalRecord.id);
                    setMedicalRecord(prev => prev ? { ...prev, structured_procedures: updated } : prev);
                    addLog("💰 歯科再診料（58点）を追加");
                  }}
                  className="text-xs bg-gray-50 text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
                >＋再診料</button>
                <button onClick={() => setPopup("diagnosis")} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100">+ 傷病名追加</button>
              </div>
            </div>
            {(medicalRecord.structured_procedures || []).length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <div className="text-3xl mb-2">📝</div>
                <p className="text-sm">傷病名を確定すると処置記録が追加されます</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-500 border-b">
                    <th className="text-left pb-2 w-12">歯番</th>
                    <th className="text-left pb-2">傷病名</th>
                    <th className="text-left pb-2">処置</th>
                    <th className="text-right pb-2 w-16">点数</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {(medicalRecord.structured_procedures || []).map((proc, i) => (
                    <tr key={proc.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2 font-medium">{proc.tooth || "-"}</td>
                      <td className="py-2 text-gray-600">{proc.diagnosis_name}</td>
                      <td className="py-2">{proc.procedure_name}</td>
                      <td className="py-2 text-right font-medium text-blue-700">{proc.points}</td>
                      <td className="py-2">
                        <button
                          onClick={async () => {
                            const updated = (medicalRecord.structured_procedures || []).filter((_, j) => j !== i);
                            await supabase.from("medical_records").update({ structured_procedures: updated }).eq("id", medicalRecord.id);
                            setMedicalRecord((prev) => prev ? { ...prev, structured_procedures: updated } : prev);
                          }}
                          className="text-gray-300 hover:text-red-400 text-xs"
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t">
                    <td colSpan={3} className="pt-2 text-right text-sm text-gray-500">合計</td>
                    <td className="pt-2 text-right font-bold text-lg text-blue-700">{totalPoints}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {/* SOAP */}
          <div className="bg-white rounded-lg border">
            <button
              onClick={() => setShowSoap(!showSoap)}
              className="w-full px-4 py-3 text-left flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <span>📄 SOAP（サブカルテ）</span>
              <span>{showSoap ? "▲" : "▼"}</span>
            </button>
            {showSoap && (
              <div className="px-4 pb-4 space-y-3">
                {(["soap_s", "soap_o", "soap_a", "soap_p"] as const).map((field) => (
                  <div key={field}>
                    <label className="text-xs font-medium text-gray-500 uppercase">{field.replace("soap_", "")}</label>
                    <textarea
                      className="w-full mt-1 border rounded p-2 text-sm resize-none"
                      rows={2}
                      value={medicalRecord[field] || ""}
                      onChange={(e) => setMedicalRecord((prev) => prev ? { ...prev, [field]: e.target.value } : prev)}
                      onBlur={(e) => updateSoap(field, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 記録ログ */}
          <div className="bg-white rounded-lg border p-4">
            <h3 className="font-medium text-gray-700 mb-2 text-sm">🕐 記録</h3>
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {activityLog.length === 0 ? (
                <p className="text-xs text-gray-400">記録はありません</p>
              ) : (
                activityLog.map((log, i) => (
                  <div key={i} className="text-xs text-gray-600">{log}</div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* アクションボタン */}
        <div className="w-16 bg-white border-l flex flex-col items-center py-4 gap-3">
          {[
            { type: "photo" as PopupType, icon: "📸", label: "写真", step: "photo" },
            { type: "perio" as PopupType, icon: "🦷", label: "P検", step: "perio", fullscreen: true },
            { type: "diagnosis" as PopupType, icon: "🔍", label: "病名", step: "diagnosis" },
            { type: "treatment" as PopupType, icon: "💊", label: "治療", step: "treatment" },
            { type: "billing" as PopupType, icon: "💰", label: "算定", step: "billing" },
          ].map((btn) => (
            <button
              key={btn.type}
              onClick={() => {
                if ((btn as { fullscreen?: boolean }).fullscreen) {
                  setShowPerioFull(true);
                  setPerioStep("pocket");
                } else {
                  setPopup(popup === btn.type ? null : btn.type);
                }
              }}
              className={`flex flex-col items-center gap-0.5 w-12 h-12 rounded-lg border text-xs
                ${focusStep === btn.step ? "ring-2 ring-blue-400 border-blue-400 bg-blue-50" : "hover:bg-gray-50"}
                ${popup === btn.type ? "bg-blue-100 border-blue-400" : ""}
              `}
            >
              <span className="text-lg">{btn.icon}</span>
              <span className="text-gray-500" style={{ fontSize: 9 }}>{btn.label}</span>
            </button>
          ))}
        </div>

        {/* ポップアップパネル */}
        {popup && (
          <div className="w-80 bg-white border-l shadow-lg overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="font-medium text-gray-700">
                {popup === "photo" && "📸 写真・レントゲン"}
                {popup === "perio" && "🦷 歯周検査（P検）"}
                {popup === "voice" && "🎙 音声録音"}
                {popup === "diagnosis" && "🔍 傷病名選択"}
                {popup === "treatment" && "💊 治療パターン"}
                {popup === "billing" && "💰 算定プレビュー"}
              </h3>
              <button onClick={() => setPopup(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>

            <div className="p-4">
              {/* 写真 */}
              {popup === "photo" && (
                <div className="space-y-4">
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                    {photoLoading ? (
                      <div>
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600 mx-auto mb-2" />
                        <p className="text-sm text-gray-500">AI解析中...</p>
                      </div>
                    ) : (
                      <>
                        <div className="text-4xl mb-2">📸</div>
                        <p className="text-sm text-gray-600 mb-3">レントゲン・口腔内写真をアップロード</p>
                        <label className="cursor-pointer bg-purple-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-purple-700">
                          ファイル選択
                          <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                        </label>
                      </>
                    )}
                  </div>
                  {xraySummary && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-purple-700 mb-1">📋 全体所見</p>
                      <p className="text-xs text-gray-700">{xraySummary}</p>
                    </div>
                  )}
                  {xrayNotableFindings.length > 0 && (
                    <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                      <p className="text-xs font-medium text-orange-700 mb-1">⚠️ 重要所見</p>
                      {xrayNotableFindings.map((nf, i) => (
                        <p key={i} className="text-xs text-gray-700">・{nf}</p>
                      ))}
                    </div>
                  )}
                  {aiToothFindings.length > 0 && (
                    <div>
                      <h4 className="font-medium text-sm mb-2">歯別AI所見</h4>
                      <div className="space-y-2">
                        {aiToothFindings.map((f, i) => (
                          <div key={i} className="border rounded p-2 space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">{f.tooth}番</span>
                                <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">{f.suggestedDiagnosis || f.finding}</span>
                                <span className="text-xs text-gray-400">{Math.round((f.confidence || 0) * 100)}%</span>
                              </div>
                              <button onClick={() => applyAiFindings(i)} className="bg-purple-600 text-white text-xs px-2 py-1 rounded">反映</button>
                            </div>
                            {f.detail && (
                              <p className="text-xs text-gray-600 pl-1">└ {f.detail}</p>
                            )}
                          </div>
                        ))}
                        <button onClick={applyAllAiFindings} className="w-full bg-purple-600 text-white py-2 rounded-lg text-sm hover:bg-purple-700">一括反映</button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* P検 */}
              {popup === "perio" && (
                <div className="space-y-4">
                  <div className="grid grid-cols-4 gap-2">
                    {[16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36].map((tooth) => (
                      <div key={tooth} className="text-center">
                        <div className="text-xs text-gray-500 mb-1">{tooth}</div>
                        <input
                          type="number"
                          min={1}
                          max={12}
                          placeholder="mm"
                          value={perioData[String(tooth)] || ""}
                          onChange={(e) => setPerioData((prev) => ({ ...prev, [String(tooth)]: Number(e.target.value) }))}
                          className={`w-full border rounded text-center text-sm py-1 ${(perioData[String(tooth)] || 0) >= 4 ? "border-red-400 bg-red-50" : ""}`}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500">{Object.values(perioData).filter((v) => v >= 4).length}箇所が4mm以上</div>
                  <button onClick={savePerioData} disabled={Object.keys(perioData).length === 0} className="w-full bg-green-600 text-white py-2 rounded-lg text-sm hover:bg-green-700 disabled:opacity-50">P検を保存 →</button>
                </div>
              )}

              {/* 音声録音 */}
              {popup === "voice" && (
                <div className="space-y-4 text-center">
                  {voiceLoading ? (
                    <div className="py-8">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
                      <p className="text-gray-600">AI解析中...</p>
                    </div>
                  ) : (
                    <>
                      <div
                        className={`w-24 h-24 rounded-full mx-auto flex items-center justify-center text-5xl cursor-pointer transition-all ${isRecording ? "bg-red-500 animate-pulse shadow-lg shadow-red-300" : "bg-gray-100 hover:bg-gray-200"}`}
                        onClick={isRecording ? stopRecording : startRecording}
                      >🎙</div>
                      {isRecording && (
                        <div className="text-red-600 font-medium">
                          録音中... {Math.floor(recordingSeconds / 60).toString().padStart(2, "0")}:{(recordingSeconds % 60).toString().padStart(2, "0")}
                        </div>
                      )}
                      <p className="text-sm text-gray-500">{isRecording ? "タップして停止" : "タップして録音開始"}</p>
                      {transcript && (
                        <div className="bg-gray-50 border rounded p-3 text-left">
                          <p className="text-xs text-gray-500 mb-1">文字起こし</p>
                          <p className="text-sm">{transcript}</p>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* 傷病名選択 */}
              {popup === "diagnosis" && (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <input type="text" placeholder="歯番（例: 46）" value={selectedTooth} onChange={(e) => setSelectedTooth(e.target.value)} className="w-20 border rounded px-2 py-1.5 text-sm" />
                    <input type="text" placeholder="傷病名を検索..." value={diagnosisSearch} onChange={(e) => setDiagnosisSearch(e.target.value)} className="flex-1 border rounded px-3 py-1.5 text-sm" autoFocus />
                  </div>
                  <div className="space-y-1 max-h-80 overflow-y-auto">
                    {diagnosisMaster
                      .filter((d) => diagnosisSearch.length < 1 ? false : d.name.includes(diagnosisSearch) || d.code.toLowerCase().includes(diagnosisSearch.toLowerCase()))
                      .slice(0, 20)
                      .map((d) => (
                        <button
                          key={d.code}
                          onClick={() => { confirmDiagnosis({ tooth: selectedTooth, code: d.code, name: d.name, confidence: 1.0, reason: "手動選択" }); setPopup(null); setDiagnosisSearch(""); }}
                          className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-blue-50 flex items-center justify-between"
                        >
                          <span>{d.name}</span>
                          <span className="text-xs text-gray-400">{d.code} · {d.category}</span>
                        </button>
                      ))}
                    {diagnosisSearch.length > 0 && diagnosisMaster.filter((d) => d.name.includes(diagnosisSearch) || d.code.toLowerCase().includes(diagnosisSearch.toLowerCase())).length === 0 && (
                      <p className="text-center text-gray-400 text-sm py-4">該当なし</p>
                    )}
                    {diagnosisSearch.length < 1 && (
                      <div className="space-y-2">
                        <p className="text-xs text-gray-400">よく使う傷病名</p>
                        {["C2:う蝕(C2)", "C3:う蝕(C3)", "Pul:歯髄炎", "Per:根尖性歯周炎", "G:歯肉炎", "P2:歯周炎(P2)"].map((item) => {
                          const [code, name] = item.split(":");
                          return (
                            <button key={code} onClick={() => { confirmDiagnosis({ tooth: selectedTooth, code, name, confidence: 1.0, reason: "手動選択" }); setPopup(null); }} className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-blue-50">
                              {name} <span className="text-xs text-gray-400">{code}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 治療パターン */}
              {popup === "treatment" && (
                <div className="space-y-2">
                  {suggestedTreatments.length === 0 ? (
                    <p className="text-center text-gray-400 text-sm py-4">傷病名を確定すると治療パターンが表示されます</p>
                  ) : (
                    <>
                      {["restoration", "endo", "perio", "surgery", "prosth", "denture", "basic"].map((cat) => {
                        const catProcs = suggestedTreatments.filter((p) => p.category === cat);
                        if (catProcs.length === 0) return null;
                        return (
                          <div key={cat}>
                            <div className="text-xs text-gray-500 font-medium px-1 py-1 uppercase">{cat}</div>
                            {catProcs.map((proc, i) => (
                              <button key={i} onClick={() => { selectTreatment(proc); setPopup(null); }} className="w-full text-left px-3 py-2 text-sm border rounded hover:bg-blue-50 mb-1 flex justify-between">
                                <span>{proc.procedure_name}</span>
                                <span className="text-blue-700 font-medium">{proc.points}点</span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              )}

              {/* 算定プレビュー */}
              {popup === "billing" && (
                <div className="space-y-3">
                  {(medicalRecord.structured_procedures || []).length === 0 ? (
                    <p className="text-center text-gray-400 text-sm py-4">処置記録がありません</p>
                  ) : (
                    <>
                      {(medicalRecord.structured_procedures || []).map((proc, i) => (
                        <div key={i} className="flex justify-between text-sm border-b pb-2">
                          <div>
                            <div className="font-medium">{proc.procedure_name}</div>
                            <div className="text-xs text-gray-500">{proc.tooth ? `${proc.tooth}番 ` : ""}{proc.diagnosis_name}</div>
                          </div>
                          <div className="font-medium text-blue-700">{proc.points}点</div>
                        </div>
                      ))}
                      <div className="flex justify-between font-bold text-lg border-t pt-2">
                        <span>合計</span>
                        <span className="text-blue-700">{totalPoints}点</span>
                      </div>
                      <div className="text-right text-sm text-gray-500">3割負担: {Math.round(totalPoints * 10 * 0.3).toLocaleString()}円</div>
                      <button onClick={() => { setPopup(null); finalizeBilling(); }} className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700">算定確定 → 会計へ</button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==============================
// 歯式チャートコンポーネント
// ==============================
// ==============================
// 傷病歯式チャートコンポーネント（改訂版）
// ==============================
function DiagnosisToothChart({
  patientDiagnoses, pastDiagnoses, predictedDiagnoses, todayTeeth, scheduleConfirmed,
  onStatusChange, toothChart, onToothClick,
}: {
  patientDiagnoses: PatientDiagnosis[];
  pastDiagnoses: PatientDiagnosis[];
  predictedDiagnoses: DiagnosisWithTooth[];
  todayTeeth: string[];
  scheduleConfirmed: boolean;
  onStatusChange?: (diagId: string, status: PatientDiagnosis["status"]) => void;
  toothChart?: Record<string, ToothStatus>;
  onToothClick?: (tooth: number, diagName?: string) => void;
}) {
  const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

  const STATUS_CONFIG = {
    planned:      { label: "計画中",   bg: "bg-red-400",    text: "text-white",   border: "border-red-600" },
    in_treatment: { label: "治療中",   bg: "bg-orange-400", text: "text-white",   border: "border-orange-600" },
    completed:    { label: "治療済",   bg: "bg-green-500",  text: "text-white",   border: "border-green-700" },
    watching:     { label: "経過観",   bg: "bg-yellow-400", text: "text-gray-900",border: "border-yellow-600" },
  };

  const isMissing = (tooth: number) => {
    const s = toothChart?.[String(tooth)]?.status;
    return s === "missing" || s === "bridge_missing";
  };

  function getCurrentDiag(tooth: number) {
    return patientDiagnoses.find(d => d.tooth === String(tooth));
  }
  function getPastDiag(tooth: number) {
    return pastDiagnoses.find(d => d.tooth === String(tooth));
  }
  function getPredicted(tooth: number) {
    return predictedDiagnoses.find(d => d.tooth === String(tooth));
  }

  function ToothCell({ tooth }: { tooth: number }) {
    const missing = isMissing(tooth);
    const cur = getCurrentDiag(tooth);
    const past = getPastDiag(tooth);
    const pred = getPredicted(tooth);
    const isToday = todayTeeth.includes(String(tooth));

    // 欠損歯
    if (missing) {
      return (
        <div className="w-10 h-12 rounded border border-gray-300 bg-gray-100 flex flex-col items-center justify-center text-gray-400">
          <span style={{ fontSize: 9 }}>{tooth}</span>
          <span className="text-gray-400 font-bold" style={{ fontSize: 11 }}>×</span>
        </div>
      );
    }

    let style = "bg-white border border-gray-200 text-gray-400";
    let diagCode = "";
    let diagName = "";

    if (cur) {
      const cfg = STATUS_CONFIG[cur.status] || STATUS_CONFIG.planned;
      if (scheduleConfirmed) {
        style = isToday
          ? `${cfg.bg} ${cfg.text} border-2 ${cfg.border} ring-2 ring-offset-1 ring-indigo-400`
          : "bg-gray-100 text-gray-400 border border-gray-200 opacity-60";
      } else {
        style = `${cfg.bg} ${cfg.text} border-2 ${cfg.border}`;
      }
      diagCode = cur.diagnosis_code;
      diagName = cur.diagnosis_name;
    } else if (pred) {
      style = "bg-red-100 text-red-600 border border-red-300 border-dashed";
      diagCode = pred.short || pred.code;
      diagName = pred.name;
    } else if (past) {
      const cfg = STATUS_CONFIG[past.status] || STATUS_CONFIG.completed;
      style = `${cfg.bg} ${cfg.text} border ${cfg.border} opacity-40`;
      diagCode = past.diagnosis_code;
      diagName = past.diagnosis_name;
    }

    const tooltipLines = [
      cur && `${tooth}番: ${cur.diagnosis_name}（${STATUS_CONFIG[cur.status]?.label}）`,
      cur?.session_total && cur.session_total > 1 && `進捗: ${cur.session_current || 1}/${cur.session_total}回`,
      past && !cur && `前回: ${past.diagnosis_name}（${STATUS_CONFIG[past.status]?.label || ""}）`,
      pred && !cur && `予測: ${pred.name}`,
    ].filter(Boolean);

    return (
      <div className="relative group">
        {/* セル本体 - 大きめ */}
        <div
          className={`w-10 h-12 rounded text-xs flex flex-col items-center justify-center transition-all cursor-pointer gap-0.5 px-0.5 ${style}`}
          onClick={() => onToothClick && onToothClick(tooth, diagName || undefined)}
        >
          <span className="font-medium" style={{ fontSize: 9 }}>{tooth}</span>
          {diagCode && (
            <span className="font-bold leading-none text-center" style={{ fontSize: 8 }}>{diagCode}</span>
          )}
          {diagName && (
            <span className="leading-none text-center truncate w-full text-center" style={{ fontSize: 7 }}>{diagName.length > 5 ? diagName.slice(0, 5) + "…" : diagName}</span>
          )}
          {cur?.session_total && cur.session_total > 1 && (
            <span className="opacity-80" style={{ fontSize: 6 }}>{cur.session_current || 1}/{cur.session_total}</span>
          )}
        </div>
        {/* ホバーツールチップ */}
        {tooltipLines.length > 0 && (
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-50 hidden group-hover:block bg-gray-900 text-white text-xs rounded px-2 py-1.5 w-40 whitespace-normal pointer-events-none shadow-xl">
            {tooltipLines.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        )}
        {/* ステータス変更メニュー */}
        {cur && onStatusChange && (
          <div className="absolute top-13 left-0 z-50 hidden group-hover:block bg-white border rounded-lg shadow-lg p-1 w-24">
            {(Object.entries(STATUS_CONFIG) as [PatientDiagnosis["status"], typeof STATUS_CONFIG.planned][]).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => onStatusChange(cur.id, key)}
                className={`w-full text-left px-2 py-0.5 text-xs rounded mb-0.5 ${cfg.bg} ${cfg.text} hover:opacity-80`}
              >{cfg.label}</button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const hasDiagnoses = patientDiagnoses.length > 0 || predictedDiagnoses.length > 0 || pastDiagnoses.length > 0;

  return (
    <div>
      <div className="flex gap-1 mb-1 flex-wrap">
        {UPPER.map(t => <ToothCell key={t} tooth={t} />)}
      </div>
      <div className="flex gap-1 flex-wrap">
        {LOWER.map(t => <ToothCell key={t} tooth={t} />)}
      </div>
      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400 inline-block"></span>計画中</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400 inline-block"></span>治療中</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-500 inline-block"></span>治療済み</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-400 inline-block"></span>経過観察</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-100 border border-dashed border-red-300 inline-block"></span>予測（未確定）</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-300 inline-block text-center text-gray-400 font-bold" style={{fontSize:8}}>×</span>欠損</span>
      </div>
      {!hasDiagnoses && <p className="text-xs text-gray-400 mt-2">傷病名がまだありません</p>}
    </div>
  );
}

function ToothChart({
  chart, dim, onToothClick, editingTooth, onSetStatus,
}: {
  chart: Record<string, ToothStatus>;
  dim: boolean;
  onToothClick: (tooth: number) => void;
  editingTooth: number | null;
  onSetStatus: (tooth: number, status: string) => void;
}) {
  const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
  const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];

  const STATUS_OPTIONS = [
    // 健全・要観察
    { value: "healthy", label: "健全",    color: "bg-white border border-gray-300" },
    { value: "c0",      label: "C0",      color: "bg-yellow-100 border border-yellow-300 text-yellow-800" },
    // う蝕
    { value: "c1",      label: "C1",      color: "bg-red-200 text-red-800" },
    { value: "c2",      label: "C2",      color: "bg-red-400 text-white" },
    { value: "c3",      label: "C3",      color: "bg-red-600 text-white" },
    { value: "c4",      label: "C4",      color: "bg-red-900 text-white" },
    // 治療中
    { value: "in_treatment", label: "治療中", color: "bg-pink-400 text-white" },
    // 処置歯
    { value: "cr",      label: "CR",      color: "bg-blue-200 text-blue-800" },
    { value: "inlay",   label: "In",      color: "bg-cyan-300 text-cyan-900" },
    { value: "crown",   label: "Cr",      color: "bg-yellow-400 text-yellow-900" },
    // 欠損・ブリッジ
    { value: "missing",        label: "欠損",  color: "bg-gray-600 text-white" },
    { value: "implant",        label: "IP",    color: "bg-blue-500 text-white" },
    { value: "bridge",         label: "Br",    color: "bg-orange-400 text-white" },
    { value: "bridge_missing", label: "Br欠",  color: "bg-orange-200 text-orange-800" },
    { value: "root_remain",    label: "残根",  color: "bg-purple-700 text-white" },
    // 根管治療
    { value: "rct",     label: "RCT",     color: "bg-purple-400 text-white" },
    // 要注意
    { value: "watch",   label: "要注意",  color: "bg-yellow-500 text-white" },
  ];

  return (
    <div className={dim ? "opacity-40" : ""}>
      <div className="flex gap-0.5 mb-1">
        {UPPER.map((tooth) => (
          <div key={tooth} className="relative group">
            <button
              onClick={() => !dim && onToothClick(tooth)}
              className={`w-7 h-8 rounded text-xs flex flex-col items-center justify-center border ${toothStatusColor(chart[String(tooth)]?.status)} ${editingTooth === tooth ? "ring-2 ring-blue-500" : ""} ${!dim ? "hover:opacity-80" : "cursor-default"}`}
            >
              <span style={{ fontSize: 8 }}>{tooth}</span>
              <span style={{ fontSize: 7 }} className="truncate">{toothStatusLabel(chart[String(tooth)]?.status)}</span>
            </button>
            {/* tooltip */}
            {chart[String(tooth)]?.notes && !dim && (
              <div className="absolute bottom-9 left-1/2 -translate-x-1/2 z-50 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 w-40 whitespace-normal pointer-events-none shadow-lg">
                {chart[String(tooth)]?.notes}
              </div>
            )}
            {editingTooth === tooth && !dim && (
              <div className="absolute top-9 left-0 z-50 bg-white border rounded shadow-lg p-2 w-28">
                {STATUS_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => onSetStatus(tooth, opt.value)} className={`w-full text-left px-2 py-1 text-xs rounded mb-0.5 ${opt.color} hover:opacity-80`}>{opt.label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-0.5">
        {LOWER.map((tooth) => (
          <div key={tooth} className="relative group">
            <button
              onClick={() => !dim && onToothClick(tooth)}
              className={`w-7 h-8 rounded text-xs flex flex-col items-center justify-center border ${toothStatusColor(chart[String(tooth)]?.status)} ${editingTooth === tooth ? "ring-2 ring-blue-500" : ""} ${!dim ? "hover:opacity-80" : "cursor-default"}`}
            >
              <span style={{ fontSize: 8 }}>{tooth}</span>
              <span style={{ fontSize: 7 }} className="truncate">{toothStatusLabel(chart[String(tooth)]?.status)}</span>
            </button>
            {/* tooltip */}
            {chart[String(tooth)]?.notes && !dim && (
              <div className="absolute top-9 left-1/2 -translate-x-1/2 z-50 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 w-40 whitespace-normal pointer-events-none shadow-lg">
                {chart[String(tooth)]?.notes}
              </div>
            )}
            {editingTooth === tooth && !dim && (
              <div className="absolute bottom-9 left-0 z-50 bg-white border rounded shadow-lg p-2 w-28">
                {STATUS_OPTIONS.map((opt) => (
                  <button key={opt.value} onClick={() => onSetStatus(tooth, opt.value)} className={`w-full text-left px-2 py-1 text-xs rounded mb-0.5 ${opt.color} hover:opacity-80`}>{opt.label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
