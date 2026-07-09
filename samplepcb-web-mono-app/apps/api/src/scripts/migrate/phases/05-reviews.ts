// phase 05 — 상품 별점후기(레거시 g5_shop_item_use → sp_review) 변환 이관.
//
// 레거시는 후기를 "거버 제출건별 상품(it_id)"에 붙였다. 신규는 상품이 4종 템플릿뿐이라
// 후기를 주문/프로젝트(sp_order_spec) 단위로 재귀속한다:
//   it_id → 레거시 cart 라인(od_id, ct_id) → quoteId=uuidV5("od:ct") → sp_order_spec.quoteId
// (02-shop 의 quoteId 산식과 동일 — lib/util.ts uuidV5). shop phase 뒤에 실행돼 spec 이 이미 존재.
//
// 정책(2026-07-09 Fable 자문·재검증):
// - is_password(회원 비번 해시 사본)는 어떤 컬럼·JSON 에도 저장하지 않는다.
// - 매핑 실패도 저장(quoteId/specId=null + legacyItId 보존 + 리포트) — 스킵 금지(데이터 보존이 목적).
// - 1:N(재주문) 은 mb_id 일치 필터 → (od,ct) 오름차순 첫 라인(결정적 = sync 멱등).
// - 멱등 키 = legacyIsId(레거시 is_id, 후기 쓰기 경로에 재발급 없음) upsert.
import { Prisma } from '@prisma/client';
import type { SpReview } from '@prisma/client';
import type { LegacyRow } from '../../../lib/legacy-db';
import type { MigrateCtx } from '../lib/context';
import { asInt, asStr, canonicalJson, chunk, legacyDate, uuidV5 } from '../lib/util';

export interface ReviewLineRef {
  odId: string;
  ctId: number;
  mbId: string;
}

/**
 * 후기 it_id → 레거시 cart 라인들(od,ct 오름차순).
 * ⚠ 반드시 레거시 DB — 타깃 cart.it_id 는 템플릿 id 로 재작성돼 있다(02-shop buildCartOverrides).
 */
export async function loadReviewLineIndex(
  ctx: MigrateCtx,
  itIds: readonly string[],
): Promise<Map<string, ReviewLineRef[]>> {
  const index = new Map<string, ReviewLineRef[]>();
  const uniq = [...new Set(itIds.filter((s) => s !== ''))];
  for (const part of chunk(uniq, 500)) {
    const rows = await ctx.legacy(
      `SELECT it_id, od_id, ct_id, mb_id FROM g5_shop_cart
        WHERE it_id IN (${part.map(() => '?').join(', ')})
        ORDER BY od_id, ct_id`,
      part,
    );
    for (const r of rows) {
      const itId = asStr(r.it_id);
      const list = index.get(itId) ?? [];
      list.push({ odId: asStr(r.od_id), ctId: asInt(r.ct_id), mbId: asStr(r.mb_id) });
      index.set(itId, list);
    }
  }
  return index;
}

export interface ReviewMapping {
  quoteId: string | null;
  ambiguous: boolean; // it_id 가 여러 라인(1:N) — 결정 규칙 적용됨
}

/** 후기 → 프로젝트 귀속 결정 규칙(순수): mb_id 일치 필터 → (od,ct) 오름차순 첫 라인. */
export function resolveReviewQuoteId(
  itId: string,
  mbId: string,
  index: Map<string, ReviewLineRef[]>,
): ReviewMapping {
  const lines = index.get(itId) ?? [];
  if (lines.length === 0) return { quoteId: null, ambiguous: false };
  const mbMatch = lines.filter((l) => l.mbId === mbId);
  const pool = mbMatch.length > 0 ? mbMatch : lines; // filter·로드 모두 (od,ct) 정렬 보존
  const picked = pool[0];
  if (picked === undefined) return { quoteId: null, ambiguous: false };
  // 02-shop 의 quoteId 산식과 동일(ct_id 를 문자열로 — asStr(ct.ct_id) 와 결과 일치)
  return { quoteId: uuidV5(`${picked.odId}:${String(picked.ctId)}`), ambiguous: lines.length > 1 };
}

export interface ReviewTarget {
  quoteId: string | null;
  specId: bigint | null;
}

export interface ReviewInput {
  legacyIsId: number;
  mbId: string;
  quoteId: string | null;
  specId: bigint | null;
  score: number;
  subject: string | null;
  content: string;
  isConfirm: number;
  replySubject: string | null;
  replyContent: string | null;
  replyName: string | null;
  repliedAt: null; // 레거시 답변시각 컬럼 부재 — 항상 null
  writeDate: Date;
  legacyItId: string | null;
  legacyJson: Record<string, string> | null;
}

/** 레거시 후기 행 → sp_review 입력(순수). is_password 는 절대 포함하지 않는다. */
export function toReviewInput(r: LegacyRow, t: ReviewTarget): ReviewInput {
  const nz = (v: unknown): string | null => {
    const s = asStr(v).trim();
    return s === '' ? null : s;
  };
  const legacy: Record<string, string> = {};
  const isName = asStr(r.is_name).trim(); // 작성자 표시명(닉/이름) 보존
  const isIp = asStr(r.is_ip).trim();
  if (isName !== '') legacy.is_name = isName;
  if (isIp !== '') legacy.is_ip = isIp;
  return {
    legacyIsId: asInt(r.is_id),
    mbId: asStr(r.mb_id),
    quoteId: t.quoteId,
    specId: t.specId,
    score: asInt(r.is_score),
    subject: nz(r.is_subject),
    content: asStr(r.is_content),
    isConfirm: asInt(r.is_confirm),
    replySubject: nz(r.is_reply_subject),
    replyContent: nz(r.is_reply_content),
    replyName: nz(r.is_reply_name),
    repliedAt: null,
    writeDate: legacyDate(r.is_time, new Date('2023-01-01T00:00:00+09:00')),
    legacyItId: nz(r.it_id),
    legacyJson: Object.keys(legacy).length > 0 ? legacy : null,
  };
}

/** ReviewInput → Prisma create/update payload(legacyJson 을 DbNull 로 정규화). */
function toPrismaData(input: ReviewInput): Prisma.SpReviewUncheckedCreateInput {
  const { legacyJson, ...rest } = input;
  return { ...rest, legacyJson: legacyJson ?? Prisma.DbNull };
}

/** 기존 sp_review 행 vs 새 입력이 다른가(순수) — sync no-op 판정용(변경 없으면 UPDATE 생략). */
export function reviewDiffers(existing: SpReview, input: ReviewInput): boolean {
  return (
    existing.mbId !== input.mbId ||
    existing.quoteId !== input.quoteId ||
    (existing.specId ?? null) !== (input.specId ?? null) ||
    existing.score !== input.score ||
    existing.subject !== input.subject ||
    existing.content !== input.content ||
    existing.isConfirm !== input.isConfirm ||
    existing.replySubject !== input.replySubject ||
    existing.replyContent !== input.replyContent ||
    existing.replyName !== input.replyName ||
    existing.writeDate.getTime() !== input.writeDate.getTime() ||
    existing.legacyItId !== input.legacyItId ||
    canonicalJson(existing.legacyJson ?? null) !== canonicalJson(input.legacyJson ?? null)
  );
}

export interface ReviewUpsertStats {
  inserted: number;
  updated: number;
  mapped: number;
  unmapped: number;
  ambiguous: number;
}

export function emptyReviewStats(): ReviewUpsertStats {
  return { inserted: 0, updated: 0, mapped: 0, unmapped: 0, ambiguous: 0 };
}

/**
 * 후기 1건 귀속 해석 + 멱등 반영(legacyIsId 키). phase(전량)·sync(증분) 공유.
 * 부재→INSERT / 상이→UPDATE / 동일→no-op(sync 재실행 무변경 보장).
 * quoteId 는 대응 spec 이 실제로 존재할 때만 저장(verify '비-null 행의 spec 존재' 불변식).
 */
export async function upsertReview(
  ctx: MigrateCtx,
  r: LegacyRow,
  index: Map<string, ReviewLineRef[]>,
  stats: ReviewUpsertStats,
): Promise<void> {
  const { prisma, report } = ctx;
  const itId = asStr(r.it_id);
  const mbId = asStr(r.mb_id);
  const isId = asInt(r.is_id);

  const m = resolveReviewQuoteId(itId, mbId, index);
  if (m.ambiguous) {
    stats.ambiguous += 1;
    report.note('reviews.1:N 상품(첫 라인 채택)', `is_id ${String(isId)} · it_id ${itId}`, 30);
  }

  let specId: bigint | null = null;
  if (m.quoteId !== null) {
    const spec = await prisma.spOrderSpec.findFirst({
      where: { quoteId: m.quoteId },
      select: { id: true },
    });
    specId = spec?.id ?? null;
  }
  // spec 미존재면 귀속키 전부 null(추적은 legacyItId) — 저장은 유지
  const target: ReviewTarget = specId === null ? { quoteId: null, specId: null } : { quoteId: m.quoteId, specId };
  if (specId === null) {
    stats.unmapped += 1;
    report.note('reviews.귀속 실패(mbId·본문만 저장)', `is_id ${String(isId)} · it_id ${itId}`, 30);
  } else {
    stats.mapped += 1;
  }

  const input = toReviewInput(r, target);
  const existing = await prisma.spReview.findUnique({ where: { legacyIsId: isId } });
  if (existing === null) {
    if (!ctx.dryRun) await prisma.spReview.create({ data: toPrismaData(input) });
    stats.inserted += 1;
  } else if (reviewDiffers(existing, input)) {
    if (!ctx.dryRun) {
      await prisma.spReview.update({ where: { legacyIsId: isId }, data: toPrismaData(input) });
    }
    stats.updated += 1;
  }
}

export async function runReviewsPhase(ctx: MigrateCtx): Promise<void> {
  const { legacy, report } = ctx;
  console.log('\n── phase 05: reviews (별점후기 → sp_review) ──');

  const reviews = await legacy(`SELECT * FROM g5_shop_item_use ORDER BY is_id`);
  report.count('reviews.레거시 후기 수', reviews.length);
  if (reviews.length === 0) return;

  const index = await loadReviewLineIndex(
    ctx,
    reviews.map((r) => asStr(r.it_id)),
  );
  const stats = emptyReviewStats();
  for (const r of reviews) await upsertReview(ctx, r, index, stats);

  report.count('reviews.삽입', stats.inserted);
  report.count('reviews.갱신', stats.updated);
  report.count('reviews.귀속 성공', stats.mapped);
  report.count('reviews.귀속 실패(보존)', stats.unmapped);
  report.count('reviews.1:N 상품', stats.ambiguous);
}
