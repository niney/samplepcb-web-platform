<script setup lang="ts">
import { computed, ref, watch } from 'vue';
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
import type { DevelopProductionScopeType } from '@sp/api-contract';
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import { WIZ, chipClass } from '../../lib/wizard-copy';
import icoSelect from '../../assets/wizard/ico-select.svg';

// 위저드 4스텝 — 제작 계획. 피그마 01-4(70:12282, 900 폭): 시제품 수량 칩(제작 없음·수량 미정·직접 입력 + 수량 칸) ·
// 제작 범위 칩 · 자재 조달·납품 형태 선택 상자(2열) · 연간 생산수량 입력. 이 값이 견적서 '별도 실비'의 근거가 된다.
// 수량 칸은 시안처럼 늘 보이고, 거기에 적으면 '직접 입력'이 골라진다. 자재 조달·납품 형태는 제작 범위를 하나라도 골랐을 때만
// 묻는다(시안 판은 범위를 고른 상태). 칩 라벨은 계약 사전(시안 'SMT수삽'은 계약 'SMT·수삽'으로).
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
const protoQtyText = ref<string | number>(plan.prototypeQty === null ? '' : String(plan.prototypeQty));
const annualQtyText = ref<string | number>(plan.annualQty === null ? '' : String(plan.annualQty));
watch(protoQtyText, (text) => {
  plan.prototypeQty = parseQty(text, 1);
  if (String(text).trim() !== '') plan.prototype = 'count';
});
watch(annualQtyText, (text) => {
  plan.annualQty = parseQty(text, 0);
});
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
</script>

<template>
  <div class="flex flex-col gap-[40px]">
    <!-- 시제품 수량 -->
    <section :class="WIZ.section">
      <h2 :class="WIZ.sectionTitle">개발 과정에서 시제품을 몇 개 제작해야 하나요? <span class="text-red-500">*</span></h2>
      <div class="flex flex-wrap items-center gap-[12px] sm:gap-[20px]">
        <button
          v-for="m in DEVELOP_PROTOTYPE_MODES"
          :key="m"
          type="button"
          :class="chipClass(plan.prototype === m)"
          :aria-pressed="plan.prototype === m"
          @click="plan.prototype = m"
        >
          {{ DEVELOP_PROTOTYPE_MODE_LABELS[m] }}
        </button>
        <label class="flex min-h-[48px] w-[200px] items-center rounded-full border bg-white px-[20px] sm:min-h-[56px] sm:w-[230px]" :class="plan.prototype === 'count' ? 'border-2 border-[#2945e8]' : 'border-[#d9d9d9]'">
          <input
            v-model="protoQtyText"
            type="number"
            min="1"
            placeholder="예) 100"
            aria-label="시제품 수량"
            class="w-full min-w-0 bg-transparent text-[17px] font-bold text-black outline-none placeholder:text-[#999] sm:text-[20px]"
          >
          <span class="shrink-0 text-[17px] font-bold text-[#999] sm:text-[20px]">개</span>
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
