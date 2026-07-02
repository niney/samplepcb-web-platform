import { createHash } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { KNOWN_SPEC_KEYS, PcbProjectPayload, PcbProjectQtyPatch } from '@sp/api-contract';
import type { PcbProjectPayloadType } from '@sp/api-contract';
import { calculateQuote } from '../pricing/engine';
import { uploadToFileServer } from '../lib/file-server';
import type { UploadTarget } from '../lib/file-server';
import {
  deleteQuoteOption,
  getCartStates,
  getTemplateItem,
  insertCartRow,
  insertQuoteOption,
} from '../lib/g5-db';
import type { CartState } from '../lib/g5-db';
import { prisma } from '../lib/prisma';

// ── POST /api/pcb-projects — 거버 담기 API (단일 multipart 호출) ────────────
// 거버 뷰어가 FormData(gerber + thumbnail + payload JSON)를 보내면:
//   ① payload Zod 검증  ② 견적 계산 + sp_quote 저장(가격은 서버만 계산)
//   ③ 파일서버 업로드 대행(pathToken 클라이언트 미노출)  ④ sp_order_spec + sp_file 저장
//   ⑤ flow=order & 가격 확정이면 g5_shop_cart INSERT — od_id 는 인증 브리지 JWT 의
//      cartId(= PHP 세션 ss_cart_id) 클레임 사용. cart.php 는 무변경으로 행이 보인다.
// 인증: 회원 전용(JWT 필수). 비회원 주문은 현재 미사용 — 확장 시 HANDOFF "비회원" 참고.

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';
const FILE_SERVICE_TYPE = process.env.FILE_SERVICE_TYPE ?? 'gerber';
const QUOTE_TTL_HOURS = 72;

interface ReceivedFile extends UploadTarget {
  field: string;
}

const findUnknownSpecKeys = (spec: PcbProjectPayloadType['spec']): string[] => {
  const known = new Set<string>(KNOWN_SPEC_KEYS);
  return Object.keys(spec).filter((key) => !known.has(key));
};

// cart 화면(ct_option) 사양 요약 — ct_qty=1 고정이라 수량은 여기에 담아 보여준다
const buildOptionSummary = (spec: PcbProjectPayloadType['spec'], qty: number): string =>
  [
    String(spec.material ?? spec.kindPcb ?? ''),
    spec.layers !== undefined ? `${String(spec.layers)}L` : '',
    spec.width !== undefined && spec.length !== undefined
      ? `${String(spec.width)}x${String(spec.length)}mm`
      : '',
    `${String(qty)}pcs`,
  ]
    .filter((s) => s !== '')
    .join(' / ');

const ProjectIdParams = z.object({ id: z.string().regex(/^\d+$/) });

export const pcbProjectRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.post('/pcb-projects', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.badRequest('multipart/form-data 요청이어야 합니다');
    }

    // ── multipart 수신 ──
    const files: ReceivedFile[] = [];
    let rawPayload: string | undefined;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        files.push({
          field: part.fieldname,
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: await part.toBuffer(),
        });
      } else if (part.fieldname === 'payload' && typeof part.value === 'string') {
        rawPayload = part.value;
      }
    }
    const gerber = files.find((f) => f.field === 'gerber');
    if (rawPayload === undefined) return reply.badRequest('payload 파트가 없습니다');
    if (gerber === undefined) return reply.badRequest('gerber 파일 파트가 없습니다');

    // ── payload 검증 ──
    let payloadJson: unknown;
    try {
      payloadJson = JSON.parse(rawPayload);
    } catch {
      return reply.badRequest('payload 가 유효한 JSON 이 아닙니다');
    }
    const parsed = PcbProjectPayload.safeParse(payloadJson);
    if (!parsed.success) {
      return reply.status(400).send({
        result: false,
        error: 'PAYLOAD_SCHEMA_MISMATCH',
        issues: parsed.error.issues,
      });
    }
    const payload = parsed.data;
    const unknownSpecKeys = findUnknownSpecKeys(payload.spec);

    // ── 회원 인증(필수) — 비회원 미사용 결정(2026-07-02). 거버는 제출 전
    //    GET /spcb/api/me 로 토큰을 받아 Authorization 헤더로 전달한다.
    try {
      await request.jwtVerify();
    } catch {
      return reply.unauthorized('로그인이 필요합니다');
    }
    const mbId = request.user.mbId;
    const cartId = request.user.cartId;

    // ── 견적 계산 (가격은 서버 재계산이 유일한 진실 — 클라이언트 가격 미수신) ──
    const quote = calculateQuote({
      category: payload.category,
      orderCategory: payload.orderCategory,
      qty: payload.qty,
      spec: payload.spec,
    });
    const quoteStatus = payload.flow === 'rfq' || quote.listPrice === null ? 'rfq' : 'priced';

    // ── 파일서버 업로드 대행 — 실패 시 프로젝트를 만들지 않고 중단 ──
    const targets: UploadTarget[] = files.map((f) => ({
      buffer: f.buffer,
      filename: f.filename,
      mimetype: f.mimetype,
    }));
    let uploaded;
    try {
      uploaded = await uploadToFileServer(targets, FILE_SERVICE_TYPE);
    } catch (err) {
      request.log.error({ err }, 'file server upload failed');
      return reply.status(502).send({ result: false, error: 'FILE_UPLOAD_FAILED' });
    }

    // ── sp_quote + sp_order_spec + sp_file 저장 (한 트랜잭션) ──
    const specJson = payload.spec as Prisma.InputJsonValue;
    const specHash = createHash('sha256').update(JSON.stringify(payload.spec)).digest('hex');
    const now = new Date();
    const project = await prisma.$transaction(async (tx) => {
      const q = await tx.spQuote.create({
        data: {
          category: payload.category,
          orderCategory: payload.orderCategory,
          qty: payload.qty,
          specJson,
          specHash,
          autoPrice: quote.listPrice,
          eta: quote.eta === '' ? null : quote.eta,
          priceVersion: quote.priceVersion,
          expiresAt: new Date(now.getTime() + QUOTE_TTL_HOURS * 3600 * 1000),
        },
      });
      const spec = await tx.spOrderSpec.create({
        data: {
          mbId,
          quoteId: q.id,
          projectName: payload.projectName,
          category: payload.category,
          orderCategory: payload.orderCategory,
          qty: payload.qty,
          message: payload.message === '' ? null : payload.message,
          specJson,
          quoteStatus,
        },
      });
      await tx.spFile.createMany({
        data: uploaded.map((u, i) => ({
          refType: 'sp_order_spec',
          refId: spec.id,
          uploadFileName: u.uploadFileName,
          originFileName: u.originFileName,
          pathToken: u.pathToken,
          size: BigInt(u.size),
          writeDate: now,
          fileType: files[i]?.field ?? null, // gerber | thumbnail
        })),
      });
      return { quote: q, spec };
    });

    // ── g5_shop_cart INSERT (flow=order & 가격 확정일 때만) ──
    // od_id = JWT cartId. 실패해도 프로젝트는 유효("견적 보관 중")하므로 요청을 죽이지 않고
    // cartAdded=false 로 알린다 — 파생 상태 설계 덕에 데이터 오염이 없다(HANDOFF 2장).
    let cartAdded = false;
    if (payload.flow === 'order' && quote.listPrice !== null) {
      if (cartId === undefined || cartId === '') {
        request.log.error({ mbId }, 'JWT 에 cartId 클레임이 없음 — me.php 브리지 확인 필요');
      } else {
        try {
          const item = await getTemplateItem(payload.category);
          if (item === null) {
            request.log.error({ category: payload.category }, '템플릿 상품 없음 — seed-template-items 실행 필요');
          } else {
            // 견적 옵션 행을 먼저 등록해야 코어 before_check_cart_price 의
            // 옵션가 재검증(shop.lib.php:2616~)이 정당하게 통과한다(g5-db.ts 참조).
            await insertQuoteOption(item.itId, project.quote.id, quote.listPrice);
            let ctId: number;
            try {
              ctId = await insertCartRow({
                odId: cartId,
                mbId,
                item,
                itemName: `${item.itName} · ${payload.projectName}`,
                ioId: project.quote.id,
                price: quote.listPrice,
                option: buildOptionSummary(payload.spec, payload.qty),
                ip: request.ip,
              });
            } catch (err) {
              // 카트 실패 시 고아 옵션 행 보상 삭제(실패해도 정리 배치가 수거)
              await deleteQuoteOption(item.itId, project.quote.id).catch(() => undefined);
              throw err;
            }
            await prisma.spOrderSpec.update({ where: { id: project.spec.id }, data: { ctId } });
            cartAdded = true;
          }
        } catch (err) {
          request.log.error({ err }, 'g5_shop_cart INSERT 실패 — 프로젝트는 견적 보관 상태로 유지');
        }
      }
    }

    request.log.info(
      {
        projectId: Number(project.spec.id),
        quoteId: project.quote.id,
        quoteStatus,
        price: quote.listPrice,
        mbId,
        cartAdded,
      },
      'pcb-project created',
    );

    return {
      result: true as const,
      data: {
        projectId: Number(project.spec.id),
        quoteId: project.quote.id,
        quoteStatus,
        price: quote.listPrice,
        eta: quote.eta,
        cartAdded,
        // 담기 성공 → 장바구니, 그 외(rfq/실패)는 견적관리(/shop/quotes)
        redirectUrl: cartAdded ? `${WEB_BASE_URL}/shop/cart.php` : `${WEB_BASE_URL}/shop/quotes`,
        ...(unknownSpecKeys.length > 0 ? { unknownSpecKeys } : {}),
      },
    };
  });

  // ── GET /api/pcb-projects — 견적관리(/quotes, sp-php) 목록 ──────────────────
  // 본인(mbId) 프로젝트만. cartState 는 저장 안 하고 ct_id 조인 파생(HANDOFF 3장).
  fastify.get(
    '/pcb-projects',
    {
      schema: {
        querystring: z.object({
          quoteStatus: z.enum(['priced', 'rfq', 'quoted']).optional(),
        }),
      },
    },
    async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.unauthorized('로그인이 필요합니다');
      }
      const specs = await prisma.spOrderSpec.findMany({
        where: {
          mbId: request.user.mbId,
          status: 'active',
          ...(request.query.quoteStatus !== undefined
            ? { quoteStatus: request.query.quoteStatus }
            : {}),
        },
        orderBy: { id: 'desc' },
      });
      const quotes = await prisma.spQuote.findMany({
        where: { id: { in: specs.map((s) => s.quoteId) } },
        select: { id: true, autoPrice: true, eta: true },
      });
      const quoteById = new Map(quotes.map((q) => [q.id, q]));
      const cartStates = await getCartStates(
        specs.map((s) => s.ctId).filter((id): id is number => id !== null),
      );
      return {
        result: true as const,
        data: {
          items: specs.map((s) => {
            const quote = quoteById.get(s.quoteId);
            const cartState: CartState =
              s.ctId !== null ? (cartStates.get(s.ctId) ?? 'none') : 'none';
            return {
              projectId: Number(s.id),
              quoteId: s.quoteId,
              projectName: s.projectName,
              category: s.category,
              orderCategory: s.orderCategory,
              qty: s.qty,
              message: s.message,
              quoteStatus: s.quoteStatus,
              price: s.finalPrice ?? quote?.autoPrice ?? null,
              eta: quote?.eta ?? null,
              cartState,
              createdAt: s.createdAt.toISOString(),
            };
          }),
        },
      };
    },
  );

  // ── POST /api/pcb-projects/:id/cart — [주문하기] 장바구니 담기 ──────────────
  // 가격 있는 프로젝트(자동견적 priced / 관리자 확정 quoted)만. 거버 직주문과 같은
  // INSERT 경로(io_price + 옵션 행 실등록) 재사용.
  fastify.post(
    '/pcb-projects/:id/cart',
    { schema: { params: ProjectIdParams } },
    async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.unauthorized('로그인이 필요합니다');
      }
      const cartId = request.user.cartId;
      if (cartId === undefined || cartId === '') {
        return reply.status(409).send({ result: false, error: 'NO_CART_ID' });
      }
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: BigInt(request.params.id), mbId: request.user.mbId, status: 'active' },
      });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');

      const quote = await prisma.spQuote.findUnique({ where: { id: spec.quoteId } });
      const price = spec.finalPrice ?? quote?.autoPrice ?? null;
      if (price === null) {
        return reply.status(409).send({ result: false, error: 'NOT_PRICED' });
      }
      if (spec.ctId !== null) {
        const state = (await getCartStates([spec.ctId])).get(spec.ctId);
        if (state === 'cart') {
          return reply.status(409).send({ result: false, error: 'ALREADY_IN_CART' });
        }
        if (state === 'ordered') {
          // 재주문 흐름은 추후 결정 — 뼈대에서는 거부
          return reply.status(409).send({ result: false, error: 'ALREADY_ORDERED' });
        }
      }
      const item = await getTemplateItem(spec.category);
      if (item === null) {
        return reply.status(500).send({ result: false, error: 'TEMPLATE_ITEM_MISSING' });
      }
      // 이전 담기의 잔존 옵션 행이 있을 수 있어(카트 행만 삭제된 경우) 선삭제로 멱등 보장
      await deleteQuoteOption(item.itId, spec.quoteId);
      await insertQuoteOption(item.itId, spec.quoteId, price);
      let ctId: number;
      try {
        ctId = await insertCartRow({
          odId: cartId,
          mbId: request.user.mbId,
          item,
          itemName: `${item.itName} · ${spec.projectName}`,
          ioId: spec.quoteId,
          price,
          option: buildOptionSummary(spec.specJson as PcbProjectPayloadType['spec'], spec.qty),
          ip: request.ip,
        });
      } catch (err) {
        await deleteQuoteOption(item.itId, spec.quoteId).catch(() => undefined);
        request.log.error({ err }, 'g5_shop_cart INSERT 실패 (견적관리 담기)');
        return reply.status(502).send({ result: false, error: 'CART_INSERT_FAILED' });
      }
      await prisma.spOrderSpec.update({ where: { id: spec.id }, data: { ctId } });
      return {
        result: true as const,
        data: { ctId, redirectUrl: `${WEB_BASE_URL}/shop/cart.php` },
      };
    },
  );

  // ── PATCH /api/pcb-projects/:id — 수량 수정(서버 재견적) ────────────────────
  // 관리자 확정(quoted)은 수량 변경 시 확정가 의미가 사라지므로 거부(재확정 플로우는 2차).
  // 담김(cart) 상태도 거부 — cart 행 가격과 어긋나므로 장바구니에서 뺀 뒤 수정.
  fastify.patch(
    '/pcb-projects/:id',
    { schema: { params: ProjectIdParams, body: PcbProjectQtyPatch } },
    async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return reply.unauthorized('로그인이 필요합니다');
      }
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: BigInt(request.params.id), mbId: request.user.mbId, status: 'active' },
      });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');
      if (spec.quoteStatus === 'quoted') {
        return reply.status(409).send({ result: false, error: 'QUOTE_FINALIZED' });
      }
      if (spec.ctId !== null) {
        const state = (await getCartStates([spec.ctId])).get(spec.ctId);
        if (state === 'cart') {
          return reply.status(409).send({ result: false, error: 'IN_CART' });
        }
      }

      const qty = request.body.qty;
      const requote = calculateQuote({
        category: spec.category,
        orderCategory: spec.orderCategory,
        qty,
        spec: spec.specJson as PcbProjectPayloadType['spec'],
      });
      const quoteStatus = requote.listPrice === null ? 'rfq' : 'priced';
      const specJson = spec.specJson as Prisma.InputJsonValue;
      const updated = await prisma.$transaction(async (tx) => {
        // 견적 스냅샷은 불변 — 재견적은 새 quoteId 발급으로 기록을 남긴다
        const q = await tx.spQuote.create({
          data: {
            category: spec.category,
            orderCategory: spec.orderCategory,
            qty,
            specJson,
            specHash: createHash('sha256').update(JSON.stringify(spec.specJson)).digest('hex'),
            autoPrice: requote.listPrice,
            eta: requote.eta === '' ? null : requote.eta,
            priceVersion: requote.priceVersion,
            expiresAt: new Date(Date.now() + QUOTE_TTL_HOURS * 3600 * 1000),
          },
        });
        await tx.spOrderSpec.update({
          where: { id: spec.id },
          data: { qty, quoteId: q.id, quoteStatus },
        });
        return q;
      });
      return {
        result: true as const,
        data: {
          qty,
          quoteId: updated.id,
          quoteStatus,
          price: requote.listPrice,
          eta: requote.eta === '' ? null : requote.eta,
        },
      };
    },
  );

  done();
};
