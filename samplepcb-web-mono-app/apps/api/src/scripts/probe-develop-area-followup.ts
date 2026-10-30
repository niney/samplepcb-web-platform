// 개별 메뉴 AI 맞춤 질문 프로빙(시험 단계) — 출하 예정 프롬프트·파서(lib/ai/develop-area-followup.ts)와 ollama 클라이언트를
// 그대로 실행해 예시 의뢰마다 결과를 남긴다. 채점은 없다 — 사람이 고정 질문과 나란히 보고 판단한다(비교 페이지는 results.json 으로 만든다).
// DB 는 쓰지 않는다(runner.ts 를 import 하지만 chatWithOptionFallback 만 부른다).
//
// 실행(cwd=apps/api, .env 의 AI_BASE_URL/AI_API_KEY — 키는 출력·파일에 남기지 않는다):
//   node --env-file=.env --import tsx src/scripts/probe-develop-area-followup.ts --models=kimi-k3 --think=low --tag=v1
// 옵션: --models 쉼표 목록(`모델@think` 로 모델마다 think 고정) · --think default|off|on|low|medium|high|max · --cases all|id 앞글자 쉼표
//       --concurrency 동시 호출(기본 3) · --timeout 초(기본 300) · --tag 출력 폴더 꼬리표 · --out 출력 루트
// 산출: <out>/<타임스탬프>-<tag>/ results.json · records.jsonl · prompts/ · raw/
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AiConnection, OllamaChatExtra, OllamaThink } from '../lib/ai/ollama';
import { chatWithOptionFallback } from '../lib/ai/runner';
import {
  DEVELOP_AREA_FOLLOWUP_JSON_SCHEMA,
  DEVELOP_AREA_FOLLOWUP_PROMPT_VERSION,
  buildAreaBanks,
  buildDevelopAreaFollowupPrompt,
  parseDevelopAreaFollowupLlmOutput,
  type AreaFollowupParsed,
} from '../lib/ai/develop-area-followup';
import { AREA_FOLLOWUP_PROBE_CASES, type AreaFollowupProbeCase } from './probe-develop-area-followup.cases';

const argv = process.argv.slice(2);
const args = new Map<string, string>();
for (const a of argv) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m?.[1] !== undefined) args.set(m[1], m[2] ?? '');
}
const list = (k: string, d: string): string[] =>
  (args.get(k) ?? d)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
const thinkValue = (t: string): OllamaThink | undefined => {
  if (t === 'default') return undefined;
  if (t === 'on') return true;
  if (t === 'off') return false;
  if (t === 'low' || t === 'medium' || t === 'high' || t === 'max') return t;
  throw new Error(`think 값 모름: ${t}`);
};

const modelSpecs = list('models', 'kimi-k3');
const thinkDefault = args.get('think') ?? 'low';
const runsFor = modelSpecs.map((spec) => {
  const [model = spec, pinned] = spec.split('@');
  return { model, think: pinned ?? thinkDefault };
});
const caseFilter = list('cases', 'all');
const cases = AREA_FOLLOWUP_PROBE_CASES.filter((c) => caseFilter.includes('all') || caseFilter.some((p) => c.id.startsWith(p)));
const concurrency = Math.min(10, Math.max(1, Number(args.get('concurrency') ?? '3')));
const timeoutMs = Math.max(30, Number(args.get('timeout') ?? '300')) * 1000;
const tag = args.get('tag') ?? 'run';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '../..');
const repoRoot = path.resolve(apiRoot, '../../..');
const outRoot = path.resolve(apiRoot, args.get('out') ?? path.join(repoRoot, '.tmp/develop-area-followup-probe'));
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const outDir = path.join(outRoot, `${stamp}-${tag.replace(/[^\w.-]/g, '_')}`);
mkdirSync(path.join(outDir, 'prompts'), { recursive: true });
mkdirSync(path.join(outDir, 'raw'), { recursive: true });

const envOr = <T>(v: string | undefined, fallback: T): string | T => {
  const trimmed = (v ?? '').trim();
  return trimmed === '' ? fallback : trimmed;
};
const conn: AiConnection = {
  baseUrl: envOr(process.env.AI_BASE_URL, 'http://127.0.0.1:11434'),
  apiKey: envOr(process.env.AI_API_KEY, null),
};
const log = {
  info: (): void => undefined,
  warn: (obj: unknown, msg?: string): void => {
    console.warn('[warn]', msg ?? '', typeof obj === 'object' && obj !== null && 'err' in obj ? String(obj.err) : '');
  },
};

interface ProbeRecord {
  caseId: string;
  model: string;
  think: string;
  elapsedMs: number;
  thinkingChars: number;
  error: string | null;
  parsed: AreaFollowupParsed | null;
}

const attachmentContextOf = (c: AreaFollowupProbeCase): string => c.attachments.map((a) => `[${a.name}]\n${a.text}`).join('\n\n');

async function runOne(c: AreaFollowupProbeCase, model: string, think: string): Promise<ProbeRecord> {
  const prompt = buildDevelopAreaFollowupPrompt({
    areas: c.areas,
    title: c.title,
    description: c.description,
    attachmentContext: attachmentContextOf(c),
    attachmentFiles: c.attachments.map((a) => a.name),
  });
  writeFileSync(path.join(outDir, 'prompts', `${c.id}.txt`), prompt);
  const extra: OllamaChatExtra = { format: DEVELOP_AREA_FOLLOWUP_JSON_SCHEMA };
  const t = thinkValue(think);
  if (t !== undefined) extra.think = t;
  const base = { caseId: c.id, model, think };
  try {
    const res = await chatWithOptionFallback(conn, model, prompt, timeoutMs, [], extra, log);
    writeFileSync(path.join(outDir, 'raw', `${c.id}--${model.replace(/[^\w.-]/g, '_')}--${think}.txt`), res.text);
    try {
      return { ...base, elapsedMs: res.elapsedMs, thinkingChars: res.thinkingChars, error: null, parsed: parseDevelopAreaFollowupLlmOutput(res.text, c.areas) };
    } catch (err) {
      return { ...base, elapsedMs: res.elapsedMs, thinkingChars: res.thinkingChars, error: `PARSE: ${err instanceof Error ? err.message : String(err)}`, parsed: null };
    }
  } catch (err) {
    return { ...base, elapsedMs: 0, thinkingChars: 0, error: err instanceof Error ? err.message : String(err), parsed: null };
  }
}

async function main(): Promise<void> {
  const jobs = cases.flatMap((c) => runsFor.map((r) => ({ c, ...r })));
  console.log(`cases=${String(cases.length)} runs=${String(jobs.length)} concurrency=${String(concurrency)} → ${outDir}`);
  const records: ProbeRecord[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += 1;
      const job = jobs[i];
      if (job === undefined) return;
      const rec = await runOne(job.c, job.model, job.think);
      records.push(rec);
      appendFileSync(path.join(outDir, 'records.jsonl'), `${JSON.stringify(rec)}\n`);
      const p = rec.parsed;
      console.log(
        `${rec.caseId} ${rec.model}@${rec.think} ${(rec.elapsedMs / 1000).toFixed(1)}s ` +
          (p === null ? `ERROR ${rec.error ?? ''}` : `covered=${String(p.covered.length)} ask=${String(p.questions.filter((q) => q.origin === 'ask').length)} new=${String(p.questions.filter((q) => q.origin === 'new').length)} restored=${String(p.questions.filter((q) => q.origin === 'restored').length)} dropped=${String(p.dropped.length)}`),
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  const results = {
    promptVersion: DEVELOP_AREA_FOLLOWUP_PROMPT_VERSION,
    generatedAt: new Date().toISOString(),
    runs: runsFor,
    cases: cases.map((c) => ({
      ...c,
      banks: buildAreaBanks(c.areas),
      records: records.filter((r) => r.caseId === c.id),
    })),
  };
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`done → ${path.join(outDir, 'results.json')}`);
}

void main();
