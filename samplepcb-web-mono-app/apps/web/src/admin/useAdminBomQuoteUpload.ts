import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { apiSendForm } from '@sp/shared';
import {
  BomQuoteCreateResponse,
  apiRoutes,
} from '@sp/api-contract';

// 관리자 BOM 업로드 화면은 현재 고객 업로드 UI의 독립 스냅샷이다.
// 고객 useBom 변경과 분리하되, 생성 계약은 같은 회원 BOM 견적 API를 사용한다.
export function useCreateAdminBomQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return apiSendForm('POST', `${apiRoutes.bom}/quotes`, form, BomQuoteCreateResponse);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['bom', 'quotes'] }),
  });
}
