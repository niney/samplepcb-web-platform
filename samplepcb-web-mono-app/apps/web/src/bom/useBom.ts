import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';
import {
  BomJobResponse,
  BomQuoteCreateResponse,
  BomQuoteOkResponse,
  BomQuoteDetailResponse,
  BomQuoteListResponse,
  BomSupplierPreflightResponse,
  BomSupplierResultResponse,
  BomSupplierStartResponse,
  PartDetailResponse,
  PartSearchResponse,
  apiRoutes,
  type BomQuotePatchBodyType,
  type BomSupplierOptionsType,
} from '@sp/api-contract';

// 고객 스마트 BOM — /api/bom (회원). 잡 폴링·견적 CRUD·카탈로그 검색 vue-query 훅.
// 관리자 useAdminBom 과 같은 폴링 관례(running 1.5s), 견적 변경은 ['bom'] 무효화.

const base = apiRoutes.bom;

export function useMyBomQuotes(page: Ref<number>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['bom', 'quotes', page.value]),
    queryFn: () => apiGet(`${base}/quotes?page=${String(page.value)}&pageSize=20`, BomQuoteListResponse),
    enabled,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

/**
 * refetchInterval: 자동 보강 진행 중 실시간 반영용 — 반드시 반응형(Ref/computed)이어야 한다.
 * 일반 함수는 vue-query 가 fetch 직후에만 재평가해, false 로 한 번 굳으면 폴링이 재개되지 않는다.
 */
export function useBomQuote(quoteId: Ref<string | null>, refetchInterval?: Ref<number | false>) {
  return useQuery({
    queryKey: computed(() => ['bom', 'quote', quoteId.value]),
    queryFn: () => apiGet(`${base}/quotes/${quoteId.value ?? ''}`, BomQuoteDetailResponse),
    enabled: computed(() => quoteId.value !== null),
    retry: false,
    ...(refetchInterval === undefined ? {} : { refetchInterval }),
  });
}

export function useCreateBomQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiSendForm('POST', `${base}/quotes`, form, BomQuoteCreateResponse);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bom', 'quotes'] }),
  });
}

function useQuoteMutation<TInput, TOut>(fn: (input: TInput) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bom'] }),
  });
}

export function usePatchBomQuote() {
  return useQuoteMutation(({ quoteId, body }: { quoteId: string; body: BomQuotePatchBodyType }) =>
    apiSend('PATCH', `${base}/quotes/${quoteId}`, body, BomQuoteDetailResponse),
  );
}

export function useBuildBomQuote() {
  return useQuoteMutation((quoteId: string) =>
    apiSend('POST', `${base}/quotes/${quoteId}/build`, undefined, BomQuoteDetailResponse),
  );
}

export function useCatalogMatchBomQuote() {
  return useQuoteMutation(({ quoteId, onlyUnmatched }: { quoteId: string; onlyUnmatched: boolean }) =>
    apiSend('POST', `${base}/quotes/${quoteId}/catalog-match`, { onlyUnmatched }, BomQuoteDetailResponse),
  );
}

export function useRequestBomQuote() {
  return useQuoteMutation(({ quoteId, title }: { quoteId: string; title: string }) =>
    apiSend('POST', `${base}/quotes/${quoteId}/request`, { title }, BomQuoteDetailResponse),
  );
}

export function useCancelBomQuote() {
  return useQuoteMutation((quoteId: string) =>
    apiSend('POST', `${base}/quotes/${quoteId}/cancel`, undefined, BomQuoteDetailResponse),
  );
}

export function useDeleteBomQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (quoteId: string) => apiSend('DELETE', `${base}/quotes/${quoteId}`, undefined, BomQuoteOkResponse),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['bom', 'quotes'] }),
  });
}

// ── 엔진 잡(파싱) 폴링 ──────────────────────────────────────────────────────
export function useBomJob(jobId: Ref<string | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['bom', 'job', jobId.value]),
    queryFn: () => apiGet(`${base}/jobs/${jobId.value ?? ''}`, BomJobResponse),
    enabled: computed(() => enabled.value && jobId.value !== null),
    retry: false,
    refetchInterval: (query) => (query.state.data?.data.status === 'running' ? 1_500 : false),
  });
}

// ── 공급사 검색(라이브 보강) ─────────────────────────────────────────────────
export function useSupplierPreflight() {
  return useMutation({
    mutationFn: ({ jobId, options }: { jobId: string; options: BomSupplierOptionsType }) =>
      apiSend('POST', `${base}/jobs/${jobId}/supplier-search/preflight`, options, BomSupplierPreflightResponse),
  });
}

export function useSupplierSearchStart() {
  return useMutation({
    mutationFn: ({ jobId, options }: { jobId: string; options: BomSupplierOptionsType }) =>
      apiSend('POST', `${base}/jobs/${jobId}/supplier-search`, options, BomSupplierStartResponse),
  });
}

export function useSupplierSearchStatus(jobId: Ref<string | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['bom', 'supplier', jobId.value]),
    queryFn: () => apiGet(`${base}/jobs/${jobId.value ?? ''}/supplier-search`, BomSupplierStartResponse),
    enabled: computed(() => enabled.value && jobId.value !== null),
    retry: false,
    refetchInterval: (query) => (query.state.data?.data.status === 'running' ? 2_000 : false),
  });
}

/** 완료된 공급사 검색 원본 결과 — BOM 비교 화면을 열 때만 지연 조회한다. */
export function useSupplierSearchResult(jobId: Ref<string | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['bom', 'supplier-result', jobId.value]),
    queryFn: () => apiGet(`${base}/jobs/${jobId.value ?? ''}/supplier-search/result`, BomSupplierResultResponse),
    enabled: computed(() => enabled.value && jobId.value !== null),
    retry: false,
  });
}

// ── 카탈로그(부품 교체·추가·오퍼 변경 모달) ──────────────────────────────────
export function useBomPartsSearch(q: Ref<string>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['bom', 'parts-search', q.value]),
    queryFn: () => apiGet(`${base}/parts-search?q=${encodeURIComponent(q.value)}&pageSize=20`, PartSearchResponse),
    enabled: computed(() => enabled.value && q.value.trim() !== ''),
    retry: false,
  });
}

export function useBomPartDetail(partId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['bom', 'part', partId.value]),
    queryFn: () => apiGet(`${base}/parts/${partId.value ?? ''}`, PartDetailResponse),
    enabled: computed(() => partId.value !== null),
    retry: false,
  });
}
