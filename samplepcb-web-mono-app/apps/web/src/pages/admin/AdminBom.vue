<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import type { BomComponentType } from '@sp/api-contract';
import {
  useBomJob,
  useBomResult,
  useStartSupplierSearch,
  useSupplierSearchResult,
  useSupplierSearchStatus,
  useUploadBom,
} from '../../admin/useAdminBom';

const ALLOWED_EXTS = ['.xlsx', '.xlsm', '.xls', '.csv', '.tsv'] as const;
const ACCEPT = ALLOWED_EXTS.join(',');

const jobId = ref<string | null>(null);
const file = ref<File | null>(null);
const error = ref('');
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const upload = useUploadBom();
const job = useBomJob(jobId);
const jobView = computed(() => job.data.value?.data ?? null);
const completed = computed(() => jobView.value?.status === 'completed');
const failed = computed(() => jobView.value?.status === 'failed');

const result = useBomResult(jobId, completed);
const components = computed<BomComponentType[]>(() => result.data.value?.data.components ?? []);
const summary = computed(() => result.data.value?.data.summary ?? null);

const startSupplier = useStartSupplierSearch();
const supplierStarted = ref(false);
const supplierStatus = useSupplierSearchStatus(jobId, supplierStarted);
const supplierView = computed(() => supplierStatus.data.value?.data ?? null);
const supplierDone = computed(() => supplierView.value?.status === 'completed');
const supplierResult = useSupplierSearchResult(jobId, supplierDone);
const supplierSummary = computed(() => supplierResult.data.value?.data.summary ?? null);

function hasAllowedExt(name: string): boolean {
  const lower = name.toLowerCase();
  return ALLOWED_EXTS.some((ext) => lower.endsWith(ext));
}

function setFile(next: File | null): void {
  if (next === null) {
    file.value = null;
    return;
  }
  if (!hasAllowedExt(next.name)) {
    error.value = '엑셀(.xlsx/.xlsm/.xls) 또는 CSV/TSV 파일만 업로드할 수 있습니다.';
    return;
  }
  error.value = '';
  file.value = next;
}

function pickFile(e: Event): void {
  const input = e.target as HTMLInputElement;
  setFile(input.files?.[0] ?? null);
}

function openFileDialog(): void {
  fileInput.value?.click();
}

function onDrop(e: DragEvent): void {
  dragOver.value = false;
  setFile(e.dataTransfer?.files[0] ?? null);
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code === 'BOM_ENGINE_UNREACHABLE') return 'BOM 엔진에 연결할 수 없습니다. 엔진이 실행 중인지 확인하세요.';
    return err.message;
  }
  return '처리에 실패했습니다. 잠시 후 다시 시도해 주세요.';
}

async function onUpload(): Promise<void> {
  error.value = '';
  if (file.value === null) {
    error.value = 'BOM 파일을 선택하세요.';
    return;
  }
  const fd = new FormData();
  fd.append('file', file.value);
  fd.append('engine', 'smartbom');
  supplierStarted.value = false;
  try {
    const res = await upload.mutateAsync(fd);
    jobId.value = res.data.job_id;
  } catch (err) {
    error.value = errorMessage(err);
  }
}

async function onSupplierSearch(): Promise<void> {
  if (jobId.value === null) return;
  error.value = '';
  try {
    await startSupplier.mutateAsync(jobId.value);
    supplierStarted.value = true;
  } catch (err) {
    error.value = errorMessage(err);
  }
}

function fmtQty(q: BomComponentType['quantity']): string {
  return q === null || q === undefined ? '' : String(q);
}

function fmtConfidence(c: number | null | undefined): string {
  return c === null || c === undefined ? '' : `${String(Math.round(c * 100))}%`;
}
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-xl font-semibold text-gray-900">BOM 업로드</h1>
      <p class="mt-1 text-sm text-gray-500">
        엑셀/CSV BOM 파일을 업로드하면 부품을 추출해 보여줍니다. (저장은 다음 단계)
      </p>
    </div>

    <!-- 업로드 폼 (드래그앤드롭) -->
    <div class="rounded-lg border border-gray-200 bg-white p-4">
      <div
        class="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors"
        :class="dragOver ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-gray-400'"
        role="button"
        tabindex="0"
        @click="openFileDialog"
        @keydown.enter="openFileDialog"
        @keydown.space.prevent="openFileDialog"
        @dragover.prevent="dragOver = true"
        @dragleave.prevent="dragOver = false"
        @drop.prevent="onDrop"
      >
        <svg
          class="mb-2 h-8 w-8 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 7.5 7.5 12M12 7.5v9"
          />
        </svg>
        <p class="text-sm text-gray-600">
          <span class="font-medium text-blue-600">파일 선택</span> 또는 여기로 드래그앤드롭
        </p>
        <p class="mt-1 text-xs text-gray-400">.xlsx · .xlsm · .xls · .csv · .tsv</p>
        <p v-if="file !== null" class="mt-2 text-sm font-medium text-gray-800">
          {{ file.name }}
        </p>
      </div>
      <input
        ref="fileInput"
        type="file"
        :accept="ACCEPT"
        class="hidden"
        @change="pickFile"
      >
      <div class="mt-3 flex items-center gap-3">
        <button
          type="button"
          class="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          :disabled="upload.isPending.value || file === null"
          @click="onUpload"
        >
          {{ upload.isPending.value ? '업로드 중…' : '업로드 & 추출' }}
        </button>
        <button
          v-if="file !== null"
          type="button"
          class="text-sm text-gray-500 hover:text-gray-700"
          @click="setFile(null)"
        >
          선택 해제
        </button>
      </div>
      <p v-if="error !== ''" class="mt-2 text-sm text-red-600">{{ error }}</p>
    </div>

    <!-- 진행 상태 -->
    <div v-if="jobView !== null" class="rounded-lg border border-gray-200 bg-white p-4">
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium text-gray-700">{{ jobView.filename }}</span>
        <span
          class="rounded-full px-2 py-0.5 text-xs"
          :class="{
            'bg-blue-100 text-blue-700': jobView.status === 'running',
            'bg-green-100 text-green-700': jobView.status === 'completed',
            'bg-red-100 text-red-700': jobView.status === 'failed',
          }"
        >{{ jobView.status }}</span>
      </div>
      <div class="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-100">
        <div class="h-full bg-blue-500 transition-all" :style="{ width: `${jobView.progress}%` }" />
      </div>
      <p class="mt-2 text-sm text-gray-500">{{ jobView.message }}</p>
      <p v-if="failed" class="mt-1 text-sm text-red-600">{{ jobView.error }}</p>
    </div>

    <!-- 요약 -->
    <div v-if="completed && summary !== null" class="flex flex-wrap gap-4 text-sm">
      <div class="rounded-lg border border-gray-200 bg-white px-4 py-2">
        부품 <span class="font-semibold">{{ summary.component_count }}</span>
      </div>
      <div v-if="summary.parsed_sheet_count !== undefined" class="rounded-lg border border-gray-200 bg-white px-4 py-2">
        파싱 시트 <span class="font-semibold">{{ summary.parsed_sheet_count }}</span>
      </div>
      <div v-if="summary.review_component_count !== undefined" class="rounded-lg border border-gray-200 bg-white px-4 py-2">
        검토 필요 <span class="font-semibold">{{ summary.review_component_count }}</span>
      </div>
      <button
        type="button"
        class="rounded-md border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 disabled:opacity-50"
        :disabled="startSupplier.isPending.value || supplierStarted"
        @click="onSupplierSearch"
      >
        공급사 검색
      </button>
      <div
        v-if="supplierStarted && supplierView !== null"
        class="rounded-lg border border-gray-200 bg-white px-4 py-2"
      >
        공급사 검색: {{ supplierView.status }}
        <template v-if="supplierDone && supplierSummary !== null">
          · API {{ supplierSummary.api_calls }} · 캐시 {{ supplierSummary.cache_hits }}
        </template>
      </div>
    </div>

    <!-- 부품 테이블 -->
    <div v-if="completed" class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table class="min-w-full divide-y divide-gray-200 text-sm">
        <thead class="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th class="min-w-24 whitespace-nowrap px-3 py-2">시트</th>
            <th class="px-3 py-2">Part Number</th>
            <th class="px-3 py-2">제조사</th>
            <th class="min-w-20 whitespace-nowrap px-3 py-2">수량</th>
            <th class="px-3 py-2">패키지</th>
            <th class="px-3 py-2">타입</th>
            <th class="px-3 py-2">설명</th>
            <th class="min-w-20 whitespace-nowrap px-3 py-2">신뢰도</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-100">
          <tr v-for="(c, i) in components" :key="i" :class="{ 'bg-amber-50': c.review_status === 'review' }">
            <td class="px-3 py-2 text-gray-500">{{ c.sheet_name }}</td>
            <td class="px-3 py-2 font-medium text-gray-900">{{ c.part_number }}</td>
            <td class="px-3 py-2">{{ c.manufacturer }}</td>
            <td class="px-3 py-2">{{ fmtQty(c.quantity) }}</td>
            <td class="px-3 py-2">{{ c.package }}</td>
            <td class="px-3 py-2">{{ c.component_type }}</td>
            <td class="px-3 py-2 text-gray-500">{{ c.description }}</td>
            <td class="px-3 py-2 text-gray-500">{{ fmtConfidence(c.confidence) }}</td>
          </tr>
          <tr v-if="components.length === 0">
            <td colspan="8" class="px-3 py-6 text-center text-gray-400">추출된 부품이 없습니다.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
