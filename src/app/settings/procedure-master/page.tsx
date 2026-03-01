"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type FeeItem = { code: string; name: string; points?: number; count: number };
type Procedure = {
  id: string;
  procedure_name: string;
  category: string;
  subcategory: string | null;
  fee_items: FeeItem[];
  soap_keywords: string[];
  conditions: Record<string, string>;
  display_order: number;
  is_active: boolean;
  is_default: boolean;
  notes: string | null;
  revision_code: string;
};

const CATS: Record<string, { label: string; icon: string; bg: string; text: string; border: string }> = {
  basic:        { label: "初・再診",   icon: "🏥", bg: "bg-slate-50",   text: "text-slate-700",   border: "border-slate-200" },
  restoration:  { label: "う蝕治療",   icon: "🦷", bg: "bg-red-50",     text: "text-red-700",     border: "border-red-200" },
  endo:         { label: "歯内治療",   icon: "🔬", bg: "bg-purple-50",  text: "text-purple-700",  border: "border-purple-200" },
  perio:        { label: "歯周治療",   icon: "🪥", bg: "bg-green-50",   text: "text-green-700",   border: "border-green-200" },
  prosth:       { label: "補綴",       icon: "👑", bg: "bg-yellow-50",  text: "text-yellow-700",  border: "border-yellow-200" },
  surgery:      { label: "外科",       icon: "🔪", bg: "bg-orange-50",  text: "text-orange-700",  border: "border-orange-200" },
  denture:      { label: "義歯",       icon: "🫦", bg: "bg-pink-50",    text: "text-pink-700",    border: "border-pink-200" },
  pediatric:    { label: "小児",       icon: "👶", bg: "bg-sky-50",     text: "text-sky-700",     border: "border-sky-200" },
  imaging:      { label: "検査・画像", icon: "📷", bg: "bg-cyan-50",    text: "text-cyan-700",    border: "border-cyan-200" },
  management:   { label: "管理・指導", icon: "📋", bg: "bg-indigo-50",  text: "text-indigo-700",  border: "border-indigo-200" },
  medication:   { label: "投薬",       icon: "💊", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
  orthodontics: { label: "矯正",       icon: "🦷", bg: "bg-teal-50",    text: "text-teal-700",    border: "border-teal-200" },
  home_care:    { label: "在宅",       icon: "🏠", bg: "bg-amber-50",   text: "text-amber-700",   border: "border-amber-200" },
  other:        { label: "その他",     icon: "📎", bg: "bg-gray-50",    text: "text-gray-600",    border: "border-gray-200" },
};

type EditForm = {
  procedure_name: string;
  category: string;
  subcategory: string;
  fee_items: FeeItem[];
  soap_keywords: string;
  conditions: string;
  notes: string;
  display_order: number;
};

const EMPTY_FORM: EditForm = {
  procedure_name: "", category: "other", subcategory: "",
  fee_items: [{ code: "", name: "", points: 0, count: 1 }],
  soap_keywords: "", conditions: "", notes: "", display_order: 999,
};

function toForm(p: Procedure): EditForm {
  return {
    procedure_name: p.procedure_name, category: p.category,
    subcategory: p.subcategory || "",
    fee_items: p.fee_items.length > 0 ? p.fee_items.map(f => ({ ...f, points: f.points || 0 })) : [{ code: "", name: "", points: 0, count: 1 }],
    soap_keywords: p.soap_keywords.join(", "),
    conditions: Object.entries(p.conditions).map(([k, v]) => `${k}:${v}`).join(", "),
    notes: p.notes || "", display_order: p.display_order,
  };
}

function totalPoints(items: FeeItem[]): number {
  return items.reduce((s, f) => s + (f.points || 0) * (f.count || 1), 0);
}

export default function ProcedureMasterPage() {
  const [procs, setProcs] = useState<Procedure[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("all");
  const [filterActive, setFilterActive] = useState<"all"|"active"|"inactive">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<EditForm>(EMPTY_FORM);
  const [formSaving, setFormSaving] = useState(false);
  const [viewMode, setViewMode] = useState<"list"|"grouped">("grouped");
  const [feeCount, setFeeCount] = useState(0);

  useEffect(() => { load(); loadFeeCount(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("procedure_master").select("*").order("display_order");
    if (data) setProcs(data as Procedure[]);
    setLoading(false);
  }

  async function loadFeeCount() {
    const { count } = await supabase.from("fee_master_v2").select("*", { count: "exact", head: true });
    if (count) setFeeCount(count);
  }

  async function toggleActive(id: string, cur: boolean) {
    setSaving(id);
    await supabase.from("procedure_master").update({ is_active: !cur }).eq("id", id);
    setProcs(p => p.map(x => x.id === id ? { ...x, is_active: !cur } : x));
    flash(!cur ? "✅ 有効化" : "⏸️ 無効化");
    setSaving(null);
  }

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 2500); }

  function updateFee(i: number, field: string, val: string | number) {
    const items = [...form.fee_items];
    items[i] = { ...items[i], [field]: val };
    setForm({ ...form, fee_items: items });
  }

  async function saveForm() {
    if (!form.procedure_name.trim() || form.fee_items.every(f => !f.code.trim())) { flash("⚠️ 処置名とコードを入力"); return; }
    setFormSaving(true);
    const keywords = form.soap_keywords.split(",").map(s => s.trim()).filter(Boolean);
    const condObj: Record<string, string> = {};
    form.conditions.split(",").forEach(pair => { const [k, v] = pair.split(":").map(s => s.trim()); if (k && v) condObj[k] = v; });
    const rec = {
      procedure_name: form.procedure_name.trim(), category: form.category,
      subcategory: form.subcategory.trim() || null,
      fee_items: form.fee_items.filter(f => f.code.trim()),
      soap_keywords: keywords, conditions: condObj,
      notes: form.notes.trim() || null, display_order: form.display_order,
      is_active: true, is_default: false, revision_code: "R06",
    };
    if (editId === "new") {
      const { error } = await supabase.from("procedure_master").insert(rec);
      if (!error) { flash("✅ 追加完了"); await load(); setEditId(null); } else flash("❌ " + error.message);
    } else {
      const { error } = await supabase.from("procedure_master").update(rec).eq("id", editId);
      if (!error) { flash("✅ 保存完了"); await load(); setEditId(null); } else flash("❌ " + error.message);
    }
    setFormSaving(false);
  }

  async function deleteProcedure(id: string, name: string) {
    if (!confirm(`「${name}」を削除しますか？`)) return;
    await supabase.from("procedure_master").delete().eq("id", id);
    flash("🗑️ 削除完了"); await load(); setEditId(null);
  }

  const filtered = useMemo(() => procs.filter(p => {
    if (filterCat !== "all" && p.category !== filterCat) return false;
    if (filterActive === "active" && !p.is_active) return false;
    if (filterActive === "inactive" && p.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.procedure_name.toLowerCase().includes(q) || p.soap_keywords.some(k => k.toLowerCase().includes(q)) || p.fee_items.some(f => f.code.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) || (p.notes || "").toLowerCase().includes(q);
    }
    return true;
  }), [procs, filterCat, filterActive, search]);

  const grouped = useMemo(() => {
    const g: Record<string, Procedure[]> = {};
    for (const p of filtered) {
      if (!g[p.category]) g[p.category] = [];
      g[p.category].push(p);
    }
    return g;
  }, [filtered]);

  const catCounts = useMemo(() => {
    const c: Record<string, { total: number; active: number }> = {};
    for (const p of procs) { if (!c[p.category]) c[p.category] = { total: 0, active: 0 }; c[p.category].total++; if (p.is_active) c[p.category].active++; }
    return c;
  }, [procs]);

  const totalActive = procs.filter(p => p.is_active).length;

  if (loading) return (<div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="animate-spin w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full mx-auto mb-3" /><p className="text-sm text-gray-400 mt-3">読み込み中...</p></div>);

  const renderCard = (proc: Procedure) => {
    const cat = CATS[proc.category] || CATS.other;
    const isExp = expandedId === proc.id;
    const pts = totalPoints(proc.fee_items);
    return (
      <div key={proc.id} className={`bg-white rounded-xl border transition-all ${proc.is_active ? "border-gray-200" : "border-gray-100 opacity-50"} ${isExp ? "ring-2 ring-sky-200 border-sky-300 shadow-md" : "hover:shadow-sm hover:border-gray-300"}`}>
        {/* ヘッダー */}
        <div className="flex items-center gap-2.5 px-4 py-3 cursor-pointer" onClick={() => setExpandedId(isExp ? null : proc.id)}>
          <button onClick={e => { e.stopPropagation(); toggleActive(proc.id, proc.is_active); }} className={`w-10 h-5 rounded-full flex-shrink-0 relative transition-colors ${proc.is_active ? "bg-green-500" : "bg-gray-300"} ${saving === proc.id ? "opacity-50" : ""}`}>
            <div className={`w-4 h-4 bg-white rounded-full absolute top-0.5 shadow-sm transition-all ${proc.is_active ? "left-[22px]" : "left-0.5"}`} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-gray-900 truncate">{proc.procedure_name}</span>
              {proc.subcategory && <span className="text-[9px] text-gray-400 flex-shrink-0">{proc.subcategory}</span>}
            </div>
            {proc.notes && <p className="text-[10px] text-gray-400 truncate mt-0.5">{proc.notes}</p>}
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="text-right">
              <div className="text-sm font-bold text-sky-600">{pts > 0 ? `${pts}点` : "-"}</div>
              {pts > 0 && <div className="text-[9px] text-gray-400">≈¥{Math.round(pts * 10 * 0.3).toLocaleString()}</div>}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-bold">{proc.fee_items.length}品</span>
              <span className={`text-[10px] text-gray-300 transition-transform ${isExp ? "rotate-180" : ""}`}>▼</span>
            </div>
          </div>
        </div>

        {/* 展開: 食材一覧 */}
        {isExp && (
          <div className="border-t border-gray-100">
            {/* 食材リスト */}
            <div className="px-4 py-3">
              <p className="text-[10px] font-bold text-gray-400 mb-2 flex items-center gap-1">
                <span>📦</span> 算定コード（食材）
              </p>
              <div className="space-y-1">
                {proc.fee_items.map((fi, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-[10px] text-gray-300 w-4">{i + 1}.</span>
                    <code className="text-[10px] font-bold text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded font-mono">{fi.code}</code>
                    <span className="text-xs text-gray-700 flex-1">{fi.name}</span>
                    {fi.count > 1 && <span className="text-[10px] text-gray-400">×{fi.count}</span>}
                    <span className="text-xs font-bold text-gray-900 w-16 text-right">{fi.points ? `${fi.points}点` : "-"}</span>
                  </div>
                ))}
              </div>
              {pts > 0 && (
                <div className="flex justify-end mt-2 pt-2 border-t border-gray-100">
                  <div className="text-right">
                    <span className="text-xs text-gray-400 mr-2">合計</span>
                    <span className="text-base font-bold text-sky-600">{pts}点</span>
                    <span className="text-xs text-gray-400 ml-2">（3割: ¥{Math.round(pts * 10 * 0.3).toLocaleString()}）</span>
                  </div>
                </div>
              )}
            </div>

            {/* キーワード・条件 */}
            <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold text-gray-400 mb-1">🎯 SOAPキーワード</p>
                <div className="flex flex-wrap gap-1">
                  {proc.soap_keywords.slice(0, 12).map((kw, i) => (
                    <span key={i} className="text-[9px] bg-amber-50 text-amber-700 font-medium px-1.5 py-0.5 rounded-full border border-amber-200">{kw}</span>
                  ))}
                  {proc.soap_keywords.length > 12 && <span className="text-[9px] text-gray-400">+{proc.soap_keywords.length - 12}件</span>}
                </div>
              </div>
              {Object.keys(proc.conditions).length > 0 && (
                <div>
                  <p className="text-[10px] font-bold text-gray-400 mb-1">⚙️ 算定条件</p>
                  {Object.entries(proc.conditions).map(([k, v]) => (
                    <span key={k} className="text-[9px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded mr-1">{k}: {v}</span>
                  ))}
                </div>
              )}
            </div>

            {/* 操作ボタン */}
            <div className="px-4 pb-3 flex gap-2 border-t border-gray-100 pt-2">
              <button onClick={() => { setEditId(proc.id); setForm(toForm(proc)); setExpandedId(null); }} className="text-[11px] text-sky-500 hover:text-sky-700 font-bold px-2 py-1 rounded hover:bg-sky-50">✏️ 編集</button>
              {!proc.is_default && <button onClick={() => deleteProcedure(proc.id, proc.procedure_name)} className="text-[11px] text-red-400 hover:text-red-600 font-bold px-2 py-1 rounded hover:bg-red-50">🗑️ 削除</button>}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/settings" className="text-gray-400 hover:text-gray-600 text-sm">← 設定</Link>
            <div>
              <h1 className="text-base font-bold text-gray-900">処置マスタ（レシピ管理）</h1>
              <p className="text-[10px] text-gray-400">処置パターン → fee_master食材の組み合わせ</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] bg-sky-50 text-sky-600 font-bold px-2 py-0.5 rounded-full">🍳 {totalActive}/{procs.length} レシピ</span>
              <span className="text-[10px] bg-emerald-50 text-emerald-600 font-bold px-2 py-0.5 rounded-full">📦 {feeCount.toLocaleString()} 食材</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {msg && <span className="text-[10px] font-bold text-green-600 bg-green-50 px-2 py-1 rounded-full animate-pulse">{msg}</span>}
            <button onClick={() => setViewMode(viewMode === "grouped" ? "list" : "grouped")} className="text-[10px] text-gray-400 hover:text-gray-600 px-2 py-1 rounded border border-gray-200">{viewMode === "grouped" ? "📋 リスト" : "📂 グループ"}</button>
            <button onClick={() => { setEditId("new"); setForm(EMPTY_FORM); setExpandedId(null); }} className="bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs px-3 py-1.5 rounded-lg">＋ 追加</button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* 編集フォーム */}
        {editId && (
          <div className="bg-white border-2 border-sky-300 rounded-xl p-5 mb-4 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sky-700 text-sm">{editId === "new" ? "➕ 新しいレシピを追加" : "✏️ レシピを編集"}</h3>
              <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className="block text-[10px] font-bold text-gray-500 mb-1">処置名（レシピ名）*</label><input type="text" value={form.procedure_name} onChange={e => setForm({ ...form, procedure_name: e.target.value })} placeholder="CR充填(単純)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
              <div><label className="block text-[10px] font-bold text-gray-500 mb-1">カテゴリ *</label><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400">{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}</select></div>
              <div><label className="block text-[10px] font-bold text-gray-500 mb-1">サブカテゴリ</label><input type="text" value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
              <div><label className="block text-[10px] font-bold text-gray-500 mb-1">表示順</label><input type="number" value={form.display_order} onChange={e => setForm({ ...form, display_order: parseInt(e.target.value) || 0 })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
            </div>
            <div className="mt-3">
              <label className="block text-[10px] font-bold text-gray-500 mb-1">📦 算定コード（食材）*</label>
              {form.fee_items.map((fi, i) => (<div key={i} className="flex gap-1.5 mb-1"><input type="text" value={fi.code} onChange={e => updateFee(i, "code", e.target.value)} placeholder="M001-sho" className="w-32 border border-gray-300 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" /><input type="text" value={fi.name} onChange={e => updateFee(i, "name", e.target.value)} placeholder="窩洞形成(単純)" className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400" /><input type="number" value={fi.points || 0} onChange={e => updateFee(i, "points", parseInt(e.target.value) || 0)} placeholder="点数" className="w-16 border border-gray-300 rounded px-2 py-1.5 text-xs text-center focus:outline-none focus:border-sky-400" /><input type="number" value={fi.count} onChange={e => updateFee(i, "count", parseInt(e.target.value) || 1)} className="w-12 border border-gray-300 rounded px-2 py-1.5 text-xs text-center focus:outline-none focus:border-sky-400" min={1} />{form.fee_items.length > 1 && <button onClick={() => setForm({ ...form, fee_items: form.fee_items.filter((_, j) => j !== i) })} className="text-red-400 text-xs px-1">✕</button>}</div>))}
              <button onClick={() => setForm({ ...form, fee_items: [...form.fee_items, { code: "", name: "", points: 0, count: 1 }] })} className="text-[10px] text-sky-500 hover:text-sky-700 font-bold mt-1">＋ 食材追加</button>
            </div>
            <div className="mt-3"><label className="block text-[10px] font-bold text-gray-500 mb-1">🎯 SOAPキーワード（カンマ区切り）</label><input type="text" value={form.soap_keywords} onChange={e => setForm({ ...form, soap_keywords: e.target.value })} placeholder="cr充填, cr, 白い詰め物, レジン" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
            <div className="mt-3"><label className="block text-[10px] font-bold text-gray-500 mb-1">⚙️ 算定条件（key:value カンマ区切り）</label><input type="text" value={form.conditions} onChange={e => setForm({ ...form, conditions: e.target.value })} placeholder="surfaces:1面" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
            <div className="mt-3"><label className="block text-[10px] font-bold text-gray-500 mb-1">📝 備考</label><input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveForm} disabled={formSaving} className="bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm px-5 py-2 rounded-lg disabled:opacity-50">{formSaving ? "保存中..." : editId === "new" ? "追加する" : "保存する"}</button>
              {editId !== "new" && <button onClick={() => deleteProcedure(editId!, form.procedure_name)} className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm px-4 py-2 rounded-lg">削除</button>}
              <button onClick={() => setEditId(null)} className="text-gray-400 text-sm px-4 py-2">キャンセル</button>
            </div>
          </div>
        )}

        {/* カテゴリフィルター */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          <button onClick={() => setFilterCat("all")} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${filterCat === "all" ? "border-sky-400 bg-sky-50 text-sky-700" : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}>全て ({procs.length})</button>
          {Object.entries(CATS).map(([key, cfg]) => {
            const c = catCounts[key];
            if (!c) return null;
            return (<button key={key} onClick={() => setFilterCat(filterCat === key ? "all" : key)} className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${filterCat === key ? `${cfg.border} ${cfg.bg} ${cfg.text}` : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"}`}>{cfg.icon} {cfg.label} ({c.active})</button>);
          })}
        </div>

        {/* 検索 */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative"><input type="text" placeholder="処置名・キーワード・コードで検索..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 pl-8" /><span className="absolute left-2.5 top-2.5 text-gray-300 text-sm">🔍</span></div>
          <select value={filterActive} onChange={e => setFilterActive(e.target.value as "all"|"active"|"inactive")} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm"><option value="all">全て</option><option value="active">有効のみ</option><option value="inactive">無効のみ</option></select>
        </div>

        {/* 一覧 */}
        {viewMode === "grouped" ? (
          <div className="space-y-6">
            {Object.entries(CATS).map(([catKey, cfg]) => {
              const items = grouped[catKey];
              if (!items || items.length === 0) return null;
              return (
                <div key={catKey}>
                  <div className={`flex items-center gap-2 mb-2 px-1`}>
                    <span className="text-lg">{cfg.icon}</span>
                    <h2 className={`text-sm font-bold ${cfg.text}`}>{cfg.label}</h2>
                    <span className="text-[10px] text-gray-400">{items.length}件</span>
                    <div className="flex-1 border-t border-gray-200 ml-2" />
                  </div>
                  <div className="space-y-1.5">
                    {items.map(renderCard)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1.5">{filtered.map(renderCard)}</div>
        )}

        {filtered.length === 0 && <div className="text-center py-12"><p className="text-gray-400 text-sm">該当する処置がありません</p></div>}

        <div className="text-center py-6">
          <p className="text-[10px] text-gray-400">🍳 {procs.length}レシピ（{totalActive}有効）/ 📦 {feeCount.toLocaleString()}食材（fee_master_v2）/ R06</p>
        </div>
      </div>
    </div>
  );
}
