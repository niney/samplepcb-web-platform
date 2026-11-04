<script setup lang="ts">
import { computed } from 'vue';
import { DEVELOP_QUOTE_SUPPLIER, developQuoteRemarks, developQuoteSheetRows } from '@sp/api-contract';
import type { DevelopQuoteSheetQuote, DevelopQuoteSheetRecipient } from '@sp/api-contract';
import logoUrl from '../assets/develop-quote-logo.svg';
import stampUrl from '../assets/develop-quote-stamp.png';

// 개발의뢰 견적서 1쪽(docs/DEVELOP_FLOW.md §5.1, 2026-11-04) — 참고 견적서 '개발견적서' 서식.
// 고객 인쇄 화면(apps/develop QuotePrint)과 관리자 미리보기(apps/web 견적 편집기·카드)가 같이 쓴다. 표의 행은 서버 엑셀과
// 같은 계약 함수 developQuoteSheetRows 가 정한다(순위·구분 병합·소계·가산 행). 순수 표시 — fetch 하지 않는다.
// 모양은 소비 앱의 Tailwind 토큰과 무관하게 scoped CSS(A4 폭 고정)로 그린다 — 종이는 앱마다 달라지면 안 된다.
// 발신처는 계약 DEVELOP_QUOTE_SUPPLIER(사용자 결정 '일단 고정'), 직인은 참고 견적서 원본의 도장이다.
const props = defineProps<{
  quote: DevelopQuoteSheetQuote;
  recipient: DevelopQuoteSheetRecipient;
  quoteNo: string;
  issuedOn: string; // YYYY-MM-DD(KST)
}>();

const S = DEVELOP_QUOTE_SUPPLIER;
const rows = computed(() => developQuoteSheetRows(props.quote));
const remarks = computed(() => developQuoteRemarks(props.quote));
const num = (n: number): string => n.toLocaleString('ko-KR');
const issued = computed(() => props.issuedOn.replace(/-/g, '. '));
const vatLabel = computed(() =>
  props.quote.vatMode === 'exempt' ? '부가세 (면세)' : props.quote.vatMode === 'included' ? '부가세 (포함)' : '부가세',
);
</script>

<template>
  <div class="dq-sheet" data-testid="develop-quote-sheet">
    <header class="dq-head">
      <img :src="logoUrl" alt="SAMPLEPCB" class="dq-logo" width="150" height="47">
      <div class="dq-addr">
        <p>{{ S.address }}</p>
        <p class="dq-b">T {{ S.tel }}&nbsp;&nbsp; F {{ S.fax }}&nbsp;&nbsp; E {{ S.email }}</p>
      </div>
    </header>

    <h1 class="dq-title">견&nbsp;&nbsp;&nbsp;적&nbsp;&nbsp;&nbsp;서</h1>

    <div class="dq-meta">
      <p><b>견적번호 :</b> <span data-testid="develop-quote-no">{{ quoteNo }}</span></p>
      <p><b>견적일자 :</b> {{ issued }}</p>
    </div>

    <table class="dq-parties">
      <colgroup>
        <col class="dq-pk">
        <col>
        <col class="dq-pk">
        <col>
      </colgroup>
      <tbody>
        <tr>
          <th>수신</th>
          <td class="dq-b">{{ recipient.company ?? recipient.name }}</td>
          <th>발신</th>
          <td class="dq-b">{{ S.name }}</td>
        </tr>
        <tr>
          <th>부서</th>
          <td>{{ recipient.dept ?? '' }}</td>
          <th>대표자</th>
          <td class="dq-owner">
            {{ S.owner }}
            <img :src="stampUrl" alt="" class="dq-stamp" width="52" height="56">
          </td>
        </tr>
        <tr>
          <th>담당자</th>
          <td class="dq-b">{{ recipient.name }} 님</td>
          <th>담당자</th>
          <td class="dq-b">{{ S.managerName }}</td>
        </tr>
        <tr>
          <th>핸드폰</th>
          <td>{{ recipient.phone }}</td>
          <th>연락처</th>
          <td>{{ S.managerPhone }}</td>
        </tr>
        <tr>
          <th>e-mail</th>
          <td>{{ recipient.email }}</td>
          <th>e-mail</th>
          <td>{{ S.managerEmail }}</td>
        </tr>
      </tbody>
    </table>

    <p class="dq-name"><b>견적명 :</b> <strong>{{ quote.title }}</strong></p>
    <p class="dq-lead">아래와 같이 견적합니다.</p>

    <table class="dq-items">
      <colgroup>
        <col class="dq-c-rank">
        <col class="dq-c-group">
        <col class="dq-c-title">
        <col class="dq-c-grade">
        <col>
        <col class="dq-c-price">
        <col class="dq-c-qty">
        <col class="dq-c-amount">
      </colgroup>
      <thead>
        <tr>
          <th>순위</th>
          <th>구분</th>
          <th>직무</th>
          <th>기술등급</th>
          <th>담당업무</th>
          <th>단가</th>
          <th>기간</th>
          <th>합계</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="(row, i) in rows" :key="i">
          <tr v-if="row.kind === 'item'" class="dq-item">
            <template v-if="row.groupFirst">
              <td :rowspan="row.groupSize + 1" class="dq-center">{{ row.rank }}</td>
              <td :rowspan="row.groupSize" class="dq-center dq-b">{{ row.groupLabel }}</td>
            </template>
            <td>{{ row.title }}</td>
            <template v-if="row.category === 'labor'">
              <td class="dq-center">{{ row.grade ?? '' }}</td>
              <td>{{ row.description ?? '' }}</td>
            </template>
            <td v-else colspan="2">{{ row.description ?? '' }}</td>
            <td class="dq-num">{{ num(row.unitPrice) }}</td>
            <td class="dq-center">{{ row.qtyText }}</td>
            <td class="dq-num">{{ num(row.amount) }}</td>
          </tr>
          <tr v-else-if="row.kind === 'subtotal'" class="dq-subtotal">
            <td colspan="6" class="dq-center dq-b">{{ row.label }}</td>
            <td class="dq-num dq-b">{{ num(row.amount) }}</td>
          </tr>
          <tr v-else class="dq-surcharge">
            <td class="dq-center">{{ row.rank }}</td>
            <td class="dq-center dq-b">{{ row.label }}</td>
            <td colspan="5">{{ row.text }}</td>
            <td class="dq-num dq-b">{{ num(row.amount) }}</td>
          </tr>
        </template>
        <tr v-if="rows.length === 0">
          <td colspan="8" class="dq-center dq-muted">견적 항목이 없습니다.</td>
        </tr>
      </tbody>
    </table>

    <div class="dq-bottom">
      <p class="dq-note">{{ quote.note ?? '' }}</p>
      <table class="dq-totals">
        <tbody>
          <tr>
            <th>공급가 합계</th>
            <td class="dq-num" data-testid="develop-quote-supply">{{ num(quote.supplyAmount) }}</td>
          </tr>
          <tr>
            <th>{{ vatLabel }}</th>
            <td class="dq-num">{{ num(quote.vatAmount) }}</td>
          </tr>
          <tr class="dq-final">
            <th>최종 견적 합계</th>
            <td class="dq-num" data-testid="develop-quote-total">{{ num(quote.totalAmount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="dq-remark">
      <h2>Remark</h2>
      <ol>
        <li v-for="(rm, i) in remarks" :key="i" :class="{ 'dq-b': rm.label === null }">
          <template v-if="rm.label !== null"><span class="dq-rk">{{ rm.label }}</span> : </template>{{ rm.text }}
        </li>
      </ol>
    </section>
  </div>
</template>

<style scoped>
/* A4 — 화면은 종이 한 장(여백 12mm 포함 210mm), 인쇄는 @page 여백(소비 화면이 붙인다)에 맡기고 패딩을 푼다.
   배경색(제목 띠·머리줄·소계·합계)은 인쇄 '배경 그래픽'을 꺼도 찍히게 print-color-adjust 를 건다. */
.dq-sheet {
  box-sizing: border-box;
  width: 210mm;
  padding: 12mm;
  background: #fff;
  color: #1f2329;
  font-family: Pretendard, 'Pretendard Variable', 'Noto Sans KR', 'Malgun Gothic', '맑은 고딕', sans-serif;
  font-size: 12px;
  line-height: 1.45;
  letter-spacing: -0.01em;
  word-break: keep-all;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.dq-sheet *,
.dq-sheet *::before,
.dq-sheet *::after {
  box-sizing: border-box;
}
.dq-sheet :where(p, h1, h2, ol) {
  margin: 0;
}
@media print {
  .dq-sheet {
    width: auto;
    padding: 0;
  }
}

.dq-b {
  font-weight: 700;
}
.dq-center {
  text-align: center;
}
.dq-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.dq-muted {
  color: #8a9099;
}

.dq-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}
.dq-logo {
  display: block;
  width: 150px;
  height: auto;
}
.dq-addr {
  text-align: right;
  font-size: 11px;
  color: #3a4048;
}

.dq-title {
  margin-top: 14px;
  padding: 8px 0;
  border: 1px solid #8c8c8c;
  background: #d9d9d9;
  text-align: center;
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.dq-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 12px;
  font-size: 13px;
}

table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
th,
td {
  border: 1px solid #8c8c8c;
  padding: 5px 7px;
  vertical-align: middle;
  overflow-wrap: anywhere;
}

.dq-parties {
  margin-top: 8px;
}
.dq-parties .dq-pk {
  width: 13%;
}
.dq-parties th {
  background: #f2f2f2;
  font-weight: 700;
}
.dq-owner {
  position: relative;
}
.dq-stamp {
  position: absolute;
  top: 50%;
  left: 92px;
  width: 52px;
  height: auto;
  transform: translateY(-50%);
  pointer-events: none;
}

.dq-name {
  margin-top: 16px;
  font-size: 14px;
}
.dq-name strong {
  margin-left: 6px;
  font-size: 15px;
}
.dq-lead {
  margin-top: 6px;
  color: #3a4048;
}

.dq-items {
  margin-top: 8px;
}
.dq-items thead th {
  background: #d9d9d9;
  font-weight: 700;
}
.dq-c-rank {
  width: 6%;
}
.dq-c-group {
  width: 9%;
}
.dq-c-title {
  width: 14%;
}
.dq-c-grade {
  width: 9%;
}
.dq-c-price {
  width: 14%;
}
.dq-c-qty {
  width: 9%;
}
.dq-c-amount {
  width: 14%;
}
.dq-subtotal td {
  background: #f2f2f2;
}
.dq-items tr {
  break-inside: avoid;
}

.dq-bottom {
  display: grid;
  grid-template-columns: 1fr 37%;
  margin-top: -1px;
  break-inside: avoid;
}
.dq-note {
  border: 1px solid #8c8c8c;
  border-right: 0;
  padding: 7px;
  font-weight: 700;
  white-space: pre-wrap;
}
.dq-totals th {
  width: 52%;
  background: #f2f2f2;
  font-weight: 700;
}
.dq-totals td {
  font-weight: 700;
}
.dq-final th,
.dq-final td {
  background: #fff2cc;
  font-size: 13px;
}

.dq-remark {
  margin-top: 16px;
  break-inside: avoid;
}
.dq-remark h2 {
  font-size: 13px;
  font-weight: 800;
}
/* 소비 앱의 Tailwind 기본 초기화가 ol 번호를 지우므로 다시 건다(참고 견적서 '1. 납기 …'). */
.dq-remark ol {
  margin-top: 4px;
  padding-left: 22px;
  list-style: decimal;
}
.dq-remark li + li {
  margin-top: 2px;
}
.dq-rk {
  display: inline-block;
  min-width: 82px;
}
</style>
