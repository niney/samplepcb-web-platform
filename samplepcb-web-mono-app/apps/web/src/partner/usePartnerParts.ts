import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';
import {
  PartnerPartListResponse,
  PartnerPartMutationResponse,
  PartnerPartSummaryResponse,
  PartnerPartUpdateResponse,
  PartnerPartUploadDetailResponse,
  PartnerPartUploadListResponse,
  apiRoutes,
  type PartnerPartUpdateBodyType,
  type PartnerPartUploadModeType,
  type PartnerPartUploadRemapBodyType,
} from '@sp/api-contract';

// 협력사 보유 부품(docs/PARTNER_PARTS.md) — 포털 공통 영역의 서버 상태 훅.
// 권한(part_sale)은 서버가 매 요청 판정하므로 프론트는 403 을 안내로 처리한다.

const base = apiRoutes.partnerParts;

export function usePartnerPartSummary(enabled?: Ref<boolean>) {
  return useQuery({
    queryKey: ['partner', 'parts', 'summary'],
    queryFn: () => apiGet(`${base}/summary`, PartnerPartSummaryResponse),
    retry: false,
    ...(enabled === undefined ? {} : { enabled }),
  });
}

export function usePartnerPartList(params: Ref<{ q: string; page: number; pageSize: number }>) {
  return useQuery({
    queryKey: computed(() => ['partner', 'parts', 'list', params.value] as const),
    queryFn: () => {
      const search = new URLSearchParams({
        page: String(params.value.page),
        pageSize: String(params.value.pageSize),
      });
      if (params.value.q.trim() !== '') search.set('q', params.value.q.trim());
      return apiGet(`${base}?${search.toString()}`, PartnerPartListResponse);
    },
    retry: false,
  });
}

export function usePartnerPartUploads() {
  return useQuery({
    queryKey: ['partner', 'parts', 'uploads'],
    queryFn: () => apiGet(`${base}/uploads`, PartnerPartUploadListResponse),
    retry: false,
  });
}

export function usePartnerPartUpload(uploadId: Ref<string | null>) {
  return useQuery({
    queryKey: computed(() => ['partner', 'parts', 'upload', uploadId.value] as const),
    queryFn: () =>
      apiGet(`${base}/uploads/${uploadId.value ?? ''}`, PartnerPartUploadDetailResponse),
    enabled: computed(() => uploadId.value !== null),
    retry: false,
  });
}

/** 재고표 업로드 → 미리보기 생성. 커밋 전까지 원장은 바뀌지 않는다. */
export function useCreatePartnerPartUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiSendForm('POST', `${base}/uploads`, form, PartnerPartUploadDetailResponse);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'parts'] });
    },
  });
}

/** 열 역할 교정 → 엔진 재실행(응용 계층은 셀을 재해석하지 않는다). */
export function useRemapPartnerPartUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { uploadId: string; body: PartnerPartUploadRemapBodyType }) =>
      apiSend(
        'POST',
        `${base}/uploads/${vars.uploadId}/remap`,
        vars.body,
        PartnerPartUploadDetailResponse,
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['partner', 'parts', 'upload', vars.uploadId] });
    },
  });
}

export function useCommitPartnerPartUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { uploadId: string; mode: PartnerPartUploadModeType }) =>
      apiSend(
        'POST',
        `${base}/uploads/${vars.uploadId}/commit`,
        { mode: vars.mode },
        PartnerPartMutationResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'parts'] });
    },
  });
}

export function useCancelPartnerPartUpload() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: string) =>
      apiSend('DELETE', `${base}/uploads/${uploadId}`, undefined, PartnerPartMutationResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'parts'] });
    },
  });
}

/** 행 수정 — 전체 재업로드 없이 한 줄만 고친다(docs/PARTNER_PARTS.md). */
export function useUpdatePartnerPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { partId: number; body: PartnerPartUpdateBodyType }) =>
      apiSend(
        'PATCH',
        `${base}/${String(vars.partId)}`,
        vars.body,
        PartnerPartUpdateResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'parts'] });
    },
  });
}

export function useDeletePartnerPart() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (partId: number) =>
      apiSend('DELETE', `${base}/${String(partId)}`, undefined, PartnerPartMutationResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['partner', 'parts'] });
    },
  });
}
