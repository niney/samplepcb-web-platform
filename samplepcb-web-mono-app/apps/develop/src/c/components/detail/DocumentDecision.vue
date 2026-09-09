<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DEVELOP_DOC_DECISION_OPTIONS } from '@sp/api-contract/develop-c';
import type { DevelopDocDecisionType, DevelopDocTypeType } from '@sp/api-contract/develop-c';

// 문서 결정 패널(docs/DEVELOP_FLOW.md §13) — 승인형 문서의 `sent` 판에만 뜬다.
// 선택지 문안·순서는 계약(DEVELOP_DOC_DECISION_OPTIONS[type])이 정본이라 화면이 새로 적지 않는다.
// 결정은 **동의 기록**이라(서버가 시각·IP·이름을 남긴다) 견적 수락과 같은 관문을 둔다: 확인 체크 + 이름.
// 2택 전용 DecisionPanel.vue 를 재사용하지 않는 이유 = 선택지가 문서 종류마다 3~4개다.
const props = defineProps<{
  type: DevelopDocTypeType;
  defaultName: string;
  pending: boolean;
  error: string;
}>();
const emit = defineEmits<{ submit: [{ decision: DevelopDocDecisionType; note: string; name: string }] }>();

const options = computed(() => DEVELOP_DOC_DECISION_OPTIONS[props.type]);
// 되돌릴 수 없는 회신이라 기본 선택을 두지 않는다 — 고객이 직접 고른 것만 보낸다.
const decision = ref<DevelopDocDecisionType | null>(null);
const note = ref('');
const name = ref(props.defaultName);
const agree = ref(false);

watch(
  () => props.defaultName,
  (v) => {
    if (name.value.trim() === '') name.value = v;
  },
);

const canSubmit = computed(() => decision.value !== null && agree.value && name.value.trim() !== '' && !props.pending);

// 납품확인서만 결정이 의뢰 상태를 바꾼다 — 무엇이 일어나는지 고르기 전에 알려 준다.
const hint = computed(() =>
  props.type === 'delivery_confirm'
    ? '납품 승인을 보내시면 개발이 완료되고 잔금 결제가 열립니다. 보완 후 승인을 고르시면 담당자가 재작업합니다.'
    : '',
);

function submit(): void {
  const d = decision.value;
  if (d === null || !canSubmit.value) return;
  emit('submit', { decision: d, note: note.value, name: name.value.trim() });
}
</script>

<template>
  <div class="grid gap-3 rounded-xl border-2 border-brand-500 bg-brand-50/50 p-4 sm:p-5">
    <p class="text-body font-extrabold text-tx-1">이 문서에 회신해 주세요</p>
    <p v-if="hint !== ''" class="text-label leading-relaxed text-tx-2">{{ hint }}</p>

    <div class="grid gap-1.5" role="radiogroup">
      <label
        v-for="o in options"
        :key="o.code"
        class="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-white px-3.5 py-2.5 text-body text-tx-1 transition"
        :class="decision === o.code ? 'border-brand-500 ring-1 ring-brand-500' : 'border-line-2 hover:border-tx-3'"
      >
        <input v-model="decision" type="radio" :value="o.code" class="mt-1 h-4 w-4 shrink-0 accent-current">
        <span class="font-semibold">{{ o.label }}</span>
      </label>
    </div>

    <label class="grid gap-1.5">
      <span class="text-label font-semibold text-tx-2">담당자에게 전할 의견 (선택)</span>
      <textarea
        v-model="note"
        rows="2"
        maxlength="2000"
        placeholder="조건·보완 사항이 있으면 적어 주세요"
        class="w-full resize-y rounded-lg border border-line-2 bg-white px-3.5 py-2.5 text-body leading-relaxed text-tx-1"
      />
    </label>

    <label class="grid gap-1.5">
      <span class="text-label font-semibold text-tx-2">회신하시는 분 성함</span>
      <input
        v-model="name"
        type="text"
        maxlength="100"
        placeholder="성함"
        class="h-11 max-w-xs rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1"
      >
    </label>

    <label class="flex cursor-pointer items-start gap-2.5 text-body text-tx-1">
      <input v-model="agree" type="checkbox" class="mt-1 h-4 w-4 shrink-0 accent-current">
      <span>문서 내용을 확인했으며 위 결정을 담당자에게 전달합니다</span>
    </label>

    <p v-if="error !== ''" class="text-body font-semibold text-red-700">{{ error }}</p>

    <div>
      <button
        type="button"
        class="h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ pending ? '보내는 중…' : '회신 보내기' }}
      </button>
    </div>
  </div>
</template>
