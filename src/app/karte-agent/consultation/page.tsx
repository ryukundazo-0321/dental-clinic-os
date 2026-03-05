"use client";
import { useState, useEffect, useRef, useCallback, Suspense } from "react";
import { supabase } from "@/lib/supabase";
import { useSearchParams } from "next/navigation";

// 歯式記号
const S = (n: string) => {
  const q = Math.floor(parseInt(n) / 10), p = parseInt(n) % 10;
  return ({ 1: "\u2510", 2: "\u250C", 3: "\u2514", 4: "\u2518" } as Record<number,string>)[q] + p;
};
const TU = ["18","17","16","15","14","13","12","11","21","22","23","24","25","26","27","28"];
const TL = ["48","47","46","45","44","43","42","41","31","32","33","34","35","36","37","38"];
const STATUSES = ["健全","C1","C2","C3","C4","CR","In","Cr","欠損","Br","残根","治療中","FMC","TEK"];

type Patient = { id:string; name:string; age:number; insurance:string; burden:number };
type Diag = { tooth:string; code:string; name:string; short:string };
type Proc = { tooth:string; diagnosis_short:string; procedure_name:string; fee_items:{code:string;name:string;points:number;count:number}[]; points:number };
type Banner = { text:string; icon:string; choices:{label:string;primary?:boolean;fn:()=>void}[] };
type Pred = { code:string; name:string; short:string; probability:number };

const CL = {bg:"#F5F6F8",sf:"#FFF",pri:"#1A56DB",priL:"#E8EFFC",acc:"#059669",accL:"#ECFDF5",wrn:"#D97706",wrnL:"#FFFBEB",txt:"#111827",sub:"#6B7280",bdr:"#E5E7EB",dk:"#1E293B",red:"#DC2626",redL:"#FEF2F2",ai:"#7C3AED",aiL:"#F5F3FF"};

function Content() {
  const sp = useSearchParams();
  const aptId = sp.get("appointment_id") || "";
  const [patient, setPatient] = useState<Patient|null>(null);
  const [isNew, setIsNew] = useState(true);
  const [prevChart, setPrevChart] = useState<Record<string,string>>({});
  const [chart, setChart] = useState<Record<string,string>>({});
  const [diags, setDiags] = useState<Diag[]>([]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [preds, setPreds] = useState<Pred[]>([]);
  const [sS, setSS] = useState(""); const [sO, setSO] = useState(""); const [sA, setSA] = useState(""); const [sP, setSP] = useState("");
  const [popup, setPopup] = useState<string|null>(null);
  const [sel, setSel] = useState<string|null>(null);
  const [banner, setBanner] = useState<Banner|null>(null);
  const [dSearch, setDSearch] = useState("");
  const [dMaster, setDMaster] = useState<{code:string;name:string;category:string}[]>([]);
  const [rec, setRec] = useState(false);
  const [recT, setRecT] = useState(0);
  const [stat, setStat] = useState("");
  const [total, setTotal] = useState(0);
  const [past, setPast] = useState<{date:string;entries:string[]}[]>([]);
  const [pastO, setPastO] = useState(false);
  const [pp, setPP] = useState<1|4|6>(6);
  const [rid, setRid] = useState<string|null>(null);
  const mr = useRef<MediaRecorder|null>(null);
  const ac = useRef<Blob[]>([]);
  const tr = useRef<ReturnType<typeof setInterval>|null>(null);

  // Load data
  useEffect(() => {
    if (!aptId) return;
    (async () => {
      const {data:apt} = await supabase.from("appointments").select("patient_id,patient_type,patients(id,name_kanji,date_of_birth,insurance_type,burden_ratio,current_tooth_chart,current_perio_chart)").eq("id",aptId).single();
      if (!apt?.patients) return;
      const p = apt.patients as unknown as {id:string;name_kanji:string;date_of_birth:string;insurance_type:string;burden_ratio:number;current_tooth_chart:Record<string,string>|null};
      const age = p.date_of_birth ? Math.floor((Date.now()-new Date(p.date_of_birth).getTime())/31557600000) : 0;
      setPatient({id:p.id,name:p.name_kanji,age,insurance:p.insurance_type||"社保",burden:p.burden_ratio||0.3});
      setIsNew(apt.patient_type==="new");
      if (apt.patient_type!=="new" && p.current_tooth_chart) {
        const tc:Record<string,string>={};
        Object.entries(p.current_tooth_chart).forEach(([k,v])=>{
          if(typeof v==="string") tc[k]=v;
          else if(typeof v==="object"&&v&&"status" in (v as Record<string,string>)) tc[k]=(v as Record<string,string>).status;
        });
        setPrevChart(tc); setChart({...tc});
      }
      const {data:r} = await supabase.from("medical_records").select("id,soap_s,soap_o,soap_a,soap_p,tooth_chart,predicted_diagnoses,structured_procedures,previous_tooth_chart").eq("appointment_id",aptId).limit(1).single();
      if (r) {
        setRid(r.id);
        if(r.soap_s) setSS(r.soap_s); if(r.soap_o) setSO(r.soap_o); if(r.soap_a) setSA(r.soap_a); if(r.soap_p) setSP(r.soap_p);
        if(r.tooth_chart&&Object.keys(r.tooth_chart as object).length>0) setChart(r.tooth_chart as Record<string,string>);
        if(r.previous_tooth_chart) setPrevChart(r.previous_tooth_chart as Record<string,string>);
        if(r.predicted_diagnoses&&(r.predicted_diagnoses as Pred[]).length>0) {
          const pr=r.predicted_diagnoses as Pred[];
          setPreds(pr);
          setBanner({text:`問診票から: ${pr.map(x=>x.name).join(", ")} の可能性`,icon:"💡",choices:[{label:"確認する",primary:true,fn:()=>{setPopup("diagSelect");setBanner(null);}},{label:"閉じる",fn:()=>setBanner(null)}]});
        }
        if(r.structured_procedures&&(r.structured_procedures as Proc[]).length>0) setProcs(r.structured_procedures as Proc[]);
      }
      const {data:ed} = await supabase.from("patient_diagnoses").select("diagnosis_code,diagnosis_name,tooth_number").eq("patient_id",p.id).is("outcome",null);
      if(ed) setDiags(ed.map(d=>({tooth:d.tooth_number||"",code:d.diagnosis_code,name:d.diagnosis_name,short:d.diagnosis_name})));
      if(apt.patient_type!=="new") {
        const {data:pa} = await supabase.from("appointments").select("scheduled_at,medical_records(soap_a,soap_p)").eq("patient_id",p.id).eq("status","completed").order("scheduled_at",{ascending:false}).limit(5);
        if(pa) setPast(pa.map((a:{scheduled_at:string;medical_records:{soap_a:string;soap_p:string}[]|null})=>{const d=new Date(a.scheduled_at);const m=(a.medical_records as {soap_a:string;soap_p:string}[]|null)?.[0];return{date:`${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`,entries:[m?.soap_a,m?.soap_p].filter(Boolean) as string[]};}).filter(x=>x.entries.length>0));
      }
      const {data:dm} = await supabase.from("diagnosis_master").select("code,name,category").in("category",["う蝕","歯髄・根尖","歯周","外傷","硬組織疾患","補綴"]).order("category");
      if(dm) setDMaster(dm);
    })();
  },[aptId]);

  useEffect(()=>{if(rec){tr.current=setInterval(()=>setRecT(t=>t+1),1000);}else if(tr.current){clearInterval(tr.current);}return()=>{if(tr.current)clearInterval(tr.current);};},[rec]);
  useEffect(()=>{const b=isNew?267:56;setTotal(b+procs.reduce((s,p)=>s+p.points,0));},[procs,isNew]);

  const save = useCallback(async()=>{if(!rid)return;await supabase.from("medical_records").update({tooth_chart:chart,structured_procedures:procs,soap_s:sS,soap_o:sO,soap_a:sA,soap_p:sP}).eq("id",rid);},[rid,chart,procs,sS,sO,sA,sP]);
  const stRef = useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{if(stRef.current)clearTimeout(stRef.current);stRef.current=setTimeout(save,5000);return()=>{if(stRef.current)clearTimeout(stRef.current);};},[save]);

  const setTooth = (t:string,st:string)=>{setChart(p=>({...p,[t]:st}));setStat(`${S(t)} → ${st}`);};

  const confirmDiag = async(code:string,name:string,short:string,tooth:string)=>{
    setDiags(p=>[...p,{tooth,code,name,short}]);
    if(patient) await supabase.from("patient_diagnoses").insert({patient_id:patient.id,diagnosis_code:code,diagnosis_name:name,tooth_number:tooth,start_date:new Date().toISOString().split("T")[0],outcome:null});
    setSA(p=>p?p+"\n"+`${S(tooth)} ${name}`:`${S(tooth)} ${name}`);
    try {
      const res=await fetch("/api/suggest-treatment",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({diagnosis_code:code,diagnosis_short:short,tooth})});
      if(res.ok){const d=await res.json();if(d.treatments?.length>0){
        const pri=["restoration","endo","perio","prosth"];
        const sorted=d.treatments.sort((a:{category:string},b:{category:string})=>{const ai=pri.indexOf(a.category);const bi=pri.indexOf(b.category);return(ai===-1?99:ai)-(bi===-1?99:bi);});
        const top=sorted.slice(0,5);
        setBanner({text:`${S(tooth)} ${short} の治療パターン`,icon:"💡",choices:top.map((t:{procedure_name:string;fee_items:{code:string;name:string;points:number;count:number}[];total_points:number})=>({label:`${t.procedure_name} (${t.total_points}点)`,fn:()=>{setProcs(p=>[...p,{tooth,diagnosis_short:short,procedure_name:t.procedure_name,fee_items:t.fee_items,points:t.total_points}]);setSP(p=>p?p+"\n"+`${S(tooth)} ${t.procedure_name}`:`本日: ${S(tooth)} ${t.procedure_name}`);setBanner(null);setStat(`✅ ${S(tooth)} ${t.procedure_name}`);}}))}); }}
    } catch(e){console.error(e);}
  };

  const startRec = async()=>{try{const s=await navigator.mediaDevices.getUserMedia({audio:true});const m=new MediaRecorder(s,{mimeType:"audio/webm;codecs=opus"});mr.current=m;ac.current=[];m.ondataavailable=e=>{if(e.data.size>0)ac.current.push(e.data);};m.start(1000);setRec(true);setRecT(0);setStat("🎙 録音中...");}catch{setStat("❌ マイク不可");}};
  const stopRec = async()=>{if(!mr.current||mr.current.state==="inactive"){setRec(false);return;}const b=await Promise.race([new Promise<Blob>(r=>{mr.current!.onstop=()=>r(new Blob(ac.current,{type:"audio/webm"}));mr.current!.stop();mr.current!.stream.getTracks().forEach(t=>t.stop());}),new Promise<Blob>((_,j)=>setTimeout(()=>j(new Error("to")),5000))]).catch(()=>null);setRec(false);if(!b){setStat("❌ 録音エラー");return;}if(recT<3){setStat("⚠️ 短すぎます");return;}setStat("📝 文字起こし中...");
    try{const tk=await fetch("/api/whisper-token");const td=await tk.json();if(!td.key){setStat("❌ APIキー失敗");return;}const fd=new FormData();fd.append("file",b,"rec.webm");fd.append("model","gpt-4o-transcribe");fd.append("language","ja");const wr=await fetch("https://api.openai.com/v1/audio/transcriptions",{method:"POST",headers:{Authorization:`Bearer ${td.key}`},body:fd});if(!wr.ok){setStat(`❌ 認識エラー(${wr.status})`);return;}const rt=await wr.json();const tx=rt.text||"";if(!tx||tx.trim().length<5){setStat("⚠️ 認識失敗");return;}setStat("🤖 AI分析中...");
      const cr=await fetch("/api/karte-agent/classify-and-draft",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({appointment_id:aptId,transcript:tx,perio_points:pp})});
      if(cr.ok){const r=await cr.json();if(r.success){if(r.drafts?.s&&!sS)setSS(r.drafts.s);if(r.drafts?.dh)setSO(p=>p?p+"\n"+r.drafts.dh:r.drafts.dh);if(r.drafts?.dr){const am=r.drafts.dr.match(/【A】([\s\S]*?)(?=【P】|$)/);const pm=r.drafts.dr.match(/【P】([\s\S]*)/);if(am)setSA(p=>p?p+"\n"+am[1].trim():am[1].trim());if(pm)setSP(p=>p?p+"\n"+pm[1].trim():pm[1].trim());}setStat("✅ AI分析完了");}}
    }catch(e){console.error(e);setStat("❌ 失敗");}};

  const billing = async()=>{if(!rid||!aptId)return;await save();const ba=Math.round(total*10*(patient?.burden||0.3));await supabase.from("billing").insert({appointment_id:aptId,patient_id:patient?.id,total_points:total,patient_burden:ba,status:"confirmed"});await supabase.from("medical_records").update({status:"confirmed",doctor_confirmed:true,soap_s:sS,soap_o:sO,soap_a:sA,soap_p:sP,tooth_chart:chart,structured_procedures:procs}).eq("id",rid);if(patient)await supabase.from("patients").update({current_tooth_chart:chart}).eq("id",patient.id);await supabase.from("appointments").update({status:"completed"}).eq("id",aptId);setStat("✅ 算定確定！会計へ");};

  const fmt=(s:number)=>`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
  const tt=Object.keys(chart).filter(t=>chart[t]&&chart[t]!=="健全");

  const TR=({teeth}:{teeth:string[]})=>(<div style={{display:"flex",gap:1,justifyContent:"center"}}>{teeth.map(t=>{const st=chart[t];const hd=diags.some(d=>d.tooth===t);const ip=!isNew&&prevChart[t]&&st===prevChart[t];return(<div key={t} onClick={()=>{setSel(t);setPopup("tooth");}} style={{width:28,textAlign:"center",cursor:"pointer"}}><div style={{fontSize:8,fontWeight:700,height:14,color:hd?CL.wrn:ip?CL.sub:st?CL.acc:"transparent"}}>{st||"."}</div><div style={{height:26,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,background:hd?CL.wrnL:st?(ip?"#F3F4F6":CL.priL):"#F8F9FA",border:`1.5px solid ${hd?CL.wrn+"50":st?(ip?"#D1D5DB":CL.pri+"30"):"#EAECEF"}`,color:hd?CL.wrn:st?(ip?CL.sub:CL.pri):"#D1D5DB"}}>{parseInt(t)%10}</div></div>);})}</div>);

  if(!patient) return <div style={{padding:40,textAlign:"center",color:CL.sub}}>読み込み中...</div>;

  return(<div style={{minHeight:"100vh",background:CL.bg,fontFamily:"'Noto Sans JP',-apple-system,sans-serif"}}>
    <header style={{background:CL.dk,color:"#FFF",padding:"0 16px",height:48,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:15}}>🏥</span><span style={{fontWeight:800,fontSize:14}}>{patient.name}</span><span style={{fontSize:11,opacity:.6}}>{patient.age}歳</span><span style={{fontSize:10,background:"rgba(255,255,255,.12)",padding:"2px 8px",borderRadius:3,fontWeight:700}}>{patient.insurance} {Math.round(patient.burden*10)}割</span><span style={{fontSize:10,background:isNew?"#3B82F6":"#16A34A",padding:"2px 8px",borderRadius:3,fontWeight:700}}>{isNew?"初診":"再診"}</span></div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>{stat&&<span style={{fontSize:11,opacity:.8}}>{stat}</span>}<span style={{fontSize:16,fontWeight:900,color:"#10B981"}}>{total}点</span><span style={{fontSize:11,opacity:.5}}>(¥{Math.round(total*10*patient.burden).toLocaleString()})</span></div>
    </header>

    {banner&&(<div style={{background:"linear-gradient(135deg,#1E3A5F,#2563EB)",color:"#FFF",padding:"8px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:6}}><div style={{display:"flex",alignItems:"center",gap:8}}><span>{banner.icon}</span><span style={{fontSize:13,fontWeight:700}}>{banner.text}</span></div><div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{banner.choices.map((c,i)=>(<button key={i} onClick={c.fn} style={{padding:"4px 12px",borderRadius:5,fontSize:11,fontWeight:700,border:"none",cursor:"pointer",background:c.primary?"#FFF":"rgba(255,255,255,.15)",color:c.primary?"#1E3A5F":"#FFF"}}>{c.label}</button>))}<button onClick={()=>setBanner(null)} style={{padding:"3px 8px",borderRadius:3,border:"none",cursor:"pointer",background:"rgba(255,255,255,.1)",color:"#FFF",fontSize:11}}>✕</button></div></div>)}

    <div style={{display:"flex",height:`calc(100vh - 48px${banner?" - 38px":""})`}}>
      <div style={{flex:1,overflow:"auto",padding:14}}>
        {!isNew&&past.length>0&&(<div style={{marginBottom:10}}><button onClick={()=>setPastO(!pastO)} style={{background:"none",border:"none",cursor:"pointer",fontSize:11,fontWeight:700,color:CL.sub}}>{pastO?"▼":"▶"} 過去カルテ ({past.length}件)</button>{pastO&&past.map((v,i)=>(<div key={i} style={{background:CL.sf,borderRadius:6,padding:"6px 10px",border:`1px solid ${CL.bdr}`,marginTop:4}}><span style={{fontSize:10,fontWeight:800,color:CL.sub}}>{v.date}</span>{v.entries.map((e,j)=><div key={j} style={{fontSize:11,marginTop:2}}>{e}</div>)}</div>))}</div>)}

        <div style={{background:CL.sf,borderRadius:10,border:`2px solid ${CL.pri}20`,overflow:"hidden"}}>
          <div style={{background:CL.priL,padding:"7px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}><span style={{fontSize:12,fontWeight:800,color:CL.pri}}>📋 本日のカルテ</span><span style={{fontSize:9,background:CL.pri,color:"#FFF",padding:"2px 7px",borderRadius:3,fontWeight:700}}>{isNew?"初診":"再診"}</span></div>
          <div style={{padding:12}}>
            {!isNew&&Object.keys(prevChart).length>0&&(<div style={{marginBottom:8}}><span style={{fontSize:10,color:CL.sub,fontWeight:700}}>前回の歯式</span><div style={{background:"#F9FAFB",borderRadius:6,padding:6,border:`1px solid ${CL.bdr}`,opacity:.6}}><div style={{display:"flex",gap:1,justifyContent:"center"}}>{TU.map(t=><div key={t} style={{width:28,textAlign:"center",fontSize:8,color:CL.sub}}>{prevChart[t]||""}</div>)}</div><div style={{display:"flex",justifyContent:"center",margin:"1px 0"}}><div style={{width:TU.length*29,height:1,background:CL.sub}}/></div><div style={{display:"flex",gap:1,justifyContent:"center"}}>{TL.map(t=><div key={t} style={{width:28,textAlign:"center",fontSize:8,color:CL.sub}}>{prevChart[t]||""}</div>)}</div></div></div>)}

            <div style={{marginBottom:14}}><div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:10,fontWeight:800}}>🦷 {isNew?"歯式":"今回の歯式"}</span></div><div style={{background:"#FAFBFC",borderRadius:6,padding:6,border:`1px solid ${CL.bdr}`}}><TR teeth={TU}/><div style={{display:"flex",justifyContent:"center",margin:"2px 0"}}><div style={{width:TU.length*29,height:2,background:CL.txt}}/></div><TR teeth={TL}/></div></div>

            {(diags.length>0||procs.length>0)&&(<div style={{marginBottom:14,border:`1px solid ${CL.bdr}`,borderRadius:6,overflow:"hidden"}}><div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#F0FDF4",borderBottom:`1px solid ${CL.bdr}`}}><span style={{fontSize:11,fontWeight:700,color:CL.acc}}>{isNew?"初診":"再診"} 外安全1 外感染2 医DX6</span><span style={{fontSize:11,fontWeight:800}}>{isNew?267:56}点</span></div>{diags.map((d,i)=>{const ps=procs.filter(p=>p.tooth===d.tooth);return(<div key={i} style={{borderBottom:`1px solid ${CL.bdr}`}}><div style={{padding:"6px 10px",background:CL.wrnL}}><span style={{fontFamily:"monospace",fontWeight:800,fontSize:13}}>{S(d.tooth)}</span><span style={{color:CL.wrn,fontWeight:700,fontSize:12,marginLeft:6}}>{d.name}</span></div>{ps.map((p,j)=>(<div key={j}>{p.fee_items.map((fi,k)=>(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"3px 10px 3px 24px",fontSize:11}}><span>{S(p.tooth)} {fi.name}</span><span style={{fontWeight:700}}>{fi.points*fi.count}点</span></div>))}</div>))}</div>);})}<div style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",background:"#F9FAFB"}}><span style={{fontWeight:800,color:CL.acc}}>計</span><span style={{fontWeight:900,fontSize:16,color:CL.acc}}>{total}点</span></div></div>)}

            <div style={{marginBottom:14}}><div style={{fontSize:10,fontWeight:800,marginBottom:4,color:CL.sub}}>📝 SOAP</div>{[{k:"S",v:sS},{k:"O",v:sO},{k:"A",v:sA},{k:"P",v:sP}].map(({k,v})=>(<div key={k} style={{marginBottom:3}}><span style={{fontSize:10,fontWeight:800,color:CL.pri}}>{k}: </span><span style={{fontSize:11,color:v?CL.txt:CL.sub,whiteSpace:"pre-wrap"}}>{v||"（未記載）"}</span></div>))}</div>

            <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
              {isNew&&<B i="📸" l="写真" bg={CL.priL} c={CL.pri} b={CL.pri+"30"} o={()=>setPopup("photo")}/>}
              <B i="🦷" l="歯式" bg={CL.priL} c={CL.pri} b={CL.pri+"30"} o={()=>setPopup("tooth")}/>
              <B i="🔍" l="P検" bg="#F0FDFA" c="#0D9488" b="#0D948830" o={()=>setPopup("perio")}/>
              <B i="🎙" l="録音" bg={CL.redL} c={CL.red} b={CL.red+"30"} o={()=>setPopup("record")}/>
              <B i="💊" l="傷病名" bg={CL.wrnL} c={CL.wrn} b={CL.wrn+"30"} o={()=>setPopup("diagSelect")}/>
              <B i="💰" l="算定" bg={CL.accL} c={CL.acc} b={CL.acc+"30"} o={()=>setPopup("billing")}/>
            </div>
          </div>
        </div>
      </div>

      {popup&&(<div style={{width:360,minWidth:360,background:CL.sf,borderLeft:`1px solid ${CL.bdr}`,display:"flex",flexDirection:"column",boxShadow:"-3px 0 16px rgba(0,0,0,.04)"}}>
        <div style={{padding:"8px 12px",borderBottom:`1px solid ${CL.bdr}`,display:"flex",alignItems:"center",justifyContent:"space-between",background:"#FAFBFC"}}><span style={{fontSize:12,fontWeight:800}}>{{tooth:"🦷 歯式",perio:"🔍 P検",record:"🎙 録音",photo:"📸 写真",billing:"💰 算定",diagSelect:"💊 傷病名"}[popup]||""}</span><button onClick={()=>{setPopup(null);if(rec)stopRec();}} style={{width:24,height:24,borderRadius:4,border:`1px solid ${CL.bdr}`,background:"#FFF",cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button></div>
        <div style={{flex:1,overflow:"auto",padding:12}}>
          {popup==="photo"&&<div><div style={{border:`2px dashed ${CL.bdr}`,borderRadius:10,padding:30,textAlign:"center",cursor:"pointer",background:"#FAFAFA"}}><div style={{fontSize:32}}>📸</div><div style={{fontSize:12,fontWeight:700,marginTop:4}}>タップしてアップロード</div><div style={{fontSize:10,color:CL.sub,marginTop:2}}>レントゲン / デンタル / 口腔内写真</div></div></div>}

          {popup==="tooth"&&<div>{[TU,TL].map((row,ri)=>(<div key={ri}><div style={{display:"flex",gap:2,flexWrap:"wrap"}}>{row.map(t=>(<button key={t} onClick={()=>setSel(t)} style={{width:36,height:32,borderRadius:4,fontSize:10,fontWeight:700,cursor:"pointer",border:sel===t?`2px solid ${CL.pri}`:`1px solid ${CL.bdr}`,background:chart[t]?CL.priL:"#FFF",color:chart[t]?CL.pri:CL.sub}}>{S(t)}</button>))}</div>{ri===0&&<div style={{height:2,background:CL.txt,margin:"3px 0"}}/>}</div>))}{sel&&<div style={{marginTop:10}}><div style={{fontSize:12,fontWeight:800,marginBottom:6}}>{S(sel)} #{sel}</div><div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{STATUSES.map(st=>(<button key={st} onClick={()=>setTooth(sel,st)} style={{padding:"4px 8px",borderRadius:4,fontSize:10,fontWeight:700,cursor:"pointer",border:chart[sel]===st?`2px solid ${CL.acc}`:`1px solid ${CL.bdr}`,background:chart[sel]===st?CL.accL:"#FFF"}}>{st}</button>))}</div></div>}</div>}

          {popup==="perio"&&<div><div style={{display:"flex",gap:4,marginBottom:8}}>{([6,4,1] as const).map(n=>(<button key={n} onClick={()=>setPP(n)} style={{padding:"4px 10px",borderRadius:4,fontSize:10,fontWeight:700,cursor:"pointer",border:`1px solid ${CL.pri}`,background:pp===n?CL.pri:"#FFF",color:pp===n?"#FFF":CL.pri}}>{n}点式</button>))}</div><div style={{background:"#F0F9FF",borderRadius:5,padding:6,marginBottom:8,fontSize:10,color:"#1E40AF"}}>📖 {pp===6?"6つ(MB,B,DB,ML,L,DL)":pp===4?"4つ":"1つ(最深部)"}の数値を読み上げ</div><button onClick={rec?stopRec:startRec} style={{width:"100%",padding:12,borderRadius:7,border:"none",cursor:"pointer",fontWeight:800,fontSize:12,background:rec?"#EF4444":CL.pri,color:"#FFF"}}>{rec?`⏹ 停止 ${fmt(recT)}`:"🎙 P検 音声入力"}</button></div>}

          {popup==="record"&&<div style={{textAlign:"center"}}><div style={{fontSize:10,color:CL.sub,marginBottom:12,textAlign:"left"}}>患者さんへの説明時に録音開始</div><button onClick={rec?stopRec:startRec} style={{width:80,height:80,borderRadius:"50%",border:"none",cursor:"pointer",background:rec?"linear-gradient(135deg,#EF4444,#DC2626)":"linear-gradient(135deg,#1A56DB,#3B82F6)",color:"#FFF",fontSize:24}}>{rec?"⏹":"🎙"}</button><div style={{marginTop:6,fontSize:12,fontWeight:800,color:rec?"#EF4444":CL.pri}}>{rec?`録音中 ${fmt(recT)}`:"タップ"}</div><div style={{marginTop:10,fontSize:10,color:CL.sub,textAlign:"left"}}>停止でAI分析 → S/O＋傷病名＋A/P</div></div>}

          {popup==="diagSelect"&&<div><div style={{fontSize:10,color:CL.sub,marginBottom:6}}>歯を選択 → 傷病名を選択</div>{preds.length>0&&<div style={{marginBottom:8,padding:8,background:CL.aiL,borderRadius:6}}><div style={{fontSize:10,fontWeight:800,color:CL.ai,marginBottom:4}}>🤖 問診票からの予測</div>{preds.map((p,i)=>(<button key={i} onClick={()=>{if(sel)confirmDiag(p.code,p.name,p.short,sel);}} style={{display:"block",width:"100%",padding:"4px 8px",marginBottom:2,borderRadius:4,border:`1px solid ${CL.ai}30`,background:"#FFF",cursor:"pointer",textAlign:"left",fontSize:11}}>{p.name} <span style={{color:CL.ai}}>({Math.round(p.probability*100)}%)</span></button>))}</div>}{tt.length>0?<div style={{display:"flex",flexWrap:"wrap",gap:3,marginBottom:8}}>{tt.map(t=>(<button key={t} onClick={()=>setSel(t)} style={{padding:"4px 10px",borderRadius:5,cursor:"pointer",fontWeight:700,fontSize:10,border:sel===t?`2px solid ${CL.pri}`:`1px solid ${CL.bdr}`,background:sel===t?CL.priL:"#FFF"}}>{S(t)} {chart[t]}</button>))}</div>:<div style={{padding:10,textAlign:"center",color:CL.sub,fontSize:10}}>先に歯式を設定</div>}{sel&&<><input value={dSearch} onChange={e=>setDSearch(e.target.value)} placeholder="傷病名を検索..." style={{width:"100%",padding:"5px 8px",borderRadius:4,border:`1px solid ${CL.bdr}`,fontSize:11,marginBottom:6,boxSizing:"border-box"}}/><div style={{maxHeight:200,overflow:"auto"}}>{dMaster.filter(d=>!dSearch||d.name.includes(dSearch)||d.code.includes(dSearch)).slice(0,30).map(d=>(<button key={d.code} onClick={()=>{confirmDiag(d.code,d.name,d.name,sel);setPopup(null);}} style={{display:"block",width:"100%",padding:"6px 8px",marginBottom:2,borderRadius:4,border:`1px solid ${CL.bdr}`,background:"#FFF",cursor:"pointer",textAlign:"left"}}><div style={{fontSize:11,fontWeight:700}}>{d.name}</div><div style={{fontSize:9,color:CL.sub}}>{d.code} / {d.category}</div></button>))}</div></>}</div>}

          {popup==="billing"&&<div><div style={{padding:10,background:"#F9FAFB",borderRadius:6,marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",paddingBottom:6,borderBottom:`1px solid ${CL.bdr}`,marginBottom:6}}><span style={{fontSize:10,color:CL.sub}}>初再診料</span><span style={{fontWeight:800}}>{isNew?267:56}点</span></div>{procs.map((p,i)=>(<div key={i} style={{marginBottom:4}}><div style={{fontSize:11,fontWeight:700}}>{S(p.tooth)} {p.procedure_name}</div>{p.fee_items.map((fi,j)=>(<div key={j} style={{display:"flex",justifyContent:"space-between",paddingLeft:12,fontSize:10}}><span>{fi.name}</span><span>{fi.points*fi.count}点</span></div>))}</div>))}<div style={{borderTop:`2px solid ${CL.txt}`,paddingTop:6,marginTop:8,display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:800,color:CL.acc}}>合計</span><span style={{fontWeight:900,fontSize:18,color:CL.acc}}>{total}点</span></div><div style={{textAlign:"right",fontSize:10,color:CL.sub}}>{Math.round(patient.burden*10)}割負担 ¥{Math.round(total*10*patient.burden).toLocaleString()}</div></div><button onClick={billing} style={{width:"100%",padding:12,borderRadius:7,border:"none",cursor:"pointer",fontWeight:800,fontSize:13,background:CL.acc,color:"#FFF"}}>💰 算定確定 → 会計へ</button></div>}
        </div>
      </div>)}
    </div>
  </div>);
}

function B({i,l,bg,c,b,o}:{i:string;l:string;bg:string;c:string;b:string;o:()=>void}){return<button onClick={o} style={{padding:"7px 11px",borderRadius:7,fontSize:11,fontWeight:700,cursor:"pointer",border:`1.5px solid ${b}`,background:bg,color:c,display:"flex",alignItems:"center",gap:4}}>{i} {l}</button>;}

export default function Page(){return<Suspense fallback={<div style={{padding:40,textAlign:"center"}}>読み込み中...</div>}><Content /></Suspense>;}
