<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_CURRENT_STAGE_LABELS,
  DEVELOP_DELIVERY_FORM_LABELS,
  DEVELOP_PRIORITY_LABELS,
  DEVELOP_REQUEST_MODE_LABELS,
  DEVELOP_SOURCING_MODE_LABELS,
  DEVELOP_TARGET_STAGE_LABELS,
  developAnswerText,
  developAreaLabel,
  developFollowupAnswerText,
  developProductionSummary,
  developQuestionsFor,
  developSlotLabel,
  developWishLabel,
  isDevelopFollowupAnswered,
  isDevelopFollowupUnknown,
  isMarketAnswerUnknown,
} from '@sp/api-contract/develop-c';
import type { AdminDevelopRequestDetailType } from '@sp/api-contract/develop-c';
import { apiErrorMessage, canPreview } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import { formatBytes, formatDateTime } from '../../../lib/format';
import { downloadAdminDevelopFile } from './develop-files';

// 의뢰 내용 — 설명 · 의뢰 방식/예산/단계/희망 시기 · 시제품·생산 계획 · 연락처 · AI 추가 질문 · 질문 답변 · 첨부(희망 툴 표시는 2026-09-08 간소화로 뺐다).
// 사전은 전부 개발의뢰 레지스트리(DEVELOP_*·develop*)다 — 마켓 사전을 쓰면 기구(mech)가 "mech(종료)" 로,
// 예산 구간이 다른 사전 값으로 어긋난다(위저드 v2, 2026-09-08).
// 문항 라벨·순서는 레지스트리(developQuestionsFor)가 정본이라, 답변 배열이 아니라 문항 순서로 표를 만든다.
const props = defineProps<{ detail: AdminDevelopRequestDetailType }>();
// 미리보기 모달은 상세 페이지 한 곳에 있다 — 여기선 대상만 올린다(옆 보기 패널에서도 같은 모달을 쓴다).
const emit = defineEmits<{ preview: [file: PreviewTarget] }>();

const { t } = useI18n();

const answerRows = computed(() => {
  const byCode = new Map(props.detail.answers.map((a) => [a.code, a]));
  const known = developQuestionsFor(props.detail.serviceAreas).flatMap((q) => {
    const answer = byCode.get(q.code);
    if (answer === undefined) return [];
    byCode.delete(q.code);
    return [
      {
        code: q.code,
        label: q.short,
        question: q.label,
        value: developAnswerText(answer),
        unknown: isMarketAnswerUnknown(answer),
        text: q.kind === 'text', // 서술 문항 — 줄바꿈을 그대로 보인다
      },
    ];
  });
  // 사전에서 사라졌거나 분야 밖 문항(옛 저장분 v1: timeline·stage…) — 코드 그대로 뒤에 붙인다.
  const rest = [...byCode.values()].map((a) => ({
    code: a.code,
    label: a.code,
    question: '',
    value: developAnswerText(a),
    unknown: isMarketAnswerUnknown(a),
    text: false,
  }));
  return [...known, ...rest];
});

// AI 후속 질문(위저드 3스텝, §7.2.2) — 문항은 잡에서 서버가 박제한 것이고 답만 고객 것이다.
// 고정 3문항 폴백·전문가 맡김·개별 견적은 aiQuestions 가 null 이라 블록 자체가 없다.
const aiQuestionRows = computed(() => {
  const ai = props.detail.aiQuestions;
  if (ai === null) return [];
  return ai.questions.map((q) => ({
    id: q.id,
    question: q.question,
    why: q.why,
    value: developFollowupAnswerText(q),
    answered: isDevelopFollowupAnswered(q),
    unknown: isDevelopFollowupUnknown(q), // '잘 모르겠음' — 답은 받았지만 견적 근거가 아니라 상담 거리다
  }));
});


// 현재 단계 → 목표 단계. 옛 저장분(v1 위저드)은 둘 다 null 이라 행이 "—" 로 남는다.
const stageLabel = computed(() => {
  const from = props.detail.currentStage === null ? null : DEVELOP_CURRENT_STAGE_LABELS[props.detail.currentStage];
  const to = props.detail.targetStage === null ? null : DEVELOP_TARGET_STAGE_LABELS[props.detail.targetStage];
  if (from === null && to === null) return '';
  return `${from ?? '—'} → ${to ?? '—'}`;
});

const wishLabel = computed(() => developWishLabel(props.detail.wishDate, props.detail.wishNote));

// 시제품·생산 계획 — 요약 한 줄(계약 함수)과 우선순위·조달·납품 행. 제작 범위가 없으면 조달·납품은 null 이다.
const productionSummary = computed(() => developProductionSummary(props.detail.production));
const productionRows = computed(() => {
  const p = props.detail.production;
  if (p === null) return [];
  return [
    { key: 'priority', label: t('admin.developC.content.priority'), value: p.priority === null ? '' : DEVELOP_PRIORITY_LABELS[p.priority] },
    { key: 'sourcing', label: t('admin.developC.content.sourcing'), value: p.sourcing === null ? '' : DEVELOP_SOURCING_MODE_LABELS[p.sourcing] },
    { key: 'delivery', label: t('admin.developC.content.delivery'), value: p.delivery === null ? '' : DEVELOP_DELIVERY_FORM_LABELS[p.delivery] },
  ];
});
// 시스템개발에서 "전문가에게 맡김"을 고르면 기술 사양 문항이 통째로 비어 있다 — 답변 표가 얇은 이유를 배지로 밝힌다.
const expertDelegate = computed(() => props.detail.requestMode === 'system' && props.detail.expertDelegate);

const slotLabel = (area: string | null, slot: string | null): string =>
  area === null || slot === null ? '' : `${developAreaLabel(area)} · ${developSlotLabel(area, slot)}`;

const downloadError = ref('');

async function downloadFile(fileId: number, name: string): Promise<void> {
  downloadError.value = '';
  try {
    await downloadAdminDevelopFile(fileId, name);
  } catch (error) {
    downloadError.value = apiErrorMessage(error, t('admin.developC.content.downloadFail'));
  }
}
</script>

<template>
  <section class="rounded-xl border border-gray-200 bg-white p-4">
    <h2 class="text-base font-bold text-gray-800">{{ t('admin.developC.content.title') }}</h2>

    <p class="mt-3 whitespace-pre-line rounded-lg bg-gray-50 p-3 text-sm leading-relaxed text-gray-700">
      {{ detail.description }}
    </p>

    <dl class="mt-4 grid grid-cols-[104px_1fr] gap-y-2 text-sm">
      <dt class="text-gray-500">{{ t('admin.developC.content.requestMode') }}</dt>
      <dd>
        <span
          class="rounded-full px-2 py-0.5 text-xs font-bold"
          :class="detail.requestMode === 'system' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'"
        >
          {{ DEVELOP_REQUEST_MODE_LABELS[detail.requestMode] }}
        </span>
      </dd>
      <dt class="text-gray-500">{{ t('admin.developC.content.budget') }}</dt>
      <dd class="font-semibold text-gray-800">{{ DEVELOP_BUDGET_RANGE_LABELS[detail.budgetRange] }}</dd>
      <dt class="text-gray-500">{{ t('admin.developC.content.stage') }}</dt>
      <dd :class="stageLabel === '' ? 'text-gray-400' : 'text-gray-800'">{{ stageLabel === '' ? '—' : stageLabel }}</dd>
      <dt class="text-gray-500">{{ t('admin.developC.content.wish') }}</dt>
      <dd :class="wishLabel === '' ? 'text-gray-400' : 'text-gray-800'">{{ wishLabel === '' ? '—' : wishLabel }}</dd>
      <dt class="text-gray-500">{{ t('admin.developC.content.nda') }}</dt>
      <dd>{{ detail.ndaWanted ? t('admin.developC.content.ndaWanted') : t('admin.developC.content.ndaNone') }}</dd>
      <dt class="text-gray-500">{{ t('admin.developC.content.aiConsent') }}</dt>
      <dd :class="detail.aiConsent ? 'text-gray-800' : 'font-semibold text-amber-700'">
        {{ detail.aiConsent ? t('admin.developC.content.aiConsentYes') : t('admin.developC.content.aiConsentNo') }}
      </dd>
    </dl>

    <!-- 시제품·생산 계획(4스텝) — 당사 PCB/BOM 트랙과 직결돼 견적 '별도 실비'의 근거가 된다. -->
    <div class="mt-4">
      <p class="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-500">
        {{ t('admin.developC.content.production') }}
        <span v-if="expertDelegate" class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
          {{ t('admin.developC.content.expertDelegate') }}
        </span>
      </p>
      <p v-if="detail.production === null" class="mt-1.5 text-sm text-gray-400">{{ t('admin.developC.content.productionNone') }}</p>
      <div v-else class="mt-1.5 rounded-lg border border-gray-100 px-3 py-2">
        <p class="text-sm font-semibold text-gray-800">{{ productionSummary }}</p>
        <dl class="mt-1.5 grid grid-cols-[104px_1fr] gap-y-1.5 text-sm">
          <template v-for="row in productionRows" :key="row.key">
            <dt class="text-gray-500">{{ row.label }}</dt>
            <dd :class="row.value === '' ? 'text-gray-400' : 'text-gray-800'">{{ row.value === '' ? '—' : row.value }}</dd>
          </template>
        </dl>
      </div>
    </div>

    <!-- 연락처 — 접수 뒤 전화·미팅으로 요구사항을 좁히는 것이 실무라 필수 항목이다. -->
    <div class="mt-4 rounded-lg border border-gray-200 p-3">
      <p class="text-sm font-bold text-gray-500">{{ t('admin.developC.content.contact') }}</p>
      <dl class="mt-1.5 grid grid-cols-[104px_1fr] gap-y-1.5 text-sm">
        <dt class="text-gray-500">{{ t('admin.developC.content.contactName') }}</dt>
        <dd class="font-semibold text-gray-800">
          {{ detail.contact.name }}
          <span v-if="detail.contact.company !== null" class="font-normal text-gray-500"> · {{ detail.contact.company }}</span>
        </dd>
        <dt class="text-gray-500">{{ t('admin.developC.content.contactPhone') }}</dt>
        <dd><a class="font-semibold text-blue-600 hover:underline" :href="`tel:${detail.contact.phone}`">{{ detail.contact.phone }}</a></dd>
        <dt class="text-gray-500">{{ t('admin.developC.content.contactEmail') }}</dt>
        <dd><a class="text-blue-600 hover:underline" :href="`mailto:${detail.contact.email}`">{{ detail.contact.email }}</a></dd>
        <template v-if="detail.contact.hours !== null">
          <dt class="text-gray-500">{{ t('admin.developC.content.contactHours') }}</dt>
          <dd>{{ detail.contact.hours }}</dd>
        </template>
      </dl>
    </div>

    <!-- AI 추가 질문 — 조건 답변 표보다 앞에 둔다(질문 자체가 이 의뢰 고유라 견적 근거로 먼저 읽힌다). -->
    <div v-if="detail.aiQuestions !== null" class="mt-4">
      <p class="flex flex-wrap items-baseline gap-2 text-sm font-bold text-gray-500">
        {{ t('admin.developC.content.aiQuestions', { count: aiQuestionRows.length }) }}
        <span class="font-mono text-[11px] font-normal text-gray-400">{{ detail.aiQuestions.model }}</span>
        <span class="text-[11px] font-normal text-gray-400">{{ formatDateTime(detail.aiQuestions.generatedAt) }}</span>
      </p>
      <p v-if="detail.aiQuestions.understood !== ''" class="mt-1.5 text-xs leading-relaxed text-gray-500">
        <span class="font-semibold">{{ t('admin.developC.content.aiUnderstood') }}</span> · {{ detail.aiQuestions.understood }}
      </p>
      <dl
        v-if="aiQuestionRows.length > 0"
        class="mt-1.5 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg border border-gray-100 px-3 py-2 text-sm"
      >
        <template v-for="row in aiQuestionRows" :key="row.id">
          <dt class="text-gray-500" :title="row.why">{{ row.question }}</dt>
          <dd
            v-if="row.answered"
            class="whitespace-pre-line font-semibold"
            :class="row.unknown ? 'text-amber-700' : 'text-gray-800'"
          >
            {{ row.value }}
          </dd>
          <dd v-else class="text-gray-400" :title="t('admin.developC.content.aiUnanswered')">—</dd>
        </template>
      </dl>
    </div>

    <div v-if="answerRows.length > 0" class="mt-4">
      <p class="text-sm font-bold text-gray-500">{{ t('admin.developC.content.answers', { count: answerRows.length }) }}</p>
      <dl class="mt-1.5 grid grid-cols-[112px_1fr] gap-y-1.5 rounded-lg border border-gray-100 px-3 py-2 text-sm">
        <template v-for="row in answerRows" :key="row.code">
          <dt class="text-gray-500" :title="row.question">{{ row.label }}</dt>
          <dd :class="[row.unknown ? 'text-amber-700' : 'text-gray-800', row.text ? 'whitespace-pre-line leading-relaxed' : '']">
            {{ row.value }}
          </dd>
        </template>
      </dl>
    </div>

    <div class="mt-4">
      <p class="text-sm font-bold text-gray-500">{{ t('admin.developC.content.files', { count: detail.files.length }) }}</p>
      <p v-if="downloadError !== ''" class="mt-1 text-sm font-semibold text-red-600">{{ downloadError }}</p>
      <ul class="mt-1.5 grid gap-1">
        <li
          v-for="f in detail.files"
          :key="f.fileId"
          class="flex min-w-0 items-center gap-2 rounded-lg border border-gray-100 px-3 py-1.5 text-sm"
        >
          <span v-if="slotLabel(f.area, f.slot) !== ''" class="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
            {{ slotLabel(f.area, f.slot) }}
          </span>
          <span class="min-w-0 flex-1 truncate">{{ f.name }}</span>
          <span class="shrink-0 text-xs text-gray-400">{{ formatBytes(f.size) }}</span>
          <button
            v-if="canPreview(f)"
            type="button"
            class="shrink-0 font-bold text-gray-600 hover:text-gray-900"
            @click="emit('preview', { fileId: f.fileId, name: f.name, size: f.size })"
          >
            {{ t('admin.developC.content.preview') }}
          </button>
          <button type="button" class="shrink-0 font-bold text-blue-600 hover:text-blue-700" @click="downloadFile(f.fileId, f.name)">
            {{ t('admin.developC.content.download') }}
          </button>
        </li>
        <li v-if="detail.files.length === 0" class="text-sm text-gray-400">{{ t('admin.developC.content.noFiles') }}</li>
      </ul>
    </div>
  </section>
</template>
