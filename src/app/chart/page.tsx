"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Patient = {
  id: string;
  name_kanji: string;
  name_kana: string;
  date_of_birth: string;
  phone: string;
  insurance_type: string;
  burden_ratio: number;
  is_new: boolean;
};

type MedicalRecord = {
  id: string;
  appointment_id: string;
  patient_id: string;
  status: string;
  soap_s: string | null;
  soap_o: string | null;
  soap_a: string | null;
  soap_p: string | null;
  tooth_chart: Record<string, string> | null;
  doctor_confirmed: boolean;
  created_at: string;
  appointments: {
    scheduled_at: string;
    patient_type: string;
    status: string;
    doctor_id: string | null;
  } | null;
};

type ViewMode = "search" | "patient_detail";

// 歯式の歯番号定義（FDI表記）
const UPPER_RIGHT = ["18", "17", "16", "15", "14", "13", "12", "11"];
const UPPER_LEFT = ["21", "22", "23", "24", "25", "26", "27", "28"];
const LOWER_RIGHT = ["48", "47", "46", "45", "44", "43", "42", "41"];
const LOWER_LEFT = ["31", "32", "33", "34", "35", "36", "37", "38"];

// 歯の状態
const TOOTH_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  normal: { label: "健全", color: "text-green-700", bg: "bg-green-100" },
  caries: { label: "C", color: "text-red-700", bg: "bg-red-100" },
  treated: { label: "処置済", color: "text-blue-700", bg: "bg-blue-100" },
  crown: { label: "冠", color: "text-yellow-700", bg: "bg-yellow-100" },
  missing: { label: "欠損", color: "text-gray-500", bg: "bg-gray-200" },
  implant: { label: "Imp", color: "text-purple-700", bg: "bg-purple-100" },
  bridge: { label: "Br", color: "text-orange-700", bg: "bg-orange-100" },
};

export default function ChartPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchResults, setSearchResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<MedicalRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // 今日の予約で来院している患者を取得
  const [todayPatients, setTodayPatients] = useState<
    { patient: Patient; appointment_status: string; record_id: string | null }[]
  >([]);

  useEffect(() => {
    loadTodayPatients();
  }, []);

  async function loadTodayPatients() {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("appointments")
      .select(`
        status,
        patients ( id, name_kanji, name_kana, date_of_birth, phone, insurance_type, burden_ratio, is_new ),
        medical_records ( id )
      `)
      .gte("scheduled_at", `${today}T00:00:00+09:00`)
      .lte("scheduled_at", `${today}T23:59:59+09:00`)
      .in("status", ["checked_in", "in_consultation", "completed"])
      .order("scheduled_at", { ascending: true });

    if (data) {
      const list = data
        .filter((d: Record<string, unknown>) => d.patients)
        .map((d: Record<string, unknown>) => ({
          patient: d.patients as unknown as Patient,
          appointment_status: d.status as string,
          record_id: (d.medical_records as { id: string }[])?.[0]?.id || null,
        }));
      setTodayPatients(list);
    }
  }

  // 患者検索
  async function searchPatients(query: string) {
    setSearchQuery(query);
    if (query.length < 1) {
      setSearchResults([]);
      return;
    }

    const { data } = await supabase
      .from("patients")
      .select("*")
      .or(`name_kanji.ilike.%${query}%,name_kana.ilike.%${query}%,phone.ilike.%${query}%`)
      .order("created_at", { ascending: false })
      .limit(20);

    if (data) setSearchResults(data);
  }

  // 患者選択 → カルテ一覧を取得
  async function selectPatient(patient: Patient) {
    setSelectedPatient(patient);
    setViewMode("patient_detail");

    const { data } = await supabase
      .from("medical_records")
      .select(`
        id, appointment_id, patient_id, status, soap_s, soap_o, soap_a, soap_p,
        tooth_chart, doctor_confirmed, created_at,
        appointments ( scheduled_at, patient_type, status, doctor_id )
      `)
      .eq("patient_id", patient.id)
      .order("created_at", { ascending: false });

    if (data) {
      setRecords(data as unknown as MedicalRecord[]);
      if (data.length > 0) setSelectedRecord(data[0] as unknown as MedicalRecord);
    }
  }

  // SOAP保存
  async function saveSOAP() {
    if (!selectedRecord) return;
    setSaving(true);

    await supabase
      .from("medical_records")
      .update({
        soap_s: selectedRecord.soap_s,
        soap_o: selectedRecord.soap_o,
        soap_a: selectedRecord.soap_a,
        soap_p: selectedRecord.soap_p,
        tooth_chart: selectedRecord.tooth_chart,
        status: "soap_complete",
      })
      .eq("id", selectedRecord.id);

    setSaveMsg("保存しました ✅");
    setTimeout(() => setSaveMsg(""), 2000);
    setSaving(false);
  }

  // カルテ確定
  async function confirmRecord() {
    if (!selectedRecord) return;
    setSaving(true);

    await supabase
      .from("medical_records")
      .update({
        soap_s: selectedRecord.soap_s,
        soap_o: selectedRecord.soap_o,
        soap_a: selectedRecord.soap_a,
        soap_p: selectedRecord.soap_p,
        tooth_chart: selectedRecord.tooth_chart,
        status: "confirmed",
        doctor_confirmed: true,
      })
      .eq("id", selectedRecord.id);

    // 予約のステータスも完了にする
    if (selectedRecord.appointment_id) {
      await supabase
        .from("appointments")
        .update({ status: "completed" })
        .eq("id", selectedRecord.appointment_id);
    }

    setSelectedRecord({ ...selectedRecord, status: "confirmed", doctor_confirmed: true });
    setSaveMsg("カルテを確定しました ✅");
    setTimeout(() => setSaveMsg(""), 2000);
    setSaving(false);
  }

  // カルテ確定を解除して再編集可能にする
  async function unlockRecord() {
    if (!selectedRecord) return;
    if (!confirm("確定を解除して再編集しますか？")) return;
    setSaving(true);

    await supabase
      .from("medical_records")
      .update({ status: "soap_complete", doctor_confirmed: false })
      .eq("id", selectedRecord.id);

    setSelectedRecord({ ...selectedRecord, status: "soap_complete", doctor_confirmed: false });
    setSaveMsg("編集可能にしました ✅");
    setTimeout(() => setSaveMsg(""), 2000);
    setSaving(false);
  }

  // 歯式の状態変更
  function setToothStatus(toothNum: string, status: string) {
    if (!selectedRecord) return;
    const chart = { ...(selectedRecord.tooth_chart || {}) };
    if (status === "normal") {
      delete chart[toothNum];
    } else {
      chart[toothNum] = status;
    }
    setSelectedRecord({ ...selectedRecord, tooth_chart: chart });
  }

  // 歯の状態選択用ポップアップ
  const [editingTooth, setEditingTooth] = useState<string | null>(null);

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
  }

  function getAge(dob: string) {
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    return age;
  }

  // 歯レンダリング
  function renderTooth(toothNum: string) {
    const status = selectedRecord?.tooth_chart?.[toothNum] || "normal";
    const config = TOOTH_STATUS[status] || TOOTH_STATUS.normal;
    const isEditing = editingTooth === toothNum;

    return (
      <div key={toothNum} className="relative">
        <button
          onClick={() => setEditingTooth(isEditing ? null : toothNum)}
          className={`w-9 h-9 rounded-lg text-[10px] font-bold border transition-all ${
            status === "normal"
              ? "bg-white border-gray-200 text-gray-500 hover:border-sky-300"
              : `${config.bg} border-transparent ${config.color}`
          } ${isEditing ? "ring-2 ring-sky-400" : ""}`}
        >
          {status === "normal" ? toothNum : config.label}
        </button>

        {/* 歯の状態選択ポップアップ */}
        {isEditing && (
          <div className="absolute z-20 top-full mt-1 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-lg border border-gray-200 p-2 min-w-[120px]">
            <p className="text-[10px] text-gray-400 text-center mb-1">#{toothNum}</p>
            {Object.entries(TOOTH_STATUS).map(([key, val]) => (
              <button
                key={key}
                onClick={() => { setToothStatus(toothNum, key); setEditingTooth(null); }}
                className={`w-full text-left px-2 py-1 rounded text-xs font-bold hover:bg-gray-50 ${
                  status === key ? "bg-sky-50 text-sky-700" : "text-gray-700"
                }`}
              >
                <span className={`inline-block w-4 h-4 rounded text-center text-[9px] leading-4 mr-1.5 ${val.bg} ${val.color}`}>
                  {val.label.charAt(0)}
                </span>
                {val.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">📋 電子カルテ</h1>
          </div>
          {saveMsg && <span className="text-green-600 text-sm font-bold">{saveMsg}</span>}
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* ===== 検索画面 ===== */}
        {viewMode === "search" && (
          <div>
            {/* 検索バー */}
            <div className="mb-6">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => searchPatients(e.target.value)}
                placeholder="患者名・カナ・電話番号で検索..."
                className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 text-base focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              />
            </div>

            {/* 検索結果 */}
            {searchResults.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-bold text-gray-400 mb-2">検索結果</h3>
                <div className="space-y-2">
                  {searchResults.map((p) => (
                    <button key={p.id} onClick={() => selectPatient(p)}
                      className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-sky-300 hover:shadow-sm transition-all">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-gray-900">{p.name_kanji} <span className="text-gray-400 text-sm font-normal">({p.name_kana})</span></p>
                          <p className="text-xs text-gray-400">{p.date_of_birth} ({getAge(p.date_of_birth)}歳) / {p.phone} / {p.insurance_type}</p>
                        </div>
                        <span className="text-gray-300">→</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 本日の来院患者 */}
            <div>
              <h3 className="text-sm font-bold text-gray-400 mb-2">📅 本日の来院患者</h3>
              {todayPatients.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                  <p className="text-gray-400">本日の来院患者はいません</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {todayPatients.map((tp, idx) => {
                    const statusLabels: Record<string, { text: string; color: string }> = {
                      checked_in: { text: "来院済", color: "bg-green-100 text-green-700" },
                      in_consultation: { text: "診察中", color: "bg-orange-100 text-orange-700" },
                      completed: { text: "完了", color: "bg-purple-100 text-purple-700" },
                    };
                    const st = statusLabels[tp.appointment_status] || { text: tp.appointment_status, color: "bg-gray-100 text-gray-500" };
                    return (
                      <button key={`${tp.patient.id}-${idx}`} onClick={() => selectPatient(tp.patient)}
                        className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-sky-300 hover:shadow-sm transition-all">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div>
                              <p className="font-bold text-gray-900">{tp.patient.name_kanji}</p>
                              <p className="text-xs text-gray-400">{tp.patient.name_kana}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${st.color}`}>{st.text}</span>
                            <span className="text-gray-300">→</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===== 患者詳細 + カルテ ===== */}
        {viewMode === "patient_detail" && selectedPatient && (
          <div>
            {/* 患者ヘッダー */}
            <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button onClick={() => { setViewMode("search"); setSelectedPatient(null); setSelectedRecord(null); setRecords([]); }}
                    className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</button>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-xl font-bold text-gray-900">{selectedPatient.name_kanji}</h2>
                      <span className="text-sm text-gray-400">({selectedPatient.name_kana})</span>
                      {selectedPatient.is_new && <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded font-bold">初診</span>}
                    </div>
                    <p className="text-sm text-gray-400">
                      {selectedPatient.date_of_birth} ({getAge(selectedPatient.date_of_birth)}歳) / {selectedPatient.phone} / {selectedPatient.insurance_type} {selectedPatient.burden_ratio * 10}割
                    </p>
                  </div>
                </div>
                <div className="text-sm text-gray-400">
                  来院回数: {records.length}回
                </div>
              </div>
            </div>

            <div className="flex gap-4">
              {/* カルテ一覧（左） */}
              <div className="w-56 flex-shrink-0">
                <h3 className="text-sm font-bold text-gray-400 mb-2">カルテ履歴</h3>
                <div className="space-y-1">
                  {records.map((rec) => (
                    <button key={rec.id} onClick={() => setSelectedRecord(rec)}
                      className={`w-full text-left p-3 rounded-lg text-sm transition-all ${
                        selectedRecord?.id === rec.id ? "bg-sky-50 border border-sky-300" : "bg-white border border-gray-200 hover:border-gray-300"
                      }`}>
                      <p className="font-bold text-gray-900">{rec.appointments?.scheduled_at ? formatDate(rec.appointments.scheduled_at) : formatDate(rec.created_at)}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                          rec.status === "confirmed" ? "bg-green-100 text-green-600"
                          : rec.status === "soap_complete" ? "bg-yellow-100 text-yellow-600"
                          : "bg-gray-100 text-gray-400"
                        }`}>{rec.status === "confirmed" ? "確定" : rec.status === "soap_complete" ? "SOAP済" : "下書き"}</span>
                        {rec.appointments?.patient_type === "new" && <span className="text-[10px] text-red-500 font-bold">初診</span>}
                      </div>
                    </button>
                  ))}
                  {records.length === 0 && (
                    <p className="text-xs text-gray-400 p-3">カルテがありません</p>
                  )}
                </div>
              </div>

              {/* カルテ本体（右） */}
              <div className="flex-1">
                {selectedRecord ? (
                  <div className="space-y-4">
                    {/* ステータス */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          selectedRecord.status === "confirmed" ? "bg-green-100 text-green-700"
                          : selectedRecord.status === "soap_complete" ? "bg-yellow-100 text-yellow-700"
                          : "bg-gray-100 text-gray-500"
                        }`}>
                          {selectedRecord.status === "confirmed" ? "✅ 確定済み" : selectedRecord.status === "soap_complete" ? "📝 SOAP入力済み" : "📋 下書き"}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveSOAP} disabled={saving || selectedRecord.status === "confirmed"}
                          className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-700 disabled:opacity-50">
                          {saving ? "保存中..." : "一時保存"}
                        </button>
                        {selectedRecord.status === "confirmed" ? (
                          <button onClick={unlockRecord} disabled={saving}
                            className="bg-yellow-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-yellow-600 disabled:opacity-50">
                            🔓 編集する
                          </button>
                        ) : (
                          <button onClick={confirmRecord} disabled={saving}
                            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-green-700 disabled:opacity-50">
                            カルテ確定
                          </button>
                        )}
                      </div>
                    </div>

                    {/* SOAP入力 */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {/* S: 主観 */}
                      <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="bg-red-100 text-red-700 text-xs font-bold w-6 h-6 rounded flex items-center justify-center">S</span>
                          <h4 className="text-sm font-bold text-gray-900">主観的情報（Subjective）</h4>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">患者さんの訴え・主訴</p>
                        <textarea
                          value={selectedRecord.soap_s || ""}
                          onChange={(e) => setSelectedRecord({ ...selectedRecord, soap_s: e.target.value })}
                          disabled={selectedRecord.status === "confirmed"}
                          placeholder="例: 右下奥歯が痛い、冷たいものがしみる（2日前から）"
                          rows={4}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 resize-none disabled:bg-gray-50"
                        />
                      </div>

                      {/* O: 客観 */}
                      <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="bg-blue-100 text-blue-700 text-xs font-bold w-6 h-6 rounded flex items-center justify-center">O</span>
                          <h4 className="text-sm font-bold text-gray-900">客観的情報（Objective）</h4>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">検査所見・口腔内所見</p>
                        <textarea
                          value={selectedRecord.soap_o || ""}
                          onChange={(e) => setSelectedRecord({ ...selectedRecord, soap_o: e.target.value })}
                          disabled={selectedRecord.status === "confirmed"}
                          placeholder="例: #46 遠心面に C2 相当のう蝕あり、打診(-)、冷水痛(+)"
                          rows={4}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 resize-none disabled:bg-gray-50"
                        />
                      </div>

                      {/* A: 評価 */}
                      <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="bg-yellow-100 text-yellow-700 text-xs font-bold w-6 h-6 rounded flex items-center justify-center">A</span>
                          <h4 className="text-sm font-bold text-gray-900">評価（Assessment）</h4>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">診断名・評価</p>
                        <textarea
                          value={selectedRecord.soap_a || ""}
                          onChange={(e) => setSelectedRecord({ ...selectedRecord, soap_a: e.target.value })}
                          disabled={selectedRecord.status === "confirmed"}
                          placeholder="例: #46 C2（象牙質う蝕）"
                          rows={3}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 resize-none disabled:bg-gray-50"
                        />
                      </div>

                      {/* P: 計画 */}
                      <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="bg-green-100 text-green-700 text-xs font-bold w-6 h-6 rounded flex items-center justify-center">P</span>
                          <h4 className="text-sm font-bold text-gray-900">計画（Plan）</h4>
                        </div>
                        <p className="text-xs text-gray-400 mb-2">治療計画・処置内容・次回予定</p>
                        <textarea
                          value={selectedRecord.soap_p || ""}
                          onChange={(e) => setSelectedRecord({ ...selectedRecord, soap_p: e.target.value })}
                          disabled={selectedRecord.status === "confirmed"}
                          placeholder="例: #46 CR充填（光重合レジン）、次回経過観察"
                          rows={3}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 resize-none disabled:bg-gray-50"
                        />
                      </div>
                    </div>

                    {/* 歯式チャート */}
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-sm font-bold text-gray-900">🦷 歯式チャート</h4>
                        <p className="text-xs text-gray-400">歯をタップして状態を変更</p>
                      </div>

                      <div className="flex flex-col items-center gap-1">
                        {/* 上顎 */}
                        <div className="flex gap-0.5">
                          <div className="flex gap-0.5 border-r-2 border-gray-400 pr-1">
                            {UPPER_RIGHT.map((t) => renderTooth(t))}
                          </div>
                          <div className="flex gap-0.5 pl-1">
                            {UPPER_LEFT.map((t) => renderTooth(t))}
                          </div>
                        </div>

                        {/* 区切り線 */}
                        <div className="w-full border-t-2 border-gray-400 my-1" />

                        {/* 下顎 */}
                        <div className="flex gap-0.5">
                          <div className="flex gap-0.5 border-r-2 border-gray-400 pr-1">
                            {LOWER_RIGHT.map((t) => renderTooth(t))}
                          </div>
                          <div className="flex gap-0.5 pl-1">
                            {LOWER_LEFT.map((t) => renderTooth(t))}
                          </div>
                        </div>
                      </div>

                      {/* 凡例 */}
                      <div className="flex flex-wrap gap-2 mt-3 justify-center">
                        {Object.entries(TOOTH_STATUS).map(([key, val]) => (
                          <span key={key} className={`text-[10px] font-bold px-2 py-0.5 rounded ${val.bg} ${val.color}`}>
                            {val.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                    <p className="text-gray-400">左のカルテ履歴から選択してください</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 歯のポップアップを閉じるオーバーレイ */}
      {editingTooth && (
        <div className="fixed inset-0 z-10" onClick={() => setEditingTooth(null)} />
      )}
    </div>
  );
}
