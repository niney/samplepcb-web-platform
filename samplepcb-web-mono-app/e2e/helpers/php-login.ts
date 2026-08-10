// 그누보드 실로그인 세션 — PHP 화면(주문서·주문내역·EQ 고객확인 등) 왕복용.
// 스텁 로그인(browser.ts)과 달리 진짜 PHPSESSID 를 얻으므로 /bbs·/shop 전 화면과
// me 브리지(거버 제출)가 실환경 그대로 동작한다. 자격은 e2e/.env.e2e(gitignore).
import { BASE_URL } from './env';
import { getBrowser, type E2eSession } from './browser';

export interface PhpLoginResult extends E2eSession {
  mbId: string;
}

/** 그누보드 로그인 폼 왕복 — 성공 시 로그인된 컨텍스트 반환, 실패 시 진단과 함께 throw. */
export async function newPhpSession(creds: { id: string; pw: string }): Promise<PhpLoginResult> {
  const b = await getBrowser();
  const context = await b.newContext({
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    locale: 'ko-KR',
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (err) => pageErrors.push(err.message));

  await page.goto('/bbs/login.php', { waitUntil: 'domcontentloaded' });
  // 그누보드 표준 로그인 폼(name=flogin) — 테마가 마크업을 바꿔도 필드명은 코어 규약.
  await page.locator('input[name="mb_id"]').first().fill(creds.id);
  await page.locator('input[name="mb_password"]').first().fill(creds.pw);
  await Promise.all([
    // 현재 로그인 문서는 이미 domcontentloaded 상태이므로 waitForLoadState만 쓰면 즉시
    // 풀리고 POST/리다이렉트 전에 아래 실패 판정이 실행된다. Enter가 일으키는 실제
    // 내비게이션 완료를 기다려 로그인 성공/실패를 확정한다.
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('input[name="mb_password"]').first().press('Enter'),
  ]);

  // 성공 판정 — 로그인 화면을 벗어났고(login_check 왕복), 로그인 폼이 더는 없다.
  await page.waitForLoadState('domcontentloaded');
  if (page.url().includes('login.php')) {
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
    await context.close();
    throw new Error(`그누보드 로그인 실패(${creds.id}) — 화면: ${bodyText}`);
  }
  return { context, page, pageErrors, mbId: creds.id, close: () => context.close() };
}
