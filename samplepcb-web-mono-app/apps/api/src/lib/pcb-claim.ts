import type { Prisma, SpOrderSpec } from '@prisma/client';
import type {
  PcbAsCaseClaimBriefType,
  PcbClaimEligibilityReasonType,
  PcbClaimEventActionType,
  PcbClaimFileViewType,
  PcbClaimStatusType,
  PcbClaimViewType,
} from '@sp/api-contract';
import { PcbClaimView } from '@sp/api-contract';
import { prisma } from './prisma';
import { getOrderInfoByCtId, type OrderInfo } from './g5-db';
import { deleteFromFileServer, uploadToFileServer, type UploadTarget } from './file-server';

// ── PCB 고객 클레임(A/S 접수, P5) — docs/PCB_PARTNER_TRACK.md §9 A/S ─────────
// BOM 클레임(lib/bom-claim.ts, D37)의 PCB 미러다. 값이 같아도 함수를 공유하지 않는다
// — BOM 사전 불변 관례(트랙 간 어휘 격리)와 같은 이유로, 한쪽 정책 변경이 다른 트랙에
// 새지 않게 여기 따로 선다. 클레임은 고객↔자사 축의 접수·검토·판정 원장이고, 처리
// 실행(재생산 A/S 케이스·환불 기록)은 기존 수단으로 갈라진다.

export const CLAIM_FILE_REF = 'sp_pcb_claim';
const CLAIM_UPLOAD_SERVICE_TYPE = 'pcb_claim';

const CLOSED_ORDER_LINE_STATUSES = new Set(['취소', '반품', '품절', '삭제']);
const CLAIMABLE_ORDER_STATUSES = new Set(['배송', '완료']);

export interface PcbClaimEligibilityInput {
  ctId: number | null;
  order: { odStatus: string; ctStatus: string } | null;
  hasActiveClaim: boolean;
}

/** 배송이 시작된 활성 주문행만 접수 가능(BOM 미러). 기한 게이트는 두지 않는다 —
 *  무기한 접수 + 관리자 판정으로 거른다(사용자 결정 08-15). */
export function resolvePcbClaimEligibilityReason(
  input: PcbClaimEligibilityInput,
): PcbClaimEligibilityReasonType | null {
  if (input.ctId === null) return 'NO_ORDER';
  if (input.order === null) return 'ORDER_NOT_FOUND';
  if (CLOSED_ORDER_LINE_STATUSES.has(input.order.ctStatus)) return 'LINE_CLOSED';
  if (
    !CLAIMABLE_ORDER_STATUSES.has(input.order.odStatus) ||
    !CLAIMABLE_ORDER_STATUSES.has(input.order.ctStatus)
  ) {
    return 'NOT_DELIVERED';
  }
  if (input.hasActiveClaim) return 'ACTIVE_CLAIM';
  return null;
}

export type PcbClaimAdminAction = Exclude<PcbClaimEventActionType, 'submitted'>;

const CLAIM_TRANSITIONS: Record<
  PcbClaimAdminAction,
  { from: PcbClaimStatusType; to: PcbClaimStatusType }
> = {
  review_started: { from: 'open', to: 'reviewing' },
  resolved: { from: 'reviewing', to: 'resolved' },
  rejected: { from: 'reviewing', to: 'rejected' },
};

/** 관리자 전이는 접수→검토→처리완료/처리불가 단방향(BOM 미러). */
export function resolvePcbClaimTransition(
  status: PcbClaimStatusType,
  action: PcbClaimAdminAction,
): PcbClaimStatusType | null {
  const transition = CLAIM_TRANSITIONS[action];
  return transition.from === status ? transition.to : null;
}

export const isPcbClaimActive = (status: string): boolean =>
  status === 'open' || status === 'reviewing';

export const pcbClaimActiveKey = (specId: bigint): string => `pcb:${specId.toString()}`;

export const pcbClaimOrderSnapshot = (order: OrderInfo) => ({
  odId: order.odId,
  odStatus: order.odStatus,
  ctStatus: order.rowCtStatus,
  settleCase: order.settleCase,
  receiptPrice: order.receiptPrice,
});

// ── 직렬화 ───────────────────────────────────────────────────────────────────

export const pcbClaimInclude = {
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  spec: { select: { projectName: true } },
} satisfies Prisma.SpPcbClaimInclude;

export type PcbClaimWithRelations = Prisma.SpPcbClaimGetPayload<{
  include: typeof pcbClaimInclude;
}>;

export const loadPcbClaimFilesMap = async (
  claimIds: bigint[],
): Promise<Map<string, PcbClaimFileViewType[]>> => {
  const map = new Map<string, PcbClaimFileViewType[]>();
  if (claimIds.length === 0) return map;
  const rows = await prisma.spFile.findMany({
    where: { refType: CLAIM_FILE_REF, refId: { in: claimIds } },
    orderBy: { id: 'asc' },
  });
  for (const f of rows) {
    const key = f.refId.toString();
    const list = map.get(key) ?? [];
    list.push({
      fileId: Number(f.id),
      name: f.originFileName,
      size: Number(f.size),
      uploadedBy: f.uploadedBy,
      uploadedAt: f.writeDate.toISOString(),
    });
    map.set(key, list);
  }
  return map;
};

/** DB 문자열 상태·JSON 스냅샷도 공유 Zod 계약을 통과한 뒤에만 응답한다(BOM DTO 미러). */
export function toPcbClaimDto(
  claim: PcbClaimWithRelations,
  files: PcbClaimFileViewType[],
): PcbClaimViewType {
  return PcbClaimView.parse({
    id: String(claim.id),
    specId: String(claim.specId),
    projectName: claim.spec.projectName,
    mbId: claim.mbId,
    odId: claim.odId,
    ctId: claim.ctId,
    status: claim.status,
    kind: claim.kind,
    description: claim.description,
    orderedQty: claim.orderedQty,
    affectedQty: claim.affectedQty,
    requestedRemedy: claim.requestedRemedy,
    orderSnapshot: claim.orderSnapshot,
    version: claim.version,
    createdByRole: claim.createdByRole,
    adminMbId: claim.adminMbId,
    adminResponse: claim.adminResponse,
    faultType: claim.faultType,
    resolutionKind: claim.resolutionKind,
    chargeAmount: claim.chargeAmount,
    refundAmount: claim.refundAmount,
    returnRequired: claim.returnRequired,
    returnNote: claim.returnNote,
    asCaseId: claim.asCaseId === null ? null : Number(claim.asCaseId),
    submittedAt: claim.submittedAt.toISOString(),
    reviewStartedAt: claim.reviewStartedAt?.toISOString() ?? null,
    closedAt: claim.closedAt?.toISOString() ?? null,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
    files,
    events: claim.events.map((event) => ({
      id: String(event.id),
      action: event.action,
      actorRole: event.actorRole,
      actorMbId: event.actorMbId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
    })),
  });
}

export const serializePcbClaims = async (
  rows: PcbClaimWithRelations[],
): Promise<PcbClaimViewType[]> => {
  const filesMap = await loadPcbClaimFilesMap(rows.map((r) => r.id));
  return rows.map((r) => toPcbClaimDto(r, filesMap.get(r.id.toString()) ?? []));
};

// ── 생성(고객·관리자 대리 공용 코어) ─────────────────────────────────────────

export type CreatePcbClaimError = PcbClaimEligibilityReasonType | 'QTY_EXCEEDS_ORDER';

export interface CreatePcbClaimInput {
  kind: string;
  affectedQty: number;
  description: string;
  requestedRemedy: string;
  createdByRole: 'customer' | 'admin';
  createdBy: string;
}

/** 접수 코어 — 게이트(주문·활성 클레임)와 UK(activeKey) 이중 방어. 호출부가 스펙
 *  소유권(고객 mbId)·관리자 권한을 먼저 판정한 뒤 들어온다. */
export const createPcbClaim = async (
  spec: SpOrderSpec,
  input: CreatePcbClaimInput,
): Promise<
  { ok: true; claim: PcbClaimWithRelations } | { ok: false; error: CreatePcbClaimError }
> => {
  const order = spec.ctId === null ? null : await getOrderInfoByCtId(spec.ctId);
  const active = await prisma.spPcbClaim.findFirst({
    where: { specId: spec.id, activeKey: { not: null } },
    select: { id: true },
  });
  const reason = resolvePcbClaimEligibilityReason({
    ctId: spec.ctId,
    order: order === null ? null : { odStatus: order.odStatus, ctStatus: order.rowCtStatus },
    hasActiveClaim: active !== null,
  });
  if (reason !== null) return { ok: false, error: reason };
  if (spec.ctId === null || order === null) return { ok: false, error: 'ORDER_NOT_FOUND' };
  if (input.affectedQty > spec.qty) return { ok: false, error: 'QTY_EXCEEDS_ORDER' };

  try {
    const claim = await prisma.spPcbClaim.create({
      data: {
        specId: spec.id,
        mbId: spec.mbId ?? '',
        odId: order.odId,
        ctId: spec.ctId,
        activeKey: pcbClaimActiveKey(spec.id),
        kind: input.kind,
        description: input.description,
        orderedQty: spec.qty,
        affectedQty: input.affectedQty,
        requestedRemedy: input.requestedRemedy,
        orderSnapshot: pcbClaimOrderSnapshot(order),
        createdByRole: input.createdByRole,
        createdBy: input.createdBy,
        events: {
          create: {
            action: 'submitted',
            actorRole: input.createdByRole,
            actorMbId: input.createdBy,
            fromStatus: null,
            toStatus: 'open',
          },
        },
      },
      include: pcbClaimInclude,
    });
    return { ok: true, claim };
  } catch (error) {
    // activeKey UK — 게이트 검사~생성 사이 경합은 UK 가 잡는다(P2002 → ACTIVE_CLAIM).
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return { ok: false, error: 'ACTIVE_CLAIM' };
    }
    throw error;
  }
};

// ── 첨부 — 고객(CUSTOMER)·관리자 대리(ADMIN) 업로드, 케이스 첨부 규약 동형 ────

export const uploadPcbClaimFile = async (
  claimId: bigint,
  file: UploadTarget,
  uploadedBy: 'CUSTOMER' | 'ADMIN',
): Promise<PcbClaimFileViewType> => {
  const [uploaded] = await uploadToFileServer([file], CLAIM_UPLOAD_SERVICE_TYPE);
  if (uploaded === undefined) throw new Error('클레임 파일 업로드에 실패했습니다');
  const row = await prisma.spFile.create({
    data: {
      refType: CLAIM_FILE_REF,
      refId: claimId,
      uploadFileName: uploaded.uploadFileName,
      originFileName: file.filename,
      pathToken: uploaded.pathToken,
      size: BigInt(file.buffer.length),
      writeDate: new Date(),
      fileType: null,
      uploadedBy,
    },
  });
  return {
    fileId: Number(row.id),
    name: row.originFileName,
    size: Number(row.size),
    uploadedBy: row.uploadedBy,
    uploadedAt: row.writeDate.toISOString(),
  };
};

export const getPcbClaimFileDownload = async (
  claimId: bigint,
  fileId: bigint,
): Promise<{ pathToken: string; originFileName: string } | null> => {
  const row = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (row === null) return null;
  if (row.refType !== CLAIM_FILE_REF || row.refId !== claimId) return null;
  return { pathToken: row.pathToken, originFileName: row.originFileName };
};

/** 클레임 첨부 전량 삭제(실파일 먼저 → DB — 삭제 순서 불변식). 스펙 cascade 삭제와
 *  별개로, 클레임을 직접 지울 일이 생기면 이 헬퍼를 먼저 부른다. */
export const deleteAllPcbClaimFiles = async (claimId: bigint): Promise<void> => {
  const rows = await prisma.spFile.findMany({
    where: { refType: CLAIM_FILE_REF, refId: claimId },
  });
  for (const row of rows) {
    await deleteFromFileServer(row.pathToken);
    await prisma.spFile.delete({ where: { id: row.id } });
  }
};

// ── A/S 케이스 연결 요약 — 협력사에게 증상·수량·고객 사진을 참조로 노출 ────────
// 파일 실물을 복사하지 않는다(같은 pathToken 을 두 refType 이 참조하면 한쪽 삭제가
// 다른 쪽 실파일을 끊는다). 다운로드는 케이스 경유 라우트가 연결을 검증해 스트림한다.

export const findPcbClaimByAsCase = async (
  asCaseId: bigint,
): Promise<PcbClaimWithRelations | null> =>
  prisma.spPcbClaim.findFirst({
    where: { asCaseId },
    include: pcbClaimInclude,
    orderBy: { id: 'desc' },
  });

export const toPcbAsCaseClaimBrief = async (
  claim: PcbClaimWithRelations,
): Promise<PcbAsCaseClaimBriefType> => {
  const filesMap = await loadPcbClaimFilesMap([claim.id]);
  return {
    claimId: String(claim.id),
    kind: claim.kind as PcbAsCaseClaimBriefType['kind'],
    description: claim.description,
    orderedQty: claim.orderedQty,
    affectedQty: claim.affectedQty,
    files: filesMap.get(claim.id.toString()) ?? [],
  };
};
