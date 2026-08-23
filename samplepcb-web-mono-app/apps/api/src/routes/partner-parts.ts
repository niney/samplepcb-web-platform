import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  BizError,
  PartnerPartListQuery,
  PartnerPartListResponse,
  PartnerPartMutationResponse,
  PartnerPartUpdateBody,
  PartnerPartUpdateResponse,
  PartnerPartSummaryResponse,
  PartnerPartUploadCommitBody,
  PartnerPartUploadDetailResponse,
  PartnerPartUploadListResponse,
  PartnerPartUploadRemapBody,
} from '@sp/api-contract';
import { collectMultipart } from '../lib/market';
import { uploadToFileServer } from '../lib/file-server';
import {
  PARTNER_PART_ALLOWED_EXT,
  PARTNER_PART_FILE_REF_TYPE,
  PARTNER_PART_MAX_FILE_BYTES,
  PARTNER_PART_PREVIEW_ROW_LIMIT,
  PARTNER_PART_STALE_AFTER_DAYS,
  PartnerPartEditError,
  PartnerPartEngineError,
  awaitInventoryResult,
  overridesFrom,
  previewUpdateData,
  rerunUploadFromArchive,
  commitPartnerPartUpload,
  loadPartnerPartSummary,
  releaseInventoryJob,
  submitInventoryJob,
  toLedgerRows,
  toPartnerPartRow,
  previewRowsFrom,
  toPreviewRows,
  toUploadView,
  syncPartnerPartOfferToCatalog,
  updatePartnerPart,
  type EngineInventoryResultType,
  type PartnerPartUploadOverrides,
} from '../lib/partner-parts';
import { toCapabilities } from '../lib/partner';
import { prisma } from '../lib/prisma';

// ── /api/partner/parts — 협력사 보유 부품(재고표 업로드·원장) ─────────────────
// 정본 docs/PARTNER_PARTS.md. 포털의 **공통 영역**(수금과 같은 자리)이며 모듈이 아니다.
//
// 권한 축이 둘이다: requirePartner(멤버 ∧ 조직 승인)는 auth 플러그인이 보고,
// **capability `part_sale` 은 여기서 매 요청 다시 읽는다** — partnerContext 에
// capabilities 가 없고(13호 교훈: 판정 축은 '멤버 존재 ∧ 조직 승인'), 관리자가 트랙을
// 회수하면 다음 요청부터 즉시 막혀야 하기 때문이다.

const UploadIdParams = z.object({ uploadId: z.coerce.bigint() });
const PartIdParams = z.object({ partId: z.coerce.bigint() });

export const partnerPartRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requirePartner);

  /** 소속 조직 + part_sale 재확인. 반환은 (partnerId, partnerName). */
  const requirePartSale = async (
    request: { partnerContext?: { partnerId: bigint; partnerName: string } },
  ): Promise<{ partnerId: bigint; partnerName: string }> => {
    const ctx = request.partnerContext;
    if (ctx === undefined) throw fastify.httpErrors.forbidden();
    const partner = await prisma.spPartner.findUnique({
      where: { id: ctx.partnerId },
      select: { capabilities: true, status: true, name: true },
    });
    if (partner?.status !== 'approved') {
      throw fastify.httpErrors.forbidden('승인된 파트너 계정이 아닙니다');
    }
    if (!toCapabilities(partner.capabilities).includes('part_sale')) {
      throw fastify.httpErrors.forbidden('부품 판매 트랙이 부여되지 않았습니다');
    }
    return { partnerId: ctx.partnerId, partnerName: partner.name };
  };

  /**
   * 엔진 결과를 미리보기 스냅샷으로 업로드 행에 저장한다.
   *
   * ⚠ 결과 원문을 통째로 넣으면 MySQL 패킷 한도에 부딪혀 연결이 끊긴다(실측 6.36MB /
   * 12,175행). 표본 행만 담고 커밋은 원본 재실행으로 전량을 얻는다 — `previewUpdateData`.
   */
  const savePreview = async (
    uploadId: bigint,
    result: EngineInventoryResultType,
    overrides: PartnerPartUploadOverrides | undefined,
  ): Promise<void> => {
    await prisma.spPartnerPartUpload.update({
      where: { id: uploadId },
      data: previewUpdateData(result, overrides),
    });
  };

  // ── GET /api/partner/parts/summary — 포털 배너(보유 수·마지막 업로드 나이) ──
  fastify.get(
    '/partner/parts/summary',
    { schema: { response: { 200: PartnerPartSummaryResponse } } },
    async (request) => {
      const { partnerId, partnerName } = await requirePartSale(request);
      return {
        result: true as const,
        data: {
          summary: await loadPartnerPartSummary(partnerId, partnerName),
          staleAfterDays: PARTNER_PART_STALE_AFTER_DAYS,
        },
      };
    },
  );

  // ── GET /api/partner/parts — 내 원장(검색·페이지) ──────────────────────────
  fastify.get(
    '/partner/parts',
    { schema: { querystring: PartnerPartListQuery, response: { 200: PartnerPartListResponse } } },
    async (request) => {
      const { partnerId } = await requirePartSale(request);
      const { q, page, pageSize, includeInactive } = request.query;
      const where: Prisma.SpPartnerPartWhereInput = {
        partnerId,
        ...(includeInactive ? {} : { isActive: true }),
        ...(q === undefined || q.trim() === ''
          ? {}
          : {
              OR: [
                { mpn: { contains: q.trim() } },
                { mpnRaw: { contains: q.trim() } },
                { manufacturer: { contains: q.trim() } },
              ],
            }),
      };
      const [total, rows] = await Promise.all([
        prisma.spPartnerPart.count({ where }),
        prisma.spPartnerPart.findMany({
          where,
          include: { upload: { select: { createdAt: true } } },
          // 최신 회차가 위로, 회차 안에서는 파일 순서 그대로.
          // ⚠ 정렬 키 셋 전부 **수정으로 안 바뀌는 값**이다 — 품번을 고쳤다고 행이
          // 눈앞에서 다른 자리로 튀면 무엇을 고쳤는지 확인할 수가 없다.
          orderBy: [{ uploadId: 'desc' }, { sourceRow: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return {
        result: true as const,
        data: { items: rows.map(toPartnerPartRow), total, page, pageSize },
      };
    },
  );

  // ── GET /api/partner/parts/uploads — 업로드 이력 ──────────────────────────
  fastify.get(
    '/partner/parts/uploads',
    { schema: { response: { 200: PartnerPartUploadListResponse } } },
    async (request) => {
      const { partnerId } = await requirePartSale(request);
      const uploads = await prisma.spPartnerPartUpload.findMany({
        where: { partnerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const counts = await prisma.spPartnerPart.groupBy({
        by: ['uploadId'],
        where: { partnerId, isActive: true },
        _count: { _all: true },
      });
      const byUpload = new Map(counts.map((row) => [String(row.uploadId), row._count._all]));
      return {
        result: true as const,
        data: {
          items: uploads.map((upload) =>
            toUploadView(upload, byUpload.get(String(upload.id)) ?? 0),
          ),
          total: uploads.length,
        },
      };
    },
  );

  // ── POST /api/partner/parts/uploads — 재고표 업로드 → 미리보기 ─────────────
  fastify.post(
    '/partner/parts/uploads',
    { schema: { response: { 201: PartnerPartUploadDetailResponse, 502: BizError } } },
    async (request, reply) => {
      if (!request.isMultipart()) return reply.badRequest('multipart/form-data 요청이어야 합니다');
      // ⚠ multipart 본문을 먼저 소비해야 한다(@fastify/multipart 제약) — 권한 확인은 그 뒤.
      const { files } = await collectMultipart(request);
      const { partnerId } = await requirePartSale(request);
      const file = files.find((f) => f.field === 'file') ?? files[0];
      if (file === undefined) return reply.badRequest('file 파트가 없습니다');
      const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
      if (!PARTNER_PART_ALLOWED_EXT.has(ext)) {
        return reply.badRequest('지원하지 않는 파일 형식입니다 (xlsx/xlsm/xls/csv/tsv/bom)');
      }
      if (file.buffer.length > PARTNER_PART_MAX_FILE_BYTES) {
        return reply.badRequest('파일이 50MB 를 초과합니다');
      }
      // 동시 업로드 1건 — 미리보기 상태가 겹치면 어느 회차를 커밋하는지 모호해진다.
      const pending = await prisma.spPartnerPartUpload.count({
        where: { partnerId, status: { in: ['parsing', 'preview'] } },
      });
      if (pending > 0) {
        return reply.conflict('확인 대기 중인 업로드가 있습니다. 먼저 반영하거나 취소하세요.');
      }

      const upload = await prisma.spPartnerPartUpload.create({
        data: {
          partnerId,
          fileName: file.filename.slice(0, 255),
          fileSize: BigInt(file.buffer.length),
          status: 'parsing',
          uploadedBy: 'PARTNER',
          uploadedById: request.user.mbId,
        },
      });

      try {
        const jobId = await submitInventoryJob(file);
        await prisma.spPartnerPartUpload.update({
          where: { id: upload.id },
          data: { engineJobId: jobId },
        });
        const result = await awaitInventoryResult(jobId);
        void releaseInventoryJob(jobId);

        // 원본 보존은 **필수** — 커밋과 [다시 분석]이 보관본을 다시 돌려 전량을 얻는다.
        // (미리보기는 패킷 한도 때문에 표본만 들고 있다.) 보관에 실패하면 되돌릴 수 없는
        // 막다른 길이 되므로 업로드 자체를 실패로 끝낸다.
        const [stored] = await uploadToFileServer(
          [{ buffer: file.buffer, filename: file.filename, mimetype: file.mimetype }],
          'bom',
        );
        if (stored === undefined) {
          throw new PartnerPartEngineError('BOM_ENGINE_ERROR', '원본 파일을 보관하지 못했습니다');
        }
        const savedFile = await prisma.spFile.create({
          data: {
            refType: PARTNER_PART_FILE_REF_TYPE,
            refId: upload.id,
            uploadFileName: stored.uploadFileName,
            originFileName: stored.originFileName,
            pathToken: stored.pathToken,
            size: BigInt(stored.size),
            writeDate: new Date(),
            fileType: 'bom',
            uploadedBy: 'PARTNER',
          },
        });
        await prisma.spPartnerPartUpload.update({
          where: { id: upload.id },
          data: { fileId: savedFile.id },
        });
        await savePreview(upload.id, result, undefined);

        const saved = await prisma.spPartnerPartUpload.findUniqueOrThrow({
          where: { id: upload.id },
        });
        return await reply.status(201).send({
          result: true as const,
          data: {
            upload: toUploadView(saved, 0),
            rows: toPreviewRows(result),
            rowSampleLimit: PARTNER_PART_PREVIEW_ROW_LIMIT,
          },
        });
      } catch (error) {
        const code =
          error instanceof PartnerPartEngineError ? error.code : 'BOM_ENGINE_ERROR';
        await prisma.spPartnerPartUpload.update({
          where: { id: upload.id },
          data: {
            status: 'failed',
            error: error instanceof Error ? error.message.slice(0, 500) : '추출 실패',
          },
        });
        return await reply.status(502).send({ result: false as const, error: code });
      }
    },
  );

  // ── GET /api/partner/parts/uploads/:uploadId — 미리보기 상세 ───────────────
  fastify.get(
    '/partner/parts/uploads/:uploadId',
    {
      schema: {
        params: UploadIdParams,
        response: { 200: PartnerPartUploadDetailResponse },
      },
    },
    async (request) => {
      const { partnerId } = await requirePartSale(request);
      const upload = await prisma.spPartnerPartUpload.findFirst({
        where: { id: request.params.uploadId, partnerId },
      });
      if (upload === null) throw fastify.httpErrors.notFound('업로드를 찾을 수 없습니다');
      const activeCount = await prisma.spPartnerPart.count({
        where: { uploadId: upload.id, isActive: true },
      });
      return {
        result: true as const,
        data: {
          upload: toUploadView(upload, activeCount),
          rows: previewRowsFrom(upload.previewJson),
          rowSampleLimit: PARTNER_PART_PREVIEW_ROW_LIMIT,
        },
      };
    },
  );

  // ── POST /api/partner/parts/uploads/:uploadId/remap — 열 역할 교정 후 재추출 ─
  fastify.post(
    '/partner/parts/uploads/:uploadId/remap',
    {
      schema: {
        params: UploadIdParams,
        body: PartnerPartUploadRemapBody,
        response: { 200: PartnerPartUploadDetailResponse, 502: BizError },
      },
    },
    async (request, reply) => {
      const { partnerId } = await requirePartSale(request);
      const upload = await prisma.spPartnerPartUpload.findFirst({
        where: { id: request.params.uploadId, partnerId, status: { in: ['preview', 'failed'] } },
      });
      if (upload === null) {
        throw fastify.httpErrors.notFound('확인 대기 중인 업로드가 아닙니다');
      }
      const roleOverrides: Record<string, Record<string, string>> = {};
      for (const entry of request.body.roleOverrides) {
        const sheet = String(entry.sheetIndex);
        roleOverrides[sheet] = { ...roleOverrides[sheet], [String(entry.column1Based)]: entry.role };
      }
      const headerRowOverrides: Record<string, number> = {};
      for (const entry of request.body.headerRowOverrides ?? []) {
        headerRowOverrides[String(entry.sheetIndex)] = entry.headerRow1Based;
      }
      const overrides = { roleOverrides, headerRowOverrides };

      try {
        // 보관본을 같은 교정으로 다시 돌린다 — 커밋도 같은 경로를 쓴다(스냅샷은 표본뿐).
        const result = await rerunUploadFromArchive(upload, overrides);
        await savePreview(upload.id, result, overrides);
        const saved = await prisma.spPartnerPartUpload.findUniqueOrThrow({
          where: { id: upload.id },
        });
        return await reply.send({
          result: true as const,
          data: {
            upload: toUploadView(saved, 0),
            rows: toPreviewRows(result),
            rowSampleLimit: PARTNER_PART_PREVIEW_ROW_LIMIT,
          },
        });
      } catch (error) {
        const code = error instanceof PartnerPartEngineError ? error.code : 'BOM_ENGINE_ERROR';
        return await reply.status(502).send({ result: false as const, error: code });
      }
    },
  );

  // ── POST /api/partner/parts/uploads/:uploadId/commit — 원장 반영 ───────────
  fastify.post(
    '/partner/parts/uploads/:uploadId/commit',
    {
      schema: {
        params: UploadIdParams,
        body: PartnerPartUploadCommitBody,
        response: { 200: PartnerPartMutationResponse },
      },
    },
    async (request) => {
      const { partnerId } = await requirePartSale(request);
      const upload = await prisma.spPartnerPartUpload.findFirst({
        where: { id: request.params.uploadId, partnerId, status: 'preview' },
      });
      if (upload === null) throw fastify.httpErrors.notFound('확인 대기 중인 업로드가 아닙니다');
      // 전량은 보관본 재실행으로 얻는다 — 미리보기 스냅샷은 표본뿐(패킷 한도).
      const result = await rerunUploadFromArchive(upload, overridesFrom(upload.mappingJson));
      const rows = toLedgerRows(result);
      if (rows.length === 0) throw fastify.httpErrors.conflict('저장할 품번이 없습니다');
      const affected = await commitPartnerPartUpload(
        upload.id,
        partnerId,
        request.body.mode,
        rows,
      );
      return { result: true as const, data: { affected } };
    },
  );

  // ── DELETE /api/partner/parts/uploads/:uploadId — 확인 대기 회차 취소 ───────
  fastify.delete(
    '/partner/parts/uploads/:uploadId',
    { schema: { params: UploadIdParams, response: { 200: PartnerPartMutationResponse } } },
    async (request) => {
      const { partnerId } = await requirePartSale(request);
      const deleted = await prisma.spPartnerPartUpload.deleteMany({
        where: {
          id: request.params.uploadId,
          partnerId,
          status: { in: ['preview', 'failed', 'parsing'] },
        },
      });
      if (deleted.count === 0) {
        throw fastify.httpErrors.conflict('반영된 회차는 취소할 수 없습니다');
      }
      return { result: true as const, data: { affected: deleted.count } };
    },
  );

  // ── PATCH /api/partner/parts/:partId — 내 원장 행 수정 ─────────────────────
  // 오타 품번·빠진 제조사·바뀐 재고를 전체 재업로드 없이 한 줄만 고친다.
  fastify.patch(
    '/partner/parts/:partId',
    {
      schema: {
        params: PartIdParams,
        body: PartnerPartUpdateBody,
        response: { 200: PartnerPartUpdateResponse },
      },
    },
    async (request) => {
      const { partnerId } = await requirePartSale(request);
      const owned = await prisma.spPartnerPart.findFirst({
        where: { id: request.params.partId, partnerId },
        select: { id: true },
      });
      if (owned === null) throw fastify.httpErrors.notFound('부품을 찾을 수 없습니다');
      try {
        const part = await updatePartnerPart(owned.id, request.body, request.user.mbId);
        if (part === null) throw fastify.httpErrors.notFound('부품을 찾을 수 없습니다');
        return { result: true as const, data: { part } };
      } catch (error) {
        if (error instanceof PartnerPartEditError) {
          throw fastify.httpErrors.badRequest(error.message);
        }
        throw error;
      }
    },
  );

  // ── DELETE /api/partner/parts/:partId — 내 원장 행 삭제 ────────────────────
  fastify.delete(
    '/partner/parts/:partId',
    { schema: { params: PartIdParams, response: { 200: PartnerPartMutationResponse } } },
    async (request) => {
      const { partnerId } = await requirePartSale(request);
      const part = await prisma.spPartnerPart.findFirst({
        where: { id: request.params.partId, partnerId },
        select: { id: true },
      });
      if (part === null) throw fastify.httpErrors.notFound('부품을 찾을 수 없습니다');
      await prisma.spPartnerPartKey.deleteMany({ where: { partId: part.id } });
      await prisma.spPartnerPart.delete({ where: { id: part.id } });
      await syncPartnerPartOfferToCatalog(part.id);
      return { result: true as const, data: { affected: 1 } };
    },
  );

  done();
};
