// AI 사전 검토서 모델 프로빙 하네스 (docs/AI_DEV_REVIEW.md §9) — 출하 코드(lib/ai/dev-review.ts ·
// attachment-extractor · ollama 클라이언트)를 그대로 실행해 픽스처 × 모델 × 반복으로 채점한다.
// 채점은 결정적: JSON 유효율 · 후처리 전 확정 수 · 규칙별 강등/삭제 수 · 골든 사실 재현 ·
// 금지 사실(확정 표면) 0건 · 기대 확인 항목 재현 · 소요시간. 한국어 품질은 산출 파일을 육안으로.
//
// 실행(apps/api, .env 의 AI_BASE_URL/AI_API_KEY 사용 — DB 불필요):
//   pnpm exec tsx --env-file=.env src/scripts/probe-dev-review.ts \
//     --models=deepseek-v4-pro:0813,glm-5.2 --fixtures=all --runs=1 --think=off --vision=qwen3.5:397b
// 옵션: --think=on|off|both|auto(모델 기본) · --fixtures=01,03 · --out=../../../.tmp/dev-review-probe
//       --no-format(구조화 출력 끔) · --num-ctx=32768
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEV_REVIEW_LLM_JSON_SCHEMA, DevReviewRunPayload } from '@sp/api-contract';
import type { DevReviewLlmOutputType } from '@sp/api-contract';
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
  '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.html': 'text/html',
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
  preConfirmed: number;
  preNeeds: number;
  diagnostics: Record<string, number> | null;
  stats: { confirmed: number; needsConfirmation: number } | null;
  golden: { must: string; forbidden: string[]; open: string };
  openQuestionCount: number;
  blocks: number;
}

const countItems = (o: DevReviewLlmOutputType) => {
  const all = [...o.requirements, ...o.areas.flatMap((a) => [...a.scope, ...a.spec])];
  return {
    confirmed: all.filter((i) => i.status === 'confirmed').length,
    needs: all.filter((i) => i.status === 'needs_confirmation').length,
  };
};

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
  console.log(`probe ${runId} — base ${conn.baseUrl} · models ${models.join(', ')} · fixtures ${fixtures.map((f) => f.id).join(', ')} · runs ${String(runs)} · think ${thinkMode} · vision ${visionModel}`);
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
            formatUsed: false, preConfirmed: 0, preNeeds: 0, diagnostics: null, stats: null,
            golden: { must: '-', forbidden: [], open: '-' }, openQuestionCount: 0, blocks: 0,
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
            const pre = countItems(output);
            record.preConfirmed = pre.confirmed;
            record.preNeeds = pre.needs;
            const { review, diagnostics } = postProcessDevReview(output, source, {
              jobId: randomUUID(), model, promptVersion: DEV_REVIEW_PROMPT_VERSION, inputHash,
              generatedAt: new Date().toISOString(), attachmentFiles: fx.attachments,
            });
            record.diagnostics = { ...diagnostics };
            record.stats = review.stats;
            record.openQuestionCount = review.openQuestions.length;
            record.blocks = review.diagram.blocks.length;
            // 채점 — 확정 표면(요약·확정 항목·구성도 라벨·명세 항목명)에 금지 사실이 없어야 한다.
            const confirmedSurface = normalizeForMatch([
              review.summary,
              ...review.requirements.filter((i) => i.status === 'confirmed').map((i) => i.text),
              ...review.areas.flatMap((a) => [
                ...a.scope.filter((i) => i.status === 'confirmed').map((i) => i.text),
                ...a.spec.map((r) => `${r.item} ${r.status === 'confirmed' ? r.text : ''}`),
                ...a.risks.map((r) => r.text),
              ]),
              ...review.diagram.blocks.map((b) => b.label),
            ].join('\n'));
            const whole = normalizeForMatch(JSON.stringify(review));
            const mustHit = fx.golden.mustContain.filter((s) => whole.includes(normalizeForMatch(s)));
            const forbiddenHit = fx.golden.forbidden.filter((s) => confirmedSurface.includes(normalizeForMatch(s)));
            const openText = normalizeForMatch(review.openQuestions.map((q) => `${q.topic} ${q.question} ${q.why}`).join('\n'));
            const openHit = fx.golden.expectedOpen.filter((k) => openText.includes(normalizeForMatch(k)));
            record.golden = {
              must: `${String(mustHit.length)}/${String(fx.golden.mustContain.length)}`,
              forbidden: forbiddenHit,
              open: `${String(openHit.length)}/${String(fx.golden.expectedOpen.length)}`,
            };
            record.ok = true;
            writeFileSync(path.join(outDir, `${tag}.json`), JSON.stringify({ record, output, review, missingGolden: fx.golden.mustContain.filter((s) => !mustHit.includes(s)) }, null, 2));
            console.log(`${String(record.elapsedSec)}s · 확정 ${String(pre.confirmed)}→${String(review.stats.confirmed)} · 확인 ${String(review.stats.needsConfirmation)} · R1 ${String(diagnostics.r1Demoted)}↓/${String(diagnostics.r1Dropped)}✕ R2 ${String(diagnostics.r2Dropped)}✕ R7 ${String(diagnostics.r7Dropped)}✕ · 골든 ${record.golden.must} · 금지 ${String(forbiddenHit.length)} · 확인항목 ${record.golden.open} · 열린질문 ${String(review.openQuestions.length)} · 블록 ${String(review.diagram.blocks.length)}`);
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
    `${String(r.preConfirmed)}→${String(r.stats?.confirmed ?? 0)}`, String(r.stats?.needsConfirmation ?? 0),
    r.diagnostics === null ? '-' : `${String(r.diagnostics.r1Demoted)}/${String(r.diagnostics.r1Dropped)}/${String(r.diagnostics.r2Dropped)}/${String(r.diagnostics.r7Dropped)}`,
    r.golden.must, r.golden.forbidden.length === 0 ? '0' : r.golden.forbidden.join(' '), r.golden.open, String(r.openQuestionCount), String(r.blocks),
  ]);
  const header = ['fixture', 'model', 'think', 'ok', 'sec', 'mode', '확정(전→후)', '확인', 'R1↓/R1✕/R2✕/R7✕', '골든', '금지', '확인항목', '열린질문', '블록'];
  const md = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
  writeFileSync(path.join(outDir, 'summary.md'), `# dev-review probe ${runId}\n\n${md}\n`);
  console.log(`\n${md}\n\n→ ${outDir}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
