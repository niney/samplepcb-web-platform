import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { Prisma } from '@prisma/client';
import type { SpFile, SpMarketExpert } from '@prisma/client';
import { z } from 'zod';
import {
  MarketExpertListQuery,
  MarketExpertRegisterPayload,
  MarketExpertUpdatePayload,
} from '@sp/api-contract';
import type { MarketExpertMeType, MarketExpertPublicType } from '@sp/api-contract';
import { deleteFromFileServer, uploadToFileServer } from '../lib/file-server';
import type { UploadedFileType } from '../lib/file-server';
import {
  MARKET_FILE_SERVICE_TYPE,
  REF_MARKET_EXPERT,
  asCareerRange,
  asExpertStatus,
  asExpertType,
  asRegionOrNull,
  asTravelRangeOrNull,
  collectMultipart,
  deleteMarketFile,
  toCadCodes,
  toCategoryCodes,
  toFileMeta,
  toServiceAreaCodes,
} from '../lib/market';
import type { MarketReceivedFile } from '../lib/market';
import { prisma } from '../lib/prisma';

// ── /api/market/experts — 전문가 등록·본인 관리·공개 프로필 ──────────────────
// 등록(개인/기업, 증빙 multipart) → 관리자 승인(admin-market-experts) → 활동(approved).
// 공개 목록·상세는 비로그인 열람 가능(프로토타입의 마케팅 표면 — 약관에 프로필 공개 동의
// 포함). 연락처·계좌·mbId 는 공개 응답 DTO 에 아예 담지 않는다(블라인드 원칙).
// 에러 봉투는 회원 라우트 관례(pcb-projects): { result:false, error:'CODE' }.

const ExpertIdParams = z.object({ id: z.string().regex(/^\d+$/) });
const FileIdParams = z.object({ fileId: z.string().regex(/^\d+$/) });

// 전문가 증빙 파일의 multipart 필드 화이트리스트(= sp_file.fileType 저장값).
const EXPERT_FILE_FIELDS = new Set(['license', 'portfolio', 'bizreg']);

type ExpertFileRow = Pick<SpFile, 'id' | 'fileType' | 'originFileName' | 'size'>;

const expertFiles = (expertId: bigint): Promise<ExpertFileRow[]> =>
  prisma.spFile.findMany({
    where: { refType: REF_MARKET_EXPERT, refId: expertId },
    orderBy: { id: 'asc' },
    select: { id: true, fileType: true, originFileName: true, size: true },
  });

// 본인 조회 DTO — 계좌 포함(본인 전용). 타인 응답에는 절대 재사용하지 않는다.
const toExpertMe = (e: SpMarketExpert, files: ExpertFileRow[]): MarketExpertMeType => ({
  expertId: Number(e.id),
  expertType: asExpertType(e.expertType),
  displayName: e.displayName,
  phone: e.phone,
  identityVerified: e.identityVerified,
  careerRange: asCareerRange(e.careerRange),
  contactHours: e.contactHours,
  region: asRegionOrNull(e.region),
  travelRange: asTravelRangeOrNull(e.travelRange),
  intro: e.intro,
  serviceAreas: toServiceAreaCodes(e.serviceAreas),
  categories: toCategoryCodes(e.categories),
  cadTools: toCadCodes(e.cadTools),
  bankName: e.bankName,
  bankHolder: e.bankHolder,
  bankAccount: e.bankAccount,
  status: asExpertStatus(e.status),
  statusReason: e.statusReason,
  decidedAt: e.decidedAt?.toISOString() ?? null,
  createdAt: e.createdAt.toISOString(),
  files: files.map(toFileMeta),
});

// 공개 프로필 DTO — 연락처·계좌·mbId 없음(필드를 안 만드는 것이 곧 보호).
const toExpertPublic = (e: SpMarketExpert): MarketExpertPublicType => ({
  expertId: Number(e.id),
  displayName: e.displayName,
  expertType: asExpertType(e.expertType),
  careerRange: asCareerRange(e.careerRange),
  region: asRegionOrNull(e.region),
  serviceAreas: toServiceAreaCodes(e.serviceAreas),
  categories: toCategoryCodes(e.categories),
  cadTools: toCadCodes(e.cadTools),
  intro: e.intro,
});

// 지정 1번(당사)→2번(기업)→3번(개인) 순 정렬값.
const expertTypeOrder = (t: string): number => (t === 'house' ? 0 : t === 'company' ? 1 : 2);

export const marketExpertRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // ── POST /market/experts — 전문가 등록(multipart: payload + license[]/portfolio[]/bizreg) ──
  fastify.post('/market/experts', async (request, reply) => {
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
    const parsed = MarketExpertRegisterPayload.safeParse(payloadJson);
    if (!parsed.success) {
      return reply.status(400).send({
        result: false,
        error: 'PAYLOAD_SCHEMA_MISMATCH',
        issues: parsed.error.issues,
      });
    }
    const payload = parsed.data;

    const evidences: MarketReceivedFile[] = files.filter((f) => EXPERT_FILE_FIELDS.has(f.field));
    // 기업(파트너사)은 사업자등록증 필수 — PPTX 기획 "프리랜서 사업자등록증 필수"는
    // 2026 프로토타입에서 기업 한정으로 완화된 것을 따른다.
    if (payload.expertType === 'company' && !evidences.some((f) => f.field === 'bizreg')) {
      return reply.status(400).send({ result: false, error: 'BIZREG_REQUIRED' });
    }

    const existing = await prisma.spMarketExpert.findUnique({ where: { mbId } });
    if (existing !== null) {
      // 반려 상태의 재제출은 PATCH /market/experts/me 로(같은 행 수정).
      return reply.status(409).send({ result: false, error: 'ALREADY_APPLIED' });
    }

    let uploaded: UploadedFileType[] = [];
    if (evidences.length > 0) {
      try {
        uploaded = await uploadToFileServer(
          evidences.map((f) => ({ buffer: f.buffer, filename: f.filename, mimetype: f.mimetype })),
          MARKET_FILE_SERVICE_TYPE,
        );
      } catch (err) {
        request.log.error({ err }, 'market expert file upload failed');
        return reply.status(502).send({ result: false, error: 'FILE_UPLOAD_FAILED' });
      }
    }

    const now = new Date();
    let expert: SpMarketExpert;
    try {
      expert = await prisma.$transaction(async (tx) => {
        const e = await tx.spMarketExpert.create({
          data: {
            mbId,
            expertType: payload.expertType,
            displayName: payload.displayName,
            phone: payload.phone,
            careerRange: payload.careerRange,
            contactHours: payload.contactHours ?? null,
            region: payload.region ?? null,
            travelRange: payload.travelRange ?? null,
            intro: payload.intro,
            serviceAreas: payload.serviceAreas,
            categories: payload.categories,
            cadTools: payload.cadTools,
            bankName: payload.bankName,
            bankHolder: payload.bankHolder,
            bankAccount: payload.bankAccount,
            termsAgreedAt: now,
          },
        });
        if (uploaded.length > 0) {
          await tx.spFile.createMany({
            data: uploaded.map((u, i) => ({
              refType: REF_MARKET_EXPERT,
              refId: e.id,
              uploadFileName: u.uploadFileName,
              originFileName: u.originFileName,
              pathToken: u.pathToken,
              size: BigInt(u.size),
              writeDate: now,
              fileType: evidences[i]?.field ?? null, // license | portfolio | bizreg
            })),
          });
        }
        return e;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // mbId unique 레이스(동시 이중 제출) — 업로드된 실파일 고아 방지 베스트에포트 정리
        await Promise.all(
          uploaded.map((u) => deleteFromFileServer(u.pathToken).catch(() => undefined)),
        );
        return reply.status(409).send({ result: false, error: 'ALREADY_APPLIED' });
      }
      throw err;
    }

    request.log.info(
      { expertId: Number(expert.id), mbId, expertType: payload.expertType },
      'market expert registered',
    );
    return {
      result: true as const,
      data: { expertId: Number(expert.id), status: 'pending' as const },
    };
  });

  // ── GET /market/experts/me — 본인 프로필(계좌 포함) ─────────────────────────
  fastify.get('/market/experts/me', { preHandler: fastify.authenticate }, async (request, reply) => {
    const expert = await prisma.spMarketExpert.findUnique({
      where: { mbId: request.user.mbId },
    });
    if (expert === null) {
      return reply.status(404).send({ result: false, error: 'NOT_REGISTERED' });
    }
    const files = await expertFiles(expert.id);
    return { result: true as const, data: toExpertMe(expert, files) };
  });

  // ── PATCH /market/experts/me — 본인 수정(multipart, 재제출 겸용) ────────────
  // pending·rejected 에서만 허용(approved 프로필 수정·재승인 플로우는 2차).
  // rejected → 저장 시 pending 으로 재제출(사유·처리자 초기화).
  fastify.patch('/market/experts/me', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.badRequest('multipart/form-data 요청이어야 합니다');
    }
    const { files, rawPayload } = await collectMultipart(request);
    try {
      await request.jwtVerify();
    } catch {
      return reply.unauthorized('로그인이 필요합니다');
    }

    const expert = await prisma.spMarketExpert.findUnique({
      where: { mbId: request.user.mbId },
    });
    if (expert === null) {
      return reply.status(404).send({ result: false, error: 'NOT_REGISTERED' });
    }
    if (expert.status !== 'pending' && expert.status !== 'rejected') {
      return reply.status(409).send({ result: false, error: 'NOT_EDITABLE' });
    }

    let payloadJson: unknown = {};
    if (rawPayload !== undefined) {
      try {
        payloadJson = JSON.parse(rawPayload);
      } catch {
        return reply.badRequest('payload 가 유효한 JSON 이 아닙니다');
      }
    }
    const parsed = MarketExpertUpdatePayload.safeParse(payloadJson);
    if (!parsed.success) {
      return reply.status(400).send({
        result: false,
        error: 'PAYLOAD_SCHEMA_MISMATCH',
        issues: parsed.error.issues,
      });
    }
    const payload = parsed.data;

    // 추가 증빙 업로드(선택) — 기존 파일 삭제는 DELETE /market/experts/me/files/:fileId.
    const evidences: MarketReceivedFile[] = files.filter((f) => EXPERT_FILE_FIELDS.has(f.field));
    let uploaded: UploadedFileType[] = [];
    if (evidences.length > 0) {
      try {
        uploaded = await uploadToFileServer(
          evidences.map((f) => ({ buffer: f.buffer, filename: f.filename, mimetype: f.mimetype })),
          MARKET_FILE_SERVICE_TYPE,
        );
      } catch (err) {
        request.log.error({ err }, 'market expert file upload failed');
        return reply.status(502).send({ result: false, error: 'FILE_UPLOAD_FAILED' });
      }
    }

    const data: Prisma.SpMarketExpertUpdateInput = {};
    if (payload.displayName !== undefined) data.displayName = payload.displayName;
    if (payload.phone !== undefined) data.phone = payload.phone;
    if (payload.careerRange !== undefined) data.careerRange = payload.careerRange;
    if (payload.contactHours !== undefined)
      data.contactHours = payload.contactHours === '' ? null : payload.contactHours;
    if (payload.region !== undefined) data.region = payload.region;
    if (payload.travelRange !== undefined) data.travelRange = payload.travelRange;
    if (payload.intro !== undefined) data.intro = payload.intro;
    if (payload.serviceAreas !== undefined) data.serviceAreas = payload.serviceAreas;
    if (payload.categories !== undefined) data.categories = payload.categories;
    if (payload.cadTools !== undefined) data.cadTools = payload.cadTools;
    if (payload.bankName !== undefined) data.bankName = payload.bankName;
    if (payload.bankHolder !== undefined) data.bankHolder = payload.bankHolder;
    if (payload.bankAccount !== undefined) data.bankAccount = payload.bankAccount;
    if (expert.status === 'rejected') {
      data.status = 'pending'; // 재제출
      data.statusReason = null;
      data.decidedBy = null;
      data.decidedAt = null;
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
      const e = await tx.spMarketExpert.update({ where: { id: expert.id }, data });
      if (uploaded.length > 0) {
        await tx.spFile.createMany({
          data: uploaded.map((u, i) => ({
            refType: REF_MARKET_EXPERT,
            refId: expert.id,
            uploadFileName: u.uploadFileName,
            originFileName: u.originFileName,
            pathToken: u.pathToken,
            size: BigInt(u.size),
            writeDate: now,
            fileType: evidences[i]?.field ?? null,
          })),
        });
      }
      return e;
    });

    const fileRows = await expertFiles(expert.id);
    return { result: true as const, data: toExpertMe(updated, fileRows) };
  });

  // ── DELETE /market/experts/me/files/:fileId — 본인 증빙 삭제 ────────────────
  fastify.delete(
    '/market/experts/me/files/:fileId',
    { schema: { params: FileIdParams }, preHandler: fastify.authenticate },
    async (request, reply) => {
      const expert = await prisma.spMarketExpert.findUnique({
        where: { mbId: request.user.mbId },
      });
      if (expert === null) {
        return reply.status(404).send({ result: false, error: 'NOT_REGISTERED' });
      }
      if (expert.status !== 'pending' && expert.status !== 'rejected') {
        return reply.status(409).send({ result: false, error: 'NOT_EDITABLE' });
      }
      const file = await prisma.spFile.findFirst({
        where: {
          id: BigInt(request.params.fileId),
          refType: REF_MARKET_EXPERT,
          refId: expert.id,
        },
      });
      if (file === null) return reply.notFound('파일이 없습니다');
      try {
        await deleteMarketFile(file);
      } catch (err) {
        request.log.error({ err, fileId: Number(file.id) }, 'market expert file delete failed');
        return reply.status(502).send({ result: false, error: 'FILE_DELETE_FAILED' });
      }
      return { result: true as const, data: { fileId: Number(file.id) } };
    },
  );

  // ── GET /market/experts — 공개 목록(비로그인 열람 가능) ─────────────────────
  // approved(+당사 house)만. 소규모(수십~수백) 전제의 앱단 필터·정렬(설계 결정).
  fastify.get(
    '/market/experts',
    { schema: { querystring: MarketExpertListQuery } },
    async (request) => {
      const { page, pageSize, expertType, serviceArea, category, cadTool, q } = request.query;
      const rows = await prisma.spMarketExpert.findMany({ where: { status: 'approved' } });

      const keyword = q?.trim().toLowerCase();
      const filtered = rows.filter((e) => {
        if (expertType !== undefined && asExpertType(e.expertType) !== expertType) return false;
        if (serviceArea !== undefined && !toServiceAreaCodes(e.serviceAreas).includes(serviceArea))
          return false;
        if (category !== undefined && !toCategoryCodes(e.categories).includes(category))
          return false;
        if (cadTool !== undefined && !toCadCodes(e.cadTools).includes(cadTool)) return false;
        if (keyword !== undefined && keyword !== '') {
          const hay = `${e.displayName} ${e.intro ?? ''}`.toLowerCase();
          if (!hay.includes(keyword)) return false;
        }
        return true;
      });
      filtered.sort((a, b) => {
        const order = expertTypeOrder(a.expertType) - expertTypeOrder(b.expertType);
        if (order !== 0) return order;
        return Number(a.id - b.id);
      });

      const total = filtered.length;
      const items = filtered.slice((page - 1) * pageSize, page * pageSize).map(toExpertPublic);
      return { result: true as const, data: { items, total, page, pageSize } };
    },
  );

  // ── GET /market/experts/:id — 공개 프로필 상세 ──────────────────────────────
  fastify.get(
    '/market/experts/:id',
    { schema: { params: ExpertIdParams } },
    async (request, reply) => {
      const expert = await prisma.spMarketExpert.findFirst({
        where: { id: BigInt(request.params.id), status: 'approved' },
      });
      if (expert === null) return reply.notFound('전문가가 없습니다');
      return { result: true as const, data: toExpertPublic(expert) };
    },
  );

  done();
};
