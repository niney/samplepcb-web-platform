import { createHash, createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  BomJobResponse,
  BomQuoteComparisonResponse,
  BomQuoteCreateResponse,
  BomQuoteDetailResponse,
  BomQuoteItemCandidatesResponse,
  type BomJobResponseType,
  type BomQuoteDetailType,
  type BomQuoteItemCandidatesType,
} from '@sp/api-contract';
import {
  bomQuoteItemMatchGroup,
  summarizeBomQuoteItems,
  type BomQuotePresentationStats,
} from '@sp/utils';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const SUPPORTED_EXTENSIONS = new Set(['.xlsx', '.xlsm', '.xls', '.csv', '.tsv', '.bom']);
const PHP_ME_RESPONSE = z.object({ token: z.string().min(1) });

export type BomVerificationAuthMode = 'token' | 'cookie' | 'local-token';
export type BomVerificationFileStatus = 'completed' | 'failed';

export interface BomVerificationAuthProvider {
  readonly mode: BomVerificationAuthMode;
  getToken(): Promise<string>;
}

export interface BomUploadVerificationOptions {
  inputPath: string;
  outputDirectory: string;
  repoRoot: string;
  baseUrl: string;
  auth: BomVerificationAuthProvider;
  fileTimeoutMs: number;
  requestTimeoutMs: number;
  parsePollMs: number;
  quotePollMs: number;
  candidateConcurrency: number;
  retryPartData: boolean;
  compareProcurementModes?: boolean;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  onProgress?: (message: string) => void;
}

export interface BomVerificationFileSummary {
  quoteId: string;
  jobId: string;
  states: {
    buildStatus: BomQuoteDetailType['buildStatus'];
    enrichStatus: BomQuoteDetailType['enrichStatus'];
    partDataStatus: BomQuoteDetailType['partDataStatus'];
  };
  server: {
    itemCount: number;
    includedCount: number;
    matchedCount: number;
    uncostedCount: number;
    supplierSearchLimitedCount: number;
  };
  screen: BomQuotePresentationStats;
  parsedSheetCount: number;
  selectedSheetCount: number;
  candidateCapture: {
    requested: number;
    succeeded: number;
    failed: number;
    skippedReason: string | null;
  };
  comparison: {
    rows: number;
    matched: number;
    attention: number;
    notFound: number;
  };
  procurementModeComparison: ProcurementModeComparison | null;
  checks: {
    code: string;
    passed: boolean;
    detail: string;
  }[];
  warnings: string[];
}

export interface BomVerificationFileResult {
  sourcePath: string;
  sourceSha256: string;
  sourceBytes: number;
  artifactDirectory: string;
  status: BomVerificationFileStatus;
  quoteId: string | null;
  jobId: string | null;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  error: string | null;
  summary: BomVerificationFileSummary | null;
}

export interface BomVerificationManifest {
  schemaVersion: 'sp-bom-verification-v1';
  startedAt: string;
  completedAt: string | null;
  gitCommit: string | null;
  inputPath: string;
  outputDirectory: string;
  baseUrl: string;
  authMode: BomVerificationAuthMode;
  sheetSelectionPolicy: 'all-parsed';
  procurementModePolicy: 'sample-only' | 'sample-then-mass-reevaluation';
  fileCount: number;
  completedCount: number;
  failedCount: number;
  files: BomVerificationFileResult[];
}

interface ApiTraceEntry {
  sequence: number;
  startedAt: string;
  elapsedMs: number;
  method: string;
  path: string;
  schema: string;
  status: number | null;
  ok: boolean;
  error: string | null;
}

interface ApiPayload {
  kind: 'json' | 'form';
  value: unknown;
}

interface CandidateCapture {
  itemId: string;
  ok: boolean;
  error: string | null;
  data: BomQuoteItemCandidatesType | null;
}

interface ComparisonCapture {
  pages: unknown[];
  rowCount: number;
  matched: number;
  attention: number;
  notFound: number;
}

export interface ProcurementModeComparison {
  sampleFinalTotal: number;
  massFinalTotal: number;
  selectedCandidateChangedCount: number;
  selectedCandidateSemanticChangedCount: number;
  selectedOfferChangedCount: number;
  selectedPackagingChangedCount: number;
  technicalPreselectionKeyChangedCount: number;
  technicalPreselectionChangedCount: number;
  pinnedOfferChangedCount: number;
  sampleReelSelectedCount: number;
  massReelSelectedCount: number;
  reelPreferredReasonCount: number;
  reelUnavailableReasonCount: number;
}

class VerifierApiError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly responseBody: unknown;

  constructor(status: number, endpoint: string, responseBody: unknown) {
    super(`API ${String(status)}: ${endpoint} — ${apiErrorText(responseBody)}`);
    this.name = 'VerifierApiError';
    this.status = status;
    this.endpoint = endpoint;
    this.responseBody = responseBody;
  }
}

class VerificationApiClient {
  private sequence = 0;

  constructor(
    private readonly baseUrl: string,
    private readonly auth: BomVerificationAuthProvider,
    private readonly tracePath: string,
    private readonly requestTimeoutMs: number,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async request(
    method: 'GET' | 'POST' | 'PATCH',
    endpoint: string,
    schema: string,
    payload?: ApiPayload,
  ): Promise<unknown> {
    const sequence = ++this.sequence;
    const startedAt = new Date().toISOString();
    const started = Date.now();
    let status: number | null = null;

    try {
      const headers = new Headers({
        accept: 'application/json',
        authorization: `Bearer ${await this.auth.getToken()}`,
      });
      const init: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      };
      if (payload?.kind === 'json') {
        headers.set('content-type', 'application/json');
        init.body = JSON.stringify(payload.value);
      } else if (payload?.kind === 'form') {
        init.body = payload.value as FormData;
      }

      const response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, init);
      status = response.status;
      const text = await response.text();
      const body = parseJsonResponse(text, endpoint);
      await this.appendTrace({
        sequence,
        startedAt,
        elapsedMs: Date.now() - started,
        method,
        path: endpoint,
        schema,
        status,
        ok: response.ok,
        error: response.ok ? null : apiErrorText(body),
      });
      if (!response.ok) throw new VerifierApiError(response.status, endpoint, body);
      return body;
    } catch (error) {
      if (error instanceof VerifierApiError) throw error;
      const message = errorText(error);
      await this.appendTrace({
        sequence,
        startedAt,
        elapsedMs: Date.now() - started,
        method,
        path: endpoint,
        schema,
        status,
        ok: false,
        error: message,
      });
      throw new Error(`${method} ${endpoint} 실패: ${message}`, { cause: error });
    }
  }

  private async appendTrace(entry: ApiTraceEntry): Promise<void> {
    await appendFile(this.tracePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

export function createStaticVerificationAuth(token: string): BomVerificationAuthProvider {
  const value = token.trim();
  if (value === '') throw new Error('BOM_VERIFY_TOKEN이 비어 있습니다.');
  return {
    mode: 'token',
    getToken: () => Promise.resolve(value),
  };
}

export function createLocalVerificationToken(
  secret: string,
  memberId: string,
  issuedAt = Math.floor(Date.now() / 1000),
): string {
  const normalizedSecret = secret.trim();
  const normalizedMemberId = memberId.trim();
  if (normalizedSecret === '') throw new Error('JWT_SECRET이 비어 있습니다.');
  if (normalizedMemberId === '') throw new Error('로컬 검증 회원 ID가 비어 있습니다.');
  const header = base64UrlJson({ alg: 'HS256', typ: 'JWT' });
  const payload = base64UrlJson({
    mbId: normalizedMemberId,
    mbNick: normalizedMemberId,
    level: 2,
    isAdmin: false,
    iat: issuedAt,
    exp: issuedAt + 600,
  });
  const unsigned = `${header}.${payload}`;
  const signature = createHmac('sha256', normalizedSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

export function createLocalVerificationAuth(
  baseUrl: string,
  secret: string,
  memberId: string,
): BomVerificationAuthProvider {
  assertLocalTokenHost(baseUrl);
  return {
    mode: 'local-token',
    getToken: () => Promise.resolve(createLocalVerificationToken(secret, memberId)),
  };
}

export function createCookieVerificationAuth(
  baseUrl: string,
  cookie: string,
  fetchImpl: typeof fetch = fetch,
  requestTimeoutMs = 30_000,
): BomVerificationAuthProvider {
  const normalizedCookie = cookie.trim();
  if (normalizedCookie === '') throw new Error('BOM_VERIFY_COOKIE가 비어 있습니다.');
  let cachedToken: string | null = null;
  let refreshAt = 0;

  return {
    mode: 'cookie',
    async getToken(): Promise<string> {
      if (cachedToken !== null && Date.now() < refreshAt) return cachedToken;
      const response = await fetchImpl(`${normalizeBaseUrl(baseUrl)}/spcb/api/me`, {
        method: 'GET',
        headers: { accept: 'application/json', cookie: normalizedCookie },
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
      const text = await response.text();
      const raw = parseJsonResponse(text, '/spcb/api/me');
      if (!response.ok) {
        throw new Error(`PHP 인증 브리지 ${String(response.status)}: ${apiErrorText(raw)}`);
      }
      const parsed = PHP_ME_RESPONSE.parse(raw);
      cachedToken = parsed.token;
      refreshAt = Math.max(Date.now(), jwtRefreshAt(parsed.token));
      return parsed.token;
    },
  };
}

export async function discoverBomFiles(inputPath: string): Promise<string[]> {
  const resolved = path.resolve(inputPath);
  const inputStat = await stat(resolved);
  if (inputStat.isFile()) {
    if (!SUPPORTED_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
      throw new Error(`지원하지 않는 BOM 형식입니다: ${resolved}`);
    }
    return [resolved];
  }
  if (!inputStat.isDirectory()) throw new Error(`파일 또는 폴더가 아닙니다: ${resolved}`);

  const found: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, 'ko'));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        found.push(absolute);
      }
    }
  };
  await visit(resolved);
  if (found.length === 0) throw new Error(`지원하는 BOM 파일을 찾지 못했습니다: ${resolved}`);
  return found;
}

export async function runBomUploadVerification(
  options: BomUploadVerificationOptions,
): Promise<BomVerificationManifest> {
  const normalizedOptions = normalizeOptions(options);
  const files = await discoverBomFiles(normalizedOptions.inputPath);
  await assertOutputDirectoryAvailable(normalizedOptions.outputDirectory);
  await mkdir(normalizedOptions.outputDirectory, { recursive: true });
  const manifestPath = path.join(normalizedOptions.outputDirectory, 'manifest.json');
  const startedAt = new Date().toISOString();
  const manifest: BomVerificationManifest = {
    schemaVersion: 'sp-bom-verification-v1',
    startedAt,
    completedAt: null,
    gitCommit: await currentGitCommit(normalizedOptions.repoRoot),
    inputPath: path.resolve(normalizedOptions.inputPath),
    outputDirectory: normalizedOptions.outputDirectory,
    baseUrl: normalizedOptions.baseUrl,
    authMode: normalizedOptions.auth.mode,
    sheetSelectionPolicy: 'all-parsed',
    procurementModePolicy: normalizedOptions.compareProcurementModes === true
      ? 'sample-then-mass-reevaluation'
      : 'sample-only',
    fileCount: files.length,
    completedCount: 0,
    failedCount: 0,
    files: [],
  };
  await writeJson(manifestPath, manifest);

  for (const [index, sourcePath] of files.entries()) {
    normalizedOptions.onProgress(
      `[${String(index + 1)}/${String(files.length)}] ${path.basename(sourcePath)} 업로드 검증 시작`,
    );
    const result = await verifyOneFile(sourcePath, index, normalizedOptions);
    manifest.files.push(result);
    if (result.status === 'completed') manifest.completedCount += 1;
    else manifest.failedCount += 1;
    await writeJson(manifestPath, manifest);
    normalizedOptions.onProgress(
      `[${String(index + 1)}/${String(files.length)}] ${path.basename(sourcePath)} ${result.status === 'completed' ? '완료' : `실패: ${result.error ?? '알 수 없는 오류'}`}`,
    );
  }

  manifest.completedAt = new Date().toISOString();
  await writeJson(manifestPath, manifest);
  await writeFile(
    path.join(normalizedOptions.outputDirectory, 'report.md'),
    buildRunReport(manifest),
    'utf8',
  );
  return manifest;
}

interface NormalizedOptions extends Omit<
  BomUploadVerificationOptions,
  'fetchImpl' | 'sleep' | 'onProgress'
> {
  fetchImpl: typeof fetch;
  sleep: (milliseconds: number) => Promise<void>;
  onProgress: (message: string) => void;
}

function normalizeOptions(options: BomUploadVerificationOptions): NormalizedOptions {
  const positive = (value: number, name: string): number => {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name}은(는) 양수여야 합니다.`);
    return value;
  };
  return {
    ...options,
    inputPath: path.resolve(options.inputPath),
    outputDirectory: path.resolve(options.outputDirectory),
    repoRoot: path.resolve(options.repoRoot),
    baseUrl: normalizeBaseUrl(options.baseUrl),
    fileTimeoutMs: positive(options.fileTimeoutMs, 'fileTimeoutMs'),
    requestTimeoutMs: positive(options.requestTimeoutMs, 'requestTimeoutMs'),
    parsePollMs: positive(options.parsePollMs, 'parsePollMs'),
    quotePollMs: positive(options.quotePollMs, 'quotePollMs'),
    candidateConcurrency: Math.max(1, Math.floor(positive(
      options.candidateConcurrency,
      'candidateConcurrency',
    ))),
    fetchImpl: options.fetchImpl ?? fetch,
    sleep: options.sleep ?? ((milliseconds) => new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    })),
    onProgress: options.onProgress ?? (() => undefined),
  };
}

async function verifyOneFile(
  sourcePath: string,
  index: number,
  options: NormalizedOptions,
): Promise<BomVerificationFileResult> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const buffer = await readFile(sourcePath);
  const sourceSha256 = createHash('sha256').update(buffer).digest('hex');
  const artifactDirectory = path.join(
    options.outputDirectory,
    `${String(index + 1).padStart(3, '0')}-${safePathSegment(path.parse(sourcePath).name)}-${sourceSha256.slice(0, 8)}`,
  );
  await mkdir(artifactDirectory, { recursive: true });
  await mkdir(path.join(artifactDirectory, 'candidates'), { recursive: true });
  await mkdir(path.join(artifactDirectory, 'comparison-pages'), { recursive: true });
  if (options.compareProcurementModes === true) {
    await mkdir(path.join(artifactDirectory, 'candidates-sample'), { recursive: true });
    await mkdir(path.join(artifactDirectory, 'candidates-mass'), { recursive: true });
    await mkdir(path.join(artifactDirectory, 'comparison-pages-sample'), { recursive: true });
    await mkdir(path.join(artifactDirectory, 'comparison-pages-mass'), { recursive: true });
  }
  await writeJson(path.join(artifactDirectory, 'source.json'), {
    path: sourcePath,
    fileName: path.basename(sourcePath),
    bytes: buffer.byteLength,
    sha256: sourceSha256,
  });

  const client = new VerificationApiClient(
    options.baseUrl,
    options.auth,
    path.join(artifactDirectory, 'api-trace.jsonl'),
    options.requestTimeoutMs,
    options.fetchImpl,
  );
  const deadline = started + options.fileTimeoutMs;
  let quoteId: string | null = null;
  let jobId: string | null = null;

  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([new Uint8Array(buffer)], { type: mimeTypeFor(sourcePath) }),
      path.basename(sourcePath),
    );
    form.append('procurementMode', 'sample');
    const createRaw = await client.request(
      'POST',
      '/api/bom/quotes',
      'BomQuoteCreateResponse',
      { kind: 'form', value: form },
    );
    await writeJson(path.join(artifactDirectory, 'upload.json'), createRaw);
    const created = BomQuoteCreateResponse.parse(createRaw);
    quoteId = created.data.quoteId;
    jobId = created.data.jobId;

    const job = await pollJob(
      client,
      jobId,
      deadline,
      options.parsePollMs,
      options.sleep,
      path.join(artifactDirectory, 'job-snapshots.jsonl'),
    );
    await writeJson(path.join(artifactDirectory, 'job-final.json'), job);
    if (job.data.status === 'failed') {
      throw new Error(`BOM 분석 실패: ${job.data.error ?? job.data.message}`);
    }

    ensureBeforeDeadline(deadline, '시트 분석 결과 준비');
    const preparedRaw = await client.request(
      'POST',
      `/api/bom/quotes/${encodeURIComponent(quoteId)}/prepare`,
      'BomQuoteDetailResponse',
    );
    await writeJson(path.join(artifactDirectory, 'quote-prepared.json'), preparedRaw);
    const prepared = BomQuoteDetailResponse.parse(preparedRaw);
    const selectedSheetIndexes = prepared.data.sheets
      .filter((sheet) => sheet.status === 'parsed')
      .map((sheet) => sheet.sheetIndex)
      .sort((left, right) => left - right);
    if (selectedSheetIndexes.length === 0) {
      throw new Error('BOM으로 인식된 시트가 없습니다.');
    }

    ensureBeforeDeadline(deadline, '선택 시트 계산');
    const builtRaw = await client.request(
      'POST',
      `/api/bom/quotes/${encodeURIComponent(quoteId)}/build`,
      'BomQuoteDetailResponse',
      { kind: 'json', value: { sheetIndexes: selectedSheetIndexes } },
    );
    await writeJson(path.join(artifactDirectory, 'quote-built.json'), builtRaw);
    const built = BomQuoteDetailResponse.parse(builtRaw);
    let finalDetail = built.data;

    if (!quoteHasSettled(finalDetail)) {
      const settled = await pollQuote(
        client,
        quoteId,
        deadline,
        options.quotePollMs,
        options.sleep,
        path.join(artifactDirectory, 'quote-snapshots.jsonl'),
      );
      finalDetail = settled.detail;
    }
    if (finalDetail.buildStatus === 'failed') throw new Error('견적 시트 계산이 실패했습니다.');

    if (finalDetail.partDataStatus !== 'ready' && options.retryPartData) {
      try {
        ensureBeforeDeadline(deadline, '부품 정보 준비 재시도');
        const retryRaw = await client.request(
          'POST',
          `/api/bom/quotes/${encodeURIComponent(quoteId)}/part-data/prepare`,
          'BomQuoteDetailResponse',
        );
        await writeJson(path.join(artifactDirectory, 'part-data-prepare.json'), retryRaw);
        const retried = BomQuoteDetailResponse.parse(retryRaw);
        finalDetail = retried.data;
        if (!quoteHasSettled(finalDetail)) {
          const settled = await pollQuote(
            client,
            quoteId,
            deadline,
            options.quotePollMs,
            options.sleep,
            path.join(artifactDirectory, 'quote-snapshots.jsonl'),
          );
          finalDetail = settled.detail;
        }
      } catch (error) {
        await writeJson(path.join(artifactDirectory, 'part-data-prepare-error.json'), {
          error: errorText(error),
          ...(error instanceof VerifierApiError ? {
            status: error.status,
            response: error.responseBody,
          } : {}),
        });
      }
    }

    ensureBeforeDeadline(deadline, '최종 견적 조회');
    const latestRaw = await client.request(
      'GET',
      `/api/bom/quotes/${encodeURIComponent(quoteId)}`,
      'BomQuoteDetailResponse',
    );
    const latest = BomQuoteDetailResponse.parse(latestRaw);
    finalDetail = latest.data;
    let finalDetailRaw: unknown = latestRaw;
    if (!quoteHasSettled(finalDetail)) {
      const settled = await pollQuote(
        client,
        quoteId,
        deadline,
        options.quotePollMs,
        options.sleep,
        path.join(artifactDirectory, 'quote-snapshots.jsonl'),
      );
      finalDetailRaw = settled.raw;
      finalDetail = settled.detail;
    }
    let procurementModeComparison: ProcurementModeComparison | null = null;
    let candidateCaptures: CandidateCapture[];
    let comparison: ComparisonCapture;
    if (options.compareProcurementModes === true) {
      if (finalDetail.procurementMode !== 'sample') {
        throw new Error(`샘플 검증 시작 모드가 아닙니다: ${finalDetail.procurementMode}`);
      }
      await writeJson(path.join(artifactDirectory, 'quote-detail-sample.json'), finalDetailRaw);
      const sampleDetail = finalDetail;
      const sampleCandidateCaptures = sampleDetail.partDataStatus === 'ready'
        ? await captureCandidates(
          client,
          quoteId,
          sampleDetail,
          artifactDirectory,
          deadline,
          options,
          ['candidates-sample'],
        )
        : [];
      await captureComparison(
        client,
        quoteId,
        artifactDirectory,
        deadline,
        ['comparison-pages-sample'],
        ['comparison-sample.json'],
      );

      ensureBeforeDeadline(deadline, '양산 조달 모드 재평가');
      const massRaw = await client.request(
        'PATCH',
        `/api/bom/quotes/${encodeURIComponent(quoteId)}`,
        'BomQuoteDetailResponse',
        { kind: 'json', value: { procurementMode: 'mass' } },
      );
      const mass = BomQuoteDetailResponse.parse(massRaw);
      if (mass.data.procurementMode !== 'mass') {
        throw new Error(`양산 모드 전환이 반영되지 않았습니다: ${mass.data.procurementMode}`);
      }
      finalDetailRaw = massRaw;
      finalDetail = mass.data;
      await writeJson(path.join(artifactDirectory, 'quote-detail-mass.json'), massRaw);
      candidateCaptures = finalDetail.partDataStatus === 'ready'
        ? await captureCandidates(
            client,
            quoteId,
            finalDetail,
            artifactDirectory,
            deadline,
            options,
            ['candidates-mass', 'candidates'],
          )
        : [];
      procurementModeComparison = compareProcurementModes(
        sampleDetail,
        finalDetail,
        sampleCandidateCaptures,
        candidateCaptures,
      );
      await writeJson(
        path.join(artifactDirectory, 'procurement-mode-comparison.json'),
        procurementModeComparison,
      );
      comparison = await captureComparison(
        client,
        quoteId,
        artifactDirectory,
        deadline,
        ['comparison-pages-mass', 'comparison-pages'],
        ['comparison-mass.json', 'comparison.json'],
      );
    } else {
      candidateCaptures = finalDetail.partDataStatus === 'ready'
        ? await captureCandidates(
            client,
            quoteId,
            finalDetail,
            artifactDirectory,
            deadline,
            options,
          )
        : [];
      comparison = await captureComparison(
        client,
        quoteId,
        artifactDirectory,
        deadline,
      );
    }
    await writeJson(path.join(artifactDirectory, 'quote-detail.json'), finalDetailRaw);
    const summary = buildFileSummary(
      quoteId,
      jobId,
      finalDetail,
      candidateCaptures,
      comparison,
      selectedSheetIndexes.length,
      procurementModeComparison,
    );
    await writeJson(path.join(artifactDirectory, 'summary.json'), summary);
    await writeFile(
      path.join(artifactDirectory, 'report.md'),
      buildFileReport(sourcePath, summary, finalDetail, candidateCaptures),
      'utf8',
    );

    return {
      sourcePath,
      sourceSha256,
      sourceBytes: buffer.byteLength,
      artifactDirectory,
      status: 'completed',
      quoteId,
      jobId,
      startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      error: null,
      summary,
    };
  } catch (error) {
    const message = errorText(error);
    await writeJson(path.join(artifactDirectory, 'error.json'), {
      error: message,
      quoteId,
      jobId,
      ...(error instanceof VerifierApiError ? {
        status: error.status,
        endpoint: error.endpoint,
        response: error.responseBody,
      } : {}),
    });
    return {
      sourcePath,
      sourceSha256,
      sourceBytes: buffer.byteLength,
      artifactDirectory,
      status: 'failed',
      quoteId,
      jobId,
      startedAt,
      completedAt: new Date().toISOString(),
      elapsedMs: Date.now() - started,
      error: message,
      summary: null,
    };
  }
}

async function pollJob(
  client: VerificationApiClient,
  jobId: string,
  deadline: number,
  intervalMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  snapshotsPath: string,
): Promise<BomJobResponseType> {
  for (;;) {
    ensureBeforeDeadline(deadline, 'BOM 분석');
    const raw = await client.request(
      'GET',
      `/api/bom/jobs/${encodeURIComponent(jobId)}`,
      'BomJobResponse',
    );
    const parsed = BomJobResponse.parse(raw);
    await appendFile(snapshotsPath, `${JSON.stringify(raw)}\n`, 'utf8');
    if (parsed.data.status !== 'running') return parsed;
    await sleepBeforeDeadline(intervalMs, deadline, sleep, 'BOM 분석');
  }
}

async function pollQuote(
  client: VerificationApiClient,
  quoteId: string,
  deadline: number,
  intervalMs: number,
  sleep: (milliseconds: number) => Promise<void>,
  snapshotsPath: string,
): Promise<{ raw: unknown; detail: BomQuoteDetailType }> {
  for (;;) {
    ensureBeforeDeadline(deadline, '견적 보강');
    const raw = await client.request(
      'GET',
      `/api/bom/quotes/${encodeURIComponent(quoteId)}`,
      'BomQuoteDetailResponse',
    );
    const parsed = BomQuoteDetailResponse.parse(raw);
    await appendFile(snapshotsPath, `${JSON.stringify(raw)}\n`, 'utf8');
    if (quoteHasSettled(parsed.data)) return { raw, detail: parsed.data };
    await sleepBeforeDeadline(intervalMs, deadline, sleep, '견적 보강');
  }
}

function quoteHasSettled(detail: BomQuoteDetailType): boolean {
  if (detail.buildStatus === 'failed') return true;
  return detail.buildStatus === 'ready'
    && detail.enrichStatus !== 'searching'
    && detail.partDataStatus !== 'preparing';
}

async function captureCandidates(
  client: VerificationApiClient,
  quoteId: string,
  detail: BomQuoteDetailType,
  artifactDirectory: string,
  deadline: number,
  options: NormalizedOptions,
  directoryNames: readonly string[] = ['candidates'],
): Promise<CandidateCapture[]> {
  return mapLimit(detail.items, options.candidateConcurrency, async (item) => {
    ensureBeforeDeadline(deadline, `후보 ${item.id} 조회`);
    try {
      const raw = await client.request(
        'GET',
        `/api/bom/quotes/${encodeURIComponent(quoteId)}/items/${encodeURIComponent(item.id)}/candidates`,
        'BomQuoteItemCandidatesResponse',
      );
      await Promise.all(directoryNames.map((directoryName) =>
        writeJson(path.join(artifactDirectory, directoryName, `${item.id}.json`), raw)));
      return {
        itemId: item.id,
        ok: true,
        error: null,
        data: BomQuoteItemCandidatesResponse.parse(raw).data,
      };
    } catch (error) {
      const message = errorText(error);
      const errorPayload = {
        error: message,
        ...(error instanceof VerifierApiError ? {
          status: error.status,
          response: error.responseBody,
        } : {}),
      };
      await Promise.all(directoryNames.map((directoryName) =>
        writeJson(
          path.join(artifactDirectory, directoryName, `${item.id}.error.json`),
          errorPayload,
        )));
      return { itemId: item.id, ok: false, error: message, data: null };
    }
  });
}

async function captureComparison(
  client: VerificationApiClient,
  quoteId: string,
  artifactDirectory: string,
  deadline: number,
  pageDirectoryNames: readonly string[] = ['comparison-pages'],
  outputFileNames: readonly string[] = ['comparison.json'],
): Promise<ComparisonCapture> {
  const pages: unknown[] = [];
  let page = 1;
  let rowCount = 0;
  let matched = 0;
  let attention = 0;
  let notFound = 0;
  let totalPages: number;

  do {
    ensureBeforeDeadline(deadline, '전체 후보 비교 조회');
    const raw = await client.request(
      'GET',
      `/api/bom/quotes/${encodeURIComponent(quoteId)}/comparison?page=${String(page)}&pageSize=50`,
      'BomQuoteComparisonResponse',
    );
    await Promise.all(pageDirectoryNames.map((directoryName) =>
      writeJson(
        path.join(artifactDirectory, directoryName, `${String(page).padStart(3, '0')}.json`),
        raw,
      )));
    const parsed = BomQuoteComparisonResponse.parse(raw);
    pages.push(raw);
    rowCount += parsed.data.rows.length;
    totalPages = parsed.data.totalPages;
    if (page === 1) {
      matched = parsed.data.summary.matched;
      attention = parsed.data.summary.attention;
      notFound = parsed.data.summary.notFound;
    }
    page += 1;
  } while (page <= totalPages);

  await Promise.all(outputFileNames.map((fileName) =>
    writeJson(path.join(artifactDirectory, fileName), { pages })));
  return { pages, rowCount, matched, attention, notFound };
}

function selectedOfferIdentity(
  item: BomQuoteDetailType['items'][number],
): string | null {
  const offer = item.selectedOffer;
  if (offer === null) return null;
  return offer.offerKey
    ?? [offer.supplier, offer.supplierSku, offer.packaging ?? ''].join('\u0000');
}

function selectedPackagingIsReel(
  item: BomQuoteDetailType['items'][number],
): boolean {
  const packaging = item.selectedOffer?.packaging?.toLocaleLowerCase() ?? '';
  if (!packaging.includes('reel')) return false;
  return !/(?:cut\s*tape|bulk|tray|tube|bag|box)/u.test(packaging);
}

function normalizedCandidateText(value: string | null): string {
  return (value ?? '').normalize('NFKC').trim().toLocaleUpperCase();
}

function candidateSemanticKey(
  item: BomQuoteDetailType['items'][number],
  capture: CandidateCapture | undefined,
  kind: 'selected' | 'technical-preselection',
): string | null {
  const candidateKey = kind === 'selected'
    ? item.selectedCandidateKey
    : item.matchEvidence?.technicalPreselectionCandidateKey ?? null;
  if (candidateKey === null) return null;
  const candidates = capture?.data?.candidates ?? [];
  const candidate = candidates.find((entry) => entry.candidateKey === candidateKey)
    ?? (kind === 'technical-preselection'
      ? candidates.find((entry) => entry.selectionRecommendation === 'preselect')
      : undefined);
  if (candidate === undefined) return `key:${candidateKey}`;
  return [
    normalizedCandidateText(candidate.mpn),
    normalizedCandidateText(candidate.manufacturerName),
    candidate.technicalEvidenceKey,
  ].join('\u0000');
}

function compareProcurementModes(
  sample: BomQuoteDetailType,
  mass: BomQuoteDetailType,
  sampleCaptures: readonly CandidateCapture[],
  massCaptures: readonly CandidateCapture[],
): ProcurementModeComparison {
  const massById = new Map(mass.items.map((item) => [item.id, item] as const));
  const sampleCaptureById = new Map(sampleCaptures.map((capture) => [capture.itemId, capture]));
  const massCaptureById = new Map(massCaptures.map((capture) => [capture.itemId, capture]));
  let selectedCandidateChangedCount = 0;
  let selectedCandidateSemanticChangedCount = 0;
  let selectedOfferChangedCount = 0;
  let selectedPackagingChangedCount = 0;
  let technicalPreselectionKeyChangedCount = 0;
  let technicalPreselectionChangedCount = 0;
  let pinnedOfferChangedCount = 0;
  for (const sampleItem of sample.items) {
    const massItem = massById.get(sampleItem.id);
    if (massItem === undefined) continue;
    const sampleCapture = sampleCaptureById.get(sampleItem.id);
    const massCapture = massCaptureById.get(massItem.id);
    if (sampleItem.selectedCandidateKey !== massItem.selectedCandidateKey) {
      selectedCandidateChangedCount += 1;
    }
    if (
      candidateSemanticKey(sampleItem, sampleCapture, 'selected')
      !== candidateSemanticKey(massItem, massCapture, 'selected')
    ) {
      selectedCandidateSemanticChangedCount += 1;
    }
    const sampleOffer = selectedOfferIdentity(sampleItem);
    const massOffer = selectedOfferIdentity(massItem);
    if (sampleOffer !== massOffer) selectedOfferChangedCount += 1;
    if (sampleItem.selectedOffer?.packaging !== massItem.selectedOffer?.packaging) {
      selectedPackagingChangedCount += 1;
    }
    if (
      sampleItem.matchEvidence?.technicalPreselectionCandidateKey
      !== massItem.matchEvidence?.technicalPreselectionCandidateKey
    ) {
      technicalPreselectionKeyChangedCount += 1;
    }
    if (
      candidateSemanticKey(sampleItem, sampleCapture, 'technical-preselection')
      !== candidateSemanticKey(massItem, massCapture, 'technical-preselection')
    ) {
      technicalPreselectionChangedCount += 1;
    }
    if (sampleItem.selectedOffer?.pinned === true && sampleOffer !== massOffer) {
      pinnedOfferChangedCount += 1;
    }
  }
  return {
    sampleFinalTotal: sample.finalTotal,
    massFinalTotal: mass.finalTotal,
    selectedCandidateChangedCount,
    selectedCandidateSemanticChangedCount,
    selectedOfferChangedCount,
    selectedPackagingChangedCount,
    technicalPreselectionKeyChangedCount,
    technicalPreselectionChangedCount,
    pinnedOfferChangedCount,
    sampleReelSelectedCount: sample.items.filter(selectedPackagingIsReel).length,
    massReelSelectedCount: mass.items.filter(selectedPackagingIsReel).length,
    reelPreferredReasonCount: mass.items.filter((item) =>
      item.matchEvidence?.decisionReasonCodes.includes(
        'mass-production-reel-preferred',
      ) === true).length,
    reelUnavailableReasonCount: mass.items.filter((item) =>
      item.matchEvidence?.decisionReasonCodes.includes(
        'mass-production-reel-unavailable',
      ) === true).length,
  };
}

function buildFileSummary(
  quoteId: string,
  jobId: string,
  detail: BomQuoteDetailType,
  candidateCaptures: readonly CandidateCapture[],
  comparison: ComparisonCapture,
  selectedSheetCount: number,
  procurementModeComparison: ProcurementModeComparison | null = null,
): BomVerificationFileSummary {
  const screen = summarizeBomQuoteItems(detail.items);
  const succeeded = candidateCaptures.filter((capture) => capture.ok).length;
  const requested = detail.partDataStatus === 'ready' ? detail.items.length : 0;
  const warnings: string[] = [];
  if (detail.partDataStatus !== 'ready') {
    warnings.push(`부품 정보 상태가 ${detail.partDataStatus}라 행별 후보 API를 열 수 없었습니다.`);
  }
  if (succeeded !== requested) {
    warnings.push(`행별 후보 ${String(requested)}건 중 ${String(requested - succeeded)}건을 가져오지 못했습니다.`);
  }
  if (screen.review > 0) warnings.push(`검토 필요 ${String(screen.review)}건이 있습니다.`);
  if (screen.unmatched > 0) warnings.push(`미선정 ${String(screen.unmatched)}건이 있습니다.`);
  if (detail.supplierSearchLimitedCount > 0) {
    warnings.push(`공급사 검색 제한 ${String(detail.supplierSearchLimitedCount)}건이 있습니다.`);
  }
  const extractedCount = candidateCaptures.filter((capture) => capture.data?.extraction !== null).length;
  if (requested > 0 && extractedCount < requested) {
    warnings.push(`원본 엔진 추출 근거가 없는 활성 행 ${String(requested - extractedCount)}건이 있습니다.`);
  }

  return {
    quoteId,
    jobId,
    states: {
      buildStatus: detail.buildStatus,
      enrichStatus: detail.enrichStatus,
      partDataStatus: detail.partDataStatus,
    },
    server: {
      itemCount: detail.itemCount,
      includedCount: detail.includedCount,
      matchedCount: detail.matchedCount,
      uncostedCount: detail.uncostedCount,
      supplierSearchLimitedCount: detail.supplierSearchLimitedCount,
    },
    screen,
    parsedSheetCount: detail.sheets.filter((sheet) => sheet.status === 'parsed').length,
    selectedSheetCount,
    candidateCapture: {
      requested,
      succeeded,
      failed: requested - succeeded,
      skippedReason: detail.partDataStatus === 'ready'
        ? null
        : `partDataStatus=${detail.partDataStatus}`,
    },
    comparison: {
      rows: comparison.rowCount,
      matched: comparison.matched,
      attention: comparison.attention,
      notFound: comparison.notFound,
    },
    procurementModeComparison,
    checks: [
      {
        code: 'build-ready',
        passed: detail.buildStatus === 'ready',
        detail: `buildStatus=${detail.buildStatus}`,
      },
      {
        code: 'enrichment-terminal',
        passed: detail.enrichStatus !== 'searching',
        detail: `enrichStatus=${detail.enrichStatus}`,
      },
      {
        code: 'screen-item-count',
        passed: screen.total === detail.items.length,
        detail: `화면 집계=${String(screen.total)}, 상세 행=${String(detail.items.length)}`,
      },
      {
        code: 'candidate-capture-complete',
        passed: requested > 0 && succeeded === requested,
        detail: `성공=${String(succeeded)}/${String(requested)}`,
      },
      {
        code: 'comparison-capture-complete',
        passed: comparison.rowCount === detail.items.length,
        detail: `비교 행=${String(comparison.rowCount)}, 상세 행=${String(detail.items.length)}`,
      },
      ...(procurementModeComparison === null
        ? []
        : [
            {
              code: 'procurement-technical-preselection-stable',
              passed: procurementModeComparison.technicalPreselectionChangedCount === 0,
              detail: `기술 의미 변경=${String(procurementModeComparison.technicalPreselectionChangedCount)}건, 키 정규화=${String(procurementModeComparison.technicalPreselectionKeyChangedCount)}건`,
            },
            {
              code: 'procurement-pinned-offer-stable',
              passed: procurementModeComparison.pinnedOfferChangedCount === 0,
              detail: `고정 오퍼 변경=${String(procurementModeComparison.pinnedOfferChangedCount)}건`,
            },
          ]),
    ],
    warnings,
  };
}

function buildFileReport(
  sourcePath: string,
  summary: BomVerificationFileSummary,
  detail: BomQuoteDetailType,
  captures: readonly CandidateCapture[],
): string {
  const captureByItem = new Map(captures.map((capture) => [capture.itemId, capture]));
  const lines = [
    `# BOM 업로드 검증 — ${escapeMarkdown(path.basename(sourcePath))}`,
    '',
    `- 원본: \`${escapeMarkdown(sourcePath)}\``,
    `- 견적 ID: ${summary.quoteId}`,
    `- 엔진 잡 ID: ${summary.jobId}`,
    `- 최종 조달 모드: ${detail.procurementMode}`,
    `- 최종 상태: build=${summary.states.buildStatus}, enrich=${summary.states.enrichStatus}, partData=${summary.states.partDataStatus}`,
    `- 자동 선택 시트 정책: BOM으로 인식된 시트 전체(${String(summary.selectedSheetCount)}개)`,
    '',
    '## 화면과 같은 결과 집계',
    '',
    '| 전체 | 선정 | 검토 | 미선정 | 제외 | 재고부족 | 포함 | 미산정 | 확인필요 |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${String(summary.screen.total)} | ${String(summary.screen.matched)} | ${String(summary.screen.review)} | ${String(summary.screen.unmatched)} | ${String(summary.screen.excluded)} | ${String(summary.screen.nostock)} | ${String(summary.screen.included)} | ${String(summary.screen.uncosted)} | ${String(summary.screen.pendingReview)} |`,
    '',
    '## 기계 검증',
    '',
    ...summary.checks.map((check) => `- ${check.passed ? '✅' : '❌'} \`${check.code}\`: ${check.detail}`),
    ...(summary.procurementModeComparison === null
      ? []
      : [
          '',
          '## 샘플 ↔ 양산 재평가',
          '',
          '| 샘플 합계 | 양산 합계 | 선정 오퍼 변경 | 포장 변경 | Reel 선정(샘플→양산) | Reel 우선 | Reel 없음 |',
          '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
          `| ${String(summary.procurementModeComparison.sampleFinalTotal)} | ${String(summary.procurementModeComparison.massFinalTotal)} | ${String(summary.procurementModeComparison.selectedOfferChangedCount)} | ${String(summary.procurementModeComparison.selectedPackagingChangedCount)} | ${String(summary.procurementModeComparison.sampleReelSelectedCount)}→${String(summary.procurementModeComparison.massReelSelectedCount)} | ${String(summary.procurementModeComparison.reelPreferredReasonCount)} | ${String(summary.procurementModeComparison.reelUnavailableReasonCount)} |`,
        ]),
    '',
    '## 행별 후보 비교',
    '',
    '| 행 | 시트 | 원본 MPN / 값 | 현재 MPN | 화면 분류 | 선정 방식 | 후보 | 로컬 자체검색 | 공급사 검색 |',
    '| ---: | --- | --- | --- | --- | --- | ---: | --- | --- |',
  ];

  for (const item of detail.items) {
    const capture = captureByItem.get(item.id)?.data ?? null;
    const original = [capture?.originalMpn, capture?.originalValue]
      .filter((value): value is string => value !== null && value !== undefined && value !== '')
      .join(' / ') || '—';
    const local = capture?.localCatalogTrace === null || capture?.localCatalogTrace === undefined
      ? '—'
      : `${capture.localCatalogTrace.catalogType}:${capture.localCatalogTrace.outcome}(${String(capture.localCatalogTrace.candidateCount)})`;
    const search = capture?.searchTrace === null || capture?.searchTrace === undefined
      ? '—'
      : `${String(capture.searchTrace.attemptCount)}회${capture.searchTrace.fallbackUsed ? ' · fallback' : ''}`;
    lines.push([
      `| ${String(item.rowIdx + 1)}`,
      markdownCell(item.sourceSheetName ?? '직접 추가'),
      markdownCell(original),
      markdownCell(item.mpn === '' ? '—' : item.mpn),
      bomQuoteItemMatchGroup(item),
      markdownCell(
        `${item.selectionSource}/${capture?.selectionApplicationState ?? item.matchEvidence?.selectionApplicationState ?? 'not_selected'}`,
      ),
      String(capture?.candidates.length ?? 0),
      markdownCell(local),
      `${markdownCell(search)} |`,
    ].join(' | '));
  }

  lines.push(
    '',
    '## 주의 사항',
    '',
    ...(summary.warnings.length === 0 ? ['- 없음'] : summary.warnings.map((warning) => `- ${warning}`)),
    '',
    '## 원본 산출물',
    '',
    '- `quote-detail.json`: 화면 상세 조회와 동일한 최종 API 응답',
    ...(summary.procurementModeComparison === null
      ? []
      : [
          '- `quote-detail-sample.json` / `quote-detail-mass.json`: 동일 후보의 모드별 상세 응답',
          '- `procurement-mode-comparison.json`: 모드 전환 전후 행 단위 변화 집계',
          '- `candidates-sample/` / `candidates-mass/`: 모드별 후보 패널 API 응답',
        ]),
    '- `candidates/<itemId>.json`: 각 행 후보 패널과 동일한 API 응답',
    '- `comparison-pages/*.json`: BOM 비교 모달과 동일한 페이지별 API 응답',
    '- `api-trace.jsonl`: 요청 순서·상태·소요시간(인증정보와 응답 본문은 기록하지 않음)',
    '',
    '> 이 보고서의 집계는 sp-vue와 공용 표시 함수를 사용합니다. 기술 판정의 원본은 sp-engine 응답이며, 독립 원본 분석과의 의미 비교는 별도로 수행해야 합니다.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function buildRunReport(manifest: BomVerificationManifest): string {
  const lines = [
    '# SP BOM headless 검증 실행',
    '',
    `- 입력: \`${escapeMarkdown(manifest.inputPath)}\``,
    `- API: ${manifest.baseUrl}`,
    `- git: ${manifest.gitCommit ?? '확인 불가'}`,
    `- 인증 방식: ${manifest.authMode}`,
    `- 조달 모드 정책: ${manifest.procurementModePolicy}`,
    `- 결과: ${String(manifest.completedCount)}건 성공 / ${String(manifest.failedCount)}건 실패`,
    '',
    '| 파일 | 상태 | 견적 ID | 선정 / 검토 / 미선정 / 제외 | 상세 |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const file of manifest.files) {
    const summary = file.summary;
    const counts = summary === null
      ? '—'
      : `${String(summary.screen.matched)} / ${String(summary.screen.review)} / ${String(summary.screen.unmatched)} / ${String(summary.screen.excluded)}`;
    const relativeReport = path.relative(
      manifest.outputDirectory,
      path.join(file.artifactDirectory, 'report.md'),
    ).replaceAll('\\', '/');
    lines.push(
      `| ${markdownCell(path.basename(file.sourcePath))} | ${file.status} | ${file.quoteId ?? '—'} | ${counts} | [보고서](${encodeURI(relativeReport)}) |`,
    );
  }
  lines.push(
    '',
    '> 실제 고객 업로드 경로를 호출하므로 draft 견적, 원본 파일, API 사용량, 카탈로그 인제스트가 남습니다. 결과 폴더 삭제는 이 서버 상태를 되돌리지 않습니다.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = values[index];
      if (value === undefined) continue;
      results[index] = await mapper(value, index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(limit, values.length) },
    () => worker(),
  ));
  return results;
}

function ensureBeforeDeadline(deadline: number, phase: string): void {
  if (Date.now() >= deadline) throw new Error(`${phase} 제한 시간을 초과했습니다.`);
}

async function sleepBeforeDeadline(
  milliseconds: number,
  deadline: number,
  sleep: (milliseconds: number) => Promise<void>,
  phase: string,
): Promise<void> {
  ensureBeforeDeadline(deadline, phase);
  await sleep(Math.min(milliseconds, Math.max(1, deadline - Date.now())));
}

async function currentGitCommit(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot });
    const commit = stdout.trim();
    return commit === '' ? null : commit;
  } catch {
    return null;
  }
}

async function assertOutputDirectoryAvailable(directory: string): Promise<void> {
  try {
    const entries = await readdir(directory);
    if (entries.length > 0) {
      throw new Error(`산출물 폴더가 비어 있지 않습니다. 기존 증거 보존을 위해 새 폴더를 지정하세요: ${directory}`);
    }
  } catch (error) {
    if (
      error !== null
      && typeof error === 'object'
      && 'code' in error
      && error.code === 'ENOENT'
    ) {
      return;
    }
    throw error;
  }
}

function parseJsonResponse(text: string, endpoint: string): unknown {
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`${endpoint} 응답이 JSON이 아닙니다: ${text.slice(0, 200)}`, { cause: error });
  }
}

function apiErrorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['error', 'message', 'code']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate !== '') return candidate;
    }
  }
  try {
    return JSON.stringify(value).slice(0, 300);
  } catch {
    return '알 수 없는 API 오류';
  }
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause === undefined) return error.message;
  if (cause instanceof Error) {
    const code = 'code' in cause && typeof cause.code === 'string' ? ` [${cause.code}]` : '';
    return `${error.message}: ${cause.message}${code}`;
  }
  if (typeof cause === 'string' || typeof cause === 'number' || typeof cause === 'boolean') {
    return `${error.message}: ${String(cause)}`;
  }
  try {
    return `${error.message}: ${JSON.stringify(cause)}`;
  } catch {
    return `${error.message}: 원인 객체를 직렬화할 수 없습니다.`;
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/u, '');
  const parsed = new URL(normalized);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API URL은 http/https만 지원합니다.');
  return normalized;
}

function assertLocalTokenHost(baseUrl: string): void {
  const hostname = new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase();
  const allowed = new Set(['localhost', '127.0.0.1', '::1', 'local-web.samplepcb.co.kr']);
  if (!allowed.has(hostname)) {
    throw new Error(`로컬 JWT 발급은 개발 호스트에서만 허용됩니다: ${hostname}`);
  }
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function jwtRefreshAt(token: string): number {
  try {
    const payload = token.split('.')[1];
    if (payload === undefined) return Date.now() + 8 * 60_000;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: unknown;
    };
    return typeof decoded.exp === 'number'
      ? (decoded.exp * 1_000) - 60_000
      : Date.now() + 8 * 60_000;
  } catch {
    return Date.now() + 8 * 60_000;
  }
}

function mimeTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (extension === '.xlsm') return 'application/vnd.ms-excel.sheet.macroEnabled.12';
  if (extension === '.xls') return 'application/vnd.ms-excel';
  if (extension === '.csv') return 'text/csv';
  if (extension === '.tsv') return 'text/tab-separated-values';
  return 'application/octet-stream';
}

function safePathSegment(value: string): string {
  const withoutControls = Array.from(value, (character) =>
    (character.codePointAt(0) ?? 0) < 32 ? '-' : character).join('');
  const sanitized = withoutControls
    .replace(/[<>:"/\\|?*]/gu, '-')
    .replace(/\s+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^[.\s-]+|[.\s-]+$/gu, '');
  return (sanitized === '' ? 'bom' : sanitized).slice(0, 80);
}

function escapeMarkdown(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`');
}

function markdownCell(value: string): string {
  return value.replaceAll('|', '\\|').replace(/\s+/gu, ' ').trim() || '—';
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
