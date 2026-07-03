// 관리자 화면 공용 표시 포맷터. 시간대는 업무 기준(KST) 고정.

const KST_DATE = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const KST_DATETIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

// 'sv-SE' 로케일은 YYYY-MM-DD (HH:mm) 형태를 준다 — 관리 테이블 표기에 적합.
export const formatDate = (iso: string): string => KST_DATE.format(new Date(iso));
export const formatDateTime = (iso: string): string => KST_DATETIME.format(new Date(iso));

const KRW = new Intl.NumberFormat('ko-KR');
export const formatKrw = (price: number): string => `${KRW.format(price)}원`;

export const formatBytes = (size: number): string => {
  if (size < 1024) return `${String(size)}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
};
