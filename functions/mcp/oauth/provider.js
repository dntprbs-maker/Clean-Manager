import { clientsStore } from "./clientsStore.js";
import * as codes from "./codes.js";
import * as tokens from "./tokens.js";
import { sha256Hex } from "../lib/hash.js";
import { findAgentByKey, loadAgent, AGENT_KEY_PREFIX } from "../lib/agents.js";
import { InvalidGrantError, InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

// OAuthServerProvider 구현 — mcpAuthRouter가 /authorize, /token, /register, /revoke를
// 대신 라우팅해주고, 실제 발급/검증 로직만 여기서 구현.
export class McpOAuthProvider {
  get clientsStore() {
    return clientsStore;
  }

  // authorize(client, params, res)는 req를 받지 못하므로(SDK 인터페이스 제약) 패스프레이즈
  // 로그인 폼은 여기서 못 그림 — 원본 파라미터를 그대로 실어 /oauth/login으로 리다이렉트만 한다.
  // 실제 인가 코드 발급은 /oauth/login의 POST 핸들러(login.js)에서 처리.
  async authorize(client, params, res) {
    const qs = new URLSearchParams();
    qs.set("client_id", client.client_id);
    qs.set("redirect_uri", params.redirectUri);
    qs.set("code_challenge", params.codeChallenge);
    if (params.state) qs.set("state", params.state);
    if (params.scopes?.length) qs.set("scope", params.scopes.join(" "));
    if (params.resource) qs.set("resource", params.resource.href);
    res.redirect(302, `/oauth/login?${qs.toString()}`);
  }

  async challengeForAuthorizationCode(client, authorizationCode) {
    const code = await codes.getCode(authorizationCode);
    if (!code || code.clientId !== client.client_id) {
      throw new InvalidGrantError("invalid or expired authorization code");
    }
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
    // PKCE code_verifier 대조는 SDK(tokenHandler)가 challengeForAuthorizationCode()로 받은
    // 값과 자동으로 비교해준다 — 여기까지 왔다는 건 이미 검증 통과했다는 뜻.
    const code = await codes.getCode(authorizationCode);
    if (!code || code.clientId !== client.client_id) {
      throw new InvalidGrantError("invalid or expired authorization code");
    }
    if (redirectUri && code.redirectUri !== redirectUri) {
      throw new InvalidGrantError("redirect_uri mismatch");
    }
    await codes.consumeCode(authorizationCode);
    return tokens.issueTokenPair({ clientId: client.client_id, scopes: code.scopes, resource, agentId: code.agentId });
  }

  async exchangeRefreshToken(client, refreshToken, _scopes, _resource) {
    const result = await tokens.rotateRefreshToken(refreshToken, client.client_id);
    if (!result) throw new InvalidGrantError("invalid, expired, or already-used refresh token");
    return result;
  }

  // 두 종류의 토큰을 받는다: OAuth 액세스 토큰, 또는 에이전트 접속키(cmk_…, Hermes·Codex 고정 헤더용).
  // 어느 쪽이든 agent(누구인지·권한)를 extra에 실어 도구 핸들러가 권한을 확인하게 한다.
  async verifyAccessToken(token) {
    if (token.startsWith(AGENT_KEY_PREFIX)) {
      const agent = await findAgentByKey(token);
      if (!agent) throw new InvalidTokenError("invalid or disabled agent key");
      return { token, clientId: `agent:${agent.agentId}`, scopes: agent.scopes, extra: { agent } };
    }
    const data = await tokens.verifyAccessTokenHash(sha256Hex(token));
    if (!data) {
      throw new InvalidTokenError("invalid or expired access token");
    }
    const agent = await loadAgent(data.agentId);
    if (!agent) throw new InvalidTokenError("agent disabled");
    return {
      token,
      clientId: data.clientId,
      scopes: agent.scopes,
      expiresAt: data.expiresAt,
      extra: { agent },
    };
  }

  async revokeToken(_client, request) {
    await tokens.revokeByHash(sha256Hex(request.token));
  }
}
