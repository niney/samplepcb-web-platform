import { kstDateStr } from './kst';

/**
 * 발주서 1행의 `최근 송금`이 KST 날짜 양끝 포함 범위에 들어오는지 판정한다.
 *
 * 기간 중 송금이 하나라도 있었는지를 찾는 조건이 아니다. 목록의 송금액·잔액은 발주서별
 * 전체 원장 누적이므로, 화면에 표시하는 lastRemittedOn과 필터 의미를 일치시켜야 한다.
 */
export const matchesPcbLastRemittedRange = (
  lastRemittedOn: string | null,
  lastRemittedFrom: string | undefined,
  lastRemittedTo: string | undefined,
): boolean => {
  if (lastRemittedFrom === undefined || lastRemittedTo === undefined) return true;
  if (lastRemittedOn === null) return false;
  const lastRemittedDate = kstDateStr(new Date(lastRemittedOn));
  return lastRemittedDate >= lastRemittedFrom && lastRemittedDate <= lastRemittedTo;
};
