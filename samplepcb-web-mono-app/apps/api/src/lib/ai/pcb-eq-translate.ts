import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { z } from 'zod';
import { PCB_EQ_REVERT_NOTE, PcbEqCommentTranslation, isPcbEqRejectionEvent, isPcbEqReopenEvent } from '@sp/api-contract';
import type { PcbEqCommentTranslationType } from '@sp/api-contract';
import { parseEqItemOptions } from '../pcb-eq-items';
import { prisma } from '../prisma';
import { extractJsonObject, type OllamaChatExtra } from './ollama';
import { chatWithOptionFallback } from './runner';
import { PCB_EQ_PARSE_USECASE, getAiConnection, getAiUsecaseRuntime, toOllamaThink } from './usecases';

// ── 고객 의견 번역(D20 P4) — docs/PCB_PARTNER_TRACK.md 「D20 P4」 ───────────────────────────
// 고객은 한국어로 의견을 쓴다. 협력사 포털 언어가 영어·중국어면 화면과 회신서 엑셀에 **번역문을 원문과 함께** 보인다.
// 고객 회신이 도착하면(또는 관리자가 [AI 번역]을 누르면) 한 번 번역해 문항(answerCommentI18n)에 저장한다 —
// 볼 때마다 번역하면 기다려야 하고 문장이 매번 달라지며 AI 가 멈추면 화면도 멈춘다.
//
// 설정은 **'PCB EQ 분석'(pcb.eq-parse) 유스케이스를 같이 쓴다** — 켜짐 여부·연결·모델·사고 단계. 번역만을 위한
// 스위치를 두지 않는다(EQ 파일을 AI 로 읽기로 한 곳이면 그 답의 번역도 AI 가 한다). 프롬프트는 여기가 정본.
//
// ⚠ 이 번역은 회신·전달에 **매달려 돈다** — 실패해도 회신·전달을 실패시키지 않는다. 번역이 없으면 화면은
//   지금처럼 원문만 보인다. 공장이 먼저 읽는 것은 선택 기호(A/B/C)이고 그것은 번역과 무관하다.

export const EQ_COMMENT_TRANSLATE_PROMPT_VERSION = 'eq-comment-tr-v1';
/** 의견은 짧다 — 한 번의 호출이 길어질 이유가 없다(EQ 분석 120초의 절반). */
const TRANSLATE_TIMEOUT_MS = 60_000;

type AiRunLogger = Pick<FastifyBaseLogger, 'info' | 'warn'>;

/** 번역할 의견 하나 — 질문과 고른 선택지는 문맥으로만 준다(무엇에 대한 말인지 알아야 용어를 고른다). */
export interface EqCommentSource {
  id: number;
  question: string;
  chosen: string;
  comment: string;
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, en: { type: 'string' }, zh: { type: 'string' } },
        required: ['id', 'en', 'zh'],
      },
    },
  },
  required: ['items'],
} as const;

export const buildEqCommentTranslatePrompt = (items: readonly EqCommentSource[]): string =>
  [
    "You translate a customer's free-text comments on a PCB manufacturing engineering query (EQ).",
    "The readers are the factory's engineers, who will build the board from these words.",
    'The customer wrote in Korean. Translate each comment into (1) English and (2) Simplified Chinese.',
    '',
    'Rules:',
    '- Translate the comment only. Do not answer it, explain it, soften it, summarize it, or add anything. Do not omit anything.',
    '- Keep every number, unit, tolerance, part number, layer name, file name, reference designator and other',
    '  alphanumeric token exactly as written (for example 0.25mm, ±0.1, TOP, V-CUT, UL, R12, 2.0T).',
    '- Positions and directions must be exact: left/right, top/bottom, upper/lower, inner/outer,',
    '  parallel/perpendicular, long side/short side. Never swap them and never generalize them.',
    '- Use standard PCB manufacturing terms (solder mask, silkscreen, pad, via, annular ring, impedance coupon,',
    '  panel, stack-up, surface finish). Chinese must use the terms mainland PCB factories use',
    '  (阻焊, 丝印/字符, 焊盘, 过孔, 孔环, 阻抗条, 拼板, 叠层, 表面处理).',
    '- If a comment is already written in English or in Chinese, copy it unchanged for that language and translate it for the other.',
    '- "question" and "chosen" are context only. Do not translate them and do not repeat them.',
    '- Keep line breaks.',
    '',
    'Return JSON only, with exactly one entry per input id:',
    '{"items":[{"id":<id>,"en":"<English>","zh":"<Simplified Chinese>"}]}',
    '',
    'Input:',
    JSON.stringify(items, null, 2),
  ].join('\n');

const Response = z.object({
  items: z.array(z.object({ id: z.number(), en: z.string(), zh: z.string() })),
});

/** 의견 속 숫자 토큰(0.25 · 10 · 1,000) — 번역문에 **그대로** 있어야 한다. */
const numbersOf = (text: string): string[] => [...new Set(text.match(/\d+(?:[.,]\d+)*/g) ?? [])];

/**
 * 모델 답 → 문항별 번역. 물은 의견에 대한 답만, 두 언어가 다 차 있을 때만 받는다.
 * 결정적 사후 검사 하나 — **원문의 숫자가 번역문에 그대로 있는가**. 치수·공차가 빠지거나 바뀐 번역은 가장 위험하고
 * 사람이 눈으로 잡기도 어렵다. 걸리면 그 의견의 번역은 버린다(원문만 보인다 — 틀린 번역보다 낫다).
 */
export const parseEqCommentTranslations = (
  text: string,
  sources: readonly EqCommentSource[],
): Map<number, { en: string; zh: string }> => {
  const out = new Map<number, { en: string; zh: string }>();
  // 모델이 JSON 대신 말로 답하면 추출기가 던진다 — 번역이 없는 것으로 읽는다(부르는 쪽이 AI_FAILED 로 말한다).
  let raw: unknown;
  try {
    raw = extractJsonObject(text);
  } catch {
    return out;
  }
  const parsed = Response.safeParse(raw);
  if (!parsed.success) return out;
  const byId = new Map(sources.map((s) => [s.id, s]));
  for (const row of parsed.data.items) {
    const source = byId.get(row.id);
    const en = row.en.trim();
    const zh = row.zh.trim();
    if (source === undefined || en === '' || zh === '') continue;
    // 1,000 을 1000 으로 옮긴 것은 같은 숫자다 — 쉼표를 뗀 꼴도 받아 준다.
    const has = (textOut: string, n: string): boolean => textOut.includes(n) || textOut.includes(n.replace(/,/g, ''));
    if (numbersOf(source.comment).some((n) => !has(en, n) || !has(zh, n))) continue;
    out.set(row.id, { en, zh });
  }
  return out;
};

export type EqTranslateError = 'REVIEW_NOT_FOUND' | 'AI_DISABLED' | 'AI_FAILED';

export const EQ_TRANSLATE_ERRORS: Record<EqTranslateError, { code: 404 | 409; message: string }> = {
  REVIEW_NOT_FOUND: { code: 404, message: '확인 요청을 찾을 수 없습니다.' },
  AI_DISABLED: {
    code: 409,
    message: "AI 번역이 꺼져 있습니다 — 설정 > AI 연동에서 'PCB EQ 분석'을 켜거나 번역문을 직접 적어 주세요.",
  },
  AI_FAILED: { code: 409, message: 'AI 번역에 실패했습니다 — 잠시 뒤 다시 시도하거나 번역문을 직접 적어 주세요.' },
};

export type EqTranslateResult =
  | { ok: true; /** 이번에 번역해 저장한 의견 수 */ translated: number; /** 번역 대상이었지만 저장하지 못한 수 */ failed: number }
  | { ok: false; error: EqTranslateError };

/** 모델 호출을 갈아 끼울 수 있게(단위 테스트) — 기본은 'PCB EQ 분석' 유스케이스의 연결·모델. */
export type EqTranslateChat = (prompt: string) => Promise<string>;

const defaultChat = async (log: AiRunLogger): Promise<EqTranslateChat | null> => {
  const runtime = await getAiUsecaseRuntime(PCB_EQ_PARSE_USECASE);
  if (!runtime.enabled) return null;
  const conn = await getAiConnection();
  const extra: OllamaChatExtra = { think: toOllamaThink(runtime.think), format: RESPONSE_SCHEMA, temperature: 0 };
  return async (prompt) =>
    (await chatWithOptionFallback({ baseUrl: conn.baseUrl, apiKey: conn.apiKey }, runtime.model, prompt, TRANSLATE_TIMEOUT_MS, [], extra, log)).text;
};

/**
 * 회차의 고객 의견을 번역해 문항에 저장한다.
 * force 가 아니면 **번역이 없는 의견만** — 관리자가 고친 번역(by=admin)도, 이미 된 AI 번역도 덮지 않는다.
 * force 면 의견이 있는 문항 전부를 다시 번역한다(관리자가 [다시 번역]을 눌렀다).
 */
export async function translateEqComments(
  reviewId: bigint,
  options: { force: boolean; log: AiRunLogger; chat?: EqTranslateChat },
): Promise<EqTranslateResult> {
  const review = await prisma.spPcbEqReview.findUnique({
    where: { id: reviewId },
    include: { items: { orderBy: { seq: 'asc' } } },
  });
  if (review?.format !== 'items') return { ok: false, error: 'REVIEW_NOT_FOUND' };

  const targets = review.items.filter(
    (i) => (i.answerComment?.trim() ?? '') !== '' && (options.force || i.answerCommentI18n === null),
  );
  if (targets.length === 0) return { ok: true, translated: 0, failed: 0 };

  const chat = options.chat ?? (await defaultChat(options.log));
  if (chat === null) return { ok: false, error: 'AI_DISABLED' };

  const sources: EqCommentSource[] = targets.map((i) => {
    const chosen = parseEqItemOptions(i.options).find((o) => o.key === i.answerKey);
    return {
      id: Number(i.id),
      question: (i.questionOrig ?? i.question).slice(0, 600),
      chosen: chosen === undefined ? (i.answerKey ?? '') : `${chosen.key}. ${chosen.labelOrig ?? chosen.label}`.slice(0, 300),
      comment: i.answerComment ?? '',
    };
  });

  let text: string;
  try {
    text = await chat(buildEqCommentTranslatePrompt(sources));
  } catch (err) {
    options.log.warn(
      { reviewId: reviewId.toString(), err: (err instanceof Error ? err.message : String(err)).slice(0, 200) },
      'eq comment translate: model call failed',
    );
    return { ok: false, error: 'AI_FAILED' };
  }
  const translations = parseEqCommentTranslations(text, sources);
  if (translations.size === 0) return { ok: false, error: 'AI_FAILED' };

  const at = new Date().toISOString();
  let translated = 0;
  for (const item of targets) {
    const hit = translations.get(Number(item.id));
    if (hit === undefined) continue;
    const value: PcbEqCommentTranslationType = { en: hit.en, 'zh-CN': hit.zh, by: 'ai', at };
    // 모델을 기다리는 사이(10초 안팎) 관리자가 번역문을 직접 적었을 수 있다 — force 가 아니면 **아직 비어 있는**
    // 문항에만 쓴다(사람이 고친 문장을 뒤늦게 도착한 AI 번역이 덮지 않게). 의견이 바뀌었으면 옛 글의 번역도 붙이지 않는다.
    const done = await prisma.spPcbEqReviewItem.updateMany({
      where: {
        id: item.id,
        answerComment: item.answerComment,
        ...(options.force ? {} : { answerCommentI18n: { equals: Prisma.DbNull } }),
      },
      data: { answerCommentI18n: value },
    });
    translated += done.count;
  }
  options.log.info(
    { reviewId: reviewId.toString(), translated, failed: targets.length - translated, prompt: EQ_COMMENT_TRANSLATE_PROMPT_VERSION },
    'eq comment translate: done',
  );
  return { ok: true, translated, failed: targets.length - translated };
}

/**
 * 회신에 매달린 자동 번역 — **절대 던지지 않는다**(회신·대리 회신 응답은 이미 나갔다). 꺼져 있거나 실패하면
 * 조용히 끝나고 화면은 원문만 보인다. 돌려주는 약속은 끝나면 풀린다(테스트·스크립트용 — 라우트는 기다리지 않는다).
 */
export const autoTranslateEqComments = (reviewId: bigint, log: AiRunLogger): Promise<void> =>
  translateEqComments(reviewId, { force: false, log })
    .then((result) => {
      if (!result.ok && result.error !== 'AI_DISABLED') {
        log.warn({ reviewId: reviewId.toString(), error: result.error }, 'eq comment translate: skipped');
      }
    })
    .catch((err: unknown) => {
      log.warn(
        { reviewId: reviewId.toString(), err: (err instanceof Error ? err.message : String(err)).slice(0, 200) },
        'eq comment translate: crashed',
      );
    });

// ── 관리자가 쓴 사유의 번역 — 반려(보완 요청)·대행 추가 EQ 요청 ──────────────────────────────
// 사유는 발주 이력(sp_pcb_po.eqHistory, Json)의 사건에 note 로 남는다. 관리자는 한국어로 쓰고 협력사가 읽는다 —
// 고객 의견과 같은 문제라 같은 방식으로 푼다: 저장된 뒤 뒤에서 한 번 번역해 **그 사건에** noteI18n 을 붙이고,
// 포털 타임라인이 번역문을 원문과 함께 보인다. 협력사가 직접 쓴 사유(추가 EQ 요청)는 자기 말이라 번역하지 않는다.

export const buildEqNoteTranslatePrompt = (note: string): string =>
  [
    'You translate a note that the buyer (the company ordering the PCB) wrote to the factory.',
    'It says why the factory\'s engineering query (EQ) submission was returned, or what must be re-confirmed.',
    "The readers are the factory's engineers, who will act on these words.",
    'The note is in Korean. Translate it into (1) English and (2) Simplified Chinese.',
    '',
    'Rules:',
    '- Translate the note only. Do not answer it, explain it, soften it, summarize it, or add anything. Do not omit anything.',
    '- Keep every number, unit, tolerance, part number, layer name, file name, reference designator and other',
    '  alphanumeric token exactly as written (for example 0.25mm, ±0.1, TOP, V-CUT, UL, R12, 2.0T).',
    '- Positions and directions must be exact: left/right, top/bottom, upper/lower, inner/outer,',
    '  parallel/perpendicular, long side/short side. Never swap them and never generalize them.',
    '- Use standard PCB manufacturing terms. Chinese must use the terms mainland PCB factories use',
    '  (阻焊, 丝印/字符, 焊盘, 过孔, 孔环, 阻抗条, 拼板, 叠层, 表面处理).',
    '- If the note is already written in English or in Chinese, copy it unchanged for that language and translate it for the other.',
    '- Keep line breaks.',
    '',
    'Return JSON only: {"items":[{"id":1,"en":"<English>","zh":"<Simplified Chinese>"}]}',
    '',
    'Note:',
    JSON.stringify([{ id: 1, comment: note }], null, 2),
  ].join('\n');

interface RawEqEvent {
  at?: unknown;
  byRole?: unknown;
  fromStatus?: unknown;
  toStatus?: unknown;
  note?: unknown;
  noteI18n?: unknown;
}
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const eventsOf = (json: unknown): RawEqEvent[] =>
  Array.isArray(json) ? json.filter((row): row is RawEqEvent => typeof row === 'object' && row !== null) : [];

/** 번역할 사건인가 — 관리자가 쓴 반려(보완 요청)·대행 추가 EQ 요청의 사유이고 아직 번역이 없다. */
const needsNoteTranslation = (e: RawEqEvent): boolean => {
  const note = str(e.note).trim();
  if (str(e.byRole) !== 'ADMIN' || note === '' || note === PCB_EQ_REVERT_NOTE) return false;
  if (PcbEqCommentTranslation.safeParse(e.noteI18n).success) return false;
  const shape = { fromStatus: str(e.fromStatus), toStatus: str(e.toStatus), note };
  return isPcbEqRejectionEvent(shape) || isPcbEqReopenEvent(shape);
};

export type EqNoteTranslateResult =
  | { ok: true; translation: PcbEqCommentTranslationType | null }
  | { ok: false; error: 'PO_NOT_FOUND' | 'AI_DISABLED' | 'AI_FAILED' };

/**
 * 발주 이력에서 **가장 최근의, 아직 번역되지 않은 관리자 사유**를 번역해 그 사건에 붙인다.
 * 번역할 것이 없으면 translation=null 로 끝난다(모델을 부르지 않는다).
 *
 * 이력은 Json 한 칸이라 다시 쓸 때 **행을 잠그고 그 자리에서 다시 읽는다** — 모델을 기다리는 사이(몇 초) 협력사가
 * 재요청하면 이력이 늘어나 있다. 읽어 둔 옛 배열로 덮으면 그 사건이 사라진다. 사건은 시각·사유로 다시 찾는다.
 */
export async function translateEqHistoryNote(
  poId: bigint,
  options: { log: AiRunLogger; chat?: EqTranslateChat },
): Promise<EqNoteTranslateResult> {
  const po = await prisma.spPcbPo.findUnique({ where: { id: poId }, select: { eqHistory: true } });
  if (po === null) return { ok: false, error: 'PO_NOT_FOUND' };
  const target = eventsOf(po.eqHistory).filter(needsNoteTranslation).at(-1);
  if (target === undefined) return { ok: true, translation: null };
  const note = str(target.note);

  const chat = options.chat ?? (await defaultChat(options.log));
  if (chat === null) return { ok: false, error: 'AI_DISABLED' };
  let text: string;
  try {
    text = await chat(buildEqNoteTranslatePrompt(note));
  } catch (err) {
    options.log.warn(
      { poId: poId.toString(), err: (err instanceof Error ? err.message : String(err)).slice(0, 200) },
      'eq note translate: model call failed',
    );
    return { ok: false, error: 'AI_FAILED' };
  }
  const hit = parseEqCommentTranslations(text, [{ id: 1, question: '', chosen: '', comment: note }]).get(1);
  if (hit === undefined) return { ok: false, error: 'AI_FAILED' };
  const translation: PcbEqCommentTranslationType = { en: hit.en, 'zh-CN': hit.zh, by: 'ai', at: new Date().toISOString() };

  const written = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM sp_pcb_po WHERE id = ${poId} FOR UPDATE`;
    const fresh = await tx.spPcbPo.findUnique({ where: { id: poId }, select: { eqHistory: true } });
    const events = eventsOf(fresh?.eqHistory);
    const index = events.findIndex((e) => str(e.at) === str(target.at) && str(e.note) === note && needsNoteTranslation(e));
    if (index < 0) return false;
    const next = events.map((e, i) => (i === index ? { ...e, noteI18n: translation } : e));
    await tx.spPcbPo.update({ where: { id: poId }, data: { eqHistory: next as unknown as Prisma.InputJsonValue } });
    return true;
  });
  options.log.info({ poId: poId.toString(), written }, 'eq note translate: done');
  return { ok: true, translation: written ? translation : null };
}

/** 반려·대행 재요청에 매달린 자동 번역 — **절대 던지지 않는다**. 꺼져 있거나 실패하면 화면은 원문만 보인다. */
export const autoTranslateEqHistoryNote = (poId: bigint, log: AiRunLogger): Promise<void> =>
  translateEqHistoryNote(poId, { log })
    .then((result) => {
      if (!result.ok && result.error !== 'AI_DISABLED') {
        log.warn({ poId: poId.toString(), error: result.error }, 'eq note translate: skipped');
      }
    })
    .catch((err: unknown) => {
      log.warn(
        { poId: poId.toString(), err: (err instanceof Error ? err.message : String(err)).slice(0, 200) },
        'eq note translate: crashed',
      );
    });
