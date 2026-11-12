<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { DEV_DIAGRAM_DISCLAIMER, developWishLabel } from '@sp/api-contract';
import type { DevelopRequestStatusType } from '@sp/api-contract';
import { useAuthStore } from '@sp/shared';
import { parseDiagramDoc } from '@sp/ui';
import type { DiagramFigure } from '@sp/ui';
import { DECK_STRETCH, balanceDeckChunks, packDeckColumns } from '@sp/utils';
import { useDevelopRequest } from '../api/useDevelopRequests';
import { developPath, loginUrl } from '../lib/auth-urls';
import { COMPANY } from '../lib/company';
import {
  buildBriefTable,
  buildDeckAreas,
  buildDeckQa,
  buildDeckQuestions,
  buildDocTable,
  buildFileTable,
  buildOverviewTable,
  buildScheduleTable,
  buildTaskTable,
  joinLabels,
} from '../lib/deck-content';
import type { DeckArea, DeckQa as DeckQaItem, DeckQuestion as DeckQuestionItem, DeckRow, DeckTableDef } from '../lib/deck-content';
import { DECK, DECK_BODY_WIDTH, DECK_COLUMN_WIDTH, DECK_TABLE_HEAD, deckBodyHeight } from '../lib/deck-layout';
import { splitTextToFit } from '../lib/deck-text';
import { errorMessage } from '../lib/error-msg';
import { dateDotFull, dateTimeKst } from '../lib/format';
import DeckAreaBlock from '../components/deck/DeckAreaBlock.vue';
import DeckProgressLead from '../components/deck/DeckProgressLead.vue';
import DeckQa from '../components/deck/DeckQa.vue';
import DeckQuestion from '../components/deck/DeckQuestion.vue';
import DeckScheduleTotals from '../components/deck/DeckScheduleTotals.vue';
import DeckSlide from '../components/deck/DeckSlide.vue';
import DeckSummary from '../components/deck/DeckSummary.vue';
import DeckTable from '../components/deck/DeckTable.vue';

// 의뢰 출력물('출력하기') — 16:9 장(슬라이드) 판(2026-11-12, 사용자 결정 — docs/DEVELOP_FLOW.md §7.2.10).
// 그 전(10-22~11-06)은 상세 화면 컴포넌트를 한 줄기로 그려 PPT 4:3 쪽 경계에서 밀어내는 방식이었다. 지금은 **장이 먼저**다:
// 장마다 주제 하나 · 같은 틀(DeckSlide) · 본문은 그 장에 맞게 따로 그린다 — 한 화면에 딱 담기고, 넘겨 볼 때 틀이 이어진다.
// 넘치는 내용은 덩어리 높이를 숨은 자리에서 재어 장에 배분한다(@sp/utils deck-pack): 분야는 단에 쌓고(큰 분야는 혼자 한 장),
// 표는 행 단위로 · 문항은 장 수를 최소로 하되 고르게 나누고, 긴 글(의뢰 내용 · 담당자 의견)은 줄 경계에서 단으로 흘린다(lib/deck-text).
// 그래도 넘치는 장은 글자를 줄여 담는다(DeckSlide).
// 순서: 표지 → 의뢰 개요(· 의뢰 내용) → AI 추가 질문 → 세부 질문 답변 → 검토 요약 → 시스템 구성도 → 개발 분석 → 예상 개발 일정 →
// 확인이 필요한 사항 → 담당자 의견(길 때만) → 진행 현황 · 프로젝트 문서(착수 뒤) → 첨부 자료. 내용이 없는 장은 만들지 않는다.
// 구성도는 도면만 싣는다 — 도면 앞뒤 글(요구사항 확인 요약 · 확정된 구성 · 미확정 항목 …)은 뺀다(같은 날 결정).
// 견적서 · 진행 · 문의는 싣지 않는다(2026-11-06 결정 그대로 — 견적서는 견적서 인쇄 · PDF 가 따로 있고, 진행 기록은 화면에서 본다).
// 브라우저 인쇄만(견적서 인쇄 D12 관례) — 쪽 = 장(1280×720px = 13.333×7.5in). 셸이 없는 라우트(meta.bare)다.

const auth = useAuthStore();
const route = useRoute();
const loggedIn = computed(() => auth.isLoggedIn);
const requestId = computed<number | null>(() => {
  const n = Number(route.params.id);
  return Number.isInteger(n) && n > 0 ? n : null;
});
const detailQ = useDevelopRequest(requestId, loggedIn);
const detail = computed(() => detailQ.data.value?.data);

// ── 표지 ──────────────────────────────────────────────────────────────────────
// 문서 이름 — 견적 수락 전은 제안서, 수락 뒤(착수금 대기 포함)는 진행 보고서.
const REPORT_STATUSES: readonly DevelopRequestStatusType[] = ['accepted', 'in_progress', 'delivered', 'completed'];
const BEFORE_START: readonly DevelopRequestStatusType[] = ['received', 'reviewing', 'quoted', 'accepted'];
const docName = computed(() => (detail.value !== undefined && REPORT_STATUSES.includes(detail.value.status) ? '개발 진행 보고서' : '제품 개발 제안서'));
// 제목 글자 크기 — 길이에 맞춰 두세 줄 안에 들게(의뢰 제목은 200자까지).
const coverTitleClass = computed(() => {
  const n = detail.value?.title.length ?? 0;
  if (n <= 14) return 'text-[68px]';
  if (n <= 26) return 'text-[58px]';
  if (n <= 44) return 'text-[48px]';
  if (n <= 70) return 'text-[40px]';
  return 'text-[32px]';
});
// 연락처는 담당자 개인 번호가 아니라 회사 대표번호(개인 연락처를 내보내지 않는 규칙).
const coverMeta = computed(() => {
  const d = detail.value;
  if (d === undefined) return [];
  return [
    { label: '의뢰 번호', value: `No. ${String(d.requestId)}` },
    { label: '접수', value: dateDotFull(d.createdAt) },
    { label: '담당', value: d.assigneeName ?? '샘플피씨비 개발팀' },
    { label: '문의', value: COMPANY.tel },
  ];
});

// ── 내용 ──────────────────────────────────────────────────────────────────────
const review = computed(() => detail.value?.review ?? null);
const description = computed(() => detail.value?.description ?? '');
const comment = computed(() => review.value?.adminComment ?? '');
const wishLabel = computed(() => (detail.value === undefined ? '' : developWishLabel(detail.value.wishDate, detail.value.wishNote)));
const schedule = computed(() => {
  const s = review.value?.schedule ?? null;
  return s !== null && s.phases.length > 0 ? s : null;
});
// 진행 현황 — 착수 뒤, 끝난(취소 · 사양) 의뢰가 아닐 때만. 프로젝트 문서는 그 안에서만 싣는다.
const started = computed(() => {
  const d = detail.value;
  return d !== undefined && d.status !== 'cancelled' && d.status !== 'declined' && !BEFORE_START.includes(d.status);
});
// 정보 줄에 생성 모델명은 쓰지 않는다(사용자 결정 — 내부 공급사 이름을 고객에게 보이지 않는다).
const reviewMeta = computed(() => {
  const r = review.value;
  if (r === null) return '';
  const parts: string[] = [];
  if (r.meta.generatedAt !== '') parts.push(`${dateTimeKst(r.meta.generatedAt)} 생성`);
  const seq = detail.value?.reviewPublicSeq ?? null;
  if (seq !== null) parts.push(`v${String(seq)} 공개본`);
  if (r.meta.attachmentFiles.length > 0) parts.push(`첨부 ${r.meta.attachmentFiles.join(', ')}`);
  return parts.join(' · ');
});

// 표 — 넓은 판(본문 폭)과 촘촘한 판(한 단 폭 — halves 인 표만)을 둘 다 재어 어느 쪽으로 실을지 정한다.
type TableId = 'overview' | 'brief' | 'schedule' | 'tasks' | 'docs' | 'files';
const EMPTY_TABLE: DeckTableDef = { cols: [], denseCols: [], rows: [], compact: false };
const tables = computed<Record<TableId, DeckTableDef>>(() => {
  const d = detail.value;
  if (d === undefined) return { overview: EMPTY_TABLE, brief: EMPTY_TABLE, schedule: EMPTY_TABLE, tasks: EMPTY_TABLE, docs: EMPTY_TABLE, files: EMPTY_TABLE };
  return {
    overview: buildOverviewTable(d),
    brief: buildBriefTable(d),
    schedule: schedule.value === null ? EMPTY_TABLE : buildScheduleTable(schedule.value),
    tasks: started.value ? buildTaskTable(d.progress) : EMPTY_TABLE,
    docs: started.value ? buildDocTable(d.documents) : EMPTY_TABLE,
    files: buildFileTable(d.files),
  };
});
const TABLE_IDS: readonly TableId[] = ['overview', 'brief', 'schedule', 'tasks', 'docs', 'files'];
const HALVES: readonly TableId[] = ['overview', 'brief', 'files'];

const areas = computed<DeckArea[]>(() => (review.value === null ? [] : buildDeckAreas(review.value)));
const questions = computed<DeckQuestionItem[]>(() => (review.value === null ? [] : buildDeckQuestions(review.value)));
const qa = computed(() => (detail.value === undefined ? null : buildDeckQa(detail.value)));

const diagram = computed(() => detail.value?.diagram ?? null);
const diagramDoc = computed(() => (diagram.value === null ? null : parseDiagramDoc(diagram.value.html)));
// 구조를 못 읽은 구성도(이미지 업로드 포함) — 원문을 한 장에. AI 원문은 도면을 원본 크기로 두고 가로 스크롤시키므로 폭에 맞춘다.
const FIT_STYLE = '<style>html,body{margin:0}svg,img{max-width:100%!important;height:auto!important}</style>';
const diagramRaw = computed(() => {
  const html = diagram.value?.html ?? '';
  return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${FIT_STYLE}</head>`) : `${FIT_STYLE}${html}`;
});
const diagramNote = computed(() => (diagram.value?.source === 'upload' ? '담당자가 검토 후 작성한 구성도입니다.' : DEV_DIAGRAM_DISCLAIMER));
// 도면 이름 — 생성 프롬프트가 순서를 정해 둔다(① 시스템 토폴로지 ② 하드웨어 기능 블록도).
const figureName = (index: number, count: number): string => {
  if (count === 2) return index === 0 ? '시스템 토폴로지' : '하드웨어 기능 블록도';
  return count > 2 ? `도면 ${String(index + 1)}` : '';
};

// ── 높이 재기 → 배분 ─────────────────────────────────────────────────────────
// 덩어리를 장에 실릴 폭 그대로 숨은 자리에 한 번 그려 높이를 잰다(글꼴이 들어온 뒤). 내용이 바뀌면 다시 잰다.
// 긴 글은 이때 줄 경계에서 잘라 둔다. 사이 간격은 그리는 쪽과 같은 값을 쓴다.
const AREA_GAP = 30;
const QUESTION_GAP = 22;
const QA_GAP = 18;
const LEAD_GAP = 18; // 달성도 띠 · AI 가 이해한 내용 상자 아래
const TAIL_GAP = 14; // 일정 합계 띠 위(DeckScheduleTotals 의 위 여백)
const TEXT_HEAD = 41; // 의뢰 개요 오른쪽 단의 '의뢰 내용' 제목(29) + 아래 12
const EXTRA_GAP = 22; // 의뢰 개요 오른쪽 단의 덩어리 사이
const AFTER_GAP = 24; // 표 아래 이어 붙는 표(프로젝트 문서)의 제목 위
const AFTER_HEAD = 39; // 그 제목(29) + 아래 10
const TEXT_WIDE = 'whitespace-pre-wrap text-[20px] leading-[1.75] [overflow-wrap:anywhere] [tab-size:2]';
const TEXT_DENSE = 'whitespace-pre-wrap text-[17px] leading-[1.7] [overflow-wrap:anywhere] [tab-size:2]';
const QA_LEAD = 'rounded-[10px] bg-brand-50 px-[20px] py-[14px] text-[16px] leading-[1.6]';
const CAP = deckBodyHeight(false);
const CAP_SUB = deckBodyHeight(true);

// 긴 글을 어디에 어떻게 싣나 — inline = 다른 장 안에(의뢰 개요 오른쪽 단 · 검토 요약의 옅은 판), wide = 혼자 한 장에 큰 글자로,
// columns = 두 단짜리 장 여러 개(조각마다 한 단).
interface TextPlan {
  mode: 'inline' | 'wide' | 'columns';
  chunks: string[];
}
interface Measured {
  sizes: Record<string, number[]>;
  description: TextPlan;
  comment: TextPlan;
}
const measureEl = ref<HTMLElement | null>(null);
const measured = ref<Measured | null>(null);
const sum = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0);
let measureRun = 0;
watch(
  detail,
  async (d) => {
    const run = (measureRun += 1);
    measured.value = null;
    if (d === undefined) return;
    await nextTick();
    await document.fonts.ready;
    const root = measureEl.value;
    if (root === null || run !== measureRun) return;
    const sizes: Record<string, number[]> = {};
    for (const el of root.querySelectorAll('[data-measure]')) {
      const key = el.getAttribute('data-measure') ?? '';
      (sizes[key] ??= []).push(el.getBoundingClientRect().height);
    }
    const one = (key: string): number => sizes[key]?.[0] ?? 0;
    const host = (key: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-measure="${key}"]`);
    const flow = (text: string, key: string): TextPlan => {
      if (one(`${key}-wide`) <= CAP) return { mode: 'wide', chunks: [text] };
      const el = host(`${key}-dense`);
      return { mode: 'columns', chunks: el === null ? [text] : splitTextToFit(el, text, CAP) };
    };
    // 의뢰 내용 — 조건 표가 한 단에 들고 글도 한 단에 들면 의뢰 개요 한 장에 같이 싣는다.
    const overviewFits = DECK_TABLE_HEAD.dense + sum(sizes['overview:dense'] ?? []) + 2 <= CAP;
    const descInline = overviewFits && TEXT_HEAD + one('desc-dense') <= CAP;
    // 담당자 의견 — 검토 요약 장에 같이 들면 거기에, 아니면 뒤쪽 장으로.
    const commentText = d.review?.adminComment ?? '';
    measured.value = {
      sizes,
      description: descInline ? { mode: 'inline', chunks: [d.description] } : flow(d.description, 'desc'),
      comment: commentText === '' || one('summary') <= CAP ? { mode: 'inline', chunks: [commentText] } : flow(commentText, 'comment'),
    };
  },
  { immediate: true },
);

// ── 장 목록 ───────────────────────────────────────────────────────────────────
const SECTION = { request: '의뢰 내용', review: 'AI 사전 검토서', progress: '진행 현황', files: '첨부 자료' } as const;
interface SlideHead {
  key: string;
  section: string;
  title: string;
  subtitle: string;
}
// 표 장 — after = 표 아래 이어 붙는 표(진행 현황 마지막 장의 프로젝트 문서), height = 실린 내용 높이(이어 붙일 자리가 있는지 본다).
interface TableSlide {
  kind: 'table';
  table: TableId;
  dense: boolean;
  columns: DeckRow[][];
  lead: boolean;
  tail: boolean;
  after: TableId | null;
  height: number;
}
type Slide = SlideHead &
  (
    | { kind: 'cover' }
    | { kind: 'overview'; rows: DeckRow[]; text: string; extras: TableId[] }
    | TableSlide
    | { kind: 'text'; wide: boolean; columns: string[] }
    | { kind: 'qa'; understood: string; items: DeckQaItem[] }
    | { kind: 'summary'; comment: string }
    | { kind: 'diagram'; figure: DiagramFigure | null; name: string; index: number; count: number }
    | { kind: 'area-solo'; area: DeckArea }
    | { kind: 'area-columns'; columns: DeckArea[][] }
    | { kind: 'questions'; items: DeckQuestionItem[] }
  );
const pick = <T,>(list: readonly T[], indexes: readonly number[]): T[] => indexes.flatMap((i) => (list[i] === undefined ? [] : [list[i]]));
// 여러 장에 걸친 주제는 제목에 차례를 붙인다('세부 질문 답변 (2/3)').
const numbered = (title: string, i: number, n: number): string => (n > 1 ? `${title} (${String(i + 1)}/${String(n)})` : title);
const pairs = <T,>(list: readonly T[]): T[][] => list.flatMap((_, i) => (i % 2 === 0 ? [list.slice(i, i + 2)] : []));

const slides = computed<Slide[]>(() => {
  const d = detail.value;
  const m = measured.value;
  if (d === undefined || m === null) return [];
  const size = (key: string): number[] => m.sizes[key] ?? [];
  const one = (key: string): number => size(key)[0] ?? 0;
  // 잰 뒤 내용이 바뀌어 수가 안 맞으면 그리지 않는다(다시 잴 때까지).
  if (size('area').length !== areas.value.length || size('question').length !== questions.value.length) return [];
  if (TABLE_IDS.some((id) => size(`${id}:wide`).length !== tables.value[id].rows.length)) return [];

  const list: Slide[] = [];
  const push = (slide: Slide): void => {
    list.push(slide);
  };

  // 표 → 장. halves 인 표는 넓은 판 한 장에 다 들면 그대로, 아니면 촘촘한 판을 두 단씩. 나머지는 행 단위로 고르게.
  // 조금 넘치는 정도(DECK_STRETCH)면 나누지 않는다 — 그 장이 글자를 줄여 담는다. lead · tail = 첫 장 위 · 마지막 장 아래에
  // 붙는 덩어리 높이(달성도 띠 · 일정 합계 띠).
  const headOf = (id: TableId): number => (tables.value[id].compact ? DECK_TABLE_HEAD.dense : DECK_TABLE_HEAD.wide);
  const denseHeight = (id: TableId): number => DECK_TABLE_HEAD.dense + sum(size(`${id}:dense`)) + 2;
  const tableSlides = (id: TableId, section: string, title: string, extra: { lead?: number; tail?: number; fill?: boolean } = {}): (SlideHead & TableSlide)[] => {
    const rows = tables.value[id].rows;
    const wide = size(`${id}:wide`);
    const cap = CAP - headOf(id) - 2;
    const head = { section, subtitle: '', kind: 'table' as const, table: id, after: null };
    const total = sum(wide) + (extra.lead ?? 0) + (extra.tail ?? 0);
    if (HALVES.includes(id) && total > cap * DECK_STRETCH) {
      const groups = pairs(balanceDeckChunks(size(`${id}:dense`), CAP - DECK_TABLE_HEAD.dense - 2, 0, { multipleOf: 2 }));
      return groups.map((group, i) => ({
        ...head,
        key: `${id}${String(i)}`,
        title: numbered(title, i, groups.length),
        dense: true,
        columns: group.map((c) => pick(rows, c)),
        lead: false,
        tail: false,
        height: CAP,
      }));
    }
    const all = rows.map((_, i) => i);
    const chunks = rows.length === 0 || total <= cap * DECK_STRETCH ? [all] : balanceDeckChunks(wide, cap, 0, extra);
    return chunks.map((chunk, i) => {
      const lead = extra.lead !== undefined && i === 0;
      const tail = extra.tail !== undefined && i === chunks.length - 1;
      return {
        ...head,
        key: `${id}${String(i)}`,
        title: numbered(title, i, chunks.length),
        dense: false,
        columns: [pick(rows, chunk)],
        lead,
        tail,
        // 빈 표는 안내 한 줄(80 남짓)
        height: (lead ? (extra.lead ?? 0) : 0) + (tail ? (extra.tail ?? 0) : 0) + (chunk.length === 0 ? 80 : headOf(id) + 2 + sum(pick(wide, chunk))),
      };
    });
  };
  // 긴 글 → 장. wide 는 한 장, columns 는 조각 둘이 한 장.
  const textSlides = (plan: TextPlan, key: string, section: string, title: string): void => {
    if (plan.mode === 'wide') {
      push({ kind: 'text', key, section, title, subtitle: '', wide: true, columns: plan.chunks });
      return;
    }
    const groups = pairs(plan.chunks);
    groups.forEach((columns, i) => {
      push({ kind: 'text', key: `${key}${String(i)}`, section, title: numbered(title, i, groups.length), subtitle: '', wide: false, columns });
    });
  };

  push({ kind: 'cover', key: 'cover', section: '', title: '', subtitle: '' });

  // 의뢰 개요 — 왼쪽 단에 조건 표, 오른쪽 단에 의뢰 내용 · 세부 질문 답변 · 첨부 자료를 드는 만큼 쌓는다(행 두셋짜리 표가
  // 한 장을 혼자 쓰지 않게). 오른쪽에 실을 것이 없으면 조건 표만 넓게. 못 실은 것은 아래에서 제 장을 갖는다.
  const inlined = new Set<TableId>();
  let used = m.description.mode === 'inline' ? TEXT_HEAD + one('desc-dense') : 0;
  if (denseHeight('overview') <= CAP) {
    for (const id of ['brief', 'files'] as const) {
      const next = used + (used > 0 ? EXTRA_GAP : 0) + denseHeight(id);
      if (tables.value[id].rows.length === 0 || next > CAP * DECK_STRETCH) continue;
      inlined.add(id);
      used = next;
    }
  }
  if (used > 0) {
    push({
      kind: 'overview',
      key: 'overview',
      section: SECTION.request,
      title: '의뢰 개요',
      subtitle: '',
      rows: tables.value.overview.rows,
      text: m.description.mode === 'inline' ? d.description : '',
      extras: [...inlined],
    });
  } else {
    list.push(...tableSlides('overview', SECTION.request, '의뢰 개요'));
  }
  if (m.description.mode !== 'inline') textSlides(m.description, 'description', SECTION.request, '의뢰 내용');

  // AI 추가 질문 — 'AI 가 이해한 내용'은 첫 장 위에.
  const stored = qa.value;
  if (stored !== null && size('qa').length === stored.items.length) {
    const lead = stored.understood === '' ? 0 : one('qa-lead') + LEAD_GAP;
    const head = { kind: 'qa' as const, section: SECTION.request, subtitle: '자료를 읽고 더 여쭌 질문과 주신 답변입니다.' };
    const chunks = stored.items.length === 0 ? [[]] : balanceDeckChunks(size('qa'), CAP_SUB, QA_GAP, { lead });
    chunks.forEach((chunk, i) => {
      push({ ...head, key: `qa${String(i)}`, title: numbered('AI 추가 질문', i, chunks.length), understood: i === 0 ? stored.understood : '', items: pick(stored.items, chunk) });
    });
  }

  // 세부 질문 답변
  if (tables.value.brief.rows.length > 0 && !inlined.has('brief')) list.push(...tableSlides('brief', SECTION.request, '세부 질문 답변'));

  // AI 사전 검토서 — 요약 → 구성도 → 분야별 분석 → 일정 → 확인 사항
  const r = review.value;
  const reviewHead = { section: SECTION.review, subtitle: '' };
  if (r !== null) {
    push({ kind: 'summary', key: 'summary', ...reviewHead, title: 'AI 사전 검토 요약', comment: m.comment.mode === 'inline' ? comment.value : '' });
  }
  if (diagram.value !== null) {
    const figures = diagramDoc.value?.figures ?? [];
    if (figures.length === 0) push({ kind: 'diagram', key: 'diagram', ...reviewHead, title: '시스템 구성도', figure: null, name: '', index: 0, count: 1 });
    figures.forEach((figure, index) => {
      push({ kind: 'diagram', key: `diagram${String(index)}`, ...reviewHead, title: '시스템 구성도', figure, name: figureName(index, figures.length), index, count: figures.length });
    });
  }
  // 개발 분석 — 분야를 단에 쌓는다. 한 단에 안 드는 분야는 혼자 한 장.
  packDeckColumns(size('area'), CAP, AREA_GAP).forEach((p, i) => {
    if (p.kind === 'solo') {
      const area = areas.value[p.index];
      if (area !== undefined) push({ kind: 'area-solo', key: `area${String(i)}`, ...reviewHead, title: `개발 분석: ${area.label}`, area });
      return;
    }
    const columns = p.columns.map((c) => pick(areas.value, c));
    push({ kind: 'area-columns', key: `area${String(i)}`, ...reviewHead, title: `개발 분석: ${joinLabels(columns.flat().map((a) => a.label))}`, columns });
  });
  if (schedule.value !== null) list.push(...tableSlides('schedule', SECTION.review, '예상 개발 일정', { tail: one('schedule-tail') + TAIL_GAP }));
  // 확인이 필요한 사항 — 장 수는 최소, 장마다 고르게.
  balanceDeckChunks(size('question'), CAP_SUB, QUESTION_GAP).forEach((chunk, i) => {
    const items = pick(questions.value, chunk);
    push({
      kind: 'questions',
      key: `questions${String(i)}`,
      section: SECTION.review,
      title: `확인이 필요한 사항: ${joinLabels(items.map((q) => q.areaLabel))}`,
      subtitle: '아직 정해지지 않아 상담에서 함께 확정할 항목입니다. 확인된 내용은 답변 칸에 적었습니다.',
      items,
    });
  });
  if (m.comment.mode !== 'inline') textSlides(m.comment, 'comment', SECTION.review, '담당자 의견');

  // 진행 현황 · 프로젝트 문서
  // 프로젝트 문서는 진행 현황 마지막 장의 업무 표 아래에 자리가 있으면 거기 이어 붙인다. 고르게 나눈 마지막 장에 자리가 없으면
  // 업무 행을 앞 장부터 가득 채워(fill) 자리를 만들어 본다 — 그래도 안 되면 문서는 제 장을 갖는다.
  if (started.value) {
    const lead = one('progress-lead') + LEAD_GAP;
    const hasDocs = tables.value.docs.rows.length > 0;
    const docsHeight = AFTER_GAP + AFTER_HEAD + headOf('docs') + 2 + sum(size('docs:wide'));
    const roomFor = (slides: readonly TableSlide[]): boolean => (slides[slides.length - 1]?.height ?? CAP) + docsHeight <= CAP * DECK_STRETCH;
    let taskSlides = tableSlides('tasks', SECTION.progress, '진행 현황', { lead });
    if (hasDocs && !roomFor(taskSlides)) {
      const filled = tableSlides('tasks', SECTION.progress, '진행 현황', { lead, fill: true });
      if (roomFor(filled)) taskSlides = filled;
    }
    const docsInline = hasDocs && roomFor(taskSlides);
    const last = taskSlides[taskSlides.length - 1];
    if (docsInline && last !== undefined) last.after = 'docs';
    list.push(...taskSlides);
    if (hasDocs && !docsInline) list.push(...tableSlides('docs', SECTION.progress, '프로젝트 문서'));
  }
  if (tables.value.files.rows.length > 0 && !inlined.has('files')) list.push(...tableSlides('files', SECTION.files, '첨부 자료'));
  return list;
});
// 분야 장이 가리키는 '확인이 필요한 사항' 첫 장의 쪽 번호.
const questionsPage = computed(() => {
  const i = slides.value.findIndex((s) => s.kind === 'questions');
  return i < 0 ? null : i + 1;
});

// ── 화면 · 인쇄 ───────────────────────────────────────────────────────────────
// 용지 = 장 크기 그대로(1280×720px = 13.333×7.5in), 여백 0 — 장이 제 여백을 갖는다. @page 는 문서 전역이라 들어올 때 붙이고 나갈 때 뗀다
// (견적서 인쇄는 A4 세로 그대로). 화면은 창 폭에 맞춰 장 묶음을 줄여 보인다(인쇄는 1 — style.css).
let pageStyle: HTMLStyleElement | null = null;
const screenZoom = ref(1);
function updateZoom(): void {
  screenZoom.value = Math.min(1, Math.max(0.3, (window.innerWidth - 48) / DECK.width));
}
onMounted(() => {
  pageStyle = document.createElement('style');
  pageStyle.textContent = `@page { size: ${String(DECK.width)}px ${String(DECK.height)}px; margin: 0; }`;
  document.head.appendChild(pageStyle);
  updateZoom();
  window.addEventListener('resize', updateZoom);
});
onBeforeUnmount(() => {
  pageStyle?.remove();
  window.removeEventListener('resize', updateZoom);
});

function goLogin(): void {
  window.location.assign(loginUrl(developPath(route.fullPath)));
}
function print(): void {
  window.print();
}
const px = (n: number): string => `${String(n)}px`;
</script>

<template>
  <main class="min-h-screen bg-paper py-8 print:min-h-0 print:bg-white print:py-0">
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
      <div class="print-hidden mx-auto mb-4 flex w-full max-w-[1280px] flex-wrap items-center gap-2.5 px-6">
        <RouterLink
          :to="`/requests/${String(detail.requestId)}`"
          class="h-10 rounded-lg border border-line-2 bg-white px-4 text-label font-bold leading-10 text-tx-2 transition hover:border-tx-3"
        >
          의뢰 상세로
        </RouterLink>
        <p class="text-label text-tx-3">16:9(13.33×7.5인치) 장으로 인쇄됩니다. 'PDF로 저장'을 고르시면 파일로 받으실 수 있습니다.</p>
        <button
          type="button"
          class="ml-auto h-10 rounded-lg bg-ink-950 px-5 text-label font-bold text-white transition hover:bg-brand-600"
          @click="print"
        >
          인쇄 / PDF 저장
        </button>
      </div>

      <!-- 높이 재는 자리 — 화면에도 종이에도 안 보인다. 덩어리를 장에 실릴 폭 그대로 그린다(본문 폭 · 한 단 폭). -->
      <div ref="measureEl" class="print-hidden pointer-events-none invisible absolute left-[-20000px] top-0 tracking-normal" aria-hidden="true">
        <div :style="{ width: px(DECK_BODY_WIDTH) }">
          <DeckTable v-for="id in TABLE_IDS" :key="id" :cols="tables[id].cols" :rows="tables[id].rows" :dense="tables[id].compact" :measure="`${id}:wide`" />
          <DeckQuestion v-for="q in questions" :key="q.no" :item="q" data-measure="question" />
          <template v-if="qa !== null">
            <p v-if="qa.understood !== ''" :class="QA_LEAD" data-measure="qa-lead"><b class="font-semibold">AI 가 이해한 내용</b> — {{ qa.understood }}</p>
            <DeckQa v-for="item in qa.items" :key="item.key" :item="item" data-measure="qa" />
          </template>
          <div v-if="review !== null" data-measure="summary">
            <DeckSummary :summary="review.summary" :requirements="review.requirements.map((f) => f.text)" :comment="comment" :checks="review.checks" :meta="reviewMeta" />
          </div>
          <p :class="TEXT_WIDE" data-measure="desc-wide">{{ description }}</p>
          <p v-if="comment !== ''" :class="TEXT_WIDE" data-measure="comment-wide">{{ comment }}</p>
          <DeckProgressLead v-if="started" :progress="detail.progress" data-measure="progress-lead" />
          <DeckScheduleTotals v-if="schedule !== null" :schedule="schedule" :wish-label="wishLabel" data-measure="schedule-tail" />
        </div>
        <div :style="{ width: px(DECK_COLUMN_WIDTH) }">
          <DeckTable v-for="id in HALVES" :key="id" :cols="tables[id].denseCols" :rows="tables[id].rows" dense :measure="`${id}:dense`" />
          <DeckAreaBlock v-for="a in areas" :key="a.key" :area="a" variant="column" data-measure="area" />
          <p :class="TEXT_DENSE" data-measure="desc-dense">{{ description }}</p>
          <p v-if="comment !== ''" :class="TEXT_DENSE" data-measure="comment-dense">{{ comment }}</p>
        </div>
      </div>

      <p v-if="slides.length === 0" class="mx-auto max-w-[720px] px-6 py-16 text-center text-body text-tx-3">{{ $t('common.loading') }}</p>

      <!-- 장 묶음 — 화면은 장을 띄워 쌓고, 인쇄는 장마다 한 쪽 -->
      <div v-else class="overflow-x-auto print:overflow-visible">
        <div class="develop-deck mx-auto flex w-[1280px] flex-col gap-[24px] tracking-normal" :style="{ zoom: screenZoom }" :data-slides="slides.length">
          <template v-for="(s, si) in slides" :key="s.key">
            <!-- 표지 -->
            <DeckSlide v-if="s.kind === 'cover'" :page="si + 1" :kind="s.kind" :footer="detail.title">
              <div class="flex flex-1 flex-col justify-center pb-[20px]">
                <h1 class="max-w-[1020px] font-bold leading-[1.22] [text-wrap:balance]" :class="coverTitleClass">{{ detail.title }}</h1>
                <p class="mt-[44px] text-[30px] font-medium leading-[1.3] text-brand-600" data-deck="doc-name">{{ docName }}</p>
                <p class="mt-[52px] flex items-baseline gap-[14px] text-[24px] leading-[1.3]">
                  <span class="text-tx-2">수신</span><b class="font-medium">{{ detail.contact.company ?? detail.contact.name }}</b>
                </p>
                <p class="mt-[18px] flex flex-wrap gap-x-[30px] gap-y-[4px] text-[17px] leading-[1.5] text-tx-2">
                  <span v-for="m in coverMeta" :key="m.label">{{ m.label }} <span class="ml-[4px] text-[#3b4558]">{{ m.value }}</span></span>
                </p>
              </div>
            </DeckSlide>

            <!-- 의뢰 개요 — 왼쪽 조건 표, 오른쪽 의뢰 내용(둘 다 한 단에 들 때) -->
            <DeckSlide v-else-if="s.kind === 'overview'" :page="si + 1" :kind="s.kind" :footer="detail.title" :section="s.section" :title="s.title">
              <div class="grid grid-cols-2 items-start" :style="{ columnGap: px(DECK.colGap) }">
                <DeckTable :cols="tables.overview.denseCols" :rows="s.rows" dense data-deck-table="overview" />
                <div class="flex flex-col" :style="{ rowGap: px(EXTRA_GAP) }">
                  <div v-if="s.text !== ''">
                    <h3 class="text-[22px] font-bold leading-[29px] text-brand-600">의뢰 내용</h3>
                    <p class="mt-[12px]" :class="TEXT_DENSE" data-deck="text">{{ s.text }}</p>
                  </div>
                  <DeckTable v-for="id in s.extras" :key="id" :cols="tables[id].denseCols" :rows="tables[id].rows" dense :data-deck-table="id" />
                </div>
              </div>
            </DeckSlide>

            <!-- 표 — 넓은 판 한 단 또는 촘촘한 판 두 단. 진행 현황은 위에 달성도 띠, 일정은 아래에 합계 띠 -->
            <DeckSlide v-else-if="s.kind === 'table'" :page="si + 1" :kind="s.table" :footer="detail.title" :section="s.section" :title="s.title">
              <DeckProgressLead v-if="s.lead" :progress="detail.progress" :style="{ marginBottom: px(LEAD_GAP) }" />
              <div v-if="s.dense" class="grid grid-cols-2 items-start" :style="{ columnGap: px(DECK.colGap) }">
                <DeckTable v-for="(rows, ci) in s.columns" :key="ci" :cols="tables[s.table].denseCols" :rows="rows" dense :data-deck-table="s.table" />
              </div>
              <template v-else>
                <DeckTable
                  v-if="(s.columns[0]?.length ?? 0) > 0"
                  :cols="tables[s.table].cols"
                  :rows="s.columns[0] ?? []"
                  :dense="tables[s.table].compact"
                  :data-deck-table="s.table"
                />
                <p v-else class="rounded-[10px] border border-dashed border-line-2 px-[20px] py-[26px] text-center text-[17px] text-tx-3">
                  담당자가 일정을 공유하면 여기에 표시됩니다.
                </p>
              </template>
              <DeckScheduleTotals v-if="s.tail && schedule !== null" :schedule="schedule" :wish-label="wishLabel" />
              <template v-if="s.after !== null">
                <h3 class="text-[22px] font-bold leading-[29px] text-brand-600" :style="{ marginTop: px(AFTER_GAP) }">프로젝트 문서</h3>
                <DeckTable class="mt-[10px]" :cols="tables[s.after].cols" :rows="tables[s.after].rows" :dense="tables[s.after].compact" :data-deck-table="s.after" />
              </template>
            </DeckSlide>

            <!-- 긴 글(의뢰 내용 · 담당자 의견) — 한 장에 들면 큰 글자 한 단, 아니면 두 단 -->
            <DeckSlide v-else-if="s.kind === 'text'" :page="si + 1" :kind="s.kind" :footer="detail.title" :section="s.section" :title="s.title">
              <p v-if="s.wide" :class="TEXT_WIDE" data-deck="text">{{ s.columns[0] }}</p>
              <div v-else class="grid grid-cols-2 items-start" :style="{ columnGap: px(DECK.colGap) }">
                <p v-for="(t, ti) in s.columns" :key="ti" :class="TEXT_DENSE" data-deck="text">{{ t }}</p>
              </div>
            </DeckSlide>

            <!-- AI 추가 질문 -->
            <DeckSlide v-else-if="s.kind === 'qa'" :page="si + 1" :kind="s.kind" :footer="detail.title" :section="s.section" :title="s.title" :subtitle="s.subtitle">
              <p v-if="s.understood !== ''" :class="QA_LEAD" :style="{ marginBottom: px(LEAD_GAP) }"><b class="font-semibold">AI 가 이해한 내용</b> — {{ s.understood }}</p>
              <div v-if="s.items.length > 0" class="flex flex-col" :style="{ rowGap: px(QA_GAP) }">
                <DeckQa v-for="item in s.items" :key="item.key" :item="item" />
              </div>
              <p v-else class="text-[17px] leading-[1.6] text-tx-3">자료가 충분해 추가 질문이 없었습니다.</p>
            </DeckSlide>

            <!-- AI 사전 검토 요약 -->
            <DeckSlide v-else-if="s.kind === 'summary' && review !== null" :page="si + 1" :kind="s.kind" :footer="detail.title" :section="s.section" :title="s.title">
              <DeckSummary :summary="review.summary" :requirements="review.requirements.map((f) => f.text)" :comment="s.comment" :checks="review.checks" :meta="reviewMeta" />
            </DeckSlide>

            <!-- 시스템 구성도 — 도면만(앞뒤 글은 싣지 않는다) -->
            <DeckSlide v-else-if="s.kind === 'diagram'" :page="si + 1" :kind="s.kind" :footer="detail.title" :section="s.section" :title="s.title" layout="side">
              <template #aside>
                <p v-if="s.name !== ''" class="text-[17px] font-bold leading-[1.4] text-brand-600">
                  {{ s.name }}<span v-if="s.count > 1" class="ml-[8px] text-[13px] font-medium tabular-nums text-tx-3">{{ s.index + 1 }} / {{ s.count }}</span>
                </p>
                <p v-if="s.figure !== null && s.figure.caption !== ''" class="mt-[12px] line-clamp-[12] text-[15px] leading-[1.7] text-[#3b4558]">{{ s.figure.caption }}</p>
                <p class="mt-auto text-[12px] leading-[1.6] text-tx-3">{{ diagramNote }}</p>
              </template>
              <img v-if="s.figure !== null" :src="s.figure.img" :alt="`시스템 구성도 ${String(s.index + 1)}`" class="block h-full w-full object-contain" data-deck="diagram">
              <iframe v-else sandbox="" :srcdoc="diagramRaw" title="시스템 구성도" class="block h-full w-full border-0" data-deck="diagram" />
            </DeckSlide>

            <!-- 개발 분석 — 분야 하나가 한 장 -->
            <DeckSlide v-else-if="s.kind === 'area-solo'" :page="si + 1" kind="area" :footer="detail.title" :section="s.section" :title="s.title">
              <DeckAreaBlock :area="s.area" variant="solo" :questions-page="questionsPage" />
            </DeckSlide>

            <!-- 개발 분석 — 분야 여럿을 두 단에 -->
            <DeckSlide v-else-if="s.kind === 'area-columns'" :page="si + 1" kind="area" :footer="detail.title" :section="s.section" :title="s.title">
              <div class="grid grid-cols-2 items-start" :style="{ columnGap: px(DECK.colGap) }">
                <div v-for="(col, ci) in s.columns" :key="ci" class="flex flex-col" :style="{ rowGap: px(AREA_GAP) }">
                  <DeckAreaBlock v-for="a in col" :key="a.key" :area="a" variant="column" />
                </div>
              </div>
            </DeckSlide>

            <!-- 확인이 필요한 사항 -->
            <DeckSlide v-else-if="s.kind === 'questions'" :page="si + 1" :kind="s.kind" :footer="detail.title" :section="s.section" :title="s.title" :subtitle="s.subtitle">
              <div class="flex flex-1 flex-col" :style="{ rowGap: px(QUESTION_GAP) }">
                <DeckQuestion v-for="q in s.items" :key="q.no" :item="q" />
              </div>
            </DeckSlide>
          </template>
        </div>
      </div>
    </template>
  </main>
</template>
