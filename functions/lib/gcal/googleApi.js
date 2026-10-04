// Google OAuth / Calendar API v3 REST 호출 — googleapis 패키지(수십 MB) 대신 fetch로 필요한 것만 구현.
// fetch를 주입받게 해서 단위 테스트에서 가짜 응답으로 바꿔 끼울 수 있다.
import { OAUTH_SCOPE } from "./config.js";

const AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API       = "https://www.googleapis.com/calendar/v3";

export class GoogleApiError extends Error {
  constructor(message, { status, reason } = {}) {
    super(message);
    this.name = "GoogleApiError";
    this.status = status;
    this.reason = reason; // 예: "invalid_grant", "fullSyncRequired"
  }
}

// 응답 본문에서 사람이 읽을 오류 메시지만 뽑는다(토큰 등 비밀값이 섞일 일은 없지만 길이 제한).
async function toError(res, what) {
  let reason = "", msg = "";
  try {
    const body = await res.json();
    reason = body?.error?.errors?.[0]?.reason || (typeof body?.error === "string" ? body.error : "") || "";
    msg = body?.error?.message || body?.error_description || "";
  } catch { /* 본문 없음 */ }
  return new GoogleApiError(`${what} 실패 (HTTP ${res.status}${reason ? `, ${reason}` : ""})${msg ? `: ${String(msg).slice(0, 200)}` : ""}`,
    { status: res.status, reason });
}

export function buildAuthUrl({ clientId, redirectUri, state, codeChallenge }) {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: OAUTH_SCOPE,
    access_type: "offline",          // refresh token 발급
    prompt: "consent",               // 재연결 때도 refresh token을 다시 받기 위해 매번 동의 화면
    include_granted_scopes: "true",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTH_URL}?${p}`;
}

export function createGoogleClient({ clientId, clientSecret, fetchImpl = fetch }) {
  async function tokenRequest(params, what) {
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }).toString(),
    });
    if (!res.ok) throw await toError(res, what);
    return res.json();
  }

  async function api(accessToken, method, path, { query, body } = {}) {
    const qs = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null))}` : "";
    const res = await fetchImpl(`${API}${path}${qs}`, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw await toError(res, `Calendar API ${method} ${path.split("?")[0]}`);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  return {
    exchangeCode: ({ code, redirectUri, codeVerifier }) =>
      tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: codeVerifier }, "OAuth 코드 교환"),

    refreshAccessToken: (refreshToken) =>
      tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, "access token 갱신"),

    // 한 페이지 조회. syncToken이 있으면 증분, 없으면 전체(같은 파라미터 조합을 유지해야 함 —
    // syncToken과 timeMin/timeMax/orderBy/q/updatedMin/iCalUID 등은 함께 쓸 수 없다).
    listEvents: (accessToken, calendarId, { syncToken, pageToken, maxResults = 2500 } = {}) =>
      api(accessToken, "GET", `/calendars/${encodeURIComponent(calendarId)}/events`, {
        query: { singleEvents: "true", maxResults: String(maxResults), syncToken, pageToken },
      }),

    watchEvents: (accessToken, calendarId, { id, token, address, ttlSeconds }) =>
      api(accessToken, "POST", `/calendars/${encodeURIComponent(calendarId)}/events/watch`, {
        body: { id, type: "web_hook", address, token, params: { ttl: String(ttlSeconds) } },
      }),

    stopChannel: (accessToken, { id, resourceId }) =>
      api(accessToken, "POST", "/channels/stop", { body: { id, resourceId } }),
  };
}
