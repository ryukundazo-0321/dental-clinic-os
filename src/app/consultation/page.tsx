"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getClinicConfig, getDoctors, type ClinicConfig, type DoctorOption } from "@/lib/reservation-utils";

type Unit = { id: string; unit_number: number; name: string; unit_type: string; is_active: boolean };

type Appointment = {
  id: string;
  scheduled_at: string;
  patient_type: string;
  status: string;
  duration_min: number;
  doctor_id: string | null;
  unit_id: string | null;
  patients: { id: string; name_kanji: string; name_kana: string; phone: string; is_new: boolean; date_of_birth?: string } | null;
  medical_records: { id: string; status: string }[] | null;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; border: string; blockBg: string; icon: string }> = {
  reserved:        { label: "予約済",     color: "text-blue-700",   bg: "bg-blue-50",    border: "border-l-blue-500",   blockBg: "bg-blue-50",     icon: "📅" },
  checked_in:      { label: "来院済",     color: "text-green-700",  bg: "bg-green-50",   border: "border-l-green-500",  blockBg: "bg-green-50",    icon: "📱" },
  in_consultation: { label: "診察中",     color: "text-orange-700", bg: "bg-orange-50",  border: "border-l-orange-500", blockBg: "bg-orange-50",   icon: "🩺" },
  completed:       { label: "完了",       color: "text-purple-700", bg: "bg-purple-50",  border: "border-l-purple-500", blockBg: "bg-purple-50",   icon: "✅" },
  billing_done:    { label: "会計済",     color: "text-gray-500",   bg: "bg-gray-50",    border: "border-l-gray-400",   blockBg: "bg-gray-100",    icon: "💰" },
  cancelled:       { label: "キャンセル", color: "text-red-700",    bg: "bg-red-50",     border: "border-l-red-500",    blockBg: "bg-red-50",      icon: "❌" },
};

const HOURS = Array.from({ length: 13 }, (_, i) => i + 8);
const PX_PER_MIN = 2;

type ViewMode = "doctor" | "chair";

function getTodayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split("T")[0];
}

export default function ConsultationPage() {
  const [config, setConfig] = useState<ClinicConfig | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [doctors, setDoctors] = useState<DoctorOption[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [selectedDate, setSelectedDate] = useState(getTodayJST);
  const [loading, setLoading] = useState(true);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("doctor");
  const [editTime, setEditTime] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editDuration, setEditDuration] = useState(30);
  const resizeRef = useRef<{ aptId: string; startY: number; origDur: number } | null>(null);

  useEffect(() => {
    async function init() {
      const c = await getClinicConfig();
      setConfig(c);
      if (c) {
        const docs = await getDoctors(c.clinicId);
        setDoctors(docs);
        const { data: u } = await supabase.from("units").select("*").eq("is_active", true).order("unit_number");
        if (u) setUnits(u as Unit[]);
      }
      setLoading(false);
    }
    init();
  }, []);

  const fetchAppointments = useCallback(async () => {
    const { data } = await supabase.from("appointments")
      .select(`id, scheduled_at, patient_type, status, duration_min, doctor_id, unit_id,
        patients ( id, name_kanji, name_kana, phone, is_new, date_of_birth ),
        medical_records ( id, status )`)
      .gte("scheduled_at", `${selectedDate}T00:00:00+00`)
      .lte("scheduled_at", `${selectedDate}T23:59:59+00`)
      .neq("status", "cancelled")
      .order("scheduled_at", { ascending: true });
    if (data) setAppointments(data as unknown as Appointment[]);
  }, [selectedDate]);

  useEffect(() => {
    fetchAppointments();
    const channel = supabase.channel("consultation-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => fetchAppointments())
      .on("postgres_changes", { event: "*", schema: "public", table: "queue" }, () => fetchAppointments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedDate, fetchAppointments]);

  // === ユーティリティ ===
  function parseHM(apt: Appointment): [number, number] {
    const m = apt.scheduled_at.match(/(\d{2}):(\d{2}):\d{2}/);
    return m ? [parseInt(m[1]), parseInt(m[2])] : [0, 0];
  }
  function fmtTime(apt: Appointment) { const [h, m] = parseHM(apt); return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; }
  function fmtEnd(apt: Appointment) { const [h, m] = parseHM(apt); const t = h*60+m+(apt.duration_min||30); return `${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`; }
  function getAge(dob?: string) { if (!dob) return null; const b=new Date(dob),t=new Date(); let a=t.getFullYear()-b.getFullYear(); if(t.getMonth()<b.getMonth()||(t.getMonth()===b.getMonth()&&t.getDate()<b.getDate()))a--; return a; }
  function goToday() { setSelectedDate(getTodayJST()); }
  function goPrev() { const d=new Date(selectedDate+"T12:00:00"); d.setDate(d.getDate()-1); setSelectedDate(d.toISOString().split("T")[0]); }
  function goNext() { const d=new Date(selectedDate+"T12:00:00"); d.setDate(d.getDate()+1); setSelectedDate(d.toISOString().split("T")[0]); }

  // === ダブルブッキングチェック ===
  function hasConflict(aptId: string, unitId: string|null, startMin: number, durMin: number): boolean {
    if (!unitId) return false;
    const endMin = startMin + durMin;
    return appointments.some(a => {
      if (a.id===aptId||a.unit_id!==unitId||a.status==="cancelled") return false;
      const [ah,am]=parseHM(a); const aS=ah*60+am; const aE=aS+(a.duration_min||30);
      return startMin < aE && endMin > aS;
    });
  }

  // === DB更新 ===
  async function updateStatus(apt: Appointment, newStatus: string) {
    await supabase.from("appointments").update({ status: newStatus }).eq("id", apt.id);
    if (newStatus==="in_consultation") await supabase.from("queue").update({ status:"in_room", called_at:new Date().toISOString() }).eq("appointment_id", apt.id);
    else if (newStatus==="completed") {
      if (apt.medical_records?.length) await supabase.from("medical_records").update({ status:"confirmed", doctor_confirmed:true }).eq("appointment_id", apt.id);
      await supabase.from("queue").update({ status:"done" }).eq("appointment_id", apt.id);
    }
    setAppointments(p=>p.map(a=>a.id===apt.id?{...a,status:newStatus}:a));
    if (selectedApt?.id===apt.id) setSelectedApt(p=>p?{...p,status:newStatus}:null);
  }

  async function assignUnit(aptId: string, unitId: string) {
    const apt=appointments.find(a=>a.id===aptId);
    if (apt&&unitId) { const [h,m]=parseHM(apt); if(hasConflict(aptId,unitId,h*60+m,apt.duration_min||30)){alert("⚠️ この時間帯は既に別の予約が入っています");return;} }
    await supabase.from("appointments").update({ unit_id: unitId||null }).eq("id", aptId);
    setAppointments(p=>p.map(a=>a.id===aptId?{...a,unit_id:unitId||null}:a));
    if (selectedApt?.id===aptId) setSelectedApt(p=>p?{...p,unit_id:unitId||null}:null);
  }

  async function assignDoctor(aptId: string, doctorId: string) {
    await supabase.from("appointments").update({ doctor_id: doctorId||null }).eq("id", aptId);
    setAppointments(p=>p.map(a=>a.id===aptId?{...a,doctor_id:doctorId||null}:a));
    if (selectedApt?.id===aptId) setSelectedApt(p=>p?{...p,doctor_id:doctorId||null}:null);
  }

  async function updateAptTime(aptId: string, date: string, h: number, m: number) {
    const s=`${date}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`;
    await supabase.from("appointments").update({ scheduled_at:s }).eq("id", aptId);
    await fetchAppointments();
    if (selectedApt?.id===aptId) { setSelectedApt(p=>p?{...p,scheduled_at:s}:null); setEditTime(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`); setEditDate(date); }
  }

  async function updateDur(aptId: string, dur: number) {
    const c=Math.max(15,Math.min(180,Math.round(dur/15)*15));
    await supabase.from("appointments").update({ duration_min:c }).eq("id", aptId);
    setAppointments(p=>p.map(a=>a.id===aptId?{...a,duration_min:c}:a));
    if (selectedApt?.id===aptId) { setSelectedApt(p=>p?{...p,duration_min:c}:null); setEditDuration(c); }
  }

  async function cancelApt(apt: Appointment) {
    if (!confirm(`${apt.patients?.name_kanji||"不明"} 様の予約をキャンセルしますか？`)) return;
    await supabase.from("appointments").update({ status:"cancelled" }).eq("id", apt.id);
    setAppointments(p=>p.filter(a=>a.id!==apt.id));
    setSelectedApt(null);
  }

  // selectedApt同期
  useEffect(() => { if(selectedApt){ setEditTime(fmtTime(selectedApt)); setEditDuration(selectedApt.duration_min||30); setEditDate(selectedApt.scheduled_at.split("T")[0]); } }, [selectedApt?.id]); // eslint-disable-line

  // === リサイズ ===
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizeRef.current) return;
      const dy=e.clientY-resizeRef.current.startY;
      const dm=Math.round(dy/PX_PER_MIN/15)*15;
      const nd=Math.max(15,Math.min(180,resizeRef.current.origDur+dm));
      setAppointments(p=>p.map(a=>a.id===resizeRef.current!.aptId?{...a,duration_min:nd}:a));
    }
    function onUp() {
      if (!resizeRef.current) return;
      const apt=appointments.find(a=>a.id===resizeRef.current!.aptId);
      if (apt) updateDur(apt.id, apt.duration_min);
      resizeRef.current=null;
      document.body.style.cursor="";
      document.body.style.userSelect="";
    }
    window.addEventListener("mousemove",onMove);
    window.addEventListener("mouseup",onUp);
    return ()=>{window.removeEventListener("mousemove",onMove);window.removeEventListener("mouseup",onUp);};
  }, [appointments]); // eslint-disable-line

  // === Memos ===
  const columns = useMemo(() => {
    const c:{id:string;label:string}[]=[];
    if (viewMode==="doctor") doctors.forEach(d=>c.push({id:d.id,label:d.name}));
    else units.forEach(u=>c.push({id:u.id,label:u.name}));
    c.push({id:"__unassigned__",label:"未割当"});
    return c;
  }, [doctors,units,viewMode]);

  const aptsByColumn = useMemo(() => {
    const map=new Map<string,Appointment[]>();
    columns.forEach(c=>map.set(c.id,[]));
    appointments.forEach(apt=>{ const k=viewMode==="doctor"?apt.doctor_id:apt.unit_id; map.get(k&&map.has(k)?k:"__unassigned__")?.push(apt); });
    return map;
  }, [appointments,columns,viewMode]);

  const miniCalDays = useMemo(() => {
    const d=new Date(selectedDate+"T12:00:00"); const y=d.getFullYear(),mo=d.getMonth();
    const fd=new Date(y,mo,1).getDay(); const ld=new Date(y,mo+1,0).getDate();
    const days:(number|null)[]=[]; for(let i=0;i<fd;i++)days.push(null); for(let i=1;i<=ld;i++)days.push(i);
    return {year:y,month:mo,days};
  }, [selectedDate]);

  const statusCounts:Record<string,number>={}; appointments.forEach(a=>{statusCounts[a.status]=(statusCounts[a.status]||0)+1;});
  const checkedInApts=appointments.filter(a=>["checked_in","in_consultation","completed"].includes(a.status));

  if (loading||!config) return <div className="min-h-screen bg-gray-50 flex items-center justify-center"><p className="text-gray-400">読み込み中...</p></div>;

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <div className="flex-1 flex flex-col min-w-0">
        {/* ヘッダー */}
        <header className="bg-white border-b border-gray-200 shadow-sm px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← 戻る</Link>
            <h1 className="text-lg font-bold text-gray-900">🩺 診察カレンダー</h1>
            <Link href="/reception-dashboard" className="bg-gray-900 text-white px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-gray-800">🏥 受付ダッシュボード</Link>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <button onClick={goPrev} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">◀</button>
              <input type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 font-bold text-sm" />
              <button onClick={goNext} className="bg-white border border-gray-200 rounded-lg px-2.5 py-1.5 hover:bg-gray-50 text-sm">▶</button>
              <button onClick={goToday} className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 text-xs text-gray-500">今日</button>
            </div>
            <span className="text-xs text-gray-400">本日の予約: {appointments.length}件</span>
            <div className="flex gap-1.5">
              {["reserved","checked_in","in_consultation","completed","billing_done"].map(s=>(
                <span key={s} className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}`}>{STATUS_CONFIG[s].icon} {statusCounts[s]||0}</span>
              ))}
            </div>
          </div>
        </header>

        <div className="bg-white border-b border-gray-200 px-4 py-1.5 flex items-center gap-1">
          <button onClick={()=>setViewMode("doctor")} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${viewMode==="doctor"?"bg-sky-500 text-white shadow-sm":"bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>👨‍⚕️ 担当医別</button>
          <button onClick={()=>setViewMode("chair")} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${viewMode==="chair"?"bg-emerald-500 text-white shadow-sm":"bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>🪥 チェア別</button>
        </div>

        {/* タイムテーブル */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-[700px]">
            <div className="sticky top-0 z-10 bg-white border-b border-gray-200 flex shadow-sm">
              <div className="w-16 flex-shrink-0 border-r border-gray-200" />
              {columns.map(col=>{
                const ca=aptsByColumn.get(col.id)||[]; const iu=ca.find(a=>a.status==="in_consultation"); const wt=ca.filter(a=>a.status==="checked_in");
                const cs=viewMode==="chair"&&col.id!=="__unassigned__"?iu?"in_use":wt.length>0?"waiting":"empty":null;
                return (
                <div key={col.id} className={`flex-1 min-w-[160px] px-2 py-2.5 border-r border-gray-100 text-center ${col.id==="__unassigned__"?"bg-amber-50":""}`}>
                  <p className={`text-xs font-bold ${col.id==="__unassigned__"?"text-amber-700":"text-gray-700"}`}>{col.label}</p>
                  {cs==="in_use"&&<span className="text-[9px] font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full mt-0.5 inline-block">🩺 使用中 — {iu?.patients?.name_kanji}</span>}
                  {cs==="waiting"&&<span className="text-[9px] font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full mt-0.5 inline-block">📱 待機{wt.length}人</span>}
                  {cs==="empty"&&<span className="text-[9px] font-bold bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full mt-0.5 inline-block">空き</span>}
                </div>);
              })}
            </div>

            {HOURS.map(hour=>(
              <div key={hour} className="flex border-b border-gray-100" style={{minHeight:"120px"}}>
                <div className="w-16 flex-shrink-0 border-r border-gray-200 pr-2 pt-1 text-right">
                  <span className="text-[10px] text-gray-400 font-bold">{hour}:00</span>
                </div>
                {columns.map(col=>{
                  const colApts=(aptsByColumn.get(col.id)||[]).filter(a=>parseHM(a)[0]===hour);
                  return (
                    <div key={col.id}
                      onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="move";(e.currentTarget as HTMLElement).classList.add("bg-sky-50");}}
                      onDragLeave={e=>{(e.currentTarget as HTMLElement).classList.remove("bg-sky-50");}}
                      onDrop={async e=>{
                        e.preventDefault();
                        (e.currentTarget as HTMLElement).classList.remove("bg-sky-50");
                        const aptId=e.dataTransfer.getData("apt_id"); if(!aptId)return;
                        const apt=appointments.find(a=>a.id===aptId); if(!apt)return;
                        const rect=e.currentTarget.getBoundingClientRect();
                        const dropMin=Math.min(45,Math.max(0,Math.round((e.clientY-rect.top)/PX_PER_MIN/15)*15));
                        if (col.id!=="__unassigned__") {
                          if (viewMode==="chair") {
                            if(hasConflict(aptId,col.id,hour*60+dropMin,apt.duration_min||30)){alert("⚠️ この時間帯は既に別の予約が入っています");return;}
                            await supabase.from("appointments").update({unit_id:col.id}).eq("id",aptId);
                          } else { await supabase.from("appointments").update({doctor_id:col.id}).eq("id",aptId); }
                        }
                        await updateAptTime(aptId,selectedDate,hour,dropMin);
                      }}
                      className={`flex-1 min-w-[160px] border-r border-gray-50 relative px-1 py-0.5 transition-colors ${col.id==="__unassigned__"?"bg-amber-50/30":""}`}>
                      {colApts.map(apt=>{
                        const st=STATUS_CONFIG[apt.status]||STATUS_CONFIG.reserved;
                        const dur=apt.duration_min||30; const bh=Math.max(dur*PX_PER_MIN,48);
                        const mo=parseHM(apt)[1]; const to=mo*PX_PER_MIN;
                        const age=getAge(apt.patients?.date_of_birth);
                        const un=units.find(u=>u.id===apt.unit_id)?.name;
                        const dn=doctors.find(d=>d.id===apt.doctor_id)?.name;
                        return (
                          <div key={apt.id} draggable
                            onDragStart={e=>{e.dataTransfer.setData("apt_id",apt.id);e.dataTransfer.effectAllowed="move";(e.currentTarget as HTMLElement).style.opacity="0.5";}}
                            onDragEnd={e=>{(e.currentTarget as HTMLElement).style.opacity="1";}}
                            onClick={()=>setSelectedApt(apt)}
                            className={`absolute left-1 right-1 rounded-lg border-l-4 ${st.border} ${st.blockBg} border border-gray-200 cursor-grab hover:shadow-md transition-all overflow-hidden ${selectedApt?.id===apt.id?"ring-2 ring-sky-400 shadow-md":""}`}
                            style={{top:`${to}px`,height:`${bh}px`,zIndex:selectedApt?.id===apt.id?5:1}}>
                            <div className="px-2 py-1 h-full flex flex-col">
                              <div className="flex items-center justify-between">
                                <span className={`text-[9px] font-bold px-1 py-0.5 rounded ${st.bg} ${st.color}`}>{st.label}</span>
                                <span className="text-[9px] text-gray-400">{fmtTime(apt)}-{fmtEnd(apt)}</span>
                              </div>
                              <p className="text-xs font-bold text-gray-900 mt-0.5 truncate">
                                {apt.patients?.name_kanji||"未登録"}
                                {age!==null&&<span className="text-[9px] font-normal text-gray-400 ml-1">({age})</span>}
                              </p>
                              {bh>55&&(
                                <div className="flex flex-wrap gap-1 mt-0.5">
                                  {apt.patient_type==="new"&&<span className="text-[8px] font-bold bg-red-100 text-red-600 px-1 rounded">初診</span>}
                                  {viewMode==="chair"&&dn&&<span className="text-[8px] bg-indigo-50 text-indigo-600 px-1 rounded">{dn}</span>}
                                  {viewMode==="doctor"&&un&&<span className="text-[8px] bg-emerald-50 text-emerald-600 px-1 rounded">{un}</span>}
                                </div>
                              )}
                            </div>
                            {/* リサイズハンドル */}
                            <div onMouseDown={e=>{e.stopPropagation();e.preventDefault();resizeRef.current={aptId:apt.id,startY:e.clientY,origDur:dur};document.body.style.cursor="ns-resize";document.body.style.userSelect="none";}}
                              className="absolute bottom-0 left-0 right-0 h-2.5 cursor-ns-resize group" style={{touchAction:"none"}}>
                              <div className="mx-auto w-8 h-1 rounded-full bg-gray-300 group-hover:bg-gray-500 mt-1" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* === 右サイドバー === */}
      <div className="w-72 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-y-auto">
        <div className="p-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-700">{miniCalDays.year}年{miniCalDays.month+1}月</span>
            <div className="flex gap-1">
              <button onClick={()=>{const d=new Date(selectedDate+"T12:00:00");d.setMonth(d.getMonth()-1);setSelectedDate(d.toISOString().split("T")[0]);}} className="text-xs text-gray-400 hover:text-gray-700 px-1">‹</button>
              <button onClick={()=>{const d=new Date(selectedDate+"T12:00:00");d.setMonth(d.getMonth()+1);setSelectedDate(d.toISOString().split("T")[0]);}} className="text-xs text-gray-400 hover:text-gray-700 px-1">›</button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {["日","月","火","水","木","金","土"].map(d=><span key={d} className="text-[9px] text-gray-400 font-bold">{d}</span>)}
            {miniCalDays.days.map((day,i)=>{
              if(!day)return <span key={`e-${i}`}/>;
              const ds=`${miniCalDays.year}-${String(miniCalDays.month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              return (<button key={day} onClick={()=>setSelectedDate(ds)}
                className={`text-[10px] w-6 h-6 rounded-full flex items-center justify-center transition-colors ${ds===selectedDate?"bg-sky-500 text-white font-bold":ds===getTodayJST()?"bg-sky-100 text-sky-700 font-bold":"text-gray-600 hover:bg-gray-100"}`}>{day}</button>);
            })}
          </div>
        </div>

        <div className="p-3 border-b border-gray-100">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-gray-700">受付一覧</h3>
            <div className="flex gap-1">
              {["checked_in","in_consultation","completed"].map(s=>(
                <span key={s} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].color}`}>{STATUS_CONFIG[s].label} {statusCounts[s]||0}</span>
              ))}
            </div>
          </div>
          {checkedInApts.length===0?<p className="text-xs text-gray-400 text-center py-4">受付患者なし</p>:(
            <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
              {checkedInApts.map(apt=>{const st=STATUS_CONFIG[apt.status]||STATUS_CONFIG.reserved;return(
                <button key={apt.id} onClick={()=>setSelectedApt(apt)} className={`w-full text-left rounded-lg p-2 border transition-colors ${selectedApt?.id===apt.id?"border-sky-400 bg-sky-50":"border-gray-200 hover:border-gray-300 hover:bg-gray-50"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${st.bg} ${st.color}`}>{st.label}</span><span className="text-xs font-bold text-gray-800 truncate">{apt.patients?.name_kanji||"未登録"}</span></div>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{fmtTime(apt)}</span>
                  </div>
                </button>);})}
            </div>
          )}
        </div>

        {/* 詳細パネル */}
        {selectedApt?(
          <div className="p-3 flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold text-gray-700">患者詳細</h3>
              <button onClick={()=>setSelectedApt(null)} className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="bg-gradient-to-br from-sky-100 to-sky-200 text-sky-700 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold">{(selectedApt.patients?.name_kanji||"?").charAt(0)}</div>
                <div><p className="font-bold text-gray-900 text-sm">{selectedApt.patients?.name_kanji||"未登録"}</p><p className="text-[10px] text-gray-400">{selectedApt.patients?.name_kana}</p></div>
              </div>

              {/* 日時編集 */}
              <div className="border border-gray-200 rounded-lg p-2.5 space-y-2">
                <p className="text-[10px] text-gray-400 font-bold">📅 日時変更</p>
                <input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)} className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-400" />
                <div className="flex items-center gap-2">
                  <input type="time" value={editTime} onChange={e=>setEditTime(e.target.value)} className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-400" />
                  <select value={editDuration} onChange={e=>setEditDuration(Number(e.target.value))} className="border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:border-sky-400">
                    {[15,30,45,60,90,120].map(d=><option key={d} value={d}>{d}分</option>)}
                  </select>
                </div>
                {(editDate!==selectedApt.scheduled_at.split("T")[0]||editTime!==fmtTime(selectedApt)||editDuration!==(selectedApt.duration_min||30))&&(
                  <button onClick={async()=>{
                    const [h,m]=editTime.split(":").map(Number);
                    if(selectedApt.unit_id&&hasConflict(selectedApt.id,selectedApt.unit_id,h*60+m,editDuration)){alert("⚠️ この時間帯は既に別の予約が入っています");return;}
                    await updateAptTime(selectedApt.id,editDate,h,m);
                    if(editDuration!==(selectedApt.duration_min||30)) await updateDur(selectedApt.id,editDuration);
                    if(editDate!==selectedDate) setSelectedDate(editDate);
                  }} className="w-full py-1.5 rounded-lg text-xs font-bold bg-sky-500 text-white hover:bg-sky-600">✓ 変更を保存</button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><p className="text-gray-400">区分</p><p className="text-gray-900 font-bold">{selectedApt.patient_type==="new"?"初診":"再診"}</p></div>
                <div><p className="text-gray-400">電話</p><p className="text-gray-900">{selectedApt.patients?.phone||"-"}</p></div>
              </div>

              <div><p className="text-[10px] text-gray-400 mb-1">ユニット</p>
                <select value={selectedApt.unit_id||""} onChange={e=>assignUnit(selectedApt.id,e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                  <option value="">未割り当て</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div><p className="text-[10px] text-gray-400 mb-1">担当医</p>
                <select value={selectedApt.doctor_id||""} onChange={e=>assignDoctor(selectedApt.id,e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-sky-400">
                  <option value="">未割り当て</option>{doctors.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div className="border-t border-gray-100 pt-2"><p className="text-[10px] text-gray-400 mb-1">カルテ</p>
                {selectedApt.medical_records?.length?<p className="text-[10px] text-green-600 font-bold">✅ {selectedApt.medical_records[0].status}</p>:<p className="text-[10px] text-gray-400">未作成</p>}
              </div>
              <div className="border-t border-gray-100 pt-2"><p className="text-[10px] text-gray-400 mb-1">ステータス</p>
                <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${STATUS_CONFIG[selectedApt.status]?.bg} ${STATUS_CONFIG[selectedApt.status]?.color}`}>{STATUS_CONFIG[selectedApt.status]?.icon} {STATUS_CONFIG[selectedApt.status]?.label}</span>
              </div>

              <div className="border-t border-gray-100 pt-3 space-y-2">
                {selectedApt.status==="reserved"&&<button onClick={()=>updateStatus(selectedApt,"checked_in")} className="w-full py-2.5 rounded-lg text-sm font-bold bg-green-500 text-white hover:bg-green-600 shadow-lg shadow-green-200">📱 来院済にする</button>}
                {selectedApt.status==="checked_in"&&<button onClick={async()=>{await updateStatus(selectedApt,"in_consultation");window.location.href=`/consultation/hub?appointment_id=${selectedApt.id}`;}} className="w-full py-3 rounded-lg text-sm font-bold bg-orange-500 text-white hover:bg-orange-600 text-center shadow-lg shadow-orange-200">🩺 呼び出し（診察開始）→</button>}
                {selectedApt.status==="in_consultation"&&(<>
                  <a href={`/consultation/hub?appointment_id=${selectedApt.id}`} className="block w-full py-3 rounded-lg text-sm font-bold bg-sky-500 text-white hover:bg-sky-600 text-center shadow-lg shadow-sky-200">📋 診察画面を開く →</a>
                  <a href={`/karte-agent/unit?appointment_id=${selectedApt.id}`} className="block w-full py-3 rounded-lg text-sm font-bold bg-gray-900 text-white hover:bg-gray-800 text-center">🤖 カルテエージェントで開く →</a>
                  {/* ★ 追加: 新診察ページで開く */}
                  <a href={`/karte-agent/consultation?appointment_id=${selectedApt.id}`} className="block w-full py-3 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-700 text-center">🦷 新診察ページで開く →</a>
                  <button onClick={()=>updateStatus(selectedApt,"completed")} className="w-full py-2 rounded-lg text-xs font-bold bg-purple-100 text-purple-700 hover:bg-purple-200">✅ 診察完了</button>
                </>)}
                {selectedApt.status==="completed"&&<button onClick={()=>updateStatus(selectedApt,"billing_done")} className="w-full py-2.5 rounded-lg text-sm font-bold bg-gray-200 text-gray-700 hover:bg-gray-300">💰 会計済にする</button>}
                {selectedApt.patients?.id&&<Link href={`/patients/${selectedApt.patients.id}`} className="block w-full py-2 rounded-lg text-xs font-bold bg-sky-50 text-sky-700 hover:bg-sky-100 text-center">📋 カルテを開く</Link>}
                {["reserved","checked_in"].includes(selectedApt.status)&&<button onClick={()=>cancelApt(selectedApt)} className="w-full py-2 rounded-lg text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200">❌ 予約キャンセル</button>}
              </div>
            </div>
          </div>
        ):(
          <div className="p-3 flex-1 flex items-center justify-center"><p className="text-xs text-gray-400 text-center">予約ブロックをクリックすると<br/>詳細が表示されます</p></div>
        )}
      </div>
    </div>
  );
}
