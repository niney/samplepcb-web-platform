// 의뢰 출력물(16:9 장) 내용 — 의뢰 상세 응답을 장에 싣기 좋은 모양(표 행 · 문답 · 분야 덩어리)으로 바꾼다.
// 순수 함수만 둔다. 라벨은 전부 개발의뢰 계약 사전(DEVELOP_*)과 레지스트리에서 온다 — 여기서 새로 짓는 한글은 표의 열 이름과
// 출력물에만 있는 안내 문장뿐이다. 어느 장에 실을지(배분)는 RequestPrint 가 잰 높이로 정한다.
import {
  DEVELOP_BUDGET_RANGE_LABELS,
  DEVELOP_CURRENT_STAGE_LABELS,
  DEVELOP_DELIVERY_FORM_LABELS,
  DEVELOP_DOC_STATUS_LABELS,
  DEVELOP_DOC_TYPE_LABELS,
  DEVELOP_PRIORITY_LABELS,
  DEVELOP_REGISTRY,
  DEVELOP_SOURCING_MODE_LABELS,
  DEVELOP_TARGET_STAGE_LABELS,
  DEVELOP_TASK_PHASE_LABELS,
  DEVELOP_TASK_STATUS_LABELS,
  DEV_REVIEW_GENERAL_AREA,
  developAreaBadge,
  developDocDecisionLabel,
  developFollowupAnswerText,
  developPcbMaterialsMode,
  developProductionSummary,
  developSlotLabel,
  developSystemScopeNote,
  developWishLabel,
  isDevelopFollowupAnswered,
  isDevelopFollowupUnknown,
} from '@sp/api-contract';
import type {
  DevReviewScheduleType,
  DevelopDocumentViewType,
  DevelopFileMetaType,
  DevelopProgressViewType,
  DevelopRequestDetailType,
  MarketDevReviewType,
} from '@sp/api-contract';
import { buildDevReviewBriefRows } from '@sp/utils';
import { dateShort, dateTimeKst, fileSize, statusLabel } from './format';

// ── 표 ────────────────────────────────────────────────────────────────────────
export interface DeckCol {
  key: string;
  label: string;
  width: string; // 격자 열 폭('240px' · '1fr')
  align?: 'right';
  strong?: boolean; // 굵게(단계 이름)
  nowrap?: boolean; // 줄을 바꾸지 않는다(날짜 · 번호)
  // 칸을 그리는 법 — index = 파란 번호, range = 일정 막대(data.start · min · max · total), progress = 진행률 막대(data.pct) + 글
  kind?: 'index' | 'range' | 'progress';
}
export interface DeckRow {
  key: string;
  cells: Record<string, string>;
  sub?: Record<string, string>; // 칸 아래 작은 회색 한 줄(비고)
  muted?: readonly string[]; // 흐리게 적을 칸(모름 · 미응답)
  data?: Record<string, number>; // 그림으로 그리는 칸의 수치(막대)
}
/** 표 하나 — 넓은 판(본문 폭)과, 두 단에 나눠 실을 때의 촘촘한 판(한 단 폭) 열 구성. */
export interface DeckTableDef {
  cols: DeckCol[];
  denseCols: DeckCol[];
  rows: DeckRow[];
  compact: boolean; // 열이 많은 표 — 본문 폭에서도 촘촘한 글자로 그린다
}
const kvCols = (label: string, value: string, wide: number, dense: number): Pick<DeckTableDef, 'cols' | 'denseCols' | 'compact'> => ({
  compact: false,
  cols: [
    { key: 'label', label, width: `${String(wide)}px` },
    { key: 'value', label: value, width: '1fr' },
  ],
  denseCols: [
    { key: 'label', label, width: `${String(dense)}px` },
    { key: 'value', label: value, width: '1fr' },
  ],
});
const kv = (key: string, label: string, value: string, muted = false): DeckRow => ({
  key,
  cells: { label, value },
  ...(muted ? { muted: ['value'] } : {}),
});

/** 의뢰 개요 — 조건(메뉴 · 예산 · 시기 · 단계 · 시제품) → 진행 상태 → 의뢰인. RequestContent 의 타일 · 행을 한 표로. */
export function buildOverviewTable(d: DevelopRequestDetailType): DeckTableDef {
  const scope = developSystemScopeNote(d.requestMode, d.answers);
  const badge = developAreaBadge(d.serviceAreas);
  const wish = developWishLabel(d.wishDate, d.wishNote);
  const stage =
    d.currentStage === null && d.targetStage === null
      ? '—'
      : `${d.currentStage === null ? '—' : DEVELOP_CURRENT_STAGE_LABELS[d.currentStage]} → ${d.targetStage === null ? '—' : DEVELOP_TARGET_STAGE_LABELS[d.targetStage]}`;
  const rows: DeckRow[] = [
    kv('menu', '개발 메뉴', scope === '' ? badge : `${badge} (${scope})`),
    kv('budget', '예산', DEVELOP_BUDGET_RANGE_LABELS[d.budgetRange]),
    kv('wish', '희망 완료 시기', wish === '' ? '—' : wish),
    kv('stage', '개발 단계', stage),
  ];
  if (d.expertDelegate) rows.push(kv('delegate', '세부 사양', '전문가에게 맡김'));
  const p = d.production;
  if (p !== null) {
    // PCB 설계만이면 4스텝이 'PCB 제작 · 부품 구매 · SMT 조립'(2026-11-03) — 제목 · 부품 공급 라벨을 그 모양으로.
    const pcbFab = developPcbMaterialsMode(d.requestMode, d.serviceAreas);
    rows.push(kv('plan', pcbFab ? 'PCB 제작·조립' : '시제품·제조', developProductionSummary(p, pcbFab)));
    if (p.priority !== null) rows.push(kv('priority', '우선순위', DEVELOP_PRIORITY_LABELS[p.priority]));
    if (p.sourcing !== null) rows.push(kv('sourcing', pcbFab ? '부품 공급' : '자재 조달', DEVELOP_SOURCING_MODE_LABELS[p.sourcing]));
    if (p.delivery !== null) rows.push(kv('delivery', '납품 형태', DEVELOP_DELIVERY_FORM_LABELS[p.delivery]));
  }
  rows.push(kv('status', '진행 상태', statusLabel(d.status)));
  const c = d.contact;
  rows.push(kv('contact', '의뢰인', c.company === null ? c.name : `${c.name} · ${c.company}`));
  rows.push(kv('reach', '연락처', `${c.phone} · ${c.email}`));
  if (c.hours !== null) rows.push(kv('hours', '통화 가능 시간', c.hours));
  rows.push(kv('nda', '비밀유지 계약', d.ndaWanted ? '희망 — 담당자가 계약서를 준비해 연락드립니다' : '희망하지 않음', !d.ndaWanted));
  return { ...kvCols('항목', '내용', 240, 132), rows };
}

/** 세부 질문 답변 — 답한 문항만, 사전 순서로. '잘 모르겠어요'는 흐리게. */
export function buildBriefTable(d: DevelopRequestDetailType): DeckTableDef {
  const rows = buildDevReviewBriefRows(d.answers, DEVELOP_REGISTRY).map((r) => kv(r.code, r.label, r.value, r.unknown));
  return { ...kvCols('질문', '답변', 240, 132), rows };
}

/** 첨부 자료 — 참고 자료(일반) 먼저, 분야별 추가 자료(슬롯)는 종류를 적는다. */
export function buildFileTable(files: readonly DevelopFileMetaType[]): DeckTableDef {
  const rows = [...files]
    .sort((a, b) => Number(a.area !== null) - Number(b.area !== null))
    .map((f): DeckRow => ({
      key: String(f.fileId),
      cells: { name: f.name, kind: f.area !== null && f.slot !== null ? developSlotLabel(f.area, f.slot) : '참고 자료', size: fileSize(f.size) },
    }));
  return {
    compact: false,
    cols: [
      { key: 'name', label: '파일', width: '1fr' },
      { key: 'kind', label: '구분', width: '260px' },
      { key: 'size', label: '크기', width: '120px', align: 'right', nowrap: true },
    ],
    denseCols: [
      { key: 'name', label: '파일', width: '1fr' },
      { key: 'kind', label: '구분', width: '120px' },
      { key: 'size', label: '크기', width: '84px', align: 'right', nowrap: true },
    ],
    rows,
  };
}

/** 프로젝트 문서 — 종류 · 번호마다 최신 판만, 최근에 온 것이 위. 본문은 싣지 않는다(문서마다 인쇄가 따로 있다). */
export function buildDocTable(documents: readonly DevelopDocumentViewType[]): DeckTableDef {
  const sentMs = (d: DevelopDocumentViewType): number => {
    const t = d.sentAt === null ? Number.NaN : new Date(d.sentAt).getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  // 상태 — 회신을 기다리는 문서는 '확인 요청', 결정된 문서는 결정 문안 그대로(DocumentList 와 같은 규칙).
  const state = (d: DevelopDocumentViewType): string => {
    if (d.status === 'superseded') return DEVELOP_DOC_STATUS_LABELS.superseded;
    if (d.status === 'sent') return d.approval ? '확인 요청' : '공유됨';
    if (d.decision !== null) return developDocDecisionLabel(d.type, d.decision);
    return DEVELOP_DOC_STATUS_LABELS[d.status];
  };
  const reply = (d: DevelopDocumentViewType): string => {
    if (d.decision === null) return d.approval && d.status === 'sent' ? '회신 대기' : '—';
    const who = [d.decidedName, d.decidedAt === null ? null : dateTimeKst(d.decidedAt)].filter((v): v is string => v !== null).join(' · ');
    return d.decisionNote === null ? who : `${who} — ${d.decisionNote}`;
  };
  const rows = documents
    .filter((d) => d.isCurrent)
    .sort((a, b) => sentMs(b) - sentMs(a))
    .map((d): DeckRow => {
      const pending = d.decision === null;
      return {
        key: String(d.documentId),
        cells: {
          type: DEVELOP_DOC_TYPE_LABELS[d.type],
          no: d.version > 1 ? `${d.docNo} v${String(d.version)}` : d.docNo,
          state: state(d),
          sent: d.sentAt === null ? '—' : dateShort(d.sentAt),
          reply: reply(d),
        },
        ...(pending ? { muted: ['reply'] } : {}),
      };
    });
  const cols: DeckCol[] = [
    { key: 'type', label: '문서', width: '250px' },
    { key: 'no', label: '번호', width: '120px', nowrap: true },
    { key: 'state', label: '상태', width: '150px' },
    { key: 'sent', label: '발송일', width: '130px', nowrap: true },
    { key: 'reply', label: '회신', width: '1fr' },
  ];
  return { cols, denseCols: cols, rows, compact: true };
}

/** 공유된 업무 — 서버가 고객 공개 행만 내려준다. 진행률은 막대로 그린다(data.pct). */
export function buildTaskTable(progress: DevelopProgressViewType): DeckTableDef {
  const rows = progress.tasks.map((t): DeckRow => ({
    key: String(t.taskId),
    cells: {
      name: t.name,
      phase: DEVELOP_TASK_PHASE_LABELS[t.phase],
      state: DEVELOP_TASK_STATUS_LABELS[t.status],
      period: t.startOn === null && t.endOn === null ? '—' : `${t.startOn ?? '—'} ~ ${t.endOn ?? '—'}`,
      pct: `${String(t.progressPct)}%`,
    },
    ...(t.note === null ? {} : { sub: { name: t.note } }),
    data: { pct: t.progressPct },
  }));
  const cols: DeckCol[] = [
    { key: 'name', label: '업무', width: '1fr' },
    { key: 'phase', label: '단계', width: '150px' },
    { key: 'state', label: '상태', width: '130px' },
    { key: 'period', label: '기간', width: '250px', nowrap: true },
    { key: 'pct', label: '진행률', width: '170px', align: 'right', kind: 'progress' },
  ];
  return { cols, denseCols: cols, rows, compact: true };
}

/**
 * 예상 개발 일정 — 단계마다 한 행. 검토서 일정은 최소~최대 주만 있고 시작 시점이 없어 단계를 차례로 잇는다
 * (ReviewSchedule 과 같은 규칙 — 다음 단계는 앞 단계 최소가 끝난 뒤 시작). 막대 칸은 data(start · min · max · total)로 그린다.
 */
export function buildScheduleTable(schedule: DevReviewScheduleType): DeckTableDef {
  let cursor = 0;
  const bars = schedule.phases.map((p) => {
    const min = Math.max(0, p.minWeeks);
    const max = Math.max(min, p.maxWeeks);
    const bar = { start: cursor, min, max };
    cursor += min;
    return bar;
  });
  const total = Math.max(1, ...bars.map((b) => b.start + b.max));
  const rows = schedule.phases.map((p, i): DeckRow => {
    const bar = bars[i] ?? { start: 0, min: 0, max: 0 };
    return {
      key: String(i),
      cells: {
        no: String(i + 1).padStart(2, '0'),
        name: p.name,
        weeks: p.minWeeks === p.maxWeeks ? `${String(p.minWeeks)}주` : `${String(p.minWeeks)}~${String(p.maxWeeks)}주`,
        bar: '',
        output: p.output === '' ? '—' : p.output,
        pre: p.prerequisite === '' ? '—' : p.prerequisite,
      },
      ...(p.note === '' ? {} : { sub: { pre: p.note } }),
      muted: [...(p.output === '' ? ['output'] : []), ...(p.prerequisite === '' ? ['pre'] : [])],
      data: { ...bar, total },
    };
  });
  const cols: DeckCol[] = [
    { key: 'no', label: '', width: '50px', kind: 'index' },
    { key: 'name', label: '단계', width: '232px', strong: true },
    { key: 'weeks', label: '기간', width: '82px', nowrap: true },
    { key: 'bar', label: '일정', width: '1fr', kind: 'range' },
    { key: 'output', label: '산출물', width: '250px' },
    { key: 'pre', label: '선행 조건 · 비고', width: '330px' },
  ];
  return { cols, denseCols: cols, rows, compact: true };
}

// ── AI 추가 질문 ──────────────────────────────────────────────────────────────
export interface DeckQa {
  key: string;
  question: string;
  answer: string;
  muted: boolean; // 미응답 · 모름
}
/**
 * AI 가 자료를 읽고 더 물은 질문과 답(§7.2.2 시스템개발 후속 질문 · §7.2.4 개별 메뉴 맞춤 질문의 새 질문). 저장분이 없으면 null.
 * 미응답도 남긴다(무엇을 물었는지가 견적 근거의 일부다). 맞춤 질문은 새 질문이 없으면 통째로 뺀다(답은 세부 질문 답변에 있다).
 */
export function buildDeckQa(d: DevelopRequestDetailType): { understood: string; items: DeckQa[] } | null {
  const stored = d.aiQuestions;
  if (stored === null || (stored.area !== undefined && stored.questions.length === 0)) return null;
  return {
    understood: stored.understood,
    items: stored.questions.map((q) => ({
      key: q.id,
      question: q.question,
      answer: isDevelopFollowupAnswered(q) ? developFollowupAnswerText(q) : '답하지 않음',
      muted: !isDevelopFollowupAnswered(q) || isDevelopFollowupUnknown(q),
    })),
  };
}

// ── 개발 분석 · 확인 사항 ──────────────────────────────────────────────────────
/** 명세 묶음 — 같은 항목명('출력·구동부' 셋)을 한 제목 아래로 모은다. */
export interface DeckSpecGroup {
  item: string;
  texts: string[];
}
export interface DeckArea {
  key: string;
  label: string;
  summary: string;
  groups: DeckSpecGroup[];
  notes: string[]; // 검토 관찰 — 자료의 사실 둘을 잇는 한 줄
  questionCount: number; // 이 분야의 확인 사항 수(뒤쪽 '확인이 필요한 사항' 장에서 다룬다)
}
export interface DeckQuestion {
  no: number; // 장을 넘어 이어지는 번호
  areaLabel: string;
  question: string;
  why: string;
  resolution: string; // 담당자가 상담 뒤 적은 확인 결과 — 없으면 ''
}

const GENERAL_LABEL = '공통';

export function buildDeckAreas(review: MarketDevReviewType): DeckArea[] {
  return review.areas.map((a) => {
    const groups: DeckSpecGroup[] = [];
    for (const row of a.spec) {
      const group = groups.find((g) => g.item === row.item);
      if (group === undefined) groups.push({ item: row.item, texts: [row.text] });
      else group.texts.push(row.text);
    }
    return {
      key: a.area,
      label: DEVELOP_REGISTRY.areaLabel(a.area),
      summary: a.summary,
      groups,
      notes: a.observations.map((o) => o.text),
      questionCount: review.openQuestions.filter((q) => q.area === a.area).length,
    };
  });
}

/** 확인 사항 — 공통(분야에 안 속하는 것) 먼저, 그다음 검토서의 분야 순서대로. 같은 분야 안에서는 원래 순서. */
export function buildDeckQuestions(review: MarketDevReviewType): DeckQuestion[] {
  const order = review.areas.map((a) => a.area);
  const rank = (area: string): number => {
    const i = order.indexOf(area);
    return area === DEV_REVIEW_GENERAL_AREA || i < 0 ? -1 : i;
  };
  return review.openQuestions
    .map((q, i) => ({ q, i, r: rank(q.area) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ q, r }, i) => ({
      no: i + 1,
      areaLabel: r < 0 ? GENERAL_LABEL : DEVELOP_REGISTRY.areaLabel(q.area),
      question: q.question,
      why: q.why,
      resolution: q.resolution ?? '',
    }));
}

/** 장 제목 꼬리 — 그 장에 실린 분야 이름을 겹치지 않게 순서대로('공통 · 회로 개발'). */
export const joinLabels = (labels: readonly string[]): string => [...new Set(labels)].join(' · ');
