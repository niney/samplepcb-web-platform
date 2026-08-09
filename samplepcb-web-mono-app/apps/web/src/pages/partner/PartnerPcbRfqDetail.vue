<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import { PCB_RFQ_STATUS_LABELS, type PcbRfqReplyBodyType } from '@sp/api-contract';
import {
  downloadPartnerPcbFile,
  usePartnerPcbChildAssign,
  usePartnerPcbChildSelect,
  usePartnerPcbRfqDetail,
  usePartnerPcbRfqReply,
} from '../../partner/usePartnerPcbRfqs';
import { fmtKstDate as dateOnly } from '@sp/utils';
import { fmtPcbAmount, pcbMoneyWithSub } from '../../lib/pcb-money';
import { pcbSpecEntries } from '../../lib/pcb-spec';
import PcbRfqReplyForm from '../../components/pcb/PcbRfqReplyForm.vue';

// PCB 견적요청 상세(협력사 포털) — 사양 확인 → 견적가+예상 배송일 회신.
// MD(마스터딜러)면 하위 협력사 재요청·하위 선정(마진 박제)으로 회신을 구성할 수도 있다
// — 서버가 관계·능력을 검증하고 상위 회신가를 계산한다(docs/PCB_PARTNER_TRACK.md §5.2).

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
  actionError.value = e instanceof ApiRequestError && e.message !== '' ? e.message : fallback;
};

const readOnly = computed(
  () => detail.value !== null && detail.value.status !== 'requested' && detail.value.status !== 'quoted',
);

// 명칭·순서는 레거시 정본(lib/pcb-spec.ts, estimate_form_ca10 승계).
const specEntries = computed(() => pcbSpecEntries((detail.value?.spec.specJson ?? {})));

// ── 회신 ─────────────────────────────────────────────────────────────────────
const reply = usePartnerPcbRfqReply();
async function submitReply(body: PcbRfqReplyBodyType): Promise<void> {
  if (rfqId.value === null) return;
  actionError.value = '';
  savedNote.value = '';
  try {
    await reply.mutateAsync({ rfqId: rfqId.value, body });
    savedNote.value = '회신이 저장되었습니다 — 선정 전까지 다시 수정할 수 있습니다.';
  } catch (e) {
    surfaceError(e, '회신 저장에 실패했습니다.');
  }
}

// ── MD 하위 재요청·선정 ──────────────────────────────────────────────────────
const isMd = computed(
  () => (detail.value?.myChildPartners.length ?? 0) > 0 || (detail.value?.children.length ?? 0) > 0,
);
const childAssignSelected = ref<Set<number>>(new Set());
watch(detail, (d) => {
  if (d === null) return;
  childAssignSelected.value = new Set(
    d.children.filter((c) => c.status !== 'unselected').map((c) => c.partnerId),
  );
}, { immediate: true });
function toggleChild(partnerId: number): void {
  const next = new Set(childAssignSelected.value);
  if (next.has(partnerId)) next.delete(partnerId);
  else next.add(partnerId);
  childAssignSelected.value = next;
}
const childAssign = usePartnerPcbChildAssign();
async function submitChildAssign(): Promise<void> {
  if (rfqId.value === null) return;
  actionError.value = '';
  try {
    await childAssign.mutateAsync({
      rfqId: rfqId.value,
      body: { partnerIds: [...childAssignSelected.value] },
    });
  } catch (e) {
    surfaceError(e, '하위 견적요청 발송에 실패했습니다.');
  }
}

const selectedChildRadio = ref<number | null>(null);
const marginText = ref('');
watch(
  detail,
  (d) => {
    if (d === null) return;
    selectedChildRadio.value = d.children.find((c) => c.status === 'selected')?.rfqId ?? null;
  },
  { immediate: true },
);
const childSelect = usePartnerPcbChildSelect();
async function submitChildSelect(): Promise<void> {
  if (rfqId.value === null) return;
  actionError.value = '';
  if (selectedChildRadio.value === null) {
    actionError.value = '선정할 하위 회신을 선택해 주세요.';
    return;
  }
  const margin = Number(marginText.value);
  if (!Number.isInteger(margin) || margin < 0) {
    actionError.value = '마진율(정수 %)을 입력해 주세요.';
    return;
  }
  try {
    await childSelect.mutateAsync({
      rfqId: rfqId.value,
      body: { childRfqId: selectedChildRadio.value, marginRate: margin },
    });
    savedNote.value = '하위 선정이 저장되고 회신가가 계산·박제되었습니다.';
  } catch (e) {
    surfaceError(e, '하위 선정에 실패했습니다.');
  }
}
async function clearChildSelect(): Promise<void> {
  if (rfqId.value === null) return;
  actionError.value = '';
  try {
    await childSelect.mutateAsync({ rfqId: rfqId.value, body: { childRfqId: null } });
    selectedChildRadio.value = null;
    savedNote.value = '하위 선정을 해제했습니다 — 회신도 함께 초기화되었습니다.';
  } catch (e) {
    surfaceError(e, '선정 해제에 실패했습니다.');
  }
}

const STATUS_CLS: Record<string, string> = {
  requested: 'bg-blue-100 text-blue-700',
  quoted: 'bg-emerald-100 text-emerald-700',
  selected: 'bg-violet-100 text-violet-700',
  unselected: 'bg-gray-200 text-gray-500',
};
</script>

<template>
  <div class="pcb-readable space-y-5">
    <RouterLink :to="{ name: 'partner-pcb' }" class="text-sm text-gray-400 hover:text-gray-700">
      ← 파트너 홈
    </RouterLink>

    <p v-if="detailQuery.isLoading.value" class="text-sm text-gray-400">불러오는 중…</p>

    <template v-else-if="detail !== null">
      <div class="flex flex-wrap items-center gap-3">
        <h1 class="text-xl font-bold">{{ detail.spec.projectName }}</h1>
        <span class="rounded px-2 py-0.5 text-xs font-semibold" :class="STATUS_CLS[detail.status]">
          {{ PCB_RFQ_STATUS_LABELS[detail.status] }}
        </span>
        <span class="text-sm text-gray-500">발주처: {{ detail.requesterName }}</span>
      </div>

      <p v-if="actionError !== ''" class="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{{ actionError }}</p>
      <p v-else-if="savedNote !== ''" class="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">{{ savedNote }}</p>

      <!-- 제작 사양 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">제작 사양</h2>
        <p class="mt-1 text-sm text-gray-500">
          {{ detail.spec.category }} · {{ detail.spec.orderCategory === 'mass' ? '양산' : '샘플' }} · {{ detail.spec.qty }}매
          <template v-if="detail.suggestedDeliveryDate !== null">
            · 희망 납기 {{ dateOnly(detail.suggestedDeliveryDate) }}
          </template>
        </p>
        <div v-if="detail.spec.files.length > 0" class="mt-3 flex flex-wrap gap-2">
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
            <dt class="text-gray-400">{{ entry.label }}</dt>
            <dd class="truncate font-medium text-gray-700">{{ entry.value }}</dd>
          </div>
        </dl>
        <p v-if="detail.spec.message !== null && detail.spec.message !== ''" class="mt-3 whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
          {{ detail.spec.message }}
        </p>
      </section>

      <!-- 회신 -->
      <section class="rounded-xl border border-gray-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-gray-700">
          견적 회신
          <span class="ml-1 text-xs font-normal text-gray-400">결제통화 {{ detail.currency }}</span>
        </h2>
        <p v-if="readOnly" class="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-500">
          선정 절차가 끝난 견적요청입니다 — 수정이 필요하면 발주처에 문의해 주세요.
        </p>
        <div class="mt-3">
          <PcbRfqReplyForm
            :key="detail.rfqId"
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
      </section>

      <!-- MD — 하위 협력사 재요청·선정 -->
      <section v-if="isMd" class="rounded-xl border border-indigo-200 bg-surface p-4">
        <h2 class="text-sm font-bold text-indigo-700">하위 협력사 견적 (마스터딜러)</h2>
        <p class="mt-1 text-xs text-gray-500">
          하위 회신을 선정하고 마진(%)을 붙이면 위 회신가가 자동 계산·박제됩니다
          (환율·원본은 감사용으로 함께 저장). 직접 회신을 저장하면 하위 선정은 초기화됩니다.
        </p>

        <div v-if="detail.myChildPartners.length > 0" class="mt-3 rounded-lg border border-gray-100 p-3">
          <p class="text-xs font-semibold text-gray-500">하위 배정(체크 해제 = 미회신 회수)</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <label
              v-for="child in detail.myChildPartners"
              :key="child.partnerId"
              class="flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 px-2 py-1 text-xs hover:bg-gray-50"
            >
              <input type="checkbox" class="size-3.5 accent-indigo-600" :checked="childAssignSelected.has(child.partnerId)" @change="toggleChild(child.partnerId)">
              <span class="font-medium text-gray-700">{{ child.name }}</span>
              <span class="text-gray-400">{{ child.settlementCurrency ?? 'USD' }}</span>
            </label>
          </div>
          <button
            type="button"
            class="mt-2 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-40"
            :disabled="childAssign.isPending.value || readOnly"
            @click="void submitChildAssign()"
          >
            하위 견적요청 발송
          </button>
        </div>

        <div v-if="detail.children.length > 0" class="mt-3 overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-100 text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th class="px-3 py-2">선정</th>
                <th class="px-3 py-2">하위 협력사</th>
                <th class="px-3 py-2">상태</th>
                <th class="whitespace-nowrap px-3 py-2">회신가</th>
                <th class="whitespace-nowrap px-3 py-2">납기</th>
                <th class="px-3 py-2">메모</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-50">
              <tr v-for="child in detail.children" :key="child.rfqId" :class="child.status === 'selected' ? 'bg-violet-50/40' : ''">
                <td class="px-3 py-2">
                  <input
                    type="radio"
                    name="child-select"
                    class="size-4 accent-violet-600"
                    :checked="selectedChildRadio === child.rfqId"
                    :disabled="child.priceOriginal === null || readOnly"
                    @change="selectedChildRadio = child.rfqId"
                  >
                </td>
                <td class="px-3 py-2 font-medium text-gray-800">{{ child.partnerName }}</td>
                <td class="px-3 py-2">
                  <span class="rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[child.status]">
                    {{ PCB_RFQ_STATUS_LABELS[child.status] }}
                  </span>
                </td>
                <td class="whitespace-nowrap px-3 py-2 tabular-nums">
                  {{ pcbMoneyWithSub(child.currency, child.priceOriginal, child.subCurrency, child.subPriceOriginal) }}
                </td>
                <td class="whitespace-nowrap px-3 py-2 text-gray-500">{{ dateOnly(child.quotedDeliveryDate) }}</td>
                <td class="max-w-[12rem] truncate px-3 py-2 text-xs text-gray-500">{{ child.memo ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <label class="flex items-center gap-1.5 text-sm text-gray-600">
              마진
              <input v-model="marginText" type="text" inputmode="numeric" class="w-16 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-violet-500 focus:outline-none" placeholder="8">
              %
            </label>
            <button
              type="button"
              class="rounded-md bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-40"
              :disabled="childSelect.isPending.value || readOnly"
              @click="void submitChildSelect()"
            >
              하위 선정 저장
            </button>
            <button
              type="button"
              class="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-50 disabled:opacity-40"
              :disabled="childSelect.isPending.value || readOnly"
              @click="void clearChildSelect()"
            >
              선정 해제
            </button>
            <span v-if="detail.priceOriginal !== null" class="text-xs text-gray-500">
              현재 회신가: <b class="tabular-nums">{{ fmtPcbAmount(detail.currency, detail.priceOriginal) }}</b>
            </span>
          </div>
        </div>
      </section>
    </template>

    <div v-else class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
      견적요청을 찾을 수 없습니다.
    </div>
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
