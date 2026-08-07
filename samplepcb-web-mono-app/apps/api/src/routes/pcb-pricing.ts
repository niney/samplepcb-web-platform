import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { calculateQuote, type QuoteResult } from '../pricing/engine';
import { getFreshPricingData } from '../pricing/live-pricing';
import { legacyBodyToQuoteInput } from '../pricing/legacy-body-adapter';

// ── POST /api/pcb-pricing — 레거시 가격 API(samplepcb_pricing_api.php) 호환 ────
// 거버 뷰어의 화면 실시간 가격 표시용. 레거시 body 를 그대로 받고 레거시 public 응답
// (listPriceWithRate 등 5필드)을 그대로 돌려준다 — 목적이 "레거시 ↔ 이 서버 스위칭
// 비교"이므로 입력·출력 모두 동형이어야 한다(2026-08-07 사용자 결정).
//  - 무인증 공개(레거시와 동일). 계산만 하고 아무것도 저장하지 않는다.
//  - 가격표는 라이브 pricing_data.json — 레거시 PHP 가 매 요청 읽는 그 파일(live-pricing.ts).
//  - applyGerberPriceMode(부가세 정규화)는 여기 두지 않는다: 그건 저장가(sp_quote)의
//    해석이고, 이 응답의 기준은 레거시 화면가다. 여기에 얹으면 스위칭 비교가 무의미해진다.
//  - 진입점 분기(하드코딩 메뉴·필수값 검사)까지 레거시 엔트리 파일을 재현한다. 계산
//    파리티는 엔진(legacy-parity.test.ts 47케이스), 이 층은 pcb-pricing.test.ts 가 고정.

// advanceMetal/flexibleFPCB — 레거시 엔트리가 계산 없이 돌려주는 하드코딩 응답 그대로.
const HARDCODED_ZERO = {
  buildTimeWithUnit: '0일',
  eta: '미정',
  listPriceWithRate: '0원',
  placeOfOrigin: '',
  weightWithUnit: '',
};

// CCResult::requiredParam() 동형 — 거버 클라이언트는 result!==true 면 INITIAL_PRICE 폴백.
const REQUIRED_PARAM = { result: false, message: 'required param' };

// PcbPriceBase::makePublicData 동형 직렬화. number_format(listPrice).'원' 은
// toLocaleString('en-US')(천단위 콤마)와 같고, rfq(null)는 레거시의 0원과 같은 의미다.
const toPublicData = (r: QuoteResult): Record<string, string> => ({
  listPriceWithRate: `${(r.listPrice ?? 0).toLocaleString('en-US')}원`,
  weightWithUnit: `${r.weightKg}kg`,
  buildTimeWithUnit: `${String(r.buildTimeDays)}일`,
  eta: r.eta,
  placeOfOrigin: r.placeOfOrigin,
});

export function pcbPricingRoutes(fastify: FastifyInstance): void {
  fastify.post(
    '/pcb-pricing',
    // body 는 레거시 자유 형식 — 형태만 객체로 강제하고 키는 어댑터가 흡수한다.
    { schema: { body: z.record(z.string(), z.unknown()) } },
    async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const menu = typeof body.menu === 'string' ? body.menu : '';

      // ① advanceMetal/flexibleFPCB — 레거시 엔트리 하드코딩 0원 (strcasecmp 동형)
      if (/^(advancemetal|flexiblefpcb)$/i.test(menu)) {
        return { result: true, data: HARDCODED_ZERO };
      }

      if (menu.toLowerCase() === 'metalmask') {
        // ② MetalMask — frame/size 필수(레거시 isset 검사 동형).
        if (body.frame == null || body.size == null) return reply.send(REQUIRED_PARAM);
        // 해외 스텐실(placeOfOrigin 지정 → 레거시 PcbMetalPriceLib)은 미이식 — 국내가로
        // 조용히 계산하면 값이 어긋나므로 명시적으로 거른다. 현행 거버 UI 는 이 키를
        // 보내지 않는다(캡처 매트릭스 docs/samplepcb-pricing-api-body-cases.md 기준).
        if ('placeOfOrigin' in body) {
          return reply.send({
            result: false,
            message: 'unsupported: metalMask placeOfOrigin(해외 스텐실)은 레거시 API 만 지원',
          });
        }
      } else if (
        // ③ 그 외 메뉴 — layers/width/length/qty 필수(레거시 isset 검사 동형).
        body.layers == null || body.width == null || body.length == null || body.qty == null
      ) {
        return reply.send(REQUIRED_PARAM);
      }

      // 미지원 메뉴(advanceFR4/advanceRogers/flexibleRigid 등)도 레거시처럼 여기까지 와서
      // 0원 응답이 된다(엔진 rfq → '0원'). 부산물(무게·eta)은 레거시가 Warning 을 내며
      // 채우던 값이라 재현하지 않는다 — docs/pricing-engine-parity.md 참조.
      const quote = calculateQuote(
        legacyBodyToQuoteInput(body),
        await getFreshPricingData(request.log),
      );
      return { result: true, data: toPublicData(quote) };
    },
  );
}
