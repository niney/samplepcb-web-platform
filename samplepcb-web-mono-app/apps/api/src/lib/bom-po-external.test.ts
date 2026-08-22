// 외부공급사 발주 보조(D41) 순수 함수 — 카트 대조·가져오기 CSV.
import { describe, expect, it } from 'vitest';
import {
  buildSupplierImportCsv,
  compareMouserCart,
  describeMouserCartDiff,
  supplierImportFileName,
} from './bom-po-external';

const lines = [
  { sku: '791-WR04X101JTL', qty: 2 },
  { sku: '791-WR04X103JTL', qty: 1 },
];

describe('compareMouserCart — 발주 품목 ↔ 카트 내용 대조', () => {
  it('품번·수량이 같으면 일치(순서 무관)', () => {
    const diff = compareMouserCart(lines, [...lines].reverse());
    expect(diff).toEqual({ matches: true, missing: [], qtyDiff: [], extra: [] });
    expect(describeMouserCartDiff(diff)).toEqual([]);
  });

  it('빈 카트(사라짐) — 전 품목 missing', () => {
    const diff = compareMouserCart(lines, []);
    expect(diff.matches).toBe(false);
    expect(diff.missing).toEqual(['791-WR04X101JTL', '791-WR04X103JTL']);
    expect(describeMouserCartDiff(diff)).toEqual([
      '791-WR04X101JTL 없음',
      '791-WR04X103JTL 없음',
    ]);
  });

  it('수량 다름·발주 외 품번을 각각 짚는다', () => {
    const diff = compareMouserCart(lines, [
      { sku: '791-WR04X101JTL', qty: 5 },
      { sku: '595-TPS54331DR', qty: 1 },
    ]);
    expect(diff.matches).toBe(false);
    expect(diff.missing).toEqual(['791-WR04X103JTL']);
    expect(diff.qtyDiff).toEqual(['791-WR04X101JTL 수량 2→5']);
    expect(diff.extra).toEqual(['595-TPS54331DR']);
    expect(describeMouserCartDiff(diff)).toEqual([
      '791-WR04X103JTL 없음',
      '791-WR04X101JTL 수량 2→5',
      '595-TPS54331DR 발주 외',
    ]);
  });

  it('대소문자·앞뒤 공백은 같은 SKU, 같은 SKU 여러 행은 합산', () => {
    const diff = compareMouserCart(
      [
        { sku: '791-wr04x101jtl ', qty: 1 },
        { sku: '791-WR04X101JTL', qty: 1 },
      ],
      [{ sku: '791-WR04X101JTL', qty: 2 }],
    );
    expect(diff.matches).toBe(true);
  });
});

describe('buildSupplierImportCsv — 공급사 장바구니 가져오기 파일', () => {
  const items = [
    {
      supplierSku: '791-WR04X101JTL',
      mpn: 'WR04X101 JTL',
      manufacturerName: 'Walsin',
      description: 'Thick Film Resistors - SMD 100 OHM 5%',
      qty: 2,
    },
    {
      supplierSku: null,
      mpn: 'CL05B103KB5NNNC',
      manufacturerName: 'Samsung',
      description: '10000 pF ±10% 50V, "X7R" 0402',
      qty: 3,
    },
  ];

  it('BOM·헤더·CRLF·따옴표 escape·SKU 없는 행은 품번 칸 비움', () => {
    const csv = buildSupplierImportCsv('mouser', items);
    expect(csv.startsWith('﻿')).toBe(true);
    const rows = csv.slice(1).split('\r\n');
    expect(rows[0]).toBe(
      'Mouser Part Number,Quantity,Manufacturer Part Number,Manufacturer,Description',
    );
    expect(rows[1]).toBe(
      '791-WR04X101JTL,2,WR04X101 JTL,Walsin,Thick Film Resistors - SMD 100 OHM 5%',
    );
    expect(rows[2]).toBe(',3,CL05B103KB5NNNC,Samsung,"10000 pF ±10% 50V, ""X7R"" 0402"');
    expect(rows[3]).toBe(''); // 마지막 CRLF
    expect(csv.includes('\n') && !csv.includes('\r\n\r\n')).toBe(true);
  });

  it('공급사별 품번 헤더 — digikey / 미지 공급사', () => {
    expect(buildSupplierImportCsv('digikey', []).slice(1)).toMatch(/^Digi-Key Part Number,/);
    expect(buildSupplierImportCsv('unikeyic', []).slice(1)).toMatch(/^Supplier Part Number,/);
  });

  it('파일명 — 공급사·PO 번호', () => {
    expect(supplierImportFileName('mouser', 165n)).toBe('mouser-po-165-import.csv');
  });
});
