import { DEVELOP_REQUEST_STATUS_LABELS } from '@sp/api-contract';
import type { DevelopRequestListItemType, DevelopRequestStatusType } from '@sp/api-contract';

// 화면 포맷터 — 도메인 코드의 한글 라벨은 계약(DEVELOP_*_LABELS·MARKET_*_LABELS)이 정본이고
// 여기는 값(금액·날짜·바이트) 포맷과 상태 톤만 담당한다.

export const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`;

// 서버 ISO(UTC) → KST "YYYY-MM-DD HH:MM". 파싱 불가면 원문 그대로.
export function dateTimeKst(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  const kst = new Date(parsed.getTime() + 9 * 3600_000).toISOString();
  return `${kst.slice(0, 10)} ${kst.slice(11, 16)}`;
}

// 날짜만. 저녁 접수 건은 UTC 문자열을 그대로 자르면 하루 전으로 보이므로(같은 화면의 타임라인은 KST 라
// 헤더와 하루가 어긋난다) dateTimeKst 와 같은 기준으로 자른다.
export const dateShort = (iso: string): string => dateTimeKst(iso).slice(0, 10);

// "YYYY.MM.DD" · "YYYY.MM.DD  HH:MM" — 의뢰 상세(피그마 00-3)의 접수일자·진행 사항 시각 표기(KST).
export const dateDotFull = (iso: string): string => dateShort(iso).replace(/-/g, '.');
export const dateTimeDot = (iso: string): string => {
  const s = dateTimeKst(iso);
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s) ? `${s.slice(0, 10).replace(/-/g, '.')}  ${s.slice(11)}` : s;
};

// "YY.MM.DD" — 내 의뢰 목록(피그마 00-2)의 접수일 표기. 기준은 dateShort 와 같은 KST.
export const dateDot = (iso: string): string => {
  const d = dateShort(iso);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.slice(2).replace(/-/g, '.') : d;
};

export const fileSize = (n: number): string =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024)).toLocaleString()} KB` : `${(n / 1048576).toFixed(1)} MB`;

// 상태 배지 톤 — 라벨 정본은 DEVELOP_REQUEST_STATUS_LABELS(계약), 여기는 색만.
export const statusToneClass: Record<DevelopRequestStatusType, string> = {
  received: 'bg-brand-50 text-brand-700',
  reviewing: 'bg-brand-100 text-brand-700',
  quoted: 'bg-amber-100 text-amber-800',
  accepted: 'bg-amber-100 text-amber-800',
  in_progress: 'bg-[#1b2b39] text-white', // 피그마 00-2 '개발 진행 중' 칩
  delivered: 'bg-emerald-100 text-emerald-700',
  completed: 'bg-emerald-600 text-white',
  cancelled: 'bg-line text-tx-3',
  declined: 'bg-red-100 text-red-700',
};

export const statusLabel = (s: DevelopRequestStatusType): string => DEVELOP_REQUEST_STATUS_LABELS[s];

// "지금 할 일" 칩 — 서버가 파생한 nextAction 을 고객 어휘로. 라벨을 새로 적는 유일한 자리(계약에 사전이 없다).
export const NEXT_ACTION_LABELS = {
  review_quote: '견적 확인',
  pay: '결제하기',
  inspect: '검수하기',
  answer_document: '문서 확인·회신',
  answer_review: '확인 요청 답변',
} as const satisfies Record<NonNullable<DevelopRequestListItemType['nextAction']>, string>;

export const nextActionLabel = (a: DevelopRequestListItemType['nextAction']): string =>
  a === null ? '' : NEXT_ACTION_LABELS[a];

// 검수 자동 확정 예정일 — 납품일 + reviewDays(KST 기준 날짜만). 시각은 서버 정책이라 날짜로만 안내한다.
export function addDaysKst(iso: string, days: number): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return '';
  const kst = new Date(parsed.getTime() + 9 * 3600_000 + days * 86_400_000);
  return kst.toISOString().slice(0, 10);
}
