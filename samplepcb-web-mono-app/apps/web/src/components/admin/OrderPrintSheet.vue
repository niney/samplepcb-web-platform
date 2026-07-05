<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminOrderCartItemType, AdminOrderPrintResponseType } from '@sp/api-contract';
import { formatOdId, nowLocalDateTime } from '../../admin/useAdminOrders';
import { formatKrw } from '../../lib/format';

// 주문서(A4) 순수 표시 컴포넌트 — 견적서 시트(EstimateSheet)와 동일 톤·인쇄 규칙. props 만 받고
// fetch 하지 않는다. 발행일은 계약에 없어 인쇄 시점 KST 날짜로 표기(팀 합의).
const props = defineProps<{ data: AdminOrderPrintResponseType['data'] }>();
const { t } = useI18n();

const order = computed(() => props.data.order);
const seller = computed(() => props.data.seller);
const issuedAt = nowLocalDateTime().slice(0, 10);

const stampSrc = `${import.meta.env.BASE_URL}img/stamp.jpg`;

// 주소 조합("[우편] 기본 상세 참고") — 빈 조각 제외. 드로어 formatAddr 와 동일 규칙.
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

const sellerAddr = computed(() =>
  seller.value.zip !== '' ? `(${seller.value.zip}) ${seller.value.addr}` : seller.value.addr,
);

// 카트행 표시 금액 — 개별 io 가격(ioPrice>0)이 있으면 그것, 없으면 품목가(ctPrice).
const linePrice = (it: AdminOrderCartItemType): number => (it.ioPrice > 0 ? it.ioPrice : it.ctPrice);
const itemSpec = (it: AdminOrderCartItemType): string =>
  it.quote !== null && it.quote.specSummary !== '' ? it.quote.specSummary : it.ctOption;
</script>

<template>
  <div class="sheet">
    <h1 class="title">{{ t('admin.orders.print.title') }}</h1>

    <div class="meta">
      <div>
        <span class="mk">{{ t('admin.orders.print.no') }}</span>{{ formatOdId(order.odId) }}
      </div>
      <div>
        <span class="mk">{{ t('admin.orders.print.orderedAt') }}</span>{{ order.odTime }}
      </div>
      <div>
        <span class="mk">{{ t('admin.orders.print.issuedAt') }}</span>{{ issuedAt }}
      </div>
    </div>

    <div class="parties">
      <!-- 수신(주문자) -->
      <section class="party">
        <h3>{{ t('admin.orders.print.recipient') }}</h3>
        <div class="row">
          <span class="k">{{ t('admin.orders.print.name') }}</span>
          <span class="v">{{ order.odName }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.orders.print.contact') }}</span>
          <span class="v">{{ order.odHp !== '' ? order.odHp : order.odTel }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.orders.print.email') }}</span>
          <span class="v">{{ order.email }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.orders.print.addr') }}</span>
          <span class="v">{{ formatAddr(order.addr) }}</span>
        </div>
      </section>

      <!-- 발신(seller) -->
      <section class="party">
        <h3>{{ t('admin.orders.print.supplier') }}</h3>
        <div class="row supplier-head">
          <span class="k">{{ t('admin.orders.print.supplierName') }}</span>
          <span class="v">{{ seller.name }}</span>
          <img :src="stampSrc" alt="" class="stamp">
        </div>
        <div class="row">
          <span class="k">{{ t('admin.orders.print.supplierOwner') }}</span>
          <span class="v">{{ seller.owner }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.orders.print.addr') }}</span>
          <span class="v">{{ sellerAddr }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.orders.print.contact') }}</span>
          <span class="v">{{ seller.tel }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.orders.print.manager') }}</span>
          <span class="v">{{ seller.managerName }}</span>
        </div>
      </section>
    </div>

    <!-- 배송지(받는분) -->
    <section class="ship">
      <h3 class="section-title">{{ t('admin.orders.print.shipTo') }}</h3>
      <div class="ship-grid">
        <div class="row">
          <span class="k">{{ t('admin.orders.print.name') }}</span>
          <span class="v">{{ order.receiver.name }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.orders.print.contact') }}</span>
          <span class="v">{{ order.receiver.hp !== '' ? order.receiver.hp : order.receiver.tel }}</span>
        </div>
        <div class="row ship-addr">
          <span class="k">{{ t('admin.orders.print.addr') }}</span>
          <span class="v">{{ formatAddr(order.receiver) }}</span>
        </div>
      </div>
    </section>

    <!-- 품목표 -->
    <table class="items">
      <thead>
        <tr>
          <th class="col-no">{{ t('admin.orders.print.itemNo') }}</th>
          <th>{{ t('admin.orders.print.itemName') }}</th>
          <th>{{ t('admin.orders.print.itemSpec') }}</th>
          <th class="col-qty">{{ t('admin.orders.print.itemQty') }}</th>
          <th class="col-amount">{{ t('admin.orders.print.itemAmount') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(it, i) in props.data.items" :key="it.ctId">
          <td class="num">{{ i + 1 }}</td>
          <td>{{ it.itName }}</td>
          <td>{{ itemSpec(it) }}</td>
          <td class="num">{{ it.ctQty }}</td>
          <td class="num">{{ formatKrw(linePrice(it)) }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 금액 -->
    <table class="amounts">
      <tbody>
        <tr>
          <td class="k">{{ t('admin.orders.print.amountOrder') }}</td>
          <td class="num">{{ formatKrw(order.orderPrice) }}</td>
        </tr>
        <tr>
          <td class="k">{{ t('admin.orders.print.amountReceipt') }}</td>
          <td class="num">{{ formatKrw(order.receiptPrice) }}</td>
        </tr>
        <tr class="total">
          <td class="k">{{ t('admin.orders.print.amountMisu') }}</td>
          <td class="num">{{ formatKrw(order.misu) }}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer-notes">
      <p>{{ t('admin.orders.print.settleLabel') }}: {{ order.settleCase !== '' ? order.settleCase : '-' }}</p>
      <p v-if="order.invoiceNo !== null">
        {{ t('admin.orders.print.deliveryLabel') }}: {{ order.invoiceNo }}
      </p>
    </div>
  </div>
</template>

<style scoped>
/* A4 — 견적서 시트(EstimateSheet)와 동일 규칙. 미리보기 min-height 296mm, 인쇄 시 해제. */
.sheet {
  width: 210mm;
  min-height: 296mm;
  box-sizing: border-box;
  padding: 14mm 15mm;
  background: #fff;
  color: #111;
  font-family: 'Malgun Gothic', '맑은 고딕', sans-serif;
  font-size: 10pt;
  line-height: 1.5;
}
.title {
  margin: 0 0 6mm;
  text-align: center;
  font-size: 26pt;
  font-weight: 700;
  letter-spacing: 4pt;
}
.meta {
  display: flex;
  justify-content: flex-end;
  gap: 6mm;
  margin-bottom: 4mm;
  font-size: 9pt;
}
.meta .mk {
  margin-right: 1.5mm;
  color: #666;
}
.parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6mm;
  margin-bottom: 5mm;
}
.party {
  border: 1px solid #888;
  padding: 3mm 4mm;
}
.party h3 {
  margin: 0 0 2mm;
  padding-bottom: 1.5mm;
  border-bottom: 1px solid #ccc;
  font-size: 9pt;
  font-weight: 700;
}
.row {
  display: flex;
  align-items: center;
  gap: 2mm;
  padding: 0.8mm 0;
  font-size: 9.5pt;
}
.row .k {
  width: 18mm;
  flex-shrink: 0;
  color: #555;
}
.row .v {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.supplier-head .v {
  font-weight: 700;
}
.stamp {
  height: 38px;
  width: auto;
  margin-left: auto;
}
.section-title {
  margin: 0 0 2mm;
  padding-left: 2mm;
  border-left: 3px solid #333;
  font-size: 10pt;
  font-weight: 700;
}
.ship {
  margin-bottom: 5mm;
}
.ship-grid {
  border: 1px solid #888;
  padding: 2mm 4mm;
}
.ship-addr .v {
  word-break: break-all;
}
.items {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 3mm;
  font-size: 9.5pt;
}
.items th,
.items td {
  border: 1px solid #888;
  padding: 2mm;
  text-align: left;
}
.items th {
  background: #f4f4f4;
  text-align: center;
  font-weight: 700;
}
.items .num {
  text-align: right;
}
.items .col-no {
  width: 10mm;
}
.items .col-qty {
  width: 16mm;
}
.items .col-amount {
  width: 30mm;
}
.amounts {
  width: 74mm;
  margin-left: auto;
  margin-bottom: 5mm;
  border-collapse: collapse;
  font-size: 9.5pt;
}
.amounts td {
  border: 1px solid #888;
  padding: 2mm;
}
.amounts .k {
  width: 34mm;
  color: #333;
}
.amounts .num {
  text-align: right;
}
.amounts .total td {
  border-top: 2px solid #333;
  font-weight: 700;
}
.footer-notes {
  font-size: 9pt;
  color: #333;
}
.footer-notes p {
  margin: 1mm 0;
}

@media print {
  .sheet {
    min-height: auto;
  }
}
</style>
