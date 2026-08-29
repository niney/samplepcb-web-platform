import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AiJobLogResponse,
  AiJobResponse,
  AiModelsResponse,
  AiRunResponse,
  AiSettingsResponse,
  BusinessInfoResponse,
  GerberPricingResponse,
  apiRoutes,
} from '@sp/api-contract';
import type {
  AiAdminDevReviewTestRunType,
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

const AI_JOBS_KEY = ['admin', 'settings', 'ai', 'jobs'] as const;

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

// 저장 전 편집 중인 모델·추가 지침을 서버의 비식별 샘플로 실제 실행한다(설정은 안 바뀐다).
export function useAiDevReviewTest() {
  return useMutation({
    mutationFn: (body: AiAdminDevReviewTestRunType) =>
      apiSend('POST', `${aiSettingsPath}/test`, body, AiRunResponse),
  });
}

// 샘플 테스트도 실제 의뢰와 같은 비동기 잡을 쓴다(관리자 전용 라우트가 아니라 /ai/jobs/:id —
// 관리자 토큰의 mbId 가 소유자). 완료·오류 뒤에는 폴링을 멈추고, 탭을 떠나 언마운트되면
// vue-query 가 구독을 정리한다.
export function useAiJob(jobId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'settings', 'ai', 'test-job', jobId.value]),
    queryFn: () => apiGet(`${apiRoutes.ai}/jobs/${jobId.value ?? ''}`, AiJobResponse),
    enabled: computed(() => jobId.value !== null),
    refetchInterval: (query) => (query.state.data?.data.status === 'running' ? 3000 : false),
    retry: false,
  });
}

// 실행 이력(sp_ai_job) — 페이지네이션. 잡이 끝나면 화면이 이 키를 무효화한다.
export function useAiJobLog(page: Ref<number>, pageSize = 20) {
  return useQuery({
    queryKey: computed(() => [...AI_JOBS_KEY, page.value, pageSize]),
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page.value),
        pageSize: String(pageSize),
      });
      return apiGet(`${aiSettingsPath}/jobs?${params.toString()}`, AiJobLogResponse);
    },
    staleTime: 10 * 1000,
  });
}

// 이력 무효화 — 샘플 테스트 시작·완료 시점에 화면이 호출한다.
export function useInvalidateAiJobLog(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: AI_JOBS_KEY });
  };
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
