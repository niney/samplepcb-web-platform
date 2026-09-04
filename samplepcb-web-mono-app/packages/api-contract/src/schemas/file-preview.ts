import { z } from 'zod';

// 첨부 미리보기 — 다운로드하지 않고 화면에서 내용을 확인하는 공용 계약.
//
// 도메인 중립이다(마켓 의뢰 첨부·PCB EQ·BOM 선적 어디든 붙는다). 도메인별로 다른 것은
// **라우트와 권한 게이트**뿐이고, "무엇을 보여줄 수 있는가"의 판정과 응답 모양은 이 파일
// 하나가 정본이다. 새 도메인에 붙일 때 라우트만 추가하고 이 스키마를 재사용할 것.
//
// 미리보기의 목적은 **다운로드할 가치가 있는지 판단**이지 정독이 아니다. 그래서 서식 재현이
// 아니라 내용 확인에 필요한 최소치만 담는다 — 정독은 다운로드가 정답이고 그 버튼은 남는다.

// ── 무엇을 어떻게 보여주는가 ────────────────────────────────────────────────
// image|pdf|text = 원본 바이트를 브라우저가 직접 그린다. 서버는 판정만 하고 미리보기 응답을
//                  만들지 않는다 — 기존 다운로드 라우트의 Blob 을 그대로 재사용하므로
//                  **원본과 100% 동일**하고 서버 부하가 없다.
// sheet|doc|archive = 브라우저가 못 그려서 서버가 구조화해 준다(FilePreview 응답).
// none = 미리보기를 만들 수 없다 — 다운로드만 제공한다.
export const FILE_VIEW_KINDS = ['image', 'pdf', 'text', 'sheet', 'doc', 'archive', 'none'] as const;
export const FileViewKind = z.enum(FILE_VIEW_KINDS);
export type FileViewKindType = z.infer<typeof FileViewKind>;

// 서버가 구조화해 주는 종류만 — image|pdf|text 는 이 응답을 거치지 않는다.
export const FilePreviewKind = z.enum(['sheet', 'doc', 'archive', 'unsupported']);
export type FilePreviewKindType = z.infer<typeof FilePreviewKind>;

// ⚠ 확장자 표기는 전부 점 없는 소문자다(`extname().slice(1)` 과 맞춘다).
//
// SVG 를 image 에 넣은 것은 의도다 — `<img>` 컨텍스트에서는 SVG 안의 스크립트가 실행되지
// 않는다. 다만 blob: URL 은 **생성한 문서의 origin 을 상속**하므로 iframe/object 로 그리면
// 앱 origin 에서 스크립트가 돌아 토큰이 샌다. SVG 는 반드시 `<img>` 로만 그릴 것.
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'svg']);

// html/htm 이 text 인 것도 의도다 — 렌더하면 같은 origin 상속 문제가 생기므로 **소스만** 보여준다.
// 거버(gbr/ger/drl/xln)·넷리스트·KiCad 원본은 실제로 텍스트라 그대로 읽힌다.
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'yaml', 'yml',
  'ini', 'conf', 'log', 'sql', 'html', 'htm', 'css', 'js', 'jsx', 'ts', 'tsx',
  'vue', 'py', 'php', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'sh',
  'ps1', 'bat', 'gbr', 'ger', 'drl', 'xln', 'bom', 'net', 'kicad_pcb', 'kicad_sch',
]);

// 구형(xls·doc·ppt)이 빠져 있는 것은 능력이 아니라 **경계**다. 구형 판독은 LibreOffice 로
// 신형 정규화(xls→xlsx, doc→docx)를 태우는 별도 결정에 속한다 — 그때 이 집합에 더하면
// 뒤쪽 파이프라인은 그대로 재사용된다. 그전까지 구형은 none(다운로드 폴백)이다.
const SHEET_EXTS = new Set(['xlsx', 'xlsm']);
const DOC_EXTS = new Set(['docx']);
const ARCHIVE_EXTS = new Set(['zip']);

export const fileExtension = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
};

/**
 * 파일명만으로 미리보기 방식을 정한다 — 프런트(버튼 노출·렌더 분기)와 서버(응답 생성 분기)가
 * **같은 함수**를 쓴다. 둘이 갈리면 "보기 버튼은 있는데 열면 미지원"이 된다.
 */
export const fileViewKind = (name: string): FileViewKindType => {
  const ext = fileExtension(name);
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXTS.has(ext)) return 'text';
  if (SHEET_EXTS.has(ext)) return 'sheet';
  if (DOC_EXTS.has(ext)) return 'doc';
  if (ARCHIVE_EXTS.has(ext)) return 'archive';
  return 'none';
};

/** 서버 구조화가 필요한 종류(= /preview 라우트를 불러야 하는 종류). */
export const needsServerPreview = (kind: FileViewKindType): boolean =>
  kind === 'sheet' || kind === 'doc' || kind === 'archive';

// ── Content-Type 보정 ───────────────────────────────────────────────────────
// 파일서버가 content-type 을 안 주면 octet-stream 으로 오는데(file-server.ts 의 주석이
// "호출측에서 보정한다"고 예고), 그 상태로는 Blob 의 type 이 비어 `<img>`·PDF 뷰어가 뜨지
// 않는다. 다운로드만 하던 시절에는 드러나지 않던 결함이다.
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf',
  zip: 'application/zip',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xls: 'application/vnd.ms-excel',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json',
  xml: 'application/xml', html: 'text/html', htm: 'text/html', md: 'text/markdown',
};

/**
 * 확장자로 MIME 을 보정한다. 파일서버가 제대로 준 값이 있으면 그걸 존중하고,
 * octet-stream(= 모른다는 뜻)일 때만 우리가 안다면 덮어쓴다.
 *
 * ⚠ html/htm 은 여기서 text/html 로 나오지만 **렌더 대상이 아니다**(fileViewKind 가 text).
 *   MIME 은 다운로드 시 파일 연결용이고, 화면 표시 방식은 fileViewKind 가 정한다.
 */
export const resolveFileMime = (name: string, serverContentType: string): string => {
  const known = MIME_BY_EXT[fileExtension(name)];
  if (known === undefined) return serverContentType;
  const trusted = serverContentType !== '' &&
    serverContentType !== 'application/octet-stream' &&
    serverContentType !== 'binary/octet-stream';
  return trusted ? serverContentType : known;
};

// ── 구분자 텍스트(CSV·TSV) ─────────────────────────────────────────────────
// CSV 는 text 로 분류되어 브라우저가 원본 바이트로 읽지만, 화면에는 표로 그리는 게 낫다.
// 파서를 계약에 두는 이유는 순수 함수라서 테스트가 가능하고, 서버가 나중에 같은 표를 만들
// 일이 생겨도 두 벌이 되지 않기 때문이다.

/** 구분자 텍스트를 표로 — 따옴표 안의 구분자·줄바꿈과 이스케이프("")를 지킨다. */
export const parseDelimited = (text: string, delimiter: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    // charAt 인 이유: 인덱스 접근은 string | undefined 라 이어붙이기에서 걸린다.
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
};

/** 표로 그릴 구분자 — 아니면 null(그냥 텍스트로 보여준다). */
export const delimiterFor = (name: string): string | null => {
  const ext = fileExtension(name);
  if (ext === 'csv') return ',';
  if (ext === 'tsv') return '\t';
  return null;
};

// ── 응답 ────────────────────────────────────────────────────────────────────
// 판별 유니온 대신 **평평한 객체 + nullable** 이다. Fastify 응답 직렬화가 anyOf 에서
// 까다롭게 굴어 온 전례가 있어(이관 specJson 500), 미리보기처럼 곁가지 기능에서
// 직렬화로 500 을 내는 위험을 지지 않는다.

export const FilePreviewSheet = z.object({
  name: z.string(),
  // 원본 그리드 그대로(헤더 추정 없음) — 셀은 표시 문자열로 평탄화한다.
  rows: z.array(z.array(z.string())),
  truncated: z.boolean(), // 행·열 상한에 걸려 잘렸는가
});
export type FilePreviewSheetType = z.infer<typeof FilePreviewSheet>;

export const FilePreviewEntry = z.object({
  name: z.string(),
  size: z.number(), // 압축 해제 크기(bytes)
});
export type FilePreviewEntryType = z.infer<typeof FilePreviewEntry>;

// unsupported 사유 — 화면 문구가 갈린다.
//   FORMAT     : 이 형식은 미리보기를 만들 수 없다(구형 오피스·hwp·dwg 등)
//   TOO_LARGE  : 형식은 되는데 파일이 상한을 넘었다
//   FAILED     : 파싱을 시도했으나 실패했다(손상·암호·비표준)
export const FilePreviewReason = z.enum(['FORMAT', 'TOO_LARGE', 'FAILED']);
export type FilePreviewReasonType = z.infer<typeof FilePreviewReason>;

export const FilePreviewData = z.object({
  fileId: z.number(),
  name: z.string(),
  size: z.number(),
  kind: FilePreviewKind,
  reason: FilePreviewReason.nullable(), // kind='unsupported' 일 때만
  sheets: z.array(FilePreviewSheet).nullable(), // kind='sheet'
  text: z.string().nullable(), // kind='doc'
  entries: z.array(FilePreviewEntry).nullable(), // kind='archive'
  truncated: z.boolean(), // 상한에 걸려 내용이 잘렸는가(전체 기준)
  note: z.string(), // "3개 시트 · 앞 500행" 같은 화면 안내(빈 문자열 가능)
});
export type FilePreviewDataType = z.infer<typeof FilePreviewData>;

export const FilePreviewResponse = z.object({
  result: z.literal(true),
  data: FilePreviewData,
});
export type FilePreviewResponseType = z.infer<typeof FilePreviewResponse>;

// ── 상한 ────────────────────────────────────────────────────────────────────
// 업로드는 100MB 까지 열려 있는데 미리보기는 파일 전체를 메모리로 받는다. 훑어보기 용도에
// 100MB 를 태울 이유가 없으므로 여기서 끊고 다운로드로 보낸다.
export const FILE_PREVIEW_MAX_BYTES = 30 * 1024 * 1024;
// 시트는 화면에 그릴 수 있는 만큼만 — 원본이 12,176행 × 16,384열인 실측 사례가 있다.
export const FILE_PREVIEW_MAX_SHEETS = 12;
export const FILE_PREVIEW_MAX_ROWS = 500;
export const FILE_PREVIEW_MAX_COLS = 40;
// 문서 텍스트 상한. AI 전처리(20,000자)와 별개다 — 저쪽은 모델 컨텍스트 예산이 이유고
// 여기는 화면 렌더 비용이 이유라, 같이 움직일 근거가 없다.
export const FILE_PREVIEW_MAX_TEXT = 50_000;
export const FILE_PREVIEW_MAX_ENTRIES = 300;
