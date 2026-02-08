import { supabase } from "./supabase";

// 型定義
export type ClinicConfig = {
  clinicId: string;
  clinicName: string;
  morningStart: string;
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  slotDurationMin: number;
  closedDays: number[];
  maxPatientsPerSlot: number;
};

export type TimeSlot = {
  time: string;         // "09:00"
  period: "morning" | "afternoon";
  currentCount: number; // 現在の予約数
  maxCount: number;     // 最大予約数
  isFull: boolean;      // 満枠かどうか
};

export type DoctorOption = {
  id: string;
  name: string;
  color: string;
};

// ===== クリニック設定を取得 =====
export async function getClinicConfig(): Promise<ClinicConfig | null> {
  // クリニック情報
  const { data: clinics } = await supabase.from("clinics").select("id, name").limit(1);
  if (!clinics || clinics.length === 0) return null;

  const clinicId = clinics[0].id;

  // 設定情報
  const { data: settings } = await supabase
    .from("clinic_settings")
    .select("*")
    .eq("clinic_id", clinicId)
    .limit(1);

  if (!settings || settings.length === 0) {
    // デフォルト値を返す
    return {
      clinicId,
      clinicName: clinics[0].name,
      morningStart: "09:00",
      morningEnd: "12:00",
      afternoonStart: "13:00",
      afternoonEnd: "18:00",
      slotDurationMin: 30,
      closedDays: [0],
      maxPatientsPerSlot: 3,
    };
  }

  const s = settings[0];
  return {
    clinicId,
    clinicName: clinics[0].name,
    morningStart: s.morning_start?.substring(0, 5) || "09:00",
    morningEnd: s.morning_end?.substring(0, 5) || "12:00",
    afternoonStart: s.afternoon_start?.substring(0, 5) || "13:00",
    afternoonEnd: s.afternoon_end?.substring(0, 5) || "18:00",
    slotDurationMin: s.slot_duration_min || 30,
    closedDays: s.closed_days || [0],
    maxPatientsPerSlot: s.max_patients_per_slot || 3,
  };
}

// ===== 時間枠を生成 =====
export function generateTimeSlots(config: ClinicConfig): { time: string; period: "morning" | "afternoon" }[] {
  const slots: { time: string; period: "morning" | "afternoon" }[] = [];
  const duration = config.slotDurationMin;

  // 午前の枠を生成
  let current = timeToMinutes(config.morningStart);
  const morningEnd = timeToMinutes(config.morningEnd);
  while (current < morningEnd) {
    slots.push({ time: minutesToTime(current), period: "morning" });
    current += duration;
  }

  // 午後の枠を生成
  current = timeToMinutes(config.afternoonStart);
  const afternoonEnd = timeToMinutes(config.afternoonEnd);
  while (current < afternoonEnd) {
    slots.push({ time: minutesToTime(current), period: "afternoon" });
    current += duration;
  }

  return slots;
}

// ===== 特定日の予約枠＋空き状況を取得 =====
export async function getTimeSlotsWithAvailability(
  config: ClinicConfig,
  date: string // "2026-02-17"
): Promise<TimeSlot[]> {
  const baseSlots = generateTimeSlots(config);

  // その日の予約を取得
  const startOfDay = `${date}T00:00:00`;
  const endOfDay = `${date}T23:59:59`;

  const { data: appointments } = await supabase
    .from("appointments")
    .select("scheduled_at, status")
    .gte("scheduled_at", startOfDay)
    .lte("scheduled_at", endOfDay)
    .neq("status", "cancelled"); // キャンセル済みは除外

  // 時間ごとの予約数をカウント
  const countByTime: Record<string, number> = {};
  if (appointments) {
    for (const apt of appointments) {
      const time = new Date(apt.scheduled_at).toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      // "09:00" の形式に正規化
      const normalized = time.length === 4 ? `0${time}` : time;
      countByTime[normalized] = (countByTime[normalized] || 0) + 1;
    }
  }

  return baseSlots.map((slot) => {
    const currentCount = countByTime[slot.time] || 0;
    return {
      time: slot.time,
      period: slot.period,
      currentCount,
      maxCount: config.maxPatientsPerSlot,
      isFull: currentCount >= config.maxPatientsPerSlot,
    };
  });
}

// ===== 指定日が休診日かどうか =====
export function isClosedDay(config: ClinicConfig, date: string): boolean {
  const d = new Date(date + "T00:00:00");
  return config.closedDays.includes(d.getDay());
}

// ===== 予約可能な日付リストを取得（今日から14日間） =====
export function getAvailableDates(config: ClinicConfig, days: number = 14): Date[] {
  const dates: Date[] = [];
  const today = new Date();
  for (let i = 1; i <= days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    // 休診日を除外
    if (!config.closedDays.includes(d.getDay())) {
      dates.push(d);
    }
  }
  return dates;
}

// ===== ドクター一覧を取得 =====
export async function getDoctors(clinicId: string): Promise<DoctorOption[]> {
  const { data } = await supabase
    .from("staff")
    .select("id, name, color")
    .eq("clinic_id", clinicId)
    .eq("role", "doctor")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  return (data || []).map((d) => ({
    id: d.id,
    name: d.name,
    color: d.color || "#0ea5e9",
  }));
}

// ===== ヘルパー関数 =====
function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
