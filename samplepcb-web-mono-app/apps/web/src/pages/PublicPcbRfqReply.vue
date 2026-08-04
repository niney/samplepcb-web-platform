<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError, apiGet, apiSend } from '@sp/shared';
import {
  MagicPcbRfqResponse,
  PCB_RFQ_STATUS_LABELS,
  type MagicPcbRfqResponseType,
  type PcbRfqReplyBodyType,
} from '@sp/api-contract';
import PcbRfqReplyForm from '../components/pcb/PcbRfqReplyForm.vue';

// PCB 매직링크 무로그인 회신 — PublicRfqReply(BOM §6.9)와 동형. 인증은 URL 토큰,
// 범위는 이 견적요청 1건뿐이라 포털 셸 없이 독립 경량 문서로 둔다.

const route = useRoute();
const token = computed(() => {
  const raw = route.params.token;
  return typeof raw === 'string' && /^[0-9a-f]{64}$/.test(raw) ? raw : null;
});

const data = ref<MagicPcbRfqResponseType['data'] | null>(null);
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
    const res = await apiGet(`/api/pcb-rfq-reply/${token.value}`, MagicPcbRfqResponse);
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
const readOnly = computed(
  () => rfq.value !== null && rfq.value.status !== 'requested' && rfq.value.status !== 'quoted',
);
const specEntries = computed(() => {
  const spec = rfq.value?.spec.specJson ?? {};
  return Object.entries(spec)
    .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
    .filter(([, v]) => String(v).trim() !== '')
    .map(([k, v]) => ({ key: k, value: String(v) }));
});

async function submit(body: PcbRfqReplyBodyType): Promise<void> {
  if (token.value === null) return;
  saveError.value = '';
  saved.value = false;
  busy.value = true;
  try {
    const res = await apiSend('PUT', `/api/pcb-rfq-reply/${token.value}`, body, MagicPcbRfqResponse);
    data.value = res.data;
    saved.value = true;
  } catch (e) {
    saveError.value =
      e instanceof ApiRequestError && e.status === 409
        ? '선정이 끝난 견적요청입니다 — 샘플피씨비 담당자에게 문의해 주세요.'
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
const dateOnly = (iso: string | null): string => (iso === null ? '—' : iso.slice(0, 10));
</script>

<template>
  <div class="pcb-readable min-h-screen bg-gray-50 text-gray-900">
    <header class="border-b border-gray-200 bg-surface">
      <div class="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
        <span class="text-lg font-bold text-blue-600">
          SAMPLEPCB <span class="text-sm font-semibold text-gray-500">PCB 견적 회신</span>
        </span>
        <span v-if="data !== null" class="text-sm text-gray-600">{{ data.partnerName }} 님</span>
      </div>
    </header>

    <main class="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <p v-if="loading" class="text-sm text-gray-400">불러오는 중…</p>

      <div v-else-if="invalid" class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
        유효하지 않거나 만료된 링크입니다. 새 링크가 필요하면 샘플피씨비 담당자에게 요청해 주세요.
      </div>

      <template v-else-if="rfq !== null">
        <div class="flex flex-wrap items-center gap-3">
          <h1 class="text-xl font-bold">{{ rfq.spec.projectName }}</h1>
          <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="statusCls(rfq.status)">
            {{ PCB_RFQ_STATUS_LABELS[rfq.status] }}
          </span>
        </div>
        <p class="text-sm text-gray-500">
          {{ rfq.spec.category }} · {{ rfq.spec.qty }}매 · 발주처 {{ rfq.requesterName }}
          <template v-if="rfq.suggestedDeliveryDate !== null">
            · 희망 납기 {{ dateOnly(rfq.suggestedDeliveryDate) }}
          </template>
        </p>
        <p class="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          이 페이지는 로그인 없이 회신할 수 있는 전용 링크입니다 — 저장 후에도 선정 전까지
          같은 링크로 다시 열어 수정할 수 있습니다.
        </p>

        <div class="rounded-xl border border-gray-200 bg-surface p-4">
          <h2 class="text-sm font-bold text-gray-700">제작 사양</h2>
          <dl class="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
            <div v-for="entry in specEntries" :key="entry.key" class="flex justify-between gap-2 border-b border-gray-50 py-1">
              <dt class="text-gray-400">{{ entry.key }}</dt>
              <dd class="truncate font-medium text-gray-700">{{ entry.value }}</dd>
            </div>
          </dl>
          <p v-if="rfq.spec.message !== null && rfq.spec.message !== ''" class="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            {{ rfq.spec.message }}
          </p>
          <p v-if="rfq.spec.files.length > 0" class="mt-2 text-xs text-gray-400">
            거버 등 첨부 파일 {{ rfq.spec.files.length }}건은 보안상 파트너 포털 로그인 후 내려받을 수 있습니다.
          </p>
        </div>

        <div class="rounded-xl border border-gray-200 bg-surface p-4">
          <h2 class="mb-3 text-sm font-bold text-gray-700">
            견적 회신 <span class="ml-1 text-xs font-normal text-gray-400">결제통화 {{ rfq.currency }}</span>
          </h2>
          <PcbRfqReplyForm
            :settlement-currency="rfq.currency"
            :input-currency-option="rfq.inputCurrency"
            :initial="{
              priceOriginal: rfq.priceOriginal,
              subCurrency: rfq.subCurrency,
              subPriceOriginal: rfq.subPriceOriginal,
              quotedDeliveryDate: rfq.quotedDeliveryDate,
              memo: rfq.memo,
            }"
            :suggested-delivery-date="rfq.suggestedDeliveryDate"
            :busy="busy"
            :read-only="readOnly"
            @submit="(body) => void submit(body)"
          />
          <p v-if="saveError !== ''" class="mt-2 text-sm font-semibold text-red-600">{{ saveError }}</p>
          <p v-else-if="saved" class="mt-2 text-sm font-semibold text-emerald-600">
            회신이 접수되었습니다. 감사합니다 — 선정 전까지 이 링크에서 다시 수정할 수 있습니다.
          </p>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
/* 장시간 검토 화면 — 밀도보다 판독성 우선(AdminSmartbomCase 가독성 컨벤션과 동일 스케일). */
.pcb-readable :deep([class~='text-[11px]']) {
  font-size: 13px;
  line-height: 18px;
}

.pcb-readable :deep(.text-xs),
.pcb-readable :deep([class~='text-[12px]']) {
  font-size: 14px;
  line-height: 20px;
}

.pcb-readable :deep(.text-sm),
.pcb-readable :deep([class~='text-[13px]']) {
  font-size: 15px;
  line-height: 22px;
}
</style>
