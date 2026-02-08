import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const { record_id } = await request.json();
    if (!record_id) return NextResponse.json({ error: "record_id is required" }, { status: 400 });

    const supabase = createClient(supabaseUrl, supabaseKey);

    // カルテ取得
    const { data: record } = await supabase
      .from("medical_records")
      .select("*, appointments(patient_type, patients(burden_ratio, insurance_type))")
      .eq("id", record_id)
      .single();

    if (!record) return NextResponse.json({ error: "カルテが見つかりません" }, { status: 404 });

    // fee_master全件取得
    const { data: feeItems } = await supabase.from("fee_master").select("*");
    if (!feeItems) return NextResponse.json({ error: "点数マスターが空です" }, { status: 500 });

    const feeMap = new Map(feeItems.map(f => [f.code, f]));

    // SOAPとtooth_chartから処置内容を推定
    const soapAll = `${record.soap_s || ""} ${record.soap_o || ""} ${record.soap_a || ""} ${record.soap_p || ""}`.toLowerCase();
    const isNew = record.appointments?.patient_type === "new";
    const burdenRatio = record.appointments?.patients?.burden_ratio || 0.3;

    const selectedItems: { code: string; name: string; points: number; category: string; count: number; note: string }[] = [];

    const addItem = (code: string, count = 1) => {
      const fee = feeMap.get(code);
      if (fee) {
        selectedItems.push({
          code: fee.code,
          name: fee.name,
          points: fee.points,
          category: fee.category,
          count,
          note: fee.conditions?.note || "",
        });
      }
    }

    // ===== 自動算定ロジック =====

    // 1. 基本診療料
    if (isNew) {
      addItem("A000"); // 初診料
      addItem("A001-a"); // 明細書加算（初診）
    } else {
      addItem("A002"); // 再診料
      addItem("A001-b"); // 明細書加算（再診）
    }

    // 2. 画像診断
    if (soapAll.includes("パノラマ") || soapAll.includes("panorama") || soapAll.includes("全顎")) {
      addItem("E100-pan");
      addItem("E-diag");
    }
    if (soapAll.includes("デンタル") || soapAll.includes("dental") || (soapAll.includes("レントゲン") && !soapAll.includes("パノラマ"))) {
      addItem("E100-1");
      addItem("E100-1-diag");
    }

    // 3. 検査
    if (soapAll.includes("歯周") && (soapAll.includes("検査") || soapAll.includes("ポケット") || soapAll.includes("p検"))) {
      addItem("D002-1"); // 20歯以上
    }

    // 4. 麻酔
    if (soapAll.includes("麻酔") || soapAll.includes("浸潤") || soapAll.includes("浸麻")) {
      if (soapAll.includes("伝達")) {
        addItem("K001-2");
      } else {
        addItem("K001-1");
      }
    }

    // 5. CR充填
    if (soapAll.includes("cr") || soapAll.includes("充填") || soapAll.includes("レジン") || soapAll.includes("光重合")) {
      if (soapAll.includes("複雑")) {
        addItem("M001-fuku");
        addItem("M009-CR-fuku");
      } else {
        addItem("M001-sho");
        addItem("M009-CR");
      }
    }

    // 6. 歯内治療
    if (soapAll.includes("抜髄")) {
      if (soapAll.includes("3根") || soapAll.includes("大臼歯")) {
        addItem("I001-3");
      } else if (soapAll.includes("2根")) {
        addItem("I001-2");
      } else {
        addItem("I001-1");
      }
    }
    if (soapAll.includes("感染根管") || soapAll.includes("感根")) {
      addItem("I002-1");
    }
    if (soapAll.includes("根管充填") || soapAll.includes("根充")) {
      addItem("I006-1");
    }
    if (soapAll.includes("貼薬")) {
      addItem("I005");
    }

    // 7. 歯周治療
    if (soapAll.includes("スケーリング") || soapAll.includes("sc")) {
      addItem("I011-1");
    }
    if (soapAll.includes("srp")) {
      addItem("I011-SRP-2");
    }

    // 8. 抜歯
    if (soapAll.includes("抜歯")) {
      if (soapAll.includes("難") || soapAll.includes("埋伏")) {
        addItem("J001-3");
      } else if (soapAll.includes("臼歯") || soapAll.includes("奥歯")) {
        addItem("J001-2");
      } else {
        addItem("J001-1");
      }
    }

    // 9. 投薬
    if (soapAll.includes("処方") || soapAll.includes("投薬") || soapAll.includes("薬")) {
      addItem("F-shoho");
      addItem("F-chozai");
      addItem("F-yaku-1");
    }

    // 10. 医学管理
    // 注意: 歯科疾患管理料は管理計画書が必要
    // addItem("B000-1"); // 自動では入れない（要確認）

    // ===== 合計計算 =====
    const totalPoints = selectedItems.reduce((sum, item) => sum + item.points * item.count, 0);
    const patientBurden = Math.ceil(totalPoints * 10 * burdenRatio); // 1点=10円
    const insuranceClaim = totalPoints * 10 - patientBurden;

    // AI算定チェック（警告）
    const warnings: string[] = [];
    if (isNew && !selectedItems.some(i => i.code === "B000-1")) {
      warnings.push("歯科疾患管理料の算定には管理計画書の文書提供が必要です。");
    }
    if (selectedItems.length <= 2) {
      warnings.push("算定項目が少ない可能性があります。処置内容をご確認ください。");
    }

    // billingテーブルに保存
    const { data: billing, error: billingError } = await supabase.from("billing").upsert({
      record_id,
      patient_id: record.patient_id,
      total_points: totalPoints,
      patient_burden: patientBurden,
      insurance_claim: insuranceClaim,
      burden_ratio: burdenRatio,
      procedures_detail: selectedItems,
      ai_check_warnings: warnings,
      claim_status: "pending",
      payment_status: "unpaid",
    }, { onConflict: "record_id" }).select().single();

    if (billingError) {
      console.error("Billing save error:", billingError);
    }

    return NextResponse.json({
      success: true,
      billing_id: billing?.id,
      total_points: totalPoints,
      patient_burden: patientBurden,
      insurance_claim: insuranceClaim,
      burden_ratio: burdenRatio,
      items: selectedItems,
      warnings,
    });

  } catch (error) {
    console.error("Auto-billing error:", error);
    return NextResponse.json({ error: "算定エラーが発生しました" }, { status: 500 });
  }
}
