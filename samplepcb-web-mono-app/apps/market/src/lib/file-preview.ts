import {
  FILE_PREVIEW_MAX_BYTES,
  FilePreviewResponse,
  apiRoutes,
  delimiterFor,
  fileViewKind,
  needsServerPreview,
  parseDelimited,
  type FilePreviewDataType,
  type FileViewKindType,
} from '@sp/api-contract';
import { apiGet, apiGetBlob } from '@sp/shared';

// 첨부 미리보기 클라이언트 — 다운로드하지 않고 화면에서 내용을 확인한다.
//
// 두 갈래다:
//   image|pdf|text → 다운로드 라우트의 **원본 Blob** 을 그대로 그린다(무손실, 서버 부하 0)
//   sheet|doc|archive → 서버가 구조화한 /preview 응답
// 판정은 계약의 fileViewKind 하나를 서버와 공유한다.

export interface PreviewTarget {
  fileId: number;
  name: string;
  size: number;
}

/**
 * '보기' 버튼을 띄울지 — 형식이 되고 크기가 상한 안일 때만.
 * 상한을 프런트에서도 보는 이유: image·pdf·text 는 서버를 안 거치므로 서버 상한이 안 걸린다.
 * 100MB 이미지를 Blob 으로 받으면 탭이 죽는다.
 */
export const canPreview = (file: { name: string; size: number }): boolean =>
  fileViewKind(file.name) !== 'none' && file.size <= FILE_PREVIEW_MAX_BYTES;

const filePath = (projectId: number, fileId: number): string =>
  `${apiRoutes.marketProjects}/${String(projectId)}/files/${String(fileId)}`;

export const fetchPreviewBlob = async (projectId: number, fileId: number): Promise<Blob> =>
  apiGetBlob(filePath(projectId, fileId));

export const fetchPreviewData = async (
  projectId: number,
  fileId: number,
): Promise<FilePreviewDataType> => {
  const res = await apiGet(`${filePath(projectId, fileId)}/preview`, FilePreviewResponse);
  return res.data;
};

/**
 * 텍스트 첨부를 문자열로 — **인코딩 추정 포함**.
 *
 * Blob.text() 는 무조건 UTF-8 로 디코드한다. 국내에서 오가는 CSV·로그·거버는 EUC-KR(CP949)이
 * 흔해서 그대로 읽으면 한글이 전부 치환문자(U+FFFD)가 된다. 치환문자가 눈에 띄게 섞이면
 * euc-kr 로 다시 디코드해 더 나은 쪽을 쓴다.
 */
export const decodeTextBlob = async (blob: Blob): Promise<string> => {
  const buffer = await blob.arrayBuffer();
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  const broken = (utf8.match(/�/g) ?? []).length;
  if (broken === 0) return utf8;
  try {
    const euckr = new TextDecoder('euc-kr').decode(buffer);
    const euckrBroken = (euckr.match(/�/g) ?? []).length;
    return euckrBroken < broken ? euckr : utf8;
  } catch {
    // euc-kr 디코더가 없는 브라우저 — UTF-8 결과를 그대로 쓴다.
    return utf8;
  }
};

// 표 파서·구분자 판정은 계약에 있다(순수 함수라 테스트가 가능하고, 서버가 같은 표를
// 만들 일이 생겨도 두 벌이 되지 않는다). 여기서는 통과시키기만 한다.
export { delimiterFor, fileViewKind, needsServerPreview, parseDelimited };
export type { FileViewKindType, FilePreviewDataType };
