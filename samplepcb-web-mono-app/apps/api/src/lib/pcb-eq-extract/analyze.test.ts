import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import CFB from 'cfb';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { PcbEqDraft, type PcbEqDraftType } from '@sp/api-contract';
import { EQ_PARSE_PROMPT_VERSION, analyzeEqFile, type EqChat } from './analyze';
import { extractEqWorkbook } from './extract';
import type { EqGold } from './probe-score';

// analyzeEqFile(D20 P2) — 러너가 부르는 진입점. LLM 은 가짜 chat 으로 갈음한다(정답 초안을 그대로, 또는 비틀어 돌려준다).

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), '__fixtures__');
const fixture = (id: string): { buf: Buffer; gold: EqGold } => {
  const gold = JSON.parse(readFileSync(path.join(FIX, `${id}.gold.json`), 'utf8')) as EqGold;
  return { buf: readFileSync(path.join(FIX, gold.file)), gold };
};
const clone = (d: PcbEqDraftType): PcbEqDraftType => JSON.parse(JSON.stringify(d)) as PcbEqDraftType;

// 부른 횟수·받은 프롬프트를 기록하는 가짜 chat. 응답은 차례로 하나씩(모자라면 마지막 것을 되풀이).
function fakeChat(...replies: (string | Error)[]): EqChat & { calls: { prompt: string; schema: unknown }[] } {
  const calls: { prompt: string; schema: unknown }[] = [];
  const chat = ((prompt: string, schema: unknown) => {
    const reply = replies[Math.min(calls.length, replies.length - 1)];
    calls.push({ prompt, schema });
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply ?? '');
  }) as EqChat & { calls: { prompt: string; schema: unknown }[] };
  chat.calls = calls;
  return chat;
}

const a = fixture('a-lhd-bilingual');

describe('analyzeEqFile — 성공', () => {
  it('정답대로 답하면 표시 없음 · 문항이 부른 그림만(로고 제외) · 프롬프트는 출하 판', async () => {
    const chat = fakeChat(JSON.stringify(a.gold.draft));
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, chat);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(EQ_PARSE_PROMPT_VERSION).toBe('eq-parse-v3');
    expect(PcbEqDraft.safeParse(res.draft).success).toBe(true);
    expect(res.draft).toEqual(a.gold.draft);
    expect(res.itemFlags).toHaveLength(res.draft.items.length);
    expect(res.itemFlags.flat()).toEqual([]);
    // 그림 5장 중 img-1 은 공장 로고(어느 문항도 안 부름) — 올리지 않는다.
    expect(res.images.map((i) => [i.ref, i.name, i.ext, i.mime])).toEqual([
      ['img-2', 'figure-2.png', 'png', 'image/png'],
      ['img-3', 'figure-3.png', 'png', 'image/png'],
      ['img-4', 'figure-4.png', 'png', 'image/png'],
      ['img-5', 'figure-5.png', 'png', 'image/png'],
    ]);
    expect(res.images.every((i) => i.data.subarray(1, 4).toString('latin1') === 'PNG')).toBe(true);
    expect(chat.calls).toHaveLength(1);
    expect(res.promptChars).toBe(chat.calls[0]?.prompt.length);
    expect(chat.calls[0]?.prompt).toContain('직접 지시하겠습니다(의견 작성)'); // v3 규칙
    expect(chat.calls[0]?.prompt).not.toContain('관리자 추가 지침');
    expect(chat.calls[0]?.schema).toMatchObject({ type: 'object', required: ['header', 'items'] });
  });

  it('관리자 추가 지침은 프롬프트 맨 끝에 붙는다', async () => {
    const chat = fakeChat(JSON.stringify(a.gold.draft));
    await analyzeEqFile({ buf: a.buf, fileName: a.gold.file, extraInstructions: '  UL 은 그대로 UL 로 쓴다.  ' }, chat);
    expect(chat.calls[0]?.prompt.trimEnd().endsWith('UL 은 그대로 UL 로 쓴다.')).toBe(true);
    expect(chat.calls[0]?.prompt).toContain('## 관리자 추가 지침');
  });

  it('JSON 을 못 꺼내면 한 번 더 부른다 — 두 번째가 되면 성공', async () => {
    const chat = fakeChat('죄송합니다, 표를 읽을 수 없습니다.', `\`\`\`json\n${JSON.stringify(a.gold.draft)}\n\`\`\``);
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, chat);
    expect(res.ok).toBe(true);
    expect(chat.calls).toHaveLength(2);
  });

  it('LLM 이 비운 작성일은 표 규칙(템플릿 파서) 값으로 채운다', async () => {
    const d = clone(a.gold.draft);
    d.header.issuedOn = null;
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, fakeChat(JSON.stringify(d)));
    expect(res.ok && res.draft.header.issuedOn).toBe('2026-09-12');
  });

  it('AI 가 남긴 빈 선택지·모르는 그림 id 는 정리하고 warnings 에 남긴다', async () => {
    const d = clone(a.gold.draft) as unknown as { items: { options: unknown[]; figureRefs: string[] }[] };
    d.items[0]?.options.push({ key: 'C', labelOrig: '', label: '', recommended: false, requiresComment: false });
    d.items[2]?.figureRefs.push('img-99');
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, fakeChat(JSON.stringify(d)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.draft).toEqual(a.gold.draft);
    expect(res.warnings.join(' ')).toContain('빈 선택지 제거');
    expect(res.warnings.join(' ')).toContain('모르는 그림 id 제거');
    expect(res.itemFlags.flat()).toEqual([]);
  });
});

describe('analyzeEqFile — 문항별 표시', () => {
  it('structure — 표 규칙과 선택지 기호·의견 필수·그림 연결이 다르면', async () => {
    const d = clone(a.gold.draft);
    const [i1, i2, , i4] = d.items;
    if (i1 === undefined || i2 === undefined || i4 === undefined) throw new Error('fixture');
    i2.options = i2.options.slice(0, 2); // 2번: C 를 빠뜨림
    i4.figureRefs = []; // 4번: 그림 2장을 못 이음
    i1.options = i1.options.map((o) => ({ ...o, requiresComment: false })); // 1번: B 의 의견 필수를 놓침
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, fakeChat(JSON.stringify(d)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.itemFlags.map((f) => f.map((x) => x.code))).toEqual([['structure'], ['structure'], [], ['structure'], []]);
    expect(res.itemFlags[0]?.[0]?.detail).toContain('의견 필수 선택지가 다릅니다(AI 없음 · 표 규칙 B)');
    expect(res.itemFlags[1]?.[0]?.detail).toContain('선택지 기호가 다릅니다(AI A·B · 표 규칙 A·B·C)');
    expect(res.itemFlags[3]?.[0]?.detail).toContain('그림 연결이 다릅니다(AI 0장 · 표 규칙 2장)');
    expect(res.images.map((i) => i.ref)).toEqual(['img-2', 'img-3']); // 4번이 안 부른 그림은 올리지 않는다
  });

  it('structure — AI 가 문항을 빠뜨리면 warnings 에, 표 규칙에 없는 번호를 만들면 그 문항에', async () => {
    const d = clone(a.gold.draft);
    const last = d.items.pop();
    if (last === undefined) throw new Error('fixture');
    d.items.push({ ...last, factoryNo: '9' });
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, fakeChat(JSON.stringify(d)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.itemFlags[4]?.[0]).toMatchObject({ code: 'structure' });
    expect(res.itemFlags[4]?.[0]?.detail).toContain('이 번호의 문항이 없습니다');
    expect(res.warnings.join(' ')).toContain('문항 5 도 읽혔으나 AI 초안에 없습니다');
  });

  it('structure — 표 규칙이 선택지를 자신 있게 못 읽은 문항(n 의 `A-…`)은 견주지 않는다(오경보 없음)', async () => {
    const n = fixture('n-hard-dense');
    const res = await analyzeEqFile({ buf: n.buf, fileName: n.gold.file }, fakeChat(JSON.stringify(n.gold.draft)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.draft.items).toHaveLength(23);
    expect(res.itemFlags.flat().filter((f) => f.code === 'structure')).toEqual([]);
  });

  it('translation — 인치 기호(2u")는 따옴표가 아니다(오경보 없음)', async () => {
    const e = fixture('e-lhd-v2');
    const res = await analyzeEqFile({ buf: e.buf, fileName: e.gold.file }, fakeChat(JSON.stringify(e.gold.draft)));
    expect(res.ok && res.itemFlags.flat()).toEqual([]);
  });

  it('translation — 번역이 원문의 수치를 빠뜨리면(질문·선택지)', async () => {
    const d = clone(a.gold.draft);
    const [i1, i2] = d.items;
    if (i1 === undefined || i2 === undefined) throw new Error('fixture');
    i1.question = 'U3 의 IC 패드 간격이 좁아 솔더마스크 댐을 남길 수 없습니다. 통 오픈을 권합니다.';
    i2.options = i2.options.map((o) => (o.key === 'A' ? { ...o, label: '변경에 동의' } : o));
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, fakeChat(JSON.stringify(d)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.itemFlags[0]).toEqual([{ code: 'translation', detail: '원문의 수치·파일명이 번역에 없습니다 — 질문: 0.18' }]);
    expect(res.itemFlags[1]).toEqual([{ code: 'translation', detail: '원문의 수치·파일명이 번역에 없습니다 — 선택지 A: 0.15' }]);
    expect(res.itemFlags.slice(2).flat()).toEqual([]);
  });

  it('figure — EMF 로 붙은 그림은 올리지 않고 그 문항에 표시한다', async () => {
    const d4 = fixture('d-inline-figures');
    // 미디어 하나를 EMF 로 바꿔 끼운 통합문서 — 문항이 부르는 그림이 걸릴 때까지 후보를 넘긴다(로고 제외).
    const asEmf = (target: string): Buffer => {
      const files = unzipSync(new Uint8Array(d4.buf));
      const renamed = target.replace(/\.png$/, '.emf');
      files[renamed] = files[target] ?? new Uint8Array();
      Reflect.deleteProperty(files, target);
      for (const p of Object.keys(files).filter((n) => n.endsWith('.rels'))) {
        files[p] = strToU8(strFromU8(files[p] ?? new Uint8Array()).split(path.basename(target)).join(path.basename(renamed)));
      }
      return Buffer.from(zipSync(files));
    };
    const media = Object.keys(unzipSync(new Uint8Array(d4.buf)))
      .filter((p) => p.startsWith('xl/media/'))
      .sort();
    let buf: Buffer = Buffer.alloc(0);
    let emf: { id: string } | undefined;
    let owner = -1;
    for (const target of media) {
      buf = asEmf(target);
      emf = extractEqWorkbook(buf, 'd.xlsx').images.find((i) => i.ext === 'emf');
      owner = d4.gold.draft.items.findIndex((it) => it.figureRefs.includes(emf?.id ?? ''));
      if (owner >= 0) break;
    }
    expect(emf).toBeDefined();
    expect(owner).toBeGreaterThanOrEqual(0);

    const res = await analyzeEqFile({ buf, fileName: 'd.xlsx' }, fakeChat(JSON.stringify(d4.gold.draft)));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const flags = res.itemFlags[owner] ?? [];
    expect(flags.map((f) => f.code)).toContain('figure');
    expect(flags.find((f) => f.code === 'figure')?.detail).toContain('EMF');
    expect(res.draft.items[owner]?.figureRefs).not.toContain(emf?.id);
    expect(res.images.map((i) => i.ref)).not.toContain(emf?.id);
    expect(res.images.every((i) => ['png', 'jpg', 'gif', 'webp'].includes(i.ext))).toBe(true);
    // 로고(img-1)는 어느 문항도 안 부른다.
    expect(res.images.map((i) => i.ref)).not.toContain('img-1');
  });
});

describe('analyzeEqFile — 실패 사유(계약 PCB_EQ_AI_FAIL_REASONS)', () => {
  it('unsupported_file — 엑셀 확장자가 아니면 LLM 을 부르지 않는다', async () => {
    const chat = fakeChat('{}');
    const res = await analyzeEqFile({ buf: Buffer.from('%PDF-1.7'), fileName: 'EQ.pdf' }, chat);
    expect(res).toMatchObject({ ok: false, reason: 'unsupported_file' });
    expect(chat.calls).toHaveLength(0);
  });
  it('unsupported_file — 통합문서가 없는 zip(거버만)', async () => {
    const chat = fakeChat('{}');
    const zip = Buffer.from(zipSync({ 'gerber/top.gbr': strToU8('G04*'), 'readme.txt': strToU8('hi') }));
    const res = await analyzeEqFile({ buf: zip, fileName: 'gerber.zip' }, chat);
    expect(res).toMatchObject({ ok: false, reason: 'unsupported_file' });
    expect(chat.calls).toHaveLength(0);
  });
  it('unreadable — 잘린(손상) xlsx', async () => {
    const chat = fakeChat('{}');
    const res = await analyzeEqFile({ buf: a.buf.subarray(0, Math.floor(a.buf.length / 2)), fileName: 'cut.xlsx' }, chat);
    expect(res).toMatchObject({ ok: false, reason: 'unreadable' });
    expect(chat.calls).toHaveLength(0);
  });
  it('unreadable — 암호가 걸린 통합문서(CFB 안 EncryptedPackage)', async () => {
    const cfb = CFB.utils.cfb_new();
    CFB.utils.cfb_add(cfb, 'EncryptionInfo', Buffer.alloc(64));
    CFB.utils.cfb_add(cfb, 'EncryptedPackage', Buffer.alloc(4096));
    const out: unknown = CFB.write(cfb, { type: 'buffer' });
    const res = await analyzeEqFile({ buf: Buffer.isBuffer(out) ? out : Buffer.alloc(0), fileName: 'locked.xlsx' }, fakeChat('{}'));
    expect(res).toMatchObject({ ok: false, reason: 'unreadable' });
    if (!res.ok) expect(res.detail).toContain('암호');
  });
  it('no_items — AI 가 문항을 못 찾음', async () => {
    const chat = fakeChat(JSON.stringify({ header: { customerPartNo: null, factoryPartNo: null, issuedOn: null }, items: [] }));
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, chat);
    expect(res).toMatchObject({ ok: false, reason: 'no_items' });
    expect(chat.calls).toHaveLength(1);
  });
  it('llm_failed — chat 이 throw 하면 다시 부르지 않는다', async () => {
    const chat = fakeChat(new Error('ollama chat HTTP 429: rate limited'));
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, chat);
    expect(res).toMatchObject({ ok: false, reason: 'llm_failed' });
    if (!res.ok) expect(res.detail).toContain('HTTP 429');
    expect(chat.calls).toHaveLength(1);
  });
  it('llm_failed — JSON 을 두 번 다 못 꺼냄 / 계약 모양이 아님', async () => {
    const garbage = fakeChat('표를 읽을 수 없습니다.');
    expect(await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, garbage)).toMatchObject({ ok: false, reason: 'llm_failed' });
    expect(garbage.calls).toHaveLength(2);
    const wrongShape = fakeChat(JSON.stringify({ header: {}, items: 'none' }));
    const res = await analyzeEqFile({ buf: a.buf, fileName: a.gold.file }, wrongShape);
    expect(res).toMatchObject({ ok: false, reason: 'llm_failed' });
    if (!res.ok) expect(res.detail.length).toBeLessThanOrEqual(300);
  });
});
