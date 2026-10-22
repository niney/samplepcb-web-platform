<script setup lang="ts">
import { computed } from 'vue';
import { developSlotLabel } from '@sp/api-contract';
import type { DevelopFileMetaType } from '@sp/api-contract';
import { canPreview } from '@sp/ui';
import { fileSize } from '../../lib/format';
import iconFile from '../../assets/detail/file-pdf.svg';

// 의뢰 첨부 목록 — 피그마 「00-3 의뢰 상세」 38:9541: 파일 아이콘 + 이름 + 오른쪽 미리보기·다운로드.
// 참고 자료(일반)와 분야별 추가자료(슬롯)를 한 목록에서 라벨로 가른다. 삭제는 수정 화면에만 있다.
const props = defineProps<{ files: DevelopFileMetaType[] }>();
const emit = defineEmits<{ download: [DevelopFileMetaType]; preview: [DevelopFileMetaType] }>();

const slotLabel = (f: DevelopFileMetaType): string =>
  f.area !== null && f.slot !== null ? developSlotLabel(f.area, f.slot) : '';
const sorted = computed(() => [...props.files].sort((a, b) => Number(a.area !== null) - Number(b.area !== null)));
</script>

<template>
  <ul class="flex flex-col">
    <li
      v-for="(f, i) in sorted"
      :key="f.fileId"
      class="flex min-w-0 flex-wrap items-center justify-between gap-[10px]"
      :class="i > 0 ? 'mt-[16px] border-t border-[#eee] pt-[16px]' : ''"
    >
      <div class="flex min-w-0 flex-1 items-center gap-[10px]">
        <img :src="iconFile" alt="" class="block size-[22px] shrink-0">
        <span class="min-w-0 truncate text-[16px] font-medium leading-[1.8] text-black">{{ f.name }}</span>
        <span v-if="slotLabel(f) !== ''" class="shrink-0 rounded-[37px] bg-[#f5f6f8] px-[8px] py-[4px] text-[12px] font-semibold leading-[1.3] text-[#475569]">{{ slotLabel(f) }}</span>
        <span class="shrink-0 text-[14px] tabular-nums text-[#999]">{{ fileSize(f.size) }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-[10px]">
        <button
          v-if="canPreview(f)"
          type="button"
          class="flex h-[34px] w-[82px] items-center justify-center rounded-[6px] border border-[#d9d9d9] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:border-[#9aa3ad]"
          @click="emit('preview', f)"
        >
          미리보기
        </button>
        <button
          type="button"
          class="flex h-[34px] w-[84px] items-center justify-center rounded-[6px] border border-[#d9d9d9] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:border-[#9aa3ad]"
          @click="emit('download', f)"
        >
          다운로드
        </button>
      </div>
    </li>
  </ul>
</template>
