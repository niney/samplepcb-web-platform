import type { IncomingHttpHeaders } from 'node:http';
import { ACT_AS_PARTNER_HEADER } from '@sp/api-contract';

// ── 관리자 대리 접속 — docs/PARTNER_PORTAL.md "관리자 대리 접속" ──────────────
// 관리자가 협력사 포털 API 를 **그 조직으로** 부른다(계정 없는 조직의 포털도 열 수 있다).
// 그누보드 세션을 바꿔 그 회원으로 로그인하는 방식은 쓰지 않는다 — 무계정 조직에는 불가능하고
// 세션 쿠키 충돌을 다시 부른다. 인가는 관리자 토큰 + 이 헤더 하나이고, 판정은 requirePartner·
// `/partner/access` 두 곳이 같은 함수를 쓴다.

/** 요청에 실린 대리 접속 대상 조직 id. 헤더가 없으면 null, 형식이 틀리면 'invalid'. */
export const readActAsPartnerId = (headers: IncomingHttpHeaders): bigint | 'invalid' | null => {
  const raw = headers[ACT_AS_PARTNER_HEADER];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === '') return null;
  return /^\d{1,18}$/.test(value) ? BigInt(value) : 'invalid';
};
