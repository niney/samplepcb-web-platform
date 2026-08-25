// 주문내역 유형 탭(Figma 103:4215) — 전체/PCB/부품 필터 + 총건·페이지네이션 추종 + 다크 필
//
// 무엇을 지키는가:
//   ① 탭 필터의 모수 = 카트행 it_id (PCB 4종 / sp-bom-parts) — 총건이 DB count 와 일치
//   ② 페이지 링크가 track 을 물고 다닌다(코어 무수정 — sub 가 $total_count/$qstr 재계산)
//   ③ 잘못된 track 은 전체로 폴백 · 마이페이지 최근 주문에는 탭이 없다
//   ④ 사이드바 활성 = 다크 필(#0a151e·흰 글씨) · 제목 '주문내역' 36px + 아이콘
//
// 실행: cd e2e && PORTAL_E2E=1 npx vitest run orderinquiry-tabs
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BASE_URL,
  RUN,
  closeBrowser,
  disconnectPrisma,
  getPrisma,
  newPhpSession,
  requireCustomerCreds,
  snap,
  type PhpLoginResult,
} from '../helpers';

const PCB_ITEMS = ['sp-pcb-std', 'sp-mask', 'sp-pcb-adv', 'sp-pcb-flex'];

describe.skipIf(!RUN)('주문내역 유형 탭 — 전체/PCB/부품 + 다크 필', () => {
  let customer: PhpLoginResult;
  let cntAll = 0;
  let cntPcb = 0;
  let cntBom = 0;

  beforeAll(async () => {
    const health = await fetch(`${API_URL}/api/health`).catch(() => null);
    if (health === null) throw new Error(`${API_URL} 도달 실패 — pnpm dev:api 확인`);
    const creds = requireCustomerCreds();
    customer = await newPhpSession(creds);
    const prisma = getPrisma();
    const q = async (where: string): Promise<number> => {
      const r: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*) c FROM g5_shop_order a WHERE a.mb_id = ? ${where}`,
        creds.id,
      );
      return Number(r[0]?.c ?? 0);
    };
    cntAll = await q('');
    cntPcb = await q(
      `AND EXISTS (SELECT 1 FROM g5_shop_cart c WHERE c.od_id = a.od_id AND c.it_id IN (${PCB_ITEMS.map((s) => `'${s}'`).join(',')}))`,
    );
    cntBom = await q(
      `AND EXISTS (SELECT 1 FROM g5_shop_cart c WHERE c.od_id = a.od_id AND c.it_id = 'sp-bom-parts')`,
    );
    expect(cntAll, '전체 주문').toBeGreaterThan(0);
    expect(cntPcb, 'PCB 주문').toBeGreaterThan(0);
    expect(cntBom, '부품 주문').toBeGreaterThan(0);
  }, 180_000);

  afterAll(async () => {
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  /** 페이지를 읽어 구조화 — 탭·총건·행·페이지 링크. */
  const read = async (query: string) => {
    const { page } = customer;
    await page.goto(`${BASE_URL}/shop/orderinquiry.php${query}`, { waitUntil: 'networkidle' });
    return page.evaluate(() => ({
      tabs: [...document.querySelectorAll('.sp-oi-tabs a')].map((a) => ({
        text: a.textContent?.trim() ?? '',
        active: a.classList.contains('is-active'),
      })),
      count: Number(
        (document.querySelector('.sod_v_count strong')?.textContent ?? '0').replace(/,/g, ''),
      ),
      rows: document.querySelectorAll('.sod_list_tbl tbody tr:not(.empty_list_row)').length,
      // 비활성 화살표(href 없는 a)는 링크가 아니다 — track 유지 검사에서 제외.
      pgHrefs: [...document.querySelectorAll('#sod_v .pg a[href]')].map((a) => (a as HTMLAnchorElement).href),
      pgStartHidden:
        document.querySelector('#sod_v .pg_start') === null ||
        getComputedStyle(document.querySelector('#sod_v .pg_start') as Element).display === 'none',
    }));
  };

  test('T1. 전체 탭 — 총건 = 전체 주문 수, 탭 3개(설계·SMT 없음)', async () => {
    const v = await read('');
    expect(v.tabs.map((t) => t.text)).toEqual(['전체', 'PCB', '부품']);
    expect(v.tabs.find((t) => t.text === '전체')?.active).toBe(true);
    expect(v.count, '총건 = 전체').toBe(cntAll);
    await snap(customer.page, 'oi-tabs/all');
  }, 120_000);

  test('T2. PCB 탭 — 총건 = PCB 주문 수, 페이지 링크가 track 유지', async () => {
    const v = await read('?track=pcb');
    expect(v.tabs.find((t) => t.text === 'PCB')?.active).toBe(true);
    expect(v.count, '총건 = PCB').toBe(cntPcb);
    expect(v.rows).toBeGreaterThan(0);
    if (v.pgHrefs.length > 0) {
      expect(v.pgHrefs.every((h) => h.includes('track=pcb')), '페이지 링크 track 유지').toBe(true);
    }
    expect(v.pgStartHidden, '처음/맨끝 링크 숨김(Figma)').toBe(true);

    // ‹ › 는 항상 양쪽(Figma) — 갈 곳 없으면 비활성(is-disabled·href 없음), 이동은 한 페이지씩.
    const arrows = async (): Promise<{
      prev: string | null; next: string | null; prevOff: boolean; nextOff: boolean;
    }> =>
      customer.page.evaluate(() => {
        const g = (s: string) => document.querySelector(s) as HTMLAnchorElement | null;
        return {
          prev: g('#sod_v .pg_prev')?.getAttribute('href') ?? null,
          next: g('#sod_v .pg_next')?.getAttribute('href') ?? null,
          prevOff: g('#sod_v .pg_prev')?.classList.contains('is-disabled') ?? false,
          nextOff: g('#sod_v .pg_next')?.classList.contains('is-disabled') ?? false,
        };
      });
    const p1 = await arrows();
    expect(p1.prevOff, '1페이지 이전은 비활성으로 보인다').toBe(true);
    expect(p1.prev, '비활성엔 href 없음').toBeNull();
    expect(p1.next, '1페이지 다음 → 2').toContain('page=2');
    await customer.page.goto(`${BASE_URL}/shop/orderinquiry.php?track=pcb&page=2`, { waitUntil: 'networkidle' });
    const p2 = await arrows();
    expect(p2.prev, '2페이지 이전 → 1').toContain('page=1');
    expect(p2.prev).toContain('track=pcb');
    const pcbPages = Math.ceil(cntPcb / 15); // cf_page_rows
    if (pcbPages > 2) expect(p2.next, '2페이지 다음 → 3').toContain('page=3');
    else expect(p2.nextOff, '마지막 페이지 다음은 비활성').toBe(true);
  }, 120_000);

  test('T3. 부품 탭 — 총건 = 부품 주문 수 · 행 전부 부품 BOM', async () => {
    const v = await read('?track=bom');
    expect(v.tabs.find((t) => t.text === '부품')?.active).toBe(true);
    expect(v.count, '총건 = 부품').toBe(cntBom);
    const names = await customer.page.evaluate(() =>
      [...document.querySelectorAll('.sod_list_tbl .sod_col_name a')].map((a) => a.textContent ?? ''),
    );
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n.includes('부품 BOM')), '부품 탭 행 구성').toBe(true);
    await snap(customer.page, 'oi-tabs/bom');
  }, 120_000);

  test('T4. 잘못된 track 은 전체로 폴백', async () => {
    const v = await read('?track=hack');
    expect(v.tabs.find((t) => t.text === '전체')?.active).toBe(true);
    expect(v.count).toBe(cntAll);
  }, 120_000);

  test('T5. 사이드바 활성 다크 필 + 제목 36px·아이콘 · 마이페이지엔 탭 없음', async () => {
    const { page } = customer;
    await page.goto(`${BASE_URL}/shop/orderinquiry.php`, { waitUntil: 'networkidle' });
    const v = await page.evaluate(() => {
      const active = document.querySelector('.smb_nav .nav_group a[aria-current="page"]');
      const st = active === null ? null : getComputedStyle(active);
      const title = document.getElementById('wrapper_title');
      return {
        activeLabel: active?.querySelector('.lbl')?.textContent?.trim(),
        bg: st?.backgroundColor,
        color: st?.color,
        icoFilter: active === null ? '' : getComputedStyle(active.querySelector('.nav_ico') as Element).filter,
        titleText: title?.textContent?.trim(),
        titleSize: title === null ? '' : getComputedStyle(title).fontSize,
        titleIco: title?.querySelector('.sp-title-ico') !== null,
      };
    });
    expect(v.activeLabel).toBe('주문내역');
    expect(v.bg, '다크 필 배경').toBe('rgb(10, 21, 30)');
    expect(v.color, '흰 글씨').toBe('rgb(255, 255, 255)');
    expect(v.icoFilter, '아이콘 흰색화').toContain('invert(1)');
    expect(v.titleText).toBe('주문내역');
    expect(v.titleSize, '제목 36px').toBe('36px');
    expect(v.titleIco, '제목 아이콘').toBe(true);

    await page.goto(`${BASE_URL}/shop/mypage.php`, { waitUntil: 'networkidle' });
    const my = await page.evaluate(() => ({
      tabs: document.querySelectorAll('.sp-oi-tabs').length,
      rows: document.querySelectorAll('#smb_my_od tbody tr').length,
    }));
    expect(my.tabs, '마이페이지 최근 주문엔 탭 없음').toBe(0);
    expect(my.rows, '최근 주문 8건 유지').toBe(8);
  }, 120_000);
});
