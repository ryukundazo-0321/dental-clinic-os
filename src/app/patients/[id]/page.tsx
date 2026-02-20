"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

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
  current_perio_chart: PerioChart | null;
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
type PerioEntry = { buccal: number[]; lingual: number[]; bop: boolean; mobility: number };
type PerioChart = Record<string, PerioEntry>;
type MedicalRecord = {
  id: string;
  patient_id: string;
  status: string;
  soap_s: string | null;
  soap_o: string | null;
  soap_a: string | null;
  soap_p: string | null;
  tooth_chart: Record<string, string> | null;
  tooth_changes: { tooth: string; from: string; to: string }[] | null;
  doctor_confirmed: boolean;
  created_at: string;
  appointments: { scheduled_at: string; patient_type: string } | null;
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
type PerioSnapshot = {
  id: string;
  perio_data: Record<string, unknown>;
  total_teeth_probed: number | null;
  deep_4mm_plus: number | null;
  deep_6mm_plus: number | null;
  bop_positive: number | null;
  bop_total: number | null;
  bop_rate: number | null;
  stage: string | null;
  created_at: string;
};

const UR = ["18", "17", "16", "15", "14", "13", "12", "11"];
const UL = ["21", "22", "23", "24", "25", "26", "27", "28"];
const LR = ["48", "47", "46", "45", "44", "43", "42", "41"];
const LL = ["31", "32", "33", "34", "35", "36", "37", "38"];
const ALL = [...UR, ...UL, ...LR, ...LL];

const TS: Record<
  string,
  { label: string; sl: string; color: string; bg: string; border: string; cbg: string }
> = {
  normal: {
    label: "健全",
    sl: "",
    color: "text-gray-500",
    bg: "bg-white",
    border: "border-gray-200",
    cbg: "bg-white",
  },
  c0: {
    label: "C0",
    sl: "C0",
    color: "text-red-400",
    bg: "bg-red-50",
    border: "border-red-200",
    cbg: "bg-red-50",
  },
  c1: {
    label: "C1",
    sl: "C1",
    color: "text-red-500",
    bg: "bg-red-50",
    border: "border-red-300",
    cbg: "bg-red-100",
  },
  c2: {
    label: "C2",
    sl: "C2",
    color: "text-red-600",
    bg: "bg-red-100",
    border: "border-red-400",
    cbg: "bg-red-100",
  },
  c3: {
    label: "C3",
    sl: "C3",
    color: "text-red-700",
    bg: "bg-red-200",
    border: "border-red-500",
    cbg: "bg-red-200",
  },
  c4: {
    label: "C4",
    sl: "C4",
    color: "text-red-800",
    bg: "bg-red-300",
    border: "border-red-600",
    cbg: "bg-red-300",
  },
  in_treatment: {
    label: "治療中",
    sl: "🔧",
    color: "text-orange-700",
    bg: "bg-orange-50",
    border: "border-orange-400",
    cbg: "bg-orange-100",
  },
  cr: {
    label: "CR",
    sl: "CR",
    color: "text-blue-700",
    bg: "bg-blue-50",
    border: "border-blue-400",
    cbg: "bg-blue-100",
  },
  inlay: {
    label: "In",
    sl: "In",
    color: "text-cyan-700",
    bg: "bg-cyan-50",
    border: "border-cyan-400",
    cbg: "bg-cyan-100",
  },
  crown: {
    label: "Cr",
    sl: "Cr",
    color: "text-yellow-700",
    bg: "bg-yellow-50",
    border: "border-yellow-400",
    cbg: "bg-yellow-100",
  },
  missing: {
    label: "欠損",
    sl: "×",
    color: "text-gray-400",
    bg: "bg-gray-100",
    border: "border-gray-300",
    cbg: "bg-gray-200",
  },
  implant: {
    label: "IP",
    sl: "IP",
    color: "text-purple-700",
    bg: "bg-purple-50",
    border: "border-purple-400",
    cbg: "bg-purple-100",
  },
  br_abutment: {
    label: "Br支台",
    sl: "Br",
    color: "text-orange-700",
    bg: "bg-orange-50",
    border: "border-orange-400",
    cbg: "bg-orange-100",
  },
  br_pontic: {
    label: "Brポン",
    sl: "Br欠",
    color: "text-orange-500",
    bg: "bg-orange-100",
    border: "border-orange-400",
    cbg: "bg-orange-200",
  },
  root_remain: {
    label: "残根",
    sl: "残",
    color: "text-pink-700",
    bg: "bg-pink-50",
    border: "border-pink-400",
    cbg: "bg-pink-100",
  },
  watch: {
    label: "要注意",
    sl: "△",
    color: "text-amber-700",
    bg: "bg-amber-50",
    border: "border-amber-400",
    cbg: "bg-amber-100",
  },
};

const PST: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "通院中", color: "text-green-700", bg: "bg-green-100" },
  inactive: { label: "中断", color: "text-orange-700", bg: "bg-orange-100" },
  suspended: { label: "休止", color: "text-red-700", bg: "bg-red-100" },
  completed: { label: "完了", color: "text-gray-500", bg: "bg-gray-100" },
};

type Tab = "records" | "timeline" | "perio" | "images" | "info";
type PatientImage = {
  id: string;
  image_type: string;
  storage_path: string;
  file_name: string | null;
  file_size: number | null;
  ai_analysis: Record<string, unknown> | null;
  notes: string | null;
  created_at: string;
};
type CM = "status" | "perio";

function age(d: string | null) {
  if (!d) return "-";
  const b = new Date(d),
    t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate()))
    a--;
  return `${a}歳`;
}
function fd(d: string | null) {
  if (!d) return "-";
  try {
    const dt = new Date(d);
    return `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")}`;
  } catch {
    return "-";
  }
}
function tl(t: string) {
  const n = parseInt(t);
  if (isNaN(n)) return t;
  const q = Math.floor(n / 10),
    p = n % 10;
  return `${q === 1 ? "右上" : q === 2 ? "左上" : q === 3 ? "左下" : q === 4 ? "右下" : ""}${p}番`;
}
function hd(v: unknown) {
  if (!v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return false;
}
function pcl(v: number): string {
  if (v >= 6) return "bg-red-500 text-white font-bold";
  if (v >= 4) return "bg-red-200 text-red-800 font-bold";
  return "text-gray-500";
}

export default function PatientDetailPage() {
  const params = useParams();
  const pid = params.id as string;
  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [th, setTH] = useState<ToothHistoryEntry[]>([]);
  const [ps, setPS2] = useState<PerioSnapshot[]>([]);
  const [images, setImages] = useState<PatientImage[]>([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("records");
  const [cm, setCM] = useState<CM>("status");
  const [sel, setSel] = useState<string | null>(null);
  const [es, setES] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [p, r, t, s, img] = await Promise.all([
      supabase.from("patients").select("*").eq("id", pid).single(),
      supabase
        .from("medical_records")
        .select("*, appointments(scheduled_at, patient_type)")
        .eq("patient_id", pid)
        .order("created_at", { ascending: false }),
      supabase
        .from("tooth_history")
        .select("*")
        .eq("patient_id", pid)
        .order("created_at", { ascending: false }),
      supabase
        .from("perio_snapshots")
        .select("*")
        .eq("patient_id", pid)
        .order("created_at", { ascending: false }),
      supabase
        .from("patient_images")
        .select("*")
        .eq("patient_id", pid)
        .order("created_at", { ascending: false }),
    ]);
    if (p.data) setPatient(p.data);
    if (r.data) setRecords(r.data);
    if (t.data) setTH(t.data);
    if (s.data) setPS2(s.data);
    if (img.data) setImages(img.data);
    setLoading(false);
  }, [pid]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function chgStatus(s: string) {
    if (!patient) return;
    await supabase.from("patients").update({ patient_status: s }).eq("id", patient.id);
    setPatient({ ...patient, patient_status: s });
    setES(false);
  }

  if (loading)
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">⏳ 読み込み中...</p>
      </div>
    );
  if (!patient)
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-gray-500">❌ 患者が見つかりません</p>
          <Link href="/patients" className="text-sm text-sky-600 mt-2 inline-block hover:underline">
            ← 戻る
          </Link>
        </div>
      </div>
    );

  const st = PST[patient.patient_status || "active"] || PST.active;
  const tc = (patient.current_tooth_chart || {}) as Record<string, ToothData>;
  const pc = (patient.current_perio_chart || {}) as PerioChart;

  // ===== 統計 =====
  let cC = 0,
    iT = 0,
    tC = 0,
    mC = 0,
    pC = 0,
    bP = 0,
    bT = 0,
    p4 = 0,
    p6 = 0,
    moC = 0,
    totalSites = 0;
  ALL.forEach((t) => {
    const d = tc[t];
    const s = d?.status || "normal";
    const pe = pc[t];
    if (s === "caries") cC++;
    if (s === "in_treatment") iT++;
    if (s === "treated" || s === "crown" || s === "inlay") tC++;
    if (s === "missing") mC++;
    if (s !== "missing") pC++;
    if (pe) {
      if (pe.bop) bP++;
      bT++;
      [...(pe.buccal || []), ...(pe.lingual || [])].forEach((v) => {
        totalSites++;
        if (v >= 4) p4++;
        if (v >= 6) p6++;
      });
      if (pe.mobility > 0) moC++;
    } else if (d?.bop) {
      bP++;
      bT++;
    }
  });
  const bR = bT > 0 ? Math.round((bP / bT) * 1000) / 10 : 0;
  const p4p = totalSites > 0 ? Math.round((p4 / totalSites) * 1000) / 10 : 0;
  const lastPerio = ps.length > 0 ? fd(ps[0].created_at) : null;

  const selH = sel ? th.filter((h) => h.tooth_number === sel) : [];
  const selD = sel ? tc[sel] : null;
  const selP = sel ? pc[sel] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ===== ヘッダー ===== */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/patients" className="text-sm text-gray-400 hover:text-gray-600">
              ← 患者一覧
            </Link>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-lg font-bold">
                {patient.name_kanji?.charAt(0) || "?"}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-gray-900">{patient.name_kanji}</h1>
                  <span className="text-xs text-gray-400">{patient.name_kana}</span>
                  {patient.is_new && (
                    <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                      新患
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className="font-mono">{patient.patient_number || "-"}</span>
                  <span>
                    {age(patient.date_of_birth)}{" "}
                    {patient.sex === "男" ? "♂" : patient.sex === "女" ? "♀" : ""}
                  </span>
                  <span>{patient.insurance_type || "-"}</span>
                  <div className="relative">
                    <button
                      onClick={() => setES(!es)}
                      className={`${st.bg} ${st.color} text-[10px] font-bold px-2 py-0.5 rounded hover:opacity-80`}
                    >
                      {st.label} ▾
                    </button>
                    {es && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[100px]">
                        {Object.entries(PST).map(([k, c]) => (
                          <button
                            key={k}
                            onClick={() => chgStatus(k)}
                            className={`block w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${c.color} font-bold`}
                          >
                            {c.label}
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
            {hd(patient.allergies) && (
              <span className="text-[10px] bg-red-100 text-red-600 px-2 py-1 rounded font-bold">
                ⚠ アレルギー
              </span>
            )}
            <Link
              href={`/consultation?patient=${patient.id}`}
              className="bg-orange-500 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-orange-600"
            >
              🩺 診察開始
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5">
        {/* ===== 全顎チャート ===== */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-900">
              ● {cm === "status" ? "全顎チャート" : "全顎P検チャート"}
            </h2>
            <div className="flex items-center gap-2">
              <div className="flex bg-gray-100 rounded-lg p-0.5">
                <button
                  onClick={() => setCM("status")}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold
                    transition-all ${cm === "status" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                >
                  🦷 ステータス
                </button>
                <button
                  onClick={() => setCM("perio")}
                  className={`px-3 py-1.5 rounded-md text-[11px] font-bold
                    transition-all ${cm === "perio" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}
                >
                  📊 P検
                </button>
              </div>
              <div className="flex items-center gap-2 text-[10px] ml-2">
                {cm === "status" ? (
                  <>
                    <Leg c="bg-red-100 border-red-400" t="要治療" />
                    <Leg c="bg-orange-100 border-orange-400" t="治療中" />
                    <Leg c="bg-green-100 border-green-400" t="完了" />
                    <Leg c="bg-amber-100 border-amber-400" t="観察" />
                    <Leg c="bg-pink-100 border-pink-400" t="残根" />
                    <Leg c="bg-gray-200 border-gray-300" t="欠損" />
                  </>
                ) : (
                  <>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-red-500"></span>BOP(+)
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-red-200 border border-red-300"></span>
                      PPD≧4
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-red-500"></span>PPD≧5
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-amber-200 border border-amber-400"></span>
                      動揺
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded bg-gray-300"></span>欠損/残根
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {cm === "status" ? (
            <>
              {/* ===== ステータスモード ===== */}
              <div className="text-[9px] text-gray-400 mb-0.5 ml-1">上顎 MAXILLA ← R</div>
              <div className="overflow-x-auto">
                <div className="flex justify-center min-w-[640px]">
                  <StatusRow teeth={[...UR, ...UL]} tc={tc} sel={sel} setSel={setSel} jaw="upper" />
                </div>
              </div>
              <div className="text-[9px] text-gray-400 mt-2 mb-0.5 ml-1">下顎 MANDIBLE ← R</div>
              <div className="overflow-x-auto">
                <div className="flex justify-center min-w-[640px]">
                  <StatusRow teeth={[...LR, ...LL]} tc={tc} sel={sel} setSel={setSel} jaw="lower" />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* ===== P検チャートモード（参考画像レイアウト） ===== */}
              <PerioChartView
                teeth={[...UR, ...UL]}
                pc={pc}
                tc={tc}
                sel={sel}
                setSel={setSel}
                jaw="upper"
                label="上顎"
              />
              <div className="my-2 border-t border-gray-200" />
              <PerioChartView
                teeth={[...LR, ...LL]}
                pc={pc}
                tc={tc}
                sel={sel}
                setSel={setSel}
                jaw="lower"
                label="下顎"
              />
            </>
          )}

          {/* サマリフッター */}
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100 text-[11px] flex-wrap">
            {cm === "status" ? (
              <>
                <SB l="要治療" v={`${cC}歯`} c="text-red-600" b="bg-red-50" />
                <SB l="治療中" v={`${iT}歯`} c="text-orange-600" b="bg-orange-50" />
                <SB l="完了" v={`${tC}歯`} c="text-green-600" b="bg-green-50" />
                <SB l="残存歯" v={`${pC}/32`} c="text-gray-700" b="bg-gray-50" />
              </>
            ) : (
              <>
                <SB
                  l="BOP率"
                  v={`${bR}%`}
                  c={bR > 30 ? "text-red-600" : "text-green-600"}
                  b={bR > 30 ? "bg-red-50" : "bg-green-50"}
                />
                <SB
                  l="PPD≧4mm"
                  v={`${p4p}%`}
                  c={p4p > 30 ? "text-red-600" : "text-gray-600"}
                  b="bg-gray-50"
                />
                {moC > 0 && <SB l="動揺歯" v={`${moC}歯`} c="text-amber-600" b="bg-amber-50" />}
                <SB l="残存歯" v={`${pC}/32`} c="text-gray-700" b="bg-gray-50" />
                {lastPerio && <SB l="最終P検" v={lastPerio} c="text-blue-600" b="bg-blue-50" />}
              </>
            )}
          </div>
        </div>

        {/* ===== 歯クリック詳細 ===== */}
        {sel && (
          <div className="bg-white rounded-xl border-2 border-sky-200 p-5 mb-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">
                🦷 #{sel}（{tl(sel)}）
              </h3>
              <button
                onClick={() => setSel(null)}
                className="text-gray-400 hover:text-gray-600 text-lg"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 現在状態 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-[11px] font-bold text-blue-600 mb-2">● 現在状態 CURRENT</h4>
                <div className="space-y-1 text-sm">
                  <div>
                    <span className="text-gray-500">状態:</span>{" "}
                    <span className="font-bold">
                      {selD ? TS[selD.status || "normal"]?.label || "健全" : "健全"}
                    </span>
                  </div>
                  {(selP || selD?.pocket) && (
                    <div>
                      <span className="text-gray-500">歯周:</span> PPD{" "}
                      {selP
                        ? `頬[${selP.buccal.join(",")}] 舌[${selP.lingual.join(",")}]`
                        : selD?.pocket
                          ? `頬[${selD.pocket.buccal?.join(",") || "-"}] 舌[${selD.pocket.lingual?.join(",") || "-"}]`
                          : ""}
                    </div>
                  )}
                  <div>
                    <span className="text-gray-500">BOP:</span>{" "}
                    <span
                      className={`font-bold ${selP?.bop || selD?.bop ? "text-red-600" : "text-green-600"}`}
                    >
                      {selP?.bop || selD?.bop ? "(+)" : "(-)"}
                    </span>
                  </div>
                  {(selP?.mobility || (selD?.mobility && selD.mobility > 0)) && (
                    <div>
                      <span className="text-gray-500">動揺度:</span>{" "}
                      <span className="font-bold">{selP?.mobility || selD?.mobility}</span>
                    </div>
                  )}
                </div>
              </div>
              {/* PPD推移 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-[11px] font-bold text-red-600 mb-2">
                  ● ポケット推移 PPD TREND
                </h4>
                {selH.filter((h) => h.change_type === "perio_update").length === 0 ? (
                  <p className="text-xs text-gray-400">P検データなし</p>
                ) : (
                  <table className="text-[10px] w-full">
                    <thead>
                      <tr className="text-gray-400">
                        <th className="text-left pr-2">日付</th>
                        <th>MB</th>
                        <th>B</th>
                        <th>DB</th>
                        <th>ML</th>
                        <th>L</th>
                        <th>DL</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selH
                        .filter((h) => h.change_type === "perio_update")
                        .slice(0, 5)
                        .map((h) => (
                          <tr key={h.id} className="border-t border-gray-100">
                            <td className="text-gray-600 font-bold pr-2 py-0.5">
                              {fd(h.created_at).slice(5)}
                            </td>
                            {(h.pocket_buccal || [0, 0, 0]).map((v, i) => (
                              <td key={`b${i}`} className={`text-center py-0.5 ${pcl(v)}`}>
                                {v}
                              </td>
                            ))}
                            {(h.pocket_lingual || [0, 0, 0]).map((v, i) => (
                              <td key={`l${i}`} className={`text-center py-0.5 ${pcl(v)}`}>
                                {v}
                              </td>
                            ))}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </div>
              {/* BOP推移 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-[11px] font-bold text-red-600 mb-2">● 出血(BOP)推移</h4>
                {selH.filter((h) => h.change_type === "perio_update").length === 0 ? (
                  <p className="text-xs text-gray-400">P検データなし</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selH
                      .filter((h) => h.change_type === "perio_update")
                      .slice(0, 5)
                      .map((h) => (
                        <div key={h.id} className="text-xs">
                          <span className="text-gray-500 font-bold">
                            {fd(h.created_at).slice(5)}:
                          </span>
                          <span
                            className={`ml-1 font-bold ${h.bop ? "text-red-600" : "text-green-600"}`}
                          >
                            {h.bop ? "(+)" : "(-)"}
                          </span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
              {/* 履歴 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-[11px] font-bold text-blue-600 mb-2">● 履歴 HISTORY</h4>
                {selH.length === 0 ? (
                  <p className="text-xs text-gray-400">履歴なし</p>
                ) : (
                  <div className="space-y-1.5">
                    {selH.slice(0, 8).map((h) => (
                      <div key={h.id} className="text-xs">
                        <span className="text-gray-500 font-bold">{fd(h.created_at)}</span>
                        {h.change_type === "status_change" && (
                          <span className="ml-1">
                            {TS[h.previous_status || ""]?.label || h.previous_status} →{" "}
                            <span className="font-bold text-sky-700">
                              {TS[h.new_status || ""]?.label || h.new_status}
                            </span>
                          </span>
                        )}
                        {h.change_type === "perio_update" && (
                          <span className="ml-1 text-teal-600">P検{h.bop ? " BOP(+)" : ""}</span>
                        )}
                        {h.change_type === "baseline" && (
                          <span className="ml-1 text-amber-600">
                            ベースライン: {TS[h.new_status || ""]?.label || h.new_status}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===== タブ ===== */}
        <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
          {[
            { k: "records" as Tab, l: "📋 カルテ履歴", n: records.length },
            { k: "timeline" as Tab, l: "🔄 歯式の変遷", n: th.length },
            { k: "perio" as Tab, l: "📊 P検推移", n: ps.length },
            { k: "images" as Tab, l: "📷 画像", n: images.length },
            { k: "info" as Tab, l: "ℹ️ 基本情報" },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              className={`px-3 py-1.5 rounded-md text-xs font-bold
                    transition-all ${tab === t.k ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
            >
              {t.l}
              {t.n !== undefined ? ` (${t.n})` : ""}
            </button>
          ))}
        </div>

        {/* カルテ履歴 */}
        {tab === "records" && (
          <div className="space-y-3">
            {records.length === 0 ? (
              <E t="カルテ履歴はまだありません" />
            ) : (
              records.map((r) => (
                <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900">
                        {fd(r.appointments?.scheduled_at || r.created_at)}
                      </span>
                      <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-bold">
                        {r.appointments?.patient_type === "new" ? "初診" : "再診"}
                      </span>
                      {r.doctor_confirmed ? (
                        <span className="text-[10px] bg-green-100 text-green-600 px-2 py-0.5 rounded font-bold">
                          ✓ 確定
                        </span>
                      ) : (
                        <span className="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded font-bold">
                          未確定
                        </span>
                      )}
                    </div>
                    {r.tooth_changes &&
                      Array.isArray(r.tooth_changes) &&
                      r.tooth_changes.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {r.tooth_changes.map((c, i) => (
                            <span
                              key={i}
                              className="text-[9px] bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold"
                            >
                              #{c.tooth} {c.from}→{c.to}
                            </span>
                          ))}
                        </div>
                      )}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    {r.soap_s && (
                      <div>
                        <span className="font-bold text-pink-600">S:</span>{" "}
                        <span className="text-gray-600">{r.soap_s}</span>
                      </div>
                    )}
                    {r.soap_o && (
                      <div>
                        <span className="font-bold text-green-600">O:</span>{" "}
                        <span className="text-gray-600">{r.soap_o}</span>
                      </div>
                    )}
                    {r.soap_a && (
                      <div>
                        <span className="font-bold text-blue-600">A:</span>{" "}
                        <span className="text-gray-600">{r.soap_a}</span>
                      </div>
                    )}
                    {r.soap_p && (
                      <div>
                        <span className="font-bold text-purple-600">P:</span>{" "}
                        <span className="text-gray-600">{r.soap_p}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* 歯式の変遷 */}
        {tab === "timeline" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            {th.length === 0 ? (
              <E t="歯式の変遷データはまだありません" />
            ) : (
              <div className="border-l-2 border-sky-200 ml-3 pl-5 space-y-4">
                {th.map((h) => (
                  <div key={h.id} className="relative">
                    <div className="absolute -left-[27px] top-1 w-3 h-3 rounded-full bg-sky-500 border-2 border-white"></div>
                    <div className="text-xs font-bold text-sky-600 mb-0.5">{fd(h.created_at)}</div>
                    <div className="text-sm">
                      <span className="font-bold text-gray-700">
                        #{h.tooth_number}（{tl(h.tooth_number)}）
                      </span>
                      {h.change_type === "status_change" && (
                        <span className="ml-2">
                          {TS[h.previous_status || ""]?.label} →{" "}
                          <span className="font-bold text-sky-700">
                            {TS[h.new_status || ""]?.label}
                          </span>
                        </span>
                      )}
                      {h.change_type === "perio_update" && (
                        <span className="ml-2 text-teal-600">
                          P検 — 頬[{h.pocket_buccal?.join(",") || ""}] 舌[
                          {h.pocket_lingual?.join(",") || ""}]{h.bop && " BOP(+)"}
                        </span>
                      )}
                      {h.change_type === "baseline" && (
                        <span className="ml-2 text-amber-600">
                          ベースライン → {TS[h.new_status || ""]?.label}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* P検推移 */}
        {tab === "perio" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            {ps.length === 0 ? (
              <E t="P検データはまだありません" />
            ) : (
              <table className="text-xs w-full">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-400">
                    <th className="text-left py-2">日付</th>
                    <th>BOP率</th>
                    <th>PPD≧4mm</th>
                    <th>PPD≧6mm</th>
                    <th>ステージ</th>
                  </tr>
                </thead>
                <tbody>
                  {ps.map((p) => (
                    <tr key={p.id} className="border-b border-gray-100">
                      <td className="py-2 font-bold">{fd(p.created_at)}</td>
                      <td
                        className={`text-center font-bold ${(p.bop_rate || 0) > 30 ? "text-red-600" : "text-green-600"}`}
                      >
                        {p.bop_rate ?? "-"}%
                      </td>
                      <td className="text-center font-bold">{p.deep_4mm_plus ?? "-"}</td>
                      <td className="text-center font-bold text-red-600">
                        {p.deep_6mm_plus ?? "-"}
                      </td>
                      <td className="text-center font-bold">{p.stage || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* 基本情報 */}
        {/* 画像管理 */}
        {tab === "images" && (
          <div className="space-y-4">
            {/* アップロード */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-900">📷 画像アップロード</h3>
              </div>
              <div className="flex gap-3">
                <label className="flex-1 cursor-pointer">
                  <div className="border-2 border-dashed border-gray-300 rounded-xl p-6
                    text-center hover:border-sky-400 hover:bg-sky-50 transition-all">
                    <p className="text-2xl mb-2">📤</p>
                    <p className="text-sm font-bold text-gray-600">
                      {imgLoading ? "アップロード中..." : "クリックして画像を選択"}
                    </p>
                    <p className="text-[10px] text-gray-400 mt-1">パノラマ・デンタル・口腔内写真</p>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={imgLoading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file || !patient) return;
                      setImgLoading(true);
                      try {
                        const fd = new FormData();
                        fd.append("file", file);
                        fd.append("patient_id", patient.id);
                        fd.append("image_type", "panorama");
                        const res = await fetch("/api/image-upload", {
                          method: "POST",
                          body: fd,
                        });
                        const data = await res.json();
                        if (data.success) {
                          await fetchData();
                        } else {
                          alert("アップロード失敗: " + data.error);
                        }
                      } catch (err) {
                        alert("アップロードエラー");
                        console.error(err);
                      }
                      setImgLoading(false);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
            </div>

            {/* 画像一覧 */}
            {images.length === 0 ? (
              <E t="画像はまだありません" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {images.map((img) => {
                  const pubUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL || ""}/storage/v1/object/public/patient-images/${img.storage_path}`;
                  const typeLabel =
                    img.image_type === "panorama"
                      ? "パノラマ"
                      : img.image_type === "intraoral"
                        ? "口腔内"
                        : img.image_type === "periapical"
                          ? "デンタル"
                          : "その他";
                  const hasAi = img.ai_analysis && Object.keys(img.ai_analysis).length > 0;
                  return (
                    <div
                      key={img.id}
                      className="bg-white rounded-xl border border-gray-200 overflow-hidden"
                    >
                      <div className="aspect-video bg-gray-100 relative">
                        <img
                          src={pubUrl}
                          alt={img.file_name || "画像"}
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                          }}
                        />
                      </div>
                      <div className="p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">
                              {typeLabel}
                            </span>
                            <span className="text-[10px] text-gray-400">
                              {new Date(img.created_at).toLocaleDateString("ja-JP")}
                            </span>
                          </div>
                          {hasAi && (
                            <span className="text-[10px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                              AI分析済
                            </span>
                          )}
                        </div>
                        {hasAi && img.ai_analysis && (
                          <div className="bg-gray-50 rounded-lg p-2 mb-2">
                            <p className="text-[10px] text-gray-500 font-bold mb-1">AI分析結果</p>
                            <p className="text-xs text-gray-700">
                              {(img.ai_analysis as Record<string, string>).summary || "分析完了"}
                            </p>
                          </div>
                        )}
                        <button
                          disabled={analyzing}
                          onClick={async () => {
                            setAnalyzing(true);
                            try {
                              // 画像をfetchしてbase64に変換
                              const imgRes = await fetch(pubUrl);
                              const blob = await imgRes.blob();
                              const reader = new FileReader();
                              const b64: string = await new Promise((resolve) => {
                                reader.onload = () => {
                                  const r = reader.result as string;
                                  resolve(r.split(",")[1]);
                                };
                                reader.readAsDataURL(blob);
                              });
                              const res = await fetch("/api/xray-analyze", {
                                method: "POST",
                                headers: {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  image_base64: b64,
                                  patient_id: patient!.id,
                                }),
                              });
                              const data = await res.json();
                              if (data.success) {
                                // DB更新
                                await supabase
                                  .from("patient_images")
                                  .update({
                                    ai_analysis: data.analysis,
                                  })
                                  .eq("id", img.id);
                                await fetchData();
                                alert("AI分析完了！\n" + (data.summary || ""));
                              } else {
                                alert("分析失敗: " + data.error);
                              }
                            } catch (err) {
                              alert("分析エラー");
                              console.error(err);
                            }
                            setAnalyzing(false);
                          }}
                          className={`w-full py-2 rounded-lg text-xs font-bold transition-all ${
                            analyzing
                              ? "bg-gray-100 text-gray-400"
                              : "bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100"
                          }`}
                        >
                          {analyzing ? "⚙️ 分析中..." : "🤖 AI分析（レントゲン）"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 基本情報 */}
        {tab === "info" && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-gray-900 border-b border-gray-200 pb-2">
                  基本情報
                </h3>
                <IR l="氏名（漢字）" v={patient.name_kanji} />
                <IR l="氏名（カナ）" v={patient.name_kana} />
                <IR l="患者番号" v={patient.patient_number} />
                <IR
                  l="生年月日"
                  v={
                    patient.date_of_birth
                      ? `${fd(patient.date_of_birth)}（${age(patient.date_of_birth)}）`
                      : null
                  }
                />
                <IR l="性別" v={patient.sex} />
                <IR l="電話番号" v={patient.phone} />
                <IR l="メール" v={patient.email} />
                <IR l="郵便番号" v={patient.postal_code} />
                <IR l="住所" v={patient.address} />
                <IR l="職業" v={patient.occupation} />
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-gray-900 border-b border-gray-200 pb-2">
                  保険・医療情報
                </h3>
                <IR l="保険種別" v={patient.insurance_type} />
                <IR
                  l="負担割合"
                  v={patient.burden_ratio ? `${Math.round(patient.burden_ratio * 100)}%` : null}
                />
                <IR l="保険者番号" v={patient.insurer_number} />
                <IR l="記号" v={patient.insured_symbol} />
                <IR l="番号" v={patient.insured_number} />
                <IR
                  l="アレルギー"
                  v={hd(patient.allergies) ? JSON.stringify(patient.allergies) : "なし"}
                  hl={hd(patient.allergies)}
                />
                <IR
                  l="服薬"
                  v={hd(patient.medications) ? JSON.stringify(patient.medications) : "なし"}
                />
                <IR l="備考" v={patient.notes} />
                <IR l="登録日" v={fd(patient.created_at)} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ===== ステータス歯式行 =====
function StatusRow({
  teeth,
  tc,
  sel,
  setSel,
  jaw,
}: {
  teeth: string[];
  tc: Record<string, ToothData>;
  sel: string | null;
  setSel: (t: string) => void;
  jaw: "upper" | "lower";
}) {
  return (
    <div className="flex gap-[2px]">
      {teeth.map((t) => {
        const d = tc[t];
        const s = d?.status || "normal";
        const c = TS[s] || TS.normal;
        const isSel = sel === t;
        return (
          <button
            key={t}
            onClick={() => setSel(t)}
            className={`w-10 h-12 rounded-lg border-2
              flex flex-col items-center justify-center
              text-[9px] font-bold transition-all hover:scale-105 ${c.cbg} ${c.border} ${c.color} ${isSel ? "ring-2 ring-sky-400 scale-110" : ""}`}
          >
            {jaw === "upper" ? (
              <>
                <span className="text-[7px] text-gray-400 leading-none">{t}</span>
                <span className="leading-tight">{s !== "normal" ? c.sl || c.label : ""}</span>
                <span className="text-[7px] leading-none">{s !== "normal" ? c.label : ""}</span>
              </>
            ) : (
              <>
                <span className="text-[7px] leading-none">{s !== "normal" ? c.label : ""}</span>
                <span className="leading-tight">{s !== "normal" ? c.sl || c.label : ""}</span>
                <span className="text-[7px] text-gray-400 leading-none">{t}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ===== P検チャート（参考画像レイアウト） =====
function PerioChartView({
  teeth,
  pc,
  tc,
  sel,
  setSel,
  jaw,
  label,
}: {
  teeth: string[];
  pc: PerioChart;
  tc: Record<string, ToothData>;
  sel: string | null;
  setSel: (t: string) => void;
  jaw: "upper" | "lower";
  label: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[700px]">
        <tbody>
          {/* TM行（動揺度）- 上顎は上、下顎は下 */}
          {jaw === "upper" && (
            <tr className="h-5">
              <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">TM</td>
              {teeth.map((t) => {
                const pe = pc[t];
                const m = pe?.mobility || 0;
                return (
                  <td key={t} className="text-center text-[9px]">
                    <span
                      className={
                        m > 0
                          ? "text-amber-600 font-bold bg-amber-100 px-1 rounded"
                          : "text-gray-300"
                      }
                    >
                      {m > 0 ? m : ""}
                    </span>
                  </td>
                );
              })}
            </tr>
          )}
          {/* EPP行（頬側ポケット）*/}
          <tr className="h-5">
            <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">EPP</td>
            {teeth.map((t) => {
              const pe = pc[t];
              const b = pe?.buccal || [];
              const st = tc[t]?.status || "normal";
              const isMissing = st === "missing" || st === "root_remain";
              return (
                <td key={t} className="text-center px-0">
                  {isMissing ? (
                    <span className="text-[8px] text-gray-300">—</span>
                  ) : (
                    <div className="flex justify-center gap-[1px]">
                      {(b.length > 0 ? b : []).map((v, i) => (
                        <span
                          key={i}
                          className={`text-[8px] w-[13px] text-center rounded-sm ${pcl(v)}`}
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
          {/* 歯番号行（メインの歯ボックス）*/}
          <tr>
            <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">{label}</td>
            {teeth.map((t) => {
              const d = tc[t];
              const s = d?.status || "normal";
              const c = TS[s] || TS.normal;
              const pe = pc[t];
              const isSel = sel === t;
              const isMissing = s === "missing" || s === "root_remain";
              const maxP = pe ? Math.max(...pe.buccal, ...pe.lingual) : 0;
              return (
                <td key={t} className="text-center px-[1px] py-[2px]">
                  <button
                    onClick={() => setSel(t)}
                    className={`w-full min-w-[38px] h-9 rounded border-2
                    flex flex-col items-center justify-center text-[9px] font-bold transition-all hover:scale-105
                    ${isMissing ? "bg-gray-200 border-gray-300 text-gray-400"
                    : s !== "normal" ? `${c.cbg} ${c.border} ${c.color}`
                    : pe?.bop ? "bg-red-50 border-red-200 text-gray-700"
                    : maxP >= 4 ? "bg-red-50 border-red-200 text-gray-700"
                    : "bg-white border-gray-200 text-gray-600"}
                    ${isSel ? "ring-2 ring-sky-400 scale-110" : ""}`}
                  >
                    <span className="leading-none">{s !== "normal" ? c.sl : ""}</span>
                    <span className="text-[8px] text-gray-400">{t}</span>
                    {s !== "normal" && <span className="text-[7px] leading-none">{c.label}</span>}
                  </button>
                </td>
              );
            })}
          </tr>
          {/* 歯番号（ミラー、下段にも表示）*/}
          <tr className="h-4">
            <td></td>
            {teeth.map((t) => (
              <td key={t} className="text-center text-[8px] text-gray-300">
                {t}
              </td>
            ))}
          </tr>
          {/* EPP行（舌側ポケット）*/}
          <tr className="h-5">
            <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">EPP</td>
            {teeth.map((t) => {
              const pe = pc[t];
              const l = pe?.lingual || [];
              const st = tc[t]?.status || "normal";
              const isMissing = st === "missing" || st === "root_remain";
              return (
                <td key={t} className="text-center px-0">
                  {isMissing ? (
                    <span className="text-[8px] text-gray-300">—</span>
                  ) : (
                    <div className="flex justify-center gap-[1px]">
                      {(l.length > 0 ? l : []).map((v, i) => (
                        <span
                          key={i}
                          className={`text-[8px] w-[13px] text-center rounded-sm ${pcl(v)}`}
                        >
                          {v}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
          {/* TM行（動揺度）- 下顎は下 */}
          {jaw === "lower" && (
            <tr className="h-5">
              <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">TM</td>
              {teeth.map((t) => {
                const pe = pc[t];
                const m = pe?.mobility || 0;
                return (
                  <td key={t} className="text-center text-[9px]">
                    <span
                      className={
                        m > 0
                          ? "text-amber-600 font-bold bg-amber-100 px-1 rounded"
                          : "text-gray-300"
                      }
                    >
                      {m > 0 ? m : ""}
                    </span>
                  </td>
                );
              })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Leg({ c, t }: { c: string; t: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`w-2.5 h-2.5 rounded border ${c}`}></span>
      {t}
    </span>
  );
}
function SB({ l, v, c, b }: { l: string; v: string; c: string; b: string }) {
  return (
    <span className={`${b} ${c} px-2 py-1 rounded-lg font-bold`}>
      ■ {l} <span className="text-sm">{v}</span>
    </span>
  );
}
function E({ t }: { t: string }) {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-gray-400">{t}</p>
    </div>
  );
}
function IR({ l, v, hl }: { l: string; v: string | null | undefined; hl?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs font-bold text-gray-400 w-24 flex-shrink-0">{l}</span>
      <span className={`text-sm ${hl ? "text-red-600 font-bold" : "text-gray-700"}`}>
        {v || "-"}
      </span>
    </div>
  );
}
