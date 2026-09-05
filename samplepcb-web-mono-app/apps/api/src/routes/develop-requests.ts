import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import type { SpDevelopEvent, SpDevelopMilestone, SpDevelopQuote, SpDevelopQuoteItem, SpDevelopRequest, SpFile } from '@prisma/client';
import { z } from 'zod';
import {
  DevelopCancelBody,
  DevelopCommentBody,
  DevelopQuoteAcceptBody,
  DevelopQuoteDeclineBody,
  DevelopRequestCreatePayload,
  DevelopRequestListQuery,
  DevelopRequestUpdateBody,
  DevelopReviewDecisionBody,
  MARKET_BUDGET_RANGE_LABELS,
  fileViewKind,
  isDevelopCustomerCancellable,
  isDevelopEditable,
  marketRequiredMissing,
  needsServerPreview,
  normalizeMarketTools,
  resolveFileMime,
} from '@sp/api-contract';
import type {
  DevelopMilestoneViewType,
  DevelopQuoteViewType,
  DevelopRequestDetailType,
  DevelopRequestListItemType,
  DevelopRequestStatusType,
  MarketContractPaymentType,
} from '@sp/api-contract';
import {
  DEVELOP_FILE_SERVICE_TYPE,
  REF_DEVELOP_EVENT,
  REF_DEVELOP_QUOTE,
  REF_DEVELOP_REQUEST,
  addDevelopEvent,
  asDevelopStatus,
  asMilestoneStatus,
  asMilestoneTrigger,
  asQuoteKind,
  asQuoteStatus,
  asVatMode,
  developDeliverablesLocked,
  developEventFileGate,
  developEventFiles,
  toDevelopContact,
  toDevelopEventView,
  toDevelopFileMeta,
  transitionDevelopStatus,
} from '../lib/develop';
import { startDevelopAiDrafts } from '../lib/develop-ai';
import {
  buildAdminNewRequestEmail,
  buildAdminQuoteAcceptedEmail,
  buildCommentEmail,
  buildCompletedEmail,
  buildRequestReceivedEmail,
  buildStatusChangedEmail,
  sendDevelopMail,
  sendDevelopMailToAdmins,
} from '../lib/develop-email';
import { cancelPendingMilestones, deriveMilestonePayment, ensureDevelopLazy } from '../lib/develop-payment';
import { getDevelopSettings } from '../lib/develop-settings';
import { developReviewPublicSeq } from '../lib/develop-review-versions';
import { buildFilePreview } from '../lib/file-preview';
import { downloadFromFileServer, uploadToFileServer } from '../lib/file-server';
import type { UploadedFileType } from '../lib/file-server';
import {
  DEVELOP_ANCHOR_IT_ID,
  deleteCartRow,
  deleteCartRowsByIoId,
  deleteQuoteOption,
  getCartRowByCtId,
  getDevelopAnchorItem,
  getMembersByIds,
  getOrderInfoByCtId,
  insertCartRow,
  insertQuoteOption,
  selectCartRows,
} from '../lib/g5-db';
import {
  asBudgetRange,
  collectMultipart,
  deleteMarketFile,
  splitMarketAttachments,
  toAnswers,
  toAreaCodes,
  toDevDiagram,
  toDevReview,
  toTools,
} from '../lib/market';
import { prisma } from '../lib/prisma';

// ── /api/develop/requests — 개발의뢰 회원 라우트(docs/DEVELOP_FLOW.md §8) ──────────────────
// 공개 목록이 없다: 모든 조회는 **소유자**(request.mbId === JWT mbId)만. 관리자는 admin-develop-* 라우트를 쓴다.
// AI 산출물은 공개본(devReviewPublic·devDiagramPublicHtml)만 내려간다 — 초안·작업본은 어떤 응답에도 없다.
// 에러 봉투 { result:false, error:'CODE' }(마켓 회원 라우트 관례).

const RequestIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const RequestFileParams = z.object({ id: z.string().regex(/^\d+$/), fileId: z.string().regex(/^\d+$/) });
const RequestQuoteParams = z.object({ id: z.string().regex(/^\d+$/), qid: z.string().regex(/^\d+$/) });
const RequestMilestoneParams = z.object({ id: z.string().regex(/^\d+$/), mid: z.string().regex(/^\d+$/) });
const RequestEventParams = z.object({ id: z.string().regex(/^\d+$/), eventId: z.string().regex(/^\d+$/) });

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';
// 취소류 카트 라인(마켓 checkout 관례) — 이 상태면 재주입 대상.
const CANCELLED_ROW_STATUSES = new Set(['삭제', '취소', '반품', '품절']);

const requestFilesOf = (requestId: bigint): Promise<SpFile[]> =>
  prisma.spFile.findMany({
    where: { refType: REF_DEVELOP_REQUEST, refId: requestId, fileType: 'attachment' },
    orderBy: { id: 'asc' },
  });

type QuoteWithChildren = SpDevelopQuote & { items: SpDevelopQuoteItem[]; milestones: SpDevelopMilestone[] };

// 결제 가능 판정 — pending ∧ trigger 조건. 서버 파생값이라 화면은 계산하지 않는다.
export const milestonePayable = (m: SpDevelopMilestone, status: DevelopRequestStatusType): boolean => {
  if (m.status !== 'pending') return false;
  switch (m.trigger) {
    case 'on_accept':
      return true;
    case 'on_delivery':
      return status === 'delivered' || status === 'completed';
    case 'on_completion':
      return status === 'completed';
    default:
      return false; // manual — 관리자가 pending 으로 열어 둔 것만(P2: 별도 플래그)
  }
};

export const toMilestoneView = (m: SpDevelopMilestone, status: DevelopRequestStatusType): DevelopMilestoneViewType => ({
  milestoneId: Number(m.id),
  quoteId: Number(m.quoteId),
  seq: m.seq,
  title: m.title,
  ratioBp: m.ratioBp,
  amount: m.amount,
  trigger: asMilestoneTrigger(m.trigger),
  status: asMilestoneStatus(m.status),
  payable: milestonePayable(m, status),
  unlocksDeliverables: m.unlocksDeliverables,
  paidAt: m.paidAt?.toISOString() ?? null,
  paidBy: m.paidBy === 'lazy' || m.paidBy === 'admin' ? m.paidBy : null,
  payment: null, // 영카트 od 파생은 P2(lazy 승격)에서 채운다
});

const toDeliverables = (json: Prisma.JsonValue | null): string[] =>
  Array.isArray(json) ? json.filter((v): v is string => typeof v === 'string') : [];

export const toQuoteView = (q: QuoteWithChildren, status: DevelopRequestStatusType, poFile: SpFile | null): DevelopQuoteViewType => ({
  quoteId: Number(q.id),
  requestId: Number(q.requestId),
  version: q.version,
  kind: asQuoteKind(q.kind),
  status: asQuoteStatus(q.status),
  title: q.title,
  vatMode: asVatMode(q.vatMode),
  supplyAmount: q.supplyAmount,
  vatAmount: q.vatAmount,
  totalAmount: q.totalAmount,
  durationDays: q.durationDays,
  scheduleNote: q.scheduleNote,
  deliverables: toDeliverables(q.deliverables),
  exclusions: q.exclusions,
  terms: q.terms,
  warrantyDays: q.warrantyDays,
  reviewDays: q.reviewDays,
  validUntil: q.validUntil,
  note: q.note,
  sentAt: q.sentAt?.toISOString() ?? null,
  acceptedAt: q.acceptedAt?.toISOString() ?? null,
  acceptedName: q.acceptedName,
  declinedAt: q.declinedAt?.toISOString() ?? null,
  declineReason: q.declineReason,
  items: q.items
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((it) => ({
      itemId: Number(it.id),
      seq: it.seq,
      title: it.title,
      description: it.description,
      amount: it.amount,
      durationDays: it.durationDays,
    })),
  milestones: q.milestones
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map((m) => toMilestoneView(m, status)),
  poFile: poFile === null ? null : toDevelopFileMeta(poFile),
});

// 고객이 지금 할 일 — 견적 검토 > 결제 > 검수 > 확인 요청 답변.
const nextActionOf = (
  status: DevelopRequestStatusType,
  quotes: readonly SpDevelopQuote[],
  milestones: readonly SpDevelopMilestone[],
  events: readonly SpDevelopEvent[],
): DevelopRequestListItemType['nextAction'] => {
  if (quotes.some((q) => q.status === 'sent')) return 'review_quote';
  if (milestones.some((m) => milestonePayable(m, status))) return 'pay';
  if (status === 'delivered') return 'inspect';
  // 마지막 확인 요청 뒤에 승인/수정 요청이 없으면 답변 차례.
  let pendingReview = false;
  for (const e of events) {
    if (e.type === 'review_request') pendingReview = true;
    else if (e.type === 'review_approved' || e.type === 'review_changes') pendingReview = false;
  }
  return pendingReview ? 'answer_review' : null;
};

const toListItem = (
  r: SpDevelopRequest,
  quotes: readonly SpDevelopQuote[],
  milestones: readonly SpDevelopMilestone[],
  events: readonly SpDevelopEvent[],
): DevelopRequestListItemType => {
  const status = asDevelopStatus(r.status);
  return {
    requestId: Number(r.id),
    title: r.title,
    serviceAreas: toAreaCodes(r.serviceAreas),
    status,
    budgetRange: asBudgetRange(r.budgetRange),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    nextAction: nextActionOf(status, quotes, milestones, events),
    reviewPublished: r.devReviewPublic !== null,
    diagramPublished: r.devDiagramPublicHtml !== null,
  };
};

// 상세 — 소유자용. 공개본만·visibleToCustomer 이벤트만·draft 견적 제외.
export async function buildDevelopRequestDetail(r: SpDevelopRequest): Promise<DevelopRequestDetailType> {
  const status = asDevelopStatus(r.status);
  const [files, quotes, events, locked] = await Promise.all([
    requestFilesOf(r.id),
    prisma.spDevelopQuote.findMany({
      where: { requestId: r.id, status: { not: 'draft' } },
      include: { items: true, milestones: true },
      orderBy: { version: 'asc' },
    }),
    prisma.spDevelopEvent.findMany({ where: { requestId: r.id, visibleToCustomer: true }, orderBy: { id: 'asc' } }),
    developDeliverablesLocked(r.id),
  ]);
  const [eventFiles, poFiles] = await Promise.all([
    developEventFiles(events.map((e) => e.id)),
    prisma.spFile.findMany({ where: { refType: REF_DEVELOP_QUOTE, refId: { in: quotes.map((q) => q.id) }, fileType: 'po' } }),
  ]);
  const poByQuote = new Map(poFiles.map((f) => [f.refId.toString(), f]));
  const milestones = quotes.flatMap((q) => q.milestones);
  // 영카트 주문 파생(od 상태·수납·미수) — 카트행이 있는 마일스톤만. 저장 아님(마켓 deriveContractPayment 동형).
  const payments = new Map<string, MarketContractPaymentType | null>();
  for (const m of milestones) {
    if (m.ctId !== null) payments.set(m.id.toString(), await deriveMilestonePayment(m.ctId));
  }
  const withPayment = (view: DevelopQuoteViewType): DevelopQuoteViewType => ({
    ...view,
    milestones: view.milestones.map((mv) => ({ ...mv, payment: payments.get(String(mv.milestoneId)) ?? null })),
  });
  const diagramMeta = toDevDiagram(r.devDiagram);
  return {
    ...toListItem(r, quotes, milestones, events),
    description: r.description,
    tools: toTools(r.tools),
    answers: toAnswers(r.answers),
    contact: toDevelopContact(r),
    ndaWanted: r.ndaWanted,
    aiConsent: r.aiConsent,
    files: files.map((f) => toDevelopFileMeta(f)),
    review: toDevReview(r.devReviewPublic),
    reviewPublishedAt: r.devReviewPublishedAt?.toISOString() ?? null,
    reviewPublicSeq: await developReviewPublicSeq(prisma, r.id, r.devReviewPublic),
    diagram:
      r.devDiagramPublicHtml === null || r.devDiagramPublishedAt === null
        ? null
        : {
            html: r.devDiagramPublicHtml,
            publishedAt: r.devDiagramPublishedAt.toISOString(),
            source: r.devDiagramSource === 'upload' ? 'upload' : 'ai',
            meta: diagramMeta,
          },
    quotes: quotes.map((q) => withPayment(toQuoteView(q, status, poByQuote.get(q.id.toString()) ?? null))),
    // 고객에게 담당자는 이름을 가르지 않는다 — "담당자". 고객 자신의 글은 "나".
    events: events.map((e) => toDevelopEventView(e, eventFiles.get(e.id.toString()) ?? [], e.byAdmin ? '담당자' : '나', locked)),
    reviewDays: r.reviewDays,
    startedAt: r.startedAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    completedAt: r.completedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
    declinedReason: r.declinedReason,
    viewer: {
      canEdit: isDevelopEditable(status),
      canCancel: isDevelopCustomerCancellable(status),
      deliverablesLocked: locked,
    },
  };
}

// 알림 수신자 — 고객은 연락처 이메일(담당자 메일이 회원 메일과 다를 수 있다) ?? 회원 메일.
export const customerEmailOf = async (r: SpDevelopRequest): Promise<string | undefined> => {
  if (r.contactEmail.trim() !== '') return r.contactEmail.trim();
  const members = await getMembersByIds([r.mbId]);
  const email = members.get(r.mbId)?.email ?? '';
  return email === '' ? undefined : email;
};

export const developRequestRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // 소유자 로드 — 없으면 404, 남의 것이면 403.
  const loadOwned = async (
    id: string,
    mbId: string,
  ): Promise<{ ok: true; request: SpDevelopRequest } | { ok: false; status: 403 | 404; error: string }> => {
    const request = await prisma.spDevelopRequest.findUnique({ where: { id: BigInt(id) } });
    if (request === null) return { ok: false, status: 404, error: 'NOT_FOUND' };
    if (request.mbId !== mbId) return { ok: false, status: 403, error: 'FORBIDDEN' };
    return { ok: true, request };
  };

  // ── POST /develop/requests — 등록(multipart: payload + attachment[] + attachment:<area>:<slot>[]) ──
  fastify.post('/develop/requests', async (request, reply) => {
    if (!request.isMultipart()) return reply.status(400).send({ result: false, error: 'MULTIPART_REQUIRED' });
    const { files, rawPayload } = await collectMultipart(request);
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ result: false, error: 'UNAUTHORIZED' });
    }
    const mbId = request.user.mbId;
    if (rawPayload === undefined) return reply.status(400).send({ result: false, error: 'PAYLOAD_REQUIRED' });
    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(rawPayload);
    } catch {
      return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH' });
    }
    const parsed = DevelopRequestCreatePayload.safeParse(payloadJson);
    if (!parsed.success) {
      return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH', issues: parsed.error.issues });
    }
    const payload = parsed.data;
    const split = splitMarketAttachments(files, payload.serviceAreas);
    if (split.invalid.length > 0) return reply.status(400).send({ result: false, error: 'ATTACHMENT_FIELD_INVALID' });
    const attachments = split.accepted;
    // 프로젝트 공통 조건(완료 시점·목표 단계·인도 범위)은 필수 — 모르면 탈출구(unknown)를 골라야 한다(마켓 §13.8 과 같은 함수).
    const requiredMissing = marketRequiredMissing(payload.answers, payload.serviceAreas);
    if (requiredMissing.length > 0) {
      return reply.status(400).send({ result: false, error: 'ANSWERS_REQUIRED', missing: requiredMissing });
    }

    let uploaded: UploadedFileType[] = [];
    if (attachments.length > 0) {
      try {
        uploaded = await uploadToFileServer(
          attachments.map((f) => ({ buffer: f.buffer, filename: f.filename, mimetype: f.mimetype })),
          DEVELOP_FILE_SERVICE_TYPE,
        );
      } catch (err) {
        request.log.error({ err }, 'develop request file upload failed');
        return reply.status(502).send({ result: false, error: 'FILE_UPLOAD_FAILED' });
      }
    }

    const settings = await getDevelopSettings();
    const now = new Date();
    const created = await prisma.$transaction(async (tx) => {
      const r = await tx.spDevelopRequest.create({
        data: {
          mbId,
          title: payload.title,
          serviceAreas: payload.serviceAreas,
          tools: normalizeMarketTools(payload.tools, payload.serviceAreas),
          description: payload.description,
          answers: payload.answers.length > 0 ? payload.answers : Prisma.DbNull,
          contactName: payload.contact.name,
          contactCompany: payload.contact.company,
          contactPhone: payload.contact.phone,
          contactEmail: payload.contact.email,
          contactHours: payload.contact.hours,
          budgetRange: payload.budgetRange,
          ndaWanted: payload.ndaWanted,
          aiConsent: payload.aiConsent,
          reviewDays: settings.defaultReviewDays,
        },
      });
      if (uploaded.length > 0) {
        await tx.spFile.createMany({
          data: uploaded.map((u, i) => ({
            refType: REF_DEVELOP_REQUEST,
            refId: r.id,
            uploadFileName: u.uploadFileName,
            originFileName: u.originFileName,
            pathToken: u.pathToken,
            size: BigInt(u.size),
            writeDate: now,
            fileType: 'attachment',
            area: attachments[i]?.area ?? null,
            slot: attachments[i]?.slot ?? null,
          })),
        });
      }
      await addDevelopEvent(tx, r.id, {
        type: 'status_changed',
        actorMbId: mbId,
        byAdmin: false,
        title: '의뢰가 접수되었습니다',
        payload: { to: 'received', from: [] },
      });
      return r;
    });

    // 알림(비차단) — 고객 접수 확인 + 관리자 새 의뢰.
    const brief = { requestId: Number(created.id), title: created.title, serviceAreas: payload.serviceAreas };
    void sendDevelopMail(
      request.log,
      await customerEmailOf(created),
      buildRequestReceivedEmail({ ...brief, contactName: created.contactName }),
      { kind: 'develop_received', refType: 'develop_request', refId: created.id, sentBy: null, toMbId: mbId },
    );
    void sendDevelopMailToAdmins(
      request.log,
      settings.notifyEmails,
      buildAdminNewRequestEmail({
        ...brief,
        contactName: created.contactName,
        contactCompany: created.contactCompany,
        contactPhone: created.contactPhone,
        budgetLabel: MARKET_BUDGET_RANGE_LABELS[asBudgetRange(created.budgetRange)],
      }),
      { kind: 'develop_admin_new', refType: 'develop_request', refId: created.id, sentBy: null, toMbId: null },
    );

    // AI 자동 초안(관리자 전용) — 고객은 기다리지 않는다. 실패는 로그만(등록은 이미 끝났다).
    // aiQueued = 동의했고 설정이 자동 초안을 켜 두었을 때(유스케이스 토글은 러너가 본다).
    let aiQueued = false;
    if (created.aiConsent && (settings.aiAutoDraft || settings.aiDiagramAutoDraft)) {
      aiQueued = true;
      void startDevelopAiDrafts(created, request.log, { review: true, diagram: true, auto: true }).catch((err: unknown) => {
        request.log.warn({ err, requestId: Number(created.id) }, 'develop ai auto draft failed to start');
      });
    }
    request.log.info({ requestId: Number(created.id), mbId, files: uploaded.length, aiQueued }, 'develop request created');
    return { result: true as const, data: { requestId: Number(created.id), status: asDevelopStatus(created.status), aiQueued } };
  });

  // ── GET /develop/my/requests — 내 의뢰 목록 ─────────────────────────────────
  fastify.get(
    '/develop/my/requests',
    { schema: { querystring: DevelopRequestListQuery }, preHandler: fastify.authenticate },
    async (request) => {
      const { page, pageSize } = request.query;
      const where = { mbId: request.user.mbId };
      const [rows, total] = await Promise.all([
        prisma.spDevelopRequest.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.spDevelopRequest.count({ where }),
      ]);
      const ids = rows.map((r) => r.id);
      const [quotes, milestones, events] = await Promise.all([
        prisma.spDevelopQuote.findMany({ where: { requestId: { in: ids }, status: { not: 'draft' } } }),
        prisma.spDevelopMilestone.findMany({ where: { requestId: { in: ids } } }),
        prisma.spDevelopEvent.findMany({
          where: { requestId: { in: ids }, type: { in: ['review_request', 'review_approved', 'review_changes'] } },
          orderBy: { id: 'asc' },
        }),
      ]);
      const byReq = <T extends { requestId: bigint }>(list: T[]): Map<string, T[]> => {
        const m = new Map<string, T[]>();
        for (const x of list) {
          const k = x.requestId.toString();
          m.set(k, [...(m.get(k) ?? []), x]);
        }
        return m;
      };
      const qm = byReq(quotes);
      const mm = byReq(milestones);
      const em = byReq(events);
      return {
        result: true as const,
        data: {
          items: rows.map((r) => {
            const k = r.id.toString();
            return toListItem(r, qm.get(k) ?? [], mm.get(k) ?? [], em.get(k) ?? []);
          }),
          total,
          page,
          pageSize,
        },
      };
    },
  );

  // ── GET /develop/requests/:id — 상세(소유자) ────────────────────────────────
  fastify.get(
    '/develop/requests/:id',
    { schema: { params: RequestIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      // 읽기 전 lazy 승격(결제 확인·견적 만료·자동확정) — cron 없는 상태 머신의 유일한 진전 지점.
      const fresh = await ensureDevelopLazy(found.request, request.log);
      return { result: true as const, data: await buildDevelopRequestDetail(fresh) };
    },
  );

  // ── PATCH /develop/requests/:id — 수정(received·reviewing) ───────────────────
  fastify.patch(
    '/develop/requests/:id',
    { schema: { params: RequestIdParams, body: DevelopRequestUpdateBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = found.request;
      if (!isDevelopEditable(asDevelopStatus(r.status))) return reply.status(409).send({ result: false, error: 'NOT_EDITABLE' });
      const b = request.body;
      const areas = b.serviceAreas ?? toAreaCodes(r.serviceAreas);
      if (b.answers !== undefined || b.serviceAreas !== undefined) {
        const answers = b.answers ?? toAnswers(r.answers);
        const missing = marketRequiredMissing(answers, areas);
        if (missing.length > 0) return reply.status(400).send({ result: false, error: 'ANSWERS_REQUIRED', missing });
      }
      const data: Prisma.SpDevelopRequestUpdateInput = {};
      const changed: string[] = [];
      if (b.title !== undefined && b.title !== r.title) { data.title = b.title; changed.push('title'); }
      if (b.serviceAreas !== undefined) { data.serviceAreas = b.serviceAreas; changed.push('serviceAreas'); }
      if (b.tools !== undefined) { data.tools = normalizeMarketTools(b.tools, areas); changed.push('tools'); }
      if (b.description !== undefined && b.description !== r.description) { data.description = b.description; changed.push('description'); }
      if (b.answers !== undefined) { data.answers = b.answers; changed.push('answers'); }
      if (b.budgetRange !== undefined && b.budgetRange !== r.budgetRange) { data.budgetRange = b.budgetRange; changed.push('budgetRange'); }
      if (b.ndaWanted !== undefined && b.ndaWanted !== r.ndaWanted) { data.ndaWanted = b.ndaWanted; changed.push('ndaWanted'); }
      if (b.contact !== undefined) {
        data.contactName = b.contact.name;
        data.contactCompany = b.contact.company;
        data.contactPhone = b.contact.phone;
        data.contactEmail = b.contact.email;
        data.contactHours = b.contact.hours;
        changed.push('contact');
      }
      if (changed.length === 0) return { result: true as const, data: await buildDevelopRequestDetail(r) };
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.spDevelopRequest.update({ where: { id: r.id }, data });
        await addDevelopEvent(tx, r.id, {
          type: 'edited',
          actorMbId: request.user.mbId,
          byAdmin: false,
          title: '의뢰 내용을 수정했습니다',
          payload: { changedFields: changed },
        });
        return u;
      });
      return { result: true as const, data: await buildDevelopRequestDetail(updated) };
    },
  );

  // ── POST /develop/requests/:id/files — 첨부 추가(multipart, received·reviewing) ──
  fastify.post('/develop/requests/:id/files', async (request, reply) => {
    if (!request.isMultipart()) return reply.status(400).send({ result: false, error: 'MULTIPART_REQUIRED' });
    const { files } = await collectMultipart(request);
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ result: false, error: 'UNAUTHORIZED' });
    }
    const params = RequestIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ result: false, error: 'BAD_PARAMS' });
    const found = await loadOwned(params.data.id, request.user.mbId);
    if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
    const r = found.request;
    if (!isDevelopEditable(asDevelopStatus(r.status))) return reply.status(409).send({ result: false, error: 'NOT_EDITABLE' });
    const split = splitMarketAttachments(files, toAreaCodes(r.serviceAreas));
    if (split.invalid.length > 0 || split.accepted.length === 0) {
      return reply.status(400).send({ result: false, error: 'ATTACHMENT_FIELD_INVALID' });
    }
    let uploaded: UploadedFileType[];
    try {
      uploaded = await uploadToFileServer(
        split.accepted.map((f) => ({ buffer: f.buffer, filename: f.filename, mimetype: f.mimetype })),
        DEVELOP_FILE_SERVICE_TYPE,
      );
    } catch (err) {
      request.log.error({ err }, 'develop request file upload failed');
      return reply.status(502).send({ result: false, error: 'FILE_UPLOAD_FAILED' });
    }
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.spFile.createMany({
        data: uploaded.map((u, i) => ({
          refType: REF_DEVELOP_REQUEST,
          refId: r.id,
          uploadFileName: u.uploadFileName,
          originFileName: u.originFileName,
          pathToken: u.pathToken,
          size: BigInt(u.size),
          writeDate: now,
          fileType: 'attachment',
          area: split.accepted[i]?.area ?? null,
          slot: split.accepted[i]?.slot ?? null,
        })),
      });
      await tx.spDevelopRequest.update({ where: { id: r.id }, data: { updatedAt: now } });
      await addDevelopEvent(tx, r.id, {
        type: 'edited',
        actorMbId: request.user.mbId,
        byAdmin: false,
        title: `참고 자료 ${String(uploaded.length)}건을 추가했습니다`,
        payload: { changedFields: ['files'], added: uploaded.length },
      });
    });
    const all = await requestFilesOf(r.id);
    return { result: true as const, data: { files: all.map((f) => toDevelopFileMeta(f)) } };
  });

  // ── DELETE /develop/requests/:id/files/:fileId ──────────────────────────────
  fastify.delete(
    '/develop/requests/:id/files/:fileId',
    { schema: { params: RequestFileParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = found.request;
      if (!isDevelopEditable(asDevelopStatus(r.status))) return reply.status(409).send({ result: false, error: 'NOT_EDITABLE' });
      const file = await prisma.spFile.findFirst({
        where: { id: BigInt(request.params.fileId), refType: REF_DEVELOP_REQUEST, refId: r.id, fileType: 'attachment' },
      });
      if (file === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      try {
        await deleteMarketFile(file);
      } catch (err) {
        request.log.error({ err, fileId: Number(file.id) }, 'develop request file delete failed');
        return reply.status(502).send({ result: false, error: 'FILE_DELETE_FAILED' });
      }
      await addDevelopEvent(prisma, r.id, {
        type: 'edited',
        actorMbId: request.user.mbId,
        byAdmin: false,
        title: '참고 자료 1건을 삭제했습니다',
        payload: { changedFields: ['files'], removed: 1 },
      });
      const all = await requestFilesOf(r.id);
      return { result: true as const, data: { files: all.map((f) => toDevelopFileMeta(f)) } };
    },
  );

  // 파일 접근 — 의뢰 첨부(참고 자료·슬롯) 또는 이벤트 파일(산출물·확인 요청·문의). 이벤트 파일은
  // 비공개 이벤트·잔금 전 잠금 게이트를 탄다. 다운로드와 미리보기가 **같은 함수**를 쓴다(마켓 §5.1 교훈).
  const accessibleFile = async (
    params: { id: string; fileId: string },
    mbId: string,
  ): Promise<{ ok: true; file: SpFile } | { ok: false; status: 403 | 404; error: string }> => {
    const found = await loadOwned(params.id, mbId);
    if (!found.ok) return found;
    const fileId = BigInt(params.fileId);
    const file = await prisma.spFile.findUnique({ where: { id: fileId } });
    if (file === null) return { ok: false, status: 404, error: 'NOT_FOUND' };
    if (file.refType === REF_DEVELOP_REQUEST && file.refId === found.request.id) return { ok: true, file };
    if (file.refType === REF_DEVELOP_QUOTE) {
      const quote = await prisma.spDevelopQuote.findFirst({ where: { id: file.refId, requestId: found.request.id }, select: { id: true } });
      return quote === null ? { ok: false, status: 404, error: 'NOT_FOUND' } : { ok: true, file };
    }
    if (file.refType === REF_DEVELOP_EVENT) {
      const gate = await developEventFileGate(found.request.id, file, false);
      return gate.ok ? { ok: true, file } : { ok: false, status: gate.status, error: gate.error };
    }
    return { ok: false, status: 404, error: 'NOT_FOUND' };
  };

  // ── GET /develop/requests/:id/files/:fileId — 다운로드 ─────────────────────
  fastify.get(
    '/develop/requests/:id/files/:fileId',
    { schema: { params: RequestFileParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await accessibleFile(request.params, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const downloaded = await downloadFromFileServer(found.file.pathToken);
      if (downloaded === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      return reply
        .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(found.file.originFileName)}`)
        .type(resolveFileMime(found.file.originFileName, downloaded.contentType))
        .send(downloaded.buffer);
    },
  );

  // ── GET /develop/requests/:id/files/:fileId/preview — 구조화 미리보기 ─────────
  fastify.get(
    '/develop/requests/:id/files/:fileId/preview',
    { schema: { params: RequestFileParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await accessibleFile(request.params, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const name = found.file.originFileName;
      if (!needsServerPreview(fileViewKind(name))) {
        return {
          result: true as const,
          data: {
            fileId: Number(found.file.id),
            name,
            size: Number(found.file.size),
            kind: 'unsupported' as const,
            reason: 'FORMAT' as const,
            sheets: null,
            text: null,
            entries: null,
            truncated: false,
            note: '',
          },
        };
      }
      const downloaded = await downloadFromFileServer(found.file.pathToken);
      if (downloaded === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      return { result: true as const, data: await buildFilePreview(Number(found.file.id), name, downloaded.buffer) };
    },
  );

  // ── POST /develop/requests/:id/cancel — 고객 취소(착수 전) ────────────────────
  fastify.post(
    '/develop/requests/:id/cancel',
    { schema: { params: RequestIdParams, body: DevelopCancelBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = found.request;
      const status = asDevelopStatus(r.status);
      if (!isDevelopCustomerCancellable(status)) return reply.status(409).send({ result: false, error: 'NOT_CANCELLABLE' });
      const reason = request.body.reason ?? null;
      const ok = await transitionDevelopStatus(
        r.id,
        ['received', 'reviewing', 'quoted', 'accepted'],
        'cancelled',
        { mbId: request.user.mbId, byAdmin: false },
        { cancelledAt: new Date(), cancelReason: reason },
        reason,
      );
      if (!ok) return reply.status(409).send({ result: false, error: 'INVALID_TRANSITION' });
      // 대기 중 마일스톤·잔존 '쇼핑' 카트행을 함께 닫는다(남으면 코어 buy 경로로 취소 건을 결제할 수 있는 구멍).
      await cancelPendingMilestones({ requestId: r.id });
      const settings = await getDevelopSettings();
      void sendDevelopMailToAdmins(
        request.log,
        settings.notifyEmails,
        buildStatusChangedEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas), status: 'cancelled', reason }),
        { kind: 'develop_admin_cancelled', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
      );
      return { result: true as const, data: { requestId: Number(r.id), status: 'cancelled' as const } };
    },
  );

  // ── POST /develop/requests/:id/quotes/:qid/accept — 견적 수락(조건 동의 기록 = 계약 갈음) ───
  // sent ∧ 유효기간 안 → accepted(시각·IP·이름) · 마일스톤 draft→pending · 첫/수정 견적이면 의뢰 quoted→accepted + reviewDays 복사.
  // 추가 견적(change)은 의뢰 상태를 바꾸지 않는다(이미 진행 중).
  fastify.post(
    '/develop/requests/:id/quotes/:qid/accept',
    { schema: { params: RequestQuoteParams, body: DevelopQuoteAcceptBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = await ensureDevelopLazy(found.request, request.log);
      const q = await prisma.spDevelopQuote.findFirst({ where: { id: BigInt(request.params.qid), requestId: r.id } });
      if (q === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      if (q.status === 'expired') return reply.status(409).send({ result: false, error: 'QUOTE_EXPIRED' });
      if (q.status !== 'sent') return reply.status(409).send({ result: false, error: 'QUOTE_NOT_OPEN' });
      const now = new Date();
      const accepted = await prisma.$transaction(async (tx): Promise<boolean> => {
        const upd = await tx.spDevelopQuote.updateMany({
          where: { id: q.id, status: 'sent' },
          data: { status: 'accepted', acceptedAt: now, acceptedName: request.body.name, acceptedIp: request.ip },
        });
        if (upd.count !== 1) return false;
        await tx.spDevelopMilestone.updateMany({ where: { quoteId: q.id, status: 'draft' }, data: { status: 'pending' } });
        await addDevelopEvent(tx, r.id, {
          type: 'quote_accepted',
          actorMbId: request.user.mbId,
          byAdmin: false,
          title: `견적서 v${String(q.version)} 을 수락했습니다`,
          payload: { quoteId: Number(q.id), version: q.version, kind: q.kind, totalAmount: q.totalAmount, acceptedName: request.body.name },
        });
        return true;
      });
      if (!accepted) return reply.status(409).send({ result: false, error: 'QUOTE_NOT_OPEN' });
      if (q.kind !== 'change') {
        await transitionDevelopStatus(r.id, ['quoted'], 'accepted', { mbId: request.user.mbId, byAdmin: false }, { reviewDays: q.reviewDays });
      }
      const settings = await getDevelopSettings();
      void sendDevelopMailToAdmins(
        request.log,
        settings.notifyEmails,
        buildAdminQuoteAcceptedEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas), version: q.version, totalAmount: q.totalAmount, acceptedName: request.body.name }),
        { kind: 'develop_admin_accepted', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
      );
      const fresh = await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: r.id } });
      return { result: true as const, data: await buildDevelopRequestDetail(fresh) };
    },
  );

  // ── POST /develop/requests/:id/quotes/:qid/decline — 견적 거절(사유) ─────────────────
  fastify.post(
    '/develop/requests/:id/quotes/:qid/decline',
    { schema: { params: RequestQuoteParams, body: DevelopQuoteDeclineBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = found.request;
      const q = await prisma.spDevelopQuote.findFirst({ where: { id: BigInt(request.params.qid), requestId: r.id } });
      if (q === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      if (q.status !== 'sent') return reply.status(409).send({ result: false, error: 'QUOTE_NOT_OPEN' });
      const reason = request.body.reason ?? null;
      const declined = await prisma.$transaction(async (tx): Promise<boolean> => {
        const upd = await tx.spDevelopQuote.updateMany({ where: { id: q.id, status: 'sent' }, data: { status: 'declined', declinedAt: new Date(), declineReason: reason } });
        if (upd.count !== 1) return false;
        await addDevelopEvent(tx, r.id, {
          type: 'quote_declined',
          actorMbId: request.user.mbId,
          byAdmin: false,
          title: `견적서 v${String(q.version)} 을 거절했습니다`,
          body: reason,
          payload: { quoteId: Number(q.id), version: q.version },
        });
        return true;
      });
      if (!declined) return reply.status(409).send({ result: false, error: 'QUOTE_NOT_OPEN' });
      await cancelPendingMilestones({ quoteId: q.id });
      const settings = await getDevelopSettings();
      void sendDevelopMailToAdmins(
        request.log,
        settings.notifyEmails,
        buildCommentEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas), forAdmin: true, excerpt: `견적 v${String(q.version)} 거절${reason === null ? '' : ` — ${reason.slice(0, 200)}`}` }),
        { kind: 'develop_admin_declined_quote', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
      );
      const fresh = await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: r.id } });
      return { result: true as const, data: await buildDevelopRequestDetail(fresh) };
    },
  );

  // ── POST /develop/requests/:id/comments — 문의(multipart: payload {body, asRequest} + file[]) ─
  fastify.post('/develop/requests/:id/comments', async (request, reply) => {
    if (!request.isMultipart()) return reply.status(400).send({ result: false, error: 'MULTIPART_REQUIRED' });
    const { files, rawPayload } = await collectMultipart(request);
    try {
      await request.jwtVerify();
    } catch {
      return reply.status(401).send({ result: false, error: 'UNAUTHORIZED' });
    }
    const params = RequestIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ result: false, error: 'BAD_PARAMS' });
    const found = await loadOwned(params.data.id, request.user.mbId);
    if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
    const r = found.request;
    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(rawPayload ?? '');
    } catch {
      return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH' });
    }
    const parsed = DevelopCommentBody.safeParse(payloadJson);
    if (!parsed.success) return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH' });
    const status = asDevelopStatus(r.status);
    if (status === 'cancelled' || status === 'declined') return reply.status(409).send({ result: false, error: 'INVALID_TRANSITION' });
    let uploaded: UploadedFileType[] = [];
    if (files.length > 0) {
      try {
        uploaded = await uploadToFileServer(files.map((f) => ({ buffer: f.buffer, filename: f.filename, mimetype: f.mimetype })), DEVELOP_FILE_SERVICE_TYPE);
      } catch (err) {
        request.log.error({ err }, 'develop comment file upload failed');
        return reply.status(502).send({ result: false, error: 'FILE_UPLOAD_FAILED' });
      }
    }
    const asRequest = parsed.data.asRequest && status === 'completed';
    const now = new Date();
    const event = await prisma.$transaction(async (tx) => {
      const e = await addDevelopEvent(tx, r.id, {
        type: asRequest ? 'as_request' : 'comment',
        actorMbId: request.user.mbId,
        byAdmin: false,
        title: asRequest ? 'A/S 를 요청합니다' : '문의',
        body: parsed.data.body,
      });
      if (uploaded.length > 0) {
        await tx.spFile.createMany({
          data: uploaded.map((u) => ({
            refType: REF_DEVELOP_EVENT,
            refId: e.id,
            uploadFileName: u.uploadFileName,
            originFileName: u.originFileName,
            pathToken: u.pathToken,
            size: BigInt(u.size),
            writeDate: now,
            fileType: 'comment',
          })),
        });
      }
      return e;
    });
    const settings = await getDevelopSettings();
    void sendDevelopMailToAdmins(
      request.log,
      settings.notifyEmails,
      buildCommentEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas), forAdmin: true, excerpt: parsed.data.body.slice(0, 200) }),
      { kind: asRequest ? 'develop_admin_as' : 'develop_admin_comment', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
    );
    const eventFiles = await developEventFiles([event.id]);
    return { result: true as const, data: toDevelopEventView(event, eventFiles.get(event.id.toString()) ?? [], '나', false) };
  });

  // ── POST /develop/requests/:id/milestones/:mid/checkout — 영카트 주입 후 주문서 직행 ─────
  // 마켓 계약 checkout 동형: 앵커 sp-develop-svc · io_id=paymentKey · io_price=amount · ct_qty=1. 재사용/재주입 판정 뒤 선택.
  fastify.post(
    '/develop/requests/:id/milestones/:mid/checkout',
    { schema: { params: RequestMilestoneParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = await ensureDevelopLazy(found.request, request.log);
      const m = await prisma.spDevelopMilestone.findFirst({ where: { id: BigInt(request.params.mid), requestId: r.id } });
      if (m === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      if (m.status === 'paid') return reply.status(409).send({ result: false, error: 'ALREADY_PAID' });
      if (!milestonePayable(m, asDevelopStatus(r.status))) return reply.status(409).send({ result: false, error: 'NOT_PAYABLE' });
      const cartId = request.user.cartId;
      if (cartId === undefined || cartId === '') return reply.status(409).send({ result: false, error: 'NO_CART_ID' });

      let reuseCtId: number | null = null;
      let needInject = true;
      if (m.ctId !== null) {
        const ctId = Number(m.ctId);
        const cartRow = await getCartRowByCtId(ctId);
        if (cartRow === null) {
          needInject = true;
        } else if (cartRow.ctStatus === '쇼핑') {
          if (cartRow.odId === cartId) {
            reuseCtId = ctId;
            needInject = false;
          } else {
            await deleteCartRow(ctId);
            needInject = true;
          }
        } else {
          const info = await getOrderInfoByCtId(ctId);
          if (info === null) needInject = true;
          else if (info.odStatus === '취소' || CANCELLED_ROW_STATUSES.has(info.rowCtStatus)) needInject = true;
          else if (info.odStatus === '주문') return reply.status(409).send({ result: false, error: 'ORDER_PENDING' });
          else return reply.status(409).send({ result: false, error: 'ALREADY_PAID' });
        }
      }

      let ctId = reuseCtId;
      if (needInject) {
        const anchor = await getDevelopAnchorItem();
        if (anchor === null) {
          request.log.error({ itId: DEVELOP_ANCHOR_IT_ID }, '개발의뢰 앵커 상품 없음 — develop:seed-anchor 실행 필요');
          return reply.status(503).send({ result: false, error: 'ANCHOR_ITEM_MISSING' });
        }
        await deleteCartRowsByIoId(m.paymentKey);
        await deleteQuoteOption(anchor.itId, m.paymentKey);
        await insertQuoteOption(anchor.itId, m.paymentKey, m.amount);
        try {
          ctId = await insertCartRow({
            odId: cartId,
            mbId: request.user.mbId,
            item: anchor,
            itemName: `개발의뢰 · ${r.title.slice(0, 60)} · ${m.title}`,
            ioId: m.paymentKey,
            price: m.amount,
            option: `개발의뢰 #${String(Number(r.id))} ${m.title}`,
            ip: request.ip,
          });
        } catch (err) {
          await deleteQuoteOption(anchor.itId, m.paymentKey).catch(() => undefined);
          request.log.error({ err, milestoneId: Number(m.id) }, 'g5_shop_cart INSERT 실패 (개발의뢰 checkout)');
          return reply.status(502).send({ result: false, error: 'CART_INSERT_FAILED' });
        }
        await prisma.spDevelopMilestone.update({ where: { id: m.id }, data: { ctId: BigInt(ctId) } });
      }
      if (ctId === null) return reply.status(500).send({ result: false, error: 'CHECKOUT_FAILED' });
      await selectCartRows(cartId, [ctId]);
      return { result: true as const, data: { redirectUrl: `${WEB_BASE_URL}/shop/orderform.php` } };
    },
  );

  // ── POST /develop/requests/:id/deliveries/:eventId/confirm|changes — 검수 확정 / 수정 요청 ─
  fastify.post(
    '/develop/requests/:id/deliveries/:eventId/:decision',
    { schema: { params: RequestEventParams.extend({ decision: z.enum(['confirm', 'changes']) }), body: DevelopReviewDecisionBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = await ensureDevelopLazy(found.request, request.log);
      if (asDevelopStatus(r.status) !== 'delivered') return reply.status(409).send({ result: false, error: 'INVALID_TRANSITION' });
      const delivery = await prisma.spDevelopEvent.findFirst({ where: { id: BigInt(request.params.eventId), requestId: r.id, type: 'deliverable' } });
      if (delivery === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      const note = request.body.note ?? null;
      const brief = { requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas) };
      if (request.params.decision === 'confirm') {
        const ok = await transitionDevelopStatus(r.id, ['delivered'], 'completed', { mbId: request.user.mbId, byAdmin: false }, { completedAt: new Date() }, note);
        if (!ok) return reply.status(409).send({ result: false, error: 'INVALID_TRANSITION' });
        await addDevelopEvent(prisma, r.id, { type: 'review_approved', actorMbId: request.user.mbId, byAdmin: false, title: '납품을 검수 확정했습니다', body: note, payload: { eventId: Number(delivery.id) } });
        const settings = await getDevelopSettings();
        void sendDevelopMailToAdmins(request.log, settings.notifyEmails, buildCompletedEmail({ ...brief, confirmedBy: 'client', forAdmin: true }), {
          kind: 'develop_admin_completed',
          refType: 'develop_request',
          refId: r.id,
          sentBy: request.user.mbId,
          toMbId: null,
        });
      } else {
        const ok = await transitionDevelopStatus(r.id, ['delivered'], 'in_progress', { mbId: request.user.mbId, byAdmin: false }, {}, note);
        if (!ok) return reply.status(409).send({ result: false, error: 'INVALID_TRANSITION' });
        await addDevelopEvent(prisma, r.id, { type: 'review_changes', actorMbId: request.user.mbId, byAdmin: false, title: '납품에 수정을 요청했습니다', body: note, payload: { eventId: Number(delivery.id) } });
        const settings = await getDevelopSettings();
        void sendDevelopMailToAdmins(request.log, settings.notifyEmails, buildCommentEmail({ ...brief, forAdmin: true, excerpt: `납품 수정 요청${note === null ? '' : ` — ${note.slice(0, 200)}`}` }), {
          kind: 'develop_admin_changes',
          refType: 'develop_request',
          refId: r.id,
          sentBy: request.user.mbId,
          toMbId: null,
        });
      }
      const fresh = await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: r.id } });
      return { result: true as const, data: await buildDevelopRequestDetail(fresh) };
    },
  );

  // ── POST /develop/requests/:id/review-requests/:eventId/approve|changes — 중간 확인 응답 ───
  fastify.post(
    '/develop/requests/:id/review-requests/:eventId/:decision',
    { schema: { params: RequestEventParams.extend({ decision: z.enum(['approve', 'changes']) }), body: DevelopReviewDecisionBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = found.request;
      const target = await prisma.spDevelopEvent.findFirst({ where: { id: BigInt(request.params.eventId), requestId: r.id, type: 'review_request' } });
      if (target === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      const note = request.body.note ?? null;
      const approve = request.params.decision === 'approve';
      const event = await addDevelopEvent(prisma, r.id, {
        type: approve ? 'review_approved' : 'review_changes',
        actorMbId: request.user.mbId,
        byAdmin: false,
        title: approve ? `"${target.title}" 을 확인·승인했습니다` : `"${target.title}" 에 수정을 요청했습니다`,
        body: note,
        payload: { eventId: Number(target.id) },
      });
      const settings = await getDevelopSettings();
      void sendDevelopMailToAdmins(
        request.log,
        settings.notifyEmails,
        buildCommentEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas), forAdmin: true, excerpt: `${event.title}${note === null ? '' : ` — ${note.slice(0, 200)}`}` }),
        { kind: 'develop_admin_review', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
      );
      return { result: true as const, data: toDevelopEventView(event, [], '나', false) };
    },
  );

  done();
};
