<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  DEVELOP_MILESTONE_STATUS_LABELS,
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_VAT_MODE_LABELS,
  DEVELOP_QUOTE_SUPPLIER,
  developBpPercent,
  developQuoteNo,
  developQuotePdfName,
  developQuoteXlsxName,
} from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { DevelopQuoteSheet, downloadElementsPdf } from '@sp/ui';
import { developRequestPath, useDevelopRequest } from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { downloadAuthedFile } from '../lib/download';
import { errorMessage } from '../lib/error-msg';
import { dateShort, dateTimeKst, won } from '../lib/format';

// 견적서 인쇄용(docs/DEVELOP_FLOW.md §5.1) — 셸이 없는 라우트(meta.bare)라 화면 자체가 종이다.
// 1쪽 = 참고 견적서 서식의 견적서(@sp/ui DevelopQuoteSheet — 관리자 미리보기·서버 엑셀과 같은 표),
// 2쪽(별지) = 결제 조건 표 · 개발 기간 · 산출물 · 검수 · 별도 실비 · 표준 조건. 데이터는 상세 응답에서 qid 견적 하나를
// 골라 쓴다(견적 단건 라우트가 없다 — 캐시도 상세와 공유한다). 엑셀은 서버가 같은 표로 만든다(GET …/quotes/:qid/xlsx).
//
// `?mode=contract` = **계약서 보기**(§2 결정 11 "견적 승인이 곧 계약") — 별도 계약 문서를 만들지 않고 수락된 견적서를
// 그대로 두고 별지 머리를 계약서로 바꾼 뒤 동의 기록·발주서·서명란을 덧붙인다. 수락 전 견적에는 뜻이 없으므로
// 그때는 안내만 띄우고 평범한 견적서로 그린다.
//
// PDF 내려받기(2026-11-04) — 화면의 1쪽 견적서 + 2쪽 별지(계약서 모드면 계약서)를 그대로 찍어 A4 PDF 로 저장한다
// (@sp/ui downloadElementsPdf — 상업송장 PDF 와 같은 화면 캡처 방식). 카드의 「PDF」는 이 화면을 `?download=pdf` 로 열어
// 그려지자마자 한 번 내려받는다(주소에서 그 쿼리는 지워 새로고침이 다시 받지 않게).

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const loggedIn = computed(() => auth.isLoggedIn);
const requestId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const quoteId = computed<number | null>(() => {
  const n = Number(route.params.qid);
  return Number.isInteger(n) && n > 0 ? n : null;
});

const detailQ = useDevelopRequest(requestId, loggedIn);
const detail = computed(() => detailQ.data.value?.data);
const quote = computed(() => detail.value?.quotes.find((q) => q.quoteId === quoteId.value));

const quoteNo = computed(() => {
  const q = quote.value;
  return q === undefined ? '' : developQuoteNo(q.requestId, q.version);
});
// 견적일자 = 발송일(KST). 상세 응답은 발송된 견적만 싣지만 방어로 오늘을 쓴다.
const issuedOn = computed(() => {
  const at = quote.value?.sentAt ?? null;
  return at === null ? dateShort(new Date().toISOString()) : dateShort(at);
});
const recipient = computed(() => {
  const d = detail.value;
  return {
    company: d?.contact.company ?? null,
    dept: quote.value?.recipientDept ?? null,
    name: d?.contact.name ?? '',
    phone: d?.contact.phone ?? '',
    email: d?.contact.email ?? '',
  };
});

// 수락 전에는 마일스톤이 전부 draft("작성 중")라 그 열은 종이 위에서 뜻 없는 문구가 된다 —
// 실제로 진행된 결제가 하나라도 있을 때만 상태 열을 낸다.
const showMilestoneStatus = computed(() => quote.value?.milestones.some((m) => m.status !== 'draft') ?? false);

// 계약서 모드 — 요청은 쿼리로, 성립은 견적 상태로 판정한다.
const contractAsked = computed(() => route.query.mode === 'contract');
const contract = computed(() => contractAsked.value && quote.value?.status === 'accepted');
const acceptedOn = computed(() => {
  const at = quote.value?.acceptedAt ?? null;
  return at === null ? '—' : dateTimeKst(at);
});

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function print(): void {
  window.print();
}

const xlsxBusy = ref(false);
const xlsxError = ref('');
async function downloadXlsx(): Promise<void> {
  const q = quote.value;
  if (q === undefined || xlsxBusy.value) return;
  xlsxBusy.value = true;
  xlsxError.value = '';
  try {
    await downloadAuthedFile(`${developRequestPath(q.requestId)}/quotes/${String(q.quoteId)}/xlsx`, developQuoteXlsxName(q));
  } catch (e) {
    xlsxError.value = errorMessage(e, '엑셀을 내려받지 못했습니다.');
  } finally {
    xlsxBusy.value = false;
  }
}

const sheetBox = ref<HTMLElement | null>(null);
const annexEl = ref<HTMLElement | null>(null);
const pdfBusy = ref(false);
const pdfError = ref('');
async function downloadPdf(): Promise<void> {
  const q = quote.value;
  if (q === undefined || pdfBusy.value) return;
  const sheet = sheetBox.value?.querySelector<HTMLElement>('[data-testid="develop-quote-sheet"]') ?? null;
  const pages = [sheet, annexEl.value].filter((el): el is HTMLElement => el !== null);
  pdfBusy.value = true;
  pdfError.value = '';
  try {
    await downloadElementsPdf(pages, developQuotePdfName(q));
  } catch (e) {
    pdfError.value = errorMessage(e, 'PDF를 만들지 못했습니다.');
  } finally {
    pdfBusy.value = false;
  }
}
// 카드에서 `?download=pdf` 로 열렸으면 견적서가 그려진 뒤 한 번만 내려받는다.
let autoPdfDone = false;
watch(
  quote,
  async (q) => {
    if (q === undefined || autoPdfDone || route.query.download !== 'pdf') return;
    autoPdfDone = true;
    const query = { ...route.query };
    delete query.download;
    await router.replace({ query });
    await nextTick();
    await downloadPdf();
  },
  { immediate: true },
);

// @page 는 문서 전역이라 들어올 때 붙이고 나갈 때 뗀다(의뢰 출력물은 PPT 4:3 을 따로 붙인다).
let pageStyle: HTMLStyleElement | null = null;
onMounted(() => {
  pageStyle = document.createElement('style');
  pageStyle.textContent = '@page { size: A4 portrait; margin: 12mm; }';
  document.head.appendChild(pageStyle);
});
onBeforeUnmount(() => {
  pageStyle?.remove();
  pageStyle = null;
});
</script>

<template>
  <main class="min-h-screen bg-paper py-8 print:bg-white print:py-0">
    <div v-if="!loggedIn" class="mx-auto max-w-[720px] rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">견적서는 로그인 후 확인할 수 있습니다.</p>
      <button type="button" class="mt-5 h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white" @click="goLogin">로그인</button>
    </div>

    <p v-else-if="detailQ.isPending.value" class="mx-auto max-w-[720px] px-6 py-16 text-center text-body text-tx-3">
      {{ $t('common.loading') }}
    </p>

    <div v-else-if="detailQ.isError.value || detail === undefined || quote === undefined" class="mx-auto max-w-[720px] rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body font-semibold text-red-700">
        {{ detailQ.isError.value ? errorMessage(detailQ.error.value, '견적서를 불러오지 못했습니다.') : '견적서를 찾을 수 없습니다.' }}
      </p>
      <RouterLink
        :to="`/requests/${String(requestId ?? 0)}`"
        class="mt-5 inline-block h-11 rounded-lg border border-line-2 px-6 text-body font-bold leading-[2.75rem] text-tx-2"
      >
        의뢰 상세로
      </RouterLink>
    </div>

    <template v-else>
      <!-- 도구 줄(종이에는 안 나온다) -->
      <div class="print-hidden mx-auto mb-4 flex w-full max-w-[210mm] flex-wrap items-center gap-2.5">
        <RouterLink
          :to="`/requests/${String(detail.requestId)}`"
          class="h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold leading-10 text-tx-2 transition hover:border-tx-3"
        >
          의뢰 상세로
        </RouterLink>
        <span v-if="xlsxError !== ''" role="alert" class="text-label font-semibold text-red-700">{{ xlsxError }}</span>
        <span v-if="pdfError !== ''" role="alert" class="text-label font-semibold text-red-700">{{ pdfError }}</span>
        <button
          type="button"
          class="ml-auto h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold text-tx-2 transition hover:border-tx-3 disabled:opacity-50"
          :disabled="xlsxBusy"
          @click="downloadXlsx"
        >
          {{ xlsxBusy ? '내려받는 중…' : '엑셀 내려받기' }}
        </button>
        <button
          type="button"
          class="h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold text-tx-2 transition hover:border-tx-3 disabled:opacity-50"
          :disabled="pdfBusy"
          @click="downloadPdf"
        >
          {{ pdfBusy ? 'PDF 만드는 중…' : 'PDF 내려받기' }}
        </button>
        <button
          type="button"
          class="h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600"
          @click="print"
        >
          인쇄
        </button>
      </div>

      <p
        v-if="contractAsked && !contract"
        class="print-hidden mx-auto mb-4 w-full max-w-[210mm] text-label font-semibold text-amber-800"
      >
        계약서는 수락된 견적서에서만 볼 수 있습니다 — 아래는 견적서 원본입니다.
      </p>

      <!-- 1쪽 — 견적서 -->
      <div ref="sheetBox" class="mx-auto w-fit shadow-sm print:w-auto print:shadow-none">
        <DevelopQuoteSheet :quote="quote" :recipient="recipient" :quote-no="quoteNo" :issued-on="issuedOn" />
      </div>

      <!-- 2쪽 — 별지(계약서 모드면 계약서) -->
      <article
        ref="annexEl"
        class="quote-annex mx-auto mt-6 box-border w-[210mm] bg-white p-[12mm] text-tx-1 shadow-sm print:mt-0 print:w-auto print:p-0 print:shadow-none"
      >
        <header class="flex flex-wrap items-end gap-4 border-b-2 border-ink-950 pb-4">
          <div class="grid gap-1">
            <h1 class="text-title font-extrabold tracking-tight">{{ contract ? '개발 용역 계약서' : '견적서 별지' }}</h1>
            <p class="text-label text-tx-3">
              견적서 {{ quoteNo }} · {{ quote.title }}
            </p>
          </div>
          <p v-if="contract" class="ml-auto text-label text-tx-3">계약일 <span class="font-mono tabular-nums">{{ acceptedOn.slice(0, 10) }}</span></p>
        </header>

        <p class="mt-4 text-body text-tx-2">
          <template v-if="contract">
            견적서 {{ quoteNo }}의 내용과 아래 조건에 고객이 동의하여 계약이 성립되었습니다. 의뢰
          </template>
          <template v-else>견적서 {{ quoteNo }}의 결제 조건과 진행 조건입니다. 의뢰 </template>
          <span class="font-bold text-tx-1">#{{ detail.requestId }} {{ detail.title }}</span>
        </p>

        <!-- 결제 조건 -->
        <section v-if="quote.milestones.length > 0" class="mt-6 break-inside-avoid">
          <h2 class="text-label font-bold text-tx-3">결제 조건</h2>
          <table class="mt-2 w-full border-collapse text-body">
            <thead>
              <tr class="border-b border-line text-label text-tx-3">
                <th class="py-2 text-left font-semibold">명칭</th>
                <th class="w-16 py-2 text-right font-semibold">비율</th>
                <th class="w-32 py-2 text-right font-semibold">금액</th>
                <th class="w-36 py-2 pl-3 text-left font-semibold">청구 시점</th>
                <th v-if="showMilestoneStatus" class="w-20 py-2 text-right font-semibold">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in quote.milestones" :key="m.milestoneId" class="border-b border-line">
                <td class="py-2 pr-3 font-bold">{{ m.title }}</td>
                <td class="py-2 text-right font-mono tabular-nums text-tx-2">
                  {{ m.ratioBp === null ? '—' : `${developBpPercent(m.ratioBp)}%` }}
                </td>
                <td class="py-2 text-right font-mono tabular-nums">{{ won(m.amount) }}</td>
                <td class="py-2 pl-3 text-label text-tx-2">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }}</td>
                <td v-if="showMilestoneStatus" class="py-2 text-right text-label text-tx-2">{{ DEVELOP_MILESTONE_STATUS_LABELS[m.status] }}</td>
              </tr>
            </tbody>
          </table>
          <p class="mt-1.5 text-micro text-tx-3">결제 금액은 최종 견적 합계({{ won(quote.totalAmount) }}, {{ DEVELOP_VAT_MODE_LABELS[quote.vatMode] }})를 비율로 나눈 금액입니다.</p>
        </section>

        <!-- 기간 · 산출물 · 실비 -->
        <dl class="mt-6 grid gap-3 break-inside-avoid text-body sm:grid-cols-[120px_1fr]">
          <dt class="text-label font-bold text-tx-3">개발 기간</dt>
          <dd>
            <template v-if="quote.durationDays !== null">{{ quote.durationDays }}일</template>
            <template v-else-if="quote.scheduleNote === null">협의</template>
            <template v-if="quote.scheduleNote !== null">
              <span v-if="quote.durationDays !== null"> · </span>{{ quote.scheduleNote }}
            </template>
          </dd>

          <dt class="text-label font-bold text-tx-3">산출물</dt>
          <dd>
            <ul v-if="quote.deliverables.length > 0" class="grid gap-0.5">
              <li v-for="d in quote.deliverables" :key="d">· {{ d }}</li>
            </ul>
            <span v-else class="text-tx-3">협의</span>
          </dd>

          <dt class="text-label font-bold text-tx-3">검수 · 하자보수</dt>
          <dd>
            납품 후 {{ quote.reviewDays }}일 검수<template v-if="quote.warrantyDays !== null"> · 하자보수 {{ quote.warrantyDays }}일</template>
          </dd>

          <template v-if="quote.exclusions !== null">
            <dt class="text-label font-bold text-tx-3">별도 실비</dt>
            <dd class="whitespace-pre-wrap leading-relaxed">{{ quote.exclusions }}</dd>
          </template>
        </dl>

        <!-- 표준 조건 -->
        <section class="mt-6 break-inside-avoid border-t border-line pt-4">
          <h2 class="text-label font-bold text-tx-3">표준 조건</h2>
          <p class="mt-2 whitespace-pre-wrap text-label leading-relaxed text-tx-2">{{ quote.terms }}</p>
        </section>

        <!-- ── 계약서 모드에만 붙는 것 ── -->
        <template v-if="contract">
          <!-- 동의 기록(수락 = 계약, §2 결정 11) -->
          <section class="mt-6 break-inside-avoid border-t border-line pt-4">
            <h2 class="text-label font-bold text-tx-3">계약 동의 기록</h2>
            <dl class="mt-2 grid gap-2 text-body sm:grid-cols-[120px_1fr]">
              <dt class="text-label font-bold text-tx-3">수락 일시</dt>
              <dd class="font-mono tabular-nums">{{ acceptedOn }}</dd>
              <dt class="text-label font-bold text-tx-3">수락자</dt>
              <dd>{{ quote.acceptedName ?? detail.contact.name }}</dd>
              <dt class="text-label font-bold text-tx-3">동의 내용</dt>
              <dd>위 표준 조건에 동의하여 수락함</dd>
              <template v-if="quote.poFile !== null">
                <dt class="text-label font-bold text-tx-3">발주서</dt>
                <dd>{{ quote.poFile.name }}</dd>
              </template>
            </dl>
          </section>

          <!-- 서명란(오프라인 날인·전자서명용) -->
          <section class="mt-6 break-inside-avoid">
            <h2 class="text-label font-bold text-tx-3">서명</h2>
            <div class="mt-2 grid gap-4 sm:grid-cols-2">
              <dl class="grid gap-2 border border-line p-4 text-body">
                <dt class="text-label font-bold text-tx-3">고객사</dt>
                <dd>회사명 · {{ detail.contact.company ?? '—' }}</dd>
                <dd>대표 / 담당자 · {{ quote.acceptedName ?? detail.contact.name }}</dd>
                <dd class="pt-6 text-tx-3">서명일 __________________ (서명 / 인)</dd>
              </dl>
              <dl class="grid gap-2 border border-line p-4 text-body">
                <dt class="text-label font-bold text-tx-3">{{ DEVELOP_QUOTE_SUPPLIER.name }}</dt>
                <dd>담당자 · {{ DEVELOP_QUOTE_SUPPLIER.managerName }}</dd>
                <dd>대표자 · {{ DEVELOP_QUOTE_SUPPLIER.owner }}</dd>
                <dd class="pt-6 text-tx-3">서명일 __________________ (서명 / 인)</dd>
              </dl>
            </div>
            <p class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-label text-tx-2">
              <span>체결 상태 ·</span>
              <span>☐ 전자서명</span>
              <span>☐ 날인본</span>
              <span>☐ 착수금 확인</span>
            </p>
          </section>

          <p class="mt-8 text-label text-tx-3">
            본 계약서는 견적서 {{ quoteNo }}의 내용과 표준 조건을 그대로 따릅니다. 금액은 원화(KRW) 기준이며
            {{ DEVELOP_VAT_MODE_LABELS[quote.vatMode] }}입니다. 서명란은 별도 날인이 필요한 경우에만 사용합니다.
          </p>
        </template>

        <p v-else class="mt-8 text-label text-tx-3">
          본 견적서는 {{ quote.validUntil }}까지 유효합니다. 금액은 원화(KRW) 기준이며 {{ DEVELOP_VAT_MODE_LABELS[quote.vatMode] }}입니다.
        </p>
      </article>
    </template>
  </main>
</template>

<style scoped>
@media print {
  .quote-annex {
    break-before: page;
  }
}
</style>
