import {
  useState, useContext, createContext, useCallback,
  useMemo, useRef, useEffect
} from "react";

import { db, storage } from "../firebase";
import {
  collection, doc, setDoc, updateDoc, onSnapshot,
  query, orderBy, deleteDoc, arrayUnion,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { getPendingPhotosByReport, getAllPendingPhotos, deletePendingPhoto } from "../pendingUploads";

import { fmt, add, today } from "../lib/dateTime";
import { DEFAULT_CALS, REGULAR_CAL_ID, CALS } from "../lib/calendars";
import { expandRecurring, pickRepeatFields } from "../lib/repeat";
import { DEFAULT_TITLE_RULE, DEFAULT_TYPE_KEYWORDS } from "../lib/eventTextParser";
import { INIT_TEAMS, INIT_USERS } from "../lib/constants";
import { isSuperAdmin, myTeamNames } from "../lib/membership";

// ── Context ───────────────────────────────────────────────────
export const Ctx = createContext(null);
export const useC = () => useContext(Ctx);

export function Provider({ children, loginUser, onLogout }) {
  const companyRef = doc(db, "companies", loginUser.companyId);

  // Firestore 데이터
  const [events, setEvents] = useState([]);
  const [cals, setCals] = useState(DEFAULT_CALS); // 기본 캘린더 목록 (Firestore 로드 전 fallback)
  const [calsLoaded, setCalsLoaded] = useState(false); // 실제 Firestore cals 스냅샷을 한 번이라도 받았는지
  const [teams, setTeams] = useState(INIT_TEAMS);
  const [users, setUsers] = useState(INIT_USERS);
  const [activityLogs, setActivityLogs] = useState([]);
  const [notices, setNotices] = useState([]);
  const [links, setLinks] = useState([]);
  const [linkCategories, setLinkCategories] = useState(["업무", "지도", "연락처", "기타"]);
  const [titleRule, setTitleRule]       = useState(DEFAULT_TITLE_RULE);
  const [typeKeywords, setTypeKeywords] = useState(DEFAULT_TYPE_KEYWORDS);
  const [reports, setReports] = useState([]);
  const [companyDoc, setCompanyDoc] = useState({}); // 회사 문서 자체 (요금제/기능 플래그 등)
  const [sites, setSites] = useState([]); // 정기청소 현장
  const [assignments, setAssignments] = useState([]); // 정기청소 배정(직원×현장×요일×일급)
  const [attendance, setAttendanceList] = useState([]); // 정기청소 출근확인
  const [extraPayments, setExtraPayments] = useState([]); // 정기청소 추가지급
  const [monthlySettlements, setMonthlySettlements] = useState([]); // 정기청소 월정산

  // 모듈 전역 CALS 미러를 항상 최신 cals로 유지 (calById/CALS.find 호출부가 전부 이걸 본다)
  useEffect(() => { CALS.splice(0, CALS.length, ...cals); }, [cals]);

  useEffect(() => {
    const unsubEvents = onSnapshot(collection(companyRef, "events"), snap => {
      setEvents(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubCompanyDoc = onSnapshot(companyRef, snap => {
      if (snap.exists()) setCompanyDoc(snap.data());
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
      setCalsLoaded(true);
    });
    const unsubReports = onSnapshot(collection(companyRef, "reports"), snap => {
      setReports(snap.docs.map(d => ({ ...d.data(), id: d.id }))
        .sort((a,b) => (b.date||"").localeCompare(a.date||"")));
    });
    const unsubSites = onSnapshot(collection(companyRef, "sites"), snap => {
      setSites(snap.docs.filter(d => d.data().status !== "deleted").map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubAssignments = onSnapshot(collection(companyRef, "assignments"), snap => {
      setAssignments(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubAttendance = onSnapshot(collection(companyRef, "attendance"), snap => {
      setAttendanceList(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubExtraPayments = onSnapshot(collection(companyRef, "extraPayments"), snap => {
      setExtraPayments(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });
    const unsubSettlements = onSnapshot(collection(companyRef, "monthlySettlements"), snap => {
      setMonthlySettlements(snap.docs.map(d => ({ ...d.data(), id: d.id })));
    });

    return () => {
      unsubEvents(); unsubUsers(); unsubConfig(); unsubLogs(); unsubNotices(); unsubLinks(); unsubCals(); unsubReports(); unsubCompanyDoc(); unsubSites(); unsubAssignments(); unsubAttendance(); unsubExtraPayments(); unsubSettlements();
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
  // 저장 성공/실패를 호출부에서 확인할 수 있도록 Promise를 그대로 반환(await 가능)
  const addReport = useCallback(async r => {
    const ref = doc(collection(companyRef, "reports"));
    await setDoc(ref, { ...r, id: ref.id });
    return ref.id;
  }, [companyRef]);

  const updateReport = useCallback((id, patch) => {
    return updateDoc(doc(companyRef, "reports", id), patch);
  }, [companyRef]);

  // ── 현장 사진 백그라운드 업로드 (IndexedDB 대기열 기반) ──
  // 사진은 먼저 pendingUploads(IndexedDB)에 저장해두고 여기서 하나씩 실제 업로드한다.
  // 화면이 닫히거나 탭이 강제 종료돼도 큐는 브라우저에 남아있으므로,
  // 앱을 다시 열면(로그인 세션 시작 시 useEffect) 못 끝낸 사진을 이어서 올린다.
  const inFlightUploadsRef = useRef(new Set());
  const processPendingUploads = useCallback(async (reportId) => {
    if (inFlightUploadsRef.current.has(reportId)) return;
    inFlightUploadsRef.current.add(reportId);
    try {
      const pending = await getPendingPhotosByReport(reportId);
      for (const item of pending) {
        try {
          const path = `companies/${loginUser.companyId}/reports/${item.eventId || "misc"}/${item.tag}/${item.createdAt}_${item.name}`;
          const sRef = storageRef(storage, path);
          await uploadBytes(sRef, item.blob);
          const url = await getDownloadURL(sRef);
          await updateReport(reportId, { [`${item.tag}Photos`]: arrayUnion({ name: item.name, url }) });
          await deletePendingPhoto(item.id);
        } catch (e) {
          console.error("[사진 업로드 대기열] 실패, 다음에 다시 시도:", item.name, e);
          // 이 항목은 큐에 남겨두고 다음 기회(다음 앱 실행)에 다시 시도
        }
      }
    } catch { /* IndexedDB 미지원 등은 무시 — 이 경우 사진은 화면에 켜져있는 동안만 업로드됨 */ }
    finally { inFlightUploadsRef.current.delete(reportId); }
  }, [loginUser.companyId, updateReport]);

  // 로그인 직후 한 번: 이전 세션에서 못 끝낸 업로드가 있으면 이어서 처리
  useEffect(() => {
    (async () => {
      try {
        const all = await getAllPendingPhotos();
        const reportIds = [...new Set(all.map(p => p.reportId))];
        reportIds.forEach(id => processPendingUploads(id));
      } catch { /* IndexedDB 미지원 등은 무시 */ }
    })();
  }, [processPendingUploads]);

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

  // ── 정기청소 현장 CRUD (Firestore 영속) ──
  const addSite = useCallback(s => {
    const ref = doc(collection(companyRef, "sites"));
    setDoc(ref, { ...s, id: ref.id });
    addLog("등록", `'${s.name}' 현장을 등록했습니다.`);
  }, [companyRef, addLog]);
  const updateSite = useCallback(s => {
    setDoc(doc(companyRef, "sites", s.id), s, { merge: true });
    addLog("수정", `'${s.name}' 현장 정보를 수정했습니다.`);
  }, [companyRef, addLog]);
  const deleteSite = useCallback(id => {
    const target = sites.find(s => s.id === id);
    deleteDoc(doc(companyRef, "sites", id));
    if (target) addLog("삭제", `'${target.name}' 현장을 삭제했습니다.`);
  }, [companyRef, sites, addLog]);

  // ── 정기청소 배정 → 캘린더 동기화 (배정 1건 = 캘린더 반복일정 1건) ──
  // 배정마다 반복 규칙이 다를 수 있어(요일별/매월 몇째주 등) 예전처럼 현장 하나에 합치지 않고 배정 단위로 관리.
  // 반복 규칙이나 현장이 바뀌면 과거 일정은 그대로 두고 오늘부터 새 시리즈로 분리한다(기존 반복일정 수정 시
  // "이후 전체만 수정"하는 방식과 동일한 원리 — updateEventScoped의 following 분기 참고).
  const syncAssignmentCalendar = useCallback(async (assignment, prevAssignment, sitesList) => {
    const site = sitesList.find(s => s.id === assignment.siteId);
    if (!site) return;
    const sameRule = prevAssignment
      && prevAssignment.siteId === assignment.siteId
      && pickRepeatFields(prevAssignment) === pickRepeatFields(assignment);
    if (sameRule) return;

    const todayStr = fmt(new Date());
    const yesterday = add(todayStr, -1);

    if (prevAssignment?.eventId) {
      await setDoc(doc(companyRef, "events", prevAssignment.eventId), { repeatUntil: yesterday }, { merge: true });
    }

    // "정기청소" 담당팀 캘린더는 팀 관리와 무관하게 이 기능 전용으로 고정 id로 자동 생성/재사용.
    // (특정 팀 이름에 의존하면 회사마다 팀 구성이 달라 매칭이 깨짐 — 배정만 있으면 바로 동작하도록 분리)
    let regularCal = cals.find(c => c.id === REGULAR_CAL_ID);
    if (!regularCal) {
      regularCal = { id: REGULAR_CAL_ID, label: "정기청소", name: "정기청소", color: "#16a34a", checked: true, isField: true };
      await setDoc(doc(companyRef, "cals", REGULAR_CAL_ID), regularCal);
      setCals(prev => prev.some(c => c.id === REGULAR_CAL_ID) ? prev : [...prev, regularCal]);
    }
    const newRef = doc(collection(companyRef, "events"));
    await setDoc(newRef, {
      title: `${site.name} 정기청소`,
      start: todayStr, end: todayStr, allDay: true,
      repeat: assignment.repeat, repeatInterval: assignment.repeatInterval || 1,
      repeatWeekdays: assignment.repeatWeekdays || [],
      repeatMonthlyType: assignment.repeatMonthlyType || null,
      repeatMonthlyDay: assignment.repeatMonthlyDay || null,
      repeatMonthlyOrdinal: assignment.repeatMonthlyOrdinal || null,
      repeatMonthlyWeekday: assignment.repeatMonthlyWeekday ?? null,
      repeatYearlyType: assignment.repeatYearlyType || null,
      repeatYearlyMonth: assignment.repeatYearlyMonth || null,
      repeatYearlyDay: assignment.repeatYearlyDay || null,
      repeatYearlyOrdinal: assignment.repeatYearlyOrdinal || null,
      repeatYearlyWeekday: assignment.repeatYearlyWeekday ?? null,
      repeatUntil: assignment.repeatUntil || "",
      calId: regularCal.id,
      place: site.address || "",
      description: "",
      source: "regular", siteId: assignment.siteId, assignmentId: assignment.id,
    });
    await setDoc(doc(companyRef, "assignments", assignment.id), { eventId: newRef.id, start: todayStr }, { merge: true });
  }, [companyRef, cals]);

  // ── 정기청소 배정 CRUD (Firestore 영속) ──
  const addAssignment = useCallback(async a => {
    const ref = doc(collection(companyRef, "assignments"));
    const newAssignment = { ...a, id: ref.id, start: fmt(new Date()) };
    await setDoc(ref, newAssignment);
    const emp = users.find(u => u.id === a.employeeId);
    const site = sites.find(s => s.id === a.siteId);
    addLog("등록", `${emp?.name || "직원"} - ${site?.name || "현장"} 배정을 등록했습니다.`);
    await syncAssignmentCalendar(newAssignment, null, sites);
  }, [companyRef, sites, users, addLog, syncAssignmentCalendar]);

  const updateAssignment = useCallback(async a => {
    const prev = assignments.find(x => x.id === a.id);
    await setDoc(doc(companyRef, "assignments", a.id), a, { merge: true });
    const emp = users.find(u => u.id === a.employeeId);
    const site = sites.find(s => s.id === a.siteId);
    addLog("수정", `${emp?.name || "직원"} - ${site?.name || "현장"} 배정을 수정했습니다.`);
    await syncAssignmentCalendar(a, prev, sites);
  }, [companyRef, assignments, sites, users, addLog, syncAssignmentCalendar]);

  const deleteAssignment = useCallback(async id => {
    const target = assignments.find(x => x.id === id);
    await deleteDoc(doc(companyRef, "assignments", id));
    if (target) {
      const emp = users.find(u => u.id === target.employeeId);
      const site = sites.find(s => s.id === target.siteId);
      addLog("삭제", `${emp?.name || "직원"} - ${site?.name || "현장"} 배정을 삭제했습니다.`);
      if (target.eventId) {
        await setDoc(doc(companyRef, "events", target.eventId), { repeatUntil: add(fmt(new Date()), -1) }, { merge: true });
      }
    }
  }, [companyRef, assignments, sites, users, addLog]);

  // ── 정기청소 출근확인 (Firestore 영속) ──
  // date+employeeId+siteId 조합을 문서 id로 고정해 항상 upsert(있으면 갱신, 없으면 생성).
  const setAttendanceCheck = useCallback((date, employeeId, siteId, confirmed, confirmedBy) => {
    const id = `${date}_${employeeId}_${siteId}`;
    setDoc(doc(companyRef, "attendance", id), { date, employeeId, siteId, confirmed, confirmedBy }, { merge: true });
  }, [companyRef]);

  // ── 정기청소 추가지급 CRUD ──
  const addExtraPayment = useCallback(p => {
    const ref = doc(collection(companyRef, "extraPayments"));
    setDoc(ref, { ...p, id: ref.id });
  }, [companyRef]);
  const deleteExtraPayment = useCallback(id => {
    deleteDoc(doc(companyRef, "extraPayments", id));
  }, [companyRef]);

  // ── 정기청소 직원 일 보조금(dailyAllowance) — users 문서에 필드로 저장 ──
  const setEmployeeAllowance = useCallback((employeeId, dailyAllowance) => {
    updateDoc(doc(companyRef, "users", employeeId), { dailyAllowance }).catch(() => {});
  }, [companyRef]);

  // ── 정기청소 월정산 확정 — employeeId+yearMonth를 문서id로 고정해 upsert ──
  const confirmSettlement = useCallback((employeeId, yearMonth, finalAmount) => {
    const id = `${employeeId}_${yearMonth}`;
    setDoc(doc(companyRef, "monthlySettlements", id), {
      employeeId, yearMonth, finalAmount, confirmedAt: new Date().toISOString(),
    }, { merge: true });
  }, [companyRef]);

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

  // 팀장 코멘트 — 일정 본문은 못 건드리고 이 코멘트만 남기고 지울 수 있음
  const updateLeaderComment = useCallback((eventId, comment, authorName) => {
    const target = events.find(e => e.id === eventId);
    updateDoc(doc(companyRef, "events", eventId), {
      leaderComment: comment,
      leaderCommentBy: comment ? authorName : null,
      leaderCommentAt: comment ? new Date().toISOString() : null,
    });
    if (target) addLog(comment ? "코멘트" : "삭제", `'${target.title}' 일정에 팀장 코멘트를 ${comment ? "남겼습니다" : "삭제했습니다"}.`);
  }, [events, addLog, companyRef]);

  // 반복일정 수정 — scope: "instance"(이 일정만) | "following"(이후 전체) | "all"(전체)
  // clickedEv 는 캘린더에 실제로 표시된(펼쳐진) 인스턴스 — .id=원본 시리즈 id, .start=이 회차 날짜
  const updateEventScoped = useCallback((clickedEv, scope, patch) => {
    const seriesId = clickedEv.id;
    if (!clickedEv._recurring || scope === "all") {
      updateEvent({ ...patch, id: seriesId });
      return;
    }
    const dateStr = clickedEv._origDate || clickedEv.start;
    const original = events.find(e => e.id === seriesId);
    if (!original) return;

    if (scope === "instance") {
      const { id, exceptions, _recurring, _hasException, _origDate,
        repeat, repeatInterval, repeatUntil, repeatWeekdays,
        repeatMonthlyType, repeatMonthlyDay, repeatMonthlyOrdinal, repeatMonthlyWeekday,
        repeatYearlyType, repeatYearlyMonth, repeatYearlyDay, repeatYearlyOrdinal, repeatYearlyWeekday,
        ...rest } = patch;
      updateDoc(doc(companyRef, "events", seriesId), { [`exceptions.${dateStr}`]: rest });
      addLog("수정", `'${patch.title}' 반복일정 중 ${dateStr} 1회만 수정했습니다.`);
      return;
    }

    if (scope === "following") {
      if (dateStr <= original.start) { updateEvent({ ...patch, id: seriesId }); return; }
      updateDoc(doc(companyRef, "events", seriesId), { repeatUntil: add(dateStr, -1) });
      const { id, _recurring, _hasException, _origDate, ...rest } = patch;
      addEvent({ ...rest, start: dateStr, repeatUntil: original.repeatUntil || "" });
      addLog("수정", `'${patch.title}' 반복일정을 ${dateStr}부터 분리해 수정했습니다.`);
    }
  }, [events, addLog, companyRef, updateEvent, addEvent]);

  // 반복일정 삭제 — scope: "instance" | "following" | "all"
  const deleteEventScoped = useCallback((clickedEv, scope) => {
    const seriesId = clickedEv.id;
    if (!clickedEv._recurring || scope === "all") { deleteEvent(seriesId); return; }
    const dateStr = clickedEv._origDate || clickedEv.start;
    const original = events.find(e => e.id === seriesId);
    if (!original) return;

    if (scope === "instance") {
      updateDoc(doc(companyRef, "events", seriesId), { [`exceptions.${dateStr}`]: { _deleted: true } });
      addLog("삭제", `'${clickedEv.title}' 반복일정 중 ${dateStr} 1회만 삭제했습니다.`);
      return;
    }

    if (scope === "following") {
      if (dateStr <= original.start) { deleteEvent(seriesId); return; }
      updateDoc(doc(companyRef, "events", seriesId), { repeatUntil: add(dateStr, -1) });
      addLog("삭제", `'${clickedEv.title}' 반복일정을 ${dateStr} 이후 모두 삭제했습니다.`);
    }
  }, [events, addLog, companyRef, deleteEvent]);

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
  const [modal,setModal]       = useState({open:false,date:null,editId:null,scope:"all",instanceEv:null});
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
  const [siteModal, setSiteModal] = useState({ open: false, editId: null });
  const [assignmentModal, setAssignmentModal] = useState({ open: false, editId: null, presetSiteId: null });
  const [extraPaymentModal, setExtraPaymentModal] = useState({ open: false, employeeId: null });
  const [siteDetailId, setSiteDetailId] = useState(null);

  const [currentUser, setCurrentUser] = useState(loginUser);
  useEffect(() => { setCurrentUser(loginUser); }, [loginUser]);

  // 로그인 세션(loginUser)은 로그인 시점에 localStorage에 캐시해둔 값이라,
  // 관리자가 직원관리에서 이름/팀/직급을 바꿔도 이미 로그인해있는 그 직원의
  // 화면에는(새로고침해도) 반영되지 않았음. users는 실시간(onSnapshot)이므로
  // 여기서 최신 값을 감지해 currentUser + localStorage 캐시를 같이 갱신해준다.
  // (관리자가 SideDrawer의 "다른 직원으로 보기" 테스트 전환 중일 땐 건드리지 않음)
  useEffect(() => {
    if (!loginUser?.uid || currentUser.uid !== loginUser.uid) return;
    const fresh = users.find(u => u.id === loginUser.uid);
    if (!fresh) return;
    const fields = ["name", "phone", "team", "role", "pw"];
    if (fields.every(k => fresh[k] === currentUser[k])) return;
    const updated = { ...currentUser, ...Object.fromEntries(fields.map(k => [k, fresh[k]])) };
    setCurrentUser(updated);
    try { localStorage.setItem("loginUser", JSON.stringify(updated)); } catch {}
  }, [users, loginUser?.uid, currentUser]);

  const openModal   = useCallback((date=null,editId=null,scope="all",instanceEv=null)=>setModal({open:true,date,editId,scope,instanceEv}),[]);
  const closeModal  = useCallback(()=>setModal({open:false,date:null,editId:null,scope:"all",instanceEv:null}),[]);

  const checkedIds     = useMemo(()=>new Set(cals.filter(c=>c.checked).map(c=>c.id)),[cals]);

  // 나만의 캘린더(개인 전용) — 본인 또는 최고관리자만 볼 수 있음.
  // currentUser.id는 SideDrawer의 "다른 직원으로 보기" 테스트 전환 시에만 있고,
  // 실제 로그인 사용자(loginUser)는 uid만 있으므로 둘 다 대비해 폴백함.
  const myUserId = currentUser.id || currentUser.uid;
  const isMine = useCallback(c => !c.personal || c.ownerId === myUserId || currentUser.role === "최고관리자",
    [myUserId, currentUser.role]);
  const visibleCals = useMemo(() => cals.filter(isMine), [cals, isMine]);

  // 나만의 캘린더는 사용자가 직접 만들 필요 없이 로그인 시 자동으로 하나씩 생성
  useEffect(() => {
    if (!calsLoaded || !myUserId) return;
    const exists = cals.some(c => c.personal && c.ownerId === myUserId);
    if (!exists) {
      updateCal({
        id: `personal_${myUserId}`,
        label: `${currentUser.name}의 캘린더`, name: `${currentUser.name}의 캘린더`,
        color: "#6366f1", checked: true, isField: true,
        personal: true, ownerId: myUserId,
      });
    }
  }, [calsLoaded, cals, myUserId, currentUser.name, updateCal]);

  const visibleEvents  = useMemo(()=>{
    // calId가 없거나 "unassigned"인 미배정 일정도 항상 표시
    let evs = events.filter(e=>checkedIds.has(e.calId) || !e.calId || e.calId==="unassigned");
    // 다른 사람의 개인 캘린더 일정은 제외
    const hiddenPersonalIds = new Set(cals.filter(c => !isMine(c)).map(c => c.id));
    if (hiddenPersonalIds.size) evs = evs.filter(e => !hiddenPersonalIds.has(e.calId));
    if (!isSuperAdmin(currentUser)) {
      // 소속된 모든 팀(멤버십)의 캘린더를 합쳐서 표시 — 한 사람이 여러 팀 소속이면 그 팀들 전부.
      // 소속 팀이 하나도 없으면(신규/미배정) 기존처럼 전체 표시.
      const myTeams = myTeamNames(currentUser);
      if (myTeams.length) {
        const allowedCalIds = new Set(cals.filter(c => myTeams.includes(c.label)).map(c => c.id));
        evs = evs.filter(e => allowedCalIds.has(e.calId) || cals.find(c=>c.id===e.calId)?.personal);
      }
    }
    return expandRecurring(evs);
  }, [events, checkedIds, cals, currentUser, isMine]);

  return (
    <Ctx.Provider value={{
      events,visibleEvents,addEvent,updateEvent,deleteEvent,updateEventScoped,deleteEventScoped,updateLeaderComment,
      fieldReportEv,setFieldReportEv,
      cals,visibleCals,toggleCal,updateCal,deleteCal,
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
      reports,addReport,updateReport,processPendingUploads,
      companyDoc,
      sites,addSite,updateSite,deleteSite,siteModal,setSiteModal,
      assignments,addAssignment,updateAssignment,deleteAssignment,assignmentModal,setAssignmentModal,
      siteDetailId,setSiteDetailId,
      attendance,setAttendanceCheck,
      extraPayments,addExtraPayment,deleteExtraPayment,extraPaymentModal,setExtraPaymentModal,
      setEmployeeAllowance,
      monthlySettlements,confirmSettlement,
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

export function DemoProvider({ children }) {
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
  const [siteModal, setSiteModal] = useState({ open: false, editId: null });
  const [assignmentModal, setAssignmentModal] = useState({ open: false, editId: null, presetSiteId: null });
  const [extraPaymentModal, setExtraPaymentModal] = useState({ open: false, employeeId: null });
  const [siteDetailId, setSiteDetailId] = useState(null);
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
      cals: DEMO_CALS, visibleCals: DEMO_CALS, toggleCal: noop, updateCal: noop,
      users: DEMO_USERS, setUsers: noop,
      teams: DEMO_TEAMS, setTeams: noop, saveTeams: noop,
      activityLogs: DEMO_LOGS, setActivityLogs: noop,
      notices: DEMO_NOTICES,
      links: DEMO_LINKS, addLink: noop, deleteLink: noop, updateLink: noop, persistLinkOrder: noop,
      linkCategories, saveLinkCategories: noop,
      reports: [],
      companyDoc: { aiImageExtraction: true }, // 데모에선 기능 시연을 위해 전부 켜둠
      currentUser: DEMO_USER, setCurrentUser: noop,
      loginUser: DEMO_USER, onLogout: noop,
      currentScreen, setCurrentScreen,
      titleRule, typeKeywords, saveTitleRule: noop,
      addEvent: demoAlert, updateEvent: demoAlert, deleteEvent: demoAlert, updateLeaderComment: demoAlert,
      updateEventScoped: demoAlert, deleteEventScoped: demoAlert,
      addNotice: demoAlert, updateNotice: demoAlert, deleteNotice: demoAlert,
      addLog: noop, addReport: demoAlert, updateReport: noop,
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
      sites: [], addSite: demoAlert, updateSite: demoAlert, deleteSite: demoAlert, siteModal, setSiteModal,
      assignments: [], addAssignment: demoAlert, updateAssignment: demoAlert, deleteAssignment: demoAlert, assignmentModal, setAssignmentModal,
      siteDetailId, setSiteDetailId,
      attendance: [], setAttendanceCheck: demoAlert,
      extraPayments: [], addExtraPayment: demoAlert, deleteExtraPayment: demoAlert, extraPaymentModal, setExtraPaymentModal,
      setEmployeeAllowance: demoAlert,
      monthlySettlements: [], confirmSettlement: demoAlert,
      companyId: "demo",
    }}>
      {children}
    </Ctx.Provider>
  );
}
