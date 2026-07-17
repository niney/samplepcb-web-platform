// 실제 PCB설계.zip을 고정 입력으로 웹과 동일한 "PCB 설계 개발의뢰서" 유스케이스를 반복 비교한다.
// 실행: apps/api 에서 pnpm rnd:request-probe
// 후보: RND_PCB_REQUEST_PROBE_MODELS=model-a,model-b pnpm rnd:request-probe
// 반복: RND_PCB_REQUEST_PROBE_ROUNDS=3 pnpm rnd:request-probe (1~5, 기본 3)
// 결과: apps/api/.tmp/rnd-pcb-request-probe-<timestamp>.json (gitignore 대상)

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RndFileClassifyResult, RndPcbRequestDocumentInput } from '@sp/api-contract';
import { expandAiArchives } from '../lib/ai/archive';
import { prepareAiAttachments } from '../lib/ai/attachment-extractor';
import type { UploadTarget } from '../lib/file-server';
import { ollamaChat, ollamaListModels } from '../lib/ai/ollama';
import { AI_USECASE_DEFS, getAiConnection } from '../lib/ai/usecases';

const USE_CASE = 'rnd.pcb-request-document' as const;
const REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_MODELS = ['glm-5.2', 'kimi-k2.7-code', 'deepseek-v4-pro', 'qwen3.5:397b'] as const;
const REQUIRED_EVIDENCE = [
  'STM32F429', 'AD7989', 'LAN8742', 'TLE9250', 'PoE', 'BOM', 'nRF54L15', 'LGA-53',
] as const;
const REQUIRED_DELIVERABLES = ['Gerber', 'drill', 'BOM', 'centroid', '좌표', '검사'] as const;
const UNSUPPORTED_PATTERNS = [
  /(?:^|\s)4\s*(?:layer|레이어|층)/i,
  /100\s*[x×]\s*80\s*mm/i,
  /(?:KC|CE|UL)\s*인증/i,
  /3D\s*STEP/i,
  /작성일.*\d{4}[-.]\d{1,2}[-.]\d{1,2}/i,
  /(?:STM32F429|AD7989|LAN8742|TLE9250).*(?:유지|고정)|(?:유지|고정).*(?:STM32F429|AD7989|LAN8742|TLE9250)/i,
] as const;

interface DocumentScore {
  score: number;
  maxScore: number;
  sections: number;
  sourceIds: number;
  citations: number;
  evidenceTerms: string[];
  deliverableTerms: string[];
  uncertaintyChecks: number;
  unsupportedAssertions: string[];
}

interface ModelProbeResult {
  model: string;
  round: number;
  ok: boolean;
  attempts: number;
  seconds: number;
  score?: DocumentScore;
  document?: string;
  error?: string;
}

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultZipPath = path.resolve(scriptDirectory, '../../../rnd/PCB설계.zip');
const outputDirectory = path.resolve(scriptDirectory, '../../.tmp');

const elapsedSeconds = (started: number): number =>
  Math.round(((Date.now() - started) / 1000) * 10) / 10;

const errorText = (error: unknown): string => error instanceof Error ? error.message : '알 수 없는 오류';

const configuredRounds = (): number => {
  const value = Number(process.env.RND_PCB_REQUEST_PROBE_ROUNDS ?? '3');
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('RND_PCB_REQUEST_PROBE_ROUNDS는 1~5 정수여야 합니다.');
  }
  return value;
};

const selectedModels = (available: readonly string[]): string[] => {
  const configured = process.env.RND_PCB_REQUEST_PROBE_MODELS?.split(',')
    .map((model) => model.trim())
    .filter((model) => model !== '') ?? [];
  const requested = configured.length === 0 ? DEFAULT_MODELS : configured;
  const missing = requested.filter((model) => !available.includes(model));
  if (missing.length > 0) throw new Error(`등록되지 않은 모델: ${missing.join(', ')}`);
  return [...requested];
};

const roleForPath = (displayPath: string): {
  category: 'schematic' | 'bom' | 'pcb-layout';
  role: string;
  evidence: string;
} => {
  if (displayPath.endsWith('WIM_DAQ_1ST_PCB.pdf')) {
    return {
      category: 'schematic',
      role: 'WIM_DAQ 1차 설계의 Power, MCU, ADC, Ethernet 4페이지 회로도 PDF',
      evidence: 'PDF 텍스트에서 4개 시트와 STM32F429ZIY7, AD7989-1, LAN8742A, TLE9250VLE, PoE 전원 부품을 확인',
    };
  }
  if (displayPath.endsWith('WIM_DAQ_1ST_PCB_BOM.xlsx')) {
    return {
      category: 'bom',
      role: 'WIM_DAQ 1차 설계 부품명세서',
      evidence: 'XLSX에서 Item, Quantity, Reference, Part, FootPrint 열을 확인',
    };
  }
  if (displayPath.endsWith('부품배치.png')) {
    return {
      category: 'pcb-layout',
      role: 'WIM_DAQ PCB 부품 배치 이미지',
      evidence: '이미지에서 PCB 위 실장 부품의 배치 뷰를 확인',
    };
  }
  if (displayPath.endsWith('외형도.png')) {
    return {
      category: 'pcb-layout',
      role: '일반 보드 외형도가 아닌 NX15(nRF54L15) LGA-53 Pad Layout 참조 이미지',
      evidence: '이미지 제목과 핀 배열에서 NX15 LGA-53 Pad Layout임을 확인',
    };
  }
  return {
    category: 'schematic',
    role: 'nRF54L15, 32MHz 크리스털, RF 매칭 및 안테나 경로가 포함된 별도 참조 회로 이미지',
    evidence: '이미지에서 nRF54L15 RF 회로와 안테나 경로를 확인',
  };
};

const scoreDocument = (document: string, sourceIds: readonly string[]): DocumentScore => {
  const sections = [...document.matchAll(/^##\s*(\d+)\./gm)]
    .map((match) => Number(match[1]))
    .filter((number) => number >= 1 && number <= 10);
  const uniqueSections = new Set(sections).size;
  const coveredSourceIds = sourceIds.filter((id) => document.includes(id)).length;
  const citations = Math.min(8, [...document.matchAll(/\[근거:\s*[^\]]+\]/g)].length);
  const normalized = document.toLowerCase();
  const evidenceTerms = REQUIRED_EVIDENCE.filter((term) => normalized.includes(term.toLowerCase()));
  const deliverableTerms = REQUIRED_DELIVERABLES.filter((term) => normalized.includes(term.toLowerCase()));
  const uncertaintyChecks = [
    /EDA.*(?:원본|소스).*(?:TBD|미확정|확인 필요)/i.test(document),
    /nRF54L15|RF/i.test(document) && /통합.*(?:TBD|미확정|선택|제외|확인 필요)/i.test(document),
    /(?:레이어|보드 치수|외형).*(?:TBD|미확정|확인 필요)/i.test(document),
    /##\s*9\./.test(document) && /\(TBD\)|미확정|확인 필요/.test(document),
  ].filter(Boolean).length;
  const unsupportedAssertions = document
    .split('\n')
    .filter((line) => UNSUPPORTED_PATTERNS.some((pattern) => pattern.test(line)))
    .filter((line) => !/(?:TBD|미확정|확인 필요|제안|예시|선택|제외|협의|검토|여부)/i.test(line));
  const maxScore = 10 + sourceIds.length + 8 + REQUIRED_EVIDENCE.length + REQUIRED_DELIVERABLES.length + 4;
  const score = uniqueSections + coveredSourceIds + citations + evidenceTerms.length +
    deliverableTerms.length + uncertaintyChecks - (unsupportedAssertions.length * 4);
  return {
    score,
    maxScore,
    sections: uniqueSections,
    sourceIds: coveredSourceIds,
    citations,
    evidenceTerms,
    deliverableTerms,
    uncertaintyChecks,
    unsupportedAssertions,
  };
};

async function main(): Promise<void> {
  const configuredZip = process.env.RND_PCB_PROBE_ZIP?.trim();
  const zipPath = path.resolve(configuredZip === undefined || configuredZip === '' ? defaultZipPath : configuredZip);
  const zip: UploadTarget = {
    filename: path.basename(zipPath),
    mimetype: 'application/zip',
    buffer: await readFile(zipPath),
  };
  const expanded = expandAiArchives([zip]);
  if (expanded.files.length === 0) throw new Error('분석 가능한 ZIP 항목이 없습니다.');
  const numbered = expanded.files.map((file, index) => ({
    ...file,
    filename: `[F${String(index + 1).padStart(4, '0')}] ${file.displayPath}`,
  }));
  const prepared = await prepareAiAttachments(numbered, { maxFiles: 300 });
  const classification = RndFileClassifyResult.parse({
    summary: 'WIM_DAQ 1차 PCB 회로도·BOM·부품배치와 별도 nRF54L15 RF 참조 자료가 함께 든 설계 묶음',
    files: expanded.files.map((file, index) => ({
      id: `F${String(index + 1).padStart(4, '0')}`,
      path: file.displayPath,
      ...roleForPath(file.displayPath),
      confidence: 'high',
    })),
    warnings: ['nRF54L15 RF 참조 자료와 WIM_DAQ 본보드의 통합 관계는 첨부만으로 확정할 수 없음'],
  });
  const input = RndPcbRequestDocumentInput.parse({
    requirements: `기존 WIM_DAQ 1차 자료를 검토해 Rev.2 회로·PCB 설계를 의뢰합니다.
- 시제품 10대를 제작 가능한 수준의 설계 산출물이 필요합니다.
- 기존 PoE 전원, MCU 제어, 아날로그 센서 입력 2채널, Ethernet, CAN 기능 의도는 유지합니다.
- 편집 가능한 EDA 원본 보유 여부는 확인되지 않았으며, 없으면 재작성 범위와 견적 영향을 분리합니다.
- nRF54L15 RF 회로는 통합 여부를 결정하기 전까지 기본 범위에서 제외합니다.`,
    classification,
    attachmentContext: [
      prepared.context,
      ...(expanded.warnings.length === 0 ? [] : [`[압축 해제 경고]\n${expanded.warnings.map((warning) => `- ${warning}`).join('\n')}`]),
    ].join('\n\n'),
  });
  const def = AI_USECASE_DEFS[USE_CASE];
  const prompt = def.buildPrompt(def.defaultPrompt, input);
  const conn = await getAiConnection();
  const models = selectedModels(await ollamaListModels(conn));
  const rounds = configuredRounds();
  const results: ModelProbeResult[] = [];
  const sourceIds = classification.files.map((file) => file.id);

  console.log(`입력: ${zipPath}`);
  console.log(`모델: ${String(models.length)}개 / 반복: ${String(rounds)}회 / 총 실행: ${String(models.length * rounds)}회`);
  for (let round = 1; round <= rounds; round += 1) {
    for (const model of models) {
      const started = Date.now();
      let attempts = 0;
      let lastError: unknown;
      console.log(`[${String(round)}/${String(rounds)}] ${model}: 웹 최종 의뢰서 생성 중`);
      for (let attempt = 0; attempt <= def.retries; attempt += 1) {
        attempts += 1;
        try {
          const raw = await ollamaChat(conn, model, prompt, REQUEST_TIMEOUT_MS);
          const output = def.parseResult(raw, input);
          if (!('md' in output)) throw new Error('rnd.pcb-request-document가 마크다운 결과를 반환하지 않았습니다.');
          const score = scoreDocument(output.md, sourceIds);
          const seconds = elapsedSeconds(started);
          console.log(`  성공 ${String(seconds)}초 / ${String(score.score)}/${String(score.maxScore)}점 / 시도 ${String(attempts)}회`);
          results.push({ model, round, ok: true, attempts, seconds, score, document: output.md });
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (lastError !== undefined) {
        const seconds = elapsedSeconds(started);
        const message = errorText(lastError);
        console.log(`  실패 ${String(seconds)}초 / 시도 ${String(attempts)}회: ${message}`);
        results.push({ model, round, ok: false, attempts, seconds, error: message });
      }
    }
  }

  const ranking = models.map((model) => {
    const successful = results.filter((result) => result.model === model && result.ok && result.score !== undefined);
    const average = (values: readonly number[]): number => values.length === 0
      ? 0
      : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
    return {
      model,
      successRate: successful.length / rounds,
      averageScore: average(successful.map((result) => result.score?.score ?? 0)),
      minimumScore: successful.length === 0 ? 0 : Math.min(...successful.map((result) => result.score?.score ?? 0)),
      averageSeconds: average(successful.map((result) => result.seconds)),
      averageAttempts: average(successful.map((result) => result.attempts)),
    };
  }).sort((left, right) =>
    right.successRate - left.successRate ||
    right.averageScore - left.averageScore ||
    right.minimumScore - left.minimumScore ||
    left.averageSeconds - right.averageSeconds,
  );
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const outputPath = path.join(outputDirectory, `rnd-pcb-request-probe-${timestamp}.json`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(), zipPath, rounds, models, input, results, ranking,
  }, null, 2)}\n`, 'utf8');
  console.log('\n반복 프로빙 순위');
  for (const [index, result] of ranking.entries()) {
    console.log(`${String(index + 1)}. ${result.model}: 성공률 ${String(Math.round(result.successRate * 100))}%, 평균 ${String(result.averageScore)}점, 최저 ${String(result.minimumScore)}점, 평균 ${String(result.averageSeconds)}초`);
  }
  console.log(`상세 결과: ${outputPath}`);
}

void main().catch((error: unknown) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
