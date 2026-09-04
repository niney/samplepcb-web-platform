<script setup lang="ts">
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';

// 스텝 1 — 의뢰 내용(docs/AI_DEV_REVIEW.md §13.4): 개발 분야(레지스트리 카드 + 쉬운 설명 +
// "잘 모르겠어요" = 전 분야) · 제목 · 설명 · 참고 자료(일반 첨부) · AI 사전 검토 동의.
// 의뢰자는 이 분야를 잘 모른다는 전제 — 용어 대신 "무엇을 만들고 어디에 쓰는지"만 묻는다.
// 질문·분야별 툴·추가자료는 2단계로 옮겨 이 화면은 짧게 유지한다.
const props = defineProps<{ form: RequestWizardForm }>();
const {
  fields,
  attachments,
  areas,
  devReviewEnabled,
  toggleServiceArea,
  allServiceAreasSelected,
  selectAllServiceAreas,
  pickAttachments,
} = props.form;
</script>

<template>
  <div class="grid gap-6">
    <!-- 개발 분야 -->
    <div>
      <p class="text-xs font-bold text-tx-2">
        어떤 개발이 필요한가요? <span class="font-normal text-tx-3">(여러 개 선택 가능)</span>
        <span class="text-red-500">*</span>
      </p>
      <div class="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <button
          v-for="area in areas"
          :key="area.code"
          type="button"
          class="rounded-2xl border-2 p-3.5 text-left transition"
          :class="
            fields.serviceAreas.includes(area.code)
              ? 'border-ink-900 bg-ink-900 text-white'
              : 'border-line bg-white text-tx-2 hover:border-line-2'
          "
          @click="toggleServiceArea(area.code)"
        >
          <p class="text-sm font-extrabold">{{ area.label }}</p>
          <p class="mt-1 text-[11px] leading-relaxed" :class="fields.serviceAreas.includes(area.code) ? 'text-dk-tx-2' : 'text-tx-3'">
            {{ area.hint }}
          </p>
        </button>
      </div>
      <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          class="rounded-full border border-dashed px-3 py-1.5 font-semibold transition"
          :class="allServiceAreasSelected ? 'border-tx-3 bg-tx-3 text-white' : 'border-line-2 text-tx-3 hover:border-tx-3'"
          @click="selectAllServiceAreas()"
        >
          잘 모르겠어요 — 전부 맡길게요
        </button>
        <span class="text-tx-3">고르기 어려우면 전부 선택하고, 무엇을 만들고 싶은지만 아래에 적어 주세요.</span>
      </div>
      <p v-if="fields.serviceAreas.length === 0" class="mt-2 text-xs text-red-500">
        개발 분야를 1개 이상 선택해 주세요.
      </p>
    </div>

    <!-- 제목·설명 -->
    <label class="grid gap-1.5 text-xs font-bold text-tx-2">
      <span>프로젝트 제목 <span class="text-red-500">*</span></span>
      <input
        v-model="fields.title"
        type="text"
        placeholder="예: 화분 물 주기 알림 장치"
        class="h-10 rounded-lg border border-line px-3 text-sm font-normal"
      >
    </label>
    <label class="grid gap-1.5 text-xs font-bold text-tx-2">
      <span>무엇을 만들고 싶은가요? <span class="text-red-500">*</span></span>
      <textarea
        v-model="fields.description"
        rows="7"
        placeholder="어디에 쓰는 물건인지, 꼭 있어야 하는 기능, 정해진 것(크기·전원·연결 방식 등)이 있으면 적어 주세요. 잘 모르는 부분은 비워 두셔도 됩니다 — 전문가 상담에서 함께 정합니다. (10자 이상)"
        class="rounded-lg border border-line p-3 text-sm font-normal leading-relaxed"
      />
      <span class="font-normal text-tx-3">기술 용어를 몰라도 괜찮습니다. 사용 목적과 원하는 동작을 편하게 적어 주세요.</span>
    </label>

    <!-- 참고 자료(일반 첨부) -->
    <label class="grid gap-1.5 text-xs font-bold text-tx-2">
      <span>참고 자료 <span class="font-normal text-tx-3">(선택 · 여러 개 가능 — 손그림·사진·문서 무엇이든)</span></span>
      <input type="file" multiple class="text-xs font-normal" @change="pickAttachments">
      <span v-if="attachments.length > 0" class="font-normal text-tx-3">
        {{ attachments.length }}개 선택됨
      </span>
      <span class="font-normal text-tx-3">분야별로 있으면 좋은 자료(회로도·화면 시안 등)는 다음 단계에서 따로 올릴 수 있습니다.</span>
    </label>
    <p v-if="attachments.length === 0" class="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-700">
      자료가 있으면 검토서가 훨씬 정확해집니다. 준비가 어려우면 유선 상담(070-8667-1080)을 이용해 주세요.
    </p>

    <!-- AI 사전 검토 동의 + 외부 전송 고지 -->
    <label class="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs leading-relaxed text-blue-900">
      <input v-model="fields.aiConsent" type="checkbox" class="mt-0.5">
      <span>
        <b>🤖 AI 사전 검토 동의</b> — 적어 주신 내용과 첨부에서 추출한 텍스트·이미지를 AI 분석에 외부 서버로
        보내 <b>AI 사전 검토서</b>(요약·구성도·개발명세서)를 만들고, 등록 뒤에는 <b>정밀 시스템 구성도</b>를
        추가로 만들어 알려드립니다. 공개 범위는 설명과 같습니다.
        <template v-if="devReviewEnabled">
          <br>해제하면 검토서·구성도 없이 입력한 내용만으로 등록됩니다.
        </template>
        <template v-else>
          <br>지금은 검토서 생성이 중지되어 있어 입력한 내용만으로 등록됩니다.
        </template>
      </span>
    </label>
  </div>
</template>
