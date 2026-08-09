// 브라우저 세션 헬퍼 — playwright-core(브라우저 무다운로드)로 시스템 Chrome/Edge 를
// 구동한다. 로그인은 /spcb/api/me 라우트 스텁으로 해결: sp-vue 는 마운트 전 이
// 엔드포인트로 PHPSESSID→JWT 교환(bootstrap)을 하므로, me.php 와 같은 형태의 응답에
// 로컬 서명 JWT 를 담아 주면 비밀번호·PHP 세션 없이 실 Vue + 실 Node API 가 돈다.
// (그누보드 실로그인 왕복 자체를 검증할 때만 PHP 를 실제로 태울 것 — README 참조.)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { BASE_URL, HEADED, outputDir } from './env';
import { signJwt, type JwtIdentity } from './jwt';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (browser !== null) return browser;
  const attempts: string[] = [];
  for (const channel of ['chrome', 'msedge'] as const) {
    try {
      browser = await chromium.launch({ channel, headless: !HEADED });
      return browser;
    } catch (e) {
      attempts.push(`${channel}: ${e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)}`);
    }
  }
  throw new Error(
    `시스템 Chrome/Edge 실행 실패 — playwright-core 는 설치된 브라우저 channel 만 씁니다.\n${attempts.join('\n')}`,
  );
}

/** afterAll 에서 호출 — 안 닫으면 vitest 프로세스가 안 끝난다. */
export async function closeBrowser(): Promise<void> {
  if (browser !== null) {
    await browser.close();
    browser = null;
  }
}

export interface SessionOptions {
  /** 진입 리졸버 기억값(localStorage sp.partnerModule) 사전 세팅 — 트랙 2개 조직 케이스용 */
  partnerModule?: 'bom' | 'pcb';
  /** 그 외 localStorage 사전 세팅(키:값) — 앱 코드 실행 전에 주입된다 */
  localStorage?: Record<string, string>;
}

export interface E2eSession {
  context: BrowserContext;
  page: Page;
  /** page.on('pageerror') 수집 — 시나리오 말미에 비어 있음을 확인할 수 있다 */
  pageErrors: string[];
  close: () => Promise<void>;
}

/**
 * 새 브라우저 세션(컨텍스트+페이지). identity 를 주면 그 계정으로 "로그인된" 상태,
 * null 이면 익명(requiresMember 가드가 /bbs/login.php 로 보낸다 — 기본 nginx 도메인
 * 에선 실화면까지 뜨고, vite 직결 오버라이드 시엔 404 화면이나 URL 왕복 검증은 가능).
 */
export async function newSession(
  identity: JwtIdentity | null,
  options: SessionOptions = {},
): Promise<E2eSession> {
  const b = await getBrowser();
  const context = await b.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true, // nginx 경유(자가서명 https) 실행 대비
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
  });

  if (identity !== null) {
    await context.route('**/spcb/api/me', async (route) => {
      const token = signJwt(identity); // 매 재교환(401 재발급 경로)마다 새 토큰
      const isAdmin = identity.isAdmin ?? false;
      const member = {
        mbId: identity.mbId,
        mbNick: identity.mbNick ?? identity.mbId,
        level: identity.level ?? (isAdmin ? 10 : 2),
        isAdmin,
      };
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ token, member }),
      });
    });
  }

  const presets: Record<string, string> = { ...options.localStorage };
  if (options.partnerModule !== undefined) presets['sp.partnerModule'] = options.partnerModule;
  if (Object.keys(presets).length > 0) {
    await context.addInitScript((kv) => {
      for (const [k, v] of Object.entries(kv)) window.localStorage.setItem(k, v);
    }, presets);
  }

  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return { context, page, pageErrors, close: () => context.close() };
}

/** vue-router base(/app) 프리픽스를 붙여 이동 — gotoApp(page, '/partner') */
export async function gotoApp(page: Page, path: string): Promise<void> {
  await page.goto(`/app${path.startsWith('/') ? path : `/${path}`}`);
}

/** 디버그 스크린샷 — e2e/output/<name>.png (gitignore) */
export async function snap(page: Page, name: string): Promise<string> {
  mkdirSync(outputDir, { recursive: true });
  const path = join(outputDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}
