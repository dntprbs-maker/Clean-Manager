import express from "express";
import { onRequest } from "firebase-functions/v2/https";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpOAuthProvider } from "./oauth/provider.js";
import { loginRouter } from "./oauth/login.js";
import { createMcpServer } from "./server.js";
import { REGION, MCP_COMPANY_ID, MCP_PASSPHRASE } from "./lib/db.js";

// 커스텀 도메인(clean-manager.com) 컷오버 끝나면 이 URL로 바꿀 것 — project_deployment_map 메모 참고.
const BASE_URL = new URL("https://clean-manager-60bc9.web.app");
const MCP_URL = new URL("https://clean-manager-60bc9.web.app/mcp");

const provider = new McpOAuthProvider();

const app = express();
// Cloud Functions/Firebase Hosting은 프록시(Google Frontend) 뒤에서 X-Forwarded-For를 붙여서
// 넘겨주는데, express-rate-limit(SDK 라우터가 내부적으로 씀)이 trust proxy 미설정 상태에서
// 그 헤더를 보면 스푸핑 위험을 경고하며 예외를 던진다. true(전체 체인 신뢰)는 그 반대로
// "너무 허용적"이라고 또 거부하므로, 정확히 한 홉(Google 프론트엔드)만 신뢰하도록 지정.
app.set("trust proxy", 1);

// mcpAuthRouter가 /authorize, /token, /register, /revoke, /.well-known/oauth-*
// 를 origin 루트에 통째로 깐다 (SDK 제약 — 경로 접두사로 못 묶음. firebase.json에서
// 이 경로들을 개별적으로 이 함수(mcp)로 라우팅해줘야 함).
app.use(mcpAuthRouter({
  provider,
  issuerUrl: BASE_URL,
  baseUrl: BASE_URL,
  resourceServerUrl: MCP_URL,
  resourceName: "Clean-Manager MCP",
}));

// mcpAuthRouter 밖의 수제 라우트 — 패스프레이즈 로그인 폼 (provider.authorize()가
// req를 못 받는 SDK 제약 때문에 /authorize에서 여기로 리다이렉트해서 처리)
app.use(loginRouter);

const resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(MCP_URL);

app.all(
  "/mcp",
  express.json(),
  requireBearerAuth({ verifier: provider, resourceMetadataUrl }),
  async (req, res) => {
    const companyId = MCP_COMPANY_ID.value();
    const server = createMcpServer(companyId);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
);

export const mcp = onRequest({ region: REGION, secrets: [MCP_PASSPHRASE, MCP_COMPANY_ID] }, app);
