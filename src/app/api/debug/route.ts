import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function GET() {
  const supabase = createClient(supabaseUrl, supabaseKey);

  // 全患者
  const { data: patients } = await supabase.from("patients").select("id, name_kanji, date_of_birth, phone").limit(10);

  // 全予約（最新10件）
  const { data: appointments } = await supabase.from("appointments")
    .select("id, patient_id, scheduled_at, status, patient_type")
    .order("created_at", { ascending: false })
    .limit(10);

  // 今日のフィルタテスト
  const todayStr = new Date().toISOString().split("T")[0];
  const todayLocal = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}-${String(new Date().getDate()).padStart(2,"0")}`;

  const { data: todayApts1 } = await supabase.from("appointments")
    .select("id, scheduled_at, status")
    .gte("scheduled_at", `${todayStr}T00:00:00`)
    .lte("scheduled_at", `${todayStr}T23:59:59`);

  const { data: todayApts2 } = await supabase.from("appointments")
    .select("id, scheduled_at, status")
    .gte("scheduled_at", `${todayStr}T00:00:00+09:00`)
    .lte("scheduled_at", `${todayStr}T23:59:59+09:00`);

  const { data: todayApts3 } = await supabase.from("appointments")
    .select("id, scheduled_at, status")
    .gte("scheduled_at", `${todayLocal}T00:00:00`)
    .lte("scheduled_at", `${todayLocal}T23:59:59`);

  const { data: todayApts4 } = await supabase.from("appointments")
    .select("id, scheduled_at, status")
    .gte("scheduled_at", `${todayLocal}T00:00:00+09:00`)
    .lte("scheduled_at", `${todayLocal}T23:59:59+09:00`);

  return NextResponse.json({
    server_now: new Date().toISOString(),
    todayStr_utc: todayStr,
    todayStr_local: todayLocal,
    patients,
    recent_appointments: appointments,
    filter_results: {
      "no_tz": { filter: `${todayStr}T00:00:00 ~ T23:59:59`, count: todayApts1?.length, data: todayApts1 },
      "with_tz": { filter: `${todayStr}T00:00:00+09:00 ~ T23:59:59+09:00`, count: todayApts2?.length, data: todayApts2 },
      "local_no_tz": { filter: `${todayLocal}T00:00:00 ~ T23:59:59`, count: todayApts3?.length, data: todayApts3 },
      "local_with_tz": { filter: `${todayLocal}T00:00:00+09:00 ~ T23:59:59+09:00`, count: todayApts4?.length, data: todayApts4 },
    }
  });
}
