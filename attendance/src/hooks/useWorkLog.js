import { useEffect, useState } from 'react';
import { subscribeTodayLogs, subscribeSites, clockIn, clockOut, cancelClockOut, deleteWorkLog } from '../lib/db';
import { currentWorkDay } from '../lib/format';

// ClockScreen 디자인 시안(A/B/C)이 전부 동일한 로직을 쓰도록 뽑아낸 공용 훅.
// 여기 내용은 기존 ClockScreen.jsx 로직 그대로 — 동작(useState/useEffect/이벤트/DB 함수) 변경 없음.
export function useWorkLog(currentUser) {
  const [todayLogs, setTodayLogs] = useState([]);
  const [sites, setSites] = useState([]);
  const [busy, setBusy] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const date = currentWorkDay();

  useEffect(() => subscribeTodayLogs(currentUser.workerId, date, setTodayLogs), [currentUser.workerId, date]);
  useEffect(() => subscribeSites(setSites), []);

  const mySites = sites.filter((s) => s.active && s.workerIds?.includes(currentUser.workerId));

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  const handleClockIn = (site) => {
    setShowPicker(false);
    run(() => clockIn({ workerId: currentUser.workerId, workerName: currentUser.name, date, siteId: site?.id, siteName: site?.name }));
  };
  const handleClockOut = (log) => {
    if (!log.clockIn?.toDate) return;
    run(() => clockOut(log.id, log.clockIn.toDate()));
  };
  const handleCancelStart = (log) => run(() => deleteWorkLog(log.id));
  const handleCancelComplete = (log) => run(() => cancelClockOut(log.id));

  const logBySiteId = new Map(todayLogs.map((l) => [l.siteId || '__none__', l]));
  const startedSites = mySites.filter((s) => logBySiteId.has(s.id));
  const remainingSites = mySites.filter((s) => !logBySiteId.has(s.id));

  const soloSite = mySites.length <= 1 ? (mySites[0] || null) : null;
  const soloLog = soloSite ? logBySiteId.get(soloSite.id) : logBySiteId.get('__none__');

  const cards = soloSite !== null || mySites.length === 0
    ? [{ site: soloSite, log: soloLog || null }]
    : startedSites.map((s) => ({ site: s, log: logBySiteId.get(s.id) }));

  const totalHours = todayLogs.filter((l) => l.hours != null).reduce((sum, l) => sum + l.hours, 0);
  const hasDoneToday = todayLogs.some((l) => l.status === 'done');

  return {
    busy, showPicker, setShowPicker,
    mySites, remainingSites, cards, totalHours, hasDoneToday,
    handleClockIn, handleClockOut, handleCancelStart, handleCancelComplete,
  };
}
