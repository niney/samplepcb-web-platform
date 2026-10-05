<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeftIcon, ChevronRightIcon, PrinterIcon, XIcon } from '@lucide/vue';
import type { BomTradeDocumentType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { usePrintIsolation } from '@/lib/usePrintIsolation';
// 인쇄 문서 — 옛 시트를 그대로 쓴다(종이 결과가 옛 것과 같아야 한다, docs/ADMIN_NEXT_UI.md §8 예외).
import TradeDocumentSheet from '@/components/smartbom/TradeDocumentSheet.vue';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import { Spinner } from '@/next/components/ui/spinner';

// 국내 거래 문서(협력사 견적서·거래명세서) 미리보기·인쇄 — 옛 components/smartbom/TradeDocumentModal.vue
// 의 짝(같은 props·emits). 관리자 전용이라 협력사 다국어(pt)는 옮기지 않았다(옛 것은 포털이 쓴다).
//
// shadcn Dialog 가 아니라 직접 띄운 전체 화면 막인 이유: 인쇄 격리 규칙이 `body > :not(호스트)` 를
// 숨기는데, Dialog 는 포털로 오버레이·본문을 body 에 따로 붙여 "호스트 하나"를 지정할 수 없다.

const props = defineProps<{
  open: boolean;
  label: string;
  load: () => Promise<BomTradeDocumentType>;
}>();
const emit = defineEmits<{ close: [] }>();

const data = ref<BomTradeDocumentType | null>(null);
const loading = ref(false);
const error = ref('');
const dialogEl = ref<HTMLElement | null>(null);
const closeButtonEl = ref<{ $el: HTMLElement } | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let previousBodyOverflow = '';
let loadVersion = 0;

async function loadDocument(): Promise<void> {
  const version = ++loadVersion;
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    const loaded = await props.load();
    if (version === loadVersion) data.value = loaded;
  } catch (cause) {
    if (version !== loadVersion) return;
    error.value = cause instanceof ApiRequestError ? cause.message : '거래 문서를 불러오지 못했습니다.';
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function focusableElements(): HTMLElement[] {
  const dialog = dialogEl.value;
  if (dialog === null) return [];
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0,
  );
}

function restorePageFocus(): void {
  document.body.style.overflow = previousBodyOverflow;
  const target = previousFocus;
  previousFocus = null;
  void nextTick(() => target?.focus());
}

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      loadVersion += 1;
      if (previousFocus !== null) restorePageFocus();
      return;
    }
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    await nextTick();
    closeButtonEl.value?.$el.focus();
    await loadDocument();
  },
  { immediate: true },
);

// 포커스 가둠·Esc — 막 밖으로 Tab 이 새면 뒤 화면을 조작하게 된다.
const onKeydown = (event: KeyboardEvent): void => {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key !== 'Tab') return;
  const dialog = dialogEl.value;
  if (dialog === null) return;
  const focusable = focusableElements();
  const first = focusable[0];
  const last = focusable.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
};
const onPrint = (): void => {
  window.print();
};
const moveDocument = (direction: -1 | 1): void => {
  scrollEl.value?.scrollBy({ left: direction * 280, behavior: 'smooth' });
};

// 인쇄 격리 — 열려 있는 동안만 문서에 둔다(lib/usePrintIsolation 머리말). 훅은 data 속성으로 건다.
// 내용은 옛 모달의 인쇄 규칙과 같다(A4, 여백 0 — 시트가 자기 여백을 갖는다).
const PRINT_CSS = `
@media print {
  body > :not([data-bom-trade-host]) { display: none !important; }
  [data-bom-trade-host] { position: static !important; display: block !important; background: none !important; }
  [data-bom-trade-shell] { height: auto !important; padding: 0 !important; display: block !important; }
  [data-bom-trade-scroll] { position: static !important; overflow: visible !important; height: auto !important; padding: 0 !important; display: block !important; }
  [data-bom-trade-host] [data-no-print] { display: none !important; }
  @page { size: A4; margin: 0; }
}`;
usePrintIsolation('sp-next-bom-trade-document-print-style', PRINT_CSS, () => props.open);

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  loadVersion += 1;
  if (previousFocus !== null) restorePageFocus();
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      ref="dialogEl"
      data-bom-trade-host
      class="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      :aria-label="label"
      tabindex="-1"
    >
      <div data-no-print class="absolute inset-0 bg-black/50" @click="emit('close')" />
      <div
        data-bom-trade-shell
        class="relative flex h-full min-h-0 flex-col items-center p-3 sm:p-6"
        @click.self="emit('close')"
      >
        <Card data-no-print class="mb-3 w-full max-w-4xl shrink-0 flex-row flex-wrap items-center gap-2 p-3">
          <h2 class="mr-auto text-sm font-semibold">{{ label }}</h2>
          <Button :disabled="data === null" @click="onPrint">
            <PrinterIcon />
            인쇄
          </Button>
          <Button ref="closeButtonEl" variant="outline" @click="emit('close')">
            <XIcon />
            닫기
          </Button>
          <!-- 좁은 화면 — A4 시트가 화면보다 넓어 좌우로 옮겨 본다. -->
          <div v-if="data !== null" class="flex basis-full items-center gap-2 min-[840px]:hidden">
            <span class="text-muted-foreground min-w-0 flex-1 text-xs">좌우로 이동해 거래 문서 전체를 확인하세요.</span>
            <Button variant="outline" size="icon-sm" aria-label="거래 문서 왼쪽으로 이동" @click="moveDocument(-1)">
              <ChevronLeftIcon />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="거래 문서 오른쪽으로 이동" @click="moveDocument(1)">
              <ChevronRightIcon />
            </Button>
          </div>
        </Card>

        <div
          ref="scrollEl"
          data-bom-trade-scroll
          data-trade-document-scroll
          class="min-h-0 w-full flex-1 overflow-auto"
          @click.self="emit('close')"
        >
          <Card v-if="loading" data-no-print class="mx-auto w-full max-w-4xl flex-row items-center justify-center gap-2 py-16" role="status">
            <Spinner />
            <span class="text-muted-foreground text-sm">불러오는 중…</span>
          </Card>
          <Card v-else-if="error !== ''" data-no-print class="mx-auto w-full max-w-4xl items-center gap-3 py-12">
            <p role="alert" class="text-destructive text-sm font-medium">{{ error }}</p>
            <Button variant="outline" @click="void loadDocument()">다시 시도</Button>
          </Card>
          <div v-else-if="data !== null" class="w-max shadow-2xl min-[840px]:mx-auto" @click.stop>
            <TradeDocumentSheet :data="data" />
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
