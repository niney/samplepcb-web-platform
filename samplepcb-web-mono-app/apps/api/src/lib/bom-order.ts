import type { FastifyBaseLogger } from 'fastify';
import type { SpBomQuote, SpBomQuoteItem, SpBomQuoteSheet } from '@prisma/client';
import { prisma } from './prisma';
import { filterActiveQuoteItems } from './bom-quote';
import {
  deleteQuoteOption,
  getCartStates,
  getTemplateItem,
  insertCartRow,
  insertQuoteOption,
  updateCartQuoteRow,
} from './g5-db';

// ── 스마트 BOM 주문 전환(D16·D17, docs/SMARTBOM_PARTNER_RFQ.md §6) ──────────
// 거버 addSpecToCart 패턴의 BOM 판: 확정 견적 1건 = 카트 1행(ct_qty=1, 총액 스냅샷).
// 카트 금액 = round(확정 총액 × 1.1) — 카트/주문서는 부가세 포함 총액(거버 하류 정합).
// 주문·결제 상태는 저장하지 않고 ct/od 조인 파생(g5 미러 금지 D10).
// ct_select(주문 대상 선택)는 호출자 몫 — 단건은 [ctId] 하나, 배치(D17)는 전체를 한 번에.

const WEB_BASE_URL = process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr';

export type BomOrderError =
  | 'NOT_ANSWERED'
  | 'NOT_CONFIRMED'
  | 'ALREADY_ORDERED'
  | 'TEMPLATE_ITEM_MISSING'
  | 'CART_INSERT_FAILED';

export type BomOrderResult =
  | { ok: true; ctId: number; redirectUrl: string }
  | { ok: false; error: BomOrderError };

type QuoteWithLines = SpBomQuote & { items: SpBomQuoteItem[]; sheets: SpBomQuoteSheet[] };

/** 영카트 주문서 URL — 단건·배치 주문 라우트가 공유한다. */
export const bomOrderformUrl = `${WEB_BASE_URL}/shop/orderform.php`;

export async function orderBomQuote(
  quote: QuoteWithLines,
  cartId: string,
  ip: string,
  log: FastifyBaseLogger,
): Promise<BomOrderResult> {
  // D16-1 주문 게이트 — 관리자 확정가 있는 answered 견적만.
  if (quote.status !== 'answered') return { ok: false, error: 'NOT_ANSWERED' };
  if (quote.confirmedTotal === null) return { ok: false, error: 'NOT_CONFIRMED' };

  const item = await getTemplateItem('bom');
  if (item === null) {
    log.error('BOM 템플릿 상품 없음 — seed-template-items 실행 필요');
    return { ok: false, error: 'TEMPLATE_ITEM_MISSING' };
  }

  const cartPrice = Math.round(quote.confirmedTotal * 1.1); // D16-2 부가세 포함 총액
  const ioId = `bom-${String(quote.id)}`;
  const includedCount = filterActiveQuoteItems(quote.items, quote.sheets).filter(
    (line) => line.included,
  ).length;
  const option =
    `부품 ${String(includedCount)}종 · 세트 ${String(quote.setQty)}` +
    (quote.spareQty > 0 ? ` · 예비 ${String(quote.spareQty)}` : '') +
    ' · VAT 포함';

  // 기존 담김 상태 파생 — ordered 는 거부, cart 는 금액·요약 동기화 후 재사용(확정가
  // 변경 대비: 코어 before_check_cart_price 가 옵션 행과 대조하므로 둘을 함께 갱신).
  if (quote.ctId !== null) {
    const state = (await getCartStates([quote.ctId])).get(quote.ctId) ?? 'none';
    if (state === 'ordered') return { ok: false, error: 'ALREADY_ORDERED' };
    if (state === 'cart') {
      await deleteQuoteOption(item.itId, ioId);
      await insertQuoteOption(item.itId, ioId, cartPrice);
      await updateCartQuoteRow(quote.ctId, ioId, cartPrice, option);
      return { ok: true, ctId: quote.ctId, redirectUrl: bomOrderformUrl };
    }
    // none(카트에서 삭제됨) → 아래 재담기
  }

  await deleteQuoteOption(item.itId, ioId); // 잔존 옵션 행 멱등 청소(거버 관례)
  await insertQuoteOption(item.itId, ioId, cartPrice);
  let ctId: number;
  try {
    ctId = await insertCartRow({
      odId: cartId,
      mbId: quote.mbId,
      item,
      itemName: `${item.itName} · ${quote.title}`,
      ioId,
      price: cartPrice,
      option,
      ip,
    });
  } catch (err) {
    await deleteQuoteOption(item.itId, ioId).catch(() => undefined);
    log.error({ err }, 'g5_shop_cart INSERT 실패 (BOM 주문 담기)');
    return { ok: false, error: 'CART_INSERT_FAILED' };
  }
  await prisma.spBomQuote.update({ where: { id: quote.id }, data: { ctId } });
  return { ok: true, ctId, redirectUrl: bomOrderformUrl };
}
