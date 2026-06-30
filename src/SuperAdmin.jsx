/**
 * SuperAdmin.jsx — 클린메니져 DB 전용 마스터 관리자 페이지
 * 접속: http://localhost:5173/Clean-Manager/#superadmin
 */
import { useState, useEffect, useCallback } from "react";
import {
  collection, getDocs, doc, deleteDoc, updateDoc, addDoc, setDoc
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
  { id: "events",    label: "📅 일정",        group: "test" },
  { id: "notices",   label: "📢 공지사항",    group: "test" },
  { id: "logs",      label: "📋 변경로그",    group: "test" },
  { id: "companies", label: "🏢 회사목록",    group: "ops"  },
  { id: "staffs",    label: "👤 직원목록",    group: "ops"  },
  { id: "admins",    label: "🔑 관리자목록",  group: "ops"  },
  { id: "deleted",   label: "🗑️ 삭제목록",    group: "ops"  },
  { id: "dupphone",  label: "📱 중복전화번호", group: "ops"  },
  { id: "cals",      label: "🎨 팀 캘린더",    group: "ops"  },
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
  deleted: {
    hidden: ["companyId", "status"],
    order:  ["_type", "name", "_companyId", "_company", "deletedBy", "deletedAt", "createdAt"],
  },
  dupphone: {
    hidden: [],
    order:  ["phone", "이름1", "회사1", "등록일1", "이름2", "회사2", "등록일2", "이름3", "회사3", "등록일3"],
  },
  cals: {
    hidden: ["checked"],
    order:  ["_company", "name", "label", "color", "isField"],
  },
};

// ── 컬럼 목록 생성 (숨김·순서 적용) ─────────────────────────
// 행마다 필드가 달라도 컬럼은 항상 동일하게: cfg.order + 모든 행의 필드 합집합
function buildColumns(rows, tabId) {
  const cfg    = TAB_COL_CONFIG[tabId] || { hidden: [], order: [] };
  const hidden = new Set(["_id", "_path", ...cfg.hidden]);

  // 모든 행의 키 합집합 (첫 행만 보지 않음 → 컬럼 누락 방지)
  const union = new Set();
  rows.forEach(r => Object.keys(r).forEach(k => union.add(k)));
  // 설정된 순서 컬럼은 데이터가 없어도 항상 포함
  cfg.order.forEach(k => union.add(k));

  const all = [...union].filter(k => !hidden.has(k));
  return [
    ...cfg.order.filter(k => all.includes(k)),
    ...all.filter(k => !cfg.order.includes(k)),
  ];
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
    compSnap.forEach(d => { if (d.data().status !== "deleted") rows.push({ _id: d.id, _path: `companies/${d.id}`, _companyId: d.id, ...d.data() }); });

  } else if (tabId === "cals") {
    // 회사별 팀 캘린더(색상) — 중복 정리용
    for (const compDoc of compSnap.docs) {
      const calSnap = await getDocs(collection(db, "companies", compDoc.id, "cals"));
      calSnap.forEach(d => rows.push({
        _id: d.id,
        _path: `companies/${compDoc.id}/cals/${d.id}`,
        _companyId: compDoc.id,
        _company: compMap[compDoc.id] || compDoc.id,
        ...d.data(),
      }));
    }

  } else if (tabId === "deleted") {
    // 삭제된 companies
    compSnap.forEach(d => { if (d.data().status === "deleted") rows.push({ _id: d.id, _path: `companies/${d.id}`, _companyId: d.id, _type: "회사", ...d.data() }); });
    // 삭제된 admins — company 연동 삭제는 제외 (회사 삭제 시 함께 삭제된 것)
    const adminSnap2 = await getDocs(collection(db, "admins"));
    adminSnap2.forEach(d => {
      const data = d.data();
      if (data.status === "deleted" && data.deletedBy !== "company")
        rows.push({ _id: d.id, _path: `admins/${d.id}`, _companyId: data.companyId, _company: compMap[data.companyId] || data.companyId, _type: "관리자", ...data });
    });
    // 삭제된 staffs — company 연동 삭제는 제외, admin/superadmin이 삭제한 것만 표시
    const staffSnap2 = await getDocs(collection(db, "staffs"));
    staffSnap2.forEach(d => {
      const data = d.data();
      if (data.status === "deleted" && data.deletedBy !== "company")
        rows.push({ _id: d.id, _path: `staffs/${d.id}`, _companyId: data.companyId, _company: compMap[data.companyId] || data.companyId, _type: "직원", ...data });
    });

  } else if (tabId === "staffs") {
    const snap = await getDocs(collection(db, "staffs"));
    snap.forEach(d => { if (d.data().status !== "deleted") rows.push({
      _id: d.id, _path: `staffs/${d.id}`,
      _companyId: d.data().companyId, _company: compMap[d.data().companyId] || d.data().companyId,
      ...d.data()
    }); });

  } else if (tabId === "admins") {
    const snap = await getDocs(collection(db, "admins"));
    snap.forEach(d => { if (d.data().status !== "deleted") rows.push({
      _id: d.id, _path: `admins/${d.id}`,
      _companyId: d.data().companyId, _company: compMap[d.data().companyId] || d.data().companyId,
      ...d.data()
    }); });

  } else if (tabId === "dupphone") {
    // 전화번호 기준으로 여러 회사에 등록된 직원 목록
    const snap = await getDocs(collection(db, "staffs"));
    const phoneMap = {};
    snap.forEach(d => {
      const data = d.data();
      if (data.status === "deleted") return;
      const phone = data.phone || "";
      if (!phone) return;
      if (!phoneMap[phone]) phoneMap[phone] = [];
      phoneMap[phone].push({ ...data, _staffId: d.id, _company: compMap[data.companyId] || data.companyId });
    });
    Object.entries(phoneMap).forEach(([phone, staffs]) => {
      if (staffs.length < 2) return;
      const row = { _id: phone, _path: "", phone };
      staffs.forEach((s, i) => {
        row[`회사${i+1}`] = s._company;
        row[`등록일${i+1}`] = s.createdAt || "";
        row[`이름${i+1}`] = s.name || "";
      });
      rows.push(row);
    });

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
  const [sortCol, setSortCol]           = useState(null);
  const [sortDir, setSortDir]           = useState("asc");
  const [checkedIds, setCheckedIds]     = useState(new Set());

  // 탭 데이터 로드
  const loadTab = useCallback(async (tabId) => {
    setLoading(true); setRows([]); setSearchTerm(""); setSelectedCompanyId("ALL"); setCheckedIds(new Set());
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

  // ── 삭제 (삭제목록/캘린더 탭은 영구 삭제, 그 외 일반 탭은 소프트 삭제) ──
  async function handleDelete(row) {
    try {
      const isHardDelete = activeTab === "deleted" || activeTab === "cals";
      const parts = row._path.split("/");

      if (isHardDelete) {
        // 영구 삭제
        if (parts.length === 2) {
          await deleteDoc(doc(db, parts[0], parts[1]));
          // admins 영구 삭제 시 연관 admins/staffs도 삭제
          if (parts[0] === "companies") {
            const companyId = parts[1];
            const [adminSnap, staffSnap] = await Promise.all([
              getDocs(collection(db, "admins")),
              getDocs(collection(db, "staffs")),
            ]);
            await Promise.all([
              ...adminSnap.docs.filter(d => d.data().companyId === companyId).map(d => deleteDoc(doc(db, "admins", d.id))),
              ...staffSnap.docs.filter(d => d.data().companyId === companyId).map(d => deleteDoc(doc(db, "staffs", d.id))),
            ]);
          }
        } else if (parts.length === 4) {
          await deleteDoc(doc(db, parts[0], parts[1], parts[2], parts[3]));
        }
      } else {
        // 소프트 삭제
        const deletedAt = new Date().toISOString();
        if (parts.length === 2) {
          if (parts[0] === "companies") {
            const companyId = parts[1];
            // 1. 회사 소프트 삭제
            await updateDoc(doc(db, "companies", companyId), { status: "deleted", deletedAt, deletedBy: "superadmin" });
            // 2. admins 조회 및 삭제
            const adminSnap = await getDocs(collection(db, "admins"));
            const targetAdmins = adminSnap.docs.filter(d => d.data().companyId === companyId && d.data().status !== "deleted");
            for (const d of targetAdmins) {
              await updateDoc(doc(db, "admins", d.id), { status: "deleted", deletedAt, deletedBy: "company" });
            }
            // 3. staffs 조회 및 삭제
            const staffSnap = await getDocs(collection(db, "staffs"));
            const targetStaffs = staffSnap.docs.filter(d => d.data().companyId === companyId && d.data().status !== "deleted");
            for (const d of targetStaffs) {
              await updateDoc(doc(db, "staffs", d.id), { status: "deleted", deletedAt, deletedBy: "company" });
            }
            // 4. companies/{id}/users 서브컬렉션
            const usersSnap = await getDocs(collection(db, "companies", companyId, "users"));
            const targetUsers = usersSnap.docs.filter(d => d.data().status !== "deleted");
            for (const d of targetUsers) {
              await updateDoc(doc(db, "companies", companyId, "users", d.id), { status: "deleted", deletedAt, deletedBy: "company" });
            }
          } else {
            // admins/staffs 개별 삭제 → deletedBy: "superadmin"
            await updateDoc(doc(db, parts[0], parts[1]), { status: "deleted", deletedAt, deletedBy: "superadmin" });
          }
        } else if (parts.length === 4) {
          await updateDoc(doc(db, parts[0], parts[1], parts[2], parts[3]), { status: "deleted", deletedAt, deletedBy: "superadmin" });
        } else if (parts.length === 6) {
          await updateDoc(doc(db, parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]), { status: "deleted", deletedAt, deletedBy: "superadmin" });
        }
      }

      setRows(prev => prev.filter(r => (r._path || r._id) !== (row._path || row._id)));
      setDeleteTarget(null);
    } catch (e) { alert("삭제 실패: " + e.message); }
  }

  // ── 복구 ──
  async function handleRestore(row) {
    try {
      const parts = row._path.split("/");
      const restoreField = { status: "active", deletedAt: null, deletedBy: null };
      if (parts.length === 2) {
        await updateDoc(doc(db, parts[0], parts[1]), restoreField);
        if (parts[0] === "companies") {
          const companyId = parts[1];
          const [adminSnap, staffSnap] = await Promise.all([
            getDocs(collection(db, "admins")),
            getDocs(collection(db, "staffs")),
          ]);
          // admins: deletedBy:"company" 인 것만 복원 + 아이디 충돌 체크
          const myAdmins = adminSnap.docs.filter(d => d.data().companyId === companyId && d.data().status === "deleted" && d.data().deletedBy === "company");
          for (const d of myAdmins) {
            const adminId = d.data().id;
            const conflict = adminSnap.docs.find(a => a.data().id === adminId && a.data().status !== "deleted" && a.id !== d.id);
            if (conflict) {
              alert(`⚠️ 아이디 충돌: "${adminId}"가 이미 다른 계정에서 사용 중입니다.\n해당 관리자는 복구되지 않았습니다. 관리자목록에서 아이디 변경 후 복구해주세요.`);
            } else {
              await updateDoc(doc(db, "admins", d.id), restoreField);
            }
          }
          // staffs: deletedBy:"company" 인 것만 복원 (사장/슈퍼가 삭제한 직원은 제외)
          const myStaffs = staffSnap.docs.filter(d => d.data().companyId === companyId && d.data().status === "deleted" && d.data().deletedBy === "company");
          await Promise.all(myStaffs.map(d => updateDoc(doc(db, "staffs", d.id), restoreField)));
          // companies/{id}/users 서브컬렉션도 deletedBy:"company" 인 것만 복원
          const usersSnap = await getDocs(collection(db, "companies", companyId, "users"));
          const myUsers = usersSnap.docs.filter(d => d.data().status === "deleted" && d.data().deletedBy === "company");
          await Promise.all(myUsers.map(d => updateDoc(doc(db, "companies", companyId, "users", d.id), restoreField)));
        }
      } else if (parts.length === 4) {
        // 개별 복원 (슈퍼어드민에서 직접)
        await updateDoc(doc(db, parts[0], parts[1], parts[2], parts[3]), restoreField);
      }
      setRows(prev => prev.filter(r => r._id !== row._id));
    } catch (e) { alert("복구 실패: " + e.message); }
  }

  // ── 다중 삭제 ──
  async function handleBulkDelete() {
    if (!checkedIds.size) return;
    const isHardDelete = activeTab === "deleted" || activeTab === "cals";
    if (!window.confirm(`선택한 ${checkedIds.size}개를 ${isHardDelete ? "영구 삭제" : "삭제"}하시겠습니까?${isHardDelete ? "\n⚠️ 복구할 수 없습니다!" : ""}`)) return;
    const deletedAt = new Date().toISOString();
    const targets = filtered.filter(r => checkedIds.has(r._id));
    await Promise.all(targets.map(row => {
      const parts = row._path.split("/");
      if (isHardDelete) {
        if (parts.length === 2) return deleteDoc(doc(db, parts[0], parts[1]));
        if (parts.length === 4) return deleteDoc(doc(db, parts[0], parts[1], parts[2], parts[3]));
      } else {
        if (parts.length === 2) return updateDoc(doc(db, parts[0], parts[1]), { status: "deleted", deletedAt });
        if (parts.length === 4) return updateDoc(doc(db, parts[0], parts[1], parts[2], parts[3]), { status: "deleted", deletedAt });
        if (parts.length === 6) return updateDoc(doc(db, parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]), { status: "deleted", deletedAt });
      }
    }));
    setRows(prev => prev.filter(r => !checkedIds.has(r._id)));
    setCheckedIds(new Set());
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

  // ── 필터링 & 정렬 & 컬럼 ──
  const filtered = rows
    .filter(row => {
      const matchCompany = selectedCompanyId === "ALL" || row._companyId === selectedCompanyId;
      const matchSearch = !searchTerm || Object.values(row).some(v => String(v).toLowerCase().includes(searchTerm.toLowerCase()));
      return matchCompany && matchSearch;
    })
    .sort((a, b) => {
      if (!sortCol) return 0;
      const av = String(a[sortCol] ?? "").toLowerCase();
      const bv = String(b[sortCol] ?? "").toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  const columns = buildColumns(rows, activeTab); // 필터와 무관하게 전체 행 기준으로 컬럼 고정

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

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
    <div className={`${bg} flex flex-col`} style={{ height: "100vh", overflow: "hidden" }}>

      {/* ── 헤더 ── */}
      <header className="bg-gray-900 border-b border-gray-800 shrink-0 z-40">
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
      <div className="bg-gray-900 border-b border-gray-800 shrink-0 z-30">
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
      <div className="bg-gray-950 border-b border-gray-800 shrink-0 z-20 py-3">
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
          {checkedIds.size > 0 && (
            <button onClick={handleBulkDelete}
              className="text-xs text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 px-3 py-2 rounded-xl transition-colors shrink-0 font-bold bg-red-950/50">
              🗑️ 선택 {checkedIds.size}개 삭제
            </button>
          )}
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

      {/* ── 테이블 영역 — 단일 스크롤 컨테이너 ── */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400 text-sm">
            ⏳ 데이터 불러오는 중...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-gray-500 text-sm">
            데이터가 없습니다.
          </div>
        ) : (
          <div>
            <table className="w-full text-sm border-separate border-spacing-0" style={{minWidth: "max-content"}}>
              <thead className="sticky top-0 z-10">
                <tr className="bg-gray-800 text-gray-300">
                  <th className="px-3 py-3 border-b border-gray-700 bg-gray-800 w-10">
                    <input type="checkbox"
                      checked={filtered.length > 0 && filtered.every(r => checkedIds.has(r._id))}
                      onChange={e => {
                        if (e.target.checked) setCheckedIds(new Set(filtered.map(r => r._id)));
                        else setCheckedIds(new Set());
                      }}
                      className="w-4 h-4 rounded cursor-pointer accent-blue-500"/>
                  </th>
                  {columns.map(col => {
                    const isActive = sortCol === col;
                    return (
                      <th key={col} onClick={() => handleSort(col)}
                        className="px-4 py-3 text-left font-semibold border-b border-gray-700 whitespace-nowrap text-xs uppercase tracking-wide cursor-pointer select-none hover:bg-gray-700 transition-colors">
                        <span className="flex items-center gap-1">
                          {col}
                          <span className="text-[10px]">
                            {isActive ? (sortDir === "asc" ? "▲" : "▼") : <span className="text-gray-600">⇅</span>}
                          </span>
                        </span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, i) => {
                  const isChecked = checkedIds.has(row._id);
                  const isDeletedTab = activeTab === "deleted";
                  const isReadOnly = activeTab === "deleted" || activeTab === "dupphone";
                  return (
                    <tr key={row._path || row._id}
                      onClick={() => !isReadOnly && startEdit(row)}
                      className={`border-b border-gray-800 transition-colors
                        ${isDeletedTab ? "" : "cursor-pointer"}
                        ${isChecked ? "bg-blue-950/60 hover:bg-blue-900/60" : i % 2 === 0 ? "hover:bg-gray-800/70" : "bg-gray-900/30 hover:bg-gray-800/70"}`}>
                      <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isChecked}
                          onChange={e => {
                            const next = new Set(checkedIds);
                            e.target.checked ? next.add(row._id) : next.delete(row._id);
                            setCheckedIds(next);
                          }}
                          className="w-4 h-4 rounded cursor-pointer accent-blue-500"/>
                      </td>
                      {columns.map(col => (
                        <td key={col} className="px-4 py-2.5 text-gray-300 max-w-xs">
                          <span className="block truncate" title={displayVal(row[col])}>
                            {displayVal(row[col])}
                          </span>
                        </td>
                      ))}
                      {isDeletedTab && (
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <button onClick={() => handleRestore(row)}
                            className="text-xs text-green-400 border border-green-800 hover:border-green-500 px-3 py-1 rounded-lg font-bold transition-colors">
                            ↩ 복구
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
            <div className="px-6 py-4 border-t border-gray-800 flex gap-2">
              <button onClick={() => { setDeleteTarget(editRow); setEditRow(null); setEditData({}); }}
                className="text-sm text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-4 py-2 rounded-xl transition-colors">
                🗑️ 삭제
              </button>
              <div className="flex-1"/>
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
              <div className="text-4xl mb-2">{activeTab === "deleted" ? "💥" : "🗑️"}</div>
              <h2 className="font-bold text-white text-lg">
                {activeTab === "deleted" ? "영구 삭제하시겠습니까?" : "정말 삭제하시겠습니까?"}
              </h2>
              <p className="text-xs text-gray-400 mt-3 break-all font-mono bg-gray-800 rounded-lg p-2">
                {deleteTarget._path}
              </p>
              <p className="text-xs text-red-400 mt-2">
                {activeTab === "deleted"
                  ? "⚠️ DB에서 완전히 제거되며 절대 복구할 수 없습니다!"
                  : "⚠️ 삭제 후 삭제목록에서 복구할 수 있습니다."}
              </p>
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
