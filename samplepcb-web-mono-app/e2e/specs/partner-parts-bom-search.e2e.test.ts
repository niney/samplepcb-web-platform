/**
 * 협력사 보유 부품 × 고객 BOM 분석 — **실검색 왕복** (docs/PARTNER_PARTS.md §4)
 *
 * 앞선 `partner-parts.e2e.test.ts` 는 원장까지만 본다. 여기서는 고객이 실제로 올리는
 * 경로(POST /bom/quotes → prepare → build → 공급사 검색)를 그대로 태워서
 * **협력사 원장이 정말 후보로 걸리는지**를 확인한다. 엔진·외부 공급사 API 를 실제로
 * 부르므로 느리고, 그래서 행 수를 8 행으로 눌러 두었다.
 *
 * 픽스처 두 본은 짝이다(실물 EUREKA 재고표에서 뽑은 진짜 품번):
 *  · `partner-stock-eureka-sample.csv` — 협력사가 올리는 재고표(브로커 서식)
 *  · `bom-partner-stock-match.csv`     — 고객이 올리는 BOM. 위 재고표와 **일부러 겹치게** 짰다.
 *
 * 행마다 묻는 것이 다르다:
 *  ① MCP1700T-3302E/TT · PIC16F1825T-I/SL — 흔한 부품. 실공급사가 잡히는 자리에
 *     협력사가 **함께** 뜨되 **앞을 가로채지 않는지**(뒤순위).
 *  ② ADUC7020BCPZ62I-R7 · 88PW886-B1-NFHIC000-T · CS5532-ASZR — 단종·희귀.
 *     실공급사가 못 찾는 자리에서 협력사가 **유일한 근거**가 되는지.
 *  ③ LPC2387FBD100 — 재고표엔 `LPC2387FBD100,551`(NXP 포장 코드) 로 적혀 있다.
 *     **대체 조회 키**가 실제로 BOM 품번을 잡는지.
 *  ④ STM32F030F4P6 — 협력사가 **안 가진** 흔한 부품. 대조군(오탐 방지).
 *  ⑤ ZZ9-NOSUCHPART-0001 — 아무도 없는 품번. 협력사 근거도 없어야 한다.
 *
 * 노출 정책(P5)도 같은 왕복에서 본다: 고객 응답은 곳 수·재고·기준일까지, **조직 식별자는
 * 빈 배열**. 이름은 관리자 전용 `/admin/bom-quotes/:id/partner-stock` 에서만 나온다.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  API_URL,
  BOM_ENGINE_URL,
  RUN,
  api,
  disconnectPrisma,
  getPrisma,
  monoRoot,
  num,
  signJwt,
} from '../helpers';

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */

const PARTNER_NAME = 'e2e재고보유상사';
const PARTNER_MB_ID = 'e2e-stock-owner';
const CUSTOMER_MB_ID = 'e2e-stock-buyer';

const admin = (): string => signJwt({ mbId: 'e2e-admin', isAdmin: true, ttlSec: 7_200 });
const owner = (): string => signJwt({ mbId: PARTNER_MB_ID, ttlSec: 7_200 });
const buyer = (): string => signJwt({ mbId: CUSTOMER_MB_ID, ttlSec: 7_200 });

const fixture = (name: string): Buffer =>
  readFileSync(join(monoRoot, 'e2e', 'fixtures', name));

/** 협력사가 가진 품번 → 이 행에 협력사 근거가 떠야 한다. */
const HELD = [
  'MCP1700T-3302E/TT',
  'PIC16F1825T-I/SL',
  'ADUC7020BCPZ62I-R7',
  '88PW886-B1-NFHIC000-T',
  'CS5532-ASZR',
];
/** 재고표엔 포장 코드가 붙어 있다 — 대체 키로만 걸린다. */
const HELD_VIA_ALTERNATIVE = 'LPC2387FBD100';
/** 협력사가 안 가진 품번 → 근거가 뜨면 오탐이다. */
const NOT_HELD = ['STM32F030F4P6', 'ZZ9-NOSUCHPART-0001'];

let partnerId: bigint;
let quoteId: string;
/** 품번 → 견적 품목 DTO(활성 행만). */
let itemsByMpn = new Map<string, any>();

const uploadFile = async (
  token: string,
  path: string,
  body: Buffer,
  filename: string,
  extra: Record<string, string> = {},
): Promise<{ status: number; json: any }> => {
  const form = new FormData();
  form.append('file', new File([new Uint8Array(body)], filename, { type: 'text/csv' }));
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  const res = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* 본문 없는 응답 */
  }
  return { status: res.status, json };
};

/** 실패를 파고들 때 견적을 남긴다 — `KEEP_QUOTE=1`. */
const KEEP_QUOTE = process.env.KEEP_QUOTE === '1';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const cleanupPartner = async (): Promise<void> => {
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

const cleanupQuotes = async (): Promise<void> => {
  const prisma = getPrisma();
  const quotes = await prisma.spBomQuote.findMany({
    where: { mbId: CUSTOMER_MB_ID },
    select: { id: true },
  });
  for (const quote of quotes) {
    // 삭제 순서는 FK 없이도 참조가 남지 않게 아래에서 위로.
    await prisma.spBomSupplierSearchTrace.deleteMany({
      where: { supplierSearchRun: { quoteId: quote.id } },
    });
    await prisma.spBomQuote.update({
      where: { id: quote.id },
      data: { activeSupplierSearchRunId: null },
    });
    await prisma.spBomSupplierSearchRun.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteSelectionEvent.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteCandidate.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuoteItem.deleteMany({ where: { quoteId: quote.id } });
    await prisma.spBomQuote.delete({ where: { id: quote.id } });
  }
};

describe.skipIf(!RUN)('협력사 보유 부품 × 고객 BOM 실검색', () => {
  beforeAll(async () => {
    const engine = await fetch(`${BOM_ENGINE_URL}/health`).catch(() => null);
    if (engine === null || !engine.ok) {
      throw new Error(`sp-engine(${BOM_ENGINE_URL}) 이 떠 있어야 합니다 — ./run.sh`);
    }
    await cleanupQuotes();
    await cleanupPartner();
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
  }, 180_000);

  afterAll(async () => {
    if (!KEEP_QUOTE) await cleanupQuotes();
    await cleanupPartner();
    await disconnectPrisma();
  }, 120_000);

  test('협력사 원장 세우기 — 재고표 7행이 조회 키로 색인된다', async () => {
    const uploaded = await uploadFile(
      owner(),
      '/api/partner/parts/uploads',
      fixture('partner-stock-eureka-sample.csv'),
      'partner-stock-eureka-sample.csv',
    );
    expect(uploaded.status, JSON.stringify(uploaded.json)).toBe(201);
    const uploadId = uploaded.json.data.upload.uploadId as number;

    const commit = await api(
      owner(),
      'POST',
      `/api/partner/parts/uploads/${String(uploadId)}/commit`,
      { mode: 'replace' },
    );
    expect(commit.status, JSON.stringify(commit.json)).toBe(200);
    expect(commit.json.data.affected).toBe(7);

    // 대체 키 — BOM 은 포장 코드 없이 `LPC2387FBD100` 로 적혀 있다.
    const prisma = getPrisma();
    const alt = await prisma.spPartnerPartKey.findFirst({
      where: { partnerId, mpnNorm: 'LPC2387FBD100', isActive: true },
      select: { kind: true },
    });
    expect(alt, '포장 코드를 뗀 대체 키가 있어야 BOM 품번이 걸린다').not.toBeNull();
    expect(alt?.kind).toBe('alternative');
  }, 180_000);

  test('고객 BOM 업로드 → 공급사 검색 완주', async () => {
    const created = await uploadFile(
      buyer(),
      '/api/bom/quotes',
      fixture('bom-partner-stock-match.csv'),
      'bom-partner-stock-match.csv',
      { procurementMode: 'sample' },
    );
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    quoteId = created.json.data.quoteId as string;

    // 파싱 결과 회수 — 엔진 잡이 끝날 때까지 재시도(파싱은 초 단위).
    let prepared: any = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const res = await api(buyer(), 'POST', `/api/bom/quotes/${quoteId}/prepare`);
      if (res.status === 200 && res.json.data.buildStatus !== 'parsing') {
        prepared = res.json.data;
        break;
      }
      await sleep(1_000);
    }
    expect(prepared, '파싱이 끝나야 한다').not.toBeNull();
    expect(prepared.buildStatus, JSON.stringify(prepared?.sheets)).toBe('selecting');

    const sheetIndexes = (prepared.sheets as any[])
      .filter((sheet) => sheet.status === 'parsed')
      .map((sheet) => sheet.sheetIndex);
    expect(sheetIndexes.length, 'BOM 으로 분류된 시트가 있어야 한다').toBeGreaterThan(0);

    const built = await api(buyer(), 'POST', `/api/bom/quotes/${quoteId}/build`, { sheetIndexes });
    expect(built.status, JSON.stringify(built.json)).toBe(200);

    // 공급사 검색 — 외부 API 왕복이라 넉넉히 기다린다.
    let searchStatus: string | null = null;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const res = await api(buyer(), 'GET', `/api/bom/quotes/${quoteId}/supplier-search`);
      searchStatus = res.json?.data?.status ?? null;
      if (searchStatus === 'completed' || searchStatus === 'failed') break;
      await sleep(2_000);
    }
    expect(searchStatus, '공급사 검색이 끝나야 후보를 볼 수 있다').toBe('completed');

    // ⚠ 검색 status 가 completed 여도 견적 행 투영은 **한 박자 뒤**다(엔진 결과가
    // 아티팩트로 들어온 뒤 별도로 반영된다). status 만 보고 바로 읽으면 근거가 아직
    // 비어 있어 '협력사가 안 잡혔다'로 오독한다 — 실제로 그렇게 한 번 속았다.
    let detail: any = null;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const res = await api(buyer(), 'GET', `/api/bom/quotes/${quoteId}`);
      const items = (res.json?.data?.items ?? []) as any[];
      if (items.length > 0 && items.some((item) => item.matchEvidence !== null)) {
        detail = res;
        break;
      }
      await sleep(1_000);
    }
    expect(detail, '견적 행 투영이 끝나야 한다').not.toBeNull();
    itemsByMpn = new Map(
      (detail.json.data.items as any[])
        .filter((item) => typeof item.mpn === 'string' && item.mpn !== '')
        .map((item) => [String(item.mpn).toUpperCase(), item]),
    );
    // 픽스처 8행 중 품번이 있는 행 전부가 살아 있어야 아래 판정이 의미를 갖는다.
    for (const mpn of [...HELD, HELD_VIA_ALTERNATIVE, ...NOT_HELD]) {
      expect(itemsByMpn.has(mpn.toUpperCase()), `${mpn} 행이 견적에 있어야 한다`).toBe(true);
    }
  }, 900_000);

  test('보유 행에 협력사 근거가 붙는다 — 안 가진 행에는 안 붙는다', () => {
    for (const mpn of [...HELD, HELD_VIA_ALTERNATIVE]) {
      const item = itemsByMpn.get(mpn.toUpperCase());
      const stock = item?.matchEvidence?.partnerStock ?? null;
      expect(stock, `${mpn}: 협력사 보유 근거가 있어야 한다`).not.toBeNull();
      // ⚠ 곳 수를 1 로 못 박지 않는다 — 개발 DB 에는 같은 진짜 품번을 가진 다른 협력사
      // 원장이 함께 산다(실물 재고표에서 뽑은 품번이라 당연하다). '누가' 가졌는지는
      // 아래 관리자 조회로 확인한다.
      expect(stock.partnerCount, `${mpn}: 보유 협력사 수`).toBeGreaterThanOrEqual(1);
      expect(stock.totalStockQty, `${mpn}: 재고 합계`).toBeGreaterThan(0);
      expect(stock.latestUploadedAt, `${mpn}: 기준일`).not.toBeNull();
    }
    // 대조군 — 여기 근거가 뜨면 정규화나 조회 키가 새는 것이다.
    for (const mpn of NOT_HELD) {
      const item = itemsByMpn.get(mpn.toUpperCase());
      expect(
        item?.matchEvidence?.partnerStock ?? null,
        `${mpn}: 협력사가 안 가진 행이다`,
      ).toBeNull();
    }
  });

  test('고객에게는 이름을 가린다 — 관리자에게만 보인다 (P5)', async () => {
    for (const mpn of HELD) {
      const stock = itemsByMpn.get(mpn.toUpperCase())?.matchEvidence?.partnerStock;
      expect(stock.partnerIds, `${mpn}: 고객 응답에 조직 식별자가 있으면 안 된다`).toEqual([]);
    }

    const res = await api(admin(), 'GET', `/api/admin/bom-quotes/${quoteId}/partner-stock`);
    expect(res.status, JSON.stringify(res.json)).toBe(200);
    const holders = res.json.data.itemHolders as Record<string, any[]>;
    const heldItemIds = [...HELD, HELD_VIA_ALTERNATIVE].map((mpn) =>
      String(itemsByMpn.get(mpn.toUpperCase()).id));
    for (const itemId of heldItemIds) {
      expect(holders[itemId], `관리자에게는 보유 협력사가 보여야 한다 (item ${itemId})`).toBeDefined();
      expect(
        holders[itemId].map((holder: any) => holder.partnerName),
        `${itemId}: 이 스펙이 세운 협력사가 이름으로 잡혀야 한다`,
      ).toContain(PARTNER_NAME);
    }
    // 발송 모달용 역방향 색인 — 이 협력사가 몇 행을 가졌는지.
    // 대체 키로 걸린 행까지 포함해 여섯 — 발송 모달의 `보유 n행` 이 이 수를 쓴다.
    expect(res.json.data.partnerItems[String(num(partnerId))]).toHaveLength(heldItemIds.length);
  }, 120_000);

  test('후보 목록에 협력사가 뜨되 실공급사 앞을 가로채지 않는다', async () => {
    // 단종·희귀 행 — 협력사가 유일한 근거일 수 있는 자리.
    const rare = itemsByMpn.get('88PW886-B1-NFHIC000-T');
    const rareRes = await api(
      buyer(),
      'GET',
      `/api/bom/quotes/${quoteId}/items/${String(rare.id)}/candidates`,
    );
    expect(rareRes.status, JSON.stringify(rareRes.json)).toBe(200);
    const rareCandidates = rareRes.json.data.candidates as any[];
    const partnerRare = rareCandidates.filter((c) =>
      (c.corroboratingSuppliers as string[]).includes('partner'),
    );
    expect(partnerRare.length, '희귀 품번에서 협력사 후보가 잡혀야 한다').toBeGreaterThan(0);
    // 값은 RFQ 회신이 정본이다 — 재고표 단가를 구매 조건으로 만들지 않는다.
    for (const candidate of partnerRare) {
      expect(candidate.offers, '협력사 후보에는 구매 조건이 없어야 한다').toEqual([]);
      expect(candidate.selected, '가격이 없으니 자동 선정될 수 없다').toBe(false);
    }

    // 흔한 품번 — 실공급사가 잡힌다면 협력사는 그 뒤에 서야 한다.
    const common = itemsByMpn.get('MCP1700T-3302E/TT');
    const commonRes = await api(
      buyer(),
      'GET',
      `/api/bom/quotes/${quoteId}/items/${String(common.id)}/candidates`,
    );
    expect(commonRes.status).toBe(200);
    const commonCandidates = commonRes.json.data.candidates as any[];
    const realRanks = commonCandidates
      .filter((c) => (c.offers as any[]).length > 0)
      .map((c) => c.technicalRank as number);
    const partnerRanks = commonCandidates
      .filter((c) => (c.corroboratingSuppliers as string[]).includes('partner'))
      .map((c) => c.technicalRank as number);
    if (realRanks.length > 0 && partnerRanks.length > 0) {
      expect(
        Math.min(...partnerRanks),
        '협력사는 뒤순위 — 구매 조건이 있는 실공급사 후보보다 앞설 수 없다',
      ).toBeGreaterThan(Math.min(...realRanks));
    }
  }, 300_000);
});
