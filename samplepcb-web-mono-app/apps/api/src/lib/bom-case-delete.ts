import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { BomQuoteStatus } from '@sp/api-contract';
import type {
  AdminBomCaseDeleteBlockerType,
  AdminBomCaseDeleteBodyType,
  AdminBomCaseDeletePreviewType,
  AdminBomCaseDeleteResponseType,
  AdminBomCaseDeleteWarningType,
} from '@sp/api-contract';
import { forgetBomEngineJobs } from './bom-engine-jobs';
import { detachShipmentPo } from './bom-po';
import { engineFetch } from './engine-client';
import { deleteFromFileServer } from './file-server';
import {
  TEMPLATE_ITEMS,
  deleteCartRowIfUnordered,
  deleteQuoteOption,
  deleteUnpaidOrder,
  getCartRowByCtId,
  getOrderDeletionInfoByCtId,
} from './g5-db';
import type { CartRowInfo, CartState, OrderDeletionInfo } from './g5-db';
import { prisma } from './prisma';

const QUOTE_FILE_REF_TYPE = 'sp_bom_quote';
const SHIPMENT_FILE_REF_TYPE = 'sp_bom_shipment';

export interface BomCaseDeleteActor {
  mbId: string;
  ip: string;
}

interface BomCaseDeleteQuoteSnapshot {
  id: bigint;
  mbId: string;
  title: string;
  status: string;
  ctId: number | null;
  createdAt: Date;
  requestedAt: Date | null;
  updatedAt: Date;
}

interface BomCaseDeleteShipmentTarget {
  shipmentId: bigint;
  targetPoIds: bigint[];
  willDelete: boolean;
}

export interface LoadedBomCaseDeletePlan {
  preview: AdminBomCaseDeletePreviewType;
  quote: BomCaseDeleteQuoteSnapshot;
  quoteFileTokens: string[];
  engineJobIds: string[];
  shipmentTargets: BomCaseDeleteShipmentTarget[];
  orderInfo: OrderDeletionInfo | null;
}

export type BomCaseDeleteValidationError =
  | 'STALE_PREVIEW'
  | 'DELETE_BLOCKED';

export class BomCaseDeleteExecutionError extends Error {
  constructor(
    readonly code: 'PAID_ORDER' | 'ENGINE_JOB_ACTIVE' | 'STALE_PREVIEW' | 'DELETE_FAILED',
  ) {
    super(code);
    this.name = 'BomCaseDeleteExecutionError';
  }
}

const pushUnique = <T>(target: T[], value: T): void => {
  if (!target.includes(value)) target.push(value);
};

/** 표시용 파생 번호. 브라우저 로컬 시간에 기대지 않고 업무 기준 KST로 고정한다. */
export function bomCaseNo(
  id: bigint,
  requestedAt: Date | null,
  createdAt: Date,
): string {
  const source = requestedAt ?? createdAt;
  const kst = new Date(source.getTime() + 9 * 60 * 60 * 1000);
  const yy = String(kst.getUTCFullYear() % 100).padStart(2, '0');
  const mm = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(kst.getUTCDate()).padStart(2, '0');
  return `CASE-B-${yy}${mm}${dd}-${String(id)}`;
}

export function validateBomCaseDeleteRequest(
  preview: AdminBomCaseDeletePreviewType,
  body: AdminBomCaseDeleteBodyType,
): BomCaseDeleteValidationError | null {
  if (body.previewToken !== preview.previewToken) return 'STALE_PREVIEW';
  const remainingBlockers = preview.blockers.filter(
    (blocker) => !(blocker === 'PAID_ORDER' && body.forceDeletePaidOrder === true),
  );
  if (remainingBlockers.length > 0) return 'DELETE_BLOCKED';
  return null;
}

export interface BomCaseDeletePolicyInput {
  orderExists: boolean;
  paidOrder: boolean;
  orderSiblingCount: number;
  openClaimCount: number;
  orderLinkInconsistent: boolean;
  engineJobInProgress: boolean;
  shipmentLinkInconsistent: boolean;
}

/** 거래·물류 facts를 삭제/초기화 정책으로 바꾸는 순수 결정 함수. */
export function deriveBomCaseDeletePolicy(input: BomCaseDeletePolicyInput): {
  blockers: AdminBomCaseDeleteBlockerType[];
} {
  const blockers: AdminBomCaseDeleteBlockerType[] = [];
  if (input.paidOrder) pushUnique(blockers, 'PAID_ORDER');
  if (input.orderExists && input.orderSiblingCount > 0) {
    pushUnique(blockers, 'SHARED_ORDER');
  }
  if (input.openClaimCount > 0) pushUnique(blockers, 'OPEN_CLAIM');
  if (input.orderLinkInconsistent) pushUnique(blockers, 'ORDER_LINK_INCONSISTENT');
  if (input.engineJobInProgress) pushUnique(blockers, 'ENGINE_JOB_IN_PROGRESS');
  if (input.shipmentLinkInconsistent) pushUnique(blockers, 'SHIPMENT_LINK_INCONSISTENT');
  return { blockers };
}

const loadShipmentRows = async (quoteId: bigint, targetPoIds: readonly bigint[]) => {
  return prisma.spBomShipment.findMany({
    where: {
      OR: [
        // quoteId는 대표 발주서의 Case를 비정규화한 값이다. 조인 소속과 어긋난
        // 기존 데이터도 놓치지 않고 차단하려고 직접 조건을 함께 조회한다.
        { quoteId },
        { poId: { in: [...targetPoIds] } },
        { pos: { some: { poId: { in: [...targetPoIds] } } } },
      ],
    },
    select: {
      id: true,
      poId: true,
      quoteId: true,
      mode: true,
      status: true,
      packingRevision: true,
      pos: {
        select: { poId: true, po: { select: { quoteId: true } } },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: { id: 'asc' },
  });
};

/**
 * 삭제 직전 서버가 다시 계산하는 영향 프리뷰. 파일 pathToken·내부 bigint는 반환하지 않는다.
 * 주문·결제는 g5에서, Case 자식·선적 소속은 sp DB에서 읽어 둘 중 하나라도 확인 실패하면
 * 삭제 자체를 시작하지 않는다.
 */
export async function loadBomCaseDeletePlan(
  quoteId: bigint,
): Promise<LoadedBomCaseDeletePlan | null> {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      mbId: true,
      title: true,
      status: true,
      buildStatus: true,
      enrichStatus: true,
      engineJobId: true,
      ctId: true,
      createdAt: true,
      requestedAt: true,
      updatedAt: true,
      pos: { select: { id: true, status: true, externalRef: true }, orderBy: { id: 'asc' } },
    },
  });
  if (quote === null) return null;

  const targetPoIds = quote.pos.map((po) => po.id);
  const [
    quoteItems,
    quoteSheets,
    candidates,
    selectionEvents,
    analysisRuns,
    analysisSheets,
    analysisComponents,
    supplierSearchRuns,
    supplierArtifacts,
    supplierTraces,
    rfqs,
    rfqItems,
    poItems,
    quoteFiles,
    shipments,
    packingRows,
    cartRow,
    orderInfo,
    activeClaims,
  ] = await Promise.all([
    prisma.spBomQuoteItem.count({ where: { quoteId } }),
    prisma.spBomQuoteSheet.count({ where: { quoteId } }),
    prisma.spBomQuoteCandidate.count({ where: { quoteId } }),
    prisma.spBomQuoteSelectionEvent.count({ where: { quoteId } }),
    prisma.spBomAnalysisRun.findMany({
      where: { quoteId },
      select: { engineJobId: true },
      orderBy: { id: 'asc' },
    }),
    prisma.spBomAnalysisSheet.count({ where: { analysisRun: { quoteId } } }),
    prisma.spBomAnalysisComponent.count({ where: { analysisRun: { quoteId } } }),
    prisma.spBomSupplierSearchRun.findMany({
      where: { quoteId },
      select: {
        engineJobId: true,
        status: true,
        resultArtifact: { select: { status: true } },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.spBomSupplierResultArtifact.count({ where: { supplierSearchRun: { quoteId } } }),
    prisma.spBomSupplierSearchTrace.count({ where: { supplierSearchRun: { quoteId } } }),
    prisma.spBomRfq.count({ where: { quoteId } }),
    prisma.spBomRfqItem.count({ where: { rfq: { quoteId } } }),
    prisma.spBomPoItem.count({ where: { po: { quoteId } } }),
    prisma.spFile.findMany({
      where: { refType: QUOTE_FILE_REF_TYPE, refId: quoteId },
      select: { pathToken: true },
      orderBy: { id: 'asc' },
    }),
    loadShipmentRows(quoteId, targetPoIds),
    prisma.spBomShipmentItem.findMany({
      where: { poItem: { poId: { in: targetPoIds } } },
      select: {
        id: true,
        shipmentId: true,
        poItemId: true,
        partId: true,
        expectedQty: true,
        updatedAt: true,
        packages: {
          select: {
            id: true,
            packageNo: true,
            quantity: true,
            status: true,
            updatedAt: true,
            _count: { select: { events: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    }),
    quote.ctId === null ? Promise.resolve<CartRowInfo | null>(null) : getCartRowByCtId(quote.ctId),
    quote.ctId === null ? Promise.resolve(null) : getOrderDeletionInfoByCtId(quote.ctId),
    prisma.spBomClaim.findMany({
      where: { quoteId, status: { in: ['open', 'reviewing'] } },
      select: { id: true, status: true, version: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
  ]);

  const shipmentTargets: BomCaseDeleteShipmentTarget[] = [];
  let sharedShipments = 0;
  let shipmentsToDelete = 0;
  let inProgressShipments = 0;
  let shipmentLinkInconsistent = false;
  const shipmentIdsToDelete: bigint[] = [];
  const targetPoIdSet = new Set(targetPoIds);

  for (const shipment of shipments) {
    const targetLinks = shipment.pos.filter((link) => targetPoIdSet.has(link.poId));
    const representativeLink = shipment.pos.find((link) => link.poId === shipment.poId);
    // 소속의 진실은 조인이고 shipment.poId/quoteId는 대표 캐시다. 대표가 조인에서
    // 빠졌거나 대표 Case가 다르면 자동 보정하지 않는다. 삭제가 다른 Case 선적까지
    // 건드릴 수 있으므로 운영자가 연결을 먼저 복구하게 한다.
    if (
      targetLinks.length === 0 ||
      representativeLink?.po.quoteId !== shipment.quoteId
    ) {
      shipmentLinkInconsistent = true;
      continue;
    }

    const hasOtherCases = shipment.pos.some((link) => link.po.quoteId !== quoteId);
    if (hasOtherCases) sharedShipments += 1;
    else {
      shipmentsToDelete += 1;
      shipmentIdsToDelete.push(shipment.id);
    }
    if (shipment.status !== 'preparing') {
      inProgressShipments += 1;
    }
    shipmentTargets.push({
      shipmentId: shipment.id,
      targetPoIds: targetLinks.map((link) => link.poId),
      willDelete: !hasOtherCases,
    });
  }

  const shipmentFileCount =
    shipmentIdsToDelete.length === 0
      ? 0
      : await prisma.spFile.count({
          where: { refType: SHIPMENT_FILE_REF_TYPE, refId: { in: shipmentIdsToDelete } },
        });
  const shipmentItemCount = packingRows.length;
  const shipmentPackageCount = packingRows.reduce((total, item) => total + item.packages.length, 0);
  const shipmentPackageEventCount = packingRows.reduce(
    (total, item) =>
      total +
      item.packages.reduce(
        (packageTotal, itemPackage) => packageTotal + itemPackage._count.events,
        0,
      ),
    0,
  );

  const engineJobIds = [
    ...new Set(
      [
        quote.engineJobId,
        ...analysisRuns.map((run) => run.engineJobId),
        ...supplierSearchRuns.map((run) => run.engineJobId),
      ].filter((jobId): jobId is string => jobId !== null),
    ),
  ];
  const engineJobInProgress =
    !['selecting', 'ready', 'failed'].includes(quote.buildStatus) ||
    !['idle', 'done', 'failed'].includes(quote.enrichStatus) ||
    supplierSearchRuns.some(
      (run) =>
        !['completed', 'failed'].includes(run.status) || run.resultArtifact?.status === 'running',
    );
  const externalPoCount = quote.pos.filter((po) => po.externalRef !== null).length;
  const paymentProtected =
    orderInfo?.isPaid === true ||
    (orderInfo?.receiptPrice ?? 0) !== 0 ||
    (orderInfo?.receiptPoint ?? 0) !== 0 ||
    (orderInfo?.cartCoupon ?? 0) !== 0 ||
    (orderInfo?.orderCoupon ?? 0) !== 0 ||
    (orderInfo?.sendCoupon ?? 0) !== 0 ||
    orderInfo?.hasPgTransaction === true;
  const cartState: CartState =
    cartRow === null ? 'none' : cartRow.ctStatus === '쇼핑' ? 'cart' : 'ordered';
  const bomTemplateItemId = TEMPLATE_ITEMS.bom;
  if (bomTemplateItemId === undefined) throw new Error('BOM template item is not configured');
  const expectedIoId = `bom-${String(quote.id)}`;
  const cartOwnsQuote =
    cartRow === null || (cartRow.itId === bomTemplateItemId && cartRow.ioId === expectedIoId);
  const orderSnapshotMatchesCart =
    orderInfo === null ||
    (cartRow !== null &&
      orderInfo.odId === cartRow.odId &&
      orderInfo.rowCtStatus === cartRow.ctStatus &&
      orderInfo.rowIoId === cartRow.ioId);
  const unpaidOrderRowValid =
    orderInfo === null || paymentProtected || orderInfo.rowCtStatus === '주문';
  const orderLinkInconsistent =
    !cartOwnsQuote || !orderSnapshotMatchesCart || !unpaidOrderRowValid;
  const orderAction = orderLinkInconsistent
    ? 'none'
    : orderInfo !== null && orderInfo.siblingCarts.length === 0
      ? paymentProtected
        ? 'delete-paid-order'
        : 'delete-unpaid-order'
      : quote.ctId !== null && (cartState === 'cart' || (cartState === 'ordered' && orderInfo === null))
        ? 'remove-cart-row'
        : 'none';

  const { blockers } = deriveBomCaseDeletePolicy({
    orderExists: orderInfo !== null,
    paidOrder: paymentProtected,
    orderSiblingCount: orderInfo?.siblingCarts.length ?? 0,
    openClaimCount: activeClaims.length,
    orderLinkInconsistent,
    engineJobInProgress,
    shipmentLinkInconsistent,
  });

  const warnings: AdminBomCaseDeleteWarningType[] = [];
  if (rfqs > 0) pushUnique(warnings, 'SENT_EMAILS_REMAIN');
  if (externalPoCount > 0) pushUnique(warnings, 'EXTERNAL_ACTIONS_REMAIN');
  if (sharedShipments > 0) pushUnique(warnings, 'SHARED_SHIPMENT_PRESERVED');
  if (orderAction === 'delete-unpaid-order') pushUnique(warnings, 'UNPAID_ORDER_DELETED');
  if (orderAction === 'delete-paid-order') {
    pushUnique(warnings, 'PAID_ORDER_PERMANENTLY_DELETED');
  }
  if (inProgressShipments > 0) {
    pushUnique(warnings, 'SHIPMENT_HISTORY_PERMANENTLY_DELETED');
  }
  if (quoteFiles.length + shipmentFileCount + engineJobIds.length > 0) {
    pushUnique(warnings, 'FILES_PERMANENTLY_DELETED');
  }

  const caseNumber = bomCaseNo(quote.id, quote.requestedAt, quote.createdAt);
  const status = BomQuoteStatus.parse(quote.status);
  const previewCore = {
    case: {
      id: String(quote.id),
      caseNo: caseNumber,
      title: quote.title,
      mbId: quote.mbId,
      status,
      createdAt: quote.createdAt.toISOString(),
      requestedAt: quote.requestedAt?.toISOString() ?? null,
    },
    impact: {
      quoteItems,
      quoteSheets,
      candidates,
      selectionEvents,
      analysisRecords: analysisRuns.length + analysisSheets + analysisComponents,
      supplierSearchRecords: supplierSearchRuns.length + supplierArtifacts + supplierTraces,
      engineJobs: engineJobIds.length,
      rfqs,
      rfqItems,
      pos: quote.pos.length,
      poItems,
      quoteFiles: quoteFiles.length,
      shipments: shipments.length,
      shipmentFiles: shipmentFileCount,
      shipmentItems: shipmentItemCount,
      shipmentPackages: shipmentPackageCount,
      shipmentPackageEvents: shipmentPackageEventCount,
    },
    order: {
      state: cartState,
      action: orderAction,
      odId: orderInfo?.odId ?? null,
      odStatus: orderInfo?.odStatus ?? null,
      paymentProtected,
      siblingCount: orderInfo?.siblingCarts.length ?? 0,
      relatedRecords: orderInfo?.relatedRecordCount ?? 0,
    },
    shipment: {
      total: shipments.length,
      shared: sharedShipments,
      willDelete: shipmentsToDelete,
      inProgress: inProgressShipments,
    },
    sentRfqCount: rfqs,
    externalPoCount,
    canDelete: blockers.length === 0,
    blockers,
    warnings,
  } satisfies Omit<AdminBomCaseDeletePreviewType, 'previewToken'>;

  // 응답 요약 외에도 같은 개수에서 바뀔 수 있는 PO/선적·주문 세부 상태를 토큰에 묶는다.
  const revision = {
    quoteUpdatedAt: quote.updatedAt.toISOString(),
    quoteBuildStatus: quote.buildStatus,
    quoteEnrichStatus: quote.enrichStatus,
    engineJobIds,
    supplierSearchStatuses: supplierSearchRuns.map((run) => ({
      status: run.status,
      artifactStatus: run.resultArtifact?.status ?? null,
    })),
    activeClaims: activeClaims.map((claim) => ({
      id: String(claim.id),
      status: claim.status,
      version: claim.version,
      updatedAt: claim.updatedAt.toISOString(),
    })),
    pos: quote.pos.map((po) => ({
      id: String(po.id),
      status: po.status,
      externalRef: po.externalRef,
    })),
    shipments: shipments.map((shipment) => ({
      id: String(shipment.id),
      poId: String(shipment.poId),
      quoteId: String(shipment.quoteId),
      mode: shipment.mode,
      status: shipment.status,
      packingRevision: shipment.packingRevision,
      poIds: shipment.pos.map((link) => String(link.poId)),
    })),
    packingRows: packingRows.map((item) => ({
      id: String(item.id),
      shipmentId: String(item.shipmentId),
      poItemId: String(item.poItemId),
      partId: item.partId === null ? null : String(item.partId),
      expectedQty: item.expectedQty,
      updatedAt: item.updatedAt.toISOString(),
      packages: item.packages.map((itemPackage) => ({
        id: String(itemPackage.id),
        packageNo: itemPackage.packageNo,
        quantity: itemPackage.quantity,
        status: itemPackage.status,
        updatedAt: itemPackage.updatedAt.toISOString(),
        eventCount: itemPackage._count.events,
      })),
    })),
    order:
      orderInfo === null
        ? null
        : {
            odId: orderInfo.odId,
            odStatus: orderInfo.odStatus,
            isPaid: orderInfo.isPaid,
            receiptPrice: orderInfo.receiptPrice,
            receiptPoint: orderInfo.receiptPoint,
            cartCoupon: orderInfo.cartCoupon,
            orderCoupon: orderInfo.orderCoupon,
            sendCoupon: orderInfo.sendCoupon,
            hasPgTransaction: orderInfo.hasPgTransaction,
            relatedRecordCount: orderInfo.relatedRecordCount,
            rowCtStatus: orderInfo.rowCtStatus,
            rowIoId: orderInfo.rowIoId,
            siblingCtIds: orderInfo.siblingCarts.map((row) => row.ctId),
          },
    cart:
      cartRow === null
        ? null
        : {
            odId: cartRow.odId,
            ctStatus: cartRow.ctStatus,
            itId: cartRow.itId,
            ioId: cartRow.ioId,
            ioPrice: cartRow.ioPrice,
          },
  };
  const previewToken = createHash('sha256')
    .update(JSON.stringify({ preview: previewCore, revision }))
    .digest('hex');

  return {
    preview: { ...previewCore, previewToken },
    quote: {
      id: quote.id,
      mbId: quote.mbId,
      title: quote.title,
      status: quote.status,
      ctId: quote.ctId,
      createdAt: quote.createdAt,
      requestedAt: quote.requestedAt,
      updatedAt: quote.updatedAt,
    },
    quoteFileTokens: quoteFiles.map((file) => file.pathToken),
    engineJobIds,
    shipmentTargets,
    orderInfo,
  };
}

const auditSnapshot = (
  preview: AdminBomCaseDeletePreviewType,
  forceDeletePaidOrder: boolean,
): Prisma.InputJsonObject => ({
  caseNo: preview.case.caseNo,
  impact: { ...preview.impact },
  order: { ...preview.order },
  shipment: { ...preview.shipment },
  sentRfqCount: preview.sentRfqCount,
  externalPoCount: preview.externalPoCount,
  warnings: [...preview.warnings],
  forceDeletePaidOrder,
  previewToken: preview.previewToken,
});

/** sp-engine 잡과 업로드 임시 원본 삭제. 404는 앞선 부분 성공의 멱등 재시도로 본다. */
const deleteBomEngineJobs = async (jobIds: readonly string[]): Promise<void> => {
  for (const jobId of jobIds) {
    const response = await engineFetch(`/jobs/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
    if (response.status === 409) {
      throw new BomCaseDeleteExecutionError('ENGINE_JOB_ACTIVE');
    }
    if (!response.ok && response.status !== 404) {
      throw new Error(`BOM engine job delete HTTP ${String(response.status)}`);
    }
  }
  if (!forgetBomEngineJobs(jobIds)) {
    throw new BomCaseDeleteExecutionError('ENGINE_JOB_ACTIVE');
  }
};

/** 검증이 끝난 단일 Case 삭제 실행. 외부 저장소→느슨한 파일행→Case 순으로 멱등 재시도한다. */
export async function purgeBomCase(
  plan: LoadedBomCaseDeletePlan,
  body: AdminBomCaseDeleteBodyType,
  actor: BomCaseDeleteActor,
): Promise<AdminBomCaseDeleteResponseType['data']> {
  const { preview, quote } = plan;
  let cartRemoved = false;
  let orderDeleted = false;

  if (
    preview.order.action === 'delete-unpaid-order' ||
    preview.order.action === 'delete-paid-order'
  ) {
    const paidOrderDelete = preview.order.action === 'delete-paid-order';
    if (paidOrderDelete && body.forceDeletePaidOrder !== true) {
      throw new BomCaseDeleteExecutionError('PAID_ORDER');
    }
    const orderInfo = plan.orderInfo;
    if (orderInfo === null) throw new BomCaseDeleteExecutionError('STALE_PREVIEW');
    const odId = orderInfo.odId;
    const ctId = quote.ctId;
    if (ctId === null) throw new BomCaseDeleteExecutionError('STALE_PREVIEW');
    const bomTemplateItemId = TEMPLATE_ITEMS.bom;
    if (bomTemplateItemId === undefined) throw new BomCaseDeleteExecutionError('DELETE_FAILED');
    const expectedIoId = `bom-${String(quote.id)}`;
    const outcome = await deleteUnpaidOrder(
      odId,
      actor.mbId,
      actor.ip,
      {
        ctId,
        itId: bomTemplateItemId,
        ioId: expectedIoId,
        ctStatus: orderInfo.rowCtStatus,
      },
      {
        retainBackup: body.mode === 'audited',
        deleteExclusiveCart: true,
        ...(paidOrderDelete ? { allowPaymentEvidence: true } : {}),
      },
    );
    if (outcome === 'paid') throw new BomCaseDeleteExecutionError('PAID_ORDER');
    if (outcome === 'shared' || outcome === 'stale') {
      throw new BomCaseDeleteExecutionError('STALE_PREVIEW');
    }
    orderDeleted = outcome === 'deleted';
    if (outcome === 'not_found') {
      const removed = await deleteCartRowIfUnordered(ctId, bomTemplateItemId, expectedIoId);
      if (!removed) throw new BomCaseDeleteExecutionError('STALE_PREVIEW');
      cartRemoved = removed;
    }
  } else if (preview.order.action === 'remove-cart-row' && quote.ctId !== null) {
    const bomTemplateItemId = TEMPLATE_ITEMS.bom;
    if (bomTemplateItemId === undefined) throw new BomCaseDeleteExecutionError('DELETE_FAILED');
    const removed = await deleteCartRowIfUnordered(
      quote.ctId,
      bomTemplateItemId,
      `bom-${String(quote.id)}`,
    );
    if (!removed) throw new BomCaseDeleteExecutionError('STALE_PREVIEW');
    cartRemoved = removed;
  }

  const bomTemplateItemId = TEMPLATE_ITEMS.bom;
  if (bomTemplateItemId === undefined) throw new BomCaseDeleteExecutionError('DELETE_FAILED');
  await deleteQuoteOption(bomTemplateItemId, `bom-${String(quote.id)}`);

  await deleteBomEngineJobs(plan.engineJobIds);

  let shipmentMembershipsDetached = 0;
  for (const shipment of plan.shipmentTargets) {
    for (const poId of shipment.targetPoIds) {
      const result = await detachShipmentPo(shipment.shipmentId, poId, {
        allowAnyStatus: true,
      });
      if (!result.ok) throw new BomCaseDeleteExecutionError('STALE_PREVIEW');
      shipmentMembershipsDetached += 1;
    }
  }

  // 파일서버 API는 404를 성공으로 취급한다. 실파일을 먼저 지워야 DB 실패 후에도
  // pathToken이 남아 같은 요청을 안전하게 재시도할 수 있다.
  for (const pathToken of plan.quoteFileTokens) {
    await deleteFromFileServer(pathToken);
  }

  await prisma.$transaction(
    async (tx) => {
      // 부모 행 X-lock이 새 RFQ/PO의 FK 검사를 막는다. 이미 들어온 PO는 아래 조건부
      // deleteMany 개수가 프리뷰와 정확히 같아야 하며, 선적 대표/소속인 PO는 건드리지 않는다.
      const locked = await tx.$queryRaw<{ id: bigint }[]>`
        SELECT id FROM sp_bom_quote WHERE id = ${quote.id} FOR UPDATE
      `;
      if (locked.length !== 1) throw new BomCaseDeleteExecutionError('STALE_PREVIEW');

      const deletedPos = await tx.spBomPo.deleteMany({
        where: {
          quoteId: quote.id,
          shipment: { is: null },
          shipmentLink: { is: null },
        },
      });
      if (deletedPos.count !== preview.impact.pos) {
        throw new BomCaseDeleteExecutionError('STALE_PREVIEW');
      }

      await tx.spFile.deleteMany({
        where: { refType: QUOTE_FILE_REF_TYPE, refId: quote.id },
      });
      if (body.mode === 'audited') {
        await tx.spDeleteAudit.create({
          data: {
            subjectType: 'bom_case',
            subjectId: quote.id.toString(),
            title: quote.title,
            mbId: quote.mbId,
            subjectStatus: quote.status,
            actorMbId: actor.mbId,
            actorIp: actor.ip,
            reason: body.reason,
            snapshot: auditSnapshot(preview, body.forceDeletePaidOrder === true),
          },
        });
      }
      await tx.spBomQuote.delete({ where: { id: quote.id } });
    },
    { maxWait: 5_000, timeout: 30_000 },
  );

  return {
    caseId: String(quote.id),
    mode: body.mode,
    deleted: preview.impact,
    cartRemoved,
    orderDeleted,
    paidOrderDeleted: orderDeleted && preview.order.action === 'delete-paid-order',
    shipmentMembershipsDetached,
    shipmentsDeleted: preview.shipment.willDelete,
    engineJobsDeleted: preview.impact.engineJobs,
    filesDeleted: preview.impact.quoteFiles + preview.impact.shipmentFiles,
    auditRetained: body.mode === 'audited',
  };
}
