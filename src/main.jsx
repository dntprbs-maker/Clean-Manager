import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import SuperAdmin from './SuperAdmin.jsx'

// 주소창에 #superadmin 이 붙어있으면 마스터 관리자 페이지로 분기
// #demo 또는 ?demo=true 는 App 내부에서 처리
const isSuperAdmin = window.location.hash === "#superadmin";

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isSuperAdmin ? <SuperAdmin /> : <App />}
  </StrictMode>,
)
