import {
  DEVELOP_MILESTONE_STATUS_LABELS,
  DEVELOP_QUOTE_STATUS_LABELS,
  DEVELOP_REQUEST_STATUS_LABELS,
} from '@sp/api-contract';
import type {
  DevelopAiReviewStateType,
  DevelopDocStatusType,
  DevelopMilestoneStatusType,
  DevelopQuoteStatusType,
  DevelopRequestModeType,
  DevelopRequestStatusType,
  DevelopTaskStatusType,
  MarketDevDiagramStatusType,
} from '@sp/api-contract';
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

/** 의뢰 방식 — 시스템개발=info(분야 6개 전부), 개별 견적=secondary. 워크큐 표·상세 머리·의뢰 내용이 같은 색. */
export const developRequestModeVariant = (mode: DevelopRequestModeType): BadgeVariant =>
  mode === 'system' ? 'info' : 'secondary';

// ── 견적서·결제 조건(견적 탭) — 견적: 초안=작성 중(관리자 차례 warning) · 발송=고객 회신 대기(info) · 수락=success ·
// 그 밖(대체·철회·거절·만료)=secondary. 결제 조건: 결제 완료=success · 결제 대기=warning · 취소=danger · 초안=secondary.

export const developQuoteStatusBadge = (status: DevelopQuoteStatusType): StatusBadge => ({
  label: DEVELOP_QUOTE_STATUS_LABELS[status],
  variant: status === 'accepted' ? 'success' : status === 'sent' ? 'info' : status === 'draft' ? 'warning' : 'secondary',
});

export const developMilestoneStatusBadge = (status: DevelopMilestoneStatusType): StatusBadge => ({
  label: DEVELOP_MILESTONE_STATUS_LABELS[status],
  variant: status === 'paid' ? 'success' : status === 'pending' ? 'warning' : status === 'cancelled' ? 'danger' : 'secondary',
});

// ── 프로젝트 문서·업무표(문서 탭) — 옛 develop-doc-edit.ts 의 class 문자열(developDocStatusClass·developTaskBarClass)의 짝.
// 발송=고객 회신 대기 중인 진행(info) · 승인·조건부 승인=끝남(success) · 수정·협의 요청=관리자 차례(warning) ·
// 반려=문제(danger) · 초안·대체됨=중립(secondary). 라벨은 계약 developDocStatusLabel(type, status).

export const developDocStatusVariant = (status: DevelopDocStatusType): BadgeVariant => {
  switch (status) {
    case 'sent':
      return 'info';
    case 'approved':
    case 'conditional':
      return 'success';
    case 'changes_requested':
    case 'discuss_requested':
      return 'warning';
    case 'rejected':
      return 'danger';
    default:
      return 'secondary';
  }
};

/** 간트 막대 바탕 — 완료=완료색 · 진행=주 색 · 지연=위험색 · 제외=옅게 · 그 밖(예정·고객 확인·보류)=흐린 막대(옛 화면과 같은 구분). */
export const DEVELOP_TASK_BAR_CLASS: Record<DevelopTaskStatusType, string> = {
  planned: 'bg-muted-foreground/40',
  in_progress: 'bg-primary',
  customer_review: 'bg-muted-foreground/40',
  on_hold: 'bg-muted-foreground/40',
  delayed: 'bg-destructive',
  done: 'bg-success',
  skipped: 'bg-muted',
};

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
