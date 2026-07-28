import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

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
  server: {
    proxy: {
      // GMS 릴레이는 CORS(preflight)를 허용하지 않아 브라우저가 직접 못 부른다.
      // dev 서버가 /gmsapi/* 를 서버 사이드로 전달해 같은 출처로 만든다(그림으로 말해요 AI 채점).
      // 배포 환경은 리버스 프록시에 같은 규칙을 두거나 백엔드 프록시 API로 옮겨야 한다.
      '/gmsapi': {
        target: 'https://gms.ssafy.io',
        changeOrigin: true,
      },
    },
  },
})
