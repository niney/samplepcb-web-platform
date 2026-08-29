<script setup lang="ts">
import { MARKET_SERVICE_AREA_LABELS } from '@sp/api-contract';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';

// 스텝 1 — 개발 분야(활성 3종, 복수 선택) + 제목 + 설명 + 첨부 + AI 사전 검토 동의.
// 의뢰 유형 카드·자동 전환 안내는 사라졌다(2026-08-28): 서버가 분야 개수로 파생한다.
const props = defineProps<{ form: RequestWizardForm }>();
const { fields, attachments, activeServiceAreas, devReviewEnabled, toggleServiceArea, pickAttachments } =
  props.form;
</script>

<template>
  <div class="grid gap-4">
    <div>
      <p class="text-xs font-bold text-tx-2">
        필요한 개발 분야 <span class="font-normal text-tx-3">(복수 선택)</span>
        <span class="text-red-500">*</span>
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          v-for="area in activeServiceAreas"
          :key="area"
          type="button"
          class="rounded-full border px-4 py-2 text-xs font-semibold transition"
          :class="
            fields.serviceAreas.includes(area)
              ? 'border-ink-900 bg-ink-900 text-white'
              : 'border-line text-tx-2 hover:border-line-2'
          "
          @click="toggleServiceArea(area)"
        >
          {{ MARKET_SERVICE_AREA_LABELS[area] }}
        </button>
      </div>
      <p v-if="fields.serviceAreas.length === 0" class="mt-2 text-xs text-red-500">
        개발 분야를 1개 이상 선택해 주세요.
      </p>
    </div>

    <label class="grid gap-1.5 text-xs font-bold text-tx-2">
      프로젝트 제목 <span class="text-red-500">*</span>
      <input
        v-model="fields.title"
        type="text"
        placeholder="예: BLE 웨어러블 심박 모니터 회로 개발"
        class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
      >
    </label>
    <label class="grid gap-1.5 text-xs font-bold text-tx-2">
      상세 설명 <span class="text-red-500">*</span>
      <textarea
        v-model="fields.description"
        rows="7"
        placeholder="제품·문제 배경, 필요한 기능과 성능 목표, 기대 산출물(회로도·펌웨어·거버 등)을 적어주세요. 자세할수록 검토서의 '확정' 항목이 늘어납니다. (10자 이상)"
        class="rounded-lg border border-line p-3 text-sm font-normal leading-relaxed"
      />
    </label>
    <label class="grid gap-1.5 text-xs font-bold text-tx-2">
      참고 자료 첨부 <span class="font-normal text-tx-3">(선택 · 여러 개 가능)</span>
      <input type="file" multiple class="text-xs font-normal" @change="pickAttachments">
      <span v-if="attachments.length > 0" class="font-normal text-tx-3">
        {{ attachments.length }}개 선택됨
      </span>
    </label>
    <p v-if="attachments.length === 0" class="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
      ⚠ 개발기능명세서나 아이디어 설명자료가 있으면 검토서가 훨씬 정확해집니다.
      자료 준비가 어려우면 유선 상담(070-8667-1080)을 이용해 주세요.
    </p>

    <!-- AI 사전 검토 동의 + 외부 전송 고지 -->
    <label class="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-blue-900">
      <input v-model="fields.aiConsent" type="checkbox" class="mt-0.5">
      <span>
        <b>🤖 AI 사전 검토 동의</b> — 입력한 제목·설명과 다음 단계 답변, 첨부에서 추출한 텍스트·이미지를
        AI 분석에 외부 서버로 전송해 <b>AI 사전 검토서</b>를 만듭니다. 검토서의 공개 범위는 상세 설명과 같습니다.
        <template v-if="devReviewEnabled">
          <br>동의를 해제하면 질문 단계와 검토서가 빠지고 입력한 내용만으로 등록됩니다.
        </template>
        <template v-else>
          <br>지금은 검토서 생성이 중지되어 있어 입력한 내용만으로 등록됩니다.
        </template>
      </span>
    </label>
  </div>
</template>
