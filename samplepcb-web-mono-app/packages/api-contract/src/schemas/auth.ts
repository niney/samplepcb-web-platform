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
// cartId: 영카트 장바구니 버킷 키(PHP 세션 ss_cart_id = g5_shop_cart.od_id).
//   me.php 가 담아 발급하며 담기 API 의 cart INSERT 에 사용. optional 인 이유는
//   과도기 토큰 호환 — cart 가 필요한 라우트는 자체적으로 존재를 검증한다.
export const JwtClaims = Me.extend({
  cartId: z.string().optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type JwtClaimsType = z.infer<typeof JwtClaims>;
