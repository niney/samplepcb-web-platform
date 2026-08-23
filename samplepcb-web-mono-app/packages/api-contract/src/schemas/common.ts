import { z } from 'zod';

export const ApiError = z.object({ error: z.string(), message: z.string() });
export type ApiErrorType = z.infer<typeof ApiError>;

// 업무 오류 응답 — **두 형태를 모두** 허용해야 한다.
//  · 봉투형 `{result:false, error:'CODE'}` — 화면이 코드로 분기하는 자리
//  · sensible 표준형 `{statusCode, error, message}` — `reply.conflict('…')` 등
// 한쪽만 선언하면 나머지가 응답 직렬화에서 막혀 409/502 가 **500 으로 뒤바뀐다**
// (docs/BOM_QUOTE.md 2026-08-16 실측 결함). 클라이언트(@sp/shared toApiErrorPayload)는
// 두 형태를 모두 정규화한다.
export const BizError = z.union([
  z.object({ result: z.literal(false), error: z.string() }),
  ApiError,
]);
export type BizErrorType = z.infer<typeof BizError>;

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const isValidDateOnly = (value: string): boolean => {
  const match = DATE_ONLY_RE.exec(value);
  if (match === null) return false;
  const year = Number(match[1] ?? '');
  const month = Number(match[2] ?? '');
  const day = Number(match[3] ?? '');
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

/** 시각 없는 YYYY-MM-DD 달력 날짜. 정규식뿐 아니라 2월 30일 같은 비실재 날짜도 거부한다. */
export const DateOnly = z
  .string()
  .regex(DATE_ONLY_RE)
  .refine(isValidDateOnly, '유효한 날짜를 입력해 주세요.');
export type DateOnlyType = z.infer<typeof DateOnly>;

// 회원 라우트의 비즈니스 에러 봉투({ result:false, error:'CODE' } — pcb-projects·market
// 관례). @sp/shared 클라이언트가 ApiError 와 함께 인식해 코드 기반 메시지 매핑을 돕는다.
export const ApiMemberError = z.object({
  result: z.literal(false),
  error: z.string(),
  message: z.string().optional(),
});
export type ApiMemberErrorType = z.infer<typeof ApiMemberError>;

export const HealthResponse = z.object({ ok: z.literal(true), service: z.string() });
export type HealthResponseType = z.infer<typeof HealthResponse>;
