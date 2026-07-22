/**
 * 클린메니져 — 네이버 캘린더 완전 재현
 * 3단계 스와이프 모드:
 *   MODE 0 (full)  → 월간 그리드 전체 (이벤트 텍스트 바 표시)
 *   MODE 1 (half)  → 상단 도트 그리드 + 하단 시간표 시트
 *   MODE 2 (list)  → 그리드 숨김, 시간표 전체
 */

import {
  useState, useCallback,
  useMemo, useRef, useEffect
} from "react";
import {
  Search, Plus, X, MapPin, Link2, RotateCcw, Clock,
  Calendar, AlignLeft, ChevronDown, ChevronLeft,
  ChevronRight, Menu, Settings, User, Edit3, Trash2,
  PieChart, Bell, History, ExternalLink, Activity,
  CheckSquare, FileText, Camera, Download, Check
} from "lucide-react";

import { db, functions, storage } from "./firebase";
import { enablePush, disablePush, listenForeground } from "./fcm";
import { collection, doc, setDoc, getDoc, getDocs, updateDoc, query, where, serverTimestamp } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { httpsCallable } from "firebase/functions";
import { addPendingPhoto } from "./pendingUploads";

import { HOLIDAYS, WD, nthWeekdayOfMonth, fmt, pd, diff, add, addMonths, fmtTime } from "./lib/dateTime";
import { DEFAULT_CALS, REGULAR_CAL_ID, CALS, calById } from "./lib/calendars";
import {
  REPEAT_OPTS, REPEAT_ORD_OPTS, WAGE_TYPES, wageTypeLabel, expandRecurring,
  assignmentRepeatRule, assignmentOccursOn, describeRepeat,
  REPEAT_FIELDS, pickRepeatFields, repeatRuleValid,
} from "./lib/repeat";
import { getReportStatus, REPORT_STATUS_STYLE } from "./lib/reports";
import { onlyDigits, fmtPhone } from "./lib/phone";
import { genFeedToken, feedUrl } from "./lib/calendarFeed";
import { DEFAULT_TITLE_RULE, DEFAULT_TYPE_KEYWORDS, TITLE_TOKEN_LABELS, parseEventText } from "./lib/eventTextParser";
import { INIT_TEAMS, ROLES } from "./lib/constants";
import { useC, Provider, DemoProvider } from "./context/AppContext";
import { ReportStatusBadge } from "./components/shared/ReportStatusBadge";
import { PhotoLightbox, openLightbox } from "./components/shared/PhotoLightbox";
import { RecurringScopeSheet, askRecurringScope } from "./components/shared/RecurringScopeSheet";
import { WheelPicker, RepeatToggleButton, RepeatPanel, RepeatUntilPicker } from "./components/shared/RepeatPicker";
import { RegularCleaningDetailBody } from "./features/regular-cleaning/RegularCleaningDetailBody";
import {
  RegularCleaningHubScreen, SitesScreen, SiteDetailScreen, TodayStatusScreen,
  MyRegularCleaningScreen, MonthlySettlementScreen, ExtraPaymentModal, SiteFormModal, AssignmentFormModal,
} from "./features/regular-cleaning/RegularCleaningScreens";
import { EmployeeListScreen, EmployeeFormModal } from "./features/employees/EmployeeTeamScreens";
import {
  buildLayout, TextBar, FullMonthCell, DotCell, useDates, ScheduleList, useSwipe,
  SlideTransition, ListTransition, ModeTransition, CalendarView, DetailSheet,
  LongPressMenu, DeleteConfirmPopup, BottomTabBar, SideDrawer, DateTimePicker,
  EventModal, TopHeader, FloatingButtons, SearchModal, ExtraCalFilterModal, ANIM_CSS,
} from "./features/calendar/CalendarCore";
import { FieldReportScreen } from "./features/field-report/FieldReportScreen";
import { FaqScreen, ReportHistoryScreen } from "./features/support/SupportScreens";
import { ImportCalendarScreen } from "./features/import-calendar/ImportCalendarScreen";
import { LoginScreen, DemoBanner, SetupCompanyModal, IphoneInstallGuide } from "./features/auth/AuthScreens";
import {
  TeamScheduleScreen, DashboardScreen, NoticeScreen, ActivityLogScreen,
  ExternalLinksScreen, CompanySettingsModal,
} from "./features/misc/MiscScreens";

function AppInner() {
  const {
    currentScreen, setCurrentScreen, currentUser, isDemo,
    modal, closeModal, detEv, setDetEv, fieldReportEv, setFieldReportEv,
    drawer, setDrawer, searchOpen, setSearchOpen,
    empModal, setEmpModal,
    companySettingsModal, setCompanySettingsModal,
    siteModal, setSiteModal, assignmentModal, setAssignmentModal,
    extraPaymentModal, setExtraPaymentModal,
    eventModalGuardRef,
  } = useC();
  const needsSetup = !isDemo && !currentUser?.companyName;
  const [showNotifyPrompt, setShowNotifyPrompt] = useState(false);
  const [notifyRequesting, setNotifyRequesting] = useState(false);
  // 안드로이드 뒤로가기 처리 — 열려있는 팝업/모달이 있으면 그것부터 하나씩 닫는다.
  // (배열 순서 = 우선순위. 더 안쪽/위에 뜨는 것부터 검사해서 그것만 닫는다)
  // 일정 추가/수정 모달은 X버튼과 동일하게, 수정 중인 내용이 있으면 저장 확인부터
  // 묻는 tryClose(eventModalGuardRef)를 거친다.
  //
  // "기본화면(캘린더)에서 뒤로가기 시 종료 확인창"은 시도했다가 포기함(2026-07-22) —
  // popstate 핸들러 "안에서" pushState로 히스토리를 되채워 뒤로가기를 못 나가게 막는
  // 방식은 크롬 계열 브라우저가 back-button 남용(가두기) 방지 로직으로 무력화한다는 걸
  // 실기기 테스트로 확인함(히스토리 길이가 재적립 없이 계속 줄어들다 바닥에서 그냥 탭이
  // 닫혀버림). 웹에서는 안정적으로 구현 불가 — 나중에 네이티브 앱 전환 시 재검토.
  const backLayers = [
    { open: !!fieldReportEv, close: () => setFieldReportEv(null) },
    { open: !!detEv,         close: () => setDetEv(null) },
    { open: modal.open,      close: () => (eventModalGuardRef?.current || closeModal)() },
    { open: showNotifyPrompt, close: () => setShowNotifyPrompt(false) },
    { open: empModal.open,           close: () => setEmpModal({ open: false, editId: null }) },
    { open: companySettingsModal,    close: () => setCompanySettingsModal(false) },
    { open: siteModal.open,          close: () => setSiteModal({ open: false, editId: null }) },
    { open: assignmentModal.open,    close: () => setAssignmentModal({ open: false, editId: null, presetSiteId: null }) },
    { open: extraPaymentModal.open,  close: () => setExtraPaymentModal({ open: false, employeeId: null }) },
    { open: searchOpen, close: () => setSearchOpen(false) },
    { open: drawer,      close: () => setDrawer(false) },
    { open: currentScreen !== "calendar", close: () => setCurrentScreen("calendar") },
  ];
  const openCount = backLayers.filter(l => l.open).length;
  const prevOpenCountRef = useRef(0);
  const isPopRef = useRef(false); // 방금 감소가 실제 뒤로가기(popstate)로 인한 것인지
  const skipNextPopRef = useRef(0); // 코드로 예약해둔 back() 중 아직 안 온 popstate 개수

  // 열린 레이어 수가 늘어날 때마다 늘어난 만큼 히스토리를 쌓는다(중첩 팝업도 각자 한 단계씩
  // 차지). 이건 popstate 핸들러 밖에서, 사용자의 일반 조작(버튼 클릭 등)에 반응해 쌓는
  // 정상적인 pushState라 브라우저의 남용 방지 로직에 걸리지 않는다.
  //
  // X버튼/저장 등 뒤로가기가 아닌 방식으로 레이어가 닫히면(diff < 0), 그만큼 쌓아뒀던
  // 히스토리가 안 지워진 채로 남아 찌꺼기가 쌓인다 — 여기서 그만큼 back()으로 직접
  // 되감아 장부를 맞춘다. 이때 발생하는 popstate는 "레이어 닫기"를 또 실행하면 안 되므로
  // skipNextPopRef로 개수를 세어 건너뛴다(진짜 뒤로가기로 인한 감소는 isPopRef로 구분).
  useEffect(() => {
    if (isPopRef.current) { isPopRef.current = false; prevOpenCountRef.current = openCount; return; }
    const diff = openCount - prevOpenCountRef.current;
    if (diff > 0) {
      for (let i = 0; i < diff; i++) window.history.pushState({}, "");
    } else if (diff < 0) {
      skipNextPopRef.current += -diff;
      for (let i = 0; i < -diff; i++) window.history.back();
    }
    prevOpenCountRef.current = openCount;
  });

  useEffect(() => {
    const onPopState = () => {
      if (skipNextPopRef.current > 0) { skipNextPopRef.current -= 1; return; } // 코드가 예약한 되감기 — 무시
      const top = backLayers.find(l => l.open);
      if (top) { isPopRef.current = true; top.close(); }
      // 아무 레이어도 없으면 그냥 뒤로가기가 진행되도록 둔다(앱/탭 종료).
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  });

  // FCM 푸시 — 포그라운드 수신 핸들러 + 이미 허용된 경우 토큰 갱신, 꺼져있으면 확인창으로 켜기 유도 (데모 제외)
  const notifyCheckedRef = useRef(false);
  useEffect(() => {
    if (isDemo || !currentUser?.uid) return;
    // 로컬 개발서버(npm run dev)에서는 알림 유도 팝업이 테스트할 때마다 계속 떠서
    // 방해가 되므로 꺼둠. import.meta.env.DEV는 Vite가 빌드 시점에 결정하므로
    // 실제 배포판(Vercel 프로덕션 빌드)에는 전혀 영향 없음.
    if (import.meta.env.DEV) return;
    // React StrictMode(개발 모드)는 effect를 일부러 두 번 실행해서, 가드 없이는
    // alert/확인창이 두 번 뜸. 한 세션에 한 번만 체크하도록 막음.
    if (notifyCheckedRef.current) return;
    notifyCheckedRef.current = true;
    listenForeground();
    if (typeof Notification === "undefined") return;
    if (Notification.permission === "granted") {
      enablePush(currentUser); // 로그인 시 이 기기 토큰을 현재 사용자 소유로 이전
    } else if (Notification.permission === "denied") {
      // 브라우저에서 이미 차단된 상태 — 다시 요청해도 브라우저가 자동으로 거부하므로
      // 매번 물어보는 대신, 직접 브라우저 설정에서 풀어야 한다고 한 번 안내만 함
      alert("이 브라우저에서 알림이 차단되어 있어요.\n주소창의 🔒 아이콘 → 알림 → 허용으로 바꾼 뒤 새로고침해주세요.");
    } else {
      // window.confirm() 안에서 알림 권한을 요청하면 "사용자가 직접 누른 게 아니다"라고
      // 브라우저가 판단해 네이티브 권한창을 아예 안 띄우고 조용히 default로 무시해버림
      // (실제로 확인해봄). 그래서 confirm 대신 화면에 진짜 버튼을 띄우고, 그 버튼의
      // onClick 안에서 바로 요청해야 브라우저가 정상적으로 권한창을 띄워준다.
      setShowNotifyPrompt(true);
    }
  }, [isDemo, currentUser?.uid]);

  const handleEnableNotify = async () => {
    setNotifyRequesting(true);
    const r = await enablePush(currentUser);
    setNotifyRequesting(false);
    setShowNotifyPrompt(false);
    if (!r.ok) alert("알림을 켜는 데 실패했어요: " + r.reason);
  };

  return (
    <div className={`flex flex-col overflow-hidden bg-white max-w-sm mx-auto relative select-none${isDemo?" pt-9":""}`}
      style={{height:"100svh", touchAction:"pan-x pan-y"}}>
      <style>{ANIM_CSS}</style>
      <TopHeader/>
      {needsSetup && <SetupCompanyModal />}
      {showNotifyPrompt && (
        <div className="absolute inset-0 bg-black/40 z-[110] flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm shadow-2xl">
            <p className="text-base font-bold text-gray-900 mb-5">🔔 알림은 필수예요</p>
            <button onClick={handleEnableNotify} disabled={notifyRequesting}
              className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
              {notifyRequesting ? "요청 중..." : "확인"}
            </button>
          </div>
        </div>
      )}
      <IphoneInstallGuide />
      <PhotoLightbox />
      <RecurringScopeSheet />
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
      {currentScreen === "reg_hub"        && <RegularCleaningHubScreen/>}
      {currentScreen === "reg_sites"      && <SitesScreen/>}
      {currentScreen === "reg_site_detail"&& <SiteDetailScreen/>}
      {currentScreen === "reg_today"      && <TodayStatusScreen/>}
      {currentScreen === "reg_my"         && <MyRegularCleaningScreen/>}
      {currentScreen === "reg_settlement" && <MonthlySettlementScreen/>}
      <SideDrawer/>
      <DetailSheet/>
      <EventModal/>
      <SearchModal/>
      <ExtraCalFilterModal/>
      <EmployeeFormModal/>
      <CompanySettingsModal/>
      <SiteFormModal/>
      <AssignmentFormModal/>
      <ExtraPaymentModal/>
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

  const handleLogout = async () => {
    try { await disablePush(loginUser); } catch { /* 무시 */ } // 이 기기 토큰 제거 → 로그아웃 상태에선 알림 안 옴
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

