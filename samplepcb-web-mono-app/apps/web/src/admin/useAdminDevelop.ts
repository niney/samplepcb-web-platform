import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminDevelopAiRunResponse,
  AdminDevelopQuoteResponse,
  AdminDevelopRequestDetailResponse,
  AdminDevelopRequestListResponse,
  AdminDevelopSettingsResponse,
  DevelopEventResponse,
  DevelopOkResponse,
  DevelopRequestStatusResponse,
  apiRoutes,
} from '@sp/api-contract';
import type {
  AdminDevelopEventPayloadType,
  AdminDevelopMilestoneMarkPaidBodyType,
  AdminDevelopQuoteBodyType,
  AdminDevelopRequestPatchBodyType,
  AdminDevelopSettingsUpdateType,
  AdminDevelopStatusBodyType,
  DevelopAdminTabType,
  MarketDevReviewType,
} from '@sp/api-contract';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';

// 개발의뢰 관리(/admin/develop/*) 서버 상태 훅 — 워크큐·전면 상세·AI 산출물·타임라인·설정.
// 계약은 @sp/api-contract(develop.ts), 호출은 @sp/shared(마켓 관리 훅 관례 그대로).
// 무효화 루트 키는 ['admin','develop'] 하나 — 상세 액션이 목록 배지·counts 까지 같이 되살린다.

const base = apiRoutes.adminDevelopRequests;
const quoteBase = apiRoutes.adminDevelopQuotes;
const milestoneBase = apiRoutes.adminDevelopMilestones;
const DEVELOP_KEY = ['admin', 'develop'] as const;

const invalidateDevelop = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: DEVELOP_KEY });
};

// ── 워크큐 ───────────────────────────────────────────────────────────────────

export interface AdminDevelopFilters {
  page: number;
  pageSize: number;
  tab: DevelopAdminTabType;
  q: string;
}

export const emptyDevelopFilters = (): AdminDevelopFilters => ({
  page: 1,
  pageSize: 20,
  tab: 'all',
  q: '',
});

const listPath = (f: AdminDevelopFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${base}?${params.toString()}`;
};

export function useAdminDevelopList(filters: Ref<AdminDevelopFilters>) {
  return useQuery({
    queryKey: ['admin', 'develop', 'requests', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminDevelopRequestListResponse),
    placeholderData: keepPreviousData,
  });
}

// 사이드바 배지 — 접수 탭 counts 하나(목록 본문은 pageSize=1 로 버린다).
export function useDevelopReceivedCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'develop', 'received-count'],
    queryFn: () => apiGet(`${base}?page=1&pageSize=1&tab=received`, AdminDevelopRequestListResponse),
    enabled,
    select: (response) => response.data.counts.received,
    refetchInterval: 60_000,
  });
}

// ── 전면 상세 ────────────────────────────────────────────────────────────────
// 검토서 초안 잡(수십 초~수 분)과 구성도 잡(5~10분)이 도는 동안만 5초 폴링한다.

export function useAdminDevelopDetail(requestId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'develop', 'requests', 'detail', requestId],
    queryFn: () =>
      apiGet(`${base}/${String(requestId.value)}`, AdminDevelopRequestDetailResponse),
    enabled: computed(() => requestId.value !== null),
    refetchInterval: (query) => {
      const detail = query.state.data?.data;
      if (detail === undefined) return false;
      const diagram = detail.diagram.meta?.status;
      const running = detail.review.draftRunning || diagram === 'queued' || diagram === 'running';
      return running ? 5000 : false;
    },
  });
}

export function usePatchAdminDevelop() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: number; body: AdminDevelopRequestPatchBodyType }) =>
      apiSend('PATCH', `${base}/${String(requestId)}`, body, AdminDevelopRequestDetailResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// 관리자 전이 — reviewing·in_progress·completed·cancelled·declined(사유 필수는 서버 409 REASON_REQUIRED).
export function useAdminDevelopStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: number; body: AdminDevelopStatusBodyType }) =>
      apiSend('POST', `${base}/${String(requestId)}/status`, body, DevelopRequestStatusResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// ── AI 산출물 ────────────────────────────────────────────────────────────────

export type DevelopAiKind = 'review' | 'diagram';

export function useAdminDevelopAiRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, kind }: { requestId: number; kind: DevelopAiKind }) =>
      apiSend('POST', `${base}/${String(requestId)}/ai/${kind}`, undefined, AdminDevelopAiRunResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// 작업본 저장 — 구조 편집기가 검토서 전체 JSON 을 보낸다(서버가 meta.editedAt/By 를 찍는다).
export function useAdminDevelopReviewPut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, review }: { requestId: number; review: MarketDevReviewType }) =>
      apiSend('PUT', `${base}/${String(requestId)}/review`, { review }, AdminDevelopRequestDetailResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

export type DevelopReviewAction = 'publish' | 'unpublish' | 'reset';

export function useAdminDevelopReviewAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, action }: { requestId: number; action: DevelopReviewAction }) =>
      apiSend('POST', `${base}/${String(requestId)}/review/${action}`, undefined, AdminDevelopRequestDetailResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

export type DevelopDiagramAction = 'publish' | 'unpublish';

export function useAdminDevelopDiagramAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, action }: { requestId: number; action: DevelopDiagramAction }) =>
      apiSend('POST', `${base}/${String(requestId)}/diagram/${action}`, undefined, AdminDevelopRequestDetailResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// 구성도 교체 업로드 — multipart(파일 파트 이름은 서버가 안 본다. 첫 파일 하나만 쓴다).
export function useAdminDevelopDiagramUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, file }: { requestId: number; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      return apiSendForm('POST', `${base}/${String(requestId)}/diagram/upload`, form, AdminDevelopRequestDetailResponse);
    },
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// ── 타임라인 이벤트 ───────────────────────────────────────────────────────────
// multipart: `payload` JSON 파트 + 파일 파트(임의 이름). 응답은 만들어진 이벤트 하나.

export function useAdminDevelopEventCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      requestId,
      payload,
      files,
    }: {
      requestId: number;
      payload: AdminDevelopEventPayloadType;
      files: readonly File[];
    }) => {
      const form = new FormData();
      form.append('payload', JSON.stringify(payload));
      for (const file of files) form.append('files', file);
      return apiSendForm('POST', `${base}/${String(requestId)}/events`, form, DevelopEventResponse);
    },
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// ── 견적서 ───────────────────────────────────────────────────────────────────
// 견적 목록은 상세 응답(quotes — draft 포함)에 실려 온다. 여기 훅은 쓰기 전용이고,
// 성공하면 상세를 무효화해 목록·배지까지 같이 되살린다.
// draft 에서만 고칠 수 있고(PATCH 는 전체 교체), 발송이 금액·마일스톤 금액을 확정한다.

export function useAdminDevelopQuoteCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: number; body: AdminDevelopQuoteBodyType }) =>
      apiSend('POST', `${base}/${String(requestId)}/quotes`, body, AdminDevelopQuoteResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

export function useAdminDevelopQuotePatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: number; body: AdminDevelopQuoteBodyType }) =>
      apiSend('PATCH', `${quoteBase}/${String(quoteId)}`, body, AdminDevelopQuoteResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

export function useAdminDevelopQuoteDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: number) => apiSend('DELETE', `${quoteBase}/${String(quoteId)}`, undefined, DevelopOkResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

export function useAdminDevelopQuoteSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: number) =>
      apiSend('POST', `${quoteBase}/${String(quoteId)}/send`, undefined, AdminDevelopQuoteResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

export function useAdminDevelopQuoteWithdraw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: number) =>
      apiSend('POST', `${quoteBase}/${String(quoteId)}/withdraw`, undefined, AdminDevelopQuoteResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// 오프라인 입금(계좌 이체 등) 수동 확인 — pending 마일스톤만. 메모는 내부 노트로 남는다.
export function useAdminDevelopMilestoneMarkPaid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ milestoneId, body }: { milestoneId: number; body: AdminDevelopMilestoneMarkPaidBodyType }) =>
      apiSend('POST', `${milestoneBase}/${String(milestoneId)}/mark-paid`, body, DevelopOkResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// ── 설정 싱글턴 ──────────────────────────────────────────────────────────────

export function useAdminDevelopSettings() {
  return useQuery({
    queryKey: ['admin', 'develop', 'settings'],
    queryFn: () => apiGet(apiRoutes.adminDevelopSettings, AdminDevelopSettingsResponse),
  });
}

export function useSaveAdminDevelopSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminDevelopSettingsUpdateType) =>
      apiSend('PATCH', apiRoutes.adminDevelopSettings, body, AdminDevelopSettingsResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}
