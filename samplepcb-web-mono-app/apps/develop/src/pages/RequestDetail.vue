<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { developAreaBadge, developWishLabel } from '@sp/api-contract';
import type { DevelopDocDecisionType, DevelopEventViewType, DevelopFileMetaType, MarketFileMetaType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { FilePreviewModal } from '@sp/ui';
import type { PreviewTarget } from '@sp/ui';
import {
  developFilesPath,
  useAcceptQuote,
  useCancelDevelopRequest,
  useCheckoutMilestone,
  useDeclineQuote,
  useDecideDocument,
  useDeliveryDecision,
  useDevelopRequest,
  usePostComment,
  useReviewRequestDecision,
} from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { downloadAuthedFile } from '../lib/download';
import { errorCode, errorMessage } from '../lib/error-msg';
import { addDaysKst, dateDotFull, dateShort, nextActionLabel, statusLabel, statusToneClass } from '../lib/format';
import ProgressStepper from '../components/detail/ProgressStepper.vue';
import RequestContent from '../components/detail/RequestContent.vue';
import QuoteCard from '../components/detail/QuoteCard.vue';
import Timeline from '../components/detail/Timeline.vue';
import AttachmentList from '../components/detail/AttachmentList.vue';
import CommentComposer from '../components/detail/CommentComposer.vue';
import DecisionPanel from '../components/detail/DecisionPanel.vue';
import ProjectProgress from '../components/detail/ProjectProgress.vue';
import DocumentList from '../components/detail/DocumentList.vue';
import DevelopReview from '../components/detail/review/DevelopReview.vue';

// 의뢰 상세(docs/DEVELOP_FLOW.md §7.2) — 소유자 전용. 서버가 **공개본만** 내려주므로(초안·작업본은 어떤
// 응답에도 없다) 화면은 온 것을 그대로 그린다. 고객 행동: 견적 수락·수정 요청(QuoteCard), 마일스톤 결제(영카트
// 주문서로 이동), 문의·A/S(CommentComposer), 납품 검수와 중간 확인 응답(타임라인 슬롯), 프로젝트 문서 회신.
// 화면 = 피그마 「개발 의뢰」 00-3 의뢰 상세(Design done 70:5924 등 탭형, 사용자 결정 2026-10-22):
// 제목·정보 줄 → 스텝퍼 → 탭(한 번에 한 섹션, 번호 제목). 탭은 URL 해시(#quotes 등)와 맞물린다 — 내 의뢰의
// 할 일 버튼·타임라인 문서번호가 그 탭을 연다. 첨부는 없으면 탭째 숨기고, 종결된 의뢰는 진행 현황 탭이 없다.
// '출력하기'(프레젠테이션 인쇄)는 별도 작업으로 미뤘다.

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const loggedIn = computed(() => auth.isLoggedIn);
const requestId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});

const detailQ = useDevelopRequest(requestId, loggedIn);
const detail = computed(() => detailQ.data.value?.data);
const viewer = computed(() => detail.value?.viewer ?? null);
const areaBadge = computed(() => (detail.value === undefined ? '' : developAreaBadge(detail.value.serviceAreas)));
const closed = computed(() => detail.value?.status === 'cancelled' || detail.value?.status === 'declined');

// ── 탭 ─────────────────────────────────────────────────────────────────────
type TabId = 'content' | 'review' | 'quotes' | 'documents' | 'timeline' | 'files';
interface Tab {
  id: TabId;
  label: string; // 탭 줄
  title: string; // 섹션 제목(번호 앞에 붙는다)
}
const tabs = computed<Tab[]>(() => {
  const d = detail.value;
  if (d === undefined) return [];
  const list: Tab[] = [
    { id: 'content', label: '상세 의뢰 내용', title: '상세 의뢰 내용' },
    { id: 'review', label: 'AI 사전 검토서', title: 'AI 사전 검토서' },
    { id: 'quotes', label: '견적서', title: '견적서' },
  ];
  if (!closed.value) list.push({ id: 'documents', label: '진행 현황·문서', title: '진행 현황 · 프로젝트 문서' });
  list.push({ id: 'timeline', label: '진행·문의', title: '진행 · 문의' });
  if (d.files.length > 0) list.push({ id: 'files', label: '첨부', title: '첨부 자료' });
  return list;
});
const activeTab = ref<TabId>('content');
const activeIndex = computed(() => tabs.value.findIndex((t) => t.id === activeTab.value));
const activeTitle = computed(() => {
  const t = tabs.value[activeIndex.value];
  return t === undefined ? '' : `${String(activeIndex.value + 1)}. ${t.title}`;
});

// 해시 → 탭. 옛 앵커(#diagram·#files 없음 등)는 가까운 탭으로, 없는 탭이면 첫 탭.
const HASH_ALIAS: Record<string, TabId> = { '#diagram': 'review' };
function tabFromHash(hash: string): TabId | null {
  const id = HASH_ALIAS[hash] ?? (hash.startsWith('#') ? hash.slice(1) : '');
  return tabs.value.some((t) => t.id === id) ? (id as TabId) : null;
}
watch(
  [() => route.hash, tabs],
  () => {
    const t = tabFromHash(route.hash);
    if (t !== null) activeTab.value = t;
    else if (!tabs.value.some((x) => x.id === activeTab.value)) activeTab.value = 'content';
  },
  { immediate: true },
);
function selectTab(id: TabId): void {
  activeTab.value = id;
  void router.replace({ hash: `#${id}` });
}

// ── AI 산출물(공개본) ───────────────────────────────────────────────────────
const reviewPendingNote = computed<string>(() => {
  const d = detail.value;
  if (d === undefined) return '';
  if (!d.aiConsent) return 'AI 분석에 동의하지 않으셨습니다 — 담당자 검토로 진행합니다.';
  if (d.status === 'received' || d.status === 'reviewing') return '담당자가 검토 중입니다. 검토서는 검토 후 공개됩니다.';
  return '이 의뢰는 검토서 없이 상담으로 진행되고 있습니다.';
});
const reviewVersionLabel = computed(() => {
  const seq = detail.value?.reviewPublicSeq ?? null;
  return seq === null ? '' : `v${String(seq)} 공개본`;
});

// 잠긴 산출물이 실제로 있을 때만 안내한다 — viewer.deliverablesLocked 는 잔금 전이면 늘 참이라
// 아직 산출물이 없는 단계에서도 켜져 있다(그때 안내하면 없는 파일을 기다리게 만든다).
const lockedNote = computed(
  () => (detail.value?.viewer.deliverablesLocked ?? false) && (detail.value?.events ?? []).some((e) => e.files.some((f) => f.locked)),
);

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
// 문서 첨부는 MarketFileMeta(잠금 개념이 없다) — 같은 파일 라우트를 쓰므로 최소 필드만 넘긴다.
async function downloadDocFile(f: MarketFileMetaType): Promise<void> {
  fileError.value = '';
  try {
    await downloadAuthedFile(`${filesPath.value}/${String(f.fileId)}`, f.name);
  } catch (err) {
    fileError.value = errorMessage(err);
  }
}
function previewDocFile(f: MarketFileMetaType): void {
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

// ── 견적 · 결제 ─────────────────────────────────────────────────────────────
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

// 납품 확정 안내의 잔금 문장 — 잔금 조건이 '납품 시'면 이미 결제할 수 있고, '완료 시'면 확정 뒤에 열린다.
// (예전 문구 "확정하시면 … 잔금 결제가 열립니다"는 기본 조건 '납품 시'에서 사실과 달랐다.)
const balanceNote = computed(() => {
  const ms = (detail.value?.quotes ?? []).filter((q) => q.status === 'accepted').flatMap((q) => q.milestones);
  if (ms.some((m) => m.payable)) return '잔금은 견적서 탭에서 지금 결제하실 수 있습니다.';
  if (ms.some((m) => m.trigger === 'on_completion' && m.status !== 'paid' && m.status !== 'cancelled')) return '확정 뒤 잔금 결제가 열립니다.';
  return '';
});
const deliveryHint = computed(() =>
  ['확정하시면 개발이 완료됩니다.', balanceNote.value, autoConfirmOn.value === '' ? '' : `${autoConfirmOn.value}까지 회신이 없으면 자동으로 확정됩니다.`]
    .filter((s) => s !== '')
    .join(' '),
);

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

// ── 프로젝트 문서(§13) ──────────────────────────────────────────────────────
// 결정 응답은 **상세 전체**라(납품확인서 승인이면 completed 로 바뀐다) 훅이 캐시를 갈아 끼우고
// 스텝퍼·nextAction 이 함께 따라온다 — 여기서는 어느 문서에서 난 오류인지만 들고 있으면 된다.
const decideDocument = useDecideDocument(requestId);
const decidingDocId = ref<number | null>(null);
const documentError = ref('');
const BEFORE_START = ['received', 'reviewing', 'quoted', 'accepted'] as const;
const documentsEmpty = computed(() => {
  const d = detail.value;
  if (d === undefined) return false;
  return d.documents.length === 0 && (BEFORE_START as readonly string[]).includes(d.status);
});

// 회신 대기(승인형 sent) 문서 — 배너의 "확인하러 가기" 대상이자 건수.
const pendingDocs = computed(() => (detail.value?.documents ?? []).filter((d) => d.approval && d.status === 'sent'));

async function onDecideDocument(p: { documentId: number; decision: DevelopDocDecisionType; note: string; name: string }): Promise<void> {
  decidingDocId.value = p.documentId;
  documentError.value = '';
  try {
    await decideDocument.mutateAsync(p);
  } catch (err) {
    documentError.value = errorMessage(err);
    void detailQ.refetch(); // DOC_NOT_OPEN 은 이미 답한 문서라 재조회로 화면을 맞춘다
  }
}

async function scrollToPendingDoc(): Promise<void> {
  selectTab('documents');
  await nextTick();
  const first = pendingDocs.value[0];
  const el = first === undefined ? null : document.getElementById(`document-${String(first.documentId)}`);
  el?.scrollIntoView({ behavior: 'smooth' });
}

const CARD = 'rounded-[14px] bg-white px-[24px] py-[26px] shadow-[0_8px_15px_rgba(0,0,0,0.06)]';
const SMALL_BTN = 'flex h-[34px] items-center justify-center rounded-[6px] bg-[#f0f4fa] px-[10px] text-[14px] leading-[1.3] text-[#0a151e] transition-colors hover:bg-[#e2e8f2]';
</script>

<template>
  <section class="px-5 pb-[60px] pt-[60px] tracking-normal">
    <div class="mx-auto w-full max-w-[1280px]">
      <!-- 비로그인 -->
      <div v-if="!loggedIn" class="border-y border-[#d9d9d9] px-[10px] py-[60px] text-center">
        <p class="text-[15px] leading-[1.3] text-[#666]">의뢰 상세는 로그인 후 확인할 수 있습니다.</p>
        <button
          type="button"
          class="mt-[20px] h-[34px] rounded-[6px] bg-[#1b2b39] px-[14px] text-[14px] font-medium leading-[1.3] text-white transition-colors hover:bg-[#0a151e]"
          @click="goLogin"
        >
          로그인
        </button>
      </div>

      <p v-else-if="detailQ.isPending.value" class="border-y border-[#d9d9d9] px-[10px] py-[60px] text-center text-[15px] text-[#666]">
        {{ $t('common.loading') }}
      </p>

      <div v-else-if="detailQ.isError.value || detail === undefined" class="border-y border-[#d9d9d9] px-[10px] py-[60px] text-center">
        <p class="text-[15px] font-semibold text-red-700">{{ errorMessage(detailQ.error.value, '의뢰를 불러오지 못했습니다.') }}</p>
        <RouterLink
          :to="{ name: 'me' }"
          class="mt-[20px] inline-flex h-[34px] items-center rounded-[6px] border border-[#d9d9d9] px-[14px] text-[14px] text-[#0a151e] hover:border-[#9aa3ad]"
        >
          내 의뢰로
        </RouterLink>
      </div>

      <template v-else>
        <!-- 제목 · 소유자 액션 -->
        <header class="flex flex-wrap items-start justify-between gap-x-[16px] gap-y-[10px]">
          <h1 class="min-w-0 text-[22px] font-bold leading-[1.3] text-[#141e34] sm:text-[26px]">{{ detail.title }}</h1>
          <div class="flex shrink-0 gap-[10px]">
            <RouterLink v-if="viewer?.canEdit === true" :to="{ name: 'request-edit', params: { id: String(detail.requestId) } }" :class="SMALL_BTN">
              의뢰 수정
            </RouterLink>
            <button v-if="viewer?.canCancel === true && !cancelOpen" type="button" :class="SMALL_BTN" @click="cancelOpen = true">
              의뢰 취소
            </button>
          </div>
        </header>
        <div class="mt-[12px] h-px bg-[#0a151e]" />
        <div class="flex min-h-[50px] flex-wrap items-center gap-x-[30px] gap-y-[6px] px-[10px] py-[8px] text-[14px] leading-[1.3] text-[#141e34]">
          <p><span>개발분야 : </span><span class="font-medium">{{ areaBadge }}</span></p>
          <p><span>접수일자 : </span><span class="font-medium">{{ dateDotFull(detail.createdAt) }}</span></p>
          <p class="flex items-center gap-[6px]">
            <span>진행상태 :</span>
            <span class="rounded-[37px] px-[8px] py-[4px] text-[12px] font-semibold" :class="statusToneClass[detail.status]">{{ statusLabel(detail.status) }}</span>
            <span v-if="detail.nextAction !== null" class="rounded-[37px] bg-[#1b6ff3] px-[8px] py-[4px] text-[12px] font-semibold text-white">
              {{ nextActionLabel(detail.nextAction) }}
            </span>
          </p>
        </div>
        <div class="h-px bg-[#d8d8d8]" />

        <!-- 취소 인라인 확인 -->
        <div v-if="cancelOpen" class="mt-[20px] flex flex-col gap-[10px] rounded-[10px] border border-[#d9d9d9] p-[16px]">
          <p class="text-[16px] font-bold leading-[1.3] text-black">이 의뢰를 취소할까요?</p>
          <p class="text-[14px] leading-[1.8] text-[#666]">취소하면 담당자에게 알림이 갑니다. 되돌리려면 새로 의뢰를 등록하셔야 합니다.</p>
          <label class="flex flex-wrap items-center gap-[10px]">
            <span class="text-[14px] font-semibold text-black">사유</span>
            <select v-model="cancelReason" class="h-[34px] rounded-[6px] border border-[#d9d9d9] bg-white px-[10px] text-[14px] text-[#0a151e]">
              <option v-for="r in CANCEL_REASONS" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
          <input
            v-model="cancelNote"
            type="text"
            maxlength="400"
            placeholder="덧붙일 말씀이 있으면 적어 주세요 (선택)"
            class="h-[34px] rounded-[6px] border border-[#d9d9d9] bg-white px-[10px] text-[14px] text-[#0a151e]"
          >
          <p v-if="cancelError !== ''" class="text-[14px] font-semibold text-red-700">{{ cancelError }}</p>
          <div class="flex flex-wrap gap-[10px]">
            <button
              type="button"
              class="flex h-[34px] items-center rounded-[6px] bg-red-600 px-[14px] text-[14px] font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              :disabled="cancel.isPending.value"
              @click="void submitCancel()"
            >
              {{ cancel.isPending.value ? '취소 중…' : '의뢰 취소' }}
            </button>
            <button
              type="button"
              class="flex h-[34px] items-center rounded-[6px] border border-[#d9d9d9] bg-white px-[14px] text-[14px] text-[#0a151e] hover:border-[#9aa3ad]"
              @click="cancelOpen = false"
            >
              그만두기
            </button>
          </div>
        </div>

        <!-- 스텝퍼 / 종결 배지 -->
        <div v-if="!closed" class="mt-[24px] px-[10px] lg:px-[30px]">
          <ProgressStepper :status="detail.status" />
        </div>
        <div v-else class="mt-[20px] flex flex-col gap-[4px] rounded-[10px] bg-[#f5f6f8] px-[16px] py-[14px] leading-[1.8]">
          <p class="text-[15px] font-bold text-black">
            {{ detail.status === 'cancelled' ? '취소된 의뢰입니다' : '진행이 어려운 의뢰로 안내드렸습니다' }}
            <span v-if="detail.cancelledAt !== null" class="font-normal text-[#666]"> · {{ dateShort(detail.cancelledAt) }}</span>
          </p>
          <p v-if="detail.cancelReason !== null" class="text-[14px] text-[#141e34]">사유 · {{ detail.cancelReason }}</p>
          <p v-if="detail.declinedReason !== null" class="text-[14px] text-[#141e34]">사유 · {{ detail.declinedReason }}</p>
        </div>

        <!-- 탭 -->
        <nav class="print-hidden relative mt-[24px] overflow-x-auto" aria-label="의뢰 상세 탭">
          <span class="absolute bottom-0 left-0 h-px w-full min-w-max bg-[#d9d9d9]" aria-hidden="true" />
          <ul class="relative flex min-w-max gap-[14px]" role="tablist">
            <li v-for="t in tabs" :key="t.id">
              <button
                type="button"
                role="tab"
                :aria-selected="activeTab === t.id"
                class="relative block h-[31px] whitespace-nowrap px-[5px] text-[16px] leading-[22px]"
                :class="activeTab === t.id ? 'font-semibold text-[#05f]' : 'text-[#323232] hover:text-black'"
                @click="selectTab(t.id)"
              >
                {{ t.label }}
                <span v-if="activeTab === t.id" class="absolute bottom-[2px] left-0 h-[3px] w-full bg-[#05f]" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </nav>

        <div class="pt-[40px] lg:px-[40px]">
          <h2 class="text-[22px] font-bold leading-[1.3] text-black">{{ activeTitle }}</h2>
          <p v-if="fileError !== ''" class="mt-[16px] rounded-[10px] bg-red-50 px-[16px] py-[12px] text-[14px] font-semibold text-red-700">{{ fileError }}</p>

          <div class="mt-[22px] flex flex-col gap-[22px]">
            <!-- 1. 상세 의뢰 내용 -->
            <div v-if="activeTab === 'content'" :class="CARD">
              <RequestContent :detail="detail" />
            </div>

            <!-- 2. AI 사전 검토서 -->
            <DevelopReview
              v-else-if="activeTab === 'review'"
              :review="detail.review"
              :diagram-html="detail.diagram?.html ?? null"
              :diagram-uploaded="detail.diagram?.source === 'upload'"
              :diagram-generated-at="detail.diagram?.meta?.generatedAt ?? detail.diagram?.publishedAt ?? null"
              :version-label="reviewVersionLabel"
              :pending-note="reviewPendingNote"
              :wish-label="developWishLabel(detail.wishDate, detail.wishNote)"
            />

            <!-- 3. 견적서 -->
            <template v-else-if="activeTab === 'quotes'">
              <template v-if="detail.quotes.length > 0">
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
              </template>
              <div v-else :class="CARD" class="flex flex-col gap-[4px] leading-[1.8]">
                <p class="text-[15px] font-bold text-black">아직 견적서가 없습니다</p>
                <p class="text-[15px] text-[#141e34]">
                  {{ detail.status === 'received' || detail.status === 'reviewing' ? '담당자가 요구사항을 정리한 뒤 항목별 견적서를 보내드립니다.' : '담당자에게 문의해 주세요.' }}
                </p>
              </div>
            </template>

            <!-- 4. 진행 현황 · 프로젝트 문서 -->
            <template v-else-if="activeTab === 'documents'">
              <div v-if="documentsEmpty" :class="CARD" class="flex flex-col gap-[4px] leading-[1.8]">
                <p class="text-[15px] font-bold text-black">착수 뒤 진행 현황이 표시됩니다.</p>
                <p class="text-[15px] text-[#141e34]">아직 받으신 프로젝트 문서가 없습니다. 담당자가 착수 확인서·검토·승인서·진행보고를 보내면 여기에 모입니다.</p>
              </div>
              <template v-else>
                <div
                  v-if="detail.progress.pendingApprovals > 0"
                  class="flex flex-wrap items-center justify-between gap-[12px] rounded-[10px] border border-[#d7deec] bg-[#f1f6ff] px-[16px] py-[14px]"
                >
                  <p class="text-[16px] font-bold leading-[1.3] text-black">담당자가 확인을 요청한 문서 {{ detail.progress.pendingApprovals }}건이 있습니다</p>
                  <button
                    type="button"
                    class="flex h-[34px] items-center rounded-[6px] bg-[#212121] px-[14px] text-[14px] font-medium text-white transition-opacity hover:opacity-85"
                    @click="void scrollToPendingDoc()"
                  >
                    확인하러 가기
                  </button>
                </div>
                <div :class="CARD" class="flex flex-col gap-[16px]">
                  <ProjectProgress :progress="detail.progress" :status="detail.status" />
                  <DocumentList
                    :documents="detail.documents"
                    :request-id="detail.requestId"
                    :contact-name="detail.contact.name"
                    :deciding-doc-id="decidingDocId"
                    :decide-pending="decideDocument.isPending.value"
                    :decide-error="documentError"
                    :balance-note="balanceNote"
                    @decide="void onDecideDocument($event)"
                    @download="void downloadDocFile($event)"
                    @preview="previewDocFile"
                  />
                </div>
              </template>
            </template>

            <!-- 5. 진행 · 문의 -->
            <div v-else-if="activeTab === 'timeline'" :class="CARD" class="flex flex-col gap-[26px]">
              <CommentComposer
                v-if="canComment"
                ref="composer"
                :can-request-as="canRequestAs"
                :pending="postComment.isPending.value"
                :error="commentError"
                @submit="void onComment($event)"
              />
              <div class="flex flex-col gap-[16px]">
                <h3 class="text-[18px] font-medium leading-[1.3] text-black">진행 사항</h3>
                <p v-if="lockedNote" class="rounded-[10px] bg-[#f5f6f8] px-[16px] py-[12px] text-[14px] leading-[1.8] text-[#141e34]">
                  🔒 표시된 산출물은 잔금 결제가 확인되면 바로 내려받으실 수 있습니다. 파일명과 크기는 미리 보실 수 있습니다.
                </p>
                <Timeline :events="detail.events" @download="void download($event)" @preview="openPreview" @open-documents="selectTab('documents')">
                  <template #event-actions="{ event }">
                    <!-- 납품 검수 — delivered 상태의 최종 산출물 이벤트에만 -->
                    <DecisionPanel
                      v-if="event.eventId === deliveryEventId"
                      class="mt-2"
                      primary-label="검수 확정"
                      secondary-label="수정 요청"
                      :hint="deliveryHint"
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
              </div>
            </div>

            <!-- 6. 첨부 자료 -->
            <div v-else-if="activeTab === 'files'" :class="CARD">
              <AttachmentList :files="detail.files" @download="void download($event)" @preview="openPreview" />
            </div>
          </div>
        </div>

        <FilePreviewModal
          :open="previewFile !== null"
          :files-path="filesPath"
          :file="previewFile"
          @close="previewFile = null"
          @download="downloadFromPreview"
        />
      </template>
    </div>
  </section>
</template>
