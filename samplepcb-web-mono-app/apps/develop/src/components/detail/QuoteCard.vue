<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  DEVELOP_MILESTONE_STATUS_LABELS,
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_KIND_LABELS,
  DEVELOP_QUOTE_STATUS_LABELS,
  DEVELOP_VAT_MODE_LABELS,
} from '@sp/api-contract';
import type { DevelopMilestoneViewType, DevelopQuoteStatusType, DevelopQuoteViewType } from '@sp/api-contract';
import { dateShort, won } from '../../lib/format';
import iconQuote from '../../assets/detail/quote-doc.svg';
import checkboxEmpty from '../../assets/detail/checkbox.svg';

// 견적서 카드 — 피그마 「00-3 의뢰 상세」 38:9521: 제목 · 항목표(2열) · 금액 상자 · 조건 목록 · "이 견적으로 진행할까요?".
// 조건 문서 한 장(docs/DEVELOP_FLOW.md §5)이고 P2 의 **수락·수정 요청(=거절)·마일스톤 결제**가 붙어 있다.
// 수락은 표준 조건 동의 + 성함이 계약을 갈음하므로(서버가 시각·IP·이름을 기록) 두 입력을 모두 요구한다.
// 두 번째 버튼은 시안 문구 '견적 수정 요청' — 동작은 기존 거절(사유)과 같고 담당자가 새 견적을 보낸다(사용자 결정 2026-10-22).
// `payable` 은 서버 파생이라 화면이 다시 계산하지 않는다 — 그 행에만 결제 버튼을 세운다.
// 시안에 없는 결제 조건·처리 결과·표준 조건·인쇄 링크는 같은 모양 언어로 붙인다.
const props = withDefaults(
  defineProps<{
    quote: DevelopQuoteViewType;
    requestId: number;
    contactName?: string;
    acceptPending?: boolean;
    declinePending?: boolean;
    payingMilestoneId?: number | null;
    actionError?: string;
  }>(),
  { contactName: '', acceptPending: false, declinePending: false, payingMilestoneId: null, actionError: '' },
);
const emit = defineEmits<{
  accept: [{ quoteId: number; name: string }];
  decline: [{ quoteId: number; reason: string }];
  pay: [number];
}>();

const q = computed(() => props.quote);
const vatLabel = computed(() => DEVELOP_VAT_MODE_LABELS[q.value.vatMode]);
const kindLabel = computed(() => DEVELOP_QUOTE_KIND_LABELS[q.value.kind]);
const statusLabel = computed(() => DEVELOP_QUOTE_STATUS_LABELS[q.value.status]);

const statusTone: Record<DevelopQuoteStatusType, string> = {
  draft: 'bg-[#e8e8e8] text-[#333]',
  sent: 'bg-[#1b6ff3] text-white',
  accepted: 'bg-[#1b2b39] text-white',
  declined: 'bg-[#e8e8e8] text-[#333]',
  expired: 'bg-[#e8e8e8] text-[#333]',
  superseded: 'bg-[#e8e8e8] text-[#333]',
  withdrawn: 'bg-[#e8e8e8] text-[#333]',
};

const printPath = computed(() => `/develop/requests/${String(props.requestId)}/quotes/${String(q.value.quoteId)}/print`);

// 항목표는 시안처럼 두 열로 나눠 싣는다(앞 절반 · 뒤 절반).
const itemColumns = computed(() => {
  const half = Math.ceil(q.value.items.length / 2);
  return [q.value.items.slice(0, half), q.value.items.slice(half)].filter((c) => c.length > 0);
});

// 조건 목록 — 값이 있는 것만
const terms = computed(() => {
  const list: { label: string; value: string }[] = [];
  const v = q.value;
  if (v.durationDays !== null || v.scheduleNote !== null) {
    list.push({ label: '개발 기간', value: [v.durationDays === null ? '' : `${String(v.durationDays)}일`, v.scheduleNote ?? ''].filter((s) => s !== '').join(' · ') });
  }
  if (v.deliverables.length > 0) list.push({ label: '산출물', value: v.deliverables.join(', ') });
  if (v.exclusions !== null) list.push({ label: '별도 실비', value: v.exclusions });
  list.push({ label: '검수 기간', value: `납품 후 ${String(v.reviewDays)}일${v.warrantyDays === null ? '' : ` · 하자보수 ${String(v.warrantyDays)}일`}` });
  list.push({ label: '유효 기간', value: `${v.validUntil}까지${v.sentAt === null ? '' : ` · 발행 ${dateShort(v.sentAt)}`}` });
  if (v.note !== null) list.push({ label: '비고', value: v.note });
  return list;
});

// ── 수락·수정 요청(sent 만) ───────────────────────────────────────────────────
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

// 결제 대상 마일스톤의 입금 대기 표시 — 무통장이면 주문은 났는데 od_status 가 '주문'에 머문다.
const awaitingDeposit = (m: DevelopMilestoneViewType): boolean => m.payment !== null && m.payment.odStatus === '주문' && m.status !== 'paid';
const amountParts = (n: number): string => n.toLocaleString('ko-KR');
</script>

<template>
  <article class="flex flex-col gap-[20px] rounded-[14px] bg-white px-[24px] py-[26px] shadow-[0_8px_15px_rgba(0,0,0,0.06)]">
    <!-- 제목 -->
    <header class="flex flex-wrap items-center gap-x-[10px] gap-y-[8px]">
      <h3 class="text-[18px] font-semibold leading-[1.8] text-black">{{ q.title }}</h3>
      <span class="rounded-[37px] px-[8px] py-[4px] text-[12px] font-semibold leading-[1.3]" :class="statusTone[q.status]">{{ statusLabel }}</span>
      <span class="rounded-[37px] bg-[#f5f6f8] px-[8px] py-[4px] text-[12px] font-semibold leading-[1.3] text-[#475569]">{{ kindLabel }}</span>
      <div class="ml-auto flex shrink-0 flex-wrap gap-[10px]">
        <!-- 계약서 = 수락 견적서의 인쇄 뷰(§2 결정 11) — 수락된 견적에만 뜻이 있다. -->
        <a
          v-if="q.status === 'accepted'"
          :href="`${printPath}?mode=contract`"
          target="_blank"
          rel="noopener"
          class="flex h-[34px] items-center rounded-[6px] border border-[#d9d9d9] px-[10px] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:border-[#9aa3ad]"
        >
          계약서 보기
        </a>
        <a
          :href="printPath"
          target="_blank"
          rel="noopener"
          class="flex h-[34px] items-center rounded-[6px] border border-[#d9d9d9] px-[10px] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:border-[#9aa3ad]"
        >
          인쇄용 보기
        </a>
      </div>
    </header>

    <!-- 항목표(2열) -->
    <div class="grid gap-[20px] md:grid-cols-2">
      <div v-for="(col, ci) in itemColumns" :key="ci" class="flex flex-col gap-[4px] leading-[1.8]">
        <div class="flex items-center gap-[14px] bg-[#f5f6f8] px-[10px] text-[14px] font-medium text-[#666]">
          <span class="min-w-0 flex-1">항목</span>
          <span class="w-[144px] shrink-0">금액</span>
        </div>
        <div v-for="item in col" :key="item.itemId" class="flex items-start gap-[14px] px-[10px]">
          <div class="min-w-0 flex-1">
            <p class="text-[15px] font-bold text-black">{{ item.title }}</p>
            <p v-if="item.description !== null" class="whitespace-pre-wrap text-[14px] leading-[1.6] text-[#666]">{{ item.description }}</p>
            <p v-if="item.durationDays !== null" class="text-[14px] leading-[1.6] text-[#666]">{{ item.durationDays }}일</p>
          </div>
          <span class="w-[144px] shrink-0 text-[15px] tabular-nums text-[#141e34]">{{ won(item.amount) }}</span>
        </div>
      </div>
    </div>

    <!-- 금액 -->
    <dl class="flex w-full flex-col gap-[16px] rounded-[8px] border border-[#d9d9d9] bg-white px-[16px] py-[20px] md:w-[calc(50%-10px)]">
      <div class="flex items-center justify-between">
        <dt class="text-[14px] leading-[14px] tracking-[-0.56px] text-[#39404d]">공급가</dt>
        <dd class="text-right text-[15px] leading-[14px] text-[#5f6777]"><b class="font-bold text-black">{{ amountParts(q.supplyAmount) }}</b>원</dd>
      </div>
      <div class="flex items-center justify-between">
        <dt class="text-[14px] leading-[14px] tracking-[-0.56px] text-[#39404d]">부가세 ({{ vatLabel }})</dt>
        <dd class="text-right text-[15px] leading-[14px] text-[#5f6777]"><b class="font-bold text-black">{{ amountParts(q.vatAmount) }}</b>원</dd>
      </div>
      <div class="flex items-center justify-between">
        <dt class="text-[16px] font-bold leading-[1.3] text-black">합계</dt>
        <dd class="text-right text-[16px] leading-[14px] text-[#2674ff]"><b class="font-bold">{{ amountParts(q.totalAmount) }}</b>원</dd>
      </div>
    </dl>

    <!-- 조건 목록 -->
    <ul class="flex list-disc flex-col gap-[8px] text-[14px] leading-[1.6] text-[#061023]">
      <li v-for="t in terms" :key="t.label" class="ms-[21px] whitespace-pre-wrap"><b class="font-semibold">{{ t.label }}  :  </b>{{ t.value }}</li>
    </ul>

    <!-- 결제 조건(시안에 없음 — 표 모양 맞춤) -->
    <div v-if="q.milestones.length > 0" class="flex flex-col gap-[8px]">
      <h4 class="text-[16px] font-bold leading-[1.3] text-black">결제 조건</h4>
      <div class="overflow-x-auto">
        <div class="flex min-w-[640px] flex-col gap-[4px] leading-[1.8]">
          <div class="flex items-center gap-[14px] bg-[#f5f6f8] px-[10px] text-[14px] font-medium text-[#666]">
            <span class="min-w-0 flex-1">명칭</span>
            <span class="w-[60px] shrink-0 text-right">비율</span>
            <span class="w-[130px] shrink-0 text-right">금액</span>
            <span class="w-[150px] shrink-0">시점</span>
            <span class="w-[150px] shrink-0 text-right">상태</span>
          </div>
          <div v-for="m in q.milestones" :key="m.milestoneId" class="flex items-start gap-[14px] px-[10px] py-[4px] text-[15px] text-[#141e34]">
            <span class="min-w-0 flex-1 font-semibold text-black">
              {{ m.title }}
              <span v-if="m.unlocksDeliverables" class="ml-[6px] rounded-[37px] bg-[#f5f6f8] px-[8px] py-[2px] text-[12px] font-semibold text-[#475569]">산출물 해제</span>
            </span>
            <span class="w-[60px] shrink-0 text-right tabular-nums">{{ m.ratioBp === null ? '—' : `${(m.ratioBp / 100).toFixed(0)}%` }}</span>
            <span class="w-[130px] shrink-0 text-right tabular-nums">{{ won(m.amount) }}</span>
            <span class="w-[150px] shrink-0 text-[14px]">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }}</span>
            <span class="flex w-[150px] shrink-0 flex-col items-end gap-[2px]">
              <button
                v-if="m.payable"
                type="button"
                class="flex h-[34px] items-center rounded-[6px] bg-[#212121] px-[10px] text-[14px] font-medium leading-[1.3] text-white transition-opacity hover:opacity-85 disabled:opacity-50"
                :disabled="payingMilestoneId !== null"
                @click="emit('pay', m.milestoneId)"
              >
                {{ payingMilestoneId === m.milestoneId ? '이동 중…' : `${won(m.amount)} 결제` }}
              </button>
              <template v-else>
                <span class="text-[14px] font-semibold" :class="m.status === 'paid' ? 'text-[#2945e8]' : 'text-[#999]'">{{ DEVELOP_MILESTONE_STATUS_LABELS[m.status] }}</span>
                <span v-if="awaitingDeposit(m)" class="rounded-[37px] bg-amber-100 px-[8px] py-[2px] text-[12px] font-semibold text-amber-800">입금 확인 중</span>
                <span v-if="m.paidAt !== null" class="text-[12px] tabular-nums text-[#999]">{{ dateShort(m.paidAt) }}</span>
                <span v-if="m.payment !== null" class="text-[12px] tabular-nums text-[#999]">주문 {{ m.payment.odId }}</span>
              </template>
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 처리 결과 -->
    <p v-if="q.acceptedAt !== null" class="rounded-[10px] bg-[#f5f6f8] px-[16px] py-[12px] text-[15px] leading-[1.8] text-[#141e34]">
      {{ dateShort(q.acceptedAt) }} 수락<template v-if="q.acceptedName !== null"> · {{ q.acceptedName }}</template>
    </p>
    <p v-else-if="q.declinedAt !== null" class="rounded-[10px] bg-[#f5f6f8] px-[16px] py-[12px] text-[15px] leading-[1.8] text-[#141e34]">
      {{ dateShort(q.declinedAt) }} 수정 요청함<template v-if="q.declineReason !== null && q.declineReason !== ''"> · {{ q.declineReason }}</template>
    </p>

    <!-- 표준 조건 -->
    <details class="rounded-[10px] border border-[#d9d9d9] px-[16px] py-[12px]">
      <summary class="cursor-pointer list-none text-[15px] font-semibold leading-[1.8] text-black">표준 조건 <span class="text-[14px] font-normal text-[#666]">눌러서 펼치기</span></summary>
      <p class="mt-[8px] whitespace-pre-wrap text-[14px] leading-[1.8] text-[#141e34]">{{ q.terms }}</p>
    </details>

    <!-- 유효기간 경과 -->
    <p v-if="q.status === 'expired'" class="rounded-[10px] bg-[#f5f6f8] px-[16px] py-[12px] text-[15px] leading-[1.8] text-[#141e34]">
      유효기간이 지났습니다 — 담당자에게 재견적을 요청해 주세요.
    </p>

    <!-- 수락·수정 요청(발송된 견적만) -->
    <div v-if="open" class="flex flex-col gap-[4px] rounded-[10px] border border-[#d7deec] bg-[#f1f6ff] px-[16px] py-[14px]">
      <div class="flex flex-wrap items-center justify-between gap-[12px]">
        <p class="flex items-center gap-[6px] text-[16px] font-bold leading-[1.3] text-black">
          <img :src="iconQuote" alt="" class="block size-[19px]">이 견적으로 진행할까요?
        </p>
        <label class="flex items-center gap-[12px]">
          <span class="text-[15px] font-semibold leading-[1.8] text-black">수락하시는 분 성함</span>
          <input
            v-model="name"
            type="text"
            maxlength="100"
            placeholder="성함"
            class="h-[34px] w-[170px] rounded-[6px] border border-[#d9d9d9] bg-white px-[10px] text-[14px] leading-[1.3] text-[#0a151e]"
          >
        </label>
      </div>
      <p class="text-[14px] leading-[1.8] text-[#666]">
        수락하시면 위 표준 조건에 동의한 것으로 보고 계약을 갈음합니다. 수락 시각과 성함이 기록되며, 곧바로 착수금 결제가 열립니다.
      </p>
      <div class="mt-[2px] flex flex-wrap items-center gap-[20px]">
        <label class="flex cursor-pointer items-center gap-[8px]">
          <input v-model="agree" type="checkbox" class="peer sr-only">
          <img :src="checkboxEmpty" alt="" class="block size-[24px] peer-checked:hidden">
          <span class="hidden size-[24px] items-center justify-center rounded-[3px] bg-[#212121] text-[14px] font-bold text-white peer-checked:flex" aria-hidden="true">✓</span>
          <span class="text-[15px] leading-[1.8] text-[#141e34]">위 조건에 동의합니다</span>
        </label>
        <div class="flex items-center gap-[10px]">
          <button
            type="button"
            class="flex h-[34px] min-w-[84px] items-center justify-center rounded-[6px] bg-[#212121] px-[10px] text-[14px] font-medium leading-[1.3] text-white transition-opacity hover:opacity-85 disabled:opacity-40"
            :disabled="!canAccept"
            @click="onAccept"
          >
            {{ acceptPending ? '처리 중…' : '견적 수락' }}
          </button>
          <button
            v-if="!declineOpen"
            type="button"
            class="flex h-[34px] items-center justify-center rounded-[6px] bg-white px-[20px] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:bg-[#e6ecf7]"
            @click="declineOpen = true"
          >
            견적 수정 요청
          </button>
        </div>
        <span class="text-[14px] leading-[1.8] text-[#666]">유효기간 {{ q.validUntil }}까지</span>
      </div>
      <p v-if="actionError !== ''" class="mt-[4px] text-[14px] font-semibold text-red-700">{{ actionError }}</p>

      <div v-if="declineOpen" class="mt-[10px] flex flex-col gap-[10px] rounded-[10px] border border-[#d9d9d9] bg-white p-[16px]">
        <p class="text-[15px] font-bold leading-[1.3] text-black">견적 수정을 요청할까요?</p>
        <p class="text-[14px] leading-[1.8] text-[#666]">이 견적은 닫히고 의뢰는 그대로 남습니다. 바꾸고 싶은 점을 적어 주시면 담당자가 조건을 다시 잡아 새 견적을 보내드립니다.</p>
        <input
          v-model="declineReason"
          type="text"
          maxlength="1000"
          placeholder="수정하고 싶은 내용 (선택)"
          class="h-[34px] rounded-[6px] border border-[#d9d9d9] bg-white px-[10px] text-[14px] text-[#0a151e]"
        >
        <div class="flex flex-wrap gap-[10px]">
          <button
            type="button"
            class="flex h-[34px] items-center rounded-[6px] bg-[#212121] px-[14px] text-[14px] font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-50"
            :disabled="declinePending"
            @click="onDecline"
          >
            {{ declinePending ? '처리 중…' : '수정 요청 보내기' }}
          </button>
          <button
            type="button"
            class="flex h-[34px] items-center rounded-[6px] border border-[#d9d9d9] bg-white px-[14px] text-[14px] text-[#0a151e] transition-colors hover:border-[#9aa3ad]"
            @click="declineOpen = false"
          >
            그만두기
          </button>
        </div>
      </div>
    </div>

    <!-- 결제 오류(수락 이후 카드에서도 보이게) -->
    <p v-else-if="actionError !== ''" class="rounded-[10px] bg-red-50 px-[16px] py-[12px] text-[14px] font-semibold text-red-700">{{ actionError }}</p>
  </article>
</template>
