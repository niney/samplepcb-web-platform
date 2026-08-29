<script setup lang="ts">
import { computed } from 'vue';
import { DEV_REVIEW_DISCLAIMER, MARKET_SERVICE_AREA_LABELS } from '@sp/api-contract';
import type {
  DevReviewAreaReviewType,
  DevReviewAreaType,
  GroundedItemType,
  MarketDevReviewType,
} from '@sp/api-contract';
import { buildDevReviewView, renderDiagramSpecHtml } from '@sp/utils';
import DiagramViewer from '../DiagramViewer.vue';
import DevReviewItemList from './DevReviewItemList.vue';

// AI 사전 검토서 뷰(docs/AI_DEV_REVIEW.md §1) — 고객·전문가가 같은 JSON 을 같은 순서로 본다.
// 위저드 미리보기와 프로젝트 상세가 공유한다.
//
// 저장하지 않는 파생값(브리프 행·결과물 목록·단계 순서·분야 배지)은 계약의 순수 함수
// buildDevReviewView 가 렌더 시 계산한다 — 사전이 바뀌면 옛 검토서도 새 사전으로 보인다.
// 구성도는 결정적 SVG(renderDiagramSpecHtml)라 v-html 이 아니라 sandbox iframe 으로만 나간다.
// 판정어·리스크 등급·금액·주수는 어디에도 쓰지 않는다.

const props = defineProps<{ review: MarketDevReviewType }>();

const view = computed(() => buildDevReviewView(props.review));
const diagramHtml = computed(() => renderDiagramSpecHtml(props.review.diagram));

const areaLabel = (area: DevReviewAreaType): string => MARKET_SERVICE_AREA_LABELS[area];

const confirmedSpec = (area: DevReviewAreaReviewType): number =>
  area.spec.filter((row) => row.status === 'confirmed').length;

// 분야 카드의 "확인 필요" 요약 — 범위·명세에서 확인 필요 항목만 모은다(질문 우선 표시).
const areaOpenPoints = (area: DevReviewAreaReviewType): string[] => {
  const items: GroundedItemType[] = [...area.scope, ...area.spec];
  return items
    .filter((item) => item.status === 'needs_confirmation')
    .map((item) => (item.question !== null && item.question !== '' ? item.question : item.text));
};

// 결과물 목록 — 분야 순서(계약 사전 순)를 유지한 채 분야별로 묶는다.
const deliverableGroups = computed(() => {
  const groups: { area: DevReviewAreaType; items: { key: string; label: string; requested: boolean }[] }[] = [];
  for (const d of view.value.deliverables) {
    const last = groups.find((g) => g.area === d.area);
    const entry = { key: d.key, label: d.label, requested: d.requested };
    if (last === undefined) groups.push({ area: d.area, items: [entry] });
    else last.items.push(entry);
  }
  return groups;
});

// 생성 시각 — 서버 ISO(UTC)를 KST 로 옮겨 분 단위까지 작게 표시한다.
const generatedAtLabel = computed(() => {
  const parsed = new Date(props.review.meta.generatedAt);
  if (Number.isNaN(parsed.getTime())) return props.review.meta.generatedAt;
  const kst = new Date(parsed.getTime() + 9 * 3600_000).toISOString();
  return `${kst.slice(0, 10)} ${kst.slice(11, 16)}`;
});
</script>

<template>
  <div class="grid gap-6">
    <!-- ① 헤더 — 분야 배지 · 확정/확인 필요 집계 · 고정 고지문 -->
    <header class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <span class="font-mono text-[11px] tracking-widest text-tx-3">AI PRE-REVIEW</span>
        <span class="rounded-full bg-blue-50 px-2.5 py-0.5 font-semibold text-blue-700">
          {{ view.areaBadge }}
        </span>
        <span class="rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-700">
          확정 {{ view.stats.confirmed }}
        </span>
        <span class="rounded-full bg-amber-100 px-2.5 py-0.5 font-bold text-amber-700">
          확인 필요 {{ view.stats.needsConfirmation }}
        </span>
      </div>
      <h2 class="text-lg font-extrabold text-tx-1">AI 사전 검토서</h2>
      <p class="rounded-xl bg-paper px-3.5 py-2.5 text-xs leading-relaxed text-tx-2">
        {{ DEV_REVIEW_DISCLAIMER }}
      </p>
      <p class="text-[11px] text-tx-3">
        {{ review.meta.model }} · {{ generatedAtLabel }} 생성
        <template v-if="review.meta.attachmentFiles.length > 0">
          · 첨부 {{ review.meta.attachmentFiles.join(', ') }}
        </template>
      </p>
    </header>

    <!-- ② 의뢰 브리프 -->
    <section class="grid gap-3">
      <h3 class="text-sm font-extrabold text-tx-1">의뢰 브리프</h3>
      <dl
        v-if="view.briefRows.length > 0"
        class="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2"
      >
        <div
          v-for="row in view.briefRows"
          :key="row.code"
          class="grid gap-0.5 bg-white px-3.5 py-2.5 text-xs leading-relaxed"
          :class="row.unknown ? 'text-tx-3' : 'text-tx-2'"
        >
          <dt class="flex items-center gap-1.5 font-bold text-tx-2">
            {{ row.label }}
            <span v-if="row.unknown" class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
              확인 필요
            </span>
          </dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
      <p v-else class="rounded-xl bg-paper px-3.5 py-2.5 text-xs text-tx-3">
        답변한 질문이 없어 브리프에 표시할 항목이 없습니다.
      </p>

      <p v-if="review.summary !== ''" class="text-sm leading-relaxed text-tx-2">{{ review.summary }}</p>

      <template v-if="review.requirements.length > 0">
        <p class="text-xs font-bold text-tx-2">핵심 요구</p>
        <DevReviewItemList :items="review.requirements" />
      </template>
    </section>

    <!-- ③ 시스템 구성도 — 결정적 SVG(sandbox iframe), 컨테이너 폭 전체 -->
    <section class="grid gap-3">
      <h3 class="text-sm font-extrabold text-tx-1">
        시스템 구성도 <span class="font-normal text-tx-3">(클릭하면 크게 보기)</span>
      </h3>
      <DiagramViewer :html="diagramHtml" />
    </section>

    <!-- ④ 분야별 검토 포인트 -->
    <section v-if="review.areas.length > 0" class="grid gap-3">
      <h3 class="text-sm font-extrabold text-tx-1">분야별 검토 포인트</h3>
      <div class="grid gap-3 xl:grid-cols-2">
        <div v-for="area in review.areas" :key="area.area" class="grid gap-3 rounded-2xl border border-line p-4">
          <p class="text-xs font-extrabold text-tx-1">{{ areaLabel(area.area) }}</p>

          <template v-if="area.scope.length > 0">
            <p class="text-[11px] font-bold text-tx-3">구현 방식·범위</p>
            <DevReviewItemList :items="area.scope" />
          </template>

          <template v-if="area.risks.length > 0">
            <p class="text-[11px] font-bold text-tx-3">주의 리스크</p>
            <ul class="grid gap-2">
              <li
                v-for="(risk, i) in area.risks"
                :key="i"
                class="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900"
              >
                {{ risk.text }}
                <details v-if="risk.evidence !== null && risk.evidence !== ''" class="mt-1.5">
                  <summary class="cursor-pointer text-[11px] font-semibold text-amber-700">출처 보기</summary>
                  <p class="mt-1 border-l-2 border-amber-300 pl-2 text-[11px]">“{{ risk.evidence }}”</p>
                </details>
              </li>
            </ul>
          </template>

          <template v-if="areaOpenPoints(area).length > 0">
            <p class="text-[11px] font-bold text-tx-3">확인 필요</p>
            <ul class="grid gap-1 text-xs leading-relaxed text-tx-3">
              <li v-for="(point, i) in areaOpenPoints(area)" :key="i" class="flex gap-1.5">
                <span class="text-amber-600">•</span><span>{{ point }}</span>
              </li>
            </ul>
          </template>
        </div>
      </div>
    </section>

    <!-- ⑤ 개발명세서 -->
    <section v-if="review.areas.length > 0" class="grid gap-3">
      <h3 class="text-sm font-extrabold text-tx-1">개발명세서</h3>
      <div v-for="area in review.areas" :key="area.area" class="grid gap-2">
        <p class="text-xs font-bold text-tx-2">{{ areaLabel(area.area) }}</p>
        <!-- 확정 0건이면 표를 만들지 않는다(정본 §1.2 R6) -->
        <p v-if="confirmedSpec(area) === 0" class="rounded-xl bg-paper px-3.5 py-2.5 text-xs text-tx-3">
          상담 후 작성
        </p>
        <div v-else class="overflow-x-auto rounded-xl border border-line">
          <table class="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr class="bg-paper text-left text-[11px] font-bold text-tx-2">
                <th class="w-40 px-3.5 py-2">항목</th>
                <th class="px-3.5 py-2">내용</th>
                <th class="w-24 px-3.5 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(row, i) in area.spec"
                :key="i"
                class="border-t border-line align-top"
                :class="row.status === 'confirmed' ? 'bg-white' : 'bg-paper'"
              >
                <td class="px-3.5 py-2.5 font-semibold" :class="row.status === 'confirmed' ? 'text-tx-1' : 'text-tx-3'">
                  {{ row.item }}
                </td>
                <td class="px-3.5 py-2.5 leading-relaxed" :class="row.status === 'confirmed' ? 'text-tx-2' : 'text-tx-3'">
                  {{ row.text }}
                  <p v-if="row.status !== 'confirmed' && row.question !== null" class="mt-1 font-semibold text-amber-800">
                    ❓ {{ row.question }}
                  </p>
                  <p v-if="row.status !== 'confirmed' && row.why !== null && row.why !== ''" class="mt-1 text-tx-3">
                    {{ row.why }}
                  </p>
                  <details v-if="row.evidence !== null && row.evidence !== ''" class="mt-1">
                    <summary class="cursor-pointer text-[11px] font-semibold text-tx-3">출처 보기</summary>
                    <p class="mt-1 border-l-2 border-line-2 pl-2 text-[11px] text-tx-3">“{{ row.evidence }}”</p>
                  </details>
                </td>
                <td class="px-3.5 py-2.5">
                  <span
                    class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                    :class="row.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'"
                  >
                    {{ row.status === 'confirmed' ? '확정' : '확인 필요' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- ⑥ 결과물 목록 -->
    <section v-if="deliverableGroups.length > 0" class="grid gap-3">
      <h3 class="text-sm font-extrabold text-tx-1">
        결과물 목록 <span class="font-normal text-tx-3">(굵게 표시된 항목은 직접 요청한 결과물)</span>
      </h3>
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div v-for="group in deliverableGroups" :key="group.area" class="rounded-2xl border border-line p-4">
          <p class="text-xs font-extrabold text-tx-1">{{ areaLabel(group.area) }}</p>
          <ul class="mt-2 grid gap-1 text-xs leading-relaxed">
            <li v-for="d in group.items" :key="d.key" class="flex gap-1.5">
              <span class="text-copper-500">•</span>
              <span :class="d.requested ? 'font-bold text-tx-1' : 'text-tx-2'">{{ d.label }}</span>
            </li>
          </ul>
        </div>
      </div>
    </section>

    <!-- ⑦ 개발 단계 순서 — 기간 없음 -->
    <section v-if="view.phases.length > 0" class="grid gap-3">
      <h3 class="text-sm font-extrabold text-tx-1">개발 단계 순서</h3>
      <p class="text-xs text-tx-3">기간은 전문가 견적에서 제시됩니다.</p>
      <ol class="grid gap-2">
        <li
          v-for="(phase, i) in view.phases"
          :key="phase.key"
          class="flex items-start gap-3 rounded-xl border border-line px-3.5 py-2.5 text-xs leading-relaxed"
        >
          <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink-900 text-[10px] font-bold text-white">
            {{ i + 1 }}
          </span>
          <span class="min-w-0 flex-1">
            <b class="text-tx-1">{{ phase.label }}</b>
            <span class="ml-1.5 text-tx-3">{{ phase.areas.map(areaLabel).join(' · ') }}</span>
            <span v-if="phase.deliverables.length > 0" class="mt-0.5 block text-tx-2">
              {{ phase.deliverables.join(' · ') }}
            </span>
          </span>
        </li>
      </ol>
    </section>

    <!-- ⑧ 전문가와 확정할 항목 -->
    <section v-if="view.openQuestions.length > 0" class="grid gap-3">
      <h3 class="text-sm font-extrabold text-tx-1">전문가와 확정할 항목</h3>
      <ul class="grid gap-2">
        <li
          v-for="(q, i) in view.openQuestions"
          :key="i"
          class="rounded-xl border border-line bg-paper px-3.5 py-2.5 text-xs leading-relaxed"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <span v-if="q.topic !== ''" class="rounded bg-white px-1.5 py-0.5 text-[10px] font-bold text-tx-2">
              {{ q.topic }}
            </span>
            <span v-if="q.area !== null" class="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700">
              {{ areaLabel(q.area) }}
            </span>
          </div>
          <p class="mt-1 font-semibold text-tx-1">{{ q.question }}</p>
          <p v-if="q.why !== ''" class="mt-0.5 text-tx-3">{{ q.why }}</p>
        </li>
      </ul>
    </section>
  </div>
</template>
