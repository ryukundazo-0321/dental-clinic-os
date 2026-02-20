import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { patient_number, pin } = body;

    if (!patient_number || !pin) {
      return NextResponse.json(
        { success: false, error: "患者番号とPINを入力してください" },
        { status: 400 }
      );
    }

    // 患者番号で検索
    const { data: patient, error } = await supabase
      .from("patients")
      .select("id, patient_number, name_kanji, name_kana, pin")
      .eq("patient_number", patient_number.toUpperCase())
      .single();

    if (error || !patient) {
      return NextResponse.json(
        { success: false, error: "患者番号が見つかりません" },
        { status: 401 }
      );
    }

    // PIN照合
    if (patient.pin !== pin) {
      return NextResponse.json(
        { success: false, error: "PINが正しくありません" },
        { status: 401 }
      );
    }

    // 認証成功 - 患者IDを返す
    return NextResponse.json({
      success: true,
      patient: {
        id: patient.id,
        patient_number: patient.patient_number,
        name_kanji: patient.name_kanji,
        name_kana: patient.name_kana,
      },
    });
  } catch (e) {
    console.error("Login error:", e);
    return NextResponse.json(
      { success: false, error: "サーバーエラーが発生しました" },
      { status: 500 }
    );
  }
}
