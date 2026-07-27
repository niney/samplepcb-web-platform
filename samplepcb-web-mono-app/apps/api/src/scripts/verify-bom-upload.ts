// sp-vue 고객 BOM 업로드와 동일한 공개 API 흐름을 headless로 실행하고 원본 응답을 보존한다.
// 실제 draft 견적·파일·공급사 API 사용량·카탈로그 인제스트가 남는 통합 검증 도구다.

import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCookieVerificationAuth,
  createLocalVerificationAuth,
  createStaticVerificationAuth,
  runBomUploadVerification,
  type BomVerificationAuthProvider,
} from '../lib/bom-upload-verifier';

interface CliOptions {
  inputPath: string | null;
  outputDirectory: string | null;
  baseUrl: string;
  fileTimeoutMs: number;
  requestTimeoutMs: number;
  parsePollMs: number;
  quotePollMs: number;
  candidateConcurrency: number;
  retryPartData: boolean;
  allowLocalToken: boolean;
  localMemberId: string | null;
  showHelp: boolean;
}

const DEFAULT_BASE_URL = 'https://local-web.samplepcb.co.kr';
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, '../../../../..');

function usage(): string {
  return `
SP BOM headless 업로드 검증

사용법:
  pnpm bom:verify -- <파일|폴더> [옵션]

인증(아래 순서):
  BOM_VERIFY_TOKEN=<JWT>                         기존 Bearer 토큰
  BOM_VERIFY_COOKIE="PHPSESSID=..."             PHP 세션으로 단기 토큰 재발급
  --allow-local-token --local-member-id <mbId>  로컬 호스트에서 apps/api/.env의 JWT_SECRET 사용

옵션:
  --output <폴더>                  산출물 폴더(기본: .tmp/bom-verification/<시각>)
  --base-url <URL>                 기본: ${DEFAULT_BASE_URL}
  --timeout-minutes <분>           파일당 전체 제한(기본: 30)
  --request-timeout-seconds <초>   HTTP 요청당 제한(기본: 120)
  --parse-poll-ms <ms>             분석 잡 폴링(기본: 1500, sp-vue 동일)
  --quote-poll-ms <ms>             견적 보강 폴링(기본: 3000, sp-vue 동일)
  --candidate-concurrency <개수>   행별 후보 조회 동시성(기본: 4)
  --no-part-data-retry             부품 정보 실패 시 화면의 재시도 동작을 생략
  --help                           도움말

폴더 입력은 지원 확장자를 재귀 탐색하고 정렬한 뒤 파일 단위로 순차 실행합니다.
다중 시트 파일은 상호작용 없는 검증을 위해 BOM으로 인식된 시트를 모두 선택하며,
이 정책은 manifest.json에 기록됩니다. 인증 비밀은 어떤 산출물에도 저장하지 않습니다.
`.trim();
}

function parsePositiveNumber(raw: string | undefined, flag: string): number {
  if (raw === undefined) throw new Error(`${flag} 값이 필요합니다.`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${flag} 값은 양수여야 합니다.`);
  return value;
}

function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = {
    inputPath: null,
    outputDirectory: null,
    baseUrl: DEFAULT_BASE_URL,
    fileTimeoutMs: 30 * 60_000,
    requestTimeoutMs: 120_000,
    parsePollMs: 1_500,
    quotePollMs: 3_000,
    candidateConcurrency: 4,
    retryPartData: true,
    allowLocalToken: false,
    localMemberId: null,
    showHelp: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === '--help' || argument === '-h') {
      options.showHelp = true;
    } else if (argument === '--output') {
      options.outputDirectory = argv[++index] ?? null;
    } else if (argument === '--base-url') {
      options.baseUrl = argv[++index] ?? '';
    } else if (argument === '--timeout-minutes') {
      options.fileTimeoutMs = parsePositiveNumber(argv[++index], argument) * 60_000;
    } else if (argument === '--request-timeout-seconds') {
      options.requestTimeoutMs = parsePositiveNumber(argv[++index], argument) * 1_000;
    } else if (argument === '--parse-poll-ms') {
      options.parsePollMs = parsePositiveNumber(argv[++index], argument);
    } else if (argument === '--quote-poll-ms') {
      options.quotePollMs = parsePositiveNumber(argv[++index], argument);
    } else if (argument === '--candidate-concurrency') {
      options.candidateConcurrency = Math.floor(parsePositiveNumber(argv[++index], argument));
    } else if (argument === '--no-part-data-retry') {
      options.retryPartData = false;
    } else if (argument === '--allow-local-token') {
      options.allowLocalToken = true;
    } else if (argument === '--local-member-id') {
      options.localMemberId = argv[++index] ?? null;
    } else if (argument.startsWith('-')) {
      throw new Error(`알 수 없는 옵션: ${argument}`);
    } else if (options.inputPath === null) {
      options.inputPath = argument;
    } else {
      throw new Error(`입력 경로는 하나만 지정할 수 있습니다: ${argument}`);
    }
  }
  return options;
}

function resolveAuth(options: CliOptions): BomVerificationAuthProvider {
  const token = process.env.BOM_VERIFY_TOKEN?.trim();
  if (token !== undefined && token !== '') return createStaticVerificationAuth(token);

  const cookie = process.env.BOM_VERIFY_COOKIE?.trim();
  if (cookie !== undefined && cookie !== '') {
    return createCookieVerificationAuth(options.baseUrl, cookie, fetch, options.requestTimeoutMs);
  }

  if (!options.allowLocalToken) {
    throw new Error(
      '인증이 없습니다. BOM_VERIFY_TOKEN 또는 BOM_VERIFY_COOKIE를 설정하거나, '
      + '개발 호스트에서 --allow-local-token --local-member-id <mbId>를 명시하세요.',
    );
  }
  const memberId = options.localMemberId?.trim();
  if (memberId === undefined || memberId === '') {
    throw new Error('--allow-local-token 사용 시 --local-member-id가 필요합니다.');
  }
  return createLocalVerificationAuth(
    options.baseUrl,
    process.env.JWT_SECRET ?? '',
    memberId,
  );
}

function timestampDirectoryName(): string {
  return new Date().toISOString()
    .replace('T', '-')
    .replaceAll(':', '')
    .replaceAll('.', '-')
    .replace('Z', '');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.showHelp) {
    console.log(usage());
    return;
  }
  if (options.inputPath === null) throw new Error(`입력 파일 또는 폴더가 필요합니다.\n\n${usage()}`);
  await access(defaultRepoRoot);

  const outputDirectory = path.resolve(
    options.outputDirectory
      ?? path.join(defaultRepoRoot, '.tmp', 'bom-verification', timestampDirectoryName()),
  );
  const auth = resolveAuth(options);
  console.log('실제 고객 BOM 업로드 경로를 실행합니다.');
  console.log('draft 견적·원본 파일·API 사용량·카탈로그 인제스트가 남으며 자동 삭제하지 않습니다.');
  console.log(`입력: ${path.resolve(options.inputPath)}`);
  console.log(`산출물: ${outputDirectory}`);
  console.log(`API: ${options.baseUrl} / 인증: ${auth.mode} / 시트: 인식된 시트 전체`);

  const manifest = await runBomUploadVerification({
    inputPath: options.inputPath,
    outputDirectory,
    repoRoot: defaultRepoRoot,
    baseUrl: options.baseUrl,
    auth,
    fileTimeoutMs: options.fileTimeoutMs,
    requestTimeoutMs: options.requestTimeoutMs,
    parsePollMs: options.parsePollMs,
    quotePollMs: options.quotePollMs,
    candidateConcurrency: options.candidateConcurrency,
    retryPartData: options.retryPartData,
    onProgress: (message) => {
      console.log(message);
    },
  });
  console.log(`완료: 성공 ${String(manifest.completedCount)} / 실패 ${String(manifest.failedCount)}`);
  console.log(`보고서: ${path.join(outputDirectory, 'report.md')}`);
  if (manifest.failedCount > 0) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
