// gcal push 동기화 상위 동작 — webhook 처리, 정기 점검(채널 갱신 + 안전망 재동기화),
// 켜기/끄기, OAuth 연결. index.js가 실제 의존성(db, google 클라이언트, 비밀값)을 넣어 호출한다.
import crypto from "node:crypto";
import { COL, calKey, FULL_RESYNC_EVERY_MS } from "./config.js";
import { encryptSecret, randomToken } from "./crypto.js";
import { buildAuthUrl } from "./googleApi.js";
import { calRef, patchState, isGlobalPushEnabled, getAccessToken, forgetAccessToken } from "./store.js";
import { syncCalendar } from "./syncEngine.js";
import { ensureChannel, stopChannel, verifyNotification, recordNotification } from "./channels.js";

// ── webhook ──────────────────────────────────────────────────────────────
// 응답 코드: 검증 실패 403/404/400, 그 외엔 200. 동기화가 실패해도 200으로 답하고 오류는 상태에
// 기록한다 — 매시간 정기 점검이 다시 동기화하므로 구글의 재시도 폭주에 기대지 않는다.
export async function handleWebhook(deps, headers) {
  const { db, now } = deps;
  const v = await verifyNotification(db, headers, now());
  if (v.action === "ignore") {
    if (v.httpStatus >= 400) console.warn(`[gcalWebhook] 거부 ${v.httpStatus} ${v.reason}`);
    return { httpStatus: v.httpStatus, reason: v.reason };
  }
  await recordNotification(db, v.channelId, v, now());
  if (v.action === "ack") return { httpStatus: 200, reason: v.reason };

  if (!(await isGlobalPushEnabled(db))) return { httpStatus: 200, reason: "global_disabled" };
  const r = await syncCalendar(deps, v.key, { reason: `webhook:${v.reason}` });
  return { httpStatus: 200, reason: `sync_${r.status}`, result: r };
}

// ── 정기 점검(매시간) ──────────────────────────────────────────────────
// 1) 채널이 없거나 24시간 안에 만료되면 새 채널로 교체
// 2) 알림을 놓쳤을 경우를 대비해 증분 동기화 1회(바뀐 게 없으면 거의 비용 없음)
// 3) 마지막 전체 재동기화가 24시간 넘었으면 전체 재동기화(삭제 누락·반복 일정 창 이동 보정)
export async function runMaintenance(deps) {
  const { db, now } = deps;
  const log = [];
  if (!(await isGlobalPushEnabled(db))) {
    console.log("[gcalMaintenance] 전역 스위치 꺼짐 — 건너뜀");
    return log;
  }
  const snap = await db.collection(COL.calendars).where("enabled", "==", true).get();
  for (const doc of snap.docs) {
    const key = doc.id;
    const state = doc.data();
    if (state.needsReauth) { log.push(`${key}: 재연결 필요 — 건너뜀`); continue; }
    try {
      const ch = await ensureChannel(deps, key, state);
      if (ch.renewed) log.push(`${key}: 채널 갱신`);
    } catch (e) {
      const msg = `채널 갱신 실패: ${(e?.message || e)}`.slice(0, 500);
      log.push(`${key}: ${msg}`);
      await patchState(db, key, { lastError: msg, lastErrorAt: new Date(now()).toISOString() }).catch(() => {});
    }
    const forceFull = !state.lastFullSyncAt || now() - state.lastFullSyncAt > FULL_RESYNC_EVERY_MS;
    const r = await syncCalendar(deps, key, { forceFull, reason: forceFull ? "safety_full" : "safety_incremental" });
    log.push(`${key}: ${forceFull ? "전체" : "증분"} ${r.status}${r.error ? ` ${r.error}` : ""}`);
  }
  // 오래된 OAuth state / 중지된 채널 기록 정리
  const old = now() - 30 * 24 * 3600 * 1000;
  const states = await db.collection(COL.oauthStates).where("expiresAt", "<", now()).get();
  await Promise.all(states.docs.map((d) => d.ref.delete().catch(() => {})));
  const chans = await db.collection(COL.channels).where("status", "==", "stopped").get();
  await Promise.all(chans.docs.filter((d) => (d.data().stoppedAt || 0) < old).map((d) => d.ref.delete().catch(() => {})));
  console.log(`[gcalMaintenance] ${log.join(" | ") || "대상 없음"}`);
  return log;
}

// ── 켜기 / 끄기 ─────────────────────────────────────────────────────────
// 켜기: 채널 먼저 만들고(그 사이 변경도 알림으로 잡히게) → 전체 동기화.
export async function enableCalendar(deps, key) {
  const { db } = deps;
  const snap = await calRef(db, key).get();
  if (!snap.exists) throw new Error("연결된 캘린더가 없습니다. 먼저 구글 계정을 연결하세요.");
  if (!(await isGlobalPushEnabled(db))) throw new Error("전역 스위치(gcalConfig/global.pushEnabled)가 꺼져 있습니다. 먼저 켜세요.");
  await patchState(db, key, { enabled: true, enabledAt: new Date(deps.now()).toISOString() });
  const state = (await calRef(db, key).get()).data();
  const ch = await ensureChannel(deps, key, state, { force: true });
  const sync = await syncCalendar(deps, key, { forceFull: true, reason: "enable" });
  return { channel: ch, sync };
}

// 끄기: 스위치를 내리고 채널 중지. 일정 데이터는 그대로 둔다 → 다음 ICS 자동 동기화부터 예전 방식으로 복귀.
export async function disableCalendar(deps, key) {
  const { db } = deps;
  const snap = await calRef(db, key).get();
  if (!snap.exists) return { ok: true };
  await patchState(db, key, { enabled: false, disabledAt: new Date(deps.now()).toISOString(), syncToken: null });
  await stopChannel(deps, key, snap.data().channelId).catch(() => {});
  await patchState(db, key, { channelId: null, channelExpiresAt: null });
  return { ok: true };
}

export async function setGlobalPush(db, enabled) {
  const wasOn = await isGlobalPushEnabled(db);
  await db.collection(COL.config).doc("global").set({ pushEnabled: enabled === true, updatedAt: new Date().toISOString() }, { merge: true });
  if (enabled === true && !wasOn) {
    // 꺼져 있던 동안 ICS가 대신 동기화하며 바꾼 것(반복 회차 정리 등)을 바로잡도록
    // 다음 정기 점검에서 모든 팀을 전체 재동기화하게 표시
    const snap = await db.collection(COL.calendars).get();
    await Promise.all(snap.docs.map((d) => d.ref.set({ lastFullSyncAt: null }, { merge: true })));
  }
}

// ── 구글 비공개 iCal 주소에서 캘린더 ID 추출 ────────────────────────────
// 예) https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-xxx/basic.ics
export function calendarIdFromIcsUrl(url) {
  const m = String(url || "").match(/calendar\.google\.com\/calendar\/ical\/([^/]+)\//i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return null; }
}

// ── OAuth 연결 ──────────────────────────────────────────────────────────
export async function startOAuth(deps, { companyId, calId, googleCalendarId }) {
  const { db, clientId, redirectUri, now } = deps;
  const calSnap = await db.doc(`companies/${companyId}/cals/${calId}`).get();
  if (!calSnap.exists) throw new Error("해당 회사/팀 캘린더를 찾을 수 없습니다.");
  const gid = (googleCalendarId || "").trim() || calendarIdFromIcsUrl(calSnap.data()?.icsSubscriptionUrl);
  if (!gid) throw new Error("구글 캘린더 ID를 입력하세요(팀에 구글 iCal 구독 주소가 있으면 자동으로 찾습니다).");
  const state = randomToken(24);
  const codeVerifier = randomToken(48);
  const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  await db.collection(COL.oauthStates).doc(state).set({
    companyId, calId, googleCalendarId: gid, codeVerifier, expiresAt: now() + 10 * 60 * 1000,
  });
  return { url: buildAuthUrl({ clientId, redirectUri, state, codeChallenge }), googleCalendarId: gid };
}

export async function finishOAuth(deps, { code, state }) {
  const { db, google, tokenKey, redirectUri, now } = deps;
  if (!code || !state) throw new Error("잘못된 요청입니다(code/state 없음).");
  const stRef = db.collection(COL.oauthStates).doc(String(state));
  // 1회용: 읽으면서 바로 지움
  const st = await db.runTransaction(async (tx) => {
    const s = await tx.get(stRef);
    if (!s.exists) return null;
    tx.delete(stRef);
    return s.data();
  });
  if (!st || st.expiresAt < now()) throw new Error("연결 요청이 만료되었거나 이미 사용되었습니다. 처음부터 다시 시도하세요.");

  const tok = await google.exchangeCode({ code: String(code), redirectUri, codeVerifier: st.codeVerifier });
  if (!tok.refresh_token) throw new Error("refresh token을 받지 못했습니다. 구글 계정 설정 > 보안 > 타사 액세스에서 이 앱 권한을 삭제한 뒤 다시 연결하세요.");
  const key = calKey(st.companyId, st.calId);
  await db.collection(COL.credentials).doc(key).set({
    refreshToken: encryptSecret(tok.refresh_token, tokenKey),
    scope: tok.scope || null,
    connectedAt: new Date(now()).toISOString(),
  });
  forgetAccessToken(key);
  const prev = (await calRef(db, key).get()).data() || {};
  const calendarChanged = !!prev.googleCalendarId && prev.googleCalendarId !== st.googleCalendarId;
  // 다른 구글 캘린더로 바꿔 연결했으면 예전 채널을 멈추고 꺼진 상태로 되돌린다(다시 켜기 필요)
  if (calendarChanged && prev.enabled) await disableCalendar(deps, key);
  await patchState(db, key, {
    companyId: st.companyId,
    calId: st.calId,
    googleCalendarId: st.googleCalendarId,
    enabled: prev.enabled === true && !calendarChanged, // 같은 캘린더 재연결은 상태 유지, 신규 연결은 꺼짐
    needsReauth: false,
    connectedAt: new Date(now()).toISOString(),
    // 다른 구글 캘린더로 바꿔 연결했으면 이전 syncToken은 무효
    ...(calendarChanged ? { syncToken: null, lastFullSyncAt: null } : {}),
  });
  // 접근 확인: 캘린더를 실제로 읽을 수 있는지 1건만 조회
  const accessToken = await getAccessToken({ db, google, tokenKey, key, now });
  await google.listEvents(accessToken, st.googleCalendarId, { maxResults: 1 });
  return { key, companyId: st.companyId, calId: st.calId, googleCalendarId: st.googleCalendarId };
}
