// Smart BOM 완주 여정 18호 — 고객 후보 비교·검토 선택·제외·복원.
//
// sp-engine이 저장한 자동·검토·차단 후보 스냅샷을 실 Node API와 고객 화면으로 읽어
// 표시 판정을 재구현하지 않고 그대로 비교한다. 검토 후보의 명시 확인, 선택 일시 실패
// 복구, 차단 후보 서버 방어, 같은 원본 행의 제외·복원, 키보드·모바일 경계를 UI/API/DB로
// 교차 검증한다. 후보 검색이나 공급사 실시간 호출은 사용하지 않는다.
// 실행: pnpm -F e2e journey:bom:18
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator, Page, Route } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  RUN,
  api,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPrisma,
  newSession,
  signJwt,
  type E2eSession,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const OWNER_ID = `e2e-bom-candidate-${RUN_KEY}`;
const OWNER = { mbId: OWNER_ID, mbNick: 'BOM 후보 비교 E2E 고객' };
const ORIGINAL_MPN = `E2E-ORIGINAL-${RUN_KEY}`;
const AUTO_MPN = 'GRM155R61H104KE14D';
const REVIEW_MPN = 'GRM155R71A104KA01D';
const BLOCKED_MPN = 'GRM155C81A225ME44D';
const NEEDED = 10;
const USD_KRW_RATE = 1_400;

interface CatalogPartFixture {
  partId: string;
  mpn: string;
  manufacturerName: string;
  description: string;
}

interface CandidateFixture extends CatalogPartFixture {
  candidateKey: string;
  offerKey: string;
  supplier: 'mouser' | 'digikey';
  supplierSku: string;
  unitPriceUsd: number;
  unitPriceKrw: number;
  lineTotalKrw: number;
  technicalRank: number;
  selectionEligibility: 'automatic' | 'manual_review' | 'blocked';
  manualSelectable: boolean;
}

interface SeededQuote {
  id: string;
  itemId: string;
  title: string;
  fileName: string;
  candidates: {
    automatic: CandidateFixture;
    review: CandidateFixture;
    blocked: CandidateFixture;
  };
}

async function mustReach(url: string, hint: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
  } catch (error) {
    throw new Error(
      `${url} 도달 실패 — ${hint} (${error instanceof Error ? error.message : String(error)})`,
    );
  }
}

async function catalogPart(mpn: string): Promise<CatalogPartFixture> {
  const part = await getPrisma().spPart.findFirst({
    where: { mpn, indexedAt: { not: null } },
    select: {
      id: true,
      mpn: true,
      manufacturerName: true,
      description: true,
    },
    orderBy: { id: 'asc' },
  });
  if (part === null || part.manufacturerName === null) {
    throw new Error(`${mpn} 색인 부품과 제조사 정본이 없습니다`);
  }
  return {
    partId: String(part.id),
    mpn: part.mpn,
    manufacturerName: part.manufacturerName,
    description: part.description ?? `${part.mpn} E2E 후보`,
  };
}

function offerDecision(
  candidate: CandidateFixture,
  recommendation: 'automatic' | 'manual_review' | 'none',
): Record<string, unknown> {
  return {
    procurement_policy_version: 'supplier-procurement-decision-v1',
    procurement_mode: 'sample',
    offer_key_version: 'supplier-offer-key-v2',
    rank_scope: 'identity_and_technical_evidence',
    offer_key: candidate.offerKey,
    calculation_status: 'calculated',
    required_quantity: NEEDED,
    order_quantity: NEEDED,
    applied_price_break_quantity: 1,
    source_unit_price: candidate.unitPriceUsd,
    source_currency: 'USD',
    exchange_rate: USD_KRW_RATE,
    target_currency: 'KRW',
    converted_unit_price: candidate.unitPriceKrw,
    line_total: candidate.lineTotalKrw,
    stock_short: false,
    stock_short_quantity: 0,
    surplus_quantity: 0,
    excessive_order: false,
    price_rank: 1,
    purchase_fit_rank: 1,
    purchasable: true,
    recommendation,
    reason_codes: [],
  };
}

function componentDecision(candidate: CandidateFixture): Record<string, unknown> {
  const automatic = candidate.selectionEligibility === 'automatic';
  const review = candidate.selectionEligibility === 'manual_review';
  return {
    procurement_policy_version: 'supplier-procurement-decision-v1',
    selection_application_policy_version: 'supplier-selection-application-v3',
    status: automatic
      ? 'automatic_recommended'
      : review
        ? 'review_recommended'
        : 'no_recommendation',
    selection_application_state: automatic
      ? 'automatic_selected'
      : review
        ? 'provisional_selected'
        : 'not_selected',
    confirmation_required: review,
    unavailability_reason_policy_version: 'supplier-procurement-unavailability-v1',
    primary_unavailability_reason: null,
    required_quantity: NEEDED,
    target_currency: 'KRW',
    currency_rate_snapshot_id: `e2e-journey-18-${RUN_KEY}`,
    currency_rate_as_of: '2026-08-11T09:00:00+09:00',
    currency_rate_source: 'e2e-fixture',
    technical_preselection_identity_key: candidate.candidateKey,
    technical_preselection_evidence_key: candidate.candidateKey.replace('ik1:', 'ek1:'),
    application_candidate_identity_key: candidate.manualSelectable ? candidate.candidateKey : null,
    application_candidate_evidence_key: candidate.manualSelectable
      ? candidate.candidateKey.replace('ik1:', 'ek1:')
      : null,
    technical_fallback_used: false,
    price_optimization_used: false,
    automatic_offer_key: automatic ? candidate.offerKey : null,
    review_offer_key: review ? candidate.offerKey : null,
    recommendation_reason_codes: automatic
      ? ['fixture-automatic']
      : review
        ? ['fixture-manual-review']
        : ['fixture-blocked'],
  };
}

function candidatePayload(
  candidate: CandidateFixture,
  sharedComponentDecision: Record<string, unknown>,
): Record<string, unknown> {
  const automatic = candidate.selectionEligibility === 'automatic';
  const review = candidate.selectionEligibility === 'manual_review';
  const blocked = candidate.selectionEligibility === 'blocked';
  const recommendation = automatic ? 'automatic' : review ? 'manual_review' : 'none';
  return {
    candidateKey: candidate.candidateKey,
    identityKey: candidate.candidateKey,
    technicalRank: candidate.technicalRank,
    technicalReviewRank: review ? 1 : null,
    selectionRecommendation: automatic ? 'preselect' : blocked ? 'exclude' : 'candidate_only',
    reviewRecommended: review,
    status: automatic ? 'verified_exact' : blocked ? 'conflict' : 'spec_compatible',
    selectionMode: automatic ? 'exact' : blocked ? 'review' : 'spec-compatible',
    safety: automatic ? 'safe' : blocked ? 'blocked' : 'caution',
    selectionEligibility: candidate.selectionEligibility,
    autoEligible: automatic,
    manualSelectable: candidate.manualSelectable,
    selectionReasonCodes: blocked
      ? ['identity_exact_requirement_conflict']
      : review
        ? ['verification_incomplete']
        : ['verified_exact'],
    mpn: candidate.mpn,
    manufacturerName: candidate.manufacturerName,
    description: candidate.description,
    category: 'capacitor',
    packageCode: '0402',
    lifecycleStatus: 'Active',
    lifecycleState: 'active',
    lifecycleCode: 'active',
    lastBuyDate: null,
    lifecycleSources: [
      {
        supplier: candidate.supplier,
        code: 'active',
        status: 'Active',
        lastBuyDate: null,
        fetchedAt: '2026-08-11T00:00:00.000Z',
      },
    ],
    replacementSources: [],
    replacementForMpn: null,
    replacementType: null,
    datasheetUrl: null,
    imageUrl: null,
    identityConfidence: automatic ? 1 : blocked ? 0.45 : 0.82,
    specificationConfidence: automatic ? 1 : blocked ? 0.3 : 0.74,
    conflicts: blocked ? ['package_mismatch'] : [],
    missingRequirements: review ? ['voltage_v'] : [],
    reasons: automatic
      ? ['품번과 제조사가 정확히 일치합니다.']
      : blocked
        ? ['원본 패키지와 후보 패키지가 충돌합니다.']
        : ['정격전압 확인이 필요합니다.'],
    corroboratingSuppliers: [candidate.supplier],
    verifiedRequirementCount: automatic ? 3 : 2,
    requiredRequirementCount: 3,
    requirementAssessments: [],
    verificationComplete: automatic,
    strictCategoryCoverage: automatic,
    technicalEvidenceKey: candidate.candidateKey.replace('ik1:', 'ek1:'),
    normalizedSpecs: { capacitance_f: 1e-7, package: '0402' },
    specComparisons: {},
    packageComparison: blocked ? { status: 'mismatch' } : { status: 'match' },
    offers: [
      {
        offerKey: candidate.offerKey,
        supplier: candidate.supplier,
        offerKind: 'supplier_offer',
        supplierSku: candidate.supplierSku,
        packaging: 'Cut Tape',
        stock: 5_000,
        moq: 1,
        orderMultiple: 1,
        productUrl: null,
        leadTime: null,
        fetchedAt: '2026-08-11T00:00:00.000Z',
        priceBreaks: [{ qty: 1, price: candidate.unitPriceUsd, currency: 'USD' }],
        procurementDecision: offerDecision(candidate, recommendation),
      },
    ],
    // 한 BOM 컴포넌트의 조달 결정은 모든 후보 스냅샷에서 동일해야 한다. 후보별 구매
    // 조건 결정만 달라지며, 공통 결정은 자동 선정 후보를 가리키는 엔진 원문이다.
    procurementDecision: sharedComponentDecision,
    engineCandidates: [],
    procurementDisposition: 'eligible',
    quantityResolution: 'verified',
    dispositionReasonCodes: [],
  };
}

function selectedOffer(candidate: CandidateFixture): Record<string, unknown> {
  return {
    offerKey: candidate.offerKey,
    supplier: candidate.supplier,
    supplierSku: candidate.supplierSku,
    packaging: 'Cut Tape',
    breakQty: 1,
    unitPrice: candidate.unitPriceUsd,
    currency: 'USD',
    unitPriceKrw: candidate.unitPriceKrw,
    moq: 1,
    orderMultiple: 1,
    stock: 5_000,
    priceBreaks: [{ qty: 1, price: candidate.unitPriceUsd }],
    fetchedAt: '2026-08-11T00:00:00.000Z',
    pinned: false,
  };
}

async function seedDraft(index: number, parts: CatalogPartFixture[]): Promise<SeededQuote> {
  const automaticPart = parts[0];
  const reviewPart = parts[1];
  const blockedPart = parts[2];
  if (automaticPart === undefined || reviewPart === undefined || blockedPart === undefined) {
    throw new Error('18호 후보 정본 3건이 없습니다');
  }
  const suffix = `${String(index)}-${RUN_KEY}`;
  const makeCandidate = (
    part: CatalogPartFixture,
    kind: 'auto' | 'review' | 'blocked',
    supplier: 'mouser' | 'digikey',
    unitPriceUsd: number,
    technicalRank: number,
    selectionEligibility: CandidateFixture['selectionEligibility'],
    manualSelectable: boolean,
  ): CandidateFixture => ({
    ...part,
    candidateKey: `ik1:e2e18-${kind}-${suffix}`,
    offerKey: `ok2:e2e18-${kind}-${suffix}`,
    supplier,
    supplierSku: `E2E18-${kind.toUpperCase()}-${String(index)}`,
    unitPriceUsd,
    unitPriceKrw: unitPriceUsd * USD_KRW_RATE,
    lineTotalKrw: unitPriceUsd * USD_KRW_RATE * NEEDED,
    technicalRank,
    selectionEligibility,
    manualSelectable,
  });
  const candidates = {
    automatic: makeCandidate(automaticPart, 'auto', 'mouser', 1, 1, 'automatic', true),
    review: makeCandidate(reviewPart, 'review', 'digikey', 0.8, 2, 'manual_review', true),
    blocked: makeCandidate(blockedPart, 'blocked', 'mouser', 0.7, 3, 'blocked', false),
  };
  const title = `[BOM 여정 18호] 후보 비교·선정 ${String(index)} ${RUN_KEY}`;
  const fileName = `bom-journey-18-${String(index)}-${RUN_KEY}.xlsx`;
  return getPrisma().$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId: OWNER_ID,
        title,
        fileName,
        sourceKind: 'upload',
        status: 'draft',
        buildStatus: 'ready',
        enrichStatus: 'idle',
        setQty: 1,
        spareQty: 0,
        itemsTotal: candidates.automatic.lineTotalKrw,
        shippingFee: 0,
        managementFee: 0,
        finalTotal: candidates.automatic.lineTotalKrw,
        usdKrwRateUsed: USD_KRW_RATE,
        uncostedCount: 0,
        customerMemo: '18호 고객 후보 비교·선정 E2E fixture',
        sheets: {
          create: {
            sheetIndex: 0,
            sheetName: 'BOM',
            status: 'parsed',
            componentCount: 1,
            selected: true,
          },
        },
      },
    });
    const item = await tx.spBomQuoteItem.create({
      data: {
        quoteId: quote.id,
        rowIdx: 0,
        included: true,
        mpn: candidates.automatic.mpn,
        manufacturerName: candidates.automatic.manufacturerName,
        description: candidates.automatic.description,
        bomQty: NEEDED,
        orderQty: NEEDED,
        matchStatus: 'auto',
        recommendedCandidateKey: candidates.automatic.candidateKey,
        selectedCandidateKey: candidates.automatic.candidateKey,
        selectionSource: 'auto',
        partId: BigInt(candidates.automatic.partId),
        selectedOffer: selectedOffer(candidates.automatic),
        lineTotalKrw: candidates.automatic.lineTotalKrw,
        sourceRow: {
          inputPartNumber: ORIGINAL_MPN,
          inputManufacturer: 'E2E Original Components',
          valueRaw: '100nF',
          packageCode: '0402',
          sourceRows: [2],
          referenceDesignators: ['C1'],
          quantityConfirmed: true,
          procurementDisposition: 'included',
        },
        sourceSheetIndex: 0,
        sourceSheetName: 'BOM',
      },
    });
    const sharedComponentDecision = componentDecision(candidates.automatic);
    for (const candidate of Object.values(candidates)) {
      const payload = candidatePayload(candidate, sharedComponentDecision);
      await tx.spBomQuoteCandidate.create({
        data: {
          quoteId: quote.id,
          quoteItemId: item.id,
          candidateKey: candidate.candidateKey,
          technicalRank: candidate.technicalRank,
          status: payload.status,
          selectionMode: payload.selectionMode,
          safety: payload.safety,
          autoEligible: candidate.selectionEligibility === 'automatic',
          mpn: candidate.mpn,
          manufacturerName: candidate.manufacturerName,
          payload,
        },
      });
    }
    return {
      id: String(quote.id),
      itemId: String(item.id),
      title,
      fileName,
      candidates,
    };
  });
}

async function createCustomer(label: string): Promise<E2eSession> {
  const session = await newSession(OWNER);
  session.page.setDefaultTimeout(30_000);
  sessions.push(session);
  rp.watchHttp(session, label);
  return session;
}

async function openQuote(page: Page, quote: SeededQuote): Promise<void> {
  await page.goto(`${BASE_URL}/app/bom/${quote.id}`, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('heading', { name: quote.fileName, exact: true })
    .waitFor({ state: 'visible' });
  await page.getByText(quote.candidates.automatic.mpn, { exact: true }).first().waitFor({
    state: 'visible',
  });
}

async function openCandidates(
  page: Page,
  quote: SeededQuote,
): Promise<{
  trigger: Locator;
  dialog: Locator;
}> {
  const trigger = page.getByRole('button', { name: '후보 비교', exact: true }).first();
  const responseWait = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      response.url().endsWith(`/api/bom/quotes/${quote.id}/items/${quote.itemId}/candidates`),
  );
  await trigger.click();
  expect((await responseWait).status(), '후보 스냅샷 조회').toBe(200);
  const dialog = page.getByRole('dialog', { name: '부품 선택', exact: true });
  await dialog.waitFor({ state: 'visible' });
  return { trigger, dialog };
}

function candidateCard(dialog: Locator, mpn: string): Locator {
  return dialog.locator('article').filter({ hasText: mpn }).first();
}

async function itemSnapshot(quote: SeededQuote): Promise<any> {
  const item = await getPrisma().spBomQuoteItem.findUnique({
    where: { id: BigInt(quote.itemId) },
    select: {
      id: true,
      included: true,
      mpn: true,
      partId: true,
      selectedCandidateKey: true,
      selectedOffer: true,
      orderQty: true,
      lineTotalKrw: true,
    },
  });
  if (item === null) throw new Error(`18호 견적 ${quote.id} 품목이 없습니다`);
  return item;
}

async function eventCount(quote: SeededQuote): Promise<number> {
  return getPrisma().spBomQuoteSelectionEvent.count({
    where: { quoteId: BigInt(quote.id), quoteItemId: BigInt(quote.itemId) },
  });
}

function transientFailure(route: Route): Promise<void> {
  return route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      result: false,
      error: 'E2E_TRANSIENT',
      message: '일시적인 연결 문제입니다. 다시 시도해 주세요.',
    }),
  });
}

const rp = createJourneyReport(
  'findings-bom-candidate-selection',
  'BOM 여정 18호 고객 후보 비교·검토 선택·제외 복원 탐색 주행 리포트',
);
const { F, ledger } = rp;
const sessions: E2eSession[] = [];
const quotes: SeededQuote[] = [];

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 18호 — 고객 후보 비교·검토 선택·제외·복원', () => {
  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    const parts = await Promise.all([
      catalogPart(AUTO_MPN),
      catalogPart(REVIEW_MPN),
      catalogPart(BLOCKED_MPN),
    ]);
    for (let index = 1; index <= 6; index += 1) quotes.push(await seedDraft(index, parts));
    for (const quote of quotes) {
      ledger.push(`sp_bom_quote #${quote.id}(${quote.title}, 종료 시 fixture 정리)`);
    }
  }, 180_000);

  afterAll(async () => {
    rp.write(
      Object.fromEntries(sessions.map((session, index) => [`고객${String(index + 1)}`, session])),
    );
    for (const session of sessions) await session.close().catch(() => undefined);
    await getPrisma().spBomQuote.deleteMany({ where: { mbId: OWNER_ID } });
    expect(
      await getPrisma().spBomQuote.count({ where: { mbId: OWNER_ID } }),
      '18호 견적 잔재',
    ).toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('O01. 후보 드로어: 초기 초점·배경 잠금·Tab 순환·Esc·트리거 복귀', async () => {
    const quote = quotes[0];
    if (quote === undefined) throw new Error('18호 O01 fixture가 없습니다');
    const customer = await createCustomer('후보 드로어 키보드 고객');
    const page = customer.page;
    await openQuote(page, quote);
    const previousOverflow = await page.evaluate(() => document.body.style.overflow);
    const { trigger, dialog } = await openCandidates(page, quote);
    const closeButton = dialog.getByRole('button', { name: '후보 패널 닫기', exact: true });
    expect
      .soft(
        await closeButton.evaluate((button) => document.activeElement === button),
        '후보 패널을 열면 닫기 버튼에 초기 초점',
      )
      .toBe(true);
    expect
      .soft(await page.evaluate(() => document.body.style.overflow), '후보 패널 배경 스크롤 잠금')
      .toBe('hidden');

    await dialog.evaluate((root) => {
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0);
      focusable.at(-1)?.focus();
    });
    await page.keyboard.press('Tab');
    expect
      .soft(
        await dialog.evaluate((root) => root.contains(document.activeElement)),
        'Tab 초점이 후보 패널 안에 순환',
      )
      .toBe(true);

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect
      .soft(
        await page.evaluate(() => document.body.style.overflow),
        '후보 패널 닫은 뒤 스크롤 복원',
      )
      .toBe(previousOverflow);
    await expect
      .poll(async () => trigger.evaluate((button) => document.activeElement === button), {
        timeout: 2_000,
        message: '후보 패널 닫은 뒤 후보 비교 버튼 초점 복귀',
      })
      .toBe(true);
    F('O01', 'obs', '후보 드로어의 초기 초점·스크롤·Tab·Esc·호출 버튼 복귀 확인');
    expect(customer.pageErrors, 'O01 pageerror').toEqual([]);
  }, 120_000);

  test('O02. 엔진 판정 표시와 차단 후보: 자동·검토·선택 불가를 구분하고 API도 거부', async () => {
    const quote = quotes[1];
    if (quote === undefined) throw new Error('18호 O02 fixture가 없습니다');
    const customer = await createCustomer('후보 판정 고객');
    const page = customer.page;
    await openQuote(page, quote);
    const { dialog } = await openCandidates(page, quote);
    const automatic = candidateCard(dialog, quote.candidates.automatic.mpn);
    const review = candidateCard(dialog, quote.candidates.review.mpn);
    expect
      .soft(await automatic.getByText('현재 선택', { exact: true }).count(), '현재 선택 배지')
      .toBe(1);
    expect
      .soft(
        await automatic.getByRole('button', { name: '현재 구매 조건', exact: true }).isDisabled(),
        '현재 구매 조건 중복 선택 차단',
      )
      .toBe(true);
    expect
      .soft(
        await review.getByRole('button', { name: '검토 후 선택', exact: true }).count(),
        '검토 후보 행동',
      )
      .toBe(1);
    expect
      .soft(await review.getByText(/정격전압/).count(), '검토 후보 누락 근거')
      .toBeGreaterThan(0);

    await dialog.getByRole('button', { name: '전체 3', exact: true }).click();
    const blocked = candidateCard(dialog, quote.candidates.blocked.mpn);
    const blockedAction = blocked.getByRole('button', { name: '선택 불가', exact: true });
    expect.soft(await blockedAction.isDisabled(), '차단 후보 UI 선택 불가').toBe(true);
    expect
      .soft(await blocked.getByText(/패키지 불일치/).count(), '차단 근거 표시')
      .toBeGreaterThan(0);

    const before = await itemSnapshot(quote);
    const blockedResponse = await api(
      signJwt(OWNER),
      'POST',
      `/api/bom/quotes/${quote.id}/items/${quote.itemId}/selection`,
      {
        candidateKey: quote.candidates.blocked.candidateKey,
        offerKey: quote.candidates.blocked.offerKey,
      },
    );
    expect.soft(blockedResponse.status, '차단 후보 직접 API').toBe(409);
    expect.soft(blockedResponse.json?.error, '차단 후보 오류 코드').toBe('CANDIDATE_BLOCKED');
    const after = await itemSnapshot(quote);
    expect.soft(after.selectedCandidateKey, '차단 뒤 선정 유지').toBe(before.selectedCandidateKey);
    expect.soft(after.mpn, '차단 뒤 MPN 유지').toBe(before.mpn);
    expect(await eventCount(quote), '차단 시 선택 이력 없음').toBe(0);
    await rp.shot(customer, 'O02-candidate-engine-boundaries');
    F('O02', 'obs', '엔진 automatic/manual_review/blocked 판정 표시와 서버 차단을 교차 확인');
    expect(customer.pageErrors, 'O02 pageerror').toEqual([]);
  }, 120_000);

  test('O03. 검토 후보 확인창: 중첩 초점·Esc 복귀 후 명시 선택과 이력 저장', async () => {
    const quote = quotes[2];
    if (quote === undefined) throw new Error('18호 O03 fixture가 없습니다');
    const customer = await createCustomer('검토 후보 선택 고객');
    const page = customer.page;
    await openQuote(page, quote);
    const { trigger, dialog } = await openCandidates(page, quote);
    const reviewCard = candidateCard(dialog, quote.candidates.review.mpn);
    const reviewAction = reviewCard.getByRole('button', { name: '검토 후 선택', exact: true });
    await reviewAction.click();
    let confirmation = page.getByRole('dialog', { name: '검토 후보를 선택할까요?', exact: true });
    await confirmation.waitFor({ state: 'visible' });
    const confirmationClose = confirmation.getByRole('button', {
      name: '선택 확인창 닫기',
      exact: true,
    });
    expect
      .soft(
        await confirmationClose.evaluate((button) => document.activeElement === button),
        '검토 확인창 초기 초점',
      )
      .toBe(true);
    await confirmation.evaluate((root) => {
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.getClientRects().length > 0);
      focusable.at(-1)?.focus();
    });
    await page.keyboard.press('Tab');
    expect
      .soft(
        await confirmation.evaluate((root) => root.contains(document.activeElement)),
        '검토 확인창 안에서 Tab 순환',
      )
      .toBe(true);

    await page.keyboard.press('Escape');
    await confirmation.waitFor({ state: 'hidden' });
    expect.soft(await dialog.isVisible(), 'Esc는 검토 확인창만 닫음').toBe(true);
    expect
      .soft(
        await reviewAction.evaluate((button) => document.activeElement === button),
        '검토 확인창 닫은 뒤 선택 버튼 초점 복귀',
      )
      .toBe(true);

    await reviewAction.click();
    confirmation = page.getByRole('dialog', { name: '검토 후보를 선택할까요?', exact: true });
    await confirmation.waitFor({ state: 'visible' });
    const responseWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}/items/${quote.itemId}/selection`),
    );
    await confirmation.getByRole('button', { name: '확인 후 선택', exact: true }).click();
    expect((await responseWait).status(), '검토 후보 명시 선택').toBe(200);
    await dialog.waitFor({ state: 'hidden' });
    await expect
      .poll(async () => trigger.evaluate((button) => document.activeElement === button), {
        timeout: 2_000,
        message: '선택 성공 뒤 후보 비교 버튼 초점 복귀',
      })
      .toBe(true);

    const selected = await itemSnapshot(quote);
    expect.soft(String(selected.id), '같은 원본 행 ID').toBe(quote.itemId);
    expect
      .soft(selected.selectedCandidateKey, '검토 후보 키 저장')
      .toBe(quote.candidates.review.candidateKey);
    expect.soft(selected.mpn, '검토 후보 MPN 저장').toBe(quote.candidates.review.mpn);
    expect
      .soft(String(selected.partId), '서버 카탈로그 partId 해소')
      .toBe(quote.candidates.review.partId);
    const savedOffer = selected.selectedOffer as any;
    expect.soft(savedOffer?.offerKey, '서버 선택 구매 조건').toBe(quote.candidates.review.offerKey);
    expect
      .soft(Number(selected.lineTotalKrw), '현재 서버 환율로 다시 계산한 행 합계')
      .toBeCloseTo(Number(savedOffer?.unitPriceKrw) * selected.orderQty, 2);
    const event = await getPrisma().spBomQuoteSelectionEvent.findFirst({
      where: { quoteId: BigInt(quote.id), quoteItemId: BigInt(quote.itemId) },
      orderBy: { id: 'desc' },
    });
    expect.soft(event?.source, '고객 선택 이력 주체').toBe('customer');
    expect
      .soft(event?.previousCandidateKey, '이전 후보 이력')
      .toBe(quote.candidates.automatic.candidateKey);
    expect
      .soft(event?.selectedCandidateKey, '새 후보 이력')
      .toBe(quote.candidates.review.candidateKey);
    F('O03', 'obs', '검토 후보 중첩 확인 후 같은 행에 서버 계산값과 고객 선택 이력 저장');
    expect(customer.pageErrors, 'O03 pageerror').toEqual([]);
  }, 120_000);

  test('O04. 후보 선택 POST 503: 패널 유지·오류 초점·DB 불변·같은 자리 재시도', async () => {
    const quote = quotes[3];
    if (quote === undefined) throw new Error('18호 O04 fixture가 없습니다');
    const customer = await createCustomer('후보 선택 실패 복구 고객');
    const page = customer.page;
    await openQuote(page, quote);
    const { dialog } = await openCandidates(page, quote);
    const reviewAction = candidateCard(dialog, quote.candidates.review.mpn).getByRole('button', {
      name: '검토 후 선택',
      exact: true,
    });
    const pattern = `**/api/bom/quotes/${quote.id}/items/${quote.itemId}/selection`;
    const failHandler = (route: Route): Promise<void> => transientFailure(route);
    await page.route(pattern, failHandler);
    await reviewAction.click();
    let confirmation = page.getByRole('dialog', { name: '검토 후보를 선택할까요?', exact: true });
    await confirmation.getByRole('button', { name: '확인 후 선택', exact: true }).click();
    const alert = dialog.getByRole('alert').filter({ hasText: '후보 선택을 적용하지 못했습니다' });
    await alert.waitFor({ state: 'visible' });
    expect.soft(await dialog.isVisible(), '선택 실패 뒤 후보 패널 유지').toBe(true);
    expect
      .soft(
        await alert.evaluate((element) => document.activeElement === element),
        '선택 실패 안내로 초점 이동',
      )
      .toBe(true);
    let saved = await itemSnapshot(quote);
    expect
      .soft(saved.selectedCandidateKey, '실패 뒤 기존 후보 유지')
      .toBe(quote.candidates.automatic.candidateKey);
    expect.soft(saved.mpn, '실패 뒤 기존 MPN 유지').toBe(quote.candidates.automatic.mpn);
    expect(await eventCount(quote), '실패 선택 이력 없음').toBe(0);
    await rp.shot(customer, 'O04-candidate-selection-error');

    await page.unroute(pattern, failHandler);
    await reviewAction.click();
    confirmation = page.getByRole('dialog', { name: '검토 후보를 선택할까요?', exact: true });
    const responseWait = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}/items/${quote.itemId}/selection`),
    );
    await confirmation.getByRole('button', { name: '확인 후 선택', exact: true }).click();
    expect((await responseWait).status(), '후보 선택 재시도').toBe(200);
    await dialog.waitFor({ state: 'hidden' });
    saved = await itemSnapshot(quote);
    expect
      .soft(saved.selectedCandidateKey, '재시도 후보 저장')
      .toBe(quote.candidates.review.candidateKey);
    expect(await eventCount(quote), '성공 선택 이력 1건').toBe(1);
    F('O04', 'obs', '선택 일시 실패에 원장을 보존하고 같은 패널·후보에서 재시도 성공');
    expect(customer.pageErrors, 'O04 pageerror').toEqual([]);
  }, 120_000);

  test('O05. 원본 행 제외·복원: 합계 대상만 바꾸고 후보·선정·안정 ID를 보존', async () => {
    const quote = quotes[4];
    if (quote === undefined) throw new Error('18호 O05 fixture가 없습니다');
    const customer = await createCustomer('후보 행 제외 복원 고객');
    const page = customer.page;
    await openQuote(page, quote);
    const row = page.locator('tr').filter({ hasText: quote.candidates.automatic.mpn }).first();
    const excludeResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}`),
    );
    await row.getByRole('button', { name: '제외', exact: true }).click();
    expect((await excludeResponse).status(), '행 제외 자동저장').toBe(200);
    let saved = await itemSnapshot(quote);
    expect.soft(saved.included, 'DB 제외').toBe(false);
    expect.soft(String(saved.id), '제외 뒤 안정 ID').toBe(quote.itemId);
    expect
      .soft(saved.selectedCandidateKey, '제외 뒤 선정 후보 보존')
      .toBe(quote.candidates.automatic.candidateKey);
    expect.soft(saved.mpn, '제외 뒤 MPN 보존').toBe(quote.candidates.automatic.mpn);
    expect(
      await getPrisma().spBomQuoteCandidate.count({ where: { quoteItemId: BigInt(quote.itemId) } }),
      '제외 뒤 후보 스냅샷 보존',
    ).toBe(3);

    const restoreResponse = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' &&
        response.url().endsWith(`/api/bom/quotes/${quote.id}`),
    );
    await row.getByRole('button', { name: '복원', exact: true }).click();
    expect((await restoreResponse).status(), '행 복원 자동저장').toBe(200);
    saved = await itemSnapshot(quote);
    expect.soft(saved.included, 'DB 복원').toBe(true);
    expect.soft(String(saved.id), '복원 뒤 안정 ID').toBe(quote.itemId);
    expect
      .soft(saved.selectedCandidateKey, '복원 뒤 선정 후보 보존')
      .toBe(quote.candidates.automatic.candidateKey);
    expect(await eventCount(quote), '제외·복원은 후보 선택 이력을 만들지 않음').toBe(0);
    F('O05', 'obs', '원본 행 제외·복원은 견적 포함 상태만 바꾸고 후보·선정 정체성을 보존');
    expect(customer.pageErrors, 'O05 pageerror').toEqual([]);
  }, 120_000);

  test('O06. 390px 후보 비교: 행 액션·드로어·검토 확인창이 화면 안에 표시', async () => {
    const quote = quotes[5];
    if (quote === undefined) throw new Error('18호 O06 fixture가 없습니다');
    const customer = await createCustomer('모바일 후보 비교 고객');
    const page = customer.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuote(page, quote);
    const trigger = page.getByRole('button', { name: '후보 비교', exact: true }).first();
    const triggerBox = await trigger.boundingBox();
    expect.soft(triggerBox, '모바일 후보 비교 버튼 위치').not.toBeNull();
    if (triggerBox !== null) {
      expect
        .soft(
          triggerBox.x >= 0 && triggerBox.x + triggerBox.width <= 390,
          '가로 이동 전 후보 비교 인지 가능',
        )
        .toBe(true);
    }
    const { dialog } = await openCandidates(page, quote);
    const dialogBox = await dialog.boundingBox();
    expect.soft(dialogBox, '모바일 후보 드로어 위치').not.toBeNull();
    if (dialogBox !== null) {
      expect
        .soft(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 390, '후보 드로어 가로 경계')
        .toBe(true);
      expect
        .soft(dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 844, '후보 드로어 세로 경계')
        .toBe(true);
    }
    expect
      .soft(
        await dialog.evaluate((root) => root.scrollWidth <= root.clientWidth + 1),
        '후보 드로어 자체 가로 넘침 없음',
      )
      .toBe(true);
    const reviewAction = candidateCard(dialog, quote.candidates.review.mpn).getByRole('button', {
      name: '검토 후 선택',
      exact: true,
    });
    await reviewAction.scrollIntoViewIfNeeded();
    const actionBox = await reviewAction.boundingBox();
    expect.soft(actionBox, '모바일 검토 후보 행동 위치').not.toBeNull();
    if (actionBox !== null) {
      expect
        .soft(actionBox.x >= 0 && actionBox.x + actionBox.width <= 390, '검토 행동 가로 경계')
        .toBe(true);
    }
    await rp.shot(customer, 'O06-mobile-candidate-drawer');
    await reviewAction.click();
    const confirmation = page.getByRole('dialog', { name: '검토 후보를 선택할까요?', exact: true });
    const confirmationBox = await confirmation.boundingBox();
    expect.soft(confirmationBox, '모바일 검토 확인창 위치').not.toBeNull();
    if (confirmationBox !== null) {
      expect
        .soft(
          confirmationBox.x >= 0 && confirmationBox.x + confirmationBox.width <= 390,
          '검토 확인창 가로 경계',
        )
        .toBe(true);
      expect
        .soft(
          confirmationBox.y >= 0 && confirmationBox.y + confirmationBox.height <= 844,
          '검토 확인창 세로 경계',
        )
        .toBe(true);
    }
    await rp.shot(customer, 'O06-mobile-review-confirmation');
    F('O06', 'obs', '390px 행 액션과 후보·검토 레이어의 화면 경계 확인');
    expect(customer.pageErrors, 'O06 pageerror').toEqual([]);
  }, 120_000);
});
