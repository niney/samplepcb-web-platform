import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BomQuoteDetailType } from '@sp/api-contract';
import {
  createLocalVerificationAuth,
  createLocalVerificationToken,
  discoverBomFiles,
  runBomUploadVerification,
} from './bom-upload-verifier';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sp-bom-verifier-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })));
});

function quoteDetail(
  buildStatus: BomQuoteDetailType['buildStatus'],
  partDataStatus: BomQuoteDetailType['partDataStatus'],
): BomQuoteDetailType {
  const now = '2026-07-28T00:00:00.000Z';
  return {
    id: '101',
    title: 'sample.csv',
    status: 'draft',
    fileName: 'sample.csv',
    itemCount: buildStatus === 'ready' ? 1 : 0,
    includedCount: buildStatus === 'ready' ? 1 : 0,
    matchedCount: 0,
    finalTotal: 0,
    createdAt: now,
    updatedAt: now,
    requestedAt: null,
    answeredAt: null,
    engineJobId: 'job-101',
    procurementMode: 'sample',
    buildStatus,
    sheets: [{
      sheetIndex: 0,
      sheetName: 'BOM',
      status: 'parsed',
      componentCount: 1,
      selected: buildStatus === 'ready',
      hasItems: buildStatus === 'ready',
      failureReason: null,
      warnings: [],
    }],
    enrichStatus: buildStatus === 'ready' ? 'done' : 'idle',
    enrichedAt: buildStatus === 'ready' ? now : null,
    supplierSearchLimitedCount: 0,
    supplierSearchLimitSummary: null,
    partDataStatus,
    partDataFailureReason: null,
    setQty: 1,
    spareQty: 0,
    itemsTotal: 0,
    shippingFee: 0,
    managementFee: 0,
    usdKrwRateUsed: null,
    exchangeRateSnapshot: null,
    uncostedCount: buildStatus === 'ready' ? 1 : 0,
    customerMemo: null,
    confirmedShippingFee: null,
    confirmedManagementFee: null,
    confirmedTotal: null,
    answerNote: null,
    items: buildStatus === 'ready' ? [{
      id: '501',
      rowIdx: 0,
      included: true,
      mpn: '',
      manufacturerName: null,
      description: '10k resistor',
      bomQty: 1,
      orderQty: 1,
      matchStatus: 'none',
      matchEvidence: null,
      recommendedCandidateKey: null,
      selectedCandidateKey: null,
      selectionSource: 'none',
      partId: null,
      selectedOffer: null,
      sourceRow: { Value: '10k', Qty: 1 },
      sourceSheetIndex: 0,
      sourceSheetName: 'BOM',
      lineTotalKrw: null,
      partImageUrl: null,
      partDatasheetUrl: null,
      catalogInquiry: false,
      quantityState: 'verified',
    }] : [],
  };
}

describe('BOM headless 검증 도구', () => {
  it('폴더를 재귀 탐색해 지원 파일만 안정적으로 정렬한다', async () => {
    const root = await temporaryDirectory();
    await writeFile(path.join(root, 'b.csv'), 'MPN,Qty\nB,1\n', 'utf8');
    await writeFile(path.join(root, 'ignore.txt'), 'ignore', 'utf8');
    const nested = path.join(root, 'nested');
    await mkdir(nested);
    await writeFile(path.join(nested, 'a.xlsx'), 'fake', 'utf8');

    const files = await discoverBomFiles(root);

    expect(files.map((file) => path.relative(root, file).replaceAll('\\', '/'))).toEqual([
      'b.csv',
      'nested/a.xlsx',
    ]);
  });

  it('로컬 토큰은 HS256 만료 클레임을 포함하고 운영 호스트에서는 거부한다', () => {
    const token = createLocalVerificationToken('secret', 'verifier', 100);
    const [header, payload, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(header ?? '', 'base64url').toString('utf8'))).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
    expect(JSON.parse(Buffer.from(payload ?? '', 'base64url').toString('utf8'))).toMatchObject({
      mbId: 'verifier',
      iat: 100,
      exp: 700,
    });
    expect(signature).toBeTruthy();
    expect(() => createLocalVerificationAuth(
      'https://www.samplepcb.co.kr',
      'secret',
      'verifier',
    )).toThrow('개발 호스트');
  });

  it('기존 산출물이 있는 폴더에는 새 실행 결과를 섞지 않는다', async () => {
    const root = await temporaryDirectory();
    const input = path.join(root, 'sample.csv');
    const output = path.join(root, 'out');
    await writeFile(input, 'Value,Qty\n10k,1\n', 'utf8');
    await mkdir(output);
    await writeFile(path.join(output, 'manifest.json'), '{}\n', 'utf8');
    let called = false;

    await expect(runBomUploadVerification({
      inputPath: input,
      outputDirectory: output,
      repoRoot: root,
      baseUrl: 'https://local-web.samplepcb.co.kr',
      auth: { mode: 'token', getToken: () => Promise.resolve('test-token') },
      fileTimeoutMs: 60_000,
      requestTimeoutMs: 10_000,
      parsePollMs: 1,
      quotePollMs: 1,
      candidateConcurrency: 1,
      retryPartData: true,
      fetchImpl: () => {
        called = true;
        return Promise.reject(new Error('호출되면 안 됩니다.'));
      },
    })).rejects.toThrow('산출물 폴더가 비어 있지 않습니다');
    expect(called).toBe(false);
  });

  it('한 번 업로드한 동일 후보를 샘플→양산으로 재평가하고 모드별 후보·비교 응답을 캡처한다', async () => {
    const root = await temporaryDirectory();
    const input = path.join(root, 'sample.csv');
    const output = path.join(root, 'out');
    await writeFile(input, 'Value,Qty\n10k,1\n', 'utf8');
    const selecting = quoteDetail('selecting', 'preparing');
    const ready = quoteDetail('ready', 'ready');
    const massReady: BomQuoteDetailType = { ...ready, procurementMode: 'mass' };
    const requests: string[] = [];
    const fetchImpl: typeof fetch = (inputValue, init) => {
      const requestUrl = typeof inputValue === 'string'
        ? inputValue
        : inputValue instanceof URL
          ? inputValue.toString()
          : inputValue.url;
      const url = new URL(requestUrl);
      const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
      requests.push(key);
      let body: unknown;
      let status = 200;
      if (key === 'POST /api/bom/quotes') {
        status = 201;
        body = { result: true, data: { quoteId: '101', jobId: 'job-101' } };
      } else if (key === 'GET /api/bom/jobs/job-101') {
        body = {
          result: true,
          data: {
            job_id: 'job-101',
            engine: 'smartbom',
            filename: 'sample.csv',
            status: 'completed',
            progress: 100,
            message: '완료',
            error: null,
            result_available: true,
            supplier_search: {
              status: null,
              progress: 0,
              message: '',
              error: null,
              result_available: false,
            },
          },
        };
      } else if (key === 'POST /api/bom/quotes/101/prepare') {
        body = { result: true, data: selecting };
      } else if (key === 'POST /api/bom/quotes/101/build') {
        body = { result: true, data: ready };
      } else if (key === 'GET /api/bom/quotes/101') {
        body = { result: true, data: ready };
      } else if (key === 'PATCH /api/bom/quotes/101') {
        body = { result: true, data: massReady };
      } else if (key === 'GET /api/bom/quotes/101/items/501/candidates') {
        body = {
          result: true,
          data: {
            quoteId: '101',
            itemId: '501',
            rowIdx: 0,
            extraction: null,
            searchRequirements: null,
            searchRequirementGuidance: null,
            originalMpn: null,
            originalValue: '10k',
            originalSheetName: 'BOM',
            originalRows: [2],
            originalReferenceDesignators: ['R1'],
            originalManufacturer: null,
            originalPackageCode: null,
            bomQty: 1,
            neededQty: 1,
            currentMpn: '',
            currentLineTotalKrw: null,
            selectionSource: 'none',
            selectionApplicationState: 'not_selected',
            confirmationRequired: false,
            selectedCandidateKey: null,
            selectedOfferKey: null,
            recommendedCandidateKey: null,
            technicalTopCandidateKey: null,
            technicalTopLineTotalKrw: null,
            technicalFallbackUsed: false,
            decisionReasonCodes: [],
            localCatalogTrace: null,
            searchTrace: null,
            candidates: [],
            events: [],
          },
        };
      } else if (key === 'GET /api/bom/quotes/101/comparison?page=1&pageSize=50') {
        body = {
          result: true,
          data: {
            quoteId: '101',
            page: 1,
            pageSize: 50,
            total: 1,
            totalPages: 1,
            summary: { matched: 0, attention: 0, notFound: 1 },
            sheets: ['BOM'],
            rows: [{ itemId: '501', rowIdx: 0, extraction: null, candidates: [] }],
          },
        };
      } else {
        status = 404;
        body = { result: false, error: 'unexpected-test-request' };
      }
      return Promise.resolve(new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }));
    };

    const manifest = await runBomUploadVerification({
      inputPath: input,
      outputDirectory: output,
      repoRoot: root,
      baseUrl: 'https://local-web.samplepcb.co.kr',
      auth: { mode: 'token', getToken: () => Promise.resolve('test-token') },
      fileTimeoutMs: 60_000,
      requestTimeoutMs: 10_000,
      parsePollMs: 1,
      quotePollMs: 1,
      candidateConcurrency: 2,
      retryPartData: true,
      compareProcurementModes: true,
      fetchImpl,
      sleep: () => Promise.resolve(),
    });

    expect(manifest.completedCount).toBe(1);
    expect(manifest.failedCount).toBe(0);
    expect(requests).toEqual([
      'POST /api/bom/quotes',
      'GET /api/bom/jobs/job-101',
      'POST /api/bom/quotes/101/prepare',
      'POST /api/bom/quotes/101/build',
      'GET /api/bom/quotes/101',
      'GET /api/bom/quotes/101/items/501/candidates',
      'GET /api/bom/quotes/101/comparison?page=1&pageSize=50',
      'PATCH /api/bom/quotes/101',
      'GET /api/bom/quotes/101/items/501/candidates',
      'GET /api/bom/quotes/101/comparison?page=1&pageSize=50',
    ]);
    const file = manifest.files[0];
    expect(file?.summary?.candidateCapture).toMatchObject({
      requested: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(file?.summary?.screen).toMatchObject({ total: 1, unmatched: 1 });
    expect(file?.summary?.procurementModeComparison).toMatchObject({
      selectedCandidateSemanticChangedCount: 0,
      selectedOfferChangedCount: 0,
      technicalPreselectionKeyChangedCount: 0,
      technicalPreselectionChangedCount: 0,
      pinnedOfferChangedCount: 0,
    });
    expect(JSON.parse(await readFile(
      path.join(file?.artifactDirectory ?? '', 'candidates', '501.json'),
      'utf8',
    ))).toMatchObject({ result: true, data: { itemId: '501' } });
    expect(JSON.parse(await readFile(
      path.join(file?.artifactDirectory ?? '', 'quote-detail-sample.json'),
      'utf8',
    ))).toMatchObject({ data: { procurementMode: 'sample' } });
    expect(JSON.parse(await readFile(
      path.join(file?.artifactDirectory ?? '', 'quote-detail-mass.json'),
      'utf8',
    ))).toMatchObject({ data: { procurementMode: 'mass' } });
  });
});
