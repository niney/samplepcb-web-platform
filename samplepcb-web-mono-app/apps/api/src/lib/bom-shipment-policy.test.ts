import { describe, expect, it } from 'vitest';
import {
  normalizePartnerCountry,
  shipmentModeDiffersFromCountry,
  shipmentModeFromCountry,
} from './bom-shipment-policy';

describe('BOM 선적 국가 정책', () => {
  it('KR은 국내, 그 밖의 등록 국가는 국제 발송으로 결정한다', () => {
    expect(shipmentModeFromCountry(' kr ')).toBe('domestic');
    expect(shipmentModeFromCountry('US')).toBe('international');
    expect(shipmentModeFromCountry('cn')).toBe('international');
  });

  it('국가가 없으면 국제로 추측하지 않는다', () => {
    expect(normalizePartnerCountry('  ')).toBeNull();
    expect(shipmentModeFromCountry(null)).toBeNull();
    expect(shipmentModeFromCountry(undefined)).toBeNull();
  });

  it('등록 국가가 있을 때만 기존 선적 모드 불일치를 판정한다', () => {
    expect(shipmentModeDiffersFromCountry('international', 'KR')).toBe(true);
    expect(shipmentModeDiffersFromCountry('domestic', 'KR')).toBe(false);
    expect(shipmentModeDiffersFromCountry('international', null)).toBe(false);
  });
});
