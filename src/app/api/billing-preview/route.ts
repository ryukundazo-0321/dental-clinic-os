import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// 型定義
interface ProcedureMaster {
  id: string;
  procedure_name: string;
  category: string;
  subcategory: string;
  fee_items: { code: string; name: string; points: number; count?: number }[];
  soap_keywords: string[];
  conditions: Record<string, unknown>;
  is_active: boolean;
}

interface FeeV2 {
  kubun_code: string;
  sub_code: string;
  name: string;
  name_short: string;
  points: number;
  category: string;
}

interface PreviewItem {
  code: string;
  name: string;
  points: number;
  count: number;
  category: string;
  source: string; // どの治療パターンからマッチしたか
  tooth_numbers: string[];
}

interface FacilityBonus {
  facility_code: string;
  target_kubun: string;
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

    // ============================================================
    // 1. カルテ取得
    // ============================================================
    const { data: record, error: recErr } = await supabase
      .from("medical_records")
      .select("id, patient_id, appointment_id, soap_s, soap_o, soap_a, soap_p, tooth_surfaces")
      .eq("id", recordId)
      .single();

    if (recErr || !record) {
      return NextResponse.json({ error: "カルテが見つかりません", detail: recErr?.message }, { status: 404 });
    }

    // ============================================================
    // 2. 初診/再診判定
    // ============================================================
    let isNew = true;
    if (record.appointment_id) {
      const { data: apt } = await supabase
        .from("appointments")
        .select("patient_type, scheduled_at")
        .eq("id", record.appointment_id)
        .single();

      if (apt) {
        if (apt.patient_type === "new") {
          isNew = true;
        } else {
          const { data: prevApts } = await supabase
            .from("appointments")
            .select("scheduled_at")
            .eq("patient_id", record.patient_id)
            .eq("status", "completed")
            .lt("scheduled_at", apt.scheduled_at)
            .order("scheduled_at", { ascending: false })
            .limit(1);

          if (prevApts && prevApts.length > 0) {
            const lastVisit = new Date(prevApts[0].scheduled_at);
            const thisVisit = new Date(apt.scheduled_at);
            const daysDiff = Math.floor((thisVisit.getTime() - lastVisit.getTime()) / (1000 * 60 * 60 * 24));
            isNew = daysDiff >= 90;
          } else {
            isNew = true;
          }
        }
      }
    }

    // ============================================================
    // 3. 患者情報（負担割合）
    // ============================================================
    let burdenRatio = 0.3;
    if (record.patient_id) {
      const { data: pat } = await supabase
        .from("patients")
        .select("burden_ratio")
        .eq("id", record.patient_id)
        .single();
      if (pat?.burden_ratio) burdenRatio = pat.burden_ratio;
    }

    // ============================================================
    // 4. fee_master_v2 取得 → Map構築
    // ============================================================
    const { data: feeItems } = await supabase.from("fee_master_v2").select("*").limit(10000);
    const feeMap = new Map<string, FeeV2>();
    if (feeItems) {
      for (const f of feeItems as FeeV2[]) {
        const code = f.sub_code ? `${f.kubun_code}-${f.sub_code}` : f.kubun_code;
        feeMap.set(code, f);
      }
    }

    // ============================================================
    // 5. procedure_master 取得（有効なもののみ）
    // ============================================================
    const { data: procedures } = await supabase
      .from("procedure_master")
      .select("*")
      .eq("is_active", true)
      .order("display_order");

    // ============================================================
    // 6. 文字起こしテキスト取得（SOAP + 生テキスト）
    // ============================================================
    let transcriptText = "";
    if (record.appointment_id) {
      const { data: chunks } = await supabase
        .from("karte_transcript_chunks")
        .select("corrected_text")
        .eq("appointment_id", record.appointment_id)
        .order("chunk_index");
      if (chunks && chunks.length > 0) {
        transcriptText = chunks.map((c: { corrected_text: string }) => c.corrected_text || "").join(" ");
      }
    }

    // P欄は「本日」分のみ（次回予定を除外）
    const soapPToday = record.soap_p ? record.soap_p.split("【次回】")[0].replace("【本日】", "") : "";
    const soapAll = [record.soap_s, record.soap_o, record.soap_a, soapPToday, transcriptText]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    // 歯番抽出
    const soapRaw = [record.soap_s, record.soap_o, record.soap_a, soapPToday, transcriptText].filter(Boolean).join(" ");
    const toothPattern = /[#＃]?\s*([1-4][1-8]|[5-8][1-5])\s*(?:番)?/g;
    const extractedTeeth: string[] = [];
    let toothMatch;
    while ((toothMatch = toothPattern.exec(soapRaw)) !== null) {
      const num = toothMatch[1];
      if (!extractedTeeth.includes(num)) extractedTeeth.push(num);
    }

    // ============================================================
    // 7. procedure_master でキーワードマッチ
    // ============================================================
    const matchedProcedures: { proc: ProcedureMaster; score: number }[] = [];

    if (procedures) {
      for (const proc of procedures as ProcedureMaster[]) {
        if (!proc.soap_keywords || proc.soap_keywords.length === 0) continue;

        // キーワードマッチスコア: マッチしたキーワード数
        let score = 0;
        for (const kw of proc.soap_keywords) {
          if (soapAll.includes(kw.toLowerCase())) {
            score += 1;
          }
        }

        if (score === 0) continue;

        // 初診/再診の振り分け
        if (proc.category === "basic") {
          const isShoshinProc = proc.subcategory === "初診";
          const isSaishinProc = proc.subcategory === "再診";
          if (isShoshinProc && !isNew) continue;
          if (isSaishinProc && isNew) continue;
        }

        matchedProcedures.push({ proc, score });
      }
    }

    // スコア順にソート（高い方が優先）
    matchedProcedures.sort((a, b) => b.score - a.score);

    // ============================================================
    // 8. マッチ結果から算定項目を構築
    // ============================================================
    const previewItems: PreviewItem[] = [];
    const addedCodes = new Set<string>();
    const matchedNames: string[] = [];

    // 同じカテゴリで最もスコアの高いものだけ採用（重複防止）
    const usedCategories = new Map<string, string>(); // subcategory → procedure_name

    for (const { proc } of matchedProcedures) {
      // basicは1つだけ（初診 or 再診）
      if (proc.category === "basic" && usedCategories.has("basic")) continue;

      // 同じsubcategoryの重複防止（例: CR充填(単純)とCR充填(複雑)の両方マッチ防止）
      const subKey = `${proc.category}:${proc.subcategory}`;
      if (usedCategories.has(subKey) && proc.category !== "basic") continue;

      usedCategories.set(subKey, proc.procedure_name);
      if (proc.category === "basic") usedCategories.set("basic", proc.procedure_name);
      matchedNames.push(proc.procedure_name);

      // fee_itemsを算定項目に追加
      if (proc.fee_items) {
        for (const item of proc.fee_items) {
          if (addedCodes.has(item.code)) continue;
          addedCodes.add(item.code);

          const fee = feeMap.get(item.code);
          const points = fee ? fee.points : item.points;
          const name = fee ? (fee.name_short || fee.name) : item.name;

          previewItems.push({
            code: item.code,
            name,
            points,
            count: item.count || 1,
            category: proc.category,
            source: proc.procedure_name,
            tooth_numbers: proc.category !== "basic" ? extractedTeeth : [],
          });
        }
      }
    }

    // ============================================================
    // 9. 基本診療料が未追加なら追加（安全策）
    // ============================================================
    const hasBasic = previewItems.some(i => i.code.startsWith("A000") || i.code.startsWith("A002"));
    if (!hasBasic) {
      if (isNew) {
        const fee = feeMap.get("A000-1");
        if (fee) {
          previewItems.unshift({
            code: "A000-1", name: fee.name_short || fee.name, points: fee.points,
            count: 1, category: "basic", source: "自動追加（初診）", tooth_numbers: [],
          });
        }
      } else {
        const fee = feeMap.get("A002-1");
        if (fee) {
          previewItems.unshift({
            code: "A002-1", name: fee.name_short || fee.name, points: fee.points,
            count: 1, category: "basic", source: "自動追加（再診）", tooth_numbers: [],
          });
        }
      }
    }

    // ============================================================
    // 10. SC全顎ブロック計算
    // ============================================================
    const scItem = previewItems.find(i => i.code === "I011-1");
    if (scItem) {
      let scBlocks = 1;
      if (soapAll.includes("全顎") || soapAll.includes("フルマウス") ||
          (soapAll.includes("上下") && (soapAll.includes("sc") || soapAll.includes("スケーリング")))) {
        scBlocks = 6;
      } else if (soapAll.includes("上顎") || soapAll.includes("下顎") || soapAll.includes("片顎")) {
        scBlocks = 3;
      } else {
        const blockMatch = soapAll.match(/([1-6])\s*ブロック/);
        if (blockMatch) scBlocks = parseInt(blockMatch[1]);
      }
      scItem.count = scBlocks;
    }

    // ============================================================
    // 11. 施設基準加算
    // ============================================================
    try {
      const { data: facilityBonuses } = await supabase
        .from("facility_bonus")
        .select("*, facility_standards!inner(is_registered)")
        .eq("is_active", true)
        .eq("facility_standards.is_registered", true);

      if (facilityBonuses) {
        const existingCodes = previewItems.map(i => i.code);
        for (const bonus of facilityBonuses as FacilityBonus[]) {
          if (bonus.bonus_type !== "add" || bonus.bonus_points <= 0) continue;
          const hasTarget = existingCodes.some(c => c.startsWith(bonus.target_kubun));
          if (hasTarget) {
            previewItems.push({
              code: `BONUS-${bonus.facility_code}-${bonus.target_kubun}`,
              name: `施設基準加算（${bonus.condition}）`,
              points: bonus.bonus_points,
              count: 1,
              category: "加算",
              source: "施設基準",
              tooth_numbers: [],
            });
          }
        }
      }
    } catch { /* facility_bonusが無い場合はスキップ */ }

    // ============================================================
    // 12. 合計計算
    // ============================================================
    const totalPoints = previewItems.reduce((sum, item) => sum + item.points * item.count, 0);
    const patientBurden = Math.ceil(totalPoints * 10 * burdenRatio);

    // ============================================================
    // 13. 警告・確認事項
    // ============================================================
    const warnings: string[] = [];
    if (isNew) warnings.push("📄 初診です。管理計画書の印刷・文書提供が必要です。");
    if (previewItems.length <= 2) warnings.push("⚠️ 算定項目が少ない可能性があります。SOAPの内容を確認してください。");
    if (matchedProcedures.length === 0) warnings.push("⚠️ SOAPから処置パターンを検出できませんでした。手動で項目を追加してください。");

    return NextResponse.json({
      success: true,
      is_new: isNew,
      matched_procedures: matchedNames,
      items: previewItems,
      total_points: totalPoints,
      patient_burden: patientBurden,
      burden_ratio: burdenRatio,
      extracted_teeth: extractedTeeth,
      warnings,
    });

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: "プレビューエラー", detail: msg }, { status: 500 });
  }
}
