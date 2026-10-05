<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { toDataURL } from 'qrcode';
import { PrinterIcon, XIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import type { PcbShipmentPackageListType } from '@sp/api-contract';
import { usePrintIsolation } from '@/lib/usePrintIsolation';
import { Button } from '@/next/components/ui/button';
import { Card } from '@/next/components/ui/card';
import { Spinner } from '@/next/components/ui/spinner';
import PackageLabelSheet from './shipment/print/PackageLabelSheet.vue';

// PCB Case QR 라벨 — 합배송 박스의 현재 PO마다 서버가 라벨 1개를 자동 보장하고, 여기서는 안전한
// 표시 정보만 미리보기·일괄 인쇄한다(BOM 포장 편집기를 복제하지 않는다). 옛 PcbPackageLabelsModal
// 과 props·emits 가 같다. 관리자 전용이라 협력사 다국어(pt)는 옮기지 않았다(옛 것은 포털이 쓴다).
//
// shadcn Dialog 가 아니라 직접 띄운 전체 화면 막인 이유: 인쇄 격리 규칙이 `body > :not(호스트)` 를
// 숨기는데, Dialog 는 포털로 오버레이·본문을 body 에 따로 붙여 "호스트 하나"를 지정할 수 없다.

const props = defineProps<{
  open: boolean;
  load: () => Promise<PcbShipmentPackageListType>;
  markPrinted: () => Promise<PcbShipmentPackageListType>;
}>();
const emit = defineEmits<{ close: [] }>();

const data = ref<PcbShipmentPackageListType | null>(null);
const loading = ref(false);
const printing = ref(false);
const error = ref('');
const qrImages = ref<Record<string, string>>({});

// QR 이 가리키는 주소는 **종이에 찍혀 오래 남는다** — 리뉴얼 경로(/admin/next/…)를 찍으면 컷오버 뒤
// 죽은 링크가 된다. 그래서 컷오버 뒤에도 같은 화면이 이어받는 정식 경로(/admin/pcb/packages)로 둔다.
const qrTarget = (token: string): string =>
  new URL(`/app/admin/pcb/packages/${encodeURIComponent(token)}`, window.location.origin).toString();

async function rebuildQrImages(): Promise<void> {
  const current = data.value;
  if (current === null) {
    qrImages.value = {};
    return;
  }
  const entries = await Promise.all(
    current.packages.map(
      async (pkg) =>
        [pkg.token, await toDataURL(qrTarget(pkg.token), { errorCorrectionLevel: 'M', margin: 1, width: 240 })] as const,
    ),
  );
  qrImages.value = Object.fromEntries(entries);
}

async function loadLabels(): Promise<void> {
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    data.value = structuredClone(await props.load());
    await rebuildQrImages();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : 'PCB QR 라벨을 불러오지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadLabels();
  },
  { immediate: true },
);

const canPrint = computed(
  () =>
    data.value !== null &&
    data.value.packages.length > 0 &&
    data.value.packages.every((pkg) => qrImages.value[pkg.token] !== undefined),
);

async function printLabels(): Promise<void> {
  if (!canPrint.value || printing.value) return;
  printing.value = true;
  error.value = '';
  try {
    data.value = structuredClone(await props.markPrinted());
    await rebuildQrImages();
    await nextTick();
    window.print();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '인쇄 준비에 실패했습니다.';
  } finally {
    printing.value = false;
  }
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') emit('close');
};
watch(
  () => props.open,
  (open) => {
    if (open) window.addEventListener('keydown', onKeydown);
    else window.removeEventListener('keydown', onKeydown);
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});

// 인쇄 격리 — 열려 있는 동안만 문서에 둔다(상주하면 같은 화면의 다른 인쇄를 백지로 만든다 —
// lib/usePrintIsolation 머리말). 훅은 클래스 대신 data 속성으로 건다(Tailwind 가 모르는 클래스를
// 마크업에 남기지 않는다). 내용은 옛 라벨 모달의 인쇄 규칙과 같다.
const PRINT_CSS = `
@media print {
  body > :not([data-pcb-label-host]) {
    display: none !important;
  }

  [data-pcb-label-host],
  [data-pcb-label-scroll] {
    position: static !important;
    overflow: visible !important;
    max-height: none !important;
    padding: 0 !important;
    background: none !important;
    display: block !important;
  }

  [data-pcb-label-host] [data-no-print] {
    display: none !important;
  }

  [data-pcb-label-print] {
    display: block !important;
  }

  [data-pcb-label-sheet] {
    box-shadow: none !important;
    margin: 0 !important;
  }

  [data-pcb-label] {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  @page {
    size: A4 portrait;
    margin: 8mm;
  }
}
`;
usePrintIsolation('sp-next-pcb-label-print-style', PRINT_CSS, () => props.open);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      data-pcb-label-host
      class="fixed inset-0 z-50 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pcb-label-dialog-title"
    >
      <div
        data-pcb-label-scroll
        class="flex h-full flex-col items-center overflow-auto p-4 sm:p-6"
        @click.self="emit('close')"
      >
        <Card data-no-print class="mb-3 w-full max-w-5xl flex-row flex-wrap items-center gap-2 p-3">
          <div class="mr-auto min-w-0">
            <h2 id="pcb-label-dialog-title" class="text-sm font-semibold">PCB QR 라벨</h2>
            <p v-if="data !== null" class="text-muted-foreground text-xs">
              {{ data.labelNo }} · SH-{{ data.shipmentId }} · {{ data.totalLabels }}장
            </p>
          </div>
          <Button :disabled="!canPrint || printing" @click="void printLabels()">
            <Spinner v-if="printing" />
            <PrinterIcon v-else />
            {{ printing ? '인쇄 준비 중…' : 'QR 라벨 인쇄' }}
          </Button>
          <Button variant="outline" @click="emit('close')">
            <XIcon />
            닫기
          </Button>
          <p v-if="error !== ''" class="text-destructive basis-full text-sm font-medium" role="alert">{{ error }}</p>
        </Card>

        <Card v-if="loading" data-no-print class="w-full max-w-5xl flex-row items-center justify-center gap-2 py-16">
          <Spinner />
          <span class="text-muted-foreground text-sm">QR 라벨을 준비하는 중…</span>
        </Card>

        <PackageLabelSheet v-else-if="data !== null" :data="data" :qr-images="qrImages" />
      </div>
    </div>
  </Teleport>
</template>
