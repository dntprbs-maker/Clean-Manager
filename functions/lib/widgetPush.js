import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';

// 위젯에 보이는 필드만 "일정이 바뀌었다"로 취급한다 — description 등 위젯에 안 보이는
// 필드만 바뀐 경우까지 휴대폰을 깨우면 읽기 절감 효과가 사라지기 때문.
const RELEVANT_FIELDS = ['title', 'start', 'end', 'startTime', 'endTime', 'allDay', 'place', 'calId', 'status'];

/** before/after(문서 데이터 또는 null) 를 비교해 위젯이 다시 읽어야 하는 변경인지 판단한다. */
export function widgetRelevantChange(before, after) {
  const b = before || null;
  const a = after || null;
  if (!b && !a) return false;
  if (!b || !a) return true; // 생성 또는 삭제
  for (const field of RELEVANT_FIELDS) {
    if ((b[field] ?? null) !== (a[field] ?? null)) return true;
  }
  return false;
}

/** FCM 토픽 메시지 한 건을 만든다. data 값은 모두 문자열이어야 한다(FCM 규칙). */
export function buildWidgetMessage(companyId, ids, calsChanged) {
  const unique = [...new Set((ids || []).filter((id) => id != null && id !== ''))];
  return {
    topic: `widget_${companyId}`,
    data: {
      type: 'widget_changed',
      company: String(companyId),
      ids: unique.length > 20 ? 'ALL' : unique.join(','),
      cals: calsChanged ? '1' : '0',
    },
    android: { priority: 'high' },
  };
}

/**
 * 짧은 시간에 몰린 변경을 1분 묶음으로 합쳐 한 번만 발송한다.
 * widgetPush/{companyId} 문서를 큐이자 락으로 쓴다 — 맨 먼저 들어온 호출이
 * pending 을 세우고 delayMs 뒤에 큐를 비우며 발송하고, 그 사이 호출들은 id 만 합쳐둔다.
 */
export async function queueWidgetChange(db, messaging, { companyId, eventId, calsChanged }, opts = {}) {
  const {
    delayMs = 60000,
    staleMs = 180000,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = opts;

  const ref = db.doc(`widgetPush/${companyId}`);

  // 1단계: 큐에 id 합치기 + 이 호출이 발송 담당인지 결정.
  const isSender = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const ids = Array.isArray(data.ids) ? [...data.ids] : [];
    if (eventId && !ids.includes(eventId)) ids.push(eventId);
    const cals = data.cals === true || calsChanged === true;

    const startedAt = typeof data.startedAt === 'number' ? data.startedAt : 0;
    const stale = data.pending !== true || now() - startedAt > staleMs;
    if (stale) {
      // 이 호출이 발송 담당 — pending 을 세우고 시작 시각을 기록한다.
      tx.set(ref, { pending: true, startedAt: now(), ids, cals });
      return true;
    }
    // 다른 호출이 이미 담당 — 큐만 갱신하고(담당자가 delayMs 뒤 읽어감) 끝낸다.
    tx.set(ref, { pending: true, startedAt, ids, cals });
    return false;
  });

  if (!isSender) return { sender: false, sent: null };

  await sleep(delayMs);

  // 2단계: 담당자는 큐를 비우고 한 번만 발송한다.
  const collected = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const ids = Array.isArray(data.ids) ? data.ids : [];
    const cals = data.cals === true;
    tx.set(ref, { pending: false, ids: [], cals: false, startedAt: 0 });
    return { ids, cals };
  });

  if (collected.ids.length === 0 && !collected.cals) return { sender: true, sent: null };

  const message = buildWidgetMessage(companyId, collected.ids, collected.cals);
  await messaging.send(message);
  console.log(`[widgetPush] 발송 company=${companyId} ids=${message.data.ids} cals=${message.data.cals}`);
  return { sender: true, sent: message };
}

// 일정 변경 — 위젯에 보이는 필드가 바뀌었을 때만 큐에 넣는다.
export const widgetEventChanged = onDocumentWritten(
  { document: 'companies/{companyId}/events/{eventId}', region: 'asia-northeast3', timeoutSeconds: 180 },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!widgetRelevantChange(before, after)) return;
    // MCP 시험 일정(양쪽 다 mcpTest)은 위젯 알림에서도 제외한다.
    if (before?.mcpTest && after?.mcpTest) return;

    await queueWidgetChange(getFirestore(), getMessaging(), {
      companyId: event.params.companyId,
      eventId: event.params.eventId,
    });
  }
);

// 캘린더(색상) 변경 — 위젯은 팀 색상이 바뀌면 다시 그려야 한다.
export const widgetCalChanged = onDocumentWritten(
  { document: 'companies/{companyId}/cals/{calId}', region: 'asia-northeast3', timeoutSeconds: 180 },
  async (event) => {
    await queueWidgetChange(getFirestore(), getMessaging(), {
      companyId: event.params.companyId,
      calsChanged: true,
    });
  }
);
