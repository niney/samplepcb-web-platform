import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  FILE_PREVIEW_MAX_BYTES,
  delimiterFor,
  fileViewKind,
  needsServerPreview,
  parseDelimited,
  resolveFileMime,
} from '@sp/api-contract';
import { describe, expect, it } from 'vitest';
import { buildFilePreview } from './file-preview';

// 첨부 미리보기 — 판별표는 프런트와 서버가 공유하는 계약이라 여기서 못 박고,
// 생성기는 **실제 파일**로 검증한다(합성 버퍼는 실무에서 오는 파일과 다르게 생겼다).

const REPO_E2E_FIXTURES = path.resolve(import.meta.dirname, '../../../../e2e/fixtures');
const DEV_REVIEW_FIXTURES = path.resolve(import.meta.dirname, '../scripts/fixtures/dev-review');

describe('fileViewKind — 판별표', () => {
  it('브라우저가 직접 그리는 형식', () => {
    expect(fileViewKind('a.png')).toBe('image');
    expect(fileViewKind('a.JPEG')).toBe('image'); // 대문자 확장자
    expect(fileViewKind('회로도.svg')).toBe('image');
    expect(fileViewKind('사양서.pdf')).toBe('pdf');
    expect(fileViewKind('notes.md')).toBe('text');
    expect(fileViewKind('bom.csv')).toBe('text');
    expect(fileViewKind('top.gbr')).toBe('text'); // 거버는 실제로 텍스트다
  });

  it('html 은 렌더가 아니라 소스 텍스트로 분류된다(origin 상속 방어)', () => {
    expect(fileViewKind('index.html')).toBe('text');
    expect(fileViewKind('page.htm')).toBe('text');
  });

  it('서버가 구조화해 주는 형식', () => {
    expect(fileViewKind('부품표.xlsx')).toBe('sheet');
    expect(fileViewKind('매크로.xlsm')).toBe('sheet');
    expect(fileViewKind('설명서.docx')).toBe('doc');
    expect(fileViewKind('gerber.zip')).toBe('archive');
    expect(needsServerPreview('sheet')).toBe(true);
    expect(needsServerPreview('doc')).toBe(true);
    expect(needsServerPreview('archive')).toBe(true);
    expect(needsServerPreview('pdf')).toBe(false);
  });

  it('구형 오피스·한글·도면은 미지원 — 능력이 아니라 경계다', () => {
    expect(fileViewKind('부품표.xls')).toBe('none');
    expect(fileViewKind('사양서.doc')).toBe('none');
    expect(fileViewKind('발표.ppt')).toBe('none');
    expect(fileViewKind('발표.pptx')).toBe('none');
    expect(fileViewKind('사양서.hwp')).toBe('none');
    expect(fileViewKind('외형.dwg')).toBe('none');
    expect(fileViewKind('확장자없음')).toBe('none');
  });
});

describe('resolveFileMime — 파일서버가 형식을 모를 때만 보정', () => {
  it('octet-stream 이면 확장자로 덮어쓴다', () => {
    expect(resolveFileMime('a.png', 'application/octet-stream')).toBe('image/png');
    expect(resolveFileMime('a.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(resolveFileMime('a.pdf', '')).toBe('application/pdf');
  });

  it('파일서버가 제대로 준 값은 존중한다', () => {
    expect(resolveFileMime('a.png', 'image/webp')).toBe('image/webp');
  });

  it('우리가 모르는 확장자는 서버 값을 그대로 둔다', () => {
    expect(resolveFileMime('a.hwp', 'application/octet-stream')).toBe('application/octet-stream');
  });
});

describe('parseDelimited — 따옴표 규칙', () => {
  it('따옴표 안의 구분자·줄바꿈과 "" 이스케이프를 지킨다', () => {
    const rows = parseDelimited('a,"b,c","d""e"\n1,2,3', ',');
    expect(rows).toEqual([
      ['a', 'b,c', 'd"e'],
      ['1', '2', '3'],
    ]);
  });

  it('따옴표 안 줄바꿈은 행을 끊지 않는다', () => {
    expect(parseDelimited('"위\n아래",x', ',')).toEqual([['위\n아래', 'x']]);
  });

  it('CRLF 와 끝 개행을 흘리지 않는다', () => {
    expect(parseDelimited('a,b\r\nc,d\r\n', ',')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('구분자 판정', () => {
    expect(delimiterFor('a.csv')).toBe(',');
    expect(delimiterFor('a.TSV')).toBe('\t');
    expect(delimiterFor('a.txt')).toBeNull();
  });
});

describe('buildFilePreview — 실파일', () => {
  it('xlsx 를 시트별 그리드로 만든다', async () => {
    const buffer = readFileSync(path.join(REPO_E2E_FIXTURES, 'bom-journey-14-multi-sheet.xlsx'));
    const preview = await buildFilePreview(1, 'bom-journey-14-multi-sheet.xlsx', buffer);
    expect(preview.kind).toBe('sheet');
    expect(preview.sheets).not.toBeNull();
    expect(preview.sheets?.length).toBeGreaterThan(1); // 이름 그대로 다중 시트 픽스처
    const first = preview.sheets?.[0];
    expect(first?.rows.length).toBeGreaterThan(0);
    expect(first?.rows[0]?.length).toBeGreaterThan(0);
    expect(preview.note).toContain('시트');
  });

  it('병합 셀은 좌상단만 남긴다 — 값이 열마다 반복되면 표가 안 읽힌다', async () => {
    const buffer = readFileSync(path.join(REPO_E2E_FIXTURES, 'bom-journey-14-multi-sheet.xlsx'));
    const preview = await buildFilePreview(1, 'bom-journey-14-multi-sheet.xlsx', buffer);
    const titleRow = preview.sheets?.[0]?.rows[0] ?? [];
    // 이 픽스처의 첫 행은 3열 병합 제목이다(실측). 첫 칸에만 값이 있어야 한다.
    expect(titleRow[0]).not.toBe('');
    expect(titleRow.slice(1).every((cell) => cell === '')).toBe(true);
  });

  it('docx 를 텍스트로 만든다 — 서식은 버리고 내용만', async () => {
    const buffer = readFileSync(path.join(DEV_REVIEW_FIXTURES, '07-controller-v2.docx'));
    const preview = await buildFilePreview(2, '07-controller-v2.docx', buffer);
    expect(preview.kind).toBe('doc');
    expect((preview.text ?? '').length).toBeGreaterThan(100);
    expect(preview.sheets).toBeNull();
  });

  it('zip 은 풀지 않고 목록만 만든다', async () => {
    const buffer = readFileSync(path.join(REPO_E2E_FIXTURES, 'arduino-uno.zip'));
    const preview = await buildFilePreview(3, 'arduino-uno.zip', buffer);
    expect(preview.kind).toBe('archive');
    expect(preview.entries?.length).toBeGreaterThan(0);
    // 디렉터리 엔트리는 목록에서 잡음이라 뺀다
    expect(preview.entries?.every((e) => !e.name.endsWith('/'))).toBe(true);
    expect(preview.note).toContain('압축');
  });

  it('브라우저가 직접 그리는 형식은 서버가 만들지 않는다', async () => {
    const preview = await buildFilePreview(4, 'photo.png', Buffer.from([1, 2, 3]));
    expect(preview.kind).toBe('unsupported');
    expect(preview.reason).toBe('FORMAT');
  });

  it('구형 오피스는 FORMAT 으로 거절한다(다운로드 폴백)', async () => {
    const preview = await buildFilePreview(5, '부품표.xls', Buffer.from([1, 2, 3]));
    expect(preview.kind).toBe('unsupported');
    expect(preview.reason).toBe('FORMAT');
  });

  it('상한을 넘으면 파싱하지 않는다', async () => {
    const big = Buffer.alloc(FILE_PREVIEW_MAX_BYTES + 1);
    const preview = await buildFilePreview(6, 'huge.xlsx', big);
    expect(preview.kind).toBe('unsupported');
    expect(preview.reason).toBe('TOO_LARGE');
  });

  it('손상 파일은 500 이 아니라 FAILED 로 돌려준다', async () => {
    const preview = await buildFilePreview(7, 'broken.xlsx', Buffer.from('not a zip at all'));
    expect(preview.kind).toBe('unsupported');
    expect(preview.reason).toBe('FAILED');
  });
});
