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
  name_kanji: string;
  name_kana: string;
  insurance_type: string;
  date_of_birth: string | null;
  burden_ratio: number;
}

interface DiagRow {
  id: string;
  patient_id: string;
  diagnosis_code: string;
  diagnosis_name: string;
  tooth_number: string;
  start_date: string;
  end_date: string | null;
  outcome: string;
}

// 公式チェックテーブルの型
interface FrequencyLimit {
  shinryo_code: string;
  name: string;
  limit_type: string;   // "per_day" | "per_month" | "per_period"
  max_count: number;
  period_months: number;
  exception_conditions: Record<string, unknown>;
}

interface ExclusivePair {
  code_a: string;
  name_a: string;
  code_b: string;
  name_b: string;
  exclusion_type: string; // "same_day" | "same_month"
  exception_conditions: Record<string, unknown>;
}

interface AdditionRule {
  base_code: string;
  base_name: string;
  addition_code: string;
  addition_name: string;
  addition_type: string;
  required_facility: string | null;
  conditions: Record<string, unknown>;
}

interface ProcedureMaterial {
  procedure_code: string;
  procedure_name: string;
  material_code: string;
  material_name: string;
  is_required: boolean;
  default_quantity: number;
  conditions: Record<string, unknown>;
}

interface AgeLimit {
  shinryo_code: string;
  name: string;
  min_age: number | null;
  max_age: number | null;
  age_type: string; // "years" | "months"
  exception_conditions: Record<string, unknown>;
}

interface IncrementalFee {
  shinryo_code: string;
  name: string;
  base_points: number;
  increment_points: number;
  increment_unit: string;
  base_count: number;
  max_count: number | null;
  conditions: Record<string, unknown>;
}

// fee_master_receiptのマッピング型
interface ReceiptMapping {
  kubun_code: string;
  sub_code: string;
  receipt_code: string;
  shinryo_shikibetsu: string;
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
// 独自コード → 公式9桁レセプトコード変換
// receipt-generate/route.ts の CODE_MAP と同じマッピング
// ============================================================
const CODE_MAP: Record<string, string> = {
  "A000": "301000110",
  "A000-2": "301000210",
  "A002": "301001610",
  "A002-2": "301001710",
  "A001-a": "302000610",
  "A001-b": "302000610",
  "B000-4": "302000110",
  "B000-4-doc": "302008470",
  "B001-2": "302000610",
  "B002": "302000710",
  "B-SHIDO": "302000110",
  "B-SHIDO-init": "302000110",
  "E100-1": "305000210",
  "E100-pan": "305000410",
  "E100-pano": "305000410",
  "E100-ct": "305004910",
  "E100-1-diag": "305000210",
  "E100-1-diag-pano": "305000210",
  "E-diag": "305000410",
  "F-shoho": "306000710",
  "F-chozai": "306000110",
  "F100": "306000110",
  "F200": "306000710",
  "I000-1": "309000110",
  "I000-2": "309000210",
  "I000-3": "309000310",
  "I001-1": "309000110",
  "I001-2": "309000210",
  "I005-1": "309002110",
  "I005-2": "309002210",
  "I005-3": "309002310",
  "I006-1": "309002410",
  "I006-2": "309002510",
  "I006-3": "309002610",
  "I007-1": "309002710",
  "I007-2": "309002810",
  "I007-3": "309002910",
  "I007--1": "309002710",
  "I008-1": "309003610",
  "I008-2": "309003710",
  "I008-3": "309003810",
  "I008--1": "309003610",
  "I010": "309015110",
  "I010-": "309015110",
  "I010-1": "309004610",
  "I011-1": "309004810",
  "I011-2-1": "309005010",
  "I011-2-2": "309005110",
  "I011-2-3": "309005210",
  "P-SC": "309004810",
  "P-SRP": "309005210",
  "P-SRP-zen": "309005010",
  "P-SRP-sho": "309005110",
  "I014": "309006010",
  "I017": "309018810",
  "I020": "309008310",
  "I029": "309014710",
  "I030": "309011410",
  "I032": "309011010",
  "PCEM": "309011410",
  "D002-2": "309001610",
  "D002-3": "309001710",
  "D002-mix": "309001710",
  "J000-1": "310000110",
  "J000-2": "310000210",
  "J000-3": "310000310",
  "J000-4": "310000410",
  "J000-5": "310000510",
  "J001": "310001110",
  "J001-1": "310000710",
  "J001-2": "310000810",
  "J002": "310003010",
  "J003": "310003110",
  "J006": "310003010",
  "J063": "310011610",
  "K001-1": "311000210",
  "K001-2": "311000110",
  "K002": "311000110",
  "M-HOHEKI": "313027310",
  "M000-2": "313000210",
  "M001-1": "313000610",
  "M001-2": "313000910",
  "M001-sho": "313001210",
  "M001-fuku": "313001310",
  "M002-1": "313002310",
  "M002-2": "313002410",
  "M-POST": "313002310",
  "M-POST-cast": "313002410",
  "M-TEK": "313004510",
  "M003-1": "313003210",
  "M003-2": "313003310",
  "M003-3": "313003810",
  "M-IMP": "313003610",
  "M-IMP-sei": "313003710",
  "M-IN-sho": "313003410",
  "M-IN-fuku": "313003510",
  "M005": "313024110",
  "M-SET": "313024110",
  "DEN-SET": "313005310",
  "M-BITE": "313007810",
  "M009-CR": "313024310",
  "M009-CR-fuku": "313024410",
  "M-KEISEI-cr": "313001210",
  "M-KEISEI--cr": "313001210",
  "M010-1": "313010410",
  "M010-2": "313010510",
  "M010-3-": "313010810",
  "M-CRN-zen": "313040910",
  "M-CRN-zen-dai": "313041010",
  "M-CRN-ko": "313028210",
  "M-CRN-nyu": "313015210",
  "M-CRN-cad2": "313025510",
  "M-CRN-cad2-dai": "313041110",
  "BR-PON": "313015410",
  "DEN-1-4": "313016610",
  "DEN-5-8": "313016710",
  "DEN-9-11": "313016810",
  "DEN-12-14": "313016910",
  "DEN-FULL-UP": "313017010",
  "DEN-FULL-LO": "313017010",
  "DEN-REP": "313021610",
  "DEN-RELINE": "313021810",
  "DEN-ADJ": "309008310",
  "M-ADJ": "313022610",
  "M-DEBOND": "313024110",
  "M-DEBOND2": "313024110",
};

/**
 * 独自コード → 公式9桁コードへ変換
 * 1) CODE_MAP直接ヒット
 * 2) fee_master_receiptテーブルから検索
 * 3) すでに9桁ならそのまま
 */
function resolveReceiptCode(
  code: string,
  dbLookup: Map<string, string>
): string | null {
  // 1) CODE_MAP
  if (CODE_MAP[code]) return CODE_MAP[code];
  // 2) fee_master_receipt DB
  const parts = code.split("-");
  const kubun = parts[0];
  const sub = parts.slice(1).join("-") || "";
  const dbKey = `${kubun}__${sub}`;
  if (dbLookup.has(dbKey)) return dbLookup.get(dbKey)!;
  // 3) Already 9-digit
  if (/^\d{9}$/.test(code)) return code;
  // 4) Not resolved
  return null;
}

/**
 * 患者の年齢を計算
 */
function calcAge(dob: string | null, refDate: string): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const ref = new Date(refDate);
  let age = ref.getFullYear() - birth.getFullYear();
  const monthDiff = ref.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getDate() < birth.getDate())) {
    age--;
  }
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
      return NextResponse.json(
        { error: "yearMonth (YYYY-MM) is required" },
        { status: 400 }
      );
    }

    const ym = yearMonth; // "YYYY-MM"
    const startDate = `${ym}-01T00:00:00`;
    const endDay = new Date(
      parseInt(ym.split("-")[0]),
      parseInt(ym.split("-")[1]),
      0
    ).getDate();
    const endDate = `${ym}-${String(endDay).padStart(2, "0")}T23:59:59`;

    // ============================================================
    // 1. データ取得（並列実行で高速化）
    // ============================================================
    const [
      { data: billings },
      { data: freqLimits },
      { data: exclusivePairs },
      { data: additionRules },
      { data: procMaterials },
      { data: ageLimits },
      { data: incrementalFees },
      { data: receiptMap },
      { data: diagReqs },
    ] = await Promise.all([
      // 対象月のbilling取得
      billing_ids && billing_ids.length > 0
        ? supabase
            .from("billing")
            .select("*")
            .in("id", billing_ids)
        : supabase
            .from("billing")
            .select("*")
            .eq("payment_status", "paid")
            .gte("created_at", startDate)
            .lte("created_at", endDate)
            .order("created_at"),
      // 公式チェックテーブル6個
      supabase.from("check_frequency_limits").select("*"),
      supabase.from("check_exclusive_pairs").select("*"),
      supabase.from("check_addition_rules").select("*"),
      supabase.from("check_procedure_materials").select("*"),
      supabase.from("check_age_limits").select("*"),
      supabase.from("check_incremental_fees").select("*"),
      // コード変換用
      supabase
        .from("fee_master_receipt")
        .select("kubun_code, sub_code, receipt_code, shinryo_shikibetsu"),
      // 傷病名要件（旧テーブル — 公式テーブルにこの機能がないため残す）
      supabase
        .from("diagnosis_requirements")
        .select("*")
        .eq("is_active", true),
    ]);

    if (!billings || billings.length === 0) {
      return NextResponse.json({
        success: true,
        results: [],
        summary: { total: 0, ok: 0, warn: 0, error: 0 },
        message: "該当月の精算済みデータがありません",
      });
    }

    // fee_master_receipt のルックアップ構築
    const dbLookup = new Map<string, string>(
      (receiptMap || []).map((r: ReceiptMapping) => [
        `${r.kubun_code}__${r.sub_code}`,
        r.receipt_code,
      ])
    );

    // 患者情報取得
    const patientIds = Array.from(
      new Set(billings.map((b: BillingRow) => b.patient_id))
    );
    const { data: patientsData } = await supabase
      .from("patients")
      .select("id, name_kanji, name_kana, insurance_type, date_of_birth, burden_ratio")
      .in("id", patientIds);
    const patientMap = new Map<string, PatientInfo>(
      (patientsData || []).map((p: PatientInfo & { id: string }) => [p.id, p])
    );

    // 傷病名取得
    const { data: allDiags } = await supabase
      .from("patient_diagnoses")
      .select(
        "id, patient_id, diagnosis_code, diagnosis_name, tooth_number, start_date, end_date, outcome"
      )
      .in("patient_id", patientIds);
    const diagsByPatient = new Map<string, DiagRow[]>();
    for (const d of (allDiags || []) as DiagRow[]) {
      if (!diagsByPatient.has(d.patient_id))
        diagsByPatient.set(d.patient_id, []);
      diagsByPatient.get(d.patient_id)!.push(d);
    }

    // 公式テーブルをMapに変換（高速検索用）
    const freqMap = new Map<string, FrequencyLimit[]>();
    for (const f of (freqLimits || []) as FrequencyLimit[]) {
      if (!freqMap.has(f.shinryo_code)) freqMap.set(f.shinryo_code, []);
      freqMap.get(f.shinryo_code)!.push(f);
    }

    const exclList = (exclusivePairs || []) as ExclusivePair[];
    const addRulesList = (additionRules || []) as AdditionRule[];
    const matList = (procMaterials || []) as ProcedureMaterial[];
    const ageList = (ageLimits || []) as AgeLimit[];
    const incrList = (incrementalFees || []) as IncrementalFee[];
    const diagReqList = (diagReqs || []) as {
      procedure_code_pattern: string;
      required_diagnosis_keywords: string[];
      required_icd_prefixes: string[];
      error_level: string;
      message: string;
      legal_basis: string;
    }[];

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
      const procCodes = procs.map((p) => p.code);

      // 独自コード → 公式コードの変換マップ（このbilling内で使用）
      const resolvedCodes = new Map<string, string>();
      for (const p of procs) {
        const rc = resolveReceiptCode(p.code, dbLookup);
        if (rc) resolvedCodes.set(p.code, rc);
      }
      // 公式コードのSetを作成
      const officialCodes = new Set(resolvedCodes.values());

      // ----------------------------------------------------------
      // [基本チェック] 旧calculation_rulesの基本ロジックを保持
      // ----------------------------------------------------------

      // 合計点数0チェック
      if (billing.total_points <= 0) {
        errors.push("合計点数が0以下です。処置が正しく入力されているか確認してください【算定要件】");
      }

      // 傷病名なしチェック
      if (diagnoses.length === 0) {
        errors.push(
          "傷病名が1つも登録されていません。レセプトには傷病名が必須です【療担規則】"
        );
      }

      // 処置なし（初再診のみ）チェック
      const hasOnlyConsult = procs.every(
        (p) =>
          p.code.startsWith("A0") ||
          p.code.startsWith("A001") ||
          p.code.startsWith("A002")
      );
      if (hasOnlyConsult && procs.length > 0) {
        warnings.push(
          "初・再診料のみで処置がありません。処置内容の入力漏れがないか確認してください"
        );
      }

      // 全傷病名が治癒チェック
      const curedDiags = diagnoses.filter((d) => d.outcome === "cured");
      if (
        curedDiags.length > 0 &&
        curedDiags.length === diagnoses.length &&
        procs.length > 0
      ) {
        warnings.push(
          "全ての傷病名が「治癒」ですが処置が算定されています。転帰を「継続」に変更するか、処置を見直してください"
        );
      }

      // 患者負担額ミスマッチ
      const expectedBurden = Math.round(
        billing.total_points * 10 * billing.burden_ratio
      );
      const roundedExpected = Math.round(expectedBurden / 10) * 10;
      if (Math.abs(billing.patient_burden - roundedExpected) > 10) {
        errors.push(
          `患者負担額が計算と不一致です（期待:¥${roundedExpected} / 実際:¥${billing.patient_burden}）【算定要件】`
        );
      }

      // 保険種別なし
      if (!patient?.insurance_type) {
        errors.push(
          "保険種別が未設定です。患者情報で保険種別を設定してください【請求要件】"
        );
      }

      // ----------------------------------------------------------
      // [公式チェック1] 算定回数限度 (check_frequency_limits)
      // 474件の公式ルールで月/日の回数超過をチェック
      // ----------------------------------------------------------
      const billingDate = billing.created_at.substring(0, 10);
      const billingMonth = billing.created_at.substring(0, 7);

      // 同一患者の同月billingを取得
      const sameMonthBillings = typedBillings.filter(
        (b) =>
          b.patient_id === billing.patient_id &&
          b.created_at.substring(0, 7) === billingMonth
      );
      // 同一患者の同日billing
      const sameDayBillings = sameMonthBillings.filter(
        (b) => b.created_at.substring(0, 10) === billingDate
      );

      for (const proc of procs) {
        const rc = resolvedCodes.get(proc.code);
        if (!rc) continue;

        const limits = freqMap.get(rc);
        if (!limits) continue;

        for (const limit of limits) {
          let totalCount = 0;
          const targetBillings =
            limit.limit_type === "per_day"
              ? sameDayBillings
              : limit.limit_type === "per_month"
              ? sameMonthBillings
              : sameMonthBillings; // per_period

          for (const b of targetBillings) {
            for (const p of b.procedures_detail || []) {
              const prc = resolveReceiptCode(p.code, dbLookup);
              if (prc === rc) {
                totalCount += p.count;
              }
            }
          }

          if (totalCount > limit.max_count) {
            const periodLabel =
              limit.limit_type === "per_day"
                ? "1日"
                : limit.limit_type === "per_month"
                ? "月"
                : `${limit.period_months}ヶ月`;
            errors.push(
              `「${limit.name}」は${periodLabel}${limit.max_count}回までです（現在: ${totalCount}回）【算定回数限度】`
            );
          }
        }
      }

      // ----------------------------------------------------------
      // [公式チェック2] 併算定不可 (check_exclusive_pairs)
      // 25件の公式ルールで同日/同月の併算定を禁止
      // ----------------------------------------------------------
      for (const pair of exclList) {
        const hasA = officialCodes.has(pair.code_a);
        const hasB = officialCodes.has(pair.code_b);

        if (hasA && hasB) {
          if (pair.exclusion_type === "same_day") {
            // 同日チェック: 現在のbillingに両方ある場合
            errors.push(
              `「${pair.name_a}」と「${pair.name_b}」は同日に併算定できません【併算定不可】`
            );
          } else if (pair.exclusion_type === "same_month") {
            errors.push(
              `「${pair.name_a}」と「${pair.name_b}」は同月に併算定できません【併算定不可】`
            );
          }
        }
      }

      // 同月の他billingとのクロスチェック（同日以外の同月billing）
      if (sameMonthBillings.length > 1) {
        const otherBillings = sameMonthBillings.filter(
          (b) => b.id !== billing.id
        );
        const otherOfficialCodes = new Set<string>();
        for (const ob of otherBillings) {
          for (const p of ob.procedures_detail || []) {
            const rc = resolveReceiptCode(p.code, dbLookup);
            if (rc) otherOfficialCodes.add(rc);
          }
        }

        for (const pair of exclList) {
          if (pair.exclusion_type !== "same_month") continue;
          const thisHasA = officialCodes.has(pair.code_a);
          const otherHasB = otherOfficialCodes.has(pair.code_b);
          const thisHasB = officialCodes.has(pair.code_b);
          const otherHasA = otherOfficialCodes.has(pair.code_a);

          if ((thisHasA && otherHasB) || (thisHasB && otherHasA)) {
            warnings.push(
              `「${pair.name_a}」と「${pair.name_b}」が同月の別会計で併算定されています【併算定不可・要確認】`
            );
          }
        }
      }

      // ----------------------------------------------------------
      // [公式チェック3] 年齢制限 (check_age_limits)
      // 150件の公式ルールで年齢制限をチェック
      // ----------------------------------------------------------
      const patientAge = calcAge(patient?.date_of_birth || null, billingDate);

      if (patientAge !== null) {
        for (const proc of procs) {
          const rc = resolvedCodes.get(proc.code);
          if (!rc) continue;

          for (const ageRule of ageList) {
            if (ageRule.shinryo_code !== rc) continue;

            const age =
              ageRule.age_type === "months"
                ? patientAge * 12 // 簡易変換（月齢精度は要改善）
                : patientAge;

            if (ageRule.min_age !== null && age < ageRule.min_age) {
              warnings.push(
                `「${ageRule.name}」は${ageRule.min_age}${ageRule.age_type === "months" ? "ヶ月" : "歳"}以上が対象です（患者: ${patientAge}歳）【年齢制限】`
              );
            }
            if (ageRule.max_age !== null && age > ageRule.max_age) {
              warnings.push(
                `「${ageRule.name}」は${ageRule.max_age}${ageRule.age_type === "months" ? "ヶ月" : "歳"}以下が対象です（患者: ${patientAge}歳）【年齢制限】`
              );
            }
          }
        }
      }

      // ----------------------------------------------------------
      // [公式チェック4] 加算ルール (check_addition_rules)
      // 1,470件 — 加算に必要な基本項目が算定されているかチェック
      // ----------------------------------------------------------
      for (const proc of procs) {
        const rc = resolvedCodes.get(proc.code);
        if (!rc) continue;

        // この公式コードが「加算」として登録されているか
        const asAddition = addRulesList.filter(
          (r) => r.addition_code === rc || (r.conditions as { shinryo_code?: string })?.shinryo_code === rc
        );
        for (const rule of asAddition) {
          // 基本項目が算定されているか確認
          const baseExists =
            officialCodes.has(rule.base_code) ||
            // base_codeが独自コードの場合のフォールバック
            Array.from(resolvedCodes.values()).includes(rule.base_code);

          if (!baseExists) {
            // 施設基準要件がある場合は警告レベル、ない場合はエラー
            if (rule.required_facility) {
              warnings.push(
                `「${rule.addition_name}」は「${rule.base_name}」の算定が前提です。また施設基準「${rule.required_facility}」が必要です【加算要件】`
              );
            } else {
              warnings.push(
                `「${rule.addition_name}」は「${rule.base_name}」の算定が前提です【加算要件】`
              );
            }
          }
        }
      }

      // ----------------------------------------------------------
      // [公式チェック5] 手技材料 (check_procedure_materials)
      // 226件 — 必須材料の算定漏れチェック
      // ----------------------------------------------------------
      for (const proc of procs) {
        const rc = resolvedCodes.get(proc.code);
        if (!rc) continue;

        const requiredMats = matList.filter(
          (m) => m.procedure_code === rc && m.is_required
        );
        // 注: 材料コードはMAT-プレフィックスまたは独自コードで算定される
        // 完全一致チェックは困難なため、材料カテゴリの有無で警告
        if (requiredMats.length > 0) {
          const hasMaterial = procs.some(
            (p) =>
              p.code.startsWith("MAT-") || p.category === "特定器材"
          );
          if (!hasMaterial && proc.category !== "加算" && proc.category !== "投薬") {
            // 材料が1つもない場合にのみ警告（過検知防止）
            const matNames = requiredMats
              .slice(0, 3)
              .map((m) => m.material_name)
              .join("、");
            warnings.push(
              `「${proc.name}」には材料（${matNames}等）の算定が必要な場合があります【手技材料】`
            );
            break; // 1回だけ警告
          }
        }
      }

      // ----------------------------------------------------------
      // [公式チェック6] きざみ点数 (check_incremental_fees)
      // 128件 — きざみ計算の妥当性チェック
      // ----------------------------------------------------------
      for (const proc of procs) {
        const rc = resolvedCodes.get(proc.code);
        if (!rc) continue;

        const incrRule = incrList.find((i) => i.shinryo_code === rc);
        if (!incrRule) continue;

        // きざみ計算: 基本点数 + (超過分 × 加算点数)
        if (
          incrRule.base_points > 0 &&
          proc.points < incrRule.base_points
        ) {
          warnings.push(
            `「${incrRule.name}」の点数が基本点数（${incrRule.base_points}点）未満です（現在: ${proc.points}点）。きざみ計算を確認してください【きざみ】`
          );
        }
      }

      // ----------------------------------------------------------
      // [傷病名要件] diagnosis_requirements（公式テーブルにこの機能がないため残す）
      // ----------------------------------------------------------
      for (const req of diagReqList) {
        const matchingProcs = procs.filter(
          (p) =>
            p.code === req.procedure_code_pattern ||
            p.code.startsWith(req.procedure_code_pattern)
        );
        if (matchingProcs.length === 0) continue;

        const hasDiag = diagnoses.some((d) => {
          const nameMatch = req.required_diagnosis_keywords.some((kw) =>
            d.diagnosis_name.includes(kw)
          );
          const icdMatch =
            req.required_icd_prefixes.length > 0
              ? req.required_icd_prefixes.some((prefix) =>
                  d.diagnosis_code.startsWith(prefix)
                )
              : false;
          return nameMatch || icdMatch;
        });

        if (!hasDiag) {
          const level = req.error_level || "error";
          const fullMsg = req.legal_basis
            ? `${req.message}【${req.legal_basis}】`
            : req.message;
          if (level === "error") errors.push(fullMsg);
          else warnings.push(fullMsg);
        }
      }

      // ----------------------------------------------------------
      // [AI警告の引き継ぎ]
      // ----------------------------------------------------------
      if (billing.ai_check_warnings && billing.ai_check_warnings.length > 0) {
        billing.ai_check_warnings.forEach((w) => {
          if (w.includes("管理計画書") && billing.document_provided) return;
          warnings.push(w);
        });
      }

      // ----------------------------------------------------------
      // 結果まとめ
      // ----------------------------------------------------------
      results.push({
        billing_id: billing.id,
        patient_id: billing.patient_id,
        patient_name: patient?.name_kanji || "不明",
        status:
          errors.length > 0 ? "error" : warnings.length > 0 ? "warn" : "ok",
        errors,
        warnings,
      });
    }

    // ============================================================
    // 3. サマリー計算 & レスポンス
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
        frequency_limits: (freqLimits || []).length,
        exclusive_pairs: (exclusivePairs || []).length,
        addition_rules: (additionRules || []).length,
        procedure_materials: (procMaterials || []).length,
        age_limits: (ageLimits || []).length,
        incremental_fees: (incrementalFees || []).length,
        diagnosis_requirements: diagReqList.length,
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

  const [
    { count: freq },
    { count: excl },
    { count: add },
    { count: mat },
    { count: age },
    { count: incr },
    { count: diagReq },
  ] = await Promise.all([
    supabase.from("check_frequency_limits").select("*", { count: "exact", head: true }),
    supabase.from("check_exclusive_pairs").select("*", { count: "exact", head: true }),
    supabase.from("check_addition_rules").select("*", { count: "exact", head: true }),
    supabase.from("check_procedure_materials").select("*", { count: "exact", head: true }),
    supabase.from("check_age_limits").select("*", { count: "exact", head: true }),
    supabase.from("check_incremental_fees").select("*", { count: "exact", head: true }),
    supabase.from("diagnosis_requirements").select("*", { count: "exact", head: true }).eq("is_active", true),
  ]);

  return NextResponse.json({
    status: "ready",
    rules: {
      check_frequency_limits: freq || 0,
      check_exclusive_pairs: excl || 0,
      check_addition_rules: add || 0,
      check_procedure_materials: mat || 0,
      check_age_limits: age || 0,
      check_incremental_fees: incr || 0,
      diagnosis_requirements: diagReq || 0,
      total: (freq || 0) + (excl || 0) + (add || 0) + (mat || 0) + (age || 0) + (incr || 0) + (diagReq || 0),
    },
  });
}
