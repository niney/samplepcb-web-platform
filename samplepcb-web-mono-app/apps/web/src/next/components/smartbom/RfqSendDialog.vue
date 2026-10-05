<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue';
import { ChevronDownIcon, ChevronUpIcon } from '@lucide/vue';
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
// 부분 행 선택(§6.13)은 품목 표에서 하고(selectedItemIds, 빈 배열=전체) 여기서는 요약·확인만 한다.

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
const emit = defineEmits<{ close: []; sent: [] }>();

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
const submitLabel = computed(() => {
  if (selected.value.size > 0) return `발송 (${String(selected.value.size)}곳)`;
  return pendingRfqCount.value > 0 ? '미회신 요청 회수' : '협력사를 선택해 주세요';
});

// 부분 행 선택(§6.13) — 품목 테이블 체크가 진실. 빈 배열=전체(itemIds 생략).
const partialSelection = computed(
  () => props.selectedItemIds.length > 0 && props.selectedItemIds.length < props.scopeItems.length,
);

const send = useSendBomRfqs();
const error = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    // 열 때 현재 발송 상태를 프리셋 — diff 의 기준 집합이 눈에 보이게.
    selected.value = new Set(props.rfqs.map((r) => r.partnerId));
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
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>협력사 견적요청</DialogTitle>
        <DialogDescription>
          요청 부품행
          <b v-if="partialSelection" class="text-primary">선택 {{ props.selectedItemIds.length }}/{{ props.scopeItems.length }}행</b>
          <b v-else class="text-foreground">전체 {{ props.scopeItems.length }}행</b>
          · 선택한 협력사 집합으로 발송 상태를 맞춥니다(신규만 메일 발송, 이미 회신한 협력사는 해제할 수 없습니다).
        </DialogDescription>
      </DialogHeader>

      <!-- 행 선택은 품목 표에서(§6.13 — 편집 창구 단일). 여기선 확인만 -->
      <Alert v-if="partialSelection" variant="info" size="sm">
        <AlertDescription>
          부분 선택은 이번에 <b>새로 발송되는</b> 협력사에게만 적용됩니다 — 행 변경은 품목 표에서.
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
              <Badge v-if="quotedPartnerIds.has(p.partnerId)" variant="success">회신됨</Badge>
              <Badge v-else-if="sentPartnerIds.has(p.partnerId)" variant="info">발송됨</Badge>
            </div>

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
