"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Appointment = {
  id: string;
  scheduled_at: string;
  patient_type: string;
  status: string;
  duration_min: number;
  patients: {
    name_kanji: string;
    name_kana: string;
    phone: string;
    is_new: boolean;
  } | null;
};

export default function ReservationPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split("T")[0];
  });
  const [loading, setLoading] = useState(true);

  // 予約データ取得
  useEffect(() => {
    fetchAppointments();
  }, [selectedDate]);

  async function fetchAppointments() {
    setLoading(true);
    const startOfDay = `${selectedDate}T00:00:00`;
    const endOfDay = `${selectedDate}T23:59:59`;

    const { data, error } = await supabase
      .from("appointments")
      .select(
        `
        id,
        scheduled_at,
        patient_type,
        status,
        duration_min,
        patients (
          name_kanji,
          name_kana,
          phone,
          is_new
        )
      `
      )
      .gte("scheduled_at", startOfDay)
      .lte("scheduled_at", endOfDay)
      .order("scheduled_at", { ascending: true });

    if (!error && data) {
      setAppointments(data as unknown as Appointment[]);
    }
    setLoading(false);
  }

  // ステータスの日本語表示
  function statusLabel(status: string) {
    const labels: Record<string, { text: string; color: string }> = {
      reserved: { text: "予約済", color: "bg-blue-100 text-blue-700" },
      checked_in: { text: "来院済", color: "bg-green-100 text-green-700" },
      in_consultation: { text: "診察中", color: "bg-orange-100 text-orange-700" },
      completed: { text: "完了", color: "bg-gray-100 text-gray-500" },
      cancelled: { text: "キャンセル", color: "bg-red-100 text-red-700" },
    };
    return labels[status] || { text: status, color: "bg-gray-100 text-gray-500" };
  }

  // 時間フォーマット
  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              ← 戻る
            </Link>
            <h1 className="text-xl font-bold text-gray-900">📅 予約管理</h1>
          </div>
          <Link
            href="/reservation/book"
            className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-700 transition-colors"
          >
            ＋ 新規予約
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* 日付選択 */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              setSelectedDate(d.toISOString().split("T")[0]);
            }}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50"
          >
            ◀
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-4 py-2 text-lg font-bold"
          />
          <button
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              setSelectedDate(d.toISOString().split("T")[0]);
            }}
            className="bg-white border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50"
          >
            ▶
          </button>
          <span className="text-sm text-gray-500">
            {appointments.length} 件の予約
          </span>
        </div>

        {/* 予約一覧 */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">読み込み中...</div>
        ) : appointments.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <p className="text-gray-400 text-lg mb-2">予約はありません</p>
            <p className="text-gray-300 text-sm">
              「＋ 新規予約」から予約を追加できます
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {appointments.map((apt) => {
              const status = statusLabel(apt.status);
              return (
                <div
                  key={apt.id}
                  className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      {/* 時間 */}
                      <div className="text-center min-w-[60px]">
                        <p className="text-lg font-bold text-gray-900">
                          {formatTime(apt.scheduled_at)}
                        </p>
                        <p className="text-xs text-gray-400">
                          {apt.duration_min}分
                        </p>
                      </div>

                      {/* 区切り線 */}
                      <div className="w-px h-12 bg-gray-200"></div>

                      {/* 患者情報 */}
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-gray-900">
                            {apt.patients?.name_kanji || "未登録"}
                          </p>
                          {apt.patient_type === "new" && (
                            <span className="bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded font-bold">
                              初診
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-gray-400">
                          {apt.patients?.name_kana || ""}
                          {apt.patients?.phone
                            ? ` / ${apt.patients.phone}`
                            : ""}
                        </p>
                      </div>
                    </div>

                    {/* ステータス */}
                    <span
                      className={`text-xs font-bold px-3 py-1 rounded-full ${status.color}`}
                    >
                      {status.text}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
