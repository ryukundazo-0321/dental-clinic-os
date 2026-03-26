"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type AuditLog = {
  id: string;
  table_name: string;
  record_id: string;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_fields: string[] | null;
  performed_at: string;
  performed_by: string | null;
};

const TABLE_LABELS: Record<string, string> = {
  medical_records: "📋 カルテ",
  receipt_diagnoses: "🏷️ 傷病名",
  billing: "💰 会計",
  patients: "👤 患者",
  appointments: "📅 予約",
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  INSERT: { label: "追加", color: "bg-green-100 text-green-700" },
  UPDATE: { label: "変更", color: "bg-yellow-100 text-yellow-700" },
  DELETE: { label: "削除", color: "bg-red-100 text-red-700" },
};

export default function AuditPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterTable, setFilterTable] = useState("all");
  const [filterAction, setFilterAction] = useState("all");
  const [filterDate, setFilterDate] = useState(new Date().toISOString().split("T")[0]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  useEffect(() => { loadLogs(); }, [filterTable, filterAction, filterDate, page]);

  async function loadLogs() {
    setLoading(true);
    let query = supabase.from("audit_logs")
      .select("*")
      .gte("performed_at", `${filterDate}T00:00:00`)
      .lte("performed_at", `${filterDate}T23:59:59`)
      .order("performed_at", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filterTable !== "all") query = query.eq("table_name", filterTable);
    if (filterAction !== "all") query = query.eq("action", filterAction);

    const { data } = await query;
    if (data) setLogs(data as AuditLog[]);
    setLoading(false);
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function getDescription(log: AuditLog): string {
    const tbl = TABLE_LABELS[log.table_name] || log.table_name;
    const act = ACTION_LABELS[log.action]?.label || log.action;
    if (log.action === "UPDATE" && log.changed_fields && log.changed_fields.length > 0) {
      return `${tbl} ${act}: ${log.changed_fields.join(", ")}`;
    }
    if (log.action === "INSERT" && log.table_name === "receipt_diagnoses" && log.new_data) {
      return `${tbl} ${act}: ${(log.new_data as Record<string, string>).diagnosis_name || ""}`;
    }
    if (log.action === "INSERT" && log.table_name === "patients" && log.new_data) {
      return `${tbl} ${act}: ${(log.new_data as Record<string, string>).name_kanji || ""}`;
    }
    return `${tbl} ${act}`;
  }

  function renderDiff(log: AuditLog) {
    if (log.action === "INSERT") {
      return (
        <div className="bg-green-50 rounded-lg p-3 mt-2">
          <p className="text-xs font-bold text-green-600 mb-1">新規データ:</p>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {JSON.stringify(log.new_data, null, 2)}
          </pre>
        </div>
      );
    }
    if (log.action === "DELETE") {
      return (
        <div className="bg-red-50 rounded-lg p-3 mt-2">
          <p className="text-xs font-bold text-red-600 mb-1">削除されたデータ:</p>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
            {JSON.stringify(log.old_data, null, 2)}
          </pre>
        </div>
      );
    }
    // UPDATE: 変更前後の差分を表示
    if (!log.changed_fields || !log.old_data || !log.new_data) return null;
    return (
      <div className="bg-yellow-50 rounded-lg p-3 mt-2 space-y-2">
        {log.changed_fields.map((field) => (
          <div key={field} className="border-b border-yellow-200 pb-2 last:border-0 last:pb-0">
            <p className="text-xs font-bold text-yellow-700 mb-1">{field}</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-red-50 rounded p-2">
                <p className="text-[10px] text-red-500 mb-0.5">変更前</p>
                <p className="text-xs text-gray-700 whitespace-pre-wrap break-all">
                  {typeof (log.old_data as Record<string, unknown>)[field] === "object"
                    ? JSON.stringify((log.old_data as Record<string, unknown>)[field], null, 1)
                    : String((log.old_data as Record<string, unknown>)[field] ?? "(なし)")}
                </p>
              </div>
              <div className="bg-green-50 rounded p-2">
                <p className="text-[10px] text-green-500 mb-0.5">変更後</p>
                <p className="text-xs text-gray-700 whitespace-pre-wrap break-all">
                  {typeof (log.new_data as Record<string, unknown>)[field] === "object"
                    ? JSON.stringify((log.new_data as Record<string, unknown>)[field], null, 1)
                    : String((log.new_data as Record<string, unknown>)[field] ?? "(なし)")}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← ホーム</Link>
          <h1 className="text-xl font-bold text-gray-900">🔍 監査ログ</h1>
        </div>
        <p className="text-sm text-gray-400">カルテ・会計・患者情報の全変更履歴</p>
      </header>

      <div className="p-6">
        {/* フィルター */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-4 flex flex-wrap gap-4 items-center">
          <div>
            <label className="text-xs text-gray-500 block mb-1">日付</label>
            <input type="date" value={filterDate} onChange={(e) => { setFilterDate(e.target.value); setPage(0); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">テーブル</label>
            <select value={filterTable} onChange={(e) => { setFilterTable(e.target.value); setPage(0); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="all">すべて</option>
              <option value="medical_records">📋 カルテ</option>
              <option value="receipt_diagnoses">🏷️ 傷病名</option>
              <option value="billing">💰 会計</option>
              <option value="patients">👤 患者</option>
              <option value="appointments">📅 予約</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">操作</label>
            <select value={filterAction} onChange={(e) => { setFilterAction(e.target.value); setPage(0); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="all">すべて</option>
              <option value="INSERT">追加</option>
              <option value="UPDATE">変更</option>
              <option value="DELETE">削除</option>
            </select>
          </div>
          <div className="ml-auto">
            <p className="text-xs text-gray-400">{logs.length}件表示</p>
          </div>
        </div>

        {/* ログ一覧 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200">
          {loading ? (
            <div className="p-8 text-center text-gray-400">読み込み中...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-gray-400">該当する操作ログがありません</div>
          ) : (
            <div>
              {logs.map((log) => {
                const actStyle = ACTION_LABELS[log.action] || { label: log.action, color: "bg-gray-100 text-gray-600" };
                const isExpanded = expandedId === log.id;
                return (
                  <div key={log.id}
                    className={`border-b border-gray-100 last:border-0 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors ${isExpanded ? "bg-gray-50" : ""}`}
                    onClick={() => setExpandedId(isExpanded ? null : log.id)}>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-gray-400 font-mono w-20 shrink-0">{formatTime(log.performed_at)}</span>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${actStyle.color}`}>{actStyle.label}</span>
                      <span className="text-sm text-gray-800 flex-1">{getDescription(log)}</span>
                      <span className="text-xs text-gray-300">{isExpanded ? "▲" : "▼"}</span>
                    </div>
                    {isExpanded && renderDiff(log)}
                  </div>
                );
              })}
            </div>
          )}

          {/* ページネーション */}
          {logs.length > 0 && (
            <div className="flex justify-between items-center px-4 py-3 border-t border-gray-100">
              <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0}
                className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-300">← 前ページ</button>
              <span className="text-xs text-gray-400">ページ {page + 1}</span>
              <button onClick={() => setPage(page + 1)} disabled={logs.length < PAGE_SIZE}
                className="text-sm text-blue-600 hover:text-blue-800 disabled:text-gray-300">次ページ →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
