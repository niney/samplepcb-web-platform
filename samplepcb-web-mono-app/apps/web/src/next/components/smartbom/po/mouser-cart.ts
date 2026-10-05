import { bomPoExternalCheckStale, type AdminBomPoViewType } from '@sp/api-contract';

// SmartBOM 발주서 패널의 Mouser 카트 인계(D41) 판정 — 상태 배지 색은 smartbom/smartbom-badges.ts 가 정한다.

// ── Mouser 카트 인계(D41) 상태 — 확인 시각·실패·빈 카트·내용 불일치.
export type MouserCartHealth = 'unknown' | 'ok' | 'empty' | 'mismatch' | 'error';

export function mouserCartHealth(po: AdminBomPoViewType): MouserCartHealth {
  const ref = po.externalRef;
  if (ref?.checkedAt === undefined) return 'unknown';
  if (ref.checkError !== undefined) return 'error';
  if ((ref.liveLineCount ?? 0) === 0) return 'empty';
  if (ref.liveMatches === false) return 'mismatch';
  return 'ok';
}

/** 카트 상자 색 — 일치(최근 확인)=완료, 미확인·오래된 확인=중립, 그 밖(빈 카트·불일치·실패)=주의. */
export function mouserCartTone(po: AdminBomPoViewType): 'muted' | 'success' | 'warning' {
  const health = mouserCartHealth(po);
  if (health === 'ok') return bomPoExternalCheckStale(po.externalRef?.checkedAt) ? 'muted' : 'success';
  if (health === 'unknown') return 'muted';
  return 'warning';
}

/** 한눈 줄용 짧은 상태 라벨 — 상세(확인 시각·불일치 목록·실패 사유)는 [자세히] 안에서. e2e 가 이 문구를 본다. */
export function mouserCartHealthLabel(po: AdminBomPoViewType): string {
  const ref = po.externalRef;
  switch (mouserCartHealth(po)) {
    case 'unknown':
      return '상태 미확인';
    case 'error':
      return '⚠ 확인 실패';
    case 'empty':
      return '⚠ 카트 비어 있음';
    case 'mismatch':
      return `⚠ 내용 다름(${String(ref?.liveLineCount ?? 0)}행)`;
    default:
      return `✓ 일치${bomPoExternalCheckStale(ref?.checkedAt) ? '(오래됨)' : ''}`;
  }
}
