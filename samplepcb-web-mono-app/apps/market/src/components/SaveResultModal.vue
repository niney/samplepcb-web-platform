<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

// 의뢰 수정 저장 결과(docs/MARKET_FLOW.md §11.5) — 저장이 편집의 끝이 되게 하는 모달.
// 무슨 일이 일어났는지(버전·입찰자 경고·마감 자동 연장) + 다음 한 걸음(검토서 갱신)만 담고,
// **두 버튼 모두 상세로 나간다** — 시작한 곳과 결과를 보는 곳을 같게 만든다.
// 알릴 것이 없으면(검토서가 없거나 낡지 않았으면) 부모가 이 모달을 아예 띄우지 않는다.
// 배경 클릭·ESC 는 **닫기만** 한다(상세로 가지 않는다) — 실수 클릭이 "나중에" 를 대신 고르지 않게.
// 닫힌 뒤엔 편집 폼에 그대로 남는다(저장은 이미 끝났으니 다시 저장하면 "바뀐 내용 없음").
const props = defineProps<{
  open: boolean;
  revNo: number | null; // null = 저장은 했지만 바뀐 게 없어 판이 안 남았다
  major: boolean;
  deadlineExtendedTo: string | null; // KST 날짜 문자열(부모가 변환)
  reviewStale: boolean;
  pending: boolean;
}>();
const emit = defineEmits<{ regenerate: [alsoDiagram: boolean]; later: []; dismiss: [] }>();

const alsoDiagram = ref(false);

// ESC — 컨테이너는 포커스를 못 받으니 창에서 듣는다(열려 있는 동안만). 요청 중엔 닫지 않는다.
const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && props.open && !props.pending) emit('dismiss');
};
watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown);
    else window.removeEventListener('keydown', onKeydown);
  },
);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
// 제목 아래 덧붙일 말이 없으면 한 줄짜리 머리글이 된다 — 그때는 아이콘과 제목을 세로 가운데로.
const hasNotes = computed(() => props.major || props.deadlineExtendedTo !== null);

// 열리면 포커스를 안으로 — 키보드 사용자가 뒤의 폼에 남지 않게(주 동작 버튼, 없으면 유일한 버튼).
const primaryBtn = ref<HTMLButtonElement | null>(null);
const laterBtn = ref<HTMLButtonElement | null>(null);
watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    (primaryBtn.value ?? laterBtn.value)?.focus();
  },
);
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/60 p-4"
    @click.self="!pending && emit('dismiss')"
  >
    <div role="dialog" aria-modal="true" aria-labelledby="save-result-title" class="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
      <div class="flex gap-3" :class="hasNotes ? 'items-start' : 'items-center'">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-body"
          :class="revNo === null ? 'bg-paper text-tx-3' : 'bg-emerald-100 text-emerald-700'"
        >{{ revNo === null ? '–' : '✓' }}</span>
        <div class="min-w-0">
          <h2 id="save-result-title" class="text-title font-extrabold text-tx-1">
            {{ revNo === null ? '바뀐 내용이 없어 그대로입니다' : `수정했습니다 — v${revNo}` }}
          </h2>
          <ul v-if="hasNotes" class="mt-1.5 grid gap-1 text-label leading-relaxed text-tx-2">
            <li v-if="major">· 견적을 낸 전문가 화면에 “의뢰가 바뀌었다” 경고가 표시됩니다.</li>
            <li v-if="deadlineExtendedTo !== null">
              · 마감이 임박해 <b class="text-tx-1">{{ deadlineExtendedTo }}</b> 로 자동 연장했습니다.
            </li>
          </ul>
        </div>
      </div>

      <!-- 다음 한 걸음 — 검토서가 낡았을 때만 -->
      <div v-if="reviewStale" class="mt-5 grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <div>
          <p class="text-body font-bold">AI 사전 검토서를 바뀐 내용으로 다시 만들까요?</p>
          <p class="text-label leading-relaxed">나중에 상세 화면에서도 만들 수 있습니다.</p>
        </div>
        <label class="flex items-center gap-2 text-label font-semibold">
          <input v-model="alsoDiagram" type="checkbox">
          시스템 구성도도 함께 <span class="font-normal">(5~10분, 완성되면 알림)</span>
        </label>
      </div>

      <div class="mt-6 flex flex-wrap justify-end gap-2">
        <button
          ref="laterBtn"
          type="button"
          class="h-10 rounded-lg border border-line-2 px-4 text-body font-bold text-tx-2 transition hover:border-tx-3"
          :disabled="pending"
          @click="emit('later')"
        >
          {{ reviewStale ? '나중에 · 상세로' : '상세로 이동' }}
        </button>
        <button
          v-if="reviewStale"
          ref="primaryBtn"
          type="button"
          class="h-10 rounded-lg bg-copper-500 px-4 text-body font-bold text-white transition hover:bg-copper-600 disabled:opacity-40"
          :disabled="pending"
          @click="emit('regenerate', alsoDiagram)"
        >
          {{ pending ? '요청 중…' : '검토서 다시 만들고 상세로' }}
        </button>
      </div>
    </div>
  </div>
</template>
