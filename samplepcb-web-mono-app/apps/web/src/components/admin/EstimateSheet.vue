<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminEstimateType } from '@sp/api-contract';
import { formatKrw } from '../../lib/format';
import { pcbSpecEntries } from '../../lib/pcb-spec';
import type { PcbSpecEntry } from '../../lib/pcb-spec';

// 견적서(A4) 순수 표시 컴포넌트 — props 로 데이터를 주입받기만 하고 fetch 하지 않는다
// (향후 고객용 견적서 라우트에서 재사용 가능하도록). 인쇄 여백은 .sheet 패딩이 담당하고
// (EstimateModal 의 @page margin:0), 수기 편집 필드는 인쇄 시 테두리를 숨긴다.
// 모양은 Figma 「PCB 견적서」(2428:36055, 794×1123 = A4 96dpi) — 치수는 시안 px 그대로다.
// 시안과 다르게 둔 것(사양 사전·프로젝트명·출고예정일·배송비 문구)은 docs/FIGMA_PAGES.md.
const props = defineProps<{ estimate: AdminEstimateType }>();
const { t } = useI18n();

// 인쇄 전 일회성 보정용 수기 필드(저장 없음). 수신처는 서버 해석값(회사명 2층: 스냅샷
// ?? 회원 프로필)·applicant 로 초기화하되 언제든 덮어쓸 수 있게 전부 input 으로 둔다.
// 시트 안 수기 편집은 저장하지 않는 일회성 덮어쓰기다(저장은 드로어의 회사명 행이 담당).
const recipientCompany = ref(props.estimate.companyName ?? '');
const recipientDept = ref('');
const recipientName = ref(props.estimate.applicant?.name ?? '');
const recipientPhone = ref(props.estimate.applicant?.phone ?? '');
const recipientEmail = ref(props.estimate.applicant?.email ?? '');
const note = ref('');

// public/img/* — base('/app/') 를 붙여 dev/prod 양쪽에서 맞는 절대경로를 만든다.
// 로고·직인은 시안 자산이다(BOM 견적서·주문서는 아직 logo.png·stamp.jpg 를 쓴다).
const stampSrc = `${import.meta.env.BASE_URL}img/stamp.png`;
const logoSrc = `${import.meta.env.BASE_URL}img/logo.svg`;

const itemName = computed(() =>
  props.estimate.projectName !== ''
    ? props.estimate.projectName
    : t('admin.quotes.estimate.defaultItemName'),
);

// 단가 = round(합계/수량) — 참고값. 반올림 불일치가 나도 금액(합계)이 기준이다.
const unitPrice = computed<number | null>(() => {
  const a = props.estimate.amounts;
  if (a === null || props.estimate.qty <= 0) return null;
  return Math.round(a.total / props.estimate.qty);
});

// 가격 미확정(rfq)이면 금액 칸은 전부 '별도 협의'.
const priceText = (price: number | null | undefined): string =>
  price === null || price === undefined ? t('admin.quotes.estimate.amountRfq') : formatKrw(price);

const supplierAddr = computed(() => {
  const c = props.estimate.company;
  return c.zip !== '' ? `(${c.zip}) ${c.addr}` : c.addr;
});

// 사양 표 — 명칭·순서·선택지 표시명은 거버 앱이 정본(lib/pcb-spec.ts, Case 상세와 같은 사전).
// 항목이 카테고리마다 다르므로 category·orderCategory·kindPcb 로 세트를 고른다. 2열 줄무늬가
// 행 단위로 맞도록 홀수 개면 빈 칸 하나로 짝을 맞춘다.
const specCells = computed<(PcbSpecEntry | null)[]>(() => {
  const spec = props.estimate.spec as Record<string, unknown>;
  const cells: (PcbSpecEntry | null)[] = pcbSpecEntries(spec, {
    category: props.estimate.category,
    orderCategory: props.estimate.orderCategory,
    kindPcb: typeof spec.kindPcb === 'string' ? spec.kindPcb : null,
  });
  if (cells.length % 2 === 1) cells.push(null);
  return cells;
});

// 출고예정일 — 견적 생성 시점에 박제된 값(sp_quote.eta 'YYYY.MM.DD')을 문서 표기로만 바꾼다.
// 날짜 꼴이 아니면(가격표가 문구를 내려준 경우) 원문 그대로 둔다.
const etaText = computed(() => {
  const eta = (props.estimate.eta ?? '').trim();
  return /^\d{4}\.\d{2}\.\d{2}$/.test(eta) ? eta.replace(/\./g, '-') : eta;
});

// 결제계좌 — 영카트 de_bank_account 는 여러 줄(은행·계좌 / 예금주)이다. 첫 줄만 굵게 찍는다.
const bankLines = computed(() =>
  props.estimate.company.bankAccount
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== ''),
);
</script>

<template>
  <div class="sheet">
    <div class="head">
      <h1 class="title">{{ t('admin.quotes.estimate.title') }}</h1>
      <img :src="logoSrc" alt="SAMPLEPCB" class="logo" width="125" height="39">
    </div>

    <dl class="meta">
      <div class="meta-item">
        <dt>{{ t('admin.quotes.estimate.no') }}</dt>
        <dd>{{ props.estimate.estimateNo }}</dd>
      </div>
      <div class="meta-item">
        <dt>{{ t('admin.quotes.estimate.issuedAt') }}</dt>
        <dd>{{ props.estimate.issuedAt }}</dd>
      </div>
      <div class="meta-item">
        <dt>{{ t('admin.quotes.estimate.validUntil') }}</dt>
        <dd>{{ props.estimate.validUntil }}</dd>
      </div>
    </dl>

    <div class="parties">
      <!-- 수신 — 전부 수기(applicant 로 초기화) -->
      <section class="party">
        <h3 class="party-head">{{ t('admin.quotes.estimate.recipient') }}</h3>
        <dl class="fields">
          <dt>{{ t('admin.quotes.estimate.recipientCompany') }}</dt>
          <dd>
            <input
              v-model="recipientCompany"
              class="hw"
              type="text"
              :aria-label="t('admin.quotes.estimate.recipientCompany')"
            >
          </dd>
          <dt>{{ t('admin.quotes.estimate.recipientDept') }}</dt>
          <dd>
            <input
              v-model="recipientDept"
              class="hw"
              type="text"
              :aria-label="t('admin.quotes.estimate.recipientDept')"
            >
          </dd>
          <dt>{{ t('admin.quotes.estimate.recipientName') }}</dt>
          <dd>
            <input
              v-model="recipientName"
              class="hw"
              type="text"
              :aria-label="t('admin.quotes.estimate.recipientName')"
            >
          </dd>
          <dt>{{ t('admin.quotes.estimate.recipientContact') }}</dt>
          <dd>
            <input
              v-model="recipientPhone"
              class="hw"
              type="text"
              :aria-label="t('admin.quotes.estimate.recipientContact')"
            >
          </dd>
          <dt>{{ t('admin.quotes.estimate.recipientEmail') }}</dt>
          <dd>
            <input
              v-model="recipientEmail"
              class="hw"
              type="text"
              :aria-label="t('admin.quotes.estimate.recipientEmail')"
            >
          </dd>
        </dl>
      </section>

      <!-- 발신 — g5_shop_default 재사용 + 도장. 대표전화는 담당자 이름 옆에 붙인다(시안). -->
      <section class="party">
        <h3 class="party-head">{{ t('admin.quotes.estimate.supplier') }}</h3>
        <div class="stamp-box">
          <img :src="stampSrc" alt="" class="stamp" width="48" height="46">
        </div>
        <dl class="fields">
          <dt>{{ t('admin.quotes.estimate.supplierName') }}</dt>
          <dd class="by-stamp">{{ props.estimate.company.name }}</dd>
          <dt>{{ t('admin.quotes.estimate.supplierOwner') }}</dt>
          <dd class="by-stamp">{{ props.estimate.company.owner }}</dd>
          <dt class="multi">{{ t('admin.quotes.estimate.supplierAddr') }}</dt>
          <dd class="multi">{{ supplierAddr }}</dd>
          <dt>{{ t('admin.quotes.estimate.supplierManager') }}</dt>
          <dd class="contact">
            <span>{{ props.estimate.company.managerName }}</span>
            <span>{{ props.estimate.company.tel }}</span>
          </dd>
          <dt>{{ t('admin.quotes.estimate.supplierEmail') }}</dt>
          <dd>{{ props.estimate.company.managerEmail }}</dd>
        </dl>
      </section>
    </div>

    <!-- 품목표 -->
    <table class="items">
      <colgroup>
        <col class="col-no">
        <col class="col-name">
        <col class="col-spec">
        <col class="col-qty">
        <col class="col-price">
        <col>
      </colgroup>
      <thead>
        <tr>
          <th>{{ t('admin.quotes.estimate.itemNo') }}</th>
          <th>{{ t('admin.quotes.estimate.itemName') }}</th>
          <th>{{ t('admin.quotes.estimate.itemSpec') }}</th>
          <th>{{ t('admin.quotes.estimate.itemQty') }}</th>
          <th>{{ t('admin.quotes.estimate.itemUnitPrice') }}</th>
          <th>{{ t('admin.quotes.estimate.itemAmount') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>1</td>
          <td class="text">{{ itemName }}</td>
          <td class="text">{{ props.estimate.optionSummary }}</td>
          <td>{{ props.estimate.qty }}</td>
          <td>{{ priceText(unitPrice) }}</td>
          <td>{{ priceText(props.estimate.amounts?.total) }}</td>
        </tr>
      </tbody>
    </table>

    <div class="note-row">
      <span class="note-label">{{ t('admin.quotes.estimate.note') }}</span>
      <input
        v-model="note"
        class="hw"
        type="text"
        :aria-label="t('admin.quotes.estimate.note')"
        :placeholder="t('admin.quotes.estimate.notePlaceholder')"
      >
    </div>

    <!-- 사양 — 2열. 머리줄도 열마다 따로 긋는다(시안: 가운데 간격에서 끊긴다). -->
    <section v-if="specCells.length > 0" class="spec">
      <h3 class="spec-head">{{ t('admin.quotes.estimate.specTitle') }}</h3>
      <div class="spec-head" aria-hidden="true" />
      <div v-for="(cell, i) in specCells" :key="cell?.key ?? `blank-${i}`" class="spec-cell">
        <template v-if="cell !== null">
          <span class="k">{{ cell.label }}</span>
          <span class="v">{{ cell.display }}</span>
        </template>
      </div>
    </section>

    <!-- 하단: 출고예정일·결제계좌(빈 값이면 생략) + 금액(부가세 역산) -->
    <div class="summary">
      <dl class="summary-info">
        <template v-if="etaText !== ''">
          <dt>{{ t('admin.quotes.estimate.etaLabel') }}</dt>
          <dd>{{ etaText }}</dd>
        </template>
        <template v-if="bankLines.length > 0">
          <dt>{{ t('admin.quotes.estimate.bankLabel') }}</dt>
          <dd>
            <p v-for="line in bankLines" :key="line" class="bank-line">{{ line }}</p>
          </dd>
        </template>
      </dl>
      <dl class="totals">
        <dt>{{ t('admin.quotes.estimate.supply') }}</dt>
        <dd>{{ priceText(props.estimate.amounts?.supply) }}</dd>
        <dt>{{ t('admin.quotes.estimate.vat') }}</dt>
        <dd>{{ priceText(props.estimate.amounts?.vat) }}</dd>
        <dt>{{ t('admin.quotes.estimate.total') }}</dt>
        <dd>{{ priceText(props.estimate.amounts?.total) }}</dd>
      </dl>
    </div>
  </div>
</template>

<style scoped>
/* A4 — 정확값 297mm 는 브라우저 반올림으로 2페이지가 되는 함정이라 미리보기 min-height 는
   296mm. 인쇄 시엔 min-height 를 풀어 내용만큼만 차지하게 한다(@media print).
   좌 50 · 우 54 여백은 시안 그대로(본문 폭 690). 배경색(머리띠·줄무늬·합계 상자)은 인쇄
   '배경 그래픽' 을 꺼도 찍히도록 print-color-adjust 를 건다. */
.sheet {
  width: 210mm;
  min-height: 296mm;
  padding: 44px 54px 50px 50px;
  background: #fff;
  color: #39404d;
  font-family: Pretendard, 'Pretendard Variable', 'Noto Sans KR', 'Malgun Gothic', '맑은 고딕',
    sans-serif;
  font-size: 13px;
  line-height: 14px;
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
/* 시안 자간은 전부 -4% — em 은 선언한 요소의 글자 크기로 굳어 상속되므로 요소마다 건다. */
.sheet,
.sheet * {
  box-sizing: border-box;
  letter-spacing: -0.04em;
}
/* :where 로 명시도를 낮춰 아래 블록별 여백이 이긴다 */
.sheet :where(dl, dt, dd, p, h1, h3) {
  margin: 0;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 42px;
}
.title {
  font-family: 'Noto Sans KR', Pretendard, sans-serif;
  font-size: 32px;
  font-weight: 700;
  line-height: 1.3;
  color: #061023;
}
.logo {
  flex-shrink: 0;
  width: 125px;
  height: 39px;
  margin-top: 2px;
}

.meta {
  display: flex;
  gap: 24px;
  margin-top: 44px;
  font-size: 12px;
}
.meta-item {
  display: flex;
  gap: 6px;
}
.meta dt {
  color: #646464;
}
.meta dd {
  font-weight: 500;
  color: #191919;
}

.parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  margin-top: 14px;
}
.party {
  position: relative;
  min-height: 221px;
  border: 1px solid #d9d9d9;
  break-inside: avoid;
}
.party-head {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 34px;
  border-bottom: 1px solid #d9d9d9;
  background: #eee;
  font-size: 12px;
  font-weight: 700;
}
.fields {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 14px;
  padding: 20px 20px 18px 19px;
  line-height: 1.1;
}
.fields dt {
  color: #646464;
}
.fields dd {
  min-width: 0;
  font-weight: 500;
  color: #191919;
  overflow-wrap: anywhere;
}
/* 여러 줄로 흐르는 값(주소)은 줄 간격을 넓히고, 라벨도 첫 줄에 맞춘다 */
.fields .multi {
  line-height: 1.3;
}
.fields .contact {
  display: flex;
  flex-wrap: wrap;
  column-gap: 8px;
}
/* 직인 자리(우상단 50×50)와 겹치는 두 행은 값을 그 앞에서 접는다 */
.fields .by-stamp {
  padding-right: 60px;
}
.stamp-box {
  position: absolute;
  top: 50px;
  right: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 50px;
  height: 50px;
  border: 1px solid #f3f3f3;
  border-radius: 9px;
}
.stamp {
  width: 48px;
  height: 46px;
  object-fit: cover;
}

/* 수기 필드 — 화면엔 옅은 점선 밑줄, 인쇄 시 밑줄·placeholder 숨김. 밑줄과 위아래 여유는
   음수 여백으로 상쇄해 줄 높이(시안 행 간격)를 건드리지 않는다. */
.hw {
  display: block;
  width: 100%;
  min-width: 0;
  margin: -2px 0 -3px;
  padding: 2px 0;
  border: 0;
  border-bottom: 1px dashed #c4c7cc;
  border-radius: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  outline: none;
}
.hw::placeholder {
  color: #b5b8bd;
}

/* 품목표 — 바깥 테두리·머리줄은 짙게, 열 구분선은 옅게(시안). 선 색이 달라 separate 로 긋는다. */
.items {
  width: 100%;
  margin-top: 20px;
  border: 1px solid #39404d;
  border-collapse: separate;
  border-spacing: 0;
  table-layout: fixed;
  font-size: 12px;
}
.items th {
  height: 33px;
  padding: 0;
  border-bottom: 1px solid #3b424f;
  background: #fbfbfb;
  font-weight: 400;
  text-align: center;
}
.items td {
  height: 55px;
  padding: 8px 10px;
  font-weight: 500;
  line-height: 1.3;
  color: #000;
  text-align: center;
  vertical-align: middle;
  overflow-wrap: anywhere;
}
.items th + th,
.items td + td {
  border-left: 1px solid #d9d9d9;
}
.items td.text {
  text-align: left;
}
.items .col-no {
  width: 51px;
}
.items .col-name {
  width: 242px;
}
.items .col-spec {
  width: 153px;
}
.items .col-qty {
  width: 53px;
}
.items .col-price {
  width: 95px;
}
.items tr {
  break-inside: avoid;
}

.note-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-top: 12px;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.4;
}
.note-label {
  position: relative;
  flex-shrink: 0;
  padding-left: 16.5px;
  color: #75777d;
}
.note-label::before {
  content: '';
  position: absolute;
  top: 50%;
  left: 7px;
  width: 3px;
  height: 3px;
  margin-top: -1.5px;
  border-radius: 50%;
  background: currentColor;
}

.spec {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 20px;
  margin-top: 14px;
}
.spec-head {
  display: flex;
  align-items: center;
  height: 34px;
  border-bottom: 1px solid #a1a3a8;
  font-size: 14px;
  font-weight: 700;
}
.spec-cell {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
  padding: 8px 12px;
  border-bottom: 1px solid #ececec;
  break-inside: avoid;
}
/* 줄무늬는 행 단위 — 머리 2칸 다음부터 두 칸씩 번갈아 칠한다 */
.spec-cell:nth-child(4n + 3),
.spec-cell:nth-child(4n + 4) {
  background: #fbfbfb;
}
.spec-cell .k {
  flex-shrink: 0;
  font-size: 12px;
}
.spec-cell .v {
  min-width: 0;
  font-weight: 600;
  text-align: right;
  overflow-wrap: anywhere;
}

.summary {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  border-top: 1px solid #3b424f;
  border-bottom: 1px solid #3b424f;
  font-size: 12px;
  break-inside: avoid;
}
.summary-info {
  display: grid;
  flex: 1;
  grid-template-columns: 105px minmax(0, 1fr);
  align-content: start;
  row-gap: 12px;
  min-width: 0;
  padding: 12px 16px 12px 0;
}
.summary-info dd {
  font-weight: 700;
}
/* 계좌 문자열의 띄어쓰기(은행명과 번호 사이 두 칸)를 그대로 살린다 */
.bank-line {
  white-space: pre-wrap;
}
.bank-line + .bank-line {
  margin-top: 6px;
  font-weight: 500;
}
.totals {
  display: grid;
  flex-shrink: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-content: start;
  row-gap: 12px;
  width: 240px;
  min-height: 88px;
  padding: 9px 11px 9px 15px;
  background: #eee;
}
.totals dt {
  font-weight: 600;
}
.totals dd {
  font-weight: 700;
  text-align: right;
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
