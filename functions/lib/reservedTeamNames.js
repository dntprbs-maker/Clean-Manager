// "미지정"은 알림 설정 기능(index.js의 allowsTeam(), src/features/misc/MiscScreens.jsx의
// UNASSIGNED_KEY)에서 "담당팀 미배정 일정"을 가리키는 예약어다. 실제 팀 이름으로 쓰이면
// 그 둘이 구분이 안 돼 알림 필터가 뒤섞이므로, 팀을 만들거나 이름을 바꾸는 모든 경로
// (index.js, mcp/tools/teams.js)에서 이 파일을 참조해 막는다. src/features/employees/
// EmployeeTeamScreens.jsx는 별도 빌드(클라이언트)라 이 목록을 복사해서 쓴다 — 예약어를
// 바꿀 때는 거기도 같이 고칠 것.
export const UNASSIGNED_TEAM_KEY = "미지정";
export const RESERVED_TEAM_NAMES = [UNASSIGNED_TEAM_KEY];
