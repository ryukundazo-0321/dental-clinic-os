"use client";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";

const STEPS = [
  { key: "s", label: "主訴(S)" },
  { key: "tooth", label: "歯式" },
  { key: "perio", label: "P検" },
  { key: "dh", label: "DH記録" },
  { key: "dr", label: "Dr診察" },
];

const WHISPER_PROMPT = "歯科診療所での医師・衛生士と患者の会話。「右下6番、C2ですね。CR充填しましょう。浸麻します。」「痛みはどうですか？」「冷たいものがしみます。」う蝕 C1 C2 C3 C4 FMC CAD/CAM冠 CR充填 インレー 抜髄 根管治療 感根治 根充 TEK SC SRP PMTC TBI P検 BOP PPD 印象 咬合採得 形成 装着 ロキソニン フロモックス カロナール クラビット 右上 左上 右下 左下 1番 2番 3番 4番 5番 6番 7番 8番 歯周炎 歯髄炎 根尖性歯周炎";

function UnitContent() {
  const params = useSearchParams();
  const appointmentId = params.get("appointment_id") || "";

  const [patient, setPatient] = useState<{ name: string; age: number; allergies: string[] } | null>(null);
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { draft_text: string; status: string }>>({});
  const [messages, setMessages] = useState<{ related_field: string | null; message_text: string; created_at: string }[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  const mediaRec = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioChunks = useRef<Blob[]>([]);

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
        setPatient({ name: p.name_kanji, age, allergies: p.allergies || [] });
      }
    })();
  }, [appointmentId]);

  // Load existing drafts & transcript
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
    const { data: chunks } = await supabase
      .from("karte_transcript_chunks")
      .select("corrected_text, raw_text")
      .eq("appointment_id", appointmentId)
      .order("chunk_index", { ascending: true });
    if (chunks && chunks.length > 0) {
      setTranscript(chunks.map((c: { corrected_text: string; raw_text: string }) => c.corrected_text || c.raw_text).join("\n"));
    }
  }, [appointmentId]);

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

  // Realtime
  useEffect(() => {
    if (!appointmentId) return;
    const channel = supabase
      .channel(`unit-${appointmentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "karte_ai_drafts", filter: `appointment_id=eq.${appointmentId}` }, () => loadDrafts())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "karte_messages", filter: `appointment_id=eq.${appointmentId}` }, () => loadMessages())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [appointmentId, loadDrafts, loadMessages]);

  // Timer
  useEffect(() => {
    if (recording) { timerRef.current = setInterval(() => setRecTime(t => t + 1), 1000); }
    else if (timerRef.current) { clearInterval(timerRef.current); }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording]);

  // ===== RECORDING =====
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRec.current = mr;
      audioChunks.current = [];
      mr.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mr.start(1000);
      setRecording(true);
      setRecTime(0);
      setStatus("🎙 録音中… 停止するとAIが文字起こし＆振り分けします");
    } catch (e) {
      console.error("Mic error:", e);
      setStatus("❌ マイクにアクセスできません");
    }
  };

  const stopRecording = async () => {
    if (!mediaRec.current || mediaRec.current.state === "inactive") return;
    const blob = await new Promise<Blob>((resolve) => {
      mediaRec.current!.onstop = () => resolve(new Blob(audioChunks.current, { type: "audio/webm" }));
      mediaRec.current!.stop();
      mediaRec.current!.stream.getTracks().forEach(t => t.stop());
    });
    setRecording(false);
    setTranscribing(true);
    setStatus("📝 Whisperで文字起こし中...");

    try {
      const tokenRes = await fetch("/api/whisper-token");
      const tokenData = await tokenRes.json();
      if (!tokenData.key) { setStatus("❌ APIキーの取得に失敗"); setTranscribing(false); return; }

      const fd = new FormData();
      fd.append("file", blob, "recording.webm");
      fd.append("model", "whisper-1");
      fd.append("language", "ja");
      fd.append("prompt", WHISPER_PROMPT);
      fd.append("temperature", "0");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${tokenData.key}` },
        body: fd,
      });

      if (!whisperRes.ok) { setStatus(`❌ 音声認識エラー（${whisperRes.status}）`); setTranscribing(false); return; }

      const whisperResult = await whisperRes.json();
      let rawTranscript = whisperResult.text || "";

      if (!rawTranscript || rawTranscript.trim().length < 5) {
        setStatus("⚠️ 音声を認識できませんでした。もう少し長く話してください。");
        setTranscribing(false);
        return;
      }

      // Correct dental terms
      try {
        const corrRes = await fetch("/api/voice-analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ whisper_only: true, raw_transcript: rawTranscript }),
        });
        if (corrRes.ok) {
          const corrData = await corrRes.json();
          if (corrData.success && corrData.transcript) rawTranscript = corrData.transcript;
        }
      } catch (e) { console.log("Correction skipped:", e); }

      setTranscript(rawTranscript);
      setStatus("🤖 AI振り分け中...");

      // Send to classify-and-draft API
      const classifyRes = await fetch("/api/karte-agent/classify-and-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appointmentId, transcript: rawTranscript }),
      });

      if (classifyRes.ok) {
        const result = await classifyRes.json();
        if (result.success) {
          setStatus(`✅ ${result.fields_generated}フィールド生成完了！受付で確認中…`);
          loadDrafts();
        } else {
          setStatus("⚠️ " + (result.error || "AI振り分けに問題がありました"));
        }
      } else {
        setStatus("❌ AI振り分けエラー");
      }
    } catch (e) {
      console.error("Transcription error:", e);
      setStatus("❌ 文字起こしに失敗しました");
    }
    setTranscribing(false);
  };

  const handleConfirm = async () => {
    const res = await fetch("/api/karte-agent/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm", appointment_id: appointmentId }),
    });
    const data = await res.json();
    if (data.success) { setConfirmed(true); setConfirmId(data.confirmation_id); }
    else { setStatus("❌ " + (data.error || "確定に失敗")); }
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
  const hasDrafts = Object.keys(drafts).length > 0;
  const fmt = (s: number) => String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");

  if (!appointmentId) {
    return <div style={{ padding: 40, textAlign: "center", fontFamily: "sans-serif" }}>
      <p>appointment_id が指定されていません</p>
    </div>;
  }

  return (
    <div style={{ fontFamily: "-apple-system,'Helvetica Neue','Noto Sans JP',sans-serif", height: "100vh", display: "flex", flexDirection: "column", background: "#F8FAFC", color: "#1E293B" }}>
      <header style={{ background: "#FFF", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #E5E7EB" }}>
        <span style={{ fontSize: 16, fontWeight: 700 }}>🩺 カルテエージェント — 診察室</span>
        {patient && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{patient.name}</span>
            <span style={{ fontSize: 12, color: "#9CA3AF" }}>{patient.age}歳</span>
            {patient.allergies.map(a => <span key={a} style={{ background: "#FEF2F2", color: "#DC2626", fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 6 }}>⚠ {a}</span>)}
          </div>
        )}
      </header>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ width: "40%", display: "flex", flexDirection: "column", alignItems: "center", padding: "24px 20px", gap: 16, borderRight: "1px solid #E5E7EB", overflow: "auto" }}>

          {!recording && !transcribing && !confirmed && !hasDrafts ? (
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
              <button onClick={stopRecording} style={{ marginTop: 12, background: "#111827", color: "#FFF", border: "none", borderRadius: 10, padding: "10px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>⏹ 停止して文字起こし</button>
            </div>
          ) : transcribing ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ width: 100, height: 100, borderRadius: "50%", background: "#EFF6FF", border: "3px solid #3B82F6", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <div style={{ fontSize: 32, animation: "pulse 1.5s infinite" }}>🤖</div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#3B82F6", marginTop: 8 }}>AI処理中...</div>
            </div>
          ) : confirmed ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 48 }}>✅</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: "#16A34A", marginTop: 6 }}>カルテ確定済み</div>
            </div>
          ) : hasDrafts ? (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#6B7280" }}>受付で確認中</div>
              <button onClick={startRecording} style={{ marginTop: 10, background: "#F9FAFB", color: "#374151", border: "1px solid #E5E7EB", borderRadius: 10, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🎙 追加録音</button>
            </div>
          ) : null}

          {status && <div style={{ fontSize: 12, color: "#6B7280", textAlign: "center", maxWidth: 300, lineHeight: 1.5 }}>{status}</div>}

          <div style={{ width: "100%", maxWidth: 340 }}>
            <div style={{ display: "flex", gap: 3 }}>
              {STEPS.map(st => {
                const d = drafts[st.key]; const done = d?.status === "approved" || d?.status === "confirmed"; const has = !!d;
                return <div key={st.key} style={{ flex: 1, textAlign: "center", padding: "7px 0", borderRadius: 8, background: done ? "#F0FDF4" : has ? "#FFFBEB" : "#F9FAFB", border: "1px solid " + (done ? "#D1FAE5" : has ? "#FDE68A" : "#E5E7EB") }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: done ? "#16A34A" : has ? "#D97706" : "#D1D5DB" }}>{done ? "✓" : has ? "!" : "·"}</div>
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

          {transcript && (
            <div style={{ width: "100%", maxWidth: 340 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 4 }}>📝 文字起こし結果</div>
              <div style={{ background: "#F9FAFB", borderRadius: 8, padding: 10, fontSize: 12, color: "#374151", lineHeight: 1.7, maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap" }}>{transcript}</div>
            </div>
          )}

          {messages.length > 0 && (
            <div style={{ width: "100%", maxWidth: 340 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#9CA3AF", marginBottom: 4 }}>📨 受付から</div>
              {messages.slice(-5).map((m, i) => (
                <div key={i} style={{ padding: "8px 12px", marginBottom: 4, borderRadius: 8, background: "#F9FAFB", border: "1px solid #E5E7EB", fontSize: 13 }}>
                  {m.related_field && <span style={{ fontSize: 10, fontWeight: 600, color: "#6B7280", marginRight: 6 }}>[{STEPS.find(s => s.key === m.related_field)?.label}]</span>}
                  {m.message_text}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>カルテ内容</div>
          {STEPS.map(st => {
            const d = drafts[st.key]; const done = d?.status === "approved" || d?.status === "confirmed"; const has = !!d;
            return (
              <div key={st.key} style={{ background: "#FFF", borderRadius: 12, padding: 14, border: "1px solid " + (done ? "#D1FAE5" : has ? "#FDE68A" : "#E5E7EB"), opacity: has ? 1 : 0.35 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{st.label}</span>
                  {done && <span style={{ fontSize: 11, fontWeight: 600, color: "#16A34A" }}>✓ 承認済</span>}
                  {has && !done && <span style={{ fontSize: 11, fontWeight: 600, color: "#D97706" }}>受付確認中</span>}
                </div>
                {has && d ? (
                  <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.8, whiteSpace: "pre-wrap", marginTop: 8 }}>{d.draft_text}</div>
                ) : (
                  <div style={{ fontSize: 13, color: "#D1D5DB", fontStyle: "italic", marginTop: 4 }}>—</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.5 } }`}</style>
    </div>
  );
}

export default function KarteAgentUnit() {
  return <Suspense fallback={<div style={{ padding: 40, textAlign: "center" }}>読み込み中...</div>}><UnitContent /></Suspense>;
}
