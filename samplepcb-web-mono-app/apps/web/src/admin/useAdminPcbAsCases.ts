import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminPcbAsCaseCandidatesResponse,
  AdminPcbAsCaseListResponse,
  AdminPcbAsCaseMutateResponse,
  AdminPcbAsCaseProceedResponse,
  PcbAsCaseOkResponse,
  type AdminPcbAsCaseCreateBodyType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend, apiSendForm } from '@sp/shared';

// PCB A/S 케이스 관리자 훅(P4) — docs/PCB_PARTNER_TRACK.md §9 A/S.
// 무효화는 ['admin','pcbAs'] 접두 + proceed 는 회차 발주서가 생기므로 발주 축
// (['admin','pcbPo'])까지 함께 무효화한다.

const base = '/api/admin';

export function useAdminPcbAsCases(specId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'pcbAs', 'list', specId],
    queryFn: () =>
      apiGet(`${base}/pcb-projects/${String(specId.value)}/as-cases`, AdminPcbAsCaseListResponse),
    enabled: computed(() => specId.value !== null),
  });
}

export function useAdminPcbAsCandidates(specId: Ref<number | null>, enabled: Ref<boolean>) {
  return useQuery({
    queryKey: ['admin', 'pcbAs', 'candidates', specId],
    queryFn: () =>
      apiGet(
        `${base}/pcb-projects/${String(specId.value)}/as-candidates`,
        AdminPcbAsCaseCandidatesResponse,
      ),
    enabled: computed(() => specId.value !== null && enabled.value),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['admin', 'pcbAs'] });
};

export function useCreatePcbAsCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { specId: number; body: AdminPcbAsCaseCreateBodyType }) =>
      apiSend(
        'POST',
        `${base}/pcb-projects/${String(p.specId)}/as-cases`,
        p.body,
        AdminPcbAsCaseMutateResponse,
      ),
    onSuccess: () => { invalidate(qc); },
  });
}

export function useUpdatePcbAsCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { caseId: number; body: AdminPcbAsCaseCreateBodyType }) =>
      apiSend('PUT', `${base}/pcb-as-cases/${String(p.caseId)}`, p.body, AdminPcbAsCaseMutateResponse),
    onSuccess: () => { invalidate(qc); },
  });
}

export function useDeletePcbAsCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: number) =>
      apiSend('DELETE', `${base}/pcb-as-cases/${String(caseId)}`, undefined, PcbAsCaseOkResponse),
    onSuccess: () => { invalidate(qc); },
  });
}

const action = (name: 'submit' | 'recall') => {
  return (caseId: number) =>
    apiSend('POST', `${base}/pcb-as-cases/${String(caseId)}/${name}`, {}, AdminPcbAsCaseMutateResponse);
};

export function useSubmitPcbAsCase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: action('submit'), onSuccess: () => { invalidate(qc); } });
}

export function useRecallPcbAsCase() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: action('recall'), onSuccess: () => { invalidate(qc); } });
}

/** 대상 협력사 회신 대행 — 포털 미사용 협력사 대비(발주·EQ 만능 대행 D11 과 같은 결). */
export function useReplyPcbAsCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { caseId: number; accept: boolean; reason?: string }) =>
      apiSend(
        'POST',
        `${base}/pcb-as-cases/${String(p.caseId)}/reply`,
        {
          accept: p.accept,
          ...(p.reason === undefined || p.reason === '' ? {} : { reason: p.reason }),
        },
        AdminPcbAsCaseMutateResponse,
      ),
    onSuccess: () => { invalidate(qc); },
  });
}

export function useProceedPcbAsCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: number) =>
      apiSend(
        'POST',
        `${base}/pcb-as-cases/${String(caseId)}/proceed`,
        {},
        AdminPcbAsCaseProceedResponse,
      ),
    onSuccess: () => {
      invalidate(qc);
      void qc.invalidateQueries({ queryKey: ['admin', 'pcbPo'] }); // 회차 발주서 등장
    },
  });
}

export function useUploadPcbAsCaseFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { caseId: number; file: File }) => {
      const form = new FormData();
      form.set('file', p.file);
      return apiSendForm(
        'POST',
        `${base}/pcb-as-cases/${String(p.caseId)}/files`,
        form,
        AdminPcbAsCaseMutateResponse,
      );
    },
    onSuccess: () => { invalidate(qc); },
  });
}

export function useDeletePcbAsCaseFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { caseId: number; fileId: number }) =>
      apiSend(
        'DELETE',
        `${base}/pcb-as-cases/${String(p.caseId)}/files/${String(p.fileId)}`,
        undefined,
        AdminPcbAsCaseMutateResponse,
      ),
    onSuccess: () => { invalidate(qc); },
  });
}

export async function downloadAdminPcbAsCaseFile(
  caseId: number,
  fileId: number,
  name: string,
): Promise<void> {
  const blob = await apiGetBlob(`${base}/pcb-as-cases/${String(caseId)}/files/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
