<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import { useCreateAdminBomQuote } from '../../admin/useAdminBomQuoteUpload';
import icUpload from '../../assets/admin/bom/ic-upload-20.svg';
import uploadCard from '../../assets/admin/bom/upload-card.jpg';
import pillUnikey from '../../assets/admin/bom/pill-unikey.png';
import pillDigikey from '../../assets/admin/bom/pill-digikey.png';
import pillMouser from '../../assets/admin/bom/pill-mouser.png';

// 관리자 전용 BOM 업로드 — 2026-07-28 고객 BomHome 화면을 독립 스냅샷으로 이식.
// 고객 화면은 이후 별도 변경되므로 컴포넌트·에셋·mutation을 공유하지 않는다.
const ALLOWED_EXTS = ['.xlsx', '.xls', '.csv', '.xlsm', '.tsv', '.bom'] as const;
const FILE_ACCEPT = ALLOWED_EXTS.join(',');
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const router = useRouter();
const dragOver = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const create = useCreateAdminBomQuote();

const SUPPLIER_LOGOS = [
  { name: 'UNIKEY Electronics', src: pillUnikey },
  { name: 'DigiKey', src: pillDigikey },
  { name: 'Mouser Electronics', src: pillMouser },
];

function hasAllowedExtension(name: string): boolean {
  const lower = name.toLocaleLowerCase();
  return ALLOWED_EXTS.some((extension) => lower.endsWith(extension));
}

async function submit(file: File): Promise<void> {
  if (!hasAllowedExtension(file.name)) {
    error.value = '엑셀(xlsx/xls), CSV/TSV 또는 BOM 파일만 업로드할 수 있습니다.';
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    error.value = '파일은 50 MB 이하만 업로드할 수 있습니다.';
    return;
  }
  error.value = '';
  try {
    const response = await create.mutateAsync(file);
    await router.push({ name: 'admin-bom-quote', params: { id: response.data.quoteId } });
  } catch (reason) {
    error.value =
      reason instanceof ApiRequestError && reason.payload?.error === 'BOM_ENGINE_UNREACHABLE'
        ? '분석 엔진에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'
        : 'BOM 업로드에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  }
}

function onFileChange(event: Event): void {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = ''; // 같은 파일 재선택 허용
  if (file !== undefined) void submit(file);
}

function onDrop(event: DragEvent): void {
  dragOver.value = false;
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) void submit(file);
}
</script>

<template>
  <div class="flex h-full flex-col items-center overflow-y-auto bg-surface px-6 pb-[60px]">
    <div
      class="relative mt-[46px] h-[524px] w-[640px] max-w-full cursor-pointer overflow-hidden rounded-[8px] transition"
      :class="dragOver ? 'ring-4 ring-brand-strong/40' : ''"
      role="button"
      tabindex="0"
      @click="fileInput?.click()"
      @keydown.enter="fileInput?.click()"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <img :src="uploadCard" alt="Drag & drop BOM file — xlsx, xls, csv, tsv, bom formats, up to 50 MB" class="absolute inset-0 size-full">
      <button
        type="button"
        class="absolute left-1/2 top-[226px] flex h-[48px] w-[172px] -translate-x-1/2 items-center justify-center gap-[6px] rounded-[8px] transition hover:bg-white/25"
        :class="create.isPending.value ? 'bg-surface shadow-sm' : ''"
        :disabled="create.isPending.value"
        aria-label="Select file"
        @click.stop="fileInput?.click()"
      >
        <template v-if="create.isPending.value">
          <img :src="icUpload" alt="" class="size-[20px]">
          <span class="text-[16px] font-bold leading-[24px] text-brand-strong">Uploading…</span>
        </template>
      </button>
    </div>
    <input ref="fileInput" type="file" :accept="FILE_ACCEPT" class="hidden" @change="onFileChange">

    <p v-if="error" class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{{ error }}</p>

    <h2 class="mt-[50px] text-center text-[26px] font-bold leading-[32px] text-ink-strong">전자부품 2,000만+ 다양한 제조사</h2>
    <p class="mt-[8px] text-center text-[18px] leading-[32px] text-ink-neutral">공인 유통사의 견적 정보를 최적의 조건으로, 빠르게 받아 비교하세요</p>
    <div class="mt-[22px] flex flex-wrap items-center justify-center gap-[12px]">
      <img
        v-for="logo in SUPPLIER_LOGOS"
        :key="logo.name"
        :src="logo.src"
        :alt="logo.name"
        class="h-[66px] w-[148px]"
      >
    </div>
  </div>
</template>
