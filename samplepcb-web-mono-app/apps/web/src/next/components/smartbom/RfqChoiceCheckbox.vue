<script setup lang="ts">
import { useId } from 'vue';
import { Checkbox } from '@/next/components/ui/checkbox';

// 비교표 한 칸의 선택 표시 — 옛 components/admin/smartbom/BomRfqChoiceCheckbox.vue 의 짝(같은 props·emits).
// 한 행에서 하나만 고르는 선택(라디오 성격)이지만 모양은 체크 상자로 둔다(옛 시안 그대로) — 그래서 이미
// 고른 칸을 다시 눌러도 해제하지 않고, 새로 고를 때만 select 를 낸다. 칸의 글자(슬롯)를 눌러도 고른다.
const props = withDefaults(
  defineProps<{
    checked: boolean;
    disabled?: boolean;
    label: string;
  }>(),
  { disabled: false },
);

const emit = defineEmits<{ select: [] }>();
const id = useId();

function onUpdate(value: boolean | 'indeterminate'): void {
  if (value === true && !props.checked) emit('select');
}
</script>

<template>
  <label :for="id" class="flex items-start gap-2" :class="props.disabled ? 'cursor-wait opacity-60' : 'cursor-pointer'">
    <Checkbox
      :id="id"
      :model-value="props.checked"
      :disabled="props.disabled"
      :aria-label="props.label"
      class="mt-0.5"
      @update:model-value="onUpdate"
    />
    <slot />
  </label>
</template>
