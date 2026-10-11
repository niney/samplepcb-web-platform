// PCB EQ 분석 모델 프로빙 하네스(D20 P2) — docs/PCB_EQ_AI_PROBE.md. 출하 코드(추출기·직렬화기·템플릿 파서·
// ollama 클라이언트·chatWithOptionFallback·extractJsonObject)를 그대로 실행해 정답(gold) 대비 채점한다.
// DB 는 쓰지 않는다(runner.ts 를 import 하지만 chatWithOptionFallback 만 부른다).
//
// 실행(cwd=apps/api, .env 의 AI_BASE_URL/AI_API_KEY — 키는 출력·파일에 남기지 않는다):
//   node --env-file=.env --import tsx src/scripts/probe-eq-parse.ts \
//     --models=kimi-k3,glm-5.3 --files=real,b,f --runs=1 --think=default,low --mode=llm --tag=stage1
// 옵션:
//   --models   쉼표 목록(ollama.com /api/tags 로 실행 직전 확인 — 없는 이름은 기록하고 뺀다).
//              `모델@think` 로 모델마다 think 를 고정할 수 있다(예 kimi-k3@low) — 그 모델은 --think 를 무시한다.
//   --files    all | 픽스처 id 앞글자(a,b,…) | real  (gold: src/lib/pcb-eq-extract/__fixtures__/*.gold.json
//              + .tmp/eq-probe/real/*.gold.json)
//   --runs     반복 횟수(안정성) · --think default|off|on|low|medium|high|max (쉼표로 여러 단계)
//   --mode     llm(전체 분석) | combo(템플릿 구조 + LLM 번역만) | template(LLM 없음) — 쉼표로 여러 개
//   --concurrency 동시 호출 수(기본 3, 최대 10 — ollama.com 은 동시 10까지 받는다, 2026-10-11 사용자 확인).
//              429·5xx 를 만나면 그 작업은 30초 뒤 다시 하고 동시성을 2씩(3 아래로는 안) 낮춘다 — 그 건은
//              backoff 로 표시해 지연 통계에서 뺀다.
//   --resume=<실행 폴더> 이어 달리기 — records.jsonl 에 (mode·model·think·file·run) 키가 있는 작업은 건너뛰고
//              같은 폴더에 덧붙인다(중복 키는 마지막 것만 채점).
//   --prompt v1|v2|v3(전체 분석 프롬프트 판 — 출하 판은 v3, 하네스 기본은 비교 기준인 v1) · --timeout 초(기본 600) · --temperature(기본 0)
//   --no-format 구조화 출력(JSON 스키마) 끔 · --tag 출력 폴더 꼬리표 · --out 출력 루트
// 산출: <out>/<타임스탬프>-<tag>/ records.jsonl · summary.md · summary.json · translations.md · raw/ · drafts/ · prompts/
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import type { PcbEqDraftType } from '@sp/api-contract';
import { extractJsonObject, ollamaListModels, type AiConnection, type OllamaChatExtra, type OllamaThink } from '../lib/ai/ollama';
import { chatWithOptionFallback } from '../lib/ai/runner';
import { extractEqWorkbook } from '../lib/pcb-eq-extract/extract';
import {
  EQ_DRAFT_JSON_SCHEMA,
  EQ_PARSE_PROMPT_VERSIONS,
  EQ_TRANSLATE_JSON_SCHEMA,
  EQ_TRANSLATE_PROMPT_VERSION,
  buildEqParsePrompt,
  buildEqTranslatePrompt,
  coerceEqDraft,
  mergeTranslation,
  parseEqJson,
  type EqJsonParsePath,
  type EqParsePromptVersion,
} from '../lib/pcb-eq-extract/prompt';
import { scoreEqDraft, type EqDraftScore, type EqGold } from '../lib/pcb-eq-extract/probe-score';
import { serializeForLlm } from '../lib/pcb-eq-extract/serialize';
import { parseEqTemplate } from '../lib/pcb-eq-extract/template';

// ── 인자 ────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const args = new Map<string, string>();
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i] ?? '';
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m?.[1] === undefined) continue;
  if (m[2] !== undefined) args.set(m[1], m[2]);
  else if (argv[i + 1] !== undefined && !(argv[i + 1] ?? '').startsWith('--')) {
    args.set(m[1], argv[i + 1] ?? '');
    i += 1;
  } else args.set(m[1], '');
}
const list = (k: string, d: string): string[] =>
  (args.get(k) ?? d)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
const modelSpecs = list('models', 'deepseek-v4-pro:0813');
const models = [...new Set(modelSpecs.map((m) => m.split('@')[0] ?? m))];
const thinksFor = (model: string): string[] => {
  const pinned = modelSpecs.filter((m) => m.startsWith(`${model}@`)).map((m) => m.slice(model.length + 1));
  return pinned.length > 0 ? pinned : thinks;
};
const fileFilter = list('files', 'all');
const runs = Math.max(1, Number(args.get('runs') ?? '1'));
const thinks = list('think', 'default');
const modes = list('mode', 'llm');
const concurrency = Math.min(10, Math.max(1, Number(args.get('concurrency') ?? '3')));
// 실행 중 동시성 — 429·5xx 를 만나면 낮춘다(pool 의 일꾼은 자기 번호가 이 값 이상이면 쉰다).
const limiter = { value: concurrency };
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const timeoutMs = Math.max(30, Number(args.get('timeout') ?? '600')) * 1000;
const temperature = Number(args.get('temperature') ?? '0');
const useFormat = !args.has('no-format');
const tag = args.get('tag') ?? 'probe';
const promptVersion: EqParsePromptVersion =
  EQ_PARSE_PROMPT_VERSIONS.find((v) => v === `eq-parse-${args.get('prompt') ?? 'v1'}`) ?? 'eq-parse-v1';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(apiRoot, '../../..');
const outRoot = path.resolve(apiRoot, args.get('out') ?? path.join(repoRoot, '.tmp/eq-probe'));
const fixtureDir = path.resolve(here, '../lib/pcb-eq-extract/__fixtures__');
const realDir = path.join(repoRoot, '.tmp/eq-probe/real');

const envOr = <T,>(value: string | undefined, fallback: T): string | T => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? fallback : trimmed;
};
const conn: AiConnection = {
  baseUrl: envOr(process.env.AI_BASE_URL, 'http://127.0.0.1:11434'),
  apiKey: envOr(process.env.AI_API_KEY, null),
};

const thinkValue = (t: string): OllamaThink | undefined => {
  if (t === 'default') return undefined;
  if (t === 'on') return true;
  if (t === 'off') return false;
  if (t === 'low' || t === 'medium' || t === 'high' || t === 'max') return t;
  throw new Error(`think 값 모름: ${t}`);
};

// ── 코퍼스 ──────────────────────────────────────────────────────────────────

interface Prepared {
  gold: EqGold;
  serialized: string;
  prompt: string;
  imageIds: string[];
  template: PcbEqDraftType | null;
  templateMs: number;
  extractMs: number;
}

function loadGolds(): { gold: EqGold; dir: string }[] {
  const out: { gold: EqGold; dir: string }[] = [];
  for (const dir of [fixtureDir, realDir]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.gold.json')).sort()) {
      out.push({ gold: JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as EqGold, dir });
    }
  }
  return out.filter(({ gold }) => fileFilter.includes('all') || fileFilter.some((p) => gold.id.startsWith(p)));
}

function prepare(gold: EqGold, dir: string): Prepared {
  const file = path.resolve(dir, gold.file);
  const t0 = performance.now();
  const x = extractEqWorkbook(readFileSync(file), path.basename(file));
  const extractMs = performance.now() - t0;
  const serialized = serializeForLlm(x);
  const t1 = performance.now();
  const tpl = parseEqTemplate(x);
  const templateMs = performance.now() - t1;
  return {
    gold,
    serialized,
    prompt: buildEqParsePrompt(serialized, promptVersion),
    imageIds: x.images.map((i) => i.id),
    template: tpl.draft,
    templateMs,
    extractMs,
  };
}

// ── 실행 ────────────────────────────────────────────────────────────────────

type Mode = 'llm' | 'combo' | 'template';

interface Job {
  mode: Mode;
  model: string;
  think: string;
  file: Prepared;
  run: number;
}

interface RunRecord {
  tag: string;
  mode: Mode;
  model: string;
  think: string;
  file: string;
  run: number;
  ok: boolean;
  error: string | null;
  attempts: number;
  elapsedMs: number;
  thinkingChars: number;
  outChars: number;
  promptChars: number;
  /** chatWithOptionFallback 가 format/think 를 빼고 다시 부른 횟수(모델이 옵션을 거절). */
  optionFallbacks: number;
  tagFallbacks: number;
  parseOk: boolean;
  fixes: string[];
  score: Omit<EqDraftScore, 'items'> | null;
  /** 문항 구조 지문 — 반복 실행의 안정성 비교용. */
  signature: string | null;
  /** JSON 을 어떻게 꺼냈나 — extract=공용 extractJsonObject 그대로, whole/scan=그 결과에 items 가 없어 구제. */
  parsePath: EqJsonParsePath | null;
  /** 시도별 실패·옵션 폴백 메모. */
  notes: string[];
  /** 이 작업을 시작할 때의 동시성(지연 비교는 같은 동시성끼리). */
  concurrency: number;
  /** 429·5xx 로 30초 쉬고 다시 한 건 — 지연 통계에서 뺀다. */
  backoff: boolean;
}

const recordKey = (r: Pick<RunRecord, 'mode' | 'model' | 'think' | 'file' | 'run'>): string =>
  `${r.mode}|${r.model}|${r.think}|${r.file}|${String(r.run)}`;

const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '_');

const recordName = (r: Pick<RunRecord, 'mode' | 'model' | 'think' | 'file' | 'run'>): string =>
  `${r.mode}__${safe(r.model)}__${r.think}__${r.file}__r${String(r.run)}`;

const signatureOf = (d: PcbEqDraftType): string =>
  d.items
    .map((it) => `${it.factoryNo ?? '?'}:${it.category}:${it.options.map((o) => `${o.key}${o.requiresComment ? '*' : ''}${o.recommended ? '+' : ''}`).join('')}:${[...it.figureRefs].sort().join('/')}`)
    .join('|');

function makeLogger(notes: string[]): Pick<FastifyBaseLogger, 'info' | 'warn'> {
  const push = (a: unknown, b?: unknown): void => {
    notes.push(typeof a === 'string' ? a : `${typeof b === 'string' ? b : ''} ${JSON.stringify(a)}`);
  };
  return { info: push, warn: push };
}

async function callJson(model: string, prompt: string, extra: OllamaChatExtra): Promise<{
  value: unknown;
  text: string;
  attempts: number;
  elapsedMs: number;
  thinkingChars: number;
  notes: string[];
  error: string | null;
  path: EqJsonParsePath | null;
  backoff: boolean;
}> {
  const notes: string[] = [];
  const log = makeLogger(notes);
  let attempts = 0;
  let maxAttempts = 2;
  let backoff = false;
  let elapsedMs = 0;
  let thinkingChars = 0;
  let text = '';
  let error: string | null = null;
  // JSON 파싱 실패·일시 오류는 1회 재시도(러너 관례와 같다). 429·5xx 는 30초 쉬고 한 번 더(시도 상한 +1).
  while (attempts < maxAttempts) {
    attempts += 1;
    const t0 = Date.now();
    try {
      const res = await chatWithOptionFallback(conn, model, prompt, timeoutMs, [], extra, log);
      elapsedMs += res.elapsedMs;
      thinkingChars += res.thinkingChars;
      text = res.text;
      const parsed = parseEqJson(res.text, extractJsonObject);
      return { value: parsed.value, text, attempts, elapsedMs, thinkingChars, notes, error: null, path: parsed.path, backoff };
    } catch (err) {
      elapsedMs += Date.now() - t0;
      error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
      notes.push(`attempt ${String(attempts)} 실패: ${error}`);
      if (/HTTP (?:429|5\d\d)|too many requests|rate limit|overloaded/i.test(error)) {
        if (!backoff) maxAttempts += 1;
        backoff = true;
        const before = limiter.value;
        limiter.value = Math.max(3, limiter.value - 2);
        notes.push(`백오프: 30초 대기 · 동시성 ${String(before)}→${String(limiter.value)}`);
        console.warn(`  ⏸ ${model} ${error.slice(0, 80)} — 30초 뒤 재시도, 동시성 ${String(before)}→${String(limiter.value)}`);
        await sleep(30_000);
      }
    }
  }
  return { value: null, text, attempts, elapsedMs, thinkingChars, notes, error, path: null, backoff };
}

// 원출력 → 초안 → 점수. 실행과 재채점(--rescore)이 같은 길을 쓴다.
function evaluate(mode: Mode, file: Prepared, value: unknown, base: RunRecord, name: string, outDir: string): RunRecord {
  const finish = (draft: PcbEqDraftType | null, schemaRaw: boolean): RunRecord => {
    const score = scoreEqDraft(file.gold, draft, schemaRaw, file.serialized);
    const { items, ...rest } = score;
    writeFileSync(path.join(outDir, 'drafts', `${name}.json`), JSON.stringify({ draft, score: { ...rest, items } }, null, 1));
    return { ...base, ok: draft !== null, score: rest, signature: draft === null ? null : signatureOf(draft) };
  };
  if (mode === 'template') return finish(file.template, file.template !== null);
  if (value === null) return finish(null, false);
  if (mode === 'combo') {
    if (file.template === null) return finish(null, false);
    return finish(mergeTranslation(file.template, value).draft, true);
  }
  const { draft, report } = coerceEqDraft(value, file.imageIds);
  base.fixes = report.fixes;
  if (draft === null && base.error === null) base.error = '정리 후에도 계약 불통과';
  return finish(draft, report.rawValid);
}

async function runJob(job: Job, outDir: string): Promise<RunRecord> {
  const { file } = job;
  const base: RunRecord = {
    tag,
    mode: job.mode,
    model: job.model,
    think: job.think,
    file: file.gold.id,
    run: job.run,
    ok: false,
    error: null,
    attempts: 0,
    elapsedMs: 0,
    thinkingChars: 0,
    outChars: 0,
    promptChars: 0,
    optionFallbacks: 0,
    tagFallbacks: 0,
    parseOk: false,
    fixes: [],
    score: null,
    signature: null,
    parsePath: null,
    notes: [],
    concurrency: limiter.value,
    backoff: false,
  };
  const name = recordName(base);

  if (job.mode === 'template') {
    base.elapsedMs = Math.round(file.templateMs + file.extractMs);
    base.parseOk = file.template !== null;
    return evaluate('template', file, null, base, name, outDir);
  }

  const think = thinkValue(job.think);
  if (job.mode === 'combo') {
    if (file.template === null) {
      base.error = '템플릿 파서 실패 — 번역만 조합 불가';
      return evaluate('combo', file, null, base, name, outDir);
    }
    const prompt = buildEqTranslatePrompt(file.template);
    base.promptChars = prompt.length;
    const extra: OllamaChatExtra = {
      ...(useFormat ? { format: EQ_TRANSLATE_JSON_SCHEMA } : {}),
      ...(think === undefined ? {} : { think }),
      temperature,
    };
    const res = await callJson(job.model, prompt, extra);
    Object.assign(base, {
      attempts: res.attempts,
      elapsedMs: res.elapsedMs + Math.round(file.templateMs + file.extractMs),
      thinkingChars: res.thinkingChars,
      outChars: res.text.length,
      optionFallbacks: res.notes.filter((n) => n.includes('format/think unsupported')).length,
      tagFallbacks: res.notes.filter((n) => n.includes('alternate tag')).length,
      error: res.error,
      parseOk: res.value !== null,
      parsePath: res.path,
      notes: res.notes,
      backoff: res.backoff,
    });
    writeFileSync(path.join(outDir, 'raw', `${name}.txt`), res.text);
    return evaluate('combo', file, res.value, base, name, outDir);
  }

  base.promptChars = file.prompt.length;
  const extra: OllamaChatExtra = {
    ...(useFormat ? { format: EQ_DRAFT_JSON_SCHEMA } : {}),
    ...(think === undefined ? {} : { think }),
    temperature,
  };
  const res = await callJson(job.model, file.prompt, extra);
  Object.assign(base, {
    attempts: res.attempts,
    elapsedMs: res.elapsedMs,
    thinkingChars: res.thinkingChars,
    outChars: res.text.length,
    optionFallbacks: res.notes.filter((n) => n.includes('format/think unsupported')).length,
    tagFallbacks: res.notes.filter((n) => n.includes('alternate tag')).length,
    error: res.error,
    parseOk: res.value !== null,
    parsePath: res.path,
    notes: res.notes,
    backoff: res.backoff,
  });
  writeFileSync(path.join(outDir, 'raw', `${name}.txt`), res.text);
  return evaluate('llm', file, res.value, base, name, outDir);
}

async function pool<T, R>(items: T[], n: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (slot: number): Promise<void> => {
    while (next < items.length) {
      if (slot >= limiter.value) {
        await sleep(5_000); // 백오프로 동시성이 내려가면 번호가 큰 일꾼부터 쉰다
        continue;
      }
      const idx = next;
      next += 1;
      const item = items[idx];
      if (item === undefined) continue;
      out[idx] = await fn(item, idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, (_, slot) => worker(slot)));
  return out;
}

// ── 요약 ────────────────────────────────────────────────────────────────────

const mean = (xs: number[]): number => (xs.length === 0 ? Number.NaN : xs.reduce((a, b) => a + b, 0) / xs.length);
const pct = (xs: number[], p: number): number => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))] ?? Number.NaN;
};
const f2 = (x: number): string => (Number.isNaN(x) ? '-' : x.toFixed(2));
const f1 = (x: number): string => (Number.isNaN(x) ? '-' : x.toFixed(1));
const sec = (ms: number): string => (Number.isNaN(ms) ? '-' : (ms / 1000).toFixed(1));
const stdev = (xs: number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

function summarize(records: RunRecord[]): { md: string; json: unknown } {
  const groups = new Map<string, RunRecord[]>();
  for (const r of records) {
    const k = `${r.mode}|${r.model}|${r.think}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const rows: { key: string; vals: Record<string, number | string> }[] = [];
  for (const [k, rs] of groups) {
    const [mode, model, think] = k.split('|');
    const scored = rs.map((r) => r.score).filter((s): s is Omit<EqDraftScore, 'items'> => s !== null);
    const sc = (f: (s: Omit<EqDraftScore, 'items'>) => number): number => mean(scored.map(f));
    // 429·5xx 로 쉬었다 다시 한 건(backoff)은 지연에서 뺀다 — 서버 대기열이 섞인다.
    const lat = rs.filter((r) => r.mode !== 'template' && r.parseOk && !r.backoff).map((r) => r.elapsedMs);
    // 안정성 — 같은 파일 반복의 종합 점수 표준편차 평균·구조 지문 일치율
    const byFile = new Map<string, RunRecord[]>();
    for (const r of rs) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
    const sds: number[] = [];
    const agree: number[] = [];
    for (const fr of byFile.values()) {
      if (fr.length < 2) continue;
      sds.push(stdev(fr.map((r) => r.score?.total ?? 0)));
      const sigs = fr.map((r) => r.signature ?? 'X');
      const top = Math.max(...[...new Set(sigs)].map((s) => sigs.filter((x) => x === s).length));
      agree.push(top / sigs.length);
    }
    rows.push({
      key: k,
      vals: {
        mode: mode ?? '',
        model: model ?? '',
        think: think ?? '',
        n: rs.length,
        okRate: mean(rs.map((r) => (r.ok ? 1 : 0))),
        schemaRaw: mean(rs.map((r) => (r.score?.schemaRaw === true ? 1 : 0))),
        total: mean(rs.map((r) => r.score?.total ?? 0)),
        recall: sc((s) => s.recall),
        precision: sc((s) => s.precision),
        category: sc((s) => s.categoryAcc),
        keys: sc((s) => s.optionKeysAcc),
        reqComment: sc((s) => s.requiresCommentAcc),
        recommended: sc((s) => s.recommendedAcc),
        figure: sc((s) => s.figureAcc),
        slots: sc((s) => (s.emptySlotsDropped ? 1 : 0)),
        faith: sc((s) => s.faithfulness),
        fabricated: scored.reduce((a, s) => a + s.fabricated, 0),
        glossary: sc((s) => s.glossaryRate),
        header: sc((s) => s.headerAcc),
        p50: pct(lat, 50),
        p95: pct(lat, 95),
        thinkK: mean(rs.map((r) => r.thinkingChars / 1000)),
        fallbacks: rs.reduce((a, r) => a + r.optionFallbacks, 0),
        retries: rs.reduce((a, r) => a + Math.max(0, r.attempts - 1), 0),
        backoffs: rs.filter((r) => r.backoff).length,
        rescued: rs.filter((r) => r.parsePath === 'whole' || r.parsePath === 'scan').length,
        sd: sds.length === 0 ? Number.NaN : mean(sds),
        agree: agree.length === 0 ? Number.NaN : mean(agree),
      },
    });
  }
  rows.sort((a, b) => Number(b.vals.total) - Number(a.vals.total));
  const head = ['mode', 'model', 'think', 'n', 'ok', '계약(원)', '종합', '재현', '정밀', '유형', '기호', '의견필수', '권장', '그림', '빈슬롯', '원문충실', '지어냄', '용어집', '머리', 'p50s', 'p95s', '사고k', '옵션폴백', '재시도', '백오프', '파싱구제', '반복SD', '구조일치'];
  const md: string[] = [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`];
  for (const { vals: v } of rows) {
    md.push(
      `| ${[
        v.mode, v.model, v.think, v.n, f2(Number(v.okRate)), f2(Number(v.schemaRaw)), f1(Number(v.total)), f2(Number(v.recall)),
        f2(Number(v.precision)), f2(Number(v.category)), f2(Number(v.keys)), f2(Number(v.reqComment)), f2(Number(v.recommended)),
        f2(Number(v.figure)), f2(Number(v.slots)), f2(Number(v.faith)), v.fabricated, f2(Number(v.glossary)), f2(Number(v.header)),
        sec(Number(v.p50)), sec(Number(v.p95)), f1(Number(v.thinkK)), v.fallbacks, v.retries, v.backoffs, v.rescued, f1(Number(v.sd)), f2(Number(v.agree)),
      ].map(String).join(' | ')} |`,
    );
  }
  // 모델 × 파일 종합 점수
  const files = [...new Set(records.map((r) => r.file))].sort();
  const fileHead = ['mode/model/think', ...files];
  const fileMd: string[] = [`| ${fileHead.join(' | ')} |`, `|${fileHead.map(() => '---').join('|')}|`];
  for (const { key } of rows) {
    const rs = groups.get(key) ?? [];
    fileMd.push(
      `| ${[key.replace(/\|/g, ' · '), ...files.map((f) => f1(mean(rs.filter((r) => r.file === f).map((r) => r.score?.total ?? 0))))].join(' | ')} |`,
    );
  }
  const failures = records.filter((r) => !r.ok || r.error !== null);
  const failMd = failures.map((r) => `- ${r.mode} ${r.model} think=${r.think} ${r.file} r${String(r.run)}: ${r.error ?? '(계약 불통과)'}${r.fixes.length > 0 ? ` · 정리 ${r.fixes.join(',')}` : ''}`);
  return {
    md: [
      '## 모델별 집계', '', ...md, '',
      '## 모델 × 파일 종합 점수(평균)', '', ...fileMd, '',
      `## 실패·오류(${String(failures.length)})`, '', ...(failMd.length === 0 ? ['- 없음'] : failMd), '',
    ].join('\n'),
    json: rows.map((r) => r.vals),
  };
}

function translationsMd(records: RunRecord[], prepared: Prepared[], outDir: string): string {
  const out: string[] = ['# 번역 나란히 보기 — 정답(참조 번역) vs 모델(각 조합 r1)', ''];
  for (const p of prepared) {
    out.push(`## ${p.gold.id} — ${p.gold.label}`, '');
    const firsts = records.filter((r) => r.file === p.gold.id && r.run === 1 && r.mode !== 'template' && r.ok);
    for (const g of p.gold.draft.items) {
      out.push(`### ${g.factoryNo ?? '?'} (${g.category})`, '', `- 원문: ${g.questionOrig ?? ''}`, `- 정답: ${g.question}`);
      for (const r of firsts) {
        const name = `${r.mode}__${safe(r.model)}__${r.think}__${r.file}__r1`;
        const fp = path.join(outDir, 'drafts', `${name}.json`);
        if (!existsSync(fp)) continue;
        const d = (JSON.parse(readFileSync(fp, 'utf8')) as { draft: PcbEqDraftType | null }).draft;
        const it = d?.items.find((x) => (x.factoryNo ?? '').replace(/\.0+$/, '') === (g.factoryNo ?? ''));
        out.push(`- ${r.mode}·${r.model}·${r.think}: ${it === undefined ? '(문항 없음)' : `${it.question}  ⟨${it.options.map((o) => `${o.key}=${o.label}`).join(' / ')}⟩`}`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}

// ── main ────────────────────────────────────────────────────────────────────

// 재채점 — 이전 실행 폴더의 원출력(raw/)을 지금 코드(파서·정리·채점)로 다시 매긴다. 모델을 다시 부르지 않는다.
// 지연·재시도·폴백 같은 실행 기록은 원래 값을 그대로 쓴다. 결과는 <dir>/rescore/ 에.
function rescore(dir: string): void {
  const src = path.resolve(dir);
  const outDir = path.join(src, 'rescore');
  mkdirSync(path.join(outDir, 'drafts'), { recursive: true });
  const prepared = new Map(loadGolds().map(({ gold, dir: d }) => [gold.id, prepare(gold, d)]));
  const old = readFileSync(path.join(src, 'records.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Omit<RunRecord, 'notes' | 'parsePath' | 'concurrency' | 'backoff'> & Partial<Pick<RunRecord, 'notes' | 'parsePath' | 'concurrency' | 'backoff'>>);
  const records: RunRecord[] = [];
  for (const r of old) {
    const file = prepared.get(r.file);
    if (file === undefined) continue;
    const base: RunRecord = { ...r, fixes: [], score: null, signature: null, ok: false, parsePath: null, notes: r.notes ?? [], concurrency: r.concurrency ?? 3, backoff: r.backoff ?? false };
    const name = recordName(r);
    const rawPath = path.join(src, 'raw', `${name}.txt`);
    let value: unknown = null;
    if (r.mode !== 'template' && existsSync(rawPath)) {
      try {
        const parsed = parseEqJson(readFileSync(rawPath, 'utf8'), extractJsonObject);
        value = parsed.value;
        base.parsePath = parsed.path;
        base.parseOk = true;
      } catch {
        base.parseOk = false;
      }
    }
    records.push(evaluate(r.mode, file, value, base, name, outDir));
  }
  writeFileSync(path.join(outDir, 'records.jsonl'), `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const { md, json } = summarize(records);
  writeFileSync(path.join(outDir, 'summary.md'), `# 재채점 ${path.basename(src)}\n\n${md}`);
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(json, null, 1));
  console.log(`${md}\n→ ${outDir}`);
}

async function main(): Promise<void> {
  const rescoreDir = args.get('rescore');
  if (rescoreDir !== undefined && rescoreDir !== '') {
    rescore(rescoreDir);
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resumeDir = args.get('resume');
  const resuming = resumeDir !== undefined && resumeDir !== '';
  const outDir = resuming ? path.resolve(resumeDir) : path.join(outRoot, `${stamp}-${safe(tag)}`);
  for (const d of ['raw', 'drafts', 'prompts']) mkdirSync(path.join(outDir, d), { recursive: true });
  const recordsPath = path.join(outDir, 'records.jsonl');
  const readRecords = (): RunRecord[] => {
    if (!existsSync(recordsPath)) return [];
    const byKey = new Map<string, RunRecord>();
    for (const line of readFileSync(recordsPath, 'utf8').split(/\r?\n/)) {
      if (line.trim() === '') continue;
      // 동시성·백오프 필드가 생기기 전 기록(이어 달리기 앞부분)은 동시성 3·백오프 없음으로 본다.
      const r = JSON.parse(line) as Omit<RunRecord, 'concurrency' | 'backoff'> & Partial<Pick<RunRecord, 'concurrency' | 'backoff'>>;
      byKey.set(recordKey(r), { ...r, concurrency: r.concurrency ?? 3, backoff: r.backoff ?? false }); // 중복 키는 마지막 것
    }
    return [...byKey.values()];
  };
  const doneKeys = new Set(readRecords().map(recordKey));

  const golds = loadGolds();
  const prepared = golds.map(({ gold, dir }) => prepare(gold, dir));
  for (const p of prepared) writeFileSync(path.join(outDir, 'prompts', `${p.gold.id}.txt`), p.prompt);

  let available: string[] = [];
  const llmModes = modes.filter((m) => m !== 'template');
  let runModels = models;
  if (llmModes.length > 0) {
    try {
      available = await ollamaListModels(conn);
    } catch (err) {
      console.warn(`모델 목록 조회 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
    const has = (m: string): boolean => available.length === 0 || available.includes(m) || available.includes(`${m}:latest`);
    const missing = models.filter((m) => !has(m));
    if (missing.length > 0) console.warn(`목록에 없어 제외: ${missing.join(', ')}`);
    runModels = models.filter(has);
  }
  writeFileSync(
    path.join(outDir, resuming ? `meta-resume-${stamp}.json` : 'meta.json'),
    JSON.stringify(
      {
        tag, stamp, baseUrl: conn.baseUrl, models: runModels, requestedModels: models, available, files: prepared.map((p) => p.gold.id),
        runs, thinks, modes, concurrency, timeoutMs, temperature, useFormat, resumedFrom: resuming ? doneKeys.size : null,
        promptVersion, translatePromptVersion: EQ_TRANSLATE_PROMPT_VERSION,
        promptChars: Object.fromEntries(prepared.map((p) => [p.gold.id, p.prompt.length])),
      },
      null,
      1,
    ),
  );

  const jobs: Job[] = [];
  for (const mode of modes as Mode[]) {
    if (mode === 'template') {
      for (const file of prepared) jobs.push({ mode, model: '-', think: '-', file, run: 1 });
      continue;
    }
    for (let run = 1; run <= runs; run += 1) {
      for (const file of prepared) {
        for (const model of runModels) {
          for (const think of thinksFor(model)) jobs.push({ mode, model, think, file, run });
        }
      }
    }
  }
  const skipped = jobs.length;
  const pending = jobs.filter((j) => !doneKeys.has(recordKey({ ...j, file: j.file.gold.id })));
  jobs.length = 0;
  jobs.push(...pending);
  if (resuming) console.log(`이어 달리기: 기록 ${String(doneKeys.size)}건 있음 · 전체 ${String(skipped)} 중 남은 ${String(jobs.length)}건 · 동시성 ${String(concurrency)}`);
  console.log(`EQ probe ${stamp}-${tag} · base ${conn.baseUrl} · ${String(jobs.length)} jobs · models ${runModels.join(',')} · files ${prepared.map((p) => p.gold.id).join(',')} · think ${thinks.join(',')} · modes ${modes.join(',')} · runs ${String(runs)} · prompt ${promptVersion}`);
  console.log(`→ ${outDir}`);

  let done = 0;
  await pool(jobs, concurrency, async (job) => {
    let rec: RunRecord;
    try {
      rec = await runJob(job, outDir);
    } catch (err) {
      rec = {
        tag, mode: job.mode, model: job.model, think: job.think, file: job.file.gold.id, run: job.run, ok: false,
        error: `하네스 예외: ${(err instanceof Error ? err.message : String(err)).slice(0, 300)}`, attempts: 0, elapsedMs: 0,
        thinkingChars: 0, outChars: 0, promptChars: 0, optionFallbacks: 0, tagFallbacks: 0, parseOk: false, fixes: [], score: null, signature: null, parsePath: null, notes: [],
        concurrency: limiter.value, backoff: false,
      };
    }
    done += 1;
    appendFileSync(recordsPath, `${JSON.stringify(rec)}\n`);
    const s = rec.score;
    console.log(
      `[${String(done)}/${String(jobs.length)}] ${rec.mode} ${rec.model} think=${rec.think} ${rec.file} r${String(rec.run)} → ${sec(rec.elapsedMs)}s ${
        s === null ? `실패 ${rec.error ?? ''}` : `종합 ${f1(s.total)} R${f2(s.recall)} P${f2(s.precision)} 유형${f2(s.categoryAcc)} 기호${f2(s.optionKeysAcc)} 그림${f2(s.figureAcc)} 용어${f2(s.glossaryRate)} 계약${s.schemaRaw ? '○' : '△'}`
      }${rec.optionFallbacks > 0 ? ' [옵션폴백]' : ''}${rec.attempts > 1 ? ` [재시도${String(rec.attempts - 1)}]` : ''}${rec.backoff ? ' [백오프]' : ''} c${String(rec.concurrency)}`,
    );
    return rec;
  });

  const records = readRecords(); // 이어 달리기면 앞선 기록까지
  const { md, json } = summarize(records);
  writeFileSync(
    path.join(outDir, 'summary.md'),
    `# EQ 분석 프로빙 ${stamp}-${tag}\n\n- 프롬프트 ${promptVersion} / 번역 ${EQ_TRANSLATE_PROMPT_VERSION} · format ${useFormat ? 'JSON 스키마' : '끔'} · temperature ${String(temperature)} · runs ${String(runs)}\n- 파일: ${prepared.map((p) => `${p.gold.id}(${String(p.prompt.length)}자)`).join(', ')}\n\n${md}`,
  );
  writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(json, null, 1));
  writeFileSync(path.join(outDir, 'translations.md'), translationsMd(records, prepared, outDir));
  console.log(`\n${md}\n→ ${outDir}`);
}

await main();
