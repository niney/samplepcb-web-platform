import { describe, expect, it } from 'vitest';
import type { AdminBomCaseDeletePreviewType } from '@sp/api-contract';
import {
  bomCaseNo,
  deriveBomCaseDeletePolicy,
  validateBomCaseDeleteRequest,
} from './bom-case-delete';

const preview = (
  overrides: Partial<AdminBomCaseDeletePreviewType> = {},
): AdminBomCaseDeletePreviewType => ({
  case: {
    id: '31',
    caseNo: 'CASE-B-260801-31',
    title: 'test.xlsx',
    mbId: 'member',
    status: 'reviewing',
    createdAt: '2026-08-01T01:00:00.000Z',
    requestedAt: '2026-08-01T02:00:00.000Z',
  },
  impact: {
    quoteItems: 3,
    quoteSheets: 1,
    candidates: 9,
    selectionEvents: 2,
    analysisRecords: 8,
    supplierSearchRecords: 6,
    engineJobs: 2,
    rfqs: 1,
    rfqItems: 3,
    pos: 0,
    poItems: 0,
    quoteFiles: 1,
    shipments: 0,
    shipmentFiles: 0,
  },
  order: {
    state: 'none',
    action: 'none',
    odId: null,
    odStatus: null,
    paymentProtected: false,
    siblingCount: 0,
    relatedRecords: 0,
  },
  shipment: { total: 0, shared: 0, willDelete: 0, inProgress: 0 },
  sentRfqCount: 1,
  externalPoCount: 0,
  canDelete: true,
  blockers: [],
  warnings: ['SENT_EMAILS_REMAIN', 'FILES_PERMANENTLY_DELETED'],
  previewToken: 'a'.repeat(64),
  ...overrides,
});

describe('SmartBOM Case 영구 삭제 정책', () => {
  it('Case 번호 날짜를 KST 기준으로 만든다', () => {
    expect(bomCaseNo(31n, null, new Date('2026-07-31T16:30:00.000Z'))).toBe(
      'CASE-B-260801-31',
    );
  });

  it('결제 주문은 기본 차단해 별도 강제 확인을 요구한다', () => {
    const policy = deriveBomCaseDeletePolicy({
      orderExists: true,
      paidOrder: true,
      orderSiblingCount: 0,
      orderLinkInconsistent: false,
      engineJobInProgress: false,
      shipmentLinkInconsistent: false,
    });

    expect(policy.blockers).toEqual(['PAID_ORDER']);
  });

  it('다른 Case가 같은 주문에 있으면 결제 여부와 관계없이 단건 삭제를 차단한다', () => {
    const policy = deriveBomCaseDeletePolicy({
      orderExists: true,
      paidOrder: false,
      orderSiblingCount: 2,
      orderLinkInconsistent: false,
      engineJobInProgress: false,
      shipmentLinkInconsistent: false,
    });

    expect(policy.blockers).toEqual(['SHARED_ORDER']);
  });

  it('PO와 선적이 있어도 하드 삭제 가능하면 기록 없는 모드도 허용한다', () => {
    const policy = deriveBomCaseDeletePolicy({
      orderExists: false,
      paidOrder: false,
      orderSiblingCount: 0,
      orderLinkInconsistent: false,
      engineJobInProgress: false,
      shipmentLinkInconsistent: false,
    });

    expect(policy.blockers).toEqual([]);
  });

  it('분석·검색 중인 엔진 잡은 파일과 결과가 안정될 때까지 삭제를 차단한다', () => {
    const policy = deriveBomCaseDeletePolicy({
      orderExists: false,
      paidOrder: false,
      orderSiblingCount: 0,
      orderLinkInconsistent: false,
      engineJobInProgress: true,
      shipmentLinkInconsistent: false,
    });

    expect(policy.blockers).toEqual(['ENGINE_JOB_IN_PROGRESS']);
  });

  it('Case와 다른 영카트 품목 연결은 다른 장바구니를 지우지 않도록 차단한다', () => {
    const policy = deriveBomCaseDeletePolicy({
      orderExists: false,
      paidOrder: false,
      orderSiblingCount: 0,
      orderLinkInconsistent: true,
      engineJobInProgress: false,
      shipmentLinkInconsistent: false,
    });

    expect(policy.blockers).toEqual(['ORDER_LINK_INCONSISTENT']);
  });

  it('실행은 최신 프리뷰와 선택한 기록 모드의 허용 여부를 요구한다', () => {
    const current = preview();
    expect(
      validateBomCaseDeleteRequest(current, {
        mode: 'audited',
        reason: '중복 Case 정리',
        previewToken: current.previewToken,
        acknowledgeIrreversible: true,
      }),
    ).toBeNull();
    expect(
      validateBomCaseDeleteRequest(current, {
        mode: 'audited',
        reason: '중복 Case 정리',
        previewToken: 'b'.repeat(64),
        acknowledgeIrreversible: true,
      }),
    ).toBe('STALE_PREVIEW');
    expect(
      validateBomCaseDeleteRequest(current, {
        mode: 'reset',
        previewToken: current.previewToken,
        acknowledgeIrreversible: true,
      }),
    ).toBeNull();
  });

  it('PAID_ORDER만 남은 프리뷰는 강제 체크로 해제하지만 공유 주문은 해제하지 않는다', () => {
    const paid = preview({
      canDelete: false,
      blockers: ['PAID_ORDER'],
      order: {
        state: 'ordered',
        action: 'delete-paid-order',
        odId: '202608010001',
        odStatus: '입금',
        paymentProtected: true,
        siblingCount: 0,
        relatedRecords: 3,
      },
    });
    const common = {
      mode: 'reset' as const,
      previewToken: paid.previewToken,
      acknowledgeIrreversible: true as const,
    };
    expect(validateBomCaseDeleteRequest(paid, common)).toBe('DELETE_BLOCKED');
    expect(
      validateBomCaseDeleteRequest(paid, { ...common, forceDeletePaidOrder: true }),
    ).toBeNull();
    expect(
      validateBomCaseDeleteRequest(
        { ...paid, blockers: ['PAID_ORDER', 'SHARED_ORDER'] },
        { ...common, forceDeletePaidOrder: true },
      ),
    ).toBe('DELETE_BLOCKED');
  });
});
