/**
 * 클린메니져 — 네이버 캘린더 완전 재현
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

import { db, functions, storage } from "./firebase";
import { enablePush, listenForeground } from "./fcm";
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, onSnapshot, query, where, orderBy, deleteDoc, serverTimestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { httpsCallable } from "firebase/functions";

// ── 캘린더 목록 ───────────────────────────────────────────────
// 신규 업체 가입 시 기본으로 깔리는 캘린더(=담당팀별 색상). 가입 시 Firestore에도 시드된다.
const DEFAULT_CALS = [
  { id: "clean0", label: "관리팀",     name: "관리팀",     color: "#1a56db", checked: true, isField: false },
  { id: "clean1", label: "영업팀",     name: "영업팀",     color: "#16a34a", checked: true, isField: false },
  { id: "clean2", label: "입주청소팀", name: "입주청소팀", color: "#ea580c", checked: true, isField: true  },
];
// 모듈 전역에서 calById/색상 조회에 쓰는 "현재 캘린더" 미러.
// Provider가 Firestore cals 스냅샷을 받을 때마다 내용물을 교체(splice)해서 항상 최신값을 유지한다.
// (const 참조는 그대로 두고 배열 내용만 갈아끼워야 기존 calById/CALS.find 호출부가 전부 동작함)
const CALS = [...DEFAULT_CALS];

// ── 직원 관리 ───────────────────────────────────────────────
const INIT_TEAMS = ["사장", "관리팀", "영업팀", "입주청소팀"];
const ROLES = ["최고관리자", "팀장", "팀원"];
const INIT_USERS = [];

// ── 제목 규칙 기본값 ──────────────────────────────────────────────
const DEFAULT_TITLE_RULE = ["time", "district", "area"];
const DEFAULT_TYPE_KEYWORDS = ["입주청소", "정기청소", "에어컨청소", "특수청소", "줄눈청소"];
const TITLE_TOKEN_LABELS = {
  time:         { label:"시간대",    desc:"오전/오후/종일" },
  district:     { label:"지역",      desc:"구·동·로·길" },
  area:         { label:"평수/방",   desc:"15평, 원룸 등" },
  type:         { label:"청소종류",  desc:"입주청소 등 키워드" },
  contact_name: { label:"담당자명",  desc:"고객 이름" },
  phone_last4:  { label:"번호4자리", desc:"전화번호 끝 4자리" },
};

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
const addMonths = (s,n)=>{ const d=pd(s); d.setMonth(d.getMonth()+n); return fmt(d); };
const calById = id => CALS.find(c=>c.id===id) || { id:"unassigned", label:"미배정", name:"미배정", color:"#9ca3af", checked:true };

// ── 전화번호 정규화/표시 ───────────────────────────────────────────
// 저장은 숫자만(canonical), 화면 표시는 하이픈 포맷으로.
const onlyDigits = s => (s || "").replace(/\D/g, "");
const fmtPhone = s => {
  const d = onlyDigits(s);
  if (d.length === 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  return s || "";
};

// ── 반복 일정 전개 ────────────────────────────────────────────────
// repeat(daily/weekly/monthly) 일정을 repeatUntil(없으면 6개월) 까지 개별 일정으로 펼친다.
// 각 인스턴스는 원본 id 를 그대로 유지(상세/수정/삭제는 시리즈 단위로 동작).
function expandRecurring(events) {
  const HARD_CAP = 400; // 안전장치 (무한 루프 방지)
  const now = new Date();
  const defaultUntil = fmt(new Date(now.getFullYear(), now.getMonth() + 6, now.getDate()));
  const out = [];
  for (const ev of events) {
    if (!ev.repeat || ev.repeat === "none") { out.push(ev); continue; }
    const dur   = diff(ev.start, ev.end || ev.start); // 일정 길이(일)
    const until = ev.repeatUntil || defaultUntil;
    let cur = ev.start, count = 0;
    while (cur <= until && count < HARD_CAP) {
      out.push({ ...ev, start: cur, end: add(cur, dur), _recurring: true });
      count++;
      if      (ev.repeat === "daily")   cur = add(cur, 1);
      else if (ev.repeat === "weekly")  cur = add(cur, 7);
      else if (ev.repeat === "monthly") cur = addMonths(cur, 1);
      else break;
    }
  }
  return out;
}

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
function parseEventText(text, titleRule = DEFAULT_TITLE_RULE, typeKeywords = DEFAULT_TYPE_KEYWORDS) {
  const result = {
    title:"", start:"", end:"", allDay:false,
    startTime:"09:00", endTime:"10:00",
    place:"", description:text.trim(), url:"", calId:"", repeat:"none",
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

  // 제목 자동 생성 — titleRule 토큰 순서대로 조합
  const roomMatch = text.match(/([가-힣]*방\s*\d+개|원룸|투룸|쓰리룸|포룸|\d+평)/);
  const districtMatch = result.place ? result.place.match(/([가-힣]+(구|동|로|길))/) : null;
  const typeMatch = typeKeywords.map(k => text.includes(k) ? k : null).find(Boolean);

  const tokenValues = {
    time:         hasAllDay ? "종일" : hasAM ? "오전" : hasPM ? "오후" : "",
    district:     districtMatch ? districtMatch[1] : "",
    area:         roomMatch ? roomMatch[1] : "",
    type:         typeMatch || "",
    contact_name: phones.length > 0 && phones[0].name ? phones[0].name : "",
    phone_last4:  phones.length > 0 ? phones[0].phone.replace(/[^0-9]/g,"").slice(-4) : "",
  };

  result.title = (titleRule || DEFAULT_TITLE_RULE)
    .map(token => tokenValues[token] || "")
    .filter(Boolean)
    .join(" ");

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
  return [];
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
  const [cals, setCals] = useState(DEFAULT_CALS); // 기본 캘린더 목록 (Firestore 로드 전 fallback)
  const [teams, setTeams] = useState(INIT_TEAMS);
  const [users, setUsers] = useState(INIT_USERS);
  const [activityLogs, setActivityLogs] = useState([]);
  const [notices, setNotices] = useState([]);
  const [links, setLinks] = useState([]);
  const [linkCategories, setLinkCategories] = useState(["업무", "지도", "연락처", "기타"]);
  const [titleRule, setTitleRule]       = useState(DEFAULT_TITLE_RULE);
  const [typeKeywords, setTypeKeywords] = useState(DEFAULT_TYPE_KEYWORDS);
  const [reports, setReports] = useState([]);

  // 모듈 전역 CALS 미러를 항상 최신 cals로 유지 (calById/CALS.find 호출부가 전부 이걸 본다)
  useEffect(() => { CALS.splice(0, CALS.length, ...cals); }, [cals]);

  useEffect(() => {
    const unsubEvents = onSnapshot(collection(companyRef, "events"), snap => {
      setEvents(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubUsers = onSnapshot(collection(companyRef, "users"), snap => {
      if(!snap.empty) setUsers(snap.docs.filter(d => d.data().status !== "deleted").map(d => ({ ...d.data(), id: d.id })));
    });
    // 팀 목록 + 링크 카테고리는 단일 설정 문서(meta/config)에 배열로 저장 (순서 보존)
    const unsubConfig = onSnapshot(doc(companyRef, "meta", "config"), snap => {
      const data = snap.data();
      if (data?.teams)          setTeams(data.teams);
      if (data?.linkCategories) setLinkCategories(data.linkCategories);
      if (data?.titleRule)      setTitleRule(data.titleRule);
      if (data?.typeKeywords)   setTypeKeywords(data.typeKeywords);
    });
    const unsubLogs = onSnapshot(query(collection(companyRef, "activityLogs"), orderBy("time", "desc")), snap => {
      setActivityLogs(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubNotices = onSnapshot(collection(companyRef, "notices"), snap => {
      // 최신순 정렬 (date 내림차순)
      setNotices(snap.docs.map(d => ({ ...d.data(), id: d.id }))
        .sort((a,b) => (b.date||"").localeCompare(a.date||"")));
    });
    const unsubLinks = onSnapshot(collection(companyRef, "links"), snap => {
      setLinks(snap.docs.map(d => ({ ...d.data(), id: d.id }))
        .sort((a,b) => (a.order ?? 0) - (b.order ?? 0)));
    });
    const unsubCals = onSnapshot(collection(companyRef, "cals"), snap => {
      if (!snap.empty) setCals(snap.docs.filter(d => d.data().status !== "deleted").map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubReports = onSnapshot(collection(companyRef, "reports"), snap => {
      setReports(snap.docs.map(d => ({ ...d.data(), id: d.id }))
        .sort((a,b) => (b.date||"").localeCompare(a.date||"")));
    });

    return () => {
      unsubEvents(); unsubUsers(); unsubConfig(); unsubLogs(); unsubNotices(); unsubLinks(); unsubCals(); unsubReports();
    };
  }, [loginUser.companyId]);

  // ── 공지 CRUD (Firestore 영속) ──
  const addNotice = useCallback(n => {
    const ref = doc(collection(companyRef, "notices"));
    setDoc(ref, { ...n, id: ref.id });
  }, [companyRef]);
  const deleteNotice = useCallback(id => {
    deleteDoc(doc(companyRef, "notices", id));
  }, [companyRef]);

  // ── 링크 CRUD (Firestore 영속, order 필드로 순서 유지) ──
  const addLink = useCallback(l => {
    const ref = doc(collection(companyRef, "links"));
    setDoc(ref, { ...l, id: ref.id, order: links.length });
  }, [companyRef, links.length]);
  const deleteLink = useCallback(id => {
    deleteDoc(doc(companyRef, "links", id));
  }, [companyRef]);
  // 순서 변경: 새 배열을 받아 order를 다시 매겨 전부 저장
  const persistLinkOrder = useCallback(arr => {
    arr.forEach((l, i) => setDoc(doc(companyRef, "links", l.id), { ...l, order: i }, { merge: true }));
  }, [companyRef]);
  const updateLink = useCallback(l => {
    setDoc(doc(companyRef, "links", l.id), l, { merge: true });
  }, [companyRef]);

  // ── 팀 목록 / 링크 카테고리 (meta/config 단일 문서) ──
  const saveTeams = useCallback(arr => {
    setTeams(arr); // 즉시 반영 (스냅샷이 확정)
    setDoc(doc(companyRef, "meta", "config"), { teams: arr }, { merge: true });
  }, [companyRef]);
  const saveLinkCategories = useCallback(arr => {
    setLinkCategories(arr);
    setDoc(doc(companyRef, "meta", "config"), { linkCategories: arr }, { merge: true });
  }, [companyRef]);
  const saveTitleRule = useCallback((rule, keywords) => {
    setTitleRule(rule);
    if (keywords !== undefined) setTypeKeywords(keywords);
    setDoc(doc(companyRef, "meta", "config"), {
      titleRule: rule,
      ...(keywords !== undefined ? { typeKeywords: keywords } : {}),
    }, { merge: true });
  }, [companyRef]);

  // ── 완료 보고 저장 (Firestore) ──
  const addReport = useCallback(r => {
    const ref = doc(collection(companyRef, "reports"));
    setDoc(ref, { ...r, id: ref.id });
  }, [companyRef]);

  const addLog = useCallback((action, detail) => {
    const newLogRef = doc(collection(companyRef, "activityLogs"));
    const now = new Date();
    setDoc(newLogRef, {
      time: now.toISOString(),
      date: fmt(now),
      user: loginUser?.name || "관리자",
      action,
      detail,
    });
  }, [loginUser, companyRef]);

  const addEvent = useCallback(ev => {
    const { _id, ...evData } = ev;
    const evRef = _id ? doc(companyRef, "events", _id) : doc(collection(companyRef, "events"));
    setDoc(evRef, evData);
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

  const updateCal = useCallback(updated => {
    // 함수형 업데이트로 stale closure 방지, 새 cal이면 추가
    setCals(prev => {
      const exists = prev.some(c => c.id === updated.id);
      return exists
        ? prev.map(c => c.id === updated.id ? {...c, ...updated} : c)
        : [...prev, updated];
    });
    setDoc(doc(companyRef, "cals", updated.id), updated);
  }, [companyRef]);

  const deleteCal = useCallback(calId => {
    setCals(prev => prev.filter(c => c.id !== calId));
    deleteDoc(doc(companyRef, "cals", calId));
  }, [companyRef]);

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

  const [currentUser, setCurrentUser] = useState(loginUser);
  useEffect(() => { setCurrentUser(loginUser); }, [loginUser]);

  const openModal   = useCallback((date=null,editId=null)=>setModal({open:true,date,editId}),[]);
  const closeModal  = useCallback(()=>setModal({open:false,date:null,editId:null}),[]);

  const checkedIds     = useMemo(()=>new Set(cals.filter(c=>c.checked).map(c=>c.id)),[cals]);
  const visibleEvents  = useMemo(()=>{
    // calId가 없거나 "unassigned"인 미배정 일정도 항상 표시
    let evs = events.filter(e=>checkedIds.has(e.calId) || !e.calId || e.calId==="unassigned");
    if (!["관리팀", "영업팀"].includes(currentUser.team) && currentUser.role !== "최고관리자") {
      // cals를 직접 사용해 정확히 매칭 (CALS 전역 배열 stale 문제 방지)
      const myCal = cals.find(c => c.label === currentUser.team);
      if (myCal) {
        evs = evs.filter(e => e.calId === myCal.id);
      }
      // 매칭 cal이 없으면 전체 표시 (팀에 대응하는 캘린더가 없는 경우)
    }
    return expandRecurring(evs);
  }, [events, checkedIds, cals, currentUser.team, currentUser.role]);

  return (
    <Ctx.Provider value={{
      events,visibleEvents,addEvent,updateEvent,deleteEvent,
      fieldReportEv,setFieldReportEv,
      cals,toggleCal,updateCal,deleteCal,
      modal,openModal,closeModal,
      current,setCurrent,
      selDate,setSelDate,
      detEv,setDetEv,
      drawer,setDrawer,
      searchOpen,setSearchOpen,
      searchQuery,setSearchQuery,
      sheetMode,setSheetMode,
      teams,setTeams,saveTeams,teamModal,setTeamModal,
      users,setUsers,
      currentUser,setCurrentUser,loginUser,onLogout,
      currentScreen,setCurrentScreen,
      empModal,setEmpModal,
      companySettingsModal,setCompanySettingsModal,
      activityLogs,setActivityLogs,
      notices,setNotices,addNotice,deleteNotice,
      links,setLinks,addLink,deleteLink,updateLink,persistLinkOrder,
      linkCategories,saveLinkCategories,
      titleRule,typeKeywords,saveTitleRule,
      reports,addReport,
      companyId: loginUser.companyId
    }}>
      {children}
    </Ctx.Provider>
  );
}

// ── 데모 모드 ─────────────────────────────────────────────────────
const DEMO_USER = {
  uid: "demo", id: "demo", name: "홍길동", companyId: "demo",
  companyName: "크린드림 (데모)", role: "최고관리자", team: "사장",
};
const today = fmt(new Date());
const d = (offset) => { const dt = new Date(); dt.setDate(dt.getDate()+offset); return fmt(dt); };
const DEMO_EVENTS = [
  { id:"de1", title:"오전 역촌동 입주청소 25평", start:today, end:today, startTime:"09:00", endTime:"12:00", allDay:false, calId:"team1", place:"서울 은평구 역촌동 51-43", contact:"김민수 010-1234-5678", description:"비밀번호 1234#", team:"입주청소팀" },
  { id:"de2", title:"오후 상암동 정기청소", start:today, end:today, startTime:"14:00", endTime:"16:00", allDay:false, calId:"team2", place:"서울 마포구 상암동 115", contact:"이영희 010-9876-5432", description:"", team:"정기청소팀" },
  { id:"de3", title:"오전 불광동 에어컨청소", start:d(1), end:d(1), startTime:"10:00", endTime:"12:00", allDay:false, calId:"team3", place:"서울 은평구 불광동 22-5", contact:"박철수 010-5555-6666", description:"에어컨 3대", team:"에어컨청소팀" },
  { id:"de4", title:"오후 응암동 입주청소 33평", start:d(1), end:d(1), startTime:"13:00", endTime:"17:00", allDay:false, calId:"team1", place:"서울 은평구 응암동 88-1", contact:"최수진 010-7777-8888", description:"", team:"입주청소팀" },
  { id:"de5", title:"종일 강서구 정기청소", start:d(2), end:d(2), startTime:"09:00", endTime:"18:00", allDay:false, calId:"team2", place:"서울 강서구 화곡동 101", contact:"정민호 010-2222-3333", description:"매월 2회 정기", team:"정기청소팀" },
  { id:"de6", title:"오전 은평구 특수청소", start:d(-1), end:d(-1), startTime:"09:00", endTime:"13:00", allDay:false, calId:"team1", place:"서울 은평구 신사동 33", contact:"강지수 010-4444-9999", description:"", team:"입주청소팀" },
  { id:"de7", title:"팀장 미팅", start:d(3), end:d(3), startTime:"10:00", endTime:"11:00", allDay:false, calId:"personal", place:"사무실", contact:"", description:"월간 업무 회의", team:"관리팀" },
];
const DEMO_USERS = [
  { id:"du1", name:"홍길동", phone:"010-0000-0001", team:"사장",      role:"최고관리자" },
  { id:"du2", name:"김민준", phone:"010-1111-0001", team:"관리팀",    role:"팀장" },
  { id:"du3", name:"이서연", phone:"010-2222-0001", team:"입주청소팀",role:"팀장" },
  { id:"du4", name:"박지훈", phone:"010-3333-0001", team:"입주청소팀",role:"팀원" },
  { id:"du5", name:"최예린", phone:"010-4444-0001", team:"정기청소팀",role:"팀장" },
  { id:"du6", name:"정승현", phone:"010-5555-0001", team:"에어컨청소팀",role:"팀장" },
];
const DEMO_TEAMS = ["사장","관리팀","영업팀","입주청소팀","정기청소팀","에어컨청소팀"];
const DEMO_NOTICES = [
  { id:"dn1", title:"7월 하계 휴가 안내", content:"7월 28일(월)~8월 1일(금) 하계 휴가입니다. 현장 일정 미리 조율해주세요.", createdAt:d(-3), author:"홍길동" },
  { id:"dn2", title:"청소 용품 재고 확인 요청", content:"스팀청소기 2대 수리 완료. 창고 재고 수량 확인 후 팀장님들 보고 부탁드립니다.", createdAt:d(-7), author:"김민준" },
];
const DEMO_LOGS = [
  { id:"dl1", time:new Date(Date.now()-1000*60*10).toISOString(), user:{name:"홍길동"}, action:"등록", detail:"'오전 역촌동 입주청소 25평' 일정을 등록했습니다." },
  { id:"dl2", time:new Date(Date.now()-1000*60*60).toISOString(), user:{name:"이서연"}, action:"수정", detail:"'오후 상암동 정기청소' 일정을 수정했습니다." },
  { id:"dl3", time:new Date(Date.now()-1000*60*60*3).toISOString(), user:{name:"김민준"}, action:"등록", detail:"'팀장 미팅' 일정을 등록했습니다." },
];
const DEMO_LINKS = [
  { id:"dlink1", label:"네이버 지도", url:"https://map.naver.com", icon:"🗺️", category:"지도", order:0 },
  { id:"dlink2", label:"카카오맵",   url:"https://map.kakao.com", icon:"🗺️", category:"지도", order:1 },
  { id:"dlink3", label:"국세청 홈택스", url:"https://hometax.go.kr", icon:"🏛️", category:"업무", order:2 },
];
const DEMO_CALS = [
  { id:"team1",    label:"입주청소팀",   name:"입주청소팀",   color:"#1a56db", checked:true },
  { id:"team2",    label:"정기청소팀",   name:"정기청소팀",   color:"#16a34a", checked:true },
  { id:"team3",    label:"에어컨청소팀", name:"에어컨청소팀", color:"#ea580c", checked:true },
  { id:"personal", label:"개인",         name:"개인",         color:"#9333ea", checked:true },
  { id:"unassigned",label:"미배정",      name:"미배정",       color:"#9ca3af", checked:true },
];

function DemoProvider({ children }) {
  const noop = () => {};
  const demoAlert = () => alert("데모 모드에서는 변경할 수 없습니다.");
  const [currentScreen, setCurrentScreen] = useState("calendar");
  const [modal, setModal] = useState({open:false,date:null,editId:null});
  const [sheetMode, setSheetMode] = useState(1);
  const [drawer, setDrawer] = useState(false);
  const [selDate, setSelDate] = useState(today);
  const [current, setCurrent] = useState(new Date());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [detailSheet, setDetailSheet] = useState(null);
  const [empModal, setEmpModal] = useState({open:false,editId:null});
  const [teamModal, setTeamModal] = useState(false);
  const [companySettingsModal, setCompanySettingsModal] = useState(false);
  const [fieldReportEv, setFieldReportEv] = useState(null);
  const [titleRule] = useState(["time","district","area"]);
  const [typeKeywords] = useState(["입주청소","정기청소","에어컨청소","특수청소","줄눈청소"]);
  const [linkCategories] = useState(["업무","지도","연락처","기타"]);
  const openModal  = (date=null,editId=null) => setModal({open:true,date,editId});
  const closeModal = () => setModal({open:false,date:null,editId:null});
  const visibleEvents = DEMO_EVENTS.filter(e => DEMO_CALS.filter(c=>c.checked).map(c=>c.id).includes(e.calId));
  return (
    <Ctx.Provider value={{
      isDemo: true,
      events: DEMO_EVENTS, visibleEvents,
      cals: DEMO_CALS, toggleCal: noop, updateCal: noop,
      users: DEMO_USERS, setUsers: noop,
      teams: DEMO_TEAMS, setTeams: noop, saveTeams: noop,
      activityLogs: DEMO_LOGS, setActivityLogs: noop,
      notices: DEMO_NOTICES,
      links: DEMO_LINKS, addLink: noop, deleteLink: noop, updateLink: noop, persistLinkOrder: noop,
      linkCategories, saveLinkCategories: noop,
      reports: [],
      currentUser: DEMO_USER, setCurrentUser: noop,
      loginUser: DEMO_USER, onLogout: noop,
      titleRule, typeKeywords, saveTitleRule: noop,
      addEvent: demoAlert, updateEvent: demoAlert, deleteEvent: demoAlert,
      addNotice: demoAlert, updateNotice: demoAlert, deleteNotice: demoAlert,
      addLog: noop, addReport: demoAlert,
      modal, openModal, closeModal,
      current, setCurrent,
      selDate, setSelDate,
      sheetMode, setSheetMode,
      drawer, setDrawer,
      searchOpen, setSearchOpen,
      searchQuery, setSearchQuery,
      detailSheet, setDetailSheet,
      empModal, setEmpModal,
      teamModal, setTeamModal,
      companySettingsModal, setCompanySettingsModal,
      fieldReportEv, setFieldReportEv,
      companyId: "demo",
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
  const { visibleEvents, setDetEv, setSelDate, setCurrent, setSheetMode, openModal, currentUser, cals } = useC();
  const calByIdLocal = id => cals.find(c=>c.id===id) || { id:"unassigned", label:"미배정", name:"미배정", color:"#9ca3af", checked:true };
  const canAdd = currentUser.role !== "팀원";
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
              onClick={()=>currentUser.role==="팀원"?setDetEv(ev):openModal(null,ev.id)}
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
              const c=calByIdLocal(ev.calId);
              return(
                <div key={ev.id} onClick={()=>currentUser.role==="팀원"?setDetEv(ev):openModal(null,ev.id)}
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
                      <p className="text-sm font-semibold text-gray-900 leading-snug">{ev.title}</p>
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
    setDetEv, drawer,
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
  const { detEv, setDetEv, deleteEvent, openModal, setFieldReportEv, currentUser, cals } = useC();
  const [vis,setVis]=useState(false);
  useEffect(()=>{ if(detEv)setTimeout(()=>setVis(true),10); else setVis(false); },[detEv]);
  if(!detEv) return null;
  const cal = cals.find(c=>c.id===detEv.calId) || { id:"unassigned", label:"미배정", name:"미배정", color:"#9ca3af" };
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
            {currentUser.role !== "팀원" && <>
              <button onClick={()=>{close();setTimeout(()=>openModal(null,detEv.id),300);}}
                className="p-2 rounded-full hover:bg-gray-100"><Edit3 size={19} className="text-gray-600"/></button>
              <button onClick={()=>{ if(window.confirm("이 일정을 삭제하시겠습니까?")){ deleteEvent(detEv.id); close(); } }}
                className="p-2 rounded-full hover:bg-gray-100"><Trash2 size={19} className="text-gray-600"/></button>
            </>}
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
          {/* 첨부사진 */}
          {(detEv.photos||[]).length > 0 && (
            <div className="px-5 py-5 border-t border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[15px] font-semibold text-gray-800">📎 첨부 파일 {(detEv.photos||[]).length}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {(detEv.photos||[]).map((p,i)=>(
                  <a key={i} href={p.url} target="_blank" rel="noopener noreferrer"
                    className="w-[calc(25%-6px)] aspect-square rounded-xl overflow-hidden bg-gray-100 block">
                    <img src={p.url} alt="" className="w-full h-full object-cover"/>
                  </a>
                ))}
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



// ── 길게 누르기 메뉴 ───────────────────────────────────────────────
function LongPressMenu({ ev, onClose, onEdit, onDelete }) {
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
function DeleteConfirmPopup({ ev, onCancel, onConfirm }) {
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
function BottomTabBar() {
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
function SideDrawer() {
  const { drawer, setDrawer, cals, toggleCal, currentUser, setCurrentUser, loginUser, setCurrentScreen, users, notices, setCompanySettingsModal, onLogout, companyId } = useC();
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
              {currentUser.role === "최고관리자" && (
                <button onClick={() => { setDrawer(false); setCompanySettingsModal(true); }} className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-800 rounded-full hover:bg-gray-100 transition-colors">
                  <Settings size={20} />
                </button>
              )}
              <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center text-xl border border-blue-100">🏠</div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-bold text-base">{currentUser.name}</p>
                  {currentUser.role !== "최고관리자" && (
                    <button onClick={() => { setPwModal(true); }}
                      className="text-[10px] text-gray-400 border border-gray-200 px-1.5 py-0.5 rounded-full hover:text-blue-500 hover:border-blue-300 transition-colors">
                      비밀번호
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500">{currentUser.team} · {currentUser.role}</p>
              </div>
            </div>
            {/* 테스트용 계정 전환 — 크린드림 사장 계정만 노출 */}
            {currentUser.role === "최고관리자" && currentUser.team === "사장" && currentUser.companyName === "크린드림" && (
              <select className="text-[10px] border border-gray-200 text-gray-500 p-1 rounded outline-none" onChange={e => setCurrentUser([loginUser, ...users].find(u=>u.id===e.target.value))} value={currentUser.id}>
                {[loginUser, ...users.filter(u=>u.id!==loginUser.id)].map(u => <option key={u.id} value={u.id}>{u.name} ({u.team})</option>)}
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
          {(currentUser.team === "관리팀" || currentUser.team === "사장") && (
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
            {(() => {
              const readIds = JSON.parse(localStorage.getItem("readNotices")||"[]");
              const unread = notices.filter(n=>!readIds.includes(n.id)).length;
              return unread > 0
                ? <span className="text-xs font-bold text-white bg-red-500 rounded-full w-5 h-5 flex items-center justify-center shrink-0">{unread}</span>
                : null;
            })()}
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

          {/* 설정 가이드 / FAQ */}
          <button
            onClick={() => { setCurrentScreen("faq"); setDrawer(false); }}
            className="w-full flex items-center gap-3 px-5 py-3 hover:bg-white active:bg-gray-100 transition-colors">
            <span className="text-lg">❓</span>
            <span className="text-sm font-medium text-gray-700 flex-1 text-left">설정 가이드 · FAQ</span>
          </button>

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

// ── 일정 추가 모달 ────────────────────────────────────────────────
const blank=date=>({title:"",description:"",contact:"",team:"",start:date||fmt(new Date()),end:date||fmt(new Date()),allDay:false,startTime:"09:00",endTime:"10:00",place:"",url:"",calId:"",repeat:"none",repeatUntil:"",photos:[]});

// ── 드럼롤 휠 피커 ────────────────────────────────────────────────
function WheelPicker({ items, value, onChange, renderItem, loop=false }) {
  const ITEM_H = 44;
  const L = items.length;
  const REPEAT = loop ? 9 : 1;          // 순환용 복제 횟수 (홀수)
  const CENTER = Math.floor(REPEAT / 2); // 가운데 블록 인덱스
  const centerOffset = loop ? CENTER * L : 0;
  const ref = useRef(null);
  const timer = useRef(null);
  const scrolling = useRef(false);
  const dragY = useRef(null);
  const display = renderItem || (v => String(v));

  // 순환 모드면 items를 REPEAT번 복제
  const rendered = loop
    ? Array.from({ length: REPEAT * L }, (_, i) => items[i % L])
    : items;

  const idxOf = () => { const i = items.indexOf(value); return i >= 0 ? i : 0; };
  const posFor = vIdx => (centerOffset + vIdx) * ITEM_H;

  // 가운데(선택)에 위치한 렌더 행 인덱스 — 굵게 표시용
  const [centerRow, setCenterRow] = useState(centerOffset + idxOf());
  // 마지막으로 확정한 렌더 행 (delta 계산용)
  const lastRow = useRef(centerOffset + idxOf());

  const onMouseDown = e => {
    dragY.current = e.clientY;
    const onMove = ev => {
      if (dragY.current === null) return;
      const dy = dragY.current - ev.clientY;
      dragY.current = ev.clientY;
      if (ref.current) ref.current.scrollTop += dy;
    };
    const onUp = () => {
      dragY.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // items 변경 시 위치 초기화 (가운데 블록)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTop = posFor(idxOf());
    setCenterRow(centerOffset + idxOf());
    lastRow.current = centerOffset + idxOf();
  }, [items]);

  // 외부 value 변경 시 위치 동기화 (스크롤 중이 아닐 때만)
  useEffect(() => {
    if (scrolling.current) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = posFor(idxOf());
    setCenterRow(centerOffset + idxOf());
    lastRow.current = centerOffset + idxOf();
  }, [value]);

  const handleScroll = () => {
    scrolling.current = true;
    // 실시간으로 가운데 행 추적 (굵게 표시)
    const el = ref.current;
    if (el) {
      const ci = Math.round(el.scrollTop / ITEM_H);
      if (ci !== centerRow) setCenterRow(ci);
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const el2 = ref.current;
      if (!el2) { scrolling.current = false; return; }
      const rawIdx = Math.round(el2.scrollTop / ITEM_H);
      const vIdx = loop ? ((rawIdx % L) + L) % L : Math.max(0, Math.min(L - 1, rawIdx));
      const newVal = items[vIdx];
      const delta = rawIdx - lastRow.current; // 움직인 칸 수 (부호 포함)
      // 가운데 블록으로 재중앙화 (같은 값이 보이므로 시각적 점프 없음)
      el2.scrollTop = posFor(vIdx);
      setCenterRow(centerOffset + vIdx);
      lastRow.current = centerOffset + vIdx;
      scrolling.current = false;
      if (delta !== 0) onChange(newVal, delta);
    }, 120);
  };

  return (
    <div className="relative flex-1 overflow-hidden select-none" style={{ height: ITEM_H * 5 }}>
      {/* 선택 영역 하이라이트 — 텍스트 뒤에 */}
      <div className="absolute left-1 right-1 rounded-xl bg-gray-100 pointer-events-none"
        style={{ top: ITEM_H * 2, height: ITEM_H, zIndex: 1 }} />
      {/* 스크롤 내용 */}
      <div ref={ref} onScroll={handleScroll}
        onWheel={e => { e.preventDefault(); if(ref.current) ref.current.scrollTop += e.deltaY; }}
        onMouseDown={onMouseDown}
        className="h-full overflow-y-scroll cursor-grab active:cursor-grabbing"
        style={{ scrollSnapType: "y mandatory", scrollbarWidth: "none", position: "relative", zIndex: 2 }}>
        <div style={{ height: ITEM_H * 2 }} />
        {rendered.map((item, i) => {
          const sel = i === centerRow;
          return (
            <div key={i} style={{ height: ITEM_H, scrollSnapAlign: "center",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: sel ? 17 : 15, fontWeight: sel ? 700 : 400,
              color: sel ? "#111827" : "#9ca3af" }}>
              {display(item)}
            </div>
          );
        })}
        <div style={{ height: ITEM_H * 2 }} />
      </div>
      {/* 상하 페이드 */}
      <div className="absolute inset-0 pointer-events-none"
        style={{ background: "linear-gradient(to bottom,white 0%,transparent 30%,transparent 70%,white 100%)", zIndex: 3 }} />
    </div>
  );
}

// ── 날짜/시간 피커 (네이버 앱 스타일 — 인라인 드럼롤) ──────────────
function DateTimePicker({ form, set, errs }) {
  const [activePicker, setActivePicker] = useState(null); // null | "start" | "end"

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
    if (!s) return "--";
    const d = pd(s); if (!d) return "--";
    const yy = String(d.getFullYear()).slice(2);
    return `${yy}. ${d.getMonth()+1}. ${d.getDate()}.(${WD[d.getDay()]})`;
  };

  return (
    <div className="border-b border-gray-100">
      {/* 종일 토글 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <Clock size={18} className="text-gray-400"/>
          <span className="text-sm text-gray-700">종일</span>
        </div>
        <button onClick={()=>set("allDay",!form.allDay)}
          className={`relative w-12 h-6 rounded-full transition-colors duration-200 ${form.allDay?"bg-blue-600":"bg-gray-200"}`}>
          <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.allDay?"translate-x-6":"translate-x-0"}`}/>
        </button>
      </div>

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
              renderItem={v=>`${v}일 ${WD[new Date(pYear,pMonth-1,v).getDay()]}`} loop/>
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

// ── 반복 종료일 피커 (드럼롤) ──────────────────────────────────────
function RepeatUntilPicker({ form, set }) {
  const [open, setOpen] = useState(false);
  const WD = ["일","월","화","수","목","금","토"];

  const parseRepeat = () => {
    const d = form.repeatUntil ? pd(form.repeatUntil) : new Date();
    return { year: d.getFullYear(), month: d.getMonth()+1, day: d.getDate() };
  };
  const init = parseRepeat();
  const [pYear, setPYear]   = useState(init.year);
  const [pMonth, setPMonth] = useState(init.month);
  const [pDay, setPDay]     = useState(init.day);
  const ps = useRef(init);

  const applyDate = (y, mo, d) => {
    const safeDay = Math.min(d, new Date(y, mo, 0).getDate());
    set("repeatUntil", `${y}-${String(mo).padStart(2,"0")}-${String(safeDay).padStart(2,"0")}`);
  };
  const chYear  = v => { ps.current.year=v;  setPYear(v);  applyDate(v, ps.current.month, ps.current.day); };
  const chMonth = v => { ps.current.month=v; setPMonth(v); applyDate(ps.current.year, v, ps.current.day); };
  const chDay   = v => { ps.current.day=v;   setPDay(v);   applyDate(ps.current.year, ps.current.month, v); };

  const daysInMonth = new Date(pYear, pMonth, 0).getDate();
  const years  = Array.from({length:8},(_,i)=>2023+i);
  const months = Array.from({length:12},(_,i)=>i+1);
  const days   = Array.from({length:daysInMonth},(_,i)=>i+1);

  const dispDate = s => {
    if (!s) return <span className="text-gray-400 font-normal">날짜 선택 (비우면 6개월)</span>;
    const d = pd(s); if (!d) return "--";
    return `${String(d.getFullYear()).slice(2)}. ${d.getMonth()+1}. ${d.getDate()}.(${WD[d.getDay()]})`;
  };

  return (
    <>
      <button onClick={()=>setOpen(o=>!o)} className="text-sm text-blue-600 font-semibold py-1">
        {dispDate(form.repeatUntil)}
      </button>
      {open && (
        <div className="border-t border-gray-100 mt-1">
          <div className="flex px-1" style={{height:220}}>
            <WheelPicker key="ry" items={years}  value={pYear}  onChange={chYear}  renderItem={v=>String(v)}/>
            <WheelPicker key="rm" items={months} value={pMonth} onChange={chMonth} renderItem={v=>`${v}월`}/>
            <WheelPicker key={`${pYear}-${pMonth}-rd`} items={days} value={pDay} onChange={chDay}
              renderItem={v=>`${v}일 ${WD[new Date(pYear,pMonth-1,v).getDay()]}`}/>
          </div>
        </div>
      )}
    </>
  );
}

function EventModal() {
  const { modal, closeModal, addEvent, updateEvent, deleteEvent, events, cals, titleRule, typeKeywords, companyId } = useC();
  const { open, date, editId } = modal;
  const editEv=editId?events.find(e=>e.id===editId):null;
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
        updateEvent({ ...finalForm, id: editId });
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

          {/* 4탭 */}
          <div className="flex border-b border-gray-100">
            {[
              { key:"memo",  icon:"📋", label:"메모"  },
              { key:"chat",  icon:"💬", label:"대화"  },
              { key:"image", icon:"📷", label:"사진"  },
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
                    const result = await analyze({ text: pasteText });
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
                    const result = await extract({ image: base64 });
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
        <div className="relative pb-2">
          <button onClick={()=>setCalDropOpen(o=>!o)}
            className="flex items-center gap-1.5 text-xs font-semibold py-1 px-2 rounded-lg hover:bg-gray-50"
            style={{color: cals.find(c=>c.id===form.calId)?.color || "#9ca3af"}}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{background: cals.find(c=>c.id===form.calId)?.color || "#d1d5db"}}/>
            <span>{cals.find(c=>c.id===form.calId)?.label || "팀배정"}</span>
            <User size={12} className="opacity-60"/>
            <ChevronDown size={12} className={`opacity-60 transition-transform ${calDropOpen?"rotate-180":""}`}/>
          </button>
          {calDropOpen && (
            <div className="absolute left-0 top-full mt-1 bg-white rounded-xl shadow-xl border border-gray-100 z-[100] min-w-[140px] py-1 overflow-hidden">
              {cals.filter(c => c.isField !== false).map(cal=>{
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
        <DateTimePicker form={form} set={set} errs={errs}/>

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

        {/* 반복 — 정기청소 등 반복 일정용 (항상 표시) */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <RotateCcw size={18} className="text-gray-400 shrink-0"/>
            <span className="text-sm text-gray-700">반복</span>
          </div>
          <div className="flex flex-wrap gap-2 pl-9">
            {REPEAT_OPTS.map(opt=>{
              const sel=form.repeat===opt.value;
              return(
                <button key={opt.value}
                  onClick={()=>set("repeat",opt.value)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition
                    ${sel?"bg-blue-500 border-blue-400 text-white":"border-gray-200 text-gray-600"}`}>
                  {opt.label}
                </button>
              );
            })}
          </div>
          {/* 반복 종료일 — 반복일 때만 */}
          {form.repeat!=="none" && (
            <div className="flex items-center gap-2 pl-9 mt-3">
              <span className="text-xs text-gray-500 shrink-0">종료일</span>
              <RepeatUntilPicker form={form} set={set}/>
            </div>
          )}
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
            <div className="flex flex-wrap gap-2 pl-7">
              {(form.photos||[]).map((p, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200">
                  <img src={p.data} alt={p.name} className="w-full h-full object-cover"/>
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

        <div className="h-8"/>
      </div>
      </>
      )}
    </div>
  );
}


// ── 상단 헤더 ─────────────────────────────────────────────────────
function TopHeader() {
  const { current, setCurrent, setDrawer, sheetMode, setSheetMode, selDate, setSelDate, setSearchOpen, currentUser, onLogout } = useC();
  const y=current.getFullYear(), m=current.getMonth();
  const [picker,setPicker]=useState(false);
  const [companyPicker,setCompanyPicker]=useState(false);
  const [multiList,setMultiList]=useState(null);
  const [isMulti,setIsMulti]=useState(false);
  const DAYS=["일","월","화","수","목","금","토"];
  const d=pd(selDate), dow=d?.getDay()??0;

  // 로그인 시 다중 소속 여부 미리 확인
  useEffect(()=>{
    if(currentUser.role==="최고관리자") { setIsMulti(false); return; }
    const phone = currentUser.phone;
    if(!phone) { setIsMulti(false); return; }
    getDocs(query(collection(db,"staffs"), where("phone","==",phone))).then(snap=>{
      const active = snap.docs.filter(d=>d.data().status !== "deleted");
      setIsMulti(active.length >= 2);
    }).catch(()=>setIsMulti(false));
  },[currentUser.uid]);

  // 다중 소속 회사 목록 불러오기
  const checkMulti = async () => {
    if(currentUser.role !== "팀원" && currentUser.role !== "팀장") return;
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
  );
}

// ── 하단 플로팅 버튼 + 오늘 버튼 ─────────────────────────────────
function FloatingButtons() {
  const { openModal, selDate, setCurrent, setSelDate, currentUser } = useC();
  const canAdd = currentUser.role !== "팀원";
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
  const { currentUser, addReport } = useC();
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
    // 완료 보고를 Firestore(reports)에 저장 → 완료 보고 내역 화면에 실제 반영됨
    const now = new Date();
    const endTimeStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    addReport({
      eventId:   ev?.id || null,
      title:     ev?.title || "",
      date:      ev?.start || fmt(new Date()),
      startTime: ev?.startTime || "",
      calId:     ev?.calId || "",
      teamName:  cal?.label || cal?.name || "",
      teamColor: cal?.color || "#1a56db",
      reporter:  currentUser?.name || "",
      startMemo,
      memo:      endMemo,        // 완료 메모 (내역 화면에서 memo 로 표시)
      place:     ev?.place || "",
      workStart: startTime,
      workEnd:   endTimeStr,
      status:    "완료",
      createdAt: now.toISOString(),
    });

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
            <span className="text-xs text-gray-400 font-medium">클린메니져 AI 관리실 · 실시간 처리 중</span>
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
// ── 설정 가이드 · FAQ ────────────────────────────────────────────
const FAQ_DATA = [
  {
    category: "🚀 처음 시작할 때",
    items: [
      { q: "회사를 처음 등록했어요. 뭘 먼저 해야 하나요?",
        a: "① 사이드 메뉴 → 팀 관리에서 우리 회사 팀을 만들고\n② 각 팀의 '현장팀' 여부를 설정하세요 (현장팀만 일정 담당팀으로 표시됩니다)\n③ 팀원들에게 회사 ID와 가입 링크를 공유하세요.",
        img: "/faq/faq-calendar.png" },
      { q: "팀원은 어떻게 앱에 가입하나요?",
        a: "앱 첫 화면에서 '회원가입'을 눌러 이름·전화번호를 입력하면 사장님 기기에 가입 요청이 옵니다. 사장님이 팀 배정 후 승인하면 됩니다." },
    ]
  },
  {
    category: "🏷️ 제목 규칙 설정",
    items: [
      { q: "일정 제목이 자동으로 이상하게 만들어져요.",
        a: "사이드 메뉴 → 회사 설정 → '제목 규칙' 탭에서 제목에 포함할 항목과 순서를 직접 설정할 수 있습니다.\n예) [지역 → 평수 → 청소종류] 순서로 설정하면 '역촌동 15평 입주청소' 형태로 만들어집니다." },
      { q: "'청소종류'가 제목에 안 나와요.",
        a: "회사 설정 → 제목 규칙 → 청소 종류 키워드 목록에 우리 회사에서 쓰는 단어를 추가해주세요.\n예: 입주청소, 정기청소, 에어컨청소, 줄눈청소 등" },
      { q: "텍스트 붙여넣기로 일정을 만들 때 어떤 정보를 인식하나요?",
        a: "자동으로 인식되는 항목:\n• 날짜: '6월 15일', '6/15'\n• 시간: '오전 10시', '오후 2시30분'\n• 주소: 서울/경기 등 지명 + 구/동/로/길 패턴\n• 전화번호: 010-XXXX-XXXX\n• 평수/방: 15평, 원룸, 방2개\n• 비밀번호: '비밀번호: 1234' 패턴",
        img: "/faq/faq-tabs.png" },
    ]
  },
  {
    category: "👥 팀 & 직원 관리",
    items: [
      { q: "현장팀과 업무팀의 차이가 뭔가요?",
        a: "현장팀: 실제 청소 현장에 출동하는 팀 (입주청소팀, 정기청소팀 등)\n→ 일정 추가 시 '담당팀' 선택 목록에 표시됩니다.\n\n업무팀: 사무/관리 업무 팀 (관리팀, 영업팀 등)\n→ 담당팀 목록에 표시되지 않습니다.\n\n팀 관리 화면에서 각 팀의 현장팀/업무팀 버튼을 눌러 변경할 수 있습니다.",
        img: "/faq/faq-team-manage.png" },
      { q: "팀원이 볼 수 있는 일정이 제한되나요?",
        a: "네. 권한에 따라 다릅니다.\n• 최고관리자·관리팀·영업팀: 모든 팀 일정 조회 가능\n• 팀장·팀원: 자기 팀 일정만 조회 가능\n\n예) 입주청소팀 팀원은 입주청소팀 일정만 볼 수 있습니다." },
    ]
  },
  {
    category: "📅 일정 관리",
    items: [
      { q: "일정을 추가하는 방법이 여러 개인데 어떤 걸 써야 하나요?",
        a: "• 📋 메모: 카카오톡 문자나 예약 내용을 그대로 붙여넣으면 자동 분석 (가장 빠름)\n• 💬 대화: 고객과 나눈 상담 대화 전체를 붙여넣으면 AI가 예약 정보 추출\n• 📷 사진: 메모지나 캡처 이미지에서 텍스트 추출 (준비 중)\n• ✏️ 직접: 날짜·시간·장소를 직접 입력",
        img: "/faq/faq-tabs.png" },
      { q: "날짜와 시간은 어떻게 선택하나요?",
        a: "일정 추가 → ✏️ 직접 탭에서 날짜(예: 26. 6. 24.(수)) 또는 시간(예: 오전 9:00)을 탭하면 바로 아래 스크롤 휠이 펼쳐집니다.\n\n• 날짜 휠: 연도 / 월 / 일+요일을 위아래 스크롤해서 선택\n• 시간 휠: 오전·오후 / 시 / 분을 스크롤해서 선택\n• '오늘' 버튼을 누르면 오늘 날짜로 이동\n• 같은 날짜를 다시 탭하면 휠이 닫힙니다",
        img: "/faq/faq-date-picker.png" },
      { q: "일정에 담당팀을 지정하는 방법은?",
        a: "일정 추가 폼 상단 헤더 아래 '팀배정' 버튼을 탭하면 드롭다운이 열립니다.\n현장팀으로 설정된 팀 목록만 표시되며, 선택하면 팀 색상이 일정에 반영됩니다.\n\n담당팀을 지정하지 않아도 일정 저장은 가능합니다 (팀배정 상태로 저장).",
        img: "/faq/faq-team-dropdown.png" },
      { q: "반복 일정은 어떻게 설정하나요?",
        a: "일정 추가 폼 하단 '반복' 항목에서 매일/매주/매월 중 선택하고, 종료일을 지정하면 됩니다.\n종료일을 비워두면 6개월 뒤까지 자동 생성됩니다.",
        img: "/faq/faq-direct-form.png" },
      { q: "현장 완료 보고는 뭔가요?",
        a: "팀장 이상 권한을 가진 직원이 일정 상세에서 '현장 완료 보고' 버튼을 눌러 현장 사진·메모를 남길 수 있습니다.\n사이드 메뉴 → 완료 보고 내역에서 전체 기록을 조회할 수 있습니다." },
    ]
  },
  {
    category: "👥 팀 생성 · 설정 규칙",
    items: [
      { q: "팀을 새로 만들 때 '현장팀' 토글은 뭔가요?",
        a: "팀 관리 화면에서 새 팀을 추가할 때 '현장팀' 토글이 있습니다.\n\n• 현장팀 ON: 일정 추가 시 담당팀 목록에 이 팀이 표시됩니다\n• 현장팀 OFF: 담당팀 목록에 표시되지 않습니다 (업무·관리 팀용)\n\n예) 입주청소팀·정기청소팀 → 현장팀 ON\n    관리팀·영업팀 → 현장팀 OFF",
        img: "/faq/faq-team-manage.png" },
      { q: "이미 만든 팀의 현장팀 여부를 바꾸고 싶어요.",
        a: "팀 관리 화면의 팀 목록에서 각 팀 행 오른쪽에 '현장팀' 또는 '업무팀' 버튼이 있습니다.\n버튼을 탭하면 즉시 전환되며 Firestore에 자동 저장됩니다." },
      { q: "팀 순서를 바꾸고 싶어요.",
        a: "팀 관리 화면에서 각 팀 행 왼쪽의 ▲▼ 버튼으로 순서를 조정하거나, 핸들(≡)을 길게 눌러 드래그하면 됩니다.\n순서는 팀원 목록과 캘린더 색상 선택 순서에 반영됩니다." },
      { q: "팀을 삭제하면 소속 직원은 어떻게 되나요?",
        a: "해당 팀에 소속된 직원의 팀이 '미정'으로 변경됩니다.\n직원 목록에서 팀을 다시 배정해주세요." },
    ]
  },
  {
    category: "🔧 기타",
    items: [
      { q: "설정 가이드 화면은 어디서 볼 수 있나요?",
        a: "사이드 메뉴(☰) → 설정 가이드 · FAQ 를 탭하면 이 화면이 열립니다.",
        img: "/faq/faq-faq-screen.png" },
      { q: "캘린더 색상을 바꾸고 싶어요.",
        a: "현재는 기본 색상으로 고정되어 있습니다. 팀 색상 커스터마이징 기능은 추후 업데이트 예정입니다." },
      { q: "앱을 다른 기기에서 사용하려면?",
        a: "같은 아이디(전화번호)와 비밀번호로 로그인하면 됩니다. 모든 데이터는 클라우드에 저장되어 기기를 바꿔도 그대로 유지됩니다." },
    ]
  },
];

function FaqScreen() {
  const { setCurrentScreen } = useC();
  const [openIdx, setOpenIdx] = useState(null); // "카테고리index-itemIndex"

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-gray-50">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
        <h2 className="font-bold text-base">설정 가이드 · FAQ</h2>
        <button onClick={()=>setCurrentScreen("calendar")} className="p-1 rounded-full hover:bg-gray-100">
          <X size={22} className="text-gray-500"/>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto pb-8">
        {FAQ_DATA.map((cat, ci) => (
          <div key={ci} className="mb-2">
            <div className="px-4 py-3 bg-gray-50">
              <p className="text-xs font-bold text-gray-500">{cat.category}</p>
            </div>
            {cat.items.map((item, ii) => {
              const key = `${ci}-${ii}`;
              const isOpen = openIdx === key;
              return (
                <div key={ii} className="bg-white border-b border-gray-100">
                  <button
                    onClick={()=>setOpenIdx(isOpen ? null : key)}
                    className="w-full flex items-center justify-between px-4 py-4 text-left">
                    <span className="text-sm font-semibold text-gray-800 flex-1 pr-3 leading-snug">{item.q}</span>
                    <ChevronDown size={16} className={`text-gray-400 shrink-0 transition-transform ${isOpen?"rotate-180":""}`}/>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 flex flex-col gap-2">
                      <div className="bg-blue-50 rounded-xl p-3">
                        <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{item.a}</p>
                      </div>
                      {item.img && (
                        <img src={item.img} alt="화면 예시"
                          className="w-full rounded-xl border border-gray-100 shadow-sm"
                          style={{maxHeight: 320, objectFit:"cover", objectPosition:"top"}}/>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportHistoryScreen() {
  const { setCurrentScreen, reports } = useC();

  // 현장 완료 보고에서 저장된 실제 데이터 (Firestore reports)
  const sampleReports = reports;

  const [selected, setSelected] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter]   = useState("전체");
  const [teamFilter, setTeamFilter]   = useState("전체");
  const [showSearch, setShowSearch]   = useState(false);

  // 날짜 필터 옵션
  const today = fmt(new Date());
  const weekAgo = fmt(new Date(Date.now() - 86400000 * 7));
  const monthAgo = fmt(new Date(Date.now() - 86400000 * 30));

  const DATE_FILTERS = [
    {label:"전체", value:"전체"},
    {label:"오늘", value:"today"},
    {label:"이번주", value:"week"},
    {label:"이번달", value:"month"},
  ];

  // 필터 적용
  const filtered = sampleReports.filter(r => {
    const matchDate = dateFilter === "전체" ? true
      : dateFilter === "today" ? r.date === today
      : dateFilter === "week"  ? r.date >= weekAgo
      : r.date >= monthAgo;
    const matchTeam   = teamFilter === "전체" || r.teamName === teamFilter;
    const matchSearch = !searchQuery || r.title.includes(searchQuery) || r.memo.includes(searchQuery);
    return matchDate && matchTeam && matchSearch;
  });

  // 날짜별 그룹
  const grouped = filtered.reduce((acc, r) => {
    if(!acc[r.date]) acc[r.date] = [];
    acc[r.date].push(r);
    return acc;
  }, {});
  const dates = Object.keys(grouped).sort((a,b)=>b.localeCompare(a));

  const dateLabel = (d) => {
    if(d === today) return "오늘";
    if(d === fmt(new Date(Date.now()-86400000))) return "어제";
    return d.slice(5).replace("-",".");
  };

  // 상세 화면
  if(selected) {
    return (
      <div className="flex-1 overflow-y-auto bg-white flex flex-col">
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <button onClick={()=>setSelected(null)} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <h2 className="text-base font-bold text-gray-900 flex-1 line-clamp-1">{selected.title}</h2>
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full" style={{background:selected.teamColor}}/>
            <span className="text-sm font-bold" style={{color:selected.teamColor}}>{selected.teamName}</span>
            <span className="text-sm text-gray-400">·</span>
            <span className="text-sm text-gray-400">{selected.date} {selected.startTime}</span>
          </div>
          <div className="h-px bg-gray-100"/>
          <div>
            <p className="text-xs font-bold text-gray-400 mb-2">완료 메모</p>
            <p className="text-sm text-gray-700 leading-relaxed">{selected.memo}</p>
          </div>
          {selected.price && (
            <div className="bg-gray-50 rounded-2xl p-4 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-500">청소 금액</span>
              <span className="text-base font-extrabold text-blue-600">{selected.price}원</span>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1 bg-gray-100 rounded-2xl p-4 text-center">
              <p className="text-xs text-gray-400 mb-1">Before</p>
              <p className="text-2xl">📷</p>
              <p className="text-xs text-gray-300 mt-1">사진 없음</p>
            </div>
            <div className="flex-1 bg-gray-100 rounded-2xl p-4 text-center">
              <p className="text-xs text-gray-400 mb-1">After</p>
              <p className="text-2xl">📷</p>
              <p className="text-xs text-gray-300 mt-1">사진 없음</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-gray-50 min-h-screen">
      {/* 헤더 */}
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-0">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">완료 보고 내역</h2>
            <p className="text-xs text-gray-400 mt-0.5">총 {filtered.length}건</p>
          </div>
          <div className="flex items-center gap-1">
          {/* 검색 버튼 */}
          <button onClick={()=>setShowSearch(p=>!p)}
            className="w-9 h-9 rounded-xl flex items-center justify-center transition-all"
            style={{background:showSearch?"#1a56db":"#f3f4f6", color:showSearch?"white":"#374151"}}>
            <Search size={16}/>
          </button>
          <button onClick={()=>setCurrentScreen("calendar")} className="p-2 rounded-full hover:bg-gray-100">
            <X size={22} className="text-gray-500"/>
          </button>
          </div>
        </div>

        {/* 검색창 */}
        {showSearch && (
          <div className="relative mb-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input placeholder="현장명, 메모 검색..." value={searchQuery}
              onChange={e=>setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none bg-gray-50 border border-gray-200"
              autoFocus/>
            {searchQuery && (
              <button onClick={()=>setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 border-none bg-transparent cursor-pointer text-base">✕</button>
            )}
          </div>
        )}

        {/* 날짜 필터 */}
        <div className="flex gap-2 overflow-x-auto pb-3">
          {DATE_FILTERS.map(f=>(
            <button key={f.value} onClick={()=>setDateFilter(f.value)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
              style={{background:dateFilter===f.value?"#111827":"white",
                color:dateFilter===f.value?"white":"#6b7280",
                borderColor:dateFilter===f.value?"#111827":"#e5e7eb"}}>
              {f.label}
            </button>
          ))}
          <div className="w-px bg-gray-200 mx-1 self-stretch"/>
          {/* 팀 필터 */}
          <button onClick={()=>setTeamFilter("전체")}
            className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
            style={{background:teamFilter==="전체"?"#111827":"white",
              color:teamFilter==="전체"?"white":"#6b7280",
              borderColor:teamFilter==="전체"?"#111827":"#e5e7eb"}}>
            전체팀
          </button>
          {[...new Set(sampleReports.map(r=>r.teamName))].map(t=>(
            <button key={t} onClick={()=>setTeamFilter(teamFilter===t?"전체":t)}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
              style={{background:teamFilter===t?"#374151":"white",
                color:teamFilter===t?"white":"#6b7280",
                borderColor:teamFilter===t?"#374151":"#e5e7eb"}}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* 목록 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-sm font-bold">해당 내역이 없습니다</p>
            {searchQuery && <p className="text-xs mt-2">"{searchQuery}" 검색 결과 없음</p>}
          </div>
        ) : dates.map(date=>(
          <div key={date}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-bold text-gray-700">{dateLabel(date)}</span>
              <div className="flex-1 h-px bg-gray-200"/>
              <span className="text-xs text-gray-400">{grouped[date].length}건</span>
            </div>
            <div className="flex flex-col gap-2">
              {grouped[date].map(r=>(
                <button key={r.id} onClick={()=>setSelected(r)}
                  className="w-full text-left bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3 shadow-sm">
                  <div className="w-1 self-stretch rounded-full shrink-0" style={{background:r.teamColor}}/>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{r.title}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full"
                        style={{background:r.teamColor+"22", color:r.teamColor}}>{r.teamName}</span>
                      {r.startTime && <span className="text-xs text-gray-400">{r.startTime}</span>}
                      {r.price && <span className="text-xs text-gray-400">· {r.price}원</span>}
                    </div>
                  </div>
                  <ChevronLeft size={14} className="text-gray-300 rotate-180 shrink-0"/>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── 캘린더 가져오기 화면 (.ics) ───────────────────────────────────────────────
function ImportCalendarScreen() {
  const { setCurrentScreen, addEvent, cals, companyId } = useC();
  const [step, setStep]                 = useState("upload");
  const [parsedEvents, setParsedEvents] = useState([]);
  const [selectedIds, setSelectedIds]   = useState([]);
  const [selectedCal, setSelectedCal]   = useState("unassigned"); // 팀 배정
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
          // iCal 형식의 \n → 실제 줄바꿈으로 변환
          current.description = line.replace("DESCRIPTION:", "").trim().replace(/\\n/g, "\n");
        } else if (line.startsWith("UID:")) {
          // Firestore ID로 사용해 중복 가져오기 방지
          current.icsUid = line.replace("UID:", "").trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
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

  const handleImport = async () => {
    setImporting(true);
    const toImport = parsedEvents.filter((_, i) => selectedIds.includes(i));
    await Promise.all(toImport.map(ev => {
      // icsUid가 있으면 그걸 문서 ID로 써서 중복 가져오기 시 덮어쓰기
      const docId = ev.icsUid || uid();
      const evData = {
        ...ev,
        id: docId,
        calId: selectedCal,
        end: ev.end || ev.start,
        startTime: ev.startTime || "09:00",
        endTime: ev.endTime || "10:00",
        allDay: ev.allDay || false,
        place: ev.place || "",
        description: ev.description || "",
      };
      delete evData.icsUid;
      return setDoc(doc(db, "companies", companyId, "events", docId), evData);
    }));
    setImporting(false);
    setStep("done");
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
        {/* 팀 배정 선택 */}
        <div className="bg-white border-b border-gray-100 px-4 py-3">
          <p className="text-xs font-bold text-gray-500 mb-2">📌 가져올 팀 선택 (일괄 배정)</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button onClick={()=>setSelectedCal("unassigned")}
              className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
              style={{background:selectedCal==="unassigned"?"#111827":"white",
                color:selectedCal==="unassigned"?"white":"#6b7280",
                borderColor:selectedCal==="unassigned"?"#111827":"#e5e7eb"}}>
              미정
            </button>
            {cals.map(cal=>(
              <button key={cal.id} onClick={()=>setSelectedCal(cal.id)}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
                style={{background:selectedCal===cal.id?cal.color:"white",
                  color:selectedCal===cal.id?"white":"#6b7280",
                  borderColor:selectedCal===cal.id?cal.color:"#e5e7eb"}}>
                {cal.name}
              </button>
            ))}
          </div>
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
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">캘린더 가져오기</h2>
          <button onClick={() => setCurrentScreen("calendar")} className="p-2 rounded-full hover:bg-gray-100">
            <X size={22} className="text-gray-500"/>
          </button>
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
  const [mode, setMode]               = useState("login");  // login | register | setPw
  const [id, setId]                   = useState("");
  const [pw, setPw]                   = useState("");
  const [pw2, setPw2]                 = useState("");
  const [companyName, setCompanyName] = useState("");
  const [logoPreview, setLogoPreview] = useState(null);
  const [showPw, setShowPw]           = useState(false);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [pendingUser, setPendingUser] = useState(null);
  const [multiCompanies, setMultiCompanies] = useState(null); // 다중 소속 회사 선택용
  const [hasPw, setHasPw]             = useState(null); // null=미확인, true=비번있음, false=최초

  const isPhone = id => id.replace(/-/g,"").startsWith("0");
  const phoneComplete = id => isPhone(id) && id.replace(/-/g,"").length >= 10;

  // 전화번호 완성 시 Firestore에서 비밀번호 여부 확인
  useEffect(() => {
    if (!phoneComplete(id)) { setHasPw(null); return; }
    let cancelled = false;
    getDocs(query(collection(db,"staffs"), where("phone","==",onlyDigits(id))))
      .then(snap => {
        if (cancelled) return;
        if (snap.empty) { setHasPw(true); return; } // 없으면 관리자일 수 있으니 표시
        setHasPw(!!snap.docs[0].data().pw);
      })
      .catch(() => setHasPw(true));
    return () => { cancelled = true; };
  }, [id]);

  // 로그인 - 아이디/전화번호 자동 구분
  const handleLogin = async () => {
    if(!id.trim()){ setError("아이디 또는 전화번호를 입력하세요."); return; }
    setLoading(true); setError("");
    try {
      const isPhone = /^0\d{9,10}$/.test(id.trim().replace(/-/g,""));

      if(isPhone) {
        // 직원 (전화번호로 조회) — 숫자만으로 우선 조회, 못 찾으면 하이픈 포맷으로도 조회(구버전 데이터 호환)
        const phone = onlyDigits(id);
        let staffSnap = await getDocs(query(collection(db,"staffs"), where("phone","==",phone)));
        if(staffSnap.empty){
          staffSnap = await getDocs(query(collection(db,"staffs"), where("phone","==",fmtPhone(phone))));
        }
        // status:"deleted" 제외
        const activeDocs = staffSnap.docs.filter(d => d.data().status !== "deleted");
        if(activeDocs.length === 0){ setError("등록되지 않은 전화번호입니다."); setLoading(false); return; }

        // 비밀번호 확인 (첫 번째 문서 기준)
        const firstData = activeDocs[0].data();
        if(!firstData.pw) {
          const compDoc = await getDoc(doc(db,"companies",firstData.companyId));
          setPendingUser({...firstData, uid:activeDocs[0].id, companyName:compDoc.exists()?compDoc.data().name:"클린메니져"});
          setMode("setPw"); setLoading(false); return;
        }
        if(!pw.trim()){ setError("비밀번호를 입력하세요."); setLoading(false); return; }
        if(firstData.pw !== pw){ setError("비밀번호가 올바르지 않습니다."); setLoading(false); return; }

        // 다중 소속 회사 처리
        if(activeDocs.length > 1) {
          const companies = await Promise.all(activeDocs.map(async d => {
            const compDoc = await getDoc(doc(db,"companies",d.data().companyId));
            return { staffDoc: d, companyName: compDoc.exists()?compDoc.data().name:"알 수 없는 회사" };
          }));
          setMultiCompanies({ companies, pw });
          setLoading(false); return;
        }

        // 단일 소속
        const compDoc = await getDoc(doc(db,"companies",firstData.companyId));
        const user = {...firstData, uid:activeDocs[0].id, companyName:compDoc.exists()?compDoc.data().name:"클린메니져"};
        try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch{}
        onLogin(user); return;
      } else {
        // 관리자 (아이디로 조회)
        if(!pw.trim()){ setError("비밀번호를 입력하세요."); setLoading(false); return; }
        const adminQ = query(collection(db,"admins"), where("id","==",id.trim()));
        const adminSnap = await getDocs(adminQ);
        if(adminSnap.empty){ setError("등록되지 않은 아이디입니다."); setLoading(false); return; }
        const activeAdmin = adminSnap.docs.find(d => d.data().status !== "deleted");
        if(!activeAdmin){ setError("탈퇴 또는 삭제된 계정입니다."); setLoading(false); return; }
        const adminData = activeAdmin.data();
        if(adminData.pw !== pw){ setError("비밀번호가 올바르지 않습니다."); setLoading(false); return; }
        const compDoc = await getDoc(doc(db,"companies",adminData.companyId));
        if(compDoc.exists() && compDoc.data().status === "deleted"){ setError("탈퇴 또는 삭제된 업체입니다."); setLoading(false); return; }
        const user = {...adminData, uid:activeAdmin.id, companyName:compDoc.exists()?compDoc.data().name:"클린메니져", role:"최고관리자"};
        try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch{}
        onLogin(user); return;
      }
    } catch(e) {
      console.error(e);
      setError("로그인 중 오류가 발생했습니다.");
    } finally { setLoading(false); }
  };

  // 첫 로그인 비밀번호 설정
  const handleSetPw = async () => {
    if(!pw||!pw2){ setError("비밀번호를 입력하세요."); return; }
    if(pw!==pw2){ setError("비밀번호가 일치하지 않습니다."); return; }
    if(pw.length<4){ setError("비밀번호는 4자 이상이어야 합니다."); return; }
    setLoading(true); setError("");
    try {
      await updateDoc(doc(db,"staffs",pendingUser.uid), { pw });
      // companies/{companyId}/users에도 동기화
      if (pendingUser.companyId) {
        await updateDoc(doc(db,"companies",pendingUser.companyId,"users",pendingUser.uid), { pw });
      }
      const user = {...pendingUser, pw};
      try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch{}
      setPendingUser(user);
      setMode("notifyConsent"); // 비번 설정 후 알림 동의 단계로
    } catch(e) {
      console.error(e);
      setError("비밀번호 설정 중 오류가 발생했습니다.");
    } finally { setLoading(false); }
  };

  // 알림 동의 → 권한 요청 + 토큰 등록 후 앱 진입
  const handleNotifyConsent = async () => {
    setLoading(true);
    try { await enablePush(pendingUser); } catch { /* 실패해도 진입은 허용 */ }
    onLogin(pendingUser);
    setLoading(false);
  };

  // 업체 가입
  const handleRegister = async () => {
    if(!id||!pw||!pw2){ setError("모든 항목을 입력하세요."); return; }
    if(id.trim().startsWith("0")){ setError("아이디는 0으로 시작할 수 없습니다."); return; }
    if(pw!==pw2){ setError("비밀번호가 일치하지 않습니다."); return; }
    if(pw.length<4){ setError("비밀번호는 4자 이상이어야 합니다."); return; }
    setLoading(true); setError("");
    try {
      const adminQ = query(collection(db,"admins"), where("id","==",id.trim()));
      const adminSnap = await getDocs(adminQ);
      const activeExists = adminSnap.docs.some(d => d.data().status !== "deleted");
      if(activeExists){ setError("이미 사용 중인 아이디입니다."); setLoading(false); return; }
      const companyId = "c_" + Math.random().toString(36).slice(2,9);
      const adminId   = "a_" + Math.random().toString(36).slice(2,9);
      // 회사명은 기본값으로 설정 (나중에 회사 설정에서 변경)
      await setDoc(doc(db,"companies",companyId), { name:"내 회사", companyId, createdAt:new Date().toISOString() });
      await setDoc(doc(db,"admins",adminId), { id:id.trim(), pw, name:id.trim(), companyId, role:"최고관리자", team:"사장", createdAt:new Date().toISOString() });
      // 기본 캘린더(담당팀 색상) 시드 — 이게 없으면 일정이 달력에 안 보임
      await Promise.all(DEFAULT_CALS.map(c => setDoc(doc(db,"companies",companyId,"cals",c.id), c)));
      // 기본 팀 목록 + 링크 카테고리 시드 (사장 팀 포함, 목록에서는 숨겨짐)
      await setDoc(doc(db,"companies",companyId,"meta","config"), {
        teams: INIT_TEAMS,
        linkCategories: ["업무", "지도", "연락처", "기타"],
      });
      const user = {uid:adminId, id:id.trim(), name:id.trim(), companyId, companyName:"", role:"최고관리자", team:"사장", needsSetup:true};
      try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch{}
      onLogin(user);
    } catch(e) {
      console.error(e);
      setError("가입 중 오류가 발생했습니다.");
    } finally { setLoading(false); }
  };

  // ── 비밀번호 설정 화면 (첫 로그인) ──
  if(mode==="notifyConsent") {
    return (
      <div className="flex flex-col justify-center bg-white w-full px-6 py-10" style={{minHeight:"100dvh"}}>
        <div className="flex flex-col items-center justify-center px-2 mb-8">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6 shadow-xl"
            style={{background:"linear-gradient(135deg,#f59e0b,#d97706)"}}>🔔</div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-3 text-center">알림 받기</h1>
          <p className="text-sm text-gray-500 text-center leading-relaxed">
            새로운 청소 일정이 등록되면<br/>
            <span className="font-bold text-gray-800">스마트폰 알림</span>으로 바로 알려드려요.
          </p>
          <div className="mt-6 w-full bg-amber-50 border border-amber-100 rounded-2xl p-4">
            <p className="text-xs text-amber-700 leading-relaxed">
              📌 업무 일정을 놓치지 않으려면 알림을 켜는 것을 권장합니다.<br/>
              다음 화면에서 <span className="font-bold">"허용"</span>을 눌러주세요.
            </p>
          </div>
        </div>
        <button onClick={handleNotifyConsent} disabled={loading}
          className="w-full py-4 rounded-2xl text-white text-base font-bold"
          style={{background:"linear-gradient(135deg,#f59e0b,#d97706)",opacity:loading?0.7:1}}>
          {loading ? "설정 중..." : "🔔 알림 받기"}
        </button>
        <button onClick={() => onLogin(pendingUser)} disabled={loading}
          className="w-full py-3 mt-2 text-sm text-gray-400 font-semibold">
          나중에 설정
        </button>
      </div>
    );
  }

  if(mode==="setPw") {
    return (
      <div className="flex flex-col justify-center bg-white w-full px-6 py-10" style={{minHeight:"100dvh"}}>
        <div className="flex flex-col items-center justify-center px-2 mb-6">
          <div className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6 shadow-xl"
            style={{background:"linear-gradient(135deg,#16a34a,#15803d)"}}>👋</div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">처음 오셨군요!</h1>
          <p className="text-sm text-gray-500 text-center leading-relaxed">
            <span className="font-bold text-gray-800">{pendingUser?.name}</span>님,<br/>
            사용할 비밀번호를 설정해주세요.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="p-4 rounded-2xl bg-green-50 border border-green-100 mb-1">
            <p className="text-sm font-bold text-green-600 mb-1">📱 로그인 정보</p>
            <p className="text-xs text-gray-500">전화번호: <span className="font-bold text-gray-800">{id}</span></p>
            <p className="text-xs text-gray-400 mt-1">다음부터 이 번호 + 비밀번호로 로그인해요.</p>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="새 비밀번호 (4자 이상)" value={pw}
              onChange={e=>{setPw(e.target.value);setError("");}}
              className={"w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(pw?"border-green-400":"border-gray-200")}/>
            <button onClick={()=>setShowPw(p=>!p)} className="absolute right-4 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-base text-gray-400">{showPw?"🙈":"👁️"}</button>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호 확인" value={pw2}
              onChange={e=>{setPw2(e.target.value);setError("");}}
              className={"w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(pw2?(pw===pw2?"border-green-400":"border-red-400"):"border-gray-200")}/>
            {pw2&&<span className="absolute right-4 top-1/2 -translate-y-1/2 text-base">{pw===pw2?"✅":"❌"}</span>}
          </div>
          {error&&<div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-500 font-semibold">⚠️ {error}</div>}
          <button onClick={handleSetPw} disabled={loading}
            className="w-full py-4 rounded-2xl text-white text-sm font-bold mt-1"
            style={{background:pw&&pw2?"linear-gradient(135deg,#16a34a,#15803d)":"#e5e7eb",opacity:loading?0.7:1}}>
            {loading?"설정 중...":"비밀번호 설정하고 시작하기"}
          </button>
        </div>
      </div>
    );
  }

  // ── 업체 가입 화면 ──
  if(mode==="register") {
    return (
      <div className="flex flex-col justify-center bg-white w-full px-6 py-10" style={{minHeight:"100dvh"}}>
        <div className="flex flex-col items-center justify-center px-2 mb-6">
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-xl"
            style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>🧹</div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-1">클린메니져</h1>
          <p className="text-base font-bold text-blue-600 mb-2 tracking-widest uppercase">clean-manager</p>
          <p className="text-sm text-gray-400 font-medium">청소업체 관리 솔루션</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-bold text-gray-700">회원가입</p>
            <button onClick={()=>{setMode("login");setError("");}}
              className="w-9 h-9 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 transition-colors">
              <X size={18} className="text-gray-600"/>
            </button>
          </div>
          <div className="p-4 rounded-2xl bg-blue-50 border border-blue-100 mb-1">
            <p className="text-sm font-bold text-blue-600 mb-1">🏢 업체 대표 계정 만들기</p>
            <p className="text-xs text-gray-500 leading-relaxed">회사명·로고는 가입 후 앱 설정에서 언제든 변경할 수 있어요.</p>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">👤</span>
            <input placeholder="아이디 (숫자 0으로 시작하면 안됩니다.)" value={id}
              onChange={e=>{
                const v = e.target.value;
                setId(v);
                setError(v.startsWith("0") ? "⛔ 아이디는 숫자 0으로 시작할 수 없습니다!" : "");
              }}
              className={"w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(id.startsWith("0")?"border-red-400":id?"border-blue-400":"border-gray-200")}/>
            {id.startsWith("0") && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-red-500 text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-lg">
                ⛔ 0으로 시작하는 아이디는 사용할 수 없습니다
                <div className="absolute -top-1.5 left-6 w-3 h-3 bg-red-500 rotate-45"/>
              </div>
            )}
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호 (4자 이상)" value={pw} onChange={e=>{setPw(e.target.value);setError("");}}
              autoComplete="new-password"
              className={"w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(pw?"border-blue-400":"border-gray-200")}/>
            <button onClick={()=>setShowPw(p=>!p)} className="absolute right-4 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-base text-gray-400">{showPw?"🙈":"👁️"}</button>
          </div>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호 확인" value={pw2} onChange={e=>{setPw2(e.target.value);setError("");}}
              autoComplete="new-password"
              className={"w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(pw2?(pw===pw2?"border-green-400":"border-red-400"):"border-gray-200")}/>
            {pw2&&<span className="absolute right-4 top-1/2 -translate-y-1/2 text-base">{pw===pw2?"✅":"❌"}</span>}
          </div>
          {error&&<div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-500 font-semibold">⚠️ {error}</div>}
          <button onClick={handleRegister} disabled={loading}
            className="w-full py-4 rounded-2xl text-white text-sm font-bold mt-1"
            style={{background:id&&pw&&pw2?"linear-gradient(135deg,#1a56db,#2563eb)":"#e5e7eb",opacity:loading?0.7:1}}>
            {loading?"가입 중...":"가입하기"}
          </button>
        </div>
      </div>
    );
  }

  // ── 로그인 화면 ──
  return (
    <div className="flex flex-col justify-center bg-white w-full px-6 py-10" style={{minHeight:"100dvh"}}>
      <div className="flex flex-col items-center justify-center px-2 mb-8">
        <div className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-xl"
          style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>🧹</div>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-1">클린메니져</h1>
        <p className="text-base font-bold text-blue-600 mb-2 tracking-widest uppercase">clean-manager</p>
        <p className="text-sm text-gray-400 font-medium">청소업체 관리 솔루션</p>
      </div>
      <div className="flex flex-col gap-3">
        {/* 아이디/전화번호 — 전화번호면 하이픈 자동 삽입 */}
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">👤</span>
          <input placeholder="아이디 또는 전화번호" value={id}
            onChange={e=>{
              const raw = e.target.value;
              if (/^0\d*[-\d]*$/.test(raw.replace(/-/g,"")) || raw === "") {
                // 전화번호 패턴이면 하이픈 자동 삽입
                const digits = raw.replace(/\D/g,"").slice(0,11);
                const fmt = digits.length <= 3 ? digits
                  : digits.length <= 7 ? `${digits.slice(0,3)}-${digits.slice(3)}`
                  : `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
                setId(fmt);
              } else {
                setId(raw);
              }
              setError(""); setPw("");
            }}
            className={"w-full pl-11 pr-4 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border "+(id?"border-blue-400":"border-gray-200")}/>
        </div>
        {/* 비밀번호 — 최초 로그인이면 숨김 */}
        {(id && !isPhone(id)) && (
          // 관리자 아이디 로그인
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호"
              value={pw} onChange={e=>{setPw(e.target.value);setError("");}}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              className="w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border border-gray-200"/>
            <button onClick={()=>setShowPw(p=>!p)} className="absolute right-4 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-base text-gray-400">{showPw?"🙈":"👁️"}</button>
          </div>
        )}
        {(phoneComplete(id) && hasPw === true) && (
          // 전화번호 + 비밀번호 있는 직원
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-base">🔒</span>
            <input type={showPw?"text":"password"} placeholder="비밀번호"
              value={pw} onChange={e=>{setPw(e.target.value);setError("");}}
              onKeyDown={e=>e.key==="Enter"&&handleLogin()}
              className="w-full pl-11 pr-11 py-3.5 rounded-2xl text-sm outline-none bg-gray-50 border border-gray-200"/>
            <button onClick={()=>setShowPw(p=>!p)} className="absolute right-4 top-1/2 -translate-y-1/2 border-none bg-transparent cursor-pointer text-base text-gray-400">{showPw?"🙈":"👁️"}</button>
          </div>
        )}
        {(phoneComplete(id) && hasPw === false) && (
          // 최초 로그인 — 비밀번호 필드 없이 안내 메시지
          <div className="px-4 py-3 rounded-xl bg-blue-50 border border-blue-100 text-sm text-blue-600 font-semibold">
            👋 처음 로그인하시는군요! 로그인 버튼을 누르면 비밀번호를 설정할 수 있습니다.
          </div>
        )}
        {error&&<div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-500 font-semibold">⚠️ {error}</div>}
        <button onClick={handleLogin} disabled={loading}
          className="w-full py-4 rounded-2xl text-white text-sm font-bold mt-1"
          style={{background:id?"linear-gradient(135deg,#1a56db,#2563eb)":"#e5e7eb",opacity:loading?0.7:1}}>
          {loading?"확인 중...":"로그인"}
        </button>
        <p className="text-sm text-gray-400 text-center mt-1">
          처음 사용하시나요?{" "}
          <button onClick={()=>{setMode("register");setError("");setId("");setPw("");}}
            className="text-blue-500 font-bold border-none bg-transparent cursor-pointer text-sm">
            회원가입
          </button>
        </p>
      </div>
      {/* 다중 소속 회사 선택 모달 */}
      {multiCompanies && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
            <div className="text-3xl text-center mb-2">🏢</div>
            <h2 className="text-lg font-extrabold text-gray-900 text-center mb-1">소속 회사 선택</h2>
            <p className="text-sm text-gray-400 text-center mb-5">여러 업체에 등록되어 있습니다.<br/>어느 업체로 로그인할까요?</p>
            <div className="flex flex-col gap-3">
              {multiCompanies.companies.map(({ staffDoc, companyName }) => (
                <button key={staffDoc.id}
                  onClick={async () => {
                    const data = staffDoc.data();
                    const user = { ...data, uid: staffDoc.id, companyName };
                    try { localStorage.setItem("loginUser", JSON.stringify(user)); } catch {}
                    setMultiCompanies(null);
                    onLogin(user);
                  }}
                  className="w-full py-4 rounded-2xl font-bold text-sm text-white"
                  style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
                  {companyName}
                </button>
              ))}
              <button onClick={() => setMultiCompanies(null)}
                className="w-full py-3 rounded-2xl font-bold text-sm text-gray-500 bg-gray-100">
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 데모 배너 ────────────────────────────────────────────────────
function DemoBanner() {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-[1000] flex items-center gap-2 px-4 py-2 bg-amber-400 max-w-sm mx-auto"
      style={{boxShadow:"0 2px 8px rgba(0,0,0,0.15)"}}>
      <span className="text-sm font-bold text-amber-900 flex-1">🎭 데모 모드 — 실제 데이터에 영향 없음</span>
      <button onClick={()=>setVisible(false)} className="text-amber-800 font-bold text-lg leading-none">×</button>
    </div>
  );
}

// ── 앱 내부 뼈대 (로그인 후 메인 화면 라우팅) ───────────────────────────────────────────────
function SetupCompanyModal() {
  const { currentUser } = useC();
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!companyName.trim()) return;
    setLoading(true);
    try {
      await updateDoc(doc(db, "companies", currentUser.companyId), { name: companyName.trim() });
      await updateDoc(doc(db, "admins", currentUser.uid), { companyName: companyName.trim() });
      try {
        const saved = JSON.parse(localStorage.getItem("loginUser") || "{}");
        localStorage.setItem("loginUser", JSON.stringify({ ...saved, companyName: companyName.trim(), needsSetup: false }));
      } catch {}
      window.location.reload();
    } catch(e) {
      alert("오류: " + e.message);
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[999] flex items-center justify-center px-6">
      <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl">
        <div className="text-4xl text-center mb-3">🏢</div>
        <h2 className="text-xl font-extrabold text-gray-900 text-center mb-1">회사명을 입력해주세요</h2>
        <p className="text-sm text-gray-400 text-center mb-6">앱 전체에 표시되는 회사 이름입니다</p>
        <input
          value={companyName}
          onChange={e => setCompanyName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          placeholder="예) 크린드림 청소"
          autoFocus
          className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm font-bold outline-none focus:border-blue-500 mb-4"
        />
        <button
          onClick={handleSave}
          disabled={!companyName.trim() || loading}
          className="w-full py-4 rounded-xl text-white font-bold text-sm transition-all"
          style={{ background: companyName.trim() ? "linear-gradient(135deg,#1a56db,#2563eb)" : "#e5e7eb" }}>
          {loading ? "저장 중..." : "시작하기"}
        </button>
      </div>
    </div>
  );
}

function AppInner() {
  const { currentScreen, setCurrentScreen, currentUser, isDemo } = useC();
  const needsSetup = !isDemo && !currentUser?.companyName;

  // 안드로이드 뒤로가기 처리
  useEffect(() => {
    if (currentScreen !== "calendar") {
      window.history.pushState({ screen: currentScreen }, "");
    }
  }, [currentScreen]);

  useEffect(() => {
    const onPopState = () => {
      setCurrentScreen("calendar");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [setCurrentScreen]);

  // FCM 푸시 — 포그라운드 수신 핸들러 + 이미 허용된 경우 토큰 갱신 (데모 제외)
  useEffect(() => {
    if (isDemo || !currentUser?.uid) return;
    listenForeground();
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      enablePush(currentUser); // 이미 허용된 경우 토큰만 갱신
    }
  }, [isDemo, currentUser?.uid]);

  return (
    <div className={`flex flex-col overflow-hidden bg-white max-w-sm mx-auto relative select-none${isDemo?" pt-9":""}`}
      style={{height:"100dvh"}}>
      <style>{ANIM_CSS}</style>
      <TopHeader/>
      {needsSetup && <SetupCompanyModal />}
      {currentScreen === "calendar" && (
        <>
          <CalendarView/>
          <FloatingButtons/>
        </>
      )}
      {currentScreen === "employees"     && <EmployeeListScreen/>}
      {currentScreen === "team_schedule" && <TeamScheduleScreen/>}
      {currentScreen === "dashboard"     && <DashboardScreen/>}
      {currentScreen === "notice"        && <NoticeScreen/>}
      {currentScreen === "activity_log"  && <ActivityLogScreen/>}
      {currentScreen === "links"         && <ExternalLinksScreen/>}
      {currentScreen === "report_history"&& <ReportHistoryScreen/>}
      {currentScreen === "faq"            && <FaqScreen/>}
      {currentScreen === "import_calendar"&& <ImportCalendarScreen/>}
      <SideDrawer/>
      <DetailSheet/>
      <EventModal/>
      <SearchModal/>
      <EmployeeFormModal/>
      <TeamManagementModal/>
      <CompanySettingsModal/>
      <FieldReportGate/>
    </div>
  );
}

// 현장 완료 보고 화면을 컨텍스트 상태(fieldReportEv)와 연결하는 게이트
function FieldReportGate() {
  const { fieldReportEv, setFieldReportEv } = useC();
  if (!fieldReportEv) return null;
  return <FieldReportScreen ev={fieldReportEv} onClose={() => setFieldReportEv(null)} />;
}

export default function App() {
  // 데모 모드 — #demo 또는 ?demo=true
  const isDemo = window.location.hash === "#demo" ||
    new URLSearchParams(window.location.search).get("demo") === "true";
  if (isDemo) {
    return (
      <DemoProvider>
        <DemoBanner/>
        <AppInner/>
      </DemoProvider>
    );
  }

  const [authState, setAuthState] = useState("loading"); // "loading" | "login" | "app"
  const [loginUser, setLoginUser] = useState(null);

  // 로그인은 전화번호/아이디 + 비밀번호 기반(Firestore 직접 조회)이며,
  // 로그인 시 localStorage 에 사용자 정보를 저장한다. 새로고침 시 세션 복원.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("loginUser");
      if (saved) {
        const user = JSON.parse(saved);
        if (user && user.companyId) {
          setLoginUser(user);
          setAuthState("app");
          return;
        }
      }
    } catch (e) { /* 파싱 실패 시 로그인 화면 */ }
    setAuthState("login");
  }, []);

  const handleLogout = () => {
    try { localStorage.removeItem("loginUser"); } catch (e) { /* ignore */ }
    setLoginUser(null);
    setAuthState("login");
  };

  if (authState === "loading") {
    return <div className="h-screen max-w-sm mx-auto flex items-center justify-center bg-gray-50">로딩 중...</div>;
  }
  if (authState === "login") {
    return (
      <div className="min-h-screen max-w-sm mx-auto relative overflow-y-auto bg-white flex flex-col">
        <LoginScreen onLogin={(user) => {
          setLoginUser(user);
          setAuthState("app");
        }} />
      </div>
    );
  }

  return (
    <Provider loginUser={loginUser} onLogout={handleLogout}>
      <AppInner/>
    </Provider>
  );
}

// ── 직원 관리 메인 화면 (아코디언 방식) ───────────────────────────────────────────────
function EmployeeListScreen() {
  const { users, setEmpModal, teams, setTeamModal, setCurrentScreen } = useC();
  // 처음엔 모든 팀이 접힌 상태
  const [openTeams, setOpenTeams] = useState(() => new Set());

  // 팀 토글
  const toggle = (team) => {
    setOpenTeams(prev => {
      const next = new Set(prev);
      next.has(team) ? next.delete(team) : next.add(team);
      return next;
    });
  };

  // 팀 목록 (팀 없는 직원은 "기타" 그룹, 멤버 없어도 팀 표시)
  const allTeams = teams.length ? teams.filter(t => t !== "사장") : ["기타"];
  const grouped = allTeams.map(team => ({
    team,
    members: users.filter(u => u.team === team),
  }));
  const noTeam = users.filter(u => !teams.includes(u.team));
  if (noTeam.length) grouped.push({ team: "기타", members: noTeam });

  return (
    <div className="flex-1 bg-gray-50 flex flex-col relative overflow-hidden">
      {/* 헤더 */}
      <div className="bg-white px-4 py-3 border-b border-gray-100 flex items-center justify-between z-10 shrink-0">
        <h2 className="text-xl font-bold text-gray-900">직원 관리</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">총 {users.length}명</span>
          <button onClick={() => setTeamModal(true)} className="px-3 py-1.5 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg">
            팀 관리
          </button>
          <button onClick={() => setCurrentScreen("calendar")} className="p-1.5 rounded-full hover:bg-gray-100">
            <X size={20} className="text-gray-500"/>
          </button>
        </div>
      </div>

      {/* 아코디언 리스트 */}
      <div className="flex-1 overflow-y-auto pb-24">
        {grouped.map(({ team, members }) => (
          <div key={team} className="border-b border-gray-100 last:border-b-0">
            {/* 팀 헤더 (클릭하면 토글) */}
            <button
              onClick={() => toggle(team)}
              className="w-full flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-800 text-sm">{team}</span>
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{members.length}명</span>
              </div>
              {/* 화살표 아이콘 */}
              <span
                className="text-gray-400 text-xs transition-transform duration-200"
                style={{ transform: openTeams.has(team) ? "rotate(180deg)" : "rotate(0deg)" }}
              >
                ▼
              </span>
            </button>

            {/* 팀 멤버 (펼쳐질 때만 표시) */}
            {openTeams.has(team) && (
              <div className="bg-gray-50 px-4 pb-2 space-y-2">
                {members.length === 0 ? (
                  <p className="text-xs text-gray-400 py-3 text-center">등록된 직원이 없습니다.</p>
                ) : (
                  members.map(u => (
                    <div key={u.id} className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-bold text-gray-900 text-sm">{u.name}</span>
                          <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">{u.role}</span>
                        </div>
                        <div className="text-xs text-gray-400">📞 {fmtPhone(u.phone)}</div>
                      </div>
                      <button onClick={() => setEmpModal({open:true, editId:u.id})} className="p-2 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-full">
                        <Edit3 size={16}/>
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
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
  const [form, setForm] = useState({ name: "", phone: "", team: "", role: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (empModal.open) {
      if (empModal.editId) {
        const u = users.find(x => x.id === empModal.editId);
        if (u) setForm({ ...u, phone: fmtPhone(u.phone) });
      } else {
        setForm({ name: "", phone: "", team: "", role: "" });
      }
    }
  }, [empModal.open, empModal.editId, users]);

  if (!empModal.open) return null;

  const close = () => { if(!loading) setEmpModal({open:false, editId:null}); };
  
  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) return alert("이름과 연락처는 필수입니다.");
    if (!form.team || !form.role) return alert("소속 팀과 직급을 선택해주세요.");
    setLoading(true);
    
    try {
      if (empModal.editId) {
        // 기존 유저 수정 (pw 포함 저장)
        const { email, ...rest } = form;
        const updateData = { ...rest, phone: onlyDigits(form.phone) };
        await setDoc(doc(db, "companies", companyId, "users", empModal.editId), updateData, { merge: true });
        await setDoc(doc(db, "staffs", empModal.editId), { ...updateData, companyId }, { merge: true });
      } else {
        // 새 유저 생성 (Firestore 직접 저장 - 이메일 인증 사용안함)
        const newDocRef = doc(collection(db, "staffs"));
        const uid = newDocRef.id;
        
        const userData = {
          name: form.name,
          phone: onlyDigits(form.phone),
          team: form.team,
          role: form.role,
          pw: "", // 로그인 시 본인이 직접 설정하도록 비워둠
          createdAt: serverTimestamp()
        };
        
        await setDoc(doc(db, "companies", companyId, "users", uid), userData);
        await setDoc(doc(db, "staffs", uid), { ...userData, companyId });
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
        const deletedAt = new Date().toISOString();
        // 사장이 삭제한 직원 → deletedBy:"admin" (회사 복원 시 제외)
        await setDoc(doc(db, "companies", companyId, "users", empModal.editId), { status: "deleted", deletedAt, deletedBy: "admin" }, { merge: true });
        await setDoc(doc(db, "staffs", empModal.editId), { status: "deleted", deletedAt, deletedBy: "admin" }, { merge: true });
        close();
      } catch(e) {
        alert("삭제 실패");
      } finally {
        setLoading(false);
      }
    }
  };

  const resetPw = async () => {
    if (!confirm("비밀번호를 초기화하시겠습니까?\n직원이 다음 로그인 시 새 비밀번호를 설정하게 됩니다.")) return;
    setLoading(true);
    try {
      await setDoc(doc(db, "companies", companyId, "users", empModal.editId), { pw: "" }, { merge: true });
      await setDoc(doc(db, "staffs", empModal.editId), { pw: "" }, { merge: true });
      setForm(f => ({...f, pw: ""}));
      alert("비밀번호가 초기화됐습니다.\n직원이 다음 로그인 시 새 비밀번호를 설정합니다.");
    } catch(e) {
      alert("초기화 실패: " + e.message);
    } finally {
      setLoading(false);
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
            <label className="block text-xs font-semibold text-gray-500 mb-1">이름</label>
            <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800" placeholder="홍길동" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">연락처</label>
            <input value={form.phone}
              onChange={e => {
                // 숫자만 추출 후 하이픈 자동 삽입
                const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
                const formatted = digits.length <= 3 ? digits
                  : digits.length <= 7 ? `${digits.slice(0,3)}-${digits.slice(3)}`
                  : `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
                setForm({...form, phone: formatted});
              }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800" placeholder="010-0000-0000" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">소속 팀</label>
            <select value={form.team} onChange={e=>setForm({...form,team:e.target.value})} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800">
              <option value="" disabled>소속 팀을 선택하세요</option>
              <option value="미정">미정</option>
              {teams.length ? teams.map(t => (
                <option key={t.id || t.name || t} value={t.name || t}>{t.name || t}</option>
              )) : null}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">직급</label>
            <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800">
              <option value="" disabled>직급을 선택하세요</option>
              {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        {empModal.editId && (
          <div className="px-5 pb-1">
            <label className="block text-xs font-semibold text-gray-500 mb-1">비밀번호</label>
            <div className="flex gap-2 items-center">
              <input
                value={form.pw || ""}
                onChange={e => setForm({...form, pw: e.target.value})}
                placeholder="(미설정)"
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-gray-800 font-mono"
              />
              <button onClick={resetPw} disabled={loading}
                className="shrink-0 px-3 py-2 text-xs font-bold text-orange-500 bg-orange-50 rounded-lg hover:bg-orange-100 disabled:opacity-50 whitespace-nowrap">
                초기화
              </button>
            </div>
          </div>
        )}
        <div className="px-5 py-4 border-t border-gray-50 bg-gray-50 flex flex-col gap-2">
          <div className="flex gap-2">
            {empModal.editId && (
              <button onClick={del} disabled={loading} className="px-4 py-2 text-sm font-bold text-red-500 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50">삭제</button>
            )}
            <div className="flex-1"/>
            <button onClick={close} disabled={loading} className="px-4 py-2 text-sm font-bold text-gray-500 hover:bg-gray-200 rounded-lg disabled:opacity-50">취소</button>
            <button onClick={save} disabled={loading} className="px-5 py-2 text-sm font-bold text-white bg-gray-900 hover:bg-black rounded-lg flex items-center justify-center min-w-[80px]">
              {loading ? <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin"/> : "저장"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 팀 관리 모달 ───────────────────────────────────────────────
function TeamManagementModal() {
  const { teamModal, setTeamModal, teams, saveTeams, users, companyId, cals, updateCal, deleteCal } = useC();

  // 팀 열릴 때: isField 없는 기존 cal에 기본값 세팅 (청소 포함 → true, 그 외 → false)
  useEffect(() => {
    if (!teamModal) return;
    cals.forEach(cal => {
      if (cal.isField === undefined || cal.isField === null) {
        const isField = cal.label?.includes("청소");
        updateCal({ ...cal, isField: !!isField });
      }
    });
  }, [teamModal]);

  // 팀 삭제/이름변경 시 소속 직원의 team 을 Firestore 에 반영
  const reassignTeam = (fromTeam, toTeam) => {
    users.filter(u => u.team === fromTeam).forEach(u => {
      setDoc(doc(db, "companies", companyId, "users", u.id), { team: toTeam }, { merge: true });
      setDoc(doc(db, "staffs", u.id), { team: toTeam }, { merge: true });
    });
  };
  const [newTeam, setNewTeam]       = useState("");
  const [newTeamIsField, setNewTeamIsField] = useState(true);
  const [newTeamColor, setNewTeamColor] = useState("#f59e0b");
  const [colorPickerIdx, setColorPickerIdx] = useState(null);
  const [addPopup, setAddPopup]     = useState(false);
  const TEAM_COLORS = ["#f59e0b","#ec4899","#06b6d4","#84cc16","#8b5cf6","#f97316","#ef4444","#1a56db","#16a34a","#0891b2"];
  const [editIdx, setEditIdx]       = useState(null);
  const [editName, setEditName]     = useState("");
  const [dragIdx, setDragIdx]   = useState(null);
  const [overIdx, setOverIdx]   = useState(null);
  // 모든 useRef는 early return 전에 선언해야 함 (React 훅 규칙)
  const longPressTimer = useRef(null);
  const touchDragIdx   = useRef(null);
  const touchStartY    = useRef(null);
  const itemRefs       = useRef([]);

  if (!teamModal) return null;

  const close = () => { setTeamModal(false); setEditIdx(null); };

  const visibleTeams = teams.filter(t => t !== "사장");

  const handleAdd = () => {
    const name = newTeam.trim();
    if (!name) return;
    if (teams.includes(name)) { alert("이미 존재하는 팀입니다."); return; }
    saveTeams([teams[0], name, ...teams.slice(1)]);
    // 현장팀이면 캘린더(담당팀)도 생성 — 같은 이름 캘린더가 이미 있으면 새로 만들지 않음
    if (newTeamIsField) {
      const existing = cals.find(c => c.label === name || c.name === name);
      if (existing) {
        updateCal({ ...existing, color: newTeamColor, isField: true });
      } else {
        updateCal({ id: `cal_${Date.now()}`, label: name, name, color: newTeamColor, checked: true, isField: true });
      }
    }
    setNewTeam("");
    setNewTeamIsField(true);
    setNewTeamColor("#f59e0b");
    setAddPopup(false);
  };

  const handleDelete = (targetTeam) => {
    if (window.confirm("삭제하는 팀의 팀장,팀원은 소속이 미정으로 변경됩니다.")) {
      reassignTeam(targetTeam, "미정");
      saveTeams(teams.filter(t => t !== targetTeam));
      // 해당 팀명과 일치하는 모든 캘린더 삭제 (중복 포함)
      cals.filter(c => c.label === targetTeam || c.name === targetTeam).forEach(c => deleteCal(c.id));
    }
  };

  const handleRename = (oldName) => {
    const name = editName.trim();
    if (!name || name === oldName) { setEditIdx(null); return; }
    if (teams.includes(name)) { alert("이미 존재하는 팀입니다."); return; }
    saveTeams(teams.map(t => t === oldName ? name : t));
    reassignTeam(oldName, name);
    setEditIdx(null);
  };

  const move = (team, dir) => {
    const vIdx = visibleTeams.indexOf(team);
    const targetVIdx = vIdx + dir;
    if (targetVIdx < 0 || targetVIdx >= visibleTeams.length) return;

    const targetTeam = visibleTeams[targetVIdx];
    const idx = teams.indexOf(team);
    const targetIdx = teams.indexOf(targetTeam);

    const newTeams = [...teams];
    [newTeams[idx], newTeams[targetIdx]] = [newTeams[targetIdx], newTeams[idx]];
    saveTeams(newTeams);
  };

  // ── 드래그앤드롭 (HTML5) ──
  const onDragStart = (e, i) => {
    setDragIdx(i);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragOver = (e, i) => {
    e.preventDefault();
    setOverIdx(i);
  };
  const onDrop = (e, i) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === i) { setDragIdx(null); setOverIdx(null); return; }
    // visibleTeams 인덱스 → teams 인덱스로 변환 후 swap
    const fromTeam = visibleTeams[dragIdx];
    const toTeam   = visibleTeams[i];
    const fromIdx  = teams.indexOf(fromTeam);
    const toIdx    = teams.indexOf(toTeam);
    const newTeams = [...teams];
    newTeams.splice(fromIdx, 1);
    newTeams.splice(toIdx, 0, fromTeam);
    saveTeams(newTeams);
    setDragIdx(null); setOverIdx(null);
  };
  const onDragEnd = () => { setDragIdx(null); setOverIdx(null); };

  // ── 터치 롱프레스 드래그 (모바일) ──

  const onTouchStart = (e, i) => {
    touchStartY.current = e.touches[0].clientY;
    longPressTimer.current = setTimeout(() => {
      touchDragIdx.current = i;
      // 진동 피드백 (지원하는 기기)
      if (navigator.vibrate) navigator.vibrate(40);
    }, 400); // 400ms 롱프레스
  };
  const onTouchMove = (e) => {
    if (touchDragIdx.current === null) { clearTimeout(longPressTimer.current); return; }
    // e.preventDefault() 는 React passive 이벤트에서 사용 불가 → 제거
    const y = e.touches[0].clientY;
    // 현재 Y 위치에 해당하는 아이템 인덱스 계산
    const idx = itemRefs.current.findIndex(el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return y >= rect.top && y <= rect.bottom;
    });
    if (idx !== -1) setOverIdx(idx);
  };
  const onTouchEnd = () => {
    clearTimeout(longPressTimer.current);
    if (touchDragIdx.current !== null && overIdx !== null && touchDragIdx.current !== overIdx) {
      const fromTeam = visibleTeams[touchDragIdx.current];
      const toTeam   = visibleTeams[overIdx];
      const fromIdx  = teams.indexOf(fromTeam);
      const toIdx    = teams.indexOf(toTeam);
      const newTeams = [...teams];
      newTeams.splice(fromIdx, 1);
      newTeams.splice(toIdx, 0, fromTeam);
      saveTeams(newTeams);
    }
    touchDragIdx.current = null;
    setDragIdx(null); setOverIdx(null);
  };

  return (
    <div className="absolute inset-0 z-[70] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative bg-white rounded-t-3xl h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-gray-900">팀 관리</h2>
            <button onClick={() => setAddPopup(true)}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 transition-colors">
              팀 추가
            </button>
          </div>
          <button onClick={close} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <X size={24}/>
          </button>
        </div>

        {/* 팀 추가 팝업 */}
        {addPopup && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 rounded-t-3xl">
            <div className="bg-white rounded-2xl p-5 w-72 shadow-2xl flex flex-col gap-4">
              <h3 className="font-bold text-base text-gray-900">새 팀 추가</h3>
              <input
                autoFocus
                type="text"
                placeholder="팀 이름 (예: 특수청소팀)"
                value={newTeam}
                onChange={e => setNewTeam(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                className="bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm outline-none focus:border-blue-500"
              />
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <button onClick={()=>setNewTeamIsField(v=>!v)}
                  className={`relative w-9 h-5 rounded-full transition-colors ${newTeamIsField?"bg-blue-500":"bg-gray-200"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${newTeamIsField?"translate-x-4":"translate-x-0"}`}/>
                </button>
                <span className="text-xs text-gray-600">현장팀 <span className="text-gray-400">(일정 담당팀에 표시)</span></span>
              </label>
              {newTeamIsField && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-gray-500">팀 컬러</span>
                  <div className="flex gap-2 flex-wrap">
                    {TEAM_COLORS.map(color => (
                      <button key={color} onClick={() => setNewTeamColor(color)}
                        className="w-7 h-7 rounded-full border-2 transition-transform"
                        style={{
                          background: color,
                          borderColor: newTeamColor === color ? "#1a1a1a" : "transparent",
                          transform: newTeamColor === color ? "scale(1.2)" : "scale(1)",
                        }}/>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 mt-1">
                <button onClick={() => { setAddPopup(false); setNewTeam(""); }}
                  className="flex-1 py-2.5 rounded-xl text-sm text-gray-500 bg-gray-100 font-bold">취소</button>
                <button onClick={handleAdd} disabled={!newTeam.trim()}
                  className="flex-1 py-2.5 rounded-xl text-sm text-white font-bold transition-colors"
                  style={{background: newTeam.trim() ? "linear-gradient(135deg,#1a56db,#2563eb)" : "#e5e7eb"}}>추가</button>
              </div>
            </div>
          </div>
        )}

        {/* 팀 목록 */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-3 bg-gray-50">
          <p className="text-xs text-gray-400 text-center">≡ 핸들을 길게 누르면 드래그로 순서 변경</p>
          {visibleTeams.map((t, i) => (
            <div
              key={t}
              ref={el => itemRefs.current[i] = el}
              draggable
              onDragStart={e => onDragStart(e, i)}
              onDragOver={e => onDragOver(e, i)}
              onDrop={e => onDrop(e, i)}
              onDragEnd={onDragEnd}
              className={`flex items-center gap-2 bg-white p-3 rounded-xl shadow-sm border transition-all
                ${overIdx === i && dragIdx !== i ? "border-blue-400 bg-blue-50 scale-[1.02]" : "border-gray-100"}
                ${dragIdx === i ? "opacity-40" : "opacity-100"}
              `}
            >
              {/* 드래그 핸들 (▲▼ 클릭 + 롱프레스 드래그) */}
              <div
                className="flex flex-col items-center cursor-grab active:cursor-grabbing px-1 select-none touch-none"
                onTouchStart={e => onTouchStart(e, i)}
                onTouchMove={onTouchMove}
                onTouchEnd={onTouchEnd}
              >
                {/* 위 버튼 */}
                <button
                  onClick={e => { e.stopPropagation(); move(t, -1); }}
                  disabled={i === 0}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-[10px] leading-none"
                >▲</button>
                {/* 드래그 핸들 아이콘 */}
                <span className="text-gray-300 text-sm leading-none select-none">≡</span>
                {/* 아래 버튼 */}
                <button
                  onClick={e => { e.stopPropagation(); move(t, 1); }}
                  disabled={i === visibleTeams.length - 1}
                  className="text-gray-300 hover:text-gray-600 disabled:opacity-20 text-[10px] leading-none"
                >▼</button>
              </div>

              {/* 팀 컬러 원 */}
              {(()=>{
                const cal = cals.find(c => c.label === t || c.name === t);
                if (!cal) return null;
                return (
                  <div className="relative">
                    <button
                      onClick={() => setColorPickerIdx(colorPickerIdx === i ? null : i)}
                      className="w-5 h-5 rounded-full border-2 border-white shadow shrink-0"
                      style={{ background: cal.color }}
                    />
                    {colorPickerIdx === i && (
                      <div className="absolute left-0 top-7 bg-white rounded-xl shadow-xl border border-gray-100 p-2 z-50 flex flex-wrap gap-1.5" style={{width:140}}>
                        {TEAM_COLORS.map(color => (
                          <button key={color}
                            onClick={() => { updateCal({...cal, color}); setColorPickerIdx(null); }}
                            className="w-6 h-6 rounded-full border-2 transition-transform"
                            style={{
                              background: color,
                              borderColor: cal.color === color ? "#1a1a1a" : "transparent",
                              transform: cal.color === color ? "scale(1.2)" : "scale(1)",
                            }}/>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* 팀명 */}
              {editIdx === i ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if(e.key==="Enter") handleRename(t); if(e.key==="Escape") setEditIdx(null); }}
                  className="flex-1 border-b-2 border-blue-500 outline-none text-sm font-bold text-gray-800 bg-transparent px-1"
                />
              ) : (
                <span className="flex-1 font-bold text-gray-800 text-sm">{t}</span>
              )}

              {/* 현장팀 토글 */}
              {(()=>{
                const cal = cals.find(c => c.label === t);
                if (!cal) return null;
                const isField = cal.isField !== false;
                return (
                  <button onClick={()=>updateCal({...cal, isField: !isField})}
                    title={isField?"현장팀 (일정에 표시)":"업무팀 (일정에 미표시)"}
                    className={`text-[10px] font-bold px-2 py-1 rounded-full border transition-all ${
                      isField ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-gray-50 text-gray-400 border-gray-200"
                    }`}>
                    {isField ? "현장팀" : "업무팀"}
                  </button>
                );
              })()}

              {/* 수정 / 저장 */}
              {editIdx === i ? (
                <button onClick={() => handleRename(t)} className="text-xs text-blue-600 font-bold px-2 py-1 hover:bg-blue-50 rounded-lg">저장</button>
              ) : (
                <button onClick={() => { setEditIdx(i); setEditName(t); }} className="text-gray-400 hover:text-blue-500 p-1.5 rounded-full hover:bg-blue-50 transition-colors">
                  <Edit3 size={15}/>
                </button>
              )}

              {/* 삭제 */}
              <button onClick={() => handleDelete(t)} className="text-gray-400 hover:text-red-500 p-1.5 rounded-full hover:bg-red-50 transition-colors">
                <Trash2 size={15}/>
              </button>
            </div>
          ))}
          {visibleTeams.length === 0 && (
            <div className="py-10 text-center text-gray-400 text-sm">등록된 팀이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── 팀별 일정 화면 ───────────────────────────────────────────────
function TeamScheduleScreen() {
  const { visibleEvents, setCurrentScreen, cals } = useC();
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
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {currentUser.role==="최고관리자"?"사장님 대시보드":"일정 요약"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{currentUser.name} · {currentUser.role}</p>
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
function NoticeScreen() {
  const { notices, currentUser, setCurrentScreen, addNotice, deleteNotice: removeNoticeDoc } = useC();
  const [selected, setSelected]   = useState(null);
  const [writing, setWriting]     = useState(false);
  const [newTitle, setNewTitle]   = useState("");
  const [newBody, setNewBody]     = useState("");
  const [important, setImportant] = useState(false);
  const [readIds, setReadIds]     = useState(()=>JSON.parse(localStorage.getItem("readNotices")||"[]"));

  const isAdmin = currentUser.role === "최고관리자" || currentUser.team === "관리팀" || currentUser.team === "사장";

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
function ActivityLogScreen() {
  const { activityLogs, setCurrentScreen } = useC();
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
function ExternalLinksScreen() {
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
function CompanySettingsModal() {
  const { companySettingsModal, setCompanySettingsModal, currentUser,
          titleRule, typeKeywords, saveTitleRule } = useC();
  const [tab, setTab]             = useState("info");
  const [companyName, setCompanyName] = useState("");
  const [logoUrl, setLogoUrl]     = useState("");
  const [loading, setLoading]     = useState(false);
  const [localRule, setLocalRule] = useState(DEFAULT_TITLE_RULE);
  const [localKw, setLocalKw]     = useState(DEFAULT_TYPE_KEYWORDS);
  const [newKw, setNewKw]         = useState("");

  const ALL_TOKENS = Object.keys(TITLE_TOKEN_LABELS);

  useEffect(() => {
    if (companySettingsModal) {
      setCompanyName(currentUser?.companyName || "");
      setLogoUrl(currentUser?.companyLogoUrl || "");
      setTab("info");
      setLocalRule(titleRule || DEFAULT_TITLE_RULE);
      setLocalKw(typeKeywords || DEFAULT_TYPE_KEYWORDS);
    }
  }, [companySettingsModal]);

  if (!companySettingsModal) return null;
  const close = () => setCompanySettingsModal(false);

  const handleLogoUpload = (e) => {
    const file = e.target.files[0];
    if (file) { const r = new FileReader(); r.onloadend = () => setLogoUrl(r.result); r.readAsDataURL(file); }
  };

  const handleSaveInfo = async () => {
    if (!companyName.trim()) return alert("회사명을 입력해주세요.");
    setLoading(true);
    try {
      await updateDoc(doc(db, "companies", currentUser.companyId), { name: companyName, logoUrl });
      // admins 문서의 companyName도 동기화 (로그인 후 localStorage에 반영되도록)
      await updateDoc(doc(db, "admins", currentUser.uid), { companyName: companyName });
      try {
        const saved = JSON.parse(localStorage.getItem("loginUser") || "{}");
        localStorage.setItem("loginUser", JSON.stringify({ ...saved, companyName, companyLogoUrl: logoUrl }));
      } catch {}
      alert("저장됐습니다. 새로고침 시 적용됩니다."); window.location.reload();
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
            <label className="w-24 h-24 rounded-3xl flex items-center justify-center text-5xl mb-6 shadow-xl overflow-hidden cursor-pointer"
              style={{background: logoUrl ? "#fff" : "linear-gradient(135deg,#1a56db,#2563eb)"}}>
              {logoUrl ? <img src={logoUrl} alt="Logo" className="w-full h-full object-cover"/> : "🏢"}
              <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload}/>
            </label>
            <p className="text-xs text-gray-400 -mt-4 mb-6 text-center">로고 클릭하여 변경 (선택)</p>
            <div className="w-full mb-6">
              <label className="block text-xs font-bold text-gray-500 mb-1">회사명</label>
              <input value={companyName} onChange={e=>setCompanyName(e.target.value)}
                className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm font-bold outline-none focus:border-blue-500"/>
            </div>
            <button onClick={handleSaveInfo} disabled={loading||!companyName.trim()}
              className="w-full py-4 rounded-xl text-white font-bold"
              style={{background:companyName.trim()?"linear-gradient(135deg,#1a56db,#2563eb)":"#e5e7eb"}}>
              {loading?"저장 중...":"저장하고 새로고침"}
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

