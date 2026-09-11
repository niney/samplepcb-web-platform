<script setup lang="ts">
import { computed } from 'vue';
import { canPreview } from '@sp/ui';
import type { DevelopDocumentViewType, MarketFileMetaType } from '@sp/api-contract';
import { fileSize } from '../../lib/format';
import DocumentContent from './DocumentContent.vue';

// 문서 읽기 — 본문 표 + 첨부 + 인쇄. 첨부는 의뢰 첨부와 같은 경로(`…/requests/:id/files/:fileId`)로
// 내려받는다(서버가 "보낸 판의 첨부만" 통과시킨다) — 그래서 여기서 권한을 다시 판정하지 않는다.
const props = defineProps<{ doc: DevelopDocumentViewType; requestId: number }>();
const emit = defineEmits<{ download: [MarketFileMetaType]; preview: [MarketFileMetaType] }>();

const printPath = computed(
  () => `/develop/requests/${String(props.requestId)}/documents/${String(props.doc.documentId)}/print`,
);
</script>

<template>
  <div class="grid gap-4">
    <DocumentContent :type="doc.type" :content="doc.content" />

    <div v-if="doc.files.length > 0" class="grid gap-1.5">
      <h4 class="text-label font-bold text-tx-3">첨부 자료</h4>
      <ul class="grid gap-1.5">
        <li
          v-for="f in doc.files"
          :key="f.fileId"
          class="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-label"
        >
          <span class="min-w-0 flex-1 truncate font-semibold text-tx-1">{{ f.name }}</span>
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
    </div>

    <div>
      <a
        :href="printPath"
        target="_blank"
        rel="noopener"
        class="inline-block h-9 rounded-lg border border-line-2 bg-white px-3.5 text-label font-bold leading-9 text-tx-2 transition hover:border-tx-3"
      >
        인쇄용 보기
      </a>
    </div>
  </div>
</template>
