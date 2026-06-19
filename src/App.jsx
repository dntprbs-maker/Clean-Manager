/**
 * 클린메니저 — 네이버 캘린더 완전 재현
 * 3단계 스와이프 모드:
 *   MODE 0 (full)  → 월간 그리드 전체 (이벤트 텍스트 바 표시)
 *   MODE 1 (half)  → 상단 도트 그리드 + 하단 시간표 시트
 *   MODE 2 (list)  → 그리드 숨김, 시간표 전체
 */

import {
  useState, useContext, createContext, useCallback,
  useMemo, useRef, useEffect
} from "react";
import {
  Search, Plus, X, MapPin, Link2, RotateCcw, Clock,
  Calendar, AlignLeft, ChevronDown, ChevronLeft,
  ChevronRight, Menu, Settings, User, Edit3, Trash2,
  PieChart, Bell, History, ExternalLink, Activity
} from "lucide-react";

// ── 캘린더 목록 ───────────────────────────────────────────────
const CALS = [
  { id:"friends", label:"더친구들",    color:"#4285F4", checked:true  },
  { id:"lh",      label:"전일 LH",     color:"#0F9D58", checked:true  },
  { id:"elec",    label:"전국동시",    color:"#EA4335", checked:true  },
  { id:"clean0",  label:"청소 0팀",    color:"#F4B400", checked:true  },
  { id:"import",  label:"중요한약속",  color:"#EA4335", checked:true  },
  { id:"manus",   label:"마누스",      color:"#4285F4", checked:true  },
  { id:"outer",   label:"청소 외주",   color:"#0F9D58", checked:true  },
  { id:"cancel",  label:"취소,변경",   color:"#607D8B", checked:true  },
  { id:"cr",      label:"클린메니저춘계",color:"#4285F4", checked:true  },
  { id:"uwork",   label:"우용준 일",   color:"#EA4335", checked:true  },
  { id:"popmart", label:"팝마트",      color:"#9C27B0", checked:true  },
  { id:"nabi",    label:"나비엠알",    color:"#9C27B0", checked:true  },
];

// ── 직원 관리 ───────────────────────────────────────────────
const INIT_TEAMS = ["사장", "관리팀", "영업팀", "입주청소팀", "정기청소팀", "에어컨청소팀"];
const ROLES = ["최고관리자", "팀장", "팀원"];
const INIT_USERS = [
  { id: "u1", name: "김사장", phone: "010-0000-0000", team: "사장", role: "최고관리자" },
  { id: "u2", name: "이관리", phone: "010-1111-1111", team: "관리팀", role: "팀장" },
  { id: "u3", name: "박영업", phone: "010-2222-2222", team: "영업팀", role: "팀장" },
  { id: "u4", name: "최입주", phone: "010-3333-3333", team: "입주청소팀", role: "팀장" },
  { id: "u5", name: "정팀원", phone: "010-4444-4444", team: "입주청소팀", role: "팀원" },
  { id: "u6", name: "강정기", phone: "010-5555-5555", team: "정기청소팀", role: "팀장" },
];

const HOLIDAYS = {
  "2026-01-01":"신정","2026-02-18":"설날","2026-03-01":"삼일절",
  "2026-05-05":"어린이날","2026-06-06":"현충일","2026-08-15":"광복절",
  "2026-09-25":"추석","2026-10-03":"개천절","2026-10-09":"한글날","2026-12-25":"크리스마스",
};
const WD = ["일","월","화","수","목","금","토"];
const REPEAT_OPTS = [
  {value:"none",label:"반복 없음"},{value:"daily",label:"매일"},
  {value:"weekly",label:"매주"},{value:"monthly",label:"매월"},
];

// ── 유틸 ──────────────────────────────────────────────────────
const fmt  = d=>{ if(!d)return""; const dt=typeof d==="string"?new Date(d+"T00:00:00"):d; return`${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}-${String(dt.getDate()).padStart(2,"0")}`; };
const pd   = s=>{ if(!s)return null; const[y,m,d]=s.split("-").map(Number); return new Date(y,m-1,d); };
const diff = (s,e)=>!s||!e?0:Math.round((pd(e)-pd(s))/864e5);
const add  = (s,n)=>{ const d=pd(s); d.setDate(d.getDate()+n); return fmt(d); };
const calById = id => CALS.find(c=>c.id===id)||CALS[0];

// 시간 포맷: "09:00" → "오전 9:00"
const fmtTime = t => {
  if(!t) return "";
  const [h,mi] = t.split(":").map(Number);
  const ampm = h<12?"오전":"오후";
  const h12  = h===0?12:h>12?h-12:h;
  // 한자리 시간도 두자리로 패딩 (9→09) → 줄 정렬 일치
  return `${ampm} ${String(h12).padStart(2,"0")}:${String(mi).padStart(2,"0")}`;
};

// ── 텍스트 자동 파싱 엔진 (정규식 기반) ─────────────────────────
function parseEventText(text) {
  const result = {
    title:"", start:"", end:"", allDay:false,
    startTime:"09:00", endTime:"10:00",
    place:"", description:text.trim(), url:"", calId:"clean0", repeat:"none",
  };
  const yr = new Date().getFullYear();

  // 날짜: "6월 15일" / "6/15"
  const d1 = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
  const d2 = text.match(/(\d{1,2})\/(\d{1,2})/);
  const dm = d1 || d2;
  if (dm) {
    const mo = String(dm[1]).padStart(2,"0");
    const dy = String(dm[2]).padStart(2,"0");
    result.start = yr + "-" + mo + "-" + dy;
    result.end   = yr + "-" + mo + "-" + dy;
  }

  // 시간: "오전 9시" / "오후 2시30분" / "오전" / "오후" / "종일" / "14시"
  let hasAM = text.includes("오전");
  let hasPM = text.includes("오후");
  const hasAllDay = text.includes("종일");
  
  let tm = text.match(/(오전|오후)\s*(\d{1,2})시?(?:\s*(\d{2})분?)?/);
  if (!tm) {
    const tm2 = text.match(/(\d{1,2})시(?:\s*(\d{2})분?)?/);
    if (tm2) {
      let h = parseInt(tm2[1]);
      if (h < 12) hasAM = true;
      else hasPM = true;
      let ap = h < 12 ? "오전" : "오후";
      let displayH = h > 12 ? h - 12 : (h === 0 ? 12 : h);
      tm = [tm2[0], ap, displayH, tm2[2]];
    }
  }
  if (tm) {
    const ap = tm[1]; let h = parseInt(tm[2]); const mi = tm[3]?parseInt(tm[3]):0;
    if (ap==="오후" && h<12) h+=12;
    if (ap==="오전" && h===12) h=0;
    result.startTime = String(h).padStart(2,"0")+":"+String(mi).padStart(2,"0");
    result.endTime   = String(h+1).padStart(2,"0")+":"+String(mi).padStart(2,"0");
    result.allDay = false;
  } else if (hasAM) {
    result.startTime="09:00"; result.endTime="11:00"; result.allDay=false;
  } else if (hasPM) {
    result.startTime="14:00"; result.endTime="16:00"; result.allDay=false;
  } else if (hasAllDay) {
    result.allDay=true;
  } else {
    result.allDay=false;
  }

  // 장소: 주소 패턴 줄 (설명글이 섞이지 않도록 첫 번째 주소만 정확히 캐치)
  const lines = text.split("\n");
  const pl = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l) continue;
    const isAddr = 
      /(서울|부산|인천|대구|대전|광주|울산|세종|제주|경기|강원|충북|충남|전북|전남|경북|경남)/.test(l) ||
      /[가-힣]+(로|길|동|구|읍|면)\s*\d/.test(l);
      
    if (isAddr) {
      // 주소로 보이는 첫 번째 줄 추가
      pl.push(l);
      // 바로 다음 줄이 짧은 상세 주소(예: "2층 201호")일 경우 같이 붙여줌
      const next = lines[i+1]?.trim();
      if (next && next.length < 20 && (/\d+층/.test(next) || /\d+호/.test(next))) {
        pl.push(next);
      }
      break; // 주소 덩어리를 찾았으면 즉시 중단 (긴 설명글 방지)
    }
  }
  result.place = pl.join(" ");

  // 전화번호 + 이름
  const phones = [];
  const phoneRe = /([가-힣]{2,4})\s+(010[-\s]?\d{3,4}[-\s]?\d{4})/g;
  let pm;
  while ((pm = phoneRe.exec(text)) !== null) {
    phones.push({ name:pm[1].trim(), phone:pm[2].trim() });
  }
  if (phones.length === 0) {
    const op = text.match(/010[-\s]?\d{3,4}[-\s]?\d{4}/);
    if (op) phones.push({ name:"", phone:op[0] });
  }

  // 비밀번호
  const pw = text.match(/(비밀번호|비번)\s*[:：]?\s*([0-9*#!@]+)/);
  const password = pw ? pw[2] : "";

  // 제목 자동 생성 (시간 -> 지역 -> 면적/방개수)
  const tp = [];
  if (hasAllDay) tp.push("종일");
  else if (hasAM) tp.push("오전");
  else if (hasPM) tp.push("오후");

  if (result.place) {
    const dg = result.place.match(/([가-힣]+(구|동|로|길))/);
    if (dg) tp.push(dg[1]);
  }

  const roomMatch = text.match(/([가-힣]*방\s*\d+개|원룸|투룸|쓰리룸|포룸|\d+평)/);
  if (roomMatch) {
    tp.push(roomMatch[1]);
  } else if (phones.length>0 && phones[0].name) {
    tp.push(phones[0].name); // 방 정보가 없으면 담당자 이름으로 대체
  }
  result.title = tp.join(" ");

  // 연락처 필드 별도 저장
  result.contact = phones.map(function(p){ return (p.name?p.name+" ":"")+p.phone; }).join(", ");

  // 내용: 원본 전체 + 비밀번호
  let desc = text.trim();
  if (password) desc += "\n\n🔐 비밀번호: " + password;
  result.description = desc;

  return result;
}

// ── Context ───────────────────────────────────────────────────
const Ctx = createContext(null);
const useC = () => useContext(Ctx);
let _i=1; const uid=()=>`e${_i++}`;

// ── 샘플 데이터 (사진 실제 내용 기반) ────────────────────────
const makeSamples = () => {
  const y=2026, m="06";
  return [
    // 1일 주
    {id:uid(),title:"더친구들",calId:"friends",start:`${y}-${m}-01`,end:`${y}-${m}-01`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"전일 LH",calId:"lh",     start:`${y}-${m}-01`,end:`${y}-${m}-04`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"오후 마포",calId:"clean0",start:`${y}-${m}-01`,end:`${y}-${m}-01`,allDay:false,startTime:"13:00",endTime:"15:00",place:"마포",description:"",repeat:"none"},
    {id:uid(),title:"정기청소",calId:"regular",start:`${y}-${m}-01`,end:`${y}-${m}-01`,allDay:false,startTime:"15:00",endTime:"17:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"리버뷰 정기청소",calId:"review",start:`${y}-${m}-01`,end:`${y}-${m}-01`,allDay:false,startTime:"17:00",endTime:"19:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"SK 쉴더",calId:"sk",    start:`${y}-${m}-01`,end:`${y}-${m}-01`,allDay:false,startTime:"09:00",endTime:"10:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"전국동시",calId:"elec",  start:`${y}-${m}-03`,end:`${y}-${m}-03`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"오후 리버",calId:"clean0",start:`${y}-${m}-03`,end:`${y}-${m}-03`,allDay:false,startTime:"14:00",endTime:"16:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"플랜아이",calId:"import",start:`${y}-${m}-02`,end:`${y}-${m}-02`,allDay:false,startTime:"11:00",endTime:"12:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"오후 광명",calId:"clean0",start:`${y}-${m}-02`,end:`${y}-${m}-02`,allDay:false,startTime:"14:00",endTime:"16:00",place:"광명",description:"",repeat:"none"},
    {id:uid(),title:"숨고 고수",calId:"manus",start:`${y}-${m}-02`,end:`${y}-${m}-02`,allDay:false,startTime:"10:00",endTime:"11:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"현충일",calId:"import",  start:`${y}-${m}-06`,end:`${y}-${m}-06`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"망종",calId:"import",    start:`${y}-${m}-06`,end:`${y}-${m}-06`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"리버뷰 입",calId:"review",start:`${y}-${m}-06`,end:`${y}-${m}-06`,allDay:false,startTime:"17:00",endTime:"19:00",place:"",description:"",repeat:"none"},
    // 7~13일
    {id:uid(),title:"에어몰 쇼",calId:"outer",  start:`${y}-${m}-07`,end:`${y}-${m}-07`,allDay:false,startTime:"09:00",endTime:"10:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"전월 수입",calId:"manus",  start:`${y}-${m}-07`,end:`${y}-${m}-07`,allDay:false,startTime:"10:00",endTime:"11:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"리버뷰 정기",calId:"review",start:`${y}-${m}-07`,end:`${y}-${m}-07`,allDay:false,startTime:"17:00",endTime:"19:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"이발",calId:"import",      start:`${y}-${m}-07`,end:`${y}-${m}-07`,allDay:false,startTime:"14:00",endTime:"15:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"Netlify",calId:"netlify",  start:`${y}-${m}-08`,end:`${y}-${m}-08`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"러버블 작",calId:"clean0", start:`${y}-${m}-08`,end:`${y}-${m}-08`,allDay:false,startTime:"10:00",endTime:"12:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"리버뷰 감",calId:"review", start:`${y}-${m}-08`,end:`${y}-${m}-08`,allDay:false,startTime:"13:00",endTime:"15:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"소포우편",calId:"manus",   start:`${y}-${m}-09`,end:`${y}-${m}-09`,allDay:false,startTime:"10:00",endTime:"11:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"소공동 정",calId:"regular",start:`${y}-${m}-09`,end:`${y}-${m}-09`,allDay:false,startTime:"17:00",endTime:"19:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"전일 LH",calId:"lh",       start:`${y}-${m}-11`,end:`${y}-${m}-11`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"숨고 고수",calId:"manus",  start:`${y}-${m}-11`,end:`${y}-${m}-11`,allDay:false,startTime:"10:00",endTime:"11:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"소공동 정",calId:"regular",start:`${y}-${m}-11`,end:`${y}-${m}-11`,allDay:false,startTime:"17:00",endTime:"19:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"리버뷰 정",calId:"review", start:`${y}-${m}-11`,end:`${y}-${m}-11`,allDay:false,startTime:"19:00",endTime:"21:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"팝마트 홍",calId:"popmart",start:`${y}-${m}-11`,end:`${y}-${m}-11`,allDay:false,startTime:"20:00",endTime:"22:00",place:"홍대",description:"",repeat:"none"},
    {id:uid(),title:"청소기 2",calId:"clean0",  start:`${y}-${m}-12`,end:`${y}-${m}-12`,allDay:false,startTime:"10:00",endTime:"12:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"전일 천호",calId:"lh",      start:`${y}-${m}-12`,end:`${y}-${m}-12`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"이유래 김",calId:"import",  start:`${y}-${m}-12`,end:`${y}-${m}-12`,allDay:false,startTime:"14:00",endTime:"15:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"윈드클린",calId:"outer",    start:`${y}-${m}-12`,end:`${y}-${m}-12`,allDay:false,startTime:"09:00",endTime:"11:00",place:"",description:"",repeat:"none"},
    // 14~20
    {id:uid(),title:"전일 삼성",calId:"lh",      start:`${y}-${m}-13`,end:`${y}-${m}-14`,allDay:true, startTime:"",endTime:"",place:"삼성",description:"",repeat:"none"},
    {id:uid(),title:"러브에이",calId:"import",   start:`${y}-${m}-13`,end:`${y}-${m}-13`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"오전 은평",calId:"clean0",  start:`${y}-${m}-13`,end:`${y}-${m}-13`,allDay:false,startTime:"09:00",endTime:"11:00",place:"은평",description:"",repeat:"none"},
    {id:uid(),title:"전일 조민",calId:"lh",      start:`${y}-${m}-13`,end:`${y}-${m}-13`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"청소119",calId:"clean0",    start:`${y}-${m}-14`,end:`${y}-${m}-14`,allDay:false,startTime:"09:00",endTime:"11:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"클린메니저 춘계 아유회",calId:"cr",start:`${y}-${m}-16`,end:`${y}-${m}-17`,allDay:true,startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"소공동 정",calId:"regular", start:`${y}-${m}-16`,end:`${y}-${m}-16`,allDay:false,startTime:"17:00",endTime:"19:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"오후 중화",calId:"clean0",  start:`${y}-${m}-17`,end:`${y}-${m}-17`,allDay:false,startTime:"14:00",endTime:"16:00",place:"중화",description:"",repeat:"none"},
    {id:uid(),title:"인천 서구",calId:"clean0",  start:`${y}-${m}-17`,end:`${y}-${m}-17`,allDay:false,startTime:"10:00",endTime:"12:00",place:"인천",description:"",repeat:"none"},
    {id:uid(),title:"강서 에스",calId:"clean0",  start:`${y}-${m}-17`,end:`${y}-${m}-17`,allDay:false,startTime:"16:00",endTime:"18:00",place:"강서",description:"",repeat:"none"},
    // 오늘 (15일) 일정
    {id:uid(),title:"오전 망우 (브로클린)(2명)",calId:"clean0",start:`${y}-${m}-15`,end:`${y}-${m}-15`,allDay:false,startTime:"09:00",endTime:"11:00",place:"망우",description:"",repeat:"none"},
    {id:uid(),title:"LH 청구",calId:"import",    start:`${y}-${m}-15`,end:`${y}-${m}-15`,allDay:false,startTime:"12:00",endTime:"13:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"오후 회기동 원룸(윈드클린)",calId:"clean0",start:`${y}-${m}-15`,end:`${y}-${m}-15`,allDay:false,startTime:"14:00",endTime:"15:00",place:"회기동",description:"",repeat:"none"},
    {id:uid(),title:"직원급여",calId:"import",   start:`${y}-${m}-15`,end:`${y}-${m}-15`,allDay:false,startTime:"17:00",endTime:"18:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"사무실 지출",calId:"manus", start:`${y}-${m}-15`,end:`${y}-${m}-15`,allDay:false,startTime:"18:00",endTime:"19:00",place:"",description:"",repeat:"none"},
    // 18~25
    {id:uid(),title:"소공동 정",calId:"regular", start:`${y}-${m}-18`,end:`${y}-${m}-18`,allDay:false,startTime:"17:00",endTime:"19:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"리버뷰 정",calId:"review",  start:`${y}-${m}-18`,end:`${y}-${m}-18`,allDay:false,startTime:"19:00",endTime:"21:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"팝마트 홍",calId:"popmart", start:`${y}-${m}-18`,end:`${y}-${m}-18`,allDay:false,startTime:"20:00",endTime:"22:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"단오",calId:"import",       start:`${y}-${m}-19`,end:`${y}-${m}-19`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"윈드클린",calId:"outer",    start:`${y}-${m}-19`,end:`${y}-${m}-19`,allDay:false,startTime:"09:00",endTime:"11:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"종일 부천",calId:"lh",      start:`${y}-${m}-20`,end:`${y}-${m}-20`,allDay:true, startTime:"",endTime:"",place:"부천",description:"",repeat:"none"},
    {id:uid(),title:"나비엠알",calId:"nabi",     start:`${y}-${m}-20`,end:`${y}-${m}-20`,allDay:false,startTime:"14:00",endTime:"16:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"팝마트코",calId:"popmart",  start:`${y}-${m}-20`,end:`${y}-${m}-20`,allDay:false,startTime:"16:00",endTime:"18:00",place:"",description:"",repeat:"none"},
    // 25일 (사진 3 기반)
    {id:uid(),title:"조절 인천 만수동 서근범 소장님",calId:"clean0",start:`${y}-${m}-25`,end:`${y}-${m}-25`,allDay:false,startTime:"09:00",endTime:"10:00",place:"인천 만수동",description:"",repeat:"none"},
    {id:uid(),title:"통일로컨테이너 창고 임대",calId:"import",start:`${y}-${m}-25`,end:`${y}-${m}-25`,allDay:false,startTime:"10:00",endTime:"11:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"소공동 정기 청소",calId:"regular",start:`${y}-${m}-25`,end:`${y}-${m}-25`,allDay:false,startTime:"19:00",endTime:"20:00",place:"소공동",description:"",repeat:"none"},
    {id:uid(),title:"리버뷰 정기청소",calId:"review",start:`${y}-${m}-25`,end:`${y}-${m}-25`,allDay:false,startTime:"20:00",endTime:"21:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"리버뷰 퇴실청소 청구",calId:"import",start:`${y}-${m}-25`,end:`${y}-${m}-25`,allDay:false,startTime:"22:00",endTime:"23:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"팝마트 홍대매장청소",calId:"popmart",start:`${y}-${m}-25`,end:`${y}-${m}-25`,allDay:false,startTime:"22:00",endTime:"23:00",place:"홍대",description:"",repeat:"none"},
    // 29~30
    {id:uid(),title:"우용준 휴가",calId:"uwork", start:`${y}-${m}-29`,end:`${y}-07-03`,allDay:true, startTime:"",endTime:"",place:"",description:"",repeat:"none"},
    {id:uid(),title:"소공동 정",calId:"regular", start:`${y}-${m}-30`,end:`${y}-${m}-30`,allDay:false,startTime:"17:00",endTime:"19:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"정기청소",calId:"regular",  start:`${y}-${m}-30`,end:`${y}-${m}-30`,allDay:false,startTime:"19:00",endTime:"21:00",place:"",description:"",repeat:"none"},
    {id:uid(),title:"팝마트 홍",calId:"popmart", start:`${y}-${m}-30`,end:`${y}-${m}-30`,allDay:false,startTime:"20:00",endTime:"22:00",place:"",description:"",repeat:"none"},
  ];
};

// ── localStorage 저장/불러오기 헬퍼 ─────────────────────────────
// 주의: Claude 아티팩트 미리보기에서는 동작 안 함 (GitHub Pages 배포 후 정상)
const LS_KEY_EVENTS = "cleandream_events";
const LS_KEY_CALS   = "cleandream_cals";

function loadFromStorage(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch(e) { /* 아티팩트 환경 등에서 접근 불가 시 무시 */ }
  return fallback;
}

function saveToStorage(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch(e) { /* 저장 실패 무시 */ }
}

function Provider({ children }) {
  // 저장된 데이터 있으면 불러오고, 없으면 샘플 데이터
  const [events,setEvents]     = useState(() => loadFromStorage(LS_KEY_EVENTS, makeSamples()));
  const [cals,setCals]         = useState(() => loadFromStorage(LS_KEY_CALS, CALS));
  const [modal,setModal]       = useState({open:false,date:null,editId:null});
  const [current,setCurrent]   = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selDate,setSelDate]   = useState(() => fmt(new Date()));
  const [detEv,setDetEv]       = useState(null);
  const [fieldReportEv, setFieldReportEv] = useState(null);
  const [drawer,setDrawer]     = useState(false);
  const [searchOpen,setSearchOpen] = useState(false);
  const [searchQuery,setSearchQuery] = useState("");
  // 0=full month bar, 1=half dot+sheet, 2=list only
  const [sheetMode,setSheetMode] = useState(1); // 기본: 도트그리드+시트

  // 직원 관리 상태
  const [teams, setTeams] = useState(INIT_TEAMS);
  const [teamModal, setTeamModal] = useState(false);
  const [users, setUsers] = useState(INIT_USERS);
  const [currentUser, setCurrentUser] = useState(INIT_USERS[0]); 
  const [currentScreen, setCurrentScreen] = useState("calendar"); // "calendar" | "employees"
  const [empModal, setEmpModal] = useState({ open: false, editId: null });

  // 부가 기능 상태
  const [activityLogs, setActivityLogs] = useState([]);
  const [notices, setNotices] = useState([
    { id: "n1", title: "이번 주말 작업 시 안전화 필수 착용", author: "김사장", date: "2026-06-18" }
  ]);
  const [links, setLinks] = useState([]); // 처음에는 빈 목록

  const addLog = useCallback((action, detail) => {
    setActivityLogs(p => [{ id: uid(), time: new Date().toISOString(), user: currentUser, action, detail }, ...p].slice(0, 100));
  }, [currentUser]);

  const addEvent    = useCallback(ev => {
    setEvents(p => [...p, { ...ev, id: uid() }]);
    addLog("등록", `'${ev.title}' 일정을 등록했습니다.`);
  }, [addLog]);
  
  const updateEvent = useCallback(ev => {
    setEvents(p => p.map(e => e.id === ev.id ? ev : e));
    addLog("수정", `'${ev.title}' 일정을 수정했습니다.`);
  }, [addLog]);
  
  const deleteEvent = useCallback(id => {
    setEvents(p => {
      const target = p.find(e => e.id === id);
      if (target) addLog("삭제", `'${target.title}' 일정을 삭제했습니다.`);
      return p.filter(e => e.id !== id);
    });
  }, [addLog]);
  
  const openModal   = useCallback((date=null,editId=null)=>setModal({open:true,date,editId}),[]);
  const closeModal  = useCallback(()=>setModal({open:false,date:null,editId:null}),[]);
  const toggleCal   = useCallback(id=>setCals(p=>p.map(c=>c.id===id?{...c,checked:!c.checked}:c)),[]);

  // events 변경 시마다 localStorage 자동 저장
  useEffect(()=>{ saveToStorage(LS_KEY_EVENTS, events); }, [events]);
  // cals(캘린더 ON/OFF) 변경 시마다 저장
  useEffect(()=>{ saveToStorage(LS_KEY_CALS, cals); }, [cals]);

  const checkedIds     = useMemo(()=>new Set(cals.filter(c=>c.checked).map(c=>c.id)),[cals]);
  const visibleEvents  = useMemo(()=>{
    let evs = events.filter(e=>checkedIds.has(e.calId));
    // 청소팀 권한 체크: 사장/관리/영업팀이 아니면, 본인 팀과 관련된 캘린더만 열람 가능하도록 제한
    if (!["사장", "관리팀", "영업팀"].includes(currentUser.team)) {
      const myTeamKeyword = currentUser.team.replace("팀", ""); // 예: "정기청소"
      evs = evs.filter(e => {
        const cal = CALS.find(c=>c.id===e.calId);
        return cal && cal.label.includes(myTeamKeyword);
      });
    }
    return evs;
  }, [events, checkedIds, currentUser.team]);

  return (
    <Ctx.Provider value={{
      events,visibleEvents,addEvent,updateEvent,deleteEvent,
      fieldReportEv,setFieldReportEv,
      cals,toggleCal,
      modal,openModal,closeModal,
      current,setCurrent,
      selDate,setSelDate,
      detEv,setDetEv,
      drawer,setDrawer,
      searchOpen,setSearchOpen,
      searchQuery,setSearchQuery,
      sheetMode,setSheetMode,
      teams,setTeams,teamModal,setTeamModal,
      users,setUsers,
      currentUser,setCurrentUser,
      currentScreen,setCurrentScreen,
      empModal,setEmpModal,
      activityLogs,setActivityLogs,
      notices,setNotices,
      links,setLinks,
    }}>
      {children}
    </Ctx.Provider>
  );
}

// ── 연속 일정 레이아웃 알고리즘 ──────────────────────────────────
function buildLayout(events, wk) {
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
function TextBar({ item, onClick }) {
  const {ev,isS,isE,isMulti}=item;
  const c=calById(ev.calId);
  return (
    <div onClick={e=>{e.stopPropagation();onClick(ev);}} title={ev.title}
      style={{
        backgroundColor: isMulti ? c.color : "#fff",
        color: isMulti ? "#fff" : c.color,
        borderLeft: isMulti&&!isS ? "none" : `2.5px solid ${c.color}`,
        borderRadius:`${isS?"3px":"0"} ${isE?"3px":"0"} ${isE?"3px":"0"} ${isS?"3px":"0"}`,
        marginLeft: isMulti&&!isS ? 0 : 1,
        marginRight: isMulti&&!isE ? 0 : 1,
        paddingLeft: isMulti&&!isS ? 2 : 3,
        boxShadow: isMulti ? "none" : `inset 0 0 0 1px ${c.color}22`,
      }}
      className="text-[10px] leading-tight py-[2px] pr-0.5 mb-[2px] truncate cursor-pointer select-none font-medium">
      {isS&&!ev.allDay&&ev.startTime&&<span className="opacity-60 mr-0.5">{ev.startTime.slice(0,5)}</span>}
      {isS||isMulti ? ev.title : ev.title}
    </div>
  );
}

// ── MODE 0: 풀 월간 뷰 (이벤트 바 표시) ──────────────────────────
const MAX_BARS_FULL = 4;

function FullMonthCell({ ds, isCm, items, onDate, onEvt }) {
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
function DotCell({ ds, isCm, dots, onDate, selDate }) {
  const today=fmt(new Date()), isToday=ds===today, isSel=ds===selDate;
  const d=pd(ds), dow=d.getDay();
  const isHol=!!HOLIDAYS[ds], isSun=dow===0, isSat=dow===6;

  let nc = !isCm ? "text-gray-300"
         : (isSun||isHol) ? "text-red-500"
         : isSat ? "text-blue-500"
         : "text-gray-900";

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
function useDates(current) {
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
function ScheduleList({ selDate, compact=false }) {
  const { visibleEvents, setDetEv, setSelDate, setCurrent, setSheetMode, openModal } = useC();
  const d=pd(selDate), dow=d.getDay();
  const DAYS=["일","월","화","수","목","금","토"];
  const isHol=!!HOLIDAYS[selDate];

  const dayEvts = visibleEvents
    .filter(ev=>ev.start<=selDate&&(ev.end||ev.start)>=selDate)
    .sort((a,b)=>{
      if(a.allDay!==b.allDay) return a.allDay?-1:1;
      return (a.startTime||"").localeCompare(b.startTime||"");
    });

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
        <button onClick={()=>openModal(selDate)} className="text-blue-500 text-sm font-semibold">+ 추가</button>
      </div>

      {/* 이벤트 목록 */}
      <div className="flex-1 overflow-y-auto">
        {/* 종일 */}
        {allDayEvts.map(ev=>{
          const c=calById(ev.calId);
          const isMulti=diff(ev.start,ev.end||ev.start)>0;
          return(
            <div key={ev.id} onClick={()=>setDetEv(ev)}
              className="flex items-center px-4 py-1.5 border-b border-gray-50 cursor-pointer">
              {isMulti
                ? <span className="text-sm px-2 py-0.5 rounded text-white font-medium mr-2 truncate max-w-[80%]"
                    style={{background:c.color}}>{ev.title}</span>
                : <>
                    <div className="w-1 h-5 rounded-full mr-3" style={{background:c.color}}/>
                    <span className="text-sm text-gray-800">{ev.title}</span>
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
              const c=calById(ev.calId);
              return(
                <div key={ev.id} onClick={()=>setDetEv(ev)}
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
                  {/* 제목 + 장소 */}
                  <div className="flex-1 flex flex-col justify-center">
                    <p className="text-sm font-semibold text-gray-900 leading-snug">{ev.title}</p>
                    {ev.place&&(
                      <p className="text-xs text-gray-400 mt-0.5">{ev.place}</p>
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
            <button onClick={()=>openModal(selDate)} className="mt-3 text-blue-500 text-sm">일정 추가하기</button>
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
function useSwipe({ onUp, onDown, onLeft, onRight,
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
const ANIM_CSS = `
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

function SlideTransition({ children, slideKey, direction }) {
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

function ListTransition({ children, direction, listKey }) {
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
function ModeTransition({ children, mode }) {
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
function CalendarView() {
  const {
    visibleEvents, current, setCurrent,
    selDate, setSelDate,
    sheetMode, setSheetMode,
    setDetEv,
  } = useC();
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

  // ── 그리드용 스와이프
  const gridSwipe = useSwipe({
    onLeft:  goNextMonth,
    onRight: goPrevMonth,
    onUp:    () => setSheetMode(m => m < 2 ? m + 1 : m),
    onDown:  () => setSheetMode(m => m > 0 ? m - 1 : m),
    hThreshold: 30,
    vThreshold: 30,
  });

  // ── 시간표용 스와이프
  const listSwipe = useSwipe({
    onLeft:  goNextDay,
    onRight: goPrevDay,
    onUp:    () => setSheetMode(m => m < 2 ? m + 1 : m),
    onDown:  () => setSheetMode(m => m > 0 ? m - 1 : m),
    hThreshold: 30,
    vThreshold: 30,
  });

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
                      onEvt={ev => setDetEv(ev)}/>
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
                      .map(ev => calById(ev.calId).color);
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
function DetailSheet() {
  const { detEv, setDetEv, deleteEvent, openModal, setFieldReportEv, currentUser } = useC();
  const [vis,setVis]=useState(false);
  useEffect(()=>{ if(detEv)setTimeout(()=>setVis(true),10); else setVis(false); },[detEv]);
  if(!detEv) return null;
  const cal=calById(detEv.calId);
  const close=()=>{ setVis(false); setTimeout(()=>setDetEv(null),280); };

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
            <button onClick={close} className="p-2 rounded-full hover:bg-gray-100"><X size={22} className="text-gray-700"/></button>
          </div>
          <span className="text-base font-bold text-gray-800">일정</span>
          <div className="flex gap-1">
            <button onClick={()=>{close();setTimeout(()=>openModal(null,detEv.id),300);}}
              className="p-2 rounded-full hover:bg-gray-100"><Edit3 size={19} className="text-gray-600"/></button>
            <button onClick={()=>{deleteEvent(detEv.id);close();}}
              className="p-2 rounded-full hover:bg-gray-100"><Trash2 size={19} className="text-gray-600"/></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto pb-10 max-h-[80vh]">
          {/* 담당팀 */}
          <div className="flex items-center px-5 py-4 border-b border-gray-50 gap-1">
            <span style={{color:cal.color}} className="font-semibold text-[15px]">{cal.label}</span>
            <User size={14} className="text-gray-400 ml-0.5"/>
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

          {/* 장소 */}
          {detEv.place && (
            <div className="flex items-start px-5 py-5 border-b border-gray-100 gap-4">
              <MapPin size={20} className="text-gray-400 shrink-0 mt-0.5"/>
              <a href={`https://map.naver.com/v5/search/${encodeURIComponent(detEv.place)}`} target="_blank" rel="noopener noreferrer" className="flex-1 text-[15px] text-gray-800 hover:underline leading-relaxed">
                {detEv.place}
              </a>
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
          {/* 팀장 이상만 보이는 현장 완료 보고 버튼 */}
          {(currentUser.role === "팀장" || currentUser.role === "최고관리자") && (
            <div className="px-4 py-4 border-t border-gray-100 mt-2">
              <button
                onClick={() => { setFieldReportEv(detEv); setDetEv(null); }}
                className="w-full py-4 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2"
                style={{ background: "linear-gradient(135deg, #1a56db 0%, #2563eb 100%)" }}>
                🧹 현장 완료 보고
              </button>
            </div>
          )}
        </div>
    </div>
  );
}

// ── 사이드 드로어 (스와이프 열기/닫기 지원) ───────────────────────
function SideDrawer() {
  const { drawer, setDrawer, cals, toggleCal, currentUser, setCurrentUser, setCurrentScreen, users } = useC();

  // 드래그 상태
  const startX   = useRef(null);
  const startY   = useRef(null);
  const curX     = useRef(0);        // 현재 드래그 X 오프셋
  const dragging = useRef(false);
  const panelRef = useRef(null);
  const DRAWER_W = 288; // w-72 = 18rem = 288px

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

    if (drawer) {
      // 열린 상태 → 왼쪽으로 밀어 닫기
      curX.current = Math.min(0, dx); // dx 음수일 때만
      applyX(curX.current);
    } else {
      // 닫힌 상태: 오른쪽 끝에서 시작한 스와이프만 (엣지 20px)
      if (startX.current <= 20 && dx > 0) {
        curX.current = -DRAWER_W + dx;
        applyX(curX.current);
      }
    }
  };

  const onTouchEnd = () => {
    if (!dragging.current) { dragging.current = false; return; }
    dragging.current = false;
    const threshold = DRAWER_W * 0.35;
    if (drawer) {
      // 35% 이상 당기면 닫기
      if (curX.current < -threshold) { setDrawer(false); resetPanel(false); }
      else                            { resetPanel(true); }
    } else {
      // 35% 이상 밀면 열기
      if (curX.current > -DRAWER_W + threshold) { setDrawer(true); resetPanel(true); }
      else                                        { resetPanel(false); }
    }
  };

  // drawer prop 변경 시 transition 복구
  useEffect(() => { resetPanel(drawer); }, [drawer]);

  return (
    <>
      {/* 배경 오버레이 — 탭해서 닫기 */}
      <div
        className="absolute inset-0 z-40 transition-opacity duration-300"
        style={{
          background: "rgba(0,0,0,0.35)",
          opacity: drawer ? 1 : 0,
          pointerEvents: drawer ? "auto" : "none",
        }}
        onClick={() => setDrawer(false)}
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
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* 프로필 헤더 */}
        <div className="px-4 pt-12 pb-4 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-xl border border-blue-100">🏠</div>
              <div><p className="font-bold text-base">{currentUser.name}</p><p className="text-xs text-gray-500">{currentUser.team} · {currentUser.role}</p></div>
            </div>
            {/* 테스트용 계정 전환 (디버깅) */}
            <select className="text-[10px] border border-gray-200 text-gray-500 p-1 rounded outline-none" onChange={e => setCurrentUser(users.find(u=>u.id===e.target.value))} value={currentUser.id}>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.team})</option>)}
            </select>
          </div>
          <div className="flex mt-3">
            <button onClick={()=>{setDrawer(false); setCurrentScreen("calendar");}} className="w-full py-2 rounded-xl border border-gray-200 text-xs text-gray-800 font-bold bg-white shadow-sm flex items-center justify-center gap-1 hover:bg-gray-50">
              <Calendar size={14}/> 캘린더 바로가기
            </button>
          </div>
        </div>

        {/* 전체 메뉴 */}
        <div className="flex-1 overflow-y-auto bg-gray-50 py-3">
          {(currentUser.team === "사장" || currentUser.team === "관리팀") && (
            <button 
              onClick={() => { setCurrentScreen("employees"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <User size={20} className="text-blue-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">직원 관리</span>
            </button>
          )}
          <button 
            onClick={() => { setCurrentScreen("team_schedule"); setDrawer(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <Calendar size={20} className="text-indigo-500" />
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">팀별 일정</span>
          </button>
          <button 
            onClick={() => { setCurrentScreen("dashboard"); setDrawer(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <PieChart size={20} className="text-blue-500" />
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">일정 요약</span>
          </button>
          <button 
            onClick={() => { setCurrentScreen("notice"); setDrawer(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <Bell size={20} className="text-orange-500" />
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">팀 공지사항</span>
          </button>
          <button 
            onClick={() => { setCurrentScreen("activity_log"); setDrawer(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <History size={20} className="text-green-500" />
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">최근 작업 내역</span>
          </button>
          <button 
            onClick={() => { setCurrentScreen("links"); setDrawer(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <ExternalLink size={20} className="text-purple-500" />
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">자주 쓰는 외부 링크</span>
          </button>
        </div>
      </div>
    </>
  );
}

// ── 일정 추가 모달 ────────────────────────────────────────────────
const blank=date=>({title:"",description:"",contact:"",team:"",start:date||fmt(new Date()),end:date||fmt(new Date()),allDay:false,startTime:"09:00",endTime:"10:00",place:"",url:"",calId:"clean0",repeat:"none"});

function EventModal() {
  const { modal, closeModal, addEvent, updateEvent, deleteEvent, events, cals } = useC();
  const { open, date, editId } = modal;
  const editEv=editId?events.find(e=>e.id===editId):null;
  const [form,setForm]=useState(blank(date));
  const [errs,setErrs]=useState({});
  const [anim,setAnim]=useState(false);
  const [pasteText,setPasteText]=useState("");
  // step: "paste"=텍스트입력단계, "form"=일정폼단계
  const [step,setStep]=useState("paste");
  const tRef=useRef(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  useEffect(()=>{
    if(open){
      setForm(editEv?{...editEv}:blank(date));
      setErrs({});
      setPasteText("");
      // 수정모드 또는 날짜 직접 추가는 바로 폼, 새 일정은 텍스트 입력부터
      setStep(editEv ? "form" : "paste");
      setTimeout(()=>setAnim(true),10);
      setTimeout(()=>tRef.current?.focus(),150);
    }
    else setAnim(false);
  },[open,editId]);

  const guard=useMemo(()=>{const d=diff(form.start,form.end);return{d,show:d>=14,monthly:d>=30};},[form.start,form.end]);
  useEffect(()=>{
    if(!guard.show&&form.repeat!=="none") set("repeat","none");
    if(!guard.monthly&&form.repeat==="monthly") set("repeat","none");
  },[guard.show,guard.monthly]);

  const validate=()=>{
    const e={};
    if(!form.title.trim()) e.title="제목을 입력해주세요.";
    if(form.end<form.start) e.end="종료일은 시작일 이후여야 합니다.";
    if(!form.allDay&&form.startTime>=form.endTime) e.time="종료 시간은 시작 시간 이후여야 합니다.";
    setErrs(e); return !Object.keys(e).length;
  };
  const submit=()=>{if(!validate())return;editId?updateEvent({...form,id:editId}):addEvent(form);closeModal();};
  if(!open) return null;

  return (
    <div
      style={{
        transform: anim ? "translateY(0)" : "translateY(100%)",
        opacity:   anim ? 1 : 0,
        transition: "transform 0.35s cubic-bezier(0.32,0.72,0,1), opacity 0.35s ease",
      }}
      className="absolute inset-0 z-50 bg-white flex flex-col">
      {/* ═══ STEP 1: 텍스트 입력 단계 ═══ */}
      {step === "paste" ? (
        <>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <button onClick={closeModal}><X size={22} className="text-gray-600"/></button>
            <h2 className="font-bold text-base">내용 입력</h2>
            <button
              onClick={()=>{
                // 빈 칸이면 그냥 빈 폼으로, 내용 있으면 파싱
                if(pasteText.trim()){
                  const parsed = parseEventText(pasteText);
                  setForm(p=>({...p, ...parsed}));
                }
                setStep("form");
              }}
              className="text-blue-500 font-bold text-base">확인</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <p className="text-sm text-gray-500 mb-3">
              📋 카카오톡 문자나 메모를 붙여넣으면 날짜·장소·연락처·비밀번호를 자동으로 정리해드려요.
            </p>
            <textarea
              autoFocus
              value={pasteText}
              onChange={e=>setPasteText(e.target.value)}
              placeholder={"여기에 내용을 입력하거나 붙여넣으세요...\n\n예)\n6월 15일 오전\n서울시 동대문구 망우로1길27\n이효림 010-2192-9533\n비밀번호 1469*"}
              rows={14}
              className="w-full text-sm outline-none resize-none text-gray-800 placeholder-gray-300 leading-relaxed"
            />
          </div>
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              onClick={()=>{
                if(pasteText.trim()){
                  const parsed = parseEventText(pasteText);
                  setForm(p=>({...p, ...parsed}));
                }
                setStep("form");
              }}
              className="w-full py-3 bg-blue-500 text-white text-sm font-bold rounded-2xl">
              {pasteText.trim() ? "✨ 자동 분석하고 계속" : "직접 입력하기"}
            </button>
          </div>
        </>
      ) : (
      /* ═══ STEP 2: 일정 폼 단계 ═══ */
      <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button onClick={()=>editId ? closeModal() : setStep("paste")}>
          {editId ? <X size={22} className="text-gray-600"/> : <ChevronLeft size={22} className="text-gray-600"/>}
        </button>
        <h2 className="font-bold text-base">{editId?"일정 수정":"일정 추가"}</h2>
        <button onClick={submit} className="text-blue-500 font-bold text-base">완료</button>
      </div>
      {/* ── 새 디자인 폼 (네이버 스타일) ───────────────────────── */}
      <div className="flex-1 overflow-y-auto bg-white">

        {/* 캘린더(담당팀) 선택 — 맨 위 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100 bg-gray-50/50">
          <User size={18} className="text-gray-400 shrink-0"/>
          <span className="text-sm font-semibold text-gray-700 shrink-0">담당팀</span>
          <select
            value={form.calId}
            onChange={e=>set("calId",e.target.value)}
            className="flex-1 text-sm font-bold outline-none bg-transparent text-right"
            style={{color: cals.find(c=>c.id===form.calId)?.color || "#333"}}>
            {cals.map(cal=>(
              <option key={cal.id} value={cal.id}>{cal.label}</option>
            ))}
          </select>
        </div>

        {/* 제목 */}
        <div className="flex items-center px-4 py-4 border-b border-gray-100 gap-3">
          <span className="w-3 h-3 rounded-full shrink-0"
            style={{background: cals.find(c=>c.id===form.calId)?.color||"#999"}}/>
          <input
            ref={tRef}
            value={form.title}
            onChange={e=>set("title",e.target.value)}
            placeholder="일정을 입력하세요."
            className={`flex-1 text-base font-medium outline-none text-gray-800 placeholder-gray-300
              ${errs.title?"border-b border-red-400":""}`}
          />
          {errs.title&&<p className="text-red-500 text-xs mt-1">{errs.title}</p>}
        </div>

        {/* 날짜 & 시간 — 네이버 스타일 */}
        <div className="px-4 py-4 border-b border-gray-100 space-y-3">
          {/* 종일 토글 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock size={18} className="text-gray-400"/>
              <span className="text-sm text-gray-700">종일</span>
            </div>
            <button onClick={()=>set("allDay",!form.allDay)}
              className={`relative w-12 h-6 rounded-full transition-colors duration-200
                ${form.allDay?"bg-blue-600":"bg-gray-200"}`}>
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform
                ${form.allDay?"translate-x-6":"translate-x-0"}`}/>
            </button>
          </div>

          {/* 날짜/시간 행 — 네이버처럼 시작 → 종료 */}
          <div className="flex items-center gap-2 pl-9">
            {/* 시작 */}
            <div className="flex-1">
              <input type="date" value={form.start}
                onChange={e=>{set("start",e.target.value);if(e.target.value>form.end)set("end",e.target.value);}}
                className="text-sm text-gray-600 outline-none bg-transparent w-full"/>
              {!form.allDay&&(
                <input type="time" value={form.startTime}
                  onChange={e=>set("startTime",e.target.value)}
                  className="text-[22px] font-bold text-gray-900 outline-none bg-transparent mt-1 w-full"/>
              )}
            </div>
            {/* 화살표 */}
            <ChevronRight size={18} className="text-gray-400 shrink-0"/>
            {/* 종료 */}
            <div className="flex-1 text-right">
              <input type="date" value={form.end} min={form.start}
                onChange={e=>set("end",e.target.value)}
                className="text-sm text-gray-600 outline-none bg-transparent w-full text-right"/>
              {!form.allDay&&(
                <input type="time" value={form.endTime}
                  onChange={e=>set("endTime",e.target.value)}
                  className="text-[22px] font-bold text-gray-900 outline-none bg-transparent mt-1 w-full text-right"/>
              )}
            </div>
          </div>
          {errs.end&&<p className="text-red-500 text-xs pl-9">{errs.end}</p>}
          {errs.time&&<p className="text-red-500 text-xs pl-9">{errs.time}</p>}
        </div>



        {/* 주소 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
          <MapPin size={18} className="text-gray-400 shrink-0"/>
          <input value={form.place} onChange={e=>set("place",e.target.value)}
            placeholder="장소"
            className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-300"/>
          {form.place && (
            <a href={`https://map.naver.com/v5/search/${encodeURIComponent(form.place)}`} target="_blank" rel="noopener noreferrer" className="shrink-0 px-2 py-1 bg-blue-50 rounded-full text-blue-500 text-xs font-bold transition-colors hover:bg-blue-100">
              지도보기
            </a>
          )}
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

        {/* 반복 (밸리데이션 가드) */}
        {guard.show&&(
          <div className="px-4 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3 mb-3">
              <RotateCcw size={18} className="text-gray-400 shrink-0"/>
              <span className="text-sm text-gray-700">반복</span>
            </div>
            <div className="flex flex-wrap gap-2 pl-9">
              {REPEAT_OPTS.map(opt=>{
                const locked=opt.value==="monthly"&&!guard.monthly;
                const sel=form.repeat===opt.value;
                return(
                  <button key={opt.value} disabled={locked}
                    onClick={()=>!locked&&set("repeat",opt.value)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition
                      ${locked?"opacity-30 border-gray-200 text-gray-400"
                        :sel?"bg-blue-500 border-blue-400 text-white"
                            :"border-gray-200 text-gray-600"}`}>
                    {locked?"🔒 "+opt.label:opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 삭제 버튼 */}
        {editId&&(
          <div className="px-4 py-4">
            <button onClick={()=>{deleteEvent(editId);closeModal();}}
              className="w-full py-3.5 rounded-2xl text-red-500 text-sm font-bold bg-red-50">
              이 일정 삭제
            </button>
          </div>
        )}
        <div className="h-8"/>
      </div>
      </>
      )}
    </div>
  );
}

// ── 상단 헤더 ─────────────────────────────────────────────────────
function TopHeader() {
  const { current, setCurrent, setDrawer, sheetMode, setSheetMode, selDate, setSelDate, setSearchOpen } = useC();
  const y=current.getFullYear(), m=current.getMonth();
  const [picker,setPicker]=useState(false);
  const DAYS=["일","월","화","수","목","금","토"];
  const d=pd(selDate), dow=d?.getDay()??0;

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 relative">
      {/* 왼쪽: 햄버거 or 뒤로가기 */}
      {sheetMode===2
        ? <button onClick={()=>setSheetMode(1)} className="p-1 -ml-1"><ChevronLeft size={22} className="text-gray-700"/></button>
        : <button onClick={()=>setDrawer(true)} className="p-1 -ml-1"><Menu size={22} className="text-gray-700"/></button>
      }

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
  );
}

// ── 하단 플로팅 버튼 + 오늘 버튼 ─────────────────────────────────
function FloatingButtons() {
  const { openModal, selDate, setCurrent, setSelDate, sheetMode } = useC();
  return (
    <div className="absolute bottom-4 right-4 flex flex-col items-end gap-3 pointer-events-none">
      {/* 오늘 버튼 */}
      <button onClick={()=>{setCurrent(new Date());setSelDate(fmt(new Date()));}}
        className="pointer-events-auto flex items-center gap-1 bg-white rounded-full px-4 py-2 shadow-lg border border-gray-200 text-sm font-medium text-gray-700">
        ‹ 오늘
      </button>
      {/* + 버튼 */}
      <button onClick={()=>openModal(selDate)}
        className="pointer-events-auto w-14 h-14 bg-gray-900 rounded-full flex items-center justify-center shadow-xl active:scale-95 transition-transform">
        <Plus size={24} className="text-white"/>
      </button>
    </div>
  );
}

// ── 앱 루트 ───────────────────────────────────────────────────────
// ── 검색 모달 ───────────────────────────────────────────────
function SearchModal() {
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


// ── 현장 완료 보고 화면 (2단계: 시작 → 완료) ─────────────────────
function FieldReportScreen({ ev, onClose }) {
  const { currentUser } = useC();
  const [step, setStep] = useState("start");
  const [startMemo, setStartMemo] = useState("");
  const [endMemo, setEndMemo] = useState("");
  const [startTime, setStartTime] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logDone, setLogDone] = useState(false);
  const logBodyRef = useRef(null);
  const cal = calById(ev?.calId);

  const handleStart = () => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    setStartTime(timeStr);
    setStep("working");
  };

  const LOG_ITEMS = [
    { delay: 600, avatar: "📱", avatarBg: "#1e40af", sender: "시스템", senderColor: "#93c5fd",
      text: () => `팀장 ${currentUser.name}님이 완료 전송 버튼을 눌렀습니다.\n현장 데이터를 AI 관리실로 전달합니다.` },
    { delay: 1800, avatar: "🤖", avatarBg: "#92400e", sender: "관리실장 AI", senderColor: "#fcd34d",
      text: () => `현장 피드백 분석 중...\n"${endMemo || "특이사항 없음, 깔끔하게 완료"}"\n✔ 내용 확인 완료. 정밀 보고서를 총괄 김 부장에게 상신합니다.` },
    { delay: 3200, avatar: "💼", avatarBg: "#1e3a5f", sender: "총괄 김 부장", senderColor: "#60a5fa",
      text: () => `관리실장 보고 확인.\n현장 특이사항 승인 완료.\n→ [재무실장] ${ev?.title} 건 정산 절차 진행하세요.` },
    { delay: 4600, avatar: "💰", avatarBg: "#064e3b", sender: "재무실장 AI", senderColor: "#6ee7b7",
      text: () => `자동 정산 시작.\n→ ${ev?.title} 확정 매출 반영 완료.\n→ 누적 수익률 대시보드 업데이트 성공.` },
    { delay: 6000, avatar: "👑", avatarBg: "#4c1d95", sender: "최종 보고", senderColor: "#a78bfa",
      text: () => `대표님 대시보드에 한 줄 리포트 작성 완료.\n대표님은 퇴근 전 확인만 하시면 됩니다. 😊` },
  ];

  const handleComplete = () => {
    setShowLog(true);
    setLogs([]);
    setLogDone(false);
    LOG_ITEMS.forEach((item) => {
      setTimeout(() => {
        setLogs(prev => [...prev, { ...item, text: item.text() }]);
        setTimeout(() => {
          if (logBodyRef.current) logBodyRef.current.scrollTop = logBodyRef.current.scrollHeight;
        }, 50);
      }, item.delay);
    });
    setTimeout(() => setLogDone(true), 7200);
  };

  if (!ev) return null;

  return (
    <div className="absolute inset-0 z-[80] bg-white flex flex-col"
      style={{ animation: "modalSlideUp 0.35s cubic-bezier(0.32,0.72,0,1) both" }}>

      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100"
        style={{ background: "linear-gradient(135deg, #1a56db 0%, #2563eb 100%)" }}>
        <button onClick={onClose} className="p-1"><X size={22} className="text-white"/></button>
        <div className="flex items-center gap-2">
          <span className="text-lg">🧹</span>
          <span className="font-bold text-white text-base">현장 완료 보고</span>
        </div>
        <div style={{width:30}}/>
      </div>

      {/* 현장 정보 카드 */}
      <div className="mx-4 mt-4 mb-2 p-4 rounded-2xl border border-blue-100"
        style={{ background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)" }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
            style={{ background: cal?.color || "#1a56db" }}>🏠</div>
          <div>
            <p className="font-bold text-gray-900 text-sm">{ev.title}</p>
            <p className="text-xs text-blue-600 font-medium mt-0.5">{ev.start}{!ev.allDay && ev.startTime ? ` · ${fmtTime(ev.startTime)}` : ""}</p>
            {ev.place && <p className="text-xs text-gray-500 mt-0.5">📍 {ev.place}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <div className={`flex-1 h-1.5 rounded-full ${step !== "start" ? "bg-blue-500" : "bg-gray-200"}`}/>
          <div className={`flex-1 h-1.5 rounded-full ${showLog ? "bg-green-500" : "bg-gray-200"}`}/>
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-gray-400 font-medium">청소 시작</span>
          <span className="text-[10px] text-gray-400 font-medium">완료 보고</span>
        </div>
      </div>

      {/* STEP 1: 청소 시작 보고 */}
      {step === "start" && (
        <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-4">
          <div className="flex items-center gap-2 py-2">
            <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">1</div>
            <span className="font-bold text-gray-800 text-sm">현장 도착 확인 · 청소 전 사진</span>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">📸 청소 전 사진 (Before)</p>
            <div className="border-2 border-dashed border-blue-200 rounded-2xl p-6 text-center bg-blue-50/50 cursor-pointer"
              onClick={() => alert("실제 앱에서는 카메라/갤러리와 연동됩니다.")}>
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm text-gray-400 font-medium">청소 전 사진 첨부</p>
              <p className="text-xs text-blue-300 mt-1">최대 10장 · JPG / PNG</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">✍️ 도착 시 특이사항</p>
            <textarea value={startMemo} onChange={e => setStartMemo(e.target.value)}
              placeholder="예: 현관 비밀번호 1234, 3층 엘리베이터 없음"
              className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-800 outline-none resize-none bg-gray-50 placeholder-gray-300"
              rows={3}/>
          </div>
          <button onClick={handleStart}
            className="w-full py-4 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #1a56db 0%, #2563eb 100%)" }}>
            🚀 청소 시작
          </button>
          <div className="h-4"/>
        </div>
      )}

      {/* STEP 2: 완료 보고 */}
      {step === "working" && !showLog && (
        <div className="flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
            <span className="text-blue-500 text-sm font-bold">✅ 청소 시작됨</span>
            <span className="text-xs text-gray-400 ml-auto">{startTime} 시작</span>
          </div>
          <div className="flex items-center gap-2 py-2">
            <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold">2</div>
            <span className="font-bold text-gray-800 text-sm">청소 완료 · 사진 및 보고</span>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">📸 청소 후 사진 (After)</p>
            <div className="border-2 border-dashed border-green-200 rounded-2xl p-6 text-center bg-green-50/50 cursor-pointer"
              onClick={() => alert("실제 앱에서는 카메라/갤러리와 연동됩니다.")}>
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm text-gray-400 font-medium">청소 후 사진 첨부</p>
              <p className="text-xs text-green-300 mt-1">최대 10장 · JPG / PNG</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">✍️ 현장 특이사항 메모</p>
            <textarea value={endMemo} onChange={e => setEndMemo(e.target.value)}
              placeholder="예: 싱크대 오염 심했는데 다 지웠고 가스레인지 탈거 청소함"
              className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-800 outline-none resize-none bg-gray-50 placeholder-gray-300"
              rows={3}/>
          </div>
          <button onClick={handleComplete}
            className="w-full py-4 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)" }}>
            ✔ 청소 완료 전송
          </button>
          <div className="h-4"/>
        </div>
      )}

      {/* AI 워크플로우 로그 */}
      {showLog && (
        <div className="flex-1 flex flex-col overflow-hidden" style={{background:"#030712"}}>
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-800">
            <div className="w-2 h-2 rounded-full bg-green-400" style={{animation:"pulse 1.5s infinite"}}/>
            <span className="text-xs text-gray-400 font-medium">크린드림 AI 관리실 · 실시간 처리 중</span>
          </div>
          <div ref={logBodyRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
            {logs.map((log, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0"
                  style={{background: log.avatarBg}}>{log.avatar}</div>
                <div>
                  <p className="text-xs font-bold mb-1" style={{color: log.senderColor}}>{log.sender}</p>
                  <div className="text-xs text-gray-300 whitespace-pre-line px-3 py-2 rounded-lg rounded-tl-none leading-relaxed"
                    style={{background:"#1e293b"}}>{log.text}</div>
                </div>
              </div>
            ))}
            {logDone && (
              <div className="mt-2 p-4 rounded-2xl border border-green-700 text-center"
                style={{background:"linear-gradient(135deg,#052e16 0%,#14532d 100%)"}}>
                <div className="text-3xl mb-2">✅</div>
                <p className="text-green-400 font-bold text-sm">오늘도 수고하셨습니다!</p>
                <p className="text-green-300 text-xs mt-1 leading-relaxed">모든 처리가 완료됐습니다.<br/>대표님 대시보드에 자동 반영되었습니다.</p>
              </div>
            )}
          </div>
          {logDone && (
            <button onClick={onClose}
              className="mx-4 mb-6 py-3 rounded-xl text-gray-400 text-sm font-bold border border-gray-700"
              style={{background:"#111827"}}>
              ← 캘린더로 돌아가기
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <Provider>
      <AppInner/>
    </Provider>
  );
}

// ── 직원 관리 메인 화면 ───────────────────────────────────────────────
function EmployeeListScreen() {
  const { users, setEmpModal, teams, setTeamModal } = useC();
  const [filter, setFilter] = useState("전체");

  const filtered = filter === "전체" ? users : users.filter(u => u.team === filter);

  return (
    <div className="flex-1 bg-gray-50 flex flex-col relative overflow-hidden">
      {/* 상단 버튼 영역 (헤더) */}
      <div className="bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between z-10 shrink-0">
        <h2 className="text-xl font-bold text-gray-900">직원 관리</h2>
        <button onClick={() => setTeamModal(true)} className="px-3 py-1.5 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg">
          팀 관리
        </button>
      </div>

      {/* 필터 영역: 스크롤 안 되고 상단에 고정 */}
      <div className="px-4 py-3 bg-white border-b border-gray-100 flex gap-2 overflow-x-auto whitespace-nowrap hide-scrollbar shrink-0 z-10 shadow-sm relative">
        <button onClick={()=>setFilter("전체")} className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${filter==="전체" ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-500 border-gray-200"}`}>전체</button>
        {teams.map(t => (
          <button key={t} onClick={()=>setFilter(t)} className={`px-4 py-1.5 rounded-full text-sm font-semibold border transition-colors ${filter===t ? "bg-gray-800 text-white border-gray-800" : "bg-white text-gray-500 border-gray-200"}`}>{t}</button>
        ))}
      </div>
      
      {/* 리스트 영역: 여기만 스크롤 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 pb-24">
        {filtered.map(u => (
          <div key={u.id} className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-gray-900 text-base">{u.name}</span>
                <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">{u.role}</span>
              </div>
              <div className="text-sm text-gray-500 mb-0.5">{u.team}</div>
              <div className="text-xs text-gray-400">📞 {u.phone}</div>
            </div>
            <button onClick={() => setEmpModal({open:true, editId:u.id})} className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-50 rounded-full">
              <Edit3 size={18}/>
            </button>
          </div>
        ))}
      </div>
      {/* FAB 추가 버튼 */}
      <button onClick={() => setEmpModal({open:true, editId:null})} className="absolute bottom-6 right-6 w-14 h-14 bg-gray-900 rounded-full flex items-center justify-center shadow-lg shadow-gray-400/50 hover:bg-black transition-transform active:scale-95 z-10">
        <Plus size={28} className="text-white" />
      </button>
    </div>
  );
}

// ── 직원 등록/수정 모달 ───────────────────────────────────────────────
function EmployeeFormModal() {
  const { empModal, setEmpModal, users, setUsers, activityLogs, setActivityLogs, teams } = useC();
  const [form, setForm] = useState({ name: "", phone: "", team: "입주청소팀", role: "팀원" });

  useEffect(() => {
    if (empModal.open) {
      if (empModal.editId) {
        const u = users.find(x => x.id === empModal.editId);
        if (u) setForm(u);
      } else {
        setForm({ name: "", phone: "", team: "입주청소팀", role: "팀원" });
      }
    }
  }, [empModal.open, empModal.editId, users]);

  if (!empModal.open) return null;

  const close = () => setEmpModal({open:false, editId:null});
  const save = () => {
    if (!form.name.trim()) return alert("이름을 입력하세요.");
    if (empModal.editId) {
      setUsers(p => p.map(u => u.id === empModal.editId ? { ...u, ...form } : u));
    } else {
      setUsers(p => [...p, { id: "u" + Date.now(), ...form }]);
    }
    close();
  }
  const del = () => {
    if (confirm("정말 이 직원을 삭제하시겠습니까?")) {
      setUsers(p => p.filter(u => u.id !== empModal.editId));
      close();
    }
  }

  return (
    <div className="absolute inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{empModal.editId ? "직원 수정" : "새 직원 등록"}</h2>
          <button onClick={close} className="p-1 -mr-1 rounded-full hover:bg-gray-100"><X size={20} className="text-gray-500"/></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">이름</label>
            <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800" placeholder="홍길동" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">연락처</label>
            <input value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800" placeholder="010-0000-0000" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">소속 팀</label>
            <select value={form.team} onChange={e=>setForm({...form,team:e.target.value})} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800">
              {teams.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">직급</label>
            <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800">
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-50 bg-gray-50 flex gap-2">
          {empModal.editId && (
            <button onClick={del} className="px-4 py-2 text-sm font-bold text-red-500 bg-red-50 rounded-lg hover:bg-red-100">삭제</button>
          )}
          <div className="flex-1"></div>
          <button onClick={close} className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-200 rounded-lg">취소</button>
          <button onClick={save} className="px-5 py-2 text-sm font-bold text-white bg-gray-900 hover:bg-black rounded-lg">저장</button>
        </div>
      </div>
    </div>
  );
}

// ── 팀 관리 모달 ───────────────────────────────────────────────
function TeamManagementModal() {
  const { teamModal, setTeamModal, teams, setTeams, users, setUsers } = useC();
  const [newTeam, setNewTeam] = useState("");

  if (!teamModal) return null;

  const close = () => setTeamModal(false);

  const handleAdd = () => {
    if (!newTeam.trim()) return;
    if (teams.includes(newTeam.trim())) {
      alert("이미 존재하는 팀입니다.");
      return;
    }
    setTeams([...teams, newTeam.trim()]);
    setNewTeam("");
  };

  const handleDelete = (targetTeam) => {
    if (window.confirm("삭제하는 팀의 팀장,팀원은 소속이 미정으로 변경됩니다.")) {
      setUsers(users.map(u => u.team === targetTeam ? { ...u, team: "미정" } : u));
      setTeams(teams.filter(t => t !== targetTeam));
    }
  };

  return (
    <div className="absolute inset-0 z-[70] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative bg-white rounded-t-3xl h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">팀 관리</h2>
          <button onClick={close} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <X size={24}/>
          </button>
        </div>

        <div className="p-5 flex gap-2 border-b border-gray-50">
          <input 
            type="text" 
            placeholder="새 팀 이름 (예: 특수청소팀)" 
            value={newTeam} 
            onChange={e => setNewTeam(e.target.value)}
            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:border-blue-500 transition-colors"
          />
          <button onClick={handleAdd} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors">
            추가
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3 bg-gray-50">
          {teams.map(t => (
            <div key={t} className="flex items-center justify-between bg-white p-4 rounded-xl shadow-sm border border-gray-100">
              <span className="font-bold text-gray-800">{t}</span>
              <button onClick={() => handleDelete(t)} className="text-gray-400 hover:text-red-500 transition-colors p-2 -mr-2 rounded-full hover:bg-red-50">
                <Trash2 size={18}/>
              </button>
            </div>
          ))}
          {teams.length === 0 && (
            <div className="py-10 text-center text-gray-400 text-sm">등록된 팀이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── 팀별 일정 화면 ───────────────────────────────────────────────
function TeamScheduleScreen() {
  const { visibleEvents, setCurrentScreen, teams } = useC();
  // 팀별 일정 개수 계산
  const teamStats = {};
  teams.forEach(t => teamStats[t] = 0);
  visibleEvents.forEach(e => {
    const cal = calById(e.calId);
    teams.forEach(t => {
      const keyword = t.replace("팀", "");
      if (cal.label.includes(keyword)) teamStats[t]++;
    });
  });

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col p-5 gap-5 relative">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-200">
          <ChevronLeft size={24} className="text-gray-700"/>
        </button>
        <h2 className="text-xl font-bold text-gray-900">팀별 일정 현황</h2>
      </div>
      <div className="flex flex-col gap-3">
        {teams.map(team => (
          <div key={team} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between hover:border-blue-200 transition-colors cursor-pointer">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-50 flex items-center justify-center shrink-0">
                <User size={20} className="text-indigo-600"/>
              </div>
              <span className="font-bold text-gray-800">{team}</span>
            </div>
            <span className="text-sm font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">{teamStats[team] || 0}건</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 대시보드 화면 ───────────────────────────────────────────────
function DashboardScreen() {
  const { visibleEvents, setCurrentScreen } = useC();
  const today = new Date();
  const todayStr = fmt(today);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const tmrwStr = fmt(tomorrow);

  const todayEvs = visibleEvents.filter(e => e.start <= todayStr && (!e.end || e.end >= todayStr));
  const tmrwEvs = visibleEvents.filter(e => e.start <= tmrwStr && (!e.end || e.end >= tmrwStr));

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col p-5 gap-5 relative">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-200">
          <ChevronLeft size={24} className="text-gray-700"/>
        </button>
        <h2 className="text-xl font-bold text-gray-900">일정 요약</h2>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col items-center justify-center">
          <span className="text-gray-500 text-sm font-medium mb-1">오늘 일정</span>
          <span className="text-3xl font-bold text-blue-600">{todayEvs.length}건</span>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col items-center justify-center">
          <span className="text-gray-500 text-sm font-medium mb-1">내일 일정</span>
          <span className="text-3xl font-bold text-indigo-600">{tmrwEvs.length}건</span>
        </div>
      </div>
    </div>
  );
}

// ── 공지사항 화면 ───────────────────────────────────────────────
function NoticeScreen() {
  const { notices, currentUser, setCurrentScreen } = useC();
  return (
    <div className="flex-1 overflow-y-auto bg-white flex flex-col p-5">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
          <ChevronLeft size={24} className="text-gray-700"/>
        </button>
        <h2 className="text-xl font-bold text-gray-900 flex-1">팀 공지사항</h2>
        {["사장", "관리팀"].includes(currentUser.team) && (
          <button className="text-sm font-bold text-blue-600 px-3 py-1.5 rounded-full hover:bg-blue-50">
            새 공지
          </button>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {notices.map(n => (
          <div key={n.id} className="p-4 rounded-xl bg-gray-50 border border-gray-100">
            <h3 className="font-bold text-gray-900 text-base mb-1">{n.title}</h3>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{n.author}</span>
              <span>•</span>
              <span>{n.date}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 최근 작업 내역 화면 ───────────────────────────────────────────────
function ActivityLogScreen() {
  const { activityLogs, setCurrentScreen } = useC();
  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col p-5">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-200">
          <ChevronLeft size={24} className="text-gray-700"/>
        </button>
        <h2 className="text-xl font-bold text-gray-900">최근 작업 내역</h2>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
        {activityLogs.length === 0 ? (
          <div className="py-10 text-center text-gray-400 text-sm">최근 작업 내역이 없습니다.</div>
        ) : (
          <div className="flex flex-col relative before:absolute before:inset-y-0 before:left-[11px] before:w-px before:bg-gray-200">
            {activityLogs.map((log, i) => (
              <div key={log.id} className="relative flex gap-4 py-3">
                <div className="w-[23px] h-[23px] rounded-full bg-white border-4 border-gray-100 shrink-0 z-10 flex items-center justify-center">
                  <div className={`w-2 h-2 rounded-full ${
                    log.action==="등록" ? "bg-green-500" :
                    log.action==="수정" ? "bg-blue-500" : "bg-red-500"
                  }`}/>
                </div>
                <div className="flex flex-col pb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-gray-900">{log.user.name}</span>
                    <span className="text-[11px] text-gray-400 font-medium bg-gray-100 px-1.5 py-0.5 rounded">{log.user.team}</span>
                  </div>
                  <span className="text-sm text-gray-600 mt-1 leading-snug">{log.detail}</span>
                  <span className="text-[11px] text-gray-400 mt-1">{new Date(log.time).toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit'})}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 외부 링크 화면 ───────────────────────────────────────────────
function ExternalLinksScreen() {
  const { links, setLinks, setCurrentScreen } = useC();
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newUrl, setNewUrl] = useState("");

  const handleAdd = () => {
    if(!newTitle.trim() || !newUrl.trim()) return;
    setLinks(p => [...p, { id: uid(), title: newTitle, url: newUrl.startsWith('http') ? newUrl : `https://${newUrl}` }]);
    setNewTitle("");
    setNewUrl("");
    setAdding(false);
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col p-5">
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-200">
          <ChevronLeft size={24} className="text-gray-700"/>
        </button>
        <h2 className="text-xl font-bold text-gray-900 flex-1">외부 링크</h2>
        <button onClick={() => setAdding(true)} className="p-2 rounded-full bg-blue-100 text-blue-600 hover:bg-blue-200">
          <Plus size={20}/>
        </button>
      </div>

      {adding && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4 flex flex-col gap-3">
          <input type="text" placeholder="링크 이름 (예: 네이버 지도)" value={newTitle} onChange={e=>setNewTitle(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors"/>
          <input type="text" placeholder="URL 주소 (예: map.naver.com)" value={newUrl} onChange={e=>setNewUrl(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 transition-colors"/>
          <div className="flex gap-2 justify-end mt-1">
            <button onClick={()=>setAdding(false)} className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100 rounded-lg">취소</button>
            <button onClick={handleAdd} className="px-4 py-2 text-sm font-bold bg-blue-600 text-white hover:bg-blue-700 rounded-lg">추가</button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {links.length === 0 && !adding ? (
          <div className="py-10 text-center text-gray-400 text-sm">등록된 외부 링크가 없습니다.</div>
        ) : (
          links.map(lk => (
            <a key={lk.id} href={lk.url} target="_blank" rel="noopener noreferrer" className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 hover:border-blue-200 transition-colors group">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
                  <Link2 size={20} className="text-purple-600"/>
                </div>
                <span className="font-bold text-gray-800">{lk.title}</span>
              </div>
              <ChevronRight size={20} className="text-gray-300 group-hover:text-blue-500 transition-colors"/>
            </a>
          ))
        )}
      </div>
    </div>
  );
}

function AppInner() {
  const { currentScreen, fieldReportEv, setFieldReportEv } = useC();
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white max-w-sm mx-auto relative select-none">
      <style>{ANIM_CSS}</style>
      <TopHeader/>
      {currentScreen === "calendar" && (
        <>
          <CalendarView/>
          <FloatingButtons/>
        </>
      )}
      {currentScreen === "employees" && <EmployeeListScreen/>}
      {currentScreen === "team_schedule" && <TeamScheduleScreen/>}
      {currentScreen === "dashboard" && <DashboardScreen/>}
      {currentScreen === "notice" && <NoticeScreen/>}
      {currentScreen === "activity_log" && <ActivityLogScreen/>}
      {currentScreen === "links" && <ExternalLinksScreen/>}
      <SideDrawer/>
      <DetailSheet/>
      <EventModal/>
      <SearchModal/>
      <EmployeeFormModal/>
      <TeamManagementModal/>
      {fieldReportEv && (
        <FieldReportScreen ev={fieldReportEv} onClose={() => setFieldReportEv(null)}/>
      )}
    </div>
  );
}
