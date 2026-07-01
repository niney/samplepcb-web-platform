import { z } from 'zod';
import { defineStore } from 'pinia';
import { Me, type MeType } from '@sp/api-contract';

interface AuthState {
  token: string | null;
  me: MeType | null;
}

// 그누보드 /spcb/api/me 응답: { token: 서명 JWT, member: Me }
const MeEndpointResponse = z.object({
  token: z.string(),
  member: Me,
});

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: null,
    me: null,
  }),
  getters: {
    isLoggedIn: (state): boolean => state.token !== null && state.me !== null,
  },
  actions: {
    // 같은 도메인의 PHPSESSID 로 그누보드 회원을 식별해 JWT/회원정보를 받아온다.
    // 실패하면(비로그인·네트워크·검증 실패) 익명 상태를 유지한다.
    async bootstrap(): Promise<void> {
      try {
        const res = await fetch('/spcb/api/me', { credentials: 'same-origin' });
        if (!res.ok) return;

        const body: unknown = await res.json();
        const parsed = MeEndpointResponse.safeParse(body);
        if (!parsed.success) return;

        this.token = parsed.data.token;
        this.me = parsed.data.member;
      } catch {
        // 익명 유지
      }
    },
  },
});
