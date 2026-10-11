<script setup lang="ts">
import { usePartnerI18n } from '../../partner/i18n';
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import { PCB_RFQ_STATUS_LABELS, type PcbRfqReplyBodyType } from '@sp/api-contract';
import {
  downloadPartnerPcbFile,
  usePartnerPcbRfqDetail,
  usePartnerPcbRfqReply,
} from '../../partner/usePartnerPcbRfqs';
import { confirmDialog } from '../../lib/confirmDialog';
import { pcbCategoryBadge } from '../../lib/pcb-category';
import { pcbSpecEntries, pcbSpecFormFields } from '../../lib/pcb-spec';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PcbRfqReplyForm from '../../components/pcb/PcbRfqReplyForm.vue';
import PartnerPcbRfqMdPanel from '../../components/partner/PartnerPcbRfqMdPanel.vue';

const { pt, pm, locale, pd, pn } = usePartnerI18n();
const dateOnly = pd;
const fmtPcbAmount = (currency: string, value: number | null): string =>
  value === null ? '—' : pm(value, currency);


// PCB 견적요청 상세(협력사 포털) — 사양 확인 → 견적가+예상 배송일 회신.
// MD(마스터딜러)면 하위 협력사 재요청·하위 선정(마진 박제)으로 회신을 구성할 수도 있다
// — 서버가 관계·능력을 검증하고 상위 회신가를 계산한다(docs/PCB_PARTNER_TRACK.md §5.2).
//
// 마스터딜러 화면(2026-10-11 재편): 일이 일어나는 곳이 위에 온다 — [내 회신] 띠 → [회신 만들기]
// (하위 협력사 견적으로 / 직접 입력) → 제작 사양. 회신을 만드는 길이 둘이고 서로를 대신하므로
// 한 카드 안에서 고르게 했다(예전에는 저장 버튼이 두 구역에 따로 있어, 하나를 누르면 다른 쪽이
// 말없이 지워졌다). 일반 협력사 화면은 그대로다(사양 → 회신).

const route = useRoute();
const rfqId = computed(() => {
  const raw = Number(route.params.id);
  return Number.isInteger(raw) && raw > 0 ? raw : null;
});
const detailQuery = usePartnerPcbRfqDetail(rfqId);
const detail = computed(() => detailQuery.data.value?.data ?? null);

const actionError = ref('');
const savedNote = ref('');
const surfaceError = (e: unknown, fallback: string): void => {
  actionError.value = locale.value === 'ko' && e instanceof ApiRequestError && e.message !== '' ? e.message : fallback;
};

const readOnly = computed(
  () => detail.value !== null && detail.value.status !== 'requested' && detail.value.status !== 'quoted',
);

// ── 마스터딜러 화면 ──────────────────────────────────────────────────────────
// 하위 재요청·선정은 관리자가 내게 보낸 행에서만 열린다(하위 트랙으로 받은 행은 일반 회신).
const mdView = computed(() => {
  const d = detail.value;
  return d !== null && d.isAdminTrack && (d.myChildPartners.length > 0 || d.children.length > 0);
});
const mode = ref<'child' | 'direct'>('child');
// 화면을 열 때 한 번 — 지금 회신이 만들어진 길을 따라간다(재조회가 보던 탭을 바꾸지 않게 건이 바뀔 때만).
watch(
  () => detail.value?.rfqId ?? null,
  (id) => {
    const d = detail.value;
    if (id === null || d === null) return;
    mode.value = d.mdQuote === null && d.priceOriginal !== null ? 'direct' : 'child';
  },
  { immediate: true },
);
const selectedChildName = computed(() => {
  const d = detail.value;
  const quote = d?.mdQuote ?? null;
  if (d === null || quote === null) return null;
  return d.children.find((child) => child.rfqId === quote.childRfqId)?.partnerName ?? pt('하위 협력사');
});
/** 회신 근거 식 — "$200.00 × 1375.5 × 1.08"(같은 통화면 환율 생략). */
const mdFormula = computed(() => {
  const d = detail.value;
  const quote = d?.mdQuote ?? null;
  if (d === null || quote === null) return '';
  const parts = [fmtPcbAmount(quote.sourceCurrency, quote.sourceAmount)];
  if (quote.sourceCurrency !== d.currency) parts.push(String(quote.sourceRate));
  parts.push((1 + quote.marginRate / 100).toFixed(2));
  return parts.join(' × ');
});

// 회신 폼은 처음 뜰 때 한 번만 값을 읽는다 — 서버의 회신이 달라지면(하위 선정·해제·저장) 새로 띄워
// 입력칸이 지금 회신을 보이게 한다. 예전에는 건 번호만 키라, 하위 선정으로 회신가가 생겨도 입력칸은
// 빈 채였다(그 상태로 [회신 저장]을 누르면 화면의 옛 값이 선정을 지웠다).
const replyFormKey = computed(() => {
  const d = detail.value;
  return d === null ? '' : [d.rfqId, d.respondedAt ?? '', d.priceOriginal ?? '', d.quotedDeliveryDate ?? ''].join(':');
});

// 명칭·순서는 레거시 정본(lib/pcb-spec.ts, estimate_form_ca10 승계).
// 항목 이름·순서는 거버 앱이 정본 — 카테고리 세트를 골라야 맞는다(lib/pcb-spec.ts).
const specEntries = computed(() => {
  const json = detail.value?.spec.specJson ?? {};
  const context = {
    category: detail.value?.spec.category,
    orderCategory: detail.value?.spec.orderCategory,
    kindPcb: typeof json.kindPcb === 'string' ? json.kindPcb : null,
  };
  const fields = pcbSpecFormFields(context);
  return pcbSpecEntries(json, context).map((entry) => {
    const field = fields.find((candidate) => candidate.key === entry.key);
    const listed = field?.options.some((option) =>
      option.value.toLowerCase() === entry.value.toLowerCase() || option.name === entry.value,
    ) ?? false;
    return { ...entry, display: listed || entry.display !== entry.value ? pt(entry.display) : entry.display };
  });
});

// ── 회신 ─────────────────────────────────────────────────────────────────────
const reply = usePartnerPcbRfqReply();
async function submitReply(body: PcbRfqReplyBodyType): Promise<void> {
  if (rfqId.value === null) return;
  actionError.value = '';
  savedNote.value = '';
  // 직접 입력은 하위 선정으로 만든 회신을 대신한다 — 말없이 지우지 않고 한 번 묻는다.
  const quote = detail.value?.mdQuote ?? null;
  if (quote !== null) {
    const ok = await confirmDialog({
      title: pt('하위 선정이 풀립니다'),
      message: pt('직접 입력으로 저장하면 하위 협력사 선정({value1} + {value2}%)이 풀리고, 입력한 값이 회신가가 됩니다.', {
        value1: selectedChildName.value ?? '',
        value2: quote.marginRate,
      }),
      confirmLabel: pt('직접 입력으로 저장'),
    });
    if (!ok) return;
  }
  try {
    await reply.mutateAsync({ rfqId: rfqId.value, body });
    savedNote.value = pt('회신이 저장되었습니다 — 선정 전까지 다시 수정할 수 있습니다.');
  } catch (e) {
    surfaceError(e, pt('회신 저장에 실패했습니다.'));
  }
}

const STATUS_CLS: Record<string, string> = {
  requested: 'bg-blue-100 text-blue-700',
  quoted: 'bg-emerald-100 text-emerald-700',
  selected: 'bg-violet-100 text-violet-700',
  unselected: 'bg-gray-200 text-gray-500',
};

// Clear transient feedback on language changes; preserve entered form values.
watch(locale, () => {
  actionError.value = '';
  savedNote.value = '';
});
</script>

<template>
  <div class="pcb-readable flex flex-col gap-5">
    <PartnerPageHeader :back="{ to: { name: 'partner-pcb-rfqs' }, label: pt('견적요청') }" />

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">{{ pt('불러오는 중…') }}</p>

    <template v-else-if="detail !== null">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-xl font-bold">{{ detail.spec.projectName }}</h1>
        <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="STATUS_CLS[detail.status]">
          {{ pt(PCB_RFQ_STATUS_LABELS[detail.status]) }}
        </span>
        <span class="text-sm text-gray-500">{{ pt('발주처: {value1}', { value1: detail.requesterName }) }}</span>
      </div>

      <!-- ── 마스터딜러: 요약 한 줄 + 파일(사양 전체는 아래로) ── -->
      <div v-if="mdView" class="rounded-xl border border-gray-200 bg-surface px-4 py-3" data-testid="partner-pcb-rfq-summary">
        <p class="text-sm text-gray-600">
          <span
            class="mr-1 rounded px-1.5 py-0.5 text-xs font-semibold"
            :class="pcbCategoryBadge(detail.spec.category).cls"
          >
            {{ pt(pcbCategoryBadge(detail.spec.category).label) }}
          </span>{{ pt('{value1} · {value2}매', { value1: detail.spec.orderCategory === 'mass' ? pt('양산') : pt('샘플'), value2: pn(detail.spec.qty) }) }}<template v-if="detail.suggestedDeliveryDate !== null">
            {{ pt('· 희망 납기 {value1}', { value1: dateOnly(detail.suggestedDeliveryDate) }) }}
          </template>
        </p>
        <div v-if="detail.spec.files.length > 0" class="mt-2 flex flex-wrap gap-2">
          <button
            v-for="f in detail.spec.files"
            :key="f.fileId"
            type="button"
            class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            @click="void downloadPartnerPcbFile(detail.rfqId, f.fileId, f.name)"
          >
            ⬇ {{ f.name }}
          </button>
        </div>
      </div>

      <!-- ── 마스터딜러: 내 회신 — 무엇을 눌렀든 결과는 여기서 본다 ── -->
      <div
        v-if="mdView"
        class="rounded-xl border px-4 py-3"
        :class="detail.priceOriginal === null ? 'border-gray-200 bg-gray-50' : 'border-emerald-200 bg-emerald-50/60'"
        data-testid="partner-pcb-rfq-my-reply"
        :data-reply-mode="detail.priceOriginal === null ? 'none' : detail.mdQuote === null ? 'direct' : 'child'"
      >
        <p class="text-xs font-semibold text-gray-500">{{ pt('내 회신') }} <span class="font-normal text-gray-400">{{ pt('결제통화 {value1}', { value1: detail.currency }) }}</span></p>
        <p v-if="detail.priceOriginal === null" class="mt-0.5 text-sm text-gray-500">{{ pt('아직 회신 전입니다.') }}</p>
        <template v-else>
          <p class="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span class="text-lg font-bold tabular-nums text-gray-900" data-testid="partner-pcb-rfq-my-reply-amount">{{ fmtPcbAmount(detail.currency, detail.priceOriginal) }}</span>
            <span v-if="detail.quotedDeliveryDate !== null" class="text-sm text-gray-600">{{ pt('납기 {value1}', { value1: dateOnly(detail.quotedDeliveryDate) }) }}</span>
          </p>
          <p class="mt-0.5 text-xs text-gray-500" data-testid="partner-pcb-rfq-my-reply-basis">
            <template v-if="detail.mdQuote !== null">{{ pt('하위 선정: {value1} + {value2}%', { value1: selectedChildName ?? '', value2: detail.mdQuote.marginRate }) }} <span class="tabular-nums text-gray-400">({{ mdFormula }})</span></template>
            <template v-else>{{ pt('직접 입력한 회신') }}</template>
          </p>
        </template>
      </div>

      <!-- ── 마스터딜러: 회신 만들기 ── -->
      <section v-if="mdView" class="rounded-xl border border-indigo-200 bg-surface p-4" data-testid="partner-pcb-rfq-compose">
        <div class="flex flex-wrap items-center gap-3">
          <h2 class="text-sm font-bold text-indigo-700">{{ pt('회신 만들기') }}</h2>
          <div class="flex rounded-lg border border-gray-200 p-0.5 text-sm font-semibold" role="tablist">
            <button
              type="button"
              role="tab"
              class="rounded-md px-3 py-1"
              :class="mode === 'child' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'"
              :aria-selected="mode === 'child'"
              data-testid="partner-pcb-rfq-mode-child"
              @click="mode = 'child'"
            >
              {{ pt('하위 협력사 견적으로') }}
            </button>
            <button
              type="button"
              role="tab"
              class="rounded-md px-3 py-1"
              :class="mode === 'direct' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'"
              :aria-selected="mode === 'direct'"
              data-testid="partner-pcb-rfq-mode-direct"
              @click="mode = 'direct'"
            >
              {{ pt('회신 방식 — 직접 입력') }}
            </button>
          </div>
        </div>
        <p v-if="readOnly" class="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500" data-testid="partner-pcb-rfq-readonly">
          {{ pt('선정 절차가 끝난 견적요청입니다 — 수정이 필요하면 발주처에 문의해 주세요.') }}<template v-if="detail.status === 'selected'">
            {{ pt('발주서가 발행되면 발주 상세에서 하위 발주를 진행합니다.') }}
            <RouterLink :to="{ name: 'partner-pcb-pos' }" class="font-bold text-indigo-700 underline">{{ pt('발주 목록') }}</RouterLink>
          </template>
        </p>

        <div v-show="mode === 'child'" class="mt-4">
          <PartnerPcbRfqMdPanel :detail="detail" :read-only="readOnly" />
        </div>

        <div v-show="mode === 'direct'" class="mt-4">
          <p v-if="detail.mdQuote !== null && !readOnly" class="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="partner-pcb-rfq-direct-warn">
            {{ pt('지금 회신은 하위 선정으로 만든 값입니다 — 여기서 저장하면 하위 선정이 풀립니다.') }}
          </p>
          <PcbRfqReplyForm
            :key="replyFormKey"
            :settlement-currency="detail.currency"
            :input-currency-option="detail.inputCurrency"
            :initial="{
              priceOriginal: detail.priceOriginal,
              subCurrency: detail.subCurrency,
              subPriceOriginal: detail.subPriceOriginal,
              quotedDeliveryDate: detail.quotedDeliveryDate,
              memo: detail.memo,
            }"
            :suggested-delivery-date="detail.suggestedDeliveryDate"
            :busy="reply.isPending.value"
            :read-only="readOnly"
            @submit="(body) => void submitReply(body)"
          />
          <p v-if="actionError !== ''" class="mt-2 text-sm font-semibold text-red-600" role="alert" data-testid="partner-pcb-rfq-reply-error">{{ actionError }}</p>
          <p v-else-if="savedNote !== ''" class="mt-2 text-sm font-semibold text-emerald-700" role="status" data-testid="partner-pcb-rfq-reply-notice">{{ savedNote }}</p>
        </div>
      </section>

      <!-- 제작 사양 — 마스터딜러 화면에서는 맨 아래(요약·파일은 위 띠가 맡는다) -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4" :class="mdView ? 'order-last' : ''" data-testid="partner-pcb-rfq-spec">
        <h2 class="text-sm font-bold text-gray-700">{{ pt('제작 사양') }}</h2>
        <!-- 제품군 배지 — 관리자 Case 상세와 같은 사전(공정·단가가 다른 물건을 갈라 준다). -->
        <p v-if="!mdView" class="mt-1 text-sm text-gray-500">
          <span
            class="mr-1 rounded px-1.5 py-0.5 text-xs font-semibold"
            :class="pcbCategoryBadge(detail.spec.category).cls"
          >
            {{ pt(pcbCategoryBadge(detail.spec.category).label) }}
          </span>{{ pt('{value1} · {value2}매', { value1: detail.spec.orderCategory === 'mass' ? pt('양산') : pt('샘플'), value2: pn(detail.spec.qty) }) }}<template v-if="detail.suggestedDeliveryDate !== null">
            {{ pt('· 희망 납기 {value1}', { value1: dateOnly(detail.suggestedDeliveryDate) }) }}
          </template>
        </p>
        <div v-if="!mdView && detail.spec.files.length > 0" class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="f in detail.spec.files"
            :key="f.fileId"
            type="button"
            class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            @click="void downloadPartnerPcbFile(detail.rfqId, f.fileId, f.name)"
          >
            ⬇ {{ f.name }}
          </button>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          <div v-for="entry in specEntries" :key="entry.key" class="flex justify-between gap-2 border-b border-gray-50 py-1">
            <dt class="text-gray-400">{{ pt(entry.label) }}</dt>
            <dd class="truncate font-medium text-gray-700" :title="pt('저장값 {value1}', { value1: entry.value })">{{ entry.display }}</dd>
          </div>
        </dl>
        <p v-if="detail.spec.message !== null && detail.spec.message !== ''" class="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          {{ detail.spec.message }}
        </p>
      </section>

      <!-- 회신(일반 협력사 · 하위 트랙으로 받은 마스터딜러) -->
      <section v-if="!mdView" class="rounded-xl border border-gray-200 bg-surface p-4" data-testid="partner-pcb-rfq-reply">
        <h2 class="text-sm font-bold text-gray-700">
          {{ pt('견적 회신') }} <span class="ml-1 text-xs font-normal text-gray-400">{{ pt('결제통화 {value1}', { value1: detail.currency }) }}</span>
        </h2>
        <p v-if="readOnly" class="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">{{ pt('선정 절차가 끝난 견적요청입니다 — 수정이 필요하면 발주처에 문의해 주세요.') }}</p>
        <div class="mt-3">
          <PcbRfqReplyForm
            :key="replyFormKey"
            :settlement-currency="detail.currency"
            :input-currency-option="detail.inputCurrency"
            :initial="{
              priceOriginal: detail.priceOriginal,
              subCurrency: detail.subCurrency,
              subPriceOriginal: detail.subPriceOriginal,
              quotedDeliveryDate: detail.quotedDeliveryDate,
              memo: detail.memo,
            }"
            :suggested-delivery-date="detail.suggestedDeliveryDate"
            :busy="reply.isPending.value"
            :read-only="readOnly"
            @submit="(body) => void submitReply(body)"
          />
        </div>
        <p v-if="actionError !== ''" class="mt-2 text-sm font-semibold text-red-600" role="alert" data-testid="partner-pcb-rfq-reply-error">{{ actionError }}</p>
        <p v-else-if="savedNote !== ''" class="mt-2 text-sm font-semibold text-emerald-700" role="status" data-testid="partner-pcb-rfq-reply-notice">{{ savedNote }}</p>
      </section>
    </template>

    <div v-else class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">{{ pt('견적요청을 찾을 수 없습니다.') }}</div>
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
