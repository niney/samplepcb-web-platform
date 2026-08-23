<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import {
  PARTNER_PART_FLAG_LABELS,
  partnerPartVisibleFlags,
  PARTNER_PART_UPLOAD_STATUS_LABELS,
} from '@sp/api-contract';
import { usePartnerAccess } from '../../partner/usePartnerAccess';
import {
  useCreatePartnerPartUpload,
  useDeletePartnerPart,
  usePartnerPartList,
  usePartnerPartSummary,
  usePartnerPartUploads,
  useUpdatePartnerPart,
} from '../../partner/usePartnerParts';
import type { PartnerPartRowType, PartnerPartUpdateBodyType } from '@sp/api-contract';
import PartnerPageHeader from '../../components/partner/PartnerPageHeader.vue';
import PartnerPartEditModal from '../../components/partner/PartnerPartEditModal.vue';
import PartnerEmpty from '../../components/partner/PartnerEmpty.vue';
import UiPagination from '../../components/ui/UiPagination.vue';
import { confirmDialog } from '../../lib/confirmDialog';

// 협력사 보유 부품(docs/PARTNER_PARTS.md) — 재고표를 올리면 고객 BOM 분석에서 기존
// 공급사와 같은 자리에서(다만 뒤순위로) 후보가 된다. 가격은 여기서 정해지지 않고
// 견적요청 회신이 정본이므로, 이 화면은 "무엇을 갖고 있다고 알렸는가"만 다룬다.
//
// 만료는 두지 않는다 — 대신 마지막 업로드 나이를 상단에 항상 보인다.

const PAGE_SIZE = 50;
const ALLOWED_EXTS = ['.xlsx', '.xlsm', '.xls', '.csv', '.tsv', '.bom'];
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const router = useRouter();
const access = usePartnerAccess();
const noTrack = computed(() => access.data.value?.data.tracks.parts === false);

const q = ref('');
const page = ref(1);
watch(q, () => {
  page.value = 1;
});
const listParams = computed(() => ({ q: q.value, page: page.value, pageSize: PAGE_SIZE }));

const summaryQuery = usePartnerPartSummary();
const listQuery = usePartnerPartList(listParams);
const uploadsQuery = usePartnerPartUploads();
const createUpload = useCreatePartnerPartUpload();
const deletePart = useDeletePartnerPart();
const updatePart = useUpdatePartnerPart();

// 행 수정 — 오타 품번·빠진 제조사를 전체 재업로드 없이 고친다.
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
  await updatePart.mutateAsync({ partId, body });
};

const summary = computed(() => summaryQuery.data.value?.data.summary ?? null);
const staleAfterDays = computed(() => summaryQuery.data.value?.data.staleAfterDays ?? 90);
const items = computed(() => listQuery.data.value?.data.items ?? []);
const total = computed(() => listQuery.data.value?.data.total ?? 0);
// 확인 대기 회차가 있으면 새 업로드 대신 이어서 확인하도록 유도한다(서버도 409로 막는다).
const pendingUpload = computed(
  () =>
    uploadsQuery.data.value?.data.items.find(
      (u) => u.status === 'preview' || u.status === 'parsing',
    ) ?? null,
);
const recentUploads = computed(() => uploadsQuery.data.value?.data.items.slice(0, 5) ?? []);

const fileInput = ref<HTMLInputElement | null>(null);
const error = ref<string | null>(null);
const dragging = ref(false);

const pickFile = (): void => {
  error.value = null;
  fileInput.value?.click();
};

const submitFile = async (file: File): Promise<void> => {
  error.value = null;
  const lower = file.name.toLowerCase();
  if (!ALLOWED_EXTS.some((ext) => lower.endsWith(ext))) {
    error.value = '지원하지 않는 파일 형식입니다 (xlsx · xls · csv · tsv)';
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    error.value = '파일이 50MB 를 초과합니다.';
    return;
  }
  try {
    const created = await createUpload.mutateAsync(file);
    await router.push({
      name: 'partner-parts-upload',
      params: { uploadId: String(created.data.upload.uploadId) },
    });
  } catch (caught) {
    error.value =
      caught instanceof ApiRequestError
        ? (caught.payload?.message ?? '업로드에 실패했습니다.')
        : '업로드에 실패했습니다.';
  }
};

const onFileChange = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = ''; // 같은 파일 재선택 허용
  if (file !== undefined) void submitFile(file);
};

const onDrop = (event: DragEvent): void => {
  dragging.value = false;
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) void submitFile(file);
};

const removePart = async (partId: number, mpn: string): Promise<void> => {
  const ok = await confirmDialog({
    title: '이 부품을 원장에서 지울까요?',
    message: `${mpn} — 고객 BOM 분석에서 더는 후보로 뜨지 않습니다.`,
    confirmLabel: '삭제',
    tone: 'danger',
  });
  if (!ok) return;
  await deletePart.mutateAsync(partId);
};

const fmtQty = (value: number | null): string =>
  value === null ? '—' : value.toLocaleString('ko-KR');
const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('ko-KR');
const flagLabel = (flag: string): string => PARTNER_PART_FLAG_LABELS[flag] ?? flag;
</script>

<template>
  <div class="space-y-4">
    <PartnerPageHeader
      title="보유 부품"
      subtitle="갖고 계신 재고 목록을 올리면 고객 BOM 분석에서 후보로 뜨고, 담당자가 견적을 요청하기 쉬워집니다."
    />

    <div
      v-if="noTrack"
      class="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800"
    >
      이 조직은 부품 판매 트랙에 참여하지 않습니다. 담당자에게 문의하세요.
    </div>

    <template v-else>
      <!-- 현황 — 만료를 두지 않는 대신 나이를 항상 보인다 -->
      <div class="grid gap-3 sm:grid-cols-3">
        <div class="rounded-xl border border-gray-200 bg-surface p-4">
          <p class="text-xs text-gray-500">등록된 부품</p>
          <p class="mt-1 text-2xl font-bold tabular-nums text-gray-900">
            {{ fmtQty(summary?.activeCount ?? 0) }}
          </p>
        </div>
        <div class="rounded-xl border border-gray-200 bg-surface p-4">
          <p class="text-xs text-gray-500">마지막 업로드</p>
          <p class="mt-1 text-sm font-semibold text-gray-900">
            {{ summary?.lastUploadedAt === null || summary === null
              ? '아직 없음'
              : `${fmtDate(summary.lastUploadedAt)} · ${String(summary.ageDays ?? 0)}일 전` }}
          </p>
          <p v-if="summary?.lastUploadFileName != null" class="mt-0.5 truncate text-xs text-gray-400">
            {{ summary.lastUploadFileName }}
          </p>
        </div>
        <div
          class="rounded-xl border p-4"
          :class="summary?.stale === true
            ? 'border-amber-300 bg-amber-50'
            : 'border-gray-200 bg-surface'"
        >
          <p class="text-xs" :class="summary?.stale === true ? 'text-amber-700' : 'text-gray-500'">
            정보 신선도
          </p>
          <p
            class="mt-1 text-sm font-semibold"
            :class="summary?.stale === true ? 'text-amber-800' : 'text-gray-900'"
          >
            {{ summary?.stale === true
              ? `${String(staleAfterDays)}일이 지났습니다 — 갱신을 권장합니다`
              : '최신 상태입니다' }}
          </p>
        </div>
      </div>

      <!-- 업로드 -->
      <div
        v-if="pendingUpload === null"
        class="rounded-xl border-2 border-dashed p-6 text-center transition"
        :class="dragging ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-surface'"
        @dragover.prevent="dragging = true"
        @dragleave.prevent="dragging = false"
        @drop.prevent="onDrop"
      >
        <p class="text-sm font-semibold text-gray-800">재고 목록 파일을 올려 주세요</p>
        <p class="mt-1 text-xs text-gray-500">
          품번만 있어도 됩니다. 제조사·재고·데이트 코드·납기가 있으면 함께 읽습니다.
          형식이 달라도 열 이름을 보고 맞추며, 틀리면 다음 화면에서 고칠 수 있습니다.
        </p>
        <button
          type="button"
          class="mt-3 rounded-md bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
          :disabled="createUpload.isPending.value"
          @click="pickFile"
        >
          {{ createUpload.isPending.value ? '분석 중…' : '파일 선택' }}
        </button>
        <p class="mt-2 text-[11px] text-gray-400">
          xlsx · xls · csv · tsv / 최대 50MB · 빈 열이 많으면 지우고 올리면 빨라집니다
        </p>
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept=".xlsx,.xlsm,.xls,.csv,.tsv,.bom"
          @change="onFileChange"
        >
      </div>

      <div
        v-else
        class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
      >
        <div class="min-w-0">
          <p class="text-sm font-semibold text-amber-900">확인 대기 중인 업로드가 있습니다</p>
          <p class="truncate text-xs text-amber-800">
            {{ pendingUpload.fileName }} ·
            {{ PARTNER_PART_UPLOAD_STATUS_LABELS[pendingUpload.status] }}
          </p>
        </div>
        <RouterLink
          :to="{ name: 'partner-parts-upload', params: { uploadId: String(pendingUpload.uploadId) } }"
          class="shrink-0 rounded-md bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
        >
          이어서 확인 →
        </RouterLink>
      </div>

      <p v-if="error !== null" role="alert" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {{ error }}
      </p>

      <!-- 원장 -->
      <div class="rounded-xl border border-gray-200 bg-surface">
        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 p-3">
          <p class="text-sm font-semibold text-gray-800">
            등록된 부품 <span class="tabular-nums text-gray-500">{{ fmtQty(total) }}</span>
          </p>
          <input
            v-model="q"
            type="search"
            placeholder="품번·제조사 검색"
            aria-label="품번·제조사 검색"
            class="w-56 rounded-md border border-gray-200 bg-surface px-2.5 py-1.5 text-sm focus:border-amber-400 focus:outline-none"
          >
        </div>

        <p v-if="listQuery.isLoading.value" class="p-6 text-sm text-gray-400">불러오는 중…</p>
        <div v-else-if="items.length === 0" class="p-4">
          <PartnerEmpty>
            {{ q.trim() === '' ? '아직 올린 부품이 없습니다.' : '검색 결과가 없습니다.' }}
          </PartnerEmpty>
        </div>
        <template v-else>
          <div class="overflow-x-auto">
            <table class="w-full min-w-[820px] text-sm">
              <thead class="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th class="px-3 py-2 font-semibold">품번</th>
                  <th class="px-3 py-2 font-semibold">제조사</th>
                  <th class="px-3 py-2 text-right font-semibold">재고</th>
                  <th class="px-3 py-2 font-semibold">D/C</th>
                  <th class="px-3 py-2 font-semibold">납기</th>
                  <th class="px-3 py-2 font-semibold">기준일</th>
                  <th class="px-3 py-2" />
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                <tr
                  v-for="part in items"
                  :key="part.partId"
                  class="transition-colors"
                  :class="justSaved === part.partId ? 'bg-amber-50' : 'hover:bg-gray-50/60'"
                >
                  <td class="px-3 py-2">
                    <p class="font-medium text-gray-900">{{ part.mpn }}</p>
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
                  <td class="px-3 py-2 text-gray-700">{{ part.manufacturer ?? '—' }}</td>
                  <td class="px-3 py-2 text-right tabular-nums text-gray-700">
                    {{ fmtQty(part.stockQty) }}
                  </td>
                  <td class="px-3 py-2 text-gray-600">{{ part.dateCode ?? '—' }}</td>
                  <td class="px-3 py-2 text-gray-600">{{ part.leadTime ?? '—' }}</td>
                  <td class="px-3 py-2 text-xs text-gray-500">{{ fmtDate(part.uploadedAt) }}</td>
                  <td class="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                      @click="editing = part"
                    >
                      수정
                    </button>
                    <button
                      type="button"
                      class="rounded px-2 py-1 text-xs text-gray-400 hover:bg-red-50 hover:text-red-600"
                      @click="void removePart(part.partId, part.mpn)"
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

      <!-- 업로드 이력 -->
      <div v-if="recentUploads.length > 0" class="rounded-xl border border-gray-200 bg-surface p-3">
        <p class="mb-2 text-sm font-semibold text-gray-800">최근 업로드</p>
        <ul class="divide-y divide-gray-100 text-sm">
          <li
            v-for="upload in recentUploads"
            :key="upload.uploadId"
            class="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <div class="min-w-0">
              <p class="truncate text-gray-800">{{ upload.fileName }}</p>
              <p class="text-xs text-gray-400">
                {{ fmtDate(upload.createdAt) }} ·
                {{ upload.uploadedBy === 'ADMIN' ? '담당자 대행' : '직접 업로드' }}
                <span v-if="upload.stats !== null">
                  · {{ fmtQty(upload.stats.rowCount) }}행
                </span>
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
    </template>

    <PartnerPartEditModal
      :part="editing"
      :save="saveEdit"
      :busy="updatePart.isPending.value"
      @close="editing = null"
      @saved="
        markSaved(editing?.partId ?? 0);
        editing = null;
      "
    />
  </div>
</template>
