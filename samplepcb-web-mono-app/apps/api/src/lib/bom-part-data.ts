import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from './prisma';
import { backfillQuotePartIds } from './bom-quote';
import { ingestSupplierSearchResultOnce, type CatalogIngestResult } from './parts-ingest';

const ARTIFACT_DIRECT_GRACE_MS = 2 * 60_000;
const ARTIFACT_LEASE_MS = 5 * 60_000;
const ARTIFACT_MAX_ATTEMPTS = 20;
const ARTIFACT_MAX_BACKOFF_MS = 60_000;

interface ArtifactRow {
  id: bigint;
  supplierSearchRunId: bigint;
  payload: Uint8Array;
  payloadChecksum: string;
  attempts: number;
  quoteId: bigint;
  engineJobId: string | null;
}

export type CatalogRecoveryResult = 'completed' | 'scheduled' | 'skipped' | 'dead';

class PermanentCatalogRecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentCatalogRecoveryError';
  }
}

function summaryRecord(value: Prisma.JsonValue | null | undefined): Prisma.JsonObject {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

export async function completeCatalogIngest(
  quoteId: bigint,
  searchRunId: bigint,
  result: CatalogIngestResult,
): Promise<number> {
  if (result.runId === null) throw new PermanentCatalogRecoveryError('catalog_ingest_run_missing');
  // partId 보강까지 끝난 뒤에만 ready를 공개한다. 상세 폴링이 중간 상태를 완료로
  // 오인해 후보 비교·부품 변경 패널을 먼저 여는 짧은 경합을 없앤다.
  const backfilled = await backfillQuotePartIds(quoteId);
  const run = await prisma.spBomSupplierSearchRun.findUnique({
    where: { id: searchRunId },
    select: { resultSummary: true },
  });
  const prior = summaryRecord(run?.resultSummary);
  await prisma.spBomSupplierSearchRun.updateMany({
    where: { id: searchRunId, quoteId },
    data: {
      catalogIngestRunId: BigInt(result.runId),
      resultSummary: {
        ...prior,
        catalogElapsedMs: result.timing.elapsedMs,
        catalogDbElapsedMs: result.timing.dbElapsedMs,
        catalogIndexElapsedMs: result.timing.indexElapsedMs,
        catalogQueued: result.stats.queued,
        catalogReused: result.reused,
        catalogStatus: 'ready',
        catalogReadyAt: new Date().toISOString(),
        catalogRetryAt: null,
        catalogError: null,
      },
    },
  });
  return backfilled;
}

export async function markCatalogPreparation(
  quoteId: bigint,
  searchRunId: bigint,
  status: 'preparing' | 'failed',
  error?: unknown,
  retry?: { attempt: number; nextAttemptAt: Date | null },
): Promise<void> {
  const run = await prisma.spBomSupplierSearchRun.findUnique({
    where: { id: searchRunId },
    select: { resultSummary: true },
  });
  const prior = summaryRecord(run?.resultSummary);
  const errorMessage = error instanceof Error
    ? `${error.name}: ${error.message}`
    : typeof error === 'string' ? error : null;
  await prisma.spBomSupplierSearchRun.updateMany({
    where: { id: searchRunId, quoteId },
    data: {
      resultSummary: {
        ...prior,
        catalogStatus: status,
        catalogAttemptCount: retry?.attempt ?? prior.catalogAttemptCount ?? 0,
        catalogRetryAt: retry?.nextAttemptAt?.toISOString() ?? null,
        catalogError: status === 'failed'
          ? (errorMessage ?? 'catalog_preparation_failed').slice(0, 500)
          : null,
        catalogLastError: status === 'preparing' && errorMessage !== null
          ? errorMessage.slice(0, 500)
          : null,
      },
    },
  });
}

function encodeArtifact(envelope: unknown): { payload: Uint8Array; checksum: string } {
  if (envelope === undefined || typeof envelope === 'function' || typeof envelope === 'symbol') {
    throw new PermanentCatalogRecoveryError('supplier_result_not_serializable');
  }
  const json = JSON.stringify(envelope);
  return {
    payload: gzipSync(Buffer.from(json, 'utf8')),
    checksum: createHash('sha256').update(json).digest('hex'),
  };
}

function decodeArtifact(row: ArtifactRow): unknown {
  let json: string;
  try {
    json = gunzipSync(Buffer.from(row.payload)).toString('utf8');
  } catch (error) {
    throw new PermanentCatalogRecoveryError(`supplier_result_decompression_failed: ${String(error)}`);
  }
  const checksum = createHash('sha256').update(json).digest('hex');
  if (checksum !== row.payloadChecksum) {
    throw new PermanentCatalogRecoveryError('supplier_result_checksum_mismatch');
  }
  try {
    return JSON.parse(json) as unknown;
  } catch (error) {
    throw new PermanentCatalogRecoveryError(`supplier_result_json_invalid: ${String(error)}`);
  }
}

export function catalogRecoveryErrorCode(error: unknown): string {
  if (error instanceof PermanentCatalogRecoveryError) return 'PAYLOAD_INVALID';
  if (
    error instanceof Prisma.PrismaClientKnownRequestError
    || error instanceof Prisma.PrismaClientUnknownRequestError
    || error instanceof Prisma.PrismaClientInitializationError
  ) {
    if ('code' in error && typeof error.code === 'string') return error.code;
    if (
      error instanceof Prisma.PrismaClientInitializationError
      && error.errorCode !== undefined
    ) return error.errorCode;
    return 'PRISMA_ERROR';
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/elasticsearch|search indexing|indexing deferred/i.test(message)) return 'SEARCH_INDEX_UNAVAILABLE';
  if (/closed the connection|econnreset|etimedout|fetch failed/i.test(message)) return 'CONNECTION_INTERRUPTED';
  return 'CATALOG_PREPARATION_FAILED';
}

export function catalogRecoveryBackoffMs(attempt: number): number {
  return Math.min(ARTIFACT_MAX_BACKOFF_MS, 5_000 * (2 ** Math.max(0, attempt - 1)));
}

export async function persistSupplierResultArtifact(
  searchRunId: bigint,
  envelope: unknown,
): Promise<bigint> {
  const encoded = encodeArtifact(envelope);
  const nextAttemptAt = new Date(Date.now() + ARTIFACT_DIRECT_GRACE_MS);
  await prisma.$executeRaw`
    INSERT IGNORE INTO sp_bom_supplier_result_artifact (
      supplier_search_run_id, payload, payload_checksum, payload_bytes,
      status, attempts, next_attempt_at, created_at, updated_at
    ) VALUES (
      ${searchRunId}, ${encoded.payload}, ${encoded.checksum}, ${encoded.payload.byteLength},
      'queued', 0, ${nextAttemptAt}, NOW(3), NOW(3)
    )
  `;
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    SELECT id FROM sp_bom_supplier_result_artifact
    WHERE supplier_search_run_id = ${searchRunId}
    LIMIT 1
  `;
  const artifact = rows[0];
  if (artifact === undefined) throw new Error('supplier_result_artifact_not_persisted');
  return artifact.id;
}

export async function markSupplierResultArtifactCompleted(searchRunId: bigint): Promise<void> {
  await prisma.$executeRaw`
    UPDATE sp_bom_supplier_result_artifact
    SET status = 'completed', next_attempt_at = NULL, lease_until = NULL,
        last_error_code = NULL, last_error = NULL, completed_at = NOW(3), updated_at = NOW(3)
    WHERE supplier_search_run_id = ${searchRunId}
  `;
}

export async function markSupplierResultArtifactRunning(searchRunId: bigint): Promise<void> {
  const leaseUntil = new Date(Date.now() + ARTIFACT_DIRECT_GRACE_MS);
  await prisma.$executeRaw`
    UPDATE sp_bom_supplier_result_artifact
    SET status = 'running', lease_until = ${leaseUntil}, next_attempt_at = NULL, updated_at = NOW(3)
    WHERE supplier_search_run_id = ${searchRunId} AND status <> 'completed'
  `;
}

export async function hasSupplierResultArtifact(searchRunId: bigint): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ found: bigint }[]>`
    SELECT COUNT(*) AS found
    FROM sp_bom_supplier_result_artifact
    WHERE supplier_search_run_id = ${searchRunId}
  `;
  return (rows[0]?.found ?? 0n) > 0n;
}

export async function scheduleSupplierResultArtifactRetry(
  searchRunId: bigint,
  error?: unknown,
  resetAttempts = false,
): Promise<boolean> {
  const errorCode = error === undefined ? null : catalogRecoveryErrorCode(error);
  const errorMessage = error === undefined
    ? null
    : (
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : typeof error === 'string' ? error : 'catalog_preparation_failed'
      ).slice(0, 500);
  const updated = resetAttempts
    ? await prisma.$executeRaw`
        UPDATE sp_bom_supplier_result_artifact
        SET status = 'queued', attempts = 0, next_attempt_at = NOW(3), lease_until = NULL,
            last_error_code = ${errorCode}, last_error = ${errorMessage}, completed_at = NULL, updated_at = NOW(3)
        WHERE supplier_search_run_id = ${searchRunId} AND status <> 'completed'
      `
    : await prisma.$executeRaw`
        UPDATE sp_bom_supplier_result_artifact
        SET status = 'queued', next_attempt_at = NOW(3), lease_until = NULL,
            last_error_code = ${errorCode}, last_error = ${errorMessage}, completed_at = NULL, updated_at = NOW(3)
        WHERE supplier_search_run_id = ${searchRunId} AND status <> 'completed'
      `;
  return updated > 0;
}

async function loadArtifact(artifactId: bigint): Promise<ArtifactRow | null> {
  const rows = await prisma.$queryRaw<ArtifactRow[]>`
    SELECT
      artifact.id,
      artifact.supplier_search_run_id AS supplierSearchRunId,
      artifact.payload,
      artifact.payload_checksum AS payloadChecksum,
      artifact.attempts,
      run.quoteId,
      run.engineJobId
    FROM sp_bom_supplier_result_artifact artifact
    INNER JOIN sp_bom_supplier_search_run run ON run.id = artifact.supplier_search_run_id
    WHERE artifact.id = ${artifactId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function claimArtifact(artifactId: bigint): Promise<boolean> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + ARTIFACT_LEASE_MS);
  const claimed = await prisma.$executeRaw`
    UPDATE sp_bom_supplier_result_artifact
    SET status = 'running', lease_until = ${leaseUntil}, updated_at = NOW(3)
    WHERE id = ${artifactId}
      AND (
        (status IN ('queued', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
        OR (status = 'running' AND (lease_until IS NULL OR lease_until < ${now}))
      )
  `;
  return claimed > 0;
}

async function failArtifact(row: ArtifactRow, error: unknown): Promise<CatalogRecoveryResult> {
  const attempt = row.attempts + 1;
  const permanent = error instanceof PermanentCatalogRecoveryError;
  const dead = permanent || attempt >= ARTIFACT_MAX_ATTEMPTS;
  const nextAttemptAt = dead ? null : new Date(Date.now() + catalogRecoveryBackoffMs(attempt));
  const errorCode = catalogRecoveryErrorCode(error);
  const errorMessage = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);
  const updated = await prisma.$executeRaw`
    UPDATE sp_bom_supplier_result_artifact
    SET status = ${dead ? 'dead' : 'failed'}, attempts = ${attempt},
        next_attempt_at = ${nextAttemptAt}, lease_until = NULL,
        last_error_code = ${errorCode}, last_error = ${errorMessage}, updated_at = NOW(3)
    WHERE id = ${row.id} AND status <> 'completed'
  `;
  // lease 만료 뒤 중복 복구가 시작됐더라도 먼저 성공한 실행의 completed를 되돌리지 않는다.
  if (updated === 0) return 'completed';
  await markCatalogPreparation(
    row.quoteId,
    row.supplierSearchRunId,
    dead ? 'failed' : 'preparing',
    error,
    { attempt, nextAttemptAt },
  );
  return dead ? 'dead' : 'scheduled';
}

export async function processSupplierResultArtifact(
  artifactId: bigint,
  log: FastifyBaseLogger,
): Promise<CatalogRecoveryResult> {
  if (!(await claimArtifact(artifactId))) return 'skipped';
  const row = await loadArtifact(artifactId);
  if (row === null) return 'skipped';
  try {
    await markCatalogPreparation(row.quoteId, row.supplierSearchRunId, 'preparing');
    const envelope = decodeArtifact(row);
    const result = await ingestSupplierSearchResultOnce(
      envelope,
      row.engineJobId ?? `artifact-${String(row.supplierSearchRunId)}`,
    );
    if (result.runId === null) throw new PermanentCatalogRecoveryError('supplier_result_contract_invalid');
    const backfilled = await completeCatalogIngest(row.quoteId, row.supplierSearchRunId, result);
    await markSupplierResultArtifactCompleted(row.supplierSearchRunId);
    log.info({
      quoteId: String(row.quoteId),
      searchRunId: String(row.supplierSearchRunId),
      artifactId: String(row.id),
      ingestRunId: result.runId,
      backfilled,
    }, '부품 정보 백그라운드 자동 복구 완료');
    return 'completed';
  } catch (error) {
    const outcome = await failArtifact(row, error);
    log.warn({
      quoteId: String(row.quoteId),
      searchRunId: String(row.supplierSearchRunId),
      artifactId: String(row.id),
      errorCode: catalogRecoveryErrorCode(error),
      attempt: row.attempts + 1,
      outcome,
      err: String(error),
    }, '부품 정보 백그라운드 자동 복구 실패');
    return outcome;
  }
}

export async function retrySupplierResultArtifactNow(
  searchRunId: bigint,
  log: FastifyBaseLogger,
): Promise<CatalogRecoveryResult | null> {
  const rows = await prisma.$queryRaw<{ id: bigint; status: string; leaseUntil: Date | null }[]>`
    SELECT id, status, lease_until AS leaseUntil
    FROM sp_bom_supplier_result_artifact
    WHERE supplier_search_run_id = ${searchRunId}
    LIMIT 1
  `;
  const artifact = rows[0];
  if (artifact === undefined) return null;
  if (artifact.status === 'completed') return 'completed';
  if (
    artifact.status === 'running'
    && artifact.leaseUntil !== null
    && artifact.leaseUntil.getTime() > Date.now()
  ) {
    return 'scheduled';
  }
  if (!(await scheduleSupplierResultArtifactRetry(searchRunId, undefined, true))) return null;
  return processSupplierResultArtifact(artifact.id, log);
}

export async function recoverSupplierResultArtifacts(
  log: FastifyBaseLogger,
  limit = 10,
): Promise<{ completed: number; scheduled: number; dead: number }> {
  const now = new Date();
  const rows = await prisma.$queryRaw<{ id: bigint }[]>`
    SELECT id
    FROM sp_bom_supplier_result_artifact
    WHERE (
      (status IN ('queued', 'failed') AND (next_attempt_at IS NULL OR next_attempt_at <= ${now}))
      OR (status = 'running' AND (lease_until IS NULL OR lease_until < ${now}))
    )
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `;
  let completed = 0;
  let scheduled = 0;
  let dead = 0;
  for (const row of rows) {
    const result = await processSupplierResultArtifact(row.id, log);
    if (result === 'completed') completed += 1;
    if (result === 'scheduled') scheduled += 1;
    if (result === 'dead') dead += 1;
  }
  return { completed, scheduled, dead };
}
