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

  useEffect(()=>{loadUnits();},[loadUnits]);

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
    return ()=>{supabase.removeChannel(ch);};
  },[selApt,loadData]);

  useEffect(()=>{if(scrollRef.current) scrollRef.current.scrollTop=scrollRef.current.scrollHeight;},[chunks]);

  const getDraft=(key:string)=>drafts.find(d=>d.field_key===key);
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
              <div key={uu.appointment_id} onClick={()=>setSelApt(uu.appointment_id)}
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
              {chunks.length>0&&<div style={{fontSize:11,fontWeight:600,color:"#3B82F6",marginTop:4}}>● 文字起こし受信中 ({chunks.length}件)</div>}
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
                <div style={{fontSize:12,fontWeight:600,color:"#9CA3AF",marginBottom:6}}>保険点数（自動算定）</div>
                <div style={{display:"flex",justifyContent:"center",gap:16,flexWrap:"wrap"}}>
                  <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#6B7280"}}>初再診料</div><div style={{fontSize:18,fontWeight:800}}>53</div></div>
                  <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#6B7280"}}>処置</div><div style={{fontSize:18,fontWeight:800}}>670</div></div>
                  <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#6B7280"}}>処方</div><div style={{fontSize:18,fontWeight:800}}>42</div></div>
                  <div style={{textAlign:"center",borderLeft:"2px solid #E5E7EB",paddingLeft:16}}><div style={{fontSize:10,color:"#6B7280"}}>合計</div><div style={{fontSize:24,fontWeight:900,color:"#2563EB"}}>765<span style={{fontSize:12}}>点</span></div></div>
                  <div style={{textAlign:"center"}}><div style={{fontSize:10,color:"#6B7280"}}>3割負担</div><div style={{fontSize:24,fontWeight:900}}>¥2,300</div></div>
                </div>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
                <button style={{background:"#F5F3FF",color:"#7C3AED",border:"1.5px solid #DDD6FE",borderRadius:10,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>📋 治療計画書</button>
                <button style={{background:"#EFF6FF",color:"#2563EB",border:"1.5px solid #BFDBFE",borderRadius:10,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>📅 次回予約</button>
                <button style={{background:"#FFF7ED",color:"#C2410C",border:"1.5px solid #FDBA74",borderRadius:10,padding:"10px 18px",fontSize:13,fontWeight:600,cursor:"pointer"}}>📄 領収書発行</button>
                <button style={{background:"linear-gradient(135deg,#22C55E,#16A34A)",color:"#FFF",border:"none",borderRadius:10,padding:"10px 24px",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:"0 2px 12px rgba(34,197,94,0.2)"}}>💰 会計へ →</button>
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
