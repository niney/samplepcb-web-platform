<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GerberPriceModeType } from '@sp/api-contract';
import { useGerberPricing, useSaveGerberPricing } from '../../admin/useAdminSettings';

// 거버 가격 해석 모드 폼 — order(주문가=부가세 포함) | supply(공급가=부가세 별도, 서버가
// ×1.1 정규화). sp_config gerber_price_mode 1키. 라디오 선택 후 저장(사업자정보 폼 관례).
const { t } = useI18n();
const { data, isLoading } = useGerberPricing();
const { mutate: save, isPending, isSuccess } = useSaveGerberPricing();

const MODES: GerberPriceModeType[] = ['order', 'supply'];
const selected = ref<GerberPriceModeType>('order');

// 로드/재조회(저장 에코 포함) 시 선택 리필.
watch(
  () => data.value?.data.mode,
  (mode) => {
    if (mode) selected.value = mode;
  },
  { immediate: true },
);

const onSubmit = (): void => {
  save({ mode: selected.value });
};
</script>

<template>
  <form class="max-w-2xl space-y-4" @submit.prevent="onSubmit">
    <p v-if="isLoading" class="text-sm text-gray-500">{{ t('admin.settings.loading') }}</p>
    <template v-else>
      <p class="text-sm text-gray-600">{{ t('admin.settings.gerberPricing.intro') }}</p>
      <div class="space-y-2">
        <label
          v-for="mode in MODES"
          :key="mode"
          class="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-gray-50"
          :class="selected === mode ? 'border-blue-500 bg-blue-50' : 'border-gray-200'"
        >
          <input v-model="selected" type="radio" :value="mode" class="mt-1">
          <span>
            <span class="block text-sm font-medium text-gray-800">
              {{ t(`admin.settings.gerberPricing.modes.${mode}.label`) }}
            </span>
            <span class="mt-0.5 block text-xs text-gray-500">
              {{ t(`admin.settings.gerberPricing.modes.${mode}.desc`) }}
            </span>
          </span>
        </label>
      </div>

      <div class="flex items-center gap-3 pt-2">
        <button
          type="submit"
          :disabled="isPending"
          class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {{ isPending ? t('admin.settings.saving') : t('admin.settings.save') }}
        </button>
        <span v-if="isSuccess" class="text-sm text-green-600">{{ t('admin.settings.saved') }}</span>
      </div>
    </template>
  </form>
</template>
