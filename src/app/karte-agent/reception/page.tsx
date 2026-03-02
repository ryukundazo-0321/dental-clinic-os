"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";

const STEPS = [
  { key: "s", label: "主訴(S)", short: "S", color: "#EF4444", bg: "#FEF2F2" },
  { key: "tooth", label: "歯式", short: "🦷", color: "#7C3AED", bg: "#F5F3FF" },
  { key: "perio", label: "P検", short: "P", color: "#0D9488", bg: "#F0FDFA" },
  { key: "dh", label: "DH記録", short: "O", color: "#3B82F6", bg: "#EFF6FF" },
  { key: "dr", label: "Dr診察", short: "AP", color: "#D97706", bg: "#FFFBEB" },
];

const TOOTH_U = ["18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28"];
const TOOTH_L = ["48","47","46","45","44","43","42","41","31","32","33","34","35","36","37","38"];
const TS: Record<string,{bg:string;tx:string;lb:string}> = {
  normal:{bg:"#F1F5F9",tx:"#94A3B8",lb:""},c1:{bg:"#FEF9C3",tx:"#854D0E",lb:"C1"},c2:{bg:"#FDE68A",tx:"#78350F",lb:"C2"},
  c3:{bg:"#FB923C",tx:"#FFF",lb:"C3"},c4:{bg:"#DC2626",tx:"#FFF",lb:"C4"},cr:{bg:"#60A5FA",tx:"#FFF",lb:"CR"},
  in_treatment:{bg:"#A78BFA",tx:"#FFF",lb:"治"},missing:{bg:"#E2E8F0",tx:"#CBD5E1",lb:"—"},
  fmc:{bg:"#38BDF8",tx:"#FFF",lb:"F"},inlay:{bg:"#38BDF8",tx:"#FFF",lb:"In"},
  crown:{bg:"#2DD4BF",tx:"#FFF",lb:"冠"},bridge:{bg:"#818CF8",tx:"#FFF",lb:"Br"},
};

type Chunk = { id:string; chunk_index:number; corrected_text:string; raw_text:string; speaker_role:string; classified_field:string|null; created_at:string };
type Draft = { id:string; field_key:string; draft_text:string; status:string; updated_at:string };
type ActiveUnit = { appointment_id:string; patient_name:string; patient_age:number; allergies:string[]; type:string; unit_name:string };
type Message = { id:string; direction:string; related_field:string|null; message_text:string; created_at:string };

function parseToothChart(text:string):Record<string,string> {
  const c:Record<string,string> = {};
  const pats = [
    {r:/#(\d{2})\s+C(\d)/gi, fn:(m:RegExpMatchArray)=>({t:m[1],s:"c"+m[2]})},
    {r:/#(\d{2})\s+CR/gi, fn:(m:RegExpMatchArray)=>({t:m[1],s:"cr"})},
    {r:/#(\d{2})\s+FMC/gi, fn:(m:RegExpMatchArray)=>({t:m[1],s:"fmc"})},
    {r:/#(\d{2})[^a-z]*治療中/gi, fn:(m:RegExpMatchArray)=>({t:m[1],s:"in_treatment"})},
    {r:/#(\d{2})[^a-z]*欠損/gi, fn:(m:RegExpMatchArray)=>({t:m[1],s:"missing"})},
    {r:/#(\d{2})[^a-z]*インレー/gi, fn:(m:RegExpMatchArray)=>({t:m[1],s:"inlay"})},
    {r:/#(\d{2})[^a-z]*冠/gi, fn:(m:RegExpMatchArray)=>({t:m[1],s:"crown"})},
  ];
  pats.forEach(p=>{let m;const r=new RegExp(p.r.source,p.r.flags);while((m=r.exec(text))!==null){const x=p.fn(m);c[x.t]=x.s;}});
  return c;
}

function parsePerioChart(text:string):Record<string,{ppd:number[];bop:boolean}> {
  const p:Record<string,{ppd:number[];bop:boolean}> = {};
  text.split(/[\n\/]/).forEach(line=>{
    const tm=line.match(/#(\d{2})/); if(!tm) return;
    const nums=line.match(/\d+[,，]\d+[,，]\d+/g);
    const bop=/BOP\s*\(\+\)|BOP陽性|BOP\+/i.test(line);
    if(nums){const all=nums.flatMap(n=>n.split(/[,，]/).map(Number)); p[tm[1]]={ppd:all.slice(0,6),bop};}
  });
  return p;
}

export default function KarteAgentReception() {
  const [units, setUnits] = useState<ActiveUnit[]>([]);
  const [selApt, setSelApt] = useState("");
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [editing, setEditing] = useState<string|null>(null);
  const [editVal, setEditVal] = useState("");
  const [fieldMsgOpen, setFieldMsgOpen] = useState<string|null>(null);
  const [fieldMsgInput, setFieldMsgInput] = useState<Record<string,string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [actionModal, setActionModal] = useState<string|null>(null);
  const [billingData, setBillingData] = useState<{items:{code:string;name:string;points:number;count:number;category:string}[];total:number;burden:number}|null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [previewRecordId, setPreviewRecordId] = useState<string|null>(null);
  const [billingSaved, setBillingSaved] = useState(false);
  const [addItemSearch, setAddItemSearch] = useState("");
  const [addItemResults, setAddItemResults] = useState<{code:string;name:string;points:number;category:string}[]>([]);
  const [showAddItem, setShowAddItem] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadUnits = useCallback(async () => {
    const {data} = await supabase.from("appointments")
      .select("id, patient_type, unit_id, patients(name_kanji, date_of_birth, allergies)")
      .eq("status","in_consultation").order("scheduled_at",{ascending:true});
    if(data){
      const mapped = data.map((a:Record<string,unknown>)=>{
        const p=a.patients as Record<string,unknown>|null;
        const age=p?.date_of_birth?Math.floor((Date.now()-new Date(p.date_of_birth as string).getTime())/31557600000):0;
        return {appointment_id:a.id as string,patient_name:(p?.name_kanji as string)||"不明",patient_age:age,allergies:(p?.allergies as string[])||[],type:(a.patient_type as string)==="new"?"初診":"再診",unit_name:a.unit_id?`U${a.unit_id}`:"未割当"};
      });
      setUnits(mapped);
      if(!selApt&&mapped.length>0) setSelApt(mapped[0].appointment_id);
    }
  },[selApt]);

  useEffect(()=>{
    loadUnits();
    // Realtime: listen for appointment status changes (new patients arriving, etc.)
    const ch=supabase.channel("rec-appointments")
      .on("postgres_changes",{event:"*",schema:"public",table:"appointments"},()=>loadUnits())
      .subscribe();
    // Polling fallback: 3s
    const t=setInterval(loadUnits,3000);
    return ()=>{supabase.removeChannel(ch);clearInterval(t);};
  },[loadUnits]);

  const loadData = useCallback(async () => {
    if(!selApt) return;
    const [{data:c},{data:d},{data:m}] = await Promise.all([
      supabase.from("karte_transcript_chunks").select("*").eq("appointment_id",selApt).order("chunk_index"),
      supabase.from("karte_ai_drafts").select("*").eq("appointment_id",selApt),
      supabase.from("karte_messages").select("*").eq("appointment_id",selApt).order("created_at"),
    ]);
    if(c) setChunks(c);
    if(d){setDrafts(d as Draft[]);setConfirmed((d as Draft[]).length>=5&&(d as Draft[]).every(x=>x.status==="confirmed"));}
    if(m) setMsgs(m);
  },[selApt]);

  useEffect(()=>{loadData();},[loadData]);

  useEffect(()=>{
    if(!selApt) return;
    const ch=supabase.channel(`rec-${selApt}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"karte_transcript_chunks",filter:`appointment_id=eq.${selApt}`},()=>loadData())
      .on("postgres_changes",{event:"*",schema:"public",table:"karte_ai_drafts",filter:`appointment_id=eq.${selApt}`},()=>loadData())
      .on("postgres_changes",{event:"INSERT",schema:"public",table:"karte_messages",filter:`appointment_id=eq.${selApt}`},()=>loadData())
      .subscribe();
    // Polling fallback: refresh every 3s for realtime transcript visibility
    const poll=setInterval(()=>loadData(),3000);
    return ()=>{supabase.removeChannel(ch);clearInterval(poll);};
  },[selApt,loadData]);

  useEffect(()=>{if(scrollRef.current) scrollRef.current.scrollTop=scrollRef.current.scrollHeight;},[chunks]);

  // confirmed時にbilling-previewを呼ぶ（プレビュー表示用）
  useEffect(()=>{
    if(!confirmed||!selApt||billingData) return;
    (async()=>{
      setBillingLoading(true);
      try {
        const {data:rec} = await supabase.from("medical_records").select("id").eq("appointment_id",selApt).order("created_at",{ascending:false}).limit(1).single();
        if(rec?.id){
          const res = await fetch("/api/billing-preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({record_id:rec.id})});
          const d = await res.json();
          if(d.success){
            const items = (d.items||[]) as {code:string;name:string;points:number;count:number;category:string}[];
            const total = d.total_points||0;
            const burden = d.patient_burden || Math.round(total*10*0.3);
            setBillingData({items,total,burden});
            setPreviewRecordId(rec.id);
          }
        }
      } catch(e){console.error("billing-preview error",e);}
      setBillingLoading(false);
    })();
  },[confirmed,selApt,billingData,units]);

  const getDraft=(key:string)=>drafts.find(d=>d.field_key===key);
  const searchFee = useCallback(async(q:string)=>{
    if(q.length<1){setAddItemResults([]);return;}
    const {data} = await supabase.from("fee_master_v2").select("kubun_code,sub_code,name,name_short,points,category").or(`name.ilike.%${q}%,name_short.ilike.%${q}%,kubun_code.ilike.%${q}%`).limit(10);
    if(data) setAddItemResults(data.map((d: {kubun_code:string;sub_code:string;name:string;name_short:string;points:number;category:string}) => ({code: d.sub_code ? `${d.kubun_code}-${d.sub_code}` : d.kubun_code, name: d.name_short || d.name, points: d.points, category: d.category})));
  },[]);

  const approve=async(key:string,editedText?:string)=>{
    await fetch("/api/karte-agent/action",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"approve",appointment_id:selApt,field_key:key,edited_text:editedText})});
    setEditing(null);loadData();
  };
  const regenerateDraft=async(key:string)=>{
    await fetch("/api/karte-agent/generate-draft",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({appointment_id:selApt,field_key:key})});
    loadData();
  };
  const sendFieldMsg=async(field:string)=>{
    const text=fieldMsgInput[field];if(!text?.trim()) return;
    await fetch("/api/karte-agent/action",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({action:"message",appointment_id:selApt,direction:"to_unit",related_field:field,message_text:text})});
    setFieldMsgInput(p=>({...p,[field]:""}));setFieldMsgOpen(null);loadData();
  };

  const apCnt=STEPS.filter(st=>{const d=getDraft(st.key);return d?.status==="approved"||d?.status==="confirmed";}).length;
  const u=units.find(uu=>uu.appointment_id===selApt);
  const toothDraft=getDraft("tooth");
  const perioDraft=getDraft("perio");
  const toothChart=toothDraft?parseToothChart(toothDraft.draft_text):{};
  const perioChart=perioDraft?parsePerioChart(perioDraft.draft_text):{};

  const ToothRow=({teeth}:{teeth:string[]})=>(
    <div style={{display:"flex",gap:2}}>
      {teeth.map(t=>{const st=toothChart[t]||"normal";const c=TS[st]||TS.normal;
        return <div key={t} style={{width:22,height:26,borderRadius:5,background:c.bg,color:c.tx,fontSize:7,fontWeight:700,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",border:"1px solid "+(st!=="normal"?c.bg:"#E2E8F0")}}>
          <div style={{fontSize:6,color:st!=="normal"?c.tx:"#CBD5E1",lineHeight:1}}>{t}</div>
          <div style={{fontSize:8,fontWeight:800,lineHeight:1}}>{c.lb}</div>
        </div>;
      })}
    </div>
  );

  const PerioRow=({teeth}:{teeth:string[]})=>(
    <div style={{display:"flex",gap:1}}>
      {teeth.map(t=>{const p=perioChart[t];
        if(!p) return <div key={t} style={{width:22,height:20}} />;
        const mx=Math.max(...p.ppd);
        return <div key={t} style={{width:22,height:20,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"flex-end",position:"relative"}}>
          <div style={{width:"100%",height:Math.min(mx*3,18),background:mx>=4?"#FCA5A5":"#BBF7D0",borderRadius:2}} />
          {p.bop&&<div style={{position:"absolute",top:0,width:4,height:4,borderRadius:"50%",background:"#EF4444"}} />}
          <div style={{fontSize:6,fontWeight:700,color:mx>=4?"#DC2626":"#6B7280"}}>{mx}</div>
        </div>;
      })}
    </div>
  );

  return (
    <div style={{fontFamily:"-apple-system,'Helvetica Neue','Noto Sans JP',sans-serif",height:"100vh",display:"flex",flexDirection:"column",background:"#F8FAFC",color:"#1E293B"}}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}`}</style>
      <header style={{background:"#FFF",padding:"8px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",borderBottom:"1px solid #E5E7EB",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{width:8,height:8,borderRadius:"50%",background:"#22C55E",boxShadow:"0 0 8px rgba(34,197,94,0.4)"}} />
          <span style={{fontSize:16,fontWeight:700}}>カルテエージェント — 受付</span>
        </div>
        <span style={{fontSize:12,color:"#9CA3AF"}}>稼働: {units.length} ユニット</span>
      </header>

      <div style={{flex:1,display:"flex",overflow:"hidden",minHeight:0}}>
        {/* Unit list */}
        <div style={{width:180,background:"#FFF",borderRight:"1px solid #E5E7EB",overflow:"auto",flexShrink:0}}>
          <div style={{padding:"10px 10px 4px",fontSize:10,fontWeight:700,color:"#9CA3AF"}}>稼働</div>
          {units.length===0&&<div style={{padding:"20px 10px",fontSize:12,color:"#D1D5DB"}}>診察中の患者なし</div>}
          {units.map(uu=>{
            const isSel=uu.appointment_id===selApt;
            return(
              <div key={uu.appointment_id} onClick={()=>{setSelApt(uu.appointment_id);setBillingData(null);}}
                style={{padding:"8px 10px",margin:"2px 6px",borderRadius:10,cursor:"pointer",background:isSel?"#EFF6FF":"transparent",border:isSel?"1.5px solid #BFDBFE":"1.5px solid transparent"}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <span style={{fontSize:12,fontWeight:600}}>{uu.unit_name}</span>
                  <span style={{fontSize:9,fontWeight:600,padding:"1px 6px",borderRadius:5,background:uu.type==="初診"?"#FCE7F3":"#DBEAFE",color:uu.type==="初診"?"#DB2777":"#2563EB"}}>{uu.type}</span>
                </div>
                <div style={{fontSize:13,fontWeight:700,marginTop:2}}>{uu.patient_name}</div>
              </div>
            );
          })}
        </div>

        {/* Transcript */}
        <div style={{width:"30%",display:"flex",flexDirection:"column",borderRight:"1px solid #E5E7EB",background:"#FFF",minWidth:0}}>
          {u&&(
            <div style={{padding:"10px 14px",borderBottom:"1px solid #E5E7EB",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div><span style={{fontSize:16,fontWeight:700}}>{u.patient_name}</span><span style={{fontSize:12,color:"#9CA3AF",marginLeft:8}}>{u.patient_age}歳</span></div>
                {u.allergies.map(a=><span key={a} style={{background:"#FEF2F2",color:"#DC2626",fontSize:10,fontWeight:600,padding:"2px 8px",borderRadius:6}}>⚠ {a}</span>)}
              </div>
              {chunks.length>0&&<div style={{fontSize:11,fontWeight:600,color:"#3B82F6",marginTop:4}}>
                <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:"#3B82F6",marginRight:5,animation:"pulse 1.5s infinite"}} />
                文字起こし受信中 ({chunks.length}件)
              </div>}
            </div>
          )}
          <div ref={scrollRef} style={{flex:1,overflow:"auto",padding:"8px 12px",minHeight:0}}>
            {chunks.length===0&&<div style={{padding:30,textAlign:"center",color:"#D1D5DB",fontSize:13}}>診察室で録音が開始されると<br/>文字起こしが表示されます</div>}
            {chunks.map((c,i)=>{
              const tag=STEPS.find(s=>s.key===c.classified_field);
              return(
                <div key={i} style={{marginBottom:6}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:2}}>
                    <span style={{fontSize:9,color:"#D1D5DB"}}>{new Date(c.created_at).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}</span>
                    <span style={{fontSize:10,fontWeight:700,color:c.speaker_role==="dr"?"#2563EB":"#111827"}}>{c.speaker_role}</span>
                    {tag&&<span style={{fontSize:8,fontWeight:600,padding:"1px 5px",borderRadius:4,background:tag.bg,color:tag.color}}>→{tag.short}</span>}
                  </div>
                  <div style={{fontSize:13,color:"#374151",lineHeight:1.6,padding:"6px 10px",borderRadius:8,background:tag?tag.bg:"#F9FAFB",borderLeft:"3px solid "+(tag?tag.color:"#E5E7EB")}}>
                    {c.corrected_text||c.raw_text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Approval cards */}
        <div style={{flex:1,overflow:"auto",padding:12,display:"flex",flexDirection:"column",gap:8,minHeight:0}}>
          {/* Progress */}
          <div style={{display:"flex",gap:3,marginBottom:4,flexShrink:0}}>
            {STEPS.map(st=>{
              const d=getDraft(st.key);const done=d?.status==="approved"||d?.status==="confirmed";const has=!!d;
              return <div key={st.key} style={{flex:1,textAlign:"center",padding:"5px 0",borderRadius:8,background:done?"#F0FDF4":has?"#FFFBEB":"#F9FAFB",border:"1px solid "+(done?"#D1FAE5":has?"#FDE68A":"#E5E7EB")}}>
                <div style={{fontSize:9,fontWeight:800,color:done?"#16A34A":has?"#D97706":"#D1D5DB"}}>{done?"✓":has?"!":"·"}</div>
                <div style={{fontSize:10,fontWeight:600,color:"#374151"}}>{st.label}</div>
              </div>;
            })}
          </div>

          {/* Field cards */}
          {STEPS.map(st=>{
            const d=getDraft(st.key);const done=d?.status==="approved"||d?.status==="confirmed";
            const isEd=editing===st.key;const isMsgOpen=fieldMsgOpen===st.key;
            const showTooth=st.key==="tooth"&&d&&Object.keys(toothChart).length>0;
            const showPerio=st.key==="perio"&&d&&Object.keys(perioChart).length>0;
            return(
              <div key={st.key} style={{background:"#FFF",borderRadius:12,border:"1px solid "+(done?"#D1FAE5":d?"#FDE68A":"#E5E7EB"),flexShrink:0}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:26,height:26,borderRadius:7,background:st.bg,display:"flex",alignItems:"center",justifyContent:"center",color:st.color,fontSize:11,fontWeight:800}}>{st.short}</div>
                    <span style={{fontSize:14,fontWeight:700}}>{st.label}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    {!d&&chunks.length>0&&<button onClick={()=>regenerateDraft(st.key)} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:6,padding:"3px 8px",fontSize:10,fontWeight:600,cursor:"pointer"}}>AI生成</button>}
                    {done?<span style={{fontSize:11,fontWeight:600,color:"#16A34A"}}>✓ 承認済</span>
                      :d?<span style={{fontSize:10,fontWeight:600,color:"#D97706"}}>AI完了</span>
                      :<span style={{fontSize:10,color:"#D1D5DB"}}>待機</span>}
                  </div>
                </div>

                {/* Tooth chart */}
                {showTooth&&(
                  <div style={{padding:"0 14px 8px",display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
                    <ToothRow teeth={TOOTH_U} />
                    <div style={{height:1,background:"#F1F5F9",width:"100%"}} />
                    <ToothRow teeth={TOOTH_L} />
                    <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap",justifyContent:"center"}}>
                      {Object.entries(TS).filter(([k])=>k!=="normal"&&Object.values(toothChart).includes(k)).map(([k,v])=>(
                        <span key={k} style={{fontSize:7,fontWeight:600,padding:"1px 4px",borderRadius:3,background:v.bg,color:v.tx}}>{v.lb}</span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Perio chart */}
                {showPerio&&(
                  <div style={{padding:"0 14px 8px"}}>
                    <div style={{background:"#F8FAFB",borderRadius:8,padding:8,display:"flex",flexDirection:"column",gap:3,alignItems:"center"}}>
                      <div style={{fontSize:9,fontWeight:600,color:"#9CA3AF",alignSelf:"flex-start"}}>PPD(mm) + BOP</div>
                      <PerioRow teeth={TOOTH_U} />
                      <div style={{height:1,background:"#E5E7EB",width:"100%"}} />
                      <PerioRow teeth={TOOTH_L} />
                      <div style={{display:"flex",gap:8,marginTop:2}}>
                        <span style={{fontSize:7,display:"flex",alignItems:"center",gap:2}}><span style={{width:7,height:7,background:"#BBF7D0",borderRadius:2,display:"inline-block"}} />≤3</span>
                        <span style={{fontSize:7,display:"flex",alignItems:"center",gap:2}}><span style={{width:7,height:7,background:"#FCA5A5",borderRadius:2,display:"inline-block"}} />≥4</span>
                        <span style={{fontSize:7,display:"flex",alignItems:"center",gap:2}}><span style={{width:5,height:5,background:"#EF4444",borderRadius:"50%",display:"inline-block"}} />BOP</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Draft content */}
                {d&&(
                  <div style={{padding:"0 14px 12px"}}>
                    {isEd?(
                      <div>
                        <textarea value={editVal} onChange={e=>setEditVal(e.target.value)} style={{width:"100%",background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:8,padding:10,fontSize:13,color:"#111827",outline:"none",resize:"vertical",minHeight:70,lineHeight:1.7}} />
                        <div style={{display:"flex",gap:6,marginTop:6,justifyContent:"flex-end"}}>
                          <button onClick={()=>setEditing(null)} style={{background:"#F3F4F6",color:"#6B7280",border:"none",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>キャンセル</button>
                          <button onClick={()=>approve(st.key,editVal)} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:8,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>保存して承認</button>
                        </div>
                      </div>
                    ):(
                      <div>
                        <div style={{background:"#F9FAFB",borderRadius:8,padding:10,fontSize:13,color:"#374151",lineHeight:1.7,whiteSpace:"pre-wrap"}}>{d.draft_text}</div>
                        <div style={{display:"flex",gap:6,marginTop:8,justifyContent:"flex-end",flexWrap:"wrap"}}>
                          <button onClick={()=>setFieldMsgOpen(isMsgOpen?null:st.key)} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>💬 診察室へ</button>
                          <button onClick={()=>regenerateDraft(st.key)} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>🔄 再生成</button>
                          {!done&&<button onClick={()=>{setEditing(st.key);setEditVal(d.draft_text);}} style={{background:"#F9FAFB",color:"#6B7280",border:"1px solid #E5E7EB",borderRadius:8,padding:"5px 12px",fontSize:11,fontWeight:600,cursor:"pointer"}}>✏ 修正</button>}
                          {!done&&<button onClick={()=>approve(st.key)} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:8,padding:"5px 16px",fontSize:11,fontWeight:700,cursor:"pointer"}}>✓ 承認</button>}
                        </div>
                        {isMsgOpen&&(
                          <div style={{marginTop:8,display:"flex",gap:6}}>
                            <input value={fieldMsgInput[st.key]||""} onChange={e=>setFieldMsgInput(p=>({...p,[st.key]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&sendFieldMsg(st.key)}
                              placeholder={`${st.label}について連絡…`} style={{flex:1,background:"#F9FAFB",border:"1px solid #E5E7EB",borderRadius:8,padding:"7px 10px",fontSize:12,outline:"none"}} />
                            <button onClick={()=>sendFieldMsg(st.key)} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:8,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>送信</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Confirmed: Score + Billing */}
          {confirmed&&(
            <div style={{background:"#F0FDF4",borderRadius:14,padding:18,border:"1.5px solid #D1FAE5",textAlign:"center",flexShrink:0}}>
              <div style={{fontSize:18,fontWeight:800,color:"#16A34A",marginBottom:10}}>✅ カルテ確定済み</div>
              <div style={{background:"#FFF",borderRadius:10,padding:14,marginBottom:12,border:"1px solid #E5E7EB"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#3B82F6"}}>📋 算定プレビュー（確認して確定してください）</div>
                  <button onClick={async()=>{
                    setBillingData(null); setBillingSaved(false);
                  }} style={{background:"#EFF6FF",color:"#2563EB",border:"1px solid #BFDBFE",borderRadius:6,padding:"3px 10px",fontSize:10,fontWeight:600,cursor:"pointer"}}>🔄 再分析</button>
                </div>
                {billingLoading ? (
                  <div style={{padding:12,color:"#6B7280",fontSize:13}}>⏳ 算定中...</div>
                ) : billingData ? (()=>{
                  const items = billingData.items;
                  const basicPts = items.filter(i=>i.category==="basic"||i.code.startsWith("A0")).reduce((s,i)=>s+i.points*i.count,0);
                  const rxPts = items.filter(i=>i.category==="prescription"||i.code.startsWith("F-")).reduce((s,i)=>s+i.points*i.count,0);
                  const procPts = billingData.total - basicPts - rxPts;
                  return (
                    <div>
                      <div style={{display:"flex",justifyContent:"center",gap:16,flexWrap:"wrap"}}>
                        <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#6B7280"}}>初再診料</div><div style={{fontSize:18,fontWeight:800}}>{basicPts}</div></div>
                        <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#6B7280"}}>処置</div><div style={{fontSize:18,fontWeight:800}}>{procPts}</div></div>
                        <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#6B7280"}}>処方</div><div style={{fontSize:18,fontWeight:800}}>{rxPts}</div></div>
                        <div style={{textAlign:"center",borderLeft:"2px solid #E5E7EB",paddingLeft:16}}><div style={{fontSize:10,color:"#6B7280"}}>合計</div><div style={{fontSize:24,fontWeight:900,color:"#2563EB"}}>{billingData.total.toLocaleString()}<span style={{fontSize:12}}>点</span></div></div>
                        <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#6B7280"}}>3割負担</div><div style={{fontSize:24,fontWeight:900}}>¥{billingData.burden.toLocaleString()}</div></div>
                      </div>
                      <div style={{marginTop:10,maxHeight:200,overflowY:"auto",textAlign:"left"}}>
                        {items.map((it,i)=>(
                          <div key={i} style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:"#374151",padding:"3px 8px",borderBottom:"1px solid #F3F4F6"}}>
                            <span style={{flex:1}}>{it.name}</span>
                            <span style={{fontSize:10,color:"#9CA3AF"}}>{it.points}×</span>
                            <input type="number" value={it.count} min={1} max={99}
                              style={{width:36,textAlign:"center",border:"1px solid #D1D5DB",borderRadius:4,fontSize:11,padding:"1px 2px"}}
                              onChange={e=>{
                                const newItems = [...items];
                                newItems[i] = {...newItems[i], count: Math.max(1, parseInt(e.target.value)||1)};
                                const newTotal = newItems.reduce((s,x)=>s+x.points*x.count,0);
                                setBillingData({...billingData!, items:newItems, total:newTotal, burden:Math.round(newTotal*10*0.3)});
                              }}
                            />
                            <span style={{fontWeight:600,minWidth:48,textAlign:"right"}}>{(it.points*it.count).toLocaleString()}点</span>
                            <button onClick={()=>{
                              const newItems = items.filter((_,j)=>j!==i);
                              const newTotal = newItems.reduce((s,x)=>s+x.points*x.count,0);
                              setBillingData({...billingData!, items:newItems, total:newTotal, burden:Math.round(newTotal*10*0.3)});
                            }} style={{background:"none",border:"none",color:"#EF4444",cursor:"pointer",fontSize:14,padding:0,lineHeight:1}} title="削除">×</button>
                          </div>
                        ))}
                      </div>
                      {/* 項目追加 */}
                      <div style={{marginTop:6,padding:"0 8px"}}>
                        {!showAddItem ? (
                          <button onClick={()=>setShowAddItem(true)} style={{background:"none",border:"1px dashed #D1D5DB",borderRadius:6,padding:"4px 12px",fontSize:11,color:"#6B7280",cursor:"pointer",width:"100%"}}>＋ 項目を追加</button>
                        ) : (
                          <div style={{border:"1px solid #D1D5DB",borderRadius:6,padding:6}}>
                            <div style={{display:"flex",gap:4}}>
                              <input placeholder="項目名 or コードで検索..." value={addItemSearch}
                                onChange={e=>{setAddItemSearch(e.target.value);searchFee(e.target.value);}}
                                style={{flex:1,border:"1px solid #E5E7EB",borderRadius:4,padding:"3px 8px",fontSize:11}} />
                              <button onClick={()=>{setShowAddItem(false);setAddItemSearch("");setAddItemResults([]);}} style={{background:"none",border:"none",color:"#9CA3AF",cursor:"pointer",fontSize:13}}>✕</button>
                            </div>
                            {addItemResults.length>0&&(
                              <div style={{maxHeight:120,overflowY:"auto",marginTop:4}}>
                                {addItemResults.map((r,i)=>(
                                  <div key={i} onClick={()=>{
                                    const newItem = {code:r.code,name:r.name,points:r.points,count:1,category:r.category};
                                    const newItems = [...(billingData?.items||[]),newItem];
                                    const newTotal = newItems.reduce((s,x)=>s+x.points*x.count,0);
                                    setBillingData({items:newItems,total:newTotal,burden:Math.round(newTotal*10*0.3)});
                                    setShowAddItem(false);setAddItemSearch("");setAddItemResults([]);
                                  }} style={{display:"flex",justifyContent:"space-between",padding:"3px 6px",fontSize:10,cursor:"pointer",borderBottom:"1px solid #F3F4F6",borderRadius:2}}
                                    onMouseOver={e=>(e.currentTarget.style.background="#EFF6FF")} onMouseOut={e=>(e.currentTarget.style.background="transparent")}>
                                    <span>{r.name} <span style={{color:"#9CA3AF"}}>({r.code})</span></span>
                                    <span style={{fontWeight:600}}>{r.points}点</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })() : (
                  <div style={{padding:12,color:"#EF4444",fontSize:13}}>⚠️ 算定データを取得できませんでした</div>
                )}
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                <button onClick={()=>setActionModal("plan")} style={{background:"#F5F3FF",color:"#7C3AED",border:"1.5px solid #DDD6FE",borderRadius:10,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>📋 治療計画書</button>
                <button onClick={()=>setActionModal("nextAppt")} style={{background:"#EFF6FF",color:"#2563EB",border:"1.5px solid #BFDBFE",borderRadius:10,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>📅 次回予約</button>
                <button onClick={()=>setActionModal("receipt")} style={{background:"#FFF7ED",color:"#C2410C",border:"1.5px solid #FDBA74",borderRadius:10,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>📄 領収書発行</button>
                <button onClick={async()=>{
                  if(!previewRecordId||!billingData) return;
                  try {
                    const res = await fetch("/api/auto-billing",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({record_id:previewRecordId,use_preview:true,preview_items:billingData.items})});
                    const d = await res.json();
                    if(d.success) setBillingSaved(true);
                  } catch(e){console.error("billing save error",e);}
                  await supabase.from("appointments").update({status:"completed"}).eq("id",selApt);
                  window.location.href="/billing";
                }} style={{background:"linear-gradient(135deg,#22C55E,#16A34A)",color:"#FFF",border:"none",borderRadius:10,padding:"10px 24px",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:"0 2px 12px rgba(34,197,94,0.2)"}}>💰 {billingSaved ? "会計へ →" : "算定確定 → 会計へ"}</button>
              </div>
            </div>
          )}

          {/* Action Modals */}
          {actionModal&&(
            <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999}} onClick={()=>setActionModal(null)}>
              <div style={{background:"#FFF",borderRadius:actionModal==="receipt"?0:16,padding:actionModal==="receipt"?0:24,maxWidth:actionModal==="receipt"?720:480,width:actionModal==="receipt"?"100%":"90%",maxHeight:"90vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>
                {actionModal==="plan"&&(
                  <div>
                    <div style={{fontSize:18,fontWeight:800,marginBottom:12}}>📋 治療計画書</div>
                    <div style={{background:"#F9FAFB",borderRadius:10,padding:16,fontSize:13,lineHeight:1.8}}>
                      <div style={{fontWeight:700,marginBottom:8}}>患者: {u?.patient_name} ({u?.patient_age}歳)</div>
                      {STEPS.map(st=>{const d=getDraft(st.key);return d?<div key={st.key} style={{marginBottom:8}}><span style={{fontWeight:700,color:st.color}}>{st.label}:</span> {d.draft_text}</div>:null;})}
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
                      <button onClick={()=>{window.print();}} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>🖨 印刷</button>
                      <button onClick={()=>setActionModal(null)} style={{background:"#F3F4F6",color:"#6B7280",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>閉じる</button>
                    </div>
                  </div>
                )}
                {actionModal==="nextAppt"&&(
                  <div>
                    <div style={{fontSize:18,fontWeight:800,marginBottom:12}}>📅 次回予約</div>
                    <div style={{display:"flex",flexDirection:"column",gap:10}}>
                      <div><label style={{fontSize:12,fontWeight:600,color:"#6B7280"}}>日付</label><input type="date" style={{display:"block",width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #E5E7EB",fontSize:14,marginTop:4}} /></div>
                      <div><label style={{fontSize:12,fontWeight:600,color:"#6B7280"}}>時間</label><input type="time" style={{display:"block",width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #E5E7EB",fontSize:14,marginTop:4}} /></div>
                      <div><label style={{fontSize:12,fontWeight:600,color:"#6B7280"}}>内容</label><input defaultValue={getDraft("dr")?.draft_text?.match(/次回[:：]\s*(.+)/)?.[1]||""} placeholder="根充、補綴..." style={{display:"block",width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #E5E7EB",fontSize:14,marginTop:4}} /></div>
                    </div>
                    <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
                      <button onClick={()=>{alert("予約を登録しました");setActionModal(null);}} style={{background:"#2563EB",color:"#FFF",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>予約登録</button>
                      <button onClick={()=>setActionModal(null)} style={{background:"#F3F4F6",color:"#6B7280",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>閉じる</button>
                    </div>
                  </div>
                )}
                {actionModal==="receipt"&&(()=>{
                  const today = new Date().toLocaleDateString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit"}).replace(/\//g,"年").replace(/年/,"年").replace(/$/,"").replace(/(\d{2})$/,"$1");
                  const todayFmt = new Date().toLocaleDateString("ja-JP",{year:"numeric",month:"2-digit",day:"2-digit"});
                  const items = billingData?.items||[];
                  // カテゴリ分類
                  const catPts = (codes:string[],cats:string[])=>items.filter(i=>codes.some(c=>i.code.startsWith(c))||cats.some(c=>i.category===c)).reduce((s,i)=>s+i.points*i.count,0);
                  const shoshin = catPts(["A0","A00"],["初・再診料"]);
                  const igaku = catPts(["B-"],["医学管理"]);
                  const kensaFinal = items.filter(i=>i.code.startsWith("D")&&!i.code.startsWith("DRUG")).reduce((s,i)=>s+i.points*i.count,0);
                  const gazo = items.filter(i=>i.code.startsWith("E")).reduce((s,i)=>s+i.points*i.count,0);
                  const touyaku = items.filter(i=>i.code.startsWith("F-")||i.code.startsWith("DRUG")||i.code.startsWith("MED")||i.category==="投薬"||i.category==="prescription").reduce((s,i)=>s+i.points*i.count,0);
                  const masui = items.filter(i=>i.code.startsWith("K")||i.category==="anesthesia").reduce((s,i)=>s+i.points*i.count,0);
                  const shujutsu = items.filter(i=>i.code.startsWith("J")||i.category==="surgery").reduce((s,i)=>s+i.points*i.count,0);
                  const shochi = items.filter(i=>["endo","restoration","処置"].includes(i.category)||i.code.startsWith("I")||i.code.startsWith("M")).reduce((s,i)=>s+i.points*i.count,0);
                  const total = billingData?.total||0;
                  const burden = billingData?.burden||0;
                  const bdr = {border:"1.5px solid #111",padding:"4px 8px",fontSize:12,textAlign:"center" as const};
                  const bdrR = {...bdr,textAlign:"right" as const};
                  const bdrL = {...bdr,textAlign:"left" as const,fontSize:11};
                  const lbl = {fontSize:9,color:"#555",textAlign:"center" as const,padding:"2px 4px",borderBottom:"1px solid #111",borderLeft:"1.5px solid #111",borderRight:"1.5px solid #111"};
                  const val = {fontSize:18,fontWeight:800 as const,textAlign:"right" as const,padding:"4px 8px 4px 4px",borderBottom:"1.5px solid #111",borderLeft:"1.5px solid #111",borderRight:"1.5px solid #111",minWidth:60};
                  return(
                  <div style={{padding:32,fontFamily:"'Yu Gothic','Hiragino Sans',sans-serif",maxWidth:680,margin:"0 auto",background:"#FFF"}}>
                    <style>{`@media print{body>*{display:none!important}[data-receipt]{display:block!important;position:fixed;inset:0;background:#FFF;z-index:99999}}`}</style>
                    <div data-receipt="">
                    <div style={{textAlign:"center",fontSize:22,fontWeight:800,letterSpacing:8,marginBottom:16}}>領 収 書</div>

                    {/* 患者情報 */}
                    <table style={{width:"100%",borderCollapse:"collapse",marginBottom:10}}>
                      <tbody>
                        <tr>
                          <td style={{...bdr,width:"15%",fontSize:10,background:"#F5F5F5"}}>患者ID</td>
                          <td style={{...bdr,width:"35%"}}>&nbsp;</td>
                          <td style={{...bdr,width:"15%",fontSize:10,background:"#F5F5F5"}}>領収書番号</td>
                          <td style={{...bdr,width:"15%",fontSize:10,background:"#F5F5F5"}}>発行日</td>
                        </tr>
                        <tr>
                          <td style={{...bdr,fontSize:10,background:"#F5F5F5"}}>氏名</td>
                          <td style={{...bdr,fontSize:16,fontWeight:700}}>{u?.patient_name||"---"} 様</td>
                          <td style={{...bdr,fontSize:11}}>&nbsp;</td>
                          <td style={{...bdr,fontSize:11}}>{todayFmt}</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* 費用区分 */}
                    <table style={{width:"100%",borderCollapse:"collapse",marginBottom:10}}>
                      <tbody>
                        <tr>
                          <td style={{...bdr,width:"14%",fontSize:10,background:"#F5F5F5"}}>費用区分</td>
                          <td style={{...bdr,width:"14%",fontSize:10,background:"#F5F5F5"}}>負担率</td>
                          <td style={{...bdr,width:"14%",fontSize:10,background:"#F5F5F5"}}>本・家</td>
                          <td style={{...bdr,width:"14%",fontSize:10,background:"#F5F5F5"}}>区分</td>
                          <td style={{...bdr,fontSize:10,background:"#F5F5F5"}}>診療日（期間）</td>
                        </tr>
                        <tr>
                          <td style={{...bdr,fontWeight:700}}>社保</td>
                          <td style={{...bdr,fontWeight:700}}>3割</td>
                          <td style={{...bdr,fontWeight:700}}>本人</td>
                          <td style={{...bdr}}></td>
                          <td style={{...bdr,fontWeight:700}}>{todayFmt}</td>
                        </tr>
                      </tbody>
                    </table>

                    {/* 保険点数内訳 */}
                    <div style={{fontSize:11,fontWeight:700,marginBottom:2}}>保険・介護</div>
                    <table style={{width:"100%",borderCollapse:"collapse",marginBottom:2}}>
                      <tbody>
                        <tr>
                          {["初・再診料","医学管理等","在宅医療","検査","画像診断","投薬","注射","リハビリテーション"].map(h=>(
                            <td key={h} style={lbl}>{h}</td>
                          ))}
                        </tr>
                        <tr>
                          {[shoshin,igaku,0,kensaFinal,gazo,touyaku,0,0].map((v,i)=>(
                            <td key={i} style={val}>{v>0?<><span style={{fontSize:18}}>{v}</span><span style={{fontSize:9,marginLeft:2}}>点</span></>:<span style={{color:"#CCC",fontSize:12}}></span>}</td>
                          ))}
                        </tr>
                        <tr>
                          {["処置","手術","麻酔","歯冠修復・欠損補綴","歯科矯正","病理診断","その他","介護"].map(h=>(
                            <td key={h} style={lbl}>{h}</td>
                          ))}
                        </tr>
                        <tr>
                          {[shochi,shujutsu,masui,0,0,0,0,0].map((v,i)=>(
                            <td key={i} style={val}>{v>0?<><span style={{fontSize:18}}>{v}</span><span style={{fontSize:9,marginLeft:2}}>点</span></>:<span style={{color:"#CCC",fontSize:12}}></span>}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>

                    {/* 合計・負担額 */}
                    <div style={{display:"flex",gap:12,marginTop:12}}>
                      <div style={{flex:1}}>
                        <div style={{fontSize:11,fontWeight:700,marginBottom:2}}>保険外負担</div>
                        <table style={{width:"100%",borderCollapse:"collapse"}}>
                          <tbody>
                            <tr><td style={lbl}>自費療養</td><td style={lbl}>その他</td></tr>
                            <tr><td style={{...val,fontSize:14}}>0<span style={{fontSize:9,marginLeft:2}}>円</span></td><td style={{...val,fontSize:14}}>0<span style={{fontSize:9,marginLeft:2}}>円</span></td></tr>
                          </tbody>
                        </table>
                      </div>
                      <div style={{flex:1}}>
                        <table style={{width:"100%",borderCollapse:"collapse"}}>
                          <tbody>
                            <tr><td style={{...bdr,fontSize:10,background:"#F5F5F5"}}></td><td style={{...bdr,fontSize:10,background:"#F5F5F5"}}>保険</td><td style={{...bdr,fontSize:10,background:"#F5F5F5"}}>介護</td><td style={{...bdr,fontSize:10,background:"#F5F5F5"}}>保険外負担</td></tr>
                            <tr><td style={{...bdr,fontSize:10,background:"#F5F5F5"}}>合計</td><td style={{...bdr,fontWeight:800,fontSize:16}}>{total}<span style={{fontSize:9}}>点</span></td><td style={{...bdr,fontSize:12}}>0<span style={{fontSize:9}}>単位</span></td><td style={{...bdr,fontSize:12}}></td></tr>
                            <tr><td style={{...bdr,fontSize:10,background:"#F5F5F5"}}>負担額</td><td style={{...bdr,fontWeight:800,fontSize:16}}>{burden.toLocaleString()}<span style={{fontSize:9}}>円</span></td><td style={{...bdr,fontSize:12}}>0<span style={{fontSize:9}}>円</span></td><td style={{...bdr,fontSize:12}}>0<span style={{fontSize:9}}>円</span></td></tr>
                          </tbody>
                        </table>
                        <table style={{width:"100%",borderCollapse:"collapse",marginTop:4}}>
                          <tbody>
                            <tr><td style={{...bdr,fontSize:11,background:"#111",color:"#FFF",fontWeight:700}}>領収金額</td><td style={{...bdr,fontSize:22,fontWeight:900}}>{burden.toLocaleString()}<span style={{fontSize:11,marginLeft:4}}>円</span></td></tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* フッター */}
                    <div style={{display:"flex",justifyContent:"space-between",marginTop:20,fontSize:10,color:"#666"}}>
                      <div>
                        <div>※厚生労働省が定める診療報酬や薬価等には、医療機関が</div>
                        <div>仕入れ時に負担する消費税が反映されています。</div>
                        <div style={{marginTop:4}}>この領収書の再発行はできませんので大切に保管してください。</div>
                        <div>印紙税法第5条の規定により収入印紙不要</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:12,fontWeight:700}}>Forever Dental Clinic</div>
                        <div>疋田　久登</div>
                        <div>愛知県安城市篠目町竜田108-1</div>
                        <div>TEL:0566-95-5000</div>
                        <div style={{border:"1.5px solid #111",width:60,height:60,display:"inline-flex",alignItems:"center",justifyContent:"center",marginTop:4,fontSize:9,color:"#999"}}>領収印</div>
                      </div>
                    </div>
                    </div>

                    {/* 印刷・閉じるボタン */}
                    <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}} className="no-print">
                      <button onClick={()=>{window.print();}} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>🖨 印刷</button>
                      <button onClick={()=>setActionModal(null)} style={{background:"#F3F4F6",color:"#6B7280",border:"none",borderRadius:8,padding:"8px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>閉じる</button>
                    </div>
                  </div>
                  );
                })()}
                {actionModal==="accounting"&&(
                  <div style={{textAlign:"center"}}>
                    <div style={{fontSize:48,marginBottom:10}}>✅</div>
                    <div style={{fontSize:20,fontWeight:800,color:"#16A34A",marginBottom:8}}>会計処理完了</div>
                    <div style={{fontSize:14,color:"#6B7280",marginBottom:4}}>患者: {u?.patient_name} 様</div>
                    <div style={{fontSize:24,fontWeight:900,marginBottom:12}}>¥{billingData?billingData.burden.toLocaleString():"---"}</div>
                    <div style={{fontSize:13,color:"#9CA3AF",marginBottom:16}}>ステータスを「完了」に更新しました</div>
                    <button onClick={()=>{setActionModal(null);loadUnits();loadData();}} style={{background:"#111827",color:"#FFF",border:"none",borderRadius:10,padding:"10px 24px",fontSize:14,fontWeight:700,cursor:"pointer"}}>閉じる</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {apCnt>=5&&!confirmed&&(
            <div style={{background:"#FFFBEB",borderRadius:12,padding:14,border:"1px solid #FDE68A",textAlign:"center",flexShrink:0}}>
              <span style={{fontSize:14,fontWeight:600,color:"#92400E"}}>全項目承認済み — 診察室の確定待ち</span>
            </div>
          )}

          <div style={{height:20,flexShrink:0}} />
        </div>
      </div>
    </div>
  );
}
