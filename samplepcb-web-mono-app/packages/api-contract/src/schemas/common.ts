import { z } from 'zod';

export const ApiError = z.object({ error: z.string(), message: z.string() });
export type ApiErrorType = z.infer<typeof ApiError>;

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
