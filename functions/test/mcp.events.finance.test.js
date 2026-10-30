// 공용 MCP: 일정 사진 첨부(url/base64 업로드) + 정산 정보(finance) 입력·조회 검증
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFakeDb } from "./helpers/fakeFirestore.js";
import { __setDbForTest, __setBucketForTest } from "../mcp/lib/db.js";
import { createMcpServer } from "../mcp/server.js";
import { OWNER_AGENT } from "../mcp/lib/agents.js";

const CO = "co1";
let db, bucket;

function createFakeBucket() {
  const files = {};
  return {
    name: "fake-bucket.appspot.com",
    file(path) {
      return {
        async save(buffer, opts) {
          files[path] = { buffer, opts };
        },
      };
    },
    _files: files,
  };
}

beforeEach(async () => {
  db = createFakeDb();
  __setDbForTest(db);
  bucket = createFakeBucket();
  __setBucketForTest(bucket);
  await db.doc(`companies/${CO}/cals/cal1`).set({ label: "A팀" });
  await db.doc(`companies/${CO}/events/ev1`).set({ title: "상암동 정기청소", start: "2026-10-30", end: "2026-10-30", calId: "cal1" });
});

async function connect() {
  const server = createMcpServer(CO, OWNER_AGENT);
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

test("사진 첨부: base64는 Storage에 업로드돼 url로 저장, 이미 있는 url은 그대로", async () => {
  const { call } = await connect();
  const base64 = Buffer.from("fake-image-bytes").toString("base64");
  const r = await call("update_event", {
    eventId: "ev1",
    patch: { photos: [
      { name: "before.jpg", dataBase64: base64, mimeType: "image/jpeg" },
      { name: "already.jpg", url: "https://example.com/already.jpg" },
    ] },
  });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.updated.photos.length, 2);
  const uploaded = r.data.updated.photos.find(p => p.name === "before.jpg");
  assert.ok(uploaded.url.includes("firebasestorage.googleapis.com"), uploaded.url);
  assert.equal(r.data.updated.photos.find(p => p.name === "already.jpg").url, "https://example.com/already.jpg");
  // 실제로 버킷에 바이트가 저장됐는지
  const savedPath = Object.keys(bucket._files).find(p => p.includes("before.jpg"));
  assert.ok(savedPath, "업로드된 파일이 fake bucket에 없음");
  assert.equal(bucket._files[savedPath].buffer.toString(), "fake-image-bytes");

  const got = await call("get_event", { eventId: "ev1" });
  assert.equal(got.data.photos.length, 2);
  assert.equal(got.data.photos[0].path, undefined, "조회 결과에 내부 storage path가 노출되면 안 됨");
});

test("사진 첨부: dataBase64도 url도 없으면 거부", async () => {
  const { call } = await connect();
  const r = await call("update_event", { eventId: "ev1", patch: { photos: [{ name: "x.jpg" }] } });
  assert.equal(r.isError, true);
});

test("정산 정보: 팀장 일괄 지급 입력·조회·손익 계산", async () => {
  const { call } = await connect();
  const r = await call("set_event_finance", {
    eventId: "ev1",
    revenue: 350000,
    payMethod: "leader_lump",
    leaderPay: { amount: 150000, status: "paid" },
    extraCosts: [{ label: "주차비", amount: 5000 }],
    workers: [{ name: "이영희", role: "leader" }, { name: "박지훈", role: "member" }],
  });
  assert.equal(r.isError, false, r.text);
  assert.equal(r.data.profit, 195000);

  const got = await call("get_event", { eventId: "ev1" });
  assert.equal(got.data.finance.revenue, 350000);
  assert.equal(got.data.finance.leaderPay.status, "paid");
});

test("정산 정보: 팀원 직접 지급인데 memberPays 없으면 거부", async () => {
  const { call } = await connect();
  const r = await call("set_event_finance", {
    eventId: "ev1", revenue: 100000, payMethod: "member_direct",
  });
  assert.equal(r.isError, true);
});

test("정산 정보: 없는 일정이면 거부", async () => {
  const { call } = await connect();
  const r = await call("set_event_finance", {
    eventId: "nope", revenue: 1, payMethod: "leader_lump", leaderPay: { amount: 1 },
  });
  assert.equal(r.isError, true);
});
