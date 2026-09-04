// 정밀 시스템 구성도 프로빙(docs/AI_DEV_REVIEW.md §13.6) — **운영 코드 그대로**: 프롬프트 빌더·게이트·살균·
// 감사가 apps/api lib/ai/dev-diagram 의 함수다(§9 규율: 프로빙 = 실코드 재사용). 화면·DB 는 안 건드리고
// 첨부 추출기와 ollama 클라이언트만 실코드로 쓴다. 픽스처는 검토서 프로빙과 같은 apps/api/src/scripts/fixtures/dev-review.
//
// 실행(apps/api/.env 의 AI_BASE_URL/AI_API_KEY 사용):
//   cd e2e && cross-env PORTAL_E2E=1 DIAGRAM_PROBE=1 pnpm exec vitest run dev-diagram-probe
//   옵션: DIAGRAM_MODEL(기본 kimi-k3 — 404 면 :cloud 접미 폴백) · DIAGRAM_THINK(기본 high) · DIAGRAM_FIXTURES(쉼표, 기본 07,09)
//        DIAGRAM_TIMEOUT_MS(기본 900000) · DIAGRAM_FORCE=1(게이트 무시 — 아이디어 단계 거동 실측)
// 산출: e2e/output/dev-diagram/<runId>/<fixture>/ — prompt.txt · raw.md · page.html(살균본) · audit.json
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { expandAiArchives } from '../../apps/api/src/lib/ai/archive';
import { prepareAiAttachments } from '../../apps/api/src/lib/ai/attachment-extractor';
import {
  auditDevDiagramHtml,
  buildDevDiagramPrompt,
  devDiagramGate,
  isDevDiagramAcceptable,
  sanitizeDevDiagramHtml,
} from '../../apps/api/src/lib/ai/dev-diagram';
import type { DevReviewSource } from '../../apps/api/src/lib/ai/dev-review';
import { ollamaChatDetailed } from '../../apps/api/src/lib/ai/ollama';
import { RUN, monoRoot, outputDir, requireAiConnection } from '../helpers';

const PROBE = RUN && process.env.DIAGRAM_PROBE === '1';
const MODEL = process.env.DIAGRAM_MODEL ?? 'kimi-k3';
const THINK = (process.env.DIAGRAM_THINK ?? 'high') as 'low' | 'medium' | 'high';
const TIMEOUT_MS = Number(process.env.DIAGRAM_TIMEOUT_MS ?? '900000');
const FORCE = process.env.DIAGRAM_FORCE === '1'; // 게이트 무시 — 아이디어 단계 거동 실측용
const FIXTURES = (process.env.DIAGRAM_FIXTURES ?? '07,09').split(',').map((s) => s.trim()).filter((s) => s !== '');
const FIXTURE_DIR = join(monoRoot, 'apps', 'api', 'src', 'scripts', 'fixtures', 'dev-review');

interface Fixture {
  id: string;
  label: string;
  title: string;
  serviceAreas: string[];
  description: string;
  answers: DevReviewSource['answers'];
  attachments: string[];
  golden: { mustContain: string[]; forbidden: string[] };
}

// 픽스처 파일명은 "NN-<slug>.json" — 접두 두 자리로 찾는다.
const findFixture = (prefix: string): Fixture => {
  const name = readdirSync(FIXTURE_DIR).find((f) => f.startsWith(`${prefix}-`) && f.endsWith('.json'));
  if (name === undefined) throw new Error(`fixture ${prefix} not found`);
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), 'utf8')) as Fixture;
};

async function buildSource(fx: Fixture): Promise<DevReviewSource> {
  const files = fx.attachments.map((name) => ({
    buffer: readFileSync(join(FIXTURE_DIR, name)),
    filename: name,
    mimetype: name.endsWith('.docx')
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
  }));
  const expanded = expandAiArchives(files);
  const prepared = await prepareAiAttachments(expanded.files.map((f) => ({ ...f, filename: f.displayPath })), { maxFiles: 50 });
  return {
    title: fx.title,
    serviceAreas: fx.serviceAreas,
    description: fx.description,
    answers: fx.answers,
    attachmentContext: prepared.context,
    attachmentFiles: fx.attachments,
  };
}

// ollama.com 직결은 `:cloud` 없음, 로컬 프록시는 있음 — 러너와 같은 폴백.
async function chat(conn: ReturnType<typeof requireAiConnection>, model: string, prompt: string) {
  try {
    return await ollamaChatDetailed(conn, model, prompt, TIMEOUT_MS, [], { think: THINK, temperature: 0, seed: 42 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/HTTP 404/.test(msg)) throw err;
    const alt = model.endsWith(':cloud') ? model.slice(0, -6) : `${model}:cloud`;
    return ollamaChatDetailed(conn, alt, prompt, TIMEOUT_MS, [], { think: THINK, temperature: 0, seed: 42 });
  }
}

describe.skipIf(!PROBE)('정밀 시스템 구성도 — 운영 프롬프트 프로빙', () => {
  const runId = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const root = join(outputDir, 'dev-diagram', runId);
  mkdirSync(root, { recursive: true });
  const summary: Record<string, unknown>[] = [];

  for (const prefix of FIXTURES) {
    test(`${prefix}: 게이트 → 생성 → 살균 → 감사`, async () => {
      const fx = findFixture(prefix);
      const dir = join(root, fx.id);
      mkdirSync(dir, { recursive: true });
      const source = await buildSource(fx);
      const gate = devDiagramGate(source);
      console.log(`  [${fx.id}] ${fx.label} · 코퍼스 ${String(gate.corpusChars)}자 · 게이트 ${gate.ok ? '통과' : `생략(${gate.reason ?? ''})`}`);
      const prompt = buildDevDiagramPrompt(source);
      writeFileSync(join(dir, 'prompt.txt'), prompt);
      if (!gate.ok && !FORCE) {
        summary.push({ fixture: fx.id, gate: 'skipped', corpusChars: gate.corpusChars });
        return;
      }
      const conn = requireAiConnection();
      const t0 = Date.now();
      const res = await chat(conn, MODEL, prompt);
      writeFileSync(join(dir, 'raw.md'), res.text);
      const { html, stripped } = sanitizeDevDiagramHtml(res.text);
      writeFileSync(join(dir, 'page.html'), html);
      const audit = auditDevDiagramHtml(html, source, stripped);
      const text = html.replace(/<[^>]+>/g, ' ');
      const goldenHit = fx.golden.mustContain.filter((t) => text.toLowerCase().includes(t.toLowerCase()));
      const forbiddenHit = fx.golden.forbidden.filter((t) => text.toLowerCase().includes(t.toLowerCase()));
      const record = {
        fixture: fx.id, model: MODEL, think: THINK, elapsedSec: Math.round((Date.now() - t0) / 1000),
        thinkingChars: res.thinkingChars, chars: res.text.length, acceptable: isDevDiagramAcceptable(audit),
        audit, golden: `${String(goldenHit.length)}/${String(fx.golden.mustContain.length)}`, forbiddenHit,
      };
      writeFileSync(join(dir, 'audit.json'), JSON.stringify(record, null, 2));
      summary.push({ ...record, gate: gate.ok ? 'ok' : 'forced' });
      console.log(`  ▶ ${fx.id}: ${String(record.elapsedSec)}s · thinking ${String(res.thinkingChars)}자 · svg ${String(audit.svgCount)} · 섹션 ${String(audit.sectionCount)} · 자료 밖 ${String(audit.ungroundedTokens.length)} · 빠진 품번 ${String(audit.requiredMissing.length)} · 골든 ${record.golden} · 금지 ${String(forbiddenHit.length)}`);
      expect(record.acceptable).toBe(true);
      expect(forbiddenHit).toEqual([]);
    }, TIMEOUT_MS + 60_000);
  }

  test('요약 기록', () => {
    writeFileSync(join(root, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(`  요약 → ${join(root, 'summary.json')}`);
  });
});
