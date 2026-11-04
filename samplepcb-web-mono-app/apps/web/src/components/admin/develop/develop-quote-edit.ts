import {
  DEVELOP_QUOTE_AMOUNT_MAX,
  DEVELOP_QUOTE_DEFAULT_UNIT,
  DEVELOP_QUOTE_EDITABLE_VAT_MODES,
  DEVELOP_QUOTE_QTY_MAX,
  DEVELOP_QUOTE_RATE_MAX_BP,
  computeDevelopQuoteBreakdown,
  computeDevelopQuoteMargin,
  developBpPercent,
  developQuoteItemAmount,
  splitDevelopMilestoneAmounts,
} from '@sp/api-contract';
import type {
  AdminDevelopQuoteBodyType,
  AdminDevelopQuoteViewType,
  AdminDevelopSettingsType,
  DevelopMilestoneTriggerType,
  DevelopQuoteBreakdown,
  DevelopQuoteItemCategoryType,
  DevelopQuoteItemViewType,
  DevelopQuoteKindType,
  DevelopQuoteMargin,
  DevelopQuoteRates,
  DevelopQuoteSheetQuote,
  DevelopVatModeType,
} from '@sp/api-contract';
import { kstToday } from '@sp/utils';

// 견적서 편집 폼 모델 — 화면은 문자열로 들고, 저장할 때만 계약(zod) 모양으로 바꾼다.
// 상한·필수는 계약 `AdminDevelopQuoteBody` 와 같아야 한다. 화면이 먼저 막지 않으면 POST/PATCH 가 400 이다.
// 금액은 정수(원). 입력은 콤마를 허용하고 저장 전에 숫자로 만든다.
// 2026-11-04 산출 내역(docs/DEVELOP_FLOW.md §5.1) — 항목 = 구분 × 단가 × 수량, 가산율 3칸(퍼센트로 들고 bp 로 보낸다).
// 금액·가산은 계약 computeDevelopQuoteBreakdown 이 서버와 같은 규칙으로 계산한다(미리보기 = 저장 결과).

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
  gradeLen: 50,
  unitLen: 20,
  recipientDeptLen: 100,
  vendorLen: 100,
  qtyMax: DEVELOP_QUOTE_QTY_MAX,
  ratePctMax: DEVELOP_QUOTE_RATE_MAX_BP / 100,
} as const;

export interface DevelopQuoteItemRow {
  category: DevelopQuoteItemCategoryType;
  title: string; // 직무(인건비) · 항목(직접비)
  grade: string; // 기술등급(인건비)
  description: string; // 담당업무 · 규격
  unitPrice: string;
  qty: string | number; // type="number" 입력은 Vue 가 number 로 캐스팅
  unit: string;
  durationDays: string | number; // 옛 항목별 기간 — 새 편집기는 안 보이고 받은 값을 그대로 돌려보낸다
  costPrice: string; // 내부 원가 단가(관리자 전용, 비우면 미입력)
  vendor: string; // 내부 원가 업체명
}

export interface DevelopQuoteMilestoneRow {
  title: string;
  percent: string | number; // type="number" 입력은 Vue 가 number 로 캐스팅
  trigger: DevelopMilestoneTriggerType;
  unlocksDeliverables: boolean;
}

export interface DevelopQuoteForm {
  kind: DevelopQuoteKindType;
  title: string;
  vatMode: DevelopVatModeType;
  indirectPct: string | number; // 간접비 %
  overheadPct: string | number; // 제경비(일반관리비) %
  profitPct: string | number; // 기업이윤 %
  recipientDept: string; // 견적서 수신 부서
  durationDays: string | number; // type="number" 입력은 Vue 가 number 로 캐스팅
  scheduleNote: string;
  deliverables: string; // 줄 단위
  exclusions: string;
  terms: string;
  warrantyDays: string | number;
  reviewDays: string | number;
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

/** `type="number"` v-model 은 Vue 가 값을 number 로 캐스팅하므로 문자열·숫자 둘 다 받는다. */
const parseIntOrNull = (raw: string | number): number | null => {
  const trimmed = String(raw).trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n) : Number.NaN;
};

export const emptyQuoteItemRow = (category: DevelopQuoteItemCategoryType = 'labor'): DevelopQuoteItemRow => ({
  category,
  title: '',
  grade: '',
  description: '',
  unitPrice: '',
  qty: '1',
  unit: DEVELOP_QUOTE_DEFAULT_UNIT[category],
  durationDays: '',
  costPrice: '',
  vendor: '',
});

/** 수량 입력 → 숫자(소수 둘째 자리까지). 비었거나 읽을 수 없으면 NaN. */
export function parseQtyInput(raw: string | number): number {
  const trimmed = String(raw).replace(/,/g, '').trim();
  if (trimmed === '') return Number.NaN;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}
const qtyHasTwoDecimals = (n: number): boolean => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;

/** 원가 단가 입력 → 숫자. 비면 null(미입력), 읽을 수 없으면 NaN. */
export function parseCostInput(raw: string): number | null {
  if (raw.trim() === '') return null;
  return parseAmountInput(raw);
}

/** 퍼센트 입력 → bp. 비면 0, 읽을 수 없으면 NaN. */
export function pctToBp(raw: string | number): number {
  const trimmed = String(raw).replace(/[%\s]/g, '');
  if (trimmed === '') return 0;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}
const bpToPct = (bp: number): string => developBpPercent(bp);

/** 행 금액 = 단가 × 수량(계약 함수) — 입력이 비면 0. */
export function developQuoteRowAmount(row: DevelopQuoteItemRow): number {
  const price = parseAmountInput(row.unitPrice);
  const qty = parseQtyInput(row.qty);
  if (!Number.isFinite(price) || !Number.isFinite(qty)) return 0;
  return developQuoteItemAmount(price, qty);
}

export function developQuoteRates(form: DevelopQuoteForm): DevelopQuoteRates {
  const safe = (bp: number): number => (Number.isFinite(bp) ? Math.max(0, bp) : 0);
  return {
    indirectBp: safe(pctToBp(form.indirectPct)),
    overheadBp: safe(pctToBp(form.overheadPct)),
    profitBp: safe(pctToBp(form.profitPct)),
  };
}

// 편집기 VAT 선택지 — '포함'은 산출 내역 서식과 맞지 않아 뺐다(계약 DEVELOP_QUOTE_EDITABLE_VAT_MODES).
// 옛 초안이 '포함'이면 그 값은 선택지에 남겨 둔다(조용히 바꾸지 않는다).
export const developQuoteVatOptions = (current: DevelopVatModeType): DevelopVatModeType[] =>
  (DEVELOP_QUOTE_EDITABLE_VAT_MODES as readonly DevelopVatModeType[]).includes(current)
    ? [...DEVELOP_QUOTE_EDITABLE_VAT_MODES]
    : [...DEVELOP_QUOTE_EDITABLE_VAT_MODES, current];

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
    vatMode: settings.defaultVatMode === 'included' ? 'separate' : settings.defaultVatMode,
    indirectPct: bpToPct(settings.defaultIndirectBp),
    overheadPct: bpToPct(settings.defaultOverheadBp),
    profitPct: bpToPct(settings.defaultProfitBp),
    recipientDept: '',
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
export function developQuoteFormFrom(quote: AdminDevelopQuoteViewType): DevelopQuoteForm {
  return {
    kind: quote.kind,
    title: quote.title,
    vatMode: quote.vatMode,
    indirectPct: bpToPct(quote.indirectBp),
    overheadPct: bpToPct(quote.overheadBp),
    profitPct: bpToPct(quote.profitBp),
    recipientDept: quote.recipientDept ?? '',
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
      category: it.category,
      title: it.title,
      grade: it.grade ?? '',
      description: it.description ?? '',
      unitPrice: it.unitPrice.toLocaleString('ko-KR'),
      qty: String(it.qty),
      unit: it.unit,
      durationDays: it.durationDays === null ? '' : String(it.durationDays),
      costPrice: it.costPrice === null ? '' : it.costPrice.toLocaleString('ko-KR'),
      vendor: it.vendor ?? '',
    })),
    milestones: quote.milestones.map((m) => ({
      title: m.title,
      percent: String((m.ratioBp ?? 0) / 100),
      trigger: m.trigger,
      unlocksDeliverables: m.unlocksDeliverables,
    })),
  };
}

export const developQuoteItemAmounts = (form: DevelopQuoteForm): number[] => form.items.map((it) => developQuoteRowAmount(it));

/** 줄 원가 금액 = 원가 단가 × 수량(항목 금액과 같은 계약 함수) — 미입력이면 null. */
export function developQuoteRowCost(row: DevelopQuoteItemRow): number | null {
  const cost = parseCostInput(row.costPrice);
  const qty = parseQtyInput(row.qty);
  if (cost === null || !Number.isFinite(cost) || !Number.isFinite(qty)) return null;
  return developQuoteItemAmount(cost, qty);
}

/** 내부 원가·마진(관리자 전용) — 서버 응답으로 그릴 때와 같은 계약 함수. */
export function developQuoteMarginOf(form: DevelopQuoteForm): DevelopQuoteMargin {
  return computeDevelopQuoteMargin(
    form.items.map((it) => {
      const cost = parseCostInput(it.costPrice);
      const qty = parseQtyInput(it.qty);
      return {
        amount: developQuoteRowAmount(it),
        qty: Number.isFinite(qty) ? qty : 0,
        costPrice: cost === null || !Number.isFinite(cost) ? null : Math.round(cost),
      };
    }),
    developQuoteAmounts(form).supplyAmount,
  );
}

/** 마진율 표기 — 0.1234 → '12.3%'. */
export const marginRateText = (rate: number | null): string => (rate === null ? '—' : `${(Math.round(rate * 1000) / 10).toFixed(1)}%`);

/** 산출 내역(소계·가산·공급가·VAT·합계) — 서버 저장 결과와 같은 계약 함수. */
export const developQuoteAmounts = (form: DevelopQuoteForm): DevelopQuoteBreakdown =>
  computeDevelopQuoteBreakdown(
    form.items.map((it) => ({ category: it.category, amount: developQuoteRowAmount(it) })),
    developQuoteRates(form),
    form.vatMode,
  );

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
    if (it.title.trim() === '') issues.push(`${row}번 항목의 ${it.category === 'labor' ? '직무' : '항목명'}을 채워 주세요`);
    const price = parseAmountInput(it.unitPrice);
    if (!Number.isFinite(price) || price < 0 || price > DEVELOP_QUOTE_LIMITS.itemAmountMax) {
      issues.push(`${row}번 항목의 단가를 숫자로 채워 주세요`);
    }
    const qty = parseQtyInput(it.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > DEVELOP_QUOTE_LIMITS.qtyMax || !qtyHasTwoDecimals(qty)) {
      issues.push(`${row}번 항목의 수량은 0보다 크게, 소수 둘째 자리까지 적어 주세요`);
    }
    if (it.unit.trim() === '' || it.unit.trim().length > DEVELOP_QUOTE_LIMITS.unitLen) issues.push(`${row}번 항목의 단위를 적어 주세요`);
    if (it.grade.trim().length > DEVELOP_QUOTE_LIMITS.gradeLen) issues.push(`${row}번 항목의 기술등급은 50자까지입니다`);
    if (developQuoteRowAmount(it) > DEVELOP_QUOTE_AMOUNT_MAX) issues.push(`${row}번 항목의 금액(단가 × 수량)이 너무 큽니다`);
    const cost = parseCostInput(it.costPrice);
    if (cost !== null && (!Number.isFinite(cost) || cost < 0 || cost > DEVELOP_QUOTE_LIMITS.itemAmountMax)) {
      issues.push(`${row}번 항목의 원가 단가를 숫자로 적거나 비워 주세요`);
    }
    if (it.vendor.trim().length > DEVELOP_QUOTE_LIMITS.vendorLen) issues.push(`${row}번 항목의 업체명은 100자까지입니다`);
    const days = parseIntOrNull(it.durationDays);
    if (days !== null && (!Number.isFinite(days) || days < 1 || days > DEVELOP_QUOTE_LIMITS.durationDaysMax)) {
      issues.push(`${row}번 항목의 기간은 1~3650일 사이로 적어 주세요`);
    }
  });
  const rateFields: [string, string | number][] = [
    ['간접비', form.indirectPct],
    ['제경비', form.overheadPct],
    ['기업이윤', form.profitPct],
  ];
  for (const [label, raw] of rateFields) {
    const bp = pctToBp(raw);
    if (!Number.isFinite(bp) || bp < 0 || bp > DEVELOP_QUOTE_RATE_MAX_BP) {
      issues.push(`${label} 비율은 0~${String(DEVELOP_QUOTE_LIMITS.ratePctMax)}% 사이로 적어 주세요`);
    }
  }
  if (form.recipientDept.trim().length > DEVELOP_QUOTE_LIMITS.recipientDeptLen) issues.push('수신 부서는 100자까지입니다');
  if (developQuoteAmounts(form).totalAmount > DEVELOP_QUOTE_AMOUNT_MAX) issues.push('최종 견적 합계가 너무 큽니다(20억 원까지)');

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
  const rates = developQuoteRates(form);
  return {
    kind: form.kind,
    title: form.title.trim(),
    vatMode: form.vatMode,
    indirectBp: rates.indirectBp,
    overheadBp: rates.overheadBp,
    profitBp: rates.profitBp,
    recipientDept: emptyToNull(form.recipientDept),
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
      category: it.category,
      title: it.title.trim(),
      grade: it.category === 'labor' ? emptyToNull(it.grade) : null,
      description: emptyToNull(it.description),
      unitPrice: Math.round(parseAmountInput(it.unitPrice)),
      qty: Math.round(parseQtyInput(it.qty) * 100) / 100,
      unit: it.unit.trim(),
      amount: developQuoteRowAmount(it),
      durationDays: (() => {
        const days = parseIntOrNull(it.durationDays);
        return days === null || !Number.isFinite(days) ? null : days;
      })(),
      costPrice: (() => {
        const cost = parseCostInput(it.costPrice);
        return cost === null || !Number.isFinite(cost) ? null : Math.round(cost);
      })(),
      vendor: emptyToNull(it.vendor),
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

/**
 * 견적서 미리보기용 — 폼을 인쇄 시트(@sp/ui DevelopQuoteSheet)가 받는 모양으로 바꾼다. 금액은 저장 결과와 같은 계약 함수.
 * 입력이 덜 찬 행도 그대로 보인다(0원) — 관리자가 종이 모양을 보면서 채우게.
 */
export function developQuotePreview(form: DevelopQuoteForm): DevelopQuoteSheetQuote {
  const b = developQuoteAmounts(form);
  const rates = developQuoteRates(form);
  const durationDays = parseIntOrNull(form.durationDays);
  const emptyToNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());
  const items: DevelopQuoteItemViewType[] = form.items.map((it, i) => {
    const qty = parseQtyInput(it.qty);
    const price = parseAmountInput(it.unitPrice);
    return {
      itemId: i + 1,
      seq: i + 1,
      category: it.category,
      title: it.title.trim(),
      grade: it.category === 'labor' ? emptyToNull(it.grade) : null,
      description: emptyToNull(it.description),
      unitPrice: Number.isFinite(price) ? Math.round(price) : 0,
      qty: Number.isFinite(qty) ? qty : 0,
      unit: it.unit.trim(),
      amount: developQuoteRowAmount(it),
      durationDays: null,
    };
  });
  return {
    title: form.title.trim(),
    vatMode: form.vatMode,
    items,
    ...rates,
    breakdown: {
      laborSubtotal: b.laborSubtotal,
      directSubtotal: b.directSubtotal,
      indirectAmount: b.indirectAmount,
      overheadAmount: b.overheadAmount,
      profitAmount: b.profitAmount,
    },
    supplyAmount: b.supplyAmount,
    vatAmount: b.vatAmount,
    totalAmount: b.totalAmount,
    durationDays: durationDays === null || !Number.isFinite(durationDays) ? null : durationDays,
    scheduleNote: emptyToNull(form.scheduleNote),
    validUntil: form.validUntil,
    note: emptyToNull(form.note),
    milestones: form.milestones.map((m) => ({
      title: m.title.trim(),
      ratioBp: Number.isFinite(ratioBpOfRow(m)) ? ratioBpOfRow(m) : null,
      trigger: m.trigger,
    })),
  };
}
