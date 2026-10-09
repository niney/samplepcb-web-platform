import { computed, ref, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { ApiRequestError, apiGet, apiSend } from '@sp/shared';
import {
  AdminBomRemittanceListResponse,
  apiRoutes,
  type AdminBomRemittanceCreateBodyType,
} from '@sp/api-contract';

// BOM 송금 기록(D48, docs/SMARTBOM_PARTNER_RFQ.md §6.44) — 발주서 한 건의 송금 원장을 열고 적는다.
// 옛 관리자 화면과 새 화면(src/next)이 마크업만 다르고 상태·저장은 여기를 같이 쓴다.
// 돈은 은행에서 사람이 보내고 화면은 사실만 적는다 — 정정은 지우고 다시 적는다.

const base = (poId: number): string => `${apiRoutes.adminBomPos}/${String(poId)}/remittances`;

// 숫자 입력칸(type=number)의 v-model 은 값을 **숫자로** 준다(비우면 빈 문자열) — 어느 쪽이 와도 문자열로 읽는다.
const asText = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value).trim();

interface RemittanceDraft {
  remittedOn: string;
  amount: string | number;
  exchangeRate: string | number;
  memo: string;
}

const todayKst = (): string =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

export function useBomRemittanceEditor(poId: Ref<number>, open: Ref<boolean>) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: computed(() => ['admin', 'bom-pos', 'remittances', poId.value]),
    queryFn: () => apiGet(base(poId.value), AdminBomRemittanceListResponse),
    enabled: open,
    retry: false,
  });
  const data = computed(() => query.data.value?.data ?? null);

  // 목록(발주 패널의 요약)도 같이 갱신한다.
  const refresh = (res: { data: unknown }): void => {
    qc.setQueryData(['admin', 'bom-pos', 'remittances', poId.value], res);
    void qc.invalidateQueries({ queryKey: ['admin', 'bom-pos'], exact: false });
  };
  const createMut = useMutation({
    mutationFn: (body: AdminBomRemittanceCreateBodyType) =>
      apiSend('POST', base(poId.value), body, AdminBomRemittanceListResponse),
    onSuccess: refresh,
  });
  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      apiSend('DELETE', `${base(poId.value)}/${String(id)}`, undefined, AdminBomRemittanceListResponse),
    onSuccess: refresh,
  });

  const emptyDraft = (): RemittanceDraft => ({ remittedOn: todayKst(), amount: '', exchangeRate: '', memo: '' });
  const draft = ref<RemittanceDraft>(emptyDraft());
  const error = ref('');
  const foreign = computed(() => (data.value?.summary.currency ?? 'KRW') !== 'KRW');

  /** 잔액을 금액 칸에 채운다 — 흔한 입력(잔액 전액 지급)을 한 번에. */
  const fillBalance = (): void => {
    const balance = data.value?.summary.balance ?? 0;
    if (balance > 0) draft.value = { ...draft.value, amount: String(balance) };
  };

  async function submit(): Promise<void> {
    error.value = '';
    const amountText = asText(draft.value.amount);
    const amount = Number(amountText);
    if (amountText === '' || !Number.isFinite(amount) || amount <= 0) {
      error.value = '금액은 0보다 큰 숫자로 입력해 주세요.';
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.value.remittedOn)) {
      error.value = '송금일을 입력해 주세요.';
      return;
    }
    const rateText = asText(draft.value.exchangeRate);
    const rate = rateText === '' ? null : Number(rateText);
    if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
      error.value = '환율은 0보다 큰 숫자로 입력해 주세요.';
      return;
    }
    try {
      await createMut.mutateAsync({
        remittedOn: draft.value.remittedOn,
        amount,
        ...(foreign.value && rate !== null ? { exchangeRate: rate } : {}),
        memo: asText(draft.value.memo) === '' ? null : asText(draft.value.memo),
      });
      draft.value = emptyDraft();
    } catch (caught) {
      error.value = caught instanceof ApiRequestError ? caught.message : '송금 기록을 저장하지 못했습니다.';
    }
  }

  async function remove(id: number): Promise<void> {
    error.value = '';
    try {
      await deleteMut.mutateAsync(id);
    } catch (caught) {
      error.value = caught instanceof ApiRequestError ? caught.message : '송금 기록을 지우지 못했습니다.';
    }
  }

  const busy = computed(() => createMut.isPending.value || deleteMut.isPending.value);
  return { data, loading: query.isLoading, draft, error, foreign, busy, fillBalance, submit, remove };
}
