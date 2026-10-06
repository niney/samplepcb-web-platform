<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { Button } from '@/next/components/ui/button';

// 설정 폼의 저장 줄 — 버튼 + 결과 한 줄(성공·실패). 옛 설정 폼들처럼 결과를 버튼 옆에 남긴다
// (설정 화면은 저장 뒤에도 같은 자리를 보고 있어 사라지는 토스트보다 옆 글자가 확인하기 쉽다).
// type='button' 이면 click 을 낸다(폼 안의 두 번째 저장 — BOM 견적서 담당자).
const props = withDefaults(
  defineProps<{
    pending: boolean;
    disabled?: boolean;
    saved?: boolean;
    savedText?: string;
    error?: string | null;
    label?: string;
    type?: 'submit' | 'button';
  }>(),
  { disabled: false, saved: false, savedText: '', error: null, label: '', type: 'submit' },
);
const emit = defineEmits<{ click: [] }>();
const { t } = useI18n();

const onClick = (): void => {
  if (props.type === 'button') emit('click');
};
</script>

<template>
  <div class="flex flex-wrap items-center gap-3">
    <Button :type="props.type" :disabled="props.pending || props.disabled" @click="onClick">
      {{ props.pending ? t('admin.settings.saving') : props.label !== '' ? props.label : t('admin.settings.save') }}
    </Button>
    <span v-if="props.saved" class="text-success text-sm">
      {{ props.savedText !== '' ? props.savedText : t('admin.settings.saved') }}
    </span>
    <span v-if="props.error !== null && props.error !== ''" class="text-destructive text-sm">{{ props.error }}</span>
    <slot />
  </div>
</template>
