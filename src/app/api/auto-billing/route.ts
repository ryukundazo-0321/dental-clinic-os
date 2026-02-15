import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 型定義
interface FeeItem {
  code: string;
  name: string;
  points: number;
  category: string;
  conditions: { note?: string };
}

interface BillingPattern {
  pattern_name: string;
  category: string;
  soap_keywords: string[];
  soap_exclude_keywords: string[];
  fee_codes: string[];
  use_tooth_numbers: boolean;
  condition: { and_keywords?: string[] };
  priority: number;
}

interface SelectedItem {
  code: string;
  name: string;
  points: number;
  category: string;
  count: number;
  note: string;
  tooth_numbers: string[];
}

interface FacilityBonus {
  facility_code: string;
  target_kubun: string;
  target_sub: string;
  bonus_points: number;
  bonus_type: string;
  condition: string;
}

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
    const patientId = record.patient_id;
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
    const feeMap = new Map<string, FeeItem>(feeItems.map((f: FeeItem) => [f.code, f]));

    // 5. 現在有効な改定版を取得
    const { data: currentRevision } = await supabase
      .from("fee_revisions")
      .select("revision_code")
      .eq("is_current", true)
      .limit(1)
      .single();
    const currentRevCode = currentRevision?.revision_code || "R06";

    // 6. billing_patterns取得（優先度降順、現在の改定版で取得→なければR06フォールバック）
    let { data: patterns } = await supabase
      .from("billing_patterns")
      .select("*")
      .eq("is_active", true)
      .eq("revision_code", currentRevCode)
      .order("priority", { ascending: false });

    // 新改定版のパターンがなければR06にフォールバック
    if ((!patterns || patterns.length === 0) && currentRevCode !== "R06") {
      const fallback = await supabase
        .from("billing_patterns")
        .select("*")
        .eq("is_active", true)
        .eq("revision_code", "R06")
        .order("priority", { ascending: false });
      patterns = fallback.data;
    }

    // 7. 施設基準加算取得
    let activeBonuses: FacilityBonus[] = [];
    try {
      const { data: facilityBonuses } = await supabase
        .from("facility_bonus")
        .select("*, facility_standards!inner(is_registered)")
        .eq("is_active", true)
        .eq("facility_standards.is_registered", true);
      if (facilityBonuses) activeBonuses = facilityBonuses as FacilityBonus[];
    } catch {
      // facility_bonusテーブルが存在しない場合はスキップ
    }

    // 8. SOAPテキスト準備
    const soapAll = [record.soap_s, record.soap_o, record.soap_a, record.soap_p]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // 歯番抽出（永久歯11-48 + 乳歯51-85）
    const soapRaw = [record.soap_s, record.soap_o, record.soap_a, record.soap_p].filter(Boolean).join(" ");
    const toothPattern = /[#＃]?\s*([1-4][1-8]|[5-8][1-5])\s*(?:番)?/g;
    const extractedTeeth: string[] = [];
    let toothMatch;
    while ((toothMatch = toothPattern.exec(soapRaw)) !== null) {
      const num = toothMatch[1];
      if (!extractedTeeth.includes(num)) extractedTeeth.push(num);
    }

    const selectedItems: SelectedItem[] = [];
    const addedCodes = new Set<string>();

    // addItem関数（重複防止付き）
    const addItem = (code: string, count = 1, teeth: string[] = []) => {
      if (addedCodes.has(code)) return;
      const fee = feeMap.get(code);
      if (fee) {
        addedCodes.add(code);
        selectedItems.push({
          code: fee.code,
          name: fee.name,
          points: fee.points,
          category: fee.category,
          count,
          note: fee.conditions?.note || "",
          tooth_numbers: teeth,
        });
      }
    };

    // ============================================================
    // 9. 基本診療料（初診/再診は常に自動追加）
    // ============================================================
    if (isNew) {
      addItem("A000");
      addItem("A001-a");
    } else {
      addItem("A002");
      addItem("A001-b");
    }

    // ============================================================
    // 10. billing_patternsによるパターンマッチング
    // ============================================================
    if (patterns && patterns.length > 0) {
      const exclusiveCategories = new Set(["endo", "anesthesia", "basic"]);
      const matchedExclusive = new Set<string>();

      for (const pattern of patterns as BillingPattern[]) {
        if (pattern.category === "basic") continue;
        if (exclusiveCategories.has(pattern.category) && matchedExclusive.has(pattern.category)) continue;

        // キーワードマッチング
        const keywordsMatch = pattern.soap_keywords.some(kw => soapAll.includes(kw.toLowerCase()));
        if (!keywordsMatch) continue;

        // 除外キーワードチェック
        if (pattern.soap_exclude_keywords && pattern.soap_exclude_keywords.length > 0) {
          const excluded = pattern.soap_exclude_keywords.some(kw => soapAll.includes(kw.toLowerCase()));
          if (excluded) continue;
        }

        // AND条件チェック
        if (pattern.condition && pattern.condition.and_keywords && pattern.condition.and_keywords.length > 0) {
          const andMatch = pattern.condition.and_keywords.some(kw => soapAll.includes(kw.toLowerCase()));
          if (!andMatch) continue;
        }

        // === 特殊判定 ===
        // 抜髄: 根管数
        if (pattern.category === "endo" && pattern.pattern_name.includes("抜髄")) {
          if (pattern.pattern_name.includes("3根管") && !soapAll.includes("3根")) continue;
          if (pattern.pattern_name.includes("2根管") && !soapAll.includes("2根")) continue;
          if (pattern.pattern_name.includes("単根管") && (soapAll.includes("2根") || soapAll.includes("3根"))) continue;
        }

        // 麻酔: 浸潤/伝達
        if (pattern.category === "anesthesia") {
          if (pattern.pattern_name.includes("伝達") && !soapAll.includes("伝達")) continue;
          if (pattern.pattern_name.includes("浸潤") && soapAll.includes("伝達")) continue;
        }

        // CR充填: 単純/複雑
        if (pattern.category === "restoration") {
          if (pattern.pattern_name.includes("複雑") && !soapAll.includes("複雑")) continue;
          if (pattern.pattern_name.includes("単純") && soapAll.includes("複雑")) continue;
        }

        // 抜歯: 難易度
        if (pattern.category === "surgery") {
          if (pattern.pattern_name.includes("難") && !(soapAll.includes("難") || soapAll.includes("埋伏"))) continue;
          if (pattern.pattern_name.includes("臼歯") && !pattern.pattern_name.includes("難") && (soapAll.includes("難") || soapAll.includes("埋伏"))) continue;
          if (pattern.pattern_name.includes("前歯") && (soapAll.includes("臼歯") || soapAll.includes("奥歯") || soapAll.includes("難") || soapAll.includes("埋伏"))) continue;
        }

        // クラウン: 種類
        if (pattern.category === "prosth" && (pattern.pattern_name.includes("FMC") || pattern.pattern_name.includes("CAD") || pattern.pattern_name.includes("前装冠"))) {
          if (pattern.pattern_name.includes("CAD") && !soapAll.includes("cad")) continue;
          if (pattern.pattern_name.includes("前装") && !(soapAll.includes("前装") || soapAll.includes("前歯"))) continue;
          if (pattern.pattern_name.includes("大臼歯") && !soapAll.includes("大臼歯")) continue;
          if (pattern.pattern_name === "FMC" && (soapAll.includes("cad") || soapAll.includes("前装") || soapAll.includes("前歯") || soapAll.includes("大臼歯"))) continue;
        }

        // インレー: 単純/複雑
        if (pattern.pattern_name.includes("インレー")) {
          if (pattern.pattern_name.includes("複雑") && !(soapAll.includes("複雑") || soapAll.includes("2面"))) continue;
          if (pattern.pattern_name.includes("単純") && (soapAll.includes("複雑") || soapAll.includes("2面"))) continue;
        }

        // 支台築造: メタル/ファイバー
        if (pattern.pattern_name.includes("支台築造")) {
          if (pattern.pattern_name.includes("メタル") && !(soapAll.includes("メタル") || soapAll.includes("間接"))) continue;
          if (pattern.pattern_name.includes("ファイバー") && (soapAll.includes("メタル") || soapAll.includes("間接"))) continue;
        }

        // 義歯: サブタイプ
        if (pattern.category === "denture") {
          const isDenAdj = soapAll.includes("調整") || soapAll.includes("あたり");
          const isDenRep = soapAll.includes("修理");
          const isDenReline = soapAll.includes("裏装") || soapAll.includes("リライン");
          const isDenSet = soapAll.includes("セット") || soapAll.includes("装着");
          const isNewDen = soapAll.includes("新製") || soapAll.includes("作製");
          const isMaintenanceOnly = (isDenAdj || isDenRep || isDenReline) && !isDenSet && !isNewDen;

          if (pattern.pattern_name.includes("調整") && !isDenAdj) continue;
          if (pattern.pattern_name.includes("修理") && !isDenRep) continue;
          if (pattern.pattern_name.includes("リライン") && !isDenReline) continue;
          if (pattern.pattern_name.includes("装着") && !isDenSet) continue;
          if (pattern.pattern_name.includes("総義歯") && !(soapAll.includes("総義歯") || soapAll.includes("フルデンチャー"))) continue;
          if (pattern.pattern_name.includes("上顎") && soapAll.includes("下")) continue;
          if (pattern.pattern_name.includes("下顎") && !soapAll.includes("下")) continue;
          if (pattern.pattern_name.includes("部分床") && isMaintenanceOnly) continue;
          if (pattern.pattern_name.includes("部分床") && (soapAll.includes("総義歯") || soapAll.includes("フルデンチャー"))) continue;
        }

        // 覆髄: 直接/間接
        if (pattern.pattern_name.includes("覆髄")) {
          if (pattern.pattern_name.includes("直接") && !soapAll.includes("直接")) continue;
          if (pattern.pattern_name.includes("間接") && soapAll.includes("直接")) continue;
        }

        // 歯根端切除: 大臼歯
        if (pattern.pattern_name.includes("歯根端切除")) {
          if (pattern.pattern_name.includes("大臼歯") && !soapAll.includes("大臼歯")) continue;
          if (!pattern.pattern_name.includes("大臼歯") && soapAll.includes("大臼歯")) continue;
        }

        // 装着: 義歯セットと区別
        if (pattern.pattern_name === "装着") {
          if (soapAll.includes("義歯") || soapAll.includes("デンチャー") || soapAll.includes("入れ歯")) continue;
        }

        // === マッチ成功 ===
        const teeth = pattern.use_tooth_numbers ? extractedTeeth : [];
        for (const code of pattern.fee_codes) {
          addItem(code, 1, teeth);
        }
        if (exclusiveCategories.has(pattern.category)) {
          matchedExclusive.add(pattern.category);
        }
      }
    } else {
      // フォールバック（billing_patterns取得失敗時の最低限ロジック）
      if (soapAll.includes("パノラマ")) { addItem("E100-pan"); addItem("E-diag"); }
      if (soapAll.includes("デンタル")) { addItem("E100-1"); addItem("E100-1-diag"); }
      if (soapAll.includes("麻酔") || soapAll.includes("浸潤")) { addItem("K001-1", 1, extractedTeeth); }
      if (soapAll.includes("処方")) { addItem("F-shoho"); addItem("F-chozai"); addItem("F-yaku-1"); }
    }

    // ============================================================
    // 11. 施設基準加算
    // ============================================================
    const existingCodes = selectedItems.map(item => item.code);
    const hasShoshin = existingCodes.some(c => c === "A000" || c.startsWith("A000"));
    const hasSaishin = existingCodes.some(c => c === "A002" || c.startsWith("A002"));

    const getGroup = (code: string) => code.replace(/[0-9]/g, "");
    const bestBonus = new Map<string, FacilityBonus>();

    for (const bonus of activeBonuses) {
      if (bonus.bonus_type !== "add" || bonus.bonus_points <= 0) continue;
      const groupKey = `${getGroup(bonus.facility_code)}__${bonus.target_kubun}`;
      const existing = bestBonus.get(groupKey);
      if (!existing || bonus.bonus_points > existing.bonus_points) {
        bestBonus.set(groupKey, bonus);
      }
    }

    Array.from(bestBonus.values()).forEach(bonus => {
      const isShoshinBonus = bonus.target_kubun === "A000";
      const isSaishinBonus = bonus.target_kubun === "A002";
      const hasTarget = existingCodes.some(c => c === bonus.target_kubun || c.startsWith(bonus.target_kubun));
      if ((isShoshinBonus && hasShoshin) || (isSaishinBonus && hasSaishin) || hasTarget) {
        selectedItems.push({
          code: `BONUS-${bonus.facility_code}-${bonus.target_kubun}`,
          name: `施設基準加算（${bonus.condition}）`,
          points: bonus.bonus_points,
          category: "加算",
          count: 1,
          note: bonus.facility_code,
          tooth_numbers: [],
        });
      }
    });

    // ============================================================
    // 12. 合計計算
    // ============================================================
    const totalPoints = selectedItems.reduce((sum, item) => sum + item.points * item.count, 0);
    const patientBurden = Math.ceil(totalPoints * 10 * burdenRatio);
    const insuranceClaim = totalPoints * 10 - patientBurden;

    const warnings: string[] = [];
    if (isNew) warnings.push("📄 歯科疾患管理料の算定には管理計画書の印刷・患者への文書提供が必要です。カルテ画面の「管理計画書」ボタンから印刷できます。");
    if (selectedItems.length <= 2) warnings.push("算定項目が少ない可能性があります。処置内容をご確認ください。");

    // ============================================================
    // 13. billingテーブルに保存
    // ============================================================
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

    const { data: existingBilling } = await supabase.from("billing").select("id").eq("record_id", recordId).limit(1);
    let billing = null;
    let billErr = null;

    if (existingBilling && existingBilling.length > 0) {
      const res = await supabase.from("billing").update(billingData).eq("record_id", recordId).select().single();
      billing = res.data;
      billErr = res.error;
    } else {
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
