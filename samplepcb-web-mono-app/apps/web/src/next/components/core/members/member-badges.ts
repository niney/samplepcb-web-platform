import type { AdminMemberListItemType } from '@sp/api-contract';
import type { BadgeVariant } from '@/next/components/common/badge-types';

// 회원 관리 배지 사전 — 옛 UiBadge 색(정상=초록·차단=호박·탈퇴=회색, 기업·파트너=파랑)을 Badge variant 로.
// 차단은 관리자가 들여다볼 상태라 '기다림·주의'(warning), 탈퇴는 끝난 이력이라 중립(secondary).

export const memberStatusVariant = (status: AdminMemberListItemType['status']): BadgeVariant =>
  status === 'normal' ? 'success' : status === 'intercepted' ? 'warning' : 'secondary';

/** 회원구분(mb_1) — 기업·파트너만 배지(i18n 키), 개인·빈 값은 null(배지 없음). */
export const memberTypeLabelKey = (memberType: string | null): string | null =>
  memberType === '기업'
    ? 'admin.members.badge.corp'
    : memberType === '파트너'
      ? 'admin.members.badge.partner'
      : null;
