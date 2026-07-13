// MCP 도구 핸들러 공통 응답 포맷 헬퍼
export function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}
export function err(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
