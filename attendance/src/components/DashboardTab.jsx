import { useEffect, useState } from 'react';
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
    { label: '활동중인 용역자', value: `${activeCount}명` },
    { label: '대표 승인 대기', value: `${pendingApproval}건` },
    { label: '지급 예정액', value: formatWon(waitingAmount) },
    { label: `${yearMonth} 지급완료액`, value: formatWon(paidAmount) },
  ];

  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold mb-3">대시보드 ({yearMonth})</h2>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="border rounded-lg p-4 bg-white">
            <div className="text-xs text-gray-500">{c.label}</div>
            <div className="text-xl font-semibold mt-1">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
