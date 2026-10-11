<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  CornerDownLeftIcon,
  DownloadIcon,
  HistoryIcon,
  MessageCircleQuestionIcon,
  MessageSquareTextIcon,
  Undo2Icon,
  UploadIcon,
  UserCogIcon,
  XIcon,
} from '@lucide/vue';
import {
  PCB_EQ_REOPEN,
  PCB_PO_STATUS_LABELS,
  canEditPcbEqFile,
  pcbEqEventLabel,
  pcbEqForwardLabel,
  pcbEqRejectActionLabel,
  pcbEqRevertLabel,
  summarizePcbEqRounds,
  type AdminPcbEqReviewViewType,
  type AdminPcbPoViewType,
  type PcbEqFileTypeType,
  type PcbEqRoundSummary,
} from '@sp/api-contract';
import { downloadAdminPcbEqFile } from '@/admin/useAdminPcbPos';
import Panel from '@/next/components/common/Panel.vue';
import { useAdminPcbEqRounds } from '@/next/components/pcb/eq/useAdminPcbEqRounds';
import type { PcbBadge } from '@/next/components/pcb/pcb-badges';
import {
  pcbEqAfterReworkNote,
  pcbEqReviewBadge,
  pcbEqReworkBadge,
  pcbEqRowTitle,
  pcbEqUnfixedLabel,
  pcbEqUnfixedTitle,
} from '@/next/components/pcb/pos/pos-badges';
import { Badge } from '@/next/components/ui/badge';
import { Button } from '@/next/components/ui/button';
import { ButtonGroup } from '@/next/components/ui/button-group';
import { TableCell, TableRow } from '@/next/components/ui/table';
import { substituteActionOf, substituteLabelOf } from './case-po';
import { usePcbCaseContext } from './usePcbCase';

// 발주 행 아래의 **EQ 줄**(스텐실: 확인 줄) — 2026-10-11 사용자 지적으로 좁은 'EQ 첨부' 칸(335px)을 대신한다.
// 칸 안에서는 파일이 종류(eq·working)로만 보이고 지난 회차는 '이전 N' 하나로 뭉쳐, 어느 파일이 몇 차 요청에
// 올라왔고 그 요청이 어떻게 끝났는지 알 수 없었다. 여기서는 왼쪽에서 오른쪽으로 절차 순서대로 읽는다:
//   EQ 요청 회차(①②③) → 협력사 제출(파일) → 고객 확인(칩·[EQ 열기]) → 판정(승인·반려·회신 첨부)
// 회차 번호는 **요청 회차**다(포털 타임라인의 'N차 요청' — 계약 summarizePcbEqRounds). 고객 확인 회차는 다른
// 수라(묻지 않고 반려·승인한 요청이 있으면 어긋난다) 칩이 '고객 확인 N차'로 따로 말한다.
// 지난 회차는 읽기 전용이다 — 조작은 최신 회차에서만. 생산이 시작되면 한 줄로 접는다(EQ 는 끝난 일).
type EqFile = AdminPcbPoViewType['eqFiles'][number];

const props = defineProps<{ po: AdminPcbPoViewType }>();

const {
  specId,
  showProxy,
  eqBandExpanded,
  toggleEqBand,
  poRework,
  eqChipOf,
  eqReviewTitleOf,
  eqOpenLabelOf,
  showEqOpen,
  openEqWorkspace,
  stencilInquiryOf,
  pickEqFileAdmin,
  removeEqFileAdmin,
  eqUnfixedAfterReject,
  approvePo,
  rejectPoId,
  revertPo,
  runSubstitute,
  canSubstituteReopen,
  substituteReopen,
} = usePcbCaseContext();

const stencil = computed(() => props.po.track === 'stencil');
const caption = computed(() => (stencil.value ? '확인 요청' : 'EQ 요청'));
/** 위임(MD 경유)·차단(MD 하위 발주 대기) 발주는 하위에서 진행한다 — 여기서는 읽기만. */
const hands = computed(() => props.po.eqDelegatePoId === null && !props.po.eqBlocked);
const proxy = computed(() => hands.value && showProxy(props.po));

// ── 회차 ─────────────────────────────────────────────────────────────────────
const rounds = computed(() => summarizePcbEqRounds(props.po.eqHistory, props.po.eqFiles));
/** 고른 회차 — 고르지 않았으면 늘 최신(새 회차가 열리면 저절로 넘어간다). */
const picked = ref<number | null>(null);
watch(
  () => rounds.value.length,
  () => {
    picked.value = null;
  },
);
const latest = computed<PcbEqRoundSummary<EqFile>>(() => {
  const last = rounds.value[rounds.value.length - 1];
  if (last === undefined) throw new Error('EQ 회차가 비어 있습니다'); // summarize 는 늘 한 회차 이상을 준다
  return last;
});
const current = computed(() => rounds.value.find((r) => r.index === picked.value) ?? latest.value);
const isLatest = computed(() => current.value.index === latest.value.index);
const previous = computed(() => rounds.value.find((r) => r.index === current.value.index - 1) ?? null);

const OUTCOME_DOT: Record<PcbEqRoundSummary<EqFile>['outcome'], string> = {
  open: 'bg-muted-foreground/40',
  requested: 'bg-info',
  approved: 'bg-success',
  rejected: 'bg-destructive',
  reopened: 'bg-warning',
};
// 최신 회차의 결말은 이력이 아니라 **발주 상태**가 정본이다 — 이관분처럼 이력이 비어 있어도(상태만 eq_done)
// 승인된 것으로 읽혀야 [승인 취소]가 선다. 지난 회차는 이력의 경계(반려·추가 EQ 요청)로 닫힌 그대로.
const STATUS_OUTCOME: Record<AdminPcbPoViewType['status'], PcbEqRoundSummary<EqFile>['outcome']> = {
  issued: 'open',
  eq_requested: 'requested',
  eq_done: 'approved',
  producing: 'approved',
  produced: 'approved',
};
const outcomeOf = (r: PcbEqRoundSummary<EqFile>): PcbEqRoundSummary<EqFile>['outcome'] =>
  r.index === latest.value.index ? STATUS_OUTCOME[props.po.status] : r.outcome;
const outcomeLabel = (r: PcbEqRoundSummary<EqFile>): string => {
  switch (outcomeOf(r)) {
    case 'rejected':
      return pcbEqReworkBadge(props.po.track, 'reject').label;
    case 'reopened':
      return pcbEqReworkBadge(props.po.track, 'reopen').label;
    case 'approved':
      return pcbEqEventLabel({ fromStatus: 'eq_requested', toStatus: 'eq_done' }, props.po.track);
    case 'requested':
      return PCB_PO_STATUS_LABELS[props.po.track].eq_requested;
    default:
      return '제출 대기';
  }
};

// ── 접힘 — 생산이 시작되면 EQ 는 끝난 일이다 ─────────────────────────────────────
const afterEq = computed(() => props.po.status === 'producing' || props.po.status === 'produced');
const collapsed = computed(() => afterEq.value && !eqBandExpanded.value.includes(props.po.poId));

// ── 협력사 제출 ──────────────────────────────────────────────────────────────
const FILE_LABEL: Record<string, string> = { eq: 'EQ', working: 'Working', coord: '좌표파일', inquiry: '문의 사진' };
const fileLabel = (f: EqFile): string => FILE_LABEL[f.fileType] ?? f.fileType;
const superseded = (f: EqFile): boolean => current.value.supersededFileIds.includes(f.fileId);
/** 지금 쓰는 파일이 먼저, 같은 회차에서 다시 올려 밀린 것은 뒤로. */
const files = computed(() => [...current.value.files].sort((a, b) => Number(superseded(a)) - Number(superseded(b)) || b.fileId - a.fileId));
const afterReworkNote = computed(() => pcbEqAfterReworkNote(poRework(props.po)?.kind ?? 'reject'));
const fileTitle = (f: EqFile): string =>
  `${fileLabel(f)} · ${f.name}${superseded(f) ? ' — 같은 회차에서 다시 올라와 밀린 파일입니다. 승인 근거로 쓰지 마세요.' : ''}${isLatest.value && f.afterReject ? afterReworkNote.value : ''}`;
const ROLE_LABEL: Record<string, string> = { ADMIN: '관리자 대행', PARTNER: '협력사', MASTER_DEALER: 'MD' };
const roleLabel = (role: string | null): string => (role === null ? '' : (ROLE_LABEL[role] ?? role));
/** 스텐실 — 요청에 실린 고객문의사항. 최신 회차는 현행 판정(요청 취소로 물린 글은 세우지 않는다)을 따른다. */
const inquiry = computed<string | null>(() => {
  if (!stencil.value) return null;
  const note = isLatest.value ? (stencilInquiryOf(props.po)?.note ?? null) : current.value.requestNote;
  return note === null || note === '' ? null : note;
});
const canUpload = computed(() => isLatest.value && props.po.status === 'issued' && proxy.value);
const uploadKinds = computed<{ type: PcbEqFileTypeType; label: string; title: string }[]>(() =>
  stencil.value
    ? [
        { type: 'coord', label: '좌표파일', title: '좌표파일 대행 첨부 — 확인 후 고객도 내려받게 됩니다.' },
        { type: 'inquiry', label: '문의 사진', title: '고객문의사항에 곁들일 사진 대행 첨부(선택 · 여러 장 가능)' },
      ]
    : [
        { type: 'eq', label: 'EQ', title: '협력사 대신 EQ 질의서를 첨부합니다(대행).' },
        { type: 'working', label: 'Working', title: '협력사 대신 Working 데이터를 첨부합니다(대행).' },
      ],
);

const when = (iso: string | null): string => {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  // KST 'MM-DD HH:mm' — 같은 날 여러 번 오가는 일이라 시각까지 보인다.
  return Number.isNaN(ms) ? '—' : new Date(ms + 9 * 3_600_000).toISOString().slice(5, 16).replace('T', ' ');
};
const download = (f: EqFile): void => {
  if (specId.value === null) return;
  void downloadAdminPcbEqFile(specId.value, props.po.poId, f.fileId, f.name);
};

// ── 고객 확인 ────────────────────────────────────────────────────────────────
// 최신 회차의 칩은 발주 요약(eqReview·eqAi — 목록이 새로 읽을 때마다 맞는다)이 말하고, 지난 회차는 회차 목록에서
// 그 요청 회차의 시간 창에 든 것을 찾는다(작업공간과 같은 캐시).
const eqOpenHere = computed(() => showEqOpen(props.po) && (props.po.eqDelegatePoId === null || props.po.eqReview !== null));
const poIdRef = computed<number | null>(() => props.po.poId);
const listEnabled = computed(() => !collapsed.value && (props.po.eqRoundCount > 0 || props.po.eqReview !== null));
const reviewsQuery = useAdminPcbEqRounds(poIdRef, listEnabled, ref(false));
// 고객이 답하거나 전달되면 발주 요약이 먼저 바뀐다 — 그때 회차 목록(선택 요약의 출처)도 다시 읽는다.
watch(
  () => [props.po.eqReview?.status, props.po.eqReview?.decidedAt, props.po.eqReview?.forwardedAt, props.po.eqRoundCount],
  () => {
    if (listEnabled.value) void reviewsQuery.refetch();
  },
);
/** 그 시각이 이 요청 회차의 시간 창 (startAt, endAt] 에 드는가 — 고객 확인을 어느 요청 회차에 붙일지의 기준. */
const inRound = (r: PcbEqRoundSummary<EqFile>, iso: string): boolean => {
  const at = Date.parse(iso);
  const from = r.startAt === null ? Number.NEGATIVE_INFINITY : Date.parse(r.startAt);
  const to = r.endAt === null ? Number.POSITIVE_INFINITY : Date.parse(r.endAt);
  return at > from && at <= to;
};
const roundReviews = computed<AdminPcbEqReviewViewType[]>(() =>
  (reviewsQuery.data.value?.data.reviews ?? []).filter((v) => inRound(current.value, v.requestedAt)).sort((a, b) => a.id - b.id),
);
/** 취소된 것은 살아 있는 것이 없을 때만 보인다(다시 보낸 회차가 있으면 그것이 답이다). */
const shownReviews = computed(() => {
  const live = roundReviews.value.filter((v) => v.status !== 'canceled');
  return live.length > 0 ? live : roundReviews.value.slice(-1);
});
const reviewChip = (v: AdminPcbEqReviewViewType): PcbBadge & { title: string } =>
  v.status === 'canceled'
    ? { label: `고객 확인${v.roundNo === null ? '' : ` ${String(v.roundNo)}차`} · 요청 취소`, variant: 'outline', title: '고객에게 보낸 확인 요청을 취소했습니다.' }
    : { ...pcbEqReviewBadge(v), title: pcbEqRowTitle(v) };
// ⚠ 발주 요약(eqReview)은 **마지막 승인요청 뒤**의 것이라, 반려·추가 EQ 요청으로 돌아온 직후(아직 다시 요청하기
//   전)에는 **지난 회차의 답**을 싣고 있다. 그대로 최신 회차에 세우면 방금 열린 2차에 "1차 · 전달됨"이 붙는다 —
//   요약도 시간 창으로 가른다. 요약이 없을 때의 AI 분석 칩(분석 중·안 됨)은 이번 요청의 것이라 그대로 쓴다.
const summaryIsCurrent = computed(() => props.po.eqReview === null || inRound(latest.value, props.po.eqReview.requestedAt));
const chips = computed<(PcbBadge & { title: string })[]>(() => {
  const summary = isLatest.value && summaryIsCurrent.value ? eqChipOf(props.po) : null;
  return summary !== null ? [{ ...summary, title: eqReviewTitleOf(props.po) }] : shownReviews.value.map(reviewChip);
});
/** 고객 선택 요약 "1: B · 2: A" — 공장이 자기 표에 옮겨 적는 모양(포털의 요약과 같은 꼴). */
const answers = computed(() => {
  const v = [...shownReviews.value].reverse().find((x) => x.format === 'items' && x.items.some((it) => it.answer !== null));
  return v === undefined ? [] : v.items.map((it, i) => ({ no: it.factoryNo ?? String(i + 1), key: it.answer?.key ?? '—' }));
});

// ── 판정 ─────────────────────────────────────────────────────────────────────
const reworkKind = computed(() => poRework(props.po)?.kind ?? 'reject');
const canJudge = computed(() => isLatest.value && hands.value && props.po.status === 'eq_requested');
const canRevert = computed(() => isLatest.value && hands.value && props.po.status === 'eq_done');
const canReply = computed(() => isLatest.value && canEditPcbEqFile('reply', props.po.status));
/** EQ 에 관한 협력사 몫 대행 — 승인요청(발주접수)·추가 EQ 요청(승인 뒤). 생산·발송 대행은 행 액션에 있다. */
const canProxyRequest = computed(() => isLatest.value && proxy.value && substituteActionOf(props.po.status) === 'eq-request');
const canProxyReopen = computed(() => isLatest.value && proxy.value && canSubstituteReopen(props.po));
</script>

<template>
  <!-- EQ 승인요청 = 관리자 차례 — 본행과 같이 강조한다. -->
  <TableRow :data-state="po.status === 'eq_requested' ? 'selected' : undefined" data-eq-band :data-eq-band-po="po.poId">
    <TableCell :colspan="6" class="bg-muted/40 whitespace-normal">
      <!-- 접힘 — 한 줄만 남긴다. [EQ 열기]는 지난 고객 답을 다시 볼 문이라 접혀도 남는다. -->
      <div v-if="collapsed" class="text-muted-foreground flex flex-wrap items-center gap-2 pl-6 text-xs" data-eq-band-collapsed>
        <span class="text-foreground font-medium">{{ stencil ? '확인' : 'EQ' }} 완료</span>
        <span>요청 {{ rounds.length }}회<template v-if="po.eqRoundCount > 0"> · 고객 확인 {{ po.eqRoundCount }}회</template></span>
        <span v-if="eqOpenHere" data-eq-row-chip>
          <Button variant="outline" size="xs" :title="eqReviewTitleOf(po)" @click="openEqWorkspace(po)">
            <ClipboardListIcon />
            {{ eqOpenLabelOf(po) }}
          </Button>
        </span>
        <Button variant="ghost" size="xs" data-eq-band-toggle @click="toggleEqBand(po.poId)">
          <ChevronRightIcon />
          이력 보기
        </Button>
      </div>

      <div v-else class="pl-6">
        <div class="flex flex-wrap items-start gap-x-5 gap-y-3">
          <!-- 머리 — 회차 칩. 한 회차뿐이면 고를 것이 없다. -->
          <div class="flex shrink-0 flex-col gap-1.5">
            <p class="text-xs font-semibold">{{ caption }}</p>
            <ButtonGroup v-if="rounds.length > 1" :aria-label="`${caption} 회차`">
              <Button
                v-for="r in rounds"
                :key="r.index"
                :variant="r.index === current.index ? 'default' : 'outline'"
                size="xs"
                :aria-pressed="r.index === current.index"
                :title="`${String(r.index)}차 — ${outcomeLabel(r)}`"
                :data-eq-round="r.index"
                :data-eq-round-outcome="outcomeOf(r)"
                @click="picked = r.index"
              >
                {{ r.index }}차
                <span class="size-1.5 rounded-full" :class="r.index === current.index ? 'bg-primary-foreground/80' : OUTCOME_DOT[outcomeOf(r)]" />
              </Button>
            </ButtonGroup>
            <p v-if="!isLatest" class="text-muted-foreground text-xs" data-eq-band-readonly>지난 회차 — 보기 전용</p>
            <Button v-if="afterEq" variant="ghost" size="xs" data-eq-band-toggle @click="toggleEqBand(po.poId)">
              <ChevronDownIcon />
              접기
            </Button>
          </div>

          <div class="grid min-w-0 flex-1 basis-[36rem] gap-x-5 gap-y-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.25fr)]">
            <!-- ① 협력사 제출 -->
            <div class="min-w-0" data-eq-band-submit>
              <p class="text-muted-foreground mb-1 text-xs font-medium">
                협력사 제출
                <template v-if="current.requestedAt !== null">
                  · {{ PCB_PO_STATUS_LABELS[po.track].eq_requested }} {{ when(current.requestedAt) }}
                  <template v-if="current.requestedBy !== null && current.requestedBy !== 'PARTNER'">({{ roleLabel(current.requestedBy) }})</template>
                </template>
              </p>
              <!-- 스텐실 — 협력사가 보낸 고객문의사항. 확인/보완을 결정하는 근거 본문이라 첨부보다 먼저 선다. -->
              <Panel v-if="inquiry !== null" size="xs" tone="info" class="mb-1.5 text-xs" data-eq-band-inquiry>
                <span class="inline-flex items-center gap-1 font-medium">
                  <MessageSquareTextIcon class="size-3.5" />
                  고객문의사항
                </span>
                <span class="mt-0.5 block whitespace-pre-wrap">{{ inquiry }}</span>
              </Panel>
              <ul v-if="files.length > 0" class="grid gap-1">
                <li v-for="f in files" :key="f.fileId" class="flex min-w-0 items-center gap-1" :data-eq-band-file="f.fileId">
                  <Badge variant="outline">{{ fileLabel(f) }}</Badge>
                  <ButtonGroup class="min-w-0">
                    <Button :variant="superseded(f) ? 'ghost' : 'outline'" size="xs" class="min-w-0" :title="fileTitle(f)" @click="download(f)">
                      <HistoryIcon v-if="superseded(f)" />
                      <DownloadIcon v-else />
                      <span class="truncate">{{ f.name }}</span>
                    </Button>
                    <!-- 승인됐거나 고객 확인에 쓰인 파일(locked)은 기록이라 대행으로도 지우지 않는다 -->
                    <Button
                      v-if="canUpload && !f.locked"
                      :variant="superseded(f) ? 'ghost' : 'outline'"
                      size="icon-xs"
                      title="첨부 삭제(대행)"
                      aria-label="첨부 삭제(대행)"
                      @click="void removeEqFileAdmin(po, f.fileId)"
                    >
                      <XIcon />
                    </Button>
                  </ButtonGroup>
                  <Badge v-if="superseded(f)" variant="secondary">이전</Badge>
                  <Badge v-else-if="isLatest && f.afterReject" variant="success" :title="afterReworkNote">보완</Badge>
                </li>
              </ul>
              <p v-else class="text-muted-foreground text-xs">
                {{ isLatest && po.status === 'issued' ? '아직 올라온 파일이 없습니다 — 협력사 제출 대기.' : '이 회차에 올라온 파일이 없습니다.' }}
              </p>
              <!-- D11 대행 업로드 — 발주접수(잠금 전)에서만, 협력사 대신 첨부 -->
              <p v-if="canUpload" class="mt-1.5 flex flex-wrap items-center gap-1" data-eq-band-proxy-upload>
                <span class="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  <UserCogIcon class="size-3.5" />
                  대행 첨부
                </span>
                <Button
                  v-for="k in uploadKinds"
                  :key="k.type"
                  variant="ghost"
                  size="xs"
                  :title="k.title"
                  :data-eq-band-upload="k.type"
                  @click="pickEqFileAdmin(po, k.type)"
                >
                  <UploadIcon />
                  {{ k.label }}
                </Button>
              </p>
            </div>

            <!-- ② 고객 확인 — 칩이 상태를 말하고 조작은 [EQ 열기] 안에서 한다 -->
            <div class="min-w-0">
              <p class="text-muted-foreground mb-1 text-xs font-medium">고객 확인</p>
              <div class="flex flex-wrap items-center gap-1" data-eq-row-chip>
                <Badge v-for="(c, i) in chips" :key="i" :variant="c.variant" :title="c.title">{{ c.label }}</Badge>
                <span v-if="chips.length === 0" class="text-muted-foreground text-xs">
                  {{ isLatest && po.status === 'eq_requested' ? '아직 묻지 않음' : '고객 확인 없음' }}
                </span>
                <Button v-if="eqOpenHere" variant="outline" size="xs" :title="eqReviewTitleOf(po)" @click="openEqWorkspace(po)">
                  <ClipboardListIcon />
                  {{ eqOpenLabelOf(po) }}
                </Button>
              </div>
              <p v-if="answers.length > 0" class="mt-1.5 flex flex-wrap items-center gap-1" data-eq-band-answers>
                <span class="text-muted-foreground text-xs">고객 선택</span>
                <Badge v-for="a in answers" :key="a.no" variant="outline">{{ a.no }}: {{ a.key }}</Badge>
              </p>
            </div>

            <!-- ③ 판정 — 무엇을 보고 누르는지가 왼쪽에 있다 -->
            <div class="min-w-0" data-eq-band-judge>
              <p class="text-muted-foreground mb-1 text-xs font-medium">판정</p>
              <div class="flex flex-wrap items-center gap-1">
                <template v-if="canJudge">
                  <!-- 반려(보완 요청)했거나 협력사가 추가 EQ 를 요청했는데 그 뒤로 올라온 파일이 없다 = 같은 파일로 온 재요청 -->
                  <Badge v-if="eqUnfixedAfterReject(po)" variant="danger" :title="pcbEqUnfixedTitle(po.track, reworkKind)" data-eq-unfixed>
                    {{ pcbEqUnfixedLabel(po.track, reworkKind) }}
                  </Badge>
                  <Button
                    size="sm"
                    :title="stencil ? '확인하면 좌표파일이 고객 주문내역에서 내려받기 가능해집니다(통보는 없습니다).' : undefined"
                    @click="void approvePo(po)"
                  >
                    <CheckIcon />
                    {{ pcbEqForwardLabel('eq_requested', po.track) }}
                  </Button>
                  <!-- 반려는 스텐실에도 남긴다 — 좌표파일이 틀렸을 때 돌려보낼 유일한 문이다. -->
                  <Button variant="outline" size="sm" @click="rejectPoId = po.poId">
                    <XIcon class="text-destructive" />
                    {{ pcbEqRejectActionLabel(po.track) }}
                  </Button>
                </template>
                <template v-else-if="outcomeOf(current) === 'approved'">
                  <Badge variant="success">{{ outcomeLabel(current) }}{{ current.approvedAt === null ? '' : ` ${when(current.approvedAt)}` }}</Badge>
                  <Button v-if="canRevert" variant="ghost" size="sm" @click="void revertPo(po)">
                    <Undo2Icon />
                    {{ pcbEqRevertLabel('eq_done', po.track) }}
                  </Button>
                </template>
                <template v-else-if="outcomeOf(current) === 'rejected'">
                  <Badge variant="danger">{{ outcomeLabel(current) }} {{ when(current.closedAt) }}</Badge>
                </template>
                <template v-else-if="outcomeOf(current) === 'reopened'">
                  <Badge v-if="current.approvedAt !== null" variant="success">
                    {{ pcbEqEventLabel({ fromStatus: 'eq_requested', toStatus: 'eq_done' }, po.track) }} {{ when(current.approvedAt) }}
                  </Badge>
                  <Badge variant="warning">{{ outcomeLabel(current) }} {{ when(current.closedAt) }} · {{ roleLabel(current.closedBy) }}</Badge>
                </template>
                <span v-else-if="outcomeOf(current) === 'requested'" class="text-muted-foreground text-xs">
                  {{ hands ? '승인 대기' : '하위 발주서에서 진행' }}
                </span>
                <span v-else class="text-muted-foreground text-xs">협력사 제출 대기</span>
              </div>
              <!-- 사유 — 반려는 우리가 쓴 말, 추가 EQ 요청은 협력사가 쓴 말. 잘리지 않게 다 보인다. -->
              <p
                v-if="current.closedNote !== null && current.closedNote !== ''"
                class="mt-1 text-xs whitespace-pre-wrap"
                :class="outcomeOf(current) === 'reopened' ? 'text-warning' : 'text-destructive'"
                data-eq-band-note
              >
                “{{ current.closedNote }}”
              </p>
              <!-- 돌아온 뒤의 최신 회차 — 왜 돌아왔는지는 직전 회차의 결말이다. 다시 승인요청이 와 있는 동안에도 남긴다
                   (무엇을 고치라고 했는지·무엇을 확인하려 다시 열었는지가 승인 판단의 근거). 누구 말인지 머리말로 가른다. -->
              <p
                v-else-if="isLatest && (outcomeOf(current) === 'open' || outcomeOf(current) === 'requested') && previous !== null && previous.closedNote !== null && previous.closedNote !== ''"
                class="mt-1 text-xs whitespace-pre-wrap"
                :class="previous.outcome === 'reopened' ? 'text-warning' : 'text-destructive'"
                data-eq-band-prev-note
                data-eq-rework-note
              >
                {{ previous.index }}차 {{ outcomeLabel(previous) }}{{ previous.outcome === 'reopened' ? ` · ${roleLabel(previous.closedBy)}` : '' }}: “{{ previous.closedNote }}”
              </p>

              <!-- 관리자 회신 — 우리가 협력사에게 **보내는** 첨부(수정지시 도면·마크업). 승인요청을 받은 상태에서도
                   붙일 수 있다(그때가 회신할 순간이다 — 계약 canEditPcbEqFile). -->
              <div
                v-if="current.replyFiles.length > 0 || canReply"
                class="mt-1.5 flex flex-wrap items-center gap-1 border-t border-dashed pt-1.5"
                data-eq-band-reply
              >
                <span class="text-info inline-flex items-center gap-1 text-xs font-medium">
                  <CornerDownLeftIcon class="size-3.5" />
                  회신
                </span>
                <ButtonGroup v-for="f in current.replyFiles" :key="f.fileId" class="min-w-0">
                  <Button variant="outline" size="xs" class="min-w-0" :title="`관리자 회신 · ${f.name} — 협력사가 포털에서 받습니다`" @click="download(f)">
                    <DownloadIcon />
                    <span class="truncate">{{ f.name }}</span>
                  </Button>
                  <Button
                    v-if="canReply"
                    variant="outline"
                    size="icon-xs"
                    title="회신 첨부 삭제"
                    aria-label="회신 첨부 삭제"
                    @click="void removeEqFileAdmin(po, f.fileId)"
                  >
                    <XIcon />
                  </Button>
                </ButtonGroup>
                <Button
                  v-if="canReply"
                  variant="ghost"
                  size="xs"
                  title="협력사에게 돌려보낼 수정지시 파일을 첨부합니다 — 반려 메일이 첨부 사실을 알립니다."
                  @click="pickEqFileAdmin(po, 'reply')"
                >
                  <UploadIcon />
                  회신 첨부
                </Button>
              </div>

              <!-- 협력사 몫 대행(D11) — EQ 에 관한 것만 여기(승인요청·추가 EQ 요청). 생산·발송 대행은 행 액션. -->
              <div
                v-if="canProxyRequest || canProxyReopen"
                class="mt-1.5 flex flex-wrap items-center gap-1 border-t border-dashed pt-1.5"
                data-eq-band-proxy
              >
                <span class="text-muted-foreground inline-flex items-center gap-1 text-xs">
                  <UserCogIcon class="size-3.5" />
                  협력사 대행
                </span>
                <Button v-if="canProxyRequest" variant="outline" size="sm" @click="void runSubstitute(po)">
                  <UserCogIcon />
                  {{ substituteLabelOf(po, 'eq-request') }}
                </Button>
                <Button
                  v-if="canProxyReopen"
                  variant="outline"
                  size="sm"
                  title="협력사 포털의 [추가 EQ 요청]과 같습니다 — 사유를 적으면 발주가 '발주접수'로 돌아가 EQ 를 다시 올릴 수 있습니다."
                  @click="void substituteReopen(po)"
                >
                  <MessageCircleQuestionIcon />
                  {{ PCB_EQ_REOPEN.label }}(대행)
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </TableCell>
  </TableRow>
</template>
