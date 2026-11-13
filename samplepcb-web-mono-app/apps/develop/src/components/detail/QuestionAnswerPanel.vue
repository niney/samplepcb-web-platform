<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { DEVELOP_QUESTION_ANSWER_MAX } from '@sp/api-contract';
import type { DeckQuestion } from '../../lib/deck-content';

// 확인이 필요한 사항에 고객이 직접 답하는 판(docs/DEVELOP_FLOW.md §7.2.13) — 장의 답변 칸에서 '답변하기'를 누르면 오른쪽에서 나온다.
// 장 안에 입력 칸을 두지 않는 까닭: 장은 높이가 고정이라 글 길이에 따라 넘친다. 여기서 그 묶음의 문항을 한 번에 답하고, 저장하면
// 장의 답변 칸에 '고객 답변'으로 찍힌다(높이는 다시 재어 배분한다).
// 담당자가 확인 결과를 적은 문항은 잠긴다 — 답과 확인 결과를 읽기만 한다. 답은 필수가 아니라 비워 둔 문항은 그대로 둔다.
// 바뀐 문항만 보낸다(빈 답 = 지움). 쓰던 글이 있으면 바깥을 누르거나 Esc 로는 닫히지 않는다('닫기' 단추만).
const props = withDefaults(
  defineProps<{
    open: boolean;
    questions: DeckQuestion[];
    focusQid?: string | null; // 열 때 커서를 둘 문항
    pending?: boolean;
    error?: string;
  }>(),
  { focusQid: null, pending: false, error: '' },
);
const emit = defineEmits<{ close: []; submit: [{ qid: string; answer: string }[]] }>();

const drafts = ref<Record<string, string>>({});
const panel = ref<HTMLElement | null>(null);
const draftOf = (q: DeckQuestion): string => drafts.value[q.qid] ?? q.answer;
function setDraft(qid: string, value: string): void {
  drafts.value = { ...drafts.value, [qid]: value };
}
const changed = computed(() =>
  props.questions
    .filter((q) => q.resolution === '' && draftOf(q).trim() !== q.answer)
    .map((q) => ({ qid: q.qid, answer: draftOf(q).trim() })),
);
const dirty = computed(() => changed.value.length > 0);

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !dirty.value && !props.pending) emit('close');
}
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      window.removeEventListener('keydown', onKey);
      return;
    }
    drafts.value = {};
    window.addEventListener('keydown', onKey);
    await nextTick();
    const fields = [...(panel.value?.querySelectorAll<HTMLTextAreaElement>('textarea[data-qid]') ?? [])];
    (fields.find((el) => el.dataset.qid === props.focusQid) ?? fields[0])?.focus();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});

function closeOutside(): void {
  if (!dirty.value && !props.pending) emit('close');
}
function save(): void {
  if (!dirty.value || props.pending) return;
  emit('submit', changed.value);
}
const BTN = 'flex h-[38px] items-center justify-center rounded-[6px] px-[16px] text-[14px] leading-[1.3] transition disabled:opacity-40';
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex justify-end bg-black/40" data-deck-overlay="answers" @click.self="closeOutside">
      <aside ref="panel" class="flex h-full w-full max-w-[560px] flex-col bg-white text-[#141e34] shadow-2xl" aria-label="확인이 필요한 사항 답변">
        <div class="flex items-center justify-between gap-6 border-b border-line px-6 py-4">
          <p class="text-[18px] font-bold">확인이 필요한 사항 답변</p>
          <button type="button" class="h-[34px] rounded-[6px] border border-line-2 px-[12px] text-[14px] hover:bg-brand-50" :disabled="pending" @click="emit('close')">
            닫기 ✕
          </button>
        </div>
        <p class="border-b border-line bg-brand-50 px-6 py-3 text-[15px] leading-[1.6] text-[#3b4558]">
          아는 만큼만 적어 주세요. 비워 두셔도 되고, 나머지는 상담에서 함께 정합니다. 담당자가 확인 결과를 적은 문항은 더 고칠 수 없습니다.
        </p>
        <div class="flex min-h-0 flex-1 flex-col gap-[24px] overflow-y-auto px-6 py-5">
          <div v-for="q in questions" :key="q.qid" class="flex flex-col gap-[8px]" :data-question="q.qid">
            <p class="flex gap-[8px] text-[17px] font-bold leading-[1.45]">
              <span class="shrink-0 tabular-nums">{{ q.no }}.</span><span class="min-w-0">{{ q.question }}</span>
            </p>
            <p v-if="q.why !== ''" class="text-[14px] leading-[1.5] text-tx-2">{{ q.why }}</p>
            <template v-if="q.resolution !== ''">
              <p v-if="q.answer !== ''" class="flex gap-[10px] rounded-[4px] border border-line-2 px-[14px] py-[10px] text-[15px] leading-[1.55]">
                <span class="shrink-0 font-bold text-[#3b4558]">고객 답변</span><span class="min-w-0 whitespace-pre-line">{{ q.answer }}</span>
              </p>
              <p class="flex gap-[10px] rounded-[4px] border border-brand-200 bg-brand-50 px-[14px] py-[10px] text-[15px] leading-[1.55]">
                <span class="shrink-0 font-bold text-brand-600">확인 결과</span><span class="min-w-0 whitespace-pre-line">{{ q.resolution }}</span>
              </p>
            </template>
            <textarea
              v-else
              :value="draftOf(q)"
              :data-qid="q.qid"
              rows="3"
              :maxlength="DEVELOP_QUESTION_ANSWER_MAX"
              placeholder="답변을 적어 주세요"
              :aria-label="`${String(q.no)}번 답변`"
              class="w-full resize-y rounded-[6px] border border-line-2 px-[14px] py-[10px] text-[16px] leading-[1.6] outline-none focus:border-brand-600"
              @input="setDraft(q.qid, ($event.target as HTMLTextAreaElement).value)"
            />
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-[10px] border-t border-line px-6 py-4">
          <button type="button" class="bg-[#141e34] font-medium text-white hover:opacity-85" :class="BTN" :disabled="!dirty || pending" @click="save">
            {{ pending ? '저장 중…' : '답변 저장' }}
          </button>
          <button type="button" class="border border-line-2 bg-white hover:bg-brand-50" :class="BTN" :disabled="pending" @click="emit('close')">그만두기</button>
          <p v-if="error !== ''" role="alert" class="w-full text-[14px] font-semibold text-red-700">{{ error }}</p>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
