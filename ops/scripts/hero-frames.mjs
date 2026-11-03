#!/usr/bin/env node
// 영상 → 캔버스 프레임 팩 — 개발의뢰 랜딩 히어로(apps/develop HeroCanvas.vue)가 재생하는 파일을 만든다(docs/FIGMA_PAGES.md "개발의뢰 랜딩").
// playwright-core(시스템 Chrome 헤드리스)의 디코더로 프레임을 하나씩 찾아가 캔버스에 그리고 WebP 로 인코딩한다(ffmpeg 불필요).
//
// 사용:
//   node ops/scripts/hero-frames.mjs <video.mp4> <outDir> [--name=hero-explode] [--width=1280] [--q=0.75] [--thr=0.3] [--crop=56] [--still=5.5]
//     --crop   양옆에서 잘라 낼 원본 px. 화면에 안 보이는 띠를 빼 용량을 줄인다(1350 표시폭 중 가운데 1280 만 보이면 원본 2172 기준 56).
//     --thr    마지막으로 남긴 프레임과의 평균 휘도 차(0~255, 1/4 축소)가 이 값 이하면 새로 싣지 않고 그 프레임을 다시 쓴다(멈춘 구간 압축).
//     --still  다 펼쳐진 장면 정지 화면의 시각(초).
//   결과: <name>.bin(팩)·<name>-start.jpg(첫 프레임)·<name>-still.jpg(--still 시각). 정지 화면은 자른 원본 해상도.
//
// 팩 형식: [u32 LE 머리말 길이][머리말 JSON(UTF-8)][WebP 바이트들…]
//   머리말 = { fps, w, h, frames: 재생 프레임 i → 고유 프레임 번호, sizes: 고유 프레임별 바이트 수 }
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
let chromium = null;
for (const from of [resolve(here, '../../samplepcb-web-mono-app/e2e/package.json'), resolve(here, '../../samplepcb-web-mono-app/package.json')]) {
    try { chromium = createRequire(from)('playwright-core').chromium; break; } catch { /* 다음 후보 */ }
}
if (!chromium) throw new Error('playwright-core 를 찾지 못했다 — samplepcb-web-mono-app/e2e 에서 pnpm install');

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')));
const [video, outDir] = pos;
if (!video || !outDir) throw new Error('usage: node ops/scripts/hero-frames.mjs <video.mp4> <outDir> [--name=…] [--width=…] [--q=…] [--thr=…] [--crop=…] [--still=…]');
const name = opt.name ?? 'hero-explode';
const conf = { width: +(opt.width ?? 1280), q: +(opt.q ?? 0.75), thr: +(opt.thr ?? 0.3), crop: +(opt.crop ?? 56), still: +(opt.still ?? 5.5) };
mkdirSync(outDir, { recursive: true });

const videoUrl = pathToFileURL(resolve(video)).href;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--allow-file-access-from-files'] });
const page = await browser.newPage();
page.setDefaultTimeout(0);
await page.goto(pathToFileURL(dirname(resolve(video))).href + '/');
await page.exposeFunction('saveFile', (file, b64) => writeFileSync(resolve(outDir, file), Buffer.from(b64, 'base64')));
const report = await page.evaluate(async ({ src, conf, name }) => {
    const v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.src = src;
    await new Promise((ok, ng) => { v.onloadeddata = ok; v.onerror = () => ng(new Error(`영상을 열지 못했다(${v.error?.code})`)); });
    // 프레임률은 영상 메타에 없어(HTMLVideoElement) 24 로 둔다 — 다른 영상이면 여기를 바꾼다.
    const FPS = 24, N = Math.round(v.duration * FPS);
    const SW = v.videoWidth - conf.crop * 2, SH = v.videoHeight;
    const full = document.createElement('canvas'); full.width = SW; full.height = SH;
    const fg = full.getContext('2d', { willReadFrequently: true });
    const out = document.createElement('canvas'); out.width = conf.width; out.height = Math.round(conf.width * SH / SW);
    const og = out.getContext('2d'); og.imageSmoothingQuality = 'high';
    const LW = Math.floor(SW / 4), LH = Math.floor(SH / 4);
    const small = document.createElement('canvas'); small.width = LW; small.height = LH;
    const sg = small.getContext('2d', { willReadFrequently: true });
    const seek = (i) => new Promise((ok) => { v.onseeked = ok; v.currentTime = (i + 0.5) / FPS; });
    const grab = () => fg.drawImage(v, conf.crop, 0, SW, SH, 0, 0, SW, SH);
    const lum = () => {
        sg.drawImage(full, 0, 0, LW, LH);
        const d = sg.getImageData(0, 0, LW, LH).data;
        const L = new Uint8Array(LW * LH);
        for (let p = 0; p < L.length; p++) L[p] = (d[p * 4] * 54 + d[p * 4 + 1] * 183 + d[p * 4 + 2] * 19) >> 8;
        return L;
    };
    const mad = (a, b) => { let s = 0; for (let p = 0; p < a.length; p++) s += Math.abs(a[p] - b[p]); return s / a.length; };
    const blob = (c, type, q) => new Promise((ok) => c.toBlob(ok, type, q));
    const b64 = async (b) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };

    const frames = [];
    const blobs = [];
    let last = null;
    for (let i = 0; i < N; i++) {
        await seek(i);
        grab();
        const L = lum();
        if (last === null || mad(L, last) > conf.thr) {
            last = L;
            og.drawImage(full, 0, 0, out.width, out.height);
            blobs.push(await blob(out, 'image/webp', conf.q));
        }
        frames.push(blobs.length - 1);
    }
    const head = new TextEncoder().encode(JSON.stringify({ fps: FPS, w: out.width, h: out.height, frames, sizes: blobs.map((b) => b.size) }));
    const len = new Uint8Array(4); new DataView(len.buffer).setUint32(0, head.length, true);
    const pack = new Blob([len, head, ...blobs]);
    await window.saveFile(`${name}.bin`, await b64(pack));
    const stills = [];
    for (const [i, file] of [[0, `${name}-start.jpg`], [Math.round(conf.still * FPS), `${name}-still.jpg`]]) {
        await seek(i); grab();
        const b = await blob(full, 'image/jpeg', 0.8);
        await window.saveFile(file, await b64(b));
        stills.push(`${file} ${SW}×${SH} ${(b.size / 1024).toFixed(0)}KB`);
    }
    return { frames: N, unique: blobs.length, size: `${out.width}×${out.height}`, packMB: (pack.size / 1048576).toFixed(2), stills };
}, { src: videoUrl, conf, name });
console.log(JSON.stringify(report, null, 1));
await browser.close();
