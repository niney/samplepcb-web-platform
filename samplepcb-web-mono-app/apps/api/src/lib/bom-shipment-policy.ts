import type { BomShipmentModeType } from '@sp/api-contract';

// 협력사 국가가 실제 발송 출발국의 단일 진실이다. 국가가 없을 때 국제로 추측하지
// 않는다. 이미 생성된 선적의 mode는 당시 국가를 박제한 값이므로 별도 감사 대상으로 둔다.

export const normalizePartnerCountry = (country: string | null | undefined): string | null => {
  const normalized = country?.trim().toUpperCase() ?? '';
  return normalized === '' ? null : normalized;
};

export const shipmentModeFromCountry = (
  country: string | null | undefined,
): BomShipmentModeType | null => {
  const normalized = normalizePartnerCountry(country);
  if (normalized === null) return null;
  return normalized === 'KR' ? 'domestic' : 'international';
};

export const shipmentModeDiffersFromCountry = (
  mode: BomShipmentModeType,
  country: string | null | undefined,
): boolean => {
  const expected = shipmentModeFromCountry(country);
  return expected !== null && expected !== mode;
};
