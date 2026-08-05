import type {
  BomPartOfferOptionType,
  BomQuoteItemType,
  BomSearchCartSelectionType,
} from '@sp/api-contract';

export function bomSearchSelectionKey(
  partId: string,
  selection: BomSearchCartSelectionType,
): string {
  return selection.kind === 'manufacturer_catalog'
    ? `${partId}\u001fmanufacturer_catalog`
    : `${partId}\u001fsupplier_offer\u001f${selection.supplier}\u001f${selection.supplierSku}`;
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
