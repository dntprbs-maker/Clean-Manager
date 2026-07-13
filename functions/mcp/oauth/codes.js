import { randomBytes } from "node:crypto";
import { getDb } from "../lib/db.js";

const CODE_TTL_MS = 5 * 60 * 1000; // 5분

// 인가 코드는 짧고 값 자체가 민감하지 않은 1회용 토큰이라(짧은 TTL + 1회 소모) 원문 그대로 저장.
// (액세스/리프레시 토큰은 수명이 길어서 tokens.js에서 해시로 저장하는 것과 대조적)
export async function createCode({ clientId, codeChallenge, redirectUri, scopes, resource }) {
  const code = randomBytes(32).toString("base64url");
  await getDb().doc(`mcpOAuthCodes/${code}`).set({
    clientId,
    codeChallenge,
    redirectUri,
    scopes: scopes || [],
    resource: resource ? resource.href : null,
    createdAt: Date.now(),
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return code;
}

export async function getCode(code) {
  const snap = await getDb().doc(`mcpOAuthCodes/${code}`).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.expiresAt < Date.now()) return null;
  return data;
}

// 1회용 — 교환에 성공하면 즉시 삭제해서 재사용(replay) 불가능하게 함
export async function consumeCode(code) {
  await getDb().doc(`mcpOAuthCodes/${code}`).delete();
}
