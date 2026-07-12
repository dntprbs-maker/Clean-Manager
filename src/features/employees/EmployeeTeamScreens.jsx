import { useState, useEffect, useRef } from "react";
import { X, Edit3, Trash2, Plus, Link2 } from "lucide-react";
import { collection, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../../firebase";
import { useC } from "../../context/AppContext";
import { onlyDigits, fmtPhone } from "../../lib/phone";
import { genFeedToken, feedUrl } from "../../lib/calendarFeed";
import { isSuperAdmin, isMemberOf, teamRole, getMemberships } from "../../lib/membership";

// ── 직원 관리 메인 화면 (팀별 아코디언 — 한 직원이 여러 팀에 동시 표시될 수 있음) ──────
export function EmployeeListScreen() {
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

  // 팀별로 그룹핑 — 소속 멤버십 기준이라 한 직원이 여러 팀에 동시에 나타날 수 있음
  const allTeams = teams.filter(t => t !== "사장");
  const grouped = allTeams.map(team => ({
    team,
    members: users.filter(u => isMemberOf(u, team)),
  }));
  const superAdmins = users.filter(isSuperAdmin);
  if (superAdmins.length) grouped.unshift({ team: "최고관리자", members: superAdmins });
  const unassigned = users.filter(u => !isSuperAdmin(u) && getMemberships(u).length === 0);
  if (unassigned.length) grouped.push({ team: "미배정", members: unassigned });

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
                          <span className="text-[11px] px-2 py-0.5 rounded bg-gray-100 text-gray-500 font-medium">
                            {team === "최고관리자" ? "최고관리자" : (teamRole(u, team) || "팀원")}
                          </span>
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

// ── 직원 등록/수정 모달 — 이름/연락처만. 최고관리자(사장)는 1명뿐이라 여기서 부여하지 않음.
// 팀 소속은 팀 관리 화면에서 배정 ──
export function EmployeeFormModal() {
  const { empModal, setEmpModal, users, companyId } = useC();
  const [form, setForm] = useState({ name: "", phone: "", pw: "" });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (empModal.open) {
      if (empModal.editId) {
        const u = users.find(x => x.id === empModal.editId);
        if (u) setForm({ name: u.name || "", phone: fmtPhone(u.phone), pw: u.pw || "" });
      } else {
        setForm({ name: "", phone: "", pw: "" });
      }
    }
  }, [empModal.open, empModal.editId, users]);

  if (!empModal.open) return null;

  const close = () => { if(!loading) setEmpModal({open:false, editId:null}); };

  const save = async () => {
    if (!form.name.trim() || !form.phone.trim()) return alert("이름과 연락처는 필수입니다.");
    setLoading(true);

    try {
      const baseData = {
        name: form.name,
        phone: onlyDigits(form.phone),
      };
      if (empModal.editId) {
        // 기존 유저 수정 (비밀번호 포함 저장, 팀 소속(memberships)은 이 화면에서 건드리지 않음)
        const updateData = { ...baseData, pw: form.pw };
        await setDoc(doc(db, "companies", companyId, "users", empModal.editId), updateData, { merge: true });
        await setDoc(doc(db, "staffs", empModal.editId), { ...updateData, companyId }, { merge: true });
      } else {
        // 새 유저 생성 (Firestore 직접 저장 - 이메일 인증 사용안함) — 팀 소속은 없이 시작, 팀 관리에서 배정
        const newDocRef = doc(collection(db, "staffs"));
        const uid = newDocRef.id;

        const userData = {
          ...baseData,
          memberships: [],
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
          <p className="text-[11px] text-gray-400">팀 소속과 팀 내 역할(팀장/팀원)은 "팀 관리" 화면에서 배정합니다.</p>
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

// ── 팀 관리 모달 — 팀 CRUD + 팀별 배정된 직원(+역할) 관리 ───────────────────────────
export function TeamManagementModal() {
  const { teamModal, setTeamModal, teams, saveTeams, users, companyId, cals, updateCal, deleteCal } = useC();
  const [subscribeIdx, setSubscribeIdx] = useState(null);
  const [copiedIdx, setCopiedIdx]       = useState(null);
  const [memberOpenIdx, setMemberOpenIdx] = useState(null); // 어느 팀의 "배정된 직원" 목록이 펼쳐져 있는지
  const [addMemberIdx, setAddMemberIdx]   = useState(null); // 어느 팀에 직원 추가 팝업이 열려있는지
  const [addMemberEmpId, setAddMemberEmpId] = useState("");
  const [addMemberRole, setAddMemberRole]   = useState("팀원");

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

  // 팀 삭제/이름변경 시 소속 직원들의 멤버십 배열을 갱신 (toTeam이 null이면 그 팀 소속에서 제외)
  const reassignTeam = (fromTeam, toTeam) => {
    users.forEach(u => {
      const ms = getMemberships(u);
      if (!ms.some(m => m.team === fromTeam)) return;
      const newMs = toTeam
        ? ms.map(m => m.team === fromTeam ? { ...m, team: toTeam } : m)
        : ms.filter(m => m.team !== fromTeam);
      setDoc(doc(db, "companies", companyId, "users", u.id), { memberships: newMs }, { merge: true });
      setDoc(doc(db, "staffs", u.id), { memberships: newMs }, { merge: true });
    });
  };

  // ── 팀 배정(멤버십) CRUD ──
  const writeMemberships = (userId, newMs) => {
    setDoc(doc(db, "companies", companyId, "users", userId), { memberships: newMs }, { merge: true });
    setDoc(doc(db, "staffs", userId), { memberships: newMs }, { merge: true });
  };
  const addMember = (team, employeeId, role) => {
    const u = users.find(x => x.id === employeeId);
    if (!u) return;
    const ms = getMemberships(u);
    if (ms.some(m => m.team === team)) return; // 이미 소속
    writeMemberships(employeeId, [...ms, { team, role }]);
  };
  const removeMember = (team, employeeId) => {
    const u = users.find(x => x.id === employeeId);
    if (!u) return;
    writeMemberships(employeeId, getMemberships(u).filter(m => m.team !== team));
  };
  const changeMemberRole = (team, employeeId, newRole) => {
    const u = users.find(x => x.id === employeeId);
    if (!u) return;
    writeMemberships(employeeId, getMemberships(u).map(m => m.team === team ? { ...m, role: newRole } : m));
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
    // 캘린더(담당팀)는 현장팀 여부와 무관하게 항상 생성 — 그래야 나중에
    // 현장팀/업무팀 토글로 서로 전환할 수 있음. 같은 이름 캘린더가 있으면 재사용.
    const existing = cals.find(c => c.label === name || c.name === name);
    if (existing) {
      updateCal({ ...existing, color: newTeamColor, isField: newTeamIsField });
    } else {
      updateCal({ id: `cal_${Date.now()}`, label: name, name, color: newTeamColor, checked: true, isField: newTeamIsField });
    }
    setNewTeam("");
    setNewTeamIsField(true);
    setNewTeamColor("#f59e0b");
    setAddPopup(false);
  };

  const handleDelete = (targetTeam) => {
    if (window.confirm("삭제하는 팀에 배정된 직원들은 이 팀 소속에서 제외됩니다.")) {
      reassignTeam(targetTeam, null);
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
          {visibleTeams.map((t, i) => {
            const members = users.filter(u => isMemberOf(u, t));
            const nonMembers = users.filter(u => !isMemberOf(u, t));
            return (
            <div
              key={t}
              ref={el => itemRefs.current[i] = el}
              className={`bg-white rounded-xl shadow-sm border transition-all
                ${overIdx === i && dragIdx !== i ? "border-blue-400 bg-blue-50 scale-[1.02]" : "border-gray-100"}
                ${dragIdx === i ? "opacity-40" : "opacity-100"}
              `}
            >
              <div
                draggable
                onDragStart={e => onDragStart(e, i)}
                onDragOver={e => onDragOver(e, i)}
                onDrop={e => onDrop(e, i)}
                onDragEnd={onDragEnd}
                className="flex items-center gap-2 p-3"
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
                <button onClick={() => setMemberOpenIdx(memberOpenIdx === i ? null : i)} className="flex-1 flex items-center gap-1.5 text-left">
                  <span className="font-bold text-gray-800 text-sm">{t}</span>
                  <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded-full">{members.length}명</span>
                </button>
              )}

              {/* 현장팀 토글 — 예전 버그로 캘린더 없이 만들어진 팀은 눌러서 바로 생성 */}
              {(()=>{
                const cal = cals.find(c => c.label === t);
                if (!cal) {
                  return (
                    <button
                      onClick={() => updateCal({ id: `cal_${Date.now()}`, label: t, name: t, color: "#9ca3af", checked: true, isField: true })}
                      title="캘린더가 없는 팀입니다. 눌러서 현장팀으로 만들기"
                      className="text-[10px] font-bold px-2 py-1 rounded-full border border-dashed border-red-300 text-red-500 bg-red-50">
                      캘린더 없음
                    </button>
                  );
                }
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

              {/* 캘린더 구독(iCal) 링크 — 네이버 캘린더 등에서 URL로 구독 */}
              {(()=>{
                const cal = cals.find(c => c.label === t);
                if (!cal) return null;
                return (
                  <div className="relative">
                    <button
                      onClick={() => setSubscribeIdx(subscribeIdx === i ? null : i)}
                      title="캘린더 구독 링크"
                      className="text-gray-400 hover:text-blue-500 p-1.5 rounded-full hover:bg-blue-50 transition-colors">
                      <Link2 size={15}/>
                    </button>
                    {subscribeIdx === i && (
                      <div className="absolute right-0 top-8 bg-white rounded-xl shadow-xl border border-gray-100 p-3 z-50 flex flex-col gap-2" style={{width:280}}>
                        <p className="text-xs font-bold text-gray-700">📡 {t} 캘린더 구독 링크</p>
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                          이 URL을 네이버/구글 캘린더의 "다른 캘린더 구독(URL로 추가)"에 등록하면 이 팀 일정이 자동으로 보여요.
                        </p>
                        {cal.feedToken ? (
                          <>
                            <div className="flex gap-1">
                              <input readOnly value={feedUrl(companyId, cal.id, cal.feedToken)}
                                onFocus={e=>e.target.select()}
                                className="flex-1 min-w-0 text-[10px] bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 outline-none text-gray-600"/>
                              <button
                                onClick={() => { navigator.clipboard.writeText(feedUrl(companyId, cal.id, cal.feedToken)); setCopiedIdx(i); setTimeout(()=>setCopiedIdx(null), 1500); }}
                                className="shrink-0 text-[11px] font-bold text-white bg-blue-600 hover:bg-blue-700 px-2.5 py-1.5 rounded-lg">
                                {copiedIdx === i ? "복사됨!" : "복사"}
                              </button>
                            </div>
                            <button
                              onClick={() => { if (window.confirm("재발급하면 기존 링크를 구독 중인 사람은 다시 구독해야 해요. 계속할까요?")) updateCal({...cal, feedToken: genFeedToken()}); }}
                              className="text-[11px] text-red-500 font-bold self-start hover:underline">
                              🔄 링크 재발급 (기존 링크 무효화)
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => updateCal({...cal, feedToken: genFeedToken()})}
                            className="text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 px-3 py-2 rounded-lg">
                            구독 링크 만들기
                          </button>
                        )}
                      </div>
                    )}
                  </div>
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

              {/* 배정된 직원 목록 (펼쳐질 때만) */}
              {memberOpenIdx === i && (
                <div className="border-t border-gray-100 p-3 flex flex-col gap-2 bg-gray-50">
                  {members.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-2">배정된 직원이 없습니다.</p>
                  ) : members.map(u => (
                    <div key={u.id} className="flex items-center justify-between bg-white rounded-lg border border-gray-100 px-3 py-2">
                      <span className="text-sm font-medium text-gray-800">{u.name}</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => changeMemberRole(t, u.id, teamRole(u, t) === "팀장" ? "팀원" : "팀장")}
                          className={`text-[11px] font-bold px-2 py-1 rounded-full border ${teamRole(u,t)==="팀장" ? "bg-blue-50 text-blue-600 border-blue-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}>
                          {teamRole(u, t) || "팀원"}
                        </button>
                        <button onClick={() => removeMember(t, u.id)} className="text-gray-300 hover:text-red-500 p-1">
                          <X size={14}/>
                        </button>
                      </div>
                    </div>
                  ))}

                  {addMemberIdx === i ? (
                    <div className="flex flex-col gap-2 bg-white rounded-lg border border-gray-100 p-2.5">
                      <select value={addMemberEmpId} onChange={e=>setAddMemberEmpId(e.target.value)}
                        className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none">
                        <option value="">직원 선택</option>
                        {nonMembers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                      <div className="flex gap-1.5">
                        {["팀장","팀원"].map(r => (
                          <button key={r} onClick={()=>setAddMemberRole(r)}
                            className={`flex-1 py-1.5 rounded-lg text-xs font-bold ${addMemberRole===r?"bg-blue-500 text-white":"bg-gray-50 text-gray-500 border border-gray-200"}`}>
                            {r}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-1.5">
                        <button onClick={() => { setAddMemberIdx(null); setAddMemberEmpId(""); }}
                          className="flex-1 py-1.5 rounded-lg text-xs font-bold text-gray-500 bg-gray-100">취소</button>
                        <button onClick={() => { if(addMemberEmpId){ addMember(t, addMemberEmpId, addMemberRole); setAddMemberIdx(null); setAddMemberEmpId(""); } }}
                          disabled={!addMemberEmpId}
                          className="flex-1 py-1.5 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                          style={{background:"linear-gradient(135deg,#1a56db,#2563eb)"}}>추가</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setAddMemberIdx(i); setAddMemberRole("팀원"); }}
                      disabled={nonMembers.length === 0}
                      className="text-xs font-bold text-blue-600 disabled:text-gray-300 self-start px-1">
                      + 직원 추가
                    </button>
                  )}
                </div>
              )}
            </div>
          )})}
          {visibleTeams.length === 0 && (
            <div className="py-10 text-center text-gray-400 text-sm">등록된 팀이 없습니다.</div>
          )}
        </div>
      </div>
    </div>
  );
}
