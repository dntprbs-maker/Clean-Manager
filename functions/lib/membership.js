// ── 직원-팀 다대다 멤버십 헬퍼 (서버판) ───────────────────────────────
// src/lib/membership.js와 동일한 순수 함수 — Firestore SDK와 무관한 데이터 변환이라
// 클라이언트/서버(Cloud Functions) 양쪽에서 그대로 복사해 쓴다. 한쪽만 고치면 어긋나므로
// 로직을 바꿀 때는 반드시 두 파일을 함께 수정할 것.
export const isSuperAdmin = (u) => u?.role === "최고관리자";

export const getMemberships = (u) => {
  if (!u) return [];
  if (u.memberships) return u.memberships;
  if (isSuperAdmin(u)) return [];
  if (u.team && u.team !== "사장") {
    return [{ team: u.team, role: u.role === "최고관리자" ? "팀장" : (u.role || "팀원") }];
  }
  return [];
};

export const teamRole   = (u, team) => getMemberships(u).find(m => m.team === team)?.role || null;
export const isLeaderOf = (u, team) => teamRole(u, team) === "팀장";
export const isMemberOf = (u, team) => !!teamRole(u, team);
export const myTeamNames = (u) => getMemberships(u).map(m => m.team);
export const isAdminStaff = (u) => getMemberships(u).some(m => ["관리팀", "영업팀"].includes(m.team));
export const hasLeadershipSomewhere = (u) => getMemberships(u).some(m => m.role === "팀장");
