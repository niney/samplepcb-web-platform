import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractEqWorkbook } from './extract';
import { cleanCell, colLetter, pickMainSheet, serializeForLlm } from './serialize';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, '__fixtures__');
const REAL = path.resolve(HERE, '../../../../../../.tmp/EQ-L050AKM1001-SH136D2823C.xls');
const read = (f: string): ReturnType<typeof extractEqWorkbook> => extractEqWorkbook(readFileSync(path.join(FIX, f)), f);

describe('표기 도우미', () => {
  it('열 문자', () => {
    expect([0, 25, 26, 51, 64].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AZ', 'BM']);
  });
  it('셀 정리 — 줄바꿈 ⏎ · 연속 공백 하나 · 긴 셀 자름', () => {
    expect(cleanCell('序号\n*')).toBe('序号 ⏎ *');
    expect(cleanCell('日期        DD-MM-YYYY')).toBe('日期 DD-MM-YYYY');
    expect(cleanCell('가'.repeat(30), 10)).toBe(`${'가'.repeat(10)}…(20자 생략)`);
  });
});

describe('serializeForLlm', () => {
  it('(a) 메인 시트 행·병합 힌트·그림 자리표시, 그림 시트는 자리표시만', () => {
    const x = read('a-lhd-bilingual.xlsx');
    expect(pickMainSheet(x)?.name).toBe('问 题 描 述');
    const s = serializeForLlm(x);
    expect(s).toContain('## 메인 시트 "问 题 描 述"');
    expect(s).toMatch(/세로 병합\(같은 블록\): .*R8~R10\[ABCDEHIJKLMN\]/);
    expect(s).toMatch(/^R8 A:1 \| B:2026-09-12 \| C:soldmask dam阻焊桥 \| D:如图1/m);
    expect(s).toContain('[IMG img-1 sheet="问 题 描 述" at=F1]');
    expect(s).toContain('- 시트 "图 1": [IMG img-2 sheet="图 1" at=B2]');
    expect(s).not.toContain('返回问客主页');
    expect(s.length).toBeLessThan(6000);
  });
  it('(d) 메인 시트 그림은 걸친 행 바로 뒤', () => {
    const s = serializeForLlm(read('d-inline-figures.xlsx'));
    expect(s).toMatch(/^R8 A:2 .*\n {2}\[IMG img-3 sheet="EQ List" at=D8\]\n {2}\[IMG img-4 sheet="EQ List" at=D9\]/m);
  });
  it('(m) 문항마다 시트 하나인 양식 — 짧은 시트는 통째로 싣는다', () => {
    const s = serializeForLlm(read('m-sheet-per-item.xlsx'));
    for (const sheet of ['EQ1', 'EQ2', 'EQ3', '目录 Index']) expect(s).toContain(`"${sheet}"`);
    expect(s).toContain('B:B. 1oz');
    expect(s).not.toContain('생략');
  });
  it('입력 상한에서 자른다', () => {
    const s = serializeForLlm(read('f-many-types.xlsx'), { maxChars: 500 });
    expect(s.length).toBeLessThan(560);
    expect(s).toContain('입력 상한 500자에서 잘림');
  });
  it.skipIf(!existsSync(REAL))('실샘플 — 4천 자 안, 적층표 템플릿 시트는 앞부분만', () => {
    const s = serializeForLlm(extractEqWorkbook(readFileSync(REAL), 'real.xls'));
    expect(s.length).toBeLessThan(4000);
    expect(s).toContain('## 보조 시트(앞부분만) "Sheet1"');
    expect(s).toContain('## 그림·내용 없는 시트: "图 4"');
  });
});
