// watch 채널 생성/교체/중지 + 알림(webhook) 검증.
import crypto from "node:crypto";
import { COL, CHANNEL_TTL_SECONDS, CHANNEL_RENEW_BEFORE_MS } from "./config.js";
import { randomToken, sha256, safeEqual } from "./crypto.js";
import { getAccessToken, calRef, patchState } from "./store.js";

const chRef = (db, id) => db.collection(COL.channels).doc(id);

// 새 채널을 만든다. 구글이 생성 직후 "sync" 알림을 바로 보낼 수 있어서, watch 호출 전에
// 채널 문서(토큰 해시 포함)를 먼저 저장해 둔다(그래야 첫 알림도 검증 가능).
export async function createChannel(deps, key, state) {
  const { db, google, tokenKey, now, webhookUrl } = deps;
  const accessToken = await getAccessToken({ db, google, tokenKey, key, now });
  const id = crypto.randomUUID();
  const token = randomToken(32);
  await chRef(db, id).set({
    key, companyId: state.companyId, calId: state.calId, googleCalendarId: state.googleCalendarId,
    tokenHash: sha256(token), status: "pending", createdAt: now(),
  });
  let res;
  try {
    res = await google.watchEvents(accessToken, state.googleCalendarId, { id, token, address: webhookUrl, ttlSeconds: CHANNEL_TTL_SECONDS });
  } catch (e) {
    await chRef(db, id).set({ status: "failed", error: (e?.message || String(e)).slice(0, 300) }, { merge: true });
    throw e;
  }
  const expiration = Number(res?.expiration) || now() + CHANNEL_TTL_SECONDS * 1000;
  await chRef(db, id).set({ status: "active", resourceId: res?.resourceId || null, expiration }, { merge: true });
  await patchState(db, key, { channelId: id, channelExpiresAt: expiration, channelResourceId: res?.resourceId || null });
  return { id, resourceId: res?.resourceId, expiration };
}

// 채널 중지(실패해도 진행 — 어차피 만료되면 알림이 끊기고, 남은 알림은 webhook이 무시한다)
export async function stopChannel(deps, key, channelId) {
  const { db, google, tokenKey, now } = deps;
  if (!channelId) return;
  const snap = await chRef(db, channelId).get();
  const ch = snap.data();
  if (!ch || ch.status === "stopped") return;
  try {
    if (ch.resourceId) {
      const accessToken = await getAccessToken({ db, google, tokenKey, key, now });
      await google.stopChannel(accessToken, { id: channelId, resourceId: ch.resourceId });
    }
  } catch (e) {
    // 404 = 이미 만료/중지된 채널
    if (e?.status !== 404) console.warn(`[gcal] 채널 중지 실패 ${channelId}:`, e?.message || e);
  }
  await chRef(db, channelId).set({ status: "stopped", stoppedAt: now() }, { merge: true });
}

// 채널이 없거나 곧 만료되면 새로 만들고 예전 채널은 중지. (겹치는 동안 알림이 두 번 와도 동기화는 멱등)
export async function ensureChannel(deps, key, state, { force = false } = {}) {
  const { now } = deps;
  const fresh = state.channelId && state.channelExpiresAt && state.channelExpiresAt - now() > CHANNEL_RENEW_BEFORE_MS;
  if (fresh && !force) return { renewed: false };
  const oldId = state.channelId;
  const created = await createChannel(deps, key, state);
  if (oldId && oldId !== created.id) await stopChannel(deps, key, oldId);
  return { renewed: true, ...created };
}

// ── webhook 검증 ───────────────────────────────────────────────────────
// 반환: { httpStatus, action: "ignore"|"sync"|"ack", key?, reason }
export async function verifyNotification(db, headers, nowMs) {
  const h = (n) => headers[n] ?? headers[n.toLowerCase()];
  const channelId = h("x-goog-channel-id");
  const token = h("x-goog-channel-token");
  const resourceId = h("x-goog-resource-id");
  const state = h("x-goog-resource-state");
  if (!channelId || !resourceId || !state) return { httpStatus: 400, action: "ignore", reason: "missing_headers" };
  if (!/^[A-Za-z0-9\-_+/=]{1,64}$/.test(channelId)) return { httpStatus: 400, action: "ignore", reason: "bad_channel_id" };

  const snap = await chRef(db, channelId).get();
  if (!snap.exists) return { httpStatus: 404, action: "ignore", reason: "unknown_channel" };
  const ch = snap.data();
  if (!token || !safeEqual(sha256(token), ch.tokenHash)) return { httpStatus: 403, action: "ignore", reason: "bad_token" };
  // resourceId는 watch 응답을 저장한 뒤부터 비교(생성 직후 sync 알림은 저장보다 먼저 올 수 있음)
  if (ch.resourceId && ch.resourceId !== resourceId) return { httpStatus: 403, action: "ignore", reason: "bad_resource" };

  // 교체·중지된 예전 채널이 보내는 알림은 정상 응답만 하고 무시(구글 재시도 방지)
  if (ch.status === "stopped" || ch.status === "failed") return { httpStatus: 200, action: "ignore", reason: "inactive_channel", key: ch.key };
  if (ch.expiration && ch.expiration < nowMs - 60_000) return { httpStatus: 200, action: "ignore", reason: "expired_channel", key: ch.key };

  // 이 채널이 현재 그 캘린더의 공식 채널인지 확인(교체 직후 겹치는 구간은 둘 다 허용)
  const calSnap = await calRef(db, ch.key).get();
  if (!calSnap.exists) return { httpStatus: 200, action: "ignore", reason: "calendar_removed", key: ch.key };

  if (state === "sync") return { httpStatus: 200, action: "ack", reason: "sync_message", key: ch.key, channelId };
  return { httpStatus: 200, action: "sync", reason: state, key: ch.key, channelId, messageNumber: Number(h("x-goog-message-number")) || null };
}

export async function recordNotification(db, channelId, info, nowMs) {
  const patch = { lastNotificationAt: nowMs, lastResourceState: info.reason };
  if (info.messageNumber) patch.lastMessageNumber = info.messageNumber;
  await chRef(db, channelId).set(patch, { merge: true }).catch(() => {});
}
