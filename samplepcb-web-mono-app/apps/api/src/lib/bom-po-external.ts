// ── 외부공급사 발주 보조(D41, docs/SMARTBOM_PARTNER_RFQ.md §6.34) — 순수 함수 ────────────
// Mouser API 카트는 웹의 '현재 장바구니'가 아니고 시간이 지나면 비워질 수 있다(실측). 그래서
// (1) 카트 내용을 발주 품목과 **행 단위로 대조**하고(GET 은 없는 키도 빈 카트 200 — 존재가 아니라
//     내용을 본다), (2) API 카트와 무관한 우회로로 공급사 장바구니 '스프레드시트 업로드'용
//     가져오기 파일을 만든다. prisma 무접촉 — 단위 테스트가 전부를 덮는다.
import type { ExternalOrderLine } from './supplier-order';

export interface MouserCartDiff {
  matches: boolean;
  /** 발주엔 있는데 카트에 없는 SKU */
  missing: string[];
  /** 있지만 수량이 다른 SKU — "sku 수량 3→1" */
  qtyDiff: string[];
  /** 카트에만 있는 SKU */
  extra: string[];
}

const normalizeSku = (sku: string): string => sku.trim().toUpperCase();

const sumByKey = (lines: readonly ExternalOrderLine[]): Map<string, { sku: string; qty: number }> => {
  const out = new Map<string, { sku: string; qty: number }>();
  for (const line of lines) {
    const key = normalizeSku(line.sku);
    if (key === '') continue;
    const prev = out.get(key);
    out.set(key, { sku: prev?.sku ?? line.sku.trim(), qty: (prev?.qty ?? 0) + line.qty });
  }
  return out;
};

/** 발주 품목(want) ↔ 카트 내용(have) 대조. 같은 SKU 가 여러 행이면 합산해 본다. */
export const compareMouserCart = (
  lines: readonly ExternalOrderLine[],
  cartItems: readonly ExternalOrderLine[],
): MouserCartDiff => {
  const want = sumByKey(lines);
  const have = sumByKey(cartItems);
  const missing: string[] = [];
  const qtyDiff: string[] = [];
  const extra: string[] = [];
  for (const [key, w] of want) {
    const h = have.get(key);
    if (h === undefined) missing.push(w.sku);
    else if (h.qty !== w.qty) qtyDiff.push(`${w.sku} 수량 ${String(w.qty)}→${String(h.qty)}`);
  }
  for (const [key, h] of have) {
    if (!want.has(key)) extra.push(h.sku);
  }
  return {
    matches: missing.length === 0 && qtyDiff.length === 0 && extra.length === 0,
    missing,
    qtyDiff,
    extra,
  };
};

/** 불일치 요약 — 화면·박제용 짧은 문장 배열(일치면 빈 배열). */
export const describeMouserCartDiff = (diff: MouserCartDiff): string[] => [
  ...diff.missing.map((sku) => `${sku} 없음`),
  ...diff.qtyDiff,
  ...diff.extra.map((sku) => `${sku} 발주 외`),
];

export interface ImportFileLine {
  supplierSku: string | null;
  mpn: string;
  manufacturerName: string | null;
  description: string | null;
  qty: number;
}

const IMPORT_SKU_HEADER: Record<string, string> = {
  mouser: 'Mouser Part Number',
  digikey: 'Digi-Key Part Number',
};

const csvCell = (value: string | number | null): string => {
  const text = value === null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** 공급사 장바구니 가져오기 파일(.csv — UTF-8 BOM·CRLF: 엑셀·공급사 업로드 양쪽 무난).
 *  열 = 공급사 품번·수량·제조사 품번·제조사·설명. SKU 없는 행은 품번 칸을 비워 두고 MPN 으로
 *  찾게 한다(Mouser 장바구니 업로드는 Mouser 번호/제조업체 번호 둘 다 받는다). */
export const buildSupplierImportCsv = (
  supplierCode: string,
  lines: readonly ImportFileLine[],
): string => {
  const header = [
    IMPORT_SKU_HEADER[supplierCode] ?? 'Supplier Part Number',
    'Quantity',
    'Manufacturer Part Number',
    'Manufacturer',
    'Description',
  ];
  const rows = lines.map((line) =>
    [line.supplierSku ?? '', line.qty, line.mpn, line.manufacturerName ?? '', line.description ?? '']
      .map(csvCell)
      .join(','),
  );
  return `\uFEFF${[header.join(','), ...rows].join('\r\n')}\r\n`;
};

export const supplierImportFileName = (supplierCode: string, poId: number | bigint): string =>
  `${supplierCode}-po-${String(poId)}-import.csv`;
