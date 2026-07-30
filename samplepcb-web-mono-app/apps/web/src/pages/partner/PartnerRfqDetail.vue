<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import { BOM_RFQ_STATUS_LABELS, type BomRfqReplyBodyType } from '@sp/api-contract';
import { usePartnerRfqDetail, usePartnerRfqReply } from '../../partner/usePartnerRfqs';
import RfqReplyForm, { type RfqReplyFormRow } from '../../components/smartbom/RfqReplyForm.vue';

// 파트너 포털 회신 폼 — 행별 단가·재고·D/C·납기 입력(마감 전 재회신 허용).
// 노출은 부품행과 내 회신뿐(고객 정보·목표단가 없음 — 서버 계약이 보장, D8).

const route = useRoute();
const rfqId = computed(() => {
  const raw = route.params.id;
  return typeof raw === 'string' && raw !== '' ? raw : null;
});

const detailQuery = usePartnerRfqDetail(rfqId);
const detail = computed(() => detailQuery.data.value?.data ?? null);
const reply = usePartnerRfqReply();
const saveError = ref('');
const saved = ref(false);

const rows = computed<RfqReplyFormRow[]>(() =>
  (detail.value?.items ?? []).map((item) => ({
    quoteItemId: item.quoteItemId,
    mpn: item.mpn,
    manufacturerName: item.manufacturerName,
    description: item.description,
    orderQty: item.orderQty,
    reply: item.reply,
  })),
);

async function submit(body: BomRfqReplyBodyType): Promise<void> {
  if (rfqId.value === null) return;
  saveError.value = '';
  saved.value = false;
  try {
    await reply.mutateAsync({ rfqId: rfqId.value, body });
    saved.value = true;
  } catch (e) {
    saveError.value = e instanceof ApiRequestError ? e.message : '저장에 실패했습니다.';
  }
}

const statusCls = (s: string): string =>
  s === 'quoted'
    ? 'bg-emerald-100 text-emerald-700'
    : s === 'requested'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-gray-200 text-gray-600';
</script>

<template>
  <div class="space-y-4">
    <div class="flex flex-wrap items-center gap-3">
      <RouterLink
        :to="{ name: 'partner' }"
        class="rounded-md border border-gray-200 px-2 py-1 text-sm font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800"
      >
        ← 목록
      </RouterLink>
      <template v-if="detail !== null">
        <h1 class="text-xl font-bold">{{ detail.quoteTitle }}</h1>
        <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="statusCls(detail.status)">
          {{ BOM_RFQ_STATUS_LABELS[detail.status] }}
        </span>
      </template>
    </div>

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>
    <p v-else-if="detail === null" class="text-sm text-gray-400">견적요청을 찾을 수 없습니다.</p>

    <template v-else>
      <p class="text-sm text-gray-500">
        {{ detail.items.length }}개 품목 · 요청일 {{ detail.requestedAt.slice(0, 10) }}
        <template v-if="detail.status === 'closed'"> · 마감된 요청입니다(수정 불가)</template>
      </p>

      <div class="rounded-xl border border-gray-200 bg-surface p-4">
        <RfqReplyForm
          :rows="rows"
          :currency="detail.currency"
          :delivery-date="detail.deliveryDate"
          :memo="detail.memo"
          :busy="reply.isPending.value"
          :read-only="detail.status === 'closed'"
          @submit="submit"
        />
        <p v-if="saveError !== ''" class="mt-2 text-sm font-semibold text-red-600">{{ saveError }}</p>
        <p v-else-if="saved" class="mt-2 text-sm font-semibold text-emerald-600">
          회신이 저장되었습니다. 마감 전까지 다시 수정할 수 있습니다.
        </p>
      </div>
    </template>
  </div>
</template>
