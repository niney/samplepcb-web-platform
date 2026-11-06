<script setup lang="ts">
import { computed } from 'vue';
import { DEVELOP_QUOTE_SUPPLIER, developQuoteDurationText, developQuoteRemarks, developQuoteSheetRows } from '@sp/api-contract';
import type { DevelopQuoteSheetQuote, DevelopQuoteSheetRecipient, DevelopQuoteSheetRow } from '@sp/api-contract';
import logoUrl from '../assets/develop-quote-logo.svg';
import stampUrl from '../assets/develop-quote-stamp.png';

// 개발의뢰 견적서 1쪽(docs/DEVELOP_FLOW.md §5.1) — 2026-11-06 피그마 「통합 견적서」(285:18, 794 폭 = A4 96dpi) 모양에
// 지금 개발 견적 데이터를 싣는다. 제목은 '견적서'(개발 견적은 PCB·부품을 한데 묶는 통합 견적이 아니다).
// 고객 인쇄 화면(apps/develop QuotePrint)·의뢰 출력물(RequestPrint '3. 견적서')·관리자 미리보기(apps/web)가 같이 쓴다.
// 표의 행은 서버 엑셀과 같은 계약 함수 developQuoteSheetRows 가 정한다. 순수 표시 — fetch 하지 않는다.
// 모양은 소비 앱의 Tailwind 토큰과 무관하게 scoped CSS 로 그린다(종이는 앱마다 달라지면 안 된다). 인쇄 여백은 쓰는 화면이
// 정한다 — A4 인쇄(QuotePrint)는 패딩을 풀고 @page 여백에 맡기고, 출력물(PPT 4:3)은 화면 모양 그대로 찍는다.
// 표는 <table> 이 아니라 묶음(구분 하나 = 항목 행 + 소계 행) 단위 div 다 — 출력물 쪽 나누기(lib/print-paginate)가 가로 flex 를
// 통째로 다뤄 묶음이 쪽 경계에서 갈리지 않는다(표였다면 쪽마다 행 병합이 끊긴다).
// 시안과 다르게 둔 것: 비고(별첨) 열 없음(개발 견적엔 별첨이 없다 — 폭은 항목 열로), 결제계좌 없음(결제는 사이트 주문),
// 출고예정일 자리는 '개발 기간' + '특기 사항', 소계·가산(간접비·제경비·기업이윤) 행. 발신처는 계약 DEVELOP_QUOTE_SUPPLIER,
// 직인은 참고 견적서 원본 도장이다.
const props = defineProps<{
  quote: DevelopQuoteSheetQuote;
  recipient: DevelopQuoteSheetRecipient;
  quoteNo: string;
  issuedOn: string; // YYYY-MM-DD(KST)
}>();

const S = DEVELOP_QUOTE_SUPPLIER;
const num = (n: number): string => n.toLocaleString('ko-KR');
const won = (n: number): string => `${num(n)}원`;

// 수신 — 비어 있는 칸(개인 의뢰의 회사명·부서)은 줄째 뺀다.
const recipientFields = computed(() =>
  [
    { label: '회사명', value: props.recipient.company ?? '' },
    { label: '부서', value: props.recipient.dept ?? '' },
    { label: '이름', value: props.recipient.name },
    { label: '연락처', value: props.recipient.phone },
    { label: '이메일', value: props.recipient.email },
  ].filter((f) => f.value.trim() !== ''),
);

// 표 묶음 — 구분(인건비·직접비)마다 항목 행 + 소계 행, 가산(간접비·제경비·기업이윤)은 한 줄짜리 묶음.
type ItemRow = Extract<DevelopQuoteSheetRow, { kind: 'item' }>;
interface ItemGroup {
  kind: 'items';
  key: string;
  label: string;
  items: ItemRow[];
  subtotal: { label: string; amount: number } | null;
}
interface SurchargeGroup {
  kind: 'surcharge';
  key: string;
  label: string;
  text: string;
  amount: number;
}
const groups = computed<(ItemGroup | SurchargeGroup)[]>(() => {
  const out: (ItemGroup | SurchargeGroup)[] = [];
  let current: ItemGroup | null = null;
  for (const row of developQuoteSheetRows(props.quote)) {
    if (row.kind === 'item') {
      if (row.groupFirst || current === null) {
        current = { kind: 'items', key: `g${String(row.rank)}`, label: row.groupLabel, items: [], subtotal: null };
        out.push(current);
      }
      current.items.push(row);
    } else if (row.kind === 'subtotal') {
      if (current !== null) current.subtotal = { label: row.label, amount: row.amount };
      current = null;
    } else {
      current = null;
      out.push({ kind: 'surcharge', key: `s${String(row.rank)}`, label: row.label, text: row.text, amount: row.amount });
    }
  }
  return out;
});
// 항목 칸 — 인건비는 '기술등급 · 담당업무', 직접비는 내용. 비면 시안처럼 '-'.
const itemText = (it: ItemRow): string => {
  const parts = it.category === 'labor' ? [it.grade, it.description] : [it.description];
  const text = parts.filter((v): v is string => v !== null && v.trim() !== '').join(' · ');
  return text === '' ? '-' : text;
};

// Remark — 이름 붙은 줄은 시안처럼 두 단(앞 절반 · 뒤 절반), 고정 문구(승인 후 진행)는 그 아래 한 줄.
const remarks = computed(() => developQuoteRemarks(props.quote));
const remarkColumns = computed(() => {
  const labeled = remarks.value.filter((r) => r.label !== null);
  const half = Math.ceil(labeled.length / 2);
  return [labeled.slice(0, half), labeled.slice(half)].filter((c) => c.length > 0);
});
const remarkNotes = computed(() => remarks.value.filter((r) => r.label === null));

const duration = computed(() => developQuoteDurationText(props.quote));
const note = computed(() => (props.quote.note ?? '').trim());
const vatLabel = computed(() =>
  props.quote.vatMode === 'exempt' ? '부가세 (면세)' : props.quote.vatMode === 'included' ? '부가세 (포함)' : '부가세',
);
const totalLabel = computed(() => (props.quote.vatMode === 'exempt' ? '총합계' : '총합계 (VAT 포함)'));
</script>

<template>
  <div class="dq-sheet" data-testid="develop-quote-sheet">
    <header class="dq-head">
      <h1 class="dq-title">견적서</h1>
      <img :src="logoUrl" alt="SAMPLEPCB" class="dq-logo" width="125" height="39">
    </header>
    <p class="dq-sub">{{ quote.title }}</p>

    <dl class="dq-meta">
      <div>
        <dt>견적번호</dt>
        <dd data-testid="develop-quote-no">{{ quoteNo }}</dd>
      </div>
      <div>
        <dt>견적일자</dt>
        <dd>{{ issuedOn }}</dd>
      </div>
      <div>
        <dt>유효기간</dt>
        <dd>{{ quote.validUntil }}</dd>
      </div>
    </dl>

    <div class="dq-parties">
      <section class="dq-party">
        <h2 class="dq-party-head">수신</h2>
        <dl class="dq-fields">
          <template v-for="f in recipientFields" :key="f.label">
            <dt>{{ f.label }}</dt>
            <dd>{{ f.value }}</dd>
          </template>
        </dl>
      </section>
      <section class="dq-party">
        <h2 class="dq-party-head">공급자</h2>
        <span class="dq-stamp-box"><img :src="stampUrl" alt="" class="dq-stamp" width="48" height="46"></span>
        <dl class="dq-fields">
          <dt>상호</dt>
          <dd class="dq-by-stamp">{{ S.name }}</dd>
          <dt>대표자</dt>
          <dd class="dq-by-stamp">{{ S.owner }}</dd>
          <dt class="dq-multi">주소</dt>
          <dd class="dq-multi">{{ S.address }}</dd>
          <dt>연락처</dt>
          <dd class="dq-contact"><span>{{ S.managerName }}</span><span>{{ S.managerPhone }}</span></dd>
          <dt>이메일</dt>
          <dd>{{ S.managerEmail }}</dd>
        </dl>
      </section>
    </div>

    <!-- 산출 내역 — 머리줄 + 묶음. 바깥 테두리·머리줄은 짙게, 열 구분선은 옅게, 묶음 사이는 중간 회색(시안). -->
    <div class="dq-items">
      <div class="dq-tr dq-thead">
        <span class="dq-cell dq-k1">구분</span>
        <span class="dq-cell dq-k2">구분</span>
        <span class="dq-cell dq-k3">항목</span>
        <span class="dq-cell dq-kq">적용 수량</span>
        <span class="dq-cell dq-kp">단가</span>
        <span class="dq-cell dq-ka">금액</span>
      </div>
      <div v-for="g in groups" :key="g.key" class="dq-group">
        <template v-if="g.kind === 'items'">
          <span class="dq-cell dq-k1 dq-c">{{ g.label }}</span>
          <div class="dq-rows">
            <div v-for="(it, i) in g.items" :key="i" class="dq-tr">
              <span class="dq-cell dq-k2">{{ it.title }}</span>
              <span class="dq-cell dq-k3">{{ itemText(it) }}</span>
              <span class="dq-cell dq-kq dq-c">{{ it.qtyText }}</span>
              <span class="dq-cell dq-kp dq-c">{{ won(it.unitPrice) }}</span>
              <span class="dq-cell dq-ka dq-c">{{ won(it.amount) }}</span>
            </div>
            <div v-if="g.subtotal !== null" class="dq-tr dq-subtotal">
              <span class="dq-cell dq-kspan dq-c">{{ g.subtotal.label }}</span>
              <span class="dq-cell dq-ka dq-c">{{ won(g.subtotal.amount) }}</span>
            </div>
          </div>
        </template>
        <template v-else>
          <span class="dq-cell dq-k1 dq-c">{{ g.label }}</span>
          <div class="dq-rows">
            <div class="dq-tr">
              <span class="dq-cell dq-kspan">{{ g.text }}</span>
              <span class="dq-cell dq-ka dq-c">{{ won(g.amount) }}</span>
            </div>
          </div>
        </template>
      </div>
      <p v-if="groups.length === 0" class="dq-empty">견적 항목이 없습니다.</p>
    </div>

    <!-- print-keep = 출력물 쪽 나누기가 상자째 다룬다(테두리 상자가 쪽 경계에서 갈리지 않게) -->
    <section class="dq-remark print-keep">
      <h2 class="dq-remark-title">Remark</h2>
      <div v-if="remarkColumns.length > 0" class="dq-remark-cols">
        <ul v-for="(col, ci) in remarkColumns" :key="ci">
          <li v-for="rm in col" :key="rm.label ?? ''">
            <span class="dq-rk">{{ rm.label }}</span> :&nbsp; <span class="dq-rt">{{ rm.text }}</span>
          </li>
        </ul>
      </div>
      <ul v-if="remarkNotes.length > 0">
        <li v-for="(rm, i) in remarkNotes" :key="i" class="dq-strong">{{ rm.text }}</li>
      </ul>
    </section>

    <div class="dq-summary">
      <dl class="dq-info">
        <dt>개발 기간</dt>
        <dd>{{ duration }}</dd>
        <template v-if="note !== ''">
          <dt>특기 사항</dt>
          <dd class="dq-note">{{ note }}</dd>
        </template>
      </dl>
      <dl class="dq-totals">
        <dt>공급가액</dt>
        <dd><span data-testid="develop-quote-supply">{{ num(quote.supplyAmount) }}</span>원</dd>
        <dt>{{ vatLabel }}</dt>
        <dd>{{ won(quote.vatAmount) }}</dd>
        <dt>{{ totalLabel }}</dt>
        <dd><span data-testid="develop-quote-total">{{ num(quote.totalAmount) }}</span>원</dd>
      </dl>
    </div>
  </div>
</template>

<style scoped>
/* 종이 = 시안 794 폭(A4 96dpi) · 여백 위 44 · 좌우 50 · 아래 50(본문 폭 694). 배경색(머리띠·표 머리·소계·합계 상자)은 인쇄
   '배경 그래픽'을 꺼도 찍히게 print-color-adjust 를 건다. */
.dq-sheet {
  box-sizing: border-box;
  width: 210mm;
  padding: 44px 50px 50px;
  background: #fff;
  color: #39404d;
  font-family: Pretendard, 'Pretendard Variable', 'Noto Sans KR', 'Malgun Gothic', '맑은 고딕', sans-serif;
  font-size: 12px;
  line-height: 14px;
  word-break: keep-all;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
/* 시안 자간은 전부 -4% — em 은 선언한 요소의 글자 크기로 굳어 상속되므로 요소마다 건다(apps/web EstimateSheet 와 같은 방식).
   PDF(@sp/ui downloadElementsPdf)는 찍는 복제본에서 0 으로 되돌린다(html2canvas 글자 어긋남). */
.dq-sheet,
.dq-sheet * {
  box-sizing: border-box;
  letter-spacing: -0.04em;
}
/* :where 로 명시도를 낮춰 아래 블록별 여백이 이긴다 */
.dq-sheet :where(p, h1, h2, dl, dt, dd, ul, li) {
  margin: 0;
  padding: 0;
}

.dq-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.dq-title {
  font-family: 'Noto Sans KR', Pretendard, sans-serif;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.3;
  color: #061023;
}
/* 로고 오른쪽 끝은 시안대로 표보다 4px 안(740) */
.dq-logo {
  display: block;
  flex-shrink: 0;
  width: 125px;
  height: 39px;
  margin: 2px 4px 0 0;
}
.dq-sub {
  margin-top: 10px;
  font-family: 'Noto Sans KR', Pretendard, sans-serif;
  font-size: 16px;
  font-weight: 700;
  line-height: 1.3;
  color: #061023;
  overflow-wrap: anywhere;
}

.dq-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 20px;
  margin-top: 14px;
  padding-left: 1px;
}
.dq-meta div {
  display: flex;
  gap: 6px;
}
.dq-meta dt {
  color: #646464;
}
.dq-meta dd {
  font-weight: 500;
  color: #191919;
}

.dq-parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-top: 14px;
  break-inside: avoid;
}
.dq-party {
  position: relative;
  min-height: 221px;
  border: 1px solid #d9d9d9;
}
.dq-party-head {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border-bottom: 1px solid #d9d9d9;
  background: #eee;
  font-size: 12px;
  font-weight: 700;
  line-height: 14px;
}
.dq-fields {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 14px;
  padding: 20px 20px 18px 19px;
  font-size: 13px;
  line-height: 1.1;
}
.dq-fields dt {
  color: #646464;
}
.dq-fields dd {
  min-width: 0;
  font-weight: 500;
  color: #191919;
  overflow-wrap: anywhere;
}
/* 여러 줄로 흐르는 값(주소)은 줄 간격을 넓히고, 라벨도 첫 줄에 맞춘다 */
.dq-fields .dq-multi {
  line-height: 1.3;
}
.dq-contact {
  display: flex;
  flex-wrap: wrap;
  column-gap: 8px;
}
/* 직인 자리(오른쪽 위 50×50)와 겹치는 두 행은 값을 그 앞에서 접는다 */
.dq-by-stamp {
  padding-right: 60px;
}
.dq-stamp-box {
  position: absolute;
  top: 50px;
  right: 19px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  border: 1px solid #f3f3f3;
  border-radius: 9px;
}
.dq-stamp {
  display: block;
  width: 48px;
  height: 46px;
  object-fit: contain;
}

/* ── 산출 내역 ── 칸 폭은 머리줄과 묶음이 같다(테두리를 칸 안에 넣어 border-box 로 맞춘다). */
.dq-items {
  margin-top: 20px;
  line-height: 1.3;
  color: #000;
}
.dq-tr {
  display: flex;
}
.dq-cell {
  display: flex;
  align-items: center;
  min-width: 0;
  padding: 10px;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.dq-c {
  justify-content: center;
  text-align: center;
}
.dq-k1,
.dq-k2,
.dq-k3,
.dq-kq,
.dq-kp,
.dq-kspan {
  border-right: 1px solid #d9d9d9;
}
.dq-k1 {
  flex: 0 0 70px;
}
.dq-k2 {
  flex: 0 0 110px;
}
.dq-k3,
.dq-kspan {
  flex: 1 1 0;
}
.dq-kq {
  flex: 0 0 63px;
}
.dq-kp,
.dq-ka {
  flex: 0 0 97px;
}
.dq-thead {
  height: 33px;
  border: 1px solid #3b424f;
  background: #fbfbfb;
  line-height: 14px;
  color: #39404d;
}
.dq-thead .dq-cell {
  justify-content: center;
  padding: 0 4px;
  font-weight: 400;
  text-align: center;
}
.dq-group {
  display: flex;
  border: 1px solid #3b424f;
  border-top: 0;
  border-bottom-color: #999;
  break-inside: avoid;
}
.dq-group:last-child {
  border-bottom-color: #3b424f;
}
/* 출력물에서 다음 쪽으로 민 묶음(data-pb — lib/print-paginate)은 표 윗선을 다시 긋는다(시안 Slide 10). */
.dq-group[data-pb] {
  border-top: 1px solid #3b424f;
}
.dq-rows {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  min-width: 0;
}
.dq-rows > .dq-tr {
  flex: 1 0 auto;
}
.dq-rows > .dq-tr + .dq-tr {
  border-top: 1px solid #d9d9d9;
}
.dq-subtotal {
  background: #fbfbfb;
}
.dq-subtotal .dq-cell {
  font-weight: 600;
}
.dq-empty {
  padding: 14px;
  border: 1px solid #3b424f;
  border-top: 0;
  text-align: center;
  color: #8a9099;
}

/* ── Remark ── 글머리는 ::before 점(목록 기호보다 PDF 캡처에서 자리가 안정적이다) */
.dq-remark {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #d9d9d9;
  break-inside: avoid;
}
.dq-remark-title {
  font-size: 13px;
  font-weight: 700;
  line-height: 14px;
}
.dq-remark-cols {
  display: flex;
  gap: 13px;
}
.dq-remark-cols > ul {
  flex: 1 1 0;
  min-width: 0;
}
.dq-remark li {
  position: relative;
  padding-left: 16.5px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.5;
  color: #75777d;
  list-style: none;
}
.dq-remark li::before {
  content: '';
  position: absolute;
  top: calc(0.75em - 1.5px);
  left: 7px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: currentColor;
}
.dq-remark .dq-strong {
  font-weight: 700;
  color: #39404d;
}
/* 별도 실비처럼 여러 줄로 적은 글은 줄바꿈 그대로 찍는다. */
.dq-rt {
  white-space: pre-line;
}

/* ── 아래 — 개발 기간·특기 사항(왼쪽) + 합계 상자(오른쪽), 위아래 짙은 선 사이 ── */
.dq-summary {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  border-top: 1px solid #3b424f;
  border-bottom: 1px solid #3b424f;
  break-inside: avoid;
}
.dq-info {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: 105px minmax(0, 1fr);
  align-content: start;
  row-gap: 12px;
  min-width: 0;
  padding: 12px 0;
}
.dq-info dd {
  min-width: 0;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.dq-info .dq-note {
  font-weight: 500;
  line-height: 1.4;
  white-space: pre-line;
}
.dq-totals {
  display: grid;
  flex: 0 0 220px;
  grid-template-columns: minmax(0, 1fr) auto;
  align-content: start;
  gap: 12px 8px;
  min-height: 87px;
  padding: 9px 14px;
  background: #eee;
}
.dq-totals dt {
  font-weight: 600;
}
/* tabular-nums 를 쓰지 않는다 — PDF 캡처(html2canvas)는 캔버스에 비례 숫자로 그려 숫자와 '원' 사이가 벌어진다. */
.dq-totals dd {
  font-weight: 700;
  text-align: right;
  white-space: nowrap;
}
</style>
