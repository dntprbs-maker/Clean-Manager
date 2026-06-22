/**
 * SuperAdmin.jsx — 클린메니져 DB 전용 마스터 관리자 페이지
 * 접속: http://localhost:5173/Clean-Manager/#superadmin
 */
import { useState, useEffect, useCallback } from "react";
import {
  collection, getDocs, doc, deleteDoc, updateDoc, addDoc
} from "firebase/firestore";
import { db } from "./firebase";
import * as XLSX from "xlsx";

// ── 헬퍼 ──────────────────────────────────────────────────────
const PW_KEY = "superadmin_pw";
const getSavedPw = () => localStorage.getItem(PW_KEY) || null;
const savePw    = pw => localStorage.setItem(PW_KEY, pw);

function displayVal(v) {
  if (v === null || v === undefined) return "-";
  if (v && typeof v === "object" && typeof v.seconds === "number" && typeof v.nanoseconds === "number") {
    return new Date(v.seconds * 1000).toLocaleString();
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// ── 탭 정의 ───────────────────────────────────────────────────
const TABS = [
  { id: "events",    label: "📅 일정",      group: "test" },
  { id: "notices",   label: "📢 공지사항",  group: "test" },
  { id: "logs",      label: "📋 변경로그",  group: "test" },
  { id: "companies", label: "🏢 회사목록",  group: "ops"  },
  { id: "staffs",    label: "👤 직원목록",  group: "ops"  },
  { id: "admins",    label: "🔑 관리자목록",group: "ops"  },
];

// ── 탭별 숨길 컬럼 & 컬럼 순서 설정 ──────────────────────────
const TAB_COL_CONFIG = {
  // companies: companyId 숨기고, name → createdAt 순서
  companies: {
    hidden: ["companyId"],
    order:  ["name", "createdAt", "logoUrl"],
  },
  // staffs: 내부 id류 숨기기
  staffs: {
    hidden: ["companyId", "_companyId", "id"],
    order:  ["_company", "name", "team", "role", "pw", "email", "createdAt"],
  },
  admins: {
    hidden: ["companyId", "_companyId", "id"],
    order:  ["_company", "name", "team", "role", "pw", "email", "createdAt"],
  },
  events: {
    hidden: [],
    order:  ["_company", "title", "start", "end", "allDay", "startTime", "endTime", "place", "description", "calId", "repeat"],
  },
  notices: {
    hidden: [],
    order:  ["_company", "title", "body", "author", "date", "important"],
  },
  logs: {
    hidden: [],
    order:  ["_company", "action", "user", "detail", "at"],
  },
};

// ── 컬럼 목록 생성 (숨김·순서 적용) ─────────────────────────
function buildColumns(rows, tabId) {
  if (!rows.length) return [];
  const cfg    = TAB_COL_CONFIG[tabId] || { hidden: [], order: [] };
  const hidden = new Set(["_id", "_path", ...cfg.hidden]);
  const all    = Object.keys(rows[0]).filter(k => !hidden.has(k));

  // cfg.order 에 있는 것 먼저, 나머지는 뒤에
  const ordered = [
    ...cfg.order.filter(k => all.includes(k)),
    ...all.filter(k => !cfg.order.includes(k)),
  ];
  return ordered;
}

// ── Firebase 데이터 로더 ──────────────────────────────────────
async function loadData(tabId) {
  const rows = [];
  
  // 먼저 회사 목록을 불러와서 매핑 딕셔너리와 리스트 생성
  const compSnap = await getDocs(collection(db, "companies"));
  const compMap = {};
  const compList = [];
  compSnap.forEach(d => {
    compMap[d.id] = d.data().name || d.id;
    compList.push({ id: d.id, name: d.data().name || d.id });
  });

  if (tabId === "companies") {
    compSnap.forEach(d => rows.push({ _id: d.id, _path: `companies/${d.id}`, _companyId: d.id, ...d.data() }));

  } else if (tabId === "staffs") {
    const snap = await getDocs(collection(db, "staffs"));
    snap.forEach(d => rows.push({ 
      _id: d.id, _path: `staffs/${d.id}`, 
      _companyId: d.data().companyId, _company: compMap[d.data().companyId] || d.data().companyId, 
      ...d.data() 
    }));

  } else if (tabId === "admins") {
    const snap = await getDocs(collection(db, "admins"));
    snap.forEach(d => rows.push({ 
      _id: d.id, _path: `admins/${d.id}`, 
      _companyId: d.data().companyId, _company: compMap[d.data().companyId] || d.data().companyId, 
      ...d.data() 
    }));

  } else if (tabId === "events") {
    for (const compDoc of compSnap.docs) {
      const evSnap = await getDocs(collection(db, "companies", compDoc.id, "events"));
      evSnap.forEach(d => rows.push({
        _id: d.id,
        _path: `companies/${compDoc.id}/events/${d.id}`,
        _companyId: compDoc.id,
        _company: compMap[compDoc.id],
        ...d.data(),
      }));
    }

  } else if (tabId === "notices") {
    for (const compDoc of compSnap.docs) {
      const nSnap = await getDocs(collection(db, "companies", compDoc.id, "notices"));
      nSnap.forEach(d => rows.push({
        _id: d.id,
        _path: `companies/${compDoc.id}/notices/${d.id}`,
        _companyId: compDoc.id,
        _company: compMap[compDoc.id],
        ...d.data(),
      }));
    }

  } else if (tabId === "logs") {
    for (const compDoc of compSnap.docs) {
      const lSnap = await getDocs(collection(db, "companies", compDoc.id, "activityLogs"));
      lSnap.forEach(d => rows.push({
        _id: d.id,
        _path: `companies/${compDoc.id}/activityLogs/${d.id}`,
        _companyId: compDoc.id,
        _company: compMap[compDoc.id],
        ...d.data(),
      }));
    }
  }
  return { rows, compList };
}

// ── 엑셀 다운로드 ─────────────────────────────────────────────
function downloadExcel(rows, tabId) {
  if (!rows.length) return alert("다운로드할 데이터가 없습니다.");
  const filtered = rows.map(r => { const o = {...r}; delete o._path; return o; });
  const ws = XLSX.utils.json_to_sheet(filtered);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, tabId);
  XLSX.writeFile(wb, `cleanmanager_${tabId}_${new Date().toISOString().slice(0,10)}.xlsx`);
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────
export default function SuperAdmin() {
  const savedPw = getSavedPw();
  // 개발 편의를 위해 임시로 기본 상태를 'unlocked'로 고정
  const [authState, setAuthState]       = useState("unlocked");
  const [pwInput, setPwInput]           = useState("");
  const [pwError, setPwError]           = useState("");
  const [showChangePw, setShowChangePw] = useState(false);
  const [newPw, setNewPw]               = useState("");
  const [newPwConfirm, setNewPwConfirm] = useState("");
  const [showPwText, setShowPwText]     = useState(false);

  const [activeTab, setActiveTab]       = useState("events");
  const [rows, setRows]                 = useState([]);
  const [loading, setLoading]           = useState(false);
  const [editRow, setEditRow]           = useState(null);
  const [editData, setEditData]         = useState({});
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [searchTerm, setSearchTerm]     = useState("");
  const [companyOptions, setCompanyOptions] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState("ALL");
  const [isAdding, setIsAdding]         = useState(false);
  const [addData, setAddData]           = useState({});
  const [addCompanyId, setAddCompanyId] = useState("");

  // 탭 데이터 로드
  const loadTab = useCallback(async (tabId) => {
    setLoading(true); setRows([]); setSearchTerm(""); setSelectedCompanyId("ALL");
    try { 
      const res = await loadData(tabId);
      setRows(res.rows); 
      setCompanyOptions(res.compList);
    }
    catch (e) { alert("데이터 로드 실패: " + e.message); }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (authState === "unlocked") loadTab(activeTab);
  }, [authState, activeTab, loadTab]);

  // ── 인증 ──
  function handleSetup() {
    if (!pwInput || pwInput.length < 4) { setPwError("비밀번호는 4자 이상으로 설정해주세요."); return; }
    savePw(pwInput); setPwInput(""); setPwError(""); setAuthState("unlocked");
  }
  function handleLogin() {
    if (pwInput === getSavedPw()) { setPwInput(""); setPwError(""); setAuthState("unlocked"); }
    else setPwError("비밀번호가 틀렸습니다. 다시 입력해주세요.");
  }
  function handleChangePw() {
    if (!newPw || newPw.length < 4) { setPwError("새 비밀번호는 4자 이상이어야 합니다."); return; }
    if (newPw !== newPwConfirm) { setPwError("새 비밀번호가 일치하지 않습니다."); return; }
    savePw(newPw); setNewPw(""); setNewPwConfirm(""); setPwError(""); setShowChangePw(false);
    alert("✅ 비밀번호가 성공적으로 변경되었습니다!");
  }

  // ── 삭제 ──
  async function handleDelete(row) {
    try {
      const parts = row._path.split("/");
      if (parts.length === 2) await deleteDoc(doc(db, parts[0], parts[1]));
      else if (parts.length === 4) await deleteDoc(doc(db, parts[0], parts[1], parts[2], parts[3]));
      else if (parts.length === 6) await deleteDoc(doc(db, parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]));
      setRows(prev => prev.filter(r => r._id !== row._id));
      setDeleteTarget(null);
    } catch (e) { alert("삭제 실패: " + e.message); }
  }

  // ── 수정 ──
  function startEdit(row) {
    const data = { ...row };
    delete data._id; delete data._path; delete data._company; delete data._companyId;
    setEditData(data); setEditRow(row);
  }
  async function handleSave() {
    try {
      const parts = editRow._path.split("/");
      let docRef;
      if (parts.length === 2) docRef = doc(db, parts[0], parts[1]);
      else if (parts.length === 4) docRef = doc(db, parts[0], parts[1], parts[2], parts[3]);
      else if (parts.length === 6) docRef = doc(db, parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]);
      await updateDoc(docRef, editData);
      setRows(prev => prev.map(r => r._id === editRow._id ? { ...r, ...editData } : r));
      setEditRow(null); setEditData({});
    } catch (e) { alert("수정 실패: " + e.message); }
  }

  // ── 추가 ──
  function startAdd() {
    setAddData({});
    setAddCompanyId(selectedCompanyId !== "ALL" ? selectedCompanyId : (companyOptions[0]?.id || ""));
    setIsAdding(true);
  }
  async function handleAddSave() {
    try {
      const now = new Date().toISOString();
      if (activeTab === "companies") {
        await addDoc(collection(db, "companies"), { ...addData, createdAt: now });
      } else if (activeTab === "staffs" || activeTab === "admins") {
        if (!addCompanyId) return alert("소속 회사를 선택해주세요.");
        await addDoc(collection(db, activeTab), { ...addData, companyId: addCompanyId, createdAt: now });
      } else {
        if (!addCompanyId) return alert("소속 회사를 선택해주세요.");
        await addDoc(collection(db, "companies", addCompanyId, activeTab), { ...addData, createdAt: now });
      }
      setIsAdding(false);
      setAddData({});
      loadTab(activeTab); // 새로고침해서 반영
      alert("✅ 성공적으로 등록되었습니다!");
    } catch (e) { alert("추가 실패: " + e.message); }
  }

  // ── 필터링 & 컬럼 ──
  const filtered = rows.filter(row => {
    const matchCompany = selectedCompanyId === "ALL" || row._companyId === selectedCompanyId;
    const matchSearch = !searchTerm || Object.values(row).some(v => String(v).toLowerCase().includes(searchTerm.toLowerCase()));
    return matchCompany && matchSearch;
  });
  const columns = buildColumns(filtered, activeTab);

  // ── 공통 스타일 ──
  const bg = "min-h-screen bg-gray-950 text-gray-100 font-sans";

  // ── 비밀번호 설정 화면 ──
  if (authState === "setup") {
    return (
      <div className={`${bg} flex items-center justify-center`}>
        <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-2xl p-8 flex flex-col gap-5 border border-gray-800">
          <div className="text-center">
            <div className="text-5xl mb-3">🔐</div>
            <h1 className="text-2xl font-extrabold text-white">마스터 관리자</h1>
            <p className="text-sm text-gray-400 mt-1">클린메니져 DB 관리 전용 페이지</p>
          </div>
          <div className="bg-blue-900/30 border border-blue-700 rounded-xl p-4 text-sm text-blue-300">
            처음 접속하셨습니다.<br/>사용하실 <b>마스터 비밀번호</b>를 설정해주세요.
          </div>
          <div className="flex flex-col gap-3">
            <label className="text-xs text-gray-400 font-medium">마스터 비밀번호 (4자 이상)</label>
            <div className="relative">
              <input
                type={showPwText ? "text" : "password"}
                value={pwInput}
                onChange={e => setPwInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSetup()}
                placeholder="비밀번호 입력..."
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500 pr-12"
              />
              <button type="button" onClick={() => setShowPwText(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs">
                {showPwText ? "숨기기" : "보기"}
              </button>
            </div>
            {pwError && <p className="text-red-400 text-xs">{pwError}</p>}
            <button onClick={handleSetup}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-colors">
              비밀번호 설정 및 입장
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 잠금 화면 ──
  if (authState === "locked") {
    return (
      <div className={`${bg} flex items-center justify-center`}>
        <div className="w-full max-w-sm bg-gray-900 rounded-2xl shadow-2xl p-8 flex flex-col gap-5 border border-gray-800">
          <div className="text-center">
            <div className="text-5xl mb-3">🛡️</div>
            <h1 className="text-2xl font-extrabold text-white">마스터 관리자</h1>
            <p className="text-sm text-gray-400 mt-1">클린메니져 DB 관리 전용 페이지</p>
          </div>
          <div className="flex flex-col gap-3">
            <label className="text-xs text-gray-400 font-medium">마스터 비밀번호</label>
            <div className="relative">
              <input
                type={showPwText ? "text" : "password"}
                value={pwInput}
                onChange={e => setPwInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleLogin()}
                placeholder="비밀번호를 입력하세요..."
                className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white outline-none focus:border-blue-500 pr-12"
              />
              <button type="button" onClick={() => setShowPwText(p => !p)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-xs">
                {showPwText ? "숨기기" : "보기"}
              </button>
            </div>
            {pwError && <p className="text-red-400 text-xs">{pwError}</p>}
            <button onClick={handleLogin}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl transition-colors">
              입장
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── 메인 관리자 화면 ──
  return (
    <div className={`${bg} flex flex-col`} style={{ minHeight: "100vh" }}>

      {/* ── 헤더 ── */}
      <header className="bg-gray-900 border-b border-gray-800 sticky top-0 z-40">
        <div className="mx-auto px-6 py-4 flex items-center justify-between w-full" style={{ maxWidth: "66%" }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🛡️</span>
            <div>
              <h1 className="text-lg font-extrabold text-white leading-none">마스터 관리자</h1>
              <p className="text-xs text-gray-400 mt-0.5">클린메니져 DB 전용 관리 페이지</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setShowChangePw(p => !p); setPwError(""); setNewPw(""); setNewPwConfirm(""); }}
              className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              🔑 비밀번호 변경
            </button>
            <button
              onClick={() => { setAuthState("locked"); setPwInput(""); }}
              className="text-xs text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-3 py-1.5 rounded-lg transition-colors"
            >
              잠금
            </button>
          </div>
        </div>
      </header>

      {/* ── 비밀번호 변경 패널 ── */}
      {showChangePw && (
        <div className="bg-gray-900 border-b border-gray-800">
          <div className="mx-auto px-6 py-4 flex flex-col gap-3 w-full" style={{ maxWidth: "66%" }}>
            <div className="max-w-md flex flex-col gap-3">
              <p className="text-sm font-bold text-white">🔑 비밀번호 변경</p>
              <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="새 비밀번호 (4자 이상)"
                className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white outline-none focus:border-blue-500 text-sm" />
              <input type="password" value={newPwConfirm} onChange={e => setNewPwConfirm(e.target.value)}
                placeholder="새 비밀번호 확인"
                className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-2.5 text-white outline-none focus:border-blue-500 text-sm" />
              {pwError && <p className="text-red-400 text-xs">{pwError}</p>}
              <div className="flex gap-2">
                <button onClick={handleChangePw}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold px-4 py-2 rounded-xl transition-colors">
                  변경 저장
                </button>
                <button onClick={() => { setShowChangePw(false); setPwError(""); }}
                  className="text-sm text-gray-400 hover:text-white px-4 py-2 rounded-xl border border-gray-700 hover:border-gray-500 transition-colors">
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 탭 바 ── */}
      <div className="bg-gray-900 border-b border-gray-800 sticky top-[73px] z-30">
        <div className="mx-auto px-4 flex gap-1 overflow-x-auto w-full" style={{ maxWidth: "66%" }}>
          <div className="flex items-center mr-2 shrink-0">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold border-r border-gray-700 pr-2 py-3">테스트</span>
          </div>
          {TABS.filter(t => t.group === "test").map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium shrink-0 border-b-2 transition-colors ${
                activeTab === tab.id ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-gray-200"
              }`}>
              {tab.label}
            </button>
          ))}
          <div className="flex items-center mx-2 shrink-0">
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold border-l border-r border-gray-700 px-2 py-3">운영</span>
          </div>
          {TABS.filter(t => t.group === "ops").map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium shrink-0 border-b-2 transition-colors ${
                activeTab === tab.id ? "border-purple-500 text-purple-400" : "border-transparent text-gray-400 hover:text-gray-200"
              }`}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── 툴바 ── */}
      <div className="bg-gray-950 border-b border-gray-800 sticky top-[120px] z-20 py-3">
        <div className="mx-auto flex items-center gap-3 px-6" style={{ maxWidth: "66%" }}>
          <select 
            value={selectedCompanyId} 
            onChange={e => setSelectedCompanyId(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-blue-500 shrink-0"
          >
            <option value="ALL">🏢 전체 회사</option>
            {companyOptions.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="🔍 전체 검색..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-blue-500"
          />
          <span className="text-xs text-gray-500 shrink-0">{filtered.length}건</span>
          <button onClick={startAdd}
            className="text-xs text-blue-400 hover:text-blue-300 border border-blue-900 hover:border-blue-700 px-3 py-2 rounded-xl transition-colors shrink-0 font-bold">
            ➕ 데이터 추가
          </button>
          <button onClick={() => loadTab(activeTab)}
            className="text-xs text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 px-3 py-2 rounded-xl transition-colors shrink-0">
            🔄 새로고침
          </button>
          <button onClick={() => downloadExcel(filtered, activeTab)}
            className="text-xs text-green-400 hover:text-green-300 border border-green-900 hover:border-green-700 px-3 py-2 rounded-xl transition-colors font-bold shrink-0">
            📥 엑셀 다운로드
          </button>
        </div>
      </div>

      {/* ── 테이블 영역 ── */}
      <div className="flex-1 overflow-auto py-6">
        <div className="mx-auto px-6" style={{ maxWidth: "66%" }}>
          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
              ⏳ 데이터 불러오는 중...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
              데이터가 없습니다.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-gray-800">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-800 text-gray-300">
                    {columns.map(col => (
                      <th key={col} className="px-4 py-3 text-left font-semibold border-b border-gray-700 whitespace-nowrap text-xs uppercase tracking-wide">
                        {col}
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center font-semibold border-b border-gray-700 text-xs uppercase tracking-wide whitespace-nowrap">
                      작업
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, i) => (
                    <tr key={row._id}
                      className={`border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${i % 2 === 0 ? "" : "bg-gray-900/30"}`}>
                      {columns.map(col => (
                        <td key={col} className="px-4 py-2.5 text-gray-300 max-w-xs">
                          <span className="block truncate" title={displayVal(row[col])}>
                            {displayVal(row[col])}
                          </span>
                        </td>
                      ))}
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        <button onClick={() => startEdit(row)}
                          className="text-xs text-blue-400 hover:text-blue-300 border border-blue-900 hover:border-blue-700 px-2.5 py-1 rounded-lg mr-1.5 transition-colors">
                          수정
                        </button>
                        <button onClick={() => setDeleteTarget(row)}
                          className="text-xs text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-2.5 py-1 rounded-lg transition-colors">
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── 수정 모달 ── */}
      {editRow && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="font-bold text-white">✏️ 데이터 수정</h2>
              <button onClick={() => { setEditRow(null); setEditData({}); }} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-3">
              <p className="text-xs text-gray-500 font-mono bg-gray-800 rounded-lg px-3 py-2 break-all">{editRow._path}</p>
              {Object.entries(editData).map(([key, val]) => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">{key}</label>
                  <input
                    value={typeof val === "object" ? JSON.stringify(val) : (val ?? "")}
                    onChange={e => setEditData(prev => ({ ...prev, [key]: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex gap-2 justify-end">
              <button onClick={() => { setEditRow(null); setEditData({}); }}
                className="text-sm text-gray-400 hover:text-white border border-gray-700 px-4 py-2 rounded-xl transition-colors">
                취소
              </button>
              <button onClick={handleSave}
                className="text-sm text-white bg-blue-600 hover:bg-blue-500 font-bold px-4 py-2 rounded-xl transition-colors">
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 추가 모달 ── */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-blue-900 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <h2 className="font-bold text-white">➕ 새 데이터 등록 ({TABS.find(t => t.id === activeTab)?.label})</h2>
              <button onClick={() => { setIsAdding(false); setAddData({}); }} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
            </div>
            <div className="overflow-y-auto flex-1 px-6 py-4 flex flex-col gap-3">
              {activeTab !== "companies" && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-blue-400 font-medium">소속 회사 선택 *</label>
                  <select
                    value={addCompanyId}
                    onChange={e => setAddCompanyId(e.target.value)}
                    className="bg-gray-800 border border-blue-900 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                  >
                    <option value="" disabled>회사를 선택하세요</option>
                    {companyOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              
              {(TAB_COL_CONFIG[activeTab]?.order || [])
                .filter(k => !["_company", "_companyId", "companyId", "createdAt"].includes(k))
                .map(key => (
                <div key={key} className="flex flex-col gap-1">
                  <label className="text-xs text-gray-400 font-medium">{key}</label>
                  <input
                    value={addData[key] || ""}
                    onChange={e => setAddData(prev => ({ ...prev, [key]: e.target.value }))}
                    className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-white text-sm outline-none focus:border-blue-500"
                    placeholder={`${key} 입력...`}
                  />
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-gray-800 flex gap-2 justify-end">
              <button onClick={() => { setIsAdding(false); setAddData({}); }}
                className="text-sm text-gray-400 hover:text-white border border-gray-700 px-4 py-2 rounded-xl transition-colors">
                취소
              </button>
              <button onClick={handleAddSave}
                className="text-sm text-white bg-blue-600 hover:bg-blue-500 font-bold px-4 py-2 rounded-xl transition-colors">
                등록하기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 삭제 확인 모달 ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-red-900 rounded-2xl w-full max-w-sm shadow-2xl p-6 flex flex-col gap-4">
            <div className="text-center">
              <div className="text-4xl mb-2">🗑️</div>
              <h2 className="font-bold text-white text-lg">정말 삭제하시겠습니까?</h2>
              <p className="text-xs text-gray-400 mt-3 break-all font-mono bg-gray-800 rounded-lg p-2">
                {deleteTarget._path}
              </p>
              <p className="text-xs text-red-400 mt-2">⚠️ 삭제된 데이터는 복구할 수 없습니다!</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDeleteTarget(null)}
                className="flex-1 text-sm text-gray-400 hover:text-white border border-gray-700 py-2.5 rounded-xl transition-colors">
                취소
              </button>
              <button onClick={() => handleDelete(deleteTarget)}
                className="flex-1 text-sm text-white bg-red-600 hover:bg-red-500 font-bold py-2.5 rounded-xl transition-colors">
                삭제 확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
