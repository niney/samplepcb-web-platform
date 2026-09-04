<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import {
  DEVELOP_MILESTONE_STATUS_LABELS,
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_KIND_LABELS,
  DEVELOP_VAT_MODE_LABELS,
} from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { useDevelopRequest } from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { errorMessage } from '../lib/error-msg';
import { dateShort, won } from '../lib/format';

// 견적서 인쇄용(docs/DEVELOP_FLOW.md §7.2) — A4 한 장. 셸이 없는 라우트(meta.bare)라 화면 자체가 종이다.
// 데이터는 상세 응답에서 qid 견적 하나를 골라 쓴다(견적 단건 라우트가 없다 — 캐시도 상세와 공유한다).
// 공급자 정보는 회사 정보 API 가 P2 라 상수로 둔다 — 바뀌면 여기 한 곳만 고치면 된다.

const SUPPLIER = {
  name: '샘플피씨비',
  desc: '회로 · PCB · 펌웨어 · 앱 · 서버 개발',
  site: 'samplepcb.co.kr',
} as const;

const auth = useAuthStore();
const route = useRoute();
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
  return q === undefined ? '' : `Q${String(q.requestId)}-v${String(q.version)}`;
});
const issuedAt = computed(() => {
  const q = quote.value;
  if (q === undefined) return '—';
  return q.sentAt === null ? '—' : dateShort(q.sentAt);
});

// 수락 전에는 마일스톤이 전부 draft("작성 중")라 그 열은 종이 위에서 뜻 없는 문구가 된다 —
// 실제로 진행된 결제가 하나라도 있을 때만 상태 열을 낸다.
const showMilestoneStatus = computed(() => quote.value?.milestones.some((m) => m.status !== 'draft') ?? false);

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function print(): void {
  window.print();
}
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
      <!-- 인쇄 버튼(종이에는 안 나온다) -->
      <div class="print-hidden mx-auto mb-4 flex w-full max-w-[860px] items-center gap-2.5 px-6">
        <RouterLink
          :to="`/requests/${String(detail.requestId)}`"
          class="h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold leading-10 text-tx-2 transition hover:border-tx-3"
        >
          의뢰 상세로
        </RouterLink>
        <button
          type="button"
          class="ml-auto h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600"
          @click="print"
        >
          인쇄 / PDF 저장
        </button>
      </div>

      <!-- A4 한 장 -->
      <article class="mx-auto w-full max-w-[860px] bg-white px-10 py-11 text-tx-1 shadow-sm print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <!-- 제목 -->
        <header class="flex flex-wrap items-start gap-4 border-b-2 border-ink-950 pb-5">
          <div class="grid gap-1">
            <h1 class="text-h1 font-extrabold tracking-tight">견 적 서</h1>
            <p class="text-label text-tx-3">{{ DEVELOP_QUOTE_KIND_LABELS[quote.kind] }} · {{ quote.title }}</p>
          </div>
          <dl class="ml-auto grid grid-cols-[auto_auto] gap-x-4 gap-y-1 text-label">
            <dt class="text-tx-3">견적번호</dt>
            <dd class="font-mono font-bold tabular-nums">{{ quoteNo }}</dd>
            <dt class="text-tx-3">발행일</dt>
            <dd class="font-mono tabular-nums">{{ issuedAt }}</dd>
            <dt class="text-tx-3">유효기간</dt>
            <dd class="font-mono tabular-nums">{{ quote.validUntil }}</dd>
          </dl>
        </header>

        <!-- 수신 · 공급자 -->
        <section class="mt-6 grid gap-5 sm:grid-cols-2">
          <div class="grid gap-1.5">
            <h2 class="text-label font-bold text-tx-3">수신</h2>
            <p class="text-title font-extrabold">
              {{ detail.contact.company ?? detail.contact.name }}<span v-if="detail.contact.company !== null"> 귀중</span>
            </p>
            <p class="text-body text-tx-2">
              담당 {{ detail.contact.name }} · {{ detail.contact.phone }}<br>{{ detail.contact.email }}
            </p>
          </div>
          <div class="grid gap-1.5 sm:justify-items-end sm:text-right">
            <h2 class="text-label font-bold text-tx-3">공급자</h2>
            <p class="text-title font-extrabold">{{ SUPPLIER.name }}</p>
            <p class="text-body text-tx-2">{{ SUPPLIER.desc }}<br>{{ SUPPLIER.site }}</p>
          </div>
        </section>

        <p class="mt-5 rounded-lg bg-paper px-4 py-3 text-body text-tx-2 print:bg-transparent print:px-0">
          아래와 같이 견적서를 제출합니다. 의뢰 <span class="font-bold text-tx-1">#{{ detail.requestId }} {{ detail.title }}</span>
        </p>

        <!-- 합계(먼저 눈에 들어와야 하는 숫자) -->
        <div class="mt-5 flex flex-wrap items-baseline gap-3 border-y-2 border-ink-950 py-4">
          <span class="text-label font-bold text-tx-3">합계 금액</span>
          <span class="font-mono text-h1 font-extrabold tabular-nums">{{ won(quote.totalAmount) }}</span>
          <span class="text-label text-tx-3">({{ DEVELOP_VAT_MODE_LABELS[quote.vatMode] }})</span>
        </div>

        <!-- 항목 -->
        <table class="mt-6 w-full border-collapse text-body">
          <thead>
            <tr class="border-b border-ink-950 text-label text-tx-3">
              <th class="w-10 py-2 text-left font-semibold">No</th>
              <th class="py-2 text-left font-semibold">항목</th>
              <th class="w-20 py-2 text-right font-semibold">기간</th>
              <th class="w-32 py-2 text-right font-semibold">금액</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, i) in quote.items" :key="item.itemId" class="border-b border-line align-top">
              <td class="py-2.5 font-mono tabular-nums text-tx-3">{{ i + 1 }}</td>
              <td class="py-2.5 pr-4">
                <p class="font-bold">{{ item.title }}</p>
                <p v-if="item.description !== null" class="mt-1 whitespace-pre-wrap text-label leading-relaxed text-tx-2">{{ item.description }}</p>
              </td>
              <td class="py-2.5 text-right font-mono tabular-nums text-tx-2">
                {{ item.durationDays === null ? '—' : `${item.durationDays}일` }}
              </td>
              <td class="py-2.5 text-right font-mono tabular-nums">{{ won(item.amount) }}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="border-b border-line">
              <td colspan="3" class="py-2 text-right text-tx-2">공급가액</td>
              <td class="py-2 text-right font-mono tabular-nums">{{ won(quote.supplyAmount) }}</td>
            </tr>
            <tr class="border-b border-line">
              <td colspan="3" class="py-2 text-right text-tx-2">부가세</td>
              <td class="py-2 text-right font-mono tabular-nums">{{ won(quote.vatAmount) }}</td>
            </tr>
            <tr class="border-b-2 border-ink-950">
              <td colspan="3" class="py-2.5 text-right font-extrabold">합계</td>
              <td class="py-2.5 text-right font-mono font-extrabold tabular-nums">{{ won(quote.totalAmount) }}</td>
            </tr>
          </tfoot>
        </table>

        <!-- 결제 조건 -->
        <section v-if="quote.milestones.length > 0" class="mt-7 break-inside-avoid">
          <h2 class="text-label font-bold text-tx-3">결제 조건</h2>
          <table class="mt-2 w-full border-collapse text-body">
            <thead>
              <tr class="border-b border-line text-label text-tx-3">
                <th class="py-2 text-left font-semibold">명칭</th>
                <th class="w-16 py-2 text-right font-semibold">비율</th>
                <th class="w-32 py-2 text-right font-semibold">금액</th>
                <th class="w-32 py-2 pl-3 text-left font-semibold">청구 시점</th>
                <th v-if="showMilestoneStatus" class="w-20 py-2 text-right font-semibold">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in quote.milestones" :key="m.milestoneId" class="border-b border-line">
                <td class="py-2 pr-3 font-bold">{{ m.title }}</td>
                <td class="py-2 text-right font-mono tabular-nums text-tx-2">
                  {{ m.ratioBp === null ? '—' : `${(m.ratioBp / 100).toFixed(0)}%` }}
                </td>
                <td class="py-2 text-right font-mono tabular-nums">{{ won(m.amount) }}</td>
                <td class="py-2 pl-3 text-label text-tx-2">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }}</td>
                <td v-if="showMilestoneStatus" class="py-2 text-right text-label text-tx-2">{{ DEVELOP_MILESTONE_STATUS_LABELS[m.status] }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <!-- 기간 · 산출물 · 실비 -->
        <dl class="mt-7 grid gap-3 break-inside-avoid text-body sm:grid-cols-[120px_1fr]">
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

          <template v-if="quote.note !== null">
            <dt class="text-label font-bold text-tx-3">비고</dt>
            <dd class="whitespace-pre-wrap leading-relaxed">{{ quote.note }}</dd>
          </template>
        </dl>

        <!-- 표준 조건 -->
        <section class="mt-7 break-inside-avoid border-t border-line pt-4">
          <h2 class="text-label font-bold text-tx-3">표준 조건</h2>
          <p class="mt-2 whitespace-pre-wrap text-label leading-relaxed text-tx-2">{{ quote.terms }}</p>
        </section>

        <p class="mt-8 text-label text-tx-3">
          본 견적서는 {{ quote.validUntil }}까지 유효합니다. 금액은 원화(KRW) 기준이며 {{ DEVELOP_VAT_MODE_LABELS[quote.vatMode] }}입니다.
        </p>
      </article>
    </template>
  </main>
</template>
