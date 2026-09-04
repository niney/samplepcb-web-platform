import { computeDevelopQuoteAmounts, splitDevelopMilestoneAmounts } from '@sp/api-contract';
import type {
  AdminDevelopQuoteBodyType,
  AdminDevelopSettingsType,
  DevelopMilestoneTriggerType,
  DevelopQuoteAmounts,
  DevelopQuoteKindType,
  DevelopQuoteViewType,
  DevelopVatModeType,
} from '@sp/api-contract';
import { kstToday } from '@sp/utils';

// 견적서 편집 폼 모델 — 화면은 문자열로 들고, 저장할 때만 계약(zod) 모양으로 바꾼다.
// 상한·필수는 계약 `AdminDevelopQuoteBody` 와 같아야 한다. 화면이 먼저 막지 않으면 POST/PATCH 가 400 이다.
// 금액은 정수(원). 입력은 콤마를 허용하고 저장 전에 숫자로 만든다.

export const DEVELOP_QUOTE_LIMITS = {
  items: 100,
  milestones: 10,
  deliverables: 50,
  titleLen: 200,
  itemTitleLen: 200,
  descriptionLen: 2000,
  itemAmountMax: 2_000_000_000,
  durationDaysMax: 3650,
  warrantyDaysMax: 3650,
  reviewDaysMax: 90,
  milestoneTitleLen: 100,
  deliverableLen: 200,
  scheduleNoteLen: 4000,
  exclusionsLen: 4000,
  termsLen: 20000,
  noteLen: 4000,
  internalNoteLen: 4000,
} as const;

export interface DevelopQuoteItemRow {
  title: string;
  description: string;
  amount: string;
  durationDays: string;
}

export interface DevelopQuoteMilestoneRow {
  title: string;
  percent: string;
  trigger: DevelopMilestoneTriggerType;
  unlocksDeliverables: boolean;
}

export interface DevelopQuoteForm {
  kind: DevelopQuoteKindType;
  title: string;
  vatMode: DevelopVatModeType;
  durationDays: string;
  scheduleNote: string;
  deliverables: string; // 줄 단위
  exclusions: string;
  terms: string;
  warrantyDays: string;
  reviewDays: string;
  validUntil: string; // YYYY-MM-DD(KST)
  note: string;
  internalNote: string;
  items: DevelopQuoteItemRow[];
  milestones: DevelopQuoteMilestoneRow[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** KST 오늘 + n일 — 유효기간 기본값. */
export const kstDatePlus = (days: number): string => kstToday(new Date(Date.now() + days * DAY_MS));

/** `3,600,000` · `3600000원` → 3600000. 읽을 수 없으면 NaN. */
export function parseAmountInput(raw: string): number {
  const cleaned = raw.replace(/[,\s원]/g, '');
  if (cleaned === '') return Number.NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** 입력칸 표시용 천단위 — 값이 없으면 원문 그대로 둔다(입력 중 커서가 튀지 않게 blur 에서만 쓴다). */
export function formatAmountInput(raw: string): string {
  const n = parseAmountInput(raw);
  if (!Number.isFinite(n)) return raw;
  return Math.round(n).toLocaleString('ko-KR');
}

const parseIntOrNull = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : Number.NaN;
};

export const emptyQuoteItemRow = (): DevelopQuoteItemRow => ({ title: '', description: '', amount: '', durationDays: '' });

export const ratioBpOfRow = (row: DevelopQuoteMilestoneRow): number => Math.round(Number(row.percent) * 100);

/** 새 견적 폼 — 설정 싱글턴의 기본값을 복사한다(그 뒤 설정이 바뀌어도 이 견적은 안 바뀐다). */
export function newDevelopQuoteForm(
  settings: AdminDevelopSettingsType,
  kind: DevelopQuoteKindType,
  requestTitle: string,
): DevelopQuoteForm {
  const milestones = settings.defaultMilestones.map((m, i) => ({
    title: m.title,
    percent: String(m.ratioBp / 100),
    trigger: m.trigger,
    // 산출물 해제는 마지막 한 행(잔금)이 기본 — 관리자가 다른 행으로 옮길 수 있다.
    unlocksDeliverables: i === settings.defaultMilestones.length - 1,
  }));
  return {
    kind,
    title: requestTitle.slice(0, DEVELOP_QUOTE_LIMITS.titleLen),
    vatMode: settings.defaultVatMode,
    durationDays: '',
    scheduleNote: '',
    deliverables: '',
    exclusions: settings.defaultExclusions,
    terms: settings.defaultTerms,
    warrantyDays: String(settings.defaultWarrantyDays),
    reviewDays: String(settings.defaultReviewDays),
    validUntil: kstDatePlus(settings.defaultValidDays),
    note: '',
    internalNote: '',
    items: [emptyQuoteItemRow()],
    milestones: milestones.length > 0 ? milestones : [{ title: '', percent: '100', trigger: 'on_accept', unlocksDeliverables: true }],
  };
}

/** 저장된 초안 → 폼(다시 편집). */
export function developQuoteFormFrom(quote: DevelopQuoteViewType & { internalNote: string | null }): DevelopQuoteForm {
  return {
    kind: quote.kind,
    title: quote.title,
    vatMode: quote.vatMode,
    durationDays: quote.durationDays === null ? '' : String(quote.durationDays),
    scheduleNote: quote.scheduleNote ?? '',
    deliverables: quote.deliverables.join('\n'),
    exclusions: quote.exclusions ?? '',
    terms: quote.terms,
    warrantyDays: quote.warrantyDays === null ? '' : String(quote.warrantyDays),
    reviewDays: String(quote.reviewDays),
    validUntil: quote.validUntil,
    note: quote.note ?? '',
    internalNote: quote.internalNote ?? '',
    items: quote.items.map((it) => ({
      title: it.title,
      description: it.description ?? '',
      amount: it.amount.toLocaleString('ko-KR'),
      durationDays: it.durationDays === null ? '' : String(it.durationDays),
    })),
    milestones: quote.milestones.map((m) => ({
      title: m.title,
      percent: String((m.ratioBp ?? 0) / 100),
      trigger: m.trigger,
      unlocksDeliverables: m.unlocksDeliverables,
    })),
  };
}

export const developQuoteItemAmounts = (form: DevelopQuoteForm): number[] =>
  form.items.map((it) => {
    const n = parseAmountInput(it.amount);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
  });

export const developQuoteAmounts = (form: DevelopQuoteForm): DevelopQuoteAmounts =>
  computeDevelopQuoteAmounts(developQuoteItemAmounts(form), form.vatMode);

export const developQuoteRatioSum = (form: DevelopQuoteForm): number =>
  form.milestones.reduce((sum, m) => sum + (Number.isFinite(ratioBpOfRow(m)) ? ratioBpOfRow(m) : 0), 0);

export const developQuoteMilestoneAmounts = (form: DevelopQuoteForm): number[] =>
  splitDevelopMilestoneAmounts(
    developQuoteAmounts(form).totalAmount,
    form.milestones.map((m) => (Number.isFinite(ratioBpOfRow(m)) ? ratioBpOfRow(m) : 0)),
  );

export const developQuoteDeliverableLines = (form: DevelopQuoteForm): string[] =>
  form.deliverables
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

/**
 * 저장 전 검사 — 계약이 막는 자리를 화면에서 먼저 말한다(400 을 사용자 문구로 바꾸는 것보다 낫다).
 * 문구는 도메인 문장이라 계약 사전과 같은 층위로 여기 둔다(검토서 편집기 develop-review-edit.ts 관례).
 */
export function developQuoteIssues(form: DevelopQuoteForm): string[] {
  const issues: string[] = [];
  if (form.title.trim() === '') issues.push('견적서 제목을 적어 주세요');
  if (!DATE_RE.test(form.validUntil)) issues.push('유효기간을 골라 주세요');

  const reviewDays = parseIntOrNull(form.reviewDays);
  if (reviewDays === null || !Number.isFinite(reviewDays) || reviewDays < 1 || reviewDays > DEVELOP_QUOTE_LIMITS.reviewDaysMax) {
    issues.push('검수 기간은 1~90일 사이로 적어 주세요');
  }
  const warrantyDays = parseIntOrNull(form.warrantyDays);
  if (warrantyDays !== null && (!Number.isFinite(warrantyDays) || warrantyDays < 0 || warrantyDays > DEVELOP_QUOTE_LIMITS.warrantyDaysMax)) {
    issues.push('하자보수 일수는 0~3650일 사이로 적어 주세요');
  }
  const durationDays = parseIntOrNull(form.durationDays);
  if (durationDays !== null && (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > DEVELOP_QUOTE_LIMITS.durationDaysMax)) {
    issues.push('예상 기간은 1~3650일 사이로 적어 주세요');
  }

  if (form.items.length === 0) issues.push('견적 항목을 한 줄 이상 넣어 주세요');
  if (form.items.length > DEVELOP_QUOTE_LIMITS.items) issues.push(`견적 항목은 ${String(DEVELOP_QUOTE_LIMITS.items)}개까지입니다`);
  form.items.forEach((it, i) => {
    const row = String(i + 1);
    if (it.title.trim() === '') issues.push(`${row}번 항목의 이름을 채워 주세요`);
    const amount = parseAmountInput(it.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > DEVELOP_QUOTE_LIMITS.itemAmountMax) {
      issues.push(`${row}번 항목의 금액을 숫자로 채워 주세요`);
    }
    const days = parseIntOrNull(it.durationDays);
    if (days !== null && (!Number.isFinite(days) || days < 1 || days > DEVELOP_QUOTE_LIMITS.durationDaysMax)) {
      issues.push(`${row}번 항목의 기간은 1~3650일 사이로 적어 주세요`);
    }
  });

  const deliverables = developQuoteDeliverableLines(form);
  if (deliverables.length > DEVELOP_QUOTE_LIMITS.deliverables) {
    issues.push(`산출물은 ${String(DEVELOP_QUOTE_LIMITS.deliverables)}줄까지입니다`);
  }
  if (deliverables.some((line) => line.length > DEVELOP_QUOTE_LIMITS.deliverableLen)) {
    issues.push(`산출물 한 줄은 ${String(DEVELOP_QUOTE_LIMITS.deliverableLen)}자까지입니다`);
  }

  if (form.milestones.length === 0) issues.push('결제 조건을 한 행 이상 넣어 주세요');
  if (form.milestones.length > DEVELOP_QUOTE_LIMITS.milestones) {
    issues.push(`결제 조건은 ${String(DEVELOP_QUOTE_LIMITS.milestones)}행까지입니다`);
  }
  form.milestones.forEach((m, i) => {
    const row = String(i + 1);
    if (m.title.trim() === '') issues.push(`${row}번 결제 조건의 명칭을 채워 주세요`);
    const bp = ratioBpOfRow(m);
    if (!Number.isFinite(bp) || bp < 1 || bp > 10_000) issues.push(`${row}번 결제 조건의 비율을 확인해 주세요`);
  });
  if (form.milestones.length > 0 && developQuoteRatioSum(form) !== 10_000) {
    issues.push('결제 조건 비율 합이 100%가 아닙니다');
  }
  if (form.milestones.filter((m) => m.unlocksDeliverables).length > 1) {
    issues.push('산출물 해제는 결제 조건 하나에만 표시할 수 있습니다');
  }
  return issues;
}

/** 폼 → 계약 body. `developQuoteIssues` 가 빈 배열일 때만 부른다. */
export function developQuoteFormToBody(form: DevelopQuoteForm): AdminDevelopQuoteBodyType {
  const durationDays = parseIntOrNull(form.durationDays);
  const warrantyDays = parseIntOrNull(form.warrantyDays);
  const reviewDays = parseIntOrNull(form.reviewDays);
  const emptyToNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());
  return {
    kind: form.kind,
    title: form.title.trim(),
    vatMode: form.vatMode,
    durationDays: durationDays === null || !Number.isFinite(durationDays) ? null : durationDays,
    scheduleNote: emptyToNull(form.scheduleNote),
    deliverables: developQuoteDeliverableLines(form),
    exclusions: emptyToNull(form.exclusions),
    terms: form.terms.trim(),
    warrantyDays: warrantyDays === null || !Number.isFinite(warrantyDays) ? null : warrantyDays,
    reviewDays: reviewDays === null || !Number.isFinite(reviewDays) ? 7 : reviewDays,
    validUntil: form.validUntil,
    note: emptyToNull(form.note),
    internalNote: emptyToNull(form.internalNote),
    items: form.items.map((it) => ({
      title: it.title.trim(),
      description: emptyToNull(it.description),
      amount: Math.round(parseAmountInput(it.amount)),
      durationDays: (() => {
        const days = parseIntOrNull(it.durationDays);
        return days === null || !Number.isFinite(days) ? null : days;
      })(),
    })),
    milestones: form.milestones.map((m) => ({
      title: m.title.trim(),
      ratioBp: ratioBpOfRow(m),
      trigger: m.trigger,
      unlocksDeliverables: m.unlocksDeliverables,
    })),
  };
}

/**
 * 새 견적의 기본 종류 — 착수 전이면 첫 견적(이미 나간 견적이 있으면 수정 견적), 착수 뒤면 추가 견적.
 * 서버가 같은 규칙으로 409 KIND_MISMATCH 를 낸다(admin-develop-quotes.ts).
 */
export function defaultDevelopQuoteKind(
  status: string,
  quotes: readonly { status: string; kind: DevelopQuoteKindType }[],
): DevelopQuoteKindType {
  const beforeStart = status === 'received' || status === 'reviewing' || status === 'quoted';
  if (!beforeStart) return 'change';
  const hasOpened = quotes.some(
    (q) => q.kind !== 'change' && (q.status === 'sent' || q.status === 'superseded' || q.status === 'withdrawn' || q.status === 'declined' || q.status === 'expired'),
  );
  return hasOpened ? 'revision' : 'initial';
}
