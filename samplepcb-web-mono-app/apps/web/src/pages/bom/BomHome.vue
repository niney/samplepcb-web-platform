<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import { useCreateBomQuote } from '../../bom/useBom';
import { useBomProcurementMode } from '../../bom/useProcurementMode';
import BomLandingCard from '../../components/bom/BomLandingCard.vue';
import BomLandingIntro from '../../components/bom/BomLandingIntro.vue';
import BomLandingToggle from '../../components/bom/BomLandingToggle.vue';
import icUpload from '../../assets/bom/ic-upload-20.svg';

// 고객 스마트 BOM 업로드 — Figma "01 BOM 업로드"(87:9037) 중앙 콘텐츠 이식(디자인 동일 중점).
// 파일 선택/드롭 즉시 업로드→분석 이동(시안에 별도 시작 버튼 없음). 공급사 로고는
// 사용자 지시로 UNIKEY·DigiKey·MOUSER 3종만. 견적 이력은 좌측 Recent file(레이아웃)로 이동.

const ALLOWED_EXTS = ['.xlsx', '.xls', '.csv', '.xlsm', '.tsv', '.bom'] as const;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const router = useRouter();
const dragOver = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const create = useCreateBomQuote();
const { preferredMode } = useBomProcurementMode();

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
    const res = await create.mutateAsync({
      file,
      procurementMode: preferredMode.value,
    });
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
  <div class="flex h-full flex-col items-center overflow-y-auto px-6 pb-[60px]">
    <!-- togle btn (87:9712) -->
    <BomLandingToggle active="bom" />

    <!-- drag & drop (87:9040·2282:60957) — 배경은 텍스트 없는 공용 베이크, 로고·타이틀·
         버튼은 실 DOM(BomLandingCard 참조). 단일 검색 탭과 텍스트 위치를 공유한다. -->
    <div
      class="relative mt-[50px] h-[524px] w-[640px] shrink-0 cursor-pointer overflow-hidden rounded-[8px] transition"
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
      <BomLandingCard title="Drag & drop Bom File" subtitle="(xlsx, xls, csv formats, up to 50 MB)" />
      <button
        type="button"
        class="absolute left-1/2 top-[226px] flex h-[48px] w-[172px] -translate-x-1/2 items-center justify-center gap-[6px] rounded-[8px] bg-[#fdfdff] font-noto transition hover:bg-white"
        :disabled="create.isPending.value"
        @click.stop="fileInput?.click()"
      >
        <img :src="icUpload" alt="" class="size-[20px]">
        <span class="text-[16px] font-bold leading-[24px] text-[#0e6efd]">{{ create.isPending.value ? 'Uploading…' : 'Select file' }}</span>
      </button>
    </div>
    <input ref="fileInput" type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.bom" class="hidden" @change="onFileChange">

    <p v-if="error" class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{{ error }}</p>

    <!-- contents (87:9722) -->
    <BomLandingIntro />
  </div>
</template>
