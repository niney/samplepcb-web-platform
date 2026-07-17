// 실제 PCB설계.zip을 근거로 만든 가상 의뢰 조건에서 "PCB 설계 개발의뢰서" 품질을 비교한다.
// 실행: apps/api 에서 pnpm rnd:request-probe
// 선택 모델: RND_PCB_REQUEST_PROBE_MODELS=model-a,model-b pnpm rnd:request-probe
// 결과: apps/api/.tmp/rnd-pcb-request-probe-<timestamp>.json (gitignore 대상)

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiRocRunBody } from '@sp/api-contract';
import type { AiRocRunBodyType } from '@sp/api-contract';
import { expandAiArchives } from '../lib/ai/archive';
import { prepareAiAttachments } from '../lib/ai/attachment-extractor';
import type { UploadTarget } from '../lib/file-server';
import { ollamaChat, ollamaListModels } from '../lib/ai/ollama';
import { AI_USECASE_DEFS, getAiConnection } from '../lib/ai/usecases';

const USE_CASE = 'market.request-roc' as const;
const REQUEST_TIMEOUT_MS = 300_000;
const SECTION_NUMBERS = Array.from({ length: 10 }, (_value, index) => index + 1);
const REQUIRED_EVIDENCE = [
  'STM32F429', 'AD7989', 'LAN8742', 'TLE9250', 'PoE', 'BOM', 'nRF54L15', 'LGA-53',
] as const;
const REQUIRED_DELIVERABLES = ['Gerber', 'drill', 'BOM', 'centroid', '좌표', '검사'];
const UNSUPPORTED_FACTS = ['4층', '4 layer', '4-layer', 'UL 인증', 'CE 인증', 'KC 인증'];

interface DocumentScore {
  score: number;
  maxScore: number;
  sections: number[];
  evidenceTerms: string[];
  deliverableTerms: string[];
  uncertaintyHandled: boolean;
  unsupportedFacts: string[];
}

interface ModelProbeResult {
  model: string;
  ok: boolean;
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

const compactAttachmentEvidence = (context: string): string =>
  context
    .split(/\n\n(?=\[첨부)/)
    .map((section) => section.slice(0, 1_800))
    .join('\n\n');

const modelSelection = (available: readonly string[]): string[] => {
  const configured = process.env.RND_PCB_REQUEST_PROBE_MODELS?.split(',')
    .map((model) => model.trim())
    .filter((model) => model !== '') ?? [];
  if (configured.length === 0) return [...available];
  const missing = configured.filter((model) => !available.includes(model));
  if (missing.length > 0) throw new Error(`등록되지 않은 모델: ${missing.join(', ')}`);
  return configured;
};

const buildInput = (attachmentEvidence: string): AiRocRunBodyType => AiRocRunBody.parse({
  title: 'WIM_DAQ Rev.2 산업용 데이터수집 PCB 설계 개발',
  serviceAreas: ['circuit', 'pcb'],
  categories: ['mcu', 'power', 'digital', 'rf'],
  cadTools: [],
  // 임의의 의뢰 조건은 아래 첫 블록뿐이며, 나머지는 실제 ZIP에서 추출하거나 눈으로 확인한 근거다.
  description: `기존 WIM_DAQ 1차 설계 자료를 검토해 산업용 데이터수집 보드 Rev.2의 회로·PCB 설계를 의뢰합니다.

[의뢰인이 정한 가정 조건]
- Rev.2 시제품 10대를 제작 가능한 수준의 설계 산출물을 만든다.
- 기존 PoE 전원, MCU 기반 제어, 아날로그 센서 입력 2채널, Ethernet 및 CAN 통신의 기능 의도는 유지한다.
- 기존 편집 가능 EDA 원본의 보유 여부는 확인되지 않았으므로, 원본이 없으면 재작성 범위와 비용 영향을 분리해 제시한다.
- 별도 PNG에 nRF54L15 RF 회로 및 NX15 LGA-53 패드 레이아웃이 보인다. 이 RF 회로를 WIM_DAQ Rev.2에 통합할지는 아직 결정하지 않았으며, 기본 범위에는 넣지 않는다.

[첨부에서 직접 확인한 사실]
- WIM_DAQ_1ST_PCB.pdf는 Power, MCU, ADC, Ethernet의 4개 회로 시트다.
- PDF/BOM에서 STM32F429ZIY7, AD7989-1, INA128UA, LAN8742A, TLE9250VLE, Silvertel Ag9912LPB(PoE)가 확인된다.
- WIM_DAQ_1ST_PCB_BOM.xlsx는 Item, Quantity, Reference, Part, FootPrint 열을 가진 BOM이다.
- 부품배치.png는 WIM_DAQ PCB 부품 배치 이미지다.
- 외형도.png는 일반 보드 외형이 아니라 NX15(nRF54L15) LGA-53 Pad Layout이다.
- 회로도.png는 nRF54L15, 32MHz 크리스털, RF 매칭·안테나 경로가 보이는 별도 회로 참조 이미지다.

[첨부 추출 원문 일부]
${attachmentEvidence}`,
  answers: [
    { code: 'PCB-01', answer: '기존 회로도 PDF와 BOM 엑셀은 있으나 원본 EDA 파일 보유 여부는 미확인' },
    { code: 'PCB-02', answer: '시제품 10대 제작 가능 수준의 Gerber·drill·BOM·좌표 산출물이 필요' },
    { code: 'PCB-03', answer: 'nRF54L15 RF 회로의 본보드 통합 여부는 별도 결정 전까지 기본 범위에서 제외' },
  ],
  budgetRange: 'r300_700',
  startHopeDate: '2026-08-10',
  dueHopeDate: '2026-10-31',
  deadline: { days: 14 },
  method: 'open',
  spec: JSON.stringify({
    project: {
      name: 'WIM_DAQ_REV2',
      summary: 'PoE 전원 기반 산업용 데이터수집 PCB의 기존 설계 검토 및 Rev.2 회로·PCB 개발',
      stage: 'pcb',
      service_type: 'full',
    },
    groups: [
      { id: 'power', label: 'POWER' },
      { id: 'controller', label: 'CONTROLLER' },
      { id: 'analog_input', label: 'ANALOG INPUT' },
      { id: 'communication', label: 'COMMUNICATION' },
      { id: 'rf_reference', label: 'RF REFERENCE (OPTION)' },
    ],
    blocks: [
      { id: 'poe_power', group: 'power', type: 'power', label: 'PoE 전원 및 레귤레이터', status: 'confirmed' },
      { id: 'mcu', group: 'controller', type: 'controller', label: 'STM32F429ZIY7 MCU', status: 'confirmed' },
      { id: 'sensor_adc', group: 'analog_input', type: 'sensor', label: 'INA128UA + AD7989-1 센서 입력 2채널', status: 'confirmed' },
      { id: 'ethernet', group: 'communication', type: 'communication', label: 'LAN8742A Ethernet PHY', status: 'confirmed' },
      { id: 'can', group: 'communication', type: 'communication', label: 'TLE9250VLE CAN 트랜시버', status: 'confirmed' },
      { id: 'rf_board', group: 'rf_reference', type: 'communication', label: 'nRF54L15 RF 참조 회로', status: 'option' },
    ],
    connections: [
      { from: 'poe_power', to: 'mcu', interface: '(TBD)', flow: 'power' },
      { from: 'sensor_adc', to: 'mcu', interface: '(TBD)', flow: 'data' },
      { from: 'mcu', to: 'ethernet', interface: '(TBD)', flow: 'data' },
      { from: 'mcu', to: 'can', interface: '(TBD)', flow: 'data' },
    ],
    constraints: [
      '기존 EDA 원본 보유 여부는 미확정이며, PDF/BOM만으로 재작성해야 할 수 있음',
      'nRF54L15 RF 참조 회로는 WIM_DAQ 본보드 통합 여부가 미확정',
      '레이어 수, 보드 치수, 센서 인터페이스 전기 사양, 제작처와 시험 조건은 미확정',
    ],
    feature_highlights: [
      'PoE 전원', '아날로그 센서 입력 2채널', 'Ethernet', 'CAN',
    ],
    questions_missing: [
      { topic: 'EDA 원본', question: '기존 회로/PCB 편집 원본과 라이브러리 파일을 제공할 수 있나요?' },
      { topic: 'RF 통합', question: 'nRF54L15 RF 참조 회로를 WIM_DAQ Rev.2에 통합할까요?' },
      { topic: '제작 조건', question: 'PCB 레이어 수, 보드 치수, 목표 수량, 제작처와 검사 조건은 무엇인가요?' },
    ],
  }),
});

const scoreDocument = (document: string): DocumentScore => {
  const sections = SECTION_NUMBERS.filter((number) =>
    new RegExp(`^##\\s*${String(number)}\\.`, 'm').test(document),
  );
  const normalized = document.toLowerCase();
  const evidenceTerms = REQUIRED_EVIDENCE.filter((term) => normalized.includes(term.toLowerCase()));
  const deliverableTerms = REQUIRED_DELIVERABLES.filter((term) => normalized.includes(term.toLowerCase()));
  const uncertaintyHandled = /미확정|\(TBD\)|확인 필요/.test(document) &&
    /nrf54l15|rf/.test(normalized) && /원본.*(없|미확정|확인)/.test(document);
  const unsupportedFacts = UNSUPPORTED_FACTS.filter((fact) => normalized.includes(fact.toLowerCase()));
  // 서식 10점, 근거 보존 8점, 산출물 구체성 5점, 미확정 통제 5점, 근거 없는 확정 감점.
  const score = sections.length + evidenceTerms.length + deliverableTerms.length + (uncertaintyHandled ? 5 : 0) - (unsupportedFacts.length * 3);
  return {
    score,
    maxScore: 10 + REQUIRED_EVIDENCE.length + REQUIRED_DELIVERABLES.length + 5,
    sections,
    evidenceTerms,
    deliverableTerms,
    uncertaintyHandled,
    unsupportedFacts,
  };
};

async function main(): Promise<void> {
  const configuredZip = process.env.RND_PCB_PROBE_ZIP?.trim();
  const zipPath = path.resolve(configuredZip === undefined || configuredZip === '' ? defaultZipPath : configuredZip);
  const inputFile: UploadTarget = {
    filename: path.basename(zipPath),
    mimetype: 'application/zip',
    buffer: await readFile(zipPath),
  };
  const expanded = expandAiArchives([inputFile]);
  const prepared = await prepareAiAttachments(expanded.files, { maxFiles: 300 });
  const input = buildInput(compactAttachmentEvidence(prepared.context));
  const def = AI_USECASE_DEFS[USE_CASE];
  const prompt = def.buildPrompt(def.defaultPrompt, input);
  const conn = await getAiConnection();
  const models = modelSelection(await ollamaListModels(conn));
  const results: ModelProbeResult[] = [];

  console.log(`입력: ${zipPath}`);
  console.log(`첨부: ${String(expanded.files.length)}개 / 모델: ${String(models.length)}개`);
  for (const [index, model] of models.entries()) {
    const started = Date.now();
    console.log(`[${String(index + 1)}/${String(models.length)}] ${model}: 개발의뢰서 생성 중`);
    try {
      const raw = await ollamaChat(conn, model, prompt, REQUEST_TIMEOUT_MS);
      const output = def.parseResult(raw, input);
      if (!('md' in output)) throw new Error('market.request-roc 유스케이스가 마크다운 결과를 반환하지 않았습니다.');
      const score = scoreDocument(output.md);
      const seconds = elapsedSeconds(started);
      console.log(`  성공 ${String(seconds)}초 / ${String(score.score)}/${String(score.maxScore)}점 / 섹션 ${String(score.sections.length)}/10 / 근거 ${String(score.evidenceTerms.length)}`);
      results.push({ model, ok: true, seconds, score, document: output.md });
    } catch (error) {
      const seconds = elapsedSeconds(started);
      const message = errorText(error);
      console.log(`  실패 ${String(seconds)}초: ${message}`);
      results.push({ model, ok: false, seconds, error: message });
    }
  }

  const ranking = results
    .filter((result) => result.ok && result.score !== undefined)
    .sort((left, right) => {
      const scoreDifference = (right.score?.score ?? 0) - (left.score?.score ?? 0);
      return scoreDifference !== 0 ? scoreDifference : left.seconds - right.seconds;
    });
  const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
  const outputPath = path.join(outputDirectory, `rnd-pcb-request-probe-${timestamp}.json`);
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    zipPath,
    input,
    prepared: { analyzedFiles: prepared.analyzedFiles, warnings: prepared.warnings },
    results,
    ranking: ranking.map((result) => ({ model: result.model, seconds: result.seconds, score: result.score })),
  }, null, 2)}\n`, 'utf8');
  console.log('\n최종 순위');
  for (const [index, result] of ranking.entries()) {
    console.log(`${String(index + 1)}. ${result.model}: ${String(result.score?.score)}/${String(result.score?.maxScore)}점, ${String(result.seconds)}초`);
  }
  console.log(`상세 결과: ${outputPath}`);
}

void main().catch((error: unknown) => {
  console.error(errorText(error));
  process.exitCode = 1;
});
