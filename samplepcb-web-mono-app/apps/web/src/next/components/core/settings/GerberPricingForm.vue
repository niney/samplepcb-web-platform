<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { GerberPriceModeType } from '@sp/api-contract';
import { useGerberPricing, useSaveGerberPricing } from '@/admin/useAdminSettings';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { Field, FieldContent, FieldDescription, FieldLabel, FieldTitle } from '@/next/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/next/components/ui/radio-group';
import { Spinner } from '@/next/components/ui/spinner';
import SaveRow from './SaveRow.vue';

// 거버 가격 해석 모드 — order(주문가=부가세 포함) | supply(공급가=부가세 별도, 서버가 ×1.1 정규화).
// sp_config gerber_price_mode 1키. 옛 components/admin/GerberPricingForm.vue 와 같은 저장 본문.
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

// RadioGroup 값은 AcceptableValue 라 사전에 있는 값으로 좁혀 받는다.
const onPick = (value: unknown): void => {
  const hit = MODES.find((mode) => mode === value);
  if (hit !== undefined) selected.value = hit;
};

const onSubmit = (): void => {
  save({ mode: selected.value });
};
</script>

<template>
  <form class="max-w-2xl" @submit.prevent="onSubmit">
    <SectionCard :title="t('admin.settings.tabs.gerberPricing')">
      <p v-if="isLoading" class="text-muted-foreground inline-flex items-center gap-2 text-sm">
        <Spinner />
        {{ t('admin.settings.loading') }}
      </p>
      <template v-else>
        <p class="text-muted-foreground text-sm">{{ t('admin.settings.gerberPricing.intro') }}</p>
        <RadioGroup :model-value="selected" @update:model-value="onPick">
          <FieldLabel v-for="mode in MODES" :key="mode" :for="`gerber-mode-${mode}`">
            <Field orientation="horizontal">
              <RadioGroupItem :id="`gerber-mode-${mode}`" :value="mode" />
              <FieldContent>
                <FieldTitle>{{ t(`admin.settings.gerberPricing.modes.${mode}.label`) }}</FieldTitle>
                <FieldDescription>{{ t(`admin.settings.gerberPricing.modes.${mode}.desc`) }}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        </RadioGroup>
        <SaveRow class="border-t pt-3" :pending="isPending" :saved="isSuccess" />
      </template>
    </SectionCard>
  </form>
</template>
