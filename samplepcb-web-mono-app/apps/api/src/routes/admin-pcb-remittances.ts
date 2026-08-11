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
  type PcbRemittanceCurrencyTotalType,
  type PcbRemittanceStatusType,
} from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import { loadPcbCustomerNames } from '../lib/pcb-customer';
import { asPcbPoStatus } from '../lib/pcb-po';
import {
  createPcbRemittance,
  deletePcbRemittance,
  deleteRemittanceFile,
  getRemittanceFileDownload,
  isFreeAsPo,
  listPcbRemittances,
  loadFreeAsRoundKeys,
  loadRemittanceKrwPaid,
  loadRemittanceSummaries,
  notifyPcbRemittanceSettled,
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

/** 검색어가 견적번호면 그 specId — 화면 표기 'Q21145' 와 숫자 '21145' 를 둘 다 받는다. */
const specIdOf = (q: string): bigint | null => {
  const m = /^[Qq]?(\d+)$/.exec(q);
  return m?.[1] === undefined ? null : BigInt(m[1]);
};

/** 목록 검색 — 프로젝트·협력사·고객명·아이디·견적번호. 고객명은 g5 파생이라 DB where 로
 *  거를 수 없어(prisma 는 sp 스키마만 안다) 행을 만든 뒤 여기서 판정한다. 이 라우트는
 *  검색이 없을 때도 전량을 로드하므로(위 loadRows 주석) 모수 비용은 그대로다. */
const matchesRemittanceQuery = (row: AdminPcbRemittanceItemType, q: string): boolean => {
  const needle = q.toLowerCase();
  const specId = specIdOf(q);
  return (
    row.projectName.toLowerCase().includes(needle) ||
    row.partnerName.toLowerCase().includes(needle) ||
    row.customerName.toLowerCase().includes(needle) ||
    (row.mbId ?? '').toLowerCase().includes(needle) ||
    (specId !== null && BigInt(row.specId) === specId)
  );
};

/** 통화별 소계 — 목록(탭·검색 전체 모수)과 협력사별 집계가 같은 방식으로 센다. */
const sumByCurrency = (
  rows: readonly { summary: { currency: string; poAmount: number; paidAmount: number; balance: number } }[],
): PcbRemittanceCurrencyTotalType[] => {
  const map = new Map<string, PcbRemittanceCurrencyTotalType>();
  for (const r of rows) {
    const cur = map.get(r.summary.currency) ?? {
      currency: r.summary.currency,
      poAmount: 0,
      paidAmount: 0,
      balance: 0,
      poCount: 0,
    };
    cur.poAmount += r.summary.poAmount;
    cur.paidAmount += r.summary.paidAmount;
    cur.balance += r.summary.balance;
    cur.poCount += 1;
    map.set(r.summary.currency, cur);
  }
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
};

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
      },
      include: {
        spec: { select: { id: true, projectName: true, specJson: true, mbId: true, ctId: true } },
        partner: { select: { id: true, name: true } },
      },
      orderBy: { issuedAt: 'desc' },
    });
    const [summaries, freeKeys, customerNames] = await Promise.all([
      loadRemittanceSummaries(pos),
      loadFreeAsRoundKeys(pos),
      loadPcbCustomerNames(
        pos.map((po) => ({ specId: po.specId, mbId: po.spec.mbId, ctId: po.spec.ctId })),
      ),
    ]);
    const rows = pos.map((po) => {
      const isFreeAs = isFreeAsPo(freeKeys, po);
      const summary =
        summaries.get(po.id.toString()) ??
        summarizePcbRemittances({ currency: po.currency, priceOriginal: po.priceOriginal }, []);
      return {
        poId: Number(po.id),
        specId: Number(po.specId),
        projectName: po.spec.projectName,
        mbId: po.spec.mbId,
        customerName: customerNames.get(po.specId.toString()) ?? '',
        partnerId: Number(po.partnerId),
        partnerName: po.partner.name,
        poStatus: asPcbPoStatus(po.status),
        paymentTerms: po.paymentTerms,
        issuedAt: po.issuedAt.toISOString(),
        deliveryDate: po.deliveryDate === null ? null : po.deliveryDate.toISOString(),
        reorderRound: po.reorderRound,
        isLegacy: isLegacySpec(po.spec.specJson),
        isFreeAs,
        // 무상 A/S — 지급할 것이 없다: 잔액만 0 으로 눕힌다(발주가·기왕의 송금액은 사실 그대로).
        summary: isFreeAs ? { ...summary, balance: 0 } : summary,
      };
    });
    return q === '' ? rows : rows.filter((row) => matchesRemittanceQuery(row, q));
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
        data: {
          items: filtered.slice(start, start + pageSize),
          total: filtered.length,
          // 소계는 **페이지가 아니라 조건 전체**를 센다(페이지 합계는 아무 뜻이 없다).
          // 무상 A/S 는 지급 축이 아니므로 '전체' 탭에서도 소계에 넣지 않는다.
          byCurrency: sumByCurrency(filtered.filter((r) => !r.isFreeAs)),
          counts,
        },
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
      const [summaries, krwPaidMap] = await Promise.all([
        loadRemittanceSummaries(pos),
        loadRemittanceKrwPaid(pos),
      ]);

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
            krwPaidRateMissing: false,
            krwBalance: 0,
            unpaidPoCount: 0,
            openPoCount: 0,
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

        // 발주가·잔액의 KRW 환산은 발주서의 회계 박제(krwAmount)를 쓴다 — 없으면(외화 MD
        // 하위 발주) 환산 총계에서 빠진다. 통화별 값이 정본이고 이 총계는 참고다.
        const krwPo = po.krwAmount ?? (po.currency === 'KRW' ? s.poAmount : 0);
        const krwBalance = s.poAmount === 0 ? 0 : Math.round(krwPo * (s.balance / s.poAmount));
        entry.row.krwPoAmount += krwPo;
        entry.row.krwBalance += krwBalance;

        // ⚠ **지급액만은 원장 실합**이다(비례배분 추정 폐기 — 재점검 08-11 확정 #8).
        // 비례배분은 "발주 회계 환율로 다 줬다"고 말해 환차를 화면에서 지운다:
        // 같은 USD 300 이 회계로는 ₩414,000 인데 실제로 나간 돈은 ₩412,500 이었다.
        // 그래서 krwPoAmount ≠ krwPaidAmount + krwBalance 가 정상이고, 그 차이가 환차다.
        const paid = krwPaidMap.get(po.id.toString());
        entry.row.krwPaidAmount += paid?.krwPaid ?? 0;
        if ((paid?.rateMissingCount ?? 0) > 0) entry.row.krwPaidRateMissing = true;

        if (s.status === 'unpaid') entry.row.unpaidPoCount += 1;
        // 잔액이 남은 건 = 아직 줄 돈이 있는 건(미착수 + 부분 송금). '미착수 0인데 잔액이
        // 있다'는 모순으로 읽히던 화면의 짝(재점검 08-11 확정 #5).
        if (s.balance > 0) entry.row.openPoCount += 1;
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
      // 목록과 **같은 판정**을 상세도 한다 — 여기서 빠뜨린 탓에 무상 A/S 회차의 상세가
      // 잔액 전액을 주고 패널이 그 금액을 입력칸에 프리필했다(재점검 08-11 확정 #1).
      const freeKeys = await loadFreeAsRoundKeys([po]);
      const isFreeAs = isFreeAsPo(freeKeys, po);
      const summary = summarizePcbRemittances(po, rows);
      return {
        result: true as const,
        data: {
          poId: Number(po.id),
          specId: Number(po.specId),
          projectName: po.spec.projectName,
          partnerName: po.partner.name,
          isFreeAs,
          poKrwAmount: po.krwAmount,
          summary: isFreeAs ? { ...summary, balance: 0 } : summary,
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
      // 이 송금으로 잔액이 0 이 됐으면 협력사에 1회 알린다(여정 8호 결정 — 회차마다가
      // 아니라 완납만). 비차단: 메일 사정으로 송금 기록이 흔들리면 안 된다.
      void notifyPcbRemittanceSettled(request.log, request.params.poId, request.user.mbId);
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
      // 금액 정정으로 비로소 완납이 되는 경우도 있다 — 생성과 같은 규칙(1회)이 적용된다.
      void notifyPcbRemittanceSettled(request.log, request.params.poId, request.user.mbId);
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
