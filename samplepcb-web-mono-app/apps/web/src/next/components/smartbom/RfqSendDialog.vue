<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { ChevronDownIcon, ChevronUpIcon, ListChecksIcon } from '@lucide/vue';
import type {
  AdminBomQuoteItemPartnerHolderType,
  AdminBomRfqViewType,
  BomQuoteItemType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useAdminPartnerList, type AdminPartnerFilters } from '@/admin/useAdminPartners';
import { useSendBomRfqs } from '@/admin/useAdminBomRfqs';
import { useAdminPartnerPartSummary } from '@/admin/useAdminPartnerParts';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Spinner } from '@/next/components/ui/spinner';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';

// 협력사 견적요청 발송 — 옛 components/admin/smartbom/BomRfqSendModal.vue 의 짝(같은 props·emits).
// 승인 협력사(BOM 견적 트랙)를 고르면 그 집합으로 발송 상태를 맞춘다(diff — 유지분 보존, 빠진 미회신만
// 삭제, 신규만 메일. docs/SMARTBOM_PARTNER_RFQ.md §2.4). 회신한 협력사는 서버가 보존하므로 해제를 잠근다.
// 부분 행 선택(§6.13)은 품목 표에서 하고(selectedItemIds, 빈 배열=전체) 여기서는 요약·확인만 한다 —
// [품목 표에서 고르기]는 대화상자를 닫고 그 자리로 데려간다(pickRows). 이미 보낸 미회신 요청에는 협력사별
// [행 추가]를 켠 곳만 이번 행을 더한다(§6.13 개정 — 합집합, 회신한 요청은 잠김).

const props = defineProps<{
  open: boolean;
  quoteId: string;
  scopeItems: BomQuoteItemType[]; // 요청 가능 부품행(included·활성 시트)
  selectedItemIds: string[]; // 품목 테이블 체크 — 빈 배열=전체 발송
  rfqs: AdminBomRfqViewType[];
  /** partnerId → 보유 중인 quoteItemId (docs/PARTNER_PARTS.md). 없으면 표시만 생략. */
  partnerItems?: Record<string, string[]>;
  /** quoteItemId → 보유 협력사 상세(재고·D/C·기준일). 펼친 목록이 이걸 읽는다. */
  itemHolders?: Record<string, AdminBomQuoteItemPartnerHolderType[]>;
}>();
const emit = defineEmits<{ close: []; sent: []; pickRows: [] }>();

const idPrefix = useId();

// 승인된 협력사 전체(관리 목록 재사용, capability 는 클라 필터).
const partnerFilters = ref<AdminPartnerFilters>({
  page: 1,
  pageSize: 100,
  tab: 'approved',
  type: 'partner',
  q: '',
});
const { data: partnerData, isFetching } = useAdminPartnerList(partnerFilters);

// 협력사 보유 부품 — 제한이 아니라 고르기 쉽게 하는 표시: 보유한 곳을 위로, 건수를 배지로.
const scopedItemIds = computed(
  () => new Set(props.selectedItemIds.length > 0 ? props.selectedItemIds : props.scopeItems.map((item) => item.id)),
);
const holdingCount = (partnerId: number): number => {
  const owned = props.partnerItems?.[String(partnerId)];
  if (owned === undefined) return 0;
  return owned.filter((itemId) => scopedItemIds.value.has(itemId)).length;
};

// 배지를 눌러 어느 행을 얼마나 갖고 있는지 펼친다 — '몇 행'만으로는 수량 부족한 곳에 거는 헛발질을
// 못 막는다. 기본 접힘(승인 협력사 수십 곳 중 대부분 보유 0행).
const expanded = ref<Set<number>>(new Set());
function toggleExpanded(partnerId: number): void {
  const next = new Set(expanded.value);
  if (next.has(partnerId)) next.delete(partnerId);
  else next.add(partnerId);
  expanded.value = next;
}

// 낡음 기준일은 서버 설정(sp_config)이 정본 — 화면에 상수로 박지 않는다(요약 조회는 캐시를 탄다).
const partnerPartSummary = useAdminPartnerPartSummary();
const staleAfterDays = computed(() => partnerPartSummary.data.value?.data.staleAfterDays ?? null);

interface HeldRow {
  itemId: string;
  mpn: string;
  stockQty: number | null;
  dateCode: string | null;
  ageDays: number | null;
  stale: boolean;
}

const ageDaysFrom = (iso: string): number | null => {
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((Date.now() - at) / 86_400_000));
};

/** 이 협력사가 이번 발송 범위 안에서 가진 행 — 순서는 품목 표와 같게. */
const heldRows = (partnerId: number): HeldRow[] => {
  const owned = new Set(props.partnerItems?.[String(partnerId)] ?? []);
  if (owned.size === 0) return [];
  return props.scopeItems
    .filter((item) => owned.has(item.id) && scopedItemIds.value.has(item.id))
    .map((item) => {
      const holder = (props.itemHolders?.[item.id] ?? []).find((row) => row.partnerId === partnerId);
      const ageDays = holder === undefined ? null : ageDaysFrom(holder.uploadedAt);
      return {
        itemId: item.id,
        mpn: item.mpn === '' ? '(품번 없음)' : item.mpn,
        stockQty: holder?.stockQty ?? null,
        dateCode: holder?.dateCode ?? null,
        ageDays,
        stale: ageDays !== null && staleAfterDays.value !== null && ageDays > staleAfterDays.value,
      };
    });
};

/** 나이는 '오늘 올린 것'과 '한참 된 것'을 가르는 정보 — 0 을 '0일 전'으로 쓰면 잡음이 된다. */
const fmtAge = (days: number): string => (days === 0 ? '오늘' : `${String(days)}일 전`);
const fmtQty = (value: number | null): string => (value === null ? '—' : value.toLocaleString('ko-KR'));

const candidates = computed(() => {
  const list = (partnerData.value?.data.items ?? []).filter((p) => p.capabilities.includes('bom_rfq'));
  // 보유 건수 많은 곳 → 이름순. 보유 정보가 없으면 기존 순서 그대로.
  return props.partnerItems === undefined
    ? list
    : [...list].sort(
        (a, b) => holdingCount(b.partnerId) - holdingCount(a.partnerId) || a.name.localeCompare(b.name, 'ko'),
      );
});

const selected = ref<Set<number>>(new Set());
const quotedPartnerIds = computed(
  () => new Set(props.rfqs.filter((r) => r.status !== 'requested').map((r) => r.partnerId)),
);
const sentPartnerIds = computed(() => new Set(props.rfqs.map((r) => r.partnerId)));
const pendingRfqCount = computed(() => props.rfqs.filter((rfq) => rfq.status === 'requested').length);
const emptySelectionBlocked = computed(() => selected.value.size === 0 && pendingRfqCount.value === 0);
const selectedWithoutEmailCount = computed(
  () => candidates.value.filter((partner) => selected.value.has(partner.partnerId) && partner.contactEmail === null).length,
);
// 부분 행 선택(§6.13) — 품목 테이블 체크가 진실. 빈 배열=전체(itemIds 생략).
const partialSelection = computed(
  () => props.selectedItemIds.length > 0 && props.selectedItemIds.length < props.scopeItems.length,
);
const selectedRowsOpen = ref(false);
const selectedRows = computed(() => {
  const ids = new Set(props.selectedItemIds);
  return props.scopeItems.filter((item) => ids.has(item.id));
});

// 행 추가(§6.13 개정) — 이미 보낸 요청이 일부 행만 받았을 때, 이번 대상 행 중 빠진 것을 더할 수 있다.
// 서버가 합집합·null 정규화·회신 잠금을 다시 판단하고, 여기선 고를 수 있는 곳만 보여 준다.
const rfqByPartner = computed(() => new Map(props.rfqs.map((rfq) => [rfq.partnerId, rfq])));
const scopeIdList = computed(() => props.scopeItems.map((item) => item.id));
const targetItemIds = computed(() => (partialSelection.value ? props.selectedItemIds : scopeIdList.value));
/** 기존 요청에 없는 이번 대상 행 수 — 안 보냈거나 전체 요청(null)이면 0. */
const missingCount = (partnerId: number): number => {
  const rfq = rfqByPartner.value.get(partnerId);
  if (rfq?.requestedItemIds == null) return 0;
  const have = new Set(rfq.requestedItemIds);
  return targetItemIds.value.filter((id) => !have.has(id)).length;
};
const canExpand = (partnerId: number): boolean =>
  rfqByPartner.value.get(partnerId)?.status === 'requested' && missingCount(partnerId) > 0;
/** 부분 요청의 받은 범위 — '12/40행'. 전체 요청·미발송은 null. */
const coverageText = (partnerId: number): string | null => {
  const requested = rfqByPartner.value.get(partnerId)?.requestedItemIds ?? null;
  if (requested === null) return null;
  const scope = new Set(scopeIdList.value);
  return `${String(requested.filter((id) => scope.has(id)).length)}/${String(scopeIdList.value.length)}행`;
};

const expandSelected = ref<Set<number>>(new Set());
function toggleExpand(partnerId: number): void {
  const next = new Set(expandSelected.value);
  if (next.has(partnerId)) next.delete(partnerId);
  else next.add(partnerId);
  expandSelected.value = next;
}
// 발송 대상에서 뺐거나 더할 행이 사라진 곳(품목 선택이 바뀜)은 보내지 않는다.
const expandPartnerIds = computed(() =>
  [...expandSelected.value].filter((id) => selected.value.has(id) && canExpand(id)),
);

const submitLabel = computed(() => {
  if (selected.value.size > 0) {
    const expanding = expandPartnerIds.value.length;
    return expanding > 0
      ? `발송 (${String(selected.value.size)}곳 · 행 추가 ${String(expanding)}곳)`
      : `발송 (${String(selected.value.size)}곳)`;
  }
  return pendingRfqCount.value > 0 ? '미회신 요청 회수' : '협력사를 선택해 주세요';
});

const send = useSendBomRfqs();
const error = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    // 열 때 현재 발송 상태를 프리셋 — diff 의 기준 집합이 눈에 보이게. 행 추가는 늘 꺼진 채로 시작.
    selected.value = new Set(props.rfqs.map((r) => r.partnerId));
    expandSelected.value = new Set();
    selectedRowsOpen.value = false;
    pickRowsPending = false;
    error.value = '';
  },
  { immediate: true },
);

function toggle(partnerId: number): void {
  if (quotedPartnerIds.value.has(partnerId)) return; // 회신분 해제 금지
  const next = new Set(selected.value);
  if (next.has(partnerId)) next.delete(partnerId);
  else next.add(partnerId);
  selected.value = next;
}

// [품목 표에서 고르기] — 닫힘이 끝나 포커스 가둠·스크롤 잠금이 풀린 뒤(closeAutoFocus) 넘긴다.
// 닫히는 중에 바깥으로 포커스를 옮기면 가둠이 도로 끌어들인다.
let pickRowsPending = false;
function pickRows(): void {
  if (send.isPending.value) return;
  pickRowsPending = true;
  emit('close');
}
function onCloseAutoFocus(event: Event): void {
  if (!pickRowsPending) return;
  pickRowsPending = false;
  event.preventDefault();
  emit('pickRows');
}

async function submit(): Promise<void> {
  error.value = '';
  if (emptySelectionBlocked.value) {
    error.value = '견적요청을 보낼 협력사를 한 곳 이상 선택해 주세요.';
    return;
  }
  // 0곳 발송 = 미회신 요청 전부 회수(diff 수렴) — 버튼 문구("미회신 요청 회수")가 뜻을 말하므로
  // 별도 확인 없이 진행한다(사용자 결정).
  try {
    await send.mutateAsync({
      quoteId: props.quoteId,
      body: {
        partnerIds: [...selected.value],
        // 부분 선택일 때만 itemIds — 전체는 생략(=전체 파생, 이후 행 추가 자동 포함)
        ...(partialSelection.value ? { itemIds: [...props.selectedItemIds] } : {}),
        ...(expandPartnerIds.value.length > 0 ? { expandPartnerIds: expandPartnerIds.value } : {}),
      },
    });
    emit('sent');
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '발송에 실패했습니다.';
  }
}

const onOpenChange = (open: boolean): void => {
  if (!open && !send.isPending.value) emit('close');
};
</script>

<template>
  <Dialog :open="props.open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-lg" @close-auto-focus="onCloseAutoFocus">
      <DialogHeader>
        <DialogTitle>협력사 견적요청</DialogTitle>
        <DialogDescription>
          요청 부품행
          <b v-if="partialSelection" class="text-primary">선택 {{ props.selectedItemIds.length }}/{{ props.scopeItems.length }}행</b>
          <b v-else class="text-foreground">전체 {{ props.scopeItems.length }}행</b>
          · 선택한 협력사 집합으로 발송 상태를 맞춥니다(신규만 메일 발송, 이미 회신한 협력사는 해제할 수 없습니다).
        </DialogDescription>
      </DialogHeader>

      <!-- 행 선택은 품목 표에서(§6.13 — 편집 창구 단일). 여기선 확인과 그 자리로 가는 길만 -->
      <Alert v-if="partialSelection" variant="info" size="sm">
        <AlertDescription>
          <p>
            선택한 행은 <b>새로 발송하는</b> 협력사에 적용됩니다. 이미 보낸 미회신 협력사에는 <b>행 추가</b>를 켠 곳만
            더해집니다.
          </p>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            <Button
              variant="outline"
              size="xs"
              :aria-expanded="selectedRowsOpen"
              @click="selectedRowsOpen = !selectedRowsOpen"
            >
              선택 {{ selectedRows.length }}행 보기
              <ChevronUpIcon v-if="selectedRowsOpen" />
              <ChevronDownIcon v-else />
            </Button>
            <Button variant="outline" size="xs" :disabled="send.isPending.value" @click="pickRows">
              <ListChecksIcon />
              품목 표에서 바꾸기
            </Button>
          </div>
          <ul
            v-if="selectedRowsOpen"
            class="bg-background mt-1.5 max-h-40 overflow-y-auto rounded-md px-2 py-1"
            data-testid="rfq-send-selected-rows"
          >
            <li v-for="item in selectedRows" :key="item.id" class="flex gap-2 py-0.5 text-xs">
              <span class="min-w-0 flex-1 truncate font-mono">{{ item.mpn === '' ? '(품번 없음)' : item.mpn }}</span>
              <span class="text-muted-foreground min-w-0 max-w-40 truncate">{{ item.manufacturerName ?? '' }}</span>
            </li>
          </ul>
        </AlertDescription>
      </Alert>
      <Alert v-else variant="info" size="sm">
        <AlertDescription>
          <p>품목 표의 <b>RFQ</b> 칸을 체크하면 일부 행만 보낼 수 있습니다(저항·캐패시터 제외, 구매 조건 없음 빠른 선택).</p>
          <Button variant="outline" size="xs" class="mt-1.5" :disabled="send.isPending.value" @click="pickRows">
            <ListChecksIcon />
            품목 표에서 고르기
          </Button>
        </AlertDescription>
      </Alert>

      <DialogScrollBody>
        <p v-if="isFetching && candidates.length === 0" class="text-muted-foreground flex items-center justify-center gap-2 py-6 text-sm">
          <Spinner />
          불러오는 중…
        </p>
        <p v-else-if="candidates.length === 0" class="text-muted-foreground py-6 text-center text-sm">
          승인된 협력사(BOM 견적 트랙)가 없습니다 —
          <RouterLink :to="{ name: 'admin-partners' }" class="text-primary font-medium hover:underline">파트너 관리</RouterLink>에서
          등록하세요.
        </p>
        <ul v-else class="divide-y rounded-lg border">
          <li v-for="p in candidates" :key="p.partnerId" :class="quotedPartnerIds.has(p.partnerId) ? 'opacity-70' : ''">
            <div class="flex items-center gap-2 px-3 py-2">
              <Checkbox
                :id="`${idPrefix}-p${p.partnerId}`"
                :model-value="selected.has(p.partnerId)"
                :disabled="quotedPartnerIds.has(p.partnerId)"
                @update:model-value="toggle(p.partnerId)"
              />
              <label
                :for="`${idPrefix}-p${p.partnerId}`"
                class="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium"
              >{{ p.name }}</label>
              <!-- 배지는 체크 토글이 아니라 펼치기다 -->
              <Button
                v-if="holdingCount(p.partnerId) > 0"
                variant="outline"
                size="xs"
                :aria-expanded="expanded.has(p.partnerId)"
                title="눌러서 어느 행을 얼마나 보유하고 있는지 펼쳐 봅니다"
                @click="toggleExpanded(p.partnerId)"
              >
                보유 {{ holdingCount(p.partnerId) }}행
                <ChevronUpIcon v-if="expanded.has(p.partnerId)" />
                <ChevronDownIcon v-else />
              </Button>
              <Badge v-if="p.contactEmail === null" variant="warning">메일 없음</Badge>
              <Badge
                v-if="coverageText(p.partnerId) !== null"
                variant="outline"
                class="tabular-nums"
                title="이 협력사가 받은 요청 행 / 현재 요청 가능 행"
              >
                {{ coverageText(p.partnerId) }}
              </Badge>
              <Badge v-if="quotedPartnerIds.has(p.partnerId)" variant="success">회신됨</Badge>
              <Badge v-else-if="sentPartnerIds.has(p.partnerId)" variant="info">발송됨</Badge>
            </div>

            <!-- 행 추가 — 일부 행만 받은 미회신 요청에 이번 대상 행 중 빠진 것을 더한다(줄이지는 않는다) -->
            <div
              v-if="canExpand(p.partnerId)"
              class="flex items-center gap-2 border-t border-dashed py-1.5 pr-3 pl-9 text-xs"
              data-testid="rfq-send-expand"
            >
              <Checkbox
                :id="`${idPrefix}-x${p.partnerId}`"
                :model-value="expandSelected.has(p.partnerId)"
                :disabled="!selected.has(p.partnerId)"
                @update:model-value="toggleExpand(p.partnerId)"
              />
              <label :for="`${idPrefix}-x${p.partnerId}`" class="cursor-pointer font-medium">
                {{ partialSelection ? '선택 행 중' : '나머지' }} {{ missingCount(p.partnerId) }}행을 기존 요청에 추가
              </label>
              <span class="text-muted-foreground ml-auto">품목 추가 메일 발송</span>
            </div>
            <p
              v-else-if="partialSelection && quotedPartnerIds.has(p.partnerId) && missingCount(p.partnerId) > 0"
              class="text-muted-foreground border-t border-dashed py-1.5 pr-3 pl-9 text-xs"
            >
              회신을 받은 요청이라 행을 더할 수 없습니다.
            </p>

            <div v-if="expanded.has(p.partnerId)" class="bg-muted/40 border-t px-3 py-2">
              <ul class="flex flex-col gap-1">
                <li v-for="row in heldRows(p.partnerId)" :key="row.itemId" class="flex items-center gap-2 text-xs">
                  <span class="min-w-0 flex-1 truncate font-mono">{{ row.mpn }}</span>
                  <span class="text-muted-foreground tabular-nums">재고 {{ fmtQty(row.stockQty) }}</span>
                  <span v-if="row.dateCode !== null" class="text-muted-foreground">D/C {{ row.dateCode }}</span>
                  <!-- 재고는 협력사의 주장이고 만료를 두지 않는다 — 나이를 늘 함께 보인다 -->
                  <span
                    v-if="row.ageDays !== null"
                    :class="row.stale ? 'text-warning font-semibold' : 'text-muted-foreground'"
                    :title="row.stale ? '오래된 재고표입니다 — 수량을 그대로 믿지 마세요' : '재고표 업로드 이후 지난 날수'"
                  >{{ fmtAge(row.ageDays) }}</span>
                </li>
              </ul>
              <p class="text-muted-foreground mt-1.5 text-xs">
                협력사가 스스로 올린 재고표입니다 — 수량·납기는 견적 회신이 정본입니다.
              </p>
            </div>
          </li>
        </ul>
      </DialogScrollBody>

      <Alert v-if="selectedWithoutEmailCount > 0" variant="warning" size="sm">
        <AlertDescription>
          메일이 없는 협력사 {{ selectedWithoutEmailCount }}곳은 포털 요청과 회신 링크만 생성되며 이메일은 발송되지 않습니다.
        </AlertDescription>
      </Alert>
      <Alert v-if="error !== ''" variant="destructive" size="sm">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="outline" :disabled="send.isPending.value" @click="emit('close')">취소</Button>
        <Button :disabled="send.isPending.value || emptySelectionBlocked" @click="void submit()">
          <Spinner v-if="send.isPending.value" />
          {{ submitLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
