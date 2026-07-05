import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { BusinessInfoResponse, apiRoutes } from '@sp/api-contract';
import type { BusinessInfoUpdateType } from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// 관리자 설정(/admin/settings) 서버 상태 훅. 현재 "사업자정보" 탭만 — 결제/배송/알림 탭은
// 이 파일에 훅을 이어 붙인다. 계약은 @sp/api-contract(settings.ts), 호출은 @sp/shared.

// 설정 탭 키 — 페이지/탭 컴포넌트 공용. 탭 추가 시 이 유니온을 확장한다.
export type SettingsTabKey = 'businessInfo';

const businessInfoPath = `${apiRoutes.adminSettings}/business-info`;

// 사업자정보 조회 — 거의 불변이라 오래 캐시(useAdminNotifyConfig 관례).
export function useBusinessInfo() {
  return useQuery({
    queryKey: ['admin', 'settings', 'business-info'],
    queryFn: () => apiGet(businessInfoPath, BusinessInfoResponse),
    staleTime: 5 * 60 * 1000,
  });
}

// 사업자정보 저장 — 성공 시 자신을 무효화(응답이 정제값을 에코하지만 정합성 위해).
export function useSaveBusinessInfo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BusinessInfoUpdateType) =>
      apiSend('PATCH', businessInfoPath, body, BusinessInfoResponse),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'business-info'] });
    },
  });
}
