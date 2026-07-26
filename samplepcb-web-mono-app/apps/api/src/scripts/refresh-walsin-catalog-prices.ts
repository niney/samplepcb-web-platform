import { access, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { normalizeMpn } from '@sp/utils';
import { engineFetch } from '../lib/engine-client';
import { resolveManufacturer } from '../lib/manufacturer-alias';
import { ingestSupplierSearchResultOnce } from '../lib/parts-ingest';
import { prisma } from '../lib/prisma';
import { WALSIN_RLC_SOURCE_SHA256 } from '../lib/walsin-rlc-catalog-workbook';

type RefreshStatus = 'priced' | 'found_without_price' | 'not_found' | 'error';

interface Target {
  partId: bigint;
  mpn: string;
  mpnNorm: string;
  manufacturerName: string;
  manufacturerNorm: string;
}

interface Options {
  apply: boolean;
  resume: boolean;
  retryMisses: boolean;
  limit: number | null;
  concurrency: number;
  maxCalls: number;
  stateFile: string;
}

const StateRecord = z.object({
  status: z.enum(['priced', 'found_without_price', 'not_found', 'error']),
  attempts: z.number().int().positive(),
  exactCandidates: z.number().int().nonnegative(),
  pricedCandidates: z.number().int().nonnegative(),
  error: z.string().nullable(),
  updatedAt: z.string(),
});

const State = z.object({
  version: z.literal(1),
  sourceSha256: z.literal(WALSIN_RLC_SOURCE_SHA256),
  createdAt: z.string(),
  updatedAt: z.string(),
  records: z.record(z.string(), StateRecord),
});

type RefreshState = z.infer<typeof State>;
type RefreshStateRecord = z.infer<typeof StateRecord>;

const DEFAULT_STATE_FILE = path.resolve(
  process.cwd(),
  'catalog-migrations/walsin/price-refresh-state-walsin-rlc.json',
);

function optionValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name}은 1 이상의 정수여야 합니다`);
  return parsed;
}

export function parseCatalogPriceRefreshOptions(args: string[]): Options {
  const apply = args.includes('--apply');
  const resume = args.includes('--resume');
  if (resume && !apply) throw new Error('--resume은 --apply와 함께 사용하세요');
  const limitText = optionValue(args, '--limit');
  return {
    apply,
    resume,
    retryMisses: args.includes('--retry-misses'),
    limit: limitText === undefined ? null : positiveInteger(limitText, 1, '--limit'),
    concurrency: Math.min(8, positiveInteger(optionValue(args, '--concurrency'), 2, '--concurrency')),
    maxCalls: Math.min(100, positiveInteger(optionValue(args, '--max-calls'), 12, '--max-calls')),
    stateFile: path.resolve(optionValue(args, '--state') ?? DEFAULT_STATE_FILE),
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isWalsinPreferredCatalog(value: unknown): boolean {
  const product = objectValue(value);
  const metadata = objectValue(product?.catalog_metadata);
  return metadata?.catalogOnly === true
    && metadata.samplepcbPreferred === true
    && metadata.sourceDatasetSha256 === WALSIN_RLC_SOURCE_SHA256;
}

function targetKey(target: Target): string {
  return `${target.manufacturerNorm}:${target.mpnNorm}`;
}

async function loadTargets(): Promise<Target[]> {
  const offers = await prisma.spPartOffer.findMany({
    where: { supplier: 'samplepcb' },
    select: {
      rawJson: true,
      part: {
        select: {
          id: true,
          mpn: true,
          mpnNorm: true,
          manufacturerName: true,
          manufacturerNorm: true,
        },
      },
    },
  });
  return offers
    .filter((offer) => isWalsinPreferredCatalog(offer.rawJson))
    .map((offer) => ({ partId: offer.part.id, ...offer.part }))
    .sort((a, b) =>
      a.manufacturerNorm.localeCompare(b.manufacturerNorm)
      || a.mpnNorm.localeCompare(b.mpnNorm));
}

/**
 * `/parts/refresh` 응답에서 요청 MPN+제조사와 정확히 같은 후보만 남긴다.
 * 단건 가격 갱신이 파라메트릭 대체 후보를 새 카탈로그 부품으로 확장하지 않게 하는 경계다.
 */
export function exactCatalogPriceEnvelope(
  envelope: unknown,
  target: Pick<Target, 'mpnNorm' | 'manufacturerNorm'>,
): {
  envelope: unknown;
  exactCandidates: number;
  pricedCandidates: number;
} {
  const root = objectValue(structuredClone(envelope));
  const search = objectValue(root?.search);
  const components = Array.isArray(search?.components) ? search.components : [];
  let exactCandidates = 0;
  let pricedCandidates = 0;
  for (const componentValue of components) {
    const component = objectValue(componentValue);
    if (component === null) continue;
    const candidates = Array.isArray(component.candidates) ? component.candidates : [];
    component.candidates = candidates.filter((candidateValue) => {
      const candidate = objectValue(candidateValue);
      const product = objectValue(candidate?.product);
      if (product === null) return false;
      const mpn = typeof product.manufacturer_part_number === 'string'
        ? normalizeMpn(product.manufacturer_part_number)
        : '';
      const manufacturer = resolveManufacturer(
        typeof product.manufacturer === 'string' ? product.manufacturer : null,
      ).norm;
      if (mpn !== target.mpnNorm || manufacturer !== target.manufacturerNorm) return false;
      exactCandidates += 1;
      const offers = Array.isArray(product.offers) ? product.offers : [];
      if (offers.some((offerValue) => {
        const offer = objectValue(offerValue);
        return Array.isArray(offer?.price_breaks) && offer.price_breaks.length > 0;
      })) pricedCandidates += 1;
      return true;
    });
  }
  return { envelope: root ?? envelope, exactCandidates, pricedCandidates };
}

async function currentSamplepcbPriceBreaks(partId: bigint): Promise<number> {
  const offer = await prisma.spPartOffer.findFirst({
    where: { partId, supplier: 'samplepcb' },
    select: { _count: { select: { priceBreaks: true } } },
  });
  return offer?._count.priceBreaks ?? 0;
}

async function refreshTarget(
  target: Target,
  maxCalls: number,
  priorAttempts: number,
): Promise<RefreshStateRecord> {
  try {
    const response = await engineFetch(
      '/parts/refresh',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          part_number: target.mpn,
          manufacturer: target.manufacturerName,
          max_calls: maxCalls,
        }),
      },
      180_000,
    );
    if (!response.ok) {
      throw new Error(`engine_http_${String(response.status)}`);
    }
    const filtered = exactCatalogPriceEnvelope(await response.json(), target);
    if (filtered.exactCandidates === 0) {
      return {
        status: 'not_found',
        attempts: priorAttempts + 1,
        exactCandidates: 0,
        pricedCandidates: 0,
        error: null,
        updatedAt: new Date().toISOString(),
      };
    }
    await ingestSupplierSearchResultOnce(
      filtered.envelope,
      `walsin-price:${String(target.partId)}`,
    );
    const persistedPrices = await currentSamplepcbPriceBreaks(target.partId);
    return {
      status: persistedPrices > 0 ? 'priced' : 'found_without_price',
      attempts: priorAttempts + 1,
      exactCandidates: filtered.exactCandidates,
      pricedCandidates: filtered.pricedCandidates,
      error: null,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: 'error',
      attempts: priorAttempts + 1,
      exactCandidates: 0,
      pricedCandidates: 0,
      error: String(error).slice(0, 500),
      updatedAt: new Date().toISOString(),
    };
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function newState(): RefreshState {
  const now = new Date().toISOString();
  return {
    version: 1,
    sourceSha256: WALSIN_RLC_SOURCE_SHA256,
    createdAt: now,
    updatedAt: now,
    records: {},
  };
}

async function readState(file: string): Promise<RefreshState> {
  return State.parse(JSON.parse(await readFile(file, 'utf8')));
}

async function writeState(file: string, state: RefreshState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

function summary(state: RefreshState, totalTargets: number): Record<string, unknown> {
  const counts: Record<RefreshStatus, number> = {
    priced: 0,
    found_without_price: 0,
    not_found: 0,
    error: 0,
  };
  for (const record of Object.values(state.records)) counts[record.status] += 1;
  return {
    result: counts.error === 0,
    totalTargets,
    processed: Object.keys(state.records).length,
    pending: Math.max(0, totalTargets - Object.keys(state.records).length),
    ...counts,
  };
}

async function main(): Promise<void> {
  const options = parseCatalogPriceRefreshOptions(process.argv.slice(2));
  const targets = await loadTargets();
  const initial = {
    sourceSha256: WALSIN_RLC_SOURCE_SHA256,
    targets: targets.length,
    apply: options.apply,
    stateFile: options.stateFile,
    concurrency: options.concurrency,
    maxCallsPerPart: options.maxCalls,
  };
  if (!options.apply) {
    console.log(JSON.stringify(initial, null, 2));
    return;
  }

  const stateExists = await fileExists(options.stateFile);
  if (stateExists && !options.resume) {
    throw new Error(`기존 상태 파일이 있습니다. 이어서 실행하려면 --resume을 지정하세요: ${options.stateFile}`);
  }
  const state = stateExists ? await readState(options.stateFile) : newState();
  const pending = targets.filter((target) => {
    const prior = state.records[targetKey(target)];
    if (prior === undefined || prior.status === 'error') return true;
    return options.retryMisses && ['not_found', 'found_without_price'].includes(prior.status);
  });
  const limited = options.limit === null ? pending : pending.slice(0, options.limit);
  for (const batch of chunks(limited, options.concurrency)) {
    const results = await Promise.all(
      batch.map(async (target) => {
        const key = targetKey(target);
        const prior = state.records[key];
        return [key, await refreshTarget(target, options.maxCalls, prior?.attempts ?? 0)] as const;
      }),
    );
    for (const [key, record] of results) state.records[key] = record;
    await writeState(options.stateFile, state);
    console.log(JSON.stringify({
      progress: summary(state, targets.length),
      lastBatch: results.map(([key, record]) => ({ key, status: record.status })),
    }));
  }
  console.log(JSON.stringify({ ...initial, ...summary(state, targets.length) }, null, 2));
}

const invokedFile = process.argv[1];
if (
  invokedFile !== undefined
  && path.resolve(invokedFile) === path.resolve(fileURLToPath(import.meta.url))
) {
  void main()
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
