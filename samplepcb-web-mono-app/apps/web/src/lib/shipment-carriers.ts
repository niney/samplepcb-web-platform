// 국제 발송 운송회사 프리셋 — BOM·PCB 공용 표기 정본.
// 해상은 선사보다 포워더를 적는 경우가 많아 화면에서 직접입력만 제공하고,
// 이 사전은 항공 특송 셀렉트의 정식 표기에만 쓴다.
export const INTL_CARRIERS = ['DHL', 'FedEx', 'UPS', 'SF Express'] as const;

/** 박제된 항공 운송회사를 셀렉트로 복원할지 직접입력으로 열지 판정한다. */
export const isIntlCarrier = (value: string): boolean =>
  (INTL_CARRIERS as readonly string[]).includes(value);
