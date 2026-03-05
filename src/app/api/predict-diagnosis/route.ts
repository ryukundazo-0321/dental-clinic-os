import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await request.json();
    const { chief_complaint, pain_types, pain_location, pain_level, symptom_onset } = body;

    if (!chief_complaint && (!pain_types || pain_types.length === 0)) {
      return NextResponse.json({ error: "chief_complaint or pain_types required" }, { status: 400 });
    }

    // 1. symptom_diagnosis_mapping から候補取得
    const { data: mappings } = await supabase
      .from("symptom_diagnosis_mapping")
      .select("*")
      .eq("is_active", true);

    if (!mappings || mappings.length === 0) {
      return NextResponse.json({ predictions: [], message: "No mapping data" });
    }

    // 2. キーワードマッチング
    const scoreMap: Record<string, { code: string; name: string; short: string; probability: number; sources: string[] }> = {};

    const searchTexts: string[] = [];
    if (chief_complaint) searchTexts.push(chief_complaint);
    if (pain_types) searchTexts.push(...pain_types);

    const searchAll = searchTexts.join(" ").toLowerCase();

    for (const mapping of mappings) {
      const keyword = mapping.symptom_keyword.toLowerCase();

      // キーワードがマッチするか
      let matched = false;
      if (searchAll.includes(keyword)) {
        matched = true;
      }
      // 逆方向: マッピングのキーワードが検索テキストに含まれるか
      if (!matched) {
        for (const text of searchTexts) {
          if (keyword.includes(text.toLowerCase()) || text.toLowerCase().includes(keyword)) {
            matched = true;
            break;
          }
        }
      }

      if (!matched) continue;

      // 部位ヒントのマッチ
      let locationBonus = 0;
      if (mapping.body_part_hint && pain_location) {
        const locations = Array.isArray(pain_location) ? pain_location : [pain_location];
        for (const loc of locations) {
          if (mapping.body_part_hint.includes(loc)) {
            locationBonus = 0.1;
            break;
          }
        }
      }

      // 候補を集計
      const candidates = mapping.candidate_diagnoses as { code: string; name: string; short: string; probability: number }[];
      for (const c of candidates) {
        const key = c.code;
        if (!scoreMap[key]) {
          scoreMap[key] = { code: c.code, name: c.name, short: c.short, probability: 0, sources: [] };
        }
        scoreMap[key].probability += c.probability + locationBonus;
        scoreMap[key].sources.push(mapping.symptom_keyword);
      }
    }

    // 3. 重症度による調整
    if (pain_level !== undefined && pain_level !== null) {
      const level = typeof pain_level === "string" ? parseInt(pain_level) : pain_level;
      if (level >= 7) {
        // 急性系を優先
        for (const key of Object.keys(scoreMap)) {
          const s = scoreMap[key];
          if (s.short.includes("Pul") || s.short.includes("Per") || s.short.includes("急")) {
            s.probability *= 1.3;
          }
        }
      } else if (level <= 3) {
        // 慢性系を優先
        for (const key of Object.keys(scoreMap)) {
          const s = scoreMap[key];
          if (s.short === "C2" || s.short === "Hys" || s.short === "P" || s.short === "G") {
            s.probability *= 1.2;
          }
        }
      }
    }

    // 4. 発症時期による調整
    if (symptom_onset) {
      const isAcute = symptom_onset === "today" || symptom_onset === "yesterday" || symptom_onset === "few_days";
      if (isAcute) {
        for (const key of Object.keys(scoreMap)) {
          const s = scoreMap[key];
          if (s.short.includes("Pul") || s.short.includes("急") || s.short.includes("P急発")) {
            s.probability *= 1.2;
          }
        }
      }
    }

    // 5. 部位推定
    let estimatedArea = "";
    if (pain_location) {
      const locations = Array.isArray(pain_location) ? pain_location : [pain_location];
      estimatedArea = locations.join(", ");
    }

    // 6. ソートして上位5件返却
    const predictions = Object.values(scoreMap)
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 5)
      .map(p => ({
        code: p.code,
        name: p.name,
        short: p.short,
        probability: Math.min(Math.round(p.probability * 100) / 100, 0.99),
        sources: p.sources,
      }));

    return NextResponse.json({
      predictions,
      estimated_area: estimatedArea,
      input: { chief_complaint, pain_types, pain_location, pain_level, symptom_onset },
    });
  } catch (e) {
    console.error("predict-diagnosis error:", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
