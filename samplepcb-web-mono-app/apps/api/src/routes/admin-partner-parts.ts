import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  AdminPartnerPartBulkBody,
  AdminPartnerPartSummaryListResponse,
  AdminPartnerPartToggleBody,
  BizError,
  PartnerPartListQuery,
  PartnerPartListResponse,
  PartnerPartMutationResponse,
  PartnerPartUpdateBody,
  PartnerPartUpdateResponse,
  PartnerPartUploadCommitBody,
  PartnerPartUploadDetailResponse,
  PartnerPartUploadListResponse,
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
  ageDaysFrom,
  awaitInventoryResult,
  overridesFrom,
  previewUpdateData,
  rerunUploadFromArchive,
  commitPartnerPartUpload,
  releaseInventoryJob,
  submitInventoryJob,
  toLedgerRows,
  toPartnerPartRow,
  toPreviewRows,
  toUploadView,
  updatePartnerPart,
} from '../lib/partner-parts';
import { prisma } from '../lib/prisma';

// ── /api/admin/partner-parts — 관리자 뒤처리 도구 + 대행 업로드 ───────────────
// 정본 docs/PARTNER_PARTS.md.
//
// 만료·RFQ 제한을 두지 않기로 한 대신(사용자 결정 2026-08-23) **품질 비용이 전부
// 관리자에게 온다**. 그래서 뒤처리가 1~2클릭으로 끝나야 이 정책이 성립한다:
//   · 협력사별 요약(보유 수·마지막 업로드 나이·경고)
//   · 원장 통째 활성/비활성 · 행 단위 비활성 · 회차 비우기
//   · 포털 계정 없는 협력사를 위한 대행 업로드(12호 교훈)

const PartnerIdParams = z.object({ partnerId: z.coerce.bigint() });
const UploadIdParams = z.object({ uploadId: z.coerce.bigint() });
const PartIdParams = z.object({ partId: z.coerce.bigint() });

export const adminPartnerPartRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  const assertPartner = async (partnerId: bigint): Promise<{ id: bigint; name: string }> => {
    const partner = await prisma.spPartner.findUnique({
      where: { id: partnerId },
      select: { id: true, name: true },
    });
    if (partner === null) throw fastify.httpErrors.notFound('파트너를 찾을 수 없습니다');
    return partner;
  };

  // ── GET /partner-parts/summary — 원장을 가진 협력사 전부 ────────────────────
  fastify.get(
    '/partner-parts/summary',
    { schema: { response: { 200: AdminPartnerPartSummaryListResponse } } },
    async () => {
      const [grouped, inactiveGrouped] = await Promise.all([
        prisma.spPartnerPart.groupBy({
          by: ['partnerId'],
          where: { isActive: true },
          _count: { _all: true },
        }),
        prisma.spPartnerPart.groupBy({
          by: ['partnerId'],
          where: { isActive: false },
          _count: { _all: true },
        }),
      ]);
      const partnerIds = [
        ...new Set([...grouped, ...inactiveGrouped].map((row) => row.partnerId)),
      ];
      if (partnerIds.length === 0) {
        return {
          result: true as const,
          data: { items: [], staleAfterDays: PARTNER_PART_STALE_AFTER_DAYS, totalActiveParts: 0 },
        };
      }
      const [partners, uploads] = await Promise.all([
        prisma.spPartner.findMany({
          where: { id: { in: partnerIds } },
          select: { id: true, name: true },
        }),
        prisma.spPartnerPartUpload.findMany({
          where: { partnerId: { in: partnerIds }, status: 'applied' },
          orderBy: { appliedAt: 'desc' },
          select: { partnerId: true, fileName: true, appliedAt: true, createdAt: true },
        }),
      ]);
      const nameById = new Map(partners.map((row) => [String(row.id), row.name]));
      const activeById = new Map(grouped.map((row) => [String(row.partnerId), row._count._all]));
      const inactiveById = new Map(
        inactiveGrouped.map((row) => [String(row.partnerId), row._count._all]),
      );
      const lastById = new Map<string, { fileName: string; at: Date }>();
      for (const upload of uploads) {
        const key = String(upload.partnerId);
        if (lastById.has(key)) continue;
        lastById.set(key, {
          fileName: upload.fileName,
          at: upload.appliedAt ?? upload.createdAt,
        });
      }
      const items = partnerIds
        .map((partnerId) => {
          const key = String(partnerId);
          const last = lastById.get(key) ?? null;
          const ageDays = ageDaysFrom(last?.at ?? null);
          return {
            partnerId: Number(partnerId),
            partnerName: nameById.get(key) ?? `#${key}`,
            activeCount: activeById.get(key) ?? 0,
            inactiveCount: inactiveById.get(key) ?? 0,
            lastUploadedAt: last?.at.toISOString() ?? null,
            lastUploadFileName: last?.fileName ?? null,
            ageDays,
            stale: ageDays !== null && ageDays > PARTNER_PART_STALE_AFTER_DAYS,
          };
        })
        // 낡은 것부터 위로 — 뒤처리 대상이 먼저 보여야 한다.
        .sort((a, b) => (b.ageDays ?? -1) - (a.ageDays ?? -1));
      return {
        result: true as const,
        data: {
          items,
          staleAfterDays: PARTNER_PART_STALE_AFTER_DAYS,
          totalActiveParts: items.reduce((sum, item) => sum + item.activeCount, 0),
        },
      };
    },
  );

  // ── GET /partner-parts — 전체 원장 검색(협력사 필터) ───────────────────────
  fastify.get(
    '/partner-parts',
    { schema: { querystring: PartnerPartListQuery, response: { 200: PartnerPartListResponse } } },
    async (request) => {
      const { q, page, pageSize, includeInactive, partnerId } = request.query;
      const where: Prisma.SpPartnerPartWhereInput = {
        ...(partnerId === undefined ? {} : { partnerId: BigInt(partnerId) }),
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
          include: {
            upload: { select: { createdAt: true } },
            partner: { select: { name: true } },
          },
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

  // ── GET /partner-parts/:partnerId/uploads — 협력사 업로드 이력 ─────────────
  fastify.get(
    '/partner-parts/:partnerId/uploads',
    { schema: { params: PartnerIdParams, response: { 200: PartnerPartUploadListResponse } } },
    async (request) => {
      await assertPartner(request.params.partnerId);
      const uploads = await prisma.spPartnerPartUpload.findMany({
        where: { partnerId: request.params.partnerId },
        include: { partner: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      const counts = await prisma.spPartnerPart.groupBy({
        by: ['uploadId'],
        where: { partnerId: request.params.partnerId },
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

  // ── PATCH /partner-parts/:partnerId/active — 원장 통째 활성/비활성 ─────────
  // 만료가 없는 대신 사람이 끄는 스위치. 끄면 BOM 검색 주입에서 즉시 빠진다.
  fastify.patch(
    '/partner-parts/:partnerId/active',
    {
      schema: {
        params: PartnerIdParams,
        body: AdminPartnerPartToggleBody,
        response: { 200: PartnerPartMutationResponse },
      },
    },
    async (request) => {
      await assertPartner(request.params.partnerId);
      const [parts] = await prisma.$transaction([
        prisma.spPartnerPart.updateMany({
          where: { partnerId: request.params.partnerId },
          data: { isActive: request.body.isActive },
        }),
        prisma.spPartnerPartKey.updateMany({
          where: { partnerId: request.params.partnerId },
          data: { isActive: request.body.isActive },
        }),
      ]);
      return { result: true as const, data: { affected: parts.count } };
    },
  );

  // ── PATCH /partner-parts/rows — 행 단위 활성/비활성(선택 일괄) ─────────────
  fastify.patch(
    '/partner-parts/rows',
    {
      schema: { body: AdminPartnerPartBulkBody, response: { 200: PartnerPartMutationResponse } },
    },
    async (request) => {
      const ids = request.body.partIds.map((id) => BigInt(id));
      const [parts] = await prisma.$transaction([
        prisma.spPartnerPart.updateMany({
          where: { id: { in: ids } },
          data: { isActive: request.body.isActive },
        }),
        prisma.spPartnerPartKey.updateMany({
          where: { partId: { in: ids } },
          data: { isActive: request.body.isActive },
        }),
      ]);
      return { result: true as const, data: { affected: parts.count } };
    },
  );

  // ── PATCH /partner-parts/row/:partId — 행 수정(관리자 뒤처리) ─────────────
  // 협력사가 못 고치는 상황(포털 계정 없음·응답 없음)에서도 관리자가 바로잡을 수 있어야
  // "운영으로 뒤처리한다"는 정책이 성립한다.
  fastify.patch(
    '/partner-parts/row/:partId',
    {
      schema: {
        params: PartIdParams,
        body: PartnerPartUpdateBody,
        response: { 200: PartnerPartUpdateResponse },
      },
    },
    async (request) => {
      try {
        const part = await updatePartnerPart(
          request.params.partId,
          request.body,
          request.user.mbId,
        );
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

  // ── DELETE /partner-parts/:partId — 행 영구 삭제 ──────────────────────────
  fastify.delete(
    '/partner-parts/row/:partId',
    { schema: { params: PartIdParams, response: { 200: PartnerPartMutationResponse } } },
    async (request) => {
      const part = await prisma.spPartnerPart.findUnique({
        where: { id: request.params.partId },
        select: { id: true },
      });
      if (part === null) throw fastify.httpErrors.notFound('부품을 찾을 수 없습니다');
      await prisma.spPartnerPartKey.deleteMany({ where: { partId: part.id } });
      await prisma.spPartnerPart.delete({ where: { id: part.id } });
      return { result: true as const, data: { affected: 1 } };
    },
  );

  // ── DELETE /partner-parts/:partnerId — 협력사 원장 비우기 ──────────────────
  // 청크 삭제(무트랜잭션) — 수만 행 cascade 를 인터랙티브 트랜잭션에 넣으면 P2028.
  fastify.delete(
    '/partner-parts/:partnerId',
    { schema: { params: PartnerIdParams, response: { 200: PartnerPartMutationResponse } } },
    async (request) => {
      await assertPartner(request.params.partnerId);
      let affected = 0;
      for (;;) {
        const batch = await prisma.spPartnerPart.findMany({
          where: { partnerId: request.params.partnerId },
          select: { id: true },
          take: 500,
        });
        if (batch.length === 0) break;
        const ids = batch.map((row) => row.id);
        await prisma.spPartnerPartKey.deleteMany({ where: { partId: { in: ids } } });
        const removed = await prisma.spPartnerPart.deleteMany({ where: { id: { in: ids } } });
        affected += removed.count;
      }
      await prisma.spPartnerPartUpload.updateMany({
        where: { partnerId: request.params.partnerId, status: 'applied' },
        data: { status: 'superseded' },
      });
      return { result: true as const, data: { affected } };
    },
  );

  // ── POST /partner-parts/:partnerId/uploads — 관리자 대행 업로드 ────────────
  // 포털 계정이 없는 협력사(12호 교훈: 무계정 대행)를 위해 관리자가 대신 올린다.
  fastify.post(
    '/partner-parts/:partnerId/uploads',
    {
      schema: {
        params: PartnerIdParams,
        response: { 201: PartnerPartUploadDetailResponse, 502: BizError },
      },
    },
    async (request, reply) => {
      if (!request.isMultipart()) return reply.badRequest('multipart/form-data 요청이어야 합니다');
      const { files } = await collectMultipart(request);
      const partner = await assertPartner(request.params.partnerId);
      const file = files.find((f) => f.field === 'file') ?? files[0];
      if (file === undefined) return reply.badRequest('file 파트가 없습니다');
      const ext = file.filename.split('.').pop()?.toLowerCase() ?? '';
      if (!PARTNER_PART_ALLOWED_EXT.has(ext)) {
        return reply.badRequest('지원하지 않는 파일 형식입니다 (xlsx/xlsm/xls/csv/tsv/bom)');
      }
      if (file.buffer.length > PARTNER_PART_MAX_FILE_BYTES) {
        return reply.badRequest('파일이 50MB 를 초과합니다');
      }

      const upload = await prisma.spPartnerPartUpload.create({
        data: {
          partnerId: partner.id,
          fileName: file.filename.slice(0, 255),
          fileSize: BigInt(file.buffer.length),
          status: 'parsing',
          uploadedBy: 'ADMIN',
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

        // 원본 보존은 **필수** — 커밋이 보관본을 다시 돌려 전량을 얻는다(미리보기는 표본만).
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
            uploadedBy: 'ADMIN',
          },
        });
        await prisma.spPartnerPartUpload.update({
          where: { id: upload.id },
          data: { fileId: savedFile.id, ...previewUpdateData(result, undefined) },
        });
        const saved = await prisma.spPartnerPartUpload.findUniqueOrThrow({
          where: { id: upload.id },
          include: { partner: { select: { name: true } } },
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
        const code = error instanceof PartnerPartEngineError ? error.code : 'BOM_ENGINE_ERROR';
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

  // ── POST /partner-parts/uploads/:uploadId/commit — 대행 회차 반영 ──────────
  fastify.post(
    '/partner-parts/uploads/:uploadId/commit',
    {
      schema: {
        params: UploadIdParams,
        body: PartnerPartUploadCommitBody,
        response: { 200: PartnerPartMutationResponse },
      },
    },
    async (request) => {
      const upload = await prisma.spPartnerPartUpload.findFirst({
        where: { id: request.params.uploadId, status: 'preview' },
      });
      if (upload === null) throw fastify.httpErrors.notFound('확인 대기 중인 업로드가 아닙니다');
      // 전량은 보관본 재실행으로 얻는다 — 미리보기 스냅샷은 표본뿐(패킷 한도).
      const result = await rerunUploadFromArchive(upload, overridesFrom(upload.mappingJson));
      const rows = toLedgerRows(result);
      if (rows.length === 0) throw fastify.httpErrors.conflict('저장할 품번이 없습니다');
      const affected = await commitPartnerPartUpload(
        upload.id,
        upload.partnerId,
        request.body.mode,
        rows,
      );
      return { result: true as const, data: { affected } };
    },
  );

  done();
};
