// KST(+09:00) 기준 날짜 유틸 — 서버 타임존과 무관하게 한국 업무일로 날짜를 찍는다.
// admin-pcb-projects(견적서 발행일·유효기간)와 admin-members(차단일)가 공유한다.

// YYYY-MM-DD (견적서 발행일·유효기간 표기용).
export const kstDateStr = (d: Date): string =>
  new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// KST 오늘 YYYYMMDD — 그누보드 mb_intercept_date varchar(8) 차단일 기록용.
export const kstTodayYmd = (): string => kstDateStr(new Date()).replaceAll('-', '');
