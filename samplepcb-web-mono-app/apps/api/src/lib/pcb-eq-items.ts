import type { SpFile, SpPcbEqReviewEvent, SpPcbEqReviewItem } from '@prisma/client';
import type { z } from 'zod';
import {
  PCB_EQ_ANSWER_CHANNELS,
  PCB_EQ_ITEM_CATEGORIES,
  PCB_EQ_ITEM_CHANGES,
  PCB_EQ_REVIEW_EVENT_ACTIONS,
  PcbEqAiFlag,
  PcbEqCommentTranslation,
  PcbEqItemOption,
} from '@sp/api-contract';
import type {
  AdminPcbEqItemInput,
  AdminPcbEqItemType,
  CustomerPcbEqItemType,
  PartnerPcbEqItemType,
  PcbEqAiFlagType,
  PcbEqAnswerChannelType,
  PcbEqAnswerInputType,
  PcbEqCommentTranslationType,
  PcbEqItemAnswerType,
  PcbEqItemCategoryType,
  PcbEqItemChangeType,
  PcbEqItemFigureType,
  PcbEqItemOptionType,
  PcbEqPrevItemType,
  PcbEqReviewEventType,
} from '@sp/api-contract';

// ── D20 문항형 회차 — 순수 규칙(뷰 조립·답 검증·회차 번호·개정 연결) ─────────
// 정본 docs/PCB_PARTNER_TRACK.md D20. DB 는 만지지 않는다 — pcb-eq-review.ts 가 읽어 온 행을
// 넘기고 판정·조립은 여기서 한다(규칙을 DB 없이 단위 테스트로 박제하려고).

/** 문항 그림의 sp_file 규약 — 협력사 EQ 첨부(sp_pcb_po_eq)와 섞지 않는다(포털 첨부 칸에 끼지 않게). */
export const EQ_FIGURE_REF_TYPE = 'sp_pcb_eq_review';
export const EQ_FIGURE_FILE_TYPE = 'figure';
export const EQ_FIGURE_MAX_BYTES = 10 * 1024 * 1024;

/** 문항형 고객 화면의 머리말 기본값 — 관리자가 비워 두면(대개 그렇다) 이 문장이 나간다. */
export const PCB_EQ_ITEMS_DEFAULT_MESSAGE =
  '제조 전에 확인이 필요한 항목이 있습니다. 항목마다 원하시는 처리 방법을 골라 회신해 주세요.';

const includesStr = <T extends string>(list: readonly T[], v: string): v is T =>
  (list as readonly string[]).includes(v);

export const asEqItemCategory = (v: string): PcbEqItemCategoryType =>
  includesStr(PCB_EQ_ITEM_CATEGORIES, v) ? v : 'other';

export const asEqItemChange = (v: string | null): PcbEqItemChangeType | null =>
  v !== null && includesStr(PCB_EQ_ITEM_CHANGES, v) ? v : null;

export const asEqAnswerChannel = (v: string | null): PcbEqAnswerChannelType | null =>
  v !== null && includesStr(PCB_EQ_ANSWER_CHANNELS, v) ? v : null;

/** 선택지(Json) — 깨진 원소는 버린다(화면이 죽지 않게, parseSharedFileIds 와 같은 방어). */
export const parseEqItemOptions = (json: unknown): PcbEqItemOptionType[] => {
  if (!Array.isArray(json)) return [];
  const out: PcbEqItemOptionType[] = [];
  for (const raw of json) {
    const parsed = PcbEqItemOption.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
};

/** AI 검토 표시(Json) — 깨진 원소는 버린다. 고객·협력사 뷰에는 싣지 않는다(관리자 전용). */
export const parseEqAiFlags = (json: unknown): PcbEqAiFlagType[] => {
  if (!Array.isArray(json)) return [];
  const out: PcbEqAiFlagType[] = [];
  for (const raw of json) {
    const parsed = PcbEqAiFlag.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
};

export interface EqFigureRef {
  fileId: bigint;
  shared: boolean;
}

/** 문항 그림(Json [{fileId, shared}]) → 참조 목록. */
export const parseEqItemFigures = (json: unknown): EqFigureRef[] => {
  if (!Array.isArray(json)) return [];
  const out: EqFigureRef[] = [];
  for (const raw of json) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const id = r.fileId;
    const fileId =
      typeof id === 'number' && Number.isInteger(id) && id > 0
        ? BigInt(id)
        : typeof id === 'string' && /^\d+$/.test(id)
          ? BigInt(id)
          : null;
    if (fileId === null) continue;
    out.push({ fileId, shared: r.shared === true });
  }
  return out;
};

export const toEqFiguresJson = (refs: readonly EqFigureRef[]): { fileId: number; shared: boolean }[] =>
  refs.map((r) => ({ fileId: Number(r.fileId), shared: r.shared }));

/** 화면·메일의 문항 번호 — 공장 원문 번호가 있으면 그것(협력사가 그 번호로 읽는다), 없으면 순번. */
export const eqItemNo = (item: Pick<SpPcbEqReviewItem, 'factoryNo' | 'seq'>): string =>
  item.factoryNo !== null && item.factoryNo !== '' ? item.factoryNo : String(item.seq + 1);

const answerOf = (row: Pick<SpPcbEqReviewItem, 'answerKey' | 'answerComment'>): PcbEqItemAnswerType | null =>
  row.answerKey === null ? null : { key: row.answerKey, comment: row.answerComment };

/** 고객 의견의 번역(D20 P4) — 의견이 없는 문항이거나 저장된 모양이 깨졌으면 없는 것으로(화면은 원문만 보인다). */
export const parseEqCommentI18n = (
  row: Pick<SpPcbEqReviewItem, 'answerComment' | 'answerCommentI18n'>,
): PcbEqCommentTranslationType | null => {
  if (row.answerComment === null || row.answerComment.trim() === '') return null;
  const parsed = PcbEqCommentTranslation.safeParse(row.answerCommentI18n);
  return parsed.success ? parsed.data : null;
};

/** 고른 선택지의 한국어 문구 — 사라진 기호(선택지가 고쳐진 뒤)면 null. */
export const eqAnswerLabel = (options: readonly PcbEqItemOptionType[], key: string | null): string | null =>
  key === null ? null : (options.find((o) => o.key === key)?.label ?? null);

// ── 회차 번호·고객 노출 ──────────────────────────────────────────────────────

export interface EqRoundCandidate {
  id: bigint;
  /** 회차 번호는 **발주서마다** 1부터 센다 — 여러 발주서의 회차를 한 번에 넘겨도 섞이지 않게. */
  poId: bigint;
  format: string;
  status: string;
  /** 고객에게 발송된 적이 있다(이벤트 'sent'). */
  sent: boolean;
}

/**
 * 고객이 이 회차를 볼 수 있는가. draft 는 절대 안 보이고, **한 번도 안 나간 채 닫힌 초안**
 * (작성 중에 EQ 가 움직여 자동 취소된 것)도 안 보인다 — 고객 목록에 "요청 취소" 줄이 뜨면
 * 받은 적 없는 요청이 취소됐다고 읽힌다. 문구형(D16)은 예전처럼 취소 이력까지 보인다.
 */
export const isEqReviewCustomerVisible = (r: Pick<EqRoundCandidate, 'format' | 'status' | 'sent'>): boolean =>
  r.status !== 'draft' && (r.format !== 'items' || r.status !== 'canceled' || r.sent);

/**
 * 회차 번호(저장하지 않고 파생) — 발주서의 문항형 회차를 id 순으로 센다. 단 **안 나간 채 닫힌
 * 초안은 세지 않는다**(번호 없음): 고객은 그 회차를 본 적이 없어 "2차"부터 보게 되고, 관리자
 * 화면과 고객 화면의 번호가 갈린다. 열린 초안은 언제나 가장 최근 행이라(발주서당 열린 회차 1개)
 * 지금 받는 번호가 발송 뒤에도 그대로다.
 */
export const eqRoundNumbers = (rows: readonly EqRoundCandidate[]): Map<string, number> => {
  const counted = rows
    .filter((r) => r.format === 'items' && (r.status === 'draft' || isEqReviewCustomerVisible(r)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const out = new Map<string, number>();
  // 발주서별로 센다 — 목록(워크큐·마이페이지)은 여러 발주서의 회차를 한 번에 넘긴다. 통째로 세면 남의
  // 발주서 회차가 번호를 밀어 올린다(고객 화면에 "5차 확인"이 뜬 실측, 2026-10-11).
  const perPo = new Map<string, number>();
  for (const r of counted) {
    const po = r.poId.toString();
    const no = (perPo.get(po) ?? 0) + 1;
    perPo.set(po, no);
    out.set(r.id.toString(), no);
  }
  return out;
};

/**
 * 발주서별 **번호가 붙은** 문항형 회차 수(key=poId) — 관리자 작업공간의 탭 수(roundNo !== null)와 같다.
 * 번호 규칙(eqRoundNumbers)에서 그대로 파생한다: 안 나간 채 닫힌 초안은 번호가 없으니 여기서도 빠진다.
 */
export const countEqNumberedRounds = (rows: readonly EqRoundCandidate[]): Map<string, number> => {
  const numbered = eqRoundNumbers(rows);
  const out = new Map<string, number>();
  for (const r of rows) {
    if (!numbered.has(r.id.toString())) continue;
    const po = r.poId.toString();
    out.set(po, (out.get(po) ?? 0) + 1);
  }
  return out;
};

// ── 개정 회차 연결(fromPrevious) ─────────────────────────────────────────────

/**
 * 직전 회차 문항을 복사할 때의 연결. 복사원이 **고객에게 나간 회차**면 그 문항에 잇고
 * change='same'. 복사원이 **안 나간 채 닫힌 초안**이면 그 초안을 건너뛰어 초안이 잇고 있던
 * 문항(=고객이 마지막으로 본 회차)에 잇는다 — 관리자의 번역·편집은 살리되, 고객 화면의
 * '동일' 배지와 이전 답 미리 채우기가 본 적 없는 회차를 가리키지 않게.
 */
export const planEqItemCopyLink = (
  src: Pick<SpPcbEqReviewItem, 'id' | 'prevItemId' | 'change'>,
  sourceSent: boolean,
): { prevItemId: bigint | null; change: PcbEqItemChangeType | null } =>
  sourceSent
    ? { prevItemId: src.id, change: 'same' }
    : { prevItemId: src.prevItemId, change: asEqItemChange(src.change) };

// ── 개정 회차 대조(D20 P2 — AI 초안) ─────────────────────────────────────────
// 공장이 개정 EQ 를 내면 새 초안의 문항을 **고객이 마지막으로 본 회차**와 견줘 동일·변경·신규를 붙인다.
// LLM 에게 묻지 않는다 — 공장 번호와 원문만으로 결정적으로 낸다(같은 입력이면 늘 같은 답, 프로빙 §9).
// '동일'은 고객 화면에서 **이전 답을 미리 골라 준다** — 그래서 가장 엄격하다(원문·선택지가 정규화 후 완전히 같을 때만).

export interface EqRevisionSide {
  factoryNo: string | null;
  questionOrig: string | null;
  options: readonly Pick<PcbEqItemOptionType, 'key' | 'label' | 'labelOrig'>[];
}

export interface EqRevisionLink {
  /** 이어진 직전 회차 문항의 **배열 위치**(prev 인자 기준) — 신규면 null. */
  prevIndex: number | null;
  change: PcbEqItemChangeType;
}

/** 번호만 같고 내용은 딴 문항인 경우를 거르는 문턱 — 이보다 안 닮았으면 번호를 물려받은 새 문항으로 본다. */
export const EQ_REVISION_SAME_NO_MIN_SIMILARITY = 0.4;
/** 번호가 안 맞는 문항끼리 '변경'으로 이으려면 이만큼은 닮아야 한다(오탈자 수정·문구 손질 수준). */
export const EQ_REVISION_CROSS_NO_MIN_SIMILARITY = 0.8;

/**
 * 원문 비교용 정규화 — 전각·반각(NFKC), 대소문자, 공백·구두점 차이를 지운다. 단 **숫자 사이의 소수점·
 * 쉼표와 숫자 앞 음수 부호는 남긴다**: "1.5mm" 와 "15mm" 가 같아지면 다른 치수를 '동일'로 잇는다.
 * 수학 기호(±·<·≥)는 구두점이 아니라 그대로 남는다.
 */
export const normalizeEqOrigText = (text: string): string =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/(?<=\d)\.(?=\d)/g, '\u0001')
    .replace(/(?<=\d),(?=\d)/g, '\u0002')
    .replace(/(?<![\p{L}\p{N}])-(?=\d)/gu, '\u0003')
    .replace(/[\s\p{P}]+/gu, '')
    .replaceAll('\u0001', '.')
    .replaceAll('\u0002', ',')
    .replaceAll('\u0003', '-');

/** 공장 번호 정규화 — '1'·'1.0'·'01'·'(1)'·'1.' 을 같은 번호로. 비면 null. */
export const normalizeEqFactoryNo = (no: string | null): string | null => {
  const v = (no ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^[#(（\s]+|[.)）、\s]+$/g, '')
    .replace(/\.0+$/, '')
    .replace(/^0+(?=\d)/, '')
    .toUpperCase();
  return v === '' ? null : v;
};

/** 글자 2-gram Dice 계수(0~1) — 중국어·한국어처럼 띄어쓰기 없는 원문에서도 "얼마나 같은 문장인가"를 잰다. */
export const eqTextSimilarity = (a: string, b: string): number => {
  if (a === b) return a === '' ? 0 : 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let overlap = 0;
  for (const [g, n] of ga) overlap += Math.min(n, gb.get(g) ?? 0);
  return (2 * overlap) / (a.length - 1 + (b.length - 1));
};

const revisionTextKey = (side: EqRevisionSide): string | null => {
  const v = normalizeEqOrigText(side.questionOrig ?? '');
  return v === '' ? null : v;
};

/** 선택지 지문 — 기호와 원문(없으면 한국어)을 같이 본다. 기호가 같아도 문구가 바뀌면 '같은 답'이 아니다. */
const revisionOptionsKey = (side: EqRevisionSide): string =>
  side.options
    .map((o) => `${o.key.trim().toUpperCase()}=${normalizeEqOrigText(o.labelOrig ?? o.label)}`)
    .join('|');

/**
 * 새 초안 문항 ↔ 직전(고객이 본) 회차 문항 대조. 차례:
 *  ① **원문이 같은 문항끼리 먼저** 잇는다 — 번호가 달라도. 공장이 문항 하나를 빼고 번호를 당기면 번호로는
 *     딴 문항이 짝이 된다(2번 자리에 옛 3번이 온다). 선택지까지 같으면 `same`, 선택지가 바뀌었으면 `changed`.
 *     원문이 같은 후보가 여럿이면 번호가 같은 쪽.
 *  ② 남은 것 중 **번호가 같은 짝** — 원문이 바뀐 것이라 `changed`. 단 전혀 다른 질문이 번호만 물려받았으면
 *     (유사도 문턱 미만) 잇지 않는다. 한쪽 원문이 비어 견줄 수 없으면 번호를 믿는다.
 *  ③ 번호도 안 맞는 나머지 — 원문이 거의 같으면(번호가 바뀌고 문구도 손본 문항) `changed`.
 *  ④ 그래도 짝이 없으면 `new`.
 * 직전 문항 하나는 한 번만 쓰인다(둘이 같은 이전 답을 물려받지 않게).
 */
export const linkEqRevision = (
  next: readonly EqRevisionSide[],
  prev: readonly EqRevisionSide[],
): EqRevisionLink[] => {
  const nextText = next.map(revisionTextKey);
  const prevText = prev.map(revisionTextKey);
  const nextNo = next.map((s) => normalizeEqFactoryNo(s.factoryNo));
  const prevNo = prev.map((s) => normalizeEqFactoryNo(s.factoryNo));
  const links: (EqRevisionLink | null)[] = next.map(() => null);
  const used = new Set<number>();
  const free = (): number[] => prev.map((_, j) => j).filter((j) => !used.has(j));

  // ① 원문 완전 일치
  next.forEach((side, i) => {
    const text = nextText[i] ?? null;
    if (text === null) return;
    const candidates = free().filter((j) => prevText[j] === text);
    const no = nextNo[i] ?? null;
    const pick = candidates.find((j) => no !== null && prevNo[j] === no) ?? candidates[0];
    const matched = pick === undefined ? undefined : prev[pick];
    if (pick === undefined || matched === undefined) return;
    used.add(pick);
    links[i] = {
      prevIndex: pick,
      change: revisionOptionsKey(side) === revisionOptionsKey(matched) ? 'same' : 'changed',
    };
  });

  // ② 번호 짝
  next.forEach((_, i) => {
    const no = nextNo[i] ?? null;
    if (links[i] !== null || no === null) return;
    const pick = free().find((j) => prevNo[j] === no);
    if (pick === undefined) return;
    const a = nextText[i] ?? null;
    const b = prevText[pick] ?? null;
    if (a !== null && b !== null && eqTextSimilarity(a, b) < EQ_REVISION_SAME_NO_MIN_SIMILARITY) return;
    used.add(pick);
    links[i] = { prevIndex: pick, change: 'changed' };
  });

  // ③ 번호가 안 맞는 나머지 — 가장 닮은 것 하나
  next.forEach((_, i) => {
    const text = nextText[i] ?? null;
    if (links[i] !== null || text === null) return;
    let best: { j: number; score: number } | null = null;
    for (const j of free()) {
      const other = prevText[j] ?? null;
      if (other === null) continue;
      const score = eqTextSimilarity(text, other);
      if (score >= EQ_REVISION_CROSS_NO_MIN_SIMILARITY && (best === null || score > best.score)) {
        best = { j, score };
      }
    }
    if (best === null) return;
    used.add(best.j);
    links[i] = { prevIndex: best.j, change: 'changed' };
  });

  return links.map((l) => l ?? { prevIndex: null, change: 'new' });
};

// ── 초안 저장 검증 ───────────────────────────────────────────────────────────

export type AdminEqItemInput = z.output<typeof AdminPcbEqItemInput>;

export type EqDraftSaveError = 'BAD_ITEM' | 'BAD_FIGURES' | 'BAD_PREV_ITEM' | 'DUPLICATE_OPTION_KEY';

/**
 * 통째 교체 저장의 입력 검증 — 남의 문항 id·남의 그림·직전 회차 밖 문항 연결을 막는다.
 * 선택지 기호는 문항 안에서 유일해야 한다(답은 기호로 저장된다 — 겹치면 어느 쪽인지 모른다).
 */
export const validateEqDraftItems = (
  items: readonly AdminEqItemInput[],
  ctx: {
    /** 이 회차의 기존 문항 id. */
    itemIds: ReadonlySet<string>;
    /** 이 회차에 올린 그림(sp_file id). */
    figureIds: ReadonlySet<string>;
    /** 직전 회차(prevReviewId)의 문항 id — 직전 회차가 없으면 빈 집합. */
    prevItemIds: ReadonlySet<string>;
  },
): EqDraftSaveError | null => {
  const seen = new Set<string>();
  for (const item of items) {
    if (item.id !== undefined) {
      const key = String(item.id);
      if (!ctx.itemIds.has(key) || seen.has(key)) return 'BAD_ITEM';
      seen.add(key);
    }
    const figureSeen = new Set<string>();
    for (const f of item.figures) {
      const key = String(f.fileId);
      if (!ctx.figureIds.has(key) || figureSeen.has(key)) return 'BAD_FIGURES';
      figureSeen.add(key);
    }
    if (item.prevItemId !== null && !ctx.prevItemIds.has(String(item.prevItemId))) return 'BAD_PREV_ITEM';
    const keys = item.options.map((o) => o.key);
    if (new Set(keys).size !== keys.length) return 'DUPLICATE_OPTION_KEY';
  }
  return null;
};

// ── 답 검증(고객 회신·관리자 대리 회신 공용) ─────────────────────────────────

export type EqAnswerError =
  | 'ANSWER_UNKNOWN_ITEM'
  | 'ANSWER_DUPLICATE'
  | 'ANSWERS_INCOMPLETE'
  | 'ANSWER_BAD_KEY'
  | 'COMMENT_REQUIRED';

export interface EqAnswerDecision {
  itemId: bigint;
  key: string;
  comment: string | null;
}

/** '贵司指示' 류 선택지의 의견 최소 길이 — 한 글자 답은 공장이 읽을 수 없다. */
export const EQ_REQUIRED_COMMENT_MIN = 2;

/**
 * 전 문항에 정확히 하나씩, 그 문항의 선택지 기호로 답했는가. 부분 제출은 없다(공장은 한 문항이라도
 * 비면 진행하지 못한다). 고른 선택지가 requiresComment 면 의견 2자 이상.
 */
export const validateEqAnswers = (
  items: readonly Pick<SpPcbEqReviewItem, 'id' | 'options'>[],
  answers: readonly PcbEqAnswerInputType[],
): { ok: true; decisions: EqAnswerDecision[] } | { ok: false; error: EqAnswerError; itemId: number | null } => {
  const byId = new Map(items.map((i) => [i.id.toString(), i]));
  const answered = new Map<string, PcbEqAnswerInputType>();
  for (const a of answers) {
    const key = String(a.itemId);
    if (!byId.has(key)) return { ok: false, error: 'ANSWER_UNKNOWN_ITEM', itemId: a.itemId };
    if (answered.has(key)) return { ok: false, error: 'ANSWER_DUPLICATE', itemId: a.itemId };
    answered.set(key, a);
  }
  const decisions: EqAnswerDecision[] = [];
  for (const item of items) {
    const a = answered.get(item.id.toString());
    if (a === undefined) return { ok: false, error: 'ANSWERS_INCOMPLETE', itemId: Number(item.id) };
    const option = parseEqItemOptions(item.options).find((o) => o.key === a.key);
    if (option === undefined) return { ok: false, error: 'ANSWER_BAD_KEY', itemId: Number(item.id) };
    const comment = (a.comment ?? '').trim();
    if (option.requiresComment && comment.length < EQ_REQUIRED_COMMENT_MIN) {
      return { ok: false, error: 'COMMENT_REQUIRED', itemId: Number(item.id) };
    }
    decisions.push({ itemId: item.id, key: a.key, comment: comment === '' ? null : comment });
  }
  return { ok: true, decisions };
};

/** 이벤트·로그용 한 줄 요약 — "1:A · 2:B". */
export const summarizeEqAnswers = (
  items: readonly Pick<SpPcbEqReviewItem, 'id' | 'factoryNo' | 'seq'>[],
  decisions: readonly EqAnswerDecision[],
): string => {
  const keyOf = new Map(decisions.map((d) => [d.itemId.toString(), d.key]));
  return items.map((i) => `${eqItemNo(i)}:${keyOf.get(i.id.toString()) ?? '-'}`).join(' · ');
};

// ── 그림 파일 ────────────────────────────────────────────────────────────────

const FIGURE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const extOf = (filename: string): string => {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
};

/**
 * 그림으로 받을 수 있는 파일인가 — 확장자로 판정하고 그 확장자의 표준 MIME 을 돌려준다(아니면 null).
 * 브라우저가 붙인 MIME 은 이미지이거나 비어 있을(octet-stream) 때만 믿는다.
 */
export const eqFigureMime = (filename: string, mimetype: string): string | null => {
  const mime = FIGURE_MIME[extOf(filename)];
  if (mime === undefined) return null;
  return mimetype.startsWith('image/') || mimetype === 'application/octet-stream' || mimetype === ''
    ? mime
    : null;
};

/**
 * 인라인 응답의 Content-Type — **파일서버가 준 값을 쓰지 않는다**. 업로드 때 확장자로 걸렀으니
 * 확장자 MIME 이 정본이고, 서버 값을 그대로 inline 으로 내면 이미지가 아닌 것이 페이지로 열릴 수
 * 있다. 그림 사전 밖이면 octet-stream(인라인 표시 안 됨).
 */
export const eqFigureContentType = (filename: string): string =>
  FIGURE_MIME[extOf(filename)] ?? 'application/octet-stream';

// ── 뷰 조립 ──────────────────────────────────────────────────────────────────

/** 직전 회차 문항 → 개정 회차 화면의 "이전 질문·이전 답". */
export const toEqPrevItem = (
  src: Pick<SpPcbEqReviewItem, 'id' | 'question' | 'options' | 'answerKey' | 'answerComment'>,
): PcbEqPrevItemType => ({
  itemId: Number(src.id),
  question: src.question,
  answer: answerOf(src),
  answerLabel: eqAnswerLabel(parseEqItemOptions(src.options), src.answerKey),
});

const figureViews = (
  refs: readonly EqFigureRef[],
  files: ReadonlyMap<string, SpFile>,
): { fileId: number; name: string; size: number; shared: boolean }[] =>
  refs.flatMap((r) => {
    const f = files.get(r.fileId.toString());
    return f === undefined
      ? []
      : [{ fileId: Number(f.id), name: f.originFileName, size: Number(f.size), shared: r.shared }];
  });

/**
 * 회차에 올렸지만 어느 문항에도 안 붙은 그림(올린 순 = id 순). 올리기는 저장과 따로라 붙이기 전에 화면을
 * 떠나면 문항 그림 목록에 없다 — 관리자 뷰가 이 목록을 실어 다시 붙이거나 지우게 한다. `files` 는 여러
 * 회차의 그림이 섞인 묶음이어도 된다(refId 로 이 회차 것만 고른다). 공개 여부는 문항에 붙일 때 정하므로 false.
 */
export const looseEqFigures = (
  reviewId: bigint,
  items: readonly Pick<SpPcbEqReviewItem, 'figures'>[],
  files: ReadonlyMap<string, SpFile>,
): PcbEqItemFigureType[] => {
  const attached = new Set(items.flatMap((i) => parseEqItemFigures(i.figures).map((f) => f.fileId.toString())));
  return [...files.values()]
    .filter((f) => f.refId === reviewId && !attached.has(f.id.toString()))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => ({ fileId: Number(f.id), name: f.originFileName, size: Number(f.size), shared: false }));
};

/** 관리자 문항 — 원문·전체 그림(공개 여부 포함)·직전 회차 연결. */
export const toAdminEqItem = (
  row: SpPcbEqReviewItem,
  files: ReadonlyMap<string, SpFile>,
  prev: PcbEqPrevItemType | null,
): AdminPcbEqItemType => ({
  id: Number(row.id),
  seq: row.seq,
  factoryNo: row.factoryNo,
  category: asEqItemCategory(row.category),
  question: row.question,
  questionOrig: row.questionOrig,
  options: parseEqItemOptions(row.options),
  figures: figureViews(parseEqItemFigures(row.figures), files),
  prevItemId: row.prevItemId === null ? null : Number(row.prevItemId),
  change: asEqItemChange(row.change),
  prev,
  answer: answerOf(row),
  commentI18n: parseEqCommentI18n(row),
  aiFlags: parseEqAiFlags(row.aiFlags),
});

/**
 * 고객 문항 — 원문·공장 원문 선택지·비공개 그림이 없다(공급망 미노출). `prev` 는 호출부가
 * **고객이 본 회차의 문항일 때만** 넘긴다. 이어진 문항이 고객이 못 본 회차의 것이면
 * (`prevHidden`) 변화 표시도 지운다 — '동일·변경'은 고객이 본 이전 문항이 있을 때만 뜻이 있다.
 * 잇는 문항이 없는 '신규'는 그대로 둔다.
 */
export const toCustomerEqItem = (
  row: SpPcbEqReviewItem,
  files: ReadonlyMap<string, SpFile>,
  prev: PcbEqPrevItemType | null,
  prevHidden: boolean,
): CustomerPcbEqItemType => ({
  id: Number(row.id),
  seq: row.seq,
  category: asEqItemCategory(row.category),
  question: row.question,
  options: parseEqItemOptions(row.options).map((o) => ({
    key: o.key,
    label: o.label,
    recommended: o.recommended,
    requiresComment: o.requiresComment,
  })),
  figures: figureViews(
    parseEqItemFigures(row.figures).filter((f) => f.shared),
    files,
  ).map((f) => ({ fileId: f.fileId, name: f.name, size: f.size })),
  change: prevHidden ? null : asEqItemChange(row.change),
  prev,
  answer: answerOf(row),
});

/** 협력사 문항 — 원문 질문·선택지 기호·고객 답(기호+의견). 그림·공개 여부는 협력사 자기 자료라 생략. */
export const toPartnerEqItem = (row: SpPcbEqReviewItem): PartnerPcbEqItemType => ({
  id: Number(row.id),
  factoryNo: row.factoryNo,
  category: asEqItemCategory(row.category),
  questionOrig: row.questionOrig,
  question: row.question,
  options: parseEqItemOptions(row.options).map((o) => ({
    key: o.key,
    label: o.label,
    labelOrig: o.labelOrig,
  })),
  answer: answerOf(row),
  commentI18n: parseEqCommentI18n(row),
});

/** 이벤트 — 사전 밖 행(손으로 넣은 데이터)은 화면에 싣지 않는다. */
export const toEqEvent = (row: SpPcbEqReviewEvent): PcbEqReviewEventType | null => {
  if (!includesStr(PCB_EQ_REVIEW_EVENT_ACTIONS, row.action)) return null;
  const role = row.actorRole;
  return {
    id: Number(row.id),
    action: row.action,
    actorRole: role === 'customer' || role === 'admin' ? role : 'system',
    actorMbId: row.actorMbId,
    channel: asEqAnswerChannel(row.channel),
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
};
