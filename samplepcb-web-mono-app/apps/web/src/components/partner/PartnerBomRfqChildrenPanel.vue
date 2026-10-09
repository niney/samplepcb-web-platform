<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { BOM_RFQ_STATUS_LABELS } from '@sp/api-contract';
import { usePartnerI18n } from '../../partner/i18n';
import { usePartnerRfqChildren, useSendPartnerRfqChildren } from '../../partner/usePartnerRfqs';

// 마스터딜러: 받은 견적요청을 하위 협력사에 다시 요청한다(docs/SMARTBOM_PARTNER_RFQ.md
// "마스터딜러 중개"). 체크한 집합으로 수렴하는 diff 발송이다 — 새로 고른 곳에만 메일이 가고,
// 체크를 푼 곳은 아직 회신이 없을 때만 회수된다(회신 온 문서는 남는다). 하위 회신을 품목별로
// 고르는 것은 아래 회신 폼의 '공급 경로' 열이 맡는다.

const props = defineProps<{ rfqId: string; readOnly: boolean }>();

const { pt, pd, pm, locale } = usePartnerI18n();

const rfqIdRef = computed(() => props.rfqId);
const query = usePartnerRfqChildren(rfqIdRef);
const data = computed(() => query.data.value?.data ?? null);
const sendMut = useSendPartnerRfqChildren();

const picked = ref<number[]>([]);
// 보낸 곳을 기본 선택으로 — 화면을 열 때마다 서버 상태에서 다시 맞춘다.
watch(
  () => data.value?.rfqs.map((rfq) => rfq.partnerId).join(',') ?? '',
  () => {
    picked.value = data.value?.rfqs.map((rfq) => rfq.partnerId) ?? [];
  },
  { immediate: true },
);

const sentIds = computed(() => new Set(data.value?.rfqs.map((rfq) => rfq.partnerId) ?? []));
const dirty = computed(() => {
  const now = new Set(picked.value);
  return now.size !== sentIds.value.size || [...now].some((id) => !sentIds.value.has(id));
});

const error = ref('');
const notice = ref('');
watch(locale, () => {
  error.value = '';
  notice.value = '';
});

async function send(): Promise<void> {
  error.value = '';
  notice.value = '';
  try {
    const res = await sendMut.mutateAsync({ rfqId: props.rfqId, body: { partnerIds: picked.value } });
    notice.value = pt('보냄 {added}곳 · 유지 {kept}곳 · 회수 {removed}곳', {
      added: res.data.added,
      kept: res.data.kept,
      removed: res.data.removed,
    });
  } catch (caught) {
    error.value =
      caught instanceof ApiRequestError && locale.value === 'ko'
        ? caught.message
        : pt('하위 협력사에 요청을 보내지 못했습니다.');
  }
}

const copied = ref<number | null>(null);
async function copyLink(childRfqId: number, token: string): Promise<void> {
  const url = `${window.location.origin}/app/rfq-reply/${token}`;
  try {
    await navigator.clipboard.writeText(url);
    copied.value = childRfqId;
  } catch {
    error.value = pt('링크를 복사하지 못했습니다.');
  }
}

const statusCls = (status: string): string =>
  status === 'quoted'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'requested'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';
</script>

<template>
  <section class="rounded-xl border border-teal-200 bg-teal-50/40 p-4" data-testid="partner-rfq-children">
    <h2 class="text-sm font-bold text-gray-900">{{ pt('하위 협력사에 다시 요청') }}</h2>
    <p class="mt-1 text-xs text-gray-500">
      {{ pt('하위 협력사의 회신이 오면 아래 회신 표에서 품목마다 골라 마진을 더해 회신할 수 있습니다.') }}
    </p>

    <p v-if="query.isLoading.value" class="mt-3 text-sm text-gray-400">{{ pt('불러오는 중…') }}</p>
    <template v-else-if="data !== null">
      <p v-if="data.candidates.length === 0 && data.rfqs.length === 0" class="mt-3 text-sm text-gray-500">
        {{ pt('부품 조달을 맡길 하위 협력사가 없습니다. 하위 협력사 메뉴에서 먼저 등록해 주세요.') }}
      </p>

      <div v-if="data.candidates.length > 0 && !readOnly" class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label
          v-for="child in data.candidates"
          :key="child.partnerId"
          class="flex items-center gap-1.5 text-sm text-gray-800"
        >
          <input v-model="picked" type="checkbox" :value="child.partnerId">
          <span>{{ child.name }}</span>
          <span class="rounded bg-white px-1 py-0.5 text-[10px] font-semibold text-gray-500">{{ child.currency }}</span>
          <span
            v-if="child.contactEmail === null && !child.hasPortalAccount"
            class="text-[10px] font-semibold text-amber-700"
            :title="pt('이메일도 포털 계정도 없습니다 — 보낸 뒤 회신 링크를 복사해 직접 전달해 주세요.')"
          >{{ pt('연락처 없음') }}</span>
        </label>
        <button
          type="button"
          class="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-40"
          :disabled="sendMut.isPending.value || !dirty"
          @click="send"
        >
          {{ pt('선택한 협력사에 요청 보내기') }}
        </button>
      </div>
      <p v-if="notice !== ''" class="mt-2 text-xs font-semibold text-emerald-700" role="status">{{ notice }}</p>
      <p v-if="error !== ''" class="mt-2 text-xs font-semibold text-red-600" role="alert">{{ error }}</p>

      <div v-if="data.rfqs.length > 0" class="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table class="w-full min-w-[640px] divide-y divide-gray-100 text-xs">
          <thead class="bg-gray-50 text-left text-gray-500">
            <tr class="whitespace-nowrap">
              <th class="px-3 py-2">{{ pt('하위 협력사') }}</th>
              <th class="px-3 py-2">{{ pt('상태') }}</th>
              <th class="px-3 py-2 text-right">{{ pt('회신 품목') }}</th>
              <th class="px-3 py-2 text-right">{{ pt('회신 합계') }}</th>
              <th class="px-3 py-2">{{ pt('회신 납기') }}</th>
              <th class="px-3 py-2" />
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="rfq in data.rfqs" :key="rfq.rfqId" data-testid="partner-rfq-child-row">
              <td class="px-3 py-2 font-medium text-gray-900">{{ rfq.partnerName }}</td>
              <td class="px-3 py-2">
                <span class="rounded px-1.5 py-0.5 font-semibold" :class="statusCls(rfq.status)">
                  {{ pt(BOM_RFQ_STATUS_LABELS[rfq.status]) }}
                </span>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ rfq.repliedItemCount }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {{ rfq.totalAmount === null ? '—' : pm(rfq.totalAmount, rfq.currency) }}
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-gray-500">{{ pd(rfq.deliveryDate) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right">
                <button
                  v-if="rfq.magicToken !== null && rfq.status !== 'closed'"
                  type="button"
                  class="rounded border border-gray-300 px-2 py-1 font-semibold text-gray-700 hover:bg-gray-50"
                  :title="pt('로그인 없이 회신할 수 있는 링크입니다. 이 협력사에게만 전달해 주세요.')"
                  @click="copyLink(rfq.rfqId, rfq.magicToken)"
                >
                  {{ copied === rfq.rfqId ? pt('복사됨') : pt('회신 링크 복사') }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
