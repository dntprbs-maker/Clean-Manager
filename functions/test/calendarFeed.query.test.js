import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFeedEvents } from '../lib/calendarFeedQuery.js';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function seoulDateStr(ms) {
  const d = new Date(ms + KST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function shift(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// 받은 where 조건을 기록하고, 조건에 맞는 문서만 메모리 배열에서 걸러 돌려주는 가짜 db.
function makeFakeDb(docs) {
  const queries = [];
  const match = (doc, { field, op, value }) => {
    const v = doc.data[field];
    if (op === "==") return v === value;
    if (op === ">=") return v >= value;
    if (op === "<=") return v <= value;
    if (op === "in") return Array.isArray(value) && value.includes(v);
    throw new Error(`지원하지 않는 연산자: ${op}`);
  };
  const makeQuery = (conds) => ({
    where(field, op, value) { return makeQuery([...conds, { field, op, value }]); },
    async get() {
      queries.push(conds.slice());
      return {
        docs: docs
          .filter((d) => conds.every((c) => match(d, c)))
          .map((d) => ({ id: d.id, data: () => d.data })),
      };
    },
  });
  return {
    queries,
    collection(name) {
      assert.equal(name, "companies/acme/events");
      return makeQuery([]);
    },
  };
}

const NOW_MS = Date.UTC(2026, 9, 30, 3, 0, 0); // 서울 2026-10-30 12:00
const TODAY = seoulDateStr(NOW_MS);
const doc = (id, data) => ({ id, data });

function baseDocs() {
  return [
    doc("in-range", { calId: "acme", start: shift(TODAY, -1), repeat: "none" }),
    doc("old-general", { calId: "acme", start: shift(TODAY, -8), repeat: "none" }),
    doc("far-general", { calId: "acme", start: shift(TODAY, 100), repeat: "none" }),
    doc("old-weekly", { calId: "acme", start: shift(TODAY, -365), repeat: "weekly" }),
    doc("both", { calId: "acme", start: shift(TODAY, 3), repeat: "weekly" }),
    doc("deleted", { calId: "acme", start: shift(TODAY, -1), repeat: "none", status: "deleted" }),
    doc("other-cal", { calId: "other", start: shift(TODAY, -1), repeat: "none" }),
  ];
}

test("범위 밖 일반 일정(8일 전, 100일 후)은 안 나온다", async () => {
  const db = makeFakeDb(baseDocs());
  const { events } = await loadFeedEvents(db, "acme", "acme", NOW_MS);
  const ids = events.map((e) => e.id);
  assert.ok(ids.includes("in-range"));
  assert.ok(!ids.includes("old-general"));
  assert.ok(!ids.includes("far-general"));
});

test("시작일이 1년 전인 weekly 반복 일정은 나온다", async () => {
  const db = makeFakeDb(baseDocs());
  const { events } = await loadFeedEvents(db, "acme", "acme", NOW_MS);
  assert.ok(events.some((e) => e.id === "old-weekly"));
});

test("쿼리1·쿼리2 양쪽에 걸리는 문서는 한 번만 나온다", async () => {
  const db = makeFakeDb(baseDocs());
  const { events } = await loadFeedEvents(db, "acme", "acme", NOW_MS);
  assert.equal(events.filter((e) => e.id === "both").length, 1);
});

test("deleted 는 빠진다", async () => {
  const db = makeFakeDb(baseDocs());
  const { events } = await loadFeedEvents(db, "acme", "acme", NOW_MS);
  assert.ok(!events.some((e) => e.id === "deleted"));
});

test("다른 캘린더(calId 불일치) 문서는 안 나온다", async () => {
  const db = makeFakeDb(baseDocs());
  const { events } = await loadFeedEvents(db, "acme", "acme", NOW_MS);
  assert.ok(!events.some((e) => e.id === "other-cal"));
});

test("cutoff/horizon 을 서울 기준 오늘 -7일 / +92일로 돌려준다", async () => {
  const db = makeFakeDb(baseDocs());
  const { cutoff, horizon } = await loadFeedEvents(db, "acme", "acme", NOW_MS);
  assert.equal(cutoff, shift(TODAY, -7));
  assert.equal(horizon, shift(TODAY, 92));
});

test("쿼리에 calId 조건이 항상 들어간다", async () => {
  const db = makeFakeDb(baseDocs());
  await loadFeedEvents(db, "acme", "acme", NOW_MS);
  assert.equal(db.queries.length, 2);
  for (const conds of db.queries) {
    assert.ok(
      conds.some((c) => c.field === "calId" && c.op === "==" && c.value === "acme"),
      "calId 조건 누락"
    );
  }
  // 기간 쿼리엔 start 범위가, 반복 쿼리엔 repeat in 조건이 들어간다.
  assert.ok(db.queries.some((conds) => conds.some((c) => c.field === "start" && c.op === ">=")));
  assert.ok(db.queries.some((conds) => conds.some((c) => c.field === "start" && c.op === "<=")));
  assert.ok(db.queries.some((conds) => conds.some((c) => c.field === "repeat" && c.op === "in")));
});
