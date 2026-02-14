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

    // 患者情報を個別取得
    const patientIds = Array.from(new Set(billings.map((b: { patient_id: string }) => b.patient_id)));
    const { data: patientsData } = await supabase.from("patients").select("*").in("id", patientIds);
    const patientLookup = new Map((patientsData || []).map((p: { id: string }) => [p.id, p]));

    const { data: settings } = await supabase.from("clinic_settings").select("*").limit(1).single();
    const { data: clinicInfo } = await supabase.from("clinics").select("name, phone").limit(1).single();
    const clinicCode = settings?.clinic_code || "3101471";
    const clinicPref = settings?.prefecture_code || "23";
    const clinicPhone = clinicInfo?.phone || settings?.phone || "0000-00-0000";
    const clinicName = clinicInfo?.name || "";

    const patientMap = new Map<string, typeof billings>();
    for (const b of billings) {
      const pid = b.patient_id;
      if (!patientMap.has(pid)) patientMap.set(pid, []);
      patientMap.get(pid)!.push(b);
    }

    const lines: string[] = [];
    lines.push(`UK,2,${clinicPref},3,${clinicCode},,${toFull(clinicName)},${yearMonth},0117,00`);

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

      lines.push(`IR,2,${clinicPref},3,${clinicCode},,${yearMonth},${clinicPhone},0117`);
      lines.push(`RE,${receiptNo},${insTypeCode}1${Math.round(burdenRatio * 10)}2,${yearMonth},${pat.name_kanji},${sexCode},${dob},${burdenPct},,,,1,,,${burdenPct},,,,,,,,,,,,${pat.name_kana || ""},`);

      if (pat.insurer_number) {
        lines.push(`HO,${String(pat.insurer_number).padStart(8, " ")},,${toFull(String(pat.insured_symbol || ""))},${pat.insured_number || ""},${patientTotalPoints},,,,,,,,`);
      }
      if (pat.public_insurer) {
        lines.push(`KO,${pat.public_insurer},${pat.public_recipient || ""},,1,${patientTotalPoints},,,,`);
      }

      // SNレコード（傷病名 - patient_diagnosesから取得）
      const { data: diagData } = await supabase.from("patient_diagnoses").select("*").eq("patient_id", patientKeys[ki]);
      if (diagData && diagData.length > 0) {
        for (let di = 0; di < diagData.length; di++) {
          const d = diagData[di];
          const outcomeCode = d.outcome === "cured" ? "01" : d.outcome === "suspended" ? "03" : d.outcome === "died" ? "02" : "";
          const startYM = d.start_date ? d.start_date.replace(/-/g, "").substring(0, 6) : yearMonth;
          lines.push(`SN,${di + 1},${outcomeCode || ""},${d.diagnosis_code || ""},${d.diagnosis_name || ""},${startYM},${outcomeCode || ""},,`);
        }
      } else {
        lines.push(`SN,1,01,,,,01,,`);
      }
      lines.push(`JD,1,,,,,,1,,,,,,,,,,,,,,,,,,,,,,,,,`);
      lines.push(`MF,00,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,,`);

      for (const b of pBillings) {
        const procs = (b.procedures_detail || []) as { code: string; points: number; count: number; tooth_numbers?: string[] }[];
        for (const proc of procs) {
          const rCode = proc.code;
          const rCat = "99";
          const pad = new Array(64).fill("").join(",");
          const teethStr = proc.tooth_numbers && proc.tooth_numbers.length > 0 ? proc.tooth_numbers.join(" ") : "";
          lines.push(`SS,${rCat},2,${rCode},,,${pad},${proc.points},${proc.count},${teethStr},,,,,,,,,,,,,,,,,,,,,,,`);
        }
      }
    }

    lines.push(`GO,${receiptNo},${totalPointsAll},99`);
    const csv = lines.join("\n");

    return NextResponse.json({ success: true, csv, receiptCount: receiptNo, totalPoints: totalPointsAll, yearMonth });
  } catch (error: unknown) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
