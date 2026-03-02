"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// タブの種類
type Tab = "clinic" | "units" | "staff" | "slots" | "facility";

// 型定義
type Clinic = {
  id: string;
  name: string;
  address: string;
  phone: string;
  postal_code: string;
  email: string;
  website: string;
};

type ClinicSettings = {
  id?: string;
  clinic_id?: string;
  morning_start: string;
  morning_end: string;
  afternoon_start: string;
  afternoon_end: string;
  slot_duration_min: number;
  closed_days: number[];
  max_patients_per_slot: number;
  clinic_code?: string;
  prefecture_code?: string;
};

type Unit = {
  id: string;
  unit_number: number;
  name: string;
  unit_type: string;
  default_doctor_id: string | null;
  is_active: boolean;
  sort_order: number;
};

type FacilityStandard = {
  id: string;
  code: string;
  name: string;
  category: string;
  level: number;
  description: string;
  requirements: Record<string, unknown>;
  is_registered: boolean;
  sort_order: number;
};

type FacilityBonus = {
  id: string;
  facility_code: string;
  target_kubun: string;
  bonus_points: number;
  bonus_type: string;
  condition: string;
};

type Staff = {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  license_number: string;
  is_active: boolean;
  color: string;
  sort_order: number;
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("clinic");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // ===== クリニック基本情報 =====
  const [clinicId, setClinicId] = useState<string>("");
  const [clinic, setClinic] = useState<Clinic>({
    id: "", name: "", address: "", phone: "", postal_code: "", email: "", website: "",
  });
  const [settings, setSettings] = useState<ClinicSettings>({
    morning_start: "09:00", morning_end: "12:00",
    afternoon_start: "13:00", afternoon_end: "18:00",
    slot_duration_min: 30, closed_days: [0], max_patients_per_slot: 3,
  });

  // ===== ユニット =====
  const [units, setUnits] = useState<Unit[]>([]);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnit, setNewUnit] = useState({ name: "", unit_type: "general" });

  // ===== スタッフ =====
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: "", role: "doctor", email: "", phone: "", license_number: "", color: "#0ea5e9" });
  const [facilities, setFacilities] = useState<FacilityStandard[]>([]);
  const [bonuses, setBonuses] = useState<FacilityBonus[]>([]);
  const [facilitySaving, setFacilitySaving] = useState(false);

  // ===== 初期データ取得 =====
  useEffect(() => {
    initializeData();
  }, []);

  async function initializeData() {
    // クリニック情報取得（なければ作成）
    let { data: clinics } = await supabase.from("clinics").select("*").limit(1);

    let currentClinicId: string;

    if (!clinics || clinics.length === 0) {
      const { data: newClinic } = await supabase
        .from("clinics")
        .insert({ name: "マイクリニック" })
        .select("*")
        .single();
      if (newClinic) {
        currentClinicId = newClinic.id;
        setClinic(newClinic);
      } else return;
    } else {
      currentClinicId = clinics[0].id;
      setClinic(clinics[0]);
    }
    setClinicId(currentClinicId);

    // クリニック設定取得（なければ作成）
    let { data: settingsData } = await supabase
      .from("clinic_settings")
      .select("*")
      .eq("clinic_id", currentClinicId)
      .limit(1);

    if (!settingsData || settingsData.length === 0) {
      const { data: newSettings } = await supabase
        .from("clinic_settings")
        .insert({ clinic_id: currentClinicId })
        .select("*")
        .single();
      if (newSettings) setSettings(newSettings);
    } else {
      setSettings(settingsData[0]);
    }

    // ユニット取得
    const { data: unitsData } = await supabase
      .from("units")
      .select("*")
      .eq("clinic_id", currentClinicId)
      .order("sort_order", { ascending: true });
    if (unitsData) setUnits(unitsData);

    // スタッフ取得
    const { data: staffData } = await supabase
      .from("staff")
      .select("*")
      .eq("clinic_id", currentClinicId)
      .order("sort_order", { ascending: true });
    if (staffData) setStaffList(staffData);

    // 施設基準取得
    const { data: facilityData } = await supabase
      .from("facility_standards")
      .select("*")
      .order("sort_order", { ascending: true });
    if (facilityData) setFacilities(facilityData as FacilityStandard[]);

    // 施設基準ボーナス取得
    const { data: bonusData } = await supabase
      .from("facility_bonus")
      .select("*")
      .eq("is_active", true);
    if (bonusData) setBonuses(bonusData as FacilityBonus[]);
  }

  // ===== 施設基準 ON/OFF =====
  async function toggleFacility(code: string, currentValue: boolean) {
    setFacilitySaving(true);
    await supabase.from("facility_standards").update({ is_registered: !currentValue }).eq("code", code);
    setFacilities(prev => prev.map(f => f.code === code ? { ...f, is_registered: !currentValue } : f));
    setFacilitySaving(false);
  }

  // 施設基準のカテゴリ名
  const categoryNames: Record<string, string> = {
    basic: "基本", safety: "医療安全", infection: "感染対策",
    management: "管理体制", home_care: "在宅", dx: "医療DX",
    prosth: "補綴", equipment: "設備", cooperation: "連携",
  };

  // 施設基準ごとの加算点数を取得
  function getBonusesForFacility(code: string) {
    return bonuses.filter(b => b.facility_code === code);
  }

  // 届出済み施設基準の加算合計（初診時）
  const registeredBonusTotal = facilities
    .filter(f => f.is_registered)
    .reduce((sum, f) => {
      const bs = getBonusesForFacility(f.code);
      const shoshinBonus = bs.find(b => b.target_kubun === "A000" && b.bonus_type === "add");
      return sum + (shoshinBonus?.bonus_points || 0);
    }, 0);

  // ===== 保存: クリニック基本情報 =====
  async function saveClinic() {
    setSaving(true);
    await supabase.from("clinics").update({
      name: clinic.name, address: clinic.address, phone: clinic.phone,
      postal_code: clinic.postal_code, email: clinic.email, website: clinic.website,
    }).eq("id", clinicId);

    await supabase.from("clinic_settings").update({
      morning_start: settings.morning_start, morning_end: settings.morning_end,
      afternoon_start: settings.afternoon_start, afternoon_end: settings.afternoon_end,
      slot_duration_min: settings.slot_duration_min,
      closed_days: settings.closed_days,
      max_patients_per_slot: settings.max_patients_per_slot,
      clinic_code: settings.clinic_code || "",
      prefecture_code: settings.prefecture_code || "",
    }).eq("clinic_id", clinicId);

    setSaveMsg("保存しました ✅");
    setTimeout(() => setSaveMsg(""), 2000);
    setSaving(false);
  }

  // ===== ユニット操作 =====
  async function addUnit() {
    const nextNumber = units.length + 1;
    const { data } = await supabase.from("units").insert({
      clinic_id: clinicId, unit_number: nextNumber,
      name: newUnit.name || `チェア${nextNumber}`,
      unit_type: newUnit.unit_type, sort_order: nextNumber, is_active: true,
    }).select("*").single();
    if (data) {
      setUnits([...units, data]);
      setNewUnit({ name: "", unit_type: "general" });
      setShowAddUnit(false);
    }
  }

  async function toggleUnit(unit: Unit) {
    await supabase.from("units").update({ is_active: !unit.is_active }).eq("id", unit.id);
    setUnits(units.map((u) => u.id === unit.id ? { ...u, is_active: !u.is_active } : u));
  }

  async function deleteUnit(unitId: string) {
    if (!confirm("このユニットを削除しますか？")) return;
    await supabase.from("units").delete().eq("id", unitId);
    setUnits(units.filter((u) => u.id !== unitId));
  }

  // ===== スタッフ操作 =====
  async function addStaff() {
    if (!newStaff.name) return;
    const { data } = await supabase.from("staff").insert({
      clinic_id: clinicId, name: newStaff.name, role: newStaff.role,
      email: newStaff.email || null, phone: newStaff.phone || null,
      license_number: newStaff.license_number || null,
      color: newStaff.color, is_active: true, sort_order: staffList.length + 1,
    }).select("*").single();
    if (data) {
      setStaffList([...staffList, data]);
      setNewStaff({ name: "", role: "doctor", email: "", phone: "", license_number: "", color: "#0ea5e9" });
      setShowAddStaff(false);
    }
  }

  async function toggleStaff(staff: Staff) {
    await supabase.from("staff").update({ is_active: !staff.is_active }).eq("id", staff.id);
    setStaffList(staffList.map((s) => s.id === staff.id ? { ...s, is_active: !s.is_active } : s));
  }

  async function deleteStaff(staffId: string) {
    if (!confirm("このスタッフを削除しますか？")) return;
    await supabase.from("staff").delete().eq("id", staffId);
    setStaffList(staffList.filter((s) => s.id !== staffId));
  }

  // 休診日トグル
  function toggleClosedDay(day: number) {
    const current = settings.closed_days || [];
    if (current.includes(day)) {
      setSettings({ ...settings, closed_days: current.filter((d) => d !== day) });
    } else {
      setSettings({ ...settings, closed_days: [...current, day] });
    }
  }

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const roleLabels: Record<string, string> = {
    doctor: "歯科医師", hygienist: "歯科衛生士", assistant: "歯科助手", receptionist: "受付",
  };
  const unitTypeLabels: Record<string, string> = {
    general: "一般", surgery: "外科", hygiene: "衛生士用", kids: "小児用",
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "clinic", label: "基本情報", icon: "🏥" },
    { key: "units", label: "ユニット", icon: "🪥" },
    { key: "staff", label: "スタッフ", icon: "👥" },
    { key: "slots", label: "予約枠", icon: "📅" },
    { key: "facility", label: "施設基準", icon: "📋" },
  ];

  // 外部ページへのリンク
  const externalLinks = [
    { href: "/settings/procedure-master", label: "処置マスタ", icon: "🍳", desc: "治療パターン・算定コード管理" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">⚙️ クリニック設定</h1>
          </div>
          {saveMsg && <span className="text-green-600 text-sm font-bold">{saveMsg}</span>}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4">
        {/* タブ */}
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors ${
                activeTab === tab.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* 処置マスタ管理リンク */}
        <div className="mb-4">
          <Link href="/settings/procedure-master" className="flex items-center gap-3 bg-gradient-to-r from-sky-50 to-blue-50 border border-sky-200 rounded-xl px-4 py-3 hover:border-sky-300 transition-colors group">
            <span className="text-lg">🦷</span>
            <div className="flex-1">
              <span className="font-bold text-sky-700 text-sm group-hover:text-sky-800">処置マスタ管理</span>
              <span className="text-[10px] text-sky-500 ml-2">処置→算定コード対応表の管理（AI連携・自動算定の基盤）</span>
            </div>
            <span className="text-sky-400 text-sm">→</span>
          </Link>
        </div>

        {/* ========== 基本情報タブ ========== */}
        {activeTab === "clinic" && (
          <div className="space-y-6">
            {/* クリニック情報 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">クリニック情報</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">クリニック名 <span className="text-red-500">*</span></label>
                  <input type="text" value={clinic.name} onChange={(e) => setClinic({ ...clinic, name: e.target.value })}
                    placeholder="〇〇歯科クリニック" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">郵便番号</label>
                    <input type="text" value={clinic.postal_code || ""} onChange={(e) => setClinic({ ...clinic, postal_code: e.target.value })}
                      placeholder="123-4567" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">電話番号</label>
                    <input type="tel" value={clinic.phone || ""} onChange={(e) => setClinic({ ...clinic, phone: e.target.value })}
                      placeholder="03-1234-5678" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">住所</label>
                  <input type="text" value={clinic.address || ""} onChange={(e) => setClinic({ ...clinic, address: e.target.value })}
                    placeholder="東京都〇〇区..." className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">メールアドレス</label>
                    <input type="email" value={clinic.email || ""} onChange={(e) => setClinic({ ...clinic, email: e.target.value })}
                      placeholder="info@clinic.com" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Webサイト</label>
                    <input type="url" value={clinic.website || ""} onChange={(e) => setClinic({ ...clinic, website: e.target.value })}
                      placeholder="https://clinic.com" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">医療機関コード <span className="text-xs text-gray-400">（レセ電用）</span></label>
                    <input type="text" value={settings.clinic_code || ""} onChange={(e) => setSettings({ ...settings, clinic_code: e.target.value })}
                      placeholder="3101471" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">都道府県コード <span className="text-xs text-gray-400">（レセ電用）</span></label>
                    <input type="text" value={settings.prefecture_code || ""} onChange={(e) => setSettings({ ...settings, prefecture_code: e.target.value })}
                      placeholder="23" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* 診療時間 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">診療時間</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">午前 開始</label>
                    <input type="time" value={settings.morning_start} onChange={(e) => setSettings({ ...settings, morning_start: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">午前 終了</label>
                    <input type="time" value={settings.morning_end} onChange={(e) => setSettings({ ...settings, morning_end: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">午後 開始</label>
                    <input type="time" value={settings.afternoon_start} onChange={(e) => setSettings({ ...settings, afternoon_start: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">午後 終了</label>
                    <input type="time" value={settings.afternoon_end} onChange={(e) => setSettings({ ...settings, afternoon_end: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
              </div>
            </div>

            {/* 休診日 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">休診日</h3>
              <div className="flex gap-2">
                {weekdays.map((day, idx) => (
                  <button
                    key={idx}
                    onClick={() => toggleClosedDay(idx)}
                    className={`w-12 h-12 rounded-xl text-sm font-bold transition-colors ${
                      (settings.closed_days || []).includes(idx)
                        ? "bg-red-100 text-red-600 border-2 border-red-300"
                        : "bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    {day}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">赤くなっている曜日が休診日です</p>
            </div>

            {/* 予約設定 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">予約設定</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">予約枠の時間（分）</label>
                  <select value={settings.slot_duration_min} onChange={(e) => setSettings({ ...settings, slot_duration_min: parseInt(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                    <option value={15}>15分</option>
                    <option value={20}>20分</option>
                    <option value={30}>30分</option>
                    <option value={60}>60分</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">1枠の受入上限（人）</label>
                  <select value={settings.max_patients_per_slot} onChange={(e) => setSettings({ ...settings, max_patients_per_slot: parseInt(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                      <option key={n} value={n}>{n}人</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* 保存ボタン */}
            <button onClick={saveClinic} disabled={saving}
              className="w-full bg-sky-600 text-white py-3 rounded-xl font-bold text-base hover:bg-sky-700 transition-colors disabled:opacity-50">
              {saving ? "保存中..." : "基本設定を保存する"}
            </button>
          </div>
        )}

        {/* ========== ユニットタブ ========== */}
        {activeTab === "units" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-900">ユニット（診察台）管理</h3>
                <p className="text-sm text-gray-500">稼働中: {units.filter((u) => u.is_active).length} / 全体: {units.length}</p>
              </div>
              <button onClick={() => setShowAddUnit(true)} className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-700">
                ＋ ユニット追加
              </button>
            </div>

            {units.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-4xl mb-3">🪥</p>
                <p className="text-gray-400 mb-1">ユニットが登録されていません</p>
                <p className="text-gray-300 text-sm">「＋ ユニット追加」から診察台を登録してください</p>
              </div>
            ) : (
              <div className="space-y-2">
                {units.map((unit) => (
                  <div key={unit.id} className={`bg-white rounded-xl border p-4 flex items-center justify-between ${unit.is_active ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${unit.is_active ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-400"}`}>
                        {unit.unit_number}
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{unit.name}</p>
                        <p className="text-xs text-gray-400">{unitTypeLabels[unit.unit_type] || unit.unit_type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleUnit(unit)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${unit.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {unit.is_active ? "稼働中" : "停止中"}
                      </button>
                      <button onClick={() => deleteUnit(unit.id)} className="text-gray-300 hover:text-red-500 text-sm">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ユニット追加モーダル */}
            {showAddUnit && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-2xl w-full max-w-sm p-5">
                  <h3 className="font-bold text-gray-900 text-lg mb-4">ユニットを追加</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">ユニット名</label>
                      <input type="text" value={newUnit.name} onChange={(e) => setNewUnit({ ...newUnit, name: e.target.value })}
                        placeholder={`チェア${units.length + 1}`} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">種類</label>
                      <select value={newUnit.unit_type} onChange={(e) => setNewUnit({ ...newUnit, unit_type: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                        <option value="general">一般</option>
                        <option value="surgery">外科</option>
                        <option value="hygiene">衛生士用</option>
                        <option value="kids">小児用</option>
                      </select>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => setShowAddUnit(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-lg font-bold">キャンセル</button>
                      <button onClick={addUnit} className="flex-1 bg-sky-600 text-white py-2.5 rounded-lg font-bold hover:bg-sky-700">追加</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========== スタッフタブ ========== */}
        {activeTab === "staff" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-gray-900">スタッフ管理</h3>
                <p className="text-sm text-gray-500">
                  Dr: {staffList.filter((s) => s.role === "doctor" && s.is_active).length}名 /
                  DH: {staffList.filter((s) => s.role === "hygienist" && s.is_active).length}名 /
                  受付: {staffList.filter((s) => s.role === "receptionist" && s.is_active).length}名
                </p>
              </div>
              <button onClick={() => setShowAddStaff(true)} className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-700">
                ＋ スタッフ追加
              </button>
            </div>

            {staffList.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-4xl mb-3">👥</p>
                <p className="text-gray-400 mb-1">スタッフが登録されていません</p>
                <p className="text-gray-300 text-sm">「＋ スタッフ追加」から登録してください</p>
              </div>
            ) : (
              <div className="space-y-2">
                {staffList.map((staff) => (
                  <div key={staff.id} className={`bg-white rounded-xl border p-4 flex items-center justify-between ${staff.is_active ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: staff.color || "#0ea5e9" }}>
                        {staff.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-gray-900">{staff.name}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                            staff.role === "doctor" ? "bg-blue-100 text-blue-700"
                            : staff.role === "hygienist" ? "bg-pink-100 text-pink-700"
                            : staff.role === "assistant" ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-100 text-gray-600"
                          }`}>
                            {roleLabels[staff.role] || staff.role}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">
                          {staff.phone || ""}{staff.phone && staff.email ? " / " : ""}{staff.email || ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleStaff(staff)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${staff.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {staff.is_active ? "在籍" : "退職"}
                      </button>
                      <button onClick={() => deleteStaff(staff.id)} className="text-gray-300 hover:text-red-500 text-sm">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* スタッフ追加モーダル */}
            {showAddStaff && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-2xl w-full max-w-md p-5">
                  <h3 className="font-bold text-gray-900 text-lg mb-4">スタッフを追加</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">氏名 <span className="text-red-500">*</span></label>
                      <input type="text" value={newStaff.name} onChange={(e) => setNewStaff({ ...newStaff, name: e.target.value })}
                        placeholder="山田 太郎" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">役割 <span className="text-red-500">*</span></label>
                      <select value={newStaff.role} onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                        <option value="doctor">歯科医師</option>
                        <option value="hygienist">歯科衛生士</option>
                        <option value="assistant">歯科助手</option>
                        <option value="receptionist">受付</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">電話番号</label>
                        <input type="tel" value={newStaff.phone} onChange={(e) => setNewStaff({ ...newStaff, phone: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">メール</label>
                        <input type="email" value={newStaff.email} onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                      </div>
                    </div>
                    {newStaff.role === "doctor" && (
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">歯科医師免許番号</label>
                        <input type="text" value={newStaff.license_number} onChange={(e) => setNewStaff({ ...newStaff, license_number: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">表示カラー</label>
                      <div className="flex gap-2">
                        {["#0ea5e9", "#8b5cf6", "#ec4899", "#f97316", "#22c55e", "#64748b"].map((c) => (
                          <button key={c} onClick={() => setNewStaff({ ...newStaff, color: c })}
                            className={`w-8 h-8 rounded-full transition-transform ${newStaff.color === c ? "ring-2 ring-offset-2 ring-gray-400 scale-110" : ""}`}
                            style={{ backgroundColor: c }} />
                        ))}
                      </div>
                    </div>
                    <div className="flex gap-3 pt-2">
                      <button onClick={() => setShowAddStaff(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-lg font-bold">キャンセル</button>
                      <button onClick={addStaff} className="flex-1 bg-sky-600 text-white py-2.5 rounded-lg font-bold hover:bg-sky-700">追加</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========== 予約枠タブ ========== */}
        {activeTab === "slots" && (
          <div>
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <h3 className="font-bold text-gray-900 mb-2">予約枠の設定</h3>
              <p className="text-sm text-gray-500 mb-4">
                基本情報タブで設定した内容が予約枠に反映されます。
              </p>
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-sky-600 font-bold">午前</p>
                    <p className="text-gray-900 font-bold">{settings.morning_start} 〜 {settings.morning_end}</p>
                  </div>
                  <div>
                    <p className="text-xs text-sky-600 font-bold">午後</p>
                    <p className="text-gray-900 font-bold">{settings.afternoon_start} 〜 {settings.afternoon_end}</p>
                  </div>
                  <div>
                    <p className="text-xs text-sky-600 font-bold">予約枠</p>
                    <p className="text-gray-900 font-bold">{settings.slot_duration_min}分単位</p>
                  </div>
                  <div>
                    <p className="text-xs text-sky-600 font-bold">1枠の上限</p>
                    <p className="text-gray-900 font-bold">{settings.max_patients_per_slot}人</p>
                  </div>
                </div>
              </div>
            </div>

            {/* 曜日ごとの設定一覧 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">曜日ごとの状況</h3>
              <div className="space-y-2">
                {weekdays.map((day, idx) => {
                  const isClosed = (settings.closed_days || []).includes(idx);
                  const activeUnits = units.filter((u) => u.is_active).length;
                  const activeDoctors = staffList.filter((s) => s.role === "doctor" && s.is_active).length;

                  return (
                    <div key={idx} className={`flex items-center justify-between p-3 rounded-lg ${isClosed ? "bg-red-50" : "bg-gray-50"}`}>
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${
                          isClosed ? "bg-red-200 text-red-700" : idx === 6 ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-700"
                        }`}>{day}</span>
                        <span className={`text-sm font-bold ${isClosed ? "text-red-600" : "text-gray-900"}`}>
                          {isClosed ? "休診日" : `${settings.morning_start}〜${settings.morning_end} / ${settings.afternoon_start}〜${settings.afternoon_end}`}
                        </span>
                      </div>
                      {!isClosed && (
                        <div className="flex items-center gap-3 text-xs text-gray-500">
                          <span>🪥 {activeUnits}台</span>
                          <span>👨‍⚕️ {activeDoctors}名</span>
                          <span>最大 {settings.max_patients_per_slot}人/枠</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ========== 施設基準タブ ========== */}
        {activeTab === "facility" && (
          <div className="space-y-6">
            {/* 概要カード */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-2">📋 施設基準の届出状況</h2>
              <p className="text-xs text-gray-400 mb-4">届出済みの施設基準に基づいて、auto-billingで加算点数が自動計算されます。</p>
              <div className="grid grid-cols-3 gap-4">
                <div className="bg-sky-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-sky-600">{facilities.filter(f => f.is_registered).length}</p>
                  <p className="text-xs text-gray-400">届出済み</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-gray-400">{facilities.filter(f => !f.is_registered).length}</p>
                  <p className="text-xs text-gray-400">未届出</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <p className="text-2xl font-bold text-emerald-600">+{registeredBonusTotal}点</p>
                  <p className="text-xs text-gray-400">初診時加算合計</p>
                </div>
              </div>
            </div>

            {/* カテゴリごとの施設基準一覧 */}
            {Object.entries(categoryNames).map(([catKey, catName]) => {
              const catFacilities = facilities.filter(f => f.category === catKey);
              if (catFacilities.length === 0) return null;
              return (
                <div key={catKey} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h3 className="text-sm font-bold text-gray-700">{catName}</h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {catFacilities.map(f => {
                      const fBonuses = getBonusesForFacility(f.code);
                      return (
                        <div key={f.id} className={`px-4 py-3 flex items-center gap-4 ${f.is_registered ? "bg-sky-50/30" : ""}`}>
                          <label className="flex items-center gap-3 flex-1 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={f.is_registered}
                              onChange={() => toggleFacility(f.code, f.is_registered)}
                              disabled={facilitySaving}
                              className="w-5 h-5 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                            />
                            <div className="flex-1">
                              <p className={`text-sm font-bold ${f.is_registered ? "text-gray-900" : "text-gray-400"}`}>
                                {f.name}
                                {f.level > 0 && <span className="ml-1 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Lv.{f.level}</span>}
                              </p>
                              <p className="text-[11px] text-gray-400 mt-0.5">{f.description}</p>
                            </div>
                          </label>
                          {fBonuses.length > 0 && (
                            <div className="text-right shrink-0">
                              {fBonuses.filter(b => b.bonus_type === "add").map((b, i) => (
                                <p key={i} className={`text-xs font-bold ${f.is_registered ? "text-sky-600" : "text-gray-300"}`}>
                                  +{b.bonus_points}点
                                  <span className="text-[10px] font-normal text-gray-400 ml-1">{b.condition}</span>
                                </p>
                              ))}
                              {fBonuses.filter(b => b.bonus_type === "unlock").map((b, i) => (
                                <p key={"u" + i} className={`text-[10px] ${f.is_registered ? "text-emerald-500" : "text-gray-300"}`}>
                                  🔓 {b.condition}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
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
