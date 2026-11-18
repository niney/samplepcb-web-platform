import { createHash } from 'node:crypto';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyBaseLogger, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { SMARTSMT_FILE_PART_PATTERN, SMARTSMT_MAX_FILE_PARTS } from '@sp/api-contract';
import type { SmartsmtEnvelopeType } from '@sp/api-contract';
import { deleteFromFileServer, uploadToFileServer } from './file-server';
import type { UploadedFileType } from './file-server';
import { prisma } from './prisma';

// SmartSMT 견적서 수신 — 읽기·대조·저장 (docs/SMARTSMT_INTEGRATION.md §4).
//
// 원칙: sp-node 는 계산하지 않는다. 받은 견적서를 통째로 보관하고, 목록에 필요한 값만 뽑아 올린다.
// 보내는 쪽은 재시도가 없으므로 "모르는 값이라 거절"하지 않는다 — 뽑아 올리지 못한 칸은 null 로 둔다.

/** 파일서버 버킷 — 다른 모듈(gerber·bom·develop·market)과 섞이지 않게 따로 둔다. */
export const SMARTSMT_FILE_SERVICE_TYPE = process.env.SMARTSMT_FILE_SERVICE_TYPE ?? 'smt';
export const SMARTSMT_FILE_REF_TYPE = 'sp_smt_quote';
/** envelope 값 파트 한도 — multipart 기본(1MB)으로는 줄 수가 많은 견적서가 잘린다. */
export const SMARTSMT_MAX_ENVELOPE_BYTES = 8 * 1024 * 1024;

// 보관 종류(sp_file.fileType) — 아는 파트는 다른 모듈과 같은 이름을 쓰고, 모르는 파트는 파트 이름 그대로 둔다.
const FILE_TYPE_BY_PART: Readonly<Record<string, string>> = { gerber_archive: 'gerber' };
const fileTypeOf = (part: string): string => FILE_TYPE_BY_PART[part] ?? part;
/** 번호 · 견적서 자리의 이름은 파일로 치지 않는다. 그 밖에는 이름 규칙만 본다(SmartSMT 가 파트를 늘려도 받는다). */
const RESERVED_PARTS: readonly string[] = ['envelope', 'quote_id', 'order_id'];
const isFilePart = (name: string): boolean => !RESERVED_PARTS.includes(name) && SMARTSMT_FILE_PART_PATTERN.test(name);

// ── 견적서에서 목록용 값 뽑기 ───────────────────────────────────────────────────────────

type JsonObject = Record<string, unknown>;

const asObject = (value: unknown): JsonObject | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
const asText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, max) : null;
/** 금액 — null 은 "미정", 0 은 "0원"이다. 숫자가 아니면 미정으로 둔다. Decimal(16,2) 범위 밖도 미정. */
const asAmount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e14 ? value : null;
const asCount = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= 2_147_483_647 ? value : null;

/** 견적서 안의 파일 목록 한 줄(header.files). */
export interface SmartsmtManifestEntry {
  part: string;
  name: string | null;
  bytes: number | null;
  sha256: string | null;
}

export interface SmartsmtEnvelopeSummary {
  quoteId: string;
  orderId: string;
  envelopeVersion: string;
  madeAt: Date | null;
  currency: string | null;
  lang: string | null;
  strategy: string | null;
  quoteStatus: string | null;
  quantity: number | null;
  /** quote.total — SMT 작업비만. */
  smtTotal: number | null;
  finalSupplyPrice: number | null;
  finalVat: number | null;
  /** quote.integrated.totals.total — 최종 금액. */
  finalTotal: number | null;
  /** quote.estimated_total — SMT 작업비 추정. 확정 금액(smtTotal)이 미정일 때 SmartSMT 가 싣는 가견적. */
  smtEstimatedTotal: number | null;
  /** quote.integrated.totals.estimated_total — 최종 금액 추정(고객 화면의 "최종합계"). 확정 금액이 아니다. */
  finalEstimatedTotal: number | null;
  /** quote.integrated.blocked_by — 비어 있지 않으면 합계 미확정. 칸이 없으면 null. */
  blockedBy: string[] | null;
  ownerMbId: string | null;
  ownerName: string | null;
  manifest: SmartsmtManifestEntry[];
}

/**
 * 검증을 통과한 견적서에서 목록·정렬용 값을 뽑는다. 순수 함수.
 * `user_edits` · `files` 가 JSON 어디에 놓이는지는 SmartSMT 문서에 없다(§6-2) — 머리 안과 최상위를 둘 다 본다.
 */
export function summarizeSmartsmtEnvelope(envelope: SmartsmtEnvelopeType): SmartsmtEnvelopeSummary {
  const header = envelope.header as JsonObject;
  const quote: JsonObject = envelope.quote;
  const top = envelope as JsonObject;
  const totals = asObject(asObject(quote.integrated)?.totals);
  const blocked = asObject(quote.integrated)?.blocked_by;
  const edits = asObject(header.user_edits) ?? asObject(top.user_edits);
  const fileList = Array.isArray(header.files) ? header.files : Array.isArray(top.files) ? top.files : [];
  const madeAt = new Date(envelope.header.made_at);

  return {
    quoteId: envelope.header.quote_id,
    orderId: envelope.header.order_id,
    envelopeVersion: envelope.envelope_version,
    madeAt: Number.isNaN(madeAt.getTime()) ? null : madeAt,
    currency: asText(header.currency, 8),
    lang: asText(header.lang, 8),
    strategy: asText(header.strategy, 16) ?? asText(quote.strategy, 16),
    quoteStatus: asText(quote.quote_status, 32),
    quantity: asCount(quote.quantity),
    smtTotal: asAmount(quote.total),
    finalSupplyPrice: asAmount(totals?.supply_price),
    finalVat: asAmount(totals?.vat),
    finalTotal: asAmount(totals?.total),
    smtEstimatedTotal: asAmount(quote.estimated_total),
    finalEstimatedTotal: asAmount(totals?.estimated_total),
    blockedBy: Array.isArray(blocked) ? blocked.map((item) => String(item).slice(0, 64)) : null,
    ownerMbId: asText(edits?.owner_mb_id, 60),
    ownerName: asText(edits?.owner_name, 191),
    manifest: fileList.flatMap((entry) => {
      const row = asObject(entry);
      const part = asText(row?.part, 32);
      if (row === null || part === null) return [];
      return [{
        part,
        name: asText(row.name, 255),
        bytes: typeof row.bytes === 'number' && Number.isFinite(row.bytes) ? row.bytes : null,
        sha256: asText(row.sha256, 64)?.toLowerCase() ?? null,
      }];
    }),
  };
}

// ── 동봉 파일 대조 ──────────────────────────────────────────────────────────────────────

export interface SmartsmtReceivedFile {
  /** multipart 파트 이름 — gerber_archive · bom · cpl 과 그 밖의 이름(규칙: SMARTSMT_FILE_PART_PATTERN). */
  part: string;
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

/**
 * 파일 대조 결과 한 줄(sp_smt_quote.files).
 *  match    — 견적서 목록의 크기·해시와 같다
 *  unlisted — 파일은 왔는데 견적서 목록에 없다(대조할 값이 없어 받은 값만 기록)
 *  missing  — 견적서 목록에는 있는데 파일이 오지 않았다(가져오기로 받은 견적은 전부 이쪽)
 */
export interface SmartsmtFileCheck {
  part: string;
  name: string | null;
  bytes: number | null;
  sha256: string | null;
  check: 'match' | 'unlisted' | 'missing';
}

export type SmartsmtFileCheckResult =
  | { ok: true; files: SmartsmtFileCheck[] }
  | { ok: false; message: string };

/** 받은 파일을 견적서의 파일 목록과 대조한다. 크기나 해시가 다르면 거절한다(전송 중 손상·바꿔치기). 순수 함수. */
export function checkSmartsmtFiles(
  manifest: readonly SmartsmtManifestEntry[],
  received: readonly SmartsmtReceivedFile[],
): SmartsmtFileCheckResult {
  const files: SmartsmtFileCheck[] = [];
  for (const file of received) {
    const listed = manifest.find((entry) => entry.part === file.part);
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    if (listed !== undefined) {
      if (listed.bytes !== null && listed.bytes !== file.buffer.length) {
        return { ok: false, message: `${file.part} 파일의 크기가 견적서와 다릅니다` };
      }
      if (listed.sha256 !== null && listed.sha256 !== sha256) {
        return { ok: false, message: `${file.part} 파일의 해시가 견적서와 다릅니다` };
      }
    }
    files.push({
      part: file.part,
      name: file.filename,
      bytes: file.buffer.length,
      sha256,
      check: listed === undefined ? 'unlisted' : 'match',
    });
  }
  for (const entry of manifest) {
    if (received.some((file) => file.part === entry.part)) continue;
    files.push({ part: entry.part, name: entry.name, bytes: entry.bytes, sha256: entry.sha256, check: 'missing' });
  }
  return { ok: true, files };
}

// ── multipart 읽기 ─────────────────────────────────────────────────────────────────────

export interface SmartsmtParts {
  /** envelope 파트 — 객체 또는 아직 파싱하지 않은 값. 없으면 undefined. */
  envelope: unknown;
  /** envelope 가 글자로 왔다면 받은 글자 그대로(보관용). 객체로 왔다면 null. */
  envelopeText: string | null;
  quoteId: string | null;
  orderId: string | null;
  files: SmartsmtReceivedFile[];
  /** 읽지 않고 버린 파트 이름(모르는 파트·중복 파트). */
  ignored: string[];
}

const discard = (stream: NodeJS.ReadableStream): Promise<void> =>
  pipeline(stream, new Writable({ write: (_chunk, _encoding, callback) => { callback(); } }));

/**
 * 견적서 전송의 multipart 파트를 읽는다. **호출 전에 인증을 끝낼 것** — 파일을 메모리에 올린다.
 *
 * ⚠ `@fastify/multipart` 는 Content-Type 이 `application/json` 인 값 파트를 **객체로 바꿔** 넘긴다
 *   (글자가 아니다). 공용 `collectMultipart`(lib/market.ts)는 글자가 아닌 값을 버리므로 여기에 쓰면
 *   견적서가 사라진다. 그래서 따로 읽는다. envelope 가 글자나 파일 파트로 와도 받는다.
 */
export async function collectSmartsmtParts(request: FastifyRequest): Promise<SmartsmtParts> {
  const out: SmartsmtParts = { envelope: undefined, envelopeText: null, quoteId: null, orderId: null, files: [], ignored: [] };
  const takeEnvelopeText = (text: string): void => {
    out.envelopeText = text;
    try {
      out.envelope = JSON.parse(text) as unknown;
    } catch {
      out.envelope = undefined;
    }
  };

  for await (const part of request.parts({ limits: { fieldSize: SMARTSMT_MAX_ENVELOPE_BYTES } })) {
    if (part.type === 'file') {
      if (part.fieldname === 'envelope' && out.envelope === undefined && out.envelopeText === null) {
        takeEnvelopeText((await part.toBuffer()).toString('utf8'));
      } else if (
        isFilePart(part.fieldname) &&
        out.files.length < SMARTSMT_MAX_FILE_PARTS &&
        !out.files.some((file) => file.part === part.fieldname)
      ) {
        out.files.push({
          part: part.fieldname,
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: await part.toBuffer(),
        });
      } else {
        // 파일 스트림은 끝까지 읽어야 다음 파트로 넘어간다.
        await discard(part.file);
        out.ignored.push(part.fieldname);
      }
      continue;
    }
    if (part.fieldname === 'envelope' && out.envelope === undefined && out.envelopeText === null) {
      if (typeof part.value === 'string') takeEnvelopeText(part.value);
      else out.envelope = part.value;
    } else if (part.fieldname === 'quote_id' && typeof part.value === 'string') {
      out.quoteId = part.value.trim();
    } else if (part.fieldname === 'order_id' && typeof part.value === 'string') {
      out.orderId = part.value.trim();
    } else {
      out.ignored.push(part.fieldname);
    }
  }
  return out;
}

// ── 저장 ──────────────────────────────────────────────────────────────────────────────

export const smartsmtQuoteExists = async (quoteId: string): Promise<boolean> =>
  (await prisma.spSmtQuote.findUnique({ where: { quoteId }, select: { id: true } })) !== null;

export type SmartsmtSaveResult =
  | { saved: true }
  | { saved: false; reason: 'duplicate' }
  | { saved: false; reason: 'file_store_failed'; message: string };

const toDecimal = (value: number | null): Prisma.Decimal | null =>
  value === null ? null : new Prisma.Decimal(value);

/** 이미 올린 파일을 되돌린다(저장이 끝까지 가지 못했을 때). 실패해도 흐름을 막지 않는다. */
async function removeUploaded(uploaded: readonly UploadedFileType[], log: FastifyBaseLogger): Promise<void> {
  for (const file of uploaded) {
    try {
      await deleteFromFileServer(file.pathToken);
    } catch (err) {
      log.warn({ err }, 'smartsmt: 올린 파일을 되돌리지 못했습니다');
    }
  }
}

/**
 * 견적서 1건을 저장한다. 순서: 파일서버 → DB(주문 upsert · 견적 · 최신 견적 연결 · 파일 행).
 * 파일 저장이 실패하면 견적만 반쪽으로 남기지 않는다 — 보내는 쪽이 다시 보내면 된다.
 * 같은 quote_id 가 동시에 두 번 오면 유니크 제약이 한쪽을 막고, 진 쪽은 올린 파일을 되돌린다.
 */
export async function saveSmartsmtQuote(
  input: {
    summary: SmartsmtEnvelopeSummary;
    envelopeText: string;
    source: 'push' | 'pull';
    files: readonly SmartsmtReceivedFile[];
    fileChecks: readonly SmartsmtFileCheck[];
    receivedAt: Date;
  },
  log: FastifyBaseLogger,
): Promise<SmartsmtSaveResult> {
  const { summary, files, receivedAt } = input;

  // 파일서버는 한 요청에 한 파일만 받는다. 하나씩 올려야 중간에 실패했을 때 앞의 것을 되돌릴 수 있다.
  const uploaded: UploadedFileType[] = [];
  try {
    for (const file of files) {
      const [stored] = await uploadToFileServer(
        [{ buffer: file.buffer, filename: file.filename, mimetype: file.mimetype }],
        SMARTSMT_FILE_SERVICE_TYPE,
      );
      if (stored === undefined) throw new Error('file server returned no entry');
      uploaded.push(stored);
    }
  } catch (err) {
    log.error({ err }, 'smartsmt: 파일서버 저장 실패');
    await removeUploaded(uploaded, log);
    return { saved: false, reason: 'file_store_failed', message: '동봉 파일을 저장하지 못했습니다' };
  }

  const write = (): Promise<void> =>
    prisma.$transaction(async (tx) => {
      const owner = {
        ...(summary.ownerMbId === null ? {} : { ownerMbId: summary.ownerMbId }),
        ...(summary.ownerName === null ? {} : { ownerName: summary.ownerName }),
      };
      const order = await tx.spSmtOrder.upsert({
        where: { orderId: summary.orderId },
        create: { orderId: summary.orderId, ...owner, quoteCount: 1, firstReceivedAt: receivedAt, lastReceivedAt: receivedAt },
        update: { ...owner, quoteCount: { increment: 1 }, lastReceivedAt: receivedAt },
        select: { id: true },
      });
      const quote = await tx.spSmtQuote.create({
        data: {
          orderRefId: order.id,
          quoteId: summary.quoteId,
          orderId: summary.orderId,
          source: input.source,
          envelopeVersion: summary.envelopeVersion.slice(0, 16),
          madeAt: summary.madeAt,
          currency: summary.currency,
          lang: summary.lang,
          strategy: summary.strategy,
          quoteStatus: summary.quoteStatus,
          quantity: summary.quantity,
          smtTotal: toDecimal(summary.smtTotal),
          finalSupplyPrice: toDecimal(summary.finalSupplyPrice),
          finalVat: toDecimal(summary.finalVat),
          finalTotal: toDecimal(summary.finalTotal),
          smtEstimatedTotal: toDecimal(summary.smtEstimatedTotal),
          finalEstimatedTotal: toDecimal(summary.finalEstimatedTotal),
          blockedBy: summary.blockedBy ?? Prisma.DbNull,
          files: input.fileChecks.map((check) => ({ ...check })),
          envelope: input.envelopeText,
          receivedAt,
        },
        select: { id: true },
      });
      // 최신 = 마지막에 받은 견적(SmartSMT 의 최신 판정 기준은 미확인 — 문서 §6-4).
      await tx.spSmtOrder.update({ where: { id: order.id }, data: { latestQuoteId: quote.id } });
      for (const [index, file] of files.entries()) {
        const stored = uploaded[index];
        if (stored === undefined) continue;
        await tx.spFile.create({
          data: {
            refType: SMARTSMT_FILE_REF_TYPE,
            refId: quote.id,
            uploadFileName: stored.uploadFileName.slice(0, 255),
            originFileName: stored.originFileName.slice(0, 255),
            pathToken: stored.pathToken,
            size: BigInt(stored.size),
            writeDate: receivedAt,
            fileType: fileTypeOf(file.part),
            uploadedBy: 'SMARTSMT',
            slot: file.part,
          },
        });
      }
    });

  // 유니크 충돌(P2002)은 두 가지다.
  //  · 같은 quote_id 가 동시에 왔다 → 이긴 쪽이 저장했으니 중복으로 답한다.
  //  · 같은 **새 주문**의 서로 다른 견적 두 건이 동시에 왔다 → 주문 행을 만드는 데서 부딪친 것이라
  //    이 견적은 아직 저장되지 않았다. 주문 행이 생겼으니 한 번 더 쓰면 된다(중복으로 답하면 견적을 잃는다).
  for (let attempt = 0; ; attempt += 1) {
    try {
      await write();
      return { saved: true };
    } catch (err) {
      const unique = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (unique && (await smartsmtQuoteExists(summary.quoteId))) {
        await removeUploaded(uploaded, log);
        return { saved: false, reason: 'duplicate' };
      }
      if (unique && attempt === 0) continue;
      await removeUploaded(uploaded, log);
      throw err;
    }
  }
}

// ── 수신 기록 ─────────────────────────────────────────────────────────────────────────

export interface SmartsmtReceiveEntry {
  result: 'accepted' | 'duplicate' | 'rejected' | 'failed';
  reason: string | null;
  httpStatus: number;
  quoteId?: string | null;
  orderId?: string | null;
  bytes: number | null;
  durationMs: number;
  remoteAddr: string | null;
  message: string | null;
  /** 인증을 통과하지 못한 시도 — 바깥에서 얼마든지 만들 수 있어 시간당 건수를 제한해 남긴다. */
  unauthenticated?: boolean;
}

const UNAUTHENTICATED_LOG_LIMIT = 30;
const UNAUTHENTICATED_LOG_WINDOW_MS = 3_600_000;
let unauthenticatedWindow = { startedAt: 0, count: 0 };

/** 테스트용 — 인증 실패 기록 제한을 처음으로 되돌린다. */
export const resetSmartsmtReceiveLogLimit = (): void => {
  unauthenticatedWindow = { startedAt: 0, count: 0 };
};

/** 수신 시도 1건을 원장에 남긴다. 기록 실패는 수신 결과를 바꾸지 않는다. */
export async function recordSmartsmtReceive(entry: SmartsmtReceiveEntry, log: FastifyBaseLogger): Promise<void> {
  if (entry.unauthenticated === true) {
    const now = Date.now();
    if (now - unauthenticatedWindow.startedAt > UNAUTHENTICATED_LOG_WINDOW_MS) {
      unauthenticatedWindow = { startedAt: now, count: 0 };
    }
    unauthenticatedWindow.count += 1;
    if (unauthenticatedWindow.count > UNAUTHENTICATED_LOG_LIMIT) return;
  }
  try {
    await prisma.spSmtReceiveLog.create({
      data: {
        result: entry.result,
        reason: entry.reason,
        httpStatus: entry.httpStatus,
        quoteId: entry.quoteId?.slice(0, 100) ?? null,
        orderId: entry.orderId?.slice(0, 100) ?? null,
        bytes: entry.bytes === null ? null : BigInt(entry.bytes),
        durationMs: Math.max(0, Math.round(entry.durationMs)),
        remoteAddr: entry.remoteAddr?.slice(0, 64) ?? null,
        message: entry.message?.slice(0, 500) ?? null,
      },
    });
  } catch (err) {
    log.error({ err }, 'smartsmt: 수신 기록을 남기지 못했습니다');
  }
}
