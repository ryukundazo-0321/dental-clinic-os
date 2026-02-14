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
    const { data: feeItems, error: feeErr } = await supabase.from("fee_master_legacy").select("*");
    if (feeErr || !feeItems || feeItems.length === 0) {
      return NextResponse.json({ error: "点数マスターが空です", detail: feeErr?.message }, { status: 500 });
    }

    const feeMap = new Map(feeItems.map((f: { code: string }) => [f.code, f]));

    // 4b. 届出済み施設基準の加算点数を取得
    let activeBonuses: { facility_code: string; target_kubun: string; target_sub: string; bonus_points: number; bonus_type: string; condition: string }[] = [];
    try {
      const { data: facilityBonuses } = await supabase
        .from("facility_bonus")
        .select("*, facility_standards!inner(is_registered)")
        .eq("is_active", true)
        .eq("facility_standards.is_registered", true);
      if (facilityBonuses) activeBonuses = facilityBonuses as typeof activeBonuses;
    } catch {
      // facility_bonusテーブルが存在しない場合はスキップ
    }

    // 5. SOAPテキストから処置を推定
    const soapAll = [record.soap_s, record.soap_o, record.soap_a, record.soap_p]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // 歯番抽出（#11〜#48, 11番〜48番 等）
    const soapRaw = [record.soap_s, record.soap_o, record.soap_a, record.soap_p].filter(Boolean).join(" ");
    const toothPattern = /[#＃]?\s*([1-4][1-8])\s*(?:番)?/g;
    const extractedTeeth: string[] = [];
    let toothMatch;
    while ((toothMatch = toothPattern.exec(soapRaw)) !== null) {
      const num = toothMatch[1];
      if (!extractedTeeth.includes(num)) extractedTeeth.push(num);
    }

    const selectedItems: { code: string; name: string; points: number; category: string; count: number; note: string; tooth_numbers: string[] }[] = [];

    const addItem = (code: string, count = 1, teeth: string[] = []) => {
      const fee = feeMap.get(code) as { code: string; name: string; points: number; category: string; conditions: { note?: string } } | undefined;
      if (fee) {
        selectedItems.push({
          code: fee.code, name: fee.name, points: fee.points,
          category: fee.category, count, note: fee.conditions?.note || "",
          tooth_numbers: teeth,
        });
      }
    };

    // === 自動算定ロジック ===
    // 基本診療料（歯番紐づけなし）
    if (isNew) { addItem("A000"); addItem("A001-a"); }
    else { addItem("A002"); addItem("A001-b"); }

    // 画像診断（歯番紐づけなし）
    if (soapAll.includes("パノラマ") || soapAll.includes("panorama")) {
      addItem("E100-pan"); addItem("E-diag");
    }
    if (soapAll.includes("デンタル") || soapAll.includes("レントゲン")) {
      addItem("E100-1"); addItem("E100-1-diag");
    }

    // 検査（歯番紐づけなし）
    if (soapAll.includes("歯周") && (soapAll.includes("検査") || soapAll.includes("ポケット"))) {
      addItem("D002-1");
    }

    // 麻酔（歯番あり）
    if (soapAll.includes("麻酔") || soapAll.includes("浸潤") || soapAll.includes("浸麻")) {
      addItem(soapAll.includes("伝達") ? "K001-2" : "K001-1", 1, extractedTeeth);
    }

    // CR充填（歯番あり）
    if (soapAll.includes("cr") || soapAll.includes("充填") || soapAll.includes("レジン") || soapAll.includes("光重合")) {
      if (soapAll.includes("複雑")) { addItem("M001-fuku", 1, extractedTeeth); addItem("M009-CR-fuku", 1, extractedTeeth); }
      else { addItem("M001-sho", 1, extractedTeeth); addItem("M009-CR", 1, extractedTeeth); }
    }

    // 歯内治療（歯番あり）
    if (soapAll.includes("抜髄")) {
      if (soapAll.includes("3根")) addItem("I001-3", 1, extractedTeeth);
      else if (soapAll.includes("2根")) addItem("I001-2", 1, extractedTeeth);
      else addItem("I001-1", 1, extractedTeeth);
    }
    if (soapAll.includes("感染根管")) addItem("I002-1", 1, extractedTeeth);
    if (soapAll.includes("根管充填") || soapAll.includes("根充")) addItem("I006-1", 1, extractedTeeth);
    if (soapAll.includes("貼薬")) addItem("I005", 1, extractedTeeth);

    // 歯周治療（歯番紐づけなし - 通常は部位単位）
    if (soapAll.includes("スケーリング") || soapAll.includes("sc")) addItem("I011-1");
    if (soapAll.includes("srp")) addItem("I011-SRP-2");

    // 抜歯（歯番あり）
    if (soapAll.includes("抜歯")) {
      if (soapAll.includes("難") || soapAll.includes("埋伏")) addItem("J001-3", 1, extractedTeeth);
      else if (soapAll.includes("臼歯") || soapAll.includes("奥歯")) addItem("J001-2", 1, extractedTeeth);
      else addItem("J001-1", 1, extractedTeeth);
    }

    // 投薬（歯番紐づけなし）
    if (soapAll.includes("処方") || soapAll.includes("投薬")) {
      addItem("F-shoho"); addItem("F-chozai"); addItem("F-yaku-1");
    }

    // 補綴 - インレー
    if (soapAll.includes("インレー") || soapAll.includes("inlay")) {
      if (soapAll.includes("複雑") || soapAll.includes("2面")) addItem("M-IN-fuku", 1, extractedTeeth);
      else addItem("M-IN-sho", 1, extractedTeeth);
      addItem("M-IMP-sei", 1, extractedTeeth); addItem("M-BITE", 1, extractedTeeth);
    }

    // 補綴 - クラウン
    if (soapAll.includes("クラウン") || soapAll.includes("fmc") || soapAll.includes("全部金属冠") || soapAll.includes("かぶせ")) {
      if (soapAll.includes("前装") || soapAll.includes("前歯")) addItem("M-CRN-ko", 1, extractedTeeth);
      else if (soapAll.includes("cad")) addItem("M-CRN-cad2", 1, extractedTeeth);
      else if (soapAll.includes("大臼歯")) addItem("M-CRN-zen-dai", 1, extractedTeeth);
      else addItem("M-CRN-zen", 1, extractedTeeth);
      addItem("M-IMP-sei", 1, extractedTeeth); addItem("M-BITE", 1, extractedTeeth);
    }

    // 補綴 - 支台築造
    if (soapAll.includes("コア") || soapAll.includes("支台築造")) {
      if (soapAll.includes("メタル") || soapAll.includes("間接")) addItem("M-POST-cast", 1, extractedTeeth);
      else addItem("M-POST", 1, extractedTeeth);
    }

    // 補綴 - TEK
    if (soapAll.includes("tek") || soapAll.includes("テック") || soapAll.includes("仮歯")) {
      addItem("M-TEK", 1, extractedTeeth);
    }

    // 補綴 - セット（装着）- 義歯以外の場合のみ
    if ((soapAll.includes("セット") || soapAll.includes("装着") || soapAll.includes("合着")) && !soapAll.includes("義歯") && !soapAll.includes("デンチャー") && !soapAll.includes("入れ歯")) {
      addItem("M-SET", 1, extractedTeeth);
    }

    // 補綴 - 印象（単独指示の場合）
    if ((soapAll.includes("印象") || soapAll.includes("型取り")) && !soapAll.includes("インレー") && !soapAll.includes("クラウン") && !soapAll.includes("義歯")) {
      if (soapAll.includes("精密")) addItem("M-IMP-sei", 1, extractedTeeth);
      else addItem("M-IMP", 1, extractedTeeth);
    }

    // ブリッジ
    if (soapAll.includes("ブリッジ") || soapAll.includes("br")) {
      addItem("M-CRN-zen", 1, extractedTeeth); addItem("BR-PON", 1, extractedTeeth);
      addItem("M-IMP-sei", 1, extractedTeeth); addItem("M-BITE", 1, extractedTeeth);
    }

    // 義歯
    if (soapAll.includes("義歯") || soapAll.includes("デンチャー") || soapAll.includes("入れ歯")) {
      const isDenAdj = soapAll.includes("調整") || soapAll.includes("あたり");
      const isDenRep = soapAll.includes("修理");
      const isDenReline = soapAll.includes("裏装") || soapAll.includes("リライン");
      const isDenSet = soapAll.includes("セット") || soapAll.includes("装着");
      const isDenMaintenanceOnly = (isDenAdj || isDenRep || isDenReline) && !isDenSet && !soapAll.includes("新製") && !soapAll.includes("作製");
      // 義歯本体は新製・セット時のみ
      if (!isDenMaintenanceOnly) {
        if (soapAll.includes("総義歯") || soapAll.includes("フルデンチャー")) {
          if (soapAll.includes("下")) addItem("DEN-FULL-LO"); else addItem("DEN-FULL-UP");
        } else {
          addItem("DEN-1-4");
        }
      }
      if (isDenAdj) addItem("DEN-ADJ");
      if (isDenRep) addItem("DEN-REP");
      if (isDenReline) addItem("DEN-RELINE");
      if (isDenSet) addItem("DEN-SET");
    }

    // 歯周外科
    if (soapAll.includes("フラップ") || soapAll.includes("歯周外科")) {
      addItem("PE-FLAP", 1, extractedTeeth);
    }
    if (soapAll.includes("小帯切除")) addItem("PE-FREN");
    if (soapAll.includes("歯肉切除")) addItem("PE-GVECT");

    // 口腔外科
    if (soapAll.includes("嚢胞") || soapAll.includes("のう胞")) addItem("OPE-NOH", 1, extractedTeeth);
    if (soapAll.includes("歯根端切除")) {
      if (soapAll.includes("大臼歯")) addItem("OPE-API-dai", 1, extractedTeeth);
      else addItem("OPE-API", 1, extractedTeeth);
    }
    if (soapAll.includes("切開") || soapAll.includes("排膿")) addItem("OPE-DRAIN", 1, extractedTeeth);
    if (soapAll.includes("縫合")) addItem("OPE-SUTURE", 1, extractedTeeth);

    // 医学管理
    if (soapAll.includes("管理料") || soapAll.includes("tbi") || soapAll.includes("ブラッシング指導")) {
      addItem("B-SHIDO"); addItem("B-DOC");
    }
    if (soapAll.includes("衛生指導") || soapAll.includes("衛生士指導")) addItem("B-HOKEN");

    // その他処置
    if (soapAll.includes("覆髄")) {
      if (soapAll.includes("直接")) addItem("PCEM-D", 1, extractedTeeth);
      else addItem("PCEM", 1, extractedTeeth);
    }
    if (soapAll.includes("固定") || soapAll.includes("暫間固定")) addItem("PERIO-FIX", 1, extractedTeeth);
    if (soapAll.includes("除去") && (soapAll.includes("冠") || soapAll.includes("セメント"))) addItem("DEBOND", 1, extractedTeeth);
    if (soapAll.includes("フッ素") || soapAll.includes("フッ化物")) addItem("F-COAT", 1, extractedTeeth);
    if (soapAll.includes("シーラント")) addItem("SEALANT", 1, extractedTeeth);

    // === 施設基準加算 ===
    // 同カテゴリの施設基準（例：外感染1と外感染2）が両方ONの場合は、
    // 同じtarget_kubunに対して最高点数のみ適用する
    const existingCodes = selectedItems.map(item => item.code);
    const hasShoshin = existingCodes.some(c => c === "A000" || c.startsWith("A000"));
    const hasSaishin = existingCodes.some(c => c === "A002" || c.startsWith("A002"));

    // facility_codeから数字を除いたグループ名を取得（gaikansen1→gaikansen, gaianzen2→gaianzen）
    const getGroup = (code: string) => code.replace(/[0-9]/g, "");

    // グループ×target_kubunごとに最高点数のボーナスだけ残す
    const bestBonus = new Map<string, typeof activeBonuses[0]>();
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

    // === 合計計算 ===
    const totalPoints = selectedItems.reduce((sum, item) => sum + item.points * item.count, 0);
    const patientBurden = Math.ceil(totalPoints * 10 * burdenRatio);
    const insuranceClaim = totalPoints * 10 - patientBurden;

    const warnings: string[] = [];
    if (isNew) warnings.push("📄 歯科疾患管理料の算定には管理計画書の印刷・患者への文書提供が必要です。カルテ画面の「管理計画書」ボタンから印刷できます。");
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
