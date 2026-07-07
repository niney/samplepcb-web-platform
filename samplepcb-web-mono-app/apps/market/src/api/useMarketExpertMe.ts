import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import type { Ref } from 'vue';
import {
  MarketExpertMeResponse,
  MarketExpertRegisterResponse,
  MarketFileDeleteResponse,
  apiRoutes,
} from '@sp/api-contract';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';

// 본인 전문가 프로필 서버 상태 — 미등록은 404(NOT_REGISTERED)로 오므로 retry 하지 않고
// 호출측이 status 404 를 "미등록" 상태로 해석한다.

export function useExpertMe(enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['market', 'expert-me'],
    queryFn: () => apiGet(`${apiRoutes.marketExperts}/me`, MarketExpertMeResponse),
    enabled,
    retry: false,
  });
}

// 등록(multipart: payload + license[]/portfolio[]/bizreg).
export function useRegisterExpert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) =>
      apiSendForm('POST', apiRoutes.marketExperts, form, MarketExpertRegisterResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['market', 'expert-me'] });
      void qc.invalidateQueries({ queryKey: ['market', 'experts'] });
    },
  });
}

// 본인 수정·재제출(multipart) — pending·rejected 에서만(서버 가드).
export function useUpdateExpertMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) =>
      apiSendForm('PATCH', `${apiRoutes.marketExperts}/me`, form, MarketExpertMeResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['market', 'expert-me'] });
    },
  });
}

export function useDeleteExpertFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fileId: number) =>
      apiSend(
        'DELETE',
        `${apiRoutes.marketExperts}/me/files/${String(fileId)}`,
        undefined,
        MarketFileDeleteResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['market', 'expert-me'] });
    },
  });
}
