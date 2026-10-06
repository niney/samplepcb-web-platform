<script setup lang="ts">
import type { AdminDevelopDocumentViewType } from '@sp/api-contract';
import type { PreviewTarget } from '@sp/ui';
import DevelopFileRow from '@/next/components/develop/DevelopFileRow.vue';

// 문서 첨부 목록 — 편집기(draft: 지우기 가능)와 읽기 뷰(발송 판: 보기·내려받기만)가 쓴다. 줄 모양은 모듈 공용
// DevelopFileRow(의뢰·타임라인 첨부와 같은 줄). 미리보기 모달은 상세 페이지 한 곳에 있어 대상만 올리고,
// 내려받기·지우기는 부모가 처리한다(실패 문구가 부모 몫).
type DocFile = AdminDevelopDocumentViewType['files'][number];

const props = withDefaults(defineProps<{ files: readonly DocFile[]; removable?: boolean; busy?: boolean }>(), {
  removable: false,
  busy: false,
});
const emit = defineEmits<{
  preview: [file: PreviewTarget];
  download: [fileId: number, name: string];
  remove: [fileId: number];
}>();
</script>

<template>
  <ul v-if="props.files.length > 0" class="grid gap-1">
    <li v-for="f in props.files" :key="f.fileId">
      <DevelopFileRow
        :file="f"
        tone="muted"
        :removable="props.removable"
        :busy="props.busy"
        @preview="emit('preview', { fileId: f.fileId, name: f.name, size: f.size })"
        @download="emit('download', f.fileId, f.name)"
        @remove="emit('remove', f.fileId)"
      />
    </li>
  </ul>
</template>
