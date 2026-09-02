// 실험 하네스 — "풍부한 공학 구성도"(PCB 담당자 프롬프트: MCU 중앙·입력 좌·출력 우·통신 상단·전원
// 체인 하단·저장/디버그·절연·모든 선에 인터페이스·TBD·노란 메모)를 JSON 출력형으로 옮겨, 우리
// 픽스처 5종에서 **존별로 얼마나 지어내는지** 잰다(docs/AI_DEV_REVIEW.md §12.7). 출하 코드가 아니다 —
// 스키마·프롬프트는 이 파일 안에만 있고, 근거 대조·첨부 판독·클라이언트는 출하 모듈을 그대로 쓴다.
//
// 채점(결정적):
//   블록  = 전체 / 근거 있음(evidence 가 코퍼스에 있음) / tbd 표시 / 지어냄(근거 없고 tbd 도 아님) — 존별
//   연결  = 전체 / 인터페이스 표기 / 인터페이스가 자료에 있음 / tbd / 지어냄
//   전압  = 표기 수 / 자료에 없는 전압 수
//   전원 체인 = 단계 수 / 자료에 있는 단계 수
//   금지  = 픽스처 golden.forbidden 이 블록 라벨·인터페이스에 나타난 수
//
// 실행(apps/api): pnpm exec tsx --env-file=.env src/scripts/probe-dev-review-rich.ts \
//   --models=deepseek-v4-pro:0813,kimi-k2.7-code --fixtures=all --out=../../../.tmp/dev-review-probe/rich
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { z } from 'zod';
import { DEV_REVIEW_QUESTION_MAP, MARKET_SERVICE_AREA_LABELS, devReviewAnswerText } from '@sp/api-contract';
import { expandAiArchives } from '../lib/ai/archive';
import { prepareAiAttachments } from '../lib/ai/attachment-extractor';
import {
  ATTACHMENT_READ_JSON_SCHEMA,
  buildAttachmentReadPrompt,
  buildDevReviewCorpus,
  isGroundedQuote,
  normalizeForMatch,
  parseAttachmentReadResult,
  ungroundedTokens,
  type DevReviewSource,
} from '../lib/ai/dev-review';
import { extractJsonObject, ollamaChatDetailed, type AiConnection, type OllamaChatExtra } from '../lib/ai/ollama';
import type { UploadTarget } from '../lib/file-server';

// ── 실험 스키마 ─────────────────────────────────────────────────────────────
const ZONES = ['mcu', 'input', 'output', 'comm', 'power', 'storage_debug'] as const;
type Zone = (typeof ZONES)[number];
const Block = z.object({
  id: z.string().trim().min(1).max(40),
  zone: z.enum(ZONES).catch('input'),
  label: z.string().trim().min(1).max(60),
  detail: z.string().trim().max(80).catch(''),
  evidence: z.string().trim().max(200).nullable().catch(null),
  tbd: z.boolean().catch(false),
  isolation: z.boolean().catch(false),
  channels: z.number().int().min(1).max(32).catch(1),
});
const Connection = z.object({
  from: z.string().trim().min(1).max(40),
  to: z.string().trim().min(1).max(40),
  interface: z.string().trim().max(30).catch(''),
  direction: z.enum(['to', 'from', 'both']).catch('to'),
  kind: z.enum(['data', 'control', 'power']).catch('data'),
  voltage: z.string().trim().max(12).catch(''),
  tbd: z.boolean().catch(false),
});
const ReviewNote = z.object({
  text: z.string().trim().min(1).max(200),
  kind: z.enum(['tbd', 'review', 'conflict', 'question']).catch('review'),
});
const RichOutput = z.object({
  summary: z.string().trim().max(300).catch(''),
  blocks: z.array(Block).max(40),
  connections: z.array(Connection).max(60),
  powerChain: z.array(z.string().trim().min(1).max(40)).max(10).catch([]),
  reviewNotes: z.array(ReviewNote).max(12),
});
type RichOutputType = z.infer<typeof RichOutput>;

const RICH_JSON_SCHEMA = {
  type: 'object',
  required: ['summary', 'blocks', 'connections', 'powerChain', 'reviewNotes'],
  properties: {
    summary: { type: 'string' },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'zone', 'label', 'detail', 'evidence', 'tbd', 'isolation', 'channels'],
        properties: {
          id: { type: 'string' }, zone: { type: 'string', enum: [...ZONES] }, label: { type: 'string' },
          detail: { type: 'string' }, evidence: { type: ['string', 'null'] }, tbd: { type: 'boolean' },
          isolation: { type: 'boolean' }, channels: { type: 'integer' },
        },
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['from', 'to', 'interface', 'direction', 'kind', 'voltage', 'tbd'],
        properties: {
          from: { type: 'string' }, to: { type: 'string' }, interface: { type: 'string' },
          direction: { type: 'string', enum: ['to', 'from', 'both'] },
          kind: { type: 'string', enum: ['data', 'control', 'power'] },
          voltage: { type: 'string' }, tbd: { type: 'boolean' },
        },
      },
    },
    powerChain: { type: 'array', items: { type: 'string' } },
    reviewNotes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text', 'kind'],
        properties: { text: { type: 'string' }, kind: { type: 'string', enum: ['tbd', 'review', 'conflict', 'question'] } },
      },
    },
  },
} as const;

// ── 실험 프롬프트 — PCB 담당자 규칙을 JSON 출력형으로 옮김(레이아웃·색·A3 는 렌더러 몫이라 제외) ──
const RICH_RULES = `당신은 전자제품 개발 검토용 시스템 구성도를 작성하는 하드웨어 설계자입니다. 아래 [고객 자료]를 분석해 고객, 회로설계자, PCB 설계자, 펌웨어 개발자, 감리자가 제품의 전체 기능·입출력·통신·전원·제어 관계를 한눈에 검토할 수 있는 구성도 JSON을 작성합니다.

[블록 배치 규칙 — zone]
- mcu: MCU 또는 메인 프로세서 — 정확히 1개, 도면 중앙의 가장 큰 블록.
- input: MCU 로 들어오는 입력 장치(왼쪽). 예: 센서, 버튼·스위치, 카메라, 디지털·아날로그 입력, 내부 온습도 센서, 외부 신호 입력, 전압·전류 측정부.
- output: MCU 가 제어하는 출력 장치(오른쪽). 예: 모터, 릴레이, 밸브, LED, 부저, 히터, Triac, 디스플레이 출력.
- comm: 외부 통신 포트·무선통신·안테나(상단 중앙). 예: LTE·BLE·Wi-Fi·LoRa 와 각 안테나, RS-485, CAN, Ethernet, USB, 외부 통신 커넥터.
- power: 전원부(하단). 전원 입력부터 각 전압 출력까지의 단계. 예: AC 입력 → 차단기·퓨즈 → 서지·EMI 보호 → AC/DC → DC/DC → LDO → MCU 및 부하. 같은 순서를 powerChain 배열에도 씁니다.
- storage_debug: 메모리, Flash, SD 카드, 디버그 포트(JTAG/SWD, UART Debug) — MCU 주변 왼쪽 하단.
- 동일 기능이 여러 채널이면 블록 하나에 channels 로 묶습니다(예: Triac Control Channel ×2).
- 절연이 필요한 블록(예: Triac 제어부, RS-485 통신부)은 isolation:true.

[연결선 규칙 — connections]
- 모든 연결에 interface(신호명·인터페이스)를 씁니다. 예: GPIO, ADC, DAC, I2C, SPI, QSPI, UART, USB, Ethernet, RS-485, CAN, PWM.
- 데이터·제어 신호는 kind data|control, 전원선은 kind power 에 voltage(3.3V, 5V, 12V, 24V, 220VAC 등)를 씁니다.
- 양방향이면 direction both.

[표현 규칙]
- 블록에는 기능명과 필요할 경우 부품명만 간결하게(label ≤ 40자, detail ≤ 80자). 세부 회로소자·저항·커패시터 값은 쓰지 않습니다.
- 미확정 항목은 임의로 확정하지 말고 tbd:true 로 표시하고 label 끝에 "(TBD)"를 붙입니다. 미확정 인터페이스는 "UART/SPI (TBD)"처럼 씁니다.
- 중요 확인사항과 미확정 항목은 reviewNotes(노란 메모)에 씁니다. kind: tbd(미확정), review(기술적으로 필요해 보이나 확인 안 됨), conflict(자료 간 내용이 다름 — 임의 선택 금지), question(고객 추가 확인).

[정보 처리 원칙]
1. 첨부자료에 없는 MCU, 센서, 통신방식, 부품명을 임의로 만들어내지 마세요. 각 블록의 evidence 에 근거가 되는 고객 자료 문장을 120자 이내로 그대로 인용합니다. 근거 문장이 없으면 tbd:true 로 두거나 블록을 만들지 않습니다.
2. 확정되지 않은 인터페이스는 "UART/SPI (TBD)" 처럼 tbd:true 로 표시합니다.
3. 기술적으로 필요한 것으로 판단되지만 확인되지 않은 기능은 블록으로 만들지 말고 reviewNotes(kind review)로 분리합니다.
4. 첨부자료끼리 내용이 다르면 임의로 선택하지 말고 reviewNotes(kind conflict)로 씁니다.
5. 모든 문장은 한국어(고유명사·규격명 제외). 출력은 JSON 객체 하나뿐입니다.

[출력 JSON 형식]
{"summary":"요구사항 요약 한두 문장","blocks":[{"id":"mcu","zone":"mcu","label":"메인 MCU (TBD)","detail":"","evidence":null,"tbd":true,"isolation":false,"channels":1}],"connections":[{"from":"sensor1","to":"mcu","interface":"I2C","direction":"to","kind":"data","voltage":"","tbd":false}],"powerChain":["AC 220V 입력","퓨즈","AC/DC","DC/DC 5V","LDO 3.3V"],"reviewNotes":[{"text":"…","kind":"review"}]}`;

function buildRichPrompt(source: DevReviewSource): string {
  const answers = source.answers
    .map((a) => `- ${DEV_REVIEW_QUESTION_MAP[a.code].label} → ${devReviewAnswerText(a)}`)
    .join('\n');
  const attachments = source.attachmentContext.trim();
  return [
    RICH_RULES,
    '[고객 자료]',
    `■ 제목: ${source.title}`,
    `■ 개발 분야: ${source.serviceAreas.map((a) => MARKET_SERVICE_AREA_LABELS[a]).join(', ')}`,
    `■ 설명:\n${source.description}`,
    `■ 질문 답변:\n${answers === '' ? '(없음)' : answers}`,
    `■ 첨부 자료:\n${attachments === '' ? '(없음)' : attachments}`,
  ].join('\n\n');
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const parseEach = <T>(schema: z.ZodType<T>, values: unknown[], max: number): T[] =>
  values.flatMap((v) => {
    const r = schema.safeParse(v);
    return r.success ? [r.data] : [];
  }).slice(0, max);

function parseRich(raw: string): RichOutputType {
  const o = extractJsonObject(raw);
  if (typeof o !== 'object' || o === null) throw new Error('NOT_OBJECT');
  const r = o as Record<string, unknown>;
  return RichOutput.parse({
    summary: r.summary,
    blocks: parseEach(Block, asArray(r.blocks), 40),
    connections: parseEach(Connection, asArray(r.connections), 60),
    powerChain: asArray(r.powerChain).filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 10),
    reviewNotes: parseEach(ReviewNote, asArray(r.reviewNotes), 12),
  });
}

// ── 채점 ───────────────────────────────────────────────────────────────────
interface ZoneScore { total: number; grounded: number; tbd: number; invented: number; forbidden: string[] }
const zoneScore = (): ZoneScore => ({ total: 0, grounded: 0, tbd: 0, invented: 0, forbidden: [] });

interface Score {
  zones: Record<Zone, ZoneScore>;
  blocks: ZoneScore;
  conn: { total: number; labeled: number; grounded: number; tbd: number; invented: number; forbidden: string[] };
  voltage: { total: number; ungrounded: number };
  powerChain: { total: number; grounded: number };
  notes: Record<'tbd' | 'review' | 'conflict' | 'question', number>;
  isolation: number;
}

// 인터페이스명은 고객이 그 이름(또는 동의어)을 말했을 때만 "자료에 있음"으로 친다.
const INTERFACE_SYNONYMS: Record<string, string[]> = {
  wifi: ['wifi', '와이파이', '무선랜'], ble: ['ble', 'bluetooth', '블루투스'], usb: ['usb'],
  ethernet: ['ethernet', '이더넷', '유선랜'], rs485: ['rs485', '485'], rs232: ['rs232', '232'], can: ['can'],
  lte: ['lte', '셀룰러', 'cellular'], lora: ['lora', '로라'], uart: ['uart', '시리얼', 'serial'], i2c: ['i2c'],
  spi: ['spi'], gpio: ['gpio'], adc: ['adc'], pwm: ['pwm'], mqtt: ['mqtt'], modbus: ['modbus', '모드버스'],
};
function interfaceGrounded(label: string, corpus: string): boolean {
  const parts = label.replace(/\(tbd\)/i, '').split(/[/,·]/).map((p) => normalizeForMatch(p)).filter((p) => p.length >= 2);
  if (parts.length === 0) return false;
  return parts.every((p) => {
    if (corpus.includes(p)) return true;
    const syn = Object.entries(INTERFACE_SYNONYMS).find(([k, list]) => k === p || list.some((s) => normalizeForMatch(s) === p));
    return syn === undefined ? false : syn[1].some((s) => corpus.includes(normalizeForMatch(s)));
  });
}

function score(out: RichOutputType, corpus: string, forbidden: readonly string[]): Score {
  const zones = Object.fromEntries(ZONES.map((z) => [z, zoneScore()])) as Record<Zone, ZoneScore>;
  const blocks = zoneScore();
  const forbiddenNorm = forbidden.map((f) => [f, normalizeForMatch(f)] as const);
  let isolation = 0;
  for (const b of out.blocks) {
    const z = zones[b.zone];
    const grounded = isGroundedQuote(b.evidence, corpus) && ungroundedTokens(b.label, corpus).length === 0;
    const bucket: keyof Omit<ZoneScore, 'total' | 'forbidden'> = grounded ? 'grounded' : b.tbd ? 'tbd' : 'invented';
    for (const s of [z, blocks]) {
      s.total += 1;
      s[bucket] += 1;
      const text = normalizeForMatch(`${b.label} ${b.detail}`);
      for (const [f, n] of forbiddenNorm) if (text.includes(n) && !b.tbd) s.forbidden.push(f);
    }
    if (b.isolation) isolation += 1;
  }
  const conn = { total: 0, labeled: 0, grounded: 0, tbd: 0, invented: 0, forbidden: [] as string[] };
  const voltage = { total: 0, ungrounded: 0 };
  for (const c of out.connections) {
    conn.total += 1;
    if (c.interface === '') continue;
    conn.labeled += 1;
    if (interfaceGrounded(c.interface, corpus)) conn.grounded += 1;
    else if (c.tbd || /tbd/i.test(c.interface)) conn.tbd += 1;
    else conn.invented += 1;
    const n = normalizeForMatch(c.interface);
    for (const [f, fn] of forbiddenNorm) if (n.includes(fn)) conn.forbidden.push(f);
    if (c.voltage !== '') {
      voltage.total += 1;
      if (ungroundedTokens(c.voltage, corpus).length > 0 || !corpus.includes(normalizeForMatch(c.voltage))) voltage.ungrounded += 1;
    }
  }
  const powerChain = { total: out.powerChain.length, grounded: 0 };
  for (const step of out.powerChain) {
    const n = normalizeForMatch(step.replace(/\(tbd\)/i, ''));
    const tokens = step.split(/[\s/→·]+/).map((t) => normalizeForMatch(t)).filter((t) => t.length >= 2);
    if (corpus.includes(n) || (tokens.length > 0 && tokens.some((t) => corpus.includes(t)))) powerChain.grounded += 1;
  }
  const notes = { tbd: 0, review: 0, conflict: 0, question: 0 };
  for (const nt of out.reviewNotes) notes[nt.kind] += 1;
  return { zones, blocks, conn, voltage, powerChain, notes, isolation };
}

// ── 실행 ───────────────────────────────────────────────────────────────────
interface Fixture {
  id: string; label: string; title: string; serviceAreas: DevReviewSource['serviceAreas']; description: string;
  answers: DevReviewSource['answers']; attachments: string[]; golden: { mustContain: string[]; forbidden: string[]; expectedOpen: string[] };
}
const args = new Map(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m === null ? [a, ''] : [m[1] ?? '', m[2] ?? '']; }));
const models = (args.get('models') ?? 'deepseek-v4-pro:0813').split(',').map((s) => s.trim()).filter(Boolean);
const visionModel = args.get('vision') ?? 'qwen3.5:397b';
const fixtureFilter = (args.get('fixtures') ?? 'all').split(',').map((s) => s.trim());
const outRoot = path.resolve(args.get('out') ?? '../../../.tmp/dev-review-probe/rich');
const envOr = <T,>(v: string | undefined, fb: T): string | T => { const t = v?.trim() ?? ''; return t === '' ? fb : t; };
const conn: AiConnection = { baseUrl: envOr(process.env.AI_BASE_URL, 'http://127.0.0.1:11434'), apiKey: envOr(process.env.AI_API_KEY, null) };
const fixtureDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/dev-review');
const MIME: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip', '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html' };

async function chat(model: string, prompt: string, extra: OllamaChatExtra, images: readonly string[] = []) {
  try {
    return await ollamaChatDetailed(conn, model, prompt, 600_000, images, extra);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/HTTP 4\d\d/.test(msg) && (extra.format !== undefined || extra.think !== undefined)) {
      const rest: OllamaChatExtra = { ...extra }; delete rest.format; delete rest.think;
      return ollamaChatDetailed(conn, model, prompt, 600_000, images, rest);
    }
    throw err;
  }
}

const pct = (n: number, d: number): string => (d === 0 ? '-' : `${String(Math.round((n / d) * 100))}%`);

async function main(): Promise<void> {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(outRoot, runId);
  mkdirSync(outDir, { recursive: true });
  const fixtures = readdirSync(fixtureDir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(readFileSync(path.join(fixtureDir, f), 'utf8')) as Fixture)
    .filter((fx) => fixtureFilter.includes('all') || fixtureFilter.some((p) => fx.id.startsWith(p)));
  console.log(`rich probe ${runId} — models ${models.join(', ')} · fixtures ${fixtures.map((f) => f.id).join(', ')}`);
  const rows: string[][] = [];
  for (const fx of fixtures) {
    const targets: UploadTarget[] = fx.attachments.map((name) => ({ buffer: readFileSync(path.join(fixtureDir, name)), filename: name, mimetype: MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream' }));
    const expanded = expandAiArchives(targets);
    const prepared = await prepareAiAttachments(expanded.files.map((f) => ({ ...f, filename: f.displayPath })), { maxFiles: 50 });
    let attachmentContext = prepared.context;
    if (prepared.images.length > 0) {
      const t = await chat(visionModel, buildAttachmentReadPrompt(prepared.images.length), { format: ATTACHMENT_READ_JSON_SCHEMA }, prepared.images);
      try { attachmentContext = `${attachmentContext}\n\n${parseAttachmentReadResult(t.text)}`; } catch { /* 텍스트만으로 진행 */ }
    }
    const source: DevReviewSource = { title: fx.title, serviceAreas: fx.serviceAreas, description: fx.description, answers: fx.answers, attachmentContext, attachmentFiles: fx.attachments };
    const prompt = buildRichPrompt(source);
    const corpus = buildDevReviewCorpus(source);
    writeFileSync(path.join(outDir, `${fx.id}-prompt.txt`), prompt);
    console.log(`\n■ ${fx.id} — ${fx.label}`);
    for (const model of models) {
      const tag = `${fx.id}__${model.replace(/[:/]/g, '_')}`;
      process.stdout.write(`  ▶ ${model} … `);
      try {
        const res = await chat(model, prompt, { format: RICH_JSON_SCHEMA, think: false });
        writeFileSync(path.join(outDir, `${tag}.raw.txt`), res.text);
        const out = parseRich(res.text);
        const s = score(out, corpus, fx.golden.forbidden);
        writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify({ score: s, output: out }, null, 2));
        const zoneCell = (z: Zone): string => `${String(s.zones[z].grounded)}/${String(s.zones[z].tbd)}/${String(s.zones[z].invented)}`;
        rows.push([
          fx.id, model, `${String(Math.round(res.elapsedMs / 1000))}s`,
          `${String(s.blocks.total)} · ${pct(s.blocks.grounded, s.blocks.total)}/${pct(s.blocks.tbd, s.blocks.total)}/${pct(s.blocks.invented, s.blocks.total)}`,
          zoneCell('mcu'), zoneCell('input'), zoneCell('output'), zoneCell('comm'), zoneCell('power'), zoneCell('storage_debug'),
          `${String(s.conn.labeled)}/${String(s.conn.total)} · ${String(s.conn.grounded)}/${String(s.conn.tbd)}/${String(s.conn.invented)}`,
          `${String(s.voltage.ungrounded)}/${String(s.voltage.total)}`,
          `${String(s.powerChain.grounded)}/${String(s.powerChain.total)}`,
          String(s.isolation),
          `${String(s.notes.tbd)}/${String(s.notes.review)}/${String(s.notes.conflict)}/${String(s.notes.question)}`,
          [...new Set([...s.blocks.forbidden, ...s.conn.forbidden])].join(' ') || '0',
        ]);
        console.log(`${String(Math.round(res.elapsedMs / 1000))}s · 블록 ${String(s.blocks.total)}(근거 ${String(s.blocks.grounded)} · TBD ${String(s.blocks.tbd)} · 지어냄 ${String(s.blocks.invented)}) · 연결 ${String(s.conn.total)}(ifc 근거 ${String(s.conn.grounded)} · TBD ${String(s.conn.tbd)} · 지어냄 ${String(s.conn.invented)}) · 전압 지어냄 ${String(s.voltage.ungrounded)}/${String(s.voltage.total)} · 전원체인 ${String(s.powerChain.grounded)}/${String(s.powerChain.total)} · 금지 ${String(new Set([...s.blocks.forbidden, ...s.conn.forbidden]).size)}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
        rows.push([fx.id, model, '✕', msg, '', '', '', '', '', '', '', '', '', '', '', '']);
        console.log(`실패 — ${msg}`);
      }
    }
  }
  const header = ['fixture', 'model', 'sec', '블록 전체 · 근거/TBD/지어냄', 'mcu', 'input', 'output', 'comm', 'power', 'storage', '연결 표기/전체 · 근거/TBD/지어냄', '전압 지어냄', '전원체인 근거', '절연', '메모 tbd/review/conflict/question', '금지'];
  const md = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  writeFileSync(path.join(outDir, 'summary.md'), `# rich diagram probe ${runId}\n\n존 셀 = 근거/TBD/지어냄 블록 수\n\n${md}\n`);
  console.log(`\n${md}\n\n→ ${outDir}`);
}

main().catch((err: unknown) => { console.error(err); process.exit(1); });
