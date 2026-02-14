"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { staff, signOut } = useAuth();
  const [todayStats, setTodayStats] = useState({
    total: 0, waiting: 0, completed: 0, billing_done: 0,
  });

  const today = new Date();
  const formattedDate = today.toLocaleDateString("ja-JP", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  });
  const todayStr = today.toISOString().split("T")[0];

  useEffect(() => {
    fetchStats();
    const channel = supabase.channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => fetchStats())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchStats() {
    const { data } = await supabase
      .from("appointments")
      .select("status")
      .gte("scheduled_at", `${todayStr}T00:00:00`)
      .lte("scheduled_at", `${todayStr}T23:59:59`)
      .neq("status", "cancelled");

    if (data) {
      setTodayStats({
        total: data.length,
        waiting: data.filter((a) => a.status === "checked_in").length,
        completed: data.filter((a) => ["completed", "billing_done"].includes(a.status)).length,
        billing_done: data.filter((a) => a.status === "billing_done").length,
      });
    }
  }

  const menuItems = [
    { href: "/reservation", icon: "📅", iconBg: "bg-blue-50 text-blue-600 group-hover:bg-blue-100", title: "予約管理", desc: "予約の確認・新規受付", ready: true },
    { href: "/consultation", icon: "🩺", iconBg: "bg-orange-50 text-orange-600 group-hover:bg-orange-100", title: "診察カレンダー", desc: "ユニット別・ドクター別タイムテーブル", ready: true },
    { href: "/chart", icon: "📋", iconBg: "bg-red-50 text-red-600 group-hover:bg-red-100", title: "電子カルテ", desc: "SOAP記録・歯式チャート", ready: true },
    { href: "/checkin", icon: "📱", iconBg: "bg-green-50 text-green-600 group-hover:bg-green-100", title: "受付", desc: "チェックイン・受付番号発行", ready: true },
    { href: "/billing", icon: "💰", iconBg: "bg-purple-50 text-purple-600 group-hover:bg-purple-100", title: "会計", desc: "精算・レセプト管理", ready: true },
    { href: "/monitor", icon: "🖥️", iconBg: "bg-teal-50 text-teal-600 group-hover:bg-teal-100", title: "待合モニター", desc: "待合室表示用画面", ready: true },
  ];

  const settingsItems = [
    { href: "/settings", icon: "⚙️", title: "クリニック設定", desc: "基本情報・ユニット・スタッフ・予約枠" },
    { href: "/audit", icon: "🔍", title: "監査ログ", desc: "カルテ・会計の全変更履歴" },
    { href: "/reservation/book", icon: "🌐", title: "患者向け予約ページ", desc: "Web予約画面（URLを患者に共有）" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-sky-600 text-white w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold">🦷</div>
            <h1 className="text-xl font-bold text-gray-900">DENTAL CLINIC OS</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm text-gray-500">{formattedDate}</div>
            {staff && (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: staff.color || "#0ea5e9" }}>{staff.name.charAt(0)}</div>
                <span className="text-sm font-bold text-gray-700">{staff.name}</span>
                <button onClick={() => signOut()} className="text-xs text-gray-400 hover:text-red-500 ml-1">ログアウト</button>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* 本日のサマリー（リアルタイム） */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">本日の予約</p>
            <p className="text-3xl font-bold text-gray-900">{todayStats.total}</p>
            <p className="text-xs text-gray-400 mt-1">件</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">待合中</p>
            <p className="text-3xl font-bold text-sky-600">{todayStats.waiting}</p>
            <p className="text-xs text-gray-400 mt-1">名</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">診察完了</p>
            <p className="text-3xl font-bold text-green-600">{todayStats.completed}</p>
            <p className="text-xs text-gray-400 mt-1">名</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 mb-1">会計済</p>
            <p className="text-3xl font-bold text-purple-600">{todayStats.billing_done}</p>
            <p className="text-xs text-gray-400 mt-1">名</p>
          </div>
        </div>

        {/* 業務メニュー */}
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">業務メニュー</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {menuItems.map((item) => (
            <Link key={item.href} href={item.href} className="block">
              <div className={`bg-white rounded-xl border border-gray-200 p-5 hover:border-sky-400 hover:shadow-md transition-all group ${!item.ready ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors ${item.iconBg}`}>
                    {item.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-gray-900">{item.title}</h3>
                      {!item.ready && <span className="text-[10px] bg-gray-100 text-gray-400 px-1.5 py-0.5 rounded font-bold">準備中</span>}
                    </div>
                    <p className="text-sm text-gray-500">{item.desc}</p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* 設定 */}
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">設定・ツール</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {settingsItems.map((item) => (
            <Link key={item.href} href={item.href} className="block">
              <div className="bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-lg">{item.icon}</span>
                  <div>
                    <h3 className="font-bold text-gray-700 text-sm">{item.title}</h3>
                    <p className="text-xs text-gray-400">{item.desc}</p>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
