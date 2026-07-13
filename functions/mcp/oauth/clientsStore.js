import { getDb } from "../lib/db.js";
import { InvalidClientMetadataError } from "@modelcontextprotocol/sdk/server/auth/errors.js";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// 이 커넥터에 접속을 허용할 리다이렉트 URI만 화이트리스트:
// - claude.ai (Claude.ai web/Desktop/mobile/Cowork 공식 콜백)
// - 루프백(localhost/127.0.0.1) + path === "/callback" — Claude Code CLI 셀프테스트용
//   (RFC 8252 루프백 포트는 SDK의 redirectUriMatches가 알아서 완화 처리하므로 여기선 포트 체크 안 함)
function isAllowedRedirectUri(uriStr) {
  if (uriStr === "https://claude.ai/api/mcp/auth_callback") return true;
  try {
    const u = new URL(uriStr);
    return LOOPBACK_HOSTS.has(u.hostname) && u.pathname === "/callback";
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
        "redirect_uris must include https://claude.ai/api/mcp/auth_callback or a loopback http://localhost|127.0.0.1/callback URI"
      );
    }
    await getDb().doc(`mcpOAuthClients/${clientInfo.client_id}`).set(clientInfo);
    return clientInfo;
  },
};
