import { computed, type Ref } from 'vue';
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/vue-query';
import { ApiRequestError, apiGet, apiSend } from '@sp/shared';
import {
  AdminBomQuoteAnswerEmailResponse,
  AdminBomQuoteCompleteResponse,
  AdminBomCaseDeletePreviewResponse,
  AdminBomCaseDeleteResponse,
  AdminBomQuoteDetailResponse,
  AdminBomQuoteListResponse,
  BomQuoteItemCandidatesResponse,
  apiRoutes,
  type AdminBomCaseDeleteBodyType,
  type AdminBomCaseDeletePreviewType,
  type AdminBomCaseDeleteResponseType,
  type AdminBomQuoteAnswerEmailBodyType,
  type AdminBomQuotePatchBodyType,
  type AdminBomQuoteCompleteBodyType,
  type AdminBomQuoteItemReviewsBodyType,
  type AdminBomQuoteItemAddBodyType,
  type AdminBomQuoteItemRemoveBodyType,
  type AdminBomQuoteItemSelectionBodyType,
  type BomQuoteStatusType,
} from '@sp/api-contract';

// 고객 BOM 견적요청 검토 — /api/admin/bom-quotes (requireAdmin)

const base = apiRoutes.adminBomQuotes;

export interface AdminBomCaseDeletePreviewLoad {
  quoteId: string;
  preview: AdminBomCaseDeletePreviewType | null;
  error: string | null;
}

export interface AdminBomCaseBulkDeleteTarget {
  quoteId: string;
  previewToken: string;
}

export type AdminBomCaseBulkDeleteInput =
  | {
      targets: AdminBomCaseBulkDeleteTarget[];
      mode: 'audited';
      reason: string;
      forceDeletePaidOrder?: boolean;
    }
  | {
      targets: AdminBomCaseBulkDeleteTarget[];
      mode: 'reset';
      forceDeletePaidOrder?: boolean;
    };

export interface AdminBomCaseBulkDeleteResult {
  deleted: AdminBomCaseDeleteResponseType['data'][];
  failed: { quoteId: string; message: string }[];
}

const invalidateBomCaseQueries = (qc: QueryClient): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-rfqs'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-shipments'] });
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-orders'] });
  void qc.invalidateQueries({ queryKey: ['bom'] });
  void qc.invalidateQueries({ queryKey: ['partner'] });
};

const deleteErrorMessage = (error: unknown): string => {
  if (error instanceof ApiRequestError) {
    return error.payload?.message ?? error.message;
  }
  return '관련 데이터 삭제 중 알 수 없는 오류가 발생했습니다.';
};

const loadDeletePreview = async (quoteId: string): Promise<AdminBomCaseDeletePreviewLoad> => {
  try {
    const response = await apiGet(
      `${base}/${quoteId}/force-delete-preview`,
      AdminBomCaseDeletePreviewResponse,
    );
    return { quoteId, preview: response.data, error: null };
  } catch (error) {
    return {
      quoteId,
      preview: null,
      error: deleteErrorMessage(error),
    };
  }
};

export function useAdminBomQuotes(status: Ref<BomQuoteStatusType | null>, page: Ref<number>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-quotes', status.value, page.value]),
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page.value), pageSize: '20' });
      if (status.value !== null) params.set('status', status.value);
      return apiGet(`${base}?${params.toString()}`, AdminBomQuoteListResponse);
    },
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useAdminBomQuote(quoteId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-quotes', 'detail', quoteId.value]),
    queryFn: () => apiGet(`${base}/${quoteId.value ?? ''}`, AdminBomQuoteDetailResponse),
    enabled: computed(() => quoteId.value !== null),
    retry: false,
  });
}

/** 메뉴 배지용 관리자 차례 선적 수(D22) — counts 만 필요해 최소 페이지로 조회. */
export function useBomShipmentPendingCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'bom-quotes', 'shipment-pending-count'],
    queryFn: () => apiGet(`${base}?page=1&pageSize=1`, AdminBomQuoteListResponse),
    enabled,
    select: (res) => res.data.counts.shipmentPending,
    refetchInterval: 60_000,
  });
}

/** 메뉴 배지용 검토 대기(requested) 수 — 견적관리 메뉴(관리자 메뉴 재편). */
export function useBomQuotesRequestedCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'bom-quotes', 'requested-count'],
    queryFn: () => apiGet(`${base}?page=1&pageSize=1`, AdminBomQuoteListResponse),
    enabled,
    select: (res) => res.data.counts.requested,
    refetchInterval: 60_000,
  });
}

export function useAdminBomQuoteCandidates(quoteId: Ref<string | null>, itemId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-quotes', 'candidates', quoteId.value, itemId.value]),
    queryFn: () => apiGet(
      `${base}/${quoteId.value ?? ''}/items/${itemId.value ?? ''}/candidates`,
      BomQuoteItemCandidatesResponse,
    ),
    enabled: computed(() => quoteId.value !== null && itemId.value !== null),
    retry: false,
  });
}

export function usePatchAdminBomQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomQuotePatchBodyType }) =>
      apiSend('PATCH', `${base}/${quoteId}`, body, AdminBomQuoteDetailResponse),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] }),
  });
}

/** 검토 완료 — 상태 확정과 선택한 고객 이메일 발송 결과를 함께 돌려받는다. */
export function useCompleteAdminBomQuote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quoteId,
      body,
    }: {
      quoteId: string;
      body: AdminBomQuoteCompleteBodyType;
    }) => apiSend('POST', `${base}/${quoteId}/complete`, body, AdminBomQuoteCompleteResponse),
    onSuccess: (response, variables) => {
      qc.setQueryData(
        ['admin', 'bom-quotes', 'detail', variables.quoteId],
        { result: true as const, data: response.data },
      );
      invalidateBomCaseQueries(qc);
    },
  });
}

/** 고객 회신 확정 후 상태를 바꾸지 않고 공식 고객 회신 이메일만 다시 보낸다. */
export function useSendAdminBomQuoteAnswerEmail() {
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomQuoteAnswerEmailBodyType }) => apiSend(
      'POST',
      `${base}/${quoteId}/answer-email`,
      body,
      AdminBomQuoteAnswerEmailResponse,
    ),
  });
}

/** RFQ 발송 체크와 분리된 관리자 품목 확인 이력(한 건/표시 목록 일괄). */
export function useReviewAdminBomQuoteItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quoteId,
      body,
    }: {
      quoteId: string;
      body: AdminBomQuoteItemReviewsBodyType;
    }) => apiSend(
      'PUT',
      `${base}/${quoteId}/item-reviews`,
      body,
      AdminBomQuoteDetailResponse,
    ),
    onSuccess: (response, variables) => {
      qc.setQueryData(['admin', 'bom-quotes', 'detail', variables.quoteId], response);
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
    },
  });
}

/** 관리자 품목 교체 — 후보/카탈로그 정체성만 전송하고 서버 계산 상세로 갱신한다. */
export function useSelectAdminBomQuoteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quoteId,
      itemId,
      body,
    }: {
      quoteId: string;
      itemId: string;
      body: AdminBomQuoteItemSelectionBodyType;
    }) => apiSend(
      'POST',
      `${base}/${quoteId}/items/${itemId}/selection`,
      body,
      AdminBomQuoteDetailResponse,
    ),
    onSuccess: (response, variables) => {
      qc.setQueryData(['admin', 'bom-quotes', 'detail', variables.quoteId], response);
      void qc.invalidateQueries({
        queryKey: ['admin', 'bom-quotes', 'candidates', variables.quoteId, variables.itemId],
      });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-rfqs', variables.quoteId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos', variables.quoteId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-orders'] });
    },
  });
}

/** 관리자 카탈로그 부품 추가 — 응답 상세과 관련 업무 목록을 같은 시점으로 갱신한다. */
export function useAddAdminBomQuoteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomQuoteItemAddBodyType }) =>
      apiSend('POST', `${base}/${quoteId}/items`, body, AdminBomQuoteDetailResponse),
    onSuccess: (response, variables) => {
      qc.setQueryData(['admin', 'bom-quotes', 'detail', variables.quoteId], response);
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-rfqs', variables.quoteId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos', variables.quoteId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-orders'] });
    },
  });
}

/** 관리자 수동 추가 행 제거 — 삭제된 행의 후보 캐시도 함께 비운다. */
export function useRemoveAdminBomQuoteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      quoteId,
      itemId,
      body,
    }: {
      quoteId: string;
      itemId: string;
      body: AdminBomQuoteItemRemoveBodyType;
    }) => apiSend(
      'DELETE',
      `${base}/${quoteId}/items/${itemId}`,
      body,
      AdminBomQuoteDetailResponse,
    ),
    onSuccess: (response, variables) => {
      qc.setQueryData(['admin', 'bom-quotes', 'detail', variables.quoteId], response);
      qc.removeQueries({
        queryKey: ['admin', 'bom-quotes', 'candidates', variables.quoteId, variables.itemId],
      });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-quotes'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-rfqs', variables.quoteId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos', variables.quoteId] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-orders'] });
    },
  });
}

/** Case 삭제 1단계 영향 프리뷰 — 열려 있을 때만 주문·선적 관계까지 조회한다. */
export function useAdminBomCaseDeletePreview(
  quoteId: Ref<string | null>,
  enabled: Ref<boolean>,
) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-case-delete-preview', quoteId.value]),
    queryFn: () =>
      apiGet(
        `${base}/${quoteId.value ?? ''}/force-delete-preview`,
        AdminBomCaseDeletePreviewResponse,
      ),
    enabled: computed(() => enabled.value && quoteId.value !== null),
    retry: false,
  });
}

/** 목록 일괄 삭제 프리뷰. DB 연결을 몰아치지 않도록 최대 4건씩 조회한다. */
export function useAdminBomCaseDeletePreviews(
  quoteIds: Ref<readonly string[]>,
  enabled: Ref<boolean>,
) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-case-delete-previews', [...quoteIds.value]]),
    queryFn: async (): Promise<AdminBomCaseDeletePreviewLoad[]> => {
      const ids = [...quoteIds.value];
      const results: AdminBomCaseDeletePreviewLoad[] = [];
      for (let index = 0; index < ids.length; index += 4) {
        const batch = ids.slice(index, index + 4);
        results.push(...await Promise.all(batch.map(loadDeletePreview)));
      }
      return results;
    },
    enabled: computed(() => enabled.value && quoteIds.value.length > 0),
    retry: false,
  });
}

/** Case 삭제 2단계 실행 — 관련 관리자·고객·협력사 파생 캐시를 전부 무효화한다. */
export function useDeleteAdminBomCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ quoteId, body }: { quoteId: string; body: AdminBomCaseDeleteBodyType }) =>
      apiSend(
        'POST',
        `${base}/${quoteId}/force-delete`,
        body,
        AdminBomCaseDeleteResponse,
      ),
    onSuccess: () => {
      invalidateBomCaseQueries(qc);
    },
  });
}

/** 체크한 Case를 하나씩 재검증·삭제한다. 한 건의 실패가 나머지 Case를 막지 않는다. */
export function useDeleteAdminBomCases() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: AdminBomCaseBulkDeleteInput,
    ): Promise<AdminBomCaseBulkDeleteResult> => {
      const result: AdminBomCaseBulkDeleteResult = { deleted: [], failed: [] };
      for (const target of input.targets) {
        const common = {
          previewToken: target.previewToken,
          acknowledgeIrreversible: true as const,
          ...(input.forceDeletePaidOrder === true ? { forceDeletePaidOrder: true as const } : {}),
        };
        const body: AdminBomCaseDeleteBodyType = input.mode === 'audited'
          ? { mode: 'audited', reason: input.reason, ...common }
          : { mode: 'reset', ...common };
        try {
          const response = await apiSend(
            'POST',
            `${base}/${target.quoteId}/force-delete`,
            body,
            AdminBomCaseDeleteResponse,
          );
          result.deleted.push(response.data);
        } catch (error) {
          result.failed.push({
            quoteId: target.quoteId,
            message: deleteErrorMessage(error),
          });
        }
      }
      return result;
    },
    onSuccess: () => {
      invalidateBomCaseQueries(qc);
    },
  });
}
