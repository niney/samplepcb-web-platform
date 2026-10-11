import type { FastifyBaseLogger } from 'fastify';
import type { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getShopEstimateProfile } from './g5-db';
import { kstDateStr } from './kst';
import {
  buildPcbRfqRepliedEmail,
  pcbAdminCaseUrl,
  pcbPartnerPortalUrl,
  pcbPartnerRfqUrl,
  pcbPriceText,
  sendPcbMail,
} from './pcb-rfq-email';

// ── PCB 견적 "회신 도착" 통지 — 회신이 만들어지는 세 길이 한 함수를 쓴다 ──────────
// 포털 회신 · 매직링크 회신 · **마스터딜러의 하위 선정**. 셋째는 예전에 통지가 없었다 — 마스터딜러가
// 하위를 골라 회신을 만들면 관리자는 워크큐를 열어 봐야만 알았다(2026-10-11).
// 받는 쪽: 관리자가 보낸 행이면 운영자, 마스터딜러가 보낸 행이면 그 마스터딜러 조직.

/** 통지는 회신 저장을 막지 않는다 — 수신자 조회가 실패해도 기록만 남기고 넘어간다. */
export const notifyPcbRfqReplied = async (
  log: FastifyBaseLogger,
  rfqId: bigint,
  opts: { sentBy: string | null; params?: Prisma.InputJsonObject },
): Promise<void> => {
  try {
    await sendReplied(log, rfqId, opts);
  } catch (err) {
    log.warn({ err, rfqId: rfqId.toString() }, 'PCB 견적 회신 통지 실패');
  }
};

const sendReplied = async (
  log: FastifyBaseLogger,
  rfqId: bigint,
  opts: { sentBy: string | null; params?: Prisma.InputJsonObject },
): Promise<void> => {
  const rfq = await prisma.spPcbRfq.findUnique({
    where: { id: rfqId },
    include: { spec: true, partner: true },
  });
  if (rfq === null) return;

  const mail = {
    partnerName: rfq.partner.name,
    projectName: rfq.spec.projectName,
    specId: rfq.specId.toString(),
    priceText: pcbPriceText(
      rfq.currency,
      rfq.priceOriginal === null ? null : Number(rfq.priceOriginal),
      rfq.subCurrency,
      rfq.subPriceOriginal === null ? null : Number(rfq.subPriceOriginal),
    ),
    deliveryText: rfq.quotedDeliveryDate === null ? null : kstDateStr(rfq.quotedDeliveryDate),
  };
  const meta = {
    kind: 'pcb_rfq_replied',
    refType: 'pcb_spec',
    refId: rfq.specId,
    sentBy: opts.sentBy,
    params: { rfqId: String(rfq.id), partnerName: rfq.partner.name, ...(opts.params ?? {}) },
  };

  if (rfq.parentPartnerId === 0n) {
    const profile = await getShopEstimateProfile();
    void sendPcbMail(
      log,
      profile?.managerEmail,
      buildPcbRfqRepliedEmail({
        ...mail,
        targetUrl: pcbAdminCaseUrl(rfq.specId.toString()),
        targetLabel: 'Case 상세 열기',
      }),
      meta,
    );
    return;
  }

  // 마스터딜러에게 — 포털 첫 화면이 아니라 **그 견적요청**으로 보낸다(회신을 골라 마진을 붙일 자리).
  const [md, mdRow] = await Promise.all([
    prisma.spPartner.findUnique({ where: { id: rfq.parentPartnerId } }),
    prisma.spPcbRfq.findUnique({
      where: {
        specId_partnerId_parentPartnerId_reorderRound: {
          specId: rfq.specId,
          partnerId: rfq.parentPartnerId,
          parentPartnerId: 0n,
          reorderRound: rfq.reorderRound,
        },
      },
      select: { id: true },
    }),
  ]);
  void sendPcbMail(
    log,
    md?.contactEmail,
    buildPcbRfqRepliedEmail({
      ...mail,
      targetUrl: mdRow === null ? pcbPartnerPortalUrl() : pcbPartnerRfqUrl(mdRow.id.toString()),
      targetLabel: mdRow === null ? '파트너 포털 열기' : '견적요청 열기',
    }),
    meta,
  );
};
