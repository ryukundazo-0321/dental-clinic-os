import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * procedure_masterのfee_itemsのcode を
 * fee_master_v2の { kubun_code, sub_code } に分解する
 *
 * ルール: 最初の"-"の前がkubun_code、後ろがsub_code
 *
 * 例:
 *   "I005-309002110"  → kubun="I005",    sub="309002110"
 *   "B000-302000110"  → kubun="B000",    sub="302000110"
 *   "MADJ-600090010"  → kubun="MADJ",    sub="600090010"
 *   "MDEBOND-600080010" → kubun="MDEBOND", sub="600080010"
 *   "MKEISEI-313001210" → kubun="MKEISEI", sub="313001210"
 *   "B0008-113009010" → kubun="B0008",   sub="113009010"
 *   "I020"            → kubun="I020",    sub=""
 *   "F400"            → kubun="F400",    sub=""
 */
function parseCode(code: string): { kubun: string; sub: string } {
  const firstDash = code.indexOf("-");
  if (firstDash === -1) {
    return { kubun: code, sub: "" };
  }
  return {
    kubun: code.substring(0, firstDash),
    sub: code.substring(firstDash + 1),
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await request.json();
    const { diagnosis_code, diagnosis_short, tooth } = body;

    if (!diagnosis_short) {
      return NextResponse.json({ error: "diagnosis_short required" }, { status: 400 });
    }

    // 1. procedure_masterからapplicable_diagnosesにマッチする処置を取得
    const { data: procedures } = await supabase
      .from("procedure_master")
      .select("id, procedure_name, category, subcategory, fee_items, soap_keywords, applicable_diagnoses, is_default, display_order, notes")
      .eq("is_active", true)
      .order("display_order");

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

    // 3. fee_master_v2から点数とreceipt_codeを取得
    // fee_itemsのcodeをkubun_codeに変換して一括検索
    const allKubunCodes = new Set<string>();
    for (const proc of matched) {
      if (proc.fee_items) {
        for (const item of proc.fee_items as { code: string; name: string; points?: number; count: number }[]) {
          const { kubun } = parseCode(item.code);
          if (kubun) allKubunCodes.add(kubun);
        }
      }
    }

    // fee_master_v2からkubun_codeで一括取得
    // キー: "kubun_code|sub_code" で一意に特定
    const feeMap: Record<string, { name: string; points: number; receipt_code: string }> = {};
    if (allKubunCodes.size > 0) {
      const kubunArray = Array.from(allKubunCodes);
      const { data: fees } = await supabase
        .from("fee_master_v2")
        .select("kubun_code, sub_code, name, name_short, points, receipt_code")
        .in("kubun_code", kubunArray);

      if (fees) {
        for (const f of fees) {
          const key = `${f.kubun_code}|${f.sub_code || ""}`;
          feeMap[key] = {
            name: f.name_short || f.name,
            points: Number(f.points) || 0,
            receipt_code: f.receipt_code || "",
          };
        }
      }
    }

    // 4. 結果を整形
    const treatments = matched.map(proc => {
      const feeItems = (proc.fee_items as { code: string; name: string; points?: number; count: number }[] || []).map(item => {
        const { kubun, sub } = parseCode(item.code);
        const key = `${kubun}|${sub}`;
        const feeInfo = feeMap[key];

        return {
          code: item.code,
          receipt_code: feeInfo?.receipt_code || "",  // UKEファイル用の9桁コード
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
  } catch (e) {
    console.error("suggest-treatment error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
