"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type FeeItem = { code: string; name: string; count: number };
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

const CATEGORIES: Record<string, { label: string; icon: string; color: string }> = {
  basic:          { label: "基本診療料",  icon: "🏥", color: "bg-gray-100 text-gray-700" },
  anesthesia:     { label: "麻酔",       icon: "💉", color: "bg-blue-50 text-blue-700" },
  restoration:    { label: "う蝕治療",   icon: "🦷", color: "bg-red-50 text-red-700" },
  endo:           { label: "歯内治療",   icon: "🔬", color: "bg-purple-50 text-purple-700" },
  perio:          { label: "歯周治療",   icon: "📊", color: "bg-green-50 text-green-700" },
  prosth:         { label: "補綴",       icon: "👑", color: "bg-yellow-50 text-yellow-700" },
  surgery:        { label: "抜歯・外科", icon: "🔪", color: "bg-orange-50 text-orange-700" },
  denture:        { label: "義歯",       icon: "🫦", color: "bg-pink-50 text-pink-700" },
  imaging:        { label: "検査・画像", icon: "📷", color: "bg-cyan-50 text-cyan-700" },
  management:     { label: "管理・指導", icon: "📋", color: "bg-indigo-50 text-indigo-700" },
  medication:     { label: "処方",       icon: "💊", color: "bg-emerald-50 text-emerald-700" },
  perio_surg:     { label: "歯周外科",   icon: "🩺", color: "bg-violet-50 text-violet-700" },
  orthodontics:   { label: "矯正",       icon: "🦷", color: "bg-teal-50 text-teal-700" },
  home_care:      { label: "在宅",       icon: "🏠", color: "bg-amber-50 text-amber-700" },
  rehabilitation: { label: "リハビリ",   icon: "🏃", color: "bg-lime-50 text-lime-700" },
  other:          { label: "その他",     icon: "📎", color: "bg-gray-50 text-gray-600" },
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
  fee_items: [{ code: "", name: "", count: 1 }],
  soap_keywords: "", conditions: "", notes: "", display_order: 999,
};

function toForm(p: Procedure): EditForm {
  return {
    procedure_name: p.procedure_name,
    category: p.category,
    subcategory: p.subcategory || "",
    fee_items: p.fee_items.length > 0 ? [...p.fee_items] : [{ code: "", name: "", count: 1 }],
    soap_keywords: p.soap_keywords.join(", "),
    conditions: Object.entries(p.conditions).map(([k, v]) => `${k}:${v}`).join(", "),
    notes: p.notes || "",
    display_order: p.display_order,
  };
}

export default function ProcedureMasterPage() {
  const [procedures, setProcedures] = useState<Procedure[]>([]);
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

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("procedure_master").select("*").order("display_order", { ascending: true });
    if (data && !error) setProcedures(data as Procedure[]);
    setLoading(false);
  }

  async function toggleActive(id: string, cur: boolean) {
    setSaving(id);
    const { error } = await supabase.from("procedure_master").update({ is_active: !cur }).eq("id", id);
    if (!error) {
      setProcedures(prev => prev.map(p => p.id === id ? { ...p, is_active: !cur } : p));
      flash(!cur ? "✅ 有効化" : "⏸️ 無効化");
    }
    setSaving(null);
  }

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 2500); }
  function startAdd() { setEditId("new"); setForm(EMPTY_FORM); setExpandedId(null); }
  function startEdit(p: Procedure) { setEditId(p.id); setForm(toForm(p)); setExpandedId(null); }

  function updateFee(i: number, field: keyof FeeItem, val: string | number) {
    const items = [...form.fee_items];
    items[i] = { ...items[i], [field]: val };
    setForm({ ...form, fee_items: items });
  }
  function addFee() { setForm({ ...form, fee_items: [...form.fee_items, { code: "", name: "", count: 1 }] }); }
  function rmFee(i: number) { if (form.fee_items.length > 1) setForm({ ...form, fee_items: form.fee_items.filter((_, j) => j !== i) }); }

  async function saveForm() {
    if (!form.procedure_name.trim()) { flash("⚠️ 処置名を入力"); return; }
    if (form.fee_items.every(f => !f.code.trim())) { flash("⚠️ コードを1つ以上入力"); return; }
    setFormSaving(true);
    const keywords = form.soap_keywords.split(",").map(s => s.trim()).filter(Boolean);
    const condObj: Record<string, string> = {};
    form.conditions.split(",").forEach(pair => {
      const [k, v] = pair.split(":").map(s => s.trim());
      if (k && v) condObj[k] = v;
    });
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
    const p = procedures.find(x => x.id === id);
    if (p?.is_default) { flash("⚠️ デフォルト処置はON/OFFで対応"); return; }
    if (!confirm(`「${name}」を削除しますか？`)) return;
    const { error } = await supabase.from("procedure_master").delete().eq("id", id);
    if (!error) { flash("🗑️ 削除完了"); await load(); setEditId(null); } else flash("❌ " + error.message);
  }

  const filtered = useMemo(() => procedures.filter(p => {
    if (filterCat !== "all" && p.category !== filterCat) return false;
    if (filterActive === "active" && !p.is_active) return false;
    if (filterActive === "inactive" && p.is_active) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.procedure_name.toLowerCase().includes(q) || p.soap_keywords.some(k => k.toLowerCase().includes(q)) || p.fee_items.some(f => f.code.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) || (p.notes || "").toLowerCase().includes(q);
    }
    return true;
  }), [procedures, filterCat, filterActive, search]);

  const catCounts = useMemo(() => {
    const c: Record<string, { total: number; active: number }> = {};
    for (const p of procedures) { if (!c[p.category]) c[p.category] = { total: 0, active: 0 }; c[p.category].total++; if (p.is_active) c[p.category].active++; }
    return c;
  }, [procedures]);

  const totalActive = procedures.filter(p => p.is_active).length;

  if (loading) return (<div className="min-h-screen bg-gray-50 flex items-center justify-center"><div className="text-center"><div className="animate-spin w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full mx-auto mb-3" /><p className="text-sm text-gray-400">処置マスタを読み込み中...</p></div></div>);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/settings" className="text-gray-400 hover:text-gray-600 text-sm">← 設定</Link>
            <h1 className="text-lg font-bold text-gray-900">処置マスタ管理</h1>
            <span className="text-xs bg-sky-50 text-sky-600 font-bold px-2 py-0.5 rounded-full">{totalActive}/{procedures.length} 有効</span>
          </div>
          <div className="flex items-center gap-2">
            {msg && <span className="text-xs font-bold text-green-600 bg-green-50 px-3 py-1 rounded-full animate-pulse">{msg}</span>}
            <button onClick={startAdd} className="bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs px-3 py-1.5 rounded-lg">＋ 処置を追加</button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {editId && (
          <div className="bg-white border-2 border-sky-300 rounded-xl p-5 mb-4 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sky-700 text-sm">{editId === "new" ? "➕ 新しい処置を追加" : "✏️ 処置を編集"}</h3>
              <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕ 閉じる</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><label className="block text-[10px] font-bold text-gray-500 mb-1">処置名 *</label><input type="text" value={form.procedure_name} onChange={e => setForm({ ...form, procedure_name: e.target.value })} placeholder="CR充填(単純)" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
              <div><label className="block text-[10px] font-bold text-gray-500 mb-1">カテゴリ *</label><select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400">{Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}</select></div>
              <div><label className="block text-[10px] font-bold text-gray-500 mb-1">サブカテゴリ</label><input type="text" value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
              <div><label className="block text-[10px] font-bold text-gray-500 mb-1">表示順</label><input type="number" value={form.display_order} onChange={e => setForm({ ...form, display_order: parseInt(e.target.value) || 0 })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
            </div>
            <div className="mt-3">
              <label className="block text-[10px] font-bold text-gray-500 mb-1">算定コード *</label>
              {form.fee_items.map((fi, i) => (<div key={i} className="flex gap-2 mb-1.5"><input type="text" value={fi.code} onChange={e => updateFee(i, "code", e.target.value)} placeholder="M001-sho" className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-sky-400" /><input type="text" value={fi.name} onChange={e => updateFee(i, "name", e.target.value)} placeholder="窩洞形成(単純)" className="flex-[2] border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400" /><input type="number" value={fi.count} onChange={e => updateFee(i, "count", parseInt(e.target.value) || 1)} className="w-14 border border-gray-300 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:border-sky-400" min={1} />{form.fee_items.length > 1 && <button onClick={() => rmFee(i)} className="text-red-400 hover:text-red-600 text-xs px-1">✕</button>}</div>))}
              <button onClick={addFee} className="text-[10px] text-sky-500 hover:text-sky-700 font-bold mt-1">＋ コード追加</button>
            </div>
            <div className="mt-3"><label className="block text-[10px] font-bold text-gray-500 mb-1">SOAPキーワード（カンマ区切り）</label><input type="text" value={form.soap_keywords} onChange={e => setForm({ ...form, soap_keywords: e.target.value })} placeholder="cr充填, cr, 充填" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
            <div className="mt-3"><label className="block text-[10px] font-bold text-gray-500 mb-1">算定条件（key:value カンマ区切り）</label><input type="text" value={form.conditions} onChange={e => setForm({ ...form, conditions: e.target.value })} placeholder="surfaces:1面" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
            <div className="mt-3"><label className="block text-[10px] font-bold text-gray-500 mb-1">備考</label><input type="text" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveForm} disabled={formSaving} className="bg-sky-500 hover:bg-sky-600 text-white font-bold text-sm px-5 py-2 rounded-lg disabled:opacity-50">{formSaving ? "保存中..." : editId === "new" ? "追加する" : "保存する"}</button>
              {editId !== "new" && <button onClick={() => deleteProcedure(editId!, form.procedure_name)} className="bg-red-50 hover:bg-red-100 text-red-600 font-bold text-sm px-4 py-2 rounded-lg">削除</button>}
              <button onClick={() => setEditId(null)} className="text-gray-400 hover:text-gray-600 text-sm px-4 py-2">キャンセル</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-1.5 mb-4">
          <button onClick={() => setFilterCat("all")} className={`p-2 rounded-lg text-center border ${filterCat === "all" ? "border-sky-400 bg-sky-50 ring-1 ring-sky-200" : "border-gray-200 bg-white hover:border-gray-300"}`}><div className="text-base font-bold text-gray-900">{procedures.length}</div><div className="text-[8px] font-bold text-gray-500">全処置</div></button>
          {Object.entries(CATEGORIES).map(([key, cfg]) => { const c = catCounts[key]; if (!c) return null; return (<button key={key} onClick={() => setFilterCat(filterCat === key ? "all" : key)} className={`p-2 rounded-lg text-center border ${filterCat === key ? "border-sky-400 bg-sky-50 ring-1 ring-sky-200" : "border-gray-200 bg-white hover:border-gray-300"}`}><div className="text-[10px]">{cfg.icon}</div><div className="text-xs font-bold text-gray-900">{c.active}<span className="text-gray-300 font-normal">/{c.total}</span></div><div className="text-[7px] font-bold text-gray-400 truncate">{cfg.label}</div></button>); })}
        </div>

        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative"><input type="text" placeholder="処置名・キーワード・コードで検索..." value={search} onChange={e => setSearch(e.target.value)} className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 pl-8" /><span className="absolute left-2.5 top-2.5 text-gray-300 text-sm">🔍</span></div>
          <select value={filterActive} onChange={e => setFilterActive(e.target.value as "all"|"active"|"inactive")} className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400"><option value="all">全て</option><option value="active">有効のみ</option><option value="inactive">無効のみ</option></select>
        </div>

        <div className="space-y-1">
          {filtered.map(proc => {
            const cat = CATEGORIES[proc.category] || CATEGORIES.other;
            const isExp = expandedId === proc.id;
            return (
              <div key={proc.id} className={`bg-white rounded-lg border ${proc.is_active ? "border-gray-200" : "border-gray-100 opacity-60"} ${isExp ? "ring-1 ring-sky-200 border-sky-300" : "hover:border-gray-300"}`}>
                <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setExpandedId(isExp ? null : proc.id)}>
                  <button onClick={e => { e.stopPropagation(); toggleActive(proc.id, proc.is_active); }} className={`w-9 h-[18px] rounded-full flex-shrink-0 relative ${proc.is_active ? "bg-green-500" : "bg-gray-300"} ${saving === proc.id ? "opacity-50" : ""}`}><div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-[2px] shadow-sm ${proc.is_active ? "left-[18px]" : "left-[2px]"}`} /></button>
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded ${cat.color} flex-shrink-0`}>{cat.icon} {cat.label}</span>
                  <span className="text-xs font-bold text-gray-900 flex-1 truncate">{proc.procedure_name}</span>
                  <span className="text-[9px] text-gray-400 flex-shrink-0">{proc.fee_items.length}コード</span>
                  <span className={`text-gray-300 text-[10px] transition-transform ${isExp ? "rotate-180" : ""}`}>▼</span>
                </div>
                {isExp && (
                  <div className="px-3 pb-3 border-t border-gray-100 pt-2">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 mb-1">算定コード</p>
                        {proc.fee_items.map((fi, i) => (<div key={i} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1 mb-0.5"><code className="text-[9px] font-bold text-sky-600 bg-sky-50 px-1 py-0.5 rounded">{fi.code}</code><span className="text-[10px] text-gray-600 flex-1">{fi.name}</span><span className="text-[9px] text-gray-400">×{fi.count}</span></div>))}
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-gray-400 mb-1">SOAPキーワード</p>
                        <div className="flex flex-wrap gap-1 mb-2">{proc.soap_keywords.map((kw, i) => (<span key={i} className="text-[9px] bg-amber-50 text-amber-700 font-bold px-1.5 py-0.5 rounded-full border border-amber-200">{kw}</span>))}</div>
                        {Object.keys(proc.conditions).length > 0 && (<div className="mb-2"><p className="text-[10px] font-bold text-gray-400 mb-0.5">条件</p>{Object.entries(proc.conditions).map(([k, v]) => (<div key={k} className="text-[9px] text-gray-500"><span className="font-bold">{k}:</span> {v}</div>))}</div>)}
                        {proc.notes && <p className="text-[9px] text-gray-400 italic">{proc.notes}</p>}
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-gray-100 flex gap-2">
                      <button onClick={() => startEdit(proc)} className="text-[10px] text-sky-500 hover:text-sky-700 font-bold">✏️ 編集</button>
                      {!proc.is_default && <button onClick={() => deleteProcedure(proc.id, proc.procedure_name)} className="text-[10px] text-red-400 hover:text-red-600 font-bold">🗑️ 削除</button>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filtered.length === 0 && <div className="text-center py-12"><p className="text-gray-400 text-sm">該当する処置がありません</p></div>}
        <div className="text-center py-6"><p className="text-[10px] text-gray-400">procedure_master — {procedures.length}件 / 有効 {totalActive}件 / R06</p></div>
      </div>
    </div>
  );
}
