import { useState, useEffect } from "react";
import { X, ChevronLeft, ChevronRight, Edit3, Trash2, Check } from "lucide-react";
import { useC } from "../../context/AppContext";
import { fmt, WD, fmtTime } from "../../lib/dateTime";
import { assignmentOccursOn, describeRepeat, repeatRuleValid, assignmentRepeatRule, WAGE_TYPES, wageTypeLabel } from "../../lib/repeat";
import { computeSettlement } from "../../lib/settlement";
import { RepeatPanel } from "../../components/shared/RepeatPicker";
import { teamsLabel } from "../../lib/membership";

// ── 정기청소 근무관리 허브 화면 ───────────────────────────────────────────────
export function RegularCleaningHubScreen() {
  const { currentUser, setCurrentScreen } = useC();
  const isAdmin = currentUser.role === "최고관리자";
  const adminMenu = [
    { key: "reg_sites", label: "현장 관리", icon: "🏢", desc: "현장 등록·수정 및 직원 배정" },
    { key: "reg_today", label: "오늘 현황", icon: "✅", desc: "오늘 출근 예정자 확인·체크" },
    { key: "reg_settlement", label: "월별 정산", icon: "💰", desc: "근무일수·급여 계산 및 확정" },
  ];
  const staffMenu = [
    { key: "reg_my", label: "내 정기청소 근무", icon: "🧹", desc: "내 배정·출근체크·근무내역" },
  ];
  const menuItems = isAdmin ? adminMenu : staffMenu;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">정기청소 근무관리</h2>
        <button onClick={() => setCurrentScreen("calendar")} className="p-2 rounded-full hover:bg-gray-100">
          <X size={22} className="text-gray-500"/>
        </button>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        {menuItems.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-4xl mb-3">🧹</div>
            <p className="text-sm text-gray-400 font-semibold">아직 준비 중인 화면입니다</p>
          </div>
        ) : menuItems.map(m => (
          <button key={m.key} onClick={() => setCurrentScreen(m.key)}
            className="text-left w-full rounded-2xl p-4 flex items-center gap-3 bg-white border border-gray-100 hover:border-blue-200 transition-all">
            <span className="text-2xl shrink-0">{m.icon}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900">{m.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{m.desc}</p>
            </div>
            <ChevronLeft size={16} className="text-gray-300 rotate-180 shrink-0"/>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 정기청소 현장 관리 화면 (목록) ───────────────────────────────────────────────
export function SitesScreen() {
  const { sites, assignments, setCurrentScreen, setSiteModal, setSiteDetailId, currentUser } = useC();
  const isAdmin = currentUser.role === "최고관리자";
  const assignedCount = siteId => assignments.filter(a => a.siteId === siteId).length;

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentScreen("reg_hub")} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
              <ChevronLeft size={24} className="text-gray-700"/>
            </button>
            <h2 className="text-xl font-bold text-gray-900">현장 관리</h2>
          </div>
          {isAdmin && (
            <button onClick={() => setSiteModal({ open: true, editId: null })}
              className="flex items-center gap-1 text-sm font-bold text-blue-600 px-4 py-2 rounded-full bg-blue-50">
              + 현장 추가
            </button>
          )}
        </div>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        {sites.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-4xl mb-3">🏢</div>
            <p className="text-sm text-gray-400 font-semibold">등록된 현장이 없습니다</p>
          </div>
        ) : sites.map(s => (
          <button key={s.id} onClick={() => { setSiteDetailId(s.id); setCurrentScreen("reg_site_detail"); }}
            className="text-left bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3 hover:border-blue-200 transition-all">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{s.name}</p>
              {s.address && <p className="text-xs text-gray-400 mt-1 truncate">📍 {s.address}</p>}
              <p className="text-xs text-blue-500 mt-1">배정 {assignedCount(s.id)}명</p>
            </div>
            <ChevronLeft size={16} className="text-gray-300 rotate-180 shrink-0"/>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── 정기청소 현장 상세 (현장 정보 + 이 현장의 배정 관리) ───────────────────────────────────────────────
export function SiteDetailScreen() {
  const { sites, assignments, users, siteDetailId, setCurrentScreen, setSiteModal, deleteSite, setAssignmentModal, deleteAssignment, currentUser } = useC();
  const isAdmin = currentUser.role === "최고관리자";
  const site = sites.find(s => s.id === siteDetailId);
  const siteAssignments = assignments.filter(a => a.siteId === siteDetailId);
  const empName = id => users.find(u => u.id === id)?.name || "탈퇴한 직원";

  if (!site) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
        <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4 flex items-center gap-1">
          <button onClick={() => setCurrentScreen("reg_sites")} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <h2 className="text-xl font-bold text-gray-900">현장 상세</h2>
        </div>
        <div className="p-10 text-center text-sm text-gray-400">삭제된 현장입니다</div>
      </div>
    );
  }

  const handleDeleteSite = async () => {
    const message = siteAssignments.length > 0
      ? `'${site.name}' 현장을 삭제하면 배정된 직원 ${siteAssignments.length}명의 배정도 모두 함께 삭제됩니다. 계속하시겠습니까?`
      : `'${site.name}' 현장을 삭제하시겠습니까?`;
    if (!window.confirm(message)) return;
    await Promise.all(siteAssignments.map(a => deleteAssignment(a.id)));
    deleteSite(site.id);
    setCurrentScreen("reg_sites");
  };

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 min-w-0">
            <button onClick={() => setCurrentScreen("reg_sites")} className="p-2 -ml-2 rounded-full hover:bg-gray-100 shrink-0">
              <ChevronLeft size={24} className="text-gray-700"/>
            </button>
            <p className="text-sm font-bold truncate">
              <span className="text-gray-400">현장 관리</span>
              <span className="text-gray-300 mx-1">›</span>
              <span className="text-gray-900">{site.name}</span>
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-1 shrink-0">
              <button onClick={() => setSiteModal({ open: true, editId: site.id })} className="p-2 rounded-full hover:bg-gray-100">
                <Edit3 size={16} className="text-gray-400"/>
              </button>
              <button onClick={handleDeleteSite} className="p-2 rounded-full hover:bg-gray-100">
                <Trash2 size={16} className="text-gray-400"/>
              </button>
            </div>
          )}
        </div>
        {site.address && <p className="text-xs text-gray-400 mt-1 pl-1">📍 {site.address}</p>}
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <p className="text-[13px] font-bold text-gray-500">배정된 직원 {siteAssignments.length}명</p>
          {isAdmin && (
            <button onClick={() => setAssignmentModal({ open: true, editId: null, presetSiteId: site.id })}
              className="text-sm font-bold text-blue-600">+ 배정 추가</button>
          )}
        </div>
        {siteAssignments.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-sm text-gray-400 font-semibold">배정된 직원이 없습니다</p>
          </div>
        ) : siteAssignments.map(a => (
          <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-900 truncate">{empName(a.employeeId)}</p>
              <p className="text-xs font-bold text-blue-600 mt-1.5">{describeRepeat(a)}</p>
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
                {(a.startTime || a.endTime) && <span>{fmtTime(a.startTime)} ~ {fmtTime(a.endTime)}</span>}
                <span>{wageTypeLabel(a.wageType)} {Number(a.wageAmount ?? a.dailyWage ?? 0).toLocaleString()}원</span>
              </div>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setAssignmentModal({ open: true, editId: a.id, presetSiteId: site.id })} className="p-2 rounded-full hover:bg-gray-100">
                  <Edit3 size={16} className="text-gray-400"/>
                </button>
                <button onClick={() => { if (window.confirm(`${empName(a.employeeId)} 배정을 삭제하시겠습니까?`)) deleteAssignment(a.id); }}
                  className="p-2 rounded-full hover:bg-gray-100">
                  <Trash2 size={16} className="text-gray-400"/>
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── 정기청소 오늘현황 (관리자용 출근체크) ───────────────────────────────────────────────
export function TodayStatusScreen() {
  const { assignments, sites, users, attendance, setAttendanceCheck, setCurrentScreen } = useC();
  const todayStr = fmt(new Date());
  const weekday = new Date().getDay();
  const todays = assignments.filter(a => assignmentOccursOn(a, todayStr));
  const bySite = sites
    .map(site => ({ site, rows: todays.filter(a => a.siteId === site.id) }))
    .filter(g => g.rows.length > 0);

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-center gap-1">
          <button onClick={() => setCurrentScreen("reg_hub")} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <div>
            <h2 className="text-xl font-bold text-gray-900">오늘 현황</h2>
            <p className="text-xs text-gray-400 mt-0.5">{todayStr} ({WD[weekday]})</p>
          </div>
        </div>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        {bySite.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <div className="text-4xl mb-3">📅</div>
            <p className="text-sm text-gray-400 font-semibold">오늘 배정된 현장이 없습니다</p>
          </div>
        ) : bySite.map(({ site, rows }) => (
          <div key={site.id} className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">{site.name}</p>
            <div className="flex flex-col gap-2">
              {rows.map(a => {
                const emp = users.find(u => u.id === a.employeeId);
                const att = attendance.find(x => x.date === todayStr && x.employeeId === a.employeeId && x.siteId === a.siteId);
                const confirmed = !!att?.confirmed;
                return (
                  <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-gray-900">{emp?.name || "탈퇴한 직원"}</p>
                      {confirmed && att?.confirmedBy && (
                        <p className="text-xs text-gray-400 mt-0.5">{att.confirmedBy === "self" ? "본인 체크" : "관리자 체크"}</p>
                      )}
                    </div>
                    <button
                      onClick={() => setAttendanceCheck(todayStr, a.employeeId, a.siteId, !confirmed, "admin")}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold transition-colors shrink-0"
                      style={{ background: confirmed ? "#dcfce7" : "#f3f4f6", color: confirmed ? "#15803d" : "#6b7280" }}>
                      <Check size={14}/> {confirmed ? "출근확인됨" : "출근확인"}
                    </button>
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

// ── 정기청소 내 근무 (직원용 — 내 배정/셀프체크/근무내역) ───────────────────────────────────────────────
export function MyRegularCleaningScreen() {
  const { currentUser, assignments, sites, attendance, setAttendanceCheck, monthlySettlements, setCurrentScreen } = useC();
  const siteName = id => sites.find(s => s.id === id)?.name || "삭제된 현장";
  const todayStr = fmt(new Date());
  const weekday = new Date().getDay();
  const myAssignments = assignments.filter(a => a.employeeId === currentUser.id);
  const todaysMine = myAssignments.filter(a => assignmentOccursOn(a, todayStr));
  const myHistory = attendance
    .filter(a => a.employeeId === currentUser.id && a.confirmed)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30);
  const mySettlements = monthlySettlements
    .filter(s => s.employeeId === currentUser.id)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4 flex items-center gap-1">
        <button onClick={() => setCurrentScreen("reg_hub")} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
          <ChevronLeft size={24} className="text-gray-700"/>
        </button>
        <h2 className="text-xl font-bold text-gray-900">내 정기청소 근무</h2>
      </div>

      <div className="px-4 py-4 flex flex-col gap-3">
        <p className="text-[13px] font-bold text-gray-500 px-1">오늘 출근 체크 · {todayStr} ({WD[weekday]})</p>
        {todaysMine.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <p className="text-sm text-gray-400">오늘은 배정된 현장이 없습니다</p>
          </div>
        ) : todaysMine.map(a => {
          const att = attendance.find(x => x.date === todayStr && x.employeeId === currentUser.id && x.siteId === a.siteId);
          const confirmed = !!att?.confirmed;
          return (
            <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-3">
              <p className="flex-1 text-sm font-bold text-gray-900">{siteName(a.siteId)}</p>
              <button
                onClick={() => setAttendanceCheck(todayStr, currentUser.id, a.siteId, !confirmed, "self")}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold transition-colors shrink-0"
                style={{ background: confirmed ? "#dcfce7" : "#f3f4f6", color: confirmed ? "#15803d" : "#6b7280" }}>
                <Check size={14}/> {confirmed ? "출근확인됨" : "출근확인"}
              </button>
            </div>
          );
        })}

        <p className="text-[13px] font-bold text-gray-500 px-1 mt-3">내 배정</p>
        {myAssignments.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <p className="text-sm text-gray-400">배정된 현장이 없습니다</p>
          </div>
        ) : myAssignments.map(a => (
          <div key={a.id} className="bg-white rounded-2xl border border-gray-100 p-4">
            <p className="text-sm font-bold text-gray-900">{siteName(a.siteId)}</p>
            <p className="text-xs font-bold text-blue-600 mt-1.5">{describeRepeat(a)}</p>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-400 flex-wrap">
              {(a.startTime || a.endTime) && <span>{fmtTime(a.startTime)} ~ {fmtTime(a.endTime)}</span>}
              <span>{wageTypeLabel(a.wageType)} {Number(a.wageAmount ?? a.dailyWage ?? 0).toLocaleString()}원</span>
            </div>
          </div>
        ))}

        <p className="text-[13px] font-bold text-gray-500 px-1 mt-3">근무내역</p>
        {myHistory.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <p className="text-sm text-gray-400">출근확인 기록이 없습니다</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            {myHistory.map(h => (
              <div key={h.id} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm text-gray-800">{siteName(h.siteId)}</span>
                <span className="text-xs text-gray-400">{h.date}</span>
              </div>
            ))}
          </div>
        )}

        <p className="text-[13px] font-bold text-gray-500 px-1 mt-3">내 급여</p>
        {mySettlements.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center">
            <p className="text-sm text-gray-400">아직 확정된 급여가 없습니다</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
            {mySettlements.map(s => <MySettlementRow key={s.id} s={s}/>)}
          </div>
        )}
      </div>
    </div>
  );
}

// 내 급여 한 줄 — 탭하면 확정 당시 저장된 계산 내역(breakdown)을 명세처럼 펼쳐 보여준다.
// breakdown이 없는 레거시 정산 문서는 금액만 표시.
function MySettlementRow({ s }) {
  const [open, setOpen] = useState(false);
  const b = s.breakdown;
  const Row = ({ label, value }) => (
    <div className="flex items-center justify-between text-xs text-gray-500">
      <span>{label}</span><span className="font-semibold text-gray-700">{Number(value || 0).toLocaleString()}원</span>
    </div>
  );
  return (
    <div className="px-4 py-3">
      <button onClick={() => b && setOpen(o => !o)} className="w-full flex items-center justify-between">
        <span className="text-sm text-gray-800 flex items-center gap-1.5">
          {s.yearMonth}
          {b && <span className="text-[10px] text-gray-400">{open ? "▲" : "▼ 내역"}</span>}
        </span>
        <span className="text-sm font-bold text-gray-900">{Number(s.finalAmount || 0).toLocaleString()}원</span>
      </button>
      {open && b && (
        <div className="mt-2 pl-1 flex flex-col gap-1 border-l-2 border-gray-100 ml-1 pl-3">
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>근무일수</span><span className="font-semibold text-gray-700">{b.workDays}일</span>
          </div>
          {b.dailySum > 0 && <Row label="일급합계" value={b.dailySum}/>}
          {b.weeklySum > 0 && <Row label="주급합계" value={b.weeklySum}/>}
          {b.monthlySum > 0 && <Row label="월급합계" value={b.monthlySum}/>}
          {b.allowanceSum > 0 && <Row label="일 보조금" value={b.allowanceSum}/>}
          {b.extraSum > 0 && <Row label="추가지급" value={b.extraSum}/>}
          <div className="h-px bg-gray-100 my-0.5"/>
          <Row label="계산 총액" value={b.refTotal}/>
          {Number(s.finalAmount || 0) !== Number(b.refTotal || 0) && (
            <p className="text-[11px] text-gray-400">* 최종 확정금액은 계산 총액에서 조정된 금액입니다</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── 정기청소 월별 정산 (관리자용) ───────────────────────────────────────────────
export function MonthlySettlementScreen() {
  const { users, assignments, setCurrentScreen } = useC();
  const [ym, setYm] = useState(() => fmt(new Date()).slice(0, 7));
  const shiftMonth = delta => {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    setYm(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  // 팀 구성과 무관하게, 배정이 하나라도 있는 직원만 정산 대상으로 노출
  const employees = users.filter(u => assignments.some(a => a.employeeId === u.id));

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 flex flex-col">
      <div className="bg-white border-b border-gray-100 px-5 pt-5 pb-4">
        <div className="flex items-center gap-1 mb-2">
          <button onClick={() => setCurrentScreen("reg_hub")} className="p-2 -ml-2 rounded-full hover:bg-gray-100">
            <ChevronLeft size={24} className="text-gray-700"/>
          </button>
          <h2 className="text-xl font-bold text-gray-900">월별 정산</h2>
        </div>
        <div className="flex items-center justify-center gap-4">
          <button onClick={() => shiftMonth(-1)} className="p-1.5 rounded-full hover:bg-gray-100"><ChevronLeft size={18}/></button>
          <span className="text-sm font-bold text-gray-800">{ym}</span>
          <button onClick={() => shiftMonth(1)} className="p-1.5 rounded-full hover:bg-gray-100"><ChevronRight size={18}/></button>
        </div>
      </div>
      <div className="px-4 py-4 flex flex-col gap-3">
        {employees.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center">
            <p className="text-sm text-gray-400 font-semibold">배정된 직원이 없습니다</p>
          </div>
        ) : employees.map(emp => (
          <SettlementCard key={`${emp.id}_${ym}`} employee={emp} ym={ym}/>
        ))}
      </div>
    </div>
  );
}

function SettlementCard({ employee, ym }) {
  const { sites, assignments, attendance, extraPayments, monthlySettlements, setEmployeeAllowance, deleteExtraPayment, confirmSettlement, setExtraPaymentModal } = useC();
  const siteName = id => sites.find(s => s.id === id)?.name || "삭제된 현장";
  const [allowance, setAllowance] = useState(employee.dailyAllowance || 0);
  const calc = computeSettlement({ employee, ym, assignments, attendance, extraPayments, allowance });
  const { workDays, dailySum, weeklySum, monthlySum, weeklyLines, monthlyLines, myExtras, extraSum, allowanceSum, refTotal } = calc;
  const settlement = monthlySettlements.find(s => s.employeeId === employee.id && s.yearMonth === ym);
  const [finalAmount, setFinalAmount] = useState(settlement ? settlement.finalAmount : refTotal);
  const breakdown = { workDays, dailySum, weeklySum, monthlySum, allowanceSum, extraSum, refTotal };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-bold text-gray-900">{employee.name}</p>
        {settlement && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-50 text-green-600">확정됨</span>}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
        <div>근무일수 <span className="font-bold text-gray-800">{workDays}일</span></div>
        <div>일급합계 <span className="font-bold text-gray-800">{dailySum.toLocaleString()}원</span></div>
      </div>
      {(weeklyLines.length > 0 || monthlyLines.length > 0) && (
        <div className="flex flex-col gap-1 text-xs text-gray-500">
          {weeklyLines.map(l => (
            <div key={`w_${l.siteId}`} className="flex items-center justify-between">
              <span>주급 · {siteName(l.siteId)} <span className="text-gray-400">({l.wageAmount.toLocaleString()} × {l.weeks}주)</span></span>
              <span className="font-bold text-gray-800">{l.sum.toLocaleString()}원</span>
            </div>
          ))}
          {monthlyLines.map(l => (
            <div key={`m_${l.siteId}`} className="flex items-center justify-between">
              {l.counted ? (
                <>
                  <span>월급 · {siteName(l.siteId)}</span>
                  <span className="font-bold text-gray-800">{l.sum.toLocaleString()}원</span>
                </>
              ) : (
                <span className="text-gray-300">월급 · {siteName(l.siteId)} — 이번달 출근 없음 (미합산)</span>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <span className="shrink-0">일 보조금</span>
        <input type="number" inputMode="numeric" value={allowance}
          onChange={e => setAllowance(Number(e.target.value) || 0)}
          onBlur={() => setEmployeeAllowance(employee.id, allowance)}
          className="w-20 px-2 py-1 rounded-lg border border-gray-200 text-right"/>
        <span className="shrink-0">× {workDays}일 = {allowanceSum.toLocaleString()}원</span>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-500">추가지급 {extraSum.toLocaleString()}원</span>
          <button onClick={() => setExtraPaymentModal({ open: true, employeeId: employee.id })} className="text-blue-600 font-bold">+ 추가</button>
        </div>
        {myExtras.map(p => (
          <div key={p.id} className="flex items-center justify-between text-xs text-gray-400 pl-2">
            <span>{p.date} · {p.reason || "사유없음"} · {Number(p.amount).toLocaleString()}원</span>
            <button onClick={() => deleteExtraPayment(p.id)} className="text-gray-300 shrink-0 ml-2">✕</button>
          </div>
        ))}
      </div>
      <div className="h-px bg-gray-100"/>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">참고총액 (실시간 계산)</span>
        <span className="text-sm font-bold text-gray-700">{refTotal.toLocaleString()}원</span>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" inputMode="numeric" value={finalAmount}
          onChange={e => setFinalAmount(Number(e.target.value) || 0)}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-gray-200 text-sm font-bold"/>
        <button onClick={() => confirmSettlement(employee.id, ym, finalAmount, breakdown)}
          className="px-4 py-2 rounded-xl text-xs font-bold text-white shrink-0"
          style={{ background: "linear-gradient(135deg,#1a56db,#2563eb)" }}>
          {settlement ? "재확정" : "확정"}
        </button>
      </div>
      {settlement && <p className="text-[11px] text-gray-400">확정일: {settlement.confirmedAt ? fmt(new Date(settlement.confirmedAt)) : ""}</p>}
    </div>
  );
}

// ── 정기청소 추가지급 등록 모달 ───────────────────────────────────────────────
export function ExtraPaymentModal() {
  const { extraPaymentModal, setExtraPaymentModal, addExtraPayment } = useC();
  const [date, setDate] = useState(fmt(new Date()));
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (extraPaymentModal.open) { setDate(fmt(new Date())); setAmount(""); setReason(""); }
  }, [extraPaymentModal.open]);

  if (!extraPaymentModal.open) return null;
  const close = () => setExtraPaymentModal({ open: false, employeeId: null });
  const submit = () => {
    if (!amount) return;
    addExtraPayment({ employeeId: extraPaymentModal.employeeId, date, amount: Number(amount), reason: reason.trim() });
    close();
  };

  return (
    <div className="absolute inset-0 z-[80] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative bg-white rounded-t-3xl p-5 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">추가지급 등록</h2>
          <button onClick={close} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <X size={22}/>
          </button>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">지급일</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">금액</label>
          <input type="number" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="예: 50000"
            className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">사유</label>
          <input value={reason} onChange={e => setReason(e.target.value)}
            placeholder="예: 명절 보너스"
            className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
        </div>
        <button onClick={submit} disabled={!amount}
          className="w-full py-3.5 rounded-xl text-sm text-white font-bold transition-colors"
          style={{ background: amount ? "linear-gradient(135deg,#1a56db,#2563eb)" : "#e5e7eb" }}>
          저장
        </button>
      </div>
    </div>
  );
}

// ── 정기청소 현장 등록/수정 모달 ───────────────────────────────────────────────
export function SiteFormModal() {
  const { siteModal, setSiteModal, sites, addSite, updateSite } = useC();
  const [name, setName]       = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    if (siteModal.open) {
      const editing = siteModal.editId ? sites.find(s => s.id === siteModal.editId) : null;
      setName(editing?.name || "");
      setAddress(editing?.address || "");
    }
  }, [siteModal.open, siteModal.editId]);

  if (!siteModal.open) return null;
  const close = () => setSiteModal({ open: false, editId: null });

  const submit = () => {
    if (!name.trim()) return;
    if (siteModal.editId) {
      updateSite({ id: siteModal.editId, name: name.trim(), address: address.trim() });
    } else {
      addSite({ name: name.trim(), address: address.trim() });
    }
    close();
  };

  return (
    <div className="absolute inset-0 z-[70] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative bg-white rounded-t-3xl p-5 shadow-2xl flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900">{siteModal.editId ? "현장 수정" : "새 현장 등록"}</h2>
          <button onClick={close} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <X size={22}/>
          </button>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">현장명</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)}
            placeholder="예: 상암동 오피스"
            className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">주소</label>
          <input value={address} onChange={e => setAddress(e.target.value)}
            placeholder="예: 서울 마포구 상암동 115"
            className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
        </div>
        <button onClick={submit} disabled={!name.trim()}
          className="w-full py-3.5 rounded-xl text-sm text-white font-bold transition-colors"
          style={{ background: name.trim() ? "linear-gradient(135deg,#1a56db,#2563eb)" : "#e5e7eb" }}>
          저장
        </button>
      </div>
    </div>
  );
}

// ── 정기청소 배정 관리 화면 ───────────────────────────────────────────────
// ── 정기청소 배정 등록/수정 모달 (현장 상세에서 진입 — 현장은 보통 고정) ───────────────────────────────────────────────
export function AssignmentFormModal() {
  const { assignmentModal, setAssignmentModal, assignments, sites, users, addAssignment, updateAssignment } = useC();
  const blankForm = () => ({
    employeeId: "", siteId: "",
    start: fmt(new Date()),
    repeat: "weekly", repeatInterval: 1, repeatWeekdays: [],
    repeatMonthlyType: "day", repeatMonthlyDay: null, repeatMonthlyOrdinal: null, repeatMonthlyWeekday: null,
    repeatYearlyType: "date", repeatYearlyMonth: null, repeatYearlyDay: null, repeatYearlyOrdinal: null, repeatYearlyWeekday: null,
    repeatUntil: "",
    startTime: "", endTime: "",
    wageType: "daily", wageAmount: "",
  });
  const [form, setForm] = useState(blankForm());
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!assignmentModal.open) return;
    const editing = assignmentModal.editId ? assignments.find(a => a.id === assignmentModal.editId) : null;
    if (editing) {
      // 레거시 배정(옛 요일배열 스키마)도 반복 규칙으로 정규화해서 폼에 채운다
      const normalized = assignmentRepeatRule(editing);
      setForm({ ...blankForm(), ...normalized, wageAmount: String(normalized.wageAmount ?? normalized.dailyWage ?? "") });
    } else {
      setForm({ ...blankForm(), siteId: assignmentModal.presetSiteId || "" });
    }
  }, [assignmentModal.open, assignmentModal.editId, assignmentModal.presetSiteId]);

  if (!assignmentModal.open) return null;
  const close = () => setAssignmentModal({ open: false, editId: null, presetSiteId: null });
  const valid = form.employeeId && form.siteId && repeatRuleValid(form);
  const siteLocked = !!assignmentModal.presetSiteId;
  const lockedSite = siteLocked ? sites.find(s => s.id === assignmentModal.presetSiteId) : null;

  const submit = () => {
    if (!valid) return;
    // 같은 현장에 같은 직원을 중복 배정하면 배정 목록에서 헷갈리므로, 신규 등록 시에만 막는다
    if (!assignmentModal.editId) {
      const dup = assignments.some(a => a.employeeId === form.employeeId && a.siteId === form.siteId);
      if (dup) { alert("이미 이 현장에 배정된 직원입니다. 기존 배정을 수정해주세요."); return; }
    }
    const data = {
      employeeId: form.employeeId, siteId: form.siteId,
      repeat: form.repeat, repeatInterval: form.repeatInterval || 1,
      repeatWeekdays: form.repeatWeekdays || [],
      repeatMonthlyType: form.repeatMonthlyType, repeatMonthlyDay: form.repeatMonthlyDay,
      repeatMonthlyOrdinal: form.repeatMonthlyOrdinal, repeatMonthlyWeekday: form.repeatMonthlyWeekday,
      repeatYearlyType: form.repeatYearlyType, repeatYearlyMonth: form.repeatYearlyMonth,
      repeatYearlyDay: form.repeatYearlyDay, repeatYearlyOrdinal: form.repeatYearlyOrdinal, repeatYearlyWeekday: form.repeatYearlyWeekday,
      repeatUntil: form.repeatUntil,
      startTime: form.startTime, endTime: form.endTime,
      wageType: form.wageType, wageAmount: Number(form.wageAmount) || 0,
    };
    if (assignmentModal.editId) {
      updateAssignment({ ...data, id: assignmentModal.editId });
    } else {
      addAssignment(data);
    }
    close();
  };

  return (
    <div className="absolute inset-0 z-[70] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={close} />
      <div className="relative bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 pb-0">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-400">{assignmentModal.editId ? "배정 수정" : "새 배정 등록"}</p>
            {siteLocked && <h2 className="text-xl font-bold text-gray-900 mt-0.5 truncate">{lockedSite?.name || "-"}</h2>}
          </div>
          <button onClick={close} className="p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 shrink-0">
            <X size={22}/>
          </button>
        </div>
        <div className="p-5 pt-4 flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">직원</label>
            <select value={form.employeeId} onChange={e => set("employeeId", e.target.value)}
              className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500">
              <option value="">직원 선택</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name} ({teamsLabel(u)})</option>)}
            </select>
          </div>
          {!siteLocked && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">현장</label>
              <select value={form.siteId} onChange={e => set("siteId", e.target.value)}
                className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500">
                <option value="">현장 선택</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1">시작 시간</label>
              <input type="time" value={form.startTime} onChange={e => set("startTime", e.target.value)}
                className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1">종료 시간</label>
              <input type="time" value={form.endTime} onChange={e => set("endTime", e.target.value)}
                className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">급여 유형</label>
            <div className="flex gap-1.5 mb-2">
              {WAGE_TYPES.map(w => (
                <button key={w.value} onClick={() => set("wageType", w.value)}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold ${form.wageType===w.value?"bg-blue-500 text-white":"bg-gray-50 text-gray-500 border border-gray-200"}`}>
                  {w.label}
                </button>
              ))}
            </div>
            <input type="number" inputMode="numeric" value={form.wageAmount} onChange={e => set("wageAmount", e.target.value)}
              placeholder={`예: ${form.wageType === "monthly" ? "800000" : form.wageType === "weekly" ? "300000" : "80000"}`}
              className="w-full py-3 px-4 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:border-blue-500"/>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 mb-1">근무 주기</p>
          </div>
        </div>
        <RepeatPanel form={form} set={set} excludeNone/>
        <div className="p-5 pt-0">
          <button onClick={submit} disabled={!valid}
            className="w-full py-3.5 rounded-xl text-sm text-white font-bold transition-colors"
            style={{ background: valid ? "linear-gradient(135deg,#1a56db,#2563eb)" : "#e5e7eb" }}>
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
