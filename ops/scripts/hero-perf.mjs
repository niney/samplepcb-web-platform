#!/usr/bin/env node
// 홈 히어로 배경 애니메이션 성능·강등 회귀 점검 — playwright-core(시스템 Chrome/Edge 헤드리스) + CDP CPU 스로틀.
// 2026-09-21 "배경 움직임 적용 시 wide 로 조정하면 끊김" 제보 대응(docs/FIGMA_PAGES.md 히어로 항목)의 측정 도구.
//
// 사용:
//   node ops/scripts/hero-perf.mjs perf   [--url=…] [--widths=1920,2560] [--cpu=4] [--dpr=1]
//       배너 5장 각각 rAF 프레임 간격(평균·최대·50ms 초과 수·longtask)을 3초씩 잰다. 배너 01(SVG 윤곽 회전)만 메인스레드를 쓰고
//       02~04 팬·04 backdrop 은 컴포지터 몫이라 여기 안 잡힌다. 기준값(이 PC, cpu×4, 1920): 01 평균 8.2ms / 나머지 6.9ms(=빈 프레임).
//   node ops/scripts/hero-perf.mjs verify [--url=…]
//       ① 정상 기기: 라이트 아님, will-change 는 활성 팬만  ② sessionStorage 플래그로 처음부터 라이트(팬·회전·backdrop·영상 전부 꺼짐)
//       ③ cpu×20 에서 감시가 몇 초 만에 .is-lite 를 붙이는가(배너 01 6초 안에 판정돼야 함)  ④ 팬 진행 중 1920→3400 리사이즈에 translateX 가 안 뛰는가
//       ⑤ 3400 폭·팬 양 끝에서 콘텐츠 밖 구간의 인접 픽셀 최대 점프(이음새; 이미지 안 장식은 20 안팎, 이음새 자체는 ≤3 이어야 함)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let chromium = null;
for (const from of [resolve(here, '../../samplepcb-web-mono-app/e2e/package.json'), resolve(here, '../../samplepcb-web-mono-app/package.json')]) {
    try { chromium = createRequire(from)('playwright-core').chromium; break; } catch { /* 다음 후보 */ }
}
if (!chromium) { console.error('playwright-core 를 찾지 못했습니다 — samplepcb-web-mono-app 에서 pnpm install 을 먼저 하세요.'); process.exit(2); }

const argv = process.argv.slice(2);
const mode = argv.find((a) => !a.startsWith('--')) || 'perf';
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; }));
const URL_ = opt.url || 'https://local-web.samplepcb.co.kr/';
const LABELS = ['01 gerber(SVG morph)', '02 order(pan)', '03 korlinx(pan)', '04 onestop(pan+backdrop)', '05 rapid(video)'];

let browser = null;
for (const channel of ['chrome', 'msedge']) { try { browser = await chromium.launch({ channel, headless: true }); break; } catch { /* 다음 */ } }
if (!browser) { console.error('시스템 Chrome/Edge 실행 실패'); process.exit(3); }
const ctxOpts = (width, dpr = 1) => ({ viewport: { width, height: 1000 }, deviceScaleFactor: dpr, ignoreHTTPSErrors: true, locale: 'ko-KR' });
const clickDot = (page, k) => page.evaluate((k) => document.querySelectorAll('.sp-hero__dot')[k].click(), k);

const MEASURE = `(async (ms) => {
  const out = { frames: 0, long50: 0, max: 0, sum: 0, longtasks: 0, longtaskMs: 0 };
  const po = new PerformanceObserver(l => { for (const e of l.getEntries()) { out.longtasks++; out.longtaskMs += e.duration; } });
  try { po.observe({ type: 'longtask' }); } catch {}
  let last = performance.now(); const end = last + ms;
  await new Promise(res => { function f(t) { const d = t - last; last = t; out.frames++; out.sum += d; if (d > out.max) out.max = d; if (d > 50) out.long50++; if (t < end) requestAnimationFrame(f); else res(); } requestAnimationFrame(f); });
  po.disconnect();
  out.avg = +(out.sum / out.frames).toFixed(1); out.fps = +(out.frames / (ms / 1000)).toFixed(1);
  return out;
})`;

try {
    if (mode === 'perf') {
        const widths = String(opt.widths || '1920,2560').split(',').map(Number);
        const cpu = Number(opt.cpu || 4), dpr = Number(opt.dpr || 1);
        for (const width of widths) {
            const ctx = await browser.newContext(ctxOpts(width, dpr));
            const page = await ctx.newPage();
            const cdp = await ctx.newCDPSession(page);
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
            await page.goto(URL_, { waitUntil: 'load' });
            await page.waitForSelector('#sp-hero.is-organic', { timeout: 8000 }).catch(() => {});
            await page.waitForTimeout(800);
            const info = await page.evaluate(() => ({ vw: innerWidth, dpr: devicePixelRatio, pan: getComputedStyle(document.getElementById('sp-hero')).getPropertyValue('--sp-pan').trim(), organic: document.getElementById('sp-hero').classList.contains('is-organic'), lite: document.getElementById('sp-hero').classList.contains('is-lite'), dLen: (document.getElementById('sp-organic-path').getAttribute('d') || '').length }));
            console.log(`\n=== width ${width} dpr ${dpr} cpu×${cpu} — ${JSON.stringify(info)}`);
            for (let i = 0; i < 5; i++) {
                await clickDot(page, i);
                await page.waitForTimeout(1200); // 크로스페이드 끝
                const r = await page.evaluate(`${MEASURE}(3000)`);
                console.log(LABELS[i].padEnd(26), `fps ${String(r.fps).padStart(5)}  avg ${String(r.avg).padStart(5)}ms  max ${String(r.max.toFixed(0)).padStart(4)}ms  >50ms ${r.long50}  longtask ${r.longtasks}(${r.longtaskMs.toFixed(0)}ms)`);
            }
            await ctx.close();
        }
    } else if (mode === 'verify') {
        const state = (page) => page.evaluate(() => {
            const root = document.getElementById('sp-hero');
            const pan = document.querySelector('.sp-s2 .sp-slide__pan');
            const css = (el, p) => el ? getComputedStyle(el)[p] : 'n/a';
            return {
                lite: root.classList.contains('is-lite'), organic: root.classList.contains('is-organic'),
                panAnim: css(pan, 'animationName'), activePanWillChange: css(document.querySelector('.sp-hero__slide.is-active .sp-slide__pan'), 'willChange'), inactivePanWillChange: css(document.querySelector('.sp-hero__slide:not(.is-active) .sp-slide__pan'), 'willChange'),
                ringBackdrop: css(document.querySelector('.sp-s4__ring'), 'backdropFilter'), videoDisplay: css(document.querySelector('.sp-s5__video'), 'display'),
                linesDisplay: css(document.querySelector('.sp-hero__lines'), 'display'), organicDisplay: css(document.querySelector('.sp-hero__organic'), 'display'),
            };
        });
        let ok = true;
        const check = (name, cond, detail) => { ok = ok && cond; console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); };
        { // ① 정상
            const ctx = await browser.newContext(ctxOpts(1920)); const page = await ctx.newPage();
            await page.goto(URL_, { waitUntil: 'load' }); await page.waitForSelector('#sp-hero.is-organic', { timeout: 8000 }).catch(() => {});
            await clickDot(page, 1); await page.waitForTimeout(900);
            const s = await state(page);
            check('정상 기기: 라이트 아님·회전 켜짐·팬 애니메이션', !s.lite && s.organic && s.panAnim === 'sp-hero-pan', JSON.stringify(s));
            check('will-change 는 활성 팬만', s.activePanWillChange === 'transform' && s.inactivePanWillChange === 'auto');
            await ctx.close();
        }
        { // ② 세션 라이트
            const ctx = await browser.newContext(ctxOpts(1920)); const page = await ctx.newPage();
            await page.addInitScript(() => { try { sessionStorage.setItem('sp-hero-lite', '1'); } catch { /* 무시 */ } });
            const heavy = []; page.on('request', (r) => { if (/motion-path\.js|\.mp4/.test(r.url())) heavy.push(r.url().split('/').pop().split('?')[0]); });
            await page.goto(URL_, { waitUntil: 'load' }); await page.waitForTimeout(1500);
            await clickDot(page, 4); await page.waitForTimeout(900);
            const s = await state(page);
            check('세션 라이트: 팬·회전·backdrop·영상 전부 꺼짐', s.lite && !s.organic && s.panAnim === 'none' && s.ringBackdrop === 'none' && s.videoDisplay === 'none' && s.linesDisplay === 'block', JSON.stringify(s));
            check('세션 라이트: 모듈·영상 요청 없음', heavy.length === 0, heavy.join(','));
            await ctx.close();
        }
        { // ③ 감시 강등
            const ctx = await browser.newContext(ctxOpts(1920)); const page = await ctx.newPage();
            const logs = []; page.on('console', (m) => { if (/sp-hero/.test(m.text())) logs.push(m.text()); });
            const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
            await page.goto(URL_, { waitUntil: 'load' }); await page.waitForSelector('#sp-hero.is-organic', { timeout: 20000 }).catch(() => {});
            const t0 = Date.now();
            const hit = await page.waitForSelector('#sp-hero.is-lite', { timeout: 8000 }).then(() => true).catch(() => false);
            check('cpu×20 감시 강등(배너 01 6초 안)', hit, `${((Date.now() - t0) / 1000).toFixed(1)}s ${logs.join(' | ')}`);
            await ctx.close();
        }
        { // ④ 리사이즈 불연속
            const ctx = await browser.newContext(ctxOpts(1920)); const page = await ctx.newPage();
            await page.goto(URL_, { waitUntil: 'load' });
            await clickDot(page, 1); await page.waitForTimeout(7500);
            const tx = () => page.evaluate(() => +new DOMMatrix(getComputedStyle(document.querySelector('.sp-s2 .sp-slide__pan')).transform).e.toFixed(1));
            const a = await tx(); await page.setViewportSize({ width: 3400, height: 1000 }); await page.waitForTimeout(50); const b = await tx();
            check('리사이즈 1920→3400 에 팬 translateX 불변', Math.abs(b - a) < 2, `${a} → ${b}`);
            await ctx.close();
        }
        { // ⑤ 이음새
            const ctx = await browser.newContext(ctxOpts(3400)); const page = await ctx.newPage();
            await page.goto(URL_, { waitUntil: 'load' }); await page.waitForTimeout(500);
            for (const [i, name] of [[1, '02'], [2, '03'], [3, '04']]) {
                await clickDot(page, i); await page.waitForTimeout(900);
                for (const delay of ['-15s', '-45s']) {
                    await page.evaluate((d) => { document.querySelectorAll('.sp-slide__pan').forEach((p) => { p.style.animationDelay = d; p.style.animationPlayState = 'paused'; }); }, delay);
                    await page.waitForTimeout(150);
                    const buf = await page.screenshot({ clip: { x: 0, y: 72, width: 3400, height: 594 } });
                    // 팬 −600(delay −15s)이면 이미지 오른끝 x=2960, +600(−45s)이면 왼끝 x=440 — 그 자리 ±1 픽셀 점프를 본다
                    const seamX = delay === '-15s' ? 2960 : 440;
                    const r = await page.evaluate(async ({ b64, seamX }) => {
                        const img = new Image(); await new Promise((res) => { img.onload = res; img.src = 'data:image/png;base64,' + b64; });
                        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
                        let max = 0;
                        for (const y of [60, 200, 400, 560]) { const row = g.getImageData(seamX - 3, y, 7, 1).data; for (let x = 1; x < 7; x++) for (let ch = 0; ch < 3; ch++) max = Math.max(max, Math.abs(row[x * 4 + ch] - row[x * 4 - 4 + ch])); }
                        return max;
                    }, { b64: buf.toString('base64'), seamX });
                    check(`3400 폭 배너 ${name} 팬 ${delay === '-15s' ? '−600' : '+600'} 이음새(x=${seamX}) 색 점프 ≤ 4`, r <= 4, `최대 ${r}`);
                }
            }
            await ctx.close();
        }
        console.log(ok ? '\n전부 통과' : '\n실패 있음');
        process.exitCode = ok ? 0 : 1;
    } else {
        console.error('usage: node ops/scripts/hero-perf.mjs perf|verify [--url=] [--widths=] [--cpu=] [--dpr=]');
        process.exitCode = 1;
    }
} finally {
    await browser.close();
}
