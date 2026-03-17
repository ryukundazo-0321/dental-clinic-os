"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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

function getJSTDateStr() {
  const now = new Date();
  const jst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  return jst.toISOString().split("T")[0];
}

export default function SelfCheckinPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("input");
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [loading, setLoading] = useState(false);

  const [patientId, setPatientId] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [matched, setMatched] = useState<MatchedAppointment | null>(null);
  const [queueNumber, setQueueNumber] = useState(0);
  const [completedAptId, setCompletedAptId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    async function init() {
      const c = await getClinicConfig();
      setConfig(c);
    }
    init();
  }, []);

  // チェックイン完了後のカウントダウン → 問診へ自動遷移
  useEffect(() => {
    if (step !== "complete" || !completedAptId) return;
    setCountdown(5);
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          router.push(`/questionnaire?appointment_id=${completedAptId}`);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [step, completedAptId, router]);

  // 生年月日8桁 → YYYY-MM-DD変換
  function parseBirthDate(input: string): string | null {
    const digits = input.replace(/[^0-9]/g, "");
    if (digits.length !== 8) return null;
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const d = digits.slice(6, 8);
    const mi = parseInt(m), di = parseInt(d);
    if (mi < 1 || mi > 12 || di < 1 || di > 31) return null;
    return `${y}-${m}-${d}`;
  }

  async function handleLookup() {
    if (!patientId.trim() || !birthDate.trim()) return;
    setStep("checking");
    setLoading(true);

    const dob = parseBirthDate(birthDate);
    if (!dob) {
      setStep("not_found");
      setLoading(false);
      return;
    }

    const todayStr = getJSTDateStr();

    let inputId = patientId.trim().toUpperCase();
    if (/^\d+$/.test(inputId)) {
      inputId = `P-${inputId.padStart(5, "0")}`;
    }
    if (/^P\d+$/.test(inputId)) {
      inputId = `P-${inputId.slice(1).padStart(5, "0")}`;
    }

    const { data: patient } = await supabase
      .from("patients")
      .select("id, name_kanji")
      .eq("patient_number", inputId)
      .eq("date_of_birth", dob)
      .single();

    if (!patient) {
      setStep("not_found");
      setLoading(false);
      return;
    }

    const { data: appointments } = await supabase
      .from("appointments")
      .select("id, scheduled_at, patient_type, status, doctor_id")
      .eq("patient_id", patient.id)
      .gte("scheduled_at", `${todayStr}T00:00:00`)
      .lte("scheduled_at", `${todayStr}T23:59:59`)
      .in("status", ["reserved"])
      .order("created_at", { ascending: false })
      .limit(1);

    if (!appointments || appointments.length === 0) {
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

    const todayStr = getJSTDateStr();

    const { data: maxQueue } = await supabase
      .from("queue")
      .select("queue_number")
      .gte("checked_in_at", `${todayStr}T00:00:00`)
      .order("queue_number", { ascending: false })
      .limit(1);

    const nextNumber = (maxQueue && maxQueue.length > 0) ? maxQueue[0].queue_number + 1 : 1;

    await supabase
      .from("appointments")
      .update({ status: "checked_in" })
      .eq("id", matched.id);

    await supabase.from("queue").insert({
      appointment_id: matched.id,
      queue_number: nextNumber,
      status: "waiting",
      checked_in_at: new Date().toISOString(),
    });

    setQueueNumber(nextNumber);
    setCompletedAptId(matched.id);  // ← 問診遷移用にIDを保持
    setStep("complete");
    setLoading(false);
  }

  function formatTime(dateStr: string) {
    const d = new Date(dateStr);
    return d.getUTCHours().toString().padStart(2, "0") + ":" + d.getUTCMinutes().toString().padStart(2, "0");
  }

  function reset() {
    setStep("input");
    setPatientId("");
    setBirthDate("");
    setMatched(null);
    setQueueNumber(0);
    setCompletedAptId(null);
  }

  function formatBirthDisplay(input: string): string {
    const digits = input.replace(/[^0-9]/g, "");
    if (digits.length <= 4) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 4)}/${digits.slice(4)}`;
    return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6, 8)}`;
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <header className="bg-sky-600 text-white">
        <div className="max-w-lg mx-auto px-4 py-5 text-center">
          <h1 className="text-xl font-bold">🦷 {config?.clinicName || "受付"}</h1>
          <p className="text-sky-200 text-sm mt-1">セルフチェックイン</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8 flex-1 w-full">
        {/* ===== 入力画面 ===== */}
        {step === "input" && (
          <div>
            <h2 className="text-xl font-bold text-gray-900 text-center mb-2">受付</h2>
            <p className="text-sm text-gray-500 text-center mb-8">
              診察券番号と生年月日を入力してください
            </p>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  診察券番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                  placeholder="例: 00001"
                  className="w-full border-2 border-gray-200 rounded-2xl px-5 py-5 text-2xl text-center font-mono font-bold tracking-widest focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
                <p className="text-xs text-gray-400 mt-1.5 text-center">
                  診察券に記載されている番号をご入力ください
                </p>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">
                  生年月日（8桁） <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={birthDate}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^0-9]/g, "").slice(0, 8);
                    setBirthDate(v);
                  }}
                  placeholder="例: 19900101"
                  maxLength={8}
                  className="w-full border-2 border-gray-200 rounded-2xl px-5 py-5 text-2xl text-center font-mono font-bold tracking-widest focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                />
                {birthDate.length > 0 && (
                  <p className="text-sm text-sky-600 mt-2 text-center font-bold">
                    {formatBirthDisplay(birthDate)}
                    {birthDate.length === 8 && " ✓"}
                  </p>
                )}
                <p className="text-xs text-gray-400 mt-1 text-center">
                  西暦で8桁入力（例: 1990年1月1日 → 19900101）
                </p>
              </div>

              <button
                onClick={handleLookup}
                disabled={!patientId.trim() || birthDate.length !== 8}
                className="w-full bg-sky-600 text-white py-5 rounded-2xl font-bold text-xl hover:bg-sky-700 disabled:opacity-40 active:scale-[0.98] mt-4 shadow-lg shadow-sky-200"
              >
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

        {/* ===== チェックイン完了 → 問診へ ===== */}
        {step === "complete" && (
          <div className="text-center py-4">
            <div className="bg-green-100 w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">✅</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">チェックインが完了しました</h2>
            <div className="bg-sky-50 border-2 border-sky-300 rounded-3xl p-8 my-6">
              <p className="text-sm text-sky-600 mb-1">あなたの受付番号</p>
              <p className="text-8xl font-bold text-sky-600">{queueNumber}</p>
            </div>

            {/* 問診へ誘導 */}
            <div className="bg-orange-50 border-2 border-orange-200 rounded-2xl p-5 mb-6">
              <p className="text-sm font-bold text-orange-700 mb-1">📋 続けて問診にお答えください</p>
              <p className="text-xs text-orange-500">このまま問診画面へ移動します</p>
              <p className="text-3xl font-bold text-orange-600 mt-3">{countdown}</p>
              <p className="text-xs text-orange-400">秒後に自動で移動します</p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => completedAptId && router.push(`/questionnaire?appointment_id=${completedAptId}`)}
                className="w-full bg-orange-500 text-white py-4 rounded-xl font-bold text-lg hover:bg-orange-600 active:scale-[0.98]"
              >
                今すぐ問診へ進む →
              </button>
              <button onClick={reset} className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold text-sm">
                次の方の受付へ
              </button>
            </div>
          </div>
        )}

        {/* ===== 予約なし ===== */}
        {step === "not_found" && (
          <div className="text-center py-8">
            <div className="bg-yellow-100 w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">⚠️</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">本日のご予約が見つかりません</h2>
            <p className="text-gray-500 text-sm mb-2">
              入力内容をご確認いただくか、受付スタッフにお声がけください。
            </p>
            <p className="text-gray-400 text-xs mb-8">
              ※ 診察券番号と生年月日をご確認ください
            </p>
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
            <p className="text-gray-500 text-sm mb-8">
              待合室でお待ちください。モニターに番号が表示されたら診察室へお入りください。
            </p>
            <button onClick={reset}
              className="w-full bg-gray-100 text-gray-600 py-3 rounded-xl font-bold">
              次の方の受付へ
            </button>
          </div>
        )}
      </main>

      <footer className="border-t border-gray-100 mt-auto">
        <div className="max-w-lg mx-auto px-4 py-4 text-center text-xs text-gray-300">
          Powered by DENTAL CLINIC OS
        </div>
      </footer>
    </div>
  );
}
