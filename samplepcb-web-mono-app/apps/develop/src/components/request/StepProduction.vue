<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  DEVELOP_DELIVERY_FORMS,
  DEVELOP_DELIVERY_FORM_LABELS,
  DEVELOP_PRODUCTION_SCOPES,
  DEVELOP_PRODUCTION_SCOPE_LABELS,
  DEVELOP_PROTOTYPE_MODES,
  DEVELOP_PROTOTYPE_MODE_LABELS,
  DEVELOP_SOURCING_MODES,
  DEVELOP_SOURCING_MODE_LABELS,
} from '@sp/api-contract';
import type { DevelopProductionScopeType, DevelopPrototypeModeType } from '@sp/api-contract';
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import { WIZ, chipClass } from '../../lib/wizard-copy';
import icoSelect from '../../assets/wizard/ico-select.svg';

// 위저드 4스텝 — 제작 계획. 피그마 01-4(70:12282, 900 폭): 시제품 수량 칩(제작 없음·수량 미정·직접 입력 + 수량 칸) ·
// 제작 범위 칩 · 자재 조달·납품 형태 선택 상자(2열) · 연간 생산수량 입력. 이 값이 견적서 '별도 실비'의 근거가 된다.
// '직접 입력'은 디자인 체크리스트(10-30, 기타와 같은 순서)대로: 칩을 누르면 옆에 수량 칸이 열리고, 입력을 마치면(Enter·칸 밖)
// 칩이 'N개'로 바뀐다. 다시 누르면 고치고, 비우고 마치면 직접 입력을 푼다(Esc 는 취소) — 01-4 시안은 수량 칸이 늘 보였다.
// 자재 조달·납품 형태는 제작 범위를 하나라도 골랐을 때만 묻는다(시안 판은 범위를 고른 상태).
// 칩 라벨은 계약 사전(시안 'SMT수삽'은 계약 'SMT·수삽'으로).
// 수량 입력은 화면에서 문자열로 다루고 폼에는 정수 또는 null 로만 넣는다(빈 칸·0·문자는 null).
const props = defineProps<{ form: DevelopRequestForm }>();
const { fields } = props.form;
const plan = fields.production;

const hasScope = computed(() => plan.scopes.length > 0);
const toggleScope = (code: DevelopProductionScopeType): void => {
  const i = plan.scopes.indexOf(code);
  if (i >= 0) plan.scopes.splice(i, 1);
  else plan.scopes.push(code);
};

// ⚠ type="number" 에 v-model 을 걸면 Vue 가 number 로 캐스팅해 넘긴다(빈 칸은 '') — 문자열·숫자 둘 다 받는다.
const parseQty = (text: string | number, min: number): number | null => {
  const trimmed = String(text).trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= min ? n : null;
};
const annualQtyText = ref<string | number>(plan.annualQty === null ? '' : String(plan.annualQty));
watch(annualQtyText, (text) => {
  plan.annualQty = parseQty(text, 0);
});
watch(
  () => plan.annualQty,
  (v) => {
    if (parseQty(annualQtyText.value, 0) !== v) annualQtyText.value = v === null ? '' : String(v);
  },
);

const qtyEditing = ref(false);
const qtyDraft = ref<string | number>('');
let qtyInput: HTMLInputElement | null = null;
let countChip: HTMLButtonElement | null = null;
const setQtyInput = (el: unknown): void => {
  qtyInput = el instanceof HTMLInputElement ? el : null;
};
const setCountChip = (el: unknown): void => {
  countChip = el instanceof HTMLButtonElement ? el : null;
};
const countLabel = computed(() =>
  plan.prototype === 'count' && plan.prototypeQty !== null && !qtyEditing.value
    ? `${plan.prototypeQty.toLocaleString('ko-KR')}개`
    : DEVELOP_PROTOTYPE_MODE_LABELS.count,
);
async function startQty(): Promise<void> {
  qtyDraft.value = plan.prototypeQty === null ? '' : String(plan.prototypeQty);
  qtyEditing.value = true;
  await nextTick();
  qtyInput?.focus();
}
function commitQty(): void {
  if (!qtyEditing.value) return;
  qtyEditing.value = false;
  const n = parseQty(qtyDraft.value, 1);
  if (n !== null) {
    plan.prototype = 'count';
    plan.prototypeQty = n;
  } else if (plan.prototype === 'count') {
    plan.prototype = null;
    plan.prototypeQty = null;
  }
}
function cancelQty(): void {
  qtyEditing.value = false;
  countChip?.focus();
}
// 입력 중에 직접 입력 칩을 누르면 마침 — 칸의 blur 가 먼저 마치고 클릭이 다시 여는 일이 없게 mousedown 의 포커스 이동을 막는다.
function onCountDown(e: MouseEvent): void {
  if (qtyEditing.value) e.preventDefault();
}
function pickPrototype(mode: DevelopPrototypeModeType): void {
  if (mode !== 'count') plan.prototype = mode;
  else if (qtyEditing.value) commitQty();
  else void startQty();
}
</script>

<template>
  <div class="flex flex-col gap-[40px]">
    <!-- 시제품 수량 -->
    <section :class="WIZ.section">
      <h2 :class="WIZ.sectionTitle">개발 과정에서 시제품을 몇 개 제작해야 하나요? <span class="text-red-500">*</span></h2>
      <div class="flex flex-wrap items-center gap-[12px] sm:gap-[20px]">
        <template v-for="m in DEVELOP_PROTOTYPE_MODES" :key="m">
          <button
            v-if="m === 'count'"
            :ref="setCountChip"
            type="button"
            :class="chipClass(qtyEditing || plan.prototype === m)"
            :aria-pressed="plan.prototype === m"
            :aria-expanded="qtyEditing"
            @mousedown="onCountDown"
            @click="pickPrototype(m)"
          >
            {{ countLabel }}
          </button>
          <button
            v-else
            type="button"
            :class="chipClass(plan.prototype === m)"
            :aria-pressed="plan.prototype === m"
            @click="pickPrototype(m)"
          >
            {{ DEVELOP_PROTOTYPE_MODE_LABELS[m] }}
          </button>
        </template>
        <label v-if="qtyEditing" class="flex w-[200px] items-center gap-[6px] sm:w-[230px]" :class="WIZ.pillInput">
          <input
            :ref="setQtyInput"
            v-model="qtyDraft"
            type="number"
            min="1"
            placeholder="예) 100"
            aria-label="시제품 수량"
            class="w-full min-w-0 bg-transparent outline-none placeholder:text-[#999]"
            @keydown.enter.prevent="commitQty"
            @keydown.esc.prevent="cancelQty"
            @blur="commitQty"
          >
          <span class="shrink-0 text-[#999]">개</span>
        </label>
      </div>
    </section>

    <!-- 제작 범위 -->
    <section :class="WIZ.section">
      <div class="flex flex-col gap-[6px]">
        <h2 :class="WIZ.sectionTitle">시제품 제작 범위를 선택해 주세요.</h2>
        <p :class="WIZ.sectionLead">샘플피씨비가 직접 맡을 수 있는 범위입니다. 정하지 않으셔도 접수됩니다.</p>
      </div>
      <div class="flex flex-wrap gap-[12px] sm:gap-[20px]">
        <button
          v-for="s in DEVELOP_PRODUCTION_SCOPES"
          :key="s"
          type="button"
          :class="chipClass(plan.scopes.includes(s))"
          :aria-pressed="plan.scopes.includes(s)"
          @click="toggleScope(s)"
        >
          {{ DEVELOP_PRODUCTION_SCOPE_LABELS[s] }}
        </button>
      </div>
    </section>

    <!-- 자재 조달 · 납품 형태 — 제작 범위를 하나라도 골랐을 때만 -->
    <section v-if="hasScope" class="grid gap-[26px] md:grid-cols-2 md:gap-[40px]">
      <label class="flex flex-col gap-[26px]">
        <span :class="WIZ.sectionTitle">자재 조달 방식</span>
        <span :class="WIZ.selectBox">
          <select
            v-model="plan.sourcing"
            class="absolute inset-0 size-full cursor-pointer appearance-none rounded-[14px] bg-transparent pl-[24px] pr-[64px] outline-none sm:pl-[30px]"
            :class="[WIZ.selectText, plan.sourcing === null ? 'text-[#999]' : '']"
          >
            <option :value="null" disabled>선택해 주세요</option>
            <option v-for="s in DEVELOP_SOURCING_MODES" :key="s" :value="s">{{ DEVELOP_SOURCING_MODE_LABELS[s] }}</option>
          </select>
          <img :src="icoSelect" alt="" width="30" height="30" class="pointer-events-none absolute right-[24px] block size-[30px] sm:right-[30px]">
        </span>
      </label>
      <label class="flex flex-col gap-[26px]">
        <span :class="WIZ.sectionTitle">납품 형태</span>
        <span :class="WIZ.selectBox">
          <select
            v-model="plan.delivery"
            class="absolute inset-0 size-full cursor-pointer appearance-none rounded-[14px] bg-transparent pl-[24px] pr-[64px] outline-none sm:pl-[30px]"
            :class="[WIZ.selectText, plan.delivery === null ? 'text-[#999]' : '']"
          >
            <option :value="null" disabled>선택해 주세요</option>
            <option v-for="d in DEVELOP_DELIVERY_FORMS" :key="d" :value="d">{{ DEVELOP_DELIVERY_FORM_LABELS[d] }}</option>
          </select>
          <img :src="icoSelect" alt="" width="30" height="30" class="pointer-events-none absolute right-[24px] block size-[30px] sm:right-[30px]">
        </span>
      </label>
    </section>

    <!-- 연간 생산수량 -->
    <section :class="WIZ.section">
      <h2 :class="WIZ.sectionTitle">개발 완료 후 예상 연간 생산수량</h2>
      <input v-model="annualQtyText" type="number" min="0" placeholder="예) 5,000" aria-label="예상 연간 생산수량" :class="WIZ.input">
    </section>
  </div>
</template>
