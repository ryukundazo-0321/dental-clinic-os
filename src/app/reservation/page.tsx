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
    id: string;
    name_kanji: string;
    name_kana: string;
    phone: string;
    date_of_birth: string;
    insurance_type: string;
    burden_ratio: number;
    is_new: boolean;
  } | null;
};

// ステータス定義
const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  reserved: { label: "予約済", color: "text-blue-700", bg: "bg-blue-100" },
  checked_in: { label: "来院済", color: "text-green-700", bg: "bg-green-100" },
  in_consultation: { label: "診察中", color: "text-orange-700", bg: "bg-orange-100" },
  completed: { label: "完了", color: "text-gray-500", bg: "bg-gray-100" },
  cancelled: { label: "キャンセル", color: "text-red-700", bg: "bg-red-100" },
};

// ステータス遷移の選択肢
const STATUS_TRANSITIONS: Record<string, string[]> = {
  reserved: ["checked_in", "cancelled"],
  checked_in: ["in_consultation", "cancelled"],
  in_consultation: ["completed"],
  completed: [],
  cancelled: ["reserved"],
};

export default function ReservationManagePage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => {
    return new Date().toISOString().split("T")[0];
  });
  const [loading, setLoading] = useState(true);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");

  // 手動追加フォーム
  const [addForm, setAddForm] = useState({
    name_kanji: "",
    name_kana: "",
    date_of_birth: "",
    phone: "",
    time: "09:00",
    insurance_type: "社保",
    burden_ratio: "0.3",
    patient_type: "new" as "new" | "returning",
  });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");

  // 予約データ取得
  useEffect(() => {
    fetchAppointments();

    // Realtimeでリアルタイム更新（設計書: イベント駆動）
    const channel = supabase
      .channel("appointments-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments" },
        () => {
          fetchAppointments();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedDate]);

  async function fetchAppointments() {
    setLoading(true);
    const startOfDay = `${selectedDate}T00:00:00`;
    const endOfDay = `${selectedDate}T23:59:59`;

    const { data, error } = await supabase
      .from("appointments")
      .select(`
        id, scheduled_at, patient_type, status, duration_min,
        patients (
          id, name_kanji, name_kana, phone, date_of_birth,
          insurance_type, burden_ratio, is_new
        )
      `)
      .gte("scheduled_at", startOfDay)
      .lte("scheduled_at", endOfDay)
      .order("scheduled_at", { ascending: true });

    if (!error && data) {
      setAppointments(data as unknown as Appointment[]);
    }
    setLoading(false);
  }

  // ステータス変更
  async function updateStatus(appointmentId: string, newStatus: string) {
    await supabase
      .from("appointments")
      .update({ status: newStatus })
      .eq("id", appointmentId);

    // ローカル状態も更新
    setAppointments((prev) =>
      prev.map((a) => (a.id === appointmentId ? { ...a, status: newStatus } : a))
    );
    if (selectedApt?.id === appointmentId) {
      setSelectedApt((prev) => (prev ? { ...prev, status: newStatus } : null));
    }
  }

  // 手動予約追加
  async function handleAddAppointment() {
    setAddLoading(true);
    setAddError("");

    if (!addForm.name_kanji || !addForm.name_kana || !addForm.date_of_birth || !addForm.phone) {
      setAddError("必須項目を入力してください");
      setAddLoading(false);
      return;
    }

    try {
      // 患者登録
      const { data: patient, error: patientErr } = await supabase
        .from("patients")
        .insert({
          name_kanji: addForm.name_kanji,
          name_kana: addForm.name_kana,
          date_of_birth: addForm.date_of_birth,
          phone: addForm.phone,
          insurance_type: addForm.insurance_type,
          burden_ratio: parseFloat(addForm.burden_ratio),
          is_new: addForm.patient_type === "new",
        })
        .select("id")
        .single();

      if (patientErr || !patient) {
        setAddError("患者登録に失敗しました");
        setAddLoading(false);
        return;
      }

      // 予約登録
      const scheduledAt = `${selectedDate}T${addForm.time}:00`;
      const { data: appointment, error: aptErr } = await supabase
        .from("appointments")
        .insert({
          patient_id: patient.id,
          scheduled_at: scheduledAt,
          patient_type: addForm.patient_type,
          status: "reserved",
          duration_min: 30,
        })
        .select("id")
        .single();

      if (aptErr || !appointment) {
        setAddError("予約登録に失敗しました");
        setAddLoading(false);
        return;
      }

      // カルテ自動作成
      await supabase.from("medical_records").insert({
        appointment_id: appointment.id,
        patient_id: patient.id,
        status: "draft",
      });

      // リセット
      setShowAddModal(false);
      setAddForm({
        name_kanji: "", name_kana: "", date_of_birth: "", phone: "",
        time: "09:00", insurance_type: "社保", burden_ratio: "0.3", patient_type: "new",
      });
      fetchAppointments();
    } catch {
      setAddError("エラーが発生しました");
    }
    setAddLoading(false);
  }

  // 時間フォーマット
  function formatTime(dateStr: string) {
    return new Date(dateStr).toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  // フィルタリング
  const filteredAppointments =
    filterStatus === "all"
      ? appointments
      : appointments.filter((a) => a.status === filterStatus);

  // ステータス別の件数
  const statusCounts = appointments.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // 時間枠
  const timeSlots = [
    "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
    "13:00", "13:30", "14:00", "14:30", "15:00", "15:30",
    "16:00", "16:30", "17:00", "17:30",
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">
              ← 戻る
            </Link>
            <h1 className="text-lg font-bold text-gray-900">📅 予約管理</h1>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-700 transition-colors"
          >
            ＋ 予約追加
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-4">
        {/* 日付選択 + サマリー */}
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <button
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() - 1);
              setSelectedDate(d.toISOString().split("T")[0]);
            }}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm"
          >
            ◀
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-bold text-sm"
          />
          <button
            onClick={() => {
              const d = new Date(selectedDate);
              d.setDate(d.getDate() + 1);
              setSelectedDate(d.toISOString().split("T")[0]);
            }}
            className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm"
          >
            ▶
          </button>
          <button
            onClick={() => setSelectedDate(new Date().toISOString().split("T")[0])}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-xs text-gray-500"
          >
            今日
          </button>
          <span className="text-sm text-gray-400 ml-auto">
            全 {appointments.length} 件
          </span>
        </div>

        {/* フィルタータブ */}
        <div className="flex gap-2 mb-4 overflow-x-auto">
          <button
            onClick={() => setFilterStatus("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
              filterStatus === "all"
                ? "bg-gray-900 text-white"
                : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
          >
            すべて ({appointments.length})
          </button>
          {Object.entries(STATUS_CONFIG).map(([key, config]) => (
            <button
              key={key}
              onClick={() => setFilterStatus(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors ${
                filterStatus === key
                  ? `${config.bg} ${config.color}`
                  : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"
              }`}
            >
              {config.label} ({statusCounts[key] || 0})
            </button>
          ))}
        </div>

        {/* 予約一覧 */}
        <div className="flex gap-4">
          {/* リスト */}
          <div className="flex-1">
            {loading ? (
              <div className="text-center py-12 text-gray-400">読み込み中...</div>
            ) : filteredAppointments.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-gray-400 mb-1">予約はありません</p>
                <p className="text-gray-300 text-sm">
                  「＋ 予約追加」または患者さんのWeb予約をお待ちください
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAppointments.map((apt) => {
                  const status = STATUS_CONFIG[apt.status] || STATUS_CONFIG.reserved;
                  const isSelected = selectedApt?.id === apt.id;
                  return (
                    <button
                      key={apt.id}
                      onClick={() => setSelectedApt(apt)}
                      className={`w-full text-left bg-white rounded-xl border p-4 hover:shadow-sm transition-all ${
                        isSelected ? "border-sky-400 shadow-sm" : "border-gray-200"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="text-center min-w-[50px]">
                            <p className="text-base font-bold text-gray-900">
                              {formatTime(apt.scheduled_at)}
                            </p>
                            <p className="text-xs text-gray-400">{apt.duration_min}分</p>
                          </div>
                          <div className="w-px h-10 bg-gray-200" />
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-bold text-gray-900 text-sm">
                                {apt.patients?.name_kanji || "未登録"}
                              </p>
                              {apt.patient_type === "new" && (
                                <span className="bg-red-100 text-red-600 text-[10px] px-1.5 py-0.5 rounded font-bold">
                                  初診
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">
                              {apt.patients?.name_kana}
                            </p>
                          </div>
                        </div>
                        <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${status.bg} ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 詳細パネル */}
          {selectedApt && (
            <div className="w-80 flex-shrink-0 hidden lg:block">
              <div className="bg-white rounded-xl border border-gray-200 p-5 sticky top-4">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-gray-900">予約詳細</h3>
                  <button
                    onClick={() => setSelectedApt(null)}
                    className="text-gray-400 hover:text-gray-600 text-sm"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">患者名</p>
                    <p className="font-bold text-gray-900 text-lg">
                      {selectedApt.patients?.name_kanji || "未登録"}
                    </p>
                    <p className="text-sm text-gray-400">
                      {selectedApt.patients?.name_kana}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">予約時間</p>
                      <p className="font-bold text-gray-900">
                        {formatTime(selectedApt.scheduled_at)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">区分</p>
                      <p className="font-bold text-gray-900">
                        {selectedApt.patient_type === "new" ? "初診" : "再診"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">電話番号</p>
                      <p className="text-sm text-gray-900">
                        {selectedApt.patients?.phone || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">生年月日</p>
                      <p className="text-sm text-gray-900">
                        {selectedApt.patients?.date_of_birth || "-"}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">保険種別</p>
                      <p className="text-sm text-gray-900">
                        {selectedApt.patients?.insurance_type || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">負担割合</p>
                      <p className="text-sm text-gray-900">
                        {selectedApt.patients?.burden_ratio
                          ? `${selectedApt.patients.burden_ratio * 10}割`
                          : "-"}
                      </p>
                    </div>
                  </div>

                  {/* ステータス */}
                  <div>
                    <p className="text-xs text-gray-400 mb-1.5">ステータス</p>
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          STATUS_CONFIG[selectedApt.status]?.bg
                        } ${STATUS_CONFIG[selectedApt.status]?.color}`}
                      >
                        {STATUS_CONFIG[selectedApt.status]?.label}
                      </span>
                    </div>
                  </div>

                  {/* ステータス変更ボタン */}
                  {STATUS_TRANSITIONS[selectedApt.status]?.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-400 mb-1.5">操作</p>
                      <div className="space-y-2">
                        {STATUS_TRANSITIONS[selectedApt.status].map(
                          (nextStatus) => {
                            const config = STATUS_CONFIG[nextStatus];
                            return (
                              <button
                                key={nextStatus}
                                onClick={() =>
                                  updateStatus(selectedApt.id, nextStatus)
                                }
                                className={`w-full py-2 rounded-lg text-sm font-bold transition-colors ${config.bg} ${config.color} hover:opacity-80`}
                              >
                                → {config.label} にする
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ===== 手動追加モーダル ===== */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 text-lg">予約を追加</h3>
              <button
                onClick={() => { setShowAddModal(false); setAddError(""); }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* 患者区分 */}
              <div className="flex gap-2">
                <button
                  onClick={() => setAddForm({ ...addForm, patient_type: "new" })}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                    addForm.patient_type === "new"
                      ? "bg-sky-600 text-white"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  初診
                </button>
                <button
                  onClick={() => setAddForm({ ...addForm, patient_type: "returning" })}
                  className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${
                    addForm.patient_type === "returning"
                      ? "bg-sky-600 text-white"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  再診
                </button>
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  氏名（漢字）<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={addForm.name_kanji}
                  onChange={(e) => setAddForm({ ...addForm, name_kanji: e.target.value })}
                  placeholder="山田 太郎"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  氏名（カナ）<span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={addForm.name_kana}
                  onChange={(e) => setAddForm({ ...addForm, name_kana: e.target.value })}
                  placeholder="ヤマダ タロウ"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  生年月日 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={addForm.date_of_birth}
                  onChange={(e) => setAddForm({ ...addForm, date_of_birth: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  電話番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  value={addForm.phone}
                  onChange={(e) => setAddForm({ ...addForm, phone: e.target.value })}
                  placeholder="09012345678"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400"
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">
                  予約時間 <span className="text-red-500">*</span>
                </label>
                <select
                  value={addForm.time}
                  onChange={(e) => setAddForm({ ...addForm, time: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white"
                >
                  {timeSlots.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">保険種別</label>
                  <select
                    value={addForm.insurance_type}
                    onChange={(e) => setAddForm({ ...addForm, insurance_type: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white"
                  >
                    <option value="社保">社保</option>
                    <option value="国保">国保</option>
                    <option value="後期高齢">後期高齢</option>
                    <option value="自費">自費</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">負担割合</label>
                  <select
                    value={addForm.burden_ratio}
                    onChange={(e) => setAddForm({ ...addForm, burden_ratio: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white"
                  >
                    <option value="0.3">3割</option>
                    <option value="0.2">2割</option>
                    <option value="0.1">1割</option>
                  </select>
                </div>
              </div>

              {addError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5">
                  <p className="text-red-600 text-sm">{addError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => { setShowAddModal(false); setAddError(""); }}
                  className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-lg font-bold hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleAddAppointment}
                  disabled={addLoading}
                  className="flex-1 bg-sky-600 text-white py-3 rounded-lg font-bold hover:bg-sky-700 transition-colors disabled:opacity-50"
                >
                  {addLoading ? "登録中..." : "予約を登録"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
