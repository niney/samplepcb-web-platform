import {
  SMARTSMT_BLOCK_LABELS,
  SMARTSMT_BLOCK_REASONS,
  SMARTSMT_FILE_CHECK_LABELS,
  SMARTSMT_LINE_STATUS_LABELS,
  SMARTSMT_QUOTE_STATUS_LABELS,
  SMARTSMT_RECEIVE_RESULT_LABELS,
  SMARTSMT_SOURCE_LABELS,
  smartsmtLabel,
} from '@sp/api-contract';
import type { BadgeVariant, StatusBadge } from '@/next/components/common/badge-types';

// SMT 모듈 배지 사전 — 색은 모듈마다 한 곳(docs/ADMIN_NEXT_UI.md §8). 라벨은 계약 패키지의 SmartSMT 사전
// (smartsmt.ts)을 그대로 쓰고, 여기서는 색만 정한다. 사전에 없는 코드는 **코드 그대로** 보인다 — SmartSMT 가
// 값을 늘려도 화면이 깨지거나 값을 숨기지 않게(smartsmtLabel).
// 뜻별 variant(common/badge-types.ts): warning=기다림·주의, info=진행, success=끝남, danger=문제,
// secondary=중립·이력, outline=부가 표지.
// <Badge :variant="b.variant">{{ b.label }}</Badge>

export type SmtBadge = StatusBadge;

const QUOTE_STATUS: Readonly<Record<string, BadgeVariant>> = {
  REVIEW_REQUIRED: 'warning',
  CALCULATED: 'success',
};

/** 견적 상태(quote.quote_status). 모르는 값은 코드 그대로 중립색. */
export const smtQuoteStatusBadge = (status: string | null): SmtBadge => ({
  label: smartsmtLabel(SMARTSMT_QUOTE_STATUS_LABELS, status, '상태 없음'),
  variant: status === null ? 'secondary' : (QUOTE_STATUS[status] ?? 'secondary'),
});

/** 합계를 막은 블록(blocked_by) — 비어 있으면 null(배지 없음). 최종 금액이 미정이라는 문제 신호다. */
export const smtBlockedBadge = (blockedBy: readonly string[]): SmtBadge | null =>
  blockedBy.length === 0 ? null : { label: `합계 막힘: ${smtBlockNames(blockedBy)}`, variant: 'danger' };

/** 블록 이름들(PCB · PARTS · SHIPPING · DETAIL)을 한국어로 이어 붙인다. 모르는 이름은 코드 그대로. */
export const smtBlockNames = (blocks: readonly string[]): string =>
  blocks.map((block) => smartsmtLabel(SMARTSMT_BLOCK_LABELS, block)).join(', ');

/** 출처 — push(전송)·pull(가져오기). 부가 표지라 outline. */
export const smtSourceBadge = (source: string): SmtBadge => ({
  label: smartsmtLabel(SMARTSMT_SOURCE_LABELS, source),
  variant: 'outline',
});

const FILE_CHECK: Readonly<Record<string, BadgeVariant>> = {
  match: 'success',
  unlisted: 'warning',
  missing: 'secondary',
};

/** 동봉 파일 대조 결과 — match 일치 · unlisted 목록에 없음 · missing 파일 없음. */
export const smtFileCheckBadge = (check: string): SmtBadge => ({
  label: smartsmtLabel(SMARTSMT_FILE_CHECK_LABELS, check),
  variant: FILE_CHECK[check] ?? 'outline',
});

const RECEIVE_RESULT: Readonly<Record<string, BadgeVariant>> = {
  accepted: 'success',
  duplicate: 'secondary',
  rejected: 'warning',
  failed: 'danger',
};

/** 수신 기록의 결과 — accepted 받음 · duplicate 이미 받은 견적 · rejected 거절(4xx) · failed 실패(5xx). */
export const smtReceiveResultBadge = (result: string): SmtBadge => ({
  label: smartsmtLabel(SMARTSMT_RECEIVE_RESULT_LABELS, result),
  variant: RECEIVE_RESULT[result] ?? 'outline',
});

/** 견적 줄 상태(lines[].status) — 빈 글자는 확정, 그 밖은 사람이 볼 줄이라 주의색. */
export const smtLineStatusBadge = (status: string): SmtBadge =>
  status === ''
    ? { label: '확정', variant: 'secondary' }
    : { label: smartsmtLabel(SMARTSMT_LINE_STATUS_LABELS, status), variant: 'warning' };

/**
 * 통합 합계 블록의 사유(reason) → "합계에 드는가". 사유가 없으면 정상이라 합계에 든다.
 * no 안 든다(합계를 막는다) · amount_only 금액은 있지만 안 든다 · na 해당 없음(이 주문에서 사지 않음).
 * 사전에 없는 사유는 드는지 알 수 없다 — 코드 그대로 두고 '알 수 없음'.
 */
export const smtBlockReasonLabel = (reason: string | null): string =>
  reason === null || reason === '' ? '—' : (SMARTSMT_BLOCK_REASONS[reason]?.label ?? reason);

export const smtBlockCountedBadge = (reason: string | null): SmtBadge => {
  if (reason === null || reason === '') return { label: '든다', variant: 'success' };
  const counted = SMARTSMT_BLOCK_REASONS[reason]?.counted;
  if (counted === 'no') return { label: '안 든다', variant: 'danger' };
  if (counted === 'amount_only') return { label: '금액은 있지만 안 든다', variant: 'warning' };
  if (counted === 'na') return { label: '해당 없음', variant: 'secondary' };
  return { label: '알 수 없음', variant: 'outline' };
};

/** 견적서의 owner_mb_id 가 우리 회원인가 — null 은 모름(아이디가 오지 않았거나 대조 실패), 표지를 달지 않는다. */
export const smtMemberBadge = (isMember: boolean | null): SmtBadge | null =>
  isMember === false ? { label: '회원 아님', variant: 'warning' } : null;
