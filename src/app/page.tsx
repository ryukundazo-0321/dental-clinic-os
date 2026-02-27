"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

type BillingRow = { total_points: number; patient_burden: number; created_at: string };
type AlertItem = { type: string; label: string; count: number; href: string; color: string; icon: string };

export default function Home() {
  const { staff, signOut } = useAuth();
  const [todayStats, setTodayStats] = useState({ total: 0, waiting: 0, inConsult: 0, completed: 0, billing_done: 0 });
  const [todayRevenue, setTodayRevenue] = useState({ points: 0, burden: 0 });
  const [monthlyData, setMonthlyData] = useState<{ day: number; points: number; burden: number }[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [monthTotal, setMonthTotal] = useState({ points: 0, burden: 0, count: 0 });

  function getTodayJST(): string {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().split("T")[0];
  }

  const todayStr = getTodayJST();
  const today = new Date(todayStr + "T12:00:00");
  const formattedDate = today.toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  const monthStart = `${todayStr.substring(0, 7)}-01`;

  useEffect(() => {
    fetchAll();
    const channel = supabase.channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => fetchAll())
      .on("postgres_changes", { event: "*", schema: "public", table: "billing" }, () => fetchAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchAll() {
    await Promise.all([fetchStats(), fetchTodayRevenue(), fetchMonthlyRevenue(), fetchAlerts()]);
  }

  async function fetchStats() {
    const { data } = await supabase.from("appointments").select("status")
      .gte("scheduled_at", `${todayStr}T00:00:00+00`).lte("scheduled_at", `${todayStr}T23:59:59+00`).neq("status", "cancelled");
    if (data) {
      setTodayStats({
        total: data.length,
        waiting: data.filter(a => a.status === "checked_in").length,
        inConsult: data.filter(a => a.status === "in_consultation").length,
        completed: data.filter(a => a.status === "completed").length,
        billing_done: data.filter(a => a.status === "billing_done").length,
      });
    }
  }

  async function fetchTodayRevenue() {
    const { data } = await supabase.from("billing").select("total_points, patient_burden, created_at")
      .gte("created_at", `${todayStr}T00:00:00+00`).lte("created_at", `${todayStr}T23:59:59+00`);
    if (data) {
      const points = data.reduce((s: number, r: BillingRow) => s + (r.total_points || 0), 0);
      const burden = data.reduce((s: number, r: BillingRow) => s + (r.patient_burden || 0), 0);
      setTodayRevenue({ points, burden });
    }
  }

  async function fetchMonthlyRevenue() {
    const { data } = await supabase.from("billing").select("total_points, patient_burden, created_at")
      .gte("created_at", `${monthStart}T00:00:00+00`).lte("created_at", `${todayStr}T23:59:59+00`);
    if (data) {
      const byDay = new Map<number, { points: number; burden: number }>();
      let totalPts = 0, totalBurden = 0;
      data.forEach((r: BillingRow) => {
        const match = r.created_at.match(/\d{4}-\d{2}-(\d{2})/);
        const day = match ? parseInt(match[1]) : 1;
        const existing = byDay.get(day) || { points: 0, burden: 0 };
        existing.points += r.total_points || 0;
        existing.burden += r.patient_burden || 0;
        byDay.set(day, existing);
        totalPts += r.total_points || 0;
        totalBurden += r.patient_burden || 0;
      });
      const result: { day: number; points: number; burden: number }[] = [];
      const todayDay = parseInt(todayStr.split("-")[2]);
      for (let d = 1; d <= todayDay; d++) {
        const v = byDay.get(d) || { points: 0, burden: 0 };
        result.push({ day: d, points: v.points, burden: v.burden });
      }
      setMonthlyData(result);
      setMonthTotal({ points: totalPts, burden: totalBurden, count: data.length });
    }
  }

  async function fetchAlerts() {
    const items: AlertItem[] = [];
    // 未会計
    const { data: unpaid } = await supabase.from("billing").select("id").eq("payment_status", "unpaid");
    if (unpaid && unpaid.length > 0) items.push({ type: "unpaid", label: "未会計", count: unpaid.length, href: "/billing", color: "text-red-600 bg-red-50", icon: "💰" });
    // 未確定カルテ
    const { data: unconfirmed } = await supabase.from("medical_records").select("id").eq("doctor_confirmed", false).neq("status", "confirmed");
    if (unconfirmed && unconfirmed.length > 0) items.push({ type: "unconfirmed", label: "未確定カルテ", count: unconfirmed.length, href: "/chart?tab=unconfirmed", color: "text-orange-600 bg-orange-50", icon: "📋" });
    // 来院済（診察待ち）
    const { data: waitingApt } = await supabase.from("appointments").select("id").eq("status", "checked_in")
      .gte("scheduled_at", `${todayStr}T00:00:00+00`).lte("scheduled_at", `${todayStr}T23:59:59+00`);
    if (waitingApt && waitingApt.length > 0) items.push({ type: "waiting", label: "診察待ち", count: waitingApt.length, href: "/consultation", color: "text-green-600 bg-green-50", icon: "🩺" });
    setAlerts(items);
  }

  // グラフの最大値
  const maxPoints = Math.max(...monthlyData.map(d => d.points), 1);

  const menuItems = [
    { href: "/reservation", icon: "📅", iconBg: "bg-blue-50 text-blue-600 group-hover:bg-blue-100", title: "予約管理", desc: "予約の確認・新規受付", ready: true },
    { href: "/consultation", icon: "🩺", iconBg: "bg-orange-50 text-orange-600 group-hover:bg-orange-100", title: "診察カレンダー", desc: "タイムテーブル・アポ帳", ready: true },
    { href: "/reception-dashboard", icon: "🏥", iconBg: "bg-rose-50 text-rose-600 group-hover:bg-rose-100", title: "受付ダッシュボード", desc: "チェア別・本日の患者一覧", ready: true },
    { href: "/patients", icon: "👤", iconBg: "bg-sky-50 text-sky-600 group-hover:bg-sky-100", title: "患者管理", desc: "患者一覧・検索・歯式・カルテ", ready: true },
    { href: "/checkin", icon: "📱", iconBg: "bg-green-50 text-green-600 group-hover:bg-green-100", title: "受付", desc: "チェックイン・受付番号発行", ready: true },
    { href: "/billing", icon: "💰", iconBg: "bg-purple-50 text-purple-600 group-hover:bg-purple-100", title: "会計", desc: "精算・レセプト管理", ready: true },
    { href: "/monitor", icon: "🖥️", iconBg: "bg-teal-50 text-teal-600 group-hover:bg-teal-100", title: "待合モニター", desc: "待合室表示用画面", ready: true },
    { href: "/recall", icon: "🔔", iconBg: "bg-amber-50 text-amber-600 group-hover:bg-amber-100", title: "リコール管理", desc: "定期検診リコール対象者一覧", ready: true },
  ];

  const settingsItems = [
    { href: "/settings", icon: "⚙️", title: "クリニック設定", desc: "基本情報・ユニット・スタッフ・予約枠" },
    { href: "/audit", icon: "🔍", title: "監査ログ", desc: "カルテ・会計の全変更履歴" },
    { href: "/lab-order", icon: "🏭", title: "技工指示書", desc: "補綴物の発注・進捗管理" },
    { href: "/csv-import", icon: "📥", title: "CSVインポート", desc: "患者・予約データの一括取込" },
    { href: "/reservation/book", icon: "🌐", title: "患者向け予約ページ", desc: "Web予約画面（URLを患者に共有）" },
    { href: "/mypage", icon: "👤", title: "患者マイページ", desc: "予約確認・治療経過（URLを患者に共有）" },
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
        {/* アラート */}
        {alerts.length > 0 && (
          <div className="flex gap-3 mb-6">
            {alerts.map(a => (
              <Link key={a.type} href={a.href} className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 ${a.color} hover:shadow-md transition-all`}>
                <span className="text-lg">{a.icon}</span>
                <span className="text-sm font-bold">{a.label}</span>
                <span className="text-xl font-bold">{a.count}</span>
                <span className="text-xs opacity-60">件 →</span>
              </Link>
            ))}
          </div>
        )}

        {/* 本日のリアルタイム状況 */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] text-gray-400 mb-1">本日の予約</p>
            <p className="text-3xl font-bold text-gray-900">{todayStats.total}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] text-gray-400 mb-1">待合中</p>
            <p className="text-3xl font-bold text-green-600">{todayStats.waiting}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] text-gray-400 mb-1">診察中</p>
            <p className="text-3xl font-bold text-orange-600">{todayStats.inConsult}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] text-gray-400 mb-1">完了</p>
            <p className="text-3xl font-bold text-purple-600">{todayStats.completed}</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <p className="text-[10px] text-gray-400 mb-1">会計済</p>
            <p className="text-3xl font-bold text-gray-500">{todayStats.billing_done}</p>
          </div>
          <div className="bg-gradient-to-br from-sky-500 to-sky-600 rounded-xl p-4 text-white">
            <p className="text-[10px] opacity-80 mb-1">本日の売上</p>
            <p className="text-2xl font-bold">¥{todayRevenue.burden.toLocaleString()}</p>
            <p className="text-[10px] opacity-70">{todayRevenue.points.toLocaleString()}点</p>
          </div>
        </div>

        {/* 今月の売上グラフ */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-gray-900">📊 今月の売上推移</h2>
              <p className="text-[10px] text-gray-400 mt-0.5">{todayStr.substring(0, 7)}</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <div className="text-right">
                <p className="text-gray-400">今月合計</p>
                <p className="font-bold text-gray-900 text-lg">¥{monthTotal.burden.toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400">保険請求</p>
                <p className="font-bold text-sky-600">¥{(monthTotal.points * 10 - monthTotal.burden).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-gray-400">件数</p>
                <p className="font-bold text-gray-700">{monthTotal.count}件</p>
              </div>
            </div>
          </div>
          {/* 棒グラフ（CSS純正） */}
          <div className="flex items-end gap-[2px] h-32">
            {monthlyData.map(d => {
              const h = (d.points / maxPoints) * 100;
              const isToday = d.day === parseInt(todayStr.split("-")[2]);
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center group relative">
                  <div className={`w-full rounded-t transition-all ${isToday ? "bg-sky-500" : d.points > 0 ? "bg-sky-300 hover:bg-sky-400" : "bg-gray-100"}`}
                    style={{ height: `${Math.max(h, 2)}%` }} />
                  {d.day % 5 === 1 && <span className="text-[8px] text-gray-400 mt-1">{d.day}</span>}
                  {d.points > 0 && (
                    <div className="absolute bottom-full mb-1 bg-gray-800 text-white text-[9px] px-2 py-1 rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                      {d.day}日: {d.points}点 / ¥{d.burden.toLocaleString()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 業務メニュー */}
        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">業務メニュー</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {menuItems.map((item) => (
            <Link key={item.href} href={item.href} className="block">
              <div className={`bg-white rounded-xl border border-gray-200 p-5 hover:border-sky-400 hover:shadow-md transition-all group ${!item.ready ? "opacity-50" : ""}`}>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl transition-colors ${item.iconBg}`}>{item.icon}</div>
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
