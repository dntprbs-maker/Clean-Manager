// -------------------------------------------------
// DEV LOGIN
// UI 테스트용 기능
// 운영모드에서는 반드시 비활성화
// -------------------------------------------------
// import.meta.env.DEV는 Vite가 `npm run dev`에서만 true로 주입하고
// `vite build`(운영 배포) 결과물에서는 항상 false로 고정한다.
// 이 값을 1차 게이트로 두면 배포된 서비스는 URL에 ?dev=1을 붙여도
// 절대 개발모드가 켜지지 않는다.
export function isDevMode() {
  if (!import.meta.env.DEV) return false;
  try {
    return new URLSearchParams(window.location.search).get('dev') === '1';
  } catch {
    return false;
  }
}

// 개발모드 바로가기 버튼(로그인 화면 + 로그인 후 상단 전환바)이 공통으로 쓰는 테스트 계정.
export const DEV_TEST_WORKER_PHONE = '010-9999-9999';
export const DEV_ADMIN_ACCOUNT_ID = 'testadmin';
