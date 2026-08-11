// 여정 43호 — **고객이 보는 것**(주문 뒤 고객 화면에 무엇이 있고, 무엇이 없어야 하는가).
//
// 9호는 **협력사끼리의** 정보 격리를 봤다("한 박스 두 주인"). 이 편은 그 아래층 —
// **고객에게 공급망이 새는가**다. 우리 사업 구조상 고객은 자기 보드를 누가 만드는지 몰라도
// 되고, 알면 다음에는 그쪽으로 직접 간다. 발주가·환율이 새면 마진이 그대로 드러난다.
//
// 반대 방향도 본다: 고객이 **알아야 할 것은 보이는가**. 결제만 하고 그 뒤로 아무것도
// 안 보이면 "돈만 내고 깜깜한" 상태가 된다(P4.13 이 '제작 진행 상황'을 넣은 이유다).
//
// 표적:
//   ① **없어야 할 것** — 협력사명·발주가·환율·협력사 담당자 연락처
//   ② **있어야 할 것** — 진행 단계가 실제 발주 상태와 어긋나지 않는다
//
// **쓰기가 없다**(read-only) — 이 회원의 실주문 중 발주가 달린 건을 찾아 연다.
//
// 실행: pnpm -F e2e journey:customerview  (PORTAL_E2E=1 + JOURNEY=1 — 거버 불필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPrisma,
  newPhpSession,
  requireCustomerCreds,
  type PhpLoginResult,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';

describe.skipIf(!RUN || !JOURNEY)('여정 43호 — 고객이 보는 것', () => {
  const rp = createJourneyReport('findings-customer-view', '여정 43호 고객 화면 탐색 주행 리포트');
  const { F } = rp;

  let customer: PhpLoginResult;
  /** 발주가 달린 이 회원의 주문 — 공급망이 실제로 붙어 있는 건이라야 검사가 성립한다. */
  let target: { odId: string; poId: bigint; partnerName: string; price: string; status: string } | null =
    null;

  const mustReach = async (url: string, hint: string): Promise<void> => {
    try {
      const res = await fetch(url);
      if (res.status >= 500) throw new Error(`HTTP ${String(res.status)}`);
    } catch (e) {
      throw new Error(`${url} 도달 실패 — ${hint} (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    const creds = requireCustomerCreds();
    customer = await newPhpSession(creds);
    rp.watchHttp(customer, '고객');

    // 이 회원의 스펙 중 발주가 달린 것 하나 — 협력사명·발주가가 붙어 있어야 "새는지"를 볼 수 있다.
    const prisma = getPrisma();
    const specs = await prisma.spOrderSpec.findMany({
      where: { mbId: creds.id, ctId: { not: null } },
      orderBy: { id: 'desc' },
      take: 60,
      select: { id: true, ctId: true },
    });
    for (const s of specs) {
      const po = await prisma.spPcbPo.findFirst({
        where: { specId: s.id },
        include: { partner: { select: { name: true } } },
        orderBy: { id: 'desc' },
      });
      if (po === null) continue;
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT od_id FROM g5_shop_cart WHERE ct_id = ?`,
        s.ctId,
      );
      const odId = String(rows[0]?.od_id ?? '');
      if (odId === '') continue;
      target = {
        odId,
        poId: po.id,
        partnerName: po.partner.name,
        price: String(po.priceOriginal),
        status: po.status,
      };
      break;
    }
  }, 180_000);

  afterAll(async () => {
    rp.write({ 고객: customer });
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('B1. 주문내역 목록 — 공급망 낱말이 섞이는가', async (ctx) => {
    if (target === null) return ctx.skip();
    await rp.view(customer, '/shop/orderinquiry.php', 'B01-list');
    const text = await customer.page.evaluate(() => document.body.innerText).catch(() => '');
    await rp.shot(customer, 'B01-list');
    // 협력사명이 목록에 뜨면 고객은 클릭도 하기 전에 공급처를 안다.
    expect(text.includes(target.partnerName), '목록에 협력사명 없음').toBe(false);
    F(
      'B1',
      'obs',
      `주문내역 목록 실측 — 본문 ${String(text.replace(/\s+/g, ' ').trim().length)}자 · ` +
        `협력사명('${target.partnerName}') 미노출`,
    );
  }, 300_000);

  test('B2. 주문 상세 — 협력사명·발주가·환율이 새지 않는가', async (ctx) => {
    if (target === null) return ctx.skip();
    await rp.view(
      customer,
      `/shop/orderinquiryview.php?od_id=${target.odId}`,
      'B02-detail',
    );
    await customer.page.waitForTimeout(1_200);
    const text = await customer.page.evaluate(() => document.body.innerText).catch(() => '');
    const html = await customer.page.content();
    await rp.shot(customer, 'B02-detail');

    const leaks: string[] = [];
    // ⚠ 화면 텍스트만 보면 안 된다 — DOM 속성·JSON 에 실려 오면 개발자 도구로 바로 보인다.
    if (text.includes(target.partnerName) || html.includes(target.partnerName)) {
      leaks.push(`협력사명('${target.partnerName}')`);
    }
    // 발주가는 고객 결제금액과 다른 숫자다(마진이 그대로 드러난다). 소수점·통화 표기가
    // 제각각이라 정수부만으로 본다.
    const priceHead = String(Math.trunc(Number(target.price)));
    if (priceHead.length >= 3 && (text.includes(priceHead) || html.includes(`"${priceHead}`))) {
      leaks.push(`발주가(${priceHead})`);
    }
    F(
      leaks.length === 0 ? 'B2' : 'B2',
      leaks.length === 0 ? 'obs' : 'bug',
      leaks.length === 0
        ? `주문 상세 실측 — 협력사명·발주가 모두 미노출(텍스트·DOM 양쪽 확인). 고객은 ` +
          `자기 주문 정보만 본다.`
        : `**고객 화면에 공급망이 샌다** — ${leaks.join(' · ')}. 고객이 공급처를 알면 다음에는 ` +
          `그쪽으로 직접 간다.`,
    );
  }, 300_000);

  test('B3. 알아야 할 것은 보이는가 — 제작 진행 상황', async (ctx) => {
    if (target === null) return ctx.skip();
    const text = await customer.page.evaluate(() => document.body.innerText).catch(() => '');
    // P4.13 이 넣은 '제작 진행 상황'(od 무접촉 · sp 파생). 결제 뒤 아무것도 안 보이면
    // 고객은 "돈만 내고 깜깜한" 상태가 된다.
    const stageWords = ['제작', '진행', '생산', '준비', '발송', '배송'].filter((w) =>
      text.includes(w),
    );
    F(
      'B3',
      stageWords.length === 0 ? 'bug' : 'obs',
      stageWords.length === 0
        ? `**주문 상세에 진행 상태를 말하는 낱말이 하나도 없다** — 결제 뒤 고객이 볼 것이 없다.`
        : `진행 표시 실측 — 상태 낱말 ${stageWords.join('/')} 노출 · 실제 발주 상태는 ` +
          `'${target.status}'(po #${String(target.poId)})`,
    );
  }, 300_000);
});
