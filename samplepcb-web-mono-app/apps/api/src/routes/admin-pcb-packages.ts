import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminPcbPackageResponse,
  ApiError,
  PcbShipmentPackageListResponse,
} from '@sp/api-contract';
import {
  PcbPackageError,
  loadAdminPcbPackage,
  loadPcbShipmentPackageList,
  markPcbShipmentPackagesPrinted,
} from '../lib/pcb-packages';

// PCB Case QR 관리자 API. token은 URL 식별자일 뿐 권한이 아니며 이 플러그인 전체가
// requireAdmin 뒤에 있다. 파트너 안전 라벨 목록과 고객 신원이 포함된 스캔 상세를 분리한다.

const ShipmentParams = z.object({ shipmentId: z.coerce.bigint() });
const PackageCodeParams = z.object({ code: z.string().trim().min(1).max(100) });

export const adminPcbPackageRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  fastify.get(
    '/pcb-shipments/:shipmentId/labels',
    {
      schema: {
        params: ShipmentParams,
        response: { 200: PcbShipmentPackageListResponse },
      },
    },
    async (request, reply) => {
      const data = await loadPcbShipmentPackageList(request.params.shipmentId, {
        type: 'ADMIN',
        mbId: request.user.mbId,
      });
      if (data === null) return reply.notFound('PCB 발송을 찾을 수 없습니다');
      return { result: true as const, data };
    },
  );

  fastify.post(
    '/pcb-shipments/:shipmentId/labels/print',
    {
      schema: {
        params: ShipmentParams,
        response: { 200: PcbShipmentPackageListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      try {
        const data = await markPcbShipmentPackagesPrinted(request.params.shipmentId, {
          type: 'ADMIN',
          mbId: request.user.mbId,
        });
        return { result: true as const, data };
      } catch (error) {
        if (!(error instanceof PcbPackageError)) throw error;
        if (error.code === 'PACKAGE_SHIPMENT_NOT_FOUND') {
          return reply.notFound('PCB 발송을 찾을 수 없습니다');
        }
        return reply
          .status(409)
          .send({ error: error.code, message: '인쇄할 PCB QR 라벨이 없습니다.' });
      }
    },
  );

  fastify.get(
    '/pcb-packages/:code',
    {
      schema: {
        params: PackageCodeParams,
        response: { 200: AdminPcbPackageResponse },
      },
    },
    async (request, reply) => {
      const data = await loadAdminPcbPackage(request.params.code);
      if (data === null) return reply.notFound('PCB QR을 찾을 수 없습니다');
      return { result: true as const, data };
    },
  );

  done();
};
