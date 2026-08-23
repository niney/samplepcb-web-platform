import type { Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  PartnerPcbAsCaseDetailResponse,
  PartnerPcbAsCaseListResponse,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend, apiSendForm } from '@sp/shared';

// PCB A/S 케이스 포털 훅(P4) — 회신 주체(target=나) + MD 중계 열람(parent=나).

export function usePartnerPcbAsCases(enabled?: Ref<boolean>) {
  return useQuery({
    queryKey: ['partner', 'pcbAs', 'list'],
    queryFn: () => apiGet('/api/partner/pcb-as-cases', PartnerPcbAsCaseListResponse),
    // 셸 배지가 트랙별로 켠다(R3 usePartnerWork) — 인자 없으면 기존처럼 항상 조회.
    ...(enabled === undefined ? {} : { enabled }),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['partner', 'pcbAs'] });
};

export function useReplyPartnerPcbAsCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { caseId: number; accept: boolean; reason?: string }) =>
      apiSend(
        'POST',
        `/api/partner/pcb-as-cases/${String(p.caseId)}/${p.accept ? 'accept' : 'reject'}`,
        p.reason === undefined || p.reason === '' ? {} : { reason: p.reason },
        PartnerPcbAsCaseDetailResponse,
      ),
    onSuccess: () => { invalidate(qc); },
  });
}

export function useUploadPartnerPcbAsCaseFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { caseId: number; file: File }) => {
      const form = new FormData();
      form.set('file', p.file);
      return apiSendForm(
        'POST',
        `/api/partner/pcb-as-cases/${String(p.caseId)}/files`,
        form,
        PartnerPcbAsCaseDetailResponse,
      );
    },
    onSuccess: () => { invalidate(qc); },
  });
}

export function useDeletePartnerPcbAsCaseFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { caseId: number; fileId: number }) =>
      apiSend(
        'DELETE',
        `/api/partner/pcb-as-cases/${String(p.caseId)}/files/${String(p.fileId)}`,
        undefined,
        PartnerPcbAsCaseDetailResponse,
      ),
    onSuccess: () => { invalidate(qc); },
  });
}

export async function downloadPartnerPcbAsCaseFile(
  caseId: number,
  fileId: number,
  name: string,
): Promise<void> {
  const blob = await apiGetBlob(
    `/api/partner/pcb-as-cases/${String(caseId)}/files/${String(fileId)}`,
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** 연결 고객 클레임(P5) 첨부 다운로드 — 케이스 경유 라우트(연결 검증은 서버). */
export async function downloadPartnerPcbAsClaimFile(
  caseId: number,
  fileId: number,
  name: string,
): Promise<void> {
  const blob = await apiGetBlob(
    `/api/partner/pcb-as-cases/${String(caseId)}/claim-files/${String(fileId)}`,
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
