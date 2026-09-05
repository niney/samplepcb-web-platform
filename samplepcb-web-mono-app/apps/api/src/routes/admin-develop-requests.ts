import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import type { SpDevelopRequest, SpFile } from '@prisma/client';
import { z } from 'zod';
import {
  AdminDevelopAiRunResponse,
  AdminDevelopEventPayload,
  AdminDevelopRequestListQuery,
  AdminDevelopRequestDetailResponse,
  AdminDevelopRequestPatchBody,
  AdminDevelopReviewPutBody,
  AdminDevelopReviewVersionListResponse,
  AdminDevelopReviewVersionResponse,
  AdminDevelopStatusBody,
  ApiError,
  DEVELOP_REQUEST_STATUSES,
  DevelopRequestStatusResponse,
  fileViewKind,
  isDevelopClosed,
  needsServerPreview,
  resolveFileMime,
} from '@sp/api-contract';
import type {
  AdminDevelopAiSummaryType,
  AdminDevelopRequestCountsType,
  AdminDevelopRequestDetailType,
  AdminDevelopRequestListItemType,
  DevelopAdminTabType,
  DevelopRequestStatusType,
  MarketDevReviewType,
} from '@sp/api-contract';
import { sanitizeDevDiagramHtml } from '../lib/ai/dev-diagram';
import { getAiJob } from '../lib/ai/jobs';
import {
  DEVELOP_FILE_SERVICE_TYPE,
  REF_DEVELOP_EVENT,
  REF_DEVELOP_QUOTE,
  REF_DEVELOP_REQUEST,
  addDevelopEvent,
  asDevelopStatus,
  developEventFiles,
  toDevelopContact,
  toDevelopEventView,
  toDevelopFileMeta,
  transitionDevelopStatus,
} from '../lib/develop';
import { developReviewDraftRunning, startDevelopAiDrafts } from '../lib/develop-ai';
import { developReferenceFiles, developSourceSignature } from '../lib/develop-ai-source';
import { buildCompletedEmail, buildDeliveredEmail, buildStatusChangedEmail, sendDevelopMail } from '../lib/develop-email';
import { cancelPendingMilestones, ensureDevelopLazy } from '../lib/develop-payment';
import { buildFilePreview } from '../lib/file-preview';
import {
  currentDevelopReviewSeqs,
  recordDevelopReviewVersion,
  toDevelopReviewVersionMeta,
} from '../lib/develop-review-versions';
import { downloadFromFileServer, uploadToFileServer } from '../lib/file-server';
import { getMembersByIds } from '../lib/g5-db';
import type { G5Member } from '../lib/g5-db';
import { asBudgetRange, collectMultipart, toAnswers, toAreaCodes, toDevDiagram, toDevReview, toTools } from '../lib/market';
import { prisma } from '../lib/prisma';
import { buildDevelopRequestDetail, customerEmailOf, toQuoteView } from './develop-requests';

// ── /api/admin/develop/requests — 개발의뢰 관리자(docs/DEVELOP_FLOW.md §7.3·§8) ────────────
// 전 라우트 requireAdmin. 워크큐(탭·검색·counts) · 전면 상세 · 상태 전이 · AI 초안(재생성·편집·공개) · 구성도(재생성·교체·공개) ·
// 타임라인 이벤트(메모·문의·확인 요청·산출물·세금계산서) · 파일. 견적·마일스톤은 admin-develop-quotes.ts(P2).
// 에러 봉투 ApiError{error,message}(관리자 라우트 관례).

const RequestIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const FileIdParams = z.object({ fileId: z.string().regex(/^\d+$/) });

const TAB_STATUSES: Record<DevelopAdminTabType, readonly DevelopRequestStatusType[]> = {
  all: DEVELOP_REQUEST_STATUSES,
  received: ['received'],
  reviewing: ['reviewing'],
  quoted: ['quoted'],
  accepted: ['accepted'],
  in_progress: ['in_progress'],
  delivered: ['delivered'],
  completed: ['completed'],
  closed: ['cancelled', 'declined'],
};

const toOwner = (mbId: string, m: G5Member | undefined): AdminDevelopRequestListItemType['owner'] => ({
  mbId,
  name: m?.name ?? '',
  email: m === undefined || m.email === '' ? null : m.email,
});

// AI 요약 — 목록·상세 공용. review 상태: running(초안 잡 진행) > published > ready(초안 또는 작업본 있음) > error > none.
const aiSummaryOf = async (r: SpDevelopRequest, files: readonly Pick<SpFile, 'id' | 'size'>[]): Promise<AdminDevelopAiSummaryType> => {
  let review: AdminDevelopAiSummaryType['review'] = 'none';
  let draftError: string | null = null;
  if (r.devReviewDraftJobId !== null) {
    const job = await getAiJob(r.devReviewDraftJobId);
    if (job?.status === 'running') review = 'running';
    else if (job?.status === 'error') draftError = job.error;
  }
  if (review !== 'running') {
    if (r.devReviewPublic !== null) review = 'published';
    else if (r.devReview !== null || r.devReviewDraft !== null) review = 'ready';
    else if (draftError !== null) review = 'error';
  }
  const signature = developSourceSignature(r, files);
  return {
    review,
    reviewStale: r.devReviewInputHash !== null && r.devReviewInputHash !== signature,
    diagram: toDevDiagram(r.devDiagram)?.status ?? null,
    diagramPublished: r.devDiagramPublicHtml !== null,
  };
};

const toItem = async (
  r: SpDevelopRequest,
  owner: AdminDevelopRequestListItemType['owner'],
  files: readonly Pick<SpFile, 'id' | 'size'>[],
  quotes: readonly { id: bigint; version: number; kind: string; status: string; totalAmount: number }[],
): Promise<AdminDevelopRequestListItemType> => {
  const latest = quotes.slice().sort((a, b) => b.version - a.version)[0];
  return {
    requestId: Number(r.id),
    title: r.title,
    serviceAreas: toAreaCodes(r.serviceAreas),
    status: asDevelopStatus(r.status),
    budgetRange: asBudgetRange(r.budgetRange),
    owner,
    contact: toDevelopContact(r),
    assigneeMbId: r.assigneeMbId,
    aiConsent: r.aiConsent,
    ai: await aiSummaryOf(r, files),
    quoteCount: quotes.length,
    latestQuote:
      latest === undefined
        ? null
        : {
            quoteId: Number(latest.id),
            version: latest.version,
            kind: latest.kind === 'revision' || latest.kind === 'change' ? latest.kind : 'initial',
            status: (['draft', 'sent', 'accepted', 'declined', 'expired', 'superseded', 'withdrawn'] as const).includes(
              latest.status as 'draft',
            )
              ? (latest.status as 'draft')
              : 'draft',
            totalAmount: latest.totalAmount,
          },
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
};

// 업로드 구성도 → sandbox iframe 용 완전한 HTML. 이미지(png·jpg·svg)는 우리가 문서를 만들고 페이로드만 data URI 로 싣는다.
// html 업로드는 LLM 산출물과 같은 살균기를 탄다(script·이벤트·외부 URL 제거 + CSP).
const wrapUploadedDiagram = (mimetype: string, filename: string, buffer: Buffer): { html: string; ok: boolean } => {
  const lower = filename.toLowerCase();
  const css = 'html,body{margin:0;background:#fff}img,svg{max-width:100%;height:auto;display:block;margin:0 auto}';
  if (lower.endsWith('.svg') || mimetype === 'image/svg+xml') {
    const inner = buffer.toString('utf8');
    const { html } = sanitizeDevDiagramHtml(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${inner}</body></html>`);
    return { html, ok: /<svg[\s>]/i.test(html) };
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm') || mimetype === 'text/html') {
    const { html } = sanitizeDevDiagramHtml(buffer.toString('utf8'));
    return { html, ok: html.trim() !== '' };
  }
  const mime = mimetype === 'image/png' || mimetype === 'image/jpeg' || mimetype === 'image/webp' ? mimetype : lower.endsWith('.png') ? 'image/png' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'image/jpeg' : lower.endsWith('.webp') ? 'image/webp' : null;
  if (mime === null) return { html: '', ok: false };
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:;">';
  return {
    html: `<!doctype html><html><head><meta charset="utf-8">${csp}<style>${css}</style></head><body><img alt="시스템 구성도" src="data:${mime};base64,${buffer.toString('base64')}"></body></html>`,
    ok: true,
  };
};

export const adminDevelopRequestRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  const load = async (id: string): Promise<SpDevelopRequest | null> =>
    prisma.spDevelopRequest.findUnique({ where: { id: BigInt(id) } });

  const notFound = { error: 'NOT_FOUND', message: '의뢰가 없습니다' };

  // 상세 — 고객 상세(공개본·visible 이벤트) 위에 관리자 전용 층(3층 검토서·현재본 구성도·내부 메모·전 이벤트·전 견적)을 얹는다.
  const buildAdminDetail = async (r: SpDevelopRequest): Promise<AdminDevelopRequestDetailType> => {
    const [customerDetail, members, files, quotes, events] = await Promise.all([
      buildDevelopRequestDetail(r),
      getMembersByIds([r.mbId, ...(r.assigneeMbId === null ? [] : [r.assigneeMbId])]),
      developReferenceFiles(r.id),
      prisma.spDevelopQuote.findMany({ where: { requestId: r.id }, include: { items: true, milestones: true }, orderBy: { version: 'asc' } }),
      prisma.spDevelopEvent.findMany({ where: { requestId: r.id }, orderBy: { id: 'asc' } }),
    ]);
    const [eventFiles, poFiles, allFiles] = await Promise.all([
      developEventFiles(events.map((e) => e.id)),
      prisma.spFile.findMany({ where: { refType: REF_DEVELOP_QUOTE, refId: { in: quotes.map((q) => q.id) }, fileType: 'po' } }),
      prisma.spFile.findMany({ where: { refType: REF_DEVELOP_REQUEST, refId: r.id, fileType: 'attachment' }, orderBy: { id: 'asc' } }),
    ]);
    const poByQuote = new Map(poFiles.map((f) => [f.refId.toString(), f]));
    const item = await toItem(r, toOwner(r.mbId, members.get(r.mbId)), files, quotes);
    const status = asDevelopStatus(r.status);
    const draftJob = r.devReviewDraftJobId === null ? null : await getAiJob(r.devReviewDraftJobId);
    const working = toDevReview(r.devReview);
    const publicReview = toDevReview(r.devReviewPublic);
    const actorName = (e: { actorMbId: string | null; byAdmin: boolean }): string =>
      e.byAdmin ? (e.actorMbId === null ? '시스템' : members.get(e.actorMbId)?.name ?? e.actorMbId) : (members.get(r.mbId)?.name ?? '고객');
    return {
      ...item,
      description: r.description,
      tools: toTools(r.tools),
      answers: toAnswers(r.answers),
      ndaWanted: r.ndaWanted,
      internalMemo: r.internalMemo,
      aiSupplement: r.aiSupplement,
      files: allFiles.map((f) => toDevelopFileMeta(f)),
      review: {
        draft: toDevReview(r.devReviewDraft),
        draftAt: r.devReviewDraftAt?.toISOString() ?? null,
        draftJobId: r.devReviewDraftJobId,
        draftRunning: draftJob?.status === 'running',
        draftError: draftJob?.status === 'error' ? draftJob.error : null,
        stale: item.ai.reviewStale,
        working,
        editedAt: r.devReviewEditedAt?.toISOString() ?? null,
        editedBy: r.devReviewEditedBy,
        publicReview,
        publishedAt: r.devReviewPublishedAt?.toISOString() ?? null,
        publishedStale:
          publicReview !== null && r.devReviewPublishedAt !== null && r.devReviewEditedAt !== null && r.devReviewEditedAt > r.devReviewPublishedAt,
      },
      diagram: {
        meta: toDevDiagram(r.devDiagram),
        html: r.devDiagramHtml,
        source: r.devDiagramSource === 'upload' ? 'upload' : r.devDiagramSource === 'ai' ? 'ai' : null,
        published: r.devDiagramPublicHtml !== null,
        publishedAt: r.devDiagramPublishedAt?.toISOString() ?? null,
        publishedStale: r.devDiagramPublicHtml !== null && r.devDiagramHtml !== null && r.devDiagramPublicHtml !== r.devDiagramHtml,
      },
      quotes: quotes.map((q) => ({ ...toQuoteView(q, status, poByQuote.get(q.id.toString()) ?? null), internalNote: q.internalNote })),
      events: events.map((e) => toDevelopEventView(e, eventFiles.get(e.id.toString()) ?? [], actorName(e), false)),
      reviewDays: customerDetail.reviewDays,
      startedAt: customerDetail.startedAt,
      deliveredAt: customerDetail.deliveredAt,
      completedAt: customerDetail.completedAt,
      cancelledAt: customerDetail.cancelledAt,
      cancelReason: customerDetail.cancelReason,
      declinedReason: customerDetail.declinedReason,
    };
  };

  // ── GET /admin/develop/requests — 워크큐 ──────────────────────────────────────
  fastify.get('/develop/requests', { schema: { querystring: AdminDevelopRequestListQuery } }, async (request) => {
    const { page, pageSize, tab, q } = request.query;
    const search: Prisma.SpDevelopRequestWhereInput =
      q === undefined || q === ''
        ? {}
        : {
            OR: [
              { title: { contains: q } },
              { mbId: { contains: q } },
              { contactName: { contains: q } },
              { contactCompany: { contains: q } },
            ],
          };
    const where: Prisma.SpDevelopRequestWhereInput = { ...search, status: { in: [...TAB_STATUSES[tab]] } };
    const [rows, total, grouped] = await Promise.all([
      prisma.spDevelopRequest.findMany({ where, orderBy: { id: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.spDevelopRequest.count({ where }),
      prisma.spDevelopRequest.groupBy({ by: ['status'], where: search, _count: { _all: true } }),
    ]);
    const byStatus = new Map(grouped.map((g) => [g.status, g._count._all]));
    const counts = Object.fromEntries(
      (Object.keys(TAB_STATUSES) as DevelopAdminTabType[]).map((t) => [t, TAB_STATUSES[t].reduce((n, s) => n + (byStatus.get(s) ?? 0), 0)]),
    ) as AdminDevelopRequestCountsType;
    const ids = rows.map((r) => r.id);
    const [members, files, quotes] = await Promise.all([
      getMembersByIds(rows.map((r) => r.mbId)),
      prisma.spFile.findMany({
        where: { refType: REF_DEVELOP_REQUEST, refId: { in: ids }, area: null, fileType: 'attachment' },
        select: { id: true, size: true, refId: true },
      }),
      prisma.spDevelopQuote.findMany({ where: { requestId: { in: ids } }, select: { id: true, requestId: true, version: true, kind: true, status: true, totalAmount: true } }),
    ]);
    const items = await Promise.all(
      rows.map((r) =>
        toItem(
          r,
          toOwner(r.mbId, members.get(r.mbId)),
          files.filter((f) => f.refId === r.id),
          quotes.filter((qq) => qq.requestId === r.id),
        ),
      ),
    );
    return { result: true as const, data: { items, total, page, pageSize, counts } };
  });

  // ── GET /admin/develop/requests/:id ──────────────────────────────────────────
  fastify.get('/develop/requests/:id', { schema: { params: RequestIdParams, response: { 200: AdminDevelopRequestDetailResponse, 404: ApiError } } }, async (request, reply) => {
    const r0 = await load(request.params.id);
    if (r0 === null) return reply.status(404).send(notFound);
    // 읽기 전 lazy 승격(결제 확인·견적 만료·자동확정) — 고객 상세와 같은 진전 지점.
    const r = await ensureDevelopLazy(r0, request.log);
    return { result: true as const, data: await buildAdminDetail(r) };
  });

  // ── PATCH /admin/develop/requests/:id — 담당자·내부 메모·AI 보충 메모·검수 기간 ─────
  fastify.patch(
    '/develop/requests/:id',
    { schema: { params: RequestIdParams, body: AdminDevelopRequestPatchBody, response: { 200: AdminDevelopRequestDetailResponse, 404: ApiError } } },
    async (request, reply) => {
      const r = await load(request.params.id);
      if (r === null) return reply.status(404).send(notFound);
      const b = request.body;
      const updated = await prisma.spDevelopRequest.update({
        where: { id: r.id },
        data: {
          ...(b.assigneeMbId === undefined ? {} : { assigneeMbId: b.assigneeMbId }),
          ...(b.internalMemo === undefined ? {} : { internalMemo: b.internalMemo }),
          ...(b.aiSupplement === undefined ? {} : { aiSupplement: b.aiSupplement }),
          ...(b.reviewDays === undefined ? {} : { reviewDays: b.reviewDays }),
        },
      });
      return { result: true as const, data: await buildAdminDetail(updated) };
    },
  );

  // ── POST /admin/develop/requests/:id/status — 관리자 전이 ─────────────────────
  // reviewing(검토 시작·담당자 배정 겸) · in_progress(후불 착수) · completed(대행 확정) · cancelled · declined(사유 필수).
  fastify.post(
    '/develop/requests/:id/status',
    { schema: { params: RequestIdParams, body: AdminDevelopStatusBody, response: { 200: DevelopRequestStatusResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const r = await load(request.params.id);
      if (r === null) return reply.status(404).send(notFound);
      const { to, reason } = request.body;
      const mbId = request.user.mbId;
      const now = new Date();
      const from: Record<typeof to, readonly DevelopRequestStatusType[]> = {
        reviewing: ['received'],
        in_progress: ['accepted', 'delivered'],
        completed: ['delivered'],
        cancelled: DEVELOP_REQUEST_STATUSES.filter((s) => !isDevelopClosed(s) && s !== 'completed'),
        declined: ['received', 'reviewing', 'quoted'],
      };
      if ((to === 'declined' || to === 'cancelled') && (reason === undefined || reason.trim() === '')) {
        return reply.status(409).send({ error: 'REASON_REQUIRED', message: '사유를 적어 주세요' });
      }
      const extra: Prisma.SpDevelopRequestUpdateManyMutationInput =
        to === 'reviewing'
          ? { assigneeMbId: r.assigneeMbId ?? mbId }
          : to === 'in_progress'
            ? { startedAt: r.startedAt ?? now }
            : to === 'completed'
              ? { completedAt: now }
              : to === 'cancelled'
                ? { cancelledAt: now, cancelReason: reason ?? null }
                : { declinedReason: reason ?? null };
      const ok = await transitionDevelopStatus(r.id, from[to], to, { mbId, byAdmin: true }, extra, reason ?? null);
      if (!ok) return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '지금 상태에서는 바꿀 수 없습니다' });
      if (to === 'cancelled' || to === 'declined') await cancelPendingMilestones({ requestId: r.id });
      const brief = { requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas) };
      if (to === 'declined' || to === 'cancelled' || to === 'in_progress') {
        void sendDevelopMail(request.log, await customerEmailOf(r), buildStatusChangedEmail({ ...brief, status: to, reason: reason ?? null }), {
          kind: `develop_${to}`,
          refType: 'develop_request',
          refId: r.id,
          sentBy: mbId,
          toMbId: r.mbId,
        });
      }
      if (to === 'completed') {
        void sendDevelopMail(request.log, await customerEmailOf(r), buildCompletedEmail({ ...brief, confirmedBy: 'admin', forAdmin: false }), {
          kind: 'develop_completed',
          refType: 'develop_request',
          refId: r.id,
          sentBy: mbId,
          toMbId: r.mbId,
        });
      }
      return { result: true as const, data: { requestId: Number(r.id), status: to } };
    },
  );

  // ── POST /admin/develop/requests/:id/ai/review · /ai/diagram — 초안 (재)생성 ────
  // 관리자는 유스케이스 토글·캐시를 무시하고 돈다(force). 고객 미동의만은 넘지 못한다(AI_CONSENT_REQUIRED).
  for (const kind of ['review', 'diagram'] as const) {
    fastify.post(
      `/develop/requests/:id/ai/${kind}`,
      { schema: { params: RequestIdParams, response: { 200: AdminDevelopAiRunResponse, 404: ApiError, 409: ApiError } } },
      async (request, reply) => {
        const r = await load(request.params.id);
        if (r === null) return reply.status(404).send(notFound);
        if (!r.aiConsent) return reply.status(409).send({ error: 'AI_CONSENT_REQUIRED', message: '고객이 AI 분석에 동의하지 않은 의뢰입니다' });
        if (kind === 'review' && (await developReviewDraftRunning(r))) {
          return reply.status(409).send({ error: 'AI_RUNNING', message: '검토서 초안을 만드는 중입니다' });
        }
        const started = await startDevelopAiDrafts(r, request.log, {
          review: kind === 'review',
          diagram: kind === 'diagram',
          auto: false,
          force: true,
        });
        const part = kind === 'review' ? started.review : started.diagram;
        if ('skipped' in part) {
          if (part.skipped === 'RUNNING') return reply.status(409).send({ error: 'AI_RUNNING', message: '이미 만드는 중입니다' });
          return { result: true as const, data: { jobId: null, cached: false, skipped: part.skipped } };
        }
        return {
          result: true as const,
          data: { jobId: 'jobId' in part ? part.jobId : null, cached: 'cached' in part ? part.cached : false, skipped: null },
        };
      },
    );
  }

  // ── PUT /admin/develop/requests/:id/review — 작업본 저장(구조 편집) ─────────────
  fastify.put(
    '/develop/requests/:id/review',
    { schema: { params: RequestIdParams, body: AdminDevelopReviewPutBody, response: { 200: AdminDevelopRequestDetailResponse, 404: ApiError } } },
    async (request, reply) => {
      const r = await load(request.params.id);
      if (r === null) return reply.status(404).send(notFound);
      const now = new Date();
      const review: MarketDevReviewType = {
        ...request.body.review,
        meta: { ...request.body.review.meta, editedAt: now.toISOString(), editedBy: request.user.mbId },
      };
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.spDevelopRequest.update({
          where: { id: r.id },
          data: { devReview: review, devReviewEditedAt: now, devReviewEditedBy: request.user.mbId },
        });
        // 버전 원장(§6.2) — 내용이 직전 판과 같으면 기록하지 않는다.
        await recordDevelopReviewVersion(tx, r.id, { kind: 'working', review, author: request.user.mbId });
        return u;
      });
      return { result: true as const, data: await buildAdminDetail(updated) };
    },
  );

  // ── 검토서 버전 원장(§6.2) — 목록·단건·복원 ────────────────────────────────────
  const VersionParams = RequestIdParams.extend({ seq: z.string().regex(/^\d+$/) });

  fastify.get(
    '/develop/requests/:id/review/versions',
    { schema: { params: RequestIdParams, response: { 200: AdminDevelopReviewVersionListResponse, 404: ApiError } } },
    async (request, reply) => {
      const r = await load(request.params.id);
      if (r === null) return reply.status(404).send(notFound);
      const rows = await prisma.spDevelopReviewVersion.findMany({ where: { requestId: r.id }, orderBy: { seq: 'desc' } });
      return {
        result: true as const,
        data: {
          items: rows.map(toDevelopReviewVersionMeta),
          current: currentDevelopReviewSeqs(rows, { draft: r.devReviewDraft, working: r.devReview, publicReview: r.devReviewPublic }),
        },
      };
    },
  );

  fastify.get(
    '/develop/requests/:id/review/versions/:seq',
    { schema: { params: VersionParams, response: { 200: AdminDevelopReviewVersionResponse, 404: ApiError } } },
    async (request, reply) => {
      const r = await load(request.params.id);
      if (r === null) return reply.status(404).send(notFound);
      const row = await prisma.spDevelopReviewVersion.findUnique({ where: { requestId_seq: { requestId: r.id, seq: Number(request.params.seq) } } });
      const review = row === null ? null : toDevReview(row.review);
      if (row === null || review === null) return reply.status(404).send({ error: 'NOT_FOUND', message: '버전이 없습니다' });
      return { result: true as const, data: { meta: toDevelopReviewVersionMeta(row), review } };
    },
  );

  // 복원 = 그 판을 작업본으로 덮고 새 working 버전(parentSeq)을 쌓는다. 이력은 지우지 않는다.
  fastify.post(
    '/develop/requests/:id/review/versions/:seq/restore',
    { schema: { params: VersionParams, response: { 200: AdminDevelopRequestDetailResponse, 404: ApiError } } },
    async (request, reply) => {
      const r = await load(request.params.id);
      if (r === null) return reply.status(404).send(notFound);
      const seq = Number(request.params.seq);
      const row = await prisma.spDevelopReviewVersion.findUnique({ where: { requestId_seq: { requestId: r.id, seq } } });
      const source = row === null ? null : toDevReview(row.review);
      if (row === null || source === null) return reply.status(404).send({ error: 'NOT_FOUND', message: '버전이 없습니다' });
      const now = new Date();
      const review: MarketDevReviewType = { ...source, meta: { ...source.meta, editedAt: now.toISOString(), editedBy: request.user.mbId } };
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.spDevelopRequest.update({
          where: { id: r.id },
          data: { devReview: review, devReviewEditedAt: now, devReviewEditedBy: request.user.mbId },
        });
        await recordDevelopReviewVersion(tx, r.id, {
          kind: 'working',
          review,
          author: request.user.mbId,
          parentSeq: seq,
          note: `v${String(seq)} 복원`,
        });
        return u;
      });
      return { result: true as const, data: await buildAdminDetail(updated) };
    },
  );

  // ── POST /admin/develop/requests/:id/review/publish|unpublish|reset ─────────────
  fastify.post(
    '/develop/requests/:id/review/:action',
    { schema: { params: RequestIdParams.extend({ action: z.enum(['publish', 'unpublish', 'reset']) }), response: { 200: AdminDevelopRequestDetailResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const r = await load(request.params.id);
      if (r === null) return reply.status(404).send(notFound);
      const { action } = request.params;
      const now = new Date();
      let updated: SpDevelopRequest;
      if (action === 'publish') {
        const working = toDevReview(r.devReview);
        if (working === null) return reply.status(409).send({ error: 'REVIEW_EMPTY', message: '공개할 작업본이 없습니다' });
        updated = await prisma.$transaction(async (tx) => {
          const u = await tx.spDevelopRequest.update({ where: { id: r.id }, data: { devReviewPublic: working, devReviewPublishedAt: now } });
          await addDevelopEvent(tx, r.id, {
            type: 'published',
            actorMbId: request.user.mbId,
            byAdmin: true,
            title: 'AI 사전 검토서를 공개했습니다',
            payload: { what: 'review' },
          });
          // 버전 원장(§6.2) — 고객이 실제로 본 판. 내용이 같아도 공개 시각이 사실이라 kind 가 다르면 기록된다.
          await recordDevelopReviewVersion(tx, r.id, { kind: 'published', review: working, author: request.user.mbId });
          return u;
        });
      } else if (action === 'unpublish') {
        updated = await prisma.spDevelopRequest.update({ where: { id: r.id }, data: { devReviewPublic: Prisma.DbNull, devReviewPublishedAt: null } });
      } else {
        const draft = toDevReview(r.devReviewDraft);
        if (draft === null) return reply.status(409).send({ error: 'DRAFT_EMPTY', message: '가져올 초안이 없습니다' });
        updated = await prisma.$transaction(async (tx) => {
          const u = await tx.spDevelopRequest.update({
            where: { id: r.id },
            data: { devReview: draft, devReviewEditedAt: now, devReviewEditedBy: request.user.mbId },
          });
          await recordDevelopReviewVersion(tx, r.id, { kind: 'working', review: draft, author: request.user.mbId, note: '초안에서 가져옴' });
          return u;
        });
      }
      return { result: true as const, data: await buildAdminDetail(updated) };
    },
  );

  // ── POST /admin/develop/requests/:id/diagram/publish|unpublish ─────────────────
  fastify.post(
    '/develop/requests/:id/diagram/:action',
    { schema: { params: RequestIdParams.extend({ action: z.enum(['publish', 'unpublish']) }), response: { 200: AdminDevelopRequestDetailResponse, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const r = await load(request.params.id);
      if (r === null) return reply.status(404).send(notFound);
      const now = new Date();
      let updated: SpDevelopRequest;
      if (request.params.action === 'publish') {
        if (r.devDiagramHtml === null) return reply.status(409).send({ error: 'DIAGRAM_EMPTY', message: '공개할 구성도가 없습니다' });
        updated = await prisma.$transaction(async (tx) => {
          const u = await tx.spDevelopRequest.update({
            where: { id: r.id },
            data: { devDiagramPublicHtml: r.devDiagramHtml, devDiagramPublishedAt: now },
          });
          await addDevelopEvent(tx, r.id, {
            type: 'published',
            actorMbId: request.user.mbId,
            byAdmin: true,
            title: '시스템 구성도를 공개했습니다',
            payload: { what: 'diagram' },
          });
          return u;
        });
      } else {
        updated = await prisma.spDevelopRequest.update({ where: { id: r.id }, data: { devDiagramPublicHtml: null, devDiagramPublishedAt: null } });
      }
      return { result: true as const, data: await buildAdminDetail(updated) };
    },
  );

  // ── POST /admin/develop/requests/:id/diagram/upload — 교체 업로드(svg·png·jpg·webp·html) ──
  fastify.post('/develop/requests/:id/diagram/upload', async (request, reply) => {
    if (!request.isMultipart()) return reply.status(400).send({ error: 'MULTIPART_REQUIRED', message: 'multipart 요청이어야 합니다' });
    const { files } = await collectMultipart(request);
    const params = RequestIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'BAD_PARAMS', message: '잘못된 경로' });
    const r = await load(params.data.id);
    if (r === null) return reply.status(404).send(notFound);
    const file = files[0];
    if (file === undefined) return reply.status(400).send({ error: 'FILE_REQUIRED', message: '파일이 없습니다' });
    if (file.buffer.byteLength > 8 * 1024 * 1024) return reply.status(400).send({ error: 'FILE_TOO_LARGE', message: '8MB 이하만 올릴 수 있습니다' });
    const wrapped = wrapUploadedDiagram(file.mimetype, file.filename, file.buffer);
    if (!wrapped.ok) return reply.status(400).send({ error: 'FILE_UNSUPPORTED', message: 'svg·png·jpg·webp·html 만 올릴 수 있습니다' });
    const updated = await prisma.spDevelopRequest.update({
      where: { id: r.id },
      data: { devDiagramHtml: wrapped.html, devDiagramSource: 'upload' },
    });
    return { result: true as const, data: await buildAdminDetail(updated) };
  });

  // ── POST /admin/develop/requests/:id/events — 메모·문의 답변·확인 요청·산출물·세금계산서(multipart) ──
  fastify.post('/develop/requests/:id/events', async (request, reply) => {
    if (!request.isMultipart()) return reply.status(400).send({ error: 'MULTIPART_REQUIRED', message: 'multipart 요청이어야 합니다' });
    const { files, rawPayload } = await collectMultipart(request);
    const params = RequestIdParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: 'BAD_PARAMS', message: '잘못된 경로' });
    const r = await load(params.data.id);
    if (r === null) return reply.status(404).send(notFound);
    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(rawPayload ?? '');
    } catch {
      return reply.status(400).send({ error: 'PAYLOAD_SCHEMA_MISMATCH', message: 'payload 가 JSON 이 아닙니다' });
    }
    const parsed = AdminDevelopEventPayload.safeParse(payloadJson);
    if (!parsed.success) return reply.status(400).send({ error: 'PAYLOAD_SCHEMA_MISMATCH', message: '입력값 형식이 올바르지 않습니다' });
    const p = parsed.data;
    const status = asDevelopStatus(r.status);
    if (p.type === 'deliverable' && p.final && status !== 'in_progress' && status !== 'delivered') {
      return reply.status(409).send({ error: 'INVALID_TRANSITION', message: '진행 중인 의뢰만 납품할 수 있습니다' });
    }
    // 세금계산서는 payload(발행일·금액)만으로 내용이 된다.
    const hasPayload = p.payload !== undefined && Object.keys(p.payload).length > 0;
    if (p.title === '' && p.body === '' && files.length === 0 && !(p.type === 'tax_invoice' && hasPayload)) {
      return reply.status(400).send({ error: 'EMPTY_EVENT', message: '내용이나 파일이 필요합니다' });
    }
    let uploaded: Awaited<ReturnType<typeof uploadToFileServer>> = [];
    if (files.length > 0) {
      try {
        uploaded = await uploadToFileServer(files.map((f) => ({ buffer: f.buffer, filename: f.filename, mimetype: f.mimetype })), DEVELOP_FILE_SERVICE_TYPE);
      } catch (err) {
        request.log.error({ err }, 'develop event file upload failed');
        return reply.status(502).send({ error: 'FILE_UPLOAD_FAILED', message: '파일 업로드에 실패했습니다' });
      }
    }
    const defaultTitle: Record<typeof p.type, string> = {
      note: '진행 메모',
      comment: '담당자 답변',
      review_request: '확인을 요청합니다',
      deliverable: p.final ? '산출물을 납품했습니다' : '중간 산출물',
      tax_invoice: '세금계산서를 발행했습니다',
    };
    const now = new Date();
    const event = await prisma.$transaction(async (tx) => {
      const e = await addDevelopEvent(tx, r.id, {
        type: p.type,
        actorMbId: request.user.mbId,
        byAdmin: true,
        visibleToCustomer: p.type === 'tax_invoice' ? true : p.visibleToCustomer,
        title: p.title === '' ? defaultTitle[p.type] : p.title,
        body: p.body === '' ? null : p.body,
        payload: { ...(p.payload ?? {}), ...(p.type === 'deliverable' ? { final: p.final, locked: p.locked } : {}) },
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
            fileType: p.type === 'deliverable' ? 'deliverable' : p.type === 'review_request' ? 'review' : 'comment',
            uploadedBy: 'ADMIN',
          })),
        });
      }
      if (p.type === 'deliverable' && p.final && status === 'in_progress') {
        await tx.spDevelopRequest.updateMany({ where: { id: r.id, status: 'in_progress' }, data: { status: 'delivered', deliveredAt: now } });
        await addDevelopEvent(tx, r.id, {
          type: 'status_changed',
          actorMbId: request.user.mbId,
          byAdmin: true,
          title: '상태가 바뀌었습니다',
          payload: { to: 'delivered', from: ['in_progress'] },
        });
      }
      return e;
    });
    if (p.type === 'deliverable' && p.final && status === 'in_progress') {
      const autoConfirmAt = new Date(now.getTime() + r.reviewDays * 86_400_000).toISOString().slice(0, 10);
      void sendDevelopMail(
        request.log,
        await customerEmailOf(r),
        buildDeliveredEmail({ requestId: Number(r.id), title: r.title, serviceAreas: toAreaCodes(r.serviceAreas), reviewDays: r.reviewDays, autoConfirmAt }),
        { kind: 'develop_delivered', refType: 'develop_request', refId: r.id, sentBy: request.user.mbId, toMbId: r.mbId },
      );
    }
    const eventFiles = await developEventFiles([event.id]);
    return {
      result: true as const,
      data: toDevelopEventView(event, eventFiles.get(event.id.toString()) ?? [], request.user.mbId, false),
    };
  });

  // ── 관리자 파일 조회 — 의뢰·이벤트·견적 파일을 한 번호 체계로 본다. 다운로드·미리보기가 같은 판정을 쓴다.
  const findDevelopFile = (fileId: string): Promise<SpFile | null> =>
    prisma.spFile.findFirst({
      where: { id: BigInt(fileId), refType: { in: [REF_DEVELOP_REQUEST, REF_DEVELOP_EVENT, REF_DEVELOP_QUOTE] } },
    });

  // ── GET /admin/develop/files/:fileId — 관리자 다운로드(의뢰·이벤트·견적 파일 전부) ─────
  fastify.get('/develop/files/:fileId', { schema: { params: FileIdParams } }, async (request, reply) => {
    const file = await findDevelopFile(request.params.fileId);
    if (file === null) return reply.status(404).send({ error: 'NOT_FOUND', message: '파일이 없습니다' });
    const downloaded = await downloadFromFileServer(file.pathToken);
    if (downloaded === null) return reply.status(404).send({ error: 'NOT_FOUND', message: '파일이 없습니다' });
    return reply
      .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`)
      .type(resolveFileMime(file.originFileName, downloaded.contentType))
      .send(downloaded.buffer);
  });

  // ── GET /admin/develop/files/:fileId/preview — 구조화 미리보기(고객 라우트와 같은 buildFilePreview) ──
  fastify.get('/develop/files/:fileId/preview', { schema: { params: FileIdParams } }, async (request, reply) => {
    const file = await findDevelopFile(request.params.fileId);
    if (file === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
    const name = file.originFileName;
    if (!needsServerPreview(fileViewKind(name))) {
      return {
        result: true as const,
        data: {
          fileId: Number(file.id),
          name,
          size: Number(file.size),
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
    const downloaded = await downloadFromFileServer(file.pathToken);
    if (downloaded === null) return reply.status(404).send({ result: false, error: 'NOT_FOUND' });
    return { result: true as const, data: await buildFilePreview(Number(file.id), name, downloaded.buffer) };
  });

  done();
};
