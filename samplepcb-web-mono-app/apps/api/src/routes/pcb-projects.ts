import { createHash } from 'node:crypto';
import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { KNOWN_SPEC_KEYS, PcbProjectPayload } from '@sp/api-contract';
import type { PcbProjectPayloadType } from '@sp/api-contract';
import { calculateQuote } from '../pricing/engine';
import { uploadToFileServer } from '../lib/file-server';
import type { UploadTarget } from '../lib/file-server';
import { prisma } from '../lib/prisma';

// ── POST /api/pcb-projects — 거버 담기 API (단일 multipart 호출) ────────────
// 거버 뷰어가 FormData(gerber + thumbnail + payload JSON)를 보내면:
//   ① payload Zod 검증  ② 견적 계산 + sp_quote 저장(가격은 서버만 계산)
//   ③ 파일서버 업로드 대행(pathToken 클라이언트 미노출)  ④ sp_order_spec + sp_file 저장
// g5_shop_cart 삽입은 미구현 — cart 의 od_id 가 PHP 세션(ss_cart_id)이라 sp-node 가
// 알 수 없어 "클레임" 설계(PHP 1-UPDATE 접점)가 필요하다. HANDOFF 참고. cartAdded=false.

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

    // ── 회원 식별(선택) — JWT 있으면 mbId 귀속, 없으면 비회원(null) ──
    let mbId: string | null = null;
    try {
      await request.jwtVerify();
      mbId = request.user.mbId;
    } catch {
      mbId = null;
    }

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

    request.log.info(
      { projectId: Number(project.spec.id), quoteId: project.quote.id, quoteStatus, price: quote.listPrice, mbId },
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
        // cart(od_id=PHP 세션) 바인딩 미구현 — 장바구니 페이지 준비 전까지 홈으로
        cartAdded: false,
        redirectUrl: `${WEB_BASE_URL}/`,
        ...(unknownSpecKeys.length > 0 ? { unknownSpecKeys } : {}),
      },
    };
  });

  done();
};
