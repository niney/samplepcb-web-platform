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

// 견적서 카드 — 조건 문서 한 장(docs/DEVELOP_FLOW.md §5): 항목표 + 금액 + 결제 조건(마일스톤) +
// 기간 + 산출물 + 별도 실비 + 표준 조건 + 유효기간. P2 에서 **수락·거절·마일스톤 결제**가 붙었다.
// 수락은 표준 조건 동의 + 이름이 계약을 갈음하므로(서버가 시각·IP·이름을 기록) 두 입력을 모두 요구한다.
// `payable` 은 서버 파생이라 화면이 다시 계산하지 않는다 — 그 행에만 결제 버튼을 세운다.
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
  draft: 'bg-line text-tx-3',
  sent: 'bg-brand-500 text-white',
  accepted: 'bg-emerald-600 text-white',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-line text-tx-3',
  superseded: 'bg-line text-tx-3',
  withdrawn: 'bg-line text-tx-3',
};

const printPath = computed(() => `/develop/requests/${String(props.requestId)}/quotes/${String(q.value.quoteId)}/print`);

// ── 수락·거절(sent 만) ───────────────────────────────────────────────────────
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
</script>

<template>
  <article class="grid gap-5 rounded-2xl border bg-white p-5 sm:p-6" :class="q.status === 'sent' ? 'border-2 border-brand-500' : 'border-line'">
    <!-- 헤더 -->
    <header class="flex flex-wrap items-start gap-2.5">
      <div class="grid gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full px-2.5 py-1 text-micro font-bold" :class="statusTone[q.status]">{{ statusLabel }}</span>
          <span class="rounded-full bg-paper px-2.5 py-1 text-micro font-bold text-tx-2">{{ kindLabel }}</span>
          <span class="font-mono text-micro tabular-nums text-tx-3">Q{{ requestId }}-v{{ q.version }}</span>
        </div>
        <h3 class="text-title font-extrabold text-tx-1">{{ q.title }}</h3>
      </div>
      <a
        :href="printPath"
        target="_blank"
        rel="noopener"
        class="ml-auto h-10 shrink-0 rounded-lg border border-line-2 bg-white px-4 text-label font-bold leading-10 text-tx-2 transition hover:border-tx-3"
      >
        인쇄용 보기
      </a>
    </header>

    <!-- 항목표 -->
    <div class="overflow-x-auto">
      <table class="w-full min-w-[420px] border-collapse text-body">
        <thead>
          <tr class="border-b border-line text-label text-tx-3">
            <th class="py-2 text-left font-semibold">항목</th>
            <th class="py-2 text-right font-semibold">금액</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in q.items" :key="item.itemId" class="border-b border-line align-top">
            <td class="py-3 pr-4">
              <p class="font-bold text-tx-1">{{ item.title }}</p>
              <p v-if="item.description !== null" class="mt-1 whitespace-pre-wrap text-label leading-relaxed text-tx-3">{{ item.description }}</p>
              <p v-if="item.durationDays !== null" class="mt-1 text-label text-tx-3">{{ item.durationDays }}일</p>
            </td>
            <td class="py-3 text-right font-mono tabular-nums text-tx-1">{{ won(item.amount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 금액 -->
    <dl class="grid gap-1.5 rounded-xl bg-paper px-4 py-3.5 text-body">
      <div class="flex justify-between">
        <dt class="text-tx-2">공급가</dt>
        <dd class="font-mono tabular-nums text-tx-1">{{ won(q.supplyAmount) }}</dd>
      </div>
      <div class="flex justify-between">
        <dt class="text-tx-2">부가세 <span class="text-label text-tx-3">({{ vatLabel }})</span></dt>
        <dd class="font-mono tabular-nums text-tx-1">{{ won(q.vatAmount) }}</dd>
      </div>
      <div class="mt-1 flex justify-between border-t border-line-2 pt-2.5">
        <dt class="text-title font-extrabold text-tx-1">합계</dt>
        <dd class="font-mono text-title font-extrabold tabular-nums text-tx-1">{{ won(q.totalAmount) }}</dd>
      </div>
    </dl>

    <!-- 결제 조건 -->
    <div v-if="q.milestones.length > 0" class="grid gap-2">
      <h4 class="text-label font-bold text-tx-3">결제 조건</h4>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] border-collapse text-body">
          <thead>
            <tr class="border-b border-line text-label text-tx-3">
              <th class="py-2 text-left font-semibold">명칭</th>
              <th class="py-2 text-right font-semibold">비율</th>
              <th class="py-2 text-right font-semibold">금액</th>
              <th class="py-2 pl-3 text-left font-semibold">시점</th>
              <th class="py-2 pl-3 text-right font-semibold">상태</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in q.milestones" :key="m.milestoneId" class="border-b border-line align-top">
              <td class="py-2.5 pr-3 font-bold text-tx-1">
                {{ m.title }}
                <span v-if="m.unlocksDeliverables" class="ml-1 rounded-full bg-paper px-2 py-0.5 text-micro font-bold text-tx-2">산출물 해제</span>
              </td>
              <td class="py-2.5 text-right font-mono tabular-nums text-tx-2">
                {{ m.ratioBp === null ? '—' : `${(m.ratioBp / 100).toFixed(0)}%` }}
              </td>
              <td class="py-2.5 text-right font-mono tabular-nums text-tx-1">{{ won(m.amount) }}</td>
              <td class="py-2.5 pl-3 text-label text-tx-2">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }}</td>
              <td class="py-2.5 pl-3 text-right">
                <button
                  v-if="m.payable"
                  type="button"
                  class="h-9 rounded-lg bg-brand-500 px-4 text-label font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
                  :disabled="payingMilestoneId !== null"
                  @click="emit('pay', m.milestoneId)"
                >
                  {{ payingMilestoneId === m.milestoneId ? '이동 중…' : `${won(m.amount)} 결제` }}
                </button>
                <div v-else class="grid justify-items-end gap-1">
                  <span class="text-label font-semibold" :class="m.status === 'paid' ? 'text-emerald-700' : 'text-tx-3'">
                    {{ DEVELOP_MILESTONE_STATUS_LABELS[m.status] }}
                  </span>
                  <span v-if="awaitingDeposit(m)" class="rounded-full bg-amber-100 px-2 py-0.5 text-micro font-bold text-amber-800">입금 확인 중</span>
                  <span v-if="m.paidAt !== null" class="font-mono text-micro tabular-nums text-tx-3">{{ dateShort(m.paidAt) }}</span>
                  <span v-if="m.payment !== null" class="font-mono text-micro tabular-nums text-tx-3">주문 {{ m.payment.odId }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 기간·산출물·실비 -->
    <dl class="grid gap-px overflow-hidden rounded-xl border border-line bg-line">
      <div v-if="q.durationDays !== null || q.scheduleNote !== null" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
        <dt class="text-label font-semibold text-tx-3">개발 기간</dt>
        <dd class="text-body text-tx-1">
          <template v-if="q.durationDays !== null">{{ q.durationDays }}일</template>
          <template v-if="q.scheduleNote !== null"><span v-if="q.durationDays !== null"> · </span>{{ q.scheduleNote }}</template>
        </dd>
      </div>
      <div v-if="q.deliverables.length > 0" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
        <dt class="text-label font-semibold text-tx-3">산출물</dt>
        <dd class="grid gap-1 text-body text-tx-1">
          <span v-for="d in q.deliverables" :key="d">· {{ d }}</span>
        </dd>
      </div>
      <div v-if="q.exclusions !== null" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
        <dt class="text-label font-semibold text-tx-3">별도 실비</dt>
        <dd class="whitespace-pre-wrap text-body leading-relaxed text-tx-1">{{ q.exclusions }}</dd>
      </div>
      <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
        <dt class="text-label font-semibold text-tx-3">검수 기간</dt>
        <dd class="text-body text-tx-1">
          납품 후 {{ q.reviewDays }}일
          <template v-if="q.warrantyDays !== null"> · 하자보수 {{ q.warrantyDays }}일</template>
        </dd>
      </div>
      <div class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
        <dt class="text-label font-semibold text-tx-3">유효기간</dt>
        <dd class="text-body text-tx-1">
          {{ q.validUntil }}까지<template v-if="q.sentAt !== null"> · 발행 {{ dateShort(q.sentAt) }}</template>
        </dd>
      </div>
      <div v-if="q.note !== null" class="grid gap-1 bg-white px-4 py-3 sm:grid-cols-[140px_1fr] sm:gap-4">
        <dt class="text-label font-semibold text-tx-3">비고</dt>
        <dd class="whitespace-pre-wrap text-body leading-relaxed text-tx-1">{{ q.note }}</dd>
      </div>
    </dl>

    <!-- 처리 결과 -->
    <p v-if="q.acceptedAt !== null" class="rounded-xl bg-emerald-50 px-4 py-3 text-body text-emerald-800">
      {{ dateShort(q.acceptedAt) }} 수락<template v-if="q.acceptedName !== null"> · {{ q.acceptedName }}</template>
    </p>
    <p v-else-if="q.declinedAt !== null" class="rounded-xl bg-red-50 px-4 py-3 text-body text-red-700">
      {{ dateShort(q.declinedAt) }} 거절<template v-if="q.declineReason !== null"> · {{ q.declineReason }}</template>
    </p>

    <!-- 표준 조건 -->
    <details class="rounded-xl border border-line bg-paper px-4 py-3">
      <summary class="cursor-pointer list-none text-label font-bold text-tx-2">표준 조건 <span class="font-normal text-tx-3">눌러서 펼치기</span></summary>
      <p class="mt-3 whitespace-pre-wrap text-label leading-relaxed text-tx-2">{{ q.terms }}</p>
    </details>

    <!-- 유효기간 경과 -->
    <p v-if="q.status === 'expired'" class="rounded-xl bg-paper px-4 py-3 text-body leading-relaxed text-tx-2">
      유효기간이 지났습니다 — 담당자에게 재견적을 요청해 주세요.
    </p>

    <!-- 수락·거절(발송된 견적만) -->
    <div v-if="open" class="grid gap-3 rounded-xl border-2 border-brand-500 bg-brand-50/50 p-4 sm:p-5">
      <p class="text-body font-extrabold text-tx-1">이 견적으로 진행할까요?</p>
      <p class="text-label leading-relaxed text-tx-2">
        수락하시면 위 표준 조건에 동의한 것으로 보고 계약을 갈음합니다. 수락 시각과 성함이 기록되며, 곧바로 착수금 결제가 열립니다.
      </p>
      <label class="flex cursor-pointer items-start gap-2.5 text-body text-tx-1">
        <input v-model="agree" type="checkbox" class="mt-1 h-4 w-4 shrink-0 accent-current">
        <span>위 조건에 동의합니다</span>
      </label>
      <label class="grid gap-1.5">
        <span class="text-label font-semibold text-tx-2">수락하시는 분 성함</span>
        <input
          v-model="name"
          type="text"
          maxlength="100"
          placeholder="성함"
          class="h-11 max-w-xs rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1"
        >
      </label>
      <p v-if="actionError !== ''" class="text-body font-semibold text-red-700">{{ actionError }}</p>
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white transition hover:bg-brand-600 disabled:opacity-50"
          :disabled="!canAccept"
          @click="onAccept"
        >
          {{ acceptPending ? '처리 중…' : '견적 수락' }}
        </button>
        <button
          v-if="!declineOpen"
          type="button"
          class="h-11 rounded-lg border border-line-2 bg-white px-5 text-body font-bold text-tx-3 transition hover:border-red-400 hover:text-red-600"
          @click="declineOpen = true"
        >
          거절
        </button>
        <span class="text-label text-tx-3">유효기간 {{ q.validUntil }}까지</span>
      </div>

      <div v-if="declineOpen" class="grid gap-2.5 rounded-lg border border-line-2 bg-white p-4">
        <p class="text-body font-bold text-tx-1">이 견적을 거절할까요?</p>
        <p class="text-label leading-relaxed text-tx-2">거절해도 의뢰는 남습니다. 사유를 남겨 주시면 담당자가 조건을 다시 잡아 드립니다.</p>
        <input
          v-model="declineReason"
          type="text"
          maxlength="1000"
          placeholder="거절 사유 (선택)"
          class="h-11 rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1"
        >
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="h-10 rounded-lg bg-red-600 px-5 text-label font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
            :disabled="declinePending"
            @click="onDecline"
          >
            {{ declinePending ? '처리 중…' : '견적 거절' }}
          </button>
          <button
            type="button"
            class="h-10 rounded-lg border border-line-2 bg-white px-5 text-label font-bold text-tx-2 transition hover:border-tx-3"
            @click="declineOpen = false"
          >
            그만두기
          </button>
        </div>
      </div>
    </div>

    <!-- 결제 오류(수락 이후 카드에서도 보이게) -->
    <p v-else-if="actionError !== ''" class="rounded-xl bg-red-50 px-4 py-3 text-body font-semibold text-red-700">{{ actionError }}</p>
  </article>
</template>
