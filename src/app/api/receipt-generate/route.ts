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
  // ============================================================
  // 厚労省 歯科診療行為マスター(R06)基本テーブル照合済み
  // ============================================================
  // 初・再診料 (診療識別: 11=初診, 12=再診)
  "A000": { rc: "301000110", sk: "11" },       // 歯科初診料 267pt
  "A000-2": { rc: "301000210", sk: "11" },     // 地域歯科診療支援病院歯科初診料
  "A000-meisai": { rc: "301000370", sk: "11" },// 乳幼児加算（初診）
  "A002": { rc: "301001610", sk: "12" },       // 歯科再診料 58pt
  "A002-2": { rc: "301001710", sk: "12" },     // 地域歯科診療支援病院歯科再診料
  // 医学管理等 (診療識別: 13)
  "A001-a": { rc: "302000610", sk: "13" },     // 歯科衛生実地指導料１ 80pt
  "B000-4": { rc: "302000110", sk: "13" },     // 歯科疾患管理料 100pt
  "B000-4-doc": { rc: "302008470", sk: "13" }, // 文書提供加算 10pt
  "B001-2": { rc: "302000610", sk: "13" },     // 歯科衛生実地指導料１
  "B002": { rc: "302000710", sk: "13" },       // 歯科特定疾患療養管理料 170pt
  // 画像診断 (診療識別: 31)
  "D001": { rc: "306000110", sk: "31" },       // 調剤料（内服薬）11pt
  "D002-1": { rc: "306000210", sk: "31" },     // 調剤料（外用薬）8pt
  "E100-1": { rc: "305000210", sk: "31" },     // デンタル撮影 20pt
  "E100-pano": { rc: "305000410", sk: "31" },  // パノラマ断層撮影 125pt
  "E100-ct": { rc: "305004910", sk: "31" },    // 歯科用3次元CT 450pt
  // 投薬 (診療識別: 21)
  "F100": { rc: "306000110", sk: "21" },       // 調剤料（内服薬）11pt
  "F200": { rc: "306000710", sk: "21" },       // 処方料 42pt
  "F400": { rc: "306000610", sk: "21" },       // 処方料（7種以上）29pt
  "F500": { rc: "306001810", sk: "21" },       // 調剤技術基本料 14pt
  "F-shoho": { rc: "306000710", sk: "21" },    // 処方料（旧コード互換）42pt
  "F-chozai": { rc: "306000110", sk: "21" },   // 調剤料（旧コード互換）11pt
  // 処置 (診療識別: 41)
  "I000-1": { rc: "309000110", sk: "41" },     // う蝕処置 18pt
  "I000-2": { rc: "309000210", sk: "41" },     // 咬合調整（10歯未満）40pt
  "I000-3": { rc: "309000310", sk: "41" },     // 咬合調整（10歯以上）60pt
  "I005-1": { rc: "309002110", sk: "41" },     // 抜髄（単根管）
  "I005-2": { rc: "309002210", sk: "41" },     // 抜髄（2根管）
  "I005-3": { rc: "309002310", sk: "41" },     // 抜髄（3根管以上）
  "I006-1": { rc: "309002410", sk: "41" },     // 感染根管処置（単根管）
  "I006-2": { rc: "309002510", sk: "41" },     // 感染根管処置（2根管）
  "I006-3": { rc: "309002610", sk: "41" },     // 感染根管処置（3根管以上）
  "I007-1": { rc: "309002710", sk: "41" },     // 根管貼薬（単根管）
  "I007-2": { rc: "309002810", sk: "41" },     // 根管貼薬（2根管）
  "I007-3": { rc: "309002910", sk: "41" },     // 根管貼薬（3根管以上）
  "I008-1": { rc: "309003610", sk: "41" },     // 加圧根充（単根管）
  "I008-2": { rc: "309003710", sk: "41" },     // 加圧根充（2根管）
  "I008-3": { rc: "309003810", sk: "41" },     // 加圧根充（3根管以上）
  "I010": { rc: "309015110", sk: "41" },       // フッ化物歯面塗布 110pt
  "I011-1": { rc: "309004810", sk: "41" },     // スケーリング 72pt
  "I011-2-1": { rc: "309005010", sk: "41" },   // SRP（前歯）60pt
  "I011-2-2": { rc: "309005110", sk: "41" },   // SRP（小臼歯）64pt
  "I011-2-3": { rc: "309005210", sk: "41" },   // SRP（大臼歯）72pt
  "P-SC": { rc: "309004810", sk: "41" },       // スケーリング 72pt
  "P-SRP": { rc: "309005210", sk: "41" },      // SRP（大臼歯）72pt
  "P-SRP-zen": { rc: "309005010", sk: "41" },  // SRP（前歯）60pt
  "P-SRP-sho": { rc: "309005110", sk: "41" },  // SRP（小臼歯）64pt
  "I014": { rc: "309006010", sk: "41" },       // 暫間固定（簡単）200pt
  "I017": { rc: "309018810", sk: "41" },       // 口腔内装置１ 1500pt
  "I020": { rc: "309008310", sk: "41" },       // 粘膜調整処置 110pt
  "I029": { rc: "309014710", sk: "41" },       // 歯周病安定期治療（10歯未満）200pt
  "I030": { rc: "309011410", sk: "41" },       // 機械的歯面清掃処置 72pt
  "I032": { rc: "309011010", sk: "41" },       // 残根削合 18pt
  // 手術 (診療識別: 42=抜歯, 43=その他手術)
  "J000-1": { rc: "310000110", sk: "42" },     // 抜歯（乳歯）130pt
  "J000-2": { rc: "310000210", sk: "42" },     // 抜歯（前歯）160pt
  "J000-3": { rc: "310000310", sk: "42" },     // 抜歯（臼歯）270pt
  "J000-5": { rc: "310000510", sk: "42" },     // 抜歯（埋伏歯）1080pt
  "J000-6": { rc: "310000310", sk: "42" },     // 残根抜歯（臼歯相当）
  "J001": { rc: "310001110", sk: "43" },       // 歯根端切除 1350pt
  "J002": { rc: "310003010", sk: "43" },       // 口腔内消炎手術（智歯周囲炎）120pt
  "J003": { rc: "310003110", sk: "43" },       // 口腔内消炎手術（歯肉膿瘍）180pt
  "J004": { rc: "310001110", sk: "43" },       // 歯根端切除 1350pt
  "J006": { rc: "310003010", sk: "43" },       // 口腔内消炎手術 120pt
  "J063": { rc: "310011610", sk: "43" },       // 歯周外科（ポケット掻爬）80pt
  // 麻酔 (診療識別: 54)
  "K001-1": { rc: "311000210", sk: "54" },     // 浸潤麻酔 30pt
  "K001-2": { rc: "311000110", sk: "54" },     // 伝達麻酔 42pt
  "K002": { rc: "311000110", sk: "54" },       // 伝達麻酔 42pt
  // ============================================================
  // 歯冠修復・欠損補綴 (診療識別: 61-64)
  // 61=修復・補綴１（形成等）  62=修復・補綴２（印象・充填等）
  // 63=修復・補綴３（冠・義歯等）  64=その他（修理等）
  // ※厚労省マスター照合済: 全コード313xxxxxxx
  // ============================================================
  // 補綴時診断 M000
  "M-HOHEKI": { rc: "313027310", sk: "62" },   // 補綴時診断料（新製）90pt
  // 歯冠形成 M001 → sk:61
  "M000-2": { rc: "313000210", sk: "63" },     // クラウン・ブリッジ維持管理料 100pt
  "M001-1": { rc: "313000610", sk: "61" },     // 生活歯歯冠形成（金属冠）306pt
  "M001-2": { rc: "313000910", sk: "61" },     // 失活歯歯冠形成（金属冠）166pt
  "M001-sho": { rc: "313001210", sk: "61" },   // 窩洞形成（単純）60pt
  "M001-fuku": { rc: "313001310", sk: "61" },  // 窩洞形成（複雑）86pt
  "M001-3-1": { rc: "313001210", sk: "61" },   // 窩洞形成（単純）= M001-sho
  "M001-3-2": { rc: "313001310", sk: "61" },   // 窩洞形成（複雑）= M001-fuku
  // 支台築造 M002 → sk:61
  "M002-1": { rc: "313002310", sk: "61" },     // メタルコア（大臼歯）181pt
  "M002-2": { rc: "313002410", sk: "61" },     // メタルコア（小臼歯・前歯）155pt
  "M-POST": { rc: "313002310", sk: "61" },     // メタルコア（大臼歯）
  "M-POST-cast": { rc: "313002410", sk: "61" },// メタルコア（小臼歯・前歯）
  "M-TEK": { rc: "313004510", sk: "61" },      // テンポラリークラウン 34pt
  // 印象採得 M003 → sk:62
  "M003-1": { rc: "313003210", sk: "62" },     // 歯冠修復・単純印象 32pt
  "M003-2": { rc: "313003310", sk: "62" },     // 歯冠修復・連合印象 64pt
  "M003-3": { rc: "313003810", sk: "62" },     // ブリッジ印象（5歯以下）282pt
  "M003-2-1": { rc: "313003410", sk: "62" },   // 欠損補綴・単純（簡単）42pt
  "M003-2-2": { rc: "313003510", sk: "62" },   // 欠損補綴・単純（困難）72pt
  "M003-2-3": { rc: "313003610", sk: "62" },   // 欠損補綴・連合 230pt
  "M-IN-sho": { rc: "313003410", sk: "62" },   // 欠損補綴・単純（簡単）
  "M-IN-fuku": { rc: "313003510", sk: "62" },  // 欠損補綴・単純（困難）
  "M-IMP": { rc: "313003610", sk: "62" },      // 欠損補綴・連合印象 230pt
  "M-IMP-sei": { rc: "313003710", sk: "62" },  // 欠損補綴・特殊印象 272pt
  // 装着 M005 → sk:62
  "M005": { rc: "313024110", sk: "62" },       // 歯冠修復装着 45pt
  "M-SET": { rc: "313024110", sk: "62" },      // 歯冠修復装着 45pt
  "DEN-SET": { rc: "313005310", sk: "62" },    // 義歯装着（少数歯欠損）60pt
  // 咬合採得 M006 → sk:62
  "M-BITE": { rc: "313007810", sk: "62" },     // 歯冠修復・咬合採得 18pt
  // 充填 M009 → sk:62
  "M009-CR": { rc: "313024310", sk: "62" },    // 充填１（単純）106pt
  "M009-CR-fuku": { rc: "313024410", sk: "62" },// 充填１（複雑）158pt
  // 金属歯冠修復 M010 → sk:63
  "M010-1": { rc: "313010410", sk: "63" },     // インレー（単純）192pt
  "M010-2": { rc: "313010510", sk: "63" },     // インレー（複雑）287pt
  "M010-3-": { rc: "313010810", sk: "63" },    // 全部金属冠（FMC）459pt
  // レジン前装金属冠 M011 → sk:63
  "M-CRN-zen": { rc: "313040910", sk: "63" },  // 前装MC前歯（Br支台）1174pt
  "M-CRN-zen-dai": { rc: "313041010", sk: "63" },// 前装MC前歯（その他）1170pt
  "M-CRN-ko": { rc: "313028210", sk: "63" },   // 前装MC小臼歯 1100pt
  "M-CRN-nyu": { rc: "313015210", sk: "63" },  // 乳歯金属冠 200pt
  // CAD/CAM冠 M015-2 → sk:63
  "M-CRN-cad2": { rc: "313025510", sk: "63" }, // CAD/CAM冠 1200pt
  "M-CRN-cad2-dai": { rc: "313041110", sk: "63" },// CAD/CAMエンドクラウン 1450pt
  // ポンティック M017 → sk:63
  "BR-PON": { rc: "313015410", sk: "63" },     // ポンティック 434pt
  // 有床義歯 M018 → sk:63
  "DEN-1-4": { rc: "313016610", sk: "63" },    // 局部義歯（1-4歯）624pt
  "DEN-5-8": { rc: "313016710", sk: "63" },    // 局部義歯（5-8歯）767pt
  "DEN-9-11": { rc: "313016810", sk: "63" },   // 局部義歯（9-11歯）1042pt
  "DEN-12-14": { rc: "313016910", sk: "63" },  // 局部義歯（12-14歯）1502pt
  "DEN-FULL-UP": { rc: "313017010", sk: "63" },// 総義歯 2420pt
  "DEN-FULL-LO": { rc: "313017010", sk: "63" },// 総義歯 2420pt
  // 義歯修理・リライン M029/M030 → sk:64
  "DEN-REP": { rc: "313021610", sk: "64" },    // 義歯修理 260pt
  "DEN-RELINE": { rc: "313021810", sk: "64" }, // リライン（硬質1-4歯）216pt
  // 義歯調整 I022 → sk:41（処置）
  "DEN-ADJ": { rc: "309008310", sk: "41" },    // 粘膜調整処置 110pt
  // 補綴物修理 M034 → sk:64
  "M-ADJ": { rc: "313022610", sk: "64" },      // 歯冠補綴物修理 70pt
  "M-DEBOND": { rc: "313024110", sk: "62" },   // 再装着 = 装着料
  "M-DEBOND2": { rc: "313024110", sk: "62" },  // 再装着
};


// ============================================================
// [A-2] 歯式コード6桁変換テーブル
// 支払基金はSIレコードの歯式を6桁で要求する
// 例: "46" → "004600", "A" (乳歯) → 乳歯コード
// ============================================================
const TOOTH_6DIGIT_MAP: Record<string, string> = {
  // === 永久歯（上顎右: 11-18, 上顎左: 21-28, 下顎左: 31-38, 下顎右: 41-48） ===
  "11": "001100", "12": "001200", "13": "001300", "14": "001400",
  "15": "001500", "16": "001600", "17": "001700", "18": "001800",
  "21": "002100", "22": "002200", "23": "002300", "24": "002400",
  "25": "002500", "26": "002600", "27": "002700", "28": "002800",
  "31": "003100", "32": "003200", "33": "003300", "34": "003400",
  "35": "003500", "36": "003600", "37": "003700", "38": "003800",
  "41": "004100", "42": "004200", "43": "004300", "44": "004400",
  "45": "004500", "46": "004600", "47": "004700", "48": "004800",
  // === 乳歯（上顎右: 51-55, 上顎左: 61-65, 下顎左: 71-75, 下顎右: 81-85） ===
  "51": "005100", "52": "005200", "53": "005300", "54": "005400", "55": "005500",
  "61": "006100", "62": "006200", "63": "006300", "64": "006400", "65": "006500",
  "71": "007100", "72": "007200", "73": "007300", "74": "007400", "75": "007500",
  "81": "008100", "82": "008200", "83": "008300", "84": "008400", "85": "008500",
  // === 乳歯アルファベット表記 → FDI番号への変換 ===
  "A": "005500", "B": "005400", "C": "005300", "D": "005200", "E": "005100",
  "F": "006500", "G": "006400", "H": "006300", "I": "006200", "J": "006100",
  "K": "007100", "L": "007200", "M": "007300", "N": "007400", "O": "007500",
  "P": "008500", "Q": "008400", "R": "008300", "S": "008200", "T": "008100",
};

/**
 * [A-2] 歯番号を6桁コードに変換
 * 入力例: "46", "#46", "11", "A"
 * 出力例: "004600", "001100", "005500"
 */
function toothTo6Digit(tooth: string): string {
  // #プレフィックスを除去
  const cleaned = tooth.replace(/^#/, "").trim();
  // マップから検索
  const mapped = TOOTH_6DIGIT_MAP[cleaned];
  if (mapped) return mapped;
  // 2桁数字でマップにない場合 → 00XX00 形式で生成
  if (/^\d{1,2}$/.test(cleaned)) {
    return cleaned.padStart(4, "0") + "00";
  }
  // すでに6桁の場合はそのまま
  if (/^\d{6}$/.test(cleaned)) return cleaned;
  // 変換不能 → そのまま返す（警告は呼び出し元で出す）
  return cleaned;
}

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

    // [A-4] 傷病名マスタ（公式コード変換用）をDBから取得
    const { data: diagMasterData } = await supabase
      .from("diagnosis_master")
      .select("code, icd_code, name, name_kana");
    const diagMasterByName = new Map(
      (diagMasterData || []).map((d: { name: string; code: string; icd_code: string }) => [d.name, d])
    );
    const diagMasterByCode = new Map(
      (diagMasterData || []).map((d: { code: string; icd_code: string; name: string }) => [d.code, d])
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

    // ============================================================
    // [A-1] 同一患者の月内billing統合
    // 1患者 = 1レセプト にまとめる（これがないと即返戻）
    // 同じ患者の複数回来院分を統合し、点数を合算する
    // ============================================================
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

      // ============================================================
      // [A-1] 患者の月内合計点数を算出（全billing分を合算）
      // ============================================================
      const patientTotalPoints = pBillings.reduce(
        (s: number, b: { total_points: number }) => s + b.total_points, 0
      );
      totalPointsAll += patientTotalPoints;

      // === RE レコード（レセプト共通） ===
      // [A-1] 1患者につき1つのREレコードのみ出力（統合済み）
      lines.push(
        `RE,${receiptNo},${insCode}1${burdenCode}2,${yearMonth},${pat.name_kanji || ""},${sexCode},${dob},${burdenCode * 10},,,,1,,,,,${pat.name_kana || ""},`
      );

      // ============================================================
      // [A-3] 保険者番号の0パディング（8桁に統一）
      // 支払基金は8桁固定。桁数不足だと受付エラーで弾かれる
      // ============================================================
      if (pat.insurer_number) {
        const insurerNum = String(pat.insurer_number).padStart(8, "0");
        const insuredSymbol = pat.insured_symbol ? toFull(String(pat.insured_symbol)) : "";
        const insuredNum = pat.insured_number ? String(pat.insured_number) : "";
        lines.push(
          `HO,${insurerNum},,${insuredSymbol},${insuredNum},${patientTotalPoints},,,,,,,,`
        );
      }

      // === KO レコード（公費） ===
      if (pat.public_expense_type) {
        const publicInsurer = String(pat.public_expense_type).padStart(8, "0");
        const publicRecipient = pat.public_expense_recipient ? String(pat.public_expense_recipient).padStart(7, "0") : "";
        lines.push(
          `KO,${publicInsurer},${publicRecipient},,1,${patientTotalPoints},,,,`
        );
      }

      // ============================================================
      // [A-4] SY レコード（傷病名部位）— 公式マスタコード変換
      // patient_diagnosesのdiagnosis_codeを公式コードに変換する
      // 独自コードのままだと全レセプト返戻リスクあり
      // ============================================================
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

          // [A-4] 傷病名コードの公式マスタ変換
          let diagCode = d.diagnosis_code || "";
          const diagName = d.diagnosis_name || "";

          // まず diagnosis_master で公式コードを検索
          // 1) コードでマスタを検索
          const masterByCode = diagMasterByCode.get(diagCode);
          if (masterByCode && masterByCode.icd_code) {
            // マスタにICD-10コードがあればそれを使用
            diagCode = masterByCode.code;
          }
          // 2) コードで見つからなければ名称でマスタを検索
          if (!masterByCode) {
            const masterByName = diagMasterByName.get(diagName);
            if (masterByName) {
              diagCode = masterByName.code;
            } else {
              // マスタに見つからない場合は警告
              warnings.push(`傷病名マスタ未登録: "${diagName}" (code: ${d.diagnosis_code})`);
            }
          }

          // 歯番号の#除去
          const toothNum = (d.tooth_number || "").replace(/#/g, "");

          lines.push(
            `SY,${diagCode},${diagName},${startYM},${outcomeCode},${endYM},${d.modifier_code || ""},${toothNum}`
          );
        }
      }

      // ============================================================
      // [A-1] SI レコード（歯科診療行為）— 全billing分を統合出力
      // [B-1] DRUG-プレフィックスはIYレコードで別途出力するためスキップ
      // ============================================================
      const drugProcs: { code: string; name: string; points: number; count: number; note: string }[] = [];

      for (const b of pBillings) {
        const procs = (b.procedures_detail || []) as {
          code: string; name: string; points: number; count: number;
          tooth_numbers?: string[]; note?: string;
        }[];

        for (const proc of procs) {
          if (proc.code.startsWith("BONUS-")) continue;

          // [B-1] DRUG-プレフィックスの項目はIYレコード用に別途収集
          if (proc.code.startsWith("DRUG-")) {
            drugProcs.push({
              code: proc.code,
              name: proc.name,
              points: proc.points,
              count: proc.count,
              note: proc.note || "",
            });
            continue;
          }

          // [B-2] MAT-プレフィックスの項目はTOレコードで別途出力するためスキップ
          if (proc.code.startsWith("MAT-")) continue;

          // F-yaku-1は薬剤料のプレースホルダー（0pt）、IYレコードで出力済みのためスキップ
          if (proc.code === "F-yaku-1") continue;

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

          // ============================================================
          // [A-2] 歯式コード6桁変換
          // "46" → "004600" のように支払基金が要求する6桁形式に変換
          // ============================================================
          let teethStr = "";
          if (proc.tooth_numbers && proc.tooth_numbers.length > 0) {
            const converted = proc.tooth_numbers.map((t: string) => {
              const sixDigit = toothTo6Digit(t);
              // 変換結果が6桁数字でない場合は警告
              if (!/^\d{6}$/.test(sixDigit)) {
                warnings.push(`歯式6桁変換失敗: "${t}" → "${sixDigit}"`);
              }
              return sixDigit;
            });
            teethStr = converted.join(" ");
          }

          const futanKubun = pat.public_expense_type ? "1" : "";

          // SI,診療識別,負担区分,診療行為コード(9桁),歯式(6桁),,点数,回数
          lines.push(
            `SI,${shikibetsu},${futanKubun},${receiptCode},${teethStr},,${proc.points},${proc.count}`
          );
        }
      }

      // ============================================================
      // [B-1] IY レコード（医薬品）
      // auto-billingで算定されたDRUG-コードの薬剤をIYレコードとして出力
      // IY,診療識別(21=内服,23=外用,25=頓服),負担区分,医薬品コード,使用量,点数,回数
      // ============================================================
      if (drugProcs.length > 0) {
        // drug_masterからreceipt_codeを取得するためにDBを参照
        const drugYjCodes = drugProcs.map(dp => dp.code.replace("DRUG-", ""));
        const { data: drugMasterData } = await supabase
          .from("drug_master")
          .select("yj_code, receipt_code, dosage_form, name, unit_price, unit")
          .in("yj_code", drugYjCodes);
        const drugMasterMap = new Map(
          (drugMasterData || []).map((d: { yj_code: string; receipt_code: string; dosage_form: string; name: string; unit_price: number; unit: string }) => [d.yj_code, d])
        );

        const futanKubun = pat.public_expense_type ? "1" : "";

        for (const dp of drugProcs) {
          const yjCode = dp.code.replace("DRUG-", "");
          const drugInfo = drugMasterMap.get(yjCode);

          // 診療識別: 内服=21, 頓服=22, 外用=23, 注射=31
          let drugShikibetsu = "21";
          if (drugInfo) {
            if (drugInfo.dosage_form === "頓服") drugShikibetsu = "22";
            else if (drugInfo.dosage_form === "外用") drugShikibetsu = "23";
            else if (drugInfo.dosage_form === "注射") drugShikibetsu = "31";
          }

          // レセプト用医薬品コード（receipt_codeを優先、なければyj_codeを使用）
          const drugReceiptCode = drugInfo?.receipt_code || yjCode;

          // 使用量（noteから日数等を抽出、なければ1）
          const usageStr = "1";

          // IY,診療識別,負担区分,医薬品コード,使用量,点数,回数
          lines.push(
            `IY,${drugShikibetsu},${futanKubun},${drugReceiptCode},${usageStr},${dp.points},${dp.count}`
          );
        }
      }

      // ============================================================
      // [B-2] TO レコード（特定器材）
      // auto-billingで算定されたMAT-コードの材料をTOレコードとして出力
      // TO,診療識別(70=特定器材),負担区分,特定器材コード,使用量,単位コード,単価,点数,回数
      // ============================================================
      const matProcs: { code: string; name: string; points: number; count: number; note: string }[] = [];
      for (const b of pBillings) {
        const procs = (b.procedures_detail || []) as {
          code: string; name: string; points: number; count: number; note?: string;
        }[];
        for (const proc of procs) {
          if (proc.code.startsWith("MAT-")) {
            matProcs.push({
              code: proc.code,
              name: proc.name,
              points: proc.points,
              count: proc.count,
              note: proc.note || "",
            });
          }
        }
      }

      if (matProcs.length > 0) {
        // material_masterからreceipt_codeを取得
        const matCodes = matProcs.map(mp => mp.code.replace("MAT-", ""));
        const { data: matMasterData } = await supabase
          .from("material_master")
          .select("material_code, receipt_code, shinryo_shikibetsu, unit, unit_price, default_quantity")
          .in("material_code", matCodes);
        const matMasterMap = new Map(
          (matMasterData || []).map((m: { material_code: string; receipt_code: string; shinryo_shikibetsu: string; unit: string; unit_price: number; default_quantity: number }) => [m.material_code, m])
        );

        const futanKubun = pat.public_expense_type ? "1" : "";

        for (const mp of matProcs) {
          const matCode = mp.code.replace("MAT-", "");
          const matInfo = matMasterMap.get(matCode);

          const matShikibetsu = matInfo?.shinryo_shikibetsu || "70";
          const matReceiptCode = matInfo?.receipt_code || matCode;
          const matQuantity = matInfo?.default_quantity || 1;
          const matUnitPrice = matInfo?.unit_price || 0;

          // TO,診療識別,負担区分,特定器材コード,使用量,単価,点数,回数
          lines.push(
            `TO,${matShikibetsu},${futanKubun},${matReceiptCode},${matQuantity},${matUnitPrice},${mp.points},${mp.count}`
          );
        }
      }

      // ============================================================
      // [B-3] CO レコード（コメント）- 公式フォーマット準拠
      // 支払基金の記録条件仕様に基づくCOレコード出力
      // CO,区分,コメントコード,文字データ
      // ※歯科では診療識別・負担区分はCOレコードに不要（SIレコードに従属）
      // ============================================================
      for (const b of pBillings) {
        const comments = (b.receipt_comments || []) as {
          code: string; text: string; kubun: string;
        }[];

        if (comments && comments.length > 0) {
          for (const cm of comments) {
            // COレコード: コメントコード + 文字データ
            lines.push(
              `CO,${cm.code},${cm.text}`
            );
          }
        }
      }

      // ============================================================
      // [A-1] JD レコード（受診日等）— 全billing分の受診日を統合
      // 月内の全来院日を1つのJDレコードにまとめる
      // ============================================================
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
      // [A-1] 統合後の合計点数から窓口負担を計算
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
