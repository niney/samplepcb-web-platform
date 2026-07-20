import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';
import {
  BomJobResponse,
  BomQuoteCreateResponse,
  BomQuoteOkResponse,
  BomQuoteDetailResponse,
  BomQuoteItemCandidatesResponse,
  BomQuoteListResponse,
  BomSupplierPreflightResponse,
  BomSupplierResultResponse,
  BomSupplierStartResponse,
  BomPartSearchResponse,
  PartDetailResponse,
  apiRoutes,
  type BomQuoteBuildBodyType,
  type BomQuoteCandidateSelectionBodyType,
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

/**
 * 자동저장(1s 디바운스)은 가장 잦은 뮤테이션 — ['bom'] 전체 무효화 대신 응답(서버
 * 재계산 포함)을 상세 캐시에 직접 반영해 저장마다 뒤따르던 GET 리페치와 전체
 * 재렌더를 없앤다. setQueryData 도 structural sharing 을 타므로 안 바뀐 항목의
 * 참조가 유지된다(BomQuote 의 행 단위 재렌더 격리 전제).
 */
export function usePatchBomQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: BomQuotePatchBodyType }) =>
      apiSend('PATCH', `${base}/quotes/${quoteId}`, body, BomQuoteDetailResponse),
    onSuccess: (data, { quoteId }) => {
      qc.setQueryData(['bom', 'quote', quoteId], data);
      // 목록 합계·후보 스냅샷(현재 금액)은 다음 조회 때 갱신 — 열려 있지 않으면 비용 0
      void qc.invalidateQueries({ queryKey: ['bom', 'quotes'] });
      void qc.invalidateQueries({ queryKey: ['bom', 'quote', quoteId, 'candidates'] });
    },
  });
}

export function useBuildBomQuote() {
  return useQuoteMutation(({ quoteId, body }: { quoteId: string; body: BomQuoteBuildBodyType }) =>
    apiSend('POST', `${base}/quotes/${quoteId}/build`, body, BomQuoteDetailResponse),
  );
}

export function usePrepareBomQuoteSheets() {
  return useQuoteMutation((quoteId: string) =>
    apiSend('POST', `${base}/quotes/${quoteId}/prepare`, undefined, BomQuoteDetailResponse),
  );
}

export function useBomQuoteCandidates(
  quoteId: Ref<string | null>,
  rowIdx: Ref<number | null>,
  enabled: Ref<boolean>,
) {
  return useQuery({
    queryKey: computed(() => ['bom', 'quote', quoteId.value, 'candidates', rowIdx.value]),
    queryFn: () => apiGet(
      `${base}/quotes/${quoteId.value ?? ''}/items/${String(rowIdx.value ?? '')}/candidates`,
      BomQuoteItemCandidatesResponse,
    ),
    enabled: computed(() => enabled.value && quoteId.value !== null && rowIdx.value !== null),
    retry: false,
  });
}

export function useSelectBomQuoteCandidate() {
  return useQuoteMutation(({
    quoteId,
    rowIdx,
    body,
  }: {
    quoteId: string;
    rowIdx: number;
    body: BomQuoteCandidateSelectionBodyType;
  }) => apiSend('POST', `${base}/quotes/${quoteId}/items/${String(rowIdx)}/selection`, body, BomQuoteDetailResponse));
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
export function useBomPartsSearch(q: Ref<string>, enabled: Ref<boolean>, needed?: Ref<number>) {
  return useQuery({
    queryKey: computed(() => ['bom', 'parts-search', q.value, needed?.value ?? 1]),
    queryFn: () =>
      apiGet(
        `${base}/parts-search?q=${encodeURIComponent(q.value)}&pageSize=20&needed=${String(needed?.value ?? 1)}`,
        BomPartSearchResponse,
      ),
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
