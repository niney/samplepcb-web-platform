<script setup lang="ts">
import type { DeckArea } from '../../lib/deck-content';

// 개발 분석의 분야 한 덩어리 — 파란 분야 이름 · 한 줄 요약 → 굵은 항목 제목과 내용 → 검토 포인트.
// column = 한 장의 한 단에 쌓는 모양(분야 이름이 덩어리 제목), solo = 분야 하나가 한 장을 쓰는 모양(분야 이름은 장 제목에 있고,
// 왼쪽에 개발 구성 · 오른쪽에 검토 포인트를 편다). 어느 쪽으로 그릴지는 RequestDeck 이 잰 높이로 정한다(lib/deck-pack).
defineProps<{
  area: DeckArea;
  variant: 'column' | 'solo';
  questionsPage?: number | null; // '확인이 필요한 사항' 첫 장의 쪽 번호 — solo 가 이 분야의 확인 사항이 어디 있는지 가리킨다
}>();
</script>

<template>
  <!-- 한 단에 쌓는 덩어리 -->
  <div v-if="variant === 'column'" class="flex flex-col">
    <h3 class="text-[22px] font-bold leading-[1.3] text-brand-600">{{ area.label }}</h3>
    <p v-if="area.summary !== ''" class="mt-[6px] text-[15px] leading-[1.55] text-tx-2">{{ area.summary }}</p>
    <div v-if="area.groups.length > 0" class="mt-[14px] flex flex-col gap-[10px]">
      <div v-for="(g, gi) in area.groups" :key="gi">
        <p class="text-[15px] font-bold leading-[1.5]">{{ g.item }}</p>
        <p v-for="(t, ti) in g.texts" :key="ti" class="text-[16px] leading-[1.5]" :class="g.texts.length > 1 ? 'relative pl-[14px]' : ''">
          <span v-if="g.texts.length > 1" class="absolute left-[2px] top-[10px] size-[4px] rounded-full bg-[#141e34]" aria-hidden="true" />{{ t }}
        </p>
      </div>
    </div>
    <!-- 명세가 없는 분야 — 요약이 사정을 말해 주면('자료에 서버 내용이 없습니다') 그것으로 끝내고, 요약도 없을 때만 안내를 적는다 -->
    <p v-else-if="area.summary === ''" class="mt-[6px] text-[15px] leading-[1.55] text-tx-3">상담 후 작성</p>
    <div v-if="area.notes.length > 0" class="mt-[14px] border-l-[3px] border-brand-200 pl-[14px]">
      <p class="text-[13px] font-bold leading-[1.5] text-brand-600">검토 포인트</p>
      <p v-for="(n, ni) in area.notes" :key="ni" class="text-[15px] leading-[1.55] text-[#3b4558]" :class="ni > 0 ? 'mt-[4px]' : ''">{{ n }}</p>
    </div>
  </div>

  <!-- 분야 하나가 한 장 -->
  <div v-else class="flex min-h-full flex-1 gap-[56px]">
    <div class="flex min-w-0 flex-1 flex-col">
      <p v-if="area.summary !== ''" class="text-[19px] leading-[1.55] text-[#3b4558]">{{ area.summary }}</p>
      <p class="text-[14px] font-bold leading-[1.4] text-brand-600" :class="area.summary !== '' ? 'mt-[22px]' : ''">개발 구성</p>
      <div
        v-if="area.groups.length > 0"
        class="mt-[10px] gap-x-[48px]"
        :class="area.notes.length === 0 && area.questionCount === 0 && area.groups.length > 3 ? 'columns-2' : ''"
      >
        <div v-for="(g, gi) in area.groups" :key="gi" class="mb-[13px] break-inside-avoid">
          <p class="text-[16px] font-bold leading-[1.5]">{{ g.item }}</p>
          <p v-for="(t, ti) in g.texts" :key="ti" class="text-[17px] leading-[1.5]" :class="g.texts.length > 1 ? 'relative pl-[15px]' : ''">
            <span v-if="g.texts.length > 1" class="absolute left-[2px] top-[11px] size-[4px] rounded-full bg-[#141e34]" aria-hidden="true" />{{ t }}
          </p>
        </div>
      </div>
      <p v-else class="mt-[10px] text-[17px] leading-[1.5] text-tx-3">상담 후 작성</p>
    </div>
    <aside v-if="area.notes.length > 0 || area.questionCount > 0" class="flex w-[440px] shrink-0 flex-col rounded-[10px] bg-brand-50 px-[28px] py-[24px]">
      <template v-if="area.notes.length > 0">
        <p class="text-[14px] font-bold leading-[1.4] text-brand-600">검토 포인트</p>
        <p v-for="(n, ni) in area.notes" :key="ni" class="text-[17px] leading-[1.6]" :class="ni === 0 ? 'mt-[10px]' : 'mt-[14px]'">{{ n }}</p>
      </template>
      <p v-if="area.questionCount > 0" class="mt-auto pt-[20px] text-[15px] leading-[1.5] text-tx-2">
        확인이 필요한 사항 <b class="font-bold text-[#141e34]">{{ area.questionCount }}건</b><template v-if="questionsPage != null"> — {{ String(questionsPage).padStart(2, '0') }}쪽부터</template>
      </p>
    </aside>
  </div>
</template>
