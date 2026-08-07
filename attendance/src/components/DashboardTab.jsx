import { useEffect, useState } from 'react';
import { Users, CheckCircle, CircleDollarSign, CheckCircle2 } from 'lucide-react';
import { subscribeWorkers, subscribeSettlementsForMonth } from '../lib/db';
import { currentYearMonth, formatWon } from '../lib/format';

export default function DashboardTab() {
  const [workers, setWorkers] = useState([]);
  const [settlements, setSettlements] = useState([]);
  const yearMonth = currentYearMonth();

  useEffect(() => subscribeWorkers(setWorkers), []);
  useEffect(() => subscribeSettlementsForMonth(yearMonth, setSettlements), [yearMonth]);

  const activeCount = workers.filter((w) => w.active).length;
  const pendingApproval = settlements.filter((s) => s.status === 'managerConfirmed').length;
  const waitingPayment = settlements.filter((s) => s.status === 'adminApproved');
  const waitingAmount = waitingPayment.reduce((sum, s) => sum + (s.netAmount || 0), 0);
  const paidAmount = settlements.filter((s) => s.status === 'paid').reduce((sum, s) => sum + (s.netAmount || 0), 0);

  const cards = [
    { label: '활동중인 용역자', value: `${activeCount}명`, Icon: Users },
    { label: '대표 승인 대기', value: `${pendingApproval}건`, Icon: CheckCircle },
    { label: '지급 예정액', value: formatWon(waitingAmount), Icon: CircleDollarSign },
    { label: `${yearMonth} 지급완료액`, value: formatWon(paidAmount), Icon: CheckCircle2 },
  ];

  return (
    <div className="bg-[#E8F4FF] min-h-full px-5 pt-8 pb-8">
      <h1 className="text-2xl font-bold text-[#1e3a8a] mb-6">대시보드 ({yearMonth})</h1>
      <div className="grid grid-cols-2 gap-3">
        {cards.map(({ label, value, Icon }) => (
          <div key={label} className="bg-white rounded-[22px] shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-4">
            <div className="flex items-start gap-3">
              <span className="w-9 h-9 bg-[#2563EB] rounded-full flex items-center justify-center shrink-0 shadow-[0_1px_3px_rgba(37,99,235,0.3)]">
                <Icon className="w-[18px] h-[18px] text-white" strokeWidth={2.25} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-gray-500 font-medium">{label}</div>
                <div className="text-[26px] leading-[1.1] tracking-[-0.5px] font-bold text-gray-900 mt-0.5">{value}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
