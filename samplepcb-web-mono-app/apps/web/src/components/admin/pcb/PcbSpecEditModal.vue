<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import { ADMIN_SPEC_REVISE_BLOCK_TEXT, type AdminSpecReviseResponseType } from '@sp/api-contract';
import { useReviseSpec } from '../../../admin/useAdminQuotes';
import { fmtPcbAmount } from '../../../lib/pcb-money';
import { SPEC_ROWS } from '../../../lib/pcb-spec';

// 제작 사양 수정(P4.2, D17) — 관리자가 전 필드를 고친다(사용자 결정 2026-08-07).
//
// 사양은 **가격의 입력**이라 저장하면 서버가 재견적까지 한 번에 한다(새 견적 발급 →
// 가격 재계산 → 장바구니 동기화). 그래서 이 화면의 일은 "값을 받는 것"이 아니라
// **무엇이 달라지고 무엇이 흔들리는지 보여주는 것**이다.
//
// 거버에서 파생된 값(크기·층수·파일 개수)도 막지 않는다 — 대신 그 사실을 경고한다.
// 막는 대신 대가를 보여주는 방식은 삭제 차단 전면 해제(D14)와 같은 결이다.
const props = defineProps<{
  projectId: number;
  spec: Record<string, string | number>;
  qty: number;
  category: string;
  finalPrice: number | null;
  autoPrice: number | null;
}>();
const emit = defineEmits<{ close: []; saved: [] }>();

/** 거버 업로드에서 뽑힌 값 — 손으로 고치면 실제 파일과 어긋난 채 제조로 넘어간다. */
const GERBER_DERIVED = new Set(['width', 'length', 'layers', 'differentDesign']);

const draft = ref<Record<string, string>>(
  Object.fromEntries(
    SPEC_ROWS.map((r) => [r.key, String(props.spec[r.key] ?? '')]),
  ),
);
// 사전에 없는 키(레거시·확장)도 그대로 실어 보낸다 — 여기서 조용히 버리면 사양이 손실된다.
const extraKeys = Object.keys(props.spec).filter(
  (k) => !k.startsWith('_') && !SPEC_ROWS.some((r) => r.key === k),
);
for (const k of extraKeys) draft.value[k] = String(props.spec[k] ?? '');

const qtyDraft = ref(String(props.qty));
const reason = ref('');
const result = ref<AdminSpecReviseResponseType['data'] | null>(null);
const error = ref('');

const reviseMut = useReviseSpec();

const rows = computed(() => [
  ...SPEC_ROWS.map((r) => ({ key: r.key, label: r.label })),
  ...extraKeys.map((k) => ({ key: k, label: k })),
]);

/** 지금 무엇이 달라졌나 — 저장 전에 보여준다(사양은 값이 많아 놓치기 쉽다). */
const changed = computed(() =>
  rows.value
    .filter((r) => String(props.spec[r.key] ?? '') !== draft.value[r.key])
    .map((r) => ({
      key: r.key,
      label: r.label,
      before: String(props.spec[r.key] ?? '') === '' ? '—' : String(props.spec[r.key] ?? ''),
      after: draft.value[r.key] === '' ? '—' : draft.value[r.key],
      gerber: GERBER_DERIVED.has(r.key),
    })),
);
const qtyChanged = computed(() => Number(qtyDraft.value) !== props.qty);
const touchedGerber = computed(() => changed.value.some((c) => c.gerber));

const canSave = computed(
  () =>
    (changed.value.length > 0 || qtyChanged.value) &&
    reason.value.trim().length >= 2 &&
    Number(qtyDraft.value) > 0 &&
    !reviseMut.isPending.value,
);

async function save(): Promise<void> {
  if (!canSave.value) return;
  error.value = '';
  // 빈 값은 키 자체를 뺀다 — 빈 문자열을 남기면 사양에 유령 키가 쌓인다.
  const spec: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.value)) {
    if (v.trim() !== '') spec[k] = v.trim();
  }
  try {
    const res = await reviseMut.mutateAsync({
      projectId: props.projectId,
      body: {
        spec,
        ...(qtyChanged.value ? { qty: Number(qtyDraft.value) } : {}),
        reason: reason.value.trim(),
      },
    });
    result.value = res.data;
    emit('saved');
  } catch (e) {
    if (e instanceof ApiRequestError) {
      const code = e.payload?.error;
      error.value =
        code === 'PO_ISSUED' || code === 'REQUOTE_RFQ_IN_CART'
          ? ADMIN_SPEC_REVISE_BLOCK_TEXT[code]
          : (e.payload?.message ?? '저장에 실패했습니다.');
    } else {
      error.value = '저장에 실패했습니다.';
    }
  }
}
</script>

<template>
  <div class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="w-full max-w-3xl overflow-hidden rounded-xl bg-surface shadow-xl">
      <header class="border-b border-gray-200 px-5 py-4">
        <p class="text-[11px] font-bold uppercase tracking-wider text-blue-600">제작 사양 수정</p>
        <h3 class="mt-0.5 text-base font-bold text-gray-900">{{ category }} · Q{{ projectId }}</h3>
        <p class="mt-1 text-xs text-gray-500">
          저장하면 <b class="text-gray-700">견적이 새로 발급되고 가격이 다시 계산</b>됩니다.
          이전 사양은 견적 이력에 그대로 남습니다.
        </p>
      </header>

      <!-- ③ 결과 -->
      <template v-if="result !== null">
        <div class="max-h-[70vh] space-y-3 overflow-y-auto px-5 py-4">
          <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <p class="font-extrabold">사양을 수정했습니다 — {{ result.changedKeys.length }}개 항목</p>
            <p class="mt-1 text-xs">새 견적 {{ result.quoteId.slice(0, 8) }}… 발급</p>
          </div>

          <div class="rounded-lg border border-gray-200 p-4">
            <p class="text-xs font-bold text-gray-500">자동견적가</p>
            <p class="mt-1 text-sm tabular-nums">
              <span class="text-gray-400 line-through">{{ fmtPcbAmount('KRW', result.previousAutoPrice) }}</span>
              <span class="mx-2 text-gray-300">→</span>
              <b :class="result.autoPrice === null ? 'text-amber-700' : 'text-gray-900'">
                {{ result.autoPrice === null ? '자동견적 불가 — 확정가를 매겨야 합니다' : fmtPcbAmount('KRW', result.autoPrice) }}
              </b>
            </p>
          </div>

          <p v-if="result.finalPriceStale" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            ⚠ 확정가의 근거가 된 사양이 바뀌었습니다 — 확정가를 다시 매겨 주세요.
          </p>
          <p v-if="result.answeredRfqCount > 0" class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            ⚠ 이미 회신받은 협력사 견적이 {{ result.answeredRfqCount }}건 있습니다 — 바뀐 사양으로 재확인이 필요합니다.
          </p>
        </div>
        <footer class="flex justify-end border-t border-gray-200 px-5 py-3">
          <button type="button" class="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-bold text-white hover:bg-black" @click="emit('close')">닫기</button>
        </footer>
      </template>

      <!-- ① 편집 -->
      <template v-else>
        <div class="max-h-[62vh] overflow-y-auto px-5 py-4">
          <label class="block max-w-[200px]">
            <span class="text-[11px] font-semibold text-gray-500">수량 (매)</span>
            <input v-model="qtyDraft" type="number" min="1" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm tabular-nums focus:border-blue-500 focus:outline-none">
          </label>

          <div class="mt-4 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            <label
              v-for="row in rows"
              :key="row.key"
              class="block"
            >
              <span class="text-[11px] font-semibold" :class="GERBER_DERIVED.has(row.key) ? 'text-amber-700' : 'text-gray-500'">
                {{ row.label }}
                <span v-if="GERBER_DERIVED.has(row.key)" title="거버 파일에서 뽑은 값입니다">⚠</span>
              </span>
              <input
                v-model="draft[row.key]"
                type="text"
                class="mt-1 w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none"
                :class="String(spec[row.key] ?? '') !== draft[row.key]
                  ? 'border-blue-400 bg-blue-50/50 focus:border-blue-500'
                  : 'border-gray-300 focus:border-blue-500'"
              >
            </label>
          </div>
        </div>

        <div class="border-t border-gray-200 px-5 py-4">
          <!-- 변경 요약 — 사양은 값이 많아 무엇을 건드렸는지 놓치기 쉽다 -->
          <div v-if="changed.length > 0 || qtyChanged" class="rounded-lg border border-blue-200 bg-blue-50/60 p-3">
            <p class="text-xs font-bold text-blue-800">
              변경 {{ changed.length + (qtyChanged ? 1 : 0) }}건
            </p>
            <ul class="mt-1.5 space-y-0.5 text-xs">
              <li v-if="qtyChanged" class="text-gray-700">
                <b>수량</b> <span class="text-gray-400">{{ qty }}</span> → <b>{{ qtyDraft }}</b>
              </li>
              <li v-for="c in changed" :key="c.key" :class="c.gerber ? 'text-amber-800' : 'text-gray-700'">
                <b>{{ c.label }}</b>
                <span class="text-gray-400"> {{ c.before }}</span> → <b>{{ c.after }}</b>
                <span v-if="c.gerber" class="ml-1 rounded bg-amber-100 px-1 text-[10px] font-bold">거버 파생</span>
              </li>
            </ul>
          </div>

          <p v-if="touchedGerber" class="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold leading-5 text-amber-900">
            ⚠ 거버 파일에서 뽑은 값을 고쳤습니다. 화면 사양과 실제 거버가 어긋난 채로 제조에 넘어갈 수
            있습니다 — 파일이 바뀐 것이라면 거버를 다시 받는 편이 안전합니다.
          </p>
          <p v-if="finalPrice !== null" class="mt-2 text-xs text-gray-500">
            확정가 {{ fmtPcbAmount('KRW', finalPrice) }} 가 매겨져 있습니다 — 사양이 바뀌면 다시 매겨야 합니다.
          </p>

          <label class="mt-3 block">
            <span class="text-[11px] font-semibold text-gray-500">수정 사유 <span class="text-red-600">필수</span></span>
            <input v-model="reason" type="text" maxlength="1000" placeholder="예) 고객 요청 — 표면처리 무연HASL → OSP 변경" class="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none">
          </label>

          <p v-if="error !== ''" class="mt-2 text-sm font-semibold text-red-600">{{ error }}</p>

          <div class="mt-3 flex justify-end gap-2">
            <button type="button" class="rounded-md border border-gray-200 px-3 py-1.5 text-sm" @click="emit('close')">취소</button>
            <button
              type="button"
              class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-40"
              :disabled="!canSave"
              @click="void save()"
            >
              {{ reviseMut.isPending.value ? '저장 중…' : '저장하고 재견적' }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
