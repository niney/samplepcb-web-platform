import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ADMIN_PCB_PO_TABS,
  ADMIN_PCB_SHIPMENT_TABS,
  AdminPcbPoCreateBody,
  AdminPcbPoListResponse,
  AdminPcbPoPatchBody,
  AdminPcbPoWorkListResponse,
  AdminPcbShipmentWorkListResponse,
  ApiError,
  BomInvoiceData,
  BomShipmentFileType,
  PcbInvoiceResponse,
  PcbPoActionResponse,
  PcbPoRejectBody,
  PcbShipmentAdvanceBody,
  PcbShipmentReceiveBody,
  asPcbEqFileType,
  bomShipmentStatusLabel,
  canEditPcbEqFile,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  advancePcbPoEq,
  asPcbPoStatus,
  countPcbEqReplyFiles,
  createAdminPcbPo,
  deletePcbPo,
  deletePcbEqFile,
  getPcbEqFileDownload,
  getPcbEqFileType,
  loadAdminPcbPoWorkItems,
  loadAdminPcbPos,
  loadPcbPoWithPartner,
  patchPcbPo,
  rejectPcbPoEq,
  revertPcbPoEq,
  uploadPcbEqFile,
} from '../lib/pcb-po';
import { loadHousePartnerName } from '../lib/pcb-rfq';
import {
  advancePcbShipment,
  buildPcbInvoiceDraft,
  deletePcbShipmentFile,
  ensurePcbShipment,
  findPcbShipmentByPo,
  getPcbShipmentFileDownload,
  loadAdminPcbShipmentWorkItems,
  loadPcbShipmentsForPoIds,
  cancelPcbShipment,
  countPcbShipmentPos,
  receivePcbShipment,
  revertPcbShipment,
  savePcbInvoiceData,
  savePcbShipmentFile,
} from '../lib/pcb-shipment';
import { renderInvoiceXlsx } from '../lib/bom-invoice';
import {
  buildPcbEqDecisionEmail,
  buildPcbPoIssuedEmail,
  buildPcbShipmentReceivedEmail,
  buildPcbShipmentTurnEmail,
  pcbPartnerPortalUrl,
  pcbPriceText,
  sendPcbMail,
} from '../lib/pcb-rfq-email';
import { collectMultipart } from '../lib/market';
import { downloadFromFileServer } from '../lib/file-server';
import { resolvePcbPortalCta } from '../lib/pcb-portal-cta';
import { kstDateStr } from '../lib/kst';

// ── PCB 발주서·EQ 관리자 라우트(P2) — docs/PCB_PARTNER_TRACK.md §5.4 ──────────
// 발행(paid 게이트)·조건 수정·삭제 + EQ 승인/반려/되돌리기(관리자=ORDERER, D3) +
// 횡단 워크큐(/pcb-pos). 전 라우트 requireAdmin.

const IdParams = z.object({ id: z.coerce.bigint() });
const PoParams = z.object({ id: z.coerce.bigint(), poId: z.coerce.bigint() });
const PoFileParams = z.object({
  id: z.coerce.bigint(),
  poId: z.coerce.bigint(),
  fileId: z.coerce.bigint(),
});

const WorkListQuery = z.object({
  tab: z.enum(ADMIN_PCB_PO_TABS).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});

const CREATE_ERROR_MESSAGES: Record<string, { code: 400 | 409; message: string }> = {
  NOT_ORDERED: { code: 409, message: '고객 주문이 아직 없습니다 — 주문·결제 후 발주할 수 있습니다.' },
  ORDER_CLOSED: { code: 409, message: '완료·취소된 PCB 주문에는 발주서를 발행할 수 없습니다.' },
  NOT_PAID: { code: 409, message: '결제(입금) 확인 전입니다 — 입금 확인 후 발주할 수 있습니다.' },
  ALREADY_ISSUED: { code: 409, message: '이 협력사에게 이미 발주서가 있습니다.' },
  RFQ_MISMATCH: { code: 400, message: '견적행이 이 스펙·협력사와 일치하지 않습니다.' },
  RFQ_NOT_SELECTED: {
    code: 409,
    message: '선정되지 않은 회신입니다 — [선정] 후 발주하거나, 견적행 없이 조건을 직접 입력하세요.',
  },
  PRICE_REQUIRED: { code: 400, message: '발주가를 입력해 주세요(회신 견적이 없는 직접 발주).' },
  EXCHANGE_RATE_REQUIRED: { code: 400, message: '외화 발주에는 KRW 회계 환율이 필요합니다.' },
};

export const adminPcbPoRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  // 발주 패널 응답 — 발주서 + 소속 선적(P3 확장)을 함께 싣는다.
  const loadPanel = async (specId: bigint) => {
    const [pos, ids] = await Promise.all([
      loadAdminPcbPos(specId),
      prisma.spPcbPo.findMany({ where: { specId }, select: { id: true } }),
    ]);
    return { pos, shipments: await loadPcbShipmentsForPoIds(ids.map((r) => r.id)) };
  };

  // 포털 CTA 분기(재점검 #15)는 lib/pcb-portal-cta.ts resolvePcbPortalCta 로 승격 —
  // EQ 결정에서 시작해 협력사향 포털 CTA 메일 전수(발주·선적·입고·A/S)가 공유한다.

  // ── GET /pcb-pos — 횡단 워크큐(경유 상위 제외한 실작업 단위) ────────────────
  fastify.get(
    '/pcb-pos',
    { schema: { querystring: WorkListQuery, response: { 200: AdminPcbPoWorkListResponse } } },
    async (request) => {
      const all = await loadAdminPcbPoWorkItems();
      const q = request.query.q?.toLowerCase() ?? '';
      const filtered = all.filter(
        ({ item }) =>
          q === '' ||
          item.projectName.toLowerCase().includes(q) ||
          item.partnerName.toLowerCase().includes(q) ||
          item.customerName.toLowerCase().includes(q) ||
          (item.mbId ?? '').toLowerCase().includes(q),
      );
      const counts = {
        eq_pending: filtered.filter((r) => r.tabs.includes('eq_pending')).length,
        producing: filtered.filter((r) => r.tabs.includes('producing')).length,
        produced: filtered.filter((r) => r.tabs.includes('produced')).length,
        to_ship: filtered.filter((r) => r.tabs.includes('to_ship')).length,
        all: filtered.length,
      };
      const tab = request.query.tab;
      const tabbed = tab === 'all' ? filtered : filtered.filter((r) => r.tabs.includes(tab));
      const start = (request.query.page - 1) * request.query.pageSize;
      return {
        result: true as const,
        data: {
          items: tabbed.slice(start, start + request.query.pageSize).map((r) => r.item),
          total: tabbed.length,
          page: request.query.page,
          pageSize: request.query.pageSize,
          counts,
        },
      };
    },
  );

  // ── GET — 스펙별 발주 현황 ──────────────────────────────────────────────────
  fastify.get(
    '/pcb-projects/:id/pos',
    { schema: { params: IdParams, response: { 200: AdminPcbPoListResponse } } },
    async (request, reply) => {
      const spec = await prisma.spOrderSpec.findUnique({ where: { id: request.params.id } });
      if (spec === null) return reply.notFound('프로젝트가 없습니다');
      return { result: true as const, data: await loadPanel(spec.id) };
    },
  );

  // ── POST — 발주서 발행(paid 게이트) + 협력사 메일 ───────────────────────────
  fastify.post(
    '/pcb-projects/:id/pos',
    {
      schema: {
        params: IdParams,
        body: AdminPcbPoCreateBody,
        response: { 200: AdminPcbPoListResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const created = await createAdminPcbPo(request.params.id, request.body);
      if (!created.ok) {
        if (created.error === 'SPEC_NOT_FOUND') return reply.notFound('프로젝트가 없습니다');
        if (created.error === 'PARTNER_INVALID')
          return reply
            .status(400)
            .send({ error: created.error, message: created.detail ?? '협력사 검증 실패' });
        const mapped = CREATE_ERROR_MESSAGES[created.error];
        if (mapped !== undefined)
          return reply.status(mapped.code).send({ error: created.error, message: mapped.message });
        return reply.status(409).send({ error: created.error, message: '발주할 수 없습니다.' });
      }

      const spec = await prisma.spOrderSpec.findUnique({ where: { id: request.params.id } });
      if (spec !== null) {
        const [requesterName, portalCta] = await Promise.all([
          loadHousePartnerName(),
          resolvePcbPortalCta(created.po.partnerId),
        ]);
        void sendPcbMail(
          request.log,
          created.partner.contactEmail,
          buildPcbPoIssuedEmail({
            partnerName: created.partner.name,
            requesterName,
            projectName: spec.projectName,
            qty: spec.qty,
            priceText: pcbPriceText(
              created.po.currency,
              Number(created.po.priceOriginal),
              created.po.subCurrency,
              created.po.subPriceOriginal === null ? null : Number(created.po.subPriceOriginal),
            ),
            deliveryText: created.po.deliveryDate === null ? null : kstDateStr(created.po.deliveryDate),
            ...portalCta,
          }),
          {
            kind: 'pcb_po_issued',
            refType: 'pcb_spec',
            refId: request.params.id,
            sentBy: request.user.mbId,
            params: { poId: String(created.po.id), partnerName: created.partner.name },
          },
        );
      }
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  // ── PATCH — 조건 수정(금액·환율은 issued 에서만) ────────────────────────────
  fastify.patch(
    '/pcb-projects/:id/pos/:poId',
    {
      schema: {
        params: PoParams,
        body: AdminPcbPoPatchBody,
        response: { 200: AdminPcbPoListResponse, 400: ApiError, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await patchPcbPo(po.id, { kind: 'admin' }, request.body);
      if (!res.ok) {
        if (res.error === 'PO_NOT_FOUND' || res.error === 'NOT_ISSUER')
          return reply.notFound('발주서를 찾을 수 없습니다');
        if (res.error === 'EXCHANGE_RATE_REQUIRED')
          return reply
            .status(400)
            .send({ error: res.error, message: '외화 발주에는 KRW 회계 환율이 필요합니다.' });
        return reply.status(409).send({
          error: res.error,
          message:
            res.error === 'IN_SHIPMENT'
              ? '발송이 만들어진 발주는 직송지를 바꿀 수 없습니다 — 발송을 정리한 뒤 변경하세요.'
              : '발주가는 EQ 시작 전(발주접수)에만 수정할 수 있습니다.',
        });
      }
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  // ── DELETE — 발행 취소(issued·하위 없음) ────────────────────────────────────
  fastify.delete(
    '/pcb-projects/:id/pos/:poId',
    { schema: { params: PoParams, response: { 200: AdminPcbPoListResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await deletePcbPo(po.id, { kind: 'admin' });
      if (!res.ok) {
        if (res.error === 'PO_NOT_FOUND' || res.error === 'NOT_ISSUER')
          return reply.notFound('발주서를 찾을 수 없습니다');
        const DELETE_MESSAGES: Record<string, string> = {
          HAS_CHILDREN: '하위(MD) 발주서가 남아 있어 취소할 수 없습니다 — 하위부터 정리하세요.',
          HAS_REMITTANCE:
            '송금 기록이 있는 발주는 취소할 수 없습니다 — 송금 원장을 먼저 정리하세요(돈 기록이 함께 사라지는 것을 막습니다).',
          IN_SHIPMENT: '발송에 담긴 발주는 취소할 수 없습니다 — 보드에서 꺼낸 뒤 취소하세요.',
        };
        const message =
          DELETE_MESSAGES[res.error] ??
          'EQ 진행 중인 발주서는 되돌리기로 발주접수까지 낮춘 뒤 취소할 수 있습니다.';
        return reply.status(409).send({ error: res.error, message });
      }
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  // ── EQ 승인/반려/되돌리기 — 관리자=ORDERER(D3) ──────────────────────────────
  fastify.post(
    '/pcb-projects/:id/pos/:poId/eq-approve',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await advancePcbPoEq(po.id, { kind: 'admin' }, 'eq_requested');
      if (!res.ok)
        return reply.status(409).send({
          error: res.error,
          message:
            res.error === 'ORDER_CANCELED'
              ? '취소된 주문입니다 — 재작업은 A/S 재발주로 진행하세요.'
              : 'EQ 승인요청 상태에서만 승인할 수 있습니다.',
        });

      const [spec, portalCta] = await Promise.all([
        prisma.spOrderSpec.findUnique({ where: { id: po.specId } }),
        resolvePcbPortalCta(po.partnerId),
      ]);
      void sendPcbMail(
        request.log,
        po.partner.contactEmail,
        buildPcbEqDecisionEmail({
          partnerName: po.partner.name,
          projectName: spec?.projectName ?? `Q${po.specId.toString()}`,
          approved: true,
          reason: null,
          poId: String(po.id),
          ...portalCta,
        }),
        {
          kind: 'pcb_eq_decision',
          refType: 'pcb_spec',
          refId: po.specId,
          sentBy: request.user.mbId,
          params: { poId: String(po.id), partnerName: po.partner.name, approved: true },
        },
      );
      return { result: true as const };
    },
  );

  fastify.post(
    '/pcb-projects/:id/pos/:poId/eq-reject',
    {
      schema: {
        params: PoParams,
        body: PcbPoRejectBody,
        response: { 200: PcbPoActionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await rejectPcbPoEq(po.id, request.body.reason);
      if (!res.ok)
        return reply
          .status(409)
          .send({ error: res.error, message: 'EQ 승인요청 상태에서만 반려할 수 있습니다.' });

      const [spec, portalCta, replyFileCount] = await Promise.all([
        prisma.spOrderSpec.findUnique({ where: { id: po.specId } }),
        resolvePcbPortalCta(po.partnerId),
        // 회신 첨부는 메일에 붙이지 않는다(포털에서 받는다) — 대신 **있다는 사실**을 알린다.
        // 사유만 오는 반려와 "도면을 봐야 하는" 반려는 협력사가 할 일이 다르다.
        countPcbEqReplyFiles(po.id),
      ]);
      void sendPcbMail(
        request.log,
        po.partner.contactEmail,
        buildPcbEqDecisionEmail({
          partnerName: po.partner.name,
          projectName: spec?.projectName ?? `Q${po.specId.toString()}`,
          approved: false,
          reason: request.body.reason,
          poId: String(po.id),
          replyFileCount,
          ...portalCta,
        }),
        {
          kind: 'pcb_eq_decision',
          refType: 'pcb_spec',
          refId: po.specId,
          sentBy: request.user.mbId,
          params: { poId: String(po.id), partnerName: po.partner.name, approved: false },
        },
      );
      return { result: true as const };
    },
  );

  fastify.post(
    '/pcb-projects/:id/pos/:poId/eq-revert',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await revertPcbPoEq(po.id, { kind: 'admin' });
      if (!res.ok) {
        // 관리자는 **차례와 무관하게** 되돌린다(D11 만능 대행 — revertPcbPoEq 의
        // `actor.kind !== 'admin'` 예외). 그래서 "관리자 차례가 아니다"는 안내는 실제로
        // 일어날 수 없는 이유였고, 진짜 원인(되돌릴 단계 없음 · MD 위임 중)을 가렸다.
        const REVERT_ERROR: Record<string, string> = {
          NOTHING_TO_REVERT: '되돌릴 단계가 없습니다 — 이미 첫 단계(발주접수)입니다.',
          DELEGATED: 'MD 경유 발주입니다 — EQ 진행·되돌리기는 하위 발주에서 합니다.',
          PO_NOT_FOUND: '발주서를 찾을 수 없습니다.',
        };
        return reply.status(409).send({
          error: res.error,
          message: REVERT_ERROR[res.error] ?? '되돌릴 수 없습니다.',
        });
      }
      return { result: true as const };
    },
  );

  // ── EQ·생산 대행 전이(D11) — 협력사 포털 미온보딩(레거시 진행분) 대비 ─────────
  // 선적의 관리자 만능 대행과 같은 원칙. 이력에 byRole 'ADMIN' 으로 남는다.
  const SUBSTITUTE_STEPS = [
    { path: 'eq-request', from: 'issued', label: 'EQ 승인요청' },
    { path: 'production-start', from: 'eq_done', label: '생산 시작' },
    { path: 'production-complete', from: 'producing', label: '생산 완료' },
  ] as const;
  for (const step of SUBSTITUTE_STEPS) {
    fastify.post(
      `/pcb-projects/:id/pos/:poId/${step.path}`,
      { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
      async (request, reply) => {
        const po = await loadPcbPoWithPartner(request.params.poId);
        if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
        if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
        const res = await advancePcbPoEq(po.id, { kind: 'admin' }, step.from);
        if (!res.ok)
          return reply.status(409).send({
            error: res.error,
            message:
              res.error === 'ORDER_CANCELED'
                ? '취소된 주문입니다 — 재작업은 A/S 재발주로 진행하세요.'
                : `${step.label} 대행을 진행할 수 없는 상태입니다.`,
          });
        return { result: true as const };
      },
    );
  }

  // ── EQ 첨부 업로드/삭제 — 두 갈래다 ─────────────────────────────────────────
  // ① eq·working = 협력사 산출물 대행 업로드(D11) — 포털과 같은 잠금(issued 에서만)
  // ② reply = **관리자 회신**(반려하며 돌려보내는 수정지시) — 승인요청을 받은 상태에서도
  //    붙일 수 있다. 판정은 계약의 canEditPcbEqFile 하나(포털과 같은 사전).
  fastify.post(
    '/pcb-projects/:id/pos/:poId/eq-files',
    { schema: { params: PoParams, response: { 200: PcbPoActionResponse, 400: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const { files, fields } = await collectMultipart(request);
      const kind = asPcbEqFileType(fields.fileType);
      const file = files[0];
      if (kind === null || file === undefined) {
        return reply.status(400).send({
          error: 'BAD_UPLOAD',
          message: 'fileType(eq|working|reply)과 파일이 필요합니다.',
        });
      }
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      if (!canEditPcbEqFile(kind, asPcbPoStatus(po.status))) {
        return reply.status(409).send({
          error: 'EQ_LOCKED',
          message:
            kind === 'reply'
              ? '생산이 시작된 뒤에는 회신 첨부를 올릴 수 없습니다.'
              : 'EQ 승인요청 후에는 파일을 바꿀 수 없습니다 — 요청을 되돌린 뒤 교체하세요.',
        });
      }
      await uploadPcbEqFile(po.id, file, kind, 'ADMIN');
      return { result: true as const };
    },
  );

  fastify.delete(
    '/pcb-projects/:id/pos/:poId/eq-files/:fileId',
    { schema: { params: PoFileParams, response: { 200: PcbPoActionResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      // 잠금은 **종류마다 다르다** — 회신(reply)은 승인요청 중에도 붙였다 뗄 수 있어야 한다.
      const kind = await getPcbEqFileType(po.id, request.params.fileId);
      if (kind === null) return reply.notFound('파일을 찾을 수 없습니다');
      if (!canEditPcbEqFile(kind, asPcbPoStatus(po.status))) {
        return reply.status(409).send({
          error: 'EQ_LOCKED',
          message:
            kind === 'reply'
              ? '생산이 시작된 뒤에는 회신 첨부를 지울 수 없습니다.'
              : 'EQ 승인요청 후에는 파일을 바꿀 수 없습니다 — 요청을 되돌린 뒤 교체하세요.',
        });
      }
      const removed = await deletePcbEqFile(po.id, request.params.fileId);
      if (!removed) return reply.notFound('파일을 찾을 수 없습니다');
      return { result: true as const };
    },
  );

  // ── EQ 첨부 다운로드(관리자 열람) ───────────────────────────────────────────
  fastify.get(
    '/pcb-projects/:id/pos/:poId/eq-files/:fileId',
    { schema: { params: PoFileParams } },
    async (request, reply) => {
      const po = await loadPcbPoWithPartner(request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      if (po.specId !== request.params.id) return reply.notFound('발주서를 찾을 수 없습니다');
      const file = await getPcbEqFileDownload(po.id, request.params.fileId);
      if (file === null) return reply.notFound('파일을 찾을 수 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일을 찾을 수 없습니다');
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .header('content-type', downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  // ═══ P3 선적 — 핑퐁(관리자=받는측/만능 대행)·입고확인·첨부·상업송장·워크큐 ═══

  const SHIP_ERROR_MESSAGES: Record<string, string> = {
    NOT_PRODUCED: '생산완료된 발주서만 발송할 수 있습니다.',
    PARTNER_COUNTRY_REQUIRED: '협력사 소재 국가가 필요합니다 — 파트너 관리에서 설정하세요.',
    OUTBOUND_BLOCKED: '하위(MD) 입고 확인이 끝나야 출고할 수 있습니다.',
    ALREADY_FINAL: '이미 마지막 단계입니다.',
    NOT_YOUR_TURN: '지금은 상대 차례입니다.',
    MISSING_SHIP_DATE: '출고예정일이 필요합니다.',
    MISSING_INVOICE_FILE: 'Invoice 첨부가 필요합니다(상업송장 생성기로 만들 수 있습니다).',
    MISSING_TRACKING: '운송장(택배사·송장번호)이 필요합니다.',
    NOTHING_TO_REVERT: '되돌릴 단계가 없습니다.',
    RECEIVE_LOCKED: '입고확인된 발송은 되돌릴 수 없습니다.',
    RECEIVE_REQUIRED: '국내 입고 완료는 [입고 확인]으로 처리해 주세요 — 검수 시각이 함께 남습니다.',
    ORDER_CANCELED: '취소된 주문입니다 — 재작업은 A/S 재발주로 진행하세요.',
    NOT_SHIPPED: '발송 시작 전에는 입고확인할 수 없습니다.',
    NOT_PREPARING: '발송이 시작된 선적은 취소할 수 없습니다 — 되돌리기로 준비 단계까지 내린 뒤 취소하세요.',
  };
  const shipError = (error: string): { error: string; message: string } => ({
    error,
    message: SHIP_ERROR_MESSAGES[error] ?? '처리할 수 없습니다.',
  });

  const loadPoChecked = async (id: bigint, poId: bigint) => {
    const po = await loadPcbPoWithPartner(poId);
    if (po === null) return null;
    if (po.specId !== id) return null;
    return po;
  };

  fastify.get(
    '/pcb-shipments',
    {
      schema: {
        querystring: z.object({
          tab: z.enum(ADMIN_PCB_SHIPMENT_TABS).default('all'),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: { 200: AdminPcbShipmentWorkListResponse },
      },
    },
    async (request) => {
      const all = await loadAdminPcbShipmentWorkItems();
      const counts = {
        pending: all.filter((r) => r.tab === 'pending').length,
        active: all.filter((r) => r.tab === 'active').length,
        received: all.filter((r) => r.tab === 'received').length,
        all: all.length,
      };
      const tabbed =
        request.query.tab === 'all' ? all : all.filter((r) => r.tab === request.query.tab);
      const start = (request.query.page - 1) * request.query.pageSize;
      return {
        result: true as const,
        data: {
          items: tabbed.slice(start, start + request.query.pageSize).map((r) => r.item),
          total: tabbed.length,
          page: request.query.page,
          pageSize: request.query.pageSize,
          counts,
        },
      };
    },
  );

  fastify.post(
    '/pcb-projects/:id/pos/:poId/shipment/advance',
    {
      schema: {
        params: PoParams,
        body: PcbShipmentAdvanceBody,
        response: { 200: AdminPcbPoListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await advancePcbShipment(po, { kind: 'admin' }, request.body);
      if (!res.ok) return reply.status(409).send(shipError(res.error));

      // 관리자 전이 → 협력사(보내는측) 통지 — 다음 협력사 차례가 있으면 안내.
      const [spec, portalCta, shipPoCount] = await Promise.all([
        prisma.spOrderSpec.findUnique({ where: { id: po.specId } }),
        resolvePcbPortalCta(po.partnerId),
        countPcbShipmentPos(po.id),
      ]);
      void sendPcbMail(
        request.log,
        po.partner.contactEmail,
        buildPcbShipmentTurnEmail({
          recipientName: po.partner.name,
          projectName: spec?.projectName ?? `Q${po.specId.toString()}`,
          statusLabel: bomShipmentStatusLabel(res.shipment.mode === 'domestic' ? 'domestic' : 'international', res.to),
          nextLabel: null,
          targetUrl: pcbPartnerPortalUrl(),
          targetLabel: '파트너 포털 열기',
          poCount: shipPoCount,
          ...portalCta,
        }),
        {
          kind: 'pcb_shipment_turn',
          refType: 'pcb_spec',
          refId: po.specId,
          sentBy: request.user.mbId,
          params: { poId: String(po.id), partnerName: po.partner.name, status: res.to },
        },
      );
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  // 담기(박스 확보만) — 관리자 대행의 **발송 시작점**. advance 가 담기+첫 전이를 겸하지만
  // 첫 전이의 필수값은 모드마다 다르고(국내=운송장 / 국제=출고예정일·Invoice), 그 모드는
  // 담아 봐야 정해진다(발송자국가 vs 수신국가 파생). 그래서 담기를 떼어 둔다 — 담고 나면
  // 선적 줄이 서고, 그 다음은 기존 [~ 진행] 이 모드를 알고 정확한 입력을 묻는다.
  // 협력사에는 같은 일을 하는 /partner/pcb-shipments/box 가 있지만, **연결 계정이 0인
  // 조직은 그 라우트를 부를 주체 자체가 없어** 관리자에게 대응물이 없으면 화면만으로는
  // 발송을 영영 시작할 수 없었다(여정 12호 P5 — D11 "만능 대행"의 구멍).
  fastify.post(
    '/pcb-projects/:id/pos/:poId/shipment/box',
    { schema: { params: PoParams, response: { 200: AdminPcbPoListResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await ensurePcbShipment(po);
      if (!res.ok) return reply.status(409).send(shipError(res.error));
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  fastify.post(
    '/pcb-projects/:id/pos/:poId/shipment/revert',
    { schema: { params: PoParams, response: { 200: AdminPcbPoListResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await revertPcbShipment(po, { kind: 'admin' });
      if (!res.ok) return reply.status(409).send(shipError(res.error));
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  // 선적 취소(문서 삭제) — 발송 전(preparing)·입고 전만. 묶음이면 통째로 사라진다.
  // 견적 영구 삭제의 SHIPMENT_EXISTS 차단(D13)을 푸는 유일한 출구다.
  fastify.delete(
    '/pcb-projects/:id/pos/:poId/shipment',
    { schema: { params: PoParams, response: { 200: AdminPcbPoListResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await cancelPcbShipment(po, { kind: 'admin' });
      if (!res.ok) return reply.status(409).send(shipError(res.error));
      request.log.warn(
        {
          audit: 'admin_pcb_shipment_cancel',
          actor: request.user.mbId,
          specId: Number(po.specId),
          poIds: res.poIds.map(Number),
        },
        '관리자 선적 취소',
      );
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  fastify.post(
    '/pcb-projects/:id/pos/:poId/shipment/receive',
    {
      schema: {
        params: PoParams,
        body: PcbShipmentReceiveBody,
        response: { 200: AdminPcbPoListResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const res = await receivePcbShipment(po, { kind: 'admin' }, request.body.note ?? null);
      if (!res.ok) return reply.status(409).send(shipError(res.error));

      const [spec, portalCta, shipPoCount] = await Promise.all([
        prisma.spOrderSpec.findUnique({ where: { id: po.specId } }),
        resolvePcbPortalCta(po.partnerId),
        countPcbShipmentPos(po.id),
      ]);
      void sendPcbMail(
        request.log,
        po.partner.contactEmail,
        buildPcbShipmentReceivedEmail({
          partnerName: po.partner.name,
          projectName: spec?.projectName ?? `Q${po.specId.toString()}`,
          note: request.body.note ?? null,
          poCount: shipPoCount,
          ...portalCta,
        }),
        {
          kind: 'pcb_shipment_received',
          refType: 'pcb_spec',
          refId: po.specId,
          sentBy: request.user.mbId,
          params: { poId: String(po.id), partnerName: po.partner.name },
        },
      );
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  // 선적 첨부 — multipart(fileType invoice|airwaybill), 종류별 1건 교체.
  fastify.post(
    '/pcb-projects/:id/pos/:poId/shipment/files',
    { schema: { params: PoParams, response: { 200: AdminPcbPoListResponse, 400: ApiError, 409: ApiError } } },
    async (request, reply) => {
      const { files, fields } = await collectMultipart(request);
      const kind = BomShipmentFileType.safeParse(fields.fileType);
      const file = files[0];
      if (!kind.success || file === undefined)
        return reply
          .status(400)
          .send({ error: 'BAD_UPLOAD', message: 'fileType(invoice|airwaybill)과 파일이 필요합니다.' });
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.status(409).send(shipError('NOT_SHIPPED'));
      await savePcbShipmentFile(shipment.id, kind.data, file, 'ADMIN');
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  fastify.delete(
    '/pcb-projects/:id/pos/:poId/shipment/files/:fileId',
    { schema: { params: PoFileParams, response: { 200: AdminPcbPoListResponse, 409: ApiError } } },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.notFound('발송이 없습니다');
      // Invoice 는 선적요청 진입의 필수 서류다 — 진입 후 삭제를 허용하면 서류 없는 국제
      // 선적이 그대로 진행된다(재작업 프로브 W7 실증). 되돌려 준비 단계로 내린 뒤에만.
      if (shipment.status !== 'preparing') {
        return reply.status(409).send({
          error: 'DOC_LOCKED',
          message: '발송이 시작된 뒤에는 첨부를 바꿀 수 없습니다 — 되돌린 뒤 교체하세요.',
        });
      }
      const removed = await deletePcbShipmentFile(shipment.id, request.params.fileId);
      if (!removed) return reply.notFound('파일을 찾을 수 없습니다');
      return { result: true as const, data: await loadPanel(request.params.id) };
    },
  );

  fastify.get(
    '/pcb-projects/:id/pos/:poId/shipment/files/:fileId',
    { schema: { params: PoFileParams } },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.notFound('발송이 없습니다');
      const file = await getPcbShipmentFileDownload(shipment.id, request.params.fileId);
      if (file === null) return reply.notFound('파일을 찾을 수 없습니다');
      const downloaded = await downloadFromFileServer(file.pathToken);
      if (downloaded === null) return reply.notFound('파일을 찾을 수 없습니다');
      return reply
        .header(
          'content-disposition',
          `attachment; filename*=UTF-8''${encodeURIComponent(file.originFileName)}`,
        )
        .header('content-type', downloaded.contentType)
        .send(downloaded.buffer);
    },
  );

  // 상업송장(D23 동형) — 국제 전용, 초안/저장/엑셀.
  fastify.get(
    '/pcb-projects/:id/pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoParams,
        // coerce.boolean 은 'false' 문자열도 true 라 enum→transform 으로 판정한다.
        querystring: z.object({
          fresh: z
            .enum(['true', 'false'])
            .default('false')
            .transform((v) => v === 'true'),
        }),
        response: { 200: PcbInvoiceResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.status(409).send(shipError('NOT_SHIPPED'));
      const draft = await buildPcbInvoiceDraft(shipment, request.query.fresh);
      if (!draft.ok)
        return reply
          .status(409)
          .send({ error: draft.error, message: '국내 발송은 상업송장을 사용하지 않습니다.' });
      return { result: true as const, data: draft.data };
    },
  );

  fastify.put(
    '/pcb-projects/:id/pos/:poId/shipment/invoice',
    {
      schema: {
        params: PoParams,
        body: BomInvoiceData,
        response: { 200: PcbPoActionResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.status(409).send(shipError('NOT_SHIPPED'));
      await savePcbInvoiceData(shipment.id, request.body);
      return { result: true as const };
    },
  );

  fastify.post(
    '/pcb-projects/:id/pos/:poId/shipment/invoice/xlsx',
    { schema: { params: PoParams, body: BomInvoiceData } },
    async (request, reply) => {
      const po = await loadPoChecked(request.params.id, request.params.poId);
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const shipment = await findPcbShipmentByPo(po.id);
      if (shipment === null) return reply.notFound('발송이 없습니다');
      await savePcbInvoiceData(shipment.id, request.body); // 엑셀 생성 = 저장 겸행(D23)
      const buffer = await renderInvoiceXlsx(request.body);
      return reply
        .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        .header('content-disposition', `attachment; filename*=UTF-8''invoice-${String(request.params.poId)}.xlsx`)
        .send(buffer);
    },
  );

  done();
};
