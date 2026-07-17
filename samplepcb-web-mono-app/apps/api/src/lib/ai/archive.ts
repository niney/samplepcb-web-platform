import path from 'node:path';
import { unzipSync } from 'fflate';
import type { UploadTarget } from '../file-server';

const MAX_ARCHIVE_DEPTH = 6;
const MAX_FILES = 300;
const MAX_TOTAL_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const ZIP_EXTENSIONS = new Set(['.zip', '.jar']);

export interface ExpandedAiFile extends UploadTarget {
  displayPath: string;
  extracted: boolean;
}

export interface ArchiveExpansion {
  files: ExpandedAiFile[];
  warnings: string[];
}

const normalizedPath = (value: string): string | null => {
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.length === 0 || parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  return parts.join('/');
};

// ZIP 일반 플래그 없이 CP949/EUC-KR 이름을 기록한 국내 설계 툴 자료가 있다. fflate은 이
// 경우 바이트를 latin-1처럼 보이는 문자열로 내보내므로, 한글로 복원되는 경우에만 바꾼다.
// UTF-8 이름과 실제 latin-1 이름은 그대로 보존한다.
export const decodeLegacyKoreanZipName = (value: string): string => {
  if (!/[\u0080-\u00ff]/.test(value) || /[\uac00-\ud7a3]/.test(value)) return value;
  const bytes = Buffer.from(value, 'latin1');
  const decoded = new TextDecoder('euc-kr').decode(bytes);
  return /[\uac00-\ud7a3]/.test(decoded) && !decoded.includes('\ufffd') ? decoded : value;
};

const isZip = (file: UploadTarget): boolean =>
  ZIP_EXTENSIONS.has(path.extname(file.filename).toLowerCase()) ||
  file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed';

// ZIP은 디스크에 쓰지 않고 메모리에서만 재귀 해제한다. 한계는 ZIP bomb·과도한 LLM
// 컨텍스트를 막기 위한 전역 예산이며, 초과 항목은 전체 분석을 실패시키지 않고 경고로 남긴다.
export function expandAiArchives(input: readonly UploadTarget[]): ArchiveExpansion {
  const files: ExpandedAiFile[] = [];
  const warnings: string[] = [];
  let expandedBytes = 0;

  const append = (file: UploadTarget, displayPath: string, extracted: boolean): boolean => {
    if (files.length >= MAX_FILES) {
      warnings.push(`파일 ${displayPath}: 최대 ${String(MAX_FILES)}개 제한으로 생략`);
      return false;
    }
    if (file.buffer.byteLength > MAX_FILE_BYTES) {
      warnings.push(`파일 ${displayPath}: 파일당 16MB 제한으로 내용 분석 생략`);
      return true;
    }
    if (expandedBytes + file.buffer.byteLength > MAX_TOTAL_EXPANDED_BYTES) {
      warnings.push(`파일 ${displayPath}: 압축 해제 총량 100MB 제한으로 내용 분석 생략`);
      return true;
    }
    expandedBytes += file.buffer.byteLength;
    files.push({ ...file, displayPath, extracted });
    return true;
  };

  const visit = (file: UploadTarget, displayPath: string, depth: number): void => {
    if (!isZip(file)) {
      append(file, displayPath, true);
      return;
    }
    if (depth >= MAX_ARCHIVE_DEPTH) {
      warnings.push(`압축 파일 ${displayPath}: 최대 재귀 깊이 ${String(MAX_ARCHIVE_DEPTH)}에 도달해 생략`);
      return;
    }
    try {
      let declaredBytes = 0;
      const entries = unzipSync(new Uint8Array(file.buffer), {
        filter: (entry) => {
          const safe = normalizedPath(entry.name);
          if (safe === null || safe.startsWith('__MACOSX/')) return false;
          if (entry.originalSize > MAX_FILE_BYTES) {
            warnings.push(`압축 항목 ${displayPath}/${safe}: 파일당 16MB 제한으로 생략`);
            return false;
          }
          // fflate이 노출하는 메타데이터는 원본 크기까지라 항목별 압축비를 신뢰성 있게
          // 계산할 수 없다. 대신 전체 해제 총량·항목 크기로 폭발을 제한한다.
          declaredBytes += entry.originalSize;
          if (expandedBytes + declaredBytes > MAX_TOTAL_EXPANDED_BYTES) {
            warnings.push(`압축 파일 ${displayPath}: 압축 해제 총량 100MB 제한으로 이후 항목 생략`);
            return false;
          }
          return true;
        },
      });
      const names = Object.keys(entries).sort();
      if (names.length === 0) warnings.push(`압축 파일 ${displayPath}: 분석 가능한 항목이 없습니다`);
      for (const name of names) {
        const data = entries[name];
        const rawSafe = normalizedPath(name);
        if (data === undefined || rawSafe === null) continue;
        const safe = decodeLegacyKoreanZipName(rawSafe);
        const nested: UploadTarget = {
          filename: safe,
          mimetype: '',
          buffer: Buffer.from(data),
        };
        visit(nested, `${displayPath}/${safe}`, depth + 1);
      }
    } catch {
      warnings.push(`압축 파일 ${displayPath}: 해제에 실패해 내용 분석을 생략`);
    }
  };

  for (const file of input) visit(file, file.filename, 0);
  return { files, warnings };
}
