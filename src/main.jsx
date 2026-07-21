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

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSuperAdmin ? <SuperAdmin /> : <App />}
  </StrictMode>,
)
