<script setup lang="ts">
import { computed, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { useBomPartsSupplement } from '../../bom/useBom';

const props = withDefaults(defineProps<{
  query: string;
  mode: 'exact' | 'similar' | 'text';
  interpretedSpecCount: number;
  disabled?: boolean;
}>(), {
  disabled: false,
});

const supplement = useBomPartsSupplement();
const canSupplement = computed(() => props.mode === 'similar' && props.interpretedSpecCount >= 2);
const errorMessage = computed(() => {
  const reason = supplement.error.value;
  if (!(reason instanceof ApiRequestError)) return '공급사 추가 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  if (reason.payload?.error === 'SEARCH_DAILY_LIMIT') return '오늘 사용할 수 있는 공급사 추가 확인 횟수를 모두 사용했습니다.';
  if (reason.payload?.error === 'BOM_ENGINE_UNREACHABLE') return '부품 검색 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  return '공급사 추가 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
});

watch(
  () => props.query,
  () => {
    supplement.reset();
  },
);

function requestSupplement(): void {
  if (!canSupplement.value || props.disabled || supplement.isPending.value) return;
  supplement.mutate(props.query);
}
</script>

<template>
  <div
    v-if="mode !== 'text'"
    class="mt-4 flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
    :class="mode === 'exact' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-900'"
    aria-live="polite"
  >
    <div>
      <p class="font-bold">
        {{ mode === 'exact' ? `해석된 규격 ${interpretedSpecCount}개가 모두 일치하는 결과입니다.` : '모든 규격이 일치하는 부품이 없어 유사 결과를 표시합니다.' }}
      </p>
      <p v-if="mode === 'similar'" class="mt-0.5 text-xs leading-5 text-amber-800/80">
        아래 부품은 일부 규격만 맞을 수 있습니다. 공급사에서 최신 결과를 추가 확인할 수 있습니다.
      </p>
      <p v-if="supplement.isSuccess.value" class="mt-1 text-xs font-semibold">
        공급사 확인을 완료해 검색 결과를 갱신했습니다.
      </p>
      <p v-if="supplement.isError.value" class="mt-1 text-xs font-semibold text-red-700">
        {{ errorMessage }}
      </p>
    </div>
    <button
      v-if="canSupplement"
      type="button"
      class="h-9 shrink-0 rounded-lg border border-amber-300 bg-white px-3 text-xs font-bold text-amber-900 transition hover:border-amber-500 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
      :disabled="disabled || supplement.isPending.value"
      @click="requestSupplement"
    >
      {{ supplement.isPending.value ? '공급사 확인 중…' : supplement.isSuccess.value ? '다시 확인' : '공급사에서 추가 확인' }}
    </button>
  </div>
</template>
