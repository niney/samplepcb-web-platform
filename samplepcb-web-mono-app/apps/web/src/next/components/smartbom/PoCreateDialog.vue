<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AdminBomPoViewType, AdminBomRfqViewType, BomQuoteItemType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useCreateBomPos } from '@/admin/useAdminBomPos';
import { useAdminPartnerList, type AdminPartnerFilters } from '@/admin/useAdminPartners';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
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
import { Empty, EmptyDescription } from '@/next/components/ui/empty';
import { Field, FieldContent, FieldLabel, FieldTitle } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';

// 발주서 생성(D18·D20) — 옛 components/admin/smartbom/BomPoCreateModal.vue 의 짝(같은 props·emits).
// 협력사 회신 선정 행 + 공급사 구매 조건 선정 행을 조직별로 미리보고 선택 발행한다. 미리보기는 표시용
// 클라 파생이고 실제 대상·금액은 서버가 재집계·박제한다. mouser·digikey 는 발행 시 자동 실행(카트/리스트),
// 기타 공급사는 발주서만(수동 진행), 파트너 조직에 매핑 안 되는 supplier 는 대상 외로 안내한다.
const props = defineProps<{
  open: boolean;
  quoteId: string;
  scopeItems: BomQuoteItemType[];
  rfqs: AdminBomRfqViewType[];
  existingPos: AdminBomPoViewType[];
}>();
const emit = defineEmits<{ close: [] }>();

const AUTOMATED = new Set(['mouser', 'digikey']);

interface DraftLine {
  mpn: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  noSku?: boolean; // 공급사 발주인데 SKU 없음 — 자동 실행에서 제외됨
}
interface DraftGroup {
  partnerId: number;
  partnerName: string;
  kind: 'partner' | 'supplier-auto' | 'supplier-manual';
  lines: DraftLine[];
  total: number;
  alreadyIssued: boolean;
}

// 공급사 조직(supplierCode → partnerId) — 시드 조직 조회(D20 매핑).
const supplierFilters = ref<AdminPartnerFilters>({
  page: 1,
  pageSize: 100,
  tab: 'approved',
  type: 'supplier',
  q: '',
});
const { data: supplierData } = useAdminPartnerList(supplierFilters);
const supplierPartners = computed(() => {
  const map = new Map<string, { partnerId: number; name: string }>();
  for (const partner of supplierData.value?.data.items ?? []) {
    if (partner.supplierCode !== null) {
      map.set(partner.supplierCode, { partnerId: partner.partnerId, name: partner.name });
    }
  }
  return map;
});

// rfqItemId → 협력사 매핑(선정 offerKey 'rfq:{id}' 역참조)
const partnerByRfqItem = computed(() => {
  const map = new Map<number, { partnerId: number; partnerName: string }>();
  for (const rfq of props.rfqs) {
    for (const item of rfq.items) {
      map.set(item.rfqItemId, { partnerId: rfq.partnerId, partnerName: rfq.partnerName });
    }
  }
  return map;
});

const issuedPartnerIds = computed(() => new Set(props.existingPos.map((po) => po.partnerId)));

const groups = computed<DraftGroup[]>(() => {
  const byPartner = new Map<number, DraftGroup>();
  const push = (key: number, name: string, kind: DraftGroup['kind'], line: DraftLine): void => {
    const group = byPartner.get(key) ?? {
      partnerId: key,
      partnerName: name,
      kind,
      lines: [],
      total: 0,
      alreadyIssued: issuedPartnerIds.value.has(key),
    };
    group.lines.push(line);
    group.total += line.lineTotal;
    byPartner.set(key, group);
  };

  for (const item of props.scopeItems) {
    if (!item.included) continue;
    const offer = item.selectedOffer;
    const offerKey = offer?.offerKey ?? null;
    const qty = Math.max(1, item.orderQty);
    const mpn = item.mpn === '' ? '품번 미기재' : item.mpn;

    // ① 협력사 회신 선정(D18)
    if (offerKey?.startsWith('rfq:') === true) {
      const partner = partnerByRfqItem.value.get(Number(offerKey.slice(4)));
      if (partner === undefined) continue;
      const unitPrice = offer?.unitPrice ?? 0;
      push(partner.partnerId, partner.partnerName, 'partner', {
        mpn,
        qty,
        unitPrice,
        lineTotal: Math.round(unitPrice * qty),
      });
      continue;
    }

    // ② 공급사 구매 조건 선정(D20) — 파트너 조직 매핑되는 supplier 만(단가 = KRW 환산 박제)
    if (offer === null) continue;
    const supplierPartner = supplierPartners.value.get(offer.supplier);
    if (supplierPartner === undefined) continue;
    const unitPrice = offer.unitPriceKrw ?? 0;
    push(supplierPartner.partnerId, supplierPartner.name, AUTOMATED.has(offer.supplier) ? 'supplier-auto' : 'supplier-manual', {
      mpn,
      qty,
      unitPrice,
      lineTotal: Math.round(unitPrice * qty),
      ...(offer.supplierSku === '' ? { noSku: true } : {}),
    });
  }
  return [...byPartner.values()];
});

// 대상 외 — 파트너 조직에 매핑 안 되는 supplier(제조사 카탈로그 등, 수동 처리 안내)
const externalSummary = computed(() => {
  const bySupplier = new Map<string, number>();
  for (const item of props.scopeItems) {
    const offer = item.selectedOffer;
    if (!item.included || offer === null || (offer.offerKey ?? '').startsWith('rfq:')) continue;
    if (supplierPartners.value.has(offer.supplier)) continue;
    bySupplier.set(offer.supplier, (bySupplier.get(offer.supplier) ?? 0) + 1);
  }
  return [...bySupplier.entries()].map(([supplier, count]) => ({ supplier, count }));
});

const selected = ref<Set<number>>(new Set());
const memo = ref('');
const error = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    // 미발행 그룹 전부 기본 선택
    selected.value = new Set(groups.value.filter((g) => !g.alreadyIssued).map((g) => g.partnerId));
    memo.value = '';
    error.value = '';
  },
);

function toggle(partnerId: number): void {
  const group = groups.value.find((g) => g.partnerId === partnerId);
  if (group?.alreadyIssued === true) return;
  const next = new Set(selected.value);
  if (next.has(partnerId)) next.delete(partnerId);
  else next.add(partnerId);
  selected.value = next;
}

const create = useCreateBomPos();

async function submit(): Promise<void> {
  error.value = '';
  if (selected.value.size === 0) {
    error.value = '발주할 협력사를 1곳 이상 선택해 주세요.';
    return;
  }
  try {
    await create.mutateAsync({
      quoteId: props.quoteId,
      body: {
        partnerIds: [...selected.value],
        memo: memo.value.trim() === '' ? null : memo.value.trim(),
      },
    });
    emit('close');
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '발주서 생성에 실패했습니다.';
  }
}

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};

const fmt = (v: number): string => v.toLocaleString('ko-KR');
const groupId = (partnerId: number): string => `next-po-create-${String(partnerId)}`;
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>발주서 생성</DialogTitle>
        <DialogDescription>
          협력사 회신 선정 행과 공급사 구매 조건 선정 행을 조직별로 발주합니다 — 발주서는 생성 시점 스냅샷으로
          박제(금액 VAT 별도). 협력사는 메일 알림, mouser·digikey 는 발행 즉시 카트 담기/리스트 생성이 자동
          실행됩니다(실결제는 공급사 사이트에서).
        </DialogDescription>
      </DialogHeader>

      <DialogScrollBody>
        <div class="flex flex-col gap-2">
          <Empty v-if="groups.length === 0">
            <EmptyDescription>
              발주 가능한 선정 구매조건이 없습니다 — 협력사 회신 또는 공급사 구매조건을 선정하면 발주 대상이 됩니다.
            </EmptyDescription>
          </Empty>
          <FieldLabel v-for="group in groups" :key="group.partnerId" :for="groupId(group.partnerId)">
            <Field orientation="horizontal" :data-disabled="group.alreadyIssued ? 'true' : undefined">
              <Checkbox
                :id="groupId(group.partnerId)"
                :model-value="selected.has(group.partnerId)"
                :disabled="group.alreadyIssued"
                @update:model-value="toggle(group.partnerId)"
              />
              <FieldContent>
                <FieldTitle class="w-full">
                  <span class="flex w-full flex-wrap items-center gap-2">
                    <span>{{ group.partnerName }}</span>
                    <Badge v-if="group.kind === 'supplier-auto'" variant="info">발행 시 자동 실행</Badge>
                    <Badge v-else-if="group.kind === 'supplier-manual'" variant="secondary">수동 진행</Badge>
                    <Badge v-if="group.alreadyIssued" variant="secondary">발행됨</Badge>
                    <span class="text-muted-foreground ml-auto text-xs font-normal">
                      {{ group.lines.length }}개 품목 · <b class="text-foreground tabular-nums">{{ fmt(group.total) }}원</b> (VAT 별도)
                    </span>
                  </span>
                </FieldTitle>
                <ul class="text-muted-foreground flex w-full flex-col gap-0.5 text-xs">
                  <li v-for="line in group.lines" :key="line.mpn + String(line.qty)" class="flex justify-between gap-2">
                    <span class="flex min-w-0 items-center gap-1">
                      <span class="truncate">{{ line.mpn }}</span>
                      <Badge v-if="line.noSku === true" variant="warning" title="SKU 가 없어 자동 실행에서 제외됩니다">SKU 없음</Badge>
                    </span>
                    <span class="whitespace-nowrap tabular-nums">
                      {{ fmt(line.qty) }} × {{ fmt(line.unitPrice) }} = {{ fmt(line.lineTotal) }}원
                    </span>
                  </li>
                </ul>
              </FieldContent>
            </Field>
          </FieldLabel>

          <Alert v-if="externalSummary.length > 0" variant="warning" size="sm">
            <AlertTitle>발주 대상 외(파트너 조직 미매핑 — 수동 처리)</AlertTitle>
            <AlertDescription>
              <p>
                <span v-for="entry in externalSummary" :key="entry.supplier" class="mr-2">{{ entry.supplier }} {{ entry.count }}종</span>
              </p>
              <p class="text-xs">
                공급사 조직을
                <RouterLink :to="{ name: 'admin-partners' }" class="font-medium underline">파트너 관리</RouterLink>에
                등록(supplierCode)하면 발주 대상이 됩니다.
              </p>
            </AlertDescription>
          </Alert>

          <Field class="mt-1">
            <FieldLabel for="next-po-create-memo">발주 메모(협력사에게 표시 — 선택)</FieldLabel>
            <Input id="next-po-create-memo" v-model="memo" type="text" maxlength="2000" placeholder="예: 납기 준수 부탁드립니다" />
          </Field>

          <Alert v-if="error !== ''" variant="destructive" size="sm">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
        </div>
      </DialogScrollBody>

      <DialogFooter>
        <Button variant="outline" @click="emit('close')">취소</Button>
        <Button :disabled="create.isPending.value || groups.length === 0 || selected.size === 0" @click="submit">
          발주서 발행 ({{ selected.size }}곳)
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
