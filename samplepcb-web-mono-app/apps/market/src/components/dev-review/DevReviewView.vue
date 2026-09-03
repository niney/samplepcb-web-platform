<script setup lang="ts">
import { computed } from 'vue';
import { DEV_REVIEW_DISCLAIMER, MARKET_SERVICE_AREA_LABELS } from '@sp/api-contract';
import type { DevReviewAreaType, MarketDevReviewType } from '@sp/api-contract';
import { buildDevReviewView, renderDevReviewDiagramHtml } from '@sp/utils';
import type { DevReviewDiagramPage } from '@sp/utils';
import DiagramViewer from '../DiagramViewer.vue';

// AI 사전 검토서 뷰 v2(docs/AI_DEV_REVIEW.md §12) — 고객·전문가가 같은 JSON 을 같은 순서로 본다.
// 위저드 미리보기와 프로젝트 상세가 공유한다. 프로토타입(samplepcb-development-review 목업)의
// 섹션 언어를 따른다: 고객 의뢰내용 → 제안 시스템 구성도 → 기술개발 검토 결과 → 개발명세서.
// (작업 항목·개발 단계는 분야 사전으로 찍히는 정적 안내라 AI 판단처럼 읽혀 2026-09-03 제거.)
// 확정된 것만 보이고, 정해지지 않은 것은 "전문가와 상의할 항목" 한 목록뿐이다. 근거(출처)는 고객 화면에 펼치지 않는다(관리자 축약본만).
//
// 저장하지 않는 파생값(브리프 행·분야 배지)은 계약의 순수 함수 buildDevReviewView
// 가 렌더 시 계산한다. 구성도는 결정적 SVG(renderDevReviewDiagramHtml)라 v-html 이 아니라
// sandbox iframe 으로만 나간다. 판정어·리스크 등급·금액·주수는 어디에도 쓰지 않는다.

// title = 프로젝트명(구성도 제목 띠), page = 구성도 페이지 비율(auto 카드형 / a3 인쇄형 / wide 16:9).
const props = defineProps<{ review: MarketDevReviewType; title?: string; page?: DevReviewDiagramPage }>();

const view = computed(() => buildDevReviewView(props.review));
const diagramHtml = computed(() =>
  renderDevReviewDiagramHtml(props.review.diagram, {
    title: props.title ?? '',
    meta: `검토안 V1 · ${props.review.meta.model} · ${generatedAtLabel.value} 생성`,
    page: props.page ?? 'auto',
  }),
);
const areaLabel = (area: DevReviewAreaType): string => MARKET_SERVICE_AREA_LABELS[area];

const notes = computed(() =>
  [
    { key: 'flow', label: '데이터 흐름', text: props.review.diagram.notes.flow },
    { key: 'design', label: '핵심 설계', text: props.review.diagram.notes.design },
    { key: 'extension', label: '확장 방향', text: props.review.diagram.notes.extension },
  ].filter((n) => n.text !== ''),
);


// 생성 시각 — 서버 ISO(UTC)를 KST 로 옮겨 분 단위까지 작게 표시한다.
const generatedAtLabel = computed(() => {
  const parsed = new Date(props.review.meta.generatedAt);
  if (Number.isNaN(parsed.getTime())) return props.review.meta.generatedAt;
  const kst = new Date(parsed.getTime() + 9 * 3600_000).toISOString();
  return `${kst.slice(0, 10)} ${kst.slice(11, 16)}`;
});
</script>

<template>
  <div class="grid gap-7">
    <!-- 헤더 — 분야 배지 · 확정/상의 개수 · 요약 한 줄 -->
    <header class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="font-mono text-[11px] tracking-widest text-tx-3">AI PRE-REVIEW</span>
        <span class="rounded-full bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700">{{ view.areaBadge }}</span>
        <span class="rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-700">확정 {{ view.factCount }}</span>
        <span v-if="view.openQuestions.length > 0" class="rounded-full bg-amber-100 px-2.5 py-0.5 font-bold text-amber-700">
          상의 {{ view.openQuestions.length }}
        </span>
      </div>
      <h2 class="text-lg font-extrabold text-tx-1">AI 사전 검토서</h2>
      <p v-if="review.summary !== ''" class="text-sm leading-relaxed text-tx-2">{{ review.summary }}</p>
      <p class="text-[11px] text-tx-3">
        {{ review.meta.model }} · {{ generatedAtLabel }} 생성
        <template v-if="review.meta.attachmentFiles.length > 0">
          · 첨부 {{ review.meta.attachmentFiles.join(', ') }}
        </template>
      </p>
    </header>

    <!-- ① 고객 의뢰내용 -->
    <section class="grid gap-3">
      <div>
        <p class="font-mono text-[10px] tracking-widest text-emerald-700">CUSTOMER BRIEF</p>
        <h3 class="text-base font-extrabold text-tx-1">고객 의뢰내용</h3>
      </div>
      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <dl class="grid content-start gap-px overflow-hidden rounded-xl border border-line bg-line">
          <div class="grid grid-cols-[88px_1fr] gap-3 bg-white px-3.5 py-2.5 text-xs">
            <dt class="text-tx-3">개발 분야</dt>
            <dd class="font-bold text-tx-1">{{ view.areaBadge }}</dd>
          </div>
          <div
            v-for="row in view.briefRows"
            :key="row.code"
            class="grid grid-cols-[88px_1fr] gap-3 bg-white px-3.5 py-2.5 text-xs"
          >
            <dt class="text-tx-3">{{ row.label }}</dt>
            <dd class="font-bold text-tx-1">
              <template v-if="row.unknown">
                <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">상담에서 확정</span>
              </template>
              <template v-else>{{ row.value }}</template>
            </dd>
          </div>
        </dl>
        <div class="rounded-xl bg-paper p-4">
          <p class="text-xs font-bold text-tx-1">핵심 개발 요구사항</p>
          <ul v-if="review.requirements.length > 0" class="mt-2.5 grid gap-2">
            <li v-for="(item, i) in review.requirements" :key="i" class="flex gap-2 text-xs leading-relaxed text-tx-2">
              <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-700">✓</span>
              <span>{{ item.text }}</span>
            </li>
          </ul>
          <p v-else class="mt-2 text-xs leading-relaxed text-tx-3">
            설명에서 확정된 요구가 아직 없습니다. 전문가 상담에서 함께 정리합니다.
          </p>
        </div>
      </div>
    </section>

    <!-- ② 제안 시스템 구성도 -->
    <section class="grid gap-3">
      <div class="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p class="font-mono text-[10px] tracking-widest text-emerald-700">SYSTEM ARCHITECTURE</p>
          <h3 class="text-base font-extrabold text-tx-1">제안 시스템 구성도</h3>
        </div>
        <span class="rounded-full border border-line px-2.5 py-0.5 text-[11px] font-bold text-tx-2">검토안 V1 · 클릭하면 크게</span>
      </div>
      <DiagramViewer :html="diagramHtml" />
      <div v-if="notes.length > 0" class="grid gap-2 sm:grid-cols-3">
        <div v-for="n in notes" :key="n.key" class="rounded-xl border border-line bg-white px-3.5 py-2.5">
          <p class="text-[10px] font-bold text-tx-3">{{ n.label }}</p>
          <p class="mt-0.5 text-xs font-bold text-tx-1">{{ n.text }}</p>
        </div>
      </div>
      <!-- 노란 메모 — 하드웨어 블록도 관례의 "검토 메모"에 해당. 도면 안에는 고객이 말한 것만 두고
           미정·확인 사항은 도면 바로 아래 이 한 목록에 모은다(§12 결정 13). -->
      <div v-if="view.openQuestions.length > 0" class="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p class="text-xs font-bold text-amber-900">
          전문가와 상의할 항목
          <span class="ml-1 font-normal text-amber-700">— 구성도에 없는 것은 아직 정해지지 않은 것입니다</span>
        </p>
        <ol class="mt-2 grid gap-1.5 sm:grid-cols-2">
          <li v-for="(q, i) in view.openQuestions" :key="i" class="flex gap-2 text-xs leading-relaxed text-amber-900">
            <span class="shrink-0 font-bold">{{ i + 1 }}.</span>
            <span>
              {{ q.question }}
              <span v-if="q.why !== ''" class="block text-[11px] text-amber-700">{{ q.why }}</span>
            </span>
          </li>
        </ol>
      </div>
    </section>

    <!-- ③ 기술개발 검토 결과 -->
    <section class="grid gap-3">
      <div>
        <p class="font-mono text-[10px] tracking-widest text-emerald-700">AI REVIEW</p>
        <h3 class="text-base font-extrabold text-tx-1">기술개발 검토 결과</h3>
      </div>
      <div class="grid gap-2 sm:grid-cols-3">
        <div v-for="area in review.areas" :key="area.area" class="rounded-xl border border-line bg-white p-3.5">
          <p class="text-xs font-extrabold text-tx-1">{{ areaLabel(area.area) }}</p>
          <p v-if="area.summary !== ''" class="mt-1 text-xs leading-relaxed text-tx-2">{{ area.summary }}</p>
          <p v-else class="mt-1 text-xs text-tx-3">상담 후 작성</p>
        </div>
      </div>
    </section>

    <!-- ④ 개발명세서 -->
    <section class="grid gap-3">
      <div>
        <p class="font-mono text-[10px] tracking-widest text-emerald-700">DEVELOPMENT SPECIFICATION</p>
        <h3 class="text-base font-extrabold text-tx-1">개발명세서</h3>
        <p class="mt-0.5 text-xs text-tx-3">고객 자료에서 확정된 항목만 담았습니다. 나머지는 전문가가 상담 후 채웁니다.</p>
      </div>
      <div v-for="area in review.areas" :key="area.area" class="rounded-xl border border-line bg-white p-4">
        <p class="text-xs font-extrabold text-tx-1">{{ areaLabel(area.area) }}</p>
        <div v-if="area.spec.length > 0" class="mt-2.5 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
          <div v-for="(row, i) in area.spec" :key="i" class="grid gap-0.5 border-l-2 border-line pl-3">
            <p class="text-[11px] font-bold text-tx-2">{{ row.item }}</p>
            <p class="text-xs leading-relaxed text-tx-1">{{ row.text }}</p>
          </div>
        </div>
        <p v-else class="mt-1.5 text-xs text-tx-3">상담 후 작성</p>
      </div>
    </section>

    <p class="rounded-xl bg-paper px-3.5 py-2.5 text-[11px] leading-relaxed text-tx-3">{{ DEV_REVIEW_DISCLAIMER }}</p>
  </div>
</template>
