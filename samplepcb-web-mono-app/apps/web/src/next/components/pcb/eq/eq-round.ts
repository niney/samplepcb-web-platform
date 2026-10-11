import {
  PCB_EQ_ANSWER_CHANNEL_LABELS,
  type AdminPcbEqDraftUpdateBodyType,
  type AdminPcbEqReviewViewType,
  type PcbEqAiFlagType,
  type PcbEqCommentTranslationType,
  type PcbEqItemAnswerType,
  type PcbEqItemCategoryType,
  type PcbEqItemChangeType,
  type PcbEqPrevItemType,
} from '@sp/api-contract';
import { fmtKstDate, kstDateInput, kstToday } from '@sp/utils';
import { pcbEqRoundStateLabel, type PcbEqRoundDisplay } from '@/lib/pcb-eq-review';
import type { BadgeVariant } from '@/next/components/common/badge-types';
import { EQ_ROUND_VARIANT } from '@/next/components/pcb/pos/pos-badges';

// EQ 문항형 회차(D20) 작업공간의 순수 규칙 — 편집 모형(초안 ↔ 저장 몸통)·검증·표시.
// 화면 컴포넌트는 그리기만 한다. 저장은 **초안 통째 교체**(서버 saveEqDraft)라 편집 모형도 회차 하나를
// 통째로 들고, 마지막으로 서버와 맞춘 몸통(snapshot)과 비교해 "저장 안 된 변경"을 판정한다.

export interface EqOptionDraft {
  uid: string;
  /** 공장 원문 기호 그대로(A/B/C) — 협력사는 회신을 이 기호로 읽는다. */
  key: string;
  label: string;
  labelOrig: string;
  recommended: boolean;
  requiresComment: boolean;
}

export interface EqFigureDraft {
  fileId: number;
  name: string;
  size: number;
  shared: boolean;
}

export interface EqItemDraft {
  uid: string;
  /** 서버 문항 id — 새로 만든 문항은 null(저장하면 생긴다). */
  id: number | null;
  factoryNo: string;
  category: PcbEqItemCategoryType;
  question: string;
  questionOrig: string;
  options: EqOptionDraft[];
  figures: EqFigureDraft[];
  prevItemId: number | null;
  change: PcbEqItemChangeType | null;
  /** 직전 회차 문항과 그 답(서버가 붙여 준 읽기 전용) — 연결을 손으로 바꾸면 화면이 직전 회차 목록에서 다시 찾는다. */
  prev: PcbEqPrevItemType | null;
  /** 고객(또는 대리) 답 — 발송 뒤 회차의 읽기 전용 표시. */
  answer: PcbEqItemAnswerType | null;
  /** 고객 의견의 번역(D20 P4) — 서버 값 그대로(편집은 문항 저장이 아니라 전용 라우트로 한다). */
  commentI18n: PcbEqCommentTranslationType | null;
  /**
   * AI 초안의 검토 표시(D20 P2) — 관리자가 [확인함]으로 하나씩 지운다. ⚠ 저장 몸통에 **남은 표시를 항상** 싣는다:
   * 서버는 안 실린 표시를 지워진 것으로 본다(계약 AdminPcbEqItemInput.aiFlags 기본 []).
   */
  aiFlags: PcbEqAiFlagType[];
}

export interface EqRoundDraft {
  reviewId: number;
  poId: number;
  /** 이 편집이 출발한 서버 버전 — 저장·발송의 expectedVersion. */
  baseVersion: number;
  message: string;
  /** 'YYYY-MM-DD' 또는 '' */
  dueOn: string;
  items: EqItemDraft[];
  /** 마지막으로 서버와 맞춘 몸통(JSON) — 지금 몸통과 다르면 저장 안 된 변경이다. */
  snapshot: string;
}

let uidSeq = 0;
const nextUid = (prefix: string): string => {
  uidSeq += 1;
  return `${prefix}${String(uidSeq)}`;
};

const OPTION_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'] as const;
/** 선택지는 문항당 8개까지(계약 PcbEqDraftItem.options.max). */
export const EQ_OPTION_MAX = 8;
/** 문항은 회차당 60개까지(계약 AdminPcbEqDraftUpdateBody.items.max). */
export const EQ_ITEM_MAX = 60;
/** 그림은 문항당 10장까지(계약 AdminPcbEqItemInput.figures.max). */
export const EQ_FIGURE_MAX = 10;

/** 비어 있는 다음 기호 — A, B, C… 순서로 아직 안 쓴 것. */
export const nextOptionKey = (options: readonly EqOptionDraft[]): string =>
  OPTION_KEYS.find((key) => !options.some((o) => o.key.trim().toUpperCase() === key)) ?? '';

export const newOption = (options: readonly EqOptionDraft[]): EqOptionDraft => ({
  uid: nextUid('o'),
  key: nextOptionKey(options),
  label: '',
  labelOrig: '',
  recommended: false,
  requiresComment: false,
});

/** 새 문항 — 공장 표는 대개 A·B 두 선택지다. 개정 회차(직전 회차가 있음)의 새 문항은 '신규'로 시작한다. */
export const newItem = (hasPrevRound: boolean): EqItemDraft => {
  const first = newOption([]);
  return {
    uid: nextUid('i'),
    id: null,
    factoryNo: '',
    category: 'other',
    question: '',
    questionOrig: '',
    options: [first, newOption([first])],
    figures: [],
    prevItemId: null,
    change: hasPrevRound ? 'new' : null,
    prev: null,
    answer: null,
    commentI18n: null,
    aiFlags: [],
  };
};

const trimOrNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

/** 저장 몸통(버전 제외) — snapshot 비교와 PUT 이 같은 함수를 쓴다(둘이 갈리면 dirty 판정이 거짓말을 한다). */
function bodyOf(draft: Pick<EqRoundDraft, 'message' | 'dueOn' | 'items'>): Omit<AdminPcbEqDraftUpdateBodyType, 'expectedVersion'> {
  return {
    message: draft.message.trim(),
    dueOn: draft.dueOn === '' ? null : draft.dueOn,
    items: draft.items.map((item) => ({
      ...(item.id === null ? {} : { id: item.id }),
      factoryNo: trimOrNull(item.factoryNo),
      category: item.category,
      question: item.question.trim(),
      questionOrig: trimOrNull(item.questionOrig),
      options: item.options.map((o) => ({
        key: o.key.trim(),
        label: o.label.trim(),
        labelOrig: trimOrNull(o.labelOrig),
        recommended: o.recommended,
        requiresComment: o.requiresComment,
      })),
      figures: item.figures.map((f) => ({ fileId: f.fileId, shared: f.shared })),
      prevItemId: item.prevItemId,
      change: item.change,
      aiFlags: item.aiFlags.map((f) => ({ code: f.code, detail: f.detail })),
    })),
  };
}

export const draftBody = (draft: EqRoundDraft): AdminPcbEqDraftUpdateBodyType => ({
  expectedVersion: draft.baseVersion,
  ...bodyOf(draft),
});

export const draftContentKey = (draft: Pick<EqRoundDraft, 'message' | 'dueOn' | 'items'>): string =>
  JSON.stringify(bodyOf(draft));

export const isDraftDirty = (draft: EqRoundDraft): boolean => draftContentKey(draft) !== draft.snapshot;

/** 서버 회차 → 편집 모형. 발송 뒤 회차도 같은 모형으로 읽기 전용 표시에 쓴다. */
export function draftFromView(view: AdminPcbEqReviewViewType): EqRoundDraft {
  const items: EqItemDraft[] = view.items.map((item) => ({
    uid: `i${String(item.id)}`,
    id: item.id,
    factoryNo: item.factoryNo ?? '',
    category: item.category,
    question: item.question,
    questionOrig: item.questionOrig ?? '',
    options: item.options.map((o) => ({
      uid: nextUid('o'),
      key: o.key,
      label: o.label,
      labelOrig: o.labelOrig ?? '',
      recommended: o.recommended,
      requiresComment: o.requiresComment,
    })),
    figures: item.figures.map((f) => ({ ...f })),
    prevItemId: item.prevItemId,
    change: item.change,
    prev: item.prev,
    answer: item.answer,
    commentI18n: item.commentI18n,
    aiFlags: item.aiFlags.map((f) => ({ code: f.code, detail: f.detail })),
  }));
  const base = { message: view.message, dueOn: kstDateInput(view.dueOn), items };
  return {
    reviewId: view.id,
    poId: view.poId,
    baseVersion: view.version,
    ...base,
    snapshot: draftContentKey(base),
  };
}

/** 화면·메일의 문항 번호 — 공장 원문 번호가 있으면 그것(서버 eqItemNo 와 같은 규칙), 없으면 순번. */
export const eqItemNoOf = (item: Pick<EqItemDraft, 'factoryNo'>, index: number): string =>
  item.factoryNo.trim() === '' ? String(index + 1) : item.factoryNo.trim();

/**
 * 저장할 수 있는 모양인가 — 계약 스키마(PcbEqDraftItem·PcbEqItemOption)와 서버 DUPLICATE_OPTION_KEY 의
 * 화면 미러. 서버가 400 으로 돌려보내기 전에 어느 문항의 무엇인지 말해 준다. null = 통과.
 */
export function draftSaveProblem(draft: EqRoundDraft): { itemIndex: number | null; message: string } | null {
  if (draft.items.length > EQ_ITEM_MAX) return { itemIndex: null, message: `문항은 ${String(EQ_ITEM_MAX)}개까지입니다.` };
  for (const [index, item] of draft.items.entries()) {
    const no = `문항 ${eqItemNoOf(item, index)}`;
    if (item.question.trim() === '') return { itemIndex: index, message: `${no}: 한국어 질문을 적으세요.` };
    if (item.options.length === 0) return { itemIndex: index, message: `${no}: 선택지를 하나 이상 두세요.` };
    const keys = new Set<string>();
    for (const option of item.options) {
      const key = option.key.trim();
      if (key === '' || key.length > 4) return { itemIndex: index, message: `${no}: 선택지 기호는 1~4자입니다(공장 원문 기호 그대로).` };
      if (keys.has(key)) return { itemIndex: index, message: `${no}: 선택지 기호 ${key} 가 겹칩니다.` };
      keys.add(key);
      if (option.label.trim() === '') return { itemIndex: index, message: `${no} · ${key}: 고객에게 보일 한국어 문구를 적으세요.` };
    }
  }
  return null;
}

/** 보낼 수 있는가 — 저장 가능 + 문항 ≥1(서버 NO_ITEMS). */
export function draftSendProblem(draft: EqRoundDraft): { itemIndex: number | null; message: string } | null {
  if (draft.items.length === 0) return { itemIndex: null, message: '문항을 하나 이상 만드세요.' };
  return draftSaveProblem(draft);
}

/** 확인 안 한 AI 표시 — 건수와 표시가 남은 문항 번호(발송 확인창의 경고. 막지는 않는다). */
export function openAiFlags(draft: Pick<EqRoundDraft, 'items'>): { count: number; itemNos: string[] } {
  const flagged = draft.items.flatMap((item, index) => (item.aiFlags.length > 0 ? [{ item, index }] : []));
  return {
    count: flagged.reduce((sum, { item }) => sum + item.aiFlags.length, 0),
    itemNos: flagged.map(({ item, index }) => eqItemNoOf(item, index)),
  };
}

/** 고객에게 공개되는 그림 수(발송 확인창). */
export const sharedFigureCount = (draft: EqRoundDraft): number =>
  draft.items.reduce((sum, item) => sum + item.figures.filter((f) => f.shared).length, 0);

// ── 회차 상태 배지(작업공간 머리·회차 전환) ────────────────────────────────────

export interface EqRoundBadge {
  label: string;
  variant: BadgeVariant;
  /** 배지 옆 보조 문구(기한·회신 경로 등) — 없으면 null. */
  detail: string | null;
}

/** 회차 표시 상태 — 행 칩(pcbEqRoundState)과 같은 칸에 요청 취소를 더한다. */
export const eqRoundDisplayOf = (view: AdminPcbEqReviewViewType): PcbEqRoundDisplay | 'canceled' => {
  if (view.status === 'draft') return view.aiDraft ? 'ai_draft' : 'draft';
  if (view.status === 'requested') return view.overdue ? 'overdue' : 'pending';
  if (view.status === 'answered') return view.forwardedAt === null ? 'needs_forward' : 'forwarded';
  return 'canceled';
};

/** 고객 회신 경로 — "고객 직접(웹)" · "대리 회신 · 전화". */
export const eqAnswerRouteLabel = (view: AdminPcbEqReviewViewType): string | null => {
  if (view.answeredRole === null) return null;
  if (view.answeredRole === 'customer') return PCB_EQ_ANSWER_CHANNEL_LABELS.web;
  return `대리 회신 · ${PCB_EQ_ANSWER_CHANNEL_LABELS[view.answerChannel ?? 'other']}`;
};

export function eqRoundBadge(view: AdminPcbEqReviewViewType, today: string = kstToday()): EqRoundBadge {
  const display = eqRoundDisplayOf(view);
  if (display === 'canceled') {
    const sent = view.events.some((e) => e.action === 'sent');
    return { label: '요청 취소', variant: 'secondary', detail: sent ? null : '고객에게 나가기 전에 닫힌 초안' };
  }
  const label = pcbEqRoundStateLabel(display, view, today);
  const due = view.dueOn === null ? '기한 없음' : `기한 ${fmtKstDate(view.dueOn)}`;
  const detail =
    display === 'pending' || display === 'overdue'
      ? due
      : display === 'needs_forward' || display === 'forwarded'
        ? [eqAnswerRouteLabel(view), `회신 ${fmtKstDate(view.decidedAt)}`].filter((part) => part !== null).join(' · ')
        : null;
  return { label, variant: EQ_ROUND_VARIANT[display], detail };
}

/** 문항 변화 배지 — 고객은 '변경'만 보면 되게, 관리자도 같은 색으로 본다(신규=진행·변경=주의·동일=중립). */
export const EQ_CHANGE_VARIANT: Record<PcbEqItemChangeType, BadgeVariant> = {
  new: 'info',
  changed: 'warning',
  same: 'secondary',
};

/**
 * 머리말을 비우면 고객에게 나가는 기본 안내문 — 서버 PCB_EQ_ITEMS_DEFAULT_MESSAGE(apps/api
 * lib/pcb-eq-items.ts)의 **미리보기 사본**이다(정본은 서버, 계약으로 올리면 이 사본을 지운다).
 */
export const EQ_DEFAULT_MESSAGE_PREVIEW =
  '제조 전에 확인이 필요한 항목이 있습니다. 항목마다 원하시는 처리 방법을 골라 회신해 주세요.';

/** 열린 회차(작성 중·회신 대기) — 발주서당 1개(서버 ALREADY_OPEN). 문구형도 센다. */
export const isOpenReview = (view: Pick<AdminPcbEqReviewViewType, 'status'>): boolean =>
  view.status === 'draft' || view.status === 'requested';
