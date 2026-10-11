// PCB EQ 엑셀 추출기(D20 P2) — .xls(BIFF8)·.xlsx·.zip(안의 첫 통합문서) → 시트 셀 텍스트·병합·그림.
// 정본 docs/PCB_EQ_AI_PROBE.md. 셀은 SheetJS 0.20.3(CDN tarball — npm 0.18.5 는 CVE 두 건이라 금지),
// 그림은 xls=cfb+OfficeArt 직접 파싱(biff-images.ts), xlsx=DrawingML 직접 파싱(xlsx-images.ts).
// 실패는 throw 하지 않는다 — 암호·손상·미지원은 warnings 에 쌓고 빈(또는 부분) 결과를 돌려준다.
// 동기 함수다(입력 상한 20MB 기준 수십 ms — 실샘플 .xls 20ms 실측). 큰 파일을 루프에서 돌릴 거면 워커로 옮길 것.
import CFB from 'cfb';
import { unzipSync } from 'fflate';
import * as XLSX from 'xlsx';
import * as cptable from 'xlsx/dist/cpexcel';
import type { CellObject, WorkBook } from 'xlsx';
import { extractBiffPictures } from './biff-images';
import {
  extOfPath,
  readDrawingPictures,
  readRichValueImages,
  readSheetParts,
  readVmCells,
  readWpsCellImages,
  type ZipFiles,
} from './xlsx-images';
import { EQ_EXTRACT_LIMITS, type EqCellAnchor, type EqExtract, type EqImage, type EqImageExt, type EqMerge, type EqSheet } from './types';

// BIFF5 이전·ANSI 코드페이지(중국어 GBK 등) .xls 의 문자열 해독용 — BIFF8 유니코드에는 필요 없다.
XLSX.set_cptable(cptable);

interface RawPicture {
  sheetName: string;
  anchor: EqCellAnchor | null;
  ext: EqImageExt;
  data: Buffer;
}

const CFB_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, 200);

// ── 셀 텍스트 ──────────────────────────────────────────────────────────────

// 숫자 서식이 날짜인가 — 따옴표 문자열·이스케이프·[$-409]/[Red] 같은 괄호를 걷어 내고 y·d·(h/s 없는)m 을 본다.
export function isDateFormat(z: string): boolean {
  const s = z
    .replace(/"[^"]*"/g, '')
    .replace(/\\./g, '')
    .replace(/\[[^\]]*\]/g, '')
    .split(';')[0]
    ?.trim() ?? '';
  if (s === '' || /^general$/i.test(s) || s === '@') return false;
  return /[yd]/i.test(s) || (/m/i.test(s) && !/[hs]/i.test(s));
}

// 엑셀 일련값 → YYYY-MM-DD(UTC 산술 — 서버 시간대와 무관). 1900 체계는 1899-12-30 기준(윤년 버그 포함).
export function excelSerialToYmd(serial: number, date1904: boolean): string {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const d = new Date(base + Math.floor(serial) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function cellText(cell: CellObject | undefined, date1904: boolean): string {
  if (cell === undefined || cell.t === 'z') return '';
  const v = cell.v;
  if (cell.t === 'n' && typeof v === 'number' && cell.z !== undefined && isDateFormat(String(cell.z)) && v > 0 && v < 2_958_466) {
    return excelSerialToYmd(v, date1904);
  }
  if (cell.t === 'd' && v instanceof Date) return v.toISOString().slice(0, 10);
  if (cell.t === 's' && typeof v === 'string') return v;
  if (cell.w !== undefined) return cell.w.trim();
  if (v === undefined) return '';
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
}

interface DispimgCell {
  name: string;
  anchor: EqCellAnchor;
}

const DISPIMG_RE = /DISPIMG\(\s*"([^"]+)"/i;

function readWorkbookCells(wb: WorkBook, warnings: string[]): { sheets: EqSheet[]; dispimg: Map<string, DispimgCell[]> } {
  const date1904 = wb.Workbook?.WBProps?.date1904 === true;
  const sheets: EqSheet[] = [];
  const dispimg = new Map<string, DispimgCell[]>();
  const names = wb.SheetNames.slice(0, EQ_EXTRACT_LIMITS.maxSheets);
  if (wb.SheetNames.length > names.length) {
    warnings.push(`시트 ${String(wb.SheetNames.length)}개 중 앞 ${String(names.length)}개만 읽었습니다`);
  }
  for (const name of names) {
    const ws = wb.Sheets[name];
    const data = ws?.['!data'];
    const rows: string[][] = [];
    const merges: EqMerge[] = [];
    if (ws !== undefined && data !== undefined) {
      const fullRef: unknown = ws['!fullref'];
      if (typeof fullRef === 'string' && fullRef !== ws['!ref']) {
        warnings.push(`시트 "${name}" 은 ${String(EQ_EXTRACT_LIMITS.maxRows)}행까지만 읽었습니다`);
      }
      let colClipped = false;
      const rowCount = Math.min(data.length, EQ_EXTRACT_LIMITS.maxRows);
      for (let r = 0; r < rowCount; r += 1) {
        const src = data[r] ?? [];
        if (src.length > EQ_EXTRACT_LIMITS.maxCols) colClipped = true;
        const row: string[] = [];
        const colCount = Math.min(src.length, EQ_EXTRACT_LIMITS.maxCols);
        for (let c = 0; c < colCount; c += 1) {
          const cell = src[c];
          const f = cell?.f;
          const img = f === undefined ? null : DISPIMG_RE.exec(f);
          if (img?.[1] !== undefined) {
            const list = dispimg.get(name) ?? [];
            list.push({ name: img[1], anchor: { row: r, col: c } });
            dispimg.set(name, list);
            row.push('');
            continue;
          }
          row.push(cellText(cell, date1904));
        }
        while (row.length > 0 && row[row.length - 1] === '') row.pop();
        rows.push(row);
      }
      while (rows.length > 0 && rows[rows.length - 1]?.length === 0) rows.pop();
      if (colClipped) warnings.push(`시트 "${name}" 은 ${String(EQ_EXTRACT_LIMITS.maxCols)}열까지만 읽었습니다`);
      for (const m of ws['!merges'] ?? []) {
        if (m.s.r >= EQ_EXTRACT_LIMITS.maxRows || m.s.c >= EQ_EXTRACT_LIMITS.maxCols) continue;
        merges.push({ s: { row: m.s.r, col: m.s.c }, e: { row: m.e.r, col: m.e.c } });
      }
    }
    sheets.push({ name, rows, merges });
  }
  return { sheets, dispimg };
}

const readOpts: XLSX.ParsingOptions = {
  type: 'buffer',
  dense: true,
  cellNF: true,
  cellFormula: true,
  cellHTML: false,
  cellStyles: false,
  sheetRows: EQ_EXTRACT_LIMITS.maxRows,
};

// ── 형식별 ─────────────────────────────────────────────────────────────────

function extractCfb(buf: Buffer, out: EqExtract): void {
  const container = CFB.read(buf, { type: 'buffer' });
  if (CFB.find(container, 'EncryptionInfo') !== null || CFB.find(container, 'EncryptedPackage') !== null) {
    out.format = 'xlsx';
    out.problem = 'encrypted';
    out.warnings.push('암호가 걸린 통합문서라 읽지 못했습니다(공장에 암호 없는 파일을 요청)');
    return;
  }
  const stream = CFB.find(container, 'Workbook') ?? CFB.find(container, 'Book');
  if (stream === null) {
    out.problem = 'no_workbook';
    out.warnings.push('Office 복합 문서이지만 엑셀 통합문서 스트림이 없습니다(워드·한글 파일?)');
    return;
  }
  out.format = 'xls';
  const pics = extractBiffPictures(
    Buffer.from(stream.content),
    EQ_EXTRACT_LIMITS.maxImages,
    EQ_EXTRACT_LIMITS.maxImageBytes,
  );
  if (pics.encrypted) {
    out.problem = 'encrypted';
    out.warnings.push('암호가 걸린 .xls 라 읽지 못했습니다(공장에 암호 없는 파일을 요청)');
    return;
  }
  out.warnings.push(...pics.warnings);
  let wb: WorkBook;
  try {
    wb = XLSX.read(buf, readOpts);
  } catch (err) {
    out.problem = 'unreadable';
    out.warnings.push(`셀을 읽지 못했습니다: ${errText(err)}`);
    return;
  }
  const { sheets } = readWorkbookCells(wb, out.warnings);
  out.sheets = sheets;
  out.images = numberImages(pics.pictures, sheets);
}

function safeUnzip(u8: Uint8Array, keep: (name: string) => boolean, warnings: string[]): ZipFiles {
  let total = 0;
  const state = { overflow: false };
  const files = unzipSync(u8, {
    filter: (f) => {
      if (!keep(f.name)) return false;
      if (f.originalSize > EQ_EXTRACT_LIMITS.maxInnerBytes || total + f.originalSize > EQ_EXTRACT_LIMITS.maxInnerBytes) {
        state.overflow = true;
        return false;
      }
      total += f.originalSize;
      return true;
    },
  });
  if (state.overflow) warnings.push('압축 해제 크기 상한을 넘는 항목을 건너뛰었습니다');
  return files;
}

const listZip = (u8: Uint8Array): string[] => {
  const names: string[] = [];
  unzipSync(u8, {
    filter: (f) => {
      names.push(f.name);
      return false;
    },
  });
  return names;
};

function extractXlsx(buf: Buffer, out: EqExtract): void {
  out.format = 'xlsx';
  const files = safeUnzip(new Uint8Array(buf), (n) => !n.endsWith('/'), out.warnings);
  let wb: WorkBook;
  try {
    wb = XLSX.read(buf, readOpts);
  } catch (err) {
    out.problem = 'unreadable';
    out.warnings.push(`셀을 읽지 못했습니다: ${errText(err)}`);
    return;
  }
  const { sheets, dispimg } = readWorkbookCells(wb, out.warnings);
  out.sheets = sheets;
  const pictures: RawPicture[] = [];
  const pushMedia = (sheetName: string, anchor: EqCellAnchor | null, path: string): void => {
    const data = files[path];
    if (data === undefined) return;
    if (data.length > EQ_EXTRACT_LIMITS.maxImageBytes) {
      out.warnings.push(`그림 ${path} 가 크기 상한을 넘어 버렸습니다`);
      return;
    }
    pictures.push({ sheetName, anchor, ext: extOfPath(path), data: Buffer.from(data) });
  };
  const wps = readWpsCellImages(files);
  const rich = readRichValueImages(files);
  const sheetNames = new Set(sheets.map((s) => s.name));
  for (const part of readSheetParts(files)) {
    if (!sheetNames.has(part.name)) continue;
    for (const p of readDrawingPictures(files, part)) pushMedia(part.name, p.anchor, p.path);
    for (const cell of dispimg.get(part.name) ?? []) {
      const media = wps.get(cell.name);
      if (media === undefined) out.warnings.push(`셀 그림 ${cell.name} 의 원본을 찾지 못했습니다`);
      else pushMedia(part.name, cell.anchor, media);
    }
    if (rich.size > 0) {
      for (const cell of readVmCells(files, part)) {
        const media = rich.get(cell.vm);
        if (media !== undefined) pushMedia(part.name, cell.anchor, media);
      }
    }
  }
  if (pictures.length > EQ_EXTRACT_LIMITS.maxImages) {
    out.warnings.push(
      `그림 ${String(pictures.length - EQ_EXTRACT_LIMITS.maxImages)}장이 개수 상한(${String(EQ_EXTRACT_LIMITS.maxImages)})을 넘어 버려졌습니다`,
    );
  }
  out.images = numberImages(pictures.slice(0, EQ_EXTRACT_LIMITS.maxImages), sheets);
}

// 시트 순서 → 앵커(행·열) 순서로 정렬해 img-1… 을 붙인다(위치 없는 그림은 시트 끝). 형식이 달라도
// 같은 배치면 같은 id 가 나오게 — LLM 자리표시와 골드(정답) 비교가 이 순서를 믿는다.
function numberImages(pictures: RawPicture[], sheets: EqSheet[]): EqImage[] {
  const order = new Map(sheets.map((s, i) => [s.name, i]));
  const key = (p: RawPicture): [number, number, number] => [
    order.get(p.sheetName) ?? Number.MAX_SAFE_INTEGER,
    p.anchor?.row ?? Number.MAX_SAFE_INTEGER,
    p.anchor?.col ?? Number.MAX_SAFE_INTEGER,
  ];
  return pictures
    .map((p, i) => ({ p, i, k: key(p) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i)
    .map(({ p }, n) => ({ id: `img-${String(n + 1)}`, sheetName: p.sheetName, anchor: p.anchor, ext: p.ext, data: p.data }));
}

const WORKBOOK_EXT_RE = /\.(xlsx|xlsm|xls)$/i;

// ── 진입점 ─────────────────────────────────────────────────────────────────

/** EQ 통합문서 하나(.xls/.xlsx/.zip)를 셀·병합·그림으로. throw 하지 않는다. */
export function extractEqWorkbook(buf: Buffer, fileName: string): EqExtract {
  const out: EqExtract = { fileName, innerName: null, format: null, problem: null, sheets: [], images: [], warnings: [] };
  if (buf.length > EQ_EXTRACT_LIMITS.maxInputBytes) {
    out.problem = 'too_large';
    out.warnings.push(`파일이 ${String(EQ_EXTRACT_LIMITS.maxInputBytes / 1024 / 1024)}MB 를 넘어 읽지 않았습니다`);
    return out;
  }
  if (buf.length < 8) {
    out.problem = 'unreadable';
    out.warnings.push('빈 파일이거나 너무 작습니다');
    return out;
  }
  try {
    if (buf.subarray(0, 8).equals(CFB_MAGIC)) {
      extractCfb(buf, out);
      return out;
    }
    if (buf.subarray(0, 4).equals(ZIP_MAGIC)) {
      const names = listZip(new Uint8Array(buf));
      if (names.includes('xl/workbook.xml') || names.includes('[Content_Types].xml')) {
        extractXlsx(buf, out);
        return out;
      }
      // 포털 첨부 zip — 안의 첫 통합문서(macOS 메타 폴더 제외). 중첩 zip 은 따라가지 않는다.
      const candidates = names.filter((n) => WORKBOOK_EXT_RE.test(n) && !n.startsWith('__MACOSX/') && !/(^|\/)~\$/.test(n));
      const inner = candidates[0];
      if (inner === undefined) {
        out.problem = 'no_workbook';
        out.warnings.push('zip 안에 엑셀 통합문서(.xls/.xlsx)가 없습니다');
        return out;
      }
      if (candidates.length > 1) out.warnings.push(`zip 안 통합문서 ${String(candidates.length)}개 중 첫 번째(${inner})만 읽었습니다`);
      const innerFiles = safeUnzip(new Uint8Array(buf), (n) => n === inner, out.warnings);
      const innerData = innerFiles[inner];
      if (innerData === undefined) return out;
      out.innerName = inner;
      const innerBuf = Buffer.from(innerData);
      if (innerBuf.subarray(0, 8).equals(CFB_MAGIC)) extractCfb(innerBuf, out);
      else if (innerBuf.subarray(0, 4).equals(ZIP_MAGIC)) extractXlsx(innerBuf, out);
      else {
        out.problem = 'no_workbook';
        out.warnings.push(`zip 안 ${inner} 는 엑셀 형식이 아닙니다`);
      }
      return out;
    }
    // 그 밖(HTML·CSV 로 내보낸 '가짜 xls' 등) — 텍스트로 보일 때만 SheetJS 에 맡긴다(PDF·그림을
    // 넣으면 SheetJS 는 쓰레기 셀을 만든다).
    if (buf.subarray(0, 512).includes(0)) {
      out.problem = 'no_workbook';
      out.warnings.push('엑셀(.xls/.xlsx/.zip)이 아닌 바이너리 파일이라 읽지 않았습니다');
      return out;
    }
    out.format = 'other';
    out.warnings.push('엑셀 바이너리가 아닌 파일(HTML/CSV 추정) — 셀만 읽고 그림은 없습니다');
    const wb = XLSX.read(buf, readOpts);
    out.sheets = readWorkbookCells(wb, out.warnings).sheets;
    return out;
  } catch (err) {
    out.problem = 'unreadable';
    out.warnings.push(`읽기 실패: ${errText(err)}`);
    out.sheets = [];
    out.images = [];
    return out;
  }
}
