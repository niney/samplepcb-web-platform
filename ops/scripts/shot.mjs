#!/usr/bin/env node
// 로컬 화면 스크린샷 헬퍼 — playwright-core(브라우저 무다운로드, 시스템 Chrome/Edge)로 URL 을 열어 PNG 로 저장한다.
// 피그마 구현을 화면과 대조할 때 쓴다(헤드리스라 Aside/Chrome 확장과 충돌 없음).
//
// 사용:
//   node ops/scripts/shot.mjs <url> <out.png> [--width=1920] [--height=1080] [--full] [--selector=.sp-eyes]
//                                              [--wait=1200] [--scroll=Y] [--scale=1] [--mobile]
//   --full      전체 페이지     --selector  그 요소만(스크롤해서)     --scroll  세로 스크롤 뒤 뷰포트 캡처
//   --mobile    터치·isMobile 컨텍스트(폭은 --width 로, 예: --width=390 --height=844 --mobile)
// 출력: JSON 한 줄(치수·박스) + 홈이면 .sp-home 직계 섹션의 top/height + 콘솔 error/warning·pageerror 목록
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
let chromium = null;
for (const from of [
    resolve(here, '../../samplepcb-web-mono-app/e2e/package.json'),
    resolve(here, '../../samplepcb-web-mono-app/package.json'),
]) {
    try { chromium = createRequire(from)('playwright-core').chromium; break; } catch { /* 다음 후보 */ }
}
if (!chromium) {
    console.error('playwright-core 를 찾지 못했습니다 — samplepcb-web-mono-app 에서 pnpm install 을 먼저 하세요.');
    process.exit(2);
}

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(argv.filter((a) => a.startsWith('--')).map((a) => {
    const i = a.indexOf('=');
    return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)];
}));
const [url, out] = positional;
if (!url || !out) {
    console.error('usage: node ops/scripts/shot.mjs <url> <out.png> [--width=1920] [--height=1080] [--full] [--selector=CSS] [--wait=1200] [--scroll=Y] [--scale=1] [--mobile]');
    process.exit(1);
}

const width = Number(opt.width || 1920);
const height = Number(opt.height || 1080);

let browser = null;
const attempts = [];
for (const channel of ['chrome', 'msedge']) {
    try { browser = await chromium.launch({ channel, headless: true }); break; }
    catch (e) { attempts.push(`${channel}: ${String(e && e.message || e).split('\n')[0]}`); }
}
if (!browser) {
    console.error('시스템 Chrome/Edge 실행 실패:\n' + attempts.join('\n'));
    process.exit(3);
}

try {
    const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: Number(opt.scale || 1),
        ignoreHTTPSErrors: true,
        locale: 'ko-KR',
        isMobile: Boolean(opt.mobile),
        hasTouch: Boolean(opt.mobile),
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e)));
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[console.${m.type()}] ${m.text()} @ ${m.location()?.url || ''}`); });
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`[${r.status()}] ${r.url()}`); });
    page.on('requestfailed', (r) => errors.push(`[failed] ${r.url()} ${r.failure()?.errorText || ''}`));

    try { await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 }); }
    catch { await page.goto(url, { waitUntil: 'load', timeout: 60000 }); }

    if (opt.scroll) await page.evaluate((y) => window.scrollTo(0, y), Number(opt.scroll));
    if (opt.hover) await page.locator(String(opt.hover)).first().hover();          // --hover=CSS  드롭다운·호버 상태 캡처
    if (opt.click) await page.locator(String(opt.click)).first().click();          // --click=CSS  탭·아코디언 상태 캡처
    await page.waitForTimeout(Number(opt.wait || 1200));

    mkdirSync(dirname(resolve(out)), { recursive: true });
    if (opt.selector) {
        const el = page.locator(String(opt.selector)).first();
        await el.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        await el.screenshot({ path: out });
        const box = await el.boundingBox();
        console.log(JSON.stringify({ out, selector: opt.selector, box }));
    } else {
        await page.screenshot({ path: out, fullPage: Boolean(opt.full) });
        const dims = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            innerWidth: window.innerWidth,
            innerHeight: window.innerHeight,
        }));
        console.log(JSON.stringify({ out, full: Boolean(opt.full), ...dims }));
    }

    // 홈이면 직계 섹션 위치 — 피그마 y 와 대조용
    const sections = await page.evaluate(() => Array.from(document.querySelectorAll('.sp-home > *')).map((el) => {
        const r = el.getBoundingClientRect();
        return { cls: el.className || el.tagName.toLowerCase(), top: Math.round(r.top + window.scrollY), height: Math.round(r.height), width: Math.round(r.width) };
    }));
    if (sections.length) console.log('sections ' + JSON.stringify(sections));
    if (errors.length) console.log('errors ' + JSON.stringify(errors.slice(0, 20)));
} finally {
    await browser.close();
}
