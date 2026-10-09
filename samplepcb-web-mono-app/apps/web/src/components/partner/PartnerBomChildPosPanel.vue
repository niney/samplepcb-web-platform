<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { usePartnerI18n } from '../../partner/i18n';
import { useIssuePartnerPoChildPos, usePartnerPoChildPos } from '../../partner/usePartnerMdPos';
import PartnerBomMdPoCard from './PartnerBomMdPoCard.vue';

// 마스터딜러: 받은 발주서의 품목을 하위 협력사에 다시 발주한다(D47, docs/SMARTBOM_PARTNER_RFQ.md §6.43).
// 누구에게 무엇을 얼마에 맡길지는 견적 때 정해졌다 — 품목마다 고른 하위와 그때 굳힌 하위 회신가.
// 여기서는 그 계획을 발주서로 보낼 뿐이다. 보낸 뒤의 진행(확인·출고·수령)은 카드에서 처리한다.

const props = defineProps<{ poId: string }>();

const { pt, pm, locale } = usePartnerI18n();

const poIdRef = computed(() => props.poId);
const query = usePartnerPoChildPos(poIdRef, ref(true));
const plan = computed(() => query.data.value?.data ?? null);
const issueMut = useIssuePartnerPoChildPos();

const pending = computed(() => (plan.value?.groups ?? []).filter((group) => group.mdPo === null));
const issued = computed(() => (plan.value?.groups ?? []).flatMap((group) => (group.mdPo === null ? [] : [group.mdPo])));
// 아직 내 손에 오지 않은 하위 발주 — 샘플피씨비로 출하하기 전에 확인할 것.
const awaiting = computed(() => issued.value.filter((mdPo) => mdPo.status !== 'received').length);

const picked = ref<number[]>([]);
// 아직 안 보낸 하위는 기본으로 전부 고른다 — 보통은 한 번에 다 보낸다.
watch(
  () => pending.value.map((group) => group.partnerId).join(','),
  () => {
    picked.value = pending.value.map((group) => group.partnerId);
  },
  { immediate: true },
);

const memo = ref('');
const error = ref('');
watch(locale, () => {
  error.value = '';
});

async function issue(): Promise<void> {
  error.value = '';
  if (picked.value.length === 0) {
    error.value = pt('발주서를 보낼 하위 협력사를 골라 주세요.');
    return;
  }
  try {
    await issueMut.mutateAsync({
      poId: props.poId,
      body: { partnerIds: picked.value, memo: memo.value.trim() === '' ? null : memo.value.trim() },
    });
    memo.value = '';
  } catch (caught) {
    error.value =
      caught instanceof ApiRequestError && locale.value === 'ko'
        ? caught.message
        : pt('하위 발주를 보내지 못했습니다.');
  }
}
</script>

<template>
  <section class="rounded-xl border border-teal-200 bg-teal-50/40 p-4" data-testid="partner-po-children">
    <h2 class="text-sm font-bold text-gray-900">{{ pt('하위 협력사 발주') }}</h2>
    <p class="mt-1 text-xs text-gray-500">
      {{ pt('견적 때 하위 협력사 회신으로 정한 품목을 그 협력사에 발주합니다. 단가는 그때 받은 회신가입니다.') }}
    </p>

    <p v-if="query.isLoading.value" class="mt-3 text-sm text-gray-400">{{ pt('불러오는 중…') }}</p>
    <template v-else-if="plan !== null">
      <!-- 아직 안 보낸 하위 -->
      <div v-if="pending.length > 0" class="mt-3 rounded-lg border border-gray-200 bg-white p-3">
        <ul class="space-y-1.5">
          <li v-for="group in pending" :key="group.partnerId" class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <label class="flex min-w-0 flex-1 items-center gap-1.5">
              <input v-model="picked" type="checkbox" :value="group.partnerId" :disabled="!plan.canIssue">
              <span class="font-semibold text-gray-900">{{ group.partnerName }}</span>
              <span class="text-xs text-gray-500">{{ pt('{count}개 품목', { count: group.items.length }) }}</span>
            </label>
            <span
              v-if="group.contactEmail === null && !group.hasPortalAccount"
              class="text-[10px] font-semibold text-amber-700"
              :title="pt('이메일도 포털 계정도 없습니다 — 발주 내용은 직접 전달해 주세요.')"
            >{{ pt('연락처 없음') }}</span>
            <span class="text-sm font-bold tabular-nums">{{ pm(group.totalAmount, group.currency) }}</span>
          </li>
        </ul>
        <div v-if="plan.canIssue" class="mt-2 flex flex-wrap items-end gap-2">
          <label class="min-w-48 flex-1 text-xs text-gray-500">{{ pt('발주 메모') }}
            <input v-model="memo" type="text" maxlength="2000" class="mt-0.5 block h-8 w-full rounded border border-gray-300 px-2">
          </label>
          <button
            type="button"
            class="h-8 rounded-lg bg-teal-600 px-3 text-xs font-bold text-white hover:bg-teal-700 disabled:opacity-40"
            :disabled="issueMut.isPending.value || picked.length === 0"
            @click="issue"
          >
            {{ pt('하위 발주서 보내기') }}
          </button>
        </div>
        <p v-else class="mt-2 text-xs text-gray-500">{{ pt('종결된 발주서에서는 하위 발주를 낼 수 없습니다.') }}</p>
        <p v-if="error !== ''" class="mt-1 text-xs font-semibold text-red-600" role="alert">{{ error }}</p>
      </div>

      <p
        v-if="awaiting > 0"
        class="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
      >
        {{ pt('하위 협력사에서 아직 받지 않은 발주가 {count}건 있습니다. 받은 뒤 수령 확인을 눌러 주세요.', { count: awaiting }) }}
      </p>

      <!-- 보낸 하위 발주 — 진행은 카드에서 -->
      <div v-if="issued.length > 0" class="mt-3 space-y-2">
        <PartnerBomMdPoCard v-for="mdPo in issued" :key="mdPo.mdPoId" :md-po="mdPo" role="parent" />
      </div>

      <p v-if="plan.directItemCount > 0" class="mt-2 text-xs text-gray-500">
        {{ pt('직접 조달하는 품목 {count}개는 하위 발주에 들어가지 않습니다.', { count: plan.directItemCount }) }}
      </p>
    </template>
  </section>
</template>
