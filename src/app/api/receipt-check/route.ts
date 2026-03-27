import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ============================================================
// 型定義
// ============================================================
interface BillingRow {
  id: string;
  record_id: string;
  patient_id: string;
  total_points: number;
  patient_burden: number;
  insurance_claim: number;
  burden_ratio: number;
  procedures_detail: ProcDetail[];
  ai_check_warnings: string[];
  document_provided: boolean;
  claim_status: string;
  payment_status: string;
  created_at: string;
}

interface ProcDetail {
  code: string;
  name: string;
  points: number;
  category: string;
  count: number;
  note: string;
  tooth_numbers?: string[];
}

interface PatientInfo {
  id: string;
  name_kanji: string;
  name_kana: string;
  insurance_type: string;
  date_of_birth: string | null;
  burden_ratio: number;
}

// receipt_diagnosesテーブルの型（新テーブル）
interface ReceiptDiagnosis {
  id: string;
  patient_id: string;
  diagnosis_code: string;
  diagnosis_name: string;
  tooth_number_display: string | null;
  started_at: string | null;
  ended_at: string | null;
  outcome: string;
}

// m_calculation_rulesテーブルの型
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
  is_active: boolean;
}

// diagnosis_requirementsテーブルの型
// ※ 公式マスタには傷病名要件が存在しないため独自管理
// ※ 将来的にprocedure_master.applicable_diagnosesと統合予定（4-0a-①完了後）
interface DiagReq {
  id: string;
  procedure_code_pattern: string;
  required_diagnosis_keywords: string[];
  required_icd_prefixes: string[];
  error_level: string;
  message: string;
  legal_basis: string | null;
  is_active: boolean;
}

interface CheckResult {
  billing_id: string;
  patient_id: string;
  patient_name: string;
  status: "ok" | "warn" | "error";
  errors: string[];
  warnings: string[];
}

// ============================================================
// 独自コード → 公式9桁コード変換（CODE_MAP）
// procedure_masterのfee_itemsが9桁に統一されるまでの暫定変換表
// 4-0a-①完了後にこのマップは削除し、m_fees.sub_codeで動的取得に移行する
// ============================================================
const CODE_MAP: Record<string, string> = {
  "A000-1": "301000110", "A000": "301000110", "A000-2": "301000210",
  "A002-1": "301001610", "A002": "301001610", "A002-2": "301001710", "A002-nyuji": "301001610",
  "A001-a": "302000610", "A001-b": "302000610",
  "B000-4": "302000110", "B000-4-init": "302000110", "B000-4-doc": "302008470",
  "B001-2": "302000610", "B002": "302000710", "B000-8": "302000610",
  "E100-1": "305000210", "E100-pan": "305000410", "E100-pano": "305000410",
  "E100-ct": "305004910", "E100-1-diag": "305000210", "E100-1-diag-pano": "305000210",
  "E200-diag": "305000410",
  "E000-305000410": "305000410", "E000-305000510": "305000510", "E000-305004910": "305004910",
  "F100": "306000110", "F200": "306000710", "F400": "306001310",
  "F-shoho": "306000710", "F-chozai": "306000110",
  "I000-1": "309000110", "I000-2": "309000210", "I000-3": "309000310", "I000-4": "309019810",
  "I001--1": "309019510", "I001--2": "309000210", "I001-1": "309000110", "I001-2": "309000210",
  "I002-309001310": "309001310", "I003-309001710": "309001710", "I004-309001910": "309001910",
  "I005--1": "309002110", "I005--2": "309002210", "I005--3": "309002310",
  "I005-1": "309002110", "I005-2": "309002210", "I005-3": "309002310",
  "I006--1": "309002410", "I006--2": "309002510", "I006--3": "309002610",
  "I006-1": "309002410", "I006-2": "309002510", "I006-3": "309002610",
  "I007--1": "309002710", "I007--2": "309002810", "I007--3": "309002910",
  "I007-1": "309002710", "I007-2": "309002810", "I007-3": "309002910",
  "I008--1": "309003610", "I008--2": "309003710", "I008--3": "309003810",
  "I008-1": "309003610", "I008-2": "309003710", "I008-3": "309003810",
  "I008-309014310": "309014310", "I008-309014410": "309014410", "I008-309014510": "309014510",
  "I010": "309015110", "I010--1": "309004610", "I010-1": "309004610",
  "I011--1": "309004810", "I011--2-1": "309005010", "I011--2-2": "309005110", "I011--2-3": "309005210",
  "I011-1": "309004810", "I011-2-1": "309005010", "I011-2-2": "309005110", "I011-2-3": "309005210",
  "I011-309014710": "309014710", "I011-309014810": "309014810", "I011-309005710": "309005710",
  "I011-309019610": "309019610", "I011-309019710": "309019710",
  "I014": "309006010", "I017": "309018810", "I020": "309008310",
  "I029": "309014710", "I030-309011410": "309011410", "I031-309015110": "309015110",
  "I032": "309011010",
  "D002--1": "309001610", "D002--2": "309001710", "D002--3": "309001710",
  "D002-2": "309001610", "D002-3": "309001710",
  "J000--1": "310000110", "J000--2": "310000210", "J000--3": "310000310",
  "J000--4": "310000410", "J000--5": "310000510",
  "J000-1": "310000110", "J000-2": "310000210", "J000-3": "310000310",
  "J000-4": "310000410", "J000-5": "310000510",
  "J001--1": "310000710", "J001--2": "310000810",
  "J001-1": "310000710", "J001-2": "310000810",
  "J003": "310003110", "J063": "310011610", "J084": "310019110",
  "K001--1": "311000210", "K001--2": "311000110",
  "K001-1": "311000210", "K001-2": "311000110", "K002": "311000110",
  "M-HOHEKI": "313027310", "M000-2": "313000210",
  "M000-313027310": "313027310", "M000-313000210": "313000210",
  "M001-1": "313000610", "M001-2": "313000910", "M001-313000710": "313000710",
  "M001-sho": "313001210", "M001-fuku": "313001310",
  "M001-3-1": "313001210", "M001-3-2": "313001310",
  "M002-1": "313002310", "M002-2": "313002410",
  "M002-313002310": "313002310", "M002-313003110": "313003110",
  "M-POST": "313002310", "M-POST-cast": "313002410", "M-TEK": "313004510",
  "M003-1": "313003210", "M003-2": "313003310", "M003-3": "313003810",
  "M003-313003210": "313003210", "M003-313003310": "313003310",
  "M-IMP": "313003610", "M-IMP-sei": "313003710",
  "M-IN-sho": "313003410", "M-IN-fuku": "313003510",
  "M005": "313024110", "M005-2": "313005310", "M-SET": "313024110",
  "M006": "313007810", "M006-313007810": "313007810", "M-BITE": "313007810",
  "M009--1": "313024310", "M009--2": "313024410",
  "M009-CR": "313024310", "M009-CR-fuku": "313024410",
  "M-KEISEI-cr": "313001210", "M-KEISEI--cr": "313001210",
  "M010-313010410": "313010410", "M010-313010510": "313010510",
  "M010-313036010": "313036010", "M010-313036110": "313036110",
  "M010-1": "313010410", "M010-2": "313010510", "M010-3": "313031810",
  "M015-1": "313015110", "M015-2": "313015210",
  "M015-2-1": "313025510", "M015-2-2": "313025510",
  "M015-3": "313015310", "M015-4": "313015410", "M016": "313030410",
  "M017-313030610": "313030610",
  "M018-1": "313016610", "M018-2": "313016710",
  "M018-2-1": "313017010", "M018-2-2": "313017010",
  "M018-3": "313016810", "M018-4": "313016910",
  "M023-313020570": "313020570",
  "M-ADJ": "313022610", "M-DEBOND": "313024110", "M-DEBOND2": "313024110",
  "DEN-SET": "313005310", "DEN-1-4": "313016610", "DEN-5-8": "313016710",
  "DEN-9-11": "313016810", "DEN-12-14": "313016910",
  "DEN-FULL-UP": "313017010", "DEN-FULL-LO": "313017010",
  "DEN-REP": "313021610", "DEN-RELINE": "313021810", "DEN-ADJ": "309008310",
  "BR-PON": "313015410", "B013-302003710": "302003710",
  "C000-303000110": "303000110",
  "A000-301000110": "301000110", "A002-301001610": "301001610",
};

/**
 * 独自コード → 公式9桁コードへ変換
 * 1) CODE_MAP直接ヒット
 * 2) 「区分コード-9桁」形式なら9桁部分を抽出
 * 3) すでに9桁数字ならそのまま使用
 */
function resolveCode(code: string): string | null {
  if (code.startsWith("DRUG-") || code.startsWith("MAT-") || code.startsWith("BONUS-")) {
    return null;
  }
  if (CODE_MAP[code]) return CODE_MAP[code];
  const dashIdx = code.indexOf("-");
  if (dashIdx !== -1) {
    const maybeSub = code.substring(dashIdx + 1);
    if (/^\d{9}$/.test(maybeSub)) return maybeSub;
  }
  if (/^\d{9}$/.test(code)) return code;
  return null;
}

/**
 * 患者の年齢を計算（歳）
 */
function calcAge(dob: string | null, refDate: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const ref = new Date(refDate);
  let age = ref.getFullYear() - birth.getFullYear();
  const monthDiff = ref.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) age--;
  return age;
}

// ============================================================
// POST /api/receipt-check
// ============================================================
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

    // ============================================================
    // 1. データ取得（並列実行）
    // ============================================================
    const [
      { data: billings },
      { data: calcRulesData },
      { data: diagReqsData },
    ] = await Promise.all([
      billing_ids && billing_ids.length > 0
        ? supabase.from("billing").select("*").in("id", billing_ids)
        : supabase
            .from("billing")
            .select("*")
            .eq("payment_status", "paid")
            .gte("created_at", startDate)
            .lte("created_at", endDate)
            .order("created_at"),
      // m_calculation_rules から全ルール取得（旧check_*6テーブルを統合したテーブル）
      supabase.from("m_calculation_rules").select("*").eq("is_active", true),
      // diagnosis_requirements（傷病名チェック用・独自ルール）
      // 将来的にprocedure_master.applicable_diagnosesと統合予定（4-0a-①完了後）
      supabase.from("diagnosis_requirements").select("*").eq("is_active", true),
    ]);

    if (!billings || billings.length === 0) {
      return NextResponse.json({
        success: true,
        results: [],
        summary: { total: 0, ok: 0, warn: 0, error: 0 },
        message: "該当月の精算済みデータがありません",
      });
    }

    // m_calculation_rules をrule_typeごとに分類
    const rules = (calcRulesData || []) as CalcRule[];
    const rulesByType = new Map<string, CalcRule[]>();
    for (const rule of rules) {
      if (!rulesByType.has(rule.rule_type)) rulesByType.set(rule.rule_type, []);
      rulesByType.get(rule.rule_type)!.push(rule);
    }
    const getRules = (type: string): CalcRule[] => rulesByType.get(type) || [];

    // 各チェック用ルール（h2/h3/h4=加算系、h5=材料、h6=回数、h7=きざみ、h8=年齢、h9=併算定不可）
    const addRules = [...getRules("h2"), ...getRules("h3"), ...getRules("h4")];
    const matRules = getRules("h5");
    const freqRules = getRules("h6");
    const incrRules = getRules("h7");
    const ageRules = getRules("h8");
    const exclRules = getRules("h9");

    // diagnosis_requirements（傷病名チェック用独自ルール）
    const diagReqs = (diagReqsData || []) as DiagReq[];

    // 高速検索用Map構築
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

    // 患者情報取得
    const patientIds = Array.from(new Set(billings.map((b: BillingRow) => b.patient_id)));
    const { data: patientsData } = await supabase
      .from("patients")
      .select("id, name_kanji, name_kana, insurance_type, date_of_birth, burden_ratio")
      .in("id", patientIds);
    const patientMap = new Map<string, PatientInfo>(
      (patientsData || []).map((p: PatientInfo) => [p.id, p])
    );

    // 傷病名取得（receipt_diagnoses：新テーブル・新カラム名）
    const { data: allDiags } = await supabase
      .from("receipt_diagnoses")
      .select("id, patient_id, diagnosis_code, diagnosis_name, tooth_number_display, started_at, ended_at, outcome")
      .in("patient_id", patientIds);
    const diagsByPatient = new Map<string, ReceiptDiagnosis[]>();
    for (const d of (allDiags || []) as ReceiptDiagnosis[]) {
      if (!diagsByPatient.has(d.patient_id)) diagsByPatient.set(d.patient_id, []);
      diagsByPatient.get(d.patient_id)!.push(d);
    }

    // ============================================================
    // 2. 各billingをチェック
    // ============================================================
    const typedBillings = billings as unknown as BillingRow[];
    const results: CheckResult[] = [];

    for (const billing of typedBillings) {
      const errors: string[] = [];
      const warnings: string[] = [];
      const patient = patientMap.get(billing.patient_id);
      const diagnoses = diagsByPatient.get(billing.patient_id) || [];
      const procs = billing.procedures_detail || [];

      // 各処置コードを9桁に解決
      const resolvedCodes = new Map<string, string>();
      for (const p of procs) {
        const rc = resolveCode(p.code);
        if (rc) resolvedCodes.set(p.code, rc);
      }
      const officialCodes = new Set(resolvedCodes.values());

      const billingDate = billing.created_at.substring(0, 10);
      const billingMonth = billing.created_at.substring(0, 7);

      const sameMonthBillings = typedBillings.filter(
        (b) => b.patient_id === billing.patient_id && b.created_at.substring(0, 7) === billingMonth
      );
      const sameDayBillings = sameMonthBillings.filter(
        (b) => b.created_at.substring(0, 10) === billingDate
      );

      // ----------------------------------------------------------
      // [基本チェック]
      // ----------------------------------------------------------
      if (billing.total_points <= 0) {
        errors.push("合計点数が0以下です。処置が正しく入力されているか確認してください【算定要件】");
      }
      if (diagnoses.length === 0) {
        errors.push("傷病名が1つも登録されていません。レセプトには傷病名が必須です【療担規則】");
      }
      const hasOnlyConsult = procs.every(
        (p) => p.code.startsWith("A0") || p.code.startsWith("A001") || p.code.startsWith("A002")
      );
      if (hasOnlyConsult && procs.length > 0) {
        warnings.push("初・再診料のみで処置がありません。処置内容の入力漏れがないか確認してください");
      }
      const allCured = diagnoses.length > 0 && diagnoses.every((d) => d.outcome === "cured");
      if (allCured && procs.length > 0) {
        warnings.push("全ての傷病名が「治癒」ですが処置が算定されています。転帰または処置を見直してください");
      }
      const expectedBurden = Math.round(billing.total_points * 10 * billing.burden_ratio);
      const roundedExpected = Math.round(expectedBurden / 10) * 10;
      if (Math.abs(billing.patient_burden - roundedExpected) > 10) {
        errors.push(
          `患者負担額が計算と不一致です（期待:¥${roundedExpected} / 実際:¥${billing.patient_burden}）【算定要件】`
        );
      }
      if (!patient?.insurance_type) {
        errors.push("保険種別が未設定です。患者情報で保険種別を設定してください【請求要件】");
      }

      // ----------------------------------------------------------
      // [チェック1] 算定回数制限（h6）
      // ----------------------------------------------------------
      for (const proc of procs) {
        const rc = resolvedCodes.get(proc.code);
        if (!rc) continue;
        const limits = freqByCode.get(rc);
        if (!limits) continue;
        for (const limit of limits) {
          const targetBillings = limit.limit_period === "day" ? sameDayBillings : sameMonthBillings;
          let totalCount = 0;
          for (const b of targetBillings) {
            for (const p of b.procedures_detail || []) {
              const prc = resolveCode(p.code);
              if (prc === rc) totalCount += p.count;
            }
          }
          if (limit.limit_count !== null && totalCount > limit.limit_count) {
            const periodLabel = limit.limit_period === "day" ? "1日" : "月";
            errors.push(
              `「${proc.name}」は${periodLabel}${limit.limit_count}回までです（現在: ${totalCount}回）【算定回数制限】`
            );
          }
        }
      }

      // ----------------------------------------------------------
      // [チェック2] 併算定不可（h9）
      // ----------------------------------------------------------
      for (const rule of exclRules) {
        const hasTarget = officialCodes.has(rule.target_code);
        const hasCondition = rule.condition_code && officialCodes.has(rule.condition_code);
        if (hasTarget && hasCondition) {
          errors.push(
            `「${rule.target_code}」と「${rule.condition_code}」は同日に併算定できません【併算定不可】${rule.description ? "：" + rule.description : ""}`
          );
        }
      }
      // 同月の他billingとのクロスチェック
      if (sameMonthBillings.length > 1) {
        const otherCodes = new Set<string>();
        for (const ob of sameMonthBillings) {
          if (ob.id === billing.id) continue;
          for (const p of ob.procedures_detail || []) {
            const rc = resolveCode(p.code);
            if (rc) otherCodes.add(rc);
          }
        }
        for (const rule of exclRules) {
          if (!rule.condition_code) continue;
          const thisHasTarget = officialCodes.has(rule.target_code);
          const otherHasCondition = otherCodes.has(rule.condition_code);
          const thisHasCondition = officialCodes.has(rule.condition_code);
          const otherHasTarget = otherCodes.has(rule.target_code);
          if ((thisHasTarget && otherHasCondition) || (thisHasCondition && otherHasTarget)) {
            warnings.push(
              `「${rule.target_code}」と「${rule.condition_code}」が同月の別会計で算定されています【要確認】`
            );
          }
        }
      }

      // ----------------------------------------------------------
      // [チェック3] 年齢制限（h8）
      // ----------------------------------------------------------
      const patientAge = calcAge(patient?.date_of_birth || null, billingDate);
      if (patientAge !== null) {
        for (const proc of procs) {
          const rc = resolvedCodes.get(proc.code);
          if (!rc) continue;
          const limits = ageByCode.get(rc);
          if (!limits) continue;
          for (const rule of limits) {
            if (rule.age_min !== null && patientAge < rule.age_min) {
              warnings.push(
                `「${proc.name}」は${rule.age_min}歳以上が対象です（患者: ${patientAge}歳）【年齢制限】`
              );
            }
            if (rule.age_max !== null && patientAge > rule.age_max) {
              warnings.push(
                `「${proc.name}」は${rule.age_max}歳以下が対象です（患者: ${patientAge}歳）【年齢制限】`
              );
            }
          }
        }
      }

      // ----------------------------------------------------------
      // [チェック4] 加算ルール（h2/h3/h4）
      // ----------------------------------------------------------
      for (const proc of procs) {
        const rc = resolvedCodes.get(proc.code);
        if (!rc) continue;
        const asAddition = addRules.filter((r) => r.target_code === rc);
        for (const rule of asAddition) {
          if (!rule.condition_code) continue;
          if (!officialCodes.has(rule.condition_code)) {
            warnings.push(
              `「${proc.name}」は基本項目「${rule.condition_code}」の算定が前提です【加算要件】${rule.description ? "：" + rule.description : ""}`
            );
          }
        }
      }

      // ----------------------------------------------------------
      // [チェック5] 材料条件（h5）
      // ----------------------------------------------------------
      for (const proc of procs) {
        const rc = resolvedCodes.get(proc.code);
        if (!rc) continue;
        const matRequired = matRules.filter((r) => r.target_code === rc);
        if (matRequired.length === 0) continue;
        const hasMaterial = procs.some(
          (p) => p.code.startsWith("MAT-") || p.category === "特定器材"
        );
        if (!hasMaterial) {
          warnings.push(
            `「${proc.name}」には特定器材の算定が必要な場合があります【材料条件】`
          );
          break;
        }
      }

      // ----------------------------------------------------------
      // [チェック6] きざみ点数（h7）
      // ----------------------------------------------------------
      for (const proc of procs) {
        const rc = resolvedCodes.get(proc.code);
        if (!rc) continue;
        const incrRule = incrRules.find((r) => r.target_code === rc);
        if (!incrRule || !incrRule.limit_count) continue;
        if (proc.points > 0 && incrRule.limit_count > 0) {
          if (proc.points % incrRule.limit_count !== 0) {
            warnings.push(
              `「${proc.name}」の点数（${proc.points}点）がきざみ単位（${incrRule.limit_count}点）と合いません【きざみ点数】`
            );
          }
        }
      }

      // ----------------------------------------------------------
      // [チェック7] 傷病名要件（diagnosis_requirements）
      // 「SC算定したのに歯周病の傷病名がない」等を検出
      // 将来的にprocedure_master.applicable_diagnosesと統合予定
      // ----------------------------------------------------------
      for (const req of diagReqs) {
        // この処置コードパターンに一致する処置が算定されているか
        const matchingProcs = procs.filter(
          (p) => p.code === req.procedure_code_pattern ||
                 p.code.startsWith(req.procedure_code_pattern)
        );
        if (matchingProcs.length === 0) continue;

        // 必要な傷病名が登録されているか
        const hasDiag = diagnoses.some((d) => {
          const nameMatch = req.required_diagnosis_keywords.some((kw) =>
            d.diagnosis_name.includes(kw)
          );
          const icdMatch = req.required_icd_prefixes.length > 0
            ? req.required_icd_prefixes.some((prefix) =>
                d.diagnosis_code.startsWith(prefix)
              )
            : false;
          return nameMatch || icdMatch;
        });

        if (!hasDiag) {
          const fullMsg = req.legal_basis
            ? `${req.message}【${req.legal_basis}】`
            : req.message;
          if (req.error_level === "error") errors.push(fullMsg);
          else warnings.push(fullMsg);
        }
      }

      // ----------------------------------------------------------
      // [AI警告の引き継ぎ]
      // ----------------------------------------------------------
      if (billing.ai_check_warnings && billing.ai_check_warnings.length > 0) {
        for (const w of billing.ai_check_warnings) {
          if (w.includes("管理計画書") && billing.document_provided) continue;
          warnings.push(w);
        }
      }

      results.push({
        billing_id: billing.id,
        patient_id: billing.patient_id,
        patient_name: patient?.name_kanji || "不明",
        status: errors.length > 0 ? "error" : warnings.length > 0 ? "warn" : "ok",
        errors,
        warnings,
      });
    }

    // ============================================================
    // 3. サマリー & レスポンス
    // ============================================================
    const summary = {
      total: results.length,
      ok: results.filter((r) => r.status === "ok").length,
      warn: results.filter((r) => r.status === "warn").length,
      error: results.filter((r) => r.status === "error").length,
    };

    return NextResponse.json({
      success: true,
      results,
      summary,
      rules_loaded: {
        h2_h3_h4_addition: addRules.length,
        h5_materials: matRules.length,
        h6_frequency: freqRules.length,
        h7_incremental: incrRules.length,
        h8_age: ageRules.length,
        h9_exclusive: exclRules.length,
        m_calculation_rules_total: rules.length,
        diagnosis_requirements: diagReqs.length,
      },
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "レセプトチェックエラー", detail: msg },
      { status: 500 }
    );
  }
}

// ============================================================
// GET /api/receipt-check — ルール件数確認用
// ============================================================
export async function GET() {
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data: rules, error } = await supabase
      .from("m_calculation_rules")
      .select("rule_type")
      .eq("is_active", true);

    if (error) throw error;

    const countByType: Record<string, number> = {};
    for (const rule of rules || []) {
      countByType[rule.rule_type] = (countByType[rule.rule_type] || 0) + 1;
    }

    return NextResponse.json({
      status: "ready",
      table: "m_calculation_rules",
      rules: {
        h2_tsukisoku_kazan: countByType["h2"] || 0,
        h3_kihon_kazan: countByType["h3"] || 0,
        h4_chu_kazan: countByType["h4"] || 0,
        h5_material: countByType["h5"] || 0,
        h6_frequency: countByType["h6"] || 0,
        h7_kizami: countByType["h7"] || 0,
        h8_age: countByType["h8"] || 0,
        h9_exclusive: countByType["h9"] || 0,
        h10_jitsunissuu: countByType["h10"] || 0,
        total: (rules || []).length,
      },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "ルール取得エラー", detail: msg },
      { status: 500 }
    );
  }
}
