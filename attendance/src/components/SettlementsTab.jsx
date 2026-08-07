import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import {
  subscribeWorkers, subscribeWorkLogsForMonth, subscribeSettlementsForMonth,
  generateSettlements, confirmByManager, approveByAdmin, markPaid, deleteSettlement,
} from '../lib/db';
import { currentYearMonth, formatWon, payBasisLabel, STATUS_LABEL } from '../lib/format';
import { canConfirmAsManager, canApproveAsAdmin } from '../lib/membership';

const NEXT_ACTION = {
  draft: { label: '매니저 확정', fn: confirmByManager, allowed: canConfirmAsManager },
  managerConfirmed: { label: '대표 승인', fn: approveByAdmin, allowed: canApproveAsAdmin },
  adminApproved: { label: '지급완료 처리', fn: markPaid, allowed: canApproveAsAdmin },
};

export default function SettlementsTab({ currentUser }) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [workers, setWorkers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settlements, setSettlements] = useState([]);

  useEffect(() => subscribeWorkers(setWorkers), []);
  useEffect(() => subscribeWorkLogsForMonth(yearMonth, setLogs), [yearMonth]);
  useEffect(() => subscribeSettlementsForMonth(yearMonth, setSettlements), [yearMonth]);

  const handleGenerate = () => generateSettlements(yearMonth, logs, workers);

  return (
    <div className="bg-[#F0F7FF] min-h-full px-4 pt-4 pb-6">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-[22px] font-semibold text-[#1F2937]">정산</h1>
          <label className="flex items-center bg-white rounded-2xl px-4 py-1.5 shadow-sm border border-[#E5E7EB] mt-1 cursor-pointer">
            <Calendar className="w-4 h-4 mr-1.5 text-[#2563EB]" strokeWidth={2} />
            <input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)}
              className="font-semibold text-base bg-transparent outline-none" />
          </label>
        </div>
      </div>

      <button onClick={handleGenerate}
        className="w-full bg-[#2563EB] hover:bg-[#1D4ED8] transition-colors text-white font-semibold py-[13px] rounded-[18px] text-[15px] shadow-sm">
        청소기록으로 정산 집계/갱신
      </button>
      <p className="text-[12.5px] text-[#64748B] flex items-center gap-x-1 mt-2 mb-5">
        <span className="text-[#2563EB]">•</span> 모든 정산 금액에 3.3% 원천징수가 적용됩니다
      </p>

      <div className="space-y-4">
        {settlements.map((s) => {
          const next = NEXT_ACTION[s.status];
          return (
            <div key={s.id} className="bg-white rounded-[22px] shadow-[0_4px_12px_-2px_rgba(0,0,0,0.06),0_2px_6px_-2px_rgba(0,0,0,0.04)] px-5 py-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold text-[15.5px] text-[#1F2937]">{s.workerName}</div>
                  <div className="text-[#64748B] text-[13px] mt-0.5">{s.siteName || '현장 미지정'}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-3 py-[3.5px] rounded-full font-medium bg-[#DBEAFE] text-[#1E40AF]">{STATUS_LABEL[s.status]}</span>
                  {canApproveAsAdmin(currentUser) && (
                    <button onClick={() => deleteSettlement(s.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
                  )}
                </div>
              </div>

              <div className="mt-3.5 text-[#475569] text-[13.5px]">
                {payBasisLabel(s)} = <span className="font-semibold">{formatWon(s.grossAmount)}</span>
              </div>

              <div className="mt-3 pt-3 border-t border-[#F1F5F9]">
                <div className="text-[#64748B] text-[12.5px]">원천징수 3.3% -{formatWon(s.withholdingTax)}</div>
                <div className="flex items-baseline gap-x-1 mt-0.5">
                  <span className="text-[#64748B] text-xs">지급액</span>
                  <span className="text-[22px] font-bold leading-none text-[#2563EB]">{formatWon(s.netAmount)}</span>
                </div>
              </div>

              {next && next.allowed(currentUser) && (
                <button onClick={() => next.fn(s.id)}
                  className="mt-4 w-full py-2.5 text-[#2563EB] text-sm font-semibold border border-[#2563EB] rounded-[14px] active:bg-[#F0F7FF]">
                  {next.label}
                </button>
              )}
              {next && !next.allowed(currentUser) && (
                <p className="mt-4 text-xs text-gray-400 text-center">{next.label} 권한이 없습니다.</p>
              )}
            </div>
          );
        })}
        {settlements.length === 0 && (
          <div className="bg-white rounded-[22px] p-6 text-center text-gray-400 text-sm shadow-[0_4px_12px_-2px_rgba(0,0,0,0.06)]">
            아직 집계된 정산이 없습니다. 위 버튼으로 집계하세요.
          </div>
        )}
      </div>
    </div>
  );
}
