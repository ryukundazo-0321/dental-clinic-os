import * as iconv from "iconv-lite";
import type {
  UKRecord, IRRecord, RERecord, HORecord, SNRecord, KORecord,
  JDRecord, MFRecord, HSRecord, SSRecord, IYRecord, TORecord,
  CORecord, GORecord, PatientReceipt, ParsedUKE,
} from "@/types/uke";

// ============================================================
// UKEパーサー - 令和6年9月版公式仕様
// CP-4（/api/parse-uke）とCP-6（/api/analyze-uke）共通ロジック
// ============================================================

function f(fields: string[], index: number): string {
  return fields[index]?.trim() ?? "";
}

function parseUKRecord(fields: string[]): UKRecord {
  return {
    receipt_no:        f(fields, 1),
    receipt_type:      f(fields, 2),
    shinryo_yearmonth: f(fields, 3),
    clinic_code:       f(fields, 4),
    prefecture:        f(fields, 5),
    fee_table:         f(fields, 6),
    clinic_name:       f(fields, 7),
  };
}

function parseIRRecord(fields: string[]): IRRecord {
  return {
    clinic_identifier: f(fields, 1),
    prefecture_no:     f(fields, 2),
    fee_table:         f(fields, 3),
    clinic_code:       f(fields, 4),
    billing_org_code:  f(fields, 5),
    clinic_name:       f(fields, 6),
    department:        f(fields, 7),
    phone:             f(fields, 8),
  };
}

function parseRERecord(fields: string[]): RERecord {
  return {
    receipt_no:        f(fields, 1),
    receipt_type:      f(fields, 2),
    shinryo_yearmonth: f(fields, 3),
    patient_name:      f(fields, 4),
    sex:               f(fields, 5),
    date_of_birth:     f(fields, 6),
    benefit_ratio:     f(fields, 7),
    admission_date:    f(fields, 8),
    ward_kubun:        f(fields, 9),
    copay_kubun:       f(fields, 10),
    tokki:             f(fields, 11),
    bed_count:         f(fields, 12),
    karte_no:          f(fields, 13),
    discount_kubun:    f(fields, 14),
    referral:          f(fields, 15),
    clinic_code:       f(fields, 16),
  };
}

function parseHORecord(fields: string[]): HORecord {
  return {
    insurer_no:      f(fields, 1),
    insured_symbol:  f(fields, 2),
    insured_no:      f(fields, 3),
    visit_days:      f(fields, 4),
    total_points:    f(fields, 5),
    burden_amount:   f(fields, 6),
    food_therapy:    f(fields, 7),
    claim:           f(fields, 8),
    copay_amount:    f(fields, 9),
    discount_ratio:  f(fields, 10),
    discount_amount: f(fields, 11),
  };
}

function parseSNRecord(fields: string[]): SNRecord {
  return {
    futan_sha_kubun: f(fields, 1),
    kakunin_kubun:   f(fields, 2),
    // フィールド3〜6は空固定（公式仕様）
    branch_code:     f(fields, 7),
  };
}

function parseKORecord(fields: string[]): KORecord {
  return {
    public_insurer_no:      f(fields, 1),
    public_recipient_no:    f(fields, 2),
    optional_benefit_kubun: f(fields, 3),
    visit_days:             f(fields, 4),
    total_points:           f(fields, 5),
    public_burden_amount:   f(fields, 6),
  };
}

function parseJDRecord(fields: string[]): JDRecord {
  return {
    visit_dates: fields.slice(1).map(d => d.trim()).filter(d => d !== ""),
  };
}

function parseMFRecord(fields: string[]): MFRecord {
  return {
    window_burden_kubun:  f(fields, 1),
    window_burden_amount: f(fields, 2),
  };
}

function parseHSRecord(fields: string[]): HSRecord {
  return {
    // フィールド1・2は空固定（公式仕様・入院外）
    tooth_code:     f(fields, 3),
    diagnosis_code: f(fields, 4),
    modifier_codes: f(fields, 5),
    diagnosis_name: f(fields, 6),
  };
}

function parseSSRecord(fields: string[]): SSRecord {
  return {
    shinryo_shikibetsu: f(fields, 1),
    futan_kubun:        f(fields, 2),
    fee_code:           f(fields, 3),
    quantity:           f(fields, 4),
    points:             f(fields, 5),
    count:              f(fields, 6),
    comment_code_1:     f(fields, 7),
    comment_text_1:     f(fields, 8),
    comment_code_2:     f(fields, 9),
    comment_text_2:     f(fields, 10),
    comment_code_3:     f(fields, 11),
    comment_text_3:     f(fields, 12),
    santei_date:        f(fields, 13),
  };
}

function parseIYRecord(fields: string[]): IYRecord {
  return {
    shinryo_shikibetsu: f(fields, 1),
    futan_kubun:        f(fields, 2),
    drug_code:          f(fields, 3),
    usage_amount:       f(fields, 4),
    points:             f(fields, 5),
    count:              f(fields, 6),
    comment_code_1:     f(fields, 7),
    comment_text_1:     f(fields, 8),
    comment_code_2:     f(fields, 9),
    comment_text_2:     f(fields, 10),
    comment_code_3:     f(fields, 11),
    comment_text_3:     f(fields, 12),
    santei_date:        f(fields, 13),
  };
}

function parseTORecord(fields: string[]): TORecord {
  return {
    shinryo_shikibetsu: f(fields, 1),
    futan_kubun:        f(fields, 2),
    material_code:      f(fields, 3),
    quantity:           f(fields, 4),
    points:             f(fields, 5),
    count:              f(fields, 6),
    unit_code:          f(fields, 7),
    unit_price:         f(fields, 8),
    material_name:      f(fields, 9),
    comment_code_1:     f(fields, 10),
    comment_text_1:     f(fields, 11),
    comment_code_2:     f(fields, 12),
    comment_text_2:     f(fields, 13),
    comment_code_3:     f(fields, 14),
    comment_text_3:     f(fields, 15),
    santei_date:        f(fields, 16),
  };
}

function parseCORecord(fields: string[]): CORecord {
  return {
    shinryo_shikibetsu: f(fields, 1),
    futan_kubun:        f(fields, 2),
    comment_code:       f(fields, 3),
    comment_text:       f(fields, 4),
    tooth_codes:        f(fields, 5),
  };
}

function parseGORecord(fields: string[]): GORecord {
  return {
    total_receipts: f(fields, 1),
    total_points:   f(fields, 2),
  };
}

function newPatientReceipt(re: RERecord): PatientReceipt {
  return { re, ho: [], sn: [], ko: [], jd: [], mf: [], hs: [], ss: [], iy: [], to: [], co: [] };
}

// ============================================================
// メインパース関数（Bufferを直接受け取る）
// /api/parse-uke と /api/analyze-uke の両方から使う
// ============================================================

export function parseUKEBuffer(buffer: Buffer): ParsedUKE {
  const utf8Text = iconv.decode(buffer, "Shift_JIS");
  const lines = utf8Text.split(/\r?\n/).filter(line => line.trim() !== "");

  const result: ParsedUKE = {
    uk: null,
    ir: null,
    patients: [],
    go: null,
    parse_errors: [],
    raw_line_count: lines.length,
  };

  let currentPatient: PatientReceipt | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fields = line.split(",");
    const recordType = fields[0]?.trim().toUpperCase();

    try {
      switch (recordType) {
        case "UK":
          result.uk = parseUKRecord(fields);
          break;
        case "IR":
          result.ir = parseIRRecord(fields);
          break;
        case "RE":
          if (currentPatient) result.patients.push(currentPatient);
          currentPatient = newPatientReceipt(parseRERecord(fields));
          break;
        case "HO":
          if (currentPatient) currentPatient.ho.push(parseHORecord(fields));
          break;
        case "SN":
          if (currentPatient) currentPatient.sn.push(parseSNRecord(fields));
          break;
        case "KO":
          if (currentPatient) currentPatient.ko.push(parseKORecord(fields));
          break;
        case "JD":
          if (currentPatient) currentPatient.jd.push(parseJDRecord(fields));
          break;
        case "MF":
          if (currentPatient) currentPatient.mf.push(parseMFRecord(fields));
          break;
        case "HS":
          if (currentPatient) currentPatient.hs.push(parseHSRecord(fields));
          break;
        case "SS":
          if (currentPatient) currentPatient.ss.push(parseSSRecord(fields));
          break;
        case "IY":
          if (currentPatient) currentPatient.iy.push(parseIYRecord(fields));
          break;
        case "TO":
          if (currentPatient) currentPatient.to.push(parseTORecord(fields));
          break;
        case "CO":
          if (currentPatient) currentPatient.co.push(parseCORecord(fields));
          break;
        case "GO":
          if (currentPatient) {
            result.patients.push(currentPatient);
            currentPatient = null;
          }
          result.go = parseGORecord(fields);
          break;
        default:
          result.parse_errors.push(
            `行${i + 1}: 未知のレコード種別 "${recordType}" — スキップしました`
          );
      }
    } catch (e) {
      result.parse_errors.push(`行${i + 1}: パースエラー - ${String(e)}`);
    }
  }

  if (currentPatient) {
    result.patients.push(currentPatient);
    result.parse_errors.push("GOレコードが見つかりませんでした。ファイルが不完全な可能性があります。");
  }

  return result;
}
