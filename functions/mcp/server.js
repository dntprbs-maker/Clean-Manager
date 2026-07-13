import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEventTools } from "./tools/events.js";
import { registerEmployeeTools } from "./tools/employees.js";
import { registerTeamTools } from "./tools/teams.js";

// 요청마다 새 McpServer 인스턴스를 만든다 (stateless 모드 — Cloud Functions 인스턴스가
// 여러 개/휘발성이라 세션을 유지하지 않는 편이 단순하고 안전함).
export function createMcpServer(companyId) {
  const server = new McpServer({ name: "clean-manager", version: "1.0.0" }, { capabilities: {} });
  registerEventTools(server, companyId);
  registerEmployeeTools(server, companyId);
  registerTeamTools(server, companyId);
  return server;
}
