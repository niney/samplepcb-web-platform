<script setup lang="ts">
// 결제 후 부품 확인 요청(D43) — Case 상세 섹션. 옛 BomConfirmPanel 의 짝(같은 props). 정본 docs/SMARTBOM_PARTNER_RFQ.md §6.39·§6.40.
// 한 화면에서 요청 작성 → 고객 회신 확인(또는 대리 회신) → 적용 → 정산(추가결제 확인·감액·환불 기록)을 잇는다.
// 판정은 전부 서버다 — 버튼은 서버가 돌려준 상태로만 열리고, 거절 사유(409)는 그대로 보여준다.
import { computed, ref } from 'vue';
import { ExternalLinkIcon } from '@lucide/vue';
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
import { smartbomFmtWon } from '@/admin/smartbom';
import {
  useAdminBomConfirmCase,
  useApplyBomConfirmIssue,
  useBomSettlementAction,
  useCancelBomConfirm,
  useFollowupBomConfirmIssue,
  useProxyAnswerBomConfirm,
  useResolveBomConfirm,
} from '@/admin/useAdminBomConfirms';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Label } from '@/next/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/next/components/ui/native-select';
import { RadioGroup, RadioGroupItem } from '@/next/components/ui/radio-group';
import { Textarea } from '@/next/components/ui/textarea';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { confirmDialog, promptDialog, type PromptField } from '@/next/lib/dialog';
import ConfirmComposePanel from './ConfirmComposePanel.vue';
import { confirmIssueStatusClass } from './confirm/confirm-tones';
import { bomConfirmStatusVariant } from './smartbom-badges';

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

// ── 입력 대화상자(취소 사유·환불 메모·두 번째 발송·정산 취소) — 저장은 대화상자가 연 채로 한다(submit):
// 실패하면 적어 둔 사유·송장이 남은 채 서버 문구가 보이고, 409 면 최신 상태를 다시 불러온다.
const refetchOn409 = (error: unknown): void => {
  if (error instanceof ApiRequestError && error.status === 409) void caseQuery.refetch();
};

async function promptCancel(request: AdminBomConfirmRequestType): Promise<void> {
  const fields: PromptField[] = [{ name: 'reason', label: '사유', type: 'textarea', required: true, maxlength: 500 }];
  await promptDialog({
    title: '확인 요청 취소',
    fields,
    tone: 'danger',
    errorFallback: '처리하지 못했습니다.',
    submit: async (values) => {
      try {
        await cancel.mutateAsync({
          quoteId: props.quoteId,
          requestId: request.id,
          body: { expectedVersion: request.version, reason: values.reason ?? '' },
        });
      } catch (error) {
        refetchOn409(error);
        throw error;
      }
    },
  });
}

async function promptRefund(settlement: BomSettlementType): Promise<void> {
  await promptDialog({
    title: '환불 기록',
    description: `${smartbomFmtWon(settlement.amount)} 환불을 실제로 돌려준 사실을 영카트 주문(${settlement.odId ?? '—'})에 기록합니다.`,
    fields: [{
      name: 'note',
      label: '메모(선택)',
      type: 'text',
      maxlength: 500,
      hint: '카드는 영카트 주문관리에서 부분취소한 뒤, 무통장은 계좌로 보낸 뒤 기록하세요. 여기서는 돈을 보내지 않습니다.',
    }],
    errorFallback: '처리하지 못했습니다.',
    submit: async (values) => {
      try {
        await settlementAction.mutateAsync({
          quoteId: props.quoteId,
          settlementId: settlement.id,
          action: 'refund',
          ...(values.note === undefined || values.note === '' ? {} : { note: values.note }),
        });
      } catch (error) {
        refetchOn409(error);
        throw error;
      }
    },
  });
}

async function promptSettlementCancel(settlement: BomSettlementType): Promise<void> {
  await promptDialog({
    title: '정산 취소',
    fields: [{ name: 'reason', label: '사유', type: 'textarea', required: true, maxlength: 500 }],
    tone: 'danger',
    errorFallback: '처리하지 못했습니다.',
    submit: async (values) => {
      try {
        await settlementAction.mutateAsync({
          quoteId: props.quoteId,
          settlementId: settlement.id,
          action: 'cancel',
          reason: values.reason ?? '',
        });
      } catch (error) {
        refetchOn409(error);
        throw error;
      }
    },
  });
}

async function promptFollowup(request: AdminBomConfirmRequestType, issue: AdminBomConfirmIssueType): Promise<void> {
  await promptDialog({
    title: '나머지 부품 두 번째 발송',
    description: `${issue.evidence.part.mpn} — 먼저 받기로 한 고객에게 나머지 부품을 보낸 송장을 기록합니다.`,
    fields: [
      { name: 'carrier', label: '택배사', type: 'text', required: true, maxlength: 40 },
      { name: 'invoice', label: '송장번호', type: 'text', required: true, maxlength: 60 },
      { name: 'shippedAt', label: '발송일', type: 'date' },
    ],
    errorFallback: '처리하지 못했습니다.',
    submit: async (values) => {
      try {
        await followup.mutateAsync({
          quoteId: props.quoteId,
          requestId: request.id,
          issueId: issue.id,
          body: {
            expectedVersion: request.version,
            carrier: values.carrier ?? '',
            invoice: values.invoice ?? '',
            ...(values.shippedAt === undefined || values.shippedAt === '' ? {} : { shippedAt: values.shippedAt }),
          },
        });
      } catch (error) {
        refetchOn409(error);
        throw error;
      }
    },
  });
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

// ── 대리 회신 대화상자 ─────────────────────────────────────────────────────────
const proxyTarget = ref<AdminBomConfirmRequestType | null>(null);
const proxyChoices = ref<Record<string, string>>({});
const proxyShip = ref<Record<string, BomConfirmShipPreferenceType>>({});
const proxyChannel = ref<Exclude<BomConfirmAnswerChannelType, 'web'>>('phone');
const proxyNote = ref('');
const PROXY_CHANNELS = ['phone', 'email', 'other'] as const;
const SHIP_PREFERENCES = ['together', 'split'] as const;

function openProxy(request: AdminBomConfirmRequestType): void {
  proxyTarget.value = request;
  proxyChoices.value = {};
  proxyShip.value = {};
  proxyChannel.value = 'phone';
  proxyNote.value = '';
}

const pendingIssues = computed(() => proxyTarget.value?.issues.filter((issue) => issue.status === 'pending') ?? []);

function pickChoice(issueId: string, value: unknown): void {
  if (typeof value === 'string') proxyChoices.value[issueId] = value;
}
function pickShip(issueId: string, value: unknown): void {
  const pref = SHIP_PREFERENCES.find((entry) => entry === value);
  if (pref !== undefined) proxyShip.value[issueId] = pref;
}
function pickChannel(event: Event): void {
  const value = event.target instanceof HTMLSelectElement ? event.target.value : '';
  const channel = PROXY_CHANNELS.find((entry) => entry === value);
  if (channel !== undefined) proxyChannel.value = channel;
}
const splitChoosable = (issue: AdminBomConfirmIssueType): boolean =>
  issue.options.find((option) => option.code === proxyChoices.value[issue.id])?.restock?.splitAllowed === true;

const proxyReady = computed(() => {
  if (proxyTarget.value === null) return false;
  return pendingIssues.value.every((issue) => {
    const code = proxyChoices.value[issue.id];
    if (code === undefined) return false;
    const option = issue.options.find((entry) => entry.code === code);
    if (option?.kind === 'wait_restock' && option.restock?.splitAllowed === true) return proxyShip.value[issue.id] !== undefined;
    return true;
  });
});

const onProxyOpenChange = (open: boolean): void => {
  if (!open && !proxy.isPending.value) proxyTarget.value = null;
};

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
  <SectionCard aria-labelledby="bom-confirm-panel-title">
    <template #title><span id="bom-confirm-panel-title">부품 확인 요청</span></template>
    <template #meta>
      <Badge v-if="openCount > 0" variant="warning">진행 {{ openCount }}</Badge>
    </template>
    <template #actions>
      <Button
        size="sm"
        :disabled="data === null || !data.eligibility.canCreate"
        :title="data?.eligibility.canCreate === false ? '결제 확인 뒤·배송 전 주문에만 보낼 수 있습니다' : ''"
        @click="composeOpen = true"
      >
        {{ composeHasDraft ? '작성 이어가기' : '확인 요청 보내기' }}
      </Button>
    </template>
    <template #notice>
      <NoticeBand class="text-xs">
        결제 뒤 부품·금액·수량·도착일이 바뀌면 선택지를 묻고(가격 인하·단종은 안내만), 답에 따라 적용·정산합니다.
      </NoticeBand>
    </template>

    <Alert v-if="notice !== null" :variant="notice.tone === 'ok' ? 'success' : 'destructive'" size="sm" role="status">
      <AlertDescription>{{ notice.text }}</AlertDescription>
    </Alert>
    <p v-if="caseQuery.isLoading.value" class="text-muted-foreground text-xs">불러오는 중…</p>
    <p v-else-if="caseQuery.isError.value" class="text-destructive text-xs">부품 확인 요청을 불러오지 못했습니다.</p>
    <p v-else-if="requests.length === 0" class="text-muted-foreground text-xs">보낸 확인 요청이 없습니다.</p>

    <ol v-if="requests.length > 0" class="grid gap-3">
      <li v-for="request in requests" :id="`bomc-admin-${request.id}`" :key="request.id" class="scroll-mt-20">
        <Panel>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <Badge :variant="bomConfirmStatusVariant(request.status)">{{ BOM_CONFIRM_REQUEST_STATUS_LABELS[request.status] }}</Badge>
            <Badge v-if="request.notice" variant="info">알림</Badge>
            <span class="font-semibold">#{{ request.id }}</span>
            <span class="text-muted-foreground">요청 {{ fmtKstDate(request.requestedAt) }} · {{ request.requestedBy }}</span>
            <span v-if="request.dueOn !== null" :class="request.overdue ? 'text-destructive font-semibold' : 'text-muted-foreground'">
              기한 {{ request.dueOn }}{{ request.overdue ? ' · 지남' : '' }}
            </span>
            <span v-if="request.answeredAt !== null" class="text-muted-foreground">
              회신 {{ fmtKstDate(request.answeredAt) }}{{ request.answeredRole === 'admin' ? ` · 대리(${request.answerChannel === null ? '' : BOM_CONFIRM_ANSWER_CHANNEL_LABELS[request.answerChannel]})` : ' · 고객' }}
            </span>
            <span v-if="request.netDelta !== null" class="font-semibold">순액 {{ deltaText(request.netDelta) }}</span>
            <span class="ml-auto flex flex-wrap gap-1">
              <Button v-if="request.status === 'requested'" variant="outline" size="sm" :disabled="busy" @click="openProxy(request)">대리 회신</Button>
              <Button v-if="request.status === 'answered'" variant="outline" size="sm" :disabled="busy" @click="void resolveRequest(request)">처리 완료</Button>
              <Button
                v-if="request.status === 'requested' || request.status === 'answered'"
                variant="ghost"
                size="sm"
                :disabled="busy"
                @click="void promptCancel(request)"
              >
                요청 취소
              </Button>
            </span>
          </div>
          <p v-if="request.message !== null" class="text-muted-foreground mt-2 text-xs whitespace-pre-line">{{ request.message }}</p>
          <Panel v-if="request.customerNote !== null" size="xs" tone="muted" class="mt-2 text-xs">고객 의견: {{ request.customerNote }}</Panel>
          <p v-if="request.cancelReason !== null" class="text-muted-foreground mt-2 text-xs">취소 사유: {{ request.cancelReason }}</p>

          <!-- 정산 -->
          <Panel v-if="request.settlement !== null" tone="muted" class="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span class="font-semibold">{{ BOM_SETTLEMENT_KIND_LABELS[request.settlement.kind] }} {{ smartbomFmtWon(request.settlement.amount) }}</span>
            <Badge variant="outline">{{ request.settlement.statusLabel }}</Badge>
            <span v-if="request.settlement.paidOdId !== null" class="text-muted-foreground">추가결제 주문 {{ request.settlement.paidOdId }}</span>
            <span v-if="request.settlement.kind === 'refund' && request.settlement.odId !== null" class="text-muted-foreground">원 주문 {{ request.settlement.odId }}</span>
            <span class="ml-auto flex flex-wrap gap-1">
              <template v-if="request.settlement.kind === 'refund'">
                <Button v-if="request.settlement.status === 'pending'" variant="outline" size="sm" :disabled="busy" @click="void reduceOrder(request.settlement)">주문 금액 감액</Button>
                <Button v-if="request.settlement.status === 'reduced' && request.settlement.odId !== null" variant="outline" size="sm" as-child>
                  <a :href="`/adm/shop_admin/orderform.php?od_id=${request.settlement.odId}`" target="_blank" rel="noopener">
                    영카트 주문(부분취소)
                    <ExternalLinkIcon />
                  </a>
                </Button>
                <Button v-if="request.settlement.status === 'reduced'" variant="outline" size="sm" :disabled="busy" @click="void promptRefund(request.settlement)">환불 기록</Button>
              </template>
              <span v-if="request.settlement.kind === 'charge' && request.settlement.status === 'pending'" class="text-muted-foreground">고객 결제 대기(마이페이지에서 추가결제)</span>
              <Button v-if="request.settlement.status === 'pending'" variant="ghost" size="sm" :disabled="busy" @click="void promptSettlementCancel(request.settlement)">정산 취소</Button>
            </span>
          </Panel>

          <!-- 품목 -->
          <div class="mt-2 grid gap-2">
            <Panel v-for="issue in request.issues" :key="issue.id" class="text-xs">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-semibold">{{ issue.evidence.part.mpn }}</span>
                <Badge :variant="isBomConfirmNoticeType(issue.issueType) ? 'info' : 'danger'">{{ BOM_CONFIRM_ISSUE_TYPE_LABELS[issue.issueType] }}</Badge>
                <span class="font-semibold" :class="confirmIssueStatusClass(issue.status)">{{ BOM_CONFIRM_ISSUE_STATUS_LABELS[issue.status] }}</span>
                <Badge v-if="issue.itemState.fulfillment !== 'normal'" variant="secondary">{{ BOM_ITEM_FULFILLMENT_LABELS[issue.itemState.fulfillment] }}</Badge>
                <Badge v-if="issue.itemState.po !== null" variant="warning">{{ issue.itemState.po.partnerName }} #{{ issue.itemState.po.poId }} ({{ issue.itemState.po.status }})</Badge>
                <span v-if="issue.itemState.mpn !== null && issue.itemState.mpn !== issue.evidence.part.mpn" class="text-muted-foreground">현재 품목 {{ issue.itemState.mpn }}</span>
                <span class="ml-auto flex gap-1">
                  <Button
                    v-if="issue.status === 'decided'"
                    :variant="applyNeedsPayment(request, issue) ? 'warning' : 'default'"
                    size="sm"
                    :disabled="busy || request.status !== 'answered'"
                    @click="void applyIssue(request, issue)"
                  >
                    {{ applyNeedsPayment(request, issue) ? '선적용' : '적용' }}
                  </Button>
                  <Button v-if="issueCanFollowup(issue)" variant="outline" size="sm" :disabled="busy" @click="void promptFollowup(request, issue)">두 번째 발송 기록</Button>
                </span>
              </div>
              <p class="text-muted-foreground mt-1">{{ issue.description }}</p>
              <p class="text-muted-foreground mt-1">
                근거({{ fmtKstDate(issue.evidence.observation.checkedAt) }}): {{ issue.evidence.observation.sourceLabel ?? '공급처 미표시' }}
                · 재고 {{ issue.evidence.observation.stock ?? '—' }} · MOQ {{ issue.evidence.observation.moq ?? '—' }}
                <template v-if="issue.evidence.observation.unitPriceKrw !== null"> · 지금 단가 {{ smartbomFmtWon(issue.evidence.observation.unitPriceKrw) }}</template>
                <template v-if="issue.evidence.observation.leadTime !== null"> · {{ issue.evidence.observation.leadTime }}</template>
                <template v-if="issue.evidence.observation.note !== null"> · {{ issue.evidence.observation.note }}</template>
              </p>
              <ul class="mt-1 grid gap-1">
                <li v-for="option in issue.options" :key="option.code">
                  <!-- 고객이 고른 선택지만 완료 톤으로 — 나머지는 흐린 바탕. -->
                  <Panel
                    size="xs"
                    :tone="option.code === issue.chosenCode ? 'success' : 'muted'"
                    class="flex flex-wrap items-baseline gap-2"
                  >
                    <span class="font-semibold">{{ option.code }}</span>
                    <span class="font-semibold">{{ option.title }}</span>
                    <span class="text-muted-foreground">{{ deltaText(option.priceDelta) }}</span>
                    <span v-if="option.referenceDelta !== null && option.referenceDelta !== option.priceDelta" class="text-muted-foreground">(참고 {{ deltaText(option.referenceDelta) }})</span>
                    <span class="text-muted-foreground min-w-0 break-words">{{ optionDetail(option) }}</span>
                    <span v-if="option.code === issue.chosenCode" class="text-success font-semibold">
                      고객 선택{{ issue.shipPreference === null ? '' : ` · ${BOM_CONFIRM_SHIP_PREFERENCE_LABELS[issue.shipPreference]}` }}
                    </span>
                  </Panel>
                </li>
              </ul>
              <p v-if="issue.followup !== null" class="text-info mt-1">두 번째 발송 {{ issue.followup.shippedAt }} · {{ issue.followup.carrier }} {{ issue.followup.invoice }}</p>
              <p v-if="issue.appliedAt !== null" class="text-muted-foreground mt-1">적용 {{ fmtKstDate(issue.appliedAt) }} · {{ issue.appliedBy }}{{ issue.applyNote === null ? '' : ` — ${issue.applyNote}` }}</p>
            </Panel>
          </div>

          <Button variant="link" size="xs" class="mt-1" @click="expanded[request.id] = !expanded[request.id]">
            {{ expanded[request.id] === true ? '이력 접기' : `이력 ${request.events.length}건 보기` }}
          </Button>
          <ol v-if="expanded[request.id] === true" class="text-muted-foreground grid gap-0.5 text-xs">
            <li v-for="event in request.events" :key="event.id">
              {{ fmtKstDate(event.createdAt) }} · {{ BOM_CONFIRM_EVENT_ACTION_LABELS[event.action] }} · {{ event.actorRole === 'system' ? '시스템' : event.actorMbId }}{{ event.note === null ? '' : ` — ${event.note}` }}
            </li>
          </ol>
        </Panel>
      </li>
    </ol>

    <ConfirmComposePanel
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

    <Dialog :open="proxyTarget !== null" @update:open="onProxyOpenChange">
      <DialogContent v-if="proxyTarget !== null" class="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>대리 회신 — 확인 요청 #{{ proxyTarget.id }}</DialogTitle>
          <DialogDescription>
            전화·메일로 받은 고객의 답을 기록합니다. 고객이 직접 고른 것과 같게 처리되고, 회신 주체는 관리자로 남습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogScrollBody>
          <div class="grid gap-3">
            <Panel v-for="issue in pendingIssues" :key="issue.id">
              <fieldset class="grid gap-2">
                <legend class="text-sm font-semibold">{{ issue.evidence.part.mpn }} · {{ BOM_CONFIRM_ISSUE_TYPE_LABELS[issue.issueType] }}</legend>
                <RadioGroup
                  :aria-label="`${issue.evidence.part.mpn} 선택지`"
                  :model-value="proxyChoices[issue.id] ?? ''"
                  @update:model-value="pickChoice(issue.id, $event)"
                >
                  <div v-for="option in issue.options" :key="option.code" class="flex items-start gap-2 text-xs">
                    <RadioGroupItem :id="`proxy-${issue.id}-${option.code}`" :value="option.code" />
                    <Label :for="`proxy-${issue.id}-${option.code}`">
                      <span class="text-xs font-normal"><b>{{ option.code }} {{ option.title }}</b> · {{ deltaText(option.priceDelta) }}</span>
                    </Label>
                  </div>
                </RadioGroup>
                <template v-if="splitChoosable(issue)">
                  <p class="text-xs font-semibold">받는 방법</p>
                  <RadioGroup
                    :aria-label="`${issue.evidence.part.mpn} 받는 방법`"
                    :model-value="proxyShip[issue.id] ?? ''"
                    @update:model-value="pickShip(issue.id, $event)"
                  >
                    <div v-for="pref in SHIP_PREFERENCES" :key="pref" class="flex items-center gap-2">
                      <RadioGroupItem :id="`proxy-ship-${issue.id}-${pref}`" :value="pref" />
                      <Label :for="`proxy-ship-${issue.id}-${pref}`"><span class="text-xs font-normal">{{ BOM_CONFIRM_SHIP_PREFERENCE_LABELS[pref] }}</span></Label>
                    </div>
                  </RadioGroup>
                </template>
              </fieldset>
            </Panel>
            <Field>
              <FieldLabel for="bomc-proxy-channel">받은 경로</FieldLabel>
              <NativeSelect id="bomc-proxy-channel" :model-value="proxyChannel" @change="pickChannel">
                <NativeSelectOption v-for="channel in PROXY_CHANNELS" :key="channel" :value="channel">
                  {{ BOM_CONFIRM_ANSWER_CHANNEL_LABELS[channel] }}
                </NativeSelectOption>
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel for="bomc-proxy-note">메모(선택)</FieldLabel>
              <Textarea id="bomc-proxy-note" v-model="proxyNote" rows="2" maxlength="2000" />
            </Field>
          </div>
        </DialogScrollBody>
        <DialogFooter>
          <Button variant="outline" :disabled="proxy.isPending.value" @click="proxyTarget = null">취소</Button>
          <Button :disabled="!proxyReady || busy" @click="void submitProxy()">대리 회신 기록</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </SectionCard>
</template>
