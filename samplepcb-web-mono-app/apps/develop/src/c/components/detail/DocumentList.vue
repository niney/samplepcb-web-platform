<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  DEVELOP_DOC_STATUS_LABELS,
  DEVELOP_DOC_TYPE_LABELS,
  developDocDecisionLabel,
} from '@sp/api-contract/develop-c';
import type { DevelopDocDecisionType, DevelopDocumentViewType, MarketFileMetaType } from '@sp/api-contract/develop-c';
import { dateShort, dateTimeKst } from '../../lib/format';
import DocumentView from './DocumentView.vue';
import DocumentDecision from './DocumentDecision.vue';

// 프로젝트 문서 목록(docs/DEVELOP_FLOW.md §13) — 서버는 **보낸 판만** 내려준다(draft 는 어떤 응답에도 없다).
// 같은 종류·번호(docNo)의 판이 여러 개면 최신 판(isCurrent)만 카드로 세우고 이전 판은 그 안에 접어 둔다.
// 회신할 문서(승인형 sent)는 처음부터 펼쳐 둔다 — 고객이 이 화면에 온 이유가 그것이다.
const props = defineProps<{
  documents: DevelopDocumentViewType[];
  requestId: number;
  contactName: string;
  decidingDocId: number | null;
  decidePending: boolean;
  decideError: string;
}>();
const emit = defineEmits<{
  decide: [{ documentId: number; decision: DevelopDocDecisionType; note: string; name: string }];
  download: [MarketFileMetaType];
  preview: [MarketFileMetaType];
}>();

const sentAtMs = (d: DevelopDocumentViewType): number => {
  const parsed = d.sentAt === null ? Number.NaN : new Date(d.sentAt).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
};

// 최신 판 = 카드. 최근에 온 것이 위(회신 대기 문서가 대개 마지막에 온다).
const current = computed(() => props.documents.filter((d) => d.isCurrent).sort((a, b) => sentAtMs(b) - sentAtMs(a)));
// 이전 판 — 같은 종류·번호에서 최신이 아닌 것들(최신 버전이 위).
const previousOf = (doc: DevelopDocumentViewType): DevelopDocumentViewType[] =>
  props.documents.filter((d) => !d.isCurrent && d.type === doc.type && d.seq === doc.seq).sort((a, b) => b.version - a.version);

const typeLabel = (d: DevelopDocumentViewType): string => DEVELOP_DOC_TYPE_LABELS[d.type];
const openable = (d: DevelopDocumentViewType): boolean => d.approval && d.status === 'sent';

// 배지 — 회신을 기다리는 문서만 브랜드색으로 세운다. 결정된 문서는 결정 문안 그대로(계약 사전).
const badgeText = (d: DevelopDocumentViewType): string => {
  if (d.status === 'superseded') return DEVELOP_DOC_STATUS_LABELS.superseded;
  if (d.status === 'sent') return d.approval ? '확인 요청' : '공유됨';
  if (d.decision !== null) return developDocDecisionLabel(d.type, d.decision);
  return DEVELOP_DOC_STATUS_LABELS[d.status];
};
const badgeClass = (d: DevelopDocumentViewType): string => {
  if (d.status === 'sent') return d.approval ? 'bg-brand-500 text-white' : 'bg-paper text-tx-2';
  if (d.status === 'approved') return 'bg-emerald-600 text-white';
  if (d.status === 'conditional') return 'bg-emerald-100 text-emerald-700';
  if (d.status === 'changes_requested' || d.status === 'discuss_requested') return 'bg-amber-100 text-amber-800';
  if (d.status === 'rejected') return 'bg-red-100 text-red-700';
  return 'bg-line text-tx-3';
};

// 아코디언 — 여러 개를 동시에 펼 수 있다. 회신 대기 문서는 데이터가 오는 즉시 펴 둔다.
const openIds = ref<number[]>([]);
const isOpen = (id: number): boolean => openIds.value.includes(id);
function toggle(id: number): void {
  openIds.value = isOpen(id) ? openIds.value.filter((x) => x !== id) : [...openIds.value, id];
}
watch(
  current,
  (list) => {
    for (const d of list) {
      if (openable(d) && !isOpen(d.documentId)) openIds.value = [...openIds.value, d.documentId];
    }
  },
  { immediate: true },
);

// 이전 판 접힘 — 카드마다 따로.
const openPrev = ref<number[]>([]);
function togglePrev(id: number): void {
  openPrev.value = openPrev.value.includes(id) ? openPrev.value.filter((x) => x !== id) : [...openPrev.value, id];
}
</script>

<template>
  <div v-if="current.length > 0" class="grid gap-3">
    <article
      v-for="d in current"
      :id="`document-${String(d.documentId)}`"
      :key="d.documentId"
      class="scroll-mt-32 rounded-2xl border bg-white"
      :class="openable(d) ? 'border-2 border-brand-500' : 'border-line'"
    >
      <!-- 카드 머리(클릭 = 펼침) -->
      <button type="button" class="grid w-full gap-2 p-5 text-left sm:p-6" :aria-expanded="isOpen(d.documentId)" @click="toggle(d.documentId)">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full px-2.5 py-1 text-micro font-bold" :class="badgeClass(d)">{{ badgeText(d) }}</span>
          <span class="font-mono text-micro font-bold tabular-nums text-tx-2">{{ d.docNo }}</span>
          <span v-if="d.version > 1" class="rounded-full bg-paper px-2 py-0.5 text-micro font-bold text-tx-2">v{{ d.version }}</span>
          <span v-if="d.files.length > 0" class="rounded-full bg-paper px-2 py-0.5 text-micro font-bold text-tx-2">첨부 {{ d.files.length }}</span>
          <span class="ml-auto text-label font-bold text-tx-3">{{ isOpen(d.documentId) ? '접기' : '펼치기' }}</span>
        </div>
        <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span class="text-title font-extrabold text-tx-1">{{ typeLabel(d) }}</span>
          <span v-if="d.sentAt !== null" class="font-mono text-micro tabular-nums text-tx-3">발송 {{ dateShort(d.sentAt) }}</span>
          <span v-if="d.replyDueOn !== null" class="font-mono text-micro tabular-nums text-tx-3">회신 요청일 {{ d.replyDueOn }}</span>
        </div>
      </button>

      <!-- 카드 본문 -->
      <div v-if="isOpen(d.documentId)" class="grid gap-4 border-t border-line p-5 sm:p-6">
        <DocumentView :doc="d" :request-id="requestId" @download="emit('download', $event)" @preview="emit('preview', $event)" />

        <!-- 회신(승인형 sent) -->
        <DocumentDecision
          v-if="openable(d)"
          :type="d.type"
          :default-name="contactName"
          :pending="decidePending && decidingDocId === d.documentId"
          :error="decidingDocId === d.documentId ? decideError : ''"
          @submit="emit('decide', { documentId: d.documentId, ...$event })"
        />

        <!-- 회신 결과 -->
        <div v-else-if="d.decision !== null" class="grid gap-1.5 rounded-xl bg-paper px-4 py-3.5">
          <p class="text-body font-bold text-tx-1">
            회신 · {{ developDocDecisionLabel(d.type, d.decision) }}
            <span v-if="d.decidedName !== null" class="font-normal text-tx-2"> · {{ d.decidedName }}</span>
            <span v-if="d.decidedAt !== null" class="font-mono text-label font-normal text-tx-3"> · {{ dateTimeKst(d.decidedAt) }}</span>
          </p>
          <p v-if="d.decisionNote !== null" class="whitespace-pre-wrap text-body leading-relaxed text-tx-2">{{ d.decisionNote }}</p>
        </div>
        <p v-else-if="!d.approval" class="rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-2">
          공유용 문서라 회신이 필요하지 않습니다. 궁금한 점은 아래 문의로 남겨 주세요.
        </p>

        <!-- 이전 판 -->
        <div v-if="previousOf(d).length > 0" class="grid gap-2 border-t border-line pt-4">
          <div>
            <button
              type="button"
              class="h-8 rounded-lg border border-line-2 px-3 text-label font-bold text-tx-2 transition hover:border-tx-3"
              @click="togglePrev(d.documentId)"
            >
              {{ openPrev.includes(d.documentId) ? '이전 판 접기' : `이전 판 보기 (${String(previousOf(d).length)})` }}
            </button>
          </div>
          <div v-if="openPrev.includes(d.documentId)" class="grid gap-3">
            <section v-for="p in previousOf(d)" :key="p.documentId" class="grid gap-3 rounded-xl border border-line bg-paper/60 p-4">
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full px-2 py-0.5 text-micro font-bold" :class="badgeClass(p)">{{ badgeText(p) }}</span>
                <span class="font-mono text-micro font-bold tabular-nums text-tx-2">{{ p.docNo }} v{{ p.version }}</span>
                <span v-if="p.sentAt !== null" class="font-mono text-micro tabular-nums text-tx-3">발송 {{ dateShort(p.sentAt) }}</span>
              </div>
              <p v-if="p.decision !== null" class="text-label text-tx-2">
                당시 회신 · {{ developDocDecisionLabel(p.type, p.decision) }}
                <span v-if="p.decisionNote !== null"> — {{ p.decisionNote }}</span>
              </p>
              <DocumentView :doc="p" :request-id="requestId" @download="emit('download', $event)" @preview="emit('preview', $event)" />
            </section>
          </div>
        </div>
      </div>
    </article>
  </div>

  <p v-else class="rounded-2xl border border-dashed border-line-2 bg-white px-6 py-10 text-center text-body text-tx-3">
    아직 받으신 프로젝트 문서가 없습니다. 담당자가 착수회의록·검토서·승인서를 보내면 여기에 모입니다.
  </p>
</template>
