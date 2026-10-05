<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { UploadIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import { useCreateAdminBomQuote } from '@/admin/useAdminBomQuoteUpload';
import { SUPPLIER_META } from '@/bom/supplier-meta';
import { bomQuoteTo } from '@/next/smartbom-navigation';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Button } from '@/next/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/next/components/ui/empty';
import { Item, ItemContent, ItemMedia, ItemTitle } from '@/next/components/ui/item';
import { Spinner } from '@/next/components/ui/spinner';

// 관리자 전용 BOM 업로드 — 옛 pages/admin/AdminBomUpload.vue 의 짝. 옛 화면은 문구까지 구운 카드 그림
// (upload-card.jpg) 한 장이 끌어 놓기 칸이었다. 같은 자리·같은 문구를 Empty 로 다시 그리고, 공급사
// 로고 알약 그림은 파비콘+이름 Item 으로 바꿨다(그림의 흰 바탕이 다크 모드에서 떠서).
// 카드 전체가 숨은 파일 입력의 label 이라 어디를 눌러도 파일 선택이 열리고, Tab 으로 입력에 닿는다.
const ALLOWED_EXTS = ['.xlsx', '.xls', '.csv', '.xlsm', '.tsv', '.bom'] as const;
const FILE_ACCEPT = ALLOWED_EXTS.join(',');
const MAX_FILE_BYTES = 50 * 1024 * 1024;

const router = useRouter();
const dragOver = ref(false);
const error = ref('');
const errorPanel = ref<HTMLElement | null>(null);
const create = useCreateAdminBomQuote();

const SUPPLIER_LOGOS = [
  { name: 'UNIKEY Electronics', icon: SUPPLIER_META.unikeyic?.icon ?? '' },
  { name: 'DigiKey', icon: SUPPLIER_META.digikey?.icon ?? '' },
  { name: 'Mouser Electronics', icon: SUPPLIER_META.mouser?.icon ?? '' },
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
    await router.push(bomQuoteTo(response.data.quoteId));
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
  if (create.isPending.value) return;
  const file = event.dataTransfer?.files[0];
  if (file !== undefined) void submit(file);
}

watch(error, (message) => {
  if (message !== '') void nextTick(() => errorPanel.value?.focus());
});
</script>

<template>
  <div class="bg-background flex h-full flex-col items-center overflow-y-auto px-6 pb-15">
    <label
      class="focus-within:ring-ring/50 mt-12 flex min-h-131 w-160 max-w-full cursor-pointer flex-col rounded-xl border-2 border-dashed transition-colors focus-within:ring-4"
      :class="[
        dragOver ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/40',
        create.isPending.value ? 'cursor-wait' : '',
      ]"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <input
        type="file"
        class="sr-only"
        :accept="FILE_ACCEPT"
        :disabled="create.isPending.value"
        aria-label="BOM 파일 업로드"
        @change="onFileChange"
      >
      <Empty>
        <EmptyHeader>
          <p class="text-primary text-sm font-semibold tracking-wide">Parts Eyes</p>
          <EmptyMedia variant="icon">
            <UploadIcon />
          </EmptyMedia>
          <EmptyTitle>Drag &amp; drop BOM File</EmptyTitle>
          <EmptyDescription>(xlsx, xls, csv, tsv, bom formats, up to 50 MB)</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <!-- label 안의 span 이라 누르면 label 이 숨은 입력을 연다(버튼을 두면 클릭이 입력으로 가지 않는다). -->
          <Button as="span" size="lg">
            <template v-if="create.isPending.value">
              <Spinner />Uploading…
            </template>
            <template v-else>
              <UploadIcon />Select file
            </template>
          </Button>
        </EmptyContent>
      </Empty>
    </label>

    <div v-if="error" ref="errorPanel" tabindex="-1" class="mt-4 w-160 max-w-full outline-none">
      <Alert variant="destructive" size="sm">
        <AlertDescription>{{ error }}</AlertDescription>
      </Alert>
    </div>

    <p class="text-foreground mt-12 text-center text-2xl font-bold">전자부품 2,000만+ 다양한 제조사</p>
    <p class="text-muted-foreground mt-2 text-center text-lg">공인 유통사의 견적 정보를 최적의 조건으로, 빠르게 받아 비교하세요</p>
    <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
      <Item v-for="logo in SUPPLIER_LOGOS" :key="logo.name" variant="outline" size="sm" class="w-48">
        <ItemMedia>
          <img :src="logo.icon" alt="" class="size-5">
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{{ logo.name }}</ItemTitle>
        </ItemContent>
      </Item>
    </div>
  </div>
</template>
