<script setup lang="ts">
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';
import AreaIcon from '../AreaIcon.vue';
import FileDropZone from './FileDropZone.vue';

// 스텝 1 — 의뢰 내용(docs/AI_DEV_REVIEW.md §13.4): 개발 분야(레지스트리 카드 + 쉬운 설명 +
// "잘 모르겠어요" = 전 분야) · 제목 · 설명 · 참고 자료(일반 첨부) · AI 사전 검토 동의.
// 의뢰자는 이 분야를 잘 모른다는 전제 — 용어 대신 "무엇을 만들고 어디에 쓰는지"만 묻는다.
// 질문·분야별 툴·추가자료는 2단계로 옮겨 이 화면은 짧게 유지한다. 크기는 타입 스케일(§13.9)만 쓴다.
const props = defineProps<{ form: RequestWizardForm }>();
const {
  fields,
  attachments,
  areas,
  devReviewEnabled,
  toggleServiceArea,
  allServiceAreasSelected,
  selectAllServiceAreas,
  addAttachments,
  removeAttachment,
} = props.form;
</script>

<template>
  <div class="grid gap-7">
    <div>
      <h2 class="text-title font-extrabold text-tx-1">어떤 제품을 만들고 싶으신가요?</h2>
      <p class="mt-1 text-body text-tx-2">기술 용어를 몰라도 괜찮습니다. 사용 목적과 원하는 동작을 편하게 적어 주세요.</p>
    </div>

    <!-- 개발 분야 -->
    <div class="grid gap-3">
      <p class="text-label font-semibold text-tx-2">
        어떤 개발이 필요한가요? <span class="text-red-500">*</span>
        <span class="font-normal text-tx-3">(여러 개 선택 가능)</span>
      </p>
      <!-- 3×2 격자: 분야 카드 5 + "전부 맡길게요" 6번째 카드(§13.9). 색은 아이콘 타일에만, 선택은 카퍼 테두리 + 체크. -->
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          v-for="area in areas"
          :key="area.code"
          type="button"
          class="relative grid gap-3 rounded-2xl border-2 p-4 text-left transition"
          :class="fields.serviceAreas.includes(area.code) ? 'border-copper-500 bg-copper-50' : 'border-line bg-white hover:border-line-2'"
          :aria-pressed="fields.serviceAreas.includes(area.code)"
          @click="toggleServiceArea(area.code)"
        >
          <span
            class="absolute right-3.5 top-3.5 flex h-5 w-5 items-center justify-center rounded-full border-2 text-micro font-bold"
            :class="fields.serviceAreas.includes(area.code) ? 'border-copper-500 bg-copper-500 text-white' : 'border-line-2 text-transparent'"
          >✓</span>
          <AreaIcon :code="area.code" />
          <span class="grid gap-0.5 pr-6">
            <span class="text-lead font-extrabold text-tx-1">{{ area.label }}</span>
            <span class="text-label leading-relaxed text-tx-3">{{ area.hint }}</span>
          </span>
        </button>
        <button
          type="button"
          class="grid gap-3 rounded-2xl border-2 border-dashed p-4 text-left transition"
          :class="allServiceAreasSelected ? 'border-copper-500 bg-copper-50' : 'border-line-2 bg-paper hover:border-tx-3'"
          :aria-pressed="allServiceAreasSelected"
          @click="selectAllServiceAreas()"
        >
          <span class="flex h-10 w-10 items-center justify-center rounded-xl border border-dashed text-lead font-bold" :class="allServiceAreasSelected ? 'border-copper-500 text-copper-600' : 'border-line-2 text-tx-3'">?</span>
          <span class="grid gap-0.5">
            <span class="text-lead font-extrabold text-tx-1">{{ allServiceAreasSelected ? '5개 분야 모두' : '잘 모르겠어요 — 전부 맡길게요' }}</span>
            <span class="text-label leading-relaxed text-tx-3">고르기 어려우면 전부 선택하고, 무엇을 만들고 싶은지만 아래에 적어 주세요.</span>
          </span>
        </button>
      </div>
      <p v-if="fields.serviceAreas.length === 0" class="text-label text-red-500">
        개발 분야를 1개 이상 선택해 주세요.
      </p>
    </div>

    <!-- 제목·설명 -->
    <label class="grid gap-2 text-label font-semibold text-tx-2">
      <span>프로젝트 제목 <span class="text-red-500">*</span></span>
      <input
        v-model="fields.title"
        type="text"
        placeholder="예: 화분 물 주기 알림 장치"
        class="h-11 rounded-lg border border-line-2 px-3.5 text-body font-normal text-tx-1"
      >
    </label>
    <label class="grid gap-2 text-label font-semibold text-tx-2">
      <span>무엇을 만들고 싶은가요? <span class="text-red-500">*</span></span>
      <textarea
        v-model="fields.description"
        rows="8"
        placeholder="어디에 쓰는 물건인지, 꼭 있어야 하는 기능, 정해진 것(크기·전원·연결 방식 등)이 있으면 적어 주세요. 잘 모르는 부분은 비워 두셔도 됩니다 — 전문가 상담에서 함께 정합니다. (10자 이상)"
        class="rounded-lg border border-line-2 p-3.5 text-body font-normal leading-relaxed text-tx-1"
      />
      <span class="flex justify-between font-normal text-tx-3">
        <span>AI가 설명에서 제품 목적·핵심 기능·사용 환경을 정리합니다. 500자 이상이면 시스템 구성도도 만듭니다.</span>
        <span class="tabular-nums">{{ fields.description.length.toLocaleString() }} / 20,000</span>
      </span>
    </label>

    <!-- 참고 자료(일반 첨부) -->
    <div class="grid gap-2">
      <p class="text-label font-semibold text-tx-2">
        참고 자료 <span class="font-normal text-tx-3">(선택 · 여러 개 가능 — 손그림·사진·문서 무엇이든)</span>
      </p>
      <FileDropZone
        :files="attachments"
        label="PDF · Word · 엑셀 · 이미지 · 손그림 사진"
        hint="여기로 끌어다 놓거나 눌러서 선택 — 나눠 놓아도 쌓입니다. 회로도·거버 같은 분야별 자료는 다음 단계에서 올립니다."
        @add="addAttachments"
        @remove="removeAttachment"
      />
      <p v-if="attachments.length === 0" class="rounded-xl bg-amber-50 px-4 py-3 text-label leading-relaxed text-amber-800">
        자료가 있으면 검토서가 훨씬 정확해집니다. 준비가 어려우면 유선 상담(070-8667-1080)을 이용해 주세요.
      </p>
    </div>

    <!-- AI 사전 검토 동의 + 외부 전송 고지 -->
    <label class="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-label leading-relaxed text-blue-900">
      <input v-model="fields.aiConsent" type="checkbox" class="mt-1">
      <span>
        <b class="text-body">AI 사전 검토 동의</b> — 적어 주신 내용과 첨부에서 추출한 텍스트·이미지를 AI 분석에 외부 서버로
        보내 <b>AI 사전 검토서</b>(요약·개발명세서)를 만들고, 같은 자료로 <b>시스템 구성도</b>를 만들어 알려드립니다.
        공개 범위는 설명과 같습니다.
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
