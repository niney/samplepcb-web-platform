<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  DEVELOP_DELIVERY_FORMS,
  DEVELOP_DELIVERY_FORM_LABELS,
  DEVELOP_PRIORITIES,
  DEVELOP_PRIORITY_LABELS,
  DEVELOP_PRODUCTION_SCOPES,
  DEVELOP_PRODUCTION_SCOPE_LABELS,
  DEVELOP_PROTOTYPE_MODES,
  DEVELOP_PROTOTYPE_MODE_LABELS,
  DEVELOP_SOURCING_MODES,
  DEVELOP_SOURCING_MODE_LABELS,
} from '@sp/api-contract';
import type { DevelopProductionScopeType } from '@sp/api-contract';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 4스텝 — 제작 계획(2026-09-08 v2).
// 개발 과정의 시제품과 개발 완료 후 생산 계획을 나눠 묻는다. 이 값이 견적서 '별도 실비'의 근거가 되고,
// 제작 범위를 하나라도 고르면 제조 연계(자재 조달·납품 형태)를 이어서 확인한다.
// 수량 입력은 화면에서 문자열로 다루고 폼에는 정수 또는 null 로만 넣는다(빈 칸·0·문자는 null).
const props = defineProps<{ form: DevelopRequestForm }>();
const { fields } = props.form;
const plan = fields.production;

const prototypeModes = DEVELOP_PROTOTYPE_MODES;
const prototypeLabels = DEVELOP_PROTOTYPE_MODE_LABELS;
const scopes = DEVELOP_PRODUCTION_SCOPES;
const scopeLabels = DEVELOP_PRODUCTION_SCOPE_LABELS;
const priorities = DEVELOP_PRIORITIES;
const priorityLabels = DEVELOP_PRIORITY_LABELS;
const sourcingModes = DEVELOP_SOURCING_MODES;
const sourcingLabels = DEVELOP_SOURCING_MODE_LABELS;
const deliveryForms = DEVELOP_DELIVERY_FORMS;
const deliveryLabels = DEVELOP_DELIVERY_FORM_LABELS;

const hasScope = computed(() => plan.scopes.length > 0);
const toggleScope = (code: DevelopProductionScopeType): void => {
  const i = plan.scopes.indexOf(code);
  if (i >= 0) plan.scopes.splice(i, 1);
  else plan.scopes.push(code);
};

// 수량 두 칸 — 입력 중 글자를 지우거나 다시 치는 동안에도 화면 문자열을 그대로 두고, 폼 값만 정규화한다.
// ⚠ type="number" 인풋에 v-model 을 걸면 Vue 가 값을 number 로 캐스팅해 넘기므로(빈 칸은 ''),
// 문자열·숫자 둘 다 받는다 — string 만 가정하면 `text.trim is not a function` 으로 watcher 가 죽는다.
const parseQty = (text: string | number, min: number): number | null => {
  const trimmed = String(text).trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= min ? n : null;
};
const protoQtyText = ref<string | number>(plan.prototypeQty === null ? '' : String(plan.prototypeQty));
const annualQtyText = ref<string | number>(plan.annualQty === null ? '' : String(plan.annualQty));
watch(protoQtyText, (text) => {
  plan.prototypeQty = parseQty(text, 1);
});
watch(annualQtyText, (text) => {
  plan.annualQty = parseQty(text, 0);
});
// 폼 값이 밖에서 바뀌면(수정 화면 프리필·초안 복원) 입력 칸도 맞춘다 — 입력 중이면 건드리지 않는다.
watch(
  () => plan.prototypeQty,
  (v) => {
    if (parseQty(protoQtyText.value, 1) !== v) protoQtyText.value = v === null ? '' : String(v);
  },
);
watch(
  () => plan.annualQty,
  (v) => {
    if (parseQty(annualQtyText.value, 0) !== v) annualQtyText.value = v === null ? '' : String(v);
  },
);

const chipClass = (on: boolean): string =>
  on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line-2 bg-white text-tx-2 hover:border-tx-3';
</script>

<template>
  <div class="grid gap-7">
    <div class="grid gap-1.5">
      <h2 class="text-title font-extrabold text-tx-1">시제품과 생산 계획</h2>
      <p class="text-body leading-relaxed text-tx-2">개발 과정의 시제품과 개발 완료 후 생산 계획을 나누어 확인합니다.</p>
    </div>

    <!-- 시제품 -->
    <section class="grid gap-4 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <p class="text-label font-bold text-tx-2">
        개발 과정에서 시제품을 몇 개 제작해야 하나요? <span class="text-red-500">*</span>
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          v-for="m in prototypeModes"
          :key="m"
          type="button"
          class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
          :class="chipClass(plan.prototype === m)"
          :aria-pressed="plan.prototype === m"
          @click="plan.prototype = m"
        >
          {{ prototypeLabels[m] }}
        </button>
        <label v-if="plan.prototype === 'count'" class="flex items-center gap-2">
          <input
            v-model="protoQtyText"
            type="number"
            min="1"
            placeholder="수량"
            class="h-9 w-28 rounded-lg border border-line-2 bg-white px-3 text-body text-tx-1 outline-none focus:border-brand-500"
          >
          <span class="text-label text-tx-2">개</span>
        </label>
      </div>
    </section>

    <!-- 제작 범위 -->
    <section class="grid gap-4 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <p class="text-label font-bold text-tx-2">시제품 제작 범위를 선택해 주세요</p>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="s in scopes"
          :key="s"
          type="button"
          class="h-9 rounded-full border px-3.5 text-label font-semibold transition"
          :class="chipClass(plan.scopes.includes(s))"
          :aria-pressed="plan.scopes.includes(s)"
          @click="toggleScope(s)"
        >
          {{ scopeLabels[s] }}
        </button>
      </div>
      <p class="text-label text-tx-3">샘플피씨비가 직접 맡을 수 있는 범위입니다. 정하지 않으셔도 접수됩니다.</p>
    </section>

    <!-- 생산 계획 -->
    <section class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6 md:grid-cols-2">
      <label class="grid content-start gap-2">
        <span class="text-label font-bold text-tx-2">개발 완료 후 예상 연간 생산수량</span>
        <input
          v-model="annualQtyText"
          type="number"
          min="0"
          placeholder="예: 5,000"
          class="h-11 rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1 outline-none focus:border-brand-500"
        >
      </label>
      <label class="grid content-start gap-2">
        <span class="text-label font-bold text-tx-2">가장 중요한 우선순위</span>
        <select
          v-model="plan.priority"
          class="h-11 rounded-lg border bg-white px-3 text-body text-tx-1 outline-none focus:border-brand-500"
          :class="plan.priority === null ? 'border-line-2' : 'border-ink-900'"
        >
          <option :value="null" disabled>선택해 주세요</option>
          <option v-for="p in priorities" :key="p" :value="p">{{ priorityLabels[p] }}</option>
        </select>
      </label>
    </section>

    <!-- 제조 연계 확인 — 제작 범위를 하나라도 골랐을 때만 -->
    <section v-if="hasScope" class="grid gap-5 rounded-2xl border-2 border-ink-950 bg-white p-5 sm:p-6">
      <div class="grid gap-1">
        <h3 class="text-body font-extrabold text-tx-1">제조 연계 확인</h3>
        <p class="text-label leading-relaxed text-tx-3">고르신 제작 범위를 실제로 진행할 때 필요한 두 가지입니다.</p>
      </div>
      <div class="grid gap-5 md:grid-cols-2">
        <label class="grid content-start gap-2">
          <span class="text-label font-bold text-tx-2">자재 조달 방식</span>
          <select
            v-model="plan.sourcing"
            class="h-11 rounded-lg border bg-white px-3 text-body text-tx-1 outline-none focus:border-brand-500"
            :class="plan.sourcing === null ? 'border-line-2' : 'border-ink-900'"
          >
            <option :value="null" disabled>선택해 주세요</option>
            <option v-for="s in sourcingModes" :key="s" :value="s">{{ sourcingLabels[s] }}</option>
          </select>
        </label>
        <label class="grid content-start gap-2">
          <span class="text-label font-bold text-tx-2">납품 형태</span>
          <select
            v-model="plan.delivery"
            class="h-11 rounded-lg border bg-white px-3 text-body text-tx-1 outline-none focus:border-brand-500"
            :class="plan.delivery === null ? 'border-line-2' : 'border-ink-900'"
          >
            <option :value="null" disabled>선택해 주세요</option>
            <option v-for="d in deliveryForms" :key="d" :value="d">{{ deliveryLabels[d] }}</option>
          </select>
        </label>
      </div>
    </section>
  </div>
</template>
