<script setup lang="ts">
// 결제 후 부품 확인 요청(D43) 작성 — Case 위에 뜨는 **넓은 오른쪽 패널**(전체 높이, 최대 1200px).
// 가운데 팝업은 품목·선택지가 많아 늘 창 전체가 스크롤돼 어울리지 않았다(2026-09-30 사용자 결정) →
//   머리·바닥 고정, 몸통 3열(품목 목록 | 품목별 작성 | 고객 미리보기)이 **각자** 스크롤한다.
//   1280px 미만은 미리보기를 작성 칸의 탭으로 접고, 모바일은 목록 위·작성 아래 한 열.
// 대체품은 Case 의 후보 서랍(BomCandidateDrawer — 더 위층·최대 896px)을 **고르기 전용**으로 연다: 이 패널의
// 오른쪽 위로 한 겹 덮여 왼쪽 품목 목록이 흐리게 남는다. 적용은 고객 회신 뒤 패널의 [적용]이 한다.
// 초안은 닫아도 남는다(같은 Case 화면 안). 화면을 떠날 때만 묻는다(라우터 가드·새로고침 경고).
// 차액 칸은 참고값(새 라인 − 원 라인, ×1.1)으로 미리 채우지만 최종은 관리자 입력이고, 근거·대체품은 서버가
// 보낼 때 다시 해석해 박제한다(docs/SMARTBOM_PARTNER_RFQ.md §6.39 D43-5·D43-6).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import {
  ADMIN_BOM_CONFIRM_ELIGIBILITY_LABELS,
  BOM_CONFIRM_ISSUE_DEFAULT_DESCRIPTIONS,
  BOM_CONFIRM_ISSUE_TYPE_LABELS,
  BOM_CONFIRM_OPTION_KIND_LABELS,
  BOM_CONFIRM_TYPE_OPTION_KINDS,
  BOM_ITEM_FULFILLMENT_LABELS,
  bomConfirmOptionDefaultTitle,
  type AdminBomConfirmCreateBodyType,
  type AdminBomConfirmEligibilityReasonType,
  type AdminBomConfirmItemRowType,
  type AdminBomConfirmOptionInputType,
  type BomConfirmIssueTypeType,
  type BomConfirmOptionKindType,
  type BomConfirmReplacementPickType,
  type PartHitType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { kstToday, type OfferPick } from '@sp/utils';
import BomCandidateDrawer from '../bom/BomCandidateDrawer.vue';
import BomConfirmCustomerPreview from './BomConfirmCustomerPreview.vue';
import { useAdminBomQuoteCandidates } from '../../../admin/useAdminBomQuotes';
import { useAdminBomRfqs } from '../../../admin/useAdminBomRfqs';
import { useCreateBomConfirm } from '../../../admin/useAdminBomConfirms';
import { smartbomFmtWon } from '../../../admin/smartbom';
import { bomConfirmPreviewDelta, type BomConfirmPreviewIssue } from '../../../admin/bomConfirmPreview';
import { confirmDialog, pendingConfirm } from '../../../lib/confirmDialog';

type OptionKind = Exclude<BomConfirmOptionKindType, 'consult'>;

interface ReplacementDraft {
  pick: BomConfirmReplacementPickType;
  label: string;
  lineTotalKrw: number | null;
}

interface OptionDraft {
  kind: OptionKind;
  enabled: boolean;
  title: string;
  detail: string;
  priceDelta: string;
  deltaTouched: boolean;
  replacement: ReplacementDraft | null;
  moqOrderQty: string;
  restock: { expectedOn: string; basis: string; maxWaitOn: string; splitAllowed: boolean; splitShippingFee: string };
}

interface IssueDraft {
  quoteItemId: string;
  issueType: BomConfirmIssueTypeType;
  description: string;
  observation: { sourceLabel: string; stock: string; moq: string; leadTime: string; note: string };
  options: OptionDraft[];
}

const props = withDefaults(defineProps<{
  open: boolean;
  quoteId: string;
  items: AdminBomConfirmItemRowType[];
  eligibilityReason: AdminBomConfirmEligibilityReasonType | null;
  usdKrwRate: number | null;
  /** 머리에 보일 Case 표시(번호·제목). */
  caseLabel?: string;
}>(), { caseLabel: '' });

const emit = defineEmits<{
  close: [];
  created: [mailStatus: 'sent' | 'skipped' | 'failed'];
  /** 초안 유무 — 패널 버튼이 '작성 이어가기'로 바뀐다. */
  draft: [hasDraft: boolean];
}>();

const create = useCreateBomConfirm();
const quoteIdRef = computed(() => (props.open ? props.quoteId : null));
const rfqQuery = useAdminBomRfqs(quoteIdRef);

const selectedIds = ref<string[]>([]);
const drafts = ref<Record<string, IssueDraft>>({});
const dueOn = ref('');
const message = ref('');
const sendMail = ref(true);
const errorText = ref('');
const itemSearch = ref('');
/** 1280px 미만에서 작성 칸을 고객 미리보기로 바꿔 보는 탭. */
const previewTab = ref(false);

const kstPlusDays = (days: number): string => {
  const [y, m, d] = kstToday().split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + days));
  return date.toISOString().slice(0, 10);
};

const hasDraft = computed(() => selectedIds.value.length > 0 || message.value.trim() !== '');

function resetDraft(): void {
  selectedIds.value = [];
  drafts.value = {};
  dueOn.value = kstPlusDays(3);
  message.value = '';
  sendMail.value = true;
  errorText.value = '';
  itemSearch.value = '';
  previewTab.value = false;
}
resetDraft();

const itemById = computed(() => new Map(props.items.map((item) => [item.quoteItemId, item] as const)));

function itemBlockedReason(item: AdminBomConfirmItemRowType): string | null {
  if (item.activeIssueId !== null) return '확인 요청 진행 중';
  if (item.fulfillment !== 'normal') return BOM_ITEM_FULFILLMENT_LABELS[item.fulfillment];
  return null;
}

watch(hasDraft, (value) => {
  emit('draft', value);
}, { immediate: true });
watch(
  () => props.open,
  (open) => {
    if (!open) return;
    errorText.value = '';
    if (!hasDraft.value) {
      resetDraft();
      return;
    }
    // 초안을 이어 쓴다 — 그사이 다른 요청에 묶였거나 사급·입고 대기가 된 품목은 뺀다.
    selectedIds.value = selectedIds.value.filter((id) => {
      const item = itemById.value.get(id);
      return item !== undefined && itemBlockedReason(item) === null;
    });
  },
);
// 다른 Case 로 옮겨 가면(같은 화면 재사용) 초안은 그 Case 것이 아니다.
watch(() => props.quoteId, () => {
  resetDraft();
});

const visibleItems = computed(() => {
  const query = itemSearch.value.trim().toLowerCase();
  if (query === '') return props.items;
  return props.items.filter((item) =>
    selectedIds.value.includes(item.quoteItemId)
    || item.mpn.toLowerCase().includes(query)
    || (item.manufacturerName ?? '').toLowerCase().includes(query));
});

function defaultOption(issueType: BomConfirmIssueTypeType, kind: OptionKind, item: AdminBomConfirmItemRowType): OptionDraft {
  const supplyRefund = item.lineTotalKrw === null ? '' : String(-Math.round(item.lineTotalKrw * 1.1));
  return {
    kind,
    enabled: true,
    title: bomConfirmOptionDefaultTitle(issueType, kind),
    detail: '',
    priceDelta: kind === 'customer_supply' ? supplyRefund : kind === 'wait_restock' ? '0' : '',
    deltaTouched: false,
    replacement: null,
    moqOrderQty: kind === 'moq_purchase' && item.offerMoq !== null && item.offerMoq > item.neededQty ? String(item.offerMoq) : '',
    restock: { expectedOn: kstPlusDays(14), basis: '', maxWaitOn: '', splitAllowed: false, splitShippingFee: '0' },
  };
}

function newDraft(item: AdminBomConfirmItemRowType, issueType: BomConfirmIssueTypeType = 'stock_out'): IssueDraft {
  return {
    quoteItemId: item.quoteItemId,
    issueType,
    description: BOM_CONFIRM_ISSUE_DEFAULT_DESCRIPTIONS[issueType],
    observation: {
      sourceLabel: item.supplierLabel ?? '',
      stock: issueType === 'stock_out' ? '0' : '',
      moq: item.offerMoq === null ? '' : String(item.offerMoq),
      leadTime: '',
      note: '',
    },
    options: BOM_CONFIRM_TYPE_OPTION_KINDS[issueType].map((kind) => defaultOption(issueType, kind, item)),
  };
}

function toggleItem(item: AdminBomConfirmItemRowType, checked: boolean): void {
  if (checked) {
    if (!selectedIds.value.includes(item.quoteItemId)) selectedIds.value = [...selectedIds.value, item.quoteItemId];
    drafts.value[item.quoteItemId] ??= newDraft(item);
  } else {
    selectedIds.value = selectedIds.value.filter((id) => id !== item.quoteItemId);
  }
}

function changeIssueType(draft: IssueDraft, issueType: BomConfirmIssueTypeType): void {
  const item = itemById.value.get(draft.quoteItemId);
  if (item === undefined) return;
  const fresh = newDraft(item, issueType);
  draft.issueType = issueType;
  draft.description = fresh.description;
  draft.observation = fresh.observation;
  draft.options = fresh.options;
}

const selectedDrafts = computed(() =>
  selectedIds.value.flatMap((id) => {
    const draft = drafts.value[id];
    const item = itemById.value.get(id);
    return draft === undefined || item === undefined ? [] : [{ draft, item }];
  }));

const CODES = ['A', 'B', 'C', 'D', 'E'] as const;
function optionCode(draft: IssueDraft, option: OptionDraft): string {
  const index = draft.options.filter((entry) => entry.enabled).indexOf(option);
  return index < 0 ? '—' : (CODES[index] ?? '?');
}
function consultCode(draft: IssueDraft): string {
  return CODES[draft.options.filter((entry) => entry.enabled).length] ?? '?';
}

/** 참고 차액(VAT 포함) — 새 라인 − 원 라인. 계산 불가면 null. */
function referenceDelta(item: AdminBomConfirmItemRowType, option: OptionDraft): number | null {
  if (item.lineTotalKrw === null) return null;
  if (option.kind === 'customer_supply') return -Math.round(item.lineTotalKrw * 1.1);
  if (option.kind === 'wait_restock') return 0;
  if (option.kind === 'moq_purchase') {
    const qty = Number(option.moqOrderQty);
    if (!Number.isFinite(qty) || qty <= 0 || item.orderQty <= 0) return null;
    const unit = item.lineTotalKrw / item.orderQty;
    return Math.round((unit * qty - item.lineTotalKrw) * 1.1);
  }
  if (option.replacement?.lineTotalKrw == null) return null;
  return Math.round((option.replacement.lineTotalKrw - item.lineTotalKrw) * 1.1);
}

function syncDelta(item: AdminBomConfirmItemRowType, option: OptionDraft): void {
  if (option.deltaTouched) return;
  const ref = referenceDelta(item, option);
  if (ref !== null) option.priceDelta = String(ref);
}

// ── 대체품·다른 공급처 고르기(후보 서랍) ─────────────────────────────────────
const drawerTarget = ref<{ itemId: string; option: OptionDraft } | null>(null);
const drawerItemId = computed(() => drawerTarget.value?.itemId ?? null);
const candidatesQuery = useAdminBomQuoteCandidates(quoteIdRef, drawerItemId);
const drawerItem = computed(() => (drawerItemId.value === null ? null : (itemById.value.get(drawerItemId.value) ?? null)));

function openDrawer(itemId: string, option: OptionDraft): void {
  drawerTarget.value = { itemId, option };
}

function onCandidateSelect(candidateKey: string, offerKey: string | null): void {
  const target = drawerTarget.value;
  if (target === null) return;
  const context = candidatesQuery.data.value?.data;
  const candidate = context?.candidates.find((entry) => entry.candidateKey === candidateKey);
  const offer = candidate?.offers.find((entry) => entry.offerKey === offerKey) ?? null;
  const line = offer?.applied?.lineTotalKrw ?? candidate?.bestLineTotalKrw ?? null;
  target.option.replacement = {
    pick: { source: 'candidate', candidateKey, offerKey },
    label: `${candidate?.mpn ?? candidateKey}${offer === null ? '' : ` · ${offer.supplier.toUpperCase()}`}`,
    lineTotalKrw: line,
  };
  const item = itemById.value.get(target.itemId);
  if (item !== undefined) syncDelta(item, target.option);
  drawerTarget.value = null;
}

function onCatalogSelect(part: PartHitType, pick: OfferPick | null): void {
  const target = drawerTarget.value;
  if (target === null) return;
  target.option.replacement = {
    pick: {
      source: 'catalog',
      partId: part.id,
      offer: pick === null ? null : { supplier: pick.offer.supplier, supplierSku: pick.offer.supplierSku },
    },
    label: `${part.mpn}${pick === null ? '' : ` · ${pick.offer.supplier.toUpperCase()}`}`,
    lineTotalKrw: pick?.unitPriceKrw == null ? null : Math.round(pick.unitPriceKrw * pick.orderQty * 100) / 100,
  };
  const item = itemById.value.get(target.itemId);
  if (item !== undefined) syncDelta(item, target.option);
  drawerTarget.value = null;
}

/** 이 품목에 회신한 협력사(다른 공급처 후보) — 단가 있는 회신만. */
function partnerReplies(itemId: string) {
  const rfqs = rfqQuery.data.value?.data.rfqs ?? [];
  return rfqs.flatMap((rfq) =>
    rfq.items
      .filter((reply) => reply.quoteItemId === itemId && reply.unitPrice !== null)
      .map((reply) => ({
        rfqItemId: String(reply.rfqItemId),
        label: `${rfq.partnerName} · 단가 ${smartbomFmtWon(reply.unitPrice ?? 0)}${reply.moq === null ? '' : ` · MOQ ${String(reply.moq)}`}${reply.leadTime === null ? '' : ` · ${reply.leadTime}`}`,
        unitPrice: reply.unitPrice ?? 0,
        qty: Math.max(reply.replyQty ?? 0, reply.moq ?? 0),
      })));
}

function pickPartnerReply(item: AdminBomConfirmItemRowType, option: OptionDraft, rfqItemId: string): void {
  const reply = partnerReplies(item.quoteItemId).find((entry) => entry.rfqItemId === rfqItemId);
  if (reply === undefined) {
    option.replacement = null;
    return;
  }
  const qty = Math.max(item.neededQty, reply.qty);
  option.replacement = {
    pick: { source: 'rfq', rfqItemId },
    label: reply.label,
    lineTotalKrw: reply.unitPrice * qty,
  };
  syncDelta(item, option);
}

// ── 검증·전송 ────────────────────────────────────────────────────────────────
const toInt = (value: string): number | null => {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

const validation = computed((): string | null => {
  if (selectedDrafts.value.length === 0) return '확인할 품목을 왼쪽에서 하나 이상 고르세요.';
  for (const { draft, item } of selectedDrafts.value) {
    const enabled = draft.options.filter((option) => option.enabled);
    if (enabled.length === 0) return `${item.mpn}: 선택지를 하나 이상 켜세요.`;
    if (draft.description.trim().length < 5) return `${item.mpn}: 문제 설명을 5자 이상 적으세요.`;
    for (const option of enabled) {
      const label = BOM_CONFIRM_OPTION_KIND_LABELS[option.kind];
      if (toInt(option.priceDelta) === null) return `${item.mpn} · ${label}: 차액(원)을 정수로 입력하세요.`;
      if ((option.kind === 'substitute' || option.kind === 'alt_supplier') && option.replacement === null) {
        return `${item.mpn} · ${label}: 대체 부품·공급처를 고르세요.`;
      }
      if (option.kind === 'moq_purchase') {
        const qty = toInt(option.moqOrderQty);
        if (qty === null || qty < item.neededQty) return `${item.mpn} · ${label}: 구매 수량은 필요수량(${String(item.neededQty)}) 이상이어야 합니다.`;
      }
      if (option.kind === 'wait_restock') {
        if (option.restock.expectedOn === '' || option.restock.basis.trim() === '') {
          return `${item.mpn} · ${label}: 예상 입고일과 근거를 적으세요.`;
        }
        if (option.restock.splitAllowed && toInt(option.restock.splitShippingFee) === null) {
          return `${item.mpn} · ${label}: 분할 배송비를 정수로 입력하세요(0=당사 부담).`;
        }
      }
    }
  }
  return null;
});

function buildBody(): AdminBomConfirmCreateBodyType {
  const optional = (value: string): string | null => (value.trim() === '' ? null : value.trim());
  return {
    ...(message.value.trim() === '' ? {} : { message: message.value.trim() }),
    dueOn: dueOn.value === '' ? null : dueOn.value,
    sendMail: sendMail.value,
    issues: selectedDrafts.value.map(({ draft }) => ({
      quoteItemId: draft.quoteItemId,
      issueType: draft.issueType,
      description: draft.description.trim(),
      observation: {
        sourceLabel: optional(draft.observation.sourceLabel),
        stock: toInt(draft.observation.stock),
        moq: toInt(draft.observation.moq),
        leadTime: optional(draft.observation.leadTime),
        note: optional(draft.observation.note),
      },
      options: draft.options
        .filter((option) => option.enabled)
        .map((option): AdminBomConfirmOptionInputType => ({
          kind: option.kind,
          ...(option.title.trim() === '' ? {} : { title: option.title.trim() }),
          ...(option.detail.trim() === '' ? {} : { detail: option.detail.trim() }),
          priceDelta: toInt(option.priceDelta) ?? 0,
          ...(option.replacement === null ? {} : { replacement: option.replacement.pick }),
          ...(option.kind === 'moq_purchase' ? { moqOrderQty: toInt(option.moqOrderQty) ?? 0 } : {}),
          ...(option.kind === 'wait_restock'
            ? {
                restock: {
                  expectedOn: option.restock.expectedOn,
                  basis: option.restock.basis.trim(),
                  maxWaitOn: option.restock.maxWaitOn === '' ? null : option.restock.maxWaitOn,
                  splitAllowed: option.restock.splitAllowed,
                  splitShippingFee: option.restock.splitAllowed ? (toInt(option.restock.splitShippingFee) ?? 0) : 0,
                },
              }
            : {}),
        })),
    })),
  };
}

async function submit(): Promise<void> {
  if (validation.value !== null || create.isPending.value) return;
  errorText.value = '';
  try {
    const response = await create.mutateAsync({ quoteId: props.quoteId, body: buildBody() });
    resetDraft();
    emit('created', response.data.mail.status);
  } catch (error) {
    errorText.value = error instanceof ApiRequestError
      ? (error.payload?.message ?? error.message)
      : '확인 요청을 보내지 못했습니다. 잠시 뒤 다시 시도하세요.';
  }
}

const deltaLabel = (value: number | null): string => {
  if (value === null) return '계산 불가';
  if (value === 0) return '변동 없음';
  return value > 0 ? `+${smartbomFmtWon(value)} 추가결제` : `${smartbomFmtWon(-value)} 환불`;
};

// ── 고객 미리보기·요약 ─────────────────────────────────────────────────────────
function optionSummary(item: AdminBomConfirmItemRowType, option: OptionDraft): string {
  let base = '';
  if (option.kind === 'substitute' || option.kind === 'alt_supplier') {
    base = option.replacement?.label ?? '대체 부품·공급처를 아직 고르지 않았습니다';
  } else if (option.kind === 'moq_purchase') {
    const qty = toInt(option.moqOrderQty);
    base = qty === null
      ? '구매 수량 미입력'
      : `필요 ${String(item.neededQty)}개 → ${String(qty)}개 구매(여유 ${String(Math.max(0, qty - item.neededQty))}개)`;
  } else if (option.kind === 'wait_restock') {
    const restock = option.restock;
    const fee = toInt(restock.splitShippingFee);
    base = [
      `예상 입고 ${restock.expectedOn === '' ? '—' : restock.expectedOn}`,
      restock.maxWaitOn === '' ? '' : `최대 ${restock.maxWaitOn}까지 대기`,
      restock.splitAllowed ? `나눠 받기 선택 가능(두 번째 배송비 ${fee === null || fee === 0 ? '당사 부담' : smartbomFmtWon(fee)})` : '',
    ].filter((part) => part !== '').join(' · ');
  }
  return [base, option.detail.trim()].filter((part) => part !== '').join(' · ');
}

const previewIssues = computed((): BomConfirmPreviewIssue[] =>
  selectedDrafts.value.map(({ draft, item }) => {
    const enabled = draft.options.filter((option) => option.enabled);
    return {
      key: draft.quoteItemId,
      mpn: item.mpn,
      manufacturerName: item.manufacturerName,
      issueTypeLabel: BOM_CONFIRM_ISSUE_TYPE_LABELS[draft.issueType],
      moq: draft.issueType === 'moq_increase',
      description: draft.description,
      options: [
        ...enabled.map((option, index) => ({
          code: CODES[index] ?? '?',
          title: option.title.trim() === '' ? bomConfirmOptionDefaultTitle(draft.issueType, option.kind) : option.title.trim(),
          ...bomConfirmPreviewDelta(toInt(option.priceDelta)),
          summary: optionSummary(item, option),
        })),
        {
          code: consultCode(draft),
          title: bomConfirmOptionDefaultTitle(draft.issueType, 'consult'),
          ...bomConfirmPreviewDelta(0),
          summary: '맞는 선택지가 없으면 담당자와 상담해 정합니다.',
        },
      ],
    };
  }));

/** 고객이 고르는 조합에 따른 순액 범위(VAT 포함) — 품목마다 가장 작은·큰 선택지(상담 0·분할 배송비 포함)의 합. */
const rangeText = computed((): string => {
  let min = 0;
  let max = 0;
  for (const { draft } of selectedDrafts.value) {
    const values = [0];
    for (const option of draft.options.filter((entry) => entry.enabled)) {
      const value = toInt(option.priceDelta);
      if (value === null) return '차액 입력 필요';
      values.push(value);
      if (option.kind === 'wait_restock' && option.restock.splitAllowed) {
        const fee = toInt(option.restock.splitShippingFee);
        if (fee !== null) values.push(value + fee);
      }
    }
    min += Math.min(...values);
    max += Math.max(...values);
  }
  const fmt = (n: number): string => (n === 0 ? '0원' : n > 0 ? `+${smartbomFmtWon(n)}` : `−${smartbomFmtWon(-n)}`);
  return min === max ? fmt(min) : `${fmt(min)} ~ ${fmt(max)}`;
});

// ── 닫기·이탈 ─────────────────────────────────────────────────────────────────
function requestClose(): void {
  emit('close');
}

async function discardDraft(): Promise<void> {
  const ok = await confirmDialog({ message: '작성 중인 부품 확인 요청 초안을 비울까요?', confirmLabel: '비우기', tone: 'danger' });
  if (ok) resetDraft();
}

const askLeave = (): Promise<boolean> =>
  confirmDialog({
    message: '작성 중인 부품 확인 요청이 있습니다. 이 화면을 떠나면 초안이 사라집니다.',
    confirmLabel: '떠나기',
    tone: 'danger',
  });
onBeforeRouteLeave(async () => !hasDraft.value || (await askLeave()));
onBeforeRouteUpdate(async (to, from) => to.params.id === from.params.id || !hasDraft.value || (await askLeave()));

const beforeUnload = (event: BeforeUnloadEvent): void => {
  if (!hasDraft.value) return;
  event.preventDefault();
};

/** ESC — 후보 서랍·확인창이 떠 있으면 그쪽이 먼저 닫는다(캡처 단계라 서랍보다 먼저 상태를 본다). */
function onKeydown(event: KeyboardEvent): void {
  if (!props.open || event.key !== 'Escape') return;
  if (drawerTarget.value !== null || pendingConfirm.value !== null) return;
  requestClose();
}

let previousOverflow: string | null = null;
function lockScroll(): void {
  if (previousOverflow !== null) return;
  previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}
function unlockScroll(): void {
  if (previousOverflow === null) return;
  document.body.style.overflow = previousOverflow;
  previousOverflow = null;
}
watch(() => props.open, (open) => {
  if (open) lockScroll();
  else unlockScroll();
}, { immediate: true });

onMounted(() => {
  window.addEventListener('keydown', onKeydown, { capture: true });
  window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, { capture: true });
  window.removeEventListener('beforeunload', beforeUnload);
  unlockScroll();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[55] flex justify-end bg-slate-950/45"
      role="presentation"
      @mousedown.self="requestClose"
    >
      <aside
        class="flex h-full w-full flex-col bg-surface shadow-2xl lg:w-[min(1200px,94vw)]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bom-confirm-compose-title"
      >
        <header class="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-5 py-3">
          <div class="min-w-0">
            <p class="text-[11px] font-bold uppercase tracking-[0.16em] text-sky-700">D43 · 결제 후 부품 확인</p>
            <h2 id="bom-confirm-compose-title" class="mt-0.5 text-lg font-bold text-gray-900">부품 확인 요청 작성</h2>
            <p class="mt-0.5 truncate text-xs text-gray-500">
              <template v-if="caseLabel !== ''">{{ caseLabel }} — </template>고객 결과(부품·금액·납기·수량)가 바뀔 때만 묻습니다. 같은 부품을 다른 협력사에서 같은 값에 받는 건 부족 신고·잔량 대체발주로.
            </p>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span v-if="hasDraft" class="hidden text-[11px] text-gray-400 sm:inline">닫아도 초안은 남습니다</span>
            <button
              v-if="hasDraft"
              type="button"
              class="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50"
              @click="discardDraft"
            >
              초안 비우기
            </button>
            <button type="button" class="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-gray-50" @click="requestClose">
              닫기
            </button>
          </div>
        </header>

        <div v-if="eligibilityReason !== null" class="m-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          {{ ADMIN_BOM_CONFIRM_ELIGIBILITY_LABELS[eligibilityReason] }}
        </div>

        <div
          v-else
          class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,38vh)_minmax(0,1fr)] lg:grid-cols-[272px_minmax(0,1fr)] lg:grid-rows-1 xl:grid-cols-[272px_minmax(0,1fr)_320px]"
        >
          <!-- 1. 품목 목록 — 큰 BOM 도 검색으로 좁힌다(고른 품목은 검색과 무관하게 남긴다) -->
          <div class="flex min-h-0 flex-col border-b border-gray-200 lg:border-b-0 lg:border-r">
            <div class="shrink-0 border-b border-gray-100 p-3">
              <p class="text-xs font-bold text-gray-900">
                1. 문제가 생긴 품목
                <span class="ml-1 font-normal text-gray-500">선택 {{ selectedIds.length }} · 전체 {{ items.length }}</span>
              </p>
              <input
                v-model="itemSearch"
                type="search"
                placeholder="품번·제조사 검색"
                aria-label="품목 검색"
                class="mt-2 w-full rounded-lg border border-gray-300 px-3 py-1.5 text-xs"
              >
            </div>
            <ul class="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto">
              <li
                v-for="item in visibleItems"
                :key="item.quoteItemId"
                :data-bomc-item="item.quoteItemId"
                :class="selectedIds.includes(item.quoteItemId) ? 'bg-sky-50' : ''"
              >
                <label
                  class="flex gap-2.5 px-3 py-2.5"
                  :class="itemBlockedReason(item) === null ? 'cursor-pointer hover:bg-gray-50' : 'cursor-not-allowed opacity-60'"
                >
                  <input
                    :id="`bomc-item-${item.quoteItemId}`"
                    type="checkbox"
                    class="mt-0.5 h-4 w-4 shrink-0"
                    :disabled="itemBlockedReason(item) !== null"
                    :checked="selectedIds.includes(item.quoteItemId)"
                    @change="toggleItem(item, ($event.target as HTMLInputElement).checked)"
                  >
                  <span class="min-w-0 text-xs">
                    <span class="block break-all font-semibold text-gray-900">{{ item.mpn }}</span>
                    <span class="block text-[11px] text-gray-500">
                      {{ item.manufacturerName ?? '제조사 미기재' }} · 필요 {{ item.neededQty }} / 주문 {{ item.orderQty }}
                    </span>
                    <span class="block text-[11px] text-gray-500">
                      {{ item.supplierLabel ?? '공급처 —' }} · 재고 {{ item.offerStock ?? '—' }} · MOQ {{ item.offerMoq ?? '—' }}
                    </span>
                    <span v-if="item.po !== null" class="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      발주 {{ item.po.partnerName }} #{{ item.po.poId }} ({{ item.po.status }})
                    </span>
                    <span v-if="itemBlockedReason(item) !== null" class="mt-1 block text-[11px] font-semibold text-gray-500">{{ itemBlockedReason(item) }}</span>
                  </span>
                </label>
              </li>
              <li v-if="visibleItems.length === 0" class="px-3 py-6 text-center text-xs text-gray-400">검색 결과가 없습니다.</li>
            </ul>
            <p class="shrink-0 border-t border-gray-100 px-3 py-2 text-[11px] leading-4 text-gray-500">
              발주서에 든 품목도 물을 수 있지만 적용하려면 그 발주서를 정리해야 합니다. 확인 중인 품목이 든 구매처는 발주가 보류됩니다.
            </p>
          </div>

          <!-- 2. 품목별 작성 — 1280px 미만에선 고객 미리보기와 탭으로 오간다 -->
          <div class="min-h-0 overflow-y-auto">
            <div class="sticky top-0 z-10 flex gap-1 border-b border-gray-100 bg-surface px-4 py-2 xl:hidden" role="tablist" aria-label="작성·고객 미리보기 전환">
              <button
                type="button"
                role="tab"
                class="rounded-lg px-3 py-1 text-xs font-semibold"
                :class="previewTab ? 'text-gray-500 hover:bg-gray-50' : 'bg-gray-900 text-white'"
                :aria-selected="!previewTab"
                @click="previewTab = false"
              >
                작성
              </button>
              <button
                type="button"
                role="tab"
                class="rounded-lg px-3 py-1 text-xs font-semibold"
                :class="previewTab ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-50'"
                :aria-selected="previewTab"
                @click="previewTab = true"
              >
                고객 미리보기
              </button>
            </div>
            <div v-if="previewTab" class="p-4 xl:hidden">
              <BomConfirmCustomerPreview :issues="previewIssues" :message="message" :due-on="dueOn" />
            </div>

            <div class="grid gap-4 p-4" :class="previewTab ? 'hidden xl:grid' : ''">
              <p v-if="selectedDrafts.length === 0" class="rounded-xl border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
                왼쪽 목록에서 문제가 생긴 품목을 고르세요.<br>
                <span class="text-xs text-gray-400">여러 품목을 한 요청으로 묶으면 고객이 한 번에 회신합니다.</span>
              </p>

              <section v-for="{ draft, item } in selectedDrafts" :key="draft.quoteItemId" class="grid gap-3 rounded-xl border border-gray-200 p-4">
                <div class="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 class="break-all text-sm font-bold text-gray-900">{{ item.mpn }}</h3>
                  <p class="text-xs tabular-nums text-gray-500">
                    주문 {{ item.orderQty }}개 · 라인 {{ item.lineTotalKrw === null ? '미산출' : smartbomFmtWon(item.lineTotalKrw) }}(VAT 별도)
                  </p>
                </div>

                <div class="flex flex-wrap gap-2" role="radiogroup" :aria-label="`${item.mpn} 문제 유형`">
                  <label
                    v-for="type in (['stock_out', 'moq_increase'] as const)"
                    :key="type"
                    class="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold"
                    :class="draft.issueType === type ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-gray-300 text-gray-600'"
                  >
                    <input
                      type="radio"
                      class="h-3.5 w-3.5"
                      :name="`bomc-type-${draft.quoteItemId}`"
                      :checked="draft.issueType === type"
                      @change="changeIssueType(draft, type)"
                    >
                    {{ BOM_CONFIRM_ISSUE_TYPE_LABELS[type] }}
                  </label>
                </div>

                <label class="grid gap-1 text-xs font-semibold text-gray-600">
                  문제 설명(고객에게 보임)
                  <textarea v-model="draft.description" rows="2" maxlength="1000" class="rounded-lg border border-gray-300 px-3 py-2 text-sm font-normal text-gray-900" />
                </label>

                <fieldset class="grid gap-2 rounded-lg bg-gray-50 p-3">
                  <legend class="px-1 text-xs font-bold text-gray-700">확인 근거(요청 시점으로 박제)</legend>
                  <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <label class="grid min-w-0 gap-1 text-[11px] font-semibold text-gray-500">공급처 표시
                      <input v-model="draft.observation.sourceLabel" maxlength="60" class="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900">
                    </label>
                    <label class="grid min-w-0 gap-1 text-[11px] font-semibold text-gray-500">재고
                      <input v-model="draft.observation.stock" inputmode="numeric" class="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900 tabular-nums">
                    </label>
                    <label class="grid min-w-0 gap-1 text-[11px] font-semibold text-gray-500">MOQ
                      <input v-model="draft.observation.moq" inputmode="numeric" class="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900 tabular-nums">
                    </label>
                    <label class="grid min-w-0 gap-1 text-[11px] font-semibold text-gray-500">리드타임
                      <input v-model="draft.observation.leadTime" maxlength="60" placeholder="예: 12주" class="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900">
                    </label>
                    <label class="grid min-w-0 gap-1 text-[11px] font-semibold text-gray-500">메모
                      <input v-model="draft.observation.note" maxlength="500" class="w-full min-w-0 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900">
                    </label>
                  </div>
                </fieldset>

                <div class="grid gap-2">
                  <p class="text-xs font-bold text-gray-700">당사 제안(고객 선택지)</p>
                  <div
                    v-for="option in draft.options"
                    :key="option.kind"
                    class="grid gap-2 rounded-lg border p-3"
                    :class="option.enabled ? 'border-gray-300' : 'border-dashed border-gray-200 opacity-60'"
                  >
                    <div class="flex flex-wrap items-center gap-2">
                      <input :id="`bomc-opt-${draft.quoteItemId}-${option.kind}`" v-model="option.enabled" type="checkbox" class="h-4 w-4">
                      <span class="grid h-6 w-6 place-items-center rounded bg-gray-900 text-xs font-bold text-white">{{ optionCode(draft, option) }}</span>
                      <label :for="`bomc-opt-${draft.quoteItemId}-${option.kind}`" class="text-sm font-bold text-gray-900">
                        {{ BOM_CONFIRM_OPTION_KIND_LABELS[option.kind] }}
                      </label>
                      <input v-model="option.title" :disabled="!option.enabled" maxlength="60" class="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs" aria-label="고객에게 보이는 제목">
                    </div>
                    <template v-if="option.enabled">
                      <input v-model="option.detail" maxlength="500" placeholder="고객 안내(선택)" class="rounded border border-gray-300 px-2 py-1 text-xs">

                      <div v-if="option.kind === 'substitute' || option.kind === 'alt_supplier'" class="flex flex-wrap items-center gap-2 text-xs">
                        <button type="button" class="rounded border border-violet-200 px-2 py-1 font-semibold text-violet-700 hover:bg-violet-50" @click="openDrawer(draft.quoteItemId, option)">
                          {{ option.kind === 'substitute' ? '대체 부품 고르기' : '같은 부품 다른 구매 조건 고르기' }}
                        </button>
                        <select
                          v-if="option.kind === 'alt_supplier' && partnerReplies(draft.quoteItemId).length > 0"
                          class="rounded border border-gray-300 px-2 py-1"
                          aria-label="협력사 회신에서 고르기"
                          @change="pickPartnerReply(item, option, ($event.target as HTMLSelectElement).value)"
                        >
                          <option value="">협력사 회신에서 고르기…</option>
                          <option v-for="reply in partnerReplies(draft.quoteItemId)" :key="reply.rfqItemId" :value="reply.rfqItemId">{{ reply.label }}</option>
                        </select>
                        <span v-if="option.replacement !== null" class="rounded bg-violet-50 px-2 py-1 font-semibold text-violet-800">
                          {{ option.replacement.label }} · 라인 {{ option.replacement.lineTotalKrw === null ? '미산출' : smartbomFmtWon(option.replacement.lineTotalKrw) }}
                        </span>
                        <span v-else class="text-rose-600">아직 고르지 않았습니다</span>
                      </div>

                      <div v-if="option.kind === 'moq_purchase'" class="flex flex-wrap items-center gap-2 text-xs">
                        <label class="flex items-center gap-2 font-semibold text-gray-600">실제 구매 수량
                          <input v-model="option.moqOrderQty" inputmode="numeric" class="w-28 rounded border border-gray-300 px-2 py-1 tabular-nums" @change="syncDelta(item, option)">
                        </label>
                        <span class="text-gray-500">필요 {{ item.neededQty }}개 · 남는 부품은 고객에게 함께 보냅니다</span>
                      </div>

                      <div v-if="option.kind === 'wait_restock'" class="grid gap-2 text-xs sm:grid-cols-4">
                        <label class="grid min-w-0 gap-1 font-semibold text-gray-600">예상 입고일
                          <input v-model="option.restock.expectedOn" type="date" class="w-full min-w-0 rounded border border-gray-300 px-2 py-1">
                        </label>
                        <label class="grid min-w-0 gap-1 font-semibold text-gray-600 sm:col-span-2">근거
                          <input v-model="option.restock.basis" maxlength="200" placeholder="예: 공급사 입고 예정 공지" class="w-full min-w-0 rounded border border-gray-300 px-2 py-1">
                        </label>
                        <label class="grid min-w-0 gap-1 font-semibold text-gray-600">최대 대기일
                          <input v-model="option.restock.maxWaitOn" type="date" class="w-full min-w-0 rounded border border-gray-300 px-2 py-1">
                        </label>
                        <label class="flex items-center gap-2 font-semibold text-gray-600 sm:col-span-2">
                          <input v-model="option.restock.splitAllowed" type="checkbox" class="h-4 w-4">
                          고객이 '먼저 온 부품 먼저 받기'를 고를 수 있게 하기
                        </label>
                        <label v-if="option.restock.splitAllowed" class="grid min-w-0 gap-1 font-semibold text-gray-600 sm:col-span-2">두 번째 배송비(VAT 포함, 0=당사 부담)
                          <input v-model="option.restock.splitShippingFee" inputmode="numeric" class="w-full min-w-0 rounded border border-gray-300 px-2 py-1 tabular-nums">
                        </label>
                      </div>

                      <div class="flex flex-wrap items-center gap-2 text-xs">
                        <label class="flex items-center gap-2 font-semibold text-gray-600">차액(VAT 포함, +추가결제 −환불)
                          <input
                            v-model="option.priceDelta"
                            inputmode="numeric"
                            class="w-32 rounded border border-gray-300 px-2 py-1 tabular-nums"
                            @input="option.deltaTouched = true"
                          >
                        </label>
                        <span class="text-gray-500">참고값 {{ deltaLabel(referenceDelta(item, option)) }} · 0 이면 당사 부담</span>
                      </div>
                    </template>
                  </div>
                  <p class="text-[11px] text-gray-500">{{ consultCode(draft) }} 상담 요청 — 맞는 선택지가 없을 때를 위해 자동으로 붙습니다.</p>
                </div>
              </section>

              <div v-if="selectedDrafts.length > 0" class="rounded-xl border border-gray-200 p-4">
                <label class="grid gap-1 text-xs font-semibold text-gray-600">고객 안내 문구(선택)
                  <textarea v-model="message" rows="2" maxlength="2000" placeholder="예) 결제 후 구매 단계에서 두 부품에 문제가 생겼습니다. 부품마다 처리 방법을 골라 주세요." class="rounded border border-gray-300 px-2 py-1 text-sm font-normal" />
                </label>
              </div>
            </div>
          </div>

          <!-- 3. 고객 미리보기 — 1280px 이상에서 늘 옆에 -->
          <div class="hidden min-h-0 overflow-y-auto border-l border-gray-200 bg-gray-50 p-4 xl:block">
            <BomConfirmCustomerPreview :issues="previewIssues" :message="message" :due-on="dueOn" />
          </div>
        </div>

        <footer class="flex shrink-0 flex-wrap items-center gap-3 border-t border-gray-200 bg-surface px-5 py-3">
          <div class="mr-auto min-w-0 text-xs">
            <p v-if="errorText !== ''" class="font-semibold text-rose-600" role="alert">{{ errorText }}</p>
            <p v-else-if="eligibilityReason === null && validation !== null" class="text-gray-500">{{ validation }}</p>
            <p v-else-if="eligibilityReason === null" class="text-gray-700">
              품목 {{ selectedDrafts.length }}개 · 고객 선택에 따라 <b class="tabular-nums">{{ rangeText }}</b>
            </p>
          </div>
          <label class="flex items-center gap-2 text-xs font-semibold text-gray-600">회신 기한
            <input v-model="dueOn" type="date" class="rounded border border-gray-300 px-2 py-1 text-sm">
          </label>
          <label class="flex items-center gap-2 text-xs font-semibold text-gray-600" title="메일엔 링크만 — 선택은 마이페이지·주문 상세에서">
            <input v-model="sendMail" type="checkbox" class="h-4 w-4">
            고객 메일
          </label>
          <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50" @click="requestClose">
            닫기
          </button>
          <button
            type="button"
            class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="eligibilityReason !== null || validation !== null || create.isPending.value"
            @click="submit"
          >
            {{ create.isPending.value ? '보내는 중…' : '확인 요청 보내기' }}
          </button>
        </footer>
      </aside>
    </div>
  </Teleport>

  <BomCandidateDrawer
    :open="drawerTarget !== null"
    :context="candidatesQuery.data.value?.data ?? null"
    :loading="candidatesQuery.isLoading.value"
    :failed="candidatesQuery.isError.value"
    :force-selection-allowed="true"
    :initial-view="'candidates'"
    :search-initial-query="drawerItem?.mpn ?? ''"
    :needed="drawerItem?.neededQty ?? 1"
    :usd-krw-rate="usdKrwRate"
    :search-refresh-enabled="false"
    selection-locked-reason=""
    @select="onCandidateSelect"
    @catalog-select="onCatalogSelect"
    @close="drawerTarget = null"
  />
</template>
