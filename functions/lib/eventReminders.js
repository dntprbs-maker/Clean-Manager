import { createHash } from 'node:crypto';
import { expandRecurring } from './appRecurrence.js';
import { reminderModes, reminderTime, seoulDate } from './eventReminderTimes.js';

const DAY = 86_400_000;
export const REMINDER_GRACE = 5 * 60_000;

export function canRemind(event) {
  return !event.mcpTest && !event.completed
    && !['deleted', 'cancelled', 'canceled', 'completed', '취소', '완료'].includes(event.status)
    && !/^(🔵|✅|🚫)/u.test((event.title || '').trimStart());
}

export function hasReminderSettings(event) {
  return !!event && (reminderModes(event).length > 0
    || Object.values(event.exceptions || {}).some(exception => exception && reminderModes(exception).length > 0));
}

export function planReminders(event, now, previous = []) {
  const horizon = now + 14 * DAY;
  const start = seoulDate(now - REMINDER_GRACE);
  const end = seoulDate(horizon + 2 * DAY);
  const recurring = ['daily', 'weekly', 'monthly', 'yearly'].includes(event.repeat);
  const previousKeys = new Set(previous.map(item => `${item.key}:${item.at}`));
  const occurrences = recurring ? expandRecurring([event], { start, end, evaluationDate: seoulDate(now) }) : [event];
  const plans = [];
  for (const occurrence of occurrences) {
    if (!canRemind(occurrence)) continue;
    for (const mode of reminderModes(occurrence)) {
      const at = reminderTime(occurrence, mode);
      const original = occurrence._origDate || '';
      const key = `${original || 'single'}_${mode}`;
      if (at === null || at <= now - REMINDER_GRACE || (at <= now && !previousKeys.has(`${key}:${at}`))) continue;
      if (recurring && at >= horizon + DAY) continue;
      plans.push({ key, mode, at, original, date: occurrence.start });
    }
  }
  plans.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
  const futureSeries = recurring && (!event.repeatUntil || event.repeatUntil >= seoulDate(horizon)
    || Object.values(event.exceptions || {}).some(exception => exception?.start >= seoulDate(horizon)));
  const nextAt = nextReminderWake(plans, futureSeries ? horizon : null);
  return { plans, nextAt, checkpoint: futureSeries ? horizon : null };
}

function nextReminderWake(plans, checkpoint) {
  if (checkpoint == null) return plans[0]?.at ?? null;
  return Math.min(plans[0]?.at ?? checkpoint, checkpoint);
}

export function reminderOccurrence(event, plan) {
  const occurrence = plan.original
    ? expandRecurring([event], { start: plan.date, end: plan.date })
      .find(item => item._origDate === plan.original && item.start === plan.date)
    : event;
  return occurrence && canRemind(occurrence) && reminderModes(occurrence).includes(plan.mode)
    && reminderTime(occurrence, plan.mode) === plan.at ? occurrence : null;
}

// This namespace is covered by the existing server-only appAuth rule exclusion.
export function reminderRef(db, source) {
  const key = createHash('sha256').update(source.path).digest('hex');
  return db.doc(`appAuthEventReminders/${key}`);
}

export async function syncReminders(db, source, queue, now = Date.now(), refresh = false) {
  await db.runTransaction(async tx => {
    const [event, existing] = await tx.getAll(source, queue);
    const old = existing.data();
    if (!refresh && event.updateTime && old?.version.isEqual(event.updateTime)) return;
    const data = event.data();
    const next = hasReminderSettings(data) ? planReminders(data, now, old?.plans) : null;
    if (next?.nextAt != null) tx.set(queue, { source: source.path, version: event.updateTime, ...next });
    else if (existing.exists) tx.delete(queue);
  });
}

export async function claimReminder(db, source, queue, plan, version, now = Date.now()) {
  if (plan.at > now) return false;
  return db.runTransaction(async tx => {
    const receipt = queue.collection('deliveries').doc(plan.key);
    const [event, pending, sent] = await tx.getAll(source, queue, receipt);
    const data = pending.data();
    if (!data?.version.isEqual(version) || !event.updateTime?.isEqual(version)
      || data.plans[0]?.key !== plan.key || data.plans[0]?.at !== plan.at) return false;
    const plans = data.plans.slice(1);
    const nextAt = nextReminderWake(plans, data.checkpoint);
    if (nextAt == null) tx.delete(queue);
    else tx.update(queue, { plans, nextAt });
    if (sent.exists || now >= plan.at + REMINDER_GRACE) return false;
    // Claim before FCM. A transport timeout may already have delivered the push.
    tx.create(receipt, { claimedAt: now });
    return true;
  });
}
