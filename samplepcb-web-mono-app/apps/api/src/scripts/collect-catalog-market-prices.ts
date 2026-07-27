import { randomInt } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  rename,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import {
  CATALOG_MARKET_PRICE_CAPTURE_VERSION,
  CATALOG_MARKET_PRICE_MANIFEST_VERSION,
  CatalogMarketPriceCapture,
  CatalogMarketPriceManifest,
  CatalogMarketPriceRecord,
  MARKET_PRICE_SITES,
  buildIcbanqMarketRecord,
  canonicalCatalogMarketPriceRecord,
  marketObservationToSnapshotProduct,
  parseElepartsMarketResponse,
  parseIcbanqMarketCandidates,
  parseIcbanqMarketDetail,
  summarizeCatalogMarketPriceRecords,
  type CatalogMarketPriceCaptureType,
  type CatalogMarketPriceManifestType,
  type CatalogMarketPriceObservationType,
  type CatalogMarketPriceRecordType,
  type MarketPriceSite,
} from '../lib/catalog-market-price';
import {
  CatalogPriceSnapshotManifest,
  CatalogPriceSnapshotRecord,
  YEONHO_PRICE_SNAPSHOT_DEFINITION,
  WALSIN_PRICE_SNAPSHOT_DEFINITION,
  buildCatalogPriceSnapshotArtifact,
  canonicalCatalogPriceSnapshotRecord,
  readVerifiedCatalogPriceSnapshot,
  sha256,
  validateCatalogPriceSnapshotCoverage,
  type CatalogPriceSnapshotDefinition,
  type CatalogPriceSnapshotManifestType,
  type CatalogPriceSnapshotTarget,
} from '../lib/catalog-price-snapshot';
import { resolveManufacturer } from '../lib/manufacturer-alias';
import { parseCatalogMigrationEnvelope } from '../lib/parts-catalog-migration';
import { buildWalsinRlcCatalogEnvelope } from '../lib/walsin-rlc-catalog-workbook';
import { buildYeonhoCatalogEnvelope } from '../lib/yeonho-catalog-workbook';

type Mode = 'dry-run' | 'run' | 'verify' | 'merge';

const API_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const MARKET_CATALOG_SOURCES = {
  'walsin-rlc': {
    definition: WALSIN_PRICE_SNAPSHOT_DEFINITION,
    sourceFile: path.join(
      API_DIR,
      'catalog-migrations/walsin/Parts_Eyes_RLC_Size_Split_Expanded_AVL.xlsx',
    ),
    preparedDir: path.join(
      API_DIR,
      'catalog-migrations/walsin/prepared-prices',
    ),
    baseSnapshotFileName: 'walsin-price-snapshot-v1.json.gz',
    mergedSnapshotFileName: 'walsin-price-snapshot-v2.json.gz',
    build: buildWalsinRlcCatalogEnvelope,
  },
  yeonho: {
    definition: YEONHO_PRICE_SNAPSHOT_DEFINITION,
    sourceFile: path.join(
      API_DIR,
      'catalog-migrations/yeonho-connectors-2026-07-17/연호전자_커넥터_전품목_BOM매칭_DB_Rev2_공식품번.xlsx',
    ),
    preparedDir: path.join(
      API_DIR,
      'catalog-migrations/yeonho-connectors-2026-07-17/prepared-prices',
    ),
    baseSnapshotFileName: 'yeonho-price-snapshot-v1.json.gz',
    mergedSnapshotFileName: 'yeonho-price-snapshot-v2.json.gz',
    build: buildYeonhoCatalogEnvelope,
  },
} satisfies Record<string, {
  definition: CatalogPriceSnapshotDefinition;
  sourceFile: string;
  preparedDir: string;
  baseSnapshotFileName: string;
  mergedSnapshotFileName: string;
  build: (file: string) => Promise<{ envelope: unknown }>;
}>;

type MarketCatalogSource = keyof typeof MARKET_CATALOG_SOURCES;
const DEFAULT_CATALOG_SOURCE: MarketCatalogSource = 'walsin-rlc';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const DEFAULT_ACCEPT_LANGUAGE =
  'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7';
const ACCEPT_HTML =
  'text/html,application/xhtml+xml,application/xml;q=0.9,'
  + 'image/avif,image/webp,image/apng,*/*;q=0.8';
const ACCEPT_JSON = 'application/json, text/javascript, */*;q=0.01';

const WorkState = z.object({
  schemaVersion: z.literal('catalog-market-price-work-state/v1'),
  site: z.enum(MARKET_PRICE_SITES),
  sourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  manufacturerNorms: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  records: z.record(z.string(), CatalogMarketPriceRecord),
});

type WorkStateType = z.infer<typeof WorkState>;

interface Options {
  mode: Mode;
  source: MarketCatalogSource;
  site: MarketPriceSite | null;
  resume: boolean;
  delayMs: number;
  jitterMs: number;
  timeoutMs: number;
  limit: number | null;
  batchSize: number;
  batchCooldownMs: number;
  consecutiveErrorLimit: number;
  manufacturerNorms: string[];
  sourceFile: string;
  outputDir: string;
  stateFile: string | null;
  captureFile: string | null;
  captureManifestFile: string | null;
  baseSnapshotFile: string;
  mergedSnapshotFile: string;
  mergedManifestFile: string;
}

interface LoadedSource {
  targets: CatalogPriceSnapshotTarget[];
  records: ReturnType<typeof parseCatalogMigrationEnvelope>['records'];
}

interface TextResponse {
  status: number;
  contentType: string;
  body: string;
  finalUrl: string;
}

class BlockingResponseError extends Error {}

function optionValue(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline !== undefined) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function integerOption(
  args: string[],
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = optionValue(args, name);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed)
    || parsed < minimum
    || parsed > maximum
  ) {
    throw new Error(
      `${name}은 ${String(minimum)}~${String(maximum)} 정수여야 합니다`,
    );
  }
  return parsed;
}

function optionalIntegerOption(
  args: string[],
  name: string,
  minimum: number,
  maximum: number,
): number | null {
  const raw = optionValue(args, name);
  if (raw === undefined) return null;
  const parsed = Number(raw);
  if (
    !Number.isInteger(parsed)
    || parsed < minimum
    || parsed > maximum
  ) {
    throw new Error(
      `${name}은 ${String(minimum)}~${String(maximum)} 정수여야 합니다`,
    );
  }
  return parsed;
}

function selectedMode(args: string[]): Mode {
  const modes = [
    args.includes('--run') ? 'run' as const : null,
    args.includes('--verify') ? 'verify' as const : null,
    args.includes('--merge') ? 'merge' as const : null,
  ].filter((value): value is Exclude<Mode, 'dry-run'> => value !== null);
  if (modes.length > 1) {
    throw new Error('실행 모드는 하나만 지정하세요: --run|--verify|--merge');
  }
  return modes[0] ?? 'dry-run';
}

function parseSite(value: string | undefined): MarketPriceSite | null {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!MARKET_PRICE_SITES.includes(normalized as MarketPriceSite)) {
    throw new Error(`--site는 ${MARKET_PRICE_SITES.join('|')} 중 하나여야 합니다`);
  }
  return normalized as MarketPriceSite;
}

function parseCatalogSource(value: string | undefined): MarketCatalogSource {
  const normalized = value?.trim().toLowerCase() ?? DEFAULT_CATALOG_SOURCE;
  if (!Object.hasOwn(MARKET_CATALOG_SOURCES, normalized)) {
    throw new Error(
      `--source는 ${Object.keys(MARKET_CATALOG_SOURCES).join('|')} 중 하나여야 합니다`,
    );
  }
  return normalized as MarketCatalogSource;
}

function parseManufacturerNorms(value: string | undefined): string[] {
  if (value === undefined) return [];
  const result = new Set<string>();
  const tokens = value.includes(',') ? value.split(',') : value.split(/\s+/u);
  for (const token of tokens.map((item) => item.trim())) {
    if (token === '') continue;
    const manufacturer = resolveManufacturer(token);
    if (manufacturer.norm === 'unknown') {
      throw new Error(`제조사를 정규화할 수 없습니다: ${token}`);
    }
    result.add(manufacturer.norm);
  }
  return [...result].sort();
}

export function parseCatalogMarketPriceOptions(args: string[]): Options {
  const mode = selectedMode(args);
  const source = parseCatalogSource(optionValue(args, '--source'));
  const sourceConfig = MARKET_CATALOG_SOURCES[source];
  const site = parseSite(optionValue(args, '--site'));
  const resume = args.includes('--resume');
  if (mode !== 'run' && resume) {
    throw new Error('--resume은 --run과 함께 사용해야 합니다');
  }
  if (['run', 'verify'].includes(mode) && site === null) {
    throw new Error(`${mode} 모드에는 --site가 필요합니다`);
  }
  if (mode === 'merge' && site !== null) {
    throw new Error('--merge는 --site와 함께 사용할 수 없습니다');
  }
  const v2Dir = path.join(sourceConfig.preparedDir, 'v2');
  const outputDir = path.resolve(
    optionValue(args, '--output-dir') ?? path.join(v2Dir, 'market'),
  );
  const stateFile = site === null
    ? null
    : path.join(outputDir, `${site}-work-state.json`);
  const captureFile = site === null
    ? null
    : path.join(outputDir, `${site}-capture-v1.json.gz`);
  const captureManifestFile = site === null
    ? null
    : path.join(outputDir, `${site}-capture-manifest.json`);
  return {
    mode,
    source,
    site,
    resume,
    // 같은 호스트 요청 시작 시각 사이의 최소 간격이다. 상세 페이지도 포함한다.
    delayMs: integerOption(args, '--delay-ms', 500, 500, 60_000),
    jitterMs: integerOption(args, '--jitter-ms', 0, 0, 60_000),
    timeoutMs: integerOption(args, '--timeout-ms', 60_000, 10_000, 180_000),
    limit: optionalIntegerOption(args, '--limit', 1, 10_000),
    batchSize: integerOption(args, '--batch-size', 50, 1, 500),
    batchCooldownMs: integerOption(
      args,
      '--batch-cooldown-ms',
      1_000,
      0,
      1_800_000,
    ),
    consecutiveErrorLimit: integerOption(
      args,
      '--consecutive-error-limit',
      3,
      1,
      20,
    ),
    manufacturerNorms: parseManufacturerNorms(
      optionValue(args, '--manufacturers'),
    ),
    sourceFile: path.resolve(
      optionValue(args, '--file') ?? sourceConfig.sourceFile,
    ),
    outputDir,
    stateFile,
    captureFile,
    captureManifestFile,
    baseSnapshotFile: path.resolve(
      optionValue(args, '--base-snapshot')
        ?? path.join(
          sourceConfig.preparedDir,
          sourceConfig.baseSnapshotFileName,
        ),
    ),
    mergedSnapshotFile: path.resolve(
      optionValue(args, '--snapshot')
        ?? path.join(v2Dir, sourceConfig.mergedSnapshotFileName),
    ),
    mergedManifestFile: path.resolve(
      optionValue(args, '--manifest')
        ?? path.join(v2Dir, 'manifest.json'),
    ),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isBlockingError(error: unknown): boolean {
  if (error instanceof BlockingResponseError) return true;
  return /captcha|too many requests|rate.?limit|요청.?제한|접근.?차단/iu.test(
    errorMessage(error),
  );
}

async function sleep(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(
  file: string,
  value: string | Uint8Array,
): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  await writeFile(temporary, value);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rename(temporary, file);
      return;
    } catch (error) {
      const code = error instanceof Error && 'code' in error
        ? String(error.code)
        : '';
      if (
        !['EACCES', 'EBUSY', 'EPERM'].includes(code)
        || attempt === 9
      ) throw error;
      // Windows에서는 상태 파일을 사람이 읽거나 백신이 검사하는 짧은 순간
      // 기존 파일 교체 rename이 실패할 수 있다. 임시 파일은 그대로 있으므로
      // 네트워크를 다시 호출하지 않고 같은 rename만 짧게 재시도한다.
      await sleep(50 * (attempt + 1));
    }
  }
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function loadSource(options: Options): Promise<LoadedSource> {
  const { envelope } = await MARKET_CATALOG_SOURCES[options.source].build(
    options.sourceFile,
  );
  const parsed = parseCatalogMigrationEnvelope(envelope);
  const allowed = new Set(options.manufacturerNorms);
  const records = options.manufacturerNorms.length === 0
    ? parsed.records
    : parsed.records.filter((record) => allowed.has(record.manufacturerNorm));
  return {
    targets: records
      .map((record) => ({
        key: record.key,
        mpn: record.mpn,
        mpnNorm: record.mpnNorm,
        manufacturerName: record.manufacturerName,
        manufacturerNorm: record.manufacturerNorm,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    records,
  };
}

class MarketHttpSession {
  readonly #cookies = new Map<string, string>();
  readonly #origin: string;
  readonly #delayMs: number;
  readonly #jitterMs: number;
  readonly #timeoutMs: number;
  #lastRequestStartedAt = 0;
  #referer: string;
  requestCount = 0;

  constructor(
    origin: string,
    delayMs: number,
    jitterMs: number,
    timeoutMs: number,
  ) {
    this.#origin = origin;
    this.#delayMs = delayMs;
    this.#jitterMs = jitterMs;
    this.#timeoutMs = timeoutMs;
    this.#referer = `${origin}/`;
  }

  #updateCookies(headers: Headers): void {
    for (const value of headers.getSetCookie()) {
      const pair = value.split(';', 1)[0];
      const separator = pair?.indexOf('=') ?? -1;
      if (pair === undefined || separator <= 0) continue;
      this.#cookies.set(
        pair.slice(0, separator).trim(),
        pair.slice(separator + 1).trim(),
      );
    }
  }

  async #throttle(): Promise<void> {
    const jitter = this.#jitterMs === 0
      ? 0
      : randomInt(0, this.#jitterMs + 1);
    const waitMs = Math.max(
      0,
      this.#lastRequestStartedAt + this.#delayMs + jitter - Date.now(),
    );
    await sleep(waitMs);
    this.#lastRequestStartedAt = Date.now();
  }

  async request(
    url: URL,
    accept: string,
    xhr: boolean,
    referer = this.#referer,
  ): Promise<TextResponse> {
    await this.#throttle();
    this.requestCount += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);
    const headers = new Headers({
      accept,
      'accept-language': DEFAULT_ACCEPT_LANGUAGE,
      'user-agent': DEFAULT_USER_AGENT,
      referer,
    });
    if (xhr) headers.set('x-requested-with', 'XMLHttpRequest');
    if (this.#cookies.size > 0) {
      headers.set(
        'cookie',
        [...this.#cookies.entries()]
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
      );
    }
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });
      this.#updateCookies(response.headers);
      const body = await response.text();
      if (response.status === 403 || response.status === 429) {
        throw new BlockingResponseError(
          `${url.hostname} 요청 제한: HTTP ${String(response.status)}`,
        );
      }
      if (!response.ok) {
        throw new Error(
          `${url.hostname} HTTP ${String(response.status)}: ${url.pathname}`,
        );
      }
      return {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        body,
        finalUrl: response.url,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async bootstrap(): Promise<void> {
    const response = await this.request(
      new URL(`${this.#origin}/`),
      ACCEPT_HTML,
      false,
    );
    this.#referer = response.finalUrl;
  }
}

async function collectElepartsTarget(
  session: MarketHttpSession,
  target: CatalogPriceSnapshotTarget,
  attempts: number,
): Promise<CatalogMarketPriceRecordType> {
  const url = new URL('https://www.eleparts.co.kr/goods/search');
  url.searchParams.set('ajax', '2');
  url.searchParams.set('search_text', target.mpn);
  const response = await session.request(url, ACCEPT_JSON, true);
  const head = response.body.trimStart().slice(0, 1);
  if (head !== '{' && head !== '[') {
    throw new Error(`eleparts JSON이 아닌 응답입니다: ${response.contentType}`);
  }
  return parseElepartsMarketResponse(
    target,
    response.body,
    new Date().toISOString(),
    attempts,
  );
}

async function collectIcbanqTarget(
  session: MarketHttpSession,
  target: CatalogPriceSnapshotTarget,
  attempts: number,
): Promise<CatalogMarketPriceRecordType> {
  const searchUrl = new URL(
    'https://www.icbanq.com/A02_product/autoKeywordList.do',
  );
  searchUrl.searchParams.set('keyword', target.mpn);
  const searchResponse = await session.request(searchUrl, ACCEPT_JSON, true);
  if (
    !searchResponse.contentType.toLowerCase().includes('application/json')
    && !searchResponse.contentType.toLowerCase().includes('javascript')
  ) {
    throw new Error(
      `아이씨뱅큐 JSON이 아닌 응답입니다: ${searchResponse.contentType}`,
    );
  }
  const candidates = parseIcbanqMarketCandidates(
    target,
    searchResponse.body,
  );
  const observations: CatalogMarketPriceObservationType[] = [];
  const warnings: string[] = [];
  let manufacturerConflicts = 0;
  const startedRequests = session.requestCount;
  for (const candidate of candidates) {
    const detailResponse = await session.request(
      new URL(candidate.productUrl),
      ACCEPT_HTML,
      false,
      searchResponse.finalUrl,
    );
    try {
      const parsed = parseIcbanqMarketDetail(
        target,
        candidate,
        searchResponse.body,
        detailResponse.body,
      );
      if (parsed.manufacturerConflict) manufacturerConflicts += 1;
      if (parsed.observation !== null) {
        observations.push(parsed.observation);
        // 후보가 자동완성 대표단가 오름차순이므로 최초 exact 제조사가
        // ICBanQ 안에서 가장 싼 검증 상품이다.
        break;
      }
    } catch (error) {
      warnings.push(errorMessage(error).slice(0, 300));
    }
  }
  const detailRequests = session.requestCount - startedRequests;
  const record = buildIcbanqMarketRecord(
    target,
    observations,
    candidates.length,
    manufacturerConflicts,
    1 + detailRequests,
    new Date().toISOString(),
    attempts,
  );
  return CatalogMarketPriceRecord.parse({
    ...record,
    warnings: [...new Set([...record.warnings, ...warnings])].sort(),
  });
}

function errorRecord(
  site: MarketPriceSite,
  target: CatalogPriceSnapshotTarget,
  error: unknown,
  attempts: number,
  requestCount: number,
): CatalogMarketPriceRecordType {
  return CatalogMarketPriceRecord.parse({
    site,
    ...target,
    status: 'error',
    observations: [],
    warnings: [],
    requestCount,
    attempts,
    error: errorMessage(error).slice(0, 500),
    updatedAt: new Date().toISOString(),
  });
}

function newState(options: Options): WorkStateType {
  if (options.site === null) throw new Error('site가 없습니다');
  const definition = MARKET_CATALOG_SOURCES[options.source].definition;
  const now = new Date().toISOString();
  return WorkState.parse({
    schemaVersion: 'catalog-market-price-work-state/v1',
    site: options.site,
    sourceSha256: definition.sourceSha256,
    manufacturerNorms: options.manufacturerNorms,
    createdAt: now,
    updatedAt: now,
    records: {},
  });
}

async function readState(file: string, options: Options): Promise<WorkStateType> {
  const definition = MARKET_CATALOG_SOURCES[options.source].definition;
  const state = WorkState.parse(
    JSON.parse(await readFile(file, 'utf8')) as unknown,
  );
  if (
    state.site !== options.site
    || state.sourceSha256 !== definition.sourceSha256
    || JSON.stringify(state.manufacturerNorms)
      !== JSON.stringify(options.manufacturerNorms)
  ) {
    throw new Error(`작업 상태가 현재 실행 대상과 다릅니다: ${file}`);
  }
  return state;
}

async function writeState(file: string, state: WorkStateType): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await atomicWrite(file, json(state));
}

function validateCaptureCoverage(
  capture: CatalogMarketPriceCaptureType,
  site: MarketPriceSite,
  targets: readonly CatalogPriceSnapshotTarget[],
  definition: CatalogPriceSnapshotDefinition,
): CatalogMarketPriceCaptureType {
  if (
    capture.site !== site
    || capture.source.sha256 !== definition.sourceSha256
  ) {
    throw new Error(`시장가격 capture 원본이 다릅니다: ${site}`);
  }
  const expected = new Map(targets.map((target) => [target.key, target]));
  const seen = new Set<string>();
  for (const record of capture.records) {
    const target = expected.get(record.key);
    if (target === undefined) {
      throw new Error(`capture에 원본 밖 key가 있습니다: ${record.key}`);
    }
    if (seen.has(record.key)) {
      throw new Error(`capture key가 중복됩니다: ${record.key}`);
    }
    seen.add(record.key);
    if (
      record.site !== site
      || record.mpnNorm !== target.mpnNorm
      || record.manufacturerNorm !== target.manufacturerNorm
      || record.status === 'error'
    ) {
      throw new Error(`capture record가 유효하지 않습니다: ${record.key}`);
    }
    for (const observation of record.observations) {
      if (
        observation.site !== site
        || observation.targetKey !== target.key
        || observation.mpnNorm !== target.mpnNorm
        || observation.manufacturerNorm !== target.manufacturerNorm
      ) {
        throw new Error(`capture observation identity 위반: ${record.key}`);
      }
    }
  }
  if (seen.size !== expected.size) {
    throw new Error(
      `capture coverage가 부족합니다: ${String(seen.size)}/${String(expected.size)}`,
    );
  }
  const summary = summarizeCatalogMarketPriceRecords(capture.records);
  if (JSON.stringify(summary) !== JSON.stringify(capture.summary)) {
    throw new Error('capture summary가 records와 일치하지 않습니다');
  }
  return capture;
}

async function writeCaptureBundle(
  options: Options,
  source: LoadedSource,
  records: CatalogMarketPriceRecordType[],
): Promise<CatalogMarketPriceManifestType> {
  if (
    options.site === null
    || options.captureFile === null
    || options.captureManifestFile === null
  ) {
    throw new Error('capture 경로가 없습니다');
  }
  const sorted = [...records].sort((a, b) => a.key.localeCompare(b.key));
  const definition = MARKET_CATALOG_SOURCES[options.source].definition;
  const canonical = sorted.map(canonicalCatalogMarketPriceRecord);
  // 같은 체크포인트에서 capture를 다시 만들어도 byte/hash가 바뀌지 않게
  // 벽시계가 아니라 마지막 실제 관측 시각을 산출물 생성 시각으로 쓴다.
  const generatedAt = canonical
    .map((record) => record.updatedAt)
    .sort()
    .at(-1);
  if (generatedAt === undefined) {
    throw new Error('시장가격 capture 대상이 비었습니다');
  }
  const capture = validateCaptureCoverage(
    CatalogMarketPriceCapture.parse({
      schemaVersion: CATALOG_MARKET_PRICE_CAPTURE_VERSION,
      site: options.site,
      generatedAt,
      source: {
        file: path.basename(options.sourceFile),
        sha256: definition.sourceSha256,
      },
      summary: summarizeCatalogMarketPriceRecords(canonical),
      records: canonical,
    }),
    options.site,
    source.targets,
    definition,
  );
  const compressed = gzipSync(
    Buffer.from(`${JSON.stringify(capture)}\n`, 'utf8'),
    { level: 9 },
  );
  await atomicWrite(options.captureFile, compressed);
  const manifest = CatalogMarketPriceManifest.parse({
    schemaVersion: CATALOG_MARKET_PRICE_MANIFEST_VERSION,
    site: options.site,
    generatedAt,
    sourceFile: path.basename(options.sourceFile),
    sourceSha256: definition.sourceSha256,
    captureFile: path.basename(options.captureFile),
    captureSha256: sha256(compressed),
    captureBytes: compressed.byteLength,
    summary: capture.summary,
  });
  await atomicWrite(options.captureManifestFile, json(manifest));
  return manifest;
}

async function readVerifiedCapture(
  captureFile: string,
  manifestFile: string,
  site: MarketPriceSite,
  targets: readonly CatalogPriceSnapshotTarget[],
  definition: CatalogPriceSnapshotDefinition,
): Promise<{
  capture: CatalogMarketPriceCaptureType;
  manifest: CatalogMarketPriceManifestType;
}> {
  const bytes = await readFile(captureFile);
  const raw: unknown = JSON.parse(
    (path.extname(captureFile).toLowerCase() === '.gz'
      ? gunzipSync(bytes)
      : bytes).toString('utf8'),
  );
  const capture = validateCaptureCoverage(
    CatalogMarketPriceCapture.parse(raw),
    site,
    targets,
    definition,
  );
  const manifest = CatalogMarketPriceManifest.parse(
    JSON.parse(await readFile(manifestFile, 'utf8')) as unknown,
  );
  if (
    manifest.site !== site
    || manifest.generatedAt !== capture.generatedAt
    || manifest.sourceFile !== capture.source.file
    || manifest.sourceSha256 !== capture.source.sha256
    || manifest.captureFile !== path.basename(captureFile)
    || manifest.captureBytes !== bytes.byteLength
    || manifest.captureSha256 !== sha256(bytes)
    || JSON.stringify(manifest.summary) !== JSON.stringify(capture.summary)
  ) {
    throw new Error(`시장가격 capture manifest 검증 실패: ${site}`);
  }
  return { capture, manifest };
}

function progress(
  state: WorkStateType,
  targetCount: number,
): Record<string, number> {
  const records = Object.values(state.records);
  return {
    targets: targetCount,
    processed: records.filter((record) => record.status !== 'error').length,
    errors: records.filter((record) => record.status === 'error').length,
    priced: records.filter((record) => record.status === 'priced').length,
    pending: Math.max(
      0,
      targetCount
      - records.filter((record) => record.status !== 'error').length,
    ),
    requests: records.reduce(
      (total, record) => total + record.requestCount,
      0,
    ),
  };
}

async function runCollection(
  options: Options,
  source: LoadedSource,
): Promise<void> {
  if (options.site === null || options.stateFile === null) {
    throw new Error('실행 site/state가 없습니다');
  }
  const exists = await fileExists(options.stateFile);
  if (exists && !options.resume) {
    throw new Error(
      `기존 작업 상태가 있습니다. --resume을 사용하세요: ${options.stateFile}`,
    );
  }
  if (!exists && options.resume) {
    throw new Error(`이어갈 작업 상태가 없습니다: ${options.stateFile}`);
  }
  const state = exists
    ? await readState(options.stateFile, options)
    : newState(options);
  const pending = source.targets.filter((target) => {
    const record = state.records[target.key];
    return record === undefined || record.status === 'error';
  });
  const selected = options.limit === null
    ? pending
    : pending.slice(0, options.limit);
  const session = new MarketHttpSession(
    options.site === 'eleparts'
      ? 'https://www.eleparts.co.kr'
      : 'https://www.icbanq.com',
    options.delayMs,
    options.jitterMs,
    options.timeoutMs,
  );
  await session.bootstrap();
  let consecutiveErrors = 0;
  for (let index = 0; index < selected.length; index += 1) {
    const target = selected[index];
    if (target === undefined) continue;
    const prior = state.records[target.key];
    const attempts = (prior?.attempts ?? 0) + 1;
    const requestStart = session.requestCount;
    let blocking = false;
    let record: CatalogMarketPriceRecordType;
    try {
      record = options.site === 'eleparts'
        ? await collectElepartsTarget(session, target, attempts)
        : await collectIcbanqTarget(session, target, attempts);
      consecutiveErrors = 0;
    } catch (error) {
      blocking = isBlockingError(error);
      consecutiveErrors += 1;
      record = errorRecord(
        options.site,
        target,
        error,
        attempts,
        session.requestCount - requestStart,
      );
    }
    state.records[target.key] = record;
    await writeState(options.stateFile, state);
    console.log(JSON.stringify({
      progress: progress(state, source.targets.length),
      last: {
        key: target.key,
        manufacturer: target.manufacturerNorm,
        status: record.status,
        observations: record.observations.length,
        error: record.error,
      },
    }));
    if (blocking) {
      throw new BlockingResponseError(
        `${options.site} 요청 제한 감지; 냉각 후 --run --resume으로 재개하세요`,
      );
    }
    if (consecutiveErrors >= options.consecutiveErrorLimit) {
      throw new Error(
        `${options.site} 연속 오류 ${String(consecutiveErrors)}건; --run --resume으로 재개하세요`,
      );
    }
    if (
      options.batchCooldownMs > 0
      && (index + 1) % options.batchSize === 0
      && index + 1 < selected.length
    ) {
      await sleep(options.batchCooldownMs);
    }
  }
  const summary = progress(state, source.targets.length);
  const complete = summary.processed === source.targets.length
    && summary.errors === 0;
  const manifest = complete
    ? await writeCaptureBundle(
        options,
        source,
        source.targets.map((target) => {
          const record = state.records[target.key];
          if (record === undefined || record.status === 'error') {
            throw new Error(`완료 상태 record가 없습니다: ${target.key}`);
          }
          return record;
        }),
      )
    : null;
  console.log(json({
    result: complete,
    mode: options.mode,
    site: options.site,
    ...summary,
    stateFile: options.stateFile,
    capture: manifest,
    next: complete ? 'verify' : '--run --resume',
  }));
}

async function verifyCapture(
  options: Options,
  source: LoadedSource,
): Promise<void> {
  if (
    options.site === null
    || options.captureFile === null
    || options.captureManifestFile === null
  ) {
    throw new Error('검증 site/capture 경로가 없습니다');
  }
  const verified = await readVerifiedCapture(
    options.captureFile,
    options.captureManifestFile,
    options.site,
    source.targets,
    MARKET_CATALOG_SOURCES[options.source].definition,
  );
  console.log(json({
    result: true,
    site: options.site,
    captureFile: options.captureFile,
    manifestFile: options.captureManifestFile,
    captureSha256: verified.manifest.captureSha256,
    summary: verified.capture.summary,
  }));
}

async function mergeCaptures(
  options: Options,
  source: LoadedSource,
): Promise<CatalogPriceSnapshotManifestType> {
  if (options.manufacturerNorms.length > 0) {
    throw new Error('--merge는 제조사 필터 없이 원본 전체에 실행해야 합니다');
  }
  const definition = MARKET_CATALOG_SOURCES[options.source].definition;
  const captures = await Promise.all(
    MARKET_PRICE_SITES.map(async (site) => {
      const captureFile = path.join(
        options.outputDir,
        `${site}-capture-v1.json.gz`,
      );
      const manifestFile = path.join(
        options.outputDir,
        `${site}-capture-manifest.json`,
      );
      return readVerifiedCapture(
        captureFile,
        manifestFile,
        site,
        source.targets,
        definition,
      );
    }),
  );
  const base = await readVerifiedCatalogPriceSnapshot(
    options.baseSnapshotFile,
    definition,
  );
  validateCatalogPriceSnapshotCoverage(
    base.artifact,
    source.records,
    definition,
  );
  const marketByKey = new Map<string, CatalogMarketPriceRecordType[]>();
  for (const { capture } of captures) {
    for (const record of capture.records) {
      const values = marketByKey.get(record.key) ?? [];
      values.push(record);
      marketByKey.set(record.key, values);
    }
  }
  const records = base.artifact.records.map((record) => {
    const market = marketByKey.get(record.key) ?? [];
    const marketProducts = market.flatMap((entry) =>
      entry.observations.map(marketObservationToSnapshotProduct));
    const existing = record.products.filter(
      (product) =>
        product.supplier !== 'eleparts'
        && product.supplier !== 'icbanq',
    );
    const updatedAt = [record.updatedAt, ...market.map((entry) => entry.updatedAt)]
      .sort()
      .at(-1) ?? record.updatedAt;
    return canonicalCatalogPriceSnapshotRecord(
      CatalogPriceSnapshotRecord.parse({
        ...record,
        products: [...existing, ...marketProducts],
        apiCalls: record.apiCalls + market.reduce(
          (total, entry) => total + entry.requestCount,
          0,
        ),
        updatedAt,
      }),
    );
  });
  const generatedAt = [
    base.artifact.generatedAt,
    ...captures.map(({ capture }) => capture.generatedAt),
  ].sort().at(-1);
  if (generatedAt === undefined) {
    throw new Error('병합 생성 시각을 결정할 수 없습니다');
  }
  const artifact = buildCatalogPriceSnapshotArtifact(
    definition,
    options.sourceFile,
    records,
    generatedAt,
  );
  validateCatalogPriceSnapshotCoverage(
    artifact,
    source.records,
    definition,
  );
  const compressed = gzipSync(
    Buffer.from(`${JSON.stringify(artifact)}\n`, 'utf8'),
    { level: 9 },
  );
  await atomicWrite(options.mergedSnapshotFile, compressed);
  const manifest = CatalogPriceSnapshotManifest.parse({
    schemaVersion: definition.manifestVersion,
    generatedAt: artifact.generatedAt,
    sourceFile: artifact.source.file,
    sourceSha256: artifact.source.sha256,
    snapshotFile: path.basename(options.mergedSnapshotFile),
    snapshotSha256: sha256(compressed),
    snapshotBytes: compressed.byteLength,
    summary: artifact.summary,
  });
  await atomicWrite(options.mergedManifestFile, json(manifest));
  await readVerifiedCatalogPriceSnapshot(
    options.mergedSnapshotFile,
    definition,
    options.mergedManifestFile,
  );
  console.log(json({
    result: true,
    mode: options.mode,
    baseSnapshot: options.baseSnapshotFile,
    snapshotFile: options.mergedSnapshotFile,
    manifestFile: options.mergedManifestFile,
    sources: Object.fromEntries(
      captures.map(({ capture }) => [capture.site, capture.summary]),
    ),
    summary: artifact.summary,
  }));
  return manifest;
}

async function main(): Promise<void> {
  const options = parseCatalogMarketPriceOptions(process.argv.slice(2));
  const source = await loadSource(options);
  if (options.mode === 'dry-run') {
    console.log(json({
      result: true,
      mode: options.mode,
      source: options.source,
      site: options.site,
      sourceFile: options.sourceFile,
      sourceSha256:
        MARKET_CATALOG_SOURCES[options.source].definition.sourceSha256,
      targets: source.targets.length,
      manufacturerCounts: source.targets.reduce<Record<string, number>>(
        (counts, target) => ({
          ...counts,
          [target.manufacturerNorm]:
            (counts[target.manufacturerNorm] ?? 0) + 1,
        }),
        {},
      ),
      delayMs: options.delayMs,
      jitterMs: options.jitterMs,
      stateFile: options.stateFile,
      captureFile: options.captureFile,
      mergedSnapshotFile: options.mergedSnapshotFile,
    }));
    return;
  }
  if (options.mode === 'run') {
    await runCollection(options, source);
    return;
  }
  if (options.mode === 'verify') {
    await verifyCapture(options, source);
    return;
  }
  await mergeCaptures(options, source);
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
