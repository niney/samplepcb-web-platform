<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { AdminEstimateType } from '@sp/api-contract';
import { formatKrw } from '../../lib/format';

// 견적서(A4) 순수 표시 컴포넌트 — props 로 데이터를 주입받기만 하고 fetch 하지 않는다
// (향후 고객용 견적서 라우트에서 재사용 가능하도록). 인쇄 여백은 .sheet 패딩이 담당하고
// (EstimateModal 의 @page margin:0), 수기 편집 필드는 인쇄 시 테두리를 숨긴다.
const props = defineProps<{ estimate: AdminEstimateType }>();
// te 는 구조분해하면 unbound-method(lint) — 컴포저 인스턴스로 호출한다
const i18n = useI18n();
const { t } = i18n;

// 인쇄 전 일회성 보정용 수기 필드(저장 없음). 수신처는 applicant 로 초기화하되 언제든
// 덮어쓸 수 있게 전부 input 으로 둔다(applicant 가 null 이면 빈칸에서 시작).
const recipientCompany = ref('');
const recipientDept = ref('');
const recipientName = ref(props.estimate.applicant?.name ?? '');
const recipientPhone = ref(props.estimate.applicant?.phone ?? '');
const recipientEmail = ref(props.estimate.applicant?.email ?? '');
const note = ref('');

// public/img/stamp.jpg — base('/app/') 를 붙여 dev/prod 양쪽에서 맞는 절대경로를 만든다.
const stampSrc = `${import.meta.env.BASE_URL}img/stamp.jpg`;

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

const supplierAddr = computed(() => {
  const c = props.estimate.company;
  return c.zip !== '' ? `(${c.zip}) ${c.addr}` : c.addr;
});

// 사양 표 — 알려진 키는 라벨링(i18n specKeys), 미등록 키는 원문 그대로(계약 catchall
// 대응). QuoteDetailDrawer.vue 와 동일 로직.
const specEntries = computed<[string, string][]>(() =>
  Object.entries(props.estimate.spec)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => [
      i18n.te(`admin.quotes.specKeys.${key}`) ? t(`admin.quotes.specKeys.${key}`) : key,
      String(value),
    ]),
);
</script>

<template>
  <div class="sheet">
    <h1 class="title">{{ t('admin.quotes.estimate.title') }}</h1>

    <div class="meta">
      <div>
        <span class="mk">{{ t('admin.quotes.estimate.no') }}</span>{{ props.estimate.estimateNo }}
      </div>
      <div>
        <span class="mk">{{ t('admin.quotes.estimate.issuedAt') }}</span>{{ props.estimate.issuedAt }}
      </div>
      <div>
        <span class="mk">{{ t('admin.quotes.estimate.validUntil') }}</span>{{ props.estimate.validUntil }}
      </div>
    </div>

    <div class="parties">
      <!-- 수신 — 전부 수기(applicant 로 초기화) -->
      <section class="party">
        <h3>{{ t('admin.quotes.estimate.recipient') }}</h3>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.recipientCompany') }}</span>
          <input v-model="recipientCompany" class="hw" type="text">
        </div>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.recipientDept') }}</span>
          <input v-model="recipientDept" class="hw" type="text">
        </div>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.recipientName') }}</span>
          <input v-model="recipientName" class="hw" type="text">
        </div>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.recipientContact') }}</span>
          <input v-model="recipientPhone" class="hw" type="text">
        </div>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.recipientEmail') }}</span>
          <input v-model="recipientEmail" class="hw" type="text">
        </div>
      </section>

      <!-- 발신 — g5_shop_default 재사용 + 도장 -->
      <section class="party">
        <h3>{{ t('admin.quotes.estimate.supplier') }}</h3>
        <div class="row supplier-head">
          <span class="k">{{ t('admin.quotes.estimate.supplierName') }}</span>
          <span class="v">{{ props.estimate.company.name }}</span>
          <img :src="stampSrc" alt="" class="stamp">
        </div>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.supplierOwner') }}</span>
          <span class="v">{{ props.estimate.company.owner }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.supplierAddr') }}</span>
          <span class="v">{{ supplierAddr }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.supplierTel') }}</span>
          <span class="v">{{ props.estimate.company.tel }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.supplierManager') }}</span>
          <span class="v">{{ props.estimate.company.managerName }}</span>
        </div>
        <div class="row">
          <span class="k">{{ t('admin.quotes.estimate.supplierEmail') }}</span>
          <span class="v">{{ props.estimate.company.managerEmail }}</span>
        </div>
      </section>
    </div>

    <!-- 품목표 -->
    <table class="items">
      <thead>
        <tr>
          <th class="col-no">{{ t('admin.quotes.estimate.itemNo') }}</th>
          <th>{{ t('admin.quotes.estimate.itemName') }}</th>
          <th>{{ t('admin.quotes.estimate.itemSpec') }}</th>
          <th class="col-qty">{{ t('admin.quotes.estimate.itemQty') }}</th>
          <th class="col-price">{{ t('admin.quotes.estimate.itemUnitPrice') }}</th>
          <th class="col-amount">{{ t('admin.quotes.estimate.itemAmount') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="num">1</td>
          <td>{{ itemName }}</td>
          <td>{{ props.estimate.optionSummary }}</td>
          <td class="num">{{ props.estimate.qty }}</td>
          <td class="num">
            {{ unitPrice !== null ? formatKrw(unitPrice) : t('admin.quotes.estimate.amountRfq') }}
          </td>
          <td class="num">
            {{
              props.estimate.amounts !== null
                ? formatKrw(props.estimate.amounts.total)
                : t('admin.quotes.estimate.amountRfq')
            }}
          </td>
        </tr>
      </tbody>
    </table>

    <div class="note-row">
      <span class="k">{{ t('admin.quotes.estimate.note') }}</span>
      <input
        v-model="note"
        class="hw"
        type="text"
        :placeholder="t('admin.quotes.estimate.notePlaceholder')"
      >
    </div>

    <!-- 사양 -->
    <h3 class="section-title">{{ t('admin.quotes.estimate.specTitle') }}</h3>
    <div class="spec-grid">
      <div v-for="[label, value] in specEntries" :key="label" class="spec-item">
        <span class="k">{{ label }}</span>
        <span class="v">{{ value }}</span>
      </div>
    </div>

    <!-- 금액 (부가세 역산) -->
    <table class="amounts">
      <tbody>
        <tr>
          <td class="k">{{ t('admin.quotes.estimate.supply') }}</td>
          <td class="num">
            {{
              props.estimate.amounts !== null
                ? formatKrw(props.estimate.amounts.supply)
                : t('admin.quotes.estimate.amountRfq')
            }}
          </td>
        </tr>
        <tr>
          <td class="k">{{ t('admin.quotes.estimate.vat') }}</td>
          <td class="num">
            {{
              props.estimate.amounts !== null
                ? formatKrw(props.estimate.amounts.vat)
                : t('admin.quotes.estimate.amountRfq')
            }}
          </td>
        </tr>
        <tr class="total">
          <td class="k">{{ t('admin.quotes.estimate.total') }}</td>
          <td class="num">
            {{
              props.estimate.amounts !== null
                ? formatKrw(props.estimate.amounts.total)
                : t('admin.quotes.estimate.amountRfq')
            }}
          </td>
        </tr>
      </tbody>
    </table>

    <!-- 하단 안내: 출고 예정 · 결제계좌(빈 값이면 생략) · 배송비 -->
    <div class="footer-notes">
      <p v-if="props.estimate.eta !== null">
        {{ t('admin.quotes.estimate.etaLabel') }}: {{ props.estimate.eta }}
      </p>
      <p v-if="props.estimate.company.bankAccount !== ''">
        {{ t('admin.quotes.estimate.bankLabel') }}: {{ props.estimate.company.bankAccount }}
      </p>
      <p>{{ t('admin.quotes.estimate.shippingNotice') }}</p>
    </div>
  </div>
</template>

<style scoped>
/* A4 — 정확값 297mm 는 브라우저 반올림으로 2페이지가 되는 함정이라 미리보기 min-height 는
   296mm. 인쇄 시엔 min-height 를 풀어 내용만큼만 차지하게 한다(@media print). */
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
/* 수기 필드 — 화면엔 옅은 밑줄, 인쇄 시 밑줄·placeholder 숨김 */
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
  font-size: 9.5pt;
}
.items th,
.items td {
  border: 1px solid #888;
  padding: 2mm;
  text-align: left;
}
/* th 배경은 있어도/없어도 성립 — 인쇄 '배경 그래픽' 을 꺼도 테두리로 헤더가 구분된다 */
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
.items .col-price {
  width: 26mm;
}
.items .col-amount {
  width: 30mm;
}
.note-row {
  display: flex;
  align-items: center;
  gap: 2mm;
  margin-bottom: 5mm;
  font-size: 9.5pt;
}
.note-row .k {
  width: 18mm;
  flex-shrink: 0;
  color: #555;
}
.section-title {
  margin: 0 0 2mm;
  padding-left: 2mm;
  border-left: 3px solid #333;
  font-size: 10pt;
  font-weight: 700;
}
.spec-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 6mm;
  margin-bottom: 5mm;
  font-size: 9pt;
}
.spec-item {
  display: flex;
  justify-content: space-between;
  gap: 2mm;
  padding: 1mm 0;
  border-bottom: 1px solid #eee;
}
.spec-item .k {
  color: #555;
}
.spec-item .v {
  text-align: right;
  word-break: break-all;
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
  .hw {
    border-bottom-color: transparent;
  }
  .hw::placeholder {
    color: transparent;
  }
}
</style>
