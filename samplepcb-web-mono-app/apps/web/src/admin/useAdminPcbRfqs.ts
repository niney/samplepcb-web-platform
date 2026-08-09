import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminPcbExchangeRateResponse,
  AdminPcbRfqActionResponse,
  AdminPcbRfqCaseListResponse,
  AdminPcbRfqListResponse,
  AdminPcbRfqMagicLinkResponse,
  AdminPcbRfqReplyResponse,
  AdminPcbRfqSendResponse,
  apiRoutes,
  type AdminPcbRfqSendBodyType,
  type AdminPcbRfqTabType,
  type PcbRfqReplyBodyType,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

/** 선정 모달 prefill 용 당일 환율(결제통화→KRW) — 캐시 미준비면 null(수동 입력 유도). */
export async function fetchPcbSelectRate(
  from: 'USD' | 'CNY',
): Promise<{ rate: number; rateDate: string | null } | null> {
  const res = await apiGet(
    `${apiRoutes.adminPcbExchangeRate}?from=${from}`,
    AdminPcbExchangeRateResponse,
  );
  return res.data;
}

// PCB 협력 모듈 서버 상태 훅 — docs/PCB_PARTNER_TRACK.md §5.4. 계약은
// @sp/api-contract(pcb-rfq.ts), 무효화는 ['admin','pcbRfq'] 접두 일괄(관례).

export interface AdminPcbRfqCaseFilters {
  page: number;
  pageSize: number;
  tab: AdminPcbRfqTabType;
  q: string;
}

const caseListPath = (f: AdminPcbRfqCaseFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${apiRoutes.adminPcbRfqs}?${params.toString()}`;
};

export function useAdminPcbRfqCases(filters: Ref<AdminPcbRfqCaseFilters>) {
  return useQuery({
    queryKey: ['admin', 'pcbRfq', 'cases', filters],
    queryFn: () => apiGet(caseListPath(filters.value), AdminPcbRfqCaseListResponse),
    placeholderData: keepPreviousData,
  });
}

// 사이드바 'PCB 견적요청' 배지 — 지금 움직여야 하는 수 = 회신 완료·선정 대기(quoted).
export function usePcbRfqPendingCount(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'pcbRfq', 'pending-count'],
    queryFn: async () => {
      const res = await apiGet(
        `${apiRoutes.adminPcbRfqs}?page=1&pageSize=1&tab=all`,
        AdminPcbRfqCaseListResponse,
      );
      return res.data.counts.quoted;
    },
    enabled,
    refetchInterval: 60_000,
  });
}

export function useAdminPcbRfqs(specId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'pcbRfq', 'list', specId],
    queryFn: () =>
      apiGet(
        `${apiRoutes.adminPcbProjects}/${String(specId.value)}/rfqs`,
        AdminPcbRfqListResponse,
      ),
    enabled: computed(() => specId.value !== null),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbRfq'] });
};

export function useSendPcbRfqs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, body }: { specId: number; body: AdminPcbRfqSendBodyType }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/rfqs`,
        body,
        AdminPcbRfqSendResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useAdminPcbRfqReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      specId,
      rfqId,
      body,
    }: {
      specId: number;
      rfqId: number;
      body: PcbRfqReplyBodyType;
    }) =>
      apiSend(
        'PUT',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/rfqs/${String(rfqId)}/reply`,
        body,
        AdminPcbRfqReplyResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useSelectPcbRfq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      specId,
      rfqId,
      exchangeRate,
      finalPrice,
    }: {
      specId: number;
      rfqId: number;
      exchangeRate?: number;
      finalPrice?: number;
    }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/rfqs/${String(rfqId)}/select`,
        {
          ...(exchangeRate === undefined ? {} : { exchangeRate }),
          ...(finalPrice === undefined ? {} : { finalPrice }),
        },
        AdminPcbRfqActionResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useUnselectPcbRfq() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, rfqId }: { specId: number; rfqId: number }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/rfqs/${String(rfqId)}/unselect`,
        {},
        AdminPcbRfqActionResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useReissuePcbMagicLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, rfqId }: { specId: number; rfqId: number }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/rfqs/${String(rfqId)}/magic-link`,
        {},
        AdminPcbRfqMagicLinkResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

/** 매직링크 회신 페이지 URL — 서버(pcb-rfq-email)와 같은 경로 조립. */
export const pcbMagicReplyUrl = (token: string): string =>
  `${window.location.origin}/app/pcb-rfq-reply/${token}`;
