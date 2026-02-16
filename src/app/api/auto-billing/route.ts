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

// ============================================================
// [B-1] 医薬品の型定義
// ============================================================
interface DrugItem {
  yj_code: string;
  name: string;
  unit_price: number;
  unit: string;
  dosage_form: string;
  default_dose: string;
  default_frequency: string;
  default_days: number;
  drug_category: string;
  receipt_code: string;
}

// ============================================================
// [B-1] 処方キーワード → 薬名マッピング
// SOAPに書かれるキーワードから適切な薬を自動選択する
// ============================================================
const PRESCRIPTION_KEYWORDS: {
  keywords: string[];
  drugNames: string[];
  category: string;
  withStomach?: boolean; // NSAIDsの場合、胃薬もセットで出す
}[] = [
  // 鎮痛薬
  {
    keywords: ["ロキソニン", "ロキソプロフェン", "痛み止め", "鎮痛"],
    drugNames: ["ロキソプロフェンNa錠60mg"],
    category: "消炎鎮痛薬",
    withStomach: true,
  },
  {
    keywords: ["カロナール", "アセトアミノフェン"],
    drugNames: ["カロナール錠200"],
    category: "解熱鎮痛薬",
    withStomach: false,
  },
  {
    keywords: ["ボルタレン", "ジクロフェナク"],
    drugNames: ["ボルタレン錠25mg"],
    category: "消炎鎮痛薬",
    withStomach: true,
  },
  {
    keywords: ["セレコックス", "セレコキシブ"],
    drugNames: ["セレコックス錠100mg"],
    category: "消炎鎮痛薬",
    withStomach: true,
  },
  // 抗菌薬
  {
    keywords: ["アモキシシリン", "サワシリン", "パセトシン", "ペニシリン"],
    drugNames: ["アモキシシリンカプセル250mg"],
    category: "抗菌薬（ペニシリン系）",
  },
  {
    keywords: ["フロモックス", "セフカペン"],
    drugNames: ["フロモックス錠100mg"],
    category: "抗菌薬（セフェム系）",
  },
  {
    keywords: ["メイアクト", "セフジトレン"],
    drugNames: ["メイアクトMS錠100mg"],
    category: "抗菌薬（セフェム系）",
  },
  {
    keywords: ["ジスロマック", "アジスロマイシン"],
    drugNames: ["ジスロマック錠250mg"],
    category: "抗菌薬（マクロライド系）",
  },
  {
    keywords: ["クラリス", "クラリスロマイシン"],
    drugNames: ["クラリスロマイシン錠200mg"],
    category: "抗菌薬（マクロライド系）",
  },
  // 含嗽薬
  {
    keywords: ["アズノール", "うがい"],
    drugNames: ["アズノールうがい液4%"],
    category: "含嗽薬",
  },
  {
    keywords: ["イソジン"],
    drugNames: ["イソジンガーグル液7%"],
    category: "含嗽薬",
  },
  // 口内炎用
  {
    keywords: ["口内炎", "アフタ", "デキサメタゾン軟膏"],
    drugNames: ["デキサメタゾン口腔用軟膏1mg"],
    category: "口腔用軟膏",
  },
  {
    keywords: ["ケナログ"],
    drugNames: ["ケナログ口腔用軟膏0.1%"],
    category: "口腔用軟膏",
  },
  // 止血薬
  {
    keywords: ["トランサミン", "トラネキサム酸", "止血"],
    drugNames: ["トランサミンカプセル250mg"],
    category: "消炎酵素薬",
  },
  // 抗ウイルス
  {
    keywords: ["バルトレックス", "バラシクロビル", "ヘルペス"],
    drugNames: ["バラシクロビル錠500mg"],
    category: "抗ウイルス薬",
  },
  // 抗真菌
  {
    keywords: ["フロリード", "カンジダ"],
    drugNames: ["フロリードゲル経口用2%"],
    category: "抗真菌薬",
  },
  // 胃薬（単独処方）
  {
    keywords: ["レバミピド", "ムコスタ", "胃薬"],
    drugNames: ["レバミピド錠100mg"],
    category: "胃粘膜保護薬",
  },
];

// 胃薬のデフォルト名
const DEFAULT_STOMACH_DRUG = "レバミピド錠100mg";

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

    // 4. fee_master取得（※Supabaseデフォルト1000行制限を回避）
    const { data: feeItems, error: feeErr } = await supabase.from("fee_master").select("*").limit(10000);
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

    // ============================================================
    // [B-1] 医薬品マスタ取得
    // ============================================================
    const { data: drugItems } = await supabase
      .from("drug_master")
      .select("*")
      .eq("is_active", true);
    const drugByName = new Map<string, DrugItem>(
      (drugItems || []).map((d: DrugItem) => [d.name, d])
    );

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
      // 投薬の技術料はprescribedDrugs検出時に F100/F200 で自動追加（後段ロジック）
    }

    // ============================================================
    // [B-4] 補綴・義歯の付随項目を自動追加
    // billing_patternsのメイン項目に加え、必須の関連項目を自動算定
    // 冠・ブリッジ: 印象 + 咬合採得 + 装着 + 補綴時診断
    // 義歯新製: 精密印象 + 咬合採得 + 義歯装着 + 補綴時診断
    // 形成あり: TEK（仮歯）
    // ============================================================
    const prosthCodes = Array.from(addedCodes);
    const hasProsthMain = prosthCodes.some(c =>
      c.startsWith("M-CRN-") || c.startsWith("M003-") || c === "BR-PON" ||
      c.startsWith("M-IN-") || c.startsWith("M001-3")
    );
    const hasDentureNew = prosthCodes.some(c =>
      c.startsWith("DEN-1-") || c.startsWith("DEN-5-") || c.startsWith("DEN-9-") ||
      c.startsWith("DEN-12-") || c.startsWith("DEN-FULL")
    );
    const hasFormation = prosthCodes.some(c =>
      c === "M001-1" || c === "M001-2" || c === "M001-fuku" ||
      c === "M001-sho" || c === "M003-1" || c === "M003-2" || c === "M003-3"
    );
    const isDenMaintenance = prosthCodes.some(c =>
      c === "DEN-ADJ" || c === "DEN-REP" || c === "DEN-RELINE"
    );

    // 冠・ブリッジの新製工程
    if (hasProsthMain && !isDenMaintenance) {
      addItem("M-IMP", 1, extractedTeeth);      // 印象採得
      addItem("M-BITE", 1, extractedTeeth);      // 咬合採得
      addItem("M-SET", 1, extractedTeeth);       // 装着
      addItem("M-HOHEKI", 1, extractedTeeth);    // 補綴時診断
    }

    // 義歯の新製工程
    if (hasDentureNew) {
      addItem("M-IMP-sei", 1, []);    // 精密印象（義歯は部位不要）
      addItem("M-BITE", 1, []);       // 咬合採得
      addItem("DEN-SET", 1, []);      // 義歯装着
      addItem("M-HOHEKI", 1, []);     // 補綴時診断
    }

    // 形成があればTEK（仮歯）を追加
    if (hasFormation && (soapAll.includes("tek") || soapAll.includes("仮歯") || soapAll.includes("テンポラリー") || soapAll.includes("テック"))) {
      addItem("M-TEK", 1, extractedTeeth);
    }

    // 支台築造があれば形成も追加
    if (prosthCodes.some(c => c === "M-POST" || c === "M-POST-cast")) {
      addItem("M001-1", 1, extractedTeeth); // 窩洞形成（単純）
    }

    // ============================================================
    // [B-1] 投薬の自動算定
    // SOAPに薬名や「処方」キーワードがあれば、投薬の技術料+薬剤料を自動計算
    // ============================================================
    const prescribedDrugs: {
      drug: DrugItem;
      quantity: number; // 1回あたりの数量
      days: number;     // 処方日数
      dosageForm: string;
    }[] = [];

    // SOAPから処方薬を検出
    const hasPrescription = soapAll.includes("処方") || soapAll.includes("投薬") || soapAll.includes("rp");
    
    if (hasPrescription || drugItems) {
      for (const preset of PRESCRIPTION_KEYWORDS) {
        const matched = preset.keywords.some(kw => soapAll.includes(kw.toLowerCase()));
        if (!matched) continue;

        // マッチした薬をdrug_masterから検索
        for (const drugName of preset.drugNames) {
          const drug = drugByName.get(drugName);
          if (drug) {
            prescribedDrugs.push({
              drug,
              quantity: 1,
              days: drug.default_days,
              dosageForm: drug.dosage_form,
            });

            // NSAIDsの場合、胃薬を自動追加
            if (preset.withStomach) {
              const stomachDrug = drugByName.get(DEFAULT_STOMACH_DRUG);
              if (stomachDrug && !prescribedDrugs.some(pd => pd.drug.name === DEFAULT_STOMACH_DRUG)) {
                prescribedDrugs.push({
                  drug: stomachDrug,
                  quantity: 1,
                  days: stomachDrug.default_days,
                  dosageForm: stomachDrug.dosage_form,
                });
              }
            }
          }
        }
      }
    }

    // 処方薬がある場合、投薬の技術料を追加
    if (prescribedDrugs.length > 0) {
      // 処方料（F100: 院内処方の場合）
      addItem("F100");
      // 調剤料（F200: 院内調剤の場合）
      addItem("F200");

      // 各薬剤の薬剤料を計算してselectedItemsに追加
      // 薬剤料 = 薬価 × 数量 × 日数 を 10 で割って五捨五超入で点数化
      for (const pd of prescribedDrugs) {
        const totalPrice = pd.drug.unit_price * pd.quantity * pd.days;
        // 薬剤料の点数計算: 15円以下の場合は1点、それ以上は10で割って五捨五超入
        const drugPoints = totalPrice <= 15 ? 1 : Math.round(totalPrice / 10);
        
        const drugCode = `DRUG-${pd.drug.yj_code}`;
        if (!addedCodes.has(drugCode)) {
          addedCodes.add(drugCode);
          selectedItems.push({
            code: drugCode,
            name: `【薬剤】${pd.drug.name}`,
            points: drugPoints,
            category: "投薬",
            count: 1,
            note: `${pd.drug.default_dose} ${pd.drug.default_frequency} ${pd.days}日分 (${pd.drug.unit_price}円/${pd.drug.unit})`,
            tooth_numbers: [],
          });
        }
      }
    }

    // ============================================================
    // [B-2] 特定器材（材料）の自動算定
    // 算定された処置コードに基づき、必要な材料を自動追加する
    // ============================================================
    const { data: materialItems } = await supabase
      .from("material_master")
      .select("*")
      .eq("is_active", true);

    if (materialItems && materialItems.length > 0) {
      // 算定済みの処置コードを収集
      const billedFeeCodes = selectedItems.map(item => item.code);
      const addedMaterials = new Set<string>();

      // 処置コードに紐づく材料を検索して追加
      for (const mat of materialItems) {
        if (!mat.related_fee_codes || mat.related_fee_codes.length === 0) continue;

        // この材料に紐づく処置コードが算定されているか
        const hasRelatedProcedure = mat.related_fee_codes.some(
          (fc: string) => billedFeeCodes.includes(fc)
        );
        if (!hasRelatedProcedure) continue;

        // 同じカテゴリの材料が既に追加されていたらスキップ（重複防止）
        const matKey = `${mat.material_category}-${mat.procedure_category}`;
        if (addedMaterials.has(matKey)) continue;
        addedMaterials.add(matKey);

        // 材料費の点数計算: 単価 × 数量 / 10（五捨五超入）
        const matTotalPrice = mat.unit_price * mat.default_quantity;
        const materialPoints = matTotalPrice <= 15 ? (matTotalPrice > 0 ? 1 : 0) : Math.round(matTotalPrice / 10);

        // 金パラ（金属）は薬価基準で変動するため、点数0で注意を促す
        if (mat.unit_price === 0) {
          // 金属材料は時価のため、手動設定が必要
          continue; // 単価0の金属は自動追加しない（手動で設定してもらう）
        }

        const matCode = `MAT-${mat.material_code}`;
        if (!addedCodes.has(matCode)) {
          addedCodes.add(matCode);
          selectedItems.push({
            code: matCode,
            name: `【材料】${mat.name}`,
            points: materialPoints,
            category: "特定器材",
            count: 1,
            note: `${mat.default_quantity}${mat.unit} × ${mat.unit_price}円/${mat.unit}`,
            tooth_numbers: [],
          });
        }
      }
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
    if (prescribedDrugs.length > 0) warnings.push(`💊 投薬 ${prescribedDrugs.length}品目を自動算定しました。処方内容をご確認ください。`);
    if (hasProsthMain) warnings.push("🦷 補綴（冠・ブリッジ）: 印象・咬合・装着・補綴時診断を自動追加しました。工程をご確認ください。");
    if (hasDentureNew) warnings.push("🦷 義歯新製: 精密印象・咬合・装着・補綴時診断を自動追加しました。欠損歯数・上下顎をご確認ください。");
    if (isDenMaintenance) warnings.push("🔧 義歯メンテナンス（調整/修理/リライン）を算定しました。");

    // ============================================================
    // [B-3] コメント自動付与（公式コード準拠）
    // 支払基金「別表Ⅰ（歯科）」に基づき、必須コメントのみ自動生成
    // ※一般的な処置（CR、抜髄、抜歯、FMC等）では部位コメント不要
    //   （SIレコードの歯式コードで部位を表現するため）
    // ============================================================
    const autoComments: { code: string; text: string; kubun: string }[] = [];

    // 再度初診料を算定する場合（前回の歯管算定患者が再初診の場合）
    // → 850100296: 前回治療年月日が必要
    // ※この判定は前回の治療終了日を参照する必要があるため、
    //   現時点では手動入力を想定（将来的に自動化検討）

    // 訪問診療の場合のコメント
    if (soapAll.includes("訪問診療") || soapAll.includes("訪問")) {
      autoComments.push({
        code: "830100348",
        text: "訪問診療訪問先名；",
        kubun: "830",
      });
      autoComments.push({
        code: "830100349",
        text: "訪問診療患者の状態；",
        kubun: "830",
      });
      warnings.push("🏠 訪問診療コメント: 訪問先名と患者の状態の記載が必要です。請求前に編集してください。");
    }

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
      receipt_comments: autoComments.length > 0 ? autoComments : undefined,
      ai_check_warnings: warnings,
      claim_status: "pending",
      payment_status: "unpaid",
    };

    const { data: existingBilling } = await supabase.from("billing").select("id").eq("record_id", recordId).limit(1);
    let billing = null;
    let billErr = null;

    if (existingBilling && existingBilling.length > 0) {
      const updateRes = await supabase.from("billing").update(billingData).eq("record_id", recordId).select().single();
      billing = updateRes.data;
      billErr = updateRes.error;
    } else {
      const insertRes = await supabase.from("billing").insert(billingData).select().single();
      billing = insertRes.data;
      billErr = insertRes.error;
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
      prescribed_drugs: prescribedDrugs.length > 0 ? prescribedDrugs.map(pd => ({
        name: pd.drug.name,
        dose: pd.drug.default_dose,
        frequency: pd.drug.default_frequency,
        days: pd.days,
      })) : undefined,
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "算定エラー", detail: msg }, { status: 500 });
  }
}
