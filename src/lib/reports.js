// ── 청소 진행 상태 (전/중/완료) — reports 컬렉션 기준 ─────────────
export const getReportStatus = (eventId, reports) => {
  if (reports.some(r => r.eventId === eventId && r.status === "진행중")) return "중";
  if (reports.some(r => r.eventId === eventId && r.status === "완료")) return "완료";
  return "전";
};
export const REPORT_STATUS_STYLE = {
  "전":   { bg: "#f3f4f6", color: "#6b7280", label: "청소 전"  },
  "중":   { bg: "#fef3c7", color: "#b45309", label: "청소 중"  },
  "완료": { bg: "#dcfce7", color: "#15803d", label: "청소 완료" },
};
