<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderCartItemType, AdminOrderPrintResponseType } from '@sp/api-contract';
import { formatOdId, nowLocalDateTime } from '@/admin/useAdminOrders';
import { formatKrw } from '@/lib/format';
import { formatAddr, linePrice } from '../detail/order-detail';

// 주문서(A4) 인쇄 문서 — 옛 components/admin/OrderPrintSheet.vue 를 그대로 옮겼다. 종이 서류라 디자인 시스템
// 밖이고(테마와 무관한 흰 종이·검은 글자, mm·pt 단위), 새 코드는 <style> 블록을 두지 않으므로 옛 scoped CSS 를
// 인라인 스타일로 옮겼다(InvoicePreviewDoc 와 같은 "인쇄 문서" 예외 — docs/ADMIN_NEXT_UI.md §8).
// 옛 @media print { .sheet { min-height: auto } } 는 인쇄 대화상자의 격리 CSS 가 [data-order-sheet] 로 맡는다.
// props 만 받고 fetch 하지 않는다. 발행일은 계약에 없어 인쇄 시점 KST 날짜(팀 합의).
const props = defineProps<{ data: AdminOrderPrintResponseType['data'] }>();
const { t } = useI18n();

const order = computed(() => props.data.order);
const seller = computed(() => props.data.seller);
const issuedAt = nowLocalDateTime().slice(0, 10);

const stampSrc = `${import.meta.env.BASE_URL}img/stamp.jpg`;

const sellerAddr = computed(() =>
  seller.value.zip !== '' ? `(${seller.value.zip}) ${seller.value.addr}` : seller.value.addr,
);
const itemSpec = (it: AdminOrderCartItemType): string =>
  it.quote !== null && it.quote.specSummary !== '' ? it.quote.specSummary : it.ctOption;

// 옛 CSS 클래스의 짝 — 같은 값을 여러 곳에 써서 상수로 묶었다.
const ROW = 'display: flex; align-items: center; gap: 2mm; padding: 0.8mm 0; font-size: 9.5pt';
const ROW_K = 'width: 18mm; flex-shrink: 0; color: #555';
const ROW_V = 'flex: 1; min-width: 0; word-break: break-all';
const PARTY = 'border: 1px solid #888; padding: 3mm 4mm';
const PARTY_H = 'margin: 0 0 2mm; padding-bottom: 1.5mm; border-bottom: 1px solid #ccc; font-size: 9pt; font-weight: 700';
const CELL = 'border: 1px solid #888; padding: 2mm; text-align: left';
const TH = 'border: 1px solid #888; padding: 2mm; background: #f4f4f4; text-align: center; font-weight: 700';
const NUM = 'border: 1px solid #888; padding: 2mm; text-align: right';
</script>

<template>
  <div
    data-order-sheet
    style="width: 210mm; min-height: 296mm; box-sizing: border-box; padding: 14mm 15mm; background: #fff; color: #111; font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 10pt; line-height: 1.5"
  >
    <h1 style="margin: 0 0 6mm; text-align: center; font-size: 26pt; font-weight: 700; letter-spacing: 4pt">
      {{ t('admin.orders.print.title') }}
    </h1>

    <div style="display: flex; justify-content: flex-end; gap: 6mm; margin-bottom: 4mm; font-size: 9pt">
      <div>
        <span style="margin-right: 1.5mm; color: #666">{{ t('admin.orders.print.no') }}</span>{{ formatOdId(order.odId) }}
      </div>
      <div>
        <span style="margin-right: 1.5mm; color: #666">{{ t('admin.orders.print.orderedAt') }}</span>{{ order.odTime }}
      </div>
      <div>
        <span style="margin-right: 1.5mm; color: #666">{{ t('admin.orders.print.issuedAt') }}</span>{{ issuedAt }}
      </div>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-bottom: 5mm">
      <!-- 수신(주문자) -->
      <section :style="PARTY">
        <h3 :style="PARTY_H">{{ t('admin.orders.print.recipient') }}</h3>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.name') }}</span>
          <span :style="ROW_V">{{ order.odName }}</span>
        </div>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.contact') }}</span>
          <span :style="ROW_V">{{ order.odHp !== '' ? order.odHp : order.odTel }}</span>
        </div>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.email') }}</span>
          <span :style="ROW_V">{{ order.email }}</span>
        </div>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.addr') }}</span>
          <span :style="ROW_V">{{ formatAddr(order.addr) }}</span>
        </div>
      </section>

      <!-- 발신(seller) -->
      <section :style="PARTY">
        <h3 :style="PARTY_H">{{ t('admin.orders.print.supplier') }}</h3>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.supplierName') }}</span>
          <span :style="`${ROW_V}; font-weight: 700`">{{ seller.name }}</span>
          <img :src="stampSrc" alt="" style="height: 38px; width: auto; margin-left: auto">
        </div>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.supplierOwner') }}</span>
          <span :style="ROW_V">{{ seller.owner }}</span>
        </div>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.addr') }}</span>
          <span :style="ROW_V">{{ sellerAddr }}</span>
        </div>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.contact') }}</span>
          <span :style="ROW_V">{{ seller.tel }}</span>
        </div>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.manager') }}</span>
          <span :style="ROW_V">{{ seller.managerName }}</span>
        </div>
      </section>
    </div>

    <!-- 배송지(받는분) -->
    <section style="margin-bottom: 5mm">
      <h3 style="margin: 0 0 2mm; padding-left: 2mm; border-left: 3px solid #333; font-size: 10pt; font-weight: 700">
        {{ t('admin.orders.print.shipTo') }}
      </h3>
      <div style="border: 1px solid #888; padding: 2mm 4mm">
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.name') }}</span>
          <span :style="ROW_V">{{ order.receiver.name }}</span>
        </div>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.contact') }}</span>
          <span :style="ROW_V">{{ order.receiver.hp !== '' ? order.receiver.hp : order.receiver.tel }}</span>
        </div>
        <div :style="ROW">
          <span :style="ROW_K">{{ t('admin.orders.print.addr') }}</span>
          <span :style="ROW_V">{{ formatAddr(order.receiver) }}</span>
        </div>
      </div>
    </section>

    <!-- 품목표 -->
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 3mm; font-size: 9.5pt">
      <thead>
        <tr>
          <th :style="`${TH}; width: 10mm`">{{ t('admin.orders.print.itemNo') }}</th>
          <th :style="TH">{{ t('admin.orders.print.itemName') }}</th>
          <th :style="TH">{{ t('admin.orders.print.itemSpec') }}</th>
          <th :style="`${TH}; width: 16mm`">{{ t('admin.orders.print.itemQty') }}</th>
          <th :style="`${TH}; width: 30mm`">{{ t('admin.orders.print.itemAmount') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(it, i) in props.data.items" :key="it.ctId">
          <td :style="NUM">{{ i + 1 }}</td>
          <td :style="CELL">{{ it.itName }}</td>
          <td :style="CELL">{{ itemSpec(it) }}</td>
          <td :style="NUM">{{ it.ctQty }}</td>
          <td :style="NUM">{{ formatKrw(linePrice(it)) }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 금액 -->
    <table style="width: 74mm; margin-left: auto; margin-bottom: 5mm; border-collapse: collapse; font-size: 9.5pt">
      <tbody>
        <tr>
          <td style="border: 1px solid #888; padding: 2mm; width: 34mm; color: #333">{{ t('admin.orders.print.amountOrder') }}</td>
          <td :style="NUM">{{ formatKrw(order.orderPrice) }}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #888; padding: 2mm; width: 34mm; color: #333">{{ t('admin.orders.print.amountReceipt') }}</td>
          <td :style="NUM">{{ formatKrw(order.receiptPrice) }}</td>
        </tr>
        <tr>
          <td style="border: 1px solid #888; border-top: 2px solid #333; padding: 2mm; width: 34mm; color: #333; font-weight: 700">
            {{ t('admin.orders.print.amountMisu') }}
          </td>
          <td :style="`${NUM}; border-top: 2px solid #333; font-weight: 700`">{{ formatKrw(order.misu) }}</td>
        </tr>
      </tbody>
    </table>

    <div style="font-size: 9pt; color: #333">
      <p style="margin: 1mm 0">{{ t('admin.orders.print.settleLabel') }}: {{ order.settleCase !== '' ? order.settleCase : '-' }}</p>
      <p v-if="order.invoiceNo !== null" style="margin: 1mm 0">
        {{ t('admin.orders.print.deliveryLabel') }}: {{ order.invoiceNo }}
      </p>
    </div>
  </div>
</template>
