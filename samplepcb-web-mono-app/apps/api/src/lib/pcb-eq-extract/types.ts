// PCB EQ 엑셀 추출기 공용 타입(D20 P2) — 정본 docs/PCB_PARTNER_TRACK.md 「D20 설계」·docs/PCB_EQ_AI_PROBE.md.
// 추출기는 셀 텍스트·병합·그림만 꺼낸다. 문항으로 읽는 일은 템플릿 파서(template.ts) 또는 LLM 몫이다.
// 좌표는 전부 **0 기준**(SheetJS·OfficeArt·DrawingML 과 같다) — 사람이 읽는 R8·E 표기는 직렬화기가 만든다.

export type EqImageExt = 'png' | 'jpg' | 'gif' | 'webp' | 'emf' | 'wmf' | 'bin';

export interface EqCellAnchor {
  row: number;
  col: number;
}

export interface EqMerge {
  s: EqCellAnchor;
  e: EqCellAnchor;
}

export interface EqSheet {
  name: string;
  /** rows[r][c] = 셀 텍스트('' = 빈 셀). 행 끝의 빈 셀은 잘려 있다. 엑셀 날짜 일련값은 YYYY-MM-DD. */
  rows: string[][];
  merges: EqMerge[];
}

export interface EqImage {
  /** 추출 순서 id(img-1, img-2 …) — LLM 자리표시·PcbEqDraft.figureRefs 가 이 값을 쓴다. */
  id: string;
  sheetName: string;
  /** 그림 왼쪽 위가 걸친 셀. 절대 위치 그림(absoluteAnchor)·위치를 못 읽은 그림은 null. */
  anchor: EqCellAnchor | null;
  ext: EqImageExt;
  data: Buffer;
}

export type EqSourceFormat = 'xls' | 'xlsx' | 'other';

/**
 * 통째로 못 읽은 까닭(시트 0개일 때) — 분석기가 실패 사유를 가른다.
 *  · no_workbook = 엑셀이 아니다(zip 안에 통합문서 없음·워드/PDF 등) · encrypted = 암호
 *  · too_large = 크기 상한 · unreadable = 손상·해석 실패
 */
export type EqExtractProblem = 'no_workbook' | 'encrypted' | 'too_large' | 'unreadable';

export interface EqExtract {
  /** 입력 파일 이름(zip 이면 zip 이름). */
  fileName: string;
  /** zip 안에서 고른 통합문서 경로 — zip 이 아니면 null. */
  innerName: string | null;
  format: EqSourceFormat | null;
  /** 시트를 하나도 못 꺼냈을 때의 까닭 — 읽었으면 null. */
  problem: EqExtractProblem | null;
  sheets: EqSheet[];
  images: EqImage[];
  /** 암호·손상·미지원·상한 초과 — throw 대신 여기에 쌓고 가능한 만큼 돌려준다. */
  warnings: string[];
}

// ── 안전 상한 ── 포털 업로드 경로에서 바로 부르게 될 함수라 입력을 믿지 않는다.
export const EQ_EXTRACT_LIMITS = {
  /** 입력 파일(zip 포함) 최대 크기. */
  maxInputBytes: 20 * 1024 * 1024,
  /** zip 안 통합문서의 압축 해제 크기 상한(zip 폭탄 방어). */
  maxInnerBytes: 40 * 1024 * 1024,
  maxSheets: 40,
  maxRows: 1000,
  maxCols: 80,
  maxImages: 30,
  /** 그림 한 장 상한 — 넘으면 버리고 경고. */
  maxImageBytes: 8 * 1024 * 1024,
} as const;
