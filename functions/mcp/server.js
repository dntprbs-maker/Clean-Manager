import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEventTools } from "./tools/events.js";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerTeamTools } from "./tools/teams.js";
import { SCOPES, hasScope } from "./lib/agents.js";
import { err } from "./lib/toolResult.js";

// 도구별 필요 권한. 여기 없는 도구(직원·팀 관리)는 전부 admin 권한이 필요하다.
export const TOOL_SCOPES = {
  list_events: SCOPES.READ,
  search_events: SCOPES.READ,
  get_event: SCOPES.READ,
  list_teams: SCOPES.READ,
  create_event: SCOPES.WRITE,
  update_event: SCOPES.WRITE,
  request_event_deletion: SCOPES.DELETE_REQUEST,
};

// 요청마다 새 McpServer 인스턴스를 만든다 (stateless 모드 — Cloud Functions 인스턴스가
// 여러 개/휘발성이라 세션을 유지하지 않는 편이 단순하고 안전함).
// agent: 인증 단계에서 확인된 AI(누구인지·권한). 권한 없는 도구는 목록에서도 숨긴다.
export function createMcpServer(companyId, agent) {
  const server = new McpServer({ name: "clean-manager", version: "1.1.0" }, { capabilities: {} });
  const register = server.registerTool.bind(server);
  server.registerTool = (name, config, handler) => {
    const need = TOOL_SCOPES[name] || SCOPES.ADMIN;
    if (!hasScope(agent, need)) return undefined;
    return register(name, config, async (args, extra) => {
      if (!hasScope(agent, need)) return err(`권한이 없습니다 (${need}).`);
      return handler(args, { ...extra, agent });
    });
  };
  registerEventTools(server, companyId);
  registerEmployeeTools(server, companyId);
  registerTeamTools(server, companyId);
  return server;
}
