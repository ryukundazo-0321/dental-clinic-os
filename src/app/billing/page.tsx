"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type BillingRow = {
  id: string; record_id: string; patient_id: string;
  total_points: number; patient_burden: number; insurance_claim: number; burden_ratio: number;
  procedures_detail: { code: string; name: string; points: number; category: string; count: number; note: string; tooth_numbers?: string[] }[];
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
  const [receiptMonth, setReceiptMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [receiptStatus, setReceiptStatus] = useState<string>("");
  const [generating, setGenerating] = useState(false);

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

  function printReceipt(billing: BillingRow) {
    const name = billing.patients?.name_kanji || "不明";
    const kana = billing.patients?.name_kana || "";
    const insType = billing.patients?.insurance_type || "";
    const burdenPct = Math.round(billing.burden_ratio * 10);
    const dateStr = new Date(billing.created_at).toLocaleDateString("ja-JP");
    const procs = billing.procedures_detail || [];

    // 厚労省歯科領収証の法定区分にマッピング
    // fee_masterのcategoryとcodeから自動判定

    // fee_masterのcategoryからの自動マッピング
    function mapToReceiptCategory(item: { category: string; code: string; name: string }): string {
      const cat = (item.category || "").toLowerCase();
      const code = (item.code || "").toUpperCase();
      // 初・再診料
      if (code.startsWith("A0") || code === "A001-A" || code === "A001-B" || code === "A002") return "初・再診料";
      // 医学管理等
      if (code.startsWith("B-") || cat.includes("医学管理")) return "医学管理等";
      // 歯冠修復及び欠損補綴（M-, BR-, DEN- を検査/投薬より先に判定）
      if (code.startsWith("M-") || code.startsWith("M0") || code.startsWith("BR-") || code.startsWith("DEN-") || cat.includes("歯冠") || cat.includes("ブリッジ") || cat.includes("有床義歯") || cat.includes("補綴")) return "歯冠修復及び欠損補綴";
      // 検査（D始まりだがDEN-は上で除外済み、DEBONDも除外）
      if ((code.startsWith("D") && !code.startsWith("DE")) || cat.includes("検査")) return "検査";
      // 画像診断
      if (code.startsWith("E") || cat.includes("画像")) return "画像診断";
      // 投薬（F-COATは処置なので除外）
      if (code.startsWith("F-") && code !== "F-COAT") return "投薬";
      if (cat.includes("投薬")) return "投薬";
      // 注射
      if (cat.includes("注射")) return "注射";
      // 手術（J0, OPE, PE- を処置より先に判定）
      if (code.startsWith("J0") || cat.includes("口腔外科") || code.startsWith("OPE") || code.startsWith("PE-")) return "手術";
      // 麻酔
      if (code.startsWith("K0") || cat.includes("麻酔")) return "麻酔";
      // 処置（I0, sc, srp, その他）
      if (code.startsWith("I0") || code.startsWith("I011") || code === "SC" || code === "SRP") return "処置";
      // 在宅
      if (cat.includes("在宅") || code.startsWith("VISIT")) return "在宅医療";
      // 自費
      if (cat.includes("自費")) return "保険外（自費）";
      // デフォルト: 処置（DEBOND, PCEM, PERIO-FIX, SEALANT, F-COAT等）
      return "処置";
    }

    // 区分ごとに集計
    const catPoints: Record<string, number> = {};
    const catItems: Record<string, typeof procs> = {};
    for (let i = 0; i < procs.length; i++) {
      const item = procs[i];
      const cat = mapToReceiptCategory(item);
      if (!catPoints[cat]) catPoints[cat] = 0;
      if (!catItems[cat]) catItems[cat] = [];
      catPoints[cat] += item.points * item.count;
      catItems[cat].push(item);
    }

    // 領収証（上段）の区分行
    const receiptOrder = ["初・再診料","医学管理等","在宅医療","検査","画像診断","投薬","注射","リハビリテーション","処置","手術","麻酔","放射線治療","歯冠修復及び欠損補綴","歯科矯正","病理診断"];
    const receiptRows = receiptOrder.map(cat =>
      `<tr><td style="padding:3px 6px;font-size:11px;border:1px solid #999;">${cat}</td><td style="text-align:right;padding:3px 8px;font-size:11px;border:1px solid #999;">${catPoints[cat] ? catPoints[cat].toLocaleString() : ""}</td><td style="text-align:center;font-size:11px;border:1px solid #999;">点</td></tr>`
    ).join("");

    // 明細書（下段）の詳細行
    const detailRows = Object.entries(catItems).map(([cat, items]) =>
      `<tr><td colspan="4" style="background:#f0f0f0;font-weight:bold;padding:4px 6px;font-size:10px;border:1px solid #999;">${cat}</td></tr>` +
      items.map(item =>
        `<tr><td style="padding:2px 6px;font-size:10px;border:1px solid #ddd;">${item.name}${item.tooth_numbers && item.tooth_numbers.length > 0 ? " ("+item.tooth_numbers.map((t: string) => "#"+t).join(",")+")" : ""}</td><td style="text-align:center;font-size:10px;border:1px solid #ddd;">${item.count}</td><td style="text-align:right;font-size:10px;border:1px solid #ddd;">${item.points}</td><td style="text-align:right;font-size:10px;border:1px solid #ddd;">${(item.points * item.count).toLocaleString()}</td></tr>`
      ).join("")
    ).join("");

    const totalMedical = billing.total_points * 10;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>領収証 兼 診療明細書</title>
<style>
  @media print { body { margin: 0; padding: 10px; } .no-print { display: none !important; } @page { size: A4; margin: 10mm; } }
  body { font-family: "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif; max-width: 700px; margin: 10px auto; color: #333; font-size: 11px; }
  h2 { font-size: 16px; text-align: center; margin: 0 0 8px 0; padding: 6px; border: 2px solid #333; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 8px; }
  .meta td { padding: 2px 6px; font-size: 11px; }
  table.receipt { width: 100%; border-collapse: collapse; }
  .section-title { font-size: 12px; font-weight: bold; margin: 12px 0 4px 0; border-bottom: 1px solid #333; padding-bottom: 2px; }
  .total-box { border: 2px solid #333; padding: 8px; margin-top: 8px; }
  .total-box td { padding: 3px 6px; font-size: 12px; }
  .total-box .big { font-size: 18px; font-weight: bold; }
  .footer { font-size: 9px; color: #666; text-align: center; margin-top: 12px; border-top: 1px solid #ccc; padding-top: 6px; }
  .stamp { display: inline-block; width: 50px; height: 50px; border: 1.5px solid #aaa; border-radius: 50%; text-align: center; line-height: 50px; font-size: 9px; color: #aaa; float: right; margin-top: -40px; }
  .page-break { page-break-before: always; }
</style></head><body>

<div class="no-print" style="text-align:center;margin-bottom:12px;">
  <button onclick="window.print()" style="padding:8px 24px;font-size:14px;background:#333;color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨️ 印刷する</button>
  <button onclick="window.close()" style="padding:8px 16px;font-size:12px;background:#eee;border:none;border-radius:6px;cursor:pointer;margin-left:8px;">閉じる</button>
</div>

<!-- ===== 領収証 ===== -->
<h2>領 収 証</h2>
<table style="width:100%;margin-bottom:8px;">
  <tr>
    <td style="font-size:14px;"><b>${name}</b> 様</td>
    <td style="text-align:right;font-size:11px;">診療日: ${dateStr}</td>
  </tr>
  <tr>
    <td style="font-size:10px;color:#666;">${kana}</td>
    <td style="text-align:right;font-size:10px;">保険: ${insType || "社保"} ／ ${burdenPct}割</td>
  </tr>
</table>

<table class="receipt">
  <thead><tr>
    <th style="text-align:left;padding:4px 6px;border:1px solid #999;background:#eee;width:60%;">区 分</th>
    <th style="text-align:right;padding:4px 6px;border:1px solid #999;background:#eee;width:30%;">点 数</th>
    <th style="text-align:center;padding:4px 6px;border:1px solid #999;background:#eee;width:10%;"></th>
  </tr></thead>
  <tbody>${receiptRows}</tbody>
</table>

<table class="total-box" style="width:100%;border-collapse:collapse;">
  <tr><td>合計点数</td><td style="text-align:right;">${billing.total_points.toLocaleString()} 点</td></tr>
  <tr><td>保険医療費（10円×点数）</td><td style="text-align:right;">¥${totalMedical.toLocaleString()}</td></tr>
  <tr><td>保険者負担</td><td style="text-align:right;">¥${billing.insurance_claim.toLocaleString()}</td></tr>
  <tr style="border-top:2px solid #333;"><td class="big">患者負担額（${burdenPct}割）</td><td style="text-align:right;" class="big">¥${billing.patient_burden.toLocaleString()}</td></tr>
</table>
<div class="stamp">収納印</div>

<!-- ===== 診療明細書 ===== -->
<div class="page-break"></div>
<h2>診 療 明 細 書</h2>
<table style="width:100%;margin-bottom:6px;">
  <tr><td><b>${name}</b> 様</td><td style="text-align:right;">診療日: ${dateStr}</td></tr>
</table>

<table class="receipt">
  <thead><tr>
    <th style="text-align:left;padding:3px 6px;border:1px solid #999;background:#eee;">項 目</th>
    <th style="text-align:center;padding:3px 6px;border:1px solid #999;background:#eee;width:40px;">回数</th>
    <th style="text-align:right;padding:3px 6px;border:1px solid #999;background:#eee;width:50px;">点数</th>
    <th style="text-align:right;padding:3px 6px;border:1px solid #999;background:#eee;width:60px;">小計</th>
  </tr></thead>
  <tbody>${detailRows}</tbody>
</table>

<table class="total-box" style="width:100%;border-collapse:collapse;">
  <tr><td class="big">合計</td><td style="text-align:right;" class="big">${billing.total_points.toLocaleString()} 点</td></tr>
</table>

<div class="footer">
  <p>この領収証は医療費控除の申告にご使用いただけます。再発行はいたしかねますので大切に保管してください。</p>
  <p>発行日: ${new Date().toLocaleDateString("ja-JP")}</p>
</div>
</body></html>`;

    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
    }
  }

  function getName(b: BillingRow) { return b.patients?.name_kanji || "不明"; }
  function getKana(b: BillingRow) { return b.patients?.name_kana || ""; }
  function groupByCategory(items: BillingRow["procedures_detail"]) {
    const g: Record<string, typeof items> = {};
    (items || []).forEach(i => { if (!g[i.category]) g[i.category] = []; g[i.category].push(i); });
    return g;
  }

  async function generateReceipt() {
    setGenerating(true); setReceiptStatus("");
    try {
      const ym = receiptMonth.replace("-", "");
      const res = await fetch("/api/receipt-generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yearMonth: ym }) });
      const data = await res.json();
      if (!res.ok) { setReceiptStatus(`❌ ${data.error}`); setGenerating(false); return; }
      // CSVダウンロード
      const blob = new Blob([data.csv], { type: "text/csv;charset=Shift_JIS" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `receipt_${ym}.csv`; a.click();
      URL.revokeObjectURL(url);
      setReceiptStatus(`✅ ${data.receiptCount}件 / ${data.totalPoints.toLocaleString()}点 ダウンロード完了`);
    } catch (e) { setReceiptStatus(`❌ ${e instanceof Error ? e.message : "エラー"}`); }
    setGenerating(false);
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
            {mainTab === "receipt" && receiptStatus && <span className="bg-sky-50 text-sky-700 px-3 py-1 rounded-full text-xs font-bold">レセ電生成</span>}
          </div>
        </div>
        <div className="max-w-full mx-auto px-4 flex gap-0 border-t border-gray-100">
          {([{ key: "billing" as MainTab, label: "💰 本日の会計" }, { key: "receipt" as MainTab, label: "📄 レセ電ダウンロード" }]).map(t => (
            <button key={t.key} onClick={() => setMainTab(t.key)} className={`px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${mainTab === t.key ? "border-sky-500 text-sky-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>{t.label}</button>
          ))}
          <Link href="/receipt-check" className="px-5 py-2.5 text-sm font-bold border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition-colors">🔍 レセプトチェック</Link>
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
                <div className="p-4 max-h-[50vh] overflow-y-auto">{Object.entries(groupByCategory(selected.procedures_detail)).map(([cat, items]) => (<div key={cat} className="mb-4"><p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 border-b border-gray-100 pb-1">{cat}</p>{items.map((item, idx) => (<div key={idx} className="flex items-center justify-between py-1.5"><div className="flex-1"><p className="text-sm font-bold text-gray-800">{item.name}</p><p className="text-[10px] text-gray-400">{item.code}{item.note ? ` · ${item.note}` : ""}{item.tooth_numbers && item.tooth_numbers.length > 0 ? ` · 🦷${item.tooth_numbers.map(t => `#${t}`).join(",")}` : ""}</p></div><p className="text-sm font-bold text-gray-900 ml-3">{(item.points * item.count).toLocaleString()} <span className="text-[10px] text-gray-400">点</span></p></div>))}</div>))}</div>
                <div className="border-t border-gray-200 p-4 bg-gray-50"><div className="grid grid-cols-3 gap-2 mb-3 text-center"><div><p className="text-[10px] text-gray-400">合計点数</p><p className="text-lg font-bold text-gray-900">{selected.total_points.toLocaleString()}</p></div><div><p className="text-[10px] text-gray-400">{Math.round(selected.burden_ratio * 10)}割負担</p><p className="text-lg font-bold text-orange-600">¥{selected.patient_burden.toLocaleString()}</p></div><div><p className="text-[10px] text-gray-400">保険請求</p><p className="text-lg font-bold text-sky-600">¥{selected.insurance_claim.toLocaleString()}</p></div></div>
                  {selected.payment_status === "unpaid" ? <button onClick={() => markPaid(selected)} disabled={processing} className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200">{processing ? "処理中..." : "💰 精算完了"}</button> : <><div className="text-center py-3 bg-green-100 rounded-xl"><p className="text-green-700 font-bold">✅ 精算済み</p></div><button onClick={() => printReceipt(selected)} className="w-full mt-2 bg-gray-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-gray-700">🖨️ 領収書・明細書を印刷</button></>}
                </div>
              </div></div>
            )}
          </div>
        )}

        {mainTab === "receipt" && (
          <div className="max-w-2xl mx-auto py-8">
            <div className="bg-white rounded-2xl border border-gray-200 p-8">
              <div className="text-center mb-6">
                <p className="text-5xl mb-3">📄</p>
                <h2 className="text-xl font-bold text-gray-900">レセ電ファイル生成</h2>
                <p className="text-sm text-gray-400 mt-1">指定月の精算済みデータからレセ電CSVを生成・ダウンロードします</p>
              </div>
              <div className="flex items-center gap-4 justify-center mb-6">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">請求年月</label>
                  <input type="month" value={receiptMonth} onChange={e => setReceiptMonth(e.target.value)} className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                </div>
                <div className="pt-5">
                  <button onClick={generateReceipt} disabled={generating} className="bg-sky-600 text-white px-8 py-2.5 rounded-lg text-sm font-bold hover:bg-sky-700 disabled:opacity-50 shadow-lg shadow-sky-200">
                    {generating ? "⏳ 生成中..." : "📄 レセ電CSV生成・ダウンロード"}
                  </button>
                </div>
              </div>
              {receiptStatus && (
                <div className={`text-center p-4 rounded-xl text-sm font-bold ${receiptStatus.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{receiptStatus}</div>
              )}
              <div className="mt-6 bg-gray-50 rounded-xl p-4">
                <h3 className="text-xs font-bold text-gray-500 mb-2">📋 生成されるファイルについて</h3>
                <div className="space-y-1 text-xs text-gray-400">
                  <p>• 厚労省レセプト電算処理フォーマット（CSV）で出力されます</p>
                  <p>• 対象: 指定月の「精算済み」会計データのみ</p>
                  <p>• IR, RE, HO, KO, SN, JD, MF, SS, GO レコードを生成</p>
                  <p>• 患者の保険証情報は電子カルテの「🏥 保険証情報」で登録してください</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
