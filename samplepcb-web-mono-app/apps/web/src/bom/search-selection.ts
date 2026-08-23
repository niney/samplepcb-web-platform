import type {
  BomPartOfferOptionType,
  BomQuoteItemType,
  BomSearchCartSelectionType,
} from '@sp/api-contract';

export function bomSearchSelectionKey(
  partId: string,
  selection: BomSearchCartSelectionType,
): string {
  if (selection.kind === 'manufacturer_catalog') return `${partId}\u001fmanufacturer_catalog`;
  // 협력사 보유는 부품당 한 줄이다 — 공급사·SKU 로 갈리지 않는다(docs/PARTNER_PARTS.md).
  if (selection.kind === 'partner_stock') return `${partId}\u001fpartner_stock`;
  return `${partId}\u001fsupplier_offer\u001f${selection.supplier}\u001f${selection.supplierSku}`;
}

export function bomOfferSelection(offer: BomPartOfferOptionType): BomSearchCartSelectionType {
  return offer.offerKind === 'manufacturer_catalog'
    ? { kind: 'manufacturer_catalog' }
    : {
        kind: 'supplier_offer',
        supplier: offer.supplier,
        supplierSku: offer.supplierSku,
      };
}

export function bomQuoteItemSelection(item: BomQuoteItemType): BomSearchCartSelectionType | null {
  if (item.partId === null) return null;
  if (item.selectedOffer === null) {
    // 협력사 보유로 담은 행은 구매 조건이 없다 — 출처로 구분한다.
    if (item.selectionSource === 'partner') return { kind: 'partner_stock' };
    return item.catalogInquiry ? { kind: 'manufacturer_catalog' } : null;
  }
  return {
    kind: 'supplier_offer',
    supplier: item.selectedOffer.supplier,
    supplierSku: item.selectedOffer.supplierSku,
  };
}

export function bomQuoteItemSelectionKey(item: BomQuoteItemType): string | null {
  if (item.partId === null) return null;
  const selection = bomQuoteItemSelection(item);
  return selection === null ? null : bomSearchSelectionKey(item.partId, selection);
}
