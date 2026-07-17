import path from 'node:path';
import ExcelJS from 'exceljs';
import { strFromU8, unzipSync } from 'fflate';
import { PDFParse } from 'pdf-parse';
import type { UploadTarget } from '../file-server';
import { hashAiBytes } from './jobs';

// AI 전송용 첨부 전처리. 원본은 저장하지 않고 요청 메모리에서 텍스트·미리보기만 만든다.
// 파일별/전체 상한을 두어 100MB 업로드 허용치가 그대로 모델 컨텍스트로 번지지 않게 한다.
const MAX_FILES = 10;
const MAX_TOTAL_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_PER_FILE = 20_000;
const MAX_TOTAL_TEXT = 80_000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_OFFICE_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_OFFICE_EXPANDED_BYTES = 32 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.tsv', '.json', '.jsonl', '.xml', '.yaml', '.yml',
  '.ini', '.conf', '.log', '.sql', '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx',
  '.vue', '.py', '.php', '.java', '.c', '.h', '.cpp', '.hpp', '.cs', '.go', '.rs', '.sh',
  '.ps1', '.bat', '.gbr', '.ger', '.drl', '.xln', '.bom', '.net', '.kicad_pcb', '.kicad_sch',
]);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const RASTER_IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
]);

export interface PreparedAiAttachments {
  context: string;
  images: string[];
  hashes: string[];
  analyzedFiles: number;
  warnings: string[];
}

export interface PrepareAiAttachmentsOptions {
  maxFiles?: number;
}

interface ExtractedFile {
  text: string;
  images: Buffer[];
  note: string;
}

interface ImageCandidate {
  image: Buffer;
  // 고객이 직접 넣은 이미지가 PDF/Office 문서에서 파생한 미리보기보다 우선이다.
  // 그렇지 않으면 앞선 대형 PDF가 이미지 예산을 모두 차지해 별도 회로도/외형도를 못 본다.
  priority: number;
  sourceIndex: number;
}

const truncate = (value: string, max: number): string =>
  value.length <= max ? value : `${value.slice(0, max)}\n…(이후 내용 생략)`;

const cleanText = (value: string): string =>
  value
    .replaceAll('\u0000', '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();

const decodeXmlEntities = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');

const officeXmlText = (xml: string): string => cleanText(decodeXmlEntities(
  xml
    .replace(/<(?:w:tab|a:tab)\b[^>]*\/?\s*>/gi, '\t')
    .replace(/<(?:w:br|a:br)\b[^>]*\/?\s*>/gi, '\n')
    .replace(/<\/(?:w:p|a:p|row)>/gi, '\n')
    .replace(/<\/(?:w:tc|a:tc|c)>/gi, '\t')
    .replace(/<[^>]+>/g, ''),
));

const officeArchive = (buffer: Buffer, extension: string): ExtractedFile => {
  const documentPattern = extension === '.docx'
    ? /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i
    : /^ppt\/slides\/slide\d+\.xml$/i;
  const mediaPrefix = extension === '.docx' ? 'word/media/' : 'ppt/media/';
  let expandedBytes = 0;
  const archive = unzipSync(new Uint8Array(buffer), {
    // 필요한 XML·래스터만 풀고 ZIP bomb의 선언 원본 크기를 압축 해제 전에 차단한다.
    filter: (file) => {
      const lowerName = file.name.toLowerCase();
      const isDocument = documentPattern.test(file.name);
      const isImage = lowerName.startsWith(mediaPrefix) && IMAGE_EXTENSIONS.has(path.extname(lowerName));
      if (!isDocument && !isImage) return false;
      const entryLimit = isImage ? MAX_IMAGE_BYTES : MAX_OFFICE_ENTRY_BYTES;
      if (file.originalSize > entryLimit) {
        if (isDocument) throw new Error('Office 문서 XML 크기가 분석 제한을 초과함');
        return false;
      }
      expandedBytes += file.originalSize;
      if (expandedBytes > MAX_OFFICE_EXPANDED_BYTES) {
        throw new Error('Office 압축 해제 크기가 분석 제한을 초과함');
      }
      return true;
    },
  });
  const names = Object.keys(archive).sort();
  const xmlNames = names.filter((name) => documentPattern.test(name));
  const texts = xmlNames.map((name) => {
    const data = archive[name];
    return data === undefined ? '' : officeXmlText(strFromU8(data));
  }).filter((text) => text !== '');
  const images = names
    .filter((name) => name.toLowerCase().startsWith(mediaPrefix) && IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .flatMap((name) => {
      const data = archive[name];
      return data === undefined || data.byteLength > MAX_IMAGE_BYTES ? [] : [Buffer.from(data)];
    })
    .slice(0, MAX_IMAGES);
  return {
    text: texts.join('\n\n'),
    images,
    note: `${extension.slice(1).toUpperCase()} 텍스트 ${String(texts.length)}개 영역·이미지 ${String(images.length)}개 추출`,
  };
};

const excelText = async (buffer: Buffer): Promise<ExtractedFile> => {
  let expandedBytes = 0;
  unzipSync(new Uint8Array(buffer), {
    filter: (file) => {
      expandedBytes += file.originalSize;
      if (file.originalSize > MAX_OFFICE_ENTRY_BYTES || expandedBytes > MAX_OFFICE_EXPANDED_BYTES) {
        throw new Error('XLSX 압축 해제 크기가 분석 제한을 초과함');
      }
      return false;
    },
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const lines: string[] = [];
  for (const worksheet of workbook.worksheets.slice(0, 12)) {
    lines.push(`[시트: ${worksheet.name}]`);
    let emittedRows = 0;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (emittedRows >= 500 || lines.join('\n').length >= MAX_TEXT_PER_FILE) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cells.length < 40) cells.push(cell.text.trim());
      });
      if (cells.some((cell) => cell !== '')) {
        lines.push(cells.join('\t'));
        emittedRows += 1;
      }
    });
  }
  return {
    text: cleanText(lines.join('\n')),
    images: [],
    note: `XLSX ${String(workbook.worksheets.length)}개 시트에서 셀 텍스트 추출`,
  };
};

const pdfContent = async (buffer: Buffer): Promise<ExtractedFile> => {
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    stopAtErrors: false,
  });
  try {
    const textResult = await parser.getText({ first: 50 });
    let images: Buffer[] = [];
    try {
      const screenshots = await parser.getScreenshot({
        first: 3,
        desiredWidth: 1200,
        imageBuffer: true,
        imageDataUrl: false,
      });
      images = screenshots.pages
        .map((page) => Buffer.from(page.data))
        .filter((image) => image.byteLength <= MAX_IMAGE_BYTES)
        .slice(0, MAX_IMAGES);
    } catch {
      // 텍스트 추출이 성공했다면 렌더러 미지원 PDF 때문에 전체 분석을 막지 않는다.
    }
    return {
      text: cleanText(textResult.text),
      images,
      note: `PDF ${String(textResult.total)}쪽 중 텍스트 최대 50쪽·미리보기 ${String(images.length)}쪽 추출`,
    };
  } finally {
    await parser.destroy();
  }
};

const extractFile = async (file: UploadTarget): Promise<ExtractedFile> => {
  const extension = path.extname(file.filename).toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension) || RASTER_IMAGE_MIME_TYPES.has(file.mimetype.toLowerCase())) {
    return file.buffer.byteLength <= MAX_IMAGE_BYTES
      ? { text: '', images: [file.buffer], note: '이미지를 비전 모델에 전달' }
      : { text: '', images: [], note: '이미지가 분석 크기 제한을 넘어 내용 분석 생략' };
  }
  if (extension === '.pdf' || file.mimetype === 'application/pdf') return pdfContent(file.buffer);
  if (extension === '.docx' || extension === '.pptx') return officeArchive(file.buffer, extension);
  if (extension === '.xlsx') return excelText(file.buffer);
  if (TEXT_EXTENSIONS.has(extension) || file.mimetype.startsWith('text/')) {
    return { text: cleanText(file.buffer.toString('utf8')), images: [], note: '텍스트 추출' };
  }
  return {
    text: '',
    images: [],
    note: '지원하지 않는 바이너리 형식 — 파일명·형식만 전달하고 내용을 추정하지 않음',
  };
};

export async function prepareAiAttachments(
  inputFiles: readonly UploadTarget[],
  options: PrepareAiAttachmentsOptions = {},
): Promise<PreparedAiAttachments> {
  const maxFiles = options.maxFiles ?? MAX_FILES;
  const files = inputFiles.slice(0, maxFiles);
  const warnings: string[] = [];
  if (inputFiles.length > maxFiles) warnings.push(`첨부 ${String(inputFiles.length - maxFiles)}개는 분석 개수 제한으로 생략`);
  const totalBytes = files.reduce((sum, file) => sum + file.buffer.byteLength, 0);
  if (totalBytes > MAX_TOTAL_FILE_BYTES) {
    warnings.push('첨부 합계가 50MB를 넘어 앞쪽 파일부터 제한 분석');
  }

  const sections: string[] = [];
  const images: string[] = [];
  const imageCandidates: ImageCandidate[] = [];
  const hashes: string[] = files.map((file) => hashAiBytes(file.buffer));
  let consumedBytes = 0;
  let consumedText = 0;
  let analyzedFiles = 0;
  for (const [index, file] of files.entries()) {
    const header = `[첨부 ${String(index + 1)}: ${file.filename} / ${file.mimetype || '형식 미상'} / ${String(file.buffer.byteLength)} bytes]`;
    if (consumedBytes + file.buffer.byteLength > MAX_TOTAL_FILE_BYTES) {
      sections.push(`${header}\n- 분석 상태: 전체 크기 제한으로 내용 생략`);
      continue;
    }
    consumedBytes += file.buffer.byteLength;
    try {
      const extracted = await extractFile(file);
      const remainingText = Math.max(0, MAX_TOTAL_TEXT - consumedText);
      const text = truncate(extracted.text, Math.min(MAX_TEXT_PER_FILE, remainingText));
      consumedText += text.length;
      const directImage = IMAGE_EXTENSIONS.has(path.extname(file.filename).toLowerCase()) ||
        RASTER_IMAGE_MIME_TYPES.has(file.mimetype.toLowerCase());
      imageCandidates.push(...extracted.images.map((image) => ({
        image,
        priority: directImage ? 0 : 1,
        sourceIndex: index,
      })));
      sections.push([
        header,
        `- 분석 상태: ${extracted.note}`,
        text === '' ? '- 추출 텍스트: 없음' : `- 추출 텍스트:\n${text}`,
      ].join('\n'));
      analyzedFiles += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 160) : '알 수 없는 오류';
      warnings.push(`${file.filename}: ${reason}`);
      sections.push(`${header}\n- 분석 상태: 추출 실패 — 내용을 추정하지 않음`);
    }
  }

  const warningSection = warnings.length === 0
    ? ''
    : `\n\n[첨부 분석 경고]\n${warnings.map((warning) => `- ${warning}`).join('\n')}`;
  images.push(...imageCandidates
    .sort((left, right) => left.priority - right.priority || left.sourceIndex - right.sourceIndex)
    .slice(0, MAX_IMAGES)
    .map((candidate) => candidate.image.toString('base64')));
  return {
    context: truncate(`${sections.join('\n\n')}${warningSection}`, MAX_TOTAL_TEXT + 10_000),
    images,
    hashes,
    analyzedFiles,
    warnings,
  };
}
