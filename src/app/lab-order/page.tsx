"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// ===== 型定義 =====
type ProsthCategory = "crown_bridge" | "denture" | "implant" | "appliance" | "";

type LabOrder = {
  id: string;
  patient_id: string;
  record_id: string | null;
  appointment_id: string | null;
  order_number: string;
  lab_name: string;
  order_date: string;
  due_date: string;
  status: "ordered" | "in_progress" | "delivered" | "set_complete" | "cancelled";
  prosth_category: ProsthCategory;
  prosth_type: string;
  material: string;
  shade: string;
  shade_detail: string;
  stain: boolean;
  tooth_numbers: string[];
  jaw: string;
  bridge_span: string[];
  cement_type: string;
  custom_abutment: boolean;
  pontic_form: string;
  clasp_type: string;
  denture_base: string;
  design_memo: string;
  instructions: string;
  notes: string;
  trigger_procedure: string;
  created_at: string;
  patients?: { name_kanji: string; name_kana: string } | null;
};

// ===== 定数 =====
const PROSTH_TYPES_BY_CATEGORY: Record<string, { value: string; label: string }[]> = {
  crown_bridge: [
    { value: "fmc", label: "FMC（全部鋳造冠）" },
    { value: "hjc", label: "HJC（硬質レジン前装冠）" },
    { value: "cad_crown", label: "CAD/CAM冠" },
    { value: "peek_crown", label: "PEEK冠" },
    { value: "endcrown", label: "エンドクラウン" },
    { value: "emax", label: "e.max（オールセラミック）" },
    { value: "zirconia", label: "ジルコニア" },
    { value: "metal_bond", label: "メタルボンド" },
    { value: "inlay_mc", label: "MCインレー" },
    { value: "inlay_resin", label: "レジンインレー" },
    { value: "inlay_cad", label: "CAD/CAMインレー" },
    { value: "laminate", label: "ラミネートベニア" },
    { value: "bridge", label: "ブリッジ（Br）" },
    { value: "3_4_crown", label: "3/4冠" },
    { value: "4_5_crown", label: "4/5冠" },
    { value: "post_core", label: "支台築造（ポスト＆コア）" },
    { value: "tek", label: "TEK（仮歯）" },
  ],
  denture: [
    { value: "partial_denture", label: "部分床義歯（保険）" },
    { value: "full_denture", label: "総義歯（保険）" },
    { value: "nonclasp", label: "ノンクラスプデンチャー" },
    { value: "valplast", label: "バルプラスト" },
    { value: "metal_denture", label: "金属床義歯" },
    { value: "night_guard", label: "ナイトガード（NG）" },
    { value: "oa", label: "スリープスプリント（OA）" },
    { value: "band_loop", label: "バンドループ" },
    { value: "denture_repair", label: "義歯修理" },
    { value: "denture_reline", label: "義歯リライン（リベース）" },
  ],
  implant: [
    { value: "implant_crown", label: "インプラント上部構造（単冠）" },
    { value: "implant_bridge", label: "インプラントブリッジ" },
    { value: "implant_bar", label: "インプラントバー" },
    { value: "custom_abutment", label: "カスタムアバットメント" },
    { value: "all_on_4", label: "オールオン4" },
  ],
  appliance: [
    { value: "sports_guard", label: "スポーツマウスガード" },
    { value: "whitening_tray", label: "ホワイトニングトレー" },
    { value: "retainer", label: "リテーナー" },
    { value: "wax_up", label: "ワックスアップ" },
    { value: "study_model", label: "スタディモデル" },
  ],
};

const MATERIALS_BY_CATEGORY: Record<string, string[]> = {
  crown_bridge: [
    "12%金銀パラジウム合金", "銀合金", "CAD/CAMレジン", "e.max", "ジルコニア",
    "金合金（金パラ）", "硬質レジン", "ポーセレン", "PEEK", "ファイバーポスト", "その他",
  ],
  denture: [
    "レジン床（保険）", "熱可塑性樹脂床（バルプラスト）", "コバルトクロム合金床",
    "チタン床", "金属（Pd/Co）", "アクリルレジン", "その他",
  ],
  implant: [
    "ジルコニア", "e.max", "チタン", "金合金", "CAD/CAMレジン", "ポーセレン", "その他",
  ],
  appliance: ["EVA", "アクリルレジン", "シリコン", "その他"],
};

const SHADE_OPTIONS = [
  "A1", "A2", "A3", "A3.5", "A4",
  "B1", "B2", "B3", "B4",
  "C1", "C2", "C3", "C4",
  "D2", "D3", "D4",
  "患者と相談", "技工所にお任せ",
];

const PONTIC_FORMS = ["リジッドポンティック", "サドル型", "コニカル型", "卵形", "衛生的形態", "その他"];
const CLASP_TYPES = ["Eクラスプ", "リングクラスプ", "双歯鈎", "コンビネーション", "Iバー", "鋳造鈎（Pd）", "鋳造鈎（Co）", "ワイヤークラスプ", "その他"];
const DENTURE_BASES = ["レジン床（保険）", "熱可塑性樹脂床", "コバルトクロム合金床", "チタン床", "アクリルレジン（自費）"];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  ordered:      { label: "発注済",    color: "text-blue-700",   bg: "bg-blue-50 border-blue-200",   icon: "📤" },
  in_progress:  { label: "製作中",    color: "text-orange-700", bg: "bg-orange-50 border-orange-200", icon: "🔧" },
  delivered:    { label: "納品済",    color: "text-green-700",  bg: "bg-green-50 border-green-200",  icon: "📦" },
  set_complete: { label: "セット完了", color: "text-purple-700", bg: "bg-purple-50 border-purple-200", icon: "✅" },
  cancelled:    { label: "キャンセル", color: "text-gray-500",   bg: "bg-gray-50 border-gray-200",   icon: "❌" },
};

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  crown_bridge: { label: "クラウン・ブリッジ", icon: "👑", color: "text-sky-700 bg-sky-50 border-sky-200" },
  denture:      { label: "義歯・装置",         icon: "🦷", color: "text-orange-700 bg-orange-50 border-orange-200" },
  implant:      { label: "インプラント",        icon: "🔩", color: "text-purple-700 bg-purple-50 border-purple-200" },
  appliance:    { label: "その他装置",          icon: "🛡️", color: "text-green-700 bg-green-50 border-green-200" },
};

const ALL_UPPER = ["18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28"];
const ALL_LOWER = ["48","47","46","45","44","43","42","41","31","32","33","34","35","36","37","38"];

// ===== 印刷HTML生成 =====
function generatePrintHtml(order: LabOrder): string {
  const patientName = order.patients?.name_kanji || "不明";
  const prosthLabel = PROSTH_TYPES_BY_CATEGORY[order.prosth_category || "crown_bridge"]?.find(p => p.value === order.prosth_type)?.label || order.prosth_type;
  const teeth = order.tooth_numbers.map(t => "#" + t).join(", ");
  const categoryLabel = CATEGORY_CONFIG[order.prosth_category || "crown_bridge"]?.label || "";

  const toothChartRows = (() => {
    const upper = ALL_UPPER.map(t => {
      const selected = order.tooth_numbers.includes(t);
      return `<td style="width:22px;height:22px;text-align:center;font-size:9px;border:1px solid #ccc;background:${selected ? "#3b82f6" : "#fff"};color:${selected ? "#fff" : "#666"};font-weight:${selected ? "bold" : "normal"}">${t}</td>`;
    }).join("");
    const lower = ALL_LOWER.map(t => {
      const selected = order.tooth_numbers.includes(t);
      return `<td style="width:22px;height:22px;text-align:center;font-size:9px;border:1px solid #ccc;background:${selected ? "#3b82f6" : "#fff"};color:${selected ? "#fff" : "#666"};font-weight:${selected ? "bold" : "normal"}">${t}</td>`;
    }).join("");
    return `<table style="border-collapse:collapse;margin:4px 0"><tr>${upper}</tr><tr style="border-top:2px solid #666">${lower}</tr></table>`;
  })();

  const extraFields = (() => {
    const rows: string[] = [];
    if (order.jaw) rows.push(`<tr><th>上下顎</th><td>${order.jaw === "upper" ? "上顎" : order.jaw === "lower" ? "下顎" : "両顎"}</td></tr>`);
    if (order.bridge_span && order.bridge_span.length > 0) rows.push(`<tr><th>Brスパン</th><td>${order.bridge_span.join(" → ")}</td></tr>`);
    if (order.cement_type) rows.push(`<tr><th>固定方法</th><td>${order.cement_type === "cement" ? "セメント固定" : "スクリュー固定"}</td></tr>`);
    if (order.custom_abutment) rows.push(`<tr><th>カスタムAb</th><td>あり</td></tr>`);
    if (order.pontic_form) rows.push(`<tr><th>ポンティック形態</th><td>${order.pontic_form}</td></tr>`);
    if (order.clasp_type) rows.push(`<tr><th>クラスプ種類</th><td>${order.clasp_type}</td></tr>`);
    if (order.denture_base) rows.push(`<tr><th>床材料</th><td>${order.denture_base}</td></tr>`);
    if (order.stain) rows.push(`<tr><th>ステイン</th><td>要</td></tr>`);
    if (order.shade_detail) rows.push(`<tr><th>シェード詳細</th><td>${order.shade_detail}</td></tr>`);
    return rows.join("");
  })();

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>技工指示書 - ${patientName}</title>
<style>
@media print { .no-print { display:none!important; } @page { size:A4; margin:10mm; } }
body { font-family:"Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif; max-width:720px; margin:0 auto; padding:16px; font-size:11px; color:#333; }
h1 { text-align:center; font-size:18px; border:2px solid #333; padding:8px; margin-bottom:12px; letter-spacing:4px; }
table { width:100%; border-collapse:collapse; margin-bottom:10px; }
td,th { border:1px solid #999; padding:5px 8px; text-align:left; font-size:11px; }
th { background:#f0f0f0; width:110px; font-weight:bold; }
.big { font-size:15px; font-weight:bold; }
.section { font-weight:bold; background:#e8e8e8; font-size:12px; }
.instructions { min-height:60px; white-space:pre-wrap; }
.footer { margin-top:16px; display:flex; justify-content:space-between; align-items:flex-end; }
.stamp-box { width:80px; height:80px; border:1px solid #aaa; text-align:center; line-height:80px; font-size:9px; color:#aaa; }
.badge { display:inline-block; background:#3b82f6; color:#fff; font-size:9px; padding:2px 8px; border-radius:10px; margin-bottom:8px; }
</style></head><body>
<div class="no-print" style="text-align:center;margin-bottom:12px">
  <button onclick="window.print()" style="padding:10px 28px;font-size:14px;background:#1e293b;color:#fff;border:none;border-radius:6px;cursor:pointer;margin-right:8px">🖨️ 印刷する</button>
  <button onclick="window.close()" style="padding:10px 16px;font-size:12px;background:#e2e8f0;border:none;border-radius:6px;cursor:pointer">閉じる</button>
</div>
<div class="badge">${categoryLabel}</div>
<h1>歯 科 技 工 指 示 書</h1>
<table>
  <tr><th>指示書番号</th><td>${order.order_number}</td><th>発行日</th><td>${order.order_date}</td></tr>
  <tr><th>技工所名</th><td colspan="3">${order.lab_name || "（未指定）"}</td></tr>
  <tr><th>患者名</th><td class="big">${patientName} 様</td><th>納品予定日</th><td class="big" style="color:#c00">${order.due_date || "未定"}</td></tr>
</table>
<table>
  <tr class="section"><td colspan="4">■ 補綴内容</td></tr>
  <tr><th>種類</th><td class="big" colspan="3">${prosthLabel}</td></tr>
  <tr><th>対象歯</th><td colspan="3" class="big">${teeth}</td></tr>
</table>
<div style="margin-bottom:10px">${toothChartRows}</div>
<table>
  <tr><th>使用材料</th><td>${order.material || "指定なし"}</td><th>シェード</th><td>${order.shade || "指定なし"}</td></tr>
  ${extraFields}
</table>
${order.trigger_procedure ? `<table><tr><th>トリガー算定</th><td>${order.trigger_procedure}</td></tr></table>` : ""}
<table>
  <tr class="section"><td colspan="2">■ 指示事項</td></tr>
  <tr><td colspan="2" class="instructions">${order.instructions || "特記事項なし"}</td></tr>
</table>
${order.design_memo ? `<table><tr class="section"><td>■ 設計メモ</td></tr><tr><td class="instructions">${order.design_memo}</td></tr></table>` : ""}
${order.notes ? `<table><tr class="section"><td>■ 備考</td></tr><tr><td class="instructions">${order.notes}</td></tr></table>` : ""}
<div class="footer">
  <div>
    <p style="margin-bottom:4px">歯科医師署名: ___________________________</p>
    <p>発行日: ${order.order_date}</p>
  </div>
  <div class="stamp-box">医院印</div>
</div>
</body></html>`;
}

// ===== メインコンテンツ =====
function LabOrderContent() {
  const searchParams = useSearchParams();
  const prefillPatientId = searchParams.get("patient_id");
  const prefillRecordId = searchParams.get("record_id");
  const prefillAppointmentId = searchParams.get("appointment_id");
  const prefillTrigger = searchParams.get("trigger");

  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"list" | "new">("list");
  const [filter, setFilter] = useState<string>("active");
  const [selected, setSelected] = useState<LabOrder | null>(null);
  const [saving, setSaving] = useState(false);

  // フォーム
  const [category, setCategory] = useState<ProsthCategory>("");
  const [form, setForm] = useState({
    patient_id: prefillPatientId || "",
    record_id: prefillRecordId || "",
    appointment_id: prefillAppointmentId || "",
    trigger_procedure: prefillTrigger || "",
    lab_name: "",
    due_date: "",
    prosth_type: "",
    material: "",
    shade: "",
    shade_detail: "",
    stain: false,
    tooth_numbers: [] as string[],
    jaw: "",
    bridge_span: [] as string[],
    cement_type: "",
    custom_abutment: false,
    pontic_form: "",
    clasp_type: "",
    denture_base: "",
    design_memo: "",
    instructions: "",
    notes: "",
  });
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<{ id: string; name_kanji: string; name_kana: string }[]>([]);
  const [selectedPatientName, setSelectedPatientName] = useState("");

  useEffect(() => { loadOrders(); }, []);

  useEffect(() => {
    if (prefillPatientId) {
      supabase.from("patients").select("id, name_kanji, name_kana").eq("id", prefillPatientId).single()
        .then(({ data }) => { if (data) setSelectedPatientName(data.name_kanji); });
      setTab("new");
    }
    if (prefillTrigger) {
      // トリガーから症例タイプを自動判定
      const t = prefillTrigger;
      if (t.includes("義歯") || t.includes("欠損")) setCategory("denture");
      else if (t.includes("インプラント")) setCategory("implant");
      else setCategory("crown_bridge");
    }
  }, [prefillPatientId, prefillTrigger]);

  async function loadOrders() {
    setLoading(true);
    const { data } = await supabase
      .from("lab_orders")
      .select("*, patients(name_kanji, name_kana)")
      .order("created_at", { ascending: false });
    if (data) setOrders(data as unknown as LabOrder[]);
    setLoading(false);
  }

  async function searchPatients(q: string) {
    setPatientSearch(q);
    if (q.length < 1) { setPatientResults([]); return; }
    const { data } = await supabase.from("patients")
      .select("id, name_kanji, name_kana")
      .or("name_kanji.ilike.%" + q + "%,name_kana.ilike.%" + q + "%")
      .limit(8);
    if (data) setPatientResults(data);
  }

  function toggleTooth(t: string) {
    const cur = form.tooth_numbers;
    setForm({ ...form, tooth_numbers: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] });
  }

  async function submitOrder() {
    if (!form.patient_id || !form.prosth_type || form.tooth_numbers.length === 0) {
      alert("患者・補綴種類・歯番号は必須です");
      return;
    }
    setSaving(true);
    const orderNumber = "LO-" + Date.now().toString(36).toUpperCase();
    const orderDate = new Date().toISOString().split("T")[0];

    const { error } = await supabase.from("lab_orders").insert({
      patient_id: form.patient_id,
      record_id: form.record_id || null,
      appointment_id: form.appointment_id || null,
      order_number: orderNumber,
      lab_name: form.lab_name,
      order_date: orderDate,
      due_date: form.due_date || null,
      status: "ordered",
      prosth_category: category,
      prosth_type: form.prosth_type,
      material: form.material,
      shade: form.shade,
      shade_detail: form.shade_detail,
      stain: form.stain,
      tooth_numbers: form.tooth_numbers,
      jaw: form.jaw,
      bridge_span: form.bridge_span,
      cement_type: form.cement_type,
      custom_abutment: form.custom_abutment,
      pontic_form: form.pontic_form,
      clasp_type: form.clasp_type,
      denture_base: form.denture_base,
      design_memo: form.design_memo,
      instructions: form.instructions,
      notes: form.notes,
      trigger_procedure: form.trigger_procedure,
    });

    if (error) {
      alert("保存エラー: " + error.message);
    } else {
      // フォームリセット
      setForm({ patient_id: "", record_id: "", appointment_id: "", trigger_procedure: "", lab_name: "", due_date: "", prosth_type: "", material: "", shade: "", shade_detail: "", stain: false, tooth_numbers: [], jaw: "", bridge_span: [], cement_type: "", custom_abutment: false, pontic_form: "", clasp_type: "", denture_base: "", design_memo: "", instructions: "", notes: "" });
      setSelectedPatientName("");
      setCategory("");
      setTab("list");
      await loadOrders();
    }
    setSaving(false);
  }

  async function updateStatus(order: LabOrder, newStatus: string) {
    await supabase.from("lab_orders").update({ status: newStatus }).eq("id", order.id);
    await loadOrders();
    if (selected?.id === order.id) setSelected({ ...order, status: newStatus as LabOrder["status"] });
  }

  function printOrder(order: LabOrder) {
    const pw = window.open("", "_blank");
    if (pw) { pw.document.write(generatePrintHtml(order)); pw.document.close(); }
  }

  const filteredOrders = orders.filter(o => {
    if (filter === "active") return !["set_complete", "cancelled"].includes(o.status);
    if (filter === "delivered") return o.status === "delivered";
    if (filter === "completed") return o.status === "set_complete";
    return true;
  });

  const prosthTypes = category ? (PROSTH_TYPES_BY_CATEGORY[category] || []) : [];
  const materials = category ? (MATERIALS_BY_CATEGORY[category] || []) : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm font-bold">← ホーム</Link>
            <h1 className="text-lg font-bold text-gray-900">🏭 技工指示書</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setTab("list")} className={"px-4 py-2 rounded-lg text-xs font-bold " + (tab === "list" ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-500")}>📋 一覧</button>
            <button onClick={() => setTab("new")} className={"px-4 py-2 rounded-lg text-xs font-bold " + (tab === "new" ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-500")}>➕ 新規作成</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">

        {/* ===== 一覧タブ ===== */}
        {tab === "list" && (
          <>
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              {[
                { key: "active", label: "進行中" },
                { key: "delivered", label: "納品済" },
                { key: "completed", label: "セット完了" },
                { key: "all", label: "全て" },
              ].map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={"px-4 py-2 rounded-lg text-xs font-bold " + (filter === f.key ? "bg-sky-500 text-white" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50")}>
                  {f.label}
                </button>
              ))}
              <span className="text-xs text-gray-400 ml-2">{filteredOrders.length}件</span>
            </div>

            {loading ? (
              <div className="text-center py-20"><p className="text-gray-400">読み込み中...</p></div>
            ) : filteredOrders.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
                <p className="text-4xl mb-3">🏭</p>
                <p className="text-gray-400">技工指示書はありません</p>
                <button onClick={() => setTab("new")} className="mt-4 bg-sky-500 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-sky-600">➕ 新規作成</button>
              </div>
            ) : (
              <div className="flex gap-4">
                {/* リスト */}
                <div className="flex-1 space-y-2">
                  {filteredOrders.map(o => {
                    const cfg = STATUS_CONFIG[o.status] || STATUS_CONFIG.ordered;
                    const catCfg = CATEGORY_CONFIG[o.prosth_category || "crown_bridge"];
                    const prosthLabel = PROSTH_TYPES_BY_CATEGORY[o.prosth_category || "crown_bridge"]?.find(p => p.value === o.prosth_type)?.label || o.prosth_type;
                    return (
                      <button key={o.id} onClick={() => setSelected(o)}
                        className={"w-full bg-white rounded-xl border-2 p-4 text-left transition-all hover:shadow-md " + (selected?.id === o.id ? "border-sky-400 shadow-md" : "border-gray-200")}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-lg font-bold text-gray-700">
                              {(o.patients?.name_kanji || "?").charAt(0)}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-bold text-gray-900">{o.patients?.name_kanji || "不明"}</p>
                                <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full border " + cfg.bg + " " + cfg.color}>{cfg.icon} {cfg.label}</span>
                                {catCfg && <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full border " + catCfg.color}>{catCfg.icon} {catCfg.label}</span>}
                              </div>
                              <p className="text-xs text-gray-400 mt-0.5">{prosthLabel} · {o.tooth_numbers.map(t => "#" + t).join(", ")}</p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs text-gray-400">{o.order_number}</p>
                            {o.due_date && <p className="text-sm font-bold text-gray-700">納品: {o.due_date}</p>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* 詳細パネル */}
                {selected && (
                  <div className="w-[400px] flex-shrink-0">
                    <div className="bg-white rounded-xl border border-gray-200 shadow-lg sticky top-4 overflow-hidden">
                      <div className="bg-gray-900 text-white p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs text-gray-400">{selected.order_number}</p>
                            <p className="text-lg font-bold">{selected.patients?.name_kanji || "不明"} 様</p>
                            {selected.prosth_category && (
                              <span className={"text-[10px] font-bold px-2 py-0.5 rounded-full border mt-1 inline-block " + (CATEGORY_CONFIG[selected.prosth_category]?.color || "")}>
                                {CATEGORY_CONFIG[selected.prosth_category]?.icon} {CATEGORY_CONFIG[selected.prosth_category]?.label}
                              </span>
                            )}
                          </div>
                          <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white text-lg">✕</button>
                        </div>
                      </div>
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-gray-400">種類</span><p className="font-bold text-gray-800">{PROSTH_TYPES_BY_CATEGORY[selected.prosth_category || "crown_bridge"]?.find(p => p.value === selected.prosth_type)?.label || selected.prosth_type}</p></div>
                          <div><span className="text-gray-400">歯番号</span><p className="font-bold text-gray-800">{selected.tooth_numbers.map(t => "#" + t).join(", ")}</p></div>
                          <div><span className="text-gray-400">材料</span><p className="font-bold text-gray-800">{selected.material || "未指定"}</p></div>
                          <div><span className="text-gray-400">シェード</span><p className="font-bold text-gray-800">{selected.shade || "未指定"}</p></div>
                          <div><span className="text-gray-400">技工所</span><p className="font-bold text-gray-800">{selected.lab_name || "未指定"}</p></div>
                          <div><span className="text-gray-400">納品予定日</span><p className="font-bold text-gray-800">{selected.due_date || "未定"}</p></div>
                          {selected.jaw && <div><span className="text-gray-400">上下顎</span><p className="font-bold text-gray-800">{selected.jaw === "upper" ? "上顎" : selected.jaw === "lower" ? "下顎" : "両顎"}</p></div>}
                          {selected.cement_type && <div><span className="text-gray-400">固定方法</span><p className="font-bold text-gray-800">{selected.cement_type === "cement" ? "セメント固定" : "スクリュー固定"}</p></div>}
                          {selected.clasp_type && <div><span className="text-gray-400">クラスプ</span><p className="font-bold text-gray-800">{selected.clasp_type}</p></div>}
                          {selected.denture_base && <div><span className="text-gray-400">床材料</span><p className="font-bold text-gray-800">{selected.denture_base}</p></div>}
                        </div>

                        {/* 歯式図（簡易） */}
                        <div>
                          <p className="text-[10px] text-gray-400 font-bold mb-1">歯式</p>
                          <div className="flex gap-px flex-wrap">
                            {[...ALL_UPPER, ...ALL_LOWER].map((t, i) => (
                              <div key={t} className={"w-5 h-5 rounded text-[8px] flex items-center justify-center font-bold " + (selected.tooth_numbers.includes(t) ? "bg-sky-500 text-white" : i >= 16 ? "bg-gray-100 text-gray-400 border-t-2 border-gray-300" : "bg-gray-100 text-gray-400")}>
                                {t.slice(-1)}
                              </div>
                            ))}
                          </div>
                        </div>

                        {selected.instructions && (
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-[10px] text-gray-400 font-bold mb-1">指示事項</p>
                            <p className="text-xs text-gray-700 whitespace-pre-wrap">{selected.instructions}</p>
                          </div>
                        )}
                        {selected.trigger_procedure && (
                          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                            <p className="text-[10px] text-amber-600 font-bold">トリガー算定: {selected.trigger_procedure}</p>
                          </div>
                        )}

                        {/* ステータス変更 */}
                        <div className="flex flex-wrap gap-1.5">
                          {(["ordered", "in_progress", "delivered", "set_complete"] as const).map(s => {
                            const cfg = STATUS_CONFIG[s];
                            return (
                              <button key={s} onClick={() => updateStatus(selected, s)}
                                className={"px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all " + (selected.status === s ? cfg.bg + " " + cfg.color + " ring-2 ring-sky-400" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50")}>
                                {cfg.icon} {cfg.label}
                              </button>
                            );
                          })}
                        </div>

                        <button onClick={() => printOrder(selected)} className="w-full bg-gray-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-gray-700">
                          🖨️ 技工指示書を印刷
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ===== 新規作成タブ ===== */}
        {tab === "new" && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-6">
              <h2 className="text-lg font-bold text-gray-900">➕ 技工指示書 新規作成</h2>

              {/* トリガー算定表示 */}
              {form.trigger_procedure && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
                  <span className="text-amber-600 text-lg">⚡</span>
                  <div>
                    <p className="text-xs font-bold text-amber-700">算定トリガー</p>
                    <p className="text-sm text-amber-800">{form.trigger_procedure}</p>
                  </div>
                </div>
              )}

              {/* 患者選択 */}
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-1.5">患者 <span className="text-red-500">*</span></label>
                {selectedPatientName ? (
                  <div className="flex items-center gap-2">
                    <span className="bg-sky-50 text-sky-700 font-bold px-4 py-2 rounded-lg border border-sky-200">{selectedPatientName}</span>
                    <button onClick={() => { setForm({ ...form, patient_id: "" }); setSelectedPatientName(""); }} className="text-xs text-gray-400 hover:text-red-500">✕</button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={patientSearch} onChange={e => searchPatients(e.target.value)} placeholder="患者名で検索..."
                      className="w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                    {patientResults.length > 0 && (
                      <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                        {patientResults.map(p => (
                          <button key={p.id} onClick={() => { setForm({ ...form, patient_id: p.id }); setSelectedPatientName(p.name_kanji); setPatientSearch(""); setPatientResults([]); }}
                            className="w-full text-left px-4 py-2 hover:bg-sky-50 text-sm">
                            <span className="font-bold">{p.name_kanji}</span> <span className="text-gray-400">({p.name_kana})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 症例カテゴリ */}
              <div>
                <label className="text-sm font-bold text-gray-700 block mb-1.5">症例タイプ <span className="text-red-500">*</span></label>
                <div className="grid grid-cols-2 gap-3">
                  {(Object.entries(CATEGORY_CONFIG) as [ProsthCategory, typeof CATEGORY_CONFIG[string]][]).map(([key, cfg]) => (
                    <button key={key} onClick={() => { setCategory(key); setForm({ ...form, prosth_type: "", material: "" }); }}
                      className={"flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all " + (category === key ? "border-sky-400 bg-sky-50" : "border-gray-200 hover:border-sky-300")}>
                      <span className="text-2xl">{cfg.icon}</span>
                      <span className={"text-sm font-bold " + (category === key ? "text-sky-700" : "text-gray-700")}>{cfg.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {category && (
                <>
                  {/* 補綴種類 */}
                  <div>
                    <label className="text-sm font-bold text-gray-700 block mb-1.5">補綴種類 <span className="text-red-500">*</span></label>
                    <div className="flex flex-wrap gap-2">
                      {prosthTypes.map(p => (
                        <button key={p.value} onClick={() => setForm({ ...form, prosth_type: p.value })}
                          className={"px-3 py-2 rounded-lg text-xs font-bold border transition-all " + (form.prosth_type === p.value ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-600 hover:border-sky-300")}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 歯番号 */}
                  <div>
                    <label className="text-sm font-bold text-gray-700 block mb-2">歯番号 <span className="text-red-500">*</span> <span className="text-xs font-normal text-gray-400">（タップで選択）</span></label>
                    <div className="flex justify-center">
                      <div className="flex flex-col items-center gap-1">
                        <div className="flex gap-1">
                          {ALL_UPPER.slice(0, 8).map(t => (
                            <button key={t} onClick={() => toggleTooth(t)}
                              className={"w-9 h-9 rounded-lg text-[10px] font-bold border-2 transition-all " + (form.tooth_numbers.includes(t) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-500 hover:border-sky-300")}>
                              {t}
                            </button>
                          ))}
                          <div className="w-px h-9 bg-gray-300 mx-1" />
                          {ALL_UPPER.slice(8).map(t => (
                            <button key={t} onClick={() => toggleTooth(t)}
                              className={"w-9 h-9 rounded-lg text-[10px] font-bold border-2 transition-all " + (form.tooth_numbers.includes(t) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-500 hover:border-sky-300")}>
                              {t}
                            </button>
                          ))}
                        </div>
                        <div className="w-full border-t-2 border-gray-400 my-0.5" />
                        <div className="flex gap-1">
                          {ALL_LOWER.slice(0, 8).map(t => (
                            <button key={t} onClick={() => toggleTooth(t)}
                              className={"w-9 h-9 rounded-lg text-[10px] font-bold border-2 transition-all " + (form.tooth_numbers.includes(t) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-500 hover:border-sky-300")}>
                              {t}
                            </button>
                          ))}
                          <div className="w-px h-9 bg-gray-300 mx-1" />
                          {ALL_LOWER.slice(8).map(t => (
                            <button key={t} onClick={() => toggleTooth(t)}
                              className={"w-9 h-9 rounded-lg text-[10px] font-bold border-2 transition-all " + (form.tooth_numbers.includes(t) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-500 hover:border-sky-300")}>
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {form.tooth_numbers.length > 0 && (
                      <p className="text-xs text-sky-600 font-bold text-center mt-2">選択中: {form.tooth_numbers.map(t => "#" + t).join(", ")}</p>
                    )}
                  </div>

                  {/* 上下顎 */}
                  <div>
                    <label className="text-sm font-bold text-gray-700 block mb-1.5">上下顎</label>
                    <div className="flex gap-3">
                      {[{ value: "upper", label: "上顎" }, { value: "lower", label: "下顎" }, { value: "both", label: "両顎" }].map(j => (
                        <button key={j.value} onClick={() => setForm({ ...form, jaw: form.jaw === j.value ? "" : j.value })}
                          className={"px-4 py-2 rounded-lg border-2 text-sm font-bold transition-all " + (form.jaw === j.value ? "bg-sky-500 text-white border-sky-500" : "border-gray-200 text-gray-500 hover:border-sky-300")}>
                          {j.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 材料・シェード */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-bold text-gray-700 block mb-1.5">使用材料</label>
                      <select value={form.material} onChange={e => setForm({ ...form, material: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                        <option value="">選択...</option>
                        {materials.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-sm font-bold text-gray-700 block mb-1.5">シェード</label>
                      <select value={form.shade} onChange={e => setForm({ ...form, shade: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                        <option value="">選択...</option>
                        {SHADE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* シェード詳細・ステイン */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-bold text-gray-700 block mb-1.5">シェード詳細</label>
                      <input value={form.shade_detail} onChange={e => setForm({ ...form, shade_detail: e.target.value })}
                        placeholder="例: 頸部A4・体部A3..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                    </div>
                    <div className="flex items-end pb-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.stain} onChange={e => setForm({ ...form, stain: e.target.checked })} className="w-4 h-4 rounded" />
                        <span className="text-sm font-bold text-gray-700">ステイン要</span>
                      </label>
                    </div>
                  </div>

                  {/* クラウン・ブリッジ固有 */}
                  {category === "crown_bridge" && (
                    <div>
                      <label className="text-sm font-bold text-gray-700 block mb-1.5">ポンティック形態</label>
                      <div className="flex flex-wrap gap-2">
                        {PONTIC_FORMS.map(p => (
                          <button key={p} onClick={() => setForm({ ...form, pontic_form: form.pontic_form === p ? "" : p })}
                            className={"px-3 py-1.5 rounded-lg text-xs font-bold border transition-all " + (form.pontic_form === p ? "bg-sky-500 text-white border-sky-500" : "border-gray-200 text-gray-600 hover:border-sky-300")}>
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* インプラント固有 */}
                  {category === "implant" && (
                    <div className="space-y-3">
                      <div>
                        <label className="text-sm font-bold text-gray-700 block mb-1.5">固定方法</label>
                        <div className="flex gap-3">
                          {[{ value: "cement", label: "セメント固定" }, { value: "screw", label: "スクリュー固定" }].map(c => (
                            <button key={c.value} onClick={() => setForm({ ...form, cement_type: form.cement_type === c.value ? "" : c.value })}
                              className={"px-4 py-2 rounded-lg border-2 text-sm font-bold transition-all " + (form.cement_type === c.value ? "bg-sky-500 text-white border-sky-500" : "border-gray-200 text-gray-500 hover:border-sky-300")}>
                              {c.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={form.custom_abutment} onChange={e => setForm({ ...form, custom_abutment: e.target.checked })} className="w-4 h-4 rounded" />
                        <span className="text-sm font-bold text-gray-700">カスタムアバットメントあり</span>
                      </label>
                    </div>
                  )}

                  {/* 義歯固有 */}
                  {category === "denture" && (
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-bold text-gray-700 block mb-1.5">床材料</label>
                        <div className="flex flex-wrap gap-2">
                          {DENTURE_BASES.map(b => (
                            <button key={b} onClick={() => setForm({ ...form, denture_base: form.denture_base === b ? "" : b })}
                              className={"px-3 py-1.5 rounded-lg text-xs font-bold border transition-all " + (form.denture_base === b ? "bg-sky-500 text-white border-sky-500" : "border-gray-200 text-gray-600 hover:border-sky-300")}>
                              {b}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-bold text-gray-700 block mb-1.5">クラスプ種類</label>
                        <div className="flex flex-wrap gap-2">
                          {CLASP_TYPES.map(c => (
                            <button key={c} onClick={() => setForm({ ...form, clasp_type: form.clasp_type === c ? "" : c })}
                              className={"px-3 py-1.5 rounded-lg text-xs font-bold border transition-all " + (form.clasp_type === c ? "bg-sky-500 text-white border-sky-500" : "border-gray-200 text-gray-600 hover:border-sky-300")}>
                              {c}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="text-sm font-bold text-gray-700 block mb-1.5">設計メモ</label>
                        <textarea value={form.design_memo} onChange={e => setForm({ ...form, design_memo: e.target.value })} rows={3}
                          placeholder="クラスプ位置・レスト位置・バー種類など設計上の指示..."
                          className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 resize-none" />
                      </div>
                    </div>
                  )}

                  {/* 技工所・納品日 */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-bold text-gray-700 block mb-1.5">技工所名</label>
                      <input value={form.lab_name} onChange={e => setForm({ ...form, lab_name: e.target.value })}
                        placeholder="例: ○○デンタルラボ"
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                    </div>
                    <div>
                      <label className="text-sm font-bold text-gray-700 block mb-1.5">納品予定日</label>
                      <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                    </div>
                  </div>

                  {/* 指示事項・備考 */}
                  <div>
                    <label className="text-sm font-bold text-gray-700 block mb-1.5">指示事項</label>
                    <textarea value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} rows={4}
                      placeholder="技工所への特記事項・形態の要望・咬合様式など..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 resize-none" />
                  </div>
                  <div>
                    <label className="text-sm font-bold text-gray-700 block mb-1.5">備考（院内メモ）</label>
                    <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
                      placeholder="院内共有メモ（技工指示書には印刷されません）..."
                      className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 resize-none" />
                  </div>

                  <button onClick={submitOrder} disabled={saving}
                    className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 disabled:opacity-50 shadow-lg shadow-sky-200">
                    {saving ? "保存中..." : "📄 技工指示書を作成"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function LabOrderPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>}>
      <LabOrderContent />
    </Suspense>
  );
}
