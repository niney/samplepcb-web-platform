import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminPartnerActLogResponse,
  AdminPartnerDeleteResponse,
  AdminPartnerDetailResponse,
  AdminPartnerListResponse,
  AdminPartnerMutationResponse,
  AdminPartnerRelationsResponse,
  apiRoutes,
  type AdminPartnerCreateBodyType,
  type AdminPartnerMemberAddBodyType,
  type AdminPartnerRelationAddBodyType,
  type AdminPartnerRelationCurrencyBodyType,
  type AdminPartnerStatusBodyType,
  type AdminPartnerUpdateBodyType,
  type PartnerTypeType,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// 통합 파트너 관리(/admin/partners) 서버 상태 훅 —
// 계약은 @sp/api-contract(partner.ts), 호출 관례는 useAdminMarket 그대로.

const base = apiRoutes.adminPartners;

export interface AdminPartnerFilters {
  page: number;
  pageSize: number;
  tab: 'all' | 'pending' | 'approved' | 'suspended';
  type: 'all' | PartnerTypeType;
  /** 등록 원천 — md = 마스터딜러가 포털에서 직접 등록한 조직. 생략=전체. */
  origin?: 'all' | 'admin' | 'md';
  q: string;
}

const listPath = (f: AdminPartnerFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  params.set('tab', f.tab);
  params.set('type', f.type);
  if (f.origin !== undefined && f.origin !== 'all') params.set('origin', f.origin);
  if (f.q.trim() !== '') params.set('q', f.q.trim());
  return `${base}?${params.toString()}`;
};

export function useAdminPartnerList(filters: Ref<AdminPartnerFilters>) {
  return useQuery({
    queryKey: ['admin', 'partners', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminPartnerListResponse),
    placeholderData: keepPreviousData,
  });
}

export function useAdminPartnerDetail(partnerId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'partners', 'detail', partnerId],
    queryFn: () => apiGet(`${base}/${String(partnerId.value)}`, AdminPartnerDetailResponse),
    enabled: computed(() => partnerId.value !== null),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'partners'] });
};

export function useCreatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminPartnerCreateBodyType) =>
      apiSend('POST', base, body, AdminPartnerMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useUpdatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partnerId, body }: { partnerId: number; body: AdminPartnerUpdateBodyType }) =>
      apiSend('PUT', `${base}/${String(partnerId)}`, body, AdminPartnerMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function usePartnerStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partnerId, body }: { partnerId: number; body: AdminPartnerStatusBodyType }) =>
      apiSend('POST', `${base}/${String(partnerId)}/status`, body, AdminPartnerMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useAddPartnerMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partnerId, body }: { partnerId: number; body: AdminPartnerMemberAddBodyType }) =>
      apiSend('POST', `${base}/${String(partnerId)}/members`, body, AdminPartnerMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useRemovePartnerMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partnerId, mbId }: { partnerId: number; mbId: string }) =>
      apiSend(
        'DELETE',
        `${base}/${String(partnerId)}/members/${encodeURIComponent(mbId)}`,
        undefined,
        AdminPartnerMutationResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeletePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partnerId: number) =>
      apiSend('DELETE', `${base}/${String(partnerId)}`, undefined, AdminPartnerDeleteResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// ── 관리자 대리 접속 — 그 조직의 포털을 관리자가 연다 ────────────────────────
// 새 탭으로 연다: 대리 접속 상태는 탭 단위(sessionStorage)라 관리 콘솔 탭은 영향받지 않는다.
// 진입 표식(actAs)은 라우터 가드가 받아 기억하고 주소에서 걷는다.
export const partnerPortalActAsUrl = (partnerId: number): string =>
  `/app/partner?actAs=${String(partnerId)}`;

export function useAdminPartnerActLogs(partnerId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'partners', 'act-logs', partnerId],
    queryFn: () => apiGet(`${base}/${String(partnerId.value)}/act-logs`, AdminPartnerActLogResponse),
    enabled: computed(() => partnerId.value !== null),
  });
}

// ── 마스터딜러(MD) 소속 — sp_partner_relation ───────────────────────────────
// null 이면 조회하지 않는다 — 호출부가 사람 협력사(type partner)일 때만 id 를 준다.

export function useAdminPartnerRelations(partnerId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'partners', 'relations', partnerId],
    queryFn: () =>
      apiGet(`${base}/${String(partnerId.value)}/relations`, AdminPartnerRelationsResponse),
    enabled: computed(() => partnerId.value !== null),
  });
}

export function useAddPartnerRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partnerId, body }: { partnerId: number; body: AdminPartnerRelationAddBodyType }) =>
      apiSend('POST', `${base}/${String(partnerId)}/relations`, body, AdminPartnerRelationsResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useUpdatePartnerRelationCurrency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      partnerId,
      childId,
      body,
    }: {
      partnerId: number;
      childId: number;
      body: AdminPartnerRelationCurrencyBodyType;
    }) =>
      apiSend(
        'PUT',
        `${base}/${String(partnerId)}/relations/${String(childId)}`,
        body,
        AdminPartnerRelationsResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useRemovePartnerRelation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ partnerId, childId }: { partnerId: number; childId: number }) =>
      apiSend(
        'DELETE',
        `${base}/${String(partnerId)}/relations/${String(childId)}`,
        undefined,
        AdminPartnerRelationsResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}
