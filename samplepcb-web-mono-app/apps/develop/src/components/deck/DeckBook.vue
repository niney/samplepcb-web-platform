<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { DEV_DIAGRAM_DISCLAIMER, developWishLabel } from '@sp/api-contract';
import type { DevelopQuoteViewType, DevelopRequestDetailType, DevelopRequestStatusType } from '@sp/api-contract';
import { parseDiagramDoc } from '@sp/ui';
import type { DiagramFigure, DiagramSection } from '@sp/ui';
import { DECK_STRETCH, balanceDeckChunks, packDeckColumns } from '@sp/utils';
import { COMPANY } from '../../lib/company';
import {
  DECK_SECTION,
  buildBriefTable,
  buildDeckAreas,
  buildDeckQa,
  buildDeckQuestions,
  buildDocTable,
  buildFileTable,
  buildOverviewTable,
  buildQuoteItemsTable,
  buildQuoteMilestoneTable,
  buildQuoteSubtitle,
  buildQuoteTermsTable,
  buildScheduleTable,
  buildTaskTable,
  joinLabels,
  quoteTag,
} from '../../lib/deck-content';
import type { DeckArea, DeckQa as DeckQaItem, DeckQuestion as DeckQuestionItem, DeckRow, DeckTableDef } from '../../lib/deck-content';
import { DECK, DECK_BODY_WIDTH, DECK_COLUMN_WIDTH, DECK_TABLE_HEAD, deckBodyHeight } from '../../lib/deck-layout';
import { splitTextToFit } from '../../lib/deck-text';
import { dateDotFull, dateTimeKst, won } from '../../lib/format';
import DeckAreaBlock from './DeckAreaBlock.vue';
import DeckProgressLead from './DeckProgressLead.vue';
import DeckQa from './DeckQa.vue';
import DeckQuestion from './DeckQuestion.vue';
import DeckQuoteTotals from './DeckQuoteTotals.vue';
import DeckScheduleTotals from './DeckScheduleTotals.vue';
import DeckSlide from './DeckSlide.vue';
import DeckSummary from './DeckSummary.vue';
import DeckTable from './DeckTable.vue';

// 의뢰 한 건을 16:9 장(슬라이드) 묶음으로 — 내용 만들기 · 높이 재기 · 배분 · 장 그리기를 한곳에서 한다(docs/DEVELOP_FLOW.md §7.2.10).
// 쓰는 곳이 둘이다:
//  · print = 출력물(RequestPrint) — 표지부터 모든 장을 쌓아 그린다. 인쇄는 장마다 한 쪽.
//  · stage = 의뢰 상세의 탭 안(DeckStage) — 한 묶음(section)의 장을 한 번에 하나만(page). 상표 줄 없이, 꼬리 자리는 넘김 줄(foot 슬롯).
//    도면은 누르면 크게 보고, 구성도 설명(도면 앞뒤 글)은 왼쪽 단 버튼으로 옆 판에서 본다(기본 닫힘 — 출력물엔 싣지 않는다).
//  · flow = 의뢰 상세의 좁은 화면(모바일) — 같은 묶음의 같은 덩어리를 고정 틀 없이 세로로 쌓는다. 2단은 1단으로 접히고(태블릿 폭부터
//    다시 2단), 열이 많은 표는 가로로 민다. 구성도 설명은 그 자리에서 펼친다(기본 접힘).
// 장을 나누는 계획(어느 덩어리가 어느 장에 드는가)은 세 모드가 같다 — 화면과 출력물이 같은 묶음으로 읽힌다.
// **장이 먼저**다: 장마다 주제 하나 · 같은 틀(DeckSlide) · 본문은 그 장에 맞게 따로 그린다 — 한 화면에 딱 담기고, 넘겨 볼 때 틀이 이어진다.
// 넘치는 내용은 덩어리 높이를 숨은 자리에서 재어 장에 배분한다(@sp/utils deck-pack): 분야는 단에 쌓고(큰 분야는 혼자 한 장),
// 표는 행 단위로 · 문항은 장 수를 최소로 하되 고르게 나누고, 긴 글(의뢰 내용 · 담당자 의견)은 줄 경계에서 단으로 흘린다(lib/deck-text).
// 그래도 넘치는 장은 글자를 줄여 담는다(DeckSlide).
// 순서: 표지 → 의뢰 개요(· 의뢰 내용) → AI 추가 질문 → 세부 질문 답변 → 검토 요약 → 시스템 구성도 → 개발 분석 → 예상 개발 일정 →
// 확인이 필요한 사항 → 담당자 의견(길 때만) → 진행 현황 · 프로젝트 문서(착수 뒤) → 첨부 자료. 내용이 없는 장은 만들지 않는다.
// 견적서 · 진행 · 문의는 출력물에 싣지 않는다(2026-11-06 결정 — 견적서는 견적서 인쇄 · PDF 가 따로 있고, 진행 기록은 화면에서 본다).
// 견적서는 의뢰 상세의 견적서 탭에서만 장으로 본다(stage · flow, 2026-11-13 §7.2.12): 견적마다 요약 장 → 산출 내역. 수락 · 결제는
// 장에 넣지 않는다 — 장 아래 판(QuoteActions)이 맡고, 어느 견적의 장인지는 shown 으로(세로 흐름은 after 슬롯으로) 알린다.
const props = withDefaults(
  defineProps<{
    detail: DevelopRequestDetailType;
    mode?: 'print' | 'stage' | 'flow';
    section?: string; // stage · flow — 이 묶음의 장만(DECK_SECTION 값)
    page?: number; // stage — 묶음 안에서 지금 장(0부터)
    zoom?: number; // print — 화면에서 장 묶음을 창 폭에 맞춰 줄이는 비율
    // 프로젝트 문서 표를 싣는가 — 의뢰 상세는 같은 탭 아래에 문서 목록(본문 · 회신)이 따로 있어 뺀다.
    withDocs?: boolean;
    // 확인이 필요한 사항에 고객이 답할 수 있는가(의뢰 상세, §7.2.13) — 답변 칸에 '답변하기 / 고치기' 단추를 세운다(출력물엔 없다).
    answerable?: boolean;
  }>(),
  { mode: 'print', section: '', page: 0, zoom: 1, withDocs: true, answerable: false },
);
const emit = defineEmits<{
  planned: [{ count: number; titles: string[] }];
  shown: [{ quoteId: number | null }]; // stage — 지금 장이 어느 견적의 것인가(견적 장이 아니면 null)
  jump: []; // stage — 견적 요약 장의 '아래에서 수락 · 결제' 단추
  answer: [qid: string]; // 확인 사항 답변 칸의 단추 — 부모가 답변 판을 연다
}>();

// ── 표지 ──────────────────────────────────────────────────────────────────────
// 문서 이름 — 견적 수락 전은 제안서, 수락 뒤(착수금 대기 포함)는 진행 보고서.
const REPORT_STATUSES: readonly DevelopRequestStatusType[] = ['accepted', 'in_progress', 'delivered', 'completed'];
const BEFORE_START: readonly DevelopRequestStatusType[] = ['received', 'reviewing', 'quoted', 'accepted'];
const docName = computed(() => (REPORT_STATUSES.includes(props.detail.status) ? '개발 진행 보고서' : '제품 개발 제안서'));
// 제목 글자 크기 — 길이에 맞춰 두세 줄 안에 들게(의뢰 제목은 200자까지).
const coverTitleClass = computed(() => {
  const n = props.detail.title.length;
  if (n <= 14) return 'text-[68px]';
  if (n <= 26) return 'text-[58px]';
  if (n <= 44) return 'text-[48px]';
  if (n <= 70) return 'text-[40px]';
  return 'text-[32px]';
});
// 연락처는 담당자 개인 번호가 아니라 회사 대표번호(개인 연락처를 내보내지 않는 규칙).
const coverMeta = computed(() => [
  { label: '의뢰 번호', value: `No. ${String(props.detail.requestId)}` },
  { label: '접수', value: dateDotFull(props.detail.createdAt) },
  { label: '담당', value: props.detail.assigneeName ?? '샘플피씨비 개발팀' },
  { label: '문의', value: COMPANY.tel },
]);

// ── 내용 ──────────────────────────────────────────────────────────────────────
const review = computed(() => props.detail.review);
const description = computed(() => props.detail.description);
const comment = computed(() => review.value?.adminComment ?? '');
const wishLabel = computed(() => developWishLabel(props.detail.wishDate, props.detail.wishNote));
const schedule = computed(() => {
  const s = review.value?.schedule ?? null;
  return s !== null && s.phases.length > 0 ? s : null;
});
// 진행 현황 — 착수 뒤, 끝난(취소 · 사양) 의뢰가 아닐 때만. 프로젝트 문서는 그 안에서만 싣는다.
const started = computed(() => props.detail.status !== 'cancelled' && props.detail.status !== 'declined' && !BEFORE_START.includes(props.detail.status));
// 정보 줄에 생성 모델명은 쓰지 않는다(사용자 결정 — 내부 공급사 이름을 고객에게 보이지 않는다).
const reviewMeta = computed(() => {
  const r = review.value;
  if (r === null) return '';
  const parts: string[] = [];
  if (r.meta.generatedAt !== '') parts.push(`${dateTimeKst(r.meta.generatedAt)} 생성`);
  const seq = props.detail.reviewPublicSeq;
  if (seq !== null) parts.push(`v${String(seq)} 공개본`);
  if (r.meta.attachmentFiles.length > 0) parts.push(`첨부 ${r.meta.attachmentFiles.join(', ')}`);
  return parts.join(' · ');
});

// 표 — 넓은 판(본문 폭)과 촘촘한 판(한 단 폭 — halves 인 표만)을 둘 다 재어 어느 쪽으로 실을지 정한다.
type TableId = 'overview' | 'brief' | 'schedule' | 'tasks' | 'docs' | 'files';
const EMPTY_TABLE: DeckTableDef = { cols: [], denseCols: [], rows: [], compact: false };
const tables = computed<Record<TableId, DeckTableDef>>(() => {
  const d = props.detail;
  return {
    overview: buildOverviewTable(d),
    brief: buildBriefTable(d),
    schedule: schedule.value === null ? EMPTY_TABLE : buildScheduleTable(schedule.value),
    tasks: started.value ? buildTaskTable(d.progress) : EMPTY_TABLE,
    docs: started.value && props.withDocs ? buildDocTable(d.documents) : EMPTY_TABLE,
    files: buildFileTable(d.files),
  };
});
const TABLE_IDS: readonly TableId[] = ['overview', 'brief', 'schedule', 'tasks', 'docs', 'files'];
const HALVES: readonly TableId[] = ['overview', 'brief', 'files'];

// 견적서 — 의뢰 상세에서만(출력물은 빈 목록). 최신 판이 앞이다: 지금 답할 견적이 첫 장에 온다.
interface QuoteDeck {
  quote: DevelopQuoteViewType;
  id: string; // 표 이름의 머리('q12' → 'q12:items' · 'q12:terms')
  items: DeckTableDef;
  terms: DeckTableDef;
  pay: DeckTableDef;
}
const quoteDecks = computed<QuoteDeck[]>(() =>
  props.mode === 'print'
    ? []
    : [...props.detail.quotes]
        .sort((a, b) => b.version - a.version)
        .map((quote) => ({
          quote,
          id: `q${String(quote.quoteId)}`,
          items: buildQuoteItemsTable(quote),
          terms: buildQuoteTermsTable(quote),
          pay: buildQuoteMilestoneTable(quote),
        })),
);
const quoteDecksFor = (quoteId: number | undefined): QuoteDeck[] => quoteDecks.value.filter((q) => q.quote.quoteId === quoteId);
// 이름으로 찾는 표 — 고정 표 여섯 + 견적마다의 표.
const allTables = computed(() => {
  const map = new Map<string, DeckTableDef>(Object.entries(tables.value));
  for (const q of quoteDecks.value) {
    map.set(`${q.id}:items`, q.items);
    map.set(`${q.id}:terms`, q.terms);
  }
  return map;
});
const tableOf = (id: string): DeckTableDef => allTables.value.get(id) ?? EMPTY_TABLE;
// 견적 이름은 길 수 있다(의뢰 제목 + 수식) — 요약 장 제목을 한 줄에 들게 글자를 줄인다(36 → 24px, 그래도 넘치면 말줄임).
// 폭은 어림으로 센다: 한글 · 전각 0.93em, 띄어쓰기 0.3em, 그 밖 0.58em(굵은 글자라 4% 여유).
const fitTitleSize = (title: string): number => {
  let units = 0;
  for (const ch of title) units += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 0.93 : ch === ' ' ? 0.3 : 0.58;
  return Math.max(24, Math.min(36, Math.floor((DECK_BODY_WIDTH * 0.96) / Math.max(1, units))));
};
// 견적 요약 장의 안내 — 답하거나 결제할 것이 있으면 장 아래 판으로 건너가는 단추를 둔다(넘겨 볼 때만: 판이 창 아래에 있다).
interface QuoteCta {
  text: string;
  label: string;
}
const quoteCta = (q: DevelopQuoteViewType): QuoteCta | null => {
  if (q.status === 'sent') return { text: '이 견적으로 진행하시려면 아래에서 수락해 주세요.', label: '수락 · 수정 요청' };
  const due = q.milestones.find((m) => m.payable);
  return due === undefined ? null : { text: `${due.title} ${won(due.amount)} — 지금 결제하실 수 있습니다.`, label: '결제하기' };
};

const areas = computed<DeckArea[]>(() => (review.value === null ? [] : buildDeckAreas(review.value)));
const questions = computed<DeckQuestionItem[]>(() => (review.value === null ? [] : buildDeckQuestions(review.value, props.detail.questionAnswers)));
// 답변 단추는 화면에서만 — 단추가 든 칸의 높이까지 그대로 재야 하므로 재는 자리에도 같은 값을 준다.
const canAnswer = computed(() => props.answerable && props.mode !== 'print');
const qa = computed(() => buildDeckQa(props.detail));

const diagram = computed(() => props.detail.diagram);
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
// 구성도 설명 — 도면 앞(요구사항 확인 요약) · 뒤(확정된 구성 · 미확정 항목 …) 글 묶음. 출력물엔 싣지 않고(사용자 결정 2026-11-12),
// 화면(stage)에서는 버튼으로 옆 판을 열어 본다(기본 닫힘 — 2026-11-05 '기본 접힘' 결정 그대로).
const diagramNotes = computed<DiagramSection[]>(() => (diagramDoc.value === null ? [] : [...diagramDoc.value.before, ...diagramDoc.value.after]));

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
  description: TextPlan; // 제 장에 실을 때의 계획(wide · columns)
  descriptionInline: boolean; // 의뢰 개요 오른쪽 단에 들 수 있는가
  comment: TextPlan;
}
const measureEl = ref<HTMLElement | null>(null);
const measured = ref<Measured | null>(null);
const sum = (list: readonly number[]): number => list.reduce((a, b) => a + b, 0);
let measureRun = 0;
watch(
  () => props.detail,
  async (d) => {
    const run = (measureRun += 1);
    measured.value = null;
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
    // 의뢰 내용 — 조건 표와 글이 저마다 한 단에 들면 의뢰 개요 한 장에 같이 실을 수 있다(실제로 그렇게 할지는 장 수를 보고 정한다).
    const overviewFits = DECK_TABLE_HEAD.dense + sum(sizes['overview:dense'] ?? []) + 2 <= CAP * DECK_STRETCH;
    // 담당자 의견 — 검토 요약 장에 같이 들면 거기에, 아니면 뒤쪽 장으로.
    const commentText = d.review?.adminComment ?? '';
    measured.value = {
      sizes,
      description: flow(d.description, 'desc'),
      descriptionInline: overviewFits && TEXT_HEAD + one('desc-dense') <= CAP * DECK_STRETCH,
      comment: commentText === '' || one('summary') <= CAP ? { mode: 'inline', chunks: [commentText] } : flow(commentText, 'comment'),
    };
  },
  { immediate: true },
);

// ── 장 목록 ───────────────────────────────────────────────────────────────────
interface SlideHead {
  key: string;
  section: string;
  title: string;
  subtitle: string;
  quoteId?: number; // 견적 장 — 어느 견적의 장인가
  titleSize?: number; // 긴 제목(견적 이름)을 한 줄에 들이려고 줄인 글자 크기
}
// 표 장 — after = 표 아래 이어 붙는 표(진행 현황 마지막 장의 프로젝트 문서), height = 실린 내용 높이(이어 붙일 자리가 있는지 본다).
interface TableSlide {
  kind: 'table';
  table: string; // 표 이름(tableOf)
  deckKind?: string; // 장 종류(data-deck-kind)가 표 이름과 다를 때(견적 표)
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
    | { kind: 'qa'; understood: string; columns: DeckQaItem[][] }
    | { kind: 'summary'; comment: string }
    | { kind: 'diagram'; figure: DiagramFigure | null; name: string; index: number; count: number }
    | { kind: 'area-solo'; area: DeckArea }
    | { kind: 'area-columns'; columns: DeckArea[][] }
    | { kind: 'questions'; items: DeckQuestionItem[] }
    | { kind: 'quote'; deck: QuoteDeck; termsInline: boolean; cta: QuoteCta | null }
  );
const pick = <T,>(list: readonly T[], indexes: readonly number[]): T[] => indexes.flatMap((i) => (list[i] === undefined ? [] : [list[i]]));
// 여러 장에 걸친 주제는 제목에 차례를 붙인다('세부 질문 답변 (2/3)').
const numbered = (title: string, i: number, n: number): string => (n > 1 ? `${title} (${String(i + 1)}/${String(n)})` : title);
const pairs = <T,>(list: readonly T[]): T[][] => list.flatMap((_, i) => (i % 2 === 0 ? [list.slice(i, i + 2)] : []));

const slides = computed<Slide[]>(() => {
  const d = props.detail;
  const m = measured.value;
  if (m === null) return [];
  const size = (key: string): number[] => m.sizes[key] ?? [];
  const one = (key: string): number => size(key)[0] ?? 0;
  // 잰 뒤 내용이 바뀌어 수가 안 맞으면 그리지 않는다(다시 잴 때까지).
  if (size('area').length !== areas.value.length || size('question').length !== questions.value.length) return [];
  if (TABLE_IDS.some((id) => size(`${id}:wide`).length !== tables.value[id].rows.length)) return [];
  if (quoteDecks.value.some((q) => size(`${q.id}:items:wide`).length !== q.items.rows.length || size(`${q.id}:terms:wide`).length !== q.terms.rows.length)) return [];

  const list: Slide[] = [];
  const push = (slide: Slide): void => {
    list.push(slide);
  };

  // 표 → 장. halves 인 표는 넓은 판 한 장에 다 들면 그대로, 아니면 촘촘한 판을 두 단씩. 나머지는 행 단위로 고르게.
  // 조금 넘치는 정도(DECK_STRETCH)면 나누지 않는다 — 그 장이 글자를 줄여 담는다. lead · tail = 첫 장 위 · 마지막 장 아래에
  // 붙는 덩어리 높이(달성도 띠 · 일정 합계 띠).
  const headOf = (id: string): number => (tableOf(id).compact ? DECK_TABLE_HEAD.dense : DECK_TABLE_HEAD.wide);
  const denseHeight = (id: string): number => DECK_TABLE_HEAD.dense + sum(size(`${id}:dense`)) + 2;
  const tableSlides = (id: string, section: string, title: string, extra: { lead?: number; tail?: number; fill?: boolean } = {}): (SlideHead & TableSlide)[] => {
    const rows = tableOf(id).rows;
    const wide = size(`${id}:wide`);
    const cap = CAP - headOf(id) - 2;
    const head = { section, subtitle: '', kind: 'table' as const, table: id, after: null };
    const total = sum(wide) + (extra.lead ?? 0) + (extra.tail ?? 0);
    if ((HALVES as readonly string[]).includes(id) && total > cap * DECK_STRETCH) {
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
  // 한 장을 혼자 쓰지 않게). 짜임은 둘 — ㉠ 의뢰 내용을 오른쪽 단에 싣고 남는 자리에 표 ㉡ 오른쪽 단은 표만, 의뢰 내용은 제 장 —
  // 가운데 장 수가 적은 쪽(같으면 ㉠: 조건 옆에 내용이 있는 편이 읽기 좋다). 조건 표가 한 단에 안 들면 표만 넓게 싣고 나머지는 제 장.
  const smallTables = (['brief', 'files'] as const).filter((id) => tables.value[id].rows.length > 0);
  const stack = (start: number): TableId[] => {
    const ids: TableId[] = [];
    let used = start;
    for (const id of smallTables) {
      const next = used + (used > 0 ? EXTRA_GAP : 0) + denseHeight(id);
      if (next > CAP * DECK_STRETCH) continue;
      ids.push(id);
      used = next;
    }
    return ids;
  };
  const overviewFits = denseHeight('overview') <= CAP * DECK_STRETCH;
  const textSlideCount = m.description.mode === 'wide' ? 1 : Math.ceil(m.description.chunks.length / 2);
  const besideText = stack(TEXT_HEAD + one('desc-dense'));
  const tablesOnly = stack(0);
  const textInline = overviewFits && m.descriptionInline && smallTables.length - besideText.length <= textSlideCount + smallTables.length - tablesOnly.length;
  const inlined = new Set<TableId>(overviewFits ? (textInline ? besideText : tablesOnly) : []);
  if (textInline || inlined.size > 0) {
    push({
      kind: 'overview',
      key: 'overview',
      section: DECK_SECTION.request,
      title: '의뢰 개요',
      subtitle: '',
      rows: tables.value.overview.rows,
      text: textInline ? d.description : '',
      extras: [...inlined],
    });
  } else {
    list.push(...tableSlides('overview', DECK_SECTION.request, '의뢰 개요'));
  }
  if (!textInline) textSlides(m.description, 'description', DECK_SECTION.request, '의뢰 내용');

  // AI 추가 질문 — 'AI 가 이해한 내용'은 첫 장 위에. 한 단으로 한 장에 들면 그대로, 아니면 두 단씩(짧은 문답이라 두 단이 잘 찬다).
  const stored = qa.value;
  if (stored !== null && size('qa').length === stored.items.length) {
    const lead = stored.understood === '' ? 0 : one('qa-lead') + LEAD_GAP;
    const head = { kind: 'qa' as const, section: DECK_SECTION.request, subtitle: '자료를 읽고 더 여쭌 질문과 주신 답변입니다.' };
    const single = lead + sum(size('qa')) + Math.max(0, stored.items.length - 1) * QA_GAP;
    if (single <= CAP_SUB * DECK_STRETCH) {
      push({ ...head, key: 'qa0', title: 'AI 추가 질문', understood: stored.understood, columns: [stored.items] });
    } else {
      const groups = pairs(balanceDeckChunks(size('qa:dense'), CAP_SUB - lead, QA_GAP, { multipleOf: 2 }));
      groups.forEach((group, i) => {
        push({ ...head, key: `qa${String(i)}`, title: numbered('AI 추가 질문', i, groups.length), understood: i === 0 ? stored.understood : '', columns: group.map((c) => pick(stored.items, c)) });
      });
    }
  }

  // 세부 질문 답변
  if (tables.value.brief.rows.length > 0 && !inlined.has('brief')) list.push(...tableSlides('brief', DECK_SECTION.request, '세부 질문 답변'));

  // AI 사전 검토서 — 요약 → 구성도 → 분야별 분석 → 일정 → 확인 사항
  const r = review.value;
  const reviewHead = { section: DECK_SECTION.review, subtitle: '' };
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
  if (schedule.value !== null) list.push(...tableSlides('schedule', DECK_SECTION.review, '예상 개발 일정', { tail: one('schedule-tail') + TAIL_GAP }));
  // 확인이 필요한 사항 — 장 수는 최소, 장마다 고르게.
  balanceDeckChunks(size('question'), CAP_SUB, QUESTION_GAP).forEach((chunk, i) => {
    const items = pick(questions.value, chunk);
    push({
      kind: 'questions',
      key: `questions${String(i)}`,
      section: DECK_SECTION.review,
      title: `확인이 필요한 사항: ${joinLabels(items.map((q) => q.areaLabel))}`,
      subtitle: '아직 정해지지 않아 상담에서 함께 확정할 항목입니다. 확인된 내용은 답변 칸에 적었습니다.',
      items,
    });
  });
  if (m.comment.mode !== 'inline') textSlides(m.comment, 'comment', DECK_SECTION.review, '담당자 의견');

  // 진행 현황 · 프로젝트 문서
  // 프로젝트 문서는 진행 현황 마지막 장의 업무 표 아래에 자리가 있으면 거기 이어 붙인다. 고르게 나눈 마지막 장에 자리가 없으면
  // 업무 행을 앞 장부터 가득 채워(fill) 자리를 만들어 본다 — 그래도 안 되면 문서는 제 장을 갖는다.
  if (started.value) {
    const lead = one('progress-lead') + LEAD_GAP;
    const hasDocs = tables.value.docs.rows.length > 0;
    const docsHeight = AFTER_GAP + AFTER_HEAD + headOf('docs') + 2 + sum(size('docs:wide'));
    const roomFor = (candidates: readonly TableSlide[]): boolean => (candidates[candidates.length - 1]?.height ?? CAP) + docsHeight <= CAP * DECK_STRETCH;
    let taskSlides = tableSlides('tasks', DECK_SECTION.progress, '진행 현황', { lead });
    if (hasDocs && !roomFor(taskSlides)) {
      const filled = tableSlides('tasks', DECK_SECTION.progress, '진행 현황', { lead, fill: true });
      if (roomFor(filled)) taskSlides = filled;
    }
    const docsInline = hasDocs && roomFor(taskSlides);
    const last = taskSlides[taskSlides.length - 1];
    if (docsInline && last !== undefined) last.after = 'docs';
    list.push(...taskSlides);
    if (hasDocs && !docsInline) list.push(...tableSlides('docs', DECK_SECTION.progress, '프로젝트 문서'));
  }
  if (tables.value.files.rows.length > 0 && !inlined.has('files')) list.push(...tableSlides('files', DECK_SECTION.files, '첨부 자료'));

  // 견적서(의뢰 상세만) — 견적마다: 요약 장(왼쪽 금액 · 결제 조건, 오른쪽 견적 조건) → 산출 내역 표(마지막 장 아래에 합계 띠).
  // 견적 조건이 한 단에 안 들면 제 장을 갖고, 요약 장 오른쪽은 결제 조건이 쓴다.
  for (const q of quoteDecks.value) {
    const quoteId = q.quote.quoteId;
    const termsInline = q.terms.rows.length === 0 || denseHeight(`${q.id}:terms`) <= CAP_SUB * DECK_STRETCH;
    push({
      kind: 'quote',
      key: `${q.id}:summary`,
      section: DECK_SECTION.quotes,
      quoteId,
      title: q.quote.title,
      titleSize: fitTitleSize(q.quote.title),
      subtitle: buildQuoteSubtitle(q.quote),
      deck: q,
      termsInline,
      cta: quoteCta(q.quote),
    });
    const own = (name: string, title: string, extra: { tail?: number } = {}): (SlideHead & TableSlide)[] =>
      tableSlides(`${q.id}:${name}`, DECK_SECTION.quotes, `${title}: ${quoteTag(q.quote)}`, extra).map((s) => ({ ...s, quoteId, deckKind: `quote-${name}` }));
    if (q.items.rows.length > 0) list.push(...own('items', '산출 내역', { tail: one(`${q.id}:totals`) + TAIL_GAP }));
    if (!termsInline) list.push(...own('terms', '견적 조건'));
  }
  return list;
});

// 그려 둔 장 — 내용이 바뀌면 다시 재는 한 틱 동안 장 목록이 비는데(slides = []), 그 사이에는 앞서 그린 장을 그대로 둔다.
// 장을 걷었다 다시 세우면 장 뒤 · 아래에 붙은 판(견적 수락 · 수정 요청 입력)이 같이 비워진다 — 쓰던 글이 백그라운드 갱신에 지워지면 안 된다.
const settled = shallowRef<Slide[]>([]);
watch(
  slides,
  (list) => {
    if (list.length > 0) settled.value = list;
  },
  { immediate: true },
);
// 이번에 다루는 장 — print 는 전부, stage · flow 는 한 묶음. 쪽 번호는 그 안에서 센다.
const scoped = computed(() => (props.mode === 'print' ? settled.value : settled.value.filter((s) => s.section === props.section)));
const visible = computed(() => {
  const all = scoped.value.map((slide, i) => ({ slide, no: i + 1 }));
  if (props.mode !== 'stage') return all;
  const current = all[Math.min(Math.max(0, props.page), all.length - 1)];
  return current === undefined ? [] : [current];
});
watch(
  scoped,
  (list) => {
    emit('planned', { count: list.length, titles: list.map((s) => s.title) });
  },
  { immediate: true },
);
// 넘겨 보는 중 — 지금 장이 어느 견적의 것인지 알린다(장 아래 수락 · 결제 판이 그 견적을 따라간다).
watch(
  () => (props.mode === 'stage' && visible.value.length > 0 ? (visible.value[0]?.slide.quoteId ?? null) : undefined),
  (quoteId) => {
    if (quoteId !== undefined) emit('shown', { quoteId });
  },
  { immediate: true },
);
// 분야 장이 가리키는 '확인이 필요한 사항' 첫 장의 쪽 번호.
const questionsPage = computed(() => {
  const i = scoped.value.findIndex((s) => s.kind === 'questions');
  return i < 0 ? null : i + 1;
});

// ── 화면(stage · flow)에서만 — 도면 크게 보기 · 구성도 설명(stage 는 옆 판, flow 는 그 자리에서 펼침) ─────────
const interactive = computed(() => props.mode !== 'print');
const flow = computed(() => props.mode === 'flow');
const variant = computed(() => props.mode);
// 두 단 배치 — 세로 흐름에서는 한 단으로 접고 태블릿 폭부터 두 단.
const twoCols = computed(() => (flow.value ? 'grid-cols-1 gap-y-[22px] md:grid-cols-2' : 'grid-cols-2'));
const textClass = computed(() => (flow.value ? TEXT_DENSE : TEXT_WIDE));
// 세로 흐름의 넓은 표 — 열이 많은 표(compact)는 폭을 지키고 가로로 밀고, 나머지는 촘촘한 판의 열(좁은 고정 폭)로 접는다.
const flowScroll = (def: DeckTableDef): boolean => flow.value && def.compact;
const wideCols = (def: DeckTableDef): DeckTableDef['cols'] => (flow.value && !flowScroll(def) ? def.denseCols : def.cols);
const zoomFigure = ref<DiagramFigure | null>(null);
const notesOpen = ref(false);
function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  zoomFigure.value = null;
  notesOpen.value = false;
}
watch([zoomFigure, notesOpen], ([figure, open]) => {
  if (figure !== null || open) window.addEventListener('keydown', onKey);
  else window.removeEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
});

const px = (n: number): string => `${String(n)}px`;
</script>

<template>
  <!-- 높이 재는 자리 — 화면에도 종이에도 안 보인다. 덩어리를 장에 실릴 폭 그대로 그린다(본문 폭 · 한 단 폭).
       재는 동안에만 둔다(measured 가 차면 걷는다) — 같은 글이 문서에 두 벌 남으면 찾기 · 검증이 숨은 쪽까지 센다. -->
  <div
    v-if="measured === null"
    ref="measureEl"
    class="print-hidden pointer-events-none invisible absolute left-[-20000px] top-0 tracking-normal"
    aria-hidden="true"
  >
    <div :style="{ width: px(DECK_BODY_WIDTH) }">
      <DeckTable v-for="id in TABLE_IDS" :key="id" :cols="tables[id].cols" :rows="tables[id].rows" :dense="tables[id].compact" :measure="`${id}:wide`" />
      <DeckQuestion v-for="q in questions" :key="q.no" :item="q" :answerable="canAnswer" data-measure="question" />
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
      <template v-for="q in quoteDecks" :key="q.id">
        <DeckTable :cols="q.items.cols" :rows="q.items.rows" :measure="`${q.id}:items:wide`" />
        <DeckTable :cols="q.terms.cols" :rows="q.terms.rows" :measure="`${q.id}:terms:wide`" />
        <DeckQuoteTotals :quote="q.quote" variant="band" :data-measure="`${q.id}:totals`" />
      </template>
    </div>
    <div :style="{ width: px(DECK_COLUMN_WIDTH) }">
      <DeckTable v-for="id in HALVES" :key="id" :cols="tables[id].denseCols" :rows="tables[id].rows" dense :measure="`${id}:dense`" />
      <DeckAreaBlock v-for="a in areas" :key="a.key" :area="a" variant="column" data-measure="area" />
      <template v-if="qa !== null"><DeckQa v-for="item in qa.items" :key="item.key" :item="item" data-measure="qa:dense" /></template>
      <p :class="TEXT_DENSE" data-measure="desc-dense">{{ description }}</p>
      <p v-if="comment !== ''" :class="TEXT_DENSE" data-measure="comment-dense">{{ comment }}</p>
      <DeckTable v-for="q in quoteDecks" :key="q.id" :cols="q.terms.denseCols" :rows="q.terms.rows" dense :measure="`${q.id}:terms:dense`" />
    </div>
  </div>

  <p v-if="settled.length === 0" class="mx-auto max-w-[720px] px-6 py-16 text-center text-body text-tx-3">{{ $t('common.loading') }}</p>

  <!-- 장 묶음 — print: 화면은 장을 띄워 쌓고 인쇄는 장마다 한 쪽 / stage: 지금 장 하나 / flow: 판을 세로로 -->
  <div v-else :class="mode === 'print' ? 'overflow-x-auto print:overflow-visible' : ''">
    <div
      class="develop-deck tracking-normal"
      :class="mode === 'print' ? 'mx-auto flex w-[1280px] flex-col gap-[24px]' : mode === 'stage' ? 'w-[1280px]' : 'flex flex-col gap-[16px]'"
      :style="mode === 'print' ? { zoom } : undefined"
      :data-slides="scoped.length"
    >
      <template v-for="({ slide: s, no }, vi) in visible" :key="s.key">
        <!-- 표지 -->
        <DeckSlide v-if="s.kind === 'cover'" :page="no" :kind="s.kind" :footer="detail.title" :variant="variant">
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
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- 의뢰 개요 — 왼쪽 조건 표, 오른쪽 의뢰 내용(둘 다 한 단에 들 때) -->
        <DeckSlide v-else-if="s.kind === 'overview'" :page="no" :kind="s.kind" :footer="detail.title" :section="s.section" :title="s.title" :variant="variant">
          <div class="grid items-start" :class="twoCols" :style="{ columnGap: px(DECK.colGap) }">
            <DeckTable :cols="tables.overview.denseCols" :rows="s.rows" dense data-deck-table="overview" />
            <div class="flex flex-col" :style="{ rowGap: px(EXTRA_GAP) }">
              <div v-if="s.text !== ''">
                <h3 class="text-[22px] font-bold leading-[29px] text-brand-600">의뢰 내용</h3>
                <p class="mt-[12px]" :class="TEXT_DENSE" data-deck="text">{{ s.text }}</p>
              </div>
              <DeckTable v-for="id in s.extras" :key="id" :cols="tables[id].denseCols" :rows="tables[id].rows" dense :data-deck-table="id" />
            </div>
          </div>
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- 표 — 넓은 판 한 단 또는 촘촘한 판 두 단. 진행 현황은 위에 달성도 띠, 일정은 아래에 합계 띠 -->
        <DeckSlide
          v-else-if="s.kind === 'table'"
          :page="no"
          :kind="s.deckKind ?? s.table"
          :footer="detail.title"
          :section="s.section"
          :title="s.title"
          :variant="variant"
        >
          <DeckProgressLead v-if="s.lead && s.table === 'tasks'" :progress="detail.progress" :stack="flow" :style="{ marginBottom: px(LEAD_GAP) }" />
          <div v-if="s.dense" class="grid items-start" :class="twoCols" :style="{ columnGap: px(DECK.colGap) }">
            <DeckTable v-for="(rows, ci) in s.columns" :key="ci" :cols="tableOf(s.table).denseCols" :rows="rows" dense :data-deck-table="s.table" />
          </div>
          <template v-else>
            <DeckTable
              v-if="(s.columns[0]?.length ?? 0) > 0"
              :cols="wideCols(tableOf(s.table))"
              :rows="s.columns[0] ?? []"
              :dense="tableOf(s.table).compact"
              :scroll="flowScroll(tableOf(s.table))"
              :data-deck-table="s.deckKind ?? s.table"
            />
            <p v-else class="rounded-[10px] border border-dashed border-line-2 px-[20px] py-[26px] text-center text-[17px] text-tx-3">
              담당자가 일정을 공유하면 여기에 표시됩니다.
            </p>
          </template>
          <DeckScheduleTotals v-if="s.tail && s.table === 'schedule' && schedule !== null" :schedule="schedule" :wish-label="wishLabel" />
          <DeckQuoteTotals v-for="q in s.tail && s.deckKind === 'quote-items' ? quoteDecksFor(s.quoteId) : []" :key="q.id" :quote="q.quote" variant="band" />
          <template v-if="s.after !== null">
            <h3 class="text-[22px] font-bold leading-[29px] text-brand-600" :style="{ marginTop: px(AFTER_GAP) }">프로젝트 문서</h3>
            <DeckTable
              class="mt-[10px]"
              :cols="tables[s.after].cols"
              :rows="tables[s.after].rows"
              :dense="tables[s.after].compact"
              :scroll="flowScroll(tables[s.after])"
              :data-deck-table="s.after"
            />
          </template>
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- 긴 글(의뢰 내용 · 담당자 의견) — 한 장에 들면 큰 글자 한 단, 아니면 두 단 -->
        <DeckSlide v-else-if="s.kind === 'text'" :page="no" :kind="s.kind" :footer="detail.title" :section="s.section" :title="s.title" :variant="variant">
          <p v-if="s.wide" :class="textClass" data-deck="text">{{ s.columns[0] }}</p>
          <p v-else-if="flow" :class="TEXT_DENSE" data-deck="text">{{ s.columns.join('\n') }}</p>
          <div v-else class="grid items-start" :class="twoCols" :style="{ columnGap: px(DECK.colGap) }">
            <p v-for="(t, ti) in s.columns" :key="ti" :class="TEXT_DENSE" data-deck="text">{{ t }}</p>
          </div>
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- AI 추가 질문 -->
        <DeckSlide
          v-else-if="s.kind === 'qa'"
          :page="no"
          :kind="s.kind"
          :footer="detail.title"
          :section="s.section"
          :title="s.title"
          :subtitle="s.subtitle"
          :variant="variant"
        >
          <p v-if="s.understood !== ''" :class="QA_LEAD" :style="{ marginBottom: px(LEAD_GAP) }"><b class="font-semibold">AI 가 이해한 내용</b> — {{ s.understood }}</p>
          <div
            v-if="s.columns.some((c) => c.length > 0)"
            class="grid items-start"
            :class="s.columns.length > 1 ? twoCols : ''"
            :style="{ columnGap: px(DECK.colGap) }"
          >
            <div v-for="(col, ci) in s.columns" :key="ci" class="flex flex-col" :style="{ rowGap: px(QA_GAP) }">
              <DeckQa v-for="item in col" :key="item.key" :item="item" />
            </div>
          </div>
          <p v-else class="text-[17px] leading-[1.6] text-tx-3">자료가 충분해 추가 질문이 없었습니다.</p>
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- AI 사전 검토 요약 -->
        <DeckSlide
          v-else-if="s.kind === 'summary' && review !== null"
          :page="no"
          :kind="s.kind"
          :footer="detail.title"
          :section="s.section"
          :title="s.title"
          :variant="variant"
        >
          <DeckSummary
            :summary="review.summary"
            :requirements="review.requirements.map((f) => f.text)"
            :comment="s.comment"
            :checks="review.checks"
            :meta="reviewMeta"
            :stack="flow"
          />
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- 시스템 구성도 — 도면만. 화면에서는 도면을 누르면 크게 보고, 설명 글은 버튼으로 옆 판에서 본다 -->
        <DeckSlide
          v-else-if="s.kind === 'diagram'"
          :page="no"
          :kind="s.kind"
          :footer="detail.title"
          :section="s.section"
          :title="s.title"
          layout="side"
          :variant="variant"
        >
          <template #aside>
            <p v-if="s.name !== ''" class="text-[17px] font-bold leading-[1.4] text-brand-600">
              {{ s.name }}<span v-if="s.count > 1" class="ml-[8px] text-[13px] font-medium tabular-nums text-tx-3">{{ s.index + 1 }} / {{ s.count }}</span>
            </p>
            <p v-if="s.figure !== null && s.figure.caption !== ''" class="mt-[12px] line-clamp-[12] text-[15px] leading-[1.7] text-[#3b4558]">{{ s.figure.caption }}</p>
            <button
              v-if="interactive && diagramNotes.length > 0"
              type="button"
              class="mt-[16px] flex h-[38px] items-center gap-[8px] self-start rounded-[6px] border border-line-2 bg-white px-[14px] text-[14px] leading-[1.3] text-[#141e34] transition-colors hover:bg-brand-50"
              :aria-expanded="notesOpen"
              data-deck="notes-toggle"
              @click="notesOpen = flow ? !notesOpen : true"
            >
              {{ flow && notesOpen ? '구성도 설명 접기' : '구성도 설명 보기' }}<span class="text-tx-3">{{ diagramNotes.length }}개 항목</span>
            </button>
            <div v-if="flow && notesOpen" class="mt-[14px] flex flex-col gap-[16px]" data-deck="notes">
              <div v-for="(n, ni) in diagramNotes" :key="ni" class="flex flex-col gap-[6px]">
                <p v-if="n.title !== ''" class="text-[15px] font-bold leading-[1.4] text-brand-600">{{ n.title }}</p>
                <ul class="flex list-disc flex-col gap-[4px] pl-[20px] text-[15px] leading-[1.7]">
                  <li v-for="(t, ti) in n.items" :key="ti">{{ t }}</li>
                </ul>
              </div>
            </div>
            <p class="text-[12px] leading-[1.6] text-tx-3" :class="flow ? 'mt-[12px]' : 'mt-auto'">{{ diagramNote }}</p>
          </template>
          <template v-if="s.figure !== null">
            <button
              v-if="interactive"
              type="button"
              class="block w-full cursor-zoom-in"
              :class="flow ? '' : 'h-full'"
              aria-label="구성도 크게 보기"
              @click="zoomFigure = s.figure"
            >
              <img
                :src="s.figure.img"
                :alt="`시스템 구성도 ${String(s.index + 1)}`"
                class="block w-full"
                :class="flow ? 'h-auto' : 'h-full object-contain'"
                data-deck="diagram"
              >
            </button>
            <img v-else :src="s.figure.img" :alt="`시스템 구성도 ${String(s.index + 1)}`" class="block h-full w-full object-contain" data-deck="diagram">
          </template>
          <iframe v-else sandbox="" :srcdoc="diagramRaw" title="시스템 구성도" class="block w-full border-0" :class="flow ? 'h-[420px]' : 'h-full'" data-deck="diagram" />
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- 개발 분석 — 분야 하나가 한 장 -->
        <DeckSlide v-else-if="s.kind === 'area-solo'" :page="no" kind="area" :footer="detail.title" :section="s.section" :title="s.title" :variant="variant">
          <DeckAreaBlock :area="s.area" variant="solo" :questions-page="questionsPage" :stack="flow" />
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- 개발 분석 — 분야 여럿을 두 단에 -->
        <DeckSlide v-else-if="s.kind === 'area-columns'" :page="no" kind="area" :footer="detail.title" :section="s.section" :title="s.title" :variant="variant">
          <div class="grid items-start" :class="twoCols" :style="{ columnGap: px(DECK.colGap) }">
            <div v-for="(col, ci) in s.columns" :key="ci" class="flex flex-col" :style="{ rowGap: px(AREA_GAP) }">
              <DeckAreaBlock v-for="a in col" :key="a.key" :area="a" variant="column" />
            </div>
          </div>
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- 확인이 필요한 사항 -->
        <DeckSlide
          v-else-if="s.kind === 'questions'"
          :page="no"
          :kind="s.kind"
          :footer="detail.title"
          :section="s.section"
          :title="s.title"
          :subtitle="s.subtitle"
          :variant="variant"
        >
          <div class="flex flex-1 flex-col" :style="{ rowGap: px(QUESTION_GAP) }">
            <DeckQuestion v-for="q in s.items" :key="q.no" :item="q" :answerable="canAnswer" @answer="emit('answer', q.qid)" />
          </div>
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- 견적 요약 — 왼쪽: 금액 · (할 일 안내) · 결제 조건 / 오른쪽: 견적 조건. 조건이 길어 제 장으로 가면 오른쪽은 결제 조건 -->
        <DeckSlide
          v-else-if="s.kind === 'quote'"
          :page="no"
          :kind="s.kind"
          :footer="detail.title"
          :section="s.section"
          :title="s.title"
          :title-size="s.titleSize ?? 36"
          :subtitle="s.subtitle"
          :variant="variant"
        >
          <div class="grid items-start" :class="twoCols" :style="{ columnGap: px(DECK.colGap) }">
            <div class="flex flex-col" :style="{ rowGap: px(EXTRA_GAP) }">
              <DeckQuoteTotals :quote="s.deck.quote" />
              <div v-if="mode === 'stage' && s.cta !== null" class="flex items-center justify-between gap-[16px] rounded-[10px] bg-brand-50 px-[20px] py-[12px]">
                <p class="min-w-0 text-[16px] leading-[1.5]">{{ s.cta.text }}</p>
                <button
                  type="button"
                  class="flex h-[38px] shrink-0 items-center gap-[6px] rounded-[6px] bg-[#141e34] px-[14px] text-[14px] font-medium leading-[1.3] text-white transition-opacity hover:opacity-85"
                  data-deck="quote-jump"
                  @click="emit('jump')"
                >
                  {{ s.cta.label }}<span aria-hidden="true">↓</span>
                </button>
              </div>
              <DeckTable v-if="s.termsInline && s.deck.pay.rows.length > 0" :cols="s.deck.pay.denseCols" :rows="s.deck.pay.rows" dense data-deck-table="quote-pay" />
            </div>
            <DeckTable v-if="s.termsInline && s.deck.terms.rows.length > 0" :cols="s.deck.terms.denseCols" :rows="s.deck.terms.rows" dense data-deck-table="quote-terms" />
            <DeckTable v-else-if="!s.termsInline && s.deck.pay.rows.length > 0" :cols="s.deck.pay.denseCols" :rows="s.deck.pay.rows" dense data-deck-table="quote-pay" />
          </div>
          <template v-if="mode === 'stage'" #foot><slot name="foot" /></template>
        </DeckSlide>

        <!-- 세로 흐름 — 견적 한 건의 판이 끝난 자리(수락 · 결제 판이 여기 온다) -->
        <slot v-if="flow && s.quoteId !== undefined && visible[vi + 1]?.slide.quoteId !== s.quoteId" name="after" :quote-id="s.quoteId" />
      </template>
    </div>
  </div>

  <!-- 화면(stage) — 도면 크게 보기 · 구성도 설명 옆 판 -->
  <Teleport v-if="interactive" to="body">
    <div
      v-if="zoomFigure !== null"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 sm:p-8"
      data-deck-overlay="zoom"
      @click.self="zoomFigure = null"
    >
      <div class="flex max-h-full w-full max-w-[1800px] flex-col overflow-hidden rounded-[14px] bg-white shadow-2xl">
        <div class="flex items-center justify-between gap-6 border-b border-line px-5 py-3">
          <p class="text-[16px] font-bold text-[#141e34]">시스템 구성도</p>
          <button type="button" class="h-[34px] rounded-[6px] border border-line-2 px-[12px] text-[14px] text-[#141e34] hover:bg-brand-50" @click="zoomFigure = null">
            닫기 ✕
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-auto p-4">
          <img :src="zoomFigure.img" alt="시스템 구성도 크게 보기" class="mx-auto block max-h-[82vh] w-auto max-w-full">
        </div>
        <p v-if="zoomFigure.caption !== ''" class="border-t border-line px-5 py-3 text-[15px] leading-[1.7] text-[#3b4558]">{{ zoomFigure.caption }}</p>
      </div>
    </div>
    <div v-if="notesOpen && !flow" class="fixed inset-0 z-50 flex justify-end bg-black/40" data-deck-overlay="notes" @click.self="notesOpen = false">
      <aside class="flex h-full w-full max-w-[520px] flex-col bg-white shadow-2xl" aria-label="구성도 설명">
        <div class="flex items-center justify-between gap-6 border-b border-line px-6 py-4">
          <p class="text-[18px] font-bold text-[#141e34]">구성도 설명 <span class="ml-[4px] text-[14px] font-normal text-tx-3">{{ diagramNotes.length }}개 항목</span></p>
          <button type="button" class="h-[34px] rounded-[6px] border border-line-2 px-[12px] text-[14px] text-[#141e34] hover:bg-brand-50" @click="notesOpen = false">
            닫기 ✕
          </button>
        </div>
        <div class="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-6 py-5">
          <div v-for="(n, ni) in diagramNotes" :key="ni" class="flex flex-col gap-[8px]">
            <p v-if="n.title !== ''" class="text-[16px] font-bold leading-[1.4] text-brand-600">{{ n.title }}</p>
            <ul class="flex list-disc flex-col gap-[4px] pl-[20px] text-[15px] leading-[1.7] text-[#141e34]">
              <li v-for="(t, ti) in n.items" :key="ti">{{ t }}</li>
            </ul>
          </div>
          <p class="text-[13px] leading-[1.6] text-tx-3">{{ diagramNote }}</p>
        </div>
      </aside>
    </div>
  </Teleport>
</template>
