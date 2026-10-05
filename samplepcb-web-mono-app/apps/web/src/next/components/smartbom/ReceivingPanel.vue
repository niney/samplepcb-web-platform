<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { TriangleAlertIcon } from '@lucide/vue';
import { ApiRequestError } from '@sp/shared';
import type {
  BomReceivingCandidateType,
  BomReceivingParsedBarcodeType,
  BomReceivingPoProgressType,
  BomReceivingScanRecordType,
  DigikeyBarcodeLookupType,
} from '@sp/api-contract';
import {
  useCompleteReceiving,
  useRecentReceivingScans,
  useRecordReceivingScan,
  useScanReceivingBarcode,
  useVoidReceivingScan,
} from '@/admin/useAdminBomReceiving';
import {
  useDigikeyBarcodeLookup,
  useDigikeyStatus,
  useDisconnectDigikey,
  useStartDigikeyOauth,
} from '@/admin/useAdminDigikey';
import { smartbomFmtDate } from '@/admin/smartbom';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Field, FieldContent, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/next/components/ui/radio-group';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import NoticeBand from '@/next/components/common/NoticeBand.vue';
import Panel from '@/next/components/common/Panel.vue';
import SectionCard from '@/next/components/common/SectionCard.vue';
import TableCard from '@/next/components/common/TableCard.vue';
import { confirmDialog } from '@/next/lib/dialog';
import { smartbomCaseTo } from '@/next/smartbom-navigation';
import { receivingScanTextClass } from './smartbom-badges';

// 공급사 입고 스캔 패널(D42) — 옛 components/admin/smartbom/BomReceivingPanel.vue 의 짝(같은 emits·expose).
// 선적·배송 화면의 통합 스캔 박스가 봉투 라벨(ECIA 2D·1D)을 넘기면 대조→기록→진행→최근 목록을 이 안에서
// 처리한다. 입력창은 부모(통합 박스)가 갖고 `scan(raw)` 로 넘긴다.
// DigiKey Barcoding(3-legged 연결)은 보조 — 1D 구형 라벨이거나 라벨을 못 읽을 때 [DigiKey 조회].

const emit = defineEmits<{
  settled: []; // 대조·기록·조회가 끝났다 — 부모가 스캔 입력으로 포커스를 되돌린다
}>();

const SUPPLIER_LABEL: Record<string, string> = { digikey: 'DigiKey', mouser: 'Mouser', unknown: '미판정' };

const route = useRoute();
const lastBarcode = ref('');
const parsed = ref<BomReceivingParsedBarcodeType | null>(null);
const candidates = ref<BomReceivingCandidateType[]>([]);
const selectedPoItemId = ref<number | null>(null);
const quantity = ref<number | null>(null);
const note = ref('');
const autoRecord = ref(true);
const error = ref('');
const scannedOnce = ref(false);
const lastProgress = ref<BomReceivingPoProgressType | null>(null);
const includeVoided = ref(false);
const recentLimit = ref(30);
// 최근 스캔 펼침 — null 이면 자동(스캔을 한 번 했고 기록이 있으면 편다, 옛 <details> 의 open 조건),
// 사람이 펴거나 접으면 그 선택을 따른다.
const recentOpen = ref<boolean | null>(null);
const digikeyLookup = ref<DigikeyBarcodeLookupType | null>(null);

const scan = useScanReceivingBarcode();
const record = useRecordReceivingScan();
const voidScan = useVoidReceivingScan();
const completeReceiving = useCompleteReceiving();
const completedInfo = ref<{ poId: number; shipmentId: number; packages: number; scans: number; poConfirmedNow: boolean } | null>(null);
const canComplete = computed(
  () =>
    lastProgress.value !== null &&
    lastProgress.value.complete &&
    !lastProgress.value.overReceived &&
    lastProgress.value.poStatus !== 'closed' &&
    lastProgress.value.supplierCode !== null &&
    completedInfo.value?.poId !== lastProgress.value.poId,
);

/** 전량·정확 스캔된 공급사 PO 를 선적 단계 없이 입고 완료 — 선적·패킹 리스트·QR 포장은 스캔으로 자동. */
async function doComplete(): Promise<void> {
  const progress = lastProgress.value;
  if (progress === null || completeReceiving.isPending.value) return;
  const confirmNote = progress.poStatus === 'issued' ? "\n\n발주서가 '구매 확인 대기'라 구매 완료 처리도 함께 됩니다." : '';
  const ok = await confirmDialog({
    title: '입고 완료 처리',
    message: `선적 단계를 건너뛰고 PO #${String(progress.poId)} 를 입고 완료할까요?\n선적·패킹 리스트는 스캔 내용(${String(progress.scannedTotal)}개)으로 자동 생성되고 QR 포장이 만들어집니다.${confirmNote}`,
    confirmLabel: '입고 완료',
  });
  if (!ok) return;
  error.value = '';
  try {
    const res = await completeReceiving.mutateAsync(progress.poId);
    completedInfo.value = res.data;
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '입고 완료 처리에 실패했습니다.';
  } finally {
    emit('settled');
  }
}
const recent = useRecentReceivingScans(recentLimit, includeVoided);
const recentScans = computed(() => recent.data.value?.data.scans ?? []);
const digikeyStatus = useDigikeyStatus();
const digikey = computed(() => digikeyStatus.data.value?.data ?? null);
const startDigikey = useStartDigikeyOauth();
const disconnectDigikey = useDisconnectDigikey();
const lookupDigikey = useDigikeyBarcodeLookup();
// OAuth 콜백이 ?digikey=connected|error 로 돌아온다 — 한 줄 알림
const digikeyNotice = computed(() => {
  const flag = route.query.digikey;
  if (flag === 'connected') return { tone: 'ok' as const, text: 'DigiKey 연결 완료 — 이제 [DigiKey 조회]를 쓸 수 있습니다.' };
  if (flag === 'error') {
    const reason = typeof route.query.reason === 'string' ? route.query.reason : '';
    const detail = typeof route.query.detail === 'string' ? route.query.detail : '';
    return { tone: 'error' as const, text: `DigiKey 연결 실패 — ${reason}${detail !== '' ? ` (${detail})` : ''}` };
  }
  return null;
});

const busy = computed(() => scan.isPending.value || record.isPending.value);
const fields = computed(() => parsed.value?.fields ?? null);
const canDigikeyLookup = computed(
  () =>
    digikey.value?.connected === true &&
    lastBarcode.value !== '' &&
    (parsed.value === null || parsed.value.supplier === 'digikey'),
);
const recentShown = computed(() => recentOpen.value ?? (recentScans.value.length > 0 && scannedOnce.value));

function resetResult(): void {
  parsed.value = null;
  candidates.value = [];
  selectedPoItemId.value = null;
  quantity.value = null;
  note.value = '';
  digikeyLookup.value = null;
}

async function connectDigikey(): Promise<void> {
  error.value = '';
  try {
    const res = await startDigikey.mutateAsync();
    window.location.assign(res.data.url); // DigiKey 로그인·승인 → 콜백 → 선적·배송으로 복귀
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : 'DigiKey 연결을 시작하지 못했습니다.';
  }
}

async function dropDigikey(): Promise<void> {
  if (
    !(await confirmDialog({
      title: 'DigiKey 연결 해제',
      message: '보관된 DigiKey 토큰을 지웁니다. 다시 쓰려면 다시 연결해야 합니다.',
      confirmLabel: '해제',
      tone: 'danger',
    }))
  ) {
    return;
  }
  error.value = '';
  try {
    await disconnectDigikey.mutateAsync();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : 'DigiKey 연결 해제에 실패했습니다.';
  }
}

/** DigiKey 조회 — 라벨이 아니라 DigiKey 가 푼 값으로 후보·수량·lot·dc 를 채운다(박제 시 override 로 전달). */
async function runDigikeyLookup(): Promise<void> {
  if (lastBarcode.value === '' || lookupDigikey.isPending.value) return;
  error.value = '';
  try {
    const res = await lookupDigikey.mutateAsync(lastBarcode.value);
    digikeyLookup.value = res.data.lookup;
    if (res.data.candidates.length > 0) candidates.value = res.data.candidates;
    if (res.data.candidates.length === 1) selectedPoItemId.value = res.data.candidates[0]?.poItemId ?? null;
    if (quantity.value === null && res.data.lookup.quantity !== null) quantity.value = res.data.lookup.quantity;
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : 'DigiKey 조회에 실패했습니다.';
  } finally {
    emit('settled');
  }
}

/** 부모(통합 스캔 박스)가 넘긴 바코드로 대조 — 후보 1개·수량 있으면 자동 기록. */
async function runScan(raw: string): Promise<void> {
  if (raw.trim() === '' || busy.value) return;
  error.value = '';
  scannedOnce.value = true;
  lastBarcode.value = raw;
  resetResult();
  try {
    const res = await scan.mutateAsync(raw);
    parsed.value = res.data.parsed;
    candidates.value = res.data.candidates;
    quantity.value = res.data.parsed?.fields.quantity ?? null;
    if (res.data.candidates.length === 1) selectedPoItemId.value = res.data.candidates[0]?.poItemId ?? null;
    // 자동 기록 — 라벨을 읽었고 후보가 정확히 하나이며 수량이 있을 때만(애매하면 사람이 고른다)
    if (autoRecord.value && res.data.parsed !== null && res.data.candidates.length === 1 && quantity.value !== null) {
      await doRecord();
    }
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '라벨을 읽지 못했습니다.';
  } finally {
    emit('settled');
  }
}
defineExpose({ scan: runScan });

async function doRecord(): Promise<void> {
  if (lastBarcode.value === '' || record.isPending.value) return;
  if (quantity.value === null || quantity.value <= 0) {
    error.value = '수량을 입력해 주세요(라벨에 수량이 없습니다).';
    return;
  }
  if (
    selectedPoItemId.value === null &&
    !(await confirmDialog({
      title: '미매칭 입고 기록',
      message: '발주 품목을 고르지 않았습니다. 무엇이 왔는지만 남기는 미매칭 스캔으로 기록할까요?',
      confirmLabel: '미매칭으로 기록',
    }))
  ) {
    return;
  }
  error.value = '';
  try {
    const dk = digikeyLookup.value;
    const res = await record.mutateAsync({
      barcode: lastBarcode.value,
      poItemId: selectedPoItemId.value,
      quantity: quantity.value,
      note: note.value.trim() === '' ? null : note.value.trim(),
      // DigiKey 가 푼 값이 있으면 라벨 대신 그 값으로 박제(1D 라벨은 라벨 파싱이 없다)
      override:
        dk === null
          ? null
          : {
              supplierCode: 'digikey',
              supplierSku: dk.digiKeyPartNumber,
              mpn: dk.manufacturerPartNumber,
              lotCode: dk.lotCode,
              dateCode: dk.dateCode,
              countryOfOrigin: dk.countryOfOrigin,
              supplierOrderNo: dk.salesorderId === null ? null : String(dk.salesorderId),
              invoiceNo: dk.invoiceId === null ? null : String(dk.invoiceId),
            },
    });
    lastProgress.value = res.data.progress;
    lastBarcode.value = '';
    resetResult();
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '입고 기록에 실패했습니다.';
  } finally {
    emit('settled');
  }
}

async function doVoid(scanRow: BomReceivingScanRecordType): Promise<void> {
  if (
    !(await confirmDialog({
      title: '스캔 취소',
      message: `#${String(scanRow.scanId)} ${scanRow.mpn ?? scanRow.supplierSku ?? ''} ${String(scanRow.quantity)}개 입고 기록을 취소할까요? (원장에는 취소로 남습니다)`,
      confirmLabel: '취소 처리',
      tone: 'danger',
    }))
  ) {
    return;
  }
  error.value = '';
  try {
    const res = await voidScan.mutateAsync(scanRow.scanId);
    if (res.data.progress !== null && res.data.progress.poId === lastProgress.value?.poId) {
      lastProgress.value = res.data.progress;
    }
  } catch (cause) {
    error.value = cause instanceof ApiRequestError ? cause.message : '취소에 실패했습니다.';
  }
}

// RadioGroup 값은 AcceptableValue — 후보 id(숫자)로 좁혀 받는다.
const onCandidatePick = (value: unknown): void => {
  if (typeof value === 'number') selectedPoItemId.value = value;
};
const onQuantityInput = (value: string | number): void => {
  const parsedQty = typeof value === 'number' ? value : Number(value);
  quantity.value = String(value).trim() === '' || !Number.isFinite(parsedQty) ? null : parsedQty;
};
const onAutoRecord = (value: boolean | 'indeterminate'): void => {
  autoRecord.value = value === true;
};
const onIncludeVoided = (value: boolean | 'indeterminate'): void => {
  includeVoided.value = value === true;
};
// 제어 문자(GS·RS·EOT …)가 섞인 ECIA 원문을 화면에 그대로 찍으면 깨진다 — 점으로 바꿔 앞부분만.
const rawPreview = computed(() =>
  Array.from(lastBarcode.value, (ch) => (ch.charCodeAt(0) < 0x20 ? '·' : ch)).join('').slice(0, 200),
);
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="receiving-panel">
    <div class="flex flex-wrap items-center gap-2 text-sm">
      <label class="text-muted-foreground flex cursor-pointer items-center gap-2">
        <Checkbox :model-value="autoRecord" @update:model-value="onAutoRecord" />
        후보가 하나면 바로 기록
      </label>
      <!-- DigiKey 3-legged 연결 칩 — Barcoding 조회 보조(연결 안 해도 라벨 파싱 입고는 된다) -->
      <Panel
        v-if="digikey !== null"
        size="xs"
        :tone="digikey.connected ? 'success' : 'muted'"
        class="ml-auto flex flex-wrap items-center gap-2 text-xs"
        data-testid="digikey-connection"
      >
        <span class="font-semibold">DigiKey 조회</span>
        <span v-if="digikey.connected">
          연결됨<span v-if="digikey.refreshExpiresAt !== null" class="text-muted-foreground">
            · {{ smartbomFmtDate(digikey.refreshExpiresAt) }}까지</span>
        </span>
        <span
          v-else-if="!digikey.configured"
          class="text-warning"
          title="서버 .env 에 DIGIKEY_CLIENT_ID/SECRET/DIGIKEY_OAUTH_REDIRECT_URI 필요"
        >설정 없음</span>
        <span v-else>미연결</span>
        <span v-if="digikey.lastError !== null" class="text-destructive inline-flex" :title="digikey.lastError">
          <TriangleAlertIcon class="size-3.5" />
        </span>
        <Button
          v-if="digikey.configured && !digikey.connected"
          variant="link"
          size="xs"
          :disabled="startDigikey.isPending.value"
          data-testid="digikey-connect"
          @click="void connectDigikey()"
        >
          연결
        </Button>
        <Button
          v-else-if="digikey.connected"
          variant="link"
          size="xs"
          :disabled="disconnectDigikey.isPending.value"
          @click="void dropDigikey()"
        >
          해제
        </Button>
      </Panel>
    </div>
    <Alert
      v-if="digikeyNotice !== null"
      :variant="digikeyNotice.tone === 'ok' ? 'success' : 'destructive'"
      size="sm"
      data-testid="digikey-notice"
    >
      <AlertDescription>{{ digikeyNotice.text }}</AlertDescription>
    </Alert>
    <Alert v-if="error !== ''" variant="destructive" size="sm">
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>

    <!-- 대조 결과 -->
    <div v-if="scannedOnce && lastBarcode !== ''" class="grid gap-3 lg:grid-cols-2" data-testid="receiving-scan-result">
      <Panel class="bg-card text-xs">
        <p class="text-sm font-semibold">봉투 라벨</p>
        <template v-if="parsed !== null && fields !== null">
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt class="text-muted-foreground">공급사</dt>
            <dd class="font-semibold" data-testid="receiving-supplier">{{ SUPPLIER_LABEL[parsed.supplier] ?? parsed.supplier }}</dd>
            <dt class="text-muted-foreground">공급사 품번</dt>
            <dd class="font-mono">{{ fields.supplierSku ?? '—' }}</dd>
            <dt class="text-muted-foreground">MPN</dt>
            <dd class="font-mono">{{ fields.mpn ?? '—' }}</dd>
            <dt class="text-muted-foreground">수량</dt>
            <dd class="font-semibold">{{ fields.quantity ?? '라벨에 없음' }}</dd>
            <dt class="text-muted-foreground">주문번호</dt>
            <dd class="font-mono">{{ fields.supplierOrderNo ?? fields.customerOrderNo ?? '—' }}</dd>
            <dt class="text-muted-foreground">Lot / Date code</dt>
            <dd class="font-mono">{{ fields.lotCode ?? '—' }} / {{ fields.dateCode ?? '—' }}</dd>
            <dt class="text-muted-foreground">원산지 / 제조사</dt>
            <dd>{{ fields.countryOfOrigin ?? '—' }} / {{ fields.manufacturer ?? '—' }}</dd>
          </dl>
        </template>
        <p v-else class="text-warning mt-2">
          ECIA 2D 라벨이 아닙니다(1D 바코드·다른 공급사 형식). 품목을 고르고 수량을 입력해 수기로 기록할 수 있습니다.
        </p>
        <!-- DigiKey Barcoding 조회(연결 시) — 1D 구형 라벨·검증용 보조 -->
        <Panel v-if="canDigikeyLookup || digikeyLookup !== null" size="xs" tone="muted" class="mt-2">
          <div class="flex flex-wrap items-center gap-2">
            <Button
              v-if="canDigikeyLookup"
              variant="link"
              size="xs"
              :disabled="lookupDigikey.isPending.value"
              data-testid="digikey-lookup"
              @click="void runDigikeyLookup()"
            >
              {{ lookupDigikey.isPending.value ? 'DigiKey 조회 중…' : 'DigiKey 조회' }}
            </Button>
            <span class="text-muted-foreground">DigiKey 계정 연결로 1D 라벨·주문번호·lot 을 DigiKey 에서 직접 푼다</span>
          </div>
          <dl v-if="digikeyLookup !== null" class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5" data-testid="digikey-lookup-result">
            <dt class="text-muted-foreground">DigiKey 품번</dt>
            <dd class="font-mono">{{ digikeyLookup.digiKeyPartNumber ?? '—' }}</dd>
            <dt class="text-muted-foreground">MPN / 제조사</dt>
            <dd class="font-mono">
              {{ digikeyLookup.manufacturerPartNumber ?? '—' }}
              <span class="text-muted-foreground font-sans">{{ digikeyLookup.manufacturerName ?? '' }}</span>
            </dd>
            <dt class="text-muted-foreground">수량</dt>
            <dd class="font-semibold">{{ digikeyLookup.quantity ?? '—' }}</dd>
            <dt class="text-muted-foreground">주문 / 송장</dt>
            <dd class="font-mono">{{ digikeyLookup.salesorderId ?? '—' }} / {{ digikeyLookup.invoiceId ?? '—' }}</dd>
            <dt class="text-muted-foreground">Lot / Date code</dt>
            <dd class="font-mono">{{ digikeyLookup.lotCode ?? '—' }} / {{ digikeyLookup.dateCode ?? '—' }}</dd>
          </dl>
        </Panel>
        <p class="text-muted-foreground mt-2 font-mono text-xs break-all">{{ rawPreview }}</p>
      </Panel>

      <Panel class="bg-card text-xs">
        <p class="text-sm font-semibold">
          발주 품목 후보 <span class="text-muted-foreground font-normal">({{ candidates.length }})</span>
        </p>
        <p v-if="candidates.length === 0" class="text-muted-foreground mt-2" data-testid="receiving-no-candidate">
          열린 공급사 발주서에서 같은 품번을 찾지 못했습니다.
        </p>
        <RadioGroup
          v-else
          class="mt-2"
          aria-label="발주 품목 후보"
          :model-value="selectedPoItemId"
          data-testid="receiving-candidates"
          @update:model-value="onCandidatePick"
        >
          <FieldLabel v-for="c in candidates" :key="c.poItemId" :for="`receiving-candidate-${String(c.poItemId)}`">
            <Field orientation="horizontal">
              <RadioGroupItem :id="`receiving-candidate-${String(c.poItemId)}`" :value="c.poItemId" />
              <FieldContent>
                <span class="text-xs">
                  <span class="font-semibold">{{ c.quoteTitle }}</span>
                  <span class="text-muted-foreground"> · {{ c.partnerName }} · PO #{{ c.poId }}</span>
                </span>
                <span class="flex flex-wrap items-center gap-1 text-xs">
                  <span class="font-mono">{{ c.mpn }}</span>
                  <span v-if="c.supplierSku !== null" class="text-muted-foreground font-mono">/ {{ c.supplierSku }}</span>
                  <Badge variant="secondary">{{ c.matchedBy === 'supplierSku' ? '품번 일치' : 'MPN 일치' }}</Badge>
                </span>
                <span class="text-xs" :class="receivingScanTextClass(c)">입고 {{ c.scannedQty }}/{{ c.orderedQty }}</span>
              </FieldContent>
            </Field>
          </FieldLabel>
        </RadioGroup>
        <div class="mt-3 flex flex-wrap items-end gap-2">
          <Field class="w-24">
            <FieldLabel for="receiving-qty">수량</FieldLabel>
            <Input
              id="receiving-qty"
              :model-value="quantity ?? ''"
              type="number"
              min="1"
              data-testid="receiving-qty"
              @update:model-value="onQuantityInput"
            />
          </Field>
          <Field class="min-w-0 flex-1">
            <FieldLabel for="receiving-note">메모</FieldLabel>
            <Input id="receiving-note" v-model="note" type="text" maxlength="500" placeholder="선택" />
          </Field>
          <Button :disabled="record.isPending.value" data-testid="receiving-record" @click="void doRecord()">
            {{ record.isPending.value ? '기록 중…' : selectedPoItemId === null ? '미매칭으로 기록' : '입고 기록' }}
          </Button>
        </div>
      </Panel>
    </div>

    <!-- 방금 기록한 발주서 진행 -->
    <SectionCard v-if="lastProgress !== null" flush data-testid="receiving-progress">
      <template #title>{{ lastProgress.quoteTitle }}</template>
      <template #meta>
        <span class="inline-flex flex-wrap items-center gap-2">
          {{ lastProgress.partnerName }} · PO #{{ lastProgress.poId }}
          <Badge :variant="lastProgress.complete ? (lastProgress.overReceived ? 'danger' : 'success') : 'warning'">
            {{
              lastProgress.overReceived
                ? '초과 입고'
                : lastProgress.complete
                  ? '전량 입고'
                  : `입고 ${lastProgress.scannedTotal}/${lastProgress.orderedTotal}`
            }}
          </Badge>
        </span>
      </template>
      <template #actions>
        <Button variant="link" size="sm" as-child>
          <RouterLink :to="smartbomCaseTo(lastProgress.quoteId, 'logistics')">Case 열기</RouterLink>
        </Button>
        <Button
          v-if="canComplete"
          size="sm"
          :disabled="completeReceiving.isPending.value"
          title="선적 단계를 건너뛰고 스캔 내용으로 선적·패킹 리스트·QR 포장을 만들어 입고 완료"
          data-testid="receiving-complete"
          @click="void doComplete()"
        >
          {{ completeReceiving.isPending.value ? '처리 중…' : '입고 완료 처리' }}
        </Button>
        <span v-else-if="lastProgress.overReceived" class="text-destructive text-xs">
          초과분을 취소하면 입고 완료 처리할 수 있습니다
        </span>
      </template>
      <template v-if="completedInfo !== null && completedInfo.poId === lastProgress.poId" #notice>
        <NoticeBand tone="success" class="font-medium" data-testid="receiving-completed">
          입고 완료 — 선적 #{{ completedInfo.shipmentId }} · QR 포장 {{ completedInfo.packages }}개(스캔 {{ completedInfo.scans }}건){{
            completedInfo.poConfirmedNow ? ' · 구매 완료 처리 포함' : ''
          }}. 선적·배송 "입고 완료" 탭과 Case 에 반영됐습니다.
        </NoticeBand>
      </template>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>MPN</TableHead>
            <TableHead>공급사 품번</TableHead>
            <TableHead class="text-right">발주</TableHead>
            <TableHead class="text-right">입고</TableHead>
            <TableHead class="text-right">스캔</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="item in lastProgress.items" :key="item.poItemId">
            <TableCell class="font-mono">{{ item.mpn }}</TableCell>
            <TableCell class="text-muted-foreground font-mono">{{ item.supplierSku ?? '—' }}</TableCell>
            <TableCell class="text-right tabular-nums">{{ item.orderedQty }}</TableCell>
            <TableCell class="text-right font-bold tabular-nums">
              <span :class="receivingScanTextClass(item)">{{ item.scannedQty }}</span>
            </TableCell>
            <TableCell class="text-muted-foreground text-right tabular-nums">{{ item.scanCount }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </SectionCard>

    <!-- 최근 스캔 — 기본 접힘(스캔 후 기록이 있으면 펼침) -->
    <SectionCard collapsible flush :open="recentShown" @update:open="(value: boolean) => (recentOpen = value)">
      <template #title>최근 입고 스캔 <span class="text-muted-foreground font-normal">({{ recentScans.length }})</span></template>
      <template #collapsed>최근 입고 스캔 ({{ recentScans.length }})</template>
      <template #actions>
        <label class="text-muted-foreground flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox :model-value="includeVoided" @update:model-value="onIncludeVoided" />
          취소 포함
        </label>
      </template>
      <p v-if="recentScans.length === 0" class="text-muted-foreground py-6 text-center text-xs">아직 스캔 기록이 없습니다.</p>
      <TableCard v-else bare>
        <Table data-testid="receiving-recent">
          <TableHeader>
            <TableRow>
              <TableHead>시각</TableHead>
              <TableHead>공급사</TableHead>
              <TableHead>품번 / MPN</TableHead>
              <TableHead class="text-right">수량</TableHead>
              <TableHead>Lot / DC</TableHead>
              <TableHead>발주</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="row in recentScans" :key="row.scanId">
              <TableCell class="whitespace-nowrap" :class="row.voidedAt !== null ? 'text-muted-foreground line-through' : ''">
                {{ smartbomFmtDate(row.scannedAt) }}
              </TableCell>
              <TableCell :class="row.voidedAt !== null ? 'text-muted-foreground line-through' : ''">
                {{ SUPPLIER_LABEL[row.supplierCode ?? 'unknown'] ?? row.supplierCode }}
              </TableCell>
              <TableCell class="font-mono" :class="row.voidedAt !== null ? 'text-muted-foreground line-through' : ''">
                {{ row.supplierSku ?? '—' }} / {{ row.mpn ?? '—' }}
              </TableCell>
              <TableCell class="text-right font-bold tabular-nums" :class="row.voidedAt !== null ? 'text-muted-foreground line-through' : ''">
                {{ row.quantity }}
              </TableCell>
              <TableCell class="text-muted-foreground font-mono" :class="row.voidedAt !== null ? 'line-through' : ''">
                {{ row.lotCode ?? '—' }} / {{ row.dateCode ?? '—' }}
              </TableCell>
              <TableCell :class="row.voidedAt !== null ? 'text-muted-foreground line-through' : ''">
                <template v-if="row.poId !== null">
                  <!-- 발주번호는 이력에 남지만 품목 삭제 시 견적 연결은 없어질 수 있다. -->
                  <RouterLink
                    v-if="row.quoteId !== null && row.quoteId.trim() !== ''"
                    :to="smartbomCaseTo(row.quoteId, 'logistics')"
                    class="text-primary underline"
                  >
                    {{ row.quoteTitle ?? `PO #${row.poId}` }}
                  </RouterLink>
                  <span v-else class="text-muted-foreground">PO #{{ row.poId }} · 견적 연결 없음</span>
                  <span v-if="row.poItemMpn !== null" class="text-muted-foreground">
                    · {{ row.poItemMpn }}<template v-if="row.orderedQty !== null"> ({{ row.orderedQty }})</template>
                  </span>
                </template>
                <span v-else class="text-warning">미매칭</span>
              </TableCell>
              <TableCell class="text-right">
                <Button
                  v-if="row.voidedAt === null"
                  variant="link"
                  size="xs"
                  :disabled="voidScan.isPending.value"
                  @click="void doVoid(row)"
                >
                  <span class="text-destructive">취소</span>
                </Button>
                <span v-else class="text-xs">취소됨</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </TableCard>
    </SectionCard>
  </div>
</template>
