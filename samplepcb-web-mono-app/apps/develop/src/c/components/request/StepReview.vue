<script setup lang="ts">
import { computed } from 'vue';
import {
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_CURRENT_STAGE_LABELS,
  DEVELOP_DELIVERY_FORM_LABELS,
  DEVELOP_PRIORITY_LABELS,
  DEVELOP_REGISTRY,
  DEVELOP_SOURCING_MODE_LABELS,
  DEVELOP_TARGET_STAGE_LABELS,
  developProductionSummary,
  developWishLabel,
} from '@sp/api-contract/develop-c';
import { buildDevReviewBriefRows } from '@sp/utils';
import ContactFields from './ContactFields.vue';
import type { DevelopRequestForm } from '../../composables/useRequestForm';

// 위저드 5스텝 — 검토·접수(2026-09-08 v2).
// 연락처를 여기서 받고(접수 뒤 통화·미팅으로 요구사항을 좁히는 것이 실무다), 앞 네 스텝의 입력을 한 장으로
// 되짚는다. 여기서 고치지 않고 "고치기" 로 해당 스텝에 돌아간다 — 값의 정본은 언제나 그 스텝이다.
// 답변 행은 검토서·관리자 화면과 **같은 함수**(buildDevReviewBriefRows)로 만든다(라벨이 어긋나지 않게).
// AI 후속 질문의 답도 같은 자리에 실린다(문구 규칙은 계약 developFollowupAnswerText — 폼이 만들어 준다).
// 자료 사용 동의는 2스텝으로 옮겼다(§7.2.2) — 자료가 AI 로 나가는 시점이 2→3 전환이기 때문이다.
const props = defineProps<{ form: DevelopRequestForm }>();
const {
  fields,
  contact,
  isSystem,
  skipQuestions,
  menuBadge,
  pickedAreaDefs,
  attachments,
  aiAnswerRows,
  aiFollowupUsed,
  buildAnswers,
  buildProduction,
  goToStep,
} = props.form;

const briefRows = computed(() => buildDevReviewBriefRows(buildAnswers(), DEVELOP_REGISTRY));
// AI 질문 답 + 레지스트리 문항 답 — 둘 다 비면 "답한 항목이 없습니다".
const answerRowCount = computed(() => aiAnswerRows.value.length + briefRows.value.length);
const fileNames = computed(() => attachments.value.map((f) => f.name));
const wishLabel = computed(() =>
  developWishLabel(fields.wishDate === '' ? null : fields.wishDate, fields.wishNote.trim() === '' ? null : fields.wishNote.trim()),
);
const budgetLabel = computed(() => (fields.budgetRange === null ? '미선택' : DEVELOP_BUDGET_RANGE_LABELS[fields.budgetRange]));
const stageLabel = computed(() =>
  fields.currentStage === null || fields.targetStage === null
    ? '미선택'
    : `${DEVELOP_CURRENT_STAGE_LABELS[fields.currentStage]} → ${DEVELOP_TARGET_STAGE_LABELS[fields.targetStage]}`,
);
const productionSummary = computed(() => developProductionSummary(buildProduction()));
const priorityLabel = computed(() => (fields.production.priority === null ? '' : DEVELOP_PRIORITY_LABELS[fields.production.priority]));
const sourcingLabel = computed(() => (fields.production.sourcing === null ? '' : DEVELOP_SOURCING_MODE_LABELS[fields.production.sourcing]));
const deliveryLabel = computed(() => (fields.production.delivery === null ? '' : DEVELOP_DELIVERY_FORM_LABELS[fields.production.delivery]));
const contactLine = computed(() => {
  const who = contact.company.trim() === '' ? contact.name : `${contact.name} · ${contact.company}`;
  return [who, contact.phone, contact.email].filter((s) => s.trim() !== '').join(' · ');
});
</script>

<template>
  <div class="grid gap-7">
    <div class="grid gap-1.5">
      <h2 class="text-title font-extrabold text-tx-1">입력 내용을 확인해 주세요</h2>
      <p class="text-body leading-relaxed text-tx-2">접수 후 담당자가 개발 범위·일정·비용을 검토하여 견적제안서를 전달합니다.</p>
    </div>

    <!-- 연락처 -->
    <section class="grid gap-5 rounded-2xl border-2 border-ink-950 bg-white p-5 sm:p-6">
      <div class="grid gap-1">
        <h3 class="text-body font-extrabold text-tx-1">어떻게 연락드릴까요?</h3>
        <p class="text-label leading-relaxed text-tx-3">
          접수 후 담당자가 전화나 메일로 요구사항을 함께 정리합니다. 그 뒤에 견적제안서를 보내드립니다.
        </p>
      </div>
      <ContactFields :form="form" />
    </section>

    <!-- 검토 카드 -->
    <section class="grid gap-5 rounded-2xl border border-line bg-white p-5 sm:p-6">
      <!-- 선택 메뉴 -->
      <div class="grid gap-2">
        <div class="flex items-baseline gap-2">
          <h3 class="text-label font-bold text-tx-3">선택 메뉴</h3>
          <button type="button" class="ml-auto text-label font-bold text-brand-600 hover:underline" @click="goToStep('menu')">고치기</button>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <span v-if="menuBadge === ''" class="text-body text-tx-3">선택 안 됨</span>
          <span v-else-if="isSystem" class="rounded-full bg-ink-950 px-3 py-1 text-micro font-bold text-white">{{ menuBadge }}</span>
          <template v-else>
            <span
              v-for="area in pickedAreaDefs"
              :key="area.code"
              class="rounded-full bg-paper px-3 py-1 text-micro font-bold text-tx-2"
            >{{ area.label }}</span>
          </template>
          <span v-if="skipQuestions" class="rounded-full border border-line-2 px-3 py-1 text-micro font-bold text-tx-2">전문가에게 맡김</span>
        </div>
      </div>

      <!-- 의뢰 정보 -->
      <div class="grid gap-2 border-t border-line pt-5">
        <div class="flex items-baseline gap-2">
          <h3 class="text-label font-bold text-tx-3">의뢰 정보</h3>
          <button type="button" class="ml-auto text-label font-bold text-brand-600 hover:underline" @click="goToStep('describe')">고치기</button>
        </div>
        <dl class="grid gap-px overflow-hidden rounded-xl bg-line">
          <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
            <dt class="text-label font-semibold text-tx-3">의뢰 제목</dt>
            <dd class="text-body font-bold text-tx-1">{{ fields.title.trim() === '' ? '미입력' : fields.title }}</dd>
          </div>
          <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
            <dt class="text-label font-semibold text-tx-3">의뢰자 · 연락처</dt>
            <dd class="text-body text-tx-1">{{ contactLine === '' ? '미입력' : contactLine }}</dd>
          </div>
          <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
            <dt class="text-label font-semibold text-tx-3">개발단계</dt>
            <dd class="text-body text-tx-1">{{ stageLabel }}</dd>
          </div>
          <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
            <dt class="text-label font-semibold text-tx-3">일정 · 예산</dt>
            <dd class="text-body text-tx-1">{{ wishLabel === '' ? '미입력' : wishLabel }} · {{ budgetLabel }}</dd>
          </div>
        </dl>
      </div>

      <!-- 개발 목적 -->
      <div class="grid gap-2 border-t border-line pt-5">
        <div class="flex items-baseline gap-2">
          <h3 class="text-label font-bold text-tx-3">개발 목적</h3>
          <button type="button" class="ml-auto text-label font-bold text-brand-600 hover:underline" @click="goToStep('describe')">고치기</button>
        </div>
        <p class="whitespace-pre-wrap rounded-xl bg-paper px-4 py-3 text-body leading-relaxed text-tx-1">
          {{ fields.description.trim() === '' ? '미입력' : fields.description }}
        </p>
      </div>

      <!-- 첨부자료 -->
      <div class="grid gap-2 border-t border-line pt-5">
        <div class="flex items-baseline gap-2">
          <h3 class="text-label font-bold text-tx-3">첨부자료</h3>
          <button type="button" class="ml-auto text-label font-bold text-brand-600 hover:underline" @click="goToStep('describe')">고치기</button>
        </div>
        <ul v-if="fileNames.length > 0" class="grid gap-1">
          <li v-for="(name, i) in fileNames" :key="`${name}:${i}`" class="truncate text-body text-tx-1">{{ name }}</li>
        </ul>
        <p v-else class="text-body text-tx-3">등록된 파일 없음</p>
      </div>

      <!-- 세부 질문 답변 — AI 가 고른 질문의 답(있으면)과 레지스트리 문항의 답을 한 곳에 모은다 -->
      <div class="grid gap-2 border-t border-line pt-5">
        <div class="flex flex-wrap items-baseline gap-2">
          <h3 class="text-label font-bold text-tx-3">세부 질문 답변</h3>
          <span v-if="aiFollowupUsed" class="rounded-full bg-brand-50 px-2.5 py-0.5 text-micro font-bold text-brand-700">AI 질문</span>
          <button type="button" class="ml-auto text-label font-bold text-brand-600 hover:underline" @click="goToStep('questions')">고치기</button>
        </div>
        <dl v-if="answerRowCount > 0" class="grid gap-px overflow-hidden rounded-xl bg-line">
          <!-- AI 질문은 문장이 길어 라벨을 한 줄 위에 둔다(잘라 쓰면 무엇을 물었는지 사라진다) -->
          <div v-for="row in aiAnswerRows" :key="row.id" class="grid gap-1 bg-white px-4 py-3">
            <dt class="text-label font-semibold text-tx-3">{{ row.label }}</dt>
            <dd class="whitespace-pre-wrap text-body" :class="row.unknown ? 'text-tx-3' : 'text-tx-1'">{{ row.value }}</dd>
          </div>
          <div v-for="row in briefRows" :key="row.code" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
            <dt class="text-label font-semibold text-tx-3">{{ row.label }}</dt>
            <dd class="whitespace-pre-wrap text-body" :class="row.unknown ? 'text-tx-3' : 'text-tx-1'">{{ row.value }}</dd>
          </div>
        </dl>
        <p v-else class="text-body text-tx-3">
          {{ skipQuestions ? '전문가 검토로 접수합니다 — 담당자가 사양을 제안합니다.' : '답한 항목이 없습니다.' }}
        </p>
      </div>

      <!-- 시제품 · 제조 -->
      <div class="grid gap-2 border-t border-line pt-5">
        <div class="flex items-baseline gap-2">
          <h3 class="text-label font-bold text-tx-3">시제품 · 제조</h3>
          <button type="button" class="ml-auto text-label font-bold text-brand-600 hover:underline" @click="goToStep('production')">고치기</button>
        </div>
        <dl class="grid gap-px overflow-hidden rounded-xl bg-line">
          <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
            <dt class="text-label font-semibold text-tx-3">계획</dt>
            <dd class="text-body text-tx-1">{{ productionSummary }}</dd>
          </div>
          <div v-if="priorityLabel !== ''" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
            <dt class="text-label font-semibold text-tx-3">우선순위</dt>
            <dd class="text-body text-tx-1">{{ priorityLabel }}</dd>
          </div>
          <div v-if="sourcingLabel !== ''" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
            <dt class="text-label font-semibold text-tx-3">자재 조달</dt>
            <dd class="text-body text-tx-1">{{ sourcingLabel }}</dd>
          </div>
          <div v-if="deliveryLabel !== ''" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[132px_1fr] sm:gap-4">
            <dt class="text-label font-semibold text-tx-3">납품 형태</dt>
            <dd class="text-body text-tx-1">{{ deliveryLabel }}</dd>
          </div>
        </dl>
      </div>
    </section>

    <!-- 자료 사용 동의(aiConsent)는 2스텝에서 받았다 — 여기 남는 체크는 비밀유지 희망(선택)뿐이다. -->
    <label class="flex items-start gap-3 rounded-xl border border-line bg-white p-4">
      <input v-model="fields.ndaWanted" type="checkbox" class="mt-0.5 h-4.5 w-4.5 shrink-0 accent-[var(--color-brand-500)]">
      <span class="grid gap-1">
        <span class="text-body font-bold text-tx-1">비밀유지 계약(NDA)을 맺고 싶습니다 <span class="font-normal text-tx-3">선택</span></span>
        <span class="text-label leading-relaxed text-tx-3">담당자가 계약서를 준비해 연락드립니다. 체크하지 않아도 자료는 외부에 공개되지 않습니다.</span>
      </span>
    </label>

    <p class="rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-2">
      <b class="font-bold text-tx-1">다음 단계</b> — AI 검토 초안 작성 → 담당자 기술검토 → 개발 범위·일정·비용 제안
    </p>
  </div>
</template>
