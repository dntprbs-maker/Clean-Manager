import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 다른 프로젝트들과 포트 겹치지 않게 5176 사용 (5173 클린매니저, 5174 clean-member, 5175 다인이벤트).
export default defineConfig(() => ({
  base: '/',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5176,
    strictPort: false,
  },
  plugins: [
    tailwindcss(),
    react()
  ],
}))
