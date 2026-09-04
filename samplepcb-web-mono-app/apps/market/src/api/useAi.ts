import { computed, type Ref } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import {
  AiJobResponse,
  AiRunResponse,
  AiUsecaseStatusResponse,
  apiRoutes,
} from '@sp/api-contract';
import type { DevReviewRunPayloadType } from '@sp/api-contract';
import { apiGet, apiSendForm } from '@sp/shared';

// AI 사전 검토서 훅 3종(docs/AI_DEV_REVIEW.md §3) — 활성 여부·실행(잡 시작)·잡 폴링.
// 생성이 수 분(첨부 판독 + 검토서)이라 실행은 jobId 만 받고 폴링이 완료를 기다린다.

const DEV_REVIEW_USECASE = 'market.dev-review';

// 활성 여부(공개·비밀 없음) — 위저드가 검토서 생성을 노출할지 결정. 관리자 토글은 드물어 오래 캐시한다.
export function useDevReviewStatus() {
  return useQuery({
    queryKey: ['ai', 'status', DEV_REVIEW_USECASE],
    queryFn: () =>
      apiGet(`${apiRoutes.ai}/${DEV_REVIEW_USECASE}/status`, AiUsecaseStatusResponse),
    staleTime: 5 * 60 * 1000,
  });
}

// 실행 — multipart(payload JSON 문자열 + attachment[] + attachment:<area>:<slot>[]). 첨부는 등록 때와
// 같은 파일을 같은 파트 이름으로 보낸다(서버가 파트명+원본 SHA-256 으로 신선도를 대조한다) —
// 그래서 파일을 붙이는 함수(appendFiles)를 위저드 폼과 공유한다.
export function useRunDevReview() {
  return useMutation({
    mutationFn: ({ payload, appendFiles }: { payload: DevReviewRunPayloadType; appendFiles: (fd: FormData) => void }) => {
      const form = new FormData();
      form.append('payload', JSON.stringify(payload));
      appendFiles(form);
      return apiSendForm(
        'POST',
        `${apiRoutes.ai}/${DEV_REVIEW_USECASE}/run`,
        form,
        AiRunResponse,
      );
    },
  });
}

// 잡 폴링 — running 인 동안만 5초 간격(완료·에러·jobId 없음이면 정지).
export function useAiJob(jobId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['ai', 'job', jobId.value]),
    queryFn: () => apiGet(`${apiRoutes.ai}/jobs/${jobId.value ?? ''}`, AiJobResponse),
    enabled: computed(() => jobId.value !== null),
    refetchInterval: (query) => (query.state.data?.data.status === 'running' ? 5000 : false),
    retry: false, // 404(타인 잡·소실)는 즉시 에러 표시 → 재생성 유도
  });
}
