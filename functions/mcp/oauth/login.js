import express from "express";
import { createCode } from "./codes.js";
import { MCP_PASSPHRASE } from "../lib/db.js";
import { findAgentByKey, OWNER_AGENT } from "../lib/agents.js";

export const loginRouter = express.Router();
loginRouter.use(express.urlencoded({ extended: false }));

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

// mcpAuthRouter가 /authorize에 심어둔 provider.authorize()는 req를 못 받아서 패스프레이즈
// 폼을 직접 못 그리므로, 원본 OAuth 파라미터를 그대로 실어 이 라우트로 리다이렉트해온다.
function renderForm({ client_id, redirect_uri, code_challenge, state, scope, resource, error }) {
  const hidden = (name, val) => val ? `<input type="hidden" name="${name}" value="${escapeHtml(val)}">` : "";
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>크린매니저 연결 승인</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f4f6;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .card{background:#fff;border-radius:12px;padding:32px;max-width:360px;width:100%;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  h1{font-size:18px;margin:0 0 8px}
  p{color:#6b7280;font-size:14px;margin:0 0 20px}
  input[type=password]{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:12px}
  button{width:100%;padding:10px 12px;border:none;border-radius:8px;background:#111827;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
  .err{color:#dc2626;font-size:13px;margin:-6px 0 12px}
</style></head>
<body><div class="card">
  <h1>크린매니저 연결 승인</h1>
  <p>이 AI에 발급된 접속키(cmk_로 시작)를 입력하세요. 관리자는 기존 패스프레이즈로도 승인할 수 있습니다.</p>
  <form method="post" action="/oauth/login">
    ${hidden("client_id", client_id)}
    ${hidden("redirect_uri", redirect_uri)}
    ${hidden("code_challenge", code_challenge)}
    ${hidden("state", state)}
    ${hidden("scope", scope)}
    ${hidden("resource", resource)}
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
    <input type="password" name="passphrase" placeholder="접속키 또는 패스프레이즈" autofocus required>
    <button type="submit">승인</button>
  </form>
</div></body></html>`;
}

loginRouter.get("/oauth/login", (req, res) => {
  const { client_id, redirect_uri, code_challenge } = req.query;
  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).send("잘못된 요청입니다 (필수 파라미터 누락).");
    return;
  }
  res.set("Cache-Control", "no-store");
  res.type("html").send(renderForm(req.query));
});

loginRouter.post("/oauth/login", async (req, res) => {
  const { client_id, redirect_uri, code_challenge, state, scope, resource, passphrase } = req.body;
  if (!client_id || !redirect_uri || !code_challenge) {
    res.status(400).send("잘못된 요청입니다 (필수 파라미터 누락).");
    return;
  }
  res.set("Cache-Control", "no-store");

  // 접속키가 맞으면 그 AI로, 기존 패스프레이즈면 owner(하위 호환)로 승인
  const agent = (await findAgentByKey(passphrase)) || (passphrase === MCP_PASSPHRASE.value() ? OWNER_AGENT : null);
  if (!agent) {
    res.status(401).type("html").send(
      renderForm({ client_id, redirect_uri, code_challenge, state, scope, resource, error: "접속키가 올바르지 않습니다." })
    );
    return;
  }

  const code = await createCode({
    clientId: client_id,
    codeChallenge: code_challenge,
    redirectUri: redirect_uri,
    scopes: scope ? scope.split(" ") : [],
    resource: resource ? new URL(resource) : undefined,
    agentId: agent.agentId,
  });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);
  res.redirect(302, redirectUrl.href);
});
