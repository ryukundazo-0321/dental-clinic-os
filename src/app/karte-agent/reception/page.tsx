"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STEPS = [
  { key: "s", label: "主訴(S)", short: "S" },
  { key: "tooth", label: "歯式", short: "歯" },
  { key: "perio", label: "P検", short: "P" },
  { key: "dh", label: "DH記録", short: "O" },
  { key: "dr", label: "Dr診察", short: "AP" },
];

type Chunk = {
  id: string; chunk_index: number; corrected_text: string; raw_text: string;
  speaker_role: string; classified_field: string | null; created_at: string;
};
type Draft = {
  id: string; field_key: string; draft_text: string; status: string; updated_at: string;
};
type ActiveUnit = {
  appointment_id: string; patient_name: string; patient_age: number; patient_sex: string;
  allergies: string[]; type: string; dr: string; dh: string; unit_name: string;
};
type Message = { id: string; direction: string; related_field: string | null; message_text: string; created_at: string };

export default function KarteAgentReception() {
  const [units, setUnits] = useState<ActiveUnit[]>([]);
  const [selApt, setSelApt] = useState("");
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [fieldMsgOpen, setFieldMsgOpen] = useState<string | null>(null);
  const [fieldMsgInput, setFieldMsgInput] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);

  // Load active appointments (units in consultation)
  const loadUnits = useCallback(async () => {
    const { data, error } = await supabase
      .from("appointments")
      .select("id, patient_id, patient_type, unit_id, patients(id, name_kanji, name_kana, date_of_birth, allergies)")
      .eq("status", "in_consultation")
      .order("scheduled_at", { ascending: true });

    if (error) { console.error("loadUnits error:", error); return; }
    if (data) {
      const mapped: ActiveUnit[] = data.map((a: Record<string, unknown>) => {
        const p = a.patients as Record<string, unknown> | null;
        const age = p?.date_of_birth ? Math.floor((Date.now() - new Date(p.date_of_birth as string).getTime()) / 31557600000) : 0;
        return {
          appointment_id: a.id as string,
          patient_name: (p?.name_kanji as string) || "不明",
          patient_age: age,
          patient_sex: "",
          allergies: (p?.allergies as string[]) || [],
          type: (a.patient_type as string) === "new" ? "初診" : "再診",
          dr: "",
          dh: "",
          unit_name: a.unit_id ? `U${a.unit_id}` : "未割当",
        };
      });
      setUnits(mapped);
      if (!selApt && mapped.length > 0) setSelApt(mapped[0].appointment_id);
    }
  }, [selApt]);

  useEffect(() => { loadUnits(); }, [loadUnits]);

  // Load data for selected appointment
  const loadData = useCallback(async () => {
    if (!selApt) return;
    const [{ data: c }, { data: d }, { data: m }] = await Promise.all([
      supabase.from("karte_transcript_chunks").select("*").eq("appointment_id", selApt).order("created_at", { ascending: true }),
      supabase.from("karte_ai_drafts").select("*").eq("appointment_id", selApt),
      supabase.from("karte_messages").select("*").eq("appointment_id", selApt).order("created_at", { ascending: true }),
    ]);
    if (c) setChunks(c as Chunk[]);
    if (d) {
      setDrafts(d as Draft[]);
      setConfirmed((d as Draft[]).length >= 5 && (d as Draft[]).every(x => x.status === "confirmed"));
    }
    if (m) setMsgs(m as Message[]);
  }, [selApt]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [chunks]);

  // Realtime
  useEffect(() => {
    if (!selApt) return;
    const ch = supabase.channel(`reception-${selApt}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "karte_transcript_chunks", filter: `appointment_id=eq.${selApt}` }, (payload) => {
        setChunks(prev => [...prev, payload.new as Chunk]);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "karte_ai_drafts", filter: `appointment_id=eq.${selApt}` }, () => loadData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "karte_messages", filter: `appointment_id=eq.${selApt}` }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "karte_confirmations", filter: `appointment_id=eq.${selApt}` }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [selApt, loadData]);

  const getDraft = (key: string) => drafts.find(d => d.field_key === key);

  const approve = async (key: string, editedText?: string) => {
    await fetch("/api/karte-agent/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "approve", appointment_id: selApt, field_key: key, edited_text: editedText }),
    });
    setEditing(null);
    loadData();
  };

  const sendFieldMsg = async (field: string) => {
    const txt = fieldMsgInput[field];
    if (!txt?.trim()) return;
    await fetch("/api/karte-agent/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "message", appointment_id: selApt, direction: "to_unit", related_field: field, message_text: txt.trim() }),
    });
    setFieldMsgInput(p => ({ ...p, [field]: "" }));
    setFieldMsgOpen(null);
  };

  const regenerateDraft = async (key: string) => {
    await fetch("/api/karte-agent/generate-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: selApt, field_key: key }),
    });
    loadData();
  };

  const selectedUnit = units.find(u => u.appointment_id === selApt);
  const apCnt = STEPS.filter(st => { const d = getDraft(st.key); return d?.status === "approved" || d?.status === "confirmed"; }).length;

  return (
    <div style={{ fontFamily: "-apple-system,'Helvetica Neue','Noto Sans JP',sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#F8FAFC", color: "#1E293B" }}>
      <header style={{ background: "#FFF", padding: "8px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #E5E7EB", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22C55E" }} />
          <span style={{ fontSize: 16, fontWeight: 700 }}>カルテエージェント — 受付</span>
        </div>
        <span style={{ fontSize: 12, color: "#9CA3AF" }}>稼働: {units.length} ユニット</span>
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Unit list */}
        <div style={{ width: 220, background: "#FFF", borderRight: "1px solid #E5E7EB", overflow: "auto", flexShrink: 0 }}>
          <div style={{ padding: "12px 12px 6px", fontSize: 10, fontWeight: 700, color: "#9CA3AF", letterSpacing: "0.06em" }}>ユニット一覧</div>
          {units.length === 0 && <div style={{ padding: 16, fontSize: 13, color: "#D1D5DB" }}>診察中の患者がいません</div>}
          {units.map(u => {
            const isSel = u.appointment_id === selApt;
            return (
              <div key={u.appointment_id} onClick={() => setSelApt(u.appointment_id)}
                style={{ padding: "10px 12px", margin: "3px 6px", borderRadius: 12, cursor: "pointer", background: isSel ? "#EFF6FF" : "transparent", border: isSel ? "1.5px solid #BFDBFE" : "1.5px solid transparent", transition: "all 0.2s" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, fontWeight: 700 }}>{u.unit_name}</span>
                  <span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 5, background: u.type === "初診" ? "#FCE7F3" : "#DBEAFE", color: u.type === "初診" ? "#DB2777" : "#2563EB" }}>{u.type}</span>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 3 }}>{u.patient_name}</div>
              </div>
            );
          })}
        </div>

        {/* Transcript */}
        <div style={{ width: "35%", display: "flex", flexDirection: "column", borderRight: "1px solid #E5E7EB", background: "#FFF" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid #F3F4F6", flexShrink: 0 }}>
            {selectedUnit && (
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 16, fontWeight: 700 }}>{selectedUnit.patient_name}</span>
                  <span style={{ fontSize: 12, color: "#9CA3AF" }}>{selectedUnit.patient_age}歳{selectedUnit.patient_sex}</span>
                </div>
                {selectedUnit.allergies.length > 0 && selectedUnit.allergies.map(a => (
                  <span key={a} style={{ background: "#FEF2F2", color: "#DC2626", fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 6, marginRight: 4 }}>⚠ {a}</span>
                ))}
                {chunks.length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 4 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E" }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: "#22C55E" }}>文字起こし受信中 ({chunks.length}件)</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div ref={scrollRef} style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
            {chunks.length === 0 && <div style={{ padding: 20, textAlign: "center", fontSize: 13, color: "#D1D5DB" }}>診察室で録音が開始されると文字起こしが表示されます</div>}
            {chunks.map((c, i) => {
              const tag = STEPS.find(s => s.key === c.classified_field);
              return (
                <div key={c.id || i} style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
                    <span style={{ fontSize: 9, color: "#D1D5DB" }}>{new Date(c.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: c.speaker_role === "dr" ? "#2563EB" : c.speaker_role === "patient" ? "#6B7280" : "#111827" }}>{c.speaker_role}</span>
                    {tag && <span style={{ fontSize: 8, fontWeight: 600, padding: "1px 4px", borderRadius: 3, background: "#F3F4F6", color: "#6B7280" }}>→{tag.short}</span>}
                  </div>
                  <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6, padding: "6px 10px", borderRadius: 8, background: "#F9FAFB", borderLeft: "3px solid " + (c.speaker_role === "dr" ? "#2563EB" : c.speaker_role === "patient" ? "#D1D5DB" : "#111827") }}>
                    {c.corrected_text || c.raw_text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Approval cards */}
        <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 3, marginBottom: 4 }}>
            {STEPS.map(st => {
              const d = getDraft(st.key); const done = d?.status === "approved" || d?.status === "confirmed"; const has = !!d;
              return <div key={st.key} style={{ flex: 1, textAlign: "center", padding: "5px 0", borderRadius: 8, background: done ? "#F0FDF4" : has ? "#FFFBEB" : "#F9FAFB", border: "1px solid " + (done ? "#D1FAE5" : has ? "#FDE68A" : "#E5E7EB"), transition: "all 0.4s" }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: done ? "#16A34A" : has ? "#D97706" : "#D1D5DB" }}>{done ? "✓" : has ? "!" : "·"}</div>
                <div style={{ fontSize: 10, fontWeight: 600, color: "#374151" }}>{st.label}</div>
              </div>;
            })}
          </div>

          {STEPS.map(st => {
            const d = getDraft(st.key); const done = d?.status === "approved" || d?.status === "confirmed"; const isEd = editing === st.key;
            const isMsgOpen = fieldMsgOpen === st.key;
            const fieldChunks = chunks.filter(c => c.classified_field === st.key);
            return (
              <div key={st.key} style={{ background: "#FFF", borderRadius: 12, border: "1px solid " + (done ? "#D1FAE5" : d ? "#FDE68A" : "#E5E7EB"), overflow: "hidden", transition: "all 0.3s" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px" }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{st.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {fieldChunks.length > 0 && !d && (
                      <button onClick={() => regenerateDraft(st.key)} style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 6, padding: "3px 8px", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>AI生成</button>
                    )}
                    {done ? <span style={{ fontSize: 11, fontWeight: 600, color: "#16A34A" }}>✓ 承認済</span>
                      : d ? <span style={{ fontSize: 10, fontWeight: 600, color: "#D97706" }}>AI完了</span>
                      : chunks.length > 0 ? <span style={{ fontSize: 10, color: "#9CA3AF" }}>{fieldChunks.length}件</span>
                      : <span style={{ fontSize: 10, color: "#D1D5DB" }}>待機</span>}
                  </div>
                </div>
                {d && (
                  <div style={{ padding: "0 14px 12px" }}>
                    {isEd ? (
                      <div>
                        <textarea value={editVal} onChange={e => setEditVal(e.target.value)} style={{ width: "100%", background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: 10, fontSize: 13, color: "#111827", outline: "none", resize: "vertical", minHeight: 70, lineHeight: 1.7 }} />
                        <div style={{ display: "flex", gap: 6, marginTop: 6, justifyContent: "flex-end" }}>
                          <button onClick={() => setEditing(null)} style={{ background: "#F3F4F6", color: "#6B7280", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>キャンセル</button>
                          <button onClick={() => approve(st.key, editVal)} style={{ background: "#111827", color: "#FFF", border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>保存して承認</button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ background: "#F9FAFB", borderRadius: 8, padding: 10, fontSize: 13, color: "#374151", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{d.draft_text}</div>
                        <div style={{ display: "flex", gap: 6, marginTop: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                          <button onClick={() => setFieldMsgOpen(isMsgOpen ? null : st.key)} style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>💬 診察室へ</button>
                          <button onClick={() => regenerateDraft(st.key)} style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>🔄 再生成</button>
                          {!done && <button onClick={() => { setEditing(st.key); setEditVal(d.draft_text); }} style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 8, padding: "5px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✏ 修正</button>}
                          {!done && <button onClick={() => approve(st.key)} style={{ background: "#111827", color: "#FFF", border: "none", borderRadius: 8, padding: "5px 16px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>✓ 承認</button>}
                        </div>
                        {isMsgOpen && (
                          <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                            <input value={fieldMsgInput[st.key] || ""} onChange={e => setFieldMsgInput(p => ({ ...p, [st.key]: e.target.value }))} onKeyDown={e => e.key === "Enter" && sendFieldMsg(st.key)}
                              placeholder={`${st.label}について連絡…`} style={{ flex: 1, background: "#F9FAFB", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 10px", fontSize: 12, outline: "none" }} />
                            <button onClick={() => sendFieldMsg(st.key)} style={{ background: "#111827", color: "#FFF", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>送信</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {confirmed && (
            <div style={{ background: "#F0FDF4", borderRadius: 12, padding: 14, border: "1px solid #D1FAE5", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#16A34A" }}>✅ カルテ確定済み</div>
            </div>
          )}
          {apCnt >= 5 && !confirmed && (
            <div style={{ background: "#FFFBEB", borderRadius: 12, padding: 14, border: "1px solid #FDE68A", textAlign: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "#92400E" }}>全項目承認済み — 診察室の確定待ち</span>
            </div>
          )}
          <div style={{ height: 20, flexShrink: 0 }} />
        </div>
      </div>
    </div>
  );
}
