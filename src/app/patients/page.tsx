"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

type Patient = {
  id: string;
  patient_number: string | null;
  name_kanji: string;
  name_kana: string;
  date_of_birth: string | null;
  sex: string | null;
  phone: string | null;
  insurance_type: string | null;
  patient_status: string | null;
  allergies: unknown;
  is_new: boolean;
  created_at: string;
  last_visit?: string | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  active:    { label: "通院中", color: "text-green-700",  bg: "bg-green-100" },
  inactive:  { label: "中断",   color: "text-orange-700", bg: "bg-orange-100" },
  suspended: { label: "休止",   color: "text-red-700",    bg: "bg-red-100" },
  completed: { label: "完了",   color: "text-gray-500",   bg: "bg-gray-100" },
};

function calcAge(dob: string | null): string {
  if (!dob) return "-";
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return `${age}歳`;
}

function hasAllergies(allergies: unknown): boolean {
  if (!allergies) return false;
  if (Array.isArray(allergies)) return allergies.length > 0;
  if (typeof allergies === "object") return Object.keys(allergies as object).length > 0;
  return false;
}

export default function PatientsPage() {
  const { staff } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("last_visit");
  const [totalCount, setTotalCount] = useState(0);
  const [showNewModal, setShowNewModal] = useState(false);

  // 新規登録フォーム
  const [newForm, setNewForm] = useState({
    name_kanji: "", name_kana: "", date_of_birth: "", sex: "男",
    phone: "", insurance_type: "社保",
  });
  const [saving, setSaving] = useState(false);

  const fetchPatients = useCallback(async () => {
    setLoading(true);

    // 患者を取得
    let query = supabase
      .from("patients")
      .select("id, patient_number, name_kanji, name_kana, date_of_birth, sex, phone, insurance_type, patient_status, allergies, is_new, created_at");

    // ステータスフィルター
    if (filterStatus !== "all") {
      query = query.eq("patient_status", filterStatus);
    }

    const { data, error } = await query.order("created_at", { ascending: false });

    if (error) {
      console.error("患者取得エラー:", error);
      setLoading(false);
      return;
    }

    let results = data || [];

    // 最終来院日を取得
    const patientIds = results.map(p => p.id);
    const lastVisitMap = new Map<string, string>();

    if (patientIds.length > 0) {
      const { data: aptData } = await supabase
        .from("appointments")
        .select("patient_id, scheduled_at")
        .in("patient_id", patientIds)
        .in("status", ["completed", "billing_done", "checked_in", "in_consultation"])
        .order("scheduled_at", { ascending: false });

      if (aptData) {
        aptData.forEach(a => {
          if (!lastVisitMap.has(a.patient_id)) {
            lastVisitMap.set(a.patient_id, a.scheduled_at);
          }
        });
      }
    }

    // 結果にlast_visitを付加
    let enriched: Patient[] = results.map(p => ({
      ...p,
      last_visit: lastVisitMap.get(p.id) || null,
    }));

    // 検索フィルター
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      enriched = enriched.filter(p =>
        (p.name_kanji && p.name_kanji.toLowerCase().includes(q)) ||
        (p.name_kana && p.name_kana.toLowerCase().includes(q)) ||
        (p.patient_number && p.patient_number.toLowerCase().includes(q)) ||
        (p.phone && p.phone.includes(q))
      );
    }

    // ソート
    if (sortBy === "last_visit") {
      enriched.sort((a, b) => {
        if (!a.last_visit && !b.last_visit) return 0;
        if (!a.last_visit) return 1;
        if (!b.last_visit) return -1;
        return new Date(b.last_visit).getTime() - new Date(a.last_visit).getTime();
      });
    } else if (sortBy === "name") {
      enriched.sort((a, b) => (a.name_kana || "").localeCompare(b.name_kana || ""));
    } else if (sortBy === "created") {
      enriched.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }

    setTotalCount(enriched.length);
    setPatients(enriched);
    setLoading(false);
  }, [searchQuery, filterStatus, sortBy]);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  // 新規患者登録
  async function handleAddPatient() {
    if (!newForm.name_kanji || !newForm.name_kana) return;
    setSaving(true);

    const { error } = await supabase.from("patients").insert({
      name_kanji: newForm.name_kanji,
      name_kana: newForm.name_kana,
      date_of_birth: newForm.date_of_birth || null,
      sex: newForm.sex,
      phone: newForm.phone || null,
      insurance_type: newForm.insurance_type,
      patient_status: "active",
      is_new: true,
      burden_ratio: newForm.insurance_type === "自費" ? 1.0 : 0.3,
    });

    if (error) {
      alert("登録エラー: " + error.message);
    } else {
      setShowNewModal(false);
      setNewForm({ name_kanji: "", name_kana: "", date_of_birth: "", sex: "男", phone: "", insurance_type: "社保" });
      fetchPatients();
    }
    setSaving(false);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "-";
    try {
      const d = new Date(dateStr);
      return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
    } catch {
      return "-";
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="bg-sky-600 text-white w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold hover:bg-sky-700 transition-colors">🦷</Link>
            <div>
              <h1 className="text-xl font-bold text-gray-900">👤 患者管理</h1>
              <p className="text-xs text-gray-400">患者一覧・検索・情報管理</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowNewModal(true)}
              className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-700 transition-colors flex items-center gap-2"
            >
              ＋ 新規患者登録
            </button>
            <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">← ダッシュボード</Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* 検索・フィルターバー */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* 検索 */}
            <div className="flex-1 relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="氏名（漢字/カナ）、患者ID（P-XXXXX）、電話番号で検索..."
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200 focus:border-sky-400"
              />
            </div>

            {/* ステータスフィルター */}
            <div className="flex items-center gap-2">
              {[
                { value: "all", label: "全て" },
                { value: "active", label: "通院中" },
                { value: "inactive", label: "中断" },
                { value: "suspended", label: "休止" },
              ].map((f) => (
                <button
                  key={f.value}
                  onClick={() => setFilterStatus(f.value)}
                  className={`px-3 py-2 rounded-lg text-xs font-bold transition-all ${
                    filterStatus === f.value
                      ? "bg-sky-100 text-sky-700 border border-sky-300"
                      : "bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* ソート */}
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-xs font-bold text-gray-600 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="last_visit">最終来院日順</option>
              <option value="name">名前順（カナ）</option>
              <option value="created">登録日順</option>
            </select>
          </div>
        </div>

        {/* 件数表示 */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gray-500">
            {loading ? "読み込み中..." : `${totalCount}名の患者`}
          </p>
        </div>

        {/* 患者一覧 */}
        {loading ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="text-2xl mb-2">⏳</div>
            <p className="text-sm text-gray-400">読み込み中...</p>
          </div>
        ) : patients.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <div className="text-3xl mb-2">🔍</div>
            <p className="text-sm text-gray-500">該当する患者が見つかりません</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* テーブルヘッダー */}
            <div className="hidden md:grid grid-cols-[60px_1fr_100px_80px_120px_100px_100px_80px] gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-400 uppercase tracking-wider">
              <div></div>
              <div>氏名</div>
              <div>患者ID</div>
              <div>年齢</div>
              <div>電話番号</div>
              <div>保険</div>
              <div>最終来院</div>
              <div>状態</div>
            </div>

            {/* 患者行 */}
            {patients.map((p) => {
              const status = STATUS_CONFIG[p.patient_status || "active"] || STATUS_CONFIG.active;
              const initial = p.name_kanji ? p.name_kanji.charAt(0) : "?";
              const age = calcAge(p.date_of_birth);
              const sexLabel = p.sex === "男" || p.sex === "male" ? "♂" : p.sex === "女" || p.sex === "female" ? "♀" : "";

              return (
                <Link key={p.id} href={`/patients/${p.id}`} className="block">
                  <div className="grid grid-cols-1 md:grid-cols-[60px_1fr_100px_80px_120px_100px_100px_80px] gap-2 px-4 py-3 border-b border-gray-100 hover:bg-sky-50 transition-colors cursor-pointer items-center">
                    {/* アバター */}
                    <div className="flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center text-sm font-bold">
                        {initial}
                      </div>
                    </div>

                    {/* 氏名 */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-sm truncate">{p.name_kanji}</span>
                        {p.is_new && (
                          <span className="text-[9px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-bold flex-shrink-0">新患</span>
                        )}
                        {hasAllergies(p.allergies) && (
                          <span className="text-[9px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded font-bold flex-shrink-0">⚠ アレルギー</span>
                        )}
                      </div>
                      <div className="text-[11px] text-gray-400 truncate">{p.name_kana}</div>
                    </div>

                    {/* 患者ID */}
                    <div className="text-xs font-mono text-gray-500">{p.patient_number || "-"}</div>

                    {/* 年齢・性別 */}
                    <div className="text-xs text-gray-600">
                      {age} {sexLabel}
                    </div>

                    {/* 電話番号 */}
                    <div className="text-xs text-gray-500">{p.phone || "-"}</div>

                    {/* 保険 */}
                    <div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        p.insurance_type === "自費" ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                      }`}>
                        {p.insurance_type || "-"}
                      </span>
                    </div>

                    {/* 最終来院日 */}
                    <div className="text-xs text-gray-500">{formatDate(p.last_visit || null)}</div>

                    {/* ステータス */}
                    <div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${status.bg} ${status.color}`}>
                        {status.label}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </main>

      {/* 新規患者登録モーダル */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-900">＋ 新規患者登録</h2>
              <button onClick={() => setShowNewModal(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* 氏名 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">氏名（漢字）<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={newForm.name_kanji}
                    onChange={(e) => setNewForm({ ...newForm, name_kanji: e.target.value })}
                    placeholder="山田 太郎"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">氏名（カナ）<span className="text-red-500">*</span></label>
                  <input
                    type="text"
                    value={newForm.name_kana}
                    onChange={(e) => setNewForm({ ...newForm, name_kana: e.target.value })}
                    placeholder="ヤマダ タロウ"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
              </div>

              {/* 生年月日・性別 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">生年月日</label>
                  <input
                    type="date"
                    value={newForm.date_of_birth}
                    onChange={(e) => setNewForm({ ...newForm, date_of_birth: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">性別</label>
                  <select
                    value={newForm.sex}
                    onChange={(e) => setNewForm({ ...newForm, sex: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="男">男性</option>
                    <option value="女">女性</option>
                  </select>
                </div>
              </div>

              {/* 電話番号・保険 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">電話番号</label>
                  <input
                    type="tel"
                    value={newForm.phone}
                    onChange={(e) => setNewForm({ ...newForm, phone: e.target.value })}
                    placeholder="09012345678"
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 mb-1">保険種別</label>
                  <select
                    value={newForm.insurance_type}
                    onChange={(e) => setNewForm({ ...newForm, insurance_type: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                  >
                    <option value="社保">社保</option>
                    <option value="国保">国保</option>
                    <option value="後期">後期高齢</option>
                    <option value="自費">自費</option>
                    <option value="生活保護">生活保護</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-3">
              <button
                onClick={() => setShowNewModal(false)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                キャンセル
              </button>
              <button
                onClick={handleAddPatient}
                disabled={saving || !newForm.name_kanji || !newForm.name_kana}
                className="bg-sky-600 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {saving ? "登録中..." : "登録する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
