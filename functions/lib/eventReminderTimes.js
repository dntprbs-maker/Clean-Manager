export const REMINDER_LABELS = {
  '10m': '10분 전',
  '30m': '30분 전',
  '60m': '1시간 전',
  previousNoon: '전날 정오',
};

const MINUTE = 60_000;
const DAY = 1440 * MINUTE;

export function reminderTime(event, mode) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(event.start || '')) return null;
  const midnight = Date.parse(`${event.start}T00:00:00+09:00`);
  if (!Number.isFinite(midnight) || seoulDate(midnight) !== event.start) return null;
  if (mode === 'previousNoon') return midnight - DAY / 2;
  const minutes = { '10m': 10, '30m': 30, '60m': 60 }[mode];
  if (!minutes || event.allDay || !/^([01]\d|2[0-3]):[0-5]\d$/.test(event.startTime || '')) return null;
  return Date.parse(`${event.start}T${event.startTime}:00+09:00`) - minutes * MINUTE;
}

export function seoulDate(time) {
  return new Date(time + 9 * 60 * MINUTE).toISOString().slice(0, 10);
}

export function isDailyDigestSlot(scheduleTime) {
  const time = Date.parse(scheduleTime);
  if (!Number.isFinite(time)) return false;
  const seoul = new Date(time + 9 * 60 * MINUTE);
  return seoul.getUTCHours() === 8 && seoul.getUTCMinutes() === 0;
}

export function reminderModes(event) {
  return Object.keys(REMINDER_LABELS).filter(mode =>
    Array.isArray(event.reminderModes) && event.reminderModes.includes(mode) && (!event.allDay || mode === 'previousNoon'));
}
