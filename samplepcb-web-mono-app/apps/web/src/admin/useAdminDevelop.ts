import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminDevelopAiRunResponse,
  AdminDevelopDocMailRunResponse,
  AdminDevelopDocumentResponse,
  AdminDevelopQuoteResponse,
  AdminDevelopRequestDetailResponse,
  AdminDevelopRequestListResponse,
  AdminDevelopReviewVersionListResponse,
  AdminDevelopReviewVersionResponse,
  AdminDevelopSettingsResponse,
  AdminDevelopTasksResponse,
  DevelopEventResponse,
  DevelopOkResponse,
  DevelopRequestStatusResponse,
  apiRoutes,
} from '@sp/api-contract';
import type {
  AdminDevelopDocumentCreateBodyType,
  AdminDevelopDocumentPatchBodyType,
  AdminDevelopDocumentSendBodyType,
  AdminDevelopEventPayloadType,
  AdminDevelopMilestoneMarkPaidBodyType,
  AdminDevelopQuoteBodyType,
  AdminDevelopRequestPatchBodyType,
  AdminDevelopSettingsUpdateType,
  AdminDevelopStatusBodyType,
  DevelopAdminSignalType,
  DevelopAdminTabType,
  DevelopTaskInputType,
  MarketDevReviewType,
} from '@sp/api-contract';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';

// 개발의뢰 관리(/admin/develop/*) 서버 상태 훅 — 워크큐·전면 상세·AI 산출물·타임라인·설정.
// 계약은 @sp/api-contract(develop.ts), 호출은 @sp/shared(마켓 관리 훅 관례 그대로).
// 무효화 루트 키는 ['admin','develop'] 하나 — 상세 액션이 목록 배지·counts 까지 같이 되살린다.

const base = apiRoutes.adminDevelopRequests;
const quoteBase = apiRoutes.adminDevelopQuotes;
const milestoneBase = apiRoutes.adminDevelopMilestones;
const docBase = apiRoutes.adminDevelopDocuments;
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
  /** 신호 필터(§14) — 탭 안에서 "지금 관리자 차례"인 행만. null 이면 안 보낸다. */
  signal: DevelopAdminSignalType | null;
}

export const emptyDevelopFilters = (): AdminDevelopFilters => ({
  page: 1,
  pageSize: 20,
  tab: 'all',
  q: '',
  signal: null,
});

const listPath = (f: AdminDevelopFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  if (f.signal !== null) params.set('signal', f.signal);
  return `${base}?${params.toString()}`;
};

export function useAdminDevelopList(filters: Ref<AdminDevelopFilters>) {
  return useQuery({
    queryKey: ['admin', 'develop', 'requests', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminDevelopRequestListResponse),
    placeholderData: keepPreviousData,
  });
}

// 개발 모듈 메뉴 배지(§14) — 단계별 워크큐 6개가 각각 "지금 관리자 차례" 수 하나를 단다.
// 목록 호출 하나(pageSize=1, 본문은 버린다)에 counts(탭별)와 signals(활성 의뢰 전체)가 같이
// 실려 오므로 배지마다 요청을 따로 내지 않는다. 60초 refetch 는 다른 모듈 배지 관례와 동일.
export function useDevelopModuleSignals(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'develop', 'module-signals'],
    queryFn: () => apiGet(`${base}?page=1&pageSize=1&tab=all`, AdminDevelopRequestListResponse),
    enabled,
    select: (response) => ({ counts: response.data.counts, signals: response.data.signals }),
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

// ── 검토서 버전 원장(§6.2) — 목록은 버전 탭이 열릴 때만, 단건은 고른 판만 ─────────────
const versionsKey = (requestId: Ref<number | null>) => ['admin', 'develop', 'requests', 'detail', requestId, 'review-versions'] as const;

export function useAdminDevelopReviewVersions(requestId: Ref<number | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: versionsKey(requestId),
    queryFn: () => apiGet(`${base}/${String(requestId.value)}/review/versions`, AdminDevelopReviewVersionListResponse),
    enabled: computed(() => requestId.value !== null && enabled.value),
  });
}

export function useAdminDevelopReviewVersion(requestId: Ref<number | null>, seq: Ref<number | null>) {
  return useQuery({
    queryKey: computed(() => [...versionsKey(requestId), seq.value] as const),
    queryFn: () => apiGet(`${base}/${String(requestId.value)}/review/versions/${String(seq.value)}`, AdminDevelopReviewVersionResponse),
    enabled: computed(() => requestId.value !== null && seq.value !== null),
    staleTime: Infinity, // 버전 본문은 불변
  });
}

export function useAdminDevelopReviewRestore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, seq }: { requestId: number; seq: number }) =>
      apiSend('POST', `${base}/${String(requestId)}/review/versions/${String(seq)}/restore`, undefined, AdminDevelopRequestDetailResponse),
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

// ── 프로젝트 문서·업무표(docs/DEVELOP_FLOW.md §13) ─────────────────────────────
// 문서 목록·업무표는 관리자 상세 응답(documents·progress — draft·이전 판 포함)에 실려 온다.
// 여기 훅은 전부 쓰기 전용이고, 성공하면 ['admin','develop'] 를 무효화해 상세·현황을 같이 되살린다.
// 문서는 draft 에서만 고칠 수 있고(본문·첨부·메모), 발송이 판을 고정한다. 재발송은 revise(새 판) → 발송.

export function useAdminDevelopDocumentCreate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, body }: { requestId: number; body: AdminDevelopDocumentCreateBodyType }) =>
      apiSend('POST', `${base}/${String(requestId)}/documents`, body, AdminDevelopDocumentResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

export function useAdminDevelopDocumentPatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, body }: { docId: number; body: AdminDevelopDocumentPatchBodyType }) =>
      apiSend('PATCH', `${docBase}/${String(docId)}`, body, AdminDevelopDocumentResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

export function useAdminDevelopDocumentDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: number) => apiSend('DELETE', `${docBase}/${String(docId)}`, undefined, DevelopOkResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// 새 판 — 같은 종류·번호로 version+1 draft 를 뜬다(본문·회신 요청일·내부 메모 복사). 발송본에서만.
export function useAdminDevelopDocumentRevise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: number) =>
      apiSend('POST', `${docBase}/${String(docId)}/revise`, undefined, AdminDevelopDocumentResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// 발송 — 관리자가 확인한 메일 제목·본문이 그대로 나간다(sendMail=false 면 기록만 남기고 메일은 안 보낸다).
export function useAdminDevelopDocumentSend() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, body }: { docId: number; body: AdminDevelopDocumentSendBodyType }) =>
      apiSend('POST', `${docBase}/${String(docId)}/send`, body, AdminDevelopDocumentResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// 첨부 추가 — multipart(파일 파트 이름은 서버가 안 본다). draft 전용.
export function useAdminDevelopDocumentFileAdd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, files }: { docId: number; files: readonly File[] }) => {
      const form = new FormData();
      for (const file of files) form.append('files', file);
      return apiSendForm('POST', `${docBase}/${String(docId)}/files`, form, AdminDevelopDocumentResponse);
    },
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

export function useAdminDevelopDocumentFileDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ docId, fileId }: { docId: number; fileId: number }) =>
      apiSend('DELETE', `${docBase}/${String(docId)}/files/${String(fileId)}`, undefined, AdminDevelopDocumentResponse),
    onSuccess: () => {
      invalidateDevelop(qc);
    },
  });
}

// AI 메일 초안(develop.doc-mail) — 비동기 잡을 띄우고 jobId 를 돌려준다. 폴링은 useAiJob(설정 화면과 공용).
// 유스케이스가 꺼져 있으면 409 USECASE_DISABLED — 화면은 계약 buildDevelopDocMailDraft(결정적 초안)를 그대로 쓴다.
export function useAdminDevelopDocMailRun() {
  return useMutation({
    mutationFn: ({ docId, instructions }: { docId: number; instructions: string }) =>
      apiSend('POST', `${docBase}/${String(docId)}/ai-mail`, { instructions }, AdminDevelopDocMailRunResponse),
  });
}

// 업무표 통째 교체 — 행 편집기가 표 전체를 보낸다(taskId 는 매번 새로 발급된다).
export function useAdminDevelopTasksPut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, tasks }: { requestId: number; tasks: readonly DevelopTaskInputType[] }) =>
      apiSend('PUT', `${base}/${String(requestId)}/tasks`, { tasks }, AdminDevelopTasksResponse),
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
