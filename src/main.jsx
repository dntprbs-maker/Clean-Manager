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

const faviconEl = document.querySelector('link[rel="icon"]');
if (faviconEl) {
  faviconEl.href = isLocal ? "/favicon-local.svg" : isPcClaudePreview ? "/favicon-preview.svg" : "/favicon.svg";
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSuperAdmin ? <SuperAdmin /> : <App />}
  </StrictMode>,
)
