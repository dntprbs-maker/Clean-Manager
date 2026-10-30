// 공용 MCP: AI별 인증·권한, 일정 조회/검색/등록/수정, 삭제 요청(실삭제 금지) 검증
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFakeDb } from "./helpers/fakeFirestore.js";
import { __setDbForTest } from "../mcp/lib/db.js";
import { createMcpServer } from "../mcp/server.js";
import { findAgentByKey, loadAgent, OWNER_AGENT, generateAgentKey, DEFAULT_AGENT_SCOPES } from "../mcp/lib/agents.js";
import { sha256Hex } from "../mcp/lib/hash.js";
import { isAllowedRedirectUri } from "../mcp/oauth/clientsStore.js";
import { McpOAuthProvider } from "../mcp/oauth/provider.js";

const CO = "co1";
let db;

beforeEach(async () => {
  db = createFakeDb();
  __setDbForTest(db);
  await db.doc(`companies/${CO}/cals/cal1`).set({ label: "A팀" });
  await db.doc(`companies/${CO}/events/real1`).set({ title: "실제 청소", start: "2026-10-20", end: "2026-10-20", place: "강남", calId: "cal1" });
  await db.doc(`companies/${CO}/events/gone`).set({ title: "지운 일정", start: "2026-10-20", end: "2026-10-20", status: "deleted" });
});

async function connect(agent) {
  const server = createMcpServer(CO, agent);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
  };
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  return { call, tools };
}

const chorong = { agentId: "chorong", label: "초롱이", scopes: DEFAULT_AGENT_SCOPES };
const readOnly = { agentId: "ro", label: "읽기전용", scopes: ["events:read"] };

test("에이전트 권한에 따라 도구 목록이 달라진다 (일반 AI는 직원·팀 관리 및 실삭제 도구 없음)", async () => {
  const { tools } = await connect(chorong);
  assert.deepEqual(tools, ["create_event", "export_hub_changes", "export_hub_events", "get_event", "list_events", "list_teams", "request_event_deletion", "search_events", "update_event"]);
  assert.ok(!tools.includes("delete_event"));
  const ro = await connect(readOnly);
  assert.deepEqual(ro.tools, ["export_hub_changes", "export_hub_events", "get_event", "list_events", "list_teams", "search_events"]);
  const owner = await connect(OWNER_AGENT);
  assert.ok(owner.tools.length > tools.length);
});

test("조회: 삭제 표시 일정은 제외, 날짜·검색어 검색", async () => {
  const { call } = await connect(chorong);
  const list = await call("list_events", { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(list.data.map((e) => e.id), ["real1"]);
  assert.equal(list.data[0].team, "A팀");
  assert.equal((await call("search_events", { date: "2026-10-20", query: "강남" })).data.length, 1);
  assert.equal((await call("search_events", { date: "2026-10-21" })).data.length, 0);
  assert.ok((await call("search_events", {})).isError);
  assert.ok((await call("get_event", { eventId: "gone" })).isError);
});

test("시험 일정 등록·조회·수정: [MCP시험] 표시·작성 AI 기록 유지", async () => {
  const { call } = await connect(chorong);
  const c = await call("create_event", { title: "연결 확인", start: "2026-10-22", startTime: "10:00", endTime: "11:00", test: true, team: "A팀" });
  assert.equal(c.data.title, "[MCP시험] 연결 확인");
  const stored = db._store.get(`companies/${CO}/events/${c.data.id}`);
  assert.equal(stored.mcpTest, true);
  assert.equal(stored.mcpCreatedBy.agentId, "chorong");
  assert.equal(stored.calId, "cal1");

  const found = await call("search_events", { date: "2026-10-22", onlyTest: true });
  assert.deepEqual(found.data.map((e) => e.id), [c.data.id]);

  const u = await call("update_event", { eventId: c.data.id, patch: { title: "연결 확인2", startTime: "12:00", endTime: "13:00" } });
  assert.ok(!u.isError, u.text);
  const after = db._store.get(`companies/${CO}/events/${c.data.id}`);
  assert.equal(after.title, "[MCP시험] 연결 확인2");
  assert.equal(after.mcpUpdatedBy.label, "초롱이");
  assert.equal(after.place, undefined);
  assert.ok((await call("update_event", { eventId: c.data.id, patch: { end: "2026-10-01" } })).isError);
});

test("삭제는 요청만 남기고 일정은 그대로", async () => {
  const { call } = await connect(chorong);
  const r = await call("request_event_deletion", { eventId: "real1", reason: "테스트" });
  assert.equal(r.data.status, "pending");
  assert.ok(db._store.has(`companies/${CO}/events/real1`));
  const reqs = [...db._store.entries()].filter(([p]) => p.startsWith("mcpDeletionRequests/"));
  assert.equal(reqs.length, 1);
  assert.equal(reqs[0][1].requestedBy.agentId, "chorong");
});

test("읽기 전용 AI는 등록 불가", async () => {
  const { call } = await connect(readOnly);
  const r = await call("create_event", { title: "x", start: "2026-10-22" });
  assert.ok(r.isError);
  assert.equal([...db._store.keys()].filter((p) => p.includes("/events/")).length, 2);
});

test("접속키 인증: 해시 대조, 꺼진 AI 거부, OAuth 토큰도 AI로 해석", async () => {
  const key = generateAgentKey();
  await db.doc("mcpAgents/chorong").set({ label: "초롱이", keyHash: sha256Hex(key), scopes: DEFAULT_AGENT_SCOPES, enabled: true });
  assert.equal((await findAgentByKey(key)).agentId, "chorong");
  assert.equal(await findAgentByKey("cmk_wrong"), null);
  assert.equal(await findAgentByKey("passphrase"), null);

  const p = new McpOAuthProvider();
  const info = await p.verifyAccessToken(key);
  assert.equal(info.extra.agent.agentId, "chorong");

  await db.doc("mcpOAuthTokens/" + sha256Hex("tok1")).set({ type: "access", clientId: "c", agentId: "chorong", expiresAt: Math.floor(Date.now() / 1000) + 60 });
  assert.equal((await p.verifyAccessToken("tok1")).extra.agent.label, "초롱이");
  // 예전 토큰(agentId 없음)은 기존 관리자 연결로 유지
  await db.doc("mcpOAuthTokens/" + sha256Hex("old")).set({ type: "access", clientId: "c", expiresAt: Math.floor(Date.now() / 1000) + 60 });
  assert.equal((await p.verifyAccessToken("old")).extra.agent.agentId, "owner");

  await db.doc("mcpAgents/chorong").update({ enabled: false });
  assert.equal(await findAgentByKey(key), null);
  assert.equal(await loadAgent("chorong"), null);
  await assert.rejects(p.verifyAccessToken("tok1"));
});

test("리다이렉트 허용 목록: Claude·ChatGPT·루프백만", () => {
  assert.ok(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback"));
  assert.ok(isAllowedRedirectUri("https://chatgpt.com/connector/oauth/abc_123"));
  assert.ok(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect"));
  assert.ok(isAllowedRedirectUri("http://127.0.0.1:5555/oauth/callback"));
  assert.ok(isAllowedRedirectUri("http://localhost:8080/callback"));
  assert.ok(!isAllowedRedirectUri("https://evil.com/callback"));
  assert.ok(!isAllowedRedirectUri("https://chatgpt.com.evil.com/connector/oauth/x"));
  assert.ok(!isAllowedRedirectUri("https://chatgpt.com/connector/oauth/x/../../steal"));
});

// 실제 운영 경로와 같은 SDK 미들웨어(requireBearerAuth)를 통과하는지 — 단위 검증만으로는
// "만료 시각 없는 토큰 거부" 같은 미들웨어 규칙을 놓쳐서 별도로 확인한다.
test("SDK 인증 미들웨어 통과: 접속키·OAuth 토큰 OK, 잘못된 키·꺼진 AI는 401", async () => {
  const { requireBearerAuth } = await import("@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js");
  const mw = requireBearerAuth({ verifier: new McpOAuthProvider() });
  const run = (token) => new Promise((resolve) => {
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = {
      statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; },
      json() { resolve({ status: this.statusCode, req }); return this; },
    };
    mw(req, res, () => resolve({ status: 200, req }));
  });
  const key = generateAgentKey();
  await db.doc("mcpAgents/dexd").set({ label: "덱스D", keyHash: sha256Hex(key), scopes: DEFAULT_AGENT_SCOPES, enabled: true });
  const okKey = await run(key);
  assert.equal(okKey.status, 200);
  assert.equal(okKey.req.auth.extra.agent.agentId, "dexd");

  await db.doc("mcpOAuthTokens/" + sha256Hex("tokA")).set({ type: "access", clientId: "c", agentId: "dexd", expiresAt: Math.floor(Date.now() / 1000) + 60 });
  assert.equal((await run("tokA")).status, 200);
  assert.equal((await run("cmk_nope")).status, 401);
  assert.equal((await run("random")).status, 401);
  await db.doc("mcpAgents/dexd").update({ enabled: false });
  assert.equal((await run(key)).status, 401);
  assert.equal((await run("tokA")).status, 401);
});

