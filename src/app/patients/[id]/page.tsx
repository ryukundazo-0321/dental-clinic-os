"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Patient = {
  id: string; patient_number: string | null; name_kanji: string; name_kana: string;
  date_of_birth: string | null; sex: string | null; phone: string | null; email: string | null;
  insurance_type: string | null; burden_ratio: number | null; patient_status: string | null;
  allergies: unknown; medications: unknown; is_new: boolean; created_at: string;
  postal_code: string | null; address: string | null; occupation: string | null; notes: string | null;
  current_tooth_chart: Record<string, ToothData> | null;
  current_perio_chart: PerioChart | null;
  insurer_number: string | null; insured_number: string | null; insured_symbol: string | null;
};
type ToothData = { status?: string; pocket?: { buccal?: number[]; lingual?: number[] }; bop?: boolean; mobility?: number; note?: string };
type PerioEntry = { buccal: number[]; lingual: number[]; bop: boolean; mobility: number };
type PerioChart = Record<string, PerioEntry>;
type MedicalRecord = {
  id: string; patient_id: string; status: string;
  soap_s: string | null; soap_o: string | null; soap_a: string | null; soap_p: string | null;
  tooth_chart: Record<string, string> | null;
  tooth_changes: { tooth: string; from: string; to: string }[] | null;
  doctor_confirmed: boolean; created_at: string;
  appointments: { scheduled_at: string; patient_type: string } | null;
};
type ToothHistoryEntry = {
  id: string; tooth_number: string; change_type: string;
  previous_status: string | null; new_status: string | null; treatment_detail: string | null;
  pocket_buccal: number[] | null; pocket_lingual: number[] | null;
  bop: boolean | null; mobility: number | null; note: string | null; created_at: string;
};
type PerioSnapshot = {
  id: string; perio_data: Record<string, unknown>; total_teeth_probed: number | null;
  deep_4mm_plus: number | null; deep_6mm_plus: number | null;
  bop_positive: number | null; bop_total: number | null; bop_rate: number | null;
  stage: string | null; created_at: string;
};

const UR = ["18","17","16","15","14","13","12","11"];
const UL = ["21","22","23","24","25","26","27","28"];
const LR = ["48","47","46","45","44","43","42","41"];
const LL = ["31","32","33","34","35","36","37","38"];
const ALL = [...UR,...UL,...LR,...LL];

const TS: Record<string, { label: string; sl: string; color: string; bg: string; border: string; cbg: string }> = {
  normal:       { label: "健全",  sl: "",   color: "text-gray-500",   bg: "bg-white",     border: "border-gray-200", cbg: "bg-white" },
  caries:       { label: "要治療",sl: "⚠",  color: "text-red-700",    bg: "bg-red-50",    border: "border-red-400",  cbg: "bg-red-100" },
  in_treatment: { label: "治療中",sl: "⚡", color: "text-orange-700", bg: "bg-orange-50", border: "border-orange-400",cbg: "bg-orange-100" },
  treated:      { label: "完了",  sl: "✓",  color: "text-green-700",  bg: "bg-green-50",  border: "border-green-400",cbg: "bg-green-100" },
  crown:        { label: "冠",    sl: "冠", color: "text-yellow-700", bg: "bg-yellow-50", border: "border-yellow-400",cbg: "bg-yellow-100" },
  missing:      { label: "欠損",  sl: "×",  color: "text-gray-400",   bg: "bg-gray-100",  border: "border-gray-300", cbg: "bg-gray-200" },
  implant:      { label: "Imp",   sl: "I",  color: "text-purple-700", bg: "bg-purple-50", border: "border-purple-400",cbg: "bg-purple-100" },
  bridge:       { label: "Br",    sl: "Br", color: "text-teal-700",   bg: "bg-teal-50",   border: "border-teal-400", cbg: "bg-teal-100" },
  root_remain:  { label: "残根",  sl: "残", color: "text-pink-700",   bg: "bg-pink-50",   border: "border-pink-400", cbg: "bg-pink-100" },
  watch:        { label: "観察",  sl: "△",  color: "text-amber-700",  bg: "bg-amber-50",  border: "border-amber-400",cbg: "bg-amber-100" },
  inlay:        { label: "In",    sl: "In", color: "text-cyan-700",   bg: "bg-cyan-50",   border: "border-cyan-400", cbg: "bg-cyan-100" },
};

const PST: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "通院中", color: "text-green-700", bg: "bg-green-100" },
  inactive: { label: "中断", color: "text-orange-700", bg: "bg-orange-100" },
  suspended: { label: "休止", color: "text-red-700", bg: "bg-red-100" },
  completed: { label: "完了", color: "text-gray-500", bg: "bg-gray-100" },
};

type Tab = "records"|"timeline"|"perio"|"info";
type CM = "status"|"perio";

function age(d: string|null) { if(!d) return "-"; const b=new Date(d), t=new Date(); let a=t.getFullYear()-b.getFullYear(); if(t.getMonth()<b.getMonth()||(t.getMonth()===b.getMonth()&&t.getDate()<b.getDate())) a--; return `${a}歳`; }
function fd(d: string|null) { if(!d) return "-"; try { const dt=new Date(d); return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,"0")}/${String(dt.getDate()).padStart(2,"0")}`; } catch { return "-"; } }
function tl(t: string) { const n=parseInt(t); if(isNaN(n)) return t; const q=Math.floor(n/10), p=n%10; return `${q===1?"右上":q===2?"左上":q===3?"左下":q===4?"右下":""}${p}番`; }
function hd(v: unknown) { if(!v) return false; if(Array.isArray(v)) return v.length>0; if(typeof v==="object") return Object.keys(v as object).length>0; return false; }
function pcl(v: number): string { if(v>=6) return "bg-red-500 text-white font-bold"; if(v>=4) return "bg-red-200 text-red-800 font-bold"; return "text-gray-500"; }

export default function PatientDetailPage() {
  const params = useParams();
  const pid = params.id as string;
  const [patient, setPatient] = useState<Patient|null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [th, setTH] = useState<ToothHistoryEntry[]>([]);
  const [ps, setPS2] = useState<PerioSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("records");
  const [cm, setCM] = useState<CM>("status");
  const [sel, setSel] = useState<string|null>(null);
  const [es, setES] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [p, r, t, s] = await Promise.all([
      supabase.from("patients").select("*").eq("id", pid).single(),
      supabase.from("medical_records").select("*, appointments(scheduled_at, patient_type)").eq("patient_id", pid).order("created_at", { ascending: false }),
      supabase.from("tooth_history").select("*").eq("patient_id", pid).order("created_at", { ascending: false }),
      supabase.from("perio_snapshots").select("*").eq("patient_id", pid).order("created_at", { ascending: false }),
    ]);
    if (p.data) setPatient(p.data);
    if (r.data) setRecords(r.data);
    if (t.data) setTH(t.data);
    if (s.data) setPS2(s.data);
    setLoading(false);
  }, [pid]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function chgStatus(s: string) {
    if (!patient) return;
    await supabase.from("patients").update({ patient_status: s }).eq("id", patient.id);
    setPatient({ ...patient, patient_status: s });
    setES(false);
  }

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-sm text-gray-400">⏳ 読み込み中...</p></div>;
  if (!patient) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-center"><p className="text-sm text-gray-500">❌ 患者が見つかりません</p><Link href="/patients" className="text-sm text-sky-600 mt-2 inline-block hover:underline">← 戻る</Link></div></div>;

  const st = PST[patient.patient_status || "active"] || PST.active;
  const tc = (patient.current_tooth_chart || {}) as Record<string, ToothData>;
  const pc = (patient.current_perio_chart || {}) as PerioChart;

  // ===== 統計 =====
  let cC=0, iT=0, tC=0, mC=0, pC=0, bP=0, bT=0, p4=0, p6=0, moC=0, totalSites=0;
  ALL.forEach(t => {
    const d = tc[t]; const s = d?.status || "normal"; const pe = pc[t];
    if (s === "caries") cC++;
    if (s === "in_treatment") iT++;
    if (s === "treated" || s === "crown" || s === "inlay") tC++;
    if (s === "missing") mC++;
    if (s !== "missing") pC++;
    if (pe) {
      if (pe.bop) bP++;
      bT++;
      [...(pe.buccal || []), ...(pe.lingual || [])].forEach(v => { totalSites++; if (v >= 4) p4++; if (v >= 6) p6++; });
      if (pe.mobility > 0) moC++;
    } else if (d?.bop) { bP++; bT++; }
  });
  const bR = bT > 0 ? Math.round(bP / bT * 1000) / 10 : 0;
  const p4p = totalSites > 0 ? Math.round(p4 / totalSites * 1000) / 10 : 0;
  const lastPerio = ps.length > 0 ? fd(ps[0].created_at) : null;

  const selH = sel ? th.filter(h => h.tooth_number === sel) : [];
  const selD = sel ? tc[sel] : null;
  const selP = sel ? pc[sel] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ===== ヘッダー ===== */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/patients" className="text-sm text-gray-400 hover:text-gray-600">← 患者一覧</Link>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-lg font-bold">{patient.name_kanji?.charAt(0) || "?"}</div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-gray-900">{patient.name_kanji}</h1>
                  <span className="text-xs text-gray-400">{patient.name_kana}</span>
                  {patient.is_new && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">新患</span>}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  <span className="font-mono">{patient.patient_number || "-"}</span>
                  <span>{age(patient.date_of_birth)} {patient.sex === "男" ? "♂" : patient.sex === "女" ? "♀" : ""}</span>
                  <span>{patient.insurance_type || "-"}</span>
                  <div className="relative">
                    <button onClick={() => setES(!es)} className={`${st.bg} ${st.color} text-[10px] font-bold px-2 py-0.5 rounded hover:opacity-80`}>{st.label} ▾</button>
                    {es && <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-[100px]">
                      {Object.entries(PST).map(([k, c]) => <button key={k} onClick={() => chgStatus(k)} className={`block w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${c.color} font-bold`}>{c.label}</button>)}
                    </div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hd(patient.allergies) && <span className="text-[10px] bg-red-100 text-red-600 px-2 py-1 rounded font-bold">⚠ アレルギー</span>}
            <Link href={`/consultation?patient=${patient.id}`} className="bg-orange-500 text-white px-3 py-2 rounded-lg text-xs font-bold hover:bg-orange-600">🩺 診察開始</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-5">
        {/* ===== 全顎チャート ===== */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-5">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h2 className="text-sm font-bold text-gray-900">● {cm === "status" ? "全顎チャート" : "全顎P検チャート"}</h2>
            <div className="flex items-center gap-2">
              <div className="flex bg-gray-100 rounded-lg p-0.5">
                <button onClick={() => setCM("status")} className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${cm === "status" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>🦷 ステータス</button>
                <button onClick={() => setCM("perio")} className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${cm === "perio" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>📊 P検</button>
              </div>
              <div className="flex items-center gap-2 text-[10px] ml-2">
                {cm === "status" ? <>
                  <Leg c="bg-red-100 border-red-400" t="要治療" /><Leg c="bg-orange-100 border-orange-400" t="治療中" /><Leg c="bg-green-100 border-green-400" t="完了" /><Leg c="bg-amber-100 border-amber-400" t="観察" /><Leg c="bg-pink-100 border-pink-400" t="残根" /><Leg c="bg-gray-200 border-gray-300" t="欠損" />
                </> : <>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500"></span>BOP(+)</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-200 border border-red-300"></span>PPD≧4</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500"></span>PPD≧5</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-amber-200 border border-amber-400"></span>動揺</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-gray-300"></span>欠損/残根</span>
                </>}
              </div>
            </div>
          </div>

          {cm === "status" ? <>
            {/* ===== ステータスモード ===== */}
            <div className="text-[9px] text-gray-400 mb-0.5 ml-1">上顎 MAXILLA ← R</div>
            <div className="overflow-x-auto"><div className="flex justify-center min-w-[640px]"><StatusRow teeth={[...UR,...UL]} tc={tc} sel={sel} setSel={setSel} jaw="upper" /></div></div>
            <div className="text-[9px] text-gray-400 mt-2 mb-0.5 ml-1">下顎 MANDIBLE ← R</div>
            <div className="overflow-x-auto"><div className="flex justify-center min-w-[640px]"><StatusRow teeth={[...LR,...LL]} tc={tc} sel={sel} setSel={setSel} jaw="lower" /></div></div>
          </> : <>
            {/* ===== P検チャートモード（参考画像レイアウト） ===== */}
            <PerioChartView teeth={[...UR,...UL]} pc={pc} tc={tc} sel={sel} setSel={setSel} jaw="upper" label="上顎" />
            <div className="my-2 border-t border-gray-200" />
            <PerioChartView teeth={[...LR,...LL]} pc={pc} tc={tc} sel={sel} setSel={setSel} jaw="lower" label="下顎" />
          </>}

          {/* サマリフッター */}
          <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100 text-[11px] flex-wrap">
            {cm === "status" ? <>
              <SB l="要治療" v={`${cC}歯`} c="text-red-600" b="bg-red-50" />
              <SB l="治療中" v={`${iT}歯`} c="text-orange-600" b="bg-orange-50" />
              <SB l="完了" v={`${tC}歯`} c="text-green-600" b="bg-green-50" />
              <SB l="残存歯" v={`${pC}/32`} c="text-gray-700" b="bg-gray-50" />
            </> : <>
              <SB l="BOP率" v={`${bR}%`} c={bR > 30 ? "text-red-600" : "text-green-600"} b={bR > 30 ? "bg-red-50" : "bg-green-50"} />
              <SB l="PPD≧4mm" v={`${p4p}%`} c={p4p > 30 ? "text-red-600" : "text-gray-600"} b="bg-gray-50" />
              {moC > 0 && <SB l="動揺歯" v={`${moC}歯`} c="text-amber-600" b="bg-amber-50" />}
              <SB l="残存歯" v={`${pC}/32`} c="text-gray-700" b="bg-gray-50" />
              {lastPerio && <SB l="最終P検" v={lastPerio} c="text-blue-600" b="bg-blue-50" />}
            </>}
          </div>
        </div>

        {/* ===== 歯クリック詳細 ===== */}
        {sel && (
          <div className="bg-white rounded-xl border-2 border-sky-200 p-5 mb-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900">🦷 #{sel}（{tl(sel)}）</h3>
              <button onClick={() => setSel(null)} className="text-gray-400 hover:text-gray-600 text-lg">✕</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* 現在状態 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-[11px] font-bold text-blue-600 mb-2">● 現在状態 CURRENT</h4>
                <div className="space-y-1 text-sm">
                  <div><span className="text-gray-500">状態:</span> <span className="font-bold">{selD ? (TS[selD.status || "normal"]?.label || "健全") : "健全"}</span></div>
                  {(selP || selD?.pocket) && <div><span className="text-gray-500">歯周:</span> PPD {selP ? `頬[${selP.buccal.join(",")}] 舌[${selP.lingual.join(",")}]` : selD?.pocket ? `頬[${selD.pocket.buccal?.join(",") || "-"}] 舌[${selD.pocket.lingual?.join(",") || "-"}]` : ""}</div>}
                  <div><span className="text-gray-500">BOP:</span> <span className={`font-bold ${(selP?.bop || selD?.bop) ? "text-red-600" : "text-green-600"}`}>{(selP?.bop || selD?.bop) ? "(+)" : "(-)"}</span></div>
                  {(selP?.mobility || (selD?.mobility && selD.mobility > 0)) && <div><span className="text-gray-500">動揺度:</span> <span className="font-bold">{selP?.mobility || selD?.mobility}</span></div>}
                </div>
              </div>
              {/* PPD推移 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-[11px] font-bold text-red-600 mb-2">● ポケット推移 PPD TREND</h4>
                {selH.filter(h => h.change_type === "perio_update").length === 0 ? <p className="text-xs text-gray-400">P検データなし</p> :
                <table className="text-[10px] w-full"><thead><tr className="text-gray-400"><th className="text-left pr-2">日付</th><th>MB</th><th>B</th><th>DB</th><th>ML</th><th>L</th><th>DL</th></tr></thead><tbody>
                  {selH.filter(h => h.change_type === "perio_update").slice(0, 5).map(h => (
                    <tr key={h.id} className="border-t border-gray-100">
                      <td className="text-gray-600 font-bold pr-2 py-0.5">{fd(h.created_at).slice(5)}</td>
                      {(h.pocket_buccal || [0,0,0]).map((v, i) => <td key={`b${i}`} className={`text-center py-0.5 ${pcl(v)}`}>{v}</td>)}
                      {(h.pocket_lingual || [0,0,0]).map((v, i) => <td key={`l${i}`} className={`text-center py-0.5 ${pcl(v)}`}>{v}</td>)}
                    </tr>
                  ))}
                </tbody></table>}
              </div>
              {/* BOP推移 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-[11px] font-bold text-red-600 mb-2">● 出血(BOP)推移</h4>
                {selH.filter(h => h.change_type === "perio_update").length === 0 ? <p className="text-xs text-gray-400">P検データなし</p> :
                <div className="flex flex-wrap gap-2">
                  {selH.filter(h => h.change_type === "perio_update").slice(0, 5).map(h => (
                    <div key={h.id} className="text-xs">
                      <span className="text-gray-500 font-bold">{fd(h.created_at).slice(5)}:</span>
                      <span className={`ml-1 font-bold ${h.bop ? "text-red-600" : "text-green-600"}`}>{h.bop ? "(+)" : "(-)"}</span>
                    </div>
                  ))}
                </div>}
              </div>
              {/* 履歴 */}
              <div className="bg-gray-50 rounded-lg p-4">
                <h4 className="text-[11px] font-bold text-blue-600 mb-2">● 履歴 HISTORY</h4>
                {selH.length === 0 ? <p className="text-xs text-gray-400">履歴なし</p> :
                <div className="space-y-1.5">{selH.slice(0, 8).map(h => (
                  <div key={h.id} className="text-xs">
                    <span className="text-gray-500 font-bold">{fd(h.created_at)}</span>
                    {h.change_type === "status_change" && <span className="ml-1">{TS[h.previous_status || ""]?.label || h.previous_status} → <span className="font-bold text-sky-700">{TS[h.new_status || ""]?.label || h.new_status}</span></span>}
                    {h.change_type === "perio_update" && <span className="ml-1 text-teal-600">P検{h.bop ? " BOP(+)" : ""}</span>}
                 
