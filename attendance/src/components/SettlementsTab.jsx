import { useEffect, useState } from 'react';
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
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">정산</h2>
        <input type="month" className="border rounded px-2 py-1" value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)} />
      </div>

      <button onClick={handleGenerate} className="mb-4 bg-gray-800 text-white rounded px-4 py-2 text-sm">
        근무기록으로 정산 집계/갱신
      </button>
      <p className="text-xs text-gray-400 mb-4">3.3% 사업소득 원천징수 적용, 익월 10~15일 지급 기준</p>

      <div className="space-y-2">
        {settlements.map((s) => {
          const next = NEXT_ACTION[s.status];
          return (
            <div key={s.id} className="border rounded-lg p-3 bg-white">
              <div className="flex items-center justify-between">
                <div className="font-medium">{s.workerName} <span className="text-sm font-normal text-gray-500">· {s.siteName || '현장 미지정'}</span></div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{STATUS_LABEL[s.status]}</span>
                  {canApproveAsAdmin(currentUser) && (
                    <button onClick={() => deleteSettlement(s.id)} className="text-xs text-gray-400 hover:text-red-500">삭제</button>
                  )}
                </div>
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {payBasisLabel(s)} = {formatWon(s.grossAmount)}
              </div>
              <div className="text-sm text-gray-500">
                원천징수 3.3% -{formatWon(s.withholdingTax)} → 지급액 <span className="font-semibold text-gray-800">{formatWon(s.netAmount)}</span>
              </div>
              {next && next.allowed(currentUser) && (
                <button
                  onClick={() => next.fn(s.id)}
                  className="mt-2 text-sm bg-blue-600 text-white rounded px-3 py-1"
                >
                  {next.label}
                </button>
              )}
              {next && !next.allowed(currentUser) && (
                <p className="mt-2 text-xs text-gray-400">{next.label} 권한이 없습니다.</p>
              )}
            </div>
          );
        })}
        {settlements.length === 0 && <div className="text-gray-400 text-sm">아직 집계된 정산이 없습니다. 위 버튼으로 집계하세요.</div>}
      </div>
    </div>
  );
}
