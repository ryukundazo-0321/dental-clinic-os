import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// ============================================================
// 型定義
// ============================================================
interface FeeItem {
  code: string;
  name: string;
  points?: number;
  count: number;
}

interface MFee {
  sub_code: string;
  name: string;
  points: number;
}

// ============================================================
// fee_itemsのcodeから9桁のsub_codeを抽出する
//
// m_fees.sub_codeが正しい9桁の公式コード。
// fee_itemsのcodeは以下の2パターンが混在している：
//   ① "I011-309004810" → "-"以降が9桁 → "309004810"
//   ② "K001--1", "M-ADJ" → 独自コード → 9桁なし（未対応）
//
// ※ 4-0a-①完了後はfee_itemsが全て9桁に統一されるため
//   この関数はシンプルになる
// ============================================================
function extractSubCode(code: string): string | null {
  // DRUG- / MAT- / BONUS- はスキップ
  if (code.startsWith("DRUG-") || code.startsWith("MAT-") || code.startsWith("BONUS-")) {
    return null;
  }
  // すでに9桁数字ならそのまま使用
  if (/^\d{9}$/.test(code)) return code;

  // "区分コード-9桁数字" 形式なら9桁部分を抽出
  // 例: "I011-309004810" → "309004810"
  // 例: "M003-313003310" → "313003310"
  const dashIdx = code.indexOf("-");
  if (dashIdx !== -1) {
    const maybeSub = code.substring(dashIdx + 1);
    if (/^\d{9}$/.test(maybeSub)) return maybeSub;
  }

  // "--数字" 形式（独自コード）は未対応 → nullを返す
  // 例: "K001--1", "I005--1", "M009--1"
  // → fee_itemsに記載されているpoints/nameをそのまま使う
  return null;
}

// ============================================================
// POST /api/suggest-treatment
// 傷病名から対応する治療パターン一覧を返す
// ============================================================
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await request.json();
    const { diagnosis_code, diagnosis_short, tooth } = body;

    if (!diagnosis_short) {
      return NextResponse.json({ error: "diagnosis_short required" }, { status: 400 });
    }

    // 1. procedure_masterからapplicable_diagnosesにマッチする処置を取得
    const { data: procedures, error: procError } = await supabase
      .from("procedure_master")
      .select("id, procedure_name, category, subcategory, fee_items, soap_keywords, applicable_diagnoses, is_default, display_order, notes")
      .eq("is_active", true)
      .order("display_order");

    if (procError) {
      return NextResponse.json({ error: "procedure_master取得失敗", detail: procError.message }, { status: 500 });
    }

    if (!procedures || procedures.length === 0) {
      return NextResponse.json({ treatments: [], message: "No procedures found" });
    }

    // 2. diagnosis_shortにマッチする処置をフィルタ
    const matched = procedures.filter(p => {
      if (!p.applicable_diagnoses || p.applicable_diagnoses.length === 0) return false;
      return p.applicable_diagnoses.some((d: string) =>
        d.toLowerCase() === diagnosis_short.toLowerCase()
      );
    });

    if (matched.length === 0) {
      return NextResponse.json({
        treatments: [],
        diagnosis: { code: diagnosis_code, short: diagnosis_short, tooth },
        count: 0,
      });
    }

    // 3. fee_itemsから9桁のsub_codeを全部収集してm_feesで一括取得
    const allSubCodes = new Set<string>();
    for (const proc of matched) {
      if (!proc.fee_items) continue;
      for (const item of proc.fee_items as FeeItem[]) {
        const sub = extractSubCode(item.code);
        if (sub) allSubCodes.add(sub);
      }
    }

    // m_feesからsub_codeで一括取得（旧fee_master_v2に替えてm_feesを使用）
    // sub_codeが公式の9桁コードであり、UKEファイルのSSレコードに入れる値
    const feeMap = new Map<string, { name: string; points: number }>();
    if (allSubCodes.size > 0) {
      const { data: fees, error: feeError } = await supabase
        .from("m_fees")
        .select("sub_code, name, points")
        .in("sub_code", Array.from(allSubCodes))
        .eq("is_active", true);

      if (feeError) {
        return NextResponse.json({ error: "m_fees取得失敗", detail: feeError.message }, { status: 500 });
      }

      for (const f of (fees || []) as MFee[]) {
        feeMap.set(f.sub_code, {
          name: f.name,
          points: Number(f.points) || 0,
        });
      }
    }

    // 4. 結果を整形
    const treatments = matched.map(proc => {
      const feeItems = (proc.fee_items as FeeItem[] || []).map(item => {
        const subCode = extractSubCode(item.code);
        const feeInfo = subCode ? feeMap.get(subCode) : null;

        return {
          code: item.code,
          // sub_codeが取得できた場合はそれをUKE用の9桁コードとして使用
          // 取得できない場合（独自コード）は空文字（4-0a-①完了後に解消）
          receipt_code: subCode || "",
          name: feeInfo?.name || item.name,
          points: feeInfo?.points ?? Number(item.points) ?? 0,
          count: item.count || 1,
        };
      });

      const totalPoints = feeItems.reduce((sum, item) => sum + (item.points * item.count), 0);

      return {
        procedure_id: proc.id,
        procedure_name: proc.procedure_name,
        category: proc.category,
        subcategory: proc.subcategory,
        fee_items: feeItems,
        total_points: totalPoints,
        is_default: proc.is_default || false,
        display_order: proc.display_order,
        notes: proc.notes,
      };
    });

    return NextResponse.json({
      treatments,
      diagnosis: { code: diagnosis_code, short: diagnosis_short, tooth },
      count: treatments.length,
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "suggest-treatment エラー", detail: msg }, { status: 500 });
  }
}
