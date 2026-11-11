// 공용 MCP: 일정 시각(startTime/endTime) 기본값·자정 넘김·검증
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFakeDb } from "./helpers/fakeFirestore.js";
import { __setDbForTest, __setBucketForTest } from "../mcp/lib/db.js";
import { createMcpServer } from "../mcp/server.js";
import { OWNER_AGENT } from "../mcp/lib/agents.js";

const CO = "co1";
let db;

beforeEach(async () => {
  db = createFakeDb();
  __setDbForTest(db);
  __setBucketForTest({ name: "fake", file: () => ({ async save() {} }) });
  await db.doc(`companies/${CO}/cals/cal1`).set({ label: "A팀" });
  await db.doc(`companies/${CO}/events/ev1`).set({ title: "정기청소", start: "2026-10-22", end: "2026-10-22", startTime: "10:00", endTime: "11:00", place: "강남", calId: "cal1" });
  await db.doc(`companies/${CO}/events/evAll`).set({ title: "종일", start: "2026-10-22", end: "2026-10-22", allDay: true });
});

async function connect(agent = OWNER_AGENT) {
  const server = createMcpServer(CO, agent);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { call };
}

const stored = (id) => db._store.get(`companies/${CO}/events/${id}`);
test("자정 넘는 일정을 같은 날 시간으로 변경하면 종료 날짜도 함께 조정된다", async () => {
  const { call } = await connect();
  await call("update_event", { eventId: "ev1", patch: { startTime: "23:30" } });
  const result = await call("update_event", { eventId: "ev1", patch: { startTime: "10:00" } });
  assert.equal(result.isError, false, result.text);
  assert.equal(stored("ev1").end, "2026-10-22");
  assert.equal(stored("ev1").endTime, "11:00");
});
test("create_event: 시작 시각만 주면 종료가 1시간 뒤로 채워진다", async () => {
  const { call } = await connect();
  const r = await call("create_event", { title: "신규", start: "2026-10-22", startTime: "10:00" });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.endTime, "11:00");
  assert.equal(r.data.end, "2026-10-22");
  assert.equal(stored(r.data.id).endTime, "11:00");
});

test("create_event: 23시대 시작이면 종료가 다음 날로 넘어간다", async () => {
  const { call } = await connect();
  const a = await call("create_event", { title: "야간", start: "2026-10-22", startTime: "23:30" });
  assert.equal(a.data.endTime, "00:30");
  assert.equal(a.data.end, "2026-10-23");
  const b = await call("create_event", { title: "야간2", start: "2026-10-22", startTime: "23:00" });
  assert.equal(b.data.endTime, "00:00");
  assert.equal(b.data.end, "2026-10-23");
});
test("create_event: 명시한 더 늦은 종료 날짜는 그대로 유지된다", async () => {
  const { call } = await connect();
  const r = await call("create_event", { title: "철야", start: "2026-10-22", end: "2026-10-24", startTime: "23:00", endTime: "01:00" });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.end, "2026-10-24");
  assert.equal(r.data.endTime, "01:00");
});

test("create_event: 같은 날 종료가 시작 이하이면 거부한다", async () => {
  const { call } = await connect();
  for (const endTime of ["10:00", "09:30"]) {
    const r = await call("create_event", { title: "x", start: "2026-10-22", startTime: "10:00", endTime });
    assert.equal(r.isError, true, endTime);
  }
});
test("create_event: 잘못된 시각 형식은 거부한다", async () => {
  const { call } = await connect();
  const before = [...db._store.keys()].length;
  for (const args of [
    { startTime: "25:00" }, { startTime: "9:05" }, { startTime: "10:60" }, { startTime: "abc" },
    { startTime: "10:00", endTime: "9:00" },
  ]) {
    const r = await call("create_event", { title: "x", start: "2026-10-22", ...args });
    assert.equal(r.isError, true, JSON.stringify(args));
  }
  assert.equal([...db._store.keys()].length, before);
});

test("create_event: 종일 일정은 시각 규칙을 적용하지 않는다", async () => {
  const { call } = await connect();
  const r = await call("create_event", { title: "종일", start: "2026-10-22", allDay: true, startTime: "14:00", endTime: "13:00" });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.endTime, "13:00");
  assert.equal(r.data.end, "2026-10-22");
});
test("update_event: 시작 시각만 바꾸면 종료가 1시간 뒤로 맞춰진다", async () => {
  const { call } = await connect();
  const r = await call("update_event", { eventId: "ev1", patch: { startTime: "12:00" } });
  assert.equal(r.isError, false, r.text);
  assert.equal(stored("ev1").startTime, "12:00");
  assert.equal(stored("ev1").endTime, "13:00");
  assert.equal(stored("ev1").end, "2026-10-22");
});

test("update_event: 시작 시각만 바꿔도 자정을 넘기면 종료 날짜가 다음 날이 된다", async () => {
  const { call } = await connect();
  const r = await call("update_event", { eventId: "ev1", patch: { startTime: "23:30" } });
  assert.equal(r.isError, false, r.text);
  assert.equal(stored("ev1").endTime, "00:30");
  assert.equal(stored("ev1").end, "2026-10-23");
});
test("update_event: 명시한 유효한 종료(날짜·시각)는 그대로 반영된다", async () => {
  const { call } = await connect();
  const r = await call("update_event", { eventId: "ev1", patch: { startTime: "23:00", endTime: "01:00", end: "2026-10-23" } });
  assert.equal(r.isError, false, r.text);
  assert.equal(stored("ev1").end, "2026-10-23");
  assert.equal(stored("ev1").endTime, "01:00");
});

test("update_event: 같은 날 종료가 시작 이하이면 거부하고 원본을 유지한다", async () => {
  const { call } = await connect();
  const before = structuredClone(stored("ev1"));
  assert.equal((await call("update_event", { eventId: "ev1", patch: { startTime: "14:00", endTime: "13:00" } })).isError, true);
  assert.equal((await call("update_event", { eventId: "ev1", patch: { endTime: "09:00" } })).isError, true);
  assert.deepEqual(stored("ev1"), before);
});
test("update_event: 잘못된 시각 형식은 거부하고 원본을 유지한다", async () => {
  const { call } = await connect();
  const before = structuredClone(stored("ev1"));
  assert.equal((await call("update_event", { eventId: "ev1", patch: { startTime: "9:00" } })).isError, true);
  assert.equal((await call("update_event", { eventId: "ev1", patch: { endTime: "25:00" } })).isError, true);
  assert.deepEqual(stored("ev1"), before);
});

test("update_event: 시각과 무관한 수정은 기존 시간·장소를 그대로 둔다", async () => {
  const { call } = await connect();
  const r = await call("update_event", { eventId: "ev1", patch: { title: "정기청소(수정)" } });
  assert.equal(r.isError, false, r.text);
  const s = stored("ev1");
  assert.equal(s.title, "정기청소(수정)");
  assert.equal(s.start, "2026-10-22");
  assert.equal(s.end, "2026-10-22");
  assert.equal(s.startTime, "10:00");
  assert.equal(s.endTime, "11:00");
  assert.equal(s.place, "강남");
  assert.equal(s.allDay, undefined);
});

test("update_event: 종일 일정의 종일 여부는 그대로 유지된다", async () => {
  const { call } = await connect();
  const r = await call("update_event", { eventId: "evAll", patch: { title: "종일(수정)" } });
  assert.equal(r.isError, false, r.text);
  const s = stored("evAll");
  assert.equal(s.allDay, true);
  assert.equal(s.startTime, undefined);
  assert.equal(s.endTime, undefined);
});
