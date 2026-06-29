import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 배포(빌드)는 GitHub Pages 경로(/Clean-Manager/), 개발(dev)은 루트(/)로 서빙.
// dev 서버 포트는 PORT 환경변수가 있으면 그걸 사용(미리보기 도구 호환).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? (process.env.VERCEL ? '/' : '/Clean-Manager/') : '/',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
    strictPort: false,
  },
  plugins: [
    tailwindcss(),
    react()
  ],
}))
