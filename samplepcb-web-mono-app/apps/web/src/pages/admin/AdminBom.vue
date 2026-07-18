<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import { useUploadBom } from '../../admin/useAdminBom';

const ALLOWED_EXTS = ['.xlsx', '.xlsm', '.xls', '.csv', '.tsv'] as const;
const MAX_FILE_BYTES = 30 * 1024 * 1024;

const router = useRouter();
const file = ref<File | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const dragOver = ref(false);
const error = ref('');
const upload = useUploadBom();

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MB`;
}

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLocaleLowerCase();
  return ALLOWED_EXTS.some((extension) => lower.endsWith(extension));
}

function setFile(next: File | null): void {
  if (next === null) {
    file.value = null;
    return;
  }
  if (!hasAllowedExtension(next.name)) {
    error.value = '엑셀(.xlsx/.xlsm/.xls) 또는 CSV/TSV 파일만 업로드할 수 있습니다.';
    return;
  }
  if (next.size > MAX_FILE_BYTES) {
    error.value = '파일은 30 MB 이하만 업로드할 수 있습니다.';
    return;
  }
  error.value = '';
  file.value = next;
}

function onFileChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  setFile(target.files?.[0] ?? null);
}

function onDrop(event: DragEvent): void {
  dragOver.value = false;
  setFile(event.dataTransfer?.files[0] ?? null);
}

function errorMessage(reason: unknown): string {
  if (reason instanceof ApiRequestError) {
    if (reason.payload?.error === 'BOM_ENGINE_UNREACHABLE') {
      return 'BOM 엔진에 연결할 수 없습니다. 엔진이 실행 중인지 확인하세요.';
    }
    return reason.message;
  }
  return 'BOM 업로드에 실패했습니다. 잠시 후 다시 시도하세요.';
}

async function submit(): Promise<void> {
  if (file.value === null) {
    error.value = '분석할 BOM 파일을 선택하세요.';
    return;
  }
  error.value = '';
  const form = new FormData();
  form.append('file', file.value);
  form.append('engine', 'smartbom');
  try {
    const response = await upload.mutateAsync(form);
    await router.push({ name: 'admin-bom-job', params: { id: response.data.job_id } });
  } catch (reason) {
    error.value = errorMessage(reason);
  }
}
</script>

<template>
  <div class="mx-auto max-w-5xl space-y-6">
    <header class="max-w-3xl">
      <p class="text-xs font-bold tracking-[0.16em] text-blue-700">SMARTBOM ANALYSIS</p>
      <h1 class="mt-2 text-2xl font-semibold tracking-tight text-gray-900">BOM을 구조화하고 근거까지 검토하세요</h1>
      <p class="mt-3 text-sm leading-6 text-gray-500">헤더 위치부터 품번, 사양, 수량, 패키지를 SMARTBOM 규칙 엔진으로 추출합니다. 근거가 부족한 값은 억지로 채우지 않고 검토 대상으로 남깁니다.</p>
    </header>

    <section class="grid overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm lg:grid-cols-[0.82fr_1.18fr]">
      <div class="bg-slate-900 p-7 text-slate-100">
        <p class="text-xs font-bold tracking-[0.16em] text-emerald-300">STEP 01</p>
        <h2 class="mt-4 text-2xl font-semibold tracking-tight">분석할 BOM을 올려주세요</h2>
        <p class="mt-3 text-sm leading-6 text-slate-300">원본 시트 좌표를 유지한 채 헤더와 부품 사양을 구조화합니다.</p>
        <div class="mt-12 border-t border-white/15 pt-5">
          <p class="text-sm font-semibold text-white">외부 LLM 전송 없음</p>
          <p class="mt-1 text-xs leading-5 text-slate-400">BOM 셀 데이터는 외부 AI API가 아니라 서버 안의 SMARTBOM 규칙 엔진으로 분석합니다.</p>
        </div>
      </div>

      <div class="p-6">
        <button
          type="button"
          class="flex min-h-52 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-5 text-center transition disabled:cursor-not-allowed disabled:opacity-60"
          :class="dragOver ? 'border-blue-500 bg-blue-50' : file !== null ? 'border-emerald-300 bg-emerald-50' : 'border-gray-300 bg-gray-50 hover:border-blue-400 hover:bg-blue-50/40'"
          :disabled="upload.isPending.value"
          @click="fileInput?.click()"
          @dragenter.prevent="dragOver = true"
          @dragover.prevent
          @dragleave.prevent="dragOver = false"
          @drop.prevent="onDrop"
        >
          <span class="grid h-12 w-14 place-items-center rounded-lg border border-blue-100 bg-blue-50 text-xs font-extrabold tracking-wider text-blue-700">BOM</span>
          <strong class="max-w-full truncate text-base text-gray-900">{{ file?.name ?? '파일을 끌어놓거나 선택하세요' }}</strong>
          <span class="text-sm text-gray-500">{{ file ? `${formatBytes(file.size)} · 선택 완료` : 'XLSX · XLSM · XLS · CSV · TSV / 최대 30 MB' }}</span>
        </button>
        <input ref="fileInput" type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv" class="hidden" @change="onFileChange">

        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="file === null || upload.isPending.value" @click="submit">
            {{ upload.isPending.value ? '업로드 중…' : 'SMARTBOM 분석 시작' }}
          </button>
          <button v-if="file !== null" type="button" class="text-sm font-medium text-gray-500 hover:text-gray-800" @click="setFile(null)">선택 해제</button>
        </div>
        <p v-if="error" class="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{{ error }}</p>
      </div>
    </section>

    <p class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">현재 분석 작업은 엔진 실행 중에만 조회할 수 있습니다. 영구 보관·작업 이력은 승인·저장 단계와 함께 별도로 추가합니다.</p>
  </div>
</template>
