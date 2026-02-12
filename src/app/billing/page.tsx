"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { parseReceiptCSV, type ReceiptFile, type ReceiptPatient } from "@/lib/receipt-parser";

type BillingRow = {
  id: string; record_id: string; patient_id: string;
  total_points: number; patient_burden: number; insurance_claim: number; burden_ratio: number;
  procedures_detail: { code: string; name: string; points: number; category: string; count: number; note: string }[];
  ai_check_warnings: string[];
  claim_status: string; payment_status: string; created_at: string;
  patients: { name_kanji: string; name_kana: string; insurance_type: string; burden_ratio: number } | null;
};

type MainTab = "billing" | "receipt";

export default function BillingPage() {
  const [mainTab, setMainTab] = useState<MainTab>("billing");
  const [billings, setBillings] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BillingRow | null>(null);
  const [processing, setProcessing] = useState(false);
  const [receiptData, setReceiptData] = useState<ReceiptFile | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<ReceiptPatient | null>(null);
  const [receiptError, setReceiptError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadBillings();
    const ch = supabase.channel("billing-realtime").on("postgres_changes", { event: "*", schema: "public", table: "billing" }, () => loadBillings()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function loadBillings() {
    const todayStr = new Date().toISOString().split("T")[0];
    const { data, error } = await supabase.from("billing").select("*, patients(name_kanji, name_kana, insurance_type, burden_ratio)").gte("created_at", `${todayStr}T00:00:00`).order("created_at", { ascending: false });
    if (error) console.error("Billing fetch error:", error);
    if (data) setBillings(data as unknown as BillingRow[]);
    setLoading(false);
  }

  async function markPaid(billing: BillingRow) {
    const name = billing.patients?.name_kanji || "不明";
    if (!confirm(`${name} 様の会計を精算済みにしますか？\n患者負担額: ¥${billing.patient_burden.toLocaleString()}`)) return;
    setProcessing(true);
    await supabase.from("billing").update({ payment_status: "paid" }).eq("id", billing.id);
    const { data: rec } = await supabase.from("medical_records").select("appointment_id").eq("id", billing.record_id).single();
    if (rec?.appointment_id) await supabase.from("appointments").update({ status: "billing_done" }).eq("id", rec.appointment_id);
    await loadBillings(); setSelected(null); setProcessing(false);
  }

  function getName(b: BillingRow) { return b.patients?.name_kanji || "不明"; }
  function getKana(b: BillingRow) { return b.patients?.name_kana || ""; }
  function groupByCategory(items: BillingRow["procedures_detail"]) {
    const g: Record<string, typeof items> = {};
    (items || []).forEach(i => { if (!g[i.category]) g[i.category] = []; g[i.category].push(i); });
    return g;
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result as string;
        const data = parseReceiptCSV(text);
        setReceiptData(data);
        setSelectedReceipt(data.patients.length > 0 ? data.patients[0] : null);
      } catch (err) { setReceiptError(`パースエラー: ${err instanceof Error ? err.message : "不明"}`); }
    };
    reader.onerror = () => setReceiptError("ファイル読み込みに失敗しました");
    reader.readAsText(file, "Shift_JIS");
  }

  const unpaid = billings.filter(b => b.payment_status === "unpaid");
  const paid = billings.filter(b => b.payment_status === "paid");

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-full mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">💰 会計・レセコン</h1>
          </div>
          <div className="flex items-center gap-3">
            {mainTab === "billing" && (<><span className="bg-red-50 text-red-700 px-3 py-1 rounded-full text-xs font-bold">未精算 {unpaid.length}件</span><span className="bg-green-50 text-green-700 px-3 py-1 rounded-full text-xs font-bold">精算済 {paid.length}件</span></>)}
            {mainTab === "receipt" && receiptData && <span className="bg-sky-50 text-sky-700 px-3 py-1 rounded-full text-xs font-bold">{receiptData.patients.length}件のレセプト</span>}
          </div>
        </div>
        <div className="max-w-full mx-auto px-4 flex gap-0 border-t border-gray-100">
          {([{ key: "billing" as MainTab, label: "💰 本日の会計" }, { key: "receipt" as MainTab, label: "📄 レセ電ビューア" }]).map(t => (
            <button key={t.key} onClick={() => setMainTab(t.key)} className={`px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${mainTab === t.key ? "border-sky-500 text-sky-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</button>
          ))}
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-4">
        {mainTab === "billing" && (
          <div className="flex gap-4">
            <div className="flex-1">
              {unpaid.length > 0 && (<div className="mb-6"><h2 className="text-sm font-bold text-red-600 mb-2">🔴 会計待ち</h2><div className="space-y-2">{unpaid.map(b => (<button key={b.id} onClick={() => setSelected(b)} className={`w-full bg-white rounded-xl border-2 p-4 text-left transition-all hover:shadow-md ${selected?.id === b.id ? "border-sky-400 shadow-md" : "border-gray-200"}`}><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="bg-red-100 text-red-700 w-10 h-10 rounded-full flex items-center justify-center font-bold">{getName(b).charAt(0)}</div><div><p className="font-bold text-gray-900">{getName(b)}</p><p className="text-xs text-gray-400">{getKana(b)}</p></div></div><div className="text-right"><p className="text-2xl font-bold text-gray-900">¥{b.patient_burden.toLocaleString()}</p><p className="text-xs text-gray-400">{b.total_points.toLocaleString()}点 / {Math.round(b.burden_ratio * 10)}割負担</p></div></div></button>))}</div></div>)}
              {paid.length > 0 && (<div><h2 className="text-sm font-bold text-green-600 mb-2">✅ 本日の精算済み</h2><div className="space-y-1">{paid.map(b => (<button key={b.id} onClick={() => setSelected(b)} className={`w-full bg-white rounded-lg border p-3 text-left transition-all hover:bg-gray-50 ${selected?.id === b.id ? "border-sky-400" : "border-gray-100"}`}><div className="flex items-center justify-between"><div className="flex items-center gap-2"><span className="text-green-500">✅</span><span className="font-bold text-gray-700 text-sm">{getName(b)}</span></div><span className="text-sm font-bold text-gray-500">¥{b.patient_burden.toLocaleString()}</span></div></button>))}</div></div>)}
              {billings.length === 0 && <div className="text-center py-20"><p className="text-4xl mb-3">💰</p><p className="text-gray-400">本日の会計データはありません</p><p className="text-xs text-gray-300 mt-2">診察完了後に自動的に表示されます</p></div>}
            </div>
            {selected && (
              <div className="w-[420px] flex-shrink-0"><div className="bg-white rounded-xl border border-gray-200 shadow-lg sticky top-4 overflow-hidden">
                <div className="bg-gray-900 text-white p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-gray-400">患者名</p><p className="text-lg font-bold">{getName(selected)} 様</p></div><button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white">✕</button></div><div className="flex items-end justify-between mt-3"><div><p className="text-xs text-gray-400">合計点数</p><p className="text-3xl font-bold text-sky-400">{selected.total_points.toLocaleString()} <span className="text-sm">点</span></p></div><div className="text-right"><p className="text-xs text-gray-400">患者負担（{Math.round(selected.burden_ratio * 10)}割）</p><p className="text-2xl font-bold text-orange-400">¥{selected.patient_burden.toLocaleString()}</p></div></div></div>
                {selected.ai_check_warnings?.length > 0 && <div className="bg-amber-50 border-b border-amber-200 px-4 py-2"><p className="text-xs font-bold text-amber-700 mb-1">⚠️ AI算定チェック</p>{selected.ai_check_warnings.map((w, i) => <p key={i} className="text-xs text-amber-600">• {w}</p>)}</div>}
                <div className="p-4 max-h-[50vh] overflow-y-auto">{Object.entries(groupByCategory(selected.procedures_detail)).map(([cat, items]) => (<div key={cat} className="mb-4"><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 border-b border-gray-100 pb-1">{cat}</p>{items.map((item, idx) => (<div key={idx} className="flex items-center justify-between py-1.5"><div className="flex-1"><p className="text-sm font-bold text-gray-800">{item.name}</p><p className="text-[10px] text-gray-400">{item.code}{item.note ? ` · ${item.note}` : ""}</p></div><p className="text-sm font-bold text-gray-900 ml-3">{(item.points * item.count).toLocaleString()} <span className="text-[10px] text-gray-400">点</span></p></div>))}</div>))}</div>
                <div className="border-t border-gray-200 p-4 bg-gray-50"><div className="grid grid-cols-3 gap-2 mb-3 text-center"><div><p className="text-[10px] text-gray-400">合計点数</p><p className="text-lg font-bold text-gray-900">{selected.total_points.toLocaleString()}</p></div><div><p className="text-[10px] text-gray-400">{Math.round(selected.burden_ratio * 10)}割負担</p><p className="text-lg font-bold text-orange-600">¥{selected.patient_burden.toLocaleString()}</p></div><div><p className="text-[10px] text-gray-400">保険請求</p><p className="text-lg font-bold text-sky-600">¥{selected.insurance_claim.toLocaleString()}</p></div></div>
                  {selected.payment_status === "unpaid" ? <button onClick={() => markPaid(selected)} disabled={processing} className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200">{processing ? "処理中..." : "💰 精算完了"}</button> : <div className="text-center py-3 bg-green-100 rounded-xl"><p className="text-green-700 font-bold">✅ 精算済み</p></div>}
                </div>
              </div></div>
            )}
          </div>
        )}

        {mainTab === "receipt" && (
          <div>
            {!receiptData && (
              <div className="max-w-2xl mx-auto py-12">
                <div onClick={() => fileRef.current?.click()} className="border-2 border-dashed border-gray-300 rounded-2xl p-12 text-center cursor-pointer hover:border-sky-400 hover:bg-sky-50/30 transition-all">
                  <p className="text-5xl mb-4">📄</p>
                  <p className="text-lg font-bold text-gray-700">レセ電ファイルをアップロード</p>
                  <p className="text-sm text-gray-400 mt-2">CSV形式のレセプト電算ファイルを選択してください</p>
                  <p className="text-xs text-gray-300 mt-1">（UKE, CSV形式対応 / Shift_JIS, UTF-8対応）</p>
                  <input ref={fileRef} type="file" accept=".csv,.uke,.txt" onChange={handleFileUpload} className="hidden" />
                </div>
                {receiptError && <p className="text-red-600 text-sm mt-4 text-center">{receiptError}</p>}
              </div>
            )}
            {receiptData && (
              <div className="flex gap-4">
                <div className="w-[380px] flex-shrink-0 space-y-3">
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-700">🏥 医療機関情報</h3><button onClick={() => { setReceiptData(null); setSelectedReceipt(null); if (fileRef.current) fileRef.current.value = ""; }} className="text-xs text-gray-400 hover:text-red-500">✕ 閉じる</button></div>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between"><span className="text-gray-400">医療機関名</span><span className="font-bold text-gray-700">{receiptData.clinicName || "不明"}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">コード</span><span className="font-bold text-gray-700">{receiptData.clinicCode}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">請求年月</span><span className="font-bold text-gray-700">{receiptData.claimYearMonth}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">電話</span><span className="font-bold text-gray-700">{receiptData.phone}</span></div>
                      <div className="flex justify-between"><span className="text-gray-400">件数</span><span className="font-bold text-sky-600">{receiptData.patients.length}件</span></div>
                    </div>
                  </div>
                  <div><h3 className="text-xs font-bold text-gray-400 mb-2 px-1">患者一覧</h3>
                    <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
                      {receiptData.patients.map((p, idx) => (
                        <button key={idx} onClick={() => setSelectedReceipt(p)} className={`w-full text-left bg-white rounded-xl border p-3.5 transition-all hover:border-sky-300 hover:shadow-md ${selectedReceipt === p ? "border-sky-400 shadow-md bg-sky-50/30" : "border-gray-200"}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3"><div className="bg-gradient-to-br from-sky-100 to-sky-200 text-sky-700 w-10 h-10 rounded-full flex items-center justify-center font-bold flex-shrink-0">{p.name.charAt(0)}</div><div><p className="font-bold text-gray-900 text-sm">{p.name}</p><p className="text-[10px] text-gray-400">{p.sex} / {p.birthDate}</p></div></div>
                            <div className="text-right"><p className="font-bold text-gray-900 text-sm">{p.totalPoints.toLocaleString()}<span className="text-[10px] text-gray-400 ml-0.5">点</span></p><p className="text-[10px] text-gray-400">{p.insuranceType}</p></div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex-1">
                  {selectedReceipt ? (
                    <div className="space-y-4">
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        <div className="bg-gray-900 text-white p-4"><div className="flex items-center justify-between"><div><p className="text-xs text-gray-400">患者名</p><p className="text-xl font-bold">{selectedReceipt.name}</p><p className="text-xs text-gray-400">{selectedReceipt.nameKana}</p></div><div className="text-right"><p className="text-xs text-gray-400">合計点数</p><p className="text-3xl font-bold text-sky-400">{selectedReceipt.totalPoints.toLocaleString()}<span className="text-sm ml-1">点</span></p></div></div></div>
                        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div><p className="text-[10px] text-gray-400">性別</p><p className="text-sm font-bold text-gray-700">{selectedReceipt.sex}</p></div>
                          <div><p className="text-[10px] text-gray-400">生年月日</p><p className="text-sm font-bold text-gray-700">{selectedReceipt.birthDate}</p></div>
                          <div><p className="text-[10px] text-gray-400">保険種別</p><p className="text-sm font-bold text-gray-700">{selectedReceipt.insuranceType}</p></div>
                          <div><p className="text-[10px] text-gray-400">初診日</p><p className="text-sm font-bold text-gray-700">{selectedReceipt.firstVisitDate}</p></div>
                          <div><p className="text-[10px] text-gray-400">保険者番号</p><p className="text-sm font-bold text-gray-700">{selectedReceipt.insurerNumber || "—"}</p></div>
                          <div><p className="text-[10px] text-gray-400">記号</p><p className="text-sm font-bold text-gray-700">{selectedReceipt.insuredSymbol || "—"}</p></div>
                          <div><p className="text-[10px] text-gray-400">番号</p><p className="text-sm font-bold text-gray-700">{selectedReceipt.insuredNumber || "—"}</p></div>
                          {selectedReceipt.publicInsurer && <div><p className="text-[10px] text-gray-400">公費</p><p className="text-sm font-bold text-gray-700">{selectedReceipt.publicInsurer}</p></div>}
                        </div>
                      </div>
                      <div className="bg-white rounded-xl border border-gray-200 p-4"><h3 className="text-sm font-bold text-gray-700 mb-3">🔧 診療行為</h3>
                        {(() => { const g: Record<string, typeof selectedReceipt.procedures> = {}; selectedReceipt.procedures.forEach(p => { if (!g[p.categoryName]) g[p.categoryName] = []; g[p.categoryName].push(p); }); return Object.entries(g).map(([cat, procs]) => (<div key={cat} className="mb-4"><p className="text-xs font-bold text-sky-600 mb-2 border-b border-gray-100 pb-1">{cat}</p><div className="space-y-1">{procs.map((p, i) => (<div key={i} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50"><div className="flex-1"><div className="flex items-center gap-2"><span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{p.code}</span>{p.details.length > 0 && <span className="text-[10px] text-gray-400">{p.details.join(", ")}</span>}</div></div><div className="text-right ml-3"><span className="text-sm font-bold text-gray-900">{p.points.toLocaleString()}</span><span className="text-[10px] text-gray-400 ml-0.5">点</span>{p.count > 1 && <span className="text-[10px] text-gray-400 ml-1">×{p.count}</span>}</div></div>))}</div></div>)); })()}
                        {selectedReceipt.procedures.length === 0 && <p className="text-gray-400 text-sm text-center py-4">診療行為データなし</p>}
                      </div>
                      {selectedReceipt.comments.length > 0 && (<div className="bg-white rounded-xl border border-gray-200 p-4"><h3 className="text-sm font-bold text-gray-700 mb-3">💬 コメント</h3><div className="space-y-2">{selectedReceipt.comments.map((c, i) => (<div key={i} className="bg-gray-50 rounded-lg p-3"><span className="text-xs font-mono text-gray-400 mr-2">{c.code}</span><span className="text-sm text-gray-700">{c.text}</span></div>))}</div></div>)}
                      {selectedReceipt.returns.length > 0 && (<div className="bg-red-50 rounded-xl border border-red-200 p-4"><h3 className="text-sm font-bold text-red-700 mb-3">⚠️ 返戻情報</h3><div className="space-y-2">{selectedReceipt.returns.map((r, i) => (<div key={i} className="bg-white rounded-lg p-3 border border-red-100"><p className="text-xs text-red-400 mb-1">請求年月: {r.yearMonth}</p><p className="text-sm text-red-700">{r.reason}</p></div>))}</div></div>)}
                    </div>
                  ) : <div className="h-full flex items-center justify-center py-20"><div className="text-center"><p className="text-5xl mb-3">📄</p><p className="text-gray-400">左から患者を選択してください</p></div></div>}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
