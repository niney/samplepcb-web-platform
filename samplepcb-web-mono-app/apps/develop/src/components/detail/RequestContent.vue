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
  developAreaBadge,
  developFollowupAnswerText,
  developProductionSummary,
  developWishLabel,
  isDevelopFollowupAnswered,
  isDevelopFollowupUnknown,
} from '@sp/api-contract';
import type { DevelopRequestDetailType } from '@sp/api-contract';
import { buildDevReviewBriefRows } from '@sp/utils';

// 상세 "상세 의뢰 내용" 카드 — 피그마 「00-3 의뢰 상세」 38:9170: 조건 타일 3(개발 메뉴·예산·희망 완료 시기) →
// 의뢰 내용 → 개발 단계(현재·목표) → 시제품·제조 → 세부 질문 답변. 시안에 없는 AI 추가 질문·연락처는 같은 행 모양으로 뒤에 붙인다.
// 라벨은 전부 개발의뢰 계약 사전(DEVELOP_*)과 레지스트리에서 온다 — 이 파일에 한글 라벨을 새로 적지 않는다.
// 위저드 v1 로 접수한 옛 의뢰는 단계·계획이 null 이고 답변에 지금 사전에 없는 코드가 섞여 있다 —
// 그런 행은 코드가 라벨 자리에 그대로 보인다(파싱은 안 깨진다).
const props = defineProps<{ detail: DevelopRequestDetailType }>();

const briefRows = computed(() => buildDevReviewBriefRows(props.detail.answers, DEVELOP_REGISTRY));
// AI 질문(§7.2.2 시스템개발 후속 질문 · §7.2.4 개별 메뉴 맞춤 질문의 새 질문) — 저장분이 있을 때만. 미응답도 행을 남긴다
// (무엇을 물었는지가 견적 근거의 일부다). 맞춤 질문은 새 질문이 없으면 블록째 감춘다(답은 아래 '세부 질문 답변'에 있다).
const aiFollowup = computed(() => {
  const stored = props.detail.aiQuestions;
  return stored?.area !== undefined && stored.questions.length === 0 ? null : stored;
});
const aiRows = computed(() =>
  (aiFollowup.value?.questions ?? []).map((q) => ({
    id: q.id,
    label: q.question,
    value: isDevelopFollowupAnswered(q) ? developFollowupAnswerText(q) : '답하지 않음',
    muted: !isDevelopFollowupAnswered(q) || isDevelopFollowupUnknown(q),
  })),
);
const menuLabel = computed(() => developAreaBadge(props.detail.serviceAreas));
const budgetLabel = computed(() => DEVELOP_BUDGET_RANGE_LABELS[props.detail.budgetRange]);
const currentStageLabel = computed(() => (props.detail.currentStage === null ? '—' : DEVELOP_CURRENT_STAGE_LABELS[props.detail.currentStage]));
const targetStageLabel = computed(() => (props.detail.targetStage === null ? '—' : DEVELOP_TARGET_STAGE_LABELS[props.detail.targetStage]));
const wishLabel = computed(() => {
  const label = developWishLabel(props.detail.wishDate, props.detail.wishNote);
  return label === '' ? '—' : label;
});
const production = computed(() => props.detail.production);
const productionRows = computed(() => {
  const p = production.value;
  if (p === null) return [];
  return [
    { label: '계획', value: developProductionSummary(p) },
    { label: '우선순위', value: p.priority === null ? '' : DEVELOP_PRIORITY_LABELS[p.priority] },
    { label: '자재 조달', value: p.sourcing === null ? '' : DEVELOP_SOURCING_MODE_LABELS[p.sourcing] },
    { label: '납품 형태', value: p.delivery === null ? '' : DEVELOP_DELIVERY_FORM_LABELS[p.delivery] },
  ].filter((r) => r.value !== '');
});
const contactRows = computed(() => {
  const c = props.detail.contact;
  return [
    { label: '담당자', value: c.company === null ? c.name : `${c.name} · ${c.company}`, muted: false },
    { label: '연락', value: `${c.phone} · ${c.email}`, muted: false },
    ...(c.hours === null ? [] : [{ label: '통화 가능 시간', value: c.hours, muted: false }]),
    {
      label: '비밀유지 계약',
      value: props.detail.ndaWanted ? '희망 — 담당자가 계약서를 준비해 연락드립니다' : '희망하지 않음',
      muted: !props.detail.ndaWanted,
    },
  ];
});
</script>

<template>
  <div class="flex flex-col gap-[26px]">
    <!-- 조건 타일 -->
    <div class="grid gap-[20px] leading-[1.8] md:grid-cols-3">
      <div class="flex flex-col gap-[14px] rounded-[12px] bg-[#f5f6f8] px-[14px] py-[16px]">
        <p class="text-[15px] text-[#141e34]">개발 메뉴</p>
        <p class="text-[20px] font-bold text-black">{{ menuLabel }}</p>
      </div>
      <div class="flex flex-col gap-[14px] rounded-[12px] bg-[#f5f6f8] px-[14px] py-[16px]">
        <p class="text-[15px] text-[#141e34]">예산</p>
        <p class="text-[20px] font-bold text-black">{{ budgetLabel }}</p>
      </div>
      <div class="flex flex-col gap-[14px] rounded-[12px] bg-[#f5f6f8] px-[14px] py-[16px]">
        <p class="text-[15px] text-[#141e34]">희망 완료 시기</p>
        <p class="text-[20px] font-bold text-black">{{ wishLabel }}</p>
      </div>
    </div>

    <!-- 의뢰 내용 -->
    <div class="flex flex-col gap-[16px]">
      <div class="flex flex-wrap items-center gap-[8px]">
        <h3 class="text-[18px] font-medium leading-[1.3] text-black">의뢰 내용</h3>
        <span v-if="detail.expertDelegate" class="rounded-[37px] bg-[#1b2b39] px-[8px] py-[4px] text-[12px] font-semibold leading-[1.3] text-white">전문가에게 맡김</span>
      </div>
      <p class="whitespace-pre-wrap rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px] text-[15px] leading-[1.8] text-[#141e34]">{{ detail.description }}</p>
    </div>

    <!-- 개발 단계 -->
    <div class="flex flex-col gap-[16px]">
      <h3 class="text-[18px] font-medium leading-[1.3] text-black">개발 단계</h3>
      <div class="grid gap-[20px] leading-[1.8] md:grid-cols-2">
        <p class="flex flex-wrap items-center gap-[6px] rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px]">
          <span class="text-[15px] text-[#141e34]">현재 개발단계 :</span>
          <span class="text-[16px] font-semibold text-black">{{ currentStageLabel }}</span>
        </p>
        <p class="flex flex-wrap items-center gap-[6px] rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px]">
          <span class="text-[15px] text-[#141e34]">목표 개발단계 :</span>
          <span class="text-[16px] font-semibold text-black">{{ targetStageLabel }}</span>
        </p>
      </div>
    </div>

    <!-- 시제품·제조 -->
    <div v-if="productionRows.length > 0" class="flex flex-col gap-[16px]">
      <h3 class="text-[18px] font-medium leading-[1.3] text-black">시제품·제조</h3>
      <dl class="flex flex-col gap-[10px] rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px] leading-[1.8]">
        <div v-for="row in productionRows" :key="row.label" class="flex items-start gap-[14px]">
          <dt class="w-[100px] shrink-0 text-[15px] font-semibold text-black [overflow-wrap:anywhere]">{{ row.label }}</dt>
          <dd class="min-w-0 flex-1 text-[15px] text-[#141e34]">{{ row.value }}</dd>
        </div>
      </dl>
    </div>

    <!-- AI 추가 질문 — 자료를 읽고 고른 질문과 그 답(질문 문장이 길어 라벨을 한 줄 위에 둔다) -->
    <div v-if="aiFollowup !== null" class="flex flex-col gap-[16px]">
      <h3 class="text-[18px] font-medium leading-[1.3] text-black">AI 추가 질문</h3>
      <p v-if="aiFollowup.understood !== ''" class="rounded-[10px] bg-[#f5f6f8] px-[16px] py-[14px] text-[15px] leading-[1.8] text-[#141e34]">
        <b class="font-semibold text-black">AI 가 이해한 내용</b> — {{ aiFollowup.understood }}
      </p>
      <dl v-if="aiRows.length > 0" class="flex flex-col gap-[14px] rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px] leading-[1.8]">
        <div v-for="row in aiRows" :key="row.id" class="flex flex-col gap-[2px]">
          <dt class="text-[15px] font-semibold text-black">{{ row.label }}</dt>
          <dd class="whitespace-pre-wrap text-[15px]" :class="row.muted ? 'text-[#999]' : 'text-[#141e34]'">{{ row.value }}</dd>
        </div>
      </dl>
      <p v-else class="rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px] text-[15px] leading-[1.8] text-[#999]">자료가 충분해 추가 질문이 없었습니다.</p>
    </div>

    <!-- 세부 질문 답변 -->
    <div v-if="briefRows.length > 0" class="flex flex-col gap-[16px]">
      <h3 class="text-[18px] font-medium leading-[1.3] text-black">세부 질문 답변</h3>
      <dl class="flex flex-col gap-[10px] rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px] leading-[1.8]">
        <div v-for="row in briefRows" :key="row.code" class="flex items-start gap-[14px]">
          <dt class="w-[100px] shrink-0 text-[15px] font-semibold text-black [overflow-wrap:anywhere]">{{ row.label }}</dt>
          <dd class="min-w-0 flex-1 whitespace-pre-wrap text-[15px]" :class="row.unknown ? 'text-[#999]' : 'text-[#141e34]'">{{ row.value }}</dd>
        </div>
      </dl>
    </div>

    <!-- 연락처 · 비밀유지(시안에 없음 — 같은 행 모양) -->
    <div class="flex flex-col gap-[16px]">
      <h3 class="text-[18px] font-medium leading-[1.3] text-black">연락처</h3>
      <dl class="flex flex-col gap-[10px] rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px] leading-[1.8]">
        <div v-for="row in contactRows" :key="row.label" class="flex items-start gap-[14px]">
          <dt class="w-[100px] shrink-0 text-[15px] font-semibold text-black [overflow-wrap:anywhere]">{{ row.label }}</dt>
          <dd class="min-w-0 flex-1 text-[15px]" :class="row.muted ? 'text-[#999]' : 'text-[#141e34]'">{{ row.value }}</dd>
        </div>
      </dl>
    </div>
  </div>
</template>
