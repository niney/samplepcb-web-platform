<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  DEVELOP_DELIVERY_FORMS,
  DEVELOP_DELIVERY_FORM_LABELS,
  DEVELOP_FAB_EXTRA_WORKS,
  DEVELOP_FAB_EXTRA_WORK_LABELS,
  DEVELOP_FAB_PURPOSES,
  DEVELOP_FAB_PURPOSE_LABELS,
  DEVELOP_PCB_FAB_SERVICES,
  DEVELOP_PCB_FAB_SERVICE_LABELS,
  DEVELOP_PRODUCTION_SCOPES,
  DEVELOP_PRODUCTION_SCOPE_LABELS,
  DEVELOP_PROTOTYPE_MODES,
  DEVELOP_PROTOTYPE_MODE_LABELS,
  DEVELOP_SOURCING_MODES,
  DEVELOP_SOURCING_MODE_LABELS,
} from '@sp/api-contract';
import type { DevelopFabExtraWorkType, DevelopFabPurposeType, DevelopProductionScopeType, DevelopPrototypeModeType, DevelopSourcingModeType } from '@sp/api-contract';
import type { DevelopRequestForm } from '../../composables/useRequestForm';
import { WIZ, chipClass } from '../../lib/wizard-copy';
import WizCheck from './WizCheck.vue';
import icoSelect from '../../assets/wizard/ico-select.svg';

// 위저드 4스텝 — 제작 계획. 피그마 01-4(70:12282, 900 폭): 시제품 수량 칩(제작 없음·수량 미정·직접 입력 + 수량 칸) ·
// 제작 범위 칩 · 자재 조달·납품 형태 선택 상자(2열) · 연간 생산수량 입력. 이 값이 견적서 '별도 실비'의 근거가 된다.
// '직접 입력'은 디자인 체크리스트(10-30, 기타와 같은 순서)대로: 칩을 누르면 옆에 수량 칸이 열리고, 입력을 마치면(Enter·칸 밖)
// 칩이 'N개'로 바뀐다. 다시 누르면 고치고, 비우고 마치면 직접 입력을 푼다(Esc 는 취소) — 01-4 시안은 수량 칸이 늘 보였다.
// 자재 조달·납품 형태는 제작 범위를 하나라도 골랐을 때만 묻는다(시안 판은 범위를 고른 상태).
// 칩 라벨은 계약 사전(시안 'SMT수삽'은 계약 'SMT·수삽'으로).
// 수량 입력은 화면에서 문자열로 다루고 폼에는 정수 또는 null 로만 넣는다(빈 칸·0·문자는 null).
// PCB 설계만이면(2026-11-03, 의뢰서 시안 'PCB 설계 의뢰서' 04) 'PCB 제작 · 부품 구매 · SMT 조립' 모양이다 — 서비스 칩(필수,
// 아직 결정하지 않음·필요 없음(설계만)은 혼자만) → PCB 제작·SMT 조립이면 수량(따로)·제조 목적(양산이면 연간 수량)·희망 제조
// 일정, 부품 구매·SMT 조립이면 부품 공급 방식, SMT 조립이면 추가 작업, 설계만이 아니면 사전 견적. 저장 모양은 계약
// normalizeDevelopProduction(pcbFab) 이 정한다.
const props = defineProps<{ form: DevelopRequestForm }>();
const { fields, pcbMaterials } = props.form;
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
// 수량 칸 — 화면 문자열과 폼 값(정수·null)을 서로 맞춘다(되돌림·복원으로 폼 값이 바뀌면 칸도 따라간다).
function qtyText(get: () => number | null, set: (v: number | null) => void, min: number) {
  const text = ref<string | number>(get() === null ? '' : String(get()));
  watch(text, (t) => {
    set(parseQty(t, min));
  });
  watch(get, (v) => {
    if (parseQty(text.value, min) !== v) text.value = v === null ? '' : String(v);
  });
  return text;
}
const annualQtyText = qtyText(() => plan.annualQty, (v) => { plan.annualQty = v; }, 0);
const pcbQtyText = qtyText(() => plan.pcbQty, (v) => { plan.pcbQty = v; }, 1);
const smtQtyText = qtyText(() => plan.smtQty, (v) => { plan.smtQty = v; }, 1);

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

// ── PCB 설계만 — 'PCB 제작 · 부품 구매 · SMT 조립' ─────────────────────────────────────
// 서비스 칩은 제작 범위(scopes)에 담는다: 아직 결정하지 않음 = 범위 협의(negotiate), 필요 없음(설계만) = 시제품 제작 없음.
// prototype 이 칩 상태를 겸한다 — 무엇이든 고르면 null 이 아니게 되어 4스텝 게이트가 풀린다.
const designOnly = computed(() => plan.prototype === 'none');
const undecidedFab = computed(() => plan.scopes.includes('negotiate'));
const hasService = (s: DevelopProductionScopeType): boolean => plan.scopes.includes(s);
const making = computed(() => hasService('pcb_fab') || hasService('smt'));
const showPreQuote = computed(() => plan.prototype !== null && !designOnly.value);
function syncServicePick(): void {
  plan.prototype = plan.scopes.length > 0 ? 'undecided' : null;
}
function toggleService(s: DevelopProductionScopeType): void {
  const rest: DevelopProductionScopeType[] = plan.scopes.filter((c) => c !== 'negotiate');
  plan.scopes = rest.includes(s) ? rest.filter((c) => c !== s) : [...rest, s];
  syncServicePick();
}
function pickUndecidedFab(): void {
  plan.scopes = undecidedFab.value ? [] : ['negotiate'];
  syncServicePick();
}
function pickDesignOnly(): void {
  if (designOnly.value) {
    plan.prototype = null;
    return;
  }
  plan.scopes = [];
  plan.prototype = 'none';
}
function pickPurpose(p: DevelopFabPurposeType): void {
  plan.purpose = plan.purpose === p ? null : p;
}
function pickSourcing(s: DevelopSourcingModeType): void {
  plan.sourcing = plan.sourcing === s ? null : s;
}
// 추가 작업 — 없음은 혼자만.
function toggleWork(w: DevelopFabExtraWorkType): void {
  if (w === 'none') {
    plan.extraWork = plan.extraWork.includes('none') ? [] : ['none'];
    return;
  }
  const rest: DevelopFabExtraWorkType[] = plan.extraWork.filter((c) => c !== 'none');
  plan.extraWork = rest.includes(w) ? rest.filter((c) => c !== w) : [...rest, w];
}
</script>

<template>
  <!-- PCB 설계만 — 'PCB 제작 · 부품 구매 · SMT 조립'(의뢰서 시안 'PCB 설계 의뢰서' 04) -->
  <div v-if="pcbMaterials" class="flex flex-col gap-[40px]">
    <section :class="WIZ.section">
      <div class="flex flex-col gap-[6px]">
        <h2 :class="WIZ.sectionTitle">설계 뒤 필요한 서비스를 선택해 주세요. <span class="text-red-500">*</span> <span class="text-[#888]">(여러 개 가능)</span></h2>
        <p :class="WIZ.sectionLead">설계 완료 후 확정된 자료로 제작 견적을 업데이트하여 회신드립니다.</p>
      </div>
      <div class="flex flex-wrap gap-[12px] sm:gap-[20px]">
        <button
          v-for="s in DEVELOP_PCB_FAB_SERVICES"
          :key="s"
          type="button"
          :class="chipClass(hasService(s))"
          :aria-pressed="hasService(s)"
          @click="toggleService(s)"
        >
          {{ DEVELOP_PCB_FAB_SERVICE_LABELS[s] }}
        </button>
        <button type="button" :class="chipClass(undecidedFab)" :aria-pressed="undecidedFab" @click="pickUndecidedFab">아직 결정하지 않음</button>
        <button type="button" :class="chipClass(designOnly)" :aria-pressed="designOnly" @click="pickDesignOnly">필요 없음(설계만)</button>
      </div>
    </section>

    <!-- PCB 제작·SMT 조립 — 수량(따로) · 제조 목적(양산이면 연간 수량) · 희망 제조 일정 -->
    <template v-if="making">
      <section :class="WIZ.section">
        <h2 :class="WIZ.sectionTitle">제작·조립 수량</h2>
        <div class="grid gap-[20px] md:grid-cols-2 md:gap-[40px]">
          <label v-if="hasService('pcb_fab')" class="flex flex-col gap-[12px]">
            <span :class="WIZ.question">PCB 제작 수량 (개)</span>
            <input v-model="pcbQtyText" type="number" min="1" placeholder="예) 10" :class="WIZ.input">
          </label>
          <label v-if="hasService('smt')" class="flex flex-col gap-[12px]">
            <span :class="WIZ.question">SMT 조립 수량 (보드 수)</span>
            <input v-model="smtQtyText" type="number" min="1" placeholder="예) 5" :class="WIZ.input">
          </label>
        </div>
      </section>
      <section :class="WIZ.section">
        <h2 :class="WIZ.sectionTitle">제조 목적</h2>
        <div class="flex flex-wrap gap-[12px] sm:gap-[20px]">
          <button
            v-for="p in DEVELOP_FAB_PURPOSES"
            :key="p"
            type="button"
            :class="chipClass(plan.purpose === p)"
            :aria-pressed="plan.purpose === p"
            @click="pickPurpose(p)"
          >
            {{ DEVELOP_FAB_PURPOSE_LABELS[p] }}
          </button>
        </div>
        <input
          v-if="plan.purpose === 'mass'"
          v-model="annualQtyText"
          type="number"
          min="0"
          placeholder="예상 연간 생산수량 예) 5,000"
          aria-label="예상 연간 생산수량"
          :class="WIZ.input"
        >
      </section>
      <section :class="WIZ.section">
        <div class="flex flex-col gap-[6px]">
          <h2 :class="WIZ.sectionTitle">희망 제조 일정</h2>
          <p :class="WIZ.sectionLead">미정이면 비워 두세요.</p>
        </div>
        <input v-model="plan.fabWishDate" type="date" aria-label="희망 제조 일정" :class="WIZ.input">
      </section>
    </template>

    <!-- 부품 구매·SMT 조립 — 부품 공급 방식 -->
    <section v-if="hasService('parts') || hasService('smt')" :class="WIZ.section">
      <div class="flex flex-col gap-[6px]">
        <h2 :class="WIZ.sectionTitle">부품 공급 방식</h2>
        <p :class="WIZ.sectionLead">혼합 공급 시 BOM에 구매·사급 부품을 구분해 주세요. 대체품은 고객 확인 후 적용합니다.</p>
      </div>
      <div class="flex flex-wrap gap-[12px] sm:gap-[20px]">
        <button
          v-for="s in DEVELOP_SOURCING_MODES"
          :key="s"
          type="button"
          :class="chipClass(plan.sourcing === s)"
          :aria-pressed="plan.sourcing === s"
          @click="pickSourcing(s)"
        >
          {{ DEVELOP_SOURCING_MODE_LABELS[s] }}
        </button>
      </div>
    </section>

    <!-- SMT 조립 — 추가 조립·작업 -->
    <section v-if="hasService('smt')" :class="WIZ.section">
      <div class="flex flex-col gap-[6px]">
        <h2 :class="WIZ.sectionTitle">추가 조립·작업 요청 <span class="text-[#888]">(여러 개 가능)</span></h2>
        <p :class="WIZ.sectionLead">수삽, 검사, 프로그래밍 등의 상세 범위는 자료 검토 후 확인합니다.</p>
      </div>
      <div class="flex flex-wrap gap-[12px] sm:gap-[20px]">
        <button
          v-for="w in DEVELOP_FAB_EXTRA_WORKS"
          :key="w"
          type="button"
          :class="chipClass(plan.extraWork.includes(w))"
          :aria-pressed="plan.extraWork.includes(w)"
          @click="toggleWork(w)"
        >
          {{ DEVELOP_FAB_EXTRA_WORK_LABELS[w] }}
        </button>
      </div>
      <input
        v-if="plan.extraWork.includes('other')"
        v-model="plan.extraWorkNote"
        type="text"
        maxlength="200"
        placeholder="기타 작업을 적어 주세요."
        aria-label="기타 작업"
        :class="WIZ.pillInput"
      >
    </section>

    <!-- 사전 견적 — 설계만이 아니면 -->
    <section v-if="showPreQuote" class="flex flex-col gap-[16px] rounded-[14px] bg-[#f6f7f9] px-[18px] py-[24px] sm:px-[30px]">
      <div class="flex flex-col gap-[6px]">
        <h2 :class="WIZ.sectionTitle">설계와 제작 견적을 미리 함께 받고 싶으신가요?</h2>
        <p :class="WIZ.sectionLead">
          선택하시면 제공하신 자료와 예상 수량을 바탕으로 사전 견적을 안내해 드립니다. 최종 제작 견적은 설계 완료 후 확정된 자료와 제조 조건에 따라 달라질 수 있습니다.
        </p>
      </div>
      <WizCheck v-model="plan.preQuote" label="설계와 제작 견적을 함께 미리 받고 싶어요" />
    </section>
  </div>

  <div v-else class="flex flex-col gap-[40px]">
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
