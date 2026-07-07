import { useQuery } from '@tanstack/vue-query';
import { MarketSettingsResponse, apiRoutes } from '@sp/api-contract';
import { apiGet } from '@sp/shared';

// 마켓 설정(수수료율 bp) — 입찰 폼의 "수수료 공제 후 실수령" 표시용(공개 GET).
export function useMarketSettings() {
  return useQuery({
    queryKey: ['market', 'settings'],
    queryFn: () => apiGet(apiRoutes.marketSettings, MarketSettingsResponse),
    staleTime: 5 * 60_000,
  });
}
