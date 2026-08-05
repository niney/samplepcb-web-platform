<script setup lang="ts">
import { computed } from 'vue';
import type {
  BomPartnerQuotationItemType,
  BomShipmentStatementItemType,
  BomTradeDocumentType,
  BomTradePartyType,
} from '@sp/api-contract';
import { fmtKstDate } from '@sp/utils';

// 협력사 견적서·거래명세서 공용 A4 표시 컴포넌트. 데이터 조회와 상태 변경 없이
// 서버가 고정한 문서 스냅샷만 렌더링해 관리자/협력사 출력 결과를 동일하게 유지한다.

const props = defineProps<{ data: BomTradeDocumentType }>();

const title = computed(() => (props.data.kind === 'quotation' ? '견 적 서' : '거 래 명 세 서'));
const documentNo = computed(() =>
  props.data.kind === 'quotation' ? props.data.quotationNo : props.data.statementNo,
);
const issuedDate = computed(() => fmtKstDate(props.data.issuedAt));
const isDraft = computed(() => props.data.kind === 'statement' && props.data.isDraft);

const partyAddress = (party: BomTradePartyType): string =>
  [party.zip === '' ? '' : `(${party.zip})`, party.address].filter(Boolean).join(' ');
const businessLine = (party: BomTradePartyType): string =>
  [party.businessType, party.businessItem].filter(Boolean).join(' / ');
const contactLine = (party: BomTradePartyType): string =>
  [party.contactName, party.tel, party.email].filter(Boolean).join(' · ');
const money = (value: number): string =>
  `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 }).format(value)} ${props.data.currency}`;
const quoteTerms = (item: BomPartnerQuotationItemType): string =>
  [
    item.moq === null ? '' : `MOQ ${item.moq.toLocaleString('ko-KR')}`,
    item.stock === null ? '' : `재고 ${item.stock.toLocaleString('ko-KR')}`,
    item.dateCode === null || item.dateCode === '' ? '' : `D/C ${item.dateCode}`,
    item.leadTime === null || item.leadTime === '' ? '' : `납기 ${item.leadTime}`,
    item.memo ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
const statementTrace = (item: BomShipmentStatementItemType): string =>
  [
    item.lotNos.length === 0 ? '' : `LOT ${item.lotNos.join(', ')}`,
    item.dateCodes.length === 0 ? '' : `D/C ${item.dateCodes.join(', ')}`,
  ]
    .filter(Boolean)
    .join(' · ');
</script>

<template>
  <article class="trade-sheet">
    <h1>{{ title }}</h1>
    <p v-if="isDraft" class="draft">초안 — 선적 리스트 확정 전</p>

    <div class="meta">
      <div><span>문서번호</span>{{ documentNo }}</div>
      <div><span>발행일</span>{{ issuedDate }}</div>
    </div>

    <div class="parties">
      <section class="party">
        <h2>공급자</h2>
        <div class="party-name">{{ data.issuer.companyName || '—' }} <small>(인)</small></div>
        <dl>
          <template v-if="data.issuer.businessNo !== ''">
            <dt>등록번호</dt>
            <dd>{{ data.issuer.businessNo }}</dd>
          </template>
          <template v-if="data.issuer.ownerName !== ''">
            <dt>대표자</dt>
            <dd>{{ data.issuer.ownerName }}</dd>
          </template>
          <template v-if="partyAddress(data.issuer) !== ''">
            <dt>주소</dt>
            <dd>{{ partyAddress(data.issuer) }}</dd>
          </template>
          <template v-if="businessLine(data.issuer) !== ''">
            <dt>업태/종목</dt>
            <dd>{{ businessLine(data.issuer) }}</dd>
          </template>
          <template v-if="contactLine(data.issuer) !== ''">
            <dt>연락처</dt>
            <dd>{{ contactLine(data.issuer) }}</dd>
          </template>
        </dl>
      </section>
      <section class="party">
        <h2>공급받는 자</h2>
        <div class="party-name">{{ data.recipient.companyName || '—' }}</div>
        <dl>
          <template v-if="data.recipient.businessNo !== ''">
            <dt>등록번호</dt>
            <dd>{{ data.recipient.businessNo }}</dd>
          </template>
          <template v-if="data.recipient.ownerName !== ''">
            <dt>대표자</dt>
            <dd>{{ data.recipient.ownerName }}</dd>
          </template>
          <template v-if="partyAddress(data.recipient) !== ''">
            <dt>주소</dt>
            <dd>{{ partyAddress(data.recipient) }}</dd>
          </template>
          <template v-if="contactLine(data.recipient) !== ''">
            <dt>연락처</dt>
            <dd>{{ contactLine(data.recipient) }}</dd>
          </template>
        </dl>
      </section>
    </div>

    <div v-if="data.kind === 'quotation'" class="subject">
      <b>견적 건</b><span>{{ data.quoteTitle }}</span>
      <template v-if="data.deliveryDate !== null">
        <b>납기 예정</b><span>{{ data.deliveryDate }}</span>
      </template>
    </div>
    <div v-else class="subject">
      <b>발송 번호</b><span>#{{ data.shipmentId }} · Packing List R{{ data.packingRevision }}</span>
      <template v-if="data.shipDate !== null">
        <b>출고 예정</b><span>{{ data.shipDate }}</span>
      </template>
      <template v-if="data.carrier !== null || data.trackingNumber !== null">
        <b>운송 정보</b><span>{{ [data.carrier, data.trackingNumber].filter(Boolean).join(' · ') }}</span>
      </template>
    </div>

    <table v-if="data.kind === 'quotation'" class="items">
      <thead>
        <tr>
          <th class="no">No</th>
          <th>품명(MPN) / 규격</th>
          <th class="qty">수량</th>
          <th class="price">단가</th>
          <th class="price">금액</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in data.items" :key="item.poItemId">
          <td class="num">{{ index + 1 }}</td>
          <td>
            <b>{{ item.mpn }}</b>
            <div class="sub">
              {{ [item.manufacturerName, item.description].filter(Boolean).join(' / ') || '—' }}
            </div>
            <div v-if="quoteTerms(item) !== ''" class="terms">{{ quoteTerms(item) }}</div>
          </td>
          <td class="num">{{ item.qty.toLocaleString('ko-KR') }}</td>
          <td class="num">{{ money(item.unitPrice) }}</td>
          <td class="num">{{ money(item.lineTotal) }}</td>
        </tr>
      </tbody>
    </table>

    <table v-else class="items statement-items">
      <thead>
        <tr>
          <th class="no">No</th>
          <th>PO / 품명(MPN)</th>
          <th class="qty">발주</th>
          <th class="qty">출고</th>
          <th class="price">단가</th>
          <th class="price">금액</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(item, index) in data.items" :key="item.poItemId">
          <td class="num">{{ index + 1 }}</td>
          <td>
            <div class="po-ref">PO-SPB-{{ item.poId }} · {{ item.quoteTitle }}</div>
            <b>{{ item.mpn }}</b>
            <div class="sub">
              {{ [item.manufacturerName, item.description].filter(Boolean).join(' / ') || '—' }}
            </div>
            <div v-if="statementTrace(item) !== ''" class="terms">{{ statementTrace(item) }}</div>
          </td>
          <td class="num">{{ item.orderedQty.toLocaleString('ko-KR') }}</td>
          <td class="num">{{ item.shippedQty.toLocaleString('ko-KR') }}</td>
          <td class="num">{{ money(item.unitPrice) }}</td>
          <td class="num">{{ money(item.lineTotal) }}</td>
        </tr>
      </tbody>
    </table>

    <div class="summary-wrap">
      <p v-if="data.kind === 'statement'">
        총 출고수량 <b>{{ data.totalQuantity.toLocaleString('ko-KR') }}</b>
      </p>
      <table class="amounts">
        <tbody>
          <tr>
            <th>공급가액</th>
            <td>{{ money(data.supplyAmount) }}</td>
          </tr>
          <tr>
            <th>부가세{{ data.issuer.country === 'KR' ? ' (10%)' : '' }}</th>
            <td>{{ money(data.vatAmount) }}</td>
          </tr>
          <tr class="total">
            <th>합계</th>
            <td>{{ money(data.totalAmount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="notes">
      <p v-if="data.kind === 'quotation' && data.memo !== null && data.memo !== ''">
        비고: {{ data.memo }}
      </p>
      <p v-if="data.kind === 'statement' && data.isDraft">
        확정 전 Packing List 수량을 기준으로 작성된 초안입니다.
      </p>
      <p>본 문서는 {{ fmtKstDate(data.snapshotAt) }} 기준으로 생성되었습니다.</p>
    </div>
  </article>
</template>

<style scoped>
.trade-sheet {
  width: 210mm;
  min-height: 296mm;
  box-sizing: border-box;
  padding: 13mm 14mm;
  background: #fff;
  color: #111;
  font:
    9.5pt/1.45 'Malgun Gothic',
    '맑은 고딕',
    sans-serif;
}
.trade-sheet h1 {
  margin: 0 0 3mm;
  text-align: center;
  font-size: 24pt;
  letter-spacing: 4pt;
}
.draft {
  margin: 0 0 3mm;
  text-align: center;
  color: #b45309;
  font-weight: 700;
}
.meta {
  display: flex;
  justify-content: flex-end;
  gap: 7mm;
  margin-bottom: 4mm;
  font-size: 9pt;
}
.meta span {
  margin-right: 2mm;
  color: #666;
}
.parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5mm;
  margin-bottom: 4mm;
}
.party {
  border: 1px solid #777;
  padding: 3mm;
}
.party h2 {
  margin: 0 0 1.5mm;
  padding-bottom: 1mm;
  border-bottom: 1px solid #ccc;
  font-size: 9pt;
}
.party-name {
  margin-bottom: 1.5mm;
  font-size: 11pt;
  font-weight: 700;
}
.party-name small {
  font-size: 8pt;
  font-weight: 400;
}
.party dl {
  display: grid;
  grid-template-columns: 18mm 1fr;
  gap: 0.7mm 1mm;
  margin: 0;
  font-size: 8.5pt;
}
.party dt {
  color: #666;
}
.party dd {
  margin: 0;
  word-break: break-all;
}
.subject {
  display: grid;
  grid-template-columns: 20mm 1fr 20mm 1fr;
  gap: 1mm 2mm;
  margin-bottom: 3mm;
  padding: 2.5mm;
  border: 1px solid #aaa;
  font-size: 9pt;
}
.subject b {
  color: #555;
}
.items {
  width: 100%;
  border-collapse: collapse;
  font-size: 8.5pt;
}
.items th,
.items td {
  border: 1px solid #777;
  padding: 1.4mm 1.6mm;
}
.items th {
  background: #f3f4f6;
  text-align: center;
}
.items .no {
  width: 8mm;
}
.items .qty {
  width: 13mm;
}
.items .price {
  width: 27mm;
}
.num {
  text-align: right;
  white-space: nowrap;
}
.sub {
  margin-top: 0.5mm;
  color: #555;
  font-size: 7.8pt;
}
.terms {
  margin-top: 0.7mm;
  color: #1d4ed8;
  font-size: 7.5pt;
}
.po-ref {
  margin-bottom: 0.5mm;
  color: #666;
  font-size: 7.5pt;
}
.summary-wrap {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 5mm;
  margin-top: 3mm;
}
.summary-wrap > p {
  margin: 1mm 0;
  color: #555;
}
.amounts {
  width: 75mm;
  border-collapse: collapse;
}
.amounts th,
.amounts td {
  border: 1px solid #777;
  padding: 1.5mm 2mm;
}
.amounts th {
  width: 30mm;
  background: #f8fafc;
  text-align: left;
}
.amounts td {
  text-align: right;
  white-space: nowrap;
}
.amounts .total {
  font-weight: 700;
  font-size: 10pt;
}
.notes {
  margin-top: 5mm;
  padding-top: 2mm;
  border-top: 1px solid #bbb;
  color: #555;
  font-size: 8pt;
}
.notes p {
  margin: 0.7mm 0;
}
@media print {
  .trade-sheet {
    min-height: 0;
  }
  .items thead {
    display: table-header-group;
  }
  .items tr {
    break-inside: avoid;
  }
}
</style>
