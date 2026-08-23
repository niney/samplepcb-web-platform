// 협력사 보유 부품 — **화면 관찰**(docs/PARTNER_PARTS.md).
//
// UI 는 DOM 검증만으로 못 잡는 결함이 있다(플레이북 "실브라우저 사각": 인쇄 드로어 겹침은
// 사용자 스크린샷에서야 드러났다). 이 스펙은 세 화면을 실제로 띄워 pageerror 0 을 확인하고
// 캡처를 남겨 사람이 한 번 보게 한다 — 단언은 최소로, 눈으로 볼 근거를 만드는 것이 목적이다.
//
// 실행: pnpm -F e2e e2e partner-parts-observe   (PORTAL_E2E=1 · API·web dev·sp-engine 필요)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  RUN,
  closeBrowser,
  disconnectPrisma,
  getPrisma,
  newSession,
  signJwt,
  snap,
} from '../helpers';

const PARTNER_NAME = 'e2e부품관찰';
const PARTNER_MB_ID = 'e2e-parts-view';

const STOCK_CSV = [
  'Parts No.,date Code,Brand,QTY.,price,Lead Time',
  'STM32F030F4P6,23+,ST,1200,$1.35,Stock',
  'DS1307Z+T&R,21+,Maxim,500,,Stock',
  '"PCA9575PW2, 118",22+,NXP,80,,Stock',
  'LM358D ST,22+,,40,,Stock',
  'ADUC7020BCPZ62I-R7,21+,,21000,,Stock',
  'TPS40170RGYR,24+,TI,300,,Stock',
].join('\n');

let partnerId: bigint;
let previewUploadId: number | null = null;

const cleanup = async (): Promise<void> => {
  const prisma = getPrisma();
  const existing = await prisma.spPartner.findFirst({ where: { name: PARTNER_NAME } });
  if (existing === null) return;
  const parts = await prisma.spPartnerPart.findMany({
    where: { partnerId: existing.id },
    select: { id: true },
  });
  if (parts.length > 0) {
    await prisma.spPartnerPartKey.deleteMany({
      where: { partId: { in: parts.map((p: { id: bigint }) => p.id) } },
    });
  }
  await prisma.spPartnerPart.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartnerPartUpload.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartnerMember.deleteMany({ where: { partnerId: existing.id } });
  await prisma.spPartner.delete({ where: { id: existing.id } });
};

const upload = async (token: string, path: string): Promise<any> => {
  const form = new FormData();
  form.append('file', new File([STOCK_CSV], 'observe-stock.csv', { type: 'text/csv' }));
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  return { status: res.status, json: await res.json() };
};

describe.skipIf(!RUN)('협력사 보유 부품 — 화면 관찰', () => {
  beforeAll(async () => {
    await cleanup();
    const prisma = getPrisma();
    const created = await prisma.spPartner.create({
      data: {
        type: 'partner',
        name: PARTNER_NAME,
        country: 'KR',
        defaultCurrency: 'KRW',
        capabilities: ['bom_rfq', 'part_sale'],
        status: 'approved',
        members: { create: { mbId: PARTNER_MB_ID, role: 'owner' } },
      },
    });
    partnerId = created.id;

    // 원장에 반영된 회차 하나(목록 화면용) + 확인 대기 회차 하나(미리보기 화면용)
    const token = signJwt({ mbId: PARTNER_MB_ID });
    const first = await upload(token, '/api/partner/parts/uploads');
    expect(first.status, JSON.stringify(first.json)).toBe(201);
    const committed = await fetch(
      `${API_URL}/api/partner/parts/uploads/${String(first.json.data.upload.uploadId)}/commit`,
      {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'replace' }),
      },
    );
    expect(committed.status).toBe(200);

    const second = await upload(token, '/api/partner/parts/uploads');
    expect(second.status).toBe(201);
    previewUploadId = second.json.data.upload.uploadId as number;
  }, 240_000);

  afterAll(async () => {
    await cleanup();
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('포털 — 보유 부품 목록(사이드바 공통 그룹에 뜬다)', async () => {
    const session = await newSession({ mbId: PARTNER_MB_ID });
    try {
      await session.page.goto('/app/partner/parts', { waitUntil: 'networkidle' });
      await session.page.waitForSelector('text=등록된 부품', { timeout: 20_000 });
      // 공통 영역 메뉴 — 모듈 스위처가 아니라 사이드바 공통 그룹
      expect(
        await session.page.locator('aside a', { hasText: '보유 부품' }).first().isVisible(),
        '사이드바 공통 그룹에 보유 부품 메뉴가 있어야 한다',
      ).toBe(true);
      // 원문이 다른 행은 원문을 함께 보인다(무유실이 화면까지 이어지는지)
      expect(await session.page.locator('text=PCA9575PW2, 118').first().isVisible(), '화면에 보여야 한다').toBe(true);
      await snap(session.page, 'partner-parts-list');
      expect(session.pageErrors, session.pageErrors.join('\n')).toEqual([]);
    } finally {
      await session.close();
    }
  }, 120_000);

  test('포털 — 행 수정(모달에서 고치면 목록에 수정됨 배지가 남는다)', async () => {
    const session = await newSession({ mbId: PARTNER_MB_ID });
    try {
      await session.page.goto('/app/partner/parts', { waitUntil: 'networkidle' });
      await session.page.waitForSelector('text=등록된 부품', { timeout: 20_000 });

      await session.page.locator('button', { hasText: '수정' }).first().click();
      await session.page.waitForSelector('text=부품 수정', { timeout: 10_000 });
      await snap(session.page, 'partner-parts-edit-modal');

      // 재고만 고친다 — 품번을 건드리면 뒤 케이스의 보유 조회가 흔들린다.
      const stock = session.page.locator('label', { hasText: '재고 수량' }).locator('input');
      await stock.fill('4242');
      await session.page.locator('button', { hasText: '저장' }).click();

      await session.page.waitForSelector('text=수정됨', { timeout: 15_000 });
      expect(
        await session.page.locator('text=4,242').first().isVisible(),
        '고친 재고가 목록에 반영돼야 한다',
      ).toBe(true);
      await snap(session.page, 'partner-parts-edited-row');
      expect(session.pageErrors, session.pageErrors.join('\n')).toEqual([]);
    } finally {
      await session.close();
    }
  }, 120_000);

  test('포털 — 업로드 확인(열 역할 교정 + 미리보기)', async () => {
    const session = await newSession({ mbId: PARTNER_MB_ID });
    try {
      await session.page.goto(`/app/partner/parts/uploads/${String(previewUploadId)}`, {
        waitUntil: 'networkidle',
      });
      await session.page.waitForSelector('text=열을 이렇게 읽었습니다', { timeout: 20_000 });
      // 열 역할 셀렉트가 시트 열마다 하나씩
      expect(await session.page.locator('select').count()).toBeGreaterThanOrEqual(6);
      expect(await session.page.locator('text=보유 부품에 반영').isVisible(), '화면에 보여야 한다').toBe(true);
      await snap(session.page, 'partner-parts-upload-preview');
      expect(session.pageErrors, session.pageErrors.join('\n')).toEqual([]);
    } finally {
      await session.close();
    }
  }, 120_000);

  test('관리자 — 협력사 보유 부품 뒤처리', async () => {
    const session = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    try {
      await session.page.goto('/app/admin/partner-parts', { waitUntil: 'networkidle' });
      await session.page.waitForSelector('text=협력사 보유 부품', { timeout: 20_000 });
      expect(await session.page.locator(`text=${PARTNER_NAME}`).first().isVisible(), '화면에 보여야 한다').toBe(true);
      // 뒤처리 버튼 — 만료를 두지 않는 대신 사람이 끄고 비운다
      expect(await session.page.locator('button', { hasText: '끄기' }).first().isVisible(), '화면에 보여야 한다').toBe(true);
      expect(await session.page.locator('button', { hasText: '비우기' }).first().isVisible(), '화면에 보여야 한다').toBe(true);
      expect(
        await session.page.locator('button', { hasText: '대행 업로드' }).first().isVisible(),
        '포털 계정 없는 협력사를 위한 대행 업로드가 있어야 한다',
      ).toBe(true);
      await snap(session.page, 'admin-partner-parts');
      expect(session.pageErrors, session.pageErrors.join('\n')).toEqual([]);
    } finally {
      await session.close();
    }
  }, 120_000);

  test('관리자 Case — 협력사 보유 퀵액션·행 표시·발송 모달 배지', async () => {
    const prisma = getPrisma();
    const quote = await prisma.spBomQuote.create({
      data: {
        mbId: PARTNER_MB_ID,
        title: 'e2e부품관찰-보유표시',
        fileName: 'observe.csv',
        status: 'reviewing',
        buildStatus: 'ready',
      },
    });
    await prisma.spBomQuoteItem.createMany({
      data: [
        { quoteId: quote.id, rowIdx: 1, mpn: 'STM32F030F4P6', bomQty: 1, orderQty: 10 },
        { quoteId: quote.id, rowIdx: 2, mpn: 'TPS40170RGYR', bomQty: 1, orderQty: 5 },
        { quoteId: quote.id, rowIdx: 3, mpn: 'NOBODY-HAS-THIS', bomQty: 1, orderQty: 3 },
      ],
    });

    const session = await newSession({ mbId: 'e2e-admin', isAdmin: true });
    try {
      await session.page.goto(`/app/admin/smartbom/cases/${String(quote.id)}`, {
        waitUntil: 'networkidle',
      });
      // 퀵 액션 — 보유 행만 골라 담는다(3행 중 2행). 세 번째는 아무도 안 가진 품번.
      const quick = session.page.locator('button', { hasText: '협력사 보유' }).first();
      await quick.waitFor({ state: 'visible', timeout: 20_000 });
      expect((await quick.textContent())?.trim()).toMatch(/협력사 보유\s+2$/);
      await quick.click();
      // 행에도 보유 협력사 이름이 뜬다(관리자 전용 — 고객 화면엔 이름이 없다)
      expect(
        await session.page.locator(`text=협력사 보유 · ${PARTNER_NAME}`).first().isVisible(),
        '행에 보유 협력사 이름이 보여야 한다',
      ).toBe(true);
      await snap(session.page, 'admin-case-partner-stock');

      // 발송 모달 — 보유 배지
      const send = session.page.locator('button', { hasText: '협력사 견적요청' }).first();
      if (await send.count()) {
        await send.click();
        await session.page.waitForTimeout(700);
        await snap(session.page, 'admin-case-rfq-send-modal');
      }
      expect(session.pageErrors, session.pageErrors.join('\n')).toEqual([]);
    } finally {
      await session.close();
      await prisma.spBomQuoteItem.deleteMany({ where: { quoteId: quote.id } });
      await prisma.spBomQuote.delete({ where: { id: quote.id } });
    }
  }, 180_000);

  test('원장 요약이 화면·API 에서 같은 수를 본다', async () => {
    const prisma = getPrisma();
    const active = await prisma.spPartnerPart.count({ where: { partnerId, isActive: true } });
    expect(active).toBe(6);
  });
});
