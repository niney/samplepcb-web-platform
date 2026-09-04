<script setup lang="ts">
import { computed } from 'vue';
import { marketSlotLabel } from '@sp/api-contract';
import type { DevelopFileMetaType } from '@sp/api-contract';
import { canPreview } from '@sp/ui';
import { fileSize } from '../../lib/format';

// 의뢰 첨부 목록 — 참고 자료(일반)와 분야별 추가자료(슬롯)를 한 목록에서 라벨로 가른다.
// 삭제는 수정 화면에만 있다(여기는 읽기 + 받기 + 보기).
const props = defineProps<{ files: DevelopFileMetaType[] }>();
const emit = defineEmits<{ download: [DevelopFileMetaType]; preview: [DevelopFileMetaType] }>();

const slotLabel = (f: DevelopFileMetaType): string =>
  f.area !== null && f.slot !== null ? marketSlotLabel(f.area, f.slot) : '';
const sorted = computed(() => [...props.files].sort((a, b) => Number(a.area !== null) - Number(b.area !== null)));
</script>

<template>
  <ul v-if="sorted.length > 0" class="grid gap-1.5">
    <li
      v-for="f in sorted"
      :key="f.fileId"
      class="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-label"
    >
      <span class="min-w-0 flex-1 truncate font-semibold text-tx-1">{{ f.name }}</span>
      <span v-if="slotLabel(f) !== ''" class="shrink-0 rounded-full bg-paper px-2 py-0.5 text-micro font-bold text-tx-2">{{ slotLabel(f) }}</span>
      <span class="shrink-0 tabular-nums text-tx-3">{{ fileSize(f.size) }}</span>
      <button
        v-if="canPreview(f)"
        type="button"
        class="h-7 shrink-0 rounded-md border border-line-2 px-2.5 font-bold text-tx-2 transition hover:border-tx-3"
        @click="emit('preview', f)"
      >
        보기
      </button>
      <button
        type="button"
        class="h-7 shrink-0 rounded-md border border-line-2 px-2.5 font-bold text-tx-2 transition hover:border-tx-3"
        @click="emit('download', f)"
      >
        받기
      </button>
    </li>
  </ul>
  <p v-else class="rounded-2xl border border-dashed border-line-2 bg-white px-6 py-8 text-center text-body text-tx-3">
    첨부한 자료가 없습니다.
  </p>
</template>
