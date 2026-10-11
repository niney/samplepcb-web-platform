<script setup lang="ts">
// EQ 고객 확인 작업공간(D20) — Case 위에 뜨는 **넓은 오른쪽 패널**(전체 높이, 최대 1400px). 정본
// docs/PCB_PARTNER_TRACK.md 「D20 설계」. 형식은 BOM D43 작성 패널(ConfirmComposePanel)과 같다 — 2026-09-30
// 사용자가 가운데 팝업을 거부하고 고른 모양이라 같은 일은 같은 모양으로 한다(D20-3):
//   머리(발주·협력사·회차 전환·상태·근거 첨부)·바닥(상태별 버튼) 고정, 몸통 3열(문항 목록 | 문항 편집 |
//   고객 미리보기·활동)이 **각자** 스크롤. 1280px 미만은 3열을 편집 칸의 탭으로 접고, 모바일은 목록 위·편집 아래.
//
// 흐름: 회차 없음·직전 회차 닫힘 + EQ 승인요청 → [새 회차 시작](직접 작성 | 직전 회차에서 가져오기 | AI(P2) |
// 간단 문구) → 초안 편집·임시저장(PUT 통째 교체) → [고객에게 보내기] → 고객 회신 | [대리 회신] →
// [협력사에 전달] → [고객 회신대로 EQ 승인](기존 eq-approve) 또는 개정 EQ 요청(기존 반려 → 새 회차).
// D20 후속 — 승인은 회신 온 미전달 회차를 협력사에 **함께 전달**한다(R-1, 수동 전달은 승인 전에 협력사 의견을 먼저
// 들을 때). 승인 뒤 협력사가 [추가 EQ 요청]으로 EQ 를 다시 열 수 있고(R-2), 그렇게 다시 올라온 승인요청이면 새 회차
// 카드가 협력사의 사유를 근거로 보여 준다.
//
// 초안은 서버에 있다(draft) — 이 패널이 들고 있는 것은 **저장 안 된 변경**뿐이다(회차별 버퍼). 닫아도 같은 Case
// 화면 안에서는 남고('작성 이어가기'), 화면을 떠날 때만 묻는다. 저장·발송·회신·전달은 version 을 맞춰야 해서
// 다른 곳에서 바뀌면 409 VERSION_CONFLICT — "새로 불러오기"로 서버 판을 다시 받는다(내 변경은 버린다).
//
// D20 P2 — 협력사가 승인요청을 누르면 서버가 EQ 엑셀을 자동 분석해 초안을 만든다(유스케이스가 켜져 있을 때).
// 이 패널은 그 잡의 상태(목록 응답의 `ai`·`aiEnabled`)를 띠로 보이고(분석 중·안 됨·결과 준비), 분석 중이면 열려
// 있는 동안 목록을 다시 읽는다. AI 초안은 배지 'AI 초안 · 검토 필요'와 문항별 검토 표시(aiFlags)로 구분한다 —
// 자동은 초안까지고 고객 발송은 관리자 검토 뒤다(D20-1).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';
import { useQueryClient } from '@tanstack/vue-query';
import {
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  MessageSquareTextIcon,
  PencilLineIcon,
  RefreshCwIcon,
  SparklesIcon,
} from '@lucide/vue';
import {
  PCB_EQ_FILE_LABELS,
  PCB_PO_STATUS_LABELS,
  pcbEqReplyFileName,
  lastPcbEqReworkBoundary,
  type AdminPcbEqCommentTranslationBodyType,
  type AdminPcbEqProxyAnswerBodyType,
  type AdminPcbPoViewType,
} from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { fmtKstDate, kstToday } from '@sp/utils';
import { downloadAdminPcbEqFile } from '@/admin/useAdminPcbPos';
import DialogScrollBody from '@/next/components/common/DialogScrollBody.vue';
import Panel from '@/next/components/common/Panel.vue';
import { Alert, AlertDescription } from '@/next/components/ui/alert';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { Checkbox } from '@/next/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/next/components/ui/dialog';
import { Field, FieldLabel } from '@/next/components/ui/field';
import { Input } from '@/next/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/next/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger } from '@/next/components/ui/tabs';
import { Textarea } from '@/next/components/ui/textarea';
import { pcbPoStatusVariant } from '@/next/components/pcb/pcb-badges';
import { NEXT_CORE_ROUTES } from '@/next/core-navigation';
import { confirmDialog, pendingConfirm, pendingPrompt } from '@/next/lib/dialog';
import EqActivity from './EqActivity.vue';
import EqAiBanner from './EqAiBanner.vue';
import EqCustomerPreview from './EqCustomerPreview.vue';
import EqItemEditor from './EqItemEditor.vue';
import EqItemList from './EqItemList.vue';
import EqLooseFigures from './EqLooseFigures.vue';
import EqProxyAnswerDialog from './EqProxyAnswerDialog.vue';
import {
  draftBody,
  draftFromView,
  draftSaveProblem,
  draftSendProblem,
  eqRoundBadge,
  isDraftDirty,
  isOpenReview,
  newItem,
  openAiFlags,
  sharedFigureCount,
  type EqFigureDraft,
  type EqItemDraft,
  type EqRoundDraft,
} from './eq-round';
import { createEqFigureUrls, downloadAdminPcbEqReply, useAdminPcbEqRounds, useEqRoundMutations } from './useAdminPcbEqRounds';

const props = defineProps<{
  open: boolean;
  /** 열린 발주서 — 부모가 **목록에서 찾은 최신 행**을 넘긴다(상태·첨부가 바뀌면 따라온다). */
  po: AdminPcbPoViewType | null;
  specId: number | null;
  projectName: string;
  /** 부모가 이 패널 위에 띄운 대화상자(반려·간단 문구)가 열려 있다 — 그동안 바깥 클릭으로 닫히지 않게. */
  overlayOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
  /** [고객 회신대로 EQ 승인] — 기존 승인 경로(확인창 규칙 포함)는 Case 가 갖고 있다. */
  approve: [po: AdminPcbPoViewType];
  /** 개정 EQ 요청 — 기존 반려 대화상자(EqRejectDialog). */
  reject: [po: AdminPcbPoViewType];
  /** [간단 문구로 묻기] — D16 문구형 패널(EqReviewPanel). */
  simple: [po: AdminPcbPoViewType];
  /** 저장 안 된 변경이 있는 발주서 — 행 버튼이 '작성 이어가기'가 된다. */
  dirty: [poIds: number[]];
}>();

const mut = useEqRoundMutations();
const queryClient = useQueryClient();
const urls = createEqFigureUrls();

const poId = computed(() => props.po?.poId ?? null);
// 분석 중(ai.status='running')이면 패널이 열려 있는 동안만 목록을 다시 읽는다 — 닫혀 있으면 폴링하지 않는다.
const roundsQuery = useAdminPcbEqRounds(
  poId,
  computed(() => props.po !== null),
  computed(() => props.open),
);
const reviews = computed(() => roundsQuery.data.value?.data.reviews ?? []);
/** 문항형 회차(번호 있는 것만 — 안 나간 채 닫힌 초안은 번호도 고객 흔적도 없다), 오래된 것 먼저. */
const rounds = computed(() =>
  reviews.value.filter((r) => r.format === 'items' && r.roundNo !== null).sort((a, b) => a.id - b.id),
);
const messageReviews = computed(() => reviews.value.filter((r) => r.format === 'message'));
const openReview = computed(() => reviews.value.find(isOpenReview) ?? null);
/** 직전 회차에서 가져올 원천이 있는가 — 서버 규칙: 문항 ≥1 인 최신 문항형 회차(안 나간 초안 포함). */
const hasCopySource = computed(() => reviews.value.some((r) => r.format === 'items' && r.items.length > 0));
const nextRoundNo = computed(() => Math.max(0, ...rounds.value.map((r) => r.roundNo ?? 0)) + 1);

/** 새 회차를 열 수 있는가 — 서버 NOT_EQ_REQUESTED·ALREADY_OPEN 의 화면 미러(+ MD 위임 상위는 하위에서). */
const startable = computed(
  () =>
    props.po !== null &&
    props.po.status === 'eq_requested' &&
    props.po.eqDelegatePoId === null &&
    !props.po.eqBlocked &&
    openReview.value === null,
);

// ── AI 분석(D20 P2) ─────────────────────────────────────────────────────────────
/** 이번 승인요청의 최신 AI 분석(없으면 null)과 유스케이스 on/off(설정 > AI 연동). */
const ai = computed(() => roundsQuery.data.value?.data.ai ?? null);
const aiEnabled = computed(() => roundsQuery.data.value?.data.aiEnabled ?? false);
/** 분석할 파일이 있는가 — 협력사 EQ 질의서(서버 NO_SOURCE 의 화면 미러. 형식 판정은 서버가 한다). */
const aiHasSource = computed(() => (props.po?.eqFiles ?? []).some((f) => f.fileType === 'eq'));
/** 열린 문항형 초안 — AI 다시 분석·적용은 이 초안의 문항을 통째로 바꾼다(replaceDraft). */
const openDraft = computed(() => {
  const open = openReview.value;
  return open !== null && open.format === 'items' && open.status === 'draft' ? open : null;
});

// ── 회차 고르기 ────────────────────────────────────────────────────────────────
const selection = ref<number | 'new' | null>(null);
const selectedView = computed(() =>
  typeof selection.value === 'number' ? (rounds.value.find((r) => r.id === selection.value) ?? null) : null,
);

const loaded = computed(() => roundsQuery.data.value !== undefined);

/** 이번 EQ 승인요청이 올라온 시각 — 이 뒤에 만든 회차가 '지금' 회차다(그 전 회차의 회신은 지난 요청의 이력). */
const eqRequestedAt = computed((): number | null => {
  const times = (props.po?.eqHistory ?? []).filter((e) => e.toStatus === 'eq_requested').map((e) => Date.parse(e.at));
  return times.length === 0 ? null : Math.max(...times);
});

/** 이번 승인요청의 회차 — 가장 최근 회차가 열려 있거나 이번 요청 뒤에 만들어졌으면 그것(지난 요청의 회차는 null). */
const currentRound = computed(() => {
  const latest = rounds.value.at(-1) ?? null;
  if (latest === null) return null;
  const current =
    isOpenReview(latest) || eqRequestedAt.value === null || Date.parse(latest.requestedAt) >= eqRequestedAt.value;
  return current ? latest : null;
});

function defaultSelection(): number | 'new' | null {
  // 지금 할 일부터 연다 — 열린 회차·이번 요청의 회차(회신 도착·전달 필요 등)가 있으면 그것, 지난 요청의
  // 회차뿐이고 새로 시작할 수 있으면 새 회차 카드(지난 회차는 탭 한 번 거리), 아니면 최신 회차.
  if (currentRound.value !== null) return currentRound.value.id;
  const latest = rounds.value.at(-1) ?? null;
  if (latest !== null && !startable.value) return latest.id;
  return startable.value ? 'new' : null;
}

/**
 * AI 띠에 무엇을 보일까 — 분석 중이면 언제나, 안 됨·결과 준비는 **아직 고객에게 안 보낸 때만**(새로 시작할 수
 * 있거나 초안을 쓰는 중). 이번 요청의 회차를 이미 보냈으면 지난 분석 결과는 더 할 말이 아니다. 결과가 초안에
 * 들어갔으면(appliedReviewId) 띠 대신 회차 배지 'AI 초안 · 검토 필요'가 말한다.
 */
/**
 * 이번 승인요청이 **협력사의 추가 EQ 요청**으로 다시 올라온 것인가(D20 후속 R-2). 가장 최근 경계가 추가 EQ 요청이고
 * 발주가 승인요청 중이면 그 뒤의 요청이 지금 요청이다 — 협력사가 적은 사유가 새 회차에서 무엇이 바뀌었는지의 근거다.
 */
const reopenContext = computed(() => {
  if (props.po?.status !== 'eq_requested') return null;
  const boundary = lastPcbEqReworkBoundary(props.po.eqHistory);
  return boundary?.kind === 'reopen' ? boundary : null;
});

/** 이번 요청을 아직 고객에게 안 보냈다 — 새로 시작할 수 있거나 초안을 쓰는 중. */
const aiBeforeSend = computed(
  () =>
    props.po?.status === 'eq_requested' &&
    (startable.value || openDraft.value !== null) &&
    (currentRound.value === null || currentRound.value.status === 'draft'),
);
const aiBannerKind = computed((): 'running' | 'failed' | 'ready' | null => {
  const state = ai.value;
  if (state === null || props.po?.status !== 'eq_requested') return null;
  if (state.status === 'running') return 'running';
  if (!aiBeforeSend.value) return null;
  if (state.status === 'failed') return 'failed';
  return state.appliedReviewId === null ? 'ready' : null;
});
/**
 * 분석이 **됐을 때의 주의 문구**(ai.detail — 예: 표에는 있는데 AI 가 빠뜨렸을 수 있는 문항). 초안 위에 주의 띠로
 * 세우고, 닫으면 그 분석(잡)에 대해서는 다시 띄우지 않는다(이 Case 화면 안에서). 보낸 뒤에는 할 말이 아니다.
 */
const dismissedCautions = ref<string[]>([]);
const aiCaution = computed((): string | null => {
  const state = ai.value;
  if (state?.status !== 'done' || !aiBeforeSend.value) return null;
  const detail = state.detail?.trim() ?? '';
  return detail === '' || dismissedCautions.value.includes(state.jobId) ? null : detail;
});
function dismissCaution(): void {
  const jobId = ai.value?.jobId;
  if (jobId !== undefined) dismissedCautions.value = [...dismissedCautions.value, jobId];
}
watch(
  [rounds, startable, loaded],
  () => {
    // 목록이 오기 전에 고르면 '새 회차'로 잘못 앉은 뒤 그대로 남는다(유효한 선택이라 다시 고르지 않는다).
    if (!loaded.value) {
      selection.value = null;
      return;
    }
    const valid =
      (selection.value === 'new' && startable.value) ||
      (typeof selection.value === 'number' && rounds.value.some((r) => r.id === selection.value));
    if (!valid) selection.value = defaultSelection();
  },
  { immediate: true },
);
// 다른 발주서로 옮겨 열면 그 발주서의 기본 회차부터.
watch(poId, () => {
  selection.value = loaded.value ? defaultSelection() : null;
  errorText.value = '';
  serverConflict.value = false;
});

const tabValue = computed(() => (selection.value === null ? '' : String(selection.value)));
function onTab(value: unknown): void {
  if (value === 'new') selection.value = 'new';
  else if (typeof value === 'string' && /^\d+$/.test(value)) selection.value = Number(value);
}

// ── 편집 버퍼(저장 안 된 변경) ──────────────────────────────────────────────────
// 회차 id → 편집 버퍼. Map 은 reactive 컬렉션이라 넣고 빼는 것도, 안의 문항을 고치는 것도 추적된다.
const buffers = ref(new Map<number, EqRoundDraft>());
const draft = computed((): EqRoundDraft | null => {
  const view = selectedView.value;
  return view?.status === 'draft' ? (buffers.value.get(view.id) ?? null) : null;
});
/** 발송 뒤 회차 — 같은 모형으로 읽기 전용 표시. */
const readonlyModel = computed((): EqRoundDraft | null => {
  const view = selectedView.value;
  return view === null || view.status === 'draft' ? null : draftFromView(view);
});
const model = computed(() => draft.value ?? readonlyModel.value);
const editable = computed(() => draft.value !== null);
/** 서버가 409 VERSION_CONFLICT 로 돌려보냈다 — [새로 불러오기]까지 남는다. */
const serverConflict = ref(false);
/**
 * 충돌 — 서버 거절이거나, 저장 안 된 변경이 있는 버퍼가 서버 판보다 낡았다(다른 탭·다른 관리자가 저장).
 * 파생값이라 저장 직후의 짧은 순간(캐시가 먼저 새 판을 받고 버퍼는 응답으로 곧 바뀐다)에 굳지 않는다.
 */
const conflict = computed(
  () =>
    serverConflict.value ||
    (draft.value !== null && selectedView.value !== null && draft.value.baseVersion !== selectedView.value.version),
);

// 서버 판이 바뀌면(저장·다른 탭) 저장 안 된 변경이 없는 버퍼만 따라간다. 변경이 있는데 버전이 다르면
// 덮어쓰지 않는다(위 conflict 가 알린다) — 내 변경을 말없이 지우지도, 낡은 판으로 저장하지도 않는다.
watch(
  selectedView,
  (view) => {
    if (view === null) return;
    const buffer = buffers.value.get(view.id);
    if (view.status !== 'draft') {
      buffers.value.delete(view.id);
      return;
    }
    if (buffer === undefined || (!isDraftDirty(buffer) && buffer.baseVersion !== view.version)) {
      buffers.value.set(view.id, draftFromView(view));
    }
  },
  { immediate: true },
);

const dirty = computed(() => draft.value !== null && isDraftDirty(draft.value));
const dirtyPoIds = computed(() => [
  ...new Set([...buffers.value.values()].filter((b) => isDraftDirty(b)).map((b) => b.poId)),
]);
watch(dirtyPoIds, (ids) => {
  emit('dirty', ids);
}, { immediate: true });

// 다른 Case 로 옮겨 가면(같은 화면 재사용) 버퍼는 그 Case 것이 아니다.
watch(() => props.specId, () => {
  buffers.value.clear();
  urls.revokeAll();
});

const prevRound = computed(() => {
  const prevId = selectedView.value?.prevReviewId ?? null;
  return prevId === null ? null : (reviews.value.find((r) => r.id === prevId) ?? null);
});

// ── 문항 고르기·편집 ────────────────────────────────────────────────────────────
const itemIndex = ref(0);
watch(selection, () => {
  itemIndex.value = 0;
  midTab.value = 'edit';
  errorText.value = '';
  serverConflict.value = false;
});
watch(
  () => model.value?.items.length ?? 0,
  (length) => {
    if (itemIndex.value >= length) itemIndex.value = Math.max(0, length - 1);
  },
);
const currentItem = computed((): EqItemDraft | null => model.value?.items[itemIndex.value] ?? null);

function patchItem(patch: Partial<EqItemDraft>): void {
  const item = draft.value?.items[itemIndex.value];
  if (item !== undefined) Object.assign(item, patch);
}
function addItem(): void {
  const target = draft.value;
  if (target === null) return;
  target.items.push(newItem((selectedView.value?.prevReviewId ?? null) !== null));
  itemIndex.value = target.items.length - 1;
  midTab.value = 'edit';
}
async function removeItem(index: number): Promise<void> {
  const target = draft.value;
  if (target === null) return;
  const ok = await confirmDialog({
    message: `문항 ${String(index + 1)}을 지울까요?\n[임시저장]해야 서버 초안에서도 지워집니다(이 문항에 올린 그림은 회차에 남습니다).`,
    confirmLabel: '지우기',
    tone: 'danger',
  });
  if (!ok) return;
  target.items.splice(index, 1);
}
function moveItem(index: number, delta: -1 | 1): void {
  const items = draft.value?.items;
  const a = items?.[index];
  const b = items?.[index + delta];
  if (items === undefined || a === undefined || b === undefined) return;
  items[index] = b;
  items[index + delta] = a;
  if (itemIndex.value === index) itemIndex.value = index + delta;
  else if (itemIndex.value === index + delta) itemIndex.value = index;
}

// ── 오류·충돌 ───────────────────────────────────────────────────────────────────
const errorText = ref('');
function fail(error: unknown, fallback: string): void {
  if (error instanceof ApiRequestError) {
    if (error.payload?.error === 'VERSION_CONFLICT') serverConflict.value = true;
    errorText.value = error.payload?.message ?? error.message;
    return;
  }
  errorText.value = fallback;
}

/** 서버 판을 다시 받는다 — 이 회차의 저장 안 된 변경은 버린다(충돌 해소). */
async function reload(): Promise<void> {
  errorText.value = '';
  serverConflict.value = false;
  const view = selectedView.value;
  if (view !== null) buffers.value.delete(view.id);
  await roundsQuery.refetch();
  const fresh = selectedView.value;
  if (fresh?.status === 'draft') buffers.value.set(fresh.id, draftFromView(fresh));
}

// ── 새 회차 ────────────────────────────────────────────────────────────────────
const sourceCandidates = computed(() =>
  (props.po?.eqFiles ?? []).filter((f) => f.fileType === 'eq' || f.fileType === 'working'),
);
const pickedSources = ref<number[]>([]);
// 근거는 기본으로 종류별 최신(=지금 승인요청의 EQ·Working) — 이전 업로드는 옛 회차의 것이다(여정 22호).
watch(
  [selection, sourceCandidates],
  () => {
    if (selection.value === 'new') pickedSources.value = sourceCandidates.value.filter((f) => f.isLatest).map((f) => f.fileId);
  },
  { immediate: true },
);
const togglePick = (fileId: number, on: boolean): void => {
  pickedSources.value = on
    ? [...new Set([...pickedSources.value, fileId])]
    : pickedSources.value.filter((id) => id !== fileId);
};

async function startDraft(fromPrevious: boolean): Promise<void> {
  const target = props.po;
  if (target === null || mut.createDraft.isPending.value) return;
  errorText.value = '';
  try {
    const res = await mut.createDraft.mutateAsync({
      poId: target.poId,
      body: { fromPrevious, sourceFileIds: [...pickedSources.value] },
    });
    const review = res.data.review;
    buffers.value.set(review.id, draftFromView(review));
    selection.value = review.id;
  } catch (error) {
    fail(error, '초안을 만들지 못했습니다.');
    void roundsQuery.refetch();
  }
}

/**
 * [AI 분석]·[AI 다시 분석]·[AI 결과를 초안에 적용] — 잡만 띄우고 돌아온다(202). 열린 초안이 있으면 그 문항이
 * AI 결과로 통째 바뀌므로 먼저 묻고(저장 안 된 변경이 있으면 그것도 사라진다), 버퍼를 서버 판으로 되돌려
 * 결과가 들어올 때 따라가게 한다(변경이 남아 있으면 충돌로 굳는다).
 */
async function runAi(): Promise<void> {
  const target = props.po;
  if (target === null || mut.aiAnalyze.isPending.value) return;
  const draftView = openDraft.value;
  if (draftView !== null) {
    const buffer = buffers.value.get(draftView.id);
    const unsaved = buffer !== undefined && isDraftDirty(buffer);
    const ok = await confirmDialog({
      title: 'AI 결과로 초안 바꾸기',
      message:
        `${String(draftView.roundNo ?? '')}차 초안의 문항·그림이 AI 분석 결과로 통째로 바뀝니다.` +
        (unsaved ? '\n\n저장 안 된 변경이 사라집니다.' : '') +
        '\n\n계속할까요?',
      confirmLabel: 'AI 결과로 바꾸기',
      tone: 'danger',
    });
    if (!ok) return;
    buffers.value.set(draftView.id, draftFromView(draftView));
  }
  errorText.value = '';
  serverConflict.value = false;
  try {
    await mut.aiAnalyze.mutateAsync({ poId: target.poId, replaceDraft: draftView !== null });
  } catch (error) {
    fail(error, 'AI 분석을 시작하지 못했습니다.');
    void roundsQuery.refetch();
  }
}
// 분석이 끝나면(중 → 됨·안 됨) 행 칩도 같은 사실을 말해야 한다 — 발주 목록(행 요약)을 다시 읽는다.
watch(
  () => ai.value?.status,
  (now, before) => {
    if (before === 'running' && now !== 'running') void queryClient.invalidateQueries({ queryKey: ['admin', 'pcbPo'] });
  },
);

// ── 초안 저장·발송·삭제 ─────────────────────────────────────────────────────────
const saveProblem = computed(() => (draft.value === null ? null : draftSaveProblem(draft.value)));
const sendProblem = computed(() => (draft.value === null ? null : draftSendProblem(draft.value)));

function showProblem(problem: { itemIndex: number | null; message: string }): void {
  errorText.value = problem.message;
  if (problem.itemIndex !== null) {
    itemIndex.value = problem.itemIndex;
    midTab.value = 'edit';
  }
}

async function save(): Promise<boolean> {
  const target = draft.value;
  if (target === null || mut.saveDraft.isPending.value) return false;
  if (saveProblem.value !== null) {
    showProblem(saveProblem.value);
    return false;
  }
  errorText.value = '';
  try {
    const res = await mut.saveDraft.mutateAsync({ poId: target.poId, reviewId: target.reviewId, body: draftBody(target) });
    buffers.value.set(target.reviewId, draftFromView(res.data.review));
    return true;
  } catch (error) {
    fail(error, '임시저장에 실패했습니다.');
    return false;
  }
}

async function sendRound(): Promise<void> {
  const view = selectedView.value;
  if (draft.value === null || view === null) return;
  if (sendProblem.value !== null) {
    showProblem(sendProblem.value);
    return;
  }
  if (dirty.value && !(await save())) return;
  // 저장 뒤의 판(버전이 올랐다) — 위에서 좁힌 draft 는 await 너머라 다시 읽는다.
  const saved = buffers.value.get(view.id);
  if (saved === undefined) return;
  const due = saved.dueOn === '' ? '기한 없음' : `기한 ${saved.dueOn}`;
  // 확인 안 한 AI 표시가 남아 있으면 알린다 — 막지는 않는다(표시는 검사 결과일 뿐, 보낼지는 관리자가 정한다).
  const flags = openAiFlags(saved);
  const flagWarning =
    flags.count === 0
      ? ''
      : `주의: 확인 안 한 AI 표시 ${String(flags.count)}건(문항 ${flags.itemNos.join('·')})이 남아 있습니다 — 원문과 대조했는지 확인하세요.\n\n`;
  const ok = await confirmDialog({
    title: `${String(view.roundNo ?? nextRoundNo.value)}차 제조 확인 보내기`,
    message:
      `고객에게 보낼까요?\n\n문항 ${String(saved.items.length)} · 공개 그림 ${String(sharedFigureCount(saved))} · ${due}\n\n` +
      flagWarning +
      '고객에게 메일(주문 상세 링크만)이 나가고, 보낸 뒤에는 문항을 고칠 수 없습니다.',
    confirmLabel: '고객에게 보내기',
    ...(flags.count === 0 ? {} : { tone: 'danger' as const }),
  });
  if (!ok) return;
  errorText.value = '';
  try {
    await mut.send.mutateAsync({ poId: saved.poId, reviewId: saved.reviewId, expectedVersion: saved.baseVersion });
    buffers.value.delete(saved.reviewId);
  } catch (error) {
    fail(error, '보내지 못했습니다.');
  }
}

async function cancelRound(kind: 'draft' | 'request'): Promise<void> {
  const view = selectedView.value;
  if (view === null || mut.cancel.isPending.value) return;
  const ok = await confirmDialog(
    kind === 'draft'
      ? {
          message: `작성 중인 ${String(view.roundNo ?? '')}차 초안을 삭제할까요?\n고객에게 나간 적이 없어 고객 화면·회차 번호에 흔적이 남지 않습니다.`,
          confirmLabel: '초안 삭제',
          tone: 'danger',
        }
      : {
          message: `회신 대기 중인 ${String(view.roundNo ?? '')}차 확인 요청을 취소할까요?\n고객 화면에는 '요청 취소'로 남고, 더는 회신할 수 없습니다.`,
          confirmLabel: '요청 취소',
          tone: 'danger',
        },
  );
  if (!ok) return;
  errorText.value = '';
  try {
    await mut.cancel.mutateAsync({ poId: view.poId, reviewId: view.id });
    buffers.value.delete(view.id);
  } catch (error) {
    fail(error, '취소하지 못했습니다.');
  }
}

// ── 대리 회신·전달·승인·개정 요청 ─────────────────────────────────────────────────
const proxyOpen = ref(false);
const proxyError = ref('');
const proxyReview = computed(() => (proxyOpen.value && selectedView.value?.status === 'requested' ? selectedView.value : null));
function openProxy(): void {
  proxyError.value = '';
  proxyOpen.value = true;
}
async function submitProxy(body: Omit<AdminPcbEqProxyAnswerBodyType, 'expectedVersion'>): Promise<void> {
  const view = selectedView.value;
  if (view === null) return;
  proxyError.value = '';
  try {
    await mut.proxyAnswer.mutateAsync({ poId: view.poId, reviewId: view.id, body: { expectedVersion: view.version, ...body } });
    proxyOpen.value = false;
  } catch (error) {
    proxyError.value = error instanceof ApiRequestError ? (error.payload?.message ?? error.message) : '대리 회신을 저장하지 못했습니다.';
    if (error instanceof ApiRequestError && error.payload?.error === 'VERSION_CONFLICT') void roundsQuery.refetch();
  }
}

async function forwardRound(): Promise<void> {
  const view = selectedView.value;
  if (view === null || mut.forward.isPending.value) return;
  const ok = await confirmDialog({
    message: `${String(view.roundNo ?? '')}차 고객 회신을 협력사(${props.po?.partnerName ?? ''})에 전달할까요?\n협력사 포털에 문항별 원문 질문·고객 답(기호+의견)이 열리고 메일이 나갑니다.`,
    confirmLabel: '협력사에 전달',
  });
  if (!ok) return;
  errorText.value = '';
  try {
    await mut.forward.mutateAsync({ poId: view.poId, reviewId: view.id, expectedVersion: view.version });
  } catch (error) {
    fail(error, '전달하지 못했습니다.');
  }
}

// 승인 확인창 규칙은 Case 의 approvePo 한 곳이 갖고 있다 — 고객 대기·반려면 되묻고, 회신 온 미전달 회차면
// "승인하면 고객 회신이 협력사에 함께 전달됩니다"를 알린다(D20 후속 R-1: 승인이 자동 전달한다). 여기서 따로
// 묻지 않는다(같은 승인이 두 번 묻지 않게 — 전에는 '전달하지 않고 승인?'을 여기서 물었다).
function approve(): void {
  if (props.po !== null) emit('approve', props.po);
}

// ── 그림 ───────────────────────────────────────────────────────────────────────
const uploading = ref(false);
async function uploadFigures(files: File[]): Promise<void> {
  const target = draft.value;
  const item = currentItem.value;
  if (target === null || item === null) return;
  uploading.value = true;
  errorText.value = '';
  try {
    for (const file of files) {
      const res = await mut.uploadFigure.mutateAsync({ poId: target.poId, reviewId: target.reviewId, file });
      // 올린 그림은 기본 비공개 — 공장 로고·원본 표 캡처가 섞여 있을 수 있어 관리자가 골라 켠다(D20-5).
      item.figures.push({ ...res.data.figure, shared: false });
    }
  } catch (error) {
    fail(error, '그림을 올리지 못했습니다.');
  } finally {
    uploading.value = false;
  }
}
async function removeFigure(fileId: number): Promise<void> {
  const target = draft.value;
  if (target === null) return;
  const ok = await confirmDialog({
    message: '이 그림을 지울까요?\n저장과 무관하게 바로 지워집니다(되돌릴 수 없습니다).',
    confirmLabel: '지우기',
    tone: 'danger',
  });
  if (!ok) return;
  errorText.value = '';
  const wasDirty = isDraftDirty(target);
  try {
    const res = await mut.deleteFigure.mutateAsync({ poId: target.poId, reviewId: target.reviewId, fileId });
    // 지우기는 서버의 문항 그림에서도 뺀다(버전은 그대로). 저장 안 된 변경이 없었으면 서버 판을 그대로 받고
    // (버퍼만 고치면 이미 반영된 삭제가 '저장 안 된 변경'으로 남는다), 있었으면 내 변경을 지키고 그림만 뺀다.
    if (wasDirty) {
      for (const item of target.items) item.figures = item.figures.filter((f) => f.fileId !== fileId);
    } else {
      buffers.value.set(target.reviewId, draftFromView(res.data.review));
    }
  } catch (error) {
    fail(error, '그림을 지우지 못했습니다.');
  }
}

/**
 * 아직 문항에 안 붙은 그림 — 서버가 아는 이 회차의 그림(문항에 붙은 것 + looseFigures)에서 **지금 편집 버퍼가
 * 문항에 붙여 둔 것**을 뺀다. 그래서 올리고 저장 없이 떠났다 돌아온 그림도, 방금 문항을 지워 갈 곳을 잃은
 * 그림도 여기 남는다(다시 붙이거나 지운다). 초안에서만 — 보낸 뒤 회차는 그림을 고칠 수 없다.
 */
const looseFigures = computed((): EqFigureDraft[] => {
  const view = selectedView.value;
  const target = draft.value;
  if (view === null || target === null) return [];
  const attached = new Set(target.items.flatMap((item) => item.figures.map((f) => f.fileId)));
  const known = new Map<number, EqFigureDraft>();
  for (const f of [...view.items.flatMap((item) => item.figures), ...view.looseFigures]) {
    // 공개 여부는 문항에 붙일 때 다시 정한다 — 떼였던 그림이 공개인 채 따라붙지 않게.
    known.set(f.fileId, { fileId: f.fileId, name: f.name, size: f.size, shared: false });
  }
  return [...known.values()].filter((f) => !attached.has(f.fileId)).sort((a, b) => a.fileId - b.fileId);
});
function attachFigure(fileId: number): void {
  const item = draft.value?.items[itemIndex.value];
  const figure = looseFigures.value.find((f) => f.fileId === fileId);
  if (item === undefined || figure === undefined) return;
  item.figures.push({ ...figure });
}
const zoomed = ref<{ url: string; name: string } | null>(null);
const onZoom = (url: string, name: string): void => {
  zoomed.value = { url, name };
};

// ── 고객 의견 번역(D20 P4) — 협력사 화면·회신서에 원문과 함께 나가는 문장 ───────────────────
// 고객 회신이 도착하면 서버가 뒤에서 번역해 둔다. 여기서는 그 번역을 보고 고치거나, 없으면 AI 로 받는다.
const translationBusy = computed(() => mut.translate.isPending.value || mut.saveCommentTranslation.isPending.value);
async function translateComments(force: boolean): Promise<void> {
  const view = selectedView.value;
  if (view === null || translationBusy.value) return;
  if (
    force &&
    !(await confirmDialog({
      message: `${String(view.roundNo ?? '')}차의 고객 의견을 모두 AI 로 다시 번역할까요?\n직접 고친 번역도 AI 번역으로 바뀝니다.`,
      confirmLabel: '다시 번역',
    }))
  ) {
    return;
  }
  errorText.value = '';
  try {
    await mut.translate.mutateAsync({ poId: view.poId, reviewId: view.id, force });
  } catch (error) {
    fail(error, 'AI 번역에 실패했습니다.');
  }
}
async function saveCommentTranslation(body: AdminPcbEqCommentTranslationBodyType): Promise<void> {
  const view = selectedView.value;
  const itemId = currentItem.value?.id ?? null;
  if (view === null || itemId === null || translationBusy.value) return;
  errorText.value = '';
  try {
    await mut.saveCommentTranslation.mutateAsync({ poId: view.poId, reviewId: view.id, itemId, body });
  } catch (error) {
    fail(error, '번역을 저장하지 못했습니다.');
  }
}

// ── 근거 첨부 내려받기 ───────────────────────────────────────────────────────────
const sourceFiles = computed(() => {
  const ids = selectedView.value?.sourceFileIds ?? [];
  return (props.po?.eqFiles ?? []).filter((f) => ids.includes(f.fileId));
});
function downloadSource(fileId: number, name: string): void {
  if (props.specId === null || props.po === null) return;
  void downloadAdminPcbEqFile(props.specId, props.po.poId, fileId, name);
}

// ── 고객 회신서 엑셀(D20 P3) — 회신이 온 문항형 회차를 서식 갖춘 한 장으로 ─────────────────
// 전달 전에도 받는다(관리자는 보관·검토용). 협력사는 포털에서 전달된 회차만 받는다(같은 양식, 그쪽 언어).
const replySheetReady = computed(() => selectedView.value?.format === 'items' && selectedView.value.status === 'answered');
async function downloadReplySheet(): Promise<void> {
  const view = selectedView.value;
  if (props.po === null || view?.roundNo == null) return;
  errorText.value = '';
  try {
    await downloadAdminPcbEqReply(
      props.po.poId,
      view.id,
      pcbEqReplyFileName({ projectName: props.projectName, poId: props.po.poId, roundNo: view.roundNo, locale: 'ko' }),
    );
  } catch (e) {
    fail(e, '회신서를 내려받지 못했습니다.');
  }
}

// ── 탭(1280px 미만은 편집 칸 안에서 미리보기·활동을 바꿔 본다) ──────────────────────
const midTab = ref<'edit' | 'preview' | 'activity'>('edit');
const sideTab = ref<'preview' | 'activity'>('preview');
const onMidTab = (value: unknown): void => {
  if (value === 'edit' || value === 'preview' || value === 'activity') midTab.value = value;
};
const onSideTab = (value: unknown): void => {
  if (value === 'preview' || value === 'activity') sideTab.value = value;
};

const roundBadge = computed(() => (selectedView.value === null ? null : eqRoundBadge(selectedView.value)));
const busy = computed(
  () =>
    mut.saveDraft.isPending.value ||
    mut.send.isPending.value ||
    mut.cancel.isPending.value ||
    mut.forward.isPending.value ||
    mut.createDraft.isPending.value ||
    mut.aiAnalyze.isPending.value,
);

// 열 때마다 최신으로 — 고객이 그사이 회신했을 수 있다(패널은 Case 화면 수명 동안 산다). 행 칩도 같은 사실을
// 말해야 하므로 발주 목록(행 요약)도 다시 읽는다.
watch(
  () => props.open,
  (open) => {
    if (!open || props.po === null) return;
    errorText.value = '';
    void roundsQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ['admin', 'pcbPo', 'list'] });
  },
);
// EQ 전이(승인·반려·자동 종료)는 회차를 닫는다 — 발주 상태가 바뀌면 회차도 다시 읽는다.
watch(() => props.po?.status, (now, before) => {
  if (before !== undefined && now !== before) void roundsQuery.refetch();
});

// ── 닫기·이탈 ─────────────────────────────────────────────────────────────────
const onOpenChange = (open: boolean): void => {
  if (!open) emit('close');
};
/** 확인창·대리 회신·확대·부모 대화상자가 떠 있으면 그쪽이 먼저 닫힌다(이 패널은 같이 닫히지 않는다). */
const layerAbove = (): boolean =>
  props.overlayOpen || proxyOpen.value || zoomed.value !== null || pendingConfirm.value !== null || pendingPrompt.value !== null;
function onEscapeKeyDown(event: KeyboardEvent): void {
  if (layerAbove()) event.preventDefault();
}
function onInteractOutside(event: Event): void {
  if (layerAbove()) event.preventDefault();
}

const anyDirty = computed(() => dirtyPoIds.value.length > 0);
const askLeave = (): Promise<boolean> =>
  confirmDialog({
    message: '저장하지 않은 EQ 문항 변경이 있습니다. 이 화면을 떠나면 변경이 사라집니다(서버의 초안은 남습니다).',
    confirmLabel: '떠나기',
    tone: 'danger',
  });
onBeforeRouteLeave(async () => !anyDirty.value || (await askLeave()));
onBeforeRouteUpdate(async (to, from) => to.params.id === from.params.id || !anyDirty.value || (await askLeave()));
const beforeUnload = (event: BeforeUnloadEvent): void => {
  if (!anyDirty.value) return;
  event.preventDefault();
};
onMounted(() => {
  window.addEventListener('beforeunload', beforeUnload);
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', beforeUnload);
  urls.revokeAll();
});

const isChecked = (value: boolean | 'indeterminate'): boolean => value === true;
</script>

<template>
  <Sheet :open="open" @update:open="onOpenChange">
    <SheetContent
      side="right"
      class="w-full sm:max-w-none lg:w-[min(1400px,96vw)]"
      data-eq-workspace
      @escape-key-down="onEscapeKeyDown"
      @interact-outside="onInteractOutside"
    >
      <div class="flex h-full min-h-0 flex-col">
        <!-- 머리 — 발주·협력사·회차 전환·상태·근거 첨부 -->
        <header class="grid shrink-0 gap-2 border-b py-3 pr-12 pl-5">
          <div class="min-w-0">
            <p class="text-info text-xs font-semibold tracking-widest uppercase">PCB 발주 · EQ</p>
            <SheetTitle class="mt-0.5">EQ 고객 확인 — {{ po?.partnerName ?? '' }}</SheetTitle>
            <SheetDescription class="mt-0.5">
              <span class="flex flex-wrap items-center gap-1.5 text-xs">
                <span class="truncate">{{ projectName }}</span>
                <template v-if="po !== null">
                  <span>· PO-{{ po.poId }}</span>
                  <Badge :variant="pcbPoStatusVariant(po.status)">{{ PCB_PO_STATUS_LABELS[po.track][po.status] }}</Badge>
                </template>
                <span v-if="anyDirty" class="text-warning">· 닫아도 저장 안 된 변경은 이 화면에 남습니다</span>
              </span>
            </SheetDescription>
          </div>

          <div v-if="po !== null && loaded && (rounds.length > 0 || startable)" class="flex flex-wrap items-center gap-2">
            <div class="max-w-full overflow-x-auto">
              <!-- 회차 전환은 누를 때만(manual) — 패널이 열리며 첫 탭에 포커스가 가도 회차가 바뀌지 않게. -->
              <Tabs :model-value="tabValue" activation-mode="manual" @update:model-value="onTab">
                <TabsList variant="segment" aria-label="회차 전환">
                  <TabsTrigger v-for="r in rounds" :key="r.id" :value="String(r.id)">
                    {{ r.roundNo }}차
                    <span class="text-muted-foreground text-xs font-normal">{{ eqRoundBadge(r).label }}</span>
                  </TabsTrigger>
                  <TabsTrigger v-if="startable" value="new">+ 새 회차</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <template v-if="roundBadge !== null">
              <Badge :variant="roundBadge.variant" data-eq-round-status>{{ roundBadge.label }}</Badge>
              <span v-if="roundBadge.detail !== null" class="text-muted-foreground text-xs">{{ roundBadge.detail }}</span>
            </template>
            <!-- 고객 회신서 엑셀 — 회신이 온 회차에서만. 문항·고객 선택·의견이 서식 갖춘 한 장으로 나온다. -->
            <Button
              v-if="replySheetReady"
              variant="outline"
              size="xs"
              title="이 회차의 고객 회신을 엑셀 파일로 내려받습니다(질문 원문·고객이 본 문장·선택·의견)."
              data-eq-reply-xlsx
              @click="void downloadReplySheet()"
            >
              <DownloadIcon />
              회신서 엑셀
            </Button>
            <!-- AI 초안을 다시 받고 싶을 때(설정·파일이 그대로면 최근 결과를 다시 쓴다) — 초안의 문항이 통째로 바뀐다. -->
            <Button
              v-if="draft !== null && selectedView?.aiDraft === true && aiEnabled && aiHasSource && ai?.status !== 'running'"
              variant="ghost"
              size="xs"
              :disabled="busy"
              title="EQ 파일을 다시 분석해 이 초안의 문항을 AI 결과로 바꿉니다."
              @click="void runAi()"
            >
              <RefreshCwIcon />
              AI 다시 분석
            </Button>
            <span v-if="sourceFiles.length > 0" class="flex flex-wrap items-center gap-1 text-xs">
              <span class="text-muted-foreground">근거</span>
              <Button
                v-for="f in sourceFiles"
                :key="f.fileId"
                variant="outline"
                size="xs"
                :title="`${PCB_EQ_FILE_LABELS[f.fileType]} · ${f.name}${f.isLatest ? '' : ' — 이후에 새 파일이 올라왔습니다'}`"
                @click="downloadSource(f.fileId, f.name)"
              >
                <DownloadIcon />
                {{ f.fileType }}<template v-if="!f.isLatest"> · 이전</template>
              </Button>
            </span>
            <!-- 이번 요청이 협력사의 추가 EQ 요청으로 올라온 것이면 그 사유를 초안 위에서도 본다(AI 가 초안을 만들어 새 회차
                 카드를 건너뛴 경우에도 무엇이 바뀌었는지 알게). -->
            <span
              v-if="reopenContext !== null && selectedView !== null && selectedView.id === currentRound?.id && selectedView.status === 'draft'"
              class="text-warning max-w-full truncate text-xs"
              :title="reopenContext.note"
              data-eq-reopen-head
            >
              협력사 추가 EQ 요청: {{ reopenContext.note }}
            </span>
            <Button
              v-if="po !== null && messageReviews.length > 0"
              variant="ghost"
              size="xs"
              class="ml-auto"
              title="D16 문구형 확인 요청(문구 1개 + 승인/반려) 이력"
              @click="emit('simple', po)"
            >
              <MessageSquareTextIcon />
              문구형 확인 {{ messageReviews.length }}건
            </Button>
          </div>
        </header>

        <!-- AI 분석 띠(D20 P2) — 분석 중 · 안 됨(사유) · 결과 준비(초안에 적용). 됐으면 회차 배지가 말하고,
             서버가 주의 문구(ai.detail)를 남겼으면 초안 위에 주의 띠가 선다(닫을 수 있다). -->
        <EqAiBanner
          v-if="po !== null && loaded && ai !== null && (aiBannerKind !== null || aiCaution !== null)"
          :kind="aiBannerKind"
          :ai="ai"
          :caution="aiCaution"
          :has-draft="openDraft !== null"
          :can-write-direct="startable"
          :ai-enabled="aiEnabled"
          :busy="busy"
          @analyze="void runAi()"
          @direct="void startDraft(false)"
          @dismiss-caution="dismissCaution"
        />

        <!-- 발주서가 사라졌다(삭제·회차 이동) -->
        <div v-if="po === null" class="p-6">
          <Alert variant="warning"><AlertDescription>발주서를 찾을 수 없습니다 — 패널을 닫고 다시 여세요.</AlertDescription></Alert>
        </div>

        <div v-else-if="!loaded" class="text-muted-foreground min-h-0 flex-1 p-6 text-sm" :role="roundsQuery.isError.value ? 'alert' : undefined">
          {{ roundsQuery.isError.value ? '회차를 불러오지 못했습니다 — 닫았다가 다시 여세요.' : '회차를 불러오는 중…' }}
        </div>

        <!-- 새 회차 시작 -->
        <div v-else-if="selection === 'new'" class="min-h-0 flex-1 overflow-y-auto p-5">
          <Panel size="md" class="mx-auto grid max-w-3xl gap-4" data-eq-new-round>
            <div>
              <p class="text-sm font-semibold">{{ nextRoundNo }}차 회차 시작</p>
              <p class="text-muted-foreground mt-0.5 text-xs">
                협력사가 EQ 승인요청을 올렸습니다. 공장 EQ 표를 문항으로 옮겨 고객에게 묻습니다 — 보내기 전에는 고객에게 보이지 않습니다.
              </p>
            </div>
            <!-- 승인 뒤 협력사가 EQ 를 다시 열어 올라온 요청 — 협력사가 적은 사유가 이 회차의 근거다. -->
            <Alert v-if="reopenContext !== null" variant="warning" size="sm" data-eq-reopen-context>
              <AlertDescription>
                <p class="text-xs">
                  <b>협력사 추가 EQ 요청({{ fmtKstDate(reopenContext.at) }}):</b>
                  <span class="ml-1 whitespace-pre-wrap">{{ reopenContext.note === '' ? '(사유 없음)' : reopenContext.note }}</span>
                </p>
                <p class="text-muted-foreground mt-1 text-xs">
                  승인 뒤 협력사가 EQ 를 다시 열었습니다 — 직전 회차에서 가져와 바뀐 문항만 고치면 고객은 바뀐 것만 다시 답합니다.
                </p>
              </AlertDescription>
            </Alert>
            <div v-if="sourceCandidates.length > 0" class="grid gap-1.5">
              <p class="text-xs font-semibold">근거 EQ 첨부 <span class="text-muted-foreground font-normal">— 이 회차가 옮겨 적는 협력사 파일(고객에게 가지 않음)</span></p>
              <span v-for="f in sourceCandidates" :key="f.fileId" class="inline-flex items-center gap-2 text-xs">
                <Checkbox
                  :id="`eq-src-${String(f.fileId)}`"
                  :model-value="pickedSources.includes(f.fileId)"
                  @update:model-value="togglePick(f.fileId, isChecked($event))"
                />
                <label :for="`eq-src-${String(f.fileId)}`" class="min-w-0 truncate">
                  <b class="uppercase">{{ f.fileType }}</b> {{ f.name }}
                </label>
                <Badge v-if="!f.isLatest" variant="warning">이전</Badge>
                <Button variant="ghost" size="icon-xs" :aria-label="`${f.name} 내려받기`" @click="downloadSource(f.fileId, f.name)">
                  <DownloadIcon />
                </Button>
              </span>
            </div>
            <p v-else class="text-muted-foreground text-xs">협력사가 올린 EQ·Working 첨부가 없습니다.</p>

            <div class="grid gap-2 sm:grid-cols-2">
              <Button :variant="hasCopySource ? 'outline' : 'default'" :disabled="busy" @click="void startDraft(false)">
                <PencilLineIcon />
                직접 작성
              </Button>
              <Button
                v-if="hasCopySource"
                :disabled="busy"
                title="직전 회차의 문항·그림을 복사하고 '동일'로 잇습니다 — 바뀐 문항은 '변경', 새 문항은 '신규'로 고치세요."
                @click="void startDraft(true)"
              >
                <CopyIcon />
                직전 회차에서 가져오기
              </Button>
              <!-- 승인요청 때 자동으로 돌지만(유스케이스 on), 꺼져 있었거나 안 됐을 때 여기서 눌러 돌린다. -->
              <Button
                variant="outline"
                :disabled="busy || !aiEnabled || !aiHasSource || ai?.status === 'running'"
                title="협력사 EQ 엑셀을 읽어 문항·번역 초안을 만듭니다 — 만든 뒤 검토하고 보내세요."
                data-eq-ai-analyze
                @click="void runAi()"
              >
                <SparklesIcon />
                {{ ai?.status === 'running' ? 'AI 분석 중…' : 'AI 분석' }}
              </Button>
              <Button variant="outline" :disabled="busy" title="D16 문구형 — 문구 하나로 승인/반려만 묻습니다" @click="emit('simple', po)">
                <FileTextIcon />
                간단 문구로 묻기
              </Button>
            </div>
            <!-- [AI 분석]이 꺼져 있는 이유 — 유스케이스가 꺼졌거나 분석할 EQ 파일이 없다. -->
            <p v-if="!aiEnabled" class="text-muted-foreground text-xs" data-eq-ai-disabled>
              AI 분석이 꺼져 있습니다 — 'PCB EQ 분석'을 켜면 협력사가 승인요청을 누를 때 자동으로 분석합니다.
              <RouterLink
                :to="{ name: NEXT_CORE_ROUTES.settings, query: { tab: 'aiIntegration' } }"
                target="_blank"
                class="text-primary font-medium underline underline-offset-2"
              >
                설정 &gt; AI 연동 열기
              </RouterLink>
            </p>
            <p v-else-if="!aiHasSource" class="text-muted-foreground text-xs" data-eq-ai-disabled>
              협력사가 올린 EQ 질의서가 없어 AI 가 분석할 파일이 없습니다 — 직접 작성하세요.
            </p>
          </Panel>
        </div>

        <!-- 회차가 없고 시작할 수도 없다 -->
        <div v-else-if="model === null" class="p-6">
          <Alert variant="muted">
            <AlertDescription>
              <p v-if="openReview !== null && openReview.format === 'message'" class="text-xs">
                문구형 확인 요청이 열려 있습니다 — 그 요청을 마무리하거나 취소해야 문항형 회차를 시작할 수 있습니다.
                <Button variant="link" size="xs" @click="emit('simple', po)">간단 문구 확인 열기</Button>
              </p>
              <p v-else-if="po.eqDelegatePoId !== null || po.eqBlocked" class="text-xs">MD 경유 발주입니다 — EQ 고객 확인은 하위 발주 줄의 [EQ 열기]에서 합니다.</p>
              <p v-else class="text-xs">
                새 회차는 발주서가 <b class="text-foreground">EQ 승인요청</b> 단계일 때만 시작할 수 있습니다(지금: {{ PCB_PO_STATUS_LABELS[po.track][po.status] }}).
              </p>
            </AlertDescription>
          </Alert>
        </div>

        <!-- 몸통 3열 — 문항 목록 | 문항 편집 | 고객 미리보기·활동 -->
        <div
          v-else
          class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,32vh)_minmax(0,1fr)] lg:grid-cols-[288px_minmax(0,1fr)] lg:grid-rows-1 xl:grid-cols-[288px_minmax(0,1fr)_380px]"
        >
          <EqItemList
            class="border-b lg:border-r lg:border-b-0"
            :items="model.items"
            :selected-index="itemIndex"
            :editable="editable"
            :show-answers="!editable"
            :problem-index="saveProblem?.itemIndex ?? null"
            @select="(i) => { itemIndex = i; midTab = 'edit'; }"
            @add="addItem"
            @remove="(i) => void removeItem(i)"
            @move="moveItem"
          />

          <div class="min-h-0 overflow-y-auto">
            <div class="bg-background sticky top-0 z-10 border-b px-4 py-2 xl:hidden">
              <Tabs :model-value="midTab" @update:model-value="onMidTab">
                <TabsList variant="segment" aria-label="편집·고객 미리보기·활동 전환">
                  <TabsTrigger value="edit">{{ editable ? '편집' : '문항' }}</TabsTrigger>
                  <TabsTrigger value="preview">고객 미리보기</TabsTrigger>
                  <TabsTrigger value="activity">활동</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div v-if="midTab === 'preview'" class="p-4 xl:hidden">
              <EqCustomerPreview
                :items="model.items"
                :message="model.message"
                :due-on="model.dueOn"
                :round-no="selectedView?.roundNo ?? null"
                :status="selectedView?.status ?? 'draft'"
                :answered-by-admin="selectedView?.answeredRole === 'admin'"
                :po-id="model.poId"
                :review-id="model.reviewId"
                :urls="urls"
                @zoom="onZoom"
              />
            </div>
            <div v-if="midTab === 'activity'" class="p-4 xl:hidden">
              <EqActivity :review="selectedView" :po-history="po.eqHistory" :track="po.track" />
            </div>

            <div class="grid gap-4 p-4" :class="midTab === 'edit' ? '' : 'hidden xl:grid'">
              <template v-if="currentItem === null">
                <Panel size="md" class="text-muted-foreground border-dashed py-10 text-center text-sm">
                  {{ editable ? '왼쪽 [문항 추가]로 공장 EQ 표의 첫 문항을 옮기세요.' : '이 회차에는 문항이 없습니다.' }}
                </Panel>
                <!-- 문항이 아직 없어도 올려 둔 그림은 보인다(문항을 다 지웠거나, 그림부터 올린 경우) — 붙이기는 문항을 만든 뒤. -->
                <EqLooseFigures
                  v-if="editable"
                  :figures="looseFigures"
                  :urls="urls"
                  :po-id="model.poId"
                  :review-id="model.reviewId"
                  attach-blocked-reason="문항을 만들면 그 문항에 붙일 수 있습니다."
                  @remove="(id) => void removeFigure(id)"
                  @zoom="onZoom"
                />
              </template>
              <EqItemEditor
                v-else
                :item="currentItem"
                :index="itemIndex"
                :editable="editable"
                :po-id="model.poId"
                :review-id="model.reviewId"
                :urls="urls"
                :prev-round="prevRound"
                :uploading="uploading"
                :loose-figures="looseFigures"
                :ai-enabled="aiEnabled"
                :translation-busy="translationBusy"
                @save-translation="(body) => void saveCommentTranslation(body)"
                @translate="(force) => void translateComments(force)"
                @patch="patchItem"
                @upload="(files) => void uploadFigures(files)"
                @remove-figure="(id) => void removeFigure(id)"
                @attach-figure="attachFigure"
                @zoom="onZoom"
              />

              <Panel v-if="draft !== null" size="md">
                <Field>
                  <FieldLabel for="eq-round-message">고객 안내 머리말(선택)</FieldLabel>
                  <Textarea
                    id="eq-round-message"
                    v-model="draft.message"
                    rows="2"
                    maxlength="2000"
                    placeholder="비우면 기본 안내문이 나갑니다 — 예) 제조 전에 확인이 필요한 항목이 있습니다. 항목마다 원하시는 처리 방법을 골라 주세요."
                  />
                </Field>
              </Panel>
              <Panel v-else-if="model.message.trim() !== ''" size="sm" class="text-xs">
                <span class="text-muted-foreground font-semibold">머리말</span>
                <p class="mt-1 whitespace-pre-wrap">{{ model.message }}</p>
              </Panel>
            </div>
          </div>

          <!-- 3. 고객 미리보기·활동 — 1280px 이상에서 늘 옆에 -->
          <div class="bg-muted/40 hidden min-h-0 overflow-y-auto border-l xl:block" data-eq-side>
            <div class="bg-background sticky top-0 z-10 border-b px-4 py-2">
              <Tabs :model-value="sideTab" @update:model-value="onSideTab">
                <TabsList variant="segment" aria-label="고객 미리보기·활동 전환">
                  <TabsTrigger value="preview">고객 미리보기</TabsTrigger>
                  <TabsTrigger value="activity">활동</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div class="p-4">
              <EqCustomerPreview
                v-if="sideTab === 'preview'"
                :items="model.items"
                :message="model.message"
                :due-on="model.dueOn"
                :round-no="selectedView?.roundNo ?? null"
                :status="selectedView?.status ?? 'draft'"
                :answered-by-admin="selectedView?.answeredRole === 'admin'"
                :po-id="model.poId"
                :review-id="model.reviewId"
                :urls="urls"
                @zoom="onZoom"
              />
              <EqActivity v-else :review="selectedView" :po-history="po.eqHistory" :track="po.track" />
            </div>
          </div>
        </div>

        <!-- 바닥 — 상태별 버튼 -->
        <footer class="bg-background flex shrink-0 flex-wrap items-center gap-2 border-t px-5 py-3">
          <div class="mr-auto min-w-0 text-xs">
            <p v-if="conflict" class="text-destructive font-semibold" role="alert">
              다른 곳에서 바뀌었습니다 — 새로 불러오면 이 화면의 저장 안 된 변경은 사라집니다.
              <Button variant="link" size="xs" @click="void reload()">새로 불러오기</Button>
            </p>
            <p v-else-if="errorText !== ''" class="text-destructive font-semibold" role="alert">{{ errorText }}</p>
            <p v-else-if="draft !== null && sendProblem !== null" class="text-muted-foreground">{{ sendProblem.message }}</p>
            <p v-else-if="draft !== null" class="text-muted-foreground">
              문항 {{ draft.items.length }} · 공개 그림 {{ sharedFigureCount(draft) }}
              <template v-if="openAiFlags(draft).count > 0"> · <b class="text-warning">확인 안 한 AI 표시 {{ openAiFlags(draft).count }}</b></template>
              <template v-if="dirty"> · <b class="text-warning">저장 안 된 변경</b></template>
            </p>
            <p v-else-if="selectedView?.status === 'requested'" class="text-muted-foreground">
              고객 회신을 기다립니다 — 전화·메일로 답을 들었으면 [대리 회신]으로 넣으세요.
            </p>
            <p v-else-if="selectedView?.status === 'answered' && selectedView.forwardedAt === null" class="text-warning font-semibold">
              <template v-if="po?.status === 'eq_requested'">
                고객 회신이 왔습니다 — EQ 승인하면 협력사에 함께 전달됩니다(승인 전에 협력사 의견을 먼저 들으려면 [협력사에 전달]).
              </template>
              <template v-else>고객 회신이 왔습니다 — 협력사에 전달해야 공장이 답을 봅니다.</template>
            </p>
            <p v-else-if="selectedView?.status === 'answered'" class="text-muted-foreground">
              {{ fmtKstDate(selectedView.forwardedAt) }} 협력사 전달<template v-if="po?.status === 'eq_requested'"> — 공장이 개정 EQ 를 내면 반려 후 새 회차로, 아니면 EQ 승인.</template><template v-else> — 지난 회차의 기록입니다.</template>
            </p>
          </div>

          <template v-if="draft !== null">
            <span class="flex items-center gap-2 text-xs">
              <label for="eq-round-due" class="text-muted-foreground font-semibold">회신 기한</label>
              <!-- 지난 날짜를 기한으로 보내면 받자마자 '기한 지남'이 된다 -->
              <Input id="eq-round-due" v-model="draft.dueOn" type="date" :min="kstToday()" class="w-auto" />
            </span>
            <Button variant="ghost" :disabled="busy" @click="void cancelRound('draft')">초안 삭제</Button>
            <Button variant="outline" :disabled="busy || !dirty" @click="void save()">
              <span v-if="dirty" class="bg-warning size-2 rounded-full" />
              {{ mut.saveDraft.isPending.value ? '저장 중…' : '임시저장' }}
            </Button>
            <Button :disabled="busy || conflict" @click="void sendRound()">
              {{ mut.send.isPending.value ? '보내는 중…' : '고객에게 보내기' }}
            </Button>
          </template>

          <template v-else-if="selectedView?.status === 'requested'">
            <Button variant="ghost" :disabled="busy" @click="void cancelRound('request')">요청 취소</Button>
            <Button :disabled="busy" @click="openProxy">대리 회신</Button>
          </template>

          <template v-else-if="selectedView?.status === 'answered' && po !== null">
            <!-- 승인이 회신을 함께 전달하므로(R-1) 승인요청 중에는 전달이 보조 동작이다 — 승인 전에 협력사 의견을 먼저 들을 때. -->
            <Button
              v-if="selectedView.forwardedAt === null"
              :variant="po.status === 'eq_requested' ? 'outline' : 'default'"
              :disabled="busy"
              @click="void forwardRound()"
            >
              협력사에 전달
            </Button>
            <template v-if="po.status === 'eq_requested'">
              <Button variant="outline" :disabled="busy" title="공장이 고객 회신을 반영한 개정 EQ 를 내야 할 때 — 반려하면 '발주접수'로 돌아가고, 재요청이 오면 새 회차로 묻습니다." @click="emit('reject', po)">
                개정 EQ 요청(반려)
              </Button>
              <Button
                :disabled="busy"
                :title="selectedView.forwardedAt === null ? '승인하면 고객 회신이 협력사에 함께 전달됩니다.' : undefined"
                @click="approve"
              >
                고객 회신대로 EQ 승인
              </Button>
            </template>
          </template>

          <Button variant="outline" @click="emit('close')">닫기</Button>
        </footer>
      </div>
    </SheetContent>
  </Sheet>

  <EqProxyAnswerDialog
    :review="proxyReview"
    :busy="mut.proxyAnswer.isPending.value"
    :error="proxyError"
    @close="proxyOpen = false"
    @submit="(body) => void submitProxy(body)"
  />

  <!-- 그림 확대 -->
  <Dialog :open="zoomed !== null" @update:open="(v) => { if (!v) zoomed = null; }">
    <DialogContent v-if="zoomed !== null" class="sm:max-w-4xl">
      <DialogTitle>{{ zoomed.name }}</DialogTitle>
      <DialogDescription class="sr-only">문항 그림 크게 보기</DialogDescription>
      <DialogScrollBody>
        <img :src="zoomed.url" :alt="zoomed.name" class="w-full object-contain">
      </DialogScrollBody>
    </DialogContent>
  </Dialog>
</template>
