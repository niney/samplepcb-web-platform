import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyBaseLogger } from 'fastify';
import type { BomQuoteItemInputType } from '@sp/api-contract';

// repriceCandidateSelections(자동저장 재평가 배치화)·persistQuoteComputed(부분 스냅샷 재기록)
// 전용 스위트. bom-quote.test.ts는 prisma/engineFetch를 목하지 않는 순수 함수 테스트만 모아
// 두므로, DB·엔진 호출이 필요한 이 스위트는 별도 파일로 분리한다(vi.mock은 파일 전체에 호이스트).

const prismaMocks = vi.hoisted(() => ({
  candidateFindMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    spBomQuoteCandidate: { findMany: prismaMocks.candidateFindMany },
    $transaction: prismaMocks.transaction,
  },
}));

vi.mock('./engine-client', () => ({ engineFetch: vi.fn() }));

import { engineFetch } from './engine-client';
import {
  patchNeedsCandidateReprice,
  persistQuoteComputed,
  repriceCandidateSelections,
  selectEngineMatch,
} from './bom-quote';

const engineFetchMock = vi.mocked(engineFetch);
const candidateFindManyMock = prismaMocks.candidateFindMany;
const transactionMock = prismaMocks.transaction;

afterEach(() => {
  vi.clearAllMocks();
});

function createLog(): FastifyBaseLogger {
  return { info: vi.fn(), warn: vi.fn() } as unknown as FastifyBaseLogger;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function requestBody(init: RequestInit | undefined): { components: {
  component_id: string;
  required_quantity: number;
  procurement_disposition: 'eligible' | 'excluded' | 'quantity_confirmation_required';
  quantity_resolution: 'verified' | 'conflict' | 'missing';
  disposition_reason_codes: string[];
}[] } {
  // engineFetch 는 항상 JSON.stringify(...) 문자열을 body 로 넘긴다(RequestInit.body 는 다른
  // BodyInit도 허용하는 넓은 타입이라 no-base-to-string 회피를 위해 명시적으로 캐스팅한다).
  return JSON.parse(init?.body as string) as ReturnType<typeof requestBody>;
}

// ── 저장 후보·엔진 응답 공용 픽스처 ──────────────────────────────────────────
// selectEngineMatch(이미 검증된 순수 함수)로 실제 유효한 StoredCandidate 스냅샷을 만들어
// DB 목·엔진 응답 목 양쪽에 재사용한다 — 30여 개 필드를 매번 손으로 채우지 않기 위함.

function engineCandidateJson(opts: {
  mpn: string;
  supplier: string;
  unitPrice: number;
  moq: number;
  identityKey: string;
  technicalEvidenceKey: string;
  offerKey: string;
  requiredQuantity: number;
  recommendation: 'automatic' | 'manual_review' | 'none';
}) {
  const unitPriceStr = String(opts.unitPrice);
  return {
    status: 'verified_exact',
    identity_confidence: 1,
    specification_confidence: 0,
    conflicts: [],
    missing_requirements: [],
    reasons: ['verified_exact_reason'],
    corroborating_suppliers: [],
    decision: {
      decision_policy_version: 'supplier-candidate-decision-v1',
      category_policy_version: 'candidate-category-policy-v1',
      identity_key_version: 'candidate-identity-key-v1',
      evidence_key_version: 'candidate-evidence-key-v1',
      selection_recommendation_policy_version: 'candidate-selection-recommendation-v1',
      match_relation: 'exact',
      selection_eligibility: 'automatic',
      auto_eligible: true,
      manual_selectable: true,
      reason_codes: [],
      identity_key: opts.identityKey,
      technical_evidence_key: opts.technicalEvidenceKey,
      verified_requirement_count: 0,
      required_requirement_count: 0,
      verification_complete: true,
      strict_category_coverage: false,
      lifecycle_state: 'active',
      technical_review_rank: null,
      selection_recommendation: 'preselect',
      review_recommended: false,
    },
    product: {
      supplier: opts.supplier,
      supplier_product_id: `${opts.supplier}-product`,
      manufacturer_part_number: opts.mpn,
      manufacturer: 'Test Mfr',
      description: opts.mpn,
      normalized_specs: {},
      attributes: {},
      offers: [
        {
          supplier: opts.supplier,
          supplier_sku: `${opts.supplier}-${opts.mpn}`,
          packaging: 'Cut Tape',
          stock: 1_000,
          moq: opts.moq,
          order_multiple: 1,
          price_breaks: [{ quantity: 1, unit_price: opts.unitPrice, currency: 'KRW' }],
          fetched_at: '2026-07-20T00:00:00.000Z',
          procurement_decision: {
            procurement_policy_version: 'supplier-procurement-decision-v1',
            offer_key_version: 'supplier-offer-key-v1',
            rank_scope: 'identity_and_technical_evidence',
            offer_key: opts.offerKey,
            calculation_status: 'calculated',
            required_quantity: opts.requiredQuantity,
            order_quantity: opts.requiredQuantity,
            applied_price_break_quantity: 1,
            source_unit_price: unitPriceStr,
            source_currency: 'KRW',
            exchange_rate: '1',
            target_currency: 'KRW',
            converted_unit_price: unitPriceStr,
            line_total: String(opts.unitPrice * opts.requiredQuantity),
            stock_short: false,
            stock_short_quantity: 0,
            surplus_quantity: 0,
            excessive_order: false,
            price_rank: 1,
            purchase_fit_rank: 1,
            purchasable: true,
            recommendation: opts.recommendation,
            reason_codes: ['fixture'],
          },
        },
      ],
    },
  };
}

function componentProcurementDecisionJson(opts: {
  offerKey: string;
  requiredQuantity: number;
  identityKey: string;
  technicalEvidenceKey: string;
}) {
  return {
    procurement_policy_version: 'supplier-procurement-decision-v1',
    selection_application_policy_version: 'supplier-selection-application-v3',
    status: 'automatic_recommended',
    selection_application_state: 'automatic_selected',
    confirmation_required: false,
    required_quantity: opts.requiredQuantity,
    target_currency: 'KRW',
    currency_rate_snapshot_id: 'fixture-snapshot',
    currency_rate_as_of: '2026-07-21T00:00:00+09:00',
    currency_rate_source: 'test',
    technical_preselection_identity_key: opts.identityKey,
    technical_preselection_evidence_key: opts.technicalEvidenceKey,
    application_candidate_identity_key: opts.identityKey,
    application_candidate_evidence_key: opts.technicalEvidenceKey,
    technical_fallback_used: false,
    price_optimization_used: false,
    automatic_offer_key: opts.offerKey,
    review_offer_key: null,
    recommendation_reason_codes: ['fixture'],
  };
}

/** 배치 응답의 'ok' 컴포넌트 하나(candidates + procurement_decision)를 구성한다. */
function decisionPayloadFor(mpn: string, supplier: string, unitPrice: number, moq: number, requiredQuantity: number) {
  const identityKey = `ik1:${mpn}`;
  const technicalEvidenceKey = `ek1:${mpn}`;
  const offerKey = `ok1:${mpn}-${supplier}`;
  return {
    candidates: [engineCandidateJson({
      mpn, supplier, unitPrice, moq, identityKey, technicalEvidenceKey, offerKey, requiredQuantity, recommendation: 'automatic',
    })],
    procurement_decision: componentProcurementDecisionJson({ offerKey, requiredQuantity, identityKey, technicalEvidenceKey }),
  };
}

/** DB에 저장된 것으로 취급할 자동 선정 상태를 selectEngineMatch로 만든다(검증된 경로 재사용). */
function buildDecision(componentId: string, mpn: string, supplier: string, unitPrice: number, moq: number, needed: number) {
  const payload = decisionPayloadFor(mpn, supplier, unitPrice, moq, needed);
  const decision = selectEngineMatch(
    { component_id: componentId, status: 'verified_exact', candidates: payload.candidates, procurement_decision: payload.procurement_decision },
    needed,
    null,
  );
  if (decision === null) throw new Error(`fixture: expected a decision for ${mpn} at needed=${String(needed)}`);
  const { pick, candidate } = decision;
  if (pick === null || candidate === null) {
    throw new Error(`fixture: expected an automatic pick/candidate for ${mpn} at needed=${String(needed)}`);
  }
  // pick/candidate 를 non-null 로 좁힌 채 반환 — 호출부가 non-null assertion 없이 쓸 수 있다.
  return { ...decision, pick, candidate };
}

function firstSnapshot(decision: ReturnType<typeof buildDecision>): ReturnType<typeof buildDecision>['snapshots'][number] {
  const snapshot = decision.snapshots[0];
  if (snapshot === undefined) throw new Error('fixture: decision has no snapshot');
  return snapshot;
}

function autoSelectedItem(
  id: string,
  rowIdx: number,
  componentId: string,
  decision: ReturnType<typeof buildDecision>,
  bomQty: number,
): BomQuoteItemInputType & { id: string } {
  const { candidate, pick } = decision;
  return {
    id,
    rowIdx,
    included: true,
    mpn: candidate.product.manufacturer_part_number,
    manufacturerName: candidate.product.manufacturer ?? null,
    description: candidate.product.description ?? null,
    bomQty,
    orderQty: pick.orderQty,
    matchStatus: 'auto',
    matchEvidence: decision.evidence,
    recommendedCandidateKey: decision.recommendedCandidateKey,
    selectedCandidateKey: decision.candidateKey,
    selectionSource: 'auto',
    partId: null,
    selectedOffer: {
      offerKey: decision.offerKey,
      supplier: pick.offer.supplier,
      supplierSku: pick.offer.supplierSku,
      packaging: pick.offer.packaging,
      breakQty: pick.breakQty,
      unitPrice: pick.unitPrice,
      currency: pick.currency,
      unitPriceKrw: pick.unitPriceKrw,
      moq: pick.offer.moq,
      orderMultiple: pick.offer.orderMultiple,
      stock: pick.offer.stock,
      priceBreaks: pick.offer.priceBreaks.map((step) => ({ qty: step.qty, price: step.price })),
      fetchedAt: pick.offer.fetchedAt,
      pinned: false,
    },
    sourceRow: {
      sheetName: 'Sheet1',
      sourceRows: [rowIdx + 2],
      componentId,
      referenceDesignators: [],
      packageCode: null,
      valueRaw: null,
      inputPartNumber: candidate.product.manufacturer_part_number,
      inputManufacturer: candidate.product.manufacturer ?? null,
    },
    sourceSheetIndex: 0,
    sourceSheetName: 'Sheet1',
  };
}

function mockStoredCandidates(rows: { id: string; candidate: unknown }[]): void {
  candidateFindManyMock.mockResolvedValue(
    rows.map(({ id, candidate }) => ({ quoteItemId: BigInt(id), payload: candidate })),
  );
}

// ── patchNeedsCandidateReprice ───────────────────────────────────────────────

describe('patchNeedsCandidateReprice', () => {
  it('items/setQty/spareQty 가 전부 없으면(제목·메모 전용 PATCH) false — 라우트가 엔진 재평가를 건너뛴다', () => {
    expect(patchNeedsCandidateReprice({})).toBe(false);
    expect(patchNeedsCandidateReprice({ title: 'x', customerMemo: 'y' } as never)).toBe(false);
  });

  it('items/setQty/spareQty 중 하나라도 있으면 true', () => {
    expect(patchNeedsCandidateReprice({ items: [] })).toBe(true);
    expect(patchNeedsCandidateReprice({ setQty: 2 })).toBe(true);
    expect(patchNeedsCandidateReprice({ spareQty: 1 })).toBe(true);
  });
});

// ── repriceCandidateSelections ───────────────────────────────────────────────

describe('repriceCandidateSelections', () => {
  it('재평가가 필요한 행이 없으면 엔진을 전혀 호출하지 않는다', async () => {
    const decision = buildDecision('component-1', 'MPN-1', 'digikey', 10, 1, 10);
    const item = autoSelectedItem('1', 0, 'component-1', decision, 10);
    mockStoredCandidates([{ id: '1', candidate: firstSnapshot(decision) }]);

    const log = createLog();
    // setQty=1,spareQty=0 → neededQty(10,1,0)=10 == 저장된 required_quantity(10) → 드리프트 없음
    const result = await repriceCandidateSelections(1n, [item], 1, 0, null, null, log);

    expect(engineFetchMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('저장된 수량 충돌 상태를 무호출 조달 재평가에도 전달한다', async () => {
    const decision = buildDecision('component-conflict', 'MPN-CONFLICT', 'digikey', 10, 1, 10);
    const item = autoSelectedItem('1', 0, 'component-conflict', decision, 20);
    const candidate = {
      ...firstSnapshot(decision),
      procurementDisposition: 'quantity_confirmation_required' as const,
      quantityResolution: 'conflict' as const,
      dispositionReasonCodes: ['quantity_reference_conflict'],
    };
    mockStoredCandidates([{ id: '1', candidate }]);
    engineFetchMock.mockImplementation((_path, init) => {
      expect(requestBody(init).components[0]).toMatchObject({
        procurement_disposition: 'quantity_confirmation_required',
        quantity_resolution: 'conflict',
        disposition_reason_codes: ['quantity_reference_conflict'],
      });
      return Promise.resolve(jsonResponse({
        components: [{ component_id: 'component-conflict', status: 'error', error_code: 'quantity_confirmation_required' }],
      }));
    });

    await repriceCandidateSelections(1n, [item], 1, 0, null, null, createLog());

    expect(engineFetchMock).toHaveBeenCalledTimes(1);
  });

  it('50개 초과 컴포넌트는 50개 청크로 나눠 벌크 재평가하고 컴포넌트→행으로 정확히 매핑한다', async () => {
    const ROW_COUNT = 55;
    const rows = Array.from({ length: ROW_COUNT }, (_unused, index) => {
      const mpn = `MPN-${String(index)}`;
      const componentId = `component-${String(index)}`;
      const decision = buildDecision(componentId, mpn, 'digikey', 10, 1, 10); // 저장 시점 needed=10
      return { componentId, mpn, item: autoSelectedItem(String(index + 1), index, componentId, decision, 20), candidate: firstSnapshot(decision) };
    });
    mockStoredCandidates(rows.map((r) => ({ id: r.item.id, candidate: r.candidate })));

    const chunkSizes: number[] = [];
    engineFetchMock.mockImplementation((path, init, timeoutMs) => {
      expect(path).toBe('/supplier-search/procurement/reevaluate-batch');
      expect(timeoutMs).toBe(15_000);
      const body = requestBody(init);
      chunkSizes.push(body.components.length);
      return Promise.resolve(jsonResponse({
        components: body.components.map((c) => {
          const mpn = c.component_id.replace('component-', 'MPN-');
          return { component_id: c.component_id, status: 'ok' as const, ...decisionPayloadFor(mpn, 'digikey', 10, 1, c.required_quantity) };
        }),
      }));
    });

    const items = rows.map((r) => r.item);
    const log = createLog();
    // bomQty=20, setQty=1 → neededQty=20 (저장된 10과 드리프트) → 전 행 재평가 필요
    const result = await repriceCandidateSelections(1n, items, 1, 0, null, null, log);

    expect(engineFetchMock).toHaveBeenCalledTimes(2);
    expect(chunkSizes).toEqual([50, 5]);
    expect(result).toHaveLength(ROW_COUNT);
    for (const item of items) {
      expect(item.orderQty).toBe(20);
      expect(item.matchEvidence?.decisionReasonCodes).toEqual(['engine-procurement-recommendation']);
    }
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('엔진 청크 요청 자체가 실패해도(네트워크 예외) 예외를 던지지 않고 stale 유지로 축퇴하며 리셋 분기에 빠지지 않는다', async () => {
    const decision = buildDecision('component-1', 'MPN-1', 'digikey', 10, 1, 5);
    const item = autoSelectedItem('1', 0, 'component-1', decision, 10); // bomQty=10 → neededQty(10,2,0)=20 (저장 5와 드리프트)
    const originalSelectedCandidateKey = item.selectedCandidateKey;
    const originalOfferUnitPrice = item.selectedOffer?.unitPrice;
    mockStoredCandidates([{ id: '1', candidate: firstSnapshot(decision) }]);
    engineFetchMock.mockRejectedValue(new Error('ECONNREFUSED — engine down'));

    const log = createLog();
    const result = await repriceCandidateSelections(1n, [item], 2, 0, null, null, log);

    // 예외 없이 완료 + 아무 행도 재평가에 성공하지 못했으므로 스냅샷 반환 없음(전량 재삽입 대상 아님).
    expect(result).toBeUndefined();
    // 리셋 분기(자동 선정·가격 소거)가 재현되지 않았는지 — 선택이 그대로 보존됐는지 직접 확인.
    expect(item.selectedCandidateKey).toBe(originalSelectedCandidateKey);
    expect(item.selectedCandidateKey).not.toBeNull();
    expect(item.selectedOffer).not.toBeNull();
    expect(item.selectedOffer?.unitPrice).toBe(originalOfferUnitPrice); // 가격은 이 함수가 손대지 않는다
    expect(item.matchStatus).toBe('auto');
    expect(item.selectionSource).toBe('auto');
    // 보정: orderQty만 새 필요수량으로 로컬 재도장(moq=1,orderMultiple=1 → needed 그대로).
    expect(item.orderQty).toBe(20);
    // 표시: 기존 enum 값을 dedup 추가.
    expect(item.matchEvidence?.decisionReasonCodes).toContain('engine-procurement-unavailable');
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ quoteId: '1', degradedRowCount: 1 }),
      expect.any(String),
    );
  });

  it('청크 요청이 실패하면 서킷브레이커가 열려 잔여 청크는 호출하지 않고 즉시 전부 축퇴한다', async () => {
    const ROW_COUNT = 101; // BATCH_REEVALUATION_CHUNK_SIZE(50) 기준 3청크(50+50+1)로 나뉜다.
    const rows = Array.from({ length: ROW_COUNT }, (_unused, index) => {
      const mpn = `MPN-CB-${String(index)}`;
      const componentId = `component-cb-${String(index)}`;
      const decision = buildDecision(componentId, mpn, 'digikey', 10, 1, 10); // 저장 시점 needed=10
      return { item: autoSelectedItem(String(index + 1), index, componentId, decision, 20), candidate: firstSnapshot(decision) };
    });
    mockStoredCandidates(rows.map((r) => ({ id: r.item.id, candidate: r.candidate })));
    // 엔진 행업(무응답) 시뮬레이션 — 청크마다 15초를 다 태우면 최악 3×15초가 걸린다.
    // 서킷브레이커가 없으면 이 테스트가 그 지연을 그대로 재현했을 것이다.
    engineFetchMock.mockRejectedValue(new Error('ETIMEDOUT — engine hung'));

    const items = rows.map((r) => r.item);
    const log = createLog();
    const result = await repriceCandidateSelections(1n, items, 1, 0, null, null, log); // bomQty=20,setQty=1 → needed=20(저장 10과 드리프트)

    // 서킷브레이커 — 첫 청크 실패 즉시 중단, 잔여 2청크는 시도조차 하지 않는다.
    expect(engineFetchMock).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
    for (const item of items) {
      expect(item.selectedCandidateKey).not.toBeNull(); // 전 행 stale 유지 — 리셋 분기 없음.
      expect(item.orderQty).toBe(20);
      expect(item.matchEvidence?.decisionReasonCodes).toContain('engine-procurement-unavailable');
    }
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: '1',
        degradedRowCount: ROW_COUNT,
        engineErrorCodes: expect.arrayContaining(['batch-request-failed', 'batch-circuit-open']) as unknown as string[],
      }),
      expect.any(String),
    );
  });

  it('컴포넌트별 오류(엔진이 응답한 상태)는 서킷브레이커를 열지 않고 다음 청크를 계속 시도한다', async () => {
    const ROW_COUNT = 51; // 50 + 1 = 2청크. 1청크의 마지막 행만 컴포넌트별 error.
    const rows = Array.from({ length: ROW_COUNT }, (_unused, index) => {
      const mpn = `MPN-LIVE-${String(index)}`;
      const componentId = `component-live-${String(index)}`;
      const decision = buildDecision(componentId, mpn, 'digikey', 10, 1, 10);
      return { componentId, item: autoSelectedItem(String(index + 1), index, componentId, decision, 20), candidate: firstSnapshot(decision) };
    });
    mockStoredCandidates(rows.map((r) => ({ id: r.item.id, candidate: r.candidate })));
    const erroredComponentId = rows[49]?.componentId; // 1청크(0~49) 마지막 행만 격리 대상.

    engineFetchMock.mockImplementation((_path, init) => {
      const body = requestBody(init);
      return Promise.resolve(jsonResponse({
        components: body.components.map((c) => {
          if (c.component_id === erroredComponentId) {
            return { component_id: c.component_id, status: 'error' as const, error_code: 'requested_offer_not_found' };
          }
          const mpn = c.component_id.replace('component-live-', 'MPN-LIVE-');
          return { component_id: c.component_id, status: 'ok' as const, ...decisionPayloadFor(mpn, 'digikey', 10, 1, c.required_quantity) };
        }),
      }));
    });

    const items = rows.map((r) => r.item);
    const log = createLog();
    const result = await repriceCandidateSelections(1n, items, 1, 0, null, null, log);

    // 컴포넌트별 error는 엔진이 살아있다는 뜻 — 서킷브레이커가 열리지 않고 2청크도 호출된다.
    expect(engineFetchMock).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(ROW_COUNT - 1); // 격리된 1행만 스냅샷에서 빠진다.
    const erroredItem = items.find((item) => item.sourceRow?.componentId === erroredComponentId);
    expect(erroredItem?.matchEvidence?.decisionReasonCodes).toContain('engine-procurement-unavailable');
    const otherItems = items.filter((item) => item.sourceRow?.componentId !== erroredComponentId);
    for (const item of otherItems) {
      expect(item.matchEvidence?.decisionReasonCodes).toEqual(['engine-procurement-recommendation']);
    }
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ degradedRowCount: 1, engineErrorCodes: ['requested_offer_not_found'] }),
      expect.any(String),
    );
  });

  it('컴포넌트별 오류·componentId 누락 행만 격리해 축퇴시키고 나머지 행은 정상 반영한다', async () => {
    const okDecision = buildDecision('component-ok', 'MPN-OK', 'digikey', 10, 1, 5);
    const okItem = autoSelectedItem('1', 0, 'component-ok', okDecision, 10); // needed(10,2,0)=20, 저장 5 → 드리프트

    const missingDecision = buildDecision('component-missing', 'MPN-MISSING', 'digikey', 10, 1, 5);
    const missingItem: BomQuoteItemInputType & { id: string } = {
      ...autoSelectedItem('2', 1, 'component-missing', missingDecision, 10),
      matchEvidence: null, // componentId 원천이 전부 사라진 상태(레거시/이상 케이스) 시뮬레이션
      sourceRow: null,
    };
    const missingOriginalOfferPrice = missingItem.selectedOffer?.unitPrice;

    const errorDecision = buildDecision('component-error', 'MPN-ERROR', 'digikey', 10, 1, 5);
    const errorItem = autoSelectedItem('3', 2, 'component-error', errorDecision, 10);
    const errorOriginalOfferPrice = errorItem.selectedOffer?.unitPrice;

    mockStoredCandidates([
      { id: '1', candidate: firstSnapshot(okDecision) },
      { id: '2', candidate: firstSnapshot(missingDecision) },
      { id: '3', candidate: firstSnapshot(errorDecision) },
    ]);

    engineFetchMock.mockImplementation((_path, init) => {
      const body = requestBody(init);
      // componentId가 없는 행(component-missing)은 애초에 배치 요청에 실리지 않는다.
      expect(body.components.map((c) => c.component_id).sort()).toEqual(['component-error', 'component-ok']);
      return Promise.resolve(jsonResponse({
        components: body.components.map((c) => {
          if (c.component_id === 'component-error') {
            return { component_id: c.component_id, status: 'error' as const, error_code: 'requested_offer_not_found' };
          }
          // 갱신됐음을 값으로도 확인할 수 있도록 단가를 8로 바꿔 응답한다(저장 시 10원).
          return { component_id: c.component_id, status: 'ok' as const, ...decisionPayloadFor('MPN-OK', 'digikey', 8, 1, c.required_quantity) };
        }),
      }));
    });

    const log = createLog();
    const items = [okItem, missingItem, errorItem];
    const result = await repriceCandidateSelections(1n, items, 2, 0, null, null, log);

    // 성공 행만 반환 — rowIdx 0(okItem) 하나만 스냅샷에 포함된다.
    expect(result).toHaveLength(1);
    expect(result?.[0]?.rowIdx).toBe(0);

    expect(okItem.orderQty).toBe(20);
    expect(okItem.selectedOffer?.unitPrice).toBe(8);
    expect(okItem.matchEvidence?.decisionReasonCodes).toEqual(['engine-procurement-recommendation']);

    for (const [degraded, originalPrice] of [[missingItem, missingOriginalOfferPrice], [errorItem, errorOriginalOfferPrice]] as const) {
      expect(degraded.selectedCandidateKey).not.toBeNull();
      expect(degraded.selectedOffer).not.toBeNull();
      expect(degraded.selectedOffer?.unitPrice).toBe(originalPrice);
      expect(degraded.matchStatus).toBe('auto');
      expect(degraded.selectionSource).toBe('auto');
      expect(degraded.orderQty).toBe(20);
    }
    expect(errorItem.matchEvidence?.decisionReasonCodes).toContain('engine-procurement-unavailable');

    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: '1',
        degradedRowCount: 2,
        missingComponentIdCount: 1,
        engineErrorCodes: expect.arrayContaining(['requested_offer_not_found']) as unknown as string[],
      }),
      expect.any(String),
    );
  });

  it('재평가에 실제로 성공한 행의 스냅샷만 반환한다(드리프트 없는 행은 제외 — 전량 재삽입 방지)', async () => {
    // 행 A — bomQty=20, 저장 needed=20 → setQty=1,spareQty=0 이면 드리프트 없음(재평가 불필요).
    const decisionA = buildDecision('component-a', 'MPN-A', 'digikey', 10, 1, 20);
    const itemA = autoSelectedItem('1', 0, 'component-a', decisionA, 20);
    // 행 B — bomQty=10, 저장 needed=5 → neededQty(10,1,0)=10 과 드리프트(재평가 필요).
    const decisionB = buildDecision('component-b', 'MPN-B', 'digikey', 10, 1, 5);
    const itemB = autoSelectedItem('2', 1, 'component-b', decisionB, 10);

    mockStoredCandidates([
      { id: '1', candidate: firstSnapshot(decisionA) },
      { id: '2', candidate: firstSnapshot(decisionB) },
    ]);
    engineFetchMock.mockImplementation((_path, init) => {
      const body = requestBody(init);
      expect(body.components).toHaveLength(1);
      expect(body.components[0]?.component_id).toBe('component-b');
      return Promise.resolve(jsonResponse({
        components: body.components.map((c) => ({ component_id: c.component_id, status: 'ok' as const, ...decisionPayloadFor('MPN-B', 'digikey', 10, 1, c.required_quantity) })),
      }));
    });

    const log = createLog();
    const result = await repriceCandidateSelections(1n, [itemA, itemB], 1, 0, null, null, log);

    expect(engineFetchMock).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result?.[0]?.rowIdx).toBe(1); // 행 B만 — 행 A는 손대지 않았으니 재삽입 대상이 아니다.
  });
});

// ── persistQuoteComputed — candidateSnapshotScope ────────────────────────────

function minimalItem(id: string, rowIdx: number): BomQuoteItemInputType & { id: string; lineTotalKrw: number | null } {
  return {
    id,
    rowIdx,
    included: true,
    mpn: `MPN-${id}`,
    manufacturerName: null,
    description: null,
    bomQty: 1,
    orderQty: 1,
    matchStatus: 'none',
    matchEvidence: null,
    recommendedCandidateKey: null,
    selectedCandidateKey: null,
    selectionSource: 'none',
    partId: null,
    selectedOffer: null,
    sourceRow: null,
    sourceSheetIndex: null,
    sourceSheetName: null,
    lineTotalKrw: null,
  };
}

function buildTxMock() {
  return {
    spBomQuote: {
      findUnique: vi.fn().mockResolvedValue({ activeAnalysisRunId: null, items: [{ id: 10n }, { id: 11n }] }),
      update: vi.fn().mockResolvedValue({}),
    },
    spBomQuoteItem: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([{ id: 10n, rowIdx: 0 }, { id: 11n, rowIdx: 1 }]),
    },
    spBomAnalysisComponent: { findMany: vi.fn().mockResolvedValue([]) },
    spBomQuoteCandidate: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    spBomQuoteSheet: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    spBomQuoteSelectionEvent: { create: vi.fn().mockResolvedValue({}) },
  };
}
type TxMock = ReturnType<typeof buildTxMock>;

describe('persistQuoteComputed candidateSnapshotScope', () => {
  it("'partial'이면 candidateSnapshots에 등장한 quoteItemId만 지우고 다시 넣는다(전량 재삽입 방지)", async () => {
    const tx = buildTxMock();
    transactionMock.mockImplementation(async (callback: (tx: TxMock) => Promise<void>) => callback(tx));
    const decision = buildDecision('component-10', 'MPN-10', 'digikey', 10, 1, 5);

    await persistQuoteComputed(
      1n,
      { items: [minimalItem('10', 0), minimalItem('11', 1)], itemsTotal: 0, finalTotal: 0, uncostedCount: 0 },
      null,
      { candidateSnapshots: [{ rowIdx: 0, candidate: firstSnapshot(decision) }], candidateSnapshotScope: 'partial' },
    );

    expect(tx.spBomQuoteItem.findMany).toHaveBeenCalledWith({
      where: { quoteId: 1n, rowIdx: { in: [0] } },
      select: { id: true, rowIdx: true },
    });
    expect(tx.spBomQuoteCandidate.deleteMany).toHaveBeenCalledWith({
      where: { quoteId: 1n, quoteItemId: { in: [10n] } },
    });
    expect(tx.spBomQuoteCandidate.deleteMany).not.toHaveBeenCalledWith({ where: { quoteId: 1n } });
    expect(tx.spBomQuoteCandidate.createMany).toHaveBeenCalledTimes(1);
    const created = tx.spBomQuoteCandidate.createMany.mock.calls[0]?.[0] as { data: { quoteItemId: bigint }[] };
    expect(created.data).toHaveLength(1);
    expect(created.data[0]?.quoteItemId).toBe(10n);
    expect(transactionMock).toHaveBeenCalledWith(
      expect.any(Function),
      { maxWait: 10_000, timeout: 60_000 },
    );
  });

  it("'partial' 대상 행의 새 후보가 0건이어도 기존 후보를 제거한다", async () => {
    const tx = buildTxMock();
    transactionMock.mockImplementation(async (callback: (tx: TxMock) => Promise<void>) => callback(tx));

    await persistQuoteComputed(
      1n,
      { items: [minimalItem('10', 0), minimalItem('11', 1)], itemsTotal: 0, finalTotal: 0, uncostedCount: 0 },
      null,
      {
        candidateSnapshots: [],
        candidateSnapshotScope: 'partial',
        candidateSnapshotRowIndexes: [1],
      },
    );

    expect(tx.spBomQuoteItem.findMany).toHaveBeenCalledWith({
      where: { quoteId: 1n, rowIdx: { in: [1] } },
      select: { id: true, rowIdx: true },
    });
    expect(tx.spBomQuoteCandidate.deleteMany).toHaveBeenCalledWith({
      where: { quoteId: 1n, quoteItemId: { in: [11n] } },
    });
    expect(tx.spBomQuoteCandidate.createMany).not.toHaveBeenCalled();
  });

  it('scope 미지정(기본 full)이면 기존처럼 quoteId 전체 후보를 교체한다(공급사 검색 완료 반영 경로 보존)', async () => {
    const tx = buildTxMock();
    transactionMock.mockImplementation(async (callback: (tx: TxMock) => Promise<void>) => callback(tx));
    const decision = buildDecision('component-10', 'MPN-10', 'digikey', 10, 1, 5);

    await persistQuoteComputed(
      1n,
      { items: [minimalItem('10', 0), minimalItem('11', 1)], itemsTotal: 0, finalTotal: 0, uncostedCount: 0 },
      null,
      { candidateSnapshots: [{ rowIdx: 0, candidate: firstSnapshot(decision) }] },
    );

    expect(tx.spBomQuoteCandidate.deleteMany).toHaveBeenCalledWith({ where: { quoteId: 1n } });
  });
});
