<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError, apiGet, apiSend } from '@sp/shared';
import {
  BOM_RFQ_STATUS_LABELS,
  MagicRfqResponse,
  type BomRfqReplyBodyType,
  type MagicRfqResponseType,
} from '@sp/api-contract';
import RfqReplyForm, { type RfqReplyFormRow } from '../components/smartbom/RfqReplyForm.vue';

// 매직링크 무로그인 회신(§6.9) — 메일의 전용 링크로 진입, 로그인·세션 없음.
// 인증은 URL 토큰(서버가 매 요청 검증), 열리는 범위는 이 RFQ 1건뿐이라
// 레이아웃도 포털 셸 없이 독립 경량 문서로 둔다. 폼은 포털·대리 입력과 동일
// 컴포넌트(RfqReplyForm) — 저장 경로(saveRfqReply)까지 단일이다.

const route = useRoute();
const token = computed(() => {
  const raw = route.params.token;
  return typeof raw === 'string' && /^[0-9a-f]{64}$/.test(raw) ? raw : null;
});

const data = ref<MagicRfqResponseType['data'] | null>(null);
const loading = ref(false);
const invalid = ref(false);
const saveError = ref('');
const saved = ref(false);
const busy = ref(false);

async function load(): Promise<void> {
  if (token.value === null) {
    invalid.value = true;
    return;
  }
  loading.value = true;
  try {
    const res = await apiGet(`/api/rfq-reply/${token.value}`, MagicRfqResponse);
    data.value = res.data;
    invalid.value = false;
  } catch {
    invalid.value = true;
  } finally {
    loading.value = false;
  }
}
watch(token, () => void load(), { immediate: true });

const rfq = computed(() => data.value?.rfq ?? null);
const rows = computed<RfqReplyFormRow[]>(() =>
  (rfq.value?.items ?? []).map((item) => ({
    quoteItemId: item.quoteItemId,
    mpn: item.mpn,
    manufacturerName: item.manufacturerName,
    description: item.description,
    orderQty: item.orderQty,
    reply: item.reply,
  })),
);

async function submit(body: BomRfqReplyBodyType): Promise<void> {
  if (token.value === null) return;
  saveError.value = '';
  saved.value = false;
  busy.value = true;
  try {
    const res = await apiSend('PUT', `/api/rfq-reply/${token.value}`, body, MagicRfqResponse);
    data.value = res.data;
    saved.value = true;
  } catch (e) {
    saveError.value =
      e instanceof ApiRequestError && e.status === 409
        ? '이미 마감된 견적요청입니다 — 샘플피씨비 담당자에게 문의해 주세요.'
        : '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  } finally {
    busy.value = false;
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
  <div class="min-h-screen bg-gray-50 text-gray-900">
    <header class="border-b border-gray-200 bg-surface">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <span class="text-lg font-bold text-blue-600">
          SAMPLEPCB <span class="text-sm font-semibold text-gray-500">부품 견적 회신</span>
        </span>
        <span v-if="data !== null" class="text-sm text-gray-600">{{ data.partnerName }} 님</span>
      </div>
    </header>

    <main class="mx-auto max-w-5xl space-y-4 px-4 py-6">
      <p v-if="loading" class="text-sm text-gray-400">불러오는 중…</p>

      <div v-else-if="invalid" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        유효하지 않거나 만료된 링크입니다. 새 링크가 필요하면 샘플피씨비 담당자에게 요청해 주세요.
      </div>

      <template v-else-if="rfq !== null">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-xl font-bold">{{ rfq.quoteTitle }}</h1>
          <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="statusCls(rfq.status)">
            {{ BOM_RFQ_STATUS_LABELS[rfq.status] }}
          </span>
        </div>
        <p class="text-sm text-gray-500">
          {{ rfq.items.length }}개 품목 · 요청일 {{ rfq.requestedAt.slice(0, 10) }}
          <template v-if="rfq.status === 'closed'"> · 마감된 요청입니다(수정 불가)</template>
        </p>
        <p class="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          이 페이지는 로그인 없이 회신할 수 있는 전용 링크입니다 — 저장 후에도 마감 전까지
          같은 링크로 다시 열어 수정할 수 있습니다.
        </p>

        <div class="rounded-xl border border-gray-200 bg-surface p-4">
          <RfqReplyForm
            :rows="rows"
            :currency="rfq.currency"
            :delivery-date="rfq.deliveryDate"
            :memo="rfq.memo"
            :busy="busy"
            :read-only="rfq.status === 'closed'"
            @submit="submit"
          />
          <p v-if="saveError !== ''" class="mt-2 text-sm font-semibold text-red-600">{{ saveError }}</p>
          <p v-else-if="saved" class="mt-2 text-sm font-semibold text-emerald-600">
            회신이 접수되었습니다. 감사합니다 — 마감 전까지 이 링크에서 다시 수정할 수 있습니다.
          </p>
        </div>
      </template>
    </main>
  </div>
</template>
