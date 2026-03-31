// ============================================================
// UKEファイル型定義 - 令和6年9月版公式仕様
// CP-4（parse-uke）/ CP-5（照合）/ CP-6（analyze-uke）/ CP-7（upload-uke）共通
// ============================================================

export interface UKRecord {
  receipt_no: string;
  receipt_type: string;
  shinryo_yearmonth: string;
  clinic_code: string;
  prefecture: string;
  fee_table: string;
  clinic_name: string;
}

export interface IRRecord {
  clinic_identifier: string;
  prefecture_no: string;
  fee_table: string;
  clinic_code: string;
  billing_org_code: string;
  clinic_name: string;
  department: string;
  phone: string;
}

export interface RERecord {
  receipt_no: string;
  receipt_type: string;
  shinryo_yearmonth: string;
  patient_name: string;
  sex: string;
  date_of_birth: string;
  benefit_ratio: string;
  admission_date: string;
  ward_kubun: string;
  copay_kubun: string;
  tokki: string;
  bed_count: string;
  karte_no: string;
  discount_kubun: string;
  referral: string;
  clinic_code: string;
}

export interface HORecord {
  insurer_no: string;
  insured_symbol: string;
  insured_no: string;
  visit_days: string;
  total_points: string;
  burden_amount: string;
  food_therapy: string;
  claim: string;
  copay_amount: string;
  discount_ratio: string;
  discount_amount: string;
}

export interface SNRecord {
  futan_sha_kubun: string;
  kakunin_kubun: string;
  branch_code: string;
}

export interface KORecord {
  public_insurer_no: string;
  public_recipient_no: string;
  optional_benefit_kubun: string;
  visit_days: string;
  total_points: string;
  public_burden_amount: string;
}

export interface JDRecord {
  visit_dates: string[];
}

export interface MFRecord {
  window_burden_kubun: string;
  window_burden_amount: string;
}

export interface HSRecord {
  tooth_code: string;
  diagnosis_code: string;
  modifier_codes: string;
  diagnosis_name: string;
}

export interface SSRecord {
  shinryo_shikibetsu: string;
  futan_kubun: string;
  fee_code: string;
  quantity: string;
  points: string;
  count: string;
  comment_code_1: string;
  comment_text_1: string;
  comment_code_2: string;
  comment_text_2: string;
  comment_code_3: string;
  comment_text_3: string;
  santei_date: string;
}

export interface IYRecord {
  shinryo_shikibetsu: string;
  futan_kubun: string;
  drug_code: string;
  usage_amount: string;
  points: string;
  count: string;
  comment_code_1: string;
  comment_text_1: string;
  comment_code_2: string;
  comment_text_2: string;
  comment_code_3: string;
  comment_text_3: string;
  santei_date: string;
}

export interface TORecord {
  shinryo_shikibetsu: string;
  futan_kubun: string;
  material_code: string;
  quantity: string;
  points: string;
  count: string;
  unit_code: string;
  unit_price: string;
  material_name: string;
  comment_code_1: string;
  comment_text_1: string;
  comment_code_2: string;
  comment_text_2: string;
  comment_code_3: string;
  comment_text_3: string;
  santei_date: string;
}

export interface CORecord {
  shinryo_shikibetsu: string;
  futan_kubun: string;
  comment_code: string;
  comment_text: string;
  tooth_codes: string;
}

export interface GORecord {
  total_receipts: string;
  total_points: string;
}

export interface PatientReceipt {
  re: RERecord;
  ho: HORecord[];
  sn: SNRecord[];
  ko: KORecord[];
  jd: JDRecord[];
  mf: MFRecord[];
  hs: HSRecord[];
  ss: SSRecord[];
  iy: IYRecord[];
  to: TORecord[];
  co: CORecord[];
}

export interface ParsedUKE {
  uk: UKRecord | null;
  ir: IRRecord | null;
  patients: PatientReceipt[];
  go: GORecord | null;
  parse_errors: string[];
  raw_line_count: number;
}
