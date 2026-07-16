<script setup lang="ts">
import {
  MARKET_REQUEST_TYPE_LABELS,
  MARKET_SERVICE_AREA_LABELS,
  MarketRequestType,
  MarketServiceArea,
} from '@sp/api-contract';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';

// 스텝 1 — 의뢰 유형(개별/시스템 통합) + 필요한 개발 분야(복수 선택, 2개+ 선택 시 자동 system).
const props = defineProps<{ form: RequestWizardForm }>();
const { fields, typeNotice, selectRequestType, toggleServiceArea, requestTypeDescs } = props.form;
</script>

<template>
  <div class="grid gap-6">
    <div>
      <p class="text-xs font-bold text-tx-2">의뢰 유형 <span class="text-red-500">*</span></p>
      <div class="mt-3 grid gap-3 sm:grid-cols-2">
        <button
          v-for="type in MarketRequestType.options"
          :key="type"
          type="button"
          class="rounded-2xl border-2 p-5 text-left transition"
          :class="fields.requestType === type ? 'border-copper-500 bg-copper-50' : 'border-line hover:border-line-2'"
          @click="selectRequestType(type)"
        >
          <p class="text-sm font-extrabold text-tx-1">{{ MARKET_REQUEST_TYPE_LABELS[type] }}</p>
          <p class="mt-1.5 text-xs leading-relaxed text-tx-2">{{ requestTypeDescs[type] }}</p>
        </button>
      </div>
    </div>
    <div>
      <p class="text-xs font-bold text-tx-2">
        필요한 개발 분야 <span class="font-normal text-tx-3">(복수 선택)</span> <span class="text-red-500">*</span>
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          v-for="area in MarketServiceArea.options"
          :key="area"
          type="button"
          class="rounded-full border px-3 py-2 text-xs font-semibold transition"
          :class="fields.serviceAreas.includes(area) ? 'border-ink-900 bg-ink-900 text-white' : 'border-line text-tx-2 hover:border-line-2'"
          @click="toggleServiceArea(area)"
        >
          {{ MARKET_SERVICE_AREA_LABELS[area] }}
        </button>
      </div>
      <p class="mt-2 text-xs leading-relaxed text-tx-3">
        시스템 통합 개발은 분야를 선택하지 않아도 등록할 수 있습니다. 개별 분야 개발에서 두 개 이상 선택하면 시스템 통합 개발로 자동 변경됩니다.
      </p>
      <p v-if="typeNotice !== ''" class="mt-2 rounded-lg bg-copper-50 px-3 py-2 text-xs font-semibold text-copper-700">
        {{ typeNotice }}
      </p>
    </div>
  </div>
</template>
