<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  AdminOrderCartItemType,
  AdminOrderDetailOrderType,
  AdminOrderInfoBodyType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import {
  displayCompany,
  formatOdId,
  g5ToLocal,
  nowLocalDateTime,
  orderStatusSlug,
  orderStatusVariant,
  toG5DateTime,
  useAdminOrderDetail,
  useOrderInfoMutation,
  useOrderMemoMutation,
  useOrderReceiptMutation,
} from '../../admin/useAdminOrders';
import { useDaumPostcode, type DaumPostcodeData } from '../../lib/useDaumPostcode';
import { formatKrw } from '../../lib/format';
import UiBadge from '../ui/UiBadge.vue';
import OrderPrintModal from './OrderPrintModal.vue';

// 주문 상세 드로어(우측 슬라이드 오버). odId=null 이면 닫힘. 읽기 + 부분 편집(주문자/받는분/
// 배송지/메모/무통장 입금 조정) + 주문서 인쇄. 심층 편집(주문정보 전체·부분취소)은 PHP 위임.
// 편집은 회원 관리 드로어(MemberDetailDrawer) 관례 미러 — dirty 필드만 PATCH, 응답은 { odId }라
// 성공 시 상세/목록 refetch 로 갱신.
const props = defineProps<{ odId: string | null }>();
const emit = defineEmits<{ close: [] }>();
// te 는 구조분해하면 unbound-method(lint) — 컴포저 인스턴스로 호출한다
const i18n = useI18n();
const { t } = i18n;

const odIdRef = computed(() => props.odId);
const { data, isLoading } = useAdminOrderDetail(odIdRef);
const detail = computed(() => data.value?.data ?? null);
const order = computed(() => detail.value?.order ?? null);

// 입금 조정은 무통장 한정(그 외 결제수단은 PG 원장이 진실이라 수동 조정 금지 — 서버 409).
const isBankTransfer = computed<boolean>(() => order.value?.settleCase === '무통장');

// 주소 형식 플래그 — '' 검색 미적용 · 'R' 도로명 · 'J' 지번(코어 win_zip 동일).
type AddrJibeon = '' | 'R' | 'J';

interface OrdererForm {
  odName: string;
  odEmail: string;
  odTel: string;
  odHp: string;
  zip1: string;
  zip2: string;
  addr1: string;
  addr2: string;
  addr3: string;
  depositName: string;
  hopeDate: string;
}
interface ReceiverForm {
  bName: string;
  bTel: string;
  bHp: string;
  bZip1: string;
  bZip2: string;
  bAddr1: string;
  bAddr2: string;
  bAddr3: string;
}
interface ReceiptForm {
  receiptPrice: number;
  receiptTime: string; // datetime-local
  depositName: string;
}

const emptyOrderer = (): OrdererForm => ({
  odName: '',
  odEmail: '',
  odTel: '',
  odHp: '',
  zip1: '',
  zip2: '',
  addr1: '',
  addr2: '',
  addr3: '',
  depositName: '',
  hopeDate: '',
});
const emptyReceiver = (): ReceiverForm => ({
  bName: '',
  bTel: '',
  bHp: '',
  bZip1: '',
  bZip2: '',
  bAddr1: '',
  bAddr2: '',
  bAddr3: '',
});

const ordererFromOrder = (o: AdminOrderDetailOrderType): OrdererForm => ({
  odName: o.odName,
  odEmail: o.email,
  odTel: o.odTel,
  odHp: o.odHp,
  zip1: o.addr.zip1,
  zip2: o.addr.zip2,
  addr1: o.addr.addr1,
  addr2: o.addr.addr2,
  addr3: o.addr.addr3,
  depositName: o.depositName,
  hopeDate: o.hopeDate ?? '',
});
const receiverFromOrder = (o: AdminOrderDetailOrderType): ReceiverForm => ({
  bName: o.receiver.name,
  bTel: o.receiver.tel,
  bHp: o.receiver.hp,
  bZip1: o.receiver.zip1,
  bZip2: o.receiver.zip2,
  bAddr1: o.receiver.addr1,
  bAddr2: o.receiver.addr2,
  bAddr3: o.receiver.addr3,
});

const ordererEditing = ref(false);
const ordererForm = ref<OrdererForm>(emptyOrderer());
const ordererAddrType = ref<AddrJibeon>('');
const receiverEditing = ref(false);
const receiverForm = ref<ReceiverForm>(emptyReceiver());
const receiverAddrType = ref<AddrJibeon>('');
const memoInput = ref('');
const receiptEditing = ref(false);
const receiptForm = ref<ReceiptForm>({ receiptPrice: 0, receiptTime: '', depositName: '' });
const printOpen = ref<string | null>(null);

const { mutate: saveInfo, isPending: infoPending, error: infoErr, reset: resetInfo } =
  useOrderInfoMutation();
const {
  mutate: saveMemo,
  isPending: memoPending,
  isSuccess: memoSaved,
  isError: memoFailed,
  reset: resetMemo,
} = useOrderMemoMutation();
const { mutate: saveReceipt, isPending: receiptPending, error: receiptErr, reset: resetReceipt } =
  useOrderReceiptMutation();

// 주문 전환 시에만 리셋/리필(편집 중 값 덮어쓰기 방지). 같은 주문 refetch 는 건너뛴다.
const filledFor = ref<string | null>(null);
watch(order, (o) => {
  if (o !== null && filledFor.value !== o.odId) {
    filledFor.value = o.odId;
    ordererEditing.value = false;
    receiverEditing.value = false;
    receiptEditing.value = false;
    memoInput.value = o.shopMemo;
    resetInfo();
    resetMemo();
    resetReceipt();
  }
});

// ── 주소 검색(Daum) — 주문자/받는분 각각 패널 ────────────────────────────────
const { embed: embedPostcode } = useDaumPostcode();
const ordererPostcodeOpen = ref(false);
const ordererPostcodeFailed = ref(false);
const ordererPanel = ref<HTMLElement | null>(null);
const receiverPostcodeOpen = ref(false);
const receiverPostcodeFailed = ref(false);
const receiverPanel = ref<HTMLElement | null>(null);

// 참고항목(도로명일 때 법정동·건물명 조합) — 회원 드로어 applyPostcode 동일 규칙.
const roadExtra = (d: DaumPostcodeData): string => {
  if (d.userSelectedType !== 'R') return '';
  let extra = '';
  if (d.bname !== '') extra += d.bname;
  if (d.buildingName !== '') extra += extra !== '' ? `, ${d.buildingName}` : d.buildingName;
  return extra !== '' ? `(${extra})` : '';
};

const startOrdererEdit = (): void => {
  const o = order.value;
  if (o === null) return;
  ordererForm.value = ordererFromOrder(o);
  ordererAddrType.value = '';
  ordererPostcodeOpen.value = false;
  ordererPostcodeFailed.value = false;
  resetInfo();
  ordererEditing.value = true;
};
const cancelOrdererEdit = (): void => {
  ordererEditing.value = false;
  ordererPostcodeOpen.value = false;
};
const openOrdererPostcode = (): void => {
  ordererPostcodeFailed.value = false;
  ordererPostcodeOpen.value = true;
  void nextTick(() => {
    const el = ordererPanel.value;
    if (el === null) return;
    embedPostcode(el, applyOrdererPostcode).catch(() => {
      ordererPostcodeFailed.value = true;
      ordererPostcodeOpen.value = false;
    });
  });
};
const applyOrdererPostcode = (d: DaumPostcodeData): void => {
  const isRoad = d.userSelectedType === 'R';
  ordererForm.value.zip1 = d.zonecode.slice(0, 3);
  ordererForm.value.zip2 = d.zonecode.slice(3);
  ordererForm.value.addr1 = isRoad ? d.roadAddress : d.jibunAddress;
  ordererForm.value.addr3 = roadExtra(d);
  ordererForm.value.addr2 = '';
  ordererAddrType.value = d.userSelectedType;
  ordererPostcodeOpen.value = false;
};

const startReceiverEdit = (): void => {
  const o = order.value;
  if (o === null) return;
  receiverForm.value = receiverFromOrder(o);
  receiverAddrType.value = '';
  receiverPostcodeOpen.value = false;
  receiverPostcodeFailed.value = false;
  resetInfo();
  receiverEditing.value = true;
};
const cancelReceiverEdit = (): void => {
  receiverEditing.value = false;
  receiverPostcodeOpen.value = false;
};
const openReceiverPostcode = (): void => {
  receiverPostcodeFailed.value = false;
  receiverPostcodeOpen.value = true;
  void nextTick(() => {
    const el = receiverPanel.value;
    if (el === null) return;
    embedPostcode(el, applyReceiverPostcode).catch(() => {
      receiverPostcodeFailed.value = true;
      receiverPostcodeOpen.value = false;
    });
  });
};
const applyReceiverPostcode = (d: DaumPostcodeData): void => {
  const isRoad = d.userSelectedType === 'R';
  receiverForm.value.bZip1 = d.zonecode.slice(0, 3);
  receiverForm.value.bZip2 = d.zonecode.slice(3);
  receiverForm.value.bAddr1 = isRoad ? d.roadAddress : d.jibunAddress;
  receiverForm.value.bAddr3 = roadExtra(d);
  receiverForm.value.bAddr2 = '';
  receiverAddrType.value = d.userSelectedType;
  receiverPostcodeOpen.value = false;
};

// dirty 필드만 PATCH — 주소형식 플래그는 검색 적용 시 항상 전송(HANDOFF #12: 미제공 시
// 서버가 addr1 수동변경만 '' 초기화). 변경 없으면 폼만 닫는다.
const submitOrderer = (): void => {
  const o = order.value;
  if (o === null) return;
  const orig = ordererFromOrder(o);
  const f = ordererForm.value;
  const patch: AdminOrderInfoBodyType = {};
  if (f.odName !== orig.odName) patch.odName = f.odName;
  if (f.odEmail !== orig.odEmail) patch.odEmail = f.odEmail;
  if (f.odTel !== orig.odTel) patch.odTel = f.odTel;
  if (f.odHp !== orig.odHp) patch.odHp = f.odHp;
  if (f.zip1 !== orig.zip1) patch.zip1 = f.zip1;
  if (f.zip2 !== orig.zip2) patch.zip2 = f.zip2;
  if (f.addr1 !== orig.addr1) patch.addr1 = f.addr1;
  if (f.addr2 !== orig.addr2) patch.addr2 = f.addr2;
  if (f.addr3 !== orig.addr3) patch.addr3 = f.addr3;
  if (ordererAddrType.value !== '') patch.addrJibeon = ordererAddrType.value;
  if (f.depositName !== orig.depositName) patch.depositName = f.depositName;
  if (f.hopeDate !== orig.hopeDate) patch.hopeDate = f.hopeDate;
  if (Object.keys(patch).length === 0) {
    cancelOrdererEdit();
    return;
  }
  resetInfo();
  saveInfo(
    { odId: o.odId, ...patch },
    {
      onSuccess: () => {
        ordererEditing.value = false;
      },
    },
  );
};

const submitReceiver = (): void => {
  const o = order.value;
  if (o === null) return;
  const orig = receiverFromOrder(o);
  const f = receiverForm.value;
  const patch: AdminOrderInfoBodyType = {};
  if (f.bName !== orig.bName) patch.bName = f.bName;
  if (f.bTel !== orig.bTel) patch.bTel = f.bTel;
  if (f.bHp !== orig.bHp) patch.bHp = f.bHp;
  if (f.bZip1 !== orig.bZip1) patch.bZip1 = f.bZip1;
  if (f.bZip2 !== orig.bZip2) patch.bZip2 = f.bZip2;
  if (f.bAddr1 !== orig.bAddr1) patch.bAddr1 = f.bAddr1;
  if (f.bAddr2 !== orig.bAddr2) patch.bAddr2 = f.bAddr2;
  if (f.bAddr3 !== orig.bAddr3) patch.bAddr3 = f.bAddr3;
  if (receiverAddrType.value !== '') patch.bAddrJibeon = receiverAddrType.value;
  if (Object.keys(patch).length === 0) {
    cancelReceiverEdit();
    return;
  }
  resetInfo();
  saveInfo(
    { odId: o.odId, ...patch },
    {
      onSuccess: () => {
        receiverEditing.value = false;
      },
    },
  );
};

const memoChanged = computed<boolean>(
  () => order.value !== null && memoInput.value !== order.value.shopMemo,
);
const submitMemo = (): void => {
  const o = order.value;
  if (o === null || !memoChanged.value) return;
  resetMemo();
  saveMemo({ odId: o.odId, shopMemo: memoInput.value });
};

const startReceiptEdit = (): void => {
  const o = order.value;
  if (o === null) return;
  receiptForm.value = {
    receiptPrice: o.receiptPrice > 0 ? o.receiptPrice : o.orderPrice,
    receiptTime: o.receiptTime !== null ? g5ToLocal(o.receiptTime) : nowLocalDateTime(),
    depositName: o.depositName !== '' ? o.depositName : o.odName,
  };
  resetReceipt();
  receiptEditing.value = true;
};
const submitReceipt = (): void => {
  const o = order.value;
  if (o === null) return;
  const f = receiptForm.value;
  if (f.receiptTime === '' || !Number.isFinite(f.receiptPrice) || f.receiptPrice < 0) return;
  resetReceipt();
  saveReceipt(
    {
      odId: o.odId,
      receiptPrice: Math.trunc(f.receiptPrice),
      receiptTime: toG5DateTime(f.receiptTime),
      depositName: f.depositName,
    },
    {
      onSuccess: () => {
        receiptEditing.value = false;
      },
    },
  );
};

// 에러 코드 → i18n(미등록이면 서버 message → UNKNOWN). 회원 드로어 mapError 미러.
const mapError = (err: unknown): string | null => {
  if (err === null || err === undefined) return null;
  if (err instanceof ApiRequestError) {
    const code = err.payload?.error;
    if (code !== undefined && i18n.te(`admin.orders.error.${code}`)) {
      return t(`admin.orders.error.${code}`);
    }
    return err.payload?.message ?? t('admin.orders.error.UNKNOWN');
  }
  return t('admin.orders.error.UNKNOWN');
};
const infoError = computed<string | null>(() => mapError(infoErr.value));
const receiptError = computed<string | null>(() => mapError(receiptErr.value));

// 카트행 표시 금액 — 개별 io 가격(ioPrice>0)이 있으면 그것, 없으면 품목가(ctPrice).
const linePrice = (it: AdminOrderCartItemType): number => (it.ioPrice > 0 ? it.ioPrice : it.ctPrice);

// od_status 라벨 — 미등록 slug 는 원문 노출(OrdersTable 과 동일 규칙).
const statusLabel = (s: string): string => {
  const slug = orderStatusSlug(s);
  return slug !== null ? t(`admin.orders.status.${slug}`) : s;
};

// 주소 조합("[우편] 기본 상세 참고") — 빈 조각 제외. 전부 비면 ''(템플릿이 '-' 처리).
const formatAddr = (a: {
  zip1: string;
  zip2: string;
  addr1: string;
  addr2: string;
  addr3: string;
}): string => {
  const zip = [a.zip1, a.zip2].filter((x) => x !== '').join('-');
  const rest = [a.addr1, a.addr2, a.addr3].filter((x) => x !== '').join(' ');
  return `${zip !== '' ? `[${zip}] ` : ''}${rest}`.trim();
};

// 상태 전이·삭제는 목록 액션바에서 처리 — 드로어는 심층 편집만 PHP 위임(새 탭, SPA base 밖).
const phpUrl = computed<string>(() =>
  order.value === null
    ? '#'
    : `/adm/shop_admin/orderform.php?od_id=${encodeURIComponent(order.value.odId)}`,
);

const openPrint = (): void => {
  if (order.value !== null) printOpen.value = order.value.odId;
};

// 드로어가 닫히면(부모가 odId=null) 열려 있던 인쇄 모달도 함께 정리한다.
watch(odIdRef, (v) => {
  if (v === null) printOpen.value = null;
});

const onKeydown = (e: KeyboardEvent): void => {
  if (e.key === 'Escape' && printOpen.value === null) emit('close');
};
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
});

const inputClass =
  'mt-0.5 w-full rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none';
</script>

<template>
  <Teleport to="body">
    <div v-if="props.odId !== null" class="fixed inset-0 z-40">
      <div class="absolute inset-0 bg-black/30" @click="emit('close')" />
      <aside
        class="absolute right-0 top-0 flex h-full w-[36rem] max-w-full flex-col bg-white shadow-xl"
      >
        <!-- 헤더 -->
        <header class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <div class="min-w-0">
            <h2 class="truncate text-base font-bold text-gray-900">
              {{ order !== null ? formatOdId(order.odId) : props.odId }}
            </h2>
            <p v-if="order !== null" class="text-xs text-gray-400">
              {{ order.odTime }}
              <span v-if="order.isMobile">· (M)</span>
            </p>
          </div>
          <div class="flex items-center gap-1">
            <button
              v-if="order !== null"
              type="button"
              class="rounded-md border border-gray-300 px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
              @click="openPrint"
            >
              {{ t('admin.orders.drawer.print') }}
            </button>
            <button
              type="button"
              class="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
              @click="emit('close')"
            >
              {{ t('admin.orders.drawer.close') }}
            </button>
          </div>
        </header>

        <div class="flex-1 overflow-y-auto px-5 py-4">
          <p v-if="isLoading" class="py-8 text-center text-sm text-gray-400">…</p>

          <template v-else-if="order !== null && detail !== null">
            <!-- 주문 개요 -->
            <div class="flex flex-wrap items-center gap-1.5">
              <UiBadge :variant="orderStatusVariant(order.status)" :label="statusLabel(order.status)" />
              <span v-if="order.isTest" class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                {{ t('admin.orders.table.test') }}
              </span>
              <span class="text-sm text-gray-500">
                {{ order.settleCase !== '' ? order.settleCase : t('admin.orders.drawer.noSettle') }}
              </span>
            </div>
            <dl
              v-if="order.payment.pg !== '' || order.payment.tno !== '' || order.payment.appNo !== ''"
              class="mt-3 grid grid-cols-3 gap-x-4 gap-y-1 text-sm"
            >
              <div v-if="order.payment.pg !== ''">
                <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.pg') }}</dt>
                <dd class="break-all text-gray-800">{{ order.payment.pg }}</dd>
              </div>
              <div v-if="order.payment.tno !== ''">
                <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.tno') }}</dt>
                <dd class="break-all text-gray-800">{{ order.payment.tno }}</dd>
              </div>
              <div v-if="order.payment.appNo !== ''">
                <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.appNo') }}</dt>
                <dd class="break-all text-gray-800">{{ order.payment.appNo }}</dd>
              </div>
            </dl>

            <!-- 주문자 (표시 ↔ 편집) -->
            <section class="mt-5">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-gray-800">
                  {{ t('admin.orders.drawer.orderer') }}
                </h3>
                <button
                  v-if="!ordererEditing"
                  type="button"
                  class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  @click="startOrdererEdit"
                >
                  {{ t('admin.orders.drawer.edit.button') }}
                </button>
              </div>

              <dl v-if="!ordererEditing" class="mt-2 space-y-1 text-sm">
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.name') }}</dt>
                  <dd class="text-gray-800">
                    {{ order.odName !== '' ? order.odName : '-' }}
                    <span class="ml-1 text-xs text-gray-400">
                      {{ order.mbId !== '' ? order.mbId : t('admin.orders.table.guest') }}
                      <span v-if="detail.memberOrderCount > 0">({{ detail.memberOrderCount }})</span>
                    </span>
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.email') }}</dt>
                  <dd class="min-w-0 break-all text-gray-800">{{ order.email !== '' ? order.email : '-' }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.tel') }}</dt>
                  <dd class="text-gray-800">{{ order.odHp !== '' ? order.odHp : (order.odTel !== '' ? order.odTel : '-') }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.address') }}</dt>
                  <dd class="min-w-0 text-gray-800">{{ formatAddr(order.addr) !== '' ? formatAddr(order.addr) : '-' }}</dd>
                </div>
                <div v-if="order.depositName !== ''" class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.depositName') }}</dt>
                  <dd class="text-gray-800">{{ order.depositName }}</dd>
                </div>
                <div v-if="order.hopeDate !== null" class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.hopeDate') }}</dt>
                  <dd class="text-gray-800">{{ order.hopeDate }}</dd>
                </div>
              </dl>

              <!-- 주문자 편집 폼 -->
              <div v-else class="mt-2 space-y-2">
                <div class="grid grid-cols-2 gap-2">
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.name') }}</span>
                    <input v-model="ordererForm.odName" type="text" :class="inputClass">
                  </label>
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.email') }}</span>
                    <input v-model="ordererForm.odEmail" type="email" :class="inputClass">
                  </label>
                </div>
                <div class="grid grid-cols-2 gap-2">
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.tel') }}</span>
                    <input v-model="ordererForm.odTel" type="text" :class="inputClass">
                  </label>
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.hp') }}</span>
                    <input v-model="ordererForm.odHp" type="text" :class="inputClass">
                  </label>
                </div>
                <div>
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.zip') }}</span>
                  <div class="mt-0.5 flex items-center gap-1.5">
                    <input v-model="ordererForm.zip1" type="text" inputmode="numeric" maxlength="3" class="w-14 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none">
                    <span class="text-gray-400">-</span>
                    <input v-model="ordererForm.zip2" type="text" inputmode="numeric" maxlength="3" class="w-14 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none">
                    <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100" @click="openOrdererPostcode">
                      {{ t('admin.orders.drawer.edit.addrSearch') }}
                    </button>
                  </div>
                  <p v-if="ordererPostcodeFailed" class="mt-1 text-xs text-red-600">
                    {{ t('admin.orders.drawer.edit.addrSearchFailed') }}
                  </p>
                </div>
                <div v-if="ordererPostcodeOpen" class="overflow-hidden rounded-md border border-gray-300">
                  <div class="flex items-center justify-between border-b border-gray-200 px-2 py-1">
                    <span class="text-xs text-gray-500">{{ t('admin.orders.drawer.edit.addrSearch') }}</span>
                    <button type="button" class="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100" @click="ordererPostcodeOpen = false">
                      {{ t('admin.orders.drawer.edit.addrSearchClose') }}
                    </button>
                  </div>
                  <div ref="ordererPanel" class="h-[300px] w-full" />
                </div>
                <label class="block">
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.addr1') }}</span>
                  <input v-model="ordererForm.addr1" type="text" :class="inputClass">
                </label>
                <label class="block">
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.addr2') }}</span>
                  <input v-model="ordererForm.addr2" type="text" :class="inputClass">
                </label>
                <label class="block">
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.addr3') }}</span>
                  <input v-model="ordererForm.addr3" type="text" :class="inputClass">
                </label>
                <div class="grid grid-cols-2 gap-2">
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.depositName') }}</span>
                    <input v-model="ordererForm.depositName" type="text" :class="inputClass">
                  </label>
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.hopeDate') }}</span>
                    <input v-model="ordererForm.hopeDate" type="date" :class="inputClass">
                  </label>
                </div>
                <div class="flex items-center gap-2 pt-1">
                  <button type="button" class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" :disabled="infoPending" @click="submitOrderer">
                    {{ t('admin.orders.drawer.edit.save') }}
                  </button>
                  <button type="button" class="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="cancelOrdererEdit">
                    {{ t('admin.orders.drawer.edit.cancel') }}
                  </button>
                  <span v-if="infoError !== null" class="text-xs text-red-600">{{ infoError }}</span>
                </div>
              </div>
            </section>

            <!-- 받는분 (표시 ↔ 편집) -->
            <section class="mt-5">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-gray-800">
                  {{ t('admin.orders.drawer.receiver') }}
                </h3>
                <button
                  v-if="!receiverEditing"
                  type="button"
                  class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  @click="startReceiverEdit"
                >
                  {{ t('admin.orders.drawer.edit.button') }}
                </button>
              </div>

              <dl v-if="!receiverEditing" class="mt-2 space-y-1 text-sm">
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.name') }}</dt>
                  <dd class="text-gray-800">{{ order.receiver.name !== '' ? order.receiver.name : '-' }}</dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.tel') }}</dt>
                  <dd class="text-gray-800">
                    {{ order.receiver.hp !== '' ? order.receiver.hp : (order.receiver.tel !== '' ? order.receiver.tel : '-') }}
                  </dd>
                </div>
                <div class="flex gap-2">
                  <dt class="w-16 shrink-0 text-gray-400">{{ t('admin.orders.drawer.address') }}</dt>
                  <dd class="min-w-0 text-gray-800">
                    {{ formatAddr(order.receiver) !== '' ? formatAddr(order.receiver) : '-' }}
                  </dd>
                </div>
              </dl>

              <!-- 받는분 편집 폼 -->
              <div v-else class="mt-2 space-y-2">
                <label class="block">
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.name') }}</span>
                  <input v-model="receiverForm.bName" type="text" :class="inputClass">
                </label>
                <div class="grid grid-cols-2 gap-2">
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.tel') }}</span>
                    <input v-model="receiverForm.bTel" type="text" :class="inputClass">
                  </label>
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.hp') }}</span>
                    <input v-model="receiverForm.bHp" type="text" :class="inputClass">
                  </label>
                </div>
                <div>
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.zip') }}</span>
                  <div class="mt-0.5 flex items-center gap-1.5">
                    <input v-model="receiverForm.bZip1" type="text" inputmode="numeric" maxlength="3" class="w-14 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none">
                    <span class="text-gray-400">-</span>
                    <input v-model="receiverForm.bZip2" type="text" inputmode="numeric" maxlength="3" class="w-14 rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none">
                    <button type="button" class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100" @click="openReceiverPostcode">
                      {{ t('admin.orders.drawer.edit.addrSearch') }}
                    </button>
                  </div>
                  <p v-if="receiverPostcodeFailed" class="mt-1 text-xs text-red-600">
                    {{ t('admin.orders.drawer.edit.addrSearchFailed') }}
                  </p>
                </div>
                <div v-if="receiverPostcodeOpen" class="overflow-hidden rounded-md border border-gray-300">
                  <div class="flex items-center justify-between border-b border-gray-200 px-2 py-1">
                    <span class="text-xs text-gray-500">{{ t('admin.orders.drawer.edit.addrSearch') }}</span>
                    <button type="button" class="rounded px-2 py-0.5 text-xs text-gray-500 hover:bg-gray-100" @click="receiverPostcodeOpen = false">
                      {{ t('admin.orders.drawer.edit.addrSearchClose') }}
                    </button>
                  </div>
                  <div ref="receiverPanel" class="h-[300px] w-full" />
                </div>
                <label class="block">
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.addr1') }}</span>
                  <input v-model="receiverForm.bAddr1" type="text" :class="inputClass">
                </label>
                <label class="block">
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.addr2') }}</span>
                  <input v-model="receiverForm.bAddr2" type="text" :class="inputClass">
                </label>
                <label class="block">
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.edit.addr3') }}</span>
                  <input v-model="receiverForm.bAddr3" type="text" :class="inputClass">
                </label>
                <div class="flex items-center gap-2 pt-1">
                  <button type="button" class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" :disabled="infoPending" @click="submitReceiver">
                    {{ t('admin.orders.drawer.edit.save') }}
                  </button>
                  <button type="button" class="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="cancelReceiverEdit">
                    {{ t('admin.orders.drawer.edit.cancel') }}
                  </button>
                  <span v-if="infoError !== null" class="text-xs text-red-600">{{ infoError }}</span>
                </div>
              </div>
            </section>

            <!-- 배송 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.orders.drawer.delivery') }}
              </h3>
              <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div>
                  <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.invoiceNo') }}</dt>
                  <dd class="text-gray-800">{{ order.invoiceNo ?? '-' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.deliveryCompany') }}</dt>
                  <dd class="text-gray-800">{{ displayCompany(order.deliveryCompany) }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.invoiceTime') }}</dt>
                  <dd class="text-gray-800">{{ order.invoiceTime ?? '-' }}</dd>
                </div>
                <div>
                  <dt class="text-xs text-gray-400">{{ t('admin.orders.drawer.hopeDate') }}</dt>
                  <dd class="text-gray-800">{{ order.hopeDate ?? '-' }}</dd>
                </div>
              </dl>
            </section>

            <!-- 금액 -->
            <section class="mt-5">
              <div class="flex items-center justify-between">
                <h3 class="text-sm font-semibold text-gray-800">
                  {{ t('admin.orders.drawer.amounts') }}
                </h3>
                <button
                  v-if="isBankTransfer && !receiptEditing"
                  type="button"
                  class="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100"
                  @click="startReceiptEdit"
                >
                  {{ t('admin.orders.drawer.receipt.adjust') }}
                </button>
              </div>
              <dl class="mt-2 divide-y divide-gray-100 text-sm">
                <div class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.orderPrice') }}</dt>
                  <dd class="tabular-nums font-medium text-gray-900">{{ formatKrw(order.orderPrice) }}</dd>
                </div>
                <div class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.sendCost') }}</dt>
                  <dd class="tabular-nums text-gray-800">
                    {{ formatKrw(order.amounts.sendCost + order.amounts.sendCost2) }}
                  </dd>
                </div>
                <div class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.receiptPrice') }}</dt>
                  <dd class="tabular-nums text-gray-800">{{ formatKrw(order.receiptPrice) }}</dd>
                </div>
                <div v-if="order.amounts.receiptPoint !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.point') }}</dt>
                  <dd class="tabular-nums text-gray-800">{{ formatKrw(order.amounts.receiptPoint) }}</dd>
                </div>
                <div v-if="order.couponPrice !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">
                    {{ t('admin.orders.drawer.coupon') }}
                    <span class="text-xs text-gray-400">
                      ({{ t('admin.orders.drawer.cartCoupon') }} {{ formatKrw(order.amounts.cartCoupon) }} ·
                      {{ t('admin.orders.drawer.itemCoupon') }} {{ formatKrw(order.amounts.coupon) }} ·
                      {{ t('admin.orders.drawer.sendCoupon') }} {{ formatKrw(order.amounts.sendCoupon) }})
                    </span>
                  </dt>
                  <dd class="tabular-nums text-gray-800">{{ formatKrw(order.couponPrice) }}</dd>
                </div>
                <div v-if="order.cancelPrice !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.cancelPrice') }}</dt>
                  <dd class="tabular-nums font-medium text-red-600">{{ formatKrw(order.cancelPrice) }}</dd>
                </div>
                <div v-if="order.amounts.refundPrice !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.refund') }}</dt>
                  <dd class="tabular-nums text-red-600">{{ formatKrw(order.amounts.refundPrice) }}</dd>
                </div>
                <div v-if="order.misu !== 0" class="flex justify-between py-1">
                  <dt class="text-gray-500">{{ t('admin.orders.drawer.misu') }}</dt>
                  <dd class="tabular-nums font-medium text-red-600">{{ formatKrw(order.misu) }}</dd>
                </div>
                <div class="flex justify-between py-1 text-xs text-gray-400">
                  <dt>{{ t('admin.orders.drawer.tax') }}</dt>
                  <dd class="tabular-nums">
                    {{ t('admin.orders.drawer.taxMny') }} {{ formatKrw(order.amounts.taxMny) }} ·
                    {{ t('admin.orders.drawer.vatMny') }} {{ formatKrw(order.amounts.vatMny) }} ·
                    {{ t('admin.orders.drawer.freeMny') }} {{ formatKrw(order.amounts.freeMny) }}
                  </dd>
                </div>
              </dl>

              <!-- 무통장 입금 조정 -->
              <div v-if="receiptEditing" class="mt-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                <p class="text-xs text-gray-500">{{ t('admin.orders.drawer.receipt.hint') }}</p>
                <div class="mt-2 grid grid-cols-2 gap-2">
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.receipt.price') }}</span>
                    <input v-model.number="receiptForm.receiptPrice" type="number" min="0" step="1" :class="inputClass">
                  </label>
                  <label class="block">
                    <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.receipt.depositName') }}</span>
                    <input v-model="receiptForm.depositName" type="text" :class="inputClass">
                  </label>
                </div>
                <label class="mt-2 block">
                  <span class="text-xs text-gray-400">{{ t('admin.orders.drawer.receipt.time') }}</span>
                  <input v-model="receiptForm.receiptTime" type="datetime-local" :class="inputClass">
                </label>
                <div class="mt-2 flex items-center gap-2">
                  <button type="button" class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50" :disabled="receiptPending" @click="submitReceipt">
                    {{ receiptPending ? t('admin.orders.drawer.receipt.saving') : t('admin.orders.drawer.receipt.save') }}
                  </button>
                  <button type="button" class="rounded-md px-3 py-1.5 text-sm text-gray-500 hover:bg-gray-100" @click="receiptEditing = false">
                    {{ t('admin.orders.drawer.receipt.cancel') }}
                  </button>
                  <span v-if="receiptError !== null" class="text-xs text-red-600">{{ receiptError }}</span>
                </div>
              </div>
            </section>

            <!-- 메모 -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">{{ t('admin.orders.drawer.memo') }}</h3>
              <!-- 고객 요청(od_memo) 읽기 전용 -->
              <div v-if="order.memo !== ''" class="mt-2">
                <p class="text-xs text-gray-400">{{ t('admin.orders.drawer.customerMemo') }}</p>
                <p class="whitespace-pre-wrap rounded-md bg-gray-50 p-2 text-sm text-gray-700">
                  {{ order.memo }}
                </p>
              </div>
              <!-- 관리자 메모(od_shop_memo) 편집 -->
              <div class="mt-2">
                <p class="text-xs text-gray-400">{{ t('admin.orders.drawer.shopMemo') }}</p>
                <textarea
                  v-model="memoInput"
                  rows="3"
                  :placeholder="t('admin.orders.drawer.memoEdit.placeholder')"
                  class="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                <div class="mt-1 flex items-center gap-2">
                  <button
                    type="button"
                    class="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    :disabled="!memoChanged || memoPending"
                    @click="submitMemo"
                  >
                    {{ t('admin.orders.drawer.memoEdit.save') }}
                  </button>
                  <span v-if="memoFailed" class="text-xs text-red-600">
                    {{ t('admin.orders.drawer.memoEdit.failed') }}
                  </span>
                  <span v-else-if="memoSaved" class="text-xs text-green-700">
                    {{ t('admin.orders.drawer.memoEdit.success') }}
                  </span>
                </div>
              </div>
            </section>

            <!-- 주문 상품(카트행 ct_id 단위) -->
            <section class="mt-5">
              <h3 class="text-sm font-semibold text-gray-800">
                {{ t('admin.orders.drawer.items') }}
                <span class="text-gray-400">({{ detail.items.length }})</span>
              </h3>
              <ul v-if="detail.items.length > 0" class="mt-2 space-y-2">
                <li
                  v-for="it in detail.items"
                  :key="it.ctId"
                  class="flex gap-3 rounded-md border border-gray-200 p-2"
                >
                  <img
                    v-if="it.quote !== null && it.quote.thumbUrl !== null"
                    :src="it.quote.thumbUrl"
                    alt=""
                    class="h-14 w-14 shrink-0 rounded border border-gray-200 object-cover"
                  >
                  <div
                    v-else
                    class="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-dashed border-gray-200 text-[10px] text-gray-300"
                  >
                    PCB
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-2">
                      <p class="min-w-0 break-words text-sm text-gray-900">{{ it.itName }}</p>
                      <span class="shrink-0 tabular-nums text-sm text-gray-800">
                        {{ formatKrw(linePrice(it)) }}
                      </span>
                    </div>
                    <p v-if="it.quote !== null && it.quote.specSummary !== ''" class="mt-0.5 text-xs text-gray-500">
                      {{ it.quote.specSummary }}
                    </p>
                    <p v-else-if="it.ctOption !== ''" class="mt-0.5 text-xs text-gray-500">
                      {{ it.ctOption }}
                    </p>
                    <div class="mt-1 flex flex-wrap items-center gap-1.5">
                      <span class="text-xs text-gray-400">
                        {{ t('admin.orders.drawer.itemQty', { n: it.ctQty }) }}
                      </span>
                      <span v-if="it.ctStatus !== ''" class="rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                        {{ it.ctStatus }}
                      </span>
                      <UiBadge
                        v-if="it.quote !== null"
                        :variant="it.quote.quoteStatus"
                        :label="t(`admin.quotes.badge.${it.quote.quoteStatus}`)"
                      />
                      <span
                        v-if="it.quote !== null && it.quote.finalPrice !== null"
                        class="text-xs tabular-nums text-gray-500"
                      >
                        {{ t('admin.orders.drawer.finalPrice') }} {{ formatKrw(it.quote.finalPrice) }}
                      </span>
                    </div>
                  </div>
                </li>
              </ul>
              <p v-else class="mt-2 text-sm text-gray-400">{{ t('admin.orders.drawer.noItems') }}</p>
            </section>

            <!-- PHP 관리자 위임 -->
            <div class="mt-6 border-t border-gray-200 pt-4">
              <p class="text-xs text-gray-400">{{ t('admin.orders.drawer.phpNotice') }}</p>
              <a
                :href="phpUrl"
                target="_blank"
                rel="noopener noreferrer"
                class="mt-1 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
              >
                {{ t('admin.orders.drawer.openPhp') }} ↗
              </a>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </Teleport>

  <OrderPrintModal v-if="printOpen !== null" :od-id="printOpen" @close="printOpen = null" />
</template>
