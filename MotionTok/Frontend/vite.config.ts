import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

/** dev 프록시가 넘길 로컬 백엔드. 다른 백엔드를 보려면 프록시 대신 .env.development.local 의 VITE_API_BASE_URL 을 절대 URL로 덮어쓴다. */
const BACKEND = 'http://localhost:8080'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  /**
   * 개발 서버가 /api·/ws 를 백엔드로 넘긴다 — 브라우저에게는 프론트와 백엔드가 한 오리진(5173)이 된다.
   * 운영은 nginx 가 같은 두 경로를 프록시하므로(Backend/nginx/conf.d/motok.conf) dev 가 운영 구성과 같아지고,
   * refresh 토큰을 HttpOnly 쿠키로 옮길 때 필요한 first-party 조건도 여기서 갖춰진다.
   */
  server: {
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      // STOMP 핸드셰이크. ws:true 가 있어야 Upgrade 요청이 프록시된다.
      '/ws': { target: BACKEND, changeOrigin: true, ws: true },
    },
  },
})
