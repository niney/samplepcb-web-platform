import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import {
  AdminBomReceivingCompleteResponse,
  AdminBomReceivingProgressResponse,
  AdminBomReceivingRecentResponse,
  AdminBomReceivingRecordResponse,
  AdminBomReceivingScanResponse,
  apiRoutes,
  type AdminBomReceivingRecordBodyType,
} from '@sp/api-contract';

// 입고 스캔(D42) — /api/admin/bom-receiving (requireAdmin)
// scan = 대조만(무부작용) · scans = 박제/목록/취소 · pos/:poId = 발주서별 입고 진행

const base = apiRoutes.adminBomReceiving;

/** 라벨 대조(박제 없음) — 스캔 입력마다 호출. */
export function useScanReceivingBarcode() {
  return useMutation({
    mutationFn: (barcode: string) =>
      apiSend('POST', `${base}/scan`, { barcode }, AdminBomReceivingScanResponse),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'bom-receiving'] });
};

export function useRecordReceivingScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminBomReceivingRecordBodyType) =>
      apiSend('POST', `${base}/scans`, body, AdminBomReceivingRecordResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useVoidReceivingScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scanId: number) =>
      apiSend('DELETE', `${base}/scans/${String(scanId)}`, undefined, AdminBomReceivingRecordResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useRecentReceivingScans(limit: Ref<number>, includeVoided: Ref<boolean>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-receiving', 'recent', limit.value, includeVoided.value]),
    queryFn: () =>
      apiGet(
        `${base}/scans?limit=${String(limit.value)}&includeVoided=${includeVoided.value ? '1' : '0'}`,
        AdminBomReceivingRecentResponse,
      ),
  });
}

/** 입고 스캔으로 입고 완료(2단계) — 선적·패킹 리스트·QR 포장을 스캔으로 채우고 닫는다. 워크큐·Case 집계 갱신. */
export function useCompleteReceiving() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (poId: number) =>
      apiSend('POST', `${base}/pos/${String(poId)}/complete`, undefined, AdminBomReceivingCompleteResponse),
    onSuccess: () => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-shipments'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'bom-orders'] });
    },
  });
}

export function useReceivingProgress(poId: Ref<number | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'bom-receiving', 'progress', poId.value]),
    queryFn: () => apiGet(`${base}/pos/${String(poId.value ?? '')}`, AdminBomReceivingProgressResponse),
    enabled: computed(() => poId.value !== null),
    retry: false,
  });
}
