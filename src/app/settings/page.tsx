"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Tab = "clinic" | "units" | "staff" | "slots" | "facility" | "setup";

type Clinic = {
  id: string; name: string; address: string; phone: string;
  postal_code: string; email: string; website: string;
  clinic_code?: string; prefecture_code?: string;
  director_name?: string; doctor_license_number?: string;
  insurance_facility_number?: string; medical_subjects?: string;
};

type ClinicSettings = {
  id?: string; clinic_id?: string;
  morning_start: string; morning_end: string;
  afternoon_start: string; afternoon_end: string;
  slot_duration_min: number; closed_days: number[];
  max_patients_per_slot: number;
};

type Unit = {
  id: string; unit_number: number; name: string; unit_type: string;
  default_doctor_id: string | null; is_active: boolean; sort_order: number;
};

type FacilityBonus = {
  fee_code: string; points: number; label: string;
};

type FacilityStandard = {
  id: string; standard_code: string; standard_name: string;
  description: string; level: number; level_group: string;
  bonuses: FacilityBonus[]; is_registered: boolean; is_active: boolean;
};

type Staff = {
  id: string; name: string; role: string; email: string; phone: string;
  license_number: string; is_active: boolean; color: string; sort_order: number;
};

type ClinicBlock = {
  id: string;
  block_type: "date" | "weekly" | "daily" | "datetime";
  block_date: string | null;
  day_of_week: number | null;
  time_from: string | null;
  time_to: string | null;
  reason: string | null;
  is_active: boolean;
  created_at: string;
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("clinic");

  // === CP-7: UKEアップロード ===
  type UkePatient = {
    re: { patient_name: string; shinryo_yearmonth: string };
    ho: { insurer_no: string; visit_days: string; total_points: string }[];
    hs: { diagnosis_code: string; diagnosis_name: string; tooth_code: string }[];
    ss: { fee_code: string; procedure_name: string; points: number; count: string; matched: boolean }[];
    iy: { drug_code: string; drug_name: string; usage_amount: string; matched: boolean }[];
    to: { material_code: string; material_name: string; quantity: string; matched: boolean }[];
  };
  type PatternVariant = {
    variant_key: string;
    variant_name: string;
    fee_codes: string[];
    procedure_names: string[];
    variant_count: number;
  };
  type UkePattern = {
    key: string;
    diagnosis_codes: string[];
    diagnosis_names: string[];
    use_count: number;
    variants: PatternVariant[];
  };
  const [ukeDragging, setUkeDragging] = useState(false);
  const [ukeFile, setUkeFile] = useState<File | null>(null);
  const [ukeStep, setUkeStep] = useState<1 | 2 | 3 | 4>(1);
  const [ukeParsing, setUkeParsing] = useState(false);
  const [ukeNaming, setUkeNaming] = useState(false);
  const [ukeSaving, setUkeSaving] = useState(false);
  const [ukeSaveMsg, setUkeSaveMsg] = useState("");
  const [expandedPatient, setExpandedPatient] = useState<number | null>(null);
  const [ukePatients, setUkePatients] = useState<UkePatient[]>([]);
  const [ukeGrouped, setUkeGrouped] = useState<UkePattern[]>([]);
  const [ukeSummary, setUkeSummary] = useState<{ total_patients: number; total_ss: number; unmatched_total: number } | null>(null);
  const [ukeEditPatterns, setUkeEditPatterns] = useState<UkePattern[]>([]);
  const [ukeInsights, setUkeInsights] = useState<string[]>([]);
  const [ukeMissingClaims, setUkeMissingClaims] = useState<{ procedure_name: string; reason: string }[]>([]);
  const [feeSearchQuery, setFeeSearchQuery] = useState("");
  const [feeSearchResults, setFeeSearchResults] = useState<{ sub_code: string; name: string; points: number }[]>([]);
  const [feeSearching, setFeeSearching] = useState(false);
  const [editingPatternIdx, setEditingPatternIdx] = useState<number | null>(null);

  // === CP-8: 傾向ダッシュボード ===
  const [dashPatterns, setDashPatterns] = useState<{
    id: string;
    pattern_name: string;
    diagnosis_name: string;
    use_count: number;
    updated_at: string;
  }[]>([]);
  const [dashLoading, setDashLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // クリニック基本情報
  const [clinicId, setClinicId] = useState<string>("");
  const [clinic, setClinic] = useState<Clinic>({
    id: "", name: "", address: "", phone: "", postal_code: "", email: "", website: "",
  });
  const [settings, setSettings] = useState<ClinicSettings>({
    morning_start: "09:00", morning_end: "12:00",
    afternoon_start: "13:00", afternoon_end: "18:00",
    slot_duration_min: 30, closed_days: [0], max_patients_per_slot: 3,
  });

  // ユニット
  const [units, setUnits] = useState<Unit[]>([]);
  const [showAddUnit, setShowAddUnit] = useState(false);
  const [newUnit, setNewUnit] = useState({ name: "", unit_type: "general" });

  // スタッフ
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ name: "", role: "doctor", email: "", phone: "", license_number: "", color: "#0ea5e9" });
  const [facilities, setFacilities] = useState<FacilityStandard[]>([]);
  const [facilitySaving, setFacilitySaving] = useState(false);

  // 予約シャッター
  const [blocks, setBlocks] = useState<ClinicBlock[]>([]);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [newBlock, setNewBlock] = useState<{
    block_type: "date" | "weekly" | "daily" | "datetime";
    block_date: string;
    day_of_week: string;
    time_from: string;
    time_to: string;
    reason: string;
  }>({
    block_type: "date",
    block_date: "",
    day_of_week: "0",
    time_from: "",
    time_to: "",
    reason: "",
  });
  const [blockSaving, setBlockSaving] = useState(false);

  useEffect(() => { initializeData(); }, []);

  // CP-8: setupタブを開いた時にダッシュボードデータを取得
  useEffect(() => {
    if (activeTab !== "setup") return;
    setDashLoading(true);
    supabase
      .from("clinic_patterns")
      .select("id, pattern_name, diagnosis_name, use_count, updated_at")
      .eq("is_active", true)
      .order("use_count", { ascending: false })
      .then(({ data }) => {
        setDashPatterns(data ?? []);
        setDashLoading(false);
      });
  }, [activeTab]);

  async function initializeData() {
    // clinicsの取得・なければ自動作成
    let currentClinicId: string;
    try {
      let { data: clinics } = await supabase.from("clinics").select("*").limit(1);
      if (!clinics || clinics.length === 0) {
        const { data: newClinic } = await supabase.from("clinics").insert({ name: "マイクリニック" }).select("*").single();
        if (!newClinic) return;
        currentClinicId = newClinic.id;
        setClinic(newClinic);
      } else {
        currentClinicId = clinics[0].id;
        setClinic(clinics[0]);
      }
      setClinicId(currentClinicId);
    } catch (e) {
      console.error("clinics取得エラー", e);
      return;
    }

    // clinic_settingsの取得・なければ自動作成
    try {
      const { data: settingsData } = await supabase.from("clinic_settings").select("*").eq("clinic_id", currentClinicId).limit(1);
      if (!settingsData || settingsData.length === 0) {
        const { data: newSettings } = await supabase.from("clinic_settings").insert({ clinic_id: currentClinicId }).select("*").single();
        if (newSettings) setSettings(newSettings);
      } else {
        setSettings(settingsData[0]);
      }
    } catch (e) {
      console.error("clinic_settings取得エラー", e);
    }

    // ユニット取得
    try {
      const { data: unitsData } = await supabase.from("units").select("*").eq("clinic_id", currentClinicId).order("sort_order", { ascending: true });
      if (unitsData) setUnits(unitsData);
    } catch (e) {
      console.error("units取得エラー", e);
    }

    // スタッフ取得
    try {
      const { data: staffData } = await supabase.from("staff").select("*").eq("clinic_id", currentClinicId).order("sort_order", { ascending: true });
      if (staffData) setStaffList(staffData);
    } catch (e) {
      console.error("staff取得エラー", e);
    }

    // 施設基準取得
    try {
      const { data: facilityData } = await supabase.from("m_facility_standards").select("*").eq("is_active", true).order("level_group", { ascending: true }).order("level", { ascending: true });
      if (facilityData) setFacilities(facilityData as FacilityStandard[]);
    } catch (e) {
      console.error("m_facility_standards取得エラー", e);
    }

    // 予約シャッター取得
    try {
      const { data: blockData } = await supabase.from("clinic_blocks").select("*").order("created_at", { ascending: false });
      if (blockData) setBlocks(blockData as ClinicBlock[]);
    } catch (e) {
      console.error("clinic_blocks取得エラー", e);
    }
  }

  async function toggleFacility(standard_code: string, currentValue: boolean) {
    setFacilitySaving(true);
    try {
      await supabase.from("m_facility_standards").update({ is_registered: !currentValue }).eq("standard_code", standard_code);
      setFacilities(prev => prev.map(f => f.standard_code === standard_code ? { ...f, is_registered: !currentValue } : f));
    } catch (e) {
      console.error("施設基準更新エラー:", e);
    } finally {
      setFacilitySaving(false);
    }
  }

  // level_groupごとにグループ化して表示
  const facilityGroups = facilities.reduce((acc, f) => {
    const group = f.level_group || "その他";
    if (!acc[group]) acc[group] = [];
    acc[group].push(f);
    return acc;
  }, {} as Record<string, FacilityStandard[]>);

  const registeredBonusTotal = facilities
    .filter(f => f.is_registered)
    .reduce((sum, f) => {
      const shoshinBonus = (f.bonuses || []).find(b => b.fee_code === "A000-1");
      return sum + (shoshinBonus?.points || 0);
    }, 0);

  async function saveClinic() {
    setSaving(true);
    try {
      await supabase.from("clinics").update({
        name: clinic.name, address: clinic.address, phone: clinic.phone,
        postal_code: clinic.postal_code, email: clinic.email, website: clinic.website,
        clinic_code: clinic.clinic_code || "", prefecture_code: clinic.prefecture_code || "",
        director_name: clinic.director_name || "",
        doctor_license_number: clinic.doctor_license_number || "",
        insurance_facility_number: clinic.insurance_facility_number || "",
        medical_subjects: clinic.medical_subjects || "",
      }).eq("id", clinicId);
      await supabase.from("clinic_settings").update({
        morning_start: settings.morning_start, morning_end: settings.morning_end,
        afternoon_start: settings.afternoon_start, afternoon_end: settings.afternoon_end,
        slot_duration_min: settings.slot_duration_min, closed_days: settings.closed_days,
        max_patients_per_slot: settings.max_patients_per_slot,
      }).eq("clinic_id", clinicId);
      setSaveMsg("保存しました ✅");
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e) {
      console.error("クリニック情報保存エラー:", e);
      setSaveMsg("保存に失敗しました ❌");
      setTimeout(() => setSaveMsg(""), 2000);
    } finally {
      setSaving(false);
    }
  }

  async function addUnit() {
    const nextNumber = units.length + 1;
    try {
      const { data } = await supabase.from("units").insert({
        clinic_id: clinicId, unit_number: nextNumber,
        name: newUnit.name || `チェア${nextNumber}`,
        unit_type: newUnit.unit_type, sort_order: nextNumber, is_active: true,
      }).select("*").single();
      if (data) { setUnits([...units, data]); setNewUnit({ name: "", unit_type: "general" }); setShowAddUnit(false); }
    } catch (e) {
      console.error("ユニット追加エラー:", e);
    }
  }

  async function toggleUnit(unit: Unit) {
    try {
      await supabase.from("units").update({ is_active: !unit.is_active }).eq("id", unit.id);
      setUnits(units.map(u => u.id === unit.id ? { ...u, is_active: !u.is_active } : u));
    } catch (e) {
      console.error("ユニット更新エラー:", e);
    }
  }

  async function deleteUnit(unitId: string) {
    if (!confirm("このユニットを削除しますか？")) return;
    try {
      await supabase.from("units").delete().eq("id", unitId);
      setUnits(units.filter(u => u.id !== unitId));
    } catch (e) {
      console.error("ユニット削除エラー:", e);
    }
  }

  async function addStaff() {
    if (!newStaff.name) return;
    try {
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
    } catch (e) {
      console.error("スタッフ追加エラー:", e);
    }
  }

  async function toggleStaff(staff: Staff) {
    try {
      await supabase.from("staff").update({ is_active: !staff.is_active }).eq("id", staff.id);
      setStaffList(staffList.map(s => s.id === staff.id ? { ...s, is_active: !s.is_active } : s));
    } catch (e) {
      console.error("スタッフ更新エラー:", e);
    }
  }

  async function deleteStaff(staffId: string) {
    if (!confirm("このスタッフを削除しますか？")) return;
    try {
      await supabase.from("staff").delete().eq("id", staffId);
      setStaffList(staffList.filter(s => s.id !== staffId));
    } catch (e) {
      console.error("スタッフ削除エラー:", e);
    }
  }

  function toggleClosedDay(day: number) {
    const current = settings.closed_days || [];
    if (current.includes(day)) {
      setSettings({ ...settings, closed_days: current.filter(d => d !== day) });
    } else {
      setSettings({ ...settings, closed_days: [...current, day] });
    }
  }

  // ===== 予約シャッター =====
  async function addBlock() {
    if (!newBlock.block_type) return;
    setBlockSaving(true);
    const payload: Record<string, unknown> = {
      block_type: newBlock.block_type,
      reason: newBlock.reason || null,
      is_active: true,
    };
    if (newBlock.block_type === "date") {
      if (!newBlock.block_date) { setBlockSaving(false); return; }
      payload.block_date = newBlock.block_date;
    } else if (newBlock.block_type === "weekly") {
      payload.day_of_week = parseInt(newBlock.day_of_week);
      if (newBlock.time_from) payload.time_from = newBlock.time_from;
      if (newBlock.time_to) payload.time_to = newBlock.time_to;
    } else if (newBlock.block_type === "daily") {
      if (!newBlock.time_from || !newBlock.time_to) { setBlockSaving(false); return; }
      payload.time_from = newBlock.time_from;
      payload.time_to = newBlock.time_to;
    } else if (newBlock.block_type === "datetime") {
      if (!newBlock.block_date) { setBlockSaving(false); return; }
      payload.block_date = newBlock.block_date;
      if (newBlock.time_from) payload.time_from = newBlock.time_from;
      if (newBlock.time_to) payload.time_to = newBlock.time_to;
    }
    try {
      const { data } = await supabase.from("clinic_blocks").insert(payload).select("*").single();
      if (data) {
        setBlocks([data as ClinicBlock, ...blocks]);
        setNewBlock({ block_type: "date", block_date: "", day_of_week: "0", time_from: "", time_to: "", reason: "" });
        setShowAddBlock(false);
      }
    } catch (e) {
      console.error("シャッター追加エラー:", e);
    } finally {
      setBlockSaving(false);
    }
  }

  async function toggleBlock(block: ClinicBlock) {
    try {
      await supabase.from("clinic_blocks").update({ is_active: !block.is_active }).eq("id", block.id);
      setBlocks(blocks.map(b => b.id === block.id ? { ...b, is_active: !block.is_active } : b));
    } catch (e) {
      console.error("シャッター更新エラー:", e);
    }
  }

  async function deleteBlock(id: string) {
    if (!confirm("このシャッターを削除しますか？")) return;
    try {
      await supabase.from("clinic_blocks").delete().eq("id", id);
      setBlocks(blocks.filter(b => b.id !== id));
    } catch (e) {
      console.error("シャッター削除エラー:", e);
    }
  }

  function blockLabel(block: ClinicBlock): string {
    const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
    const timeStr = (block.time_from && block.time_to) ? ` ${block.time_from}〜${block.time_to}` : block.time_from ? ` ${block.time_from}〜` : "";
    if (block.block_type === "date") return `📅 ${block.block_date} 終日`;
    if (block.block_type === "weekly") return `🔁 毎週${weekdays[block.day_of_week ?? 0]}曜日${timeStr || "（終日）"}`;
    if (block.block_type === "daily") return `⏰ 毎日${timeStr}`;
    if (block.block_type === "datetime") return `📅 ${block.block_date}${timeStr}`;
    return "";
  }

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const roleLabels: Record<string, string> = {
    doctor: "歯科医師", hygienist: "歯科衛生士", assistant: "歯科助手", receptionist: "受付",
  };
  const unitTypeLabels: Record<string, string> = {
    general: "一般", surgery: "外科", hygiene: "衛生士用", kids: "小児用",
  };
  const blockTypeLabels: Record<string, string> = {
    date: "特定の日（終日）",
    weekly: "毎週特定の曜日",
    daily: "毎日特定の時間帯",
    datetime: "特定の日の特定の時間帯",
  };

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: "clinic", label: "基本情報", icon: "🏥" },
    { key: "units", label: "ユニット", icon: "🪥" },
    { key: "staff", label: "スタッフ", icon: "👥" },
    { key: "slots", label: "予約枠", icon: "📅" },
    { key: "facility", label: "施設基準", icon: "📋" },
    { key: "setup", label: "初期設定", icon: "📥" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
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
        <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 overflow-x-auto">
          {tabs.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-colors whitespace-nowrap ${activeTab === tab.key ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

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
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">クリニック情報</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">クリニック名 <span className="text-red-500">*</span></label>
                  <input type="text" value={clinic.name} onChange={e => setClinic({ ...clinic, name: e.target.value })}
                    placeholder="〇〇歯科クリニック" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">郵便番号</label>
                    <input type="text" value={clinic.postal_code || ""} onChange={e => setClinic({ ...clinic, postal_code: e.target.value })}
                      placeholder="123-4567" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">電話番号</label>
                    <input type="tel" value={clinic.phone || ""} onChange={e => setClinic({ ...clinic, phone: e.target.value })}
                      placeholder="03-1234-5678" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">住所</label>
                  <input type="text" value={clinic.address || ""} onChange={e => setClinic({ ...clinic, address: e.target.value })}
                    placeholder="東京都〇〇区..." className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">メールアドレス</label>
                    <input type="email" value={clinic.email || ""} onChange={e => setClinic({ ...clinic, email: e.target.value })}
                      placeholder="info@clinic.com" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">Webサイト</label>
                    <input type="url" value={clinic.website || ""} onChange={e => setClinic({ ...clinic, website: e.target.value })}
                      placeholder="https://clinic.com" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">医療機関コード <span className="text-xs text-gray-400">（レセ電用）</span></label>
                    <input type="text" value={clinic.clinic_code || ""} onChange={e => setClinic({ ...clinic, clinic_code: e.target.value })}
                      placeholder="3101471" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">都道府県コード <span className="text-xs text-gray-400">（レセ電用）</span></label>
                    <input type="text" value={clinic.prefecture_code || ""} onChange={e => setClinic({ ...clinic, prefecture_code: e.target.value })}
                      placeholder="23" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">保険医療機関指定番号 <span className="text-xs text-gray-400">（レセ電用・10桁）</span></label>
                    <input type="text" value={clinic.insurance_facility_number || ""} onChange={e => setClinic({ ...clinic, insurance_facility_number: e.target.value })}
                      placeholder="1234567890" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">標榜科目 <span className="text-xs text-gray-400">（レセ電用）</span></label>
                    <input type="text" value={clinic.medical_subjects || ""} onChange={e => setClinic({ ...clinic, medical_subjects: e.target.value })}
                      placeholder="歯科・小児歯科" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">院長名</label>
                    <input type="text" value={clinic.director_name || ""} onChange={e => setClinic({ ...clinic, director_name: e.target.value })}
                      placeholder="山田 太郎" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">保険医登録番号</label>
                    <input type="text" value={clinic.doctor_license_number || ""} onChange={e => setClinic({ ...clinic, doctor_license_number: e.target.value })}
                      placeholder="第123456号" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">診療時間</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">午前 開始</label>
                    <input type="time" value={settings.morning_start} onChange={e => setSettings({ ...settings, morning_start: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">午前 終了</label>
                    <input type="time" value={settings.morning_end} onChange={e => setSettings({ ...settings, morning_end: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">午後 開始</label>
                    <input type="time" value={settings.afternoon_start} onChange={e => setSettings({ ...settings, afternoon_start: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">午後 終了</label>
                    <input type="time" value={settings.afternoon_end} onChange={e => setSettings({ ...settings, afternoon_end: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">休診日</h3>
              <div className="flex gap-2">
                {weekdays.map((day, idx) => (
                  <button key={idx} onClick={() => toggleClosedDay(idx)}
                    className={`w-12 h-12 rounded-xl text-sm font-bold transition-colors ${(settings.closed_days || []).includes(idx) ? "bg-red-100 text-red-600 border-2 border-red-300" : "bg-gray-50 text-gray-700 border border-gray-200 hover:bg-gray-100"}`}>
                    {day}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-400 mt-2">赤くなっている曜日が休診日です</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">予約設定</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">予約枠の時間（分）</label>
                  <select value={settings.slot_duration_min} onChange={e => setSettings({ ...settings, slot_duration_min: parseInt(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                    <option value={15}>15分</option><option value={20}>20分</option>
                    <option value={30}>30分</option><option value={60}>60分</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">1枠の受入上限（人）</label>
                  <select value={settings.max_patients_per_slot} onChange={e => setSettings({ ...settings, max_patients_per_slot: parseInt(e.target.value) })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                    {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n}人</option>)}
                  </select>
                </div>
              </div>
            </div>

            <button onClick={saveClinic} disabled={saving}
              className="w-full bg-sky-600 text-white py-3 rounded-xl font-bold text-base hover:bg-sky-700 disabled:opacity-50">
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
                <p className="text-sm text-gray-500">稼働中: {units.filter(u => u.is_active).length} / 全体: {units.length}</p>
              </div>
              <button onClick={() => setShowAddUnit(true)} className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-700">＋ ユニット追加</button>
            </div>
            {units.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-4xl mb-3">🪥</p>
                <p className="text-gray-400 mb-1">ユニットが登録されていません</p>
              </div>
            ) : (
              <div className="space-y-2">
                {units.map(unit => (
                  <div key={unit.id} className={`bg-white rounded-xl border p-4 flex items-center justify-between ${unit.is_active ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${unit.is_active ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-400"}`}>{unit.unit_number}</div>
                      <div>
                        <p className="font-bold text-gray-900">{unit.name}</p>
                        <p className="text-xs text-gray-400">{unitTypeLabels[unit.unit_type] || unit.unit_type}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleUnit(unit)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${unit.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {unit.is_active ? "稼働中" : "停止中"}
                      </button>
                      <button onClick={() => deleteUnit(unit.id)} className="text-gray-300 hover:text-red-500 text-sm">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showAddUnit && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-2xl w-full max-w-sm p-5">
                  <h3 className="font-bold text-gray-900 text-lg mb-4">ユニットを追加</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">ユニット名</label>
                      <input type="text" value={newUnit.name} onChange={e => setNewUnit({ ...newUnit, name: e.target.value })}
                        placeholder={`チェア${units.length + 1}`} className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">種類</label>
                      <select value={newUnit.unit_type} onChange={e => setNewUnit({ ...newUnit, unit_type: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                        <option value="general">一般</option><option value="surgery">外科</option>
                        <option value="hygiene">衛生士用</option><option value="kids">小児用</option>
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
                  Dr: {staffList.filter(s => s.role === "doctor" && s.is_active).length}名 /
                  DH: {staffList.filter(s => s.role === "hygienist" && s.is_active).length}名 /
                  受付: {staffList.filter(s => s.role === "receptionist" && s.is_active).length}名
                </p>
              </div>
              <button onClick={() => setShowAddStaff(true)} className="bg-sky-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-700">＋ スタッフ追加</button>
            </div>
            {staffList.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
                <p className="text-4xl mb-3">👥</p>
                <p className="text-gray-400 mb-1">スタッフが登録されていません</p>
              </div>
            ) : (
              <div className="space-y-2">
                {staffList.map(staff => (
                  <div key={staff.id} className={`bg-white rounded-xl border p-4 flex items-center justify-between ${staff.is_active ? "border-gray-200" : "border-gray-100 opacity-60"}`}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold" style={{ backgroundColor: staff.color || "#0ea5e9" }}>
                        {staff.name.charAt(0)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-gray-900">{staff.name}</p>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${staff.role === "doctor" ? "bg-blue-100 text-blue-700" : staff.role === "hygienist" ? "bg-pink-100 text-pink-700" : staff.role === "assistant" ? "bg-yellow-100 text-yellow-700" : "bg-gray-100 text-gray-600"}`}>
                            {roleLabels[staff.role] || staff.role}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400">{staff.phone || ""}{staff.phone && staff.email ? " / " : ""}{staff.email || ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => toggleStaff(staff)} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${staff.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {staff.is_active ? "在籍" : "退職"}
                      </button>
                      <button onClick={() => deleteStaff(staff.id)} className="text-gray-300 hover:text-red-500 text-sm">🗑</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {showAddStaff && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-2xl w-full max-w-md p-5">
                  <h3 className="font-bold text-gray-900 text-lg mb-4">スタッフを追加</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">氏名 <span className="text-red-500">*</span></label>
                      <input type="text" value={newStaff.name} onChange={e => setNewStaff({ ...newStaff, name: e.target.value })}
                        placeholder="山田 太郎" className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">役割 <span className="text-red-500">*</span></label>
                      <select value={newStaff.role} onChange={e => setNewStaff({ ...newStaff, role: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400 bg-white">
                        <option value="doctor">歯科医師</option><option value="hygienist">歯科衛生士</option>
                        <option value="assistant">歯科助手</option><option value="receptionist">受付</option>
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">電話番号</label>
                        <input type="tel" value={newStaff.phone} onChange={e => setNewStaff({ ...newStaff, phone: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">メール</label>
                        <input type="email" value={newStaff.email} onChange={e => setNewStaff({ ...newStaff, email: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                      </div>
                    </div>
                    {newStaff.role === "doctor" && (
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-1">歯科医師免許番号</label>
                        <input type="text" value={newStaff.license_number} onChange={e => setNewStaff({ ...newStaff, license_number: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-sky-400" />
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-1">表示カラー</label>
                      <div className="flex gap-2">
                        {["#0ea5e9","#8b5cf6","#ec4899","#f97316","#22c55e","#64748b"].map(c => (
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
              <p className="text-sm text-gray-500 mb-4">基本情報タブで設定した内容が予約枠に反映されます。</p>
              <div className="bg-sky-50 border border-sky-200 rounded-lg p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div><p className="text-xs text-sky-600 font-bold">午前</p><p className="text-gray-900 font-bold">{settings.morning_start} 〜 {settings.morning_end}</p></div>
                  <div><p className="text-xs text-sky-600 font-bold">午後</p><p className="text-gray-900 font-bold">{settings.afternoon_start} 〜 {settings.afternoon_end}</p></div>
                  <div><p className="text-xs text-sky-600 font-bold">予約枠</p><p className="text-gray-900 font-bold">{settings.slot_duration_min}分単位</p></div>
                  <div><p className="text-xs text-sky-600 font-bold">1枠の上限</p><p className="text-gray-900 font-bold">{settings.max_patients_per_slot}人</p></div>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-bold text-gray-900 mb-4">曜日ごとの状況</h3>
              <div className="space-y-2">
                {weekdays.map((day, idx) => {
                  const isClosed = (settings.closed_days || []).includes(idx);
                  const activeUnits = units.filter(u => u.is_active).length;
                  const activeDoctors = staffList.filter(s => s.role === "doctor" && s.is_active).length;
                  return (
                    <div key={idx} className={`flex items-center justify-between p-3 rounded-lg ${isClosed ? "bg-red-50" : "bg-gray-50"}`}>
                      <div className="flex items-center gap-3">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold ${isClosed ? "bg-red-200 text-red-700" : idx === 6 ? "bg-blue-100 text-blue-700" : "bg-gray-200 text-gray-700"}`}>{day}</span>
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

            {/* 予約シャッター */}
            <div className="space-y-4 mt-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-bold text-gray-900">🚫 予約シャッター</h3>
                <button onClick={() => setShowAddBlock(true)}
                  className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-red-600">
                  ＋ ブロックを追加
                </button>
              </div>
              <p className="text-xs text-gray-400 mb-4">設定したブロックは患者の予約画面に反映され、その時間帯は選択できなくなります。</p>

              {/* ブロック一覧 */}
              {blocks.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-3xl mb-3">📅</p>
                  <p className="text-sm text-gray-400">ブロックは設定されていません</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {blocks.map(block => (
                    <div key={block.id} className={`flex items-center justify-between p-4 rounded-xl border-2 ${block.is_active ? "border-red-200 bg-red-50" : "border-gray-100 bg-gray-50 opacity-60"}`}>
                      <div className="flex items-start gap-3">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${block.is_active ? "bg-red-200 text-red-700" : "bg-gray-200 text-gray-500"}`}>
                          {block.is_active ? "有効" : "無効"}
                        </span>
                        <div>
                          <p className="text-sm font-bold text-gray-800">{blockLabel(block)}</p>
                          {block.reason && <p className="text-xs text-gray-400 mt-0.5">理由: {block.reason}</p>}
                          <p className="text-[10px] text-gray-300 mt-0.5">{blockTypeLabels[block.block_type]}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => toggleBlock(block)}
                          className={`text-xs font-bold px-3 py-1.5 rounded-lg ${block.is_active ? "bg-gray-100 text-gray-500 hover:bg-gray-200" : "bg-green-100 text-green-600 hover:bg-green-200"}`}>
                          {block.is_active ? "無効化" : "有効化"}
                        </button>
                        <button onClick={() => deleteBlock(block.id)} className="text-gray-300 hover:text-red-500 text-sm">🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 説明カード */}
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-xs font-bold text-amber-700 mb-2">📋 ブロックパターンの説明</p>
              <div className="space-y-1.5 text-xs text-amber-600">
                <p><span className="font-bold">特定の日（終日）</span> — 例: 年末年始・院内研修日など</p>
                <p><span className="font-bold">毎週特定の曜日</span> — 例: 毎週水曜午後・毎週日曜終日など</p>
                <p><span className="font-bold">毎日特定の時間帯</span> — 例: 毎日昼休み12:00-13:00など</p>
                <p><span className="font-bold">特定の日の特定の時間帯</span> — 例: 3/20の午後のみ休診など</p>
              </div>
            </div>
          </div>
          </div>
        )}

        {activeTab === "facility" && (
          <div className="space-y-6">
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
            {Object.entries(facilityGroups).map(([groupName, groupFacilities]) => (
              <div key={groupName} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                  <h3 className="text-sm font-bold text-gray-700">{groupName}</h3>
                </div>
                <div className="divide-y divide-gray-100">
                  {groupFacilities.map(f => (
                    <div key={f.id} className={`px-4 py-3 flex items-center gap-4 ${f.is_registered ? "bg-sky-50/30" : ""}`}>
                      <label className="flex items-center gap-3 flex-1 cursor-pointer">
                        <input type="checkbox" checked={f.is_registered} onChange={() => toggleFacility(f.standard_code, f.is_registered)}
                          disabled={facilitySaving} className="w-5 h-5 rounded border-gray-300 text-sky-600 focus:ring-sky-500" />
                        <div className="flex-1">
                          <p className={`text-sm font-bold ${f.is_registered ? "text-gray-900" : "text-gray-400"}`}>
                            {f.standard_name}
                            {f.level > 1 && <span className="ml-1 text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Lv.{f.level}</span>}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">{f.description}</p>
                        </div>
                      </label>
                      {(f.bonuses || []).length > 0 && (
                        <div className="text-right shrink-0">
                          {(f.bonuses || []).map((b, i) => (
                            <p key={i} className={`text-xs font-bold ${f.is_registered ? "text-sky-600" : "text-gray-300"}`}>
                              +{b.points}点<span className="text-[10px] font-normal text-gray-400 ml-1">{b.label}</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === "setup" && (
          <div className="space-y-6">

            {/* ===== ダッシュボード ===== */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-bold text-gray-900 mb-4">📊 パターン登録状況</h2>
              {dashLoading ? (
                <p className="text-sm text-gray-400 text-center py-4">読み込み中...</p>
              ) : dashPatterns.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-3xl mb-2">📭</p>
                  <p className="text-sm text-gray-400">まだパターンが登録されていません</p>
                  <p className="text-xs text-gray-300 mt-1">UKEファイルをアップロードして診療パターンを学習させましょう</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-sky-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-sky-600">{dashPatterns.length}</p>
                      <p className="text-xs text-gray-400">登録済みパターン数</p>
                    </div>
                    <div className="bg-emerald-50 rounded-lg p-3 text-center">
                      <p className="text-2xl font-bold text-emerald-600">{dashPatterns.reduce((sum, p) => sum + p.use_count, 0)}</p>
                      <p className="text-xs text-gray-400">総算定回数</p>
                    </div>
                  </div>
                  <p className="text-xs font-bold text-gray-600 mb-2">🏆 よく使うパターン TOP5</p>
                  <div className="space-y-2">
                    {dashPatterns.slice(0, 5).map((p, i) => (
                      <div key={p.id} className="flex items-center gap-3">
                        <span className="text-xs font-bold w-5 text-center">
                          {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{p.pattern_name}</p>
                          <p className="text-xs text-gray-400 truncate">{p.diagnosis_name}</p>
                        </div>
                        <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full shrink-0">{p.use_count}回</span>
                      </div>
                    ))}
                  </div>
                  {dashPatterns[0]?.updated_at && (
                    <p className="text-xs text-gray-300 mt-4 text-right">最終更新: {new Date(dashPatterns[0].updated_at).toLocaleDateString("ja-JP")}</p>
                  )}
                </>
              )}
            </div>

            {/* ===== ステップインジケーター ===== */}
            <div className="flex items-center gap-2">
              {[
                { n: 1, label: "アップロード" },
                { n: 2, label: "データ確認" },
                { n: 3, label: "分析" },
                { n: 4, label: "保存" },
              ].map((s, i, arr) => (
                <div key={s.n} className="flex items-center gap-2 flex-1">
                  <div className={`flex items-center gap-1.5 ${ukeStep >= s.n ? "text-sky-600" : "text-gray-300"}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${ukeStep >= s.n ? "bg-sky-600 text-white" : "bg-gray-200 text-gray-400"}`}>{s.n}</div>
                    <span className="text-xs font-bold whitespace-nowrap">{s.label}</span>
                  </div>
                  {i < arr.length - 1 && <div className={`flex-1 h-0.5 ${ukeStep > s.n ? "bg-sky-400" : "bg-gray-200"}`} />}
                </div>
              ))}
            </div>

            {/* ===== ステップ1: アップロード ===== */}
            {ukeStep === 1 && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-lg font-bold text-gray-900 mb-1">📥 UKEファイルをアップロード</h2>
                <p className="text-xs text-gray-400 mb-4">
                  支払基金・国保連から返ってきたUKEファイルをアップロードすると、<br />
                  過去の診療パターンを自動で学習してclinic_patternsに登録します。<br />
                  何回でもアップロードでき、アップロードするたびにuse_countが加算されます。
                </p>
                <div
                  onDragOver={e => { e.preventDefault(); setUkeDragging(true); }}
                  onDragLeave={() => setUkeDragging(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setUkeDragging(false);
                    const dropped = e.dataTransfer.files[0];
                    if (dropped) setUkeFile(dropped);
                  }}
                  className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors cursor-pointer ${ukeDragging ? "border-sky-400 bg-sky-50" : "border-gray-300 hover:border-sky-300 hover:bg-sky-50/30"}`}
                  onClick={() => document.getElementById("uke-file-input")?.click()}
                >
                  <p className="text-3xl mb-2">📂</p>
                  {ukeFile ? (
                    <p className="text-sm font-bold text-sky-700">{ukeFile.name}</p>
                  ) : (
                    <>
                      <p className="text-sm font-bold text-gray-600">UKEファイルをドラッグ&ドロップ</p>
                      <p className="text-xs text-gray-400 mt-1">またはクリックして選択（.UKE / Shift-JIS）</p>
                    </>
                  )}
                  <input id="uke-file-input" type="file" accept=".uke,.UKE" className="hidden"
                    onChange={e => { const picked = e.target.files?.[0]; if (picked) setUkeFile(picked); }} />
                </div>
                {ukeFile && (
                  <button
                    onClick={async () => {
                      setUkeParsing(true);
                      setUkeSaveMsg("");
                      try {
                        const fd = new FormData();
                        fd.append("file", ukeFile);
                        const res = await fetch("/api/analyze-uke?step=parse", { method: "POST", body: fd });
                        const json = await res.json();
                        if (!json.success) throw new Error(json.error || "パース失敗");
                        setUkePatients(json.matched_patients);
                        setUkeGrouped(json.grouped_patterns);
                        setUkeSummary(json.matched_summary);
                        setUkeStep(2);
                      } catch (e) {
                        setUkeSaveMsg(`❌ エラー: ${String(e)}`);
                      } finally {
                        setUkeParsing(false);
                      }
                    }}
                    disabled={ukeParsing}
                    className="mt-4 w-full bg-sky-600 text-white py-3 rounded-xl font-bold hover:bg-sky-700 disabled:opacity-50 transition-colors"
                  >
                    {ukeParsing ? "🔄 読み込み中..." : "📂 データを読み込む"}
                  </button>
                )}
                {ukeSaveMsg && <p className="mt-3 text-sm text-center font-bold text-red-500">{ukeSaveMsg}</p>}
              </div>
            )}

            {/* ===== ステップ2: 全患者データ確認 ===== */}
            {ukeStep === 2 && ukeSummary && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-bold text-gray-900">📋 レセプトデータ確認</h2>
                    <div className="flex gap-2 text-xs">
                      <span className="bg-sky-100 text-sky-700 px-2 py-1 rounded-full font-bold">{ukeSummary.total_patients}名</span>
                      <span className="bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full font-bold">{ukeGrouped.length}パターン検出</span>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                    {ukePatients.map((p, i) => {
                      const totalPoints = p.ho.reduce((s, h) => s + Number(h.total_points || 0), 0);
                      const visitDays = p.ho.reduce((s, h) => s + Number(h.visit_days || 0), 0);
                      const isExpanded = expandedPatient === i;
                      return (
                        <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                          <button
                            onClick={() => setExpandedPatient(isExpanded ? null : i)}
                            className="w-full px-4 py-3 flex items-center justify-between bg-gray-50 hover:bg-gray-100 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <span className="text-xs text-gray-400 font-mono w-8">#{i + 1}</span>
                              <div className="text-left">
                                <p className="text-sm font-bold text-gray-900">
                                  {p.hs.map(h => h.diagnosis_name).filter(Boolean).slice(0, 2).join("・") || "傷病名なし"}
                                </p>
                                <p className="text-xs text-gray-400">
                                  {visitDays}日・{totalPoints}点
                                </p>
                              </div>
                            </div>
                            <span className="text-gray-400 text-xs">{isExpanded ? "▲" : "▼"}</span>
                          </button>
                          {isExpanded && (
                            <div className="px-4 py-3 space-y-3 bg-white">
                              {/* 傷病名 */}
                              {p.hs.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold text-gray-500 mb-1">🦷 傷病名</p>
                                  <div className="flex flex-wrap gap-1">
                                    {p.hs.map((h, j) => (
                                      <span key={j} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                                        {h.tooth_code ? `${h.tooth_code}番 ` : ""}{h.diagnosis_name || h.diagnosis_code}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* 処置 */}
                              {p.ss.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold text-gray-500 mb-1">⚡ 処置（{p.ss.length}件）</p>
                                  <div className="space-y-1">
                                    {p.ss.map((s, j) => (
                                      <div key={j} className="flex items-center justify-between text-xs">
                                        <span className={`flex-1 ${s.matched ? "text-gray-700" : "text-amber-600"}`}>
                                          {s.matched ? "" : "⚠️"}{s.procedure_name || s.fee_code}
                                        </span>
                                        <span className="text-gray-400 ml-2">{s.points}点×{s.count}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* 薬剤 */}
                              {p.iy.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold text-gray-500 mb-1">💊 薬剤（{p.iy.length}件）</p>
                                  <div className="flex flex-wrap gap-1">
                                    {p.iy.map((d, j) => (
                                      <span key={j} className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full">
                                        {d.drug_name || d.drug_code} {d.usage_amount}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              {/* 特定器材 */}
                              {p.to.length > 0 && (
                                <div>
                                  <p className="text-xs font-bold text-gray-500 mb-1">🔧 特定器材（{p.to.length}件）</p>
                                  <div className="flex flex-wrap gap-1">
                                    {p.to.map((t, j) => (
                                      <span key={j} className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full">
                                        {t.material_name || t.material_code} {t.quantity}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => { setUkeStep(1); setUkeFile(null); }} className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200">やり直す</button>
                  <button
                    onClick={async () => {
                      setUkeNaming(true);
                      setUkeSaveMsg("");
                      try {
                        const res = await fetch("/api/analyze-uke?step=name", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ grouped_patterns: ukeGrouped }),
                        });
                        const json = await res.json();
                        if (!json.success) throw new Error(json.error || "命名失敗");
                        setUkeEditPatterns(json.named_patterns);
                        setUkeInsights(json.insights || []);
                        setUkeMissingClaims(json.missing_claims || []);
                        setUkeStep(3);
                      } catch (e) {
                        setUkeSaveMsg(`❌ エラー: ${String(e)}`);
                      } finally {
                        setUkeNaming(false);
                      }
                    }}
                    disabled={ukeNaming}
                    className="flex-1 bg-sky-600 text-white py-3 rounded-xl font-bold hover:bg-sky-700 disabled:opacity-50 transition-colors"
                  >
                    {ukeNaming ? "🔄 AI分析中（少々お待ちください）..." : "🤖 分析開始"}
                  </button>
                </div>
                {ukeSaveMsg && <p className="text-sm text-center font-bold text-red-500">{ukeSaveMsg}</p>}
              </div>
            )}

            {/* ===== ステップ3: 分析結果（variant設計） ===== */}
            {ukeStep === 3 && (
              <div className="space-y-4">
                {/* インサイト */}
                {ukeInsights.length > 0 && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <p className="text-sm font-bold text-gray-700 mb-2">💡 気づき・改善提案</p>
                    <ul className="space-y-1">
                      {ukeInsights.map((insight, i) => (
                        <li key={i} className="text-xs text-gray-600">• {insight}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* 算定漏れ候補 */}
                {ukeMissingClaims.length > 0 && (
                  <div className="bg-white rounded-xl border border-amber-200 p-4">
                    <p className="text-sm font-bold text-amber-700 mb-2">⚠️ 算定漏れ候補</p>
                    <div className="space-y-2">
                      {ukeMissingClaims.map((m, i) => (
                        <div key={i}>
                          <p className="text-sm font-bold text-gray-900">{m.procedure_name}</p>
                          <p className="text-xs text-gray-400">{m.reason}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* パターン一覧（傷病名単位・variant表示） */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h3 className="text-sm font-bold text-gray-700">🦷 検出パターン（{ukeEditPatterns.length}件）</h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {ukeEditPatterns.map((p, i) => (
                      <div key={i} className="px-4 py-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-bold text-gray-900">{p.diagnosis_names.join("・")}</p>
                          <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">計{p.use_count}回</span>
                        </div>
                        <div className="space-y-1">
                          {p.variants.map((v, j) => (
                            <div key={j} className={`rounded-lg px-3 py-2 ${j === 0 ? "bg-sky-50 border border-sky-200" : "bg-gray-50"}`}>
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-gray-700">
                                  {j === 0 && <span className="text-sky-600 mr-1">★</span>}
                                  {v.variant_name.length > 40 ? v.variant_name.slice(0, 40) + "..." : v.variant_name}
                                </span>
                                <span className="text-xs text-gray-400 shrink-0 ml-2">{v.variant_count}回</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setUkeStep(2)} className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200">戻る</button>
                  <button onClick={() => setUkeStep(4)} className="flex-1 bg-sky-600 text-white py-3 rounded-xl font-bold hover:bg-sky-700">✏️ 編集・保存へ</button>
                </div>
              </div>
            )}

            {/* ===== ステップ4: 編集・保存（variant設計） ===== */}
            {ukeStep === 4 && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <h3 className="text-sm font-bold text-gray-700">✏️ パターン編集（{ukeEditPatterns.length}件）</h3>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {ukeEditPatterns.map((p, pi) => (
                      <div key={pi} className="px-4 py-4">
                        {/* 傷病名（パターンの見出し） */}
                        <div className="flex items-center justify-between mb-3">
                          <p className="text-sm font-bold text-gray-900">{p.diagnosis_names.join("・")}</p>
                          <span className="text-xs bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">計{p.use_count}回</span>
                        </div>
                        {/* バリエーション一覧（編集可能） */}
                        <div className="space-y-3">
                          {p.variants.map((v, vi) => (
                            <div key={vi} className={`rounded-lg border p-3 ${vi === 0 ? "border-sky-200 bg-sky-50" : "border-gray-200 bg-gray-50"}`}>
                              <div className="flex items-center gap-2 mb-2">
                                {vi === 0 && <span className="text-xs bg-sky-600 text-white px-2 py-0.5 rounded-full">★最多</span>}
                                <span className="text-xs text-gray-500">{v.variant_count}回</span>
                              </div>
                              {/* 処置一覧（削除可能） */}
                              <div className="space-y-1 mb-2">
                                {v.procedure_names.map((proc, j) => (
                                  <div key={j} className="flex items-center justify-between bg-white rounded px-2 py-1">
                                    <span className="text-xs text-gray-700">{proc}</span>
                                    <button
                                      onClick={() => {
                                        const updated = [...ukeEditPatterns];
                                        const updatedVariants = [...updated[pi].variants];
                                        updatedVariants[vi] = {
                                          ...updatedVariants[vi],
                                          procedure_names: updatedVariants[vi].procedure_names.filter((_, k) => k !== j),
                                          fee_codes: updatedVariants[vi].fee_codes.filter((_, k) => k !== j),
                                          variant_name: updatedVariants[vi].procedure_names.filter((_, k) => k !== j).join("・"),
                                        };
                                        updated[pi] = { ...updated[pi], variants: updatedVariants };
                                        setUkeEditPatterns(updated);
                                      }}
                                      className="text-red-400 hover:text-red-600 text-xs ml-2"
                                    >✕</button>
                                  </div>
                                ))}
                              </div>
                              {/* 処置追加（m_fees検索） */}
                              {editingPatternIdx === pi * 1000 + vi ? (
                                <div className="border border-sky-200 rounded-lg p-2 bg-white">
                                  <div className="flex gap-2 mb-2">
                                    <input
                                      type="text"
                                      value={feeSearchQuery}
                                      onChange={e => setFeeSearchQuery(e.target.value)}
                                      placeholder="処置名で検索..."
                                      className="flex-1 text-xs border border-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-sky-400"
                                    />
                                    <button
                                      onClick={async () => {
                                        if (!feeSearchQuery.trim()) return;
                                        setFeeSearching(true);
                                        try {
                                          const { data } = await supabase
                                            .from("m_fees")
                                            .select("sub_code, name, points")
                                            .ilike("name", `%${feeSearchQuery}%`)
                                            .eq("is_active", true)
                                            .limit(10);
                                          setFeeSearchResults(data || []);
                                        } finally {
                                          setFeeSearching(false);
                                        }
                                      }}
                                      disabled={feeSearching}
                                      className="bg-sky-600 text-white text-xs px-3 py-1.5 rounded-lg hover:bg-sky-700 disabled:opacity-50"
                                    >
                                      {feeSearching ? "..." : "検索"}
                                    </button>
                                    <button onClick={() => { setEditingPatternIdx(null); setFeeSearchQuery(""); setFeeSearchResults([]); }} className="text-gray-400 text-xs px-2">✕</button>
                                  </div>
                                  {feeSearchResults.length > 0 && (
                                    <div className="space-y-1 max-h-40 overflow-y-auto">
                                      {feeSearchResults.map((f, k) => (
                                        <button
                                          key={k}
                                          onClick={() => {
                                            const updated = [...ukeEditPatterns];
                                            const updatedVariants = [...updated[pi].variants];
                                            updatedVariants[vi] = {
                                              ...updatedVariants[vi],
                                              fee_codes: [...updatedVariants[vi].fee_codes, f.sub_code],
                                              procedure_names: [...updatedVariants[vi].procedure_names, f.name],
                                              variant_name: [...updatedVariants[vi].procedure_names, f.name].join("・"),
                                            };
                                            updated[pi] = { ...updated[pi], variants: updatedVariants };
                                            setUkeEditPatterns(updated);
                                            setEditingPatternIdx(null);
                                            setFeeSearchQuery("");
                                            setFeeSearchResults([]);
                                          }}
                                          className="w-full text-left text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 hover:bg-sky-50 hover:border-sky-300"
                                        >
                                          <span className="font-bold text-gray-900">{f.name}</span>
                                          <span className="text-gray-400 ml-2">{f.points}点</span>
                                          <span className="text-gray-300 ml-2 font-mono">{f.sub_code}</span>
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ) : (
                                <button
                                  onClick={() => { setEditingPatternIdx(pi * 1000 + vi); setFeeSearchQuery(""); setFeeSearchResults([]); }}
                                  className="text-xs text-sky-600 hover:text-sky-700 font-bold"
                                >＋ 処置を追加</button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="flex gap-3">
                  <button onClick={() => setUkeStep(3)} className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-xl font-bold hover:bg-gray-200">戻る</button>
                  <button
                    onClick={async () => {
                      setUkeSaving(true);
                      setUkeSaveMsg("");
                      try {
                        for (const p of ukeEditPatterns) {
                          // 傷病名単位でclinic_patternsにUPSERT
                          const { data: existing } = await supabase
                            .from("clinic_patterns")
                            .select("id, use_count")
                            .eq("diagnosis_code", p.diagnosis_codes[0] ?? "")
                            .maybeSingle();

                          let patternId: string;
                          if (existing) {
                            await supabase
                              .from("clinic_patterns")
                              .update({ use_count: existing.use_count + p.use_count })
                              .eq("id", existing.id);
                            patternId = existing.id;
                            // 既存のclinic_pattern_itemsを削除して再登録
                            await supabase.from("clinic_pattern_items").delete().eq("pattern_id", patternId);
                          } else {
                            const { data: inserted } = await supabase
                              .from("clinic_patterns")
                              .insert({
                                diagnosis_code: p.diagnosis_codes[0] ?? "",
                                diagnosis_name: p.diagnosis_names[0] ?? "",
                                pattern_name: p.diagnosis_names[0] ?? "",
                                use_count: p.use_count,
                                source: "uke",
                                is_active: true,
                              })
                              .select("id")
                              .single();
                            if (!inserted) continue;
                            patternId = inserted.id;
                          }

                          // clinic_pattern_itemsにvariant付きで保存
                          const items: {
                            pattern_id: string;
                            item_type: string;
                            fee_code: string;
                            item_name: string;
                            points: number;
                            kubun: string;
                            display_order: number;
                            variant_name: string;
                            variant_count: number;
                          }[] = [];

                          p.variants.forEach((v, vi) => {
                            v.fee_codes.forEach((code, idx) => {
                              items.push({
                                pattern_id: patternId,
                                item_type: "SS",
                                fee_code: code,
                                item_name: v.procedure_names[idx] ?? "",
                                points: 0,
                                kubun: "必須",
                                display_order: vi * 100 + idx + 1,
                                variant_name: v.variant_name,
                                variant_count: v.variant_count,
                              });
                            });
                          });

                          if (items.length > 0) {
                            await supabase.from("clinic_pattern_items").insert(items);
                          }
                        }

                        // ダッシュボード再取得
                        const { data: refreshed } = await supabase
                          .from("clinic_patterns")
                          .select("id, pattern_name, diagnosis_name, use_count, updated_at")
                          .eq("is_active", true)
                          .order("use_count", { ascending: false });
                        setDashPatterns(refreshed ?? []);
                        setUkeSaveMsg("✅ パターンを保存しました");
                        setTimeout(() => {
                          setUkeStep(1);
                          setUkeFile(null);
                          setUkePatients([]);
                          setUkeGrouped([]);
                          setUkeEditPatterns([]);
                          setUkeInsights([]);
                          setUkeMissingClaims([]);
                          setUkeSaveMsg("");
                        }, 2000);
                      } catch (e) {
                        setUkeSaveMsg(`❌ 保存エラー: ${String(e)}`);
                      } finally {
                        setUkeSaving(false);
                      }
                    }}
                    disabled={ukeSaving}
                    className="flex-1 bg-sky-600 text-white py-3 rounded-xl font-bold hover:bg-sky-700 disabled:opacity-50 transition-colors"
                  >
                    {ukeSaving ? "💾 保存中..." : "✅ clinic_patternsに保存する"}
                  </button>
                </div>
                {ukeSaveMsg && (
                  <p className={`text-sm text-center font-bold ${ukeSaveMsg.startsWith("✅") ? "text-emerald-600" : "text-red-500"}`}>
                    {ukeSaveMsg}
                  </p>
                )}
              </div>
            )}

          </div>
        )}
      </main>

      {/* ========== ブロック追加モーダル ========== */}
      {showAddBlock && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6">
            <h3 className="font-bold text-gray-900 text-lg mb-4">🚫 ブロックを追加</h3>
            <div className="space-y-4">
              {/* ブロックタイプ選択 */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">ブロックの種類</label>
                <select value={newBlock.block_type} onChange={e => setNewBlock({ ...newBlock, block_type: e.target.value as "date"|"weekly"|"daily"|"datetime" })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400 bg-white">
                  <option value="date">特定の日（終日）</option>
                  <option value="weekly">毎週特定の曜日</option>
                  <option value="daily">毎日特定の時間帯</option>
                  <option value="datetime">特定の日の特定の時間帯</option>
                </select>
              </div>

              {/* 日付（date / datetime） */}
              {(newBlock.block_type === "date" || newBlock.block_type === "datetime") && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">日付 <span className="text-red-500">*</span></label>
                  <input type="date" value={newBlock.block_date} onChange={e => setNewBlock({ ...newBlock, block_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400" />
                </div>
              )}

              {/* 曜日（weekly） */}
              {newBlock.block_type === "weekly" && (
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-1">曜日</label>
                  <div className="flex gap-2">
                    {weekdays.map((day, idx) => (
                      <button key={idx} onClick={() => setNewBlock({ ...newBlock, day_of_week: String(idx) })}
                        className={`w-10 h-10 rounded-lg text-sm font-bold transition-colors ${newBlock.day_of_week === String(idx) ? "bg-red-500 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 時間帯（weekly / daily / datetime） */}
              {newBlock.block_type !== "date" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">
                      開始時間{newBlock.block_type === "daily" && <span className="text-red-500"> *</span>}
                    </label>
                    <input type="time" value={newBlock.time_from} onChange={e => setNewBlock({ ...newBlock, time_from: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-1">
                      終了時間{newBlock.block_type === "daily" && <span className="text-red-500"> *</span>}
                    </label>
                    <input type="time" value={newBlock.time_to} onChange={e => setNewBlock({ ...newBlock, time_to: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400" />
                  </div>
                </div>
              )}

              {/* 理由 */}
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">理由（任意）</label>
                <input type="text" value={newBlock.reason} onChange={e => setNewBlock({ ...newBlock, reason: e.target.value })}
                  placeholder="例: 院内研修、学会参加、休診日変更など"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400" />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowAddBlock(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-lg font-bold">キャンセル</button>
                <button onClick={addBlock} disabled={blockSaving}
                  className="flex-1 bg-red-500 text-white py-2.5 rounded-lg font-bold hover:bg-red-600 disabled:opacity-50">
                  {blockSaving ? "追加中..." : "🚫 ブロックを追加"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
