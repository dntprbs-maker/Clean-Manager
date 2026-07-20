import { useEffect, useState } from 'react';
import { subscribeWorkLogsForMonth } from '../lib/db';
import { currentYearMonth, formatDateTime } from '../lib/format';

export default function MyWorkHistoryTab({ currentUser }) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [logs, setLogs] = useState([]);

  useEffect(() => subscribeWorkLogsForMonth(yearMonth, setLogs), [yearMonth]);

  const myLogs = logs.filter((l) => l.workerId === currentUser.workerId && !l.deleted);

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">내 근무내역</h2>
        <input type="month" className="border rounded px-2 py-1 text-sm" value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)} />
      </div>

      <div className="space-y-1">
        {myLogs.map((l) => (
          <div key={l.id} className="border rounded-lg p-2 bg-white text-sm">
            <div className="text-base font-semibold">근무일 {l.date} {l.siteName && <span className="text-sm font-normal text-gray-500">· {l.siteName}</span>}</div>
            <div className="text-xs text-gray-400">{formatDateTime(l.clockIn)} ~ {l.clockOut ? formatDateTime(l.clockOut) : '근무중'}</div>
            {l.hours != null && <span className="text-gray-500">{l.hours}시간</span>}
          </div>
        ))}
        {myLogs.length === 0 && <div className="text-gray-400 text-sm">이번 달 근무기록이 없습니다.</div>}
      </div>
    </div>
  );
}
