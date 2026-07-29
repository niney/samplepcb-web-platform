<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AdminBomPoViewType, AdminBomRfqViewType, BomQuoteItemType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { useCreateBomPos } from '../../../admin/useAdminBomPos';

// 발주서 생성 모달(D18) — 협력사 회신 선정 행을 협력사별로 미리보고 선택 발행.
// 미리보기는 클라 파생(표시용)이고, 실제 대상·금액은 서버가 재집계·박제한다.
// 공급사/카탈로그 선정 행은 발주서 대상이 아니라 "외부 구매 목록"으로 요약만(자동화 후속).

const props = defineProps<{
  open: boolean;
  quoteId: string;
  scopeItems: BomQuoteItemType[];
  rfqs: AdminBomRfqViewType[];
  existingPos: AdminBomPoViewType[];
}>();
const emit = defineEmits<{ close: [] }>();

interface DraftLine {
  mpn: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}
interface DraftGroup {
  partnerId: number;
  partnerName: string;
  lines: DraftLine[];
  total: number;
  alreadyIssued: boolean;
}

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
  for (const item of props.scopeItems) {
    const offerKey = item.selectedOffer?.offerKey ?? null;
    if (!item.included || !offerKey?.startsWith('rfq:')) continue;
    const rfqItemId = Number(offerKey.slice(4));
    const partner = partnerByRfqItem.value.get(rfqItemId);
    if (partner === undefined) continue;
    const unitPrice = item.selectedOffer?.unitPrice ?? 0;
    const qty = Math.max(1, item.orderQty);
    const line: DraftLine = {
      mpn: item.mpn === '' ? '품번 미기재' : item.mpn,
      qty,
      unitPrice,
      lineTotal: Math.round(unitPrice * qty),
    };
    const group = byPartner.get(partner.partnerId) ?? {
      partnerId: partner.partnerId,
      partnerName: partner.partnerName,
      lines: [],
      total: 0,
      alreadyIssued: issuedPartnerIds.value.has(partner.partnerId),
    };
    group.lines.push(line);
    group.total += line.lineTotal;
    byPartner.set(partner.partnerId, group);
  }
  return [...byPartner.values()];
});

// 외부 구매 목록 — 공급사/카탈로그 선정 행(발주서 미생성, 수동/자동화 후속)
const externalSummary = computed(() => {
  const bySupplier = new Map<string, number>();
  for (const item of props.scopeItems) {
    const offer = item.selectedOffer;
    if (!item.included || offer === null || (offer.offerKey ?? '').startsWith('rfq:')) continue;
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
    selected.value = new Set(
      groups.value.filter((g) => !g.alreadyIssued).map((g) => g.partnerId),
    );
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

const fmt = (v: number): string => v.toLocaleString('ko-KR');
</script>

<template>
  <div v-if="open" class="fixed inset-0 z-40 grid place-items-center bg-black/30 p-4" @click.self="emit('close')">
    <div class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-surface p-6 shadow-2xl">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold">발주서 생성</h2>
        <button type="button" class="text-gray-400 hover:text-gray-700" @click="emit('close')">✕</button>
      </div>
      <p class="mt-1 text-xs text-gray-500">
        협력사 회신으로 선정된 부품행을 협력사별로 발주합니다 — 발주서는 생성 시점 스냅샷으로
        박제되며(금액 VAT 별도), 발행 시 협력사에 메일이 갑니다.
      </p>

      <div class="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto">
        <p v-if="groups.length === 0" class="rounded-lg border border-dashed border-gray-200 px-4 py-6 text-center text-xs text-gray-400">
          협력사 회신으로 선정된 부품행이 없습니다 — 비교·선정에서 협력사 회신을 선정하면 발주 대상이 됩니다.
        </p>
        <label
          v-for="group in groups"
          :key="group.partnerId"
          class="block cursor-pointer rounded-xl border px-4 py-3"
          :class="group.alreadyIssued ? 'border-gray-100 opacity-60' : selected.has(group.partnerId) ? 'border-emerald-300 bg-emerald-50/40' : 'border-gray-200 hover:bg-gray-50'"
        >
          <div class="flex items-center gap-2">
            <input
              type="checkbox"
              class="size-4"
              :checked="selected.has(group.partnerId)"
              :disabled="group.alreadyIssued"
              @change="toggle(group.partnerId)"
            >
            <span class="font-semibold text-gray-900">{{ group.partnerName }}</span>
            <span v-if="group.alreadyIssued" class="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">발행됨</span>
            <span class="ml-auto text-xs text-gray-500">
              {{ group.lines.length }}개 품목 · <b class="tabular-nums">{{ fmt(group.total) }}원</b> (VAT 별도)
            </span>
          </div>
          <ul class="mt-2 space-y-0.5 text-[11px] text-gray-500">
            <li v-for="line in group.lines" :key="line.mpn + String(line.qty)" class="flex justify-between gap-2">
              <span class="truncate">{{ line.mpn }}</span>
              <span class="whitespace-nowrap tabular-nums">{{ fmt(line.qty) }} × {{ fmt(line.unitPrice) }} = {{ fmt(line.lineTotal) }}원</span>
            </li>
          </ul>
        </label>

        <div v-if="externalSummary.length > 0" class="rounded-xl border border-amber-200 bg-amber-50/50 px-4 py-3 text-xs text-amber-800">
          <p class="font-bold">외부 구매 목록(발주서 미생성 — 수동 처리)</p>
          <p class="mt-1">
            <span v-for="entry in externalSummary" :key="entry.supplier" class="mr-2">
              {{ entry.supplier }} {{ entry.count }}종
            </span>
          </p>
          <p class="mt-1 text-[10px] text-amber-600">공급사 자동 발주(카트 담기·리스트)는 후속 단계입니다.</p>
        </div>
      </div>

      <label class="mt-3 block text-xs text-gray-500">발주 메모(협력사에게 표시 — 선택)
        <input v-model="memo" type="text" maxlength="2000" class="mt-1 h-9 w-full rounded-lg border border-gray-300 px-3 text-xs" placeholder="예: 납기 준수 부탁드립니다">
      </label>

      <p v-if="error !== ''" class="mt-2 text-xs font-semibold text-red-600">{{ error }}</p>
      <div class="mt-4 flex justify-end gap-2">
        <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-xs font-bold hover:bg-gray-50" @click="emit('close')">
          취소
        </button>
        <button
          type="button"
          class="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          :disabled="create.isPending.value || groups.length === 0"
          @click="submit"
        >
          발주서 발행 ({{ selected.size }}곳)
        </button>
      </div>
    </div>
  </div>
</template>
