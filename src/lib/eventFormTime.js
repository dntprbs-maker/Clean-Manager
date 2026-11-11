import { seoulToday } from './dateTime';

export const seoulTime = (at = new Date()) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(at);

// 날짜 선택은 유지하고, 현재 한국시간부터 한 시간의 새 일정을 만든다.
export function newEventTime(date, at = new Date()) {
  const start = date || seoulToday(at);
  const startTime = seoulTime(at);
  const end = new Date(`${start}T${startTime}:00+09:00`);
  end.setTime(end.getTime() + 3600000);
  return { start, startTime, end: seoulToday(end), endTime: seoulTime(end) };
}
