import { z } from 'zod';

// 그누보드가 발급하는 JWT 클레임 / 회원 식별 (DB 직접결합 X)
export const Me = z.object({
  mbId: z.string(),
  mbNick: z.string(),
  level: z.number().int(),
  isAdmin: z.boolean(),
});
export type MeType = z.infer<typeof Me>;

export const JwtClaims = Me.extend({
  iat: z.number().optional(),
  exp: z.number().optional(),
});
export type JwtClaimsType = z.infer<typeof JwtClaims>;
