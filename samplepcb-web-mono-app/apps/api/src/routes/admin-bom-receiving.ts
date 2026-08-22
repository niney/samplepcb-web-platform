import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminBomReceivingDigikeyLookupBody,
  AdminBomReceivingDigikeyLookupResponse,
  AdminBomReceivingProgressResponse,
  AdminBomReceivingRecentQuery,
  AdminBomReceivingRecentResponse,
  AdminBomReceivingRecordBody,
  AdminBomReceivingRecordResponse,
  AdminBomReceivingScanBody,
  AdminBomReceivingScanResponse,
  ApiError,
} from '@sp/api-contract';
import {
  findReceivingCandidates,
  loadReceivingProgress,
  loadRecentReceivingScans,
  recordReceivingScan,
  toParsedBarcodeView,
  voidReceivingScan,
} from '../lib/bom-receiving';
import { parseSupplierBarcode } from '../lib/supplier-barcode';
import { digikeyBarcodeLookup } from '../lib/digikey-oauth';

// ── /api/admin/bom-receiving — 입고 스캔(D42) ─────────────────────────────────────────
// 공급사 봉투 라벨(ECIA 2D)을 찍어 열린 공급사 발주 품목에 입고를 기록한다. 전 라우트 requireAdmin.
// scan(대조만, 무부작용) / scans(박제) / scans 목록 / scans/:id 취소 / pos/:poId 진행.

const ScanIdParams = z.object({ scanId: z.coerce.bigint() });
const PoIdParams = z.object({ poId: z.coerce.bigint() });

const RECORD_ERROR_MESSAGE = {
  PO_ITEM_NOT_FOUND: '발주 품목을 찾을 수 없습니다.',
  PO_CLOSED: '마감된 발주서에는 입고를 기록할 수 없습니다.',
  NOT_SUPPLIER_PO: '공급사 발주서의 품목에만 입고 스캔을 기록합니다.',
  QUANTITY_REQUIRED: '라벨에 수량이 없습니다 — 수량을 직접 입력해 주세요.',
  SCAN_NOT_FOUND: '스캔 기록을 찾을 수 없습니다.',
  ALREADY_VOIDED: '이미 취소된 스캔입니다.',
} as const;

const DIGIKEY_ERROR_MESSAGE = {
  NOT_CONNECTED: 'DigiKey 가 연결되어 있지 않습니다 — [DigiKey 연결]을 먼저 해 주세요.',
  REFRESH_EXPIRED: 'DigiKey 연결이 만료되었습니다(90일) — 다시 연결해 주세요.',
  REFRESH_FAILED: 'DigiKey 토큰 갱신에 실패했습니다 — 다시 연결해 주세요.',
  LOOKUP_FAILED: 'DigiKey 바코드 조회에 실패했습니다.',
} as const;

export const adminBomReceivingRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // 대조만 — 라벨을 읽고 어느 발주 품목인지 후보를 돌려준다(무부작용, §7 조회 가드).
  fastify.post(
    '/bom-receiving/scan',
    { schema: { body: AdminBomReceivingScanBody, response: { 200: AdminBomReceivingScanResponse } } },
    async (request) => {
      const parsed = parseSupplierBarcode(request.body.barcode);
      const candidates = parsed === null ? [] : await findReceivingCandidates(parsed);
      return {
        result: true as const,
        data: { parsed: parsed === null ? null : toParsedBarcodeView(parsed), candidates },
      };
    },
  );

  // 박제 — 발주 품목을 골라(또는 미매칭으로) 입고 1건을 남긴다.
  fastify.post(
    '/bom-receiving/scans',
    {
      schema: {
        body: AdminBomReceivingRecordBody,
        response: { 200: AdminBomReceivingRecordResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await recordReceivingScan({
        barcode: request.body.barcode,
        poItemId: request.body.poItemId === null ? null : BigInt(request.body.poItemId),
        quantity: request.body.quantity,
        note: request.body.note,
        scannedBy: request.user.mbId,
        override: request.body.override ?? null,
      });
      if (!result.ok) {
        return reply
          .status(409)
          .send({ error: result.error, message: RECORD_ERROR_MESSAGE[result.error] });
      }
      return { result: true as const, data: result.data };
    },
  );

  fastify.get(
    '/bom-receiving/scans',
    {
      schema: {
        querystring: AdminBomReceivingRecentQuery,
        response: { 200: AdminBomReceivingRecentResponse },
      },
    },
    async (request) => ({
      result: true as const,
      data: {
        scans: await loadRecentReceivingScans({
          limit: request.query.limit,
          ...(request.query.poId === undefined ? {} : { poId: BigInt(request.query.poId) }),
          includeVoided: request.query.includeVoided === '1',
        }),
      },
    }),
  );

  fastify.delete(
    '/bom-receiving/scans/:scanId',
    {
      schema: {
        params: ScanIdParams,
        response: { 200: AdminBomReceivingRecordResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await voidReceivingScan(request.params.scanId);
      if (!result.ok) {
        if (result.error === 'SCAN_NOT_FOUND') return reply.notFound(RECORD_ERROR_MESSAGE.SCAN_NOT_FOUND);
        return reply
          .status(409)
          .send({ error: result.error, message: RECORD_ERROR_MESSAGE[result.error] });
      }
      return { result: true as const, data: result.data };
    },
  );

  // DigiKey Barcoding 조회(3-legged 연결 필요) — 1D 구형 라벨·검증용 보조. 조회만, 박제는 scans 로.
  fastify.post(
    '/bom-receiving/digikey-lookup',
    {
      schema: {
        body: AdminBomReceivingDigikeyLookupBody,
        response: { 200: AdminBomReceivingDigikeyLookupResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const result = await digikeyBarcodeLookup(request.body.barcode);
      if (!result.ok) {
        // DigiKey 는 자기 라벨이 아닌 문자열(테스트·타사 라벨·품번 타이핑)을 400 "Invalid … barcode" 로 거부한다 —
        // 실제 DigiKey 봉투 2D(또는 구형 22자 숫자 1D)만 풀린다는 뜻이라 안내를 덧붙인다.
        const hint =
          result.detail !== undefined && /Invalid Digi-Key product/i.test(result.detail)
            ? ' — 실제 DigiKey 봉투 라벨(2D) 또는 구형 봉투의 22자 숫자 바코드만 조회됩니다. 테스트 문자열·타사 라벨·품번 입력은 DigiKey 가 거부합니다.'
            : '';
        return reply.status(409).send({
          error: result.error,
          message:
            result.detail === undefined
              ? DIGIKEY_ERROR_MESSAGE[result.error]
              : `${DIGIKEY_ERROR_MESSAGE[result.error]} (${result.detail})${hint}`,
        });
      }
      const candidates = await findReceivingCandidates({
        supplier: 'digikey',
        fields: {
          supplierSku: result.lookup.digiKeyPartNumber,
          mpn: result.lookup.manufacturerPartNumber,
        },
      });
      return { result: true as const, data: { lookup: result.lookup, candidates } };
    },
  );

  fastify.get(
    '/bom-receiving/pos/:poId',
    { schema: { params: PoIdParams, response: { 200: AdminBomReceivingProgressResponse } } },
    async (request, reply) => {
      const progress = await loadReceivingProgress(request.params.poId);
      if (progress === null) return reply.notFound('발주서를 찾을 수 없습니다');
      return { result: true as const, data: progress };
    },
  );

  done();
};
