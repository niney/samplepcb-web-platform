<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BomPartSearchSupplementResponseType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useBomPartsSupplement } from '../../bom/useBom';

const props = withDefaults(defineProps<{
  query: string;
  mode: 'mpn' | 'exact' | 'similar' | 'text';
  interpretedSpecCount: number;
  needed?: number;
  auto?: boolean;
  waitForCatalog?: boolean;
  disabled?: boolean;
}>(), {
  needed: 1,
  auto: false,
  waitForCatalog: false,
  disabled: false,
});

const emit = defineEmits<{
  complete: [data: BomPartSearchSupplementResponseType['data']];
}>();

const supplement = useBomPartsSupplement();
const lastAutoKey = ref<string | null>(null);
const canSupplement = computed(() => props.query.trim() !== '');
const errorMessage = computed(() => {
  const reason = supplement.error.value;
  if (!(reason instanceof ApiRequestError)) return '공급사 추가 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (reason.payload?.error === 'SEARCH_DAILY_LIMIT') return '오늘 사용할 수 있는 공급사 추가 확인 횟수를 모두 사용했습니다.';
  if (reason.payload?.error === 'BOM_ENGINE_UNREACHABLE') return '부품 검색 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  return '공급사 추가 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
});
const headline = computed(() => {
  if (props.mode === 'mpn') return '로컬 카탈로그에서 정확히 일치하는 MPN을 찾았습니다.';
  if (props.mode === 'exact') return `로컬 카탈로그에서 해석된 규격 ${String(props.interpretedSpecCount)}개가 모두 일치했습니다.`;
  if (props.mode === 'similar') return '로컬 카탈로그에는 모든 규격이 일치하는 부품이 없습니다.';
  return '공급사에서 현재 검색어의 상위 후보를 확인할 수 있습니다.';
});

watch(
  () => [props.query, props.needed, props.mode, props.auto] as const,
  () => {
    supplement.reset();
    if (props.auto && props.mode !== 'mpn') requestSupplement(true);
  },
  { immediate: true },
);

function requestSupplement(automatic = false): void {
  if (!canSupplement.value || props.disabled || supplement.isPending.value) return;
  const key = `${props.query.trim()}\u001f${String(props.needed)}`;
  if (automatic && lastAutoKey.value === key) return;
  if (automatic) lastAutoKey.value = key;
  supplement.mutate(
    {
      q: props.query,
      needed: props.needed,
      waitForCatalog: props.waitForCatalog,
    },
    {
      onSuccess: (response) => {
        emit('complete', response.data);
      },
    },
  );
}
</script>

<template>
  <div
    class="mt-4 flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    :class="mode === 'mpn' || mode === 'exact' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : mode === 'similar' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-blue-200 bg-blue-50 text-blue-900'"
    aria-live="polite"
  >
    <div>
      <p class="font-bold">{{ headline }}</p>
      <p class="mt-0.5 text-xs leading-5 opacity-80">
        {{ mode === 'mpn'
          ? '현재 저장된 구매 조건을 바로 표시합니다. 필요하면 공급사 최신 정보를 다시 확인할 수 있습니다.'
          : auto
            ? '공급사 캐시와 API를 이용해 기술 조건과 구매 가능 조건을 다시 확인합니다.'
            : '공급사 확인 결과는 카탈로그에 반영된 뒤 선택할 수 있습니다.' }}
      </p>
      <p v-if="supplement.isPending.value" class="mt-1 text-xs font-semibold">공급사별 상위 후보와 구매 조건을 확인하고 있습니다…</p>
      <p v-if="supplement.isSuccess.value" class="mt-1 text-xs font-semibold">
        {{ supplement.data.value?.data.catalog.status === 'completed'
          ? '공급사 확인과 카탈로그 반영을 완료했습니다.'
          : `공급사 후보 ${supplement.data.value?.data.total ?? 0}개를 확인했습니다. 카탈로그 저장은 백그라운드에서 계속됩니다.` }}
      </p>
      <p v-if="supplement.isError.value" class="mt-1 text-xs font-semibold text-red-700">
        {{ errorMessage }}
      </p>
    </div>
    <button
      v-if="canSupplement && (!auto || mode === 'mpn' || supplement.isSuccess.value || supplement.isError.value)"
      type="button"
      class="h-9 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 transition hover:border-amber-500 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="disabled || supplement.isPending.value"
      @click="requestSupplement(false)"
    >
      {{ supplement.isPending.value ? '공급사 확인 중…' : supplement.isSuccess.value ? '다시 확인' : '공급사에서 추가 확인' }}
    </button>
  </div>
</template>
