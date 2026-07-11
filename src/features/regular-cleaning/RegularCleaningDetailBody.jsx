import { Clock, MapPin, Check } from "lucide-react";
import { useC } from "../../context/AppContext";
import { WD, pd, fmtTime } from "../../lib/dateTime";
import { assignmentOccursOn } from "../../lib/repeat";

// ── 정기청소 일정 상세 본문 (DetailSheet 헤더/애니메이션은 공유, 본문만 교체) ──
export function RegularCleaningDetailBody({ detEv, cal }) {
  const { sites, assignments, users, attendance, setAttendanceCheck, currentUser } = useC();
  const site = sites.find(s => s.id === detEv.siteId);
  const weekday = pd(detEv.start).getDay();
  const todaysAssignments = assignments.filter(a => a.siteId === detEv.siteId && assignmentOccursOn(a, detEv.start));
  const isAdmin = currentUser.role === "최고관리자";

  return (
    <>
      <div className="flex items-center px-5 py-4 border-b border-gray-50 gap-1">
        <span style={{ color: cal.color }} className="font-semibold text-[15px]">{cal.label}</span>
      </div>

      <div className="flex items-start px-5 py-5 border-b border-gray-100 gap-3">
        <div className="w-4 h-4 rounded-full shrink-0 mt-1 shadow-sm" style={{ backgroundColor: cal.color }}/>
        <h2 className="text-xl font-bold text-gray-900 leading-snug">{detEv.title}</h2>
      </div>

      <div className="flex items-start px-5 py-5 border-b border-gray-100 gap-4">
        <Clock size={20} className="text-gray-400 shrink-0 mt-0.5"/>
        <span className="text-[15px] text-gray-800">{detEv.start} ({WD[weekday]})</span>
      </div>

      {site?.address && (
        <div className="flex items-start px-5 py-5 border-b border-gray-100 gap-4">
          <MapPin size={20} className="text-gray-400 shrink-0 mt-0.5"/>
          <a href={`https://map.naver.com/v5/search/${encodeURIComponent(site.address)}`} target="_blank" rel="noopener noreferrer"
            className="flex-1 text-[15px] text-gray-800 hover:underline leading-relaxed">{site.address}</a>
        </div>
      )}

      <div className="px-5 py-5">
        <p className="text-[13px] font-bold text-gray-500 mb-3">배정된 직원 {todaysAssignments.length}명</p>
        {todaysAssignments.length === 0 ? (
          <p className="text-sm text-gray-400">이 요일에 배정된 직원이 없습니다.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {todaysAssignments.map(a => {
              const emp = users.find(u => u.id === a.employeeId);
              const att = attendance.find(x => x.date === detEv.start && x.employeeId === a.employeeId && x.siteId === detEv.siteId);
              const confirmed = !!att?.confirmed;
              const canCheck = isAdmin || currentUser.id === a.employeeId;
              return (
                <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{emp?.name || "탈퇴한 직원"}</p>
                    {(a.startTime || a.endTime) && (
                      <p className="text-xs text-gray-400 mt-0.5">{fmtTime(a.startTime)} ~ {fmtTime(a.endTime)}</p>
                    )}
                    {confirmed && att?.confirmedBy && (
                      <p className="text-xs text-gray-400 mt-0.5">{att.confirmedBy === "self" ? "본인 체크" : "관리자 체크"}</p>
                    )}
                  </div>
                  {canCheck ? (
                    <button
                      onClick={() => setAttendanceCheck(detEv.start, a.employeeId, detEv.siteId, !confirmed, currentUser.id === a.employeeId ? "self" : "admin")}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-bold transition-colors shrink-0"
                      style={{ background: confirmed ? "#dcfce7" : "#f3f4f6", color: confirmed ? "#15803d" : "#6b7280" }}>
                      <Check size={14}/> {confirmed ? "출근확인됨" : "출근확인"}
                    </button>
                  ) : (
                    <span className="text-xs font-bold px-3 py-2 rounded-full shrink-0"
                      style={{ background: confirmed ? "#dcfce7" : "#f3f4f6", color: confirmed ? "#15803d" : "#9ca3af" }}>
                      {confirmed ? "출근확인됨" : "미확인"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
