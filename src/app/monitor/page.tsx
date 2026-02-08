"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getClinicConfig, type ClinicConfig } from "@/lib/reservation-utils";

type QueueEntry = {
  id: string;
  appointment_id: string;
  queue_number: number;
  status: string;
  checked_in_at: string;
  called_at: string | null;
};

export default function MonitorPage() {
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [currentTime, setCurrentTime] = useState(new Date());

  const todayStr = new Date().toISOString().split("T")[0];

  useEffect(() => {
    async function init() {
      const c = await getClinicConfig();
      setConfig(c);
    }
    init();
    fetchQueue();

    // リアルタイム更新
    const channel = supabase.channel("monitor-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "queue" }, () => fetchQueue())
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => fetchQueue())
      .subscribe();

    // 時計更新
    const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(clockInterval);
    };
  }, []);

  async function fetchQueue() {
    const { data } = await supabase
      .from("queue")
      .select("*")
      .gte("checked_in_at", `${todayStr}T00:00:00`)
      .in("status", ["waiting", "in_room"])
      .order("queue_number", { ascending: true });

    if (data) setQueue(data);
  }

  const inRoom = queue.filter((q) => q.status === "in_room");
  const waiting = queue.filter((q) => q.status === "waiting");

  const formattedTime = currentTime.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  const formattedDate = currentTime.toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-900 via-sky-800 to-sky-900 text-white">
      {/* ヘッダー */}
      <header className="px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">🦷 {config?.clinicName || "歯科クリニック"}</h1>
        </div>
        <div className="text-right">
          <p className="text-5xl font-bold font-mono">{formattedTime}</p>
          <p className="text-sky-300 text-lg">{formattedDate}</p>
        </div>
      </header>

      <main className="px-8 pb-8">
        {/* 呼び出し中（大きく表示） */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-sky-300 uppercase tracking-wider mb-4">🩺 診察中 — お入りください</h2>
          {inRoom.length === 0 ? (
            <div className="bg-white/10 rounded-2xl p-8 text-center">
              <p className="text-sky-300 text-xl">現在呼び出し中の方はいません</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {inRoom.map((q) => (
                <div key={q.id} className="bg-orange-500 rounded-2xl p-6 text-center animate-pulse-slow shadow-lg shadow-orange-500/30">
                  <p className="text-sm text-orange-100 mb-1">受付番号</p>
                  <p className="text-7xl font-bold">{q.queue_number}</p>
                  <p className="text-orange-100 text-sm mt-2">診察室へお入りください</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 待合中 */}
        <div>
          <h2 className="text-lg font-bold text-sky-300 uppercase tracking-wider mb-4">⏳ お待ちの方</h2>
          {waiting.length === 0 ? (
            <div className="bg-white/10 rounded-2xl p-8 text-center">
              <p className="text-sky-300 text-xl">現在お待ちの方はいません</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {waiting.map((q, idx) => (
                <div key={q.id} className={`rounded-2xl p-5 text-center ${idx === 0 ? "bg-sky-500/40 border-2 border-sky-400" : "bg-white/10"}`}>
                  <p className="text-xs text-sky-300 mb-1">{idx === 0 ? "次にお呼びします" : "受付番号"}</p>
                  <p className="text-5xl font-bold">{q.queue_number}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 人数表示 */}
        <div className="mt-8 flex justify-center gap-8">
          <div className="bg-white/10 rounded-xl px-6 py-3 text-center">
            <p className="text-sky-300 text-xs">診察中</p>
            <p className="text-3xl font-bold text-orange-400">{inRoom.length}</p>
          </div>
          <div className="bg-white/10 rounded-xl px-6 py-3 text-center">
            <p className="text-sky-300 text-xs">お待ちの方</p>
            <p className="text-3xl font-bold">{waiting.length}</p>
          </div>
        </div>
      </main>

      <style jsx>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.85; }
        }
        .animate-pulse-slow {
          animation: pulse-slow 2s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
