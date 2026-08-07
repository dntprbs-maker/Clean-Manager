import { Calendar, Bell, MapPin, Clock, Play, Plus } from 'lucide-react';
import { useWorkLog } from '../hooks/useWorkLog';
import { formatTimeOnly, formatHoursMinutes, formatDateLong, todayDate, WORK_STATUS_LABEL } from '../lib/format';

export default function ClockScreen({ currentUser }) {
  const {
    busy, showPicker, setShowPicker, mySites, remainingSites, cards, totalHours, hasDoneToday,
    handleClockIn, handleClockOut, handleCancelStart, handleCancelComplete,
  } = useWorkLog(currentUser);

  return (
    <div className="bg-[#EBF0F9]">
      {/* 상단 헤더 */}
      <div className="px-5 pt-4 pb-3 flex items-center justify-between">
        <div className="w-11 h-11 bg-white rounded-2xl flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.08)]">
          <Calendar className="w-5 h-5 text-gray-700" strokeWidth={2.25} />
        </div>
        <div className="text-center">
          <div className="font-extrabold text-[20px] tracking-[-0.4px] text-[#1F2937]">오늘 작업 현장</div>
          <div className="text-[13.5px] text-[#64748B] font-medium -mt-px">{formatDateLong(todayDate())}</div>
        </div>
        <div className="relative w-11 h-11 bg-white rounded-2xl flex items-center justify-center shadow-[0_2px_6px_rgba(0,0,0,0.08)]">
          <Bell className="w-5 h-5 text-gray-700" strokeWidth={2.25} />
          <div className="absolute top-[10px] right-[10px] w-[7.5px] h-[7.5px] bg-red-500 rounded-full ring-2 ring-white" />
        </div>
      </div>

      {/* 안내 문구 */}
      <div className="px-5 pb-3 flex items-center text-[#5B7BD8]">
        <span className="text-base">✦</span>
        <span className="ml-1.5 text-[13.5px] font-medium tracking-[-0.1px]">오늘도 안전하고 깨끗한 하루 되세요!</span>
      </div>

      <div className="px-4 flex flex-col gap-3 pb-2">
        {cards.map(({ site, log }) => (
          <SiteCard
            key={site?.id || 'none'}
            site={site} log={log} busy={busy}
            onStart={() => handleClockIn(site)}
            onComplete={() => handleClockOut(log)}
            onCancelStart={() => handleCancelStart(log)}
            onCancelComplete={() => handleCancelComplete(log)}
          />
        ))}

        {mySites.length > 1 && remainingSites.length > 0 && !showPicker && cards.length > 0 && (
          <button type="button" onClick={() => setShowPicker(true)}
            className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-[#2563EB] py-1">
            <Plus className="w-4 h-4" /> 다른 작업 현장 선택
          </button>
        )}

        {mySites.length > 1 && remainingSites.length > 0 && (showPicker || cards.length === 0) && (
          <>
            {cards.length === 0 && <p className="text-[13px] text-[#64748B] px-1 -mt-1">오늘 작업할 현장을 선택하세요.</p>}
            {remainingSites.map((site) => (
              <button key={site.id} type="button" onClick={() => handleClockIn(site)} disabled={busy}
                className="w-full bg-white rounded-[22px] shadow-[0_4px_12px_rgba(0,0,0,0.06)] p-4 flex items-center gap-3 text-left disabled:opacity-50">
                <span className="w-9 h-9 rounded-full bg-[#F3F4F6] text-[#6B7280] flex items-center justify-center shrink-0">
                  <MapPin className="w-[17px] h-[17px]" strokeWidth={2.5} />
                </span>
                <span className="flex-1 font-extrabold text-[16.5px] tracking-[-0.2px] text-[#1F2937]">{site.name}</span>
                <span className="text-[13px] font-semibold text-[#2563EB]">작업 시작</span>
              </button>
            ))}
          </>
        )}

        {hasDoneToday && (
          <div className="w-full bg-white rounded-[22px] px-4 py-3.5 shadow-[0_4px_12px_rgba(0,0,0,0.06)] flex items-center gap-x-3">
            <div className="w-[35px] h-[35px] bg-[#23C160] flex items-center justify-center rounded-full shrink-0">
              <Clock className="w-4 h-4 text-white" strokeWidth={3} />
            </div>
            <div className="flex-1 pr-1">
              <div className="font-semibold text-xs text-gray-600">오늘 누적 작업시간</div>
            </div>
            <span className="font-extrabold text-[#23C160] text-[17px]">{formatHoursMinutes(totalHours)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function SiteCard({ site, log, busy, onStart, onComplete, onCancelStart, onCancelComplete }) {
  const status = !log ? 'before' : log.status === 'working' ? 'working' : 'done';
  const started = !!log?.clockIn;
  const completed = !!log?.clockOut;
  const onCancel = status === 'done' ? onCancelComplete : onCancelStart;

  return (
    <div className={`bg-white rounded-[22px] shadow-[0_4px_12px_rgba(0,0,0,0.06)] overflow-hidden ${
      status !== 'before' ? 'border-l-[6px] border-l-[#2563EB]' : ''
    }`}>
      <div className="px-5 pt-[18px] pb-4">
        <div className="flex justify-between items-start">
          <div className="flex gap-x-2.5">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
              status === 'before' ? 'bg-[#F3F4F6] text-[#6B7280]' : 'bg-[#EBF0FE] text-[#2563EB]'
            }`}>
              <MapPin className="w-[17px] h-[17px]" strokeWidth={2.5} />
            </span>
            <div>
              <div className="font-extrabold text-[16.5px] tracking-[-0.2px] text-[#1F2937]">{site?.name || '현장 미지정'}</div>
              {site?.address && <div className="text-xs text-[#64748B] -mt-px">{site.address}</div>}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {status === 'before' ? (
              <div className="px-[9px] py-[1px] rounded-full bg-[#F2F3F5]">
                <span className="text-[11.5px] px-1 font-medium text-[#6B7280]">{WORK_STATUS_LABEL[status]}</span>
              </div>
            ) : (
              <div className="flex items-center px-3 py-[3px] bg-[#EFF3FF] rounded-[20px]">
                <span className={`w-[5.5px] h-[5.5px] rounded-full mr-1 ${status === 'done' ? 'bg-emerald-600' : 'bg-[#2563EB]'}`} />
                <span className={`font-semibold text-xs tracking-[-0.1px] ${status === 'done' ? 'text-emerald-600' : 'text-[#2563EB]'}`}>
                  {WORK_STATUS_LABEL[status]}
                </span>
              </div>
            )}
          </div>
        </div>

        {status === 'before' ? (
          <>
            <button type="button" onClick={onStart} disabled={busy}
              className="mt-[11px] w-full flex items-center justify-center gap-1.5 py-[9.5px] bg-[#2563EB] active:bg-[#1E40AF] transition-colors rounded-[24px] disabled:opacity-50">
              <Play className="w-5 h-5 text-white fill-white" />
              <span className="text-white text-[14.5px] font-semibold">작업 시작하기</span>
            </button>
            <div className="mt-3 flex items-center gap-2 px-3 py-[6.5px] bg-[#F4F6FA] rounded-[14px]">
              <span className="text-xs font-medium text-[#64748B]">● 아직 작업을 시작하지 않았어요.</span>
            </div>
          </>
        ) : (
          <>
            {status === 'working' && (
              <div className="mt-[14px] flex items-center gap-2">
                <button type="button" onClick={onComplete} disabled={busy}
                  className="flex-1 flex items-center justify-center gap-1.5 py-[10px] bg-[#2563EB] active:bg-[#1E40AF] transition-colors rounded-[22px] disabled:opacity-50">
                  <Play className="w-5 h-5 text-white fill-white" />
                  <span className="text-white text-[14.8px] font-semibold">작업 완료하기</span>
                </button>
                <button type="button" onClick={onCancel} disabled={busy}
                  className="shrink-0 px-3.5 py-[10px] rounded-[22px] border border-red-200 bg-red-50 text-red-400 text-[13px] font-semibold active:bg-red-100 disabled:opacity-50">
                  되돌리기
                </button>
              </div>
            )}
            {status === 'done' && (
              <div className="mt-[14px] flex items-center gap-2">
                <div className="flex-1 flex items-center justify-center gap-1.5 py-[10px] bg-emerald-50 rounded-[22px]">
                  <Clock className="w-3.5 h-3.5 text-emerald-600" strokeWidth={3} />
                  <span className="text-emerald-700 text-[14px] font-semibold">
                    오늘 {log.hours != null ? formatHoursMinutes(log.hours) : '0시간'} 근무
                  </span>
                </div>
                <button type="button" onClick={onCancel} disabled={busy}
                  className="shrink-0 px-3.5 py-[10px] rounded-[22px] border border-red-200 bg-red-50 text-red-400 text-[13px] font-semibold active:bg-red-100 disabled:opacity-50">
                  되돌리기
                </button>
              </div>
            )}
            <div className={`${status === 'working' ? 'mt-3.5' : 'mt-[14px]'} px-4 py-[11px] bg-[#F4F6FA] rounded-[15px] grid grid-cols-2 items-center`}>
              <div className="flex items-center justify-center pr-4 border-r border-gray-300">
                <Clock className="w-4 h-4 mr-2 text-[#2563EB]" strokeWidth={3} />
                <div>
                  <span className="block text-[11px] text-[#64748B] font-medium leading-none tracking-wide">작업 시작</span>
                  <span className="font-extrabold text-[#2563EB] text-[19.5px] leading-none tracking-wide">
                    {started ? formatTimeOnly(log.clockIn) : '- : -'}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-center pl-4">
                <Clock className={`w-4 h-4 mr-2 ${completed ? 'text-emerald-600' : 'text-[#94A3B8]'}`} strokeWidth={3} />
                <div>
                  <span className="block text-[11px] text-[#64748B] font-medium leading-none tracking-wide">작업 완료</span>
                  <span className={`font-extrabold text-[19.5px] leading-none tracking-wide ${completed ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {completed ? formatTimeOnly(log.clockOut) : '- : -'}
                  </span>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
