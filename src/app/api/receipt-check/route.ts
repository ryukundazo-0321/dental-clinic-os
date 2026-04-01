import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface BillingRow {
  id: string;
  patient_id: string;
  medical_record_id: string;
  total_points: number;
  patient_burden: number;
  burden_ratio: number;
  ai_check_warnings: string[];
  document_provided: boolean;
  payment_status: string;
  created_at: string;
}

interface ReceiptProcedure {
  id: string;
  medical_record_id: string;
  patient_id: string;
  fee_code: string;
  fee_name: string;
  points: number;
  count: number;
  shinryo_shikibetsu: string;
  futan_kubun: string;
}

interface PatientInfo {
  id: string;
  name_kanji: string;
  name_kana: string;
  date_of_birth: string | null;
  patient_insurances?: { insurance_type: string | null; burden_ratio: number | null; is_current: boolean }[];
}

interface ReceiptDiagnosis {
  id: string;
  patient_id: string;
  diagnosis_code: string;
  diagnosis_name: string;
  tooth_number_display: string | null;
  started_at: string | null;
  ended_at: string | null;
  outcome: string | null;
}

interface CalcRule {
  id: string;
  rule_type: string;
  target_code: string;
  condition_code: string | null;
  limit_count: number | null;
  limit_period: string | null;
  age_min: number | null;
  age_max: number | null;
  description: string | null;
}

interface DiagReq {
  id: string;
  procedure_code_pattern: string;
  required_diagnosis_keywords: string[];
  required_icd_prefixes: string[];
  message: string;
  error_level: string;
  legal_basis: string | null;
}

interface CheckResult {
  billing_id: string;
  patient_id: string;
  patient_name: string;
  status: "ok" | "warn" | "error";
  errors: string[];
  warnings: string[];
}

function calcAge(dob: string | null, refDate: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const ref = new Date(refDate);
  let age = ref.getFullYear() - birth.getFullYear();
  const m = ref.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
  return age;
}

export async function POST(request: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseKey);
  try {
    const body = await request.json();
    const { yearMonth, billing_ids } = body;
    if (!yearMonth) {
      return NextResponse.json({ error: "yearMonth (YYYY-MM) is required" }, { status: 400 });
    }
    const ym = yearMonth;
    const startDate = `${ym}-01T00:00:00`;
    const endDay = new Date(parseInt(ym.split("-")[0]), parseInt(ym.split("-")[1]), 0).getDate();
    const endDate = `${ym}-${String(endDay).padStart(2, "0")}T23:59:59`;

    const [{ data: billings }, { data: calcRulesData }, { data: diagReqsData }] = await Promise.all([
      billing_ids && billing_ids.length > 0
        ? supabase.from("billing").select("id, patient_id, medical_record_id, total_points, patient_burden, burden_ratio, ai_check_warnings, document_provided, payment_status, created_at").in("id", billing_ids)
        : supabase.from("billing").select("id, patient_id, medical_record_id, total_points, patient_burden, burden_ratio, ai_check_warnings, document_provided, payment_status, created_at").eq("payment_status", "paid").gte("created_at", startDate).lte("created_at", endDate).order("created_at"),
      supabase.from("m_calculation_rules").select("*").eq("is_active", true),
      supabase.from("diagnosis_requirements").select("*").eq("is_active", true),
    ]);

    if (!billings || billings.length === 0) {
      return NextResponse.json({ success: true, results: [], summary: { total: 0, ok: 0, warn: 0, error: 0 }, message: "該当月の精算済みデータがありません" });
    }

    const typedBillings = billings as unknown as BillingRow[];
    const medicalRecordIds = typedBillings.map(b => b.medical_record_id).filter(Boolean);

    const { data: allProcedures } = await supabase
      .from("receipt_procedures")
      .select("id, medical_record_id, patient_id, fee_code, fee_name, points, count, shinryo_shikibetsu, futan_kubun")
      .in("medical_record_id", medicalRecordIds);

    const procsByMedicalRecord = new Map<string, ReceiptProcedure[]>();
    for (const p of (allProcedures || []) as ReceiptProcedure[]) {
      if (!procsByMedicalRecord.has(p.medical_record_id)) procsByMedicalRecord.set(p.medical_record_id, []);
      procsByMedicalRecord.get(p.medical_record_id)!.push(p);
    }

    const rules = (calcRulesData || []) as CalcRule[];
    const rulesByType = new Map<string, CalcRule[]>();
    for (const rule of rules) {
      if (!rulesByType.has(rule.rule_type)) rulesByType.set(rule.rule_type, []);
      rulesByType.get(rule.rule_type)!.push(rule);
    }
    const getRules = (type: string): CalcRule[] => rulesByType.get(type) || [];
    const addRules = [...getRules("h2"), ...getRules("h3"), ...getRules("h4")];
    const matRules = getRules("h5");
    const freqRules = getRules("h6");
    const incrRules = getRules("h7");
    const ageRules = getRules("h8");
    const exclRules = getRules("h9");
    const diagReqs = (diagReqsData || []) as DiagReq[];

    const freqByCode = new Map<string, CalcRule[]>();
    for (const r of freqRules) {
      if (!freqByCode.has(r.target_code)) freqByCode.set(r.target_code, []);
      freqByCode.get(r.target_code)!.push(r);
    }
    const ageByCode = new Map<string, CalcRule[]>();
    for (const r of ageRules) {
      if (!ageByCode.has(r.target_code)) ageByCode.set(r.target_code, []);
      ageByCode.get(r.target_code)!.push(r);
    }

    const patientIds = Array.from(new Set(typedBillings.map((b) => b.patient_id)));
    const { data: patientsData } = await supabase.from("patients").select("id, name_kanji, name_kana, date_of_birth, patient_insurances(*)").in("id", patientIds);
    const patientMap = new Map<string, PatientInfo>((patientsData || []).map((p: PatientInfo) => [p.id, p]));

    const { data: allDiags } = await supabase.from("receipt_diagnoses").select("id, patient_id, diagnosis_code, diagnosis_name, tooth_number_display, started_at, ended_at, outcome").in("patient_id", patientIds);
    const diagsByPatient = new Map<string, ReceiptDiagnosis[]>();
    for (const d of (allDiags || []) as ReceiptDiagnosis[]) {
      if (!diagsByPatient.has(d.patient_id)) diagsByPatient.set(d.patient_id, []);
      diagsByPatient.get(d.patient_id)!.push(d);
    }

    const results: CheckResult[] = [];
    for (const billing of typedBillings) {
      const errors: string[] = [];
      const warnings: string[] = [];
      const patient = patientMap.get(billing.patient_id);
      const diagnoses = diagsByPatient.get(billing.patient_id) || [];
      const procs = procsByMedicalRecord.get(billing.medical_record_id) || [];
      const officialCodes = new Set(procs.map(p => p.fee_code).filter(Boolean));
      const billingDate = billing.created_at.substring(0, 10);
      const billingMonth = billing.created_at.substring(0, 7);
      const sameMonthBillings = typedBillings.filter((b) => b.patient_id === billing.patient_id && b.created_at.substring(0, 7) === billingMonth);
      const sameDayBillings = sameMonthBillings.filter((b) => b.created_at.substring(0, 10) === billingDate);

      if (billing.total_points <= 0) errors.push("合計点数が0以下です【算定要件】");
      if (diagnoses.length === 0) errors.push("傷病名が1つも登録されていません【療担規則】");
      if (procs.length === 0) warnings.push("処置が1件も登録されていません。処置内容の入力漏れがないか確認してください");
      const allCured = diagnoses.length > 0 && diagnoses.every((d) => d.outcome === "cured");
      if (allCured && procs.length > 0) warnings.push("全ての傷病名が治癒ですが処置が算定されています");
      const expectedBurden = Math.round(billing.total_points * 10 * billing.burden_ratio);
      const roundedExpected = Math.round(expectedBurden / 10) * 10;
      if (Math.abs(billing.patient_burden - roundedExpected) > 10) errors.push("患者負担額が計算と不一致です【算定要件】");
      if (!patient?.patient_insurances?.[0]?.insurance_type) errors.push("保険種別が未設定です【請求要件】");

      for (const proc of procs) {
        if (!proc.fee_code) continue;
        const limits = freqByCode.get(proc.fee_code);
        if (!limits) continue;
        for (const limit of limits) {
          const targetBillings = limit.limit_period === "day" ? sameDayBillings : sameMonthBillings;
          let totalCount = 0;
          for (const b of targetBillings) {
            const bProcs = procsByMedicalRecord.get(b.medical_record_id) || [];
            for (const p of bProcs) { if (p.fee_code === proc.fee_code) totalCount += p.count; }
          }
          if (limit.limit_count !== null && totalCount > limit.limit_count) {
            const periodLabel = limit.limit_period === "day" ? "1日" : "月";
            errors.push("「" + proc.fee_name + "」は" + periodLabel + limit.limit_count + "回までです（現在: " + totalCount + "回）【算定回数制限】");
          }
        }
      }

      for (const rule of exclRules) {
        const hasTarget = officialCodes.has(rule.target_code);
        const hasCondition = rule.condition_code && officialCodes.has(rule.condition_code);
        if (hasTarget && hasCondition) errors.push("「" + rule.target_code + "」と「" + rule.condition_code + "」は同日に併算定できません【併算定不可】" + (rule.description ? "：" + rule.description : ""));
      }
      if (sameMonthBillings.length > 1) {
        const otherCodes = new Set<string>();
        for (const ob of sameMonthBillings) {
          if (ob.id === billing.id) continue;
          const obProcs = procsByMedicalRecord.get(ob.medical_record_id) || [];
          for (const p of obProcs) { if (p.fee_code) otherCodes.add(p.fee_code); }
        }
        for (const rule of exclRules) {
          if (!rule.condition_code) continue;
          if ((officialCodes.has(rule.target_code) && otherCodes.has(rule.condition_code)) || (officialCodes.has(rule.condition_code) && otherCodes.has(rule.target_code))) {
            warnings.push("「" + rule.target_code + "」と「" + rule.condition_code + "」が同月の別会計で算定されています【要確認】");
          }
        }
      }

      const patientAge = calcAge(patient?.date_of_birth || null, billingDate);
      if (patientAge !== null) {
        for (const proc of procs) {
          if (!proc.fee_code) continue;
          const limits = ageByCode.get(proc.fee_code);
          if (!limits) continue;
          for (const rule of limits) {
            if (rule.age_min !== null && patientAge < rule.age_min) warnings.push("「" + proc.fee_name + "」は" + rule.age_min + "歳以上が対象です（患者: " + patientAge + "歳）【年齢制限】");
            if (rule.age_max !== null && patientAge > rule.age_max) warnings.push("「" + proc.fee_name + "」は" + rule.age_max + "歳以下が対象です（患者: " + patientAge + "歳）【年齢制限】");
          }
        }
      }

      for (const proc of procs) {
        if (!proc.fee_code) continue;
        const asAddition = addRules.filter((r) => r.target_code === proc.fee_code);
        for (const rule of asAddition) {
          if (!rule.condition_code) continue;
          if (!officialCodes.has(rule.condition_code)) warnings.push("「" + proc.fee_name + "」は基本項目「" + rule.condition_code + "」の算定が前提です【加算要件】" + (rule.description ? "：" + rule.description : ""));
        }
      }

      for (const proc of procs) {
        if (!proc.fee_code) continue;
        const matRequired = matRules.filter((r) => r.target_code === proc.fee_code);
        if (matRequired.length === 0) continue;
        const hasMaterial = procs.some((p) => p.shinryo_shikibetsu === "TO");
        if (!hasMaterial) { warnings.push("「" + proc.fee_name + "」には特定器材の算定が必要な場合があります【材料条件】"); break; }
      }

      for (const proc of procs) {
        if (!proc.fee_code) continue;
        const incrRule = incrRules.find((r) => r.target_code === proc.fee_code);
        if (!incrRule || !incrRule.limit_count) continue;
        if (proc.points > 0 && incrRule.limit_count > 0 && proc.points % incrRule.limit_count !== 0) {
          warnings.push("「" + proc.fee_name + "」の点数（" + proc.points + "点）がきざみ単位（" + incrRule.limit_count + "点）と合いません【きざみ点数】");
        }
      }

      for (const req of diagReqs) {
        const matchingProcs = procs.filter((p) => p.fee_code === req.procedure_code_pattern || p.fee_code.startsWith(req.procedure_code_pattern));
        if (matchingProcs.length === 0) continue;
        const hasDiag = diagnoses.some((d) => {
          const nameMatch = req.required_diagnosis_keywords.some((kw) => d.diagnosis_name.includes(kw));
          const icdMatch = req.required_icd_prefixes.length > 0 ? req.required_icd_prefixes.some((prefix) => d.diagnosis_code.startsWith(prefix)) : false;
          return nameMatch || icdMatch;
        });
        if (!hasDiag) {
          const fullMsg = req.legal_basis ? req.message + "【" + req.legal_basis + "】" : req.message;
          if (req.error_level === "error") errors.push(fullMsg); else warnings.push(fullMsg);
        }
      }

      if (billing.ai_check_warnings && billing.ai_check_warnings.length > 0) {
        for (const w of billing.ai_check_warnings) {
          if (w.includes("管理計画書") && billing.document_provided) continue;
          warnings.push(w);
        }
      }

      results.push({ billing_id: billing.id, patient_id: billing.patient_id, patient_name: patient?.name_kanji || "不明", status: errors.length > 0 ? "error" : warnings.length > 0 ? "warn" : "ok", errors, warnings });
    }

    const summary = { total: results.length, ok: results.filter((r) => r.status === "ok").length, warn: results.filter((r) => r.status === "warn").length, error: results.filter((r) => r.status === "error").length };
    return NextResponse.json({ success: true, results, summary, rules_loaded: { h2_h3_h4_addition: addRules.length, h5_materials: matRules.length, h6_frequency: freqRules.length, h7_incremental: incrRules.length, h8_age: ageRules.length, h9_exclusive: exclRules.length, m_calculation_rules_total: rules.length, diagnosis_requirements: diagReqs.length } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "レセプトチェックエラー", detail: msg }, { status: 500 });
  }
}

export async function GET() {
  const supabase = createClient(supabaseUrl, supabaseKey);
  try {
    const { data: rules, error } = await supabase.from("m_calculation_rules").select("rule_type").eq("is_active", true);
    if (error) throw error;
    const countByType: Record<string, number> = {};
    for (const rule of rules || []) { countByType[rule.rule_type] = (countByType[rule.rule_type] || 0) + 1; }
    return NextResponse.json({ status: "ready", table: "m_calculation_rules", rules: { h2_tsukisoku_kazan: countByType["h2"] || 0, h3_kihon_kazan: countByType["h3"] || 0, h4_chu_kazan: countByType["h4"] || 0, h5_material: countByType["h5"] || 0, h6_frequency: countByType["h6"] || 0, h7_kizami: countByType["h7"] || 0, h8_age: countByType["h8"] || 0, h9_exclusive: countByType["h9"] || 0, h10_jitsunissuu: countByType["h10"] || 0, total: (rules || []).length } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "ルール取得エラー", detail: msg }, { status: 500 });
  }
}
