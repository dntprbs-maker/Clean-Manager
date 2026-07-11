import { useState, useRef } from "react";
import { Search, X, ChevronDown, ChevronLeft, Camera } from "lucide-react";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { storage } from "../../firebase";
import { fmt } from "../../lib/dateTime";
import { useC } from "../../context/AppContext";
import { openLightbox } from "../../components/shared/PhotoLightbox";

export const FAQ_DATA = [
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

export function FaqScreen() {
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

export function ReportHistoryScreen() {
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
