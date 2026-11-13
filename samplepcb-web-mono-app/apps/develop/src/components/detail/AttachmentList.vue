<script setup lang="ts">
import { computed } from 'vue';
import { developSlotLabel } from '@sp/api-contract';
import type { DevelopFileMetaType } from '@sp/api-contract';
import { canPreview } from '@sp/ui';
import { fileSize } from '../../lib/format';

// 의뢰 첨부 목록 — 참고 자료(일반)와 분야별 추가자료(슬롯)를 한 표에서 '구분'으로 가른다. 삭제는 수정 화면에만 있다.
// 모양은 2026-11-13 부터 장의 표(파란 머리줄 · 줄무늬 행 — 출력물 '첨부 자료' 표와 같은 열)에 받기 단추 열을 더한 것(§7.2.12).
// 좁은 화면에서는 머리줄을 숨기고 행 안에서 이름 → 구분 · 크기 · 단추로 접는다.
const props = defineProps<{ files: DevelopFileMetaType[] }>();
const emit = defineEmits<{ download: [DevelopFileMetaType]; preview: [DevelopFileMetaType] }>();

const kind = (f: DevelopFileMetaType): string => (f.area !== null && f.slot !== null ? developSlotLabel(f.area, f.slot) : '참고 자료');
const sorted = computed(() => [...props.files].sort((a, b) => Number(a.area !== null) - Number(b.area !== null)));
const BTN =
  'flex h-[34px] items-center justify-center rounded-[6px] border border-line-2 bg-white px-[12px] text-[14px] leading-[1.3] text-[#141e34] transition-colors hover:bg-brand-50';
</script>

<template>
  <div class="border border-line text-[17px] leading-[1.5] text-[#141e34]" data-deck-table="files">
    <div class="hidden h-[46px] items-center bg-brand-600 font-bold text-white md:flex">
      <span class="min-w-0 flex-1 px-[16px]">파일</span>
      <span class="w-[240px] shrink-0 px-[16px]">구분</span>
      <span class="w-[120px] shrink-0 px-[16px] text-right">크기</span>
      <span class="w-[210px] shrink-0 px-[16px] text-right">받기</span>
    </div>
    <div
      v-for="(f, i) in sorted"
      :key="f.fileId"
      class="flex flex-wrap items-center gap-y-[6px] py-[10px] md:flex-nowrap"
      :class="[i % 2 === 1 ? 'bg-brand-50' : 'bg-white', i > 0 ? 'border-t border-line' : 'md:border-t md:border-line']"
    >
      <span class="w-full min-w-0 px-[16px] font-semibold [overflow-wrap:anywhere] md:w-auto md:flex-1">{{ f.name }}</span>
      <span class="shrink-0 px-[16px] text-[15px] text-[#3b4558] md:w-[240px] md:text-[17px] md:text-[#141e34]">{{ kind(f) }}</span>
      <span class="shrink-0 px-[16px] text-[15px] tabular-nums text-tx-2 md:w-[120px] md:text-right md:text-[17px] md:text-[#141e34]">{{ fileSize(f.size) }}</span>
      <span class="ml-auto flex shrink-0 items-center justify-end gap-[8px] px-[16px] md:ml-0 md:w-[210px]">
        <button v-if="canPreview(f)" type="button" :class="BTN" @click="emit('preview', f)">미리보기</button>
        <button type="button" :class="BTN" @click="emit('download', f)">다운로드</button>
      </span>
    </div>
  </div>
</template>
