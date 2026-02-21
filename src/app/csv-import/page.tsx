"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type ImportMode = "patients" | "appointments";
type ImportStatus = "idle" | "parsing" | "preview" | "importing" | "done" | "error";

type ParsedRow = Record<string, string>;
type ColumnMapping = Record<string, string>;

// 患者テーブルの必須・任意フィールド
const PATIENT_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: "name_kanji", label: "氏名（漢字）", required: true },
  { key: "name_kana", label: "氏名（カナ）", required: true },
  { key: "date_of_birth", label: "生年月日", required: true },
  { key: "sex", label: "性別", required: false },
  { key: "phone", label: "電話番号", required: false },
  { key: "postal_code", label: "郵便番号", required: false },
  { key: "address", label: "住所", required: false },
  { key: "insurance_type", label: "保険種別", required: false },
  { key: "burden_ratio", label: "負担割合（0.1-1.0）", required: false },
  { key: "insurer_number", label: "保険者番号", required: false },
  { key: "insured_symbol", label: "記号", required: false },
  { key: "insured_number", label: "番号", required: false },
  { key: "patient_number", label: "診察券番号", required: false },
  { key: "notes", label: "備考", required: false },
];

const APPOINTMENT_FIELDS: { key: string; label: string; required: boolean }[] = [
  { key: "patient_name", label: "患者名", required: true },
  { key: "scheduled_date", label: "予約日", required: true },
  { key: "scheduled_time", label: "予約時間", required: true },
  { key: "patient_type", label: "新患/再診", required: false },
  { key: "notes", label: "メモ", required: false },
];

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };

  // BOM除去
  let headerLine = lines[0];
  if (headerLine.charCodeAt(0) === 0xFEFF) headerLine = headerLine.slice(1);

  const headers = headerLine.split(",").map(h => h.replace(/^["']|["']$/g, "").trim());
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"' && !inQuotes) { inQuotes = true; continue; }
      if (ch === '"' && inQuotes) { inQuotes = false; continue; }
      if (ch === "," && !inQuotes) { values.push(current.trim()); current = ""; continue; }
      current += ch;
    }
    values.push(current.trim());

    const row: ParsedRow = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ""; });
    rows.push(row);
  }
  return { headers, rows };
}

function autoMapColumns(csvHeaders: string[], targetFields: { key: string; label: string }[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const patterns: Record<string, string[]> = {
    name_kanji: ["氏名", "名前", "患者名", "漢字", "name", "patient_name", "姓名"],
    name_kana: ["カナ", "かな", "フリガナ", "ふりがな", "kana", "name_kana"],
    date_of_birth: ["生年月日", "誕生日", "dob", "birth", "birthday", "date_of_birth"],
    sex: ["性別", "sex", "gender"],
    phone: ["電話", "tel", "phone", "携帯", "連絡先"],
    postal_code: ["郵便", "〒", "postal", "zip"],
    address: ["住所", "address"],
    insurance_type: ["保険", "insurance", "保険種別"],
    burden_ratio: ["負担", "割合", "burden", "ratio"],
    insurer_number: ["保険者番号", "insurer"],
    insured_symbol: ["記号", "symbol"],
    insured_number: ["番号", "被保険者番号", "insured_number"],
    patient_number: ["診察券", "カルテ", "患者番号", "patient_number", "id", "ID"],
    notes: ["備考", "メモ", "notes", "memo"],
    patient_name: ["患者", "氏名", "名前", "name"],
    scheduled_date: ["予約日", "日付", "date"],
    scheduled_time: ["時間", "時刻", "time"],
    patient_type: ["新患", "種別", "type"],
  };

  for (const field of targetFields) {
    const fieldPatterns = patterns[field.key] || [field.key];
    for (const csvH of csvHeaders) {
      const lower = csvH.toLowerCase();
      if (fieldPatterns.some(p => lower.includes(p.toLowerCase()))) {
        mapping[field.key] = csvH;
        break;
      }
    }
  }
  return mapping;
}

export default function CSVImportPage() {
  const [mode, setMode] = useState<ImportMode>("patients");
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<ParsedRow[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({});
  const [importResult, setImportResult] = useState<{ success: number; errors: string[] }>({ success: 0, errors: [] });
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields = mode === "patients" ? PATIENT_FIELDS : APPOINTMENT_FIELDS;

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setStatus("parsing");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const { headers, rows } = parseCSV(text);
      setCsvHeaders(headers);
      setCsvRows(rows);
      setColumnMapping(autoMapColumns(headers, fields));
      setStatus("preview");
    };
    // Try UTF-8 first, Shift_JIS fallback handled by BOM detection
    reader.readAsText(file, "UTF-8");
    e.target.value = "";
  }

  function updateMapping(fieldKey: string, csvColumn: string) {
    setColumnMapping(prev => ({ ...prev, [fieldKey]: csvColumn }));
  }

  function getMappedValue(row: ParsedRow, fieldKey: string): string {
    const csvCol = columnMapping[fieldKey];
    return csvCol ? (row[csvCol] || "") : "";
  }

  async function executeImport() {
    const requiredFields = fields.filter(f => f.required);
    const missingRequired = requiredFields.filter(f => !columnMapping[f.key]);
    if (missingRequired.length > 0) {
      alert(`必須カラムのマッピングが不足しています: ${missingRequired.map(f => f.label).join(", ")}`);
      return;
    }

    setImporting(true);
    setStatus("importing");
    const errors: string[] = [];
    let success = 0;

    if (mode === "patients") {
      for (let i = 0; i < csvRows.length; i++) {
        const row = csvRows[i];
        const nameKanji = getMappedValue(row, "name_kanji");
        const nameKana = getMappedValue(row, "name_kana");
        const dob = getMappedValue(row, "date_of_birth");

        if (!nameKanji || !dob) {
          errors.push(`行${i + 2}: 氏名または生年月日が空です`);
          continue;
        }

        // 生年月日のパース（YYYY/MM/DD, YYYY-MM-DD, YYYYMMDD対応）
        let parsedDob = dob.replace(/\//g, "-");
        if (/^\d{8}$/.test(parsedDob)) parsedDob = `${parsedDob.slice(0, 4)}-${parsedDob.slice(4, 6)}-${parsedDob.slice(6, 8)}`;

        // 負担割合のパース
        let burdenRatio = 0.3;
        const brStr = getMappedValue(row, "burden_ratio");
        if (brStr) {
          const br = parseFloat(brStr);
          if (br >= 1 && br <= 10) burdenRatio = br / 10; // 3 -> 0.3
          else if (br > 0 && br <= 1) burdenRatio = br; // 0.3
        }

        const patientData: Record<string, unknown> = {
          name_kanji: nameKanji,
          name_kana: nameKana || nameKanji,
          date_of_birth: parsedDob,
          phone: getMappedValue(row, "phone") || "",
          insurance_type: getMappedValue(row, "insurance_type") || "社保",
          burden_ratio: burdenRatio,
          is_new: true,
          patient_status: "active",
        };

        // 任意フィールド
        const optFields = ["sex", "postal_code", "address", "insurer_number", "insured_symbol", "insured_number", "patient_number", "notes"];
        for (const f of optFields) {
          const v = getMappedValue(row, f);
          if (v) patientData[f] = v;
        }

        const { error } = await supabase.from("patients").insert(patientData);
        if (error) {
          errors.push(`行${i + 2} (${nameKanji}): ${error.message}`);
        } else {
          success++;
        }
      }
    } else {
      // 予約インポート
      for (let i = 0; i < csvRows.length; i++) {
        const row = csvRows[i];
        const patientName = getMappedValue(row, "patient_name");
        const date = getMappedValue(row, "scheduled_date").replace(/\//g, "-");
        const time = getMappedValue(row, "scheduled_time");

        if (!patientName || !date) {
          errors.push(`行${i + 2}: 患者名または予約日が空です`);
          continue;
        }

        // 患者名から患者IDを検索
        const { data: pts } = await supabase.from("patients").select("id").ilike("name_kanji", `%${patientName}%`).limit(1);
        if (!pts || pts.length === 0) {
          errors.push(`行${i + 2} (${patientName}): 患者が見つかりません`);
          continue;
        }

        const scheduledAt = time ? `${date}T${time.padStart(5, "0")}:00+09:00` : `${date}T09:00:00+09:00`;
        const patientType = getMappedValue(row, "patient_type");
        const isNew = patientType?.includes("新") || patientType?.toLowerCase() === "new";

        const { error } = await supabase.from("appointments").insert({
          patient_id: pts[0].id,
          scheduled_at: scheduledAt,
          patient_type: isNew ? "new" : "returning",
          status: "scheduled",
          notes: getMappedValue(row, "notes") || "",
        });

        if (error) {
          errors.push(`行${i + 2} (${patientName}): ${error.message}`);
        } else {
          // 予約にはmedical_recordも必要
          const { data: apt } = await supabase.from("appointments").select("id").eq("patient_id", pts[0].id).eq("scheduled_at", scheduledAt).limit(1).single();
          if (apt) {
            await supabase.from("medical_records").insert({
              appointment_id: apt.id,
              patient_id: pts[0].id,
              status: "draft",
            });
          }
          success++;
        }
      }
    }

    setImportResult({ success, errors });
    setStatus("done");
    setImporting(false);
  }

  function reset() {
    setStatus("idle");
    setCsvHeaders([]);
    setCsvRows([]);
    setColumnMapping({});
    setImportResult({ success: 0, errors: [] });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/settings" className="text-gray-400 hover:text-gray-600 text-sm font-bold">← 設定</Link>
            <h1 className="text-lg font-bold text-gray-900">📥 CSVインポート</h1>
          </div>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => { setMode("patients"); reset(); }} className={`px-4 py-2 rounded-md text-xs font-bold ${mode === "patients" ? "bg-white text-gray-800 shadow-sm" : "text-gray-400"}`}>👤 患者データ</button>
            <button onClick={() => { setMode("appointments"); reset(); }} className={`px-4 py-2 rounded-md text-xs font-bold ${mode === "appointments" ? "bg-white text-gray-800 shadow-sm" : "text-gray-400"}`}>📅 予約データ</button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {/* STEP 1: ファイル選択 */}
        {status === "idle" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <p className="text-5xl mb-4">{mode === "patients" ? "👤" : "📅"}</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              {mode === "patients" ? "患者データをCSVからインポート" : "予約データをCSVからインポート"}
            </h2>
            <p className="text-sm text-gray-400 mb-6">CSV（UTF-8またはShift_JIS対応）を選択してください。1行目はヘッダー行です。</p>

            <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" onChange={handleFileSelect} className="hidden" />
            <button onClick={() => fileRef.current?.click()} className="bg-sky-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-sky-700 shadow-lg shadow-sky-200">
              📄 CSVファイルを選択
            </button>

            <div className="mt-8 bg-gray-50 rounded-xl p-5 text-left">
              <h3 className="text-sm font-bold text-gray-700 mb-3">📋 {mode === "patients" ? "患者CSV" : "予約CSV"} フォーマット</h3>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                {fields.map(f => (
                  <div key={f.key} className="flex items-center gap-2 text-xs py-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${f.required ? "bg-red-500" : "bg-gray-300"}`} />
                    <span className="text-gray-700 font-bold">{f.label}</span>
                    {f.required && <span className="text-red-400 text-[10px]">必須</span>}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-3">※ カラム名が類似していれば自動マッピングされます。手動で修正も可能です。</p>
            </div>
          </div>
        )}

        {/* STEP 2: プレビュー・マッピング */}
        {status === "preview" && (
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-bold text-gray-900">📊 CSVプレビュー</h2>
                  <p className="text-xs text-gray-400">{csvRows.length}行 × {csvHeaders.length}列</p>
                </div>
                <button onClick={reset} className="text-xs text-gray-400 hover:text-red-500 font-bold">✕ やり直し</button>
              </div>

              {/* カラムマッピング */}
              <div className="mb-5 bg-sky-50 rounded-xl p-4 border border-sky-200">
                <h3 className="text-xs font-bold text-sky-700 mb-3">🔗 カラムマッピング（CSVのカラム → システムのフィールド）</h3>
                <div className="grid grid-cols-2 gap-3">
                  {fields.map(f => (
                    <div key={f.key} className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${f.required ? "text-red-600" : "text-gray-500"} w-32 text-right`}>
                        {f.label}{f.required ? " *" : ""}
                      </span>
                      <span className="text-gray-300">→</span>
                      <select value={columnMapping[f.key] || ""} onChange={e => updateMapping(f.key, e.target.value)}
                        className={`flex-1 border rounded-lg px-2 py-1.5 text-xs ${columnMapping[f.key] ? "border-sky-300 bg-white" : f.required ? "border-red-300 bg-red-50" : "border-gray-200 bg-white"}`}>
                        <option value="">（未マッピング）</option>
                        {csvHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
              </div>

              {/* データプレビュー */}
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="text-xs w-full">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-2 py-1 text-left text-gray-400 font-bold border-b">#</th>
                      {fields.filter(f => columnMapping[f.key]).map(f => (
                        <th key={f.key} className="px-2 py-1 text-left text-gray-700 font-bold border-b">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {csvRows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-2 py-1 text-gray-300 border-b">{i + 1}</td>
                        {fields.filter(f => columnMapping[f.key]).map(f => (
                          <td key={f.key} className="px-2 py-1 text-gray-700 border-b">{getMappedValue(row, f.key) || <span className="text-gray-300">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {csvRows.length > 10 && <p className="text-xs text-gray-400 text-center py-2">... 他 {csvRows.length - 10} 行</p>}
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={reset} className="flex-1 bg-gray-100 text-gray-600 py-4 rounded-xl font-bold text-sm hover:bg-gray-200">← やり直し</button>
              <button onClick={executeImport} disabled={importing}
                className="flex-1 bg-green-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-50 shadow-lg shadow-green-200">
                {importing ? "⏳ インポート中..." : `✅ ${csvRows.length}件をインポート`}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: インポート中 */}
        {status === "importing" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <p className="text-5xl mb-4 animate-bounce">⏳</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">インポート中...</h2>
            <p className="text-sm text-gray-400">{csvRows.length}件を処理しています。しばらくお待ちください。</p>
          </div>
        )}

        {/* STEP 4: 完了 */}
        {status === "done" && (
          <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
            <p className="text-5xl mb-4">{importResult.errors.length === 0 ? "✅" : "⚠️"}</p>
            <h2 className="text-xl font-bold text-gray-900 mb-2">インポート完了</h2>
            <div className="flex justify-center gap-8 mb-6">
              <div><p className="text-3xl font-bold text-green-600">{importResult.success}</p><p className="text-xs text-gray-400">成功</p></div>
              <div><p className="text-3xl font-bold text-red-600">{importResult.errors.length}</p><p className="text-xs text-gray-400">エラー</p></div>
            </div>
            {importResult.errors.length > 0 && (
              <div className="bg-red-50 rounded-xl p-4 text-left mb-6 max-h-48 overflow-y-auto">
                <p className="text-xs font-bold text-red-600 mb-2">エラー一覧:</p>
                {importResult.errors.map((err, i) => <p key={i} className="text-xs text-red-500 py-0.5">• {err}</p>)}
              </div>
            )}
            <div className="flex gap-3 justify-center">
              <button onClick={reset} className="bg-sky-600 text-white px-8 py-3 rounded-xl font-bold text-sm hover:bg-sky-700">📥 別のCSVをインポート</button>
              <Link href={mode === "patients" ? "/patients" : "/reservation"} className="bg-gray-100 text-gray-600 px-8 py-3 rounded-xl font-bold text-sm hover:bg-gray-200">
                {mode === "patients" ? "👤 患者一覧を確認" : "📅 予約一覧を確認"}
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
