import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';
import {
  AdminPartnerPartSummaryListResponse,
  PartnerPartListResponse,
  PartnerPartMutationResponse,
  PartnerPartUpdateResponse,
  PartnerPartUploadDetailResponse,
  PartnerPartUploadListResponse,
  apiRoutes,
  type PartnerPartUpdateBodyType,
  type PartnerPartUploadModeType,
} from '@sp/api-contract';

// 관리자 협력사 보유 부품 뒤처리(docs/PARTNER_PARTS.md) — 요약·검색·활성 토글·비우기·대행 업로드.

const base = apiRoutes.adminPartnerParts;

export function useAdminPartnerPartSummary() {
  return useQuery({
    queryKey: ['admin', 'partner-parts', 'summary'],
    queryFn: () => apiGet(`${base}/summary`, AdminPartnerPartSummaryListResponse),
  });
}

export function useAdminPartnerPartList(
  params: Ref<{ q: string; page: number; pageSize: number; partnerId: number | null; includeInactive: boolean }>,
) {
  return useQuery({
    queryKey: computed(() => ['admin', 'partner-parts', 'list', params.value] as const),
    queryFn: () => {
      const search = new URLSearchParams({
        page: String(params.value.page),
        pageSize: String(params.value.pageSize),
        includeInactive: String(params.value.includeInactive),
      });
      if (params.value.q.trim() !== '') search.set('q', params.value.q.trim());
      if (params.value.partnerId !== null) search.set('partnerId', String(params.value.partnerId));
      return apiGet(`${base}?${search.toString()}`, PartnerPartListResponse);
    },
  });
}

export function useAdminPartnerPartUploads(partnerId: Ref<number | null>) {
  return useQuery({
    queryKey: computed(() => ['admin', 'partner-parts', 'uploads', partnerId.value] as const),
    queryFn: () =>
      apiGet(`${base}/${String(partnerId.value ?? 0)}/uploads`, PartnerPartUploadListResponse),
    enabled: computed(() => partnerId.value !== null),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'partner-parts'] });
};

/** 협력사 원장 통째 활성/비활성 — 만료가 없는 대신 사람이 끄는 스위치. */
export function useToggleAdminPartnerParts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { partnerId: number; isActive: boolean }) =>
      apiSend(
        'PATCH',
        `${base}/${String(vars.partnerId)}/active`,
        { isActive: vars.isActive },
        PartnerPartMutationResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useBulkToggleAdminPartnerParts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { partIds: number[]; isActive: boolean }) =>
      apiSend('PATCH', `${base}/rows`, vars, PartnerPartMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

/** 행 수정(관리자 뒤처리) — 협력사가 못 고치는 상황에서도 바로잡는다. */
export function useUpdateAdminPartnerPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { partId: number; body: PartnerPartUpdateBodyType }) =>
      apiSend('PATCH', base + '/row/' + String(vars.partId), vars.body, PartnerPartUpdateResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useDeleteAdminPartnerPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partId: number) =>
      apiSend('DELETE', `${base}/row/${String(partId)}`, undefined, PartnerPartMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

/** 협력사 원장 비우기 — 되돌릴 수 없다(확인은 화면이 받는다). */
export function useClearAdminPartnerParts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partnerId: number) =>
      apiSend('DELETE', `${base}/${String(partnerId)}`, undefined, PartnerPartMutationResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

/** 대행 업로드 — 포털 계정이 없는 협력사를 위해 관리자가 대신 올린다. */
export function useAdminPartnerPartUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { partnerId: number; file: File }) => {
      const form = new FormData();
      form.append('file', vars.file);
      return apiSendForm(
        'POST',
        `${base}/${String(vars.partnerId)}/uploads`,
        form,
        PartnerPartUploadDetailResponse,
      );
    },
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

export function useAdminCommitPartnerPartUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { uploadId: number; mode: PartnerPartUploadModeType }) =>
      apiSend(
        'POST',
        `${base}/uploads/${String(vars.uploadId)}/commit`,
        { mode: vars.mode },
        PartnerPartMutationResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}
