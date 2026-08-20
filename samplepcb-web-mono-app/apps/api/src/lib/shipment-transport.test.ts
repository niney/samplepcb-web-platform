import { describe, expect, it } from 'vitest';
import {
  BOM_SHIPMENT_FILE_TYPES,
  PCB_SHIPMENT_FILE_TYPES,
  SHIPMENT_TRANSPORTS,
  shipmentTransportDocType,
  shipmentTransportOf,
} from '@sp/api-contract';

// 운송수단 축(08-16) — BOM·PCB 두 트랙이 공유하는 순수 함수. 명세는 넷이다:
//   ① 사전은 항공·해상 둘뿐이고 ② 사전 밖 값·null 은 항공으로 **표시**되며(구 데이터)
//   ③ 운송서류는 수단이 정한다(항공 AWB / 해상 B/L) ④ 그 서류 종류는 두 트랙의 첨부
//      사전 **양쪽에** 실재해야 한다 — 한쪽에만 있으면 게이트가 없는 파일을 요구한다.
describe('shipmentTransportOf', () => {
  it('사전 값은 그대로', () => {
    expect(shipmentTransportOf('air')).toBe('air');
    expect(shipmentTransportOf('sea')).toBe('sea');
  });

  it('null·undefined·사전 밖 문자열은 항공으로 접는다(표시 폴백)', () => {
    expect(shipmentTransportOf(null)).toBe('air');
    expect(shipmentTransportOf(undefined)).toBe('air');
    expect(shipmentTransportOf('')).toBe('air');
    expect(shipmentTransportOf('AIR')).toBe('air'); // 대문자는 사전 값이 아니다
    expect(shipmentTransportOf('rail')).toBe('air');
  });
});

describe('shipmentTransportDocType', () => {
  it('항공은 AWB, 해상은 B/L', () => {
    expect(shipmentTransportDocType('air')).toBe('airwaybill');
    expect(shipmentTransportDocType('sea')).toBe('bill_of_lading');
  });

  it('미선택(구 데이터)은 AWB — 이 축 도입 전 발송은 전부 특송이었다', () => {
    expect(shipmentTransportDocType(null)).toBe('airwaybill');
    expect(shipmentTransportDocType(undefined)).toBe('airwaybill');
  });

  it('반환한 서류 종류는 두 트랙의 첨부 사전 양쪽에 실재한다', () => {
    // 한쪽 사전에만 있으면 그 트랙의 '선적' 게이트가 **업로드할 수 없는 종류**를
    // 요구하게 된다(사전 밖 fileType 은 업로드 라우트의 safeParse 가 400 으로 막는다).
    for (const t of SHIPMENT_TRANSPORTS) {
      const doc = shipmentTransportDocType(t);
      expect(BOM_SHIPMENT_FILE_TYPES, `BOM 사전에 ${doc}`).toContain(doc);
      expect(PCB_SHIPMENT_FILE_TYPES, `PCB 사전에 ${doc}`).toContain(doc);
    }
  });

  it('BOM 사전에는 PCB 전용 TEST Report·원산지증명원이 포함되지 않는다', () => {
    expect(BOM_SHIPMENT_FILE_TYPES).toEqual(['invoice', 'airwaybill', 'bill_of_lading']);
    expect(BOM_SHIPMENT_FILE_TYPES).not.toContain('test_report');
    expect(BOM_SHIPMENT_FILE_TYPES).not.toContain('origin_cert');
  });
});
