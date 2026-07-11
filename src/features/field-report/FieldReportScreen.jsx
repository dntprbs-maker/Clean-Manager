import { useState, useEffect, useRef } from "react";
import { X, Check } from "lucide-react";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../../firebase";
import { addPendingPhoto } from "../../pendingUploads";
import { fmt, fmtTime } from "../../lib/dateTime";
import { calById } from "../../lib/calendars";
import { useC } from "../../context/AppContext";
import { openLightbox } from "../../components/shared/PhotoLightbox";

// ── 현장 완료 보고 화면 (2단계: 시작 → 완료) ─────────────────────
export function FieldReportScreen({ ev, onClose }) {
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
