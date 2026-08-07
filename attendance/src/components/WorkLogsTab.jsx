import { useEffect, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { subscribeWorkLogsForMonth, deleteWorkLog } from '../lib/db';
import { currentYearMonth, formatTimeOnly, WORK_STATUS_LABEL } from '../lib/format';
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
    <div className="bg-[#E8F1FE] min-h-full">
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">청소기록</h1>
          <label className="flex items-center bg-white px-4 py-[7px] rounded-full shadow text-sm font-semibold text-gray-700 cursor-pointer">
            <input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)}
              className="bg-transparent outline-none" />
          </label>
        </div>
      </div>

      <div className="px-5 mb-4">
        <button onClick={openCreate}
          className="w-full h-12 bg-[#2563EB] hover:bg-[#1d4ed8] active:bg-[#1e40af] transition-all text-white font-bold rounded-[22px] flex items-center justify-center gap-2 text-[15px] shadow-md">
          <Plus className="w-5 h-5" strokeWidth={3} />
          <span>청소기록 추가</span>
        </button>
      </div>

      <div className="px-5 space-y-3 pb-6">
        {visibleLogs.map((l) => (
          <div key={l.id} className="bg-white rounded-[22px] p-4 shadow-[0_4px_12px_rgba(37,99,235,0.08),0_2px_4px_rgba(0,0,0,0.05)]">
            <div className="flex items-start gap-3">
              <span className="w-[38px] h-[38px] rounded-full shrink-0 bg-[#2563EB] flex items-center justify-center text-white mt-0.5 shadow-[0_2px_4px_rgba(37,99,235,0.25)]">
                <MapPin className="w-[18px] h-[18px]" strokeWidth={2.25} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[15px] font-bold text-gray-800 truncate">
                      {l.date} <span className="font-semibold text-gray-600">{l.workerName}</span>
                    </div>
                    <div className="font-bold text-[15.5px] text-gray-800 leading-tight truncate">{l.siteName || '현장 미지정'}</div>
                  </div>
                  {l.hours != null && (
                    <div className="text-right shrink-0">
                      <div className="font-bold text-[#2563EB] text-lg leading-none">{l.hours}</div>
                      <div className="text-[10px] text-gray-500 font-medium -mt-0.5">시간</div>
                    </div>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-1.5 font-medium">
                  {formatTimeOnly(l.clockIn)} ~ {l.clockOut ? formatTimeOnly(l.clockOut) : WORK_STATUS_LABEL.working}
                </div>
              </div>
              <div className="flex flex-col gap-1.5 items-end shrink-0 ml-1">
                <button onClick={() => openEdit(l)}
                  className="px-2.5 py-[3px] text-[12px] font-semibold text-[#2563EB] hover:bg-blue-50 active:bg-blue-100 rounded-[10px] transition-colors">
                  수정
                </button>
                <button onClick={() => deleteWorkLog(l.id)}
                  className="px-2.5 py-[3px] text-[12px] font-medium text-red-500 hover:bg-red-50 active:bg-red-100 rounded-[10px] transition-colors">
                  삭제
                </button>
              </div>
            </div>
          </div>
        ))}
        {visibleLogs.length === 0 && (
          <div className="bg-white rounded-[22px] p-6 text-center text-gray-500 text-sm shadow-[0_4px_12px_rgba(37,99,235,0.08),0_2px_4px_rgba(0,0,0,0.05)]">
            이번 달 청소기록이 없습니다.
          </div>
        )}
      </div>

      {formOpen && <WorkLogFormModal log={editingLog} onClose={closeForm} />}
    </div>
  );
}
