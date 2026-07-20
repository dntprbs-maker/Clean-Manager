import { useEffect, useState } from 'react';
import { subscribeWorkLogsForMonth, deleteWorkLog } from '../lib/db';
import { currentYearMonth, formatDateTime, WORK_STATUS_LABEL } from '../lib/format';
import WorkLogFormModal from './WorkLogFormModal';

export default function WorkLogsTab() {
  const [logs, setLogs] = useState([]);
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [formOpen, setFormOpen] = useState(false);
  const [editingLog, setEditingLog] = useState(null);

  useEffect(() => subscribeWorkLogsForMonth(yearMonth, setLogs), [yearMonth]);

  const visibleLogs = logs.filter((l) => !l.deleted);

  const openCreate = () => { setEditingLog(null); setFormOpen(true); };
  const openEdit = (log) => { setEditingLog(log); setFormOpen(true); };
  const closeForm = () => { setFormOpen(false); setEditingLog(null); };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">근무기록</h2>
        <input type="month" className="border rounded px-2 py-1 text-sm" value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)} />
      </div>

      <button onClick={openCreate} className="mb-4 bg-gray-800 text-white rounded px-4 py-2 text-sm">
        근무기록 추가
      </button>

      <div className="space-y-1">
        {visibleLogs.map((l) => (
          <div key={l.id} className="flex items-center justify-between border rounded-lg p-2 bg-white text-sm">
            <div>
              <div className="text-base font-semibold">근무일 {l.date} · {l.workerName} {l.siteName && <span className="text-sm font-normal text-gray-500">· {l.siteName}</span>}</div>
              <div className="text-xs text-gray-400">{formatDateTime(l.clockIn)} ~ {l.clockOut ? formatDateTime(l.clockOut) : WORK_STATUS_LABEL.working}
                {l.hours != null && <span> · {l.hours}시간</span>}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button className="text-gray-400 hover:text-blue-500" onClick={() => openEdit(l)}>수정</button>
              <button className="text-gray-400 hover:text-red-500" onClick={() => deleteWorkLog(l.id)}>삭제</button>
            </div>
          </div>
        ))}
        {visibleLogs.length === 0 && <div className="text-gray-400 text-sm">이번 달 근무기록이 없습니다.</div>}
      </div>

      {formOpen && <WorkLogFormModal log={editingLog} onClose={closeForm} />}
    </div>
  );
}
