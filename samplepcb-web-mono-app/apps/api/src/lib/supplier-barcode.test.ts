// 공급사 봉투 라벨 2D 바코드 파서(D42) — 골든은 InvenTree 공급사 바코드 테스트의 DigiKey/Mouser 라벨을
// 승계(ECIA 규격 동형). 제어문자는 fromCharCode 로 만들어 소스에 원시 제어문자를 두지 않는다.
import { describe, expect, it } from 'vitest';
import {
  normalizePartKey,
  normalizeSupplierBarcode,
  parseSupplierBarcode,
} from './supplier-barcode';

const RS = String.fromCharCode(0x1e);
const GS = String.fromCharCode(0x1d);
const EOT = String.fromCharCode(0x04);
const ecia = (...fields: string[]): string => `[)>${RS}06${GS}${fields.join(GS)}`;

const DIGIKEY = ecia(
  'P296-LM358BIDDFRCT-ND',
  '1PLM358BIDDFR',
  'K',
  '1K72991337',
  '10K85781337',
  '11K1',
  '4LPH',
  'Q10',
  '11ZPICK',
  '12Z15221337',
  '13Z361337',
  `20Z${'0'.repeat(60)}`,
);
const DIGIKEY_30P = ecia('30P296-LM358BIDDFRCT-ND', 'K', '1K72991337', '10K85781337', '11K1', '4LPH', 'Q10');
const MOUSER = `${ecia('KP0-1337', '14K011', '1PMC34063ADR', 'Q3', '11K073121337', '4LMX', '1VTI')}${RS}${EOT}`;
const MOUSER_OLD = `>[)>06${GS}K21421337${GS}14K033${GS}1PLDK320ADU33R${GS}Q32${GS}11K060931337${GS}4LCN${GS}1VSTMicro`;

describe('parseSupplierBarcode — ECIA 2D 라벨', () => {
  it('DigiKey 라벨 — P/1P/Q/1K/10K/11K/4L, 고객 PO(K) 비어 있음', () => {
    const parsed = parseSupplierBarcode(DIGIKEY);
    expect(parsed?.format).toBe('ecia2d');
    expect(parsed?.supplier).toBe('digikey');
    expect(parsed?.fields).toMatchObject({
      supplierSku: '296-LM358BIDDFRCT-ND',
      mpn: 'LM358BIDDFR',
      quantity: 10,
      customerOrderNo: null,
      supplierOrderNo: '72991337',
      invoiceNo: '85781337',
      packingListNo: '1',
      countryOfOrigin: 'PH',
      lotCode: null,
      dateCode: null,
      manufacturer: null,
    });
    expect(parsed?.identifiers['12Z']).toBe('15221337');
  });

  it('DigiKey 30P 형 — 공급사 품번은 30P 우선, 공급사 판정 digikey', () => {
    const parsed = parseSupplierBarcode(DIGIKEY_30P);
    expect(parsed?.supplier).toBe('digikey');
    expect(parsed?.fields.supplierSku).toBe('296-LM358BIDDFRCT-ND');
    expect(parsed?.fields.mpn).toBeNull();
  });

  it('Mouser 라벨 — K 가 주문번호(1K 없음 → supplierOrderNo 로 승계), 1V 제조사, 종료 RS EOT 제거', () => {
    const parsed = parseSupplierBarcode(MOUSER);
    expect(parsed?.supplier).toBe('mouser');
    expect(parsed?.fields).toMatchObject({
      supplierSku: null,
      mpn: 'MC34063ADR',
      quantity: 3,
      customerOrderNo: 'P0-1337',
      supplierOrderNo: 'P0-1337',
      packingListNo: '073121337',
      poLine: '011',
      countryOfOrigin: 'MX',
      manufacturer: 'TI',
    });
    expect(parsed?.normalized.endsWith(EOT)).toBe(true);
  });

  it('구형 Mouser 헤더(">[)>06")도 읽는다', () => {
    const parsed = parseSupplierBarcode(MOUSER_OLD);
    expect(parsed?.supplier).toBe('mouser');
    expect(parsed?.fields.mpn).toBe('LDK320ADU33R');
    expect(parsed?.fields.quantity).toBe(32);
    expect(parsed?.fields.supplierOrderNo).toBe('21421337');
  });

  it('스캐너 가시 치환(␞␝␄)·<RS>/<GS> 토큰·끝 CRLF 를 정규화한다', () => {
    const pictures = DIGIKEY_30P.replaceAll(RS, '␞').replaceAll(GS, '␝') + '␞␄\r\n';
    expect(parseSupplierBarcode(pictures)?.fields.supplierSku).toBe('296-LM358BIDDFRCT-ND');
    const tokens = MOUSER.replaceAll(RS, '<RS>').replaceAll(GS, '<gs>').replaceAll(EOT, '<EOT>') + '\n';
    expect(parseSupplierBarcode(tokens)?.fields.mpn).toBe('MC34063ADR');
    expect(normalizeSupplierBarcode('[)>\\x1e06\\x1dQ5\\x1d1PABC\r\n')).toBe(`[)>${RS}06${GS}Q5${GS}1PABC`);
  });

  it('ECIA 가 아닌 문자열(LCSC JSON·TME 텍스트·빈 값)은 null', () => {
    expect(parseSupplierBarcode('{pbn:PICK2009291337,on:SO2009291337,pc:C312270,qty:2}')).toBeNull();
    expect(parseSupplierBarcode('QTY:1 PN:WBP-302 PO:19361337/1 MPN:WBP-302')).toBeNull();
    expect(parseSupplierBarcode('')).toBeNull();
    expect(parseSupplierBarcode(`[)>${RS}06${GS}`)).toBeNull();
  });

  it('수량이 숫자가 아니면 null(수기 입력 요구), 식별자 모르는 필드는 identifiers 에만 남는다', () => {
    const parsed = parseSupplierBarcode(ecia('1PABC', 'Qten', '99ZX'));
    expect(parsed?.fields.quantity).toBeNull();
    expect(parsed?.supplier).toBe('unknown');
    expect(parsed?.identifiers['99Z']).toBe('X');
  });
});

describe('normalizePartKey — 품번 비교 정규화', () => {
  it('대소문자·공백·하이픈·점 무시', () => {
    expect(normalizePartKey('WR04X101 JTL')).toBe('WR04X101JTL');
    expect(normalizePartKey('296-lm358biddfrct-nd')).toBe('296LM358BIDDFRCTND');
    expect(normalizePartKey('CL05A475KP5NRNC')).toBe(normalizePartKey('cl05a475kp5nrnc'));
  });
});
