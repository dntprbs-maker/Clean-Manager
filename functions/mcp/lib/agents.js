import { randomBytes } from "node:crypto";
import { getDb } from "./db.js";
import { sha256Hex } from "./hash.js";

// ── 공용 MCP에 붙는 AI(에이전트)별 인증·권한 ─────────────────────────
// 서버는 하나, AI마다 접속키(=에이전트 키)를 따로 발급해 누가 무엇을 했는지 구분한다.
// 키 원문은 저장하지 않고 SHA-256 해시만 mcpAgents/{agentId}.keyHash 에 둔다.
//
// 접속키는 두 가지로 쓰인다.
//  1) OAuth 로그인 폼(/oauth/login)에 입력 → 그 AI 이름으로 토큰 발급 (ChatGPT·Claude 등)
//  2) Authorization: Bearer <접속키> 로 바로 호출 (OAuth를 못 쓰는 Hermes·Codex용 고정 헤더)

export const AGENT_KEY_PREFIX = "cmk_";

// 권한(scope)
export const SCOPES = {
  READ: "events:read",            // 일정 조회·검색
  WRITE: "events:write",          // 일정 등록·수정
  DELETE_REQUEST: "events:delete_request", // 삭제 "요청"만 (실제 삭제는 관리자 승인 후 별도 처리)
  ADMIN: "admin",                 // 직원·팀 관리 도구 (기존 패스프레이즈 연결 전용)
};

// 기본 등록 대상. 실제 키·권한은 Firestore 문서가 기준이며, 이 표는 스크립트 기본값일 뿐이다.
export const DEFAULT_AGENTS = {
  chorong: { label: "초롱이", platform: "ChatGPT" },
  harry: { label: "해리", platform: "Hermes" },
  ari: { label: "아리", platform: "Claude" },
  dexd: { label: "덱스D", platform: "Codex 데스크톱" },
};
export const DEFAULT_AGENT_SCOPES = [SCOPES.READ, SCOPES.WRITE, SCOPES.DELETE_REQUEST];

// 기존 패스프레이즈 로그인으로 들어온 연결(이미 쓰던 Claude 커넥터)은 owner로 취급 — 하위 호환.
export const OWNER_AGENT = { agentId: "owner", label: "관리자(패스프레이즈)", scopes: Object.values(SCOPES) };

export function generateAgentKey() {
  return AGENT_KEY_PREFIX + randomBytes(24).toString("base64url");
}

// 접속키 → 에이전트. 비활성·미등록이면 null.
export async function findAgentByKey(key) {
  if (typeof key !== "string" || !key.startsWith(AGENT_KEY_PREFIX)) return null;
  const snap = await getDb().collection("mcpAgents").where("keyHash", "==", sha256Hex(key)).get();
  const doc = snap.docs[0];
  if (!doc) return null;
  const a = doc.data();
  if (a.enabled === false) return null;
  return { agentId: doc.id, label: a.label || doc.id, scopes: a.scopes || [] };
}

// 토큰에 기록된 agentId → 현재 권한 (토큰 발급 후 권한을 줄이거나 끄면 즉시 반영되도록 매번 조회)
export async function loadAgent(agentId) {
  if (!agentId || agentId === OWNER_AGENT.agentId) return OWNER_AGENT;
  const snap = await getDb().doc(`mcpAgents/${agentId}`).get();
  if (!snap.exists) return null;
  const a = snap.data();
  if (a.enabled === false) return null;
  return { agentId, label: a.label || agentId, scopes: a.scopes || [] };
}

export const hasScope = (agent, scope) => !!agent && (agent.scopes || []).includes(scope);
