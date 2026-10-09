import { computed, ref, type Ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import type {
  AdminBomRfqViewType,
  BomPartnerFxCurrencyType,
  BomPartnerFxRatesType,
} from '@sp/api-contract';
import { foreignCurrenciesOf } from './bom-partner-money';
import { useAdminBomRfqs, useSetBomPartnerFx } from './useAdminBomRfqs';

// 협력사 외화 환율 띠 — 비교·선정 화면에서 "이 견적에 굳힌 환율"을 보이고 직접 굳히게 한다.
// 옛 화면과 새 화면(src/next)이 마크업만 다르고 상태·저장은 여기를 같이 쓴다.

const EMPTY_FX: BomPartnerFxRatesType = { USD: null, CNY: null };

// 숫자 입력칸(type=number)의 v-model 은 값을 **숫자로** 준다(비우면 빈 문자열) — 문자열로 가정하고
// trim 하면 입력한 순간 터져 저장이 조용히 안 된다. 어느 쪽이 와도 문자열로 읽는다.
const asText = (value: string | number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value).trim();

export function useBomPartnerFxEditor(
  quoteId: Ref<string>,
  rfqs: Ref<readonly Pick<AdminBomRfqViewType, 'currency'>[]>,
) {
  // 현황 패널과 같은 캐시 — 환율을 굳히면 비교표의 원화 환산도 같이 새로 온다.
  const list = useAdminBomRfqs(quoteId);
  const partnerFx = computed(() => list.data.value?.data.partnerFx ?? EMPTY_FX);
  const currencies = computed(() => foreignCurrenciesOf(rfqs.value));
  const drafts = ref<Record<BomPartnerFxCurrencyType, string | number>>({ USD: '', CNY: '' });
  const error = ref('');
  const mutation = useSetBomPartnerFx();

  async function apply(currency: BomPartnerFxCurrencyType): Promise<void> {
    error.value = '';
    const input = asText(drafts.value[currency]);
    const rate = Number(input);
    if (input === '' || !Number.isFinite(rate) || rate <= 0) {
      error.value = '환율은 0보다 큰 숫자로 입력해 주세요.';
      return;
    }
    try {
      await mutation.mutateAsync({ quoteId: quoteId.value, body: { currency, rate } });
      drafts.value = { ...drafts.value, [currency]: '' };
    } catch (reason) {
      error.value = reason instanceof ApiRequestError ? reason.message : '환율을 저장하지 못했습니다.';
    }
  }

  return { partnerFx, currencies, drafts, error, pending: mutation.isPending, apply };
}
