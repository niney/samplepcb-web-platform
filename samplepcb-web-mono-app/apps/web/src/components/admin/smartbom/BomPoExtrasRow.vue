<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  BOM_MD_PO_STATUS_LABELS,
  BOM_REMITTANCE_STATUS_LABELS,
  type AdminBomPoViewType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';
import { partnerAmountText } from '../../../admin/bom-partner-money';
import { smartbomFmtWon } from '../../../admin/smartbom';
import { partnerPortalActAsUrl } from '../../../admin/useAdminPartners';
import { useBomRemittanceEditor } from '../../../admin/useBomRemittanceEditor';

// 발주서 한 줄 아래에 붙는 덧줄 — 송금 기록(D48)과 마스터딜러의 하위 발주(D47).
// 사람 협력사 발주에만 뜬다(공급사 발주는 공급사 사이트에서 결제하고 하위도 없다).

const props = defineProps<{ po: AdminBomPoViewType; colspan: number }>();

const open = ref(false);
const poIdRef = computed(() => props.po.poId);
const editor = useBomRemittanceEditor(poIdRef, open);

const summary = computed(() => props.po.remittance);
const remitCls = (status: string): string =>
  status === 'paid'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'over'
      ? 'bg-rose-100 text-rose-700'
      : status === 'partial'
        ? 'bg-amber-100 text-amber-800'
        : 'bg-gray-200 text-gray-600';
const childCls = (status: string): string =>
  status === 'received'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'issued'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-amber-100 text-amber-800';
</script>

<template>
  <tr v-if="summary !== null || po.childPos.length > 0" class="bg-gray-50/60" data-testid="bom-po-extras" :data-po-id="po.poId">
    <td :colspan="colspan" class="px-3 py-2 text-[11px] text-gray-600">
      <!-- 송금 — 얼마를 발주했고 실제로 얼마가 나갔는가 -->
      <div v-if="summary !== null" class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <b class="text-gray-800">└ 송금</b>
        <span class="rounded px-1 py-0.5 font-semibold" :class="remitCls(summary.status)">
          {{ BOM_REMITTANCE_STATUS_LABELS[summary.status] }}
        </span>
        <span class="tabular-nums">
          지급 {{ partnerAmountText(summary.paidAmount, summary.currency) }} /
          {{ partnerAmountText(summary.poAmount, summary.currency) }}
          · 잔액 {{ partnerAmountText(summary.balance, summary.currency) }}
        </span>
        <span
          v-if="summary.fxDiffKrw !== null && summary.fxDiffKrw !== 0"
          class="tabular-nums"
          :class="summary.fxDiffKrw > 0 ? 'text-rose-700' : 'text-emerald-700'"
          title="실제 송금 환율과 발주서 장부 환율의 차이(원). 양수 = 장부보다 더 나갔습니다."
        >환차 {{ summary.fxDiffKrw > 0 ? '+' : '' }}{{ smartbomFmtWon(summary.fxDiffKrw) }}</span>
        <button
          type="button"
          class="rounded border border-gray-300 bg-white px-2 py-0.5 font-semibold text-gray-700 hover:bg-gray-50"
          @click="open = !open"
        >
          {{ open ? '송금 기록 접기' : '송금 기록' }}
        </button>
      </div>

      <div v-if="open && summary !== null" class="mt-2 rounded-lg border border-gray-200 bg-white p-3" data-testid="bom-remittance-editor">
        <p v-if="editor.loading.value" class="text-gray-400">불러오는 중…</p>
        <template v-else-if="editor.data.value !== null">
          <table v-if="editor.data.value.items.length > 0" class="w-full divide-y divide-gray-100">
            <thead class="text-left text-gray-500">
              <tr>
                <th class="py-1 pr-3">송금일</th>
                <th class="py-1 pr-3 text-right">금액</th>
                <th class="py-1 pr-3 text-right">실제 환율</th>
                <th class="py-1 pr-3 text-right">원화</th>
                <th class="py-1 pr-3 text-right">환차</th>
                <th class="py-1 pr-3">메모</th>
                <th class="py-1 pr-3">기록자</th>
                <th class="py-1" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="row in editor.data.value.items" :key="row.id">
                <td class="py-1 pr-3 whitespace-nowrap">{{ fmtKstDate(row.remittedOn) }}</td>
                <td class="py-1 pr-3 text-right tabular-nums">{{ partnerAmountText(row.amount, row.currency) }}</td>
                <td class="py-1 pr-3 text-right tabular-nums">{{ row.exchangeRate === null ? '—' : row.exchangeRate.toLocaleString('ko-KR') }}</td>
                <td class="py-1 pr-3 text-right tabular-nums">{{ row.krwAmount === null ? '—' : smartbomFmtWon(row.krwAmount) }}</td>
                <td class="py-1 pr-3 text-right tabular-nums">{{ row.fxDiffKrw === null ? '—' : smartbomFmtWon(row.fxDiffKrw) }}</td>
                <td class="max-w-40 truncate py-1 pr-3">{{ row.memo ?? '' }}</td>
                <td class="py-1 pr-3 text-gray-400">{{ row.createdBy }}</td>
                <td class="py-1 text-right">
                  <button
                    type="button"
                    class="rounded border border-rose-200 px-1.5 py-0.5 font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-40"
                    :disabled="editor.busy.value"
                    title="잘못 적은 기록은 지우고 다시 적습니다"
                    @click="editor.remove(row.id)"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="text-gray-400">아직 송금 기록이 없습니다.</p>

          <div class="mt-2 flex flex-wrap items-end gap-2">
            <label class="text-gray-500">송금일
              <input v-model="editor.draft.value.remittedOn" type="date" class="mt-0.5 block h-7 rounded border border-gray-300 px-2">
            </label>
            <label class="text-gray-500">금액({{ editor.data.value.summary.currency }})
              <input
                v-model="editor.draft.value.amount"
                type="number"
                min="0"
                step="any"
                class="mt-0.5 block h-7 w-28 rounded border border-gray-300 px-2 text-right tabular-nums"
                aria-label="송금 금액"
              >
            </label>
            <label v-if="editor.foreign.value" class="text-gray-500">실제 환율
              <input
                v-model="editor.draft.value.exchangeRate"
                type="number"
                min="0"
                step="any"
                class="mt-0.5 block h-7 w-24 rounded border border-gray-300 px-2 text-right tabular-nums"
                :placeholder="editor.data.value.bookedRate === null ? '고시 환율' : `장부 ${editor.data.value.bookedRate.toLocaleString('ko-KR')}`"
                aria-label="실제 적용 환율"
                title="비워 두면 오늘 고시 환율로 적습니다"
              >
            </label>
            <label class="min-w-40 flex-1 text-gray-500">메모
              <input v-model="editor.draft.value.memo" type="text" maxlength="500" class="mt-0.5 block h-7 w-full rounded border border-gray-300 px-2">
            </label>
            <button
              type="button"
              class="h-7 rounded border border-gray-300 px-2 font-semibold text-gray-600 hover:bg-gray-50"
              @click="editor.fillBalance()"
            >
              잔액 채우기
            </button>
            <button
              type="button"
              class="h-7 rounded bg-blue-600 px-3 font-bold text-white hover:bg-blue-700 disabled:opacity-40"
              :disabled="editor.busy.value"
              @click="editor.submit()"
            >
              송금 기록 추가
            </button>
          </div>
          <p v-if="editor.error.value !== ''" class="mt-1 font-semibold text-red-600" role="alert">{{ editor.error.value }}</p>
        </template>
      </div>

      <!-- 마스터딜러의 하위 발주 — 관리자는 전부 본다. 대신 처리하려면 그 조직으로 대리 접속한다 -->
      <div v-if="po.childPos.length > 0" class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="bom-po-children">
        <b class="text-teal-800">└ 하위 발주 {{ po.childPos.length }}건</b>
        <span v-for="child in po.childPos" :key="child.mdPoId" class="whitespace-nowrap">
          {{ child.partnerName }}
          <span class="rounded px-1 py-0.5 font-semibold" :class="childCls(child.status)">{{ BOM_MD_PO_STATUS_LABELS[child.status] }}</span>
          {{ partnerAmountText(child.totalAmount, child.currency) }} · {{ child.items.length }}품목
          <template v-if="child.trackingNo !== null"> · {{ child.carrier ?? '' }} {{ child.trackingNo }}</template>
        </span>
        <a
          :href="partnerPortalActAsUrl(po.partnerId)"
          target="_blank"
          rel="noopener"
          class="ml-auto font-semibold text-blue-700 underline"
          title="이 마스터딜러의 포털을 새 탭으로 엽니다 — 하위 발주·확인·수령을 대신 처리할 수 있습니다"
        >마스터딜러 포털로 대리 접속</a>
      </div>
    </td>
  </tr>
</template>
