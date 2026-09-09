import { addDevelopPrototypeGuard, developPrototypeWhere } from '../lib/develop-prototype';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { SpDevelopDocument, SpDevelopEvent, SpDevelopMilestone, SpDevelopQuote, SpDevelopQuoteItem, SpDevelopRequest, SpFile } from '@prisma/client';
import { kstToday } from '@sp/utils';
import { z } from 'zod';
import {
  DEVELOP_DOC_DECISION_OPTIONS,
  DEVELOP_DOC_TYPE_LABELS,
  DevelopCancelBody,
  DevelopCommentBody,
  DevelopDocumentDecideBody,
  DevelopQuoteAcceptBody,
  DevelopQuoteDeclineBody,
  DevelopRequestCreatePayload,
  DevelopRequestListQuery,
  DevelopRequestUpdateBody,
  DevelopReviewDecisionBody,
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_REGISTRY,
  applyDevelopFollowupAnswers,
  computeDevelopQuoteAmounts,
  developDocDecisionLabel,
  developDocNo,
  developMergedIssues,
  developQuestionsFor,
  developRequiredMissing,
  fileViewKind,
  isDevelopCustomerCancellable,
  isDevelopDocApproval,
  isDevelopEditable,
  keepDevelopDelegateAnswers,
  mergeDevelopFollowupAnswers,
  needsServerPreview,
  normalizeDevelopProduction,
  normalizeDevelopTools,
  resolveDevelopServiceAreas,
  resolveFileMime,
  splitDevelopMilestoneAmounts,
} from '@sp/api-contract/develop-c';
import type {
  DevelopAiQuestionsType,
  DevelopMilestoneViewType,
  DevelopQuoteViewType,
  DevelopRequestDetailType,
  DevelopRequestListItemType,
  DevelopRequestStatusType,
  MarketContractPaymentType,
} from '@sp/api-contract/develop-c';
import {
  DEVELOP_FILE_SERVICE_TYPE,
  REF_DEVELOP_EVENT,
  REF_DEVELOP_QUOTE,
  REF_DEVELOP_REQUEST,
  addDevelopEvent,
  asDevelopBudgetRange,
  asDevelopRequestMode,
  asDevelopStatus,
  asMilestoneStatus,
  asMilestoneTrigger,
  asQuoteKind,
  asQuoteStatus,
  asVatMode,
  developDeliverablesLocked,
  developEventFileGate,
  developEventFiles,
  developWizardFieldsOf,
  toDevelopAiQuestions,
  toDevelopAreaCodes,
  toDevelopContact,
  toDevelopEventView,
  toDevelopFileMeta,
  transitionDevelopStatus,
} from '../lib/develop-c';
import { startDevelopAiDrafts } from '../lib/develop-ai';
import {
  REF_DEVELOP_DOCUMENT,
  asDocType,
  buildDevelopProgress,
  hasPendingDocumentDecision,
  loadDevelopDocuments,
  loadDevelopTasks,
  toDevelopDocumentView,
  toDocContent,
} from '../lib/develop-docs';
import { getAiJob } from '../lib/ai/jobs';
import { DEVELOP_FOLLOWUP_USECASE } from '../lib/ai/usecases';
import {
  buildAdminDocumentDecidedEmail,
  buildAdminNewRequestEmail,
  buildAdminQuoteAcceptedEmail,
  buildCommentEmail,
  buildCompletedEmail,
  buildRequestReceivedEmail,
  buildStatusChangedEmail,
  sendDevelopMail,
  sendDevelopMailToAdmins,
} from '../lib/develop-c-email';
import { cancelPendingMilestones, deriveMilestonePayment, ensureDevelopLazy } from '../lib/develop-payment';
import { getDevelopSettings } from '../lib/develop-c-settings';
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
  collectMultipart,
  deleteMarketFile,
  splitMarketAttachments,
  toAnswers,
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
const RequestDocParams = z.object({ id: z.string().regex(/^\d+$/), docId: z.string().regex(/^\d+$/) });

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
  documents: readonly SpDevelopDocument[] = [],
): DevelopRequestListItemType['nextAction'] => {
  if (quotes.some((q) => q.status === 'sent')) return 'review_quote';
  if (milestones.some((m) => milestonePayable(m, status))) return 'pay';
  if (status === 'delivered') return 'inspect';
  // 승인형 프로젝트 문서(§13)가 고객 확인 대기면 그것이 할 일.
  if (hasPendingDocumentDecision(documents)) return 'answer_document';
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
  documents: readonly SpDevelopDocument[] = [],
): DevelopRequestListItemType => {
  const status = asDevelopStatus(r.status);
  return {
    requestId: Number(r.id),
    title: r.title,
    requestMode: asDevelopRequestMode(r.requestMode),
    serviceAreas: toDevelopAreaCodes(r.serviceAreas),
    status,
    budgetRange: asDevelopBudgetRange(r.budgetRange),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    nextAction: nextActionOf(status, quotes, milestones, events, documents),
    reviewPublished: r.devReviewPublic !== null,
    diagramPublished: r.devDiagramPublicHtml !== null,
  };
};

// 상세 — 소유자용. 공개본만·visibleToCustomer 이벤트만·draft 견적 제외.
export async function buildDevelopRequestDetail(r: SpDevelopRequest): Promise<DevelopRequestDetailType> {
  const status = asDevelopStatus(r.status);
  const [files, quotes, events, locked, documents, tasks] = await Promise.all([
    requestFilesOf(r.id),
    prisma.spDevelopQuote.findMany({
      where: { requestId: r.id, status: { not: 'draft' } },
      include: { items: true, milestones: true },
      orderBy: { version: 'asc' },
    }),
    prisma.spDevelopEvent.findMany({ where: { requestId: r.id, visibleToCustomer: true }, orderBy: { id: 'asc' } }),
    developDeliverablesLocked(r.id),
    loadDevelopDocuments(r.id, { includeDrafts: false }),
    loadDevelopTasks(r.id),
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
    ...toListItem(r, quotes, milestones, events, documents.rows),
    ...developWizardFieldsOf(r),
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
    // 프로젝트 문서(§13) — 보낸 판만(draft 는 어떤 응답에도 없다). 진행 현황은 공개 업무 행만.
    documents: documents.rows.map((d) => toDevelopDocumentView(d, documents.files.get(d.id.toString()) ?? [], documents.current.has(d.id.toString()))),
    progress: buildDevelopProgress(r, tasks, documents.rows, true),
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
  addDevelopPrototypeGuard(fastify, 'c');
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
  fastify.post('/develop-c/requests', async (request, reply) => {
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
    // 저장 분야 — 시스템개발은 전 분야, 개별 견적은 고른 것(계약 superRefine 이 개별 메뉴 밖 코드를 이미 막았다).
    const serviceAreas = resolveDevelopServiceAreas(payload.requestMode, payload.serviceAreas);
    const split = splitMarketAttachments(files, serviceAreas, DEVELOP_REGISTRY);
    if (split.invalid.length > 0) return reply.status(400).send({ result: false, error: 'ATTACHMENT_FIELD_INVALID' });
    const attachments = split.accepted;
    // 필수 문항(레지스트리 required) 미응답 — 위저드 "다음" 게이트와 같은 함수(지금 개발의뢰 문항엔 필수가 없다).
    const requiredMissing = developRequiredMissing(payload.answers, serviceAreas);
    if (requiredMissing.length > 0) {
      return reply.status(400).send({ result: false, error: 'ANSWERS_REQUIRED', missing: requiredMissing });
    }
    // 시스템개발 "전문가에게 맡김"은 기술 문항을 건너뛴다 — 역할·협업 문항(askOnDelegate)만 남기고 나머지는 버린다(화면 상태 잔재).
    const expertDelegate = payload.requestMode === 'system' && payload.expertDelegate;
    const answers = expertDelegate ? keepDevelopDelegateAnswers(payload.answers) : payload.answers;
    // AI 후속 질문(§7.2.2) — 잡에서 질문을 되읽어(클라이언트가 문항을 지어내지 못한다) 답만 합친다. 본인 잡·완료 잡만.
    let aiQuestions: DevelopAiQuestionsType | null = null;
    if (payload.requestMode === 'system' && !expertDelegate && payload.aiQuestions !== null) {
      const job = await getAiJob(payload.aiQuestions.jobId);
      if (job?.mbId !== mbId || job.useCase !== DEVELOP_FOLLOWUP_USECASE || job.status !== 'done' || job.followup === null) {
        return reply.status(400).send({ result: false, error: 'FOLLOWUP_JOB_INVALID' });
      }
      aiQuestions = mergeDevelopFollowupAnswers(job.followup, payload.aiQuestions.answers);
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
          prototype: { create: { variant: 'c' } },
          title: payload.title,
          requestMode: payload.requestMode,
          serviceAreas,
          tools: normalizeDevelopTools(payload.tools, serviceAreas),
          description: payload.description,
          answers: answers.length > 0 ? answers : Prisma.DbNull,
          currentStage: payload.currentStage,
          targetStage: payload.targetStage,
          wishDate: payload.wishDate,
          wishNote: payload.wishNote === '' ? null : payload.wishNote,
          expertDelegate,
          production: normalizeDevelopProduction(payload.production),
          aiQuestions: aiQuestions ?? Prisma.DbNull,
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
    const brief = { requestId: Number(created.id), title: created.title, serviceAreas };
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
        budgetLabel: DEVELOP_BUDGET_RANGE_LABELS[asDevelopBudgetRange(created.budgetRange)],
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
    '/develop-c/my/requests',
    { schema: { querystring: DevelopRequestListQuery }, preHandler: fastify.authenticate },
    async (request) => {
      const { page, pageSize } = request.query;
      const where = { mbId: request.user.mbId, ...developPrototypeWhere('c') };
      const [rows, total] = await Promise.all([
        prisma.spDevelopRequest.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.spDevelopRequest.count({ where }),
      ]);
      const ids = rows.map((r) => r.id);
      const [quotes, milestones, events, documents] = await Promise.all([
        prisma.spDevelopQuote.findMany({ where: { requestId: { in: ids }, status: { not: 'draft' } } }),
        prisma.spDevelopMilestone.findMany({ where: { requestId: { in: ids } } }),
        prisma.spDevelopEvent.findMany({
          where: { requestId: { in: ids }, type: { in: ['review_request', 'review_approved', 'review_changes'] } },
          orderBy: { id: 'asc' },
        }),
        prisma.spDevelopDocument.findMany({ where: { requestId: { in: ids }, status: 'sent' } }),
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
      const dm = byReq(documents);
      return {
        result: true as const,
        data: {
          items: rows.map((r) => {
            const k = r.id.toString();
            return toListItem(r, qm.get(k) ?? [], mm.get(k) ?? [], em.get(k) ?? [], dm.get(k) ?? []);
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
    '/develop-c/requests/:id',
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
    '/develop-c/requests/:id',
    { schema: { params: RequestIdParams, body: DevelopRequestUpdateBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = found.request;
      if (!isDevelopEditable(asDevelopStatus(r.status))) return reply.status(409).send({ result: false, error: 'NOT_EDITABLE' });
      const b = request.body;
      // 부분 본문을 저장분과 합친 뒤 등록과 같은 교차 검증(분야·답변·툴·희망 시기)을 한다.
      const mode = b.requestMode ?? asDevelopRequestMode(r.requestMode);
      const pickedAreas = b.serviceAreas ?? toDevelopAreaCodes(r.serviceAreas);
      const areas = resolveDevelopServiceAreas(mode, pickedAreas);
      const areasChanged = b.requestMode !== undefined || b.serviceAreas !== undefined;
      const expertDelegate = mode === 'system' && (b.expertDelegate ?? r.expertDelegate);
      // 답변을 안 보냈는데 분야가 바뀌면 저장분에서 새 분야 밖 문항을 걷어낸다(맡김이면 역할·협업 문항만 남긴다).
      const allowed = new Set(developQuestionsFor(areas).map((q) => q.code));
      const merged = b.answers ?? toAnswers(r.answers).filter((a) => allowed.has(a.code));
      const answers = expertDelegate ? keepDevelopDelegateAnswers(merged) : merged;
      const tools = b.tools ?? toTools(r.tools);
      const wishDate = b.wishDate !== undefined ? b.wishDate : r.wishDate;
      const wishNote = b.wishNote !== undefined ? (b.wishNote === '' ? null : b.wishNote) : r.wishNote;
      const issues = developMergedIssues({ requestMode: mode, serviceAreas: pickedAreas, answers, tools, wishDate, wishNote });
      if (issues.length > 0) return reply.status(400).send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH', issues });
      const missing = developRequiredMissing(answers, areas);
      if (missing.length > 0) return reply.status(400).send({ result: false, error: 'ANSWERS_REQUIRED', missing });
      const data: Prisma.SpDevelopRequestUpdateInput = {};
      const changed: string[] = [];
      if (b.title !== undefined && b.title !== r.title) { data.title = b.title; changed.push('title'); }
      if (areasChanged) { data.requestMode = mode; data.serviceAreas = areas; changed.push('serviceAreas'); }
      if (b.tools !== undefined || areasChanged) { data.tools = normalizeDevelopTools(tools, areas); if (b.tools !== undefined) changed.push('tools'); }
      if (b.description !== undefined && b.description !== r.description) { data.description = b.description; changed.push('description'); }
      if (b.answers !== undefined || areasChanged || (b.expertDelegate !== undefined && b.expertDelegate !== r.expertDelegate)) {
        data.answers = answers.length > 0 ? answers : Prisma.DbNull;
        if (b.answers !== undefined) changed.push('answers');
      }
      if (b.currentStage !== undefined && b.currentStage !== r.currentStage) { data.currentStage = b.currentStage; changed.push('currentStage'); }
      if (b.targetStage !== undefined && b.targetStage !== r.targetStage) { data.targetStage = b.targetStage; changed.push('targetStage'); }
      if ((b.wishDate !== undefined || b.wishNote !== undefined) && (wishDate !== r.wishDate || wishNote !== r.wishNote)) {
        data.wishDate = wishDate;
        data.wishNote = wishNote;
        changed.push('wish');
      }
      if (b.expertDelegate !== undefined && expertDelegate !== r.expertDelegate) { data.expertDelegate = expertDelegate; changed.push('expertDelegate'); }
      if (b.production !== undefined) { data.production = normalizeDevelopProduction(b.production); changed.push('production'); }
      // AI 후속 질문 답(§7.2.2) — 질문은 불변, 답만 갱신. 맡김으로 바꾸거나 개별 견적으로 바꾸면 통째로 비운다.
      if (b.aiQuestions !== undefined) {
        const stored = toDevelopAiQuestions(r.aiQuestions);
        if (stored === null) return reply.status(409).send({ result: false, error: 'NO_AI_QUESTIONS' });
        data.aiQuestions = applyDevelopFollowupAnswers(stored, b.aiQuestions.answers);
        changed.push('aiQuestions');
      }
      if ((expertDelegate || mode !== 'system') && r.aiQuestions !== null) { data.aiQuestions = Prisma.DbNull; }
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
  fastify.post('/develop-c/requests/:id/files', async (request, reply) => {
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
    const split = splitMarketAttachments(files, toDevelopAreaCodes(r.serviceAreas), DEVELOP_REGISTRY);
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
    '/develop-c/requests/:id/files/:fileId',
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
    // 프로젝트 문서 첨부(§13) — 보낸 판의 첨부만(draft 첨부는 고객에게 없다).
    if (file.refType === REF_DEVELOP_DOCUMENT) {
      const doc = await prisma.spDevelopDocument.findFirst({ where: { id: file.refId, requestId: found.request.id }, select: { status: true } });
      return doc === null || doc.status === 'draft' ? { ok: false, status: 404, error: 'NOT_FOUND' } : { ok: true, file };
    }
    return { ok: false, status: 404, error: 'NOT_FOUND' };
  };

  // ── GET /develop/requests/:id/files/:fileId — 다운로드 ─────────────────────
  fastify.get(
    '/develop-c/requests/:id/files/:fileId',
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
    '/develop-c/requests/:id/files/:fileId/preview',
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
    '/develop-c/requests/:id/cancel',
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
        buildStatusChangedEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toDevelopAreaCodes(r.serviceAreas), status: 'cancelled', reason }),
        { kind: 'develop_admin_cancelled', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
      );
      return { result: true as const, data: { requestId: Number(r.id), status: 'cancelled' as const } };
    },
  );

  // ── POST /develop/requests/:id/quotes/:qid/accept — 견적 수락(조건 동의 기록 = 계약 갈음) ───
  // sent ∧ 유효기간 안 → accepted(시각·IP·이름) · 마일스톤 draft→pending · 첫/수정 견적이면 의뢰 quoted→accepted + reviewDays 복사.
  // 추가 견적(change)은 의뢰 상태를 바꾸지 않는다(이미 진행 중).
  fastify.post(
    '/develop-c/requests/:id/quotes/:qid/accept',
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
        buildAdminQuoteAcceptedEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toDevelopAreaCodes(r.serviceAreas), version: q.version, totalAmount: q.totalAmount, acceptedName: request.body.name }),
        { kind: 'develop_admin_accepted', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
      );
      const fresh = await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: r.id } });
      return { result: true as const, data: await buildDevelopRequestDetail(fresh) };
    },
  );

  // ── POST /develop/requests/:id/quotes/:qid/decline — 견적 거절(사유) ─────────────────
  fastify.post(
    '/develop-c/requests/:id/quotes/:qid/decline',
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
        buildCommentEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toDevelopAreaCodes(r.serviceAreas), forAdmin: true, excerpt: `견적 v${String(q.version)} 거절${reason === null ? '' : ` — ${reason.slice(0, 200)}`}` }),
        { kind: 'develop_admin_declined_quote', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
      );
      const fresh = await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: r.id } });
      return { result: true as const, data: await buildDevelopRequestDetail(fresh) };
    },
  );

  // ── POST /develop/requests/:id/comments — 문의(multipart: payload {body, asRequest} + file[]) ─
  fastify.post('/develop-c/requests/:id/comments', async (request, reply) => {
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
      buildCommentEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toDevelopAreaCodes(r.serviceAreas), forAdmin: true, excerpt: parsed.data.body.slice(0, 200) }),
      { kind: asRequest ? 'develop_admin_as' : 'develop_admin_comment', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
    );
    const eventFiles = await developEventFiles([event.id]);
    return { result: true as const, data: toDevelopEventView(event, eventFiles.get(event.id.toString()) ?? [], '나', false) };
  });

  // ── POST /develop/requests/:id/milestones/:mid/checkout — 영카트 주입 후 주문서 직행 ─────
  // 마켓 계약 checkout 동형: 앵커 sp-develop-svc · io_id=paymentKey · io_price=amount · ct_qty=1. 재사용/재주입 판정 뒤 선택.
  fastify.post(
    '/develop-c/requests/:id/milestones/:mid/checkout',
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
    '/develop-c/requests/:id/deliveries/:eventId/:decision',
    { schema: { params: RequestEventParams.extend({ decision: z.enum(['confirm', 'changes']) }), body: DevelopReviewDecisionBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = await ensureDevelopLazy(found.request, request.log);
      if (asDevelopStatus(r.status) !== 'delivered') return reply.status(409).send({ result: false, error: 'INVALID_TRANSITION' });
      const delivery = await prisma.spDevelopEvent.findFirst({ where: { id: BigInt(request.params.eventId), requestId: r.id, type: 'deliverable' } });
      if (delivery === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      const note = request.body.note ?? null;
      const brief = { requestId: Number(r.id), title: r.title, serviceAreas: toDevelopAreaCodes(r.serviceAreas) };
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
    '/develop-c/requests/:id/review-requests/:eventId/:decision',
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
        buildCommentEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toDevelopAreaCodes(r.serviceAreas), forAdmin: true, excerpt: `${event.title}${note === null ? '' : ` — ${note.slice(0, 200)}`}` }),
        { kind: 'develop_admin_review', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
      );
      return { result: true as const, data: toDevelopEventView(event, [], '나', false) };
    },
  );

  // ── POST /develop/requests/:id/documents/:docId/decide — 프로젝트 문서 결정(§13, 승인형·sent 만) ─────
  // 결정 = 동의 기록(시각·IP·이름). 납품확인서는 delivered 에서 승인=검수 확정(completed)·보완=재작업(in_progress),
  // 변경요청서 승인은 change 견적 초안을 자동으로 깐다(금액은 관리자가 채운다). 그 밖은 이벤트·관리자 메일뿐.
  fastify.post(
    '/develop-c/requests/:id/documents/:docId/decide',
    { schema: { params: RequestDocParams, body: DevelopDocumentDecideBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const found = await loadOwned(request.params.id, request.user.mbId);
      if (!found.ok) return reply.status(found.status).send({ result: false, error: found.error });
      const r = await ensureDevelopLazy(found.request, request.log);
      const doc = await prisma.spDevelopDocument.findFirst({ where: { id: BigInt(request.params.docId), requestId: r.id } });
      if (doc === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
      const type = asDocType(doc.type);
      if (!isDevelopDocApproval(type)) return reply.status(409).send({ result: false, error: 'NOT_APPROVAL_DOC' });
      if (doc.status !== 'sent') return reply.status(409).send({ result: false, error: 'DOC_NOT_OPEN' });
      const { decision, name } = request.body;
      if (!DEVELOP_DOC_DECISION_OPTIONS[type].some((o) => o.code === decision)) return reply.status(400).send({ result: false, error: 'DECISION_INVALID' });
      const note = request.body.note === undefined || request.body.note === '' ? null : request.body.note;
      const now = new Date();
      const updated = await prisma.spDevelopDocument.updateMany({
        where: { id: doc.id, status: 'sent' },
        data: { status: decision, decision, decisionNote: note, decidedAt: now, decidedName: name, decidedIp: request.ip },
      });
      if (updated.count !== 1) return reply.status(409).send({ result: false, error: 'DOC_NOT_OPEN' });
      const docNo = developDocNo(type, doc.seq);
      const decisionLabel = developDocDecisionLabel(type, decision);
      await addDevelopEvent(prisma, r.id, {
        type: 'document_decided',
        actorMbId: request.user.mbId,
        byAdmin: false,
        title: `${docNo} ${DEVELOP_DOC_TYPE_LABELS[type]} — ${decisionLabel}`,
        body: note,
        payload: { documentId: Number(doc.id), docNo, type, decision, decidedName: name },
      });
      const brief = { requestId: Number(r.id), title: r.title, serviceAreas: toDevelopAreaCodes(r.serviceAreas) };
      const settings = await getDevelopSettings();
      const status = asDevelopStatus(r.status);
      if (type === 'delivery_confirm' && status === 'delivered') {
        if (decision === 'approved') {
          const ok = await transitionDevelopStatus(r.id, ['delivered'], 'completed', { mbId: request.user.mbId, byAdmin: false }, { completedAt: now }, note);
          if (ok) {
            void sendDevelopMailToAdmins(request.log, settings.notifyEmails, buildCompletedEmail({ ...brief, confirmedBy: 'client', forAdmin: true }), {
              kind: 'develop_admin_completed',
              refType: 'develop_request',
              refId: r.id,
              sentBy: request.user.mbId,
              toMbId: null,
            });
          }
        } else if (decision === 'changes_requested') {
          await transitionDevelopStatus(r.id, ['delivered'], 'in_progress', { mbId: request.user.mbId, byAdmin: false }, {}, note);
        }
      }
      if (type === 'change_request' && decision === 'approved') {
        try {
          await createChangeQuoteDraft(r, doc, docNo);
        } catch (err) {
          request.log.error({ err, documentId: Number(doc.id) }, 'change quote draft auto-create failed');
        }
      }
      void sendDevelopMailToAdmins(
        request.log,
        settings.notifyEmails,
        buildAdminDocumentDecidedEmail({ ...brief, docNo, docLabel: DEVELOP_DOC_TYPE_LABELS[type], decisionLabel, decidedName: name, note }),
        { kind: 'develop_admin_document', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: null },
      );
      const fresh = await prisma.spDevelopRequest.findUniqueOrThrow({ where: { id: r.id } });
      return { result: true as const, data: await buildDevelopRequestDetail(fresh) };
    },
  );

  done();
};

// 변경요청서 승인 → change 견적 초안(사용자 결정 8, docs/DEVELOP_FLOW.md §13). 항목 한 줄·금액 0·기본 마일스톤으로 깔고
// 관리자가 편집기에서 채운 뒤 발송한다. 착수 뒤(accepted·in_progress·delivered)에만 — 견적 라우트의 KIND_MISMATCH 규칙과 같다.
async function createChangeQuoteDraft(r: SpDevelopRequest, doc: SpDevelopDocument, docNo: string): Promise<void> {
  const status = asDevelopStatus(r.status);
  if (status !== 'accepted' && status !== 'in_progress' && status !== 'delivered') return;
  const settings = await getDevelopSettings();
  const content = toDocContent(doc.content);
  const change = typeof content.change === 'string' ? content.change.trim().replace(/\s+/g, ' ') : '';
  const last = await prisma.spDevelopQuote.findFirst({ where: { requestId: r.id }, orderBy: { version: 'desc' }, select: { version: true } });
  const validUntil = kstToday(new Date(Date.now() + settings.defaultValidDays * 86_400_000));
  const amounts = computeDevelopQuoteAmounts([0], settings.defaultVatMode);
  const split = splitDevelopMilestoneAmounts(amounts.totalAmount, settings.defaultMilestones.map((m) => m.ratioBp));
  await prisma.$transaction(async (tx) => {
    const q = await tx.spDevelopQuote.create({
      data: {
        requestId: r.id,
        version: (last?.version ?? 0) + 1,
        kind: 'change',
        title: `추가 견적 — ${docNo} 변경요청`,
        vatMode: settings.defaultVatMode,
        supplyAmount: amounts.supplyAmount,
        vatAmount: amounts.vatAmount,
        totalAmount: amounts.totalAmount,
        deliverables: [],
        exclusions: settings.defaultExclusions,
        terms: settings.defaultTerms,
        warrantyDays: settings.defaultWarrantyDays,
        reviewDays: settings.defaultReviewDays,
        validUntil,
        internalNote: `변경요청서 ${docNo} 승인으로 자동 생성된 초안 — 항목·금액을 채운 뒤 발송`,
        createdBy: r.assigneeMbId ?? 'system',
      },
    });
    await tx.spDevelopQuoteItem.create({
      data: { quoteId: q.id, seq: 1, title: change === '' ? '변경 작업' : `변경 작업 — ${change.slice(0, 120)}`, description: null, amount: 0, durationDays: null },
    });
    await tx.spDevelopMilestone.createMany({
      data: settings.defaultMilestones.map((m, i) => ({
        quoteId: q.id,
        requestId: r.id,
        seq: i + 1,
        title: m.title,
        ratioBp: m.ratioBp,
        amount: split[i] ?? 0,
        trigger: m.trigger,
        status: 'draft',
        paymentKey: randomUUID(),
        unlocksDeliverables: false,
      })),
    });
  });
}
