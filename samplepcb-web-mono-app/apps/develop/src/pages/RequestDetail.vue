<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { DEV_DIAGRAM_VERSION, marketAreaBadge } from '@sp/api-contract';
import type {
  DevelopEventViewType,
  DevelopFileMetaType,
  DevelopPublicDiagramType,
  MarketDevDiagramType,
  MarketDevDiagramViewType,
} from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { DevDiagramSection, DevReviewView, FilePreviewModal } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import {
  developFilesPath,
  useAcceptQuote,
  useCancelDevelopRequest,
  useCheckoutMilestone,
  useDeclineQuote,
  useDeliveryDecision,
  useDevelopRequest,
  usePostComment,
  useReviewRequestDecision,
} from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { downloadAuthedFile } from '../lib/download';
import { errorCode, errorMessage } from '../lib/error-msg';
import { addDaysKst, dateShort, dateTimeKst, nextActionLabel, statusLabel, statusToneClass } from '../lib/format';
import ProgressStepper from '../components/detail/ProgressStepper.vue';
import RequestContent from '../components/detail/RequestContent.vue';
import QuoteCard from '../components/detail/QuoteCard.vue';
import Timeline from '../components/detail/Timeline.vue';
import AttachmentList from '../components/detail/AttachmentList.vue';
import CommentComposer from '../components/detail/CommentComposer.vue';
import DecisionPanel from '../components/detail/DecisionPanel.vue';

// 의뢰 상세(docs/DEVELOP_FLOW.md §7.2) — 소유자 전용. 서버가 **공개본만** 내려주므로(초안·작업본은 어떤
// 응답에도 없다) 화면은 온 것을 그대로 그린다. P2 에서 고객 행동이 붙었다: 견적 수락·거절(QuoteCard),
// 마일스톤 결제(영카트 주문서로 이동), 문의·A/S(CommentComposer), 납품 검수와 중간 확인 응답(타임라인 슬롯).
// 레이아웃: 헤더(상태·스텝퍼·소유자 액션) → sticky 섹션 내비(사이트 헤더 64px 아래) → 섹션 6.

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const requestId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});

const detailQ = useDevelopRequest(requestId, loggedIn);
const detail = computed(() => detailQ.data.value?.data);
const viewer = computed(() => detail.value?.viewer ?? null);
const areaBadge = computed(() => (detail.value === undefined ? '' : marketAreaBadge(detail.value.serviceAreas)));
const closed = computed(() => detail.value?.status === 'cancelled' || detail.value?.status === 'declined');

// ── AI 산출물(공개본) ───────────────────────────────────────────────────────
// DevReviewView 는 구성도를 자기 섹션 안에 그린다(끄는 prop 이 없다). 그래서 검토서가 있으면 구성도를
// 그 안으로 넣고, 검토서가 없을 때만 구성도를 단독 섹션으로 그린다 — 두 곳에 같은 도면이 뜨지 않게.
// 담당자 교체 업로드(source='upload')는 DevReviewView 로 `uploaded` 를 넘길 수 없어, 메타를 "담당자 작성"
// 으로 합성하고 섹션 아래 한 줄로 출처를 밝힌다(단독 섹션일 때는 uploaded 를 그대로 켠다).
const baseMeta = (d: DevelopPublicDiagramType): MarketDevDiagramType => ({
  version: DEV_DIAGRAM_VERSION,
  status: 'done',
  jobId: null,
  model: d.source === 'upload' ? '담당자 작성' : '',
  promptVersion: '',
  think: '—',
  requestedAt: d.publishedAt,
  generatedAt: d.publishedAt,
  elapsedSecs: null,
  attempt: 1,
  audit: null,
  error: null,
  skipReason: null,
  corpusChars: 0,
});
const diagramView = computed<MarketDevDiagramViewType | null>(() => {
  const d = detail.value?.diagram ?? null;
  if (d === null) return null;
  return { meta: d.source === 'upload' ? baseMeta(d) : (d.meta ?? baseMeta(d)), html: d.html };
});
const diagramUploaded = computed(() => detail.value?.diagram?.source === 'upload');
// 검토서가 없을 때만 구성도가 자기 섹션을 갖는다.
const standaloneDiagram = computed(() => (detail.value?.review ?? null) === null && diagramView.value !== null);

// 검토서가 아직 안 왔을 때의 안내 — 상태와 AI 동의 여부로 갈린다.
const reviewPendingNote = computed<string>(() => {
  const d = detail.value;
  if (d === undefined) return '';
  if (!d.aiConsent) return 'AI 분석에 동의하지 않으셨습니다 — 담당자 검토로 진행합니다.';
  if (d.status === 'received' || d.status === 'reviewing') return '담당자가 검토 중입니다. 검토서는 검토 후 공개됩니다.';
  return '이 의뢰는 검토서 없이 상담으로 진행되고 있습니다.';
});

// 잠긴 산출물이 실제로 있을 때만 안내한다 — viewer.deliverablesLocked 는 잔금 전이면 늘 참이라
// 아직 산출물이 없는 단계에서도 켜져 있다(그때 안내하면 없는 파일을 기다리게 만든다).
const lockedNote = computed(
  () => (detail.value?.viewer.deliverablesLocked ?? false) && (detail.value?.events ?? []).some((e) => e.files.some((f) => f.locked)),
);

// ── 섹션 내비 ──────────────────────────────────────────────────────────────
interface SectionLink {
  id: string;
  label: string;
}
const sections = computed<SectionLink[]>(() => {
  const d = detail.value;
  if (d === undefined) return [];
  const list: SectionLink[] = [{ id: 'content', label: '의뢰 내용' }];
  list.push({ id: 'review', label: 'AI 사전 검토서' });
  if (diagramView.value !== null) list.push({ id: standaloneDiagram.value ? 'diagram' : 'review', label: '시스템 구성도' });
  list.push({ id: 'quotes', label: '견적서' });
  list.push({ id: 'timeline', label: '진행 · 문의' });
  if (d.files.length > 0) list.push({ id: 'files', label: '첨부' });
  return list;
});

// ── 첨부(다운로드·미리보기) ────────────────────────────────────────────────
const filesPath = computed(() => developFilesPath(requestId.value ?? 0));
const previewFile = ref<PreviewTarget | null>(null);
const fileError = ref('');

async function download(f: DevelopFileMetaType): Promise<void> {
  fileError.value = '';
  try {
    await downloadAuthedFile(`${filesPath.value}/${String(f.fileId)}`, f.name);
  } catch (err) {
    fileError.value = errorMessage(err);
  }
}
function openPreview(f: DevelopFileMetaType): void {
  previewFile.value = { fileId: f.fileId, name: f.name, size: f.size };
}
function downloadFromPreview(fileId: number, name: string): void {
  void download({ fileId, name, size: 0, fileType: 'attachment', area: null, slot: null, locked: false });
}

// ── 취소(인라인 확인 — 네이티브 confirm 금지) ────────────────────────────────
const CANCEL_REASONS = [
  '직접 개발하기로 했습니다',
  '예산이 맞지 않습니다',
  '일정이 맞지 않습니다',
  '다른 곳에 맡기기로 했습니다',
  '기타',
] as const;
const cancelOpen = ref(false);
const cancelReason = ref<string>(CANCEL_REASONS[0]);
const cancelNote = ref('');
const cancelError = ref('');
const cancel = useCancelDevelopRequest(requestId);

async function submitCancel(): Promise<void> {
  cancelError.value = '';
  const note = cancelNote.value.trim();
  const reason = note === '' ? cancelReason.value : `${cancelReason.value} — ${note}`;
  try {
    await cancel.mutateAsync(reason);
    cancelOpen.value = false;
    cancelNote.value = '';
  } catch (err) {
    cancelError.value = errorMessage(err);
  }
}

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}

// ── P2 고객 행동 ────────────────────────────────────────────────────────────
// 에러는 한 자리에 모으되 어느 견적에서 났는지(actionQuoteId)를 같이 들고 있어야, 견적이 여러 장일 때
// 엉뚱한 카드에 빨간 줄이 뜨지 않는다.
const acceptQuote = useAcceptQuote(requestId);
const declineQuote = useDeclineQuote(requestId);
const checkout = useCheckoutMilestone(requestId);
const postComment = usePostComment(requestId);
const deliveryDecision = useDeliveryDecision(requestId);
const reviewDecision = useReviewRequestDecision(requestId);

const actionQuoteId = ref<number | null>(null);
const quoteError = ref('');
const payingMilestoneId = ref<number | null>(null);
const quoteErrorFor = (quoteId: number): string => (actionQuoteId.value === quoteId ? quoteError.value : '');

async function onAccept(p: { quoteId: number; name: string }): Promise<void> {
  actionQuoteId.value = p.quoteId;
  quoteError.value = '';
  try {
    await acceptQuote.mutateAsync(p);
  } catch (err) {
    quoteError.value = errorMessage(err);
    void detailQ.refetch();
  }
}

async function onDecline(p: { quoteId: number; reason: string }): Promise<void> {
  actionQuoteId.value = p.quoteId;
  quoteError.value = '';
  try {
    await declineQuote.mutateAsync(p);
  } catch (err) {
    quoteError.value = errorMessage(err);
    void detailQ.refetch();
  }
}

// 결제 — 주입 직전 me 를 다시 받아 JWT cartId 스테일을 막는다(마켓 계약 checkout 과 같은 관례).
// NO_CART_ID 는 그 클레임이 아예 없을 때라 한 번 더 부트스트랩하고 재시도한다.
async function onPay(quoteId: number, milestoneId: number): Promise<void> {
  actionQuoteId.value = quoteId;
  quoteError.value = '';
  payingMilestoneId.value = milestoneId;
  try {
    await auth.bootstrap();
    let res;
    try {
      res = await checkout.mutateAsync(milestoneId);
    } catch (err) {
      if (errorCode(err) !== 'NO_CART_ID') throw err;
      await auth.bootstrap();
      res = await checkout.mutateAsync(milestoneId);
    }
    window.location.assign(res.data.redirectUrl);
  } catch (err) {
    quoteError.value = errorMessage(err);
    void detailQ.refetch(); // ORDER_PENDING·ALREADY_PAID 는 재조회로 결제 파생을 갱신한다
  } finally {
    payingMilestoneId.value = null;
  }
}

// ── 문의·A/S ───────────────────────────────────────────────────────────────
const composer = ref<InstanceType<typeof CommentComposer> | null>(null);
const commentError = ref('');
const canComment = computed(() => detail.value !== undefined && !closed.value);
const canRequestAs = computed(() => detail.value?.status === 'completed');

async function onComment(p: { body: string; asRequest: boolean; files: File[] }): Promise<void> {
  commentError.value = '';
  try {
    await postComment.mutateAsync(p);
    composer.value?.reset();
  } catch (err) {
    commentError.value = errorMessage(err);
  }
}

// ── 검수 · 중간 확인 응답 ────────────────────────────────────────────────────
// payload 는 계약상 Record<string, unknown> 이라 좁혀서 읽는다(없는 키를 읽고 기본값으로 통과시키지 않게).
const payloadFlag = (e: DevelopEventViewType, key: string): boolean => e.payload?.[key] === true;
const payloadEventId = (e: DevelopEventViewType): number | null => {
  const v = e.payload?.eventId;
  return typeof v === 'number' ? v : null;
};

// 검수 대상 = delivered 상태에서 마지막 최종 납품 이벤트. final 표시가 없으면 마지막 산출물로 물러선다.
const deliveryEventId = computed<number | null>(() => {
  const d = detail.value;
  if (d?.status !== 'delivered') return null;
  const deliverables = d.events.filter((e) => e.type === 'deliverable');
  const finals = deliverables.filter((e) => payloadFlag(e, 'final'));
  const target = finals.length > 0 ? finals[finals.length - 1] : deliverables[deliverables.length - 1];
  return target === undefined ? null : target.eventId;
});

const autoConfirmOn = computed(() => {
  const d = detail.value;
  if (d?.deliveredAt === undefined || d.deliveredAt === null) return '';
  return addDaysKst(d.deliveredAt, d.reviewDays);
});

// 아직 답하지 않은 중간 확인 요청 — 그 뒤에 자기를 가리키는 승인·수정 요청 이벤트가 없는 것.
const pendingReviewIds = computed<number[]>(() => {
  const d = detail.value;
  if (d === undefined) return [];
  const answered = new Set<number>();
  for (const e of d.events) {
    if (e.type !== 'review_approved' && e.type !== 'review_changes') continue;
    const target = payloadEventId(e);
    if (target !== null) answered.add(target);
  }
  return d.events.filter((e) => e.type === 'review_request' && !answered.has(e.eventId)).map((e) => e.eventId);
});

const decisionError = ref('');

async function onDelivery(kind: 'primary' | 'secondary', note: string): Promise<void> {
  const eventId = deliveryEventId.value;
  if (eventId === null) return;
  decisionError.value = '';
  try {
    await deliveryDecision.mutateAsync({ eventId, decision: kind === 'primary' ? 'confirm' : 'changes', note });
  } catch (err) {
    decisionError.value = errorMessage(err);
  }
}

async function onReviewAnswer(eventId: number, kind: 'primary' | 'secondary', note: string): Promise<void> {
  decisionError.value = '';
  try {
    await reviewDecision.mutateAsync({ eventId, decision: kind === 'primary' ? 'approve' : 'changes', note });
  } catch (err) {
    decisionError.value = errorMessage(err);
  }
}

// 목록에서 "지금 할 일" 칩으로 들어오면 해당 섹션으로 — 데이터가 온 뒤라야 앵커가 존재한다.
watch(
  () => detailQ.isSuccess.value,
  async (ok) => {
    if (!ok || route.hash === '') return;
    await nextTick();
    document.querySelector(route.hash)?.scrollIntoView({ behavior: 'smooth' });
  },
  { immediate: true },
);
</script>

<template>
  <section class="mx-auto w-full max-w-[1080px] px-6 py-9">
    <!-- 비로그인 -->
    <div v-if="!loggedIn" class="rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body text-tx-2">의뢰 상세는 로그인 후 확인할 수 있습니다.</p>
      <button type="button" class="mt-5 h-11 rounded-lg bg-ink-950 px-6 text-body font-bold text-white transition hover:bg-brand-600" @click="goLogin">
        로그인
      </button>
    </div>

    <p v-else-if="detailQ.isPending.value" class="rounded-2xl border border-line bg-white px-6 py-16 text-center text-body text-tx-3">
      {{ $t('common.loading') }}
    </p>

    <div v-else-if="detailQ.isError.value || detail === undefined" class="rounded-2xl border border-line bg-white p-12 text-center">
      <p class="text-body font-semibold text-red-700">{{ errorMessage(detailQ.error.value, '의뢰를 불러오지 못했습니다.') }}</p>
      <RouterLink to="/me" class="mt-5 inline-block h-11 rounded-lg border border-line-2 px-6 text-body font-bold leading-[2.75rem] text-tx-2">
        내 의뢰로
      </RouterLink>
    </div>

    <template v-else>
      <!-- 헤더 -->
      <header class="grid gap-4">
        <div class="flex flex-wrap items-center gap-2">
          <span class="rounded-full px-2.5 py-1 text-micro font-bold" :class="statusToneClass[detail.status]">{{ statusLabel(detail.status) }}</span>
          <span v-if="detail.nextAction !== null" class="rounded-full bg-brand-500 px-2.5 py-1 text-micro font-bold text-white">
            {{ nextActionLabel(detail.nextAction) }}
          </span>
          <span class="font-mono text-micro tabular-nums text-tx-3">#{{ detail.requestId }} · 접수 {{ dateShort(detail.createdAt) }}</span>
        </div>
        <div class="flex flex-wrap items-start gap-3">
          <div class="min-w-0 grid gap-1.5">
            <h1 class="text-h1 font-extrabold leading-tight text-tx-1">{{ detail.title }}</h1>
            <p class="text-label font-semibold text-tx-3">{{ areaBadge }}</p>
          </div>
          <div class="ml-auto flex shrink-0 flex-wrap gap-2">
            <RouterLink
              v-if="viewer?.canEdit === true"
              :to="`/requests/${String(detail.requestId)}/edit`"
              class="h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold leading-10 text-tx-2 transition hover:border-tx-3"
            >
              의뢰 수정
            </RouterLink>
            <button
              v-if="viewer?.canCancel === true && !cancelOpen"
              type="button"
              class="h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold text-tx-3 transition hover:border-red-400 hover:text-red-600"
              @click="cancelOpen = true"
            >
              의뢰 취소
            </button>
          </div>
        </div>

        <ProgressStepper v-if="!closed" :status="detail.status" />
        <div v-else class="grid gap-1.5 rounded-xl bg-paper px-4 py-3.5">
          <p class="text-body font-bold text-tx-1">
            {{ detail.status === 'cancelled' ? '취소된 의뢰입니다' : '진행이 어려운 의뢰로 안내드렸습니다' }}
            <span v-if="detail.cancelledAt !== null" class="font-normal text-tx-3"> · {{ dateShort(detail.cancelledAt) }}</span>
          </p>
          <p v-if="detail.cancelReason !== null" class="text-label text-tx-2">사유 · {{ detail.cancelReason }}</p>
          <p v-if="detail.declinedReason !== null" class="text-label text-tx-2">사유 · {{ detail.declinedReason }}</p>
        </div>

        <!-- 취소 인라인 확인 -->
        <div v-if="cancelOpen" class="grid gap-3 rounded-2xl border-2 border-red-300 bg-white p-5">
          <p class="text-body font-extrabold text-tx-1">이 의뢰를 취소할까요?</p>
          <p class="text-label leading-relaxed text-tx-2">
            취소하면 담당자에게 알림이 갑니다. 되돌리려면 새로 의뢰를 등록하셔야 합니다.
          </p>
          <label class="grid gap-2">
            <span class="text-label font-semibold text-tx-2">사유</span>
            <select v-model="cancelReason" class="h-11 rounded-lg border border-line-2 bg-white px-3 text-body text-tx-1">
              <option v-for="r in CANCEL_REASONS" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
          <input
            v-model="cancelNote"
            type="text"
            maxlength="400"
            placeholder="덧붙일 말씀이 있으면 적어 주세요 (선택)"
            class="h-11 rounded-lg border border-line-2 bg-white px-3.5 text-body text-tx-1"
          >
          <p v-if="cancelError !== ''" class="text-body font-semibold text-red-700">{{ cancelError }}</p>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="h-10 rounded-lg bg-red-600 px-5 text-label font-bold text-white transition hover:bg-red-700 disabled:opacity-50"
              :disabled="cancel.isPending.value"
              @click="void submitCancel()"
            >
              {{ cancel.isPending.value ? '취소 중…' : '의뢰 취소' }}
            </button>
            <button
              type="button"
              class="h-10 rounded-lg border border-line-2 bg-white px-5 text-label font-bold text-tx-2 transition hover:border-tx-3"
              @click="cancelOpen = false"
            >
              그만두기
            </button>
          </div>
        </div>
      </header>

      <!-- 섹션 내비 — 사이트 헤더(64px) 아래 고정 -->
      <nav class="print-hidden sticky top-16 z-20 -mx-6 mt-7 border-y border-line bg-paper/95 px-6 backdrop-blur">
        <ul class="flex gap-1 overflow-x-auto py-2">
          <li v-for="s in sections" :key="s.label">
            <a :href="`#${s.id}`" class="inline-block whitespace-nowrap rounded-lg px-3 py-1.5 text-label font-semibold text-tx-2 transition hover:bg-white hover:text-tx-1">
              {{ s.label }}
            </a>
          </li>
        </ul>
      </nav>

      <p v-if="fileError !== ''" class="mt-5 rounded-xl bg-red-50 px-4 py-3 text-body font-semibold text-red-700">{{ fileError }}</p>

      <!-- 의뢰 내용 -->
      <section id="content" class="mt-8 scroll-mt-32 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 class="mb-5 text-title font-extrabold text-tx-1">의뢰 내용</h2>
        <RequestContent :detail="detail" />
      </section>

      <!-- AI 사전 검토서 (+ 구성도) -->
      <section id="review" class="mt-4 scroll-mt-32 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <template v-if="detail.review !== null">
          <DevReviewView
            :review="detail.review"
            :diagram="diagramView"
            :version-label="detail.reviewPublicSeq === null ? undefined : `v${String(detail.reviewPublicSeq)} 공개본`"
          />
          <p v-if="diagramUploaded" class="mt-3 rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-2">
            위 구성도는 담당자가 검토 후 직접 작성해 올린 도면입니다.
          </p>
          <p v-if="detail.reviewPublishedAt !== null" class="mt-3 font-mono text-micro text-tx-3">
            공개 {{ dateTimeKst(detail.reviewPublishedAt) }}
          </p>
        </template>
        <template v-else>
          <h2 class="text-title font-extrabold text-tx-1">AI 사전 검토서</h2>
          <p class="mt-2 max-w-2xl text-body leading-relaxed text-tx-2">{{ reviewPendingNote }}</p>
          <p class="mt-1.5 text-label leading-relaxed text-tx-3">
            검토서는 의뢰 자료로 만든 기술 초안입니다. 담당자가 확인한 뒤 공개되며, 확정 사항은 견적서에 담깁니다.
          </p>
        </template>
      </section>

      <!-- 시스템 구성도(검토서가 없을 때만 단독 섹션) -->
      <section v-if="standaloneDiagram && diagramView !== null" id="diagram" class="mt-4 scroll-mt-32 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <DevDiagramSection :diagram="diagramView" :uploaded="diagramUploaded" />
      </section>

      <!-- 견적서 -->
      <section id="quotes" class="mt-4 scroll-mt-32">
        <h2 class="mb-3 text-title font-extrabold text-tx-1">견적서</h2>
        <div v-if="detail.quotes.length > 0" class="grid gap-3">
          <QuoteCard
            v-for="q in detail.quotes"
            :key="q.quoteId"
            :quote="q"
            :request-id="detail.requestId"
            :contact-name="detail.contact.name"
            :accept-pending="acceptQuote.isPending.value"
            :decline-pending="declineQuote.isPending.value"
            :paying-milestone-id="payingMilestoneId"
            :action-error="quoteErrorFor(q.quoteId)"
            @accept="void onAccept($event)"
            @decline="void onDecline($event)"
            @pay="void onPay(q.quoteId, $event)"
          />
        </div>
        <div v-else class="rounded-2xl border border-dashed border-line-2 bg-white px-6 py-10 text-center">
          <p class="text-body font-semibold text-tx-1">아직 견적서가 없습니다</p>
          <p class="mx-auto mt-1.5 max-w-lg text-label leading-relaxed text-tx-3">
            <template v-if="detail.status === 'received' || detail.status === 'reviewing'">
              담당자가 요구사항을 정리한 뒤 항목별 견적서를 보내드립니다.
            </template>
            <template v-else>담당자에게 문의해 주세요.</template>
          </p>
        </div>
      </section>

      <!-- 진행 · 문의 -->
      <section id="timeline" class="mt-8 scroll-mt-32 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 class="mb-5 text-title font-extrabold text-tx-1">진행 · 문의</h2>
        <p v-if="lockedNote" class="mb-4 rounded-xl bg-paper px-4 py-3 text-label leading-relaxed text-tx-2">
          🔒 표시된 산출물은 잔금 결제가 확인되면 바로 내려받으실 수 있습니다. 파일명과 크기는 미리 보실 수 있습니다.
        </p>
        <CommentComposer
          v-if="canComment"
          ref="composer"
          class="mb-6"
          :can-request-as="canRequestAs"
          :pending="postComment.isPending.value"
          :error="commentError"
          @submit="void onComment($event)"
        />

        <Timeline :events="detail.events" @download="void download($event)" @preview="openPreview">
          <template #event-actions="{ event }">
            <!-- 납품 검수 — delivered 상태의 최종 산출물 이벤트에만 -->
            <DecisionPanel
              v-if="event.eventId === deliveryEventId"
              class="mt-2"
              primary-label="검수 확정"
              secondary-label="수정 요청"
              :hint="
                autoConfirmOn === ''
                  ? '확정하시면 개발이 완료되고 잔금 결제가 열립니다.'
                  : `확정하시면 개발이 완료되고 잔금 결제가 열립니다. ${autoConfirmOn}까지 회신이 없으면 자동으로 확정됩니다.`
              "
              :pending="deliveryDecision.isPending.value"
              :error="decisionError"
              @decide="(kind, note) => void onDelivery(kind, note)"
            />
            <!-- 중간 확인 요청 — 아직 답하지 않은 것에만 -->
            <DecisionPanel
              v-else-if="pendingReviewIds.includes(event.eventId)"
              class="mt-2"
              primary-label="확인 · 승인"
              secondary-label="수정 요청"
              hint="담당자가 중간 결과 확인을 요청했습니다. 승인하시면 다음 단계로 진행합니다."
              :pending="reviewDecision.isPending.value"
              :error="decisionError"
              @decide="(kind, note) => void onReviewAnswer(event.eventId, kind, note)"
            />
          </template>
        </Timeline>
      </section>

      <!-- 첨부 -->
      <section v-if="detail.files.length > 0" id="files" class="mt-4 scroll-mt-32 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 class="mb-4 text-title font-extrabold text-tx-1">첨부 자료</h2>
        <AttachmentList :files="detail.files" @download="void download($event)" @preview="openPreview" />
      </section>

      <FilePreviewModal
        :open="previewFile !== null"
        :files-path="filesPath"
        :file="previewFile"
        @close="previewFile = null"
        @download="downloadFromPreview"
      />
    </template>
  </section>
</template>
