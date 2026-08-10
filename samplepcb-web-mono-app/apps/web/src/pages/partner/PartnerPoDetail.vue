<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_PO_SHORTAGE_REASONS,
  BOM_PO_SHORTAGE_REASON_LABELS,
  BOM_SHIPMENT_MODE_LABELS,
  bomShipmentStatusLabel,
  type BomPoShortageReasonType,
  type PartnerPoDetailType,
} from '@sp/api-contract';
import {
  usePartnerPoShortageCancel,
  usePartnerPoConfirm,
  usePartnerPoDetail,
  usePartnerPoShortageReport,
  usePartnerPoShortageUpdate,
} from '../../partner/usePartnerRfqs';
import { partnerPoDisplayStatus } from '../../partner/partnerPoStatus';
import { fmtKstDate } from '@sp/utils';
import { confirmDialog } from '../../lib/confirmDialog';

// 파트너 포털 발주서 상세(D18·§6.11 축소) — 문서 열람 전용: 박제 품목·금액 + [발주 확인].
// 발송(선적) 작업은 홈의 [📦 보내기]·진행 중 발송 카드가 담당한다 — 여기엔 소속 안내만.

const route = useRoute();
const poId = computed(() => {
  const raw = route.params.id;
  return typeof raw === 'string' && raw !== '' ? raw : null;
});

const detailQuery = usePartnerPoDetail(poId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const confirmMut = usePartnerPoConfirm();
const shortageMut = usePartnerPoShortageReport();
const shortageUpdateMut = usePartnerPoShortageUpdate();
const shortageCancelMut = usePartnerPoShortageCancel();
const error = ref('');
type PartnerPoItem = PartnerPoDetailType['items'][number];
const shortageItem = ref<PartnerPoItem | null>(null);
const shortageQty = ref(1);
const shortageReason = ref<BomPoShortageReasonType>('insufficient_stock');
const shortageNote = ref('');
const shortageError = ref('');

async function confirmPo(): Promise<void> {
  if (poId.value === null) return;
  error.value = '';
  try {
    await confirmMut.mutateAsync(poId.value);
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '확인 처리에 실패했습니다.';
  }
}

function openShortage(item: PartnerPoItem): void {
  shortageItem.value = item;
  shortageQty.value = item.shortage?.shortageQty ?? 1;
  shortageReason.value = item.shortage?.reason ?? 'insufficient_stock';
  shortageNote.value = item.shortage?.note ?? '';
  shortageError.value = '';
}

function closeShortage(): void {
  if (shortageBusy.value) return;
  shortageItem.value = null;
  shortageError.value = '';
}

const shortageBusy = computed(
  () =>
    shortageMut.isPending.value ||
    shortageUpdateMut.isPending.value ||
    shortageCancelMut.isPending.value,
);

async function submitShortage(): Promise<void> {
  const item = shortageItem.value;
  if (item === null || poId.value === null) return;
  if (!Number.isInteger(shortageQty.value) || shortageQty.value < 1 || shortageQty.value > item.qty) {
    shortageError.value = `부족 수량은 1~${fmt(item.qty)}개로 입력해 주세요.`;
    return;
  }
  shortageError.value = '';
  try {
    const body = {
      shortageQty: shortageQty.value,
      reason: shortageReason.value,
      note: shortageNote.value.trim() === '' ? null : shortageNote.value.trim(),
    };
    if (item.shortage === null) {
      await shortageMut.mutateAsync({
        poId: poId.value,
        body: {
          poItemId: item.poItemId,
          ...body,
        },
      });
    } else {
      await shortageUpdateMut.mutateAsync({
        poId: poId.value,
        shortageId: item.shortage.shortageId,
        body,
      });
    }
    shortageItem.value = null;
  } catch (e) {
    shortageError.value =
      e instanceof ApiRequestError
        ? e.message
        : item.shortage === null
          ? '공급 부족 신고에 실패했습니다.'
          : '공급 부족 신고 수정에 실패했습니다.';
  }
}

async function cancelShortage(item: PartnerPoItem): Promise<void> {
  if (poId.value === null || item.shortage === null || shortageBusy.value) return;
  if (
    !(await confirmDialog({
      title: '공급 부족 신고를 취소할까요?',
      message: `${item.mpn || '품번 미기재'}의 부족 ${fmt(item.shortage.shortageQty)}개 신고를 취소합니다. 취소 후 다시 신고할 수 있습니다.`,
      confirmLabel: '신고 취소',
      tone: 'danger',
    }))
  ) {
    return;
  }
  error.value = '';
  try {
    await shortageCancelMut.mutateAsync({
      poId: poId.value,
      shortageId: item.shortage.shortageId,
    });
  } catch (e) {
    error.value = e instanceof ApiRequestError ? e.message : '공급 부족 신고 취소에 실패했습니다.';
  }
}

const shipment = computed(() => detail.value?.shipment ?? null);

// 배지 = 협력사 관점 상태 — 관리자 문서 상태(마감 등)를 그대로 노출하지 않는다
const badge = computed(() =>
  detail.value === null
    ? null
    : partnerPoDisplayStatus({
        poStatus: detail.value.status,
        attached: shipment.value !== null,
        shipmentMode: shipment.value?.mode ?? null,
        shipmentStatus: shipment.value?.status ?? null,
        received: (shipment.value?.receivedAt ?? null) !== null,
      }),
);

const fmt = (v: number): string => v.toLocaleString('ko-KR');
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'partner-bom' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 홈
      </RouterLink>
      <template v-if="detail !== null">
        <h1 class="text-xl font-bold">발주서 — {{ detail.quoteTitle }}</h1>
        <span v-if="badge !== null" class="rounded px-2 py-0.5 text-xs font-semibold" :class="badge.cls">
          {{ badge.label }}
        </span>
      </template>
    </div>

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p v-else-if="detail === null" class="text-sm text-gray-400">발주서를 찾을 수 없습니다.</p>

    <template v-else>
      <p class="text-sm text-gray-500">
        발행 {{ fmtKstDate(detail.issuedAt) }}
        <template v-if="detail.confirmedAt !== null"> · 확인 {{ fmtKstDate(detail.confirmedAt) }}</template>
      </p>
      <p v-if="detail.memo !== null" class="rounded bg-gray-50 px-3 py-2 text-sm text-gray-600">{{ detail.memo }}</p>
      <p
        v-if="detail.status === 'confirmed' && shipment === null"
        class="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800"
      >
        실제 공급할 수 없는 수량이 있으면 발송에 담기 전에 품목별로 신고해 주세요. 원 발주서는
        보존되고 SamplePCB가 부족분 대체발주를 진행합니다.
      </p>

      <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface">
        <table class="min-w-full divide-y divide-gray-100 text-sm">
          <thead class="bg-gray-50 text-left text-gray-500">
            <tr>
              <th class="px-3 py-2">부품</th>
              <th class="px-3 py-2 text-right">수량</th>
              <th class="px-3 py-2 text-right">단가(KRW)</th>
              <th class="px-3 py-2 text-right">금액</th>
              <th class="px-3 py-2">공급 상태</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-50">
            <tr v-for="item in detail.items" :key="item.poItemId">
              <td class="px-3 py-2">
                <div class="font-medium">{{ item.mpn === '' ? '품번 미기재' : item.mpn }}</div>
                <div class="text-gray-400">{{ item.manufacturerName ?? item.description ?? '' }}</div>
              </td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.qty) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.unitPrice) }}</td>
              <td class="whitespace-nowrap px-3 py-2 text-right tabular-nums">{{ fmt(item.lineTotal) }}원</td>
              <td class="min-w-48 px-3 py-2 text-xs">
                <template v-if="item.shortage !== null">
                  <p class="font-bold text-red-700">
                    {{ BOM_PO_SHORTAGE_REASON_LABELS[item.shortage.reason] }} · 부족 {{ fmt(item.shortage.shortageQty) }}개
                  </p>
                  <p class="mt-0.5 text-gray-600">실제 공급 {{ fmt(item.shortage.suppliedQty) }}/{{ fmt(item.qty) }}개</p>
                  <p class="mt-0.5 font-semibold text-gray-700">실제 공급 금액 {{ fmt(item.shortage.suppliedAmount) }}원</p>
                  <p v-if="item.shortage.note !== null" class="mt-0.5 text-gray-400">{{ item.shortage.note }}</p>
                  <p v-if="item.shortage.recovery === null" class="mt-1 font-semibold text-amber-700">SamplePCB 대체발주 대기</p>
                  <p v-else class="mt-1 font-semibold text-emerald-700">
                    {{ item.shortage.recovery.partnerName }} 대체발주 완료 · {{ fmt(item.shortage.recovery.qty) }}개
                  </p>
                  <div
                    v-if="item.shortage.recovery === null && detail.status === 'confirmed' && shipment === null"
                    class="mt-2 flex flex-wrap gap-1.5"
                  >
                    <button
                      type="button"
                      class="rounded border border-amber-300 px-2 py-1 font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-40"
                      :disabled="shortageBusy"
                      @click="openShortage(item)"
                    >
                      신고 수정
                    </button>
                    <button
                      type="button"
                      class="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                      :disabled="shortageBusy"
                      @click="cancelShortage(item)"
                    >
                      신고 취소
                    </button>
                  </div>
                </template>
                <template v-else-if="item.recoverySource !== null">
                  <span class="rounded bg-indigo-100 px-1.5 py-0.5 font-bold text-indigo-700">부족분 대체발주</span>
                  <p class="mt-1 text-gray-500">{{ item.recoverySource.sourcePartnerName }} 미공급 {{ fmt(item.recoverySource.shortageQty) }}개</p>
                </template>
                <button
                  v-else-if="detail.status === 'confirmed' && shipment === null"
                  type="button"
                  class="rounded border border-amber-300 px-2 py-1 font-semibold text-amber-800 hover:bg-amber-50"
                  @click="openShortage(item)"
                >
                  공급 부족 신고
                </button>
                <span v-else class="text-gray-300">—</span>
              </td>
            </tr>
          </tbody>
          <tfoot class="bg-gray-50">
            <tr>
              <td colspan="3" class="px-3 py-2 text-right font-bold">발주 문서 합계 (VAT 별도)</td>
              <td class="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums">
                {{ fmt(detail.totalAmount) }}원
              </td>
              <td />
            </tr>
            <tr v-if="detail.actualSupplyAmount !== detail.totalAmount" class="border-t border-amber-100 bg-amber-50">
              <td colspan="3" class="px-3 py-2 text-right font-bold text-amber-900">실제 공급 합계 (VAT 별도)</td>
              <td class="whitespace-nowrap px-3 py-2 text-right font-bold tabular-nums text-amber-900">
                {{ fmt(detail.actualSupplyAmount) }}원
              </td>
              <td class="px-3 py-2 text-[10px] text-amber-700">부족분 제외</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div
        v-if="shortageItem !== null"
        class="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
        @click.self="closeShortage"
      >
        <form class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" @submit.prevent="submitShortage">
          <div class="flex items-center justify-between gap-3">
            <h2 class="text-lg font-bold">{{ shortageItem.shortage === null ? '공급 부족 신고' : '공급 부족 신고 수정' }}</h2>
            <button type="button" class="text-gray-400 hover:text-gray-700" aria-label="공급 부족 신고 닫기" @click="closeShortage">✕</button>
          </div>
          <p class="mt-2 text-sm text-gray-600">
            <b class="font-mono text-gray-900">{{ shortageItem.mpn || '품번 미기재' }}</b>
            · 발주 {{ fmt(shortageItem.qty) }}개
          </p>
          <p class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            신고 후 공급 가능한 나머지 수량만 발송합니다. 대체발주 전·발송에 담기 전까지만
            수정하거나 취소할 수 있으며, 그 이후에는 변경할 수 없습니다.
          </p>
          <div class="mt-4 grid gap-3 text-sm">
            <label class="font-medium text-gray-700">부족 수량
              <input v-model.number="shortageQty" type="number" min="1" :max="shortageItem.qty" class="mt-1 h-9 w-full rounded-lg border border-gray-300 px-3 tabular-nums">
            </label>
            <label class="font-medium text-gray-700">사유
              <select v-model="shortageReason" class="mt-1 h-9 w-full rounded-lg border border-gray-300 px-3">
                <option v-for="reason in BOM_PO_SHORTAGE_REASONS" :key="reason" :value="reason">{{ BOM_PO_SHORTAGE_REASON_LABELS[reason] }}</option>
              </select>
            </label>
            <label class="font-medium text-gray-700">상세 메모 (선택)
              <textarea v-model="shortageNote" rows="3" maxlength="1000" class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2" placeholder="확보 가능한 수량·예상 일정 등을 적어 주세요." />
            </label>
          </div>
          <p v-if="shortageError !== ''" class="mt-3 text-xs font-semibold text-red-600">{{ shortageError }}</p>
          <div class="mt-5 flex justify-end gap-2">
            <button type="button" class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold" :disabled="shortageBusy" @click="closeShortage">닫기</button>
            <button type="submit" class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-40" :disabled="shortageBusy">
              {{ shortageBusy ? '저장 중…' : shortageItem.shortage === null ? '부족 수량 신고' : '신고 수정' }}
            </button>
          </div>
        </form>
      </div>

      <div class="flex items-center gap-3">
        <button
          v-if="detail.status === 'issued'"
          type="button"
          class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
          :disabled="confirmMut.isPending.value"
          @click="confirmPo"
        >
          발주 확인
        </button>
        <p v-else-if="detail.status === 'confirmed'" class="text-sm font-semibold text-emerald-700">
          확인 완료 — 진행 부탁드립니다.
        </p>
        <p v-if="error !== ''" class="text-sm font-semibold text-red-600">{{ error }}</p>
      </div>

      <!-- 발송 안내(§6.11) — 작업은 홈에서, 여기선 소속 상태만 -->
      <div
        v-if="shipment !== null"
        class="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-sm text-indigo-900"
      >
        📦 이 발주서는 발송에 담겨 있습니다 —
        {{ BOM_SHIPMENT_MODE_LABELS[shipment.mode] }} ·
        {{ bomShipmentStatusLabel(shipment.mode, shipment.status) }}
        <template v-if="shipment.groupPos.length > 1">
          · 발주서 {{ shipment.groupPos.length }}건 묶음
        </template>
        <RouterLink :to="{ name: 'partner-bom' }" class="ml-1 font-semibold underline">
          홈의 진행 중 발송에서 처리 →
        </RouterLink>
      </div>
      <div
        v-else-if="detail.status !== 'issued'"
        class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600"
      >
        아직 발송에 담기지 않았습니다 —
        <RouterLink :to="{ name: 'partner-bom-ship' }" class="font-semibold text-indigo-700 underline">
          📦 보내기에서 담기 →
        </RouterLink>
      </div>
    </template>
  </div>
</template>
