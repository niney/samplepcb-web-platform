import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  PartnerChildDeleteResponse,
  PartnerChildListResponse,
  apiRoutes,
  type PartnerChildCreateBodyType,
  type PartnerChildInviteBodyType,
  type PartnerChildListResponseType,
  type PartnerChildUpdateBodyType,
} from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// 하위 협력사 직접 관리 훅 — docs/PARTNER_PORTAL.md "하위 협력사 직접 관리".
// 소속·소유 판정은 서버(requirePartner·loadOwnedChild). 변경 응답이 새 목록을 통째로 돌려주므로
// 캐시에 그대로 넣는다(다시 조회하지 않는다).

const base = apiRoutes.partnerChildren;
const LIST_KEY = ['partner', 'children', 'list'] as const;

export function usePartnerChildren() {
  return useQuery({
    queryKey: LIST_KEY,
    queryFn: () => apiGet(base, PartnerChildListResponse),
  });
}

function useListMutation<TVars>(run: (vars: TVars) => Promise<PartnerChildListResponseType>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (res) => {
      qc.setQueryData(LIST_KEY, res);
      // 첫 등록은 조직을 마스터딜러로 바꾼다 — 견적요청 상세의 하위 배정 칸이 바로 열리게 한다.
      void qc.invalidateQueries({ queryKey: ['partner', 'pcbRfqs'] });
    },
  });
}

export function useCreatePartnerChild() {
  return useListMutation((body: PartnerChildCreateBodyType) =>
    apiSend('POST', base, body, PartnerChildListResponse),
  );
}

export function useUpdatePartnerChild() {
  return useListMutation(
    ({ childId, body }: { childId: number; body: PartnerChildUpdateBodyType }) =>
      apiSend('PUT', `${base}/${String(childId)}`, body, PartnerChildListResponse),
  );
}

export function useReactivatePartnerChild() {
  return useListMutation((childId: number) =>
    apiSend('POST', `${base}/${String(childId)}/reactivate`, undefined, PartnerChildListResponse),
  );
}

export function useInvitePartnerChild() {
  return useListMutation(
    ({ childId, body }: { childId: number; body: PartnerChildInviteBodyType }) =>
      apiSend('POST', `${base}/${String(childId)}/invite`, body, PartnerChildListResponse),
  );
}

export function useDeletePartnerChild() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (childId: number) =>
      apiSend('DELETE', `${base}/${String(childId)}`, undefined, PartnerChildDeleteResponse),
    onSuccess: (res) => {
      qc.setQueryData<PartnerChildListResponseType>(LIST_KEY, {
        result: true,
        data: { eligibility: res.data.eligibility, items: res.data.items },
      });
      void qc.invalidateQueries({ queryKey: ['partner', 'pcbRfqs'] });
    },
  });
}
