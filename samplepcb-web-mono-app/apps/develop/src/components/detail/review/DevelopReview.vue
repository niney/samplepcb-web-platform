<script setup lang="ts">
import { computed } from 'vue';
import { DEVELOP_REGISTRY, DEV_REVIEW_DISCLAIMER } from '@sp/api-contract';
import type { MarketDevReviewType } from '@sp/api-contract';
import { buildDevReviewView } from '@sp/utils';
import { dateTimeKst } from '../../../lib/format';
import ReviewDiagram from './ReviewDiagram.vue';
import ReviewSchedule from './ReviewSchedule.vue';
import ReviewSpec from './ReviewSpec.vue';

// AI 사전 검토서 — 개발의뢰 전용 뷰(피그마 「00-3 의뢰 상세」 38:9509, 사용자 결정 2026-10-22: 공용 DevReviewView 는
// 마켓·관리자가 그대로 쓰고 이 화면만 시안대로). 요약 카드(핵심 요구사항) → 시스템 구성도 → 예상 개발 일정 → 개발 명세서.
// 공용 뷰에 있던 "기술개발 검토 결과"(분야별 확정 수·관찰)는 시안에 없어 뺐고, 상의 항목은 명세서의 분야별 "전문가 검토"로 옮겼다.
// 정보 줄에 생성 모델명은 쓰지 않는다(사용자 결정 — 내부 공급사 이름을 고객에게 보이지 않는다).
const props = defineProps<{
  review: MarketDevReviewType | null;
  diagramHtml: string | null;
  diagramUploaded: boolean;
  diagramGeneratedAt: string | null;
  versionLabel: string;
  pendingNote: string;
  wishLabel: string; // 의뢰의 희망 완료 시기(날짜 또는 자유문) — 일정 카드의 희망 시점 칸
}>();

const view = computed(() => (props.review === null ? null : buildDevReviewView(props.review, DEVELOP_REGISTRY)));
const TAIL = '고객이 적어 주신 내용과 자료만으로 만든 AI 사전 검토입니다.';
const metaParts = (generatedAt: string | null): string[] => {
  const parts: string[] = [];
  if (generatedAt !== null && generatedAt !== '') parts.push(`${dateTimeKst(generatedAt)} 생성`);
  if (props.versionLabel !== '') parts.push(props.versionLabel);
  const files = props.review?.meta.attachmentFiles ?? [];
  if (files.length > 0) parts.push(`첨부 ${files.join(', ')}`);
  return parts;
};
const reviewMeta = computed(() => [...metaParts(props.review?.meta.generatedAt ?? null), TAIL].join(' · '));
const diagramMeta = computed(() =>
  props.diagramUploaded ? '담당자가 검토 후 작성한 구성도입니다.' : [...metaParts(props.diagramGeneratedAt), TAIL].join(' · '),
);
const schedule = computed(() => props.review?.schedule ?? null);
</script>

<template>
  <div class="flex flex-col gap-[22px]">
    <!-- 검토서 전 — 안내 -->
    <section v-if="review === null" class="flex flex-col gap-[4px] rounded-[14px] bg-white px-[24px] py-[26px] leading-[1.8] shadow-[0_8px_15px_rgba(0,0,0,0.06)]">
      <p class="text-[15px] font-bold text-black">{{ pendingNote }}</p>
      <p class="text-[15px] text-[#141e34]">검토서는 의뢰 자료로 만든 기술 초안입니다. 담당자가 확인한 뒤 공개되며, 확정 사항은 견적서에 담깁니다.</p>
    </section>

    <!-- 요약 · 핵심 요구사항 -->
    <section
      v-else
      class="flex flex-col gap-[16px] rounded-[14px] bg-[linear-gradient(to_left,#bfd5ff,#e1edf3)] px-[24px] py-[26px] shadow-[0_8px_15px_rgba(0,0,0,0.06)]"
    >
      <div class="flex flex-col gap-[4px] leading-[1.8]">
        <h3 class="text-[18px] font-semibold text-black">{{ review.summary !== '' ? review.summary : 'AI 사전 검토서' }}</h3>
        <p class="text-[14px] text-[#666]">{{ reviewMeta }}</p>
      </div>
      <ul v-if="review.requirements.length > 0" class="grid gap-[8px] md:grid-cols-2">
        <li
          v-for="(req, i) in review.requirements"
          :key="i"
          class="flex items-center rounded-[10px] bg-white px-[16px] py-[10px] text-[17px] font-medium leading-[1.8] text-black"
        >
          {{ req.text }}
        </li>
      </ul>
      <p v-else class="rounded-[10px] bg-white px-[16px] py-[10px] text-[15px] leading-[1.8] text-[#666]">
        설명에서 확정된 요구가 아직 없습니다. 전문가 상담에서 함께 정리합니다.
      </p>
      <div v-if="view !== null && view.checks.length > 0" class="rounded-[10px] bg-white px-[16px] py-[10px] text-[15px] leading-[1.8] text-amber-900">
        <p class="font-semibold">답변과 자료가 다릅니다 — 자료를 우선해 검토서를 썼습니다</p>
        <p v-for="c in view.checks" :key="c.code" class="text-[14px]">
          <b>{{ c.answer }}</b> 로 답하셨는데 자료에 <b>{{ c.found.join(' · ') }}</b> 이(가) 나옵니다.
        </p>
      </div>
    </section>

    <ReviewDiagram v-if="diagramHtml !== null" :html="diagramHtml" :meta-line="diagramMeta" />

    <template v-if="review !== null">
      <ReviewSchedule v-if="schedule !== null && schedule.phases.length > 0" :schedule="schedule" :wish-label="wishLabel" />
      <ReviewSpec :review="review" />

      <!-- 담당자 의견(시안에 없음 — 같은 카드 모양) -->
      <section v-if="review.adminComment" class="flex flex-col gap-[8px] rounded-[14px] bg-white px-[24px] py-[26px] shadow-[0_8px_15px_rgba(0,0,0,0.06)]">
        <h3 class="text-[18px] font-bold leading-[1.8] text-black">담당자 의견</h3>
        <p class="whitespace-pre-line rounded-[10px] border border-[#d7deec] bg-[#f1f6ff] px-[16px] py-[14px] text-[15px] leading-[1.8] text-[#141e34]">{{ review.adminComment }}</p>
      </section>

      <p class="px-[4px] text-[14px] leading-[1.8] text-[#666]">{{ DEV_REVIEW_DISCLAIMER }}</p>
    </template>
  </div>
</template>
