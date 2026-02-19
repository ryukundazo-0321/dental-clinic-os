"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// ===== 型定義 =====
type Patient = {
  id: string;
  patient_number: string | null;
  name_kanji: string;
  name_kana: string;
  date_of_birth: string | null;
  sex: string | null;
  phone: string | null;
  email: string | null;
  insurance_type: string | null;
  burden_ratio: number | null;
  patient_status: string | null;
  allergies: unknown;
  medications: unknown;
  is_new: boolean;
  created_at: string;
  postal_code: string | null;
  address: string | null;
  occupation: string | null;
  notes: string | null;
  current_tooth_chart: Record<string, ToothData> | null;
  current_perio_chart: Record<string, unknown> | null;
  insurer_number: string | null;
  insured_number: string | null;
  insured_symbol: string | null;
};

type ToothData = {
  status?: string;
  pocket?: { buccal?: number[]; lingual?: number[] };
  bop?: boolean;
  mobility?: number;
  note?: string;
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
  tooth_changes: ToothChange[] | null;
  doctor_confirmed: boolean;
  created_at: string;
  appointments: { scheduled_at: string; patient_type: string; doctor_id: string | null } | null;
};

type ToothChange = {
  tooth: string;
  from: string;
  to: string;
  treatment?: string;
};

type ToothHistoryEntry = {
  id: string;
  tooth_number: string;
  change_type: string;
  previous_status: string | null;
  new_status: string | null;
  treatment_detail: string | null;
  pocket_buccal: number[] | null;
  pocket_lingual: number[] | null;
  bop: boolean | null;
  mobility: number | null;
  note: string | null;
  created_at: string;
};

// ===== 歯式定数 =====
const UPPER_RIGHT = ["18","17","16","15","14","13","12","11"];
const UPPER_LEFT  = ["21","22","23","24","25","26","27","28"];
const LOWER_RIGHT = ["48","47","46","45","44","43","42","41"];
const LOWER_LEFT  = ["31","32","33","34","35","36","37","38"];

const TOOTH_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  normal:       { label: "健全",   color: "text-gray-500",   bg: "bg-white",       border: "border-gray-200" },
  caries:       { label: "C",      color: "text-red-700",    bg: "bg-red-50",      border: "border-red-300" },
  in_treatment: { label: "治療中", color: "text-orange-700", bg: "bg-orange-50",   border: "border-orange-300" },
  treated:      { label: "処置済", color: "text-blue-700",   bg: "bg-blue-50",     border: "border-blue-300" },
  crown:        { label: "冠",     color: "text-yellow-700", bg: "bg-yellow-50",   border: "border-yellow-300" },
  missing:      { label: "欠損",   color: "text-gray-400",   bg: "bg-gray-100",    border: "border-gray-300" },
  implant:      { label: "Imp",    color: "text-purple-700", bg: "bg-purple-50",   border: "border-purple-300" },
  bridge:       { label: "Br",     color: "text-orange-700", bg: "bg-orange-50",   border: "border-orange-300" },
  root_remain:  { label: "残根",   color: "text-red-500",    bg: "bg-red-50",      border: "border-red-200" },
  inlay:        { label: "In",     color: "text-cyan-700",   bg: "bg-cyan-50",     border: "border-cyan-300" },
  watch:        { label: "要注意", color: "text-amber-700",  bg: "bg-amber-50",    border: "border-amber-300" },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "通院中", color: "text-green-700",  bg: "bg-green-100" },
  inactive:  { label: "中断",   color: "text-orange-700", bg: "bg-orange-100" },
  suspended: { label: "休止",   color: "text-red-700",    bg: "bg-red-100" },
  completed: { label: "完了",   color: "text-gray-500",   bg: "bg-gray-100" },
};

type TabType = "records" | "tooth_changes" | "perio" | "info";

function calcAge(dob: string | null): string {
  if (!dob) return "-";
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${age}歳`;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  try { const d = new Date(dateStr); return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`; }
  catch { return "-"; }
}

function toothLabel(tooth: string): string {
  const num = parseInt(tooth);
  if (isNaN(num)) return tooth;
  const q = Math.floor(num / 10);
  const p = num % 10;
  const qLabel = q === 1 ? "右上" : q === 2 ? "左上" : q === 3 ? "左下" : q === 4 ? "右下" : "";
  return `${qLabel}${p}番`;
}

function hasData(val: unknown): boolean {
  if (!val) return false;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === "object") return Object.keys(val as object).length > 0;
  return false;
}

// ===== メインコンポーネント =====
export default function PatientDetailPage() {
  const params = useParams();
  const patientId = params.id as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [toothHistory, setToothHistory] = useState<ToothHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>("records");
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);
  const [selectedToothHistory, setSelectedToothHistory] = useState<ToothHistoryEntry[]>([]);
  const [editingStatus, setEditingStatus] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);

    // 患者情報
    const { data: pData } = await supabase
      .from("patients")
      .select("*")
      .eq("id", patientId)
      .single();

    if (pData) setPatient(pData);

    // カルテ履歴
    const { data: rData } = await supabase
      .from("medical_records")
      .select("*, appointments(scheduled_at, patient_type, doctor_id)")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });

    if (rData) setRecords(rData);

    // 歯の変遷履歴
    const { data: thData } = await supabase
      .from("tooth_history")
      .select("*")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false });

    if (thData) setToothHistory(thData);

    setLoading(false);
  }, [patientId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 歯タップ → その歯の履歴を表示
  function handleToothClick(toothNum: string) {
    setSelectedTooth(toothNum);
    const history = toothHistory.filter(h => h.tooth_number === toothNum);
    setSelectedToothHistory(history);
  }

  // ステータス変更
  async function handleStatusChange(newStatus: string) {
    if (!patient) return;
    await supabase.from("patients").update({ patient_status: newStatus }).eq("id", patient.id);
    setPatient({ ...patient, patient_status: newStatus });
    setEditingStatus(false);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-2">⏳</div>
          <p className="text-sm text-gray-400">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (!patient) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-2">❌</div>
          <p className="text-sm text-gray-500">患者が見つかりません</p>
          <Link href="/patients" className="text-sm text-sky-600 mt-2 inline-block hover:underline">← 患者一覧に戻る</Link>
        </div>
      </div>
    );
  }

  const status = STATUS_CONFIG[patient.patient_status || "active"] || STATUS_CONFIG.active;
  const toothChart = (patient.current_tooth_chart || {}) as Record<string, ToothData>;

  // 歯式サマリ計算
  const allTeeth = [...UPPER_RIGHT, ...UPPER_LEFT, ...LOWER_RIGHT, ...LOWER_LEFT];
  let treatedCount = 0, cariesCount = 0, missingCount = 0, implantCount = 0;
  allTeeth.forEach(t => {
    const s = toothChart[t]?.status;
    if (s === "treated" || s === "crown" || s === "inlay") treatedCount++;
    if (s === "caries" || s === "in_treatment") cariesCount++;
    if (s === "missing") missingCount++;
    if (s === "implant") implantCount++;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/patients" className="text-sm text-gray-400 hover:text-gray-600">← 患者一覧</Link>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-lg font-bold">
                {patient.name_kanji?.charAt(0) || "?"}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-gray-900">{patient.name_kanji}</h1>
                  <span className="text-xs text-gray-400">{patient.name_kana}</span>
                  {patient.is_new && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">新患</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className="font-mono">{patient.patient_number || "-"}</span>
                  <span>{calcAge(patient.date_of_birth)} {patient.sex === "男" ? "♂" : patient.sex === "女" ? "♀" : ""}</span>
                  <span>{patient.insurance_type || "-"}</span>
                  {/* ステータス */}
                  <div className="relative">
                    <button onClick={() => setEditingStatus(!editingStatus)} className={`${status.bg} ${status.color} text-[10px] font-bold px-2 py-0.5 rounded cursor-pointer hover:opacity-80`}>
                      {status.label} ▾
                    </button>
                    {editingStatus && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[120px]">
                        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                          <button key={key} onClick={() => handleStatusChange(key)} className={`block w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${cfg.color} font-bold`}>
                            {cfg.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hasData(patient.allergies) && (
              <span className="text-[10px] bg-red-100 text-red-600 px-2 py-1 rounded font-bold">⚠ アレルギーあり</span>
            )}
            <Link href={`/consultation?patient=${patient.id}`} className="bg-orange-500 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-orange-600">🩺 診察開始</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* ===== 歯式チャート ===== */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-900">🦷 歯式チャート</h2>
            <div className="flex items-center gap-4 text-xs">
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-50 border border-red-300"></span> C</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-50 border border-blue-300"></span> 処置済</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-gray-100 border border-gray-300"></span> 欠損</div>
              <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-purple-50 border border-purple-300"></span> Imp</div>
            </div>
          </div>

          {/* 上顎 */}
          <div className="flex justify-center gap-[2px] mb-1">
            {[...UPPER_RIGHT, ...UPPER_LEFT].map(t => {
              const data = toothChart[t];
              const s = data?.status || "normal";
              const cfg = TOOTH_STATUS[s] || TOOTH_STATUS.normal;
              return (
                <button key={t} onClick={() => handleToothClick(t)}
                  className={`w-9 h-11 rounded border-2 flex flex-col items-center justify-center text-[9px] font-bold transition-all hover:scale-110 hover:shadow-md ${cfg.bg} ${cfg.border} ${cfg.color} ${selectedTooth === t ? "ring-2 ring-sky-400 scale-110" : ""}`}
                >
                  <span className="text-[7px] text-gray-400">{t}</span>
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>
          {/* 中央線 */}
          <div className="flex justify-center my-1">
            <div className="w-[590px] h-[1px] bg-gray-300 relative">
              <div className="absolute left-1/2 -translate-x-1/2 -top-2 text-[8px] text-gray-300 font-bold">R ← → L</div>
            </div>
          </div>
          {/* 下顎 */}
          <div className="flex justify-center gap-[2px] mt-1">
            {[...LOWER_RIGHT, ...LOWER_LEFT].map(t => {
              const data = toothChart[t];
              const s = data?.status || "normal";
              const cfg = TOOTH_STATUS[s] || TOOTH_STATUS.normal;
              return (
                <button key={t} onClick={() => handleToothClick(t)}
                  className={`w-9 h-11 rounded border-2 flex flex-col items-center justify-center text-[9px] font-bold transition-all hover:scale-110 hover:shadow-md ${cfg.bg} ${cfg.border} ${cfg.color} ${selectedTooth === t ? "ring-2 ring-sky-400 scale-110" : ""}`}
                >
                  <span>{cfg.label}</span>
                  <span className="text-[7px] text-gray-400">{t}</span>
                </button>
              );
            })}
          </div>

          {/* サマリカード */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            <div className="bg-red-50 rounded-lg p-3 text-center">
              <p className="text-[10px] text-red-400">未処置C</p>
              <p className="text-2xl font-bold text-red-600">{cariesCount}</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 text-center">
              <p className="text-[10px] text-blue-400">処置済</p>
              <p className="text-2xl font-bold text-blue-600">{treatedCount}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3 text-center">
              <p className="text-[10px] text-gray-400">欠損</p>
              <p className="text-2xl font-bold text-gray-500">{missingCount}</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 text-center">
              <p className="text-[10px] text-purple-400">Imp</p>
              <p className="text-2xl font-bold text-purple-600">{implantCount}</p>
            </div>
          </div>
        </div>

        {/* ===== 歯タップモーダル ===== */}
        {selectedTooth && (
          <div className="bg-white rounded-xl border border-sky-200 p-5 mb-6 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-gray-900">
                🦷 #{selectedTooth}（{toothLabel(selectedTooth)}）の履歴
              </h3>
              <button onClick={() => setSelectedTooth(null)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>

            {/* 現在のステータス */}
            {toothChart[selectedTooth] && (
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs text-gray-400">現在:</span>
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${(TOOTH_STATUS[toothChart[selectedTooth]?.status || "normal"] || TOOTH_STATUS.normal).bg} ${(TOOTH_STATUS[toothChart[selectedTooth]?.status || "normal"] || TOOTH_STATUS.normal).color}`}>
                  {(TOOTH_STATUS[toothChart[selectedTooth]?.status || "normal"] || TOOTH_STATUS.normal).label}
                </span>
                {toothChart[selectedTooth]?.note && (
                  <span className="text-xs text-gray-500">{toothChart[selectedTooth].note}</span>
                )}
              </div>
            )}

            {/* 履歴タイムライン */}
            {selectedToothHistory.length === 0 ? (
              <p className="text-xs text-gray-400 py-4 text-center">この歯の履歴はまだありません</p>
            ) : (
              <div className="border-l-2 border-gray-200 ml-2 pl-4 space-y-3">
                {selectedToothHistory.map(h => (
                  <div key={h.id} className="relative">
                    <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-sky-400 border-2 border-white"></div>
                    <div className="text-xs">
                      <span className="font-bold text-sky-600">{formatDate(h.created_at)}</span>
                      {h.change_type === "baseline" && (
                        <span className="ml-2 text-amber-600 font-bold">ベースライン: {(TOOTH_STATUS[h.new_status || "normal"] || { label: h.new_status }).label}</span>
                      )}
                      {h.change_type === "status_change" && (
                        <span className="ml-2">
                          {(TOOTH_STATUS[h.previous_status || ""] || { label: h.previous_status }).label} → <span className="font-bold text-sky-700">{(TOOTH_STATUS[h.new_status || ""] || { label: h.new_status }).label}</span>
                          {h.treatment_detail && <span className="text-gray-500">（{h.treatment_detail}）</span>}
                        </span>
                      )}
                      {h.change_type === "perio_update" && (
                        <span className="ml-2 text-teal-600">
                          P検: 頬側 [{h.pocket_buccal?.join(",") || "-"}] 舌側 [{h.pocket_lingual?.join(",") || "-"}]
                          {h.bop && " BOP(+)"}
                        </span>
                      )}
                      {h.note && <div className="text-gray-400 mt-0.5">{h.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== タブ切り替え ===== */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          {([
            { key: "records", label: "📋 カルテ履歴", count: records.length },
            { key: "tooth_changes", label: "🔄 歯式の変遷", count: toothHistory.length },
            { key: "perio", label: "📊 P検推移" },
            { key: "info", label: "ℹ️ 基本情報" },
          ] as { key: TabType; label: string; count?: number }[]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${
                activeTab === tab.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.label}
              {tab.count !== undefined && <span className="ml-1 text-gray-400">({tab.count})</span>}
            </button>
          ))}
        </div>

        {/* ===== カルテ履歴タブ ===== */}
        {activeTab === "records" && (
          <div className="space-y-3">
            {records.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-sm text-gray-400">カルテ履歴はまだありません</p>
              </div>
            ) : records.map(r => (
              <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-bold text-gray-900">{formatDate(r.appointments?.scheduled_at || r.created_at)}</span>
                    <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-bold">
                      {r.appointments?.patient_type === "new" ? "初診" : "再診"}
                    </span>
                    {r.doctor_confirmed && <span className="text-[10px] bg-green-100 text-green-600 px-2 py-0.5 rounded font-bold">✓ 確定</span>}
                    {!r.doctor_confirmed && <span className="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded font-bold">未確定</span>}
                  </div>
                  {/* 歯式変更バッジ */}
                  {r.tooth_changes && Array.isArray(r.tooth_changes) && r.tooth_changes.length > 0 && (
                    <div className="flex items-center gap-1">
                      {r.tooth_changes.map((tc: ToothChange, i: number) => (
                        <span key={i} className="text-[9px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold">
                          #{tc.tooth} {tc.from}→{tc.to}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {r.soap_s && (
                    <div><span className="font-bold text-pink-600">S:</span> <span className="text-gray-600">{r.soap_s}</span></div>
                  )}
                  {r.soap_o && (
                    <div><span className="font-bold text-green-600">O:</span> <span className="text-gray-600">{r.soap_o}</span></div>
                  )}
                  {r.soap_a && (
                    <div><span className="font-bold text-blue-600">A:</span> <span className="text-gray-600">{r.soap_a}</span></div>
                  )}
                  {r.soap_p && (
                    <div><span className="font-bold text-purple-600">P:</span> <span className="text-gray-600">{r.soap_p}</span></div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ===== 歯式の変遷タブ ===== */}
        {activeTab === "tooth_changes" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            {toothHistory.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">歯式の変遷データはまだありません</p>
            ) : (
              <div className="border-l-2 border-sky-200 ml-4 pl-6 space-y-4">
                {toothHistory.map(h => (
                  <div key={h.id} className="relative">
                    <div className="absolute -left-[29px] top-1 w-3 h-3 rounded-full bg-sky-500 border-2 border-white"></div>
                    <div>
                      <div className="text-xs font-bold text-sky-600 mb-1">{formatDate(h.created_at)}</div>
                      <div className="text-sm">
                        <span className="font-bold text-gray-700">#{h.tooth_number}（{toothLabel(h.tooth_number)}）</span>
                        {h.change_type === "baseline" && (
                          <span className="ml-2 text-amber-600">ベースライン記録 → {(TOOTH_STATUS[h.new_status || ""] || { label: h.new_status }).label}</span>
                        )}
                        {h.change_type === "status_change" && (
                          <span className="ml-2 text-gray-600">
                            {(TOOTH_STATUS[h.previous_status || ""] || { label: h.previous_status }).label}
                            {" → "}
                            <span className="font-bold text-sky-700">{(TOOTH_STATUS[h.new_status || ""] || { label: h.new_status }).label}</span>
                            {h.treatment_detail && ` （${h.treatment_detail}）`}
                          </span>
                        )}
                        {h.change_type === "perio_update" && (
                          <span className="ml-2 text-teal-600">
                            P検 — 頬側[{h.pocket_buccal?.join(",") || ""}] 舌側[{h.pocket_lingual?.join(",") || ""}]
                            {h.bop && " BOP(+)"} {h.mobility ? `動揺度${h.mobility}` : ""}
                          </span>
                        )}
                      </div>
                      {h.note && <div className="text-xs text-gray-400 mt-1">{h.note}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===== P検推移タブ ===== */}
        {activeTab === "perio" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-sm text-gray-400 text-center py-8">
              P検推移グラフは Phase 2 で実装されます。<br />
              P検データが蓄積されると、BOP率やポケット4mm+の推移がここにグラフ表示されます。
            </p>
          </div>
        )}

        {/* ===== 基本情報タブ ===== */}
        {activeTab === "info" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* 左カラム */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 border-b border-gray-200 pb-2">基本情報</h3>
                <InfoRow label="氏名（漢字）" value={patient.name_kanji} />
                <InfoRow label="氏名（カナ）" value={patient.name_kana} />
                <InfoRow label="患者番号" value={patient.patient_number} />
                <InfoRow label="生年月日" value={patient.date_of_birth ? `${formatDate(patient.date_of_birth)}（${calcAge(patient.date_of_birth)}）` : null} />
                <InfoRow label="性別" value={patient.sex} />
                <InfoRow label="電話番号" value={patient.phone} />
                <InfoRow label="メール" value={patient.email} />
                <InfoRow label="郵便番号" value={patient.postal_code} />
                <InfoRow label="住所" value={patient.address} />
                <InfoRow label="職業" value={patient.occupation} />
              </div>

              {/* 右カラム */}
              <div className="space-y-4">
                <h3 className="text-sm font-bold text-gray-900 border-b border-gray-200 pb-2">保険・医療情報</h3>
                <InfoRow label="保険種別" value={patient.insurance_type} />
                <InfoRow label="負担割合" value={patient.burden_ratio ? `${Math.round(patient.burden_ratio * 100)}%` : null} />
                <InfoRow label="保険者番号" value={patient.insurer_number} />
                <InfoRow label="記号" value={patient.insured_symbol} />
                <InfoRow label="番号" value={patient.insured_number} />
                <InfoRow label="アレルギー" value={hasData(patient.allergies) ? JSON.stringify(patient.allergies) : "なし"} highlight={hasData(patient.allergies)} />
                <InfoRow label="服薬" value={hasData(patient.medications) ? JSON.stringify(patient.medications) : "なし"} />
                <InfoRow label="備考" value={patient.notes} />
                <InfoRow label="登録日" value={formatDate(patient.created_at)} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// 情報表示行
function InfoRow({ label, value, highlight }: { label: string; value: string | null | undefined; highlight?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      <span className="text-xs font-bold text-gray-400 w-24 flex-shrink-0">{label}</span>
      <span className={`text-sm ${highlight ? "text-red-600 font-bold" : "text-gray-700"}`}>{value || "-"}</span>
    </div>
  );
}
