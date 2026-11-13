<script setup lang="ts">
import { DEV_REVIEW_DISCLAIMER } from '@sp/api-contract';
import type { DevReviewCheckType } from '@sp/api-contract';

// AI 사전 검토서의 첫 장 — 왼쪽: 한 줄 요약 + 번호 붙은 핵심 요구사항, 오른쪽 옅은 판: 담당자 의견 · 답변↔자료 불일치 · 검토 기준.
// 담당자 의견이 길어 이 장에 안 들면 RequestPrint 가 comment 를 비우고 뒤쪽 '담당자 의견' 장으로 보낸다(높이를 재어 정한다).
defineProps<{
  summary: string;
  requirements: string[];
  comment: string;
  checks: DevReviewCheckType[];
  meta: string; // "2026-09-25 14:51 생성 · v2 공개본 · 첨부 a.pdf" — 모델명은 고객에게 보이지 않는다(사용자 결정)
  stack?: boolean; // 좁은 화면의 세로 흐름 — 옅은 판을 아래로 내린다
}>();
</script>

<template>
  <div class="flex min-h-full flex-1" :class="stack ? 'flex-col gap-[22px]' : 'gap-[56px]'">
    <div class="flex min-w-0 flex-1 flex-col">
      <p v-if="summary !== ''" class="text-[21px] font-medium leading-[1.5]">{{ summary }}</p>
      <p class="text-[14px] font-bold leading-[1.4] text-brand-600" :class="summary !== '' ? 'mt-[24px]' : ''">핵심 요구사항</p>
      <ol v-if="requirements.length > 0" class="mt-[4px] flex flex-col">
        <li
          v-for="(r, i) in requirements"
          :key="i"
          class="flex gap-[20px] py-[11px] text-[19px] leading-[1.45]"
          :class="i > 0 ? 'border-t border-line' : ''"
        >
          <span class="w-[30px] shrink-0 font-bold tabular-nums text-brand-600">{{ String(i + 1).padStart(2, '0') }}</span>
          <span class="min-w-0">{{ r }}</span>
        </li>
      </ol>
      <p v-else class="mt-[10px] text-[17px] leading-[1.6] text-tx-2">설명에서 확정된 요구가 아직 없습니다. 전문가 상담에서 함께 정리합니다.</p>
    </div>

    <!-- 의견 · 불일치가 없으면 판이 내용만큼만 — 빈 판을 장 높이로 늘이지 않는다 -->
    <aside
      class="flex shrink-0 flex-col rounded-[10px] bg-brand-50"
      :class="[stack ? 'w-full px-[18px] py-[18px]' : 'w-[420px] px-[28px] py-[24px]', !stack && comment === '' && checks.length === 0 ? 'self-start' : '']"
    >
      <template v-if="comment !== ''">
        <p class="text-[14px] font-bold leading-[1.4] text-brand-600">담당자 의견</p>
        <p class="mt-[10px] whitespace-pre-line text-[17px] leading-[1.65]">{{ comment }}</p>
      </template>
      <div v-if="checks.length > 0" :class="comment !== '' ? 'mt-[20px]' : ''">
        <p class="text-[14px] font-bold leading-[1.4] text-amber-800">답변과 자료가 다릅니다 — 자료를 우선해 검토했습니다</p>
        <p v-for="c in checks" :key="c.code" class="mt-[6px] text-[15px] leading-[1.55]">
          <b class="font-semibold">{{ c.answer }}</b> 로 답하셨는데 자료에 <b class="font-semibold">{{ c.found.join(' · ') }}</b> 이(가) 나옵니다.
        </p>
      </div>
      <div class="mt-auto" :class="comment !== '' || checks.length > 0 ? 'pt-[20px]' : ''">
        <p class="text-[14px] font-bold leading-[1.4] text-brand-600">검토 기준</p>
        <p class="mt-[8px] text-[15px] leading-[1.6] text-[#3b4558]">{{ DEV_REVIEW_DISCLAIMER }}</p>
        <p v-if="meta !== ''" class="mt-[8px] text-[13px] leading-[1.5] text-tx-3 [overflow-wrap:anywhere]">{{ meta }}</p>
      </div>
    </aside>
  </div>
</template>
