import { useMemo, useState } from "react";
import { X, ChevronLeft, Search, ArrowUp, ArrowDown, Link2, RefreshCw } from "lucide-react";
import { collection, doc, setDoc, getDocs, updateDoc, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../firebase";
import { useC } from "../../context/AppContext";
import { uid } from "../../lib/uid";

export function ImportCalendarScreen() {
  const { setCurrentScreen, addEvent, visibleCals: cals, companyId, updateCal } = useC();
  const [step, setStep]                 = useState("upload");
  const [parsedEvents, setParsedEvents] = useState([]);
  const [selectedIds, setSelectedIds]   = useState([]);
  const [selectedCal, setSelectedCal]   = useState("unassigned"); // 팀 배정
  const [fileName, setFileName]         = useState("");
  const [error, setError]               = useState("");
  const [importing, setImporting]       = useState(false);
  const [removedCount, setRemovedCount] = useState(0);
  const [periodFilter, setPeriodFilter] = useState("upcoming"); // upcoming | past1m | past3m | pastAll | all
  const [sortBy, setSortBy]             = useState("date"); // date | title
  const [sortDir, setSortDir]           = useState("asc"); // asc | desc
  const [searchText, setSearchText]     = useState("");

  // 구독 URL 자동 동기화 (구글 캘린더 전용 — 네이버는 구독용 URL 자체를 안 줌)
  const [subCalId, setSubCalId]   = useState(cals[0]?.id || "");
  const subCal = cals.find(c => c.id === subCalId) || null;
  const [subUrlDraft, setSubUrlDraft] = useState(subCal?.icsSubscriptionUrl || "");
  const [subSyncing, setSubSyncing]   = useState(false);
  const [subResult, setSubResult]     = useState("");
  const [subError, setSubError]       = useState("");

  const selectSubCal = (id) => {
    setSubCalId(id);
    setSubUrlDraft(cals.find(c => c.id === id)?.icsSubscriptionUrl || "");
    setSubResult(""); setSubError("");
  };

  const handleSaveAndSyncSubscription = async () => {
    if (!subCal) return;
    const url = subUrlDraft.trim();
    setSubSyncing(true);
    setSubResult(""); setSubError("");
    try {
      // URL 저장은 다른 캘린더 필드 수정과 동일하게 클라이언트에서 바로 씀(updateCal).
      // 실제 요청은 CORS 때문에 브라우저에서 못 하므로 서버(Cloud Function)가 대신 가져온다.
      updateCal({ ...subCal, icsSubscriptionUrl: url });
      if (!url) { setSubSyncing(false); return; } // URL만 지운 경우 동기화는 건너뜀
      const sync = httpsCallable(functions, "syncIcsSubscriptionNow");
      const res = await sync({ companyId, calId: subCal.id });
      const { imported, removed } = res.data || {};
      setSubResult(`${imported ?? 0}개 가져옴${removed ? `, ${removed}개는 구독 쪽에서 사라져 삭제목록으로 정리` : ""}`);
    } catch (e) {
      setSubError(e?.message || "동기화 중 오류가 발생했습니다.");
    } finally {
      setSubSyncing(false);
    }
  };

  const today = new Date().toLocaleDateString("sv-SE");
  // "지난 1개월/3개월" 필터용 기준일 — 오늘에서 n개월 뺀 날짜
  const monthsAgo = (n) => {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return d.toLocaleDateString("sv-SE");
  };
  const cutoff1m = monthsAgo(1);
  const cutoff3m = monthsAgo(3);

  const filteredEvents = useMemo(() => {
    const keyword = searchText.trim().toLocaleLowerCase("ko-KR");
    const dir = sortDir === "desc" ? -1 : 1;
    return parsedEvents
      .map((ev, index) => ({ ev, index }))
      .filter(({ ev }) => {
        if (periodFilter === "upcoming" && ev.start < today) return false;
        if (periodFilter === "past1m" && !(ev.start < today && ev.start >= cutoff1m)) return false;
        if (periodFilter === "past3m" && !(ev.start < today && ev.start >= cutoff3m)) return false;
        if (periodFilter === "pastAll" && ev.start >= today) return false;
        if (!keyword) return true;
        return [ev.title, ev.place, ev.description]
          .some(value => String(value || "").toLocaleLowerCase("ko-KR").includes(keyword));
      })
      .sort((a, b) => {
        if (sortBy === "title") {
          return dir * (a.ev.title || "").localeCompare(b.ev.title || "", "ko-KR");
        }
        const aKey = `${a.ev.start || ""} ${a.ev.startTime || "00:00"}`;
        const bKey = `${b.ev.start || ""} ${b.ev.startTime || "00:00"}`;
        return dir * (aKey.localeCompare(bKey) ||
          (a.ev.title || "").localeCompare(b.ev.title || "", "ko-KR"));
      });
  }, [parsedEvents, periodFilter, searchText, sortBy, sortDir, today, cutoff1m, cutoff3m]);

  const visibleIds = filteredEvents.map(({ index }) => index);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(i => selectedIds.includes(i));

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
      // 오래된 일정까지 무심코 전부 가져오지 않도록 오늘 이후 일정만 기본 선택한다.
      setSelectedIds(parsed.map((event, i) => event.start >= today ? i : null).filter(i => i !== null));
      setPeriodFilter("upcoming");
      setSortBy("date");
      setSearchText("");
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

        {/* 검색·기간·정렬 필터 */}
        <div className="bg-white border-b border-gray-100 px-4 py-3 flex flex-col gap-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={searchText} onChange={e => setSearchText(e.target.value)}
              placeholder="일정 제목·장소·내용 검색"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-9 text-sm outline-none focus:border-blue-400 focus:bg-white"/>
            {searchText && (
              <button onClick={() => setSearchText("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:bg-gray-200">
                <X size={14}/>
              </button>
            )}
          </div>
          {/* 기간 필터 — 칩이 5개라 한 줄에 다 안 들어갈 수 있어 가로 스크롤 허용 */}
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {[
              { key:"upcoming", label:"오늘 이후" },
              { key:"past1m", label:"지난 1개월" },
              { key:"past3m", label:"지난 3개월" },
              { key:"pastAll", label:"지난 일정 전체" },
              { key:"all", label:"전체" },
            ].map(item => (
              <button key={item.key} onClick={() => setPeriodFilter(item.key)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                  periodFilter === item.key
                    ? "bg-blue-600 border-blue-600 text-white"
                    : "bg-white border-gray-200 text-gray-500"
                }`}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-end gap-1.5">
            <select value={sortBy} onChange={e => setSortBy(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs font-bold text-gray-600 outline-none">
              <option value="date">날짜순</option>
              <option value="title">가나다순</option>
            </select>
            <button type="button" onClick={() => setSortDir(d => d === "asc" ? "desc" : "asc")}
              title={sortDir === "asc" ? "오름차순 (탭하면 역순)" : "역순 (탭하면 오름차순)"}
              className="p-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50">
              {sortDir === "asc" ? <ArrowUp size={14}/> : <ArrowDown size={14}/>}
            </button>
          </div>
          <div className="flex items-center justify-between">
            <button
              onClick={() => setSelectedIds(prev => {
                if (allVisibleSelected) return prev.filter(i => !visibleIds.includes(i));
                return [...new Set([...prev, ...visibleIds])];
              })}
              disabled={visibleIds.length === 0}
              className="flex items-center gap-2 text-sm font-bold text-blue-500 disabled:text-gray-300">
              <div className={"w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all " +
                (allVisibleSelected ? "bg-blue-500 border-blue-500" : "border-gray-300")}>
                {allVisibleSelected && <span className="text-white text-xs">✓</span>}
              </div>
              보이는 일정 {allVisibleSelected ? "전체 해제" : "전체 선택"}
            </button>
            <span className="text-xs text-gray-400">{filteredEvents.length}개 표시</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 pb-32">
          {filteredEvents.map(({ ev, index: i }) => {
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
          {filteredEvents.length === 0 && (
            <div className="py-16 text-center text-sm text-gray-400">
              조건에 맞는 일정이 없습니다.
            </div>
          )}
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
        {/* 구독 URL 자동 동기화 — 구글만 가능(구글은 항상 최신 상태를 반환하는 정적 구독 URL을
            제공해서 서버가 주기적으로 다시 받아올 수 있음). 네이버는 이런 URL 자체가 없어서
            여전히 아래 파일 업로드 방식만 지원. */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Link2 size={16} className="text-blue-500"/>
            <h3 className="text-sm font-bold text-gray-700">구독 URL로 자동 동기화 (구글 캘린더)</h3>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed -mt-2">
            구글 캘린더 설정 → 캘린더 공유 → <b>비공개 주소(iCal 형식)</b>의 URL을 붙여넣으면,
            이후엔 파일을 다시 받을 필요 없이 <b>6시간마다 자동으로</b> 최신 일정을 반영해요.
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {cals.map(cal => (
              <button key={cal.id} onClick={() => selectSubCal(cal.id)}
                className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-all"
                style={{background: subCalId===cal.id?cal.color:"white",
                  color: subCalId===cal.id?"white":"#6b7280",
                  borderColor: subCalId===cal.id?cal.color:"#e5e7eb"}}>
                {cal.name}
              </button>
            ))}
          </div>
          {cals.length === 0 && (
            <p className="text-xs text-gray-400">먼저 팀을 하나 이상 만들어야 구독을 연결할 수 있어요.</p>
          )}
          {subCal && (
            <>
              <input value={subUrlDraft} onChange={e => setSubUrlDraft(e.target.value)}
                placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 px-3 text-xs outline-none focus:border-blue-400 focus:bg-white"/>
              <button onClick={handleSaveAndSyncSubscription} disabled={subSyncing}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-white font-bold text-sm disabled:opacity-50"
                style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>
                <RefreshCw size={15} className={subSyncing ? "animate-spin" : ""}/>
                {subSyncing ? "동기화 중..." : "저장하고 지금 동기화"}
              </button>
              {subCal.icsSubscriptionLastSyncAt && (
                <p className="text-[11px] text-gray-400">
                  마지막 자동 동기화: {new Date(subCal.icsSubscriptionLastSyncAt).toLocaleString("ko-KR")}
                </p>
              )}
              {subResult && <p className="text-xs text-green-600 font-semibold">✓ {subResult}</p>}
              {(subError || subCal.icsSubscriptionLastError) && (
                <p className="text-xs text-red-500 font-semibold">⚠️ {subError || subCal.icsSubscriptionLastError}</p>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-gray-300 font-bold">
          <div className="flex-1 h-px bg-gray-100"/>또는<div className="flex-1 h-px bg-gray-100"/>
        </div>

        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-xs text-blue-700 leading-relaxed">
          💡 네이버는 구독용 URL을 제공하지 않아서, .ics 파일을 다시 받아 업로드하는 방식으로 동기화해요.
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
