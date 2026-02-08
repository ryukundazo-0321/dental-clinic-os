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

const UPPER_RIGHT = ["18", "17", "16", "15", "14", "13", "12", "11"];
const UPPER_LEFT = ["21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER_RIGHT = ["48", "47", "46", "45", "44", "43", "42", "41"];
const LOWER_LEFT = ["31", "32", "33", "34", "35", "36", "37", "38"];

const TOOTH_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  normal: { label: "健全", color: "text-green-700", bg: "bg-green-100" },
  caries: { label: "C", color: "text-red-700", bg: "bg-red-100" },
  treated: { label: "処置済", color: "text-blue-700", bg: "bg-blue-100" },
  crown: { label: "冠", color: "text-yellow-700", bg: "bg-yellow-100" },
  missing: { label: "欠損", color: "text-gray-500", bg: "bg-gray-200" },
  implant: { label: "Imp", color: "text-purple-700", bg: "bg-purple-100" },
  bridge: { label: "Br", color: "text-orange-700", bg: "bg-orange-100" },
};

function SessionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const appointmentId = searchParams.get("appointment_id");

  const [patient, setPatient] = useState<Patient | null>(null);
  const [record, setRecord] = useState<MedicalRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // 診察タイマー
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);

  // 音声録音
  const [isRecording, setIsRecording] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  // 歯式ポップアップ
  const [editingTooth, setEditingTooth] = useState<string | null>(null);

  // SOAPタブ
  const [activeSOAP, setActiveSOAP] = useState<"s" | "o" | "a" | "p">("s");

  // AI結果プレビュー
  const [aiResult, setAiResult] = useState<{
    soap: { s: string; o: string; a: string; p: string };
    tooth_updates: Record<string, string>;
    procedures: string[];
  } | null>(null);
  const [showAiPreview, setShowAiPreview] = useState(false);

  useEffect(() => {
    if (appointmentId) loadSession();
  }, [appointmentId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  async function loadSession() {
    setLoading(true);
    const { data: apt } = await supabase
      .from("appointments")
      .select(`id, patient_id, patients ( id, name_kanji, name_kana, date_of_birth, phone, insurance_type, burden_ratio )`)
      .eq("id", appointmentId)
      .single();

    if (apt) {
      setPatient(apt.patients as unknown as Patient);
      const { data: rec } = await supabase
        .from("medical_records")
        .select("*")
        .eq("appointment_id", appointmentId)
        .limit(1)
        .single();
      if (rec) setRecord(rec as unknown as MedicalRecord);
    }
    setLoading(false);
  }

  // タイマー
  function startTimer() {
    if (timerRunning) return;
    setTimerRunning(true);
    timerRef.current = setInterval(() => setElapsedSeconds(prev => prev + 1), 1000);
  }

  function formatTimer(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  // ===== 音声録音 =====
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        await analyzeAudio(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      startTimer();
    } catch (err) {
      setSaveMsg("マイクへのアクセスが拒否されました");
      setTimeout(() => setSaveMsg(""), 3000);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }

  // ===== AI分析 =====
  async function analyzeAudio(audioBlob: Blob) {
    setAnalyzing(true);
    setSaveMsg("🤖 AI分析中...");

    try {
      const formData = new FormData();
      formData.append("audio", audioBlob, "recording.webm");
      formData.append("existing_soap_s", record?.soap_s || "");

      const response = await fetch("/api/voice-analyze", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (data.success) {
        setTranscript(data.transcript);
        setAiResult({
          soap: data.soap,
          tooth_updates: data.tooth_updates,
          procedures: data.procedures,
        });
        setShowAiPreview(true);
        if (data.warning) {
          setSaveMsg(`⚠️ ${data.warning}`);
        } else {
          setSaveMsg("✅ AI分析完了！内容を確認してください");
        }
      } else {
        setSaveMsg(`❌ ${data.error || "分析に失敗しました"}`);
        if (data.transcript) setTranscript(data.transcript);
      }
    } catch (err) {
      setSaveMsg("❌ AI分析に失敗しました");
    }

    setAnalyzing(false);
    setTimeout(() => setSaveMsg(""), 5000);
  }

  // AI結果を反映
  function applyAiResult() {
    if (!record || !aiResult) return;
    const updatedChart = { ...(record.tooth_chart || {}) };

    // 歯式更新
    if (aiResult.tooth_updates) {
      Object.entries(aiResult.tooth_updates).forEach(([tooth, status]) => {
        const num = tooth.replace("#", "");
        if (TOOTH_STATUS[status]) {
          updatedChart[num] = status;
        }
      });
    }

    setRecord({
      ...record,
      soap_s: aiResult.soap.s || record.soap_s,
      soap_o: aiResult.soap.o || record.soap_o,
      soap_a: aiResult.soap.a || record.soap_a,
      soap_p: aiResult.soap.p || record.soap_p,
      tooth_chart: updatedChart,
    });

    setShowAiPreview(false);
    setSaveMsg("✅ AI結果を反映しました");
    setTimeout(() => setSaveMsg(""), 3000);
  }

  // SOAP更新
  function updateSOAP(field: "soap_s" | "soap_o" | "soap_a" | "soap_p", value: string) {
    if (record) setRecord({ ...record, [field]: value });
  }

  // 歯の状態変更
  function setToothStatus(toothNum: string, status: string) {
    if (!record) return;
    const chart = { ...(record.tooth_chart || {}) };
    if (status === "normal") { delete chart[toothNum]; } else { chart[toothNum] = status; }
    setRecord({ ...record, tooth_chart: chart });
  }

  // 一時保存
  async function saveRecord() {
    if (!record) return;
    setSaving(true);
    await supabase.from("medical_records").update({
      soap_s: record.soap_s, soap_o: record.soap_o,
      soap_a: record.soap_a, soap_p: record.soap_p,
      tooth_chart: record.tooth_chart, status: "soap_complete",
    }).eq("id", record.id);
    setSaveMsg("保存しました ✅");
    setTimeout(() => setSaveMsg(""), 2000);
    setSaving(false);
  }

  // 診察完了
  async function completeSession() {
    if (!record || !appointmentId) return;
    if (!confirm("診察を完了してカルテを確定しますか？")) return;
    setSaving(true);

    await supabase.from("medical_records").update({
      soap_s: record.soap_s, soap_o: record.soap_o,
      soap_a: record.soap_a, soap_p: record.soap_p,
      tooth_chart: record.tooth_chart,
      status: "confirmed", doctor_confirmed: true,
    }).eq("id", record.id);

    await supabase.from("appointments").update({ status: "completed" }).eq("id", appointmentId);
    await supabase.from("queue").update({ status: "done" }).eq("appointment_id", appointmentId);

    if (timerRef.current) clearInterval(timerRef.current);
    setSaving(false);
    router.push("/consultation");
  }

  function getAge(dob: string) {
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    return age;
  }

  function renderTooth(toothNum: string) {
    const status = record?.tooth_chart?.[toothNum] || "normal";
    const config = TOOTH_STATUS[status] || TOOTH_STATUS.normal;
    const isEditing = editingTooth === toothNum;
    return (
      <div key={toothNum} className="relative">
        <button onClick={() => setEditingTooth(isEditing ? null : toothNum)}
          className={`w-8 h-8 rounded text-[9px] font-bold border transition-all ${
            status === "normal" ? "bg-white border-gray-200 text-gray-500 hover:border-sky-300" : `${config.bg} border-transparent ${config.color}`
          } ${isEditing ? "ring-2 ring-sky-400" : ""}`}>
          {status === "normal" ? toothNum : config.label}
        </button>
        {isEditing && (
          <div className="absolute z-20 top-full mt-1 left-1/2 -translate-x-1/2 bg-white rounded-lg shadow-lg border border-gray-200 p-1.5 min-w-[100px]">
            <p className="text-[9px] text-gray-400 text-center mb-0.5">#{toothNum}</p>
            {Object.entries(TOOTH_STATUS).map(([key, val]) => (
              <button key={key} onClick={() => { setToothStatus(toothNum, key); setEditingTooth(null); }}
                className={`w-full text-left px-1.5 py-0.5 rounded text-[10px] font-bold hover:bg-gray-50 ${status === key ? "bg-sky-50 text-sky-700" : "text-gray-700"}`}>
                {val.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (loading) return <div className="min-h-screen bg-gray-900 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;
  if (!patient || !record) return <div className="min-h-screen bg-gray-900 flex items-center justify-center"><p className="text-gray-400">予約情報が見つかりません</p></div>;

  const soapTabs = [
    { key: "s" as const, label: "S", title: "主観", color: "bg-red-500", field: "soap_s" as const, placeholder: "患者さんの訴え・主訴" },
    { key: "o" as const, label: "O", title: "客観", color: "bg-blue-500", field: "soap_o" as const, placeholder: "検査所見・口腔内所見" },
    { key: "a" as const, label: "A", title: "評価", color: "bg-yellow-500", field: "soap_a" as const, placeholder: "診断名・評価" },
    { key: "p" as const, label: "P", title: "計画", color: "bg-green-500", field: "soap_p" as const, placeholder: "治療計画・処置内容・次回予定" },
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* ヘッダー */}
      <header className="bg-gray-800 border-b border-gray-700">
        <div className="max-w-full mx-auto px-4 py-2 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/consultation" className="text-gray-400 hover:text-white text-sm">← 戻る</Link>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold">{patient.name_kanji}</h1>
                <span className="text-xs text-gray-400">({patient.name_kana})</span>
                <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">
                  {getAge(patient.date_of_birth)}歳 / {patient.insurance_type}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {saveMsg && <span className="text-green-400 text-sm font-bold">{saveMsg}</span>}

            {/* タイマー */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isRecording ? "bg-red-600/20 border border-red-500" : "bg-gray-700"}`}>
              {isRecording && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
              <span className="font-mono text-lg font-bold">{formatTimer(elapsedSeconds)}</span>
            </div>

            {/* 録音ボタン */}
            {analyzing ? (
              <div className="bg-yellow-600 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
                <span className="animate-spin">⚙️</span> AI分析中...
              </div>
            ) : isRecording ? (
              <button onClick={stopRecording}
                className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 animate-pulse">
                ⏹️ 記録停止（AI分析へ）
              </button>
            ) : (
              <button onClick={startRecording}
                className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
                🎙️ 記録開始
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-3">
        <div className="flex gap-3 h-[calc(100vh-120px)]">
          {/* 左: SOAP + 文字起こし */}
          <div className="flex-1 flex flex-col">
            {/* 文字起こし結果 */}
            {transcript && (
              <div className="bg-gray-800 rounded-xl p-3 mb-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-400">📝 音声文字起こし結果</span>
                  <button onClick={() => setTranscript("")} className="text-xs text-gray-500 hover:text-gray-300">✕</button>
                </div>
                <p className="text-sm text-gray-300 leading-relaxed max-h-24 overflow-y-auto">{transcript}</p>
              </div>
            )}

            {/* SOAPタブ */}
            <div className="flex gap-1 mb-2">
              {soapTabs.map((tab) => (
                <button key={tab.key} onClick={() => setActiveSOAP(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-bold transition-colors ${
                    activeSOAP === tab.key ? "bg-gray-800 text-white" : "bg-gray-700/50 text-gray-400 hover:text-gray-300"
                  }`}>
                  <span className={`w-5 h-5 rounded text-[10px] flex items-center justify-center text-white ${tab.color}`}>{tab.label}</span>
                  {tab.title}
                  {record[tab.field] && <span className="w-1.5 h-1.5 rounded-full bg-green-400 ml-1" />}
                </button>
              ))}
            </div>

            {/* SOAP入力エリア */}
            <div className="flex-1 bg-gray-800 rounded-xl rounded-tl-none p-4">
              {soapTabs.map((tab) => (
                activeSOAP === tab.key && (
                  <textarea
                    key={tab.key}
                    value={record[tab.field] || ""}
                    onChange={(e) => updateSOAP(tab.field, e.target.value)}
                    placeholder={tab.placeholder}
                    className="w-full h-full bg-transparent text-white placeholder-gray-500 text-sm focus:outline-none resize-none leading-relaxed"
                  />
                )
              ))}
            </div>
          </div>

          {/* 右: 歯式 + アクション */}
          <div className="w-80 flex-shrink-0 flex flex-col gap-3">
            {/* 歯式チャート */}
            <div className="bg-gray-800 rounded-xl p-3">
              <h3 className="text-sm font-bold text-gray-300 mb-2">🦷 歯式</h3>
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex gap-0.5">
                  <div className="flex gap-0.5 border-r-2 border-gray-500 pr-0.5">
                    {UPPER_RIGHT.map(t => renderTooth(t))}
                  </div>
                  <div className="flex gap-0.5 pl-0.5">
                    {UPPER_LEFT.map(t => renderTooth(t))}
                  </div>
                </div>
                <div className="w-full border-t-2 border-gray-500 my-0.5" />
                <div className="flex gap-0.5">
                  <div className="flex gap-0.5 border-r-2 border-gray-500 pr-0.5">
                    {LOWER_RIGHT.map(t => renderTooth(t))}
                  </div>
                  <div className="flex gap-0.5 pl-0.5">
                    {LOWER_LEFT.map(t => renderTooth(t))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-2 justify-center">
                {Object.entries(TOOTH_STATUS).map(([key, val]) => (
                  <span key={key} className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${val.bg} ${val.color}`}>{val.label}</span>
                ))}
              </div>
            </div>

            {/* 患者情報 */}
            <div className="bg-gray-800 rounded-xl p-3">
              <h3 className="text-sm font-bold text-gray-300 mb-2">患者情報</h3>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">生年月日</span><span>{patient.date_of_birth}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">電話</span><span>{patient.phone}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">保険</span><span>{patient.insurance_type} {patient.burden_ratio * 10}割</span></div>
              </div>
            </div>

            {/* 使い方ガイド */}
            <div className="bg-gray-800/50 rounded-xl p-3">
              <p className="text-[10px] text-gray-500 leading-relaxed">
                💡 <strong>使い方:</strong> 「記録開始」→ 診察中の会話を録音 → 「記録停止」→ AIがSOAP+歯式を自動入力 → 内容確認 → 確定
              </p>
            </div>

            {/* アクションボタン */}
            <div className="space-y-2 mt-auto">
              <button onClick={saveRecord} disabled={saving}
                className="w-full bg-sky-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-sky-700 disabled:opacity-50">
                {saving ? "保存中..." : "💾 一時保存"}
              </button>
              <button onClick={completeSession} disabled={saving}
                className="w-full bg-green-600 text-white py-3 rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                ✅ 診察完了（カルテ確定）
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* AI結果プレビューモーダル - 設計書3.3.2「この処置内容であっていますか？」 */}
      {showAiPreview && aiResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-2xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto">
            <div className="text-center mb-4">
              <span className="text-4xl">🤖</span>
              <h3 className="text-xl font-bold mt-2">この処置内容であっていますか？</h3>
              <p className="text-sm text-gray-400 mt-1">AI分析結果を確認して、問題なければ反映してください</p>
            </div>

            <div className="space-y-3 mb-6">
              {[
                { label: "S 主観（患者の訴え）", value: aiResult.soap.s, color: "border-red-500", bg: "bg-red-500/10" },
                { label: "O 客観（検査所見）", value: aiResult.soap.o, color: "border-blue-500", bg: "bg-blue-500/10" },
                { label: "A 評価（診断名）", value: aiResult.soap.a, color: "border-yellow-500", bg: "bg-yellow-500/10" },
                { label: "P 計画（処置・次回予定）", value: aiResult.soap.p, color: "border-green-500", bg: "bg-green-500/10" },
              ].map((item) => (
                <div key={item.label} className={`border-l-4 ${item.color} ${item.bg} rounded-r-lg p-3`}>
                  <p className="text-xs text-gray-400 font-bold mb-1">{item.label}</p>
                  <p className="text-sm text-gray-200 whitespace-pre-wrap">{item.value || "（該当なし）"}</p>
                </div>
              ))}

              {aiResult.tooth_updates && Object.keys(aiResult.tooth_updates).length > 0 && (
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 font-bold mb-1">🦷 歯式更新</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(aiResult.tooth_updates).map(([tooth, status]) => (
                      <span key={tooth} className="bg-gray-600 px-2 py-1 rounded text-xs">
                        #{tooth.replace("#", "")}: {TOOTH_STATUS[status]?.label || status}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {aiResult.procedures.length > 0 && (
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 font-bold mb-1">🔧 本日の処置</p>
                  <div className="flex flex-wrap gap-2">
                    {aiResult.procedures.map((p, i) => (
                      <span key={i} className="bg-green-600/30 text-green-300 px-3 py-1 rounded-full text-sm font-bold">{p}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={applyAiResult}
                className="flex-1 bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 active:scale-[0.98]">
                ✅ OKです！反映する
              </button>
              <button onClick={() => { setShowAiPreview(false); setSaveMsg("手動で修正してください"); setTimeout(() => setSaveMsg(""), 3000); }}
                className="flex-1 bg-gray-600 text-white py-4 rounded-xl font-bold hover:bg-gray-500">
                ✏️ 修正が必要
              </button>
            </div>
          </div>
        </div>
      )}

      {editingTooth && <div className="fixed inset-0 z-10" onClick={() => setEditingTooth(null)} />}
    </div>
  );
}

export default function ConsultationSessionPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-900 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>}>
      <SessionContent />
    </Suspense>
  );
}
