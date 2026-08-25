<script setup lang="ts">
import checkedIcon from '../../assets/bom/ic-checkbox-checked.svg';

defineProps<{
  checked: boolean;
  disabled: boolean;
  label: string;
}>();

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
      class="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-wait"
      :checked="checked"
      :disabled="disabled"
      :aria-label="label"
      @change="onChange"
    >
    <span
      aria-hidden="true"
      class="pointer-events-none absolute inset-0 rounded-[2px] border border-line-soft bg-search-row transition-[border-color,box-shadow,opacity] peer-hover:border-brand-soft peer-focus-visible:ring-2 peer-focus-visible:ring-brand-soft/30 peer-focus-visible:ring-offset-1 peer-focus-visible:ring-offset-search-row peer-checked:border-transparent peer-disabled:opacity-50"
    />
    <img
      :src="checkedIcon"
      alt=""
      class="pointer-events-none absolute inset-0 size-full rounded-[2px] transition-opacity"
      :class="{
        'opacity-0': !checked,
        'opacity-50': checked && disabled,
        'opacity-100': checked && !disabled,
      }"
    >
  </label>
</template>
