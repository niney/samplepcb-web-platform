import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AiJobResponse,
  AiModelsResponse,
  AiRunResponse,
  AiSettingsResponse,
  BusinessInfoResponse,
  GerberPricingResponse,
  apiRoutes,
} from '@sp/api-contract';
import type {
  AiAdminPromptTestRunType,
  AiSettingsUpdateType,
  BusinessInfoUpdateType,
  GerberPricingUpdateType,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// 관리자 설정(/admin/settings) 서버 상태 훅. 사업자정보·거버 가격 탭. 결제/배송/알림 탭은
// 이 파일에 훅을 이어 붙인다. 계약은 @sp/api-contract(settings.ts), 호출은 @sp/shared.

// 설정 탭 키 — 페이지/탭 컴포넌트 공용. 탭 추가 시 이 유니온을 확장한다.
export type SettingsTabKey = 'businessInfo' | 'gerberPricing' | 'aiIntegration' | 'bomQuote';

const businessInfoPath = `${apiRoutes.adminSettings}/business-info`;
const gerberPricingPath = `${apiRoutes.adminSettings}/gerber-pricing`;
const aiSettingsPath = `${apiRoutes.adminSettings}/ai`;

// AI 연동 설정 조회 — apiKey 는 마스킹 값만 온다(원문 비노출).
export function useAiSettings() {
  return useQuery({
    queryKey: ['admin', 'settings', 'ai'],
    queryFn: () => apiGet(aiSettingsPath, AiSettingsResponse),
    staleTime: 60 * 1000,
  });
}

// AI 연동 저장(부분) — 성공 시 자신 무효화 + 응답 에코.
export function useSaveAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: AiSettingsUpdateType) =>
      apiSend('PATCH', aiSettingsPath, body, AiSettingsResponse),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'ai'] });
    },
  });
}

// 모델 목록 = 연결 테스트(수동 트리거라 mutation) — 실패는 연결 문제로 표시.
export function useAiModels() {
  return useMutation({
    mutationFn: () => apiGet(`${aiSettingsPath}/models`, AiModelsResponse),
  });
}

// 저장 전 편집 중인 모델·프롬프트를 서버의 비식별 샘플로 실제 실행한다.
export function useAiPromptTest() {
  return useMutation({
    mutationFn: (body: AiAdminPromptTestRunType) =>
      apiSend('POST', `${aiSettingsPath}/test`, body, AiRunResponse),
  });
}

// 샘플 테스트도 실제 의뢰와 같은 비동기 잡을 사용한다. 완료·오류 뒤에는 폴링을 멈춘다.
export function useAiPromptTestJob(jobId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'settings', 'ai', 'test-job', jobId.value]),
    queryFn: () => apiGet(`${apiRoutes.ai}/jobs/${jobId.value ?? ''}`, AiJobResponse),
    enabled: computed(() => jobId.value !== null),
    refetchInterval: (query) =>
      query.state.data?.data.status === 'running' ? 3000 : false,
    retry: false,
  });
}

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

// 거버 가격 해석 모드 조회 — 거의 불변이라 오래 캐시(사업자정보 관례).
export function useGerberPricing() {
  return useQuery({
    queryKey: ['admin', 'settings', 'gerber-pricing'],
    queryFn: () => apiGet(gerberPricingPath, GerberPricingResponse),
    staleTime: 5 * 60 * 1000,
  });
}

// 거버 가격 해석 모드 저장 — 성공 시 자신을 무효화.
export function useSaveGerberPricing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: GerberPricingUpdateType) =>
      apiSend('PATCH', gerberPricingPath, body, GerberPricingResponse),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings', 'gerber-pricing'] });
    },
  });
}
