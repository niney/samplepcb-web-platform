<script setup lang="ts">
import { BOM_PO_STATUS_LABELS, type AdminBomPoViewType } from '@sp/api-contract';
import { smartbomFmtDate, smartbomFmtWon } from '../../../admin/smartbom';

// Case 상세의 협력사 발주서 패널(D18) — 발행·확인·마감 현황.
// 발주서는 박제 문서라 수정이 없고, 재발행 = 미확인(issued) 삭제 후 재생성.

defineProps<{
  pos: AdminBomPoViewType[];
  loading: boolean;
  canIssue: boolean; // 결제 확인(isPaid) 후에만 발행 가능(D18-4)
  issueDisabledReason: string;
  busy: boolean;
}>();
const emit = defineEmits<{
  create: [];
  remove: [po: AdminBomPoViewType];
  close: [po: AdminBomPoViewType];
  external: [po: AdminBomPoViewType]; // 외부 실행 재시도/재발급(D20)
}>();

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}

const statusCls = (status: AdminBomPoViewType['status']): string =>
  status === 'confirmed'
    ? 'bg-emerald-100 text-emerald-700'
    : status === 'issued'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';
</script>

<template>
  <div class="rounded-xl border border-gray-200 bg-surface">
    <div class="flex flex-wrap items-center gap-3 border-b border-gray-100 px-4 py-3">
      <p class="text-sm font-bold text-gray-800">협력사 발주 (PO)</p>
      <p v-if="pos.length > 0" class="text-xs text-gray-500">
        발주서 <b>{{ pos.length }}</b> ·
        확인 <b class="text-emerald-600">{{ pos.filter((p) => p.status !== 'issued').length }}</b>
      </p>
      <button
        type="button"
        class="ml-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-40"
        :disabled="!canIssue"
        :title="canIssue ? '' : issueDisabledReason"
        @click="emit('create')"
      >
        발주서 생성
      </button>
    </div>

    <p v-if="loading && pos.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">불러오는 중…</p>
    <p v-else-if="pos.length === 0" class="px-4 py-6 text-center text-xs text-gray-400">
      아직 발행한 발주서가 없습니다{{ canIssue ? '' : ` — ${issueDisabledReason}` }}.
    </p>
    <div v-else class="overflow-x-auto">
      <table class="min-w-full divide-y divide-gray-100 text-xs">
        <thead class="bg-gray-50 text-left text-gray-500">
          <tr>
            <th class="px-3 py-2">협력사</th>
            <th class="px-3 py-2">상태</th>
            <th class="px-3 py-2 text-right">품목</th>
            <th class="px-3 py-2 text-right">발주 합계(VAT 별도)</th>
            <th class="px-3 py-2">발행/확인</th>
            <th class="px-3 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-50">
          <tr v-for="po in pos" :key="po.poId">
            <td class="px-3 py-2 font-medium text-gray-900">
              {{ po.partnerName }}
              <span v-if="po.supplierCode !== null" class="ml-1 rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-500">{{ po.supplierCode }}</span>
              <!-- 외부 실행 결과(D20) — 카트/리스트까지, 실결제는 공급사 사이트에서 -->
              <div v-if="po.externalRef !== null" class="mt-1 text-[11px] font-normal">
                <template v-if="po.externalRef.state === 'ok' && po.externalRef.cartKey !== undefined">
                  <span class="text-emerald-700">카트 담김 · {{ po.externalRef.lineCount ?? 0 }}행</span>
                  <span v-if="po.externalRef.merchandiseTotal !== null && po.externalRef.merchandiseTotal !== undefined" class="text-gray-500">
                    · {{ po.externalRef.merchandiseTotal }} {{ po.externalRef.currencyCode ?? '' }}
                  </span>
                  <button v-if="po.externalRef.cartWebUrl !== undefined" type="button" class="ml-1 text-blue-600 underline" @click="openExternal(po.externalRef.cartWebUrl)">
                    Mouser 카트 확인
                  </button>
                  <span v-if="(po.externalRef.errors?.length ?? 0) > 0" class="ml-1 text-amber-700" :title="po.externalRef.errors?.join('\n')">행 오류 {{ po.externalRef.errors?.length }}</span>
                </template>
                <template v-else-if="po.externalRef.state === 'ok' && po.externalRef.singleUseUrl !== undefined">
                  <span class="text-emerald-700">리스트 생성됨 · {{ po.externalRef.lineCount ?? 0 }}행</span>
                  <button type="button" class="ml-1 text-blue-600 underline" title="1회용 URL — 열면 소진되며 [재발급]으로 다시 만들 수 있습니다" @click="openExternal(po.externalRef.singleUseUrl)">
                    DigiKey 리스트 열기(1회용)
                  </button>
                  <button type="button" class="ml-1 text-gray-500 underline" :disabled="busy" @click="emit('external', po)">재발급</button>
                </template>
                <template v-else>
                  <span class="text-red-600" :title="po.externalRef.error">실행 실패: {{ (po.externalRef.error ?? '').slice(0, 40) }}</span>
                  <button type="button" class="ml-1 text-blue-600 underline" :disabled="busy" @click="emit('external', po)">재시도</button>
                </template>
                <span v-if="(po.externalRef.skippedNoSku ?? 0) > 0" class="ml-1 text-amber-700">SKU 없음 {{ po.externalRef.skippedNoSku }}행 제외</span>
              </div>
            </td>
            <td class="px-3 py-2">
              <span class="rounded px-1.5 py-0.5 font-semibold" :class="statusCls(po.status)">
                {{ BOM_PO_STATUS_LABELS[po.status] }}
              </span>
            </td>
            <td class="px-3 py-2 text-right tabular-nums">{{ po.itemCount }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ smartbomFmtWon(po.totalAmount) }}</td>
            <td class="whitespace-nowrap px-3 py-2 text-gray-400">
              {{ smartbomFmtDate(po.issuedAt) }}
              <template v-if="po.confirmedAt !== null"> → {{ smartbomFmtDate(po.confirmedAt) }}</template>
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-right">
              <button
                v-if="po.status === 'issued'"
                type="button"
                class="rounded border border-red-200 px-2 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                :disabled="busy"
                title="미확인 발주서 발행 취소(재발행 = 삭제 후 재생성)"
                @click="emit('remove', po)"
              >
                발행 취소
              </button>
              <button
                v-if="po.status !== 'closed'"
                type="button"
                class="ml-1 rounded border border-gray-300 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                :disabled="busy"
                @click="emit('close', po)"
              >
                마감
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
