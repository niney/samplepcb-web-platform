<script setup lang="ts">
import { DEVELOP_EVENT_TYPE_LABELS, DEVELOP_REQUEST_STATUS_LABELS } from '@sp/api-contract';
import type { DevelopEventTypeType, DevelopEventViewType, DevelopFileMetaType } from '@sp/api-contract';
import { canPreview } from '@sp/ui';
import { dateTimeDot, fileSize } from '../../lib/format';

// 진행 사항 — 피그마 「00-3 의뢰 상세」 38:9471: 세로선 위 색 점 + 종류 칩 + 한 줄 + 오른쪽 시각.
// 서버가 visibleToCustomer 이벤트만 내려준다(비공개 메모는 오지 않는다). 본문·첨부·작성자·응답 패널은 그 줄 아래에 붙인다.
// 잠긴 산출물(locked)은 파일명·크기만 보이고 받기가 막힌다 — 서버도 403 LOCKED_UNTIL_PAID 로 막는다.
// 내가 답할 차례인 이벤트(산출물 검수·중간 확인 요청)에는 부모가 `event-actions` 슬롯으로 패널을 꽂는다.
defineProps<{ events: DevelopEventViewType[] }>();
const emit = defineEmits<{ download: [DevelopFileMetaType]; preview: [DevelopFileMetaType]; openDocuments: [] }>();

// 고객이 누른 버튼이 '견적 수정 요청'이라 거절 이벤트도 그 말로(관리자 화면은 계약 라벨 그대로).
const label = (t: DevelopEventTypeType): string => (t === 'quote_declined' ? '견적 수정 요청' : DEVELOP_EVENT_TYPE_LABELS[t]);

// 한 줄 문구 — 서버가 저장한 제목(관리자 화면과 공용)을 고객 어휘로 다듬는다.
// 상태 변경은 '상태가 바뀌었습니다'만 저장돼 있어 어느 상태로 갔는지 payload.to 로 밝힌다. 견적 거절은 '수정 요청'으로.
const titleOf = (e: DevelopEventViewType): string => {
  if (e.type === 'status_changed') {
    const to = e.payload?.to;
    const hit = Object.entries(DEVELOP_REQUEST_STATUS_LABELS).find(([code]) => code === to);
    if (hit !== undefined) return `진행 상태: ${hit[1]}`;
  }
  if (e.type === 'quote_declined') return e.title.replace(/\s*을 거절했습니다$/, ' 수정을 요청했습니다');
  return e.title;
};

// 문서 사건(§13)의 문서번호 칩 — payload 는 계약상 Record<string, unknown> 이라 좁혀 읽는다.
const docNo = (e: DevelopEventViewType): string => {
  if (e.type !== 'document_sent' && e.type !== 'document_decided') return '';
  const v = e.payload?.docNo;
  return typeof v === 'string' ? v : '';
};

// 종류별 톤 — 시안의 네 가지(보라·검정·파랑·회색)로 묶는다. 점 색 = 칩 글자색.
type Tone = 'purple' | 'black' | 'blue' | 'gray';
const TONE: Record<Tone, { chip: string; dot: string }> = {
  purple: { chip: 'bg-[#e6dbff] text-[#6a11a6]', dot: 'bg-[#6a11a6]' },
  black: { chip: 'bg-black text-white', dot: 'bg-black' },
  blue: { chip: 'bg-[#dbe7ff] text-[#1147a6]', dot: 'bg-[#1147a6]' },
  gray: { chip: 'bg-[#e8e8e8] text-[#333]', dot: 'bg-[#333]' },
};
const toneOf = (t: DevelopEventTypeType): Tone => {
  switch (t) {
    case 'comment':
    case 'as_request':
    case 'review_request':
    case 'quote_sent':
    case 'document_sent':
      return 'purple'; // 오가는 요청·전달
    case 'quote_accepted':
    case 'payment_confirmed':
    case 'review_approved':
    case 'document_decided':
    case 'deliverable':
    case 'tax_invoice':
      return 'black'; // 확정·완료
    case 'status_changed':
    case 'published':
    case 'schedule_changed':
    case 'milestone_opened':
      return 'blue'; // 진행 흐름
    default:
      return 'gray'; // 수정·메모·거절
  }
};
</script>

<template>
  <ol v-if="events.length > 0" class="flex flex-col px-[12px]">
    <li v-for="(e, i) in events" :key="e.eventId" class="grid grid-cols-[10px_1fr] gap-x-[14px]">
      <!-- 세로선 + 점 -->
      <div class="relative flex justify-center">
        <span v-if="i > 0" class="absolute top-0 h-[7px] w-px bg-[#d9d9d9]" aria-hidden="true" />
        <span class="relative mt-[7px] size-[10px] shrink-0 rounded-full" :class="TONE[toneOf(e.type)].dot" />
        <span v-if="i < events.length - 1" class="absolute bottom-0 top-[17px] w-px bg-[#d9d9d9]" aria-hidden="true" />
      </div>

      <div class="flex min-w-0 flex-col gap-[6px]" :class="i < events.length - 1 ? 'pb-[20px]' : ''">
        <div class="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[4px]">
          <div class="flex min-w-0 flex-wrap items-center gap-[8px]">
            <span class="shrink-0 rounded-[37px] px-[8px] py-[4px] text-center text-[12px] font-semibold leading-[1.3]" :class="TONE[toneOf(e.type)].chip">{{ label(e.type) }}</span>
            <button
              v-if="docNo(e) !== ''"
              type="button"
              class="shrink-0 rounded-[37px] bg-[#f1f6ff] px-[8px] py-[4px] text-[12px] font-semibold leading-[1.3] tabular-nums text-[#1147a6] transition-colors hover:bg-[#dbe7ff]"
              @click="emit('openDocuments')"
            >
              {{ docNo(e) }}
            </button>
            <span class="min-w-0 text-[15px] leading-[1.3] text-[#141e34]">{{ titleOf(e) }}</span>
            <!-- 누가 썼는지는 문의·A/S 에서만 뜻이 있다(나머지는 늘 '담당자'라 시안처럼 뺀다) -->
            <span v-if="(e.type === 'comment' || e.type === 'as_request') && e.actorName !== ''" class="text-[13px] leading-[1.3] text-[#999]">{{ e.actorName }}</span>
          </div>
          <span class="shrink-0 whitespace-pre text-[14px] leading-[1.3] tabular-nums text-[#666]">{{ dateTimeDot(e.createdAt) }}</span>
        </div>
        <p v-if="e.body !== null" class="whitespace-pre-wrap rounded-[10px] bg-[#f5f6f8] px-[14px] py-[10px] text-[15px] leading-[1.8] text-[#141e34]">{{ e.body }}</p>

        <ul v-if="e.files.length > 0" class="flex flex-col gap-[6px]">
          <li
            v-for="f in e.files"
            :key="f.fileId"
            class="flex min-w-0 flex-wrap items-center gap-[8px] rounded-[10px] border border-[#d9d9d9] px-[12px] py-[8px] text-[14px]"
          >
            <span class="min-w-0 flex-1 truncate font-medium" :class="f.locked ? 'text-[#999]' : 'text-black'">
              <span v-if="f.locked" aria-hidden="true">🔒 </span>{{ f.name }}
            </span>
            <span class="shrink-0 tabular-nums text-[#999]">{{ fileSize(f.size) }}</span>
            <span v-if="f.locked" class="shrink-0 text-[#999]">잔금 결제 후 내려받기</span>
            <template v-else>
              <button
                v-if="canPreview(f)"
                type="button"
                class="flex h-[30px] shrink-0 items-center rounded-[6px] border border-[#d9d9d9] px-[10px] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:border-[#9aa3ad]"
                @click="emit('preview', f)"
              >
                미리보기
              </button>
              <button
                type="button"
                class="flex h-[30px] shrink-0 items-center rounded-[6px] border border-[#d9d9d9] px-[10px] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:border-[#9aa3ad]"
                @click="emit('download', f)"
              >
                다운로드
              </button>
            </template>
          </li>
        </ul>

        <!-- 이벤트별 액션(검수 확정·확인 요청 답변) — 부모가 답할 차례인 이벤트에만 채운다. -->
        <slot name="event-actions" :event="e" />
      </div>
    </li>
  </ol>
  <p v-else class="rounded-[10px] border border-[#d9d9d9] px-[16px] py-[14px] text-[15px] leading-[1.8] text-[#666]">
    아직 진행 기록이 없습니다. 담당자가 검토를 시작하면 여기에 쌓입니다.
  </p>
</template>
