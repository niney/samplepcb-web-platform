import { computed, type Ref } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import {
  AiJobResponse,
  AiRunResponse,
  AiUsecaseStatusResponse,
  apiRoutes,
} from '@sp/api-contract';
import type {
  AiDiagramRunBodyType,
  AiDiagramSpecRunBodyType,
  AiRocRunBodyType,
  AiStructurizeRunBodyType,
  AiUsecaseKeyType,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// AI 유스케이스 훅 — 활성 여부(스텝 게이트) + 실행(잡 시작) + 잡 폴링.
// 생성이 수 분이라 실행은 jobId 만 받고, 폴링 쿼리가 5초 간격으로 완료를 기다린다.

// 활성 여부(공개) — 위저드가 diagram 스텝을 노출할지 결정. 관리자 토글은 드물어 오래 캐시.
export function useAiUsecaseStatus(useCase: AiUsecaseKeyType) {
  return useQuery({
    queryKey: ['ai', 'status', useCase],
    queryFn: () => apiGet(`${apiRoutes.ai}/${useCase}/status`, AiUsecaseStatusResponse),
    staleTime: 5 * 60 * 1000,
  });
}

// 구성도 생성 시작(설명 기반 폴백 경로) — jobId 반환(비동기).
export function useRunDiagram() {
  return useMutation({
    mutationFn: (body: AiDiagramRunBodyType) =>
      apiSend('POST', `${apiRoutes.ai}/market.request-diagram/run`, body, AiRunResponse),
  });
}

// 인터뷰 답변 → 구성 명세 JSON 구조화(P1) — 결과는 잡의 json 필드.
export function useRunStructurize() {
  return useMutation({
    mutationFn: (body: AiStructurizeRunBodyType) =>
      apiSend('POST', `${apiRoutes.ai}/market.request-structurize/run`, body, AiRunResponse),
  });
}

// 구성 명세 JSON → 구성도 HTML 렌더(P2) — 결과는 잡의 html 필드.
export function useRunDiagramSpec() {
  return useMutation({
    mutationFn: (body: AiDiagramSpecRunBodyType) =>
      apiSend('POST', `${apiRoutes.ai}/market.request-diagram-spec/run`, body, AiRunResponse),
  });
}

// 구성 명세 + 답변 → 작업검토지시서 마크다운(Phase 2) — 결과는 잡의 md 필드.
export function useRunRoc() {
  return useMutation({
    mutationFn: (body: AiRocRunBodyType) =>
      apiSend('POST', `${apiRoutes.ai}/market.request-roc/run`, body, AiRunResponse),
  });
}

// 잡 폴링 — running 인 동안만 5초 간격(완료·에러·jobId 없음이면 정지).
export function useAiJob(jobId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['ai', 'job', jobId.value]),
    queryFn: () => apiGet(`${apiRoutes.ai}/jobs/${jobId.value ?? ''}`, AiJobResponse),
    enabled: computed(() => jobId.value !== null),
    refetchInterval: (query) =>
      query.state.data?.data.status === 'running' ? 5000 : false,
    retry: false, // 404(서버 재시작으로 잡 소실)는 즉시 에러 표시 → 재생성 유도
  });
}
