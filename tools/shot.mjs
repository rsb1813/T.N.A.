#!/usr/bin/env node
// Vite 개발 서버를 띄우고 헤드리스 Chromium 으로 페이지를 열어 스크린샷을 찍는다.
// 모듈별 단독 테스트 페이지(sandbox/*.html) 검증용. 여러 개를 동시에 돌려도 된다(포트/캐시 분리).
//
//   node tools/shot.mjs <page> <out.png> [--size 1280x720] [--wait "window.__ready"] [--timeout 90000]
//                       [--eval "js 코드"] [--delay 500] [--keep-open]
//   예) node tools/shot.mjs sandbox/world.html out/world.png --wait "window.__ready"
//       node tools/shot.mjs "index.html?mission=m01" out/m01.png --wait "window.__ready" --delay 2000
//
// 콘솔 에러/경고는 stderr 로, window.__report 가 있으면 그 값을 JSON 으로 stdout 에 출력한다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const opt = { size: '1280x720', wait: null, timeout: 90000, eval: null, delay: 0, files: [] };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--size') opt.size = args[++i];
  else if (a === '--wait') opt.wait = args[++i];
  else if (a === '--timeout') opt.timeout = +args[++i];
  else if (a === '--eval') opt.eval = args[++i];
  else if (a === '--delay') opt.delay = +args[++i];
  else opt.files.push(a);
}
if (opt.files.length < 2) {
  console.error('사용법: node tools/shot.mjs <page> <out.png> [--size WxH] [--wait expr] [--timeout ms] [--eval js] [--delay ms]');
  process.exit(1);
}
const [page, out] = opt.files;
const [W, H] = opt.size.split('x').map(Number);

const { createServer } = await import('vite');
const { chromium } = require('playwright');

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tna-vite-'));
const server = await createServer({
  root: REPO,
  configFile: path.join(REPO, 'vite.config.ts'),
  cacheDir,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', strictPort: false, hmr: false },
});
await server.listen();
const addr = server.httpServer.address();
const url = `http://127.0.0.1:${addr.port}/${page.replace(/^\//, '')}`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
let code = 0;
try {
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  const logs = [];
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
  });
  p.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
  await p.goto(url, { waitUntil: 'load', timeout: opt.timeout });
  if (opt.wait) await p.waitForFunction(opt.wait, null, { timeout: opt.timeout, polling: 250 });
  if (opt.eval) await p.evaluate(opt.eval);
  if (opt.delay) await p.waitForTimeout(opt.delay);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  await p.screenshot({ path: out });
  const report = await p.evaluate(() => window.__report ?? null).catch(() => null);
  if (report != null) console.log(JSON.stringify(report, null, 2));
  console.error(`스크린샷: ${path.resolve(out)}`);
  if (logs.length) {
    console.error(`--- 콘솔 에러/경고 ${logs.length}건 ---`);
    console.error(logs.slice(0, 50).join('\n'));
  }
  if (logs.some((l) => l.startsWith('[pageerror]') || l.startsWith('[error]'))) code = 2;
} catch (e) {
  console.error('실패:', e.message);
  code = 1;
} finally {
  await browser.close();
  await server.close();
  fs.rmSync(cacheDir, { recursive: true, force: true });
}
process.exit(code);
