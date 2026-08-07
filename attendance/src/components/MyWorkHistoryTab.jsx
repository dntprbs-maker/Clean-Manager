import { MapPin } from 'lucide-react';
import { useMyWorkHistory } from '../hooks/useMyWorkHistory';
import SiteFilterChips from './SiteFilterChips';
import { formatTimeAmPm } from '../lib/format';

export default function MyWorkHistoryTab({ currentUser }) {
  const { yearMonth, setYearMonth, sites, siteFilter, setSiteFilter, filteredLogs } = useMyWorkHistory(currentUser);

  return (
    <div className="bg-[#F4F7FB] min-h-full px-4 pt-4 pb-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-xl font-extrabold text-gray-900">내 작업내역</h1>
        <input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)}
          className="bg-white border border-gray-200 rounded-full px-3 py-1.5 text-sm font-medium text-gray-700" />
      </div>

      <SiteFilterChips sites={sites} value={siteFilter} onChange={setSiteFilter} />

      <div className="flex flex-col gap-2">
        {filteredLogs.map((l) => (
          <div key={l.id} className="bg-white rounded-2xl px-4 py-3 shadow-[0_4px_15px_rgba(0,0,0,0.06)]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-5 h-5 rounded-full bg-[#2563EB] flex items-center justify-center shrink-0">
                  <MapPin className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                </span>
                <span className="text-xs text-gray-400 shrink-0">{l.date}</span>
                <span className="font-semibold text-sm text-gray-900 truncate">{l.siteName || '현장 미지정'}</span>
              </span>
              {l.hours != null && (
                <span className="px-2.5 py-0.5 bg-[#E8EFFF] rounded-full text-xs font-semibold text-[#2563EB] shrink-0">{l.hours}시간</span>
              )}
            </div>
            <div className="text-xs text-gray-500 mt-1 ml-[26px]">
              {formatTimeAmPm(l.clockIn)} ~ {l.clockOut ? formatTimeAmPm(l.clockOut) : '작업중'}
            </div>
          </div>
        ))}
        {filteredLogs.length === 0 && <div className="text-gray-400 text-sm text-center py-8">이번 달 작업기록이 없습니다.</div>}
      </div>
    </div>
  );
}
