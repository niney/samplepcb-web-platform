<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { DEVELOP_MILESTONE_TRIGGER_LABELS, developQuoteXlsxName } from '@sp/api-contract';
import type { DevelopQuoteStatusType, DevelopQuoteViewType } from '@sp/api-contract';
import { developRequestPath } from '../../api/useDevelopRequests';
import { quoteStatusLabel } from '../../lib/deck-content';
import { downloadAuthedFile } from '../../lib/download';
import { errorMessage } from '../../lib/error-msg';
import { dateShort, won } from '../../lib/format';
import DeckPanel from '../deck/DeckPanel.vue';

// 견적서의 '하는' 부분 — 견적 장(금액 · 결제 조건 · 견적 조건 · 산출 내역은 DeckBook 이 장으로 그린다) 아래에 붙는 판:
// 받기(계약서 · 인쇄용 · PDF · 엑셀) → 지금 결제할 금액 → 처리 결과 → 표준 조건 → 수락 · 수정 요청.
// 장 안에 넣지 않는 까닭: 동의 · 성함 · 사유 입력과 오류 문구로 높이가 바뀌고, 돈이 걸린 동작이라 고정 틀에 가두지 않는다(§7.2.12).
// 수락은 표준 조건 동의 + 성함이 계약을 갈음하므로(서버가 시각 · IP · 이름을 기록) 두 입력을 모두 요구한다.
// 두 번째 단추는 '견적 수정 요청' — 동작은 거절(사유)과 같고 담당자가 새 견적을 보낸다(사용자 결정 2026-10-22).
// `payable` 은 서버 파생이라 화면이 다시 계산하지 않는다 — 그 마일스톤에만 결제 단추를 세운다.
const props = withDefaults(
  defineProps<{
    quote: DevelopQuoteViewType;
    requestId: number;
    contactName?: string;
    acceptPending?: boolean;
    declinePending?: boolean;
    payingMilestoneId?: number | null;
    actionError?: string;
    scale?: number | null; // PC — 넘겨 보는 장의 줄임 비율(장과 같은 폭 · 여백의 판)
  }>(),
  { contactName: '', acceptPending: false, declinePending: false, payingMilestoneId: null, actionError: '', scale: null },
);
const emit = defineEmits<{
  accept: [{ quoteId: number; name: string }];
  decline: [{ quoteId: number; reason: string }];
  pay: [number];
}>();

const q = computed(() => props.quote);
const statusTone: Record<DevelopQuoteStatusType, string> = {
  draft: 'bg-line text-[#3b4558]',
  sent: 'bg-brand-600 text-white',
  accepted: 'bg-[#141e34] text-white',
  declined: 'bg-line text-[#3b4558]',
  expired: 'bg-line text-[#3b4558]',
  superseded: 'bg-line text-[#3b4558]',
  withdrawn: 'bg-line text-[#3b4558]',
};
const printPath = computed(() => `/develop/requests/${String(props.requestId)}/quotes/${String(q.value.quoteId)}/print`);
const payable = computed(() => q.value.milestones.filter((m) => m.payable));

// 엑셀 — 서버가 견적서 1쪽과 같은 표로 만든다(Authorization 이 필요해 blob 으로 받는다).
const xlsxBusy = ref(false);
const xlsxError = ref('');
async function downloadXlsx(): Promise<void> {
  if (xlsxBusy.value) return;
  xlsxBusy.value = true;
  xlsxError.value = '';
  try {
    await downloadAuthedFile(`${developRequestPath(props.requestId)}/quotes/${String(q.value.quoteId)}/xlsx`, developQuoteXlsxName(q.value));
  } catch (e) {
    xlsxError.value = errorMessage(e, '엑셀을 내려받지 못했습니다.');
  } finally {
    xlsxBusy.value = false;
  }
}

// ── 수락 · 수정 요청(발송된 견적만) ─────────────────────────────────────────────
const open = computed(() => q.value.status === 'sent');
const agree = ref(false);
const name = ref(props.contactName);
watch(
  () => props.contactName,
  (v) => {
    if (name.value.trim() === '') name.value = v;
  },
);
const canAccept = computed(() => agree.value && name.value.trim() !== '' && !props.acceptPending);
const declineOpen = ref(false);
const declineReason = ref('');
function onAccept(): void {
  if (!canAccept.value) return;
  emit('accept', { quoteId: q.value.quoteId, name: name.value.trim() });
}
function onDecline(): void {
  emit('decline', { quoteId: q.value.quoteId, reason: declineReason.value });
}

const LINK =
  'flex h-[34px] items-center rounded-[6px] border border-line-2 bg-white px-[12px] text-[14px] leading-[1.3] text-[#141e34] transition-colors hover:bg-brand-50 disabled:opacity-50';
const PRIMARY =
  'flex h-[38px] items-center justify-center rounded-[6px] bg-[#141e34] px-[16px] text-[14px] font-medium leading-[1.3] text-white transition-opacity hover:opacity-85 disabled:opacity-40';
const NOTE = 'rounded-[10px] bg-brand-50 px-[20px] py-[12px] text-[16px] leading-[1.6]';
</script>

<template>
  <DeckPanel :scale="scale" slim :data-quote-actions="q.quoteId">
    <div class="flex flex-col gap-[16px]">
      <!-- 어느 견적인가 + 받기 -->
      <div class="flex flex-wrap items-center gap-x-[10px] gap-y-[8px]">
        <h3 class="text-[18px] font-bold leading-[1.4]">{{ q.title }}</h3>
        <span class="rounded-full px-[10px] py-[3px] text-[13px] font-semibold leading-[1.4]" :class="statusTone[q.status]">{{ quoteStatusLabel(q) }}</span>
        <div class="ml-auto flex shrink-0 flex-wrap gap-[8px]">
          <!-- 계약서 = 수락 견적서의 인쇄 뷰(§2 결정 11) — 수락된 견적에만 뜻이 있다. -->
          <a v-if="q.status === 'accepted'" :href="`${printPath}?mode=contract`" target="_blank" rel="noopener" :class="LINK">계약서 보기</a>
          <a :href="printPath" target="_blank" rel="noopener" :class="LINK">인쇄용 보기</a>
          <!-- PDF = 인쇄용 보기를 열어 그려지자마자 내려받는다(1쪽 견적서 + 별지, 화면 캡처 — QuotePrint) -->
          <a :href="`${printPath}?download=pdf`" target="_blank" rel="noopener" :class="LINK">PDF</a>
          <button type="button" :class="LINK" :disabled="xlsxBusy" @click="downloadXlsx">{{ xlsxBusy ? '내려받는 중…' : '엑셀' }}</button>
        </div>
        <p v-if="xlsxError !== ''" role="alert" class="w-full text-[14px] font-semibold text-red-700">{{ xlsxError }}</p>
      </div>

      <!-- 지금 결제할 금액 — 결제할 수 있는 마일스톤에만 단추 -->
      <div v-if="payable.length > 0" class="flex flex-col gap-[10px] rounded-[10px] bg-brand-50 px-[20px] py-[14px]" data-quote="pay">
        <p class="text-[16px] font-bold leading-[1.4]">지금 결제하실 금액</p>
        <div v-for="m in payable" :key="m.milestoneId" class="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[8px]">
          <p class="min-w-0 text-[16px] leading-[1.5]">
            <b class="font-semibold">{{ m.title }}</b><span class="ml-[10px] text-[14px] text-tx-2">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }}</span>
          </p>
          <button type="button" :class="PRIMARY" :disabled="payingMilestoneId !== null" @click="emit('pay', m.milestoneId)">
            {{ payingMilestoneId === m.milestoneId ? '이동 중…' : `${won(m.amount)} 결제` }}
          </button>
        </div>
      </div>

      <!-- 처리 결과 -->
      <p v-if="q.acceptedAt !== null" :class="NOTE">
        {{ dateShort(q.acceptedAt) }} 수락<template v-if="q.acceptedName !== null"> · {{ q.acceptedName }}</template>
      </p>
      <p v-else-if="q.declinedAt !== null" :class="NOTE">
        {{ dateShort(q.declinedAt) }} 수정 요청함<template v-if="q.declineReason !== null && q.declineReason !== ''"> · {{ q.declineReason }}</template>
      </p>
      <p v-if="q.status === 'expired'" :class="NOTE">유효기간이 지났습니다 — 담당자에게 재견적을 요청해 주세요.</p>

      <!-- 표준 조건 — 수락이 이 조건에 동의하는 것이라 수락하는 자리 바로 위에 둔다 -->
      <details class="rounded-[10px] border border-line px-[20px] py-[12px]">
        <summary class="cursor-pointer list-none text-[16px] font-semibold leading-[1.6]">표준 조건 <span class="text-[14px] font-normal text-tx-2">눌러서 펼치기</span></summary>
        <p class="mt-[8px] whitespace-pre-wrap text-[15px] leading-[1.75]">{{ q.terms }}</p>
      </details>

      <!-- 수락 · 수정 요청(발송된 견적만) -->
      <div v-if="open" class="flex flex-col gap-[6px] rounded-[10px] border border-brand-200 bg-brand-50 px-[20px] py-[16px]" data-quote="decide">
        <div class="flex flex-wrap items-center justify-between gap-[12px]">
          <p class="text-[18px] font-bold leading-[1.4]">이 견적으로 진행할까요?</p>
          <label class="flex items-center gap-[12px]">
            <span class="text-[15px] font-semibold leading-[1.6]">수락하시는 분 성함</span>
            <input
              v-model="name"
              type="text"
              maxlength="100"
              placeholder="성함"
              class="h-[38px] w-[170px] rounded-[6px] border border-line-2 bg-white px-[12px] text-[15px] leading-[1.3]"
            >
          </label>
        </div>
        <p class="text-[15px] leading-[1.7] text-[#3b4558]">
          수락하시면 위 표준 조건에 동의한 것으로 보고 계약을 갈음합니다. 수락 시각과 성함이 기록되며, 곧바로 착수금 결제가 열립니다.
        </p>
        <div class="mt-[4px] flex flex-wrap items-center gap-x-[20px] gap-y-[10px]">
          <label class="flex cursor-pointer items-center gap-[8px]">
            <input v-model="agree" type="checkbox" class="size-[20px] accent-[#141e34]">
            <span class="text-[16px] leading-[1.6]">위 조건에 동의합니다</span>
          </label>
          <div class="flex items-center gap-[10px]">
            <button type="button" class="min-w-[96px]" :class="PRIMARY" :disabled="!canAccept" @click="onAccept">{{ acceptPending ? '처리 중…' : '견적 수락' }}</button>
            <button v-if="!declineOpen" type="button" class="!h-[38px] !px-[16px]" :class="LINK" @click="declineOpen = true">견적 수정 요청</button>
          </div>
          <span class="text-[14px] leading-[1.6] text-tx-2">유효기간 {{ q.validUntil }}까지</span>
        </div>
        <p v-if="actionError !== ''" class="mt-[4px] text-[14px] font-semibold text-red-700">{{ actionError }}</p>

        <div v-if="declineOpen" class="mt-[10px] flex flex-col gap-[10px] rounded-[10px] border border-line bg-white p-[16px]">
          <p class="text-[16px] font-bold leading-[1.4]">견적 수정을 요청할까요?</p>
          <p class="text-[15px] leading-[1.7] text-[#3b4558]">이 견적은 닫히고 의뢰는 그대로 남습니다. 바꾸고 싶은 점을 적어 주시면 담당자가 조건을 다시 잡아 새 견적을 보내드립니다.</p>
          <input
            v-model="declineReason"
            type="text"
            maxlength="1000"
            placeholder="수정하고 싶은 내용 (선택)"
            class="h-[38px] rounded-[6px] border border-line-2 bg-white px-[12px] text-[15px]"
          >
          <div class="flex flex-wrap gap-[10px]">
            <button type="button" :class="PRIMARY" :disabled="declinePending" @click="onDecline">{{ declinePending ? '처리 중…' : '수정 요청 보내기' }}</button>
            <button type="button" class="!h-[38px] !px-[16px]" :class="LINK" @click="declineOpen = false">그만두기</button>
          </div>
        </div>
      </div>

      <!-- 결제 오류(수락 이후에도 보이게) -->
      <p v-else-if="actionError !== ''" class="rounded-[10px] bg-red-50 px-[20px] py-[12px] text-[14px] font-semibold text-red-700">{{ actionError }}</p>
    </div>
  </DeckPanel>
</template>
