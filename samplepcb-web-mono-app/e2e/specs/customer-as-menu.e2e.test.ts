// 고객 "A/S 접수" 진입점 — 마이페이지 사이드바 "문의 > A/S 접수" + /shop/as (P5 보완)
//
// 무엇을 지키는가:
//   ① 회원 전체를 가로지르는 내 A/S API 두 트랙(GET /api/pcb-claims/mine · /api/bom/claims/mine)
//      — 접수할 주문(배송 완료·스펙/견적 있음·진행 중 접수 없음)과 접수 내역이 서로 배타
//   ② 사이드바 배지 = PCB+BOM 진행 중 합산, **회색**(관리자 차례라 고객을 재촉하지 않는다)
//   ③ 페이지에 접수 폼이 없다 — 트랙 탭(PCB / 부품 BOM, '전체' 없음), 행은 딥링크로만
//   ④ 딥링크가 주문 상세의 해당 접수 행(#as-{id})에 닿는다 · 390px 가로 오버플로 0
//
// 시드: e2e-customer 의 **실 배송 완료 주문행**(PCB 스펙 5건·부품 BOM 견적 여러 건)에 고객
// 경로로 접수 1건씩 만든다 — 주문·스펙을 새로 세우지 않는다. 정리는 접수(+사진·메일 원장)만.
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run customer-as-menu
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  disconnectPrisma,
  getPrisma,
  newPhpSession,
  requireCustomerCreds,
  signJwt,
  snap,
  type PhpLoginResult,
} from '../helpers';

describe.skipIf(!RUN)('고객 A/S 접수 진입점 — 사이드바 + /shop/as', () => {
  let customer: PhpLoginResult;
  let C = '';
  let O = '';
  const startedAt = new Date();

  // 시드 결과 — 뒷 단계가 쓴다
  let pcbSpecId = '';
  let pcbOdId = '';
  let pcbClaimId = '';
  let bomQuoteId = '';
  let bomClaimId = '';
  let pcbOpenBefore = 0;
  let bomOpenBefore = 0;

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    const creds = requireCustomerCreds();
    C = signJwt({ mbId: creds.id, ttlSec: 3600 });
    O = signJwt({ mbId: 'e2e-mdsub1', ttlSec: 3600 });
    customer = await newPhpSession(creds);
  }, 180_000);

  afterAll(async () => {
    const prisma = getPrisma();
    if (pcbClaimId !== '') {
      await prisma.spFile.deleteMany({ where: { refType: 'sp_pcb_claim', refId: BigInt(pcbClaimId) } });
      await prisma.spPcbClaim.deleteMany({ where: { id: BigInt(pcbClaimId) } }); // events cascade
      await prisma.spMailLog.deleteMany({
        where: { refType: 'pcb_spec', refId: pcbSpecId, createdAt: { gte: startedAt } },
      });
    }
    if (bomClaimId !== '') {
      await prisma.spBomClaim.deleteMany({ where: { id: BigInt(bomClaimId) } }); // items·events cascade
    }
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('A1. 시드 — 접수할 주문에서 한 건씩 고객 경로로 접수(PCB 사진 동반 · 부품 BOM JSON)', async () => {
    // PCB — 접수할 주문의 첫 행이 곧 시드 표적이다(배송 완료·스펙·진행 중 접수 없음).
    const pcb0 = await api(C, 'GET', '/api/pcb-claims/mine');
    expect(pcb0.status, JSON.stringify(pcb0.json)).toBe(200);
    pcbOpenBefore = Number(pcb0.json?.data?.openCount ?? 0);
    const target = (pcb0.json?.data?.claimable ?? [])[0];
    expect(target, '접수할 PCB 주문이 없음 — e2e-customer 배송 완료 스펙 라인 확인').toBeTruthy();
    pcbSpecId = String(target.specId);
    pcbOdId = String(target.odId);

    const form = new FormData();
    form.set('specId', pcbSpecId);
    form.set('kind', 'damaged');
    form.set('affectedQty', '1');
    form.set('description', '[E2E] 마이페이지 A/S 접수 진입점 — 모서리 파손 1장');
    form.set('requestedRemedy', 'consult');
    form.set('acknowledge', '1');
    form.set(
      'file0',
      new File([new TextEncoder().encode('%PDF-1.4\n%%EOF\n')], 'e2e-photo.pdf', {
        type: 'application/pdf',
      }),
    );
    const created = await fetch(`${API_URL}/api/pcb-claims`, {
      method: 'POST',
      headers: { authorization: `Bearer ${C}` },
      body: form,
    });
    const createdJson: any = await created.json();
    expect(created.status, JSON.stringify(createdJson)).toBe(200);
    pcbClaimId = String(createdJson?.data?.claim?.id ?? '');
    expect(pcbClaimId, 'PCB 접수 id').not.toBe('');

    // 부품 BOM — 같은 방식. 접수 본문은 견적의 활성 부품 1종.
    const bom0 = await api(C, 'GET', '/api/bom/claims/mine');
    expect(bom0.status, JSON.stringify(bom0.json)).toBe(200);
    bomOpenBefore = Number(bom0.json?.data?.openCount ?? 0);
    const bomTarget = (bom0.json?.data?.claimable ?? [])[0];
    expect(bomTarget, '접수할 부품 BOM 주문이 없음').toBeTruthy();
    bomQuoteId = String(bomTarget.quoteId);
    const prisma = getPrisma();
    const quote = await prisma.spBomQuote.findUnique({
      where: { id: BigInt(bomQuoteId) },
      include: { items: true, sheets: true },
    });
    // 시트 선택을 반영한 활성 부품 — lib filterActiveQuoteItems 와 같은 규칙(sheets 없으면 전부).
    const selected = new Set(
      (quote?.sheets ?? []).filter((s: any) => s.selected).map((s: any) => s.sheetIndex),
    );
    const item = (quote?.items ?? []).find(
      (it: any) =>
        it.included &&
        it.orderQty > 0 &&
        ((quote?.sheets ?? []).length === 0 || it.sourceSheetIndex === null || selected.has(it.sourceSheetIndex)),
    );
    expect(item, '접수할 활성 부품').toBeTruthy();
    const bomCreated = await api(C, 'POST', `/api/bom/quotes/${bomQuoteId}/claims`, {
      kind: 'damaged',
      subject: '[E2E] 마이페이지 A/S 접수 진입점',
      description: '[E2E] 부품 1종 포장 파손 — 마이페이지 목록 검증용 접수',
      items: [{ quoteItemId: String(item.id), affectedQty: 1 }],
      acknowledgeNoAutomaticRefund: true,
    });
    expect(bomCreated.status, JSON.stringify(bomCreated.json)).toBe(201);
    bomClaimId = String(bomCreated.json?.data?.id ?? '');
    expect(bomClaimId, '부품 접수 id').not.toBe('');
  }, 120_000);

  test('A2. PCB /mine — 접수한 건은 "접수할 주문"에서 빠지고 접수 내역에 선다', async () => {
    const r = await api(C, 'GET', '/api/pcb-claims/mine');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = r.json?.data ?? {};
    expect((d.claimable ?? []).some((v: any) => String(v.specId) === pcbSpecId), '접수한 스펙이 아직 접수할 주문에').toBe(false);
    const row = (d.claims ?? []).find((v: any) => String(v.id) === pcbClaimId);
    expect(row, '접수 내역에 없음').toBeTruthy();
    expect(row.status).toBe('open');
    expect(String(row.odId), '주문번호 박제').toBe(pcbOdId);
    expect(Number(d.openCount), 'openCount +1').toBe(pcbOpenBefore + 1);
    expect((d.claims ?? []).every((v: any) => v.status === 'open' || v.status === 'reviewing'), '기본 모수는 진행 중만').toBe(true);
    const all = await api(C, 'GET', '/api/pcb-claims/mine?scope=all');
    expect((all.json?.data?.claims ?? []).some((v: any) => String(v.id) === pcbClaimId)).toBe(true);
    expect(Number(all.json?.data?.openCount), 'openCount 는 scope 무관').toBe(pcbOpenBefore + 1);
  });

  test('A3. 부품 BOM /mine — 같은 배타 관계', async () => {
    const r = await api(C, 'GET', '/api/bom/claims/mine');
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const d = r.json?.data ?? {};
    expect((d.claimable ?? []).some((v: any) => String(v.quoteId) === bomQuoteId), '접수한 견적이 아직 접수할 주문에').toBe(false);
    const row = (d.claims ?? []).find((v: any) => String(v.id) === bomClaimId);
    expect(row, '접수 내역에 없음').toBeTruthy();
    expect(Number(d.openCount), 'openCount +1').toBe(bomOpenBefore + 1);
  });

  test('A4. 남의 접수는 두 트랙 모두 보이지 않는다', async () => {
    const p = await api(O, 'GET', '/api/pcb-claims/mine?scope=all');
    const b = await api(O, 'GET', '/api/bom/claims/mine?scope=all');
    expect(p.status).toBe(200);
    expect(b.status).toBe(200);
    expect((p.json?.data?.claims ?? []).some((v: any) => String(v.id) === pcbClaimId)).toBe(false);
    expect((b.json?.data?.claims ?? []).some((v: any) => String(v.id) === bomClaimId)).toBe(false);
  });

  test('A5. 화면 — 메뉴·회색 배지·탭·폼 없음·딥링크·좁은 폭', async () => {
    const { page } = customer;
    await page.goto(`${BASE_URL}/shop/as`, { waitUntil: 'networkidle' });
    await snap(page, 'as-menu/list-pcb');

    const nav = await page.evaluate(() => {
      const groups = [...document.querySelectorAll('.smb_nav .nav_group')].map((g) => ({
        label: g.querySelector('.nav_glabel')?.textContent?.trim() ?? '',
        items: [...g.querySelectorAll('a')].map((a) => ({
          text: a.querySelector('.lbl')?.textContent?.trim() ?? '',
          badge: a.querySelector('.nav_badge')?.textContent?.trim() ?? '',
          badgeRed: a.querySelector('.nav_badge')?.classList.contains('on') ?? false,
          current: a.getAttribute('aria-current') === 'page',
        })),
      }));
      return groups;
    });
    const group = nav.find((g) => g.label === '문의');
    expect(group, '문의 그룹').toBeTruthy();
    const item = group?.items.find((i) => i.text === 'A/S 접수');
    expect(item, 'A/S 접수 항목').toBeTruthy();
    expect(item?.current, '현재 페이지 활성').toBe(true);
    expect(Number(item?.badge ?? 0), '배지 = PCB+BOM 진행 중 합산').toBe(pcbOpenBefore + bomOpenBefore + 2);
    expect(item?.badgeRed, '관리자 차례라 빨간 배지가 아니다').toBe(false);

    const pcbView = await page.evaluate((cid: string) => {
      const tabs = [...document.querySelectorAll('#sp-as-tracks a')].map((a) => ({
        track: a.getAttribute('data-track'),
        active: a.classList.contains('is-active'),
        text: a.textContent?.trim() ?? '',
      }));
      const claimRow = [...document.querySelectorAll('#sp-as-claims .sp-eqm__item')].find((li) =>
        (li.querySelector('.sp-eqm__go') as HTMLAnchorElement | null)?.href.includes(`#as-${cid}`),
      );
      return {
        tabs,
        forms: document.querySelectorAll('.sp-asm form, .sp-asm textarea, .sp-asm input[type=file]').length,
        claimableCount: document.querySelectorAll('#sp-as-claimable .sp-eqm__item').length,
        claimableHrefs: [...document.querySelectorAll('#sp-as-claimable .sp-eqm__go')].map(
          (a) => (a as HTMLAnchorElement).href,
        ),
        claimHref: (claimRow?.querySelector('.sp-eqm__go') as HTMLAnchorElement | null)?.href ?? '',
        bodyHasEq: /\bEQ\b/.test(document.querySelector('.sp-asm')?.textContent ?? ''),
      };
    }, pcbClaimId);
    expect(pcbView.tabs.map((t) => t.track), '탭은 PCB·부품 BOM 둘뿐(전체 없음)').toEqual(['pcb', 'bom']);
    expect(pcbView.tabs.find((t) => t.track === 'pcb')?.active, 'PCB 탭 기본 활성').toBe(true);
    expect(pcbView.forms, '페이지에 접수 폼이 있으면 안 된다').toBe(0);
    expect(pcbView.claimableCount, '접수할 주문(다른 스펙 라인)이 남아 있다').toBeGreaterThanOrEqual(1);
    expect(pcbView.claimableHrefs.every((h) => h.includes('orderinquiryview.php?od_id=') && h.endsWith('#sp_as_wrap')), '접수하기 = 주문 상세 A/S 섹션').toBe(true);
    expect(pcbView.claimHref, '내용 보기 = 접수 행 앵커').toContain(`orderinquiryview.php?od_id=${pcbOdId}#as-${pcbClaimId}`);
    expect(pcbView.bodyHasEq, '화면에 EQ 노출').toBe(false);

    // 부품 탭 — 접수 내역 행이 /app/bom/:id 로 간다.
    await page.goto(`${BASE_URL}/shop/as?track=bom`, { waitUntil: 'networkidle' });
    await snap(page, 'as-menu/list-bom');
    const bomView = await page.evaluate((cid: string) => {
      const active = document.querySelector('#sp-as-tracks a.is-active')?.getAttribute('data-track');
      const hrefs = [...document.querySelectorAll('#sp-as-claims .sp-eqm__go')].map(
        (a) => (a as HTMLAnchorElement).href,
      );
      return { active, hrefs, hasRow: document.body.innerHTML.includes(`/app/bom/`) , cid };
    }, bomClaimId);
    expect(bomView.active).toBe('bom');
    expect(bomView.hrefs.some((h) => h.includes(`/app/bom/${bomQuoteId}`)), '부품 행 링크').toBe(true);

    // 좁은 폭 — 가로로 터지지 않는다.
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(200);
    const narrow = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      docWidth: document.documentElement.scrollWidth,
    }));
    expect(narrow.overflow, `가로 스크롤 발생(${String(narrow.docWidth)}px)`).toBe(false);
    await page.setViewportSize({ width: 1440, height: 900 });

    // 딥링크 착지 — 주문 상세의 그 접수 행.
    await page.goto(pcbView.claimHref, { waitUntil: 'networkidle' });
    const landed = await page.evaluate(
      (cid: string) => ({
        row: document.querySelector(`#as-${cid}.sp_as_claim`) !== null,
        h2: document.querySelector('#sp_as_wrap h2')?.textContent?.trim() ?? '',
      }),
      pcbClaimId,
    );
    expect(landed.row, '접수 행 앵커').toBe(true);
    expect(landed.h2, '주문 상세 섹션 제목 중립화').toBe('A/S 접수');
  }, 120_000);

  test('A6. 배지는 다른 계정 페이지에서도 같은 수', async () => {
    const { page } = customer;
    const read = async (url: string): Promise<number> => {
      await page.goto(url, { waitUntil: 'networkidle' });
      return page.evaluate(() => {
        const link = [...document.querySelectorAll('.smb_nav a')].find(
          (a) => a.querySelector('.lbl')?.textContent?.trim() === 'A/S 접수',
        );
        return Number(link?.querySelector('.nav_badge')?.textContent?.trim() ?? 0);
      });
    };
    const onMypage = await read(`${BASE_URL}/shop/mypage.php`);
    const onQuotes = await read(`${BASE_URL}/shop/quotes`);
    expect(onMypage).toBe(pcbOpenBefore + bomOpenBefore + 2);
    expect(onQuotes).toBe(onMypage);
  }, 120_000);
});
