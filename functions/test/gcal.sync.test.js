// 동기화 엔진·webhook·채널 갱신·OAuth 흐름 테스트 (가짜 Firestore + 가짜 Google)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createFakeDb } from "./helpers/fakeFirestore.js";
import { createFakeGoogle } from "./helpers/fakeGoogle.js";
import { syncCalendar } from "../lib/gcal/syncEngine.js";
import { handleWebhook, runMaintenance, enableCalendar, disableCalendar, setGlobalPush, startOAuth, finishOAuth } from "../lib/gcal/service.js";
import { isPushActive, _clearTokenCache } from "../lib/gcal/store.js";
import { encryptSecret } from "../lib/gcal/crypto.js";
import { handleAdmin } from "../lib/gcal/adminPage.js";
import { Buffer } from "node:buffer";

const TOKEN_KEY = Buffer.alloc(32, 3).toString("base64");
const KEY = "co1__cal1";
const EVENTS = "companies/co1/events";
let db, google, clock, deps;

function ev(id, over = {}) {
  return { id, iCalUID: `${id}@google.com`, summary: `일정 ${id}`, start: { dateTime: "2026-10-10T01:00:00Z" }, end: { dateTime: "2026-10-10T02:00:00Z" }, ...over };
}
const doc = (id) => db._store.get(`${EVENTS}/${id}`);
const st = () => db._store.get(`gcalCalendars/${KEY}`);

async function seedConnected({ enabled = true, global = true } = {}) {
  await db.doc("companies/co1/cals/cal1").set({ id: "cal1", name: "1팀", icsSubscriptionUrl: "https://calendar.google.com/calendar/ical/team%40group.calendar.google.com/private-x/basic.ics" });
  await db.doc(`gcalCredentials/${KEY}`).set({ refreshToken: encryptSecret("rt-1", TOKEN_KEY) });
  await db.doc(`gcalCalendars/${KEY}`).set({ companyId: "co1", calId: "cal1", googleCalendarId: "team@group.calendar.google.com", enabled });
  if (global) await setGlobalPush(db, true);
}

beforeEach(() => {
  _clearTokenCache();
  db = createFakeDb();
  google = createFakeGoogle();
  clock = Date.parse("2026-10-04T00:00:00Z");
  deps = { db, google, tokenKey: TOKEN_KEY, now: () => clock, webhookUrl: "https://example.test/gcalWebhook", clientId: "cid", redirectUri: "https://example.test/gcalAdmin/oauth/callback" };
});

test("전체 동기화 → 생성, 증분 동기화 → 수정/삭제, syncToken 저장", async () => {
  await seedConnected();
  google.upsert(ev("a")); google.upsert(ev("b")); google.upsert(ev("c"));
  let r = await syncCalendar(deps, KEY);
  assert.equal(r.status, "ok");
  assert.equal(r.results[0].mode, "full");
  assert.equal(doc("a_google_com").title, "일정 a");
  assert.equal(doc("a_google_com").source, "ics_import");
  assert.equal(doc("a_google_com").calId, "cal1");
  assert.equal(doc("a_google_com").startTime, "10:00");
  assert.ok(st().syncToken);
  assert.ok(st().lastSuccessAt);
  assert.equal(db._store.get("companies/co1/cals/cal1").gcalPushStatus.enabled, true); // 앱 표시용 복사

  google.upsert(ev("a", { summary: "바뀐 제목" }));
  google.cancel("b");
  google.upsert(ev("d"));
  r = await syncCalendar(deps, KEY);
  assert.equal(r.results[0].mode, "incremental");
  assert.equal(doc("a_google_com").title, "바뀐 제목");
  assert.equal(doc("b_google_com").status, "deleted");
  assert.equal(doc("b_google_com").deletedBy, "gcal_push");
  assert.equal(doc("d_google_com").title, "일정 d");
  assert.equal(doc("c_google_com").status, undefined);
});

test("같은 알림이 여러 번 와도(중복) 일정이 중복 생성되지 않음", async () => {
  await seedConnected();
  google.upsert(ev("a"));
  await syncCalendar(deps, KEY);
  const before = [...db._store.keys()].filter((k) => k.startsWith(EVENTS)).length;
  for (let i = 0; i < 3; i++) await syncCalendar(deps, KEY);
  const after = [...db._store.keys()].filter((k) => k.startsWith(EVENTS)).length;
  assert.equal(after, before);
  assert.equal(after, 1);
});

test("동시에 들어온 알림: 잠금 중이면 pendingResync만 남기고, 잠금 쥔 쪽이 한 번 더 돈다", async () => {
  await seedConnected();
  google.upsert(ev("a"));
  // 첫 목록 조회 도중에 두 번째 알림이 들어오는 상황 재현
  const origList = google.listEvents;
  let injected = false, second;
  google.listEvents = async (...args) => {
    if (!injected) {
      injected = true;
      google.upsert(ev("late"));
      second = await syncCalendar(deps, KEY); // 잠금 때문에 바로 반환
    }
    return origList(...args);
  };
  const first = await syncCalendar(deps, KEY);
  assert.equal(second.status, "locked");
  assert.equal(first.status, "ok");
  assert.equal(first.results.length, 2); // pending 때문에 한 번 더 돎
  assert.equal(doc("late_google_com").title, "일정 late");
  assert.equal(st().syncLockId, null);
});

test("순서 역전: 더 오래된 버전이 나중에 와도 최신 내용을 덮어쓰지 않음", async () => {
  await seedConnected();
  google.upsert(ev("a", { summary: "최신" }));
  await syncCalendar(deps, KEY);
  const newer = doc("a_google_com").gcalSync.updated;
  // 오래된 버전을 강제로 끼워 넣음
  google.upsert(ev("a", { summary: "옛날", updated: "2000-01-01T00:00:00.000Z" }));
  await syncCalendar(deps, KEY);
  assert.equal(doc("a_google_com").title, "최신");
  assert.equal(doc("a_google_com").gcalSync.updated, newer);
});

test("410 GONE → syncToken 버리고 전체 재동기화, 사라진 일정은 소프트 삭제", async () => {
  await seedConnected();
  google.upsert(ev("a")); google.upsert(ev("b"));
  await syncCalendar(deps, KEY);
  google.cancel("b");
  google.expireTokens = true;
  const r = await syncCalendar(deps, KEY);
  google.expireTokens = false;
  assert.equal(r.status, "ok");
  assert.equal(r.results[0].mode, "full");
  assert.equal(doc("b_google_com").status, "deleted");
  assert.equal(doc("a_google_com").status, undefined);
});

test("사용자가 앱에서 직접 고친 필드는 보존(ICS 동기화와 같은 규칙)", async () => {
  await seedConnected();
  google.upsert(ev("a", { location: "원래 장소" }));
  await syncCalendar(deps, KEY);
  await db.doc(`${EVENTS}/a_google_com`).update({ place: "직접 고친 장소" });
  google.upsert(ev("a", { location: "구글에서 바꾼 장소", summary: "새 제목" }));
  await syncCalendar(deps, KEY);
  assert.equal(doc("a_google_com").place, "직접 고친 장소");
  assert.equal(doc("a_google_com").title, "새 제목");
});

test("ICS 구독이 만든 기존 일정과 같은 문서를 이어서 갱신(중복 없음) + 사람이 지운 일정은 되살리지 않음", async () => {
  await seedConnected();
  const base = { title: "ICS 제목", start: "2026-10-10", startTime: "10:00", end: "2026-10-10", endTime: "11:00", allDay: false, place: "", description: "" };
  await db.doc(`${EVENTS}/a_google_com`).set({ id: "a_google_com", calId: "cal1", source: "ics_import", icsRaw: base, ...base, team: "1팀" });
  await db.doc(`${EVENTS}/b_google_com`).set({ id: "b_google_com", calId: "cal1", source: "ics_import", icsRaw: base, ...base, status: "deleted", deletedBy: "admin" });
  await db.doc(`${EVENTS}/c_google_com`).set({ id: "c_google_com", calId: "cal1", source: "ics_import", icsRaw: base, ...base, status: "deleted", deletedBy: "ics_subscription" });
  google.upsert(ev("a", { summary: "API 제목" })); google.upsert(ev("b")); google.upsert(ev("c"));
  await syncCalendar(deps, KEY);
  assert.equal(doc("a_google_com").title, "API 제목");
  assert.equal(doc("a_google_com").team, "1팀"); // 다른 필드 보존
  assert.equal(doc("b_google_com").status, "deleted"); // 사람이 지운 건 그대로
  assert.equal(doc("c_google_com").status, "active"); // 동기화가 지웠던 건 되살림
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(EVENTS)).length, 3);
});

test("반복 일정 회차: 회차별 문서, 시리즈 삭제 시 회차도 정리, 1년 넘는 회차는 안 만듦", async () => {
  await seedConnected();
  const inst = (d) => ev(`r1_${d}`, { iCalUID: "r1@google.com", recurringEventId: "r1", start: { dateTime: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T01:00:00Z` }, end: { dateTime: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T02:00:00Z` } });
  google.upsert(inst("20261010")); google.upsert(inst("20261017")); google.upsert(inst("20280101"));
  await syncCalendar(deps, KEY);
  assert.ok(doc("gcal_r1_20261010"));
  assert.ok(doc("gcal_r1_20261017"));
  assert.equal(doc("gcal_r1_20280101"), undefined);
  google.cancel("r1"); // 시리즈 원본 삭제 알림
  await syncCalendar(deps, KEY);
  assert.equal(doc("gcal_r1_20261010").status, "deleted");
  assert.equal(doc("gcal_r1_20261017").status, "deleted");
});

test("쓰기 실패 시 syncToken을 저장하지 않아 다음 동기화가 같은 변경을 다시 받음", async () => {
  await seedConnected();
  google.upsert(ev("a"));
  await syncCalendar(deps, KEY);
  const tokenBefore = st().syncToken;
  google.upsert(ev("a", { summary: "변경" }));
  db.failNextBatchCommit();
  const r = await syncCalendar(deps, KEY);
  assert.equal(r.status, "error");
  assert.equal(st().syncToken, tokenBefore);
  assert.match(st().lastError, /batch commit failed/);
  assert.equal(st().consecutiveErrors, 1);
  assert.equal(st().syncLockId, null); // 잠금은 풀림
  assert.equal(doc("a_google_com").title, "일정 a"); // 기존 데이터 그대로
  const r2 = await syncCalendar(deps, KEY);
  assert.equal(r2.status, "ok");
  assert.equal(doc("a_google_com").title, "변경");
  assert.equal(st().lastError, null);
});

test("대량 삭제 방지: 전체 재동기화에서 한꺼번에 많이 사라지면 삭제 보류, 강제 옵션으로만 진행", async () => {
  await seedConnected();
  for (let i = 0; i < 30; i++) google.upsert(ev(`e${i}`));
  google.pageSize = 100;
  await syncCalendar(deps, KEY);
  for (let i = 0; i < 30; i++) google.cancel(`e${i}`);
  const r = await syncCalendar(deps, KEY, { forceFull: true });
  assert.equal(r.results[0].deleteHeld, 30);
  assert.equal(doc("e0_google_com").status, undefined);
  assert.match(st().lastError, /삭제를 보류/);
  const r2 = await syncCalendar(deps, KEY, { forceFull: true, allowMassDelete: true });
  assert.equal(r2.results[0].removed, 30);
  assert.equal(doc("e0_google_com").status, "deleted");
});

test("스위치가 꺼져 있으면(전역 또는 팀별) 아무것도 쓰지 않음", async () => {
  await seedConnected({ enabled: false });
  google.upsert(ev("a"));
  assert.equal((await syncCalendar(deps, KEY)).status, "disabled");
  assert.equal(doc("a_google_com"), undefined);
  await db.doc(`gcalCalendars/${KEY}`).set({ enabled: true }, { merge: true });
  await setGlobalPush(db, false);
  assert.equal((await syncCalendar(deps, KEY, { forceFull: true })).status, "disabled");
  assert.equal(doc("a_google_com"), undefined);
  assert.equal(google.calls.list, 0);
});

test("ICS 자동 동기화 건너뛰기 판단: 전역+팀 스위치가 모두 켜졌을 때만", async () => {
  await seedConnected({ enabled: false, global: false });
  assert.equal(await isPushActive(db, "co1", "cal1"), false);
  await setGlobalPush(db, true);
  assert.equal(await isPushActive(db, "co1", "cal1"), false);
  await db.doc(`gcalCalendars/${KEY}`).set({ enabled: true }, { merge: true });
  assert.equal(await isPushActive(db, "co1", "cal1"), true);
  const broken = { collection: () => { throw new Error("db down"); } };
  assert.equal(await isPushActive(broken, "co1", "cal1"), false); // 오류 시 ICS 유지
});

test("refresh token 무효(invalid_grant) → 재연결 필요 표시 + 오류 기록", async () => {
  await seedConnected();
  google.failRefresh = "invalid_grant";
  const r = await syncCalendar(deps, KEY);
  assert.equal(r.status, "error");
  assert.equal(st().needsReauth, true);
  assert.equal(db._store.get("companies/co1/cals/cal1").gcalPushStatus.needsReauth, true);
});

// ── webhook ──
async function enabledWithChannel() {
  await seedConnected({ enabled: false });
  google.upsert(ev("a"));
  await enableCalendar(deps, KEY);
  const w = google.calls.watch.at(-1);
  return { id: w.id, token: w.token, resourceId: "res-team@group.calendar.google.com" };
}
const hdr = (c, over = {}) => ({ "x-goog-channel-id": c.id, "x-goog-channel-token": c.token, "x-goog-resource-id": c.resourceId, "x-goog-resource-state": "exists", "x-goog-message-number": "5", ...over });

test("켜기: 채널 생성 후 전체 동기화, webhook 주소·TTL 전달", async () => {
  const c = await enabledWithChannel();
  const w = google.calls.watch[0];
  assert.equal(w.address, "https://example.test/gcalWebhook");
  assert.equal(w.calendarId, "team@group.calendar.google.com");
  assert.equal(w.ttlSeconds, 604800);
  assert.equal(st().enabled, true);
  assert.equal(st().channelId, c.id);
  assert.ok(doc("a_google_com"));
  const ch = db._store.get(`gcalChannels/${c.id}`);
  assert.equal(ch.status, "active");
  assert.ok(!JSON.stringify(ch).includes(c.token)); // 채널 토큰은 해시만 저장
});

test("webhook: 정상 알림이면 증분 동기화 실행", async () => {
  const c = await enabledWithChannel();
  google.upsert(ev("new"));
  const r = await handleWebhook(deps, hdr(c));
  assert.equal(r.httpStatus, 200);
  assert.equal(r.reason, "sync_ok");
  assert.equal(doc("new_google_com").title, "일정 new");
  assert.equal(db._store.get(`gcalChannels/${c.id}`).lastMessageNumber, 5);
});

test("webhook: 헤더 검증 — 토큰/리소스 불일치, 모르는 채널, 헤더 누락은 거부하고 동기화 안 함", async () => {
  const c = await enabledWithChannel();
  const lists = google.calls.list;
  assert.equal((await handleWebhook(deps, hdr(c, { "x-goog-channel-token": "wrong" }))).httpStatus, 403);
  assert.equal((await handleWebhook(deps, hdr(c, { "x-goog-resource-id": "other" }))).httpStatus, 403);
  assert.equal((await handleWebhook(deps, hdr(c, { "x-goog-channel-id": "unknown-id" }))).httpStatus, 404);
  assert.equal((await handleWebhook(deps, { "x-goog-channel-id": c.id })).httpStatus, 400);
  assert.equal((await handleWebhook(deps, hdr(c, { "x-goog-channel-id": "../../x" }))).httpStatus, 400);
  assert.equal(google.calls.list, lists);
});

test("webhook: sync 확인 알림은 200만, 전역 꺼짐이면 200 + 동기화 안 함, 중지된 채널은 무시", async () => {
  const c = await enabledWithChannel();
  const lists = google.calls.list;
  assert.equal((await handleWebhook(deps, hdr(c, { "x-goog-resource-state": "sync" }))).reason, "sync_message");
  await setGlobalPush(db, false);
  assert.equal((await handleWebhook(deps, hdr(c))).reason, "global_disabled");
  assert.equal(google.calls.list, lists);
  await setGlobalPush(db, true);
  await disableCalendar(deps, KEY);
  const r = await handleWebhook(deps, hdr(c));
  assert.equal(r.httpStatus, 200);
  assert.equal(r.reason, "inactive_channel");
  assert.equal(google.calls.stop.length, 1);
});

test("webhook: 생성 직후 resourceId 저장 전에 온 sync 알림도 토큰으로 검증되어 수락", async () => {
  await seedConnected({ enabled: false });
  const orig = google.watchEvents;
  let early;
  google.watchEvents = async (at, cal, ch) => {
    early = await handleWebhook(deps, { "x-goog-channel-id": ch.id, "x-goog-channel-token": ch.token, "x-goog-resource-id": "res-x", "x-goog-resource-state": "sync" });
    return orig(at, cal, ch);
  };
  await enableCalendar(deps, KEY);
  assert.equal(early.httpStatus, 200);
  assert.equal(early.reason, "sync_message");
});

// ── 정기 점검 ──
test("정기 점검: 만료 임박 채널 교체(예전 채널 중지), 24시간 지나면 전체 재동기화, 그 외엔 증분", async () => {
  const c = await enabledWithChannel();
  // 1시간 뒤: 채널 신선, 전체 동기화 1시간 전 → 증분
  clock += 3600 * 1000;
  await runMaintenance(deps);
  assert.equal(google.calls.watch.length, 1);
  assert.equal(st().lastSyncReason, "safety_incremental");
  // 6.5일 뒤: 만료 24시간 이내 → 교체 + 전체 재동기화
  clock += 6.5 * 24 * 3600 * 1000;
  await db.doc(`gcalCalendars/${KEY}`).set({ channelExpiresAt: clock + 3600 * 1000 }, { merge: true });
  await runMaintenance(deps);
  assert.equal(google.calls.watch.length, 2);
  assert.notEqual(st().channelId, c.id);
  assert.equal(google.calls.stop.at(-1).id, c.id);
  assert.equal(db._store.get(`gcalChannels/${c.id}`).status, "stopped");
  assert.equal(st().lastSyncReason, "safety_full");
});

test("정기 점검: 알림을 놓쳐도 다음 점검에서 변경이 반영됨(복구)", async () => {
  await enabledWithChannel();
  google.upsert(ev("missed")); // 알림이 오지 않은 변경
  clock += 3600 * 1000;
  await runMaintenance(deps);
  assert.equal(doc("missed_google_com").title, "일정 missed");
});

test("정기 점검: 전역 스위치 꺼짐이면 아무것도 안 함, 재연결 필요한 팀은 건너뜀", async () => {
  await enabledWithChannel();
  const lists = google.calls.list;
  await setGlobalPush(db, false);
  await runMaintenance(deps);
  assert.equal(google.calls.list, lists);
  await setGlobalPush(db, true);
  await db.doc(`gcalCalendars/${KEY}`).set({ needsReauth: true }, { merge: true });
  const log = await runMaintenance(deps);
  assert.match(log.join(), /재연결 필요/);
  assert.equal(google.calls.list, lists);
});

// ── OAuth ──
test("OAuth: 시작 → 콜백 → refresh token 암호화 저장, 신규 연결은 꺼진 상태, state는 1회용", async () => {
  await db.doc("companies/co1/cals/cal1").set({ id: "cal1", icsSubscriptionUrl: "https://calendar.google.com/calendar/ical/team%40group.calendar.google.com/private-x/basic.ics" });
  const s = await startOAuth(deps, { companyId: "co1", calId: "cal1" });
  assert.equal(s.googleCalendarId, "team@group.calendar.google.com");
  const state = new URL(s.url).searchParams.get("state");
  const r = await finishOAuth(deps, { code: "good-code", state });
  assert.equal(r.key, KEY);
  const cred = db._store.get(`gcalCredentials/${KEY}`);
  assert.ok(!JSON.stringify(cred).includes("rt-secret-value"));
  assert.equal(st().enabled, false);
  assert.equal(st().googleCalendarId, "team@group.calendar.google.com");
  await assert.rejects(finishOAuth(deps, { code: "good-code", state }), /만료되었거나 이미 사용/);
  await assert.rejects(startOAuth(deps, { companyId: "co1", calId: "nope" }), /찾을 수 없습니다/);
});

test("OAuth: state 만료 시 거부", async () => {
  await db.doc("companies/co1/cals/cal1").set({ id: "cal1" });
  const s = await startOAuth(deps, { companyId: "co1", calId: "cal1", googleCalendarId: "x@group.calendar.google.com" });
  clock += 11 * 60 * 1000;
  await assert.rejects(finishOAuth(deps, { code: "good-code", state: new URL(s.url).searchParams.get("state") }), /만료/);
});

test("켜기는 전역 스위치가 꺼져 있으면 거부", async () => {
  await seedConnected({ enabled: false, global: false });
  await assert.rejects(enableCalendar(deps, KEY), /전역 스위치/);
  assert.equal(st().enabled, false);
});

// ── 관리 페이지 ──
test("관리 페이지: 패스프레이즈 없거나 틀리면 거부, 맞으면 상태 화면", async () => {
  await seedConnected();
  const d = { ...deps, passphrase: "correct horse" };
  assert.equal((await handleAdmin(d, { method: "GET", path: "/" })).status, 200);
  const bad = await handleAdmin(d, { method: "POST", path: "/global", body: { passphrase: "nope", enabled: "0" } });
  assert.equal(bad.status, 401);
  assert.equal(db._store.get("gcalConfig/global").pushEnabled, true); // 바뀌지 않음
  const noSecret = await handleAdmin({ ...deps, passphrase: "" }, { method: "POST", path: "/status", body: { passphrase: "" } });
  assert.equal(noSecret.status, 401);
  const ok = await handleAdmin(d, { method: "POST", path: "/status", body: { passphrase: "correct horse" } });
  assert.equal(ok.status, 200);
  assert.match(ok.html, /co1/);
  const off = await handleAdmin(d, { method: "POST", path: "/global", body: { passphrase: "correct horse", enabled: "0" } });
  assert.equal(off.status, 200);
  assert.equal(db._store.get("gcalConfig/global").pushEnabled, false);
  const conn = await handleAdmin(d, { method: "POST", path: "/connect", body: { passphrase: "correct horse", companyId: "co1", calId: "cal1" } });
  assert.equal(conn.status, 303);
  assert.match(conn.redirect, /^https:\/\/accounts\.google\.com\//);
  // 구글이 되돌려 보내는 콜백 경로(…/gcalAdmin/oauth/callback)
  const cancelled = await handleAdmin(d, { method: "GET", path: "/oauth/callback", query: { error: "access_denied" } });
  assert.equal(cancelled.status, 400);
  const st8 = new URL(conn.redirect).searchParams.get("state");
  const done = await handleAdmin(d, { method: "GET", path: "/oauth/callback", query: { code: "good-code", state: st8 } });
  assert.equal(done.status, 200);
  assert.match(done.html, /연결 완료/);
  // 관리 페이지 HTML에 비밀값이 새지 않음
  const page = await handleAdmin({ ...d, adminBaseUrl: "https://x/gcalAdmin" }, { method: "POST", path: "/status", body: { passphrase: "correct horse" } });
  assert.match(page.html, /<base href="https:\/\/x\/gcalAdmin\/">/);
  assert.ok(!page.html.includes("rt-secret-value") && !page.html.includes(TOKEN_KEY));
});
