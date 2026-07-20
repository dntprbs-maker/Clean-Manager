import { useEffect, useState } from 'react';
import { subscribeSettlementsForMonth } from '../lib/db';
import { currentYearMonth, formatWon, payBasisLabel, STATUS_LABEL } from '../lib/format';

export default function MySettlementHistoryTab({ currentUser }) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [settlements, setSettlements] = useState([]);

  useEffect(() => subscribeSettlementsForMonth(yearMonth, setSettlements), [yearMonth]);

  const mySettlements = settlements.filter((s) => s.workerId === currentUser.workerId);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">정산내역</h2>
        <input type="month" className="border rounded px-2 py-1 text-sm" value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)} />
      </div>

      <div className="space-y-2">
        {mySettlements.map((s) => (
          <div key={s.id} className="border rounded-lg p-3 bg-white">
            <div className="flex items-center justify-between">
              <span className="font-medium">{s.siteName || '현장 미지정'}</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{STATUS_LABEL[s.status]}</span>
            </div>
            <div className="text-sm text-gray-600 mt-1">
              {payBasisLabel(s)} = {formatWon(s.grossAmount)}
            </div>
            <div className="text-sm text-gray-500">
              원천징수 3.3% -{formatWon(s.withholdingTax)} → 지급액 <span className="font-semibold text-gray-800">{formatWon(s.netAmount)}</span>
            </div>
          </div>
        ))}
        {mySettlements.length === 0 && <div className="text-gray-400 text-sm">이번 달 정산 내역이 없습니다.</div>}
      </div>
    </div>
  );
}
