import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  AdminBomReceivingDigikeyLookupResponse,
  AdminDigikeyOauthStartResponse,
  AdminDigikeyStatusResponse,
  apiRoutes,
} from '@sp/api-contract';

// DigiKey 3-legged OAuth 연결(D42) — /api/admin/digikey (requireAdmin). Barcoding API 는 "Only 3-legged"
// 라 관리자가 DigiKey 로그인으로 한 번 연결하고, 서버가 refresh 로 유지한다.

const base = apiRoutes.adminDigikey;

export function useDigikeyStatus() {
  return useQuery({
    queryKey: ['admin', 'digikey', 'status'],
    queryFn: () => apiGet(`${base}/status`, AdminDigikeyStatusResponse),
    retry: false,
  });
}

/** [연결] — 서버가 state 를 만들고 DigiKey 승인 URL 을 주면 호출측이 그 주소로 이동한다. */
export function useStartDigikeyOauth() {
  return useMutation({
    mutationFn: () => apiSend('POST', `${base}/oauth/start`, undefined, AdminDigikeyOauthStartResponse),
  });
}

export function useDisconnectDigikey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend('DELETE', `${base}/connection`, undefined, AdminDigikeyStatusResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'digikey'] });
    },
  });
}

/** DigiKey Barcoding 조회 — 1D 구형 라벨·검증용 보조(연결 필요). */
export function useDigikeyBarcodeLookup() {
  return useMutation({
    mutationFn: (barcode: string) =>
      apiSend(
        'POST',
        `${apiRoutes.adminBomReceiving}/digikey-lookup`,
        { barcode },
        AdminBomReceivingDigikeyLookupResponse,
      ),
  });
}
