<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
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
} from '../../../admin/useAdminBomReceiving';
import {
  useDigikeyBarcodeLookup,
  useDigikeyStatus,
  useDisconnectDigikey,
  useStartDigikeyOauth,
} from '../../../admin/useAdminDigikey';
import { confirmDialog } from '../../../lib/confirmDialog';
import { smartbomFmtDate } from '../../../admin/smartbom';

// 공급사 입고 스캔 패널(D42) — 선적·배송 화면의 통합 스캔 박스가 봉투 라벨(ECIA 2D·1D)을 넘기면
// 대조→기록→진행→최근 목록을 이 안에서 처리한다. 입력창은 부모(통합 박스)가 갖고 `scan(raw)` 로 넘긴다.
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
  if (!(await confirmDialog({ title: 'DigiKey 연결 해제', message: '보관된 DigiKey 토큰을 지웁니다. 다시 쓰려면 다시 연결해야 합니다.', confirmLabel: '해제', tone: 'danger' }))) return;
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
  if (!(await confirmDialog({ title: '스캔 취소', message: `#${String(scanRow.scanId)} ${scanRow.mpn ?? scanRow.supplierSku ?? ''} ${String(scanRow.quantity)}개 입고 기록을 취소할까요? (원장에는 취소로 남습니다)`, confirmLabel: '취소 처리', tone: 'danger' }))) return;
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

const progressTone = (item: { orderedQty: number; scannedQty: number }): string =>
  item.scannedQty === 0
    ? 'text-gray-400'
    : item.scannedQty < item.orderedQty
      ? 'text-amber-700'
      : item.scannedQty === item.orderedQty
        ? 'text-emerald-700'
        : 'text-red-700';
</script>

<template>
  <div class="space-y-3" data-testid="receiving-panel">
    <div class="flex flex-wrap items-center gap-2 text-xs">
      <label class="flex items-center gap-1.5 text-gray-600">
        <input v-model="autoRecord" type="checkbox" class="size-3.5">
        후보가 하나면 바로 기록
      </label>
      <!-- DigiKey 3-legged 연결 칩 — Barcoding 조회 보조(연결 안 해도 라벨 파싱 입고는 된다) -->
      <div v-if="digikey !== null" class="ml-auto flex items-center gap-2 rounded-lg border px-2.5 py-1.5" :class="digikey.connected ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-gray-200 bg-gray-50 text-gray-600'" data-testid="digikey-connection">
        <span class="font-semibold">DigiKey 조회</span>
        <span v-if="digikey.connected">연결됨<span v-if="digikey.refreshExpiresAt !== null" class="text-gray-500"> · {{ smartbomFmtDate(digikey.refreshExpiresAt) }}까지</span></span>
        <span v-else-if="!digikey.configured" class="text-amber-700" :title="'서버 .env 에 DIGIKEY_CLIENT_ID/SECRET/DIGIKEY_OAUTH_REDIRECT_URI 필요'">설정 없음</span>
        <span v-else>미연결</span>
        <span v-if="digikey.lastError !== null" class="text-red-600" :title="digikey.lastError">⚠</span>
        <button v-if="digikey.configured && !digikey.connected" type="button" class="font-semibold text-blue-700 underline disabled:opacity-40" :disabled="startDigikey.isPending.value" data-testid="digikey-connect" @click="connectDigikey">연결</button>
        <button v-else-if="digikey.connected" type="button" class="text-gray-500 underline disabled:opacity-40" :disabled="disconnectDigikey.isPending.value" @click="dropDigikey">해제</button>
      </div>
    </div>
    <p v-if="digikeyNotice !== null" class="rounded-lg px-3 py-2 text-xs font-semibold" :class="digikeyNotice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'" data-testid="digikey-notice">{{ digikeyNotice.text }}</p>
    <p v-if="error !== ''" role="alert" class="text-xs font-semibold text-red-600">{{ error }}</p>

    <!-- 대조 결과 -->
    <div v-if="scannedOnce && lastBarcode !== ''" class="grid gap-4 lg:grid-cols-2" data-testid="receiving-scan-result">
      <div class="rounded-xl border border-gray-200 bg-white p-3 text-xs">
        <p class="font-bold text-gray-800">봉투 라벨</p>
        <template v-if="parsed !== null && fields !== null">
          <dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt class="text-gray-500">공급사</dt><dd class="font-semibold" data-testid="receiving-supplier">{{ SUPPLIER_LABEL[parsed.supplier] ?? parsed.supplier }}</dd>
            <dt class="text-gray-500">공급사 품번</dt><dd class="font-mono">{{ fields.supplierSku ?? '—' }}</dd>
            <dt class="text-gray-500">MPN</dt><dd class="font-mono">{{ fields.mpn ?? '—' }}</dd>
            <dt class="text-gray-500">수량</dt><dd class="font-semibold">{{ fields.quantity ?? '라벨에 없음' }}</dd>
            <dt class="text-gray-500">주문번호</dt><dd class="font-mono">{{ fields.supplierOrderNo ?? fields.customerOrderNo ?? '—' }}</dd>
            <dt class="text-gray-500">Lot / Date code</dt><dd class="font-mono">{{ fields.lotCode ?? '—' }} / {{ fields.dateCode ?? '—' }}</dd>
            <dt class="text-gray-500">원산지 / 제조사</dt><dd>{{ fields.countryOfOrigin ?? '—' }} / {{ fields.manufacturer ?? '—' }}</dd>
          </dl>
        </template>
        <p v-else class="mt-2 text-amber-700">ECIA 2D 라벨이 아닙니다(1D 바코드·다른 공급사 형식). 품목을 고르고 수량을 입력해 수기로 기록할 수 있습니다.</p>
        <!-- DigiKey Barcoding 조회(연결 시) — 1D 구형 라벨·검증용 보조 -->
        <div v-if="canDigikeyLookup || digikeyLookup !== null" class="mt-2 rounded-lg border border-dashed border-gray-300 p-2">
          <div class="flex flex-wrap items-center gap-2">
            <button v-if="canDigikeyLookup" type="button" class="font-semibold text-blue-700 underline disabled:opacity-40" :disabled="lookupDigikey.isPending.value" data-testid="digikey-lookup" @click="runDigikeyLookup">
              {{ lookupDigikey.isPending.value ? 'DigiKey 조회 중…' : 'DigiKey 조회' }}
            </button>
            <span class="text-[10px] text-gray-500">DigiKey 계정 연결로 1D 라벨·주문번호·lot 을 DigiKey 에서 직접 푼다</span>
          </div>
          <dl v-if="digikeyLookup !== null" class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5" data-testid="digikey-lookup-result">
            <dt class="text-gray-500">DigiKey 품번</dt><dd class="font-mono">{{ digikeyLookup.digiKeyPartNumber ?? '—' }}</dd>
            <dt class="text-gray-500">MPN / 제조사</dt><dd class="font-mono">{{ digikeyLookup.manufacturerPartNumber ?? '—' }} <span class="font-sans text-gray-500">{{ digikeyLookup.manufacturerName ?? '' }}</span></dd>
            <dt class="text-gray-500">수량</dt><dd class="font-semibold">{{ digikeyLookup.quantity ?? '—' }}</dd>
            <dt class="text-gray-500">주문 / 송장</dt><dd class="font-mono">{{ digikeyLookup.salesorderId ?? '—' }} / {{ digikeyLookup.invoiceId ?? '—' }}</dd>
            <dt class="text-gray-500">Lot / Date code</dt><dd class="font-mono">{{ digikeyLookup.lotCode ?? '—' }} / {{ digikeyLookup.dateCode ?? '—' }}</dd>
          </dl>
        </div>
        <p class="mt-2 break-all font-mono text-[10px] text-gray-400">{{ lastBarcode.replace(/[\u0000-\u001f]/g, '·').slice(0, 200) }}</p>
      </div>

      <div class="rounded-xl border border-gray-200 bg-white p-3 text-xs">
        <p class="font-bold text-gray-800">발주 품목 후보 <span class="font-normal text-gray-500">({{ candidates.length }})</span></p>
        <p v-if="candidates.length === 0" class="mt-2 text-gray-500" data-testid="receiving-no-candidate">열린 공급사 발주서에서 같은 품번을 찾지 못했습니다.</p>
        <ul v-else class="mt-2 space-y-1" data-testid="receiving-candidates">
          <li v-for="c in candidates" :key="c.poItemId">
            <label class="flex cursor-pointer items-start gap-2 rounded-lg border px-2 py-1.5" :class="selectedPoItemId === c.poItemId ? 'border-emerald-400 bg-emerald-50' : 'border-gray-200 hover:bg-gray-50'">
              <input v-model="selectedPoItemId" type="radio" name="candidate" :value="c.poItemId" class="mt-0.5">
              <span class="min-w-0">
                <span class="font-semibold text-gray-900">{{ c.quoteTitle }}</span>
                <span class="text-gray-500"> · {{ c.partnerName }} · PO #{{ c.poId }}</span>
                <br>
                <span class="font-mono">{{ c.mpn }}</span>
                <span v-if="c.supplierSku !== null" class="font-mono text-gray-500"> / {{ c.supplierSku }}</span>
                <span class="ml-1 rounded bg-gray-100 px-1 text-[10px] text-gray-600">{{ c.matchedBy === 'supplierSku' ? '품번 일치' : 'MPN 일치' }}</span>
                <br>
                <span :class="progressTone(c)">입고 {{ c.scannedQty }}/{{ c.orderedQty }}</span>
              </span>
            </label>
          </li>
        </ul>
        <div class="mt-3 flex flex-wrap items-end gap-2">
          <label class="text-gray-600">수량
            <input v-model.number="quantity" type="number" min="1" data-testid="receiving-qty" class="ml-1 w-24 rounded border border-gray-300 px-2 py-1 font-mono">
          </label>
          <label class="min-w-0 flex-1 text-gray-600">메모
            <input v-model="note" type="text" maxlength="500" class="ml-1 w-full rounded border border-gray-300 px-2 py-1" placeholder="선택">
          </label>
          <button type="button" class="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white hover:bg-emerald-700 disabled:opacity-40" :disabled="record.isPending.value" data-testid="receiving-record" @click="doRecord">
            {{ record.isPending.value ? '기록 중…' : selectedPoItemId === null ? '미매칭으로 기록' : '입고 기록' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 방금 기록한 발주서 진행 -->
    <section v-if="lastProgress !== null" class="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3" data-testid="receiving-progress">
      <div class="flex flex-wrap items-center gap-2 text-sm">
        <p class="font-bold text-gray-900">{{ lastProgress.quoteTitle }}</p>
        <span class="text-xs text-gray-500">{{ lastProgress.partnerName }} · PO #{{ lastProgress.poId }}</span>
        <span class="rounded px-1.5 py-0.5 text-xs font-bold" :class="lastProgress.complete ? (lastProgress.overReceived ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700') : 'bg-amber-100 text-amber-700'">
          {{ lastProgress.overReceived ? '초과 입고' : lastProgress.complete ? '전량 입고' : `입고 ${lastProgress.scannedTotal}/${lastProgress.orderedTotal}` }}
        </span>
        <RouterLink :to="{ name: 'admin-smartbom-case', params: { id: lastProgress.quoteId }, query: { from: 'logistics' } }" class="ml-auto text-xs font-semibold text-blue-700 underline">Case 열기</RouterLink>
        <button
          v-if="canComplete"
          type="button"
          class="rounded-lg bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-40"
          :disabled="completeReceiving.isPending.value"
          title="선적 단계를 건너뛰고 스캔 내용으로 선적·패킹 리스트·QR 포장을 만들어 입고 완료"
          data-testid="receiving-complete"
          @click="doComplete"
        >
          {{ completeReceiving.isPending.value ? '처리 중…' : '입고 완료 처리' }}
        </button>
        <span v-else-if="lastProgress.overReceived" class="text-[10px] text-red-700">초과분을 취소하면 입고 완료 처리할 수 있습니다</span>
      </div>
      <p v-if="completedInfo !== null && completedInfo.poId === lastProgress.poId" class="mt-1 rounded bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800" data-testid="receiving-completed">
        입고 완료 — 선적 #{{ completedInfo.shipmentId }} · QR 포장 {{ completedInfo.packages }}개(스캔 {{ completedInfo.scans }}건){{ completedInfo.poConfirmedNow ? ' · 구매 완료 처리 포함' : '' }}. 선적·배송 "입고 완료" 탭과 Case 에 반영됐습니다.
      </p>
      <table class="mt-2 w-full text-xs">
        <thead class="text-left text-gray-500"><tr><th class="py-1 pr-3">MPN</th><th class="py-1 pr-3">공급사 품번</th><th class="py-1 pr-3 text-right">발주</th><th class="py-1 pr-3 text-right">입고</th><th class="py-1 text-right">스캔</th></tr></thead>
        <tbody>
          <tr v-for="item in lastProgress.items" :key="item.poItemId" class="border-t border-emerald-100">
            <td class="py-1 pr-3 font-mono">{{ item.mpn }}</td>
            <td class="py-1 pr-3 font-mono text-gray-500">{{ item.supplierSku ?? '—' }}</td>
            <td class="py-1 pr-3 text-right tabular-nums">{{ item.orderedQty }}</td>
            <td class="py-1 pr-3 text-right font-bold tabular-nums" :class="progressTone(item)">{{ item.scannedQty }}</td>
            <td class="py-1 text-right tabular-nums text-gray-500">{{ item.scanCount }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- 최근 스캔 -->
    <details class="rounded-xl border border-gray-200 bg-white p-3" :open="recentScans.length > 0 && scannedOnce">
      <summary class="cursor-pointer text-xs font-bold text-gray-800">최근 입고 스캔 <span class="font-normal text-gray-500">({{ recentScans.length }})</span></summary>
      <div class="mt-2 flex items-center">
        <label class="ml-auto flex items-center gap-1.5 text-xs text-gray-600">
          <input v-model="includeVoided" type="checkbox" class="size-3.5"> 취소 포함
        </label>
      </div>
      <p v-if="recentScans.length === 0" class="py-4 text-center text-xs text-gray-400">아직 스캔 기록이 없습니다.</p>
      <div v-else class="mt-1 overflow-x-auto">
        <table class="w-full min-w-[720px] text-xs" data-testid="receiving-recent">
          <thead class="text-left text-gray-500">
            <tr><th class="py-1 pr-3">시각</th><th class="py-1 pr-3">공급사</th><th class="py-1 pr-3">품번 / MPN</th><th class="py-1 pr-3 text-right">수량</th><th class="py-1 pr-3">Lot / DC</th><th class="py-1 pr-3">발주</th><th class="py-1" /></tr>
          </thead>
          <tbody>
            <tr v-for="row in recentScans" :key="row.scanId" class="border-t border-gray-100" :class="row.voidedAt !== null ? 'text-gray-400 line-through' : ''">
              <td class="whitespace-nowrap py-1 pr-3">{{ smartbomFmtDate(row.scannedAt) }}</td>
              <td class="py-1 pr-3">{{ SUPPLIER_LABEL[row.supplierCode ?? 'unknown'] ?? row.supplierCode }}</td>
              <td class="py-1 pr-3 font-mono">{{ row.supplierSku ?? '—' }} / {{ row.mpn ?? '—' }}</td>
              <td class="py-1 pr-3 text-right font-bold tabular-nums">{{ row.quantity }}</td>
              <td class="py-1 pr-3 font-mono text-gray-500">{{ row.lotCode ?? '—' }} / {{ row.dateCode ?? '—' }}</td>
              <td class="py-1 pr-3">
                <template v-if="row.poId !== null">
                  <RouterLink :to="{ name: 'admin-smartbom-case', params: { id: row.quoteId ?? '' }, query: { from: 'logistics' } }" class="text-blue-700 underline">{{ row.quoteTitle }}</RouterLink>
                  <span class="text-gray-500"> · {{ row.poItemMpn }} ({{ row.orderedQty }})</span>
                </template>
                <span v-else class="text-amber-700">미매칭</span>
              </td>
              <td class="py-1 text-right">
                <button v-if="row.voidedAt === null" type="button" class="text-red-600 underline disabled:opacity-40" :disabled="voidScan.isPending.value" @click="doVoid(row)">취소</button>
                <span v-else class="text-[10px]">취소됨</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </div>
</template>
