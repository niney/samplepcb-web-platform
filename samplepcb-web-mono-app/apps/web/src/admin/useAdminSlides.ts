import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';
import { SlideListResponse, SlideOkResponse, SlideResponse, apiRoutes } from '@sp/api-contract';

// 홈 메인 슬라이드 관리 — /api/admin/slides(g5_shop_banner '메인'). 생성/수정은 이미지
// 동반이라 multipart(apiSendForm), 삭제/순서변경은 JSON(apiSend). 변경 후 목록 무효화.

const SLIDES_KEY = ['admin', 'slides'];

export function useAdminSlides() {
  return useQuery({
    queryKey: SLIDES_KEY,
    queryFn: () => apiGet(apiRoutes.adminSlides, SlideListResponse),
  });
}

export function useCreateSlide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => apiSendForm('POST', apiRoutes.adminSlides, form, SlideResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SLIDES_KEY });
    },
  });
}

export function useUpdateSlide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, form }: { id: number; form: FormData }) =>
      apiSendForm('PATCH', `${apiRoutes.adminSlides}/${String(id)}`, form, SlideResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SLIDES_KEY });
    },
  });
}

export function useDeleteSlide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiSend('DELETE', `${apiRoutes.adminSlides}/${String(id)}`, undefined, SlideOkResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SLIDES_KEY });
    },
  });
}

export function useReorderSlides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: number[]) =>
      apiSend('PATCH', `${apiRoutes.adminSlides}/reorder`, { ids }, SlideOkResponse),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SLIDES_KEY });
    },
  });
}
