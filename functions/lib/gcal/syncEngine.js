// 구글 캘린더 → 클린메니져 일정 동기화 엔진 (syncToken 증분 동기화 + 410 시 전체 재동기화).
//
// 알림(webhook)은 "뭔가 바뀌었다"는 신호일 뿐 내용이 없다. 그래서 알림이 몇 번 오든, 순서가
// 뒤바뀌든 항상 "마지막 syncToken 이후 바뀐 것"을 구글에서 다시 받아와 문서 ID 기준으로 덮어쓴다
// → 같은 알림이 두 번 와도 일정이 중복되지 않는다(멱등).
// 같은 캘린더 동기화가 동시에 돌지 않도록 짧은 잠금(lease)을 걸고, 잠금 중에 들어온 알림은
// pendingResync 표시만 남겨 잠금을 쥔 쪽이 끝나기 전에 한 번 더 돌게 한다.
import crypto from "node:crypto";
import {
  EVENT_SOURCE, DELETED_BY, REVIVABLE_DELETED_BY, SYNC_LOCK_MS, MASS_DELETE_GUARD, MAX_PAGES,
} from "./config.js";
import { mapEvent, docIdFor, isInCreateWindow } from "./mapEvent.js";
import { getAccessToken, patchState, calRef, isGlobalPushEnabled } from "./store.js";

const TRACKED_FIELDS = ["title", "start", "startTime", "end", "endTime", "allDay", "place", "description"];
const BATCH_LIMIT = 400;

async function acquireLock(db, key, nowMs) {
  const ref = calRef(db, key);
  const lockId = crypto.randomUUID();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false, reason: "not_found" };
    const d = snap.data();
    if (d.syncLockUntil && d.syncLockUntil > nowMs) {
      tx.set(ref, { pendingResync: true }, { merge: true });
      return { ok: false, reason: "locked" };
    }
    tx.set(ref, { syncLockUntil: nowMs + SYNC_LOCK_MS, syncLockId: lockId, pendingResync: false }, { merge: true });
    return { ok: true, lockId, state: d };
  });
}

// 잠금 해제. 그 사이 pendingResync가 켜졌으면 해제하지 않고 true 반환 → 호출부가 한 번 더 돈다.
async function releaseLockOrContinue(db, key, lockId, nowMs) {
  const ref = calRef(db, key);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.data() || {};
    if (d.syncLockId !== lockId) return false; // 잠금이 만료돼 다른 실행이 가져감
    if (d.pendingResync) {
      tx.set(ref, { pendingResync: false, syncLockUntil: nowMs + SYNC_LOCK_MS }, { merge: true });
      return true;
    }
    tx.set(ref, { syncLockUntil: 0, syncLockId: null }, { merge: true });
    return false;
  });
}

async function listAll(google, accessToken, calendarId, syncToken) {
  const items = [];
  let pageToken, nextSyncToken, pages = 0;
  do {
    const page = await google.listEvents(accessToken, calendarId, { syncToken, pageToken });
    items.push(...(page?.items || []));
    pageToken = page?.nextPageToken;
    nextSyncToken = page?.nextSyncToken || nextSyncToken;
    if (++pages > MAX_PAGES) throw new Error(`페이지가 너무 많습니다(${MAX_PAGES}페이지 초과) — 동기화 중단`);
  } while (pageToken);
  if (!nextSyncToken) throw new Error("구글 응답에 nextSyncToken이 없습니다.");
  return { items, nextSyncToken };
}

async function commitWrites(db, writes) {
  for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_LIMIT)) batch.set(w.ref, w.data, { merge: true });
    await batch.commit();
  }
}

// 구글에서 받은 변경 목록을 일정 문서 쓰기 목록으로 바꾼다(순수 계산 + 기존 문서 비교).
export function planWrites({ items, existingMap, calId, calendarId, mode, nowMs, eventsRef }) {
  const nowIso = new Date(nowMs).toISOString();
  const writes = new Map(); // docId → data (같은 동기화 안에서 같은 문서가 두 번 나오면 나중 것만)
  const seen = new Set();
  const stats = { upserted: 0, deleted: 0, revived: 0, skippedOld: 0, skippedStale: 0 };

  const softDelete = (docId) => {
    const ex = existingMap.get(docId);
    if (!ex) { writes.delete(docId); return; } // 같은 동기화 안에서 생겼다가 곧바로 취소된 일정
    if (ex.status === "deleted") return;
    writes.set(docId, { status: "deleted", deletedAt: nowIso, deletedBy: DELETED_BY });
    stats.deleted++;
  };

  // 구글은 취소(삭제)된 일정을 증분 동기화로 보낼 때 id/status 만 주고 iCalUID 를 빼므로,
  // 문서 ID(iCalUID 기반)를 계산할 수 없다 → 저장해 둔 gcalSync.eventId 로 기존 문서를 찾는다.
  const docIdByEventId = new Map();
  for (const [id, ex] of existingMap) if (ex.gcalSync?.eventId) docIdByEventId.set(ex.gcalSync.eventId, id);

  for (const ev of items) {
    if (ev.status === "cancelled") {
      softDelete(docIdByEventId.get(ev.id) || docIdFor(ev));
      // 반복 시리즈 전체가 삭제된 경우 — 이 시리즈로 만들어 둔 회차 문서도 함께 정리
      if (!ev.recurringEventId) {
        for (const [id, ex] of existingMap) if (ex.gcalSync?.recurringEventId === ev.id) softDelete(id);
      }
      continue;
    }
    const docId = docIdFor(ev);
    const mapped = mapEvent(ev);
    if (!mapped) continue;
    seen.add(docId);
    const existing = existingMap.get(docId);
    if (!existing && !isInCreateWindow(mapped.incoming, ev, nowMs)) { stats.skippedOld++; continue; }
    // 순서 역전 방어: 이미 더 최신 버전을 반영해 두었으면 덮어쓰지 않는다
    if (existing?.gcalSync?.updated && ev.updated && existing.gcalSync.updated > ev.updated) { stats.skippedStale++; continue; }

    const { incoming } = mapped;
    const prevRaw = existing?.icsRaw;
    const patch = {
      id: docId,
      calId,
      source: EVENT_SOURCE,
      icsRaw: incoming, // 사용자 수정 감지용 기준값 — ICS 구독과 같은 필드를 공유
      gcalSync: {
        eventId: ev.id,
        iCalUID: ev.iCalUID || null,
        recurringEventId: ev.recurringEventId || null,
        updated: ev.updated || null,
        calendarId,
        syncedAt: nowIso,
      },
    };
    for (const f of TRACKED_FIELDS) {
      // 사용자가 마지막 동기화 이후 앱에서 직접 고친 필드는 보존(기존 ICS 동기화와 같은 규칙)
      const userEdited = existing && prevRaw && existing[f] !== prevRaw[f];
      if (!userEdited) patch[f] = incoming[f];
    }
    if (existing?.status === "deleted") {
      // 동기화가 지웠던 일정이 구글에 다시 나타남(휴지통 복원 등) → 되살림. 사람이 지운 건 그대로 둔다.
      if (!REVIVABLE_DELETED_BY.includes(existing.deletedBy)) continue;
      Object.assign(patch, { status: "active", deletedAt: null, deletedBy: null });
      stats.revived++;
    }
    writes.set(docId, patch);
    stats.upserted++;
  }

  // 전체 재동기화일 때만: 구글 목록에 없는 기존 문서는 소프트 삭제
  let stale = [];
  if (mode === "full") {
    stale = [...existingMap.entries()]
      .filter(([id, ex]) => ex.status !== "deleted" && !seen.has(id) && !writes.has(id))
      .map(([id]) => id);
  }
  return {
    writes: [...writes.entries()].map(([id, data]) => ({ ref: eventsRef.doc(id), data })),
    stale,
    stats,
  };
}

async function runOnce(deps, key, state, { forceFull, allowMassDelete }) {
  const { db, google, tokenKey, now } = deps;
  const { companyId, calId, googleCalendarId } = state;
  const accessToken = await getAccessToken({ db, google, tokenKey, key, now });

  let mode = forceFull || !state.syncToken ? "full" : "incremental";
  let result;
  try {
    result = await listAll(google, accessToken, googleCalendarId, mode === "incremental" ? state.syncToken : undefined);
  } catch (e) {
    if (e?.status !== 410) throw e;
    // syncToken 만료(410 GONE) → 저장된 토큰을 버리고 전체 재동기화
    console.warn(`[gcal] ${key} syncToken 만료(410) → 전체 재동기화`);
    await calRef(db, key).set({ syncToken: null }, { merge: true });
    mode = "full";
    result = await listAll(google, accessToken, googleCalendarId, undefined);
  }

  const eventsRef = db.collection(`companies/${companyId}/events`);
  const prevSnap = await eventsRef.where("source", "==", EVENT_SOURCE).where("calId", "==", calId).get();
  const existingMap = new Map(prevSnap.docs.map((d) => [d.id, d.data()]));
  const nowMs = now();
  const plan = planWrites({ items: result.items, existingMap, calId, calendarId: googleCalendarId, mode, nowMs, eventsRef });

  // 대량 삭제 방지: 전체 재동기화에서 기존 일정이 한꺼번에 많이 사라지면 잘못된 캘린더 연결 등을
  // 의심하고 삭제만 보류(추가/수정은 반영). 관리 페이지의 "강제 전체 재동기화"로만 진행.
  const activeCount = [...existingMap.values()].filter((d) => d.status !== "deleted").length;
  let deleteHeld = false;
  if (plan.stale.length >= MASS_DELETE_GUARD.minCount && plan.stale.length > activeCount * MASS_DELETE_GUARD.ratio && !allowMassDelete) {
    deleteHeld = true;
  } else {
    const nowIso = new Date(nowMs).toISOString();
    for (const id of plan.stale) {
      plan.writes.push({ ref: eventsRef.doc(id), data: { status: "deleted", deletedAt: nowIso, deletedBy: DELETED_BY } });
    }
  }

  await commitWrites(db, plan.writes);
  // 문서 쓰기가 전부 끝난 다음에만 syncToken을 저장 — 중간에 실패하면 다음 동기화가 같은 변경을 다시 받아온다.
  const statePatch = { syncToken: result.nextSyncToken };
  if (mode === "full") statePatch.lastFullSyncAt = nowMs;
  await calRef(db, key).set(statePatch, { merge: true });

  return {
    mode,
    received: result.items.length,
    ...plan.stats,
    removed: deleteHeld ? 0 : plan.stale.length,
    deleteHeld: deleteHeld ? plan.stale.length : 0,
  };
}

// 한 팀 캘린더 동기화. 반환값: { status: "ok"|"locked"|"disabled"|"error", ... }
export async function syncCalendar(deps, key, { forceFull = false, allowMassDelete = false, reason = "" } = {}) {
  const { db, now } = deps;
  const lock = await acquireLock(db, key, now());
  if (!lock.ok) return { status: lock.reason };
  const lockId = lock.lockId;
  let state = lock.state;
  // 스위치가 꺼져 있으면 아무것도 쓰지 않는다(ICS 경로와 동시에 쓰면 서로의 일정을 지울 수 있음)
  if (!state.enabled || !(await isGlobalPushEnabled(db))) {
    await calRef(db, key).set({ syncLockUntil: 0, syncLockId: null, pendingResync: false }, { merge: true });
    return { status: "disabled" };
  }

  const results = [];
  try {
    let again = true, rounds = 0;
    while (again && rounds < 3) {
      rounds++;
      results.push(await runOnce(deps, key, state, { forceFull: forceFull && rounds === 1, allowMassDelete }));
      again = await releaseLockOrContinue(db, key, lockId, now());
      if (again) state = (await calRef(db, key).get()).data();
    }
    if (again) await calRef(db, key).set({ syncLockUntil: 0, syncLockId: null }, { merge: true });

    const last = results[results.length - 1];
    const nowIso = new Date(now()).toISOString();
    const held = results.find((r) => r.deleteHeld);
    await patchState(db, key, {
      lastSyncAt: nowIso,
      lastSuccessAt: nowIso,
      lastSyncMode: last.mode,
      lastSyncReason: reason || null,
      lastResult: last,
      lastError: held ? `전체 재동기화에서 ${held.deleteHeld}개 일정이 한꺼번에 사라져 삭제를 보류했습니다 — 관리 페이지에서 확인 후 강제 재동기화` : null,
      lastErrorAt: held ? nowIso : null,
      needsReauth: false,
      consecutiveErrors: 0,
    });
    return { status: "ok", results };
  } catch (e) {
    const msg = (e?.message || String(e)).slice(0, 500);
    console.error(`[gcal] ${key} 동기화 실패:`, msg);
    const nowIso = new Date(now()).toISOString();
    await calRef(db, key).set({ syncLockUntil: 0, syncLockId: null }, { merge: true }).catch(() => {});
    const prev = (await calRef(db, key).get().catch(() => null))?.data() || {};
    await patchState(db, key, {
      lastSyncAt: nowIso,
      lastError: msg,
      lastErrorAt: nowIso,
      lastSyncReason: reason || null,
      consecutiveErrors: (prev.consecutiveErrors || 0) + 1,
    }).catch(() => {});
    return { status: "error", error: msg, results };
  }
}

