// ── 직원-팀 다대다 멤버십 헬퍼 ───────────────────────────────────────
// 직원 프로필엔 이름/연락처/최고관리자 여부만 남고, 팀 소속(어느 팀에 어떤 역할로)은
// user.memberships: [{ team, role }] 배열로 관리한다 (한 직원이 여러 팀에 동시 소속 가능).
//
// 레거시 호환: memberships 필드가 없는(리팩터 이전) 기존 직원 데이터는 team/role
// 단일 필드에서 즉석으로 파생시켜준다 — 별도 일괄 마이그레이션 없이도 그대로 동작.
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
// 관리팀/영업팀 소속이면 관리 스태프로 취급 (지금 담당 현장팀 지정 없으면 전체 열람하는 기존 동작과 동일)
export const isAdminStaff = (u) => getMemberships(u).some(m => ["관리팀", "영업팀"].includes(m.team));
// 어느 한 팀에서라도 팀장이면 true — 팀 구분 없이 "리더급인지"만 볼 때 사용
export const hasLeadershipSomewhere = (u) => getMemberships(u).some(m => m.role === "팀장");
// 사이드 메뉴 등에 표시할 소속 팀 요약 텍스트
export const teamsLabel = (u) => {
  if (isSuperAdmin(u)) return "최고관리자";
  const teams = myTeamNames(u);
  return teams.length ? teams.join(" · ") : "미배정";
};
// 대시보드 카드 등 "직급 등급" 개념이 필요한 곳(팀 구분 없이 리더급/일반급)에 쓰는 3단계 티어.
// 관리팀/영업팀 소속이거나 어느 팀에서든 팀장이면 "팀장" 등급으로 취급.
export const accessTier = (u) => {
  if (isSuperAdmin(u)) return "최고관리자";
  if (isAdminStaff(u) || hasLeadershipSomewhere(u)) return "팀장";
  return "팀원";
};
