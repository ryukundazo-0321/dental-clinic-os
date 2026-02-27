"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";

// Types
type Unit = { id: string; unit_number: number; name: string; };
type Apt = {
  id: string; scheduled_at: string; status: string; patient_type: string;
  unit_id: string | null; doctor_id: string | null;
  patients: { id: string; name_kanji: string; date_of_birth: string | null; } | null;
};
type Doctor = { id: string; name: string; };

const STATUS: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  reserved:        { label: "予約済",   color: "#3B82F6", bg: "#EFF6FF", icon: "📅" },
  checked_in:      { label: "来院",     color: "#16A34A", bg: "#F0FDF4", icon: "📱" },
  in_consultation: { label: "診察中",   color: "#EA580C", bg: "#FFF7ED", icon: "🩺" },
  completed:       { label: "完了",     color: "#7C3AED", bg: "#F5F3FF", icon: "✅" },
  billing_done:    { label: "会計済",   color: "#6B7280", bg: "#F9FAFB", icon: "💰" },
  cancelled:       { label: "キャンセル", color: "#DC2626", bg: "#FEF2F2", icon: "❌" },
};

function timeStr(iso: string) {
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function age(dob: string | null) {
  if (!dob) return "";
  return `${Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000)}歳`;
}

export default function ReceptionDashboard() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [appointments, setAppointments] = useState<Apt[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [now, setNow] = useState(new Date());

  // Load data
  const loadData = useCallback(async () => {
    // Units
    const { data: u } = await supabase.from("units").select("id, unit_number, name").eq("is_active", true).order("unit_number");
    if (u) setUnits(u);

    // Today's appointments
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString();
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString();
    const { data: a } = await supabase.from("appointments")
      .select("id, scheduled_at, status, patient_type, unit_id, doctor_id, patients(id, name_kanji, date_of_birth)")
      .gte("scheduled_at", start).lt("scheduled_at", end)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    if (a) setAppointments(a as unknown as Apt[]);

    // Doctors
    const { data: clinics } = await supabase.from("clinics").select("id").limit(1);
    if (clinics?.[0]) {
      const { data: d } = await supabase.from("doctors").select("id, name").eq("clinic_id", clinics[0].id);
      if (d) setDoctors(d);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Realtime
    const ch = supabase.channel("reception-dash")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue" }, () => loadData())
      .subscribe();
    const poll = setInterval(loadData, 5000);
    const clock = setInterval(() => setNow(new Date()), 30000);
    return () => { supabase.removeChannel(ch); clearInterval(poll); clearInterval(clock); };
  }, [loadData]);

  // Group appointments by unit
  const unitApts = (unitId: string) => appointments.filter(a => a.unit_id === unitId);
  const unassigned = appointments.filter(a => !a.unit_id);
  const currentApt = (unitId: string) => unitApts(unitId).find(a => a.status === "in_consultation");
  const nextApt = (unitId: string) => unitApts(unitId).find(a => a.status === "reserved" || a.status === "checked_in");
  const doctorName = (doctorId: string | null) => doctorId ? doctors.find(d => d.id === doctorId)?.name || "" : "";

  // Stats
  const totalToday = appointments.length;
  const inConsult = appointments.filter(a => a.status === "in_consultation").length;
  const waiting = appointments.filter(a => a.status === "checked_in").length;
  const done = appointments.filter(a => a.status === "completed" || a.status === "billing_done").length;

  // Responsive grid columns based on unit count
  const gridColCount = units.length <= 4 ? 2 : units.length <= 6 ? 3 : 4;

  return (
    <div style={{ height: "100vh", background: "#F3F4F6", fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <header style={{ background: "#FFF", borderBottom: "1px solid #E5E7EB", padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 22, fontWeight: 800 }}>🏥 受付ダッシュボード</span>
          <span style={{ fontSize: 13, color: "#9CA3AF" }}>
            {now.getFullYear()}/{now.getMonth() + 1}/{now.getDate()}（{["日","月","火","水","木","金","土"][now.getDay()]}）
          </span>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ background: "#EFF6FF", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#3B82F6" }}>
            📅 本日 {totalToday}件
          </div>
          <div style={{ background: "#FFF7ED", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#EA580C" }}>
            🩺 診察中 {inConsult}
          </div>
          <div style={{ background: "#F0FDF4", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#16A34A" }}>
            ⏳ 待ち {waiting}
          </div>
          <div style={{ background: "#F5F3FF", padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 700, color: "#7C3AED" }}>
            ✅ 完了 {done}
          </div>
        </div>
      </header>

      {/* Chair Grid */}
      <div style={{ padding: "8px 12px", height: "calc(100vh - 56px)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${gridColCount}, 1fr)`, gap: 10, flex: 1, minHeight: 0 }}>
          {units.map(unit => {
            const apts = unitApts(unit.id);
            const cur = currentApt(unit.id);
            const nxt = nextApt(unit.id);
            const unitDone = apts.filter(a => a.status === "completed" || a.status === "billing_done").length;
            const hasCurrent = !!cur;

            return (
              <div key={unit.id} style={{
                background: "#FFF", borderRadius: 16, border: hasCurrent ? "2px solid #EA580C" : "1px solid #E5E7EB",
                overflow: "hidden", display: "flex", flexDirection: "column",
                boxShadow: hasCurrent ? "0 0 0 3px rgba(234,88,12,0.1)" : "0 1px 3px rgba(0,0,0,0.04)",
              }}>
                {/* Unit Header */}
                <div style={{
                  padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
                  background: hasCurrent ? "#FFF7ED" : "#F9FAFB", borderBottom: "1px solid #E5E7EB",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 18, fontWeight: 800 }}>{unit.name}</span>
                    {hasCurrent && <span style={{ fontSize: 10, fontWeight: 700, color: "#EA580C", background: "#FED7AA", padding: "2px 8px", borderRadius: 6 }}>🩺 診察中</span>}
                  </div>
                  <span style={{ fontSize: 11, color: "#9CA3AF" }}>{unitDone}/{apts.length}完了</span>
                </div>

                {/* Current Patient (highlighted) */}
                {cur && cur.patients && (
                    <div style={{ padding: "12px 16px", background: "#FFF7ED", borderBottom: "1px solid #FED7AA" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#EA580C", color: "#FFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800 }}>
                            {cur.patients.name_kanji.charAt(0)}
                          </div>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700 }}>{cur.patients.name_kanji}</div>
                            <div style={{ fontSize: 10, color: "#9CA3AF" }}>
                              {age(cur.patients.date_of_birth)} {cur.patient_type === "new" ? "初診" : "再診"}
                              {doctorName(cur.doctor_id) && ` / ${doctorName(cur.doctor_id)}`}
                            </div>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: "#EA580C", marginRight: 4 }}>{timeStr(cur.scheduled_at)}</span>
                          <a href={`/consultation/session?appointment_id=${cur.id}`} style={{
                            fontSize: 10, fontWeight: 700, color: "#FFF", background: "#0EA5E9",
                            padding: "4px 10px", borderRadius: 6, textDecoration: "none",
                          }}>📋 診察</a>
                          <a href={`/karte-agent/unit?appointment_id=${cur.id}`} style={{
                            fontSize: 10, fontWeight: 700, color: "#FFF", background: "#111827",
                            padding: "4px 10px", borderRadius: 6, textDecoration: "none",
                          }}>🤖 エージェント</a>
                        </div>
                      </div>
                    </div>
                )}

                {/* Patient List */}
                <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
                  {apts.filter(a => a.id !== cur?.id).map(apt => {
                    const st = STATUS[apt.status] || STATUS.reserved;
                    const isNext = nxt?.id === apt.id && !cur;
                    return (
                      <div key={apt.id} style={{
                        padding: "10px 16px", borderBottom: "1px solid #F3F4F6",
                        background: isNext ? "#F0FDF4" : "transparent",
                        opacity: apt.status === "billing_done" ? 0.5 : 1,
                      }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", width: 36 }}>{timeStr(apt.scheduled_at)}</span>
                            <span style={{ fontSize: 13, fontWeight: 600 }}>{apt.patients?.name_kanji || "—"}</span>
                            <span style={{ fontSize: 10, color: "#9CA3AF" }}>{age(apt.patients?.date_of_birth || null)}</span>
                            {apt.patient_type === "new" && <span style={{ fontSize: 9, fontWeight: 700, color: "#DC2626", background: "#FEF2F2", padding: "1px 5px", borderRadius: 4 }}>初診</span>}
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {doctorName(apt.doctor_id) && <span style={{ fontSize: 10, color: "#9CA3AF" }}>{doctorName(apt.doctor_id)}</span>}
                            <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.bg, padding: "2px 8px", borderRadius: 6 }}>
                              {st.icon} {st.label}
                            </span>
                            {(apt.status === "reserved" || apt.status === "checked_in" || apt.status === "in_consultation") && (
                              <div style={{ display: "flex", gap: 3 }}>
                                <a href={`/consultation/session?appointment_id=${apt.id}`} style={{
                                  fontSize: 9, fontWeight: 700, color: "#FFF", background: "#0EA5E9",
                                  padding: "3px 8px", borderRadius: 5, textDecoration: "none",
                                }}>📋 診察</a>
                                <a href={`/karte-agent/unit?appointment_id=${apt.id}`} style={{
                                  fontSize: 9, fontWeight: 700, color: "#FFF", background: "#111827",
                                  padding: "3px 8px", borderRadius: 5, textDecoration: "none",
                                }}>🤖 AG</a>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {apts.length === 0 && (
                    <div style={{ padding: 24, textAlign: "center", color: "#D1D5DB", fontSize: 13 }}>
                      本日の予約なし
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Unassigned patients */}
        {unassigned.length > 0 && (
          <div style={{ marginTop: 16, background: "#FFF", borderRadius: 12, border: "1px solid #FDE68A", overflow: "hidden" }}>
            <div style={{ padding: "10px 16px", background: "#FFFBEB", borderBottom: "1px solid #FDE68A", display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700 }}>⚠️ チェア未割当</span>
              <span style={{ fontSize: 11, color: "#D97706" }}>{unassigned.length}件</span>
            </div>
            {unassigned.map(apt => {
              const st = STATUS[apt.status] || STATUS.reserved;
              return (
                <div key={apt.id} style={{ padding: "10px 16px", borderBottom: "1px solid #F3F4F6", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#6B7280", width: 36 }}>{timeStr(apt.scheduled_at)}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{apt.patients?.name_kanji || "—"}</span>
                    <span style={{ fontSize: 10, color: "#9CA3AF" }}>{age(apt.patients?.date_of_birth || null)}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: st.color, background: st.bg, padding: "2px 8px", borderRadius: 6 }}>{st.icon} {st.label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 3 }}>
                    <a href={`/consultation/session?appointment_id=${apt.id}`} style={{
                      fontSize: 9, fontWeight: 700, color: "#FFF", background: "#0EA5E9",
                      padding: "3px 8px", borderRadius: 5, textDecoration: "none",
                    }}>📋 診察</a>
                    <a href={`/karte-agent/unit?appointment_id=${apt.id}`} style={{
                      fontSize: 9, fontWeight: 700, color: "#FFF", background: "#111827",
                      padding: "3px 8px", borderRadius: 5, textDecoration: "none",
                    }}>🤖 AG</a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
