import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Firebase Hosting / Vercel 모두 루트(/)에서 서빙하므로 base는 항상 '/'.
// (구 GitHub Pages 배포용 '/Clean-Manager/' 경로는 더 이상 사용 안 함)
// dev 서버 포트는 PORT 환경변수가 있으면 그걸 사용(미리보기 도구 호환).
export default defineConfig(() => ({
  base: '/',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
  plugins: [
    tailwindcss(),
    react()
  ],
}))
