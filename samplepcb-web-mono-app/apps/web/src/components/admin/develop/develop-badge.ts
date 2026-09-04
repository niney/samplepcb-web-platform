import type { DevelopAiReviewStateType, DevelopRequestStatusType, MarketDevDiagramStatusType } from '@sp/api-contract';

// 개발의뢰 관리 화면 배지 톤 — 워크큐·전면 상세가 같은 색을 쓴다(관리자 팔레트 관례:
// 진행=파랑 · 끝난 것=초록 · 종결/실패=빨강 · 대기=회색). 라벨은 계약 사전이 정본이라 여기 없다.

export const developStatusBadgeClass = (status: DevelopRequestStatusType): string => {
  switch (status) {
    case 'received':
      return 'bg-amber-100 text-amber-700';
    case 'reviewing':
    case 'quoted':
    case 'accepted':
    case 'in_progress':
    case 'delivered':
      return 'bg-blue-100 text-blue-700';
    case 'completed':
      return 'bg-emerald-100 text-emerald-700';
    default:
      return 'bg-red-100 text-red-700';
  }
};

export const developReviewStateClass = (state: DevelopAiReviewStateType): string => {
  switch (state) {
    case 'published':
      return 'bg-emerald-100 text-emerald-700';
    case 'ready':
      return 'bg-blue-100 text-blue-700';
    case 'running':
      return 'bg-indigo-100 text-indigo-700';
    case 'error':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-500';
  }
};

export const developDiagramStateClass = (status: MarketDevDiagramStatusType | null): string => {
  switch (status) {
    case 'done':
      return 'bg-emerald-100 text-emerald-700';
    case 'queued':
    case 'running':
      return 'bg-indigo-100 text-indigo-700';
    case 'error':
      return 'bg-red-100 text-red-700';
    case 'skipped':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-gray-100 text-gray-500';
  }
};
