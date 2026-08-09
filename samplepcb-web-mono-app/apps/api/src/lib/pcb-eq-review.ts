import type { SpFile, SpPcbEqReview } from '@prisma/client';
import type {
  AdminPcbEqReviewViewType,
  CustomerPcbEqReviewViewType,
  PcbEqReviewFileType,
  PcbEqReviewStatusType,
  PcbPoEqReviewSummaryType,
} from '@sp/api-contract';
import { prisma } from './prisma';

// ── PCB EQ 고객 확인 코어(P4.1) — docs/PCB_PARTNER_TRACK.md D16 ──────────────
// 협력사 EQ 를 고객에게 물어보는 축. **EQ 전이 머신을 건드리지 않는다** — 고객이
// 승인해도 발주서 status 는 eq_requested 그대로이고, eq_done 은 관리자가 누른다.
//
// 공개 파일: 관리자가 고른 sp_file.id 만 sharedFileIds 에 담기며 다운로드도 그 목록으로
// 검증한다. 협력사가 올린 EQ 첨부에는 협력사명·로고가 들어 있을 수 있어, 전체 자동
// 공개는 공급망을 드러낸다(사용자 결정 2026-08-07).

const EQ_REF_TYPE = 'sp_pcb_po_eq';

const parseKstDate = (s: string): Date => new Date(`${s}T00:00:00+09:00`);
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

export const asEqReviewStatus = (v: string): PcbEqReviewStatusType =>
  v === 'approved' || v === 'rejected' || v === 'canceled' ? v : 'requested';

/** sharedFileIds(Json) → bigint[]. 형식이 깨져 있어도 화면이 죽지 않게 방어적으로 읽는다. */
export const parseSharedFileIds = (json: unknown): bigint[] => {
  if (!Array.isArray(json)) return [];
  const out: bigint[] = [];
  for (const v of json) {
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) out.push(BigInt(v));
    else if (typeof v === 'string' && /^\d+$/.test(v)) out.push(BigInt(v));
  }
  return out;
};

/** 기한이 지났는데 아직 답이 없음 — 재촉 신호. 답이 온 뒤엔 늦었어도 overdue 가 아니다. */
const isOverdue = (row: Pick<SpPcbEqReview, 'status' | 'dueOn'>, now: Date): boolean =>
  row.status === 'requested' && row.dueOn !== null && row.dueOn.getTime() < now.getTime();

const toFileViews = (ids: readonly bigint[], files: Map<string, SpFile>): PcbEqReviewFileType[] =>
  ids
    .map((id) => files.get(id.toString()))
    .filter((f): f is SpFile => f !== undefined)
    .map((f) => ({ fileId: Number(f.id), name: f.originFileName, size: Number(f.size) }));

/** 여러 확인 요청의 공개 파일을 한 번에(N+1 회피). */
const loadSharedFiles = async (rows: readonly SpPcbEqReview[]): Promise<Map<string, SpFile>> => {
  const ids = [...new Set(rows.flatMap((r) => parseSharedFileIds(r.sharedFileIds)))];
  const map = new Map<string, SpFile>();
  if (ids.length === 0) return map;
  const files = await prisma.spFile.findMany({ where: { id: { in: ids } } });
  for (const f of files) map.set(f.id.toString(), f);
  return map;
};

export const listAdminEqReviews = async (
  poId: bigint,
): Promise<AdminPcbEqReviewViewType[]> => {
  const rows = await prisma.spPcbEqReview.findMany({
    where: { poId },
    orderBy: { id: 'desc' },
  });
  const files = await loadSharedFiles(rows);
  const now = new Date();
  return rows.map((r) => ({
    id: Number(r.id),
    poId: Number(r.poId),
    specId: Number(r.specId),
    status: asEqReviewStatus(r.status),
    message: r.message,
    dueOn: iso(r.dueOn),
    files: toFileViews(parseSharedFileIds(r.sharedFileIds), files),
    requestedBy: r.requestedBy,
    requestedAt: r.requestedAt.toISOString(),
    decidedBy: r.decidedBy,
    decidedAt: iso(r.decidedAt),
    decisionNote: r.decisionNote,
    overdue: isOverdue(r, now),
  }));
};

export type CreateEqReviewError = 'PO_NOT_FOUND' | 'NOT_EQ_REQUESTED' | 'ALREADY_OPEN' | 'BAD_FILES';

export const createEqReview = async (
  poId: bigint,
  body: { message: string; dueOn?: string | null; sharedFileIds: number[] },
  actorMbId: string,
): Promise<{ ok: true; reviewId: bigint } | { ok: false; error: CreateEqReviewError }> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId } });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  // EQ 승인요청이 올라온 상태에서만 물어볼 것이 있다.
  if (po.status !== 'eq_requested') return { ok: false, error: 'NOT_EQ_REQUESTED' };
  // 열린 요청이 있으면 중복 발송하지 않는다 — 고객이 어느 것에 답할지 헷갈린다.
  const open = await prisma.spPcbEqReview.findFirst({
    where: { poId, status: 'requested' },
    select: { id: true },
  });
  if (open !== null) return { ok: false, error: 'ALREADY_OPEN' };

  // 공개 파일은 **이 발주서의 EQ 첨부**만 허용한다(남의 파일 id 를 넣어도 새지 않게).
  if (body.sharedFileIds.length > 0) {
    const owned = await prisma.spFile.findMany({
      where: {
        id: { in: body.sharedFileIds.map((n) => BigInt(n)) },
        refType: EQ_REF_TYPE,
        refId: poId,
      },
      select: { id: true },
    });
    if (owned.length !== body.sharedFileIds.length) return { ok: false, error: 'BAD_FILES' };
  }

  const created = await prisma.spPcbEqReview.create({
    data: {
      poId,
      specId: po.specId,
      status: 'requested',
      message: body.message,
      dueOn: body.dueOn == null ? null : parseKstDate(body.dueOn),
      sharedFileIds: body.sharedFileIds,
      requestedBy: actorMbId,
    },
  });
  return { ok: true, reviewId: created.id };
};

export const cancelEqReview = async (
  poId: bigint,
  reviewId: bigint,
): Promise<boolean> => {
  const row = await prisma.spPcbEqReview.findUnique({ where: { id: reviewId } });
  if (row?.poId !== poId || row.status !== 'requested') return false;
  await prisma.spPcbEqReview.update({
    where: { id: reviewId },
    data: { status: 'canceled' },
  });
  return true;
};

// ── 고객 쪽 ─────────────────────────────────────────────────────────────────

/** 이 주문의 cart 행(ctIds)에 묶인 내 견적들의 확인 요청.
 *  od_id → ct_id 조회는 g5 영역이라 라우트가 하고, 여기서는 sp_ 만 만진다.
 *  소유권은 **spec.mbId** 로 한 번 더 판정한다(ctId 만 믿지 않는다). */
export const listCustomerEqReviews = async (
  ctIds: readonly number[],
  mbId: string,
): Promise<CustomerPcbEqReviewViewType[]> => {
  if (ctIds.length === 0) return [];
  const specs = await prisma.spOrderSpec.findMany({
    where: { mbId, ctId: { in: [...ctIds] } },
    select: { id: true, ctId: true, projectName: true },
  });
  if (specs.length === 0) return [];
  const rows = await prisma.spPcbEqReview.findMany({
    where: { specId: { in: specs.map((s) => s.id) } },
    orderBy: { id: 'desc' },
  });
  if (rows.length === 0) return [];
  const files = await loadSharedFiles(rows);
  const specById = new Map(specs.map((s) => [s.id.toString(), s]));
  const now = new Date();
  return rows.map((r) => {
    const spec = specById.get(r.specId.toString());
    return {
      id: Number(r.id),
      projectName: spec?.projectName ?? '',
      ctId: spec?.ctId ?? null,
      status: asEqReviewStatus(r.status),
      message: r.message,
      dueOn: iso(r.dueOn),
      files: toFileViews(parseSharedFileIds(r.sharedFileIds), files),
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: iso(r.decidedAt),
      decisionNote: r.decisionNote,
      overdue: isOverdue(r, now),
    };
  });
};

export type EqDecisionError =
  | 'REVIEW_NOT_FOUND'
  | 'NOT_OWNER'
  | 'ALREADY_DECIDED'
  | 'NOT_EQ_REQUESTED';

/** 고객 결정 — 상태만 기록한다. EQ 전이(eq_done)는 관리자가 별도로 누른다. */
export const decideEqReview = async (
  reviewId: bigint,
  mbId: string,
  decision: 'approve' | 'reject',
  note: string | null,
): Promise<{ ok: true; poId: bigint } | { ok: false; error: EqDecisionError }> => {
  const row = await prisma.spPcbEqReview.findUnique({
    where: { id: reviewId },
    include: { po: { select: { status: true } } },
  });
  if (row === null) return { ok: false, error: 'REVIEW_NOT_FOUND' };
  const spec = await prisma.spOrderSpec.findUnique({
    where: { id: row.specId },
    select: { mbId: true },
  });
  if (spec?.mbId !== mbId) return { ok: false, error: 'NOT_OWNER' };
  if (row.status !== 'requested') return { ok: false, error: 'ALREADY_DECIDED' };
  // 발주가 EQ 승인요청을 벗어났으면 물어본 전제가 사라진 뒤다(관리자가 승인·반려·되돌림).
  // 전이가 열린 요청을 닫지만, 그 직전에 열려 있던 화면에서 눌린 결정까지 받으면 이미
  // 지나간 EQ 에 답이 붙는다 — 생성 가드(NOT_EQ_REQUESTED)와 같은 이유·같은 코드다.
  if (row.po.status !== 'eq_requested') return { ok: false, error: 'NOT_EQ_REQUESTED' };

  await prisma.spPcbEqReview.update({
    where: { id: reviewId },
    data: {
      status: decision === 'approve' ? 'approved' : 'rejected',
      decidedBy: mbId,
      decidedAt: new Date(),
      decisionNote: note,
    },
  });
  return { ok: true, poId: row.poId };
};

/** 공개된 첨부만 내려준다 — sharedFileIds 에 없으면 남의 파일이다. */
export const getEqReviewFile = async (
  reviewId: bigint,
  fileId: bigint,
  mbId: string,
): Promise<{ pathToken: string; originFileName: string } | null> => {
  const row = await prisma.spPcbEqReview.findUnique({ where: { id: reviewId } });
  if (row === null) return null;
  const spec = await prisma.spOrderSpec.findUnique({
    where: { id: row.specId },
    select: { mbId: true },
  });
  if (spec?.mbId !== mbId) return null;
  if (!parseSharedFileIds(row.sharedFileIds).some((id) => id === fileId)) return null;
  const file = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (file === null) return null;
  return { pathToken: file.pathToken, originFileName: file.originFileName };
};

/** 발주 행에 싣는 요약(P4.4) — 모달을 열지 않아도 "보냈는지·답했는지"가 보이게.
 *  열린 요청이 있으면 그것(생성 가드상 항상 최신 행), 없으면 마지막 결정.
 *  canceled 는 요약에서 제외한다 — 취소했으면 미요청과 같다(다시 물어봐야 한다). */
export const loadEqReviewRowSummaries = async (
  poIds: readonly bigint[],
): Promise<Map<string, PcbPoEqReviewSummaryType>> => {
  const map = new Map<string, PcbPoEqReviewSummaryType>();
  if (poIds.length === 0) return map;
  const rows = await prisma.spPcbEqReview.findMany({
    where: { poId: { in: [...poIds] }, status: { not: 'canceled' } },
    orderBy: { id: 'desc' },
  });
  const now = new Date();
  for (const r of rows) {
    const key = r.poId.toString();
    const cur = map.get(key);
    // id desc 순회 — po 별 첫 행(최신)이 답이다. requested 는 늘 최신 행이지만
    // (열린 요청이 있으면 새로 못 만든다), 데이터가 어긋나도 열린 요청을 우선한다.
    if (cur !== undefined && (cur.status === 'requested' || r.status !== 'requested')) continue;
    map.set(key, {
      status: asEqReviewStatus(r.status),
      requestedAt: r.requestedAt.toISOString(),
      dueOn: iso(r.dueOn),
      overdue: isOverdue(r, now),
      decidedAt: iso(r.decidedAt),
      decisionNote: r.decisionNote,
    });
  }
  return map;
};
