import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as iconv from "iconv-lite";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ============================================================
// 独自code → 公式9桁コード + 診療識別コード マッピング
// auto-billingのprocedures_detail.codeから確実に変換する
// ============================================================


/**
 * [UKE-7] 歯番号を6桁コードに変換
 * m_tooth_chartのfdi_numberカラムから構築したMapを参照
 * 入力例: "46", "#46", "11"
 * 出力例: "104600", "101100"
 * toothMap: POST関数内でm_tooth_chartから構築したMap
 */
function toothTo6Digit(tooth: string, toothMap: Map<string, string>): string {
  const cleaned = tooth.replace(/^#/, "").trim();
  // m_tooth_chartから構築したMapを参照
  const mapped = toothMap.get(cleaned);
  if (mapped) return mapped;
  // すでに6桁の場合はそのまま
  if (/^\d{6}$/.test(cleaned)) return cleaned;
  // 変換不能 → そのまま返す（警告は呼び出し元で出す）
  return cleaned;
}

function toFull(s: string): string {
  return s
    .replace(/[\x21-\x7e]/g, (c) =>
      String.fromCharCode(c.charCodeAt(0) + 0xfee0)
    )
    .replace(/ /g, "\u3000");
}

function toYMD(d: string): string {
  return d.replace(/-/g, "");
}

export async function POST(request: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseKey);
  try {
    const { yearMonth, format } = await request.json();
    if (!yearMonth || yearMonth.length !== 6) {
      return NextResponse.json(
        { error: "yearMonth (YYYYMM) is required" },
        { status: 400 }
      );
    }
    const year = yearMonth.substring(0, 4);
    const month = yearMonth.substring(4, 6);
    const startDate = `${year}-${month}-01`;
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;

    // === データ取得 ===
    const { data: billings, error: bErr } = await supabase
      .from("billing")
      .select("*")
      .gte("created_at", `${startDate}T00:00:00`)
      .lte("created_at", `${endDate}T23:59:59`)
      .eq("payment_status", "paid");

    if (bErr)
      return NextResponse.json({ error: bErr.message }, { status: 500 });
    if (!billings || billings.length === 0)
      return NextResponse.json(
        { error: "該当月の精算済みデータがありません" },
        { status: 404 }
      );

    // 患者情報
    const patientIds = Array.from(
      new Set(
        billings.map((b: { patient_id: string }) => b.patient_id)
      )
    );
    type PatientInsurance = {
      id: string;
      patient_id: string;
      insurance_type: string | null;
      burden_ratio: number | null;
      insurer_number: string | null;
      insured_symbol: string | null;
      insured_number: string | null;
      branch_code: string | null;
      qualified_recipient_number: string | null;
      public_insurer: string | null;
      public_recipient: string | null;
      public_insurer_2: string | null;
      public_recipient_2: string | null;
      public_insurer_3: string | null;
      public_recipient_3: string | null;
      public_insurer_4: string | null;
      public_recipient_4: string | null;
      is_current: boolean;
    };
    type Patient = {
      id: string;
      name_kanji: string | null;
      name_kana: string | null;
      sex: string | null;
      date_of_birth: string | null;
      patient_insurances: PatientInsurance[];
    };
    let patientLookup = new Map<string, Patient & { ins: PatientInsurance }>();
    try {
      const { data: patientsData } = await supabase
        .from("patients")
        .select("id, name_kanji, name_kana, sex, date_of_birth, patient_insurances(*)")
        .in("id", patientIds);
      patientLookup = new Map(
        (patientsData || []).map((p: Patient) => {
          const ins = (p.patient_insurances || []).find((i: PatientInsurance) => i.is_current) || p.patient_insurances?.[0] || {} as PatientInsurance;
          return [p.id, { ...p, ins }];
        })
      );
    } catch (e) {
      console.error("患者情報取得エラー:", e);
    }


    // 傷病名マスタ（公式コード変換用）をm_diagnosesから取得
    let diagMasterByName = new Map<string, { diagnosis_name: string; diagnosis_code: string; icd10_code: string }>();
    let diagMasterByCode = new Map<string, { diagnosis_code: string; icd10_code: string; diagnosis_name: string }>();
    try {
      const { data: diagMasterData } = await supabase
        .from("m_diagnoses")
        .select("diagnosis_code, icd10_code, diagnosis_name")
        .eq("is_active", true);
      diagMasterByName = new Map(
        (diagMasterData || []).map((d: { diagnosis_name: string; diagnosis_code: string; icd10_code: string }) => [d.diagnosis_name, d])
      );
      diagMasterByCode = new Map(
        (diagMasterData || []).map((d: { diagnosis_code: string; icd10_code: string; diagnosis_name: string }) => [d.diagnosis_code, d])
      );
    } catch (e) {
      console.error("傷病名マスタ取得エラー:", e);
    }

    // ============================================================
    // [UKE-7] m_tooth_chartのfdi_numberからtoothMapを構築
    // fdi_number（FDI歯番号）→ tooth_code（6桁）のMap
    // ============================================================
    const toothMap = new Map<string, string>();
    try {
      const { data: toothChartData } = await supabase
        .from("m_tooth_chart")
        .select("tooth_code, fdi_number")
        .not("fdi_number", "is", null);
      for (const row of (toothChartData || [])) {
        toothMap.set(String(row.fdi_number), String(row.tooth_code));
      }
    } catch (e) {
      console.error("歯式マスタ取得エラー:", e);
    }

    // クリニック情報
    let clinicCode = "3101471";
    let clinicPref = "23";
    let clinicPhone = "0000-00-0000";
    let clinicName = "";
    let facilityCode = "0117";
    try {
      const { data: settings } = await supabase
        .from("clinic_settings")
        .select("*")
        .limit(1)
        .single();
      const { data: clinicInfo } = await supabase
        .from("clinics")
        .select("name, phone, clinic_code, prefecture_code")
        .limit(1)
        .single();
      clinicCode = clinicInfo?.clinic_code || "3101471";
      clinicPref = clinicInfo?.prefecture_code || "23";
      clinicPhone = clinicInfo?.phone || "0000-00-0000";
      clinicName = clinicInfo?.name || "";
      facilityCode = settings?.facility_code || "0117";
    } catch (e) {
      console.error("クリニック情報取得エラー:", e);
    }

    // ============================================================
    // [A-1] 同一患者の月内billing統合
    // 1患者 = 1レセプト にまとめる（これがないと即返戻）
    // 同じ患者の複数回来院分を統合し、点数を合算する
    // ============================================================
    const patientMap = new Map<string, typeof billings>();
    for (const b of billings) {
      const pid = b.patient_id;
      if (!patientMap.has(pid)) patientMap.set(pid, []);
      patientMap.get(pid)!.push(b);
    }

    const lines: string[] = [];
    const warnings: string[] = [];

    // === UK レコード（受付情報） ===
    lines.push(
      `UK,1,${clinicPref},3,${clinicCode},,${toFull(clinicName)},${yearMonth},${facilityCode},00`
    );

    // === IR レコード（医療機関情報） ===
    lines.push(
      `IR,1,${clinicPref},3,${clinicCode},,${yearMonth},${clinicPhone},${facilityCode}`
    );

    let receiptNo = 0;
    let totalPointsAll = 0;

    const patientKeys = Array.from(patientMap.keys());
    for (const patientId of patientKeys) {
      const pBillings = patientMap.get(patientId)!;
      receiptNo++;
      const pat = patientLookup.get(patientId);
      if (!pat) continue;

      const insType = String(pat.ins.insurance_type || "社保");
      const insCode = insType === "国保" ? "3" : insType === "後期高齢" ? "7" : "1";
      const sexCode = String(pat.sex || "2") === "男" || String(pat.sex || "2") === "1" ? "1" : "2";
      const dob = toYMD(String(pat.date_of_birth || ""));
      const burdenRatio = Number(pat.ins.burden_ratio || 0.3);
      const burdenCode = Math.round(burdenRatio * 10);

      // ============================================================
      // [A-1] 患者の月内合計点数を算出（全billing分を合算）
      // ============================================================
      const patientTotalPoints = pBillings.reduce(
        (s: number, b: { total_points: number }) => s + b.total_points, 0
      );
      totalPointsAll += patientTotalPoints;

      // === RE レコード（レセプト共通） ===
      // [A-1] 1患者につき1つのREレコードのみ出力（統合済み）
      // レセプト種別: 保険種別(1桁) + 本人/家族(1桁) + 負担割合(1桁) + 入外区分(1桁)
      // 公費がある場合: 4桁目以降に公費種別を追加
      // 例: 社保本人3割外来 = "1132", 公費1件あり = "1132" + 公費レセプト種別
      const reInsType = `${insCode}1${burdenCode}2`;
      lines.push(
        `RE,${receiptNo},${reInsType},${yearMonth},${pat.name_kanji || ""},${sexCode},${dob},${Math.round((1 - burdenRatio) * 10) * 10},,,,1,,,,,${pat.name_kana || ""},`
      );

      // ============================================================
      // [A-3] 保険者番号の0パディング（8桁に統一）
      // 支払基金は8桁固定。桁数不足だと受付エラーで弾かれる
      // ============================================================
      if (pat.ins.insurer_number) {
        const insurerNum = String(pat.ins.insurer_number).padStart(8, "0");
        const insuredSymbol = pat.ins.insured_symbol ? toFull(String(pat.ins.insured_symbol)) : "";
        const insuredNum = pat.ins.insured_number ? String(pat.ins.insured_number) : "";
        lines.push(
          `HO,${insurerNum},,${insuredSymbol},${insuredNum},${patientTotalPoints},,,,,,,,`
        );
      }

      // ============================================================
      // [UKE-9] SN レコード（資格確認レコード）
      // 電子資格確認を行った患者にのみ出力する
      // SN,負担者種別,確認区分,,,,,枝番,,
      // 一次請求のため(4)(5)(6)(8)は省略
      // ============================================================
      const medRecord = pBillings[0]?.medical_record_id
        ? await supabase
            .from("medical_records")
            .select("online_qualification_confirmed, qualification_method")
            .eq("id", pBillings[0].medical_record_id)
            .single()
        : null;
      const isQualified = medRecord?.data?.online_qualification_confirmed === true;
      if (isQualified) {
        // 負担者種別コード: 医療保険=1, 後期高齢=3
        const futanshaShu = insType === "後期高齢" ? "3" : "1";
        // 確認区分: card=01（オンライン）, paper=02（窓口）
        const kakuninKubun = medRecord?.data?.qualification_method === "card" ? "01" : "02";
        // 枝番（2桁・先頭0パディング）
        const edaban = pat.ins.branch_code
          ? String(pat.ins.branch_code).padStart(2, "0")
          : "";
        lines.push(`SN,${futanshaShu},${kakuninKubun},,,,${edaban},,`);
      }

      // ============================================================
      // KO レコード（公費）— 最大4件まで対応
      // 公費負担者番号(8桁) + 受給者番号(7桁)
      // 負担区分: 1=公費1, 2=公費2, 3=公費3, 4=公費4
      // ============================================================
      const publicExpenses: { insurer: string; recipient: string; kubun: string }[] = [];
      if (pat.ins.public_insurer) {
        publicExpenses.push({
          insurer: String(pat.ins.public_insurer).padStart(8, "0"),
          recipient: pat.ins.public_recipient ? String(pat.ins.public_recipient).padStart(7, "0") : "",
          kubun: "1",
        });
      }
      if (pat.ins.public_insurer_2) {
        publicExpenses.push({
          insurer: String(pat.ins.public_insurer_2).padStart(8, "0"),
          recipient: pat.ins.public_recipient_2 ? String(pat.ins.public_recipient_2).padStart(7, "0") : "",
          kubun: "2",
        });
      }
      if (pat.ins.public_insurer_3) {
        publicExpenses.push({
          insurer: String(pat.ins.public_insurer_3).padStart(8, "0"),
          recipient: pat.ins.public_recipient_3 ? String(pat.ins.public_recipient_3).padStart(7, "0") : "",
          kubun: "3",
        });
      }
      if (pat.ins.public_insurer_4) {
        publicExpenses.push({
          insurer: String(pat.ins.public_insurer_4).padStart(8, "0"),
          recipient: pat.ins.public_recipient_4 ? String(pat.ins.public_recipient_4).padStart(7, "0") : "",
          kubun: "4",
        });
      }

      for (const pe of publicExpenses) {
        // KO,公費負担者番号,受給者番号,,負担区分番号,合計点数,,,,
        lines.push(
          `KO,${pe.insurer},${pe.recipient},,${pe.kubun},${patientTotalPoints},,,,`
        );
      }
      const hasPublicExpense = publicExpenses.length > 0;
      // 負担区分コード: 公費1件="1", 2件="1 2", 公費なし=""
      const futanKubunAll = publicExpenses.map(pe => pe.kubun).join(" ");

      // ============================================================
      // [UKE-1] JD レコード（受診日等）— 公式仕様: KO直後・HS前
      // ============================================================
      const visitDays = pBillings.map(
        (b: { created_at: string }) => new Date(b.created_at).getDate()
      );
      const uniqueDays = Array.from(new Set(visitDays)).sort(
        (a: number, b: number) => a - b
      );
      const dayFlags = new Array(31).fill(0);
      uniqueDays.forEach((d: number) => {
        if (d >= 1 && d <= 31) dayFlags[d - 1] = 1;
      });
      lines.push(`JD,${uniqueDays.length},${dayFlags.join(",")}`);

      // [UKE-1] MF レコード（窓口負担額）— 公式仕様: JD直後・HS前
      const windowAmount = Math.round(patientTotalPoints * 10 * burdenRatio);
      lines.push(`MF,${windowAmount}`);

      // ============================================================
      // [UKE-2] HS レコード（傷病名部位）— 公式マスタコード変換・入院外仕様
      // receipt_diagnosesのdiagnosis_codeを公式コードに変換する
      // 当月に関係する傷病名のみ取得（継続中・当月治癒・当月新規）
      // ============================================================
      type ReceiptDiagnosis = {
        id: string;
        patient_id: string;
        diagnosis_code: string;
        diagnosis_name: string;
        outcome: string | null;
        started_at: string | null;
        ended_at: string | null;
        tooth_number_display: string | null;
        modifier_codes: string | null;
        is_primary: boolean;
      };
      let diagData: ReceiptDiagnosis[] = [];
      try {
        // UKE-2b: 当月に関係する傷病名のみ取得
        // ① 継続中: started_at<=当月末 かつ ended_at=null
        // ② 当月治癒: ended_at が当月内
        // ③ 当月新規: started_at が当月内
        const { data: diagResult } = await supabase
          .from("receipt_diagnoses")
          .select("*")
          .eq("patient_id", patientId)
          .or(`ended_at.is.null,ended_at.gte.${startDate},started_at.gte.${startDate}`)
          .lte("started_at", endDate);
        diagData = (diagResult || []) as ReceiptDiagnosis[];
      } catch (e) {
        console.error("傷病名取得エラー:", e);
      }
      if (diagData && diagData.length > 0) {
        for (const d of diagData) {
          const outcomeCode =
            d.outcome === "cured" ? "1" :
            d.outcome === "suspended" ? "3" :
            d.outcome === "died" ? "2" : "";
          const startYM = d.started_at
            ? d.started_at.replace(/-/g, "").substring(0, 6)
            : yearMonth;
          const endYM = d.ended_at
            ? d.ended_at.replace(/-/g, "").substring(0, 6)
            : "";

          // [A-4] 傷病名コードの公式マスタ変換
          let diagCode = d.diagnosis_code || "";
          const diagName = d.diagnosis_name || "";

          // まず m_diagnoses で公式コードを検索
          // 1) コードでマスタを検索
          const masterByCode = diagMasterByCode.get(diagCode);
          if (masterByCode && masterByCode.icd10_code) {
            // マスタにICD-10コードがあればそれを使用
            diagCode = masterByCode.diagnosis_code;
          }
          // 2) コードで見つからなければ名称でマスタを検索
          if (!masterByCode) {
            const masterByName = diagMasterByName.get(diagName);
            if (masterByName) {
              diagCode = masterByName.diagnosis_code;
            } else {
              // マスタに見つからない場合は警告
              warnings.push(`傷病名マスタ未登録: "${diagName}" (code: ${d.diagnosis_code})`);
            }
          }

          // 歯式コード6桁変換（m_tooth_chartの10XY00形式）
          const toothNum = (d.tooth_number_display || "").replace(/#/g, "");
          const toothSixDigit = toothNum ? toothTo6Digit(toothNum, toothMap) : "";

          // HS レコード（傷病名部位）公式仕様準拠・入院外
          const diagNameField = diagCode === "0000999" ? diagName : "";
          lines.push(
            `HS,,,${toothSixDigit},${diagCode},${d.modifier_codes || ""},${diagNameField},,,,,,`
          );
        }
      }

      // ============================================================
      // ============================================================
      // CP-10: SSレコード（歯科診療行為）
      // medical_record_idで当月分を取得 → m_feesでshinryo_shikibetsu取得
      // ============================================================
      const drugProcs: { code: string; name: string; points: number; count: number; note: string }[] = [];

      const medicalRecordIds = pBillings
        .map((b: { medical_record_id: string }) => b.medical_record_id)
        .filter(Boolean);

      let receiptProcedures: {
        fee_code: string;
        fee_name: string;
        points: number;
        count: number;
        shinryo_shikibetsu: string;
        futan_kubun: string;
        tooth_codes: string | null;
      }[] = [];

      if (medicalRecordIds.length > 0) {
        const { data: rpData } = await supabase
          .from("receipt_procedures")
          .select("fee_code, fee_name, points, count, shinryo_shikibetsu, futan_kubun, tooth_codes")
          .in("medical_record_id", medicalRecordIds);
        receiptProcedures = (rpData || []) as typeof receiptProcedures;
      }

      // fee_codeからshinryo_shikibetsuを一括取得（m_fees照合）
      const rpFeeCodes = [...new Set(receiptProcedures.map(r => r.fee_code).filter(Boolean))];
      const feeShikibetsuMap = new Map<string, string>();
      if (rpFeeCodes.length > 0) {
        const { data: feeData } = await supabase
          .from("m_fees")
          .select("sub_code, shinryo_shikibetsu")
          .in("sub_code", rpFeeCodes);
        for (const f of feeData || []) {
          feeShikibetsuMap.set(f.sub_code, f.shinryo_shikibetsu || "80");
        }
      }

      for (const rp of receiptProcedures) {
        if (!rp.fee_code || rp.fee_code.length !== 9) {
          warnings.push(`fee_code不正: ${rp.fee_code} (${rp.fee_name})`);
          continue;
        }
        const shikibetsu = feeShikibetsuMap.get(rp.fee_code) || rp.shinryo_shikibetsu || "80";
        const futanKubun = rp.futan_kubun || (hasPublicExpense ? futanKubunAll : "");
        const teethStr = rp.tooth_codes || "";

        lines.push(
          `SS,${shikibetsu},${futanKubun},${rp.fee_code},${teethStr},,${rp.points},${rp.count}`
        );
      }

      // ============================================================
      // [B-1] IY レコード（医薬品）
      // auto-billingで算定されたDRUG-コードの薬剤をIYレコードとして出力
      // IY,診療識別(21=内服,23=外用,25=頓服),負担区分,医薬品コード,使用量,点数,回数
      // ============================================================
      if (drugProcs.length > 0) {
        // m_drugsからreceipt_codeを取得
        const drugYjCodes = drugProcs.map(dp => dp.code.replace("DRUG-", ""));
        let drugMasterMap = new Map<string, { yj_code: string; receipt_code: string; dosage_form: string; name: string; unit_price: number; unit: string }>();
        try {
          const { data: drugMasterData } = await supabase
            .from("m_drugs")
            .select("yj_code, receipt_code, dosage_form, name, unit_price, unit")
            .in("yj_code", drugYjCodes);
          drugMasterMap = new Map(
            (drugMasterData || []).map((d: { yj_code: string; receipt_code: string; dosage_form: string; name: string; unit_price: number; unit: string }) => [d.yj_code, d])
          );
        } catch (e) {
          console.error("薬剤マスタ取得エラー:", e);
        }

        const futanKubun = hasPublicExpense ? futanKubunAll : "";

        for (const dp of drugProcs) {
          const yjCode = dp.code.replace("DRUG-", "");
          const drugInfo = drugMasterMap.get(yjCode);

          // 診療識別: 内服=21, 頓服=22, 外用=23, 注射=31
          let drugShikibetsu = "21";
          if (drugInfo) {
            if (drugInfo.dosage_form === "頓服") drugShikibetsu = "22";
            else if (drugInfo.dosage_form === "外用") drugShikibetsu = "23";
            else if (drugInfo.dosage_form === "注射") drugShikibetsu = "31";
          }

          // レセプト用医薬品コード（receipt_codeを優先、なければyj_codeを使用）
          const drugReceiptCode = drugInfo?.receipt_code || yjCode;

          // 使用量（noteから日数等を抽出、なければ1）
          const usageStr = "1";

          // IY,診療識別,負担区分,医薬品コード,使用量,点数,回数
          lines.push(
            `IY,${drugShikibetsu},${futanKubun},${drugReceiptCode},${usageStr},${dp.points},${dp.count}`
          );
        }
      }

      // ============================================================
      // [B-2] TO レコード（特定器材）
      // auto-billingで算定されたMAT-コードの材料をTOレコードとして出力
      // TO,診療識別(70=特定器材),負担区分,特定器材コード,使用量,単位コード,単価,点数,回数
      // ============================================================
      const matProcs: { code: string; name: string; points: number; count: number; note: string }[] = [];
      for (const b of pBillings) {
        const procs = (b.procedures_detail || []) as {
          code: string; name: string; points: number; count: number; note?: string;
        }[];
        for (const proc of procs) {
          if (proc.code.startsWith("MAT-")) {
            matProcs.push({
              code: proc.code,
              name: proc.name,
              points: proc.points,
              count: proc.count,
              note: proc.note || "",
            });
          }
        }
      }

      if (matProcs.length > 0) {
        // m_materialsから器材情報を取得
        const matCodes = matProcs.map(mp => mp.code.replace("MAT-", ""));
        let matMasterMap = new Map<string, { material_code: string; shinryo_shikibetsu: string; unit: string; unit_price: number; default_quantity: number }>();
        try {
          const { data: matMasterData } = await supabase
            .from("m_materials")
            .select("material_code, shinryo_shikibetsu, unit, unit_price, default_quantity")
            .in("material_code", matCodes);
          matMasterMap = new Map(
            (matMasterData || []).map((m: { material_code: string; shinryo_shikibetsu: string; unit: string; unit_price: number; default_quantity: number }) => [m.material_code, m])
          );
        } catch (e) {
          console.error("器材マスタ取得エラー:", e);
        }

        const futanKubun = hasPublicExpense ? futanKubunAll : "";

        for (const mp of matProcs) {
          const matCode = mp.code.replace("MAT-", "");
          const matInfo = matMasterMap.get(matCode);

          const matShikibetsu = matInfo?.shinryo_shikibetsu || "70";
          const matReceiptCode = matInfo?.material_code || matCode;
          const matQuantity = matInfo?.default_quantity || 1;
          const matUnitPrice = matInfo?.unit_price || 0;

          // TO,診療識別,負担区分,特定器材コード,使用量,単価,点数,回数
          lines.push(
            `TO,${matShikibetsu},${futanKubun},${matReceiptCode},${matQuantity},${matUnitPrice},${mp.points},${mp.count}`
          );
        }
      }

      // ============================================================
      // [UKE-5] CO レコード（コメント）— 公式仕様準拠
      // receipt_commentsテーブルから当月medical_record_idで絞り込んで取得
      // CO,診療識別,負担区分,コメントコード,文字データ,歯式コード(コメント)
      // ============================================================
      type ReceiptComment = {
        comment_code: string;
        comment_text: string | null;
        shinryo_shikibetsu: string;
        futan_kubun: string | null;
        tooth_codes: string | null;
      };
      // 当月のbillingに紐づくmedical_record_idで絞り込む
      const currentMedicalRecordIds = pBillings
        .map((b: { medical_record_id: string }) => b.medical_record_id)
        .filter(Boolean);
      let commentData: ReceiptComment[] = [];
      if (currentMedicalRecordIds.length > 0) {
        try {
          const { data: commentResult } = await supabase
            .from("receipt_comments")
            .select("comment_code, comment_text, shinryo_shikibetsu, futan_kubun, tooth_codes")
            .in("medical_record_id", currentMedicalRecordIds);
          commentData = (commentResult || []) as ReceiptComment[];
        } catch (e) {
          console.error("コメント取得エラー:", e);
        }
      }
      for (const cm of commentData) {
        // CO,診療識別,負担区分,コメントコード,文字データ,歯式コード(コメント)
        const coFutan = cm.futan_kubun || (hasPublicExpense ? futanKubunAll : "1");
        lines.push(
          `CO,${cm.shinryo_shikibetsu},${coFutan},${cm.comment_code},${cm.comment_text || ""},${cm.tooth_codes || ""}`
        );
      }

    }

    // === GO レコード（請求書） ===
    lines.push(`GO,${receiptNo},${totalPointsAll},99`);

    // UKEファイルの内容を結合（CR+LF改行）
    const ukeContent = lines.join("\r\n");

    if (format === "uke" || format === "download") {
      // Shift_JISに変換して.UKEファイルとしてダウンロード
      const fileName = `receipt_${yearMonth}.UKE`;
      const sjisBuffer = iconv.encode(ukeContent, "Shift_JIS");
      // Node.js BufferをWeb標準のUint8Arrayにコピー
      const bytes = new Uint8Array(sjisBuffer.length);
      for (let i = 0; i < sjisBuffer.length; i++) {
        bytes[i] = sjisBuffer[i];
      }
      const blob = new Blob([bytes], { type: "application/octet-stream" });
      return new Response(blob, {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${fileName}"`,
        },
      });
    }

    // JSON形式（デフォルト: プレビュー用）
    return NextResponse.json({
      success: true,
      csv: ukeContent,
      receiptCount: receiptNo,
      totalPoints: totalPointsAll,
      yearMonth,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
