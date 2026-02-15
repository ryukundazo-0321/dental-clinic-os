import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import * as iconv from "iconv-lite";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ============================================================
// 独自code → 公式9桁コード + 診療識別コード マッピング
// auto-billingのprocedures_detail.codeから確実に変換する
// ============================================================
const CODE_MAP: Record<string, { rc: string; sk: string }> = {
  // 初・再診料 (診療識別: 11=初診, 12=再診)
  "A000": { rc: "301000110", sk: "11" },
  "A000-2": { rc: "301000210", sk: "11" },
  "A000-meisai": { rc: "301000370", sk: "11" },
  "A000-nyuji": { rc: "301000550", sk: "11" },
  "A002": { rc: "301001610", sk: "12" },
  "A002-2": { rc: "301001710", sk: "12" },
  "A002-nyuji": { rc: "301002750", sk: "12" },
  // 医学管理等 (診療識別: 13)
  "A001-a": { rc: "302000610", sk: "13" },
  "A001-b": { rc: "301002750", sk: "12" },
  "B000-4": { rc: "302000110", sk: "13" },
  "B000-4-doc": { rc: "302000150", sk: "13" },
  "B000-4-choki": { rc: "302000170", sk: "13" },
  "B000-4-info": { rc: "302000160", sk: "13" },
  "B000-8": { rc: "302005010", sk: "13" },
  "B001-2": { rc: "302000610", sk: "13" },
  "B002": { rc: "302000710", sk: "13" },
  "B004-6-2": { rc: "302003510", sk: "13" },
  // 検査・画像 (診療識別: 31)
  "D001": { rc: "306000110", sk: "31" },
  "D002-1": { rc: "306000210", sk: "31" },
  "D002-2": { rc: "306000310", sk: "31" },
  "D002-mix": { rc: "306000410", sk: "31" },
  "D009": { rc: "306001010", sk: "31" },
  "E100-1": { rc: "307000110", sk: "31" },
  "E100-pano": { rc: "307000510", sk: "31" },
  "E100-ct": { rc: "307001010", sk: "31" },
  "E100-1-diag": { rc: "307000150", sk: "31" },
  "E200-diag": { rc: "307100110", sk: "31" },
  // 投薬 (診療識別: 21)
  "F100": { rc: "305000110", sk: "21" },
  "F200": { rc: "305001010", sk: "21" },
  "F400": { rc: "305000610", sk: "21" },
  "F500": { rc: "305000810", sk: "21" },
  // 処置 (診療識別: 41=処置・手術1)
  "I000-1": { rc: "309000110", sk: "41" },
  "I000-2": { rc: "309000210", sk: "41" },
  "I000-3": { rc: "309000310", sk: "41" },
  "I000-4": { rc: "309000410", sk: "41" },
  "I005-1": { rc: "309002110", sk: "41" },
  "I005-2": { rc: "309002210", sk: "41" },
  "I005-3": { rc: "309002310", sk: "41" },
  "I006-1": { rc: "309002410", sk: "41" },
  "I006-2": { rc: "309002510", sk: "41" },
  "I006-3": { rc: "309002610", sk: "41" },
  "I007-1": { rc: "309002710", sk: "41" },
  "I007-2": { rc: "309002810", sk: "41" },
  "I007-3": { rc: "309002910", sk: "41" },
  "I008-1": { rc: "309003610", sk: "41" },
  "I008-2": { rc: "309003710", sk: "41" },
  "I008-3": { rc: "309003810", sk: "41" },
  "I010": { rc: "309004010", sk: "41" },
  "I010-2": { rc: "309004110", sk: "41" },
  "I011-1": { rc: "309004810", sk: "41" },
  "I011-2": { rc: "309004910", sk: "41" },
  "I011-1-3": { rc: "309005510", sk: "41" },
  "I011-2-1": { rc: "309005010", sk: "41" },
  "I011-2-2": { rc: "309005110", sk: "41" },
  "I011-2-3": { rc: "309005210", sk: "41" },
  "P-SC": { rc: "309004810", sk: "41" },
  "P-SRP": { rc: "309005210", sk: "41" },
  "P-SRP-zen": { rc: "309005010", sk: "41" },
  "P-SRP-sho": { rc: "309005110", sk: "41" },
  "I014": { rc: "309006010", sk: "41" },
  "I017": { rc: "309007010", sk: "41" },
  "I020": { rc: "309008010", sk: "41" },
  "I020-direct": { rc: "309008110", sk: "41" },
  "I029": { rc: "309010010", sk: "41" },
  "I030": { rc: "309010110", sk: "41" },
  "I030-2": { rc: "309010210", sk: "41" },
  "I032": { rc: "309011010", sk: "41" },
  "I032-dh": { rc: "309011020", sk: "41" },
  // 手術 (診療識別: 42=手術2(抜歯等), 43=手術3)
  "J-SEAL": { rc: "310099010", sk: "41" },
  "SEALANT": { rc: "310099010", sk: "41" },
  "J000-1": { rc: "310000010", sk: "42" },
  "J000-2": { rc: "310000110", sk: "42" },
  "J000-3": { rc: "310000210", sk: "42" },
  "J000-4": { rc: "310000410", sk: "42" },
  "J000-5": { rc: "310000510", sk: "42" },
  "J000-6": { rc: "310000310", sk: "42" },
  "J001": { rc: "310001010", sk: "43" },
  "J001-2": { rc: "310001210", sk: "43" },
  "J002": { rc: "310002010", sk: "43" },
  "J003": { rc: "310003010", sk: "43" },
  "J004": { rc: "310004010", sk: "43" },
  "J004-2": { rc: "310004110", sk: "43" },
  "J004-2-1": { rc: "310004210", sk: "43" },
  "J004-2-2": { rc: "310004220", sk: "43" },
  "J006": { rc: "310006010", sk: "43" },
  "J063": { rc: "310063010", sk: "43" },
  "J084": { rc: "310084010", sk: "43" },
  // 麻酔 (診療識別: 54)
  "K001-1": { rc: "311000210", sk: "54" },
  "K001-2": { rc: "311000310", sk: "54" },
  "K002": { rc: "311001010", sk: "54" },
  // 歯冠修復・欠損補綴 (診療識別: 61-64)
  "M-ADJ": { rc: "312090010", sk: "64" },
  "M-DEBOND": { rc: "312080010", sk: "64" },
  "M-DEBOND2": { rc: "312080020", sk: "64" },
  "M000-2": { rc: "312000210", sk: "61" },
  "M001-1": { rc: "312001110", sk: "61" },
  "M001-2": { rc: "312001210", sk: "61" },
  "M001-sho": { rc: "312001110", sk: "61" },
  "M001-3-1": { rc: "312001310", sk: "61" },
  "M001-3-2": { rc: "312001410", sk: "61" },
  "M002-1": { rc: "312002110", sk: "61" },
  "M002-2": { rc: "312002210", sk: "61" },
  "M003-1": { rc: "312003110", sk: "62" },
  "M003-2": { rc: "312003210", sk: "62" },
  "M003-3": { rc: "312003310", sk: "62" },
  "M003-2-1": { rc: "312003510", sk: "62" },
  "M003-2-2": { rc: "312003610", sk: "62" },
  "M003-2-3": { rc: "312003710", sk: "62" },
  "M005": { rc: "312005010", sk: "62" },
  "M009-CR": { rc: "312001110", sk: "61" },
};

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
    const { data: patientsData } = await supabase
      .from("patients")
      .select("*")
      .in("id", patientIds);
    const patientLookup = new Map(
      (patientsData || []).map((p: { id: string }) => [p.id, p])
    );

    // DB上のreceipt_codeマッピング（CODE_MAPに無い場合のフォールバック）
    const { data: receiptMap } = await supabase
      .from("fee_master_receipt")
      .select("kubun_code, sub_code, receipt_code, shinryo_shikibetsu");
    const dbLookup = new Map(
      (receiptMap || []).map(
        (r: { kubun_code: string; sub_code: string; receipt_code: string; shinryo_shikibetsu: string }) => [
          `${r.kubun_code}__${r.sub_code}`,
          { rc: r.receipt_code, sk: r.shinryo_shikibetsu },
        ]
      )
    );

    // クリニック情報
    const { data: settings } = await supabase
      .from("clinic_settings")
      .select("*")
      .limit(1)
      .single();
    const { data: clinicInfo } = await supabase
      .from("clinics")
      .select("name, phone")
      .limit(1)
      .single();
    const clinicCode = settings?.clinic_code || "3101471";
    const clinicPref = settings?.prefecture_code || "23";
    const clinicPhone = clinicInfo?.phone || "0000-00-0000";
    const clinicName = clinicInfo?.name || "";
    const facilityCode = settings?.facility_code || "0117";

    // 患者ごとにbillingをまとめる
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
      const pat = patientLookup.get(patientId) as Record<string, unknown> | undefined;
      if (!pat) continue;

      const insType = String(pat.insurance_type || "社保");
      const insCode = insType === "国保" ? "3" : insType === "後期高齢" ? "7" : "1";
      const sexCode = String(pat.sex || "2") === "男" || String(pat.sex || "2") === "1" ? "1" : "2";
      const dob = toYMD(String(pat.date_of_birth || ""));
      const burdenRatio = Number(pat.burden_ratio || 0.3);
      const burdenCode = Math.round(burdenRatio * 10);
      const patientTotalPoints = pBillings.reduce(
        (s: number, b: { total_points: number }) => s + b.total_points, 0
      );
      totalPointsAll += patientTotalPoints;

      // === RE レコード（レセプト共通） ===
      lines.push(
        `RE,${receiptNo},${insCode}1${burdenCode}2,${yearMonth},${pat.name_kanji || ""},${sexCode},${dob},${burdenCode * 10},,,,1,,,,,${pat.name_kana || ""},`
      );

      // === HO レコード（保険者） ===
      if (pat.insurer_number) {
        lines.push(
          `HO,${String(pat.insurer_number).padStart(8, "0")},,${toFull(String(pat.insured_symbol || ""))},${pat.insured_number || ""},${patientTotalPoints},,,,,,,,`
        );
      }

      // === KO レコード（公費） ===
      if (pat.public_insurer) {
        lines.push(
          `KO,${pat.public_insurer},${pat.public_recipient || ""},,1,${patientTotalPoints},,,,`
        );
      }

      // === SY レコード（傷病名部位） ===
      const { data: diagData } = await supabase
        .from("patient_diagnoses")
        .select("*")
        .eq("patient_id", patientId);
      if (diagData && diagData.length > 0) {
        for (const d of diagData) {
          const outcomeCode =
            d.outcome === "cured" ? "1" :
            d.outcome === "suspended" ? "3" :
            d.outcome === "died" ? "2" : "";
          const startYM = d.start_date
            ? d.start_date.replace(/-/g, "").substring(0, 6)
            : yearMonth;
          const endYM = d.end_date
            ? d.end_date.replace(/-/g, "").substring(0, 6)
            : "";
          lines.push(
            `SY,${d.diagnosis_code || ""},${d.diagnosis_name || ""},${startYM},${outcomeCode},${endYM},${d.modifier_code || ""},${(d.tooth_number || "").replace(/#/g, "")}`
          );
        }
      }

      // === SI レコード（歯科診療行為） ===
      for (const b of pBillings) {
        const procs = (b.procedures_detail || []) as {
          code: string; name: string; points: number; count: number;
          tooth_numbers?: string[];
        }[];

        for (const proc of procs) {
          if (proc.code.startsWith("BONUS-")) continue;

          // 1) CODE_MAPから検索（最優先・最も確実）
          let receiptCode = "";
          let shikibetsu = "";
          const mapped = CODE_MAP[proc.code];
          if (mapped) {
            receiptCode = mapped.rc;
            shikibetsu = mapped.sk;
          }

          // 2) DBから検索（CODE_MAPにないコード用）
          if (!receiptCode) {
            // kubun_code部分を抽出して検索
            const codeParts = proc.code.split("-");
            const kubun = codeParts[0];
            const sub = codeParts.slice(1).join("-") || "";
            const dbKey = `${kubun}__${sub}`;
            const dbFound = dbLookup.get(dbKey);
            if (dbFound) {
              receiptCode = dbFound.rc;
              shikibetsu = dbFound.sk;
            }
          }

          // 3) 9桁数字コードの場合はそのまま使用
          if (!receiptCode && /^\d{9}$/.test(proc.code)) {
            receiptCode = proc.code;
            let dbFound = dbLookup.get(`__${proc.code}`);
            if (!dbFound) {
              const entries = Array.from(dbLookup.entries());
              const match = entries.find(([, v]) => v.rc === proc.code);
              if (match) dbFound = match[1];
            }
            shikibetsu = dbFound?.sk || "80";
          }

          // 4) 最終フォールバック（警告付き）
          if (!receiptCode) {
            warnings.push(`receipt_code未解決: ${proc.code} (${proc.name})`);
            receiptCode = proc.code;
            // カテゴリから推定
            const c = proc.code.charAt(0);
            if (c === "A") shikibetsu = "11";
            else if (c === "B" || c === "H") shikibetsu = "13";
            else if (c === "D" || c === "E") shikibetsu = "31";
            else if (c === "F") shikibetsu = "21";
            else if (c === "I") shikibetsu = "41";
            else if (c === "J") shikibetsu = "42";
            else if (c === "K") shikibetsu = "54";
            else if (c === "M") shikibetsu = "62";
            else shikibetsu = "80";
          }

          const teethStr =
            proc.tooth_numbers && proc.tooth_numbers.length > 0
              ? proc.tooth_numbers.map((t: string) => t.replace(/^#/, "")).join(" ")
              : "";
          const futanKubun = pat.public_insurer ? "1" : "";

          // SI,診療識別,負担区分,診療行為コード(9桁),歯式,,点数,回数
          lines.push(
            `SI,${shikibetsu},${futanKubun},${receiptCode},${teethStr},,${proc.points},${proc.count}`
          );
        }
      }

      // === JD レコード（受診日等） ===
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

      // === MF レコード（窓口負担額） ===
      const windowAmount = Math.round(patientTotalPoints * 10 * burdenRatio);
      lines.push(`MF,${windowAmount}`);
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
