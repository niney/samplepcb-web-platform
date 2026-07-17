import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { decodeLegacyKoreanZipName, expandAiArchives } from './archive';

describe('expandAiArchives', () => {
  it('ZIP 안의 ZIP을 재귀적으로 풀어 분석 대상 파일 경로를 유지한다', () => {
    const nested = zipSync({
      'board.kicad_pcb': strToU8('(kicad_pcb (version 20240108))'),
    });
    const outer = zipSync({
      'design/source.zip': nested,
      'notes/requirements.txt': strToU8('12V 입력, RS-485 통신'),
    });

    const result = expandAiArchives([{
      filename: 'submission.zip',
      mimetype: 'application/zip',
      buffer: Buffer.from(outer),
    }]);

    expect(result.warnings).toEqual([]);
    expect(result.files.map((file) => file.displayPath)).toEqual([
      'submission.zip/design/source.zip/board.kicad_pcb',
      'submission.zip/notes/requirements.txt',
    ]);
    expect(result.files.every((file) => file.extracted)).toBe(true);
  });

  it('경로 탈출 압축 항목을 무시한다', () => {
    const archive = zipSync({
      '../outside.txt': strToU8('should not be read'),
      'safe/readme.txt': strToU8('safe'),
    });

    const result = expandAiArchives([{
      filename: 'unsafe.zip',
      mimetype: 'application/zip',
      buffer: Buffer.from(archive),
    }]);

    expect(result.files.map((file) => file.displayPath)).toEqual(['unsafe.zip/safe/readme.txt']);
  });

  it('CP949로 기록돼 깨진 한글 ZIP 항목 이름을 복원한다', () => {
    expect(decodeLegacyKoreanZipName('ºÎÇ°¹èÄ¡.png')).toBe('부품배치.png');
    expect(decodeLegacyKoreanZipName('board.kicad_pcb')).toBe('board.kicad_pcb');
  });
});
