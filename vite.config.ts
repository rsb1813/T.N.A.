import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// sandbox/*.html 은 모듈별 단독 테스트 페이지. 빌드에도 포함해 둔다.
const sandboxPages = Object.fromEntries(
  readdirSync(resolve(__dirname, 'sandbox'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [`sandbox_${f.replace(/\.html$/, '')}`, resolve(__dirname, 'sandbox', f)]),
);

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), ...sandboxPages } },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
  },
});
