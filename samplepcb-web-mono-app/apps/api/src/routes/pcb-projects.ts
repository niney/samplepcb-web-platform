import { createHash } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { KNOWN_SPEC_KEYS, PcbProjectPayload } from '@sp/api-contract';
import type { PcbProjectPayloadType } from '@sp/api-contract';
import { calculateQuote } from '../pricing/engine';
import { uploadToFileServer } from '../lib/file-server';
import type { UploadTarget } from '../lib/file-server';
import { deleteQuoteOption, getTemplateItem, insertCartRow, insertQuoteOption } from '../lib/g5-db';
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
            const spec = payload.spec;
            const optionSummary = [
              String(spec.material ?? spec.kindPcb ?? ''),
              spec.layers !== undefined ? `${String(spec.layers)}L` : '',
              spec.width !== undefined && spec.length !== undefined
                ? `${String(spec.width)}x${String(spec.length)}mm`
                : '',
              `${String(payload.qty)}pcs`,
            ]
              .filter((s) => s !== '')
              .join(' / ');
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
                qty: payload.qty,
                option: optionSummary,
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
        // 담기 성공 → 장바구니, 그 외(rfq/실패)는 홈 ("내 PCB 프로젝트" 페이지 생기면 교체)
        redirectUrl: cartAdded ? `${WEB_BASE_URL}/shop/cart.php` : `${WEB_BASE_URL}/`,
        ...(unknownSpecKeys.length > 0 ? { unknownSpecKeys } : {}),
      },
    };
  });

  done();
};
