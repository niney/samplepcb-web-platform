import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ApiError,
  CustomerPcbClaimListResponse,
  PCB_CLAIM_ELIGIBILITY_LABELS,
  PCB_CLAIM_KIND_LABELS,
  PcbClaimCreateFields,
  PcbClaimCreateResponse,
  type CustomerPcbClaimSpecViewType,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { getCartRowsByOdId, getOrderInfoByCtId, getOrdererContactByOdId } from '../lib/g5-db';
import {
  createPcbClaim,
  isPcbClaimActive,
  pcbClaimInclude,
  resolvePcbClaimEligibilityReason,
  serializePcbClaims,
  uploadPcbClaimFile,
} from '../lib/pcb-claim';
import { collectMultipart } from '../lib/market';
import { buildPcbClaimReceivedEmail, sendPcbMail } from '../lib/pcb-rfq-email';

// ── PCB 고객 클레임(A/S 접수, P5) — docs/PCB_PARTNER_TRACK.md §9 A/S ─────────
// 소비처는 **sp-php 주문내역 상세**다(EQ 확인 D16 과 같은 브리지: 테마가 서버사이드
// 조회, 접수는 spcb/api/claim-create 브리지의 POST). 회원 주문만 — 소유권은
// spec.mbId 로 판정한다. 접수는 사진을 동반한 1회 제출(multipart)이라 필드 검증은
// collectMultipart 뒤 PcbClaimCreateFields 로 한다.

const OdQuery = z.object({ odId: z.string().min(1) });

const CREATE_ERROR_MESSAGES: Record<string, string> = {
  ...PCB_CLAIM_ELIGIBILITY_LABELS,
  QTY_EXCEEDS_ORDER: '문제 수량은 주문 수량을 넘을 수 없습니다.',
};

export const pcbClaimRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.authenticate);

  // ── GET /pcb-claims?odId= — 내 주문의 PCB 스펙별 접수 가능 여부 + 이력 ──────
  fastify.get(
    '/pcb-claims',
    { schema: { querystring: OdQuery, response: { 200: CustomerPcbClaimListResponse } } },
    async (request) => {
      const rows = await getCartRowsByOdId(request.query.odId);
      const ctIds = rows.map((r) => r.ctId);
      if (ctIds.length === 0) return { result: true as const, data: { specs: [] } };
      const specs = await prisma.spOrderSpec.findMany({
        where: { ctId: { in: ctIds }, mbId: request.user.mbId },
        orderBy: { id: 'asc' },
      });
      const out: CustomerPcbClaimSpecViewType[] = [];
      for (const spec of specs) {
        const claims = await prisma.spPcbClaim.findMany({
          where: { specId: spec.id },
          include: pcbClaimInclude,
          orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
        });
        const active = claims.find((c) => isPcbClaimActive(c.status));
        const order = spec.ctId === null ? null : await getOrderInfoByCtId(spec.ctId);
        const reason = resolvePcbClaimEligibilityReason({
          ctId: spec.ctId,
          order:
            order === null ? null : { odStatus: order.odStatus, ctStatus: order.rowCtStatus },
          hasActiveClaim: active !== undefined,
        });
        out.push({
          specId: String(spec.id),
          ctId: spec.ctId ?? 0,
          projectName: spec.projectName,
          qty: spec.qty,
          eligibility: {
            canSubmit: reason === null,
            reason,
            activeClaimId: active === undefined ? null : String(active.id),
          },
          claims: await serializePcbClaims(claims),
        });
      }
      return { result: true as const, data: { specs: out } };
    },
  );

  // ── POST /pcb-claims — 접수(multipart: 필드 + 사진 여러 장, 1회 제출) ────────
  fastify.post(
    '/pcb-claims',
    { schema: { response: { 200: PcbClaimCreateResponse, 400: ApiError, 404: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const { files, fields } = await collectMultipart(request);
      const parsed = PcbClaimCreateFields.safeParse(fields);
      if (!parsed.success) {
        return reply.status(400).send({
          error: 'BAD_CLAIM',
          message: '접수 내용을 확인해 주세요 — 유형·수량·증상 설명이 필요합니다.',
        });
      }
      // 소유권 — 내 스펙만. 대상 스펙이 남의 것이면 존재 자체를 감춘다(404).
      const spec = await prisma.spOrderSpec.findFirst({
        where: { id: parsed.data.specId, mbId: request.user.mbId, status: 'active' },
      });
      if (spec === null) return reply.notFound('주문 건을 찾을 수 없습니다');

      const r = await createPcbClaim(spec, {
        kind: parsed.data.kind,
        affectedQty: parsed.data.affectedQty,
        description: parsed.data.description,
        requestedRemedy: parsed.data.requestedRemedy,
        createdByRole: 'customer',
        createdBy: request.user.mbId,
      });
      if (!r.ok) {
        return reply.status(409).send({
          error: r.error,
          message: CREATE_ERROR_MESSAGES[r.error] ?? '접수할 수 없습니다.',
        });
      }
      for (const file of files) {
        await uploadPcbClaimFile(r.claim.id, file, 'CUSTOMER');
      }

      // 접수 확인 메일 — 수신처는 주문 시점 이메일(od_email). 실패해도 접수는 성립한다.
      const contact = await getOrdererContactByOdId(r.claim.odId);
      void sendPcbMail(
        request.log,
        contact?.email,
        buildPcbClaimReceivedEmail({
          customerName: contact?.name ?? request.user.mbId,
          projectName: spec.projectName,
          kindLabel: PCB_CLAIM_KIND_LABELS[parsed.data.kind],
          affectedQty: parsed.data.affectedQty,
          orderedQty: spec.qty,
          byAdmin: false,
        }),
        {
          kind: 'pcb_claim_received',
          refType: 'pcb_spec',
          refId: spec.id,
          sentBy: request.user.mbId,
          params: { claimId: String(r.claim.id), odId: r.claim.odId },
        },
      );

      const [view] = await serializePcbClaims([r.claim]);
      if (view === undefined) throw new Error('클레임 직렬화 실패');
      return { result: true as const, data: { claim: view } };
    },
  );

  done();
};
