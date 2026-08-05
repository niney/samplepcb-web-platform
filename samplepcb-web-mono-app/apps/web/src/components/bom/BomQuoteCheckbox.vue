<script setup lang="ts">
import checkedIcon from '../../assets/bom/ic-checkbox-checked.svg';

const props = withDefaults(defineProps<{
  checked: boolean;
  disabled: boolean;
  indeterminate?: boolean;
  label: string;
  title?: string;
}>(), {
  indeterminate: false,
  title: '',
});

const emit = defineEmits<{
  change: [checked: boolean];
}>();

function onChange(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  emit('change', input.checked);
}
</script>

<template>
  <label class="relative inline-block size-[18px] align-middle">
    <input
      type="checkbox"
      class="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
      :checked="props.checked"
      :indeterminate.prop="props.indeterminate"
      :disabled="props.disabled"
      :aria-label="props.label"
      :title="props.title"
      @change="onChange"
    >
    <span
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 rounded-[2px] transition-[border-color,box-shadow] peer-focus-visible:ring-2 peer-focus-visible:ring-brand-soft/30 peer-focus-visible:ring-offset-1"
      :class="props.checked || props.indeterminate ? 'border border-transparent bg-[#4798FF]' : 'border border-line-soft bg-surface'"
    />
    <img
      v-if="props.checked"
      :src="checkedIcon"
      alt=""
      class="pointer-events-none absolute inset-0 size-full rounded-[2px]"
    >
    <span
      v-else-if="props.indeterminate"
      aria-hidden="true"
      class="pointer-events-none absolute left-1/2 top-1/2 h-[2px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#FEFEFE]"
    />
  </label>
</template>
