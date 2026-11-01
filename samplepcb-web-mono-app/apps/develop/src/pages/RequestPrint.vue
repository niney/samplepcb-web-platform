<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { DEVELOP_BUDGET_RANGE_LABELS, developAreaBadge, developWishLabel } from '@sp/api-contract';
import type { DevelopRequestStatusType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { useDevelopRequest } from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { COMPANY } from '../lib/company';
import { errorMessage } from '../lib/error-msg';
import { dateDotFull, statusLabel } from '../lib/format';
import { PRINT_PAGE, PRINT_PITCH, paginatePrint } from '../lib/print-paginate';
import HeaderLogo from '../components/layout/HeaderLogo.vue';
import RequestContent from '../components/detail/RequestContent.vue';
import QuoteCard from '../components/detail/QuoteCard.vue';
import Timeline from '../components/detail/Timeline.vue';
import AttachmentList from '../components/detail/AttachmentList.vue';
import ProjectProgress from '../components/detail/ProjectProgress.vue';
import DocumentList from '../components/detail/DocumentList.vue';
import DevelopReview from '../components/detail/review/DevelopReview.vue';

// 의뢰 출력물('출력하기', 피그마 「개발 의뢰」 Slide 4:3 1~12) — 브라우저 인쇄만, PDF 파일은 만들지 않는다(견적서 인쇄 D12 관례).
// 셸이 없는 라우트(meta.bare)라 화면 자체가 종이 미리보기다. 용지는 PPT 4:3(10×7.5in) — 2026-10-22 엔 A4 가로였고,
// 디자인 체크리스트 8번(10-30)으로 화면도 4:3 판에 쪽 단위로 나눠 보이고 인쇄도 같은 자리에서 끊는다(lib/print-paginate).
// 시안은 상세 화면을 4:3 판에 잘라 붙인 모양이라 고정 12장을 옮기지 않고 규칙으로 나눈다:
// 표지 1장 → 섹션마다 새 쪽 → 카드·행은 쪽 경계에서 쪼개지 않는다(큰 글 덩어리만 줄 경계에서 쪼갠다).
// 섹션은 상세 탭과 같은 순서이되 내용이 없는 섹션은 뺀다(빈 쪽을 찍지 않는다).
// 컴포넌트는 상세 화면 것을 print 모드로 다시 쓴다 — 조작 UI(수락·결제·문의·검수 응답·받기) 없이 읽기 전용.

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

type SectionId = 'content' | 'review' | 'quotes' | 'documents' | 'timeline' | 'files';
const sections = computed<{ id: SectionId; title: string }[]>(() => {
  const d = detail.value;
  if (d === undefined) return [];
  const closed = d.status === 'cancelled' || d.status === 'declined';
  const list: { id: SectionId; title: string }[] = [{ id: 'content', title: '상세 의뢰 내용' }];
  if (d.review !== null || d.diagram !== null) list.push({ id: 'review', title: 'AI 사전 검토서' });
  if (printQuote.value !== null) list.push({ id: 'quotes', title: '견적서' });
  if (!closed && !BEFORE_START.includes(d.status)) list.push({ id: 'documents', title: '진행 현황 · 프로젝트 문서' });
  list.push({ id: 'timeline', title: '진행 사항' });
  if (d.files.length > 0) list.push({ id: 'files', title: '첨부 자료' });
  return list;
});

const reviewVersionLabel = computed(() => {
  const seq = detail.value?.reviewPublicSeq ?? null;
  return seq === null ? '' : `v${String(seq)} 공개본`;
});
const wishLabel = computed(() => (detail.value === undefined ? '' : developWishLabel(detail.value.wishDate, detail.value.wishNote)));
const printedOn = dateDotFull(new Date().toISOString());

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
            <!-- 표지 -->
            <section class="print-page" data-print-section="cover">
              <HeaderLogo />
              <div class="mt-[28px] h-px bg-[#0a151e]" />
              <div class="flex flex-col gap-[14px] py-[28px]">
                <h1 class="text-[38px] font-bold leading-[1.3] text-[#141e34]">{{ coverTitle }}</h1>
                <p class="text-[26px] font-medium leading-[1.4] text-[#141e34]">{{ detail.title }}</p>
                <p v-if="detail.review !== null && detail.review.summary !== ''" class="line-clamp-3 text-[16px] leading-[1.6] text-[#666]">{{ detail.review.summary }}</p>
              </div>
              <div class="h-px bg-[#0a151e]" />
              <p class="flex flex-wrap gap-x-[30px] gap-y-[6px] px-[4px] py-[16px] text-[15px] leading-[1.3]">
                <span>담당자 : <b class="font-semibold">{{ detail.assigneeName ?? '샘플피씨비 개발팀' }}</b></span>
                <span>연락처 : <b class="font-semibold">{{ COMPANY.tel }}</b></span>
                <span>이메일 : <b class="font-semibold">{{ COMPANY.email }}</b></span>
              </p>

              <div class="mt-[28px] flex flex-col gap-[14px]">
                <h2 class="text-[18px] font-bold leading-[1.3] text-black">의뢰 개요</h2>
                <dl class="grid gap-x-[40px] gap-y-[12px] rounded-[10px] bg-[#f5f6f8] px-[28px] py-[22px] text-[15px] leading-[1.5] sm:grid-cols-2">
                  <div class="flex gap-[8px]"><dt>· 접수 일자 :</dt><dd class="font-semibold">{{ dateDotFull(detail.createdAt) }}</dd></div>
                  <div class="flex gap-[8px]"><dt>· 개발 분야 :</dt><dd class="font-semibold">{{ developAreaBadge(detail.serviceAreas) }}</dd></div>
                  <div class="flex gap-[8px]"><dt>· 예산 :</dt><dd class="font-semibold">{{ DEVELOP_BUDGET_RANGE_LABELS[detail.budgetRange] }}</dd></div>
                  <div class="flex gap-[8px]"><dt>· 희망 완료 시기 :</dt><dd class="font-semibold">{{ wishLabel === '' ? '—' : wishLabel }}</dd></div>
                  <div class="flex gap-[8px]"><dt>· 진행 상태 :</dt><dd class="font-semibold">{{ statusLabel(detail.status) }}</dd></div>
                  <div class="flex gap-[8px]"><dt>· 출력일 :</dt><dd class="font-semibold">{{ printedOn }}</dd></div>
                </dl>
              </div>
              <p class="mt-[24px] text-[13px] leading-[1.6] text-[#999]">
                {{ COMPANY.name }} · {{ COMPANY.addr }} · Tel {{ COMPANY.tel }} · Fax {{ COMPANY.fax }}
              </p>
            </section>

            <!-- 섹션 — 상세 탭 순서, 내용 없는 섹션은 뺀다 -->
            <section v-for="(s, si) in sections" :key="s.id" class="print-page" :data-print-section="s.id">
              <h2 class="text-[22px] font-bold leading-[1.3] text-black">{{ si + 1 }}. {{ s.title }}</h2>
              <div class="mt-[22px] flex flex-col gap-[22px]">
                <div v-if="s.id === 'content'" :class="CARD">
                  <RequestContent :detail="detail" />
                </div>

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

                <QuoteCard
                  v-else-if="s.id === 'quotes' && printQuote !== null"
                  :quote="printQuote"
                  :request-id="detail.requestId"
                  print
                />

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
          <template v-for="k in pageCount - 1" :key="`mask${String(k)}`">
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
