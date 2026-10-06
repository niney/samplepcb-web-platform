import { DEVELOP_REQUEST_STATUS_LABELS } from '@sp/api-contract';
import type { DevelopAiReviewStateType, DevelopRequestStatusType, MarketDevDiagramStatusType } from '@sp/api-contract';
import type { BadgeVariant, StatusBadge } from '@/next/components/common/badge-types';

// 개발 모듈 배지 색 사전 — 모듈마다 한 곳(docs/ADMIN_NEXT_UI.md §8). 옛 components/admin/develop/develop-badge.ts
// 의 class 문자열을 키트 Badge variant 로 옮겼다. 뜻은 같다: 접수(관리자 차례)=warning · 진행 단계=info ·
// 완료=success · 취소·진행 불가·실패=danger · 없음/대기=secondary. 옛 화면의 남색(AI 실행 중)은 진행이라 info 로 합쳤다.
// 상태 라벨은 계약 사전(DEVELOP_*_LABELS)이 정본이라 여기서 복제하지 않는다.

export const developStatusVariant = (status: DevelopRequestStatusType): BadgeVariant => {
  switch (status) {
    case 'received':
      return 'warning';
    case 'reviewing':
    case 'quoted':
    case 'accepted':
    case 'in_progress':
    case 'delivered':
      return 'info';
    case 'completed':
      return 'success';
    default:
      return 'danger';
  }
};

export const developStatusBadge = (status: DevelopRequestStatusType): StatusBadge => ({
  label: DEVELOP_REQUEST_STATUS_LABELS[status],
  variant: developStatusVariant(status),
});

/** AI 검토서 상태(워크큐 AI 열·검토서 패널). 라벨은 화면의 i18n 문구. */
export const developReviewStateVariant = (state: DevelopAiReviewStateType): BadgeVariant => {
  switch (state) {
    case 'published':
      return 'success';
    case 'ready':
    case 'running':
      return 'info';
    case 'error':
      return 'danger';
    default:
      return 'secondary';
  }
};

/** 구성도 상태(워크큐 AI 열·구성도 패널). 라벨은 계약 MARKET_DEV_DIAGRAM_STATUS_LABELS. */
export const developDiagramStateVariant = (status: MarketDevDiagramStatusType | null): BadgeVariant => {
  switch (status) {
    case 'done':
      return 'success';
    case 'queued':
    case 'running':
      return 'info';
    case 'error':
      return 'danger';
    case 'skipped':
      return 'warning';
    default:
      return 'secondary';
  }
};

/** 상세 탭 배지 톤(옛 화면 gray·blue·amber·red·emerald) → variant. */
export type DevelopTabTone = 'gray' | 'blue' | 'amber' | 'red' | 'emerald';
export const DEVELOP_TAB_TONE_VARIANT: Record<DevelopTabTone, BadgeVariant> = {
  gray: 'secondary',
  blue: 'info',
  amber: 'warning',
  red: 'danger',
  emerald: 'success',
};
