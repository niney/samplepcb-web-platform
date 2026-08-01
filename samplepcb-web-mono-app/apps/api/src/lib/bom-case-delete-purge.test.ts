import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminBomCaseDeletePreviewType } from '@sp/api-contract';

const mocks = vi.hoisted(() => ({
  deleteCartRow: vi.fn(),
  deleteCartRowIfUnordered: vi.fn(),
  deleteQuoteOption: vi.fn(),
  deleteUnpaidOrder: vi.fn(),
  detachShipmentPo: vi.fn(),
  deleteFromFileServer: vi.fn(),
  engineFetch: vi.fn(),
  forgetBomEngineJobs: vi.fn(),
  quoteLock: vi.fn(),
  poDeleteMany: vi.fn(),
  auditCreate: vi.fn(),
  fileDeleteMany: vi.fn(),
  quoteDelete: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./g5-db', () => ({
  TEMPLATE_ITEMS: { bom: 'sp-bom-parts' },
  deleteCartRow: mocks.deleteCartRow,
  deleteCartRowIfUnordered: mocks.deleteCartRowIfUnordered,
  deleteQuoteOption: mocks.deleteQuoteOption,
  deleteUnpaidOrder: mocks.deleteUnpaidOrder,
  getCartRowByCtId: vi.fn(),
  getOrderDeletionInfoByCtId: vi.fn(),
}));
vi.mock('./bom-po', () => ({ detachShipmentPo: mocks.detachShipmentPo }));
vi.mock('./file-server', () => ({ deleteFromFileServer: mocks.deleteFromFileServer }));
vi.mock('./engine-client', () => ({ engineFetch: mocks.engineFetch }));
vi.mock('./bom-engine-jobs', () => ({ forgetBomEngineJobs: mocks.forgetBomEngineJobs }));
vi.mock('./prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import {
  BomCaseDeleteExecutionError,
  purgeBomCase,
  type LoadedBomCaseDeletePlan,
} from './bom-case-delete';

const basePreview = (): AdminBomCaseDeletePreviewType => ({
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
    engineJobs: 1,
    rfqs: 1,
    rfqItems: 3,
    pos: 1,
    poItems: 3,
    quoteFiles: 1,
    shipments: 1,
    shipmentFiles: 0,
  },
  order: {
    state: 'cart',
    action: 'remove-cart-row',
    odId: null,
    odStatus: null,
    paymentProtected: false,
    siblingCount: 0,
    relatedRecords: 0,
  },
  shipment: { total: 1, shared: 1, willDelete: 0, inProgress: 0 },
  sentRfqCount: 1,
  externalPoCount: 0,
  canDelete: true,
  blockers: [],
  warnings: ['SENT_EMAILS_REMAIN', 'SHARED_SHIPMENT_PRESERVED'],
  previewToken: 'a'.repeat(64),
});

const plan = (): LoadedBomCaseDeletePlan => ({
  preview: basePreview(),
  quote: {
    id: 31n,
    mbId: 'member',
    title: 'test.xlsx',
    status: 'reviewing',
    ctId: 77,
    createdAt: new Date('2026-08-01T01:00:00.000Z'),
    requestedAt: new Date('2026-08-01T02:00:00.000Z'),
    updatedAt: new Date('2026-08-01T03:00:00.000Z'),
  },
  quoteFileTokens: ['bom/file-a'],
  engineJobIds: ['engine-job-a'],
  shipmentTargets: [{ shipmentId: 91n, targetPoIds: [71n], willDelete: false }],
  orderInfo: null,
});

describe('SmartBOM Case 영구 삭제 실행 순서', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.deleteCartRow.mockResolvedValue(undefined);
    mocks.deleteCartRowIfUnordered.mockResolvedValue(true);
    mocks.deleteQuoteOption.mockResolvedValue(undefined);
    mocks.deleteUnpaidOrder.mockResolvedValue('deleted');
    mocks.detachShipmentPo.mockResolvedValue({ ok: true });
    mocks.deleteFromFileServer.mockResolvedValue(undefined);
    mocks.engineFetch.mockResolvedValue(new Response(null, { status: 204 }));
    mocks.forgetBomEngineJobs.mockReturnValue(true);
    mocks.quoteLock.mockResolvedValue([{ id: 31n }]);
    mocks.poDeleteMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockReturnValue(Promise.resolve({ id: 1n }));
    mocks.fileDeleteMany.mockReturnValue(Promise.resolve({ count: 1 }));
    mocks.quoteDelete.mockReturnValue(Promise.resolve({ id: 31n }));
    mocks.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({
        $queryRaw: mocks.quoteLock,
        spBomPo: { deleteMany: mocks.poDeleteMany },
        spBomCaseDeleteAudit: { create: mocks.auditCreate },
        spFile: { deleteMany: mocks.fileDeleteMany },
        spBomQuote: { delete: mocks.quoteDelete },
      }),
    );
  });

  it('영카트→공유 선적 분리→실파일→감사행과 Case DB 삭제 순으로 처리한다', async () => {
    const result = await purgeBomCase(
      plan(),
      {
        mode: 'audited',
        reason: '중복 Case 정리',
        previewToken: 'a'.repeat(64),
        acknowledgeIrreversible: true,
      },
      { mbId: 'admin', ip: '127.0.0.1' },
    );

    expect(mocks.deleteCartRowIfUnordered).toHaveBeenCalledWith(
      77,
      'sp-bom-parts',
      'bom-31',
    );
    expect(mocks.deleteQuoteOption).toHaveBeenCalledWith('sp-bom-parts', 'bom-31');
    expect(mocks.detachShipmentPo).toHaveBeenCalledWith(91n, 71n, {
      allowAnyStatus: true,
    });
    expect(mocks.deleteFromFileServer).toHaveBeenCalledWith('bom/file-a');
    expect(mocks.engineFetch).toHaveBeenCalledWith('/jobs/engine-job-a', { method: 'DELETE' });
    expect(mocks.forgetBomEngineJobs).toHaveBeenCalledWith(['engine-job-a']);
    expect(mocks.auditCreate).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5_000,
      timeout: 30_000,
    });
    expect(mocks.deleteCartRowIfUnordered.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.detachShipmentPo.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.detachShipmentPo.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteFromFileServer.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.engineFetch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.detachShipmentPo.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.deleteFromFileServer.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.quoteDelete.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result).toMatchObject({
      caseId: '31',
      mode: 'audited',
      cartRemoved: true,
      shipmentMembershipsDetached: 1,
      auditRetained: true,
    });
  });

  it('기록 없는 모드는 PO·선적을 정리하면서 주문 복원행과 Case 감사행을 만들지 않는다', async () => {
    const resetPlan = plan();
    resetPlan.preview = {
      ...resetPlan.preview,
      order: {
        state: 'ordered',
        action: 'delete-unpaid-order',
        odId: '202608010001',
        odStatus: '주문',
        paymentProtected: false,
        siblingCount: 0,
        relatedRecords: 0,
      },
    };
    resetPlan.orderInfo = {
      odId: '202608010001',
      odStatus: '주문',
      isPaid: false,
      receiptPrice: 0,
      receiptPoint: 0,
      cartCoupon: 0,
      orderCoupon: 0,
      sendCoupon: 0,
      cartPrice: 1000,
      settleCase: '무통장',
      hasPgTransaction: false,
      pg: '',
      misu: 1000,
      siblingCarts: [],
      rowCtStatus: '주문',
      rowIoId: 'bom-31',
      rowIoPrice: 1000,
      relatedRecordCount: 0,
    };

    const result = await purgeBomCase(
      resetPlan,
      {
        mode: 'reset',
        previewToken: 'a'.repeat(64),
        acknowledgeIrreversible: true,
      },
      { mbId: 'admin', ip: '127.0.0.1' },
    );

    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.deleteUnpaidOrder).toHaveBeenCalledWith(
      '202608010001',
      'admin',
      '127.0.0.1',
      { ctId: 77, itId: 'sp-bom-parts', ioId: 'bom-31', ctStatus: '주문' },
      { retainBackup: false, deleteExclusiveCart: true },
    );
    expect(mocks.detachShipmentPo).toHaveBeenCalledWith(91n, 71n, {
      allowAnyStatus: true,
    });
    expect(mocks.poDeleteMany).toHaveBeenCalledOnce();
    expect(result.auditRetained).toBe(false);
  });

  it('확인 후 결제가 반영되면 외부 파일과 Case DB를 건드리기 전에 중단한다', async () => {
    const paidRacePlan = plan();
    paidRacePlan.preview = {
      ...paidRacePlan.preview,
      order: {
        state: 'ordered',
        action: 'delete-unpaid-order',
        odId: '202608010001',
        odStatus: '주문',
        paymentProtected: false,
        siblingCount: 0,
        relatedRecords: 0,
      },
    };
    paidRacePlan.orderInfo = {
      odId: '202608010001',
      odStatus: '주문',
      isPaid: false,
      receiptPrice: 0,
      receiptPoint: 0,
      cartCoupon: 0,
      orderCoupon: 0,
      sendCoupon: 0,
      cartPrice: 1000,
      settleCase: '무통장',
      hasPgTransaction: false,
      pg: '',
      misu: 1000,
      siblingCarts: [],
      rowCtStatus: '주문',
      rowIoId: 'bom-31',
      rowIoPrice: 1000,
      relatedRecordCount: 0,
    };
    mocks.deleteUnpaidOrder.mockResolvedValue('paid');

    await expect(
      purgeBomCase(
        paidRacePlan,
        {
          mode: 'audited',
          reason: '중복 Case 정리',
          previewToken: 'a'.repeat(64),
          acknowledgeIrreversible: true,
        },
        { mbId: 'admin', ip: '127.0.0.1' },
      ),
    ).rejects.toEqual(new BomCaseDeleteExecutionError('PAID_ORDER'));
    expect(mocks.deleteUnpaidOrder).toHaveBeenCalledWith(
      '202608010001',
      'admin',
      '127.0.0.1',
      { ctId: 77, itId: 'sp-bom-parts', ioId: 'bom-31', ctStatus: '주문' },
      { retainBackup: true, deleteExclusiveCart: true },
    );
    expect(mocks.deleteQuoteOption).not.toHaveBeenCalled();
    expect(mocks.detachShipmentPo).not.toHaveBeenCalled();
    expect(mocks.deleteFromFileServer).not.toHaveBeenCalled();
    expect(mocks.engineFetch).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('결제 강제 체크가 있으면 배타 결제 주문 삭제 옵션을 전달하고 결과에 표시한다', async () => {
    const paidPlan = plan();
    paidPlan.preview = {
      ...paidPlan.preview,
      order: {
        state: 'ordered',
        action: 'delete-paid-order',
        odId: '202608010002',
        odStatus: '입금',
        paymentProtected: true,
        siblingCount: 0,
        relatedRecords: 2,
      },
      canDelete: false,
      blockers: ['PAID_ORDER'],
      warnings: ['PAID_ORDER_PERMANENTLY_DELETED'],
    };
    paidPlan.orderInfo = {
      odId: '202608010002',
      odStatus: '입금',
      isPaid: true,
      receiptPrice: 1000,
      receiptPoint: 0,
      cartCoupon: 0,
      orderCoupon: 0,
      sendCoupon: 0,
      cartPrice: 1000,
      settleCase: '무통장',
      hasPgTransaction: false,
      pg: '',
      misu: 0,
      siblingCarts: [],
      rowCtStatus: '입금',
      rowIoId: 'bom-31',
      rowIoPrice: 1000,
      relatedRecordCount: 2,
    };

    const result = await purgeBomCase(
      paidPlan,
      {
        mode: 'reset',
        previewToken: 'a'.repeat(64),
        acknowledgeIrreversible: true,
        forceDeletePaidOrder: true,
      },
      { mbId: 'admin', ip: '127.0.0.1' },
    );

    expect(mocks.deleteUnpaidOrder).toHaveBeenCalledWith(
      '202608010002',
      'admin',
      '127.0.0.1',
      { ctId: 77, itId: 'sp-bom-parts', ioId: 'bom-31', ctStatus: '입금' },
      {
        retainBackup: false,
        deleteExclusiveCart: true,
        allowPaymentEvidence: true,
      },
    );
    expect(result.orderDeleted).toBe(true);
    expect(result.paidOrderDeleted).toBe(true);
  });

  it('sp-node의 결과 반영 작업이 실행 중이면 Case DB 삭제를 미룬다', async () => {
    mocks.forgetBomEngineJobs.mockReturnValue(false);

    await expect(
      purgeBomCase(
        plan(),
        {
          mode: 'audited',
          reason: '중복 Case 정리',
          previewToken: 'a'.repeat(64),
          acknowledgeIrreversible: true,
        },
        { mbId: 'admin', ip: '127.0.0.1' },
      ),
    ).rejects.toEqual(new BomCaseDeleteExecutionError('ENGINE_JOB_ACTIVE'));
    expect(mocks.detachShipmentPo).not.toHaveBeenCalled();
    expect(mocks.deleteFromFileServer).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('최종 잠금 직전 선적 소속이 생긴 PO는 cascade하지 않고 전체 DB 삭제를 롤백한다', async () => {
    mocks.poDeleteMany.mockResolvedValue({ count: 0 });

    await expect(
      purgeBomCase(
        plan(),
        {
          mode: 'audited',
          reason: '중복 Case 정리',
          previewToken: 'a'.repeat(64),
          acknowledgeIrreversible: true,
        },
        { mbId: 'admin', ip: '127.0.0.1' },
      ),
    ).rejects.toEqual(new BomCaseDeleteExecutionError('STALE_PREVIEW'));
    expect(mocks.auditCreate).not.toHaveBeenCalled();
    expect(mocks.fileDeleteMany).not.toHaveBeenCalled();
    expect(mocks.quoteDelete).not.toHaveBeenCalled();
  });
});
