<script setup lang="ts">
import { computed, ref } from 'vue';
import type { BomQuotePrintType } from '@sp/api-contract';
import { smartbomCaseNo } from '../../admin/smartbom';
import { formatKrw } from '../../lib/format';
import { fmtKstDate } from '@sp/utils';

// BOM 견적서(A4) 순수 표시 컴포넌트(§6.8) — 거버 EstimateSheet 동형. props 데이터만
// 뿌리고 fetch 하지 않는다(관리자·고객 모달이 공용). 확정가 없으면 예상가 + "가안" 표기.

const props = defineProps<{ data: BomQuotePrintType }>();

const stampSrc = `${import.meta.env.BASE_URL}img/stamp.jpg`;

// 수기 필드(인쇄 전 일회성 보정, 저장 없음) — 수신처는 고객명으로 초기화.
const recipientCompany = ref('');
const recipientName = ref(props.data.customerName);

const isDraft = computed(() => props.data.confirmedTotal === null);
const caseNo = computed(() =>
  smartbomCaseNo(props.data.quoteId, props.data.requestedAt, props.data.createdAt),
);
const issuedAt = computed(() => fmtKstDate(props.data.answeredAt ?? new Date().toISOString()));

// 합계 — 확정 우선, 없으면 예상(가안). 공급가(VAT 별도) → 부가세 10% → 합계.
const shippingFee = computed(
  () => props.data.confirmedShippingFee ?? props.data.estimatedShippingFee,
);
const managementFee = computed(
  () => props.data.confirmedManagementFee ?? props.data.estimatedManagementFee,
);
const supply = computed(() => props.data.confirmedTotal ?? props.data.estimatedTotal);
const vat = computed(() => Math.round(supply.value * 0.1));
const total = computed(() => supply.value + vat.value);

const sellerAddr = computed(() => {
  const s = props.data.seller;
  return s.zip !== '' ? `(${s.zip}) ${s.addr}` : s.addr;
});
const money = (v: number | null): string => (v === null ? '—' : formatKrw(v));
</script>

<template>
  <div class="sheet">
    <h1 class="title">견 적 서</h1>
    <p v-if="isDraft" class="draft-badge">가안 — 확정가 등록 전(예상 금액)</p>

    <div class="meta">
      <div><span class="mk">견적번호</span>{{ caseNo }}</div>
      <div><span class="mk">발행일</span>{{ issuedAt }}</div>
    </div>

    <div class="parties">
      <!-- 수신 — 수기(고객명 초기화) -->
      <section class="party">
        <h3>수신</h3>
        <div class="row">
          <span class="k">회사명</span>
          <input v-model="recipientCompany" class="hw" type="text">
        </div>
        <div class="row">
          <span class="k">성명</span>
          <input v-model="recipientName" class="hw" type="text">
        </div>
        <div class="row">
          <span class="k">견적 건</span>
          <span class="v">{{ props.data.title }}</span>
        </div>
      </section>

      <!-- 발신 — 영카트 사업자정보 + 직인 -->
      <section class="party">
        <h3>공급자</h3>
        <div class="row supplier-head">
          <span class="k">상호</span>
          <span class="v">{{ props.data.seller.name }}</span>
          <img :src="stampSrc" alt="" class="stamp">
        </div>
        <div class="row">
          <span class="k">대표</span>
          <span class="v">{{ props.data.seller.owner }}</span>
        </div>
        <div class="row">
          <span class="k">주소</span>
          <span class="v">{{ sellerAddr }}</span>
        </div>
        <div class="row">
          <span class="k">전화</span>
          <span class="v">{{ props.data.seller.tel }}</span>
        </div>
        <div class="row">
          <span class="k">담당</span>
          <span class="v">{{ props.data.seller.managerName }}</span>
        </div>
        <div class="row">
          <span class="k">이메일</span>
          <span class="v">{{ props.data.seller.managerEmail }}</span>
        </div>
      </section>
    </div>

    <!-- 품목표 — 선정 부품행(included) -->
    <table class="items">
      <thead>
        <tr>
          <th class="col-no">No</th>
          <th>품명 (MPN)</th>
          <th>제조사 / 규격</th>
          <th class="col-qty">수량</th>
          <th class="col-price">단가</th>
          <th class="col-amount">금액</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, i) in props.data.items" :key="i">
          <td class="num">{{ i + 1 }}</td>
          <td>{{ item.mpn }}</td>
          <td>{{ [item.manufacturerName, item.description].filter((v) => v !== null && v !== '').join(' / ') }}</td>
          <td class="num">{{ item.qty.toLocaleString('ko-KR') }}</td>
          <td class="num">{{ money(item.unitPriceKrw) }}</td>
          <td class="num">{{ money(item.lineTotalKrw) }}</td>
        </tr>
      </tbody>
    </table>

    <!-- 금액 — 부품 합계 + 운송료 + 관리비 = 공급가액 → 부가세 → 합계(주문 결제액과 일치) -->
    <table class="amounts">
      <tbody>
        <tr>
          <td class="k">부품 합계</td>
          <td class="num">{{ formatKrw(props.data.itemsTotal) }}</td>
        </tr>
        <tr>
          <td class="k">운송료</td>
          <td class="num">{{ formatKrw(shippingFee) }}</td>
        </tr>
        <tr>
          <td class="k">관리비</td>
          <td class="num">{{ formatKrw(managementFee) }}</td>
        </tr>
        <tr>
          <td class="k">공급가액</td>
          <td class="num">{{ formatKrw(supply) }}</td>
        </tr>
        <tr>
          <td class="k">부가세 (10%)</td>
          <td class="num">{{ formatKrw(vat) }}</td>
        </tr>
        <tr class="total">
          <td class="k">합계 (VAT 포함)</td>
          <td class="num">{{ formatKrw(total) }}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer-notes">
      <p v-if="props.data.answerNote !== null && props.data.answerNote !== ''">
        회신 메모: {{ props.data.answerNote }}
      </p>
      <p v-if="props.data.seller.bankAccount !== ''">
        결제계좌: {{ props.data.seller.bankAccount }}
      </p>
      <p>본 견적 금액은 부품 시세·재고 상황에 따라 변동될 수 있습니다.</p>
    </div>
  </div>
</template>

<style scoped>
/* A4 — 거버 EstimateSheet 관례(296mm 미리보기, 인쇄 시 min-height 해제) */
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
  margin: 0 0 4mm;
  text-align: center;
  font-size: 26pt;
  font-weight: 700;
  letter-spacing: 4pt;
}
.draft-badge {
  margin: 0 0 3mm;
  text-align: center;
  color: #b45309;
  font-weight: 700;
  font-size: 10pt;
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
.hw {
  flex: 1;
  min-width: 0;
  border: none;
  border-bottom: 1px dashed #bbb;
  background: transparent;
  padding: 0 1mm;
  font: inherit;
  color: #111;
  outline: none;
}
.items {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 3mm;
  font-size: 9pt;
}
.items th,
.items td {
  border: 1px solid #888;
  padding: 1.5mm 2mm;
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
  width: 9mm;
}
.items .col-qty {
  width: 15mm;
}
.items .col-price {
  width: 24mm;
}
.items .col-amount {
  width: 28mm;
}
.amounts {
  width: 80mm;
  margin-left: auto;
  margin-bottom: 5mm;
  border-collapse: collapse;
  font-size: 9.5pt;
}
.amounts td {
  border: 1px solid #888;
  padding: 1.8mm 2mm;
}
.amounts .k {
  width: 38mm;
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
  .hw {
    border-bottom-color: transparent;
  }
  .hw::placeholder {
    color: transparent;
  }
}
</style>
