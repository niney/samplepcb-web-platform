import { computed, type Ref } from 'vue';
import { useMutation, useQuery } from '@tanstack/vue-query';
import { AiJobResponse, AiUsecaseStatusResponse, DevelopFollowupRunResponse, apiRoutes } from '@sp/api-contract';
import type { DevelopAreaFollowupRunPayloadType, DevelopFollowupRunPayloadType } from '@sp/api-contract';
import { apiGet, apiSendForm } from '@sp/shared';

// 개발의뢰 AI 훅 — 위저드 3스텝 질문 둘: 시스템개발 "AI 후속 질문"(docs/DEVELOP_FLOW.md §7.2.2) ·
// 개별 메뉴 "AI 맞춤 질문"(§7.2.4). 마켓의 검토서 훅(apps/market/src/api/useAi.ts)과 같은 모양: 활성 여부 · 실행(잡 시작) · 잡 폴링.
// 여기서 기다리는 사람은 **고객**이라 폴링 간격을 마켓(5초)보다 촘촘히 잡는다(3초).

export const DEVELOP_FOLLOWUP_USECASE = 'develop.followup';
export const DEVELOP_AREA_FOLLOWUP_USECASE = 'develop.area-followup';
type DevelopQuestionUsecase = typeof DEVELOP_FOLLOWUP_USECASE | typeof DEVELOP_AREA_FOLLOWUP_USECASE;

// 활성 여부(공개·비밀 없음) — 꺼져 있으면 위저드는 AI 를 부르지 않고 기본 질문으로 간다. 관리자 토글은 드물어 오래 캐시한다.
export function useDevelopAiStatus(useCase: DevelopQuestionUsecase) {
  return useQuery({
    queryKey: ['ai', 'status', useCase],
    queryFn: () => apiGet(`${apiRoutes.ai}/${useCase}/status`, AiUsecaseStatusResponse),
    staleTime: 5 * 60 * 1000,
  });
}

// 실행 — multipart(payload JSON 문자열 + attachment[]). 첨부는 2스텝에 올린 그대로 같은 파트 이름으로 보낸다.
// 그래서 파일을 붙이는 함수(appendFiles)를 위저드 폼과 공유한다(등록 때와 같은 파일이라는 뜻).
type RunInput =
  | { useCase: typeof DEVELOP_FOLLOWUP_USECASE; payload: DevelopFollowupRunPayloadType }
  | { useCase: typeof DEVELOP_AREA_FOLLOWUP_USECASE; payload: DevelopAreaFollowupRunPayloadType };
export function useRunDevelopAi() {
  return useMutation({
    mutationFn: ({ input, appendFiles }: { input: RunInput; appendFiles: (fd: FormData) => void }) => {
      const form = new FormData();
      form.append('payload', JSON.stringify(input.payload));
      appendFiles(form);
      return apiSendForm('POST', `${apiRoutes.ai}/${input.useCase}/run`, form, DevelopFollowupRunResponse);
    },
  });
}

// 잡 폴링 — running 인 동안만 3초 간격(완료·에러·jobId 없음이면 정지).
export function useAiJob(jobId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['ai', 'job', jobId.value]),
    queryFn: () => apiGet(`${apiRoutes.ai}/jobs/${jobId.value ?? ''}`, AiJobResponse),
    enabled: computed(() => jobId.value !== null),
    refetchInterval: (query) => (query.state.data?.data.status === 'running' ? 3000 : false),
    retry: false, // 404(타인 잡·소실)는 즉시 폴백 — 고객을 기다리게 두지 않는다
  });
}
