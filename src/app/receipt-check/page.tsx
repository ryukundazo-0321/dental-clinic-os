"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type BillingRow = {
  id: string; record_id: string; patient_id: string;
  total_points: number; patient_burden: number; insurance_claim: number; burden_ratio: number;
  procedures_detail: { code: string; name: string; points: number; category: string; count: number; note: string; tooth_numbers?: string[] }[];
  ai_check_warnings: string[];
  document_provided: boolean;
  claim_status: string; payment_status: string; created_at: string;
  patients: { name_kanji: string; name_kana: string; patient_insurances?: { insurance_type: string | null; is_current: boolean }[] } | null;
};

type CheckResult = {
  billing_id: string;
  patient_id: string;
  patient_name: string;
  status: "pending" | "checking" | "ok" | "warn" | "error";
  errors: string[];
  warnings: string[];
};

type FilterTab = "all" | "error" | "warn" | "ok";

export default function ReceiptCheckPage() {
  const [checkMonth, setCheckMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [billings, setBillings] = useState<BillingRow[]>([]);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkDone, setCheckDone] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const [henreiItems, setHenreiItems] = useState<{ patient_name: string; ym: string; reason: string; points: string }[]>([]);
  const [aiChecking, setAiChecking] = useState(false);
  const [rulesCount, setRulesCount] = useState<number | null>(null);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // ============================================================
  // APIからルール件数を取得（初回のみ）
  // ============================================================
  useState(() => {
    fetch("/api/receipt-check")
      .then(res => res.json())
      .then(data => {
        setRulesCount(data.rules?.total || 0);
        setRulesLoaded(true);
      })
      .catch(() => setRulesLoaded(true));
  });

  // ============================================================
  // 月データ読み込み（billing一覧取得）
  // ============================================================
  async function loadMonthData() {
    setLoading(true);
    setResults([]);
    setCheckDone(false);
    setFilterTab("all");
    const ym = checkMonth;
    const startDate = `${ym}-01T00:00:00`;
    const endDay = new Date(parseInt(ym.split("-")[0]), parseInt(ym.split("-")[1]), 0).getDate();
    const endDate = `${ym}-${String(endDay).padStart(2, "0")}T23:59:59`;

    const { data } = await supabase
      .from("billing")
      .select("*, patients(name_kanji, name_kana, patient_insurances(insurance_type, is_current))")
      .eq("payment_status", "paid")
      .gte("created_at", startDate)
      .lte("created_at", endDate)
      .order("created_at");

    if (data) {
      const bills = data as unknown as BillingRow[];
      setBillings(bills);
      setResults(bills.map(b => ({
        billing_id: b.id,
        patient_id: b.patient_id,
        patient_name: b.patients?.name_kanji || "不明",
        status: "pending",
        errors: [],
        warnings: [],
      })));
    }
    setLoading(false);
  }

  // ============================================================
  // チェック開始 — サーバーサイドAPIを呼び出し
  // ============================================================
  async function startCheck() {
    if (billings.length === 0) return;
    setChecking(true);
    setCheckDone(false);
    setExpandedId(null);
    setFilterTab("all");

    // 全件を「チェック中」に
    setResults(prev => prev.map(r => ({ ...r, status: "checking" as const })));

    try {
      const { data: { session: _src } } = await supabase.auth.getSession();
      const res = await fetch("/api/receipt-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearMonth: checkMonth,
          billing_ids: billings.map(b => b.id),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`チェックエラー: ${err.error || "不明なエラー"}`);
        setResults(prev => prev.map(r => ({ ...r, status: "pending" as const })));
        setChecking(false);
        return;
      }

      const data = await res.json();
      const apiResults = data.results || [];

      // API結果をUIのresults配列にマージ
      setResults(prev => prev.map(r => {
        const apiResult = apiResults.find((ar: CheckResult) => ar.billing_id === r.billing_id);
        if (apiResult) {
          return {
            ...r,
            status: apiResult.status,
            errors: apiResult.errors,
            warnings: apiResult.warnings,
            patient_name: apiResult.patient_name || r.patient_name,
          };
        }
        return { ...r, status: "ok" as const, errors: [], warnings: [] };
      }));

      // ルール件数を更新
      if (data.rules_loaded) {
        const total = Object.values(data.rules_loaded as Record<string, number>).reduce((s: number, v: number) => s + v, 0);
        setRulesCount(total);
      }
    } catch (e) {
      console.error("Check API error:", e);
      alert("チェックAPIの呼び出しに失敗しました");
      setResults(prev => prev.map(r => ({ ...r, status: "pending" as const })));
    }

    setChecking(false);
    setCheckDone(true);
  }

  // ============================================================
  // 1件だけ再チェック
  // ============================================================
  async function recheckOne(billingId: string) {
    setRecheckingId(billingId);
    const idx = results.findIndex(r => r.billing_id === billingId);
    if (idx < 0) { setRecheckingId(null); return; }

    // billingデータを再取得
    const { data: freshBilling } = await supabase
      .from("billing")
      .select("*, patients(name_kanji, name_kana, patient_insurances(insurance_type, is_current))")
      .eq("id", billingId)
      .single();

    if (!freshBilling) { setRecheckingId(null); return; }
    const bill = freshBilling as unknown as BillingRow;
    setBillings(prev => prev.map((b, i) => i === idx ? bill : b));

    setResults(prev => prev.map((r, i) => i === idx ? { ...r, status: "checking" as const } : r));

    try {
      const res = await fetch("/api/receipt-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          yearMonth: checkMonth,
          billing_ids: [billingId],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const apiResult = data.results?.[0];
        if (apiResult) {
          setResults(prev => prev.map((r, i) => i === idx ? {
            ...r,
            patient_name: apiResult.patient_name || r.patient_name,
            status: apiResult.status,
            errors: apiResult.errors,
            warnings: apiResult.warnings,
          } : r));
        }
      }
    } catch (e) {
      console.error("Recheck error:", e);
    }

    setRecheckingId(null);
  }

  // ============================================================
  // 全件再チェック
  // ============================================================
  async function recheckAll() {
    setChecking(true);
    setExpandedId(null);

    const ym = checkMonth;
    const startDate = `${ym}-01T00:00:00`;
    const endDay = new Date(parseInt(ym.split("-")[0]), parseInt(ym.split("-")[1]), 0).getDate();
    const endDate = `${ym}-${String(endDay).padStart(2, "0")}T23:59:59`;

    const { data } = await supabase
      .from("billing")
      .select("*, patients(name_kanji, name_kana, patient_insurances(insurance_type, is_current))")
      .eq("payment_status", "paid")
      .gte("created_at", startDate)
      .lte("created_at", endDate)
      .order("created_at");

    if (!data) { setChecking(false); return; }
    const freshBillings = data as unknown as BillingRow[];
    setBillings(freshBillings);

    setResults(freshBillings.map(b => ({
      billing_id: b.id,
      patient_id: b.patient_id,
      patient_name: b.patients?.name_kanji || "不明",
      status: "checking" as const,
      errors: [],
      warnings: [],
    })));

    try {
      const res = await fetch("/api/receipt-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ yearMonth: checkMonth }),
      });

      if (res.ok) {
        const apiData = await res.json();
        const apiResults = apiData.results || [];
        setResults(apiResults.map((ar: CheckResult) => ({
          ...ar,
          status: ar.status || "ok",
        })));
      }
    } catch (e) {
      console.error("Recheck all error:", e);
    }

    setChecking(false);
    setCheckDone(true);
  }

  // ============================================================
  // AI深層チェック（既存ロジック維持）
  // ============================================================
  async function runAICheck() {
    const targets = results.filter(r => r.status === "error" || r.status === "warn");
    const okSamples = results.filter(r => r.status === "ok").slice(0, 3);
    const allTargets = [...targets, ...okSamples];

    if (allTargets.length === 0) { alert("チェック対象がありません"); return; }
    setAiChecking(true);

    try {
      const tokenRes = await fetch("/api/whisper-token");
      const tk = await tokenRes.json();
      if (!tk.key) { alert("APIキー取得失敗"); setAiChecking(false); return; }

      for (const target of allTargets) {
        const idx = results.findIndex(r => r.billing_id === target.billing_id);
        const billing = billings[idx];
        if (!billing) continue;

        const { data: patientDiags } = await supabase
          .from("receipt_diagnoses")
          .select("*")
          .eq("patient_id", billing.patient_id);

        const procs = billing.procedures_detail || [];
        const prompt = `歯科レセプトの査定・返戻リスクを判定してください。

【患者】${billing.patients?.name_kanji || "不明"}
【保険種別】${billing.patients?.patient_insurances?.[0]?.insurance_type || "不明"}
【合計点数】${billing.total_points}点
【算定項目】
${procs.map(p => `- ${p.name}(${p.code}) ${p.points}点×${p.count}回${p.tooth_numbers?.length ? " 歯:" + p.tooth_numbers.join(",") : ""}`).join("\n")}

【傷病名】
${(patientDiags || []).map((d: { diagnosis_name: string; diagnosis_code: string; tooth_number_display: string; outcome: string }) => `- ${d.diagnosis_name}(${d.diagnosis_code}) 歯:${d.tooth_number_display} 転帰:${d.outcome}`).join("\n") || "なし"}

【ルールチェック結果】
エラー: ${target.errors.join("; ") || "なし"}
警告: ${target.warnings.join("; ") || "なし"}

以下をJSON形式で出力:
{
  "risk_level": "high/medium/low/ok",
  "ai_findings": ["追加で発見した問題点（ルールで拾えなかったもの）"],
  "risk_areas": ["査定リスクが高い項目"],
  "suggestions": ["改善提案"]
}
ルールチェックと重複する指摘は不要。ルールで拾えない微妙な問題のみ指摘。`;

        try {
          const res = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${tk.key}` },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: "あなたは歯科レセプト審査の専門家です。社保・国保の審査基準に精通し、査定・返戻リスクを正確に判定します。ルールベースチェックで拾えないグレーゾーンの問題を指摘してください。" },
                { role: "user", content: prompt },
              ],
              temperature: 0.1,
              max_tokens: 1000,
              response_format: { type: "json_object" },
            }),
          });

          if (res.ok) {
            const data = await res.json();
            const content = JSON.parse(data.choices?.[0]?.message?.content || "{}");
            const aiFindings = content.ai_findings || [];
            const riskAreas = content.risk_areas || [];
            const suggestions = content.suggestions || [];

            if (aiFindings.length > 0 || riskAreas.length > 0) {
              const newWarnings = [
                ...target.warnings,
                ...aiFindings.map((f: string) => `🤖 AI: ${f}`),
                ...riskAreas.map((r: string) => `🤖 査定リスク: ${r}`),
                ...suggestions.map((s: string) => `💡 AI提案: ${s}`),
              ];
              setResults(prev => prev.map((r, i) => i === idx ? {
                ...r,
                status: target.errors.length > 0 ? "error" : newWarnings.length > 0 ? "warn" : "ok",
                warnings: newWarnings,
              } : r));
            }
          }
        } catch (e) {
          console.error("AI check error for", target.billing_id, e);
        }
      }
    } catch (e) {
      console.error("AI check failed:", e);
      alert("AI分析でエラーが発生しました");
    }

    setAiChecking(false);
  }

  // ============================================================
  // UIヘルパー
  // ============================================================
  const summary = {
    total: results.length,
    ok: results.filter(r => r.status === "ok").length,
    warn: results.filter(r => r.status === "warn").length,
    error: results.filter(r => r.status === "error").length,
    pending: results.filter(r => r.status === "pending" || r.status === "checking").length,
  };

  const filteredResults = results.filter(r => {
    if (filterTab === "all") return true;
    if (filterTab === "error") return r.status === "error";
    if (filterTab === "warn") return r.status === "warn";
    if (filterTab === "ok") return r.status === "ok";
    return true;
  });

  function getStatusIcon(status: CheckResult["status"]) {
    switch (status) {
      case "pending": return <span className="text-gray-300 text-lg">○</span>;
      case "checking": return <span className="inline-block w-5 h-5 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />;
      case "ok": return <span className="text-green-500 text-lg">✅</span>;
      case "warn": return <span className="text-amber-500 text-lg">⚠️</span>;
      case "error": return <span className="text-red-500 text-lg">❌</span>;
    }
  }

  function getStatusBg(status: CheckResult["status"]) {
    switch (status) {
      case "checking": return "bg-sky-50 border-sky-200";
      case "ok": return "bg-white border-gray-100";
      case "warn": return "bg-amber-50 border-amber-200";
      case "error": return "bg-red-50 border-red-200";
      default: return "bg-white border-gray-100";
    }
  }

  function getStatusLabel(status: CheckResult["status"]) {
    switch (status) {
      case "pending": return <span className="text-xs text-gray-300">チェック待ち</span>;
      case "checking": return <span className="text-xs text-sky-500 font-bold">チェック中...</span>;
      case "ok": return <span className="text-xs text-green-600 font-bold">OK</span>;
      case "warn": return <span className="text-xs text-amber-600 font-bold">警告あり</span>;
      case "error": return <span className="text-xs text-red-600 font-bold">エラー</span>;
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/billing" className="text-gray-400 hover:text-gray-600 text-sm">← 会計へ戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">🔍 レセプトチェック</h1>
            {rulesLoaded && (
              <span className="text-[10px] text-gray-300 bg-gray-50 px-2 py-0.5 rounded-full">
                公式ルール{rulesCount?.toLocaleString() || 0}件読込済
              </span>
            )}
          </div>
          {checkDone && (
            <div className="flex items-center gap-2">
              {summary.error > 0 && <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-bold">{summary.error}件エラー</span>}
              {summary.warn > 0 && <span className="bg-amber-100 text-amber-700 px-3 py-1 rounded-full text-xs font-bold">{summary.warn}件警告</span>}
              {summary.ok > 0 && <span className="bg-green-100 text-green-700 px-3 py-1 rounded-full text-xs font-bold">{summary.ok}件OK</span>}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        {/* 月選択 + 読み込み */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <label className="text-xs text-gray-400 block mb-1">対象年月</label>
              <input type="month" value={checkMonth} onChange={e => setCheckMonth(e.target.value)}
                className="border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
            </div>
            <div className="pt-5">
              <button onClick={loadMonthData} disabled={loading}
                className="bg-gray-800 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-gray-700 disabled:opacity-50">
                {loading ? "読み込み中..." : "📋 レセプト一覧を取得"}
              </button>
            </div>
            {results.length > 0 && !checking && !checkDone && (
              <div className="pt-5">
                <button onClick={startCheck}
                  className="bg-sky-600 text-white px-8 py-2.5 rounded-lg text-sm font-bold hover:bg-sky-700 shadow-lg shadow-sky-200 transition-all hover:scale-105">
                  🔍 チェック開始
                </button>
              </div>
            )}
            {checkDone && !checking && (
              <div className="pt-5 flex gap-2">
                <button onClick={recheckAll}
                  className="bg-emerald-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-emerald-700 transition-all">
                  🔄 全件再チェック
                </button>
                <button onClick={runAICheck} disabled={aiChecking}
                  className="bg-purple-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-purple-700 transition-all disabled:opacity-50 shadow-lg shadow-purple-200">
                  {aiChecking ? "🤖 AI分析中..." : "🤖 AI深層チェック"}
                </button>
              </div>
            )}
          </div>
          {results.length > 0 && (
            <p className="text-xs text-gray-400 mt-3">{checkMonth.replace("-", "年")}月 の精算済みレセプト: {results.length}件</p>
          )}
          {checkDone && summary.error === 0 && summary.warn === 0 && (
            <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎉</span>
                <p className="text-sm text-green-700 font-bold">全件OK！レセプト請求の準備が整いました</p>
              </div>
              <Link href="/billing" className="bg-green-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-green-700">
                📄 レセ電ダウンロードへ
              </Link>
            </div>
          )}
        </div>

        {/* チェック結果サマリー + フィルター */}
        {checkDone && (
          <div className="mb-6">
            <div className="grid grid-cols-4 gap-3 mb-3">
              {([
                { key: "all" as FilterTab, label: "総件数", count: summary.total, bg: "bg-white border-gray-200", text: "text-gray-900" },
                { key: "ok" as FilterTab, label: "OK", count: summary.ok, bg: "bg-green-50 border-green-200", text: "text-green-600" },
                { key: "warn" as FilterTab, label: "警告", count: summary.warn, bg: "bg-amber-50 border-amber-200", text: "text-amber-600" },
                { key: "error" as FilterTab, label: "エラー", count: summary.error, bg: "bg-red-50 border-red-200", text: "text-red-600" },
              ]).map(f => (
                <button key={f.key} onClick={() => setFilterTab(f.key)}
                  className={`rounded-xl border p-4 text-center transition-all ${f.bg} ${filterTab === f.key ? "ring-2 ring-sky-400 scale-105" : "hover:scale-102"}`}>
                  <p className={`text-2xl font-bold ${f.text}`}>{f.count}</p>
                  <p className={`text-xs mt-1 ${filterTab === f.key ? "text-sky-600 font-bold" : "text-gray-400"}`}>
                    {f.label}{filterTab === f.key ? " ●" : ""}
                  </p>
                </button>
              ))}
            </div>
            {filterTab !== "all" && (
              <p className="text-xs text-sky-500 text-center">
                「{filterTab === "error" ? "エラー" : filterTab === "warn" ? "警告" : "OK"}」のみ表示中 ・
                <button onClick={() => setFilterTab("all")} className="underline hover:text-sky-700">全件表示に戻す</button>
              </p>
            )}
          </div>
        )}

        {/* レセプト一覧 */}
        {results.length === 0 && !loading && (
          <div className="text-center py-20">
            <p className="text-5xl mb-4">🔍</p>
            <p className="text-gray-400">年月を選択して「レセプト一覧を取得」を押してください</p>
            <p className="text-xs text-gray-300 mt-2">精算済みの会計データが対象です</p>
          </div>
        )}

        <div ref={listRef} className="space-y-2">
          {filteredResults.map((r) => {
            const idx = results.findIndex(res => res.billing_id === r.billing_id);
            const billing = billings[idx];
            const isExpanded = expandedId === r.billing_id;
            const hasIssues = r.errors.length > 0 || r.warnings.length > 0;
            const isRechecking = recheckingId === r.billing_id;

            return (
              <div key={r.billing_id}
                className={`rounded-xl border-2 transition-all duration-300 ${getStatusBg(r.status)} ${r.status === "checking" || isRechecking ? "scale-[1.01]" : ""}`}>
                <button
                  onClick={() => hasIssues ? setExpandedId(isExpanded ? null : r.billing_id) : null}
                  className={`w-full px-4 py-3 flex items-center gap-4 text-left ${hasIssues ? "cursor-pointer" : "cursor-default"}`}>
                  <span className="text-xs text-gray-300 w-6 text-right font-mono">{idx + 1}</span>
                  <div className="w-8 flex justify-center">
                    {isRechecking
                      ? <span className="inline-block w-5 h-5 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
                      : getStatusIcon(r.status)}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-gray-800 text-sm">{r.patient_name}</p>
                    {billing && (
                      <p className="text-[10px] text-gray-400">
                        {new Date(billing.created_at).toLocaleDateString("ja-JP")} ・ {billing.total_points.toLocaleString()}点 ・ ¥{billing.patient_burden.toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="w-24 text-right">
                    {isRechecking ? <span className="text-xs text-emerald-500 font-bold">再チェック中...</span> : getStatusLabel(r.status)}
                  </div>
                  {hasIssues && (
                    <div className="flex gap-1">
                      {r.errors.length > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{r.errors.length}</span>}
                      {r.warnings.length > 0 && <span className="bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">{r.warnings.length}</span>}
                    </div>
                  )}
                  {hasIssues && (
                    <span className={`text-gray-300 text-xs transition-transform ${isExpanded ? "rotate-180" : ""}`}>▼</span>
                  )}
                </button>

                {isExpanded && hasIssues && (
                  <div className="px-4 pb-4 pt-0 border-t border-gray-100 ml-14">
                    {r.errors.map((e, i) => (
                      <div key={"e" + i} className="flex items-start gap-2 py-1.5">
                        <span className="text-red-500 text-xs mt-0.5">❌</span>
                        <p className="text-xs text-red-700 flex-1">{e}</p>
                      </div>
                    ))}
                    {r.warnings.map((w, i) => (
                      <div key={"w" + i} className="flex items-start gap-2 py-1.5">
                        <span className="text-amber-500 text-xs mt-0.5">⚠️</span>
                        <p className="text-xs text-amber-700 flex-1">{w}</p>
                      </div>
                    ))}

                    {/* アクションボタン + 修正ガイド */}
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="mb-3 bg-gray-50 rounded-lg p-3">
                        <p className="text-[10px] text-gray-400 font-bold mb-1.5">💡 修正方法</p>
                        {r.errors.concat(r.warnings).map((msg, i) => (
                          <p key={"g" + i} className="text-[11px] text-gray-500 py-0.5">
                            {msg.includes("傷病名") ? "→ カルテの「傷病名」欄で該当する傷病名を追加してください"
                              : msg.includes("併算定") ? "→ いずれかの項目を会計から削除してください"
                              : msg.includes("回数") || msg.includes("回まで") ? "→ 同月の他の会計で重複算定がないか確認してください"
                              : msg.includes("年齢") ? "→ 患者の年齢に適した算定項目か確認してください"
                              : msg.includes("合計点数が0") ? "→ 処置内容が正しく入力されているか確認してください"
                              : msg.includes("患者負担額") ? "→ 会計画面で負担額を再計算してください"
                              : msg.includes("保険種別") ? "→ カルテの患者情報で保険種別を設定してください"
                              : msg.includes("治癒") ? "→ 傷病名の転帰を「継続」に変更するか、処置を見直してください"
                              : msg.includes("処置がありません") ? "→ 処置内容の入力漏れがないか確認してください"
                              : msg.includes("材料") ? "→ 必要な材料の算定漏れがないか確認してください"
                              : msg.includes("加算") || msg.includes("前提") ? "→ 加算の前提となる基本項目が算定されているか確認してください"
                              : msg.includes("きざみ") ? "→ きざみ計算（時間加算等）を確認してください"
                              : msg.includes("管理計画書") ? "→ カルテ画面の「📄 管理計画書」ボタンから印刷して患者に渡してください"
                              : "→ カルテを確認して該当箇所を修正してください"}
                          </p>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Link href={`/chart?patient_id=${r.patient_id}`}
                          className="bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors">
                          📋 {r.patient_name}さんのカルテを開く
                        </Link>
                        <button
                          onClick={(e) => { e.stopPropagation(); recheckOne(r.billing_id); }}
                          disabled={isRechecking || checking}
                          className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50">
                          🔄 再チェック
                        </button>
                      </div>

                      {/* 直接修正パネル */}
                      {billing && (
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-[10px] text-gray-400 font-bold mb-2">🔧 この画面で直接修正</p>
                          <div className="bg-white rounded-lg border border-gray-200 p-2 mb-2">
                            <p className="text-[10px] text-gray-500 font-bold mb-1">算定項目（クリックで削除）</p>
                            <div className="flex flex-wrap gap-1">
                              {(billing.procedures_detail || []).map((proc: { code: string; name: string; points: number; count: number }, pi: number) => (
                                <button key={pi} onClick={async (e) => {
                                  e.stopPropagation();
                                  if (!confirm(`「${proc.name}」(${proc.points}点)を削除しますか？`)) return;
                                  const newProcs = billing.procedures_detail.filter((_: unknown, i: number) => i !== pi);
                                  const newTotal = newProcs.reduce((s: number, p: { points: number; count: number }) => s + p.points * p.count, 0);
                                  await supabase.from("billing").update({
                                    procedures_detail: newProcs,
                                    total_points: newTotal,
                                    patient_burden: Math.round(newTotal * 10 * billing.burden_ratio),
                                    insurance_claim: Math.round(newTotal * 10 * (1 - billing.burden_ratio)),
                                  }).eq("id", billing.id);
                                  setBillings(prev => prev.map(b => b.id === billing.id ? { ...b, procedures_detail: newProcs, total_points: newTotal, patient_burden: Math.round(newTotal * 10 * billing.burden_ratio), insurance_claim: Math.round(newTotal * 10 * (1 - billing.burden_ratio)) } : b));
                                  recheckOne(r.billing_id);
                                }} className="text-[10px] bg-gray-50 border border-gray-200 rounded px-2 py-1 hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors"
                                  title="クリックで削除">
                                  {proc.name} ({proc.points}点) ✕
                                </button>
                              ))}
                            </div>
                          </div>
                          {r.errors.some(e => e.includes("傷病名")) && (
                            <div className="bg-white rounded-lg border border-gray-200 p-2">
                              <p className="text-[10px] text-gray-500 font-bold mb-1">傷病名クイック追加</p>
                              <div className="flex flex-wrap gap-1">
                                {[
                                  { name: "う蝕(C2)", code: "K022" },
                                  { name: "歯髄炎(Pul)", code: "K040" },
                                  { name: "根尖性歯周炎(Per)", code: "K045" },
                                  { name: "歯周炎(P)", code: "K051" },
                                  { name: "Hys", code: "K120" },
                                  { name: "智歯周囲炎", code: "K081" },
                                ].map(d => (
                                  <button key={d.code} onClick={async (e) => {
                                    e.stopPropagation();
                                    const tooth = prompt(`${d.name}の対象歯番号を入力（例: 46）`);
                                    if (!tooth) return;
                                    await supabase.from("receipt_diagnoses").insert({
                                      patient_id: r.patient_id,
                                      diagnosis_code: d.code,
                                      diagnosis_name: d.name,
                                      tooth_number_display: tooth,
                                      started_at: new Date().toISOString().split("T")[0],
                                      outcome: "continuing",
                                      is_primary: true,
                                    });
                                    recheckOne(r.billing_id);
                                  }} className="text-[10px] bg-blue-50 border border-blue-200 rounded px-2 py-1 hover:bg-blue-100 text-blue-700 font-bold">
                                    + {d.name}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* レセ電への導線 */}
        {checkDone && (summary.error > 0 || summary.warn > 0) && (
          <div className="mt-6 bg-gray-50 border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-2">
              💡 エラーや警告のある項目は、カルテを開いて修正した後「🔄 再チェック」で確認できます。
              会計データを修正すれば、レセ電ダウンロード時にも自動的に反映されます。
            </p>
            <Link href="/billing" className="text-xs text-sky-600 hover:text-sky-800 font-bold underline">
              📄 レセ電ダウンロード画面へ →
            </Link>
          </div>
        )}

        {/* 返戻管理 */}
        <div className="mt-8 bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-800">📨 返戻管理</h2>
            <label className="cursor-pointer">
              <span className="text-xs font-bold bg-gray-100 text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-200 inline-block border border-gray-200">
                📤 返戻UKEファイルを読み込む
              </span>
              <input type="file" accept=".uke,.UKE,.csv,.txt" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const text = await file.text();
                const lines = text.split("\n").filter(l => l.trim());
                const henreiList: { patient_name: string; ym: string; reason: string; points: string }[] = [];
                for (const line of lines) {
                  if (line.startsWith("HR,") || line.includes("返戻")) {
                    const parts = line.split(",");
                    henreiList.push({
                      patient_name: parts[3] || parts[1] || "不明",
                      ym: parts[2] || "",
                      reason: parts[5] || parts[4] || "理由不明",
                      points: parts[6] || parts[3] || "0",
                    });
                  }
                }
                if (henreiList.length === 0) {
                  henreiList.push({ patient_name: "ファイル読込済", ym: "", reason: `${lines.length}行のデータ。手動確認が必要`, points: "" });
                }
                setHenreiItems(henreiList);
              }} />
            </label>
          </div>
          {henreiItems.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xs text-gray-400">返戻UKEファイルをアップロードすると、返戻理由と対象患者が表示されます</p>
              <p className="text-[10px] text-gray-300 mt-1">社保: 支払基金サイト → 返戻ファイルDL / 国保: 国保連合会ポータル → 返戻ファイルDL</p>
            </div>
          ) : (
            <div className="space-y-2">
              {henreiItems.map((h, i) => (
                <div key={i} className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                  <span className="text-red-500 text-lg">📨</span>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-gray-800">{h.patient_name}</p>
                    <p className="text-[10px] text-gray-500">{h.ym && `診療年月: ${h.ym} ・ `}{h.points && `${h.points}点 ・ `}{h.reason}</p>
                  </div>
                  <span className="text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded font-bold">要再請求</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* オンライン請求ガイド */}
        <div className="mt-6 bg-sky-50 rounded-xl border border-sky-200 p-5 mb-8">
          <h2 className="text-sm font-bold text-sky-800 mb-3">🌐 オンライン請求手順</h2>
          <div className="space-y-2 text-xs text-gray-600">
            <div className="flex gap-2"><span className="bg-sky-200 text-sky-800 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold flex-shrink-0">1</span><p>会計画面「📄 レセ電」でUKEファイルをダウンロード</p></div>
            <div className="flex gap-2"><span className="bg-sky-200 text-sky-800 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold flex-shrink-0">2</span><p><strong>社保</strong>: <a href="https://www.ssk.or.jp/" target="_blank" className="text-sky-600 underline">支払基金オンラインシステム</a>にログイン → 請求ファイル送信</p></div>
            <div className="flex gap-2"><span className="bg-sky-200 text-sky-800 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold flex-shrink-0">3</span><p><strong>国保</strong>: <a href="https://www.kokuho.or.jp/" target="_blank" className="text-sky-600 underline">国保連合会ポータル</a>にログイン → 請求ファイル送信</p></div>
            <div className="flex gap-2"><span className="bg-sky-200 text-sky-800 rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold flex-shrink-0">4</span><p>送信後、返戻ファイルが届いたら上の「返戻管理」で読み込み → 修正 → 再請求</p></div>
          </div>
        </div>
      </main>
    </div>
  );
}
