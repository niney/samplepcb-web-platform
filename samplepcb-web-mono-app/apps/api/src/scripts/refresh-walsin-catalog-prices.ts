import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { z } from 'zod';
import { engineFetch } from '../lib/engine-client';
import { parseCatalogMigrationEnvelope } from '../lib/parts-catalog-migration';
import {
  WALSIN_PRICE_SNAPSHOT_MANIFEST_VERSION,
  WalsinPriceSnapshotManifest,
  WalsinPriceSnapshotProduct,
  WalsinPriceSnapshotRecord,
  buildWalsinPriceSnapshotArtifact,
  exactWalsinPriceSnapshotRecord,
  readVerifiedWalsinPriceSnapshot,
  sha256,
  validateWalsinPriceSnapshotCoverage,
  walsinPriceSnapshotEnvelopeApiCalls,
  walsinSnapshotBlockingErrors,
  walsinSnapshotSupplierErrors,
  type WalsinPriceSnapshotManifestType,
  type WalsinPriceSnapshotRecordType,
  type WalsinPriceSnapshotTarget,
} from '../lib/walsin-catalog-price-snapshot';
import {
  WALSIN_RLC_SOURCE_SHA256,
  buildWalsinRlcCatalogEnvelope,
} from '../lib/walsin-rlc-catalog-workbook';

type Mode = 'dry-run' | 'prepare' | 'verify';
const PRICE_SUPPLIERS = ['digikey', 'mouser', 'unikeyic'] as const;
type PriceSupplier = typeof PRICE_SUPPLIERS[number];

interface Options {
  mode: Mode;
  resume: boolean;
  retryMisses: boolean;
  retrySupplierErrors: boolean;
  limit: number | null;
  concurrency: number;
  batchSize: number;
  maxCalls: number;
  jobTimeoutSeconds: number;
  suppliers: PriceSupplier[];
  sourceFile: string;
  stateFile: string;
  snapshotFile: string;
  manifestFile: string;
}

const WorkRecord = z.object({
  key: z.string().min(1),
  mpn: z.string().min(1),
  mpnNorm: z.string().min(1),
  manufacturerName: z.string().min(1),
  manufacturerNorm: z.string().min(1),
  status: z.enum([
    'priced',
    'found_without_price',
    'not_found',
    'error',
  ]),
  products: z.array(WalsinPriceSnapshotProduct),
  warnings: z.array(z.string()),
  apiCalls: z.number().int().nonnegative(),
  attempts: z.number().int().positive(),
  error: z.string().nullable(),
  updatedAt: z.string().datetime(),
});

const WorkState = z.object({
  version: z.literal(2),
  sourceSha256: z.literal(WALSIN_RLC_SOURCE_SHA256),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  records: z.record(z.string(), WorkRecord),
});

type WorkRecordType = z.infer<typeof WorkRecord>;
type WorkStateType = z.infer<typeof WorkState>;

interface WorkSummary {
  targets: number;
  processed: number;
  pending: number;
  priced: number;
  foundWithoutPrice: number;
  notFound: number;
  errors: number;
  apiCalls: number;
}

interface PendingRecord {
  status: WorkRecordType['status'];
  warnings: string[];
}

const DEFAULT_SOURCE_FILE = path.resolve(
  process.cwd(),
  'catalog-migrations/walsin/Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx',
);
const DEFAULT_OUTPUT_DIR = path.resolve(
  process.cwd(),
  'catalog-migrations/walsin/prepared-prices',
);
const DEFAULT_STATE_FILE = path.join(DEFAULT_OUTPUT_DIR, 'work-state.json');
const DEFAULT_SNAPSHOT_FILE = path.join(
  DEFAULT_OUTPUT_DIR,
  'walsin-price-snapshot-v1.json.gz',
);
const DEFAULT_MANIFEST_FILE = path.join(DEFAULT_OUTPUT_DIR, 'manifest.json');

function optionValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name}은 1 이상의 정수여야 합니다`);
  }
  return parsed;
}

export function parseCatalogPriceRefreshOptions(args: string[]): Options {
  const selected = [
    args.includes('--prepare') ? 'prepare' as const : null,
    args.includes('--verify') ? 'verify' as const : null,
  ].filter((mode): mode is Exclude<Mode, 'dry-run'> => mode !== null);
  if (selected.length > 1) {
    throw new Error('실행 모드를 하나만 지정하세요: --prepare|--verify');
  }
  const mode = selected[0] ?? 'dry-run';
  const resume = args.includes('--resume');
  const retryMisses = args.includes('--retry-misses');
  const retrySupplierErrors = args.includes('--retry-supplier-errors');
  if (mode !== 'prepare' && (resume || retryMisses || retrySupplierErrors)) {
    throw new Error(
      '--resume, --retry-misses, --retry-supplier-errors는 --prepare에서만 사용할 수 있습니다',
    );
  }
  const supplierText = optionValue(args, '--suppliers');
  const supplierValues = supplierText === undefined
    ? [...PRICE_SUPPLIERS]
    : [...new Set(
        supplierText
          .split(/[,\s]+/)
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      )];
  if (
    supplierValues.length === 0
    || supplierValues.some(
      (supplier) => !PRICE_SUPPLIERS.includes(supplier as PriceSupplier),
    )
  ) {
    throw new Error(
      `--suppliers는 ${PRICE_SUPPLIERS.join(',')} 중 하나 이상이어야 합니다`,
    );
  }
  const limitText = optionValue(args, '--limit');
  return {
    mode,
    resume,
    retryMisses,
    retrySupplierErrors,
    limit: limitText === undefined
      ? null
      : positiveInteger(limitText, 1, '--limit'),
    concurrency: Math.min(
      8,
      positiveInteger(optionValue(args, '--concurrency'), 1, '--concurrency'),
    ),
    batchSize: Math.min(
      100,
      positiveInteger(optionValue(args, '--batch-size'), 100, '--batch-size'),
    ),
    maxCalls: Math.min(
      100,
      positiveInteger(optionValue(args, '--max-calls'), 12, '--max-calls'),
    ),
    jobTimeoutSeconds: Math.max(
      10,
      Math.min(
        300,
        positiveInteger(
          optionValue(args, '--job-timeout-seconds'),
          300,
          '--job-timeout-seconds',
        ),
      ),
    ),
    suppliers: supplierValues as PriceSupplier[],
    sourceFile: path.resolve(optionValue(args, '--file') ?? DEFAULT_SOURCE_FILE),
    stateFile: path.resolve(optionValue(args, '--state') ?? DEFAULT_STATE_FILE),
    snapshotFile: path.resolve(
      optionValue(args, '--snapshot') ?? DEFAULT_SNAPSHOT_FILE,
    ),
    manifestFile: path.resolve(
      optionValue(args, '--manifest') ?? DEFAULT_MANIFEST_FILE,
    ),
  };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function loadTargets(sourceFile: string): Promise<{
  targets: WalsinPriceSnapshotTarget[];
  records: ReturnType<typeof parseCatalogMigrationEnvelope>['records'];
}> {
  const built = await buildWalsinRlcCatalogEnvelope(sourceFile);
  const parsed = parseCatalogMigrationEnvelope(built.envelope);
  return {
    targets: parsed.records.map((record) => ({
      key: record.key,
      mpn: record.mpn,
      mpnNorm: record.mpnNorm,
      manufacturerName: record.manufacturerName,
      manufacturerNorm: record.manufacturerNorm,
    })),
    records: parsed.records,
  };
}

function newState(): WorkStateType {
  const now = new Date().toISOString();
  return {
    version: 2,
    sourceSha256: WALSIN_RLC_SOURCE_SHA256,
    createdAt: now,
    updatedAt: now,
    records: {},
  };
}

async function readState(file: string): Promise<WorkStateType> {
  const raw: unknown = JSON.parse(await readFile(file, 'utf8'));
  return WorkState.parse(raw);
}

async function writeState(file: string, state: WorkStateType): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

function terminalRecord(record: WorkRecordType): WalsinPriceSnapshotRecordType {
  if (record.status === 'error') {
    throw new Error(`오류 상태는 스냅샷에 넣을 수 없습니다: ${record.key}`);
  }
  return WalsinPriceSnapshotRecord.parse({
    key: record.key,
    mpn: record.mpn,
    mpnNorm: record.mpnNorm,
    manufacturerName: record.manufacturerName,
    manufacturerNorm: record.manufacturerNorm,
    status: record.status,
    products: record.products,
    warnings: record.warnings,
    apiCalls: record.apiCalls,
    updatedAt: record.updatedAt,
  });
}

function workSummary(
  state: WorkStateType,
  totalTargets: number,
): WorkSummary {
  const values = Object.values(state.records);
  const terminal = values.filter((record) => record.status !== 'error');
  return {
    targets: totalTargets,
    processed: terminal.length,
    pending: Math.max(0, totalTargets - terminal.length),
    priced: values.filter((record) => record.status === 'priced').length,
    foundWithoutPrice: values.filter(
      (record) => record.status === 'found_without_price',
    ).length,
    notFound: values.filter((record) => record.status === 'not_found').length,
    errors: values.filter((record) => record.status === 'error').length,
    apiCalls: values.reduce((total, record) => total + record.apiCalls, 0),
  };
}

function errorWorkRecord(
  target: WalsinPriceSnapshotTarget,
  error: unknown,
  priorAttempts: number,
  updatedAt: string,
  partial?: WalsinPriceSnapshotRecordType,
): WorkRecordType {
  return WorkRecord.parse({
    ...target,
    status: 'error',
    products: partial?.products ?? [],
    warnings: partial?.warnings ?? [],
    apiCalls: partial?.apiCalls ?? 0,
    attempts: priorAttempts + 1,
    error: String(error).slice(0, 500),
    updatedAt,
  });
}

async function refreshTargetBatch(
  targets: WalsinPriceSnapshotTarget[],
  maxCalls: number,
  jobTimeoutSeconds: number,
  suppliers: PriceSupplier[],
  priorAttempts: Map<string, number>,
): Promise<readonly (readonly [string, WorkRecordType])[]> {
  const updatedAt = new Date().toISOString();
  try {
    const response = await engineFetch(
      '/parts/refresh-batch',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          parts: targets.map((target) => ({
            component_id: target.key,
            part_number: target.mpn,
            manufacturer: target.manufacturerName,
          })),
          max_calls: Math.min(3_000, maxCalls * targets.length),
          job_timeout_seconds: jobTimeoutSeconds,
          suppliers,
        }),
      },
      (jobTimeoutSeconds + 30) * 1_000,
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`engine_http_${String(response.status)}:${detail}`);
    }
    const envelope: unknown = await response.json();
    const results = targets.map((target) => {
      const attempts = priorAttempts.get(target.key) ?? 0;
      let partial: WalsinPriceSnapshotRecordType | undefined;
      try {
        partial = exactWalsinPriceSnapshotRecord(
          envelope,
          target,
          updatedAt,
          target.key,
        );
        const skippedWarnings = PRICE_SUPPLIERS
          .filter((supplier) => !suppliers.includes(supplier))
          .map((supplier) => `${supplier}: not_requested_for_snapshot`);
        partial = WalsinPriceSnapshotRecord.parse({
          ...partial,
          warnings: [...new Set([...partial.warnings, ...skippedWarnings])],
        });
        const blockingErrors = walsinSnapshotBlockingErrors(partial.warnings);
        if (blockingErrors.length > 0) {
          throw new Error(
            `supplier_partial_error:${blockingErrors.join('|')}`,
          );
        }
        return [
          target.key,
          WorkRecord.parse({
            ...partial,
            attempts: attempts + 1,
            error: null,
          }),
        ] as const;
      } catch (error) {
        return [
          target.key,
          errorWorkRecord(target, error, attempts, updatedAt, partial),
        ] as const;
      }
    });
    const componentApiCalls = results.reduce(
      (total, [, record]) => total + record.apiCalls,
      0,
    );
    const unassignedApiCalls = Math.max(
      0,
      walsinPriceSnapshotEnvelopeApiCalls(envelope) - componentApiCalls,
    );
    const first = results[0];
    if (first !== undefined && unassignedApiCalls > 0) {
      results[0] = [
        first[0],
        WorkRecord.parse({
          ...first[1],
          apiCalls: first[1].apiCalls + unassignedApiCalls,
        }),
      ];
    }
    return results;
  } catch (error) {
    return targets.map((target) => [
      target.key,
      errorWorkRecord(
        target,
        error,
        priorAttempts.get(target.key) ?? 0,
        updatedAt,
      ),
    ] as const);
  }
}

async function writeSnapshotBundle(
  options: Options,
  sourceRecords: ReturnType<typeof parseCatalogMigrationEnvelope>['records'],
  records: WalsinPriceSnapshotRecordType[],
): Promise<WalsinPriceSnapshotManifestType> {
  const artifact = buildWalsinPriceSnapshotArtifact(
    options.sourceFile,
    records,
  );
  validateWalsinPriceSnapshotCoverage(artifact, sourceRecords);
  const compressed = gzipSync(
    Buffer.from(`${JSON.stringify(artifact)}\n`, 'utf8'),
    { level: 9 },
  );
  await mkdir(path.dirname(options.snapshotFile), { recursive: true });
  const temporary = `${options.snapshotFile}.tmp`;
  await writeFile(temporary, compressed);
  await rename(temporary, options.snapshotFile);

  const manifest = WalsinPriceSnapshotManifest.parse({
    schemaVersion: WALSIN_PRICE_SNAPSHOT_MANIFEST_VERSION,
    generatedAt: artifact.generatedAt,
    sourceFile: artifact.source.file,
    sourceSha256: artifact.source.sha256,
    snapshotFile: path.basename(options.snapshotFile),
    snapshotSha256: sha256(compressed),
    snapshotBytes: compressed.byteLength,
    summary: artifact.summary,
  });
  await mkdir(path.dirname(options.manifestFile), { recursive: true });
  const manifestTemporary = `${options.manifestFile}.tmp`;
  await writeFile(
    manifestTemporary,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await rename(manifestTemporary, options.manifestFile);
  return manifest;
}

async function verifySnapshotBundle(
  options: Options,
  sourceRecords: ReturnType<typeof parseCatalogMigrationEnvelope>['records'],
): Promise<Record<string, unknown>> {
  const verified = await readVerifiedWalsinPriceSnapshot(
    options.snapshotFile,
    options.manifestFile,
  );
  const artifact = validateWalsinPriceSnapshotCoverage(
    verified.artifact,
    sourceRecords,
  );
  const result = {
    result: true,
    snapshotFile: options.snapshotFile,
    manifestFile: options.manifestFile,
    snapshotSha256: verified.manifest.snapshotSha256,
    snapshotBytes: verified.manifest.snapshotBytes,
    summary: artifact.summary,
    failures: [],
  };
  return result;
}

async function prepare(
  options: Options,
  targets: WalsinPriceSnapshotTarget[],
  sourceRecords: ReturnType<typeof parseCatalogMigrationEnvelope>['records'],
): Promise<void> {
  const stateExists = await fileExists(options.stateFile);
  if (stateExists && !options.resume) {
    throw new Error(
      `기존 작업 상태가 있습니다. 이어서 실행하려면 --resume을 지정하세요: ${options.stateFile}`,
    );
  }
  if (!stateExists && options.resume) {
    throw new Error(`이어갈 작업 상태가 없습니다: ${options.stateFile}`);
  }
  const state = stateExists ? await readState(options.stateFile) : newState();
  const targetKeys = new Set(targets.map((target) => target.key));
  const unknownKeys = Object.keys(state.records).filter(
    (key) => !targetKeys.has(key),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`작업 상태에 원본 밖 key가 있습니다: ${unknownKeys[0] ?? ''}`);
  }

  const pending = orderWalsinPriceSnapshotTargets(
    targets,
    state.records,
    options.retryMisses,
    options.retrySupplierErrors,
    options.suppliers,
  );
  const selected = options.limit === null
    ? pending
    : pending.slice(0, options.limit);
  const targetBatches = chunks(selected, options.batchSize);
  for (const batchWave of chunks(targetBatches, options.concurrency)) {
    const priorAttempts = new Map(
      batchWave
        .flat()
        .map((target) => [
          target.key,
          state.records[target.key]?.attempts ?? 0,
        ] as const),
    );
    const results = (
      await Promise.all(
        batchWave.map((batch) =>
          refreshTargetBatch(
            batch,
            options.maxCalls,
            options.jobTimeoutSeconds,
            options.suppliers,
            priorAttempts,
          ),
        ),
      )
    ).flat();
    for (const [key, record] of results) state.records[key] = record;
    await writeState(options.stateFile, state);
    console.log(JSON.stringify({
      progress: workSummary(state, targets.length),
      lastBatch: results.map(([key, record]) => ({
        key,
        status: record.status,
        exactProducts: record.products.length,
        error: record.error,
      })),
    }));
  }

  const summary = workSummary(state, targets.length);
  const allTerminal = summary.processed === targets.length
    && summary.errors === 0;
  const manifest = allTerminal
    ? await writeSnapshotBundle(
        options,
        sourceRecords,
        targets.map((target) => {
          const record = state.records[target.key];
          if (record === undefined) {
            throw new Error(`완료 상태에서 record가 없습니다: ${target.key}`);
          }
          return terminalRecord(record);
        }),
      )
    : null;
  console.log(JSON.stringify({
    result: allTerminal,
    mode: options.mode,
    ...summary,
    stateFile: options.stateFile,
    snapshot: manifest,
    next: allTerminal
      ? 'verify'
      : `--prepare --resume${summary.errors > 0 ? '' : ' (또는 다음 limit 배치)'}`,
  }, null, 2));
}

export function orderWalsinPriceSnapshotTargets(
  targets: WalsinPriceSnapshotTarget[],
  records: Record<string, PendingRecord>,
  retryMisses: boolean,
  retrySupplierErrors = false,
  suppliers: PriceSupplier[] = [...PRICE_SUPPLIERS],
): WalsinPriceSnapshotTarget[] {
  const unseen: WalsinPriceSnapshotTarget[] = [];
  const retries: WalsinPriceSnapshotTarget[] = [];
  for (const target of targets) {
    const prior = records[target.key];
    if (prior === undefined) {
      unseen.push(target);
      continue;
    }
    if (
      prior.status === 'error'
      || walsinSnapshotBlockingErrors(prior.warnings).length > 0
      || (
        retrySupplierErrors
        && walsinSnapshotSupplierErrors(prior.warnings).some((warning) =>
          suppliers.some((supplier) =>
            warning.toLowerCase().startsWith(`${supplier}:`),
          ),
        )
      )
      || (
        retryMisses
        && ['not_found', 'found_without_price'].includes(prior.status)
      )
    ) {
      retries.push(target);
    }
  }
  // 타임아웃 직후 같은 identity를 즉시 재청구하면 상류 제한·느린 응답을 그대로
  // 반복해 전체 전진을 막는다. 아직 한 번도 시도하지 않은 대상을 먼저 끝내고,
  // 오류/불완전 결과는 같은 상태 파일의 마지막 재시도 구간으로 보낸다.
  return [...unseen, ...retries];
}

async function main(): Promise<void> {
  const options = parseCatalogPriceRefreshOptions(process.argv.slice(2));
  const source = await loadTargets(options.sourceFile);
  if (options.mode === 'dry-run') {
    const state = await fileExists(options.stateFile)
      ? workSummary(await readState(options.stateFile), source.targets.length)
      : null;
    console.log(JSON.stringify({
      result: true,
      mode: options.mode,
      sourceFile: options.sourceFile,
      sourceSha256: WALSIN_RLC_SOURCE_SHA256,
      targets: source.targets.length,
      concurrency: options.concurrency,
      batchSize: options.batchSize,
      maxCallsPerPart: options.maxCalls,
      jobTimeoutSeconds: options.jobTimeoutSeconds,
      suppliers: options.suppliers,
      stateFile: options.stateFile,
      snapshotFile: options.snapshotFile,
      manifestFile: options.manifestFile,
      state,
    }, null, 2));
    return;
  }
  if (options.mode === 'verify') {
    console.log(JSON.stringify(
      await verifySnapshotBundle(options, source.records),
      null,
      2,
    ));
    return;
  }
  await prepare(options, source.targets, source.records);
}

const invokedFile = process.argv[1];
if (
  invokedFile !== undefined
  && path.resolve(invokedFile) === path.resolve(fileURLToPath(import.meta.url))
) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
