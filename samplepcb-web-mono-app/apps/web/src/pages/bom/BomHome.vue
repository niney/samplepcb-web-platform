<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ApiRequestError } from '@sp/shared';
import { useCreateBomQuote } from '../../bom/useBom';
import { useBomProcurementMode } from '../../bom/useProcurementMode';
import BomLandingCard from '../../components/bom/BomLandingCard.vue';
import BomLandingIntro from '../../components/bom/BomLandingIntro.vue';
import BomLandingToggle from '../../components/bom/BomLandingToggle.vue';
import cardIllust from '../../assets/bom/bom-card-illust-upload.png';
import docArt from '../../assets/bom/bom-card-doc.svg';
import icUpload from '../../assets/bom/ic-upload-20-white.svg';

// 고객 스마트 BOM 업로드 — Figma "01 BOM 업로드"(87:9037) 중앙 콘텐츠 이식(디자인 동일 중점).
// 파일 선택/드롭 즉시 업로드→분석 이동(시안에 별도 시작 버튼 없음). 공급사 로고는
// 사용자 지시로 UNIKEY·DigiKey·MOUSER 3종만. 견적 이력은 좌측 Recent file(레이아웃)로 이동.

const ALLOWED_EXTS = ['.xlsx', '.xls', '.csv', '.xlsm', '.tsv', '.bom'] as const;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const router = useRouter();
const dragOver = ref(false);
const error = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const errorPanel = ref<HTMLParagraphElement | null>(null);
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

watch(error, (message) => {
  if (message !== '') void nextTick(() => errorPanel.value?.focus());
});
</script>

<template>
  <div class="flex h-full flex-col items-center overflow-y-auto px-4 pb-[60px] sm:px-6">
    <!-- togle btn (87:9712) -->
    <BomLandingToggle active="bom" />

    <!-- drag & drop (2593:7901) — 카드 프레임·글로우·텍스트는 BomLandingCard, 탭별
         일러스트(원본 PNG·자체 알파)와 BOM 문서 그래픽·버튼은 이 페이지가 겹쳐 올린다.
         단일 검색 탭과 텍스트 위치를 공유한다. -->
    <div
      class="relative mt-[50px] h-[524px] w-full max-w-[640px] shrink-0 overflow-hidden rounded-[8px] border border-[#d1e9f9] shadow-[0px_10px_30px_0px_var(--color-bom-landing-card-shadow)] transition"
      :class="dragOver ? 'ring-4 ring-brand-strong/40' : ''"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <BomLandingCard subtitle="Drag & drop Bom File (XLSX, XLS, CSV)">
        <!-- 일러스트(2593:8046 — 1024x859 원본을 시안 프레임에 비율 무시 스트레치, Figma
             fill 과 동일)와 문서 그래픽(2593:8060 — 시안 좌표 x267은 카드 중심-4px, 눌린
             래스터 문서 위에 벡터 문서가 겹친다). 중앙 기준으로 둬야 좁은 화면에서
             확대 없이 좌우만 잘린다. -->
        <img :src="cardIllust" alt="" class="pointer-events-none absolute left-1/2 top-[227px] h-[297px] w-[563px] max-w-none -translate-x-1/2">
        <img :src="docArt" alt="" class="pointer-events-none absolute left-[calc(50%-4px)] top-[240px] h-[117px] w-[97px] -translate-x-1/2">
      </BomLandingCard>
      <button
        type="button"
        class="group absolute inset-0 rounded-[8px] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand-strong/50"
        :disabled="create.isPending.value"
        aria-label="BOM 파일 업로드"
        @click="fileInput?.click()"
      >
        <span
          class="absolute left-1/2 top-[165px] flex h-[48px] w-[172px] -translate-x-1/2 items-center justify-center gap-[6px] rounded-[8px] bg-[#0e6efd] font-noto transition group-hover:bg-blue-700"
        >
          <img :src="icUpload" alt="" class="size-[20px]">
          <span class="text-[16px] font-bold leading-[24px] text-white">{{
            create.isPending.value ? 'Uploading…' : 'Select file'
          }}</span>
        </span>
      </button>
    </div>
    <input
      ref="fileInput"
      type="file"
      accept=".xlsx,.xlsm,.xls,.csv,.tsv,.bom"
      class="hidden"
      @change="onFileChange"
    >

    <p
      v-if="error"
      ref="errorPanel"
      role="alert"
      tabindex="-1"
      class="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 outline-none focus:ring-2 focus:ring-red-200"
    >
      {{ error }}
    </p>

    <!-- contents (87:9722) -->
    <BomLandingIntro />
  </div>
</template>
