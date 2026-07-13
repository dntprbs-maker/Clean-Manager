import { randomBytes } from "node:crypto";
import { getDb } from "../lib/db.js";
import { sha256Hex } from "../lib/hash.js";

const ACCESS_TOKEN_TTL_SEC = 60 * 60;            // 1시간
const REFRESH_TOKEN_TTL_SEC = 180 * 24 * 60 * 60; // 180일

// 액세스/리프레시 토큰은 원문이 아니라 SHA-256 해시로 저장(mcpOAuthTokens 문서를 누가 들여다봐도
// 원문 토큰을 알 수 없게). 액세스↔리프레시 쌍은 서로의 해시(pairHash)로 연결해 회전/폐기 시 같이 지운다.

function randomToken() {
  return randomBytes(32).toString("base64url");
}

async function writePair(db, { clientId, scopes, resource, accessToken, refreshToken }) {
  const nowSec = Math.floor(Date.now() / 1000);
  const accessHash = sha256Hex(accessToken);
  const refreshHash = sha256Hex(refreshToken);
  const batch = db.batch();
  batch.set(db.doc(`mcpOAuthTokens/${accessHash}`), {
    type: "access",
    clientId,
    scopes: scopes || [],
    resource: resource || null,
    expiresAt: nowSec + ACCESS_TOKEN_TTL_SEC,
    pairHash: refreshHash,
  });
  batch.set(db.doc(`mcpOAuthTokens/${refreshHash}`), {
    type: "refresh",
    clientId,
    scopes: scopes || [],
    resource: resource || null,
    expiresAt: nowSec + REFRESH_TOKEN_TTL_SEC,
    pairHash: accessHash,
  });
  await batch.commit();
}

export async function issueTokenPair({ clientId, scopes, resource }) {
  const db = getDb();
  const accessToken = randomToken();
  const refreshToken = randomToken();
  await writePair(db, { clientId, scopes, resource, accessToken, refreshToken });
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshToken,
    scope: (scopes || []).join(" ") || undefined,
  };
}

// 리프레시 토큰 회전: 기존 액세스+리프레시 쌍을 폐기하고 새 쌍을 발급.
// 공개 클라이언트(client_secret 없음)에 대한 리프레시 토큰 회전 요구사항(OAuth 2.1) 충족.
export async function rotateRefreshToken(refreshTokenPlain, expectedClientId) {
  const db = getDb();
  const refreshHash = sha256Hex(refreshTokenPlain);
  const snap = await db.doc(`mcpOAuthTokens/${refreshHash}`).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.type !== "refresh" || data.expiresAt < Math.floor(Date.now() / 1000)) return null;
  if (data.clientId !== expectedClientId) return null;

  const batch = db.batch();
  batch.delete(db.doc(`mcpOAuthTokens/${refreshHash}`));
  if (data.pairHash) batch.delete(db.doc(`mcpOAuthTokens/${data.pairHash}`));
  await batch.commit();

  const accessToken = randomToken();
  const newRefreshToken = randomToken();
  await writePair(db, {
    clientId: data.clientId,
    scopes: data.scopes,
    resource: data.resource,
    accessToken,
    refreshToken: newRefreshToken,
  });
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: newRefreshToken,
    scope: (data.scopes || []).join(" ") || undefined,
  };
}

export async function verifyAccessTokenHash(hash) {
  const snap = await getDb().doc(`mcpOAuthTokens/${hash}`).get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.type !== "access" || data.expiresAt < Math.floor(Date.now() / 1000)) return null;
  return data;
}

export async function revokeByHash(hash) {
  const db = getDb();
  const snap = await db.doc(`mcpOAuthTokens/${hash}`).get();
  if (!snap.exists) return;
  const data = snap.data();
  const batch = db.batch();
  batch.delete(db.doc(`mcpOAuthTokens/${hash}`));
  if (data.pairHash) batch.delete(db.doc(`mcpOAuthTokens/${data.pairHash}`));
  await batch.commit();
}
