import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminPcbRfqActionResponse,
  AdminPcbRfqSendResponse,
  PartnerPcbRfqDetailResponse,
  PartnerPcbRfqListResponse,
  apiRoutes,
  type AdminPcbRfqSendBodyType,
  type PcbRfqChildSelectBodyType,
  type PcbRfqReplyBodyType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob, apiSend } from '@sp/shared';

// 협력사 포털 PCB 견적요청 훅 — docs/PCB_PARTNER_TRACK.md §5.4.
// 소속 판정은 서버(requirePartner) — 403 은 화면이 "파트너 아님" 안내로 처리.

const base = apiRoutes.partnerPcbRfqs;

export function usePartnerPcbRfqs(enabled?: Ref<boolean>) {
  return useQuery({
    queryKey: ['partner', 'pcbRfqs', 'list'],
    queryFn: () => apiGet(base, PartnerPcbRfqListResponse),
    // 셸 배지가 트랙별로 켠다(R3 usePartnerWork) — 인자 없으면 기존처럼 항상 조회.
    ...(enabled === undefined ? {} : { enabled }),
  });
}

export function usePartnerPcbRfqDetail(rfqId: Ref<number | null>) {
  return useQuery({
    queryKey: ['partner', 'pcbRfqs', 'detail', rfqId],
    queryFn: () => apiGet(`${base}/${String(rfqId.value)}`, PartnerPcbRfqDetailResponse),
    enabled: computed(() => rfqId.value !== null),
  });
}

const invalidate = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['partner', 'pcbRfqs'] });
};

export function usePartnerPcbRfqReply() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rfqId, body }: { rfqId: number; body: PcbRfqReplyBodyType }) =>
      apiSend('PUT', `${base}/${String(rfqId)}`, body, PartnerPcbRfqDetailResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// MD 전용 — 하위 협력사 배정 diff(내 소속 조직만, 서버 검증).
export function usePartnerPcbChildAssign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rfqId, body }: { rfqId: number; body: AdminPcbRfqSendBodyType }) =>
      apiSend('POST', `${base}/${String(rfqId)}/children`, body, AdminPcbRfqSendResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

// MD 전용 — 하위 선정(마진%) / 해제(childRfqId=null). 상위 회신가는 서버 계산·박제.
export function usePartnerPcbChildSelect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rfqId, body }: { rfqId: number; body: PcbRfqChildSelectBodyType }) =>
      apiSend('POST', `${base}/${String(rfqId)}/child-selection`, body, AdminPcbRfqActionResponse),
    onSuccess: () => {
      invalidate(qc);
    },
  });
}

/** 스펙 파일(거버 등) 다운로드 — Bearer 필요라 fetch→blob 저장(프록시 경유). */
export async function downloadPartnerPcbFile(
  rfqId: number,
  fileId: number,
  fileName: string,
): Promise<void> {
  const blob = await apiGetBlob(`${base}/${String(rfqId)}/files/${String(fileId)}`);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
