<script setup lang="ts">
import { computed } from 'vue';
import { MARKET_BUDGET_RANGE_LABELS, marketAnswerText, marketAreaBadge } from '@sp/api-contract';
import type { RequestWizardForm } from '../../composables/useRequestWizardForm';
import type { DevReviewJob } from '../../composables/useDevReviewJob';

// 위저드 우측 sticky 사이드(docs/AI_DEV_REVIEW.md §13.9) — 스텝마다 다른 것을 보인다:
//   ① AI 가 도와드려요(무엇을 묻고 무엇을 안 묻는지) + 예상 작성 시간
//   ② 프로젝트 공통 조건 진행(n/6, 항목별 값) + AI 안내
//   ③ 최종 의뢰 요약(제목·분야·조건·답변·첨부·검토서 상태) — 옛 3스텝 하단 "최종 의뢰 내용" 블록이 여기로 왔다.
// 폼 값만 읽는다(쓰지 않는다). 좁은 화면에서는 본문 아래로 내려간다.
const props = defineProps<{ form: RequestWizardForm; job: DevReviewJob }>();
const { fields, currentStep, conditionQuestions, conditionProgress, buildAnswers, activeQuestions, totalAttachmentCount, selectedAreas } = props.form;
const { active: aiActive, blocking, includable, running, diagramMeta } = props.job;

const answerLabel = (code: string): string | null => {
  const a = buildAnswers().find((x) => x.code === code);
  return a === undefined ? null : marketAnswerText(a);
};
const conditionRows = computed(() => [
  { label: '예상 개발 예산', value: fields.budgetRange === null ? null : MARKET_BUDGET_RANGE_LABELS[fields.budgetRange] },
  ...conditionQuestions.map((q) => ({ label: q.short, value: answerLabel(q.code) })),
  { label: '견적 방식', value: fields.method === 'open' ? '역견적' : fields.targetExpertId === null ? null : '지정견적' },
  { label: 'NDA', value: fields.ndaRequired ? '보호' : '없음' },
]);
const answeredCount = computed(() => buildAnswers().length);
const areaBadge = computed(() => marketAreaBadge(selectedAreas.value));
const deadlineLabel = computed(() => (fields.deadlineMode === 'date' ? fields.deadlineDate || '날짜 미정' : `${fields.deadlineMode}일 뒤`));
const reviewStatus = computed(() => {
  if (!aiActive.value) return '검토서 없이 등록';
  if (running.value || blocking.value) return '검토서 생성 중';
  return includable.value ? '검토서 포함' : '검토서 없이 등록';
});
const diagramStatus = computed(() => {
  const s = diagramMeta.value?.status;
  if (s === 'queued' || s === 'running') return '만드는 중 · 등록 뒤에도 계속';
  if (s === 'done') return '완성';
  if (s === 'skipped') return '자료 부족으로 생략';
  return null;
});
</script>

<template>
  <aside class="grid gap-4 lg:sticky lg:top-6">
    <!-- ② 조건 진행 -->
    <div v-if="currentStep === 'details'" class="grid gap-3 rounded-2xl border border-line bg-white p-5">
      <p class="font-mono text-micro tracking-[.14em] text-tx-3">STEP 2 OF 3</p>
      <p class="text-lead font-bold text-tx-1">
        공통 조건 <span class="tabular-nums text-copper-700">{{ conditionProgress.done }}/{{ conditionProgress.total }}</span>
      </p>
      <div class="grid gap-2">
        <div v-for="row in conditionRows" :key="row.label" class="flex items-center justify-between gap-3 text-label">
          <span class="text-tx-2">{{ row.label }}</span>
          <span class="truncate font-semibold" :class="row.value === null ? 'text-copper-700' : 'text-tx-1'">{{ row.value ?? '아직' }}</span>
        </div>
      </div>
      <p class="text-label text-tx-3">조건 {{ conditionProgress.total }}개가 채워지면 '다음'이 열립니다.</p>
    </div>

    <!-- ③ 최종 요약 -->
    <div v-else-if="currentStep === 'review'" class="grid gap-3 rounded-2xl border border-line bg-white p-5">
      <p class="font-mono text-micro tracking-[.14em] text-tx-3">STEP 3 OF 3</p>
      <p class="text-lead font-bold text-tx-1">{{ fields.title || '(제목 미입력)' }}</p>
      <div class="grid gap-2 text-label">
        <div class="flex justify-between gap-3"><span class="text-tx-2">개발 분야</span><span class="truncate font-semibold text-tx-1">{{ areaBadge }}</span></div>
        <div v-for="row in conditionRows" :key="row.label" class="flex justify-between gap-3">
          <span class="text-tx-2">{{ row.label }}</span><span class="truncate font-semibold text-tx-1">{{ row.value ?? '미정' }}</span>
        </div>
        <div class="flex justify-between gap-3"><span class="text-tx-2">견적 마감</span><span class="font-semibold text-tx-1">{{ deadlineLabel }}</span></div>
        <div class="flex justify-between gap-3"><span class="text-tx-2">질문 답변</span><span class="font-semibold tabular-nums text-tx-1">{{ answeredCount }} / {{ activeQuestions.length }}</span></div>
        <div class="flex justify-between gap-3"><span class="text-tx-2">첨부</span><span class="font-semibold tabular-nums text-tx-1">{{ totalAttachmentCount }}개</span></div>
        <div class="flex justify-between gap-3"><span class="text-tx-2">AI 사전 검토서</span><span class="font-semibold text-tx-1">{{ reviewStatus }}</span></div>
        <div v-if="diagramStatus !== null" class="flex justify-between gap-3"><span class="text-tx-2">시스템 구성도</span><span class="font-semibold text-tx-1">{{ diagramStatus }}</span></div>
      </div>
    </div>

    <!-- ① / 공통: AI 안내 -->
    <div class="grid gap-3 rounded-2xl bg-ink-900 p-5 text-dk-tx-2">
      <p class="font-mono text-micro tracking-[.14em] text-dk-tx-2/70">AI가 도와드려요</p>
      <p class="text-lead font-bold leading-snug text-dk-tx-1">긴 기술 설문 없이 필요한 내용만 확인합니다</p>
      <ul class="grid gap-1.5 text-label leading-relaxed">
        <li>· 전문가가 정할 기술 사항(통신 방식·MCU·기판 층수)은 묻지 않습니다.</li>
        <li>· 잘 모르는 질문은 '전문가 추천'을 고르면 검토서의 상의 항목으로 넘어갑니다.</li>
        <li v-if="currentStep !== 'review'">· 마지막 단계에서 AI 사전 검토서가 약 30초~3분에 만들어집니다.</li>
        <li v-else>· 시스템 구성도는 등록 뒤에도 계속 만들어지고, 완성되면 알림과 메일로 알려드립니다.</li>
      </ul>
    </div>

    <div v-if="currentStep === 'describe'" class="grid gap-1.5 rounded-2xl border border-line bg-white p-5">
      <p class="text-lead font-bold text-tx-1">예상 작성 시간 <span class="text-copper-700">약 3분</span></p>
      <p class="text-label leading-relaxed text-tx-3">분야 2개 기준. 계약 전에는 비용이 발생하지 않습니다.</p>
    </div>
  </aside>
</template>
