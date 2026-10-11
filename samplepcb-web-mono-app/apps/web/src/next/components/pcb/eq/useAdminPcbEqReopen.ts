import { useMutation, useQueryClient } from '@tanstack/vue-query';
import { PcbPoActionResponse, apiRoutes, type PcbEqReopenBodyType } from '@sp/api-contract';
import { apiSend } from '@sp/shared';

// 추가 EQ 요청의 관리자 대행(D20 후속 R-2 · D11) — docs/PCB_PARTNER_TRACK.md 「D20 후속 설계」.
// 본래 협력사가 포털에서 누르는 전이다(eq_done → issued, 사유 필수): 승인 뒤 고객 회신을 읽고 더 확인할 것이
// 생겼을 때 EQ 를 다시 연다. 포털 계정이 없는 조직은 누를 사람이 없어 관리자가 대신 올린다(이력에 관리자
// 대행으로 남는다). 생산 시작 전·EQ 트랙에서만 — 판정은 계약 canReopenPcbEq, 서버가 다시 본다(NOT_EQ_TRACK 등).
// 발주 상태와 행 요약이 바뀌므로 ['admin','pcbPo'] 를 무효화한다(다른 EQ 대행 훅과 같다).
export function useAdminPcbEqReopen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ specId, poId, body }: { specId: number; poId: number; body: PcbEqReopenBodyType }) =>
      apiSend(
        'POST',
        `${apiRoutes.adminPcbProjects}/${String(specId)}/pos/${String(poId)}/eq-reopen`,
        body,
        PcbPoActionResponse,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'pcbPo'] });
    },
  });
}
