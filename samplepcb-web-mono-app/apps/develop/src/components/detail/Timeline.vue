<script setup lang="ts">
import { DEVELOP_EVENT_TYPE_LABELS } from '@sp/api-contract';
import type { DevelopEventTypeType, DevelopEventViewType, DevelopFileMetaType } from '@sp/api-contract';
import { canPreview } from '@sp/ui';
import { dateTimeKst, fileSize } from '../../lib/format';

// 진행·문의 타임라인 — 서버가 visibleToCustomer 이벤트만 내려준다(비공개 메모는 오지 않는다).
// 잠긴 산출물(locked)은 파일명·크기만 보이고 받기가 막힌다 — 서버도 403 LOCKED_UNTIL_PAID 로 막는다.
// P2: 내가 답할 차례인 이벤트(산출물 검수·중간 확인 요청)에는 부모가 `event-actions` 슬롯으로 패널을
// 꽂는다. 어떤 이벤트가 미응답인지는 뒤따르는 이벤트를 봐야 알 수 있어 판정은 부모(상세)가 한다.
defineProps<{ events: DevelopEventViewType[] }>();
const emit = defineEmits<{ download: [DevelopFileMetaType]; preview: [DevelopFileMetaType] }>();

const label = (t: DevelopEventTypeType): string => DEVELOP_EVENT_TYPE_LABELS[t];

// 타입별 점 색 — 상태·산출물처럼 흐름이 바뀌는 사건만 브랜드색을 쓴다.
const dotClass = (t: DevelopEventTypeType): string => {
  switch (t) {
    case 'status_changed':
    case 'quote_sent':
    case 'quote_accepted':
    case 'payment_confirmed':
      return 'bg-brand-500';
    case 'deliverable':
    case 'published':
      return 'bg-emerald-600';
    case 'quote_declined':
    case 'review_changes':
      return 'bg-red-500';
    default:
      return 'bg-line-2';
  }
};
</script>

<template>
  <ol v-if="events.length > 0" class="grid gap-0">
    <li v-for="(e, i) in events" :key="e.eventId" class="grid grid-cols-[16px_1fr] gap-x-3.5">
      <!-- 세로선 + 점 -->
      <div class="relative flex justify-center">
        <span v-if="i > 0" class="absolute top-0 h-2.5 w-px bg-line" />
        <span class="mt-2.5 h-2.5 w-2.5 shrink-0 rounded-full" :class="dotClass(e.type)" />
        <span v-if="i < events.length - 1" class="absolute top-5 bottom-0 w-px bg-line" />
      </div>

      <div class="grid gap-1.5 pb-6">
        <div class="flex flex-wrap items-baseline gap-2">
          <span class="rounded-full bg-paper px-2 py-0.5 text-micro font-bold text-tx-2">{{ label(e.type) }}</span>
          <span class="text-body font-bold text-tx-1">{{ e.title }}</span>
          <span class="ml-auto font-mono text-micro tabular-nums text-tx-3">{{ dateTimeKst(e.createdAt) }}</span>
        </div>
        <p class="text-label text-tx-3">{{ e.actorName }}</p>
        <p v-if="e.body !== null" class="whitespace-pre-wrap text-body leading-relaxed text-tx-2">{{ e.body }}</p>

        <ul v-if="e.files.length > 0" class="mt-1 grid gap-1.5">
          <li
            v-for="f in e.files"
            :key="f.fileId"
            class="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-label"
          >
            <span class="min-w-0 flex-1 truncate font-semibold" :class="f.locked ? 'text-tx-3' : 'text-tx-1'">
              <span v-if="f.locked" aria-hidden="true">🔒 </span>{{ f.name }}
            </span>
            <span class="shrink-0 tabular-nums text-tx-3">{{ fileSize(f.size) }}</span>
            <template v-if="f.locked">
              <span class="shrink-0 text-tx-3">잔금 결제 후 내려받기</span>
            </template>
            <template v-else>
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
            </template>
          </li>
        </ul>

        <!-- 이벤트별 액션(검수 확정·확인 요청 답변) — 부모가 답할 차례인 이벤트에만 채운다. -->
        <slot name="event-actions" :event="e" />
      </div>
    </li>
  </ol>
  <p v-else class="rounded-2xl border border-dashed border-line-2 bg-white px-6 py-10 text-center text-body text-tx-3">
    아직 진행 기록이 없습니다. 담당자가 검토를 시작하면 여기에 쌓입니다.
  </p>
</template>
