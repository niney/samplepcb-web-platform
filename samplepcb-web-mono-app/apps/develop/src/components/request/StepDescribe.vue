<script setup lang="ts">
import { computed } from 'vue';
import { AreaIcon, FileDropZone } from '@sp/ui';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 1스텝 — 의뢰 내용(docs/DEVELOP_FLOW.md §7.2).
// 분야 5 + "전부 맡길게요"(전 분야 선택) · 제목 · 설명(≥10자) · 참고 자료 · AI 분석 동의.
// 분야 카드는 레지스트리(MARKET_AREAS)로만 그린다 — 분야가 늘어도 이 컴포넌트는 안 바뀐다.
// 수정 화면도 이 컴포넌트를 그대로 쓴다 — 다만 첨부는 거기서 서버에 즉시 반영하므로 이 블록을 끈다.
const props = withDefaults(defineProps<{ form: DevelopRequestForm; showAttachments?: boolean }>(), {
  showAttachments: true,
});
const {
  fields,
  areas,
  attachments,
  addAttachments,
  removeAttachment,
  toggleServiceArea,
  allServiceAreasSelected,
  selectAllServiceAreas,
} = props.form;

const descriptionLength = computed(() => fields.description.trim().length);
const titleLength = computed(() => fields.title.trim().length);
</script>

<template>
  <div class="grid gap-7">
    <!-- 개발 분야 -->
    <section class="grid gap-3.5">
      <div class="flex items-baseline gap-2.5">
        <h2 class="text-title font-extrabold text-tx-1">무엇을 만들어 드릴까요?</h2>
        <span class="text-label text-tx-3">여러 개 고를 수 있습니다</span>
      </div>
      <div class="grid gap-2.5 sm:grid-cols-2">
        <button
          v-for="area in areas"
          :key="area.code"
          type="button"
          class="flex items-start gap-3 rounded-xl border-2 bg-white p-4 text-left transition"
          :class="fields.serviceAreas.includes(area.code) ? 'border-brand-500 shadow-[0_1px_0_0_var(--color-brand-500)]' : 'border-line hover:border-line-2'"
          :aria-pressed="fields.serviceAreas.includes(area.code)"
          @click="toggleServiceArea(area.code)"
        >
          <AreaIcon :code="area.code" />
          <span class="grid min-w-0 gap-1">
            <span class="text-body font-extrabold text-tx-1">{{ area.label }}</span>
            <span class="text-label leading-relaxed text-tx-3">{{ area.hint }}</span>
          </span>
          <span
            class="ml-auto mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-black text-white"
            :class="fields.serviceAreas.includes(area.code) ? 'border-brand-500 bg-brand-500' : 'border-line-2 bg-white'"
          >{{ fields.serviceAreas.includes(area.code) ? '✓' : '' }}</span>
        </button>
      </div>
      <button
        type="button"
        class="flex items-center gap-3 rounded-xl border-2 border-dashed px-4 py-3.5 text-left transition"
        :class="allServiceAreasSelected ? 'border-ink-950 bg-ink-950 text-white' : 'border-line-2 bg-paper hover:border-tx-3'"
        @click="selectAllServiceAreas"
      >
        <span class="text-body font-extrabold">잘 모르겠어요 — 전부 맡길게요</span>
        <span class="text-label" :class="allServiceAreasSelected ? 'text-dk-tx-2' : 'text-tx-3'">
          회로부터 서버까지 필요한 것만 골라 진행합니다
        </span>
      </button>
    </section>

    <!-- 제목·설명 -->
    <section class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <label class="grid gap-2">
        <span class="flex items-baseline gap-2 text-label font-bold text-tx-2">
          제목 <span class="text-red-500">*</span>
          <span class="ml-auto font-mono text-micro tabular-nums text-tx-3">{{ titleLength }} / 200</span>
        </span>
        <input
          v-model="fields.title"
          type="text"
          maxlength="200"
          placeholder="예: 온도·습도 무선 센서 노드와 관제 웹"
          class="h-11 rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1 outline-none focus:border-brand-500"
        >
      </label>

      <label class="grid gap-2">
        <span class="flex items-baseline gap-2 text-label font-bold text-tx-2">
          어떤 것을 만들고 싶으신가요? <span class="text-red-500">*</span>
          <span class="ml-auto font-mono text-micro tabular-nums" :class="descriptionLength < 10 ? 'text-tx-3' : 'text-brand-600'">
            {{ descriptionLength }}자
          </span>
        </span>
        <textarea
          v-model="fields.description"
          rows="9"
          maxlength="20000"
          placeholder="쓰임새, 꼭 되어야 하는 동작, 이미 정해진 부품·환경, 수량과 일정 같은 것을 아는 만큼만 적어 주세요. 전문 용어가 아니어도 괜찮습니다."
          class="rounded-lg border border-line-2 bg-white p-3.5 text-body leading-relaxed text-tx-1 outline-none focus:border-brand-500"
        />
        <span class="text-label text-tx-3">
          10자 이상. 자세히 적을수록 상담과 견적이 빨라집니다.
        </span>
      </label>
    </section>

    <!-- 참고 자료 + AI 동의 — 수정 화면은 첨부를 즉시 반영으로 따로 다루고 AI 동의도 안 바꾼다(showAttachments=false) -->
    <section v-if="showAttachments" class="grid gap-3.5">
      <div class="flex flex-wrap items-baseline gap-2.5">
        <h2 class="text-title font-extrabold text-tx-1">참고 자료</h2>
        <span class="rounded-full bg-brand-50 px-2.5 py-1 text-micro font-bold text-brand-700">AI 분석 대상</span>
        <span class="text-label text-tx-3">선택 · 없어도 접수됩니다</span>
      </div>
      <FileDropZone
        :files="attachments"
        label="회로도 · 사양서 · 스케치 · 사진 무엇이든"
        hint="pdf · 이미지 · 엑셀 · 압축 파일 — 끌어다 놓거나 눌러서 선택"
        variant="panel"
        @add="addAttachments"
        @remove="removeAttachment"
      />
      <label class="flex items-start gap-3 rounded-xl border border-line bg-white p-4">
        <input v-model="fields.aiConsent" type="checkbox" class="mt-0.5 h-4.5 w-4.5 shrink-0 accent-[var(--color-brand-500)]">
        <span class="grid gap-1">
          <span class="text-body font-bold text-tx-1">AI 사전 검토에 사용하는 데 동의합니다</span>
          <span class="text-label leading-relaxed text-tx-3">
            참고 자료와 설명을 AI 사전 검토에 사용합니다. 담당자가 검토한 뒤 결과를 공개합니다.
          </span>
        </span>
      </label>
    </section>
  </div>
</template>
