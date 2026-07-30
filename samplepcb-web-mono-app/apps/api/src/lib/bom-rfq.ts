import { Prisma } from '@prisma/client';
import type { SpBomQuoteItem, SpBomRfq, SpBomRfqItem, SpPartner } from '@prisma/client';
import type {
  AdminBomRfqItemViewType,
  AdminBomRfqViewType,
  BomQuoteSelectedOfferType,
  BomRfqReplyBodyType,
  BomRfqStatusType,
  PartnerRfqDetailType,
  PartnerRfqLineItemType,
  PartnerRfqListItemType,
} from '@sp/api-contract';
import { prisma } from './prisma';
import { computeQuote, filterActiveQuoteItems, persistQuoteComputed, toItemDto } from './bom-quote';
import { toCapabilities } from './partner';

// ── 협력사 RFQ 코어 — 설계 docs/SMARTBOM_PARTNER_RFQ.md §2 ──────────────────
// diff 발송(유지분 보존)·회신 replace-all 저장(포털/대리 공용)·직렬화.
// 요청 부품행 범위는 저장하지 않고 견적의 included 행에서 파생한다(1차 — 부분 선택 후속).

export const asBomRfqStatus = (v: string): BomRfqStatusType =>
  v === 'quoted' ? 'quoted' : v === 'closed' ? 'closed' : 'requested';

type RfqWithItems = SpBomRfq & { items: SpBomRfqItem[] };

const toItemView = (item: SpBomRfqItem): AdminBomRfqItemViewType => ({
  rfqItemId: Number(item.id),
  quoteItemId: String(item.quoteItemId),
  source: item.source === 'api' ? 'api' : 'manual',
  unitPrice: item.unitPrice === null ? null : Number(item.unitPrice),
  currency: item.currency,
  replyQty: item.replyQty,
  moq: item.moq,
  stock: item.stock,
  dateCode: item.dateCode,
  leadTime: item.leadTime,
  memo: item.memo,
  updatedAt: item.updatedAt.toISOString(),
});

export const toAdminRfqView = (
  rfq: RfqWithItems & { partner: SpPartner },
): AdminBomRfqViewType => ({
  rfqId: Number(rfq.id),
  partnerId: Number(rfq.partnerId),
  partnerName: rfq.partner.name,
  status: asBomRfqStatus(rfq.status),
  totalAmount: rfq.totalAmount,
  currency: rfq.currency,
  deliveryDate: rfq.deliveryDate?.toISOString() ?? null,
  memo: rfq.memo,
  requestedAt: rfq.requestedAt.toISOString(),
  respondedAt: rfq.respondedAt?.toISOString() ?? null,
  repliedItemCount: rfq.items.filter((i) => i.unitPrice !== null).length,
  items: rfq.items.map(toItemView),
});

export const loadAdminRfqs = async (quoteId: bigint): Promise<AdminBomRfqViewType[]> => {
  const rfqs = await prisma.spBomRfq.findMany({
    where: { quoteId },
    include: { partner: true, items: { orderBy: { id: 'asc' } } },
    orderBy: { id: 'asc' },
  });
  return rfqs.map(toAdminRfqView);
};

// ── 요청 부품행 범위(파생) — 시트 선택 + included 행 ─────────────────────────
export const loadRfqScopeItems = async (quoteId: bigint): Promise<SpBomQuoteItem[]> => {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    include: { items: { orderBy: { rowIdx: 'asc' } }, sheets: true },
  });
  if (quote === null) return [];
  return filterActiveQuoteItems(quote.items, quote.sheets).filter((item) => item.included);
};

// ── diff 발송 — 선택 협력사 집합으로 수렴 ────────────────────────────────────
// 유지분(이미 발송) 보존, 빠진 미회신(requested)만 삭제, 회신(quoted) 문서는 빠져도
// 보존(회신 데이터 유실 방지 — 레거시 "빠지면 삭제"의 안전 개선). 신규만 생성·메일 대상.
export interface RfqDiffResult {
  added: number;
  kept: number;
  removed: number;
  addedPartners: SpPartner[]; // 알림 메일 대상(신규 발송분만)
}

export const validateRfqPartners = async (
  partnerIds: readonly number[],
): Promise<{ partners: SpPartner[]; error: string | null }> => {
  const partners = await prisma.spPartner.findMany({
    where: { id: { in: partnerIds.map((id) => BigInt(id)) } },
  });
  if (partners.length !== partnerIds.length) {
    return { partners, error: '존재하지 않는 파트너가 포함되어 있습니다.' };
  }
  const invalid = partners.find(
    (p) =>
      p.type !== 'partner' ||
      p.status !== 'approved' ||
      !toCapabilities(p.capabilities).includes('bom_rfq'),
  );
  if (invalid !== undefined) {
    return {
      partners,
      error: `'${invalid.name}' 은(는) RFQ 대상이 아닙니다 — 승인된 협력사(BOM 견적 트랙)만 선택할 수 있습니다.`,
    };
  }
  return { partners, error: null };
};

export const diffSendRfqs = async (
  quoteId: bigint,
  partnerIds: readonly number[],
): Promise<RfqDiffResult> => {
  const wanted = new Set(partnerIds.map((id) => BigInt(id)));
  return prisma.$transaction(async (tx) => {
    const existing = await tx.spBomRfq.findMany({ where: { quoteId } });
    const existingByPartner = new Map(existing.map((r) => [r.partnerId, r]));

    const toRemove = existing.filter(
      (r) => !wanted.has(r.partnerId) && r.status === 'requested',
    );
    if (toRemove.length > 0) {
      await tx.spBomRfq.deleteMany({ where: { id: { in: toRemove.map((r) => r.id) } } });
    }

    const toAddIds = [...wanted].filter((partnerId) => !existingByPartner.has(partnerId));
    if (toAddIds.length > 0) {
      await tx.spBomRfq.createMany({
        data: toAddIds.map((partnerId) => ({ quoteId, partnerId, status: 'requested' })),
      });
    }

    const addedPartners =
      toAddIds.length === 0
        ? []
        : await tx.spPartner.findMany({ where: { id: { in: toAddIds } } });

    return {
      added: toAddIds.length,
      kept: existing.length - toRemove.length,
      removed: toRemove.length,
      addedPartners,
    };
  });
};

// ── 회신 저장(replace-all) — 포털 회신·관리자 대리 입력 공용 코어 ────────────
// 합계 = Σ 단가 × (회신수량 ?? 주문수량), KRW 정수 반올림 박제. quoted 전환.
export const saveRfqReply = async (
  rfqId: bigint,
  body: BomRfqReplyBodyType,
): Promise<{ ok: true } | { ok: false; error: string }> => {
  const rfq = await prisma.spBomRfq.findUnique({ where: { id: rfqId } });
  if (rfq === null) return { ok: false, error: 'RFQ_NOT_FOUND' };
  if (rfq.status === 'closed') return { ok: false, error: 'RFQ_CLOSED' };

  const scopeItems = await loadRfqScopeItems(rfq.quoteId);
  const scopeById = new Map(scopeItems.map((item) => [String(item.id), item]));
  const unknown = body.items.find((item) => !scopeById.has(item.quoteItemId));
  if (unknown !== undefined) {
    return { ok: false, error: 'ITEM_OUT_OF_SCOPE' };
  }

  let total = 0;
  for (const item of body.items) {
    const scope = scopeById.get(item.quoteItemId);
    const qty = item.replyQty ?? scope?.orderQty ?? 0;
    total += item.unitPrice * qty;
  }
  const totalAmount = Math.round(total);
  const hasReply = body.items.length > 0;

  await prisma.$transaction(async (tx) => {
    await tx.spBomRfqItem.deleteMany({ where: { rfqId } });
    if (hasReply) {
      await tx.spBomRfqItem.createMany({
        data: body.items.map((item) => ({
          rfqId,
          quoteItemId: BigInt(item.quoteItemId),
          source: 'manual',
          unitPrice: new Prisma.Decimal(item.unitPrice),
          currency: rfq.currency,
          replyQty: item.replyQty,
          moq: item.moq,
          stock: item.stock,
          dateCode: item.dateCode,
          leadTime: item.leadTime,
          memo: item.memo,
        })),
      });
    }
    await tx.spBomRfq.update({
      where: { id: rfqId },
      data: {
        status: hasReply ? 'quoted' : 'requested',
        totalAmount: hasReply ? totalAmount : null,
        deliveryDate:
          body.deliveryDate === undefined || body.deliveryDate === null
            ? null
            : new Date(`${body.deliveryDate}T00:00:00+09:00`),
        memo: body.memo ?? null,
        respondedAt: hasReply ? new Date() : null,
      },
    });
  });
  return { ok: true };
};

// ── 협력사 포털 직렬화 — 고객 식별정보·목표단가 없는 뷰(D8) ─────────────────
export const toPartnerListItem = (
  rfq: RfqWithItems & { quote: { title: string } },
  scopeCount: number,
): PartnerRfqListItemType => ({
  rfqId: Number(rfq.id),
  quoteTitle: rfq.quote.title,
  status: asBomRfqStatus(rfq.status),
  itemCount: scopeCount,
  repliedItemCount: rfq.items.filter((i) => i.unitPrice !== null).length,
  totalAmount: rfq.totalAmount,
  currency: rfq.currency,
  requestedAt: rfq.requestedAt.toISOString(),
  respondedAt: rfq.respondedAt?.toISOString() ?? null,
});

export const toPartnerDetail = (
  rfq: RfqWithItems & { quote: { title: string } },
  scopeItems: readonly SpBomQuoteItem[],
): PartnerRfqDetailType => {
  const replyByItem = new Map(rfq.items.map((item) => [String(item.quoteItemId), item]));
  const items: PartnerRfqLineItemType[] = scopeItems.map((item) => {
    const reply = replyByItem.get(String(item.id));
    return {
      quoteItemId: String(item.id),
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      orderQty: item.orderQty,
      reply:
        reply?.unitPrice == null
          ? null
          : {
              unitPrice: Number(reply.unitPrice),
              replyQty: reply.replyQty,
              moq: reply.moq,
              stock: reply.stock,
              dateCode: reply.dateCode,
              leadTime: reply.leadTime,
              memo: reply.memo,
            },
    };
  });
  return {
    rfqId: Number(rfq.id),
    quoteTitle: rfq.quote.title,
    status: asBomRfqStatus(rfq.status),
    currency: rfq.currency,
    deliveryDate: rfq.deliveryDate?.toISOString() ?? null,
    memo: rfq.memo,
    totalAmount: rfq.totalAmount,
    requestedAt: rfq.requestedAt.toISOString(),
    respondedAt: rfq.respondedAt?.toISOString() ?? null,
    items,
  };
};

// quote 가 answered/closed 로 확정되면 하위 RFQ 도 마감한다(§2.3 전이).
export const closeRfqsForQuote = async (quoteId: bigint): Promise<void> => {
  await prisma.spBomRfq.updateMany({
    where: { quoteId, status: { not: 'closed' } },
    data: { status: 'closed' },
  });
};

// ── 행별 협력사 회신 선정(§2.2) — 스냅샷 박제 + 서버 재계산 + 감사 이벤트 ────
// 회신은 원장(sp_bom_rfq_item)에 살아 있고, 선정 시에만 selectedOffer 로 박제한다
// (snapshot-freeze). 회신 단가는 수량 구간이 없으므로 전 수량 단일가 사다리로 박제해
// 수량 변경 재계산에서도 단가가 유지된다.
export type PartnerSelectionResult =
  | 'ok'
  | 'quote-not-found'
  | 'item-not-found'
  | 'rfq-item-not-found'
  | 'not-priced';

const rfqOfferKey = (rfqItemId: bigint): string => `rfq:${String(rfqItemId)}`;

export const applyPartnerRfqSelection = async (
  quoteId: bigint,
  itemId: bigint,
  rfqItemId: bigint | null,
  actorId: string,
): Promise<PartnerSelectionResult> => {
  const quote = await prisma.spBomQuote.findUnique({
    where: { id: quoteId },
    include: { items: { orderBy: { rowIdx: 'asc' } }, sheets: true },
  });
  if (quote === null) return 'quote-not-found';
  const targetRow = quote.items.find((row) => row.id === itemId);
  if (targetRow === undefined) return 'item-not-found';

  let offer: BomQuoteSelectedOfferType | null = null;
  if (rfqItemId !== null) {
    const rfqItem = await prisma.spBomRfqItem.findUnique({
      where: { id: rfqItemId },
      include: { rfq: { include: { partner: true } } },
    });
    if (rfqItem === null) return 'rfq-item-not-found';
    if (rfqItem.rfq.quoteId !== quoteId || rfqItem.quoteItemId !== itemId) {
      return 'rfq-item-not-found';
    }
    if (rfqItem.unitPrice === null) return 'not-priced';
    const unitPrice = Number(rfqItem.unitPrice);
    offer = {
      offerKey: rfqOfferKey(rfqItem.id),
      supplier: rfqItem.rfq.partner.name, // 표시 어휘 — 협력사명(공급사 코드 사전과 분리)
      supplierSku: '',
      packaging: null,
      breakQty: Math.max(1, rfqItem.replyQty ?? targetRow.orderQty),
      unitPrice,
      currency: rfqItem.currency,
      unitPriceKrw: rfqItem.currency === 'KRW' ? unitPrice : null,
      moq: rfqItem.moq,
      orderMultiple: null,
      stock: rfqItem.stock,
      priceBreaks: [{ qty: 1, price: unitPrice }], // 전 수량 단일가(회신엔 구간 없음)
      fetchedAt: (rfqItem.rfq.respondedAt ?? new Date()).toISOString(),
      pinned: true, // 관리자 명시 선정 — 자동 갱신이 덮지 않는다
    };
  }

  const itemsDto = quote.items.map((row) => toItemDto(row));
  const target = itemsDto.find((item) => item.id === String(itemId));
  if (target === undefined) return 'item-not-found';
  const previousOffer = target.selectedOffer;
  const previousLineTotal = target.lineTotalKrw;

  target.selectionSource = offer === null ? 'none' : 'partner';
  target.selectedCandidateKey = null;
  target.selectedOffer = offer;

  const usdKrwRate = quote.usdKrwRateUsed === null ? null : Number(quote.usdKrwRateUsed);
  const computed = computeQuote(itemsDto, usdKrwRate, quote.shippingFee, quote.managementFee);
  const computedTarget = computed.items.find((item) => item.id === String(itemId));
  await persistQuoteComputed(quoteId, computed, usdKrwRate, {
    selectionEvent: {
      itemId: String(itemId),
      source: 'admin',
      actorId,
      previousCandidateKey: targetRow.selectedCandidateKey,
      selectedCandidateKey: null,
      previousMpn: targetRow.mpn,
      selectedMpn: targetRow.mpn,
      previousOfferKey: previousOffer?.offerKey ?? null,
      selectedOfferKey: offer?.offerKey ?? null,
      previousLineTotalKrw: previousLineTotal,
      selectedLineTotalKrw: computedTarget?.lineTotalKrw ?? null,
      reasonCodes: [],
    },
  });
  // 선정 포인터는 persist 경로(dataFor) 밖 컬럼이라 별도 갱신(표시·감사 보조 포인터).
  await prisma.spBomQuoteItem.update({
    where: { id: itemId },
    data: { selectedRfqItemId: rfqItemId },
  });
  return 'ok';
};
