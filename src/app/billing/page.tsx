"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type BillingRow = {
  id: string; record_id: string; patient_id: string;
  total_points: number; patient_burden: number; insurance_claim: number; burden_ratio: number;
  procedures_detail: { code: string; name: string; points: number; category: string; count: number; note: string; tooth_numbers?: string[] }[];
  ai_check_warnings: string[];
  document_provided: boolean;
  claim_status: string; payment_status: string; created_at: string; notes?: string;
  patients: { name_kanji: string; name_kana: string; insurance_type: string; burden_ratio: number } | null;
};

type MainTab = "billing" | "unpaid_all" | "receipt" | "estimate";

function getTodayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
}

export default function BillingPage() {
  const [mainTab, setMainTab] = useState<MainTab>("billing");
  const [billings, setBillings] = useState<BillingRow[]>([]);
  const [allUnpaid, setAllUnpaid] = useState<BillingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BillingRow | null>(null);
  const [processing, setProcessing] = useState(false);
  const [showEstimate, setShowEstimate] = useState(false);
  const [paidPatientInfo, setPaidPatientInfo] = useState<{ patientId: string; name: string } | null>(null);
  const [selectedDate, setSelectedDate] = useState(getTodayJST);
  const [receiptMonth, setReceiptMonth] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [receiptStatus, setReceiptStatus] = useState<string>("");
  const [generating, setGenerating] = useState(false);

  const loadBillings = useCallback(async () => {
    const { data } = await supabase.from("billing")
      .select("*, patients(name_kanji, name_kana, insurance_type, burden_ratio)")
      .gte("created_at", `${selectedDate}T00:00:00+00`).lte("created_at", `${selectedDate}T23:59:59+00`)
      .order("created_at", { ascending: false });
    if (data) setBillings(data as unknown as BillingRow[]);
    setLoading(false);
  }, [selectedDate]);

  async function loadAllUnpaid() {
    const { data } = await supabase.from("billing")
      .select("*, patients(name_kanji, name_kana, insurance_type, burden_ratio)")
      .eq("payment_status", "unpaid")
      .order("created_at", { ascending: false });
    if (data) setAllUnpaid(data as unknown as BillingRow[]);
  }

  useEffect(() => {
    loadBillings();
    loadAllUnpaid();
    const ch = supabase.channel("billing-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "billing" }, () => { loadBillings(); loadAllUnpaid(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [loadBillings]);

  async function markPaid(billing: BillingRow) {
    const name = billing.patients?.name_kanji || "不明";
    if (!confirm(`${name} 様の会計を精算済みにしますか？\n患者負担額: ¥${billing.patient_burden.toLocaleString()}`)) return;
    setProcessing(true);
    await supabase.from("billing").update({ payment_status: "paid" }).eq("id", billing.id);
    const { data: rec } = await supabase.from("medical_records").select("appointment_id").eq("id", billing.record_id).single();
    if (rec?.appointment_id) await supabase.from("appointments").update({ status: "billing_done" }).eq("id", rec.appointment_id);
    setPaidPatientInfo({ patientId: billing.patient_id, name });
    await loadBillings(); await loadAllUnpaid(); setSelected(null); setProcessing(false);
    // 精算完了後に自動で領収書印刷
    printReceipt(billing);
  }

  async function toggleDocumentProvided(billing: BillingRow) {
    const newVal = !billing.document_provided;
    await supabase.from("billing").update({ document_provided: newVal }).eq("id", billing.id);
    setBillings(prev => prev.map(b => b.id === billing.id ? { ...b, document_provided: newVal } : b));
    if (selected?.id === billing.id) setSelected({ ...billing, document_provided: newVal });
  }

  function printReceipt(billing: BillingRow) {
    const name = billing.patients?.name_kanji || "不明";
    const kana = billing.patients?.name_kana || "";
    const insType = billing.patients?.insurance_type || "";
    const burdenPct = Math.round(billing.burden_ratio * 10);
    const dateStr = new Date(billing.created_at).toLocaleDateString("ja-JP");
    const procs = billing.procedures_detail || [];

    function mapToReceiptCategory(item: { category: string; code: string; name: string }): string {
      const cat = (item.category || "").toLowerCase();
      const code = (item.code || "").toUpperCase();
      if (code.startsWith("A0") || code === "A001-A" || code === "A001-B" || code === "A002") return "初・再診料";
      if (code.startsWith("B-") || cat.includes("医学管理")) return "医学管理等";
      if (code.startsWith("M-") || code.startsWith("M0") || code.startsWith("BR-") || code.startsWith("DEN-") || cat.includes("歯冠") || cat.includes("ブリッジ") || cat.includes("有床義歯") || cat.includes("補綴")) return "歯冠修復及び欠損補綴";
      if ((code.startsWith("D") && !code.startsWith("DE")) || cat.includes("検査")) return "検査";
      if (code.startsWith("E") || cat.includes("画像")) return "画像診断";
      if (code.startsWith("F-") && code !== "F-COAT") return "投薬";
      if (cat.includes("投薬")) return "投薬";
      if (cat.includes("注射")) return "注射";
      if (code.startsWith("J0") || cat.includes("口腔外科") || code.startsWith("OPE") || code.startsWith("PE-")) return "手術";
      if (code.startsWith("K0") || cat.includes("麻酔")) return "麻酔";
      if (code.startsWith("I0") || code.startsWith("I011") || code === "SC" || code === "SRP") return "処置";
      if (cat.includes("在宅") || code.startsWith("VISIT")) return "在宅医療";
      if (cat.includes("自費")) return "保険外（自費）";
      return "処置";
    }

    const catPoints: Record<string, number> = {};
    const catItems: Record<string, typeof procs> = {};
    for (let i = 0; i < procs.length; i++) {
      const item = procs[i];
      const catName = mapToReceiptCategory(item);
      if (!catPoints[catName]) catPoints[catName] = 0;
      if (!catItems[catName]) catItems[catName] = [];
      catPoints[catName] += item.points * item.count;
      catItems[catName].push(item);
    }

    const totalMedical = billing.total_points * 10;
    const patientId = billing.patient_id?.slice(-4) || "";
    const todayStr = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit" });
    const dateYMD = new Date(billing.created_at);
    const diagDate = `${dateYMD.getFullYear()}年${String(dateYMD.getMonth()+1).padStart(2,"0")}月${String(dateYMD.getDate()).padStart(2,"0")}日`;

    const row1 = ["初・再診料","医学管理等","在宅医療","検査","画像診断","投薬","注射","リハビリテーション"];
    const row2 = ["処置","手術","麻酔","歯冠修復及び欠損補綴","歯科矯正","病理診断","その他","介護"];

    const mkCells = (cats: string[]) => cats.map(c => `<td class="lb">${c}</td>`).join("");
    const mkVals = (cats: string[]) => cats.map(c =>
      `<td class="vl">${catPoints[c] ? `<b>${catPoints[c]}</b><span class="u">点</span>` : `<span class="u">点</span>`}</td>`
    ).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>領収書</title>
<style>
@media print{.no-print{display:none!important;}@page{size:A4;margin:8mm;}}
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:"Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif;max-width:700px;margin:0 auto;color:#111;font-size:11px;padding:10px;}
h1{font-size:20px;text-align:center;letter-spacing:10px;margin:10px 0 14px;font-weight:800;}
table{border-collapse:collapse;width:100%;}
.bx td,.bx th{border:1.5px solid #111;padding:4px 6px;font-size:11px;}
.bx .hd{background:#f5f5f5;font-size:10px;text-align:center;font-weight:600;}
.bx .vb{font-size:16px;font-weight:800;text-align:center;}
.pt td{padding:0;}
.pt .lb{border:1px solid #111;border-top:none;font-size:9px;text-align:center;padding:2px 3px;font-weight:600;color:#333;}
.pt .vl{border:1px solid #111;text-align:right;padding:4px 6px;min-width:60px;font-size:14px;}
.pt .vl b{font-size:17px;}
.pt .vl .u{font-size:8px;margin-left:2px;}
.sm{font-size:9px;color:#555;}
.tot td{border:1.5px solid #111;padding:5px 8px;font-size:12px;}
.tot .bg{font-size:20px;font-weight:900;}
.tot .bk{background:#111;color:#fff;font-weight:700;font-size:12px;}
.stamp{width:55px;height:55px;border:1.5px solid #111;display:inline-flex;align-items:center;justify-content:center;font-size:9px;color:#999;}
</style></head><body>
<div class="no-print" style="text-align:center;margin-bottom:14px;">
<button onclick="window.print()" style="padding:10px 28px;font-size:14px;background:#111;color:#fff;border:none;border-radius:6px;cursor:pointer;">🖨️ 印刷する</button>
<button onclick="window.close()" style="padding:10px 18px;font-size:12px;background:#eee;border:none;border-radius:6px;cursor:pointer;margin-left:8px;">閉じる</button>
</div>

<h1>領 収 書</h1>

<!-- 患者情報 -->
<table class="bx" style="margin-bottom:8px;">
<tr><td class="hd" style="width:15%;">患者ID</td><td style="width:20%;text-align:center;">${patientId}</td><td class="hd" style="width:10%;">氏名</td><td style="width:25%;text-align:center;font-size:14px;font-weight:700;">${name} 様</td><td class="hd" style="width:12%;">領収書番号</td><td style="width:18%;text-align:center;font-size:12px;font-weight:700;">${todayStr}</td></tr>
</table>

<!-- 費用区分 -->
<table class="bx" style="margin-bottom:8px;">
<tr><td class="hd" style="width:14%;">費用区分</td><td class="hd" style="width:12%;">負担率</td><td class="hd" style="width:10%;">本・家</td><td class="hd" style="width:10%;">区分</td><td class="hd">介護負担率</td><td class="hd" style="width:30%;">診療日（期間）</td></tr>
<tr><td class="vb">${insType||"社保"}</td><td class="vb">${burdenPct}割</td><td class="vb">本人</td><td></td><td></td><td class="vb" style="font-size:14px;">${diagDate}</td></tr>
</table>

<!-- 保険点数 -->
<div style="font-size:11px;font-weight:700;margin-bottom:2px;">保険・介護</div>
<table class="pt">
<tr>${mkCells(row1)}</tr>
<tr>${mkVals(row1)}</tr>
<tr>${mkCells(row2)}</tr>
<tr>${mkVals(row2)}</tr>
</table>

<!-- 合計 -->
<div style="display:flex;gap:10px;margin-top:10px;">
<div style="flex:1;">
<div style="font-size:11px;font-weight:700;margin-bottom:2px;">保険外負担</div>
<table class="bx"><tr><td class="hd">自費療養</td><td class="hd">その他</td></tr><tr><td class="vb">0<span style="font-size:9px;">円</span></td><td class="vb">0<span style="font-size:9px;">円</span></td></tr><tr><td class="hd">(内訳)</td><td class="hd">(内訳)</td></tr><tr><td style="height:30px;"></td><td></td></tr></table>
</div>
<div style="flex:1.2;">
<table class="tot">
<tr><td class="hd" style="width:25%;"></td><td class="hd">保険</td><td class="hd">介護</td><td class="hd">保険外負担</td></tr>
<tr><td class="hd">合計</td><td style="text-align:right;font-weight:800;font-size:16px;">${billing.total_points.toLocaleString()}<span style="font-size:9px;">点</span></td><td style="text-align:right;">0<span style="font-size:9px;">単位</span></td><td></td></tr>
<tr><td class="hd">負担額</td><td style="text-align:right;font-weight:800;font-size:16px;">${billing.patient_burden.toLocaleString()}<span style="font-size:9px;">円</span></td><td style="text-align:right;">0<span style="font-size:9px;">円</span></td><td style="text-align:right;">0<span style="font-size:9px;">円</span></td></tr>
</table>
<table class="tot" style="margin-top:4px;">
<tr><td class="bk">領収金額</td><td style="text-align:right;"><span class="bg">${billing.patient_burden.toLocaleString()}</span><span style="font-size:10px;margin-left:4px;">円</span></td></tr>
</table>
</div>
</div>

<!-- フッター -->
<div style="display:flex;justify-content:space-between;margin-top:16px;font-size:9px;color:#555;">
<div>
<p>※厚生労働省が定める診療報酬や薬価等には、医療機関が</p>
<p>　仕入れ時に負担する消費税が反映されています。</p>
<p style="margin-top:4px;">この領収書の再発行はできませんので大切に保管してください。</p>
<p>印紙税法第5条の規定により収入印紙不要</p>
</div>
<div style="text-align:right;">
<p style="font-size:12px;font-weight:700;">Forever Dental Clinic</p>
<p>疋田　久登</p>
<p>愛知県安城市篠目町竜田108-1</p>
<p>TEL:0566-95-5000</p>
<div class="stamp" style="margin-top:4px;">領収印</div>
</div>
</div>

<!-- 備考欄 -->
<div style="border:1px solid #111;border-radius:4px;padding:8px;margin-top:8px;font-size:10px;">
<span style="font-size:9px;color:#999;">（備考）</span>
</div>

</body></html>`;
    const pw = window.open("", "_blank"); if (pw) { pw.document.write(html); pw.document.close(); }
  }

  function getName(b: BillingRow) { return b.patients?.name_kanji || "不明"; }
  function getKana(b: BillingRow) { return b.patients?.name_kana || ""; }
  function formatDateShort(d: string) { const m = d.match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}` : d; }
  function groupByCategory(items: BillingRow["procedures_detail"]) {
    const g: Record<string, typeof items> = {};
    (items || []).forEach(i => { if (!g[i.category]) g[i.category] = []; g[i.category].push(i); });
    return g;
  }

  function goToday() { setSelectedDate(getTodayJST()); }
  function goPrev() { const d = new Date(selectedDate + "T12:00:00"); d.setDate(d.getDate() - 1); setSelectedDate(d.toISOString().split("T")[0]); }
  function goNext() { const d = new Date(selectedDate + "T12:00:00"); d.setDate(d.getDate() + 1); setSelectedDate(d.toISOString().split("T")[0]); }

  async function generateReceipt() {
    setGenerating(true); setReceiptStatus("");
    try {
      const ym = receiptMonth.replace("-", "");
      const res = await fetch("/api/receipt-generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ yearMonth: ym, format: "uke" }) });
      if (!res.ok) { const data = await res.json(); setReceiptStatus(`❌ ${data.error}`); setGenerating(false); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `receipt_${ym}.UKE`; a.click();
      URL.revokeObjectURL(url);
      setReceiptStatus(`✅ ダウンロード完了（Shift_JIS / .UKE形式）`);
    } catch (e) { setReceiptStatus(`❌ ${e instanceof Error ? e.message : "エラー"}`); }
    setGenerating(false);
  }

  const unpaid = billings.filter(b => b.payment_status === "unpaid");
  const paid = billings.filter(b => b.payment_status === "paid");
  const isToday = selectedDate === getTodayJST();

  if (loading) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;

  // 詳細パネル（共通）
  function DetailPanel({ bill }: { bill: BillingRow }) {
    return (
      <div className="w-[420px] flex-shrink-0">
        <div className="bg-white rounded-xl border border-gray-200 shadow-lg sticky top-4 overflow-hidden">
          <div className="bg-gray-900 text-white p-4">
            <div className="flex items-center justify-between">
              <div><p className="text-xs text-gray-400">患者名</p><p className="text-lg font-bold">{getName(bill)} 様</p></div>
              <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white">✕</button>
            </div>
            <div className="flex items-end justify-between mt-3">
              <div><p className="text-xs text-gray-400">合計点数</p><p className="text-3xl font-bold text-sky-400">{bill.total_points.toLocaleString()} <span className="text-sm">点</span></p></div>
              <div className="text-right"><p className="text-xs text-gray-400">患者負担（{Math.round(bill.burden_ratio * 10)}割）</p><p className="text-2xl font-bold text-orange-400">¥{bill.patient_burden.toLocaleString()}</p></div>
            </div>
          </div>
          {bill.ai_check_warnings?.length > 0 && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
              <p className="text-xs font-bold text-amber-700 mb-1">⚠️ AI算定チェック</p>
              {bill.ai_check_warnings.map((w, i) =>
                w.includes("管理計画書") ? (
                  <div key={i} className={`flex items-center gap-2 py-1 ${bill.document_provided ? "opacity-50" : ""}`}>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input type="checkbox" checked={bill.document_provided || false} onChange={() => toggleDocumentProvided(bill)} className="rounded border-amber-400" />
                      <span className={`text-xs ${bill.document_provided ? "text-green-600 line-through" : "text-amber-600"}`}>{bill.document_provided ? "✅ 管理計画書を提供済み" : w}</span>
                    </label>
                    {!bill.document_provided && <Link href={`/management-plan?patient_id=${bill.patient_id}`} className="text-[10px] text-sky-600 underline hover:text-sky-800">📄 作成</Link>}
                  </div>
                ) : <p key={i} className="text-xs text-amber-600">• {w}</p>
              )}
            </div>
          )}
          <div className="p-4 max-h-[50vh] overflow-y-auto">
            {Object.entries(groupByCategory(bill.procedures_detail)).map(([cat, items]) => (
              <div key={cat} className="mb-4">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 border-b border-gray-100 pb-1">{cat}</p>
                {items.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1.5">
                    <div className="flex-1">
                      <p className="text-sm font-bold text-gray-800">{item.name}</p>
                      <p className="text-[10px] text-gray-400">{item.code}{item.note ? ` · ${item.note}` : ""}{item.tooth_numbers && item.tooth_numbers.length > 0 ? ` · 🦷${item.tooth_numbers.map(t => `#${t}`).join(",")}` : ""}</p>
                    </div>
                    <p className="text-sm font-bold text-gray-900 ml-3">{(item.points * item.count).toLocaleString()} <span className="text-[10px] text-gray-400">点</span></p>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="border-t border-gray-200 p-4 bg-gray-50">
            <div className="grid grid-cols-3 gap-2 mb-3 text-center">
              <div><p className="text-[10px] text-gray-400">合計点数</p><p className="text-lg font-bold text-gray-900">{bill.total_points.toLocaleString()}</p></div>
              <div><p className="text-[10px] text-gray-400">{Math.round(bill.burden_ratio * 10)}割負担</p><p className="text-lg font-bold text-orange-600">¥{bill.patient_burden.toLocaleString()}</p></div>
              <div><p className="text-[10px] text-gray-400">保険請求</p><p className="text-lg font-bold text-sky-600">¥{bill.insurance_claim.toLocaleString()}</p></div>
            </div>
            {bill.payment_status === "unpaid" ? (
              <div className="space-y-2">
                <button onClick={() => markPaid(bill)} disabled={processing} className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200">
                  {processing ? "処理中..." : "💰 精算完了（一括）"}
                </button>
                {/* 分割払い */}
                <button onClick={async () => {
                  const amountStr = prompt(`分割払い: 本日のお支払い額を入力してください\n（残高: ¥${bill.patient_burden.toLocaleString()}）`, String(Math.ceil(bill.patient_burden / 2)));
                  if (!amountStr) return;
                  const amount = parseInt(amountStr);
                  if (isNaN(amount) || amount <= 0) { alert("正しい金額を入力してください"); return; }
                  if (amount >= bill.patient_burden) { markPaid(bill); return; }
                  const remaining = bill.patient_burden - amount;
                  await supabase.from("billing").update({
                    notes: `分割払い: ¥${amount.toLocaleString()} 入金済 / 残額 ¥${remaining.toLocaleString()} (${new Date().toLocaleDateString("ja-JP")})`,
                  }).eq("id", bill.id);
                  alert(`¥${amount.toLocaleString()} を入金しました。\n残額: ¥${remaining.toLocaleString()}`);
                  loadBillings();
                }} disabled={processing} className="w-full bg-amber-50 text-amber-700 border-2 border-amber-200 py-3 rounded-xl font-bold text-sm hover:bg-amber-100 disabled:opacity-50">
                  💳 分割払い
                </button>
                {bill.notes && bill.notes.includes("分割") && (
                  <div className="bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                    <p className="text-[10px] text-amber-700 font-bold">{bill.notes}</p>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="text-center py-3 bg-green-100 rounded-xl"><p className="text-green-700 font-bold">✅ 精算済み</p></div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => printReceipt(bill)} className="flex-1 bg-gray-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-gray-700">🖨️ 領収書・明細書</button>
                  <Link href={`/reservation?action=new&patient_id=${bill.patient_id}&patient_name=${encodeURIComponent(getName(bill))}`} className="flex-1 bg-sky-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-sky-700 text-center shadow-md shadow-sky-200">📅 次回予約</Link>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

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
            {mainTab === "unpaid_all" && <span className="bg-red-50 text-red-700 px-3 py-1 rounded-full text-xs font-bold">全未精算 {allUnpaid.length}件</span>}
          </div>
        </div>
        <div className="max-w-full mx-auto px-4 flex gap-0 border-t border-gray-100">
          {([
            { key: "billing" as MainTab, label: "💰 日別会計" },
            { key: "unpaid_all" as MainTab, label: "🔴 全未会計" },
            { key: "receipt" as MainTab, label: "📄 レセ電ダウンロード" },
            { key: "estimate" as MainTab, label: "💎 自費見積" },
          ]).map(t => (
            <button key={t.key} onClick={() => { setMainTab(t.key); setSelected(null); }}
              className={`px-5 py-2.5 text-sm font-bold border-b-2 transition-colors ${mainTab === t.key ? "border-sky-500 text-sky-600" : "border-transparent text-gray-400 hover:text-gray-600"}`}>
              {t.label}
              {t.key === "unpaid_all" && allUnpaid.length > 0 && <span className="ml-1.5 bg-red-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{allUnpaid.length}</span>}
            </button>
          ))}
          <Link href="/receipt-check" className="px-5 py-2.5 text-sm font-bold border-b-2 border-transparent text-gray-400 hover:text-gray-600 transition-colors">🔍 レセプトチェック</Link>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-4">
        {/* === 日別会計タブ === */}
        {mainTab === "billing" && (
          <>
            {/* 日付ナビ */}
            <div className="flex items-center gap-2 mb-4">
              <button onClick={goPrev} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">◀</button>
              <input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-bold text-sm" />
              <button onClick={goNext} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">▶</button>
              <button onClick={goToday} className={`border rounded-lg px-3 py-1.5 text-xs font-bold ${isToday ? "bg-sky-100 border-sky-300 text-sky-700" : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"}`}>今日</button>
              <span className="text-xs text-gray-400 ml-2">{billings.length}件 / 合計 ¥{billings.reduce((s, b) => s + b.patient_burden, 0).toLocaleString()}</span>
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                {unpaid.length > 0 && (
                  <div className="mb-6">
                    <h2 className="text-sm font-bold text-red-600 mb-2">🔴 会計待ち</h2>
                    <div className="space-y-2">
                      {unpaid.map(b => (
                        <button key={b.id} onClick={() => setSelected(b)} className={`w-full bg-white rounded-xl border-2 p-4 text-left transition-all hover:shadow-md ${selected?.id === b.id ? "border-sky-400 shadow-md" : "border-gray-200"}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="bg-red-100 text-red-700 w-10 h-10 rounded-full flex items-center justify-center font-bold">{getName(b).charAt(0)}</div>
                              <div><p className="font-bold text-gray-900">{getName(b)}</p><p className="text-xs text-gray-400">{getKana(b)}</p></div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-bold text-gray-900">¥{b.patient_burden.toLocaleString()}</p>
                              <p className="text-xs text-gray-400">{b.total_points.toLocaleString()}点 / {Math.round(b.burden_ratio * 10)}割負担</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {paid.length > 0 && (
                  <div>
                    <h2 className="text-sm font-bold text-green-600 mb-2">✅ 精算済み</h2>
                    <div className="space-y-1">
                      {paid.map(b => (
                        <button key={b.id} onClick={() => setSelected(b)} className={`w-full bg-white rounded-lg border p-3 text-left transition-all hover:bg-gray-50 ${selected?.id === b.id ? "border-sky-400" : "border-gray-100"}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2"><span className="text-green-500">✅</span><span className="font-bold text-gray-700 text-sm">{getName(b)}</span></div>
                            <span className="text-sm font-bold text-gray-500">¥{b.patient_burden.toLocaleString()}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {billings.length === 0 && (
                  <div className="text-center py-20">
                    <p className="text-4xl mb-3">💰</p>
                    <p className="text-gray-400">{isToday ? "本日の" : `${selectedDate} の`}会計データはありません</p>
                    <p className="text-xs text-gray-300 mt-2">診察完了後に自動的に表示されます</p>
                  </div>
                )}
              </div>
              {selected && <DetailPanel bill={selected} />}
            </div>
          </>
        )}

        {/* === 全未会計タブ === */}
        {mainTab === "unpaid_all" && (
          <div className="flex gap-4">
            <div className="flex-1">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold text-red-600">🔴 全期間の未会計一覧</h2>
                <span className="text-xs text-gray-400">{allUnpaid.length}件 / 合計 ¥{allUnpaid.reduce((s, b) => s + b.patient_burden, 0).toLocaleString()}</span>
              </div>
              {allUnpaid.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
                  <p className="text-4xl mb-3">✅</p>
                  <p className="text-gray-400">未会計はありません</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {allUnpaid.map(b => (
                    <button key={b.id} onClick={() => setSelected(b)} className={`w-full bg-white rounded-xl border-2 p-4 text-left transition-all hover:shadow-md ${selected?.id === b.id ? "border-sky-400 shadow-md" : "border-gray-200"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="bg-red-100 text-red-700 w-10 h-10 rounded-full flex items-center justify-center font-bold">{getName(b).charAt(0)}</div>
                          <div>
                            <p className="font-bold text-gray-900">{getName(b)}</p>
                            <p className="text-xs text-gray-400">{getKana(b)}</p>
                          </div>
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-bold">{formatDateShort(b.created_at)}</span>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-gray-900">¥{b.patient_burden.toLocaleString()}</p>
                          <p className="text-xs text-gray-400">{b.total_points.toLocaleString()}点 / {Math.round(b.burden_ratio * 10)}割負担</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {selected && <DetailPanel bill={selected} />}
          </div>
        )}

        {/* === レセ電タブ === */}
        {mainTab === "receipt" && (
          <div className="max-w-2xl mx-auto py-8">
            <div className="bg-white rounded-2xl border border-gray-200 p-8">
              <div className="text-center mb-6">
                <p className="text-5xl mb-3">📄</p>
                <h2 className="text-xl font-bold text-gray-900">レセ電ファイル生成</h2>
                <p className="text-sm text-gray-400 mt-1">指定月の精算済みデータからUKEファイル（Shift_JIS）を生成・ダウンロードします</p>
              </div>
              <div className="flex items-center gap-4 justify-center mb-6">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">請求年月</label>
                  <input type="month" value={receiptMonth} onChange={e => setReceiptMonth(e.target.value)} className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                </div>
                <div className="pt-5">
                  <button onClick={generateReceipt} disabled={generating} className="bg-sky-600 text-white px-8 py-2.5 rounded-lg text-sm font-bold hover:bg-sky-700 disabled:opacity-50 shadow-lg shadow-sky-200">
                    {generating ? "⏳ 生成中..." : "📄 UKEファイル生成・ダウンロード"}
                  </button>
                </div>
              </div>
              {receiptStatus && (
                <div className={`text-center p-4 rounded-xl text-sm font-bold ${receiptStatus.startsWith("✅") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{receiptStatus}</div>
              )}
              <div className="mt-6 bg-gray-50 rounded-xl p-4">
                <h3 className="text-xs font-bold text-gray-500 mb-2">📋 生成されるファイルについて</h3>
                <div className="space-y-1 text-xs text-gray-400">
                  <p>• UKEファイル形式（Shift_JIS / CR+LF改行）で出力</p>
                  <p>• UK, IR, RE, HO, KO, SY, SI, JD, MF, GO レコードを生成（厚労省9桁コード対応）</p>
                  <p>• 対象: 指定月の「精算済み」会計データのみ</p>
                  <p>• 患者の保険証情報は電子カルテの「🏥 保険証情報」で登録してください</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===== 💎 自費見積タブ ===== */}
        {mainTab === "estimate" && (
          <div className="max-w-2xl mx-auto py-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <div className="text-center mb-6">
                <p className="text-4xl mb-2">💎</p>
                <h2 className="text-xl font-bold text-gray-900">自費見積書作成</h2>
                <p className="text-sm text-gray-400">患者に提示する自費治療の見積書を作成・印刷</p>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-400 block mb-1">患者名</label>
                    <input type="text" id="est_name" placeholder="山田 太郎" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                  <div><label className="text-xs text-gray-400 block mb-1">作成日</label>
                    <input type="date" id="est_date" defaultValue={new Date().toISOString().split("T")[0]} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                </div>

                <div>
                  <label className="text-xs text-gray-400 block mb-1">見積項目</label>
                  <p className="text-[10px] text-gray-300 mb-2">よく使う自費メニューを選択、または手動入力</p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {[
                      { name: "セラミックインレー", price: 55000 },
                      { name: "ジルコニアクラウン", price: 120000 },
                      { name: "e.maxクラウン", price: 100000 },
                      { name: "ゴールドインレー", price: 70000 },
                      { name: "ゴールドクラウン", price: 110000 },
                      { name: "CAD/CAMインレー（自費）", price: 40000 },
                      { name: "インプラント（1本）", price: 350000 },
                      { name: "ホワイトニング（上下）", price: 35000 },
                      { name: "マウスピース矯正", price: 400000 },
                      { name: "ラミネートベニア", price: 90000 },
                    ].map(item => (
                      <button key={item.name} onClick={() => {
                        const list = document.getElementById("est_items") as HTMLTextAreaElement;
                        if (list) list.value += `${item.name}\t¥${item.price.toLocaleString()}\n`;
                      }} className="text-[10px] bg-purple-50 border border-purple-200 text-purple-700 px-2 py-1 rounded font-bold hover:bg-purple-100">
                        + {item.name} ¥{item.price.toLocaleString()}
                      </button>
                    ))}
                  </div>
                  <textarea id="est_items" rows={6} placeholder={"セラミックインレー\t¥55,000\nジルコニアクラウン\t¥120,000"} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400 font-mono" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-xs text-gray-400 block mb-1">有効期限</label>
                    <input type="text" id="est_expiry" defaultValue="発行日より1ヶ月" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                  <div><label className="text-xs text-gray-400 block mb-1">備考</label>
                    <input type="text" id="est_note" placeholder="分割払い可" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" /></div>
                </div>

                <button onClick={() => {
                  const name = (document.getElementById("est_name") as HTMLInputElement)?.value || "患者";
                  const date = (document.getElementById("est_date") as HTMLInputElement)?.value || "";
                  const items = (document.getElementById("est_items") as HTMLTextAreaElement)?.value || "";
                  const expiry = (document.getElementById("est_expiry") as HTMLInputElement)?.value || "";
                  const note = (document.getElementById("est_note") as HTMLInputElement)?.value || "";
                  const rows = items.split("\n").filter(l => l.trim()).map(l => {
                    const parts = l.split("\t");
                    return { name: parts[0]?.trim() || "", price: parts[1]?.trim() || "¥0" };
                  });
                  const total = rows.reduce((s, r) => s + parseInt(r.price.replace(/[¥,]/g, "")) || 0, 0);
                  const dateLabel = date ? new Date(date + "T00:00:00").toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric" }) : "";
                  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>自費見積書</title>
<style>@media print{.no-print{display:none!important}@page{size:A4;margin:15mm}}body{font-family:"Yu Gothic","Hiragino Kaku Gothic ProN",sans-serif;max-width:650px;margin:0 auto;padding:20px;color:#333}h1{text-align:center;font-size:22px;border-bottom:3px double #333;padding-bottom:8px;margin-bottom:20px}table{width:100%;border-collapse:collapse;margin:15px 0}td,th{border:1px solid #999;padding:8px 12px;font-size:13px}th{background:#f8f8f8;text-align:left}.total{font-size:18px;font-weight:bold;color:#1a56db;text-align:right}.info{display:flex;justify-content:space-between;margin-bottom:15px;font-size:12px}.sig{margin-top:30px;text-align:right;font-size:11px;color:#666}</style></head><body>
<div class="no-print" style="text-align:center;margin-bottom:15px"><button onclick="window.print()" style="padding:10px 30px;font-size:14px;background:#7c3aed;color:#fff;border:none;border-radius:8px;cursor:pointer">🖨️ 印刷する</button></div>
<h1>見 積 書</h1>
<div class="info"><div><strong>${name}</strong> 様</div><div>作成日: ${dateLabel}</div></div>
<p style="font-size:12px;color:#666">以下の通りお見積もり申し上げます。</p>
<table><tr><th style="width:60%">項目</th><th style="text-align:right">金額（税込）</th></tr>
${rows.map(r => `<tr><td>${r.name}</td><td style="text-align:right">${r.price}</td></tr>`).join("")}
<tr style="border-top:2px solid #333"><td><strong>合計金額</strong></td><td class="total">¥${total.toLocaleString()}</td></tr>
</table>
${note ? `<p style="font-size:11px;color:#666">備考: ${note}</p>` : ""}
<p style="font-size:11px;color:#666">有効期限: ${expiry}</p>
<p style="font-size:10px;color:#999;margin-top:10px">※上記は概算です。治療内容により変動する場合があります。<br>※自費診療には別途消費税がかかります。</p>
<div class="sig"><p>医療機関名: ______________________</p><p style="margin-top:8px">歯科医師: ______________________ 印</p></div>
</body></html>`;
                  const pw = window.open("", "_blank");
                  if (pw) { pw.document.write(html); pw.document.close(); }
                }} className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-purple-700 shadow-lg shadow-purple-200">
                  🖨️ 見積書を印刷
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* 精算完了後の次回予約導線モーダル */}
      {paidPatientInfo && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full shadow-2xl text-center">
            <p className="text-5xl mb-3">✅</p>
            <h3 className="text-xl font-bold text-gray-900 mb-1">{paidPatientInfo.name} 様</h3>
            <p className="text-lg font-bold text-green-600 mb-4">精算が完了しました</p>
            <div className="space-y-3">
              <Link href={`/reservation?action=new&patient_id=${paidPatientInfo.patientId}&patient_name=${encodeURIComponent(paidPatientInfo.name)}`}
                className="block w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 shadow-lg shadow-sky-200">
                📅 次回予約を取る
              </Link>
              <button onClick={() => setPaidPatientInfo(null)}
                className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold text-sm hover:bg-gray-200">
                次回予約なし（閉じる）
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-3">次回予約は患者マイページからも可能です</p>
          </div>
        </div>
      )}
    </div>
  );
}
