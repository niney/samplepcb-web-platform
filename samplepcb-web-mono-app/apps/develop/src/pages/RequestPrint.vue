<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_MILESTONE_STATUS_LABELS,
  DEVELOP_MILESTONE_TRIGGER_LABELS,
  DEVELOP_QUOTE_STATUS_LABELS,
  developAreaBadge,
  developBpPercent,
  developQuoteNo,
  developWishLabel,
} from '@sp/api-contract';
import type { DevelopQuoteSheetRecipient, DevelopRequestStatusType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { DevelopQuoteSheet } from '@sp/ui';
import { useDevelopRequest } from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { COMPANY } from '../lib/company';
import { errorMessage } from '../lib/error-msg';
import { dateDotFull, dateShort, dateTimeKst, statusLabel, statusToneClass, won } from '../lib/format';
import { PRINT_PAGE, PRINT_PITCH, paginatePrint } from '../lib/print-paginate';
import { applyPrintScale } from '../lib/print-scale';
import HeaderLogo from '../components/layout/HeaderLogo.vue';
import RequestContent from '../components/detail/RequestContent.vue';
import Timeline from '../components/detail/Timeline.vue';
import AttachmentList from '../components/detail/AttachmentList.vue';
import ProjectProgress from '../components/detail/ProjectProgress.vue';
import DocumentList from '../components/detail/DocumentList.vue';
import DevelopReview from '../components/detail/review/DevelopReview.vue';
import iconQuote from '../assets/detail/quote-doc.svg';

// 의뢰 출력물('출력하기', 피그마 「개발 의뢰 > 내 의뢰 > 출력하기」 Slide 4:3) — 브라우저 인쇄만, PDF 파일은 만들지 않는다(견적서 인쇄 D12 관례).
// 셸이 없는 라우트(meta.bare)라 화면 자체가 종이 미리보기다. 용지는 PPT 4:3(10×7.5in) — 2026-10-22 엔 A4 가로였고,
// 디자인 체크리스트 8번(10-30)으로 화면도 4:3 판에 쪽 단위로 나눠 보이고 인쇄도 같은 자리에서 끊는다(lib/print-paginate).
// 시안은 상세 화면을 4:3 판에 잘라 붙인 모양이라 고정 장수를 옮기지 않고 규칙으로 나눈다:
// 표지 1장 → 섹션마다 새 쪽 → 카드·행은 쪽 경계에서 쪼개지 않는다(큰 글 덩어리만 줄 경계에서 쪼갠다).
// 섹션은 상세 탭과 같은 순서이되 내용이 없는 섹션은 뺀다(빈 쪽을 찍지 않는다).
// 컴포넌트는 상세 화면 것을 print 모드로 다시 쓴다 — 조작 UI(수락·결제·문의·검수 응답·받기) 없이 읽기 전용.
// 2026-11-06 시안 재대조: 표지(Slide 11)·첫 쪽 머리 띠(Slide 1)를 시안 크기로, 견적서 섹션은 견적 카드 대신 고객이 받는 견적서
// 문서(@sp/ui DevelopQuoteSheet — 시안 「통합 견적서」 모양) + 수락·결제 기록(시안의 수락 패널 자리 — 종이엔 누를 것이 없다).
// 디자이너 메모(11-05)의 크기 규칙(글자 −2px · 16px 이상 여백 −10px)은 쪽 나누기 전에 건다(lib/print-scale) — 표지·머리 띠·
// 견적서 문서·2-4 개발 명세서는 예외(data-print-noscale).

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const requestId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});

const detailQ = useDevelopRequest(requestId, loggedIn);
const detail = computed(() => detailQ.data.value?.data);

// 표지 제목 — 견적 수락 전은 제안서, 수락 뒤(착수금 대기 포함)는 진행 보고서.
const REPORT_STATUSES: readonly DevelopRequestStatusType[] = ['accepted', 'in_progress', 'delivered', 'completed'];
const BEFORE_START: readonly DevelopRequestStatusType[] = ['received', 'reviewing', 'quoted', 'accepted'];
const coverTitle = computed(() => (detail.value !== undefined && REPORT_STATUSES.includes(detail.value.status) ? '개발 진행 보고서' : '제품 개발 제안서'));

// 견적서 — 수락된 것 하나, 없으면 가장 최근에 받은 발송본. 수정 요청·만료·대체된 판은 싣지 않는다.
const printQuote = computed(() => {
  const latestFirst = [...(detail.value?.quotes ?? [])].reverse(); // 서버가 version 오름차순으로 준다
  return latestFirst.find((q) => q.status === 'accepted') ?? latestFirst.find((q) => q.status === 'sent') ?? null;
});
// 견적서 문서의 수신·번호·일자 — 견적서 인쇄 화면(QuotePrint)과 같은 값.
const quoteRecipient = computed<DevelopQuoteSheetRecipient>(() => ({
  company: detail.value?.contact.company ?? null,
  dept: printQuote.value?.recipientDept ?? null,
  name: detail.value?.contact.name ?? '',
  phone: detail.value?.contact.phone ?? '',
  email: detail.value?.contact.email ?? '',
}));
const quoteNo = computed(() => (printQuote.value === null ? '' : developQuoteNo(printQuote.value.requestId, printQuote.value.version)));
const quoteIssuedOn = computed(() => dateShort(printQuote.value?.sentAt ?? new Date().toISOString()));

type SectionId = 'content' | 'review' | 'quotes' | 'documents' | 'timeline' | 'files';
const sections = computed<{ id: SectionId; title: string }[]>(() => {
  const d = detail.value;
  if (d === undefined) return [];
  const closed = d.status === 'cancelled' || d.status === 'declined';
  const list: { id: SectionId; title: string }[] = [{ id: 'content', title: '상세 의뢰 내용' }];
  if (d.review !== null || d.diagram !== null) list.push({ id: 'review', title: 'AI 사전 검토서' });
  if (printQuote.value !== null) list.push({ id: 'quotes', title: '견적서' });
  if (!closed && !BEFORE_START.includes(d.status)) list.push({ id: 'documents', title: '진행 현황 · 프로젝트 문서' });
  list.push({ id: 'timeline', title: '진행 · 문의' });
  if (d.files.length > 0) list.push({ id: 'files', title: '첨부 자료' });
  return list;
});

const reviewVersionLabel = computed(() => {
  const seq = detail.value?.reviewPublicSeq ?? null;
  return seq === null ? '' : `v${String(seq)} 공개본`;
});
const wishLabel = computed(() => (detail.value === undefined ? '' : developWishLabel(detail.value.wishDate, detail.value.wishNote)));
// 표지 '의뢰 내용' — 시안 두 단(왼쪽 접수 일자·예산, 오른쪽 개발 분야·희망 완료 시기)이 행 순서로 흐르게 놓는다.
const coverRows = computed(() => {
  const d = detail.value;
  if (d === undefined) return [];
  return [
    { label: '접수 일자', value: dateDotFull(d.createdAt) },
    { label: '개발 분야', value: developAreaBadge(d.serviceAreas) },
    { label: '예산', value: DEVELOP_BUDGET_RANGE_LABELS[d.budgetRange] },
    { label: '희망 완료 시기', value: wishLabel.value === '' ? '—' : wishLabel.value },
  ];
});

// 용지 — 이 화면에서만 PPT 4:3(10×7.5in). 여백은 화면 판 여백과 같게 둬 인쇄 쪽 내용 폭·높이가 화면 판과 같다(864×640).
// @page 는 문서 전역이라 들어올 때 붙이고 나갈 때 뗀다(견적서 인쇄는 A4 세로 그대로).
let pageStyle: HTMLStyleElement | null = null;
onMounted(() => {
  pageStyle = document.createElement('style');
  pageStyle.textContent = `@page { size: 10in 7.5in; margin: ${String(PRINT_PAGE.padY)}px ${String(PRINT_PAGE.padX)}px; }`;
  document.head.appendChild(pageStyle);
});
onBeforeUnmount(() => {
  pageStyle?.remove();
});

// 쪽 나누기(lib/print-paginate) — 글꼴·그림이 다 들어온 뒤에 잰다. 내용이 바뀌면(다시 받은 의뢰) 흐름을 새로 그린 뒤(key) 다시 잰다.
// 그 전에 출력물 크기 규칙(lib/print-scale)을 건다 — 줄어든 크기로 재야 화면 판과 인쇄 쪽이 맞는다.
// pageCount 0 = 아직 안 나눔(판·가림을 그리지 않는다). data-pages 는 e2e 가 인쇄 쪽 수와 맞대 본다.
const flowEl = ref<HTMLElement | null>(null);
const flowKey = ref(0);
const pageCount = ref(0);
let paginateRun = 0;
watch(
  detail,
  async (d, prev) => {
    if (d === undefined) return;
    const run = (paginateRun += 1);
    if (prev !== undefined) flowKey.value += 1;
    pageCount.value = 0;
    await nextTick();
    await document.fonts.ready;
    const flow = flowEl.value;
    if (flow === null || run !== paginateRun) return;
    await Promise.all([...flow.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)));
    if (run !== paginateRun) return;
    applyPrintScale(flow);
    pageCount.value = paginatePrint(flow);
  },
  { immediate: true },
);
// 화면 판 — 쪽마다 흰 판(960×720), 판 사이 24. 흐름은 첫 판의 내용 자리(위 40 · 왼쪽 48)에서 시작한다.
const px = (n: number): string => `${String(n)}px`;
const stackStyle = computed(() => ({
  width: px(PRINT_PAGE.width),
  minHeight: px(pageCount.value === 0 ? PRINT_PAGE.height : pageCount.value * PRINT_PITCH - PRINT_PAGE.gap),
}));
// 판 사이 가림 수 — 쪽 수보다 하나 적다. 0 쪽(아직 안 나눔)일 때 음수가 되지 않게 막는다: 운영 빌드의 v-for 숫자 범위는
// new Array(n) 그대로라 -1 이면 RangeError 로 화면 전체가 비고(개발 빌드는 경고 뒤 빈 목록이라 로컬·e2e 에선 안 보였다 — 2026-11-04 실측).
const maskCount = computed(() => Math.max(0, pageCount.value - 1));
const frameStyle = (k: number): Record<string, string> => ({ top: px(k * PRINT_PITCH), width: px(PRINT_PAGE.width), height: px(PRINT_PAGE.height) });
const FLOW_STYLE = {
  width: px(PRINT_PAGE.width - PRINT_PAGE.padX * 2),
  margin: `${px(PRINT_PAGE.padY)} ${px(PRINT_PAGE.padX)} 0`,
};
// 판 여백·판 사이 가림 — 쪽을 넘은 카드의 테두리·바탕이 여백에 비치지 않게 내용 위에 덮는다(판 테두리 1px 은 남긴다).
const PAD_BAND = PRINT_PAGE.padY - 1;
const maskStyles = (k: number): Record<string, string>[] => {
  const pageBottom = k * PRINT_PITCH + PRINT_PAGE.height;
  const x = { left: px(PRINT_PAGE.padX), width: px(PRINT_PAGE.width - PRINT_PAGE.padX * 2) };
  return [
    { ...x, top: px(pageBottom - PRINT_PAGE.padY), height: px(PAD_BAND), background: '#fff' },
    { ...x, top: px(pageBottom), height: px(PRINT_PAGE.gap), background: 'var(--color-paper)' },
    { ...x, top: px(pageBottom + PRINT_PAGE.gap + 1), height: px(PAD_BAND), background: '#fff' },
  ];
};

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function print(): void {
  window.print();
}

// 카드 — 그림자 없이 1px #EBEBEB 테두리(디자인 체크리스트 10번 — 출력물 카드만, 상세 화면은 그대로).
const CARD = 'rounded-[14px] border border-[#ebebeb] bg-white px-[24px] py-[26px]';
</script>

<template>
  <main class="min-h-screen bg-paper py-8 print:bg-white print:py-0">
    <div v-if="!loggedIn" class="mx-auto max-w-[720px] rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">의뢰 출력물은 로그인 후 확인할 수 있습니다.</p>
      <button type="button" class="mt-5 h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white" @click="goLogin">로그인</button>
    </div>

    <p v-else-if="detailQ.isPending.value" class="mx-auto max-w-[720px] px-6 py-16 text-center text-body text-tx-3">
      {{ $t('common.loading') }}
    </p>

    <div v-else-if="detailQ.isError.value || detail === undefined" class="mx-auto max-w-[720px] rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body font-semibold text-red-700">{{ errorMessage(detailQ.error.value, '의뢰를 불러오지 못했습니다.') }}</p>
      <RouterLink
        :to="`/requests/${String(requestId ?? 0)}`"
        class="mt-5 inline-block h-11 rounded-lg border border-line-2 px-6 text-body font-bold leading-[2.75rem] text-tx-2"
      >
        의뢰 상세로
      </RouterLink>
    </div>

    <template v-else>
      <!-- 인쇄 버튼(종이에는 안 나온다) -->
      <div class="print-hidden mx-auto mb-4 flex w-full max-w-[960px] flex-wrap items-center gap-2.5 px-6">
        <RouterLink
          :to="`/requests/${String(detail.requestId)}`"
          class="h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold leading-10 text-tx-2 transition hover:border-tx-3"
        >
          의뢰 상세로
        </RouterLink>
        <p class="text-label text-tx-3">PPT 4:3(10×7.5인치) 쪽으로 인쇄됩니다. 'PDF로 저장'을 고르시면 파일로 받으실 수 있습니다.</p>
        <button
          type="button"
          class="ml-auto h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600"
          @click="print"
        >
          인쇄 / PDF 저장
        </button>
      </div>

      <!-- 쪽 판 묶음 — 화면은 판(흰 960×720)을 쌓고 흐름을 그 위에 얹는다. 인쇄는 흐름만(판·가림은 숨고 @page 가 쪽을 만든다).
           flow-root = 흐름의 위 여백(40)이 묶음 밖으로 접혀 판과 어긋나지 않게. -->
      <div class="overflow-x-auto print:overflow-visible">
        <div
          class="develop-print relative mx-auto flow-root tracking-normal text-[#141e34] print:!m-0 print:!min-h-0 print:!w-auto"
          :style="stackStyle"
          :data-pages="pageCount"
        >
          <div
            v-for="k in pageCount"
            :key="`frame${String(k)}`"
            class="print-hidden absolute left-0 rounded-[2px] border border-[#e3e6eb] bg-white"
            :style="frameStyle(k - 1)"
            aria-hidden="true"
          />
          <div :key="flowKey" ref="flowEl" class="relative flex flex-col print:!m-0 print:!w-auto" :style="FLOW_STYLE">
            <!-- 표지 — 시안 Slide 11(1024×768 판)의 세로 간격 그대로. 판이 시안보다 48 낮아 남는 높이는 위 여백(줄어들 수 있다)과
                 '의뢰 내용' 앞 빈자리가 나눠 갖고, 높이를 한 쪽(쪽 나누기 한도 636) 안으로 묶어 표지가 두 쪽으로 넘치지 않게 한다.
                 연락처는 담당자 개인 번호가 아니라 회사 대표번호(개인 연락처를 내보내지 않는 규칙). -->
            <section class="print-page flex h-[632px] flex-col" data-print-section="cover" data-print-noscale>
              <div class="h-[64px] min-h-[16px] shrink" aria-hidden="true" />
              <HeaderLogo />
              <div class="mt-[26px] h-px shrink-0 bg-[#0a151e]" />
              <h1 class="mt-[34px] text-[42px] font-bold leading-[1.3] text-[#141e34]">{{ coverTitle }}</h1>
              <p class="mt-[24px] text-[26px] font-medium leading-[1.3] text-[#141e34]">{{ detail.title }}</p>
              <p v-if="detail.review !== null && detail.review.summary !== ''" class="mt-[9px] line-clamp-2 text-[18px] leading-[1.8] text-[#666]">
                {{ detail.review.summary }}
              </p>
              <div class="mt-[34px] h-px shrink-0 bg-[#0a151e]" />
              <p class="mt-[20px] flex flex-wrap gap-x-[20px] leading-[1.8]">
                <span class="flex items-baseline gap-[6px]">
                  <span class="text-[15px] text-[#141e34]">담당자 :</span>
                  <b class="text-[16px] font-semibold text-black">{{ detail.assigneeName ?? '샘플피씨비 개발팀' }}</b>
                </span>
                <span class="flex items-baseline gap-[6px]">
                  <span class="text-[15px] text-[#141e34]">연락처 :</span>
                  <b class="text-[16px] font-semibold text-black">{{ COMPANY.tel }}</b>
                </span>
              </p>
              <div class="min-h-[24px] flex-1" aria-hidden="true" />
              <div class="flex flex-col gap-[16px] pb-[12px]">
                <h2 class="text-[20px] font-bold leading-[1.3] text-black">의뢰 내용</h2>
                <ul class="grid grid-cols-2 gap-[2px] rounded-[8px] bg-[#f5f6f8] px-[24px] py-[20px] leading-[1.8]">
                  <li v-for="row in coverRows" :key="row.label" class="ms-[22.5px] list-disc text-[15px] text-[#141e34]">
                    {{ row.label }} :<b class="ml-[6px] text-[16px] font-semibold text-black">{{ row.value }}</b>
                  </li>
                </ul>
              </div>
            </section>

            <!-- 섹션 — 상세 탭 순서, 내용 없는 섹션은 뺀다 -->
            <section v-for="(s, si) in sections" :key="s.id" class="print-page" :data-print-section="s.id">
              <!-- 첫 내용 쪽 머리 띠 — 시안 Slide 1: 의뢰 제목 + 위아래 선 사이 개발 분야·접수일자·진행상태(시안 크기 그대로) -->
              <div v-if="si === 0" class="mb-[20px]" data-print-noscale>
                <p class="text-[26px] font-bold leading-[1.3] text-[#141e34]">{{ detail.title }}</p>
                <div
                  class="mt-[12px] flex flex-wrap items-center gap-x-[30px] gap-y-[6px] border-y border-b-[#d8d8d8] border-t-[#0a151e] px-[10px] py-[13px] text-[14px] leading-[1.3] text-[#141e34]"
                >
                  <span class="flex items-center gap-[5px]">개발 분야 :<b class="font-medium">{{ developAreaBadge(detail.serviceAreas) }}</b></span>
                  <span class="flex items-center gap-[8px]">접수일자 :<b class="font-medium">{{ dateDotFull(detail.createdAt) }}</b></span>
                  <span class="flex items-center gap-[8px]">
                    진행상태 :<span class="rounded-[37px] px-[8px] py-[4px] text-[12px] font-semibold" :class="statusToneClass[detail.status]">{{ statusLabel(detail.status) }}</span>
                  </span>
                </div>
              </div>
              <h2 class="text-[22px] font-bold leading-[1.3] text-black">{{ si + 1 }}. {{ s.title }}</h2>
              <div class="mt-[22px] flex flex-col gap-[22px]">
                <!-- 상세 의뢰 내용 — 바깥 카드 없이(시안 Slide 1) -->
                <RequestContent v-if="s.id === 'content'" :detail="detail" />

                <DevelopReview
                  v-else-if="s.id === 'review'"
                  :review="detail.review"
                  :diagram-html="detail.diagram?.html ?? null"
                  :diagram-uploaded="detail.diagram?.source === 'upload'"
                  :diagram-generated-at="detail.diagram?.meta?.generatedAt ?? detail.diagram?.publishedAt ?? null"
                  :version-label="reviewVersionLabel"
                  pending-note="검토서는 담당자 검토 후 공개됩니다."
                  :wish-label="wishLabel"
                  :section-no="si + 1"
                  print
                />

                <!-- 견적서 — 고객이 받는 견적서 문서(시안 Slide 9·10: 회색 바탕 가운데 종이) + 수락·결제 기록 -->
                <article v-else-if="s.id === 'quotes' && printQuote !== null" class="flex flex-col gap-[22px]">
                  <div class="bg-[#f7f7f7]" data-print-noscale>
                    <div class="mx-auto w-fit">
                      <DevelopQuoteSheet :quote="printQuote" :recipient="quoteRecipient" :quote-no="quoteNo" :issued-on="quoteIssuedOn" />
                    </div>
                  </div>
                  <section class="print-keep flex flex-col gap-[10px] rounded-[10px] border border-[#d7deec] bg-[#f1f6ff] px-[16px] py-[14px]">
                    <p class="flex flex-wrap items-center gap-[8px] text-[16px] font-bold leading-[1.3] text-black">
                      <img :src="iconQuote" alt="" class="block size-[19px]">
                      <span>{{ printQuote.status === 'accepted' ? '견적 수락 기록' : '견적 수락 전' }}</span>
                      <span
                        class="rounded-[37px] px-[8px] py-[4px] text-[12px] font-semibold leading-[1.3] text-white"
                        :class="printQuote.status === 'accepted' ? 'bg-[#1b2b39]' : 'bg-[#1b6ff3]'"
                      >{{ DEVELOP_QUOTE_STATUS_LABELS[printQuote.status] }}</span>
                    </p>
                    <p v-if="printQuote.acceptedAt !== null" class="text-[15px] leading-[1.8] text-[#141e34]">
                      {{ dateTimeKst(printQuote.acceptedAt) }} 수락 · 수락자 {{ printQuote.acceptedName ?? detail.contact.name }} — 표준 조건에 동의하여 계약을 갈음했습니다.
                    </p>
                    <p v-else class="text-[15px] leading-[1.8] text-[#141e34]">
                      {{ printQuote.validUntil }}까지 유효합니다. 수락은 의뢰 상세 화면의 견적서에서 하실 수 있습니다.
                    </p>
                    <!-- 결제 진행 — 수락 뒤에만(수락 전 마일스톤은 전부 '작성 중'이라 뜻이 없다) -->
                    <div v-if="printQuote.status === 'accepted' && printQuote.milestones.length > 0" class="flex flex-col">
                      <div
                        v-for="m in printQuote.milestones"
                        :key="m.milestoneId"
                        class="flex items-baseline gap-[14px] text-[15px] leading-[1.8] text-[#141e34]"
                      >
                        <span class="min-w-0 flex-1 font-semibold text-black">{{ m.title }}</span>
                        <span class="w-[60px] shrink-0 text-right tabular-nums">{{ m.ratioBp === null ? '—' : `${developBpPercent(m.ratioBp)}%` }}</span>
                        <span class="w-[130px] shrink-0 text-right tabular-nums">{{ won(m.amount) }}</span>
                        <span class="w-[150px] shrink-0 text-[14px]">{{ DEVELOP_MILESTONE_TRIGGER_LABELS[m.trigger] }}</span>
                        <span class="w-[170px] shrink-0 text-right text-[14px] font-semibold" :class="m.status === 'paid' ? 'text-[#2945e8]' : 'text-[#999]'">
                          {{ DEVELOP_MILESTONE_STATUS_LABELS[m.status] }}<template v-if="m.paidAt !== null"> · {{ dateShort(m.paidAt) }}</template>
                        </span>
                      </div>
                    </div>
                  </section>
                </article>

                <div v-else-if="s.id === 'documents'" :class="CARD" class="flex flex-col gap-[16px]">
                  <ProjectProgress :progress="detail.progress" :status="detail.status" />
                  <DocumentList
                    v-if="detail.documents.length > 0"
                    :documents="detail.documents"
                    :request-id="detail.requestId"
                    :contact-name="detail.contact.name"
                    :deciding-doc-id="null"
                    :decide-pending="false"
                    decide-error=""
                    print
                  />
                </div>

                <div v-else-if="s.id === 'timeline'" :class="CARD">
                  <Timeline :events="detail.events" print />
                </div>

                <div v-else-if="s.id === 'files'" :class="CARD">
                  <AttachmentList :files="detail.files" print />
                </div>
              </div>
            </section>
          </div>
          <template v-for="k in maskCount" :key="`mask${String(k)}`">
            <div
              v-for="(m, mi) in maskStyles(k - 1)"
              :key="mi"
              class="print-hidden pointer-events-none absolute z-[1]"
              :style="m"
              aria-hidden="true"
            />
          </template>
        </div>
      </div>
    </template>
  </main>
</template>
