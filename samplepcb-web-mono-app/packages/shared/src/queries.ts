import { useQuery } from '@tanstack/vue-query';
import { apiRoutes, HealthResponse, Me } from '@sp/api-contract';
import { apiGet } from './api-client';

// GET /api/health → HealthResponse
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiGet(apiRoutes.health, HealthResponse),
  });
}

// GET /api/me → Me (JWT 클레임 기반 회원정보)
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => apiGet(apiRoutes.me, Me),
  });
}
