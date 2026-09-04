<script setup lang="ts">
import { computed } from 'vue';
import { MARKET_BUDGET_RANGE_LABELS, marketAreaBadge } from '@sp/api-contract';
import { buildDevReviewBriefRows } from '@sp/utils';
import ContactFields from './ContactFields.vue';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 3스텝 — 연락처·확인(docs/DEVELOP_FLOW.md §2 결정 16).
// 접수 뒤 전화·미팅으로 요구사항을 좁히는 것이 실무라 연락처는 필수다(회사·통화 가능 시간은 선택).
// 요약은 앞 두 스텝의 입력을 한 번에 되짚는 자리 — 여기서 고치지 않고 스텝으로 되돌아간다.
const props = defineProps<{ form: DevelopRequestForm }>();
const { fields, buildAnswers, totalAttachmentCount, goToStep } = props.form;

const areaBadge = computed(() => marketAreaBadge(fields.serviceAreas));
const budgetLabel = computed(() => (fields.budgetRange === null ? '미선택' : MARKET_BUDGET_RANGE_LABELS[fields.budgetRange]));
const briefRows = computed(() => buildDevReviewBriefRows(buildAnswers()));
const answeredCount = computed(() => briefRows.value.length);
</script>

<template>
  <div class="grid gap-7">
    <!-- 연락처 -->
    <section class="grid gap-5 rounded-2xl border-2 border-ink-950 bg-white p-5 sm:p-6">
      <div class="grid gap-1">
        <h2 class="text-title font-extrabold text-tx-1">어떻게 연락드릴까요?</h2>
        <p class="text-label leading-relaxed text-tx-3">
          접수 후 담당자가 전화나 메일로 요구사항을 함께 정리합니다. 그 뒤에 견적서를 보내드립니다.
        </p>
      </div>

      <ContactFields :form="form" />
    </section>

    <!-- 요약 -->
    <section class="grid gap-4 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <div class="flex flex-wrap items-baseline gap-2.5">
        <h2 class="text-title font-extrabold text-tx-1">보내기 전에 한 번</h2>
        <button type="button" class="ml-auto text-label font-bold text-brand-600 hover:underline" @click="goToStep('describe')">
          내용 고치기
        </button>
      </div>
      <dl class="grid gap-px overflow-hidden rounded-xl bg-line text-body">
        <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">개발 분야</dt>
          <dd class="font-bold text-tx-1">{{ areaBadge === '' ? '선택 안 됨' : areaBadge }}</dd>
        </div>
        <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">제목</dt>
          <dd class="font-bold text-tx-1">{{ fields.title.trim() === '' ? '미입력' : fields.title }}</dd>
        </div>
        <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">예산</dt>
          <dd class="text-tx-1">{{ budgetLabel }}</dd>
        </div>
        <div v-for="row in briefRows" :key="row.code" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">{{ row.label }}</dt>
          <dd :class="row.unknown ? 'text-tx-3' : 'text-tx-1'">{{ row.value }}</dd>
        </div>
        <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">답변 · 첨부</dt>
          <dd class="tabular-nums text-tx-1">답변 {{ answeredCount }}개 · 첨부 {{ totalAttachmentCount }}개</dd>
        </div>
        <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
          <dt class="text-label font-semibold text-tx-3">비밀유지 · AI</dt>
          <dd class="text-tx-1">
            {{ fields.ndaWanted ? 'NDA 희망' : 'NDA 미희망' }} · {{ fields.aiConsent ? 'AI 사전 검토 동의' : 'AI 분석 미동의' }}
          </dd>
        </div>
      </dl>
      <p class="rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-2">
        등록하면 담당자에게 바로 알림이 갑니다. 견적이 나가기 전까지는 내용을 수정할 수 있습니다.
      </p>
    </section>
  </div>
</template>
