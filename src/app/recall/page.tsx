"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type RecallPatient = {
  id: string;
  patient_number: string;
  name_kanji: string;
  name_kana: string;
  phone: string;
  date_of_birth: string;
  patient_status: string;
  last_visit: string | null;
  days_since_visit: number;
  recall_status: "overdue" | "due_soon" | "ok";
  last_soap_p: string | null;
};

type RecallSetting = {
  interval_months: number;
  warning_days: number;
};

const DEFAULT_SETTINGS: RecallSetting = {
  interval_months: 3,
  warning_days: 14,
};

function getTodayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
}

export default function RecallPage() {
  const [patients, setPatients] = useState<RecallPatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<RecallSetting>(DEFAULT_SETTINGS);
  const [filter, setFilter] = useState<"all" | "overdue" | "due_soon">("overdue");
  const [search, setSearch] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const loadRecallPatients = useCallback(async () => {
    setLoading(true);
    const today = getTodayJST();

    // 全アクティブ患者を取得
    const { data: pts } = await supabase
      .from("patients")
      .select("id, patient_number, name_kanji, name_kana, phone, date_of_birth, patient_status")
      .in("patient_status", ["active", "inactive"])
      .order("name_kana", { ascending: true });

    if (!pts) { setLoading(false); return; }

    // 各患者の最終来院日を取得
    const recallList: RecallPatient[] = [];
    const intervalDays = settings.interval_months * 30;

    for (const pt of pts) {
      const { data: lastApt } = await supabase
        .from("appointments")
        .select("scheduled_at, medical_records(soap_p)")
        .eq("patient_id", pt.id)
        .in("status", ["completed", "billing_done"])
        .order("scheduled_at", { ascending: false })
        .limit(1);

      const lastVisit = lastApt && lastApt.length > 0 ? lastApt[0].scheduled_at : null;
      let daysSince = 9999;
      if (lastVisit) {
        const lastDate = new Date(lastVisit);
        const todayDate = new Date(today + "T12:00:00");
        daysSince = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // 次回予約が入っているか確認
      const { data: futureApt } = await supabase
        .from("appointments")
        .select("id")
        .eq("patient_id", pt.id)
        .neq("status", "cancelled")
        .gte("scheduled_at", `${today}T00:00:00+00`)
        .limit(1);

      // 次回予約がある場合はスキップ
      if (futureApt && futureApt.length > 0) continue;

      let recallStatus: "overdue" | "due_soon" | "ok" = "ok";
      if (daysSince >= intervalDays) recallStatus = "overdue";
      else if (daysSince >= intervalDays - settings.warning_days) recallStatus = "due_soon";
      else continue; // okの場合はリストに含めない（リコール不要）

      const lastSoapP = lastApt?.[0]?.medical_records
        ? (lastApt[0].medical_records as unknown as { soap_p: string }[])?.[0]?.soap_p || null
        : null;

      recallList.push({
        ...pt,
        last_visit: lastVisit,
        days_since_visit: daysSince,
        recall_status: recallStatus,
        last_soap_p: lastSoapP,
      });
    }

    // daysSince降順（最も来院から経っている患者が上）
    recallList.sort((a, b) => b.days_since_visit - a.days_since_visit);
    setPatients(recallList);
    setLoading(false);
  }, [settings]);

  useEffect(() => { loadRecallPatients(); }, [loadRecallPatients]);

  const filtered = patients.filter(p => {
    if (filter === "overdue" && p.recall_status !== "overdue") return false;
    if (filter === "due_soon" && p.recall_status !== "due_soon") return false;
    if (search) {
      const q = search.toLowerCase();
      return p.name_kanji.includes(q) || p.name_kana.includes(q) || p.phone.includes(q) || (p.patient_number || "").includes(q);
    }
    return true;
  });

  const overdueCount = patients.filter(p => p.recall_status === "overdue").length;
  const dueSoonCount = patients.filter(p => p.recall_status === "due_soon").length;

  function formatDate(d: string | null) {
    if (!d) return "未来院";
    return new Date(d).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDays(days: number) {
    if (days >= 9999) return "—";
    if (days >= 365) return `${Math.floor(days / 365)}年${Math.floor((days % 365) / 30)}ヶ月`;
    if (days >= 30) return `${Math.floor(days / 30)}ヶ月${days % 30}日`;
    return `${days}日`;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm font-bold">← ホーム</Link>
            <h1 className="text-lg font-bold text-gray-900">🔔 リコール管理</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-red-50 text-red-600 px-3 py-1 rounded-full text-xs font-bold">
              要リコール {overdueCount}人
            </span>
            <span className="bg-amber-50 text-amber-600 px-3 py-1 rounded-full text-xs font-bold">
              もうすぐ {dueSoonCount}人
            </span>
            <button onClick={() => setShowSettings(!showSettings)}
              className="text-xs text-gray-400 hover:text-gray-600 font-bold bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
              ⚙️ 設定
            </button>
            <button onClick={loadRecallPatients} disabled={loading}
              className="text-xs text-sky-600 hover:text-sky-800 font-bold">
              🔄 更新
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* 設定パネル */}
        {showSettings && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3">⚙️ リコール設定</h3>
            <div className="flex gap-6 items-end">
              <div>
                <label className="text-xs text-gray-400 block mb-1">リコール間隔</label>
                <select value={settings.interval_months}
                  onChange={e => setSettings({ ...settings, interval_months: parseInt(e.target.value) })}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold">
                  <option value={1}>1ヶ月</option>
                  <option value={2}>2ヶ月</option>
                  <option value={3}>3ヶ月</option>
                  <option value={4}>4ヶ月</option>
                  <option value={6}>6ヶ月</option>
                  <option value={12}>12ヶ月</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">事前通知（日前）</label>
                <select value={settings.warning_days}
                  onChange={e => setSettings({ ...settings, warning_days: parseInt(e.target.value) })}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold">
                  <option value={7}>7日前</option>
                  <option value={14}>14日前</option>
                  <option value={21}>21日前</option>
                  <option value={30}>30日前</option>
                </select>
              </div>
              <p className="text-xs text-gray-400">
                最終来院から <strong className="text-gray-700">{settings.interval_months}ヶ月</strong> 経過でリコール対象。
                <strong className="text-gray-700">{settings.warning_days}日前</strong> から「もうすぐ」表示。
              </p>
            </div>
          </div>
        )}

        {/* フィルタ・検索 */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex bg-white rounded-lg border border-gray-200 p-0.5">
            {[
              { key: "all" as const, label: "全て", count: patients.length },
              { key: "overdue" as const, label: "要リコール", count: overdueCount },
              { key: "due_soon" as const, label: "もうすぐ", count: dueSoonCount },
            ].map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`px-4 py-2 rounded-md text-xs font-bold transition-all ${filter === f.key ? "bg-sky-500 text-white shadow-sm" : "text-gray-500 hover:bg-gray-50"}`}>
                {f.label} ({f.count})
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="🔍 患者名・番号・電話で検索"
            className="flex-1 max-w-sm border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-sky-400" />
        </div>

        {/* リスト */}
        {loading ? (
          <div className="text-center py-20"><p className="text-gray-400">読み込み中...</p></div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-xl border border-gray-200">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-gray-400">
              {filter === "overdue" ? "リコール期限超過の患者はいません" :
               filter === "due_soon" ? "もうすぐリコール時期の患者はいません" :
               "リコール対象の患者はいません"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(p => (
              <div key={p.id} className={`bg-white rounded-xl border-2 p-4 transition-all hover:shadow-md ${
                p.recall_status === "overdue" ? "border-red-200" : "border-amber-200"
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-lg ${
                      p.recall_status === "overdue" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                    }`}>
                      {p.name_kanji.charAt(0)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-bold text-gray-900">{p.name_kanji}</p>
                        <span className="text-xs text-gray-400">({p.name_kana})</span>
                        {p.patient_number && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{p.patient_number}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs text-gray-400">📞 {p.phone || "未登録"}</span>
                        <span className="text-xs text-gray-400">最終来院: {formatDate(p.last_visit)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className={`text-lg font-bold ${
                        p.recall_status === "overdue" ? "text-red-600" : "text-amber-600"
                      }`}>
                        {formatDays(p.days_since_visit)}
                      </p>
                      <p className={`text-[10px] font-bold ${
                        p.recall_status === "overdue" ? "text-red-400" : "text-amber-400"
                      }`}>
                        {p.recall_status === "overdue" ? "期限超過" : "もうすぐ"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Link href={`/patients/${p.id}`}
                        className="bg-gray-100 text-gray-600 px-3 py-2 rounded-lg text-xs font-bold hover:bg-gray-200">
                        📋 カルテ
                      </Link>
                      <Link href={`/reservation?action=new&patient_id=${p.id}&patient_name=${encodeURIComponent(p.name_kanji)}`}
                        className="bg-sky-500 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-sky-600 shadow-sm shadow-sky-200">
                        📅 予約
                      </Link>
                    </div>
                  </div>
                </div>
                {p.last_soap_p && (
                  <div className="mt-2 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-[10px] text-gray-400 font-bold">前回P欄: </span>
                    <span className="text-xs text-gray-600">{p.last_soap_p.slice(0, 100)}{p.last_soap_p.length > 100 ? "..." : ""}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* サマリ */}
        {!loading && patients.length > 0 && (
          <div className="mt-6 bg-white rounded-xl border border-gray-200 p-4">
            <h3 className="text-sm font-bold text-gray-700 mb-3">📊 リコールサマリ</h3>
            <div className="grid grid-cols-4 gap-4">
              <div className="text-center">
                <p className="text-3xl font-bold text-red-600">{overdueCount}</p>
                <p className="text-xs text-gray-400">期限超過</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-amber-600">{dueSoonCount}</p>
                <p className="text-xs text-gray-400">もうすぐ</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-gray-700">{patients.length}</p>
                <p className="text-xs text-gray-400">リコール対象</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-sky-600">{settings.interval_months}</p>
                <p className="text-xs text-gray-400">ヶ月間隔</p>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
