"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type BillingRow = {
  id: string; record_id: string; patient_id: string;
  total_points: number; patient_burden: number; insurance_claim: number; burden_ratio: number;
  procedures_detail: { code: string; name: string; points: number; category: string; count: number; note: string; tooth_numbers?: string[] }[];
  ai_check_warnings: string[];
  claim_status: string; payment_status: string; created_at: string;
  patients: { name_kanji: string; name_kana: string; insurance_type: string } | null;
};

type DiagRow = {
  id: string; patient_id: string; diagnosis_code: string; diagnosis_name: string;
  tooth_number: string; start_date: string; end_date: string | null; outcome: string;
};

type CheckResult = {
  billing_id: string;
  patient_id: string;
  patient_name: string;
  status: "pending" | "checking" | "ok" | "warn" | "error";
  errors: string[];
  warnings: string[];
};

type CalcRule = {
  id: string;
  rule_type: string;
  source_code: string;
  target_code: string | null;
  condition: Record<string, unknown>;
  error_level: string;
  message: string;
  legal_basis: string;
};

type DiagReq = {
  id: string;
  procedure_code_pattern: string;
  required_diagnosis_keywords: string[];
  required_icd_prefixes: string[];
  error_level: string;
  message: string;
  legal_basis: string;
};

type FilterTab = "all" | "error" | "warn" | "ok";

// ============================
// DB駆動チェックエンジン
// ============================
function runChecks(
  billing: BillingRow,
  diagnoses: DiagRow[],
  allBillings: BillingRow[],
  calcRules: CalcRule[],
  diagReqs: DiagReq[]
): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const procs = billing.procedures_detail || [];
  const codes = procs.map(p => p.code);

  const addIssue = (level: string, msg: string, basis: string) => {
    const fullMsg = basis ? `${msg}【${basis}】` : msg;
    if (level === "error") errors.push(fullMsg);
    else warnings.push(fullMsg);
  };

  for (const rule of calcRules) {
    switch (rule.rule_type) {
      case "zero_points":
        if (billing.total_points <= 0) addIssue(rule.error_level, rule.message, rule.legal_basis);
        break;

      case "no_diagnosis":
        if (diagnoses.length === 0) addIssue(rule.error_level, rule.message, rule.legal_basis);
        break;

      case "no_procedure": {
        const hasOnlyConsult = procs.every(p =>
          p.code.startsWith("A0") || p.code.startsWith("A001") || p.code.startsWith("A002")
        );
        if (hasOnlyConsult && procs.length > 0) addIssue(rule.error_level, rule.message, rule.legal_basis);
        break;
      }

      case "all_cured": {
        const curedDiags = diagnoses.filter(d => d.outcome === "cured");
        if (curedDiags.length > 0 && curedDiags.length === diagnoses.length && procs.length > 0) {
          addIssue(rule.error_level, rule.message, rule.legal_basis);
        }
        break;
      }

      case "burden_mismatch": {
        const expectedBurden = Math.round(billing.total_points * 10 * billing.burden_ratio);
        const roundedExpected = Math.round(expectedBurden / 10) * 10;
        if (Math.abs(billing.patient_burden - roundedExpected) > 10) {
          addIssue(rule.error_level,
            `${rule.message}（期待:¥${roundedExpected} / 実際:¥${billing.patient_burden}）`,
            rule.legal_basis);
        }
        break;
      }

      case "insurance_missing":
        if (!billing.patients?.insurance_type) addIssue(rule.error_level, rule.message, rule.legal_basis);
        break;

      case "cannot_combine": {
        const hasSource = codes.some(c => c === rule.source_code || c.startsWith(rule.source_code));
        const hasTarget = rule.target_code
          ? codes.some(c => c === rule.target_code || c.startsWith(rule.target_code!))
          : false;
        if (hasSource && hasTarget) addIssue(rule.error_level, rule.message, rule.legal_basis);
        break;
      }

      case "frequency_month": {
        const maxPerMonth = (rule.condition as { max_per_month?: number }).max_per_month || 1;
        const billingMonth = billing.created_at.substring(0, 7);
        const sameMonthBillings = allBillings.filter(b =>
          b.patient_id === billing.patient_id && b.created_at.substring(0, 7) === billingMonth
        );
        let totalCount = 0;
        sameMonthBillings.forEach(b => {
          (b.procedures_detail || []).forEach(p => {
            if (p.code === rule.source_code || p.code.startsWith(rule.source_code)) {
              totalCount += p.count;
            }
          });
        });
        if (totalCount > maxPerMonth) {
          addIssue(rule.error_level,
            `${rule.message}（${billingMonth}月: ${totalCount}回）`,
            rule.legal_basis);
        }
        break;
      }

      case "tooth_conflict": {
        const sourceProcs = procs.filter(p =>
          p.code === rule.source_code || p.code.startsWith(rule.source_code)
        );
        const extractedTeeth: string[] = [];
        sourceProcs.forEach(p => {
          if (p.tooth_numbers) extractedTeeth.push(...p.tooth_numbers);
        });
        if (extractedTeeth.length > 0 && rule.target_code === "*") {
          procs.forEach(p => {
            if (p.code === rule.source_code || p.code.startsWith(rule.source_code)) return;
            if (p.tooth_numbers) {
              const overlap = p.tooth_numbers.filter(t => extractedTeeth.includes(t));
              if (overlap.length > 0) {
                addIssue(rule.error_level,
                  `${rule.message}（${overlap.map(t => "#" + t).join(",")} に ${p.name}）`,
                  rule.legal_basis);
              }
            }
          });
        }
        break;
      }

      case "requires_other": {
        const hasSource = codes.some(c => c === rule.source_code || c.startsWith(rule.source_code));
        if (hasSource && rule.target_code) {
          const hasTarget = codes.some(c => c === rule.target_code || c.startsWith(rule.target_code!));
          const orCode = (rule.condition as { or_code?: string }).or_code;
          const hasOr = orCode ? codes.some(c => c === orCode || c.startsWith(orCode)) : false;
          if (!hasTarget && !hasOr) {
            addIssue(rule.error_level, rule.message, rule.legal_basis);
          }
        }
        break;
      }
    }
  }

  for (const req of diagReqs) {
    const matchingProcs = procs.filter(p =>
      p.code === req.procedure_code_pattern ||
      p.code.startsWith(req.procedure_code_pattern)
    );
    if (matchingProcs.length === 0) continue;

    const hasDiag = diagnoses.some(d => {
      const nameMatch = req.required_diagnosis_keywords.some(kw =>
        d.diagnosis_name.includes(kw)
      );
      const icdMatch = req.required_icd_prefixes.length > 0
        ? req.required_icd_prefixes.some(prefix => d.diagnosis_code.startsWith(prefix))
        : false;
      return nameMatch || icdMatch;
    });

    if (!hasDiag) {
      addIssue(req.error_level, req.message, req.legal_basis);
    }
  }

  if (billing.ai_check_warnings && billing.ai_check_warnings.length > 0) {
    billing.ai_check_warnings.forEach(w => warnings.push(w));
  }

  return { errors, warnings };
}

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
  const [calcRules, setCalcRules] = useState<CalcRule[]>([]);
  const [diagReqs, setDiagReqs] = useState<DiagReq[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadRules() {
      const [{ data: rules }, { data: reqs }] = await Promise.all([
        supabase.from("calculation_rules").select("*").eq("is_active", true),
        supabase.from("diagnosis_requirements").select("*").eq("is_active", true),
      ]);
      setCalcRules((rules || []) as CalcRule[]);
      setDiagReqs((reqs || []) as DiagReq[]);
      setRulesLoaded(true);
    }
    loadRules();
  }, []);

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
      .select("*, patients(name_kanji, name_kana, insurance_type)")
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

  async function fetchDiagnoses(patientIds: string[]): Promise<DiagRow[]> {
    const { data } = await supabase
      .from("patient_diagnoses")
      .select("id, patient_id, diagnosis_code, diagnosis_name, tooth_number, start_date, end_date, outcome")
      .in("patient_id", patientIds);
    return (data || []) as DiagRow[];
  }

  async function startCheck() {
    if (billings.length === 0) return;
    setChecking(true);
    setCheckDone(false);
    setExpandedId(null);
    setFilterTab("all");

    const patientIds = Array.from(new Set(billings.map(b => b.patient_id)));
    const allDiags = await fetchDiagnoses(patientIds);

    for (let i = 0; i < billings.length; i++) {
      setResults(prev => prev.map((r, idx) => idx === i ? { ...r, status: "checking" } : r));
      await new Promise(res => setTimeout(res, 80));

      const billing = billings[i];
      const patientDiags = allDiags.filter(d => d.patient_id === billing.patient_id);
      const { errors, warnings } = runChecks(billing, patientDiags, billings, calcRules, diagReqs);

      await new Promise(res => setTimeout(res, 200 + Math.random() * 300));

      setResults(prev => prev.map((r, idx) => idx === i ? {
        ...r,
        status: errors.length > 0 ? "error" : warnings.length > 0 ? "warn" : "ok",
        errors,
        warnings,
      } : r));
    }

    setChecking(false);
    setCheckDone(true);
  }

  // 1件だけ再チェック（修正後に使う）
  async function recheckOne(billingId: string) {
    setRecheckingId(billingId);
    const idx = results.findIndex(r => r.billing_id === billingId);
    if (idx < 0) { setRecheckingId(null); return; }

    // billingデータを再取得（修正が反映されるように）
    const { data: freshBilling } = await supabase
      .from("billing")
      .select("*, patients(name_kanji, name_kana, insurance_type)")
      .eq("id", billingId)
      .single();

    if (!freshBilling) { setRecheckingId(null); return; }
    const bill = freshBilling as unknown as BillingRow;

    // billings配列も更新
    setBillings(prev => prev.map((b, i) => i === idx ? bill : b));

    setResults(prev => prev.map((r, i) => i === idx ? { ...r, status: "checking" } : r));
    await new Promise(res => setTimeout(res, 500));

    const allDiags = await fetchDiagnoses([bill.patient_id]);
    const patientDiags = allDiags.filter(d => d.patient_id === bill.patient_id);

    // allBillingsも最新にする
    const updatedBillings = billings.map((b, i) => i === idx ? bill : b);
    const { errors, warnings } = runChecks(bill, patientDiags, updatedBillings, calcRules, diagReqs);

    setResults(prev => prev.map((r, i) => i === idx ? {
      ...r,
      patient_name: bill.patients?.name_kanji || "不明",
      status: errors.length > 0 ? "error" : warnings.length > 0 ? "warn" : "ok",
      errors,
      warnings,
    } : r));
    setRecheckingId(null);
  }

  // 全件再チェック
  async function recheckAll() {
    setChecking(true);
    setExpandedId(null);

    // 全billingデータを再取得
    const ym = checkMonth;
    const startDate = `${ym}-01T00:00:00`;
    const endDay = new Date(parseInt(ym.split("-")[0]), parseInt(ym.split("-")[1]), 0).getDate();
    const endDate = `${ym}-${String(endDay).padStart(2, "0")}T23:59:59`;

    const { data } = await supabase
      .from("billing")
      .select("*, patients(name_kanji, name_kana, insurance_type)")
      .eq("payment_status", "paid")
      .gte("created_at", startDate)
      .lte("created_at", endDate)
      .order("created_at");

    if (!data) { setChecking(false); return; }
    const freshBillings = data as unknown as BillingRow[];
    setBillings(freshBillings);

    const patientIds = Array.from(new Set(freshBillings.map(b => b.patient_id)));
    const allDiags = await fetchDiagnoses(patientIds);

    const newResults: CheckResult[] = [];
    for (const bill of freshBillings) {
      const patientDiags = allDiags.filter(d => d.patient_id === bill.patient_id);
      const { errors, warnings } = runChecks(bill, patientDiags, freshBillings, calcRules, diagReqs);
      newResults.push({
        billing_id: bill.id,
        patient_id: bill.patient_id,
        patient_name: bill.patients?.name_kanji || "不明",
        status: errors.length > 0 ? "error" : warnings.length > 0 ? "warn" : "ok",
        errors,
        warnings,
      });
    }
    setResults(newResults);
    setChecking(false);
    setCheckDone(true);
  }

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
                ルール{calcRules.length + diagReqs.length}件読込済
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
              <button onClick={loadMonthData} disabled={loading || !rulesLoaded}
                className="bg-gray-800 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-gray-700 disabled:opacity-50">
                {loading ? "読み込み中..." : !rulesLoaded ? "ルール読込中..." : "📋 レセプト一覧を取得"}
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
              <div className="pt-5">
                <button onClick={recheckAll}
                  className="bg-emerald-600 text-white px-6 py-2.5 rounded-lg text-sm font-bold hover:bg-emerald-700 transition-all">
                  🔄 全件再チェック
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

                    {/* アクションボタン */}
                    <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
                      <Link href="/chart" className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-xs font-bold transition-colors">
                        📋 カルテを開く（{r.patient_name}）
                      </Link>
                      <button
                        onClick={(e) => { e.stopPropagation(); recheckOne(r.billing_id); }}
                        disabled={isRechecking || checking}
                        className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-4 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50">
                        🔄 再チェック
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* レセ電への導線（エラーがある場合） */}
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
      </main>
    </div>
  );
}
