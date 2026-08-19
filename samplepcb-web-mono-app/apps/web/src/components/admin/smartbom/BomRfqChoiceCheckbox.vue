<script setup lang="ts">
import checkedIcon from '../../../assets/bom/ic-checkbox-checked.svg';

withDefaults(defineProps<{
  checked: boolean;
  disabled?: boolean;
  label: string;
}>(), {
  disabled: false,
});

const emit = defineEmits<{ select: [] }>();

function onChange(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement) || !input.checked) return;
  emit('select');
}
</script>

<template>
  <label
    class="group flex items-start gap-2"
    :class="disabled ? 'cursor-wait opacity-55' : 'cursor-pointer'"
  >
    <span class="relative mt-0.5 block size-[18px] shrink-0">
      <input
        type="radio"
        class="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0 disabled:cursor-wait"
        :checked="checked"
        :disabled="disabled"
        :aria-label="label"
        @change="onChange"
      >
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 rounded-[4px] border bg-white shadow-sm transition-[border-color,background-color,box-shadow,transform] peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500/30 peer-focus-visible:ring-offset-2"
        :class="[
          checked
            ? 'border-blue-600 bg-blue-600 shadow-[0_1px_3px_rgba(37,99,235,0.28)]'
            : 'border-gray-300',
          disabled ? '' : 'group-hover:scale-[1.03] group-hover:border-blue-400',
        ]"
      />
      <img
        v-if="checked"
        :src="checkedIcon"
        alt=""
        class="pointer-events-none absolute inset-0 size-full rounded-[4px]"
      >
    </span>
    <slot />
  </label>
</template>
