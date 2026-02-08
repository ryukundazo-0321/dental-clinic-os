"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type BillingItem = {
  id: string;
  record_id: string;
  patient_id: string;
  total_points: number;
  patient_burden: number;
  insurance_claim: number;
  burden_ratio: number;
  procedures_detail: { code: string; name: string; points: number; category: string; count: number; note: string }[];
  ai_check_warnings: string[];
  claim_status: string;
  payment_status: string;
  medical_records: {
    id: string;
    soap_s: string | null;
    soap_o: string | null;
    soap_a: string | null;
    soap_p: string | null;
    appointments: {
      scheduled_at: string;
      patient_type: string;
      patients: { name_kanji: string; name_kana: string; insurance_type: string; burden_ratio: number } | null;
    } | null;
  } | null;
};

export default function BillingPage() {
  const [billings, setBillings] = useState<BillingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<BillingItem | null>(null);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    loadBillings();
    const ch = supabase.channel("billing-realtime").on("postgres_changes", { event: "*", schema: "public", table: "billing" }, () => loadBillings()).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function loadBillings() {
    const todayStr = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("billing")
      .select(`*, medical_records(id, soap_s, soap_o, soap_a, soap_p, appointments(scheduled_at, patient_type, patients(name_kanji, name_kana, insurance_type, burden_ratio)))`)
      .gte("created_at", `${todayStr}T00:00:00`)
      .order("created_at", { ascending: false });
    if (data) setBillings(data as unknown as BillingItem[]);
    setLoading(false);
  }

  async function markPaid(billing: BillingItem) {
    if (!confirm(`${getPatientName(billing)} 様の会計を精算済みにしますか？\n患者負担額: ¥${billing.patient_burden.toLocaleString()}`)) return;
    setProcessing(true);
    await supabase.from("billing").update({ payment_status: "paid" }).eq("id", billing.id);

    // 予約ステータスもbilling_doneに
    if (billing.medical_records?.appointments) {
      const { data: apt } = await supabase.from("medical_records").select("appointment_id").eq("id", billing.record_id).single();
      if (apt) {
        await supabase.from("appointments").update({ status: "billing_done" }).eq("id", apt.appointment_id);
      }
    }

    await loadBillings();
    setSelected(null);
    setProcessing(false);
  }

  function getPatientName(b: BillingItem) {
    return b.medical_records?.appointments?.patients?.name_kanji || "不明";
  }

  function getPatientKana(b: BillingItem) {
    return b.medical_records?.appointments?.patients?.name_kana || "";
  }

  // カテゴリ別にグルーピング
  function groupByCategory(items: BillingItem["procedures_detail"]) {
    const groups: Record<string, typeof items> = {};
    items.forEach(item => {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    });
    return groups;
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
            <span className="bg-red-50 text-red-700 px-3 py-1 rounded-full text-xs font-bold">未精算 {unpaid.length}件</span>
            <span className="bg-green-50 text-green-700 px-3 py-1 rounded-full text-xs font-bold">精算済 {paid.length}件</span>
          </div>
        </div>
      </header>

      <main className="max-w-full mx-auto px-4 py-4">
        <div className="flex gap-4">
          {/* 左: 会計リスト */}
          <div className="flex-1">
            {/* 未精算 */}
            {unpaid.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-bold text-red-600 mb-2">🔴 会計待ち</h2>
                <div className="space-y-2">
                  {unpaid.map(b => (
                    <button key={b.id} onClick={() => setSelected(b)}
                      className={`w-full bg-white rounded-xl border-2 p-4 text-left transition-all hover:shadow-md ${selected?.id === b.id ? "border-sky-400 shadow-md" : "border-gray-200"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="bg-red-100 text-red-700 w-10 h-10 rounded-full flex items-center justify-center font-bold">
                            {getPatientName(b).charAt(0)}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900">{getPatientName(b)}</p>
                            <p className="text-xs text-gray-400">{getPatientKana(b)}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-gray-900">¥{b.patient_burden.toLocaleString()}</p>
                          <p className="text-xs text-gray-400">{b.total_points.toLocaleString()}点 / {b.burden_ratio * 10}割負担</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 精算済 */}
            {paid.length > 0 && (
              <div>
                <h2 className="text-sm font-bold text-green-600 mb-2">✅ 本日の精算済み</h2>
                <div className="space-y-1">
                  {paid.map(b => (
                    <button key={b.id} onClick={() => setSelected(b)}
                      className={`w-full bg-white rounded-lg border p-3 text-left transition-all hover:bg-gray-50 ${selected?.id === b.id ? "border-sky-400" : "border-gray-100"}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-green-500">✅</span>
                          <span className="font-bold text-gray-700 text-sm">{getPatientName(b)}</span>
                        </div>
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
                <p className="text-gray-400">本日の会計データはありません</p>
                <p className="text-xs text-gray-300 mt-2">診察完了後に自動的に会計データが生成されます</p>
              </div>
            )}
          </div>

          {/* 右: 明細パネル */}
          {selected && (
            <div className="w-[420px] flex-shrink-0">
              <div className="bg-white rounded-xl border border-gray-200 shadow-lg sticky top-4 overflow-hidden">
                {/* ヘッダー */}
                <div className="bg-gray-900 text-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400">患者名</p>
                      <p className="text-lg font-bold">{getPatientName(selected)} 様</p>
                    </div>
                    <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-white">✕</button>
                  </div>
                  <div className="flex items-end justify-between mt-3">
                    <div>
                      <p className="text-xs text-gray-400">合計点数</p>
                      <p className="text-3xl font-bold text-sky-400">{selected.total_points.toLocaleString()} <span className="text-sm">点</span></p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">患者負担（{selected.burden_ratio * 10}割）</p>
                      <p className="text-2xl font-bold text-orange-400">¥{selected.patient_burden.toLocaleString()}</p>
                    </div>
                  </div>
                </div>

                {/* AI算定チェック */}
                {selected.ai_check_warnings?.length > 0 && (
                  <div className="bg-amber-50 border-b border-amber-200 px-4 py-2">
                    <p className="text-xs font-bold text-amber-700 mb-1">⚠️ AI算定チェック</p>
                    {selected.ai_check_warnings.map((w, i) => (
                      <p key={i} className="text-xs text-amber-600">• {w}</p>
                    ))}
                  </div>
                )}

                {/* 明細 */}
                <div className="p-4 max-h-[50vh] overflow-y-auto">
                  {Object.entries(groupByCategory(selected.procedures_detail || [])).map(([cat, items]) => (
                    <div key={cat} className="mb-4">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 border-b border-gray-100 pb-1">{cat}</p>
                      {items.map((item, idx) => (
                        <div key={idx} className="flex items-center justify-between py-1.5">
                          <div className="flex-1">
                            <p className="text-sm font-bold text-gray-800">{item.name}</p>
                            <p className="text-[10px] text-gray-400">{item.code}{item.note ? ` · ${item.note}` : ""}</p>
                          </div>
                          <p className="text-sm font-bold text-gray-900 ml-3">{(item.points * item.count).toLocaleString()} <span className="text-[10px] text-gray-400">点</span></p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>

                {/* フッター: 合計 + 精算ボタン */}
                <div className="border-t border-gray-200 p-4 bg-gray-50">
                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div><p className="text-[10px] text-gray-400">合計点数</p><p className="text-lg font-bold text-gray-900">{selected.total_points.toLocaleString()}</p></div>
                    <div><p className="text-[10px] text-gray-400">{selected.burden_ratio * 10}割負担</p><p className="text-lg font-bold text-orange-600">¥{selected.patient_burden.toLocaleString()}</p></div>
                    <div><p className="text-[10px] text-gray-400">保険請求</p><p className="text-lg font-bold text-sky-600">¥{selected.insurance_claim.toLocaleString()}</p></div>
                  </div>

                  {selected.payment_status === "unpaid" ? (
                    <button onClick={() => markPaid(selected)} disabled={processing}
                      className="w-full bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200 active:scale-[0.98]">
                      {processing ? "処理中..." : "💰 精算完了"}
                    </button>
                  ) : (
                    <div className="text-center py-3 bg-green-100 rounded-xl">
                      <p className="text-green-700 font-bold">✅ 精算済み</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
