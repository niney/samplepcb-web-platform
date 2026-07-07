import type { MarketContractStatusType, MarketProjectListItemType } from '@sp/api-contract';

// 화면 포맷터 — 도메인 코드의 한글 라벨은 @sp/api-contract 의 MARKET_*_LABELS 가 정본이고,
// 여기는 값(금액·날짜·D-day) 포맷만 담당한다.

export const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`;

export const dateShort = (iso: string): string => iso.slice(0, 10);

// KST 기준 달력일 차이(서버 UTC ISO ↔ 한국 업무일 경계 정합).
const kstYmd = (d: Date): string => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

// 지정 ISO 시각까지 남은 KST 달력일 수(자동확정 D-day 등). 지난 값은 0 이하.
export const daysUntil = (iso: string, now = new Date()): number =>
  Math.round((Date.parse(kstYmd(new Date(iso))) - Date.parse(kstYmd(now))) / 86_400_000);

// 계약 상태 배지 톤 — 목록·계약 카드 공유(라벨 정본은 MARKET_CONTRACT_STATUS_LABELS).
export const contractStatusClass: Record<MarketContractStatusType, string> = {
  pending: 'bg-amber-100 text-amber-700',
  paid: 'bg-blue-50 text-blue-700',
  delivered: 'bg-copper-50 text-copper-600',
  completed: 'bg-emerald-100 text-emerald-700',
  settled: 'bg-ink-900 text-white',
  cancelled: 'bg-gray-200 text-gray-500',
};

export interface DdayBadge {
  label: string;
  tone: 'normal' | 'urgent' | 'closed' | 'awarded' | 'cancelled';
}

// 프로토타입 ddayBadge 이식 — 상태 우선, 입찰 중이면 D-day(KST 달력일 기준).
export const ddayBadge = (p: MarketProjectListItemType, now = new Date()): DdayBadge => {
  if (p.status === 'awarded' || p.status === 'working') {
    return { label: '작업자 선정', tone: 'awarded' };
  }
  if (p.status === 'completed') return { label: '완료', tone: 'awarded' };
  if (p.status === 'cancelled') return { label: '취소', tone: 'cancelled' };
  if (p.biddingClosed) return { label: '견적마감', tone: 'closed' };
  const days = Math.round(
    (Date.parse(kstYmd(new Date(p.bidDeadlineAt))) - Date.parse(kstYmd(now))) / 86_400_000,
  );
  if (days <= 0) return { label: '오늘 마감', tone: 'urgent' };
  if (days === 1) return { label: 'D-1', tone: 'urgent' };
  return { label: `D-${String(days)}`, tone: 'normal' };
};

export const ddayToneClass: Record<DdayBadge['tone'], string> = {
  normal: 'bg-ink-900 text-white',
  urgent: 'bg-red-600 text-white',
  closed: 'bg-gray-200 text-gray-600',
  awarded: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-gray-200 text-gray-500',
};

// 이니셜 아바타 배경 — 이름 해시로 hue 결정(프로토타입 avatar() 축약 이식).
export const avatarHue = (name: string): number => {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};
