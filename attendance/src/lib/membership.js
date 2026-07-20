// attendance 전용 계정(attendance_accounts)의 role 필드를 그대로 사용하는 단순 권한 체계.
export const isSuperAdmin = (u) => u?.role === '최고관리자';
export const isWorker = (u) => u?.role === '용역자';

// 근무기록 확정("매니저 확정")은 매니저/최고관리자 둘 다 가능
export const canConfirmAsManager = (u) => u?.role === '매니저' || isSuperAdmin(u);
// 정산 승인/지급완료, 계정 관리는 최고관리자(대표)만
export const canApproveAsAdmin = (u) => isSuperAdmin(u);
