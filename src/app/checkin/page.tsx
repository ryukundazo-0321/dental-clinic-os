"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type TodayAppointment = {
  id: string;
  scheduled_at: string;
  patient_type: string;
  status: string;
  doctor_id: string | null;
  patients: { id: string; name_kanji: string; name_kana: string; phone: string } | null;
};

type QueueEntry = {
  id: string;
  appointment_id: string;
  queue_number: number;
  status: string;
  checked_in_at: string;
  called_at: string | null;
};

export default function CheckinPage() {
  const [appointments, setAppointments] = useState<TodayAppointment[]>([]);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkinResult, setCheckinResult] = useState<{ number: number; name: string } | null>(null);

  // 手動チェックイン用
  const [searchQuery, setSearchQuery] = useState("");

  const [showQR, setShowQR] = useState(false);
  const selfCheckinUrl = typeof window !== "undefined"
    ? `${window.location.origin}/checkin/self`
    : "/checkin/self";

  const todayStr = new Date().toISOString().split("T")[0];

  useEffect(() => {
    fetchData();
    const channel = supabase.channel("checkin-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => fetchData())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue" }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  async function fetchData() {
    setLoading(true);

    // 今日の予約
    const { data: apts } = await supabase
      .from("appointments")
      .select(`id, scheduled_at, patient_type, status, doctor_id,
        patients ( id, name_kanji, name_kana, phone )`)
      .gte("scheduled_at", `${todayStr}T00:00:00`)
      .lte("scheduled_at", `${todayStr}T23:59:59`)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });

    if (apts) setAppointments(apts as unknown as TodayAppointment[]);

    // 今日のキュー
    const { data: queueData } = await supabase
      .from("queue")
      .select("*")
      .gte("checked_in_at", `${todayStr}T00:00:00`)
      .order("queue_number", { ascending: true });

    if (queueData) setQueue(queueData);

    setLoading(false);
  }

  // チェックイン処理
  async function checkin(appointment: TodayAppointment) {
    if (appointment.status !== "reserved") return;

    // 次の受付番号を取得
    const maxNum = queue.length > 0 ? Math.max(...queue.map((q) => q.queue_number)) : 0;
    const nextNumber = maxNum + 1;

    // 予約ステータスを来院済に
    await supabase.from("appointments").update({ status: "checked_in" }).eq("id", appointment.id);

    // キューに追加
    await supabase.from("queue").insert({
      appointment_id: appointment.id,
      queue_number: nextNumber,
      status: "waiting",
      checked_in_at: new Date().toISOString(),
    });

    setCheckinResult({
      number: nextNumber,
      name: appointment.patients?.name_kanji || "",
    });

    // 3秒後に結果を消す
    setTimeout(() => setCheckinResult(null), 5000);
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr); return d.getUTCHours().toString().padStart(2, "0") + ":" + d.getUTCMinutes().toString().padStart(2, "0");
  }

  const reservedApts = appointments.filter((a) => a.status === "reserved");
  const checkedInApts = appointments.filter((a) => a.status === "checked_in");
  const filteredReserved = searchQuery
    ? reservedApts.filter((a) =>
        a.patients?.name_kanji?.includes(searchQuery) ||
        a.patients?.name_kana?.includes(searchQuery) ||
        a.patients?.phone?.includes(searchQuery)
      )
    : reservedApts;

  const waitingQueue = queue.filter((q) => q.status === "waiting");
  const inRoomQueue = queue.filter((q) => q.status === "in_room");

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">📱 受付</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowQR(true)} className="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-gray-200">
              📱 QRコード表示
            </button>
            <Link href="/monitor" target="_blank" className="bg-teal-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-teal-700">
              🖥️ 待合モニターを開く
            </Link>
          </div>
        </div>
      </header>

      {/* チェックイン成功表示 */}
      {checkinResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setCheckinResult(null)}>
          <div className="bg-white rounded-3xl p-10 text-center max-w-sm mx-4 animate-bounce-in">
            <p className="text-sm text-gray-500 mb-2">受付番号</p>
            <p className="text-8xl font-bold text-sky-600 mb-4">{checkinResult.number}</p>
            <p className="text-xl font-bold text-gray-900 mb-2">{checkinResult.name} 様</p>
            <p className="text-sm text-gray-500">受付が完了しました。待合室でお待ちください。</p>
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-4 py-4">
        <div className="flex gap-4">
          {/* 左: チェックイン */}
          <div className="flex-1">
            {/* サマリー */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <p className="text-xs text-gray-400">未チェックイン</p>
                <p className="text-2xl font-bold text-gray-900">{reservedApts.length}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <p className="text-xs text-gray-400">待合中</p>
                <p className="text-2xl font-bold text-sky-600">{waitingQueue.length}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <p className="text-xs text-gray-400">診察中</p>
                <p className="text-2xl font-bold text-orange-600">{inRoomQueue.length}</p>
              </div>
            </div>

            {/* 検索 */}
            <div className="mb-4">
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="患者名・カナ・電話番号で検索..." className="w-full bg-white border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:border-sky-400" />
            </div>

            {/* 予約済み一覧（チェックイン対象） */}
            <h3 className="text-sm font-bold text-gray-400 mb-2">📅 本日の予約（未チェックイン）</h3>
            {loading ? (
              <div className="text-center py-8 text-gray-400">読み込み中...</div>
            ) : filteredReserved.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <p className="text-gray-400">{searchQuery ? "該当する予約がありません" : "未チェックインの予約はありません"}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredReserved.map((apt) => (
                  <div key={apt.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="text-center min-w-[50px]">
                        <p className="text-lg font-bold text-gray-900">{formatTime(apt.scheduled_at)}</p>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-gray-900">{apt.patients?.name_kanji || "未登録"}</p>
                          {apt.patient_type === "new" && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-bold">初診</span>}
                        </div>
                        <p className="text-xs text-gray-400">{apt.patients?.name_kana}</p>
                      </div>
                    </div>
                    <button onClick={() => checkin(apt)}
                      className="bg-sky-600 text-white px-6 py-3 rounded-xl font-bold text-sm hover:bg-sky-700 active:scale-[0.97] transition-all">
                      チェックイン
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* チェックイン済み一覧 */}
            {checkedInApts.length > 0 && (
              <div className="mt-6">
                <h3 className="text-sm font-bold text-gray-400 mb-2">✅ チェックイン済み</h3>
                <div className="space-y-2">
                  {checkedInApts.map((apt) => {
                    const qEntry = queue.find((q) => q.appointment_id === apt.id);
                    return (
                      <div key={apt.id} className="bg-green-50 rounded-xl border border-green-200 p-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="bg-green-100 text-green-700 w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold">
                            {qEntry?.queue_number || "-"}
                          </div>
                          <div>
                            <p className="font-bold text-gray-900">{apt.patients?.name_kanji || "未登録"}</p>
                            <p className="text-xs text-gray-400">{formatTime(apt.scheduled_at)} / {apt.patients?.name_kana}</p>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                          {qEntry?.status === "waiting" ? "待合中" : qEntry?.status === "in_room" ? "診察中" : "チェックイン済"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 右: 待合キュー */}
          <div className="w-72 flex-shrink-0 hidden lg:block">
            <div className="bg-white rounded-xl border border-gray-200 p-4 sticky top-4">
              <h3 className="font-bold text-gray-900 mb-3">待合リスト</h3>

              {waitingQueue.length === 0 && inRoomQueue.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-4">待合中の患者はいません</p>
              ) : (
                <div className="space-y-2">
                  {/* 診察中 */}
                  {inRoomQueue.map((q) => {
                    const apt = appointments.find((a) => a.id === q.appointment_id);
                    return (
                      <div key={q.id} className="bg-orange-50 border border-orange-200 rounded-lg p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="bg-orange-100 text-orange-700 w-7 h-7 rounded text-sm font-bold flex items-center justify-center">{q.queue_number}</span>
                          <div>
                            <p className="text-sm font-bold text-gray-900">{apt?.patients?.name_kanji || "-"}</p>
                            <p className="text-[10px] text-orange-600 font-bold">🩺 診察中</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {/* 待合中 */}
                  {waitingQueue.map((q) => {
                    const apt = appointments.find((a) => a.id === q.appointment_id);
                    return (
                      <div key={q.id} className="bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="bg-sky-100 text-sky-700 w-7 h-7 rounded text-sm font-bold flex items-center justify-center">{q.queue_number}</span>
                          <div>
                            <p className="text-sm font-bold text-gray-900">{apt?.patients?.name_kanji || "-"}</p>
                            <p className="text-[10px] text-gray-400">待合中</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* QRコード表示モーダル */}
      {showQR && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setShowQR(false)}>
          <div className="bg-white rounded-2xl p-8 max-w-md w-full text-center" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-2">📱 セルフチェックイン用QRコード</h3>
            <p className="text-sm text-gray-500 mb-6">このQRコードを受付に掲示してください。<br />患者さんがスマホで読み取ってチェックインできます。</p>

            {/* QRコード（Google Charts API使用） */}
            <div className="bg-white p-4 inline-block rounded-xl border-2 border-gray-200 mb-4">
              <img
                src={`https://chart.googleapis.com/chart?cht=qr&chs=250x250&chl=${encodeURIComponent(selfCheckinUrl)}&choe=UTF-8`}
                alt="QRコード"
                width={250}
                height={250}
              />
            </div>

            <p className="text-xs text-gray-400 mb-4 break-all">{selfCheckinUrl}</p>

            <div className="space-y-2">
              <button onClick={() => { navigator.clipboard.writeText(selfCheckinUrl); }}
                className="w-full bg-sky-600 text-white py-3 rounded-xl font-bold text-sm hover:bg-sky-700">
                📋 URLをコピー
              </button>
              <a href={selfCheckinUrl} target="_blank"
                className="block w-full bg-gray-100 text-gray-700 py-3 rounded-xl font-bold text-sm hover:bg-gray-200 text-center">
                プレビューを開く →
              </a>
              <button onClick={() => setShowQR(false)}
                className="w-full text-gray-400 py-2 text-sm">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
