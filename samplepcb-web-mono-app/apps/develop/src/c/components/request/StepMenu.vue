<script setup lang="ts">
import { DEVELOP_INDIVIDUAL_TAG } from '@sp/api-contract/develop-c';
import { AreaIcon } from '@sp/ui';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 1스텝 — 개발 메뉴(2026-09-08 v2).
// 카드 5장: 「시스템개발」(배타 — 회로·펌웨어는 여기서만 다룬다) + 개별 견적 4분야(PCB·기구·앱·서버, 복수 선택).
// 카드 목록·라벨·꼬리표는 전부 계약(DEVELOP_SYSTEM_MENU · DEVELOP_INDIVIDUAL_AREAS)에서 온다.
// 수정 화면도 이 컴포넌트를 그대로 쓴다(분야를 바꾸면 3스텝 질문이 통째로 바뀐다).
const props = defineProps<{ form: DevelopRequestForm }>();
const { individualAreas, systemMenu, isSystem, isAreaPicked, selectSystemMenu, toggleIndividualArea } = props.form;
</script>

<template>
  <div class="grid gap-5">
    <div class="grid gap-1.5">
      <h2 class="text-title font-extrabold text-tx-1">
        어떤 개발이 필요하신가요? <span class="text-red-500">*</span>
      </h2>
      <p class="text-body leading-relaxed text-tx-2">
        시스템개발은 제품 개발에 필요한 전체 업무를 분석합니다. 개별 견적은 여러 분야를 함께 선택할 수 있습니다.
      </p>
    </div>

    <div class="grid gap-2.5 sm:grid-cols-2">
      <!-- 시스템개발(배타) -->
      <button
        type="button"
        class="flex items-start gap-3 rounded-xl border-2 p-5 text-left transition sm:col-span-2"
        :class="isSystem ? 'border-brand-500 bg-brand-50' : 'border-ink-950 bg-white hover:bg-paper'"
        :aria-pressed="isSystem"
        @click="selectSystemMenu"
      >
        <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-950 text-white">
          <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
            <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" /><path d="M17.25 13.5v7.5M13.5 17.25h7.5" />
          </svg>
        </span>
        <span class="grid min-w-0 gap-1">
          <span class="flex flex-wrap items-center gap-2">
            <span class="text-title font-extrabold text-tx-1">{{ systemMenu.label }}</span>
            <span class="rounded-full bg-ink-950 px-2.5 py-0.5 text-micro font-bold text-white">{{ systemMenu.tag }}</span>
          </span>
          <span class="text-body leading-relaxed text-tx-2">{{ systemMenu.hint }}</span>
        </span>
        <span
          class="ml-auto mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-black text-white"
          :class="isSystem ? 'border-brand-500 bg-brand-500' : 'border-line-2 bg-white'"
        >{{ isSystem ? '✓' : '' }}</span>
      </button>

      <!-- 개별 견적 4분야(복수 선택) -->
      <button
        v-for="area in individualAreas"
        :key="area.code"
        type="button"
        class="flex items-start gap-3 rounded-xl border-2 bg-white p-4 text-left transition"
        :class="isAreaPicked(area.code) ? 'border-brand-500 shadow-[0_1px_0_0_var(--color-brand-500)]' : 'border-line hover:border-line-2'"
        :aria-pressed="isAreaPicked(area.code)"
        @click="toggleIndividualArea(area.code)"
      >
        <AreaIcon :code="area.code" />
        <span class="grid min-w-0 gap-1">
          <span class="flex flex-wrap items-center gap-2">
            <span class="text-body font-extrabold text-tx-1">{{ area.label }}</span>
            <span class="rounded-full bg-paper px-2 py-0.5 text-micro font-bold text-tx-2">{{ DEVELOP_INDIVIDUAL_TAG }}</span>
          </span>
          <span class="text-label leading-relaxed text-tx-3">{{ area.hint }}</span>
        </span>
        <span
          class="ml-auto mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-black text-white"
          :class="isAreaPicked(area.code) ? 'border-brand-500 bg-brand-500' : 'border-line-2 bg-white'"
        >{{ isAreaPicked(area.code) ? '✓' : '' }}</span>
      </button>
    </div>

    <p class="rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-2">
      <b class="font-bold text-tx-1">시스템개발</b>은 다른 메뉴와 동시에 선택하지 않습니다. PCB·기구·앱·서버는 복수 선택할 수 있습니다.
    </p>
  </div>
</template>
