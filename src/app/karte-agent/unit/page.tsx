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

const UR=["18","17","16","15","14","13","12","11"];
const UL=["21","22","23","24","25","26","27","28"];
const LR=["48","47","46","45","44","43","42","41"];
const LL=["31","32","33","34","35","36","37","38"];

const TS: Record<string,{bg:string;tx:string;lb:string;bd:string}> = {
  normal:{bg:"#F1F5F9",tx:"#94A3B8",lb:"",bd:"#E2E8F0"},
  c0:{bg:"#FEF9C3",tx:"#854D0E",lb:"CO",bd:"#FDE68A"},c1:{bg:"#FEF9C3",tx:"#854D0E",lb:"C1",bd:"#FDE68A"},
  c2:{bg:"#FDE68A",tx:"#78350F",lb:"C2",bd:"#F59E0B"},c3:{bg:"#FB923C",tx:"#FFF",lb:"C3",bd:"#EA580C"},
  c4:{bg:"#DC2626",tx:"#FFF",lb:"C4",bd:"#B91C1C"},
  in_treatment:{bg:"#A78BFA",tx:"#FFF",lb:"治",bd:"#7C3AED"},treated:{bg:"#86EFAC",tx:"#166534",lb:"済",bd:"#22C55E"},
  cr:{bg:"#60A5FA",tx:"#FFF",lb:"CR",bd:"#3B82F6"},inlay:{bg:"#38BDF8",tx:"#FFF",lb:"In",bd:"#0EA5E9"},
  crown:{bg:"#2DD4BF",tx:"#FFF",lb:"冠",bd:"#14B8A6"},
  missing:{bg:"#E2E8F0",tx:"#CBD5E1",lb:"✕",bd:"#CBD5E1"},root_remain:{bg:"#FECACA",tx:"#991B1B",lb:"残",bd:"#F87171"},
  br_abutment:{bg:"#C4B5FD",tx:"#5B21B6",lb:"Br",bd:"#8B5CF6"},br_pontic:{bg:"#DDD6FE",tx:"#7C3AED",lb:"Po",bd:"#A78BFA"},
  implant:{bg:"#818CF8",tx:"#FFF",lb:"Imp",bd:"#6366F1"},watch:{bg:"#FEF3C7",tx:"#92400E",lb:"経",bd:"#FBBF24"},
};

function getPrimary(chart:Record<string,string|string[]>,t:string):string{
  const v=chart[t]; if(!v) return "normal";
  const arr=Array.isArray(v)?v:[v]; if(arr.length===0) return "normal";
  const pri=["c4","c3","c2","c1","c0","in_treatment","missing","root_remain","br_pontic","br_abutment","implant","crown","inlay","cr","treated","watch"];
  for(const p of pri){if(arr.includes(p))return p;} return arr[0]||"normal";
}

function UnitContent() {
  const params = useSearchParams();
  const appointmentId = params.get("appointment_id") || "";

  // Mode: "batch" = Option B, "realtime" = Option A
  const [mode, setMode] = useState<"batch"|"realtime">("batch");
  const [patient, setPatient] = useState<{name:string;age:number;allergies:string[];id:string}|null>(null);
  const [recording, setRecording] = useState(false);
  const [recTime, setRecTime] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [realtimeLines, setRealtimeLines] = useState<{text:string;time:string;isFinal:boolean}[]>([]);
  const [drafts, setDrafts] = useState<Record<string,{draft_text:string;status:string}>>({});
  const [messages, setMessages] = useState<{related_field:string|null;message_text:string;created_at:string}[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmId, setConfirmId] = useState<string|null>(null);
  const [status, setStatus] = useState("");

  // Dental chart & perio
  const [toothChart, setToothChart] = useState<Record<string,string|string[]>>({});
  const [perioData, setPerioData] = useState<Record<string,{buccal:[number,number,number];lingual:[number,number,number];bop:boolean;mobility:number}>>({});
  const [recordId, setRecordId] = useState<string|null>(null);
  const [xrayUploading, setXrayUploading] = useState(false);

  // Refs for batch mode
  const mediaRec = useRef<MediaRecorder|null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval>|null>(null);
  const audioChunks = useRef<Blob[]>([]);

  // Refs for realtime mode
  const pcRef = useRef<RTCPeerConnection|null>(null);
  const dcRef = useRef<RTCDataChannel|null>(null);
  const streamRef = useRef<MediaStream|null>(null);
  const realtimeTranscript = useRef("");
  // Delta throttling: upsert partial text to Supabase every 1s so reception sees it live
  const deltaChunkId = useRef<number|null>(null);
  const pendingDeltaText = useRef("");
  const deltaFlushTimer = useRef<ReturnType<typeof setTimeout>|null>(null);

  const flushDeltaToSupabase = useCallback(()=>{
    if(!pendingDeltaText.current||!deltaChunkId.current||!appointmentId) return;
    const text=pendingDeltaText.current;
    const cid=deltaChunkId.current;
    supabase.from("karte_transcript_chunks").upsert({
      appointment_id:appointmentId,
      chunk_index:cid,
      raw_text:text,
      corrected_text:text,
      speaker_role:"mixed",
      classified_field:null,
    },{onConflict:"appointment_id,chunk_index"}).then(()=>{});
  },[appointmentId]);

  // Load patient + dental chart + perio
  useEffect(()=>{
    if(!appointmentId) return;
    (async()=>{
      const {data:apt}=await supabase.from("appointments")
        .select("patient_id, patients(id, name_kanji, date_of_birth, allergies, current_tooth_chart, current_perio_chart)")
        .eq("id",appointmentId).single();
      if(apt?.patients){
        const p=apt.patients as unknown as {id:string;name_kanji:string;date_of_birth:string;allergies:string[]|null;current_tooth_chart:Record<string,unknown>|null;current_perio_chart:Record<string,unknown>|null};
        const age=p.date_of_birth?Math.floor((Date.now()-new Date(p.date_of_birth).getTime())/31557600000):0;
        setPatient({name:p.name_kanji,age,allergies:p.allergies||[],id:p.id});
        // Load tooth chart from current medical_record or patient's baseline
        const {data:rec}=await supabase.from("medical_records").select("id, tooth_chart").eq("appointment_id",appointmentId).order("created_at",{ascending:false}).limit(1).single();
        if(rec){
          setRecordId(rec.id);
          if(rec.tooth_chart&&Object.keys(rec.tooth_chart as object).length>0) setToothChart(rec.tooth_chart as Record<string,string|string[]>);
          else if(p.current_tooth_chart){
            const tc:Record<string,string|string[]>={};
            Object.entries(p.current_tooth_chart).forEach(([k,v])=>{
              if(typeof v==="string") tc[k]=v;
              else if(typeof v==="object"&&v&&"status" in (v as Record<string,string>)) tc[k]=(v as Record<string,string>).status;
            });
            setToothChart(tc);
          }
        }
        // Load perio
        if(p.current_perio_chart&&typeof p.current_perio_chart==="object"){
          setPerioData(p.current_perio_chart as Record<string,{buccal:[number,number,number];lingual:[number,number,number];bop:boolean;mobility:number}>);
        }
      }
    })();
  },[appointmentId]);

  // Load drafts & transcript
  const loadDrafts = useCallback(async()=>{
    if(!appointmentId) return;
    const {data}=await supabase.from("karte_ai_drafts").select("field_key, draft_text, status").eq("appointment_id",appointmentId);
    if(data){
      const d:Record<string,{draft_text:string;status:string}>={};
      data.forEach((r:{field_key:string;draft_text:string;status:string})=>{d[r.field_key]=r;});
      setDrafts(d);
      if(Object.keys(d).length>=5&&Object.values(d).every(v=>v.status==="confirmed")) setConfirmed(true);
      else setConfirmed(false);
    }
    const {data:chunks}=await supabase.from("karte_transcript_chunks").select("corrected_text, raw_text")
      .eq("appointment_id",appointmentId).order("chunk_index",{ascending:true});
    if(chunks&&chunks.length>0) setTranscript(chunks.map((c:{corrected_text:string;raw_text:string})=>c.corrected_text||c.raw_text).join("\n"));
  },[appointmentId]);

  const loadMessages = useCallback(async()=>{
    if(!appointmentId) return;
    const {data}=await supabase.from("karte_messages").select("related_field, message_text, created_at")
      .eq("appointment_id",appointmentId).eq("direction","to_unit").order("created_at",{ascending:true});
    if(data) setMessages(data);
  },[appointmentId]);

  useEffect(()=>{loadDrafts();loadMessages();},[loadDrafts,loadMessages]);

  // Realtime subscriptions
  useEffect(()=>{
    if(!appointmentId) return;
    const channel=supabase.channel(`unit-${appointmentId}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"karte_ai_drafts",filter:`appointment_id=eq.${appointmentId}`},()=>loadDrafts())
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"karte_messages",filter:`appointment_id=eq.${appointmentId}`},()=>loadMessages())
      .subscribe();
    return ()=>{supabase.removeChannel(channel);};
  },[appointmentId,loadDrafts,loadMessages]);

  // Timer
  useEffect(()=>{
    if(recording){timerRef.current=setInterval(()=>setRecTime(t=>t+1),1000);}
    else if(timerRef.current){clearInterval(timerRef.current);}
    return ()=>{if(timerRef.current) clearInterval(timerRef.current);};
  },[recording]);

  // ===== OPTION B: BATCH RECORDING =====
  const startBatch = async()=>{
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      const mr=new MediaRecorder(stream,{mimeType:"audio/webm;codecs=opus"});
      mediaRec.current=mr; audioChunks.current=[];
      mr.ondataavailable=(e)=>{if(e.data.size>0) audioChunks.current.push(e.data);};
      mr.start(1000);
      setRecording(true); setRecTime(0);
      setStatus("🎙 録音中… 停止するとAIが文字起こし＆振り分けします");
    }catch(e){console.error("Mic error:",e);setStatus("❌ マイクにアクセスできません");}
  };

  const stopBatch = async()=>{
    if(!mediaRec.current||mediaRec.current.state==="inactive") return;
    const blob=await new Promise<Blob>((resolve)=>{
      mediaRec.current!.onstop=()=>resolve(new Blob(audioChunks.current,{type:"audio/webm"}));
      mediaRec.current!.stop();
      mediaRec.current!.stream.getTracks().forEach(t=>t.stop());
    });
    setRecording(false); setTranscribing(true); setStatus("📝 文字起こし中...");
    if(recTime<3){setStatus("⚠️ 録音が短すぎます（3秒以上録音してください）");setTranscribing(false);return;}
    try{
      const tokenRes=await fetch("/api/whisper-token"); const tokenData=await tokenRes.json();
      if(!tokenData.key){setStatus("❌ APIキー取得失敗");setTranscribing(false);return;}
      const fd=new FormData();
      fd.append("file",blob,"recording.webm"); fd.append("model","gpt-4o-transcribe");
      fd.append("language","ja");
      const whisperRes=await fetch("https://api.openai.com/v1/audio/transcriptions",{
        method:"POST",headers:{Authorization:`Bearer ${tokenData.key}`},body:fd});
      if(!whisperRes.ok){setStatus(`❌ 音声認識エラー（${whisperRes.status}）`);setTranscribing(false);return;}
      const wr=await whisperRes.json(); let raw=wr.text||"";
      if(!raw||raw.trim().length<5){setStatus("⚠️ 音声を認識できませんでした");setTranscribing(false);return;}
      // 文字起こし完了 → そのままAI振り分けへ（補正ステップ不要、gpt-4o-transcribeは十分高精度）
      setTranscript(raw); setStatus("🤖 AI振り分け中...");
      const classifyRes=await fetch("/api/karte-agent/classify-and-draft",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({appointment_id:appointmentId,transcript:raw})});
      if(classifyRes.ok){const r=await classifyRes.json();if(r.success){setStatus(`✅ ${r.fields_generated}フィールド生成完了！`);loadDrafts();}
        else setStatus("⚠️ "+(r.error||"振り分け問題"));}
      else setStatus("❌ AI振り分けエラー");
    }catch(e){console.error(e);setStatus("❌ 文字起こし失敗");}
    setTranscribing(false);
  };

  // ===== OPTION A: REALTIME WebRTC =====
  const startRealtime = async()=>{
    try{
      setStatus("🔑 リアルタイムトークン取得中...");
      const tokenRes=await fetch("/api/karte-agent/realtime-token",{method:"POST"});
      if(!tokenRes.ok){
        const errData=await tokenRes.json().catch(()=>({}));
        console.error("Token error:",errData);
        setStatus("❌ トークン取得失敗: "+(errData.detail||errData.error||tokenRes.status));
        return;
      }
      const tokenData=await tokenRes.json();
      // GA API response: { value: "ek_xxx" } or { client_secret: { value: "ek_xxx" } }
      const ephemeralKey=tokenData?.value||tokenData?.client_secret?.value;
      if(!ephemeralKey){
        console.error("Token data:",tokenData);
        setStatus("❌ トークンが空です");
        return;
      }

      setStatus("🔗 WebRTC接続中...");

      // Get microphone
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      streamRef.current=stream;

      // Create WebRTC peer connection
      const pc=new RTCPeerConnection();
      pcRef.current=pc;

      // Add audio track
      pc.addTrack(stream.getTracks()[0]);

      // Create data channel for events
      const dc=pc.createDataChannel("oai-events");
      dcRef.current=dc;

      dc.addEventListener("open",()=>{
        console.log("Realtime data channel open");
        // Enable input audio transcription via session.update (GA format)
        dc.send(JSON.stringify({
          type: "session.update",
          session: {
            type: "realtime",
            audio: {
              input: {
                transcription: {
                  model: "gpt-4o-transcribe",
                  language: "ja",
                },
                noise_reduction: { type: "near_field" },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 800,
                },
              },
            },
          },
        }));
      });

      dc.addEventListener("message",(e)=>{
        try{
          const event=JSON.parse(e.data);

          // Transcription delta (partial)
          if(event.type==="conversation.item.input_audio_transcription.delta"){
            const delta=event.delta||"";
            if(delta.trim()){
              // Start new chunk if needed
              if(!deltaChunkId.current) deltaChunkId.current=Date.now();
              pendingDeltaText.current+=delta;

              setRealtimeLines(prev=>{
                const last=prev[prev.length-1];
                if(last&&!last.isFinal){
                  const updated=[...prev]; updated[updated.length-1]={...last,text:last.text+delta};
                  return updated;
                }
                return [...prev,{text:delta,time:new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),isFinal:false}];
              });

              // Throttled flush to Supabase (every 1s)
              if(!deltaFlushTimer.current){
                deltaFlushTimer.current=setTimeout(()=>{
                  flushDeltaToSupabase();
                  deltaFlushTimer.current=null;
                },1000);
              }
            }
          }
          // Transcription completed (final for this utterance)
          else if(event.type==="conversation.item.input_audio_transcription.completed"){
            const text=event.transcript||"";
            if(text.trim()){
              setRealtimeLines(prev=>{
                const updated=[...prev.filter(l=>l.isFinal)];
                updated.push({text:text.trim(),time:new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"}),isFinal:true});
                return updated;
              });
              realtimeTranscript.current+=(realtimeTranscript.current?" ":"")+text.trim();

              // Final save to Supabase (upsert with final text)
              const cid=deltaChunkId.current||Date.now();
              if(deltaFlushTimer.current){clearTimeout(deltaFlushTimer.current);deltaFlushTimer.current=null;}
              supabase.from("karte_transcript_chunks").upsert({
                appointment_id:appointmentId,
                chunk_index:cid,
                raw_text:text.trim(),
                corrected_text:text.trim(),
                speaker_role:"mixed",
                classified_field:null,
              },{onConflict:"appointment_id,chunk_index"}).then(()=>{});
              // Reset for next utterance
              deltaChunkId.current=null;
              pendingDeltaText.current="";
            }
          }
          // Also handle transcription session specific events
          else if(event.type==="transcription_session.created"||event.type==="session.created"){
            console.log("Realtime session created:",event);
          }
          else if(event.type==="error"){
            console.error("Realtime API error:",event);
            setStatus("⚠️ リアルタイムエラー: "+(event.error?.message||"不明"));
          }
        }catch(err){/* ignore non-JSON */}
      });

      // Create SDP offer
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);

      // GA API: POST /v1/realtime/calls with ephemeral key
      const sdpRes=await fetch("https://api.openai.com/v1/realtime/calls",{
        method:"POST",
        headers:{
          Authorization:`Bearer ${ephemeralKey}`,
          "Content-Type":"application/sdp",
        },
        body:offer.sdp,
      });

      if(!sdpRes.ok){
        const errText=await sdpRes.text();
        console.error("SDP error:",sdpRes.status,errText);
        setStatus(`❌ WebRTC接続失敗 (${sdpRes.status}): ${errText.slice(0,100)}`);
        stream.getTracks().forEach(t=>t.stop());
        pc.close();
        return;
      }

      const answerSdp=await sdpRes.text();
      await pc.setRemoteDescription({type:"answer",sdp:answerSdp});

      setRecording(true); setRecTime(0); setRealtimeLines([]);
      realtimeTranscript.current="";
      setStatus("🎙 リアルタイム文字起こし中…");
    }catch(e){
      console.error("Realtime start error:",e);
      setStatus("❌ リアルタイム接続エラー: "+(e as Error).message);
    }
  };

  const stopRealtime = async()=>{
    // Close WebRTC
    if(dcRef.current) dcRef.current.close();
    if(pcRef.current) pcRef.current.close();
    if(streamRef.current) streamRef.current.getTracks().forEach(t=>t.stop());
    pcRef.current=null; dcRef.current=null; streamRef.current=null;

    setRecording(false);
    const fullText=realtimeTranscript.current;
    if(!fullText||fullText.trim().length<5){
      setStatus("⚠️ 文字起こしが短すぎます"); return;
    }
    setTranscript(fullText);
    setTranscribing(true); setStatus("🤖 AI振り分け中...");

    try{
      const classifyRes=await fetch("/api/karte-agent/classify-and-draft",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({appointment_id:appointmentId,transcript:fullText})});
      if(classifyRes.ok){const r=await classifyRes.json();if(r.success){setStatus(`✅ ${r.fields_generated}フィールド生成完了！`);loadDrafts();}
        else setStatus("⚠️ "+(r.error||"振り分け問題"));}
      else setStatus("❌ AI振り分けエラー");
    }catch(e){console.error(e);setStatus("❌ 振り分け失敗");}
    setTranscribing(false);
  };

  // Unified start/stop
  const startRecording=()=>mode==="batch"?startBatch():startRealtime();
  const stopRecording=()=>mode==="batch"?stopBatch():stopRealtime();

  // Confirm / Revoke
  const handleConfirm=async()=>{
    const res=await fetch("/api/karte-agent/action",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"confirm",appointment_id:appointmentId})});
    const data=await res.json();
    if(data.success){setConfirmed(true);setConfirmId(data.confirmation_id);}
    else setStatus("❌ "+(data.error||"確定失敗"));
  };
  const handleRevoke=async()=>{
    if(!confirmId) return;
    await fetch("/api/karte-agent/action",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"revoke",confirmation_id:confirmId,reason:"Dr修正"})});
    setConfirmed(false);setConfirmId(null);loadDrafts();
  };

  const apCnt=STEPS.filter(st=>drafts[st.key]?.status==="approved"||drafts[st.key]?.status==="confirmed").length;
  const hasDrafts=Object.keys(drafts).length>0;
  const fmt=(s:number)=>String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");

  if(!appointmentId){
    return <div style={{padding:40,textAlign:"center",fontFamily:"sans-serif"}}><p>appointment_id が指定されていません</p></div>;
  }

  return(
    <div style={{fontFamily:"-apple-system,'Helvetica Neue','Noto Sans JP',sans-serif",height:"100vh",display:"flex",flexDirection:"column",background:"#F8FAFC",color:"#1E293B"}}>
      <header style={{background:"#FFF",padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #E5E7EB"}}>
        <span style={{fontSize:16,fontWeight:700}}>🩺 カルテエージェント — 診察室</span>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {/* Mode toggle */}
          <div style={{display:"flex",background:"#F1F5F9",borderRadius:8,padding:2}}>
            {([["batch","📝 一括"],["realtime","⚡ リアルタイム"]] as const).map(([k,l])=>(
              <button key={k} onClick={()=>{if(!recording) setMode(k);}}
                style={{padding:"4px 12px",borderRadius:6,border:"none",fontSize:11,fontWeight:700,cursor:recording?"not-allowed":"pointer",
                  background:mode===k?"#FFF":"transparent",color:mode===k?"#111827":"#9CA3AF",
                  boxShadow:mode===k?"0 1px 3px rgba(0,0,0,0.08)":"none",opacity:recording?0.5:1}}>
                {l}
              </button>
            ))}
          </div>
          {patient&&(
            <>
              <span style={{fontSize:15,fontWeight:700}}>{patient.name}</span>
              <span style={{fontSize:12,color:"#9CA3AF"}}>{patient.age}歳</span>
              {patient.allergies.map(a=><span key={a} style={{background:"#FEF2F2",color:"#DC2626",fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:6}}>⚠ {a}</span>)}
            </>
          )}
        </div>
      </header>

      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        {/* Left panel */}
        <div style={{width:"40%",display:"flex",flexDirection:"column",alignItems:"center",padding:"24px 20px",gap:16,borderRight:"1px solid #E5E7EB",overflow:"auto"}}>

          {/* Record controls */}
          {!recording&&!transcribing&&!confirmed&&!hasDrafts?(
            <button onClick={startRecording} style={{width:150,height:150,borderRadius:"50%",background:mode==="realtime"?"linear-gradient(135deg,#3B82F6,#6366F1)":"#111827",border:"none",cursor:"pointer",color:"#FFF",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
              <div style={{fontSize:40}}>{mode==="realtime"?"⚡":"🎙"}</div>
              <div style={{fontSize:14,fontWeight:800,marginTop:4}}>録音開始</div>
              <div style={{fontSize:10,opacity:0.7,marginTop:2}}>{mode==="realtime"?"リアルタイム":"一括モード"}</div>
            </button>
          ):recording?(
            <div style={{textAlign:"center"}}>
              <div style={{width:130,height:130,borderRadius:"50%",background:mode==="realtime"?"#EFF6FF":"#FEF2F2",border:"3px solid "+(mode==="realtime"?"#3B82F6":"#EF4444"),display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontSize:28,fontWeight:900,fontFamily:"monospace"}}>{fmt(recTime)}</div>
                <div style={{fontSize:13,fontWeight:600,color:mode==="realtime"?"#3B82F6":"#EF4444"}}>{mode==="realtime"?"⚡ リアルタイム":"録音中"}</div>
              </div>
              <button onClick={stopRecording} style={{marginTop:12,background:"#111827",color:"#FFF",border:"none",borderRadius:10,padding:"10px 24px",fontSize:14,fontWeight:700,cursor:"pointer"}}>
                ⏹ {mode==="realtime"?"停止してAI振り分け":"停止して文字起こし"}
              </button>
            </div>
          ):transcribing?(
            <div style={{textAlign:"center"}}>
              <div style={{width:100,height:100,borderRadius:"50%",background:"#EFF6FF",border:"3px solid #3B82F6",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontSize:32,animation:"pulse 1.5s infinite"}}>🤖</div>
              </div>
              <div style={{fontSize:14,fontWeight:600,color:"#3B82F6",marginTop:8}}>AI処理中...</div>
            </div>
          ):confirmed?(
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:48}}>✅</div>
              <div style={{fontSize:20,fontWeight:800,color:"#16A34A",marginTop:6}}>カルテ確定済み</div>
            </div>
          ):hasDrafts?(
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:14,fontWeight:600,color:"#6B7280"}}>受付で確認中</div>
              <button onClick={startRecording} style={{marginTop:10,background:"#F9FAFB",color:"#374151",border:"1px solid #E5E7EB",borderRadius:10,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>🎙 追加録音</button>
            </div>
          ):null}

          {status&&<div style={{fontSize:12,color:"#6B7280",textAlign:"center",maxWidth:300,lineHeight:1.5}}>{status}</div>}

          {/* Progress */}
          <div style={{width:"100%",maxWidth:340}}>
            <div style={{display:"flex",gap:3}}>
              {STEPS.map(st=>{
                const d=drafts[st.key];const done=d?.status==="approved"||d?.status==="confirmed";const has=!!d;
                return <div key={st.key} style={{flex:1,textAlign:"center",padding:"7px 0",borderRadius:8,background:done?"#F0FDF4":has?"#FFFBEB":"#F9FAFB",border:"1px solid "+(done?"#D1FAE5":has?"#FDE68A":"#E5E7EB")}}>
                  <div style={{fontSize:11,fontWeight:800,color:done?"#16A34A":has?"#D97706":"#D1D5DB"}}>{done?"✓":has?"!":"·"}</div>
                  <div style={{fontSize:10,fontWeight:600,color:"#374151"}}>{st.label}</div>
                </div>;
              })}
            </div>
            <div style={{textAlign:"center",fontSize:12,color:"#9CA3AF",marginTop:4}}>{apCnt}/5 承認済み</div>
          </div>

          {apCnt>=5&&!confirmed&&(
            <button onClick={handleConfirm} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:14,padding:"14px 36px",fontSize:16,fontWeight:800,cursor:"pointer"}}>カルテ確定する</button>
          )}
          {confirmed&&(
            <button onClick={handleRevoke} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:10,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>↩ 確定取り消し</button>
          )}

          {/* Realtime live transcript */}
          {mode==="realtime"&&realtimeLines.length>0&&(
            <div style={{width:"100%",maxWidth:340}}>
              <div style={{fontSize:11,fontWeight:600,color:"#3B82F6",marginBottom:4}}>⚡ リアルタイム文字起こし</div>
              <div style={{background:"#F9FAFB",borderRadius:8,padding:10,maxHeight:250,overflow:"auto"}}>
                {realtimeLines.map((l,i)=>(
                  <div key={i} style={{marginBottom:6,fontSize:12,lineHeight:1.6}}>
                    <span style={{fontSize:9,color:"#D1D5DB",marginRight:6}}>{l.time}</span>
                    <span style={{color:l.isFinal?"#374151":"#9CA3AF",fontStyle:l.isFinal?"normal":"italic"}}>{l.text}</span>
                    {!l.isFinal&&<span style={{color:"#3B82F6",animation:"pulse 1s infinite"}}> ▍</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Batch transcript */}
          {mode==="batch"&&transcript&&(
            <div style={{width:"100%",maxWidth:340}}>
              <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:4}}>📝 文字起こし結果</div>
              <div style={{background:"#F9FAFB",borderRadius:8,padding:10,fontSize:12,color:"#374151",lineHeight:1.7,maxHeight:200,overflow:"auto",whiteSpace:"pre-wrap"}}>{transcript}</div>
            </div>
          )}

          {/* Messages */}
          {messages.length>0&&(
            <div style={{width:"100%",maxWidth:340}}>
              <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:4}}>📨 受付から</div>
              {messages.slice(-5).map((m,i)=>(
                <div key={i} style={{padding:"8px 12px",marginBottom:4,borderRadius:8,background:"#F9FAFB",border:"1px solid #E5E7EB",fontSize:13}}>
                  {m.related_field&&<span style={{fontSize:10,fontWeight:600,color:"#6B7280",marginRight:6}}>[{STEPS.find(s=>s.key===m.related_field)?.label}]</span>}
                  {m.message_text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: karte content */}
        <div style={{flex:1,overflow:"auto",padding:16,display:"flex",flexDirection:"column",gap:8}}>

          {/* ===== 歯式チャート（常時表示） ===== */}
          <div style={{background:"#FFF",borderRadius:12,padding:14,border:"1px solid #E5E7EB"}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:14,fontWeight:700}}>🦷 歯式チャート</span>
              <span style={{fontSize:10,color:"#9CA3AF"}}>{Object.keys(toothChart).filter(k=>{const p=getPrimary(toothChart,k);return p!=="normal";}).length}歯に所見</span>
            </div>
            {/* 上顎 */}
            <div style={{display:"flex",justifyContent:"center",gap:2,marginBottom:2}}>
              {[...UR,...UL].map(t=>{const p=getPrimary(toothChart,t);const c=TS[p]||TS.normal;
                return <div key={t} title={`#${t} ${c.lb||"健全"}`} style={{width:18,height:18,borderRadius:3,fontSize:7,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",background:c.bg,color:c.tx,border:`1px solid ${c.bd}`}}>{c.lb||t}</div>;})}
            </div>
            <div style={{display:"flex",justifyContent:"center"}}><div style={{width:290,borderTop:"1px solid #CBD5E1",margin:"1px 0"}} /></div>
            {/* 下顎 */}
            <div style={{display:"flex",justifyContent:"center",gap:2,marginTop:2}}>
              {[...LR,...LL].map(t=>{const p=getPrimary(toothChart,t);const c=TS[p]||TS.normal;
                return <div key={t} title={`#${t} ${c.lb||"健全"}`} style={{width:18,height:18,borderRadius:3,fontSize:7,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",background:c.bg,color:c.tx,border:`1px solid ${c.bd}`}}>{c.lb||t}</div>;})}
            </div>
            {/* ステータスサマリ */}
            {Object.keys(toothChart).length>0&&(
              <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:8,paddingTop:8,borderTop:"1px solid #F1F5F9"}}>
                {Object.entries(Object.keys(toothChart).reduce((acc,t)=>{const p=getPrimary(toothChart,t);if(p!=="normal"){acc[p]=(acc[p]||0)+1;}return acc;},{} as Record<string,number>)).map(([s,c])=>{const cfg=TS[s]||TS.normal;
                  return <span key={s} style={{fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:4,background:cfg.bg,color:cfg.tx}}>{cfg.lb} {c}</span>;})}
              </div>
            )}

            {/* レントゲンアップロード */}
            <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid #F1F5F9"}}>
              <div style={{display:"flex",gap:6}}>
                <label style={{cursor:"pointer",flex:1}}>
                  <div style={{background:"#F5F3FF",border:"1px dashed #C4B5FD",borderRadius:8,padding:"8px 0",textAlign:"center",fontSize:11,fontWeight:600,color:"#7C3AED"}}>
                    {xrayUploading?"🤖 AI分析中...":"📷 レントゲン → AI歯式分析"}
                  </div>
                  <input type="file" accept="image/*" style={{display:"none"}} disabled={xrayUploading} onChange={async(e)=>{
                    const file=e.target.files?.[0]; if(!file||!patient||!recordId) return;
                    setXrayUploading(true); setStatus("📤 レントゲンアップロード中...");
                    try{
                      const fd=new FormData(); fd.append("file",file); fd.append("patient_id",patient.id); fd.append("record_id",recordId); fd.append("image_type","panorama");
                      const upRes=await fetch("/api/image-upload",{method:"POST",body:fd}); const upData=await upRes.json();
                      if(!upData.success){setStatus("❌ アップロード失敗");setXrayUploading(false);return;}
                      setStatus("🤖 AI歯式分析中...");
                      const aiRes=await fetch("/api/xray-analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image_base64:upData.image.base64,patient_id:patient.id})});
                      const aiData=await aiRes.json();
                      if(aiData.success&&aiData.tooth_chart){
                        const nc={...toothChart}; Object.entries(aiData.tooth_chart).forEach(([t,s])=>{if(TS[s as string]) nc[t]=[s as string];});
                        setToothChart(nc);
                        await supabase.from("medical_records").update({tooth_chart:nc}).eq("id",recordId);
                        setStatus(`✅ ${Object.keys(aiData.tooth_chart).length}歯を分析・反映`);
                      } else setStatus("❌ AI分析失敗");
                    }catch{setStatus("❌ レントゲン処理エラー");}
                    setXrayUploading(false); e.target.value="";
                  }} />
                </label>
                <label style={{cursor:"pointer",flex:1}}>
                  <div style={{background:"#F5F3FF",border:"1px dashed #C4B5FD",borderRadius:8,padding:"8px 0",textAlign:"center",fontSize:11,fontWeight:600,color:"#7C3AED"}}>
                    📸 カメラ撮影
                  </div>
                  <input type="file" accept="image/*" capture="environment" style={{display:"none"}} disabled={xrayUploading} onChange={async(e)=>{
                    const file=e.target.files?.[0]; if(!file||!patient||!recordId) return;
                    setXrayUploading(true); setStatus("📤 アップロード中...");
                    try{
                      const fd=new FormData(); fd.append("file",file); fd.append("patient_id",patient.id); fd.append("record_id",recordId); fd.append("image_type","panorama");
                      const upRes=await fetch("/api/image-upload",{method:"POST",body:fd}); const upData=await upRes.json();
                      if(!upData.success){setStatus("❌ アップロード失敗");setXrayUploading(false);return;}
                      setStatus("🤖 AI歯式分析中...");
                      const aiRes=await fetch("/api/xray-analyze",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({image_base64:upData.image.base64,patient_id:patient.id})});
                      const aiData=await aiRes.json();
                      if(aiData.success&&aiData.tooth_chart){
                        const nc={...toothChart}; Object.entries(aiData.tooth_chart).forEach(([t,s])=>{if(TS[s as string]) nc[t]=[s as string];});
                        setToothChart(nc);
                        await supabase.from("medical_records").update({tooth_chart:nc}).eq("id",recordId);
                        setStatus(`✅ ${Object.keys(aiData.tooth_chart).length}歯を分析・反映`);
                      } else setStatus("❌ AI分析失敗");
                    }catch{setStatus("❌ レントゲン処理エラー");}
                    setXrayUploading(false); e.target.value="";
                  }} />
                </label>
              </div>
            </div>
          </div>

          {/* ===== P検サマリ（常時表示） ===== */}
          {Object.keys(perioData).length>0&&(
            <div style={{background:"#FFF",borderRadius:12,padding:14,border:"1px solid #E5E7EB"}}>
              <span style={{fontSize:14,fontWeight:700}}>📊 P検サマリ</span>
              {(()=>{
                let bopP=0,bopT=0,d4=0,d6=0;
                Object.values(perioData).forEach(pd=>{if(pd.bop)bopP++;bopT++;[...pd.buccal,...pd.lingual].forEach(v=>{if(v>=4)d4++;if(v>=6)d6++;});});
                const bopR=bopT>0?Math.round(bopP/bopT*1000)/10:0;
                return(
                  <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
                    <div style={{background:bopR>30?"#FEF2F2":"#F0FDF4",padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:700,color:bopR>30?"#DC2626":"#16A34A"}}>BOP {bopR}%</div>
                    <div style={{background:"#F9FAFB",padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:700,color:"#374151"}}>PPD≧4: {d4}</div>
                    {d6>0&&<div style={{background:"#FEF2F2",padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:700,color:"#DC2626"}}>PPD≧6: {d6}</div>}
                    <div style={{background:"#F9FAFB",padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:700,color:"#6B7280"}}>{Object.keys(perioData).length}歯</div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ===== カルテ内容（AI drafts） ===== */}
          <div style={{fontSize:15,fontWeight:700,marginBottom:4}}>カルテ内容</div>
          {STEPS.map(st=>{
            const d=drafts[st.key];const done=d?.status==="approved"||d?.status==="confirmed";const has=!!d;
            return(
              <div key={st.key} style={{background:"#FFF",borderRadius:12,padding:14,border:"1px solid "+(done?"#D1FAE5":has?"#FDE68A":"#E5E7EB"),opacity:has?1:0.35}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:14,fontWeight:700}}>{st.label}</span>
                  {done&&<span style={{fontSize:11,fontWeight:600,color:"#16A34A"}}>✓ 承認済</span>}
                  {has&&!done&&<span style={{fontSize:11,fontWeight:600,color:"#D97706"}}>受付確認中</span>}
                </div>
                {has&&d?(<div style={{fontSize:14,color:"#374151",lineHeight:1.8,whiteSpace:"pre-wrap",marginTop:8}}>{d.draft_text}</div>)
                  :(<div style={{fontSize:13,color:"#D1D5DB",fontStyle:"italic",marginTop:4}}>—</div>)}
              </div>
            );
          })}
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}

export default function KarteAgentUnit(){
  return <Suspense fallback={<div style={{padding:40,textAlign:"center"}}>読み込み中...</div>}><UnitContent /></Suspense>;
}
