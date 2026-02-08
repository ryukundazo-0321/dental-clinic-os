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
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 音声メモ（将来AI連携のプレースホルダー）
  const [voiceMemo, setVoiceMemo] = useState("");

  // 歯式ポップアップ
  const [editingTooth, setEditingTooth] = useState<string | null>(null);

  // SOAPタブ
  const [activeSOAP, setActiveSOAP] = useState<"s" | "o" | "a" | "p">("s");

  useEffect(() => {
    if (appointmentId) loadSession();
  }, [appointmentId]);

  // タイマーのクリーンアップ
  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
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

  // タイマー開始/停止
  function toggleRecording() {
    if (isRecording) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setIsRecording(false);
    } else {
      setIsRecording(true);
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    }
  }

  function formatTimer(seconds: number) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
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

  // 音声メモをSOAP-Sに追加
  function appendMemoToSOAP() {
    if (!record || !voiceMemo.trim()) return;
    const current = record.soap_s || "";
    const updated = current ? `${current}\n\n【音声メモ】${voiceMemo}` : `【音声メモ】${voiceMemo}`;
    setRecord({ ...record, soap_s: updated });
    setVoiceMemo("");
    setSaveMsg("メモをSOAP-Sに追加しました");
    setTimeout(() => setSaveMsg(""), 2000);
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

  // 診察完了（カルテ確定 + ステータス遷移）
  async function completeSession() {
    if (!record || !appointmentId) return;
    if (!confirm("診察を完了してカルテを確定しますか？")) return;
    setSaving(true);

    // カルテ確定
    await supabase.from("medical_records").update({
      soap_s: record.soap_s, soap_o: record.soap_o,
      soap_a: record.soap_a, soap_p: record.soap_p,
      tooth_chart: record.tooth_chart,
      status: "confirmed", doctor_confirmed: true,
    }).eq("id", record.id);

    // 予約ステータスを完了に
    await supabase.from("appointments").update({ status: "completed" }).eq("id", appointmentId);

    // キューを完了に
    await supabase.from("queue").update({ status: "done" }).eq("appointment_id", appointmentId);

    // タイマー停止
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRecording(false);

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
            {saveMsg && <span className="text-green-400 text-sm">{saveMsg}</span>}
            {/* タイマー */}
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${isRecording ? "bg-red-600/20 border border-red-500" : "bg-gray-700"}`}>
              {isRecording && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
              <span className="font-mono text-lg font-bold">{formatTimer(elapsedSeconds)}</span>
            </div>
            <button onClick={toggleRecording}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                isRecording ? "bg-red-600 hover:bg-red-700" : "bg-green-600 hover:bg-green-700"
              }`}>
              {isRecording ? "⏸ 記録停止" : "🎙️ 記録開始"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-3">
        <div className="flex gap-3 h-[calc(100vh-120px)]">
          {/* 左: SOAP + 音声メモ */}
          <div className="flex-1 flex flex-col">
            {/* 音声メモ（将来AI連携） */}
            <div className="bg-gray-800 rounded-xl p-3 mb-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-bold text-gray-300">🎙️ 音声メモ</span>
                {isRecording && <span className="text-xs text-red-400 animate-pulse">録音中...</span>}
                <span className="text-xs text-gray-500 ml-auto">※ 将来: 音声AIが自動でSOAPに変換します</span>
              </div>
              <div className="flex gap-2">
                <textarea
                  value={voiceMemo}
                  onChange={(e) => setVoiceMemo(e.target.value)}
                  placeholder="診察中のメモをここに入力（音声AI連携後は自動入力されます）"
                  rows={2}
                  className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-sky-500 resize-none"
                />
                <button onClick={appendMemoToSOAP} disabled={!voiceMemo.trim()}
                  className="bg-sky-600 text-white px-3 rounded-lg text-xs font-bold hover:bg-sky-700 disabled:opacity-30 whitespace-nowrap">
                  S に追加
                </button>
              </div>
            </div>

            {/* SOAPタブ */}
            <div className="flex gap-1 mb-2">
              {soapTabs.map((tab) => (
                <button key={tab.key} onClick={() => setActiveSOAP(tab.key)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-bold transition-colors ${
                    activeSOAP === tab.key ? "bg-gray-800 text-white" : "bg-gray-700/50 text-gray-400 hover:text-gray-300"
                  }`}>
                  <span className={`w-5 h-5 rounded text-[10px] flex items-center justify-center text-white ${tab.color}`}>{tab.label}</span>
                  {tab.title}
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
                    {UPPER_RIGHT.map((t) => renderTooth(t))}
                  </div>
                  <div className="flex gap-0.5 pl-0.5">
                    {UPPER_LEFT.map((t) => renderTooth(t))}
                  </div>
                </div>
                <div className="w-full border-t-2 border-gray-500 my-0.5" />
                <div className="flex gap-0.5">
                  <div className="flex gap-0.5 border-r-2 border-gray-500 pr-0.5">
                    {LOWER_RIGHT.map((t) => renderTooth(t))}
                  </div>
                  <div className="flex gap-0.5 pl-0.5">
                    {LOWER_LEFT.map((t) => renderTooth(t))}
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
