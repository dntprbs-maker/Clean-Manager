import { getDb } from "../lib/db.js";
import { InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// 이 커넥터에 접속을 허용할 리다이렉트 URI만 화이트리스트:
// - claude.ai (Claude.ai web/Desktop/mobile/Cowork 공식 콜백)
// - chatgpt.com/connector/oauth/{id} (ChatGPT 앱/커넥터 현재 방식) + 예전 고정 주소
// - 루프백(localhost/127.0.0.1) — Claude Code CLI·Codex(`codex mcp login`)·Hermes(`hermes mcp login`)
//   처럼 PC에서 브라우저 로그인 후 로컬 포트로 받는 클라이언트. 경로는 클라이언트마다 달라 제한하지 않음.
//   (RFC 8252 루프백 포트는 SDK의 redirectUriMatches가 알아서 완화 처리)
export function isAllowedRedirectUri(uriStr) {
  if (uriStr === "https://claude.ai/api/mcp/auth_callback") return true;
  if (uriStr === "https://chatgpt.com/connector_platform_oauth_redirect") return true;
  try {
    const u = new URL(uriStr);
    if (u.protocol === "https:" && u.hostname === "chatgpt.com" && /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(u.pathname)) return true;
    return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

// OAuthRegisteredClientsStore 구현 (인터페이스는 TS 타입일 뿐, 런타임엔 duck-typing).
// Cloud Functions 인스턴스가 여러 개/휘발성이라 등록된 DCR 클라이언트를 Firestore에 저장.
export const clientsStore = {
  async getClient(clientId) {
    const snap = await getDb().doc(`mcpOAuthClients/${clientId}`).get();
    return snap.exists ? snap.data() : undefined;
  },

  async registerClient(clientInfo) {
    const uris = clientInfo.redirect_uris || [];
    if (!uris.some(isAllowedRedirectUri)) {
      throw new InvalidClientMetadataError(
        "redirect_uris must include a claude.ai / chatgpt.com connector callback or a loopback http://localhost|127.0.0.1 URI"
      );
    }
    await getDb().doc(`mcpOAuthClients/${clientInfo.client_id}`).set(clientInfo);
    return clientInfo;
  },
};
