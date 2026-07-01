import { z } from 'zod';

// 그누보드가 발급하는 JWT 클레임 / 회원 식별 (DB 직접결합 X)
export const Me = z.object({
  mbId: z.string(),
  mbNick: z.string(),
  level: z.number().int(),
  isAdmin: z.boolean(),
});
export type MeType = z.infer<typeof Me>;

// iat/exp 필수 — exp 없는 토큰(만료되지 않는 토큰)은 검증 단계에서 거부한다.
export const JwtClaims = Me.extend({
  iat: z.number().int(),
  exp: z.number().int(),
});
export type JwtClaimsType = z.infer<typeof JwtClaims>;
