"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type LabOrder = {
  id: string;
  patient_id: string;
  record_id: string | null;
  order_number: string;
  lab_name: string;
  order_date: string;
  due_date: string;
  status: "ordered" | "in_progress" | "delivered" | "set_complete" | "cancelled";
  prosth_type: string;
  material: string;
  shade: string;
  tooth_numbers: string[];
  instructions: string;
  notes: string;
  created_at: string;
  patients?: { name_kanji: string; name_kana: string } | null;
};

const PROSTH_TYPES = [
  { value: "fmc", label: "FMC（全部鋳造冠）" },
  { value: "cad_crown", label: "CAD/CAM冠" },
  { value: "facing_crown", label: "前装冠" },
  { value: "inlay", label: "インレー" },
  { value: "onlay", label: "アンレー" },
  { value: "bridge", label: "ブリッジ" },
  { value: "post_core", label: "支台築造" },
  { value: "partial_denture", label: "部分床義歯" },
  { value: "full_denture", label: "総義歯" },
  { value: "denture_repair", label: "義歯修理" },
  { value: "denture_reline", label: "義歯リライン" },
  { value: "tek", label: "TEK（仮歯）" },
  { value: "other", label: "その他" },
];

const MATERIALS = [
  "12%金銀パラジウム合金", "銀合金", "レジン", "CAD/CAMレジン",
  "硬質レジン", "ポーセレン", "ジルコニア", "e.max",
  "金合金", "チタン", "コバルトクロム合金", "ファイバーポスト", "その他",
];

const SHADE_OPTIONS = [
  "A1", "A2", "A3", "A3.5", "A4",
  "B1", "B2", "B3", "B4",
  "C1", "C2", "C3", "C4",
  "D2", "D3", "D4",
  "患者と相談", "技工所にお任せ",
];

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  ordered: { label: "発注済", color: "text-blue-700", bg: "bg-blue-50 border-blue-200" },
  in_progress: { label: "製作中", color: "text-orange-700", bg: "bg-orange-50 border-orange-200" },
  delivered: { label: "納品済", color: "text-green-700", bg: "bg-green-50 border-green-200" },
  set_complete: { label: "セット完了", color: "text-purple-700", bg: "bg-purple-50 border-purple-200" },
  cancelled: { label: "キャンセル", color: "text-gray-500", bg: "bg-gray-50 border-gray-200" },
};

const ALL_TEETH = [
  "18","17","16","15","14","13","12","11",
  "21","22","23","24","25","26","27","28",
  "48","47","46","45","44","43","42","41",
  "31","32","33","34","35","36","37","38",
];

function LabOrderContent() {
  const searchParams = useSearchParams();
  const prefillPatientId = searchParams.get("patient_id");
  const prefillRecordId = searchParams.get("record_id");

  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"list" | "new">("list");
  const [filter, setFilter] = useState<string>("active");
  const [selected, setSelected] = useState<LabOrder | null>(null);

  // 新規フォーム
  const [form, setForm] = useState({
    patient_id: prefillPatientId || "",
    record_id: prefillRecordId || "",
    lab_name: "",
    due_date: "",
    prosth_type: "",
    material: "",
    shade: "",
    tooth_numbers: [] as string[],
    instructions: "",
    notes: "",
  });
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<{ id: string; name_kanji: string; name_kana: string }[]>([]);
  const [selectedPatientName, setSelectedPatientName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadOrders(); }, []);

  useEffect(() => {
    if (prefillPatientId) {
      supabase.from("patients").select("id, name_kanji, name_kana").eq("id", prefillPatientId).single()
        .then(({ data }) => { if (data) setSelectedPatientName(data.name_kanji); });
      setTab("new");
    }
  }, [prefillPatientId]);

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
      .or(`name_kanji.ilike.%${q}%,name_kana.ilike.%${q}%`)
      .limit(8);
    if (data) setPatientResults(data);
  }

  function toggleTooth(t: string) {
    const cur = form.tooth_numbers;
    setForm({ ...form, tooth_numbers: cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t] });
  }

  async function submitOrder() {
    if (!form.patient_id || !form.prosth_type || form.tooth_numbers.length === 0) {
      alert("患者、補綴種類、歯番号は必須です");
      return;
    }
    setSaving(true);
    const orderNumber = `LO-${Date.now().toString(36).toUpperCase()}`;
    const orderDate = new Date().toISOString().split("T")[0];

    const { error } = await supabase.from("lab_orders").insert({
      patient_id: form.patient_id,
      record_id: form.record_id || null,
      order_number: orderNumber,
      lab_name: form.lab_name,
      order_date: orderDate,
      due_date: form.due_date || null,
      status: "ordered",
      prosth_type: form.prosth_type,
      material: form.material,
      shade: form.shade,
      tooth_numbers: form.tooth_numbers,
      instructions: form.instructions,
      notes: form.notes,
    });

    if (error) {
      alert("保存エラー: " + error.message);
    } else {
      setForm({ patient_id: "", record_id: "", lab_name: "", due_date: "", prosth_type: "", material: "", shade: "", tooth_numbers: [], instructions: "", notes: "" });
      setSelectedPatientName("");
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

  function printLabOrder(order: LabOrder) {
    const patientName = order.patients?.name_kanji || "不明";
    const prosthLabel = PROSTH_TYPES.find(p => p.value === order.prosth_type)?.label || order.prosth_type;
    const teeth = order.tooth_numbers.map(t => `#${t}`).join(", ");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>技工指示書</title>
<style>@media print{.no-print{display:none!important;}@page{size:A4;margin:12mm;}}body{font-family:"Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif;max-width:700px;margin:0 auto;padding:20px;font-size:12px;color:#333;}h1{text-align:center;font-size:20px;border:2px solid #333;padding:8px;margin-bottom:16px;}table{width:100%;border-collapse:collapse;margin-bottom:12px;}td,th{border:1px solid #999;padding:6px 10px;text-align:left;font-size:12px;}th{background:#f5f5f5;width:120px;font-weight:bold;}.big{font-size:16px;font-weight:bold;}.section{font-weight:bold;background:#eee;}.instructions{min-height:80px;white-space:pre-wrap;}.footer{margin-top:20px;display:flex;justify-content:space-between;}.stamp-box{width:100px;height:100px;border:1px solid #aaa;text-align:center;line-height:100px;font-size:10px;color:#aaa;}</style></head><body>
<div class="no-print" style="text-align:center;margin-bottom:16px;"><button onclick="window.print()" style="padding:10px 30px;font-size:14px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨️ 印刷する</button><button onclick="window.close()" style="padding:10px 20px;font-size:12px;background:#eee;border:none;border-radius:6px;cursor:pointer;margin-left:8px;">閉じる</button></div>
<h1>技 工 指 示 書</h1>
<table>
<tr><th>指示書番号</th><td>${order.order_number}</td><th>発注日</th><td>${order.order_date}</td></tr>
<tr><th>技工所名</th><td colspan="3">${order.lab_name || "（未指定）"}</td></tr>
<tr><th>患者名</th><td>${patientName} 様</td><th>納品予定日</th><td class="big">${order.due_date || "未定"}</td></tr>
</table>
<table>
<tr class="section"><td colspan="4">■ 補綴内容</td></tr>
<tr><th>種類</th><td class="big">${prosthLabel}</td><th>歯番号</th><td class="big">${teeth}</td></tr>
<tr><th>使用材料</th><td>${order.material || "指定なし"}</td><th>シェード</th><td>${order.shade || "指定なし"}</td></tr>
</table>
<table>
<tr class="section"><td colspan="2">■ 指示事項</td></tr>
<tr><td colspan="2" class="instructions">${order.instructions || "特記事項なし"}</td></tr>
</table>
<table>
<tr class="section"><td colspan="2">■ 備考</td></tr>
<tr><td colspan="2" class="instructions">${order.notes || ""}</td></tr>
</table>
<div class="footer">
<div><p>歯科医師署名: ___________________</p><p style="margin-top:8px;">日付: ${order.order_date}</p></div>
<div class="stamp-box">医院印</div>
</div>
</body></html>`;
    const pw = window.open("", "_blank");
    if (pw) { pw.document.write(html); pw.document.close(); }
  }

  const filteredOrders = orders.filter(o => {
    if (filter === "active") return !["set_complete", "cancelled"].includes(o.status);
    if (filter === "delivered") return o.status === "delivered";
    if (filter === "completed") return o.status === "set_complete";
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm font-bold">← ホーム</Link>
            <h1 className="text-lg font-bold text-gray-900">🏭 技工指示書</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setTab("list")} className={`px-4 py-2 rounded-lg text-xs font-bold ${tab === "list" ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-500"}`}>📋 一覧</button>
            <button onClick={() => setTab("new")} className={`px-4 py-2 rounded-lg text-xs font-bold ${tab === "new" ? "bg-sky-500 text-white" : "bg-gray-100 text-gray-500"}`}>➕ 新規作成</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* ===== 一覧タブ ===== */}
        {tab === "list" && (
          <>
            <div className="flex items-center gap-3 mb-4">
              {[
                { key: "active", label: "進行中" },
                { key: "delivered", label: "納品済" },
                { key: "completed", label: "セット完了" },
                { key: "all", label: "全て" },
              ].map(f => (
                <button key={f.key} onClick={() => setFilter(f.key)}
                  className={`px-4 py-2 rounded-lg text-xs font-bold ${filter === f.key ? "bg-sky-500 text-white" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
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
                <div className="flex-1 space-y-2">
                  {filteredOrders.map(o => {
                    const cfg = STATUS_CONFIG[o.status] || STATUS_CONFIG.ordered;
                    const prosthLabel = PROSTH_TYPES.find(p => p.value === o.prosth_type)?.label || o.prosth_type;
                    return (
                      <button key={o.id} onClick={() => setSelected(o)} className={`w-full bg-white rounded-xl border-2 p-4 text-left transition-all hover:shadow-md ${selected?.id === o.id ? "border-sky-400 shadow-md" : "border-gray-200"}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-lg font-bold text-gray-700">{(o.patients?.name_kanji || "?").charAt(0)}</div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-gray-900">{o.patients?.name_kanji || "不明"}</p>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>{cfg.label}</span>
                              </div>
                              <p className="text-xs text-gray-400">{prosthLabel} ・ {o.tooth_numbers.map(t => `#${t}`).join(", ")}</p>
                            </div>
                          </div>
                          <div className="text-right">
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
                          <div><p className="text-xs text-gray-400">{selected.order_number}</p><p className="text-lg font-bold">{selected.patients?.name_kanji || "不明"} 様</p></div>
                          <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white">✕</button>
                        </div>
                      </div>
                      <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div><span className="text-gray-400">種類</span><p className="font-bold text-gray-800">{PROSTH_TYPES.find(p => p.value === selected.prosth_type)?.label}</p></div>
                          <div><span className="text-gray-400">歯番号</span><p className="font-bold text-gray-800">{selected.tooth_numbers.map(t => `#${t}`).join(", ")}</p></div>
                          <div><span className="text-gray-400">材料</span><p className="font-bold text-gray-800">{selected.material || "未指定"}</p></div>
                          <div><span className="text-gray-400">シェード</span><p className="font-bold text-gray-800">{selected.shade || "未指定"}</p></div>
                          <div><span className="text-gray-400">技工所</span><p className="font-bold text-gray-800">{selected.lab_name || "未指定"}</p></div>
                          <div><span className="text-gray-400">納品予定日</span><p className="font-bold text-gray-800">{selected.due_date || "未定"}</p></div>
                        </div>
                        {selected.instructions && (
                          <div className="bg-gray-50 rounded-lg p-3"><p className="text-[10px] text-gray-400 font-bold mb-1">指示事項</p><p className="text-xs text-gray-700 whitespace-pre-wrap">{selected.instructions}</p></div>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {(["ordered", "in_progress", "delivered", "set_complete"] as const).map(s => {
                            const cfg = STATUS_CONFIG[s];
                            return (
                              <button key={s} onClick={() => updateStatus(selected, s)}
                                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${selected.status === s ? `${cfg.bg} ${cfg.color} ring-2 ring-sky-400` : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}>
                                {cfg.label}
                              </button>
                            );
                          })}
                        </div>
                        <button onClick={() => printLabOrder(selected)} className="w-full bg-gray-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-gray-700">🖨️ 技工指示書を印刷</button>
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
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-6">➕ 技工指示書 新規作成</h2>

              {/* 患者選択 */}
              <div className="mb-5">
                <label className="text-sm font-bold text-gray-700 block mb-1">患者 *</label>
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
                            className="w-full text-left px-4 py-2 hover:bg-sky-50 text-sm"><span className="font-bold">{p.name_kanji}</span> <span className="text-gray-400">({p.name_kana})</span></button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 補綴種類 */}
              <div className="mb-5">
                <label className="text-sm font-bold text-gray-700 block mb-1">補綴種類 *</label>
                <div className="flex flex-wrap gap-2">
                  {PROSTH_TYPES.map(p => (
                    <button key={p.value} onClick={() => setForm({ ...form, prosth_type: p.value })}
                      className={`px-3 py-2 rounded-lg text-xs font-bold border transition-all ${form.prosth_type === p.value ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-600 hover:border-sky-300"}`}>
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 歯番号 */}
              <div className="mb-5">
                <label className="text-sm font-bold text-gray-700 block mb-2">歯番号 * （タップで選択）</label>
                <div className="flex justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <div className="flex gap-1">
                      {["18","17","16","15","14","13","12","11"].map(t => (
                        <button key={t} onClick={() => toggleTooth(t)}
                          className={`w-9 h-9 rounded-lg text-[10px] font-bold border-2 ${form.tooth_numbers.includes(t) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-500 hover:border-sky-300"}`}>{t}</button>
                      ))}
                      <div className="w-px h-9 bg-gray-300 mx-1" />
                      {["21","22","23","24","25","26","27","28"].map(t => (
                        <button key={t} onClick={() => toggleTooth(t)}
                          className={`w-9 h-9 rounded-lg text-[10px] font-bold border-2 ${form.tooth_numbers.includes(t) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-500 hover:border-sky-300"}`}>{t}</button>
                      ))}
                    </div>
                    <div className="w-full border-t-2 border-gray-400 my-0.5" />
                    <div className="flex gap-1">
                      {["48","47","46","45","44","43","42","41"].map(t => (
                        <button key={t} onClick={() => toggleTooth(t)}
                          className={`w-9 h-9 rounded-lg text-[10px] font-bold border-2 ${form.tooth_numbers.includes(t) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-500 hover:border-sky-300"}`}>{t}</button>
                      ))}
                      <div className="w-px h-9 bg-gray-300 mx-1" />
                      {["31","32","33","34","35","36","37","38"].map(t => (
                        <button key={t} onClick={() => toggleTooth(t)}
                          className={`w-9 h-9 rounded-lg text-[10px] font-bold border-2 ${form.tooth_numbers.includes(t) ? "bg-sky-500 text-white border-sky-500" : "bg-white border-gray-200 text-gray-500 hover:border-sky-300"}`}>{t}</button>
                      ))}
                    </div>
                  </div>
                </div>
                {form.tooth_numbers.length > 0 && <p className="text-xs text-sky-600 font-bold text-center mt-2">選択: {form.tooth_numbers.map(t => `#${t}`).join(", ")}</p>}
              </div>

              {/* 材料・シェード */}
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="text-sm font-bold text-gray-700 block mb-1">使用材料</label>
                  <select value={form.material} onChange={e => setForm({ ...form, material: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">選択...</option>
                    {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-bold text-gray-700 block mb-1">シェード</label>
                  <select value={form.shade} onChange={e => setForm({ ...form, shade: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                    <option value="">選択...</option>
                    {SHADE_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* 技工所・納品日 */}
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="text-sm font-bold text-gray-700 block mb-1">技工所名</label>
                  <input value={form.lab_name} onChange={e => setForm({ ...form, lab_name: e.target.value })} placeholder="例: ○○デンタルラボ"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                </div>
                <div>
                  <label className="text-sm font-bold text-gray-700 block mb-1">納品予定日</label>
                  <input type="date" value={form.due_date} onChange={e => setForm({ ...form, due_date: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                </div>
              </div>

              {/* 指示事項 */}
              <div className="mb-5">
                <label className="text-sm font-bold text-gray-700 block mb-1">指示事項</label>
                <textarea value={form.instructions} onChange={e => setForm({ ...form, instructions: e.target.value })} rows={4} placeholder="技工所への特記事項・形態の要望など..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 resize-none" />
              </div>

              {/* 備考 */}
              <div className="mb-6">
                <label className="text-sm font-bold text-gray-700 block mb-1">備考</label>
                <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} placeholder="院内メモなど..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 resize-none" />
              </div>

              <button onClick={submitOrder} disabled={saving} className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 disabled:opacity-50 shadow-lg shadow-sky-200">
                {saving ? "保存中..." : "📄 技工指示書を作成"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default function LabOrderPage() {
  return (<Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>}><LabOrderContent /></Suspense>);
}
