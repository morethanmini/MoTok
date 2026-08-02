import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    resolve: {
      alias: {
        /**
         * public 절대 경로를 실제 파일로 잇는다 — <b>테스트에서만</b> 필요한 별칭이다.
         *
         * `@vitejs/plugin-vue`는 dev 서버가 없을 때 템플릿의 `<img src="/assets/...">`를
         * 모듈 임포트로 바꾼다(build 경로와 같은 동작). 실제 빌드에서는 vite의 에셋 플러그인이
         * 그 경로를 publicDir 기준으로 풀어 주지만, vitest에는 그 단계가 없어 임포트가
         * `file:///assets/...`로 남는다. Windows에서 드라이브 문자 없는 file URL은
         * `fileURLToPath`가 거부해서(`File URL path must be absolute`) 컴포넌트를 임포트하는
         * 스위트 전체가 로드 단계에서 죽는다. POSIX에서는 같은 URL이 유효 경로라 조용히 지나간다.
         *
         * vite.config가 아니라 여기에 두는 이유 — 운영 빌드는 지금 동작이 더 안전하다.
         * base가 루트가 아닌 경로로 바뀌면 임포트된 에셋은 base 접두가 붙지만 문자열 그대로 둔
         * 경로는 안 붙는다. 즉 이건 빌드 설정의 문제가 아니라 테스트 런타임의 공백이다.
         */
        '/assets': fileURLToPath(new URL('./public/assets', import.meta.url)),
      },
    },
    test: {
      environment: 'jsdom',
      /** jsdom에 없는 브라우저 API를 채운다 — 무엇을 왜 채우는지는 그 파일 주석 참고. */
      setupFiles: [fileURLToPath(new URL('./vitest.setup.ts', import.meta.url))],
      exclude: [...configDefaults.exclude, 'e2e/**'],
      root: fileURLToPath(new URL('./', import.meta.url)),
    },
  }),
)
