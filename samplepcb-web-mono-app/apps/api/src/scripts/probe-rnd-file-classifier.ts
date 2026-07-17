// 실제 PCB 설계 압축 묶음으로 Ollama 모델의 파일 분류 품질을 비교하는 읽기 전용 연구 도구.
// 실행: apps/api 에서 pnpm rnd:probe
// 입력 변경: RND_PCB_PROBE_ZIP=<zip 경로> pnpm rnd:probe
// 선택 모델: RND_PCB_PROBE_MODELS=model-a,model-b pnpm rnd:probe
// 결과: apps/api/.tmp/rnd-file-classifier-probe-<timestamp>.json (gitignore 대상)

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RndFileClassifyInput, RndFileClassifyResult } from '@sp/api-contract';
import type { RndFileClassifyResultType } from '@sp/api-contract';
import { expandAiArchives } from '../lib/ai/archive';
import { prepareAiAttachments } from '../lib/ai/attachment-extractor';
import type { UploadTarget } from '../lib/file-server';
import { ollamaChat, ollamaListModels } from '../lib/ai/ollama';
import { AI_USECASE_DEFS, getAiConnection } from '../lib/ai/usecases';

const USE_CASE = 'rnd.file-classify' as const;
const FULL_PROBE_TIMEOUT_MS = 600_000;
const VISION_PROBE_TIMEOUT_MS = 90_000;
type RndFileCategory = RndFileClassifyResultType['files'][number]['category'];

interface ExpectedFile {
  pathSuffix: string;
  category: RndFileCategory;
  partialCategories?: readonly RndFileCategory[];
  roleKeywords: readonly string[];
}

const EXPECTED_FILES: readonly ExpectedFile[] = [
  {
    pathSuffix: 'WIM_DAQ_1ST_PCB.pdf',
    category: 'schematic',
    partialCategories: ['pdf-document'],
    roleKeywords: ['회로', 'schematic', 'circuit', '설계'],
  },
  {
    pathSuffix: 'WIM_DAQ_1ST_PCB_BOM.xlsx',
    category: 'bom',
    partialCategories: ['spreadsheet'],
    roleKeywords: ['bom', 'bill of materials', '부품', '자재'],
  },
  {
    pathSuffix: '부품배치.png',
    category: 'pcb-layout',
    partialCategories: ['image'],
    roleKeywords: ['부품', 'placement', '배치', 'pcb', 'board'],
  },
  {
    pathSuffix: '외형도.png',
    category: 'pcb-layout',
    partialCategories: ['image'],
    roleKeywords: ['lga', 'pad', 'footprint', 'land', 'nx15'],
  },
  {
    pathSuffix: '회로도.png',
    category: 'schematic',
    roleKeywords: ['nrf54l15', 'nrf', 'antenna', 'rf', 'matching'],
  },
];

interface VisionProbe {
  ok: boolean;
  seconds: number;
  error?: string;
}

interface ClassificationScore {
  score: number;
  maxScore: number;
  categoryExact: number;
  categoryPartial: number;
  roleKeywordHits: number;
  missing: string[];
}

interface ModelProbeResult {
  model: string;
  vision: VisionProbe;
  classify?: {
    ok: boolean;
    seconds: number;
    score?: ClassificationScore;
    result?: RndFileClassifyResultType;
    error?: string;
  };
}

const elapsedSeconds = (started: number): number =>
  Math.round(((Date.now() - started) / 1000) * 10) / 10;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : '알 수 없는 오류';

const outputDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.tmp');
const defaultZipPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../rnd/PCB설계.zip');

const selectedModels = (available: readonly string[]): string[] => {
  const configured = process.env.RND_PCB_PROBE_MODELS?.split(',')
    .map((model) => model.trim())
    .filter((model) => model !== '') ?? [];
  if (configured.length === 0) return [...available];
  const missing = configured.filter((model) => !available.includes(model));
  if (missing.length > 0) throw new Error(`등록되지 않은 모델: ${missing.join(', ')}`);
  return configured;
};

const scoreClassification = (result: RndFileClassifyResultType): ClassificationScore => {
  let categoryExact = 0;
  let categoryPartial = 0;
  let roleKeywordHits = 0;
  const missing: string[] = [];
  for (const expected of EXPECTED_FILES) {
    const file = result.files.find((item) => item.path?.endsWith(expected.pathSuffix));
    if (file === undefined) {
      missing.push(expected.pathSuffix);
      continue;
    }
    if (file.category === expected.category) categoryExact += 1;
    else if (expected.partialCategories?.includes(file.category) ?? false) categoryPartial += 1;
    const searchable = `${file.role}\n${file.evidence}`.toLowerCase();
    if (expected.roleKeywords.some((keyword) => searchable.includes(keyword.toLowerCase()))) {
      roleKeywordHits += 1;
    }
  }
  // 유형 정확도 2점, 허용되는 상위 유형 1점, 파일 역할 식별 1점 — 파일당 최대 3점.
  const score = (categoryExact * 2) + categoryPartial + roleKeywordHits;
  return { score, maxScore: EXPECTED_FILES.length * 3, categoryExact, categoryPartial, roleKeywordHits, missing };
};

async function main(): Promise<void> {
  const configuredZipPath = process.env.RND_PCB_PROBE_ZIP?.trim();
  const zipPath = path.resolve(configuredZipPath === undefined || configuredZipPath === '' ? defaultZipPath : configuredZipPath);
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
  const input = RndFileClassifyInput.parse({
    requirements: 'PCB 설계 자료 묶음에서 각 파일의 실제 역할을 분류한다.',
    files: expanded.files.map((file, index) => ({
      id: `F${String(index + 1).padStart(4, '0')}`,
      path: file.displayPath,
      extension: path.extname(file.displayPath).toLowerCase(),
      size: file.buffer.byteLength,
      extracted: file.extracted,
    })),
    attachmentContext: [
      prepared.context,
      ...(expanded.warnings.length === 0 ? [] : [`[압축 해제 경고]\n${expanded.warnings.map((warning) => `- ${warning}`).join('\n')}`]),
    ].join('\n\n'),
  });
  const def = AI_USECASE_DEFS[USE_CASE];
  const prompt = def.buildPrompt(def.defaultPrompt, input);
  const placementImage = expanded.files.find((file) => file.displayPath.endsWith('부품배치.png'));
  if (placementImage === undefined) throw new Error('비전 사전 점검용 부품배치.png를 찾지 못했습니다.');
  const visionImage = placementImage.buffer.toString('base64');
  const conn = await getAiConnection();
  const available = await ollamaListModels(conn);
  const models = selectedModels(available);
  const results: ModelProbeResult[] = [];

  console.log(`입력: ${zipPath}`);
  console.log(`압축 해제: ${String(expanded.files.length)}개 / 모델: ${String(models.length)}개 / 첨부 이미지: ${String(prepared.images.length)}개`);
  console.log(`분류 기준: ${EXPECTED_FILES.map((file) => `${file.pathSuffix}=${file.category}`).join(', ')}`);

  for (const [index, model] of models.entries()) {
    console.log(`[${String(index + 1)}/${String(models.length)}] ${model}: 비전 입력 호환성 확인 중`);
    const visionStarted = Date.now();
    let vision: VisionProbe;
    try {
      await ollamaChat(
        conn,
        model,
        '첨부 이미지를 읽을 수 있으면 JSON 객체 {"vision":true}만 출력하세요.',
        VISION_PROBE_TIMEOUT_MS,
        [visionImage],
      );
      vision = { ok: true, seconds: elapsedSeconds(visionStarted) };
    } catch (error) {
      vision = { ok: false, seconds: elapsedSeconds(visionStarted), error: errorText(error) };
      console.log(`  비전 실패 (${String(vision.seconds)}초): ${vision.error ?? '알 수 없는 오류'}`);
      results.push({ model, vision });
      continue;
    }

    console.log(`  전체 분류 실행 중 (${String(prepared.images.length)}개 이미지 포함)`);
    const classifyStarted = Date.now();
    try {
      const raw = await ollamaChat(conn, model, prompt, FULL_PROBE_TIMEOUT_MS, prepared.images);
      const output = def.parseResult(raw, input);
      if (!('json' in output)) throw new Error('rnd.file-classify 유스케이스가 JSON 결과를 반환하지 않았습니다.');
      const parsed = RndFileClassifyResult.parse(JSON.parse(output.json));
      const score = scoreClassification(parsed);
      const seconds = elapsedSeconds(classifyStarted);
      console.log(`  성공 ${String(seconds)}초 / ${String(score.score)}/${String(score.maxScore)}점 / 유형정확 ${String(score.categoryExact)} / 역할근거 ${String(score.roleKeywordHits)}`);
      results.push({ model, vision, classify: { ok: true, seconds, score, result: parsed } });
    } catch (error) {
      const seconds = elapsedSeconds(classifyStarted);
      const message = errorText(error);
      console.log(`  분류 실패 (${String(seconds)}초): ${message}`);
      results.push({ model, vision, classify: { ok: false, seconds, error: message } });
    }
  }

  const ranked = results
    .filter((item) => item.classify?.ok === true && item.classify.score !== undefined)
    .sort((left, right) => {
      const scoreDifference = (right.classify?.score?.score ?? 0) - (left.classify?.score?.score ?? 0);
      return scoreDifference !== 0
        ? scoreDifference
        : (left.classify?.seconds ?? Number.POSITIVE_INFINITY) - (right.classify?.seconds ?? Number.POSITIVE_INFINITY);
    });
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const outputPath = path.join(outputDirectory, `rnd-file-classifier-probe-${timestamp}.json`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    zipPath,
    manifest: input.files,
    prepared: { analyzedFiles: prepared.analyzedFiles, imageCount: prepared.images.length, warnings: [...prepared.warnings, ...expanded.warnings] },
    expected: EXPECTED_FILES,
    results,
    ranking: ranked.map((item) => ({ model: item.model, ...item.classify?.score, seconds: item.classify?.seconds })),
  }, null, 2)}\n`, 'utf8');
  console.log('\n최종 순위');
  for (const [index, item] of ranked.entries()) {
    const score = item.classify?.score;
    console.log(`${String(index + 1)}. ${item.model}: ${String(score?.score)}/${String(score?.maxScore)}점, ${String(item.classify?.seconds)}초`);
  }
  console.log(`상세 결과: ${outputPath}`);
}

void main().catch((error: unknown) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
