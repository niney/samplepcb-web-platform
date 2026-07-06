// 주문/카트 상태 정규화 — 레거시 22종(lib/common.lib.php get_order_status_list) 중
// 신규 세트 밖 상태를 매핑한다. 신규 세트의 SSOT 는 lib/g5-db.ts(PRODUCTION_STATUSES 는 export,
// ACTIVE_ORDER_STATUSES(:1049)·CANCEL_STATUSES(:2018) 는 비공개라 여기 미러 — 값 변경 시 동기 필수).
import { PRODUCTION_STATUSES } from '../../../lib/g5-db';

export const ACTIVE_ORDER_STATUSES: readonly string[] = [
  '주문',
  '입금',
  '준비',
  ...PRODUCTION_STATUSES,
  '배송',
  '완료',
]; // g5-db.ts:1049 미러
export const CANCEL_STATUSES: readonly string[] = ['취소', '반품', '품절']; // g5-db.ts:2018 미러

/** 신규 세트로의 명시 매핑(레거시 전용 상태). 여기 없고 신규 세트에도 없으면 "미지 상태" → 게이트 중단. */
const LEGACY_STATUS_MAP: Record<string, string> = {
  전체취소: '취소',
};

const KNOWN = new Set<string>([...ACTIVE_ORDER_STATUSES, ...CANCEL_STATUSES]);

export interface NormalizedStatus {
  status: string;
  mapped: boolean; // 매핑표를 거쳤는지(리포트용)
}

/**
 * od_status/ct_status 공용 정규화.
 * - 신규 세트 그대로 → 통과
 * - 매핑표 → 치환
 * - '부분취소'(od 전용) → null 반환하지 않고 caller 가 resolvePartialCancelOdStatus 로 처리
 * - 그 외 미지 → null (게이트/phase 에서 중단·리포트)
 */
export function normalizeStatus(raw: string): NormalizedStatus | null {
  const s = raw.trim();
  if (KNOWN.has(s)) return { status: s, mapped: false };
  const mapped = LEGACY_STATUS_MAP[s];
  if (mapped !== undefined) return { status: mapped, mapped: true };
  return null;
}

export function isCancelStatus(status: string): boolean {
  return CANCEL_STATUSES.includes(status);
}

/**
 * od_status='부분취소' 해소(계획 §상태 정규화): 활성 라인 중 가장 진행된 상태로 승격,
 * 활성 라인이 없으면 '취소'. (신규 모델은 부분취소를 od 상태가 아니라
 * "활성 od_status + 취소 ct 라인 존재"로 표현한다 — g5-db.ts 부분취소 탭 판정과 정합)
 */
export function resolvePartialCancelOdStatus(lineStatuses: readonly string[]): string {
  let bestIdx = -1;
  for (const s of lineStatuses) {
    const idx = ACTIVE_ORDER_STATUSES.indexOf(s);
    if (idx > bestIdx) bestIdx = idx;
  }
  const best = bestIdx >= 0 ? ACTIVE_ORDER_STATUSES[bestIdx] : undefined;
  return best ?? '취소';
}
