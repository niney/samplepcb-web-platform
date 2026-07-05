import { describe, expect, it } from 'vitest';
import {
  buildDeliveryWorkbook,
  csvSafeCell,
  deliveryRowToCells,
  extractDeliveryRowsFromMatrix,
  printAddress,
  readDeliverySheet,
} from './delivery-excel';
import type { DeliveryExcelRow } from './g5-db';

// 엑셀 배송처리 순수 헬퍼 — 코어 orderdeliveryexcel/orderdeliveryupdate 이식 정합성.

describe('csvSafeCell — 수식 인젝션 방지(코어 csv_safe_cell 미러)', () => {
  it.each(['=1+1', '+1', '-1', '@x', '\tx', '\rx'])("위험 시작문자 '%s' 는 작은따옴표 prefix", (v) => {
    expect(csvSafeCell(v)).toBe(`'${v}`);
  });
  it('일반 값·빈 값은 그대로', () => {
    expect(csvSafeCell('CJ대한통운')).toBe('CJ대한통운');
    expect(csvSafeCell('')).toBe('');
  });
});

describe('printAddress — 배송지 주소 조립(코어 print_address 미러)', () => {
  it("addr4='N' 은 공백 구분", () => {
    expect(printAddress('서울시 강남구', '역삼동 123', '4층', 'N')).toBe('서울시 강남구 역삼동 123 4층');
  });
  it("addr4≠'N' 은 쉼표 구분", () => {
    expect(printAddress('서울시 강남구', '역삼동 123', '4층', 'R')).toBe('서울시 강남구, 역삼동 123 4층');
  });
  it('addr2 없으면 구분자 없이, trim 적용', () => {
    expect(printAddress('  서울시  ', '', '  501호 ', '')).toBe('서울시 501호');
  });
});

describe('deliveryRowToCells — 10열 매핑(순서·문자열 셀)', () => {
  const row: DeliveryExcelRow = {
    odId: '20260705123456',
    odName: '=홍길동', // 수식처럼 보이는 이름
    odTel: '02-1234-5678',
    odHp: '010-1111-2222',
    bName: '김철수',
    bTel: '031-000-0000',
    bHp: '010-3333-4444',
    bAddr1: '서울시 강남구',
    bAddr2: '역삼동 1',
    bAddr3: '5층',
    bAddrJibeon: 'R',
    deliveryCompany: 'CJ대한통운',
    invoiceNo: '0012345',
  };
  it('10열, od_id 원본·이름은 인젝션 방어·주소 조립', () => {
    const cells = deliveryRowToCells(row);
    expect(cells).toHaveLength(10);
    expect(cells[0]).toBe('20260705123456');
    expect(cells[1]).toBe("'=홍길동");
    expect(cells[7]).toBe('서울시 강남구, 역삼동 1 5층');
    expect(cells[8]).toBe('CJ대한통운');
    expect(cells[9]).toBe('0012345');
  });
});

describe('extractDeliveryRowsFromMatrix — A/I/J 추출(코어 인덱스 0/8/9)', () => {
  const header = new Array<string>(10).fill('h');
  const mkRow = (odId: string, company: string, invoice: string): string[] => {
    const r = new Array<string>(10).fill('');
    r[0] = odId;
    r[8] = company;
    r[9] = invoice;
    return r;
  };
  it('헤더(첫 행) 제외, trim, 빈 행 스킵', () => {
    const matrix = [
      header,
      mkRow(' 1001 ', 'CJ', '111'),
      mkRow('', '', ''), // 빈 행 스킵
      mkRow('1002', ' 우체국 ', ' 222 '),
    ];
    expect(extractDeliveryRowsFromMatrix(matrix)).toEqual([
      { odId: '1001', deliveryCompany: 'CJ', invoiceNo: '111' },
      { odId: '1002', deliveryCompany: '우체국', invoiceNo: '222' },
    ]);
  });
  it('필드 결손(회사/운송장 비어도)은 통과 — 판정은 matchDeliveryRows', () => {
    expect(extractDeliveryRowsFromMatrix([header, mkRow('1003', '', '')])).toEqual([
      { odId: '1003', deliveryCompany: '', invoiceNo: '' },
    ]);
  });
});

describe('build→read→extract 라운드트립 (exceljs 실동작 + od_id 빅넘버 보존)', () => {
  it('생성한 xlsx 를 되읽어 od_id/회사/운송장이 문자열로 왕복', async () => {
    const rows: DeliveryExcelRow[] = [
      {
        odId: '20260705999999', // 빅넘버 — 과학표기·반올림 없이 문자열 보존돼야
        odName: '홍길동',
        odTel: '02-1',
        odHp: '010-1',
        bName: '김철수',
        bTel: '031-1',
        bHp: '010-2',
        bAddr1: '서울',
        bAddr2: '강남',
        bAddr3: '1층',
        bAddrJibeon: 'R',
        deliveryCompany: 'CJ',
        invoiceNo: '0099',
      },
    ];
    const buffer = await buildDeliveryWorkbook(rows);
    const matrix = await readDeliverySheet(buffer);
    // 첫 행은 헤더
    expect(matrix[0]?.[0]).toBe('주문번호');
    const parsed = extractDeliveryRowsFromMatrix(matrix);
    expect(parsed).toEqual([
      { odId: '20260705999999', deliveryCompany: 'CJ', invoiceNo: '0099' },
    ]);
  });
});
