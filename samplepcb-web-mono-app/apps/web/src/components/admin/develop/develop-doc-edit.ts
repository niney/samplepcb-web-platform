import {
  DEVELOP_DEFAULT_TASKS,
  DEVELOP_DOC_DATE_RE,
  DEVELOP_DOC_FIELDS,
  developProgressSummary,
  emptyDevelopDocContent,
} from '@sp/api-contract';
import type {
  DevReviewScheduleType,
  DevelopDocContentType,
  DevelopDocFieldValueType,
  DevelopDocStatusType,
  DevelopDocTypeType,
  DevelopProgressSummary,
  DevelopTaskInputType,
  DevelopTaskPhaseType,
  DevelopTaskStatusType,
  DevelopTaskViewType,
} from '@sp/api-contract';

// 프로젝트 문서·업무표(docs/DEVELOP_FLOW.md §13) 편집 보조 — 순수 함수만. 화면(.vue)에서 떼어 둔 이유는
// 검토서(develop-review-edit.ts)·견적(develop-quote-edit.ts)과 같다: 저장 직전 계약 모양으로 바꾸는 변환과
// 계약 zod 가 막을 값을 미리 걸러내는 검사를 테스트 가능한 자리에 두기 위해서다.
// 값 형태 정본은 계약(develop-docs.ts): text·textarea·date·datetime·select → string · checklist → 코드 배열 ·
// table → 행 객체 배열. `structuredClone` 은 reactive proxy 에서 던지므로 손으로 복사한다.

// ── 문서 본문 ────────────────────────────────────────────────────────────────

const cloneRow = (row: Record<string, string>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v;
  return out;
};

// 배열 두 갈래(코드 배열 · 행 배열)의 합집합에 그대로 .map/.filter 를 부르면 TS 가 시그니처를
// 못 합치므로, 원소 합집합의 readonly 배열로 한 번 넓혀서 다룬다.
type DocCell = string | Record<string, string>;
const asDocArray = (value: DevelopDocFieldValueType | undefined): readonly DocCell[] | null =>
  value === undefined || typeof value === 'string' ? null : value;

/** 본문 깊은 복사 — 편집기가 서버 응답과 같은 객체를 물지 않게 한다. */
export function cloneDevelopDocContent(content: DevelopDocContentType): DevelopDocContentType {
  const out: DevelopDocContentType = {};
  for (const [key, value] of Object.entries(content)) {
    const arr = asDocArray(value);
    if (arr === null) {
      out[key] = typeof value === 'string' ? value : '';
    } else if (arr.every((v) => typeof v === 'string')) {
      out[key] = arr.filter((v): v is string => typeof v === 'string');
    } else {
      out[key] = arr.map((row) => (typeof row === 'string' ? {} : cloneRow(row)));
    }
  }
  return out;
}

/**
 * 편집기용 본문 — 스펙의 모든 키가 있어야 v-model 이 물린다. 서버 본문(부분 저장 허용)에
 * 빠진 키는 빈 값으로 채우고, 스펙에 없는 키는 버린다(400 UNKNOWN_FIELD 예방).
 */
export function developDocFormContent(type: DevelopDocTypeType, content: DevelopDocContentType): DevelopDocContentType {
  const out = emptyDevelopDocContent(type);
  const clone = cloneDevelopDocContent(content);
  for (const spec of DEVELOP_DOC_FIELDS[type]) {
    const value = clone[spec.key];
    if (value === undefined) continue;
    const arr = asDocArray(value);
    if (spec.kind === 'table') {
      if (arr !== null) out[spec.key] = arr.filter((v): v is Record<string, string> => typeof v !== 'string');
    } else if (spec.kind === 'checklist') {
      if (arr !== null) out[spec.key] = arr.filter((v): v is string => typeof v === 'string');
    } else if (typeof value === 'string') {
      out[spec.key] = value;
    }
  }
  return out;
}

export const developDocText = (content: DevelopDocContentType, key: string): string => {
  const v = content[key];
  return typeof v === 'string' ? v : '';
};

export const developDocCodes = (content: DevelopDocContentType, key: string): string[] =>
  asDocArray(content[key])?.filter((c): c is string => typeof c === 'string') ?? [];

export const developDocRows = (content: DevelopDocContentType, key: string): Record<string, string>[] =>
  asDocArray(content[key])?.filter((r): r is Record<string, string> => typeof r !== 'string') ?? [];

/** 표 행 하나 — 컬럼 키를 모두 빈 문자열로(계약은 빈 행도 받는다). */
export const emptyDevelopDocRow = (type: DevelopDocTypeType, key: string): Record<string, string> => {
  const spec = DEVELOP_DOC_FIELDS[type].find((f) => f.key === key);
  const row: Record<string, string> = {};
  for (const col of spec?.columns ?? []) row[col.key] = '';
  return row;
};

/**
 * 문서 상태 배지 톤 — 관리자 팔레트 관례(develop-badge.ts)와 같은 규칙:
 * 확인 대기=파랑 · 끝난 것(승인·조건부)=초록 · 되돌아온 것=주황 · 거절=빨강 · 작성 중/이전 판=회색.
 */
export const developDocStatusClass = (status: DevelopDocStatusType): string => {
  switch (status) {
    case 'sent':
      return 'bg-blue-100 text-blue-700';
    case 'approved':
    case 'conditional':
      return 'bg-emerald-100 text-emerald-700';
    case 'changes_requested':
    case 'discuss_requested':
      return 'bg-amber-100 text-amber-700';
    case 'rejected':
      return 'bg-red-100 text-red-700';
    default:
      return 'bg-gray-100 text-gray-600';
  }
};

export interface DevelopDocIssue {
  /** 필드 키 */
  key: string;
  /** 표 컬럼 키(표 이슈일 때만) */
  column: string | null;
  /** UNKNOWN_FIELD·TYPE·DATE·OPTION·DUPLICATE·UNKNOWN_COLUMN */
  code: string;
}

/** 계약 developDocContentIssues 의 `CODE:key[.col]` 문자열을 필드별 표시용으로 쪼갠다. */
export function parseDevelopDocIssues(issues: readonly string[]): DevelopDocIssue[] {
  return issues.map((raw) => {
    const at = raw.indexOf(':');
    const code = at < 0 ? raw : raw.slice(0, at);
    const path = at < 0 ? '' : raw.slice(at + 1);
    const dot = path.indexOf('.');
    return dot < 0 ? { key: path, column: null, code } : { key: path.slice(0, dot), column: path.slice(dot + 1), code };
  });
}

// ── 업무표(WBS) ──────────────────────────────────────────────────────────────
// 행 편집은 문자열 폼으로 들고(빈 칸·부분 입력 허용) 저장 직전에만 계약 모양으로 바꾼다.
// 가중치는 화면이 %, 계약이 bp(1000 = 10%)라 여기서만 환산한다.

export interface DevelopTaskRow {
  name: string;
  phase: DevelopTaskPhaseType;
  status: DevelopTaskStatusType;
  startOn: string;
  endOn: string;
  weightPct: string;
  progressPct: string;
  note: string;
  visibleToCustomer: boolean;
}

export const DEVELOP_TASK_MAX_ROWS = 100; // 계약 AdminDevelopTasksPutBody 의 max(100)

export const emptyDevelopTaskRow = (): DevelopTaskRow => ({
  name: '',
  phase: 'design',
  status: 'planned',
  startOn: '',
  endOn: '',
  weightPct: '0',
  progressPct: '0',
  note: '',
  visibleToCustomer: false,
});

const rowFromInput = (t: DevelopTaskInputType): DevelopTaskRow => ({
  name: t.name,
  phase: t.phase,
  status: t.status,
  startOn: t.startOn ?? '',
  endOn: t.endOn ?? '',
  weightPct: String(t.weightBp / 100),
  progressPct: String(t.progressPct),
  note: t.note ?? '',
  visibleToCustomer: t.visibleToCustomer,
});

export const developTaskRowsFromViews = (tasks: readonly DevelopTaskViewType[]): DevelopTaskRow[] =>
  tasks.map(rowFromInput);

export const developTaskRowsFromDefaults = (): DevelopTaskRow[] => DEVELOP_DEFAULT_TASKS.map(rowFromInput);

/**
 * 검토서 개발 일정(예상)에서 시드 — 단계 이름을 업무명으로, 가중치는 균등 배분한다.
 * 주 단위 기간은 실제 착수일을 모르면 날짜로 못 바꾸므로 일정은 비워 두고 담당자가 채운다.
 */
export function developTaskRowsFromSchedule(schedule: DevReviewScheduleType | null): DevelopTaskRow[] {
  const phases = (schedule?.phases ?? []).filter((p) => p.name.trim() !== '');
  if (phases.length === 0) return [];
  const each = Math.floor(10_000 / phases.length);
  return phases.map((p, i) => ({
    ...emptyDevelopTaskRow(),
    name: p.name.trim().slice(0, 200),
    // 남는 bp 는 첫 행에 몰아 합이 정확히 100% 가 되게 한다.
    weightPct: String((i === 0 ? each + (10_000 - each * phases.length) : each) / 100),
    note: p.prerequisite.trim().slice(0, 500),
    visibleToCustomer: true,
  }));
}

const clampInt = (raw: string, min: number, max: number): number => {
  const n = Number(raw.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export const developTaskWeightBp = (row: DevelopTaskRow): number => {
  const n = Number(row.weightPct.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.min(10_000, Math.max(0, Math.round(n * 100)));
};

/** 가중치 합(%) — 100 이 아니어도 저장은 막지 않는다(경고만). */
export const developTaskWeightSum = (rows: readonly DevelopTaskRow[]): number =>
  rows.reduce((sum, r) => sum + developTaskWeightBp(r), 0) / 100;

export const developTaskInputs = (rows: readonly DevelopTaskRow[]): DevelopTaskInputType[] =>
  rows.map((r) => ({
    name: r.name.trim(),
    phase: r.phase,
    status: r.status,
    startOn: DEVELOP_DOC_DATE_RE.test(r.startOn) ? r.startOn : null,
    endOn: DEVELOP_DOC_DATE_RE.test(r.endOn) ? r.endOn : null,
    weightBp: developTaskWeightBp(r),
    progressPct: clampInt(r.progressPct, 0, 100),
    note: r.note.trim() === '' ? null : r.note.trim().slice(0, 500),
    visibleToCustomer: r.visibleToCustomer,
  }));

export interface DevelopTaskIssue {
  index: number;
  code: 'NAME' | 'ORDER';
}

/** 계약 zod 가 400 으로 막는 자리(업무명 필수·완료일 < 시작일)를 저장 전에 같은 규칙으로 검사한다. */
export function developTaskIssues(rows: readonly DevelopTaskRow[]): DevelopTaskIssue[] {
  const issues: DevelopTaskIssue[] = [];
  for (const [index, r] of rows.entries()) {
    if (r.name.trim() === '') issues.push({ index, code: 'NAME' });
    if (r.startOn !== '' && r.endOn !== '' && r.endOn < r.startOn) issues.push({ index, code: 'ORDER' });
  }
  return issues;
}

/** 저장 전 달성도 미리보기 — 서버와 같은 계약 함수를 쓴다. */
export const developTaskProgressPreview = (rows: readonly DevelopTaskRow[], contractDone: boolean): DevelopProgressSummary =>
  developProgressSummary(
    developTaskInputs(rows).map((t) => ({ phase: t.phase, status: t.status, weightBp: t.weightBp, progressPct: t.progressPct })),
    contractDone,
  );

// ── 간트(실제 날짜) ───────────────────────────────────────────────────────────
// 프로토타입의 "순서 기반 가짜 위치"는 안 가져온다(계약 주석) — 막대는 날짜 비례다.
// 날짜가 한쪽만 있으면 하루짜리로 보고, 둘 다 없으면 '일정 미정' 목록으로 뺀다.

const DAY = 86_400_000;

const dayNumber = (ymd: string): number | null => {
  if (!DEVELOP_DOC_DATE_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  if (y === undefined || m === undefined || d === undefined) return null;
  return Date.UTC(y, m - 1, d) / DAY;
};

const ymdOf = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10);

export interface DevelopGanttBar {
  index: number;
  name: string;
  status: DevelopTaskStatusType;
  startOn: string;
  endOn: string;
  leftPct: number;
  widthPct: number;
}
export interface DevelopGanttTick {
  label: string;
  leftPct: number;
}
export interface DevelopGanttModel {
  startOn: string;
  endOn: string;
  totalDays: number;
  bars: DevelopGanttBar[];
  ticks: DevelopGanttTick[];
  undated: { index: number; name: string }[];
}

export function developGanttModel(rows: readonly DevelopTaskRow[]): DevelopGanttModel | null {
  const dated: { index: number; row: DevelopTaskRow; from: number; to: number }[] = [];
  const undated: { index: number; name: string }[] = [];
  for (const [index, row] of rows.entries()) {
    const s = dayNumber(row.startOn);
    const e = dayNumber(row.endOn);
    const from = s ?? e;
    const to = e ?? s;
    if (from === null || to === null) {
      undated.push({ index, name: row.name });
      continue;
    }
    dated.push({ index, row, from: Math.min(from, to), to: Math.max(from, to) });
  }
  if (dated.length === 0) return null;
  const first = Math.min(...dated.map((d) => d.from));
  const last = Math.max(...dated.map((d) => d.to));
  const totalDays = last - first + 1;
  const bars = dated.map((d) => ({
    index: d.index,
    name: d.row.name,
    status: d.row.status,
    startOn: ymdOf(d.from),
    endOn: ymdOf(d.to),
    leftPct: ((d.from - first) / totalDays) * 100,
    widthPct: ((d.to - d.from + 1) / totalDays) * 100,
  }));
  const ticks: DevelopGanttTick[] = [];
  for (let day = first; day <= last; day += 7) {
    ticks.push({ label: ymdOf(day).slice(5), leftPct: ((day - first) / totalDays) * 100 });
  }
  return { startOn: ymdOf(first), endOn: ymdOf(last), totalDays, bars, ticks, undated };
}

export const developTaskBarClass = (status: DevelopTaskStatusType): string => {
  switch (status) {
    case 'done':
      return 'bg-emerald-500';
    case 'in_progress':
      return 'bg-blue-500';
    case 'delayed':
      return 'bg-red-500';
    default:
      return 'bg-gray-300';
  }
};
