<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiRequestError } from '@sp/shared';
import {
  BOM_SHIPMENT_MODE_LABELS,
  PCB_SHIPMENT_FILE_LABELS,
  bomShipmentActorOf,
  bomShipmentNextStatus,
  bomShipmentStatusesOf,
  type PcbShipmentFileTypeType,
  type PcbShipmentViewType,
} from '@sp/api-contract';
import { isPcbDirectShipIntl, pcbShipmentStatusLabel } from '../../lib/pcb-shipment-label';
import { PCB_INTL_CARRIERS, isPcbIntlCarrier } from '../../lib/pcb-carriers';
import {
  downloadPartnerPcbShipmentFile,
  partnerPcbPackageApi,
  partnerPcbInvoiceApi,
  usePartnerPcbShipmentAdvance,
  usePartnerPcbShipmentRevert,
  useUploadPartnerPcbShipmentFile,
} from '../../partner/usePartnerPcbPos';
import InvoiceEditorModal from '../smartbom/InvoiceEditorModal.vue';
import PcbPackageLabelsModal from './PcbPackageLabelsModal.vue';
import { fmtKstDate as dateOnly } from '@sp/utils';
import { fmtPcbAmount } from '../../lib/pcb-money';
import { confirmDialog } from '../../lib/confirmDialog';

// PCB 발송 카드(보내는측 전용) — 스텝퍼·전이 폼·첨부·상업송장·되돌리기를 한 카드에.
// [📦 PCB 보내기] 보드가 발송 조작의 단일 창구다(§9 재구성 후속 — BOM
// PartnerShipmentCard 미러). 조작은 대표 발주서(poId) 경유 — 서버는 발송(묶음)
// 단위로 전이한다. 받는측(MD 입고) 액션은 여기 없다 — 발주한 하위 건 상세가 그 자리.

// readonly = 완료 아카이브처럼 조작이 끝난 자리 — 읽는 정보만 남기고 액션을 걷는다.
const props = withDefaults(
  defineProps<{ shipment: PcbShipmentViewType; readonly?: boolean }>(),
  { readonly: false },
);

const repPoId = computed(() => props.shipment.poId);
const shipNext = computed(() => bomShipmentNextStatus(props.shipment.mode, props.shipment.status));
// 직송 국제 체인 — 'arrived' 표시를 '국내도착'→'현지도착'으로 치환(실물이 KR 에 안 온다).
const directShip = computed(() => isPcbDirectShipIntl(props.shipment.destinationCountry));
const statusLabel = (status: PcbShipmentViewType['status']): string =>
  pcbShipmentStatusLabel(props.shipment.mode, status, { directShip: directShip.value });
const canAct = computed(
  () =>
    shipNext.value !== null &&
    bomShipmentActorOf(props.shipment.mode, shipNext.value) === 'PARTNER',
);

// Invoice·AWB 는 국제 통관 서류다 — 서버도 국제 'requested' 에서만 첨부를 보므로
// 국내 체인엔 올릴 자리가 없다(이미 올라온 첨부의 다운로드는 남긴다).
const canEditDocs = computed(() => !props.readonly && props.shipment.mode === 'international');

// 되돌리기 주체는 '지금 상태로 진입시킨 쪽'(서버 revert 판정과 동형) — 국내 '입고 완료'는
// 관리자 몫이라 협력사에 노출해봐야 NOT_YOUR_TURN 이다.
const canRevert = computed(
  () =>
    !props.readonly &&
    props.shipment.receivedAt === null &&
    bomShipmentActorOf(props.shipment.mode, props.shipment.status) === 'PARTNER',
);

const advance = usePartnerPcbShipmentAdvance();
const revert = usePartnerPcbShipmentRevert();
const upload = useUploadPartnerPcbShipmentFile();

const error = ref('');
const shipDateInput = ref('');
// 박제 값 복원(되돌리기 대비) — carrierInput 은 국내 '배송 중' 폼, trackingInput 은 그
// 폼과 국제 준비 체크리스트(직접 발송 갈래)가 같이 쓴다. 모드가 발송마다 고정이라 안 겹친다.
const carrierInput = ref(props.shipment.carrier ?? '');
const trackingInput = ref(props.shipment.trackingNumber ?? '');
const invoiceOpen = ref(false);
const invoiceApi = computed(() => partnerPcbInvoiceApi(repPoId.value));
const labelsOpen = ref(false);
const labelsApi = computed(() => partnerPcbPackageApi(props.shipment.shipmentId));

// ── 발송 방식 갈래(08-13 재편·UX 개편) — 갈림의 실체는 "운송을 누가 계약하나"다.
// 체크박스는 옵션 하나처럼 읽혀 라디오 2택으로 승격: '직접 발송'(기본 — 현행 무변화)
// vs 'Case ID 요청'(자사 주선 — 이후 Case ID·운송장·AWB 는 샘플피씨비가 처리).
// 초기값은 문서 상태에서 유도 — 되돌리기로 준비 단계에 다시 온 발송이 "직접 발송"으로
// 보이면 이미 박힌 요청(caseRefRequestedAt)과 화면이 어긋난다.
const shipMethod = ref<'self' | 'caseref'>(
  props.shipment.caseRefRequestedAt !== null ? 'caseref' : 'self',
);
const caseRefNoteInput = ref('');
const canChooseCaseRef = computed(
  () => shipNext.value === 'requested' && props.shipment.receiverKind === 'admin',
);
// 운송회사(직접 발송 갈래·선택 입력) — 정식 표기 셀렉트 + 직접입력. 체크리스트는 국제
// 전용이라(국내 체인엔 'requested' 가 없다) 모드 게이트가 따로 없다. 초깃값은 박제된
// 값에서 유도 — 되돌리기로 준비 단계에 온 발송이 빈 셀렉트로 보이면 화면이 어긋난다.
const CARRIER_CUSTOM = '__custom__';
const storedCarrier = props.shipment.carrier ?? '';
const carrierChoice = ref(
  storedCarrier !== '' && !isPcbIntlCarrier(storedCarrier) ? CARRIER_CUSTOM : storedCarrier,
);
const carrierCustomInput = ref(carrierChoice.value === CARRIER_CUSTOM ? storedCarrier : '');
const selfCarrier = computed(() =>
  carrierChoice.value === CARRIER_CUSTOM ? carrierCustomInput.value.trim() : carrierChoice.value,
);
const caseRefPending = computed(
  () =>
    props.shipment.caseRefRequestedAt !== null &&
    (props.shipment.caseRef === null || props.shipment.caseRef === ''),
);

// ① 인보이스 첨부 상태 — 서류의 유무를 화면이 먼저 말한다(409 왕복으로 배우게 하지 않는다).
const invoiceFile = computed(
  () => props.shipment.files.find((f) => f.fileType === 'invoice') ?? null,
);
const awbFile = computed(
  () => props.shipment.files.find((f) => f.fileType === 'airwaybill') ?? null,
);
const coFile = computed(
  () => props.shipment.files.find((f) => f.fileType === 'origin_cert') ?? null,
);
const testReportFile = computed(
  () => props.shipment.files.find((f) => f.fileType === 'test_report') ?? null,
);

// Case ID 갈래의 두 영역(08-13 UX) — "내가 제출한 것"과 "샘플피씨비가 준비해 준 것"을
// 업로더(uploadedBy)로 가른다: 관리자가 인보이스를 수정 재첨부하면(교체) 그 파일은
// 자사(ADMIN) 영역으로 넘어간다 — 협력사는 회신 영역만 보면 라벨링·인계 준비가 끝난다.
const caseRefBranch = computed(() => props.shipment.caseRefRequestedAt !== null);
const myFiles = computed(() => props.shipment.files.filter((f) => f.uploadedBy !== 'ADMIN'));
const adminFiles = computed(() => props.shipment.files.filter((f) => f.uploadedBy === 'ADMIN'));

// '선적 요청' 준비 체크리스트 모드 — ①인보이스→②발송 방식→③출고예정일→[진행] 순서로
// 위에서 아래로 따라가면 끝나게(진행 버튼은 맨 아래, 잠금 사유를 버튼 밑에 쓴다).
const checklistMode = computed(
  () => !props.readonly && canAct.value && shipNext.value === 'requested',
);
const requestBlockReason = computed<string | null>(() => {
  if (shipNext.value !== 'requested') return null;
  if (invoiceFile.value === null) return '① 인보이스를 첨부해야 진행할 수 있습니다.';
  if (shipDateInput.value.trim() === '') return '③ 출고예정일을 입력해 주세요.';
  return null;
});

// 국내 '배송 중' 전이의 택배사·송장번호는 서버 필수값(MISSING_TRACKING) — 왕복 전에 막는다.
const advanceBlocked = computed(
  () =>
    (shipNext.value === 'requested' && requestBlockReason.value !== null) ||
    (shipNext.value === 'shipping' &&
      (carrierInput.value.trim() === '' || trackingInput.value.trim() === '')),
);

const surface = (e: unknown, fallback: string): void => {
  error.value = e instanceof ApiRequestError && e.message !== '' ? e.message : fallback;
};

async function runAdvance(): Promise<void> {
  if (shipNext.value === null) return;
  error.value = '';
  try {
    await advance.mutateAsync({
      poId: repPoId.value,
      body: {
        ...(shipNext.value === 'requested'
          ? {
              shipDate: shipDateInput.value,
              // Case ID 갈래 — 선적 요청과 함께 박제된다(자사 주선 발송 진입).
              ...(canChooseCaseRef.value && shipMethod.value === 'caseref'
                ? {
                    caseRefRequested: true,
                    ...(caseRefNoteInput.value.trim() === ''
                      ? {}
                      : { caseRefNote: caseRefNoteInput.value.trim() }),
                  }
                : {}),
              // 운송회사·운송장 번호 — 직접 발송 갈래만(자사 주선은 관리자가 부킹하며
              // '선적'에서 적는다). 관리자 '선적' 프롬프트에 프리필로 흘러간다.
              ...(shipMethod.value === 'self' && selfCarrier.value !== ''
                ? { carrier: selfCarrier.value }
                : {}),
              ...(shipMethod.value === 'self' && trackingInput.value.trim() !== ''
                ? { trackingNumber: trackingInput.value.trim() }
                : {}),
            }
          : {}),
        ...(shipNext.value === 'shipping'
          ? { carrier: carrierInput.value, trackingNumber: trackingInput.value }
          : {}),
      },
    });
  } catch (e) {
    surface(e, '발송 진행에 실패했습니다.');
  }
}

async function runRevert(): Promise<void> {
  if (!(await confirmDialog({ message: '발송을 한 단계 되돌릴까요?', confirmLabel: '되돌리기', tone: 'danger' }))) return;
  error.value = '';
  try {
    await revert.mutateAsync({ poId: repPoId.value });
  } catch (e) {
    surface(e, '되돌리기에 실패했습니다.');
  }
}

// 인보이스 생성기의 [엑셀 생성·첨부] — 업로드 뮤테이션을 감싸 넘긴다(BOM 카드와 동형).
// 맨 API 호출을 주입하면 서버엔 붙는데 쿼리 캐시가 그대로라 '✓ 첨부됨'이 안 뜬다.
async function attachInvoiceXlsx(file: File): Promise<void> {
  await upload.mutateAsync({ poId: repPoId.value, file, fileType: 'invoice' });
}

function pickFile(fileType: PcbShipmentFileTypeType): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (file === undefined) return;
    error.value = '';
    try {
      await upload.mutateAsync({ poId: repPoId.value, file, fileType });
    } catch (e) {
      surface(e, '파일 업로드에 실패했습니다.');
    }
  };
  input.click();
}

const STATUS_CLS: Record<string, string> = {
  preparing: 'bg-gray-100 text-gray-600',
  requested: 'bg-blue-100 text-blue-700',
  shipped: 'bg-indigo-100 text-indigo-700',
  arrived: 'bg-sky-100 text-sky-700',
  customs: 'bg-amber-100 text-amber-700',
  done: 'bg-emerald-100 text-emerald-700',
  shipping: 'bg-indigo-100 text-indigo-700',
  delivered: 'bg-emerald-100 text-emerald-700',
};
</script>

<template>
  <section class="rounded-xl border border-teal-200 bg-surface p-4">
    <h2 class="text-sm font-bold text-teal-700">
      <!-- 발송번호 — 아카이브에 같은 모양의 카드가 쌓이면 무엇을 보는 중인지 알 수 없다. -->
      <span class="mr-1 font-mono text-xs font-normal text-gray-400">SH-{{ shipment.shipmentId }}</span>
      → {{ shipment.receiverName }}
      <template v-if="shipment.destinationCountry !== null"> · 직송 {{ shipment.destinationCountry }}</template>
      <!-- 회차 — 보드 박스 헤더와 같은 규칙(진행 중 발송이 여러 건 쌓이면 받는곳·직송지가
           같은 카드끼리 회차로만 갈린다. 회차 발주는 원발주 발송에 합류하지 않는다). -->
      <span
        v-if="shipment.reorderRound > 0"
        class="ml-1 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700"
      >A/S {{ shipment.reorderRound }}차</span>
      <span class="ml-2 rounded px-1.5 py-0.5 text-xs font-semibold" :class="STATUS_CLS[shipment.status]">
        {{ statusLabel(shipment.status) }}
      </span>
      <span class="ml-1 text-xs font-normal text-gray-400">
        {{ BOM_SHIPMENT_MODE_LABELS[shipment.mode] }}
      </span>
    </h2>

    <!-- 스텝퍼 -->
    <ol class="mt-3 flex flex-wrap items-center gap-1">
      <template v-for="(step, i) in bomShipmentStatusesOf(shipment.mode)" :key="step">
        <li
          class="rounded-full px-2.5 py-1 text-xs font-semibold"
          :class="bomShipmentStatusesOf(shipment.mode).indexOf(shipment.status) > i ? 'bg-emerald-50 text-emerald-700' : bomShipmentStatusesOf(shipment.mode).indexOf(shipment.status) === i ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-400'"
        >
          {{ statusLabel(step) }}
        </li>
        <span v-if="i < bomShipmentStatusesOf(shipment.mode).length - 1" class="text-gray-300">→</span>
      </template>
    </ol>
    <p v-if="shipment.receivedAt !== null" class="mt-1.5 text-xs font-semibold text-emerald-700">
      입고 확인 완료 {{ dateOnly(shipment.receivedAt) }}
      <template v-if="shipment.receivedNote !== null && shipment.receivedNote !== ''"> — 메모: {{ shipment.receivedNote }}</template>
    </p>
    <p v-if="shipment.trackingNumber !== null" class="mt-1 text-xs text-gray-500">
      운송장: {{ shipment.carrier ?? '' }} {{ shipment.trackingNumber }}
    </p>
    <!-- 운송장 전 단계 — 선적 요청에 적어 둔 운송회사가 대기 화면에서도 보이게(안 보이면
         "저장됐나?" 를 되돌리기로 확인하게 된다). 운송장이 잡히면 윗줄에 합쳐 나온다. -->
    <p v-else-if="shipment.carrier !== null && shipment.carrier !== ''" class="mt-1 text-xs text-gray-500">
      운송회사: {{ shipment.carrier }}
    </p>

    <!-- Case ID 갈래 — '내가 제출한 서류'와 '샘플피씨비 처리·회신'을 영역으로 가른다.
         협력사의 다음 행동은 회신 영역만 보면 정해진다(대기: 기다림 / 회신: 라벨링·인계).
         준비 체크리스트 단계에선 숨긴다 — 그 정보(①인보이스·②방식)는 체크리스트 몫. -->
    <template v-if="caseRefBranch && !checklistMode">
      <div class="mt-2 rounded-lg border border-gray-200 p-2.5">
        <p class="text-[11px] font-bold text-gray-500">내가 제출한 서류</p>
        <div class="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
          <button
            v-for="f in myFiles"
            :key="f.fileId"
            type="button"
            class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
            :title="f.name"
            @click="void downloadPartnerPcbShipmentFile(repPoId, f.fileId, f.name)"
          >
            ⬇ {{ PCB_SHIPMENT_FILE_LABELS[f.fileType] }}
          </button>
          <span v-if="myFiles.length === 0" class="text-gray-300">
            (관리자 수정본으로 교체되어 회신 영역에 있습니다)
          </span>
          <template v-if="canEditDocs && shipment.shippedAt === null && shipment.receivedAt === null">
            <button
              type="button"
              class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
              @click="invoiceOpen = true"
            >
              🧾 인보이스 생성기
            </button>
            <button
              type="button"
              class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
              @click="pickFile('invoice')"
            >
              ⬆ 인보이스 교체
            </button>
          </template>
        </div>
      </div>
      <div v-if="caseRefPending" class="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <b>샘플피씨비 처리 대기 중</b> — 인보이스 확인 후 Case ID·운송장·AWB 를 준비합니다.
        완료되면 메일로 안내됩니다.
        <span v-if="shipment.caseRefNote !== null && shipment.caseRefNote !== ''" class="mt-0.5 block text-amber-600">
          요청 메모: {{ shipment.caseRefNote }}
        </span>
      </div>
      <div
        v-else-if="shipment.caseRef !== null && shipment.caseRef !== ''"
        class="mt-2 rounded-lg border border-teal-200 bg-teal-50 p-2.5 text-xs text-teal-900"
      >
        <p class="font-bold">샘플피씨비가 준비한 선적 서류 — 확인 후 라벨링·인계해 주세요</p>
        <p class="mt-1">
          발송 참조번호(Case ID): <b class="tracking-wide">{{ shipment.caseRef }}</b>
          <template v-if="shipment.trackingNumber !== null">
            · 운송장: {{ shipment.carrier ?? '' }} <span class="tabular-nums">{{ shipment.trackingNumber }}</span>
          </template>
        </p>
        <div v-if="adminFiles.length > 0" class="mt-1.5 flex flex-wrap gap-2">
          <button
            v-for="f in adminFiles"
            :key="f.fileId"
            type="button"
            class="rounded-md border border-teal-300 bg-surface px-2 py-1 font-semibold text-teal-700 hover:bg-teal-100"
            :title="f.name"
            @click="void downloadPartnerPcbShipmentFile(repPoId, f.fileId, f.name)"
          >
            ⬇ {{ PCB_SHIPMENT_FILE_LABELS[f.fileType] }}
          </button>
        </div>
      </div>
      <div v-if="canRevert" class="mt-2 text-right">
        <button
          type="button"
          class="rounded-md border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-50"
          @click="void runRevert()"
        >
          ↩ 되돌리기
        </button>
      </div>
    </template>

    <!-- 담긴 발주서 -->
    <ul class="mt-3 space-y-1 rounded-lg border border-gray-100 p-3">
      <li v-for="g in shipment.groupPos" :key="g.poId" class="flex items-center gap-2 text-xs">
        <RouterLink
          :to="{ name: 'partner-pcb-po', params: { id: String(g.poId) } }"
          class="min-w-0 flex-1 truncate font-medium text-gray-700 hover:text-teal-700 hover:underline"
        >
          <span class="mr-1 font-mono text-[11px] font-normal text-gray-400">PO-{{ g.poId }}</span>
          {{ g.projectName }}
        </RouterLink>
        <span class="shrink-0 text-gray-400">
          {{ g.qty.toLocaleString('ko-KR') }}pcs · {{ fmtPcbAmount(g.currency, g.priceOriginal) }}
        </span>
      </li>
    </ul>
    <div class="mt-2 flex justify-end">
      <button
        type="button"
        class="rounded-md border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700 hover:bg-teal-100"
        @click="labelsOpen = true"
      >
        ▦ PCB QR 라벨 {{ shipment.groupPos.length }}장
      </button>
    </div>

    <!-- ── '선적 요청' 준비 체크리스트(08-13 UX 개편) — 위에서 아래로 따라가면 끝난다:
         ①인보이스(필수) → ②발송 방식(갈래) → ③출고예정일 → [진행](맨 아래).
         필수/옵션/갈래별 서류가 자기 자리에 서고, 잠금 사유는 버튼 밑에서 위를 가리킨다. -->
    <div v-if="checklistMode" class="mt-3 space-y-2.5">
      <section class="rounded-lg border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-700">① 인보이스 준비 <span class="text-red-500">*</span></p>
        <div class="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            class="rounded-md bg-teal-600 px-3 py-1.5 font-bold text-white hover:bg-teal-700"
            @click="invoiceOpen = true"
          >
            🧾 인보이스 생성기
          </button>
          <span class="rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-700">권장</span>
          <button
            type="button"
            class="rounded-md border border-gray-300 px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-50"
            @click="pickFile('invoice')"
          >
            ⬆ 직접 업로드
          </button>
          <!-- 검사 성적서는 발송 방식과 무관한 제품 서류라 갈래(②) 밖 — 옵션 서류는
               오른쪽 끝(필수 동선과 시선이 섞이지 않게). -->
          <span v-if="testReportFile !== null" class="ml-auto max-w-[12rem] truncate font-semibold text-emerald-600" :title="testReportFile.name">✓ {{ testReportFile.name }}</span>
          <button
            type="button"
            :class="testReportFile === null ? 'ml-auto' : ''"
            class="rounded-md border border-gray-200 px-2.5 py-1 font-semibold text-gray-400 hover:bg-gray-50"
            title="검사 성적서(TEST Report) — 있는 경우에만 첨부"
            @click="pickFile('test_report')"
          >
            ⬆ TEST Report <span class="font-normal">(선택)</span>
          </button>
        </div>
        <p v-if="invoiceFile !== null" class="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span class="font-semibold text-emerald-600">✓ 첨부됨</span>
          <span class="max-w-[16rem] truncate text-gray-600" :title="invoiceFile.name">{{ invoiceFile.name }}</span>
          <button type="button" class="text-teal-700 hover:underline" @click="void downloadPartnerPcbShipmentFile(repPoId, invoiceFile.fileId, invoiceFile.name)">내려받기</button>
          <span class="text-gray-300">·</span>
          <button type="button" class="text-gray-500 hover:underline" @click="pickFile('invoice')">교체</button>
        </p>
        <p v-else class="mt-2 text-xs text-gray-400">
          생성기를 쓰면 발주 품목·금액이 자동으로 채워집니다(엑셀로 첨부).
        </p>
      </section>

      <section class="rounded-lg border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-700">② 발송 방식 선택</p>
        <label class="mt-2 flex cursor-pointer items-start gap-2 text-xs text-gray-700">
          <input v-model="shipMethod" type="radio" value="self" class="mt-0.5">
          <span><b>내 운송 계정으로 직접 발송</b> — AWB 를 직접 첨부합니다.</span>
        </label>
        <div v-if="shipMethod === 'self'" class="ml-6 mt-2 flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            class="rounded-md border border-gray-300 px-2.5 py-1 font-semibold text-gray-600 hover:bg-gray-50"
            @click="pickFile('airwaybill')"
          >
            ⬆ AWB 첨부
          </button>
          <span v-if="awbFile !== null" class="font-semibold text-emerald-600">✓ {{ awbFile.name }}</span>
          <!-- 옵션 서류는 오른쪽 끝 — 필수 동선(왼쪽 열)과 시선이 섞이지 않게. -->
          <span v-if="coFile !== null" class="ml-auto font-semibold text-emerald-600">✓ {{ coFile.name }}</span>
          <button
            type="button"
            :class="coFile === null ? 'ml-auto' : ''"
            class="rounded-md border border-gray-200 px-2.5 py-1 font-semibold text-gray-400 hover:bg-gray-50"
            title="원산지증명원(Certificate of Origin) — 통관에 필요한 경우에만"
            @click="pickFile('origin_cert')"
          >
            ⬆ 원산지증명원 <span class="font-normal">(선택)</span>
          </button>
        </div>
        <div v-if="shipMethod === 'self'" class="ml-6 mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span class="font-semibold text-gray-500">운송회사 <span class="font-normal text-gray-400">(선택)</span></span>
          <select
            v-model="carrierChoice"
            class="h-8 rounded-md border border-gray-300 bg-surface px-2 text-xs focus:border-teal-500 focus:outline-none"
          >
            <option value="">선택 안 함</option>
            <option v-for="c in PCB_INTL_CARRIERS" :key="c" :value="c">{{ c }}</option>
            <option :value="CARRIER_CUSTOM">직접입력</option>
          </select>
          <input
            v-if="carrierChoice === CARRIER_CUSTOM"
            v-model="carrierCustomInput"
            type="text"
            maxlength="50"
            placeholder="운송회사명"
            class="h-8 w-40 rounded-md border border-gray-300 px-2 text-xs focus:border-teal-500 focus:outline-none"
          >
          <span class="font-semibold text-gray-500">운송장 번호 <span class="font-normal text-gray-400">(선택)</span></span>
          <input
            v-model="trackingInput"
            type="text"
            maxlength="100"
            class="h-8 w-44 rounded-md border border-gray-300 px-2 text-xs tabular-nums focus:border-teal-500 focus:outline-none"
          >
        </div>
        <template v-if="canChooseCaseRef">
          <label class="mt-2 flex cursor-pointer items-start gap-2 text-xs text-gray-700">
            <input v-model="shipMethod" type="radio" value="caseref" class="mt-0.5">
            <span>
              <b>샘플피씨비 운송으로 발송 — 발송 참조번호(Case ID) 요청</b>
            </span>
          </label>
          <div v-if="shipMethod === 'caseref'" class="ml-6 mt-2 space-y-2">
            <p class="rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
              Case ID·운송장·AWB 는 샘플피씨비가 처리합니다. 준비되면 메일로 안내되며,
              그 전까지 발송은 진행되지 않습니다.
            </p>
            <input
              v-model="caseRefNoteInput"
              type="text"
              maxlength="255"
              placeholder="요청 메모(선택) — 예: DHL 착불 계정번호가 필요합니다"
              class="w-full rounded-md border border-amber-200 bg-surface px-3 py-1.5 text-xs focus:border-amber-400 focus:outline-none"
            >
          </div>
        </template>
      </section>

      <section class="rounded-lg border border-gray-200 p-3">
        <p class="text-xs font-bold text-gray-700">③ 출고예정일 <span class="text-red-500">*</span></p>
        <input v-model="shipDateInput" type="date" class="mt-2 w-48 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none">
      </section>

      <button
        type="button"
        class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40"
        :disabled="advance.isPending.value || advanceBlocked"
        @click="void runAdvance()"
      >
        선적 요청 진행
      </button>
      <p v-if="requestBlockReason !== null" class="text-xs text-gray-400">ⓘ {{ requestBlockReason }}</p>
    </div>

    <!-- 그 외 전이 폼(국내 배송 중 등) — 입력 → 진행 버튼(맨 아래) 순서만 공유 -->
    <template v-else-if="!readonly">
      <div v-if="canAct && shipNext !== null" class="mt-3 space-y-2">
        <div class="grid gap-2 sm:grid-cols-2">
          <template v-if="shipNext === 'shipping'">
            <label class="block">
              <span class="text-xs font-semibold text-gray-500">택배사 *</span>
              <input v-model="carrierInput" type="text" placeholder="CJ대한통운 / SF Express" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-500 focus:outline-none">
            </label>
            <label class="block">
              <span class="text-xs font-semibold text-gray-500">송장번호 *</span>
              <input v-model="trackingInput" type="text" class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm tabular-nums focus:border-teal-500 focus:outline-none">
            </label>
          </template>
        </div>
        <button
          type="button"
          class="w-full rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-40"
          :disabled="advance.isPending.value || advanceBlocked"
          @click="void runAdvance()"
        >
          {{ statusLabel(shipNext) }} 진행
        </button>
      </div>
      <p v-else-if="shipNext !== null" class="mt-3 text-sm text-gray-500">
        {{ shipment.receiverName }} 측 처리를 기다리고 있습니다.
      </p>
    </template>

    <!-- 첨부·송장·되돌리기(자기 계정 갈래) — 체크리스트 단계에선 서류가 ①·② 자리에,
         Case ID 갈래에선 위의 두 영역에 있으므로 이 줄은 그 밖에서만 선다. -->
    <div
      v-if="!checklistMode && !caseRefBranch && (!readonly || shipment.files.length > 0)"
      class="mt-3 flex flex-wrap items-center gap-2 text-xs"
    >
      <template v-for="f in shipment.files" :key="f.fileId">
        <button
          type="button"
          class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-600 hover:bg-gray-50"
          @click="void downloadPartnerPcbShipmentFile(repPoId, f.fileId, f.name)"
        >
          ⬇ {{ PCB_SHIPMENT_FILE_LABELS[f.fileType] }}
        </button>
      </template>
      <template v-if="canEditDocs">
        <button type="button" class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50" @click="pickFile('invoice')">
          ⬆ Invoice
        </button>
        <button
          type="button"
          class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-500 hover:bg-gray-50"
          @click="pickFile('airwaybill')"
        >
          ⬆ AWB/송장내역
        </button>
        <button
          type="button"
          class="rounded-md border border-teal-300 px-2 py-1 font-semibold text-teal-700 hover:bg-teal-50"
          @click="invoiceOpen = true"
        >
          🧾 인보이스 생성기
        </button>
        <!-- 옵션 서류는 오른쪽 끝 — 필수 동선과 시선이 섞이지 않게. -->
        <button
          type="button"
          class="ml-auto rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
          title="검사 성적서(TEST Report) — 있는 경우에만 첨부(선택)"
          @click="pickFile('test_report')"
        >
          ⬆ TEST Report <span class="font-normal">(선택)</span>
        </button>
        <button
          type="button"
          class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
          title="원산지증명원(Certificate of Origin) — 통관에 필요한 경우 첨부(선택)"
          @click="pickFile('origin_cert')"
        >
          ⬆ 원산지증명원 <span class="font-normal">(선택)</span>
        </button>
      </template>
      <button
        v-if="canRevert"
        type="button"
        class="rounded-md border border-gray-200 px-2 py-1 font-semibold text-gray-400 hover:bg-gray-50"
        @click="void runRevert()"
      >
        ↩ 되돌리기
      </button>
    </div>

    <p v-if="error !== ''" class="mt-2 text-sm font-semibold text-red-600">{{ error }}</p>

    <!-- 인보이스 생성기 — BOM InvoiceEditorModal 재사용(콜백 주입). PCB 는 엑셀 첨부
         (관리자가 내려받아 수동 수정 후 재첨부하는 왕복이 있어 PDF 는 안 쓴다 — 08-13). -->
    <InvoiceEditorModal
      :open="invoiceOpen"
      title="인보이스 생성기"
      :load-draft="invoiceApi.loadDraft"
      :save-draft="invoiceApi.saveDraft"
      :render-xlsx="invoiceApi.renderXlsx"
      :attach-xlsx="attachInvoiceXlsx"
      @close="invoiceOpen = false"
    />
    <PcbPackageLabelsModal
      :open="labelsOpen"
      :load="labelsApi.load"
      :mark-printed="labelsApi.markPrinted"
      @close="labelsOpen = false"
    />
  </section>
</template>
