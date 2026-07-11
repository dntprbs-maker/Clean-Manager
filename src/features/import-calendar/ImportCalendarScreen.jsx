import { useState } from "react";
import { X, ChevronLeft } from "lucide-react";
import { collection, doc, setDoc, getDocs, updateDoc, query, where } from "firebase/firestore";
import { db } from "../../firebase";
import { useC } from "../../context/AppContext";
import { uid } from "../../lib/uid";

export function ImportCalendarScreen() {
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
