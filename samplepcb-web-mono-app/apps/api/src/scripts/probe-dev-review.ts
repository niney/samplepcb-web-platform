// AI 사전 검토서 모델 프로빙 하네스 (docs/AI_DEV_REVIEW.md §9·§12.5) — 출하 코드(lib/ai/dev-review.ts ·
// attachment-extractor · ollama 클라이언트)를 그대로 실행해 픽스처 × 모델 × 반복으로 채점한다.
// 채점은 결정적: JSON 유효율 · 후처리 전후 확정 항목 수 · 규칙별 삭제 수 · 골든 사실 재현 ·
// 금지 사실(확정 표면) 0건 · 기대 상의 항목 재현 · 소요시간. 한국어 품질·구성도 모양은 산출
// 파일(`*.diagram.html`)을 육안으로.
//
// 실행(apps/api, .env 의 AI_BASE_URL/AI_API_KEY 사용 — DB 불필요):
//   pnpm exec tsx --env-file=.env src/scripts/probe-dev-review.ts \
//     --models=deepseek-v4-pro:0813,glm-5.3 --fixtures=all --runs=1 --think=off --vision=qwen3.5:397b
// 옵션: --think=on|off|both|auto(모델 기본) · --fixtures=01,03 · --out=../../../.tmp/dev-review-probe
//       --no-format(구조화 출력 끔) · --num-ctx=32768
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEV_REVIEW_LLM_JSON_SCHEMA, DevReviewRunPayload } from '@sp/api-contract';
import type { DevReviewLlmOutputType, MarketDevReviewType } from '@sp/api-contract';
import { renderDevReviewDiagramHtml } from '@sp/utils';
import { expandAiArchives } from '../lib/ai/archive';
import { prepareAiAttachments } from '../lib/ai/attachment-extractor';
import {
  ATTACHMENT_READ_JSON_SCHEMA,
  ATTACHMENT_READ_PROMPT_VERSION,
  DEV_REVIEW_PROMPT_VERSION,
  buildAttachmentReadPrompt,
  buildDevReviewPrompt,
  devReviewInputHash,
  normalizeForMatch,
  parseAttachmentReadResult,
  parseDevReviewLlmOutput,
  postProcessDevReview,
  type DevReviewSource,
} from '../lib/ai/dev-review';
import { ollamaChatDetailed, type AiConnection, type OllamaChatExtra } from '../lib/ai/ollama';
import type { UploadTarget } from '../lib/file-server';

interface Fixture {
  id: string;
  label: string;
  title: string;
  serviceAreas: DevReviewSource['serviceAreas'];
  description: string;
  answers: DevReviewSource['answers'];
  attachments: string[];
  golden: { mustContain: string[]; forbidden: string[]; expectedOpen: string[] };
}

const args = new Map(
  process.argv.slice(2).map((a) => {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    return m === null ? [a, ''] : [m[1] ?? '', m[2] ?? ''];
  }),
);
const models = (args.get('models') ?? 'deepseek-v4-pro:0813').split(',').map((s) => s.trim()).filter(Boolean);
const runs = Math.max(1, Number(args.get('runs') ?? '1'));
const thinkMode = args.get('think') ?? 'auto';
const visionModel = args.get('vision') ?? 'qwen3.5:397b';
const useFormat = !args.has('no-format');
const numCtx = args.has('num-ctx') ? Number(args.get('num-ctx')) : undefined;
const fixtureFilter = (args.get('fixtures') ?? 'all').split(',').map((s) => s.trim());
const outRoot = path.resolve(args.get('out') ?? '../../../.tmp/dev-review-probe');

const envOr = <T,>(value: string | undefined, fallback: T): string | T => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? fallback : trimmed;
};
const conn: AiConnection = {
  baseUrl: envOr(process.env.AI_BASE_URL, 'http://127.0.0.1:11434'),
  apiKey: envOr(process.env.AI_API_KEY, null),
};

const fixtureDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), 'fixtures/dev-review');
const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html',
};

const loadFixtures = (): Fixture[] =>
  readdirSync(fixtureDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(path.join(fixtureDir, f), 'utf8')) as Fixture)
    .filter((fx) => fixtureFilter.includes('all') || fixtureFilter.some((p) => fx.id.startsWith(p)));

const thinkVariants = (): (boolean | undefined)[] => {
  if (thinkMode === 'on') return [true];
  if (thinkMode === 'off') return [false];
  if (thinkMode === 'both') return [true, false];
  return [undefined];
};

interface RunRecord {
  fixture: string;
  model: string;
  think: string;
  run: number;
  ok: boolean;
  error: string | null;
  elapsedSec: number;
  thinkingChars: number;
  formatUsed: boolean;
  preFacts: number; // 후처리 전 요구+명세 행
  postFacts: number;
  diagnostics: Record<string, number> | null;
  golden: { must: string; forbidden: string[]; open: string };
  openQuestionCount: number;
  nodes: { inputs: number; chips: number; outputs: number };
  observations: { pre: number; post: number }; // 검토 관찰(§12.10 C 프로빙)
  questionAreas: string; // 상의 항목 분야 분포(예: c2 f1 g3)
}

const countFacts = (o: Pick<DevReviewLlmOutputType, 'requirements' | 'areas'>): number =>
  o.requirements.length + o.areas.reduce((sum, a) => sum + a.spec.length, 0);

// 확정 표면 — 여기에 금지 사실(지어낸 품번·수치)이 남으면 후처리 실패다.
const confirmedSurface = (review: MarketDevReviewType): string =>
  normalizeForMatch([
    review.summary,
    ...review.requirements.map((i) => i.text),
    ...review.areas.flatMap((a) => [a.summary, ...a.spec.map((r) => `${r.item} ${r.text}`)]),
    ...review.diagram.inputs.map((n) => `${n.label} ${n.detail}`),
    review.diagram.board.label,
    review.diagram.board.detail,
    ...review.diagram.board.chips,
    ...review.diagram.outputs.map((n) => `${n.label} ${n.detail}`),
    review.diagram.linkIn,
    review.diagram.linkOut,
    review.diagram.notes.flow,
    review.diagram.notes.design,
    review.diagram.notes.extension,
  ].join('\n'));

async function chatWithFallback(model: string, prompt: string, extra: OllamaChatExtra, images: readonly string[] = []) {
  try {
    return { ...(await ollamaChatDetailed(conn, model, prompt, 600_000, images, extra)), formatUsed: extra.format !== undefined };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 구조화 출력·think 미지원 모델은 옵션을 빼고 한 번 더.
    if (/HTTP 4\d\d/.test(msg) && (extra.format !== undefined || extra.think !== undefined)) {
      console.warn(`  ↻ ${model}: ${msg.slice(0, 120)} → format/think 없이 재시도`);
      const rest: OllamaChatExtra = { ...extra };
      delete rest.format;
      delete rest.think;
      return { ...(await ollamaChatDetailed(conn, model, prompt, 600_000, images, rest)), formatUsed: false };
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(outRoot, runId);
  mkdirSync(outDir, { recursive: true });
  const fixtures = loadFixtures();
  console.log(`probe ${runId} — base ${conn.baseUrl} · models ${models.join(', ')} · fixtures ${fixtures.map((f) => f.id).join(', ')} · runs ${String(runs)} · think ${thinkMode} · vision ${visionModel} · prompt ${DEV_REVIEW_PROMPT_VERSION}`);
  const records: RunRecord[] = [];

  for (const fx of fixtures) {
    DevReviewRunPayload.parse({ title: fx.title, serviceAreas: fx.serviceAreas, description: fx.description, answers: fx.answers });
    const targets: UploadTarget[] = fx.attachments.map((name) => ({
      buffer: readFileSync(path.join(fixtureDir, name)),
      filename: name,
      mimetype: MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream',
    }));
    const expanded = expandAiArchives(targets);
    const prepared = await prepareAiAttachments(
      expanded.files.map((f) => ({ ...f, filename: f.displayPath })),
      { maxFiles: 50 },
    );
    let attachmentContext = prepared.context;
    let visionSec = 0;
    if (prepared.images.length > 0) {
      const t = await chatWithFallback(visionModel, buildAttachmentReadPrompt(prepared.images.length), { format: ATTACHMENT_READ_JSON_SCHEMA }, prepared.images);
      visionSec = Math.round(t.elapsedMs / 1000);
      try {
        const block = parseAttachmentReadResult(t.text);
        attachmentContext = `${attachmentContext}\n\n${block}`;
        writeFileSync(path.join(outDir, `${fx.id}-vision.txt`), `# ${visionModel} · ${String(visionSec)}s · ${ATTACHMENT_READ_PROMPT_VERSION}\n\n${block}\n\n--- raw ---\n${t.text}`);
      } catch (err) {
        console.warn(`  vision parse failed: ${err instanceof Error ? err.message : String(err)}`);
        writeFileSync(path.join(outDir, `${fx.id}-vision.txt`), `# PARSE FAILED\n${t.text}`);
      }
    }
    const source: DevReviewSource = {
      title: fx.title, serviceAreas: fx.serviceAreas, description: fx.description, answers: fx.answers,
      attachmentContext, attachmentFiles: fx.attachments,
    };
    const prompt = buildDevReviewPrompt(source, '');
    writeFileSync(path.join(outDir, `${fx.id}-prompt.txt`), prompt);
    const inputHash = devReviewInputHash({ ...fx, attachmentHashes: prepared.hashes });
    console.log(`\n■ ${fx.id} — ${fx.label} · 첨부 ${String(expanded.files.length)}파일/이미지 ${String(prepared.images.length)}${visionSec > 0 ? ` (vision ${String(visionSec)}s)` : ''} · 프롬프트 ${String(prompt.length)}자`);

    for (const model of models) {
      for (const think of thinkVariants()) {
        for (let run = 1; run <= runs; run += 1) {
          const thinkLabel = think === undefined ? 'auto' : think ? 'on' : 'off';
          const tag = `${fx.id}__${model.replace(/[:/]/g, '_')}__think-${thinkLabel}__r${String(run)}`;
          process.stdout.write(`  ▶ ${model} think=${thinkLabel} r${String(run)} … `);
          const record: RunRecord = {
            fixture: fx.id, model, think: thinkLabel, run, ok: false, error: null, elapsedSec: 0, thinkingChars: 0,
            formatUsed: false, preFacts: 0, postFacts: 0, diagnostics: null,
            golden: { must: '-', forbidden: [], open: '-' }, openQuestionCount: 0, nodes: { inputs: 0, chips: 0, outputs: 0 },
            observations: { pre: 0, post: 0 }, questionAreas: '-',
          };
          try {
            const extra: OllamaChatExtra = {
              ...(useFormat ? { format: DEV_REVIEW_LLM_JSON_SCHEMA } : {}),
              ...(think === undefined ? {} : { think }),
              ...(numCtx === undefined ? {} : { numCtx }),
            };
            const res = await chatWithFallback(model, prompt, extra);
            record.elapsedSec = Math.round(res.elapsedMs / 1000);
            record.thinkingChars = res.thinkingChars;
            record.formatUsed = res.formatUsed;
            writeFileSync(path.join(outDir, `${tag}.raw.txt`), res.text);
            const output = parseDevReviewLlmOutput(res.text);
            record.preFacts = countFacts(output);
            const { review, diagnostics } = postProcessDevReview(output, source, {
              jobId: randomUUID(), model, promptVersion: DEV_REVIEW_PROMPT_VERSION, inputHash,
              generatedAt: new Date().toISOString(), attachmentFiles: fx.attachments,
            });
            record.diagnostics = { ...diagnostics };
            record.postFacts = countFacts(review);
            record.openQuestionCount = review.openQuestions.length;
            record.observations = {
              pre: output.areas.reduce((n, a) => n + a.observations.length, 0),
              post: review.areas.reduce((n, a) => n + a.observations.length, 0),
            };
            record.questionAreas = ['circuit', 'pcb', 'firmware', 'general']
              .map((a) => [a[0], review.openQuestions.filter((q) => q.area === a).length] as const)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => `${k ?? ''}${String(n)}`)
              .join(' ') || '-';
            record.nodes = {
              inputs: review.diagram.inputs.length,
              chips: review.diagram.board.chips.length,
              outputs: review.diagram.outputs.length,
            };
            const surface = confirmedSurface(review);
            const whole = normalizeForMatch(JSON.stringify(review));
            const mustHit = fx.golden.mustContain.filter((s) => whole.includes(normalizeForMatch(s)));
            const forbiddenHit = fx.golden.forbidden.filter((s) => surface.includes(normalizeForMatch(s)));
            const openText = normalizeForMatch(review.openQuestions.map((q) => `${q.question} ${q.why}`).join('\n'));
            const openHit = fx.golden.expectedOpen.filter((k) => openText.includes(normalizeForMatch(k)));
            record.golden = {
              must: `${String(mustHit.length)}/${String(fx.golden.mustContain.length)}`,
              forbidden: forbiddenHit,
              open: `${String(openHit.length)}/${String(fx.golden.expectedOpen.length)}`,
            };
            record.ok = true;
            writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify({ record, output, review, missingGolden: fx.golden.mustContain.filter((s) => !mustHit.includes(s)) }, null, 2));
            writeFileSync(path.join(outDir, `${tag}.diagram.html`), renderDevReviewDiagramHtml(review.diagram));
            console.log(`${String(record.elapsedSec)}s · 확정 ${String(record.preFacts)}→${String(record.postFacts)} · R1 ${String(diagnostics.r1Dropped)}✕ R2 ${String(diagnostics.r2Dropped)}✕ R8 ${String(diagnostics.r8Dropped)}✕(불일치 ${String(diagnostics.conflicts)}) 토큰 ${String(diagnostics.tokensStripped)} · 골든 ${record.golden.must} · 금지 ${String(forbiddenHit.length)} · 상의 ${record.golden.open}(${String(review.openQuestions.length)}) · 구성도 ${String(record.nodes.inputs)}/${String(record.nodes.chips)}/${String(record.nodes.outputs)} · 관찰 ${String(record.observations.pre)}→${String(record.observations.post)} · R9 ${String(diagnostics.r9Checks)} · 분야 ${record.questionAreas}`);
          } catch (err) {
            record.error = err instanceof Error ? err.message.slice(0, 300) : String(err);
            console.log(`실패 — ${record.error}`);
          }
          records.push(record);
          writeFileSync(path.join(outDir, 'records.json'), JSON.stringify(records, null, 2));
        }
      }
    }
  }

  const rows = records.map((r) => [
    r.fixture, r.model, r.think, r.ok ? '✓' : `✕ ${r.error ?? ''}`, String(r.elapsedSec), r.formatUsed ? 'fmt' : 'free',
    `${String(r.preFacts)}→${String(r.postFacts)}`,
    r.diagnostics === null ? '-' : `${String(r.diagnostics.r1Dropped)}/${String(r.diagnostics.r2Dropped)}/${String(r.diagnostics.r8Dropped)}(${String(r.diagnostics.conflicts)})/${String(r.diagnostics.tokensStripped)}`,
    r.golden.must, r.golden.forbidden.length === 0 ? '0' : r.golden.forbidden.join(' '), r.golden.open, String(r.openQuestionCount),
    `${String(r.nodes.inputs)}/${String(r.nodes.chips)}/${String(r.nodes.outputs)}`,
    `${String(r.observations.pre)}→${String(r.observations.post)}`,
    r.diagnostics === null ? '-' : String(r.diagnostics.r9Checks),
    r.questionAreas,
  ]);
  const header = ['fixture', 'model', 'think', 'ok', 'sec', 'mode', '확정(전→후)', 'R1✕/R2✕/R8✕(불일치)/토큰', '골든', '금지', '상의항목', '상의수', '구성도 입력/칩/출력', '관찰(전→후)', 'R9', '상의 분야'];
  const md = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  writeFileSync(path.join(outDir, 'summary.md'), `# dev-review probe ${runId} (${DEV_REVIEW_PROMPT_VERSION})\n\n${md}\n`);
  console.log(`\n${md}\n\n→ ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
