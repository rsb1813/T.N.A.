#!/usr/bin/env node
// glTF/GLB 모델을 헤드리스 Chromium + three.js 로 렌더해서 PNG 한 장(여러 각도)으로 저장한다.
// 게임 엔진에 가까운 PBR 조명으로 보여주고, 1m 격자와 폴리곤 수 등 통계를 함께 찍는다.
//
//   node tools/preview.mjs <model.glb|model.gltf> [out.png] [--size 1024] [--views 4|1] [--bg #2b2f36] [--no-grid]
//
// 통계(JSON)는 stdout 으로도 출력된다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const opts = { size: 1024, views: 4, bg: '#2b2f36', grid: true, files: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--size') opts.size = parseInt(argv[++i], 10);
    else if (a === '--views') opts.views = parseInt(argv[++i], 10);
    else if (a === '--bg') opts.bg = argv[++i];
    else if (a === '--no-grid') opts.grid = false;
    else if (a === '-h' || a === '--help') opts.help = true;
    else opts.files.push(a);
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
if (opts.help || opts.files.length === 0) {
  console.error('사용법: node tools/preview.mjs <model.glb> [out.png] [--size 1024] [--views 4|1] [--bg #2b2f36] [--no-grid]');
  process.exit(opts.help ? 0 : 1);
}
if (![1, 4].includes(opts.views)) {
  console.error('--views 는 1 또는 4 만 지원한다.');
  process.exit(1);
}

const modelPath = path.resolve(opts.files[0]);
if (!fs.existsSync(modelPath)) {
  console.error(`모델 파일이 없다: ${modelPath}`);
  process.exit(1);
}
const outPath = path.resolve(opts.files[1] ?? modelPath.replace(/\.(glb|gltf)$/i, '') + '.preview.png');
const modelDir = path.dirname(modelPath);
const modelName = path.basename(modelPath);

let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('playwright 를 찾을 수 없다. (클라우드 세션에는 기본 설치되어 있음)');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
};

// base 밖으로 나가는 경로는 거부한다.
function safeJoin(base, rel) {
  const p = path.resolve(base, '.' + path.sep + rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  html,body{margin:0;background:${opts.bg};overflow:hidden}
  #wrap{position:relative;width:${opts.size}px;height:${opts.size}px}
  canvas{display:block}
  .lbl{position:absolute;font:600 13px/1 system-ui,sans-serif;color:#e8eaee;background:#0008;padding:4px 7px;border-radius:4px}
  #stats{position:absolute;left:8px;bottom:8px;font:12px/1.45 ui-monospace,monospace;color:#e8eaee;background:#000a;padding:6px 9px;border-radius:4px;white-space:pre}
</style>
<script type="importmap">{"imports":{"three":"/node_modules/three/build/three.module.js","three/addons/":"/node_modules/three/examples/jsm/"}}</script>
</head><body><div id="wrap"><canvas id="c"></canvas><div id="stats"></div></div>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const SIZE = ${opts.size}, VIEWS = ${opts.views}, GRID = ${opts.grid};
window.onerror = (m) => { window.__error = String(m); };
window.addEventListener('unhandledrejection', (e) => { window.__error = String(e.reason?.stack || e.reason); });

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(SIZE, SIZE);
renderer.setClearColor(new THREE.Color(${JSON.stringify(opts.bg)}), 1);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setScissorTest(true);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.8;

const loader = new GLTFLoader()
  .setDRACOLoader(new DRACOLoader().setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/'))
  .setKTX2Loader(new KTX2Loader().setTranscoderPath('/node_modules/three/examples/jsm/libs/basis/').detectSupport(renderer))
  .setMeshoptDecoder(MeshoptDecoder);

const gltf = await loader.loadAsync('/model/' + ${JSON.stringify(encodeURIComponent(modelName))});
const root = gltf.scene;
scene.add(root);
root.updateMatrixWorld(true);

// 통계
let tris = 0, verts = 0, drawCalls = 0, skinned = 0;
const mats = new Set(), texs = new Set();
root.traverse((o) => {
  if (!o.isMesh) return;
  // GLTFLoader 는 glTF primitive 하나를 Mesh 하나로 만든다 = 드로우콜 하나
  drawCalls += Array.isArray(o.material) ? Math.max(o.geometry.groups.length, 1) : 1;
  if (o.isSkinnedMesh) skinned++;
  o.castShadow = o.receiveShadow = true;
  const g = o.geometry;
  const n = g.index ? g.index.count : g.attributes.position.count;
  const inst = o.isInstancedMesh ? o.count : 1;
  tris += (n / 3) * inst;
  verts += g.attributes.position.count * inst;
  for (const m of [].concat(o.material)) {
    mats.add(m);
    for (const k in m) if (m[k] && m[k].isTexture) texs.add(m[k]);
  }
});
const box = new THREE.Box3().setFromObject(root, true);
const size = box.getSize(new THREE.Vector3());
const center = box.getCenter(new THREE.Vector3());
const stats = {
  file: ${JSON.stringify(modelName)},
  triangles: Math.round(tris), vertices: verts, drawCalls, skinnedMeshes: skinned,
  materials: mats.size, textures: texs.size,
  animations: gltf.animations.map((a) => a.name + ' (' + a.duration.toFixed(2) + 's)'),
  sizeMeters: [size.x, size.y, size.z].map((v) => +v.toFixed(3)),
  minY: +box.min.y.toFixed(3),
};
window.__stats = stats;
document.getElementById('stats').textContent =
  'tris ' + stats.triangles.toLocaleString() + '  verts ' + stats.vertices.toLocaleString() +
  '\\ndraw calls ' + drawCalls + '  materials ' + mats.size + '  textures ' + texs.size +
  '\\nsize ' + stats.sizeMeters.join(' x ') + ' m (X x Y x Z)' +
  (stats.animations.length ? '\\nanim ' + stats.animations.join(', ') : '');

// 바닥 격자(1m 칸)와 그림자 받는 바닥
const radius = Math.max(size.length() / 2, 0.01);
const floorY = box.min.y;
if (GRID) {
  const span = Math.max(2, Math.ceil(Math.max(size.x, size.z) * 2));
  const grid = new THREE.GridHelper(span, span, 0x8a93a3, 0x4a515c);
  grid.position.set(Math.round(center.x), floorY, Math.round(center.z));
  scene.add(grid);
}
const floor = new THREE.Mesh(new THREE.PlaneGeometry(radius * 20, radius * 20), new THREE.ShadowMaterial({ opacity: 0.3 }));
floor.rotation.x = -Math.PI / 2;
floor.position.set(center.x, floorY - 0.0005, center.z);
floor.receiveShadow = true;
scene.add(floor);

// 키 라이트(그림자)
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.copy(center).add(new THREE.Vector3(1, 2, 1.4).normalize().multiplyScalar(radius * 6));
sun.target.position.copy(center);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const sc = sun.shadow.camera;
sc.left = sc.bottom = -radius * 2; sc.right = sc.top = radius * 2;
sc.near = radius * 0.5; sc.far = radius * 12;
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// 카메라 각도 (방위각, 고도) — glTF 기준 +Z 가 앞
const ALL = [
  { name: '3/4 앞', az: 35, el: 22 },
  { name: '앞 (+Z)', az: 0, el: 4 },
  { name: '옆 (+X)', az: 90, el: 4 },
  { name: '3/4 뒤', az: 215, el: 28 },
];
const views = ALL.slice(0, VIEWS);
const cols = VIEWS === 1 ? 1 : 2;
const cell = SIZE / cols;
const cam = new THREE.PerspectiveCamera(35, 1, radius * 0.01, radius * 100);
const dist = radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.08;
const wrap = document.getElementById('wrap');

views.forEach((v, i) => {
  const cx = (i % cols) * cell, cyTop = Math.floor(i / cols) * cell;
  const az = THREE.MathUtils.degToRad(v.az), el = THREE.MathUtils.degToRad(v.el);
  cam.position.set(
    center.x + dist * Math.cos(el) * Math.sin(az),
    center.y + dist * Math.sin(el),
    center.z + dist * Math.cos(el) * Math.cos(az));
  cam.lookAt(center);
  cam.updateProjectionMatrix();
  const y = SIZE - cyTop - cell; // WebGL 은 아래가 원점
  renderer.setViewport(cx, y, cell, cell);
  renderer.setScissor(cx, y, cell, cell);
  renderer.render(scene, cam);
  if (VIEWS > 1) {
    const l = document.createElement('div');
    l.className = 'lbl'; l.textContent = v.name;
    l.style.left = (cx + 8) + 'px'; l.style.top = (cyTop + 8) + 'px';
    wrap.appendChild(l);
  }
});
window.__done = true;
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = null;
  if (url === '/') {
    res.writeHead(200, { 'content-type': TYPES['.html'] });
    return res.end(PAGE);
  }
  if (url.startsWith('/model/')) file = safeJoin(modelDir, url.slice('/model/'.length));
  else if (url.startsWith('/node_modules/')) file = safeJoin(REPO, url.slice(1));
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let code = 0;
try {
  const page = await browser.newPage({ viewport: { width: opts.size, height: opts.size } });
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.__done || window.__error, null, { timeout: 120000 });
  const err = await page.evaluate(() => window.__error);
  if (err) throw new Error(err);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.locator('#wrap').screenshot({ path: outPath });
  const stats = await page.evaluate(() => window.__stats);
  console.log(JSON.stringify({ ...stats, preview: outPath }, null, 2));
  if (logs.length) console.error(logs.join('\n'));
} catch (e) {
  console.error('렌더 실패:', e.message);
  code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
