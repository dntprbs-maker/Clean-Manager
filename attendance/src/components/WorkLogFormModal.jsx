import { useEffect, useState } from 'react';
import Modal from './Modal';
import { subscribeWorkers, subscribeSites, adminSaveWorkLog } from '../lib/db';
import { currentWorkDay } from '../lib/format';

const tsToTimeInput = (ts) => {
  if (!ts?.toDate) return '';
  const d = ts.toDate();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function WorkLogFormModal({ log, onClose }) {
  const isEdit = !!log;
  const [workers, setWorkers] = useState([]);
  const [sites, setSites] = useState([]);
  const [workerSearch, setWorkerSearch] = useState('');
  const [workerId, setWorkerId] = useState(log?.workerId || '');
  const [siteId, setSiteId] = useState(log?.siteId || '');
  const [date, setDate] = useState(log?.date || currentWorkDay());
  const [clockInTime, setClockInTime] = useState(tsToTimeInput(log?.clockIn));
  const [clockOutTime, setClockOutTime] = useState(tsToTimeInput(log?.clockOut));
  const [error, setError] = useState('');

  useEffect(() => subscribeWorkers(setWorkers), []);
  useEffect(() => subscribeSites(setSites), []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const worker = workers.find((w) => w.id === workerId);
    if (!worker || !date || !clockInTime) {
      setError('용역자, 근무일, 출근시각은 필수입니다.');
      return;
    }
    const site = sites.find((s) => s.id === siteId);
    const clockIn = new Date(`${date}T${clockInTime}:00`);
    let clockOut = null;
    if (clockOutTime) {
      clockOut = new Date(`${date}T${clockOutTime}:00`);
      if (clockOut <= clockIn) clockOut.setDate(clockOut.getDate() + 1); // 자정 넘긴 퇴근
    }
    await adminSaveWorkLog(isEdit ? log.id : null, {
      workerId, workerName: worker.name, date,
      siteId: site?.id, siteName: site?.name,
      clockIn, clockOut,
    });
    onClose();
  };

  return (
    <Modal title={isEdit ? '근무기록 수정' : '근무기록 추가'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <input
          className="border rounded px-2 py-2 w-full text-sm"
          placeholder="직원 검색"
          value={workerSearch}
          onChange={(e) => setWorkerSearch(e.target.value)}
        />
        <select className="border rounded px-2 py-2 w-full" value={workerId} onChange={(e) => setWorkerId(e.target.value)}>
          <option value="">용역자 선택</option>
          {workers.filter((w) => w.name.includes(workerSearch.trim())).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select className="border rounded px-2 py-2 w-full" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">현장 선택(선택사항)</option>
          {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div>
          <label className="text-xs text-gray-500">근무일</label>
          <input type="date" className="border rounded px-2 py-2 w-full" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">출근시각</label>
          <input type="time" className="border rounded px-2 py-2 w-full" value={clockInTime} onChange={(e) => setClockInTime(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500">퇴근시각 (비워두면 근무중)</label>
          <input type="time" className="border rounded px-2 py-2 w-full" value={clockOutTime} onChange={(e) => setClockOutTime(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" className="w-full bg-blue-600 text-white rounded py-2">저장</button>
      </form>
    </Modal>
  );
}
