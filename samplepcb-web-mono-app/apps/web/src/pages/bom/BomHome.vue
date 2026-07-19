<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import { useCreateBomQuote } from '../../bom/useBom';
import logoWhite from '../../assets/bom/logo-partseyes-baked.png';
import glowOverlay from '../../assets/bom/glow-overlay.svg';
import icUpload from '../../assets/bom/ic-upload-20.svg';
import pcbPhoto from '../../assets/bom/pcb-photo-strip.png';
import pillUnikey from '../../assets/bom/pill-unikey.png';
import pillDigikey from '../../assets/bom/pill-digikey.png';
import pillMouser from '../../assets/bom/pill-mouser.png';

// 고객 스마트 BOM 업로드 — Figma "01 BOM 업로드"(87:9037) 중앙 콘텐츠 이식(디자인 동일 중점).
// 파일 선택/드롭 즉시 업로드→분석 이동(시안에 별도 시작 버튼 없음). 공급사 로고는
// 사용자 지시로 UNIKEY·DigiKey·MOUSER 3종만. 견적 이력은 좌측 Recent file(레이아웃)로 이동.

const ALLOWED_EXTS = ['.xlsx', '.xls', '.csv', '.xlsm', '.tsv'] as const;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const router = useRouter();
const dragOver = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const create = useCreateBomQuote();

// Figma 합성 렌더(필 배경+로고, 148×66 — 내부 그림자 여백 포함) — 사용자 지시로 3종만
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
    error.value = '엑셀(xlsx/xls) 또는 CSV 파일만 업로드할 수 있습니다.';
    return;
  }
  if (file.size > MAX_FILE_BYTES) {
    error.value = '파일은 50 MB 이하만 업로드할 수 있습니다.';
    return;
  }
  error.value = '';
  try {
    const res = await create.mutateAsync(file);
    await router.push({ name: 'bom-quote', params: { id: res.data.quoteId } });
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
  <div class="flex flex-col items-center px-6 pb-[60px]">
    <!-- togle btn (87:9712) — 단일 검색은 미구현(표시만) -->
    <div class="mt-[46px] flex h-[42px] items-center rounded-full bg-[#f0f4fa]">
      <span class="flex h-[42px] items-center rounded-full bg-[#061023] px-[24px] text-[16px] font-bold leading-[24px] text-white">BOM 분석</span>
      <span class="flex h-[42px] cursor-default items-center rounded-full px-[24px] text-[16px] font-medium leading-[24px] text-[#27292e] opacity-80" title="단일 검색 (준비 중)">단일 검색</span>
    </div>

    <!-- drag & drop (87:9040) -->
    <div
      class="relative mt-[50px] h-[524px] w-[640px] max-w-full cursor-pointer overflow-hidden rounded-[8px] transition"
      :class="dragOver ? 'ring-4 ring-[#0e6efd]/40' : ''"
      :style="{ backgroundImage: 'linear-gradient(180deg, rgb(113,197,255) 0%, rgb(168,218,252) 22.596%, rgb(199,230,251) 41.827%, rgb(167,210,247) 92.308%)' }"
      role="button"
      tabindex="0"
      @click="fileInput?.click()"
      @keydown.enter="fileInput?.click()"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <img :src="glowOverlay" alt="" class="pointer-events-none absolute inset-0 size-full">
      <img :src="logoWhite" alt="Parts Eyes" class="absolute left-1/2 top-[66px] h-[50px] w-[290px] -translate-x-1/2">
      <div class="absolute left-1/2 top-[134px] w-[256px] -translate-x-1/2 text-center text-[#fdfdff]">
        <p class="text-[20px] font-medium leading-[32px]">Drag &amp; drop Bom File</p>
        <p class="mt-[6px] whitespace-nowrap text-[16px] leading-[24px] opacity-70">(xlsx, xls, csv formats, up to 50 MB)</p>
      </div>
      <button
        type="button"
        class="absolute left-1/2 top-[226px] flex h-[48px] -translate-x-1/2 items-center gap-[6px] rounded-[8px] bg-[#fdfdff] px-[34px] shadow-sm hover:bg-white disabled:opacity-60"
        :disabled="create.isPending.value"
        @click.stop="fileInput?.click()"
      >
        <img :src="icUpload" alt="" class="size-[20px]">
        <span class="text-[16px] font-bold leading-[24px] text-[#0e6efd]">{{ create.isPending.value ? 'Uploading…' : 'Select file' }}</span>
      </button>
      <img :src="pcbPhoto" alt="" class="pointer-events-none absolute bottom-0 left-0 h-[200px] w-full rounded-b-[8px] object-cover">
    </div>
    <input ref="fileInput" type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv" class="hidden" @change="onFileChange">

    <p v-if="error" class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{{ error }}</p>

    <!-- contents (87:9722) -->
    <h2 class="mt-[50px] text-center text-[26px] font-bold leading-[32px] text-[#061023]">전자부품 2,000만+ 다양한 제조사</h2>
    <p class="mt-[8px] text-center text-[18px] leading-[32px] text-[#616164]">공인 유통사의 견적 정보를 최적의 조건으로, 빠르게 받아 비교하세요</p>
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
