import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { SpSeo } from '@prisma/client';
import { z } from 'zod';
import { SeoListResponse, SeoOkResponse, SeoResponse, SeoUpsert } from '@sp/api-contract';
import type { SeoRecordType } from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { kstDateTimeStr } from '../lib/kst';

// ── /api/admin/seo — 페이지별 SEO 메타 관리(requireAdmin) ────────────────────
// 저장은 Prisma sp_seo((scope, refKey) 복합 유니크). 소비는 sp-php 테마 head.sub.php 가
// 이 테이블을 read-only 직접 조회한다(정본 docs/SEO_MANAGEMENT.md). P1 은 global/page 중심,
// item/board 스코프도 계약상 허용(P2/P3 대비). nullable 필드는 '' ↔ null 로 정규화한다.

const IdParams = z.object({ id: z.string().regex(/^\d+$/) });

// nullable DB 필드 → 응답은 '' 로(FE 폼 단순화). item/board 등 미지원 scope 값이 DB 에
// 들어올 일은 쓰기를 우리가 통제하므로 없다 — 응답 직렬화(enum)로 방어된다.
function toSeo(r: SpSeo): SeoRecordType {
  return {
    id: Number(r.id),
    scope: r.scope as SeoRecordType['scope'],
    refKey: r.refKey,
    metaTitle: r.metaTitle ?? '',
    metaDescription: r.metaDescription ?? '',
    ogImage: r.ogImage ?? '',
    canonical: r.canonical ?? '',
    robots: r.robots ?? '',
    updatedAt: kstDateTimeStr(r.updatedAt),
  };
}

// 빈 문자열 → null(미설정). 폴백 로직(소비측)이 null 을 "없음"으로 취급한다.
const nn = (s: string): string | null => (s.trim() === '' ? null : s.trim());

export const adminSeoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  // 전 라우트 관리자 전용 — 라우트별 preHandler 누락 사고를 원천 차단.
  fastify.addHook('preHandler', fastify.requireAdmin);

  // GET /seo — 전체 목록(scope, refKey 순)
  fastify.get('/seo', { schema: { response: { 200: SeoListResponse } } }, async () => {
    const rows = await prisma.spSeo.findMany({ orderBy: [{ scope: 'asc' }, { refKey: 'asc' }] });
    return { result: true as const, data: rows.map(toSeo) };
  });

  // PUT /seo — (scope, refKey) upsert. 신규/수정 공용(멱등).
  fastify.put('/seo', { schema: { body: SeoUpsert, response: { 200: SeoResponse } } }, async (request) => {
    const b = request.body;
    // global 은 단일 레코드 — refKey 강제 '' (여러 전역기본 방지).
    const refKey = b.scope === 'global' ? '' : b.refKey;
    const data = {
      metaTitle: nn(b.metaTitle),
      metaDescription: nn(b.metaDescription),
      ogImage: nn(b.ogImage),
      canonical: nn(b.canonical),
      robots: nn(b.robots),
    };
    const row = await prisma.spSeo.upsert({
      where: { scope_refKey: { scope: b.scope, refKey } },
      create: { scope: b.scope, refKey, ...data },
      update: data,
    });
    return { result: true as const, data: toSeo(row) };
  });

  // DELETE /seo/:id — 단건 삭제
  fastify.delete('/seo/:id', { schema: { response: { 200: SeoOkResponse } } }, async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('잘못된 id');
    const id = BigInt(params.data.id);
    const existing = await prisma.spSeo.findUnique({ where: { id } });
    if (existing === null) return reply.notFound('SEO 레코드를 찾을 수 없습니다');
    await prisma.spSeo.delete({ where: { id } });
    return { result: true as const };
  });

  done();
};
