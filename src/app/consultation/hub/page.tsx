"use client";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type PatientInfo = {
  id: string;
  name_kanji: string;
  name_kana: string;
  date_of_birth: string | null;
  sex: string | null;
  insurance_type: string | null;
  burden_ratio: number | null;
  allergies: unknown;
  alert_memo?: string | null;
  infection_flags?: string | null;
  patient_number?: string | null;
};

type PrevRecord = {
  date: string;
  soap_s: string;
  soap_a: string;
  soap_p: string;
  procedures: { name: string; tooth?: string }[];
};

function getAge(dob: string | null) {
  if (!dob) return null;
  const b = new Date(dob); const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
  return a;
}
function hd(v: unknown) { return v && JSON.stringify(v) !== "null" && JSON.stringify(v) !== "[]" && JSON.stringify(v) !== "{}"; }

const HUB_TILES = [
  { id: "exam", icon: "🩺", label: "診察", sub: "SOAP記録・治療", color: "#2563eb", bg: "#dbeafe", check: (c: Counts) => c.records > 0, badge: (c: Counts) => c.records > 0 ? `${c.records}回` : null },
  { id: "images", icon: "📸", label: "画像", sub: "レントゲン・口腔内写真", color: "#0891b2", bg: "#cffafe", check: (c: Counts) => c.images > 0, badge: (c: Counts) => c.images > 0 ? `${c.images}枚` : null },
  { id: "tooth", icon: "🦷", label: "歯式", sub: "チャート・歯周・歯面", color: "#7c3aed", bg: "#ede9fe", check: (c: Counts) => c.hasChart, badge: (c: Counts) => c.hasChart ? "記録あり" : null },
  { id: "history", icon: "📋", label: "治療履歴", sub: "過去のカルテ一覧", color: "#ea580c", bg: "#fff7ed", check: (c: Counts) => c.records > 0, badge: (c: Counts) => c.records > 0 ? `${c.records}回` : null },
  { id: "perio", icon: "📊", label: "P検", sub: "歯周検査・推移", color: "#dc2626", bg: "#fef2f2", check: (c: Counts) => c.perio > 0, badge: (c: Counts) => c.perio > 0 ? `${c.perio}回` : null },
  { id: "documents", icon: "📄", label: "文書", sub: "紹介状・同意書・計画書", color: "#65a30d", bg: "#f7fee7", check: () => false, badge: () => null },
];

type Counts = { records: number; images: number; perio: number; hasChart: boolean };

function HubContent() {
  const sp = useSearchParams();
  const router = useRouter();
  const appointmentId = sp.get("appointment_id") || "";

  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [patientType, setPatientType] = useState("new");
  const [counts, setCounts] = useState<Counts>({ records: 0, images: 0, perio: 0, hasChart: false });
  const [prevRecord, setPrevRecord] = useState<PrevRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFlow, setShowFlow] = useState(false);

  useEffect(() => { if (appointmentId) loadData(); }, [appointmentId]);

  async function loadData() {
    setLoading(true);
    // 予約→患者取得
    const { data: apt } = await supabase.from("appointments").select("id, patient_id, patient_type, patients(*)").eq("id", appointmentId).single();
    if (!apt) { setLoading(false); return; }
    const p = (apt as Record<string, unknown>).patients as unknown as PatientInfo;
    setPatient(p);
    setPatientType(String((apt as Record<string, unknown>).patient_type || "new"));

    // 集計
    const [{ count: recCount }, { count: imgCount }, { count: perCount }, { data: ptData }] = await Promise.all([
      supabase.from("medical_records").select("id", { count: "exact", head: true }).eq("patient_id", p.id),
      supabase.from("patient_images").select("id", { count: "exact", head: true }).eq("patient_id", p.id),
      supabase.from("perio_snapshots").select("id", { count: "exact", head: true }).eq("patient_id", p.id),
      supabase.from("patients").select("current_tooth_chart").eq("id", p.id).single(),
    ]);
    setCounts({
      records: recCount || 0,
      images: imgCount || 0,
      perio: perCount || 0,
      hasChart: !!(ptData?.current_tooth_chart && Object.keys(ptData.current_tooth_chart as object).length > 0),
    });

    // 前回記録（再診のみ）
    if (String((apt as Record<string, unknown>).patient_type || "") === "returning") {
      const { data: prevApt } = await supabase.from("appointments")
        .select("scheduled_at, medical_records(soap_s, soap_a, soap_p), billing(procedures_detail)")
        .eq("patient_id", p.id).eq("status", "completed")
        .order("scheduled_at", { ascending: false }).limit(1).single();
      if (prevApt) {
        const mr = ((prevApt as Record<string, unknown>).medical_records as Record<string, string>[])?.[0];
        const bl = ((prevApt as Record<string, unknown>).billing as Record<string, unknown>[])?.[0];
        const procs = (bl?.procedures_detail as { name: string; tooth_numbers?: string[] }[] || [])
          .slice(0, 5).map(pr => ({ name: pr.name, tooth: pr.tooth_numbers?.join(",") }));
        if (mr) {
          setPrevRecord({
            date: new Date((prevApt as Record<string, unknown>).scheduled_at as string).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" }),
            soap_s: mr.soap_s || "",
            soap_a: mr.soap_a || "",
            soap_p: mr.soap_p || "",
            procedures: procs,
          });
        }
      }
    }
    setLoading(false);
  }

  function goSession(flow?: string) {
    const url = `/consultation/session?appointment_id=${appointmentId}${flow ? `&flow=${flow}` : ""}`;
    router.push(url);
  }

  function goPatientPage(section?: string) {
    if (!patient) return;
    router.push(`/patients/${patient.id}${section ? `?tab=${section}` : ""}`);
  }

  const isNew = patientType === "new";
  const isReturning = !isNew;
  const age = patient ? getAge(patient.date_of_birth) : null;

  if (loading) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🦷</div>
        <div style={{ fontSize: 16, color: "#64748b", fontWeight: 600 }}>読み込み中...</div>
      </div>
    </div>
  );

  if (!patient) return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f0f4f8" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 16, color: "#64748b" }}>予約データが見つかりません</div>
        <button onClick={() => router.push("/consultation")} style={{ marginTop: 16, padding: "10px 24px", borderRadius: 10, border: "none", background: "#2563eb", color: "#fff", fontWeight: 700, cursor: "pointer" }}>← 戻る</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(160deg, #f0f4f8 0%, #e2e8f0 100%)", fontFamily: "'Hiragino Kaku Gothic ProN', 'Noto Sans JP', sans-serif" }}>
      {/* ===== Header ===== */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", padding: "16px 24px", display: "flex", alignItems: "center", gap: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        <button onClick={() => router.push("/consultation")} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 16, cursor: "pointer", padding: "8px 12px", fontWeight: 600 }}>← 戻る</button>
        <div style={{ width: 52, height: 52, borderRadius: "50%", background: isNew ? "linear-gradient(135deg,#3b82f6,#2563eb)" : "linear-gradient(135deg,#10b981,#059669)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 24, fontWeight: 800, flexShrink: 0 }}>
          {patient.name_kanji.charAt(0)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: "#1e293b" }}>{patient.name_kanji}</span>
            <span style={{ fontSize: 14, color: "#94a3b8" }}>({patient.name_kana})</span>
            {isNew && <span style={{ background: "#dc2626", color: "#fff", fontSize: 12, fontWeight: 800, padding: "2px 10px", borderRadius: 6 }}>初診</span>}
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 14, color: "#64748b", fontWeight: 500 }}>
            <span>{patient.patient_number ? `#${patient.patient_number}` : ""}</span>
            {age !== null && <span>{age}歳 {patient.sex === "男" ? "♂" : patient.sex === "女" ? "♀" : ""}</span>}
            <span>{patient.insurance_type || ""} {patient.burden_ratio ? `${Math.round(patient.burden_ratio * 100)}%` : ""}</span>
          </div>
        </div>
        {/* Alert badges */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!!hd(patient.allergies) && (
            <div style={{ background: "#fef2f2", border: "2px solid #fecaca", borderRadius: 10, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 16 }}>⚠️</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>アレルギー</span>
            </div>
          )}
          {patient.infection_flags && (
            <div style={{ background: "#fff7ed", border: "2px solid #fed7aa", borderRadius: 10, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 16 }}>🦠</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#ea580c" }}>{patient.infection_flags}</span>
            </div>
          )}
          {patient.alert_memo && (
            <div style={{ background: "#fefce8", border: "2px solid #fde68a", borderRadius: 10, padding: "6px 12px", display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 16 }}>📌</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#a16207" }}>{patient.alert_memo}</span>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px" }}>
        {/* ===== Tile Grid ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
          {HUB_TILES.map(tile => {
            const active = tile.check(counts);
            const badge = tile.badge(counts);
            return (
              <button key={tile.id} onClick={() => {
                if (tile.id === "exam") { isReturning ? setShowFlow(true) : goSession(); }
                else if (tile.id === "images") goPatientPage("images");
                else if (tile.id === "tooth") goPatientPage("timeline");
                else if (tile.id === "history") goPatientPage("records");
                else if (tile.id === "perio") goPatientPage("perio");
                else if (tile.id === "documents") goPatientPage("documents");
              }} style={{
                position: "relative", background: active ? "#fff" : "#f8fafc",
                border: `2px solid ${active ? tile.bg : "#e2e8f0"}`, borderRadius: 18,
                padding: "24px 16px 20px", cursor: "pointer",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
                boxShadow: active ? "0 4px 12px rgba(0,0,0,0.06)" : "none",
                opacity: active || isNew ? 1 : 0.5,
                transition: "all 0.2s",
              }}>
                {active && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: tile.color, borderRadius: "18px 18px 0 0" }} />}
                <div style={{ width: 60, height: 60, borderRadius: 16, background: active ? `${tile.bg}` : "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>
                  {tile.icon}
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: active ? "#1e293b" : "#94a3b8" }}>{tile.label}</div>
                <div style={{ fontSize: 11, color: active ? "#64748b" : "#cbd5e1", fontWeight: 500 }}>{tile.sub}</div>
                {badge && <div style={{ position: "absolute", top: 10, right: 10, background: tile.color, color: "#fff", fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 6 }}>{badge}</div>}
                {!active && isNew && <div style={{ position: "absolute", top: 10, right: 10, background: "#e2e8f0", color: "#94a3b8", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 5 }}>未入力</div>}
              </button>
            );
          })}
        </div>

        {/* ===== Previous Record (revisit only) ===== */}
        {isReturning && prevRecord && (
          <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e2e8f0", padding: "20px 24px", marginBottom: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 18 }}>📋</span>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#1e293b" }}>前回の記録</span>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>{prevRecord.date}</span>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {prevRecord.procedures.map((p, i) => (
                  <span key={i} style={{ background: "#f0fdf4", color: "#16a34a", fontSize: 12, fontWeight: 700, padding: "3px 10px", borderRadius: 7, border: "1px solid #bbf7d0" }}>
                    ✓ {p.name}{p.tooth ? ` ${p.tooth}` : ""}
                  </span>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.3fr", gap: 16 }}>
              {[
                { key: "S", label: "主訴", color: "#2563eb", bg: "#dbeafe", text: prevRecord.soap_s },
                { key: "A", label: "傷病名", color: "#d97706", bg: "#fef3c7", text: prevRecord.soap_a },
                { key: "P", label: "次回予定", color: "#7c3aed", bg: "#ede9fe", text: prevRecord.soap_p },
              ].map(item => (
                <div key={item.key}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                    <span style={{ background: item.bg, color: item.color, fontSize: 11, fontWeight: 800, padding: "1px 7px", borderRadius: 4 }}>{item.key}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8" }}>{item.label}</span>
                  </div>
                  <div style={{ fontSize: 13, color: item.key === "P" ? "#1e293b" : "#475569", fontWeight: item.key === "P" ? 700 : 500, lineHeight: 1.5, whiteSpace: "pre-line" }}>
                    {item.text || "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ===== Flow Selection (revisit) or Start Button (new) ===== */}
        {showFlow && isReturning ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { id: "continue", icon: "🩺", title: "前回の続き", sub: "変わりなし → そのまま治療へ", desc: "S欄自動入力 → 治療後にDr録音でA/P記録", color: "#2563eb", bg: "linear-gradient(135deg,#eff6ff,#dbeafe)", border: "#bfdbfe", steps: ["前回P欄確認", "治療", "Dr録音→A,P", "確定"] },
              { id: "new_chief", icon: "⚡", title: "新しい主訴あり", sub: "別の痛み・症状を訴えている", desc: "主訴の聴取から開始。初診と同じフルフロー", color: "#ea580c", bg: "linear-gradient(135deg,#fff7ed,#ffedd5)", border: "#fed7aa", steps: ["主訴聴取(S)", "検査", "Dr→A,P", "確定"] },
              { id: "maintenance", icon: "🪥", title: "メンテナンス", sub: "SC / SRP / P検 → DH中心", desc: "DH中心。P検→クリーニング→DH記録", color: "#059669", bg: "linear-gradient(135deg,#ecfdf5,#d1fae5)", border: "#a7f3d0", steps: ["P検", "SC/SRP", "DH記録", "Dr確認"] },
            ].map((opt, i) => (
              <button key={opt.id} onClick={() => goSession(opt.id)} style={{
                background: opt.bg, border: `2px solid ${opt.border}`, borderRadius: 18, padding: "22px 24px",
                cursor: "pointer", display: "flex", alignItems: "center", gap: 20, textAlign: "left",
              }}>
                <div style={{ width: 64, height: 64, borderRadius: 16, background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, flexShrink: 0, border: `2px solid ${opt.border}` }}>
                  {opt.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", marginBottom: 2 }}>{opt.title}</div>
                  <div style={{ fontSize: 14, color: opt.color, fontWeight: 700, marginBottom: 3 }}>{opt.sub}</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>{opt.desc}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
                  {opt.steps.map((s, j) => (
                    <div key={j} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#64748b", fontWeight: 600 }}>
                      <div style={{ width: 16, height: 16, borderRadius: "50%", background: opt.color, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, flexShrink: 0 }}>{j + 1}</div>
                      {s}
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 22, color: opt.color, fontWeight: 800, flexShrink: 0 }}>→</div>
              </button>
            ))}
            <button onClick={() => setShowFlow(false)} style={{ background: "none", border: "none", color: "#94a3b8", fontSize: 14, cursor: "pointer", padding: 8, fontWeight: 600 }}>← 戻る</button>
          </div>
        ) : !showFlow ? (
          <div style={{ background: "#fff", borderRadius: 18, border: "1px solid #e2e8f0", padding: "20px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: isNew ? "linear-gradient(135deg,#dc2626,#b91c1c)" : "linear-gradient(135deg,#2563eb,#1d4ed8)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 20 }}>
                {isNew ? "🆕" : "🩺"}
              </div>
              <div>
                <div style={{ fontSize: 17, fontWeight: 800, color: "#1e293b" }}>{isNew ? "初診を開始する" : "本日の診察を開始する"}</div>
                <div style={{ fontSize: 12, color: "#64748b" }}>{isNew ? "問診票 → 主訴確認 → 歯式記録 → P検 → 診察" : "診察パターンを選択してください"}</div>
              </div>
            </div>
            <button onClick={() => isReturning ? setShowFlow(true) : goSession()} style={{
              background: isNew ? "linear-gradient(135deg,#dc2626,#b91c1c)" : "linear-gradient(135deg,#2563eb,#1d4ed8)",
              color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 800, cursor: "pointer",
              boxShadow: isNew ? "0 4px 12px rgba(220,38,38,0.3)" : "0 4px 12px rgba(37,99,235,0.3)",
            }}>
              {isNew ? "診察を開始 →" : "診察パターンを選択 →"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function PatientHubPage() {
  return <Suspense fallback={<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}><p>読み込み中...</p></div>}><HubContent /></Suspense>;
}
