import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomQuoteDetailResponse,
  AdminBomQuoteListResponse,
  AdminBomQuotePatchBody,
  BomQuoteItemCandidatesResponse,
  BomQuoteStatus,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { downloadFromFileServer } from '../lib/file-server';
import { canTransition, getQuoteItemCandidates, toAdminDetailDto, toAdminSummaryDto } from '../lib/bom-quote';

// ── /api/admin/bom-quotes — 고객 BOM 견적요청 검토 (requireAdmin) ─────────────
// 1차 범위: 목록·상세·상태 전이·확정가(운송료/관리비/총액)·메모·원본 다운로드.
// 협력사 RFQ·발주·선적 풀 워크벤치는 이 데이터 모델 위에서 후속 재설계(docs/BOM_QUOTE.md).

const IdParams = z.object({ id: z.coerce.bigint() });
const ItemParams = IdParams.extend({ rowIdx: z.coerce.number().int().min(0) });
const ListQuery = z.object({
  status: BomQuoteStatus.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const FILE_REF_TYPE = 'sp_bom_quote';

export const adminBomQuoteRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get('/bom-quotes', { schema: { querystring: ListQuery, response: { 200: AdminBomQuoteListResponse } } }, async (request) => {
    const { status, page, pageSize } = request.query;
    // draft 는 고객 작업중 문서 — 관리자 목록에서는 요청 이후 상태만 보인다(명시 필터 제외)
    const where = status !== undefined ? { status } : { status: { not: 'draft' } };
    const [rows, total] = await Promise.all([
      prisma.spBomQuote.findMany({
        where,
        include: { items: { select: { included: true, matchStatus: true } } },
        orderBy: [{ requestedAt: 'desc' }, { updatedAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.spBomQuote.count({ where }),
    ]);
    return {
      result: true as const,
      data: { items: rows.map((row) => toAdminSummaryDto(row, row.items)), total, page, pageSize },
    };
  });

  fastify.get('/bom-quotes/:id', { schema: { params: IdParams, response: { 200: AdminBomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id }, include: { items: true, sheets: true } });
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');
    const file = await prisma.spFile.findFirst({ where: { refType: FILE_REF_TYPE, refId: quote.id } });
    const fileUrl = file === null ? null : `/api/admin/bom-quotes/${String(quote.id)}/file`;
    return { result: true as const, data: await toAdminDetailDto(quote, quote.items, quote.sheets, fileUrl) };
  });

  fastify.get('/bom-quotes/:id/items/:rowIdx/candidates', {
    schema: { params: ItemParams, response: { 200: BomQuoteItemCandidatesResponse } },
  }, async (request, reply) => {
    const data = await getQuoteItemCandidates(request.params.id, request.params.rowIdx);
    if (data === null) return reply.notFound('견적 항목을 찾을 수 없습니다');
    return { result: true as const, data };
  });

  // 원본 BOM 파일 다운로드(서버 경유 스트리밍 — pathToken 클라 미노출 원칙)
  fastify.get('/bom-quotes/:id/file', { schema: { params: IdParams } }, async (request, reply) => {
    const file = await prisma.spFile.findFirst({ where: { refType: FILE_REF_TYPE, refId: request.params.id } });
    if (file === null) return reply.notFound('원본 파일이 없습니다');
    const downloaded = await downloadFromFileServer(file.pathToken);
    if (downloaded === null) return reply.notFound('파일서버에서 파일을 찾을 수 없습니다');
    return reply
      .header('content-type', downloaded.contentType)
      .header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`)
      .send(downloaded.buffer);
  });

  // 검토 — 상태 전이 검증 + 확정가·메모. answered 전이 시 answeredAt 스탬프.
  fastify.patch('/bom-quotes/:id', { schema: { params: IdParams, body: AdminBomQuotePatchBody, response: { 200: AdminBomQuoteDetailResponse } } }, async (request, reply) => {
    const quote = await prisma.spBomQuote.findUnique({ where: { id: request.params.id } });
    if (quote === null) return reply.notFound('견적을 찾을 수 없습니다');

    const body = request.body;
    if (body.status !== undefined && body.status !== quote.status && !canTransition(quote.status, body.status)) {
      return reply.conflict(`전이 불가: ${quote.status} → ${body.status}`);
    }

    await prisma.spBomQuote.update({
      where: { id: quote.id },
      data: {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.status === 'answered' && quote.answeredAt === null ? { answeredAt: new Date() } : {}),
        ...(body.adminMemo !== undefined ? { adminMemo: body.adminMemo } : {}),
        ...(body.answerNote !== undefined ? { answerNote: body.answerNote } : {}),
        ...(body.confirmedShippingFee !== undefined ? { confirmedShippingFee: body.confirmedShippingFee } : {}),
        ...(body.confirmedManagementFee !== undefined ? { confirmedManagementFee: body.confirmedManagementFee } : {}),
        ...(body.confirmedTotal !== undefined ? { confirmedTotal: body.confirmedTotal } : {}),
      },
    });

    const fresh = await prisma.spBomQuote.findUnique({ where: { id: quote.id }, include: { items: true, sheets: true } });
    if (fresh === null) return reply.notFound('견적을 찾을 수 없습니다');
    const file = await prisma.spFile.findFirst({ where: { refType: FILE_REF_TYPE, refId: fresh.id } });
    const fileUrl = file === null ? null : `/api/admin/bom-quotes/${String(fresh.id)}/file`;
    return { result: true as const, data: await toAdminDetailDto(fresh, fresh.items, fresh.sheets, fileUrl) };
  });

  done();
};
