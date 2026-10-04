// 순수 함수 단위 테스트: 일정 변환, 암호화, Google REST 요청 구성
import { test } from "node:test";
import assert from "node:assert/strict";
import { mapEvent, docIdFor, toKst, htmlToText, isInCreateWindow, sanitizeId } from "../lib/gcal/mapEvent.js";
import { encryptSecret, decryptSecret, safeEqual } from "../lib/gcal/crypto.js";
import { createGoogleClient, buildAuthUrl } from "../lib/gcal/googleApi.js";
import { calendarIdFromIcsUrl } from "../lib/gcal/service.js";
import { parseIcs } from "../lib/ics.js";
import { Buffer } from "node:buffer";

test("시간 일정: UTC/오프셋 시간을 KST로 변환", () => {
  const m = mapEvent({ id: "a1", iCalUID: "a1@google.com", summary: " 청소 ", location: "강남",
    start: { dateTime: "2026-10-05T01:00:00Z" }, end: { dateTime: "2026-10-05T03:30:00+00:00" } });
  assert.equal(m.docId, "a1_google_com");
  assert.deepEqual(m.incoming, { title: "청소", start: "2026-10-05", startTime: "10:00", end: "2026-10-05", endTime: "12:30", allDay: false, place: "강남", description: "" });
  assert.deepEqual(toKst("2026-10-05T23:30:00+09:00"), { date: "2026-10-05", time: "23:30" });
  assert.deepEqual(toKst("2026-10-05T20:00:00Z"), { date: "2026-10-06", time: "05:00" });
});

test("종일 일정: 구글의 배타적 end.date → 클린메니져의 마지막 날 포함 방식", () => {
  const one = mapEvent({ id: "b", iCalUID: "b@google.com", summary: "x", start: { date: "2026-10-05" }, end: { date: "2026-10-06" } });
  assert.equal(one.incoming.start, "2026-10-05");
  assert.equal(one.incoming.end, "2026-10-05");
  assert.equal(one.incoming.allDay, true);
  assert.equal(one.incoming.startTime, "09:00");
  const multi = mapEvent({ id: "c", summary: "x", start: { date: "2026-12-30" }, end: { date: "2027-01-02" } });
  assert.equal(multi.incoming.end, "2027-01-01");
});

test("문서 ID: 단일 일정은 ICS 구독과 같은 UID 기반, 반복 회차는 회차별 ID", () => {
  const ics = parseIcs("BEGIN:VEVENT\nUID:abc123@google.com\nSUMMARY:t\nDTSTART:20261005T010000Z\nEND:VEVENT");
  assert.equal(docIdFor({ id: "abc123", iCalUID: "abc123@google.com" }), ics[0].icsUid);
  assert.equal(docIdFor({ id: "abc123_20261005T010000Z", iCalUID: "abc123@google.com", recurringEventId: "abc123" }), "gcal_abc123_20261005T010000Z");
  assert.equal(sanitizeId("a".repeat(150)).length, 100);
});

test("제목 없음 / 날짜 없음 / HTML 설명 처리", () => {
  assert.equal(mapEvent({ id: "d", start: { date: "2026-10-05" }, end: { date: "2026-10-06" } }).incoming.title, "제목 없음");
  assert.equal(mapEvent({ id: "e", summary: "x" }), null);
  assert.equal(htmlToText("줄1<br>줄2 &amp; <b>굵게</b>"), "줄1\n줄2 & 굵게");
  assert.equal(htmlToText("그냥 텍스트 <3"), "그냥 텍스트 <3");
});

test("생성 범위: 30일보다 오래된 일정 제외, 반복 회차는 1년 이내만", () => {
  const now = Date.parse("2026-10-04T00:00:00Z");
  const inc = (start) => ({ start, end: start });
  assert.equal(isInCreateWindow(inc("2026-09-10"), {}, now), true);
  assert.equal(isInCreateWindow(inc("2026-08-01"), {}, now), false);
  assert.equal(isInCreateWindow(inc("2028-01-01"), {}, now), true);
  assert.equal(isInCreateWindow(inc("2028-01-01"), { recurringEventId: "r" }, now), false);
});

test("refresh token 암호화: 왕복 성공, 다른 키로는 복호화 실패, 평문이 저장값에 없음", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  const box = encryptSecret("1//refresh-token", key);
  assert.ok(!JSON.stringify(box).includes("refresh-token"));
  assert.equal(decryptSecret(box, key), "1//refresh-token");
  assert.throws(() => decryptSecret(box, Buffer.alloc(32, 8).toString("base64")));
  assert.throws(() => encryptSecret("x", ""), /GCAL_TOKEN_KEY/);
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual(undefined, "abc"), false);
});

test("Google REST 요청 구성 + 오류 해석(410, invalid_grant)", async () => {
  const reqs = [];
  const responses = [
    { status: 200, body: { items: [], nextSyncToken: "s1" } },
    { status: 410, body: { error: { errors: [{ reason: "fullSyncRequired" }], message: "Sync token is no longer valid" } } },
    { status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } },
    { status: 200, body: { id: "ch", resourceId: "r", expiration: "123" } },
    { status: 204, body: null },
  ];
  const fetchImpl = async (url, init) => {
    reqs.push({ url, init });
    const r = responses.shift();
    return { ok: r.status < 300, status: r.status, json: async () => r.body, text: async () => (r.body ? JSON.stringify(r.body) : "") };
  };
  const g = createGoogleClient({ clientId: "cid", clientSecret: "csecret", fetchImpl });

  const page = await g.listEvents("AT", "team@group.calendar.google.com", { syncToken: "tok" });
  assert.equal(page.nextSyncToken, "s1");
  const u = new URL(reqs[0].url);
  assert.equal(u.pathname, "/calendar/v3/calendars/team%40group.calendar.google.com/events");
  assert.equal(u.searchParams.get("syncToken"), "tok");
  assert.equal(u.searchParams.get("singleEvents"), "true");
  assert.equal(u.searchParams.get("timeMin"), null); // syncToken과 함께 쓰면 안 되는 파라미터
  assert.equal(reqs[0].init.headers.Authorization, "Bearer AT");

  await assert.rejects(g.listEvents("AT", "c", { syncToken: "old" }), (e) => e.status === 410 && e.reason === "fullSyncRequired");
  await assert.rejects(g.refreshAccessToken("rt"), (e) => e.status === 400 && e.reason === "invalid_grant" && !e.message.includes("rt"));
  assert.match(reqs[2].init.body, /grant_type=refresh_token/);

  await g.watchEvents("AT", "c", { id: "ch", token: "tk", address: "https://x/gcalWebhook", ttlSeconds: 600 });
  assert.deepEqual(JSON.parse(reqs[3].init.body), { id: "ch", type: "web_hook", address: "https://x/gcalWebhook", token: "tk", params: { ttl: "600" } });
  assert.equal(await g.stopChannel("AT", { id: "ch", resourceId: "r" }), null);

  const auth = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "https://x/cb", state: "st", codeChallenge: "cc" }));
  assert.equal(auth.searchParams.get("access_type"), "offline");
  assert.equal(auth.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events.readonly");
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
});

test("구글 iCal 비공개 주소에서 캘린더 ID 추출", () => {
  assert.equal(calendarIdFromIcsUrl("https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-123/basic.ics"), "abc@group.calendar.google.com");
  assert.equal(calendarIdFromIcsUrl("webcal://calendar.google.com/calendar/ical/me%40gmail.com/private-1/basic.ics"), "me@gmail.com");
  assert.equal(calendarIdFromIcsUrl("https://example.com/x.ics"), null);
});
