import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { SlideListResponse, SlideOkResponse, SlideReorder, SlideUpsert } from '@sp/api-contract';
import type { SlideType } from '@sp/api-contract';
import {
  createMainBanner,
  deleteMainBannerRow,
  getMainBannerById,
  listMainBanners,
  reorderMainBanners,
  updateMainBanner,
} from '../lib/g5-db';
import type { MainBanner } from '../lib/g5-db';
import { deleteBannerImage, saveBannerImage, sniffImage } from '../lib/banner-image';
import { collectMultipart } from '../lib/market';
import { kstDateTimeStr } from '../lib/kst';

// ── /api/admin/slides — 홈 메인 슬라이드 관리(requireAdmin) ──────────────────
// 저장은 g5-db 의 g5_shop_banner(bn_position='메인') 카탈로그 ⑳. 이미지는 로컬
// data/banner/{id}(lib/banner-image). 계약은 중립형(bn_* 미러 아님) — sp_slide 승격 대비.
// 노출기간(beginAt/endAt)은 계약에 있으나 1차 UI 는 미노출 → 빈값이면 상시 노출 기본값.

const DEFAULT_BEGIN = '2000-01-01 00:00:00';
const DEFAULT_END = '2037-12-31 23:59:59';

const IdParams = z.object({ id: z.string().regex(/^\d+$/) });

function toSlide(b: MainBanner, now: string): SlideType {
  return {
    id: b.id,
    title: b.title,
    linkUrl: b.linkUrl,
    // 브릿지와 동일한 서빙 URL(+ bn_time 캐시버스팅 토큰). 같은 도메인이라 상대경로.
    imageUrl: `/data/banner/${String(b.id)}?v=${b.updatedAt}`,
    newWindow: b.newWindow,
    order: b.order,
    active: b.beginAt <= now && now <= b.endAt,
    beginAt: b.beginAt,
    endAt: b.endAt,
  };
}

export const adminSlidesRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // GET /slides — 목록(표시 순서)
  fastify.get('/slides', { schema: { response: { 200: SlideListResponse } } }, async () => {
    const now = kstDateTimeStr(new Date());
    const banners = await listMainBanners();
    return { result: true as const, data: banners.map((b) => toSlide(b, now)) };
  });

  // POST /slides — 생성(multipart: payload JSON + image 파일 필수)
  fastify.post('/slides', async (request, reply) => {
    if (!request.isMultipart()) return reply.badRequest('multipart/form-data 요청이어야 합니다');
    const { files, rawPayload } = await collectMultipart(request);
    if (rawPayload === undefined) return reply.badRequest('payload 파트가 없습니다');
    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(rawPayload);
    } catch {
      return reply.badRequest('payload 가 유효한 JSON 이 아닙니다');
    }
    const parsed = SlideUpsert.safeParse(payloadJson);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH', issues: parsed.error.issues });
    }
    const image = files.find((f) => f.field === 'image');
    if (image === undefined) return reply.status(400).send({ result: false, error: 'IMAGE_REQUIRED' });
    if (sniffImage(image.buffer) === null) {
      return reply.status(400).send({ result: false, error: 'INVALID_IMAGE' });
    }
    const p = parsed.data;
    const id = await createMainBanner({
      title: p.title,
      linkUrl: p.linkUrl,
      newWindow: p.newWindow,
      beginAt: p.beginAt || DEFAULT_BEGIN,
      endAt: p.endAt || DEFAULT_END,
    });
    await saveBannerImage(id, image.buffer);
    const row = await getMainBannerById(id);
    if (row === null) return reply.internalServerError('배너 생성 후 조회 실패');
    return { result: true as const, data: toSlide(row, kstDateTimeStr(new Date())) };
  });

  // PATCH /slides/reorder — 순서 일괄 변경(JSON). :id 보다 먼저 등록(정적 경로 우선).
  fastify.patch(
    '/slides/reorder',
    { schema: { body: SlideReorder, response: { 200: SlideOkResponse } } },
    async (request) => {
      await reorderMainBanners(request.body.ids);
      return { result: true as const };
    },
  );

  // PATCH /slides/:id — 수정(multipart: payload JSON + image 선택). 이미지 있으면 교체+캐시버스팅.
  fastify.patch('/slides/:id', async (request, reply) => {
    const params = IdParams.safeParse(request.params);
    if (!params.success) return reply.badRequest('잘못된 id');
    const id = Number(params.data.id);
    if (!request.isMultipart()) return reply.badRequest('multipart/form-data 요청이어야 합니다');
    const { files, rawPayload } = await collectMultipart(request);
    if (rawPayload === undefined) return reply.badRequest('payload 파트가 없습니다');
    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(rawPayload);
    } catch {
      return reply.badRequest('payload 가 유효한 JSON 이 아닙니다');
    }
    const parsed = SlideUpsert.safeParse(payloadJson);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ result: false, error: 'PAYLOAD_SCHEMA_MISMATCH', issues: parsed.error.issues });
    }
    const image = files.find((f) => f.field === 'image');
    if (image !== undefined && sniffImage(image.buffer) === null) {
      return reply.status(400).send({ result: false, error: 'INVALID_IMAGE' });
    }
    const existing = await getMainBannerById(id);
    if (existing === null) return reply.notFound('슬라이드를 찾을 수 없습니다');
    const p = parsed.data;
    const affected = await updateMainBanner(
      id,
      {
        title: p.title,
        linkUrl: p.linkUrl,
        newWindow: p.newWindow,
        beginAt: p.beginAt || existing.beginAt,
        endAt: p.endAt || existing.endAt,
      },
      image !== undefined,
    );
    if (affected === 0) return reply.notFound('슬라이드를 찾을 수 없습니다');
    if (image !== undefined) await saveBannerImage(id, image.buffer);
    const row = await getMainBannerById(id);
    if (row === null) return reply.internalServerError('배너 수정 후 조회 실패');
    return { result: true as const, data: toSlide(row, kstDateTimeStr(new Date())) };
  });

  // DELETE /slides/:id — 행 + 이미지 파일 동반 삭제(고아 파일/id 재사용 부활 방지)
  fastify.delete(
    '/slides/:id',
    { schema: { response: { 200: SlideOkResponse } } },
    async (request, reply) => {
      const params = IdParams.safeParse(request.params);
      if (!params.success) return reply.badRequest('잘못된 id');
      const id = Number(params.data.id);
      const ok = await deleteMainBannerRow(id);
      if (!ok) return reply.notFound('슬라이드를 찾을 수 없습니다');
      await deleteBannerImage(id);
      return { result: true as const };
    },
  );

  done();
};
