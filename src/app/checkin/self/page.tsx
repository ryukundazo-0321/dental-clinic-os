"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { getClinicConfig, type ClinicConfig } from "@/lib/reservation-utils";

type Step = "input" | "checking" | "confirm" | "complete" | "not_found" | "already_done";

type MatchedAppointment = {
  id: string;
  scheduled_at: string;
  patient_type: string;
  status: string;
  doctor_id: string | null;
  patient_name: string;
};

export default function SelfCheckinPage() {
  const [step, setStep] = useState<Step>("input");
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({ name_kanji: "", date_of_birth: "", phone: "" });
  const [matched, setMatched] = useState<MatchedAppointment | null>(null);
  const [queueNumber, setQueueNumber] = useState(0);

  useEffect(() => {
    async function init() {
      const c = await getClinicConfig();
      setConfig(c);
    }
    init();
  }, []);

  async function handleLookup() {
    if (!form.name_kanji || !form.date_of_birth || !form.phone) return;
    setStep("checking");
    setLoading(true);

    const todayStr = new Date().toISOString().split("T")[0];

    // 患者照合
    const { data: patient } = await supabase
      .from("patients")
      .select("id, name_kanji")
      .eq("name_kanji", form.name_kanji)
      .eq("date_of_birth", form.date_of_birth)
      .eq("phone", form.phone)
      .single();

    if (!patient) {
      setStep("not_found");
      setLoading(false);
      return;
    }

    // 今日の予約を検索
    const { data: appointments } = await supabase
      .from("appointments")
      .select("id, scheduled_at, patient_type, status, doctor_id")
      .eq("patient_id", patient.id)
      .gte("scheduled_at", `${todayStr}T00:00:00`)
      .lte("scheduled_at", `${todayStr}T23:59:59`)
      .in("status", ["reserved"])
      .order("scheduled_at", { ascending: true })
      .limit(1);

    if (!appointments || appointments.length === 0) {
      // 既にチェックイン済みかチェック
      const { data: checkedIn } = await supabase
        .from("appointments")
        .select("id")
        .eq("patient_id", patient.id)
        .gte("scheduled_at", `${todayStr}T00:00:00`)
        .lte("scheduled_at", `${todayStr}T23:59:59`)
        .in("status", ["checked_in", "in_consultation", "completed", "billing_done"])
        .limit(1);

      if (checkedIn && checkedIn.length > 0) {
        setStep("already_done");
      } else {
        setStep("not_found");
      }
      setLoading(false);
      return;
    }

    const apt = appointments[0];
    setMatched({
      id: apt.id,
      scheduled_at: apt.scheduled_at,
      patient_type: apt.patient_type,
      status: apt.status,
      doctor_id: apt.doctor_id,
      patient_name: patient.name_kanji,
    });
    setStep("confirm");
    setLoading(false);
  }

  async function handleCheckin() {
    if (!matched) return;
    setLoading(true);

    const todayStr = new Date().toISOString().split("T")[0];

    // 次の受付番号を取得
    const { data: maxQueue } = await supabase
      .from("queue")
      .select("queue_number")
      .gte("checked_in_at", `${todayStr}T00:00:00`)
      .order("queue_number", { ascending: false })
      .limit(1);

    const nextNumber = (maxQueue && maxQueue.length > 0) ? maxQueue[0].queue_number + 1 : 1;

    // 予約ステータスを来院済に
    await supabase
      .from("appointments")
      .update({ status: "checked_in" })
      .eq("id", matched.id);

    // キューに追加
    await supabase.from("queue").insert({
      appointment_id: matched.id,
      queue_number: nextNumber,
      status: "waiting",
      checked_in_at: new Date().toISOString(),
    });

    setQueueNumber(nextNumber);
    setStep("complete");
    setLoading(false);

    // 30秒後にリセット（次の患者用）
    setTimeout(() => {
      setStep("input");
      setForm({ name_kanji: "", date_of_birth: "", phone: "" });
      setMatched(null);
      setQueueNumber(0);
    }, 30000);
  }

  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }

  function reset() {
    setStep("input");
    setForm({ name_kanji: "", date_of_birth: "", phone: "" });
    setMatched(null);
    setQueueNumber(0);
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="bg-sky-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-5 text-center">
          <h1 className="text-xl font-bold">🦷 {config?.clinicName || "受付"}</h1>
          <p className="text-sky-200 text-sm mt-1">チェックインはこちらから</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8">
        {/* ===== 情報入力 ===== */}
        {step === "input" && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 text-center mb-2">受付</h2>
            <p className="text-sm text-gray-500 text-center mb-8">ご予約の方は以下をご入力ください</p>

            <div className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">お名前（漢字）<span className="text-red-500">*</span></label>
                <input type="text" value={form.name_kanji}
                  onChange={(e) => setForm({ ...form, name_kanji: e.target.value })}
                  placeholder="山田 太郎"
                  className="w-full border border-gray-300 rounded-xl px-4 py-4 text-lg focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">生年月日 <span className="text-red-500">*</span></label>
                <input type="date" value={form.date_of_birth}
                  onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })}
                  className="w-full border border-gray-300 rounded-xl px-4 py-4 text-lg focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1.5">電話番号 <span className="text-red-500">*</span></label>
                <input type="tel" value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="09012345678"
                  className="w-full border border-gray-300 rounded-xl px-4 py-4 text-lg focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" />
              </div>

              <button onClick={handleLookup}
                disabled={!form.name_kanji || !form.date_of_birth || !form.phone}
                className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 disabled:opacity-50 active:scale-[0.98] mt-4">
                受付する
              </button>
            </div>
          </div>
        )}

        {/* ===== 照合中 ===== */}
        {step === "checking" && (
          <div className="text-center py-16">
            <div className="text-4xl mb-4 animate-spin inline-block">⏳</div>
            <p className="text-gray-500 text-lg">確認中です...</p>
          </div>
        )}

        {/* ===== 予約確認 ===== */}
        {step === "confirm" && matched && (
          <div className="text-center">
            <h2 className="text-xl font-bold text-gray-900 mb-6">ご予約を確認しました</h2>
            <div className="bg-gray-50 rounded-2xl p-6 mb-6 text-left space-y-3">
              <div>
                <p className="text-xs text-gray-400">お名前</p>
                <p className="text-lg font-bold text-gray-900">{matched.patient_name} 様</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">ご予約時間</p>
                <p className="text-2xl font-bold text-sky-600">{formatTime(matched.scheduled_at)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">区分</p>
                <p className="font-bold text-gray-900">{matched.patient_type === "new" ? "初診" : "再診"}</p>
              </div>
            </div>
            <div className="space-y-3">
              <button onClick={handleCheckin} disabled={loading}
                className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-sky-700 disabled:opacity-50 active:scale-[0.98]">
                {loading ? "チェックイン中..." : "チェックインする"}
              </button>
              <button onClick={reset} className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">
                やり直す
              </button>
            </div>
          </div>
        )}

        {/* ===== チェックイン完了 ===== */}
        {step === "complete" && (
          <div className="text-center py-4">
            <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">✅</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">チェックインが完了しました</h2>

            <div className="bg-sky-50 border-2 border-sky-300 rounded-3xl p-8 my-8">
              <p className="text-sm text-sky-600 mb-1">あなたの受付番号</p>
              <p className="text-8xl font-bold text-sky-600">{queueNumber}</p>
            </div>

            <p className="text-gray-500 mb-2">待合室でお待ちください。</p>
            <p className="text-gray-400 text-sm mb-8">モニターに番号が表示されたら診察室へお入りください。</p>

            <button onClick={reset}
              className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">
              次の方の受付へ
            </button>
          </div>
        )}

        {/* ===== 予約なし ===== */}
        {step === "not_found" && (
          <div className="text-center py-8">
            <div className="bg-yellow-100 w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">⚠️</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">本日のご予約が見つかりません</h2>
            <p className="text-gray-500 text-sm mb-2">入力内容をご確認いただくか、受付スタッフにお声がけください。</p>
            <p className="text-gray-400 text-xs mb-8">※ 予約時と同じ氏名・生年月日・電話番号をご入力ください</p>
            <button onClick={reset}
              className="w-full bg-sky-600 text-white py-4 rounded-xl font-bold text-lg">
              もう一度入力する
            </button>
          </div>
        )}

        {/* ===== チェックイン済み ===== */}
        {step === "already_done" && (
          <div className="text-center py-8">
            <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">✅</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">既に受付済みです</h2>
            <p className="text-gray-500 text-sm mb-8">待合室でお待ちください。モニターに番号が表示されたら診察室へお入りください。</p>
            <button onClick={reset}
              className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">
              次の方の受付へ
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-100 mt-auto">
        <div className="max-w-lg mx-auto px-4 py-4 text-center text-xs text-gray-300">Powered by DENTAL CLINIC OS</div>
      </footer>
    </div>
  );
}
