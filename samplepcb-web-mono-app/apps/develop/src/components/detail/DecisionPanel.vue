<script setup lang="ts">
import { ref } from 'vue';

// 두 갈래 결정(승인/수정 요청 · 검수 확정/수정 요청)을 위한 인라인 패널.
// 네이티브 confirm 은 쓰지 않는다(브라우저 자동화가 멈춘다) — 메모는 선택, 두 버튼은 같은 무게로 둔다.
// 실제 호출·에러 문구는 부모가 갖고, 여기는 메모 입력과 눌린 갈래만 올린다.
withDefaults(
  defineProps<{
    primaryLabel: string;
    secondaryLabel: string;
    notePlaceholder?: string;
    pending?: boolean;
    error?: string;
    hint?: string;
  }>(),
  { notePlaceholder: '전할 말씀이 있으면 적어 주세요 (선택)', pending: false, error: '', hint: '' },
);
const emit = defineEmits<{ decide: ['primary' | 'secondary', string] }>();

const note = ref('');
</script>

<template>
  <div class="grid gap-3 rounded-xl border border-line-2 bg-paper p-4">
    <p v-if="hint !== ''" class="text-label leading-relaxed text-tx-2">{{ hint }}</p>
    <textarea
      v-model="note"
      rows="2"
      maxlength="2000"
      :placeholder="notePlaceholder"
      class="w-full resize-y rounded-lg border border-line-2 bg-white px-3.5 py-2.5 text-body leading-relaxed text-tx-1"
    />
    <p v-if="error !== ''" class="text-body font-semibold text-red-700">{{ error }}</p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        class="h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
        :disabled="pending"
        @click="emit('decide', 'primary', note)"
      >
        {{ primaryLabel }}
      </button>
      <button
        type="button"
        class="h-10 rounded-lg border border-line-2 bg-white px-5 text-label font-bold text-tx-2 transition hover:border-tx-3 disabled:opacity-50"
        :disabled="pending"
        @click="emit('decide', 'secondary', note)"
      >
        {{ secondaryLabel }}
      </button>
    </div>
  </div>
</template>
