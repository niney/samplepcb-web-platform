<script setup lang="ts">
import { computed } from 'vue';
import { BOM_RFQ_STATUS_LABELS, type AdminBomRfqViewType } from '@sp/api-contract';
import { smartbomFmtDate } from '../../../admin/smartbom';

// Case 상세의 협력사 RFQ 현황 패널 — 발송·회신 현황 + 대리 입력 진입.
// 공급사 시세는 여기 없다(후보/오퍼 원장 파생 — 부품행의 선정 오퍼가 그 자리, D6).

const props = defineProps<{
  rfqs: AdminBomRfqViewType[];
  loading: boolean;
  canSend: boolean; // requested|reviewing 에서만 발송 가능
}>();
const emit = defineEmits<{ send: []; reply: [rfq: AdminBomRfqViewType]; compare: [] }>();

const quotedCount = computed(() => props.rfqs.filter((r) => r.status === 'quoted').length);
const pendingCount = computed(() => props.rfqs.filter((r) => r.status === 'requested').length);

const statusCls = (status: AdminBomRfqViewType['status']): string =>
  status === 'quoted'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'requested'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';

const fmtWon = (v: number | null): string => (v === null ? '—' : `${v.toLocaleString('ko-KR')}원`);
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-surface">
    <div class="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
      <p class="text-sm font-bold text-gray-800">협력사 견적요청 (RFQ)</p>
      <p v-if="rfqs.length > 0" class="text-xs text-gray-500">
        협력사 <b>{{ rfqs.length }}</b> · 회신 <b class="text-emerald-600">{{ quotedCount }}</b> ·
        미회신 <b class="text-blue-600">{{ pendingCount }}</b>
      </p>
      <div class="ml-auto flex gap-2">
        <button
          v-if="quotedCount > 0"
          type="button"
          class="rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50 disabled:opacity-40"
          :disabled="!canSend"
          :title="canSend ? '' : '검토 중 상태에서만 선정을 변경할 수 있습니다'"
          @click="emit('compare')"
        >
          회신 비교·선정
        </button>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="!canSend"
          :title="canSend ? '' : '검토 중 상태에서만 발송할 수 있습니다'"
          @click="emit('send')"
        >
          협력사 견적요청 보내기
        </button>
      </div>
    </div>

    <p v-if="loading && rfqs.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">불러오는 중…</p>
    <p v-else-if="rfqs.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">
      아직 발송한 견적요청이 없습니다.
    </p>
    <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-100 text-xs">
        <thead class="bg-gray-50 text-left text-gray-500">
          <tr>
            <th class="px-3 py-2">협력사</th>
            <th class="px-3 py-2">상태</th>
            <th class="px-3 py-2 text-right">회신 행</th>
            <th class="px-3 py-2 text-right">회신 합계</th>
            <th class="px-3 py-2">납기</th>
            <th class="px-3 py-2">회신 메모</th>
            <th class="px-3 py-2">요청/회신일</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="rfq in rfqs" :key="rfq.rfqId">
            <td class="px-3 py-2 font-medium text-gray-900">{{ rfq.partnerName }}</td>
            <td class="px-3 py-2">
              <span class="rounded px-1.5 py-0.5 font-semibold" :class="statusCls(rfq.status)">
                {{ BOM_RFQ_STATUS_LABELS[rfq.status] }}
              </span>
            </td>
            <td class="px-3 py-2 text-right tabular-nums">{{ rfq.repliedItemCount }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ fmtWon(rfq.totalAmount) }}</td>
            <td class="whitespace-nowrap px-3 py-2 text-gray-500">
              {{ rfq.deliveryDate === null ? '—' : rfq.deliveryDate.slice(0, 10) }}
            </td>
            <td class="max-w-48 truncate px-3 py-2 text-gray-500">{{ rfq.memo ?? '—' }}</td>
            <td class="whitespace-nowrap px-3 py-2 text-gray-400">
              {{ smartbomFmtDate(rfq.requestedAt) }}
              <template v-if="rfq.respondedAt !== null"> → {{ smartbomFmtDate(rfq.respondedAt) }}</template>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-right">
              <button
                type="button"
                class="rounded border border-blue-200 px-2 py-1 font-semibold text-blue-700 hover:bg-blue-50"
                @click="emit('reply', rfq)"
              >
                {{ rfq.status === 'quoted' ? '회신 보기·수정' : '대리 입력' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
