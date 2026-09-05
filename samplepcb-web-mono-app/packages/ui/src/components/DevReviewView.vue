<script setup lang="ts">
import { computed } from 'vue';
import {
  DEV_REVIEW_DISCLAIMER,
  DEV_REVIEW_SCHEDULE_CAPTION,
  devReviewScheduleFit,
  devReviewScheduleTotals,
  marketAreaLabel,
} from '@sp/api-contract';
import type { MarketDevDiagramViewType, MarketDevReviewType } from '@sp/api-contract';
import { buildDevReviewView } from '@sp/utils';
import AreaIcon from './AreaIcon.vue';
import DevDiagramSection from './DevDiagramSection.vue';

// AI 사전 검토서 뷰 v4(docs/AI_DEV_REVIEW.md §13·§13.7·§13.9) — 고객·전문가가 같은 JSON 을 같은 순서로 본다.
// 위저드 미리보기와 프로젝트 상세가 공유한다: 요약·핵심 요구사항 → 시스템 구성도(+상의 항목) → 기술개발 검토 결과 → 개발명세서.
// 고객 의뢰내용(답변 표)은 §13.9 에서 뺐다 — 상세는 "의뢰 내용" 섹션에, 위저드는 폼 자체에 이미 있어 두 번 보였다.
// 시스템 구성도는 검토서 JSON 이 아니라 별도 산출물(kimi 자유 SVG, 비동기)이라 `diagram` prop 으로 받는다 —
// 위저드 3단계에선 진행 메타만(html null), 상세에선 완성본. 확정된 것만 보이고, 정해지지 않은 것은
// "전문가와 상의할 항목" 한 목록뿐이다. 근거(출처)는 고객 화면에 펼치지 않는다(관리자 축약본만).
// 판정어·리스크 등급·금액·주수는 어디에도 쓰지 않는다. 분야 카드는 2열(14px 본문에서 3열은 좁다).

const props = withDefaults(defineProps<{
  review: MarketDevReviewType;
  title?: string;
  diagram?: MarketDevDiagramViewType | null;
  diagramSkipReason?: string | null;
  diagramFailed?: boolean;
  diagramReused?: boolean; // 3단계: 같은 입력의 이전 잡을 재사용
  canRegenerateDiagram?: boolean;
  diagramRegenerating?: boolean;
  diagramRegenerateError?: string;
}>(), {
  title: '',
  diagram: null,
  diagramSkipReason: null,
  diagramFailed: false,
  diagramReused: false,
  canRegenerateDiagram: false,
  diagramRegenerating: false,
  diagramRegenerateError: '',
});
const emit = defineEmits<{ regenerateDiagram: [] }>();

const view = computed(() => buildDevReviewView(props.review));
const areaLabel = (area: string): string => marketAreaLabel(area);
const areaColor = (area: string): string => `var(--color-area-${area})`;
const diagramView = computed<MarketDevDiagramViewType>(() => props.diagram ?? { meta: null, html: null });

// 개발 일정(예상) — 개발의뢰(sp-develop) 검토서에만 있는 블록. 마켓·옛 저장분엔 schedule 이 없어 섹션째 빠진다.
// 합계와 희망 시점 대조는 저장값이 아니라 계약의 순수 함수로 매번 계산한다(관리자가 단계를 고치면 바로 따라온다).
const schedule = computed(() => props.review.schedule ?? null);
const scheduleTotals = computed(() => devReviewScheduleTotals(schedule.value));
const scheduleFit = computed(() => devReviewScheduleFit(schedule.value));
const FIT_CLASS = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  tight: 'border-amber-200 bg-amber-50 text-amber-900',
  over: 'border-red-200 bg-red-50 text-red-800',
  unknown: 'border-line bg-paper text-tx-3',
} as const;

// 생성 시각 — 서버 ISO(UTC)를 KST 로 옮겨 분 단위까지 작게 표시한다.
const generatedAtLabel = computed(() => {
  const parsed = new Date(props.review.meta.generatedAt);
  if (Number.isNaN(parsed.getTime())) return props.review.meta.generatedAt;
  const kst = new Date(parsed.getTime() + 9 * 3600_000).toISOString();
  return `${kst.slice(0, 10)} ${kst.slice(11, 16)}`;
});
</script>

<template>
  <div class="grid gap-8">
    <!-- 헤더 — 확정/상의 개수 · 요약 한 줄 · 핵심 요구사항 -->
    <header class="grid gap-4">
      <div class="flex flex-wrap items-start gap-3">
        <div>
          <p class="font-mono text-micro tracking-[.14em] text-tx-3">AI PRE-REVIEW</p>
          <h2 class="text-title font-extrabold text-tx-1">AI 사전 검토서</h2>
        </div>
        <div class="ml-auto flex flex-wrap gap-1.5 text-micro font-bold">
          <span class="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">{{ view.areaBadge }}</span>
          <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">확정 {{ view.factCount }}</span>
          <span v-if="view.openQuestions.length > 0" class="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">상의 {{ view.openQuestions.length }}</span>
        </div>
      </div>
      <p v-if="review.summary !== ''" class="max-w-[900px] text-lead font-semibold leading-relaxed text-tx-1">{{ review.summary }}</p>
      <p class="text-micro text-tx-3">
        {{ review.meta.model }} · {{ generatedAtLabel }} 생성
        <template v-if="review.meta.attachmentFiles.length > 0"> · 첨부 {{ review.meta.attachmentFiles.join(', ') }}</template>
        · 고객이 적어 주신 내용과 자료만으로 만든 AI 사전 검토입니다.
      </p>
      <div class="grid gap-2.5">
        <p class="text-label font-semibold text-tx-2">핵심 개발 요구사항</p>
        <ul v-if="review.requirements.length > 0" class="grid gap-2">
          <li v-for="(item, i) in review.requirements" :key="i" class="flex gap-2.5 text-body leading-relaxed text-tx-1">
            <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-micro font-bold text-emerald-700">✓</span>
            <span>{{ item.text }}</span>
          </li>
        </ul>
        <p v-else class="text-body leading-relaxed text-tx-3">설명에서 확정된 요구가 아직 없습니다. 전문가 상담에서 함께 정리합니다.</p>
      </div>
    </header>

    <!-- ① 시스템 구성도 — 별도 산출물(3단계에서 병렬 시작, 비동기 완성) + 상의 항목 -->
    <section class="grid gap-4 border-t border-line pt-7">
      <DevDiagramSection
        :diagram="diagramView"
        :skip-reason="diagramSkipReason"
        :failed="diagramFailed"
        :reused="diagramReused"
        :can-regenerate="canRegenerateDiagram"
        :regenerating="diagramRegenerating"
        :regenerate-error="diagramRegenerateError"
        @regenerate="emit('regenerateDiagram')"
      />
      <!-- 노란 메모 — 도면 안에는 자료에 있는 것만 두고 미정·확인 사항은 도면 바로 아래 이 한 목록에 모은다(§12 결정 13). -->
      <div v-if="view.openQuestions.length > 0" class="grid gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p class="text-body font-bold text-amber-900">
          전문가와 상의할 항목
          <span class="ml-1 text-label font-normal text-amber-700">구성도에 없는 것은 아직 정해지지 않은 것입니다</span>
        </p>
        <ol class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <li v-for="(q, i) in view.openQuestions" :key="i" class="grid grid-cols-[24px_1fr] gap-2 text-body leading-relaxed text-amber-900">
            <span class="font-mono text-micro font-semibold text-amber-700">{{ i + 1 }}</span>
            <span>
              <b>{{ q.question }}</b>
              <span v-if="q.why !== ''" class="block text-label text-amber-800">{{ q.why }}</span>
              <!-- 개발의뢰: 담당자가 상담 뒤 적은 확인 결과(additive 필드) -->
              <span v-if="q.resolution" class="mt-1 block rounded-lg bg-white/70 px-2.5 py-1.5 text-label text-emerald-800">
                <b class="mr-1 text-emerald-700">확인 결과</b>{{ q.resolution }}
              </span>
            </span>
          </li>
        </ol>
      </div>
    </section>

    <!-- ② 기술개발 검토 결과 — 분야별 준비 상태(확정 n·상담 m) + 검토 관찰 + 답변↔자료 정합(§12.10). -->
    <section class="grid gap-4 border-t border-line pt-7">
      <div>
        <p class="font-mono text-micro tracking-[.14em] text-emerald-700">AI REVIEW</p>
        <h3 class="text-lead font-extrabold text-tx-1">기술개발 검토 결과</h3>
        <p class="mt-1 text-label text-tx-3">
          분야별로 자료에서 확정된 것과 상담에서 정할 것을 셌습니다.
          <template v-if="review.meta.attachmentFiles.length > 0"> 첨부 {{ review.meta.attachmentFiles.length }}건을 읽었습니다.</template>
          <template v-if="view.generalOpenCount > 0"> 분야 공통 상의 항목 {{ view.generalOpenCount }}건은 위 목록에 있습니다.</template>
        </p>
      </div>
      <div v-if="view.checks.length > 0" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p class="text-body font-bold text-amber-900">답변과 자료가 다릅니다 — 자료를 우선해 검토서를 썼습니다</p>
        <ul class="mt-1.5 grid gap-1">
          <li v-for="c in view.checks" :key="c.code" class="text-label leading-relaxed text-amber-900">
            <span class="font-bold">{{ c.answer }}</span>
            <span class="text-amber-700"> 로 답하셨는데 자료에 </span>
            <span class="font-bold">{{ c.found.join(' · ') }}</span>
            <span class="text-amber-700"> 이(가) 나옵니다.</span>
          </li>
        </ul>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div v-for="card in view.areaCards" :key="card.area" class="grid content-start gap-2.5 rounded-2xl border border-line bg-white p-5">
          <p class="flex items-center gap-2.5 text-lead font-bold text-tx-1"><AreaIcon :code="card.area" size="sm" />{{ card.label }}</p>
          <p v-if="card.summary !== ''" class="text-label leading-relaxed text-tx-2">{{ card.summary }}</p>
          <div class="flex flex-wrap gap-1.5 text-micro font-bold">
            <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-700">자료에서 확정 {{ card.factCount }}</span>
            <span v-if="card.openCount > 0" class="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">상담에서 정할 것 {{ card.openCount }}</span>
          </div>
          <p v-if="card.factCount === 0 && card.observations.length === 0" class="text-label leading-relaxed text-tx-3">
            자료에 이 분야 내용이 없습니다. 전문가 상담에서 정리합니다.
          </p>
          <ul v-if="card.observations.length > 0" class="grid gap-1.5 border-t border-line pt-2.5">
            <li v-for="(o, i) in card.observations" :key="i" class="flex gap-2 text-label leading-relaxed text-tx-2">
              <span class="shrink-0 text-tx-3">›</span>
              <span>{{ o.text }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- ②-2 개발 일정(예상) — 검토서의 일정은 **예상**이고, 확정 기간은 견적서가 정한다(§6). -->
    <section v-if="schedule !== null && schedule.phases.length > 0" class="grid gap-4 border-t border-line pt-7">
      <div>
        <p class="font-mono text-micro tracking-[.14em] text-brand-600">ESTIMATED SCHEDULE</p>
        <h3 class="text-lead font-extrabold text-tx-1">개발 일정(예상)</h3>
        <p class="mt-1 text-label text-tx-3">단계마다 최소~최대 주로 적었습니다. 고객이 먼저 주셔야 할 자료가 있는 단계는 선행 조건에 적혀 있습니다.</p>
      </div>

      <div class="grid gap-2">
        <!-- 표 머리 — 좁은 폭에선 감추고 각 행이 카드로 접힌다(명세 표와 같은 관례) -->
        <div class="hidden gap-3 px-4 text-micro font-semibold text-tx-3 sm:grid sm:grid-cols-[minmax(0,1.2fr)_86px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <span>단계</span><span>기간(주)</span><span>산출물</span><span>선행 조건</span><span>비고</span>
        </div>
        <div
          v-for="(phase, i) in schedule.phases"
          :key="i"
          class="grid gap-1.5 rounded-2xl border border-line bg-white px-4 py-3 sm:grid-cols-[minmax(0,1.2fr)_86px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-start sm:gap-3"
        >
          <p class="min-w-0 text-body font-bold text-tx-1">{{ phase.name }}</p>
          <p class="min-w-0 text-body font-semibold text-tx-2">
            <span class="mr-1 text-micro font-semibold text-tx-3 sm:hidden">기간</span>
            {{ phase.minWeeks }}~{{ phase.maxWeeks }}주
          </p>
          <p v-if="phase.output !== ''" class="min-w-0 text-label leading-relaxed text-tx-2">
            <span class="mr-1 text-micro font-semibold text-tx-3 sm:hidden">산출물</span>{{ phase.output }}
          </p>
          <span v-else class="hidden sm:block" />
          <p v-if="phase.prerequisite !== ''" class="min-w-0 text-label leading-relaxed text-tx-2">
            <span class="mr-1 text-micro font-semibold text-tx-3 sm:hidden">선행 조건</span>{{ phase.prerequisite }}
          </p>
          <span v-else class="hidden sm:block" />
          <p v-if="phase.note !== ''" class="min-w-0 text-label leading-relaxed text-tx-3">
            <span class="mr-1 text-micro font-semibold text-tx-3 sm:hidden">비고</span>{{ phase.note }}
          </p>
          <span v-else class="hidden sm:block" />
        </div>
      </div>

      <div class="grid gap-2">
        <p class="text-body font-bold text-tx-1">
          예상 합계 {{ scheduleTotals.minWeeks }}~{{ scheduleTotals.maxWeeks }}주
        </p>
        <p class="rounded-xl border px-4 py-2.5 text-label leading-relaxed" :class="FIT_CLASS[scheduleFit.status]">
          {{ scheduleFit.text }}
        </p>
        <p v-if="schedule.assumptions !== ''" class="text-label leading-relaxed text-tx-2">
          전제 — {{ schedule.assumptions }}
        </p>
        <p class="text-micro leading-relaxed text-tx-3">{{ DEV_REVIEW_SCHEDULE_CAPTION }}</p>
      </div>
    </section>

    <!-- ③ 개발명세서 -->
    <section class="grid gap-4 border-t border-line pt-7">
      <div>
        <p class="font-mono text-micro tracking-[.14em] text-emerald-700">DEVELOPMENT SPECIFICATION</p>
        <h3 class="text-lead font-extrabold text-tx-1">개발명세서</h3>
        <p class="mt-1 text-label text-tx-3">고객 자료에서 확정된 항목만 담았습니다. 나머지는 전문가가 상담 후 채웁니다.</p>
      </div>
      <div class="grid gap-2.5">
        <div
          v-for="area in review.areas"
          :key="area.area"
          class="grid gap-3 rounded-2xl border border-line bg-white p-5 sm:grid-cols-[150px_1fr]"
        >
          <p class="text-body font-bold" :style="{ color: areaColor(area.area) }">{{ areaLabel(area.area) }}</p>
          <div v-if="area.spec.length > 0" class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <div v-for="(row, i) in area.spec" :key="i" class="grid gap-0.5">
              <p class="text-micro font-semibold text-tx-3">{{ row.item }}</p>
              <p class="text-body leading-relaxed text-tx-1">{{ row.text }}</p>
            </div>
          </div>
          <p v-else class="text-body text-tx-3">상담 후 작성</p>
        </div>
      </div>
    </section>

    <!-- 개발의뢰: 담당자 의견(자유 서술, 줄바꿈 유지 — additive 필드, 마켓 저장분엔 없다) -->
    <section v-if="review.adminComment" class="grid gap-3 border-t border-line pt-7">
      <div>
        <p class="font-mono text-micro tracking-[.14em] text-brand-600">ENGINEER'S NOTE</p>
        <h3 class="text-lead font-extrabold text-tx-1">담당자 의견</h3>
      </div>
      <p class="whitespace-pre-line rounded-2xl border border-brand-100 bg-brand-50 p-5 text-body leading-relaxed text-tx-1">{{ review.adminComment }}</p>
    </section>

    <p class="rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-3">{{ DEV_REVIEW_DISCLAIMER }}</p>
  </div>
</template>
