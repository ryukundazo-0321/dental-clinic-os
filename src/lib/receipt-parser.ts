// レセ電データパーサー（歯科）
// 厚労省レセプト電算処理フォーマット対応

export type ReceiptPatient = {
  receiptNo: number;
  name: string;
  nameKana: string;
  sex: string;
  birthDate: string;
  insuranceType: string;
  firstVisitDate: string;
  insurerNumber: string;
  insuredSymbol: string;
  insuredNumber: string;
  publicInsurer: string;
  publicRecipient: string;
  totalPoints: number;
  diagnoses: Diagnosis[];
  procedures: ProcedureGroup[];
  toothChart: string;
  comments: Comment[];
  returns: ReturnInfo[];
};

export type Diagnosis = {
  code: string;
  name: string;
  startDate: string;
  outcome: string;
};

export type ProcedureGroup = {
  category: string;
  categoryName: string;
  code: string;
  points: number;
  count: number;
  details: string[];
  toothPositions: string[];
};

export type Comment = {
  code: string;
  text: string;
};

export type ReturnInfo = {
  yearMonth: string;
  reason: string;
};

export type ReceiptFile = {
  clinicName: string;
  clinicCode: string;
  claimYearMonth: string;
  phone: string;
  totalReceipts: number;
  totalPoints: number;
  patients: ReceiptPatient[];
};

// 診療行為カテゴリ
const CATEGORY_MAP: Record<string, string> = {
  "11": "初診", "12": "初診", "13": "再診",
  "21": "指導", "22": "指導", "23": "指導",
  "31": "検査", "32": "検査", "33": "画像診断",
  "40": "処置", "41": "処置", "42": "処置",
  "50": "手術", "51": "手術", "52": "手術", "53": "手術",
  "54": "麻酔",
  "60": "歯冠修復", "61": "歯冠修復", "62": "歯冠修復", "63": "歯冠修復",
  "70": "有床義歯", "71": "有床義歯", "72": "有床義歯",
  "80": "歯科矯正", "81": "歯科矯正",
};

function getCategoryName(cat: string): string {
  return CATEGORY_MAP[cat] || `その他(${cat})`;
}

// 性別
function getSex(code: string): string {
  return code === "1" ? "男" : code === "2" ? "女" : "不明";
}

// 日付フォーマット (YYYYMMDD → YYYY/MM/DD)
function fmtDate(d: string): string {
  if (!d || d.length < 8) return d || "";
  return `${d.substring(0, 4)}/${d.substring(4, 6)}/${d.substring(6, 8)}`;
}

// 保険種別
function getInsuranceType(code: string): string {
  const types: Record<string, string> = {
    "1": "社保本人", "2": "社保家族",
    "3": "国保", "4": "退職",
    "6": "組合", "7": "後期高齢",
  };
  return types[code] || `種別${code}`;
}

export function parseReceiptCSV(text: string): ReceiptFile {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  
  const result: ReceiptFile = {
    clinicName: "", clinicCode: "", claimYearMonth: "", phone: "",
    totalReceipts: 0, totalPoints: 0, patients: [],
  };

  let currentPatient: ReceiptPatient | null = null;

  for (const line of lines) {
    const fields = line.split(",");
    const recordType = fields[0];

    // 先頭が数字の場合はチェックレコード（8,86,1,2,3,4,6）→スキップまたは特定処理
    if (/^\d+$/.test(recordType)) {
      // HRレコード（返戻情報）を拾う
      if (fields.length > 3 && fields[3] === "HR" && currentPatient) {
        currentPatient.returns.push({
          yearMonth: fields.length > 4 ? fields[4] : "",
          reason: fields.length > 8 ? toHalf(fields[8] || "") : "",
        });
      }
      continue;
    }

    switch (recordType) {
      case "UK": // 医療機関ヘッダー（固定）
        break;

      case "IR": // 医療機関情報
        result.clinicCode = fields[4] || "";
        result.clinicName = toHalf(fields[6] || "");
        result.claimYearMonth = fields[7] || "";
        result.phone = toHalf(fields[8] || "");
        break;

      case "RE": { // レセプト共通（患者情報）
        if (currentPatient) result.patients.push(currentPatient);
        currentPatient = {
          receiptNo: parseInt(fields[1]) || 0,
          name: fields[4] || "",
          nameKana: fields.length > 25 ? (fields[25] || "") : "",
          sex: getSex(fields[5] || ""),
          birthDate: fmtDate(fields[6] || ""),
          insuranceType: getInsuranceType(fields[3]?.charAt(0) || ""),
          firstVisitDate: fmtDate(fields[9] || ""),
          insurerNumber: "",
          insuredSymbol: "",
          insuredNumber: "",
          publicInsurer: "",
          publicRecipient: "",
          totalPoints: 0,
          diagnoses: [],
          procedures: [],
          toothChart: "",
          comments: [],
          returns: [],
        };
        break;
      }

      case "HO": // 保険者
        if (currentPatient) {
          currentPatient.insurerNumber = (fields[1] || "").trim();
          currentPatient.insuredSymbol = toHalf(fields[3] || "");
          currentPatient.insuredNumber = fields[4] || "";
        }
        break;

      case "KO": // 公費
        if (currentPatient) {
          currentPatient.publicInsurer = fields[1] || "";
          currentPatient.publicRecipient = fields[2] || "";
        }
        break;

      case "SN": // 傷病名
        break;

      case "HS": // 歯式
        if (currentPatient && fields[2]) {
          currentPatient.toothChart = fields[2];
        }
        break;

      case "SS": { // 診療行為
        if (!currentPatient) break;
        const cat = fields[1] || "";
        const code = fields[3] || "";
        // 点数は固定位置（フィールド67付近）
        let points = 0;
        let count = 1;
        // 点数を探す（フォーマット上、点数は後方のフィールド）
        for (let i = fields.length - 1; i > 3; i--) {
          const val = parseInt(fields[i]);
          if (!isNaN(val) && val > 0 && val < 100000) {
            if (points === 0) {
              count = val;
            } else {
              break;
            }
            if (points === 0) {
              // 1つ前が点数
              const prevVal = parseInt(fields[i - 1]);
              if (!isNaN(prevVal) && prevVal > 0) {
                points = prevVal;
                break;
              }
              points = val;
              count = 1;
              break;
            }
          }
        }
        // 点数をより確実に取得（カンマ区切りの特定位置）
        // SSレコードの点数は通常68番目のフィールド付近
        for (let i = 60; i < Math.min(75, fields.length); i++) {
          const v = parseInt(fields[i]);
          if (!isNaN(v) && v > 0) {
            points = v;
            // 次のフィールドが回数
            const nextV = parseInt(fields[i + 1]);
            if (!isNaN(nextV) && nextV > 0 && nextV < 100) {
              count = nextV;
            }
            break;
          }
        }

        const details: string[] = [];
        // CA, CB, CE, CI, CM, DM, AE コードを抽出
        for (let i = 4; i < Math.min(20, fields.length); i++) {
          if (fields[i] && /^[A-Z]{2}\d{3}/.test(fields[i])) {
            details.push(fields[i]);
          }
        }

        currentPatient.procedures.push({
          category: cat,
          categoryName: getCategoryName(cat),
          code,
          points,
          count,
          details,
          toothPositions: [],
        });
        currentPatient.totalPoints += points * count;
        break;
      }

      case "CO": // コメント
        if (currentPatient) {
          currentPatient.comments.push({
            code: fields[3] || "",
            text: toHalf(fields[4] || ""),
          });
        }
        break;

      case "GO": // 合計
        result.totalReceipts = parseInt(fields[1]) || 0;
        result.totalPoints = parseInt(fields[2]) || 0;
        break;
    }
  }

  if (currentPatient) result.patients.push(currentPatient);

  return result;
}

// 全角→半角変換
function toHalf(str: string): string {
  return str.replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
  ).replace(/\u3000/g, " ");
}
