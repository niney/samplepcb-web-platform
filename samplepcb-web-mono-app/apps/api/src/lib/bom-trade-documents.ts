import type { Prisma } from '@prisma/client';
import {
  BomPartnerQuotation,
  BomShipmentStatement,
  type BomPartnerQuotationType,
  type BomShipmentStatementType,
  type BomTradePartyType,
} from '@sp/api-contract';
import type { BusinessInfo } from './g5-db';
import { getBusinessInfo } from './g5-db';
import { prisma } from './prisma';
import { shipmentModeFromCountry } from './bom-shipment-policy';
import { kstDateStr } from './kst';

// 협력사 발행 거래 문서의 서버 단일 원본. 고객용 BOM 견적서와 방향이 반대이며,
// PO(수락한 견적)와 Packing List(실제 선적)를 각각 불변 근거로 사용한다.

export interface TradePartnerProfile {
  name: string;
  country: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  businessNo: string | null;
  ownerName: string | null;
  businessZip: string | null;
  businessAddress: string | null;
  businessType: string | null;
  businessItem: string | null;
  fax: string | null;
}

export interface TradeQuotationItemSource {
  id: bigint;
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  qty: number;
  unitPrice: Prisma.Decimal | number;
  lineTotal: number;
  moq: number | null;
  stock: number | null;
  dateCode: string | null;
  leadTime: string | null;
  quotationMemo: string | null;
}

export interface TradeQuotationSource {
  id: bigint;
  quoteId: bigint;
  quoteTitle: string;
  issuedAt: Date;
  currency: string;
  totalAmount: number;
  quotationDeliveryDate: Date | null;
  quotationMemo: string | null;
  partner: TradePartnerProfile;
  items: TradeQuotationItemSource[];
}

const text = (value: string | null | undefined): string => value ?? '';

export const partnerTradeParty = (partner: TradePartnerProfile): BomTradePartyType => ({
  companyName: partner.name,
  businessNo: text(partner.businessNo),
  ownerName: text(partner.ownerName),
  zip: text(partner.businessZip),
  address: text(partner.businessAddress),
  businessType: text(partner.businessType),
  businessItem: text(partner.businessItem),
  contactName: text(partner.contactName),
  tel: text(partner.contactPhone),
  fax: text(partner.fax),
  email: text(partner.contactEmail),
  country: text(partner.country),
});

export const samplePcbTradeParty = (business: BusinessInfo | null): BomTradePartyType => ({
  companyName: business?.companyName ?? '',
  businessNo: business?.businessNo ?? '',
  ownerName: business?.ownerName ?? '',
  zip: business?.zip ?? '',
  address: business?.addr ?? '',
  businessType: '',
  businessItem: '',
  contactName: business?.infoManagerName ?? '',
  tel: business?.tel ?? '',
  fax: business?.fax ?? '',
  email: business?.infoManagerEmail ?? '',
  country: 'KR',
});

const vatOf = (supplyAmount: number, partnerCountry: string | null): number =>
  shipmentModeFromCountry(partnerCountry) === 'domestic' ? Math.round(supplyAmount * 0.1) : 0;

export const buildPartnerQuotationDocument = (
  source: TradeQuotationSource,
  business: BusinessInfo | null,
  snapshotAt = new Date(),
): BomPartnerQuotationType => {
  const supplyAmount = source.totalAmount;
  const vatAmount = vatOf(supplyAmount, source.partner.country);
  return {
    kind: 'quotation',
    quotationNo: `PQT-SPB-${String(source.id)}`,
    poId: Number(source.id),
    quoteId: String(source.quoteId),
    quoteTitle: source.quoteTitle,
    issuedAt: source.issuedAt.toISOString(),
    deliveryDate:
      source.quotationDeliveryDate === null ? null : kstDateStr(source.quotationDeliveryDate),
    currency: source.currency,
    issuer: partnerTradeParty(source.partner),
    recipient: samplePcbTradeParty(business),
    items: source.items.map((item) => ({
      poItemId: Number(item.id),
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      description: item.description,
      qty: item.qty,
      unitPrice: Number(item.unitPrice),
      lineTotal: item.lineTotal,
      moq: item.moq,
      stock: item.stock,
      dateCode: item.dateCode,
      leadTime: item.leadTime,
      memo: item.quotationMemo,
    })),
    supplyAmount,
    vatAmount,
    totalAmount: supplyAmount + vatAmount,
    memo: source.quotationMemo,
    snapshotAt: snapshotAt.toISOString(),
  };
};

/** 기존 PO는 조회 부작용 없이 불변 PO 컬럼으로 렌더링한다. 신규 PO는 발행 시 이미 스냅샷된다. */
export const loadPartnerQuotationDocument = async (
  poId: bigint,
  partnerId?: bigint,
): Promise<BomPartnerQuotationType | null> => {
  const po = await prisma.spBomPo.findUnique({
    where: { id: poId },
    include: {
      partner: true,
      quote: { select: { title: true } },
      items: { orderBy: { id: 'asc' } },
    },
  });
  if (po === null || (partnerId !== undefined && po.partnerId !== partnerId)) return null;
  if (shipmentModeFromCountry(po.partner.country) !== 'domestic') return null;
  const saved = BomPartnerQuotation.safeParse(po.quotationData);
  if (saved.success) return saved.data;

  const business = await getBusinessInfo();
  const document = buildPartnerQuotationDocument(
    {
      id: po.id,
      quoteId: po.quoteId,
      quoteTitle: po.quote.title,
      issuedAt: po.issuedAt,
      currency: po.currency,
      totalAmount: po.totalAmount,
      quotationDeliveryDate: po.quotationDeliveryDate,
      quotationMemo: po.quotationMemo,
      partner: po.partner,
      items: po.items,
    },
    business,
  );
  return document;
};

const uniqueTexts = (values: (string | null)[]): string[] => [
  ...new Set(values.filter((value): value is string => value !== null && value !== '')),
];

/** 확정 Packing List와 PO 견적 스냅샷을 조합한다. GET은 어떤 원장도 변경하지 않는다. */
export const loadShipmentStatementDocument = async (
  shipmentId: bigint,
  partnerId?: bigint,
): Promise<BomShipmentStatementType | null> => {
  const shipment = await prisma.spBomShipment.findUnique({
    where: { id: shipmentId },
    include: {
      po: {
        include: {
          partner: true,
          quote: { select: { title: true } },
          items: { orderBy: { id: 'asc' } },
        },
      },
      pos: {
        orderBy: { id: 'asc' },
        include: {
          po: {
            include: {
              partner: true,
              quote: { select: { title: true } },
              items: { orderBy: { id: 'asc' } },
            },
          },
        },
      },
      packingItems: {
        include: {
          packages: {
            where: { voidedAt: null, status: { not: 'voided' } },
            orderBy: [{ packageNo: 'asc' }, { id: 'asc' }],
          },
        },
      },
    },
  });
  if (shipment === null) return null;
  if (partnerId !== undefined && shipment.po.partnerId !== partnerId) return null;
  if (shipment.mode !== 'domestic') return null;

  const business = await getBusinessInfo();
  const packingByPoItem = new Map(
    shipment.packingItems.map((item) => [item.poItemId, item.packages] as const),
  );
  const pos = shipment.pos.length > 0 ? shipment.pos.map((link) => link.po) : [shipment.po];
  const items = pos.flatMap((po) =>
    po.items.map((item) => {
      const packages = packingByPoItem.get(item.id) ?? [];
      const shippedQty =
        packages.length > 0 ? packages.reduce((sum, pkg) => sum + pkg.quantity, 0) : item.qty;
      return {
        poId: Number(po.id),
        quoteId: String(po.quoteId),
        quoteTitle: po.quote.title,
        poItemId: Number(item.id),
        mpn: item.mpn,
        manufacturerName: item.manufacturerName,
        description: item.description,
        orderedQty: item.qty,
        shippedQty,
        unitPrice: Number(item.unitPrice),
        lineTotal: Math.round(Number(item.unitPrice) * shippedQty),
        lotNos: uniqueTexts(packages.map((pkg) => pkg.lotNo)),
        dateCodes: uniqueTexts(packages.map((pkg) => pkg.dateCode)),
      };
    }),
  );
  const supplyAmount = items.reduce((sum, item) => sum + item.lineTotal, 0);
  const vatAmount = vatOf(supplyAmount, shipment.po.partner.country);
  const now = new Date();
  const primaryQuotation = BomPartnerQuotation.safeParse(shipment.po.quotationData);
  const snapshotAt = shipment.packingFinalizedAt ?? now;
  const issuedAt =
    shipment.packingFinalizedAt ?? shipment.packingUpdatedAt ?? shipment.shipDate ?? now;
  const document: BomShipmentStatementType = {
    kind: 'statement',
    statementNo: `STMT-SPB-${String(shipment.id)}-R${String(shipment.packingRevision)}`,
    shipmentId: Number(shipment.id),
    packingRevision: shipment.packingRevision,
    isDraft: shipment.packingFinalizedAt === null,
    issuedAt: issuedAt.toISOString(),
    finalizedAt: shipment.packingFinalizedAt?.toISOString() ?? null,
    mode: 'domestic',
    currency: pos[0]?.currency ?? shipment.po.partner.defaultCurrency,
    issuer: primaryQuotation.success
      ? primaryQuotation.data.issuer
      : partnerTradeParty(shipment.po.partner),
    recipient: primaryQuotation.success
      ? primaryQuotation.data.recipient
      : samplePcbTradeParty(business),
    shipDate: shipment.shipDate?.toISOString().slice(0, 10) ?? null,
    carrier: shipment.carrier,
    trackingNumber: shipment.trackingNumber,
    items,
    totalQuantity: items.reduce((sum, item) => sum + item.shippedQty, 0),
    supplyAmount,
    vatAmount,
    totalAmount: supplyAmount + vatAmount,
    snapshotAt: snapshotAt.toISOString(),
  };
  return BomShipmentStatement.parse(document);
};
