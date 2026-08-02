import ExcelJS from 'exceljs';
import type {
  SpBomPo,
  SpBomPoItem,
  SpBomShipment,
  SpBomShipmentPo,
  SpPartner,
} from '@prisma/client';
import { BomInvoiceData } from '@sp/api-contract';
import type { BomInvoiceDataType, BomInvoiceItemType } from '@sp/api-contract';
import { prisma } from './prisma';
import { getBusinessInfo, getShopEstimateProfile } from './g5-db';

// ── 상업송장 생성기(D23) — 자동 초안·편집본 영속·엑셀 렌더 ───────────────────
// 레거시 SpShipmentInvoiceService(자동 채움)·SpInvoiceXlsxRenderer(POI 레이아웃)를
// 승계하되: 품목=발주 스냅샷 행(BOM 다행), 수하인=영카트 사업자정보(거점 하드코딩 제거),
// 저장본이 자동 조립을 영원히 가리는 함정은 fresh 재조립 옵션으로 교정. PDF 는 프론트
// (html2canvas+jspdf — 레거시 방식)가 담당하고 서버는 초안·저장·엑셀만.

const COUNTRY_NAMES: Record<string, string> = {
  KR: 'KOREA',
  CN: 'China',
  US: 'USA',
  JP: 'Japan',
  TW: 'Taiwan',
  HK: 'Hong Kong',
  VN: 'Vietnam',
};
const countryName = (code: string | null): string =>
  code === null ? '' : (COUNTRY_NAMES[code] ?? code);

const todayKst = (): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

type PoForInvoice = SpBomPo & {
  items: SpBomPoItem[];
  partner: SpPartner;
  shipmentLink: (SpBomShipmentPo & { shipment: SpBomShipment }) | null;
};

export const loadPoForInvoice = async (poId: bigint): Promise<PoForInvoice | null> =>
  prisma.spBomPo.findUnique({
    where: { id: poId },
    include: {
      items: { orderBy: { id: 'asc' } },
      partner: true,
      shipmentLink: { include: { shipment: true } },
    },
  });

/** 초안 — 저장본(편집본) 우선, fresh 면 발주 데이터로 재조립(레거시 stale 함정 교정). */
export const buildInvoiceDraft = async (
  po: PoForInvoice,
  fresh: boolean,
): Promise<BomInvoiceDataType> => {
  const shipment = po.shipmentLink?.shipment ?? null;
  if (!fresh && shipment?.invoiceData != null) {
    const saved = BomInvoiceData.safeParse(shipment.invoiceData);
    if (saved.success) return saved.data;
  }

  // 품목 = 선적(박스) 단위(§6.10) — 묶음 소속 발주서 전체의 스냅샷 합산. D23 이
  // 선적 그룹보다 먼저 구현돼 발주 1건 단위 조립이 남아 묶음의 나머지 품목이
  // 통째로 빠지던 결함 교정(같은 협력사 묶음이라 발송인 정보는 po 기준 그대로).
  let poRows: { currency: string; items: SpBomPoItem[] }[] = [po];
  if (shipment !== null) {
    const links = await prisma.spBomShipmentPo.findMany({
      where: { shipmentId: shipment.id },
      include: { po: { include: { items: { orderBy: { id: 'asc' } } } } },
      orderBy: { id: 'asc' },
    });
    if (links.length > 0) poRows = links.map((link) => link.po);
  }

  const [business, profile] = await Promise.all([getBusinessInfo(), getShopEstimateProfile()]);
  const items: BomInvoiceItemType[] = poRows.flatMap((row) =>
    row.items.map((item) => ({
      description:
        item.manufacturerName === null || item.manufacturerName === ''
          ? item.mpn
          : `${item.mpn} (${item.manufacturerName})`,
      hsCode: '',
      qty: String(item.qty),
      currency: row.currency,
      unitValue: Number(item.unitPrice),
      totalValue: item.lineTotal,
    })),
  );
  return {
    companyName: po.partner.name,
    shipperName: po.partner.contactName ?? '',
    shipperAddress: '',
    shipperTel: po.partner.contactPhone ?? '',
    countryOfOrigin: countryName(po.partner.country),
    countryOfDestination: 'KOREA',
    consigneeCompany: business?.companyName ?? '',
    consigneeContact: business?.infoManagerName ?? '',
    consigneeAddress: business?.addr ?? '',
    consigneeTel: business?.tel ?? '',
    consigneeFax: business?.fax ?? '',
    consigneeEmail: profile?.managerEmail ?? '',
    countryOfManufacture: countryName(po.partner.country),
    invoiceNo: `SPB-${String(po.id)}-${shipment === null ? '0' : String(shipment.id)}`,
    netWeight: '',
    grossWeight: '',
    currency: po.currency,
    invoiceDate: todayKst(),
    items,
    totalValue: items.reduce((sum, item) => sum + (item.totalValue ?? 0), 0),
  };
};

export const saveInvoiceData = async (
  shipmentId: bigint,
  data: BomInvoiceDataType,
): Promise<void> => {
  const saved = await prisma.spBomShipment.updateMany({
    where: { id: shipmentId, mode: 'international' },
    data: { invoiceData: data },
  });
  if (saved.count !== 1) throw new Error('Commercial Invoice is only available internationally');
};

// ── 엑셀 렌더 — 레거시 SpInvoiceXlsxRenderer(POI) 레이아웃의 exceljs 이식 ─────
// 단일 시트 "INVOICES", 영문+简体中文 병기 통관 양식. B~G 컬럼 사용(A=여백).

const nz = (v: string | null | undefined, fallback = ''): string =>
  v != null && v.trim() !== '' ? v : fallback;

export const renderInvoiceXlsx = async (inv: BomInvoiceDataType): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('INVOICES', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [
    { width: 3.5 },
    { width: 40 },
    { width: 12 },
    { width: 11 },
    { width: 12 },
    { width: 11 },
    { width: 15 },
  ];

  const thin = { style: 'thin' as const };
  const boxBorder = { top: thin, bottom: thin, left: thin, right: thin };
  const grayFill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9D9D9' },
  };
  let r = 1;

  const mergedText = (
    text: string,
    height: number,
    font: Partial<ExcelJS.Font>,
    fill?: ExcelJS.Fill,
    align: 'left' | 'center' | 'right' = 'center',
  ): void => {
    const row = sheet.getRow(r);
    row.height = height;
    sheet.mergeCells(r, 2, r, 7);
    const cell = row.getCell(2);
    cell.value = text;
    cell.font = { name: 'Arial', ...font };
    cell.alignment = { vertical: 'middle', horizontal: align };
    if (fill !== undefined) {
      for (let c = 2; c <= 7; c += 1) row.getCell(c).fill = fill;
    }
    r += 1;
  };

  // 좌(B..E) "라벨: 값" + 우(F..G) "라벨: 값" 한 줄
  const infoRow = (left: string, right: string): void => {
    const row = sheet.getRow(r);
    row.height = 18;
    sheet.mergeCells(r, 2, r, 5);
    sheet.mergeCells(r, 6, r, 7);
    const l = row.getCell(2);
    l.value = left;
    l.font = { name: 'Arial', size: 10 };
    l.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    const rt = row.getCell(6);
    rt.value = right;
    rt.font = { name: 'Arial', size: 10 };
    rt.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
    r += 1;
  };

  mergedText(nz(inv.companyName, 'COMMERCIAL INVOICE'), 24, { size: 12, bold: true });
  mergedText('COMMERCIAL INVOICE  商业发票', 34, { size: 16, bold: true });
  r += 1;

  mergedText('SHIPPER INFORMATION  寄货人资料', 18, { size: 10, bold: true }, grayFill, 'left');
  infoRow(
    `SHIPPER 寄货人 / COMPANY NAME 公司名称 :  ${nz(inv.companyName)}`,
    `COUNTRY OF ORIGINAL 发件地国家 :  ${nz(inv.countryOfOrigin)}`,
  );
  infoRow(
    `NAME OF SENDER 寄件人 :  ${nz(inv.shipperName)}`,
    `COUNTRY OF DESTINATION 目的地国家 :  ${nz(inv.countryOfDestination)}`,
  );
  infoRow(`ADDRESS 地址 :  ${nz(inv.shipperAddress)}`, '');
  infoRow(`TEL 电话 :  ${nz(inv.shipperTel)}`, '');
  r += 1;

  mergedText('CONSIGNEES INFORMATION  收货人资料', 18, { size: 10, bold: true }, grayFill, 'left');
  infoRow(
    `CONSIGNEE 收货人 / COMPANY NAME 公司名称 :  ${nz(inv.consigneeCompany)}`,
    `TELEPHONE 电话 :  ${nz(inv.consigneeTel)}`,
  );
  infoRow(
    `CONTACT PERSON 联系人 :  ${nz(inv.consigneeContact)}`,
    `FAX 传真 :  ${nz(inv.consigneeFax)}`,
  );
  infoRow(
    `ADDRESS 地址 :  ${nz(inv.consigneeAddress)}`,
    `EMAIL 邮箱 :  ${nz(inv.consigneeEmail)}`,
  );
  r += 1;

  infoRow(
    `Invoice Number 发票号 :  ${nz(inv.invoiceNo)}`,
    `Country of Manufacture 货物原产国 :  ${nz(inv.countryOfManufacture)}`,
  );
  infoRow(`NET Weight 净重 :  ${nz(inv.netWeight)}`, `Gross Weight 毛重 :  ${nz(inv.grossWeight)}`);
  r += 1;

  // 품목 헤더
  const headRow = sheet.getRow(r);
  headRow.height = 22;
  const heads = [
    'DESCRIPTION 品名',
    'HS CODE',
    'NO.OF UNIT 数量',
    'CURRENCY 货币',
    'UNIT VALUE 单价',
    'TOTAL VALUE 总价',
  ];
  heads.forEach((text, idx) => {
    const cell = headRow.getCell(2 + idx);
    cell.value = text;
    cell.font = { name: 'Arial', size: 10, bold: true };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.fill = grayFill;
    cell.border = boxBorder;
  });
  r += 1;

  let sum = 0;
  for (const item of inv.items) {
    const row = sheet.getRow(r);
    row.height = 18;
    const values: (string | number | null)[] = [
      nz(item.description),
      nz(item.hsCode),
      nz(item.qty),
      nz(item.currency, inv.currency),
      item.unitValue,
      item.totalValue,
    ];
    values.forEach((value, idx) => {
      const cell = row.getCell(2 + idx);
      if (value !== null) cell.value = value;
      cell.font = { name: 'Arial', size: 10 };
      cell.border = boxBorder;
      cell.alignment =
        idx === 0
          ? { vertical: 'middle', horizontal: 'left', wrapText: true }
          : idx >= 4
            ? { vertical: 'middle', horizontal: 'right' }
            : { vertical: 'middle', horizontal: 'center' };
      if (idx >= 4) cell.numFmt = '#,##0.00';
    });
    sum += item.totalValue ?? 0;
    r += 1;
  }

  // 합계
  const totalRow = sheet.getRow(r);
  totalRow.height = 20;
  sheet.mergeCells(r, 2, r, 6);
  const totalLabel = totalRow.getCell(2);
  totalLabel.value = `Total Value 总申报价值 :  (${nz(inv.currency, 'USD')})`;
  totalLabel.font = { name: 'Arial', size: 11, bold: true };
  totalLabel.alignment = { vertical: 'middle', horizontal: 'right' };
  const totalNum = totalRow.getCell(7);
  totalNum.value = inv.totalValue !== 0 ? inv.totalValue : sum;
  totalNum.font = { name: 'Arial', size: 11, bold: true };
  totalNum.alignment = { vertical: 'middle', horizontal: 'right' };
  totalNum.numFmt = '#,##0.00';
  for (let c = 2; c <= 7; c += 1) totalRow.getCell(c).border = boxBorder;
  r += 2;

  infoRow('Signature / Title 寄货人签署 / 职位 :', `Date 日期 :  ${nz(inv.invoiceDate)}`);
  mergedText('Company Stamp 公司印章 :', 28, { size: 10 }, undefined, 'left');

  return Buffer.from(await wb.xlsx.writeBuffer());
};
