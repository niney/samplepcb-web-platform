// 고객 "제조 확인" 진입점 — 마이페이지 사이드바 메뉴 + /shop/eq 목록 (D16 보완)
//
// 무엇을 지키는가:
//   ① 주문을 가로지르는 내 확인 요청 API(GET /api/pcb-eq-reviews/mine) — 모수·소유권·주문번호
//   ② 사이드바 배지(대기 건수)가 **모든 계정 페이지**에서 같은 수로 보인다(DB 직접 count)
//   ③ 목록에는 결정 폼이 없다 — 행은 주문 상세 딥링크(#eq-{id})로만 보낸다(폼 복제 금지)
//   ④ 좁은 화면에서도 가로로 터지지 않는다(긴 프로젝트명 — 여정 36·39호 유형)
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run customer-eq-menu
// 사전: nginx · API(3333) · 웹(5173) · e2e/.env.e2e 고객 자격
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  cleanupPcbPos,
  closeBrowser,
  disconnectPrisma,
  getPartner,
  getPrisma,
  newPhpSession,
  num,
  requireCustomerCreds,
  signJwt,
  snap,
  type PartnerFixture,
  type PhpLoginResult,
} from '../helpers';

const LONG_NAME = `EQMENU-${'아주긴프로젝트이름'.repeat(6)}-board.zip`;

describe.skipIf(!RUN)('고객 제조 확인 진입점 — 사이드바 + /shop/eq', () => {
  let customer: PhpLoginResult;
  let partner: PartnerFixture;
  let A = '';
  let C = ''; // 고객 토큰(내 것만 보이는지)
  let O = ''; // 남의 토큰(격리 확인)
  const poIds: bigint[] = [];
  /** 이름을 바꾼 spec 의 **원래 이름**까지 들고 있어야 정리가 원상복구다(고정 문자열로
   *  되돌리면 남의 견적 이름을 덮어쓴다 — 실데이터 위에서 도는 스펙의 규율). */
  const renamed: { id: bigint; projectName: string }[] = [];
  let openReviewId = 0;
  let openOdId = '';

  /** 이 고객이 **주문까지 한** 견적 중 발주서가 없는 것을 고른다.
   *  ⚠ 공용 pickFreeSpecs 는 PO 유무만 봐서 ctId 가 빈 순수 견적까지 집는다 — 그러면
   *  주문번호가 없어 딥링크 축을 검증할 수 없다(시드 함정 메모, 여정 재점검). */
  const pickOrderedSpecs = async (mbId: string, count: number): Promise<any[]> => {
    const prisma = getPrisma();
    const used = (await prisma.spPcbPo.findMany({ select: { specId: true } })).map(
      (r: any) => r.specId,
    );
    const specs = await prisma.spOrderSpec.findMany({
      where: { mbId, status: 'active', ctId: { not: null }, id: { notIn: used } },
      orderBy: { id: 'desc' },
      take: count,
    });
    if (specs.length < count) throw new Error(`주문된 여유 스펙 부족: ${String(specs.length)}/${String(count)}`);
    return specs;
  };

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    const creds = requireCustomerCreds();
    partner = await getPartner('tester2협력');
    A = signJwt({ mbId: 'e2e-admin', isAdmin: true });
    C = signJwt({ mbId: creds.id, ttlSec: 3600 });
    O = signJwt({ mbId: 'e2e-mdsub1', ttlSec: 3600 }); // 남 — 이 요청들의 주인이 아니다
    customer = await newPhpSession(creds);
  }, 180_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (poIds.length > 0) {
      await prisma.spPcbEqReview.deleteMany({ where: { poId: { in: poIds } } });
      await cleanupPcbPos(poIds);
    }
    for (const s of renamed) {
      await prisma.spOrderSpec.update({
        where: { id: s.id },
        data: { projectName: s.projectName },
      });
    }
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('E1. 시드 — 확인 대기 1건 + 이력(승인) 1건', async () => {
    const prisma = getPrisma();
    const specs = await pickOrderedSpecs(customer.mbId, 2);
    for (const [i, spec] of specs.entries()) {
      // 첫 건만 이름을 길게 — 좁은 화면 붕괴 회귀(E5)를 실데이터로 태운다.
      if (i === 0) {
        renamed.push({ id: spec.id, projectName: String(spec.projectName) });
        await prisma.spOrderSpec.update({ where: { id: spec.id }, data: { projectName: LONG_NAME } });
      }
      const po = await prisma.spPcbPo.create({
        data: {
          specId: spec.id,
          partnerId: partner.id,
          parentPartnerId: 0n,
          reorderRound: 0,
          status: 'eq_requested', // 확인 요청 생성 가드(NOT_EQ_REQUESTED)를 통과하는 유일한 칸
          currency: 'KRW',
          priceOriginal: 100000,
          eqHistory: [],
        },
      });
      poIds.push(po.id);
      // 요청 생성은 **실 관리자 경로**로 — 스키마·소유권·가드를 함께 태운다.
      const created = await api(A, 'POST', `/api/admin/pcb-eq-reviews/${String(po.id)}`, {
        message: `[E2E] 확인 부탁드립니다 #${String(i)}`,
        sharedFileIds: [],
      });
      expect(created.status, JSON.stringify(created.json)).toBe(200);
      // 응답은 그 발주서의 요청 **목록**(최신 우선) — 방금 만든 건이 맨 앞이다.
      const reviewId = num(created.json?.data?.reviews?.[0]?.id);
      if (i === 0) {
        openReviewId = reviewId;
        const cart: any[] = await prisma.$queryRawUnsafe(
          `SELECT od_id FROM g5_shop_cart WHERE ct_id = ?`,
          spec.ctId,
        );
        openOdId = String(cart[0]?.od_id ?? '');
      } else {
        // 둘째 건은 고객이 이미 답한 이력으로 — scope 분리를 검증할 모수.
        const decided = await api(C, 'POST', `/api/pcb-eq-reviews/${String(reviewId)}/decide`, {
          decision: 'approve',
        });
        expect(decided.status, JSON.stringify(decided.json)).toBe(200);
      }
    }
    expect(openReviewId, '대기 요청 id').toBeGreaterThan(0);
    expect(openOdId, '대기 요청의 주문번호').not.toBe('');
  }, 120_000);

  test('E2. 기본 모수는 확인 대기만 — 주문번호가 붙는다', async () => {
    const r = await api(C, 'GET', '/api/pcb-eq-reviews/mine');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const rows: any[] = r.json?.data?.reviews ?? [];
    expect(rows.every((v) => v.status === 'requested'), '대기 아닌 행 섞임').toBe(true);
    const row = rows.find((v) => v.id === openReviewId);
    expect(row, '대기 요청이 목록에 없음').toBeTruthy();
    expect(row.odId, '딥링크용 주문번호').toBe(openOdId);
    expect(row.projectName, '프로젝트명').toBe(LONG_NAME);
    expect(Number(r.json?.data?.openCount ?? 0), 'openCount').toBeGreaterThanOrEqual(1);
    // 이력(승인함)은 기본 모수에서 빠진다.
    expect(rows.some((v) => v.status === 'approved'), '이력이 대기 모수에 섞임').toBe(false);
  });

  test('E3. scope=all 이면 이력까지 — openCount 는 그대로 열린 것만', async () => {
    const r = await api(C, 'GET', '/api/pcb-eq-reviews/mine?scope=all');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const rows: any[] = r.json?.data?.reviews ?? [];
    expect(rows.some((v) => v.id === openReviewId), '대기 건').toBe(true);
    expect(rows.some((v) => v.status === 'approved'), '승인 이력').toBe(true);
    const open = rows.filter((v) => v.status === 'requested').length;
    expect(Number(r.json?.data?.openCount ?? -1), 'openCount 는 scope 와 무관').toBe(open);
  });

  test('E4. 남의 확인 요청은 목록에 없다', async () => {
    const r = await api(O, 'GET', '/api/pcb-eq-reviews/mine?scope=all');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const rows: any[] = r.json?.data?.reviews ?? [];
    expect(rows.some((v) => v.id === openReviewId), '남의 요청 노출').toBe(false);
  });

  test('E5. 화면 — 사이드바 배지·목록 행·딥링크, 좁은 폭에서도 안 터진다', async () => {
    const { page } = customer;
    await page.goto(`${BASE_URL}/shop/eq`, { waitUntil: 'networkidle' });
    await snap(page, 'eq-menu/list-pc');

    // 메뉴가 '확인 요청 > 제조 확인' 2단으로 서고, 현재 페이지로 활성 표시된다.
    const nav = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.smb_nav .nav_group')].map((g) => ({
        label: g.querySelector('.nav_glabel')?.textContent?.trim() ?? '',
        items: [...g.querySelectorAll('a')].map((a) => ({
          text: a.querySelector('.lbl')?.textContent?.trim() ?? '',
          badge: a.querySelector('.nav_badge')?.textContent?.trim() ?? '',
          current: a.getAttribute('aria-current') === 'page',
          href: a.getAttribute('href') ?? '',
        })),
      }));
      return groups;
    });
    const group = nav.find((g) => g.label === '확인 요청');
    expect(group, '확인 요청 그룹').toBeTruthy();
    const item = group?.items.find((i) => i.text === '제조 확인');
    expect(item, '제조 확인 항목').toBeTruthy();
    expect(item?.current, '현재 페이지 활성 표시').toBe(true);
    expect(Number(item?.badge ?? 0), '대기 배지').toBeGreaterThanOrEqual(1);
    // 화면에 'EQ' 라는 말이 없다 — 스텐실 트랙과 공용이라 중립어만 쓴다.
    expect(item?.text.includes('EQ'), '메뉴에 EQ 노출').toBe(false);

    // 목록 행: 결정 폼이 없고, 주문 상세 딥링크로 보낸다.
    const list = await page.evaluate((rid: number) => {
      const items = [...document.querySelectorAll('.sp-eqm__item')];
      const target = items.find((li) =>
        (li.querySelector('.sp-eqm__go') as HTMLAnchorElement | null)?.href.includes(`#eq-${String(rid)}`),
      );
      return {
        count: items.length,
        hasDecisionForm: document.querySelectorAll('.sp-eqm form, .sp_eq_approve, .sp_eq_reject').length,
        href: (target?.querySelector('.sp-eqm__go') as HTMLAnchorElement | null)?.href ?? '',
        goText: target?.querySelector('.sp-eqm__go')?.textContent?.trim() ?? '',
      };
    }, openReviewId);
    expect(list.count, '목록 행 수').toBeGreaterThanOrEqual(1);
    expect(list.hasDecisionForm, '목록에 결정 폼이 있으면 안 된다').toBe(0);
    expect(list.href, '주문 상세 딥링크').toContain(`orderinquiryview.php?od_id=${openOdId}#eq-${String(openReviewId)}`);
    expect(list.goText, '대기 행 문구').toBe('확인하고 회신하기');

    // 좁은 폭 — 긴 프로젝트명이 페이지를 가로로 터뜨리지 않는다.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(200);
    const narrow = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      docWidth: document.documentElement.scrollWidth,
    }));
    expect(narrow.overflow, `가로 스크롤 발생(${String(narrow.docWidth)}px)`).toBe(false);
    await page.setViewportSize({ width: 1440, height: 900 });

    // 딥링크가 실제로 결정 폼에 닿는다 — 목록과 상세의 접합.
    await page.goto(list.href, { waitUntil: 'networkidle' });
    const anchored = await page.evaluate(
      (rid: number) => document.querySelector(`#eq-${String(rid)} .sp_eq_approve`) !== null,
      openReviewId,
    );
    expect(anchored, '딥링크 지점에 승인 버튼').toBe(true);
  }, 120_000);

  test('E6. 배지는 다른 계정 페이지에서도 같은 수', async () => {
    const { page } = customer;
    const read = async (url: string): Promise<number> => {
      await page.goto(url, { waitUntil: 'networkidle' });
      return page.evaluate(() => {
        const link = [...document.querySelectorAll('.smb_nav a')].find(
          (a) => a.querySelector('.lbl')?.textContent?.trim() === '제조 확인',
        );
        return Number(link?.querySelector('.nav_badge')?.textContent?.trim() ?? 0);
      });
    };
    const onMypage = await read(`${BASE_URL}/shop/mypage.php`);
    const onOrders = await read(`${BASE_URL}/shop/orderinquiry.php`);
    expect(onMypage, '마이페이지 배지').toBeGreaterThanOrEqual(1);
    expect(onOrders, '주문내역 배지').toBe(onMypage);
  }, 120_000);
});
