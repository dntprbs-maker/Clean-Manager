/**
 * 크린드림 캘린더 — 네이버 캘린더 완전 재현
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
  ChevronRight, Menu, Settings, User, Edit3, Trash2
} from "lucide-react";

// ── 캘린더 목록 ───────────────────────────────────────────────
const CALS = [
  { id:"friends", label:"더친구들",    color:"#4285F4", checked:true  },
  { id:"lh",      label:"전일 LH",     color:"#0F9D58", checked:true  },
  { id:"elec",    label:"전국동시",    color:"#EA4335", checked:true  },
  { id:"google",  label:"구글 안티",   color:"#FF6D00", checked:true  },
  { id:"regular", label:"정기청소",    color:"#9C27B0", checked:true  },
  { id:"review",  label:"리버뷰 정",   color:"#9C27B0", checked:true  },
  { id:"sk",      label:"SK 쉴더",     color:"#607D8B", checked:true  },
  { id:"netlify", label:"Netlify",     color:"#4285F4", checked:true  },
  { id:"clean0",  label:"청소 0팀",    color:"#F4B400", checked:true  },
  { id:"import",  label:"중요한약속",  color:"#EA4335", checked:true  },
  { id:"manus",   label:"마누스",      color:"#4285F4", checked:true  },
  { id:"outer",   label:"청소 외주",   color:"#0F9D58", checked:true  },
  { id:"cancel",  label:"취소,변경",   color:"#607D8B", checked:true  },
  { id:"cr",      label:"크린드림춘계",color:"#4285F4", checked:true  },
  { id:"uwork",   label:"우용준 일",   color:"#EA4335", checked:true  },
  { id:"popmart", label:"팝마트",      color:"#9C27B0", checked:true  },
  { id:"nabi",    label:"나비엠알",    color:"#9C27B0", checked:true  },
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

  // 시간: "오전 9시" / "오후 2시30분" / "오전" / "오후"
  const hasAM = text.includes("오전");
  const hasPM = text.includes("오후");
  const tm = text.match(/(오전|오후)\s*(\d{1,2})시?(?:\s*(\d{2})분?)?/);
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
  } else {
    result.allDay=true;
  }

  // 장소: 주소 패턴 줄
  const lines = text.split("\n");
  const pl = [];
  lines.forEach(function(line) {
    const l = line.trim();
    if (!l) return;
    const isAddr =
      /(서울|부산|인천|대구|대전|광주|수원|경기)/.test(l) ||
      /[가-힣]+(로|길|동|구)\s*\d/.test(l) ||
      /\d+층/.test(l) || /\d+호/.test(l);
    if (isAddr) pl.push(l);
  });
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

  // 제목 자동 생성
  const tp = [];
  if (hasAM) tp.push("오전");
  else if (hasPM) tp.push("오후");
  if (result.place) {
    const dg = result.place.match(/([가-힣]+(로|길|동))/);
    if (dg) tp.push(dg[1]);
  }
  if (phones.length>0 && phones[0].name) tp.push(phones[0].name);
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
    {id:uid(),title:"크린드림 춘계 아유회",calId:"cr",start:`${y}-${m}-16`,end:`${y}-${m}-17`,allDay:true,startTime:"",endTime:"",place:"",description:"",repeat:"none"},
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
  const [current,setCurrent]   = useState(new Date(2026,5,1));
  const [selDate,setSelDate]   = useState("2026-06-15");
  const [detEv,setDetEv]       = useState(null);
  const [drawer,setDrawer]     = useState(false);
  // 0=full month bar, 1=half dot+sheet, 2=list only
  const [sheetMode,setSheetMode] = useState(1); // 기본: 도트그리드+시트

  const addEvent    = useCallback(ev=>setEvents(p=>[...p,{...ev,id:uid()}]),[]);
  const updateEvent = useCallback(ev=>setEvents(p=>p.map(e=>e.id===ev.id?ev:e)),[]);
  const deleteEvent = useCallback(id=>setEvents(p=>p.filter(e=>e.id!==id)),[]);
  const openModal   = useCallback((date=null,editId=null)=>setModal({open:true,date,editId}),[]);
  const closeModal  = useCallback(()=>setModal({open:false,date:null,editId:null}),[]);
  const toggleCal   = useCallback(id=>setCals(p=>p.map(c=>c.id===id?{...c,checked:!c.checked}:c)),[]);

  // events 변경 시마다 localStorage 자동 저장
  useEffect(()=>{ saveToStorage(LS_KEY_EVENTS, events); }, [events]);
  // cals(캘린더 ON/OFF) 변경 시마다 저장
  useEffect(()=>{ saveToStorage(LS_KEY_CALS, cals); }, [cals]);

  const checkedIds     = useMemo(()=>new Set(cals.filter(c=>c.checked).map(c=>c.id)),[cals]);
  const visibleEvents  = useMemo(()=>events.filter(e=>checkedIds.has(e.calId)),[events,checkedIds]);

  return (
    <Ctx.Provider value={{
      events,visibleEvents,addEvent,updateEvent,deleteEvent,
      cals,toggleCal,
      modal,openModal,closeModal,
      current,setCurrent,
      selDate,setSelDate,
      detEv,setDetEv,
      drawer,setDrawer,
      sheetMode,setSheetMode,
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
  if(!isCm)             nc="text-gray-350";
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
      style={{minHeight:"46px"}}>
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
    const r=42-ds.length;
    for(let d=1;d<=r;d++) ds.push({s:fmt(new Date(y,m+1,d)),cm:false});
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
                    hThreshold=40, vThreshold=40 }) {
  const sx    = useRef(null);
  const sy    = useRef(null);
  const fired = useRef(false); // 한 터치당 딱 한 번만 실행

  const judge = (dx, dy) => {
    if (fired.current) return; // 이미 실행됐으면 무시
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (adx < hThreshold && ady < vThreshold) return;
    const angle = Math.atan2(ady, adx) * 180 / Math.PI;
    if (angle < 35 && adx >= hThreshold) {
      fired.current = true;
      if (dx > 0) onRight?.(); else onLeft?.();
    } else if (angle > 55 && ady >= vThreshold) {
      fired.current = true;
      if (dy > 0) onDown?.(); else onUp?.();
    }
  };

  return {
    onTouchStart: e => {
      sx.current    = e.touches[0].clientX;
      sy.current    = e.touches[0].clientY;
      fired.current = false; // 새 터치 시작 → 잠금 해제
    },
    onTouchMove: e => {
      // Move 중에도 threshold 넘으면 즉시 실행 (더 빠른 반응)
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
    onMouseDown: e => {
      sx.current = e.clientX; sy.current = e.clientY; fired.current = false;
    },
    onMouseUp: e => {
      if (sx.current === null) return;
      judge(e.clientX - sx.current, e.clientY - sy.current);
      sx.current = null; sy.current = null; fired.current = false;
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

// ── 슬라이드 래퍼 (월 그리드 좌우 전환 전용) ───────────────────
// 핵심: mountedKey ref 로 최초 마운트와 실제 월 이동을 구분
//       최초 마운트(모드 전환 포함) → 애니메이션 없이 바로 표시
//       slideKey 증가(월 이동) → 좌우 슬라이드 실행
function SlideTransition({ children, slideKey, direction }) {
  const ref        = useRef(null);
  const mountedKey = useRef(slideKey); // 마운트 시점의 slideKey 기억

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 마운트 직후(모드 전환) → slideKey 가 mountedKey 와 같음 → 애니 없이 표시
    if (slideKey === mountedKey.current) {
      el.style.transform = "translateX(0)";
      el.style.opacity   = "1";
      return;
    }

    // 월 이동 → slideKey 증가 → 방향에 따라 슬라이드
    const startX = direction === "left" ? "100%" : "-100%";
    el.style.transition = "none";
    el.style.transform  = `translateX(${startX})`;
    el.style.opacity    = "0.6";

    const raf = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.transition = "transform 0.28s cubic-bezier(0.25,0.46,0.45,0.94), opacity 0.15s ease";
        el.style.transform  = "translateX(0)";
        el.style.opacity    = "1";
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [slideKey]);

  return (
    <div ref={ref}
      style={{ willChange:"transform", backgroundColor:"#fff" }}
      className="flex flex-col flex-1 overflow-hidden">
      {children}
    </div>
  );
}

// ── 날짜 목록 좌우 전환 래퍼 ────────────────────────────────────
// 핵심:
//   mountedKey → 마운트 시점 listKey 기억
//   마운트 직후(모드 전환) → listKey 동일 → 애니 없이 바로 표시
//   날짜 이동(listKey 증가) → 좌우 슬라이드 실행
function ListTransition({ children, direction, listKey }) {
  const ref        = useRef(null);
  const mountedKey = useRef(listKey); // 마운트 시점 listKey 기억

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // 모드 전환(첫 마운트) → 애니메이션 없이 바로 표시
    if (listKey === mountedKey.current) {
      el.style.transform  = "translateX(0)";
      el.style.visibility = "visible";
      return;
    }

    // 날짜 이동 → 좌우 슬라이드
    const startX = direction === "left" ? 48 : -48;
    el.style.transition = "none";
    el.style.transform  = `translateX(${startX}px)`;
    el.style.visibility = "hidden";

    const raf = requestAnimationFrame(() => {
      el.style.visibility = "visible";
      el.style.transition = "transform 0.26s cubic-bezier(0.25,0.46,0.45,0.94)";
      el.style.transform  = "translateX(0)";
    });

    return () => cancelAnimationFrame(raf);
  }, [listKey]);

  return (
    <div
      ref={ref}
      style={{ backgroundColor:"#fff", willChange:"transform", visibility:"hidden" }}
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
  // 각도 기반 판별로 좌우(월이동)/상하(모드전환) 정확히 분리
  const gridSwipe = useSwipe({
    onLeft:  goNextMonth,
    onRight: goPrevMonth,
    onUp:    () => setSheetMode(m => Math.min(m+1, 2)),  // 위로 → 일정 더 보기
    onDown:  () => setSheetMode(m => Math.max(m-1, 0)),  // 아래로 → 달력 더 보기
    hThreshold: 50,
    vThreshold: 50,
  });

  // ── 시간표용 스와이프
  // 각도 기반으로 좌우(날이동)/상하(모드전환) 정확히 분리
  const listSwipe = useSwipe({
    onLeft:  goNextDay,
    onRight: goPrevDay,
    onUp:    () => sheetMode < 2 && setSheetMode(sheetMode + 1), // 위로 → 일정 더 보기
    onDown:  () => sheetMode > 0 && setSheetMode(sheetMode - 1), // 아래로 → 달력 더 보기
    hThreshold: 50,
    vThreshold: 50,
  });

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* ══ MODE 0: 전체 월간 그리드 ══════════════════════════════ */}
      {sheetMode === 0 && (
        <div
          key="mode0"
          className="flex-1 overflow-y-auto bg-white"
          style={{animation:"slideInFromTop 0.28s cubic-bezier(0.25,0.46,0.45,0.94) both"}}
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
          <div className="bg-white border-b border-gray-100" {...gridSwipe}>
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
  const { detEv, setDetEv, deleteEvent, openModal } = useC();
  const [vis,setVis]=useState(false);
  useEffect(()=>{ if(detEv)setTimeout(()=>setVis(true),10); else setVis(false); },[detEv]);
  if(!detEv) return null;
  const cal=calById(detEv.calId);
  const close=()=>{ setVis(false); setTimeout(()=>setDetEv(null),280); };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end"
      style={{
        background: vis ? "rgba(0,0,0,0.32)" : "transparent",
        backdropFilter: vis ? "blur(2px)" : "none",
        transition: "background 0.3s ease, backdrop-filter 0.3s ease",
        pointerEvents: vis ? "auto" : "none",
      }}
      onClick={close}>
      <div
        style={{
          transform: vis ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.32s cubic-bezier(0.32,0.72,0,1)",
        }}
        className="bg-white rounded-t-3xl shadow-2xl"
        onClick={e=>e.stopPropagation()}>
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-9 h-[3px] bg-gray-200 rounded-full"/>
        </div>
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-50">
          <span className="text-sm font-semibold" style={{color:cal.color}}>{cal.label}</span>
          <div className="flex gap-1">
            <button onClick={()=>{close();setTimeout(()=>openModal(null,detEv.id),300);}}
              className="p-2 rounded-full hover:bg-gray-100"><Edit3 size={17} className="text-gray-500"/></button>
            <button onClick={()=>{deleteEvent(detEv.id);close();}}
              className="p-2 rounded-full hover:bg-gray-100"><Trash2 size={17} className="text-gray-500"/></button>
            <button onClick={close}
              className="p-2 rounded-full hover:bg-gray-100"><X size={17} className="text-gray-500"/></button>
          </div>
        </div>
        <div className="px-5 pt-4 pb-8 space-y-3">
          <div className="flex gap-3 items-start">
            <div className="w-1 rounded-full shrink-0 mt-1" style={{background:cal.color,minHeight:"40px"}}/>
            <div>
              <h2 className="text-lg font-bold text-gray-900">{detEv.title}</h2>
              <p className="text-sm text-gray-400 mt-0.5">
                {detEv.start}{detEv.end&&detEv.end!==detEv.start?` ~ ${detEv.end}`:""}
                {!detEv.allDay&&detEv.startTime&&` · ${fmtTime(detEv.startTime)} ~ ${fmtTime(detEv.endTime)}`}
                {detEv.allDay&&" · 종일"}
              </p>
            </div>
          </div>
          {detEv.place&&<div className="flex gap-3 items-center text-sm text-gray-500 pl-4"><MapPin size={14} className="text-gray-400"/>{detEv.place}</div>}
          {detEv.description&&<div className="flex gap-3 items-start text-sm text-gray-500 pl-4"><AlignLeft size={14} className="shrink-0 mt-0.5"/>{detEv.description}</div>}
        </div>
      </div>
    </div>
  );
}

// ── 사이드 드로어 (스와이프 열기/닫기 지원) ───────────────────────
function SideDrawer() {
  const { drawer, setDrawer, cals, toggleCal } = useC();

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
        className="fixed inset-0 z-40 transition-opacity duration-300"
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
          className="fixed top-0 left-0 h-full z-50"
          style={{ width: 20, touchAction: "none" }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
        />
      )}

      {/* 드로어 패널 */}
      <div
        ref={panelRef}
        className="fixed top-0 left-0 h-full bg-white z-50 shadow-2xl flex flex-col"
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
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-xl border border-blue-100">🏠</div>
            <div><p className="font-bold text-base">우세균</p><p className="text-xs text-gray-400">dntprbs</p></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button className="flex-1 py-2 rounded-xl border border-gray-200 text-xs text-gray-600 flex items-center justify-center gap-1">
              <Calendar size={12}/> 캘린더 설정
            </button>
            <button className="flex-1 py-2 rounded-xl border border-gray-200 text-xs text-gray-600 flex items-center justify-center gap-1">
              <Settings size={12}/> 앱 설정
            </button>
          </div>
        </div>

        {/* 내 캘린더 타이틀 */}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-bold text-base">내 캘린더</span>
          <button className="p-1 rounded-full hover:bg-gray-100">
            <Plus size={18} className="text-gray-500"/>
          </button>
        </div>

        {/* 캘린더 목록 */}
        <div className="flex-1 overflow-y-auto">
          {cals.map(cal => (
            <div key={cal.id} onClick={() => toggleCal(cal.id)}
              className="flex items-center gap-3 px-4 py-3 active:bg-gray-50 cursor-pointer">
              <div className="w-5 h-5 rounded flex items-center justify-center border-2 shrink-0 transition-colors"
                style={cal.checked
                  ? {backgroundColor:cal.color, borderColor:cal.color}
                  : {borderColor:"#d1d5db"}}>
                {cal.checked && <span className="text-white text-xs font-bold">✓</span>}
              </div>
              <span className={`text-sm flex-1 ${cal.checked ? "text-gray-800" : "text-gray-400"}`}>
                {cal.label}
              </span>
              <User size={13} className="text-gray-300"/>
            </div>
          ))}
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
      className="fixed inset-0 z-50 bg-white flex flex-col">
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

        {/* 캘린더(담당팀) 선택 — 맨 위 네이버처럼 */}
        <div className="px-4 py-3 border-b border-gray-100">
          <select
            value={form.calId}
            onChange={e=>set("calId",e.target.value)}
            className="text-sm font-semibold outline-none bg-transparent"
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
                ${form.allDay?"bg-gray-400":"bg-gray-200"}`}>
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

        {/* 담당팀 — 캘린더(팀) 선택 드롭다운, 초기값 미정 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
          <User size={18} className="text-gray-400 shrink-0"/>
          <span className="text-sm text-gray-500 shrink-0">담당팀</span>
          <select
            value={form.team||""}
            onChange={e=>set("team",e.target.value)}
            className="flex-1 text-sm text-gray-800 outline-none bg-transparent text-right">
            <option value="">미정</option>
            {cals.map(cal=>(
              <option key={cal.id} value={cal.label}>{cal.label}</option>
            ))}
          </select>
        </div>

        {/* 주소 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
          <MapPin size={18} className="text-gray-400 shrink-0"/>
          <input value={form.place} onChange={e=>set("place",e.target.value)}
            placeholder="장소"
            className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-300"/>
        </div>

        {/* 연락처 */}
        <div className="flex items-center gap-3 px-4 py-4 border-b border-gray-100">
          <span className="text-gray-400 shrink-0 text-base">📞</span>
          <input
            value={form.contact||""}
            onChange={e=>set("contact",e.target.value)}
            placeholder="연락처"
            className="flex-1 text-sm text-gray-800 outline-none placeholder-gray-300"/>
        </div>

        {/* 내용 */}
        <div className="flex gap-3 px-4 py-4 border-b border-gray-100">
          <AlignLeft size={18} className="text-gray-400 shrink-0 mt-0.5"/>
          <textarea value={form.description} onChange={e=>set("description",e.target.value)}
            placeholder="내용" rows={5}
            className="flex-1 text-sm text-gray-800 outline-none resize-none placeholder-gray-300 leading-relaxed"/>
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
  const { current, setCurrent, setDrawer, sheetMode, setSheetMode, selDate, setSelDate } = useC();
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
        <button onClick={()=>{setCurrent(new Date());setSelDate(fmt(new Date()));}} className="p-2">
          <Calendar size={22} className="text-gray-700"/>
        </button>
        <button className="p-2"><Search size={22} className="text-gray-700"/></button>
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
export default function App() {
  return (
    <Provider>
      <AppInner/>
    </Provider>
  );
}

function AppInner() {
  return (
    <div className="h-screen flex flex-col overflow-hidden bg-white max-w-sm mx-auto relative select-none">
      <style>{ANIM_CSS}</style>
      <TopHeader/>
      <CalendarView/>
      <FloatingButtons/>
      <SideDrawer/>
      <DetailSheet/>
      <EventModal/>
    </div>
  );
}
