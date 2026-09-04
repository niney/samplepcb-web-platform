import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  DevelopCheckoutResponse,
  DevelopEventResponse,
  DevelopFilesResponse,
  DevelopRequestCreateResponse,
  DevelopRequestDetailResponse,
  DevelopRequestListResponse,
  DevelopRequestStatusResponse,
  apiRoutes,
} from '@sp/api-contract';
import type { DevelopQuoteAcceptBodyType, DevelopRequestDetailResponseType, DevelopRequestUpdateBodyType } from '@sp/api-contract';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';

// 개발의뢰 고객 서버 상태 훅(docs/DEVELOP_FLOW.md §8) — 계약은 @sp/api-contract(develop.ts),
// 호출은 @sp/shared(apiGet 은 401 시 토큰 재발급 1회 내장). 공개 목록이 없으므로 모든 훅이 로그인 전제다.
// 쿼리 키는 ['develop', …] 한 뿌리 — 등록·수정·첨부·취소 뒤 목록과 상세를 함께 무효화한다.

const DEVELOP_KEY = 'develop';

export const developRequestPath = (requestId: number): string => `${apiRoutes.developRequests}/${String(requestId)}`;
export const developFilesPath = (requestId: number): string => `${developRequestPath(requestId)}/files`;

export interface MyRequestFilters {
  page: number;
  pageSize: number;
}

const myListPath = (f: MyRequestFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  return `${apiRoutes.developMyRequests}?${params.toString()}`;
};

export function useMyDevelopRequests(filters: Ref<MyRequestFilters>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: [DEVELOP_KEY, 'my-requests', filters],
    queryFn: () => apiGet(myListPath(filters.value), DevelopRequestListResponse),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useDevelopRequest(requestId: Ref<number | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: [DEVELOP_KEY, 'request', requestId],
    queryFn: () => apiGet(developRequestPath(requestId.value ?? 0), DevelopRequestDetailResponse),
    enabled: computed(() => enabled.value && requestId.value !== null),
  });
}

// 등록 — multipart(payload JSON + attachment[] + attachment:<area>:<slot>[]).
export function useCreateDevelopRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => apiSendForm('POST', apiRoutes.developRequests, form, DevelopRequestCreateResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [DEVELOP_KEY] });
    },
  });
}

// 수정 — 바뀐 필드만(PATCH). 응답이 상세 전체라 캐시를 바로 갈아 끼운다.
export function useUpdateDevelopRequest(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: DevelopRequestUpdateBodyType) =>
      apiSend('PATCH', developRequestPath(requestId.value ?? 0), body, DevelopRequestDetailResponse),
    onSuccess: (data) => {
      qc.setQueryData([DEVELOP_KEY, 'request', requestId], data);
      void qc.invalidateQueries({ queryKey: [DEVELOP_KEY, 'my-requests'] });
    },
  });
}

// 첨부 추가 — multipart. 응답은 갱신된 첨부 목록이라 상세를 다시 읽는다.
export function useAddDevelopFiles(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => apiSendForm('POST', developFilesPath(requestId.value ?? 0), form, DevelopFilesResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [DEVELOP_KEY, 'request', requestId] });
    },
  });
}

export function useDeleteDevelopFile(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: number) =>
      apiSend('DELETE', `${developFilesPath(requestId.value ?? 0)}/${String(fileId)}`, undefined, DevelopFilesResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [DEVELOP_KEY, 'request', requestId] });
    },
  });
}

// 취소(착수 전) — 사유는 선택. 상태만 돌아오므로 상세·목록을 무효화한다.
export function useCancelDevelopRequest(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) =>
      apiSend(
        'POST',
        `${developRequestPath(requestId.value ?? 0)}/cancel`,
        reason.trim() === '' ? {} : { reason: reason.trim() },
        DevelopRequestStatusResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [DEVELOP_KEY] });
    },
  });
}

// ── P2 고객 행동(견적 수락·거절 · 문의 · 마일스톤 결제 · 검수 · 중간 확인 응답) ───────────
// 수락·거절·검수는 응답이 갱신된 **상세 전체**라 캐시를 바로 갈아 끼운다. 문의·확인 응답은 이벤트
// 하나만 돌아오므로 상세를 다시 읽는다. 결제는 서버가 영카트 주문서 URL 만 주고(카트행 주입 뒤)
// 이동은 호출측이 한다 — 돌아와 상세를 재조회하면 서버 GET 의 lazy 승격이 결제 상태를 반영한다.

const setDetail = (qc: ReturnType<typeof useQueryClient>, requestId: Ref<number | null>, data: DevelopRequestDetailResponseType): void => {
  qc.setQueryData([DEVELOP_KEY, 'request', requestId], data);
  void qc.invalidateQueries({ queryKey: [DEVELOP_KEY, 'my-requests'] });
};

export function useAcceptQuote(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, name }: { quoteId: number; name: string }) =>
      apiSend(
        'POST',
        `${developRequestPath(requestId.value ?? 0)}/quotes/${String(quoteId)}/accept`,
        { agree: true, name } satisfies DevelopQuoteAcceptBodyType,
        DevelopRequestDetailResponse,
      ),
    onSuccess: (data) => {
      setDetail(qc, requestId, data);
    },
  });
}

export function useDeclineQuote(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, reason }: { quoteId: number; reason: string }) =>
      apiSend(
        'POST',
        `${developRequestPath(requestId.value ?? 0)}/quotes/${String(quoteId)}/decline`,
        reason.trim() === '' ? {} : { reason: reason.trim() },
        DevelopRequestDetailResponse,
      ),
    onSuccess: (data) => {
      setDetail(qc, requestId, data);
    },
  });
}

// 문의·A/S — multipart(payload JSON + 파일). asRequest 는 completed 일 때만 서버가 A/S 로 받는다.
export function usePostComment(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ body, asRequest, files }: { body: string; asRequest: boolean; files: File[] }) => {
      const form = new FormData();
      form.append('payload', JSON.stringify({ body, asRequest }));
      for (const f of files) form.append('attachment', f);
      return apiSendForm('POST', `${developRequestPath(requestId.value ?? 0)}/comments`, form, DevelopEventResponse);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [DEVELOP_KEY, 'request', requestId] });
    },
  });
}

// 마일스톤 결제 — 성공 시 data.redirectUrl(영카트 주문서)로 이동은 호출측이 한다.
export function useCheckoutMilestone(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (milestoneId: number) =>
      apiSend(
        'POST',
        `${developRequestPath(requestId.value ?? 0)}/milestones/${String(milestoneId)}/checkout`,
        undefined,
        DevelopCheckoutResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [DEVELOP_KEY, 'request', requestId] });
    },
  });
}

// 검수 — 산출물 이벤트에 대한 확정(completed) / 수정 요청(in_progress).
export function useDeliveryDecision(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, decision, note }: { eventId: number; decision: 'confirm' | 'changes'; note: string }) =>
      apiSend(
        'POST',
        `${developRequestPath(requestId.value ?? 0)}/deliveries/${String(eventId)}/${decision}`,
        note.trim() === '' ? {} : { note: note.trim() },
        DevelopRequestDetailResponse,
      ),
    onSuccess: (data) => {
      setDetail(qc, requestId, data);
    },
  });
}

// 중간 확인 요청 응답 — 승인 / 수정 요청. 의뢰 상태는 바뀌지 않고 이벤트만 쌓인다.
export function useReviewRequestDecision(requestId: Ref<number | null>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, decision, note }: { eventId: number; decision: 'approve' | 'changes'; note: string }) =>
      apiSend(
        'POST',
        `${developRequestPath(requestId.value ?? 0)}/review-requests/${String(eventId)}/${decision}`,
        note.trim() === '' ? {} : { note: note.trim() },
        DevelopEventResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [DEVELOP_KEY, 'request', requestId] });
    },
  });
}
