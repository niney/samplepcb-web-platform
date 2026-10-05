<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { PrinterIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import type { BomQuotePrintType } from '@sp/api-contract';
// 견적서 문서 자체와 인쇄 격리는 인쇄 문서라 옛 것을 그대로 쓴다(docs/ADMIN_NEXT_UI.md 허용 예외).
import BomEstimateSheet from '@/components/smartbom/BomEstimateSheet.vue';
import { usePrintIsolation } from '@/lib/usePrintIsolation';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogScrollContent,
  DialogTitle,
} from '@/next/components/ui/dialog';
import { Label } from '@/next/components/ui/label';
import { Spinner } from '@/next/components/ui/spinner';

// BOM 견적서 미리보기·인쇄(§6.8) — 옛 components/smartbom/BomEstimateModal 의 짝(같은 props·emits).
// 상주 마운트 + open 토글(옛 API 그대로) — 데이터는 콜백 주입이라 관리자·고객이 각자 API 를 연결한다
// (고객 /app/bom 은 옛 모달을 계속 쓴다). 인쇄 규칙은 열려 있는 동안만 문서에 둔다(usePrintIsolation).
const props = defineProps<{
  open: boolean;
  load: () => Promise<BomQuotePrintType>;
}>();
const emit = defineEmits<{ close: [] }>();

const data = ref<BomQuotePrintType | null>(null);
const loading = ref(false);
const error = ref('');
const includeImages = ref(true);
const printing = ref(false);
const sheetHost = ref<HTMLElement | null>(null);
const hasImages = computed(() => data.value?.items.some((item) => item.imageUrl !== null) ?? false);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    loading.value = true;
    error.value = '';
    data.value = null;
    includeImages.value = true;
    printing.value = false;
    try {
      data.value = await props.load();
    } catch (e) {
      error.value = e instanceof ApiRequestError ? e.message : '견적서를 불러오지 못했습니다.';
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

// 부품 이미지를 실어 인쇄할 때는 이미지가 다 받아질 때까지(최대 2.5초씩) 기다린다 — 빈 칸 인쇄 방지.
async function waitForEstimateImages(): Promise<void> {
  await nextTick();
  const images =
    sheetHost.value === null ? [] : [...sheetHost.value.querySelectorAll<HTMLImageElement>('[data-estimate-part-image]')];
  await Promise.all(
    images.map(async (image) => {
      if (image.complete) return;
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeoutId);
          image.removeEventListener('load', finish);
          image.removeEventListener('error', finish);
          resolve();
        };
        const timeoutId = window.setTimeout(finish, 2_500);
        image.addEventListener('load', finish, { once: true });
        image.addEventListener('error', finish, { once: true });
      });
    }),
  );
}

const onPrint = async (): Promise<void> => {
  if (data.value === null || printing.value) return;
  printing.value = true;
  try {
    if (includeImages.value) await waitForEstimateImages();
    window.print();
  } finally {
    printing.value = false;
  }
};

const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};

// 인쇄 격리 — 대화상자는 body 로 나가는 포털이라, 인쇄할 때 body 의 다른 자식(#app·다른 포털)을 숨기고
// 견적서가 든 포털만 정상 흐름으로 되돌린다(포털 껍데기에는 표지를 달 수 없어 :has() 로 찾는다).
// 대화상자 카드의 테두리·그림자·여백·닫기 버튼과 툴바는 걷어내고, 열려 있는 동안 걸린 스크롤 잠금이
// 인쇄를 한 쪽으로 자르지 않게 푼다. 시트 자체 여백이 있으므로 @page margin:0.
const PRINT_STYLE_ID = 'sp-next-bom-estimate-print-style';
const PRINT_CSS = `
@media print {
  body { overflow: visible !important; padding-right: 0 !important; }
  body > :not(:has([data-bom-estimate-host])) { display: none !important; }
  body > :has([data-bom-estimate-host]) {
    position: static !important;
    display: block !important;
    overflow: visible !important;
    background: none !important;
    padding: 0 !important;
  }
  [data-bom-estimate-host] {
    position: static !important;
    display: block !important;
    width: auto !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: none !important;
    transform: none !important;
  }
  [data-bom-estimate-host] > button,
  [data-bom-estimate-host] [data-no-print] { display: none !important; }
  [data-bom-estimate-host] [data-bom-estimate-sheet] { overflow: visible !important; border: 0 !important; border-radius: 0 !important; }
  @page { size: A4; margin: 0; }
}
`;
usePrintIsolation(PRINT_STYLE_ID, PRINT_CSS, () => props.open);
</script>

<template>
  <Dialog :open="open" @update:open="onOpenChange">
    <DialogScrollContent class="max-w-fit" data-bom-estimate-host>
      <DialogHeader data-no-print>
        <DialogTitle>견적서</DialogTitle>
        <DialogDescription>인쇄하면 견적서만 A4 로 나옵니다.</DialogDescription>
        <div class="flex flex-wrap items-center gap-3 pt-1">
          <div v-if="hasImages" class="flex items-center gap-2">
            <Checkbox
              id="bom-estimate-images"
              :model-value="includeImages"
              @update:model-value="includeImages = $event === true"
            />
            <Label for="bom-estimate-images">부품 이미지 포함</Label>
          </div>
          <Button :disabled="data === null || printing" @click="void onPrint()">
            <Spinner v-if="printing" />
            <PrinterIcon v-else />
            {{ printing ? '인쇄 준비 중…' : '인쇄' }}
          </Button>
          <Button variant="outline" @click="emit('close')">닫기</Button>
        </div>
      </DialogHeader>

      <p v-if="loading" class="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm" data-no-print>
        <Spinner />
        불러오는 중…
      </p>
      <p v-else-if="error !== ''" class="text-destructive py-12 text-center text-sm font-medium" data-no-print>{{ error }}</p>
      <template v-else-if="data !== null">
        <p class="text-muted-foreground text-center text-xs min-[840px]:hidden" data-no-print>
          견적서를 좌우로 이동해 전체 내용을 확인할 수 있습니다.
        </p>
        <!-- 견적서는 흰 A4 문서라 테마와 무관하게 그대로 둔다. 좁은 화면에선 가로 스크롤. -->
        <div class="overflow-x-auto rounded-md border" data-bom-estimate-sheet>
          <div ref="sheetHost" class="w-max min-[840px]:mx-auto">
            <BomEstimateSheet :data="data" :show-images="includeImages" />
          </div>
        </div>
      </template>
    </DialogScrollContent>
  </Dialog>
</template>
