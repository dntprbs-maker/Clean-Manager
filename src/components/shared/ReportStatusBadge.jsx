import {useContext} from "react";
import {Ctx} from "../../context/AppContext";
import { getReportStatus, REPORT_STATUS_STYLE } from "../../lib/reports";

export function ReportStatusBadge({ eventId, reports }) {
  const ctx=useContext(Ctx);
  if(ctx?.dataStates?.reportRelated && !ctx.dataStates.reportRelated.ready)return <span className="text-[11px] text-gray-400">상태 확인 중</span>;
  const status = getReportStatus(eventId, reports);
  const s = REPORT_STATUS_STYLE[status];
  return (
    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0"
      style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}
