import {
  useState, useCallback,
  useMemo, useRef, useEffect
} from "react";
import {
  Search, Plus, X, MapPin, RotateCcw, Clock,
  Calendar, AlignLeft, ChevronDown, ChevronLeft,
  ChevronRight, Menu, Settings, User, Edit3, Trash2,
  PieChart, Bell, History, ExternalLink,
  CheckSquare, Download, Check, Eye
} from "lucide-react";

import { db, functions, storage } from "../../firebase";
import { enablePush } from "../../fcm";
import { collection, doc, getDoc, getDocs, updateDoc, query, where } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";

import { HOLIDAYS, WD, fmt, pd, diff, add, fmtTime } from "../../lib/dateTime";
import { CALS, calById, REGULAR_CAL_ID } from "../../lib/calendars";
import { REPEAT_OPTS } from "../../lib/repeat";
import { getReportStatus } from "../../lib/reports";
import { fmtPhone } from "../../lib/phone";
import { parseEventText } from "../../lib/eventTextParser";
import { isSuperAdmin, isAdminStaff, isLeaderOf, isMemberOf, myTeamNames, hasLeadershipSomewhere, teamsLabel } from "../../lib/membership";
import { useC } from "../../context/AppContext";
import { ReportStatusBadge } from "../../components/shared/ReportStatusBadge";
import { MapLinkButton } from "../../components/shared/MapLinkButton";
import { openLightbox } from "../../components/shared/PhotoLightbox";
import { askRecurringScope } from "../../components/shared/RecurringScopeSheet";
import { WheelPicker, RepeatToggleButton, RepeatPanel } from "../../components/shared/RepeatPicker";
import { RegularCleaningDetailBody } from "../regular-cleaning/RegularCleaningDetailBody";

// ── 연속 일정 레이아웃 알고리즘 ──────────────────────────────────
export function buildLayout(events, wk) {
  const wSet=new Set(wk);
  const rel=[...events]
    .filter(ev=>ev.start<=wk[6]&&(ev.end||ev.start)>=wk[0])
    .sort((a,b)=>{
      const da=diff(a.start,a.end||a.start),db=diff(b.start,b.end||b.start);
      return db!==da?db-da:a.start.localeCompare(b.start);
    });
  const lanes=[]; const map={}; wk.forEach(d=>(map[d]=[]));
  rel.forEach(ev=>{
    const cs=ev.start>wk[0]?ev.start:wk[0];
    const ce=(ev.end||ev.start)<wk[6]?(ev.end||ev.start):wk[6];
    const occ=[]; let c=cs;
    while(c<=ce){if(wSet.has(c))occ.push(c);c=add(c,1);}
    if(!occ.length)return;
    const isMulti=diff(ev.start,ev.end||ev.start)>0;
    let lane=0;
    while(true){
      if(!lanes[lane]){lanes[lane]=new Set();break;}
      if(!occ.some(d=>lanes[lane].has(d)))break;
      lane++;
    }
    occ.forEach(d=>lanes[lane].add(d));
    occ.forEach((d,i)=>{
      const isS=d===ev.start||i===0, isE=d===(ev.end||ev.start)||i===occ.length-1;
      map[d].push({id:ev.id,isS,isE,isMulti,lane,ev});
    });
  });
  Object.keys(map).forEach(d=>map[d].sort((a,b)=>a.lane-b.lane));
  return map;
}

// ── 이벤트 텍스트 바 (MODE 0 전용) ───────────────────────────────
export function TextBar({ item, onClick }) {
  const {ev,isS,isE,isMulti}=item;
  const { cals } = useC();
  const c = cals.find(c=>c.id===ev.calId) || { color:"#9ca3af" };
  return (
    <div onClick={e=>{e.stopPropagation();onClick(ev);}} title={ev.title}
      style={{
        backgroundColor: c.color,
        color: "#fff",
        borderRadius:`${isS?"3px":"0"} ${isE?"3px":"0"} ${isE?"3px":"0"} ${isS?"3px":"0"}`,
        marginLeft: isMulti&&!isS ? 0 : 1,
        marginRight: isMulti&&!isE ? 0 : 1,
        paddingLeft: isMulti&&!isS ? 2 : 3,
      }}
      className="text-[8px] leading-none py-[1px] pr-0.5 mb-[1px] overflow-hidden whitespace-nowrap cursor-pointer select-none font-medium">
      {isS ? ev.title : ""}
    </div>
  );
}

// ── MODE 0: 풀 월간 뷰 (이벤트 바 표시) ──────────────────────────
const MAX_BARS_FULL = 4;

export function FullMonthCell({ ds, isCm, items, onDate, onEvt }) {
  const [pressed, setPressed] = useState(false);
  const today=fmt(new Date()), isToday=ds===today;
  const d=pd(ds), dow=d.getDay();
  const isHol=!!HOLIDAYS[ds], isSun=dow===0, isSat=dow===6;
  let nc="text-gray-800";
  if(!isCm)             nc="text-gray-400";
  else if(isSun||isHol) nc="text-red-500";
  else if(isSat)        nc="text-blue-500";
  const vis=items.slice(0,MAX_BARS_FULL), ov=items.length-MAX_BARS_FULL;

  return (
    <div
      onClick={()=>onDate(ds)}
      onTouchStart={()=>setPressed(true)}
      onTouchEnd={()=>{ setPressed(false); onDate(ds); }}
      onMouseDown={()=>setPressed(true)}
      onMouseUp={()=>setPressed(false)}
      onMouseLeave={()=>setPressed(false)}
      style={{
        transform: pressed ? "scale(0.93)" : "scale(1)",
        transition: "transform 0.12s cubic-bezier(.36,.07,.19,.97)",
        backgroundColor: pressed ? "#f0f4ff" : "transparent",
        opacity: isCm ? 1 : 0.35
      }}
      className="min-h-[100px] pt-1 pb-1 border-b border-r border-gray-100 cursor-pointer">
      {/* 날짜 */}
      <div className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full mx-auto mb-0.5
        ${isToday?"bg-gray-900 text-white":`${nc}`}`}>
        {d.getDate()}
      </div>
      {/* 바 */}
      {vis.map(item=><TextBar key={`${item.id}-${ds}`} item={item} onClick={onEvt}/>)}
      {ov>0&&<div className="text-[9px] text-gray-400 pl-1">+{ov}</div>}
    </div>
  );
}

// ── MODE 1: 도트 그리드 셀 ───────────────────────────────────────
export function DotCell({ ds, isCm, dots, onDate, selDate }) {
  const today=fmt(new Date()), isToday=ds===today, isSel=ds===selDate;
  const d=pd(ds), dow=d.getDay();
  const isHol=!!HOLIDAYS[ds], isSun=dow===0, isSat=dow===6;

  let nc = !isCm ? "#d1d5db"
         : (isSun||isHol) ? "#ef4444"
         : isSat ? "#3b82f6"
         : "#111827";

  return (
    <button onClick={()=>onDate(ds)}
      className="flex flex-col items-center justify-start pt-1"
      style={{minHeight:"46px", opacity: isCm ? 1 : 0.35}}>
      {/* 날짜 숫자 */}
      <span style={{
        width:28, height:28,
        display:"flex", alignItems:"center", justifyContent:"center",
        borderRadius:"50%",
        fontSize:15,
        fontWeight: isToday||isSel ? 700 : 500,
        background: isToday ? "#1a1a1a" : "transparent",
        color: isToday ? "#fff" : nc,
        outline: isSel&&!isToday ? "1.5px solid #aaa" : "none",
        lineHeight:1,
      }}>
        {d.getDate()}
      </span>
      {/* 도트 — 캘린더별 색상, 최대 5개 */}
      <div style={{
        display:"flex", gap:2, marginTop:2,
        justifyContent:"center", minHeight:6,
      }}>
        {isCm && dots.slice(0,5).map((color,i)=>(
          <span key={i} style={{
            width:4, height:4, borderRadius:"50%",
            backgroundColor:color, flexShrink:0,
            display:"inline-block",
          }}/>
        ))}
      </div>
    </button>
  );
}

// ── 달력 공통 날짜 배열 ───────────────────────────────────────────
export function useDates(current) {
  const y=current.getFullYear(), m=current.getMonth();
  return useMemo(()=>{
    const first=new Date(y,m,1), last=new Date(y,m+1,0), dow=first.getDay(), ds=[];
    for(let i=dow-1;i>=0;i--) ds.push({s:fmt(new Date(y,m,-i)),cm:false});
    for(let d=1;d<=last.getDate();d++) ds.push({s:fmt(new Date(y,m,d)),cm:true});
    const remainder = ds.length % 7;
    if (remainder > 0) {
      const daysToAdd = 7 - remainder;
      for(let d=1;d<=daysToAdd;d++) ds.push({s:fmt(new Date(y,m+1,d)),cm:false});
    }
    const weeks=[];
    for(let i=0;i<ds.length;i+=7) weeks.push(ds.slice(i,i+7));
    return weeks;
  },[y,m]);
}

// ── 시간표 시트 내용 ──────────────────────────────────────────────
export function ScheduleList({ selDate, compact=false }) {
  const { visibleEvents, setDetEv, setSelDate, setCurrent, setSheetMode, openModal, currentUser, cals, reports, setFieldReportEv } = useC();
  const calByIdLocal = id => cals.find(c=>c.id===id) || { id:"unassigned", label:"미배정", name:"미배정", color:"#9ca3af", checked:true };
  // 청소 진행도 텍스트 컬러 — 완료보고(reports) 플로우를 타는 입주청소 등 일반 일정에만 적용.
  // 정기청소(source:"regular")는 출근확인 방식이라 이 진행도 개념이 없어 제외.
  const progressTextColor = (ev) => {
    if (ev.source === "regular") return undefined;
    const status = getReportStatus(ev.id, reports);
    if (status === "중") return "#2563eb";
    if (status === "완료") return "#16a34a";
    return undefined; // "전" — 기존 검정 유지
  };
  // 일정 등록은 사장/관리팀·영업팀만 — 현장팀(청소팀) 팀장은 등록 불가, 보고만 가능
  const canAdd = isSuperAdmin(currentUser) || isAdminStaff(currentUser);
  const handleCardClick = async (ev) => {
    // 청소 시작까지 진행된 일정이면 상세보기를 건너뛰고 바로 이어서(청소 완료 보고) 열기 —
    // 실제로 이 일정의 담당팀 팀장에게만 해당(다른 팀 팀장이면 대상 아님). 사장/관리팀·영업팀은
    // 청소 완료 보고를 하지 않으므로 평소처럼 상세보기/수정 화면으로 감(청소 상태는 배지로만 확인)
    const evTeam = calById(ev.calId)?.label;
    const canContinue = isLeaderOf(currentUser, evTeam) && !["관리팀","영업팀"].includes(evTeam);
    if (canContinue && reports.some(r => r.eventId === ev.id && r.status === "진행중")) {
      setFieldReportEv(ev);
      return;
    }
    // 정기청소 배정에서 자동 생성된 일정은 배정 관리 화면에서만 바꿀 수 있어 항상 상세보기로만 감
    if (!isSuperAdmin(currentUser) || ev.source === "regular") { setDetEv(ev); return; }
    if (ev._recurring) {
      const scope = await askRecurringScope(ev, "edit");
      if (!scope) return;
      openModal(null, ev.id, scope, ev);
    } else {
      openModal(null, ev.id);
    }
  };
  const d=pd(selDate), dow=d.getDay();
  const DAYS=["일","월","화","수","목","금","토"];
  const isHol=!!HOLIDAYS[selDate];

  // 정기청소는 배정마다 이벤트가 따로 생성되므로, 같은 현장에 여러 명이 배정된 경우
  // 이 날짜 목록에서는 하나로 합쳐서 "N명"으로 표시한다 (상세보기는 원래대로 현장 전체 배정을 보여줌)
  const mergeRegularBySite = (evts) => {
    const siteIdx = {};
    const result = [];
    evts.forEach(ev => {
      if (ev.source === "regular" && ev.siteId) {
        const idx = siteIdx[ev.siteId];
        if (idx !== undefined) {
          const existing = result[idx];
          result[idx] = { ...existing, _mergedCount: (existing._mergedCount || 1) + 1 };
          return;
        }
        siteIdx[ev.siteId] = result.length;
      }
      result.push(ev);
    });
    return result;
  };

  const dayEvts = mergeRegularBySite(visibleEvents
    .filter(ev=>ev.start<=selDate&&(ev.end||ev.start)>=selDate)
    .sort((a,b)=>{
      if(a.allDay!==b.allDay) return a.allDay?-1:1;
      return (a.startTime||"").localeCompare(b.startTime||"");
    }));

  const allDayEvts=dayEvts.filter(e=>e.allDay);
  const timedEvts =dayEvts.filter(e=>!e.allDay);

  // 시간 키별 그룹핑
  const grouped = {};
  timedEvts.forEach(ev=>{
    const k=ev.startTime||"00:00";
    if(!grouped[k]) grouped[k]=[];
    grouped[k].push(ev);
  });
  const timeKeys=Object.keys(grouped).sort();

  const headerColor=(dow===0||isHol)?"text-red-500":dow===6?"text-blue-500":"text-gray-900";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 날짜 헤더 바 */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          {/* 이전/다음 날 화살표 (MODE 2) */}
          <button onClick={()=>{
            const prev=add(selDate,-1); setSelDate(prev);
            const pd2=pd(prev); setCurrent(new Date(pd2.getFullYear(),pd2.getMonth(),1));
          }} className="p-1 rounded-full hover:bg-gray-100 text-gray-400">
            <ChevronLeft size={15}/>
          </button>
          <div>
            <span className={`text-base font-bold ${headerColor}`}>
              {d.getMonth()+1}. {d.getDate()}. {DAYS[dow]}
            </span>
            <span className="text-xs text-gray-400 ml-2">음력 5. 1.</span>
          </div>
          <button onClick={()=>{
            const next=add(selDate,1); setSelDate(next);
            const nd=pd(next); setCurrent(new Date(nd.getFullYear(),nd.getMonth(),1));
          }} className="p-1 rounded-full hover:bg-gray-100 text-gray-400">
            <ChevronRight size={15}/>
          </button>
        </div>
        <div className="w-10"/>
      </div>

      {/* 이벤트 목록 */}
      <div className="flex-1 overflow-y-auto pb-16">
        {/* 종일 */}
        {allDayEvts.map(ev=>{
          const c=calByIdLocal(ev.calId);
          const isMulti=diff(ev.start,ev.end||ev.start)>0;
          return(
            <div key={ev.id}
              onClick={()=>handleCardClick(ev)}
              className="flex items-center px-4 py-1.5 border-b border-gray-50 cursor-pointer">
              {isMulti
                ? <span className="text-sm px-2 py-0.5 rounded text-white font-medium mr-2 truncate max-w-[80%]"
                    style={{background:c.color}}>{ev.title}{ev._mergedCount ? ` (${ev._mergedCount}명)` : ""}</span>
                : <>
                    <div className="w-1 h-5 rounded-full mr-3" style={{background:c.color}}/>
                    <span className="text-sm text-gray-800" style={{color: progressTextColor(ev)}}>{ev.title}{ev._mergedCount ? ` (${ev._mergedCount}명)` : ""}</span>
                  </>
              }
            </div>
          );
        })}

        {/* 시간대 이벤트 — 네이버 캘린더 정확히 동일
            왼쪽: 시작시간(위) + 종료시간(아래)
            중앙: 컬러 바
            오른쪽: 제목 + 장소
        */}
        {timeKeys.map(tk=>(
          <div key={tk}>
            {grouped[tk].map((ev)=>{
              const c=calByIdLocal(ev.calId);
              return(
                <div key={ev.id} onClick={()=>handleCardClick(ev)}
                  className="flex items-stretch px-4 py-3 border-b border-gray-50 cursor-pointer active:bg-gray-50">
                  {/* 시간 컬럼 — 시작위 / 종료아래 */}
                  <div className="w-[60px] shrink-0 flex flex-col justify-between mr-4">
                    <span className="text-xs font-medium text-gray-500 whitespace-nowrap leading-none">
                      {fmtTime(tk)}
                    </span>
                    {ev.endTime&&(
                      <span className="text-xs text-gray-400 whitespace-nowrap leading-none">
                        {fmtTime(ev.endTime)}
                      </span>
                    )}
                  </div>
                  {/* 컬러 바 */}
                  <div className="w-[3px] rounded-full shrink-0 mr-4"
                    style={{background:c.color, minHeight:"44px"}}/>
                  {/* 제목 + 장소 + 썸네일 */}
                  <div className="flex-1 flex flex-col justify-center min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-sm font-semibold text-gray-900 leading-snug" style={{color: progressTextColor(ev)}}>{ev.title}{ev._mergedCount ? ` (${ev._mergedCount}명)` : ""}</p>
                      {(ev.photos||[]).length > 0 && (
                        <span className="text-xs text-gray-400 shrink-0 flex items-center gap-0.5">
                          📎{(ev.photos||[]).length}
                        </span>
                      )}
                    </div>
                    {ev.place&&(
                      <p className="text-xs text-gray-400 mt-0.5">{ev.place}</p>
                    )}
                    {(ev.photos||[]).length > 0 && (
                      <div className="flex gap-1.5 mt-2">
                        {(ev.photos||[]).slice(0,4).map((p,i)=>(
                          <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden bg-gray-100 shrink-0">
                            <img src={p.url} alt="" className="w-full h-full object-cover"/>
                            {i===3 && (ev.photos||[]).length > 4 && (
                              <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                                <span className="text-white text-xs font-bold">+{(ev.photos||[]).length-4}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        {dayEvts.length===0&&(
          <div className="flex flex-col items-center justify-center py-10 text-gray-300">
            <Calendar size={36} strokeWidth={1.2}/>
            <p className="text-sm mt-2">일정이 없습니다</p>
            {canAdd && <button onClick={()=>openModal(selDate)} className="mt-3 text-blue-500 text-sm">일정 추가하기</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 범용 스와이프 감지 훅 ────────────────────────────────────────
// 각도 기반 방향 판별:
//   수평각도 > 55도 → 좌우로 판정 (좌우 우선)
//   수직각도 > 55도 → 상하로 판정
//   → 대각선 스와이프에서 좌우/상하 혼용 완전 차단
export function useSwipe({ onUp, onDown, onLeft, onRight,
                    hThreshold=30, vThreshold=30 }) {
  const sx    = useRef(null);
  const sy    = useRef(null);
  const fired = useRef(false);

  const judge = (dx, dy) => {
    if (fired.current) return;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < hThreshold && ady < vThreshold) return;
    const angle = Math.atan2(ady, adx) * 180 / Math.PI;
    if (angle < 40 && adx >= hThreshold) {
      fired.current = true;
      if (dx > 0) onRight?.(); else onLeft?.();
    } else if (angle > 50 && ady >= vThreshold) {
      fired.current = true;
      if (dy > 0) onDown?.(); else onUp?.();
    }
  };

  return {
    onTouchStart: e => {
      sx.current    = e.touches[0].clientX;
      sy.current    = e.touches[0].clientY;
      fired.current = false;
    },
    onTouchMove: e => {
      if (sx.current === null || fired.current) return;
      const dx = e.touches[0].clientX - sx.current;
      const dy = e.touches[0].clientY - sy.current;
      judge(dx, dy);
    },
    onTouchEnd: e => {
      if (sx.current === null) return;
      const dx = e.changedTouches[0].clientX - sx.current;
      const dy = e.changedTouches[0].clientY - sy.current;
      judge(dx, dy);
      sx.current = null; sy.current = null; fired.current = false;
    },
    onTouchCancel: () => {
      sx.current = null; sy.current = null; fired.current = false;
    },
    onMouseDown: e => {
      sx.current = e.clientX; sy.current = e.clientY; fired.current = false;
      const handleMouseMove = ev => {
        if (sx.current === null || fired.current) return;
        judge(ev.clientX - sx.current, ev.clientY - sy.current);
      };
      const handleMouseUp = ev => {
        if (sx.current !== null && !fired.current) {
          judge(ev.clientX - sx.current, ev.clientY - sy.current);
        }
        sx.current = null; sy.current = null; fired.current = false;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
  };
}

// ── 애니메이션 CSS 상수 ──────────────────────────────────────────
export const ANIM_CSS = `
  /* 월 이동: 왼쪽으로 밀리며 다음 달 슬라이드인 */
  @keyframes slideInFromRight {
    from { transform: translateX(100%); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  @keyframes slideInFromLeft {
    from { transform: translateX(-100%); opacity: 0; }
    to   { transform: translateX(0);     opacity: 1; }
  }
  /* 날짜 시트 위아래 전환 */
  @keyframes slideInFromBottom {
    from { transform: translateY(18px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  /* 풀달력 위에서 내려오기 */
  @keyframes slideInFromTop {
    from { transform: translateY(-30px); opacity: 0.5; }
    to   { transform: translateY(0);     opacity: 1;   }
  }
  /* 일정 목록 좌우 날짜 전환 */
  @keyframes listSlideRight {
    from { transform: translateX(40px); opacity: 0; }
    to   { transform: translateX(0);    opacity: 1; }
  }
  @keyframes listSlideLeft {
    from { transform: translateX(-40px); opacity: 0; }
    to   { transform: translateX(0);     opacity: 1; }
  }
  /* 날짜 셀 눌림 효과 */
  .cell-press { transition: transform 0.12s cubic-bezier(.36,.07,.19,.97); }
  .cell-press:active { transform: scale(0.88); }
  /* 모달 slide-up */
  @keyframes modalSlideUp {
    from { transform: translateY(100%); opacity: 0.4; }
    to   { transform: translateY(0);    opacity: 1;   }
  }
  /* 상세 바텀시트 */
  @keyframes sheetUp {
    from { transform: translateY(60px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
`;

export function SlideTransition({ children, slideKey, direction }) {
  const ref        = useRef(null);
  const mountedKey = useRef(slideKey);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (slideKey === mountedKey.current) {
      el.style.transform = "translateX(0)";
      return;
    }

    const startX = direction === "left" ? "100%" : "-100%";
    el.style.transition = "none";
    el.style.transform  = `translateX(${startX})`;

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = "transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94)";
        el.style.transform  = "translateX(0)";
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [slideKey, direction]);

  return (
    <div ref={ref}
      style={{ willChange:"transform", backgroundColor:"#fff" }}
      className="flex flex-col flex-1 overflow-hidden">
      {children}
    </div>
  );
}

export function ListTransition({ children, direction, listKey }) {
  const ref        = useRef(null);
  const mountedKey = useRef(listKey);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (listKey === mountedKey.current) {
      el.style.transform  = "translateX(0)";
      return;
    }

    const startX = direction === "left" ? "100%" : "-100%";
    el.style.transition = "none";
    el.style.transform  = `translateX(${startX})`;

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = "transform 0.26s cubic-bezier(0.25,0.46,0.45,0.94)";
        el.style.transform  = "translateX(0)";
      });
    });

    return () => cancelAnimationFrame(raf);
  }, [listKey, direction]);

  return (
    <div
      ref={ref}
      style={{ backgroundColor:"#fff", willChange:"transform" }}
      className="flex flex-col flex-1 overflow-hidden"
    >
      {children}
    </div>
  );
}

// ── 모드 전환 래퍼 (상하 스와이프) ─────────────────────────────
export function ModeTransition({ children, mode }) {
  const [animKey, setAnimKey] = useState(0);
  const prevMode = useRef(mode);

  useEffect(() => {
    if (mode !== prevMode.current) {
      prevMode.current = mode;
      setAnimKey(k => k + 1);
    }
  }, [mode]);

  return (
    <div key={animKey}
      style={{ animation: "slideInFromBottom 0.25s cubic-bezier(0.25,0.46,0.45,0.94) both" }}
      className="flex flex-col flex-1 overflow-hidden">
      {children}
    </div>
  );
}

// ── 메인 캘린더 뷰 (3-mode + 좌우/상하 스와이프) ─────────────────
export function CalendarView() {
  const {
    visibleEvents, current, setCurrent,
    selDate, setSelDate,
    sheetMode, setSheetMode,
    setDetEv, drawer,
    currentUser, reports, setFieldReportEv,
    cals,
  } = useC();
  // calById()는 모듈 전역 CALS 미러를 읽는데, 이 미러는 useEffect로 렌더 이후에 갱신돼서
  // Firestore cals 스냅샷이 막 도착한 렌더에서는 한 박자 늦은(기본값) 색을 반환한다.
  // 여기선 항상 최신인 context의 cals 상태를 직접 봐서 그 지연을 없앤다.
  const calByIdLocal = id => cals.find(c => c.id === id) || { id: "unassigned", label: "미배정", name: "미배정", color: "#9ca3af", checked: true };
  // 청소 시작까지 진행된 일정이면 상세보기를 건너뛰고 바로 이어서(청소 완료 보고) 열기
  const handleEventClick = (ev) => {
    const canContinue = isSuperAdmin(currentUser) || isLeaderOf(currentUser, calByIdLocal(ev.calId)?.label);
    if (canContinue && reports.some(r => r.eventId === ev.id && r.status === "진행중")) {
      setFieldReportEv(ev);
      return;
    }
    setDetEv(ev);
  };
  const weeks  = useDates(current);
  const layouts = useMemo(
    () => weeks.map(w => buildLayout(visibleEvents, w.map(x=>x.s))),
    [weeks, visibleEvents]
  );

  // 슬라이드 방향 상태
  const [slideDir, setSlideDir] = useState(null);
  const [slideKey, setSlideKey] = useState(0);   // 월 전환마다 +1
  const handleBar = useRef(null); // 핸들바 드래그 시작Y
  const [listDir,  setListDir]  = useState(null);
  // 일정 목록 전용 키 — 날짜 이동 시에만 증가 (월 이동과 완전 분리)
  const [listKey,  setListKey]  = useState(0);

  // ── 월 이동 ──────────────────────────────────────────────────
  const goPrevMonth = useCallback(() => {
    setSlideDir("right");
    setSlideKey(k => k + 1);
    setCurrent(c => new Date(c.getFullYear(), c.getMonth()-1, 1));
  }, [setCurrent]);

  const goNextMonth = useCallback(() => {
    setSlideDir("left");
    setSlideKey(k => k + 1);
    setCurrent(c => new Date(c.getFullYear(), c.getMonth()+1, 1));
  }, [setCurrent]);

  // ── 날짜 이동 ────────────────────────────────────────────────
  const goPrevDay = useCallback(() => {
    setListDir("right");
    setListKey(k => k + 1);   // 일정 목록만 리마운트
    const prev = add(selDate, -1);
    setSelDate(prev);
    const d = pd(prev);
    setCurrent(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [selDate, setSelDate, setCurrent]);

  const goNextDay = useCallback(() => {
    setListDir("left");
    setListKey(k => k + 1);   // 일정 목록만 리마운트
    const next = add(selDate, 1);
    setSelDate(next);
    const d = pd(next);
    setCurrent(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [selDate, setSelDate, setCurrent]);

  // ── 날짜 클릭 ────────────────────────────────────────────────
  const handleDate = ds => {
    setSelDate(ds);
    const d = pd(ds);
    setCurrent(new Date(d.getFullYear(), d.getMonth(), 1));
    if (sheetMode === 0) setSheetMode(1);
  };

  // ── 그리드용 스와이프 (드로어 열려있으면 빈 객체)
  const gridSwipeActive = useSwipe({
    onLeft:  goNextMonth,
    onRight: goPrevMonth,
    onUp:    () => setSheetMode(m => m < 2 ? m + 1 : m),
    onDown:  () => setSheetMode(m => m > 0 ? m - 1 : m),
    hThreshold: 30,
    vThreshold: 30,
  });
  const gridSwipe = drawer ? {} : gridSwipeActive;

  // ── 시간표용 스와이프 (드로어 열려있으면 빈 객체)
  const listSwipeActive = useSwipe({
    onLeft:  goNextDay,
    onRight: goPrevDay,
    onUp:    () => setSheetMode(m => m < 2 ? m + 1 : m),
    onDown:  () => setSheetMode(m => m > 0 ? m - 1 : m),
    hThreshold: 30,
    vThreshold: 30,
  });
  const listSwipe = drawer ? {} : listSwipeActive;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ══ MODE 0: 전체 월간 그리드 ══════════════════════════════ */}
      {sheetMode === 0 && (
        <div
          key="mode0"
          className="flex-1 overflow-y-auto bg-white"
          style={{animation:"slideInFromTop 0.28s cubic-bezier(0.25,0.46,0.45,0.94) both", touchAction:"none"}}
          {...gridSwipe}>
          {/* 요일 헤더 */}
          <div className="grid grid-cols-7 border-b border-gray-100">
            {WD.map((w,i) => (
              <div key={w} className={`text-center text-[11px] font-semibold py-1.5
                ${i===0?"text-red-500":i===6?"text-blue-500":"text-gray-500"}`}>{w}</div>
            ))}
          </div>
          {/* 날짜 그리드 — 월 이동 시에만 슬라이드 */}
          <SlideTransition direction={slideDir} slideKey={slideKey}>
            <div className="border-l border-gray-100">
              {weeks.map((wk,wi) => (
                <div key={wi} className="grid grid-cols-7">
                  {wk.map(({s,cm}) => (
                    <FullMonthCell key={s} ds={s} isCm={cm}
                      items={layouts[wi][s]||[]}
                      onDate={handleDate}
                      onEvt={handleEventClick}/>
                  ))}
                </div>
              ))}
            </div>
            <div className="h-2"/>
          </SlideTransition>
        </div>
      )}

      {/* ══ MODE 1: 상단 도트 그리드 + 하단 시간표 ═══════════════ */}
      {sheetMode === 1 && (
        <div
          key="mode1"
          style={{animation:"slideInFromBottom 0.28s cubic-bezier(0.25,0.46,0.45,0.94) both"}}
          className="flex flex-col flex-1 overflow-hidden">
          {/* 도트 그리드 */}
          <div className="bg-white border-b border-gray-100 shrink-0" style={{touchAction:"none"}} {...gridSwipe}>
            <div className="grid grid-cols-7 pt-0.5">
              {WD.map((w,i) => (
                <div key={w} className={`text-center text-[11px] font-semibold py-0.5
                  ${i===0?"text-red-500":i===6?"text-blue-500":"text-gray-500"}`}>{w}</div>
              ))}
            </div>
            <SlideTransition direction={slideDir} slideKey={slideKey}>
              {weeks.map((wk,wi) => (
                <div key={wi} className="grid grid-cols-7">
                  {wk.map(({s,cm}) => {
                    // 일정 하나당 점 하나 (일정 개수만큼, 최대 5개)
                    const dots = visibleEvents
                      .filter(ev => ev.start<=s && (ev.end||ev.start)>=s)
                      .slice(0,5)
                      .map(ev => calByIdLocal(ev.calId).color);
                    return (
                      <DotCell key={s} ds={s} isCm={cm} dots={dots}
                        onDate={d => {
                          setSelDate(d);
                          const nd=pd(d);
                          setCurrent(new Date(nd.getFullYear(),nd.getMonth(),1));
                        }}
                        selDate={selDate}/>
                    );
                  })}
                </div>
              ))}
            </SlideTransition>
            {/* 드래그 핸들 — 상하 모드 전환 전용 터치존 */}
            <div
              className="flex justify-center pb-2 pt-1 cursor-pointer"
              onTouchStart={e => { handleBar.current = e.touches[0].clientY; }}
              onTouchEnd={e => {
                if (handleBar.current === null) return;
                const dy = e.changedTouches[0].clientY - handleBar.current;
                handleBar.current = null;
                if (dy < -30) setSheetMode(m => Math.min(m+1, 2)); // 위로 → 한단계씩
                if (dy >  30) setSheetMode(m => Math.max(m-1, 0)); // 아래로 → 한단계씩
              }}
              onMouseDown={e => { handleBar.current = e.clientY; }}
              onMouseUp={e => {
                if (handleBar.current === null) return;
                const dy = e.clientY - handleBar.current;
                handleBar.current = null;
                if (dy < -30) setSheetMode(m => Math.min(m+1, 2));
                if (dy >  30) setSheetMode(m => Math.max(m-1, 0));
              }}
            >
              <div className="w-10 h-[3px] bg-gray-300 rounded-full"/>
            </div>
          </div>

          {/* 시간표 — 좌우 날짜 스와이프 */}
          <div className="flex flex-col flex-1 overflow-hidden" {...listSwipe}>
            <ListTransition direction={listDir} listKey={listKey}>
              <ScheduleList selDate={selDate}/>
            </ListTransition>
          </div>
        </div>
      )}

      {/* ══ MODE 2: 시간표 전용 ════════════════════════════════════ */}
      {sheetMode === 2 && (
        <div
          className="flex flex-col flex-1 overflow-hidden"
          style={{animation:"slideInFromBottom 0.28s cubic-bezier(0.25,0.46,0.45,0.94) both"}}
          {...listSwipe}>
          <ListTransition direction={listDir} listKey={listKey}>
            <ScheduleList selDate={selDate}/>
          </ListTransition>
        </div>
      )}
    </div>
  );
}

// ── 이벤트 상세 Bottom Sheet ──────────────────────────────────────
export function DetailSheet() {
  const { detEv, setDetEv, deleteEvent, deleteEventScoped, openModal, setFieldReportEv, currentUser, cals, updateLeaderComment, reports } = useC();
  const [vis,setVis]=useState(false);
  const [commentDraft, setCommentDraft] = useState("");
  const [savedComment, setSavedComment] = useState("");
  const commentRef = useRef(null);
  // 훅 순서 유지를 위해 이른 리턴(!detEv) 전에 계산 — detEv 없으면 null
  const cal = detEv ? (cals.find(c=>c.id===detEv.calId) || { id:"unassigned", label:"미배정", name:"미배정", color:"#9ca3af" }) : null;
  useEffect(()=>{ if(detEv)setTimeout(()=>setVis(true),10); else setVis(false); },[detEv]);
  useEffect(()=>{
    // 새 항목 입력칸은 항상 비운 채로 시작 — 기존 기록은 savedComment(누적본)로 따로 보관
    setCommentDraft(""); setSavedComment(detEv?.leaderComment || "");
  },[detEv?.id]);
  // 이 일정 담당팀의 팀장이면 열리자마자 특이사항 입력칸에 커서가 깜빡이도록 자동 포커스
  useEffect(()=>{
    if (vis && cal && isLeaderOf(currentUser, cal.label) && commentRef.current) {
      const t = setTimeout(()=>commentRef.current?.focus(), 300);
      return ()=>clearTimeout(t);
    }
  },[vis, detEv?.id, cal, currentUser]);
  if(!detEv) return null;
  // 정기청소 배정에서 자동 생성된 일정 — 배정 관리 화면에서만 바꿀 수 있고, 본문도 별도 렌더링
  const isRegular = detEv.source === "regular";
  // 관리팀·영업팀은 현장팀 멤버십이 따로 있으면 그 팀 일정만 수정 가능 (없으면 기존처럼 전체 수정 가능)
  const myFieldTeams = myTeamNames(currentUser).filter(t => !["관리팀","영업팀"].includes(t));
  const canEditEvent = isSuperAdmin(currentUser) ||
    (isAdminStaff(currentUser) && (myFieldTeams.length === 0 || myFieldTeams.includes(cal.label)));
  const canWriteComment = isLeaderOf(currentUser, cal.label);
  const commentDirty = canWriteComment && commentDraft.trim() !== "";
  const close=()=>{ setVis(false); setTimeout(()=>setDetEv(null),280); };
  const requestClose = () => {
    if (commentDirty && !window.confirm("입력한 추가사항을 저장하지 않고 나가시겠습니까?")) return;
    close();
  };
  const appendComment = () => {
    const text = commentDraft.trim();
    if (!text) return;
    const now = new Date();
    const stamp = `${String(now.getMonth()+1).padStart(2,"0")}/${String(now.getDate()).padStart(2,"0")} ${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    const entry = `👷 현장팀장입력사항 · ${currentUser.name} · ${stamp}\n${text}`;
    const merged = savedComment ? `${savedComment}\n\n─────────────────\n${entry}` : entry;
    updateLeaderComment(detEv.id, merged, currentUser.name);
    setSavedComment(merged);
    setCommentDraft("");
  };
  const handleEdit = async () => {
    if (detEv._recurring) {
      const scope = await askRecurringScope(detEv, "edit");
      if (!scope) return;
      close(); setTimeout(()=>openModal(null, detEv.id, scope, detEv), 300);
    } else {
      close(); setTimeout(()=>openModal(null, detEv.id), 300);
    }
  };
  const handleDelete = async () => {
    if (detEv._recurring) {
      const scope = await askRecurringScope(detEv, "delete");
      if (!scope) return;
      deleteEventScoped(detEv, scope);
      close();
    } else {
      if (window.confirm("이 일정을 삭제하시겠습니까?")) { deleteEvent(detEv.id); close(); }
    }
  };

  return (
    <div
      className="absolute inset-0 z-[60] flex flex-col bg-white"
      style={{
        transform: vis ? "translateY(0)" : "translateY(100%)",
        transition: "transform 0.32s cubic-bezier(0.32,0.72,0,1)",
        pointerEvents: vis ? "auto" : "none",
      }}
      onClick={e=>e.stopPropagation()}>

        
        {/* 네이버 스타일 헤더 */}
        <div className="flex items-center justify-between px-2 py-1 border-b border-gray-100">
          <div className="flex gap-1">
            <button onClick={requestClose} className="p-2 rounded-full hover:bg-gray-100"><X size={22} className="text-gray-700"/></button>
          </div>
          <span className="text-base font-bold text-gray-800">일정</span>
          <div className="flex gap-1">
            {canEditEvent && !isRegular && <>
              <button onClick={handleEdit}
                className="p-2 rounded-full hover:bg-gray-100"><Edit3 size={19} className="text-gray-600"/></button>
              <button onClick={handleDelete}
                className="p-2 rounded-full hover:bg-gray-100"><Trash2 size={19} className="text-gray-600"/></button>
            </>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-24 max-h-[80vh]">
        {isRegular ? <RegularCleaningDetailBody detEv={detEv} cal={cal}/> : <>
          {/* 담당팀 */}
          <div className="flex items-center px-5 py-4 border-b border-gray-50 gap-1">
            <span style={{color:cal.color}} className="font-semibold text-[15px]">{cal.label}</span>
            <User size={14} className="text-gray-400 ml-0.5 mr-1"/>
            <ReportStatusBadge eventId={detEv.id} reports={reports}/>
          </div>

          {/* 제목 */}
          <div className="flex items-start px-5 py-5 border-b border-gray-100 gap-3">
            <div className="w-4 h-4 rounded-full shrink-0 mt-1 shadow-sm" style={{backgroundColor:cal.color}}/>
            <h2 className="text-xl font-bold text-gray-900 leading-snug">{detEv.title}</h2>
          </div>

          {/* 시간 */}
          <div className="flex items-start px-5 py-5 border-b border-gray-100 gap-4">
            <Clock size={20} className="text-gray-400 shrink-0 mt-0.5"/>
            <div className="flex-1">
              {detEv.allDay && <div className="text-[15px] font-semibold text-gray-800 mb-1">종일</div>}
              <div className="text-[15px] text-gray-800 leading-relaxed">
                {detEv.start}
                {detEv.end && detEv.end !== detEv.start ? ` ~ ${detEv.end}` : ""}
                {!detEv.allDay && <br/>}
                {!detEv.allDay && detEv.startTime && <span className="font-medium text-gray-900">{fmtTime(detEv.startTime)} ~ {fmtTime(detEv.endTime)}</span>}
              </div>
            </div>
          </div>

          {/* 반복 */}
          {detEv.repeat && detEv.repeat !== "none" && (
            <div className="flex items-center px-5 py-4 border-b border-gray-100 gap-4">
              <RotateCcw size={20} className="text-gray-400 shrink-0"/>
              <span className="text-[15px] text-gray-800">
                {(REPEAT_OPTS.find(o=>o.value===detEv.repeat)||{}).label || "반복"}
                {detEv.repeatUntil ? ` · ${detEv.repeatUntil}까지` : ""}
              </span>
            </div>
          )}

          {/* 장소 */}
          {detEv.place && (
            <div className="flex items-start px-5 py-5 border-b border-gray-100 gap-4">
              <MapPin size={20} className="text-gray-400 shrink-0 mt-0.5"/>
              <MapLinkButton place={detEv.place} className="flex-1 text-[15px] text-gray-800 hover:underline leading-relaxed text-left">
                {detEv.place}
              </MapLinkButton>
            </div>
          )}

          {/* 연락처 */}
          {detEv.contact && (
            <div className="flex items-start px-5 py-5 border-b border-gray-100 gap-4">
              <span className="text-gray-400 shrink-0 text-lg">📞</span>
              <a href={`tel:${detEv.contact.replace(/[^0-9]/g, '')}`} className="flex-1 text-[15px] text-green-600 font-bold hover:underline">
                {detEv.contact}
              </a>
            </div>
          )}

          {/* 메모 */}
          {detEv.description && (
            <div className="flex items-start px-5 py-5 gap-4">
              <AlignLeft size={20} className="text-gray-400 shrink-0 mt-0.5"/>
              <div className="flex-1 text-[15px] text-gray-800 whitespace-pre-wrap leading-relaxed">
                {detEv.description}
              </div>
            </div>
          )}
          {/* 첨부사진 */}
          {(detEv.photos||[]).length > 0 && (
            <div className="px-5 py-5 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[15px] font-semibold text-gray-800">📎 첨부 파일 {(detEv.photos||[]).length}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {(detEv.photos||[]).map((p,i)=>(
                  <button key={i} onClick={()=>openLightbox(detEv.photos.map(x=>x.url), i)}
                    className="w-20 h-20 shrink-0 rounded-xl overflow-hidden bg-gray-100 block">
                    <img src={p.url} alt="" className="w-full h-full object-cover"/>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 일정 추가사항 입력 — 팀장은 일정 본문은 못 고치고 이 칸에만 기록을 쌓을 수 있음 */}
          {(savedComment || canWriteComment) && (
            <div className="mx-5 my-5 p-4 rounded-2xl border-2 border-amber-300 bg-amber-50">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[13px] font-bold text-amber-700">📝 일정 추가사항 입력</span>
              </div>
              {savedComment && (
                <p className={`text-sm text-amber-900 whitespace-pre-wrap leading-relaxed ${canWriteComment ? "mb-3" : ""}`}>{savedComment}</p>
              )}
              {canWriteComment && (
                <div className="flex flex-col gap-2">
                  <textarea
                    ref={commentRef}
                    value={commentDraft}
                    onChange={e=>setCommentDraft(e.target.value)}
                    placeholder="새로 남길 추가사항을 입력하세요"
                    className="w-full min-h-[70px] rounded-xl border border-amber-200 bg-white p-3 text-sm outline-none focus:border-amber-500"
                  />
                  {commentDirty && (
                    <div className="flex justify-end">
                      <button onClick={appendComment}
                        className="text-xs font-bold px-4 py-2 rounded-lg text-white"
                        style={{background:"#d97706"}}>
                        저장
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </>}
        </div>

        {/* 현장 업무 보고 버튼 — 팀장 이상, 그리고 관리팀·영업팀 소속은 팀원이어도 겸직으로 현장에
            나갈 수 있어 보고 가능(현장팀 소속 팀원은 기존처럼 제외) — 스크롤과 무관하게 하단 고정.
            정기청소 자동일정은 출근확인 버튼이 본문에 따로 있어 이 버튼은 숨김. */}
        {!isRegular && (isSuperAdmin(currentUser) || isAdminStaff(currentUser) || isLeaderOf(currentUser, cal.label)) && (
          <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
            <button
              // detEv는 그대로 둬서(닫지 않고) 현장 완료 보고 화면을 닫으면
              // 캘린더가 아니라 이 일정 상세보기로 돌아오도록 함
              onClick={() => setFieldReportEv(detEv)}
              className="w-full py-4 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #1a56db 0%, #2563eb 100%)" }}>
              🧹 청소 시작 하기
            </button>
          </div>
        )}
    </div>
  );
}

// ── 길게 누르기 메뉴 ───────────────────────────────────────────────
export function LongPressMenu({ ev, onClose, onEdit, onDelete }) {
  if(!ev) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:300,display:"flex",alignItems:"flex-end",
      justifyContent:"center",background:"rgba(0,0,0,.4)"}}
      onClick={onClose}>
      <div style={{background:"white",borderRadius:"24px 24px 0 0",width:"100%",maxWidth:430,
        padding:"8px 0 32px",boxShadow:"0 -8px 32px rgba(0,0,0,.15)"}}
        onClick={e=>e.stopPropagation()}>
        {/* 핸들 */}
        <div style={{width:36,height:4,borderRadius:99,background:"#e5e7eb",
          margin:"8px auto 16px"}}/>
        {/* 일정 제목 */}
        <div style={{padding:"0 20px 16px",borderBottom:"1px solid #f3f4f6"}}>
          <p style={{fontSize:13,color:"#9ca3af",marginBottom:4}}>선택된 일정</p>
          <p style={{fontSize:16,fontWeight:800,color:"#111827"}}>{ev.title}</p>
        </div>
        {/* 버튼들 */}
        <div style={{padding:"8px 12px"}}>
          <button onClick={onEdit}
            style={{width:"100%",padding:"14px 16px",borderRadius:14,border:"none",
              background:"#f9fafb",cursor:"pointer",display:"flex",alignItems:"center",gap:12,
              marginBottom:8,textAlign:"left"}}>
            <span style={{fontSize:20}}>✏️</span>
            <span style={{fontSize:15,fontWeight:700,color:"#111827"}}>수정</span>
          </button>
          <button onClick={onDelete}
            style={{width:"100%",padding:"14px 16px",borderRadius:14,border:"none",
              background:"#fef2f2",cursor:"pointer",display:"flex",alignItems:"center",gap:12,
              textAlign:"left"}}>
            <span style={{fontSize:20}}>🗑️</span>
            <span style={{fontSize:15,fontWeight:700,color:"#ef4444"}}>삭제</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 삭제 확인 팝업 ───────────────────────────────────────────────
export function DeleteConfirmPopup({ ev, onCancel, onConfirm }) {
  if(!ev) return null;
  return (
    <div style={{position:"fixed",inset:0,zIndex:400,display:"flex",alignItems:"center",
      justifyContent:"center",padding:"24px",background:"rgba(0,0,0,.5)"}}>
      <div style={{background:"white",borderRadius:24,width:"100%",maxWidth:320,
        padding:"24px",boxShadow:"0 20px 60px rgba(0,0,0,.3)"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:40,marginBottom:12}}>🗑️</div>
          <h3 style={{fontSize:18,fontWeight:800,color:"#111827",marginBottom:8}}>일정 삭제</h3>
          <p style={{fontSize:13,color:"#6b7280",lineHeight:1.7}}>
            <span style={{fontWeight:700,color:"#111827"}}>{ev.title}</span><br/>
            이 일정을 삭제하시겠습니까?
          </p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onCancel}
            style={{flex:1,padding:"13px",borderRadius:14,border:"1.5px solid #e5e7eb",
              background:"white",fontSize:14,fontWeight:700,color:"#6b7280",cursor:"pointer"}}>
            취소
          </button>
          <button onClick={onConfirm}
            style={{flex:1,padding:"13px",borderRadius:14,border:"none",
              background:"linear-gradient(135deg,#ef4444,#dc2626)",
              fontSize:14,fontWeight:700,color:"white",cursor:"pointer"}}>
            삭제
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 하단 탭바 ───────────────────────────────────────────────
export function BottomTabBar() {
  const { currentScreen, setCurrentScreen, setDrawer, currentUser, notices } = useC();

  const readIds = (() => { try { return JSON.parse(localStorage.getItem("readNotices")||"[]"); } catch{ return []; } })();
  const unreadCount = notices.filter(n=>!readIds.includes(n.id)).length;

  const tabs = currentUser?.role === "팀원"
    ? [
        { icon: "📅", label: "캘린더",   screen: "calendar" },
        { icon: "🔔", label: "공지",      screen: "notice" },
        { icon: "🔗", label: "링크",      screen: "links" },
        { icon: "☰",  label: "더보기",    screen: "drawer" },
      ]
    : [
        { icon: "📅", label: "캘린더",   screen: "calendar" },
        { icon: "📊", label: "대시보드", screen: "dashboard" },
        { icon: "🔔", label: "공지",      screen: "notice" },
        { icon: "☰",  label: "더보기",    screen: "drawer" },
      ];

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-50"
      style={{maxWidth:430, margin:"0 auto", paddingBottom:"env(safe-area-inset-bottom)"}}>
      <div className="flex items-center">
        {tabs.map(tab => {
          const isActive = tab.screen !== "drawer" && currentScreen === tab.screen;
          const isDrawer = tab.screen === "drawer";
          return (
            <button key={tab.screen}
              onClick={() => isDrawer ? setDrawer(true) : setCurrentScreen(tab.screen)}
              className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 relative border-none bg-transparent cursor-pointer">
              <div className="relative">
                <span className="text-xl leading-none">{tab.icon}</span>
                {tab.screen === "notice" && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 text-xs font-bold text-white bg-red-500 rounded-full w-4 h-4 flex items-center justify-center"
                    style={{fontSize:9}}>{unreadCount}</span>
                )}
              </div>
              <span className="text-xs font-bold"
                style={{color: isActive ? "#1a56db" : "#9ca3af"}}>
                {tab.label}
              </span>
              {isActive && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-blue-500"/>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── 사이드 드로어 (스와이프 열기/닫기 지원) ───────────────────────
export function SideDrawer() {
  const { drawer, setDrawer, cals, toggleCal, currentUser, setCurrentUser, loginUser, setCurrentScreen, users, notices, setCompanySettingsModal, onLogout, companyId, assignments, extraCalFilter, setExtraCalFilterModal } = useC();
  const [pwModal, setPwModal] = useState(false);
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePw = async () => {
    if (!oldPw || !newPw || !newPw2) { setPwError("모든 항목을 입력하세요."); return; }
    if (oldPw !== currentUser.pw) { setPwError("현재 비밀번호가 틀렸습니다."); return; }
    if (newPw !== newPw2) { setPwError("새 비밀번호가 일치하지 않습니다."); return; }
    if (newPw.length < 4) { setPwError("비밀번호는 4자 이상이어야 합니다."); return; }
    setPwLoading(true);
    try {
      await updateDoc(doc(db, "staffs", currentUser.uid), { pw: newPw });
      if (companyId) await updateDoc(doc(db, "companies", companyId, "users", currentUser.uid), { pw: newPw });
      try { localStorage.setItem("loginUser", JSON.stringify({...currentUser, pw: newPw})); } catch {}
      setPwModal(false); setOldPw(""); setNewPw(""); setNewPw2(""); setPwError("");
      alert("비밀번호가 변경됐습니다.");
    } catch(e) { setPwError("변경 실패: " + e.message); }
    finally { setPwLoading(false); }
  };

  // 드래그 상태
  const startX    = useRef(null);
  const startY    = useRef(null);
  const curX      = useRef(0);
  const dragging  = useRef(false);
  const panelRef  = useRef(null);
  const drawerRef = useRef(drawer); // 클로저 문제 해결용
  const DRAWER_W  = 288;
  useEffect(() => { drawerRef.current = drawer; }, [drawer]);

  // 패널 translateX를 실시간 적용
  const applyX = x => {
    if (!panelRef.current) return;
    // drawer 열린 상태: 0 ~ -DRAWER_W(닫힘) / 닫힌 상태: -DRAWER_W ~ 0(열림)
    const clamped = Math.max(-DRAWER_W, Math.min(0, x));
    panelRef.current.style.transition = "none";
    panelRef.current.style.transform  = `translateX(${clamped}px)`;
  };

  const resetPanel = open => {
    if (!panelRef.current) return;
    panelRef.current.style.transition = "transform 0.3s ease";
    panelRef.current.style.transform  = open ? "translateX(0)" : `translateX(-${DRAWER_W}px)`;
  };

  // ── 터치 핸들러 ──────────────────────────────
  const onTouchStart = e => {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    dragging.current = false;
  };

  const onTouchMove = e => {
    const dx = e.touches[0].clientX - startX.current;
    const dy = Math.abs(e.touches[0].clientY - startY.current);
    // 수평 드래그일 때만 처리
    if (!dragging.current && Math.abs(dx) < 5) return;
    if (!dragging.current && dy > Math.abs(dx)) return; // 수직 스크롤 우선
    dragging.current = true;

    if (drawerRef.current) {
      // 열린 상태 → 왼쪽으로 밀어 닫기
      curX.current = Math.min(0, dx);
      applyX(curX.current);
    }
  };

  const onTouchEnd = () => {
    if (!dragging.current) { dragging.current = false; return; }
    dragging.current = false;
    const threshold = DRAWER_W * 0.35;
    if (drawerRef.current) {
      // 35% 이상 당기면 닫기
      if (curX.current < -threshold) { setDrawer(false); resetPanel(false); }
      else                            { resetPanel(true); }
    }
  };

  // drawer prop 변경 시 transition 복구
  useEffect(() => { resetPanel(drawer); }, [drawer]);

  return (
    <>
      {/* 비밀번호 변경 모달 */}
      {pwModal && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl flex flex-col gap-3">
            <h2 className="font-extrabold text-lg text-gray-900">비밀번호 변경</h2>
            <input type="password" placeholder="현재 비밀번호" value={oldPw} onChange={e=>{setOldPw(e.target.value);setPwError("");}}
              className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
            <input type="password" placeholder="새 비밀번호 (4자 이상)" value={newPw} onChange={e=>{setNewPw(e.target.value);setPwError("");}}
              className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
            <input type="password" placeholder="새 비밀번호 확인" value={newPw2} onChange={e=>{setNewPw2(e.target.value);setPwError("");}}
              className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
            {pwError && <p className="text-xs text-red-500">{pwError}</p>}
            <div className="flex gap-2 mt-1">
              <button onClick={()=>{setPwModal(false);setOldPw("");setNewPw("");setNewPw2("");setPwError("");}}
                className="flex-1 py-3 rounded-xl text-sm text-gray-500 bg-gray-100 font-bold">취소</button>
              <button onClick={handleChangePw} disabled={pwLoading}
                className="flex-1 py-3 rounded-xl text-sm text-white font-bold"
                style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
                {pwLoading ? "변경 중..." : "변경"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 배경 오버레이 — 탭해서 닫기 */}
      <div
        className="absolute inset-0 z-40 transition-opacity duration-300"
        style={{
          background: "rgba(0,0,0,0.35)",
          opacity: drawer ? 1 : 0,
          pointerEvents: drawer ? "auto" : "none",
        }}
        onClick={() => setDrawer(false)}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      {/* 엣지 스와이프 감지 영역 (드로어 닫혀있을 때 왼쪽 20px) */}
      {!drawer && (
        <div
          className="absolute top-0 left-0 h-full z-50"
          style={{ width: 20, touchAction: "none" }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />
      )}

      {/* 드로어 패널 */}
      <div
        ref={panelRef}
        className="absolute top-0 left-0 h-full bg-white z-50 shadow-2xl flex flex-col"
        style={{
          width: DRAWER_W,
          transform: `translateX(-${DRAWER_W}px)`,
          willChange: "transform",
          touchAction: "pan-y",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* 프로필 헤더 */}
        <div className="px-4 pt-12 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {isSuperAdmin(currentUser) && (
                <button onClick={() => { setDrawer(false); setCompanySettingsModal(true); }} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-800 rounded-full hover:bg-gray-100 transition-colors">
                  <Settings size={20} />
                </button>
              )}
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-xl border border-blue-100">🏠</div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-base">{currentUser.name}</p>
                  {!isSuperAdmin(currentUser) && (
                    <button onClick={() => { setPwModal(true); }}
                      className="text-[10px] text-gray-400 border border-gray-200 px-1.5 py-0.5 rounded-full hover:text-blue-500 hover:border-blue-300 transition-colors">
                      비밀번호
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500">{teamsLabel(currentUser)}</p>
              </div>
            </div>
            {/* 테스트용 계정 전환 — 크린드림 사장(최고관리자) 계정만 노출 */}
            {isSuperAdmin(currentUser) && currentUser.companyName === "크린드림" && (
              <select className="text-[10px] border border-gray-200 text-gray-500 p-1 rounded outline-none" onChange={e => setCurrentUser([loginUser, ...users].find(u=>u.id===e.target.value))} value={currentUser.id}>
                {[loginUser, ...users.filter(u=>u.id!==loginUser.id)].map(u => <option key={u.id} value={u.id}>{u.name} ({teamsLabel(u)})</option>)}
              </select>
            )}
          </div>
          <div className="flex mt-3">
            <button onClick={()=>{setDrawer(false); setCurrentScreen("calendar");}} className="w-full py-2 rounded-xl border border-gray-200 text-xs text-gray-800 font-bold bg-white shadow-sm flex items-center justify-center gap-1 hover:bg-gray-50">
              <Calendar size={14}/> 캘린더 바로가기
            </button>
          </div>
        </div>

        {/* 전체 메뉴 */}
        <div className="flex-1 overflow-y-auto bg-gray-50 py-3">
          {(isSuperAdmin(currentUser) || isMemberOf(currentUser, "관리팀")) && (
            <button
              onClick={() => { setCurrentScreen("employees"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <User size={20} className="text-blue-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">직원 관리</span>
            </button>
          )}
          {/* 정기청소 근무관리 - 최고관리자이거나, 본인 앞으로 배정된 현장이 하나라도 있으면 노출 (팀 구성과 무관) */}
          {(isSuperAdmin(currentUser) || assignments.some(a => a.employeeId === currentUser.id)) && (
            <button
              onClick={() => { setCurrentScreen("reg_hub"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <MapPin size={20} className="text-emerald-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">정기청소 근무관리</span>
            </button>
          )}
          {/* 팀별 일정 - 순수 팀원(어느 팀에서도 리더/관리 아님)은 제외 */}
          {(isSuperAdmin(currentUser) || isAdminStaff(currentUser) || hasLeadershipSomewhere(currentUser)) && (
            <button
              onClick={() => { setCurrentScreen("team_schedule"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <Calendar size={20} className="text-indigo-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">팀별 일정</span>
            </button>
          )}

          {/* 대시보드 - 순수 팀원 제외 */}
          {(isSuperAdmin(currentUser) || isAdminStaff(currentUser) || hasLeadershipSomewhere(currentUser)) && (
            <button
              onClick={() => { setCurrentScreen("dashboard"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <PieChart size={20} className="text-blue-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">일정 요약</span>
            </button>
          )}

          {/* 다른 일정 보기 - 관리팀 전용 로컬 필터(다른 팀 하나/다른 직원의 정기청소 배정 추가로 보기) */}
          {(isSuperAdmin(currentUser) || isAdminStaff(currentUser)) && (
            <button
              onClick={() => { setExtraCalFilterModal(true); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <Eye size={20} className="text-purple-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">다른 일정 보기</span>
              {extraCalFilter && <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />}
            </button>
          )}

          {/* 공지사항 - 전체 */}
          <button
            onClick={() => { setCurrentScreen("notice"); setDrawer(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <Bell size={20} className="text-orange-500" />
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">팀 공지사항</span>
            {(() => {
              const readIds = JSON.parse(localStorage.getItem("readNotices")||"[]");
              const unread = notices.filter(n=>!readIds.includes(n.id)).length;
              return unread > 0
                ? <span className="text-xs font-bold text-white bg-red-500 rounded-full w-5 h-5 flex items-center justify-center shrink-0">{unread}</span>
                : null;
            })()}
          </button>

          {/* 변경 로그 - 최고관리자, 관리팀 팀장만 */}
          {(isSuperAdmin(currentUser) || isLeaderOf(currentUser, "관리팀")) && (
            <button
              onClick={() => { setCurrentScreen("activity_log"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <History size={20} className="text-green-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">변경 로그</span>
            </button>
          )}

          {/* 완료 보고 내역 - 사이드 메뉴에서 임시로 숨김 (나중에 다시 쓸 수 있어 기능/화면은 그대로 둠, false만 지우면 복구) */}
          {false && currentUser.role !== "팀원" && (
            <button
              onClick={() => { setCurrentScreen("report_history"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <CheckSquare size={20} className="text-blue-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">완료 보고 내역</span>
            </button>
          )}
          {/* 자주 쓰는 외부 링크 - 사이드 메뉴에서 임시로 숨김 (요청 많아지면 false만 지우면 복구) */}
          {false && (
            <button
              onClick={() => { setCurrentScreen("links"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <ExternalLink size={20} className="text-purple-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">자주 쓰는 외부 링크</span>
            </button>
          )}
          {/* 캘린더 가져오기 - 사장, 관리팀·영업팀 팀장만 */}
          {(isSuperAdmin(currentUser) ||
            isLeaderOf(currentUser, "관리팀") || isLeaderOf(currentUser, "영업팀")) && (
            <button
              onClick={() => { setCurrentScreen("import_calendar"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <Download size={20} className="text-teal-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">캘린더 가져오기</span>
            </button>
          )}

          {/* 사용설명서(구 설정 가이드/FAQ) - 아직 내용 미완성이라 사이드 메뉴에서 임시로 숨김
              (실배포 시 내용 다 채우고 false만 지우면 복구) */}
          {false && (
            <button
              onClick={() => { setCurrentScreen("faq"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <span className="text-lg">❓</span>
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">사용설명서</span>
            </button>
          )}

          {/* 알림 켜기 */}
          <button
            onClick={async () => {
              const r = await enablePush(currentUser);
              if (r.ok) alert("🔔 알림이 켜졌습니다!");
              else alert("알림을 켤 수 없습니다.\n사유: " + r.reason);
              setDrawer(false);
            }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <Bell size={20} className="text-amber-500" />
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">🔔 알림 켜기</span>
          </button>

          {/* 로그아웃 */}
          <div className="mt-2 pt-2 border-t border-gray-100">
            <button
              onClick={() => { if(window.confirm("로그아웃 하시겠습니까?")) onLogout?.(); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <span className="text-red-500 text-lg">⎋</span>
              <span className="text-sm font-medium text-red-500 flex-1 text-left">로그아웃</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── 다른 일정 보기 모달 (관리팀 전용 로컬 필터) ──────────────────────
// 평소엔 내 팀 것만 보이다가, 다른 팀 하나 또는 다른 직원 한 명의 정기청소 배정을
// 추가로 얹어보고 싶을 때 쓰는 선택창. Firestore에 저장하지 않는 로컬(브라우저) 전용 상태.
export function ExtraCalFilterModal() {
  const { extraCalFilterModal, setExtraCalFilterModal, extraCalFilter, setExtraCalFilter, cals, currentUser, assignments, users } = useC();
  if (!extraCalFilterModal) return null;

  const myTeams = myTeamNames(currentUser);
  const otherTeams = cals.filter(c => c.isField !== false && !c.personal && !myTeams.includes(c.label));
  const myUserId = currentUser.id || currentUser.uid;
  const otherEmployeeIds = [...new Set(assignments.map(a => a.employeeId))].filter(id => id !== myUserId);

  const statusLabel = !extraCalFilter
    ? "지금은 내 것만 보는 중이에요"
    : extraCalFilter.type === "team"
      ? `"${extraCalFilter.label}" 팀 일정을 추가로 보는 중이에요`
      : `"${extraCalFilter.name}"님의 정기청소 배정을 추가로 보는 중이에요`;

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center px-6" onClick={()=>setExtraCalFilterModal(false)}>
      <div className="bg-white rounded-3xl p-5 w-full max-w-sm shadow-2xl flex flex-col gap-3 max-h-[80vh]" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-extrabold text-lg text-gray-900">다른 일정 보기</h2>
          <button onClick={()=>setExtraCalFilterModal(false)} className="p-1 -mr-1 text-gray-400 hover:text-gray-700"><X size={20}/></button>
        </div>
        <p className="text-xs text-gray-500 -mt-1">{statusLabel}</p>
        {extraCalFilter && (
          <button onClick={()=>setExtraCalFilter(null)}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200">
            해제하고 내 것만 보기
          </button>
        )}
        <div className="overflow-y-auto flex flex-col gap-3 -mx-1 px-1">
          {otherTeams.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 mb-1.5 px-1">다른 팀</p>
              <div className="flex flex-col gap-1">
                {otherTeams.map(c => (
                  <button key={c.id}
                    onClick={()=>{ setExtraCalFilter({type:"team", label:c.label}); setExtraCalFilterModal(false); }}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-left ${extraCalFilter?.type==="team" && extraCalFilter.label===c.label ? "bg-purple-50 text-purple-700" : "hover:bg-gray-50 text-gray-700"}`}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{backgroundColor:c.color}}/>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {otherEmployeeIds.length > 0 && (
            <div>
              <p className="text-xs font-bold text-gray-400 mb-1.5 px-1">정기청소 담당 직원</p>
              <div className="flex flex-col gap-1">
                {otherEmployeeIds.map(id => {
                  const u = users.find(u => u.id === id);
                  if (!u) return null;
                  return (
                    <button key={id}
                      onClick={()=>{ setExtraCalFilter({type:"employee", employeeId:id, name:u.name}); setExtraCalFilterModal(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium text-left ${extraCalFilter?.type==="employee" && extraCalFilter.employeeId===id ? "bg-purple-50 text-purple-700" : "hover:bg-gray-50 text-gray-700"}`}>
                      🧹 {u.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {otherTeams.length === 0 && otherEmployeeIds.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">추가로 볼 수 있는 팀/직원이 없어요</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 일정 추가 모달 ────────────────────────────────────────────────
const blank=date=>({title:"",description:"",contact:"",team:"",start:date||fmt(new Date()),end:date||fmt(new Date()),allDay:false,startTime:"09:00",endTime:"10:00",place:"",url:"",calId:"",
  repeat:"none",repeatInterval:1,repeatWeekdays:[],
  repeatMonthlyType:"day",repeatMonthlyDay:null,repeatMonthlyOrdinal:1,repeatMonthlyWeekday:null,
  repeatYearlyType:"date",repeatYearlyMonth:null,repeatYearlyDay:null,repeatYearlyOrdinal:1,repeatYearlyWeekday:null,
  repeatUntil:"",photos:[]});

// ── 날짜/시간 피커 (네이버 앱 스타일 — 인라인 드럼롤) ──────────────
export function DateTimePicker({ form, set, errs, lockRepeat }) {
  const [activePicker, setActivePicker] = useState(null); // null | "start" | "end"
  const [repeatOpen, setRepeatOpen] = useState(false);

  // 피커 내부 상태 (ref로 항상 최신값 유지)
  // h24: 0~23 (오전/오후 합친 연속 시간)
  const ps = useRef({ year:2026, month:6, day:1, h24:9, min:0 });
  const [pYear,  setPYear]  = useState(2026);
  const [pMonth, setPMonth] = useState(6);
  const [pDay,   setPDay]   = useState(1);
  const [pH24,   setPH24]   = useState(9);
  const [pMin,   setPMin]   = useState(0);

  const parseTimeH24 = t => {
    if (!t) return { h24: 9, m: 0 };
    const [hh, mm] = t.split(":").map(Number);
    return { h24: hh, m: Math.round(mm / 5) * 5 % 60 };
  };
  const fmtH24 = h => {
    const ap = h < 12 ? "오전" : "오후";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${ap} ${h12}시`;
  };
  const dispTime = t => {
    if (!t) return "--:--";
    const [hh, mm] = t.split(":").map(Number);
    const ap = hh < 12 ? "오전" : "오후";
    const h12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh;
    return `${ap} ${h12}:${String(mm).padStart(2,"0")}`;
  };

  const applyToForm = (y, mo, d, h24, m) => {
    if (!activePicker) return;
    const safeDay = Math.min(d, new Date(y, mo, 0).getDate());
    const dateStr = `${y}-${String(mo).padStart(2,"0")}-${String(safeDay).padStart(2,"0")}`;
    const timeStr = `${String(h24).padStart(2,"0")}:${String(m).padStart(2,"0")}`;
    if (activePicker === "start") {
      set("start", dateStr);
      if (dateStr > form.end) set("end", dateStr);
      if (!form.allDay) {
        // 기존 시간차(분)를 유지하면서 종료 시간 자동 조정
        const [oldSH, oldSM] = (form.startTime||"09:00").split(":").map(Number);
        const [oldEH, oldEM] = (form.endTime||"10:00").split(":").map(Number);
        const diffMin = (oldEH*60+oldEM) - (oldSH*60+oldSM);
        const newStartMin = h24*60 + m;
        const totalEndMin = newStartMin + (diffMin > 0 ? diffMin : 60);
        const dayOverflow = Math.floor(totalEndMin / (24*60)); // 넘어가는 날 수
        const newEndMin = totalEndMin % (24*60);
        const newEH = Math.floor(newEndMin/60);
        const newEM = newEndMin%60;
        const endTimeStr = `${String(newEH).padStart(2,"0")}:${String(newEM).padStart(2,"0")}`;
        set("startTime", timeStr);
        set("endTime", endTimeStr);
        // 자정 넘어가면 종료 날짜도 다음날로
        if (dayOverflow > 0) {
          const endDate = new Date(dateStr);
          endDate.setDate(endDate.getDate() + dayOverflow);
          set("end", fmt(endDate));
        }
      }
    } else {
      set("end", dateStr);
      if (!form.allDay) set("endTime", timeStr);
    }
  };

  const openPicker = field => {
    if (activePicker === field) { setActivePicker(null); return; }
    const dateStr = field === "start" ? form.start : form.end;
    const timeStr = field === "start" ? form.startTime : form.endTime;
    const d = pd(dateStr) || new Date();
    const t = parseTimeH24(timeStr);
    const state = { year: d.getFullYear(), month: d.getMonth()+1, day: d.getDate(), h24: t.h24, min: t.m };
    ps.current = state;
    setPYear(state.year); setPMonth(state.month); setPDay(state.day);
    setPH24(state.h24); setPMin(state.min);
    setActivePicker(field);
  };

  // ps.current → Date 객체
  const baseDate = () => new Date(ps.current.year, ps.current.month-1, ps.current.day, ps.current.h24, ps.current.min);
  // Date → ps.current 동기화 + 폼 반영
  const reSync = b => {
    ps.current = { year: b.getFullYear(), month: b.getMonth()+1, day: b.getDate(), h24: b.getHours(), min: b.getMinutes() };
    setPYear(ps.current.year); setPMonth(ps.current.month); setPDay(ps.current.day);
    setPH24(ps.current.h24); setPMin(ps.current.min);
    applyToForm(ps.current.year, ps.current.month, ps.current.day, ps.current.h24, ps.current.min);
  };

  // 연도는 순환 안 함 → 값 직접 적용
  const chYear  = v => { ps.current.year = v; setPYear(v); applyToForm(v, ps.current.month, ps.current.day, ps.current.h24, ps.current.min); };
  // 월/일/시/분은 delta(움직인 칸 수)를 Date 연산으로 적용 → 자릿수 올림 자동
  const chMonth = (v, delta=0) => {
    const b = baseDate();
    const targetDay = b.getDate();
    b.setDate(1);
    b.setMonth(b.getMonth() + delta);
    const lastDay = new Date(b.getFullYear(), b.getMonth()+1, 0).getDate();
    b.setDate(Math.min(targetDay, lastDay));
    reSync(b);
  };
  const chDay = (v, delta=0) => { const b = baseDate(); b.setDate(b.getDate() + delta); reSync(b); };
  const chH24 = (v, delta=0) => { const b = baseDate(); b.setHours(b.getHours() + delta); reSync(b); };
  const chMin = (v, delta=0) => { const b = baseDate(); b.setMinutes(b.getMinutes() + delta*5); reSync(b); };

  const daysInMonth = new Date(pYear, pMonth, 0).getDate();
  const years  = Array.from({length:8}, (_,i) => 2023+i);
  const months = Array.from({length:12},(_,i) => i+1);
  const days   = Array.from({length:daysInMonth},(_,i) => i+1);
  const hours24 = Array.from({length:24},(_,i) => i); // 0~23 연속
  const mins   = Array.from({length:12},(_,i) => i*5);
  const WD     = ["일","월","화","수","목","금","토"];

  const dispDate = s => {
    if (!s) return <span className="text-red-500 font-semibold">날짜 선택 필요</span>;
    const d = pd(s); if (!d) return "--";
    const yy = String(d.getFullYear()).slice(2);
    return `${yy}. ${d.getMonth()+1}. ${d.getDate()}.(${WD[d.getDay()]})`;
  };

  return (
    <div className="border-b border-gray-100">
      {/* 종일 토글(좌) + 반복(우) — 각 절반씩 */}
      <div className="flex items-stretch border-b border-gray-100">
        <div className="flex-1 flex items-center gap-3 px-4 py-3">
          <Clock size={18} className="text-gray-400 shrink-0"/>
          <span className="text-sm text-gray-700">종일</span>
          <button onClick={()=>set("allDay",!form.allDay)}
            className={`relative w-12 h-6 rounded-full transition-colors duration-200 ml-auto ${form.allDay?"bg-blue-600":"bg-gray-200"}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.allDay?"translate-x-6":"translate-x-0"}`}/>
          </button>
        </div>
        <div className="w-px bg-gray-100 my-2"/>
        <div className="flex-1 px-4 py-3">
          {lockRepeat ? (
            <div className="flex items-center gap-2 text-gray-400">
              <RotateCcw size={18} className="shrink-0"/>
              <span className="text-sm">이 일정만 수정 중</span>
            </div>
          ) : (
            <RepeatToggleButton form={form} open={repeatOpen} setOpen={setRepeatOpen}/>
          )}
        </div>
      </div>

      {/* 반복 설정 패널 — 전체 너비로 펼쳐짐 (단건 수정 중엔 숨김) */}
      {!lockRepeat && repeatOpen && <RepeatPanel form={form} set={set}/>}

      {/* 시작/종료 날짜시간 버튼 */}
      <div className="flex items-center px-4 py-3 gap-2">
        <button onClick={()=>openPicker("start")} className="flex-1 text-left">
          <div className={`text-sm font-medium ${activePicker==="start"?"text-yellow-500":"text-gray-600"}`}>
            {dispDate(form.start)}
          </div>
          {!form.allDay && (
            <div className={`text-2xl font-bold mt-0.5 ${activePicker==="start"?"text-yellow-500":"text-gray-900"}`}>
              {dispTime(form.startTime)}
            </div>
          )}
        </button>
        <ChevronRight size={16} className="text-gray-300 shrink-0"/>
        <button onClick={()=>openPicker("end")} className="flex-1 text-right">
          <div className={`text-sm font-medium ${activePicker==="end"?"text-yellow-500":"text-gray-600"}`}>
            {dispDate(form.end)}
          </div>
          {!form.allDay && (
            <div className={`text-2xl font-bold mt-0.5 ${activePicker==="end"?"text-yellow-500":"text-gray-900"}`}>
              {dispTime(form.endTime)}
            </div>
          )}
        </button>
      </div>

      {errs.start && <p className="text-red-500 text-xs px-4 pb-2">{errs.start}</p>}
      {errs.end  && <p className="text-red-500 text-xs px-4 pb-2">{errs.end}</p>}
      {errs.time && <p className="text-red-500 text-xs px-4 pb-2">{errs.time}</p>}

      {/* 날짜/시간 팝업 — 버튼 바로 아래 인라인 */}
      {activePicker && (
        <div className="border-t border-gray-100 bg-white">
          {/* 드럼롤 */}
          <div className="flex px-1" style={{height:220}}>
            <WheelPicker key={`y`}  items={years}  value={pYear}  onChange={chYear}  renderItem={v=>String(v)}/>
            <WheelPicker key={`mo`} items={months} value={pMonth} onChange={chMonth} renderItem={v=>`${v}월`} loop/>
            <WheelPicker key={`${pYear}-${pMonth}-d`} items={days} value={pDay} onChange={chDay}
              renderItem={v=>`${v}일`} loop/>
            {!form.allDay && <>
              <WheelPicker key={`h24`} items={hours24} value={pH24} onChange={chH24} renderItem={fmtH24} loop/>
              <WheelPicker key={`m`}   items={mins}    value={pMin} onChange={chMin} renderItem={v=>String(v).padStart(2,"0")} loop/>
            </>}
          </div>
          {/* 오늘/닫기 버튼 */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-100">
            <button onClick={()=>{
              const t = new Date();
              const y=t.getFullYear(), mo=t.getMonth()+1, d=t.getDate();
              ps.current = {...ps.current, year:y, month:mo, day:d};
              setPYear(y); setPMonth(mo); setPDay(d);
              applyToForm(y, mo, d, ps.current.h24, ps.current.min);
            }} className="px-4 py-1.5 rounded-full text-sm font-bold bg-gray-100 text-gray-600">
              오늘
            </button>
            <button onClick={()=>setActivePicker(null)}
              className="px-6 py-1.5 rounded-full text-sm font-bold text-white"
              style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function EventModal() {
  const { modal, closeModal, addEvent, updateEvent, updateEventScoped, deleteEvent, events, cals: allCals, visibleCals: cals, teams, titleRule, typeKeywords, companyId, reports, companyDoc, currentUser, setFieldReportEv, eventModalGuardRef } = useC();
  const { open, date, editId, scope, instanceEv } = modal;
  // 반복일정의 "이 일정만/이후 전체" 수정은 클릭한 회차(instanceEv)의 값으로 폼을 채운다.
  const editEv = editId ? ((scope && scope!=="all" && instanceEv) ? instanceEv : events.find(e=>e.id===editId)) : null;
  const [form,setForm]=useState(blank(date));
  const [errs,setErrs]=useState({});
  const [anim,setAnim]=useState(false);
  const [pasteText,setPasteText]=useState("");
  // inputMode: "memo" | "chat" | "image" | "direct"
  const [inputMode,setInputMode]=useState("memo");
  const [aiLoading,setAiLoading]=useState(false);
  const [imgFile,setImgFile]=useState(null);
  const [imgPreview,setImgPreview]=useState(null);
  const [calDropOpen,setCalDropOpen]=useState(false);
  const imgInputRef=useRef(null);
  // step: "paste"=입력단계, "form"=일정폼단계
  const [step,setStep]=useState("paste");
  const [exitConfirm,setExitConfirm]=useState(false);
  const origForm=useRef(null);
  const tRef=useRef(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));
  const isDirty=()=>origForm.current && JSON.stringify(form)!==JSON.stringify(origForm.current);
  const tryClose=()=>{ if(editId&&isDirty()) setExitConfirm(true); else closeModal(); };

  // 안드로이드 뒤로가기도 X버튼과 동일하게 tryClose(저장 확인)를 거치도록 등록.
  // tryClose가 최신 form을 클로저로 물고 있어 매 렌더마다 갱신하고, 닫히면 비운다.
  useEffect(() => {
    if (eventModalGuardRef) eventModalGuardRef.current = open ? tryClose : null;
  });

  // 담당팀 배정 드롭다운 목록 — 개인 캘린더(본인 것만)는 항상 최상단, 나머지 팀은
  // "팀" 탭에서 드래그로 정한 teams 배열 순서를 그대로 따른다(cals 컬렉션 자체엔 순서가 없음).
  const myUserId = currentUser.id || currentUser.uid;
  const calOptions = useMemo(() => cals
    .filter(c => c.isField !== false && c.id !== REGULAR_CAL_ID && (!c.personal || c.ownerId === myUserId))
    .sort((a, b) => {
      if (a.personal) return -1;
      if (b.personal) return 1;
      const ai = teams.indexOf(a.label), bi = teams.indexOf(b.label);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    }), [cals, teams, myUserId]);

  useEffect(()=>{
    if(open){
      const initForm = editEv?{...editEv}:blank(date);
      setForm(initForm);
      origForm.current = editEv ? {...editEv} : null;
      setExitConfirm(false);
      setErrs({});
      setPasteText("");
      setInputMode("memo");
      setAiLoading(false);
      setImgFile(null);
      setImgPreview(null);
      setCalDropOpen(false);
      setStep(editEv ? "form" : "paste");
      setTimeout(()=>setAnim(true),10);
      setTimeout(()=>tRef.current?.focus(),150);
    }
    else setAnim(false);
  },[open,editId]);


  const validate=()=>{
    const e={};
    if(!form.title.trim()) e.title="제목을 입력해주세요.";
    if(!form.start) e.start="시작 날짜를 선택해주세요.";
    if(form.end<form.start) e.end="종료일은 시작일 이후여야 합니다.";
    if(!form.allDay&&form.startTime>=form.endTime) e.time="종료 시간은 시작 시간 이후여야 합니다.";
    setErrs(e); return !Object.keys(e).length;
  };
  const [uploading, setUploading] = useState(false);
  const submit = async () => {
    if (!validate()) return;
    setUploading(true);
    try {
      // base64(새 사진)는 Storage에 업로드, URL(기존)은 그대로 유지
      const evId = editId || doc(collection(db, "companies", companyId, "events")).id;
      const uploadedPhotos = await Promise.all((form.photos||[]).map(async (p) => {
        if (p.url) return p; // 이미 업로드된 사진
        const blob = await (await fetch(p.data)).blob();
        const path = `companies/${companyId}/events/${evId}/${Date.now()}_${p.name}`;
        const sRef = storageRef(storage, path);
        await uploadBytes(sRef, blob);
        const url = await getDownloadURL(sRef);
        return { name: p.name, url, path };
      }));
      const finalForm = { ...form, photos: uploadedPhotos };
      if (editId) {
        if (scope && scope !== "all" && instanceEv) {
          updateEventScoped(instanceEv, scope, { ...finalForm, id: editId });
        } else {
          updateEvent({ ...finalForm, id: editId });
        }
      } else {
        addEvent({ ...finalForm, _id: evId });
      }
      closeModal();
    } catch(e) {
      alert("사진 업로드 중 오류: " + e.message);
    } finally {
      setUploading(false);
    }
  };
  if(!open) return null;

  return (
    <div
      style={{
        transform: anim ? "translateY(0)" : "translateY(100%)",
        opacity:   anim ? 1 : 0,
        transition: "transform 0.35s cubic-bezier(0.32,0.72,0,1), opacity 0.35s ease",
      }}
      className="absolute inset-0 z-50 bg-white flex flex-col overflow-hidden">

      {/* 저장 확인 팝업 */}
      {exitConfirm && (
        <div className="absolute inset-0 bg-black/40 z-[100] flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <p className="text-base font-bold text-gray-900 mb-1">변경사항이 있습니다</p>
            <p className="text-sm text-gray-500 mb-5">저장하지 않고 나가시겠습니까?</p>
            <div className="flex gap-2">
              <button onClick={()=>{ setExitConfirm(false); closeModal(); }}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-gray-600 bg-gray-100">
                저장없이 나가기
              </button>
              <button onClick={()=>{ setExitConfirm(false); submit(); }}
                className="flex-1 py-3 rounded-xl text-sm font-bold text-white"
                style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
                저장하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ STEP 1: 입력 방법 선택 단계 ═══ */}
      {step === "paste" ? (
        <>
          {/* 헤더 */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <button onClick={closeModal}><X size={22} className="text-gray-600"/></button>
            <h2 className="font-bold text-base">일정 추가</h2>
            <div className="w-6"/>
          </div>

          {/* 탭 — 대화(텍스트 AI 추출)/사진(이미지 AI 추출)은 요금제 플래그에 따라 노출 여부가 갈림 */}
          <div className="flex border-b border-gray-100">
            {[
              { key:"memo",  icon:"📋", label:"메모"  },
              ...(companyDoc?.aiTextExtraction !== false ? [{ key:"chat", icon:"💬", label:"대화"  }] : []),
              ...(companyDoc?.aiImageExtraction ? [{ key:"image", icon:"📷", label:"사진"  }] : []),
              { key:"direct",icon:"✏️", label:"직접"  },
            ].map(tab=>{
              const active = inputMode === tab.key;
              return (
                <button key={tab.key}
                  onClick={()=>{
                    setInputMode(tab.key);
                    if(tab.key==="direct"){ setStep("form"); }
                  }}
                  className="flex-1 flex flex-col items-center py-2.5 gap-0.5 relative transition-colors"
                  style={{color: active ? "#1a56db" : "#9ca3af"}}>
                  <span className="text-lg leading-none">{tab.icon}</span>
                  <span className="text-[11px] font-semibold">{tab.label}</span>
                  {active && (
                    <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-blue-600"/>
                  )}
                </button>
              );
            })}
          </div>

          {/* 입력 영역 */}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-4">
            {inputMode === "memo" && (
              <>
                <p className="text-xs text-gray-400 mb-3">카카오톡 문자나 메모를 붙여넣으면 날짜·장소·연락처를 자동으로 정리해드려요.</p>
                <textarea
                  ref={tRef}
                  value={pasteText}
                  onChange={e=>setPasteText(e.target.value)}
                  placeholder={"여기에 내용을 붙여넣으세요...\n\n예)\n6월 15일 오전\n서울시 동대문구 망우로1길27\n이효림 010-2192-9533\n비밀번호 1469*"}
                  className="w-full h-64 text-sm outline-none resize-none text-gray-800 placeholder-gray-300 leading-relaxed"
                />
              </>
            )}
            {inputMode === "chat" && (
              <>
                <p className="text-xs text-gray-400 mb-3">고객과 나눈 카카오톡 상담 대화를 통째로 붙여넣으면 AI가 예약 정보를 뽑아드려요.</p>
                <textarea
                  value={pasteText}
                  onChange={e=>setPasteText(e.target.value)}
                  placeholder={"[고객]\n안녕하세요! 청소 견적 문의드려요.\n\n[사장님]\n안녕하세요! 언제 원하세요?"}
                  className="w-full h-64 text-sm outline-none resize-none text-gray-800 placeholder-gray-300 leading-relaxed"
                />
              </>
            )}
            {inputMode === "image" && (
              <>
                <p className="text-xs text-gray-400 mb-3">사진을 올리면 텍스트를 추출해서 일정을 자동으로 채워드려요.</p>
                <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
                  onChange={e=>{
                    const file = e.target.files?.[0];
                    if(!file) return;
                    setImgFile(file);
                    const reader = new FileReader();
                    reader.onload = ev => setImgPreview(ev.target.result);
                    reader.readAsDataURL(file);
                  }}/>
                {imgPreview ? (
                  <div className="relative">
                    <img src={imgPreview} alt="선택된 이미지" className="w-full rounded-xl object-contain max-h-64 bg-gray-50"/>
                    <button
                      onClick={()=>{ setImgFile(null); setImgPreview(null); imgInputRef.current.value=""; }}
                      className="absolute top-2 right-2 w-7 h-7 bg-black/50 rounded-full flex items-center justify-center">
                      <X size={14} className="text-white"/>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={()=>imgInputRef.current?.click()}
                    className="w-full h-48 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center gap-2 text-gray-400 active:bg-gray-50">
                    <span className="text-4xl">📷</span>
                    <span className="text-sm font-medium">사진 선택</span>
                    <span className="text-xs">카메라 촬영 또는 갤러리에서 선택</span>
                  </button>
                )}
              </>
            )}
          </div>

          {/* 하단 버튼 — 모달 내부 고정 */}
          <div className="shrink-0 px-4 py-3 bg-white border-t border-gray-100">
            <button
              disabled={aiLoading}
              onClick={async ()=>{
                if(inputMode === "memo"){
                  if(pasteText.trim()){
                    const parsed = parseEventText(pasteText, titleRule, typeKeywords);
                    setForm(p=>({...p, ...parsed}));
                  }
                  setStep("form");
                } else if(inputMode === "chat"){
                  if(!pasteText.trim()){ setStep("form"); return; }
                  setAiLoading(true);
                  try {
                    const analyze = httpsCallable(functions, "analyzeConsultation");
                    const result = await analyze({ text: pasteText, companyId });
                    const parsed = result.data || {};
                    setForm(p=>({
                      ...p,
                      title:     parsed.title     || p.title,
                      start:     parsed.start     || p.start,
                      end:       parsed.end || parsed.start || p.end,
                      startTime: parsed.startTime || p.startTime,
                      endTime:   parsed.endTime   || p.endTime,
                      place:     parsed.place     || p.place,
                      contact:   parsed.contact   || p.contact,
                      description: parsed.description || p.description,
                    }));
                    setStep("form");
                  } catch(e){
                    alert("AI 분석 중 오류가 발생했어요.\n" + (e?.message||""));
                  } finally { setAiLoading(false); }
                } else if(inputMode === "image"){
                  if(!imgFile){ alert("사진을 먼저 선택해주세요."); return; }
                  setAiLoading(true);
                  try {
                    const toBase64 = f => new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(f); });
                    const base64 = await toBase64(imgFile);
                    const extract = httpsCallable(functions, "extractFromImage");
                    const result = await extract({ image: base64, companyId });
                    const parsed = result.data || {};
                    setForm(p=>({
                      ...p,
                      title:     parsed.title     || p.title,
                      start:     parsed.start     || p.start,
                      end:       parsed.end || parsed.start || p.end,
                      startTime: parsed.startTime || p.startTime,
                      endTime:   parsed.endTime   || p.endTime,
                      place:     parsed.place     || p.place,
                      contact:   parsed.contact   || p.contact,
                      description: parsed.description || p.description,
                    }));
                    setStep("form");
                  } catch(e){
                    alert("이미지 분석 중 오류가 발생했어요.\n" + (e?.message||""));
                  } finally { setAiLoading(false); }
                }
              }}
              className={"w-full py-3 text-white text-sm font-bold rounded-2xl transition-all " + (aiLoading ? "bg-gray-300" : "bg-blue-600")}>
              {aiLoading ? "⏳ 분석 중..." :
               inputMode === "memo"  ? "✨ 자동 분석하고 계속" :
               inputMode === "chat"  ? "✨ AI로 분석하기" :
               inputMode === "image" ? "📷 이미지 분석하기" : "계속"}
            </button>
          </div>
        </>
      ) : (
      /* ═══ STEP 2: 일정 폼 단계 ═══ */
      <>
      {/* 헤더 + 담당팀 드롭다운 */}
      <div className="flex flex-col px-4 pt-3 pb-0 border-b border-gray-100">
        <div className="flex items-center justify-between mb-1">
          <button onClick={()=>editId ? tryClose() : setStep("paste")}>
            {editId ? <X size={22} className="text-gray-600"/> : <ChevronLeft size={22} className="text-gray-600"/>}
          </button>
          <h2 className="font-bold text-base">{editId?"일정 수정":"일정 추가"}</h2>
          <div className="flex items-center gap-3">
            {editId && (
              <button onClick={()=>{ if(window.confirm("이 일정을 삭제하시겠습니까?")){ deleteEvent(editId); closeModal(); } }}
                className="text-red-500 font-bold text-base">
                삭제
              </button>
            )}
            <button onClick={submit} disabled={uploading} className="text-blue-500 font-bold text-base disabled:opacity-40">
              {uploading ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
        {/* 담당팀 드롭다운 트리거 */}
        <div className="relative pb-2 flex items-center gap-1">
          <button onClick={()=>setCalDropOpen(o=>!o)}
            className="flex items-center gap-1.5 text-xs font-semibold py-1 px-2 rounded-lg hover:bg-gray-50"
            style={{color: cals.find(c=>c.id===form.calId)?.color || "#9ca3af"}}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{background: cals.find(c=>c.id===form.calId)?.color || "#d1d5db"}}/>
            <span>{cals.find(c=>c.id===form.calId)?.label || "팀배정"}</span>
            <User size={12} className="opacity-60"/>
            <ChevronDown size={12} className={`opacity-60 transition-transform ${calDropOpen?"rotate-180":""}`}/>
          </button>
          {editId && <ReportStatusBadge eventId={editId} reports={reports}/>}
          {/* 사장이 직접 현장 청소를 겸할 때를 위한 진입점 — 평소엔 상세보기를 거치지 않고
              바로 이 화면으로 오기 때문에, 필요할 때만 쓰는 선택적 버튼으로 여기 둠 */}
          {editId && editEv && isSuperAdmin(currentUser) && getReportStatus(editId, reports) !== "완료" && (
            <button onClick={() => setFieldReportEv(editEv)}
              className="ml-auto text-[11px] font-bold px-2.5 py-1 rounded-full text-white shrink-0"
              style={{ background: "#1a56db" }}>
              🧹 내가 직접 청소 보고하기
            </button>
          )}
          {calDropOpen && (
            <div className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-[100] min-w-[140px] py-1 overflow-hidden">
              {calOptions.map(cal=>{
                const selected = form.calId === cal.id;
                return (
                  <button key={cal.id}
                    onClick={()=>{ set("calId",cal.id); setCalDropOpen(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-gray-50 transition-colors"
                    style={{fontWeight: selected?700:400, color: selected?cal.color:"#374151"}}>
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{background:cal.color}}/>
                    {cal.label}
                    {selected && <span className="ml-auto text-blue-500">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {/* 폼 본문 */}
      <div className="flex-1 overflow-y-auto bg-white">

        {/* 제목 */}
        <div className="flex items-center px-4 py-3 border-b border-gray-100 gap-3">
          <span className="w-3 h-3 rounded-full shrink-0"
            style={{background:cals.find(c=>c.id===form.calId)?.color||"#d1d5db"}}/>
          <input ref={tRef} value={form.title} onChange={e=>set("title",e.target.value)}
            placeholder="일정을 입력하세요."
            className={`flex-1 text-base font-medium outline-none text-gray-800 placeholder-gray-300 ${errs.title?"border-b border-red-400":""}`}/>
          {errs.title&&<p className="text-red-500 text-xs">{errs.title}</p>}
        </div>

        {/* 날짜 & 시간 — 네이버 앱 스타일 */}
        <DateTimePicker form={form} set={set} errs={errs} lockRepeat={scope==="instance"}/>

        {/* 주소 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
          <MapPin size={18} className="text-gray-400 shrink-0"/>
          <input value={form.place} onChange={e=>set("place",e.target.value)}
            placeholder="장소"
            className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-300"/>
          <MapLinkButton place={form.place} className="shrink-0 px-2 py-1 bg-blue-50 rounded-full text-blue-500 text-xs font-bold transition-colors hover:bg-blue-100">
            지도보기
          </MapLinkButton>
        </div>

        {/* 연락처 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
          <span className="text-gray-400 shrink-0 text-base">📞</span>
          <input
            value={form.contact||""}
            onChange={e=>set("contact",e.target.value)}
            placeholder="연락처"
            className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-300"/>
          {form.contact && form.contact.replace(/[^0-9]/g, '').length >= 9 && (
            <a href={`tel:${form.contact.replace(/[^0-9]/g, '')}`} className="shrink-0 px-2 py-1 bg-green-50 rounded-full text-green-600 text-xs font-bold transition-colors hover:bg-green-100">
              전화걸기
            </a>
          )}
        </div>

        {/* 내용 */}
        <div className="flex gap-3 px-4 py-4 border-b border-gray-100">
          <AlignLeft size={18} className="text-gray-400 shrink-0 mt-0.5"/>
          <textarea value={form.description}
            onChange={e => {
              set("description",e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            ref={el => {
              if (el) {
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }
            }}
            placeholder="내용 (작성하는 만큼 자동으로 늘어납니다)"
            className="flex-1 text-sm text-gray-800 outline-none resize-none placeholder-gray-300 leading-relaxed overflow-hidden"
            style={{minHeight: "120px"}}
          />
        </div>

        {/* 첨부사진 */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <span className="text-gray-400 shrink-0 text-base">📎</span>
            <span className="text-sm text-gray-700">첨부사진</span>
            <label className="ml-auto text-xs text-blue-500 font-bold cursor-pointer">
              + 추가
              <input type="file" accept="image/*" multiple className="hidden"
                onChange={e => {
                  const files = Array.from(e.target.files);
                  Promise.all(files.map(file => new Promise(resolve => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve({ name: file.name, data: reader.result });
                    reader.readAsDataURL(file);
                  }))).then(newPhotos => {
                    set("photos", [...(form.photos||[]), ...newPhotos]);
                  });
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          {(form.photos||[]).length > 0 && (
            <div className="flex gap-2 overflow-x-auto pl-7 pb-1">
              {(form.photos||[]).map((p, i) => (
                <div key={i} className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden border border-gray-200">
                  <img src={p.url || p.data} alt={p.name}
                    onClick={() => openLightbox(form.photos.map(x=>x.url||x.data), i)}
                    className="w-full h-full object-cover cursor-pointer"/>
                  <button onClick={() => set("photos", form.photos.filter((_,j)=>j!==i))}
                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center">
                    <X size={10} className="text-white"/>
                  </button>
                </div>
              ))}
            </div>
          )}
          {(form.photos||[]).length === 0 && (
            <p className="text-xs text-gray-300 pl-7">사진을 첨부하세요</p>
          )}
        </div>

        {/* 일정 추가사항 입력 — 현장팀장이 남긴 기록, 읽기 전용 (여기선 수정 불가) */}
        {form.leaderComment && (
          <div className="mx-4 mt-4 p-4 rounded-2xl border-2 border-amber-300 bg-amber-50">
            <span className="text-[13px] font-bold text-amber-700 block mb-2">📝 일정 추가사항 입력</span>
            <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">{form.leaderComment}</p>
          </div>
        )}

        {/* 완료 보고 미리보기 — 팀장이 등록한 청소 전/후 사진을 별도 화면 이동 없이 바로 확인 */}
        {editId && (() => {
          const report = reports.filter(r => r.eventId === editId && (r.status === "진행중" || r.status === "완료"))
            .sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""))[0];
          if (!report) return null;
          const before = report.beforePhotos || [];
          const after  = report.afterPhotos  || [];
          if (before.length === 0 && after.length === 0 && !report.memo) return null;
          return (
            <div className="mx-4 mt-4 p-4 rounded-2xl border-2 border-blue-200 bg-blue-50">
              <span className="text-[13px] font-bold text-blue-700 block mb-2">
                📷 완료 보고 미리보기{report.status === "진행중" ? " (진행중)" : ""}
              </span>
              {report.memo && (
                <p className="text-sm text-blue-900 whitespace-pre-wrap leading-relaxed mb-3">{report.memo}</p>
              )}
              <div className="flex flex-col gap-2">
                {before.length > 0 && (
                  <div>
                    <p className="text-xs text-blue-400 mb-1">청소 전</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {before.map((p,i)=>(
                        <button key={i} onClick={()=>openLightbox(before.map(x=>x.url), i)}
                          className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-white">
                          <img src={p.url} alt="" className="w-full h-full object-cover"/>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {after.length > 0 && (
                  <div>
                    <p className="text-xs text-blue-400 mb-1">청소 후</p>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {after.map((p,i)=>(
                        <button key={i} onClick={()=>openLightbox(after.map(x=>x.url), i)}
                          className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-white">
                          <img src={p.url} alt="" className="w-full h-full object-cover"/>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        <div className="h-8"/>
      </div>
      </>
      )}
    </div>
  );
}


// ── 상단 헤더 ─────────────────────────────────────────────────────
export function TopHeader() {
  const { current, setCurrent, setDrawer, sheetMode, setSheetMode, selDate, setSelDate, setSearchOpen, currentUser, companyDoc, onLogout, extraCalFilter, setExtraCalFilter } = useC();
  const y=current.getFullYear(), m=current.getMonth();
  const [picker,setPicker]=useState(false);
  const [companyPicker,setCompanyPicker]=useState(false);
  const [multiList,setMultiList]=useState(null);
  const [isMulti,setIsMulti]=useState(false);
  const DAYS=["일","월","화","수","목","금","토"];
  const d=pd(selDate), dow=d?.getDay()??0;

  // 로그인 시 다중 소속 여부 미리 확인
  useEffect(()=>{
    if(isSuperAdmin(currentUser)) { setIsMulti(false); return; }
    const phone = currentUser.phone;
    if(!phone) { setIsMulti(false); return; }
    getDocs(query(collection(db,"staffs"), where("phone","==",phone))).then(snap=>{
      const active = snap.docs.filter(d=>d.data().status !== "deleted");
      setIsMulti(active.length >= 2);
    }).catch(()=>setIsMulti(false));
  },[currentUser.uid]);

  // 다중 소속 회사 목록 불러오기
  const checkMulti = async () => {
    if(isSuperAdmin(currentUser)) return;
    const phone = currentUser.phone;
    if(!phone) return;
    let snap = await getDocs(query(collection(db,"staffs"), where("phone","==",phone)));
    if(snap.empty) snap = await getDocs(query(collection(db,"staffs"), where("phone","==",fmtPhone(phone))));
    const active = snap.docs.filter(d=>d.data().status !== "deleted");
    if(active.length < 2) return;
    const companies = await Promise.all(active.map(async d=>{
      const compDoc = await getDoc(doc(db,"companies",d.data().companyId));
      return { staffDoc:d, companyName:compDoc.exists()?compDoc.data().name:"알 수 없는 회사" };
    }));
    setMultiList(companies);
    setCompanyPicker(true);
  };

  return (
    <>
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 relative">
      {/* 왼쪽: 회사명 or 뒤로가기 */}
      <div className="flex items-center gap-3">
        {sheetMode===2
          ? <button onClick={()=>setSheetMode(1)} className="p-1 -ml-1"><ChevronLeft size={22} className="text-gray-700"/></button>
          : <button onClick={()=>setDrawer(true)} className="p-1 -ml-1"><Menu size={22} className="text-gray-700"/></button>
        }
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white shadow-sm overflow-hidden border border-gray-200"
            style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
            {(companyDoc?.logoUrl || currentUser?.companyLogoUrl)
              ? <img src={companyDoc?.logoUrl || currentUser.companyLogoUrl} alt="Logo" className="w-full h-full object-cover" />
              : ((companyDoc?.name || currentUser?.companyName)?.charAt(0) || "🏢")}
          </div>
          <span className="font-extrabold text-gray-900 text-lg">{companyDoc?.name || currentUser?.companyName || "로딩중..."}</span>
          {/* 다중 소속일 때만 전환 버튼 표시 */}
          {isMulti && (
            <button onClick={checkMulti} className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full font-bold">전환</button>
          )}
        </div>
        {/* 회사 전환 모달 */}
        {companyPicker && multiList && (
          <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
            <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
              <div className="text-3xl text-center mb-2">🔄</div>
              <h2 className="text-lg font-extrabold text-gray-900 text-center mb-1">회사 전환</h2>
              <p className="text-sm text-gray-400 text-center mb-5">어느 업체로 전환할까요?</p>
              <div className="flex flex-col gap-3">
                {multiList.map(({ staffDoc, companyName }) => (
                  <button key={staffDoc.id}
                    onClick={() => {
                      const data = staffDoc.data();
                      const user = { ...data, uid: staffDoc.id, companyName };
                      try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch {}
                      setCompanyPicker(false);
                      window.location.reload();
                    }}
                    className={`w-full py-4 rounded-2xl font-bold text-sm transition-all ${staffDoc.data().companyId === currentUser.companyId ? "border-2 border-blue-500 text-blue-600 bg-blue-50" : "text-white"}`}
                    style={staffDoc.data().companyId !== currentUser.companyId ? {background:"linear-gradient(135deg,#1a56db,#2563eb)"} : {}}>
                    {companyName} {staffDoc.data().companyId === currentUser.companyId ? "✓ 현재" : ""}
                  </button>
                ))}
                <button onClick={() => setCompanyPicker(false)}
                  className="w-full py-3 rounded-2xl font-bold text-sm text-gray-500 bg-gray-100">
                  취소
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 중앙 제목 */}
      {sheetMode===2
        ? <button onClick={()=>setPicker(!picker)} className="flex items-center gap-1 font-black text-lg text-gray-900">
            {m+1}. {d.getDate()}. {DAYS[dow]}요일 <ChevronDown size={15} className="text-gray-500 mt-0.5"/>
          </button>
        : <button onClick={()=>setPicker(!picker)} className="flex items-center gap-1 font-black text-xl text-gray-900">
            {y}. {m+1}. <ChevronDown size={18} className="text-gray-500 mt-0.5"/>
          </button>
      }

      {/* 우측 아이콘 */}
      <div className="flex items-center">
        <button onClick={()=>setSearchOpen(true)} className="p-2"><Search size={22} className="text-gray-700"/></button>
      </div>

      {/* 월 피커 */}
      {picker&&(
        <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-white rounded-2xl shadow-2xl border border-gray-100 z-30 p-4 w-72">
          <div className="flex items-center justify-between mb-3">
            <button onClick={()=>setCurrent(new Date(y-1,m,1))}><ChevronLeft size={18} className="text-gray-500"/></button>
            <span className="font-bold text-gray-800">{y}년</span>
            <button onClick={()=>setCurrent(new Date(y+1,m,1))}><ChevronRight size={18} className="text-gray-500"/></button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {Array.from({length:12},(_,i)=>(
              <button key={i} onClick={()=>{setCurrent(new Date(y,i,1));setPicker(false);}}
                className={`py-2 rounded-xl text-sm font-medium transition
                  ${i===m?"bg-blue-500 text-white":"text-gray-600 hover:bg-gray-100"}`}>{i+1}월</button>
            ))}
          </div>
          <button onClick={()=>{setCurrent(new Date());setSelDate(fmt(new Date()));setPicker(false);}}
            className="w-full mt-3 py-2 rounded-xl text-sm font-semibold text-blue-500 bg-blue-50">오늘로 이동</button>
        </div>
      )}
    </div>
    {/* 관리팀 전용 로컬 필터가 켜져 있을 때 — 잊고 계속 켜두는 걸 방지하는 표시 겸 바로 해제 버튼 */}
    {extraCalFilter && (
      <div className="flex items-center justify-between px-4 py-1.5 bg-purple-50 border-b border-purple-100">
        <span className="text-xs font-semibold text-purple-700">
          + {extraCalFilter.type === "team" ? extraCalFilter.label : extraCalFilter.name} 보는 중
        </span>
        <button onClick={()=>setExtraCalFilter(null)} className="p-0.5 text-purple-400 hover:text-purple-700">
          <X size={14}/>
        </button>
      </div>
    )}
    </>
  );
}

// ── 하단 플로팅 버튼 + 오늘 버튼 ─────────────────────────────────
export function FloatingButtons() {
  const { openModal, selDate, setCurrent, setSelDate, currentUser } = useC();
  // 일정 등록은 사장/관리팀·영업팀만 — 현장팀(청소팀) 팀장은 등록 불가, 보고만 가능
  const canAdd = isSuperAdmin(currentUser) || isAdminStaff(currentUser);
  return (
    <div className="fixed bottom-20 flex flex-col items-end gap-3 pointer-events-none z-40"
      style={{right: "max(1rem, calc((100vw - 430px) / 2 + 1rem))"}}>
      {/* 오늘 버튼 */}
      <button onClick={()=>{setCurrent(new Date());setSelDate(fmt(new Date()));}}
        className="pointer-events-auto flex items-center gap-1 bg-white rounded-full px-4 py-2 shadow-lg border border-gray-200 text-sm font-medium text-gray-700">
        ‹ 오늘
      </button>
      {/* 일정추가 버튼 — 팀원 제외 */}
      {canAdd && (
        <button onClick={()=>openModal(selDate)}
          className="pointer-events-auto flex items-center gap-1.5 bg-gray-900 rounded-full px-5 py-3 shadow-xl active:scale-95 transition-transform">
          <Plus size={16} className="text-white"/>
          <span className="text-white text-sm font-semibold">일정추가</span>
        </button>
      )}
    </div>
  );
}

// ── 앱 루트 ───────────────────────────────────────────────────────
// ── 검색 모달 ───────────────────────────────────────────────
export function SearchModal() {
  const { searchOpen, setSearchOpen, searchQuery: q, setSearchQuery: setQ, visibleEvents, setDetEv } = useC();
  
  if (!searchOpen) return null;

  const res = q.trim() ? visibleEvents.filter(e => 
    (e.title && e.title.includes(q)) || 
    (e.description && e.description.includes(q)) || 
    (e.place && e.place.includes(q)) ||
    (e.contact && e.contact.includes(q))
  ).sort((a,b) => new Date(b.start) - new Date(a.start)) : [];

  return (
    <div className="absolute inset-0 z-[60] bg-white flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <button onClick={() => setSearchOpen(false)} className="p-2 -ml-2 rounded-full hover:bg-gray-50">
          <ChevronLeft size={24} className="text-gray-700"/>
        </button>
        <div className="flex-1 flex items-center bg-gray-100 rounded-lg px-3 py-1.5">
          <Search size={18} className="text-gray-400 mr-2 shrink-0"/>
          <input 
            autoFocus
            value={q} 
            onChange={e => setQ(e.target.value)} 
            placeholder="제목, 내용, 장소, 연락처 검색" 
            className="bg-transparent flex-1 outline-none text-sm text-gray-800"
          />
          {q && <button onClick={()=>setQ("")}><X size={16} className="text-gray-400"/></button>}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto bg-gray-50/50">
        {!q.trim() && (
          <div className="py-20 flex flex-col items-center text-gray-400 text-sm">
            <Search size={40} strokeWidth={1} className="mb-3 text-gray-300"/>
            <p>검색어를 입력해 주세요</p>
          </div>
        )}
        {q.trim() && res.length === 0 && (
          <div className="py-20 text-center text-gray-400 text-sm">검색 결과가 없습니다</div>
        )}
        {res.map(ev => {
          const cal = CALS.find(c=>c.id===ev.calId);
          return (
            <div key={ev.id} onClick={() => { setDetEv(ev); setSearchOpen(false); }} className="bg-white p-4 border-b border-gray-100 active:bg-gray-50 cursor-pointer">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor: cal?.color||"#333"}}/>
                  <span className="font-bold text-gray-900 text-[15px]">{ev.title}</span>
                </div>
                <span className="text-[11px] font-semibold" style={{color: cal?.color||"#333"}}>{cal?.label}</span>
              </div>
              <div className="text-xs text-gray-500 pl-4.5 mt-1 font-medium">{ev.start} {ev.allDay ? "종일" : ev.startTime}</div>
              {ev.place && <div className="text-xs text-gray-500 pl-4.5 mt-1 truncate">{ev.place}</div>}
              {ev.description && <div className="text-xs text-gray-500 pl-4.5 mt-1 truncate">{ev.description}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
