"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// ==============================
// 型定義
// ==============================
type Patient = {
  id: string; patient_number: string | null; name_kanji: string; name_kana: string;
  date_of_birth: string | null; sex: string | null; phone: string | null; email: string | null;
  insurance_type: string | null; burden_ratio: number | null; patient_status: string | null;
  allergies: unknown; medications: unknown; is_new: boolean; created_at: string;
  postal_code: string | null; address: string | null; occupation: string | null; notes: string | null;
  current_tooth_chart: Record<string, ToothData> | null;
  current_perio_chart: PerioChart | null;
  insurer_number: string | null; insured_number: string | null; insured_symbol: string | null;
  insured_branch?: string | null; insurer_name?: string | null; insurer_address?: string | null;
  insurer_phone?: string | null; insurance_relation?: string | null; insured_name?: string | null;
  insurance_valid_from?: string | null; insurance_valid_until?: string | null;
  public_insurer?: string | null; public_recipient?: string | null;
  public_insurer_2?: string | null; public_recipient_2?: string | null;
  public_insurer_3?: string | null; public_recipient_3?: string | null;
  public_valid_from?: string | null; public_valid_until?: string | null;
  high_cost_medical?: boolean; income_category?: string | null; disability_flag?: boolean;
  infection_flags?: string | null; alert_memo?: string | null;
  assigned_dh_id?: string | null; subchart_notes?: string | null;
};
type ToothData = { status?: string; pocket?: { buccal?: number[]; lingual?: number[] }; bop?: boolean; mobility?: number; note?: string };
type PerioEntry = { buccal: number[]; lingual: number[]; bop: boolean; mobility: number };
type PerioChart = Record<string, PerioEntry>;
type MedicalRecord = {
  id: string; patient_id: string; status: string; appointment_id?: string;
  soap_s: string | null; soap_o: string | null; soap_a: string | null; soap_p: string | null;
  tooth_chart: Record<string, string> | null;
  tooth_changes: { tooth: string; from: string; to: string }[] | null;
  doctor_confirmed: boolean; created_at: string;
  structured_procedures?: StructuredProcedure[];
  appointments: { scheduled_at: string; patient_type: string; status?: string; doctor_id?: string | null } | null;
};
type StructuredProcedure = { id: string; procedure_name: string; points: number; diagnosis_name?: string; tooth?: string; category?: string };
type PatientDiagnosis = {
  id: string; patient_id: string; diagnosis_code: string; diagnosis_name: string;
  tooth_number: string | null; start_date: string; end_date: string | null;
  outcome: string; is_primary: boolean; notes: string | null;
  session_total?: number | null; session_current?: number | null;
};
type DiagnosisMaster = { code: string; name: string; category: string };
type DiagnosisModifier = { id: string; modifier_code: string; modifier_name: string; modifier_position: string };
type ToothMode = "permanent" | "deciduous" | "both";
type ToothHistoryEntry = {
  id: string; tooth_number: string; change_type: string;
  previous_status: string | null; new_status: string | null;
  pocket_buccal: number[] | null; pocket_lingual: number[] | null;
  bop: boolean | null; mobility: number | null; created_at: string;
};
type PerioSnapshot = {
  id: string; bop_rate: number | null; deep_4mm_plus: number | null;
  deep_6mm_plus: number | null; stage: string | null; created_at: string;
};
type PatientImage = {
  id: string; image_type: string; storage_path: string;
  file_name: string | null; ai_analysis: Record<string, unknown> | null; created_at: string;
};
type BillingData = {
  total_points: number; patient_burden: number; insurance_claim: number;
  burden_ratio: number; procedures_detail: unknown[]; payment_status: string; created_at: string;
};

// ==============================
// 定数
// ==============================
const UR = ["18","17","16","15","14","13","12","11"];
const UL = ["21","22","23","24","25","26","27","28"];
const LR = ["48","47","46","45","44","43","42","41"];
const LL = ["31","32","33","34","35","36","37","38"];
const ALL = [...UR, ...UL, ...LR, ...LL];

// 乳歯
const UR_D = ["55","54","53","52","51"];
const UL_D = ["61","62","63","64","65"];
const LR_D = ["85","84","83","82","81"];
const LL_D = ["71","72","73","74","75"];

const TS: Record<string, { label: string; sl: string; color: string; bg: string; border: string; cbg: string }> = {
  normal:      { label:"健全",   sl:"",    color:"text-gray-400",   bg:"bg-white",      border:"border-gray-200",  cbg:"bg-white" },
  c0:          { label:"C0",    sl:"C0",  color:"text-red-400",    bg:"bg-red-50",     border:"border-red-200",   cbg:"bg-red-50" },
  c1:          { label:"C1",    sl:"C1",  color:"text-red-500",    bg:"bg-red-50",     border:"border-red-300",   cbg:"bg-red-100" },
  c2:          { label:"C2",    sl:"C2",  color:"text-red-600",    bg:"bg-red-100",    border:"border-red-400",   cbg:"bg-red-100" },
  c3:          { label:"C3",    sl:"C3",  color:"text-red-700",    bg:"bg-red-200",    border:"border-red-500",   cbg:"bg-red-200" },
  c4:          { label:"C4",    sl:"C4",  color:"text-red-800",    bg:"bg-red-300",    border:"border-red-600",   cbg:"bg-red-300" },
  caries:      { label:"C",     sl:"C",   color:"text-red-600",    bg:"bg-red-100",    border:"border-red-400",   cbg:"bg-red-100" },
  in_treatment:{ label:"治療中", sl:"🔧",  color:"text-orange-700", bg:"bg-orange-50",  border:"border-orange-400",cbg:"bg-orange-100" },
  cr:          { label:"CR",    sl:"CR",  color:"text-blue-700",   bg:"bg-blue-50",    border:"border-blue-400",  cbg:"bg-blue-100" },
  inlay:       { label:"In",    sl:"In",  color:"text-cyan-700",   bg:"bg-cyan-50",    border:"border-cyan-400",  cbg:"bg-cyan-100" },
  crown:       { label:"Cr",    sl:"Cr",  color:"text-yellow-700", bg:"bg-yellow-50",  border:"border-yellow-400",cbg:"bg-yellow-100" },
  missing:     { label:"欠損",   sl:"×",   color:"text-gray-400",   bg:"bg-gray-100",   border:"border-gray-300",  cbg:"bg-gray-200" },
  implant:     { label:"IP",    sl:"IP",  color:"text-purple-700", bg:"bg-purple-50",  border:"border-purple-400",cbg:"bg-purple-100" },
  bridge:      { label:"Br",    sl:"Br",  color:"text-orange-700", bg:"bg-orange-50",  border:"border-orange-400",cbg:"bg-orange-100" },
  root_remain: { label:"残根",   sl:"残",  color:"text-pink-700",   bg:"bg-pink-50",    border:"border-pink-400",  cbg:"bg-pink-100" },
  watch:       { label:"観察",   sl:"△",   color:"text-amber-700",  bg:"bg-amber-50",   border:"border-amber-400", cbg:"bg-amber-100" },
  rct:         { label:"RCT",   sl:"RCT", color:"text-indigo-700", bg:"bg-indigo-50",  border:"border-indigo-400",cbg:"bg-indigo-100" },
};

const PST: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label:"通院中", color:"text-green-700",  bg:"bg-green-100" },
  inactive:  { label:"中断",   color:"text-orange-700", bg:"bg-orange-100" },
  suspended: { label:"休止",   color:"text-red-700",    bg:"bg-red-100" },
  completed: { label:"完了",   color:"text-gray-500",   bg:"bg-gray-100" },
};

const OUTCOME_LABEL: Record<string, { text: string; color: string }> = {
  continuing: { text:"継続", color:"bg-blue-100 text-blue-700" },
  cured:      { text:"治癒", color:"bg-green-100 text-green-700" },
  suspended:  { text:"中止", color:"bg-yellow-100 text-yellow-700" },
};

// ==============================
// ユーティリティ
// ==============================
function calcAge(d: string | null) {
  if (!d) return "-";
  const b = new Date(d), t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return `${a}歳`;
}
function fd(d: string | null) {
  if (!d) return "-";
  const dt = new Date(d);
  return `${dt.getFullYear()}/${String(dt.getMonth()+1).padStart(2,"0")}/${String(dt.getDate()).padStart(2,"0")}`;
}
function hd(v: unknown) {
  if (!v) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return false;
}
function pcl(v: number) {
  if (v >= 6) return "bg-red-500 text-white font-bold";
  if (v >= 4) return "bg-red-200 text-red-800 font-bold";
  return "text-gray-500";
}

// ==============================
// メインコンポーネント
// ==============================
export default function PatientDetailPage() {
  const params = useParams();
  const pid = params.id as string;

  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<MedicalRecord[]>([]);
  const [billingMap, setBillingMap] = useState<Record<string, BillingData>>({});
  const [diagnoses, setDiagnoses] = useState<PatientDiagnosis[]>([]);
  const [diagMaster, setDiagMaster] = useState<DiagnosisMaster[]>([]);
  const [diagModifiers, setDiagModifiers] = useState<DiagnosisModifier[]>([]);
  const [selectedPrefix, setSelectedPrefix] = useState("");
  const [selectedSuffix, setSelectedSuffix] = useState("");
  const [baseDiagName, setBaseDiagName] = useState("");
  const [toothMode, setToothMode] = useState<ToothMode>("permanent");
  const [th, setTH] = useState<ToothHistoryEntry[]>([]);
  const [ps, setPS] = useState<PerioSnapshot[]>([]);
  const [images, setImages] = useState<PatientImage[]>([]);
  const [todayAptId, setTodayAptId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // UI状態
  const [chartMode, setChartMode] = useState<"status" | "perio">("status");
  const [selectedTooth, setSelectedTooth] = useState<string | null>(null);
  const [statusDropdown, setStatusDropdown] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [receiptHtml, setReceiptHtml] = useState<string | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [showDocPanel, setShowDocPanel] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);


  // 患者基本情報モーダル
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [infoTab, setInfoTab] = useState<"basic" | "insurance" | "pub" | "manage">("basic");
  const [infoForm, setInfoForm] = useState<Record<string, string | boolean | null>>({});
  const [saving, setSaving] = useState(false);

  // 傷病名追加
  const [showDiagForm, setShowDiagForm] = useState(false);
  const [diagSearch, setDiagSearch] = useState("");
  const [newDiag, setNewDiag] = useState({ diagnosis_code: "", diagnosis_name: "", tooth_number: "", start_date: new Date().toISOString().split("T")[0], outcome: "continuing", is_primary: false });

  // カルテ編集（カルテ履歴クリックで展開・SOAP編集）
  const [editingRecord, setEditingRecord] = useState<MedicalRecord | null>(null);
  const soapORef = useRef<HTMLTextAreaElement>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const todayJST = new Date(new Date().getTime() + 9*60*60*1000).toISOString().split("T")[0];
    const [p, r, diag, t, s, img, todayApt] = await Promise.all([
      supabase.from("patients").select("*").eq("id", pid).single(),
      supabase.from("medical_records")
        .select("*, appointments(scheduled_at, patient_type, status, doctor_id)")
        .eq("patient_id", pid).order("created_at", { ascending: false }),
      supabase.from("patient_diagnoses").select("*").eq("patient_id", pid).order("start_date", { ascending: false }),
      supabase.from("tooth_history").select("*").eq("patient_id", pid).order("created_at", { ascending: false }),
      supabase.from("perio_snapshots").select("*").eq("patient_id", pid).order("created_at", { ascending: false }),
      supabase.from("patient_images").select("*").eq("patient_id", pid).order("created_at", { ascending: false }),
      supabase.from("appointments").select("id").eq("patient_id", pid)
        .gte("scheduled_at", `${todayJST}T00:00:00`).lte("scheduled_at", `${todayJST}T23:59:59`)
        .not("status", "in", '("cancelled","billing_done")').order("scheduled_at").limit(1).maybeSingle(),
    ]);
    if (p.data) setPatient(p.data);
    if (r.data) {
      setRecords(r.data as unknown as MedicalRecord[]);
      const ids = r.data.map((rec: MedicalRecord) => rec.id);
      if (ids.length > 0) {
        const { data: billings } = await supabase.from("billing")
          .select("record_id, total_points, patient_burden, insurance_claim, burden_ratio, procedures_detail, payment_status, created_at")
          .in("record_id", ids);
        if (billings) {
          const bMap: Record<string, BillingData> = {};
          billings.forEach((b: { record_id: string } & BillingData) => { bMap[b.record_id] = b; });
          setBillingMap(bMap);
        }
      }
    }
    if (diag.data) setDiagnoses(diag.data as PatientDiagnosis[]);
    if (t.data) setTH(t.data as ToothHistoryEntry[]);
    if (s.data) setPS(s.data as PerioSnapshot[]);
    if (img.data) setImages(img.data as PatientImage[]);
    if (todayApt.data) setTodayAptId((todayApt.data as { id: string }).id);
    setLoading(false);
  }, [pid]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    (async () => {
      const { data: masterData } = await supabase.from("diagnosis_master").select("code, name, category").order("sort_order");
      if (masterData) setDiagMaster(masterData as DiagnosisMaster[]);
      try {
        const { data: modData } = await supabase.from("diagnosis_modifiers").select("*").eq("is_active", true).order("sort_order");
        if (modData) setDiagModifiers(modData as DiagnosisModifier[]);
      } catch { /* テーブルがない場合はスキップ */ }
    })();
  }, []);

  // 年齢に応じた乳歯モード自動設定
  useEffect(() => {
    if (!patient?.date_of_birth) return;
    const b = new Date(patient.date_of_birth); const t = new Date();
    let a = t.getFullYear() - b.getFullYear();
    if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
    if (a <= 6) setToothMode("deciduous");
    else if (a <= 12) setToothMode("both");
    else setToothMode("permanent");
  }, [patient?.date_of_birth]);

  // 患者ステータス変更
  async function chgStatus(s: string) {
    if (!patient) return;
    await supabase.from("patients").update({ patient_status: s }).eq("id", patient.id);
    setPatient({ ...patient, patient_status: s });
    setStatusDropdown(false);
  }

  // 傷病名追加
  async function addDiagnosis() {
    if (!newDiag.diagnosis_name) return;
    setSaving(true);
    await supabase.from("patient_diagnoses").insert({ patient_id: pid, ...newDiag });
    const { data } = await supabase.from("patient_diagnoses").select("*").eq("patient_id", pid).order("start_date", { ascending: false });
    if (data) setDiagnoses(data as PatientDiagnosis[]);
    setNewDiag({ diagnosis_code: "", diagnosis_name: "", tooth_number: "", start_date: new Date().toISOString().split("T")[0], outcome: "continuing", is_primary: false });
    setShowDiagForm(false); setDiagSearch("");
    setSelectedPrefix(""); setSelectedSuffix(""); setBaseDiagName("");
    setSaving(false);
  }

  // 傷病名outcome更新
  async function updateOutcome(id: string, outcome: string) {
    const endDate = outcome !== "continuing" ? new Date().toISOString().split("T")[0] : null;
    await supabase.from("patient_diagnoses").update({ outcome, end_date: endDate }).eq("id", id);
    setDiagnoses(prev => prev.map(d => d.id === id ? { ...d, outcome, end_date: endDate } : d));
  }

  // 傷病名削除
  async function deleteDiagnosis(id: string) {
    if (!confirm("この傷病名を削除しますか？")) return;
    await supabase.from("patient_diagnoses").delete().eq("id", id);
    setDiagnoses(prev => prev.filter(d => d.id !== id));
  }

  // カルテSOAP保存
  async function saveSOAP(rec: MedicalRecord) {
    setSaving(true);
    await supabase.from("medical_records").update({
      soap_s: rec.soap_s, soap_o: rec.soap_o, soap_a: rec.soap_a, soap_p: rec.soap_p, status: "soap_complete"
    }).eq("id", rec.id);
    setRecords(prev => prev.map(r => r.id === rec.id ? { ...r, ...rec, status: "soap_complete" } : r));
    if (editingRecord?.id === rec.id) setEditingRecord({ ...rec, status: "soap_complete" });
    setSaving(false);
  }

  // カルテ確定
  async function confirmRecord(rec: MedicalRecord) {
    setSaving(true);
    await supabase.from("medical_records").update({
      soap_s: rec.soap_s, soap_o: rec.soap_o, soap_a: rec.soap_a, soap_p: rec.soap_p,
      status: "confirmed", doctor_confirmed: true
    }).eq("id", rec.id);
    setRecords(prev => prev.map(r => r.id === rec.id ? { ...r, status: "confirmed", doctor_confirmed: true } : r));
    if (editingRecord?.id === rec.id) setEditingRecord({ ...rec, status: "confirmed", doctor_confirmed: true });
    setSaving(false);
  }

  // 患者基本情報保存
  async function saveInfo() {
    if (!patient) return;
    setSaving(true);
    const updates: Record<string, unknown> = { ...infoForm };
    ["insurance_valid_from","insurance_valid_until","public_valid_from","public_valid_until"].forEach(k => {
      if (!updates[k]) updates[k] = null;
    });
    await supabase.from("patients").update(updates).eq("id", pid);
    setPatient({ ...patient, ...updates } as Patient);
    setShowInfoModal(false);
    setSaving(false);
  }

  // 領収書印刷
  function printReceipt(recordId: string) {
    const bill = billingMap[recordId];
    if (!bill || !patient) return;
    const procs = (bill.procedures_detail || []) as { category: string; code: string; name: string; points: number; count: number }[];
    const dateYMD = new Date(bill.created_at);
    const diagDate = `${dateYMD.getFullYear()}年${String(dateYMD.getMonth()+1).padStart(2,"0")}月${String(dateYMD.getDate()).padStart(2,"0")}日`;
    function mapCat(item: { category: string; code: string }): string {
      const cat = (item.category||"").toLowerCase(), code = (item.code||"").toUpperCase();
      if (code.startsWith("A0")) return "初・再診料";
      if (cat.includes("歯冠")||cat.includes("補綴")||code.startsWith("M-")) return "歯冠修復及び欠損補綴";
      if (code.startsWith("E")||cat.includes("画像")) return "画像診断";
      if ((code.startsWith("F-"))&&cat.includes("投薬")) return "投薬";
      if (code.startsWith("K0")||cat.includes("麻酔")) return "麻酔";
      if (code.startsWith("J0")||cat.includes("口腔外科")) return "手術";
      return "処置";
    }
    const catPts: Record<string, number> = {};
    procs.forEach(p => { const c = mapCat(p); catPts[c] = (catPts[c]||0) + p.points * p.count; });
    const row1 = ["初・再診料","医学管理等","在宅医療","検査","画像診断","投薬","注射","リハビリテーション"];
    const row2 = ["処置","手術","麻酔","歯冠修復及び欠損補綴","歯科矯正","病理診断","その他","介護"];
    const mkC = (cats: string[]) => cats.map(c => `<td class="lb">${c}</td>`).join("");
    const mkV = (cats: string[]) => cats.map(c => `<td class="vl">${catPts[c] ? `<b>${catPts[c]}</b><span class="u">点</span>` : `<span class="u">点</span>`}</td>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>領収書</title><style>@media print{.no-print{display:none!important;}@page{size:A4;margin:8mm;}}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:"Yu Gothic",sans-serif;max-width:700px;margin:0 auto;color:#111;font-size:11px;padding:10px;}h1{font-size:20px;text-align:center;letter-spacing:10px;margin:10px 0 14px;font-weight:800;}table{border-collapse:collapse;width:100%;}.bx td,.bx th{border:1.5px solid #111;padding:4px 6px;}.bx .hd{background:#f5f5f5;font-size:10px;text-align:center;font-weight:600;}.bx .vb{font-size:16px;font-weight:800;text-align:center;}.pt td{padding:0;}.pt .lb{border:1px solid #111;border-top:none;font-size:9px;text-align:center;padding:2px 3px;font-weight:600;}.pt .vl{border:1px solid #111;text-align:right;padding:4px 6px;min-width:60px;font-size:14px;}.pt .vl b{font-size:17px;}.pt .vl .u{font-size:8px;margin-left:2px;}.tot td{border:1.5px solid #111;padding:5px 8px;font-size:12px;}.tot .bg{font-size:20px;font-weight:900;}.tot .bk{background:#111;color:#fff;font-weight:700;}.stamp{width:55px;height:55px;border:1.5px solid #111;display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#999;}</style></head><body>
<h1>領 収 書</h1>
<table class="bx" style="margin-bottom:8px;"><tr><td class="hd" style="width:15%;">患者ID</td><td style="width:20%;text-align:center;">${patient.patient_number||"-"}</td><td class="hd" style="width:10%;">氏名</td><td style="width:25%;text-align:center;font-size:14px;font-weight:700;">${patient.name_kanji} 様</td><td class="hd" style="width:12%;">診療日</td><td style="width:18%;text-align:center;font-size:12px;font-weight:700;">${diagDate}</td></tr></table>
<table class="bx" style="margin-bottom:8px;"><tr><td class="hd">費用区分</td><td class="hd">負担率</td><td class="hd" colspan="4">&nbsp;</td></tr><tr><td class="vb">${patient.insurance_type||"社保"}</td><td class="vb">${Math.round(bill.burden_ratio*10)}割</td><td colspan="4"></td></tr></table>
<div style="font-size:11px;font-weight:700;margin-bottom:2px;">保険・介護</div>
<table class="pt"><tr>${mkC(row1)}</tr><tr>${mkV(row1)}</tr><tr>${mkC(row2)}</tr><tr>${mkV(row2)}</tr></table>
<div style="display:flex;gap:10px;margin-top:10px;">
<div style="flex:1.5;"><table class="tot"><tr><td class="hd">合計</td><td style="text-align:right;font-weight:800;font-size:16px;">${bill.total_points.toLocaleString()}<span style="font-size:9px;">点</span></td></tr><tr><td class="hd">負担額</td><td style="text-align:right;font-weight:800;font-size:16px;">${bill.patient_burden.toLocaleString()}<span style="font-size:9px;">円</span></td></tr></table><table class="tot" style="margin-top:4px;"><tr><td class="bk">領収金額</td><td style="text-align:right;"><span class="bg">${bill.patient_burden.toLocaleString()}</span><span style="font-size:10px;margin-left:4px;">円</span></td></tr></table></div></div>
<div style="display:flex;justify-content:space-between;margin-top:16px;font-size:9px;color:#555;"><div><p>この領収書の再発行はできませんので大切に保管してください。</p></div><div style="text-align:right;"><div class="stamp" style="margin-top:4px;">領収印</div></div></div></body></html>`;
    setReceiptHtml(html);
  }

  // ===== ローディング =====
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <p className="text-sm text-gray-400">⏳ 読み込み中...</p>
    </div>
  );
  if (!patient) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center"><p className="text-sm text-gray-500">❌ 患者が見つかりません</p>
        <Link href="/patients" className="text-sm text-sky-600 mt-2 inline-block">← 戻る</Link></div>
    </div>
  );

  const st = PST[patient.patient_status || "active"] || PST.active;
  const tc = (patient.current_tooth_chart || {}) as Record<string, ToothData>;
  const pc = (patient.current_perio_chart || {}) as PerioChart;

  // ===== 統計計算 =====
  let cC=0, iT=0, tC=0, pC=0, bP=0, bT=0, p4=0, totalSites=0, moC=0;
  ALL.forEach(t => {
    const d = tc[t]; const s = d?.status || "normal"; const pe = pc[t];
    if (["c0","c1","c2","c3","c4","caries"].includes(s)) cC++;
    if (s === "in_treatment") iT++;
    if (["cr","inlay","crown","rct"].includes(s)) tC++;
    if (s !== "missing") pC++;
    if (pe) {
      if (pe.bop) bP++; bT++;
      [...(pe.buccal||[]), ...(pe.lingual||[])].forEach(v => { totalSites++; if (v >= 4) p4++; });
      if (pe.mobility > 0) moC++;
    }
  });
  const bR = bT > 0 ? Math.round((bP/bT)*1000)/10 : 0;
  const lastPerio = ps.length > 0 ? fd(ps[0].created_at) : null;

  // 未処置歯（治療中・計画中）
  const untreatedDiagnoses = diagnoses.filter(d => d.outcome === "continuing");

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ===== ヘッダー ===== */}
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-30">
        <div className="max-w-screen-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/patients" className="text-sm text-gray-400 hover:text-gray-600">← 患者一覧</Link>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-white flex items-center justify-center font-bold text-lg shrink-0">
                {patient.name_kanji?.charAt(0) || "?"}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-gray-900">{patient.name_kanji}</h1>
                  <span className="text-xs text-gray-400">{patient.name_kana}</span>
                  {patient.is_new && <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold">新患</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span className="font-mono">{patient.patient_number || "-"}</span>
                  <span>•</span>
                  <span>{calcAge(patient.date_of_birth)}</span>
                  <span>•</span>
                  <span>{patient.sex || "-"}</span>
                  <span>•</span>
                  <span>{patient.insurance_type || "-"}</span>
                  <span>•</span>
                  <span>最終来院: {records.length > 0 ? fd(records[0].appointments?.scheduled_at || records[0].created_at) : "-"}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {hd(patient.allergies) && <span className="text-[10px] bg-red-100 text-red-600 px-2 py-1 rounded font-bold">⚠ アレルギー</span>}
            {patient.infection_flags && <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-1 rounded font-bold">🦠 {patient.infection_flags}</span>}
            {patient.alert_memo && <span className="text-[10px] bg-yellow-100 text-yellow-800 px-2 py-1 rounded font-bold max-w-[160px] truncate">📌 {patient.alert_memo}</span>}
            {/* ステータスバッジ */}
            <div className="relative">
              <button onClick={() => setStatusDropdown(!statusDropdown)}
                className={`${st.bg} ${st.color} text-xs font-bold px-3 py-1.5 rounded-lg hover:opacity-80`}>
                {st.label} ▾
              </button>
              {statusDropdown && (
                <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-50 min-w-[120px] overflow-hidden">
                  {Object.entries(PST).map(([k, c]) => (
                    <button key={k} onClick={() => chgStatus(k)}
                      className={`block w-full text-left px-4 py-2.5 text-xs hover:bg-gray-50 ${c.color} font-bold`}>{c.label}</button>
                  ))}
                </div>
              )}
            </div>
            {/* 患者基本情報ボタン */}
            <button onClick={() => {
              setInfoForm({
                sex: patient.sex || "", postal_code: patient.postal_code || "", address: patient.address || "",
                occupation: patient.occupation || "", notes: patient.notes || "",
                insurer_number: patient.insurer_number || "", insured_symbol: patient.insured_symbol || "",
                insured_number: patient.insured_number || "", insured_branch: patient.insured_branch || "",
                insurance_relation: patient.insurance_relation || "self", insured_name: patient.insured_name || "",
                insurer_name: patient.insurer_name || "", insurer_address: patient.insurer_address || "",
                insurer_phone: patient.insurer_phone || "", insurance_valid_from: patient.insurance_valid_from || "",
                insurance_valid_until: patient.insurance_valid_until || "",
                high_cost_medical: patient.high_cost_medical || false,
                income_category: patient.income_category || "", disability_flag: patient.disability_flag || false,
                public_insurer: patient.public_insurer || "", public_recipient: patient.public_recipient || "",
                public_valid_from: patient.public_valid_from || "", public_valid_until: patient.public_valid_until || "",
                infection_flags: patient.infection_flags || "", alert_memo: patient.alert_memo || "",
                subchart_notes: patient.subchart_notes || "",
              });
              setShowInfoModal(true);
            }}
              className="bg-blue-600 text-white text-xs font-bold px-4 py-2 rounded-lg hover:bg-blue-700">
              患者基本情報
            </button>
            {/* 診察開始ボタン */}
            <Link href={todayAptId ? `/karte-agent/consultation?appointment_id=${todayAptId}` : `/reservation?patient=${patient.id}`}
              className={`text-xs font-bold px-4 py-2 rounded-lg ${todayAptId ? "bg-orange-500 text-white hover:bg-orange-600" : "bg-gray-200 text-gray-600 hover:bg-gray-300"}`}>
              {todayAptId ? "🩺 診察開始" : "📅 予約を入れる"}
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 py-4">

        {/* ===== メインレイアウト：左（チャート＋カルテ）＋ 右（未処置歯・タスク他） ===== */}
        <div className="flex gap-4 items-start">

          {/* 左メインカラム（全顎チャート＋カルテ履歴） */}
          <div className="flex-1 flex flex-col gap-4">

          {/* 全顎チャート */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-gray-900">● 全顎チャート</h2>
              <div className="flex items-center gap-3">
                {/* チャートモード切り替え */}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setChartMode("status")}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${chartMode==="status" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                    🦷 ステータス
                  </button>
                  <button onClick={() => setChartMode("perio")}
                    className={`px-3 py-1.5 rounded-md text-[11px] font-bold transition-all ${chartMode==="perio" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>
                    📊 P検
                  </button>
                </div>
                {/* 乳歯モード切り替え */}
                <div className="flex bg-gray-100 rounded-lg p-0.5">
                  <button onClick={() => setToothMode("permanent")}
                    className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${toothMode==="permanent" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>永久歯</button>
                  <button onClick={() => setToothMode("both")}
                    className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${toothMode==="both" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>混合</button>
                  <button onClick={() => setToothMode("deciduous")}
                    className={`px-2.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${toothMode==="deciduous" ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"}`}>乳歯</button>
                </div>
                {/* 凡例 */}
                <div className="flex items-center gap-2 text-[10px]">
                  {chartMode === "status" ? (
                    <>
                      <Leg c="bg-red-100 border-red-400" t="要治療" />
                      <Leg c="bg-orange-100 border-orange-400" t="治療中" />
                      <Leg c="bg-yellow-100 border-yellow-400" t="完了" />
                      <Leg c="bg-amber-100 border-amber-400" t="観察" />
                      <Leg c="bg-gray-200 border-gray-300" t="欠損" />
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-500"></span>BOP(+)</span>
                      <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded bg-red-200 border border-red-300"></span>PPD≧4</span>
                    </>
                  )}
                </div>
              </div>
            </div>

            {chartMode === "status" ? (
              <>
                <div className="text-[9px] text-gray-400 mb-1">上顎 MAXILLA ← R</div>
                <div className="flex justify-center overflow-x-auto mb-1">
                  {(toothMode === "permanent" || toothMode === "both") && (
                    <StatusRow teeth={[...UR, ...UL]} tc={tc} sel={selectedTooth} setSel={setSelectedTooth} jaw="upper" />
                  )}
                </div>
                {(toothMode === "deciduous" || toothMode === "both") && (
                  <div className="flex justify-center overflow-x-auto mb-1">
                    <StatusRow teeth={[...UR_D, ...UL_D]} tc={tc} sel={selectedTooth} setSel={setSelectedTooth} jaw="upper" isDeciduous />
                  </div>
                )}
                <div className="text-[9px] text-gray-400 mb-1">下顎 MANDIBLE ← R</div>
                {(toothMode === "deciduous" || toothMode === "both") && (
                  <div className="flex justify-center overflow-x-auto mb-1">
                    <StatusRow teeth={[...LR_D, ...LL_D]} tc={tc} sel={selectedTooth} setSel={setSelectedTooth} jaw="lower" isDeciduous />
                  </div>
                )}
                <div className="flex justify-center overflow-x-auto">
                  {(toothMode === "permanent" || toothMode === "both") && (
                    <StatusRow teeth={[...LR, ...LL]} tc={tc} sel={selectedTooth} setSel={setSelectedTooth} jaw="lower" />
                  )}
                </div>
              </>
            ) : (
              <>
                <PerioChartView teeth={[...UR,...UL]} pc={pc} tc={tc} sel={selectedTooth} setSel={setSelectedTooth} jaw="upper" label="上顎" />
                <div className="my-2 border-t border-gray-200" />
                <PerioChartView teeth={[...LR,...LL]} pc={pc} tc={tc} sel={selectedTooth} setSel={setSelectedTooth} jaw="lower" label="下顎" />
              </>
            )}

            {/* サマリー */}
            <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100 flex-wrap">
              {chartMode === "status" ? (
                <>
                  <SB l="要治療" v={`${cC}歯`} c="text-red-600" b="bg-red-50" />
                  <SB l="治療中" v={`${iT}歯`} c="text-orange-600" b="bg-orange-50" />
                  <SB l="完了" v={`${tC}歯`} c="text-green-600" b="bg-green-50" />
                  <SB l="残存歯" v={`${pC}/32`} c="text-gray-700" b="bg-gray-50" />
                </>
              ) : (
                <>
                  <SB l="BOP率" v={`${bR}%`} c={bR>30?"text-red-600":"text-green-600"} b={bR>30?"bg-red-50":"bg-green-50"} />
                  <SB l="残存歯" v={`${pC}/32`} c="text-gray-700" b="bg-gray-50" />
                  {lastPerio && <SB l="最終P検" v={lastPerio} c="text-blue-600" b="bg-blue-50" />}
                </>
              )}
            </div>

            {/* 歯クリック詳細 */}
            {selectedTooth && (() => {
              const d = tc[selectedTooth]; const pe = pc[selectedTooth];
              const selH = th.filter(h => h.tooth_number === selectedTooth);
              return (
                <div className="mt-3 pt-3 border-t border-sky-200 bg-sky-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-sky-800 text-sm">🦷 #{selectedTooth} の詳細</span>
                    <button onClick={() => setSelectedTooth(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-gray-500">状態: </span>
                      <span className="font-bold">{TS[d?.status||"normal"]?.label || "健全"}</span>
                    </div>
                    {pe && (
                      <>
                        <div><span className="text-gray-500">BOP: </span><span className={`font-bold ${pe.bop ? "text-red-600" : "text-green-600"}`}>{pe.bop ? "(+)" : "(-)"}</span></div>
                        <div><span className="text-gray-500">頬側: </span><span>{pe.buccal.map((v,i) => <span key={i} className={`mx-0.5 px-1 rounded text-[10px] ${pcl(v)}`}>{v}</span>)}</span></div>
                        <div><span className="text-gray-500">舌側: </span><span>{pe.lingual.map((v,i) => <span key={i} className={`mx-0.5 px-1 rounded text-[10px] ${pcl(v)}`}>{v}</span>)}</span></div>
                      </>
                    )}
                    {selH.length > 0 && (
                      <div className="col-span-2">
                        <span className="text-gray-500 font-bold">変更履歴: </span>
                        <div className="mt-1 space-y-0.5">
                          {selH.slice(0,4).map(h => (
                            <div key={h.id} className="text-[10px]">
                              <span className="text-gray-400">{fd(h.created_at)}: </span>
                              {h.change_type === "status_change" && (
                                <span>{TS[h.previous_status||""]?.label||"—"} → <span className="font-bold text-sky-700">{TS[h.new_status||""]?.label}</span></span>
                              )}
                              {h.change_type === "perio_update" && <span className="text-teal-600">P検更新{h.bop ? " BOP(+)" : ""}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>


          {/* 右サイドカラム（未処置歯リスト＋タスク他） */}
          <div className="w-64 shrink-0 flex flex-col gap-3">
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-800">📋 未処置歯リスト</span>
                  {untreatedDiagnoses.length > 0 && (
                    <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full">{untreatedDiagnoses.length}歯</span>
                  )}
                </div>
              </div>
              <div>
                {untreatedDiagnoses.length === 0 ? (
                  <div className="px-4 py-6 text-center text-xs text-gray-400">未処置歯はありません</div>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {untreatedDiagnoses.map(d => {
                      const current = d.session_current || 0;
                      const total = d.session_total || 1;
                      const pct = Math.round((current / total) * 100);
                      const isActive = tc[d.tooth_number||""]?.status === "in_treatment";
                      return (
                        <div key={d.id} className={`px-4 py-3 ${isActive ? "bg-orange-50" : ""}`}>
                          <div className="flex items-start justify-between mb-1.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {d.tooth_number && (
                                <span className="text-[11px] font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{d.tooth_number}番</span>
                              )}
                              <span className="text-xs font-bold text-gray-800">{d.diagnosis_name}</span>
                            </div>
                            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ml-2 ${isActive ? "bg-orange-100 text-orange-700" : "bg-blue-100 text-blue-700"}`}>
                              {isActive ? "治療中" : "計画中"}
                            </span>
                          </div>
                          {total > 1 ? (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${pct}%` }} />
                              </div>
                              <span className="text-[9px] text-gray-400 shrink-0">{current}/{total}回</span>
                            </div>
                          ) : (
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {current === 0 ? "未開始" : `第${current}回`} / 全{total}回予定
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="px-4 py-3 border-t border-gray-100">
                  <button className="w-full text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 py-2.5 rounded-lg transition-colors">
                    ＋ 治療計画書作成
                  </button>
                </div>
              </div>
            </div>
            {/* タスク・書類・チャット（同じ右サイドカラム内） */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <button className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50 border-b border-gray-100">
                <span className="text-sm font-bold text-gray-800">✅ タスク一覧</span>
                <span className="text-gray-400">›</span>
              </button>

              {/* 書類・資料（展開式） */}
              <div className="border-t border-gray-100">
                <button onClick={() => setShowDocPanel(!showDocPanel)}
                  className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-800">📄 書類・資料</span>
                    {images.length > 0 && <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{images.length}</span>}
                  </div>
                  <span className="text-gray-400">{showDocPanel ? "▼" : "›"}</span>
                </button>
                {showDocPanel && (
                  <div className="border-b border-gray-100">
                    <div className="px-4 py-3 border-b border-gray-50">
                      <label className="flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 rounded-lg p-3 cursor-pointer hover:border-sky-400 hover:bg-sky-50 transition-all text-xs text-gray-500">
                        <span>{imgLoading ? "⏳ アップロード中..." : "📤 画像をアップロード"}</span>
                        <input type="file" accept="image/*" className="hidden" disabled={imgLoading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0]; if (!file) return;
                            setImgLoading(true);
                            const formData = new FormData();
                            formData.append("file", file); formData.append("patient_id", pid); formData.append("image_type", "panorama");
                            const res = await fetch("/api/image-upload", { method: "POST", body: formData });
                            const data = await res.json();
                            if (data.success) await fetchData(); else alert("アップロード失敗: " + data.error);
                            setImgLoading(false); e.target.value = "";
                          }} />
                      </label>
                    </div>
                    <div className="max-h-40 overflow-y-auto divide-y divide-gray-50">
                      {images.length === 0 ? (
                        <div className="px-4 py-4 text-center text-xs text-gray-400">画像はまだありません</div>
                      ) : images.map(img => {
                        const pubUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL||""}/storage/v1/object/public/patient-images/${img.storage_path}`;
                        const hasAi = img.ai_analysis && Object.keys(img.ai_analysis).length > 0;
                        return (
                          <div key={img.id} className="px-4 py-2 flex items-center gap-2">
                            <img src={pubUrl} alt="" className="w-8 h-8 object-cover rounded border border-gray-200" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                            <div className="flex-1 min-w-0">
                              <p className="text-[10px] font-bold text-gray-700 truncate">{img.file_name || img.image_type}</p>
                              {hasAi && <span className="text-[9px] text-green-600 font-bold">AI分析済</span>}
                            </div>
                            <button disabled={aiAnalyzing} onClick={async () => {
                              setAiAnalyzing(true);
                              const imgRes = await fetch(pubUrl); const blob = await imgRes.blob();
                              const b64: string = await new Promise(res => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1]); r.readAsDataURL(blob); });
                              const resp = await fetch("/api/xray-analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_base64: b64, patient_id: pid }) });
                              const data = await resp.json();
                              if (data.success) { await supabase.from("patient_images").update({ ai_analysis: data.analysis }).eq("id", img.id); await fetchData(); alert("AI分析完了: " + (data.summary||"")); }
                              else alert("分析失敗: " + data.error);
                              setAiAnalyzing(false);
                            }} className="text-[9px] bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded hover:bg-purple-100 shrink-0">AI</button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="px-4 py-2 flex gap-2">
                      <button className="flex-1 text-[10px] font-bold text-sky-600 bg-sky-50 hover:bg-sky-100 py-1.5 rounded transition-colors">📋 紹介状</button>
                      <button className="flex-1 text-[10px] font-bold text-green-600 bg-green-50 hover:bg-green-100 py-1.5 rounded transition-colors">✍️ 同意書</button>
                    </div>
                  </div>
                )}
              </div>
              {/* チャット */}
              <button className="w-full flex items-center justify-between px-4 py-4 hover:bg-gray-50">
                <span className="text-sm font-bold text-gray-800">💬 チャット</span>
                <span className="text-gray-400">›</span>
              </button>
            </div>
          </div>
            {/* ===== カルテ履歴（左メインカラム2つ目） ===== */}
            <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">📋 カルテ履歴</h2>
            {/* 傷病名管理タブ */}
            <div className="flex items-center gap-2">
              <button onClick={() => setShowDiagForm(!showDiagForm)}
                className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${showDiagForm ? "bg-gray-200 text-gray-600" : "bg-sky-100 text-sky-700 hover:bg-sky-200"}`}>
                🏷️ 傷病名管理
              </button>
            </div>
          </div>

          {/* 傷病名管理パネル */}
          {showDiagForm && (
            <div className="px-5 py-4 border-b border-gray-100 bg-sky-50">
              <div className="flex items-start gap-4">
                {/* 傷病名リスト */}
                <div className="flex-1">
                  <p className="text-xs font-bold text-gray-700 mb-2">現在の傷病名</p>
                  {diagnoses.length === 0 ? (
                    <p className="text-xs text-gray-400">登録なし</p>
                  ) : (
                    <div className="space-y-1.5">
                      {diagnoses.map(d => {
                        const oc = OUTCOME_LABEL[d.outcome] || OUTCOME_LABEL.continuing;
                        return (
                          <div key={d.id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-gray-200">
                            <div className="flex items-center gap-2">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${oc.color}`}>{oc.text}</span>
                              <span className="text-xs font-bold text-gray-800">{d.diagnosis_name}</span>
                              {d.tooth_number && <span className="text-[10px] text-sky-600">{d.tooth_number}番</span>}
                              <span className="text-[10px] text-gray-400">{d.start_date}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <select value={d.outcome} onChange={e => updateOutcome(d.id, e.target.value)}
                                className="text-[10px] border border-gray-200 rounded px-1 py-0.5">
                                <option value="continuing">継続</option>
                                <option value="cured">治癒</option>
                                <option value="suspended">中止</option>
                              </select>
                              <button onClick={() => deleteDiagnosis(d.id)} className="text-[10px] text-red-400 hover:text-red-600 px-1">✕</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* 新規追加フォーム */}
                <div className="w-72 bg-white rounded-xl border border-sky-200 p-3">
                  <p className="text-xs font-bold text-sky-700 mb-2">＋ 傷病名を追加</p>
                  <input value={diagSearch} onChange={e => setDiagSearch(e.target.value)}
                    placeholder="傷病名を検索..." className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs mb-2 focus:outline-none focus:border-sky-400" />
                  {diagSearch.length > 0 && (
                    <div className="max-h-28 overflow-y-auto bg-gray-50 rounded-lg border border-gray-200 mb-2">
                      {diagMaster.filter(d => d.name.includes(diagSearch) || d.code.includes(diagSearch)).slice(0, 10).map(d => (
                        <button key={d.code} onClick={() => {
                          setBaseDiagName(d.name);
                          setSelectedPrefix(""); setSelectedSuffix("");
                          setNewDiag(prev => ({ ...prev, diagnosis_code: d.code, diagnosis_name: d.name }));
                          setDiagSearch("");
                        }}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-sky-50 border-b border-gray-100 last:border-0">
                          <span className="text-gray-400 mr-2">{d.code}</span>
                          <span className="font-bold text-gray-700">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {newDiag.diagnosis_name && (
                    <>
                      <div className="bg-sky-50 rounded-lg px-2 py-1.5 mb-2 text-xs font-bold text-sky-700">{newDiag.diagnosis_name}</div>
                      {/* 修飾語 */}
                      {diagModifiers.length > 0 && (
                        <div className="bg-white rounded-lg border border-gray-200 p-2 mb-2">
                          <p className="text-[9px] text-gray-400 font-bold mb-1">修飾語</p>
                          {(() => {
                            const prefixes = diagModifiers.filter(m => m.modifier_position === "prefix");
                            const suffixes = diagModifiers.filter(m => m.modifier_position === "suffix");
                            const updateName = (prefix: string, suffix: string) => {
                              const combined = `${prefix}${baseDiagName}${suffix}`;
                              setNewDiag(prev => ({ ...prev, diagnosis_name: combined }));
                            };
                            return (
                              <>
                                {prefixes.length > 0 && (
                                  <div className="mb-1.5">
                                    <p className="text-[9px] text-gray-300 mb-0.5">前置</p>
                                    <div className="flex flex-wrap gap-1">
                                      <button onClick={() => { setSelectedPrefix(""); updateName("", selectedSuffix); }}
                                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${selectedPrefix === "" ? "bg-sky-100 border-sky-300 text-sky-700" : "bg-white border-gray-200 text-gray-400"}`}>なし</button>
                                      {prefixes.map(m => (
                                        <button key={m.id} onClick={() => { setSelectedPrefix(m.modifier_name); updateName(m.modifier_name, selectedSuffix); }}
                                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${selectedPrefix === m.modifier_name ? "bg-sky-100 border-sky-300 text-sky-700" : "bg-white border-gray-200 text-gray-400"}`}>
                                          {m.modifier_name}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {suffixes.length > 0 && (
                                  <div>
                                    <p className="text-[9px] text-gray-300 mb-0.5">後置</p>
                                    <div className="flex flex-wrap gap-1">
                                      <button onClick={() => { setSelectedSuffix(""); updateName(selectedPrefix, ""); }}
                                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${selectedSuffix === "" ? "bg-sky-100 border-sky-300 text-sky-700" : "bg-white border-gray-200 text-gray-400"}`}>なし</button>
                                      {suffixes.map(m => (
                                        <button key={m.id} onClick={() => { setSelectedSuffix(m.modifier_name); updateName(selectedPrefix, m.modifier_name); }}
                                          className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${selectedSuffix === m.modifier_name ? "bg-sky-100 border-sky-300 text-sky-700" : "bg-white border-gray-200 text-gray-400"}`}>
                                          {m.modifier_name}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      )}
                      <div className="bg-sky-50 rounded-lg px-2 py-1.5 mb-2 text-xs font-bold text-sky-700">{newDiag.diagnosis_name}</div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div><label className="text-[9px] text-gray-400 block mb-0.5">歯番</label>
                          <input value={newDiag.tooth_number} onChange={e => setNewDiag({...newDiag, tooth_number: e.target.value})}
                            placeholder="#46" className="w-full border border-gray-200 rounded px-2 py-1 text-xs" /></div>
                        <div><label className="text-[9px] text-gray-400 block mb-0.5">開始日</label>
                          <input type="date" value={newDiag.start_date} onChange={e => setNewDiag({...newDiag, start_date: e.target.value})}
                            className="w-full border border-gray-200 rounded px-2 py-1 text-xs" /></div>
                      </div>
                      <button onClick={addDiagnosis} disabled={saving}
                        className="w-full bg-sky-600 text-white py-1.5 rounded-lg text-xs font-bold hover:bg-sky-700 disabled:opacity-50">
                        追加
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* カルテ履歴タイムライン */}
          <div className="divide-y divide-gray-50">
            {records.length === 0 ? (
              <div className="py-12 text-center"><p className="text-sm text-gray-400">カルテ履歴はまだありません</p></div>
            ) : records.map(r => {
              const isExpanded = expandedRecord === r.id;
              const isEditing = editingRecord?.id === r.id;
              const bill = billingMap[r.id];
              return (
                <div key={r.id}>
                  {/* カルテ行 */}
                  <div className="px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedRecord(null);
                        setEditingRecord(null);
                      } else {
                        setExpandedRecord(r.id);
                        setEditingRecord({ ...r });
                      }
                    }}>
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-sky-400 shrink-0" />
                      <span className="text-sm font-bold text-gray-900 hover:text-sky-600">
                        {fd(r.appointments?.scheduled_at || r.created_at)}
                      </span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${r.appointments?.patient_type === "new" ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-500"}`}>
                        {r.appointments?.patient_type === "new" ? "初診" : "再診"}
                      </span>
                      {r.doctor_confirmed
                        ? <span className="text-[10px] bg-green-100 text-green-600 px-2 py-0.5 rounded-full font-bold">✓ 確定</span>
                        : <span className="text-[10px] bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full font-bold">未確定</span>
                      }
                      {/* 処置サマリー */}
                      {r.soap_s && <span className="text-xs text-gray-400 truncate max-w-xs hidden md:block">{r.soap_s.slice(0, 40)}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      {bill && (
                        <>
                          <span className="text-xs font-bold text-sky-700">{bill.total_points.toLocaleString()}点</span>
                          <span className="text-xs font-bold text-gray-700">¥{bill.patient_burden.toLocaleString()}</span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${bill.payment_status === "paid" ? "bg-green-100 text-green-600" : "bg-red-100 text-red-500"}`}>
                            {bill.payment_status === "paid" ? "精算済" : "未精算"}
                          </span>
                          <button onClick={e => { e.stopPropagation(); printReceipt(r.id); }}
                            className="text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-500 px-2 py-1 rounded font-bold">
                            📄 領収書
                          </button>
                        </>
                      )}
                      <span className="text-gray-400 text-xs">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                  </div>

                  {/* 展開：SOAP編集エリア */}
                  {isExpanded && editingRecord && isEditing && (
                    <div className="px-5 pb-5 bg-gray-50 border-t border-gray-100">
                      {/* 操作ボタン */}
                      <div className="flex items-center justify-between py-3">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${editingRecord.status === "confirmed" ? "bg-green-100 text-green-700" : editingRecord.status === "soap_complete" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-500"}`}>
                            {editingRecord.status === "confirmed" ? "✅ 確定済み" : editingRecord.status === "soap_complete" ? "📝 SOAP入力済み" : "📋 下書き"}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => saveSOAP(editingRecord)} disabled={saving || editingRecord.status === "confirmed"}
                            className="bg-sky-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-sky-700 disabled:opacity-40">
                            一時保存
                          </button>
                          {editingRecord.status !== "confirmed" ? (
                            <button onClick={() => confirmRecord(editingRecord)} disabled={saving}
                              className="bg-green-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-green-700 disabled:opacity-40">
                              カルテ確定
                            </button>
                          ) : (
                            <button onClick={async () => {
                              setSaving(true);
                              await supabase.from("medical_records").update({ status: "soap_complete", doctor_confirmed: false }).eq("id", editingRecord.id);
                              const updated = { ...editingRecord, status: "soap_complete", doctor_confirmed: false };
                              setRecords(prev => prev.map(r => r.id === editingRecord.id ? updated : r));
                              setEditingRecord(updated);
                              setSaving(false);
                            }} disabled={saving} className="bg-yellow-500 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-yellow-600 disabled:opacity-40">
                              🔓 編集する
                            </button>
                          )}
                        </div>
                      </div>

                      {/* SOAP */}
                      <div className="grid grid-cols-2 gap-3">
                        {([
                          { key: "soap_s" as const, l: "S", t: "主訴", c: "text-pink-600" },
                          { key: "soap_o" as const, l: "O", t: "客観的情報", c: "text-green-600" },
                          { key: "soap_a" as const, l: "A", t: "評価", c: "text-blue-600" },
                          { key: "soap_p" as const, l: "P", t: "計画", c: "text-purple-600" },
                        ]).map(s => (
                          <div key={s.key} className="bg-white rounded-lg border border-gray-200 p-3">
                            <div className="flex items-center gap-1.5 mb-2">
                              <span className={`text-xs font-bold ${s.c}`}>{s.l}</span>
                              <span className="text-xs text-gray-500">{s.t}</span>
                            </div>
                            <textarea
                              ref={s.key === "soap_o" ? soapORef : undefined}
                              value={editingRecord[s.key] || ""}
                              onChange={e => setEditingRecord({ ...editingRecord, [s.key]: e.target.value })}
                              disabled={editingRecord.status === "confirmed"}
                              rows={3}
                              className="w-full text-sm border-0 resize-none focus:outline-none disabled:bg-white text-gray-700 placeholder-gray-300"
                            />
                          </div>
                        ))}
                      </div>

                      {/* 処置記録 */}
                      {bill?.procedures_detail && (bill.procedures_detail as { name: string; points: number; count: number }[]).length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-bold text-gray-500 mb-2">処置内容</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(bill.procedures_detail as { name: string; points: number; count: number }[]).filter(p => p.points > 0).map((p, i) => (
                              <span key={i} className="text-[10px] bg-white border border-gray-200 text-gray-600 px-2 py-1 rounded">
                                {p.name}{p.count > 1 ? `×${p.count}` : ""} {p.points * p.count}点
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>  {/* カルテ履歴終了 */}
          </div>  {/* 左メインカラム終了 */}
          </div>  {/* 右サイドカラム終了 */}
        </div>  {/* メインflex終了 */}
      </main>

      {/* ===== 患者基本情報モーダル ===== */}
      {showInfoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h3 className="font-bold text-gray-900 text-lg">患者基本情報</h3>
              <button onClick={() => setShowInfoModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            {/* タブ */}
            <div className="flex border-b px-6">
              {([
                { k: "basic" as const, l: "基本情報" },
                { k: "insurance" as const, l: "保険情報" },
                { k: "pub" as const, l: "公費" },
                { k: "manage" as const, l: "管理情報" },
              ]).map(t => (
                <button key={t.k} onClick={() => setInfoTab(t.k)}
                  className={`px-4 py-3 text-xs font-bold border-b-2 transition-colors ${infoTab===t.k ? "border-sky-500 text-sky-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
                  {t.l}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {infoTab === "basic" && (
                <div className="grid grid-cols-2 gap-4">
                  <IR l="氏名（漢字）" v={patient.name_kanji} />
                  <IR l="氏名（カナ）" v={patient.name_kana} />
                  <IR l="生年月日" v={`${fd(patient.date_of_birth)} (${calcAge(patient.date_of_birth)})`} />
                  <div><label className="text-[10px] text-gray-400 block mb-1">性別</label>
                    <select value={String(infoForm.sex||"")} onChange={e => setInfoForm({...infoForm, sex: e.target.value})}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400">
                      <option value="男">男</option><option value="女">女</option>
                    </select>
                  </div>
                  <IR l="電話番号" v={patient.phone} />
                  <IR l="メール" v={patient.email} />
                  <div><label className="text-[10px] text-gray-400 block mb-1">郵便番号</label>
                    <input value={String(infoForm.postal_code||"")} onChange={e => setInfoForm({...infoForm, postal_code: e.target.value})}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                  <div><label className="text-[10px] text-gray-400 block mb-1">住所</label>
                    <input value={String(infoForm.address||"")} onChange={e => setInfoForm({...infoForm, address: e.target.value})}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                  <div><label className="text-[10px] text-gray-400 block mb-1">職業</label>
                    <input value={String(infoForm.occupation||"")} onChange={e => setInfoForm({...infoForm, occupation: e.target.value})}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                  <div className="col-span-2"><label className="text-[10px] text-gray-400 block mb-1">備考</label>
                    <textarea value={String(infoForm.notes||"")} onChange={e => setInfoForm({...infoForm, notes: e.target.value})} rows={3}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                </div>
              )}
              {infoTab === "insurance" && (
                <div className="space-y-3">
                  <div className="bg-sky-50 rounded-lg border border-sky-200 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-sky-700 font-bold">📷 保険証スキャン（OCR）</p>
                      <label className="cursor-pointer">
                        <span className="text-[10px] font-bold bg-sky-600 text-white px-3 py-1.5 rounded-lg hover:bg-sky-700">📸 保険証を撮影/選択</span>
                        <input type="file" accept="image/*" capture="environment" className="hidden"
                          onChange={async (ev) => {
                            const file = ev.target.files?.[0]; if (!file) return;
                            const reader = new FileReader();
                            reader.onload = async () => {
                              const b64 = (reader.result as string).split(",")[1];
                              const res = await fetch("/api/insurance-ocr", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image_base64: b64 }) });
                              const data = await res.json();
                              if (data.success && data.ocr) {
                                const o = data.ocr; const updates: Record<string, string | boolean | null> = {};
                                if (o.insurance_type) updates.insurance_type = o.insurance_type;
                                if (o.insurer_number) updates.insurer_number = o.insurer_number;
                                if (o.insured_symbol) updates.insured_symbol = o.insured_symbol;
                                if (o.insured_number) updates.insured_number = o.insured_number;
                                setInfoForm(prev => ({ ...prev, ...updates }));
                                alert(`✅ OCR完了 (${Math.round((o.confidence||0)*100)}%)`);
                              } else alert("❌ " + (data.error || "OCR失敗"));
                            };
                            reader.readAsDataURL(file); ev.target.value = "";
                          }} />
                      </label>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <IR l="保険種別" v={patient.insurance_type} />
                    <IR l="負担割合" v={patient.burden_ratio ? `${Math.round(patient.burden_ratio*10)}割` : null} />
                    {[
                      { l: "保険者番号", k: "insurer_number" }, { l: "被保険者記号", k: "insured_symbol" },
                      { l: "被保険者番号", k: "insured_number" }, { l: "枝番", k: "insured_branch" },
                      { l: "保険者名称", k: "insurer_name" }, { l: "保険者所在地", k: "insurer_address" },
                      { l: "有効期限（開始）", k: "insurance_valid_from" }, { l: "有効期限（終了）", k: "insurance_valid_until" },
                    ].map(({ l, k }) => (
                      <div key={k}><label className="text-[10px] text-gray-400 block mb-1">{l}</label>
                        <input value={String(infoForm[k]||"")} onChange={e => setInfoForm({...infoForm, [k]: e.target.value})}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                    ))}
                  </div>
                </div>
              )}
              {infoTab === "pub" && (
                <div className="space-y-4">
                  {[
                    { title: "第一公費", ik: "public_insurer", rk: "public_recipient", vfk: "public_valid_from", vtk: "public_valid_until" },
                    { title: "第二公費", ik: "public_insurer_2", rk: "public_recipient_2", vfk: "", vtk: "" },
                    { title: "第三公費", ik: "public_insurer_3", rk: "public_recipient_3", vfk: "", vtk: "" },
                  ].map(pub => (
                    <div key={pub.title} className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs font-bold text-gray-700 mb-2">{pub.title}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div><label className="text-[9px] text-gray-400 block mb-0.5">公費負担者番号</label>
                          <input value={String(infoForm[pub.ik]||"")} onChange={e => setInfoForm({...infoForm, [pub.ik]: e.target.value})}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" /></div>
                        <div><label className="text-[9px] text-gray-400 block mb-0.5">受給者番号</label>
                          <input value={String(infoForm[pub.rk]||"")} onChange={e => setInfoForm({...infoForm, [pub.rk]: e.target.value})}
                            className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm" /></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {infoTab === "manage" && (
                <div className="space-y-4">
                  <div><label className="text-[10px] text-gray-400 block mb-1">🦠 感染症フラグ</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {["HBV","HCV","HIV","梅毒","MRSA","TB"].map(flag => {
                        const active = String(infoForm.infection_flags||"").includes(flag);
                        return (
                          <button key={flag} onClick={() => {
                            const cur = String(infoForm.infection_flags||"");
                            const flags = cur.split(",").map(f => f.trim()).filter(Boolean);
                            const newFlags = active ? flags.filter(f => f !== flag) : [...flags, flag];
                            setInfoForm({...infoForm, infection_flags: newFlags.join(", ") || null});
                          }} className={`text-[10px] px-2.5 py-1 rounded-full font-bold border transition-colors ${active ? "bg-red-100 border-red-300 text-red-700" : "bg-gray-50 border-gray-200 text-gray-400 hover:border-gray-300"}`}>
                            {active ? "✓ " : ""}{flag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div><label className="text-[10px] text-gray-400 block mb-1">📌 患者メモ・アラート（来院時にヘッダーに表示）</label>
                    <textarea value={String(infoForm.alert_memo||"")} onChange={e => setInfoForm({...infoForm, alert_memo: e.target.value})}
                      rows={2} placeholder="例: 車椅子、聴覚障害、要通訳"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                  <div><label className="text-[10px] text-gray-400 block mb-1">📝 サブカルテ（自由記載）</label>
                    <textarea value={String(infoForm.subchart_notes||"")} onChange={e => setInfoForm({...infoForm, subchart_notes: e.target.value})}
                      rows={6} placeholder={"治療方針メモ・特記事項・家族情報など\n\n例:\n・補綴希望: 自費セラミック希望\n・性格: 説明を詳しく聞きたいタイプ"}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 resize-none" /></div>
                  <div><label className="text-[10px] text-gray-400 block mb-1">👩‍⚕️ 担当DH</label>
                    <select value={String(infoForm.assigned_dh_id||"")} onChange={e => setInfoForm({...infoForm, assigned_dh_id: e.target.value || null})}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400">
                      <option value="">未割当</option>
                      <option value="DH1">DH1</option><option value="DH2">DH2</option><option value="DH3">DH3</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t flex justify-end gap-3">
              <button onClick={() => setShowInfoModal(false)} className="px-5 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-bold hover:bg-gray-50">キャンセル</button>
              <button onClick={saveInfo} disabled={saving}
                className="px-6 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50">
                {saving ? "保存中..." : "💾 保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 領収書モーダル */}
      {receiptHtml && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50" onClick={() => setReceiptHtml(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <span className="font-bold text-sm">📄 領収書プレビュー</span>
              <div className="flex gap-2">
                <button onClick={() => { const pw = window.open("","_blank"); if(pw){pw.document.write(receiptHtml);pw.document.close();} }}
                  className="bg-gray-900 text-white text-xs font-bold px-4 py-1.5 rounded-lg">🖨️ 印刷</button>
                <button onClick={() => setReceiptHtml(null)} className="bg-gray-100 text-gray-600 text-xs font-bold px-4 py-1.5 rounded-lg">閉じる</button>
              </div>
            </div>
            <iframe srcDoc={receiptHtml} className="flex-1 border-0 min-h-96" title="領収書" />
          </div>
        </div>
      )}
    </div>
  );
}

// ==============================
// サブコンポーネント
// ==============================
function StatusRow({ teeth, tc, sel, setSel, jaw, isDeciduous = false }: { teeth: string[]; tc: Record<string, ToothData>; sel: string | null; setSel: (t: string) => void; jaw: "upper" | "lower"; isDeciduous?: boolean }) {
  return (
    <div className="flex gap-[2px]">
      {teeth.map(t => {
        const d = tc[t]; const s = d?.status || "normal"; const c = TS[s] || TS.normal; const isSel = sel === t;
        const size = isDeciduous ? "w-8 h-10" : "w-10 h-12";
        const textColor = isDeciduous && s === "normal" ? "text-pink-300" : c.color;
        return (
          <button key={t} onClick={() => setSel(t === sel ? "" : t)}
            className={`${size} rounded-lg border-2 flex flex-col items-center justify-center text-[9px] font-bold transition-all hover:scale-105 ${c.cbg} ${c.border} ${textColor} ${isSel ? "ring-2 ring-sky-400 scale-110 shadow-md" : ""}`}>
            {jaw === "upper" ? (
              <><span className="text-[7px] text-gray-400 leading-none">{t}</span>
                <span className="leading-tight">{s !== "normal" ? c.sl || c.label : ""}</span>
                <span className="text-[7px] leading-none">{s !== "normal" ? c.label : ""}</span></>
            ) : (
              <><span className="text-[7px] leading-none">{s !== "normal" ? c.label : ""}</span>
                <span className="leading-tight">{s !== "normal" ? c.sl || c.label : ""}</span>
                <span className="text-[7px] text-gray-400 leading-none">{t}</span></>
            )}
          </button>
        );
      })}
    </div>
  );
}

function PerioChartView({ teeth, pc, tc, sel, setSel, jaw, label }: { teeth: string[]; pc: PerioChart; tc: Record<string, ToothData>; sel: string | null; setSel: (t: string) => void; jaw: "upper" | "lower"; label: string }) {
  function pcl(v: number) { if (v >= 6) return "bg-red-500 text-white font-bold"; if (v >= 4) return "bg-red-200 text-red-800 font-bold"; return "text-gray-500"; }
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse min-w-[700px]">
        <tbody>
          {jaw === "upper" && (
            <tr className="h-5">
              <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">TM</td>
              {teeth.map(t => { const pe = pc[t]; const m = pe?.mobility || 0; return (
                <td key={t} className="text-center text-[9px]">
                  <span className={m > 0 ? "text-amber-600 font-bold bg-amber-100 px-1 rounded" : "text-gray-300"}>{m > 0 ? m : ""}</span>
                </td>); })}
            </tr>
          )}
          <tr className="h-5">
            <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">EPP</td>
            {teeth.map(t => { const pe = pc[t]; const b = pe?.buccal || []; const isMissing = (tc[t]?.status || "normal") === "missing"; return (
              <td key={t} className="text-center px-0">
                {isMissing ? <span className="text-[8px] text-gray-300">—</span> : (
                  <div className="flex justify-center gap-[1px]">
                    {b.map((v,i) => <span key={i} className={`text-[8px] w-[13px] text-center rounded-sm ${pcl(v)}`}>{v}</span>)}
                  </div>
                )}
              </td>); })}
          </tr>
          <tr>
            <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">{label}</td>
            {teeth.map(t => {
              const d = tc[t]; const s = d?.status || "normal"; const c = TS[s] || TS.normal;
              const pe = pc[t]; const isSel = sel === t; const isMissing = s === "missing";
              const maxP = pe ? Math.max(...pe.buccal, ...pe.lingual) : 0;
              return (
                <td key={t} className="text-center px-[1px] py-[2px]">
                  <button onClick={() => setSel(t === sel ? "" : t)}
                    className={`w-full min-w-[38px] h-9 rounded border-2 flex flex-col items-center justify-center text-[9px] font-bold transition-all hover:scale-105
                    ${isMissing ? "bg-gray-200 border-gray-300 text-gray-400" : s !== "normal" ? `${c.cbg} ${c.border} ${c.color}` : pe?.bop ? "bg-red-50 border-red-200" : maxP >= 4 ? "bg-red-50 border-red-200" : "bg-white border-gray-200 text-gray-600"}
                    ${isSel ? "ring-2 ring-sky-400 scale-110" : ""}`}>
                    <span className="leading-none">{s !== "normal" ? c.sl : ""}</span>
                    <span className="text-[8px] text-gray-400">{t}</span>
                    {s !== "normal" && <span className="text-[7px] leading-none">{c.label}</span>}
                  </button>
                </td>
              );
            })}
          </tr>
          <tr className="h-4">
            <td></td>
            {teeth.map(t => <td key={t} className="text-center text-[8px] text-gray-300">{t}</td>)}
          </tr>
          <tr className="h-5">
            <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">EPP</td>
            {teeth.map(t => { const pe = pc[t]; const l = pe?.lingual || []; const isMissing = (tc[t]?.status || "normal") === "missing"; return (
              <td key={t} className="text-center px-0">
                {isMissing ? <span className="text-[8px] text-gray-300">—</span> : (
                  <div className="flex justify-center gap-[1px]">
                    {l.map((v,i) => <span key={i} className={`text-[8px] w-[13px] text-center rounded-sm ${pcl(v)}`}>{v}</span>)}
                  </div>
                )}
              </td>); })}
          </tr>
          {jaw === "lower" && (
            <tr className="h-5">
              <td className="text-[9px] text-gray-400 font-bold w-10 pr-1 text-right">TM</td>
              {teeth.map(t => { const pe = pc[t]; const m = pe?.mobility || 0; return (
                <td key={t} className="text-center text-[9px]">
                  <span className={m > 0 ? "text-amber-600 font-bold bg-amber-100 px-1 rounded" : "text-gray-300"}>{m > 0 ? m : ""}</span>
                </td>); })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function Leg({ c, t }: { c: string; t: string }) {
  return <span className="flex items-center gap-1"><span className={`w-2.5 h-2.5 rounded border ${c}`}></span>{t}</span>;
}
function SB({ l, v, c, b }: { l: string; v: string; c: string; b: string }) {
  return <span className={`${b} ${c} px-2 py-1 rounded-lg font-bold text-[11px]`}>■ {l} <span className="text-sm">{v}</span></span>;
}
function IR({ l, v }: { l: string; v: string | null | undefined }) {
  return (
    <div>
      <label className="text-[10px] text-gray-400 block mb-0.5">{l}</label>
      <p className="text-sm text-gray-700 font-medium">{v || "-"}</p>
    </div>
  );
}
