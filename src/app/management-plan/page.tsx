"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Patient = {
  id: string; name_kanji: string; name_kana: string;
  date_of_birth: string; sex?: string; insurance_type: string;
};

type Diagnosis = {
  id: string; diagnosis_name: string; tooth_number: string;
  start_date: string; outcome: string;
};

type MedicalRecord = {
  id: string; soap_s: string | null; soap_o: string | null;
  soap_a: string | null; soap_p: string | null; created_at: string;
};

type PlanData = {
  patientName: string;
  dateOfBirth: string;
  sex: string;
  clinicName: string;
  doctorName: string;
  planDate: string;
  isFirstTime: boolean;
  systemicDiseases: string;
  medications: string;
  smoking: string;
  allergies: string;
  hygiene: string;
  periodontal: string;
  missingTeeth: string;
  oralFunction: string;
  diagnoses: string;
  examResults: string;
  treatmentPlan: string;
  managementSchedule: string;
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const reiwa = y - 2018;
  return `令和${reiwa}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatBirthDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

function ManagementPlanContent() {
  const searchParams = useSearchParams();
  const patientId = searchParams.get("patient_id");
  const printRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<PlanData>({
    patientName: "", dateOfBirth: "", sex: "", clinicName: "", doctorName: "",
    planDate: formatDate(new Date().toISOString()), isFirstTime: true,
    systemicDiseases: "", medications: "", smoking: "なし", allergies: "",
    hygiene: "", periodontal: "", missingTeeth: "", oralFunction: "",
    diagnoses: "", examResults: "", treatmentPlan: "", managementSchedule: "",
  });

  useEffect(() => {
    if (!patientId) { setLoading(false); return; }
    async function loadData() {
      // 患者情報
      const { data: patient } = await supabase
        .from("patients").select("*").eq("id", patientId).single();

      // 傷病名
      const { data: diags } = await supabase
        .from("patient_diagnoses").select("*")
        .eq("patient_id", patientId).eq("outcome", "continuing")
        .order("start_date", { ascending: false });

      // 最新カルテ
      const { data: records } = await supabase
        .from("medical_records").select("id, soap_s, soap_o, soap_a, soap_p, created_at")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false }).limit(3);

      // クリニック情報
      const { data: clinicConfig } = await supabase
        .from("clinic_insurance_config").select("config_value")
        .eq("config_key", "clinic_info").single();

      const p = patient as Patient | null;
      const diagList = (diags || []) as Diagnosis[];
      const recList = (records || []) as MedicalRecord[];
      const clinic = clinicConfig?.config_value as Record<string, string> | null;

      // SOAPからデータを推測
      const latestSOAP = recList[0];
      const soapS = latestSOAP?.soap_s || "";
      const soapO = latestSOAP?.soap_o || "";
      const soapA = latestSOAP?.soap_a || "";
      const soapP = latestSOAP?.soap_p || "";

      setPlan({
        patientName: p?.name_kanji || "",
        dateOfBirth: p ? formatBirthDate(p.date_of_birth) : "",
        sex: p?.sex || "",
        clinicName: clinic?.name || "",
        doctorName: clinic?.director || "",
        planDate: formatDate(new Date().toISOString()),
        isFirstTime: recList.length <= 1,
        systemicDiseases: "",
        medications: "",
        smoking: "なし",
        allergies: "",
        hygiene: "",
        periodontal: soapO || "",
        missingTeeth: "",
        oralFunction: "",
        diagnoses: diagList.map(d => d.diagnosis_name + (d.tooth_number ? `（#${d.tooth_number}）` : "")).join("、") || "",
        examResults: soapO || "",
        treatmentPlan: soapA ? `${soapA}\n${soapP || ""}` : soapP || "",
        managementSchedule: "",
      });
      setLoading(false);
    }
    loadData();
  }, [patientId]);

  function handlePrint() {
    window.print();
  }

  function updateField(field: keyof PlanData, value: string | boolean) {
    setPlan(prev => ({ ...prev, [field]: value }));
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 操作バー（印刷時は非表示） */}
      <div className="print:hidden bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-[210mm] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href={patientId ? `/chart?patient_id=${patientId}` : "/chart"}
              className="text-gray-400 hover:text-gray-600 text-sm">← カルテへ戻る</Link>
            <h1 className="text-sm font-bold text-gray-900">📄 管理計画書</h1>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              <input type="checkbox" checked={plan.isFirstTime}
                onChange={e => updateField("isFirstTime", e.target.checked)}
                className="rounded" />
              初回
            </label>
            <button onClick={handlePrint}
              className="bg-sky-600 text-white px-5 py-2 rounded-lg text-xs font-bold hover:bg-sky-700">
              🖨️ 印刷 / PDF保存
            </button>
          </div>
        </div>
      </div>

      {/* 計画書本体（A4サイズ） */}
      <div className="max-w-[210mm] mx-auto my-6 print:my-0">
        <div ref={printRef} className="bg-white shadow-lg print:shadow-none p-[15mm] text-[9pt] leading-relaxed"
          style={{ minHeight: "297mm", fontFamily: "'Noto Sans JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif" }}>

          {/* タイトル */}
          <h1 className="text-center text-[14pt] font-bold mb-6">
            歯科疾患管理料に係る管理計画書（{plan.isFirstTime ? "初回用" : "継続用"}）
          </h1>

          {/* 基本情報 */}
          <div className="border border-gray-400 p-3 mb-4 text-[8pt]">
            <div className="flex gap-8 mb-2">
              <div className="flex items-center gap-1">
                <span className="font-bold">患者氏名：</span>
                <input value={plan.patientName} onChange={e => updateField("patientName", e.target.value)}
                  className="border-b border-gray-300 px-1 py-0.5 w-32 text-[10pt] print:border-none" />
              </div>
              <div className="flex items-center gap-1">
                <span className="font-bold">生年月日：</span>
                <span className="text-[9pt]">{plan.dateOfBirth}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="font-bold">性別：</span>
                <span>{plan.sex === "1" ? "男" : plan.sex === "2" ? "女" : ""}</span>
              </div>
            </div>
            <div className="flex gap-8 mb-2">
              <div className="flex items-center gap-1">
                <span className="font-bold">医療機関名：</span>
                <input value={plan.clinicName} onChange={e => updateField("clinicName", e.target.value)}
                  className="border-b border-gray-300 px-1 py-0.5 w-40 print:border-none" />
              </div>
              <div className="flex items-center gap-1">
                <span className="font-bold">担当歯科医師：</span>
                <input value={plan.doctorName} onChange={e => updateField("doctorName", e.target.value)}
                  className="border-b border-gray-300 px-1 py-0.5 w-28 print:border-none" />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="font-bold">作成日：</span>
              <span>{plan.planDate}</span>
            </div>
          </div>

          {/* 1. 基本状況 */}
          <div className="border border-gray-400 mb-4">
            <div className="bg-gray-100 px-3 py-1.5 font-bold text-[9pt] border-b border-gray-400">
              １．基本状況（全身の状態・基礎疾患・服薬・生活習慣等）
            </div>
            <div className="p-3 space-y-2">
              <div className="flex items-start gap-1">
                <span className="font-bold w-16 shrink-0">全身疾患：</span>
                <input value={plan.systemicDiseases} onChange={e => updateField("systemicDiseases", e.target.value)}
                  placeholder="なし / 高血圧、糖尿病 等"
                  className="border-b border-gray-200 flex-1 px-1 py-0.5 print:border-none" />
              </div>
              <div className="flex items-start gap-1">
                <span className="font-bold w-16 shrink-0">服薬状況：</span>
                <input value={plan.medications} onChange={e => updateField("medications", e.target.value)}
                  placeholder="なし / 薬剤名 等"
                  className="border-b border-gray-200 flex-1 px-1 py-0.5 print:border-none" />
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1">
                  <span className="font-bold">喫煙：</span>
                  <label className="flex items-center gap-0.5"><input type="radio" name="smoking" checked={plan.smoking === "なし"} onChange={() => updateField("smoking", "なし")} /> なし</label>
                  <label className="flex items-center gap-0.5 ml-2"><input type="radio" name="smoking" checked={plan.smoking === "あり"} onChange={() => updateField("smoking", "あり")} /> あり</label>
                </div>
                <div className="flex items-center gap-1 ml-4">
                  <span className="font-bold">アレルギー：</span>
                  <input value={plan.allergies} onChange={e => updateField("allergies", e.target.value)}
                    placeholder="なし"
                    className="border-b border-gray-200 w-40 px-1 py-0.5 print:border-none" />
                </div>
              </div>
            </div>
          </div>

          {/* 2. 口腔の状態 */}
          <div className="border border-gray-400 mb-4">
            <div className="bg-gray-100 px-3 py-1.5 font-bold text-[9pt] border-b border-gray-400">
              ２．口腔の状態（歯科疾患・口腔衛生状態・口腔機能等）
            </div>
            <div className="p-3 space-y-2">
              <div className="flex items-start gap-1">
                <span className="font-bold w-16 shrink-0">歯科疾患：</span>
                <input value={plan.diagnoses} onChange={e => updateField("diagnoses", e.target.value)}
                  className="border-b border-gray-200 flex-1 px-1 py-0.5 print:border-none" />
              </div>
              <div className="flex items-center gap-1">
                <span className="font-bold">口腔衛生：</span>
                {["良好", "やや不良", "不良"].map(opt => (
                  <label key={opt} className="flex items-center gap-0.5 ml-2">
                    <input type="radio" name="hygiene" checked={plan.hygiene === opt}
                      onChange={() => updateField("hygiene", opt)} />
                    {opt}
                  </label>
                ))}
              </div>
              <div className="flex items-start gap-1">
                <span className="font-bold w-20 shrink-0">歯周の状態：</span>
                <input value={plan.periodontal} onChange={e => updateField("periodontal", e.target.value)}
                  className="border-b border-gray-200 flex-1 px-1 py-0.5 print:border-none" />
              </div>
              <div className="flex items-start gap-1">
                <span className="font-bold w-20 shrink-0">欠損の状態：</span>
                <input value={plan.missingTeeth} onChange={e => updateField("missingTeeth", e.target.value)}
                  placeholder="なし"
                  className="border-b border-gray-200 flex-1 px-1 py-0.5 print:border-none" />
              </div>
              <div className="flex items-start gap-1">
                <span className="font-bold w-16 shrink-0">口腔機能：</span>
                <input value={plan.oralFunction} onChange={e => updateField("oralFunction", e.target.value)}
                  placeholder="問題なし"
                  className="border-b border-gray-200 flex-1 px-1 py-0.5 print:border-none" />
              </div>
            </div>
          </div>

          {/* 3. 検査結果の要点 */}
          <div className="border border-gray-400 mb-4">
            <div className="bg-gray-100 px-3 py-1.5 font-bold text-[9pt] border-b border-gray-400">
              ３．検査結果の要点
            </div>
            <div className="p-3">
              <textarea value={plan.examResults} onChange={e => updateField("examResults", e.target.value)}
                rows={2} placeholder="パノラマX線所見、歯周検査結果 等"
                className="w-full border border-gray-200 rounded px-2 py-1 text-[8pt] resize-none print:border-none print:p-0" />
            </div>
          </div>

          {/* 4. 治療方針の概要 */}
          <div className="border border-gray-400 mb-4">
            <div className="bg-gray-100 px-3 py-1.5 font-bold text-[9pt] border-b border-gray-400">
              ４．治療方針の概要
            </div>
            <div className="p-3">
              <textarea value={plan.treatmentPlan} onChange={e => updateField("treatmentPlan", e.target.value)}
                rows={3} placeholder="治療方針を記載"
                className="w-full border border-gray-200 rounded px-2 py-1 text-[8pt] resize-none print:border-none print:p-0" />
            </div>
          </div>

          {/* 5. 治療と管理の予定 */}
          <div className="border border-gray-400 mb-4">
            <div className="bg-gray-100 px-3 py-1.5 font-bold text-[9pt] border-b border-gray-400">
              ５．治療と管理の予定
            </div>
            <div className="p-3">
              <textarea value={plan.managementSchedule} onChange={e => updateField("managementSchedule", e.target.value)}
                rows={3} placeholder="治療スケジュール・メインテナンス計画"
                className="w-full border border-gray-200 rounded px-2 py-1 text-[8pt] resize-none print:border-none print:p-0" />
            </div>
          </div>

          {/* 注意書き */}
          <p className="text-[7pt] text-gray-500 mb-4 leading-normal">
            この治療と管理の予定は治療開始時の方針であり、実際の治療内容や進み方により、変更することがあります。
            また、ご希望、ご質問がありましたらいつでもお申し出下さい。
          </p>

          {/* 患者同意欄 */}
          <div className="border border-gray-400 p-3">
            <p className="font-bold text-[9pt] mb-3">［患者記入欄］</p>
            <p className="text-[8pt] mb-4">上記の説明を受け、管理計画について同意しました。</p>
            <div className="flex justify-end gap-8 text-[9pt]">
              <span>　　年　　月　　日</span>
              <span>患者氏名：＿＿＿＿＿＿＿＿＿＿＿＿＿</span>
            </div>
          </div>
        </div>
      </div>

      {/* 印刷用スタイル */}
      <style jsx global>{`
        @media print {
          body { margin: 0; padding: 0; }
          .print\\:hidden { display: none !important; }
          .print\\:shadow-none { box-shadow: none !important; }
          .print\\:my-0 { margin-top: 0 !important; margin-bottom: 0 !important; }
          .print\\:border-none { border: none !important; background: transparent !important; }
          .print\\:p-0 { padding: 0 !important; }
          input, textarea { appearance: none; -webkit-appearance: none; }
          @page { size: A4; margin: 0; }
        }
      `}</style>
    </div>
  );
}

export default function ManagementPlanPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>}>
      <ManagementPlanContent />
    </Suspense>
  );
}
