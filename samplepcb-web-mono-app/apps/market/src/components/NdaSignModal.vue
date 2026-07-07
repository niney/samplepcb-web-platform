<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  open: boolean;
  ndaText: string;
  ndaVersion: string;
  pending: boolean;
  error: string;
}>();
const emit = defineEmits<{ close: []; sign: [signedName: string] }>();

const signedName = ref('');
const agree = ref(false);

function submit(): void {
  if (!agree.value || signedName.value.trim().length < 2 || props.pending) return;
  emit('sign', signedName.value.trim());
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <p class="font-mono text-[11px] tracking-widest text-tx-3">NDA · {{ ndaVersion }}</p>
      <h2 class="mt-1 text-lg font-extrabold text-tx-1">비밀유지 전자서명</h2>
      <p class="mt-3 rounded-xl bg-paper p-4 text-xs leading-relaxed text-tx-2">
        {{ ndaText }}
      </p>
      <label class="mt-4 grid gap-1.5 text-xs font-bold text-tx-2">
        서명자 성명 <span class="text-red-500">*</span>
        <input
          v-model="signedName"
          type="text"
          placeholder="실명 입력"
          class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
        >
      </label>
      <label class="mt-3 flex items-start gap-2 text-xs leading-relaxed text-tx-2">
        <input v-model="agree" type="checkbox" class="mt-0.5">
        <span>위 내용을 확인했으며 전자서명에 동의합니다. (서명 일시·성명이 기록됩니다)</span>
      </label>
      <p v-if="error !== ''" class="mt-3 text-xs font-semibold text-red-600">{{ error }}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-lg border border-line px-4 py-2 text-xs font-bold text-tx-2 hover:border-line-2"
          @click="emit('close')"
        >
          닫기
        </button>
        <button
          type="button"
          class="rounded-lg bg-ink-900 px-4 py-2 text-xs font-bold text-white hover:bg-ink-800 disabled:opacity-40"
          :disabled="!agree || signedName.trim().length < 2 || pending"
          @click="submit"
        >
          {{ pending ? '서명 중…' : '서명하고 열람하기' }}
        </button>
      </div>
    </div>
  </div>
</template>
