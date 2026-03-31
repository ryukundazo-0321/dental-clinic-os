import { createClient } from "@supabase/supabase-js";
import type { ParsedUKE, PatientReceipt } from "@/types/uke";

// ============================================================
// UKE照合エンジン - CP-5
// ParsedUKE（CP-4出力）を受け取り、公式マスタと照合して
// 名称・点数・診療識別を付与して返す
// ============================================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 照合済みSS
export interface MatchedSS {
  shinryo_shikibetsu: string;
  futan_kubun: string;
  fee_code: string;         // 9桁
  procedure_name: string;   // m_fees.nameから取得
  points: number;           // m_fees.pointsから取得
  quantity: string;
  count: string;
  santei_date: string;
  matched: boolean;         // 照合OK/NG
}

// 照合済みHS
export interface MatchedHS {
  tooth_code: string;
  diagnosis_code: string;
  diagnosis_name: string;   // m_diagnoses.diagnosis_nameから取得
  modifier_codes: string;
  matched: boolean;
}

// 照合済みIY
export interface MatchedIY {
  shinryo_shikibetsu: string;
  futan_kubun: string;
  drug_code: string;        // receipt_code
  drug_name: string;        // m_drugs.nameから取得
  unit_price: number;       // m_drugs.unit_priceから取得
  usage_amount: string;
  points: string;
  count: string;
  santei_date: string;
  matched: boolean;
}

// 照合済みTO
export interface MatchedTO {
  shinryo_shikibetsu: string;
  futan_kubun: string;
  material_code: string;
  material_name: string;    // m_materials.nameから取得
  unit_price: number;       // m_materials.unit_priceから取得
  quantity: string;
  points: string;
  count: string;
  santei_date: string;
  matched: boolean;
}

// 患者単位の照合済みデータ
export interface MatchedPatientReceipt {
  re: PatientReceipt["re"];
  ho: PatientReceipt["ho"];
  sn: PatientReceipt["sn"];
  ko: PatientReceipt["ko"];
  jd: PatientReceipt["jd"];
  mf: PatientReceipt["mf"];
  co: PatientReceipt["co"];
  hs: MatchedHS[];
  ss: MatchedSS[];
  iy: MatchedIY[];
  to: MatchedTO[];
}

// 照合結果全体
export interface MatchedUKE {
  patients: MatchedPatientReceipt[];
  unmatched_codes: {
    ss: string[];   // m_feesに存在しなかったfee_code
    hs: string[];   // m_diagnosesに存在しなかったdiagnosis_code
    iy: string[];   // m_drugsに存在しなかったdrug_code
    to: string[];   // m_materialsに存在しなかったmaterial_code
  };
  summary: {
    total_patients: number;
    total_ss: number;
    total_hs: number;
    total_iy: number;
    total_to: number;
    unmatched_total: number;
  };
}

// ============================================================
// メイン照合関数
// N+1を避けるため、全コードを先に収集→一括クエリ→Mapで紐づけ
// ============================================================

export async function matchUKE(parsed: ParsedUKE): Promise<MatchedUKE> {
  const supabase = createClient(supabaseUrl, supabaseKey);

  // === 全コードを収集 ===
  const allFeeCodes    = new Set<string>();
  const allDiagCodes   = new Set<string>();
  const allDrugCodes   = new Set<string>();
  const allMatCodes    = new Set<string>();

  for (const p of parsed.patients) {
    p.ss.forEach(r => { if (r.fee_code)      allFeeCodes.add(r.fee_code); });
    p.hs.forEach(r => { if (r.diagnosis_code) allDiagCodes.add(r.diagnosis_code); });
    p.iy.forEach(r => { if (r.drug_code)      allDrugCodes.add(r.drug_code); });
    p.to.forEach(r => { if (r.material_code)  allMatCodes.add(r.material_code); });
  }

  // === 一括クエリ（N+1なし）===
  const [feesRes, diagRes, drugRes, matRes] = await Promise.all([
    allFeeCodes.size > 0
      ? supabase.from("m_fees").select("sub_code, name, points, shinryo_shikibetsu")
          .in("sub_code", [...allFeeCodes])
      : Promise.resolve({ data: [] }),
    allDiagCodes.size > 0
      ? supabase.from("m_diagnoses").select("diagnosis_code, diagnosis_name")
          .in("diagnosis_code", [...allDiagCodes])
      : Promise.resolve({ data: [] }),
    allDrugCodes.size > 0
      ? supabase.from("m_drugs").select("receipt_code, name, unit_price")
          .in("receipt_code", [...allDrugCodes])
      : Promise.resolve({ data: [] }),
    allMatCodes.size > 0
      ? supabase.from("m_materials").select("material_code, name, unit_price")
          .in("material_code", [...allMatCodes])
      : Promise.resolve({ data: [] }),
  ]);

  // === Mapに変換（O(1)で名称・点数を取得）===
  const feeMap  = new Map<string, { name: string; points: number; shinryo_shikibetsu: string }>();
  const diagMap = new Map<string, string>();
  const drugMap = new Map<string, { name: string; unit_price: number }>();
  const matMap  = new Map<string, { name: string; unit_price: number }>();

  for (const r of feesRes.data ?? []) feeMap.set(r.sub_code, { name: r.name, points: r.points, shinryo_shikibetsu: r.shinryo_shikibetsu });
  for (const r of diagRes.data ?? []) diagMap.set(r.diagnosis_code, r.diagnosis_name);
  for (const r of drugRes.data ?? []) drugMap.set(r.receipt_code, { name: r.name, unit_price: r.unit_price });
  for (const r of matRes.data  ?? []) matMap.set(r.material_code, { name: r.name, unit_price: r.unit_price });

  // === 照合されなかったコードを記録 ===
  const unmatched = { ss: [] as string[], hs: [] as string[], iy: [] as string[], to: [] as string[] };

  // === 患者ごとに照合済みデータを生成 ===
  const matchedPatients: MatchedPatientReceipt[] = parsed.patients.map(p => {
    const matchedSS: MatchedSS[] = p.ss.map(r => {
      const hit = feeMap.get(r.fee_code);
      if (!hit && r.fee_code && !unmatched.ss.includes(r.fee_code)) unmatched.ss.push(r.fee_code);
      return {
        shinryo_shikibetsu: r.shinryo_shikibetsu,
        futan_kubun:        r.futan_kubun,
        fee_code:           r.fee_code,
        procedure_name:     hit?.name ?? "",
        points:             hit?.points ?? 0,
        quantity:           r.quantity,
        count:              r.count,
        santei_date:        r.santei_date,
        matched:            !!hit,
      };
    });

    const matchedHS: MatchedHS[] = p.hs.map(r => {
      const name = diagMap.get(r.diagnosis_code);
      if (!name && r.diagnosis_code && !unmatched.hs.includes(r.diagnosis_code)) unmatched.hs.push(r.diagnosis_code);
      return {
        tooth_code:      r.tooth_code,
        diagnosis_code:  r.diagnosis_code,
        diagnosis_name:  name ?? r.diagnosis_name ?? "",
        modifier_codes:  r.modifier_codes,
        matched:         !!name,
      };
    });

    const matchedIY: MatchedIY[] = p.iy.map(r => {
      const hit = drugMap.get(r.drug_code);
      if (!hit && r.drug_code && !unmatched.iy.includes(r.drug_code)) unmatched.iy.push(r.drug_code);
      return {
        shinryo_shikibetsu: r.shinryo_shikibetsu,
        futan_kubun:        r.futan_kubun,
        drug_code:          r.drug_code,
        drug_name:          hit?.name ?? "",
        unit_price:         hit?.unit_price ?? 0,
        usage_amount:       r.usage_amount,
        points:             r.points,
        count:              r.count,
        santei_date:        r.santei_date,
        matched:            !!hit,
      };
    });

    const matchedTO: MatchedTO[] = p.to.map(r => {
      const hit = matMap.get(r.material_code);
      if (!hit && r.material_code && !unmatched.to.includes(r.material_code)) unmatched.to.push(r.material_code);
      return {
        shinryo_shikibetsu: r.shinryo_shikibetsu,
        futan_kubun:        r.futan_kubun,
        material_code:      r.material_code,
        material_name:      hit?.name ?? "",
        unit_price:         hit?.unit_price ?? 0,
        quantity:           r.quantity,
        points:             r.points,
        count:              r.count,
        santei_date:        r.santei_date,
        matched:            !!hit,
      };
    });

    return {
      re: p.re,
      ho: p.ho,
      sn: p.sn,
      ko: p.ko,
      jd: p.jd,
      mf: p.mf,
      co: p.co,
      hs: matchedHS,
      ss: matchedSS,
      iy: matchedIY,
      to: matchedTO,
    };
  });

  const unmatchedTotal =
    unmatched.ss.length + unmatched.hs.length +
    unmatched.iy.length + unmatched.to.length;

  return {
    patients: matchedPatients,
    unmatched_codes: unmatched,
    summary: {
      total_patients: matchedPatients.length,
      total_ss: matchedPatients.reduce((n, p) => n + p.ss.length, 0),
      total_hs: matchedPatients.reduce((n, p) => n + p.hs.length, 0),
      total_iy: matchedPatients.reduce((n, p) => n + p.iy.length, 0),
      total_to: matchedPatients.reduce((n, p) => n + p.to.length, 0),
      unmatched_total: unmatchedTotal,
    },
  };
}
