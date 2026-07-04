<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { ApiRequestError } from '@sp/shared';
import {
  downloadAdminFile,
  useAdminQuoteDetail,
  useConfirmPrice,
  useSaveCompanyName,
} from '../../admin/useAdminQuotes';
import { formatBytes, formatDate, formatDateTime, formatKrw } from '../../lib/format';
import UiBadge from '../ui/UiBadge.vue';
import DeleteQuoteModal from './DeleteQuoteModal.vue';
import EstimateModal from './EstimateModal.vue';

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

const {
  mutate: saveCompanyName,
  isPending: savingCompany,
  isSuccess: companySaved,
  isError: companySaveFailed,
  reset: resetCompany,
} = useSaveCompanyName();

// 가격 입력 — 프로젝트가 바뀔 때만 현재가(확정가 ?? 표시가)로 리필
const priceInput = ref('');
const localError = ref<string | null>(null);
const filledFor = ref<number | null>(null);

// 회사명 입력 — 가격 입력과 같은 filledFor 가드로 프로젝트 전환 시에만 현재값(해석값)으로
// 동기화(같은 프로젝트 재조회 때는 편집 중인 입력을 덮어쓰지 않음).
const companyNameInput = ref('');

watch(detail, (d) => {
  if (d !== null && filledFor.value !== d.projectId) {
    filledFor.value = d.projectId;
    priceInput.value = d.finalPrice !== null ? String(d.finalPrice) : d.price !== null ? String(d.price) : '';
    companyNameInput.value = d.companyName ?? '';
    localError.value = null;
    resetConfirm();
    resetCompany();
  }
});

// 저장 버튼은 값이 실제로 바뀌었을 때만 활성(트림 기준으로 현재 표시값과 비교).
const companyNameChanged = computed<boolean>(() => {
  const d = detail.value;
  if (d === null) return false;
  return companyNameInput.value.trim() !== (d.companyName ?? '');
});

const submitCompanyName = (): void => {
  const d = detail.value;
  if (d === null || !companyNameChanged.value) return;
  resetCompany();
  // 빈 문자열이면 스냅샷 삭제(서버가 회원 프로필 fallback 을 반영해 응답)
  saveCompanyName({ projectId: d.projectId, companyName: companyNameInput.value.trim() });
};

const blockedReason = computed<string | null>(() => {
  const d = detail.value;
  if (d === null) return null;
  if (d.status !== 'active') return t('admin.quotes.confirmBlocked.deleted');
  if (d.cartState === 'cart') return t('admin.quotes.confirmBlocked.cart');
  if (d.cartState === 'ordered') return t('admin.quotes.confirmBlocked.ordered');
  return null;
});

// 견적서 — 가격이 확정(price != null)된 활성 견적만 발행 가능. 비활성 시 사유를 노출.
const estimateProjectId = ref<number | null>(null);
const estimateEnabled = computed<boolean>(() => {
  const d = detail.value;
  return d !== null && d.status === 'active' && d.price !== null;
});
const estimateBlockedReason = computed<string>(() => {
  const d = detail.value;
  if (d === null) return '';
  if (d.status !== 'active') return t('admin.quotes.estimate.blockedDeleted');
  if (d.price === null) return t('admin.quotes.estimate.blockedRfq');
  return '';
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

// 완전삭제 모달 — 삭제 버튼으로 열고, 삭제 성공 시 드로어까지 닫는다(항목이 사라짐).
// 배치 모달을 batch-of-1(ids=[projectId])로 재사용한다.
const deleteProjectId = ref<number | null>(null);
const deleteIds = computed<number[]>(() =>
  deleteProjectId.value !== null ? [deleteProjectId.value] : [],
);
const onDeleted = (): void => {
  deleteProjectId.value = null;
  emit('close');
};

const onKeydown = (e: KeyboardEvent): void => {
  // 위에 뜬 모달(견적서/삭제)이 ESC 를 처리 — 드로어까지 이중으로 닫히는 것을 막는다.
  if (e.key === 'Escape' && estimateProjectId.value === null && deleteProjectId.value === null) {
    emit('close');
  }
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

            <!-- 견적서 -->
            <div class="mt-4">
              <button
                v-if="estimateEnabled"
                type="button"
                class="w-full rounded-md border border-blue-600 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
                @click="estimateProjectId = detail.projectId"
              >
                {{ t('admin.quotes.estimate.button') }}
              </button>
              <p v-else class="rounded-md bg-gray-50 px-3 py-2 text-center text-sm text-gray-400">
                {{ estimateBlockedReason }}
              </p>
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

              <!-- 회사명 (수신처 스냅샷 + 회원 프로필 2층) — 비회원도 스냅샷 저장 가능 -->
              <div class="mt-3 border-t border-gray-100 pt-3">
                <label class="text-xs text-gray-400">
                  {{ t('admin.quotes.drawer.companyName') }}
                </label>
                <div class="mt-1 flex items-center gap-2">
                  <input
                    v-model="companyNameInput"
                    type="text"
                    class="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                    @keydown.enter="submitCompanyName"
                  >
                  <button
                    type="button"
                    class="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    :disabled="!companyNameChanged || savingCompany"
                    @click="submitCompanyName"
                  >
                    {{ t('admin.quotes.drawer.companySave') }}
                  </button>
                </div>
                <p v-if="companySaveFailed" class="mt-1 text-xs text-red-600">
                  {{ t('admin.quotes.drawer.companySaveFailed') }}
                </p>
                <p v-else-if="companySaved" class="mt-1 text-xs text-green-700">
                  {{ t('admin.quotes.drawer.companySaveSuccess') }}
                </p>
              </div>
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

            <!-- 완전삭제 (danger) -->
            <section class="mt-6 border-t border-red-100 pt-4">
              <button
                type="button"
                class="w-full rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                @click="deleteProjectId = detail.projectId"
              >
                {{ t('admin.quotes.drawer.delete') }}
              </button>
            </section>
          </template>
        </div>
      </aside>
      <EstimateModal
        v-if="estimateProjectId !== null"
        :project-id="estimateProjectId"
        @close="estimateProjectId = null"
      />
      <DeleteQuoteModal
        v-if="deleteProjectId !== null"
        :ids="deleteIds"
        @close="deleteProjectId = null"
        @deleted="onDeleted"
      />
    </div>
  </Teleport>
</template>
