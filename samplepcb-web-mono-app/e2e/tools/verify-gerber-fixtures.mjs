// 거버 픽스처 일괄 검증 — e2e/fixtures/*.zip(+fixtures/local/*.zip)을 하나씩 뷰어에
// 업로드해 파싱→가격 계산→[견적요청] 버튼 노출까지 판정한다. 제출은 하지 않는다
// (서버에 아무것도 만들지 않는 읽기 검증 — 시나리오 픽스처 선별용).
//
// 사전 조건: 거버 dev 서버(sp-gerber-eye-v3 에서 `pnpm dev`, 8040) + nginx.
// 실행: node e2e/tools/verify-gerber-fixtures.mjs [이름필터]
//   예: node e2e/tools/verify-gerber-fixtures.mjs clockblock
import { readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(e2eDir, 'package.json'))('playwright-core');

const GERBER_URL = process.env.E2E_GERBER_URL ?? 'https://local-gerber.samplepcb.co.kr';
const filter = process.argv[2] ?? '';

const zipDirs = [join(e2eDir, 'fixtures'), join(e2eDir, 'fixtures', 'local')];
const zips = zipDirs
  .filter((d) => existsSync(d))
  .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.zip')).map((f) => join(d, f)))
  .filter((p) => p.includes(filter));
if (zips.length === 0) {
  console.error('검증할 zip 이 없습니다 — e2e/fixtures/*.zip');
  process.exit(1);
}

try {
  await fetch(GERBER_URL, { method: 'HEAD' });
} catch {
  console.error(`${GERBER_URL} 도달 실패 — 거버 dev 서버(8040)와 nginx 를 켜세요`);
  process.exit(1);
}

let browser = null;
let failed = 0;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const zip of zips) {
    const name = zip.split(/[\\/]/).pop();
    const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'ko-KR' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(GERBER_URL, { waitUntil: 'domcontentloaded' });
      const input = page.locator('input[type=file]').first();
      await input.waitFor({ state: 'attached', timeout: 15_000 });
      await input.setInputFiles(zip);
      await page.waitForFunction(
        () =>
          /공급가격/.test(document.body.innerText) &&
          /\d{1,3}(,\d{3})+원/.test(document.body.innerText),
        undefined,
        { timeout: 60_000 },
      );
      const text = await page.evaluate(() => document.body.innerText);
      const price = text.match(/\d{1,3}(,\d{3})+원/)?.[0] ?? '?';
      const rfqBtn = /견적요청/.test(text);
      const ok = rfqBtn && errors.length === 0;
      if (!ok) failed += 1;
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${name}  가격=${price}  견적요청버튼=${rfqBtn ? 'O' : 'X'}  pageerror=${String(errors.length)}`,
      );
    } catch (e) {
      failed += 1;
      console.log(`FAIL  ${name}  ${e instanceof Error ? (e.message.split('\n')[0] ?? '') : String(e)}`);
    } finally {
      await context.close();
    }
  }
} finally {
  if (browser !== null) await browser.close();
}
console.log(failed === 0 ? '\nALL PASS' : `\n${String(failed)} FAILED`);
process.exit(failed === 0 ? 0 : 1);
