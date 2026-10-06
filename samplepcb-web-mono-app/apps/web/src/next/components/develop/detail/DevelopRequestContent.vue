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
} from '@sp/api-contract';
import type { AdminDevelopRequestDetailType } from '@sp/api-contract';
import { apiErrorMessage } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import { downloadAdminDevelopFile } from '@/components/admin/develop/develop-files';
import { formatDateTime } from '@/lib/format';
import { Badge } from '@/next/components/ui/badge';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { developRequestModeVariant } from '@/next/components/develop/develop-badges';
import ActionNotice from './ActionNotice.vue';
import DevelopFileRow from '@/next/components/develop/DevelopFileRow.vue';

// 의뢰 내용(옛 components/admin/develop/DevelopRequestContent.vue 와 같은 props·emits) — 설명 · 의뢰 방식/예산/단계/희망 시기 ·
// 시제품·생산 계획 · 연락처 · AI 추가 질문 · 질문 답변 · 첨부.
// 사전은 전부 개발의뢰 레지스트리(DEVELOP_*·develop*)다 — 마켓 사전을 쓰면 기구(mech)가 "mech(종료)" 로, 예산 구간이 다른
// 사전 값으로 어긋난다(위저드 v2, 2026-09-08). 문항 라벨·순서는 레지스트리(developQuestionsFor)가 정본이라 답변 배열이 아니라
// 문항 순서로 표를 만든다. 미리보기 모달은 상세 페이지 한 곳에 있다 — 여기선 대상만 올린다(옆 보기 패널도 같은 모달).
const props = defineProps<{ detail: AdminDevelopRequestDetailType }>();
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
    { key: 'priority', label: t('admin.develop.content.priority'), value: p.priority === null ? '' : DEVELOP_PRIORITY_LABELS[p.priority] },
    { key: 'sourcing', label: t('admin.develop.content.sourcing'), value: p.sourcing === null ? '' : DEVELOP_SOURCING_MODE_LABELS[p.sourcing] },
    { key: 'delivery', label: t('admin.develop.content.delivery'), value: p.delivery === null ? '' : DEVELOP_DELIVERY_FORM_LABELS[p.delivery] },
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
    downloadError.value = apiErrorMessage(error, t('admin.develop.content.downloadFail'));
  }
}
</script>

<template>
  <SectionCard :title="t('admin.develop.content.title')">
    <div class="grid gap-4">
      <Panel tone="muted" class="text-sm leading-relaxed whitespace-pre-line">{{ props.detail.description }}</Panel>

      <dl class="grid grid-cols-[104px_1fr] gap-y-2 text-sm">
        <dt class="text-muted-foreground">{{ t('admin.develop.content.requestMode') }}</dt>
        <dd>
          <Badge :variant="developRequestModeVariant(props.detail.requestMode)">
            {{ DEVELOP_REQUEST_MODE_LABELS[props.detail.requestMode] }}
          </Badge>
        </dd>
        <dt class="text-muted-foreground">{{ t('admin.develop.content.budget') }}</dt>
        <dd class="font-semibold">{{ DEVELOP_BUDGET_RANGE_LABELS[props.detail.budgetRange] }}</dd>
        <dt class="text-muted-foreground">{{ t('admin.develop.content.stage') }}</dt>
        <dd :class="stageLabel === '' ? 'text-muted-foreground' : ''">{{ stageLabel === '' ? '—' : stageLabel }}</dd>
        <dt class="text-muted-foreground">{{ t('admin.develop.content.wish') }}</dt>
        <dd :class="wishLabel === '' ? 'text-muted-foreground' : ''">{{ wishLabel === '' ? '—' : wishLabel }}</dd>
        <dt class="text-muted-foreground">{{ t('admin.develop.content.nda') }}</dt>
        <dd>{{ props.detail.ndaWanted ? t('admin.develop.content.ndaWanted') : t('admin.develop.content.ndaNone') }}</dd>
        <dt class="text-muted-foreground">{{ t('admin.develop.content.aiConsent') }}</dt>
        <dd :class="props.detail.aiConsent ? '' : 'text-warning font-semibold'">
          {{ props.detail.aiConsent ? t('admin.develop.content.aiConsentYes') : t('admin.develop.content.aiConsentNo') }}
        </dd>
      </dl>

      <!-- 시제품·생산 계획(4스텝) — 당사 PCB/BOM 트랙과 직결돼 견적 '별도 실비'의 근거가 된다. -->
      <div class="grid gap-1.5">
        <p class="text-muted-foreground flex flex-wrap items-center gap-2 text-sm font-semibold">
          {{ t('admin.develop.content.production') }}
          <Badge v-if="expertDelegate" variant="warning">{{ t('admin.develop.content.expertDelegate') }}</Badge>
        </p>
        <p v-if="props.detail.production === null" class="text-muted-foreground text-sm">
          {{ t('admin.develop.content.productionNone') }}
        </p>
        <Panel v-else size="sm" class="grid gap-1.5">
          <p class="text-sm font-semibold">{{ productionSummary }}</p>
          <dl class="grid grid-cols-[104px_1fr] gap-y-1.5 text-sm">
            <template v-for="row in productionRows" :key="row.key">
              <dt class="text-muted-foreground">{{ row.label }}</dt>
              <dd :class="row.value === '' ? 'text-muted-foreground' : ''">{{ row.value === '' ? '—' : row.value }}</dd>
            </template>
          </dl>
        </Panel>
      </div>

      <!-- 연락처 — 접수 뒤 전화·미팅으로 요구사항을 좁히는 것이 실무라 필수 항목이다. -->
      <Panel size="sm" class="grid gap-1.5">
        <p class="text-muted-foreground text-sm font-semibold">{{ t('admin.develop.content.contact') }}</p>
        <dl class="grid grid-cols-[104px_1fr] gap-y-1.5 text-sm">
          <dt class="text-muted-foreground">{{ t('admin.develop.content.contactName') }}</dt>
          <dd class="font-semibold">
            {{ props.detail.contact.name }}
            <span v-if="props.detail.contact.company !== null" class="text-muted-foreground font-normal">
              · {{ props.detail.contact.company }}
            </span>
          </dd>
          <dt class="text-muted-foreground">{{ t('admin.develop.content.contactPhone') }}</dt>
          <dd>
            <a class="text-primary font-semibold tabular-nums hover:underline" :href="`tel:${props.detail.contact.phone}`">
              {{ props.detail.contact.phone }}
            </a>
          </dd>
          <dt class="text-muted-foreground">{{ t('admin.develop.content.contactEmail') }}</dt>
          <dd>
            <a class="text-primary hover:underline" :href="`mailto:${props.detail.contact.email}`">{{ props.detail.contact.email }}</a>
          </dd>
          <template v-if="props.detail.contact.hours !== null">
            <dt class="text-muted-foreground">{{ t('admin.develop.content.contactHours') }}</dt>
            <dd>{{ props.detail.contact.hours }}</dd>
          </template>
        </dl>
      </Panel>

      <!-- AI 추가 질문 — 조건 답변 표보다 앞에 둔다(질문 자체가 이 의뢰 고유라 견적 근거로 먼저 읽힌다). -->
      <div v-if="props.detail.aiQuestions !== null" class="grid gap-1.5">
        <p class="text-muted-foreground flex flex-wrap items-baseline gap-2 text-sm font-semibold">
          {{ t('admin.develop.content.aiQuestions', { count: aiQuestionRows.length }) }}
          <span class="font-mono text-xs font-normal">{{ props.detail.aiQuestions.model }}</span>
          <span class="text-xs font-normal tabular-nums">{{ formatDateTime(props.detail.aiQuestions.generatedAt) }}</span>
        </p>
        <p v-if="props.detail.aiQuestions.understood !== ''" class="text-muted-foreground text-xs leading-relaxed">
          <span class="font-semibold">{{ t('admin.develop.content.aiUnderstood') }}</span> · {{ props.detail.aiQuestions.understood }}
        </p>
        <Panel v-if="aiQuestionRows.length > 0" size="sm">
          <dl class="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <template v-for="row in aiQuestionRows" :key="row.id">
              <dt class="text-muted-foreground" :title="row.why">{{ row.question }}</dt>
              <dd v-if="row.answered" class="font-semibold whitespace-pre-line" :class="row.unknown ? 'text-warning' : ''">
                {{ row.value }}
              </dd>
              <dd v-else class="text-muted-foreground" :title="t('admin.develop.content.aiUnanswered')">—</dd>
            </template>
          </dl>
        </Panel>
      </div>

      <div v-if="answerRows.length > 0" class="grid gap-1.5">
        <p class="text-muted-foreground text-sm font-semibold">{{ t('admin.develop.content.answers', { count: answerRows.length }) }}</p>
        <Panel size="sm">
          <dl class="grid grid-cols-[112px_1fr] gap-y-1.5 text-sm">
            <template v-for="row in answerRows" :key="row.code">
              <dt class="text-muted-foreground" :title="row.question">{{ row.label }}</dt>
              <dd :class="[row.unknown ? 'text-warning' : '', row.text ? 'leading-relaxed whitespace-pre-line' : '']">
                {{ row.value }}
              </dd>
            </template>
          </dl>
        </Panel>
      </div>

      <div class="grid gap-1.5">
        <p class="text-muted-foreground text-sm font-semibold">{{ t('admin.develop.content.files', { count: props.detail.files.length }) }}</p>
        <ActionNotice :text="downloadError" error />
        <ul class="grid gap-1">
          <li v-for="f in props.detail.files" :key="f.fileId">
            <DevelopFileRow
              :file="f"
              :slot-label="slotLabel(f.area, f.slot)"
              @preview="emit('preview', { fileId: f.fileId, name: f.name, size: f.size })"
              @download="void downloadFile(f.fileId, f.name)"
            />
          </li>
          <li v-if="props.detail.files.length === 0" class="text-muted-foreground text-sm">{{ t('admin.develop.content.noFiles') }}</li>
        </ul>
      </div>
    </div>
  </SectionCard>
</template>
