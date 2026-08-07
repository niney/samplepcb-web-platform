import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ApiError, MagicPcbRfqResponse, PcbRfqReplyBody } from '@sp/api-contract';
import { prisma } from '../lib/prisma';
import {
  loadPartnerPcbRfqDetail,
  loadPcbRfqByMagicToken,
  savePcbRfqReply,
} from '../lib/pcb-rfq';
import {
  buildPcbRfqRepliedEmail,
  pcbAdminCaseUrl,
  pcbPartnerPortalUrl,
  pcbPriceText,
  sendPcbMail,
} from '../lib/pcb-rfq-email';
import { getShopEstimateProfile } from '../lib/g5-db';
import { kstDateStr } from '../lib/kst';
import type { MailLogMeta } from '../lib/mail-log';

// ── PCB 매직링크 무로그인 회신 — BOM §6.9 동형(메일함 소유 = 신원, RFQ 1건 스코프) ──
// 인증 없음: 토큰(64hex, 30일 TTL, 재발급 회전) 자체가 인가. GET 은 선정 후에도 열람
// 허용(자기 회신 확인), PUT 은 코어(savePcbRfqReply)의 NOT_EDITABLE 가드가 막는다.

const TokenParams = z.object({ token: z.string().regex(/^[0-9a-f]{64}$/) });

export const pcbRfqReplyRoutes: FastifyPluginCallbackZod = (fastify, _opts, done) => {
  fastify.get(
    '/pcb-rfq-reply/:token',
    { schema: { params: TokenParams, response: { 200: MagicPcbRfqResponse } } },
    async (request, reply) => {
      const rfq = await loadPcbRfqByMagicToken(request.params.token);
      if (rfq === null) return reply.notFound('유효하지 않은 링크입니다');
      const detail = await loadPartnerPcbRfqDetail(rfq.id, null);
      if (detail === null) return reply.notFound('유효하지 않은 링크입니다');
      // 매직링크는 단순 회신 전용 — MD 확장(children/배정 후보)은 응답 스키마(omit)가
      // 직렬화에서 strip 한다(Zod 기본 unknown-key 제거 — 변수 전달이라 TS 도 허용).
      return {
        result: true as const,
        data: { partnerName: rfq.partner.name, rfq: detail },
      };
    },
  );

  fastify.put(
    '/pcb-rfq-reply/:token',
    {
      schema: {
        params: TokenParams,
        body: PcbRfqReplyBody,
        response: { 200: MagicPcbRfqResponse, 409: ApiError },
      },
    },
    async (request, reply) => {
      const rfq = await loadPcbRfqByMagicToken(request.params.token);
      if (rfq === null) return reply.notFound('유효하지 않은 링크입니다');

      const saved = await savePcbRfqReply(rfq.id, request.body);
      if (!saved.ok) {
        if (saved.error === 'EXCHANGE_RATE_UNAVAILABLE')
          return reply.status(409).send({
            error: saved.error,
            message: '환율 정보가 준비되지 않았습니다 — 담당자에게 문의해 주세요.',
          });
        return reply.status(409).send({
          error: 'NOT_EDITABLE',
          message: '선정이 끝난 견적요청입니다 — 담당자에게 문의해 주세요.',
        });
      }

      // 회신 도착 통지(포털 회신과 동일 규칙 — 관리자 트랙=운영자, MD 트랙=MD 조직).
      const updated = await prisma.spPcbRfq.findUnique({ where: { id: rfq.id } });
      if (updated !== null) {
        const priceText = pcbPriceText(
          updated.currency,
          updated.priceOriginal === null ? null : Number(updated.priceOriginal),
          updated.subCurrency,
          updated.subPriceOriginal === null ? null : Number(updated.subPriceOriginal),
        );
        const deliveryText =
          updated.quotedDeliveryDate === null ? null : kstDateStr(updated.quotedDeliveryDate);
        // 매직링크 회신은 무로그인 — 트리거 주체 mbId 가 없다(sentBy null=시스템).
        const repliedMeta: MailLogMeta = {
          kind: 'pcb_rfq_replied',
          refType: 'pcb_spec',
          refId: rfq.specId,
          sentBy: null,
          params: { rfqId: String(rfq.id), partnerName: rfq.partner.name, magicLink: true },
        };
        if (rfq.parentPartnerId === 0n) {
          const profile = await getShopEstimateProfile();
          void sendPcbMail(
            request.log,
            profile?.managerEmail,
            buildPcbRfqRepliedEmail({
              partnerName: rfq.partner.name,
              projectName: rfq.spec.projectName,
              specId: rfq.specId.toString(),
              priceText,
              deliveryText,
              targetUrl: pcbAdminCaseUrl(rfq.specId.toString()),
              targetLabel: 'Case 상세 열기',
            }),
            repliedMeta,
          );
        } else {
          const md = await prisma.spPartner.findUnique({ where: { id: rfq.parentPartnerId } });
          void sendPcbMail(
            request.log,
            md?.contactEmail,
            buildPcbRfqRepliedEmail({
              partnerName: rfq.partner.name,
              projectName: rfq.spec.projectName,
              specId: rfq.specId.toString(),
              priceText,
              deliveryText,
              targetUrl: pcbPartnerPortalUrl(),
              targetLabel: '파트너 포털 열기',
            }),
            repliedMeta,
          );
        }
      }

      const detail = await loadPartnerPcbRfqDetail(rfq.id, null);
      if (detail === null) return reply.notFound('유효하지 않은 링크입니다');
      return {
        result: true as const,
        data: { partnerName: rfq.partner.name, rfq: detail },
      };
    },
  );

  done();
};
