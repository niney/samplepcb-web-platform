import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import type { SpFile, SpMarketExpert, SpMarketProject } from '@prisma/client';
import { z } from 'zod';
import {
  JwtClaims,
  MARKET_NDA_TEXT,
  MyDevDiagramsResponse,
  MARKET_NDA_VERSION,
  MARKET_REVISION_DEADLINE_EXTEND_MS,
  MARKET_REVISION_DEADLINE_GUARD_MS,
  MarketMyProjectListQuery,
  MarketNdaSignBody,
  MarketProjectCreatePayload,
  MarketProjectListQuery,
  MarketProjectUpdateBody,
  isMajorMarketRevision,
  normalizeMarketTools,
  marketRequiredMissing,
} from '@sp/api-contract';
import type {
  JwtClaimsType,
  MarketMyProjectListItemType,
  MarketProjectViewerType,
} from '@sp/api-contract';
import { getAiJob } from '../lib/ai/jobs';
import { devReviewAttachmentHashes, devReviewInputHash } from '../lib/ai/dev-review';
import {
  attachDevDiagramJob,
  buildProjectDevReviewSourceWithImages,
  requestDevDiagramForProject,
} from '../lib/ai/dev-diagram-runner';
import { startDevReviewJob } from '../lib/ai/runner';
import { DEV_REVIEW_USECASE, getAiUsecaseRuntime, toOllamaThink } from '../lib/ai/usecases';
import { downloadFromFileServer, uploadToFileServer } from '../lib/file-server';
import type { UploadedFileType } from '../lib/file-server';
import { getMembersByIds } from '../lib/g5-db';
import { kstDateTimeStr } from '../lib/kst';
import { buildTargetedRequestEmail, sendMarketMail } from '../lib/market-email';
import {
  MARKET_FILE_SERVICE_TYPE,
  REF_MARKET_PROJECT,
  asBidStatus,
  collectMultipart,
  deadlineToDate,
  deleteMarketFile,
  isBiddingClosed,
  marketBidCounts,
  marketOwnerNames,
  splitMarketAttachments,
  toAnswers,
  toAreaCodes,
  toDevDiagram,
  toDevDiagramView,
  toDevReview,
  toFileMeta,
  toMarketProjectListItem,
} from '../lib/market';
import {
  diffProjectSnapshots,
  isDevReviewStale,
  parseSnapshot,
  snapshotOfProject,
  writeProjectRevision,
} from '../lib/market-revision';
import {
  asContractStatus,
  cancelPendingContractTx,
  ensureContractLazy,
  ensurePaidLazy,
  toMarketContractSummary,
} from '../lib/market-contract';
import { prisma } from '../lib/prisma';

// ── /api/market/projects — 프로젝트 의뢰(역견적/지정견적)·NDA·첨부 ───────────
// 공개 목록·상세는 비로그인 열람 가능하되 블라인드(입찰 개수만)·마스킹(의뢰인 원명
// 미노출)·NDA 게이트(미서명이면 첨부 개수만)가 적용된다. 실제 강제는 전부 서버 가드 —
// UI 숨김은 보안이 아니다. 마감은 저장 전이 없는 lazy 파생(isBiddingClosed).
// 에러 봉투는 회원 라우트 관례(pcb-projects): { result:false, error:'CODE' }.

const ProjectIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const ProjectFileParams = z.object({
  id: z.string().regex(/^\d+$/),
  fileId: z.string().regex(/^\d+$/),
});

type ProjectFileRow = Pick<SpFile, 'id' | 'fileType' | 'originFileName' | 'size' | 'area' | 'slot'>;

const projectFiles = (projectId: bigint): Promise<ProjectFileRow[]> =>
  prisma.spFile.findMany({
    where: { refType: REF_MARKET_PROJECT, refId: projectId },
    orderBy: { id: 'asc' },
    select: { id: true, fileType: true, originFileName: true, size: true, area: true, slot: true },
  });

// 채택된 입찰의 전문가 id(없으면 null) — 채택 후 접근 유지 판정에 쓴다.
const awardedExpertIdOf = async (p: SpMarketProject): Promise<bigint | null> => {
  if (!['awarded', 'working', 'completed'].includes(p.status) || p.awardedBidId === null) return null;
  const awarded = await prisma.spMarketBid.findUnique({
    where: { id: p.awardedBidId },
    select: { expertId: true },
  });
  return awarded?.expertId ?? null;
};

// 의뢰 유형은 더 이상 입력이 아니다 — 분야 2개 이상이면 시스템 통합(docs/AI_DEV_REVIEW.md §4).
// 표시용 파생값이며 입찰 자격을 가르지 않는다(전체서비스 회사 전용 가드는 폐지).
const deriveRequestType = (serviceAreas: readonly string[]): 'system' | 'individual' =>
  serviceAreas.length > 1 ? 'system' : 'individual';

// 전문가의 첨부 접근 자격 — 입찰 접수 중(입찰 준비) 또는 채택된 작업자만.
// 마감 후 비채택 전문가·일반 회원은 접근 불가(NDA 게이트 취지의 최소권한).
const expertFileAccess = async (
  project: SpMarketProject,
  mbId: string,
  now: Date,
): Promise<{ ok: true } | { ok: false; reason: 'FORBIDDEN' | 'NDA_REQUIRED' }> => {
  const expert = await prisma.spMarketExpert.findUnique({ where: { mbId } });
  if (expert?.status !== 'approved') return { ok: false, reason: 'FORBIDDEN' };
  if (project.method === 'targeted' && project.targetExpertId !== expert.id) {
    return { ok: false, reason: 'FORBIDDEN' };
  }
  const windowOpen = !isBiddingClosed(project.status, project.bidDeadlineAt, now);
  if (!windowOpen) {
    const awardedExpertId = await awardedExpertIdOf(project);
    if (awardedExpertId !== expert.id) return { ok: false, reason: 'FORBIDDEN' };
  }
  if (project.ndaRequired) {
    const signed = await prisma.spMarketNdaSign.findUnique({
      where: { projectId_mbId: { projectId: project.id, mbId } },
      select: { id: true },
    });
    if (signed === null) return { ok: false, reason: 'NDA_REQUIRED' };
  }
  return { ok: true };
};

// 수정 가능 판정 — 접수 중(bidding ∧ 마감 전)이면 **입찰이 있어도 수정할 수 있다**.
// 옛 규칙(입찰 1건이면 잠금)은 오타 하나도 못 고치게 만들었다. 대신 수정 직전 값을 이력으로 남기고
// 중대한 수정은 입찰자 화면에 경고로 뜬다(docs/MARKET_FLOW.md §의뢰 수정·버전).
// 마감·채택·취소 뒤는 그대로 잠근다 — 그 뒤 원천이 바뀌면 계약 분쟁이 된다.
const editBlockReason = (p: SpMarketProject, now: Date): 'NOT_EDITABLE' | null =>
  isBiddingClosed(p.status, p.bidDeadlineAt, now) ? 'NOT_EDITABLE' : null;

export const marketProjectRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // ── POST /market/projects — 의뢰 등록(multipart: payload + attachment[]) ────
  fastify.post('/market/projects', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.badRequest('multipart/form-data 요청이어야 합니다');
    }
    const { files, rawPayload } = await collectMultipart(request);
    try {
      await request.jwtVerify();
    } catch {
      return reply.unauthorized('로그인이 필요합니다');
    }
    const mbId = request.user.mbId;

    if (rawPayload === undefined) return reply.badRequest('payload 파트가 없습니다');
    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(rawPayload);
    } catch {
      return reply.badRequest('payload 가 유효한 JSON 이 아닙니다');
    }
    const parsed = MarketProjectCreatePayload.safeParse(payloadJson);
    if (!parsed.success) {
      return reply.status(400).send({
        result: false,
        error: 'PAYLOAD_SCHEMA_MISMATCH',
        issues: parsed.error.issues,
      });
    }
    const payload = parsed.data;
    // 첨부 — 일반 + 분야별 슬롯(레지스트리 정합, 선택 분야의 슬롯만).
    const split = splitMarketAttachments(files, payload.serviceAreas);
    if (split.invalid.length > 0) {
      return reply.status(400).send({ result: false, error: 'ATTACHMENT_FIELD_INVALID' });
    }
    const attachments = split.accepted;

    const now = new Date();
    const bidDeadlineAt = deadlineToDate(payload.deadline, now);
    if (bidDeadlineAt.getTime() <= now.getTime()) {
      return reply.status(400).send({ result: false, error: 'DEADLINE_PAST' });
    }
    // 프로젝트 공통 조건(완료 시점·목표 단계·인도 범위)은 필수 — 모르면 탈출구(unknown)를 골라야 한다(§13.8).
    const requiredMissing = marketRequiredMissing(payload.answers, payload.serviceAreas);
    if (requiredMissing.length > 0) {
      return reply.status(400).send({ result: false, error: 'ANSWERS_REQUIRED', missing: requiredMissing });
    }

    // AI 사전 검토서 — 클라이언트는 본문을 보내지 않는다. jobId 만 받아 서버가 자기
    // 저장분(sp_ai_job)을 소유자·완료·유스케이스·입력 해시까지 대조한 뒤 그대로 박제한다.
    // 해시 규칙은 실행 라우트(§3.4)와 **정확히 같아야** 한다 — 다르면 정상 등록이 튕긴다.
    let devReview: Prisma.InputJsonValue | null = null;
    if (payload.devReviewJobId !== undefined) {
      const job = await getAiJob(payload.devReviewJobId);
      if (
        job?.mbId !== mbId ||
        job.useCase !== 'market.dev-review' ||
        job.status !== 'done' ||
        job.review === null
      ) {
        return reply.status(400).send({ result: false, error: 'REVIEW_JOB_INVALID' });
      }
      const expected = devReviewInputHash({
        title: payload.title,
        serviceAreas: payload.serviceAreas,
        description: payload.description,
        answers: payload.answers,
        attachmentHashes: devReviewAttachmentHashes(attachments),
      });
      if (job.inputHash !== expected) {
        return reply.status(400).send({ result: false, error: 'REVIEW_STALE' });
      }
      devReview = job.review;
    }

    // 지정견적 — 대상은 승인 전문가여야 하고, 자기 자신(자전 입찰 유도) 지정은 금지.
    let targetExpert: SpMarketExpert | null = null;
    if (payload.method === 'targeted') {
      if (payload.targetExpertId === undefined) {
        // 계약 superRefine 이 걸러주지만 타입 내로잉을 위해 한 번 더.
        return reply.status(400).send({ result: false, error: 'TARGET_EXPERT_REQUIRED' });
      }
      const target = await prisma.spMarketExpert.findFirst({
        where: { id: BigInt(payload.targetExpertId), status: 'approved' },
      });
      if (target === null) {
        return reply.status(409).send({ result: false, error: 'TARGET_EXPERT_INVALID' });
      }
      if (target.mbId === mbId) {
        return reply.status(403).send({ result: false, error: 'SELF_TARGET_FORBIDDEN' });
      }
      targetExpert = target;
    }

    // 첨부(선택 — 명세서 권장은 FE 경고로, 강제하지 않는다).
    let uploaded: UploadedFileType[] = [];
    if (attachments.length > 0) {
      try {
        uploaded = await uploadToFileServer(
          attachments.map((f) => ({
            buffer: f.buffer,
            filename: f.filename,
            mimetype: f.mimetype,
          })),
          MARKET_FILE_SERVICE_TYPE,
        );
      } catch (err) {
        request.log.error({ err }, 'market project file upload failed');
        return reply.status(502).send({ result: false, error: 'FILE_UPLOAD_FAILED' });
      }
    }

    const project = await prisma.$transaction(async (tx) => {
      const p = await tx.spMarketProject.create({
        data: {
          mbId,
          title: payload.title,
          requestType: deriveRequestType(payload.serviceAreas),
          serviceAreas: payload.serviceAreas,
          tools: normalizeMarketTools(payload.tools, payload.serviceAreas),
          description: payload.description,
          devReview: devReview ?? Prisma.DbNull,
          // 공통·분야별 질문 답변 — 브리프·검토서·정밀 구성도의 원천.
          answers: payload.answers.length > 0 ? payload.answers : Prisma.DbNull,
          ndaRequired: payload.ndaRequired,
          budgetRange: payload.budgetRange,
          // 시작·완료 희망일은 위저드 v2 에서 사라졌다 — 컬럼만 남고 항상 null.
          startHopeDate: null,
          dueHopeDate: null,
          bidDeadlineAt,
          method: payload.method,
          targetExpertId: targetExpert?.id ?? null,
        },
      });
      if (uploaded.length > 0) {
        await tx.spFile.createMany({
          data: uploaded.map((u, i) => ({
            refType: REF_MARKET_PROJECT,
            refId: p.id,
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
      return p;
    });

    // 시스템 구성도(§13.7) — 3단계에서 시작한 잡(devDiagramJobId)을 프로젝트에 연결한다(소유자·입력 해시 대조,
    // 어긋나면 연결만 건너뛴다 — 등록은 막지 않는다). 잡 id 없이 AI 동의만 있으면 등록 뒤 서버가 큐에 넣는다.
    let diagramLinked = false;
    if (payload.devDiagramJobId !== undefined) {
      const expected = devReviewInputHash({
        title: payload.title,
        serviceAreas: payload.serviceAreas,
        description: payload.description,
        answers: payload.answers,
        attachmentHashes: devReviewAttachmentHashes(attachments),
      });
      const linked = await attachDevDiagramJob(project.id, mbId, payload.devDiagramJobId, expected, request.log);
      diagramLinked = linked === 'linked';
      if (!diagramLinked) request.log.warn({ projectId: Number(project.id), jobId: payload.devDiagramJobId, linked }, 'dev diagram job not linked');
    }
    if (!diagramLinked && (payload.aiConsent || devReview !== null)) {
      const queued = await requestDevDiagramForProject(project, request.log);
      if (!queued.ok) request.log.info({ projectId: Number(project.id), reason: queued.reason }, 'dev diagram not queued');
    }

    // 지정견적 요청 알림(비차단) — 지정 전문가에게 메일. 실패해도 등록은 유효.
    if (targetExpert !== null) {
      const [members, owners] = await Promise.all([
        getMembersByIds([targetExpert.mbId]),
        marketOwnerNames([mbId]),
      ]);
      void sendMarketMail(
        request.log,
        members.get(targetExpert.mbId)?.email,
        buildTargetedRequestEmail({
          expertName: targetExpert.displayName,
          projectId: Number(project.id),
          projectTitle: payload.title,
          ownerName: owners.get(mbId) ?? '회원',
          bidDeadlineAt: `${kstDateTimeStr(bidDeadlineAt).slice(0, 16)} (KST)`,
        }),
        {
          kind: 'market_targeted_request',
          refType: 'market_project',
          refId: project.id,
          sentBy: mbId,
          toMbId: targetExpert.mbId,
        },
      );
    }

    request.log.info(
      { projectId: Number(project.id), mbId, method: payload.method },
      'market project created',
    );
    return { result: true as const, data: { projectId: Number(project.id) } };
  });

  // ── GET /market/projects — 공개 입찰 보드(비로그인 열람 가능) ───────────────
  fastify.get(
    '/market/projects',
    { schema: { querystring: MarketProjectListQuery } },
    async (request) => {
      const { page, pageSize, tab, serviceArea, method, q, sort } = request.query;
      const now = new Date();

      const base: Prisma.SpMarketProjectWhereInput = {
        ...(serviceArea !== undefined ? { serviceAreas: { array_contains: [serviceArea] } } : {}),
        ...(method !== undefined ? { method } : {}),
        ...(q !== undefined && q.trim() !== ''
          ? { OR: [{ title: { contains: q.trim() } }, { description: { contains: q.trim() } }] }
          : {}),
      };
      // 탭은 lazy 마감을 WHERE 로 반영한다(저장 전이 없음).
      const statusWhere: Prisma.SpMarketProjectWhereInput =
        tab === 'open'
          ? { status: 'bidding', bidDeadlineAt: { gt: now } }
          : tab === 'closed'
            ? { OR: [{ status: 'closed' }, { status: 'bidding', bidDeadlineAt: { lte: now } }] }
            : tab === 'awarded'
              ? { status: { in: ['awarded', 'working', 'completed'] } }
              : { status: { not: 'cancelled' } }; // all — 취소는 공개 목록 미노출

      const where: Prisma.SpMarketProjectWhereInput = { AND: [base, statusWhere] };
      const [rows, total] = await Promise.all([
        prisma.spMarketProject.findMany({
          where,
          orderBy: sort === 'deadline' ? { bidDeadlineAt: 'asc' } : { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spMarketProject.count({ where }),
      ]);

      const [owners, bidCounts] = await Promise.all([
        marketOwnerNames(rows.map((p) => p.mbId)),
        marketBidCounts(rows.map((p) => p.id)),
      ]);
      const items = rows.map((p) =>
        toMarketProjectListItem(
          p,
          owners.get(p.mbId) ?? '회원',
          bidCounts.get(p.id.toString()) ?? 0,
          now,
        ),
      );
      return { result: true as const, data: { items, total, page, pageSize } };
    },
  );

  // ── GET /market/projects/:id — 상세(선택적 JWT 개인화) ──────────────────────
  fastify.get(
    '/market/projects/:id',
    { schema: { params: ProjectIdParams } },
    async (request, reply) => {
      // 공개 라우트지만 토큰이 있으면 개인화(viewer)를 싣는다.
      let user: JwtClaimsType | null;
      try {
        user = JwtClaims.parse(await request.jwtVerify());
      } catch {
        user = null;
      }

      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');

      const isOwner = user !== null && project.mbId === user.mbId;
      const isAdmin = user?.isAdmin === true;
      // 취소 건은 공개 화면에서 숨긴다(소유자·관리자만 열람).
      if (project.status === 'cancelled' && !isOwner && !isAdmin) {
        return reply.notFound('프로젝트가 없습니다');
      }

      const now = new Date();
      if (!isOwner && !isAdmin) {
        await prisma.spMarketProject.update({
          where: { id: project.id },
          data: { viewCount: { increment: 1 } },
        });
        project.viewCount += 1;
      }

      // 수정 이력 — 한 번에 읽어 개수·마지막 시각·마지막 중대 수정·검토서 stale 을 모두 파생한다.
      const revRows = await prisma.spMarketProjectRevision.findMany({
        where: { projectId: project.id },
        orderBy: { revNo: 'asc' },
        select: { createdAt: true, major: true, changedFields: true },
      });
      const revisionCount = revRows.length;
      const lastRevisionAt = revRows.at(-1)?.createdAt ?? null;
      const lastMajorAt = [...revRows].reverse().find((r) => r.major)?.createdAt ?? null;

      // 개인화 + 첨부 메타 노출 판정.
      let viewer: MarketProjectViewerType | null = null;
      let filesVisible = isOwner || isAdmin;
      if (user !== null) {
        const expert = await prisma.spMarketExpert.findUnique({ where: { mbId: user.mbId } });
        const [signed, myBid] = await Promise.all([
          prisma.spMarketNdaSign.findUnique({
            where: { projectId_mbId: { projectId: project.id, mbId: user.mbId } },
            select: { id: true },
          }),
          prisma.spMarketBid.findFirst({ where: { projectId: project.id, mbId: user.mbId } }),
        ]);
        // 계약 요약 — 당사자(의뢰인·채택 전문가)에게만. 상세 진입이라 lazy 승격도 여기서.
        let contractSummary: MarketProjectViewerType['contract'] = null;
        const contract = await prisma.spMarketContract.findUnique({
          where: { projectId: project.id },
        });
        if (
          contract !== null &&
          (contract.clientMbId === user.mbId || contract.expertMbId === user.mbId)
        ) {
          contractSummary = toMarketContractSummary(
            await ensureContractLazy(contract, request.log),
          );
        }
        viewer = {
          isOwner,
          isApprovedExpert: expert?.status === 'approved',
          isTargetExpert:
            project.method === 'targeted' &&
            expert !== null &&
            project.targetExpertId === expert.id,
          ndaSigned: signed !== null,
          myBidStatus: myBid !== null ? asBidStatus(myBid.status) : null,
          // 내 견적(재제출 포함 최종 시각) 뒤에 중대한 수정이 있었나 — 알림 대신 이 배너가 알린다.
          myBidOutdated:
            myBid !== null &&
            myBid.status !== 'withdrawn' &&
            lastMajorAt !== null &&
            myBid.updatedAt.getTime() < lastMajorAt.getTime(),
          contract: contractSummary,
        };
        // 메타 규칙: NDA 불요 → 공개 / NDA 요구 → 소유자·관리자·서명자만(파일명도 기밀 힌트).
        if (!filesVisible) filesVisible = !project.ndaRequired || viewer.ndaSigned;
      } else {
        filesVisible = !project.ndaRequired;
      }

      const [fileRows, owners, bidCounts] = await Promise.all([
        projectFiles(project.id),
        marketOwnerNames([project.mbId]),
        marketBidCounts([project.id]),
      ]);

      return {
        result: true as const,
        data: {
          ...toMarketProjectListItem(
            project,
            owners.get(project.mbId) ?? '회원',
            bidCounts.get(project.id.toString()) ?? 0,
            now,
          ),
          description: project.description,
          answers: toAnswers(project.answers),
          // 검토서 공개 범위 = description 과 동일(상세를 볼 수 있는 뷰어 전원).
          devReview: toDevReview(project.devReview),
          devDiagram: toDevDiagramView(project, true),
          startHopeDate: project.startHopeDate,
          dueHopeDate: project.dueHopeDate,
          awardedAt: project.awardedAt?.toISOString() ?? null,
          attachments: {
            count: fileRows.length,
            files: filesVisible ? fileRows.map(toFileMeta) : null,
          },
          revisionCount,
          lastRevisionAt: lastRevisionAt?.toISOString() ?? null,
          // 검토서를 만든 뒤에 원천이 바뀌었나 — 지우지 않고 "몇 번째 버전 기준" 배지로만 알린다.
          devReviewStale: isDevReviewStale(toDevReview(project.devReview), revRows),
          ndaText: MARKET_NDA_TEXT,
          ndaTextVersion: MARKET_NDA_VERSION,
          viewer,
        },
      };
    },
  );

  // ── PATCH /market/projects/:id — 소유자 수정(접수 중이면 입찰이 있어도 가능) ──
  // 수정 직전 값은 sp_market_project_revision 에 스냅샷으로 남고(같은 트랜잭션), 중대한 수정이면
  // 마감이 24시간보다 가까울 때 48시간 뒤로 자동 연장한다 — 입찰자가 견적을 고칠 시간을 남긴다.
  fastify.patch(
    '/market/projects/:id',
    {
      schema: { params: ProjectIdParams, body: MarketProjectUpdateBody },
      preHandler: fastify.authenticate,
    },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      if (project.mbId !== request.user.mbId) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const now = new Date();
      const blocked = editBlockReason(project, now);
      if (blocked !== null) {
        return reply.status(409).send({ result: false, error: blocked });
      }

      const body = request.body;
      const nextAreas = body.serviceAreas ?? toAreaCodes(project.serviceAreas);
      // 답변은 등록과 같은 게이트 — 필수 문항(공통 조건 3)을 비우는 수정은 막는다.
      if (body.answers !== undefined) {
        const missing = marketRequiredMissing(body.answers, nextAreas);
        if (missing.length > 0) {
          return reply.status(400).send({ result: false, error: 'ANSWERS_REQUIRED', missing });
        }
      }

      const data: Prisma.SpMarketProjectUpdateInput = {};
      if (body.title !== undefined) data.title = body.title;
      if (body.serviceAreas !== undefined) {
        data.serviceAreas = body.serviceAreas;
        data.requestType = deriveRequestType(body.serviceAreas); // 분야 개수에서 재파생
      }
      if (body.tools !== undefined) {
        data.tools = normalizeMarketTools(body.tools, nextAreas);
      }
      if (body.description !== undefined) data.description = body.description;
      if (body.answers !== undefined) data.answers = body.answers;
      if (body.devReview === null) data.devReview = Prisma.DbNull;
      if (body.ndaRequired !== undefined) data.ndaRequired = body.ndaRequired;
      if (body.budgetRange !== undefined) data.budgetRange = body.budgetRange;
      if (body.deadline !== undefined) {
        const next = deadlineToDate(body.deadline, now);
        if (next.getTime() <= now.getTime()) {
          return reply.status(400).send({ result: false, error: 'DEADLINE_PAST' });
        }
        data.bidDeadlineAt = next;
      }

      // 마감 자동 연장 — 중대 필드가 바뀌는데 남은 시간이 24시간 미만이면 48시간 뒤로 민다.
      // (diff 전에 정해야 이 연장까지 같은 revision 의 변경으로 기록된다.)
      const touched = Object.keys(body).filter((k) => k !== 'devReview');
      const willBeMajor = isMajorMarketRevision(touched);
      const effectiveDeadline = data.bidDeadlineAt instanceof Date ? data.bidDeadlineAt : project.bidDeadlineAt;
      let deadlineExtendedTo: Date | null = null;
      if (willBeMajor && effectiveDeadline.getTime() - now.getTime() < MARKET_REVISION_DEADLINE_GUARD_MS) {
        deadlineExtendedTo = new Date(now.getTime() + MARKET_REVISION_DEADLINE_EXTEND_MS);
        data.bidDeadlineAt = deadlineExtendedTo;
      }

      const result = await prisma.$transaction(async (tx) => {
        const beforeCount = await tx.spFile.count({
          where: { refType: REF_MARKET_PROJECT, refId: project.id },
        });
        const before = snapshotOfProject(project, beforeCount);
        const updated = await tx.spMarketProject.update({ where: { id: project.id }, data });
        const after = snapshotOfProject(updated, beforeCount); // 첨부는 이 라우트에서 안 바뀐다
        return writeProjectRevision(tx, project.id, request.user.mbId, true, before, after);
      });

      return {
        result: true as const,
        data: {
          projectId: Number(project.id),
          revNo: result?.revNo ?? null,
          major: result?.major ?? false,
          deadlineExtendedTo: deadlineExtendedTo === null ? null : deadlineExtendedTo.toISOString(),
        },
      };
    },
  );

  // ── GET /market/projects/:id/revisions — 수정 이력(상세를 볼 수 있으면 누구나) ──
  // 공개 범위는 설명과 같다. 첨부는 개수 변화만 담겨 있어 NDA 게이트를 새게 하지 않는다.
  fastify.get(
    '/market/projects/:id/revisions',
    { schema: { params: ProjectIdParams } },
    async (request, reply) => {
      const projectId = BigInt(request.params.id);
      const project = await prisma.spMarketProject.findUnique({ where: { id: projectId } });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      const rows = await prisma.spMarketProjectRevision.findMany({
        where: { projectId },
        orderBy: { revNo: 'asc' },
      });
      const attachmentCount = await prisma.spFile.count({
        where: { refType: REF_MARKET_PROJECT, refId: projectId },
      });
      // 변경 내역은 저장하지 않고 스냅샷 사슬에서 만든다 — rev N 의 "이후" = rev N+1 의 스냅샷,
      // 마지막 rev 의 "이후" = 현재 프로젝트. 되돌리기용 원본(스냅샷)과 화면용 문장이 어긋날 일이 없다.
      const current = snapshotOfProject(project, attachmentCount);
      const items = rows.map((r, i) => {
        const before = parseSnapshot(r.snapshot);
        const after = i + 1 < rows.length ? parseSnapshot(rows[i + 1]?.snapshot ?? null) : current;
        return {
          revNo: r.revNo,
          major: r.major,
          byOwner: r.byOwner,
          createdAt: r.createdAt.toISOString(),
          changes: before === null || after === null ? [] : diffProjectSnapshots(before, after).changes,
        };
      });
      items.reverse(); // 최신 먼저
      return { result: true as const, data: { items, total: items.length } };
    },
  );

  // ── POST /market/projects/:id/files — 소유자 첨부 추가(multipart) ───────────
  fastify.post('/market/projects/:id/files', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.badRequest('multipart/form-data 요청이어야 합니다');
    }
    const params = ProjectIdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('잘못된 경로입니다');
    const { files } = await collectMultipart(request);
    try {
      await request.jwtVerify();
    } catch {
      return reply.unauthorized('로그인이 필요합니다');
    }

    const project = await prisma.spMarketProject.findUnique({
      where: { id: BigInt(params.data.id) },
    });
    if (project === null) return reply.notFound('프로젝트가 없습니다');
    if (project.mbId !== request.user.mbId) {
      return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
    }
    const now = new Date();
    const blocked = editBlockReason(project, now);
    if (blocked !== null) {
      return reply.status(409).send({ result: false, error: blocked });
    }

    const split = splitMarketAttachments(files, toAreaCodes(project.serviceAreas));
    if (split.invalid.length > 0) {
      return reply.status(400).send({ result: false, error: 'ATTACHMENT_FIELD_INVALID' });
    }
    const attachments = split.accepted;
    if (attachments.length === 0) {
      return reply.badRequest('attachment 파일 파트가 없습니다');
    }
    let uploaded: UploadedFileType[];
    try {
      uploaded = await uploadToFileServer(
        attachments.map((f) => ({ buffer: f.buffer, filename: f.filename, mimetype: f.mimetype })),
        MARKET_FILE_SERVICE_TYPE,
      );
    } catch (err) {
      request.log.error({ err }, 'market project file upload failed');
      return reply.status(502).send({ result: false, error: 'FILE_UPLOAD_FAILED' });
    }
    // 첨부 증감도 의뢰 수정이다 — 개수 변화를 이력에 남긴다(중대 = 입찰자 경고 대상).
    // 남긴 판을 응답에 실어, 저장 직전에 첨부를 올리는 편집 화면이 PATCH 결과와 합쳐 한 번에 알린다(§11.5).
    const revision = await prisma.$transaction(async (tx) => {
      const beforeCount = await tx.spFile.count({
        where: { refType: REF_MARKET_PROJECT, refId: project.id },
      });
      await tx.spFile.createMany({
        data: uploaded.map((u, i) => ({
          refType: REF_MARKET_PROJECT,
          refId: project.id,
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
      const before = snapshotOfProject(project, beforeCount);
      const after = snapshotOfProject(project, beforeCount + uploaded.length);
      return writeProjectRevision(tx, project.id, request.user.mbId, true, before, after);
    });
    const fileRows = await projectFiles(project.id);
    return {
      result: true as const,
      data: {
        files: fileRows.map(toFileMeta),
        revNo: revision?.revNo ?? null,
        major: revision?.major ?? false,
      },
    };
  });

  // ── POST /market/projects/:id/dev-diagram — 정밀 구성도 (재)생성 요청(소유자·관리자) ────
  // 등록 시 자동으로 큐에 들어가지만 게이트 생략·실패·자료 보강 뒤 다시 돌릴 때 쓴다. 관리자는
  // 유스케이스가 꺼져 있어도 강제 실행할 수 있다(비용을 아는 사람의 수동 액션).
  fastify.post(
    '/market/projects/:id/dev-diagram',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      const isAdmin = request.user.isAdmin;
      if (project.mbId !== request.user.mbId && !isAdmin) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const queued = await requestDevDiagramForProject(project, request.log, { force: isAdmin });
      if (!queued.ok) {
        return reply.status(409).send({
          result: false,
          error: queued.reason === 'RUNNING' ? 'DEV_DIAGRAM_RUNNING' : 'USECASE_DISABLED',
        });
      }
      return { result: true as const, data: { projectId: Number(project.id), status: queued.meta.status } };
    },
  );

  // ── POST /market/projects/:id/dev-review — 검토서 재생성(소유자, docs/MARKET_FLOW.md §11.4) ──
  // 의뢰를 고치면 검토서는 "수정 전 내용" 이 된다(devReviewStale). 자동으로 다시 돌리지 않는다 —
  // 오타 한 번에 3분짜리 잡이 돌고 연속 저장이 잡을 쌓기 때문. 소유자가 원할 때만 이 라우트로 돈다.
  // 근거는 저장분에서 다시 만든다(설명·답변 + 참고 자료 실파일 텍스트·이미지) — 등록 때와 같은 집합.
  fastify.post(
    '/market/projects/:id/dev-review',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      if (project.mbId !== request.user.mbId && !request.user.isAdmin) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      // 수정과 같은 창에서만 — 마감·채택 뒤에 검토서가 바뀌면 전문가가 본 전제가 사후에 달라진다.
      const blocked = editBlockReason(project, new Date());
      if (blocked !== null) {
        return reply.status(409).send({ result: false, error: blocked });
      }
      const runtime = await getAiUsecaseRuntime(DEV_REVIEW_USECASE);
      if (!runtime.enabled) {
        return reply.status(409).send({ result: false, error: 'USECASE_DISABLED' });
      }

      const { source, images, attachmentHashes } = await buildProjectDevReviewSourceWithImages(project);
      const started = await startDevReviewJob({
        mbId: project.mbId, // 잡 소유자 = 의뢰인(관리자 대행이어도 의뢰인 것으로 남긴다)
        model: runtime.model,
        think: toOllamaThink(runtime.think),
        extraInstructions: runtime.extraInstructions,
        source,
        images,
        inputHash: devReviewInputHash({
          title: source.title,
          serviceAreas: source.serviceAreas,
          description: source.description,
          answers: source.answers,
          attachmentHashes,
        }),
        projectId: project.id, // 완료 순간 러너가 프로젝트에 박제한다
        log: request.log,
      });
      request.log.info(
        { projectId: Number(project.id), jobId: started.job.id, cached: started.cached },
        'dev review regenerate requested',
      );
      return {
        result: true as const,
        data: { projectId: Number(project.id), jobId: started.job.id, cached: started.cached },
      };
    },
  );

  // ── DELETE /market/projects/:id/files/:fileId — 소유자 첨부 삭제 ────────────
  fastify.delete(
    '/market/projects/:id/files/:fileId',
    { schema: { params: ProjectFileParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      if (project.mbId !== request.user.mbId) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      const blocked = editBlockReason(project, new Date());
      if (blocked !== null) {
        return reply.status(409).send({ result: false, error: blocked });
      }
      const file = await prisma.spFile.findFirst({
        where: {
          id: BigInt(request.params.fileId),
          refType: REF_MARKET_PROJECT,
          refId: project.id,
        },
      });
      if (file === null) return reply.notFound('파일이 없습니다');
      const beforeCount = await prisma.spFile.count({
        where: { refType: REF_MARKET_PROJECT, refId: project.id },
      });
      try {
        await deleteMarketFile(file);
      } catch (err) {
        request.log.error({ err, fileId: Number(file.id) }, 'market project file delete failed');
        return reply.status(502).send({ result: false, error: 'FILE_DELETE_FAILED' });
      }
      // 삭제는 파일서버 왕복이라 트랜잭션 밖에서 끝난다 — 이력은 그 뒤에 남긴다(실패해도 삭제는 유효).
      await writeProjectRevision(
        prisma,
        project.id,
        request.user.mbId,
        true,
        snapshotOfProject(project, beforeCount),
        snapshotOfProject(project, Math.max(0, beforeCount - 1)),
      );
      return { result: true as const, data: { fileId: Number(file.id) } };
    },
  );

  // ── POST /market/projects/:id/nda — NDA 전자서명(승인 전문가, 멱등) ─────────
  // 서명 주체 = 첨부 열람·입찰 자격자와 동일 집합(최소권한 정렬). 채택된 전문가는
  // 마감 후에도 서명 가능(작업을 위한 열람 데드락 방지).
  fastify.post(
    '/market/projects/:id/nda',
    { schema: { params: ProjectIdParams, body: MarketNdaSignBody }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      if (project.status === 'cancelled') {
        return reply.status(409).send({ result: false, error: 'NOT_AVAILABLE' });
      }
      if (!project.ndaRequired) {
        return reply.status(409).send({ result: false, error: 'NDA_NOT_REQUIRED' });
      }
      const mbId = request.user.mbId;
      const expert = await prisma.spMarketExpert.findUnique({ where: { mbId } });
      if (expert?.status !== 'approved') {
        return reply.status(403).send({ result: false, error: 'EXPERT_NOT_APPROVED' });
      }
      if (project.method === 'targeted' && project.targetExpertId !== expert.id) {
        return reply.status(403).send({ result: false, error: 'TARGETED_ONLY' });
      }
      const now = new Date();
      if (isBiddingClosed(project.status, project.bidDeadlineAt, now)) {
        const awardedExpertId = await awardedExpertIdOf(project);
        if (awardedExpertId !== expert.id) {
          return reply.status(409).send({ result: false, error: 'BIDDING_CLOSED' });
        }
      }

      try {
        const sign = await prisma.spMarketNdaSign.create({
          data: {
            projectId: project.id,
            mbId,
            textVersion: MARKET_NDA_VERSION,
            signedName: request.body.signedName,
            ip: request.ip,
          },
        });
        return {
          result: true as const,
          data: {
            projectId: Number(project.id),
            signedAt: sign.createdAt.toISOString(),
            textVersion: sign.textVersion,
          },
        };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          // 재서명 요청은 멱등 — 기존 기록을 반환한다.
          const existing = await prisma.spMarketNdaSign.findUnique({
            where: { projectId_mbId: { projectId: project.id, mbId } },
          });
          if (existing !== null) {
            return {
              result: true as const,
              data: {
                projectId: Number(project.id),
                signedAt: existing.createdAt.toISOString(),
                textVersion: existing.textVersion,
              },
            };
          }
        }
        throw err;
      }
    },
  );

  // ── GET /market/projects/:id/files/:fileId — 첨부 다운로드(NDA 게이트 실집행점) ──
  // 허용: 소유자 ∨ 관리자 ∨ (승인 전문가 ∧ (targeted→지정자) ∧ (접수 중 ∨ 채택 전문가)
  //       ∧ (NDA 불요 ∨ 서명)). 그 외 403 — 파일 실체는 파일서버 프록시 스트림.
  fastify.get(
    '/market/projects/:id/files/:fileId',
    { schema: { params: ProjectFileParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');

      const isOwner = project.mbId === request.user.mbId;
      if (!isOwner && !request.user.isAdmin) {
        const access = await expertFileAccess(project, request.user.mbId, new Date());
        if (!access.ok) {
          return reply.status(403).send({ result: false, error: access.reason });
        }
      }

      const file = await prisma.spFile.findFirst({
        where: {
          id: BigInt(request.params.fileId),
          refType: REF_MARKET_PROJECT,
          refId: project.id,
        },
        select: { pathToken: true, originFileName: true },
      });
      if (file === null) return reply.notFound('파일이 없습니다');

      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일이 없습니다');
      return reply
        .header(
          'Content-Disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .type(downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  // ── POST /market/projects/:id/close — 소유자 조기 마감 ──────────────────────
  fastify.post(
    '/market/projects/:id/close',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      if (project.mbId !== request.user.mbId) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }
      // 조건부 updateMany — 동시 채택/취소와의 레이스 방어(0건이면 상태가 이미 바뀐 것).
      const updated = await prisma.spMarketProject.updateMany({
        where: { id: project.id, status: 'bidding' },
        data: { status: 'closed' },
      });
      if (updated.count === 0) {
        return reply.status(409).send({ result: false, error: 'NOT_BIDDING' });
      }
      return {
        result: true as const,
        data: { projectId: Number(project.id), status: 'closed' as const },
      };
    },
  );

  // ── POST /market/projects/:id/cancel — 소유자 취소 ──────────────────────────
  // awarded 는 2차 계약이 걸려 있다 — 계약 pending 이면 동반 취소(카트 정리), paid 이후면
  // 409 CONTRACT_ACTIVE(취소는 계약 취소/관리자 도메인). bidding/closed 는 단순 취소.
  fastify.post(
    '/market/projects/:id/cancel',
    { schema: { params: ProjectIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const project = await prisma.spMarketProject.findUnique({
        where: { id: BigInt(request.params.id) },
      });
      if (project === null) return reply.notFound('프로젝트가 없습니다');
      if (project.mbId !== request.user.mbId) {
        return reply.status(403).send({ result: false, error: 'FORBIDDEN' });
      }

      if (project.status === 'awarded') {
        const contract = await prisma.spMarketContract.findUnique({
          where: { projectId: project.id },
        });
        if (contract !== null) {
          const c = await ensurePaidLazy(contract, request.log);
          if (c.status === 'pending') {
            // pending → 계약 동반 취소(project awarded→cancelled + 카트 정리는 tx 헬퍼가 수행).
            const cancelled = await cancelPendingContractTx(c, '의뢰인 취소');
            if (cancelled) {
              return {
                result: true as const,
                data: { projectId: Number(project.id), status: 'cancelled' as const },
              };
            }
            // 레이스: 그 사이 pending 이 아니게 됨 — 현재 상태로 재판정.
            const fresh = await prisma.spMarketContract.findUnique({ where: { id: c.id } });
            if (fresh !== null && fresh.status !== 'pending' && fresh.status !== 'cancelled') {
              return reply.status(409).send({ result: false, error: 'CONTRACT_ACTIVE' });
            }
          } else if (c.status !== 'cancelled') {
            return reply.status(409).send({ result: false, error: 'CONTRACT_ACTIVE' });
          }
        }
      }

      const updated = await prisma.spMarketProject.updateMany({
        where: { id: project.id, status: { in: ['bidding', 'closed', 'awarded'] } },
        data: { status: 'cancelled' },
      });
      if (updated.count === 0) {
        return reply.status(409).send({ result: false, error: 'NOT_CANCELLABLE' });
      }
      return {
        result: true as const,
        data: { projectId: Number(project.id), status: 'cancelled' as const },
      };
    },
  );

  // ── GET /market/my/dev-diagrams — 내 시스템 구성도 진행 목록(플로팅 위젯, §13.7) ─────────
  // 진행 중(queued·running) + 최근 24시간 안에 완료·실패·생략된 것. 소유자 전용, 본문 없음.
  fastify.get(
    '/market/my/dev-diagrams',
    { schema: { response: { 200: MyDevDiagramsResponse } }, preHandler: fastify.authenticate },
    async (request) => {
      const rows = await prisma.spMarketProject.findMany({
        where: { mbId: request.user.mbId, NOT: { devDiagram: { equals: Prisma.DbNull } } },
        orderBy: { id: 'desc' },
        take: 50,
        select: { id: true, title: true, devDiagram: true },
      });
      const since = Date.now() - 24 * 3600_000;
      const items = rows.flatMap((r) => {
        const meta = toDevDiagram(r.devDiagram);
        if (meta === null) return [];
        const active = meta.status === 'queued' || meta.status === 'running';
        const recent = new Date(meta.generatedAt ?? meta.requestedAt).getTime() >= since;
        return active || recent ? [{ projectId: Number(r.id), title: r.title, meta }] : [];
      });
      return { result: true as const, data: { items } };
    },
  );

  // ── GET /market/my/projects — 내 의뢰 목록(+채택 요약) ──────────────────────
  fastify.get(
    '/market/my/projects',
    { schema: { querystring: MarketMyProjectListQuery }, preHandler: fastify.authenticate },
    async (request) => {
      const { page, pageSize, tab } = request.query;
      const mbId = request.user.mbId;
      const where: Prisma.SpMarketProjectWhereInput = {
        mbId,
        ...(tab !== 'all' ? { status: tab } : {}),
      };
      const now = new Date();
      const [rows, total] = await Promise.all([
        prisma.spMarketProject.findMany({
          where,
          orderBy: { id: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.spMarketProject.count({ where }),
      ]);

      const [owners, bidCounts] = await Promise.all([
        marketOwnerNames([mbId]),
        marketBidCounts(rows.map((p) => p.id)),
      ]);
      // 채택 요약(있는 행만) — 입찰·전문가 표시명 조인.
      const awardedBidIds = rows
        .map((p) => p.awardedBidId)
        .filter((v): v is bigint => v !== null);
      const awardedBids =
        awardedBidIds.length > 0
          ? await prisma.spMarketBid.findMany({
              where: { id: { in: awardedBidIds } },
              select: { id: true, amount: true, expertId: true },
            })
          : [];
      const expertNames = new Map<string, string>(
        awardedBids.length > 0
          ? (
              await prisma.spMarketExpert.findMany({
                where: { id: { in: awardedBids.map((b) => b.expertId) } },
                select: { id: true, displayName: true },
              })
            ).map((e) => [e.id.toString(), e.displayName])
          : [],
      );
      const bidById = new Map(awardedBids.map((b) => [b.id.toString(), b]));
      // 계약 상태 배치 조회(N+1 금지) — 프로젝트당 1계약이라 projectId 로 매핑. lazy 승격은
      // 상세 진입 시(목록은 성능 우선).
      const contracts = await prisma.spMarketContract.findMany({
        where: { projectId: { in: rows.map((p) => p.id) } },
        select: { projectId: true, status: true },
      });
      const contractStatusByProject = new Map(
        contracts.map((c) => [c.projectId.toString(), asContractStatus(c.status)]),
      );

      const items: MarketMyProjectListItemType[] = rows.map((p) => {
        const awarded =
          p.awardedBidId !== null ? bidById.get(p.awardedBidId.toString()) : undefined;
        return {
          ...toMarketProjectListItem(
            p,
            owners.get(mbId) ?? '회원',
            bidCounts.get(p.id.toString()) ?? 0,
            now,
          ),
          awardedBid:
            awarded !== undefined
              ? {
                  bidId: Number(awarded.id),
                  amount: awarded.amount,
                  expertDisplayName: expertNames.get(awarded.expertId.toString()) ?? '',
                }
              : null,
          contractStatus: contractStatusByProject.get(p.id.toString()) ?? null,
        };
      });
      return { result: true as const, data: { items, total, page, pageSize } };
    },
  );

  done();
};
