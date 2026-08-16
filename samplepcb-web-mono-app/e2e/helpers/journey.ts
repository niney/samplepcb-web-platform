// 완주 여정 공용부 — 여정 스펙(1호 국제·2호 국내)이 같은 관찰 규약과 같은 고객 조작을
// 쓰도록 모은다. 여정마다 다른 것은 "누구를 통해 어떻게 만드느냐"이지, 고객이 거버를 올리고
// 주문서를 채우는 손놀림이 아니다 — 그 손놀림이 갈라지면 한쪽만 고쳐지고 다른 쪽은 묵는다.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASE_URL, GERBER_URL, outputDir } from './env';
import { snap } from './browser';
import { findLatestOrder } from './g5';
import { getPrisma } from './db';

/**
 * 공급사 검색 일일 한도(회원당 20회)를 e2e 전용 계정에 한해 오늘치만 되돌린다.
 *
 * 소진되면 검색이 **429** 라 후보 스냅샷이 0건이 되고, 그 뒤로 수량·선정·가격이
 * 통째로 비어 **엉뚱한 어서션이 깨진다** — 2026-08-16 실측에서 여정 1호 B02(세트·예비
 * 수량 미반영)와 2호 C09(관찰 화면 HTTP 오류)가 그렇게 죽었다. 원인이 화면·계산처럼
 * 보여 한참 헤매게 되므로, 반복 주행하는 여정은 beforeAll 에서 이걸 부른다.
 * **로컬 e2e 계정만** 대상이다(운영 정책을 우회하지 않는다).
 */
export async function resetSupplierSearchQuota(mbIds: readonly string[]): Promise<void> {
  const kstDayKey = new Date(Date.now() + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  await getPrisma().spBomSupplierDailyUsage.updateMany({
    where: { mbId: { in: [...mbIds] }, dayKey: kstDayKey },
    data: { searchCount: 0 },
  });
}

export interface JourneyFinding {
  step: string;
  /** bug=제품 결함 후보 · ux=마찰 · obs=관찰 기록 · blocker=진행 불가 */
  kind: 'bug' | 'ux' | 'obs' | 'blocker';
  note: string;
}

export interface JourneySession {
  page: any;
  pageErrors: string[];
  mbId: string;
}

/**
 * 탐색 주행 기록기 — 발견·생성물 대장·HTTP 오류를 모아 output/journey/<file>.md 로 남긴다.
 * 실패로 세우는 대신 기록하고 완주를 잇는 것이 이 주행의 목적이라 리포트가 곧 산출물이다.
 */
export function createJourneyReport(fileName: string, title: string) {
  const findings: JourneyFinding[] = [];
  const ledger: string[] = [];
  const httpErrors: string[] = [];

  const F = (step: string, kind: JourneyFinding['kind'], note: string): void => {
    findings.push({ step, kind, note });
    console.log(`  [${kind}] ${step}: ${note}`);
  };

  const watchHttp = (s: { page: any }, label: string): void => {
    s.page.on('response', (res: any) => {
      const st: number = res.status();
      if (st >= 400) httpErrors.push(`${label} ${String(st)} ${res.url()}`);
    });
  };

  const shot = async (s: { page: any }, name: string): Promise<void> => {
    try {
      await snap(s.page, `journey/${name}`);
    } catch {
      /* 스크린샷 실패는 여정을 막지 않는다 */
    }
  };

  /**
   * 관찰용 화면 재로드 — 단계 대부분이 API 로 진행되므로 열어 둔 페이지는 저절로 바뀌지 않는다.
   * (재로드를 빠뜨리면 스크린샷이 첫 단계 시점에 멈춰 화면 검증이 사실상 사라진다.)
   */
  const view = async (s: { page: any }, path: string, name: string): Promise<void> => {
    try {
      await s.page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
      await s.page.waitForLoadState('networkidle').catch(() => undefined);
    } catch {
      /* 관찰 실패는 여정을 막지 않는다 */
    }
    await shot(s, name);
  };

  /**
   * 회귀 검증용 화면 이동 — 탐색용 view 와 달리 이동·필수 문구·스크린샷 중 하나라도
   * 실패하면 테스트를 세운다. API 전이 성공만으로 깨진 화면이 통과하지 못하게 한다.
   */
  const assertView = async (
    s: { page: any },
    path: string,
    name: string,
    requiredTexts: string[] = [],
  ): Promise<void> => {
    const response = await s.page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
    if (response !== null && response.status() >= 400) {
      throw new Error(`${path} 화면 이동 실패 — HTTP ${String(response.status())}`);
    }
    await s.page.locator('body').waitFor({ state: 'visible', timeout: 30_000 });
    for (const requiredText of requiredTexts) {
      try {
        await s.page.waitForFunction(
          (text: string) => document.body.innerText.includes(text),
          requiredText,
          { timeout: 30_000 },
        );
      } catch {
        await shot(s, `${name}-missing-text`);
        throw new Error(`${path} 화면 필수 문구 없음 — ${requiredText}`);
      }
    }
    await snap(s.page, `journey/${name}`);
  };

  // 리포트는 pageErrors 만 읽는다 — 고객(PhpLoginResult)·관리자/파트너(E2eSession)를 함께 받는다.
  const write = (sessions: Record<string, { pageErrors: string[] } | undefined>): string => {
    mkdirSync(join(outputDir, 'journey'), { recursive: true });
    const report = [
      `# ${title} (${new Date().toISOString()})`,
      '',
      '## 생성물 대장 (수동 정리 대상 — 재고 앵커 주의)',
      ...ledger.map((l) => `- ${l}`),
      '',
      '## 발견 사항',
      ...findings.map((f) => `- [${f.kind}] **${f.step}** — ${f.note}`),
      '',
      '## HTTP ≥400',
      ...(httpErrors.length === 0 ? ['- 없음'] : httpErrors.map((h) => `- ${h}`)),
      '',
      '## pageerror',
      ...Object.entries(sessions).map(
        ([label, s]) =>
          `- ${label}: ${s?.pageErrors.length ?? '?'}건 ${s?.pageErrors.join(' | ') ?? ''}`,
      ),
    ].join('\n');
    writeFileSync(join(outputDir, 'journey', `${fileName}.md`), report, 'utf8');
    console.log(`\n리포트: e2e/output/journey/${fileName}.md\n${report}`);
    return report;
  };

  return { findings, ledger, httpErrors, F, watchHttp, shot, view, assertView, write };
}

export type JourneyReport = ReturnType<typeof createJourneyReport>;

/**
 * 고객: 거버 뷰어에서 보드 업로드 → [견적요청] → 플랫폼 견적관리 도착까지.
 * dev 는 제출 직전 확인 오버레이가 뜨므로 [전송]을 눌러야 실제 POST 가 나간다.
 * 반환은 만들어진 sp_order_spec.id — 이후 단계가 전부 이 앵커를 쓴다.
 */
export async function submitGerberRfq(
  customer: JourneySession,
  rp: JourneyReport,
  opts: { fixtureZip: string; projectName: string; memo: string; prefix: string },
): Promise<number> {
  const page = customer.page;
  await page.goto(GERBER_URL, { waitUntil: 'domcontentloaded' });
  const input = page.locator('input[type=file]').first();
  await input.waitFor({ state: 'attached', timeout: 15_000 });
  await input.setInputFiles(opts.fixtureZip);
  await page.waitForFunction(
    () =>
      /공급가격/.test(document.body.innerText) &&
      /\d{1,3}(,\d{3})+원/.test(document.body.innerText),
    undefined,
    { timeout: 60_000 },
  );
  await rp.shot(customer, `${opts.prefix}-gerber-priced`);

  await page.getByText('견적요청', { exact: false }).last().click();
  await page.locator('textarea').first().fill(opts.memo);
  await page.getByText('확인', { exact: true }).click();
  await page.getByText('[개발] 전송 내용 확인').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: '전송' }).click();
  await page.waitForURL('**/shop/quotes*', { timeout: 60_000 });

  const prisma = getPrisma();
  const spec = await prisma.spOrderSpec.findFirst({
    where: { mbId: customer.mbId, projectName: opts.projectName },
    orderBy: { id: 'desc' },
  });
  if (spec === null) throw new Error('거버 제출 후 sp_order_spec 이 생성되지 않았습니다');
  await rp.shot(customer, `${opts.prefix}-quotes-rfq-wait`);

  // 방금 만든 행이 곧 rfq 행이다 — 카드 우측 열에 긴 문장이 들어가면 사양 열이 0 폭으로
  // 밀려 글자가 세로로 쪼개진다(2026-08-10 실측, §9). 사람 눈이 아니라 주행이 잡게 한다.
  const collapsed = await measureQuotesRowWidths(page);
  if (collapsed.length > 0) {
    rp.F(
      opts.prefix,
      'bug',
      `견적관리 사양 열 붕괴 ${String(collapsed.length)}행 — 우측 열의 긴 줄이 폭을 다 가져갔다: ${JSON.stringify(collapsed)}`,
    );
  }
  return Number(spec.id);
}

/**
 * 견적관리 목록의 **사양 열 폭**을 잰다 — 0 인 행(= 우측 가격 열이 폭을 다 먹어 사양이
 * 한 글자씩 세로로 쪼개진 상태)만 돌려준다. 여정 공용 가드이자 여정 1호의 어서션 근거.
 */
export async function measureQuotesRowWidths(
  page: any,
): Promise<{ i: number; infoW: number; calcW: number }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('li.sp-quotes__item')]
      .map((c, i) => ({
        i,
        infoW: (c.querySelector('.sp-cart-info') as HTMLElement | null)?.offsetWidth ?? -1,
        calcW: (c.querySelector('.sp-cart-calc') as HTMLElement | null)?.offsetWidth ?? -1,
      }))
      .filter((r) => r.infoW === 0),
  );
}

/**
 * Case 상세 **발주 표의 첫 열(협력사) 폭**을 잰다 — 위 견적관리 가드의 미러.
 * 같은 병(옆 칸의 긴 문자열이 폭을 다 가져가 이름 칸이 0폭으로 붕괴)이 여기서도 났다:
 * 결제조건 '50% PRE-PAID / 50% BEFORE SHIPMENT' 가 협력사 이름을 한 글자씩 세로로 눕혔다
 * (여정 8호 재점검 확정 #2). 표는 헤더의 '조건/송금' 으로 찾는다(그 화면에서 유일).
 * 반환: 측정된 모든 행(붕괴 판정은 호출부가 partnerW>0 으로).
 */
export async function measurePoRowPartnerWidths(
  page: any,
): Promise<{ i: number; partnerW: number; text: string }[]> {
  return page.evaluate(() => {
    const table = [...document.querySelectorAll('table')].find((t) =>
      (t.querySelector('thead')?.textContent ?? '').includes('조건/송금'),
    );
    if (table === undefined) return [];
    return [...(table.querySelector('tbody')?.rows ?? [])]
      .map((tr, i) => {
        const cell = tr.cells[0] as HTMLElement | undefined;
        return {
          i,
          partnerW: cell?.offsetWidth ?? -1,
          text: (cell?.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
        };
      })
      .filter((r) => r.text !== '');
  });
}

/**
 * 고객: 견적관리에서 해당 견적 체크 → [바로 주문] → 주문서 작성 → 무통장 주문 완료.
 * 배송지·결제수단·입금계좌는 theme/sp-lite/js/orderform-defaults.js 가 채워 두는 값이라
 * **채웠는지 확인만** 한다 — 비어 있으면 findings 에 bug 로 남아 기본값 회귀가 드러난다.
 *
 * `alsoSpecIds` 는 **한 주문서에 여러 줄**을 만드는 축이다(여정 10호 신설). 견적관리의
 * [바로 주문]은 체크된 견적을 모두 담고 한 번에 ct_select 하므로(quotes.php — POST
 * /api/pcb-projects/order 에 ids 배열), 체크만 늘리면 단일 od 에 카트 n 줄이 선다.
 * 주문서를 채우는 손놀림은 갈라지지 않아야 하므로 그 부분은 그대로 공유한다.
 */
export async function placeOrderFromQuotes(
  customer: JourneySession,
  rp: JourneyReport,
  opts: {
    specId: number;
    step: string;
    prefix: string;
    buyerName: string;
    /** 함께 체크할 추가 견적 — 지정하면 한 주문서에 여러 줄이 선다. */
    alsoSpecIds?: number[];
  },
): Promise<{ odId: string; status: string }> {
  const { page } = customer;
  const { step } = opts;
  const previousOdId = (await findLatestOrder(customer.mbId))?.odId ?? null;
  await page.goto(`${BASE_URL}/shop/quotes`, { waitUntil: 'domcontentloaded' });
  const label = page.locator(`label[for="sp-quotes-check-${String(opts.specId)}"]`);
  await label
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => rp.F(step, 'obs', '견적관리 목록 로딩 대기 시간 초과 — 캡처가 비어 있을 수 있음'));
  await rp.shot(customer, `${opts.prefix}-quotes-priced`);

  try {
    if ((await label.count()) > 0) {
      await label.click();
    } else {
      rp.F(
        step,
        'obs',
        `견적 체크 라벨(#${String(opts.specId)}) 미발견 — 첫 항목 강제 체크로 폴백`,
      );
      await page.locator('input.sp-quotes__check').first().check({ force: true });
    }
    for (const extra of opts.alsoSpecIds ?? []) {
      const more = page.locator(`label[for="sp-quotes-check-${String(extra)}"]`);
      if ((await more.count()) === 0) {
        rp.F(step, 'blocker', `동반 견적 체크 라벨(#${String(extra)}) 미발견 — 다중 줄 주문 불가`);
        throw new Error(`견적 #${String(extra)} 체크 라벨을 찾지 못했습니다`);
      }
      await more.click();
    }
    await page.locator('.js-sp-quotes-direct:visible').first().click();
    await page.waitForURL('**/shop/orderform*', { timeout: 30_000 });
  } catch (e) {
    rp.F(
      step,
      'blocker',
      `견적관리→주문서 진입 실패: ${e instanceof Error ? e.message : String(e)}`,
    );
    await rp.shot(customer, `${opts.prefix}-quotes-order-fail`);
    throw e;
  }
  await rp.shot(customer, `${opts.prefix}-orderform-top`);

  return completeBankTransferOrder(customer, rp, {
    step,
    prefix: opts.prefix,
    buyerName: opts.buyerName,
    previousOdId,
  });
}

/**
 * 고객: Smart BOM 상세의 확정 견적에서 [주문하기] → 영카트 주문서 진입.
 * 이후 폼 조작은 PCB 여정과 같은 함수로 합쳐 두 트랙이 실제 결제 기본값을 함께 검증한다.
 */
export async function placeOrderFromBomQuote(
  customer: JourneySession,
  rp: JourneyReport,
  opts: {
    quoteId: string;
    step: string;
    prefix: string;
    buyerName: string;
    expectedOrderAmount?: number;
    expectedAppliedSetQty?: number;
  },
): Promise<{ odId: string; status: string }> {
  const { page } = customer;
  const previousOdId = (await findLatestOrder(customer.mbId))?.odId ?? null;
  await page.goto(`${BASE_URL}/app/bom/${opts.quoteId}`, { waitUntil: 'domcontentloaded' });
  const orderButton = page.getByRole('button', { name: /^(?:다시 )?주문하기/ }).first();
  await orderButton.waitFor({ state: 'visible', timeout: 30_000 });
  await rp.shot(customer, `${opts.prefix}-bom-answered`);

  try {
    await orderButton.click();
    await page.waitForURL('**/shop/orderform*', { timeout: 30_000 });
  } catch (e) {
    rp.F(
      opts.step,
      'blocker',
      `BOM 상세→주문서 진입 실패: ${e instanceof Error ? e.message : String(e)}`,
    );
    await rp.shot(customer, `${opts.prefix}-bom-order-fail`);
    throw e;
  }

  if (opts.expectedOrderAmount !== undefined || opts.expectedAppliedSetQty !== undefined) {
    const bomRow = page.locator('#sod_list tbody tr').filter({ hasText: '부품 BOM 주문' }).first();
    await bomRow.waitFor({ state: 'visible', timeout: 15_000 });
    const cells = bomRow.locator('td');
    if (opts.expectedOrderAmount !== undefined) {
      const salePrice = Number((await cells.nth(2).innerText()).replace(/[^0-9-]/g, ''));
      const subtotal = Number((await cells.nth(3).innerText()).replace(/[^0-9-]/g, ''));
      if (salePrice !== opts.expectedOrderAmount || subtotal !== opts.expectedOrderAmount) {
        throw new Error(
          `BOM 주문서 금액 불일치 — 판매가 ${String(salePrice)}, 소계 ${String(subtotal)}, 기대 ${String(opts.expectedOrderAmount)}`,
        );
      }
    }
    if (opts.expectedAppliedSetQty !== undefined) {
      const qtyText = await cells.nth(1).innerText();
      if (!qtyText.includes(`적용 ${String(opts.expectedAppliedSetQty)}세트`)) {
        throw new Error(
          `BOM 주문서 적용 수량 불일치 — 표시 "${qtyText}", 기대 ${String(opts.expectedAppliedSetQty)}세트`,
        );
      }
    }
  }
  await rp.shot(customer, `${opts.prefix}-orderform-top`);

  return completeBankTransferOrder(customer, rp, {
    step: opts.step,
    prefix: opts.prefix,
    buyerName: opts.buyerName,
    previousOdId,
  });
}

/**
 * 고객: 통합 견적관리에서 확정 Smart BOM 여러 건을 선택해 한 영카트 주문으로 만든다.
 * 부분취소 여정처럼 주문:Case=1:N 자체가 검증 대상일 때 단건 상세 헬퍼 대신 사용한다.
 */
export async function placeBatchOrderFromBomQuotes(
  customer: JourneySession,
  rp: JourneyReport,
  opts: {
    quotes: {
      quoteId: string;
      title: string;
      expectedOrderAmount: number;
      expectedAppliedSetQty: number;
    }[];
    step: string;
    prefix: string;
    buyerName: string;
  },
): Promise<{ odId: string; status: string }> {
  const { page } = customer;
  const previousOdId = (await findLatestOrder(customer.mbId))?.odId ?? null;
  if (opts.quotes.length < 2) throw new Error('BOM 배치 주문은 견적 2건 이상이 필요합니다');

  await page.goto(`${BASE_URL}/shop/quotes#bom`, { waitUntil: 'domcontentloaded' });
  for (const quote of opts.quotes) {
    const checkbox = page.locator(`#sp-bom-check-${quote.quoteId}`);
    await checkbox.waitFor({ state: 'attached', timeout: 30_000 });
    if (await checkbox.isDisabled()) {
      throw new Error(`BOM 견적 #${quote.quoteId}가 배치 주문 가능 상태가 아닙니다`);
    }
    await checkbox.check({ force: true });
  }
  await page.waitForFunction(
    (count: number) => document.querySelector('#sp-quotes-count')?.textContent?.includes(`${String(count)}건`) === true,
    opts.quotes.length,
    { timeout: 10_000 },
  );
  await rp.shot(customer, `${opts.prefix}-quotes-selected`);

  await page.locator('.js-sp-quotes-direct:visible').first().click();
  await page.waitForURL('**/shop/orderform*', { timeout: 30_000 });
  for (const quote of opts.quotes) {
    const row = page.locator('#sod_list tbody tr').filter({ hasText: quote.title }).first();
    await row.waitFor({ state: 'visible', timeout: 15_000 });
    const cells = row.locator('td');
    const salePrice = Number((await cells.nth(2).innerText()).replace(/[^0-9-]/g, ''));
    const subtotal = Number((await cells.nth(3).innerText()).replace(/[^0-9-]/g, ''));
    if (salePrice !== quote.expectedOrderAmount || subtotal !== quote.expectedOrderAmount) {
      throw new Error(
        `BOM #${quote.quoteId} 주문서 금액 불일치 — 판매가 ${String(salePrice)}, 소계 ${String(subtotal)}, 기대 ${String(quote.expectedOrderAmount)}`,
      );
    }
    const qtyText = await cells.nth(1).innerText();
    if (!qtyText.includes(`적용 ${String(quote.expectedAppliedSetQty)}세트`)) {
      throw new Error(
        `BOM #${quote.quoteId} 주문서 적용 수량 불일치 — 표시 "${qtyText}", 기대 ${String(quote.expectedAppliedSetQty)}세트`,
      );
    }
  }
  await rp.shot(customer, `${opts.prefix}-orderform-top`);

  return completeBankTransferOrder(customer, rp, {
    step: opts.step,
    prefix: opts.prefix,
    buyerName: opts.buyerName,
    previousOdId,
  });
}

/** 주문서 진입 이후의 공통 무통장 주문 조작. */
async function completeBankTransferOrder(
  customer: JourneySession,
  rp: JourneyReport,
  opts: {
    step: string;
    prefix: string;
    buyerName: string;
    previousOdId: string | null;
  },
): Promise<{ odId: string; status: string }> {
  const { page } = customer;
  const { step } = opts;

  const fill = async (sel: string, v: string): Promise<void> => {
    const loc = page.locator(sel).first();
    if ((await loc.count()) === 0) {
      rp.F(step, 'obs', `주문서 필드 없음: ${sel}`);
      return;
    }
    await loc.fill(v).catch(async () => {
      await page.evaluate(
        ([s, val]: [string, string]) => {
          const el = document.querySelector(s) as HTMLInputElement | null;
          if (el) el.value = val;
        },
        [sel, v],
      );
    });
  };
  await fill('input[name="od_name"]', opts.buyerName);
  await fill('input[name="od_tel"]', '02-000-0000');
  await fill('input[name="od_hp"]', '010-0000-0000');
  await fill('input[name="od_zip"]', '06236');
  await fill('input[name="od_addr1"]', '서울 강남구 테헤란로 1');
  await fill('input[name="od_addr2"]', 'e2e');

  // '주문자와 동일'이 걸려 있으면 주문자 입력을 따라 받는분이 채워진다(디바운스 300ms).
  await page.waitForTimeout(600);
  const receiverName = page.locator('input[name="od_b_name"]');
  if ((await receiverName.inputValue().catch(() => '')) === '') {
    rp.F(step, 'bug', '받는분 기본값 미적용 — [주문자와 동일]을 수동 클릭해 진행');
    await page
      .getByText('주문자와 동일', { exact: true })
      .first()
      .click()
      .catch(() => undefined);
    await fill('input[name="od_b_name"]', opts.buyerName);
    await fill('input[name="od_b_hp"]', '010-0000-0000');
  }

  const bankRadio = page.locator('input[name="od_settle_case"][value*="무통장"]');
  if ((await bankRadio.count()) > 0 && !(await bankRadio.first().isChecked())) {
    rp.F(step, 'bug', '결제수단 기본값 미적용 — 무통장입금을 수동 선택해 진행');
    await bankRadio
      .first()
      .check({ force: true })
      .catch(() => undefined);
  }

  const bankSelect = page.locator('select[name="od_bank_account"]');
  if ((await bankSelect.count()) > 0) {
    const picked = await bankSelect
      .first()
      .inputValue()
      .catch(() => '');
    if (picked === '') {
      rp.F(step, 'bug', '입금 계좌 기본값 미적용 — 첫 계좌를 수동 선택해 진행');
      await bankSelect
        .first()
        .selectOption({ index: 0 })
        .catch(() => undefined);
    }
  }
  // 입금자명은 코어 click 핸들러가 주문자명으로 채운다 — 여정 표식이 필요해 덮어쓴다.
  await fill('input[name="od_deposit_name"]', opts.buyerName);
  for (const cb of await page.locator('input[type=checkbox][name*="agree"]').all()) {
    await cb.check().catch(() => undefined);
  }
  page.on('dialog', (d: any) => {
    rp.F(step, 'obs', `dialog: ${d.type()} — ${d.message()}`);
    void d.accept();
  });
  await rp.shot(customer, `${opts.prefix}-orderform-filled`);

  await page
    .getByText(/주문하기|결제하기/)
    .last()
    .click();
  await page.waitForLoadState('domcontentloaded');
  let order = null as Awaited<ReturnType<typeof findLatestOrder>>;
  for (let i = 0; i < 10 && order === null; i += 1) {
    await page.waitForTimeout(1000);
    const latest = await findLatestOrder(customer.mbId);
    if (latest !== null && latest.odId !== opts.previousOdId) order = latest;
  }
  await rp.shot(customer, `${opts.prefix}-order-done`);
  if (order === null) {
    throw new Error('새 주문이 생성되지 않았습니다(주문서 제출이 막혔거나 기존 주문만 조회됨)');
  }
  return order;
}
