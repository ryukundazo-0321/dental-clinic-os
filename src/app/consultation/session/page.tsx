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

const UPPER_RIGHT = ["18","17","16","15","14","13","12","11"];
const UPPER_LEFT = ["21","22","23","24","25","26","27","28"];
const LOWER_RIGHT = ["48","47","46","45","44","43","42","41"];
const LOWER_LEFT = ["31","32","33","34","35","36","37","38"];

const TOOTH_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  normal:  { label: "健全", color: "text-gray-500", bg: "bg-white", border: "border-gray-200" },
  caries:  { label: "C", color: "text-red-700", bg: "bg-red-50", border: "border-red-300" },
  treated: { label: "処置済", color: "text-blue-700", bg: "bg-blue-50", border: "border-blue-300" },
  crown:   { label: "冠", color: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-300" },
  missing: { label: "欠損", color: "text-gray-400", bg: "bg-gray-100", border: "border-gray-300" },
  implant: { label: "Imp", color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-300" },
  bridge:  { label: "Br", color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-300" },
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

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [timerRunning, setTimerRunning] = useState(false);

  const [isRecording, setIsRecording] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const [editingTooth, setEditingTooth] = useState<string | null>(null);

  const [aiResult, setAiResult] = useState<{
    soap: { s: string; o: string; a: string; p: string };
    tooth_updates: Record<string, string>;
    procedures: string[];
  } | null>(null);
  const [showAiPreview, setShowAiPreview] = useState(false);

  useEffect(() => { if (appointmentId) loadSession(); }, [appointmentId]);
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
      .eq("id", appointmentId).single();
    if (apt) {
      setPatient(apt.patients as unknown as Patient);
      const { data: rec } = await supabase.from("medical_records").select("*").eq("appointment_id", appointmentId).limit(1).single();
      if (rec) setRecord(rec as unknown as MedicalRecord);
    }
    setLoading(false);
  }

  function startTimer() {
    if (timerRunning) return;
    setTimerRunning(true);
    timerRef.current = setInterval(() => setElapsedSeconds(prev => prev + 1), 1000);
  }

  function formatTimer(s: number) {
    return `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mr;
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        stream.getTracks().forEach(t => t.stop());
        await analyzeAudio(blob);
      };
      mr.start();
      setIsRecording(true);
      startTimer();
    } catch { setSaveMsg("⚠️ マイクへのアクセスが拒否されました"); setTimeout(() => setSaveMsg(""), 3000); }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && isRecording) { mediaRecorderRef.current.stop(); setIsRecording(false); }
  }

  async function analyzeAudio(blob: Blob) {
    setAnalyzing(true);
    setSaveMsg("🤖 AI分析中...");
    try {
      const fd = new FormData();
      fd.append("audio", blob, "recording.webm");
      fd.append("existing_soap_s", record?.soap_s || "");
      const res = await fetch("/api/voice-analyze", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success) {
        setTranscript(data.transcript);
        setAiResult({ soap: data.soap, tooth_updates: data.tooth_updates, procedures: data.procedures });
        setShowAiPreview(true);
        setSaveMsg(data.warning ? `⚠️ ${data.warning}` : "✅ AI分析完了！");
      } else {
        setSaveMsg(`❌ ${data.error || "分析失敗"}`);
        if (data.transcript) setTranscript(data.transcript);
      }
    } catch { setSaveMsg("❌ AI分析に失敗しました"); }
    setAnalyzing(false);
    setTimeout(() => setSaveMsg(""), 5000);
  }

  function applyAiResult() {
    if (!record || !aiResult) return;
    const chart = { ...(record.tooth_chart || {}) };
    if (aiResult.tooth_updates) {
      Object.entries(aiResult.tooth_updates).forEach(([t, s]) => {
        const num = t.replace("#", "");
        if (TOOTH_STATUS[s]) chart[num] = s;
      });
    }
    setRecord({
      ...record,
      soap_s: aiResult.soap.s || record.soap_s,
      soap_o: aiResult.soap.o || record.soap_o,
      soap_a: aiResult.soap.a || record.soap_a,
      soap_p: aiResult.soap.p || record.soap_p,
      tooth_chart: chart,
    });
    setShowAiPreview(false);
    setSaveMsg("✅ 反映しました");
    setTimeout(() => setSaveMsg(""), 3000);
  }

  function updateSOAP(field: "soap_s"|"soap_o"|"soap_a"|"soap_p", value: string) {
    if (record) setRecord({ ...record, [field]: value });
  }

  function setToothState(num: string, status: string) {
    if (!record) return;
    const chart = { ...(record.tooth_chart || {}) };
    if (status === "normal") delete chart[num]; else chart[num] = status;
    setRecord({ ...record, tooth_chart: chart });
  }

  async function saveRecord() {
    if (!record) return;
    setSaving(true);
    await supabase.from("medical_records").update({
      soap_s: record.soap_s, soap_o: record.soap_o, soap_a: record.soap_a, soap_p: record.soap_p,
      tooth_chart: record.tooth_chart, status: "soap_complete",
    }).eq("id", record.id);
    setSaveMsg("保存しました ✅");
    setTimeout(() => setSaveMsg(""), 2000);
    setSaving(false);
  }

  async function completeSession() {
    if (!record || !appointmentId) return;
    if (!confirm("診察を完了してカルテを確定しますか？")) return;
    setSaving(true);
    await supabase.from("medical_records").update({
      soap_s: record.soap_s, soap_o: record.soap_o, soap_a: record.soap_a, soap_p: record.soap_p,
      tooth_chart: record.tooth_chart, status: "confirmed", doctor_confirmed: true,
    }).eq("id", record.id);
    await supabase.from("appointments").update({ status: "completed" }).eq("id", appointmentId);
    await supabase.from("queue").update({ status: "done" }).eq("appointment_id", appointmentId);
    if (timerRef.current) clearInterval(timerRef.current);
    setSaving(false);
    router.push("/consultation");
  }

  function getAge(dob: string) {
    const b = new Date(dob), t = new Date();
    let a = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
    return a;
  }

  function renderTooth(num: string) {
    const status = record?.tooth_chart?.[num] || "normal";
    const cfg = TOOTH_STATUS[status] || TOOTH_STATUS.normal;
    const editing = editingTooth === num;
    return (
      <div key={num} className="relative">
        <button onClick={() => setEditingTooth(editing ? null : num)}
          className={`w-9 h-9 rounded-lg text-[10px] font-bold border-2 transition-all ${cfg.bg} ${cfg.border} ${cfg.color} ${editing ? "ring-2 ring-sky-400 scale-110" : "hover:scale-105"}`}>
          {status === "normal" ? num : cfg.label}
        </button>
        {editing && (
          <div className="absolute z-30 top-full mt-1 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-xl border border-gray-200 p-2 min-w-[110px]">
            <p className="text-[10px] text-gray-400 text-center mb-1 font-bold">#{num}</p>
            {Object.entries(TOOTH_STATUS).map(([k, v]) => (
              <button key={k} onClick={() => { setToothState(num, k); setEditingTooth(null); }}
                className={`w-full text-left px-2 py-1 rounded-lg text-[11px] font-bold hover:bg-gray-50 ${status === k ? "bg-sky-50 text-sky-700" : "text-gray-700"}`}>
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;
  if (!patient || !record) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">予約情報が見つかりません</p></div>;

  const soapItems = [
    { key: "soap_s" as const, label: "S", title: "主観", color: "bg-red-500", borderColor: "border-red-200", placeholder: "患者さんの訴え・主訴" },
    { key: "soap_o" as const, label: "O", title: "客観", color: "bg-blue-500", borderColor: "border-blue-200", placeholder: "検査所見・口腔内所見" },
    { key: "soap_a" as const, label: "A", title: "評価", color: "bg-yellow-500", borderColor: "border-yellow-200", placeholder: "診断名・評価" },
    { key: "soap_p" as const, label: "P", title: "計画", color: "bg-green-500", borderColor: "border-green-200", placeholder: "治療計画・処置内容・次回予定" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-20">
        <div className="max-w-full mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/consultation" className="text-gray-400 hover:text-gray-600 text-sm font-bold">← 戻る</Link>
            <div className="flex items-center gap-3">
              <div className="bg-sky-100 text-sky-700 w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold">
                {patient.name_kanji.charAt(0)}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-bold text-gray-900">{patient.name_kanji}</h1>
                  <span className="text-xs text-gray-400">({patient.name_kana})</span>
                </div>
                <p className="text-xs text-gray-400">{getAge(patient.date_of_birth)}歳 / {patient.insurance_type} {patient.burden_ratio * 10}割</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {saveMsg && <span className="text-sm font-bold text-green-600 bg-green-50 px-3 py-1 rounded-full">{saveMsg}</span>}

            {/* タイマー */}
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full font-mono text-lg font-bold ${isRecording ? "bg-red-50 text-red-600 border border-red-200" : "bg-gray-100 text-gray-600"}`}>
              {isRecording && <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />}
              {formatTimer(elapsedSeconds)}
            </div>

            {/* 録音ボタン */}
            {analyzing ? (
              <div className="bg-amber-100 text-amber-700 px-5 py-2.5 rounded-full text-sm font-bold flex items-center gap-2">
                <span className="animate-spin">⚙️</span> AI分析中...
              </div>
            ) : isRecording ? (
              <button onClick={stopRecording}
                className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-full text-sm font-bold flex items-center gap-2 shadow-lg shadow-red-200 animate-pulse">
                ⏹️ 記録停止
              </button>
            ) : (
              <button onClick={startRecording}
                className="bg-sky-600 hover:bg-sky-700 text-white px-5 py-2.5 rounded-full text-sm font-bold flex items-center gap-2 shadow-lg shadow-sky-200">
                🎙️ 記録開始
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-4">
        <div className="flex gap-4">
          {/* 左: SOAP */}
          <div className="flex-1 space-y-3">
            {/* 文字起こし */}
            {transcript && (
              <div className="bg-white rounded-xl border border-gray-200 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-400">📝 音声文字起こし</span>
                  <button onClick={() => setTranscript("")} className="text-gray-300 hover:text-gray-500 text-xs">✕</button>
                </div>
                <p className="text-sm text-gray-600 leading-relaxed max-h-20 overflow-y-auto">{transcript}</p>
              </div>
            )}

            {/* SOAP 4分割 */}
            <div className="grid grid-cols-2 gap-3">
              {soapItems.map((item) => (
                <div key={item.key} className={`bg-white rounded-xl border ${item.borderColor} overflow-hidden`}>
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100">
                    <span className={`w-6 h-6 rounded-md text-[11px] font-bold flex items-center justify-center text-white ${item.color}`}>{item.label}</span>
                    <span className="text-sm font-bold text-gray-700">{item.title}</span>
                    {record[item.key] && <span className="w-2 h-2 rounded-full bg-green-400 ml-auto" />}
                  </div>
                  <textarea
                    value={record[item.key] || ""}
                    onChange={(e) => updateSOAP(item.key, e.target.value)}
                    placeholder={item.placeholder}
                    rows={6}
                    className="w-full px-3 py-2 text-sm text-gray-700 placeholder-gray-300 focus:outline-none resize-none leading-relaxed"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 右: 歯式 + 情報 + ボタン */}
          <div className="w-[340px] flex-shrink-0 space-y-3">
            {/* 歯式チャート */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700">🦷 歯式チャート</h3>
                <span className="text-[10px] text-gray-400">タップで状態変更</span>
              </div>
              <div className="flex flex-col items-center gap-1">
                {/* 上顎 */}
                <div className="flex items-center gap-0.5">
                  <span className="text-[9px] text-gray-300 w-6 text-right mr-1">右</span>
                  <div className="flex gap-0.5">
                    {UPPER_RIGHT.map(t => renderTooth(t))}
                  </div>
                  <div className="w-px h-8 bg-gray-300 mx-1" />
                  <div className="flex gap-0.5">
                    {UPPER_LEFT.map(t => renderTooth(t))}
                  </div>
                  <span className="text-[9px] text-gray-300 w-6 ml-1">左</span>
                </div>
                {/* 区切り線 */}
                <div className="w-full flex items-center gap-1 my-0.5">
                  <span className="text-[9px] text-gray-300 w-6 text-right mr-1">右</span>
                  <div className="flex-1 border-t-2 border-gray-300" />
                  <span className="text-[9px] text-gray-300 w-6 ml-1">左</span>
                </div>
                {/* 下顎 */}
                <div className="flex items-center gap-0.5">
                  <span className="text-[9px] text-gray-300 w-6 text-right mr-1" />
                  <div className="flex gap-0.5">
                    {LOWER_RIGHT.map(t => renderTooth(t))}
                  </div>
                  <div className="w-px h-8 bg-gray-300 mx-1" />
                  <div className="flex gap-0.5">
                    {LOWER_LEFT.map(t => renderTooth(t))}
                  </div>
                  <span className="text-[9px] text-gray-300 w-6 ml-1" />
                </div>
              </div>
              {/* 凡例 */}
              <div className="flex flex-wrap gap-1.5 mt-3 justify-center">
                {Object.entries(TOOTH_STATUS).map(([k, v]) => (
                  <span key={k} className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${v.border} ${v.bg} ${v.color}`}>{v.label}</span>
                ))}
              </div>
            </div>

            {/* 患者情報 */}
            <div className="bg-white rounded-xl border border-gray-200 p-3">
              <h3 className="text-xs font-bold text-gray-400 mb-2">患者情報</h3>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-400">生年月日</span><span className="text-gray-700 font-bold">{patient.date_of_birth}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">電話</span><span className="text-gray-700 font-bold">{patient.phone}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">保険</span><span className="text-gray-700 font-bold">{patient.insurance_type} {patient.burden_ratio * 10}割</span></div>
              </div>
            </div>

            {/* アクションボタン */}
            <div className="space-y-2">
              <button onClick={saveRecord} disabled={saving}
                className="w-full bg-white border-2 border-sky-500 text-sky-600 py-3 rounded-xl text-sm font-bold hover:bg-sky-50 disabled:opacity-50 transition-colors">
                💾 一時保存
              </button>
              <button onClick={completeSession} disabled={saving}
                className="w-full bg-green-600 text-white py-3.5 rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200 transition-colors">
                ✅ 診察完了（カルテ確定）
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* AI結果プレビューモーダル */}
      {showAiPreview && aiResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full max-h-[85vh] overflow-y-auto shadow-2xl">
            <div className="text-center mb-5">
              <span className="text-4xl">🤖</span>
              <h3 className="text-xl font-bold text-gray-900 mt-2">この処置内容であっていますか？</h3>
              <p className="text-sm text-gray-400 mt-1">AI分析結果を確認してください</p>
            </div>

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
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(aiResult.tooth_updates).map(([tooth, status]) => (
                      <span key={tooth} className="bg-white border border-gray-200 px-2.5 py-1 rounded-lg text-xs font-bold text-gray-700">
                        #{tooth.replace("#", "")}: {TOOTH_STATUS[status]?.label || status}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {aiResult.procedures.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 border border-gray-200">
                  <p className="text-xs text-gray-500 font-bold mb-1">🔧 本日の処置</p>
                  <div className="flex flex-wrap gap-2">
                    {aiResult.procedures.map((p, i) => (
                      <span key={i} className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-sm font-bold">{p}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={applyAiResult}
                className="flex-1 bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 shadow-lg shadow-green-200 active:scale-[0.98]">
                ✅ OKです！反映する
              </button>
              <button onClick={() => { setShowAiPreview(false); setSaveMsg("手動で修正してください"); setTimeout(() => setSaveMsg(""), 3000); }}
                className="flex-1 bg-gray-100 text-gray-700 py-4 rounded-xl font-bold hover:bg-gray-200">
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
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>}>
      <SessionContent />
    </Suspense>
  );
}
