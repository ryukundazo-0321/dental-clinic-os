"use client";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";

const STEPS = [
  { key: "s", label: "主訴(S)", short: "S", color: "#2563EB", bg: "#EFF6FF" },
  { key: "tooth", label: "歯式", short: "🦷", color: "#7C3AED", bg: "#F5F3FF" },
  { key: "perio", label: "P検", short: "P", color: "#0D9488", bg: "#F0FDFA" },
  { key: "dh", label: "DH記録", short: "O", color: "#D97706", bg: "#FFFBEB" },
  { key: "dr", label: "Dr診察", short: "AP", color: "#DC2626", bg: "#FEF2F2" },
];

const TOOTH_U = ["18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28"];
const TOOTH_L = ["48","47","46","45","44","43","42","41","31","32","33","34","35","36","37","38"];

const TOOTH_STATUSES: {key:string;label:string;icon:string;color:string}[] = [
  {key:"normal",label:"健全",icon:"○",color:"#6B7280"},
  {key:"C0",label:"C0",icon:"C0",color:"#93C5FD"},
  {key:"C1",label:"C1",icon:"C1",color:"#60A5FA"},
  {key:"C2",label:"C2",icon:"C2",color:"#F59E0B"},
  {key:"C3",label:"C3",icon:"C3",color:"#EF4444"},
  {key:"C4",label:"C4",icon:"C4",color:"#991B1B"},
  {key:"treating",label:"治療中",icon:"🔧",color:"#8B5CF6"},
  {key:"CR",label:"CR",icon:"CR",color:"#10B981"},
  {key:"In",label:"In",icon:"In",color:"#14B8A6"},
  {key:"FMC",label:"Cr",icon:"Cr",color:"#0EA5E9"},
  {key:"/",label:"欠損",icon:"/",color:"#6B7280"},
  {key:"IP",label:"IP",icon:"IP",color:"#D946EF"},
  {key:"Br-abutment",label:"Br支台",icon:"Br",color:"#F97316"},
  {key:"Br-pontic",label:"Brポン",icon:"Br欠",color:"#FB923C"},
  {key:"残根",label:"残根",icon:"残",color:"#78716C"},
  {key:"要注意",label:"要注意",icon:"△",color:"#FBBF24"},
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
  const [transcriptChunks, setTranscriptChunks] = useState<{time:string;text:string}[]>([]);
  const [realtimeLines, setRealtimeLines] = useState<{text:string;time:string;isFinal:boolean}[]>([]);
  const [drafts, setDrafts] = useState<Record<string,{draft_text:string;status:string}>>({});
  const [messages, setMessages] = useState<{related_field:string|null;message_text:string;created_at:string}[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmId, setConfirmId] = useState<string|null>(null);
  const [status, setStatus] = useState("");

  // 編集・承認関連
  const [editing, setEditing] = useState<string|null>(null);
  const [editVal, setEditVal] = useState("");

  // 算定プレビュー関連
  const [billingData, setBillingData] = useState<{items:{code:string;name:string;points:number;count:number;category:string}[];total:number;burden:number}|null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [billingSaved, setBillingSaved] = useState(false);
  const [showAddItem, setShowAddItem] = useState(false);
  const [addItemSearch, setAddItemSearch] = useState("");
  const [addItemResults, setAddItemResults] = useState<{code:string;name:string;points:number;category:string}[]>([]);

  // 右タブ
  const [rightTab, setRightTab] = useState<"karte"|"tooth"|"perio">("karte");

  // P検設定
  const [perioPoints, setPerioPoints] = useState<1|4|6>(6);
  const [perioOrder, setPerioOrder] = useState<"konoji"|"z"|"s"|"buccal-lingual">("konoji");

  // 歯式手動編集
  const [toothEditTarget, setToothEditTarget] = useState<string|null>(null);

  // P検手動編集
  const [perioEditTarget, setPerioEditTarget] = useState<string|null>(null);

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
    const {data:chunks}=await supabase.from("karte_transcript_chunks").select("corrected_text, raw_text, created_at")
      .eq("appointment_id",appointmentId).order("chunk_index",{ascending:true});
    if(chunks&&chunks.length>0) {
      setTranscript(chunks.map((c:{corrected_text:string;raw_text:string})=>c.corrected_text||c.raw_text).join("\n"));
      setTranscriptChunks(chunks.map((c:{corrected_text:string;raw_text:string;created_at:string})=>({
        time: c.created_at ? new Date(c.created_at).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"}) : "",
        text: c.corrected_text||c.raw_text
      })));
    }
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
      // 文字起こし完了 → 前回分に追記してからAI振り分け
      const now = new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"});
      setTranscriptChunks(prev => [...prev, {time:now, text:raw}]);
      const newTranscript = transcript ? transcript + "\n" + raw : raw;
      setTranscript(newTranscript); setStatus("🤖 AI振り分け中...");
      // chunkをDBに保存（billing-previewで参照するため）
      const chunkIndex = Date.now();
      supabase.from("karte_transcript_chunks").upsert({
        appointment_id:appointmentId, chunk_index:chunkIndex,
        raw_text:raw, corrected_text:raw, is_final:true,
      },{onConflict:"appointment_id,chunk_index"}).then(()=>{});
      // 全文（前回分+今回分）でclassify
      const classifyRes=await fetch("/api/karte-agent/classify-and-draft",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({appointment_id:appointmentId,transcript:newTranscript})});
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

      // MediaRecorderも同時に録音開始（Whisperフォールバック用）
      try {
        const mr=new MediaRecorder(stream,{mimeType:"audio/webm;codecs=opus"});
        mediaRec.current=mr; audioChunks.current=[];
        mr.ondataavailable=(e)=>{if(e.data.size>0) audioChunks.current.push(e.data);};
        mr.start(1000);
      } catch(e){ console.warn("MediaRecorder fallback not available:",e); }

      // Create data channel for events
      const dc=pc.createDataChannel("oai-events");
      dcRef.current=dc;

      dc.addEventListener("open",()=>{
        console.log("Realtime data channel open");
        // Enable input audio transcription via session.update (GA format)
        dc.send(JSON.stringify({
          type: "session.update",
          session: {
            input_audio_transcription: {
              model: "gpt-4o-transcribe",
              language: "ja",
            },
            input_audio_noise_reduction: { type: "near_field" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.2,
              prefix_padding_ms: 800,
              silence_duration_ms: 2000,
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
    // Stop MediaRecorder
    if(mediaRec.current&&mediaRec.current.state!=="inactive"){
      mediaRec.current.stop();
    }

    setRecording(false);
    let fullText=realtimeTranscript.current;

    // リアルタイム結果が不十分→Whisperで再文字起こし
    if((!fullText||fullText.trim().length<20)&&audioChunks.current.length>0){
      setStatus("🔄 Whisperで再文字起こし中...");
      try{
        const blob=new Blob(audioChunks.current,{type:"audio/webm"});
        const tokenRes=await fetch("/api/whisper-token");const tokenData=await tokenRes.json();
        if(tokenData.key){
          const fd=new FormData();
          fd.append("file",blob,"recording.webm");fd.append("model","gpt-4o-transcribe");fd.append("language","ja");
          const wr=await fetch("https://api.openai.com/v1/audio/transcriptions",{
            method:"POST",headers:{Authorization:`Bearer ${tokenData.key}`},body:fd});
          if(wr.ok){const r=await wr.json();if(r.text&&r.text.trim().length>(fullText?.trim().length||0)){fullText=r.text;}}
        }
      }catch(e){console.error("Whisper fallback error:",e);}
    }

    if(!fullText||fullText.trim().length<5){
      setStatus("⚠️ 文字起こしが短すぎます"); return;
    }
    // 追記方式
    const now = new Date().toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"});
    setTranscriptChunks(prev => [...prev, {time:now, text:fullText}]);
    const newTranscript = transcript ? transcript + "\n" + fullText : fullText;
    setTranscript(newTranscript);

    // chunkをDBに保存
    const chunkIndex = Date.now();
    supabase.from("karte_transcript_chunks").upsert({
      appointment_id:appointmentId, chunk_index:chunkIndex,
      raw_text:fullText, corrected_text:fullText, is_final:true,
    },{onConflict:"appointment_id,chunk_index"}).then(()=>{});

    setTranscribing(true); setStatus("🤖 AI振り分け中...");

    try{
      const classifyRes=await fetch("/api/karte-agent/classify-and-draft",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({appointment_id:appointmentId,transcript:newTranscript})});
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
  // 承認
  const approve=async(key:string,editedText?:string)=>{
    await fetch("/api/karte-agent/action",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"approve",appointment_id:appointmentId,field_key:key,edited_text:editedText})});
    setEditing(null);loadDrafts();
  };
  // 再生成
  const regenerateDraft=async(key:string)=>{
    await fetch("/api/karte-agent/generate-draft",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({appointment_id:appointmentId,field_key:key})});
    loadDrafts();
  };
  // fee検索
  const searchFee=async(q:string)=>{
    if(!q||q.length<2){setAddItemResults([]);return;}
    const {data}=await supabase.from("fee_master_v2").select("kubun_code,sub_code,name,name_short,points,category").or(`name.ilike.%${q}%,name_short.ilike.%${q}%,kubun_code.ilike.%${q}%`).limit(10);
    if(data) setAddItemResults(data.map(f=>({code:f.sub_code?`${f.kubun_code}-${f.sub_code}`:f.kubun_code,name:f.name_short||f.name,points:f.points,category:f.category||"other"})));
  };

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

  // confirmed時にbilling-previewを自動実行
  useEffect(()=>{
    if(!confirmed||!appointmentId||billingData) return;
    (async()=>{
      setBillingLoading(true);
      try{
        const {data:rec}=await supabase.from("medical_records").select("id").eq("appointment_id",appointmentId).order("created_at",{ascending:false}).limit(1).single();
        if(rec?.id){
          setRecordId(rec.id);
          const res=await fetch("/api/billing-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({record_id:rec.id})});
          const d=await res.json();
          if(d.success){
            const items=(d.items||[]) as {code:string;name:string;points:number;count:number;category:string}[];
            const total=d.total_points||0;
            const burden=d.patient_burden||Math.round(total*10*0.3);
            setBillingData({items,total,burden});
          }
        }
      }catch(e){console.error("billing-preview error",e);}
      setBillingLoading(false);
    })();
  },[confirmed,appointmentId,billingData]);
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
          {mode==="batch"&&transcriptChunks.length>0&&(
            <div style={{width:"100%",maxWidth:340}}>
              <div style={{fontSize:11,fontWeight:600,color:"#9CA3AF",marginBottom:4}}>📝 文字起こし結果</div>
              <div style={{background:"#F9FAFB",borderRadius:8,padding:10,maxHeight:300,overflow:"auto"}}>
                {transcriptChunks.map((c,i)=>(
                  <div key={i} style={{marginBottom:10,paddingBottom:8,borderBottom:i<transcriptChunks.length-1?"1px solid #E5E7EB":"none"}}>
                    <div style={{fontSize:9,color:"#3B82F6",fontWeight:600,marginBottom:2}}>{c.time} — 録音 {i+1}</div>
                    <div style={{fontSize:12,color:"#374151",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{c.text}</div>
                  </div>
                ))}
              </div>
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


        {/* Right: Tabbed content */}
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          {/* Tab header */}
          <div style={{display:"flex",borderBottom:"2px solid #E5E7EB",background:"#FFF",flexShrink:0}}>
            {([["karte","📋 カルテ"],["tooth","🦷 歯式"],["perio","📊 P検"]] as [string,string][]).map(([key,label])=>(
              <button key={key} onClick={()=>setRightTab(key as "karte"|"tooth"|"perio")}
                style={{flex:1,padding:"12px 0",fontSize:14,fontWeight:rightTab===key?800:600,
                  color:rightTab===key?"#2563EB":"#6B7280",background:"transparent",border:"none",
                  borderBottom:rightTab===key?"3px solid #2563EB":"3px solid transparent",cursor:"pointer",
                  transition:"all 0.15s"}}>
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{flex:1,overflow:"auto",padding:16}}>

            {/* ====== TAB: カルテ ====== */}
            {rightTab==="karte"&&(
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {STEPS.map(st=>{
                  const d=drafts[st.key];const done=d?.status==="approved"||d?.status==="confirmed";const has=!!d;
                  const isEd=editing===st.key;
                  return(
                    <div key={st.key} style={{background:"#FFF",borderRadius:12,padding:16,border:"1.5px solid "+(done?"#BBF7D0":has?"#FDE68A":"#E5E7EB")}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <div style={{width:28,height:28,borderRadius:8,background:st.bg,display:"flex",alignItems:"center",justifyContent:"center",color:st.color,fontSize:12,fontWeight:800}}>{st.short}</div>
                          <span style={{fontSize:15,fontWeight:700}}>{st.label}</span>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          {!d&&hasDrafts&&<button onClick={()=>regenerateDraft(st.key)} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,padding:"4px 10px",fontSize:11,fontWeight:600,cursor:"pointer"}}>AI生成</button>}
                          {done?<span style={{fontSize:12,fontWeight:700,color:"#16A34A"}}>✓ 承認済</span>
                            :has?<span style={{fontSize:11,fontWeight:600,color:"#D97706"}}>確認待ち</span>
                            :<span style={{fontSize:11,color:"#D1D5DB"}}>待機</span>}
                        </div>
                      </div>
                      {has&&d?(
                        isEd?(
                          <div>
                            <textarea value={editVal} onChange={e=>setEditVal(e.target.value)}
                              style={{width:"100%",background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:10,padding:12,fontSize:14,color:"#111827",outline:"none",resize:"vertical",minHeight:80,lineHeight:1.8}} />
                            <div style={{display:"flex",gap:8,marginTop:8,justifyContent:"flex-end"}}>
                              <button onClick={()=>setEditing(null)} style={{background:"#F3F4F6",color:"#6B7280",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:600,cursor:"pointer"}}>キャンセル</button>
                              <button onClick={()=>approve(st.key,editVal)} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:8,padding:"8px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>保存して承認</button>
                            </div>
                          </div>
                        ):(
                          <div>
                            <div style={{background:"#F9FAFB",borderRadius:10,padding:12,fontSize:14,color:"#374151",lineHeight:1.9,whiteSpace:"pre-wrap"}}>{d.draft_text}</div>
                            <div style={{display:"flex",gap:8,marginTop:10,justifyContent:"flex-end",flexWrap:"wrap"}}>
                              <button onClick={()=>regenerateDraft(st.key)} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>🔄 再生成</button>
                              {!done&&<button onClick={()=>{setEditing(st.key);setEditVal(d.draft_text);}} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>✏ 修正</button>}
                              {!done&&<button onClick={()=>approve(st.key)} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:8,padding:"6px 18px",fontSize:12,fontWeight:700,cursor:"pointer"}}>✓ 承認</button>}
                            </div>
                          </div>
                        )
                      ):(<div style={{fontSize:14,color:"#D1D5DB",fontStyle:"italic"}}>—</div>)}
                    </div>
                  );
                })}

                {/* カルテ確定ボタン */}
                {apCnt>=5&&!confirmed&&(
                  <div style={{textAlign:"center",padding:12}}>
                    <div style={{fontSize:13,color:"#16A34A",fontWeight:700,marginBottom:8}}>{apCnt}/5 承認済み</div>
                    <button onClick={handleConfirm} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:14,padding:"14px 48px",fontSize:16,fontWeight:800,cursor:"pointer"}}>カルテ確定する</button>
                  </div>
                )}

                {/* 算定プレビュー（確定後） */}
                {confirmed&&(
                  <div style={{background:"#F0FDF4",borderRadius:14,padding:20,border:"1.5px solid #D1FAE5"}}>
                    <div style={{fontSize:20,fontWeight:800,color:"#16A34A",textAlign:"center",marginBottom:12}}>✅ カルテ確定済み</div>
                    <div style={{background:"#FFF",borderRadius:12,padding:16,marginBottom:14,border:"1px solid #E5E7EB"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <div style={{fontSize:13,fontWeight:700,color:"#3B82F6"}}>📋 算定プレビュー（確認して確定してください）</div>
                        <button onClick={()=>{setBillingData(null);setBillingSaved(false);}} style={{background:"#EFF6FF",color:"#2563EB",border:"1px solid #BFDBFE",borderRadius:8,padding:"4px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>🔄 再分析</button>
                      </div>
                      {billingLoading?(
                        <div style={{padding:16,color:"#6B7280",fontSize:14,textAlign:"center"}}>⏳ 算定中...</div>
                      ):billingData?(()=>{
                        const items=billingData.items;
                        const basicPts=items.filter(i=>i.category==="basic"||i.code.startsWith("A0")).reduce((s,i)=>s+i.points*i.count,0);
                        const rxPts=items.filter(i=>i.category==="prescription"||i.code.startsWith("F-")).reduce((s,i)=>s+i.points*i.count,0);
                        const procPts=billingData.total-basicPts-rxPts;
                        return(
                          <div>
                            <div style={{display:"flex",justifyContent:"center",gap:20,flexWrap:"wrap",marginBottom:12}}>
                              <div style={{textAlign:"center"}}><div style={{fontSize:11,color:"#6B7280"}}>初再診料</div><div style={{fontSize:22,fontWeight:800}}>{basicPts}</div></div>
                              <div style={{textAlign:"center"}}><div style={{fontSize:11,color:"#6B7280"}}>処置</div><div style={{fontSize:22,fontWeight:800}}>{procPts}</div></div>
                              <div style={{textAlign:"center"}}><div style={{fontSize:11,color:"#6B7280"}}>処方</div><div style={{fontSize:22,fontWeight:800}}>{rxPts}</div></div>
                              <div style={{textAlign:"center",borderLeft:"2px solid #E5E7EB",paddingLeft:20}}><div style={{fontSize:11,color:"#6B7280"}}>合計</div><div style={{fontSize:28,fontWeight:900,color:"#2563EB"}}>{billingData.total.toLocaleString()}<span style={{fontSize:14}}>点</span></div></div>
                              <div style={{textAlign:"center"}}><div style={{fontSize:11,color:"#6B7280"}}>3割負担</div><div style={{fontSize:28,fontWeight:900}}>¥{billingData.burden.toLocaleString()}</div></div>
                            </div>
                            <div style={{maxHeight:250,overflowY:"auto"}}>
                              {items.map((it,i)=>(
                                <div key={i} style={{display:"flex",alignItems:"center",gap:8,fontSize:13,color:"#374151",padding:"6px 10px",borderBottom:"1px solid #F3F4F6"}}>
                                  <span style={{flex:1,fontWeight:500}}>{it.name}</span>
                                  <span style={{fontSize:11,color:"#9CA3AF"}}>{it.points}×</span>
                                  <input type="number" value={it.count} min={1} max={99} style={{width:40,textAlign:"center",border:"1px solid #D1D5DB",borderRadius:6,fontSize:12,padding:"2px 4px"}}
                                    onChange={e=>{const ni=[...items];ni[i]={...ni[i],count:Math.max(1,parseInt(e.target.value)||1)};const nt=ni.reduce((s,x)=>s+x.points*x.count,0);setBillingData({...billingData!,items:ni,total:nt,burden:Math.round(nt*10*0.3)});}} />
                                  <span style={{fontWeight:700,minWidth:56,textAlign:"right"}}>{(it.points*it.count).toLocaleString()}点</span>
                                  <button onClick={()=>{const ni=items.filter((_,j)=>j!==i);const nt=ni.reduce((s,x)=>s+x.points*x.count,0);setBillingData({...billingData!,items:ni,total:nt,burden:Math.round(nt*10*0.3)});}} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer",fontSize:16,padding:0}}>×</button>
                                </div>
                              ))}
                            </div>
                            <div style={{marginTop:8}}>
                              {!showAddItem?(
                                <button onClick={()=>setShowAddItem(true)} style={{background:"none",border:"1px dashed #D1D5DB",borderRadius:8,padding:"6px 14px",fontSize:12,color:"#6B7280",cursor:"pointer",width:"100%"}}>＋ 項目を追加</button>
                              ):(
                                <div style={{border:"1px solid #D1D5DB",borderRadius:8,padding:8}}>
                                  <div style={{display:"flex",gap:4}}>
                                    <input placeholder="項目名 or コードで検索..." value={addItemSearch} onChange={e=>{setAddItemSearch(e.target.value);searchFee(e.target.value);}} style={{flex:1,border:"1px solid #E5E7EB",borderRadius:6,padding:"4px 10px",fontSize:12}} />
                                    <button onClick={()=>{setShowAddItem(false);setAddItemSearch("");setAddItemResults([]);}} style={{background:"none",border:"none",color:"#9CA3AF",cursor:"pointer",fontSize:14}}>✕</button>
                                  </div>
                                  {addItemResults.length>0&&(
                                    <div style={{maxHeight:140,overflowY:"auto",marginTop:4}}>
                                      {addItemResults.map((r,i)=>(
                                        <div key={i} onClick={()=>{
                                          const ni=[...(billingData?.items||[]),{code:r.code,name:r.name,points:r.points,count:1,category:r.category}];
                                          const nt=ni.reduce((s,x)=>s+x.points*x.count,0);
                                          setBillingData({items:ni,total:nt,burden:Math.round(nt*10*0.3)});
                                          setShowAddItem(false);setAddItemSearch("");setAddItemResults([]);
                                        }} style={{display:"flex",justifyContent:"space-between",padding:"4px 8px",fontSize:11,cursor:"pointer",borderBottom:"1px solid #F3F4F6",borderRadius:4}}
                                          onMouseOver={e=>(e.currentTarget.style.background="#EFF6FF")} onMouseOut={e=>(e.currentTarget.style.background="transparent")}>
                                          <span>{r.name}</span><span style={{fontWeight:600}}>{r.points}点</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })():(
                        <div style={{padding:16,color:"#EF4444",fontSize:14,textAlign:"center"}}>⚠️ 算定データを取得できませんでした</div>
                      )}
                    </div>
                    <div style={{display:"flex",gap:10,justifyContent:"center"}}>
                      <button onClick={handleRevoke} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:10,padding:"10px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>↩ 確定取り消し</button>
                      <button onClick={async()=>{
                        if(!recordId) return;
                        try{
                          if(billingData&&billingData.items.length>0){
                            const res=await fetch("/api/auto-billing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({record_id:recordId,use_preview:true,preview_items:billingData.items})});
                            const d=await res.json();if(d.success) setBillingSaved(true);
                          }else{
                            const res=await fetch("/api/auto-billing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({record_id:recordId})});
                            const d=await res.json();if(d.success) setBillingSaved(true);
                          }
                        }catch(e){console.error("billing save error",e);}
                        await supabase.from("appointments").update({status:"completed"}).eq("id",appointmentId);
                        window.location.href="/billing";
                      }} style={{background:"linear-gradient(135deg,#22C55E,#16A34A)",color:"#FFF",border:"none",borderRadius:12,padding:"12px 32px",fontSize:16,fontWeight:800,cursor:"pointer",boxShadow:"0 2px 12px rgba(34,197,94,0.2)"}}>💰 {billingSaved?"会計へ →":"算定確定 → 会計へ"}</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ====== TAB: 歯式 ====== */}
            {rightTab==="tooth"&&(
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                <div style={{background:"#FFF",borderRadius:14,padding:20,border:"1px solid #E5E7EB"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                    <span style={{fontSize:18,fontWeight:800}}>🦷 歯式チャート</span>
                    <span style={{fontSize:12,color:"#9CA3AF"}}>{Object.keys(toothChart).filter(k=>{const p=getPrimary(toothChart,k);return p!=="normal";}).length}歯に所見</span>
                  </div>
                  <div style={{fontSize:10,color:"#6B7280",textAlign:"center",marginBottom:8}}>歯をタップしてステータスを変更</div>
                  {/* 上顎 */}
                  <div style={{display:"flex",justifyContent:"center",gap:3,marginBottom:4}}>
                    {TOOTH_U.map(t=>{const p=getPrimary(toothChart,t);const s=TS[p]||TS.normal;
                      return <div key={t} onClick={()=>setToothEditTarget(toothEditTarget===t?null:t)}
                        style={{width:42,height:42,borderRadius:8,background:toothEditTarget===t?"#DBEAFE":s.bg,border:`2px solid ${toothEditTarget===t?"#3B82F6":s.tx+"40"}`,
                          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all 0.15s"}}>
                        <div style={{fontSize:8,color:s.tx,fontWeight:700}}>{p!=="normal"?s.lb:""}</div>
                        <div style={{fontSize:13,fontWeight:700,color:s.tx}}>{t}</div>
                      </div>;
                    })}
                  </div>
                  <div style={{height:2,background:"#E5E7EB",margin:"6px auto",width:"95%"}} />
                  {/* 下顎 */}
                  <div style={{display:"flex",justifyContent:"center",gap:3,marginTop:4}}>
                    {TOOTH_L.map(t=>{const p=getPrimary(toothChart,t);const s=TS[p]||TS.normal;
                      return <div key={t} onClick={()=>setToothEditTarget(toothEditTarget===t?null:t)}
                        style={{width:42,height:42,borderRadius:8,background:toothEditTarget===t?"#DBEAFE":s.bg,border:`2px solid ${toothEditTarget===t?"#3B82F6":s.tx+"40"}`,
                          display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",transition:"all 0.15s"}}>
                        <div style={{fontSize:13,fontWeight:700,color:s.tx}}>{t}</div>
                        <div style={{fontSize:8,color:s.tx,fontWeight:700}}>{p!=="normal"?s.lb:""}</div>
                      </div>;
                    })}
                  </div>
                  {/* 凡例 */}
                  <div style={{display:"flex",gap:8,marginTop:12,justifyContent:"center",flexWrap:"wrap"}}>
                    {Object.entries(TS).filter(([k])=>k!=="normal"&&Object.values(toothChart).some(v=>typeof v==="string"?v===k:Array.isArray(v)&&v.includes(k))).map(([k,v])=>(
                      <span key={k} style={{fontSize:10,fontWeight:700,padding:"3px 8px",borderRadius:6,background:v.bg,color:v.tx}}>{v.lb}</span>
                    ))}
                  </div>
                </div>

                {/* 歯ステータス選択ポップアップ */}
                {toothEditTarget&&(
                  <div style={{background:"#FFF",borderRadius:14,padding:16,border:"2px solid #3B82F6",boxShadow:"0 4px 20px rgba(59,130,246,0.15)"}}>
                    <div style={{textAlign:"center",marginBottom:10}}>
                      <span style={{fontSize:20,fontWeight:900}}>#{toothEditTarget}</span>
                      <span style={{fontSize:12,color:"#6B7280",marginLeft:6}}>（複数選択可）</span>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      {TOOTH_STATUSES.map(st=>{
                        const current=getPrimary(toothChart,toothEditTarget);
                        const isActive=current===st.key;
                        return <button key={st.key} onClick={()=>{
                          setToothChart(prev=>({...prev,[toothEditTarget]:st.key}));
                          // medical_recordsのtooth_chartも更新
                          if(recordId){
                            supabase.from("medical_records").update({tooth_chart:{...toothChart,[toothEditTarget]:st.key}}).eq("id",recordId).then(()=>{});
                          }
                        }} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,border:isActive?"2px solid #3B82F6":"1px solid #E5E7EB",background:isActive?"#EFF6FF":"#FFF",cursor:"pointer",textAlign:"left"}}>
                          {isActive&&<span style={{fontSize:16,color:"#3B82F6"}}>✓</span>}
                          <span style={{fontSize:14,fontWeight:700,color:st.color,minWidth:32}}>{st.icon}</span>
                          <span style={{fontSize:13,fontWeight:600,color:"#374151"}}>{st.label}</span>
                        </button>;
                      })}
                    </div>
                    <button onClick={()=>setToothEditTarget(null)} style={{display:"block",margin:"10px auto 0",background:"none",border:"none",color:"#6B7280",fontSize:13,fontWeight:600,cursor:"pointer"}}>閉じる</button>
                  </div>
                )}

                {/* レントゲン・カメラ */}
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>{const inp=document.createElement("input");inp.type="file";inp.accept="image/*";inp.onchange=async(e)=>{
                    const f=(e.target as HTMLInputElement).files?.[0];if(!f||!appointmentId) return;
                    setXrayUploading(true);
                    const fd=new FormData();fd.append("file",f);fd.append("appointment_id",appointmentId);
                    try{const r=await fetch("/api/xray-analyze",{method:"POST",body:fd});const d=await r.json();
                      if(d.tooth_updates){setToothChart(prev=>({...prev,...d.tooth_updates}));}}catch(e){console.error(e);}
                    setXrayUploading(false);
                  };inp.click();}} style={{flex:1,background:"#EDE9FE",color:"#7C3AED",border:"2px dashed #C4B5FD",borderRadius:12,padding:"16px 0",fontSize:14,fontWeight:700,cursor:"pointer",textAlign:"center"}}>
                    {xrayUploading?"⏳ 分析中...":"📸 レントゲン → AI歯式分析"}
                  </button>
                  <button style={{flex:1,background:"#EDE9FE",color:"#7C3AED",border:"2px dashed #C4B5FD",borderRadius:12,padding:"16px 0",fontSize:14,fontWeight:700,cursor:"pointer",textAlign:"center"}}>📷 カメラ撮影</button>
                </div>
                {drafts.tooth&&(
                  <div style={{background:"#FFF",borderRadius:12,padding:16,border:"1px solid #E5E7EB"}}>
                    <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>歯式記録</div>
                    <div style={{fontSize:14,color:"#374151",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{drafts.tooth.draft_text}</div>
                  </div>
                )}
              </div>
            )}

            {/* ====== TAB: P検 ====== */}
            {rightTab==="perio"&&(
              <div style={{display:"flex",flexDirection:"column",gap:16}}>
                {/* 設定バー */}
                <div style={{background:"#FFF",borderRadius:12,padding:12,border:"1px solid #E5E7EB",display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:"#374151"}}>点式:</span>
                    {([1,4,6] as const).map(n=>(
                      <button key={n} onClick={()=>setPerioPoints(n)}
                        style={{padding:"4px 12px",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer",border:perioPoints===n?"2px solid #2563EB":"1px solid #D1D5DB",background:perioPoints===n?"#EFF6FF":"#FFF",color:perioPoints===n?"#2563EB":"#6B7280"}}>
                        {n}点式
                      </button>
                    ))}
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:"#374151"}}>順序:</span>
                    {([["konoji","コの字"],["z","Z型"],["s","S型"],["buccal-lingual","頬→舌"]] as [string,string][]).map(([k,l])=>(
                      <button key={k} onClick={()=>setPerioOrder(k as typeof perioOrder)}
                        style={{padding:"4px 10px",borderRadius:6,fontSize:11,fontWeight:700,cursor:"pointer",border:perioOrder===k?"2px solid #2563EB":"1px solid #D1D5DB",background:perioOrder===k?"#EFF6FF":"#FFF",color:perioOrder===k?"#2563EB":"#6B7280"}}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{background:"#FFF",borderRadius:14,padding:20,border:"1px solid #E5E7EB"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                    <span style={{fontSize:18,fontWeight:800}}>📊 歯周検査（{perioPoints}点法）</span>
                    <div style={{display:"flex",gap:10}}>
                      <span style={{fontSize:11,display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:10,background:"#BBF7D0",borderRadius:3,display:"inline-block"}} />≤3mm</span>
                      <span style={{fontSize:11,display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:10,background:"#FED7AA",borderRadius:3,display:"inline-block"}} />4-5mm</span>
                      <span style={{fontSize:11,display:"flex",alignItems:"center",gap:3}}><span style={{width:10,height:10,background:"#FCA5A5",borderRadius:3,display:"inline-block"}} />≥6mm</span>
                      <span style={{fontSize:11,display:"flex",alignItems:"center",gap:3}}><span style={{width:8,height:8,background:"#EF4444",borderRadius:"50%",display:"inline-block"}} />BOP</span>
                    </div>
                  </div>
                  {/* 上顎 */}
                  <div style={{marginBottom:4,fontSize:11,fontWeight:600,color:"#6B7280"}}>上顎</div>
                  <div style={{display:"flex",justifyContent:"center",gap:1,marginBottom:2}}>
                    {TOOTH_U.map(t=>{const pd=perioData[t];
                      const buccalVals = perioPoints===6?(pd?.buccal||[0,0,0]):perioPoints===4?[pd?.buccal?.[0]||0,pd?.buccal?.[2]||0]:[Math.max(...(pd?.buccal||[0,0,0]))];
                      const lingualVals = perioPoints===6?(pd?.lingual||[0,0,0]):perioPoints===4?[pd?.lingual?.[0]||0,pd?.lingual?.[2]||0]:[Math.max(...(pd?.lingual||[0,0,0]))];
                      return <div key={t} onClick={()=>setPerioEditTarget(perioEditTarget===t?null:t)} style={{display:"flex",flexDirection:"column",alignItems:"center",width:38,cursor:"pointer"}}>
                        <div style={{display:"flex",gap:1,marginBottom:1}}>
                          {buccalVals.map((v,i)=>{const bg=v>=6?"#FCA5A5":v>=4?"#FED7AA":"#BBF7D0";
                            return <div key={i} style={{width:perioPoints===1?20:perioPoints===4?14:10,height:16,borderRadius:2,background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:700,color:v>=4?"#991B1B":"#166534"}}>{v||""}</div>;})}
                        </div>
                        <div style={{width:36,height:24,borderRadius:4,background:perioEditTarget===t?"#DBEAFE":pd?"#F1F5F9":"#F9FAFB",border:perioEditTarget===t?"2px solid #3B82F6":"1px solid #E2E8F0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:pd?"#374151":"#D1D5DB",position:"relative"}}>
                          {t}
                          {pd?.bop&&<div style={{position:"absolute",top:-2,right:-2,width:6,height:6,borderRadius:"50%",background:"#EF4444"}} />}
                        </div>
                        <div style={{display:"flex",gap:1,marginTop:1}}>
                          {lingualVals.map((v,i)=>{const bg=v>=6?"#FCA5A5":v>=4?"#FED7AA":"#BBF7D0";
                            return <div key={i} style={{width:perioPoints===1?20:perioPoints===4?14:10,height:16,borderRadius:2,background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:700,color:v>=4?"#991B1B":"#166534"}}>{v||""}</div>;})}
                        </div>
                      </div>;
                    })}
                  </div>
                  <div style={{height:2,background:"#E5E7EB",margin:"8px auto",width:"95%"}} />
                  {/* 下顎 */}
                  <div style={{marginBottom:4,fontSize:11,fontWeight:600,color:"#6B7280"}}>下顎</div>
                  <div style={{display:"flex",justifyContent:"center",gap:1}}>
                    {TOOTH_L.map(t=>{const pd=perioData[t];
                      const buccalVals = perioPoints===6?(pd?.buccal||[0,0,0]):perioPoints===4?[pd?.buccal?.[0]||0,pd?.buccal?.[2]||0]:[Math.max(...(pd?.buccal||[0,0,0]))];
                      const lingualVals = perioPoints===6?(pd?.lingual||[0,0,0]):perioPoints===4?[pd?.lingual?.[0]||0,pd?.lingual?.[2]||0]:[Math.max(...(pd?.lingual||[0,0,0]))];
                      return <div key={t} onClick={()=>setPerioEditTarget(perioEditTarget===t?null:t)} style={{display:"flex",flexDirection:"column",alignItems:"center",width:38,cursor:"pointer"}}>
                        <div style={{display:"flex",gap:1,marginBottom:1}}>
                          {buccalVals.map((v,i)=>{const bg=v>=6?"#FCA5A5":v>=4?"#FED7AA":"#BBF7D0";
                            return <div key={i} style={{width:perioPoints===1?20:perioPoints===4?14:10,height:16,borderRadius:2,background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:700,color:v>=4?"#991B1B":"#166534"}}>{v||""}</div>;})}
                        </div>
                        <div style={{width:36,height:24,borderRadius:4,background:perioEditTarget===t?"#DBEAFE":pd?"#F1F5F9":"#F9FAFB",border:perioEditTarget===t?"2px solid #3B82F6":"1px solid #E2E8F0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:pd?"#374151":"#D1D5DB",position:"relative"}}>
                          {t}
                          {pd?.bop&&<div style={{position:"absolute",top:-2,right:-2,width:6,height:6,borderRadius:"50%",background:"#EF4444"}} />}
                        </div>
                        <div style={{display:"flex",gap:1,marginTop:1}}>
                          {lingualVals.map((v,i)=>{const bg=v>=6?"#FCA5A5":v>=4?"#FED7AA":"#BBF7D0";
                            return <div key={i} style={{width:perioPoints===1?20:perioPoints===4?14:10,height:16,borderRadius:2,background:bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:7,fontWeight:700,color:v>=4?"#991B1B":"#166534"}}>{v||""}</div>;})}
                        </div>
                      </div>;
                    })}
                  </div>
                </div>

                {/* P検 手動入力パネル */}
                {perioEditTarget&&(()=>{
                  const pd=perioData[perioEditTarget]||{buccal:[0,0,0] as [number,number,number],lingual:[0,0,0] as [number,number,number],bop:false,mobility:0};
                  const updatePerio=(field:string,value:unknown)=>{
                    const updated={...pd,[field]:value};
                    setPerioData(prev=>({...prev,[perioEditTarget]:updated as typeof pd}));
                    // DBにも保存
                    if(patient?.id){
                      const allPerio={...perioData,[perioEditTarget]:updated};
                      supabase.from("patients").update({current_perio_chart:allPerio}).eq("id",patient.id).then(()=>{});
                    }
                  };
                  const setBuccalVal=(idx:number,val:number)=>{const b=[...pd.buccal] as [number,number,number];b[idx]=val;updatePerio("buccal",b);};
                  const setLingualVal=(idx:number,val:number)=>{const l=[...pd.lingual] as [number,number,number];l[idx]=val;updatePerio("lingual",l);};
                  const allTeeth=[...TOOTH_U,...TOOTH_L];
                  const curIdx=allTeeth.indexOf(perioEditTarget);
                  const prevTooth=curIdx>0?allTeeth[curIdx-1]:null;
                  const nextTooth=curIdx<allTeeth.length-1?allTeeth[curIdx+1]:null;

                  return(
                    <div style={{background:"#FFF",borderRadius:14,padding:20,border:"2px solid #3B82F6",boxShadow:"0 4px 20px rgba(59,130,246,0.15)"}}>
                      <div style={{textAlign:"center",marginBottom:12}}>
                        <span style={{fontSize:24,fontWeight:900}}>#{perioEditTarget}</span>
                        <span style={{fontSize:12,color:"#6B7280",marginLeft:6}}>歯周検査データ</span>
                      </div>

                      {/* 頬側 */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
                        <div>
                          <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:6}}>頬側 {perioPoints===6?"(MB / B / DB)":perioPoints===4?"(M / D)":"(最深部)"}</div>
                          <div style={{display:"flex",gap:6}}>
                            {(perioPoints===6?[0,1,2]:perioPoints===4?[0,2]:[0]).map(i=>(
                              <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                                {[...Array(13)].map((_,v)=>(
                                  <button key={v} onClick={()=>setBuccalVal(i,v)}
                                    style={{width:perioPoints===1?48:perioPoints===4?40:32,height:22,borderRadius:4,fontSize:12,fontWeight:pd.buccal[i]===v?800:500,
                                      background:pd.buccal[i]===v?(v>=6?"#FCA5A5":v>=4?"#FED7AA":"#BBF7D0"):"#F9FAFB",
                                      border:pd.buccal[i]===v?"2px solid #3B82F6":"1px solid #E5E7EB",
                                      color:pd.buccal[i]===v?"#111":"#9CA3AF",cursor:"pointer",padding:0}}>
                                    {v}
                                  </button>
                                )).reverse()}
                              </div>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{fontSize:12,fontWeight:700,color:"#374151",marginBottom:6,textAlign:"right"}}>舌側 {perioPoints===6?"(ML / L / DL)":perioPoints===4?"(M / D)":"(最深部)"}</div>
                          <div style={{display:"flex",gap:6}}>
                            {(perioPoints===6?[0,1,2]:perioPoints===4?[0,2]:[0]).map(i=>(
                              <div key={i} style={{display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                                {[...Array(13)].map((_,v)=>(
                                  <button key={v} onClick={()=>setLingualVal(i,v)}
                                    style={{width:perioPoints===1?48:perioPoints===4?40:32,height:22,borderRadius:4,fontSize:12,fontWeight:pd.lingual[i]===v?800:500,
                                      background:pd.lingual[i]===v?(v>=6?"#FCA5A5":v>=4?"#FED7AA":"#BBF7D0"):"#F9FAFB",
                                      border:pd.lingual[i]===v?"2px solid #3B82F6":"1px solid #E5E7EB",
                                      color:pd.lingual[i]===v?"#111":"#9CA3AF",cursor:"pointer",padding:0}}>
                                    {v}
                                  </button>
                                )).reverse()}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* BOP・動揺度・分岐部 */}
                      <div style={{display:"flex",gap:20,flexWrap:"wrap",alignItems:"center"}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:12,fontWeight:700}}>BOP:</span>
                          <button onClick={()=>updatePerio("bop",!pd.bop)}
                            style={{padding:"4px 14px",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer",
                              background:pd.bop?"#FEE2E2":"#F0FDF4",border:pd.bop?"2px solid #EF4444":"2px solid #22C55E",
                              color:pd.bop?"#DC2626":"#16A34A"}}>
                            {pd.bop?"(+) 出血あり":"(-) 出血なし"}
                          </button>
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:12,fontWeight:700}}>動揺:</span>
                          {[0,1,2,3].map(m=>(
                            <button key={m} onClick={()=>updatePerio("mobility",m)}
                              style={{width:30,height:28,borderRadius:6,fontSize:13,fontWeight:700,cursor:"pointer",
                                background:pd.mobility===m?"#DBEAFE":"#F9FAFB",border:pd.mobility===m?"2px solid #3B82F6":"1px solid #E5E7EB",
                                color:pd.mobility===m?"#2563EB":"#9CA3AF"}}>
                              {m}
                            </button>
                          ))}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontSize:12,fontWeight:700}}>分岐部:</span>
                          {(["—","F1","F2","F3"] as const).map((f,fi)=>(
                            <button key={f} onClick={()=>updatePerio("furcation",fi===0?0:fi)}
                              style={{padding:"4px 10px",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer",
                                background:(pd as Record<string,unknown>).furcation===(fi===0?0:fi)?"#DBEAFE":"#F9FAFB",
                                border:(pd as Record<string,unknown>).furcation===(fi===0?0:fi)?"2px solid #3B82F6":"1px solid #E5E7EB",
                                color:(pd as Record<string,unknown>).furcation===(fi===0?0:fi)?"#2563EB":"#9CA3AF"}}>
                              {f}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* ナビゲーション */}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:14}}>
                        <button onClick={()=>prevTooth&&setPerioEditTarget(prevTooth)}
                          style={{background:prevTooth?"#F9FAFB":"transparent",border:prevTooth?"1px solid #E5E7EB":"none",borderRadius:8,padding:"6px 16px",fontSize:12,fontWeight:600,cursor:prevTooth?"pointer":"default",color:prevTooth?"#374151":"#D1D5DB"}}>
                          ← 前の歯 {prevTooth?`#${prevTooth}`:""}
                        </button>
                        <button onClick={()=>setPerioEditTarget(null)} style={{background:"none",border:"none",color:"#6B7280",fontSize:12,fontWeight:600,cursor:"pointer"}}>閉じる</button>
                        <button onClick={()=>nextTooth&&setPerioEditTarget(nextTooth)}
                          style={{background:nextTooth?"#3B82F6":"transparent",border:"none",borderRadius:8,padding:"6px 16px",fontSize:12,fontWeight:700,cursor:nextTooth?"pointer":"default",color:nextTooth?"#FFF":"#D1D5DB"}}>
                          次の歯 → {nextTooth?`#${nextTooth}`:""}
                        </button>
                      </div>
                    </div>
                  );
                })()}
                {drafts.perio&&(
                  <div style={{background:"#FFF",borderRadius:12,padding:16,border:"1px solid #E5E7EB"}}>
                    <div style={{fontSize:14,fontWeight:700,marginBottom:8}}>P検記録</div>
                    <div style={{fontSize:13,color:"#374151",lineHeight:1.8,whiteSpace:"pre-wrap"}}>{drafts.perio.draft_text}</div>
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}`}</style>
    </div>
  );
}

export default function KarteAgentUnit(){
  return <Suspense fallback={<div style={{padding:40,textAlign:"center"}}>読み込み中...</div>}><UnitContent /></Suspense>;
}
