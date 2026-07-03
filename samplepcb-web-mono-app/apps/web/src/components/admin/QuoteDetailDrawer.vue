<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import {
  downloadAdminFile,
  useAdminQuoteDetail,
  useConfirmPrice,
} from '../../admin/useAdminQuotes';
import { formatBytes, formatDate, formatDateTime, formatKrw } from '../../lib/format';
import UiBadge from '../ui/UiBadge.vue';

// 견적 상세 드로어 — 우측 슬라이드 오버. 파일 다운로드와 가격 확정(rfq 확정·priced
// 조정·quoted 재확정)을 담당한다. cart/ordered/deleted 는 서버 가드와 동일 사유로
// 폼을 비활성화한다(진짜 경계는 서버 409).
const props = defineProps<{ projectId: number | null }>();
const emit = defineEmits<{ close: [] }>();
// te 는 구조분해하면 unbound-method(lint) — 컴포저 인스턴스로 호출한다
const i18n = useI18n();
const { t } = i18n;

const projectIdRef = computed(() => props.projectId);
const { data, isLoading } = useAdminQuoteDetail(projectIdRef);
const detail = computed(() => data.value?.data ?? null);

const {
  mutate: confirmPrice,
  isPending: confirming,
  isSuccess: confirmed,
  error: confirmError,
  reset: resetConfirm,
} = useConfirmPrice();

// 가격 입력 — 프로젝트가 바뀔 때만 현재가(확정가 ?? 표시가)로 리필
const priceInput = ref('');
const localError = ref<string | null>(null);
const filledFor = ref<number | null>(null);

watch(detail, (d) => {
  if (d !== null && filledFor.value !== d.projectId) {
    filledFor.value = d.projectId;
    priceInput.value = d.finalPrice !== null ? String(d.finalPrice) : d.price !== null ? String(d.price) : '';
    localError.value = null;
    resetConfirm();
  }
});

const blockedReason = computed<string | null>(() => {
  const d = detail.value;
  if (d === null) return null;
  if (d.status !== 'active') return t('admin.quotes.confirmBlocked.deleted');
  if (d.cartState === 'cart') return t('admin.quotes.confirmBlocked.cart');
  if (d.cartState === 'ordered') return t('admin.quotes.confirmBlocked.ordered');
  return null;
});

const submit = (): void => {
  const d = detail.value;
  if (d === null || blockedReason.value !== null) return;
  const n = Number(priceInput.value.replaceAll(',', '').trim());
  if (!Number.isInteger(n) || n <= 0) {
    localError.value = t('admin.quotes.drawer.invalidPrice');
    return;
  }
  localError.value = null;
  confirmPrice({ projectId: d.projectId, finalPrice: n });
};

const errorMessage = computed<string | null>(() => {
  if (localError.value !== null) return localError.value;
  const err = confirmError.value;
  if (err === null) return null;
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined && i18n.te(`admin.quotes.error.${code}`)) {
      return t(`admin.quotes.error.${code}`);
    }
    return err.payload?.message ?? t('admin.quotes.error.UNKNOWN');
  }
  return t('admin.quotes.error.UNKNOWN');
});

// 사양 표 — 알려진 키는 라벨링(i18n), 미등록 키는 원문 그대로(계약 catchall 대응)
const specEntries = computed<[string, string][]>(() => {
  const d = detail.value;
  if (d === null) return [];
  return Object.entries(d.spec)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => [
      i18n.te(`admin.quotes.specKeys.${key}`) ? t(`admin.quotes.specKeys.${key}`) : key,
      String(value),
    ]);
});

const downloadingId = ref<number | null>(null);
const fileError = ref<string | null>(null);
const onDownload = async (fileId: number, fileName: string): Promise<void> => {
  downloadingId.value = fileId;
  fileError.value = null;
  try {
    await downloadAdminFile(fileId, fileName);
  } catch {
    fileError.value = t('admin.quotes.drawer.downloadFailed');
  } finally {
    downloadingId.value = null;
  }
};

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape') emit('close');
};
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="props.projectId !== null" class="fixed inset-0 z-40">
      <div class="absolute inset-0 bg-black/30" @click="emit('close')" />
      <aside
        class="absolute right-0 top-0 flex h-full w-[30rem] max-w-full flex-col bg-white shadow-xl"
      >
        <!-- 헤더 -->
        <header class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-bold text-gray-900">
              {{ detail?.projectName ?? t('admin.quotes.drawer.title') }}
            </h2>
            <p class="text-xs text-gray-400">#{{ props.projectId }}</p>
          </div>
          <button
            type="button"
            class="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            @click="emit('close')"
          >
            {{ t('admin.quotes.drawer.close') }}
          </button>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-4">
          <p v-if="isLoading" class="py-8 text-center text-sm text-gray-400">…</p>

          <template v-else-if="detail !== null">
            <!-- 썸네일 + 상태 -->
            <div class="flex items-start gap-4">
              <img
                v-if="detail.thumbnailUrl !== null"
                :src="detail.thumbnailUrl"
                alt=""
                class="h-28 w-28 rounded-lg border border-gray-200 object-cover"
              >
              <div
                v-else
                class="flex h-28 w-28 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-sm font-semibold uppercase text-gray-400"
              >
                {{ detail.category.slice(0, 2) }}
              </div>
              <div class="space-y-2">
                <div class="flex flex-wrap gap-1">
                  <UiBadge
                    :variant="detail.quoteStatus"
                    :label="t(`admin.quotes.badge.${detail.quoteStatus}`)"
                  />
                  <UiBadge
                    v-if="detail.cartState !== 'none'"
                    :variant="detail.cartState"
                    :label="t(`admin.quotes.badge.${detail.cartState}`)"
                  />
                  <UiBadge
                    v-if="detail.status === 'deleted'"
                    variant="deleted"
                    :label="t('admin.quotes.badge.deleted')"
                  />
                </div>
                <p class="text-sm text-gray-600">{{ detail.optionSummary }}</p>
                <p class="text-lg font-bold text-gray-900">
                  <template v-if="detail.price !== null">{{ formatKrw(detail.price) }}</template>
                  <span v-else class="text-base font-medium text-amber-600">
                    {{ t('admin.quotes.badge.rfq') }}
                  </span>
                </p>
              </div>
            </div>

            <!-- 가격 확정 -->
            <section class="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.quotes.drawer.finalPriceLabel') }}
              </h3>
              <p v-if="blockedReason !== null" class="mt-2 text-sm text-gray-500">
                {{ blockedReason }}
              </p>
              <template v-else>
                <div class="mt-2 flex items-center gap-2">
                  <input
                    v-model="priceInput"
                    type="text"
                    inputmode="numeric"
                    class="w-40 rounded-md border border-gray-300 px-3 py-1.5 text-right text-sm tabular-nums focus:border-blue-500 focus:outline-none"
                    @keydown.enter="submit"
                  >
                  <span class="text-sm text-gray-500">원</span>
                  <button
                    type="button"
                    class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    :disabled="confirming"
                    @click="submit"
                  >
                    {{
                      detail.quoteStatus === 'quoted'
                        ? t('admin.quotes.drawer.reconfirm')
                        : t('admin.quotes.drawer.confirm')
                    }}
                  </button>
                </div>
                <p v-if="errorMessage !== null" class="mt-2 text-sm text-red-600">
                  {{ errorMessage }}
                </p>
                <p v-else-if="confirmed" class="mt-2 text-sm text-green-700">
                  {{ t('admin.quotes.drawer.confirmSuccess') }}
                </p>
              </template>
              <p
                v-if="detail.pricedBy !== null && detail.pricedAt !== null"
                class="mt-2 text-xs text-gray-400"
              >
                {{
                  t('admin.quotes.drawer.pricedInfo', {
                    by: detail.pricedBy,
                    at: formatDateTime(detail.pricedAt),
                  })
                }}
              </p>
            </section>

            <!-- 신청자 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.quotes.drawer.applicant') }}
              </h3>
              <dl v-if="detail.applicant !== null" class="mt-2 space-y-1 text-sm">
                <div class="flex gap-2">
                  <dt class="w-20 shrink-0 text-gray-400">ID</dt>
                  <dd class="text-gray-800">
                    {{ detail.applicant.name !== '' ? detail.applicant.name : '-' }}
                    ({{ detail.applicant.mbId }})
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-20 shrink-0 text-gray-400">
                    {{ t('admin.quotes.drawer.contact') }}
                  </dt>
                  <dd class="text-gray-800">
                    {{ detail.applicant.phone !== '' ? detail.applicant.phone : '-' }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-20 shrink-0 text-gray-400">
                    {{ t('admin.quotes.drawer.email') }}
                  </dt>
                  <dd class="text-gray-800">
                    {{ detail.applicant.email !== '' ? detail.applicant.email : '-' }}
                  </dd>
                </div>
              </dl>
              <p v-else class="mt-2 text-sm text-gray-400">
                {{ t('admin.quotes.table.guest') }}
              </p>
            </section>

            <!-- 파일 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.quotes.drawer.files') }}
              </h3>
              <ul class="mt-2 space-y-1.5">
                <li
                  v-for="file in detail.files"
                  :key="file.fileId"
                  class="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm"
                >
                  <div class="min-w-0">
                    <p class="truncate text-gray-800">{{ file.originFileName }}</p>
                    <p class="text-xs text-gray-400">
                      {{ file.fileType ?? '-' }} · {{ formatBytes(file.size) }} ·
                      {{ formatDate(file.writeDate) }}
                    </p>
                  </div>
                  <button
                    type="button"
                    class="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                    :disabled="downloadingId === file.fileId"
                    @click="onDownload(file.fileId, file.originFileName)"
                  >
                    {{ t('admin.quotes.drawer.download') }}
                  </button>
                </li>
              </ul>
              <p v-if="fileError !== null" class="mt-2 text-sm text-red-600">{{ fileError }}</p>
            </section>

            <!-- 견적 스냅샷 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.quotes.drawer.quoteSnapshot') }}
              </h3>
              <dl v-if="detail.quote !== null" class="mt-2 space-y-1 text-sm">
                <div class="flex gap-2">
                  <dt class="w-24 shrink-0 text-gray-400">
                    {{ t('admin.quotes.drawer.autoPrice') }}
                  </dt>
                  <dd class="text-gray-800">
                    {{ detail.quote.autoPrice !== null ? formatKrw(detail.quote.autoPrice) : '-' }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-24 shrink-0 text-gray-400">{{ t('admin.quotes.drawer.eta') }}</dt>
                  <dd class="text-gray-800">{{ detail.quote.eta ?? '-' }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-24 shrink-0 text-gray-400">
                    {{ t('admin.quotes.drawer.priceVersion') }}
                  </dt>
                  <dd class="text-gray-800">{{ detail.quote.priceVersion }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-24 shrink-0 text-gray-400">
                    {{ t('admin.quotes.drawer.expiresAt') }}
                  </dt>
                  <dd class="text-gray-800">{{ formatDateTime(detail.quote.expiresAt) }}</dd>
                </div>
              </dl>
              <p v-else class="mt-2 text-sm text-gray-400">
                {{ t('admin.quotes.drawer.noQuote') }}
              </p>
            </section>

            <!-- 요청 메모 -->
            <section v-if="detail.message !== null && detail.message !== ''" class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.quotes.drawer.message') }}
              </h3>
              <p class="mt-2 whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-sm text-gray-700">
                {{ detail.message }}
              </p>
            </section>

            <!-- 사양 전체 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.quotes.drawer.spec') }}
              </h3>
              <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div
                  v-for="[label, value] in specEntries"
                  :key="label"
                  class="flex justify-between gap-2 border-b border-gray-100 py-1"
                >
                  <dt class="text-gray-400">{{ label }}</dt>
                  <dd class="text-right text-gray-800">{{ value }}</dd>
                </div>
              </dl>
              <p class="mt-2 text-xs text-gray-400">
                {{ t('admin.quotes.drawer.requestedAt') }}: {{ formatDateTime(detail.createdAt) }}
              </p>
            </section>
          </template>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
