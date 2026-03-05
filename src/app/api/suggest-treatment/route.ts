import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await request.json();
    const { diagnosis_code, diagnosis_short, tooth } = body;

    if (!diagnosis_short) {
      return NextResponse.json({ error: "diagnosis_short required" }, { status: 400 });
    }

    // 1. procedure_master から applicable_diagnoses にマッチするものを取得
    const { data: procedures } = await supabase
      .from("procedure_master")
      .select("id, procedure_name, category, subcategory, fee_items, soap_keywords, applicable_diagnoses, is_default, display_order, notes")
      .eq("is_active", true)
      .order("display_order");

    if (!procedures || procedures.length === 0) {
      return NextResponse.json({ treatments: [], message: "No procedures found" });
    }

    // 2. applicable_diagnoses に diagnosis_short が含まれるものをフィルタ
    const matched = procedures.filter(p => {
      if (!p.applicable_diagnoses || p.applicable_diagnoses.length === 0) return false;
      return p.applicable_diagnoses.some((d: string) =>
        d.toLowerCase() === diagnosis_short.toLowerCase()
      );
    });

    // 3. fee_master_v2 で点数を確定
    const allCodes = new Set<string>();
    for (const proc of matched) {
      if (proc.fee_items) {
        for (const item of proc.fee_items as { code: string; name: string; points?: number; count: number }[]) {
          allCodes.add(item.code);
        }
      }
    }

    const feeMap: Record<string, { name: string; points: number }> = {};
    if (allCodes.size > 0) {
      const codeArray = Array.from(allCodes);
      // fee_master_v2 はkubun_code + sub_codeの組合せ or nameで検索
      const { data: fees } = await supabase
        .from("fee_master_v2")
        .select("kubun_code, sub_code, name, name_short, points")
        .in("kubun_code", codeArray);

      if (fees) {
        for (const f of fees) {
          feeMap[f.kubun_code] = { name: f.name_short || f.name, points: f.points || 0 };
        }
      }
    }

    // 4. 結果を整形
    const treatments = matched.map(proc => {
      const feeItems = (proc.fee_items as { code: string; name: string; points?: number; count: number }[] || []).map(item => {
        const feeInfo = feeMap[item.code];
        return {
          code: item.code,
          name: feeInfo?.name || item.name,
          points: feeInfo?.points || item.points || 0,
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
        notes: proc.notes,
      };
    });

    // is_default を先頭に、その後 total_points が高い順
    treatments.sort((a, b) => {
      if (a.is_default && !b.is_default) return -1;
      if (!a.is_default && b.is_default) return 1;
      return b.total_points - a.total_points;
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
