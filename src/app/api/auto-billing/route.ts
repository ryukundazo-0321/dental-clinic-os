import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await request.json();
    const recordId = body.record_id;
    if (!recordId) return NextResponse.json({ error: "record_id is required" }, { status: 400 });

    // 1. カルテ取得
    const { data: record, error: recErr } = await supabase
      .from("medical_records")
      .select("id, patient_id, appointment_id, soap_s, soap_o, soap_a, soap_p")
      .eq("id", recordId)
      .single();

    if (recErr || !record) {
      return NextResponse.json({ error: "カルテが見つかりません", detail: recErr?.message }, { status: 404 });
    }

    // 2. 予約取得（patient_typeを知るため）
    let isNew = true;
    if (record.appointment_id) {
      const { data: apt } = await supabase
        .from("appointments")
        .select("patient_type")
        .eq("id", record.appointment_id)
        .single();
      if (apt) isNew = apt.patient_type === "new";
    }

    // 3. 患者取得（burden_ratioを知るため）
    let burdenRatio = 0.3;
    let patientId = record.patient_id;
    if (patientId) {
      const { data: pat } = await supabase
        .from("patients")
        .select("burden_ratio")
        .eq("id", patientId)
        .single();
      if (pat?.burden_ratio) burdenRatio = pat.burden_ratio;
    }

    // 4. fee_master取得
    const { data: feeItems, error: feeErr } = await supabase.from("fee_master").select("*");
    if (feeErr || !feeItems || feeItems.length === 0) {
      return NextResponse.json({ error: "点数マスターが空です", detail: feeErr?.message }, { status: 500 });
    }

    const feeMap = new Map(feeItems.map((f: { code: string }) => [f.code, f]));

    // 5. SOAPテキストから処置を推定
    const soapAll = [record.soap_s, record.soap_o, record.soap_a, record.soap_p]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    const selectedItems: { code: string; name: string; points: number; category: string; count: number; note: string }[] = [];

    const addItem = (code: string, count = 1) => {
      const fee = feeMap.get(code) as { code: string; name: string; points: number; category: string; conditions: { note?: string } } | undefined;
      if (fee) {
        selectedItems.push({
          code: fee.code, name: fee.name, points: fee.points,
          category: fee.category, count, note: fee.conditions?.note || "",
        });
      }
    };

    // === 自動算定ロジック ===
    // 基本診療料
    if (isNew) { addItem("A000"); addItem("A001-a"); }
    else { addItem("A002"); addItem("A001-b"); }

    // 画像診断
    if (soapAll.includes("パノラマ") || soapAll.includes("panorama")) {
      addItem("E100-pan"); addItem("E-diag");
    }
    if (soapAll.includes("デンタル") || soapAll.includes("レントゲン")) {
      addItem("E100-1"); addItem("E100-1-diag");
    }

    // 検査
    if (soapAll.includes("歯周") && (soapAll.includes("検査") || soapAll.includes("ポケット"))) {
      addItem("D002-1");
    }

    // 麻酔
    if (soapAll.includes("麻酔") || soapAll.includes("浸潤") || soapAll.includes("浸麻")) {
      addItem(soapAll.includes("伝達") ? "K001-2" : "K001-1");
    }

    // CR充填
    if (soapAll.includes("cr") || soapAll.includes("充填") || soapAll.includes("レジン") || soapAll.includes("光重合")) {
      if (soapAll.includes("複雑")) { addItem("M001-fuku"); addItem("M009-CR-fuku"); }
      else { addItem("M001-sho"); addItem("M009-CR"); }
    }

    // 歯内治療
    if (soapAll.includes("抜髄")) {
      if (soapAll.includes("3根")) addItem("I001-3");
      else if (soapAll.includes("2根")) addItem("I001-2");
      else addItem("I001-1");
    }
    if (soapAll.includes("感染根管")) addItem("I002-1");
    if (soapAll.includes("根管充填") || soapAll.includes("根充")) addItem("I006-1");
    if (soapAll.includes("貼薬")) addItem("I005");

    // 歯周治療
    if (soapAll.includes("スケーリング") || soapAll.includes("sc")) addItem("I011-1");
    if (soapAll.includes("srp")) addItem("I011-SRP-2");

    // 抜歯
    if (soapAll.includes("抜歯")) {
      if (soapAll.includes("難") || soapAll.includes("埋伏")) addItem("J001-3");
      else if (soapAll.includes("臼歯") || soapAll.includes("奥歯")) addItem("J001-2");
      else addItem("J001-1");
    }

    // 投薬
    if (soapAll.includes("処方") || soapAll.includes("投薬")) {
      addItem("F-shoho"); addItem("F-chozai"); addItem("F-yaku-1");
    }

    // === 合計計算 ===
    const totalPoints = selectedItems.reduce((sum, item) => sum + item.points * item.count, 0);
    const patientBurden = Math.ceil(totalPoints * 10 * burdenRatio);
    const insuranceClaim = totalPoints * 10 - patientBurden;

    const warnings: string[] = [];
    if (isNew) warnings.push("歯科疾患管理料の算定には管理計画書の文書提供が必要です。");
    if (selectedItems.length <= 2) warnings.push("算定項目が少ない可能性があります。処置内容をご確認ください。");

    // 6. billingテーブルに保存（既存チェック→INSERT or UPDATE）
    const billingData = {
      record_id: recordId,
      patient_id: patientId,
      total_points: totalPoints,
      patient_burden: patientBurden,
      insurance_claim: insuranceClaim,
      burden_ratio: burdenRatio,
      procedures_detail: selectedItems,
      ai_check_warnings: warnings,
      claim_status: "pending",
      payment_status: "unpaid",
    };

    // 既存レコードがあるかチェック
    const { data: existing } = await supabase.from("billing").select("id").eq("record_id", recordId).limit(1);

    let billing = null;
    let billErr = null;

    if (existing && existing.length > 0) {
      // UPDATE
      const res = await supabase.from("billing").update(billingData).eq("record_id", recordId).select().single();
      billing = res.data;
      billErr = res.error;
    } else {
      // INSERT
      const res = await supabase.from("billing").insert(billingData).select().single();
      billing = res.data;
      billErr = res.error;
    }

    if (billErr) {
      return NextResponse.json({
        error: "billing保存失敗",
        detail: billErr.message,
        hint: billErr.hint || "",
        code: billErr.code || "",
        items: selectedItems,
        totalPoints,
        patientId,
        recordId,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      billing_id: billing?.id,
      total_points: totalPoints,
      patient_burden: patientBurden,
      insurance_claim: insuranceClaim,
      items: selectedItems,
      warnings,
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "算定エラー", detail: msg }, { status: 500 });
  }
}
