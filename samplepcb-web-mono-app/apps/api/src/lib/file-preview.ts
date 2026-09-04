import {
  FILE_PREVIEW_MAX_BYTES,
  FILE_PREVIEW_MAX_COLS,
  FILE_PREVIEW_MAX_ENTRIES,
  FILE_PREVIEW_MAX_ROWS,
  FILE_PREVIEW_MAX_SHEETS,
  FILE_PREVIEW_MAX_TEXT,
  fileViewKind,
  type FilePreviewDataType,
  type FilePreviewEntryType,
  type FilePreviewSheetType,
} from '@sp/api-contract';
import ExcelJS from 'exceljs';
import { unzipSync } from 'fflate';
import { officeArchive } from './ai/attachment-extractor';
import { excelJsCompatibleArchive } from './catalog-workbook-xlsx';

// 첨부 미리보기 생성기 — 도메인 중립(마켓·PCB·BOM 어디서든 부른다).
// 권한 판정은 호출측(도메인 라우트)의 몫이다. 여기 오는 시점엔 이미 볼 자격이 확인된 바이트다.
//
// 브라우저가 직접 그리는 종류(image·pdf·text)는 여기 오지 않는다 — 그건 다운로드 라우트의
// Blob 을 프런트가 그대로 쓰므로 원본과 100% 같고, 서버가 손댈 이유가 없다.

const empty = (
  fileId: number,
  name: string,
  size: number,
): Omit<FilePreviewDataType, 'kind' | 'note'> => ({
  fileId,
  name,
  size,
  reason: null,
  sheets: null,
  text: null,
  entries: null,
  truncated: false,
});

const unsupported = (
  fileId: number,
  name: string,
  size: number,
  reason: FilePreviewDataType['reason'],
): FilePreviewDataType => ({
  ...empty(fileId, name, size),
  kind: 'unsupported',
  reason,
  note: '',
});

// ── ZIP 목록 ────────────────────────────────────────────────────────────────
// 압축을 **풀지 않는다**. fflate 의 filter 는 각 엔트리 메타를 보여준 뒤 false 를 받으면
// 해제를 건너뛰므로, 거버 zip 200MB 짜리도 중앙 디렉터리만 훑고 끝난다.
const archiveEntries = (buffer: Buffer): { entries: FilePreviewEntryType[]; total: number } => {
  const entries: FilePreviewEntryType[] = [];
  let total = 0;
  unzipSync(new Uint8Array(buffer), {
    filter: (file) => {
      total += 1;
      // 디렉터리 엔트리(끝이 /)는 목록에서 잡음이다.
      if (!file.name.endsWith('/') && entries.length < FILE_PREVIEW_MAX_ENTRIES) {
        entries.push({ name: file.name, size: file.originalSize });
      }
      return false;
    },
  });
  return { entries, total };
};

// ── 스프레드시트 ────────────────────────────────────────────────────────────
// ExcelJS 는 read_only 개념이 없어 스타일시트를 통째로 읽는다. sp-engine 이 실측으로
// 남긴 함정(styles.xml 비대 = 시트당 ~3초, 시트 XML 비대 = 사실상 안 끝남)을 그대로
// 물려받으므로, 파싱 전에 zip 헤더만 보고 걸러낸다. 훑어보기 한 번에 분 단위를 쓸 수 없다.
const STYLES_BLOAT_BYTES = 2 * 1024 * 1024;
const SHEET_BLOAT_BYTES = 50 * 1024 * 1024;

const spreadsheetTooHeavy = (buffer: Buffer): boolean => {
  let heavy = false;
  try {
    unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        if (file.name === 'xl/styles.xml' && file.originalSize > STYLES_BLOAT_BYTES) heavy = true;
        if (
          file.name.startsWith('xl/worksheets/') &&
          file.name.endsWith('.xml') &&
          file.originalSize > SHEET_BLOAT_BYTES
        ) {
          heavy = true;
        }
        return false;
      },
    });
  } catch {
    // 헤더를 못 읽으면 판정을 포기하고 파싱에 맡긴다 — 손상 파일은 아래에서 FAILED 로 잡힌다.
    return false;
  }
  return heavy;
};

// ExcelJS 는 유효한 xlsx 를 꽤 자주 못 읽는다 — 핵심 태그에 x: prefix 를 쓰거나 표·도형
// 관계가 함께 든 파일(외부 도구·Python 계열 생성물)에서 workbook 파싱이 통째로 죽는다
// (실측: e2e 픽스처 bom-journey-14-multi-sheet.xlsx → "Cannot read properties of undefined").
// 카탈로그 로더가 같은 벽을 만나 만들어 둔 정화(셀 값만 남기고 재압축)를 재사용한다.
// 정화는 zip 재압축이라 공짜가 아니므로 **실패했을 때만** 태운다.
const loadWorkbook = async (buffer: Buffer): Promise<ExcelJS.Workbook> => {
  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    return workbook;
  } catch {
    // 실패한 인스턴스는 상태가 반쯤 채워져 있어 재사용하지 않는다.
    const retry = new ExcelJS.Workbook();
    await retry.xlsx.load(
      Buffer.from(excelJsCompatibleArchive(buffer)) as unknown as Parameters<
        typeof retry.xlsx.load
      >[0],
    );
    return retry;
  }
};

const sheetGrid = async (
  buffer: Buffer,
): Promise<{ sheets: FilePreviewSheetType[]; total: number; truncated: boolean }> => {
  const workbook = await loadWorkbook(buffer);
  const total = workbook.worksheets.length;
  let truncated = total > FILE_PREVIEW_MAX_SHEETS;
  const sheets: FilePreviewSheetType[] = [];
  for (const worksheet of workbook.worksheets.slice(0, FILE_PREVIEW_MAX_SHEETS)) {
    const rows: string[][] = [];
    // includeEmpty:false 로 훑되 행 안의 빈 셀은 자리를 지켜야 열이 안 밀린다 —
    // eachCell 은 빈 셀을 건너뛰므로 colNumber 로 직접 채운다.
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= FILE_PREVIEW_MAX_ROWS) return;
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (colNumber > FILE_PREVIEW_MAX_COLS) return;
        while (cells.length < colNumber - 1) cells.push('');
        // 병합 셀은 ExcelJS 가 범위의 **모든** 셀에 같은 값을 채워 돌려준다. 그대로 그리면
        // 제목 한 줄이 열마다 반복돼(실측: "Journey 14 · Main BOM" ×3) 표가 안 읽힌다.
        // 좌상단(master)만 남기고 종속 셀은 비운다 — 원본 병합의 시각적 효과에 가깝다.
        const merged = cell.isMerged && cell.master !== cell;
        cells.push(merged ? '' : cell.text.trim());
      });
      if (cells.some((cell) => cell !== '')) rows.push(cells);
    });
    // 잘림 판정은 콜백 안 플래그가 아니라 시트 메타로 한다 — 원본이 얼마였는지가 근거고,
    // "딱 상한과 같은 크기"를 잘렸다고 오해하지 않는다.
    const sheetTruncated =
      worksheet.actualRowCount > FILE_PREVIEW_MAX_ROWS ||
      worksheet.actualColumnCount > FILE_PREVIEW_MAX_COLS;
    if (sheetTruncated) truncated = true;
    sheets.push({ name: worksheet.name, rows, truncated: sheetTruncated });
  }
  return { sheets, total, truncated };
};

/**
 * 첨부 하나의 미리보기를 만든다. 실패는 던지지 않고 unsupported(FAILED) 로 돌려준다 —
 * 곁가지 기능이 500 을 내면 첨부 목록 화면 전체가 흔들린다.
 */
export const buildFilePreview = async (
  fileId: number,
  name: string,
  buffer: Buffer,
): Promise<FilePreviewDataType> => {
  const size = buffer.byteLength;
  const kind = fileViewKind(name);
  if (kind !== 'sheet' && kind !== 'doc' && kind !== 'archive') {
    return unsupported(fileId, name, size, 'FORMAT');
  }
  if (size > FILE_PREVIEW_MAX_BYTES) {
    return unsupported(fileId, name, size, 'TOO_LARGE');
  }

  try {
    if (kind === 'archive') {
      const { entries, total } = archiveEntries(buffer);
      return {
        ...empty(fileId, name, size),
        kind: 'archive',
        entries,
        truncated: entries.length < total,
        note: `압축 파일 ${String(total)}개${entries.length < total ? ` 중 앞 ${String(entries.length)}개` : ''}`,
      };
    }

    if (kind === 'sheet') {
      if (spreadsheetTooHeavy(buffer)) return unsupported(fileId, name, size, 'TOO_LARGE');
      const { sheets, total, truncated } = await sheetGrid(buffer);
      const shown = sheets.length;
      return {
        ...empty(fileId, name, size),
        kind: 'sheet',
        sheets,
        truncated,
        note: `${String(total)}개 시트${shown < total ? ` 중 앞 ${String(shown)}개` : ''}${truncated ? ` · 시트당 최대 ${String(FILE_PREVIEW_MAX_ROWS)}행` : ''}`,
      };
    }

    // doc(docx) — AI 전처리와 같은 추출을 쓴다(officeArchive). 서식은 사라지고 텍스트만 남는다.
    const extracted = officeArchive(buffer, '.docx');
    const full = extracted.text;
    const truncated = full.length > FILE_PREVIEW_MAX_TEXT;
    return {
      ...empty(fileId, name, size),
      kind: 'doc',
      text: truncated ? full.slice(0, FILE_PREVIEW_MAX_TEXT) : full,
      truncated,
      note: full === '' ? '문서에서 읽을 텍스트를 찾지 못했습니다' : '서식 없이 텍스트만 표시합니다',
    };
  } catch {
    return unsupported(fileId, name, size, 'FAILED');
  }
};
