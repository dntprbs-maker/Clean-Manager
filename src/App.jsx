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
import { EmployeeListScreen, EmployeeFormModal, TeamManagementModal } from "./features/employees/EmployeeTeamScreens";
import {
  buildLayout, TextBar, FullMonthCell, DotCell, useDates, ScheduleList, useSwipe,
  SlideTransition, ListTransition, ModeTransition, CalendarView, DetailSheet,
  LongPressMenu, DeleteConfirmPopup, BottomTabBar, SideDrawer, DateTimePicker,
  EventModal, TopHeader, FloatingButtons, SearchModal, ANIM_CSS,
} from "./features/calendar/CalendarCore";

// ── 현장 완료 보고 화면 (2단계: 시작 → 완료) ─────────────────────
function FieldReportScreen({ ev, onClose }) {
  const { currentUser, addReport, updateReport, processPendingUploads, reports, companyId, isDemo } = useC();
  // 이전에 "청소 시작"까지만 하고 나갔던 진행중 보고가 있으면 이어서 재개
  const existingReport = ev ? reports.find(r => r.eventId === ev.id && r.status === "진행중") : null;
  const [step, setStep] = useState(existingReport ? "working" : "start");
  const [startMemo, setStartMemo] = useState(existingReport?.startMemo || "");
  const [endMemo, setEndMemo] = useState("");
  const [startTime, setStartTime] = useState(existingReport?.workStart || "");
  const [reportId, setReportId] = useState(existingReport?.id || null);
  const [showLog, setShowLog] = useState(false);
  const [logs, setLogs] = useState([]);
  const [logDone, setLogDone] = useState(false);
  const [beforePhotos, setBeforePhotos] = useState(existingReport?.beforePhotos || []);
  const [afterPhotos, setAfterPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const beforeInputRef = useRef(null);
  const afterInputRef = useRef(null);
  const logBodyRef = useRef(null);
  const cal = calById(ev?.calId);

  // 마운트 시점엔 진행중 기록이 아직 Firestore에서 안 내려왔을 수 있어 —
  // reports가 나중에 갱신되면 그때라도 다시 확인해서 이어서 재개
  useEffect(() => {
    if (!ev || reportId) return;
    const found = reports.find(r => r.eventId === ev.id && r.status === "진행중");
    if (found) {
      setReportId(found.id);
      setStartMemo(found.startMemo || "");
      setStartTime(found.workStart || "");
      setBeforePhotos(found.beforePhotos || []);
      setStep("working");
    }
  }, [reports, ev?.id, reportId]);

  const pickPhotos = (files, setPhotos) => {
    Promise.all(Array.from(files).map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ name: file.name, data: reader.result });
      reader.readAsDataURL(file);
    }))).then(newPhotos => setPhotos(prev => [...prev, ...newPhotos]));
  };

  const uploadPhotos = async (photos, tag) => Promise.all(photos.map(async (p) => {
    if (p.url) return p;
    const blob = await (await fetch(p.data)).blob();
    const path = `companies/${companyId}/reports/${ev?.id || "misc"}/${tag}/${Date.now()}_${p.name}`;
    const sRef = storageRef(storage, path);
    await uploadBytes(sRef, blob);
    const url = await getDownloadURL(sRef);
    return { name: p.name, url };
  }));

  const handleStart = async () => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    setStartTime(timeStr);
    if (!isDemo) {
      const photosToUpload = beforePhotos;
      try {
        // 사진 업로드를 기다리지 않고 먼저 저장 → 버튼을 누르는 즉시 "청소중" 상태로 전환
        const id = await addReport({
          eventId:   ev?.id || null,
          title:     ev?.title || "",
          date:      ev?.start || fmt(new Date()),
          startTime: ev?.startTime || "",
          calId:     ev?.calId || "",
          teamName:  cal?.label || cal?.name || "",
          teamColor: cal?.color || "#1a56db",
          reporter:  currentUser?.name || "",
          startMemo,
          memo: "",
          beforePhotos: [],
          beforeTotal: photosToUpload.length,
          afterPhotos: [],
          place: ev?.place || "",
          workStart: timeStr,
          workEnd: "",
          status: "진행중",
          createdAt: now.toISOString(),
        });
        setReportId(id);
        if (photosToUpload.length > 0) {
          // 사진을 먼저 로컬(IndexedDB) 대기열에 안전하게 저장한 뒤 백그라운드 업로드 시작 —
          // 탭이 강제 종료돼도 큐에 남아있으므로 앱을 다시 열면 이어서 올라간다.
          (async () => {
            try {
              for (const p of photosToUpload) {
                const blob = await (await fetch(p.data)).blob();
                await addPendingPhoto({ reportId: id, eventId: ev?.id || null, tag: "before", name: p.name, blob });
              }
              processPendingUploads(id);
            } catch (e) {
              console.error("[현장보고] 사진 대기열 저장 실패:", e);
            }
          })();
        }
      } catch (e) {
        alert("청소 시작 정보를 저장하는 중 오류: " + e.message);
        return;
      }
    }
    setStep("working");
  };

  // 청소 전 사진 업로드 진행도 — reports는 실시간(onSnapshot)이라 화면을 나갔다 와도 최신 값이 반영됨
  const liveReport = reportId ? reports.find(r => r.id === reportId) : null;
  const beforeTotal = existingReport?.beforeTotal ?? beforePhotos.length;
  const beforeUploadedCount = liveReport ? (liveReport.beforePhotos || []).length : 0;

  const LOG_ITEMS = [
    { delay: 600, avatar: "📱", avatarBg: "#1e40af", sender: "시스템", senderColor: "#93c5fd",
      text: () => `팀장 ${currentUser.name}님이 완료 전송 버튼을 눌렀습니다.\n현장 데이터를 AI 관리실로 전달합니다.` },
    { delay: 1800, avatar: "🤖", avatarBg: "#92400e", sender: "관리실장 AI", senderColor: "#fcd34d",
      text: () => `현장 피드백 분석 중...\n"${endMemo || "특이사항 없음, 깔끔하게 완료"}"\n✔ 내용 확인 완료. 정밀 보고서를 사장님께 상신합니다.` },
    { delay: 3200, avatar: "💰", avatarBg: "#064e3b", sender: "재무실장 AI", senderColor: "#6ee7b7",
      text: () => `자동 정산 시작.\n→ ${ev?.title} 확정 매출 반영 완료.\n→ 누적 수익률 대시보드 업데이트 성공.` },
    { delay: 4600, avatar: "👑", avatarBg: "#4c1d95", sender: "최종 보고", senderColor: "#a78bfa",
      text: () => `대표님 대시보드에 한 줄 리포트 작성 완료.\n대표님은 퇴근 전 확인만 하시면 됩니다. 😊` },
  ];

  const handleComplete = async () => {
    // 완료 보고를 Firestore(reports)에 저장 → 완료 보고 내역 화면에 실제 반영됨
    let uploadedBefore = beforePhotos, uploadedAfter = afterPhotos;
    if (!isDemo) {
      setUploading(true);
      try {
        if (reportId) {
          // 청소 전 사진은 "청소 시작" 시점부터 이미 백그라운드에서 업로드 중이므로 다시 올리지 않음
          uploadedAfter = await uploadPhotos(afterPhotos, "after");
        } else {
          [uploadedBefore, uploadedAfter] = await Promise.all([
            uploadPhotos(beforePhotos, "before"),
            uploadPhotos(afterPhotos, "after"),
          ]);
        }
      } catch (e) {
        alert("사진 업로드 중 오류: " + e.message);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    const now = new Date();
    const endTimeStr = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
    if (!isDemo) {
      try {
        if (reportId) {
          // 이미 "청소 시작" 단계에서 만들어둔 진행중 문서를 완료 처리로 이어서 갱신
          await updateReport(reportId, {
            memo: endMemo,
            afterPhotos: uploadedAfter,
            workEnd: endTimeStr,
            status: "완료",
          });
        } else {
          await addReport({
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
            beforePhotos: uploadedBefore,
            afterPhotos:  uploadedAfter,
            place:     ev?.place || "",
            workStart: startTime,
            workEnd:   endTimeStr,
            status:    "완료",
            createdAt: now.toISOString(),
          });
        }
      } catch (e) {
        alert("완료 보고 저장 중 오류가 발생했습니다. 다시 시도해주세요.\n" + e.message);
        return;
      }
    }

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
          <span className="font-bold text-white text-base">{step === "start" ? "청소 시작 보고" : "청소 완료 보고"}</span>
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
        <div className="flex-1 overflow-y-auto px-4 py-2 pb-24 flex flex-col gap-4">
          <div className="flex items-center gap-2 py-2">
            <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-white text-xs font-bold">1</div>
            <span className="font-bold text-gray-800 text-sm">현장 도착 확인 · 청소 전 사진</span>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">
              📸 청소 전 사진 (Before){beforePhotos.length > 0 && ` · ${beforePhotos.length}장 첨부됨`}
            </p>
            <input ref={beforeInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) pickPhotos(e.target.files, setBeforePhotos); e.target.value = ""; }}/>
            {beforePhotos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto mb-2 pb-1">
                {beforePhotos.map((p, i) => (
                  <div key={i} className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden border border-gray-200">
                    <img src={p.url || p.data} alt={p.name}
                      onClick={() => openLightbox(beforePhotos.map(x=>x.url||x.data), i)}
                      className="w-full h-full object-cover cursor-pointer"/>
                    <button onClick={() => setBeforePhotos(prev => prev.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center">
                      <X size={10} className="text-white"/>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="border-2 border-dashed border-blue-200 rounded-2xl p-6 text-center bg-blue-50/50 cursor-pointer"
              onClick={() => beforeInputRef.current?.click()}>
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm text-gray-400 font-medium">청소 전 사진 첨부</p>
              <p className="text-xs text-blue-300 mt-1">JPG / PNG</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">✍️ 도착 시 특이사항</p>
            <textarea value={startMemo} onChange={e => setStartMemo(e.target.value)}
              placeholder="예: 현관 비밀번호 1234, 3층 엘리베이터 없음"
              className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-800 outline-none resize-none bg-gray-50 placeholder-gray-300"
              rows={3}/>
          </div>
          <div className="h-4"/>
        </div>
      )}

      {/* STEP 2: 완료 보고 */}
      {step === "working" && !showLog && (
        <div className="flex-1 overflow-y-auto px-4 py-2 pb-24 flex flex-col gap-4">
          <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-xl border border-blue-100">
            <span className="text-blue-500 text-sm font-bold">✅ 청소 시작됨</span>
            <span className="text-xs text-gray-400 ml-auto">{startTime} 시작</span>
          </div>

          {/* 청소 전 사진 백그라운드 업로드 진행도 — 화면을 나갔다 와도 최신 진행 상황이 그대로 보임 */}
          {beforeTotal > 0 && beforeUploadedCount < beforeTotal && (
            <div className="px-3 py-2 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xs font-bold text-gray-500 mb-2">
                📤 청소 전 사진 업로드 중 ({beforeUploadedCount}/{beforeTotal})
              </p>
              {beforePhotos.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {beforePhotos.map((p, i) => (
                    <div key={i} className="relative w-14 h-14 shrink-0 rounded-lg overflow-hidden border border-gray-200">
                      <img src={p.url || p.data} alt="" className="w-full h-full object-cover"/>
                      {i < beforeUploadedCount ? (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
                          <Check size={18} className="text-white" strokeWidth={3}/>
                        </div>
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/10">
                          <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"/>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 py-2">
            <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center text-white text-xs font-bold">2</div>
            <span className="font-bold text-gray-800 text-sm">청소 완료 · 사진 및 보고</span>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">
              📸 청소 후 사진 (After){afterPhotos.length > 0 && ` · ${afterPhotos.length}장 첨부됨`}
            </p>
            <input ref={afterInputRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { if (e.target.files?.length) pickPhotos(e.target.files, setAfterPhotos); e.target.value = ""; }}/>
            {afterPhotos.length > 0 && (
              <div className="flex gap-2 overflow-x-auto mb-2 pb-1">
                {afterPhotos.map((p, i) => (
                  <div key={i} className="relative w-20 h-20 shrink-0 rounded-xl overflow-hidden border border-gray-200">
                    <img src={p.url || p.data} alt={p.name}
                      onClick={() => openLightbox(afterPhotos.map(x=>x.url||x.data), i)}
                      className="w-full h-full object-cover cursor-pointer"/>
                    <button onClick={() => setAfterPhotos(prev => prev.filter((_, j) => j !== i))}
                      className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/50 rounded-full flex items-center justify-center">
                      <X size={10} className="text-white"/>
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="border-2 border-dashed border-green-200 rounded-2xl p-6 text-center bg-green-50/50 cursor-pointer"
              onClick={() => afterInputRef.current?.click()}>
              <div className="text-3xl mb-2">📷</div>
              <p className="text-sm text-gray-400 font-medium">청소 후 사진 첨부</p>
              <p className="text-xs text-green-300 mt-1">JPG / PNG</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-bold text-gray-500 mb-2">✍️ 현장 특이사항 메모</p>
            <textarea value={endMemo} onChange={e => setEndMemo(e.target.value)}
              placeholder="예: 싱크대 오염 심했는데 다 지웠고 가스레인지 탈거 청소함"
              className="w-full border border-gray-200 rounded-xl p-3 text-sm text-gray-800 outline-none resize-none bg-gray-50 placeholder-gray-300"
              rows={3}/>
          </div>
          <div className="h-4"/>
        </div>
      )}

      {/* 청소 시작 보고 / 청소 완료 전송 버튼 — 스크롤과 무관하게 항상 화면 하단에 고정 */}
      {((step === "start") || (step === "working" && !showLog)) && (
        <div className="shrink-0 px-4 py-3 border-t border-gray-100 bg-white">
          {step === "start" ? (
            <button onClick={() => { if (window.confirm("청소를 시작하시겠습니까?")) handleStart(); }}
              className="w-full py-4 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(135deg, #1a56db 0%, #2563eb 100%)" }}>
              🚀 청소 시작 보고
            </button>
          ) : (
            <button onClick={() => { if (window.confirm("청소 완료로 전송하시겠습니까?")) handleComplete(); }} disabled={uploading}
              className="w-full py-4 rounded-2xl text-white font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #16a34a 0%, #15803d 100%)" }}>
              {uploading ? "사진 업로드 중..." : "✔ 청소 완료 전송"}
            </button>
          )}
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
        <h2 className="font-bold text-base">사용설명서</h2>
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
  const { setCurrentScreen, reports, currentUser, updateReport, companyId, isDemo } = useC();

  // 현장 완료 보고에서 저장된 실제 데이터 (Firestore reports)
  const sampleReports = reports;

  const [selected, setSelected] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter]   = useState("전체");
  const [teamFilter, setTeamFilter]   = useState("전체");
  const [showSearch, setShowSearch]   = useState(false);
  const [viewMode, setViewMode]       = useState("list"); // "list" | "gallery"

  // 사장(최고관리자)만 완료 보고 내용을 수정 가능
  const canEdit = currentUser.role === "최고관리자";
  const [editing, setEditing]         = useState(false);
  const [editStartMemo, setEditStartMemo] = useState("");
  const [editMemo, setEditMemo]       = useState("");
  const [editPrice, setEditPrice]     = useState("");
  const [editBefore, setEditBefore]   = useState([]);
  const [editAfter, setEditAfter]     = useState([]);
  const [saving, setSaving]           = useState(false);
  const beforeInputRef = useRef(null);
  const afterInputRef  = useRef(null);

  const startEdit = () => {
    setEditStartMemo(selected.startMemo || "");
    setEditMemo(selected.memo || "");
    setEditPrice(selected.price || "");
    setEditBefore(selected.beforePhotos || []);
    setEditAfter(selected.afterPhotos || []);
    setEditing(true);
  };

  const pickPhotos = (files, setPhotos) => {
    Promise.all(Array.from(files).map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve({ name: file.name, data: reader.result });
      reader.readAsDataURL(file);
    }))).then(newPhotos => setPhotos(prev => [...prev, ...newPhotos]));
  };

  const uploadEditPhotos = async (photos, tag) => Promise.all(photos.map(async (p) => {
    if (p.url) return p;
    const blob = await (await fetch(p.data)).blob();
    const path = `companies/${companyId}/reports/${selected.eventId || "misc"}/${tag}/${Date.now()}_${p.name}`;
    const sRef = storageRef(storage, path);
    await uploadBytes(sRef, blob);
    const url = await getDownloadURL(sRef);
    return { name: p.name, url };
  }));

  const saveEdit = async () => {
    setSaving(true);
    try {
      const [uploadedBefore, uploadedAfter] = isDemo
        ? [editBefore, editAfter]
        : await Promise.all([uploadEditPhotos(editBefore, "before"), uploadEditPhotos(editAfter, "after")]);
      const patch = {
        startMemo: editStartMemo,
        memo: editMemo,
        price: editPrice,
        beforePhotos: uploadedBefore,
        afterPhotos: uploadedAfter,
      };
      if (!isDemo) await updateReport(selected.id, patch);
      setSelected(prev => ({ ...prev, ...patch }));
      setEditing(false);
    } catch (e) {
      alert("저장 중 오류: " + e.message);
    }
    setSaving(false);
  };

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
    const viewBefore = editing ? editBefore : (selected.beforePhotos||[]);
    const viewAfter  = editing ? editAfter  : (selected.afterPhotos||[]);
    return (
      <div className="flex-1 overflow-y-auto bg-white flex flex-col">
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 border-b border-gray-100">
          <button onClick={()=>{ if(editing){ setEditing(false); } else { setSelected(null); } }} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <h2 className="text-base font-bold text-gray-900 flex-1 line-clamp-1">{selected.title}</h2>
          {canEdit && !editing && (
            <button onClick={startEdit} className="text-xs font-bold text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-50">수정</button>
          )}
          {editing && (
            <button onClick={saveEdit} disabled={saving}
              className="text-xs font-bold text-white bg-blue-600 px-3 py-1.5 rounded-lg disabled:opacity-50">
              {saving ? "저장 중..." : "저장"}
            </button>
          )}
        </div>
        <div className="px-5 py-4 flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full" style={{background:selected.teamColor}}/>
            <span className="text-sm font-bold" style={{color:selected.teamColor}}>{selected.teamName}</span>
            <span className="text-sm text-gray-400">·</span>
            <span className="text-sm text-gray-400">{selected.date} {selected.startTime}</span>
          </div>
          <div className="h-px bg-gray-100"/>

          {(editing || selected.startMemo) && (
            <div>
              <p className="text-xs font-bold text-gray-400 mb-2">도착시 특이사항</p>
              {editing ? (
                <textarea value={editStartMemo} onChange={e=>setEditStartMemo(e.target.value)} rows={2}
                  className="w-full text-sm p-3 rounded-xl border border-gray-200 outline-none focus:border-blue-400"/>
              ) : (
                <p className="text-sm text-gray-700 leading-relaxed">{selected.startMemo}</p>
              )}
            </div>
          )}

          <div>
            <p className="text-xs font-bold text-gray-400 mb-2">완료 메모</p>
            {editing ? (
              <textarea value={editMemo} onChange={e=>setEditMemo(e.target.value)} rows={3}
                className="w-full text-sm p-3 rounded-xl border border-gray-200 outline-none focus:border-blue-400"/>
            ) : (
              <p className="text-sm text-gray-700 leading-relaxed">{selected.memo}</p>
            )}
          </div>

          {(selected.price || editing) && (
            <div className="bg-gray-50 rounded-2xl p-4 flex items-center justify-between">
              <span className="text-sm font-bold text-gray-500">청소 금액</span>
              {editing ? (
                <input value={editPrice} onChange={e=>setEditPrice(e.target.value)} placeholder="금액 입력"
                  className="text-base font-extrabold text-blue-600 text-right w-32 bg-transparent outline-none border-b border-gray-300"/>
              ) : (
                <span className="text-base font-extrabold text-blue-600">{selected.price}원</span>
              )}
            </div>
          )}

          <div className="flex flex-col gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-400">Before</p>
                {editing && (
                  <button onClick={()=>beforeInputRef.current?.click()} className="text-xs font-bold text-blue-600">+ 추가</button>
                )}
              </div>
              <input ref={beforeInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e=>{ pickPhotos(e.target.files, setEditBefore); e.target.value=""; }}/>
              {viewBefore.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {viewBefore.map((p,i)=>(
                    <div key={i} className="relative w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-gray-100">
                      <button onClick={()=>{ if(!editing) openLightbox(viewBefore.map(x=>x.url), i); }} className="w-full h-full block">
                        <img src={p.url||p.data} alt="" className="w-full h-full object-cover"/>
                      </button>
                      {editing && (
                        <button onClick={()=>setEditBefore(prev=>prev.filter((_,idx)=>idx!==i))}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-100 rounded-2xl p-4 text-center">
                  <p className="text-2xl">📷</p>
                  <p className="text-xs text-gray-300 mt-1">사진 없음</p>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs text-gray-400">After</p>
                {editing && (
                  <button onClick={()=>afterInputRef.current?.click()} className="text-xs font-bold text-blue-600">+ 추가</button>
                )}
              </div>
              <input ref={afterInputRef} type="file" accept="image/*" multiple className="hidden"
                onChange={e=>{ pickPhotos(e.target.files, setEditAfter); e.target.value=""; }}/>
              {viewAfter.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {viewAfter.map((p,i)=>(
                    <div key={i} className="relative w-24 h-24 shrink-0 rounded-xl overflow-hidden bg-gray-100">
                      <button onClick={()=>{ if(!editing) openLightbox(viewAfter.map(x=>x.url), i); }} className="w-full h-full block">
                        <img src={p.url||p.data} alt="" className="w-full h-full object-cover"/>
                      </button>
                      {editing && (
                        <button onClick={()=>setEditAfter(prev=>prev.filter((_,idx)=>idx!==i))}
                          className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center">✕</button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-100 rounded-2xl p-4 text-center">
                  <p className="text-2xl">📷</p>
                  <p className="text-xs text-gray-300 mt-1">사진 없음</p>
                </div>
              )}
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
          {/* 목록/갤러리 전환 */}
          <div className="flex items-center bg-gray-100 rounded-xl p-0.5 mr-1">
            <button onClick={()=>setViewMode("list")}
              className="px-2.5 h-8 rounded-lg text-xs font-bold transition-all"
              style={{background:viewMode==="list"?"white":"transparent", color:viewMode==="list"?"#111827":"#9ca3af",
                boxShadow:viewMode==="list"?"0 1px 2px rgba(0,0,0,.08)":"none"}}>
              목록
            </button>
            <button onClick={()=>setViewMode("gallery")}
              className="px-2.5 h-8 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
              style={{background:viewMode==="gallery"?"white":"transparent", color:viewMode==="gallery"?"#111827":"#9ca3af",
                boxShadow:viewMode==="gallery"?"0 1px 2px rgba(0,0,0,.08)":"none"}}>
              <Camera size={12}/> 갤러리
            </button>
          </div>
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

      {/* 목록 / 갤러리 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-5">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📭</div>
            <p className="text-sm font-bold">해당 내역이 없습니다</p>
            {searchQuery && <p className="text-xs mt-2">"{searchQuery}" 검색 결과 없음</p>}
          </div>
        ) : viewMode === "gallery" ? (
          (() => {
            const totalPhotos = dates.reduce((sum, d) =>
              sum + grouped[d].reduce((s, r) => s + (r.beforePhotos||[]).length + (r.afterPhotos||[]).length, 0), 0);
            if (totalPhotos === 0) {
              return (
                <div className="text-center py-16 text-gray-400">
                  <div className="text-4xl mb-3">📷</div>
                  <p className="text-sm font-bold">첨부된 사진이 없습니다</p>
                </div>
              );
            }
            return dates.map(date => {
              const dayPhotos = grouped[date].flatMap(r => [
                ...(r.beforePhotos||[]).map(p => ({ ...p, tag: "전", report: r })),
                ...(r.afterPhotos||[]).map(p => ({ ...p, tag: "후", report: r })),
              ]);
              if (!dayPhotos.length) return null;
              return (
                <div key={date}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-bold text-gray-700">{dateLabel(date)}</span>
                    <div className="flex-1 h-px bg-gray-200"/>
                    <span className="text-xs text-gray-400">{dayPhotos.length}장</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {dayPhotos.map((p, i) => (
                      <button key={i} onClick={()=>openLightbox(dayPhotos.map(x=>x.url), i)}
                        className="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
                        <img src={p.url} alt="" className="w-full h-full object-cover"/>
                        <span className="absolute bottom-1 left-1 text-[9px] font-bold text-white bg-black/50 px-1.5 py-0.5 rounded-full">
                          {p.tag} · {p.report.teamName}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            });
          })()
        ) : dates.map(date=>(
          <div key={date}>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-bold text-gray-700">{dateLabel(date)}</span>
              <div className="flex-1 h-px bg-gray-200"/>
              <span className="text-xs text-gray-400">{grouped[date].length}건</span>
            </div>
            <div className="flex flex-col gap-2">
              {grouped[date].map(r=>(
                <button key={r.id} onClick={()=>{ setSelected(r); setEditing(false); }}
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
  const { setCurrentScreen, addEvent, visibleCals: cals, companyId } = useC();
  const [step, setStep]                 = useState("upload");
  const [parsedEvents, setParsedEvents] = useState([]);
  const [selectedIds, setSelectedIds]   = useState([]);
  const [selectedCal, setSelectedCal]   = useState("unassigned"); // 팀 배정
  const [fileName, setFileName]         = useState("");
  const [error, setError]               = useState("");
  const [importing, setImporting]       = useState(false);
  const [removedCount, setRemovedCount] = useState(0);

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

    // 이 파일(전체 파싱 결과)에 더 이상 없는, 이전에 같은 방식으로 가져온 일정은
    // 네이버 쪽에서 삭제/이동된 것으로 보고 정리(소프트 삭제)
    // 단, 파일에 UID가 하나도 없으면(손상/형식이 다른 파일) 전체 삭제로 오인할 수 있어 건너뜀
    const newUidSet = new Set(parsedEvents.map(ev => ev.icsUid).filter(Boolean));
    const prevImported = newUidSet.size > 0
      ? await getDocs(query(collection(db, "companies", companyId, "events"), where("source", "==", "ics_import")))
      : { docs: [] };
    const staleDocs = prevImported.docs.filter(d => d.data().status !== "deleted" && !newUidSet.has(d.id));
    const deletedAt = new Date().toISOString();
    await Promise.all(staleDocs.map(d =>
      updateDoc(doc(db, "companies", companyId, "events", d.id), { status: "deleted", deletedAt, deletedBy: "ics_sync" })
    ));

    await Promise.all(toImport.map(ev => {
      // icsUid가 있으면 그걸 문서 ID로 써서 재동기화 시 같은 일정을 덮어쓰기
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
      if (ev.icsUid) evData.source = "ics_import";
      delete evData.icsUid;
      return setDoc(doc(db, "companies", companyId, "events", docId), evData, { merge: true });
    }));
    setRemovedCount(staleDocs.length);
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
        <h2 className="text-xl font-bold text-gray-900 mb-2">동기화 완료!</h2>
        <p className="text-sm text-gray-500 mb-8">
          {selectedIds.length}개 일정을 반영했어요.
          {removedCount > 0 && <><br/>네이버에서 사라진 {removedCount}개는 삭제목록으로 정리했어요.</>}
        </p>
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
        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-xs text-blue-700 leading-relaxed">
          💡 네이버는 실시간 자동 동기화용 구독 링크를 제공하지 않아서, .ics 파일을 다시 받아 업로드하는 방식으로 동기화해요.
          같은 파일을 다시 올리면 바뀐 내용은 갱신되고, 네이버에서 삭제된 일정은 자동으로 삭제목록으로 정리돼요.
        </div>
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
      // AI 추출 등 부가 기능은 전부 기본 OFF — 요금제에 따라 슈퍼어드민에서 개별로 켜줌
      await setDoc(doc(db,"companies",companyId), {
        name:"내 회사", companyId, createdAt:new Date().toISOString(),
        aiTextExtraction: false, aiImageExtraction: false,
      });
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

// ── 아이폰 홈 화면 추가 안내 배너 ───────────────────────────────────
function IphoneInstallGuide() {
  const [closed, setClosed] = useState(false);

  // 강제 미리보기: 주소 뒤에 #iphonebanner 붙이면 어떤 기기에서도 표시
  const forcePreview = typeof window !== "undefined" && window.location.hash.includes("iphonebanner");

  const isIOS = typeof navigator !== "undefined" &&
    /iPad|iPhone|iPod/.test(navigator.userAgent);
  // 이미 홈 화면 앱으로 실행 중이면 안내 불필요
  const isStandalone = typeof window !== "undefined" &&
    (window.navigator.standalone === true ||
     window.matchMedia?.("(display-mode: standalone)")?.matches);
  // 이 세션에서 이미 닫았으면 다시 안 띄움
  const dismissed = typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem("iphoneGuideDismissed") === "1";

  // 닫기(closed)를 최우선으로 — 미리보기 모드에서도 X 누르면 닫힘
  const show = !closed && (forcePreview || (isIOS && !isStandalone && !dismissed));
  if (!show) return null;

  const close = () => {
    setClosed(true);
    // 미리보기(#iphonebanner) 상태면 해시 제거해서 다시 안 뜨게
    if (forcePreview) { try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch {} }
    try { sessionStorage.setItem("iphoneGuideDismissed", "1"); } catch {}
  };

  return (
    <div className="fixed inset-0 z-[500] flex items-end justify-center bg-black/50" onClick={close}>
      <div className="w-full max-w-sm bg-white rounded-t-3xl p-6 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-extrabold text-gray-900">📱 알림 받기 설정</h2>
          <button onClick={close} className="p-1 text-gray-400"><X size={22}/></button>
        </div>
        <p className="text-sm text-gray-500 mb-5 leading-relaxed">
          아이폰은 <span className="font-bold text-gray-800">홈 화면에 추가</span>해야<br/>
          청소 일정 알림을 받을 수 있어요. 아래 순서대로 해주세요!
        </p>

        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 bg-gray-50 rounded-2xl p-4">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">1</div>
            <p className="text-sm text-gray-800">
              사파리 아래쪽 <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-blue-100 text-blue-600 font-bold align-middle">⬆️</span> <span className="font-bold">공유 버튼</span>을 누르세요
            </p>
          </div>
          <div className="flex items-center gap-3 bg-gray-50 rounded-2xl p-4">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">2</div>
            <p className="text-sm text-gray-800">
              메뉴에서 <span className="font-bold">"홈 화면에 추가"</span>를 누르세요
            </p>
          </div>
          <div className="flex items-center gap-3 bg-gray-50 rounded-2xl p-4">
            <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center shrink-0">3</div>
            <p className="text-sm text-gray-800">
              홈 화면에 생긴 <span className="font-bold">🧹 클린메니져 아이콘</span>으로 다시 열어주세요
            </p>
          </div>
        </div>

        <div className="mt-5 bg-amber-50 border border-amber-100 rounded-2xl p-3">
          <p className="text-xs text-amber-700 leading-relaxed">
            ⚠️ 이렇게 안 하면 아이폰에서는 알림이 오지 않아요.<br/>
            잘 모르겠으면 팀장님께 도움을 요청하세요.
          </p>
        </div>

        <button onClick={close}
          className="w-full mt-4 py-3.5 rounded-2xl text-sm font-bold text-gray-500 bg-gray-100">
          나중에 하기
        </button>
      </div>
    </div>
  );
}

function AppInner() {
  const { currentScreen, setCurrentScreen, currentUser, isDemo } = useC();
  const needsSetup = !isDemo && !currentUser?.companyName;
  const [showNotifyPrompt, setShowNotifyPrompt] = useState(false);
  const [notifyRequesting, setNotifyRequesting] = useState(false);

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
      style={{height:"100dvh"}}>
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
      <EmployeeFormModal/>
      <TeamManagementModal/>
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

// ── 팀별 일정 화면 ───────────────────────────────────────────────
function TeamScheduleScreen() {
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

function DashboardScreen() {
  const { visibleEvents, setCurrentScreen, visibleCals: cals, currentUser } = useC();
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

