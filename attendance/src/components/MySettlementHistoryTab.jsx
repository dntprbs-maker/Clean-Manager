import { Calendar } from 'lucide-react';
import { useEffect, useState } from 'react';
import { subscribeSettlementsForMonth } from '../lib/db';
import { currentYearMonth, formatWon, payBasisLabel, STATUS_LABEL } from '../lib/format';

export default function MySettlementHistoryTab({ currentUser }) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [settlements, setSettlements] = useState([]);

  useEffect(() => subscribeSettlementsForMonth(yearMonth, setSettlements), [yearMonth]);

  const mySettlements = settlements.filter((s) => s.workerId === currentUser.workerId);

  return (
    <div className="bg-[#F0F5FA] min-h-full px-4 pt-5 pb-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-[22px] font-extrabold text-gray-900">정산내역</h1>
        <label className="bg-white shadow-sm px-4 py-1.5 rounded-[14px] flex items-center gap-2 cursor-pointer">
          <Calendar className="w-4 h-4 text-gray-600" strokeWidth={2.2} />
          <input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)}
            className="text-[13.5px] font-bold text-gray-700 bg-transparent outline-none" />
        </label>
      </div>

      <div className="flex flex-col gap-4">
        {mySettlements.map((s) => (
          <div key={s.id} className="bg-white rounded-[22px] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="flex items-center justify-between mb-3">
              <span className="font-extrabold text-[17px] text-gray-900">{s.siteName || '현장 미지정'}</span>
              <div className="px-3 py-1 rounded-[12px] bg-[#DBEAFE] text-[#1E40AF] flex items-center gap-1.5 text-xs font-semibold">
                <span className="w-1.5 h-1.5 bg-[#2563EB] rounded-full" />
                <span>{STATUS_LABEL[s.status]}</span>
              </div>
            </div>

            <div className="text-[13.5px] text-gray-600 mb-4">
              {payBasisLabel(s)} = {formatWon(s.grossAmount)}
            </div>

            <div className="flex items-center gap-1 text-[13px] flex-wrap">
              <span className="text-gray-500">원천징수 3.3% -{formatWon(s.withholdingTax)} →</span>
              <span className="text-[21px] leading-none font-extrabold text-[#2563EB]">{formatWon(s.netAmount)}</span>
            </div>
          </div>
        ))}
        {mySettlements.length === 0 && <div className="text-gray-400 text-sm text-center py-8">이번 달 정산 내역이 없습니다.</div>}
      </div>
    </div>
  );
}
