import ExcelJS from 'exceljs';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { prepareAiAttachments } from './attachment-extractor';

describe('AI 첨부 전처리', () => {
  it('텍스트·이미지·미지원 바이너리를 구분하고 원본 해시를 남긴다', async () => {
    const prepared = await prepareAiAttachments([
      {
        filename: 'requirements.md',
        mimetype: 'text/markdown',
        buffer: Buffer.from('# 요구사항\n온도 센서와 문열림 센서를 사용한다.'),
      },
      {
        filename: 'reference.png',
        mimetype: 'image/png',
        buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      },
      {
        filename: 'housing.step',
        mimetype: 'application/octet-stream',
        buffer: Buffer.from([1, 2, 3, 4]),
      },
    ]);

    expect(prepared.analyzedFiles).toBe(3);
    expect(prepared.hashes).toHaveLength(3);
    expect(prepared.hashes.every((hash) => /^[a-f0-9]{64}$/.test(hash))).toBe(true);
    expect(prepared.images).toHaveLength(1);
    expect(prepared.context).toContain('온도 센서와 문열림 센서');
    expect(prepared.context).toContain('내용을 추정하지 않음');
  });

  it('DOCX XML 텍스트와 포함 이미지를 추출한다', async () => {
    const docx = zipSync({
      'word/document.xml': strToU8(
        '<w:document><w:body><w:p><w:r><w:t>실외용 IP65 제어기</w:t></w:r></w:p></w:body></w:document>',
      ),
      'word/media/reference.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    });
    const prepared = await prepareAiAttachments([{
      filename: 'spec.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(docx),
    }]);

    expect(prepared.context).toContain('실외용 IP65 제어기');
    expect(prepared.context).toContain('이미지 1개 추출');
    expect(prepared.images).toHaveLength(1);
  });

  it('직접 첨부한 이미지를 문서에서 추출한 미리보기보다 먼저 모델에 보낸다', async () => {
    const docx = zipSync({
      'word/document.xml': strToU8('<w:document><w:body /></w:document>'),
      'word/media/reference.png': new Uint8Array([2]),
    });
    const directImage = Buffer.from([1]);
    const prepared = await prepareAiAttachments([
      {
        filename: 'spec.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        buffer: Buffer.from(docx),
      },
      { filename: 'schematic.png', mimetype: 'image/png', buffer: directImage },
    ]);

    expect(prepared.images[0]).toBe(directImage.toString('base64'));
  });

  it('XLSX 시트와 셀 값을 행 단위 텍스트로 추출한다', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('BOM');
    sheet.addRow(['품목', '수량', '비고']);
    sheet.addRow(['온도 센서', 2, '±0.5℃']);
    const data = await workbook.xlsx.writeBuffer();
    const prepared = await prepareAiAttachments([{
      filename: 'bom.xlsx',
      mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from(data),
    }]);

    expect(prepared.context).toContain('[시트: BOM]');
    expect(prepared.context).toContain('온도 센서\t2\t±0.5℃');
  });

  it('Office ZIP의 과도한 압축 해제 크기를 내용 추출 전에 차단한다', async () => {
    const oversizedDocx = zipSync({
      'word/document.xml': new Uint8Array(17 * 1024 * 1024),
    });
    const prepared = await prepareAiAttachments([{
      filename: 'oversized.docx',
      mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(oversizedDocx),
    }]);

    expect(prepared.analyzedFiles).toBe(0);
    expect(prepared.warnings).toHaveLength(1);
    expect(prepared.context).toContain('추출 실패 — 내용을 추정하지 않음');
  });
});
