import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

function toFull(s: string): string {
  return s.replace(/[\x21-\x7e]/g, c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).replace(/ /g, "\u3000");
}
function toYMD(d: string): string { return d.replace(/-/g, ""); }

export async function POST(request: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseKey);
  try {
    const { yearMonth } = await request.json();
    if (!yearMonth || yearMonth.length !== 6) {
      return NextResponse.json({ error: "yearMonth (YYYYMM) is required" }, { status: 400 });
    }
    const year = yearMonth.substring(0, 4);
    const month = yearMonth.substring(4, 6);
    const startDate = `${year}-${month}-01`;
    const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
    const endDate = `${year}-${month}-${String(lastDay).padStart(2, "0")}`;

    const { data: billings, error: bErr } = await supabase.from("billing")
      .select("*")
      .gte("created_at", `${startDate}T00:00:00`).lte("created_at", `${endDate}T23:59:59`)
      .eq("payment_status", "paid");

    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 });
    if (!billings || billings.length === 0) return NextResponse.json({ error: "該当月の精算済みデータがありません" }, { status: 404 });

    // 患者情報を取得
    const patientIds = Array.from(new Set(billings.map((b: { patient_id: string }) => b.patient_id)));
    const { data: patientsData } = await supabase.from("patients").select("*").in("id", patientIds);
    const patientLookup = new Map((patientsData || []).map((p: { id: string }) => [p.id, p]));

    // receipt_code マッピングを取得
    const { data: receiptMap } = await supabase.from("fee_master_receipt").select("code, receipt_code");
    const receiptCodeLookup = new Map((receiptMap || []).map((r: { code: string; receipt_code: string }) => [r.code, r.receipt_code]));

    // クリニック情報
    const { data: settings } = await supabase.from("clinic_settings").select("*").limit(1).single();
    const { data: clinicInfo } = await supabase.from("clinics").select("name, phone").limit(1).single();
    const clinicCode = settings?.clinic_code || "3101471";
    const clinicPref = settings?.prefecture_code || "23";
    const clinicPhone = clinicInfo?.phone || "0000-00-0000";
    const clinicName = clinicInfo?.name || "";

    // 患者ごとにbillingをまとめる
    const patientMap = new Map<string, typeof billings>();
    for (const b of billings) {
      const pid = b.patient_id;
      if (!patientMap.has(pid)) patientMap.set(pid, []);
      patientMap.get(pid)!.push(b);
    }

    const lines: string[] = [];

    // === UKレコード（ファイルヘッダー）===
    lines.push(`UK,2,${clinicPref},3,${clinicCode},,${toFull(clinicName)},${yearMonth},0117,00`);

    // === IRレコード（医療機関情報、1回のみ）===
    lines.push(`IR,2,${clinicPref},3,${clinicCode},,${yearMonth},${clinicPhone},0117`);

    let receiptNo = 0;
    let totalPointsAll = 0;

    const patientKeys = Array.from(patientMap.keys());
    for (let ki = 0; ki < patientKeys.length; ki++) {
      const pBillings = patientMap.get(patientKeys[ki])!;
      receiptNo++;
      const firstB = pBillings[0];
      const pat = patientLookup.get(firstB.patient_id) as Record<string, unknown> | undefined;
      if (!pat) continue;

      const insType = String(pat.insurance_type || "社保");
      const insTypeCode = insType === "国保" ? "3" : insType === "後期高齢" ? "7" : "1";
      const sexCode = String(pat.sex || "2") === "男" || String(pat.sex || "2") === "1" ? "1" : "2";
      const dob = toYMD(String(pat.date_of_birth || ""));
      const burdenRatio = Number(pat.burden_ratio || 0.3);
      const burdenPct = Math.round(burdenRatio * 10) * 10;
      const patientTotalPoints = pBillings.reduce((s: number, b: { total_points: number }) => s + b.total_points, 0);
      totalPointsAll += patientTotalPoints;

      // === REレコード（レセプト共通）===
      lines.push(`RE,${receiptNo},${insTypeCode}1${Math.round(burdenRatio * 10)}2,${yearMonth},${pat.name_kanji},${sexCode},${dob},${burdenPct},,,,1,,,${burdenPct},,,,,,,,,,,,${pat.name_kana || ""},`);

      // === HOレコード（保険者）===
      if (pat.insurer_number) {
        lines.push(`HO,${String(pat.insurer_number).padStart(8, " ")},,${toFull(String(pat.insured_symbol || ""))},${pat.insured_number || ""},${patientTotalPoints},,,,,,,,`);
      }

      // === KOレコード（公費）===
      if (pat.public_insurer) {
        lines.push(`KO,${pat.public_insurer},${pat.public_recipient || ""},,1,${patientTotalPoints},,,,`);
      }

      // === SYレコード（傷病名）===
      const { data: diagData } = await supabase.from("patient_diagnoses").select("*").eq("patient_id", patientKeys[ki]);
      if (diagData && diagData.length > 0) {
        for (let di = 0; di < diagData.length; di++) {
          const d = diagData[di];
          const outcomeCode = d.outcome === "cured" ? "1" : d.outcome === "suspended" ? "3" : d.outcome === "died" ? "2" : "";
          const startYM = d.start_date ? d.start_date.replace(/-/g, "").substring(0, 6) : yearMonth;
          const endYM = d.end_date ? d.end_date.replace(/-/g, "").substring(0, 6) : "";
          lines.push(`SY,${d.diagnosis_code || ""},${d.diagnosis_name || ""},${startYM},${outcomeCode},${endYM},,`);
        }
      }

      // === SIレコード（診療行為）===
      for (const b of pBillings) {
        const procs = (b.procedures_detail || []) as { code: string; name: string; points: number; count: number; tooth_numbers?: string[] }[];

        for (const proc of procs) {
          // BONUSコードはSIレコードに含めない
          if (proc.code.startsWith("BONUS-")) continue;

          const rCode = receiptCodeLookup.get(proc.code) || proc.code;
          const teethStr = proc.tooth_numbers && proc.tooth_numbers.length > 0
            ? proc.tooth_numbers.join(" ") : "";

          // 診療識別コード（2桁）
          let shinryoShikibetsu = "99";
          if (proc.code.startsWith("A0")) shinryoShikibetsu = "11";
          else if (proc.code.startsWith("A001") || proc.code.startsWith("B-")) shinryoShikibetsu = "13";
          else if (proc.code.startsWith("D0")) shinryoShikibetsu = "14";
          else if (proc.code.startsWith("E1") || proc.code.startsWith("E-")) shinryoShikibetsu = "17";
          else if (proc.code.startsWith("F-") || proc.code.startsWith("F2")) shinryoShikibetsu = "21";
          else if (proc.code.startsWith("I0") || proc.code.startsWith("PCEM") || proc.code.startsWith("PERIO")) shinryoShikibetsu = "30";
          else if (proc.code.startsWith("J0") || proc.code.startsWith("PE-") || proc.code.startsWith("OPE-") || proc.code.startsWith("SEALANT")) shinryoShikibetsu = "40";
          else if (proc.code.startsWith("K0")) shinryoShikibetsu = "50";
          else if (proc.code.startsWith("M") || proc.code.startsWith("BR-") || proc.code.startsWith("DEN-") || proc.code.startsWith("DEBOND")) shinryoShikibetsu = "60";

          lines.push(`SI,${shinryoShikibetsu},${rCode},${proc.name},${proc.points},${proc.count},${teethStr},,`);
        }
      }

      // === JDレコード（受診日等）===
      const visitDays = pBillings.map(b => new Date(b.created_at).getDate());
      const uniqueDays = Array.from(new Set(visitDays)).sort((a, b) => a - b);
      const dayFlags = new Array(31).fill(0);
      uniqueDays.forEach(d => { if (d >= 1 && d <= 31) dayFlags[d - 1] = 1; });
      lines.push(`JD,${uniqueDays.length},${dayFlags.join(",")},,`);

      // === MFレコード（点数集計）===
      lines.push(`MF,${patientTotalPoints},,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,`);
    }

    // === GOレコード（ファイル終了）===
    lines.push(`GO,${receiptNo},${totalPointsAll},99`);
    const csv = lines.join("\n");

    return NextResponse.json({
      success: true,
      csv,
      receiptCount: receiptNo,
      totalPoints: totalPointsAll,
      yearMonth,
      receiptCodeCoverage: `${receiptCodeLookup.size}コード中${Array.from(receiptCodeLookup.values()).filter(v => v).length}件にreceipt_code設定済み`,
    });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
