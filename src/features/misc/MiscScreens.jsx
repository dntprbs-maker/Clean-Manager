import { useState, useEffect, useRef } from "react";
import { ChevronDown, ChevronLeft, X } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../../firebase";
import { fmt, diff, fmtTime } from "../../lib/dateTime";
import { parseEventText, DEFAULT_TITLE_RULE, DEFAULT_TYPE_KEYWORDS, TITLE_TOKEN_LABELS } from "../../lib/eventTextParser";
import { useC } from "../../context/AppContext";
import { isSuperAdmin, isMemberOf, accessTier } from "../../lib/membership";

// ── 팀별 일정 화면 ───────────────────────────────────────────────
export function TeamScheduleScreen() {
  const { visibleEvents, setCurrentScreen, visibleCals: cals } = useC();
  const [selectedCal, setSelectedCal] = useState(null);
  const [dateOffset, setDateOffset]   = useState(0);
  const [dropOpen, setDropOpen]       = useState(false);
  const touchStartX = useRef(null);

  const getDate = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return fmt(d); // 로컬 기준 날짜 (UTC 변환으로 하루 밀리는 문제 방지)
  };

  const formatDate = (offset) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    const month = d.getMonth() + 1;
    const day   = d.getDate();
    const weekdays = ["일","월","화","수","목","금","토"];
    const wd = weekdays[d.getDay()];
    if(offset === 0)  return { main:"오늘",  sub:`${month}/${day} (${wd})` };
    if(offset === 1)  return { main:"내일",  sub:`${month}/${day} (${wd})` };
    if(offset === -1) return { main:"어제",  sub:`${month}/${day} (${wd})` };
    return { main:`${month}/${day}`, sub:`(${wd})` };
  };

  const dateLabel = getDate(dateOffset);
  const curr = formatDate(dateOffset);
  const prev = formatDate(dateOffset - 1);
  const next = formatDate(dateOffset + 1);

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd   = (e) => {
    if(touchStartX.current === null) return;
    const diff = touchStartX.current - e.changedTouches[0].clientX;
    if(Math.abs(diff) > 40) setDateOffset(p => diff > 0 ? p+1 : p-1);
    touchStartX.current = null;
  };

  const filtered = visibleEvents
    .filter(e => (!selectedCal || e.calId === selectedCal) && e.start === dateLabel)
    .sort((a,b) => (a.startTime||"00:00").localeCompare(b.startTime||"00:00"));

  const fmtTime = (t) => {
    if(!t) return "";
    const [h,m] = t.split(":");
    const hr = parseInt(h);
    return `${hr<12?"오전":"오후"} ${hr>12?hr-12:hr}:${m}`;
  };

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-screen">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-0">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-xl font-bold text-gray-900">팀별 일정</h2>
          {/* 팀 선택 드롭다운 */}
          <div className="relative flex-1">
            <button onClick={()=>setDropOpen(o=>!o)}
              className="flex items-center gap-1 text-sm font-bold px-3 py-1.5 rounded-xl border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 transition-all">
              {selectedCal ? (cals.find(c=>c.id===selectedCal)?.name||"팀 선택") : "팀 선택"}
              <ChevronDown size={14} className={`transition-transform ${dropOpen?"rotate-180":""}`}/>
            </button>
            {dropOpen && (
              <div className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-50 min-w-[140px] py-1">
                <button onClick={()=>{setSelectedCal(null);setDropOpen(false);}}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-bold text-gray-800 hover:bg-gray-50">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-400"/>
                    전체
                    <span className="text-xs text-gray-400 font-normal">{visibleEvents.filter(e=>e.start===dateLabel).length}건</span>
                  </div>
                  {!selectedCal && <span className="text-blue-500">✓</span>}
                </button>
                {cals.filter(c=>c.isField!==false).map(cal=>{
                  const cnt = visibleEvents.filter(e=>e.calId===cal.id&&e.start===dateLabel).length;
                  return (
                  <button key={cal.id} onClick={()=>{setSelectedCal(cal.id);setDropOpen(false);}}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-bold hover:bg-gray-50"
                    style={{color:selectedCal===cal.id?cal.color:"#374151"}}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{background:cal.color}}/>
                      {cal.name}
                      <span className="text-xs text-gray-400 font-normal">{cnt}건</span>
                    </div>
                    {selectedCal===cal.id && <span style={{color:cal.color}}>✓</span>}
                  </button>
                )})}
              </div>
            )}
          </div>
          <button onClick={()=>setCurrentScreen("calendar")} className="p-2 rounded-full hover:bg-gray-100">
            <X size={22} className="text-gray-500"/>
          </button>
        </div>

        {/* 날짜 슬라이더 */}
        <div
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          className="flex items-center mb-4 select-none">
          {/* 이전 날짜 */}
          <button onClick={()=>setDateOffset(p=>p-1)}
            className="flex-1 py-2 border-none bg-transparent cursor-pointer text-center opacity-40">
            <div className="text-xs font-semibold text-gray-400">{prev.main}</div>
            <div className="text-xs text-gray-300">{prev.sub}</div>
          </button>
          {/* 현재 날짜 */}
          <div className="flex-2 py-3 text-center rounded-2xl border"
            style={{flex:2, background:"#f0fdf4", borderColor:"#86efac"}}>
            <div className="text-base font-extrabold text-gray-900">{curr.main}</div>
            <div className="text-xs font-semibold text-green-600">{curr.sub}</div>
          </div>
          {/* 다음 날짜 */}
          <button onClick={()=>setDateOffset(p=>p+1)}
            className="flex-1 py-2 border-none bg-transparent cursor-pointer text-center opacity-40">
            <div className="text-xs font-semibold text-gray-400">{next.main}</div>
            <div className="text-xs text-gray-300">{next.sub}</div>
          </button>
        </div>
      </div>


      {/* 일정 목록 */}
      <div className="flex-1 overflow-y-auto px-4 pb-16 flex flex-col gap-2">
        {filtered.length===0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center text-gray-400 text-sm">
            {curr.main} 일정이 없습니다
          </div>
        ) : filtered.map(ev=>{
          const cal = cals.find(c=>c.id===ev.calId);
          return (
            <div key={ev.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3 shadow-sm">
              <div className="w-1 self-stretch rounded-full shrink-0" style={{background:cal?.color||"#1a56db"}}/>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-900 truncate">{ev.title}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {ev.allDay?"종일":`${fmtTime(ev.startTime)} ~ ${fmtTime(ev.endTime)}`}
                  {ev.place?` · ${ev.place}`:""}
                </p>
              </div>
              <div className="text-xs font-bold px-2 py-1 rounded-full shrink-0"
                style={{background:(cal?.color||"#1a56db")+"22",color:cal?.color||"#1a56db"}}>
                {cal?.label||cal?.name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── 대시보드 카드 정의 ───────────────────────────────────────────
const DASH_CARD_GROUPS = [
  { id: "count", label: "일정 현황" },
  { id: "team",  label: "팀별" },
  { id: "ops",   label: "운영" },
];

// 기간 겹침 판정 (start~end 가 from~to 와 겹치는가)
const _ovl = (ev, from, to) => ev.start <= to && (ev.end || ev.start) >= from;

const ALL_DASH_CARDS = [
  { id:"today_count", label:"오늘 일정", icon:"📅", color:"#1a56db", bg:"#eff6ff", group:"count",
    roles:["최고관리자","팀장","팀원"],
    getValue:(evs)=>{ const t=fmt(new Date()); return { value:evs.filter(e=>_ovl(e,t,t)).length, unit:"건" }; } },
  { id:"week_count", label:"이번주 일정", icon:"🗓️", color:"#0891b2", bg:"#ecfeff", group:"count",
    roles:["최고관리자","팀장"],
    getValue:(evs)=>{ const n=new Date(); const mon=new Date(n); mon.setDate(n.getDate()-((n.getDay()+6)%7));
      const sun=new Date(mon); sun.setDate(mon.getDate()+6);
      return { value:evs.filter(e=>_ovl(e,fmt(mon),fmt(sun))).length, unit:"건" }; } },
  { id:"month_count", label:"이번달 일정", icon:"📆", color:"#7c3aed", bg:"#f5f3ff", group:"count",
    roles:["최고관리자","팀장"],
    getValue:(evs)=>{ const n=new Date();
      const f=fmt(new Date(n.getFullYear(),n.getMonth(),1)), t=fmt(new Date(n.getFullYear(),n.getMonth()+1,0));
      return { value:evs.filter(e=>_ovl(e,f,t)).length, unit:"건" }; } },
  { id:"total_count", label:"전체 일정", icon:"📊", color:"#111827", bg:"#f3f4f6", group:"count",
    roles:["최고관리자"],
    getValue:(evs)=>({ value:evs.length, unit:"건" }) },
  { id:"upcoming", label:"다가오는 일정", icon:"⏭️", color:"#16a34a", bg:"#f0fdf4", group:"ops",
    roles:["최고관리자","팀장","팀원"],
    getValue:(evs)=>{ const t=fmt(new Date()); return { value:evs.filter(e=>e.start>=t).length, unit:"건" }; } },
  { id:"team_breakdown", label:"오늘 가장 바쁜 팀", icon:"🔥", color:"#ea580c", bg:"#fff7ed", group:"team",
    roles:["최고관리자"],
    getValue:(evs,user,cals)=>{ const t=fmt(new Date()); const cnt={};
      evs.filter(e=>_ovl(e,t,t)).forEach(e=>{ cnt[e.calId]=(cnt[e.calId]||0)+1; });
      let best=null,max=0; Object.entries(cnt).forEach(([id,c])=>{ if(c>max){max=c;best=id;} });
      const cal=(cals||[]).find(c=>c.id===best);
      return { value: best ? (cal?.label||cal?.name||"-") : "-", unit: best ? ` ${max}건` : "" }; } },
];

const DEFAULT_DASH_CARDS = {
  "최고관리자": ["today_count","week_count","month_count","total_count","upcoming","team_breakdown"],
  "팀장":       ["today_count","week_count","upcoming"],
  "팀원":       ["today_count","upcoming"],
};

export function DashboardScreen() {
  const { visibleEvents, setCurrentScreen, visibleCals: cals, currentUser } = useC();
  const [editing, setEditing]   = useState(false);
  const tier = accessTier(currentUser);
  const [selectedIds, setSelectedIds] = useState(DEFAULT_DASH_CARDS[tier]||["today_count"]);

  const available = ALL_DASH_CARDS.filter(c=>c.roles.includes(tier)||tier==="최고관리자");
  const selected  = available.filter(c=>selectedIds.includes(c.id));

  const toggle = (id) => setSelectedIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {isSuperAdmin(currentUser)?"사장님 대시보드":"일정 요약"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{currentUser.name} · {tier}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={()=>setEditing(p=>!p)}
              className="text-sm font-bold px-4 py-2 rounded-full transition-all"
              style={{background:editing?"#111827":"#f3f4f6", color:editing?"white":"#374151"}}>
              {editing?"✅ 완료":"✏️ 편집"}
            </button>
            <button onClick={()=>setCurrentScreen("calendar")} className="p-2 rounded-full hover:bg-gray-100">
              <X size={22} className="text-gray-500"/>
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        {/* 편집 모드 */}
        {editing ? (
          <>
            <p className="text-sm text-gray-500 leading-relaxed mb-2">보여줄 카드를 선택하세요.</p>
            {DASH_CARD_GROUPS.map(group=>{
              const groupCards = available.filter(c=>c.group===group.id);
              if(groupCards.length===0) return null;
              return (
                <div key={group.id} className="mb-4">
                  <p className="text-xs font-bold text-gray-400 mb-2 px-1">{group.label}</p>
                  <div className="flex flex-col gap-2">
                    {groupCards.map(card=>{
                      const checked = selectedIds.includes(card.id);
                      const {value,unit} = card.getValue(visibleEvents, currentUser, cals, []);
                      return (
                        <button key={card.id} onClick={()=>toggle(card.id)}
                          className="flex items-center gap-4 p-4 rounded-2xl text-left transition-all"
                          style={{background:"white", border:`2px solid ${checked?card.color:"#f3f4f6"}`,
                            boxShadow:checked?`0 0 0 3px ${card.color}22`:"none"}}>
                          <div className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center"
                            style={{border:`2px solid ${checked?card.color:"#d1d5db"}`, background:checked?card.color:"white"}}>
                            {checked && <span style={{color:"white",fontSize:12,fontWeight:800}}>✓</span>}
                          </div>
                          <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl shrink-0"
                            style={{background:card.bg}}>{card.icon}</div>
                          <div className="flex-1">
                            <p className="text-sm font-bold text-gray-900">{card.label}</p>
                            <p className="text-xs text-gray-400 mt-0.5">현재 <span className="font-bold" style={{color:card.color}}>{value}{unit}</span></p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </>
        ) : (
          <>
            {selected.length===0 ? (
              <div className="text-center py-16 text-gray-400">
                <div className="text-5xl mb-4">📋</div>
                <p className="text-sm font-bold mb-2">표시할 카드가 없어요</p>
                <button onClick={()=>setEditing(true)}
                  className="mt-4 px-6 py-3 rounded-full text-white text-sm font-bold"
                  style={{background:"#111827"}}>✏️ 카드 선택하기</button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {selected.map(card=>{
                  const {value,unit} = card.getValue(visibleEvents, currentUser, cals);
                  const isAlert = card.id==="complaint" && parseInt(value)>0;
                  return (
                    <div key={card.id}
                      className="bg-white rounded-2xl p-4 relative"
                      style={{border:`1.5px solid ${isAlert?card.color+"66":"#f3f4f6"}`,
                        boxShadow:isAlert?`0 0 0 3px ${card.color}18`:"0 1px 4px rgba(0,0,0,.06)"}}>
                      {isAlert && <div className="absolute top-3 right-3 w-2 h-2 rounded-full" style={{background:card.color}}/>}
                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-xl mb-3"
                        style={{background:card.bg}}>{card.icon}</div>
                      <p className="text-xs font-bold text-gray-400 mb-1">{card.label}</p>
                      <div className="flex items-end gap-1">
                        <span className="text-3xl font-extrabold leading-none" style={{color:card.color}}>{value}</span>
                        <span className="text-sm text-gray-400 mb-0.5">{unit}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── 공지사항 화면 ───────────────────────────────────────────────
export function NoticeScreen() {
  const { notices, currentUser, setCurrentScreen, addNotice, deleteNotice: removeNoticeDoc } = useC();
  const [selected, setSelected]   = useState(null);
  const [writing, setWriting]     = useState(false);
  const [newTitle, setNewTitle]   = useState("");
  const [newBody, setNewBody]     = useState("");
  const [important, setImportant] = useState(false);
  const [readIds, setReadIds]     = useState(()=>JSON.parse(localStorage.getItem("readNotices")||"[]"));

  const isAdmin = isSuperAdmin(currentUser) || isMemberOf(currentUser, "관리팀");

  const markRead = (id) => {
    if(readIds.includes(id)) return;
    const next = [...readIds, id];
    setReadIds(next);
    localStorage.setItem("readNotices", JSON.stringify(next));
  };

  const submitNotice = () => {
    if(!newTitle.trim()) return;
    // id 는 Firestore 가 발급. 실시간 스냅샷으로 목록에 자동 반영됨.
    addNotice({ title:newTitle, body:newBody, author:currentUser.name, date:fmt(new Date()), important });
    setNewTitle(""); setNewBody(""); setImportant(false); setWriting(false);
  };

  const deleteNotice = (id) => { removeNoticeDoc(id); setSelected(null); };

  // 상세 보기
  if(selected) {
    markRead(selected.id);
    return (
      <div className="flex-1 overflow-y-auto bg-white flex flex-col">
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <button onClick={()=>setSelected(null)} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <h2 className="text-base font-bold text-gray-900 flex-1 line-clamp-1">{selected.title}</h2>
          {isAdmin && (
            <button onClick={()=>deleteNotice(selected.id)}
              className="text-xs text-red-400 font-bold px-3 py-1.5 rounded-full bg-red-50">삭제</button>
          )}
        </div>
        <div className="px-5 py-4 flex-1">
          <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
            <span className="font-bold text-gray-600">{selected.author}</span>
            <span>·</span><span>{selected.date}</span>
            {selected.important && <span className="px-2 py-0.5 bg-red-50 text-red-500 font-bold rounded-full">📌 중요</span>}
          </div>
          <div className="h-px bg-gray-100 mb-4"/>
          <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{selected.body || "내용이 없습니다."}</p>
        </div>
      </div>
    );
  }

  // 새 공지 작성
  if(writing) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-gray-100 bg-white">
          <button onClick={()=>setWriting(false)} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <span className="flex-1 font-bold text-base">새 공지 작성</span>
          <button onClick={submitNotice}
            className="text-sm font-bold px-4 py-2 rounded-full text-white"
            style={{background:newTitle.trim()?"#1a56db":"#d1d5db"}}>등록</button>
        </div>
        <div className="px-4 py-4 flex flex-col gap-4">
          {/* 중요 토글 */}
          <div onClick={()=>setImportant(p=>!p)}
            className="flex items-center gap-3 p-4 rounded-2xl cursor-pointer transition-all"
            style={{background:important?"#fef2f2":"white", border:`1.5px solid ${important?"#fca5a5":"#f3f4f6"}`}}>
            <div className="w-11 h-6 rounded-full relative transition-all shrink-0"
              style={{background:important?"#ef4444":"#e5e7eb"}}>
              <div className="absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all"
                style={{left:important?"calc(100% - 20px)":"4px"}}/>
            </div>
            <div>
              <p className="text-sm font-bold" style={{color:important?"#ef4444":"#374151"}}>📌 중요 공지</p>
              <p className="text-xs text-gray-400 mt-0.5">{important?"목록 상단 강조 표시":"일반 공지로 등록"}</p>
            </div>
          </div>
          {/* 제목 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">제목</p>
            <input value={newTitle} onChange={e=>setNewTitle(e.target.value)}
              placeholder="공지 제목을 입력하세요"
              className="w-full text-base font-bold outline-none bg-transparent text-gray-900"/>
          </div>
          {/* 내용 */}
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-400 mb-2 uppercase tracking-wide">내용</p>
            <textarea value={newBody} onChange={e=>setNewBody(e.target.value)}
              placeholder="내용을 입력하세요..."
              rows={10}
              className="w-full text-sm outline-none resize-none text-gray-700 leading-relaxed bg-transparent"/>
          </div>
        </div>
      </div>
    );
  }

  // 목록
  const unread = notices.filter(n=>!readIds.includes(n.id)).length;
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-gray-900">팀 공지사항</h2>
            {unread>0 && <p className="text-xs text-blue-500 font-semibold mt-0.5">읽지 않은 공지 {unread}개</p>}
          </div>
          <div className="flex items-center gap-2">
          {isAdmin && (
            <button onClick={()=>setWriting(true)}
              className="flex items-center gap-1 text-sm font-bold text-blue-600 px-4 py-2 rounded-full bg-blue-50">
              + 새 공지
            </button>
          )}
            <button onClick={()=>setCurrentScreen("calendar")} className="p-2 rounded-full hover:bg-gray-100">
              <X size={22} className="text-gray-500"/>
            </button>
          </div>
        </div>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        {notices.length===0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm text-gray-400 font-semibold">공지사항이 없습니다</p>
          </div>
        ) : notices.map(n=>{
          const isRead = readIds.includes(n.id);
          return (
            <button key={n.id} onClick={()=>setSelected(n)}
              className="text-left w-full rounded-2xl p-4 flex items-start gap-3 transition-all"
              style={{background:n.important?"#fffbeb":"white",
                border:`1.5px solid ${n.important?"#fde68a":isRead?"#f3f4f6":"#dbeafe"}`,
                boxShadow:isRead?"none":"0 2px 8px rgba(26,86,219,.08)"}}>
              <div className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                style={{background:isRead?"#e5e7eb":"#1a56db",
                  boxShadow:isRead?"none":"0 0 0 3px rgba(26,86,219,.15)"}}/>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {n.important && <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">📌 중요</span>}
                  <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{n.author}</span>
                </div>
                <p className="text-sm font-bold truncate" style={{color:isRead?"#9ca3af":"#111827"}}>{n.title}</p>
                {n.body && <p className="text-xs text-gray-400 truncate mt-1">{n.body}</p>}
                <p className="text-xs text-gray-300 mt-1">{n.date}</p>
              </div>
              <ChevronLeft size={16} className="text-gray-300 rotate-180 shrink-0 mt-1"/>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── 최근 작업 내역 화면 (변경 로그) ───────────────────────────────────────────────
export function ActivityLogScreen() {
  const { activityLogs, setCurrentScreen, cals } = useC();
  const [filter, setFilter]   = useState("전체");
  const [userFilter, setUserFilter] = useState("전체");
  const FILTERS = ["전체","등록","수정","삭제"];

  const ACTION_STYLE = {
    "등록": {bg:"#f0fdf4", color:"#16a34a", icon:"✅"},
    "수정": {bg:"#eff6ff", color:"#1a56db", icon:"✏️"},
    "삭제": {bg:"#fef2f2", color:"#dc2626", icon:"🗑️"},
  };

  // 수정자 목록 (중복 제거)
  const users = [...new Set(activityLogs.map(l => typeof l.user==="string"?l.user:l.user?.name||"관리자"))];

  const filtered = activityLogs
    .filter(l=>filter==="전체"||l.action===filter)
    .filter(l=>{
      if(userFilter==="전체") return true;
      const name = typeof l.user==="string"?l.user:l.user?.name||"관리자";
      return name===userFilter;
    });

  // 날짜별 그룹
  const grouped = filtered.reduce((acc,log)=>{
    const date = log.date || log.time?.slice(0,10) || "기타";
    if(!acc[date]) acc[date]=[];
    acc[date].push(log);
    return acc;
  },{});
  const groupedDates = Object.keys(grouped).sort((a,b)=>b.localeCompare(a));

  const today = fmt(new Date());
  const yesterday = fmt(new Date(Date.now()-86400000));
  const dateLabel = (d) => d===today?"오늘":d===yesterday?"어제":d.slice(5).replace("-",".");

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-100 px-4 pt-4 pb-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">변경 로그</h2>
            <p className="text-xs text-gray-400">전체 {activityLogs.length}건</p>
          </div>
          <button onClick={()=>setCurrentScreen("calendar")} className="p-2 rounded-full hover:bg-gray-100">
            <X size={22} className="text-gray-500"/>
          </button>
        </div>
        {/* 액션 + 수정자 필터 한 줄 */}
        <div className="flex gap-1.5 pb-3 overflow-x-auto">
          {FILTERS.map(f=>{
            const s = f==="전체"?null:ACTION_STYLE[f];
            const active = filter===f;
            return (
              <button key={f} onClick={()=>setFilter(f)}
                className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full transition-all"
                style={{background:active?(s?s.color:"#111827"):"#f3f4f6", color:active?"white":"#6b7280"}}>
                {f==="전체"?"전체":s.icon+" "+f}
              </button>
            );
          })}
          <div className="w-px bg-gray-200 shrink-0 mx-0.5"/>
          <button onClick={()=>setUserFilter("전체")}
            className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full transition-all"
            style={{background:userFilter==="전체"?"#6b7280":"#f3f4f6", color:userFilter==="전체"?"white":"#6b7280"}}>
            전체
          </button>
          {users.map(u=>(
            <button key={u} onClick={()=>setUserFilter(userFilter===u?"전체":u)}
              className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full transition-all"
              style={{background:userFilter===u?"#7c3aed":"#f3f4f6", color:userFilter===u?"white":"#6b7280"}}>
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      <div className="px-4 py-4 flex flex-col gap-5">
        {filtered.length===0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-sm font-bold">해당 내역이 없습니다</p>
          </div>
        ) : groupedDates.map(date=>(
          <div key={date}>
            <div className="flex items-center gap-3 mb-3">
              <span className="text-xs font-bold text-gray-700">{dateLabel(date)}</span>
              <div className="flex-1 h-px bg-gray-200"/>
              <span className="text-xs text-gray-400">{grouped[date].length}건</span>
            </div>
            <div className="flex flex-col gap-2">
              {grouped[date].map(log=>{
                const s = ACTION_STYLE[log.action]||ACTION_STYLE["등록"];
                const cal = cals?.find(c=>c.id===log.calId);
                return (
                  <div key={log.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3 shadow-sm">
                    <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg shrink-0"
                      style={{background:s.bg}}>{s.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:s.bg,color:s.color}}>{log.action}</span>
                        {cal && <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:cal.color+"22",color:cal.color}}>{cal.name}</span>}
                      </div>
                      <p className="text-sm font-bold truncate" style={{color:log.action==="삭제"?"#9ca3af":"#111827",
                        textDecoration:log.action==="삭제"?"line-through":"none"}}>{log.detail}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                        <span className="font-semibold text-gray-600">{typeof log.user==="string"?log.user:log.user?.name||"관리자"}</span>
                        <span>·</span><span>{log.time?.slice(11,16)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 외부 링크 화면 ───────────────────────────────────────────────
export function ExternalLinksScreen() {
  const { links, setCurrentScreen, addLink, deleteLink, updateLink, persistLinkOrder, linkCategories, saveLinkCategories } = useC();
  const [adding, setAdding]     = useState(false);
  const [sorting, setSorting]   = useState(false);
  const [category, setCategory] = useState("전체");
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl]     = useState("");
  const [newEmoji, setNewEmoji] = useState("🔗");
  const [newCat, setNewCat]     = useState("업무");
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const dragFrom = useRef(null);
  const dragTo   = useRef(null);

  const EMOJIS = ["🔗","📍","📞","💰","🧹","📋","🏢","🚗","📦","🛠️","🌐","📱","💬","📧","🗺️","📸"];
  const customCats = linkCategories;   // Firestore(meta/config)에 영속되는 카테고리 목록
  const [catModal, setCatModal]     = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [editCatIdx, setEditCatIdx] = useState(null);
  const CATEGORIES = ["전체", ...customCats];

  const addCat = () => {
    if(!newCatName.trim()) return;
    if(editCatIdx !== null) {
      saveLinkCategories(customCats.map((c,i)=>i===editCatIdx?newCatName.trim():c));
      setEditCatIdx(null);
    } else {
      saveLinkCategories([...customCats, newCatName.trim()]);
    }
    setNewCatName(""); setCatModal(false);
  };

  const deleteCat = (idx) => {
    const name = customCats[idx];
    saveLinkCategories(customCats.filter((_,i)=>i!==idx));
    // 해당 카테고리 링크들은 "기타"로 이동 (Firestore 반영)
    links.filter(l=>l.category===name).forEach(l=>updateLink({...l, category:"기타"}));
  };

  const filtered = category==="전체" ? links : links.filter(l=>l.category===category);

  const handleAdd = () => {
    if(!newTitle.trim()||!newUrl.trim()) return;
    const url = newUrl.startsWith("http")?newUrl:`https://${newUrl}`;
    addLink({title:newTitle,url,emoji:newEmoji,category:newCat});
    setNewTitle(""); setNewUrl(""); setNewEmoji("🔗"); setNewCat("업무"); setAdding(false);
  };

  // 순서 변경: 배열을 재정렬해 order를 다시 매겨 Firestore에 저장
  const moveUp   = (id) => { const a=[...links],i=a.findIndex(l=>l.id===id); if(i<=0)return; [a[i-1],a[i]]=[a[i],a[i-1]]; persistLinkOrder(a); };
  const moveDown = (id) => { const a=[...links],i=a.findIndex(l=>l.id===id); if(i<0||i>=a.length-1)return; [a[i],a[i+1]]=[a[i+1],a[i]]; persistLinkOrder(a); };

  const reorder = (fromId,toId) => {
    if(!fromId||!toId||fromId===toId) return;
    const arr=[...links];
    const fi=arr.findIndex(l=>l.id===fromId), ti=arr.findIndex(l=>l.id===toId);
    if(fi<0||ti<0) return;
    const [item]=arr.splice(fi,1); arr.splice(ti,0,item);
    persistLinkOrder(arr);
  };

  const onDragStart=(id)=>{dragFrom.current=id;setDraggingId(id);};
  const onDragOver=(e,id)=>{e.preventDefault();dragTo.current=id;setDragOverId(id);};
  const onDragEnd=()=>{reorder(dragFrom.current,dragTo.current);dragFrom.current=null;dragTo.current=null;setDraggingId(null);setDragOverId(null);};

  // 카테고리 관리 화면
  if(catModal) {
    const moveCat = (idx, dir) => {
      const a = [...customCats], ni = idx + dir;
      if(ni < 0 || ni >= a.length) return;
      [a[idx], a[ni]] = [a[ni], a[idx]];
      saveLinkCategories(a);
    };
    return (
      <div className="flex-1 flex flex-col bg-white min-h-screen">
        <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-gray-100">
          <button onClick={()=>{setCatModal(false);setNewCatName("");setEditCatIdx(null);}}
            className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <h2 className="text-xl font-bold text-gray-900 flex-1">카테고리 관리</h2>
        </div>
        <div className="px-5 py-4 flex flex-col gap-2">
          <p className="text-xs text-gray-400 mb-2">순서 변경, 추가/수정/삭제할 수 있어요.</p>
          {customCats.map((cat, idx) => (
            <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-2xl px-4 py-3">
              <div className="flex flex-col gap-0.5 shrink-0 mr-1">
                <button onClick={() => moveCat(idx, -1)}
                  className="border-none bg-transparent cursor-pointer leading-none text-sm"
                  style={{color: idx===0?"#d1d5db":"#6b7280"}}>▲</button>
                <button onClick={() => moveCat(idx, 1)}
                  className="border-none bg-transparent cursor-pointer leading-none text-sm"
                  style={{color: idx===customCats.length-1?"#d1d5db":"#6b7280"}}>▼</button>
              </div>
              <span className="flex-1 text-sm font-bold text-gray-800">{cat}</span>
              <button onClick={() => {setEditCatIdx(idx); setNewCatName(cat);}}
                className="text-xs font-bold text-blue-500 border-none bg-transparent cursor-pointer px-2">수정</button>
              <button onClick={() => deleteCat(idx)}
                className="text-xs font-bold text-red-400 border-none bg-transparent cursor-pointer px-2">삭제</button>
            </div>
          ))}
          <div className="h-px bg-gray-100 my-2"/>
          <div className="flex gap-2">
            <input placeholder={editCatIdx!==null?"카테고리 이름 수정":"새 카테고리 이름"}
              value={newCatName} onChange={e=>setNewCatName(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&addCat()}
              className="flex-1 px-4 py-3 rounded-2xl text-sm outline-none bg-gray-50 border border-gray-200"/>
            <button onClick={addCat}
              className="px-5 py-3 rounded-2xl text-white text-sm font-bold border-none cursor-pointer"
              style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
              {editCatIdx!==null?"수정":"추가"}
            </button>
          </div>
          {editCatIdx!==null && (
            <button onClick={()=>{setEditCatIdx(null);setNewCatName("");}}
              className="text-sm text-gray-400 text-center border-none bg-transparent cursor-pointer">취소</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">외부 링크</h2>
            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
              자주 쓰는 링크 모음
              <button onClick={()=>setCatModal(true)}
                className="ml-2 text-xs font-bold text-blue-500 border-none bg-transparent cursor-pointer">
                카테고리 관리
              </button>
            </p>
          </div>
          <div className="flex gap-2 items-center">
            {!adding && (
              <button onClick={()=>setSorting(p=>!p)}
                className="text-sm font-bold px-3 py-2 rounded-xl transition-all"
                style={{background:sorting?"#1a56db":"#f3f4f6", color:sorting?"white":"#374151"}}>
                {sorting?"✅ 완료":"↕ 순서"}
              </button>
            )}
            {!sorting && (
              <button onClick={()=>setAdding(p=>!p)}
                className="w-10 h-10 rounded-xl flex items-center justify-center text-xl transition-all"
                style={{background:adding?"#111827":"#eff6ff", color:adding?"white":"#1a56db"}}>
                {adding?"✕":"+"}
              </button>
            )}
            <button onClick={()=>setCurrentScreen("calendar")} className="p-2 rounded-full hover:bg-gray-100">
              <X size={22} className="text-gray-500"/>
            </button>
          </div>
        </div>
        {!sorting && (
          <div className="flex gap-2 pb-3 overflow-x-auto">
            {CATEGORIES.map(c=>(
              <button key={c} onClick={()=>setCategory(c)}
                className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all"
                style={{background:category===c?"#111827":"#f3f4f6", color:category===c?"white":"#6b7280"}}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        {/* 추가 폼 */}
        {adding && (
          <div className="bg-white rounded-2xl border border-blue-100 p-5 shadow-sm">
            <p className="text-xs font-bold text-blue-500 mb-4 uppercase tracking-wide">새 링크 추가</p>
            <div className="flex gap-2 flex-wrap mb-4">
              {EMOJIS.map(e=>(
                <button key={e} onClick={()=>setNewEmoji(e)}
                  className="w-9 h-9 rounded-xl text-lg flex items-center justify-center transition-all"
                  style={{background:newEmoji===e?"#1a56db":"#f3f4f6"}}>
                  {e}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mb-3">
              {CATEGORIES.filter(c=>c!=="전체").map(c=>(
                <button key={c} onClick={()=>setNewCat(c)}
                  className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
                  style={{background:newCat===c?"#1a56db":"#f3f4f6", color:newCat===c?"white":"#6b7280"}}>
                  {c}
                </button>
              ))}
            </div>
            <input placeholder="링크 이름" value={newTitle} onChange={e=>setNewTitle(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none mb-2 bg-gray-50"/>
            <input placeholder="URL (예: naver.com)" value={newUrl} onChange={e=>setNewUrl(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none mb-4 bg-gray-50"/>
            <div className="flex gap-2">
              <button onClick={()=>setAdding(false)}
                className="flex-1 py-3 rounded-xl text-sm font-bold bg-gray-100 text-gray-600">취소</button>
              <button onClick={handleAdd}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white transition-all"
                style={{background:newTitle.trim()&&newUrl.trim()?"#1a56db":"#d1d5db"}}>추가</button>
            </div>
          </div>
        )}

        {/* 링크 목록 */}
        {(sorting?links:filtered).length===0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">🔗</div>
            <p className="text-sm font-bold">링크가 없습니다</p>
          </div>
        ) : (sorting?links:filtered).map((l,idx)=>(
          <div key={l.id}
            data-lid={l.id}
            draggable={sorting}
            onDragStart={sorting?()=>onDragStart(l.id):undefined}
            onDragOver={sorting?e=>onDragOver(e,l.id):undefined}
            onDragEnd={sorting?onDragEnd:undefined}
            className="bg-white rounded-2xl flex items-center overflow-hidden transition-all"
            style={{border:`1.5px solid ${sorting&&dragOverId===l.id?"#1a56db":"#f3f4f6"}`,
              opacity:sorting&&draggingId===l.id?0.4:1,
              boxShadow:sorting&&dragOverId===l.id?"0 0 0 3px rgba(26,86,219,.15)":"0 1px 4px rgba(0,0,0,.05)"}}>
            {/* 드래그 핸들 */}
            {sorting && (
              <div className="w-12 self-stretch flex items-center justify-center shrink-0 bg-gray-50 border-r border-gray-100 cursor-grab">
                <svg width="16" height="22" viewBox="0 0 16 22" fill="none">
                  <circle cx="5" cy="5"  r="2" fill="#d1d5db"/>
                  <circle cx="11" cy="5" r="2" fill="#d1d5db"/>
                  <circle cx="5" cy="11" r="2" fill="#d1d5db"/>
                  <circle cx="11" cy="11" r="2" fill="#d1d5db"/>
                  <circle cx="5" cy="17" r="2" fill="#d1d5db"/>
                  <circle cx="11" cy="17" r="2" fill="#d1d5db"/>
                </svg>
              </div>
            )}
            {/* 링크 본문 */}
            {sorting ? (
              <div className="flex-1 flex items-center gap-3 p-4 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-gray-100 flex items-center justify-center text-xl shrink-0">{l.emoji||"🔗"}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{l.title}</p>
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{l.category}</span>
                </div>
              </div>
            ) : (
              <a href={l.url} target="_blank" rel="noopener noreferrer"
                className="flex-1 flex items-center gap-3 p-4 min-w-0 no-underline">
                <div className="w-11 h-11 rounded-2xl bg-gray-100 flex items-center justify-center text-xl shrink-0">{l.emoji||"🔗"}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{l.title}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 shrink-0">{l.category}</span>
                    <span className="text-xs text-gray-300 truncate">{l.url.replace(/https?:\/\//,"")}</span>
                  </div>
                </div>
                <ChevronLeft size={16} className="text-gray-300 rotate-180 shrink-0"/>
              </a>
            )}
            {/* 순서변경: 위아래 버튼 */}
            {sorting && (
              <div className="flex flex-col gap-1 p-2 shrink-0">
                <button onClick={()=>moveUp(l.id)} disabled={links.findIndex(x=>x.id===l.id)===0}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-all"
                  style={{background:links.findIndex(x=>x.id===l.id)===0?"#f9fafb":"#f3f4f6",
                    color:links.findIndex(x=>x.id===l.id)===0?"#d1d5db":"#374151"}}>↑</button>
                <button onClick={()=>moveDown(l.id)} disabled={links.findIndex(x=>x.id===l.id)===links.length-1}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold transition-all"
                  style={{background:links.findIndex(x=>x.id===l.id)===links.length-1?"#f9fafb":"#f3f4f6",
                    color:links.findIndex(x=>x.id===l.id)===links.length-1?"#d1d5db":"#374151"}}>↓</button>
              </div>
            )}
            {/* 일반: 삭제 버튼 */}
            {!sorting && (
              <button onClick={()=>deleteLink(l.id)}
                className="w-11 self-stretch border-l border-gray-100 bg-gray-50 flex items-center justify-center text-gray-300 hover:text-red-400 shrink-0 text-lg">
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}



// ── 회사 정보 설정 모달 ───────────────────────────────────────────────
export function CompanySettingsModal() {
  const { companySettingsModal, setCompanySettingsModal, currentUser, companyDoc,
          titleRule, typeKeywords, saveTitleRule } = useC();
  const [tab, setTab]             = useState("info");
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl]     = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [loading, setLoading]     = useState(false);
  const [localRule, setLocalRule] = useState(DEFAULT_TITLE_RULE);
  const [localKw, setLocalKw]     = useState(DEFAULT_TYPE_KEYWORDS);
  const [newKw, setNewKw]         = useState("");

  const ALL_TOKENS = Object.keys(TITLE_TOKEN_LABELS);

  useEffect(() => {
    if (companySettingsModal) {
      setCompanyName(companyDoc?.name ?? currentUser?.companyName ?? "");
      setLogoUrl(companyDoc?.logoUrl ?? currentUser?.companyLogoUrl ?? "");
      setTab("info");
      setLocalRule(titleRule || DEFAULT_TITLE_RULE);
      setLocalKw(typeKeywords || DEFAULT_TYPE_KEYWORDS);
    }
  }, [companySettingsModal]);

  if (!companySettingsModal) return null;
  const close = () => setCompanySettingsModal(false);

  // 이미지를 Firestore에 base64로 직접 저장하면 문서 1MB 제한에 걸려 저장이 실패하므로,
  // Storage에 올리고 짧은 다운로드 URL만 Firestore에 저장한다.
  // 원본 사진을 그대로 올리면 몇 MB짜리라 접속할 때마다 로고가 늦게 떠서,
  // 업로드 전에 256px로 리사이즈하고(수십 KB) 브라우저가 캐시하도록 헤더도 지정한다.
  const resizeLogo = (file, maxSize = 256) => new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("이미지 변환 실패")), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("이미지를 읽을 수 없습니다")); };
    img.src = objectUrl;
  });

  const handleLogoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setLogoUploading(true);
    try {
      const blob = await resizeLogo(file);
      const path = `companies/${currentUser.companyId}/logo/${Date.now()}.png`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, blob, { cacheControl: "public,max-age=31536000,immutable" });
      const url = await getDownloadURL(sRef);
      setLogoUrl(url);
    } catch (err) {
      alert("로고 업로드 실패: " + err.message);
    } finally {
      setLogoUploading(false);
      e.target.value = "";
    }
  };

  const handleSaveInfo = async () => {
    if (!companyName.trim()) return alert("회사명을 입력해주세요.");
    setLoading(true);
    try {
      await updateDoc(doc(db, "companies", currentUser.companyId), { name: companyName, logoUrl });
      // admins 문서에도 동기화 — 다음 로그인 시 이 값으로 세션이 채워짐(회사 문서를 직접 못 읽는 경로 대비)
      await updateDoc(doc(db, "admins", currentUser.uid), { companyName, companyLogoUrl: logoUrl });
      try {
        const saved = JSON.parse(localStorage.getItem("loginUser") || "{}");
        localStorage.setItem("loginUser", JSON.stringify({ ...saved, companyName, companyLogoUrl: logoUrl }));
      } catch {}
      // companyDoc은 실시간 리스너로 화면에 바로 반영되므로 새로고침 불필요
      alert("저장됐습니다."); close();
    } catch(e) { alert("오류: " + e.message); } finally { setLoading(false); }
  };

  const toggleToken = (token) => {
    setLocalRule(r => r.includes(token) ? r.filter(t => t !== token) : [...r, token]);
  };
  const moveToken = (token, dir) => {
    setLocalRule(r => {
      const i = r.indexOf(token);
      if (i < 0) return r;
      const next = [...r];
      const to = i + dir;
      if (to < 0 || to >= next.length) return r;
      [next[i], next[to]] = [next[to], next[i]];
      return next;
    });
  };

  // 제목 미리보기
  const previewText = "6월 25일 오전 10시에 은평구 역촌동 15평 입주청소 일정이 있어\n방2화1 이효림 010-1234-5678";
  const previewTitle = parseEventText(previewText, localRule, localKw).title || "(제목 없음)";

  return (
    <div className="absolute inset-0 z-[100] flex flex-col bg-white">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button onClick={close}><X size={22} className="text-gray-600"/></button>
        <h2 className="font-bold text-base">회사 설정</h2>
        <div className="w-6"/>
      </div>

      {/* 탭 */}
      <div className="flex border-b border-gray-100">
        {[{key:"info",label:"회사 정보"},{key:"title",label:"제목 규칙"}].map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)}
            className={`flex-1 py-3 text-sm font-bold relative ${tab===t.key?"text-blue-600":"text-gray-400"}`}>
            {t.label}
            {tab===t.key && <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-blue-600 rounded-full"/>}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── 회사 정보 탭 ── */}
        {tab === "info" && (
          <div className="p-5 flex flex-col items-center">
            <label className={`w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-xl overflow-hidden border border-gray-200 ${logoUploading ? "cursor-wait opacity-60" : "cursor-pointer"}`}
              style={{background: logoUrl ? "#fff" : "linear-gradient(135deg,#1a56db,#2563eb)"}}>
              {logoUploading
                ? <div className="w-6 h-6 rounded-full border-2 border-gray-300 border-t-blue-600 animate-spin"/>
                : (logoUrl ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover"/> : "🏢")}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} disabled={logoUploading}/>
            </label>
            <p className="text-xs text-gray-400 -mt-4 mb-6 text-center">{logoUploading ? "업로드 중..." : "로고 클릭하여 변경 (선택)"}</p>
            <div className="w-full mb-6">
              <label className="block text-xs font-bold text-gray-500 mb-1">회사명</label>
              <input value={companyName} onChange={e=>setCompanyName(e.target.value)}
                className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm font-bold outline-none focus:border-blue-500"/>
            </div>
            <button onClick={handleSaveInfo} disabled={loading||logoUploading||!companyName.trim()}
              className="w-full py-4 rounded-xl text-white font-bold"
              style={{background:companyName.trim()?"linear-gradient(135deg,#1a56db,#2563eb)":"#e5e7eb"}}>
              {loading?"저장 중...":"저장"}
            </button>
          </div>
        )}

        {/* ── 제목 규칙 탭 ── */}
        {tab === "title" && (
          <div className="p-4 flex flex-col gap-5">
            {/* 미리보기 */}
            <div className="bg-blue-50 rounded-2xl p-4">
              <p className="text-xs font-bold text-blue-500 mb-1">미리보기</p>
              <p className="text-lg font-bold text-gray-900">{previewTitle}</p>
              <p className="text-xs text-gray-400 mt-1">샘플: "6월 25일 오전 역촌동 15평 입주청소"</p>
            </div>

            {/* 토큰 선택 및 순서 */}
            <div>
              <p className="text-xs font-bold text-gray-500 mb-3">제목에 포함할 항목 (순서대로 조합)</p>
              {/* 활성 토큰 — 순서 변경 가능 */}
              <div className="flex flex-col gap-2 mb-3">
                {localRule.map((token, i) => (
                  <div key={token} className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
                    <div className="flex flex-col">
                      <button onClick={()=>moveToken(token,-1)} disabled={i===0}
                        className="text-[10px] text-gray-400 hover:text-blue-600 disabled:opacity-20">▲</button>
                      <button onClick={()=>moveToken(token,1)} disabled={i===localRule.length-1}
                        className="text-[10px] text-gray-400 hover:text-blue-600 disabled:opacity-20">▼</button>
                    </div>
                    <div className="flex-1">
                      <span className="text-sm font-bold text-blue-700">{TITLE_TOKEN_LABELS[token]?.label}</span>
                      <span className="text-xs text-blue-400 ml-1.5">{TITLE_TOKEN_LABELS[token]?.desc}</span>
                    </div>
                    <button onClick={()=>toggleToken(token)}
                      className="text-xs text-red-400 hover:text-red-600 px-2 py-1 hover:bg-red-50 rounded-lg">제거</button>
                  </div>
                ))}
              </div>
              {/* 비활성 토큰 — 추가 가능 */}
              <p className="text-xs text-gray-400 mb-2">추가 가능한 항목</p>
              <div className="flex flex-wrap gap-2">
                {ALL_TOKENS.filter(t => !localRule.includes(t)).map(token => (
                  <button key={token} onClick={()=>toggleToken(token)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-gray-200 text-xs text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all">
                    + {TITLE_TOKEN_LABELS[token]?.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 청소 종류 키워드 */}
            <div>
              <p className="text-xs font-bold text-gray-500 mb-1">청소 종류 키워드
                <span className="font-normal text-gray-400 ml-1">(텍스트에서 인식할 단어)</span>
              </p>
              <div className="flex flex-wrap gap-2 mb-2">
                {localKw.map((kw, i) => (
                  <div key={kw} className="flex items-center gap-1 bg-gray-100 rounded-full px-3 py-1">
                    <span className="text-xs text-gray-700">{kw}</span>
                    <button onClick={()=>setLocalKw(k=>k.filter((_,j)=>j!==i))}
                      className="text-gray-400 hover:text-red-500"><X size={11}/></button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <input value={newKw} onChange={e=>setNewKw(e.target.value)}
                  onKeyDown={e=>{ if(e.key==="Enter"&&newKw.trim()){ setLocalKw(k=>[...k,newKw.trim()]); setNewKw(""); }}}
                  placeholder="예: 줄눈청소"
                  className="flex-1 text-sm px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 outline-none focus:border-blue-400"/>
                <button onClick={()=>{ if(newKw.trim()){ setLocalKw(k=>[...k,newKw.trim()]); setNewKw(""); }}}
                  className="px-4 py-2 bg-blue-600 text-white text-sm font-bold rounded-xl">추가</button>
              </div>
            </div>

            {/* 저장 */}
            <button onClick={()=>{ saveTitleRule(localRule, localKw); alert("저장됐습니다!"); }}
              className="w-full py-4 rounded-xl text-white font-bold bg-blue-600">
              규칙 저장
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

