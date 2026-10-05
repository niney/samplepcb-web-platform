<script setup lang="ts">
import { CheckIcon, MinusIcon } from '@lucide/vue';
import { Checkbox } from '@/next/components/ui/checkbox';

// 표 선택 체크박스 — 행용과 머리(전체 선택)용 공용. 머리는 부분 선택이면 'indeterminate'.
// 클릭이 행 클릭(상세 열기)으로 번지지 않게 막는다.
defineProps<{
  checked: boolean | 'indeterminate';
  label: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{ change: [checked: boolean] }>();
</script>

<template>
  <Checkbox
    :model-value="checked"
    :aria-label="label"
    :disabled="disabled === true"
    @click.stop
    @update:model-value="emit('change', $event === true)"
  >
    <template #default="{ state }">
      <MinusIcon v-if="state === 'indeterminate'" class="size-3.5" />
      <CheckIcon v-else class="size-3.5" />
    </template>
  </Checkbox>
</template>
