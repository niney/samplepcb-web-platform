<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  MARKET_BID_STATUS_LABELS,
  MARKET_BUDGET_RANGE_LABELS,
  MARKET_CAREER_RANGE_LABELS,
  MARKET_COMMON_CONDITIONS,
  MARKET_EXPERT_TYPE_LABELS,
  MARKET_METHOD_LABELS,
  apiRoutes,
  marketAreaBadge,
  marketSlotLabel,
  marketToolRows,
} from '@sp/api-contract';
import { MarketDevReview } from '@sp/api-contract';
import type { MarketBidSubmitBodyType } from '@sp/api-contract';
import { buildDevReviewBriefRows } from '@sp/utils';
import { useAuthStore } from '@sp/shared';
import BidFormModal from '../components/BidFormModal.vue';
import ContractCard from '../components/ContractCard.vue';
import { DevDiagramSection, DevReviewView, FilePreviewModal, canPreview, type PreviewTarget } from '@sp/ui';
import DeliverModal from '../components/DeliverModal.vue';
import NdaSignModal from '../components/NdaSignModal.vue';
import {
  useAwardBid,
  useCancelProject,
  useCloseProject,
  useMyBid,
  useProjectBids,
  useSignNda,
  useSubmitBid,
  useUpdateMyBid,
  useWithdrawMyBid,
} from '../api/useMarketBids';
import {
  useCancelContract,
  useCheckout,
  useConfirm,
  useContractQuery,
  useDeliver,
} from '../api/useMarketContract';
import {
  useMarketProjectDetail,
  useProjectRevisions,
  useRegenerateDevReview,
  useRequestDevDiagram,
  useUpdateProject,
} from '../api/useMarketProjects';
import { useAiJob, useDevReviewStatus } from '../api/useAi';
import { useMarketSettings } from '../api/useMarketSettings';
import { downloadAuthedFile } from '../lib/download';
import { errorMessage } from '../lib/error-msg';
import { loginUrl, marketPath } from '../lib/auth-urls';
import { dateShort, ddayBadge, ddayToneClass, won } from '../lib/market-format';

// 프로젝트 상세 — 역할별 표면(docs/AI_DEV_REVIEW.md §13.9 재설계):
//   비로그인: 열람 + 로그인 유도 / 전문가: NDA 서명·첨부 열람·블라인드 견적 제출·수정·철회
//   소유자: 받은 견적 비교·채택·조기마감·취소. 실제 강제는 서버 가드 — 여기는 UX 분기.
// 레이아웃: 1440px = 헤더(종이 위) → sticky 섹션 내비 → 본문(카드 6: 의뢰 내용·검토서·구성도·첨부·견적) + 360px sticky 사이드.
// sticky 섹션 내비는 사이트 헤더(64px) 아래 top-16 로 고정한다(MarketLayout 헤더가 z-40 라 z-20 내비가 깔리지 않도록).
// 답변 표는 "의뢰 내용" 한 곳에만(검토서 안 고객 의뢰내용은 §13.9 에서 제거).

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();
const projectId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});

const detailQ = useMarketProjectDetail(projectId);
const detail = computed(() => detailQ.data.value?.data);
const viewer = computed(() => detail.value?.viewer ?? null);
const isOwner = computed(() => viewer.value?.isOwner === true);

// 분야 배지 — 의뢰 유형(개별/시스템 통합) 표기를 대체한다(docs/AI_DEV_REVIEW.md §4).
// 전체서비스 입찰 제한(FULL_SERVICE_COMPANY_ONLY)은 폐지되어 개인 전문가도 입찰한다.
const areaBadge = computed(() => (detail.value === undefined ? '' : marketAreaBadge(detail.value.serviceAreas)));
// 희망 툴(분야별)·질문 답변(브리프 행) — 검토서가 없어도 보인다. 조건 3(완료 시점·목표 단계·인도 범위)은 타일로, 나머지는 표로.
const toolRows = computed(() => (detail.value === undefined ? [] : marketToolRows(detail.value.tools, detail.value.serviceAreas)));
const briefRows = computed(() => (detail.value === undefined ? [] : buildDevReviewBriefRows(detail.value.answers)));
const isConditionCode = (code: string): boolean => MARKET_COMMON_CONDITIONS.some((q) => q.code === code);
const conditionRows = computed(() => briefRows.value.filter((r) => isConditionCode(r.code)));
const answerRows = computed(() => briefRows.value.filter((r) => !isConditionCode(r.code)));
// 첨부 — 일반 첨부 먼저, 분야별 슬롯 첨부는 "[슬롯 라벨]" 을 붙여 구분.
const fileSlotLabel = (f: { area: string | null; slot: string | null }): string =>
  f.area !== null && f.slot !== null ? marketSlotLabel(f.area, f.slot) : '';

// 응답 스키마는 .catch() 기본값을 쓰는 필드가 많아 zod 의 **입력** 타입으로 좁혀져 온다
// (@sp/shared apiGet 의 ZodType<T> 는 입력=출력을 요구한다). 이미 검증된 값을 같은
// 스키마로 한 번 더 통과시켜 출력 타입을 되찾는다 — 전부 idempotent 한 규칙이라 안전하다.
const devReview = computed(() => {
  const raw = detail.value?.devReview ?? null;
  return raw === null ? null : MarketDevReview.parse(raw);
});

const canBid = computed(() => {
  const d = detail.value;
  const v = viewer.value;
  if (d === undefined || v === null) return false;
  if (v.isOwner || !v.isApprovedExpert || d.biddingClosed) return false;
  return d.method === 'open' || v.isTargetExpert;
});
// NDA 서명 자격 = 입찰 자격과 동일 집합(서버와 동일 규칙).
const canSignNda = computed(() => {
  const d = detail.value;
  return canBid.value && d !== undefined && d.ndaRequired && viewer.value?.ndaSigned === false;
});

const bidsQ = useProjectBids(projectId, isOwner);
const isExpertViewer = computed(
  () => viewer.value?.isApprovedExpert === true && !isOwner.value,
);
const myBidQ = useMyBid(projectId, isExpertViewer);
const myBid = computed(() => myBidQ.data.value?.data ?? null);
const settingsQ = useMarketSettings();
const feeRateBp = computed(() => settingsQ.data.value?.data.feeRateBp ?? 1000);

// 계약(2차) — 당사자(viewer.contract 존재)일 때만 상세 조회.
const hasContract = computed(() => viewer.value?.contract != null);
const contractQ = useContractQuery(projectId, hasContract);
const contract = computed(() => contractQ.data.value?.data);

const submitBid = useSubmitBid();
const updateBid = useUpdateMyBid();
const withdrawBid = useWithdrawMyBid();
const awardBid = useAwardBid();
const signNda = useSignNda();
const closeProject = useCloseProject();
const cancelProject = useCancelProject();
const checkout = useCheckout();
const deliver = useDeliver();
const confirmContract = useConfirm();
const cancelContract = useCancelContract();
const updateProject = useUpdateProject(projectId);
const requestDiagram = useRequestDevDiagram(projectId);
const diagramError = ref('');
async function onRequestDiagram(): Promise<void> {
  diagramError.value = '';
  try {
    await requestDiagram.mutateAsync();
  } catch (err) {
    diagramError.value = errorMessage(err);
  }
}

// 모달·인라인 확인 상태 (네이티브 confirm 미사용 — 접근성·자동화 친화)
const ndaOpen = ref(false);
const bidOpen = ref(false);
const bidMode = ref<'create' | 'edit'>('create');
const modalError = ref('');
const actionError = ref('');
const confirmAwardId = ref<number | null>(null);
const confirmAction = ref<'close' | 'cancel' | 'withdraw' | 'remove-review' | null>(null);
const reportOpen = ref(false);
const reportError = ref('');

const dday = computed(() => (detail.value !== undefined ? ddayBadge(detail.value) : null));
const bids = computed(() => bidsQ.data.value?.data.items ?? []);

// 수정 이력(docs/MARKET_FLOW.md §의뢰 수정·버전) — 이력이 있을 때만 조회한다.
const hasRevisions = computed(() => (detail.value?.revisionCount ?? 0) > 0);
const revisionsQ = useProjectRevisions(projectId, hasRevisions);
const revisions = computed(() => revisionsQ.data.value?.data.items ?? []);
// 알림이 없는 대신 화면이 알린다: 내 견적 뒤에 중대한 수정이 있었다.
const myBidOutdated = computed(() => viewer.value?.myBidOutdated === true);
const majorRevisionCount = computed(() => revisions.value.filter((r) => r.major).length);

// AI 사전 검토서 재생성(§11.4) — 자동이 아니다. 소유자가 누를 때만 돌고, 완료 순간 서버가 프로젝트에 쓴다.
const aiStatus = useDevReviewStatus();
const canRegenerateReview = computed(
  () =>
    isOwner.value &&
    detail.value !== undefined &&
    !detail.value.biddingClosed &&
    aiStatus.data.value?.data.enabled === true,
);
const regenerateReview = useRegenerateDevReview(projectId);
const reviewJobId = ref<string | null>(null);
const reviewJob = useAiJob(reviewJobId);
const reviewRegenerating = computed(
  () => regenerateReview.isPending.value || reviewJob.data.value?.data.status === 'running',
);
const reviewError = ref('');

// 수정 화면에서 막 저장하고 온 경우(?saved=2&reviewJob=…) — "수정했습니다" 한 줄을 잠깐 띄우고,
// 편집 화면에서 시작한 재생성 잡을 이어받아 폴링한다(도착 즉시 진행 띠). 쿼리는 곧바로 지운다(§11.5).
const savedRev = ref<string | null>(null);
const queryValue = (key: string): string | null => {
  const q = route.query[key];
  const value = Array.isArray(q) ? q[0] : q;
  return typeof value === 'string' && value !== '' ? value : null;
};
onMounted(() => {
  const rev = queryValue('saved');
  const job = queryValue('reviewJob');
  if (job !== null) reviewJobId.value = job;
  if (rev === null && job === null) return;
  if (rev !== null) {
    savedRev.value = rev;
    window.setTimeout(() => (savedRev.value = null), 5000);
  }
  void router.replace({ path: route.path });
});

async function onRegenerateReview(): Promise<void> {
  reviewError.value = '';
  try {
    const res = await regenerateReview.mutateAsync();
    reviewJobId.value = res.data.jobId;
  } catch (err) {
    reviewError.value = errorMessage(err);
  }
}
// 잡이 끝나면 서버가 이미 프로젝트에 써 넣었다 — 상세만 다시 읽으면 새 검토서가 붙는다.
watch(
  () => reviewJob.data.value?.data.status,
  (status) => {
    if (status === 'done') void detailQ.refetch();
    if (status === 'error') reviewError.value = '검토서 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.';
  },
);
// 이어받은 잡을 못 찾는 경우(?reviewJob 이 낡았거나 서버가 잊었을 때, 404) — 진행 띠가 그냥 안 뜨면
// "왜 안 돌지" 가 남는다. 사정을 말하고 다시 만들기로 유도한다.
watch(
  () => reviewJob.error.value,
  (err) => {
    if (err !== null) reviewError.value = '검토서 생성 상태를 확인할 수 없습니다. 다시 만들기를 눌러 주세요.';
  },
);

// 구성도 카드를 검토서 밖에 따로 세우는 경우 — 검토서가 없고(있으면 그 안에 그린다) 메타가 있거나 소유자(만들기 버튼).
const standaloneDiagram = computed(
  () => devReview.value === null && detail.value !== undefined && (detail.value.devDiagram.meta !== null || isOwner.value),
);

// 섹션 내비 — 있는 섹션만, 스크롤 위치로 현재 섹션 표시.
const sections = computed(() => {
  const d = detail.value;
  if (d === undefined) return [];
  const list: { id: string; label: string; count: number | null }[] = [{ id: 'brief', label: '의뢰 내용', count: null }];
  if (devReview.value !== null) list.push({ id: 'review', label: 'AI 사전 검토서', count: null });
  if (standaloneDiagram.value) list.push({ id: 'diagram', label: '시스템 구성도', count: null });
  list.push({ id: 'files', label: '첨부', count: d.attachments.count });
  if (d.revisionCount > 0) list.push({ id: 'revisions', label: '수정 이력', count: d.revisionCount });
  if (isOwner.value) list.push({ id: 'bids', label: '받은 견적', count: d.bidCount });
  return list;
});
const activeSection = ref('brief');
let observer: IntersectionObserver | null = null;
function observeSections(): void {
  observer?.disconnect();
  if (typeof IntersectionObserver === 'undefined') return;
  observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) activeSection.value = e.target.id.replace(/^s-/, '');
    },
    { rootMargin: '-35% 0px -55% 0px' },
  );
  for (const s of sections.value) {
    const el = document.getElementById(`s-${s.id}`);
    if (el !== null) observer.observe(el);
  }
}
watch(sections, () => {
  void nextTick(observeSections);
}, { immediate: true });
onBeforeUnmount(() => observer?.disconnect());
function jumpTo(id: string): void {
  document.getElementById(`s-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function goLogin(): void {
  window.location.assign(loginUrl(marketPath(route.fullPath)));
}

function openBidModal(mode: 'create' | 'edit'): void {
  bidMode.value = mode;
  modalError.value = '';
  bidOpen.value = true;
}

async function onSignNda(signedName: string): Promise<void> {
  if (projectId.value === null) return;
  modalError.value = '';
  try {
    await signNda.mutateAsync({ projectId: projectId.value, body: { agree: true, signedName } });
    ndaOpen.value = false;
  } catch (err) {
    modalError.value = errorMessage(err);
  }
}

async function onSubmitBid(body: MarketBidSubmitBodyType): Promise<void> {
  if (projectId.value === null) return;
  modalError.value = '';
  try {
    if (bidMode.value === 'create') {
      await submitBid.mutateAsync({ projectId: projectId.value, body });
    } else {
      await updateBid.mutateAsync({ projectId: projectId.value, body });
    }
    bidOpen.value = false;
  } catch (err) {
    modalError.value = errorMessage(err);
  }
}

async function onWithdraw(): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await withdrawBid.mutateAsync(projectId.value);
    confirmAction.value = null;
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

async function onAward(bidId: number): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await awardBid.mutateAsync({ projectId: projectId.value, bidId });
    confirmAwardId.value = null;
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

async function onProjectAction(kind: 'close' | 'cancel'): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    if (kind === 'close') await closeProject.mutateAsync(projectId.value);
    else await cancelProject.mutateAsync(projectId.value);
    confirmAction.value = null;
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

async function downloadFile(fileId: number, name: string): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await downloadAuthedFile(
      `${apiRoutes.marketProjects}/${String(projectId.value)}/files/${String(fileId)}`,
      name,
    );
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

// 첨부 미리보기 — 열려 있는 파일 하나(null 이면 닫힘). 권한은 서버가 다운로드와 같은
// 게이트로 다시 판정하므로 여기서는 UX 분기만 한다.
const previewFile = ref<PreviewTarget | null>(null);

// ── 계약(2차) 액션 ──────────────────────────────────────────────────────────
async function onCheckout(): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    // 결제 직전 me 재발급 — JWT cartId 클레임이 10분 스테일이면 주입이 옛 버킷으로 감(거버 관례).
    await auth.bootstrap();
    const res = await checkout.mutateAsync(projectId.value);
    window.location.assign(res.data.redirectUrl);
  } catch (err) {
    actionError.value = errorMessage(err);
    // ORDER_PENDING(무통장 대기)·ALREADY_PAID 등은 계약 재조회로 결제 파생 상태를 갱신.
    void contractQ.refetch();
  }
}

async function onConfirmContract(): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await confirmContract.mutateAsync(projectId.value);
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

async function onCancelContract(): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await cancelContract.mutateAsync(projectId.value);
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

function openReport(): void {
  reportError.value = '';
  reportOpen.value = true;
}

async function onSubmitReport(payload: { note: string; files: File[] }): Promise<void> {
  if (projectId.value === null) return;
  reportError.value = '';
  const fd = new FormData();
  if (payload.note !== '') fd.append('note', payload.note);
  for (const f of payload.files) fd.append('deliverable', f);
  try {
    await deliver.mutateAsync({ projectId: projectId.value, form: fd });
    reportOpen.value = false;
  } catch (err) {
    reportError.value = errorMessage(err);
  }
}

async function downloadContractFile(fileId: number, name: string): Promise<void> {
  if (projectId.value === null) return;
  actionError.value = '';
  try {
    await downloadAuthedFile(
      `${apiRoutes.marketProjects}/${String(projectId.value)}/contract/files/${String(fileId)}`,
      name,
    );
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}

const fmtSize = (bytes: number): string =>
  bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)}MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toString()}KB`;

// AI 사전 검토서 제거 — 검토서는 원천(제목·설명·분야)과 항상 일치한다는 불변식이라
// 원천을 고치려면 먼저 떼야 한다. 본문 갱신 경로는 없고 계약이 여는 건 null(제거) 하나뿐이다.
async function onRemoveDevReview(): Promise<void> {
  actionError.value = '';
  try {
    await updateProject.mutateAsync({ devReview: null });
    await detailQ.refetch();
    confirmAction.value = null;
  } catch (err) {
    actionError.value = errorMessage(err);
  }
}
</script>

<template>
  <section class="mx-auto w-full max-w-[1440px] px-6 pb-20 pt-8">
    <div v-if="detailQ.isLoading.value" class="py-20 text-center text-body text-tx-3">
      {{ $t('common.loading') }}
    </div>

    <div v-else-if="detail === undefined" class="rounded-2xl border border-line bg-white p-14 text-center">
      <p class="text-body text-tx-3">프로젝트를 찾을 수 없습니다.</p>
      <RouterLink to="/projects" class="mt-4 inline-flex h-10 items-center rounded-lg bg-ink-900 px-5 text-body font-bold text-white hover:bg-ink-800">
        {{ $t('nav.projects') }}
      </RouterLink>
    </div>

    <template v-else>
      <!-- 헤더 — 종이 위에 바로(카드 없음) -->
      <header class="grid gap-3">
        <div class="flex flex-wrap items-center gap-2 text-micro font-bold">
          <span class="font-mono font-normal tracking-[.12em] text-tx-3">PRJ-{{ String(detail.projectId).padStart(4, '0') }}</span>
          <span v-if="dday !== null" class="rounded-full px-2.5 py-1" :class="ddayToneClass[dday.tone]">{{ dday.label }}</span>
          <span v-if="areaBadge !== ''" class="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">{{ areaBadge }}</span>
          <span class="rounded-full px-2.5 py-1" :class="detail.method === 'open' ? 'bg-copper-50 text-copper-700' : 'bg-ink-900 text-white'">
            {{ MARKET_METHOD_LABELS[detail.method] }}
          </span>
          <span v-if="detail.ndaRequired" class="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">🔏 NDA</span>
          <button
            v-if="detail.revisionCount > 0"
            type="button"
            class="rounded-full bg-ink-900 px-2.5 py-1 text-white transition hover:bg-ink-800"
            @click="jumpTo('revisions')"
          >
            수정됨 v{{ detail.revisionCount }}
            <span v-if="detail.lastRevisionAt !== null" class="font-normal opacity-80">· {{ dateShort(detail.lastRevisionAt) }}</span>
          </button>
        </div>
        <h1 class="text-h1 font-extrabold text-tx-1">{{ detail.title }}</h1>
        <div class="flex flex-wrap gap-x-5 gap-y-1 text-label text-tx-2">
          <span>의뢰인 <b class="font-semibold text-tx-1">{{ detail.ownerName }}</b></span>
          <span>예산 <b class="font-semibold text-tx-1">{{ MARKET_BUDGET_RANGE_LABELS[detail.budgetRange] }}</b></span>
          <span v-for="row in conditionRows" :key="row.code">
            {{ row.label }} <b class="font-semibold text-tx-1">{{ row.unknown ? '협의' : row.value }}</b>
          </span>
          <span>견적 마감 <b class="font-semibold text-tx-1">{{ dateShort(detail.bidDeadlineAt) }}</b></span>
          <span>견적 <b class="font-semibold tabular-nums text-tx-1">{{ detail.bidCount }}건</b></span>
          <span class="tabular-nums">조회 {{ detail.viewCount }}</span>
          <span>{{ dateShort(detail.createdAt) }} 등록</span>
        </div>
      </header>

      <!-- 방금 저장하고 넘어왔다 — 편집 화면이 아니라 결과가 있는 이 화면에서 확인시킨다(§11.5) -->
      <p
        v-if="savedRev !== null"
        class="mt-5 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-body font-bold"
        :class="savedRev === 'none' ? 'border-line-2 bg-paper text-tx-2' : 'border-emerald-200 bg-emerald-50 text-emerald-800'"
      >
        <span>{{ savedRev === 'none' ? '–' : '✓' }}</span>
        {{ savedRev === 'none' ? '바뀐 내용이 없어 그대로입니다' : `수정했습니다 — v${savedRev}` }}
      </p>

      <!-- 견적을 낸 뒤 의뢰가 바뀌었다 — 알림 기능이 없는 대신 이 배너가 알린다(§의뢰 수정·버전) -->
      <div v-if="myBidOutdated" class="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-4 text-amber-900">
        <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-200 text-body">⚠</span>
        <div class="min-w-0">
          <p class="text-lead font-extrabold">견적을 내신 뒤 의뢰 내용이 바뀌었습니다</p>
          <p class="text-label leading-relaxed">
            바뀐 내용을 확인하고 필요하면 견적을 다시 내 주세요.
            <span v-if="majorRevisionCount > 0">중대한 수정 {{ majorRevisionCount }}건</span>
          </p>
        </div>
        <div class="ml-auto flex flex-wrap gap-2">
          <button type="button" class="h-9 rounded-lg border border-amber-400 bg-white px-3.5 text-label font-bold text-amber-900 hover:border-amber-600" @click="jumpTo('revisions')">
            바뀐 내용 보기
          </button>
          <button v-if="canBid && myBid !== null" type="button" class="h-9 rounded-lg bg-amber-600 px-3.5 text-label font-bold text-white hover:bg-amber-700" @click="openBidModal('edit')">
            견적 수정
          </button>
        </div>
      </div>

      <!-- sticky 섹션 내비 -->
      <nav class="sticky top-16 z-20 mt-5 border-b border-line bg-paper">
        <div class="flex gap-1 overflow-x-auto">
          <button
            v-for="s in sections"
            :key="s.id"
            type="button"
            class="whitespace-nowrap border-b-2 px-3.5 py-3 text-label font-semibold transition"
            :class="activeSection === s.id ? 'border-copper-500 text-tx-1' : 'border-transparent text-tx-2 hover:text-tx-1'"
            @click="jumpTo(s.id)"
          >
            {{ s.label }}<span v-if="s.count !== null" class="ml-1 font-mono text-micro tabular-nums text-tx-3">{{ s.count }}</span>
          </button>
        </div>
      </nav>

      <div class="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <!-- 본문 -->
        <div class="grid gap-5">
          <!-- 의뢰 내용 — 설명 · 조건 타일 · 답변 표 · 희망 툴 (한 곳에만) -->
          <div id="s-brief" class="grid scroll-mt-32 gap-5 rounded-2xl border border-line bg-white p-6">
            <div>
              <p class="font-mono text-micro tracking-[.14em] text-tx-3">BRIEF</p>
              <h2 class="text-title font-extrabold text-tx-1">의뢰 내용</h2>
            </div>
            <p class="max-w-[900px] whitespace-pre-line text-lead leading-relaxed text-tx-1">{{ detail.description }}</p>
            <div v-if="conditionRows.length > 0" class="grid gap-2.5">
              <p class="text-label font-semibold text-tx-2">프로젝트 조건</p>
              <div class="grid gap-2.5 sm:grid-cols-3">
                <div v-for="row in conditionRows" :key="row.code" class="grid gap-0.5 rounded-xl border border-line bg-paper px-4 py-3">
                  <span class="text-micro font-semibold text-tx-3">{{ row.label }}</span>
                  <span class="text-body font-semibold text-tx-1">
                    <span v-if="row.unknown" class="rounded bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700">협의해서 정함</span>
                    <template v-else>{{ row.value }}</template>
                  </span>
                </div>
              </div>
            </div>
            <dl v-if="answerRows.length > 0 || toolRows.length > 0" class="grid overflow-hidden rounded-xl border border-line sm:grid-cols-[140px_1fr]">
              <template v-for="row in answerRows" :key="row.code">
                <dt class="border-t border-line px-4 pt-2.5 text-label font-semibold text-tx-3 first:border-t-0 sm:py-2.5">{{ row.label }}</dt>
                <dd class="px-4 pb-2.5 text-body font-semibold text-tx-1 sm:border-t sm:border-line sm:py-2.5">
                  <span v-if="row.unknown" class="rounded bg-amber-100 px-1.5 py-0.5 text-micro font-bold text-amber-700">상담에서 확정</span>
                  <template v-else>{{ row.value }}</template>
                </dd>
              </template>
              <dt class="border-t border-line px-4 pt-2.5 text-label font-semibold text-tx-3 sm:py-2.5">희망 툴·언어</dt>
              <dd class="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-2.5 text-body sm:border-t sm:border-line sm:py-2.5">
                <span v-for="r in toolRows" :key="r.area" class="text-tx-2">
                  {{ r.areaLabel }}
                  <span v-if="r.labels.length > 0" class="ml-1 rounded-full border border-line bg-paper px-2 py-0.5 text-micro font-bold text-tx-2">{{ r.labels.join(' · ') }}</span>
                  <span v-else class="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-micro font-bold text-emerald-700">전문가 추천</span>
                </span>
              </dd>
            </dl>
          </div>

          <!-- AI 사전 검토서 — 공개 범위는 상세 설명과 동일(상세를 볼 수 있는 뷰어 전원) -->
          <div v-if="devReview !== null" id="s-review" class="scroll-mt-32 rounded-2xl border border-line bg-white p-6">
            <!-- 검토서는 원천이 바뀌어도 지우지 않는다 — 어느 버전 기준인지 알리고, 갱신은 소유자가 고른다(§11.4) -->
            <div v-if="detail.devReviewStale" class="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-amber-900">
              <div class="min-w-0">
                <p class="text-body font-bold">이 검토서는 수정 전 내용으로 만들었습니다</p>
                <p class="text-label leading-relaxed">그 뒤 의뢰가 바뀌어 지금 내용과 다를 수 있습니다.</p>
              </div>
              <button
                v-if="canRegenerateReview"
                type="button"
                class="ml-auto h-9 shrink-0 rounded-lg bg-amber-600 px-3.5 text-label font-bold text-white transition hover:bg-amber-700 disabled:opacity-40"
                :disabled="reviewRegenerating"
                @click="onRegenerateReview"
              >
                {{ reviewRegenerating ? '다시 만드는 중…' : '새 내용으로 다시 만들기' }}
              </button>
            </div>
            <!-- 재생성 진행 — 기존 검토서는 그대로 두고 위에 얇은 띠만(완료되면 자리에서 바뀐다) -->
            <p v-if="reviewRegenerating" class="mb-4 flex items-center gap-2.5 rounded-xl bg-copper-50 px-4 py-3 text-label font-semibold text-copper-700">
              <span class="pulse-dot h-2 w-2 rounded-full bg-copper-500" />
              AI 가 새 내용으로 검토서를 다시 쓰고 있습니다 — 보통 30초~3분. 다 되면 이 자리에서 바뀝니다.
            </p>
            <p v-if="reviewError !== ''" class="mb-4 rounded-xl bg-red-50 px-4 py-3 text-label font-semibold text-red-700">{{ reviewError }}</p>
            <DevReviewView
              :review="devReview"
              :title="detail.title"
              :diagram="detail.devDiagram"
              :can-regenerate-diagram="isOwner"
              :diagram-regenerating="requestDiagram.isPending.value"
              :diagram-regenerate-error="diagramError"
              @regenerate-diagram="onRequestDiagram"
            />
            <div v-if="isOwner" class="mt-6 border-t border-line pt-5">
              <template v-if="confirmAction === 'remove-review'">
                <p class="text-body font-bold text-tx-2">AI 사전 검토서를 이 의뢰에서 제거할까요? 다시 붙일 수는 없습니다.</p>
                <div class="mt-2.5 flex gap-2">
                  <button type="button" class="h-9 rounded-lg bg-ink-900 px-3.5 text-label font-bold text-white disabled:opacity-40" :disabled="updateProject.isPending.value" @click="onRemoveDevReview">
                    {{ updateProject.isPending.value ? '제거 중…' : '검토서 제거' }}
                  </button>
                  <button type="button" class="h-9 rounded-lg border border-line-2 px-3.5 text-label font-bold text-tx-2" @click="confirmAction = null">취소</button>
                </div>
              </template>
              <button v-else type="button" class="h-9 rounded-lg border border-line-2 px-3.5 text-label font-bold text-tx-2 hover:border-tx-3" @click="confirmAction = 'remove-review'">
                검토서 제거
              </button>
              <p class="mt-2 text-label leading-relaxed text-tx-3">
                검토서가 붙어 있어도 의뢰는 수정할 수 있습니다 — 수정하면 “수정 전 내용” 안내가 붙고,
                원하실 때 새 내용으로 다시 만들 수 있습니다.
              </p>
            </div>
          </div>

          <!-- 시스템 구성도(§13.7) — 검토서가 없을 때만 별도 카드 -->
          <div v-if="standaloneDiagram" id="s-diagram" class="scroll-mt-32 rounded-2xl border border-line bg-white p-6">
            <DevDiagramSection
              :diagram="detail.devDiagram"
              :can-regenerate="isOwner"
              :regenerating="requestDiagram.isPending.value"
              :regenerate-error="diagramError"
              @regenerate="onRequestDiagram"
            />
          </div>

          <!-- 첨부 (NDA 게이트) -->
          <div id="s-files" class="grid scroll-mt-32 gap-4 rounded-2xl border border-line bg-white p-6">
            <div>
              <p class="font-mono text-micro tracking-[.14em] text-tx-3">FILES</p>
              <h2 class="text-title font-extrabold text-tx-1">첨부 자료 <span class="font-normal tabular-nums text-tx-3">{{ detail.attachments.count }}개</span></h2>
            </div>
            <template v-if="detail.attachments.files !== null">
              <ul v-if="detail.attachments.files.length > 0" class="grid gap-2">
                <li v-for="f in detail.attachments.files" :key="f.fileId" class="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-body">
                  <span>📎</span>
                  <span v-if="fileSlotLabel(f) !== ''" class="shrink-0 rounded-full border border-line bg-paper px-2 py-0.5 text-micro font-bold text-tx-2">{{ fileSlotLabel(f) }}</span>
                  <span class="min-w-0 flex-1 truncate text-tx-1">{{ f.name }}</span>
                  <span class="text-label tabular-nums text-tx-3">{{ fmtSize(f.size) }}</span>
                  <button v-if="auth.isLoggedIn && canPreview(f)" type="button" class="h-9 rounded-lg border border-line-2 px-3.5 text-label font-bold text-tx-2 hover:border-copper-400 hover:text-copper-600" @click="previewFile = { fileId: f.fileId, name: f.name, size: f.size }">
                    보기
                  </button>
                  <button v-if="auth.isLoggedIn" type="button" class="h-9 rounded-lg border border-line-2 px-3.5 text-label font-bold text-tx-2 hover:border-copper-400 hover:text-copper-600" @click="downloadFile(f.fileId, f.name)">
                    다운로드
                  </button>
                </li>
              </ul>
              <p v-else class="text-body text-tx-3">첨부된 자료가 없습니다.</p>
            </template>
            <div v-else class="rounded-2xl border border-dashed border-line-2 bg-paper px-6 py-7 text-center">
              <p class="text-body font-bold text-tx-1">🔏 NDA 서명 후 열람할 수 있습니다</p>
              <p class="mt-1 text-label leading-relaxed text-tx-3">파일명·내용은 비밀유지 서명자에게만 공개됩니다.</p>
              <button v-if="canSignNda" type="button" class="mt-3 h-10 rounded-lg bg-ink-900 px-5 text-body font-bold text-white hover:bg-ink-800" @click="ndaOpen = true">
                NDA 전자서명
              </button>
              <p v-else-if="viewer === null" class="mt-2 text-label text-tx-3">열람 자격(승인 전문가)은 로그인 후 확인됩니다.</p>
            </div>
          </div>

          <!-- 수정 이력 — 언제 무엇이 바뀌었나(첨부는 개수 변화만, 파일명은 NDA 게이트 뒤) -->
          <div v-if="detail.revisionCount > 0" id="s-revisions" class="grid scroll-mt-32 gap-4 rounded-2xl border border-line bg-white p-6">
            <div>
              <p class="font-mono text-micro tracking-[.14em] text-tx-3">REVISIONS</p>
              <h2 class="text-title font-extrabold text-tx-1">
                수정 이력 <span class="font-normal tabular-nums text-tx-3">{{ detail.revisionCount }}회</span>
              </h2>
              <p class="mt-1 text-label text-tx-3">의뢰인이 등록 뒤 고친 내용입니다. 중대한 수정은 견적을 낸 전문가에게 경고로 표시됩니다.</p>
            </div>
            <p v-if="revisionsQ.isPending.value" class="text-body text-tx-3">불러오는 중…</p>
            <ol v-else class="grid gap-3">
              <li v-for="r in revisions" :key="r.revNo" class="grid gap-2.5 rounded-xl border border-line bg-paper p-4">
                <div class="flex flex-wrap items-center gap-2 text-micro font-bold">
                  <span class="rounded-full bg-ink-900 px-2.5 py-1 text-white">v{{ r.revNo }}</span>
                  <span v-if="r.major" class="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">중대한 수정</span>
                  <span v-if="!r.byOwner" class="rounded-full bg-blue-50 px-2.5 py-1 text-blue-700">관리자 대행</span>
                  <span class="font-mono font-normal text-tx-3">{{ dateShort(r.createdAt) }}</span>
                </div>
                <dl class="grid gap-2">
                  <div v-for="c in r.changes" :key="c.field" class="grid gap-1 sm:grid-cols-[110px_1fr]">
                    <dt class="text-label font-semibold text-tx-3">{{ c.label }}</dt>
                    <dd class="grid gap-1 text-body text-tx-1">
                      <span class="whitespace-pre-line text-tx-3 line-through decoration-tx-3/40">{{ c.before }}</span>
                      <span class="whitespace-pre-line font-semibold">{{ c.after }}</span>
                    </dd>
                  </div>
                </dl>
              </li>
            </ol>
          </div>

          <!-- 소유자: 받은 견적 비교 -->
          <div v-if="isOwner" id="s-bids" class="grid scroll-mt-32 gap-4 rounded-2xl border border-line bg-white p-6">
            <div>
              <p class="font-mono text-micro tracking-[.14em] text-tx-3">BIDS</p>
              <h2 class="text-title font-extrabold text-tx-1">받은 견적 <span class="font-normal tabular-nums text-tx-3">{{ bids.length }}건</span></h2>
            </div>
            <div v-if="bids.length === 0" class="rounded-2xl border border-dashed border-line-2 px-6 py-7 text-center text-body text-tx-3">
              아직 도착한 견적이 없습니다. 견적이 오면 이메일로 알려드립니다.
            </div>
            <div v-else class="grid gap-3">
              <div v-for="b in bids" :key="b.bidId" class="rounded-2xl border p-5" :class="b.status === 'awarded' ? 'border-copper-400 bg-copper-50' : 'border-line'">
                <div class="flex flex-wrap items-center gap-2 text-body">
                  <b class="text-lead text-tx-1">{{ b.expert.displayName }}</b>
                  <span class="text-label text-tx-3">{{ MARKET_EXPERT_TYPE_LABELS[b.expert.expertType] }} · 경력 {{ MARKET_CAREER_RANGE_LABELS[b.expert.careerRange] }}</span>
                  <span
                    class="ml-auto rounded-full px-2.5 py-1 text-micro font-bold"
                    :class="b.status === 'awarded' ? 'bg-copper-500 text-white' : b.status === 'submitted' ? 'bg-blue-50 text-blue-700' : 'bg-line text-tx-3'"
                  >
                    {{ MARKET_BID_STATUS_LABELS[b.status] }}
                  </span>
                </div>
                <div class="mt-2.5 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-label text-tx-2">
                  <span>금액 <b class="text-title font-extrabold tabular-nums text-tx-1">{{ won(b.amount) }}</b></span>
                  <span>기간 <b class="font-semibold tabular-nums text-tx-1">{{ b.durationDays }}일</b></span>
                  <span v-if="b.warranty !== null">하자보수 {{ b.warranty }}</span>
                  <span class="text-tx-3">{{ dateShort(b.updatedAt) }} 제출</span>
                </div>
                <p class="mt-3 whitespace-pre-line rounded-xl bg-paper p-4 text-body leading-relaxed text-tx-2">{{ b.message }}</p>
                <div v-if="b.status === 'submitted' && detail.status !== 'awarded' && detail.status !== 'cancelled'" class="mt-3 flex items-center justify-end gap-2">
                  <template v-if="confirmAwardId === b.bidId">
                    <span class="text-label font-bold text-tx-2">이 견적으로 확정할까요?</span>
                    <button type="button" class="h-9 rounded-lg bg-copper-500 px-3.5 text-label font-bold text-white hover:bg-copper-600 disabled:opacity-40" :disabled="awardBid.isPending.value" @click="onAward(b.bidId)">
                      {{ awardBid.isPending.value ? '처리 중…' : '확정' }}
                    </button>
                    <button type="button" class="h-9 rounded-lg border border-line-2 px-3.5 text-label font-bold text-tx-2" @click="confirmAwardId = null">취소</button>
                  </template>
                  <button v-else type="button" class="h-9 rounded-lg bg-ink-900 px-4 text-label font-bold text-white hover:bg-ink-800" @click="confirmAwardId = b.bidId">채택</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 사이드바 -->
        <aside class="grid gap-4 lg:sticky lg:top-32">
          <!-- 비로그인 -->
          <div v-if="viewer === null" class="rounded-2xl border border-line bg-white p-5 text-center">
            <p class="text-lead font-bold text-tx-1">견적을 제출하려면</p>
            <p class="mt-1 text-label text-tx-3">로그인 후 전문가 자격이 확인됩니다.</p>
            <button type="button" class="mt-3 h-11 w-full rounded-lg bg-ink-900 px-4 text-body font-bold text-white hover:bg-ink-800" @click="goLogin">
              {{ $t('auth.login') }}
            </button>
          </div>

          <!-- 계약 진행(당사자: 의뢰인·채택 전문가) — 채택 후 결제·납품·검수·정산 -->
          <template v-else-if="viewer.contract !== null">
            <ContractCard
              v-if="contract !== undefined"
              :contract="contract"
              :is-owner="isOwner"
              :checkout-pending="checkout.isPending.value"
              :confirm-pending="confirmContract.isPending.value"
              :cancel-pending="cancelContract.isPending.value"
              :error="actionError"
              @checkout="onCheckout"
              @confirm="onConfirmContract"
              @cancel="onCancelContract"
              @report="openReport"
              @download="downloadContractFile"
            />
            <div v-else class="rounded-2xl border border-line bg-white p-5 text-body text-tx-3">계약 정보를 불러오는 중…</div>
          </template>

          <!-- 소유자 액션 -->
          <div v-else-if="isOwner" class="grid gap-3 rounded-2xl border border-line bg-white p-5">
            <p class="font-mono text-micro tracking-[.14em] text-tx-3">MY PROJECT</p>
            <p class="text-lead font-bold text-tx-1">받은 견적 <span class="tabular-nums">{{ detail.bidCount }}</span>건</p>
            <p class="text-label leading-relaxed text-tx-3">채택하면 나머지 견적은 자동 종결됩니다. 마감 전에는 언제든 조기 마감할 수 있습니다.</p>
            <div class="grid gap-2">
              <!-- 의뢰 수정 — 접수 중이면 견적이 있어도 고칠 수 있다(수정 이력이 남고 입찰자에게 경고가 뜬다) -->
              <RouterLink
                v-if="detail.status === 'bidding' && !detail.biddingClosed"
                :to="`/projects/${String(detail.projectId)}/edit`"
                class="flex h-10 items-center justify-center rounded-lg border border-line-2 px-4 text-body font-bold text-tx-2 transition hover:border-tx-3"
              >
                의뢰 수정
              </RouterLink>
              <template v-if="detail.status === 'bidding' && !detail.biddingClosed">
                <template v-if="confirmAction === 'close'">
                  <p class="text-label font-bold text-tx-2">견적 접수를 조기 마감할까요?</p>
                  <div class="flex gap-2">
                    <button type="button" class="h-10 flex-1 rounded-lg bg-ink-900 px-3 text-label font-bold text-white" :disabled="closeProject.isPending.value" @click="onProjectAction('close')">확인</button>
                    <button type="button" class="h-10 flex-1 rounded-lg border border-line-2 px-3 text-label font-bold text-tx-2" @click="confirmAction = null">취소</button>
                  </div>
                </template>
                <button v-else type="button" class="h-10 rounded-lg bg-ink-900 px-4 text-body font-bold text-white hover:bg-ink-800" @click="confirmAction = 'close'">조기 마감</button>
              </template>
              <template v-if="detail.status !== 'cancelled' && detail.status !== 'awarded'">
                <template v-if="confirmAction === 'cancel'">
                  <p class="text-label font-bold text-red-600">프로젝트를 취소할까요? 되돌릴 수 없습니다.</p>
                  <div class="flex gap-2">
                    <button type="button" class="h-10 flex-1 rounded-lg bg-red-600 px-3 text-label font-bold text-white" :disabled="cancelProject.isPending.value" @click="onProjectAction('cancel')">취소 확정</button>
                    <button type="button" class="h-10 flex-1 rounded-lg border border-line-2 px-3 text-label font-bold text-tx-2" @click="confirmAction = null">닫기</button>
                  </div>
                </template>
                <button v-else type="button" class="h-10 rounded-lg border border-red-200 px-4 text-body font-bold text-red-500 hover:border-red-400" @click="confirmAction = 'cancel'">프로젝트 취소</button>
              </template>
            </div>
          </div>

          <!-- 전문가 액션 -->
          <div v-else class="grid gap-3 rounded-2xl border border-line bg-white p-5">
            <p class="text-lead font-bold text-tx-1">견적 제출</p>

            <!-- 내 입찰 있음 -->
            <template v-if="myBid !== null">
              <div class="rounded-xl bg-paper p-4 text-label text-tx-2">
                <p>내 견적: <b class="text-body text-tx-1">{{ won(myBid.amount) }}</b> · {{ myBid.durationDays }}일</p>
                <p class="mt-1">상태: <b class="text-copper-600">{{ MARKET_BID_STATUS_LABELS[myBid.status] }}</b></p>
              </div>
              <div v-if="(myBid.status === 'submitted' || myBid.status === 'withdrawn') && !detail.biddingClosed" class="grid gap-2">
                <button type="button" class="h-11 rounded-lg bg-ink-900 px-4 text-body font-bold text-white hover:bg-ink-800" @click="openBidModal('edit')">
                  {{ myBid.status === 'withdrawn' ? '다시 제출' : '견적 수정' }}
                </button>
                <template v-if="myBid.status === 'submitted'">
                  <template v-if="confirmAction === 'withdraw'">
                    <p class="text-label font-bold text-tx-2">견적을 철회할까요?</p>
                    <div class="flex gap-2">
                      <button type="button" class="h-10 flex-1 rounded-lg bg-ink-900 px-3 text-label font-bold text-white" :disabled="withdrawBid.isPending.value" @click="onWithdraw">확인</button>
                      <button type="button" class="h-10 flex-1 rounded-lg border border-line-2 px-3 text-label font-bold text-tx-2" @click="confirmAction = null">취소</button>
                    </div>
                  </template>
                  <button v-else type="button" class="h-10 rounded-lg border border-line-2 px-4 text-label font-bold text-tx-2 hover:border-tx-3" @click="confirmAction = 'withdraw'">철회</button>
                </template>
              </div>
            </template>

            <!-- 입찰 가능 -->
            <template v-else-if="canBid">
              <p class="text-label leading-relaxed text-tx-3">
                견적은 의뢰인만 볼 수 있습니다(블라인드).
                <template v-if="detail.ndaRequired && viewer.ndaSigned === false">첨부 열람에는 NDA 서명이 필요합니다.</template>
              </p>
              <button type="button" class="h-11 w-full rounded-lg bg-copper-500 px-4 text-body font-bold text-white hover:bg-copper-600" @click="openBidModal('create')">
                블라인드 견적 제출
              </button>
              <button v-if="canSignNda" type="button" class="h-10 w-full rounded-lg border border-line-2 px-4 text-label font-bold text-tx-2 hover:border-tx-3" @click="ndaOpen = true">
                🔏 NDA 서명하고 첨부 열람
              </button>
            </template>

            <!-- 자격 없음 -->
            <template v-else>
              <p class="text-label leading-relaxed text-tx-3">
                <template v-if="detail.biddingClosed">견적 접수가 마감되었습니다.</template>
                <template v-else-if="detail.method === 'targeted' && viewer.isTargetExpert === false">지정견적 프로젝트 — 지정된 전문가만 참여할 수 있습니다.</template>
                <template v-else-if="viewer.isApprovedExpert === false">승인된 전문가만 견적을 제출할 수 있습니다.</template>
              </p>
              <RouterLink v-if="viewer.isApprovedExpert === false" to="/expert/register" class="flex h-11 items-center justify-center rounded-lg bg-ink-900 px-4 text-body font-bold text-white hover:bg-ink-800">
                {{ $t('nav.expertRegister') }}
              </RouterLink>
            </template>
          </div>

          <!-- 시스템 구성도 상태(검토서 안에 있으면 그 상태를 요약) -->
          <div v-if="detail.devDiagram.meta !== null" class="grid gap-2 rounded-2xl border border-line bg-white p-5">
            <p class="text-lead font-bold text-tx-1">시스템 구성도</p>
            <p class="text-label leading-relaxed text-tx-3">
              <template v-if="detail.devDiagram.meta.status === 'done'">완성됐습니다. 검토서 섹션에서 크게 볼 수 있습니다.</template>
              <template v-else-if="detail.devDiagram.meta.status === 'queued' || detail.devDiagram.meta.status === 'running'">만드는 중입니다(보통 5~10분). 완성되면 알림과 메일로 알려드립니다.</template>
              <template v-else-if="detail.devDiagram.meta.status === 'skipped'">자료가 부족해 만들지 않았습니다. 자료가 늘면 다시 만들 수 있습니다.</template>
              <template v-else>생성에 실패했습니다. 검토서 섹션에서 다시 만들 수 있습니다.</template>
            </p>
          </div>

          <!-- 안전거래 안내 (계약 전) -->
          <div v-if="viewer?.contract == null" class="grid gap-2 rounded-2xl bg-ink-900 p-5 text-label leading-relaxed text-dk-tx-2">
            <p class="font-mono text-micro tracking-[.14em] text-dk-tx-2/70">ESCROW</p>
            <p class="text-lead font-bold text-dk-tx-1">안전거래 안내</p>
            <p>견적은 블라인드로 보호되고, NDA 서명 기록이 남습니다. 계약·결제는 채택 후 샘플피씨비가 순차 안내드립니다.</p>
          </div>

          <p v-if="actionError !== '' && viewer?.contract == null" class="text-body font-semibold text-red-600">{{ actionError }}</p>
        </aside>
      </div>

      <!-- 모달 -->
      <NdaSignModal
        :open="ndaOpen"
        :nda-text="detail.ndaText"
        :nda-version="detail.ndaTextVersion"
        :pending="signNda.isPending.value"
        :error="modalError"
        @close="ndaOpen = false"
        @sign="onSignNda"
      />
      <BidFormModal
        :open="bidOpen"
        :mode="bidMode"
        :initial="myBid"
        :fee-rate-bp="feeRateBp"
        :pending="submitBid.isPending.value || updateBid.isPending.value"
        :error="modalError"
        @close="bidOpen = false"
        @submit="onSubmitBid"
      />
      <DeliverModal
        :open="reportOpen"
        :is-report="contract !== undefined && contract.status === 'delivered'"
        :pending="deliver.isPending.value"
        :error="reportError"
        @close="reportOpen = false"
        @submit="onSubmitReport"
      />
      <FilePreviewModal
        v-if="projectId !== null"
        :open="previewFile !== null"
        :files-path="`${apiRoutes.marketProjects}/${String(projectId)}/files`"
        :file="previewFile"
        @close="previewFile = null"
        @download="downloadFile"
      />
    </template>
  </section>
</template>

<style scoped>
/* 검토서 재생성 진행 표시 — 구성도 섹션과 같은 점 펄스(§11.4) */
.pulse-dot { animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
@media (prefers-reduced-motion: reduce) { .pulse-dot { animation: none; } }
</style>
