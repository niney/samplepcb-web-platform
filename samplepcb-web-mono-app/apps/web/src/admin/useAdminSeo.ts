import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend } from '@sp/shared';
import { SeoListResponse, SeoOkResponse, SeoResponse, apiRoutes } from '@sp/api-contract';
import type { SeoUpsertType } from '@sp/api-contract';

// 페이지별 SEO 메타 관리 — /api/admin/seo(Prisma sp_seo). 저장은 (scope, refKey) upsert(PUT),
// 삭제는 DELETE. 소비는 sp-php 테마 head.sub.php 가 담당하므로 여기선 데이터 CRUD 만. 변경 후 목록 무효화.

const SEO_KEY = ['admin', 'seo'];

export function useAdminSeo() {
  return useQuery({
    queryKey: SEO_KEY,
    queryFn: () => apiGet(apiRoutes.adminSeo, SeoListResponse),
  });
}

export function useUpsertSeo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SeoUpsertType) => apiSend('PUT', apiRoutes.adminSeo, payload, SeoResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SEO_KEY });
    },
  });
}

export function useDeleteSeo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiSend('DELETE', `${apiRoutes.adminSeo}/${String(id)}`, undefined, SeoOkResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SEO_KEY });
    },
  });
}
