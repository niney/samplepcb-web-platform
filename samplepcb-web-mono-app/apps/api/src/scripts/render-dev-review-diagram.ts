// 제안 시스템 구성도 렌더러 육안 점검용 — 프로빙 산출(`*.json` 의 review.diagram) 또는 내장 샘플을
// HTML 로 떨어뜨린다. 브라우저로 열어 카드·칩·화살표·제목 띠·범례·페이지 비율을 확인한다(자동 테스트 아님).
//   pnpm exec tsx src/scripts/render-dev-review-diagram.ts [probe-result.json|-] [out.html] [--page=auto|a3|wide] [--title=…] [--meta=…] [--no-legend]
import { readFileSync, writeFileSync } from 'node:fs';
import { DevReviewDiagram } from '@sp/api-contract';
import type { DevReviewDiagramType } from '@sp/api-contract';
import { renderDevReviewDiagramHtml } from '@sp/utils';
import type { DevReviewDiagramPage } from '@sp/utils';

const SAMPLE: DevReviewDiagramType = DevReviewDiagram.parse({
  columns: { inputs: '현장 입력', board: 'IoT 제어보드', outputs: '서비스 연동' },
  inputs: [
    { label: '재봉기 동작 신호', detail: '생산 카운트 · 운전 상태', icon: 'signal' },
    { label: '전력 측정부', detail: '전압 · 전류 · 소비전력', icon: 'power' },
    { label: '온습도 센서', detail: '종류는 제안 받고 싶음', icon: 'sensor', tbd: true },
  ],
  board: {
    label: '메인 컨트롤러',
    detail: '제어 · 통신 · 전원',
    chips: ['입력 보호', '전원 변환', '데이터 처리', 'OTA 확장', '무선 통신 모듈 인터페이스', '저장'],
  },
  outputs: [
    { label: 'Android 단말', detail: '모니터링 · 설정 · 저장', icon: 'phone' },
    { label: 'AI / Cloud', detail: '향후 API · MQTT 확장', icon: 'cloud' },
  ],
  linkIn: 'GPIO / ADC',
  linkOut: 'BLE',
  notes: { flow: '센싱 → 전처리 → BLE 전송', design: '산업현장 노이즈·전원 변동 대응', extension: 'OTA · Cloud · AI 분석 연계' },
});

const positional: string[] = [];
const flags = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m === null) positional.push(a);
  else flags.set(m[1] ?? '', m[2] ?? '');
}
const [input, output] = positional;
let diagram = SAMPLE;
if (input !== undefined && input !== '-') {
  const parsed = JSON.parse(readFileSync(input, 'utf8')) as { review?: { diagram?: unknown } };
  diagram = DevReviewDiagram.parse(parsed.review?.diagram);
}
const pageRaw = flags.get('page') ?? 'auto';
const page: DevReviewDiagramPage = pageRaw === 'a3' || pageRaw === 'wide' ? pageRaw : 'auto';
const out = output ?? 'dev-review-diagram.html';
writeFileSync(
  out,
  renderDevReviewDiagramHtml(diagram, {
    page,
    legend: !flags.has('no-legend'),
    title: flags.get('title') ?? '',
    meta: flags.get('meta') ?? '',
  }),
);
console.log(`→ ${out} (page ${page})`);
