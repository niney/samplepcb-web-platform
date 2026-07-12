import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import type { SpFile, SpMarketExpert, SpMarketProject } from '@prisma/client';
import { z } from 'zod';
import {
  JwtClaims,
  MARKET_NDA_TEXT,
  MARKET_NDA_VERSION,
  MarketMyProjectListQuery,
  MarketNdaSignBody,
  MarketProjectCreatePayload,
  MarketProjectListQuery,
  MarketProjectUpdateBody,
} from '@sp/api-contract';
import type {
  JwtClaimsType,
  MarketMyProjectListItemType,
  MarketProjectViewerType,
} from '@sp/api-contract';
import { parseDiagramSpecString } from '../lib/ai/usecases';
import { downloadFromFileServer, uploadToFileServer } from '../lib/file-server';
import type { UploadedFileType } from '../lib/file-server';
import { getMembersByIds } from '../lib/g5-db';
import { kstDateTimeStr } from '../lib/kst';
import { buildTargetedRequestEmail, sendMarketMail } from '../lib/market-email';
import {
  MARKET_FILE_SERVICE_TYPE,
  REF_MARKET_PROJECT,
  asBidStatus,
  asRequestType,
  collectMultipart,
  deadlineToDate,
  deleteMarketFile,
  isBiddingClosed,
  marketBidCounts,
  marketOwnerNames,
  toFileMeta,
  toMarketProjectListItem,
  toServiceAreaCodes,
} from '../lib/market';
import type { MarketReceivedFile } from '../lib/market';
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

type ProjectFileRow = Pick<SpFile, 'id' | 'fileType' | 'originFileName' | 'size'>;

const projectFiles = (projectId: bigint): Promise<ProjectFileRow[]> =>
  prisma.spFile.findMany({
    where: { refType: REF_MARKET_PROJECT, refId: projectId },
    orderBy: { id: 'asc' },
    select: { id: true, fileType: true, originFileName: true, size: true },
  });

// 채택된 입찰의 전문가 id(없으면 null) — 채택 후 접근 유지 판정에 쓴다.
const awardedExpertIdOf = async (p: SpMarketProject): Promise<bigint | null> => {
  if (p.status !== 'awarded' || p.awardedBidId === null) return null;
  const awarded = await prisma.spMarketBid.findUnique({
    where: { id: p.awardedBidId },
    select: { expertId: true },
  });
  return awarded?.expertId ?? null;
};

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

// 소유자 수정 가드 — 입찰 접수 중 && 입찰 0건(≠withdrawn)일 때만.
// (입찰자가 본 조건의 사후 변경은 공정성 훼손 — 설계 결정)
const editBlockReason = async (
  p: SpMarketProject,
  now: Date,
): Promise<'NOT_EDITABLE' | 'HAS_BIDS' | null> => {
  if (isBiddingClosed(p.status, p.bidDeadlineAt, now)) return 'NOT_EDITABLE';
  const bids = await prisma.spMarketBid.count({
    where: { projectId: p.id, status: { not: 'withdrawn' } },
  });
  return bids > 0 ? 'HAS_BIDS' : null;
};

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

    const now = new Date();
    const bidDeadlineAt = deadlineToDate(payload.deadline, now);
    if (bidDeadlineAt.getTime() <= now.getTime()) {
      return reply.status(400).send({ result: false, error: 'DEADLINE_PAST' });
    }

    // 구성 명세 JSON — 우리 AI 산출이 정상 경로지만 클라이언트 입력이므로 재검증하고,
    // 정규화 직렬화본으로 저장한다(이관 specJson _legacy 교훈: 저장 전 형태 통제).
    let normalizedDiagramSpec: string | null = null;
    if (payload.diagramSpec !== undefined) {
      try {
        normalizedDiagramSpec = JSON.stringify(parseDiagramSpecString(payload.diagramSpec));
      } catch {
        return reply.status(400).send({ result: false, error: 'INVALID_DIAGRAM_SPEC' });
      }
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
    const attachments: MarketReceivedFile[] = files.filter((f) => f.field === 'attachment');
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
          requestType: payload.requestType,
          serviceAreas: payload.serviceAreas,
          categories: payload.categories,
          cadTools: payload.cadTools,
          description: payload.description,
          diagramHtml: payload.diagramHtml ?? null,
          diagramSpec: normalizedDiagramSpec,
          ndaRequired: payload.ndaRequired,
          budgetRange: payload.budgetRange,
          startHopeDate: payload.startHopeDate ?? null,
          dueHopeDate: payload.dueHopeDate ?? null,
          bidDeadlineAt,
          method: payload.method,
          targetExpertId: targetExpert?.id ?? null,
        },
      });
      if (uploaded.length > 0) {
        await tx.spFile.createMany({
          data: uploaded.map((u) => ({
            refType: REF_MARKET_PROJECT,
            refId: p.id,
            uploadFileName: u.uploadFileName,
            originFileName: u.originFileName,
            pathToken: u.pathToken,
            size: BigInt(u.size),
            writeDate: now,
            fileType: 'attachment',
          })),
        });
      }
      return p;
    });

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
      const { page, pageSize, tab, requestType, serviceArea, method, q, sort } = request.query;
      const now = new Date();

      const base: Prisma.SpMarketProjectWhereInput = {
        ...(requestType !== undefined ? { requestType } : {}),
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
          diagramHtml: project.diagramHtml,
          diagramSpec: project.diagramSpec,
          startHopeDate: project.startHopeDate,
          dueHopeDate: project.dueHopeDate,
          awardedAt: project.awardedAt?.toISOString() ?? null,
          attachments: {
            count: fileRows.length,
            files: filesVisible ? fileRows.map(toFileMeta) : null,
          },
          ndaText: MARKET_NDA_TEXT,
          ndaTextVersion: MARKET_NDA_VERSION,
          viewer,
        },
      };
    },
  );

  // ── PATCH /market/projects/:id — 소유자 수정(입찰 0건·접수 중일 때만) ───────
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
      const blocked = await editBlockReason(project, now);
      if (blocked !== null) {
        return reply.status(409).send({ result: false, error: blocked });
      }

      const body = request.body;
      const nextRequestType = body.requestType ?? asRequestType(project.requestType);
      const nextServiceAreas = body.serviceAreas ?? toServiceAreaCodes(project.serviceAreas);
      if (nextRequestType === 'individual' && nextServiceAreas.length !== 1) {
        return reply.status(400).send({ result: false, error: 'INDIVIDUAL_AREA_REQUIRED' });
      }
      const data: Prisma.SpMarketProjectUpdateInput = {};
      if (body.title !== undefined) data.title = body.title;
      if (body.requestType !== undefined) data.requestType = body.requestType;
      if (body.serviceAreas !== undefined) data.serviceAreas = body.serviceAreas;
      if (body.categories !== undefined) data.categories = body.categories;
      if (body.cadTools !== undefined) data.cadTools = body.cadTools;
      if (body.description !== undefined) data.description = body.description;
      if (body.diagramHtml !== undefined) data.diagramHtml = body.diagramHtml;
      if (body.diagramSpec !== undefined && body.diagramSpec !== null) {
        try {
          data.diagramSpec = JSON.stringify(parseDiagramSpecString(body.diagramSpec));
        } catch {
          return reply.status(400).send({ result: false, error: 'INVALID_DIAGRAM_SPEC' });
        }
      }
      // 구성도 제거(diagramHtml=null) 시 spec 을 명시하지 않았으면 함께 제거 — 원천
      // 데이터만 남아 상세·후속 문서가 지워진 구성도를 되살리는 혼란을 막는다.
      if (body.diagramSpec === null || (body.diagramHtml === null && body.diagramSpec === undefined)) {
        data.diagramSpec = null;
      }
      if (body.ndaRequired !== undefined) data.ndaRequired = body.ndaRequired;
      if (body.budgetRange !== undefined) data.budgetRange = body.budgetRange;
      if (body.startHopeDate !== undefined) data.startHopeDate = body.startHopeDate;
      if (body.dueHopeDate !== undefined) data.dueHopeDate = body.dueHopeDate;
      if (body.deadline !== undefined) {
        const next = deadlineToDate(body.deadline, now);
        if (next.getTime() <= now.getTime()) {
          return reply.status(400).send({ result: false, error: 'DEADLINE_PAST' });
        }
        data.bidDeadlineAt = next;
      }

      const updated = await prisma.spMarketProject.update({ where: { id: project.id }, data });
      return { result: true as const, data: { projectId: Number(updated.id) } };
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
    const blocked = await editBlockReason(project, now);
    if (blocked !== null) {
      return reply.status(409).send({ result: false, error: blocked });
    }

    const attachments = files.filter((f) => f.field === 'attachment');
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
    await prisma.spFile.createMany({
      data: uploaded.map((u) => ({
        refType: REF_MARKET_PROJECT,
        refId: project.id,
        uploadFileName: u.uploadFileName,
        originFileName: u.originFileName,
        pathToken: u.pathToken,
        size: BigInt(u.size),
        writeDate: now,
        fileType: 'attachment',
      })),
    });
    const fileRows = await projectFiles(project.id);
    return { result: true as const, data: { files: fileRows.map(toFileMeta) } };
  });

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
      const blocked = await editBlockReason(project, new Date());
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
      try {
        await deleteMarketFile(file);
      } catch (err) {
        request.log.error({ err, fileId: Number(file.id) }, 'market project file delete failed');
        return reply.status(502).send({ result: false, error: 'FILE_DELETE_FAILED' });
      }
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
