<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowLeftIcon, ArrowRightIcon, PackageIcon, PlusIcon, XCircleIcon } from '@lucide/vue';
import {
  BOM_PO_SHORTAGE_REASON_LABELS,
  BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL,
  BOM_SHIPMENT_MODE_LABELS,
  BOM_SHIPMENT_STATUS_LABELS,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusLabel,
  type AdminBomPoViewType,
  type BomPoItemViewType,
} from '@sp/api-contract';
import { smartbomFmtDate, smartbomFmtWon } from '@/admin/smartbom';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/next/components/ui/table';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import { mouserCartHealthLabel, mouserCartTone } from './po/mouser-cart';
import { bomPoStatusBadge } from './smartbom-badges';

// Case 상세의 협력사 발주서 패널(D18) — 옛 components/admin/smartbom/BomPoPanel.vue 의 짝(같은 props·emits).
// 발행·확인·마감 현황. 발주서는 박제 문서라 수정이 없고, 재발행 = 미확인(issued) 삭제 후 재생성.
const props = defineProps<{
  pos: AdminBomPoViewType[];
  loading: boolean;
  canIssue: boolean; // 결제 확인(isPaid) 후에만 발행 가능(D18-4)
  issueDisabledReason: string;
  busy: boolean;
  checkingPoId: number | null; // 카트 상태 확인 중인 발주서(D41) — 확인 버튼만 잠근다
}>();
const emit = defineEmits<{
  create: [];
  remove: [po: AdminBomPoViewType];
  confirmSupplier: [po: AdminBomPoViewType];
  close: [po: AdminBomPoViewType];
  external: [po: AdminBomPoViewType]; // 외부 실행 재시도/재발급/다시 담기(D20·D41)
  check: [po: AdminBomPoViewType]; // Mouser 카트 상태 확인(D41)
  importFile: [po: AdminBomPoViewType]; // 공급사 장바구니 가져오기 파일(D41)
  shipment: [po: AdminBomPoViewType]; // 선적 관리(D21)
  recover: [po: AdminBomPoViewType, item: BomPoItemViewType]; // 부족분 대체발주(D31)
}>();

function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}

// ── Mouser 카트 인계(D41) — API 카트는 웹 '현재 장바구니'가 아니고 시간이 지나면 비워질 수 있다.
//    CartKey·담은 시각·실시간 상태를 보이고 [다시 담기]·가져오기 파일로 길을 둔다. 한눈 줄(사실·상태) +
//    버튼 줄이 기본이고, 식별자·상세·안내는 [자세히] 안에 둔다.
const externalDetailOpen = ref(new Set<number>());
function toggleExternalDetail(poId: number): void {
  const next = new Set(externalDetailOpen.value);
  if (next.has(poId)) next.delete(poId);
  else next.add(poId);
  externalDetailOpen.value = next;
}
const shortCartKey = (key: string): string => `${key.slice(0, 8)}…`;
const copiedKey = ref<string | null>(null);
async function copyCartKey(key: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(key);
    copiedKey.value = key;
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = null;
    }, 1500);
  } catch {
    /* 클립보드 거부 — 키는 title 로도 노출돼 있다 */
  }
}
const fmtMoney = (amount: number | null | undefined, currency: string | null | undefined): string =>
  amount === null || amount === undefined ? '' : `${amount.toLocaleString('ko-KR')} ${currency ?? ''}`.trim();

// 선적 요약 라벨 — 국내 preparing 은 '배송 준비'
function shipmentLabel(po: AdminBomPoViewType): string {
  const shipment = po.shipment;
  if (shipment === null) return '—';
  const statusText =
    shipment.mode === 'domestic' && shipment.status === 'preparing'
      ? BOM_SHIPMENT_DOMESTIC_PREPARING_LABEL
      : BOM_SHIPMENT_STATUS_LABELS[shipment.status];
  return `${BOM_SHIPMENT_MODE_LABELS[shipment.mode]} · ${statusText}`;
}

// 핑퐁 차례(D22 인지) — 다음 단계 주체가 관리자면 행·버튼 강조, 협력사면 대기 힌트.
function shipmentNextActor(po: AdminBomPoViewType): 'ADMIN' | 'PARTNER' | null {
  const shipment = po.shipment;
  if (shipment === null) return null;
  if (shipment.receivedAt !== null) return null;
  const next = bomShipmentNextStatus(shipment.mode, shipment.status);
  return next === null ? null : bomShipmentActorOf(shipment.mode, next);
}
function shipmentNextLabel(po: AdminBomPoViewType): string {
  const shipment = po.shipment;
  if (shipment === null) return '';
  const next = bomShipmentNextStatus(shipment.mode, shipment.status);
  return next === null ? '' : bomShipmentStatusLabel(shipment.mode, next);
}
function shipmentCaseRefPending(po: AdminBomPoViewType): boolean {
  const shipment = po.shipment;
  return (
    shipment !== null &&
    shipment.receivedAt === null &&
    shipment.caseRefRequestedAt !== null &&
    (shipment.caseRef === null || shipment.caseRef === '')
  );
}
function shipmentAdminPending(po: AdminBomPoViewType): boolean {
  return shipmentCaseRefPending(po) || shipmentNextActor(po) === 'ADMIN';
}
const adminPendingCount = computed(() => props.pos.filter(shipmentAdminPending).length);
const confirmedCount = computed(() => props.pos.filter((p) => p.status !== 'issued').length);
const openShortageCount = computed(() =>
  props.pos.reduce(
    (count, po) => count + po.items.filter((item) => item.shortage !== null && item.shortage.recovery === null).length,
    0,
  ),
);
const procurementItems = (po: AdminBomPoViewType): BomPoItemViewType[] =>
  po.items.filter((item) => item.shortage !== null || item.recoverySource !== null);

const externalFailureResolved = (po: AdminBomPoViewType): boolean =>
  po.externalRef?.state === 'failed' && po.status !== 'issued';

const externalFailureRetryable = (po: AdminBomPoViewType): boolean =>
  po.externalRef?.state === 'failed' && po.status === 'issued' && (po.externalRef.skippedNoSku ?? 0) < po.itemCount;

const shipmentTitle = (po: AdminBomPoViewType): string =>
  po.status === 'issued'
    ? po.supplierCode !== null
      ? '공급사 구매 완료 처리 후 선적을 진행할 수 있습니다'
      : '협력사가 발주 확인을 완료한 뒤 선적을 진행할 수 있습니다'
    : '';

// 좁은 화면 — 표 안쪽 가로 스크롤을 버튼으로도 옮긴다(선적·입고·작업 열이 오른쪽에 있다).
const tableWrap = ref<HTMLElement | null>(null);
function moveTable(direction: -1 | 1): void {
  tableWrap.value
    ?.querySelector<HTMLElement>('[data-slot="table-container"]')
    ?.scrollBy({ left: direction * 280, behavior: 'smooth' });
}
</script>

<template>
  <SectionCard title="조달 발주 (PO)" flush>
    <template #meta>
      <template v-if="pos.length > 0">
        발주서 <b class="text-foreground">{{ pos.length }}</b> · 확인 <b class="text-success">{{ confirmedCount }}</b>
        <template v-if="adminPendingCount > 0"> · <b class="text-info">선적 처리 필요 {{ adminPendingCount }}</b></template>
        <template v-if="openShortageCount > 0"> · <b class="text-destructive">대체발주 대기 {{ openShortageCount }}</b></template>
      </template>
    </template>
    <template #actions>
      <Button size="sm" :disabled="!canIssue" :title="canIssue ? '' : issueDisabledReason" @click="emit('create')">
        <PlusIcon />
        발주서 생성
      </Button>
    </template>
    <template v-if="pos.length > 0" #notice>
      <NoticeBand class="flex items-center gap-2 text-xs xl:hidden">
        <span class="min-w-0 flex-1">좌우로 이동해 선적·입고 상태와 작업 버튼을 확인할 수 있습니다.</span>
        <Button variant="outline" size="icon-xs" aria-label="발주 표 왼쪽으로 이동" @click="moveTable(-1)">
          <ArrowLeftIcon />
        </Button>
        <Button variant="outline" size="icon-xs" aria-label="발주 표 오른쪽으로 이동" @click="moveTable(1)">
          <ArrowRightIcon />
        </Button>
      </NoticeBand>
    </template>

    <p v-if="loading && pos.length === 0" class="text-muted-foreground px-4 py-6 text-center text-sm">불러오는 중…</p>
    <p v-else-if="pos.length === 0" class="text-muted-foreground px-4 py-6 text-center text-sm">
      아직 발행한 발주서가 없습니다{{ canIssue ? '' : ` — ${issueDisabledReason}` }}.
    </p>
    <div v-else ref="tableWrap">
      <Table class="min-w-240">
        <TableHeader>
          <TableRow>
            <TableHead>구매처</TableHead>
            <TableHead>상태</TableHead>
            <TableHead class="text-right">품목</TableHead>
            <TableHead class="text-right">발주 문서 / 실제 공급(VAT 별도)</TableHead>
            <TableHead>선적·입고</TableHead>
            <TableHead>발행/확인</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="po in pos" :key="po.poId">
            <TableCell class="align-top font-medium whitespace-normal">
              <span class="inline-flex flex-wrap items-center gap-1">
                {{ po.partnerName }}
                <span v-if="po.supplierCode !== null" class="text-muted-foreground font-mono text-xs">{{ po.supplierCode }}</span>
              </span>
              <Panel
                v-for="item in procurementItems(po)"
                :key="`procurement-${String(item.poItemId)}`"
                size="xs"
                :tone="item.shortage !== null ? 'destructive' : 'info'"
                class="mt-1.5 text-xs font-normal"
              >
                <template v-if="item.shortage !== null">
                  <p class="font-semibold">
                    {{ item.mpn || '품번 미기재' }} · {{ BOM_PO_SHORTAGE_REASON_LABELS[item.shortage.reason] }} · 부족
                    {{ item.shortage.shortageQty.toLocaleString('ko-KR') }}개
                  </p>
                  <p>원 PO 공급 {{ item.shortage.suppliedQty.toLocaleString('ko-KR') }}/{{ item.qty.toLocaleString('ko-KR') }}개</p>
                  <p class="font-medium">실제 공급 금액 {{ smartbomFmtWon(item.shortage.suppliedAmount) }}</p>
                  <p v-if="item.shortage.recovery !== null" class="text-success font-medium">
                    → {{ item.shortage.recovery.partnerName }} 대체 PO #{{ item.shortage.recovery.poId }}
                    <template v-if="item.shortage.recovery.receivedAt !== null"> · 입고 완료</template>
                  </p>
                  <Button v-else variant="destructive" size="xs" class="mt-1" :disabled="busy" @click="emit('recover', po, item)">
                    잔량 대체발주
                  </Button>
                </template>
                <template v-else-if="item.recoverySource !== null">
                  <b>{{ item.mpn || '품번 미기재' }} · 대체발주 {{ item.qty.toLocaleString('ko-KR') }}개</b>
                  <p>{{ item.recoverySource.sourcePartnerName }} 공급 부족분 회복</p>
                </template>
              </Panel>

              <!-- 외부 실행 결과(D20) — 카트/리스트까지, 실결제는 공급사 사이트에서 -->
              <div v-if="po.externalRef !== null" class="mt-1 text-xs font-normal">
                <template v-if="po.externalRef.state === 'ok' && po.externalRef.cartKey !== undefined">
                  <Panel size="xs" :tone="mouserCartTone(po)" data-testid="mouser-cart-box">
                    <p class="flex flex-wrap items-center gap-x-1.5">
                      <b>Mouser 카트 담김 · {{ po.externalRef.lineCount ?? 0 }}행</b>
                      <span class="text-muted-foreground">
                        {{ fmtMoney(po.externalRef.merchandiseTotal, po.externalRef.currencyCode) }} · {{ smartbomFmtDate(po.externalRef.executedAt) }}
                      </span>
                      <span
                        class="font-semibold"
                        data-testid="mouser-cart-health"
                        :title="po.externalRef.checkError ?? (po.externalRef.liveDiff ?? []).join('\n')"
                      >{{ mouserCartHealthLabel(po) }}</span>
                      <span
                        v-if="(po.externalRef.errors?.length ?? 0) > 0"
                        class="text-warning"
                        :title="po.externalRef.errors?.join('\n')"
                      >행 오류 {{ po.externalRef.errors?.length }}</span>
                    </p>
                    <p class="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                      <Button
                        v-if="po.status === 'issued'"
                        variant="link"
                        size="xs"
                        :disabled="busy || checkingPoId === po.poId"
                        @click="emit('check', po)"
                      >
                        {{ checkingPoId === po.poId ? '확인 중…' : '카트 상태 확인' }}
                      </Button>
                      <Button
                        v-if="po.status === 'issued'"
                        variant="link"
                        size="xs"
                        :disabled="busy"
                        title="같은 CartKey 카트를 발주 품목으로 다시 채웁니다(전체 교체)"
                        @click="emit('external', po)"
                      >
                        다시 담기
                      </Button>
                      <Button
                        v-if="po.externalRef.cartWebUrl !== undefined"
                        variant="link"
                        size="xs"
                        @click="openExternal(po.externalRef.cartWebUrl)"
                      >
                        Mouser 열기
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        :aria-expanded="externalDetailOpen.has(po.poId)"
                        @click="toggleExternalDetail(po.poId)"
                      >
                        {{ externalDetailOpen.has(po.poId) ? '접기' : '자세히' }}
                      </Button>
                    </p>
                    <div v-if="externalDetailOpen.has(po.poId)" class="mt-1 border-t pt-1" data-testid="mouser-cart-detail">
                      <p class="text-muted-foreground flex flex-wrap items-center gap-1 font-mono" :title="po.externalRef.cartKey">
                        CartKey {{ shortCartKey(po.externalRef.cartKey) }}
                        <Button variant="link" size="xs" @click="copyCartKey(po.externalRef.cartKey)">
                          {{ copiedKey === po.externalRef.cartKey ? '복사됨' : '복사' }}
                        </Button>
                        <span v-if="(po.externalRef.refilledCount ?? 0) > 0" class="font-sans">· 다시 담기 {{ po.externalRef.refilledCount }}회</span>
                      </p>
                      <p v-if="po.externalRef.checkedAt !== undefined" class="mt-0.5">
                        <template v-if="po.externalRef.checkError !== undefined">확인 실패 · {{ po.externalRef.checkError }}</template>
                        <template v-else-if="(po.externalRef.liveLineCount ?? 0) === 0">
                          카트가 비어 있습니다(만료·삭제됨) — [다시 담기] 뒤 바로 주문하세요.
                        </template>
                        <template v-else-if="po.externalRef.liveMatches === false">
                          발주와 다름 · {{ (po.externalRef.liveDiff ?? []).join(', ') }}
                        </template>
                        <template v-else>
                          카트 {{ po.externalRef.liveLineCount }}행 일치 · {{ smartbomFmtDate(po.externalRef.checkedAt) }} 확인
                        </template>
                      </p>
                      <p v-else class="text-muted-foreground mt-0.5">아직 확인 전 — API 카트는 시간이 지나면 비워질 수 있습니다.</p>
                      <p v-if="po.status === 'issued'" class="mt-0.5">
                        <Button
                          variant="link"
                          size="xs"
                          :disabled="busy"
                          title="API 카트와 무관하게 Mouser 장바구니 '스프레드시트 업로드'에 올리는 .csv"
                          @click="emit('importFile', po)"
                        >
                          가져오기 파일(.csv)
                        </Button>
                        <span class="text-muted-foreground">
                          SamplePCB 계정 로그인 → '저장한 장바구니'에서 이 CartKey 카트 선택. 비어 있으면 [다시 담기] 또는 .csv 업로드.
                        </span>
                      </p>
                    </div>
                  </Panel>
                </template>
                <template v-else-if="po.externalRef.state === 'ok' && po.externalRef.singleUseUrl !== undefined">
                  <!-- DigiKey 리스트(D20·D41) — Mouser 카트 상자와 같은 틀 -->
                  <Panel size="xs" tone="success" data-testid="digikey-list-box">
                    <p class="flex flex-wrap items-center gap-x-1.5">
                      <b>DigiKey 리스트 생성됨 · {{ po.externalRef.lineCount ?? 0 }}행</b>
                      <span class="text-muted-foreground">{{ smartbomFmtDate(po.externalRef.executedAt) }}</span>
                      <span
                        class="font-semibold"
                        data-testid="digikey-list-health"
                        title="열면 담당자 본인 DigiKey 계정 myLists 에 담기며 URL 은 소진됩니다"
                      >1회용 URL</span>
                    </p>
                    <p class="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5">
                      <Button
                        variant="link"
                        size="xs"
                        title="1회용 URL — 열면 소진되며 [재발급]으로 다시 만들 수 있습니다"
                        @click="openExternal(po.externalRef.singleUseUrl)"
                      >
                        DigiKey 리스트 열기(1회용)
                      </Button>
                      <Button
                        v-if="po.status === 'issued'"
                        variant="link"
                        size="xs"
                        :disabled="busy"
                        title="새 single-use URL 을 발급합니다(이전 URL 은 그대로 소진)"
                        @click="emit('external', po)"
                      >
                        재발급
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        :aria-expanded="externalDetailOpen.has(po.poId)"
                        @click="toggleExternalDetail(po.poId)"
                      >
                        {{ externalDetailOpen.has(po.poId) ? '접기' : '자세히' }}
                      </Button>
                    </p>
                    <div v-if="externalDetailOpen.has(po.poId)" class="mt-1 border-t pt-1" data-testid="digikey-list-detail">
                      <p class="text-muted-foreground font-mono" :title="po.externalRef.listName ?? ''">
                        리스트 {{ po.externalRef.listName ?? '—' }}
                        <span v-if="(po.externalRef.refilledCount ?? 0) > 0" class="font-sans"> · 재발급 {{ po.externalRef.refilledCount }}회</span>
                      </p>
                      <p class="mt-0.5">
                        열면 담당자 본인 DigiKey 계정 myLists 에 담기며 URL 은 소진됩니다. 소진됐으면 [재발급]으로 새 URL 을 만듭니다.
                      </p>
                      <p v-if="po.status === 'issued'" class="mt-0.5">
                        <Button
                          variant="link"
                          size="xs"
                          :disabled="busy"
                          title="리스트와 무관하게 DigiKey 장바구니 업로드에 쓰는 .csv"
                          @click="emit('importFile', po)"
                        >
                          가져오기 파일(.csv)
                        </Button>
                        <span class="text-muted-foreground">리스트와 무관하게 DigiKey 장바구니 업로드에 쓰는 .csv</span>
                      </p>
                    </div>
                  </Panel>
                </template>
                <template v-else>
                  <Panel size="xs" :tone="externalFailureResolved(po) ? 'warning' : 'destructive'">
                    <p class="font-semibold">
                      {{ externalFailureResolved(po) ? '자동 실행 실패 · 수동 구매 완료' : '자동 실행 실패 · 수동 주문 필요' }}
                    </p>
                    <p class="break-words" :title="po.externalRef.error">
                      {{ po.externalRef.error ?? '공급사 자동 실행을 완료하지 못했습니다.' }}
                    </p>
                    <Button v-if="externalFailureRetryable(po)" variant="link" size="xs" :disabled="busy" @click="emit('external', po)">
                      자동 실행 재시도
                    </Button>
                  </Panel>
                </template>
                <span v-if="(po.externalRef.skippedNoSku ?? 0) > 0" class="text-warning">SKU 없음 {{ po.externalRef.skippedNoSku }}행 제외</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge :variant="bomPoStatusBadge(po).variant">{{ bomPoStatusBadge(po).label }}</Badge>
            </TableCell>
            <TableCell class="text-right tabular-nums">{{ po.itemCount }}</TableCell>
            <TableCell class="text-right tabular-nums">
              <p>{{ smartbomFmtWon(po.totalAmount) }}</p>
              <p v-if="po.actualSupplyAmount !== po.totalAmount" class="text-warning mt-0.5 text-xs font-semibold">
                실제 공급 {{ smartbomFmtWon(po.actualSupplyAmount) }}
              </p>
            </TableCell>
            <!-- 선적(D21·D22) — 모드·상태·송장 + 차례 표시 + 입고 확인 -->
            <TableCell>
              <span class="inline-flex flex-wrap items-center gap-1">
                <span
                  :class="po.shipment === null
                    ? 'text-muted-foreground'
                    : shipmentAdminPending(po)
                      ? 'text-info font-semibold'
                      : ''"
                >{{ shipmentLabel(po) }}</span>
                <Badge
                  v-if="shipmentCaseRefPending(po)"
                  variant="warning"
                  title="협력사가 샘플피씨비 운송의 발송 참조번호(Case ID)를 기다리고 있습니다."
                >Case ID 요청</Badge>
                <Badge
                  v-else-if="shipmentNextActor(po) === 'ADMIN'"
                  variant="info"
                  :title="`협력사가 단계를 넘겼습니다 — [선적 관리]에서 '${shipmentNextLabel(po)}' 처리를 진행해 주세요`"
                >{{ shipmentNextLabel(po) }} 처리 필요</Badge>
                <span
                  v-else-if="shipmentNextActor(po) === 'PARTNER'"
                  class="text-muted-foreground text-xs"
                  :title="`협력사의 '${shipmentNextLabel(po)}' 처리를 기다리는 중`"
                >협력사 차례</span>
                <!-- 선적 그룹(§6.10) — 여러 발주서 한 물류 묶음 -->
                <Badge
                  v-if="(po.shipment?.groupPos.length ?? 0) > 1"
                  variant="outline"
                  :title="po.shipment?.groupPos.map((g) => g.quoteTitle).join('\n')"
                >
                  <PackageIcon />
                  묶음 {{ po.shipment?.groupPos.length }}건
                </Badge>
                <span
                  v-if="po.shipment?.trackingNumber != null"
                  class="text-muted-foreground font-mono text-xs"
                  :title="po.shipment.carrier ?? ''"
                >{{ po.shipment.trackingNumber }}</span>
                <Badge v-if="po.shipment?.receivedAt != null" variant="success" :title="po.shipment.receivedNote ?? ''">입고 완료</Badge>
              </span>
            </TableCell>
            <TableCell class="text-muted-foreground">
              {{ smartbomFmtDate(po.issuedAt) }}
              <template v-if="po.confirmedAt !== null"> → {{ smartbomFmtDate(po.confirmedAt) }}</template>
            </TableCell>
            <TableCell class="text-right">
              <span class="inline-flex flex-wrap justify-end gap-1">
                <Button
                  :variant="shipmentAdminPending(po) ? 'default' : 'outline'"
                  size="xs"
                  :disabled="busy || po.status === 'issued'"
                  :title="shipmentTitle(po)"
                  @click="emit('shipment', po)"
                >
                  선적 관리
                </Button>
                <Button
                  v-if="po.supplierCode !== null && po.status === 'issued'"
                  size="xs"
                  :disabled="busy"
                  @click="emit('confirmSupplier', po)"
                >
                  구매 완료 처리
                </Button>
                <Button
                  v-if="po.status === 'issued'"
                  variant="outline"
                  size="xs"
                  :disabled="busy"
                  title="미확인 발주서 발행 취소(재발행 = 삭제 후 재생성)"
                  @click="emit('remove', po)"
                >
                  <XCircleIcon class="text-destructive" />
                  발행 취소
                </Button>
                <Button v-if="po.status !== 'closed'" variant="ghost" size="xs" :disabled="busy" @click="emit('close', po)">
                  마감
                </Button>
              </span>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  </SectionCard>
</template>
