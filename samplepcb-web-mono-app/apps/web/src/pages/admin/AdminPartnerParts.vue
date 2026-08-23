<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  PARTNER_PART_FLAG_LABELS,
  partnerPartVisibleFlags,
  PARTNER_PART_UPLOAD_STATUS_LABELS,
} from '@sp/api-contract';
import {
  useAdminCommitPartnerPartUpload,
  useAdminPartnerPartList,
  useAdminPartnerPartConfig,
  useAdminPartnerPartSummary,
  useUpdateAdminPartnerPartConfig,
  useAdminPartnerPartUpload,
  useAdminPartnerPartUploads,
  useBulkToggleAdminPartnerParts,
  useClearAdminPartnerParts,
  useDeleteAdminPartnerPart,
  useToggleAdminPartnerParts,
  useUpdateAdminPartnerPart,
} from '../../admin/useAdminPartnerParts';
import PartnerPartEditModal from '../../components/partner/PartnerPartEditModal.vue';
import type { PartnerPartRowType, PartnerPartUpdateBodyType } from '@sp/api-contract';
import { useAdminPartnerList } from '../../admin/useAdminPartners';
import UiPagination from '../../components/ui/UiPagination.vue';
import { confirmDialog } from '../../lib/confirmDialog';

// 협력사 보유 부품 뒤처리(docs/PARTNER_PARTS.md).
//
// 이 기능은 만료도, 견적요청 제한도 두지 않는다 — 협력사 정보가 낡거나 안 맞아도 관리자가
// 운영으로 뒤처리한다는 결정(2026-08-23)이다. 그 결정이 성립하려면 **뒤처리가 여기서
// 1~2클릭으로 끝나야 한다**: 낡은 원장을 위로 올려 보여 주고, 끄고(비활성), 비우고,
// 포털 계정이 없는 협력사는 대신 올린다.

const PAGE_SIZE = 50;

const summaryQuery = useAdminPartnerPartSummary();
const configQuery = useAdminPartnerPartConfig();
const updateConfig = useUpdateAdminPartnerPartConfig();

// 낡음 기준일 — 삭제 기준이 아니라 **표시 기준**이다(만료를 두지 않기로 했으므로).
// 협력사·품목군마다 재고표 갱신 주기가 달라 운영에서 맞춘다.
const staleEditing = ref(false);
const staleDraft = ref('');
function openStaleEdit(): void {
  staleDraft.value = String(staleAfterDays.value);
  staleEditing.value = true;
}
async function saveStale(): Promise<void> {
  const days = Number(staleDraft.value.trim());
  if (!Number.isInteger(days) || days < 1 || days > 3650) return;
  await updateConfig.mutateAsync({ staleAfterDays: days });
  staleEditing.value = false;
}
const selectedPartnerId = ref<number | null>(null);
const q = ref('');
const page = ref(1);
const includeInactive = ref(true);
watch([q, selectedPartnerId, includeInactive], () => {
  page.value = 1;
});

const listParams = computed(() => ({
  q: q.value,
  page: page.value,
  pageSize: PAGE_SIZE,
  partnerId: selectedPartnerId.value,
  includeInactive: includeInactive.value,
}));
const listQuery = useAdminPartnerPartList(listParams);
const uploadsQuery = useAdminPartnerPartUploads(selectedPartnerId);

const toggleAll = useToggleAdminPartnerParts();
const bulkToggle = useBulkToggleAdminPartnerParts();
const deleteRow = useDeleteAdminPartnerPart();
const clearLedger = useClearAdminPartnerParts();
const proxyUpload = useAdminPartnerPartUpload();
const commitUpload = useAdminCommitPartnerPartUpload();
const updateRow = useUpdateAdminPartnerPart();

// 행 수정 — 협력사가 못 고치는 상황(포털 계정 없음·응답 없음)에서 관리자가 바로잡는다.
const editing = ref<PartnerPartRowType | null>(null);
// 방금 저장한 행을 잠깐 밝힌다 — 정렬 키가 수정으로 안 바뀌니 행은 제자리에 있고,
// 그래서 "어디로 갔지"가 아니라 "이 줄이 반영됐다"만 보여 주면 된다.
const justSaved = ref<number | null>(null);
let savedTimer: ReturnType<typeof setTimeout> | null = null;
function markSaved(partId: number): void {
  justSaved.value = partId;
  if (savedTimer !== null) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    justSaved.value = null;
  }, 2500);
}
onBeforeUnmount(() => {
  if (savedTimer !== null) clearTimeout(savedTimer);
});

const saveEdit = async (partId: number, body: PartnerPartUpdateBodyType): Promise<void> => {
  await updateRow.mutateAsync({ partId, body });
};

const summaries = computed(() => summaryQuery.data.value?.data.items ?? []);
const staleAfterDays = computed(() =>
  configQuery.data.value?.data.staleAfterDays ?? summaryQuery.data.value?.data.staleAfterDays ?? 90);
const totalActive = computed(() => summaryQuery.data.value?.data.totalActiveParts ?? 0);
const staleCount = computed(() => summaries.value.filter((s) => s.stale).length);
const items = computed(() => listQuery.data.value?.data.items ?? []);
const total = computed(() => listQuery.data.value?.data.total ?? 0);
const uploads = computed(() => uploadsQuery.data.value?.data.items ?? []);
const selectedSummary = computed(
  () => summaries.value.find((s) => s.partnerId === selectedPartnerId.value) ?? null,
);

// 대행 업로드 대상 — 승인된 사람 협력사 전부(원장이 없는 곳도 골라야 하므로 별도 조회).
const partnerFilters = ref({ page: 1, pageSize: 200, tab: 'approved' as const, type: 'partner' as const, q: '' });
const partnerListQuery = useAdminPartnerList(partnerFilters);
const partnerOptions = computed(() =>
  (partnerListQuery.data.value?.data.items ?? []).filter((p) =>
    p.capabilities.includes('part_sale'),
  ),
);

const selection = ref<Set<number>>(new Set());
watch([items], () => {
  selection.value = new Set();
});
const toggleRow = (partId: number): void => {
  const next = new Set(selection.value);
  if (next.has(partId)) next.delete(partId);
  else next.add(partId);
  selection.value = next;
};

const error = ref<string | null>(null);
const uploadTargetId = ref<number | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const asMessage = (caught: unknown, fallback: string): string =>
  caught instanceof ApiRequestError ? (caught.payload?.message ?? fallback) : fallback;

const runToggleAll = async (partnerId: number, isActive: boolean): Promise<void> => {
  const ok = await confirmDialog({
    title: isActive ? '이 협력사 부품을 다시 켤까요?' : '이 협력사 부품을 끌까요?',
    message: isActive
      ? '고객 BOM 분석에서 다시 후보로 뜹니다.'
      : '목록은 남지만 고객 BOM 분석에서 후보로 뜨지 않습니다. 언제든 다시 켤 수 있습니다.',
    confirmLabel: isActive ? '켜기' : '끄기',
  });
  if (!ok) return;
  await toggleAll.mutateAsync({ partnerId, isActive });
};

const runClear = async (partnerId: number, name: string): Promise<void> => {
  const ok = await confirmDialog({
    title: `${name} 의 보유 부품을 모두 지울까요?`,
    message: '되돌릴 수 없습니다. 협력사가 다시 올려야 복구됩니다.',
    confirmLabel: '모두 삭제',
    tone: 'danger',
  });
  if (!ok) return;
  await clearLedger.mutateAsync(partnerId);
};

const runBulk = async (isActive: boolean): Promise<void> => {
  if (selection.value.size === 0) return;
  await bulkToggle.mutateAsync({ partIds: [...selection.value], isActive });
  selection.value = new Set();
};

const runDeleteRow = async (partId: number, mpn: string): Promise<void> => {
  const ok = await confirmDialog({
    title: '이 행을 지울까요?',
    message: mpn,
    confirmLabel: '삭제',
    tone: 'danger',
  });
  if (!ok) return;
  await deleteRow.mutateAsync(partId);
};

const pickProxyFile = (partnerId: number): void => {
  error.value = null;
  uploadTargetId.value = partnerId;
  fileInput.value?.click();
};

const onProxyFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  const partnerId = uploadTargetId.value;
  if (file === undefined || partnerId === null) return;
  try {
    const created = await proxyUpload.mutateAsync({ partnerId, file });
    const stats = created.data.upload.stats;
    const ok = await confirmDialog({
      title: '읽은 내용을 반영할까요?',
      message: `${file.name} — ${String(stats?.rowCount ?? 0)}행 (고유 품번 ${String(stats?.distinctMpnCount ?? 0)}). 전체 교체로 반영합니다.`,
      confirmLabel: '반영',
    });
    if (!ok) return;
    await commitUpload.mutateAsync({ uploadId: created.data.upload.uploadId, mode: 'replace' });
  } catch (caught) {
    error.value = asMessage(caught, '대행 업로드에 실패했습니다.');
  }
};

const fmtQty = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString('ko-KR');
const fmtDate = (iso: string | null): string =>
  iso === null ? '—' : new Date(iso).toLocaleDateString('ko-KR');
const flagLabel = (flag: string): string => PARTNER_PART_FLAG_LABELS[flag] ?? flag;
</script>

<template>
  <div class="space-y-4">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 class="text-xl font-bold text-gray-900">협력사 보유 부품</h1>
        <p class="mt-0.5 text-sm text-gray-500">
          협력사가 올린 재고 목록입니다. 만료를 두지 않으므로 낡은 목록은 여기서 끄거나 비웁니다.
        </p>
      </div>
      <div class="flex gap-3 text-sm">
        <div class="rounded-lg border border-gray-200 bg-surface px-3 py-2">
          <p class="text-xs text-gray-500">등록 부품</p>
          <p class="text-lg font-bold tabular-nums">{{ fmtQty(totalActive) }}</p>
        </div>
        <div
          class="rounded-lg border px-3 py-2"
          :class="staleCount > 0 ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-surface'"
        >
          <p class="flex items-center gap-1 text-xs" :class="staleCount > 0 ? 'text-amber-700' : 'text-gray-500'">
            <template v-if="staleEditing">
              <input
                v-model="staleDraft"
                type="text"
                inputmode="numeric"
                class="w-12 rounded border border-gray-300 px-1 py-0.5 text-right text-xs tabular-nums"
                aria-label="낡음 기준일"
                @keyup.enter="void saveStale()"
              >일 경과
              <button type="button" class="font-semibold text-blue-600 hover:underline" @click="void saveStale()">저장</button>
              <button type="button" class="text-gray-400 hover:underline" @click="staleEditing = false">취소</button>
            </template>
            <template v-else>
              {{ staleAfterDays }}일 경과
              <button
                type="button"
                class="text-gray-400 hover:text-blue-600 hover:underline"
                title="낡음으로 볼 기준일을 바꿉니다 — 표시 기준일 뿐 원장을 지우지 않습니다"
                @click="openStaleEdit"
              >
                기준 변경
              </button>
            </template>
          </p>
          <p class="text-lg font-bold tabular-nums" :class="staleCount > 0 ? 'text-amber-800' : ''">
            {{ staleCount }}곳
          </p>
        </div>
      </div>
    </header>

    <p v-if="error !== null" role="alert" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ error }}
    </p>

    <!-- 협력사별 요약 — 낡은 것이 위로 -->
    <div class="overflow-x-auto rounded-xl border border-gray-200 bg-surface">
      <table class="w-full min-w-[860px] text-sm">
        <thead class="bg-gray-50 text-left text-xs text-gray-500">
          <tr>
            <th class="px-3 py-2 font-semibold">협력사</th>
            <th class="px-3 py-2 text-right font-semibold">사용 중</th>
            <th class="px-3 py-2 text-right font-semibold">꺼짐</th>
            <th class="px-3 py-2 font-semibold">마지막 업로드</th>
            <th class="px-3 py-2 font-semibold">파일</th>
            <th class="px-3 py-2 text-right font-semibold">뒤처리</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-if="summaries.length === 0">
            <td colspan="6" class="px-3 py-6 text-center text-sm text-gray-400">
              아직 올라온 협력사 부품이 없습니다.
            </td>
          </tr>
          <tr
            v-for="row in summaries"
            :key="row.partnerId"
            class="cursor-pointer hover:bg-gray-50/60"
            :class="selectedPartnerId === row.partnerId ? 'bg-blue-50/50' : ''"
            @click="selectedPartnerId = selectedPartnerId === row.partnerId ? null : row.partnerId"
          >
            <td class="px-3 py-2 font-medium text-gray-900">{{ row.partnerName }}</td>
            <td class="px-3 py-2 text-right tabular-nums">{{ fmtQty(row.activeCount) }}</td>
            <td class="px-3 py-2 text-right tabular-nums text-gray-400">
              {{ row.inactiveCount === 0 ? '—' : fmtQty(row.inactiveCount) }}
            </td>
            <td class="px-3 py-2">
              <span :class="row.stale ? 'font-semibold text-amber-700' : 'text-gray-600'">
                {{ fmtDate(row.lastUploadedAt) }}
                <template v-if="row.ageDays !== null">· {{ row.ageDays }}일 전</template>
              </span>
            </td>
            <td class="max-w-[220px] truncate px-3 py-2 text-xs text-gray-500">
              {{ row.lastUploadFileName ?? '—' }}
            </td>
            <td class="px-3 py-2 text-right" @click.stop>
              <div class="inline-flex gap-1">
                <button
                  v-if="row.activeCount > 0"
                  type="button"
                  class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  @click="void runToggleAll(row.partnerId, false)"
                >
                  끄기
                </button>
                <button
                  v-if="row.inactiveCount > 0"
                  type="button"
                  class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  @click="void runToggleAll(row.partnerId, true)"
                >
                  켜기
                </button>
                <button
                  type="button"
                  class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
                  @click="pickProxyFile(row.partnerId)"
                >
                  대행 업로드
                </button>
                <button
                  type="button"
                  class="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                  @click="void runClear(row.partnerId, row.partnerName)"
                >
                  비우기
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 대행 업로드 진입(원장이 아직 없는 협력사) -->
    <div class="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-surface p-3">
      <p class="text-sm font-semibold text-gray-800">대행 업로드</p>
      <p class="text-xs text-gray-500">포털 계정이 없는 협력사를 대신해 올립니다.</p>
      <select
        class="ml-auto rounded-md border border-gray-200 bg-surface px-2 py-1.5 text-sm"
        :value="uploadTargetId ?? ''"
        @change="uploadTargetId = Number(($event.target as HTMLSelectElement).value) || null"
      >
        <option value="">협력사 선택…</option>
        <option v-for="p in partnerOptions" :key="p.partnerId" :value="p.partnerId">
          {{ p.name }}
        </option>
      </select>
      <button
        type="button"
        class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
        :disabled="uploadTargetId === null || proxyUpload.isPending.value"
        @click="fileInput?.click()"
      >
        {{ proxyUpload.isPending.value ? '분석 중…' : '파일 선택' }}
      </button>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        accept=".xlsx,.xlsm,.xls,.csv,.tsv,.bom"
        @change="void onProxyFile($event)"
      >
    </div>

    <!-- 원장 행 -->
    <div class="rounded-xl border border-gray-200 bg-surface">
      <div class="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
        <p class="text-sm font-semibold text-gray-800">
          부품 행
          <span class="font-normal text-gray-500">
            {{ selectedSummary === null ? '(전체 협력사)' : `· ${selectedSummary.partnerName}` }}
            · {{ fmtQty(total) }}
          </span>
        </p>
        <button
          v-if="selectedPartnerId !== null"
          type="button"
          class="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
          @click="selectedPartnerId = null"
        >
          필터 해제
        </button>
        <label class="ml-auto flex items-center gap-1.5 text-xs text-gray-600">
          <input v-model="includeInactive" type="checkbox" class="accent-blue-600">
          꺼진 행도 보기
        </label>
        <input
          v-model="q"
          type="search"
          placeholder="품번·제조사 검색"
          aria-label="품번·제조사 검색"
          class="w-56 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-sm focus:border-blue-400 focus:outline-none"
        >
      </div>

      <div
        v-if="selection.size > 0"
        class="flex items-center gap-2 border-b border-gray-100 bg-blue-50/60 px-3 py-2 text-sm"
      >
        <span class="font-medium text-blue-900">{{ selection.size }}행 선택</span>
        <button
          type="button"
          class="rounded border border-gray-300 bg-surface px-2 py-1 text-xs hover:bg-gray-50"
          @click="void runBulk(false)"
        >
          끄기
        </button>
        <button
          type="button"
          class="rounded border border-gray-300 bg-surface px-2 py-1 text-xs hover:bg-gray-50"
          @click="void runBulk(true)"
        >
          켜기
        </button>
      </div>

      <p v-if="listQuery.isLoading.value" class="p-6 text-sm text-gray-400">불러오는 중…</p>
      <p v-else-if="items.length === 0" class="p-6 text-sm text-gray-400">결과가 없습니다.</p>
      <template v-else>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[940px] text-sm">
            <thead class="bg-gray-50 text-left text-xs text-gray-500">
              <tr>
                <th class="w-8 px-3 py-2" />
                <th class="px-3 py-2 font-semibold">품번</th>
                <th class="px-3 py-2 font-semibold">협력사</th>
                <th class="px-3 py-2 font-semibold">제조사</th>
                <th class="px-3 py-2 text-right font-semibold">재고</th>
                <th class="px-3 py-2 font-semibold">D/C</th>
                <th class="px-3 py-2 font-semibold">기준일</th>
                <th class="px-3 py-2" />
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              <tr
                v-for="part in items"
                :key="part.partId"
                class="transition-colors"
                :class="[
                  part.isActive ? '' : 'bg-gray-50 text-gray-400',
                  justSaved === part.partId ? 'bg-blue-50' : '',
                ]"
              >
                <td class="px-3 py-2">
                  <input
                    type="checkbox"
                    class="accent-blue-600"
                    :checked="selection.has(part.partId)"
                    :aria-label="`${part.mpn} 선택`"
                    @change="toggleRow(part.partId)"
                  >
                </td>
                <td class="px-3 py-2">
                  <p class="font-medium" :class="part.isActive ? 'text-gray-900' : ''">
                    {{ part.mpn }}
                  </p>
                  <p v-if="part.mpnRaw !== part.mpn" class="text-[11px] text-gray-400">
                    원문 {{ part.mpnRaw }}
                  </p>
                  <span
                    v-if="part.editedAt !== null"
                    class="mr-1 mt-0.5 inline-block rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700"
                    :title="`수정됨 · ${fmtDate(part.editedAt)}`"
                  >수정됨</span>
                  <span
                    v-for="flag in partnerPartVisibleFlags(part.flags)"
                    :key="flag"
                    class="mr-1 mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800"
                  >
                    {{ flagLabel(flag) }}
                  </span>
                </td>
                <td class="px-3 py-2">{{ part.partnerName ?? '—' }}</td>
                <td class="px-3 py-2">{{ part.manufacturer ?? '—' }}</td>
                <td class="px-3 py-2 text-right tabular-nums">{{ fmtQty(part.stockQty) }}</td>
                <td class="px-3 py-2">{{ part.dateCode ?? '—' }}</td>
                <td class="px-3 py-2 text-xs">{{ fmtDate(part.uploadedAt) }}</td>
                <td class="whitespace-nowrap px-3 py-2 text-right">
                  <button
                    type="button"
                    class="rounded px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                    @click="editing = part"
                  >
                    수정
                  </button>
                  <button
                    type="button"
                    class="rounded px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
                    @click="void runDeleteRow(part.partId, part.mpn)"
                  >
                    삭제
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="total > PAGE_SIZE" class="flex justify-end border-t border-gray-100 p-3">
          <UiPagination
            :page="page"
            :page-size="PAGE_SIZE"
            :total="total"
            @update:page="(p) => (page = p)"
          />
        </div>
      </template>
    </div>

    <!-- 선택 협력사의 업로드 이력 -->
    <div v-if="selectedPartnerId !== null && uploads.length > 0" class="rounded-xl border border-gray-200 bg-surface p-3">
      <p class="mb-2 text-sm font-semibold text-gray-800">업로드 이력</p>
      <ul class="divide-y divide-gray-100 text-sm">
        <li
          v-for="upload in uploads"
          :key="upload.uploadId"
          class="flex flex-wrap items-center justify-between gap-2 py-2"
        >
          <div class="min-w-0">
            <p class="truncate text-gray-800">{{ upload.fileName }}</p>
            <p class="text-xs text-gray-400">
              {{ fmtDate(upload.createdAt) }} ·
              {{ upload.uploadedBy === 'ADMIN' ? '관리자 대행' : '협력사 직접' }}
              <template v-if="upload.stats !== null">
                · {{ fmtQty(upload.stats.rowCount) }}행
              </template>
              · 현재 {{ fmtQty(upload.activePartCount) }}행 사용 중
            </p>
          </div>
          <span
            class="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            :class="upload.status === 'applied'
              ? 'bg-emerald-50 text-emerald-700'
              : upload.status === 'failed'
                ? 'bg-red-50 text-red-600'
                : 'bg-gray-100 text-gray-600'"
          >
            {{ PARTNER_PART_UPLOAD_STATUS_LABELS[upload.status] }}
          </span>
        </li>
      </ul>
    </div>

    <PartnerPartEditModal
      :part="editing"
      :save="saveEdit"
      :busy="updateRow.isPending.value"
      @close="editing = null"
      @saved="
        markSaved(editing?.partId ?? 0);
        editing = null;
      "
    />
  </div>
</template>
