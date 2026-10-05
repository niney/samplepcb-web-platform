<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { toDataURL } from 'qrcode';
import { InfoIcon, PlusIcon, PrinterIcon, SaveIcon, TriangleAlertIcon, XIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_PART_PACKAGE_STATUS_LABELS,
  type BomShipmentPackingItemType,
  type BomShipmentPackingListSaveBodyType,
  type BomShipmentPackingListType,
  type BomShipmentPackingPackageType,
} from '@sp/api-contract';
import { usePrintIsolation } from '@/lib/usePrintIsolation';
import { Alert, AlertDescription, AlertTitle } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { Card } from '@/next/components/ui/card';
import { Input } from '@/next/components/ui/input';
import { Spinner } from '@/next/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import Panel from '@/next/components/common/Panel.vue';
import PackingListSheet from './logistics/print/PackingListSheet.vue';

// 선적 리스트·QR 라벨(D24) — 옛 components/smartbom/ShipmentPackingModal.vue 의 짝(같은 props·emits).
// 상업송장과 분리된 Packing List이며 릴·트레이·튜브·봉투·박스 같은 실물 관리 단위마다 QR 1개를 생성한다.
// 저장된 token은 재인쇄해도 바뀌지 않고 관리자 스캔 화면으로 연결된다. 관리자 전용이라 협력사
// 다국어(pt)는 옮기지 않았다(옛 것은 협력사 포털이 쓴다).
//
// shadcn Dialog 가 아니라 직접 띄운 전체 화면 막인 이유: 인쇄 격리 규칙이 `body > :not(호스트)` 를
// 숨기는데, Dialog 는 포털로 오버레이·본문을 body 에 따로 붙여 "호스트 하나"를 지정할 수 없다.

const props = defineProps<{
  open: boolean;
  load: () => Promise<BomShipmentPackingListType>;
  save: (body: BomShipmentPackingListSaveBodyType) => Promise<BomShipmentPackingListType>;
  markPrinted: () => Promise<BomShipmentPackingListType>;
}>();
const emit = defineEmits<{ close: [] }>();

const data = ref<BomShipmentPackingListType | null>(null);
const loading = ref(false);
const busy = ref<'' | 'save' | 'print'>('');
const error = ref('');
const view = ref<'edit' | 'preview'>('edit');
const qrImages = ref<Record<string, string>>({});
const qrLoading = ref(false);

const packageKey = (pkg: BomShipmentPackingPackageType): string => pkg.token ?? `draft-${String(pkg.packageNo)}`;

// QR 이 가리키는 주소는 **종이에 찍혀 오래 남는다** — 리뉴얼 경로(/admin/next/…)를 찍으면 컷오버 뒤
// 죽은 링크가 된다. 그래서 컷오버 뒤에도 같은 화면이 이어받는 정식 경로(/admin/smartbom/packages)로 둔다.
const qrTarget = (token: string): string =>
  new URL(`/app/admin/smartbom/packages/${encodeURIComponent(token)}`, window.location.origin).toString();

async function rebuildQrImages(): Promise<void> {
  const current = data.value;
  if (current === null) {
    qrImages.value = {};
    return;
  }
  qrLoading.value = true;
  try {
    const entries = await Promise.all(
      current.items.flatMap((item) =>
        item.packages.flatMap((pkg) =>
          pkg.token === null
            ? []
            : [
                toDataURL(qrTarget(pkg.token), { errorCorrectionLevel: 'M', margin: 1, width: 240 }).then(
                  (url) => [pkg.token ?? '', url] as const,
                ),
              ],
        ),
      ),
    );
    qrImages.value = Object.fromEntries(entries);
  } finally {
    qrLoading.value = false;
  }
}

async function loadPacking(): Promise<void> {
  loading.value = true;
  error.value = '';
  data.value = null;
  try {
    const loaded = await props.load();
    data.value = structuredClone(loaded);
    view.value = loaded.editable ? 'edit' : 'preview';
    await rebuildQrImages();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '선적 리스트를 불러오지 못했습니다.';
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) void loadPacking();
  },
  { immediate: true },
);

const packageQuantity = (pkg: BomShipmentPackingPackageType): number => {
  const value: unknown = pkg.quantity;
  return typeof value === 'number' ? value : Number.NaN;
};

const itemPackedQty = (item: BomShipmentPackingItemType): number =>
  item.packages.reduce((sum, pkg) => sum + packageQuantity(pkg), 0);

function addPackage(item: BomShipmentPackingItemType): void {
  if (data.value?.editable !== true || item.packages.length >= 20) return;
  const donor = [...item.packages].reverse().find((pkg) => pkg.quantity > 1);
  if (donor === undefined) {
    error.value = '더 나눌 수량이 없습니다.';
    return;
  }
  donor.quantity -= 1;
  item.packages.push({
    packageId: null,
    token: null,
    labelCode: null,
    packageNo: item.packages.length + 1,
    quantity: 1,
    lotNo: null,
    dateCode: null,
    status: 'prepared',
    storageLocation: null,
    receivedAt: null,
    inspectedAt: null,
    issuedAt: null,
    events: [],
  });
  error.value = '';
}

function removePackage(item: BomShipmentPackingItemType, index: number): void {
  if (data.value?.editable !== true || item.packages.length <= 1) return;
  const removed = item.packages[index];
  if (removed === undefined) return;
  const target = item.packages.find((_pkg, candidateIndex) => candidateIndex !== index);
  if (target === undefined) return;
  target.quantity += removed.quantity;
  item.packages.splice(index, 1);
  item.packages.forEach((pkg, packageIndex) => {
    pkg.packageNo = packageIndex + 1;
  });
  error.value = '';
}

// 입력값 반영 — 빈 칸은 NaN 으로 두어 검증(합계 = 발주 수량)이 잡게 한다(옛 v-model.number 와 같은 결과).
const setQuantity = (pkg: BomShipmentPackingPackageType, value: string | number): void => {
  pkg.quantity = String(value).trim() === '' ? Number.NaN : Number(value);
};
const setText = (pkg: BomShipmentPackingPackageType, key: 'lotNo' | 'dateCode', value: string | number): void => {
  pkg[key] = String(value);
};

const allQuantitiesValid = computed(
  () =>
    data.value?.items.every(
      (item) =>
        item.packages.every((pkg) => {
          const quantity = packageQuantity(pkg);
          return Number.isInteger(quantity) && quantity > 0;
        }) && itemPackedQty(item) === item.expectedQty,
    ) ?? false,
);

const allPackages = computed(() =>
  (data.value?.items ?? []).flatMap((item) => item.packages.map((pkg) => ({ item, pkg }))),
);

const canPrint = computed(
  () =>
    data.value !== null &&
    data.value.revision > 0 &&
    !qrLoading.value &&
    allPackages.value.length > 0 &&
    allPackages.value.every(({ pkg }) => pkg.token !== null && qrImages.value[pkg.token] !== undefined),
);

function saveBody(): BomShipmentPackingListSaveBodyType {
  const current = data.value;
  if (current === null) return { items: [] };
  return {
    items: current.items.map((item) => ({
      poItemId: item.poItemId,
      packages: item.packages.map((pkg) => ({
        packageId: pkg.packageId,
        quantity: pkg.quantity,
        lotNo: pkg.lotNo === null || pkg.lotNo.trim() === '' ? null : pkg.lotNo.trim(),
        dateCode: pkg.dateCode === null || pkg.dateCode.trim() === '' ? null : pkg.dateCode.trim(),
      })),
    })),
  };
}

async function savePacking(): Promise<void> {
  if (busy.value !== '' || data.value?.editable !== true) return;
  if (!allQuantitiesValid.value) {
    error.value = '각 품목의 포장 수량 합계가 발주 수량과 같아야 합니다.';
    return;
  }
  busy.value = 'save';
  error.value = '';
  try {
    data.value = structuredClone(await props.save(saveBody()));
    await rebuildQrImages();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : 'QR 저장에 실패했습니다.';
  } finally {
    busy.value = '';
  }
}

async function printDocument(): Promise<void> {
  if (busy.value !== '' || !canPrint.value) return;
  busy.value = 'print';
  error.value = '';
  try {
    data.value = structuredClone(await props.markPrinted());
    await rebuildQrImages();
    await nextTick();
    window.print();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '인쇄 준비에 실패했습니다.';
  } finally {
    busy.value = '';
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
// lib/usePrintIsolation 머리말). 훅은 data 속성으로 건다. 내용은 옛 모달의 인쇄 규칙과 같다.
const PRINT_CSS = `
@media print {
  body > :not([data-packing-host]) {
    display: none !important;
  }

  [data-packing-host] {
    position: static !important;
    overflow: visible !important;
    background: none !important;
    display: block !important;
  }

  [data-packing-scroll] {
    position: static !important;
    overflow: visible !important;
    max-height: none !important;
    padding: 0 !important;
    display: block !important;
  }

  [data-packing-host] [data-no-print] {
    display: none !important;
  }

  [data-packing-host] [data-packing-print] {
    display: block !important;
  }

  [data-packing-sheet] {
    box-shadow: none !important;
    margin: 0 !important;
  }

  [data-packing-labels] {
    break-before: page;
    page-break-before: always;
  }

  [data-packing-label] {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  @page {
    size: A4 portrait;
    margin: 8mm;
  }
}
`;
usePrintIsolation('sp-next-bom-packing-print-style', PRINT_CSS, () => props.open);
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      data-packing-host
      class="fixed inset-0 z-50 bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bom-packing-dialog-title"
    >
      <div data-packing-scroll class="flex h-full flex-col items-center overflow-auto p-4 sm:p-6" @click.self="emit('close')">
        <Card data-no-print class="mb-3 w-full max-w-6xl flex-row flex-wrap items-center gap-2 p-3">
          <div class="mr-auto min-w-0">
            <h2 id="bom-packing-dialog-title" class="text-sm font-semibold">선적 리스트·부품 QR 라벨</h2>
            <p v-if="data !== null" class="text-muted-foreground text-xs">
              {{ data.packingNo }} · revision {{ data.revision }} · 실물 포장 {{ data.totalPackages }}개
            </p>
          </div>
          <ButtonGroup>
            <Button :variant="view === 'edit' ? 'secondary' : 'outline'" :disabled="data === null" @click="view = 'edit'">
              포장 편집
            </Button>
            <Button :variant="view === 'preview' ? 'secondary' : 'outline'" :disabled="data === null" @click="view = 'preview'">
              인쇄 미리보기
            </Button>
          </ButtonGroup>
          <Button
            v-if="data?.editable"
            variant="outline"
            :disabled="busy !== '' || !allQuantitiesValid"
            @click="void savePacking()"
          >
            <Spinner v-if="busy === 'save'" />
            <SaveIcon v-else />
            {{ busy === 'save' ? '저장 중…' : '저장·QR 생성' }}
          </Button>
          <Button :disabled="busy !== '' || !canPrint" @click="void printDocument()">
            <Spinner v-if="busy === 'print'" />
            <PrinterIcon v-else />
            {{ busy === 'print' ? '인쇄 준비 중…' : 'Packing List·라벨 인쇄' }}
          </Button>
          <Button variant="ghost" size="icon" aria-label="닫기" @click="emit('close')">
            <XIcon />
          </Button>
        </Card>

        <Card v-if="loading" data-no-print class="w-full max-w-6xl flex-row items-center justify-center gap-2 py-16">
          <Spinner />
          <span class="text-muted-foreground text-sm">불러오는 중…</span>
        </Card>
        <Alert v-else-if="error !== ''" data-no-print variant="destructive" size="sm" class="mb-3 w-full max-w-6xl">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>

        <Card v-if="data !== null && view === 'edit'" data-no-print class="w-full max-w-6xl gap-3 p-4">
          <Alert variant="info" size="sm">
            <InfoIcon />
            <AlertDescription>
              <p>
                QR 1개는 부품 한 알이 아니라 <b>릴·트레이·튜브·봉투·박스 같은 실물 포장 1개</b>를 뜻합니다. 포장 수량
                합계는 발주 수량과 같아야 하며, 저장 후 재인쇄해도 같은 QR을 사용합니다.
              </p>
            </AlertDescription>
          </Alert>
          <Alert v-if="!data.editable" variant="warning" size="sm">
            <TriangleAlertIcon />
            <AlertTitle>발송이 진행되어 편집할 수 없습니다. 기존 문서와 QR은 그대로 재인쇄할 수 있습니다.</AlertTitle>
          </Alert>

          <Panel v-for="item in data.items" :key="item.poItemId">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p class="font-mono text-sm font-bold">{{ item.mpn }}</p>
                <p class="text-muted-foreground text-xs">
                  {{ item.manufacturerName ?? '제조사 미상' }} · PO #{{ item.poId }} · {{ item.quoteTitle }}
                </p>
                <p v-if="item.partId !== null" class="text-muted-foreground mt-0.5 text-xs">카탈로그 partId {{ item.partId }}</p>
              </div>
              <Badge :variant="itemPackedQty(item) === item.expectedQty ? 'success' : 'danger'">
                포장 {{ itemPackedQty(item).toLocaleString('ko-KR') }} / 발주 {{ item.expectedQty.toLocaleString('ko-KR') }}
              </Badge>
            </div>

            <div class="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead class="w-12">포장</TableHead>
                    <TableHead class="w-32">수량</TableHead>
                    <TableHead>LOT NO.</TableHead>
                    <TableHead>DATE CODE</TableHead>
                    <TableHead>QR 코드</TableHead>
                    <TableHead class="w-20" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow v-for="(pkg, index) in item.packages" :key="packageKey(pkg)">
                    <TableCell class="font-bold">#{{ index + 1 }}</TableCell>
                    <TableCell>
                      <Input
                        :model-value="Number.isNaN(pkg.quantity) ? '' : pkg.quantity"
                        type="number"
                        min="1"
                        class="w-28"
                        :aria-label="`${item.mpn} 포장 ${String(index + 1)} 수량`"
                        :disabled="!data.editable || pkg.status !== 'prepared'"
                        @update:model-value="(value: string | number) => setQuantity(pkg, value)"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        :model-value="pkg.lotNo ?? ''"
                        type="text"
                        maxlength="100"
                        class="min-w-28"
                        :aria-label="`${item.mpn} 포장 ${String(index + 1)} LOT`"
                        :disabled="!data.editable || pkg.status !== 'prepared'"
                        @update:model-value="(value: string | number) => setText(pkg, 'lotNo', value)"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        :model-value="pkg.dateCode ?? ''"
                        type="text"
                        maxlength="100"
                        class="min-w-24"
                        :aria-label="`${item.mpn} 포장 ${String(index + 1)} DATE CODE`"
                        :disabled="!data.editable || pkg.status !== 'prepared'"
                        @update:model-value="(value: string | number) => setText(pkg, 'dateCode', value)"
                      />
                    </TableCell>
                    <TableCell class="text-muted-foreground font-mono text-xs whitespace-nowrap">
                      {{ pkg.labelCode ?? '저장 후 생성' }}
                      <Badge v-if="pkg.packageId !== null" variant="secondary" class="ml-1">
                        {{ BOM_PART_PACKAGE_STATUS_LABELS[pkg.status] }}
                      </Badge>
                    </TableCell>
                    <TableCell class="text-right">
                      <Button
                        variant="ghost"
                        size="xs"
                        :disabled="!data.editable || item.packages.length <= 1 || pkg.status !== 'prepared'"
                        @click="removePackage(item, index)"
                      >
                        <span class="text-destructive">제거</span>
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            <Button
              variant="link"
              size="xs"
              class="mt-2"
              :disabled="!data.editable || item.packages.length >= 20"
              @click="addPackage(item)"
            >
              <PlusIcon />
              실물 포장 나누기
            </Button>
          </Panel>
        </Card>

        <!-- 화면 미리보기이자 실제 인쇄 대상: 1부 Packing List + 후속 QR 라벨 시트(인쇄 때는 늘 보인다) -->
        <PackingListSheet v-if="data !== null" v-show="view === 'preview'" :data="data" :qr-images="qrImages" />
      </div>
    </div>
  </Teleport>
</template>
