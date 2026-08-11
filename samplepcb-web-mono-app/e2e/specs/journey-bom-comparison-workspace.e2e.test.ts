// Smart BOM 완주 여정 19호 — 고객 전체 BOM 비교·필터·오류 복구·모바일 열 탐색.
//
// sp-engine 인메모리 잡 없이 sp-node에 박제된 분석 원문과 후보 스냅샷만으로 비교 화면을
// 재구성한다. 페이지·검색·판정·시트 필터, 선택 제외 시트와 직접 추가 행의 범위, 503 복구,
// 닫았다 다시 연 상태의 정합, 키보드·390px 가로 열 경계를 실 UI/API/DB로 교차 검증한다.
// 실행: pnpm -F e2e journey:bom:19
/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { Locator, Page, Response, Route } from 'playwright-core';
import {
  API_URL,
  BASE_URL,
  RUN,
  closeBrowser,
  createJourneyReport,
  disconnectPrisma,
  getPrisma,
  newSession,
  type E2eSession,
} from '../helpers';

const JOURNEY = process.env.JOURNEY === '1';
const RUN_KEY = String(Date.now());
const OWNER_ID = `e2e-bom-comparison-${RUN_KEY}`;
const OWNER = { mbId: OWNER_ID, mbNick: 'BOM 전체 비교 E2E 고객' };
const QUANTITY = 10;

type ComparisonCategory = 'matched' | 'attention' | 'not_found';
type Supplier = 'mouser' | 'digikey' | 'unikeyic';

interface LinePlan {
  key: string;
  mpn: string;
  manufacturer: string;
  description: string;
  sheetIndex: number | null;
  sheetName: string | null;
  category: ComparisonCategory;
  componentStatus: 'verified_exact' | 'input_conflict' | 'not_found';
  supplier: Supplier | null;
  refs: string[];
}

interface SeededQuote {
  id: string;
  title: string;
  fileName: string;
  itemIds: Record<string, string>;
}

const LINES: readonly LinePlan[] = [
  {
    key: 'match-alpha',
    mpn: `E2E19-MATCH-ALPHA-${RUN_KEY}`,
    manufacturer: 'Alpha Components',
    description: 'Sheet A exact capacitor',
    sheetIndex: 0,
    sheetName: 'Sheet-A',
    category: 'matched',
    componentStatus: 'verified_exact',
    supplier: 'mouser',
    refs: ['C1'],
  },
  {
    key: 'attention-beta',
    mpn: `E2E19-ATTENTION-BETA-${RUN_KEY}`,
    manufacturer: 'Beta Components',
    description: 'Sheet A package conflict',
    sheetIndex: 0,
    sheetName: 'Sheet-A',
    category: 'attention',
    componentStatus: 'input_conflict',
    supplier: 'digikey',
    refs: ['R1'],
  },
  {
    key: 'missing-gamma',
    mpn: `E2E19-MISSING-GAMMA-${RUN_KEY}`,
    manufacturer: 'Gamma Components',
    description: 'Sheet A no supplier candidate',
    sheetIndex: 0,
    sheetName: 'Sheet-A',
    category: 'not_found',
    componentStatus: 'not_found',
    supplier: null,
    refs: ['U1'],
  },
  {
    key: 'match-delta',
    mpn: `E2E19-MATCH-DELTA-${RUN_KEY}`,
    manufacturer: 'Delta Components',
    description: 'Sheet A exact connector',
    sheetIndex: 0,
    sheetName: 'Sheet-A',
    category: 'matched',
    componentStatus: 'verified_exact',
    supplier: 'unikeyic',
    refs: ['J1'],
  },
  {
    key: 'attention-epsilon',
    mpn: `E2E19-ATTENTION-EPSILON-${RUN_KEY}`,
    manufacturer: 'Epsilon Components',
    description: 'Sheet A voltage review',
    sheetIndex: 0,
    sheetName: 'Sheet-A',
    category: 'attention',
    componentStatus: 'input_conflict',
    supplier: 'mouser',
    refs: ['C2'],
  },
  {
    key: 'missing-zeta',
    mpn: `E2E19-MISSING-ZETA-${RUN_KEY}`,
    manufacturer: 'Zeta Components',
    description: 'Sheet B no supplier candidate',
    sheetIndex: 1,
    sheetName: 'Sheet-B',
    category: 'not_found',
    componentStatus: 'not_found',
    supplier: null,
    refs: ['L1'],
  },
  {
    key: 'match-eta',
    mpn: `E2E19-MATCH-ETA-${RUN_KEY}`,
    manufacturer: 'Eta Components',
    description: 'Sheet B exact diode',
    sheetIndex: 1,
    sheetName: 'Sheet-B',
    category: 'matched',
    componentStatus: 'verified_exact',
    supplier: 'digikey',
    refs: ['D1'],
  },
  {
    key: 'manual-theta',
    mpn: `E2E19-MANUAL-THETA-${RUN_KEY}`,
    manufacturer: 'Theta Components',
    description: 'UNIQUE-MANUAL-THETA directly added line',
    sheetIndex: null,
    sheetName: null,
    category: 'matched',
    componentStatus: 'verified_exact',
    supplier: 'mouser',
    refs: ['직접 추가'],
  },
  {
    key: 'hidden-iota',
    mpn: `E2E19-HIDDEN-IOTA-${RUN_KEY}`,
    manufacturer: 'Iota Components',
    description: 'Excluded source sheet line',
    sheetIndex: 2,
    sheetName: 'Sheet-Hidden',
    category: 'matched',
    componentStatus: 'verified_exact',
    supplier: 'unikeyic',
    refs: ['Q1'],
  },
] as const;

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

function candidatePayload(line: LinePlan, rowIdx: number): Record<string, unknown> {
  if (line.supplier === null) throw new Error(`${line.key}에는 후보 공급사가 없습니다`);
  const review = line.category === 'attention';
  const candidateKey = `ik1:e2e19-${line.key}-${RUN_KEY}`;
  const offerKey = `ok2:e2e19-${line.key}-${RUN_KEY}`;
  const unitPrice = 100 + rowIdx * 10;
  const lineTotal = unitPrice * QUANTITY;
  return {
    candidateKey,
    identityKey: candidateKey,
    technicalRank: 1,
    technicalReviewRank: review ? 1 : null,
    selectionRecommendation: review ? 'candidate_only' : 'preselect',
    reviewRecommended: review,
    status: line.componentStatus,
    selectionMode: review ? 'review' : 'exact',
    safety: review ? 'caution' : 'safe',
    selectionEligibility: review ? 'manual_review' : 'automatic',
    autoEligible: !review,
    manualSelectable: true,
    selectionReasonCodes: review ? ['fixture-input-conflict'] : ['fixture-verified-exact'],
    mpn: `${line.mpn}-CANDIDATE`,
    manufacturerName: line.manufacturer,
    description: `${line.description} supplier snapshot`,
    category: 'capacitor',
    packageCode: review ? '0603' : '0402',
    lifecycleStatus: 'Active',
    lifecycleState: 'active',
    lifecycleCode: 'active',
    lastBuyDate: null,
    lifecycleSources: [
      {
        supplier: line.supplier,
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
    identityConfidence: review ? 0.75 : 1,
    specificationConfidence: review ? 0.65 : 1,
    conflicts: review ? ['package_mismatch'] : [],
    missingRequirements: review ? ['voltage_v'] : [],
    reasons: review
      ? ['원본 패키지와 후보 패키지를 확인해야 합니다.']
      : ['품번과 제조사가 일치합니다.'],
    corroboratingSuppliers: [line.supplier],
    verifiedRequirementCount: review ? 2 : 3,
    requiredRequirementCount: 3,
    requirementAssessments: [],
    verificationComplete: !review,
    strictCategoryCoverage: !review,
    technicalEvidenceKey: candidateKey.replace('ik1:', 'ek1:'),
    normalizedSpecs: {
      capacitance_f: review ? 0.000001 : 1e-7,
      package: review ? '0603' : '0402',
      voltage_v: review ? null : 50,
    },
    specComparisons: {
      capacitance_f: {
        state: review ? 'mismatch' : 'match',
        expected_display: '100 nF',
        actual_display: review ? '1 µF' : '100 nF',
      },
      voltage_v: {
        state: review ? 'missing' : 'match',
        expected_display: '50 V',
        actual_display: review ? null : '50 V',
      },
    },
    packageComparison: {
      state: review ? 'mismatch' : 'match',
      expected_display: '0402',
      actual_display: review ? '0603' : '0402',
    },
    offers: [
      {
        offerKey,
        supplier: line.supplier,
        offerKind: 'supplier_offer',
        supplierSku: `E2E19-${line.key.toUpperCase()}`,
        packaging: 'Cut Tape',
        stock: 5_000,
        moq: 1,
        orderMultiple: 1,
        productUrl: null,
        leadTime: null,
        fetchedAt: '2026-08-11T00:00:00.000Z',
        priceBreaks: [{ qty: 1, price: unitPrice, currency: 'KRW' }],
        procurementDecision: {
          procurement_policy_version: 'supplier-procurement-decision-v1',
          procurement_mode: 'sample',
          offer_key_version: 'supplier-offer-key-v2',
          rank_scope: 'identity_and_technical_evidence',
          offer_key: offerKey,
          calculation_status: 'calculated',
          required_quantity: QUANTITY,
          order_quantity: QUANTITY,
          applied_price_break_quantity: 1,
          source_unit_price: unitPrice,
          source_currency: 'KRW',
          exchange_rate: 1,
          target_currency: 'KRW',
          converted_unit_price: unitPrice,
          line_total: lineTotal,
          stock_short: false,
          stock_short_quantity: 0,
          surplus_quantity: 0,
          excessive_order: false,
          price_rank: 1,
          purchase_fit_rank: 1,
          purchasable: true,
          recommendation: review ? 'manual_review' : 'automatic',
          reason_codes: [],
        },
      },
    ],
    procurementDecision: {
      procurement_policy_version: 'supplier-procurement-decision-v1',
      selection_application_policy_version: 'supplier-selection-application-v3',
      status: review ? 'review_recommended' : 'automatic_recommended',
      selection_application_state: review ? 'provisional_selected' : 'automatic_selected',
      confirmation_required: review,
      unavailability_reason_policy_version: 'supplier-procurement-unavailability-v1',
      primary_unavailability_reason: null,
      required_quantity: QUANTITY,
      target_currency: 'KRW',
      currency_rate_snapshot_id: `e2e-journey-19-${RUN_KEY}`,
      currency_rate_as_of: '2026-08-11T00:00:00.000Z',
      currency_rate_source: 'e2e-fixture',
      technical_preselection_identity_key: candidateKey,
      technical_preselection_evidence_key: candidateKey.replace('ik1:', 'ek1:'),
      application_candidate_identity_key: candidateKey,
      application_candidate_evidence_key: candidateKey.replace('ik1:', 'ek1:'),
      technical_fallback_used: false,
      price_optimization_used: false,
      automatic_offer_key: review ? null : offerKey,
      review_offer_key: review ? offerKey : null,
      recommendation_reason_codes: [review ? 'fixture-review' : 'fixture-automatic'],
    },
    engineCandidates: [],
    procurementDisposition: 'eligible',
    quantityResolution: 'verified',
    dispositionReasonCodes: [],
  };
}

function selectedOffer(line: LinePlan, rowIdx: number): Record<string, unknown> | null {
  if (line.supplier === null) return null;
  const unitPrice = 100 + rowIdx * 10;
  return {
    offerKey: `ok2:e2e19-${line.key}-${RUN_KEY}`,
    supplier: line.supplier,
    supplierSku: `E2E19-${line.key.toUpperCase()}`,
    packaging: 'Cut Tape',
    breakQty: 1,
    unitPrice,
    currency: 'KRW',
    unitPriceKrw: unitPrice,
    moq: 1,
    orderMultiple: 1,
    stock: 5_000,
    priceBreaks: [{ qty: 1, price: unitPrice }],
    fetchedAt: '2026-08-11T00:00:00.000Z',
    pinned: false,
  };
}

async function seedQuote(): Promise<SeededQuote> {
  const title = `[BOM 여정 19호] 전체 비교 ${RUN_KEY}`;
  const fileName = `bom-journey-19-${RUN_KEY}.xlsx`;
  return getPrisma().$transaction(async (tx: any) => {
    const quote = await tx.spBomQuote.create({
      data: {
        mbId: OWNER_ID,
        title,
        fileName,
        sourceKind: 'upload',
        status: 'draft',
        buildStatus: 'ready',
        enrichStatus: 'done',
        engineJobId: `expired-engine-job-${RUN_KEY}`,
        setQty: 1,
        spareQty: 0,
        itemsTotal: 8_800,
        shippingFee: 0,
        managementFee: 0,
        finalTotal: 8_800,
        usdKrwRateUsed: 1_400,
        uncostedCount: 2,
        customerMemo: '19호 전체 BOM 비교 E2E fixture',
        sheets: {
          create: [
            {
              sheetIndex: 0,
              sheetName: 'Sheet-A',
              status: 'parsed',
              componentCount: 5,
              selected: true,
            },
            {
              sheetIndex: 1,
              sheetName: 'Sheet-B',
              status: 'parsed',
              componentCount: 2,
              selected: true,
            },
            {
              sheetIndex: 2,
              sheetName: 'Sheet-Hidden',
              status: 'parsed',
              componentCount: 1,
              selected: false,
            },
          ],
        },
      },
    });
    const analysisRun = await tx.spBomAnalysisRun.create({
      data: {
        quoteId: quote.id,
        engineJobId: `expired-engine-job-${RUN_KEY}`,
        engine: 'bom-extraction-engine',
        schemaVersion: 'e2e-v1',
        parserVersion: 'journey-19',
        sourceFile: fileName,
        status: 'completed',
        summary: { parsedSheets: 3, componentCount: 8 },
        headers: {},
        failures: [],
        completedAt: new Date(),
      },
    });
    await tx.spBomQuote.update({
      where: { id: quote.id },
      data: { activeAnalysisRunId: analysisRun.id },
    });
    const analysisSheets = new Map<number, bigint>();
    for (const [sheetIndex, sheetName] of [
      [0, 'Sheet-A'],
      [1, 'Sheet-B'],
      [2, 'Sheet-Hidden'],
    ] as const) {
      const analysisSheet = await tx.spBomAnalysisSheet.create({
        data: {
          analysisRunId: analysisRun.id,
          sheetIndex,
          sheetName,
          status: 'parsed',
          componentCount: LINES.filter((line) => line.sheetIndex === sheetIndex).length,
          columnCount: 7,
          payload: { sheet_name: sheetName, status: 'parsed' },
        },
      });
      analysisSheets.set(sheetIndex, analysisSheet.id);
    }

    const itemIds: Record<string, string> = {};
    for (const [rowIdx, line] of LINES.entries()) {
      let analysisComponentId: bigint | null = null;
      if (line.sheetIndex !== null && line.sheetName !== null) {
        const analysisSheetId = analysisSheets.get(line.sheetIndex);
        if (analysisSheetId === undefined)
          throw new Error(`${line.sheetName} 분석 시트가 없습니다`);
        const component = await tx.spBomAnalysisComponent.create({
          data: {
            analysisRunId: analysisRun.id,
            analysisSheetId,
            engineComponentId: `e2e19-${String(rowIdx)}`,
            sourceRows: [rowIdx + 2],
            referenceDesignators: line.refs,
            partNumber: line.mpn,
            manufacturer: line.manufacturer,
            componentType: 'capacitor',
            description: line.description,
            quantity: QUANTITY,
            packageCode: '0402',
            reviewStatus: line.category === 'attention' ? 'review' : 'extracted',
            confidence: line.category === 'attention' ? 0.7 : 0.98,
            searchText: `${line.refs.join(' ')} ${line.mpn} ${line.manufacturer} ${line.description}`,
            payload: {
              component_id: `e2e19-${String(rowIdx)}`,
              sheet_name: line.sheetName,
              source_rows_1based: [rowIdx + 2],
              reference_designators: line.refs,
              part_number: line.mpn,
              manufacturer: line.manufacturer,
              description: line.description,
              component_type: 'capacitor',
              quantity: QUANTITY,
              package: '0402',
              value_raw: '100 nF',
              field_states: {
                part_number: { value: line.mpn, certainty: 'verified', provenance: 'cell' },
                manufacturer: {
                  value: line.manufacturer,
                  certainty: 'verified',
                  provenance: 'cell',
                },
              },
              raw_fields: {},
              attributes: { capacitance_f: 1e-7, voltage_v: 50 },
            },
          },
        });
        analysisComponentId = component.id;
      }

      const payload = line.supplier === null ? null : candidatePayload(line, rowIdx);
      const item = await tx.spBomQuoteItem.create({
        data: {
          quoteId: quote.id,
          analysisComponentId,
          rowIdx,
          included: true,
          mpn: line.mpn,
          manufacturerName: line.manufacturer,
          description: line.description,
          bomQty: QUANTITY,
          orderQty: QUANTITY,
          matchStatus:
            line.category === 'not_found'
              ? 'none'
              : line.key === 'manual-theta'
                ? 'manual'
                : 'auto',
          matchEvidence: {
            componentStatus: line.componentStatus,
            selectionApplicationState:
              line.category === 'attention' ? 'provisional_selected' : 'automatic_selected',
            confirmationRequired: line.category === 'attention',
            selectedReplacementSources: [],
          },
          recommendedCandidateKey: payload?.candidateKey ?? null,
          selectedCandidateKey: payload?.candidateKey ?? null,
          selectionSource:
            line.key === 'manual-theta' ? 'catalog' : payload === null ? 'none' : 'auto',
          selectedOffer: selectedOffer(line, rowIdx),
          lineTotalKrw: payload === null ? null : (100 + rowIdx * 10) * QUANTITY,
          sourceRow: {
            inputPartNumber: line.mpn,
            inputManufacturer: line.manufacturer,
            valueRaw: '100 nF',
            packageCode: '0402',
            sourceRows: [rowIdx + 2],
            referenceDesignators: line.refs,
            quantityConfirmed: true,
            manualAdded: line.sheetIndex === null,
          },
          sourceSheetIndex: line.sheetIndex,
          sourceSheetName: line.sheetName,
        },
      });
      itemIds[line.key] = String(item.id);
      if (payload !== null) {
        await tx.spBomQuoteCandidate.create({
          data: {
            quoteId: quote.id,
            quoteItemId: item.id,
            candidateKey: payload.candidateKey,
            technicalRank: 1,
            status: payload.status,
            selectionMode: payload.selectionMode,
            safety: payload.safety,
            autoEligible: line.category === 'matched',
            mpn: payload.mpn,
            manufacturerName: line.manufacturer,
            payload,
          },
        });
      }
    }
    return { id: String(quote.id), title, fileName, itemIds };
  });
}

async function createCustomer(label: string): Promise<E2eSession> {
  const session = await newSession(OWNER);
  session.page.setDefaultTimeout(30_000);
  sessions.push(session);
  rp.watchHttp(session, label);
  return session;
}

async function openQuote(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/app/bom/${seeded.id}`, { waitUntil: 'domcontentloaded' });
  await page
    .getByRole('heading', { name: seeded.fileName, exact: true })
    .waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'BOM 비교', exact: true }).waitFor({ state: 'visible' });
}

function isComparisonResponse(response: {
  request: () => { method: () => string };
  url: () => string;
}): boolean {
  return (
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname === `/api/bom/quotes/${seeded.id}/comparison`
  );
}

async function openComparison(page: Page): Promise<{ trigger: Locator; dialog: Locator }> {
  const trigger = page.getByRole('button', { name: 'BOM 비교', exact: true });
  const responseWait = page.waitForResponse(isComparisonResponse);
  await trigger.click();
  expect((await responseWait).status(), '전체 BOM 비교 스냅샷 조회').toBe(200);
  const dialog = page.getByRole('dialog', { name: seeded.fileName, exact: true });
  await dialog.waitFor({ state: 'visible' });
  return { trigger, dialog };
}

async function waitForComparisonQuery(
  page: Page,
  predicate: (url: URL) => boolean,
): Promise<Response> {
  return page.waitForResponse(
    (response) => isComparisonResponse(response) && predicate(new URL(response.url())),
  );
}

function oneShotFailure(route: Route): Promise<void> {
  return route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({
      result: false,
      error: 'E2E_TRANSIENT',
      message: '비교 데이터를 일시적으로 불러오지 못했습니다.',
    }),
  });
}

const rp = createJourneyReport(
  'findings-bom-comparison-workspace',
  'BOM 여정 19호 고객 전체 BOM 비교·필터·복구 탐색 주행 리포트',
);
const { F, ledger } = rp;
const sessions: E2eSession[] = [];
let seeded: SeededQuote;

describe.skipIf(!RUN || !JOURNEY)('BOM 여정 19호 — 고객 전체 BOM 비교·필터·오류 복구', () => {
  beforeAll(async () => {
    await mustReach(`${API_URL}/api/health`, 'pnpm dev:api');
    await mustReach(`${BASE_URL}/app/`, 'nginx + pnpm dev:web');
    seeded = await seedQuote();
    ledger.push(`sp_bom_quote #${seeded.id}(${seeded.title}, 종료 시 fixture 정리)`);
  }, 180_000);

  afterAll(async () => {
    rp.write(
      Object.fromEntries(sessions.map((session, index) => [`고객${String(index + 1)}`, session])),
    );
    for (const session of sessions) await session.close().catch(() => undefined);
    await getPrisma().spBomQuote.deleteMany({ where: { mbId: OWNER_ID } });
    expect(
      await getPrisma().spBomQuote.count({ where: { mbId: OWNER_ID } }),
      '19호 견적 잔재',
    ).toBe(0);
    await closeBrowser();
    await disconnectPrisma();
  }, 60_000);

  test('P01. 전체화면 dialog: 초기 초점·배경 잠금·Tab 순환·Esc·호출 버튼 복귀', async () => {
    const customer = await createCustomer('비교 레이어 키보드 고객');
    const page = customer.page;
    await openQuote(page);
    const previousOverflow = await page.evaluate(() => document.body.style.overflow);
    const { trigger, dialog } = await openComparison(page);
    const closeButton = dialog.getByRole('button', { name: 'BOM 비교 닫기', exact: true });
    expect(
      await closeButton.evaluate((element) => element === document.activeElement),
      '닫기 버튼 초기 초점',
    ).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow), '배경 스크롤 잠금').toBe(
      'hidden',
    );

    await page.keyboard.press('Shift+Tab');
    expect
      .soft(
        await dialog.evaluate((element) => element.contains(document.activeElement)),
        '역방향 Tab도 비교 dialog 내부 순환',
      )
      .toBe(true);

    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    expect(await page.evaluate(() => document.body.style.overflow), '배경 스크롤 복원').toBe(
      previousOverflow,
    );
    expect(
      await trigger.evaluate((element) => element === document.activeElement),
      '닫은 뒤 BOM 비교 버튼 초점 복귀',
    ).toBe(true);
    F('P01', 'obs', '비교 전체화면의 초기 초점·스크롤·Tab·Esc·호출 버튼 복귀를 확인');
    expect(customer.pageErrors, 'P01 pageerror').toEqual([]);
  });

  test('P02. 영속 비교 원장: 엔진 잡 없이 요약·페이지·직접 추가·선택 제외 시트 범위 유지', async () => {
    const customer = await createCustomer('비교 영속 원장 고객');
    const page = customer.page;
    await openQuote(page);
    const engineRequests: string[] = [];
    const comparisonPageRequests: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.includes('/jobs/')) engineRequests.push(request.url());
      if (url.pathname === `/api/bom/quotes/${seeded.id}/comparison`) {
        comparisonPageRequests.push(url.searchParams.get('page') ?? '');
      }
    });
    const { dialog } = await openComparison(page);

    const summary = dialog.getByRole('region', { name: 'BOM 비교 요약' });
    await summary.getByText('4', { exact: true }).waitFor({ state: 'visible' });
    expect(await summary.getByText('2', { exact: true }).count(), '확인 필요·미검색 각 2건').toBe(
      2,
    );
    expect(await dialog.locator('.comparison-item').count(), '첫 페이지 5행').toBe(5);
    await dialog
      .getByRole('heading', { name: LINES[0]?.mpn ?? '', exact: true })
      .waitFor({ state: 'visible' });

    const nextResponse = waitForComparisonQuery(
      page,
      (url) => url.searchParams.get('page') === '2',
    );
    await dialog.getByRole('button', { name: '다음', exact: true }).click();
    const secondPageResponse = await nextResponse;
    expect(secondPageResponse.status(), '비교 2페이지').toBe(200);
    const secondPageBody = (await secondPageResponse.json()) as any;
    await page.waitForTimeout(500);
    const visibleHeadings = await dialog.locator('.comparison-item h3').allTextContents();
    expect
      .soft(visibleHeadings, '2페이지 3행이 화면에 유지')
      .toEqual([LINES[5]?.mpn, LINES[6]?.mpn, LINES[7]?.mpn]);
    expect
      .soft(
        await dialog.getByRole('navigation', { name: 'BOM 비교 페이지' }).textContent(),
        '2페이지 표시 유지',
      )
      .toContain('2 / 2');
    expect(
      await dialog.getByText(LINES[8]?.mpn ?? '', { exact: true }).count(),
      '선택 제외 시트 미노출',
    ).toBe(0);

    expect(secondPageBody?.data).toMatchObject({
      page: 2,
      total: 8,
      totalPages: 2,
      summary: { matched: 4, attention: 2, notFound: 2 },
    });
    const secondPageItemIds = (secondPageBody?.data?.rows ?? []).map(
      (row: { itemId: string }) => row.itemId,
    );
    expect(secondPageItemIds).toContain(seeded.itemIds['manual-theta']);
    expect(secondPageItemIds).not.toContain(seeded.itemIds['hidden-iota']);
    expect(engineRequests, '만료 엔진 잡 호출 없음').toEqual([]);
    expect.soft(comparisonPageRequests.at(-1), '2페이지 응답 뒤 1페이지 재요청 없음').toBe('2');
    await rp.shot(customer, 'P02-bom-comparison-persistent-page');
    F('P02', 'obs', '박제 원문·후보만으로 4/2/2 요약과 2페이지·직접 추가·제외 시트 범위를 복원');
    expect(customer.pageErrors, 'P02 pageerror').toEqual([]);
  });

  test('P03. 검색·판정·시트 필터: 서버 결과와 제어값이 일치하고 다른 시트 선택지를 보존', async () => {
    const customer = await createCustomer('비교 필터 고객');
    const page = customer.page;
    await openQuote(page);
    const { dialog } = await openComparison(page);
    const search = dialog.getByRole('searchbox', { name: 'BOM 비교 검색' });
    const status = dialog.getByRole('combobox', { name: '판정 필터' });
    const sheet = dialog.getByRole('combobox', { name: '시트 필터' });

    let responseWait = waitForComparisonQuery(
      page,
      (url) => url.searchParams.get('search') === 'UNIQUE-MANUAL-THETA',
    );
    await search.fill('UNIQUE-MANUAL-THETA');
    expect((await responseWait).status(), '비교 설명 검색').toBe(200);
    expect(await dialog.locator('.comparison-item').count(), '설명 검색 1행').toBe(1);
    await dialog
      .getByRole('heading', { name: LINES[7]?.mpn ?? '', exact: true })
      .waitFor({ state: 'visible' });

    responseWait = waitForComparisonQuery(
      page,
      (url) => !url.searchParams.has('search') && !url.searchParams.has('status'),
    );
    await search.fill('');
    expect((await responseWait).status(), '비교 검색 초기화').toBe(200);

    responseWait = waitForComparisonQuery(
      page,
      (url) => url.searchParams.get('status') === 'not_found',
    );
    await status.selectOption('not_found');
    expect((await responseWait).status(), '검색 결과 없음 판정 필터').toBe(200);
    expect(await dialog.locator('.comparison-item').count(), '미검색 2행').toBe(2);

    responseWait = waitForComparisonQuery(
      page,
      (url) => url.searchParams.get('sheet') === 'Sheet-B' && !url.searchParams.has('status'),
    );
    await status.selectOption('all');
    await sheet.selectOption('Sheet-B');
    expect((await responseWait).status(), 'Sheet-B 필터').toBe(200);
    expect(await dialog.locator('.comparison-item').count(), 'Sheet-B 2행').toBe(2);
    expect
      .soft(
        await sheet.locator('option').allTextContents(),
        '현재 필터와 무관하게 활성 시트 선택지 유지',
      )
      .toEqual(['전체 시트', 'Sheet-A', 'Sheet-B']);
    await rp.shot(customer, 'P03-bom-comparison-sheet-filter');
    F('P03', 'obs', '설명 검색·판정·시트 필터 결과와 활성 시트 선택지의 정합을 확인');
    expect(customer.pageErrors, 'P03 pageerror').toEqual([]);
  });

  test('P04. 비교 GET 503: 열린 화면·오류 초점 유지 후 같은 자리에서 재시도', async () => {
    const customer = await createCustomer('비교 실패 복구 고객');
    const page = customer.page;
    await openQuote(page);
    let failed = false;
    const pattern = `**/api/bom/quotes/${seeded.id}/comparison?*`;
    const handler = async (route: Route): Promise<void> => {
      if (!failed && route.request().method() === 'GET') {
        failed = true;
        await oneShotFailure(route);
        return;
      }
      await route.continue();
    };
    await page.route(pattern, handler);
    const trigger = page.getByRole('button', { name: 'BOM 비교', exact: true });
    const failedResponse = page.waitForResponse(
      (response) => isComparisonResponse(response) && response.status() === 503,
    );
    await trigger.click();
    await failedResponse;
    const dialog = page.getByRole('dialog', { name: seeded.fileName, exact: true });
    const alert = dialog.getByRole('alert');
    await alert.waitFor({ state: 'visible' });
    expect(
      await dialog.locator('.summary-strip strong').allTextContents(),
      '실패 통계는 0이 아닌 미확인',
    ).toEqual(['—', '—', '—', '—']);
    expect
      .soft(
        await alert.evaluate((element) => element === document.activeElement),
        '비교 조회 오류 안내 초점',
      )
      .toBe(true);
    await rp.shot(customer, 'P04-bom-comparison-load-error');

    const retryResponse = page.waitForResponse(
      (response) => isComparisonResponse(response) && response.status() === 200,
    );
    await alert.getByRole('button', { name: '다시 불러오기', exact: true }).click();
    await retryResponse;
    await dialog.locator('.comparison-item').first().waitFor({ state: 'visible' });
    expect(await dialog.locator('.comparison-item').count(), '재시도 뒤 첫 페이지 5행').toBe(5);
    expect(await dialog.count(), '재시도 뒤 같은 dialog 유지').toBe(1);
    await page.unroute(pattern, handler);
    F('P04', 'obs', '비교 503을 열린 화면에서 안내하고 같은 자리 재시도로 영속 원장을 복원');
    expect(customer.pageErrors, 'P04 pageerror').toEqual([]);
  });

  test('P05. 닫기·재열기: 화면 제어값과 서버 쿼리를 모두 전체 1페이지로 초기화', async () => {
    const customer = await createCustomer('비교 재진입 고객');
    const page = customer.page;
    await openQuote(page);
    let opened = await openComparison(page);
    const firstSheet = opened.dialog.getByRole('combobox', { name: '시트 필터' });
    const filteredResponse = waitForComparisonQuery(
      page,
      (url) => url.searchParams.get('sheet') === 'Sheet-B',
    );
    await firstSheet.selectOption('Sheet-B');
    expect((await filteredResponse).status(), '재진입 전 Sheet-B 필터').toBe(200);
    await opened.dialog.locator('.comparison-item').first().waitFor({ state: 'visible' });
    expect(await opened.dialog.locator('.comparison-item').count(), '재진입 전 Sheet-B 2행').toBe(
      2,
    );
    await opened.dialog.getByRole('button', { name: 'BOM 비교 닫기', exact: true }).click();
    await opened.dialog.waitFor({ state: 'hidden' });

    const comparisonRequests: URL[] = [];
    const collectRequest = (request: { url: () => string }): void => {
      const url = new URL(request.url());
      if (url.pathname === `/api/bom/quotes/${seeded.id}/comparison`) comparisonRequests.push(url);
    };
    page.on('request', collectRequest);
    await page.getByRole('button', { name: 'BOM 비교', exact: true }).click();
    opened = {
      trigger: page.getByRole('button', { name: 'BOM 비교', exact: true }),
      dialog: page.getByRole('dialog', { name: seeded.fileName, exact: true }),
    };
    await opened.dialog.waitFor({ state: 'visible' });
    await page.waitForTimeout(700);
    page.off('request', collectRequest);
    expect(
      await opened.dialog.getByRole('combobox', { name: '시트 필터' }).inputValue(),
      '재열기 제어값 전체 시트',
    ).toBe('all');
    expect
      .soft(await opened.dialog.locator('.comparison-item').count(), '재열기 전체 첫 페이지 5행')
      .toBe(5);
    expect
      .soft(
        comparisonRequests.length === 0 ||
          comparisonRequests.some(
            (url) => !url.searchParams.has('sheet') && url.searchParams.get('page') === '1',
          ),
        '재열기 서버 쿼리도 전체 1페이지',
      )
      .toBe(true);
    F('P05', 'obs', '필터를 사용한 뒤 닫고 다시 열어도 제어값과 서버 결과가 같은 전체 범위로 시작');
    expect(customer.pageErrors, 'P05 pageerror').toEqual([]);
  });

  test('P06. 390px 비교표: 원본 맥락을 남기면서 공급사 후보 열을 실제로 노출', async () => {
    const customer = await createCustomer('모바일 비교 열 고객');
    const page = customer.page;
    await page.setViewportSize({ width: 390, height: 844 });
    await openQuote(page);
    const { dialog } = await openComparison(page);
    const modalBox = await dialog.boundingBox();
    expect(modalBox, '모바일 전체 비교 화면').not.toBeNull();
    expect.soft(modalBox?.x ?? -1, '모바일 비교 왼쪽 경계').toBeGreaterThanOrEqual(0);
    expect
      .soft((modalBox?.x ?? 0) + (modalBox?.width ?? 0), '모바일 비교 오른쪽 경계')
      .toBeLessThanOrEqual(390);

    const comparisonScroll = dialog.locator('.comparison-scroll').first();
    const dimensions = await comparisonScroll.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(dimensions.scrollWidth, '공급사 열 가로 탐색 필요').toBeGreaterThan(
      dimensions.clientWidth,
    );
    expect
      .soft(await comparisonScroll.getAttribute('tabindex'), '가로 비교표 키보드 진입')
      .toBe('0');
    expect
      .soft((await comparisonScroll.getAttribute('aria-label')) ?? '', '가로 비교표 탐색 이름')
      .toContain('공급사');
    await dialog
      .getByText('좌우로 밀어 Excel 원본과 공급사 결과를 확인하세요.', { exact: true })
      .first()
      .waitFor({ state: 'visible' });

    const exposure = await comparisonScroll.evaluate((element) => {
      element.scrollLeft = element.scrollWidth;
      const scrollRect = element.getBoundingClientRect();
      const stickyCells = [...element.querySelectorAll<HTMLElement>('.column-head')].filter(
        (cell) => getComputedStyle(cell).position === 'sticky',
      );
      const candidate = [...element.querySelectorAll<HTMLElement>('.column-head')].find(
        (cell) => cell.textContent?.trim() === 'UnikeyIC',
      );
      const candidateRect = candidate?.getBoundingClientRect() ?? null;
      const candidateTextRange = document.createRange();
      if (candidate !== undefined) candidateTextRange.selectNodeContents(candidate);
      const candidateTextRect =
        candidate === undefined ? null : candidateTextRange.getBoundingClientRect();
      const occluderRight = stickyCells.reduce(
        (right, cell) => Math.max(right, cell.getBoundingClientRect().right),
        scrollRect.left,
      );
      const visibleWidth =
        candidateRect === null
          ? 0
          : Math.max(
              0,
              Math.min(scrollRect.right, candidateRect.right) -
                Math.max(scrollRect.left, candidateRect.left, occluderRight),
            );
      const visibleTextWidth =
        candidateTextRect === null
          ? 0
          : Math.max(
              0,
              Math.min(scrollRect.right, candidateTextRect.right) -
                Math.max(scrollRect.left, candidateTextRect.left, occluderRight),
            );
      const source = element.querySelector<HTMLElement>('.column-head.source-column');
      return {
        candidateFound: candidateRect !== null,
        visibleWidth,
        visibleTextWidth,
        sourcePosition: source === null ? null : getComputedStyle(source).position,
      };
    });
    expect(exposure.candidateFound, '모바일 공급사 후보 헤더 존재').toBe(true);
    expect
      .soft(exposure.visibleWidth, '고정 원본 열 밖 후보 헤더 노출 폭')
      .toBeGreaterThanOrEqual(80);
    expect
      .soft(exposure.visibleTextWidth, '최우측 공급사 이름 실제 노출 폭')
      .toBeGreaterThanOrEqual(40);
    expect
      .soft(exposure.sourcePosition, '모바일에서는 Excel 원본 열이 후보를 덮지 않음')
      .not.toBe('sticky');
    expect
      .soft(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        '모달 밖 문서 가로 넘침 없음',
      )
      .toBe(true);
    await rp.shot(customer, 'P06-mobile-bom-comparison-columns');
    F('P06', 'obs', '390px에서 원본 맥락과 공급사 후보 열을 가로 탐색으로 모두 확인');
    expect(customer.pageErrors, 'P06 pageerror').toEqual([]);
  });
});
