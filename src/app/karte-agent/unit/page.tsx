"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";

const STEPS = [
  { key: "s", label: "主訴(S)" },
  { key: "tooth", label: "歯式" },
  { key: "perio", label: "P検" },
  { key: "dh", label: "DH記録" },
  { key: "dr", label: "Dr診察" },
];

export default function KarteAgentUnit() {
  const params = useSearchParams();
  const appointmentId = params.get("appointment_id") || "";

  const [patient, setPatient] = useState<{ name: string; age: number; sex: string; allergies: string[] } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [chunkIndex, setChunkIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, { draft_text: string; status: string }>>({});
  const [messages, setMessages] = useState<{ related_field: string | null; message_text: string; created_at: string }[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const mediaRec = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load patient info
  useEffect(() => {
    if (!appointmentId) return;
    (async () => {
      const { data: apt } = await supabase
        .from("appointments")
        .select("patient_id, patients(name_kanji, date_of_birth, allergies)")
        .eq("id", appointmentId)
        .single();
      if (apt?.patients) {
        const p = apt.patients as unknown as { name_kanji: string; date_of_birth: string; allergies: string[] | null };
        const age = p.date_of_birth ? Math.floor((Date.now() - new Date(p.date_of_birth).getTime()) / 31557600000) : 0;
        setPatient({ name: p.name_kanji, age, sex: "", allergies: p.allergies || [] });
      }
    })();
  }, [appointmentId]);

  // Load existing drafts
  const loadDrafts = useCallback(async () => {
    if (!appointmentId) return;
    const { data } = await supabase
      .from("karte_ai_drafts")
      .select("field_key, draft_text, status")
      .eq("appointment_id", appointmentId);
    if (data) {
      const d: Record<string, { draft_text: string; status: string }> = {};
      data.forEach((r: { field_key: string; draft_text: string; status: string }) => { d[r.field_key] = r; });
      setDrafts(d);
      if (Object.keys(d).length >= 5 && Object.values(d).every(v => v.status === "confirmed")) setConfirmed(true);
      else setConfirmed(false);
    }
  }, [appointmentId]);

  // Load messages
  const loadMessages = useCallback(async () => {
    if (!appointmentId) return;
    const { data } = await supabase
      .from("karte_messages")
      .select("related_field, message_text, created_at")
      .eq("appointment_id", appointmentId)
      .eq("direction", "to_unit")
      .order("created_at", { ascending: true });
    if (data) setMessages(data);
  }, [appointmentId]);

  useEffect(() => { loadDrafts(); loadMessages(); }, [loadDrafts, loadMessages]);

  // Realtime subscriptions
  useEffect(() => {
    if (!appointmentId) return;
    const channel = supabase
      .channel(`unit-${appointmentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "karte_ai_drafts", filter: `appointment_id=eq.${appointmentId}` }, () => loadDrafts())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "karte_messages", filter: `appointment_id=eq.${appointmentId}` }, () => loadMessages())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [appointmentId, loadDrafts, loadMessages]);

  // Recording timer
  useEffect(() => {
    if (recording) { timerRef.current = setInterval(() => setRecTime(t => t + 1), 1000); }
    else if (timerRef.current) { clearInterval(timerRef.current); }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRec.current = mr;

      const chunksRef = { current: [] as Blob[] };
      mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };

      // Send chunk every 15 seconds for better Whisper accuracy
      chunkTimerRef.current = setInterval(() => {
        if (mr.state === "recording" && chunksRef.current.length > 0) {
          const blob = new Blob(chunksRef.current, { type: "audio/webm" });
          chunksRef.current = [];
          sendChunk(blob);
        }
      }, 15000);

      // Store ref so stopRecording can flush remaining
      (mediaRec as unknown as Record<string, unknown>).chunksRef = chunksRef;

      mr.start(1000); // collect data every 1s
      setRecording(true);
      setRecTime(0);
      setStatus("録音中... (15秒ごとに送信)");
    } catch (e) {
      console.error("Mic error:", e);
      setStatus("マイクにアクセスできません");
    }
  };

  const stopRecording = () => {
    // Send any remaining audio
    const chunksRef = (mediaRec as unknown as Record<string, unknown>).chunksRef as { current: Blob[] } | undefined;
    if (chunksRef && chunksRef.current.length > 0) {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      chunksRef.current = [];
      sendChunk(blob);
    }
    if (mediaRec.current && mediaRec.current.state !== "inactive") {
      mediaRec.current.stop();
      mediaRec.current.stream.getTracks().forEach(t => t.stop());
    }
    if (chunkTimerRef.current) clearInterval(chunkTimerRef.current);
    setRecording(false);
    setStatus("録音停止 — 受付で承認中");
  };

  const sendChunk = async (blob: Blob) => {
    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64 = (reader.result as string).split(",")[1];
        const idx = chunkIndex;
        setChunkIndex(p => p + 1);

        await fetch("/api/karte-agent/stream-chunk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appointmentId, chunk_index: idx, audio_base64: base64 }),
        });
      };
      reader.readAsDataURL(blob);
    } catch (e) {
      console.error("Send chunk error:", e);
    }
  };

  const handleConfirm = async () => {
    const res = await fetch("/api/karte-agent/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", appointment_id: appointmentId }),
    });
    const data = await res.json();
    if (data.success) {
      setConfirmed(true);
      setConfirmId(data.confirmation_id);
    }
  };

  const handleRevoke = async () => {
    if (!confirmId) return;
    await fetch("/api/karte-agent/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke", confirmation_id: confirmId, reason: "Dr修正" }),
    });
    setConfirmed(false);
    setConfirmId(null);
    loadDrafts();
  };

  const apCnt = STEPS.filter(st => drafts[st.key]?.status === "approved" || drafts[st.key]?.status === "confirmed").length;
  const fmt = (s: number) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");

  if (!appointmentId) {
    return <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>
      <p>appointment_id が指定されていません</p>
      <p style={{ color: "#999", fontSize: 14 }}>URLに ?appointment_id=xxx を追加してください</p>
    </div>;
  }

  return (
    <div style={{ fontFamily: "-apple-system,'Helvetica Neue','Noto Sans JP',sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#F8FAFC", color: "#1E293B" }}>
      <header style={{ background: "#FFF", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #E5E7EB" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 16, fontWeight: 700 }}>🩺 カルテエージェント — 診察室</span>
        </div>
        {patient && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{patient.name}</span>
            <span style={{ fontSize: 12, color: "#9CA3AF" }}>{patient.age}歳{patient.sex}</span>
            {patient.allergies.map(a => <span key={a} style={{ background: "#FEF2F2", color: "#DC2626", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6 }}>⚠ {a}</span>)}
          </div>
        )}
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: recording + progress */}
        <div style={{ width: "40%", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 20px", gap: 20, borderRight: "1px solid #E5E7EB", overflow: "auto" }}>
          {!recording && !confirmed ? (
            <button onClick={startRecording} style={{ width: 150, height: 150, borderRadius: "50%", background: "#111827", border: "none", cursor: "pointer", color: "#FFF", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <div style={{ fontSize: 40 }}>🎙</div>
              <div style={{ fontSize: 15, fontWeight: 800, marginTop: 4 }}>録音開始</div>
            </button>
          ) : recording ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 130, height: 130, borderRadius: "50%", background: "#FEF2F2", border: "3px solid #EF4444", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 28, fontWeight: 900, fontFamily: "monospace" }}>{fmt(recTime)}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#EF4444" }}>録音中</div>
              </div>
              <button onClick={stopRecording} style={{ marginTop: 12, background: "#111827", color: "#FFF", border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>⏹ 停止</button>
            </div>
          ) : confirmed ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 48 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#16A34A", marginTop: 6 }}>カルテ確定済み</div>
            </div>
          ) : null}

          {status && <div style={{ fontSize: 13, color: "#9CA3AF" }}>{status}</div>}

          {/* Progress */}
          <div style={{ width: "100%", maxWidth: 340 }}>
            <div style={{ display: "flex", gap: 3 }}>
              {STEPS.map(st => {
                const d = drafts[st.key]; const done = d?.status === "approved" || d?.status === "confirmed";
                return <div key={st.key} style={{ flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 8, background: done ? "#F0FDF4" : "#F9FAFB", border: "1px solid " + (done ? "#D1FAE5" : "#E5E7EB"), transition: "all 0.4s" }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: done ? "#16A34A" : "#D1D5DB" }}>{done ? "✓" : "·"}</div>
                  <div style={{ fontSize: 10, fontWeight: 600, color: "#374151" }}>{st.label}</div>
                </div>;
              })}
            </div>
            <div style={{ textAlign: "center", fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>{apCnt}/5 承認済み</div>
          </div>

          {apCnt >= 5 && !confirmed && (
            <button onClick={handleConfirm} style={{ background: "#111827", color: "#FFF", border: "none", borderRadius: 14, padding: "14px 36px", fontSize: 16, fontWeight: 800, cursor: "pointer" }}>カルテ確定する</button>
          )}
          {confirmed && (
            <button onClick={handleRevoke} style={{ background: "#F9FAFB", color: "#6B7280", border: "1px solid #E5E7EB", borderRadius: 10, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>↩ 確定取り消し</button>
          )}

          {messages.length > 0 && (
            <div style={{ width: "100%", maxWidth: 340 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#9CA3AF", marginBottom: 4 }}>📨 受付から</div>
              {messages.slice(-5).map((m, i) => (
                <div key={i} style={{ padding: "8px 12px", marginBottom: 4, borderRadius: 8, background: "#F9FAFB", border: "1px solid #E5E7EB", fontSize: 13, color: "#111827" }}>
                  {m.related_field && <span style={{ fontSize: 10, fontWeight: 600, color: "#6B7280", marginRight: 6 }}>[{STEPS.find(s => s.key === m.related_field)?.label}]</span>}
                  {m.message_text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: approved content */}
        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>カルテ内容</div>
          {STEPS.map(st => {
            const d = drafts[st.key]; const done = d?.status === "approved" || d?.status === "confirmed";
            return (
              <div key={st.key} style={{ background: "#FFF", borderRadius: 12, padding: 14, border: "1px solid " + (done ? "#D1FAE5" : "#E5E7EB"), opacity: done ? 1 : 0.35, transition: "all 0.4s" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{st.label}</span>
                  {done && <span style={{ fontSize: 11, fontWeight: 600, color: "#16A34A" }}>✓</span>}
                </div>
                {done && d ? (
                  <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.8, whiteSpace: "pre-wrap", marginTop: 8 }}>{d.draft_text}</div>
                ) : (
                  <div style={{ fontSize: 13, color: "#D1D5DB", fontStyle: "italic", marginTop: 4 }}>{d ? "受付確認中…" : "—"}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
