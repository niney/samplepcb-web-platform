import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  AdminPcbRemittanceDetailResponse,
  AdminPcbRemittanceListQuery,
  AdminPcbRemittanceListResponse,
  AdminPcbRemittancePartnerResponse,
  PcbRemittanceCreateBody,
  PcbRemittanceMutationResponse,
  PcbRemittancePatchBody,
  type AdminPcbRemittanceItemType,
  type AdminPcbRemittancePartnerCurrencyType,
  type AdminPcbRemittancePartnerRowType,
  type PcbRemittanceStatusType,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { asPcbPoStatus } from '../lib/pcb-po';
import {
  createPcbRemittance,
  deletePcbRemittance,
  deleteRemittanceFile,
  getRemittanceFileDownload,
  isFreeAsPo,
  listPcbRemittances,
  loadFreeAsRoundKeys,
  loadRemittanceSummaries,
  patchPcbRemittance,
  summarizePcbRemittances,
  uploadRemittanceFile,
} from '../lib/pcb-remittance';
import { collectMultipart } from '../lib/market';
import { downloadFromFileServer } from '../lib/file-server';

// ── 관리자 송금 워크큐(P3.11) — docs/PCB_PARTNER_TRACK.md D15 ────────────────
// 역할별 워크큐 교리(D12) 그대로: 첫 탭 = 이 역할(경리·재무)이 시작해야 할 대기 큐 =
// **발주됐는데 한 푼도 안 나간 건**. 배지도 그 수다(같은 endpoint counts.pending).
//
// 모수는 **관리자 지급분(parentPartnerId=0)만** — MD 하위 발주의 지급 주체는 MD 다
// (재점검 확정 08-10: 하위 발주를 함께 세우면 관리자에게 이중 지급을 유도한다).
// 하위 발주의 송금 원장 기록·열람(상세 라우트)은 대행 창구로 그대로 남는다.
//
// 무상(free) A/S 회차 발주는 잔액 0 취급 — 대기·부분 탭 어디에도 서지 않고 '전체'에서
// '무상 A/S' 배지로만 보인다(proceed 의 원가 복사는 회계 참고일 뿐 지급 대상이 아니다).

const PoParams = z.object({ poId: z.coerce.bigint() });
const RemittanceParams = PoParams.extend({ remittanceId: z.coerce.bigint() });
const RemittanceFileParams = RemittanceParams.extend({ fileId: z.coerce.bigint() });

const ApiError = z.object({ error: z.string(), message: z.string() });

const isLegacySpec = (specJson: unknown): boolean =>
  typeof specJson === 'object' && specJson !== null && '_legacy' in specJson;

export const adminPcbRemittanceRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.addHook('preHandler', fastify.requireAdmin);

  /** 발주서 + 스펙 + 협력사 + 지급 요약을 한 벌로. 탭 필터는 요약(합계) 기준이라
   *  여기서 전량을 만든 뒤 걸러낸다. PCB 발주 모수가 작아(수천 단위) 충분하며,
   *  더 커지면 sp_pcb_po ⟕ sp_pcb_remittance GROUP BY 집계 SQL 로 바꾼다. */
  const loadRows = async (filters: {
    q?: string;
    partnerId?: number;
  }): Promise<AdminPcbRemittanceItemType[]> => {
    const q = filters.q?.trim() ?? '';
    const pos = await prisma.spPcbPo.findMany({
      where: {
        parentPartnerId: 0n, // 관리자 지급분만 — 하위 발주 지급 주체는 MD(이중 지급 방지)
        ...(filters.partnerId === undefined ? {} : { partnerId: BigInt(filters.partnerId) }),
        ...(q === ''
          ? {}
          : {
              OR: [
                { spec: { projectName: { contains: q } } },
                { partner: { name: { contains: q } } },
                ...(/^\d+$/.test(q) ? [{ specId: BigInt(q) }] : []),
              ],
            }),
      },
      include: {
        spec: { select: { id: true, projectName: true, specJson: true } },
        partner: { select: { id: true, name: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });
    const [summaries, freeKeys] = await Promise.all([
      loadRemittanceSummaries(pos),
      loadFreeAsRoundKeys(pos),
    ]);
    return pos.map((po) => {
      const isFreeAs = isFreeAsPo(freeKeys, po);
      const summary =
        summaries.get(po.id.toString()) ??
        summarizePcbRemittances({ currency: po.currency, priceOriginal: po.priceOriginal }, []);
      return {
        poId: Number(po.id),
        specId: Number(po.specId),
        projectName: po.spec.projectName,
        partnerId: Number(po.partnerId),
        partnerName: po.partner.name,
        poStatus: asPcbPoStatus(po.status),
        paymentTerms: po.paymentTerms,
        issuedAt: po.issuedAt.toISOString(),
        deliveryDate: po.deliveryDate === null ? null : po.deliveryDate.toISOString(),
        isLegacy: isLegacySpec(po.spec.specJson),
        isFreeAs,
        // 무상 A/S — 지급할 것이 없다: 잔액만 0 으로 눕힌다(발주가·기왕의 송금액은 사실 그대로).
        summary: isFreeAs ? { ...summary, balance: 0 } : summary,
      };
    });
  };

  // 무상 A/S 행은 지급 대기 축(pending/partial/done) 어디에도 서지 않는다 — '전체' 전용.
  const inTab = (row: AdminPcbRemittanceItemType, tab: string): boolean => {
    if (tab === 'all') return true;
    if (row.isFreeAs) return false;
    const status: PcbRemittanceStatusType = row.summary.status;
    return tab === 'pending'
      ? status === 'unpaid'
      : tab === 'partial'
        ? status === 'partial'
        : status === 'paid' || status === 'over';
  };

  // ── GET /pcb-remittances — 워크큐 목록 ──────────────────────────────────────
  fastify.get(
    '/pcb-remittances',
    { schema: { querystring: AdminPcbRemittanceListQuery, response: { 200: AdminPcbRemittanceListResponse } } },
    async (request) => {
      const { tab, page, pageSize } = request.query;
      const rows = await loadRows({
        ...(request.query.q === undefined ? {} : { q: request.query.q }),
        ...(request.query.partnerId === undefined ? {} : { partnerId: request.query.partnerId }),
      });
      const counts = {
        pending: rows.filter((r) => inTab(r, 'pending')).length,
        partial: rows.filter((r) => inTab(r, 'partial')).length,
        done: rows.filter((r) => inTab(r, 'done')).length,
        all: rows.length,
      };
      const filtered = rows.filter((r) => inTab(r, tab));
      const start = (page - 1) * pageSize;
      return {
        result: true as const,
        data: { items: filtered.slice(start, start + pageSize), total: filtered.length, counts },
      };
    },
  );

  // ── GET /pcb-remittances/partners — 협력사별 집계 ───────────────────────────
  // "이 협력사에 줄 돈이 남았나"를 한 줄로. 통화는 뭉치지 않고 통화별로 나눠 낸다.
  // 목록과 같은 모수 규율: 관리자 지급분(parentPartnerId=0)만, 무상 A/S 회차는 제외.
  fastify.get(
    '/pcb-remittances/partners',
    { schema: { response: { 200: AdminPcbRemittancePartnerResponse } } },
    async () => {
      const allPos = await prisma.spPcbPo.findMany({
        where: { parentPartnerId: 0n },
        include: { partner: { select: { id: true, name: true, country: true } } },
      });
      const freeKeys = await loadFreeAsRoundKeys(allPos);
      const pos = allPos.filter((po) => !isFreeAsPo(freeKeys, po));
      const summaries = await loadRemittanceSummaries(pos);

      const byPartner = new Map<
        string,
        {
          row: AdminPcbRemittancePartnerRowType;
          currencies: Map<string, AdminPcbRemittancePartnerCurrencyType>;
        }
      >();
      for (const po of pos) {
        const key = po.partnerId.toString();
        const entry = byPartner.get(key) ?? {
          row: {
            partnerId: Number(po.partnerId),
            partnerName: po.partner.name,
            country: po.partner.country,
            byCurrency: [],
            krwPoAmount: 0,
            krwPaidAmount: 0,
            krwBalance: 0,
            unpaidPoCount: 0,
            lastRemittedOn: null,
          },
          currencies: new Map<string, AdminPcbRemittancePartnerCurrencyType>(),
        };
        const s =
          summaries.get(po.id.toString()) ??
          summarizePcbRemittances({ currency: po.currency, priceOriginal: po.priceOriginal }, []);

        const cur = entry.currencies.get(s.currency) ?? {
          currency: s.currency,
          poAmount: 0,
          paidAmount: 0,
          balance: 0,
          poCount: 0,
        };
        cur.poAmount += s.poAmount;
        cur.paidAmount += s.paidAmount;
        cur.balance += s.balance;
        cur.poCount += 1;
        entry.currencies.set(s.currency, cur);

        // KRW 환산은 발주서의 회계 박제(krwAmount)를 쓴다 — 없으면(외화 MD 하위 발주)
        // 환산 총계에서 빠진다. 통화별 값이 정본이고 이 총계는 참고다.
        const krwPo = po.krwAmount ?? (po.currency === 'KRW' ? s.poAmount : 0);
        const krwPaidRatio = s.poAmount === 0 ? 0 : s.paidAmount / s.poAmount;
        entry.row.krwPoAmount += krwPo;
        entry.row.krwPaidAmount += Math.round(krwPo * krwPaidRatio);
        entry.row.krwBalance += krwPo - Math.round(krwPo * krwPaidRatio);

        if (s.status === 'unpaid') entry.row.unpaidPoCount += 1;
        if (
          s.lastRemittedOn !== null &&
          (entry.row.lastRemittedOn === null || s.lastRemittedOn > entry.row.lastRemittedOn)
        ) {
          entry.row.lastRemittedOn = s.lastRemittedOn;
        }
        byPartner.set(key, entry);
      }

      const rows = [...byPartner.values()].map((e) => ({
        ...e.row,
        byCurrency: [...e.currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
      }));
      // 줄 돈이 많은 협력사부터 — 이 화면을 여는 이유가 그것이다.
      rows.sort((a, b) => b.krwBalance - a.krwBalance);
      return { result: true as const, data: { rows } };
    },
  );

  // ── GET /pcb-remittances/:poId — 발주서 1건의 송금 내역 ─────────────────────
  fastify.get(
    '/pcb-remittances/:poId',
    { schema: { params: PoParams, response: { 200: AdminPcbRemittanceDetailResponse } } },
    async (request, reply) => {
      const po = await prisma.spPcbPo.findUnique({
        where: { id: request.params.poId },
        include: {
          spec: { select: { projectName: true } },
          partner: { select: { name: true } },
        },
      });
      if (po === null) return reply.notFound('발주서를 찾을 수 없습니다');
      const rows = await prisma.spPcbRemittance.findMany({
        where: { poId: po.id },
        select: { amount: true, remittedOn: true },
      });
      return {
        result: true as const,
        data: {
          poId: Number(po.id),
          specId: Number(po.specId),
          projectName: po.spec.projectName,
          partnerName: po.partner.name,
          summary: summarizePcbRemittances(po, rows),
          remittances: await listPcbRemittances(po.id),
        },
      };
    },
  );

  /** 변경 후 공통 응답 — 요약과 내역을 함께 돌려 화면이 한 번에 갱신되게 한다. */
  const mutationResult = async (poId: bigint) => {
    const po = await prisma.spPcbPo.findUniqueOrThrow({ where: { id: poId } });
    const rows = await prisma.spPcbRemittance.findMany({
      where: { poId },
      select: { amount: true, remittedOn: true },
    });
    return {
      result: true as const,
      data: {
        summary: summarizePcbRemittances(po, rows),
        remittances: await listPcbRemittances(poId),
      },
    };
  };

  // ── POST /pcb-remittances/:poId — 송금 기록 ─────────────────────────────────
  fastify.post(
    '/pcb-remittances/:poId',
    {
      schema: {
        params: PoParams,
        body: PcbRemittanceCreateBody,
        response: { 200: PcbRemittanceMutationResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const outcome = await createPcbRemittance(
        request.params.poId,
        request.body,
        request.user.mbId,
      );
      if (!outcome.ok) return reply.notFound('발주서를 찾을 수 없습니다');
      return mutationResult(request.params.poId);
    },
  );

  // ── PATCH /pcb-remittances/:poId/:remittanceId — 수정 ───────────────────────
  fastify.patch(
    '/pcb-remittances/:poId/:remittanceId',
    {
      schema: {
        params: RemittanceParams,
        body: PcbRemittancePatchBody,
        response: { 200: PcbRemittanceMutationResponse, 404: ApiError },
      },
    },
    async (request, reply) => {
      const outcome = await patchPcbRemittance(
        request.params.poId,
        request.params.remittanceId,
        request.body,
      );
      if (!outcome.ok) return reply.notFound('송금 기록을 찾을 수 없습니다');
      return mutationResult(request.params.poId);
    },
  );

  // ── DELETE /pcb-remittances/:poId/:remittanceId — 삭제 ──────────────────────
  fastify.delete(
    '/pcb-remittances/:poId/:remittanceId',
    { schema: { params: RemittanceParams, response: { 200: PcbRemittanceMutationResponse, 404: ApiError } } },
    async (request, reply) => {
      const outcome = await deletePcbRemittance(request.params.poId, request.params.remittanceId);
      if (!outcome.ok) return reply.notFound('송금 기록을 찾을 수 없습니다');
      return mutationResult(request.params.poId);
    },
  );

  // ── 증빙(이체 확인증) ───────────────────────────────────────────────────────
  fastify.post(
    '/pcb-remittances/:poId/:remittanceId/files',
    { schema: { params: RemittanceParams, response: { 200: PcbRemittanceMutationResponse, 400: ApiError, 404: ApiError } } },
    async (request, reply) => {
      const row = await prisma.spPcbRemittance.findUnique({
        where: { id: request.params.remittanceId },
      });
      if (row?.poId !== request.params.poId) {
        return reply.notFound('송금 기록을 찾을 수 없습니다');
      }
      const { files } = await collectMultipart(request);
      const file = files[0];
      if (file === undefined) {
        return reply.status(400).send({ error: 'BAD_UPLOAD', message: '파일이 필요합니다.' });
      }
      await uploadRemittanceFile(row.id, file, request.user.mbId);
      return mutationResult(request.params.poId);
    },
  );

  fastify.delete(
    '/pcb-remittances/:poId/:remittanceId/files/:fileId',
    { schema: { params: RemittanceFileParams, response: { 200: PcbRemittanceMutationResponse, 404: ApiError } } },
    async (request, reply) => {
      const removed = await deleteRemittanceFile(request.params.remittanceId, request.params.fileId);
      if (!removed) return reply.notFound('파일을 찾을 수 없습니다');
      return mutationResult(request.params.poId);
    },
  );

  fastify.get(
    '/pcb-remittances/:poId/:remittanceId/files/:fileId',
    { schema: { params: RemittanceFileParams } },
    async (request, reply) => {
      const file = await getRemittanceFileDownload(
        request.params.remittanceId,
        request.params.fileId,
      );
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

  done();
};
