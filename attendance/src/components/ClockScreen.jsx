import { useEffect, useState } from 'react';
import { subscribeTodayLog, subscribeSites, clockIn, clockOut, cancelClockOut, deleteWorkLog } from '../lib/db';
import { currentWorkDay, formatDateTime, WORK_STATUS_LABEL } from '../lib/format';

const STATUS_STYLE = {
  before: 'bg-gray-500 text-white',
  working: 'bg-blue-500 text-white',
  done: 'bg-green-600 text-white',
};

export default function ClockScreen({ currentUser }) {
  const [log, setLog] = useState(null);
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [busy, setBusy] = useState(false);
  const date = currentWorkDay();

  useEffect(() => subscribeTodayLog(currentUser.workerId, date, setLog), [currentUser.workerId, date]);
  useEffect(() => subscribeSites(setSites), []);

  const mySites = sites.filter((s) => s.active && s.workerIds?.includes(currentUser.workerId));

  useEffect(() => {
    if (!siteId && mySites.length > 0) setSiteId(mySites[0].id);
  }, [mySites, siteId]);

  const status = !log ? 'before' : log.status === 'working' ? 'working' : 'done';

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const handleClockIn = () => {
    const site = mySites.find((s) => s.id === siteId);
    run(() => clockIn({ workerId: currentUser.workerId, workerName: currentUser.name, date, siteId: site?.id, siteName: site?.name }));
  };
  const handleClockOut = () => {
    if (!log?.clockIn?.toDate) return;
    run(() => clockOut(log.id, log.clockIn.toDate()));
  };
  const handleCancelClockIn = () => run(() => deleteWorkLog(log.id)); // 근무전으로 되돌림
  const handleCancelClockOut = () => run(() => cancelClockOut(log.id)); // 근무중으로 되돌림

  return (
    <div className="p-6 flex flex-col items-center">
      <div className={`w-full py-4 rounded-xl text-lg font-semibold text-center mb-8 border-2 border-current/10 ${STATUS_STYLE[status]}`}>
        {WORK_STATUS_LABEL[status]}
      </div>

      {status === 'before' && mySites.length > 0 && (
        <select
          className="w-full border rounded-xl px-3 py-3 mb-4 text-sm"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
        >
          {mySites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      )}
      {status !== 'before' && log?.siteName && (
        <p className="text-sm text-gray-500 mb-4">현장: <span className="font-medium text-gray-700">{log.siteName}</span></p>
      )}

      <div className="w-full bg-white rounded-2xl border shadow-sm p-5 flex flex-col items-center gap-4">
        <div className="w-full flex items-center justify-center gap-2">
          <button
            onClick={handleClockIn}
            disabled={busy || status !== 'before'}
            className={`w-1/2 h-[72px] rounded-xl text-sm font-semibold transition flex flex-col items-center justify-center ${
              status === 'before' ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-400'
            }`}
          >
            <span>출근 기록</span>
            <span className="block text-xs font-normal mt-0.5">{log?.clockIn ? formatDateTime(log.clockIn) : ' '}</span>
          </button>
          <div className="w-14 shrink-0">
            {status === 'working' && (
              <button onClick={handleCancelClockIn} disabled={busy}
                className="w-full py-2 text-xs text-gray-400 border rounded-lg">
                취소
              </button>
            )}
          </div>
        </div>

        <div className="w-full flex items-center justify-center gap-2">
          <button
            onClick={handleClockOut}
            disabled={busy || status !== 'working'}
            className={`w-1/2 h-[72px] rounded-xl text-sm font-semibold transition flex flex-col items-center justify-center ${
              status === 'working' ? 'bg-orange-500 text-white' : status === 'done' ? 'bg-orange-50 text-orange-400' : 'bg-gray-100 text-gray-300'
            }`}
          >
            <span>퇴근 기록</span>
            <span className="block text-xs font-normal mt-0.5">{log?.clockOut ? formatDateTime(log.clockOut) : ' '}</span>
          </button>
          <div className="w-14 shrink-0">
            {status === 'done' && (
              <button onClick={handleCancelClockOut} disabled={busy}
                className="w-full py-2 text-xs text-gray-400 border rounded-lg">
                취소
              </button>
            )}
          </div>
        </div>
      </div>

      {status === 'done' && log?.hours != null && (
        <p className="mt-6 text-sm text-gray-500">오늘 근무시간: <span className="font-semibold text-gray-700">{log.hours}시간</span></p>
      )}
    </div>
  );
}
