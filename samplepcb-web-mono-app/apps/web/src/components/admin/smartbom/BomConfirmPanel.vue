<script setup lang="ts">
// 결제 후 부품 확인 요청(D43) — Case 상세 패널. 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39.
// 한 화면에서 요청 작성 → 고객 회신 확인(또는 대리 회신) → 적용 → 정산(추가결제 확인·감액·환불 기록)을 잇는다.
// 판정은 전부 서버다 — 버튼은 서버가 돌려준 상태로만 열리고, 거절 사유(409)는 그대로 보여준다.
import { computed, ref } from 'vue';
import {
  BOM_CONFIRM_ANSWER_CHANNEL_LABELS,
  BOM_CONFIRM_EVENT_ACTION_LABELS,
  BOM_CONFIRM_ISSUE_STATUS_LABELS,
  BOM_CONFIRM_ISSUE_TYPE_LABELS,
  BOM_CONFIRM_REQUEST_STATUS_LABELS,
  BOM_CONFIRM_SHIP_PREFERENCE_LABELS,
  BOM_ITEM_FULFILLMENT_LABELS,
  BOM_SETTLEMENT_KIND_LABELS,
  bomConfirmKindChangesItem,
  bomConfirmKindNeedsPayment,
  isBomConfirmNoticeType,
  type AdminBomConfirmIssueType,
  type AdminBomConfirmRequestType,
  type BomConfirmAnswerChannelType,
  type BomConfirmOptionCodeType,
  type BomConfirmOptionType,
  type BomConfirmShipPreferenceType,
  type BomSettlementType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { fmtKstDate } from '@sp/utils';
import BomConfirmComposePanel from './BomConfirmComposePanel.vue';
import UiPromptModal, { type PromptField } from '../../ui/UiPromptModal.vue';
import { confirmDialog } from '../../../lib/confirmDialog';
import { smartbomFmtWon } from '../../../admin/smartbom';
import {
  useAdminBomConfirmCase,
  useApplyBomConfirmIssue,
  useBomSettlementAction,
  useCancelBomConfirm,
  useFollowupBomConfirmIssue,
  useProxyAnswerBomConfirm,
  useResolveBomConfirm,
} from '../../../admin/useAdminBomConfirms';

const props = withDefaults(defineProps<{
  quoteId: string;
  usdKrwRate: number | null;
  /** 작성 패널 머리에 보일 Case 표시(번호·제목). */
  caseLabel?: string;
}>(), { caseLabel: '' });

const quoteIdRef = computed(() => props.quoteId);
const caseQuery = useAdminBomConfirmCase(quoteIdRef);
const data = computed(() => caseQuery.data.value?.data ?? null);
const requests = computed(() => data.value?.requests ?? []);
const openCount = computed(() => requests.value.filter((request) => request.status === 'requested' || request.status === 'answered').length);

const composeOpen = ref(false);
/** 작성 패널에 초안이 남아 있다(닫아도 유지) — 버튼이 '작성 이어가기'가 된다. */
const composeHasDraft = ref(false);
const notice = ref<{ tone: 'ok' | 'error'; text: string } | null>(null);
const expanded = ref<Record<string, boolean>>({});

const apply = useApplyBomConfirmIssue();
const cancel = useCancelBomConfirm();
const proxy = useProxyAnswerBomConfirm();
const followup = useFollowupBomConfirmIssue();
const resolve = useResolveBomConfirm();
const settlementAction = useBomSettlementAction();
const busy = computed(() =>
  apply.isPending.value || cancel.isPending.value || proxy.isPending.value
  || followup.isPending.value || resolve.isPending.value || settlementAction.isPending.value);

function fail(error: unknown, fallback: string): void {
  notice.value = {
    tone: 'error',
    text: error instanceof ApiRequestError ? (error.payload?.message ?? error.message) : fallback,
  };
  if (error instanceof ApiRequestError && error.status === 409) void caseQuery.refetch();
}

function onCreated(mailStatus: 'sent' | 'skipped' | 'failed'): void {
  composeOpen.value = false;
  notice.value = {
    tone: mailStatus === 'failed' ? 'error' : 'ok',
    text: mailStatus === 'sent'
      ? '확인 요청을 보냈습니다. 고객 메일도 나갔습니다.'
      : mailStatus === 'skipped'
        ? '확인 요청을 만들었습니다. 메일은 보내지 않았습니다(설정 또는 수신 주소 없음).'
        : '확인 요청을 만들었지만 메일 발송은 실패했습니다. 보낸 메일 목록에서 확인하세요.',
  };
}

const STATUS_TONE: Record<AdminBomConfirmRequestType['status'], string> = {
  requested: 'bg-sky-50 text-sky-800 border-sky-200',
  answered: 'bg-amber-50 text-amber-800 border-amber-200',
  resolved: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  canceled: 'bg-gray-100 text-gray-500 border-gray-200',
};

const ISSUE_TONE: Record<AdminBomConfirmIssueType['status'], string> = {
  pending: 'text-sky-700',
  decided: 'text-amber-700',
  applied: 'text-emerald-700',
  closed: 'text-gray-500',
  canceled: 'text-gray-400',
};

const deltaText = (value: number | null): string => {
  if (value === null) return '—';
  if (value === 0) return '금액 변동 없음';
  return value > 0 ? `+${smartbomFmtWon(value)} 추가결제` : `${smartbomFmtWon(-value)} 환불`;
};

function chosen(issue: AdminBomConfirmIssueType): BomConfirmOptionType | null {
  return issue.options.find((option) => option.code === issue.chosenCode) ?? null;
}

function optionDetail(option: BomConfirmOptionType): string {
  if (option.price !== null) {
    const p = option.price;
    return `개당 ${p.beforeUnitKrw === null ? '—' : smartbomFmtWon(p.beforeUnitKrw)} → ${smartbomFmtWon(p.afterUnitKrw)} · ${String(p.orderQty)}개 · 라인 ${smartbomFmtWon(p.lineTotalKrw)}`;
  }
  if (option.replacement !== null) {
    const r = option.replacement;
    return `${r.mpn} · ${r.supplierLabel}${r.supplier !== null && r.supplier !== r.supplierLabel ? ` (${r.supplier})` : ''} · ${String(r.orderQty)}개 · 라인 ${smartbomFmtWon(r.lineTotalKrw)}${r.engine === null ? ' · 엔진 비교 없음' : ` · 엔진 ${r.engine.selectionMode}/${r.engine.safety}`}`;
  }
  if (option.moq !== null) {
    return `${String(option.moq.orderQty)}개 구매(필요 ${String(option.moq.neededQty)} · 남는 ${String(option.moq.surplusQty)}) · 라인 ${smartbomFmtWon(option.moq.lineTotalKrw)}`;
  }
  if (option.restock !== null) {
    const r = option.restock;
    return `예상 ${r.expectedOn} · ${r.basis}${r.maxWaitOn === null ? '' : ` · 최대 ${r.maxWaitOn}`}${r.splitAllowed ? ` · 분할 허용(배송비 ${smartbomFmtWon(r.splitShippingFee)})` : ''}`;
  }
  return option.detail ?? '';
}

function chargePending(request: AdminBomConfirmRequestType): boolean {
  return request.settlement?.kind === 'charge' && request.settlement.status === 'pending';
}

function applyNeedsPayment(request: AdminBomConfirmRequestType, issue: AdminBomConfirmIssueType): boolean {
  const option = chosen(issue);
  return chargePending(request) && option !== null && bomConfirmKindNeedsPayment(option.kind);
}

async function applyIssue(request: AdminBomConfirmRequestType, issue: AdminBomConfirmIssueType): Promise<void> {
  const option = chosen(issue);
  if (option === null) return;
  const needsPayment = applyNeedsPayment(request, issue);
  if (issue.itemState.po !== null && bomConfirmKindChangesItem(option.kind)) {
    notice.value = {
      tone: 'error',
      text: `이 품목은 ${issue.itemState.po.partnerName} 발주서 #${issue.itemState.po.poId}(${issue.itemState.po.status})에 있습니다. 발행됨이면 발주서를 삭제한 뒤 적용하세요.`,
    };
    return;
  }
  const ok = await confirmDialog({
    title: `${option.code} ${option.title} 적용`,
    message: [
      `${issue.evidence.part.mpn} — ${option.title}`,
      optionDetail(option),
      option.kind === 'substitute' || option.kind === 'alt_supplier' || option.kind === 'moq_purchase'
        ? '견적 품목이 바뀝니다(그 행만 — 확정가·다른 행·견적 상태는 그대로). 발주 초안에 새 구매 조건이 들어갑니다.'
        : option.kind === 'customer_supply'
          ? '이 품목은 당사 조달에서 빠집니다(발주 초안 제외).'
          : option.kind === 'wait_restock'
            ? '이 품목을 입고 대기로 표시합니다. 발주는 입고 시점에 맞춰 진행하세요.'
            : option.kind === 'price_accept'
              ? '같은 부품을 오른 가격으로 삽니다. 품목은 바뀌지 않고 차액은 추가결제로 받습니다.'
              : option.kind === 'accept_as_is'
                ? '고객이 그대로 진행하기로 했습니다. 품목은 바뀌지 않습니다.'
                : '변경 없이 이 품목을 닫습니다. 필요하면 새 확인 요청을 보내세요.',
      needsPayment ? '\n⚠ 추가결제가 아직 확인되지 않았습니다 — 먼저 적용합니다(선적용).' : '',
    ].filter((line) => line !== '').join('\n'),
    confirmLabel: needsPayment ? '선적용' : '적용',
    tone: needsPayment ? 'danger' : 'default',
  });
  if (!ok) return;
  try {
    await apply.mutateAsync({
      quoteId: props.quoteId,
      requestId: request.id,
      issueId: issue.id,
      body: { expectedVersion: request.version, preApply: needsPayment },
    });
    notice.value = { tone: 'ok', text: `${issue.evidence.part.mpn}: ${option.title} 적용했습니다.` };
  } catch (error) {
    fail(error, '적용하지 못했습니다.');
  }
}

async function resolveRequest(request: AdminBomConfirmRequestType): Promise<void> {
  if (!(await confirmDialog({ message: '이 확인 요청을 처리 완료로 닫을까요?', confirmLabel: '처리 완료' }))) return;
  try {
    await resolve.mutateAsync({ quoteId: props.quoteId, requestId: request.id, expectedVersion: request.version });
  } catch (error) {
    fail(error, '처리 완료로 닫지 못했습니다.');
  }
}

// ── 입력 모달(취소 사유·환불 메모·두 번째 발송·정산 취소) ─────────────────────
type PromptAction =
  | { kind: 'cancel'; request: AdminBomConfirmRequestType }
  | { kind: 'refund'; settlement: BomSettlementType }
  | { kind: 'settlement-cancel'; settlement: BomSettlementType }
  | { kind: 'followup'; request: AdminBomConfirmRequestType; issue: AdminBomConfirmIssueType };

const prompt = ref<PromptAction | null>(null);
const promptTitle = computed(() => {
  const action = prompt.value;
  if (action === null) return null;
  if (action.kind === 'cancel') return '확인 요청 취소';
  if (action.kind === 'refund') return '환불 기록';
  if (action.kind === 'settlement-cancel') return '정산 취소';
  return '나머지 부품 두 번째 발송';
});
const promptFields = computed((): PromptField[] => {
  const action = prompt.value;
  if (action === null) return [];
  if (action.kind === 'cancel' || action.kind === 'settlement-cancel') {
    return [{ name: 'reason', label: '사유', type: 'textarea', required: true, maxlength: 500 }];
  }
  if (action.kind === 'refund') {
    return [{
      name: 'note',
      label: '메모(선택)',
      type: 'text',
      maxlength: 500,
      hint: '카드는 영카트 주문관리에서 부분취소한 뒤, 무통장은 계좌로 보낸 뒤 기록하세요. 여기서는 돈을 보내지 않습니다.',
    }];
  }
  return [
    { name: 'carrier', label: '택배사', type: 'text', required: true, maxlength: 40 },
    { name: 'invoice', label: '송장번호', type: 'text', required: true, maxlength: 60 },
    { name: 'shippedAt', label: '발송일', type: 'date' },
  ];
});
const promptDescription = computed(() => {
  const action = prompt.value;
  if (action?.kind === 'refund') {
    return `${smartbomFmtWon(action.settlement.amount)} 환불을 실제로 돌려준 사실을 영카트 주문(${action.settlement.odId ?? '—'})에 기록합니다.`;
  }
  if (action?.kind === 'followup') return `${action.issue.evidence.part.mpn} — 먼저 받기로 한 고객에게 나머지 부품을 보낸 송장을 기록합니다.`;
  return '';
});

async function onPromptConfirm(values: Record<string, string>): Promise<void> {
  const action = prompt.value;
  if (action === null) return;
  try {
    if (action.kind === 'cancel') {
      await cancel.mutateAsync({
        quoteId: props.quoteId,
        requestId: action.request.id,
        body: { expectedVersion: action.request.version, reason: values.reason ?? '' },
      });
    } else if (action.kind === 'refund') {
      await settlementAction.mutateAsync({
        quoteId: props.quoteId,
        settlementId: action.settlement.id,
        action: 'refund',
        ...(values.note === undefined || values.note === '' ? {} : { note: values.note }),
      });
    } else if (action.kind === 'settlement-cancel') {
      await settlementAction.mutateAsync({
        quoteId: props.quoteId,
        settlementId: action.settlement.id,
        action: 'cancel',
        reason: values.reason ?? '',
      });
    } else {
      await followup.mutateAsync({
        quoteId: props.quoteId,
        requestId: action.request.id,
        issueId: action.issue.id,
        body: {
          expectedVersion: action.request.version,
          carrier: values.carrier ?? '',
          invoice: values.invoice ?? '',
          ...(values.shippedAt === undefined || values.shippedAt === '' ? {} : { shippedAt: values.shippedAt }),
        },
      });
    }
    prompt.value = null;
  } catch (error) {
    prompt.value = null;
    fail(error, '처리하지 못했습니다.');
  }
}

async function reduceOrder(settlement: BomSettlementType): Promise<void> {
  const ok = await confirmDialog({
    title: '주문 금액 감액',
    message: `영카트 주문 ${settlement.odId ?? ''}의 부품 BOM 줄 금액을 ${smartbomFmtWon(settlement.amount)} 줄입니다.\n그 뒤 주문은 과입금(미수 음수) 상태가 되고, 카드는 영카트 주문관리에서 [부분취소], 무통장은 계좌로 돌려준 뒤 [환불 기록]을 누르세요.`,
    confirmLabel: '감액',
    tone: 'danger',
  });
  if (!ok) return;
  try {
    await settlementAction.mutateAsync({ quoteId: props.quoteId, settlementId: settlement.id, action: 'reduce' });
    notice.value = { tone: 'ok', text: '주문 금액을 줄였습니다. 환불을 보낸 뒤 [환불 기록]을 누르세요.' };
  } catch (error) {
    fail(error, '감액하지 못했습니다.');
  }
}

// ── 대리 회신 모달 ───────────────────────────────────────────────────────────
const proxyTarget = ref<AdminBomConfirmRequestType | null>(null);
const proxyChoices = ref<Record<string, string>>({});
const proxyShip = ref<Record<string, BomConfirmShipPreferenceType>>({});
const proxyChannel = ref<Exclude<BomConfirmAnswerChannelType, 'web'>>('phone');
const proxyNote = ref('');

function openProxy(request: AdminBomConfirmRequestType): void {
  proxyTarget.value = request;
  proxyChoices.value = {};
  proxyShip.value = {};
  proxyChannel.value = 'phone';
  proxyNote.value = '';
}

const proxyReady = computed(() => {
  const request = proxyTarget.value;
  if (request === null) return false;
  return request.issues
    .filter((issue) => issue.status === 'pending')
    .every((issue) => {
      const code = proxyChoices.value[issue.id];
      if (code === undefined) return false;
      const option = issue.options.find((entry) => entry.code === code);
      if (option?.kind === 'wait_restock' && option.restock?.splitAllowed === true) return proxyShip.value[issue.id] !== undefined;
      return true;
    });
});

async function submitProxy(): Promise<void> {
  const request = proxyTarget.value;
  if (request === null || !proxyReady.value) return;
  try {
    await proxy.mutateAsync({
      quoteId: props.quoteId,
      requestId: request.id,
      body: {
        expectedVersion: request.version,
        channel: proxyChannel.value,
        ...(proxyNote.value.trim() === '' ? {} : { note: proxyNote.value.trim() }),
        choices: request.issues
          .filter((issue) => issue.status === 'pending')
          .map((issue) => {
            const code = proxyChoices.value[issue.id] ?? 'A';
            const ship = proxyShip.value[issue.id];
            return {
              issueId: issue.id,
              code: code as BomConfirmOptionCodeType,
              ...(ship === undefined ? {} : { shipPreference: ship }),
            };
          }),
      },
    });
    proxyTarget.value = null;
    notice.value = { tone: 'ok', text: '대리 회신을 기록했습니다.' };
  } catch (error) {
    fail(error, '대리 회신을 기록하지 못했습니다.');
  }
}

function issueCanFollowup(issue: AdminBomConfirmIssueType): boolean {
  const option = chosen(issue);
  return issue.status === 'applied' && option?.kind === 'wait_restock' && issue.shipPreference === 'split' && issue.followup === null;
}
</script>

<template>
  <section class="rounded-xl border border-gray-200 bg-surface p-4" aria-labelledby="bom-confirm-panel-title">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="bom-confirm-panel-title" class="text-sm font-bold text-gray-900">
          부품 확인 요청
          <span v-if="openCount > 0" class="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">진행 {{ openCount }}</span>
        </h2>
        <p class="mt-0.5 text-xs text-gray-500">결제 뒤 부품·금액·수량·도착일이 바뀌면 선택지를 묻고(가격 인하·단종은 안내만), 답에 따라 적용·정산합니다.</p>
      </div>
      <button
        type="button"
        class="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="data === null || !data.eligibility.canCreate"
        :title="data?.eligibility.canCreate === false ? '결제 확인 뒤·배송 전 주문에만 보낼 수 있습니다' : ''"
        @click="composeOpen = true"
      >
        {{ composeHasDraft ? '작성 이어가기' : '확인 요청 보내기' }}
      </button>
    </div>

    <p v-if="notice !== null" class="mt-3 rounded-lg px-3 py-2 text-xs font-semibold" :class="notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'" role="status">
      {{ notice.text }}
    </p>
    <p v-if="caseQuery.isLoading.value" class="mt-3 text-xs text-gray-500">불러오는 중…</p>
    <p v-else-if="caseQuery.isError.value" class="mt-3 text-xs text-rose-600">부품 확인 요청을 불러오지 못했습니다.</p>
    <p v-else-if="requests.length === 0" class="mt-3 text-xs text-gray-400">보낸 확인 요청이 없습니다.</p>

    <ol class="mt-3 grid gap-3">
      <li v-for="request in requests" :id="`bomc-admin-${request.id}`" :key="request.id" class="rounded-lg border border-gray-200 p-3">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="rounded border px-2 py-0.5 font-bold" :class="STATUS_TONE[request.status]">{{ BOM_CONFIRM_REQUEST_STATUS_LABELS[request.status] }}</span>
          <span v-if="request.notice" class="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 font-bold text-sky-800">알림</span>
          <span class="font-semibold text-gray-700">#{{ request.id }}</span>
          <span class="text-gray-500">요청 {{ fmtKstDate(request.requestedAt) }} · {{ request.requestedBy }}</span>
          <span v-if="request.dueOn !== null" :class="request.overdue ? 'font-bold text-rose-600' : 'text-gray-500'">
            기한 {{ request.dueOn }}{{ request.overdue ? ' · 지남' : '' }}
          </span>
          <span v-if="request.answeredAt !== null" class="text-gray-500">
            회신 {{ fmtKstDate(request.answeredAt) }}{{ request.answeredRole === 'admin' ? ` · 대리(${request.answerChannel === null ? '' : BOM_CONFIRM_ANSWER_CHANNEL_LABELS[request.answerChannel]})` : ' · 고객' }}
          </span>
          <span v-if="request.netDelta !== null" class="font-semibold text-gray-800">순액 {{ deltaText(request.netDelta) }}</span>
          <span class="ml-auto flex flex-wrap gap-1">
            <button v-if="request.status === 'requested'" type="button" class="rounded border border-violet-200 px-2 py-1 font-semibold text-violet-700 hover:bg-violet-50" :disabled="busy" @click="openProxy(request)">대리 회신</button>
            <button v-if="request.status === 'answered'" type="button" class="rounded border border-emerald-200 px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50" :disabled="busy" @click="resolveRequest(request)">처리 완료</button>
            <button v-if="request.status === 'requested' || request.status === 'answered'" type="button" class="rounded border border-rose-200 px-2 py-1 font-semibold text-rose-600 hover:bg-rose-50" :disabled="busy" @click="prompt = { kind: 'cancel', request }">요청 취소</button>
          </span>
        </div>
        <p v-if="request.message !== null" class="mt-2 whitespace-pre-line text-xs text-gray-600">{{ request.message }}</p>
        <p v-if="request.customerNote !== null" class="mt-2 rounded bg-gray-50 px-2 py-1 text-xs text-gray-700">고객 의견: {{ request.customerNote }}</p>
        <p v-if="request.cancelReason !== null" class="mt-2 text-xs text-gray-500">취소 사유: {{ request.cancelReason }}</p>

        <!-- 정산 -->
        <div v-if="request.settlement !== null" class="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
          <span class="font-bold text-gray-800">{{ BOM_SETTLEMENT_KIND_LABELS[request.settlement.kind] }} {{ smartbomFmtWon(request.settlement.amount) }}</span>
          <span class="rounded bg-white px-1.5 py-0.5 font-semibold text-gray-700">{{ request.settlement.statusLabel }}</span>
          <span v-if="request.settlement.paidOdId !== null" class="text-gray-500">추가결제 주문 {{ request.settlement.paidOdId }}</span>
          <span v-if="request.settlement.kind === 'refund' && request.settlement.odId !== null" class="text-gray-500">원 주문 {{ request.settlement.odId }}</span>
          <span class="ml-auto flex flex-wrap gap-1">
            <template v-if="request.settlement.kind === 'refund'">
              <button v-if="request.settlement.status === 'pending'" type="button" class="rounded border border-amber-300 px-2 py-1 font-semibold text-amber-800 hover:bg-amber-50" :disabled="busy" @click="reduceOrder(request.settlement)">주문 금액 감액</button>
              <a v-if="request.settlement.status === 'reduced' && request.settlement.odId !== null" :href="`/adm/shop_admin/orderform.php?od_id=${request.settlement.odId}`" target="_blank" rel="noopener" class="rounded border border-gray-300 px-2 py-1 font-semibold text-gray-700 hover:bg-white">영카트 주문(부분취소)</a>
              <button v-if="request.settlement.status === 'reduced'" type="button" class="rounded border border-emerald-300 px-2 py-1 font-semibold text-emerald-700 hover:bg-emerald-50" :disabled="busy" @click="prompt = { kind: 'refund', settlement: request.settlement }">환불 기록</button>
            </template>
            <span v-if="request.settlement.kind === 'charge' && request.settlement.status === 'pending'" class="text-gray-500">고객 결제 대기(마이페이지에서 추가결제)</span>
            <button v-if="request.settlement.status === 'pending'" type="button" class="rounded border border-rose-200 px-2 py-1 font-semibold text-rose-600 hover:bg-rose-50" :disabled="busy" @click="prompt = { kind: 'settlement-cancel', settlement: request.settlement }">정산 취소</button>
          </span>
        </div>

        <!-- 품목 -->
        <div class="mt-2 grid gap-2">
          <article v-for="issue in request.issues" :key="issue.id" class="rounded-lg border border-gray-100 p-2 text-xs">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-bold text-gray-900">{{ issue.evidence.part.mpn }}</span>
              <span class="rounded px-1.5 py-0.5 font-semibold" :class="isBomConfirmNoticeType(issue.issueType) ? 'bg-sky-50 text-sky-800' : 'bg-rose-50 text-rose-700'">{{ BOM_CONFIRM_ISSUE_TYPE_LABELS[issue.issueType] }}</span>
              <span class="font-semibold" :class="ISSUE_TONE[issue.status]">{{ BOM_CONFIRM_ISSUE_STATUS_LABELS[issue.status] }}</span>
              <span v-if="issue.itemState.fulfillment !== 'normal'" class="rounded bg-gray-100 px-1.5 py-0.5 text-gray-600">{{ BOM_ITEM_FULFILLMENT_LABELS[issue.itemState.fulfillment] }}</span>
              <span v-if="issue.itemState.po !== null" class="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">{{ issue.itemState.po.partnerName }} #{{ issue.itemState.po.poId }} ({{ issue.itemState.po.status }})</span>
              <span v-if="issue.itemState.mpn !== null && issue.itemState.mpn !== issue.evidence.part.mpn" class="text-gray-500">현재 품목 {{ issue.itemState.mpn }}</span>
              <span class="ml-auto flex gap-1">
                <button
                  v-if="issue.status === 'decided'"
                  type="button"
                  class="rounded px-2 py-1 font-bold text-white disabled:opacity-50"
                  :class="applyNeedsPayment(request, issue) ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'"
                  :disabled="busy || request.status !== 'answered'"
                  @click="applyIssue(request, issue)"
                >
                  {{ applyNeedsPayment(request, issue) ? '선적용' : '적용' }}
                </button>
                <button v-if="issueCanFollowup(issue)" type="button" class="rounded border border-sky-200 px-2 py-1 font-semibold text-sky-700 hover:bg-sky-50" :disabled="busy" @click="prompt = { kind: 'followup', request, issue }">두 번째 발송 기록</button>
              </span>
            </div>
            <p class="mt-1 text-gray-600">{{ issue.description }}</p>
            <p class="mt-1 text-[11px] text-gray-500">
              근거({{ fmtKstDate(issue.evidence.observation.checkedAt) }}): {{ issue.evidence.observation.sourceLabel ?? '공급처 미표시' }}
              · 재고 {{ issue.evidence.observation.stock ?? '—' }} · MOQ {{ issue.evidence.observation.moq ?? '—' }}
              <template v-if="issue.evidence.observation.unitPriceKrw !== null"> · 지금 단가 {{ smartbomFmtWon(issue.evidence.observation.unitPriceKrw) }}</template>
              <template v-if="issue.evidence.observation.leadTime !== null"> · {{ issue.evidence.observation.leadTime }}</template>
              <template v-if="issue.evidence.observation.note !== null"> · {{ issue.evidence.observation.note }}</template>
            </p>
            <ul class="mt-1 grid gap-1">
              <li
                v-for="option in issue.options"
                :key="option.code"
                class="flex flex-wrap items-baseline gap-2 rounded px-2 py-1"
                :class="option.code === issue.chosenCode ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'bg-gray-50'"
              >
                <span class="font-bold text-gray-900">{{ option.code }}</span>
                <span class="font-semibold text-gray-800">{{ option.title }}</span>
                <span class="text-gray-600">{{ deltaText(option.priceDelta) }}</span>
                <span v-if="option.referenceDelta !== null && option.referenceDelta !== option.priceDelta" class="text-gray-400">(참고 {{ deltaText(option.referenceDelta) }})</span>
                <span class="min-w-0 break-words text-gray-500">{{ optionDetail(option) }}</span>
                <span v-if="option.code === issue.chosenCode" class="font-bold text-emerald-700">
                  고객 선택{{ issue.shipPreference === null ? '' : ` · ${BOM_CONFIRM_SHIP_PREFERENCE_LABELS[issue.shipPreference]}` }}
                </span>
              </li>
            </ul>
            <p v-if="issue.followup !== null" class="mt-1 text-sky-700">두 번째 발송 {{ issue.followup.shippedAt }} · {{ issue.followup.carrier }} {{ issue.followup.invoice }}</p>
            <p v-if="issue.appliedAt !== null" class="mt-1 text-gray-500">적용 {{ fmtKstDate(issue.appliedAt) }} · {{ issue.appliedBy }}{{ issue.applyNote === null ? '' : ` — ${issue.applyNote}` }}</p>
          </article>
        </div>

        <button type="button" class="mt-2 text-[11px] font-semibold text-gray-500 underline" @click="expanded[request.id] = !expanded[request.id]">
          {{ expanded[request.id] === true ? '이력 접기' : `이력 ${request.events.length}건 보기` }}
        </button>
        <ol v-if="expanded[request.id] === true" class="mt-1 grid gap-0.5 text-[11px] text-gray-500">
          <li v-for="event in request.events" :key="event.id">
            {{ fmtKstDate(event.createdAt) }} · {{ BOM_CONFIRM_EVENT_ACTION_LABELS[event.action] }} · {{ event.actorRole === 'system' ? '시스템' : event.actorMbId }}{{ event.note === null ? '' : ` — ${event.note}` }}
          </li>
        </ol>
      </li>
    </ol>

    <BomConfirmComposePanel
      :open="composeOpen"
      :quote-id="quoteId"
      :case-label="caseLabel"
      :items="data?.items ?? []"
      :eligibility-reason="data?.eligibility.reason ?? null"
      :usd-krw-rate="usdKrwRate"
      @close="composeOpen = false"
      @created="onCreated"
      @draft="composeHasDraft = $event"
    />

    <UiPromptModal
      :title="promptTitle"
      :fields="promptFields"
      :description="promptDescription"
      :busy="busy"
      :tone="prompt?.kind === 'cancel' || prompt?.kind === 'settlement-cancel' ? 'danger' : 'default'"
      @close="prompt = null"
      @confirm="onPromptConfirm"
    />

    <Teleport to="body">
      <div v-if="proxyTarget !== null" class="fixed inset-0 z-[55] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="bomc-proxy-title">
        <div class="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-5 shadow-xl">
          <h3 id="bomc-proxy-title" class="text-base font-bold text-gray-900">대리 회신 — 확인 요청 #{{ proxyTarget.id }}</h3>
          <p class="mt-1 text-xs text-gray-500">전화·메일로 받은 고객의 답을 기록합니다. 고객이 직접 고른 것과 같게 처리되고, 회신 주체는 관리자로 남습니다.</p>
          <div class="mt-3 grid gap-3">
            <fieldset v-for="issue in proxyTarget.issues.filter((entry) => entry.status === 'pending')" :key="issue.id" class="rounded-lg border border-gray-200 p-3">
              <legend class="px-1 text-sm font-bold text-gray-900">{{ issue.evidence.part.mpn }} · {{ BOM_CONFIRM_ISSUE_TYPE_LABELS[issue.issueType] }}</legend>
              <label v-for="option in issue.options" :key="option.code" class="flex items-start gap-2 py-1 text-xs">
                <input v-model="proxyChoices[issue.id]" type="radio" :name="`proxy-${issue.id}`" :value="option.code" class="mt-0.5 h-4 w-4">
                <span><b>{{ option.code }} {{ option.title }}</b> · {{ deltaText(option.priceDelta) }}</span>
              </label>
              <template v-if="issue.options.find((option) => option.code === proxyChoices[issue.id])?.restock?.splitAllowed === true">
                <p class="mt-1 text-xs font-semibold text-gray-700">받는 방법</p>
                <label v-for="pref in (['together', 'split'] as const)" :key="pref" class="flex items-center gap-2 py-0.5 text-xs">
                  <input v-model="proxyShip[issue.id]" type="radio" :name="`proxy-ship-${issue.id}`" :value="pref" class="h-4 w-4">
                  {{ BOM_CONFIRM_SHIP_PREFERENCE_LABELS[pref] }}
                </label>
              </template>
            </fieldset>
            <label class="grid gap-1 text-xs font-semibold text-gray-600">받은 경로
              <select v-model="proxyChannel" class="rounded border border-gray-300 px-2 py-1 text-sm">
                <option v-for="channel in (['phone', 'email', 'other'] as const)" :key="channel" :value="channel">{{ BOM_CONFIRM_ANSWER_CHANNEL_LABELS[channel] }}</option>
              </select>
            </label>
            <label class="grid gap-1 text-xs font-semibold text-gray-600">메모(선택)
              <textarea v-model="proxyNote" rows="2" maxlength="2000" class="rounded border border-gray-300 px-2 py-1 text-sm" />
            </label>
          </div>
          <div class="mt-4 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50" @click="proxyTarget = null">취소</button>
            <button type="button" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50" :disabled="!proxyReady || busy" @click="submitProxy">대리 회신 기록</button>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>
