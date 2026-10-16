import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SuperAdmin from './SuperAdmin.jsx'

// 주소창에 #superadmin 이 붙어있으면 마스터 관리자 페이지로 분기
// #demo 또는 ?demo=true 는 App 내부에서 처리
const isSuperAdmin = window.location.hash === "#superadmin";

// 탭 타이틀 + 파비콘 환경별 설정 (여러 탭 띄워놓고도 로컬/미리보기/운영 구분되도록)
const isLocal = window.location.hostname === "localhost";
const isVercel = window.location.hostname.includes("vercel.app");
const isPcClaudePreview = isVercel && window.location.hostname.includes("pc-claude");

// 대표 도메인 통일 — clean-manager-60bc9.web.app / clean-manager.com(www 없음)으로
// 들어온 요청은 www.clean-manager.com으로 보낸다. 세 주소가 같은 Firebase Hosting
// 사이트를 같은 화면으로 서빙하다 보니, 직원이 예전 주소(.web.app)와 새 주소(www)를
// 둘 다 열어본 적이 있으면 푸시 알림 토큰이 주소별로 따로 등록돼 같은 일정에
// 알림이 2통씩 오는 문제가 있었다(2026-10-16). 대표 주소 하나로만 들어오게 하면
// 새로 발급되는 토큰이 앞으로는 하나로 모인다.
const CANONICAL_HOST = "www.clean-manager.com";
const isCanonicalCandidate =
  !isLocal && !isVercel &&
  (window.location.hostname === "clean-manager-60bc9.web.app" ||
    window.location.hostname === "clean-manager.com");
if (isCanonicalCandidate) {
  window.location.replace(
    `https://${CANONICAL_HOST}${window.location.pathname}${window.location.search}${window.location.hash}`
  );
}
document.title = isLocal ? "클린메니져-로컬서버" : isPcClaudePreview ? "클린메니져-피씨클로드" : isVercel ? "클린메니져-개발" : "클린메니져";

// 로컬/피씨클로드 미리보기는 구분하기 쉽게 색만 다른 임시 아이콘(SVG)을 쓰고,
// 실제 운영(prod)은 index.html에 기본값으로 넣어둔 정식 로고(PNG)를 그대로 둔다.
const faviconEl = document.querySelector('link[rel="icon"]');
if (faviconEl && (isLocal || isPcClaudePreview)) {
  faviconEl.type = "image/svg+xml";
  faviconEl.href = isLocal ? "/favicon-local.svg" : "/favicon-preview.svg";
}

// 홈 화면 바로가기(삼성 인터넷 등)로 재접속하면 브라우저가 새로고침 없이 이전에
// 열어뒀던 페이지(bfcache)를 그대로 복원해서 최신 배포 내용이 안 보이는 경우가 있다.
// bfcache에서 복원된 진입(event.persisted)일 때만 강제로 새로고침한다.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) window.location.reload();
});

// 핀치줌 전역 차단 — viewport user-scalable=no와 CSS touch-action은 삼성 인터넷 등
// 일부 모바일 브라우저가 무시해서, 두 손가락 터치를 직접 preventDefault로 막는다.
// 브라우저가 핀치를 확대 제스처로 확정하는 건 두 번째 손가락이 닿는 touchstart 시점이라
// touchmove만 막아선 화면에 따라 안 먹혀서, touchstart부터 capture 단계에서 차단한다.
// 예외: 사진 확대보기(라이트박스)는 핀치줌이 정상 기능이므로 그 안에서 시작된 터치는 통과.
const blockPinch = (e) => {
  if (e.touches.length > 1 && !e.target.closest?.("[data-allow-pinch]")) e.preventDefault();
};
document.addEventListener("touchstart", blockPinch, { passive: false, capture: true });
document.addEventListener("touchmove", blockPinch, { passive: false, capture: true });

// 리다이렉트 중에는 화면을 그리지 않음 — 옛 주소에서 잠깐이라도 앱이 뜨면
// 그 주소에서 푸시 토큰이 다시 등록될 수 있다.
if (!isCanonicalCandidate) {
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      {isSuperAdmin ? <SuperAdmin /> : <App />}
    </StrictMode>,
  )
}
