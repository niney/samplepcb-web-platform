<script setup lang="ts">
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';

// 스텝 2 — 제목 + 자연어 설명 + 첨부(여러 개) + AI 분석 동의.
// 필수 입력은 사실상 제목·설명뿐. AI 분석 동의를 해제하면 인터뷰 스텝이 빠지고 일반 등록으로 진행된다.
const props = defineProps<{ form: RequestWizardForm }>();
const { fields, attachments, interviewEnabled, pickAttachments } = props.form;
</script>

<template>
  <div class="grid gap-4">
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
        placeholder="제품/문제 배경, 필요한 기능·성능 목표, 기대 산출물(회로도·펌웨어·거버 등)을 적어주세요. 자세할수록 AI가 질문을 줄이고 명세를 더 정확히 정리합니다. (10자 이상)"
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
      ⚠ 개발기능명세서나 아이디어 설명자료가 있으면 AI가 질문을 크게 줄이고 더 정확한 견적을 받을 수 있습니다.
      자료 준비가 어려우면 유선 상담(070-8667-1080)을 이용해 주세요.
    </p>

    <!-- AI 분석 동의 + 외부 전송 고지 -->
    <label class="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-blue-900">
      <input v-model="fields.aiConsent" type="checkbox" class="mt-0.5">
      <span>
        <b>🤖 AI 분석 동의</b> — 입력한 제목·설명과 첨부에서 추출한 텍스트·이미지를 AI 분석(질문 축소·구성 명세 초안)에 외부 서버로 전송합니다.
        첨부 분석은 최대 10개·합계 50MB이며 미지원 바이너리는 내용을 추정하지 않습니다.
        <template v-if="interviewEnabled">
          <br>동의를 해제하면 AI 인터뷰·명세 단계가 모두 빠지고 입력한 내용만으로 일반 등록됩니다.
        </template>
      </span>
    </label>
  </div>
</template>
