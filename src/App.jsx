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
  PieChart, Bell, History, ExternalLink, Activity,
  CheckSquare, FileText, Camera, Download
} from "lucide-react";

import { auth, provider, db, secondaryAuth } from "./firebase";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { collection, doc, setDoc, getDoc, getDocs, onSnapshot, query, orderBy, deleteDoc, serverTimestamp } from "firebase/firestore";

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

function Provider({ children, loginUser, onLogout }) {
  const companyRef = doc(db, "companies", loginUser.companyId);

  // Firestore 데이터
  const [events, setEvents] = useState([]);
  const [cals, setCals] = useState(CALS); // 기본 캘린더 목록
  const [teams, setTeams] = useState(INIT_TEAMS);
  const [users, setUsers] = useState(INIT_USERS);
  const [activityLogs, setActivityLogs] = useState([]);
  const [notices, setNotices] = useState([]);
  const [links, setLinks] = useState([]);

  useEffect(() => {
    const unsubEvents = onSnapshot(collection(companyRef, "events"), snap => {
      setEvents(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubUsers = onSnapshot(collection(companyRef, "users"), snap => {
      if(!snap.empty) setUsers(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubTeams = onSnapshot(collection(companyRef, "teams"), snap => {
      if(!snap.empty) setTeams(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubLogs = onSnapshot(query(collection(companyRef, "activityLogs"), orderBy("time", "desc")), snap => {
      setActivityLogs(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubNotices = onSnapshot(collection(companyRef, "notices"), snap => {
      setNotices(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubLinks = onSnapshot(collection(companyRef, "links"), snap => {
      setLinks(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubCals = onSnapshot(collection(companyRef, "cals"), snap => {
      if (!snap.empty) setCals(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });

    return () => {
      unsubEvents(); unsubUsers(); unsubTeams(); unsubLogs(); unsubNotices(); unsubLinks(); unsubCals();
    };
  }, [loginUser.companyId]);

  const addLog = useCallback((action, detail) => {
    const newLogRef = doc(collection(companyRef, "activityLogs"));
    setDoc(newLogRef, { time: new Date().toISOString(), user: loginUser, action, detail });
  }, [loginUser, companyRef]);

  const addEvent = useCallback(ev => {
    const evRef = doc(collection(companyRef, "events"));
    setDoc(evRef, { ...ev });
    addLog("등록", `'${ev.title}' 일정을 등록했습니다.`);
  }, [addLog, companyRef]);
  
  const updateEvent = useCallback(ev => {
    setDoc(doc(companyRef, "events", ev.id), ev);
    addLog("수정", `'${ev.title}' 일정을 수정했습니다.`);
  }, [addLog, companyRef]);
  
  const deleteEvent = useCallback(id => {
    const target = events.find(e => e.id === id);
    deleteDoc(doc(companyRef, "events", id));
    if (target) addLog("삭제", `'${target.title}' 일정을 삭제했습니다.`);
  }, [events, addLog, companyRef]);
  
  const toggleCal = useCallback(id => {
    const target = cals.find(c => c.id === id);
    if(target) {
      const nextCals = cals.map(c=>c.id===id?{...c,checked:!c.checked}:c);
      setCals(nextCals);
      nextCals.forEach(c => setDoc(doc(companyRef, "cals", c.id), c));
    }
  }, [cals, companyRef]);

  // UI 상태
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
  const [sheetMode,setSheetMode] = useState(1);
  const [teamModal, setTeamModal] = useState(false);
  const [currentScreen, setCurrentScreen] = useState("calendar");
  const [empModal, setEmpModal] = useState({ open: false, editId: null });
  const [companySettingsModal, setCompanySettingsModal] = useState(false);

  const currentUser = loginUser;

  const openModal   = useCallback((date=null,editId=null)=>setModal({open:true,date,editId}),[]);
  const closeModal  = useCallback(()=>setModal({open:false,date:null,editId:null}),[]);

  const checkedIds     = useMemo(()=>new Set(cals.filter(c=>c.checked).map(c=>c.id)),[cals]);
  const visibleEvents  = useMemo(()=>{
    let evs = events.filter(e=>checkedIds.has(e.calId));
    if (!["사장", "관리팀", "영업팀"].includes(currentUser.team) && currentUser.role !== "최고관리자") {
      const myTeamKeyword = currentUser.team.replace("팀", ""); 
      evs = evs.filter(e => {
        const cal = CALS.find(c=>c.id===e.calId);
        return cal && cal.label.includes(myTeamKeyword);
      });
    }
    return evs;
  }, [events, checkedIds, currentUser.team, currentUser.role]);

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
      currentUser,setCurrentUser: ()=>{},onLogout,
      currentScreen,setCurrentScreen,
      empModal,setEmpModal,
      companySettingsModal,setCompanySettingsModal,
      activityLogs,setActivityLogs,
      notices,setNotices,
      links,setLinks,
      companyId: loginUser.companyId
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
              <button onClick={() => { setDrawer(false); setCompanySettingsModal(true); }} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-800 rounded-full hover:bg-gray-100 transition-colors">
                <Settings size={20} />
              </button>
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
          {/* 팀별 일정 - 팀원 제외 */}
          {currentUser.role !== "팀원" && (
            <button
              onClick={() => { setCurrentScreen("team_schedule"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <Calendar size={20} className="text-indigo-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">팀별 일정</span>
            </button>
          )}

          {/* 대시보드 - 팀원 제외 */}
          {currentUser.role !== "팀원" && (
            <button
              onClick={() => { setCurrentScreen("dashboard"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <PieChart size={20} className="text-blue-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">일정 요약</span>
            </button>
          )}

          {/* 공지사항 - 전체 */}
          <button
            onClick={() => { setCurrentScreen("notice"); setDrawer(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <Bell size={20} className="text-orange-500" />
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">팀 공지사항</span>
          </button>

          {/* 변경 로그 - 최고관리자, 관리팀장만 */}
          {(currentUser.role === "최고관리자" || currentUser.role === "관리팀장") && (
            <button
              onClick={() => { setCurrentScreen("activity_log"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <History size={20} className="text-green-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">변경 로그</span>
            </button>
          )}

          {/* 완료 보고 내역 - 팀원 제외 */}
          {currentUser.role !== "팀원" && (
            <button
              onClick={() => { setCurrentScreen("report_history"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <CheckSquare size={20} className="text-blue-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">완료 보고 내역</span>
            </button>
          )}
          <button 
            onClick={() => { setCurrentScreen("links"); setDrawer(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <ExternalLink size={20} className="text-purple-500" />
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">자주 쓰는 외부 링크</span>
          </button>
          {/* 캘린더 가져오기 - 팀원 제외 */}
          {currentUser.role !== "팀원" && (
            <button
              onClick={() => { setCurrentScreen("import_calendar"); setDrawer(false); }}
              className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
              <Download size={20} className="text-teal-500" />
              <span className="text-sm font-medium text-gray-700 flex-1 text-left">📥 캘린더 가져오기</span>
            </button>
          )}
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
  const [aiMode,setAiMode]=useState(false);   // true=AI 상담대화 모드
  const [aiLoading,setAiLoading]=useState(false);
  // step: "paste"=텍스트입력단계, "form"=일정폼단계
  const [step,setStep]=useState("paste");
  const tRef=useRef(null);
  const set=(k,v)=>setForm(p=>({...p,[k]:v}));

  useEffect(()=>{
    if(open){
      setForm(editEv?{...editEv}:blank(date));
      setErrs({});
      setPasteText("");
      setAiMode(false);
      setAiLoading(false);
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
            {/* 탭 전환 */}
            <div className="flex gap-2 mb-4">
              <button
                onClick={()=>setAiMode(false)}
                className={"flex-1 py-2 rounded-xl text-sm font-bold transition-all " + (!aiMode ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500")}>
                📋 메모·문자 입력
              </button>
              <button
                onClick={()=>setAiMode(true)}
                className={"flex-1 py-2 rounded-xl text-sm font-bold transition-all " + (aiMode ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-500")}>
                💬 상담 대화 AI 분석
              </button>
            </div>

            {!aiMode ? (
              <>
                <p className="text-sm text-gray-500 mb-3">
                  📋 카카오톡 문자나 메모를 붙여넣으면 날짜·장소·연락처·비밀번호를 자동으로 정리해드려요.
                </p>
                <textarea
                  autoFocus
                  value={pasteText}
                  onChange={e=>setPasteText(e.target.value)}
                  placeholder={"여기에 내용을 입력하거나 붙여넣으세요...\n\n예)\n6월 15일 오전\n서울시 동대문구 망우로1길27\n이효림 010-2192-9533\n비밀번호 1469*"}
                  rows={12}
                  className="w-full text-sm outline-none resize-none text-gray-800 placeholder-gray-300 leading-relaxed"
                />
              </>
            ) : (
              <>
                <p className="text-sm text-gray-500 mb-3">
                  💬 고객과 나눈 카카오톡 상담 대화를 통째로 붙여넣으면 AI가 예약 정보를 뽑아드려요.
                </p>
                <textarea
                  value={pasteText}
                  onChange={e=>setPasteText(e.target.value)}
                  placeholder={"[고객]\n안녕하세요! 청소 견적 문의드려요...\n\n[사장님]\n안녕하세요! 연락 주셔서 감사합니다..."}
                  rows={12}
                  className="w-full text-sm outline-none resize-none text-gray-800 placeholder-gray-300 leading-relaxed"
                />
              </>
            )}
          </div>
          <div className="px-4 py-3 border-t border-gray-100">
            <button
              disabled={aiLoading}
              onClick={async ()=>{
                if(!pasteText.trim()){ setStep("form"); return; }
                if(!aiMode){
                  // 기존 정규식 파싱
                  const parsed = parseEventText(pasteText);
                  setForm(p=>({...p, ...parsed}));
                  setStep("form");
                } else {
                  // AI 분석
                  setAiLoading(true);
                  try {
                    const res = await fetch("https://api.anthropic.com/v1/messages", {
                      method: "POST",
                      headers: {"Content-Type":"application/json"},
                      body: JSON.stringify({
                        model: "claude-sonnet-4-6",
                        max_tokens: 1000,
                        system: `청소업체 상담 대화를 분석해서 예약 정보를 JSON으로만 반환하세요. 마크다운 없이 순수 JSON만.
{
  "title": "일정 제목 (예: 강남구 OO동 입주청소 30평)",
  "start": "YYYY-MM-DD 형식 또는 null",
  "end": "YYYY-MM-DD 형식 또는 null",
  "startTime": "HH:MM 24시간 또는 null",
  "endTime": "HH:MM 24시간 또는 null",
  "place": "주소",
  "contact": "연락처 또는 null",
  "description": "금액·예약금·인원·포함항목·특이사항 등 메모"
}`,
                        messages:[{role:"user",content:`다음 상담 대화에서 예약 정보를 추출해주세요:\n\n${pasteText}`}]
                      })
                    });
                    const data = await res.json();
                    const text = data.content[0].text.trim().replace(/\`\`\`json|\`\`\`/g,"").trim();
                    const parsed = JSON.parse(text);
                    setForm(p=>({
                      ...p,
                      title: parsed.title || p.title,
                      start: parsed.start || p.start,
                      end: parsed.end || parsed.start || p.end,
                      startTime: parsed.startTime || p.startTime,
                      endTime: parsed.endTime || p.endTime,
                      place: parsed.place || p.place,
                      contact: parsed.contact || p.contact,
                      description: parsed.description || p.description,
                    }));
                    setStep("form");
                  } catch(e) {
                    alert("AI 분석 중 오류가 발생했어요. 다시 시도해주세요.");
                    console.error(e);
                  } finally {
                    setAiLoading(false);
                  }
                }
              }}
              className={"w-full py-3 text-white text-sm font-bold rounded-2xl transition-all " + (aiLoading ? "bg-gray-300" : "bg-blue-500")}>
              {aiLoading ? "⏳ AI 분석 중..." : aiMode ? "✨ AI로 자동 분석" : (pasteText.trim() ? "✨ 자동 분석하고 계속" : "직접 입력하기")}
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
              <button onClick={() => { setDrawer(false); setCompanySettingsModal(true); }} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-800 rounded-full hover:bg-gray-100 transition-colors">
                <Settings size={20} />
              </button>
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
  const { current, setCurrent, setDrawer, sheetMode, setSheetMode, selDate, setSelDate, setSearchOpen, currentUser } = useC();
  const y=current.getFullYear(), m=current.getMonth();
  const [picker,setPicker]=useState(false);
  const DAYS=["일","월","화","수","목","금","토"];
  const d=pd(selDate), dow=d?.getDay()??0;

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100 relative">
      {/* 왼쪽: 회사명 or 뒤로가기 */}
      <div className="flex items-center gap-3">
        {sheetMode===2
          ? <button onClick={()=>setSheetMode(1)} className="p-1 -ml-1"><ChevronLeft size={22} className="text-gray-700"/></button>
          : <button onClick={()=>setDrawer(true)} className="p-1 -ml-1"><Menu size={22} className="text-gray-700"/></button>
        }
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold text-white shadow-sm overflow-hidden"
            style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
            {currentUser?.companyLogoUrl 
              ? <img src={currentUser.companyLogoUrl} alt="Logo" className="w-full h-full object-cover" />
              : (currentUser?.companyName?.charAt(0) || "🏢")}
          </div>
          <span className="font-extrabold text-gray-900 text-lg">{currentUser?.companyName || "로딩중..."}</span>
        </div>
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

// ── 완료 보고 히스토리 화면 ───────────────────────────────────────────────
function ReportHistoryScreen() {
  const { setCurrentScreen, events, cals, currentUser } = useC();

  // 샘플 보고 데이터 (Firebase 연동 전 목업)
  const sampleReports = [
    {id:"r1", title:"강남구 OO동 입주청소 30평", date:"2026-06-20", startTime:"09:00", teamName:"청소 1팀", teamColor:"#1a56db", status:"완료", memo:"주방 기름때 심했으나 완료. 베란다 청소 추가 진행.", price:"400,000"},
    {id:"r2", title:"마포구 아현동 이사청소 25평", date:"2026-06-19", startTime:"13:00", teamName:"청소 2팀", teamColor:"#16a34a", status:"완료", memo:"특이사항 없음. 깔끔하게 완료.", price:"320,000"},
    {id:"r3", title:"송파구 잠실 정기청소", date:"2026-06-18", startTime:"10:00", teamName:"청소 1팀", teamColor:"#1a56db", status:"완료", memo:"에어컨 필터 청소 추가 요청. 처리 완료.", price:"150,000"},
    {id:"r4", title:"동대문구 전농동 입주청소 33평", date:"2026-06-17", startTime:"09:30", teamName:"청소 3팀", teamColor:"#ea580c", status:"완료", memo:"인테리어 후 입주 청소. 실리콘 작업 흔적 제거 완료.", price:"450,000"},
    {id:"r5", title:"서초구 방배동 이사청소 28평", date:"2026-06-16", startTime:"14:00", teamName:"청소 2팀", teamColor:"#16a34a", status:"완료", memo:"특이사항 없음.", price:"350,000"},
  ];

  const [selected, setSelected] = useState(null);

  if(selected) {
    return (
      <div className="flex-1 overflow-y-auto bg-white flex flex-col">
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <button onClick={()=>setSelected(null)} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <h2 className="text-base font-bold text-gray-900 flex-1 line-clamp-1">보고서 상세</h2>
        </div>
        {/* 히어로 */}
        <div className="px-5 py-5" style={{background:`linear-gradient(135deg,${selected.teamColor},${selected.teamColor}cc)`}}>
          <p className="text-xs font-bold text-white/70 mb-1">{selected.teamName}</p>
          <p className="text-lg font-extrabold text-white leading-snug">{selected.title}</p>
          <p className="text-xs text-white/80 mt-2">📅 {selected.date} · {selected.startTime.replace(":","시 ")}분 시작</p>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Before/After 사진 영역 */}
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">📸 현장 사진</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="aspect-square rounded-2xl bg-gray-100 flex flex-col items-center justify-center border-2 border-dashed border-gray-200">
                <span className="text-2xl mb-1">📷</span>
                <p className="text-xs text-gray-400 font-medium">Before</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Firebase 연동 후</p>
              </div>
              <div className="aspect-square rounded-2xl bg-gray-100 flex flex-col items-center justify-center border-2 border-dashed border-gray-200">
                <span className="text-2xl mb-1">📷</span>
                <p className="text-xs text-gray-400 font-medium">After</p>
                <p className="text-[10px] text-gray-300 mt-0.5">Firebase 연동 후</p>
              </div>
            </div>
          </div>
          {/* 금액 */}
          <div className="bg-green-50 rounded-2xl p-4 flex items-center justify-between">
            <span className="text-sm font-bold text-green-700">💰 확정 금액</span>
            <span className="text-lg font-extrabold text-green-600">{selected.price}원</span>
          </div>
          {/* 메모 */}
          <div className="bg-gray-50 rounded-2xl p-4">
            <p className="text-xs font-bold text-gray-500 mb-2">📝 현장 메모</p>
            <p className="text-sm text-gray-700 leading-relaxed">{selected.memo}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="flex items-center gap-3 px-5 pt-5 pb-3">
        <button onClick={()=>setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-200">
          <ChevronLeft size={24} className="text-gray-700"/>
        </button>
        <h2 className="text-xl font-bold text-gray-900 flex-1">완료 보고 내역</h2>
        <span className="text-xs text-gray-400 font-medium">{sampleReports.length}건</span>
      </div>

      <div className="px-5 pb-8 flex flex-col gap-3">
        {sampleReports.map(r=>(
          <button key={r.id} onClick={()=>setSelected(r)}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-left w-full flex items-center gap-3 hover:border-blue-200 transition-all">
            {/* 팀 컬러 바 */}
            <div className="w-1 self-stretch rounded-full shrink-0" style={{background:r.teamColor}}/>
            {/* 사진 썸네일 자리 */}
            <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center text-2xl shrink-0">🏠</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{r.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{background:r.teamColor+"22",color:r.teamColor}}>{r.teamName}</span>
                <span className="text-xs text-gray-400">{r.date}</span>
              </div>
              <p className="text-xs text-green-600 font-bold mt-1">{r.price}원</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600">✅ {r.status}</span>
              <ChevronLeft size={14} className="text-gray-300 rotate-180"/>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}


// ── 캘린더 가져오기 화면 (.ics) ───────────────────────────────────────────────
function ImportCalendarScreen() {
  const { setCurrentScreen, addEvent, cals } = useC();
  const [step, setStep]                 = useState("upload");
  const [parsedEvents, setParsedEvents] = useState([]);
  const [selectedIds, setSelectedIds]   = useState([]);
  const [fileName, setFileName]         = useState("");
  const [error, setError]               = useState("");
  const [importing, setImporting]       = useState(false);

  const parseICS = (text) => {
    const events = [];
    const normalized = text.split("\r\n").join("\n").split("\r").join("\n");
    const lines = normalized.split("\n");
    let current = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "BEGIN:VEVENT") {
        current = {};
      } else if (line === "END:VEVENT" && current) {
        if (current.title && current.start) events.push(current);
        current = null;
      } else if (current) {
        if (line.startsWith("SUMMARY:")) {
          current.title = line.replace("SUMMARY:", "").trim();
        } else if (line.startsWith("DTSTART")) {
          const val = line.split(":").pop().trim();
          current.start = val.length >= 8
            ? val.slice(0,4) + "-" + val.slice(4,6) + "-" + val.slice(6,8)
            : val;
          if (val.length > 8) {
            const h = val.slice(9, 11);
            const m = val.slice(11, 13);
            current.startTime = h + ":" + m;
            current.allDay = false;
          } else {
            current.allDay = true;
          }
        } else if (line.startsWith("DTEND")) {
          const val = line.split(":").pop().trim();
          current.end = val.length >= 8
            ? val.slice(0,4) + "-" + val.slice(4,6) + "-" + val.slice(6,8)
            : val;
          if (val.length > 8) {
            const h = val.slice(9, 11);
            const m = val.slice(11, 13);
            current.endTime = h + ":" + m;
          }
        } else if (line.startsWith("LOCATION:")) {
          current.place = line.replace("LOCATION:", "").trim();
        } else if (line.startsWith("DESCRIPTION:")) {
          current.description = line.replace("DESCRIPTION:", "").trim();
        }
      }
    }
    return events;
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.name.endsWith(".ics")) {
      setError(".ics 파일만 업로드 가능합니다.");
      return;
    }
    setFileName(file.name);
    setError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseICS(ev.target.result);
      if (parsed.length === 0) {
        setError("일정을 찾을 수 없습니다. 파일을 확인해주세요.");
        return;
      }
      setParsedEvents(parsed);
      setSelectedIds(parsed.map((_, i) => i));
      setStep("preview");
    };
    reader.readAsText(file, "utf-8");
  };

  const handleImport = () => {
    setImporting(true);
    const toImport = parsedEvents.filter((_, i) => selectedIds.includes(i));
    toImport.forEach(ev => {
      addEvent({
        ...ev,
        id: uid(),
        calId: cals[0]?.id || "clean1",
        end: ev.end || ev.start,
        startTime: ev.startTime || "09:00",
        endTime: ev.endTime || "10:00",
        allDay: ev.allDay || false,
        place: ev.place || "",
        description: ev.description || "",
      });
    });
    setTimeout(() => { setImporting(false); setStep("done"); }, 800);
  };

  const toggleSelect = (i) => {
    setSelectedIds(p => p.includes(i) ? p.filter(x => x !== i) : [...p, i]);
  };

  if (step === "done") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white px-8 text-center">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="text-xl font-bold text-gray-900 mb-2">가져오기 완료!</h2>
        <p className="text-sm text-gray-500 mb-8">{selectedIds.length}개 일정이 캘린더에 추가됐어요.</p>
        <button onClick={() => setCurrentScreen("calendar")}
          className="w-full py-4 rounded-2xl text-white font-bold text-sm"
          style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
          캘린더로 돌아가기
        </button>
      </div>
    );
  }

  if (step === "preview") {
    return (
      <div className="flex-1 flex flex-col bg-gray-50 min-h-screen">
        <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <button onClick={() => setStep("upload")} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
              <ChevronLeft size={24} className="text-gray-700"/>
            </button>
            <h2 className="text-xl font-bold text-gray-900 flex-1">일정 선택</h2>
            <span className="text-xs font-bold text-blue-500 bg-blue-50 px-3 py-1.5 rounded-full">
              {selectedIds.length}/{parsedEvents.length}개 선택
            </span>
          </div>
          <p className="text-xs text-gray-400 ml-10">{fileName}</p>
        </div>
        <div className="px-4 py-3 flex items-center gap-3 bg-white border-b border-gray-100">
          <button
            onClick={() => setSelectedIds(
              selectedIds.length === parsedEvents.length ? [] : [...Array(parsedEvents.length).keys()]
            )}
            className="flex items-center gap-2 text-sm font-bold text-blue-500">
            <div className={"w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all " +
              (selectedIds.length === parsedEvents.length ? "bg-blue-500 border-blue-500" : "border-gray-300")}>
              {selectedIds.length === parsedEvents.length && <span className="text-white text-xs">✓</span>}
            </div>
            전체 {selectedIds.length === parsedEvents.length ? "해제" : "선택"}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 pb-32">
          {parsedEvents.map((ev, i) => {
            const checked = selectedIds.includes(i);
            return (
              <button key={i} onClick={() => toggleSelect(i)}
                className="w-full text-left bg-white rounded-2xl border p-4 flex items-center gap-3 transition-all"
                style={{borderColor: checked ? "#1a56db" : "#f3f4f6",
                  boxShadow: checked ? "0 0 0 3px rgba(26,86,219,.08)" : "none"}}>
                <div className={"w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all " +
                  (checked ? "bg-blue-500 border-blue-500" : "border-gray-300")}>
                  {checked && <span className="text-white text-xs">✓</span>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{ev.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {ev.start}{ev.startTime ? " · " + ev.startTime : " · 종일"}
                    {ev.place ? " · " + ev.place : ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        <div className="fixed bottom-0 left-0 right-0 px-4 pb-8 pt-3 bg-white border-t border-gray-100"
          style={{maxWidth: 430, margin: "0 auto"}}>
          <button onClick={handleImport} disabled={selectedIds.length === 0 || importing}
            className="w-full py-4 rounded-2xl text-white font-bold text-sm"
            style={{background: selectedIds.length > 0 ? "linear-gradient(135deg,#1a56db,#2563eb)" : "#e5e7eb"}}>
            {importing ? "가져오는 중..." : "📥 " + selectedIds.length + "개 일정 가져오기"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-screen">
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <h2 className="text-xl font-bold text-gray-900">캘린더 가져오기</h2>
        </div>
      </div>
      <div className="px-5 py-6 flex flex-col gap-5">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col gap-4">
          <h3 className="text-sm font-bold text-gray-700">📥 어떤 파일을 가져올 수 있나요?</h3>
          {[
            {icon:"🟢", label:"네이버 캘린더", desc:"캘린더 설정 → 내보내기 → .ics 다운로드"},
            {icon:"🔵", label:"구글 캘린더",   desc:"설정 → 가져오기/내보내기 → .ics 다운로드"},
            {icon:"⚫", label:"애플 캘린더",   desc:"파일 → 내보내기 → .ics 저장"},
          ].map((s, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="text-lg">{s.icon}</span>
              <div>
                <p className="text-sm font-bold text-gray-800">{s.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <label className="block cursor-pointer">
          <div className="border-2 border-dashed border-blue-200 rounded-2xl p-10 text-center bg-blue-50/50 hover:bg-blue-50 transition-all">
            <div className="text-4xl mb-3">📂</div>
            <p className="text-sm font-bold text-gray-700 mb-1">.ics 파일 선택</p>
            <p className="text-xs text-gray-400">탭해서 파일을 선택하세요</p>
          </div>
          <input type="file" accept=".ics" onChange={handleFile} className="hidden"/>
        </label>
        {error && (
          <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-500 font-semibold">
            ⚠️ {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 로그인 화면 ───────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [tab, setTab]         = useState("google");
  const [staffId, setStaffId] = useState("");
  const [staffPw, setStaffPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [showPw, setShowPw]   = useState(false);

  const handleGoogle = async () => {
    setLoading(true); setError("");
    try {
      // 팝업 문제로 인해 리다이렉트 방식으로 전면 교체
      await signInWithPopup(auth, provider);
    } catch (e) {
      console.error(e);
      setError("구글 로그인으로 이동할 수 없습니다.");
      setLoading(false);
    }
  };

  const handleStaff = async () => {
    if(!staffId||!staffPw){ setError("이메일과 비밀번호를 입력하세요."); return; }
    setLoading(true); setError("");
    try {
      await signInWithEmailAndPassword(auth, staffId, staffPw);
    } catch (e) {
      console.error(e);
      setError("이메일 또는 비밀번호가 올바르지 않습니다.");
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white min-h-screen">
      <div className="flex-1 flex flex-col items-center justify-center px-8 pt-16 pb-8">
        <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-xl"
          style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>🧹</div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">클린메니저</h1>
        <p className="text-sm text-gray-400">현장 관리 앱</p>
      </div>
      <div className="px-6 pb-12 flex flex-col gap-3">
        <div className="flex bg-gray-100 rounded-2xl p-1 gap-1 mb-1">
          {[["google","👑 업체 등록 / 관리자"],["staff","👤 직원"]].map(([k,l])=>(
            <button key={k} onClick={()=>{setTab(k);setError("");}}
              className={"flex-1 py-2.5 rounded-xl text-sm font-bold transition-all " +
                (tab===k?"bg-white shadow text-gray-900":"text-gray-400")}>
              {l}
            </button>
          ))}
        </div>
        {tab==="google" && (
          <div className="flex flex-col gap-3">
            <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100">
              <p className="text-sm font-bold text-blue-600 mb-1">최고관리자 / 신규 가입</p>
              <p className="text-xs text-gray-500 leading-relaxed">Google 계정으로 로그인하여 업체를 등록하거나 관리자 계정으로 접속합니다.</p>
            </div>
            <button onClick={handleGoogle} disabled={loading}
              className="w-full py-4 rounded-2xl border border-gray-200 bg-white text-gray-700 text-sm font-bold flex items-center justify-center gap-3 shadow-sm"
              style={{opacity:loading?0.7:1}}>
              {loading
                ? <div className="w-5 h-5 rounded-full border-2 border-gray-200 border-t-blue-500" style={{animation:"spin .7s linear infinite"}}/>
                : <svg width="20" height="20" viewBox="0 0 48 48">
                    <path fill="#FFC107" d="M43.6 20H24v8h11.3C33.6 33.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C33.9 6.5 29.2 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20c11 0 20-8.9 20-20 0-1.3-.1-2.7-.4-4z"/>
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.5 19 12 24 12c3 0 5.7 1.1 7.8 2.9l5.7-5.7C33.9 6.5 29.2 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/>
                    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.3 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.3 16.3 44 24 44z"/>
                    <path fill="#1976D2" d="M43.6 20H24v8h11.3c-.9 2.7-2.7 4.9-5.1 6.4l6.2 5.2C40.5 36 44 30.4 44 24c0-1.3-.1-2.7-.4-4z"/>
                  </svg>
              }
              {loading?"로그인 중...":"Google 계정으로 로그인"}
            </button>
          </div>
        )}
        {tab==="staff" && (
          <div className="flex flex-col gap-3">
            <div className="p-4 rounded-2xl bg-gray-50 border border-gray-100">
              <p className="text-sm font-bold text-gray-700 mb-1">직원 로그인</p>
              <p className="text-xs text-gray-400 leading-relaxed">관리자에게 받은 이메일/비밀번호로 로그인하세요.</p>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">👤</span>
              <input type="email" placeholder="이메일" value={staffId} onChange={e=>{setStaffId(e.target.value);setError("");}}
                className={"w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border " +
                  (error?"border-red-300":staffId?"border-blue-400":"border-gray-200")}/>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
              <input type={showPw?"text":"password"} placeholder="비밀번호" value={staffPw}
                onChange={e=>{setStaffPw(e.target.value);setError("");}}
                onKeyDown={e=>e.key==="Enter"&&handleStaff()}
                className={"w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border " +
                  (error?"border-red-300":staffPw?"border-blue-400":"border-gray-200")}/>
              <button onClick={()=>setShowPw(p=>!p)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-base border-none bg-transparent cursor-pointer">
                {showPw?"🙈":"👁️"}
              </button>
            </div>
            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-500 font-semibold">
                ⚠️ {error}
              </div>
            )}
            <button onClick={handleStaff} disabled={loading}
              className="w-full py-4 rounded-2xl text-white text-sm font-bold mt-1"
              style={{background:staffId&&staffPw?"linear-gradient(135deg,#1a56db,#2563eb)":"#e5e7eb",opacity:loading?0.7:1}}>
              {loading?"로그인 중...":"로그인"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 신규 가입 화면 ───────────────────────────────────────────────
function RegisterScreen({ user, onComplete }) {
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  
  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setLogoUrl(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleRegister = async () => {
    if (!companyName.trim()) return alert("회사명을 입력해주세요.");
    setLoading(true);
    try {
      const companyId = "c_" + Date.now().toString(36);
      
      // 회사 정보 생성
      await setDoc(doc(db, "companies", companyId), {
        name: companyName,
        createdAt: serverTimestamp(),
        ownerUid: user.uid
      });
      
      // 관리자 계정 정보 생성
      const adminData = {
        email: user.email,
        name: user.displayName || "최고관리자",
        companyId: companyId,
        role: "최고관리자",
        team: "관리팀",
        createdAt: serverTimestamp()
      };
      await setDoc(doc(db, "admins", user.uid), adminData);
      
      // 유저 정보에 company 이름도 담아서 onComplete
      onComplete({ uid: user.uid, ...adminData, companyName, companyLogoUrl: logoUrl });
    } catch (e) {
      console.error(e);
      alert("가입 중 오류가 발생했습니다.");
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white min-h-screen items-center justify-center px-8">
      <label className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-xl overflow-hidden cursor-pointer bg-gray-100 border-2 border-dashed border-gray-300 hover:border-blue-500 transition-colors"
        style={{background: logoUrl ? "#fff" : "linear-gradient(135deg,#1a56db,#2563eb)"}}>
        {logoUrl ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" /> : "🏢"}
        <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
      </label>
      <p className="text-xs text-gray-400 -mt-4 mb-4 text-center">로고 이미지를 선택하세요 (선택)</p>
      <h1 className="text-2xl font-extrabold text-gray-900 mb-2">회사 등록</h1>
      <p className="text-sm text-gray-500 mb-8 text-center">환영합니다!<br/>앱을 사용할 회사(업체) 이름을 입력해주세요.</p>
      
      <input value={companyName} onChange={e=>setCompanyName(e.target.value)}
        placeholder="회사명 (예: 클린메니저)"
        className="w-full py-4 px-5 rounded-2xl bg-gray-50 border border-gray-200 text-base font-bold outline-none focus:border-blue-500 mb-4" />
      
      <button onClick={handleRegister} disabled={loading || !companyName.trim()}
        className="w-full py-4 rounded-2xl text-white font-bold transition-opacity"
        style={{background:companyName.trim()?"linear-gradient(135deg,#1a56db,#2563eb)":"#e5e7eb", opacity: loading ? 0.7 : 1}}>
        {loading ? "등록 중..." : "가입 완료"}
      </button>
    </div>
  );
}

function AppInner() {
  const { currentScreen } = useC();
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
      {currentScreen === "employees"    && <EmployeeListScreen/>}
      {currentScreen === "team_schedule"&& <TeamScheduleScreen/>}
      {currentScreen === "dashboard"    && <DashboardScreen/>}
      {currentScreen === "notice"       && <NoticeScreen/>}
      {currentScreen === "activity_log" && <ActivityLogScreen/>}
      {currentScreen === "links"        && <ExternalLinksScreen/>}
      {currentScreen === "report_history"&& <ReportHistoryScreen/>}
      {currentScreen === "import_calendar" && <ImportCalendarScreen/>}
      <SideDrawer/>
      <DetailSheet/>
      <EventModal/>
      <SearchModal/>
      <EmployeeFormModal/>
      <TeamManagementModal/>
      <CompanySettingsModal/>
    </div>
  );
}

export default function App() {
  const [authState, setAuthState] = useState("loading"); // "loading" | "login" | "register" | "app"
  const [loginUser, setLoginUser] = useState(null);

  useEffect(() => {
    // 리다이렉트 결과(에러 등) 확인
    getRedirectResult(auth).then((result) => {
      if (result) {
        console.log("Redirect login success:", result);
      }
    }).catch((error) => {
      console.error("Redirect login error:", error);
      alert("로그인 에러: " + (error.message || "원인을 알 수 없는 오류"));
    });

    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          // 1. 최고관리자 확인
          const adminDoc = await getDoc(doc(db, "admins", user.uid));
          if (adminDoc.exists()) {
            const data = adminDoc.data();
            const compDoc = await getDoc(doc(db, "companies", data.companyId));
            const companyName = compDoc.exists() ? compDoc.data().name : "클린메니저";
            const companyLogoUrl = compDoc.exists() ? compDoc.data().logoUrl : null;
            
            setLoginUser({ uid: user.uid, email: user.email, name: data.name || user.displayName, companyId: data.companyId, companyName, companyLogoUrl, role: data.role || "최고관리자", team: data.team || "관리팀" });
            setAuthState("app");
            return;
          }
          
          // 2. 일반 직원 확인
          const staffDoc = await getDoc(doc(db, "staffs", user.uid));
          if (staffDoc.exists()) {
            const data = staffDoc.data();
            const compDoc = await getDoc(doc(db, "companies", data.companyId));
            const companyName = compDoc.exists() ? compDoc.data().name : "클린메니저";
            const companyLogoUrl = compDoc.exists() ? compDoc.data().logoUrl : null;
            
            setLoginUser({ uid: user.uid, email: user.email, name: data.name, companyId: data.companyId, companyName, companyLogoUrl, role: data.role, team: data.team });
            setAuthState("app");
            return;
          }

          // 3. 둘 다 없으면 신규 가입
          setLoginUser(user);
          setAuthState("register");
          
        } catch(e) {
          console.error(e);
          setAuthState("login");
        }
      } else {
        setLoginUser(null);
        setAuthState("login");
      }
    });
    return () => unsub();
  }, []);

  if (authState === "loading") {
    return <div className="flex-1 flex min-h-screen items-center justify-center bg-gray-50">로딩 중...</div>;
  }
  if (authState === "login") {
    return <LoginScreen />;
  }
  if (authState === "register") {
    return <RegisterScreen user={loginUser} onComplete={(user) => {
      setLoginUser(user);
      setAuthState("app");
    }} />;
  }

  return (
    <Provider loginUser={loginUser} onLogout={() => signOut(auth)}>
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
  const { empModal, setEmpModal, users, teams, companyId } = useC();
  const [form, setForm] = useState({ name: "", phone: "", team: "입주청소팀", role: "팀원", email: "", password: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (empModal.open) {
      if (empModal.editId) {
        const u = users.find(x => x.id === empModal.editId);
        if (u) setForm({ ...u, password: "" });
      } else {
        setForm({ name: "", phone: "", team: "입주청소팀", role: "팀원", email: "", password: "" });
      }
    }
  }, [empModal.open, empModal.editId, users]);

  if (!empModal.open) return null;

  const close = () => { if(!loading) setEmpModal({open:false, editId:null}); };
  
  const save = async () => {
    if (!form.name.trim() || !form.email.trim()) return alert("이름과 이메일은 필수입니다.");
    if (!empModal.editId && !form.password) return alert("초기 비밀번호를 입력하세요.");
    setLoading(true);
    
    try {
      if (empModal.editId) {
        // 기존 유저 수정
        const { password, ...updateData } = form;
        await setDoc(doc(db, "companies", companyId, "users", empModal.editId), updateData, { merge: true });
        await setDoc(doc(db, "staffs", empModal.editId), { ...updateData, companyId }, { merge: true });
      } else {
        // 새 유저 생성 (secondaryAuth 이용, 메인 세션 유지)
        const { user: newAuthUser } = await createUserWithEmailAndPassword(secondaryAuth, form.email, form.password);
        const uid = newAuthUser.uid;
        
        const userData = {
          name: form.name,
          phone: form.phone,
          team: form.team,
          role: form.role,
          email: form.email,
          createdAt: serverTimestamp()
        };
        
        await setDoc(doc(db, "companies", companyId, "users", uid), userData);
        await setDoc(doc(db, "staffs", uid), { ...userData, companyId });
        await signOut(secondaryAuth); // secondaryAuth 세션 정리
      }
      close();
    } catch (e) {
      console.error(e);
      alert("저장 중 오류가 발생했습니다: " + e.message);
    } finally {
      setLoading(false);
    }
  };

  const del = async () => {
    if (confirm("정말 이 직원을 삭제하시겠습니까?")) {
      setLoading(true);
      try {
        await deleteDoc(doc(db, "companies", companyId, "users", empModal.editId));
        await deleteDoc(doc(db, "staffs", empModal.editId));
        // Auth에서의 실제 계정 삭제는 Admin SDK 등 서버사이드 처리가 필요하므로 DB만 제거
        close();
      } catch(e) {
        alert("삭제 실패");
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="absolute inset-0 z-[70] bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{empModal.editId ? "직원 수정" : "새 직원 등록"}</h2>
          <button onClick={close} className="p-1 -mr-1 rounded-full hover:bg-gray-100"><X size={20} className="text-gray-500"/></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">이메일 (아이디)</label>
            <input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} disabled={!!empModal.editId} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800 disabled:bg-gray-100" placeholder="staff@company.com" />
          </div>
          {!empModal.editId && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">초기 비밀번호</label>
              <input type="text" value={form.password} onChange={e=>setForm({...form,password:e.target.value})} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800" placeholder="임시 비밀번호 입력" />
            </div>
          )}
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
              {teams.length ? teams.map(t => (
                <option key={t.id || t.name || t} value={t.name || t}>{t.name || t}</option>
              )) : <option value="입주청소팀">입주청소팀</option>}
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
            <button onClick={del} disabled={loading} className="px-4 py-2 text-sm font-bold text-red-500 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50">삭제</button>
          )}
          <div className="flex-1"></div>
          <button onClick={close} disabled={loading} className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-200 rounded-lg disabled:opacity-50">취소</button>
          <button onClick={save} disabled={loading} className="px-5 py-2 text-sm font-bold text-white bg-gray-900 hover:bg-black rounded-lg flex items-center justify-center min-w-[80px]">
            {loading ? <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"/> : "저장"}
          </button>
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
// 카드 선택형 대시보드
const ALL_DASH_CARDS = [
  {id:"today_count",   label:"오늘 일정",      icon:"📅", color:"#1a56db", bg:"#eff6ff", roles:["최고관리자","관리팀장","현장팀장"],
    getValue:(ev,user)=>{const f=user.calId?ev.filter(e=>e.calId===user.calId):ev;const t=fmt(new Date());return{value:f.filter(e=>e.start<=t&&(!e.end||e.end>=t)).length,unit:"건"};}},
  {id:"tomorrow_count",label:"내일 일정",      icon:"🗓️", color:"#7c3aed", bg:"#f5f3ff", roles:["최고관리자","관리팀장","현장팀장"],
    getValue:(ev,user)=>{const f=user.calId?ev.filter(e=>e.calId===user.calId):ev;const t=fmt(new Date(Date.now()+86400000));return{value:f.filter(e=>e.start<=t&&(!e.end||e.end>=t)).length,unit:"건"};}},
  {id:"month_count",   label:"이번달 총",      icon:"📈", color:"#16a34a", bg:"#f0fdf4", roles:["최고관리자","관리팀장","영업팀장","현장팀장"],
    getValue:(ev,user)=>{const f=user.calId?ev.filter(e=>e.calId===user.calId):ev;const m=fmt(new Date()).slice(0,7);return{value:f.filter(e=>e.start.startsWith(m)).length,unit:"건"};}},
  {id:"complaint",     label:"미처리 컴플레인", icon:"🚨", color:"#ef4444", bg:"#fef2f2", roles:["최고관리자","관리팀장"],
    getValue:()=>({value:0,unit:"건"})},
  {id:"month_revenue", label:"이번달 매출",    icon:"💰", color:"#16a34a", bg:"#f0fdf4", roles:["최고관리자","영업팀장"],
    getValue:(ev)=>{const m=fmt(new Date()).slice(0,7);return{value:Math.round(ev.filter(e=>e.start.startsWith(m)).reduce((s,e)=>s+(e.price||0),0)/10000),unit:"만원"};}},
  {id:"week_contract", label:"이번주 계약",    icon:"📋", color:"#7c3aed", bg:"#f5f3ff", roles:["최고관리자","영업팀장"],
    getValue:(ev)=>{const d=new Date(),day=d.getDay(),ws=fmt(new Date(new Date().setDate(d.getDate()-day+(day===0?-6:1))));return{value:ev.filter(e=>e.start>=ws&&e.start<=fmt(new Date())).length,unit:"건"};}},
  {id:"team_count",    label:"운영 팀 수",     icon:"🧹", color:"#ea580c", bg:"#fff7ed", roles:["최고관리자","관리팀장"],
    getValue:(_,__,cals)=>({value:cals?.length||0,unit:"팀"})},
];

const DEFAULT_DASH_CARDS = {
  "최고관리자": ["today_count","month_revenue","complaint","team_count"],
  "관리팀장":   ["today_count","tomorrow_count","complaint","team_count"],
  "영업팀장":   ["week_contract","month_revenue"],
  "현장팀장":   ["today_count","tomorrow_count","month_count"],
  "팀원":       ["today_count","tomorrow_count"],
};

function DashboardScreen() {
  const { visibleEvents, setCurrentScreen, cals, currentUser } = useC();
  const [editing, setEditing]   = useState(false);
  const [selectedIds, setSelectedIds] = useState(DEFAULT_DASH_CARDS[currentUser.role]||["today_count"]);

  const available = ALL_DASH_CARDS.filter(c=>c.roles.includes(currentUser.role)||currentUser.role==="최고관리자");
  const selected  = available.filter(c=>selectedIds.includes(c.id));

  const toggle = (id) => setSelectedIds(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={()=>setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-200">
              <ChevronLeft size={24} className="text-gray-700"/>
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {currentUser.role==="최고관리자"?"사장님 대시보드":"일정 요약"}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{currentUser.name} · {currentUser.role}</p>
            </div>
          </div>
          <button onClick={()=>setEditing(p=>!p)}
            className="text-sm font-bold px-4 py-2 rounded-full transition-all"
            style={{background:editing?"#111827":"#f3f4f6", color:editing?"white":"#374151"}}>
            {editing?"✅ 완료":"✏️ 편집"}
          </button>
        </div>
      </div>

      <div className="px-4 py-4 flex flex-col gap-4">
        {/* 편집 모드 */}
        {editing ? (
          <>
            <p className="text-sm text-gray-500 leading-relaxed">보여줄 카드를 선택하세요.</p>
            {available.map(card=>{
              const checked = selectedIds.includes(card.id);
              const {value,unit} = card.getValue(visibleEvents, currentUser, cals);
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
function NoticeScreen() {
  const { notices, setNotices, currentUser, setCurrentScreen } = useC();
  const [selected, setSelected]   = useState(null);
  const [writing, setWriting]     = useState(false);
  const [newTitle, setNewTitle]   = useState("");
  const [newBody, setNewBody]     = useState("");
  const [important, setImportant] = useState(false);
  const [readIds, setReadIds]     = useState(()=>JSON.parse(localStorage.getItem("readNotices")||"[]"));

  const isAdmin = currentUser.role === "최고관리자" || currentUser.team === "사장" || currentUser.team === "관리팀";

  const markRead = (id) => {
    if(readIds.includes(id)) return;
    const next = [...readIds, id];
    setReadIds(next);
    localStorage.setItem("readNotices", JSON.stringify(next));
  };

  const submitNotice = () => {
    if(!newTitle.trim()) return;
    const n = {id:uid(), title:newTitle, body:newBody, author:currentUser.name, date:fmt(new Date()), important};
    setNotices(p=>[n,...p]);
    setNewTitle(""); setNewBody(""); setImportant(false); setWriting(false);
  };

  const deleteNotice = (id) => { setNotices(p=>p.filter(n=>n.id!==id)); setSelected(null); };

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
          <div className="flex items-center gap-3">
            <button onClick={()=>setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
              <ChevronLeft size={24} className="text-gray-700"/>
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-900">팀 공지사항</h2>
              {unread>0 && <p className="text-xs text-blue-500 font-semibold mt-0.5">읽지 않은 공지 {unread}개</p>}
            </div>
          </div>
          {isAdmin && (
            <button onClick={()=>setWriting(true)}
              className="flex items-center gap-1 text-sm font-bold text-blue-600 px-4 py-2 rounded-full bg-blue-50">
              + 새 공지
            </button>
          )}
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
function ActivityLogScreen() {
  const { activityLogs, setCurrentScreen, cals, currentUser } = useC();
  const [filter, setFilter]     = useState("전체");
  const [calFilter, setCalFilter] = useState("전체");
  const FILTERS = ["전체","등록","수정","삭제"];

  const ACTION_STYLE = {
    "등록": {bg:"#f0fdf4", color:"#16a34a", icon:"✅"},
    "수정": {bg:"#eff6ff", color:"#1a56db", icon:"✏️"},
    "삭제": {bg:"#fef2f2", color:"#dc2626", icon:"🗑️"},
  };

  const filtered = activityLogs
    .filter(l=>filter==="전체"||l.action===filter)
    .filter(l=>calFilter==="전체"||l.calId===calFilter);

  // 날짜별 그룹
  const grouped = filtered.reduce((acc,log)=>{
    if(!acc[log.date]) acc[log.date]=[];
    acc[log.date].push(log);
    return acc;
  },{});
  const groupedDates = Object.keys(grouped).sort((a,b)=>b.localeCompare(a));

  const today = fmt(new Date());
  const yesterday = fmt(new Date(Date.now()-86400000));
  const dateLabel = (d) => d===today?"오늘":d===yesterday?"어제":d.slice(5).replace("-",".");

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={()=>setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-200">
              <ChevronLeft size={24} className="text-gray-700"/>
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-900">변경 로그</h2>
              <p className="text-xs text-gray-400 mt-0.5">전체 {activityLogs.length}건</p>
            </div>
          </div>
        </div>
        {/* 액션 필터 */}
        <div className="flex gap-2 pb-3 overflow-x-auto">
          {FILTERS.map(f=>{
            const s = f==="전체"?null:ACTION_STYLE[f];
            const active = filter===f;
            return (
              <button key={f} onClick={()=>setFilter(f)}
                className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all"
                style={{background:active?(s?s.color:"#111827"):"#f3f4f6",
                  color:active?"white":"#6b7280"}}>
                {f==="전체"?"전체":s.icon+" "+f}
              </button>
            );
          })}
        </div>
        {/* 팀 필터 */}
        <div className="flex gap-2 pb-3 overflow-x-auto">
          <button onClick={()=>setCalFilter("전체")}
            className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all"
            style={{background:calFilter==="전체"?"#111827":"#f3f4f6",
              color:calFilter==="전체"?"white":"#6b7280"}}>전체 팀</button>
          {cals?.map(cal=>(
            <button key={cal.id} onClick={()=>setCalFilter(calFilter===cal.id?"전체":cal.id)}
              className="shrink-0 text-xs font-bold px-3 py-1.5 rounded-full transition-all"
              style={{background:calFilter===cal.id?cal.color:"#f3f4f6",
                color:calFilter===cal.id?"white":"#6b7280"}}>{cal.name}</button>
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
                        textDecoration:log.action==="삭제"?"line-through":"none"}}>{log.title}</p>
                      <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
                        <span className="font-semibold text-gray-600">{log.user||"관리자"}</span>
                        <span>·</span><span>{log.time}</span>
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
function ExternalLinksScreen() {
  const { links, setLinks, setCurrentScreen } = useC();
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

  const EMOJIS    = ["🔗","📍","📞","💰","🧹","📋","🏢","🚗","📦","🛠️","🌐","📱","💬","📧","🗺️","📸"];
  const CATEGORIES = ["전체","업무","지도","연락처","기타"];

  const filtered = category==="전체" ? links : links.filter(l=>l.category===category);

  const handleAdd = () => {
    if(!newTitle.trim()||!newUrl.trim()) return;
    const url = newUrl.startsWith("http")?newUrl:`https://${newUrl}`;
    setLinks(p=>[...p,{id:uid(),title:newTitle,url,emoji:newEmoji,category:newCat}]);
    setNewTitle(""); setNewUrl(""); setNewEmoji("🔗"); setNewCat("업무"); setAdding(false);
  };

  const moveUp   = (id) => setLinks(p=>{const a=[...p],i=a.findIndex(l=>l.id===id);if(i<=0)return p;[a[i-1],a[i]]=[a[i],a[i-1]];return a;});
  const moveDown = (id) => setLinks(p=>{const a=[...p],i=a.findIndex(l=>l.id===id);if(i>=a.length-1)return p;[a[i],a[i+1]]=[a[i+1],a[i]];return a;});

  const reorder = (fromId,toId) => {
    if(!fromId||!toId||fromId===toId) return;
    setLinks(prev=>{
      const arr=[...prev];
      const fi=arr.findIndex(l=>l.id===fromId), ti=arr.findIndex(l=>l.id===toId);
      if(fi<0||ti<0) return prev;
      const [item]=arr.splice(fi,1); arr.splice(ti,0,item); return arr;
    });
  };

  const onDragStart=(id)=>{dragFrom.current=id;setDraggingId(id);};
  const onDragOver=(e,id)=>{e.preventDefault();dragTo.current=id;setDragOverId(id);};
  const onDragEnd=()=>{reorder(dragFrom.current,dragTo.current);dragFrom.current=null;dragTo.current=null;setDraggingId(null);setDragOverId(null);};

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button onClick={()=>setCurrentScreen("calendar")} className="p-2 -ml-2 rounded-full hover:bg-gray-200">
              <ChevronLeft size={24} className="text-gray-700"/>
            </button>
            <div>
              <h2 className="text-xl font-bold text-gray-900">외부 링크</h2>
              <p className="text-xs text-gray-400 mt-0.5">자주 쓰는 링크 모음</p>
            </div>
          </div>
          <div className="flex gap-2">
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
              <button onClick={()=>setLinks(p=>p.filter(x=>x.id!==l.id))}
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
function CompanySettingsModal() {
  const { companySettingsModal, setCompanySettingsModal, currentUser } = useC();
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (companySettingsModal) {
      setCompanyName(currentUser?.companyName || "");
      setLogoUrl(currentUser?.companyLogoUrl || "");
    }
  }, [companySettingsModal, currentUser]);

  if (!companySettingsModal) return null;

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setLogoUrl(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!companyName.trim()) return alert("회사명을 입력해주세요.");
    setLoading(true);
    try {
      await window.alert("저장되었습니다. 새로고침 시 적용됩니다!");
      // Firestore 문서 업데이트 로직은 실제 DB 연동 필요하므로 여기서는 시뮬레이션
      // (기존 currentUser가 최상단 App 컴포넌트에서 관리되므로, 여기서는 새로고침 권장)
      const { doc, updateDoc } = await import("firebase/firestore");
      await updateDoc(doc(db, "companies", currentUser.companyId), {
        name: companyName,
        logoUrl: logoUrl
      });
      window.location.reload();
    } catch (e) {
      console.error(e);
      alert("오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden flex flex-col shadow-2xl">
        <div className="px-5 py-4 flex items-center justify-between border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">회사 정보 설정</h2>
          <button onClick={() => setCompanySettingsModal(false)} className="p-1 rounded-full hover:bg-gray-100">
            <X size={20} className="text-gray-500" />
          </button>
        </div>
        <div className="p-5 flex flex-col items-center">
          <label className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-xl overflow-hidden cursor-pointer bg-gray-100 border-2 border-dashed border-gray-300 hover:border-blue-500 transition-colors"
            style={{background: logoUrl ? "#fff" : "linear-gradient(135deg,#1a56db,#2563eb)"}}>
            {logoUrl ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover" /> : "🏢"}
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
          </label>
          <p className="text-xs text-gray-400 -mt-4 mb-4 text-center">로고 이미지를 클릭하여 변경 (선택)</p>
          
          <div className="w-full mb-6">
            <label className="block text-xs font-bold text-gray-500 mb-1">회사명</label>
            <input value={companyName} onChange={e=>setCompanyName(e.target.value)}
              className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm font-bold outline-none focus:border-blue-500" />
          </div>
          
          <button onClick={handleSave} disabled={loading || !companyName.trim()}
            className="w-full py-4 rounded-xl text-white font-bold transition-opacity"
            style={{background:companyName.trim()?"linear-gradient(135deg,#1a56db,#2563eb)":"#e5e7eb", opacity: loading ? 0.7 : 1}}>
            {loading ? "저장 중..." : "저장하고 새로고침"}
          </button>
        </div>
      </div>
    </div>
  );
}

