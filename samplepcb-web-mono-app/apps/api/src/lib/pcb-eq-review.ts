import type { Prisma, SpFile, SpPcbEqReview, SpPcbEqReviewItem } from '@prisma/client';
import { PCB_EQ_REVIEW_STATUSES } from '@sp/api-contract';
import type {
  AdminPcbEqReviewViewType,
  CustomerPcbEqReviewViewType,
  PartnerPcbEqRoundType,
  PcbEqAiFlagType,
  PcbEqAnswerInputType,
  PcbEqAnswerChannelType,
  PcbEqDraftItemType,
  PcbEqItemFigureType,
  PcbEqReviewFileType,
  PcbEqReviewFormatType,
  PcbEqReviewStatusType,
  PcbPoEqReviewSummaryType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { deleteFromFileServer, uploadToFileServer, type UploadTarget } from './file-server';
import {
  EQ_FIGURE_FILE_TYPE,
  EQ_FIGURE_MAX_BYTES,
  EQ_FIGURE_REF_TYPE,
  PCB_EQ_ITEMS_DEFAULT_MESSAGE,
  asEqAnswerChannel,
  eqFigureMime,
  eqItemNo,
  countEqNumberedRounds,
  eqRoundNumbers,
  isEqReviewCustomerVisible,
  linkEqRevision,
  looseEqFigures,
  parseEqAiFlags,
  parseEqItemFigures,
  parseEqItemOptions,
  planEqItemCopyLink,
  summarizeEqAnswers,
  toAdminEqItem,
  toCustomerEqItem,
  toEqEvent,
  toEqFiguresJson,
  toEqPrevItem,
  toPartnerEqItem,
  validateEqAnswers,
  validateEqDraftItems,
  type AdminEqItemInput,
  type EqAnswerError,
  type EqDraftSaveError,
  type EqRoundCandidate,
} from './pcb-eq-items';

// ── PCB EQ 고객 확인 코어(P4.1) — docs/PCB_PARTNER_TRACK.md D16·D20 ──────────
// 협력사 EQ 를 고객에게 물어보는 축. **EQ 전이 머신을 건드리지 않는다** — 고객이
// 승인해도 발주서 status 는 eq_requested 그대로이고, eq_done 은 관리자가 누른다.
//
// 공개 파일: 관리자가 고른 sp_file.id 만 sharedFileIds 에 담기며 다운로드도 그 목록으로
// 검증한다. 협력사가 올린 EQ 첨부에는 협력사명·로고가 들어 있을 수 있어, 전체 자동
// 공개는 공급망을 드러낸다(사용자 결정 2026-08-07).
//
// D20 — 같은 원장을 **회차**로 넓힌다. format='items' 회차는 문항(sp_pcb_eq_review_item)과
// 이벤트(sp_pcb_eq_review_event)를 갖고 draft → requested → answered 로 간다. 규칙(검증·뷰
// 조립·회차 번호)은 pcb-eq-items.ts 의 순수 함수가 정본이고, 여기는 읽고 쓰기만 한다.

const EQ_REF_TYPE = 'sp_pcb_po_eq';
const EQ_UPLOAD_SERVICE_TYPE = 'pcb_eq';

/** 열린 회차 — 발주서당 1개(draft=관리자 작성 중 · requested=고객 회신 대기). */
export const PCB_EQ_OPEN_STATUSES = ['draft', 'requested'] as const;
const isOpenStatus = (s: string): boolean => s === 'draft' || s === 'requested';

const parseKstDate = (s: string): Date => new Date(`${s}T00:00:00+09:00`);
const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());
/** KST 날짜 문자열(메일 표시용) — dueOn 은 KST 자정 앵커로 저장된다. */
export const kstDateText = (d: Date): string =>
  new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const asEqReviewStatus = (v: string): PcbEqReviewStatusType =>
  PCB_EQ_REVIEW_STATUSES.find((s) => s === v) ?? 'requested';

const asEqFormat = (v: string): PcbEqReviewFormatType => (v === 'items' ? 'items' : 'message');

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

// ── D20 공용 조회 ─────────────────────────────────────────────────────────────

/** 'sent' 이벤트 하나만 — "고객에게 나간 적이 있는가"의 판정 근거(isEqReviewCustomerVisible). */
const SENT_EVENT = { where: { action: 'sent' }, select: { id: true }, take: 1 } as const;

/**
 * 고객 노출 조건(Prisma) — isEqReviewCustomerVisible 의 쿼리판. draft 와 **안 나간 채 닫힌 초안**은
 * 고객 응답·목록에 절대 실리지 않는다. 문구형(D16)은 예전처럼 취소 이력까지 보인다.
 */
const CUSTOMER_VISIBLE: Prisma.SpPcbEqReviewWhereInput = {
  status: { not: 'draft' },
  OR: [
    { format: { not: 'items' } },
    { status: { not: 'canceled' } },
    { events: { some: { action: 'sent' } } },
  ],
};

/** 발주서들의 문항형 회차 — 번호·개수 규칙(eqRoundNumbers·countEqNumberedRounds)의 입력. */
const loadEqRoundCandidates = async (poIds: readonly bigint[]): Promise<EqRoundCandidate[]> => {
  if (poIds.length === 0) return [];
  const rows = await prisma.spPcbEqReview.findMany({
    where: { poId: { in: [...poIds] }, format: 'items' },
    select: { id: true, poId: true, format: true, status: true, events: SENT_EVENT },
  });
  return rows.map((r) => ({
    id: r.id,
    poId: r.poId,
    format: r.format,
    status: r.status,
    sent: r.events.length > 0,
  }));
};

/** 발주서들의 문항형 회차 번호(key=reviewId) — 규칙은 eqRoundNumbers. */
export const loadEqRoundNumbers = async (poIds: readonly bigint[]): Promise<Map<string, number>> =>
  eqRoundNumbers(await loadEqRoundCandidates(poIds));

/** 회차들의 문항 그림 파일(sp_file) — key=fileId. */
const loadFigureFiles = async (reviewIds: readonly bigint[]): Promise<Map<string, SpFile>> => {
  const map = new Map<string, SpFile>();
  if (reviewIds.length === 0) return map;
  const files = await prisma.spFile.findMany({
    where: { refType: EQ_FIGURE_REF_TYPE, refId: { in: [...reviewIds] }, fileType: EQ_FIGURE_FILE_TYPE },
  });
  for (const f of files) map.set(f.id.toString(), f);
  return map;
};

interface PrevItemSource {
  item: SpPcbEqReviewItem;
  /** 직전 문항이 속한 회차를 고객이 본 적이 있는가. */
  customerVisible: boolean;
}

/** 문항들이 잇는 직전 회차 문항 — key=itemId. */
const loadPrevItems = async (
  items: readonly SpPcbEqReviewItem[],
): Promise<Map<string, PrevItemSource>> => {
  const ids = [
    ...new Set(items.flatMap((i) => (i.prevItemId === null ? [] : [i.prevItemId.toString()]))),
  ].map((s) => BigInt(s));
  const map = new Map<string, PrevItemSource>();
  if (ids.length === 0) return map;
  const rows = await prisma.spPcbEqReviewItem.findMany({
    where: { id: { in: ids } },
    include: { review: { select: { format: true, status: true, events: SENT_EVENT } } },
  });
  for (const { review, ...item } of rows) {
    map.set(item.id.toString(), {
      item,
      customerVisible: isEqReviewCustomerVisible({
        format: review.format,
        status: review.status,
        sent: review.events.length > 0,
      }),
    });
  }
  return map;
};

// ── 관리자 뷰 ────────────────────────────────────────────────────────────────

export const listAdminEqReviews = async (
  poId: bigint,
): Promise<AdminPcbEqReviewViewType[]> => {
  const rows = await prisma.spPcbEqReview.findMany({
    where: { poId },
    orderBy: { id: 'desc' },
    include: { items: { orderBy: { seq: 'asc' } }, events: { orderBy: { id: 'asc' } } },
  });
  if (rows.length === 0) return [];
  const [files, figures, prevItems] = await Promise.all([
    loadSharedFiles(rows),
    loadFigureFiles(rows.map((r) => r.id)),
    loadPrevItems(rows.flatMap((r) => r.items)),
  ]);
  // 발주서의 회차를 전부 읽었으므로 번호는 추가 조회 없이 센다.
  const rounds = eqRoundNumbers(
    rows.map((r) => ({
      id: r.id,
      poId: r.poId,
      format: r.format,
      status: r.status,
      sent: r.events.some((e) => e.action === 'sent'),
    })),
  );
  const now = new Date();
  return rows.map((r) => {
    const format = asEqFormat(r.format);
    return {
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
      format,
      version: r.version,
      roundNo: format === 'items' ? (rounds.get(r.id.toString()) ?? null) : null,
      prevReviewId: r.prevReviewId === null ? null : Number(r.prevReviewId),
      sourceFileIds: parseSharedFileIds(r.sourceFileIds).map((id) => Number(id)),
      // 관리자는 직전 회차가 고객에게 나갔든 아니든 본다(작업 이력이다).
      items: r.items.map((i) => {
        const prev = i.prevItemId === null ? undefined : prevItems.get(i.prevItemId.toString());
        return toAdminEqItem(i, figures, prev === undefined ? null : toEqPrevItem(prev.item));
      }),
      // 올렸지만 문항에 안 붙은 그림 — 위에서 회차 묶음으로 한 번에 읽은 것을 가른다(추가 조회 없음).
      looseFigures: format === 'items' ? looseEqFigures(r.id, r.items, figures) : [],
      answeredRole:
        r.answeredRole === 'customer' || r.answeredRole === 'admin' ? r.answeredRole : null,
      answerChannel: asEqAnswerChannel(r.answerChannel),
      forwardedAt: iso(r.forwardedAt),
      forwardedBy: r.forwardedBy,
      events: r.events.flatMap((e) => {
        const view = toEqEvent(e);
        return view === null ? [] : [view];
      }),
      // AI 가 문항을 채운 회차(D20 P2) — 발송 뒤에도 이력으로 남는다(관리자가 고쳤더라도 출발은 AI 초안).
      aiDraft: r.events.some((e) => e.action === 'ai_drafted'),
    };
  });
};

/** 회차 하나(변경 응답용) — 발주서 단위로 읽고 고른다(회차 번호가 발주서 전체를 봐야 정해진다). */
export const loadAdminEqReview = async (
  poId: bigint,
  reviewId: bigint,
): Promise<AdminPcbEqReviewViewType | null> =>
  (await listAdminEqReviews(poId)).find((r) => r.id === Number(reviewId)) ?? null;

// ── 열린 회차 직렬화 ─────────────────────────────────────────────────────────

/**
 * 발주서 행 잠금 + 현재 상태. 열린 회차 1개 규칙(ALREADY_OPEN)은 "확인 → 생성" 사이가 비면
 * 동시 생성 둘이 다 통과한다(더블클릭) — 같은 발주서의 생성·발송·회신은 발주서 행을 잡고
 * 줄을 세운다. EQ 전이(commitEqTransition)도 같은 행을 갱신하므로 함께 직렬화된다.
 */
const lockPoStatus = async (tx: Prisma.TransactionClient, poId: bigint): Promise<string | null> => {
  const rows = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM sp_pcb_po WHERE id = ${poId} FOR UPDATE`;
  return rows[0]?.status ?? null;
};

const hasOpenReview = async (tx: Prisma.TransactionClient, poId: bigint): Promise<boolean> =>
  (await tx.spPcbEqReview.count({
    where: { poId, status: { in: [...PCB_EQ_OPEN_STATUSES] } },
  })) > 0;

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
  // 열린 회차(작성 중 포함)가 있으면 중복 발송하지 않는다 — 고객이 어느 것에 답할지 헷갈린다.
  if (await hasOpenReview(prisma, poId)) return { ok: false, error: 'ALREADY_OPEN' };

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

  // 위 두 확인은 빠른 거절용이다 — 확정은 발주서 행을 잡은 뒤 다시 한다(더블클릭 이중 생성 방지).
  return prisma.$transaction(
    async (tx): Promise<{ ok: true; reviewId: bigint } | { ok: false; error: CreateEqReviewError }> => {
    if ((await lockPoStatus(tx, poId)) !== 'eq_requested') return { ok: false, error: 'NOT_EQ_REQUESTED' };
    if (await hasOpenReview(tx, poId)) return { ok: false, error: 'ALREADY_OPEN' };
    const created = await tx.spPcbEqReview.create({
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
    },
  );
};

/** 열린 회차(작성 중·회신 대기) 취소 — 문구형·문항형 공용. 이벤트는 문구형에도 남긴다(덧붙이기만). */
export const cancelEqReview = async (
  poId: bigint,
  reviewId: bigint,
  actorMbId: string,
): Promise<boolean> => {
  const row = await prisma.spPcbEqReview.findUnique({ where: { id: reviewId } });
  if (row?.poId !== poId || !isOpenStatus(row.status)) return false;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.spPcbEqReview.updateMany({
      where: { id: reviewId, status: { in: [...PCB_EQ_OPEN_STATUSES] } },
      data: { status: 'canceled', version: { increment: 1 } },
    });
    if (updated.count !== 1) return false;
    await tx.spPcbEqReviewEvent.create({
      data: { reviewId, action: 'canceled', actorRole: 'admin', actorMbId },
    });
    return true;
  });
};

/**
 * EQ 전이가 열린 회차를 닫는다(commitEqTransition 의 트랜잭션 안에서). 물어볼 EQ 가 움직였으면
 * 회신 대기도, 작성 중인 초안도 무의미하다(D20 — 초안도 닫는다). answered 는 이력이라 그대로.
 * 행마다 조건부로 닫고 닫힌 것에만 이벤트를 남긴다 — 그 사이 고객이 답했으면 닫지 않는다.
 */
export const closeOpenEqReviewsTx = async (
  tx: Prisma.TransactionClient,
  poId: bigint,
): Promise<number> => {
  const open = await tx.spPcbEqReview.findMany({
    where: { poId, status: { in: [...PCB_EQ_OPEN_STATUSES] } },
    select: { id: true },
  });
  let closed = 0;
  for (const { id } of open) {
    const updated = await tx.spPcbEqReview.updateMany({
      where: { id, status: { in: [...PCB_EQ_OPEN_STATUSES] } },
      data: { status: 'canceled', version: { increment: 1 } },
    });
    if (updated.count !== 1) continue;
    await tx.spPcbEqReviewEvent.create({
      data: { reviewId: id, action: 'canceled', actorRole: 'system', note: '발주 EQ 상태 변경' },
    });
    closed += 1;
  }
  return closed;
};

/**
 * 승인과 함께 전달(D20 후속 R-1) — EQ 승인 전이(commitEqTransition)의 트랜잭션 안에서, 고객 회신이 왔고
 * **아직 협력사에 전달하지 않은** 문항형 회차를 전달 처리한다. 승인은 "이 답대로 진행하라"는 뜻이라
 * 답을 못 본 채 승인만 받는 상태가 없어야 한다(전달 없이 승인하면 공장이 고객 답을 모른 채 생산을 시작했다).
 * 수동 [협력사에 전달](forwardEqReview)로 이미 나간 회차는 건드리지 않는다. 문구형(D16)은 전달이라는
 * 개념이 없다 — format 으로 걸러진다. 전달한 회차 id(오래된 것부터)를 돌려준다(승인 메일이 요약을 싣는다).
 */
export const forwardAnsweredEqReviewsTx = async (
  tx: Prisma.TransactionClient,
  poId: bigint,
  actorMbId: string,
): Promise<bigint[]> => {
  const pending = await tx.spPcbEqReview.findMany({
    where: { poId, format: 'items', status: 'answered', forwardedAt: null },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  const forwarded: bigint[] = [];
  const now = new Date();
  for (const { id } of pending) {
    const updated = await tx.spPcbEqReview.updateMany({
      where: { id, status: 'answered', forwardedAt: null },
      data: { forwardedAt: now, forwardedBy: actorMbId, version: { increment: 1 } },
    });
    if (updated.count !== 1) continue; // 그사이 수동 전달이 먼저 갔다
    await tx.spPcbEqReviewEvent.create({
      data: {
        reviewId: id,
        action: 'forwarded',
        actorRole: 'admin',
        actorMbId,
        note: '승인과 함께 전달',
      },
    });
    forwarded.push(id);
  }
  return forwarded;
};

/**
 * 승인 메일에 싣는 고객 회신 요약 — 방금 승인과 함께 전달된 회차들 중 **가장 최근 회차**의 문항 번호·기호·의견.
 * 공장은 기호로 읽는다(D20-4). 함께 전달된 이전 회차는 건수만 센다(본문은 포털에서). 없으면 null.
 */
export const loadForwardedAnswerDigest = async (
  poId: bigint,
  reviewIds: readonly bigint[],
): Promise<{
  roundNo: number;
  items: { no: string; key: string; comment: string | null }[];
  earlierRounds: number;
} | null> => {
  if (reviewIds.length === 0) return null;
  const rows = await prisma.spPcbEqReview.findMany({
    where: { id: { in: [...reviewIds] }, poId },
    orderBy: { id: 'desc' },
    include: { items: { orderBy: { seq: 'asc' } } },
  });
  const latest = rows[0];
  if (latest === undefined) return null;
  const rounds = await loadEqRoundNumbers([poId]);
  return {
    roundNo: rounds.get(latest.id.toString()) ?? 1,
    items: latest.items.map((i) => ({
      no: eqItemNo(i),
      key: i.answerKey ?? '-',
      comment: i.answerComment,
    })),
    earlierRounds: rows.length - 1,
  };
};

// ── 고객 쪽 ─────────────────────────────────────────────────────────────────

type CustomerReviewRow = SpPcbEqReview & { items: SpPcbEqReviewItem[] };

/** 고객 뷰 묶음 조립 — 공개 파일·그림·직전 문항·회차 번호를 한 번에 읽는다(N+1 회피). */
const buildCustomerViews = async <R extends CustomerReviewRow>(
  rows: readonly R[],
  specOf: (row: R) => { projectName: string; ctId: number | null },
): Promise<CustomerPcbEqReviewViewType[]> => {
  if (rows.length === 0) return [];
  const [files, figures, prevItems, rounds] = await Promise.all([
    loadSharedFiles(rows),
    loadFigureFiles(rows.filter((r) => r.format === 'items').map((r) => r.id)),
    loadPrevItems(rows.flatMap((r) => r.items)),
    loadEqRoundNumbers([...new Set(rows.map((r) => r.poId.toString()))].map((s) => BigInt(s))),
  ]);
  const now = new Date();
  return rows.map((r) => {
    const format = asEqFormat(r.format);
    const spec = specOf(r);
    return {
      id: Number(r.id),
      projectName: spec.projectName,
      ctId: spec.ctId,
      status: asEqReviewStatus(r.status),
      // 문항형 머리말은 대개 비어 있다 — 기본 안내문으로 채워 PHP 가 문구를 따로 갖지 않게.
      message: format === 'items' && r.message.trim() === '' ? PCB_EQ_ITEMS_DEFAULT_MESSAGE : r.message,
      dueOn: iso(r.dueOn),
      files: toFileViews(parseSharedFileIds(r.sharedFileIds), files),
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: iso(r.decidedAt),
      decisionNote: r.decisionNote,
      overdue: isOverdue(r, now),
      format,
      version: r.version,
      roundNo: format === 'items' ? (rounds.get(r.id.toString()) ?? null) : null,
      // 이전 답은 **고객이 본 회차**의 것만 — 안 나간 초안을 잇고 있으면 비운다.
      items: r.items.map((i) => {
        const prev = i.prevItemId === null ? undefined : prevItems.get(i.prevItemId.toString());
        const visible = prev?.customerVisible === true;
        return toCustomerEqItem(
          i,
          figures,
          visible ? toEqPrevItem(prev.item) : null,
          i.prevItemId !== null && !visible,
        );
      }),
      answeredByAdmin: r.answeredRole === 'admin',
    };
  });
};

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
    where: { AND: [{ specId: { in: specs.map((s) => s.id) } }, CUSTOMER_VISIBLE] },
    orderBy: { id: 'desc' },
    include: { items: { orderBy: { seq: 'asc' } } },
  });
  const specById = new Map(specs.map((s) => [s.id.toString(), s]));
  return buildCustomerViews(rows, (r) => {
    const spec = specById.get(r.specId.toString());
    return { projectName: spec?.projectName ?? '', ctId: spec?.ctId ?? null };
  });
};

/**
 * 회원의 **전 주문**을 가로지르는 확인 요청 — 마이페이지 "제조 확인" 목록의 모수.
 *
 * 위 [[listCustomerEqReviews]] 와 축이 다르다: 그쪽은 주문 하나(odId→ctIds)를 받고,
 * 이쪽은 회원을 받는다. 고객이 "지금 답해야 할 게 있나"를 주문을 하나씩 열어보지 않고
 * 알게 하는 것이 목적이다(메일 딥링크가 유일한 진입점이던 것의 보완).
 *
 * 소유권은 **po.spec.mbId** 로 관계 필터를 건다 — 회원의 spec 을 통째로 읽어와 id 목록을
 * 만들면 이관분이 많은 회원에서 수천 행을 헛돈다(review.specId 는 po.specId 의 비정규화
 * 사본이고 불변이라 어느 쪽으로 타도 같은 행이다).
 *
 * openCount 는 scope 와 무관하게 **열린 것만** 센다 — 사이드바 배지와 같은 수여야 한다.
 * 'requested' 가 곧 유효한 대기인 것은 EQ 전이가 열린 요청을 닫아주기 때문이다
 * (closeOpenEqReviewsTx) — 여기서 발주 상태를 다시 볼 필요가 없다. draft 는 고객에게 아직
 * 없는 요청이라 배지에도 안 든다(D20).
 */
export const listMyEqReviews = async (
  mbId: string,
  scope: 'open' | 'all',
): Promise<{ reviews: CustomerPcbEqReviewViewType[]; openCount: number }> => {
  const mine = { po: { spec: { mbId } } };
  const openCount = await prisma.spPcbEqReview.count({
    where: { ...mine, status: 'requested' },
  });
  const rows = await prisma.spPcbEqReview.findMany({
    where: {
      AND: [mine, CUSTOMER_VISIBLE, ...(scope === 'open' ? [{ status: 'requested' }] : [])],
    },
    orderBy: { id: 'desc' },
    take: 200, // 이력 전량은 목록의 일이 아니다 — 오래된 건은 주문 상세가 정본이다.
    include: {
      items: { orderBy: { seq: 'asc' } },
      po: { select: { spec: { select: { ctId: true, projectName: true } } } },
    },
  });
  return {
    reviews: await buildCustomerViews(rows, (r) => ({
      projectName: r.po.spec.projectName,
      ctId: r.po.spec.ctId,
    })),
    openCount,
  };
};

export type EqDecisionError =
  | 'REVIEW_NOT_FOUND'
  | 'NOT_OWNER'
  | 'ALREADY_DECIDED'
  | 'NOT_EQ_REQUESTED'
  // 문항형 회차에는 통째 승인·반려가 없다(D20) — 항목별 회신 라우트로 답해야 한다.
  | 'WRONG_FORMAT';

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
  // 작성 중인 초안은 고객에게 아직 없는 요청이다 — 존재조차 알리지 않는다.
  if (row.status === 'draft') return { ok: false, error: 'REVIEW_NOT_FOUND' };
  if (row.format === 'items') return { ok: false, error: 'WRONG_FORMAT' };
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
      version: { increment: 1 },
    },
  });
  return { ok: true, poId: row.poId };
};

/**
 * 고객 다운로드 — 공개된 것만 내려준다. 문구형은 sharedFileIds 의 EQ 첨부(내려받기),
 * 문항형은 **공개(shared) 표시된 문항 그림**(인라인 — 주문 상세가 `<img>` 로 쓴다).
 * 고객이 볼 수 없는 회차(작성 중·안 나간 채 닫힌 초안)의 파일은 없는 것과 같다.
 */
export const getEqReviewFile = async (
  reviewId: bigint,
  fileId: bigint,
  mbId: string,
): Promise<{ pathToken: string; originFileName: string; inline: boolean } | null> => {
  const row = await prisma.spPcbEqReview.findUnique({
    where: { id: reviewId },
    include: { items: { select: { figures: true } }, events: SENT_EVENT },
  });
  if (row === null) return null;
  if (
    !isEqReviewCustomerVisible({ format: row.format, status: row.status, sent: row.events.length > 0 })
  ) {
    return null;
  }
  const spec = await prisma.spOrderSpec.findUnique({
    where: { id: row.specId },
    select: { mbId: true },
  });
  if (spec?.mbId !== mbId) return null;
  if (parseSharedFileIds(row.sharedFileIds).some((id) => id === fileId)) {
    const file = await prisma.spFile.findUnique({ where: { id: fileId } });
    return file === null
      ? null
      : { pathToken: file.pathToken, originFileName: file.originFileName, inline: false };
  }
  const shared = row.items.some((i) =>
    parseEqItemFigures(i.figures).some((f) => f.shared && f.fileId === fileId),
  );
  if (!shared) return null;
  const file = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (
    file?.refType !== EQ_FIGURE_REF_TYPE ||
    file.refId !== reviewId ||
    file.fileType !== EQ_FIGURE_FILE_TYPE
  ) {
    return null;
  }
  return { pathToken: file.pathToken, originFileName: file.originFileName, inline: true };
};

/** loadEqReviewRowSummaries 의 결과 — 요약과 회차 수는 한 조회에서 나온다. */
export interface EqReviewRowSummaries {
  /** key=poId — 요약이 없으면 키가 없다. */
  summaries: Map<string, PcbPoEqReviewSummaryType>;
  /** key=poId — 번호가 붙은 문항형 회차 수(작업공간 탭 수). 하나도 없으면 키가 없다(=0). */
  roundCounts: Map<string, number>;
}

/** 발주 행에 싣는 요약(P4.4) — 모달을 열지 않아도 "보냈는지·답했는지"가 보이게.
 *  열린 회차(작성 중·회신 대기)가 있으면 그것(생성 가드상 항상 최신 행), 없으면 마지막 결정.
 *  canceled 는 요약에서 제외한다 — 취소했으면 미요청과 같다(다시 물어봐야 한다).
 *  draft 도 싣는다 — 관리자 칩 "작성 중"(고객 쪽 배지·목록은 따로 거른다).
 *
 *  `roundStartByPo` 를 주면 **현재 EQ 회차에 생성된 리뷰만** 요약한다. 반려로 발주가 내려갔다
 *  다시 올라오면 지난 회차의 결정은 이력일 뿐인데, 그걸 요약으로 쓰면 배지가 옛 회차에 머물고
 *  반려 사유 프리필이 지난 회차 고객 문구를 협력사에 재발송한다. 비우면 전 이력 대상(구데이터).
 *
 *  `roundCounts` 는 요약과 **다른 축**이다 — 승인요청 구간과 무관하게 그 발주서의 번호 붙은 문항형
 *  회차를 센다(보낸 뒤 취소한 회차 포함 — 그래서 취소 행까지 읽고 요약에서만 뺀다). 번호 조회가 읽은
 *  것에서 세므로 조회는 늘지 않는다. */
export const loadEqReviewRowSummaries = async (
  poIds: readonly bigint[],
  roundStartByPo?: ReadonlyMap<string, Date | null>,
): Promise<EqReviewRowSummaries> => {
  const map = new Map<string, PcbPoEqReviewSummaryType>();
  if (poIds.length === 0) return { summaries: map, roundCounts: new Map() };
  const all = await prisma.spPcbEqReview.findMany({
    where: { poId: { in: [...poIds] } },
    orderBy: { id: 'desc' },
  });
  const rows = all.filter((r) => r.status !== 'canceled');
  // 문항형 회차가 하나도 없으면(대부분의 목록) 번호 조회를 건너뛴다. 취소된 회차만 남은 발주서도
  // 묻는다 — 보낸 뒤 취소한 회차는 번호가 있고 작업공간에 탭으로 남는다.
  const itemPoIds = [...new Set(all.filter((r) => r.format === 'items').map((r) => r.poId))];
  const candidates = await loadEqRoundCandidates(itemPoIds);
  const rounds = eqRoundNumbers(candidates);
  const roundCounts = countEqNumberedRounds(candidates);
  // AI 초안(D20 P2) 표시 — 작성 중인 회차만 묻는다(대개 0~몇 건). 칩 "AI 초안 · 검토 필요".
  const draftIds = rows.filter((r) => r.status === 'draft').map((r) => r.id);
  const aiDrafted = new Set(
    draftIds.length === 0
      ? []
      : (
          await prisma.spPcbEqReviewEvent.findMany({
            where: { reviewId: { in: draftIds }, action: 'ai_drafted' },
            select: { reviewId: true },
          })
        ).map((e) => e.reviewId.toString()),
  );
  const now = new Date();
  for (const r of rows) {
    const key = r.poId.toString();
    const roundStart = roundStartByPo?.get(key) ?? null;
    if (roundStart !== null && r.requestedAt < roundStart) continue; // 지난 회차의 결정
    const cur = map.get(key);
    // id desc 순회 — po 별 첫 행(최신)이 답이다. 열린 회차는 늘 최신 행이지만
    // (열린 회차가 있으면 새로 못 만든다), 데이터가 어긋나도 열린 회차를 우선한다.
    if (cur !== undefined && (isOpenStatus(cur.status) || !isOpenStatus(r.status))) continue;
    const format = asEqFormat(r.format);
    map.set(key, {
      status: asEqReviewStatus(r.status),
      requestedAt: r.requestedAt.toISOString(),
      dueOn: iso(r.dueOn),
      overdue: isOverdue(r, now),
      decidedAt: iso(r.decidedAt),
      decisionNote: r.decisionNote,
      format,
      roundNo: format === 'items' ? (rounds.get(r.id.toString()) ?? null) : null,
      forwardedAt: iso(r.forwardedAt),
      aiDraft: r.status === 'draft' && aiDrafted.has(r.id.toString()),
    });
  }
  return { summaries: map, roundCounts };
};

// ── D20 협력사 포털 — 전달된 회차만 ───────────────────────────────────────────

/** 포털 발주 상세의 '고객 회신' — **관리자가 전달한 회차만**(최신 먼저). 전달 전엔 아무것도 없다. */
/**
 * 발주서별 **고객에게 나간 문항형 회차의 근거 첨부**(sourceFileIds) — 이 파일들은 기록으로 굳는다
 * (계약 isPcbEqFileRecord ②). 안 나간 초안의 근거는 세지 않는다(초안은 고쳐 쓰는 중이다).
 */
export const loadSentEqSourceFileIds = async (
  poIds: readonly bigint[],
): Promise<Map<string, Set<number>>> => {
  const out = new Map<string, Set<number>>();
  if (poIds.length === 0) return out;
  const rows = await prisma.spPcbEqReview.findMany({
    where: { poId: { in: [...poIds] }, format: 'items', events: { some: { action: 'sent' } } },
    select: { poId: true, sourceFileIds: true },
  });
  for (const r of rows) {
    const key = r.poId.toString();
    const set = out.get(key) ?? new Set<number>();
    for (const id of parseSharedFileIds(r.sourceFileIds)) set.add(Number(id));
    out.set(key, set);
  }
  return out;
};

export const loadPartnerEqRounds = async (poId: bigint): Promise<PartnerPcbEqRoundType[]> => {
  const rows = await prisma.spPcbEqReview.findMany({
    where: { poId, format: 'items', forwardedAt: { not: null } },
    orderBy: { id: 'desc' },
    include: { items: { orderBy: { seq: 'asc' } } },
  });
  if (rows.length === 0) return [];
  const rounds = await loadEqRoundNumbers([poId]);
  return rows.flatMap((r) =>
    r.forwardedAt === null
      ? []
      : [
          {
            reviewId: Number(r.id),
            // 전달은 회신(answered) 뒤에만 열리고, 회신은 발송된 회차에만 온다 — 번호가 늘 있다.
            roundNo: rounds.get(r.id.toString()) ?? 0,
            answeredAt: iso(r.decidedAt),
            forwardedAt: r.forwardedAt.toISOString(),
            items: r.items.map(toPartnerEqItem),
          },
        ],
  );
};

// ── D20 관리자 — 초안·편집·그림·발송·대리 회신·전달 ──────────────────────────

export type EqItemsError =
  | 'PO_NOT_FOUND'
  | 'REVIEW_NOT_FOUND'
  | 'NOT_OWNER'
  | 'NOT_EQ_REQUESTED'
  | 'ALREADY_OPEN'
  | 'NO_PREVIOUS'
  | 'BAD_FILES'
  | 'WRONG_FORMAT'
  | 'NOT_DRAFT'
  | 'NOT_REQUESTED'
  | 'NOT_ANSWERED'
  | 'ALREADY_FORWARDED'
  | 'VERSION_CONFLICT'
  | 'NO_ITEMS'
  | 'ITEM_NO_OPTIONS'
  | 'BAD_FIGURE_TYPE'
  | 'FIGURE_TOO_LARGE'
  | 'FIGURE_NOT_FOUND'
  | EqDraftSaveError
  | EqAnswerError;

/** 오류 코드 → HTTP·문구. 관리자 문구 기준이고, 고객 라우트는 자기 어휘('제조 확인')로 덮는다. */
export const EQ_ITEMS_ERRORS: Record<EqItemsError, { code: 400 | 404 | 409; message: string }> = {
  PO_NOT_FOUND: { code: 404, message: '발주서를 찾을 수 없습니다.' },
  REVIEW_NOT_FOUND: { code: 404, message: '확인 요청을 찾을 수 없습니다.' },
  NOT_OWNER: { code: 404, message: '확인 요청을 찾을 수 없습니다.' },
  NOT_EQ_REQUESTED: {
    code: 409,
    message: 'EQ 승인요청 상태에서만 고객 확인을 만들거나 보낼 수 있습니다.',
  },
  ALREADY_OPEN: {
    code: 409,
    message: '이미 열린 확인 요청(작성 중 포함)이 있습니다 — 그 회차를 마무리하거나 취소해 주세요.',
  },
  NO_PREVIOUS: { code: 409, message: '가져올 직전 문항형 회차가 없습니다.' },
  BAD_FILES: { code: 400, message: '이 발주서의 EQ·Working 첨부만 근거로 고를 수 있습니다.' },
  WRONG_FORMAT: { code: 409, message: '이 확인 요청의 형식에서는 할 수 없는 조작입니다.' },
  NOT_DRAFT: { code: 409, message: '작성 중인 회차에서만 할 수 있습니다 — 이미 발송했거나 닫혔습니다.' },
  NOT_REQUESTED: { code: 409, message: '회신 대기 중인 확인 요청이 아닙니다 — 이미 회신했거나 닫혔습니다.' },
  NOT_ANSWERED: { code: 409, message: '고객 회신이 온 회차만 협력사에 전달할 수 있습니다.' },
  ALREADY_FORWARDED: { code: 409, message: '이미 협력사에 전달한 회차입니다.' },
  VERSION_CONFLICT: {
    code: 409,
    message: '그사이 내용이 바뀌었습니다 — 새로 불러온 뒤 다시 시도해 주세요.',
  },
  NO_ITEMS: { code: 400, message: '문항이 하나 이상 있어야 보낼 수 있습니다.' },
  ITEM_NO_OPTIONS: { code: 400, message: '선택지가 없는 문항이 있습니다.' },
  BAD_FIGURE_TYPE: { code: 400, message: '그림은 png·jpg·gif·webp 이미지만 올릴 수 있습니다.' },
  FIGURE_TOO_LARGE: { code: 400, message: '그림은 10MB 이하만 올릴 수 있습니다.' },
  FIGURE_NOT_FOUND: { code: 404, message: '그림을 찾을 수 없습니다.' },
  BAD_ITEM: { code: 400, message: '이 회차의 문항이 아닌 id 가 있습니다.' },
  BAD_FIGURES: { code: 400, message: '이 회차에 올린 그림만 문항에 붙일 수 있습니다.' },
  BAD_PREV_ITEM: { code: 400, message: '직전 회차의 문항만 이전 문항으로 이을 수 있습니다.' },
  DUPLICATE_OPTION_KEY: { code: 400, message: '한 문항 안에서 선택지 기호가 겹칩니다.' },
  ANSWER_UNKNOWN_ITEM: { code: 400, message: '이 확인 요청에 없는 항목에 답했습니다 — 화면을 새로고침해 주세요.' },
  ANSWER_DUPLICATE: { code: 400, message: '같은 항목에 답이 두 번 들어갔습니다.' },
  ANSWERS_INCOMPLETE: { code: 400, message: '모든 항목에 답해 주세요.' },
  ANSWER_BAD_KEY: { code: 400, message: '고를 수 없는 선택지입니다 — 화면을 새로고침해 주세요.' },
  COMMENT_REQUIRED: { code: 400, message: '이 선택지는 의견을 2자 이상 적어 주세요.' },
};

type Result<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; error: EqItemsError };

/** 문항형 회차 하나 + 발주서 확인 — 관리자 조작 공통 전처리. */
const loadItemsReview = async (
  poId: bigint,
  reviewId: bigint,
): Promise<
  | { ok: true; row: SpPcbEqReview & { items: SpPcbEqReviewItem[] } }
  | { ok: false; error: EqItemsError }
> => {
  const row = await prisma.spPcbEqReview.findUnique({
    where: { id: reviewId },
    include: { items: { orderBy: { seq: 'asc' } } },
  });
  if (row?.poId !== poId) return { ok: false, error: 'REVIEW_NOT_FOUND' };
  if (row.format !== 'items') return { ok: false, error: 'WRONG_FORMAT' };
  return { ok: true, row };
};

/**
 * 초안 만들기(D20). EQ 승인요청 중에만, 열린 회차가 없을 때만.
 *
 * 직전 회차 = 이 발주서의 문항형 회차 중 문항이 있는 가장 최근 것. `fromPrevious` 면 그 문항을
 * 복사해 잇는다(planEqItemCopyLink) — 그림은 sp_file 행을 새 회차 앞으로 **복제**한다(같은
 * pathToken). 그림 소유 판정이 "refId = 이 회차" 하나로 끝나게 하려는 것이고, 실파일은 여러
 * 행이 함께 쓰므로 지울 때 다른 행이 남아 있는지 본다(deleteEqFigure).
 * prevReviewId 는 복사 여부와 무관하게 잇는다 — 빈 초안에서도 관리자가 문항을 손으로 이을 수 있게.
 */
export const createEqDraft = async (
  poId: bigint,
  body: { fromPrevious: boolean; sourceFileIds: number[] },
  actorMbId: string,
): Promise<Result<{ reviewId: bigint }>> => {
  const po = await prisma.spPcbPo.findUnique({
    where: { id: poId },
    select: { specId: true, status: true },
  });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  // 빠른 거절 — 확정은 아래 트랜잭션이 발주서 행을 잡은 뒤 다시 한다(createEqReview 와 같다).
  if (po.status !== 'eq_requested') return { ok: false, error: 'NOT_EQ_REQUESTED' };
  if (await hasOpenReview(prisma, poId)) return { ok: false, error: 'ALREADY_OPEN' };

  const sourceFileIds = [...new Set(body.sourceFileIds)];
  if (sourceFileIds.length > 0) {
    const owned = await prisma.spFile.findMany({
      where: { id: { in: sourceFileIds.map((n) => BigInt(n)) }, refType: EQ_REF_TYPE, refId: poId },
      select: { fileType: true },
    });
    // 근거는 협력사 EQ 질의서·Working 만 — 관리자 회신·좌표파일은 물어볼 원문이 아니다.
    // 종류가 비어 있는 옛 행은 eq 로 읽는다(pcb-po asEqFileType 과 같은 규칙).
    const ok =
      owned.length === sourceFileIds.length &&
      owned.every((f) => f.fileType === null || f.fileType === 'eq' || f.fileType === 'working');
    if (!ok) return { ok: false, error: 'BAD_FILES' };
  }

  const source = await prisma.spPcbEqReview.findFirst({
    where: { poId, format: 'items', items: { some: {} } },
    orderBy: { id: 'desc' },
    include: { items: { orderBy: { seq: 'asc' } }, events: SENT_EVENT },
  });
  if (body.fromPrevious && source === null) return { ok: false, error: 'NO_PREVIOUS' };
  const sourceSent = source !== null && source.events.length > 0;
  // 안 나간 채 닫힌 초안은 건너뛰고 그 초안이 잇던 회차(고객이 마지막으로 본 회차)에 잇는다.
  const prevReviewId = source === null ? null : sourceSent ? source.id : source.prevReviewId;
  const sourceFigures =
    body.fromPrevious && source !== null
      ? await prisma.spFile.findMany({
          where: { refType: EQ_FIGURE_REF_TYPE, refId: source.id, fileType: EQ_FIGURE_FILE_TYPE },
        })
      : [];

  return prisma.$transaction(async (tx): Promise<Result<{ reviewId: bigint }>> => {
    if ((await lockPoStatus(tx, poId)) !== 'eq_requested') {
      return { ok: false, error: 'NOT_EQ_REQUESTED' };
    }
    if (await hasOpenReview(tx, poId)) return { ok: false, error: 'ALREADY_OPEN' };
    const review = await tx.spPcbEqReview.create({
      data: {
        poId,
        specId: po.specId,
        status: 'draft',
        format: 'items',
        message: '',
        sharedFileIds: [],
        sourceFileIds,
        requestedBy: actorMbId,
        prevReviewId,
      },
    });
    if (body.fromPrevious && source !== null) {
      const copied = new Map<string, bigint>();
      for (const f of sourceFigures) {
        const copy = await tx.spFile.create({
          data: {
            refType: EQ_FIGURE_REF_TYPE,
            refId: review.id,
            uploadFileName: f.uploadFileName,
            originFileName: f.originFileName,
            pathToken: f.pathToken,
            size: f.size,
            writeDate: new Date(),
            fileType: EQ_FIGURE_FILE_TYPE,
            uploadedBy: f.uploadedBy,
          },
        });
        copied.set(f.id.toString(), copy.id);
      }
      for (const item of source.items) {
        const link = planEqItemCopyLink(item, sourceSent);
        const figures = parseEqItemFigures(item.figures).flatMap((ref) => {
          const fileId = copied.get(ref.fileId.toString());
          return fileId === undefined ? [] : [{ fileId, shared: ref.shared }];
        });
        await tx.spPcbEqReviewItem.create({
          data: {
            reviewId: review.id,
            seq: item.seq,
            factoryNo: item.factoryNo,
            category: item.category,
            question: item.question,
            questionOrig: item.questionOrig,
            options: parseEqItemOptions(item.options),
            figures: toEqFiguresJson(figures),
            prevItemId: link.prevItemId,
            change: link.change,
            // AI 검토 표시는 **안 나간 초안**에서 가져올 때만 따라온다(아직 아무도 확인하지 않았다).
            // 발송된 회차의 문항은 관리자가 검토를 끝낸 것이라 표시를 물려주지 않는다.
            aiFlags: sourceSent ? [] : parseEqAiFlags(item.aiFlags),
          },
        });
      }
    }
    await tx.spPcbEqReviewEvent.create({
      data: {
        reviewId: review.id,
        action: 'drafted',
        actorRole: 'admin',
        actorMbId,
        note:
          body.fromPrevious && source !== null
            ? `직전 회차(#${source.id.toString()}) 문항 ${String(source.items.length)}개 가져옴`
            : null,
      },
    });
    return { ok: true, reviewId: review.id };
  });
};

/**
 * 초안 저장 — **통째 교체**(id 있으면 갱신 · 없으면 새로 · 빠진 건 삭제, seq 는 입력 순서).
 * 열어 둔 화면의 늦은 저장이 덮어쓰지 않게 expectedVersion 을 맞춰야 한다(D43-3 관례).
 */
export const saveEqDraft = async (
  poId: bigint,
  reviewId: bigint,
  body: { expectedVersion: number; message: string; dueOn: string | null; items: AdminEqItemInput[] },
): Promise<Result> => {
  const loaded = await loadItemsReview(poId, reviewId);
  if (!loaded.ok) return loaded;
  const { row } = loaded;
  if (row.status !== 'draft') return { ok: false, error: 'NOT_DRAFT' };
  if (row.version !== body.expectedVersion) return { ok: false, error: 'VERSION_CONFLICT' };

  const [figureRows, prevRows] = await Promise.all([
    prisma.spFile.findMany({
      where: { refType: EQ_FIGURE_REF_TYPE, refId: reviewId, fileType: EQ_FIGURE_FILE_TYPE },
      select: { id: true },
    }),
    row.prevReviewId === null
      ? Promise.resolve([])
      : prisma.spPcbEqReviewItem.findMany({
          where: { reviewId: row.prevReviewId },
          select: { id: true },
        }),
  ]);
  const invalid = validateEqDraftItems(body.items, {
    itemIds: new Set(row.items.map((i) => i.id.toString())),
    figureIds: new Set(figureRows.map((f) => f.id.toString())),
    prevItemIds: new Set(prevRows.map((p) => p.id.toString())),
  });
  if (invalid !== null) return { ok: false, error: invalid };

  const saved = await prisma.$transaction(async (tx) => {
    const updated = await tx.spPcbEqReview.updateMany({
      where: { id: reviewId, status: 'draft', version: body.expectedVersion },
      data: {
        message: body.message,
        dueOn: body.dueOn === null ? null : parseKstDate(body.dueOn),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return false;
    const keep = body.items.flatMap((i) => (i.id === undefined ? [] : [BigInt(i.id)]));
    await tx.spPcbEqReviewItem.deleteMany({ where: { reviewId, id: { notIn: keep } } });
    for (const [seq, item] of body.items.entries()) {
      const data = {
        seq,
        factoryNo: item.factoryNo,
        category: item.category,
        question: item.question,
        questionOrig: item.questionOrig,
        options: item.options,
        figures: toEqFiguresJson(item.figures.map((f) => ({ fileId: BigInt(f.fileId), shared: f.shared }))),
        prevItemId: item.prevItemId === null ? null : BigInt(item.prevItemId),
        change: item.change,
        // AI 검토 표시도 통째 교체 — 관리자가 [확인함]으로 지운 것은 입력에서 빠져 있다(안 보내면 전부 지워진다).
        aiFlags: item.aiFlags,
      };
      if (item.id === undefined) {
        await tx.spPcbEqReviewItem.create({ data: { reviewId, ...data } });
      } else {
        await tx.spPcbEqReviewItem.update({ where: { id: BigInt(item.id) }, data });
      }
    }
    return true;
  });
  return saved ? { ok: true } : { ok: false, error: 'VERSION_CONFLICT' };
};

/**
 * 그림 올리기 — 초안에만. 문항에 붙이는 것은 저장(saveEqDraft)의 몫이라 버전을 올리지 않는다
 * (그림 하나 올릴 때마다 열어 둔 편집기의 expectedVersion 이 낡으면 안 된다).
 */
export const uploadEqFigure = async (
  poId: bigint,
  reviewId: bigint,
  file: UploadTarget,
): Promise<Result<{ figure: PcbEqItemFigureType }>> => {
  const loaded = await loadItemsReview(poId, reviewId);
  if (!loaded.ok) return loaded;
  if (loaded.row.status !== 'draft') return { ok: false, error: 'NOT_DRAFT' };
  const mime = eqFigureMime(file.filename, file.mimetype);
  if (mime === null) return { ok: false, error: 'BAD_FIGURE_TYPE' };
  if (file.buffer.length > EQ_FIGURE_MAX_BYTES) return { ok: false, error: 'FIGURE_TOO_LARGE' };

  const [uploaded] = await uploadToFileServer([{ ...file, mimetype: mime }], EQ_UPLOAD_SERVICE_TYPE);
  if (uploaded === undefined) throw new Error('EQ 그림 업로드에 실패했습니다');
  const created = await prisma.spFile.create({
    data: {
      refType: EQ_FIGURE_REF_TYPE,
      refId: reviewId,
      uploadFileName: uploaded.uploadFileName,
      originFileName: file.filename,
      pathToken: uploaded.pathToken,
      size: BigInt(file.buffer.length),
      writeDate: new Date(),
      fileType: EQ_FIGURE_FILE_TYPE,
      uploadedBy: 'ADMIN',
    },
  });
  return {
    ok: true,
    figure: { fileId: Number(created.id), name: created.originFileName, size: Number(created.size), shared: false },
  };
};

/** 그림 지우기 — 초안에만. 문항 그림 목록에서도 뺀다(버전은 올리지 않는다 — 올리기와 같은 이유). */
export const deleteEqFigure = async (
  poId: bigint,
  reviewId: bigint,
  fileId: bigint,
): Promise<Result> => {
  const loaded = await loadItemsReview(poId, reviewId);
  if (!loaded.ok) return loaded;
  const { row } = loaded;
  if (row.status !== 'draft') return { ok: false, error: 'NOT_DRAFT' };
  const file = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (
    file?.refType !== EQ_FIGURE_REF_TYPE ||
    file.refId !== reviewId ||
    file.fileType !== EQ_FIGURE_FILE_TYPE
  ) {
    return { ok: false, error: 'FIGURE_NOT_FOUND' };
  }
  // 개정 회차는 그림 행을 복제한다(같은 pathToken) — 다른 회차가 쓰고 있으면 실파일은 남긴다.
  // 지울 때는 파일서버 먼저(실패 시 행이 남아 재시도 가능 — file-server 관례).
  const sharers = await prisma.spFile.count({
    where: { refType: EQ_FIGURE_REF_TYPE, pathToken: file.pathToken, id: { not: file.id } },
  });
  if (sharers === 0) await deleteFromFileServer(file.pathToken);
  await prisma.$transaction(async (tx) => {
    for (const item of row.items) {
      const refs = parseEqItemFigures(item.figures);
      if (!refs.some((r) => r.fileId === fileId)) continue;
      await tx.spPcbEqReviewItem.update({
        where: { id: item.id },
        data: { figures: toEqFiguresJson(refs.filter((r) => r.fileId !== fileId)) },
      });
    }
    await tx.spFile.delete({ where: { id: fileId } });
  });
  return { ok: true };
};

/** 관리자 열람 — 이 회차의 그림이면 공개 여부와 무관하게. */
export const getAdminEqFigure = async (
  poId: bigint,
  reviewId: bigint,
  fileId: bigint,
): Promise<{ pathToken: string; originFileName: string } | null> => {
  const row = await prisma.spPcbEqReview.findUnique({ where: { id: reviewId }, select: { poId: true } });
  if (row?.poId !== poId) return null;
  const file = await prisma.spFile.findUnique({ where: { id: fileId } });
  if (
    file?.refType !== EQ_FIGURE_REF_TYPE ||
    file.refId !== reviewId ||
    file.fileType !== EQ_FIGURE_FILE_TYPE
  ) {
    return null;
  }
  return { pathToken: file.pathToken, originFileName: file.originFileName };
};

/** 고객에게 보내기 — draft → requested. 문항 ≥1·문항마다 선택지 ≥1. 메일은 라우트가 보낸다. */
export const sendEqDraft = async (
  poId: bigint,
  reviewId: bigint,
  expectedVersion: number,
  actorMbId: string,
): Promise<Result> => {
  const loaded = await loadItemsReview(poId, reviewId);
  if (!loaded.ok) return loaded;
  const { row } = loaded;
  if (row.status !== 'draft') return { ok: false, error: 'NOT_DRAFT' };
  if (row.version !== expectedVersion) return { ok: false, error: 'VERSION_CONFLICT' };
  if (row.items.length === 0) return { ok: false, error: 'NO_ITEMS' };
  if (row.items.some((i) => parseEqItemOptions(i.options).length === 0)) {
    return { ok: false, error: 'ITEM_NO_OPTIONS' };
  }
  return prisma.$transaction(async (tx): Promise<Result> => {
    // EQ 가 그사이 움직였으면 물어볼 대상이 없다(전이가 초안을 닫지만, 잠금으로 순서를 확정한다).
    if ((await lockPoStatus(tx, poId)) !== 'eq_requested') {
      return { ok: false, error: 'NOT_EQ_REQUESTED' };
    }
    const updated = await tx.spPcbEqReview.updateMany({
      where: { id: reviewId, status: 'draft', version: expectedVersion },
      data: {
        status: 'requested',
        requestedAt: new Date(),
        requestedBy: actorMbId,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return { ok: false, error: 'VERSION_CONFLICT' };
    await tx.spPcbEqReviewEvent.create({
      data: {
        reviewId,
        action: 'sent',
        actorRole: 'admin',
        actorMbId,
        note: `문항 ${String(row.items.length)}개`,
      },
    });
    return { ok: true };
  });
};

type AnswerActor =
  | { role: 'customer'; mbId: string }
  | { role: 'admin'; mbId: string; channel: Exclude<PcbEqAnswerChannelType, 'web'>; note: string };

/** 회신 저장 공통 — 고객 회신·관리자 대리 회신이 같은 검증·같은 기록을 쓴다(채널·주체만 다르다). */
const applyEqAnswers = async (
  row: SpPcbEqReview & { items: SpPcbEqReviewItem[] },
  expectedVersion: number,
  answers: readonly PcbEqAnswerInputType[],
  actor: AnswerActor,
): Promise<Result> => {
  if (row.status !== 'requested') return { ok: false, error: 'NOT_REQUESTED' };
  if (row.version !== expectedVersion) return { ok: false, error: 'VERSION_CONFLICT' };
  const checked = validateEqAnswers(row.items, answers);
  if (!checked.ok) return { ok: false, error: checked.error };
  const { decisions } = checked;

  return prisma.$transaction(async (tx): Promise<Result> => {
    // 발주가 EQ 승인요청을 벗어났으면 물어본 전제가 사라진 뒤다(decideEqReview 와 같은 이유).
    if ((await lockPoStatus(tx, row.poId)) !== 'eq_requested') {
      return { ok: false, error: 'NOT_EQ_REQUESTED' };
    }
    const updated = await tx.spPcbEqReview.updateMany({
      where: { id: row.id, status: 'requested', version: expectedVersion },
      data: {
        status: 'answered',
        decidedBy: actor.mbId,
        decidedAt: new Date(),
        answeredRole: actor.role,
        answerChannel: actor.role === 'admin' ? actor.channel : 'web',
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) return { ok: false, error: 'VERSION_CONFLICT' };
    for (const d of decisions) {
      await tx.spPcbEqReviewItem.update({
        where: { id: d.itemId },
        data: { answerKey: d.key, answerComment: d.comment },
      });
    }
    const summary = summarizeEqAnswers(row.items, decisions);
    await tx.spPcbEqReviewEvent.create({
      data: {
        reviewId: row.id,
        action: actor.role === 'admin' ? 'proxy_answered' : 'answered',
        actorRole: actor.role,
        actorMbId: actor.mbId,
        channel: actor.role === 'admin' ? actor.channel : 'web',
        // 대리 회신은 근거 메모가 본문이다(누가 어떤 경로로 들었는가) — 답 요약은 뒤에 붙인다.
        note: actor.role === 'admin' ? `${actor.note} (${summary})` : summary,
      },
    });
    return { ok: true };
  });
};

/** 고객 회신 — 소유권은 spec.mbId. 작성 중·남의 회차는 404(존재를 알리지 않는다). */
export const answerEqReview = async (
  reviewId: bigint,
  mbId: string,
  body: { expectedVersion: number; answers: PcbEqAnswerInputType[] },
): Promise<Result<{ poId: bigint; specId: bigint }>> => {
  const row = await prisma.spPcbEqReview.findUnique({
    where: { id: reviewId },
    include: { items: { orderBy: { seq: 'asc' } } },
  });
  if (row === null) return { ok: false, error: 'REVIEW_NOT_FOUND' };
  const spec = await prisma.spOrderSpec.findUnique({
    where: { id: row.specId },
    select: { mbId: true },
  });
  if (spec?.mbId !== mbId) return { ok: false, error: 'NOT_OWNER' };
  if (row.status === 'draft') return { ok: false, error: 'REVIEW_NOT_FOUND' };
  if (row.format !== 'items') return { ok: false, error: 'WRONG_FORMAT' };
  const done = await applyEqAnswers(row, body.expectedVersion, body.answers, { role: 'customer', mbId });
  return done.ok ? { ok: true, poId: row.poId, specId: row.specId } : done;
};

/** 관리자 대리 회신 — 전화·메일로 들은 답을 대신 넣는다(채널·근거 필수, 고객 메일 없음). */
export const proxyAnswerEqReview = async (
  poId: bigint,
  reviewId: bigint,
  body: {
    expectedVersion: number;
    answers: PcbEqAnswerInputType[];
    channel: Exclude<PcbEqAnswerChannelType, 'web'>;
    note: string;
  },
  actorMbId: string,
): Promise<Result> => {
  const loaded = await loadItemsReview(poId, reviewId);
  if (!loaded.ok) return loaded;
  return applyEqAnswers(loaded.row, body.expectedVersion, body.answers, {
    role: 'admin',
    mbId: actorMbId,
    channel: body.channel,
    note: body.note,
  });
};

/** 협력사에 전달 — 고객 회신이 온 회차만, 한 번. 포털 '고객 회신' 영역은 이 시각부터 열린다. */
export const forwardEqReview = async (
  poId: bigint,
  reviewId: bigint,
  expectedVersion: number,
  actorMbId: string,
): Promise<Result> => {
  const loaded = await loadItemsReview(poId, reviewId);
  if (!loaded.ok) return loaded;
  const { row } = loaded;
  if (row.status !== 'answered') return { ok: false, error: 'NOT_ANSWERED' };
  if (row.forwardedAt !== null) return { ok: false, error: 'ALREADY_FORWARDED' };
  if (row.version !== expectedVersion) return { ok: false, error: 'VERSION_CONFLICT' };
  return prisma.$transaction(async (tx): Promise<Result> => {
    const updated = await tx.spPcbEqReview.updateMany({
      where: { id: reviewId, status: 'answered', forwardedAt: null, version: expectedVersion },
      data: { forwardedAt: new Date(), forwardedBy: actorMbId, version: { increment: 1 } },
    });
    if (updated.count !== 1) return { ok: false, error: 'VERSION_CONFLICT' };
    await tx.spPcbEqReviewEvent.create({
      data: { reviewId, action: 'forwarded', actorRole: 'admin', actorMbId },
    });
    return { ok: true };
  });
};

// ── D20 P2 — AI 분석 결과를 초안으로 ─────────────────────────────────────────
// 분석(추출·LLM·사후 검사)은 lib/ai/pcb-eq-runner.ts 가 하고, 여기는 **결과를 회차에 써 넣는 일**만 한다
// (열린 회차 규칙·발주서 잠금·개정 대조가 손으로 만드는 초안과 같은 자리에 있게).

/** 러너가 파일 서버에 먼저 올려 둔 그림 — 여기서 회차 그림(sp_file) 행이 된다. */
export interface EqAiDraftFigure {
  /** 분석 결과의 그림 id(`figureRefs` 의 값) — 문항에 붙일 때의 열쇠. */
  ref: string;
  uploadFileName: string;
  pathToken: string;
  originFileName: string;
  size: number;
}

export interface EqAiDraftItem extends PcbEqDraftItemType {
  figureRefs: string[];
  aiFlags: PcbEqAiFlagType[];
}

/** 적용하지 않은 사유 — 분석은 됐는데 초안에 못 넣은 경우(잡은 done·미적용으로 남는다). */
export type EqAiApplySkip = 'PO_NOT_FOUND' | 'NOT_EQ_REQUESTED' | 'DRAFT_EXISTS' | 'ALREADY_OPEN';

/**
 * 그림 실파일 정리 — 어느 회차 그림 행도 가리키지 않는 pathToken 만 파일 서버에서 지운다(개정 회차가
 * 행을 복제해 같은 실파일을 함께 쓴다). 실패한 토큰을 돌려준다(부르는 쪽이 로그로 남긴다 — 고아 파일일 뿐
 * 흐름을 막을 일은 아니다).
 */
export const deleteUnsharedEqFigureBlobs = async (pathTokens: readonly string[]): Promise<string[]> => {
  const failed: string[] = [];
  for (const token of new Set(pathTokens)) {
    try {
      const sharers = await prisma.spFile.count({
        where: { refType: EQ_FIGURE_REF_TYPE, pathToken: token },
      });
      if (sharers === 0) await deleteFromFileServer(token);
    } catch {
      failed.push(token);
    }
  }
  return failed;
};

/**
 * AI 분석 결과를 문항형 초안으로 써 넣는다(D20 P2).
 *  · 열린 회차가 없으면 새 초안.
 *  · 열린 **초안**이 있고 `replaceDraft` 면 그 초안의 문항·그림을 통째로 바꾼다(머리말·기한은 둔다, version+1 —
 *    열어 둔 편집기의 늦은 저장은 409 로 튕긴다).
 *  · 초안이 있는데 replaceDraft 가 아니면 `DRAFT_EXISTS`, 이미 고객에게 나간 회차가 열려 있으면 `ALREADY_OPEN`.
 * 그림은 문항에 **공개(shared)** 로 붙인다(P2-8 — 고객은 그림이 있어야 답한다. 관리자는 예외만 끈다).
 * 개정 연결은 **고객이 마지막으로 본 회차**와의 결정적 대조(linkEqRevision) — 그런 회차가 없으면 첫 회차라
 * 변화 표시가 없다. 이벤트는 `ai_drafted`(system) 하나.
 */
export const applyEqAiDraft = async (
  poId: bigint,
  input: {
    replaceDraft: boolean;
    sourceFileId: bigint;
    /** 수동 요청이면 누른 관리자, 자동이면 null. */
    actorMbId: string | null;
    /** 이벤트 메모 — 모델·프롬프트 판·문항 수. */
    note: string;
    items: readonly EqAiDraftItem[];
    figures: readonly EqAiDraftFigure[];
  },
): Promise<
  | { ok: true; reviewId: bigint; replaced: boolean; staleTokens: string[] }
  | { ok: false; reason: EqAiApplySkip }
> => {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId }, select: { specId: true } });
  if (po === null) return { ok: false, reason: 'PO_NOT_FOUND' };

  // 직전 회차 = 고객에게 나간 적 있는 문항형 회차 중 가장 최근(안 나간 초안은 고객이 본 적 없어 견줄 대상이 아니다).
  const prev = await prisma.spPcbEqReview.findFirst({
    where: { poId, format: 'items', items: { some: {} }, events: { some: { action: 'sent' } } },
    orderBy: { id: 'desc' },
    include: { items: { orderBy: { seq: 'asc' } } },
  });
  const links =
    prev === null
      ? null
      : linkEqRevision(
          input.items,
          prev.items.map((i) => ({
            factoryNo: i.factoryNo,
            questionOrig: i.questionOrig,
            options: parseEqItemOptions(i.options),
          })),
        );
  const sourceFileIds = [Number(input.sourceFileId)];

  return prisma.$transaction(
    async (
      tx,
    ): Promise<
      | { ok: true; reviewId: bigint; replaced: boolean; staleTokens: string[] }
      | { ok: false; reason: EqAiApplySkip }
    > => {
      if ((await lockPoStatus(tx, poId)) !== 'eq_requested') return { ok: false, reason: 'NOT_EQ_REQUESTED' };
      const open = await tx.spPcbEqReview.findFirst({
        where: { poId, status: { in: [...PCB_EQ_OPEN_STATUSES] } },
        select: { id: true, status: true, format: true },
      });
      let reviewId: bigint;
      let staleTokens: string[] = [];
      if (open === null) {
        const created = await tx.spPcbEqReview.create({
          data: {
            poId,
            specId: po.specId,
            status: 'draft',
            format: 'items',
            message: '',
            sharedFileIds: [],
            sourceFileIds,
            requestedBy: input.actorMbId ?? 'system',
            prevReviewId: prev?.id ?? null,
          },
        });
        reviewId = created.id;
      } else {
        if (open.status !== 'draft' || open.format !== 'items') return { ok: false, reason: 'ALREADY_OPEN' };
        if (!input.replaceDraft) return { ok: false, reason: 'DRAFT_EXISTS' };
        const updated = await tx.spPcbEqReview.updateMany({
          where: { id: open.id, status: 'draft' },
          data: { sourceFileIds, prevReviewId: prev?.id ?? null, version: { increment: 1 } },
        });
        if (updated.count !== 1) return { ok: false, reason: 'ALREADY_OPEN' };
        reviewId = open.id;
        const oldFigures = await tx.spFile.findMany({
          where: { refType: EQ_FIGURE_REF_TYPE, refId: reviewId },
          select: { pathToken: true },
        });
        staleTokens = oldFigures.map((f) => f.pathToken);
        await tx.spPcbEqReviewItem.deleteMany({ where: { reviewId } });
        await tx.spFile.deleteMany({ where: { refType: EQ_FIGURE_REF_TYPE, refId: reviewId } });
      }

      const fileIdByRef = new Map<string, bigint>();
      for (const f of input.figures) {
        const row = await tx.spFile.create({
          data: {
            refType: EQ_FIGURE_REF_TYPE,
            refId: reviewId,
            uploadFileName: f.uploadFileName,
            originFileName: f.originFileName,
            pathToken: f.pathToken,
            size: BigInt(f.size),
            writeDate: new Date(),
            fileType: EQ_FIGURE_FILE_TYPE,
            uploadedBy: 'AI',
          },
        });
        fileIdByRef.set(f.ref, row.id);
      }
      for (const [seq, item] of input.items.entries()) {
        const link = links?.[seq];
        const prevItem = link?.prevIndex == null ? undefined : prev?.items[link.prevIndex];
        const figures = item.figureRefs.flatMap((ref) => {
          const fileId = fileIdByRef.get(ref);
          return fileId === undefined ? [] : [{ fileId, shared: true }];
        });
        await tx.spPcbEqReviewItem.create({
          data: {
            reviewId,
            seq,
            factoryNo: item.factoryNo,
            category: item.category,
            question: item.question,
            questionOrig: item.questionOrig,
            options: item.options,
            figures: toEqFiguresJson(figures),
            prevItemId: prevItem?.id ?? null,
            change: link?.change ?? null,
            aiFlags: item.aiFlags,
          },
        });
      }
      await tx.spPcbEqReviewEvent.create({
        data: {
          reviewId,
          action: 'ai_drafted',
          actorRole: 'system',
          actorMbId: input.actorMbId,
          note: input.note,
        },
      });
      return { ok: true, reviewId, replaced: open !== null, staleTokens };
    },
  );
};

/**
 * 발주서 삭제 전 문항 그림 정리 — 회차·문항은 발주서 cascade 로 사라지지만 sp_file 은
 * refType/refId 규약(FK 없음)이라 따라가지 않는다. 같은 발주서의 회차끼리 공유한 실파일은
 * 한꺼번에 지워지므로, 이 발주서 밖에서 쓰는 pathToken 만 남긴다(복제는 발주서 안에서만 일어난다).
 */
export const deletePoEqFigures = async (poId: bigint): Promise<void> => {
  const reviews = await prisma.spPcbEqReview.findMany({ where: { poId }, select: { id: true } });
  if (reviews.length === 0) return;
  const files = await prisma.spFile.findMany({
    where: { refType: EQ_FIGURE_REF_TYPE, refId: { in: reviews.map((r) => r.id) } },
    select: { id: true, pathToken: true },
  });
  if (files.length === 0) return;
  const ids = files.map((f) => f.id);
  for (const token of new Set(files.map((f) => f.pathToken))) {
    const outside = await prisma.spFile.count({
      where: { refType: EQ_FIGURE_REF_TYPE, pathToken: token, id: { notIn: ids } },
    });
    if (outside === 0) await deleteFromFileServer(token);
  }
  await prisma.spFile.deleteMany({ where: { id: { in: ids } } });
};
