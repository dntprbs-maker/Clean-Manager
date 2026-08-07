import { useEffect, useMemo, useState } from 'react';
import { subscribeWorkLogsForMonth } from '../lib/db';
import { currentYearMonth } from '../lib/format';

export function useMyWorkHistory(currentUser) {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [logs, setLogs] = useState([]);
  const [siteFilter, setSiteFilter] = useState('all');

  useEffect(() => subscribeWorkLogsForMonth(yearMonth, setLogs), [yearMonth]);

  const myLogs = useMemo(
    () => logs.filter((l) => l.workerId === currentUser.workerId && !l.deleted),
    [logs, currentUser.workerId]
  );

  const sites = useMemo(() => {
    const names = new Set(myLogs.map((l) => l.siteName || '현장 미지정'));
    return [...names];
  }, [myLogs]);

  const filteredLogs = useMemo(
    () => (siteFilter === 'all' ? myLogs : myLogs.filter((l) => (l.siteName || '현장 미지정') === siteFilter)),
    [myLogs, siteFilter]
  );

  return { yearMonth, setYearMonth, myLogs, sites, siteFilter, setSiteFilter, filteredLogs };
}
