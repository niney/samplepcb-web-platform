// PCB 제작 사양 라벨·표시 순서 — 레거시 정본 승계(sp-smartbom-web
// src/types/pcbCart.ts SPEC_ROWS = PHP estimate_form_ca10.php 원문 그대로).
// '보광판'·'기준점표시' 등 표기도 레거시 화면 그대로 따른다(현장 용어 정합).
// 키는 플랫폼 specJson 카멜 표기(계약 KNOWN_SPEC_KEYS) — 레거시 diffDesign/kindpcb
// 류 변형은 어댑터가 이미 정규화하므로 여기선 다루지 않는다.

const SIZE_LABEL = 'PCB크기'; // width X length 합성 행(레거시 composite)

// 레거시 SPEC_ROWS 순서 그대로. 레거시에 없던 플랫폼 확장 키는 후미에 배치.
const SPEC_ROWS: { key: string; label: string }[] = [
  { key: 'material', label: 'PCB선택' },
  { key: 'kindPcb', label: 'PCB재료' },
  { key: 'metalCore', label: '메탈코어위치' },
  // PCB크기(width X length)는 composite — pcbSpecEntries 가 합성한다.
  { key: 'layers', label: 'PCB층수' },
  { key: 'pcbThickness', label: 'PCB두께' },
  { key: 'solderMask', label: 'PCB색상' },
  { key: 'silkscreen', label: '실크색상' },
  { key: 'surfaceFinish', label: '표면처리' },
  { key: 'copperWeights', label: '동박두께' },
  { key: 'finishedCopperAdvance', label: '내부동박두께' },
  { key: 'minTraceSpacing', label: '최소트랙공간' },
  { key: 'minHole', label: '최소홀크기' },
  { key: 'goldFingers', label: '골드핑거' },
  { key: 'differentDesign', label: '파일 개수' },
  { key: 'viaProcess', label: 'Via가공' },
  { key: 'impedance', label: '임피던스제어' },
  { key: 'etest', label: 'E-TEST' },
  { key: 'panel', label: '패널' },
  { key: 'halfHole', label: '반홀가공' },
  { key: 'stiffener', label: '보광판' },
  { key: 'tape3m', label: '3M Tape' },
  { key: 'framework', label: '프레임제작' },
  { key: 'stencilSide', label: '스텐실제작' },
  { key: 'stThickness', label: '스텐실두께' },
  { key: 'size', label: '스텐실크기' },
  { key: 'sizeCustom', label: '스텐실크기(직접입력)' },
  { key: 'fiducial', label: '기준점표시' },
  { key: 'electroPolish', label: '전해연마' },
  { key: 'edgeRail', label: '자삽바' },
  { key: 'placeOfOrigin', label: '원산지' },
  { key: 'cutting', label: '커팅' },
  // ── 레거시 SPEC_ROWS 에 없던 플랫폼 확장 키(기존 관리자 사전 라벨 승계) ──
  { key: 'mqty', label: '원판수량' },
  { key: 'coordinate', label: '부품 좌표' },
  { key: 'layersRigid', label: '층수(Rigid)' },
  { key: 'mat', label: '적층재료' },
  { key: 'surfaceFinishWeights', label: '표면마감두께' },
  { key: 'wvoltage', label: '내전압' },
];

export const PCB_SPEC_LABELS: Record<string, string> = Object.fromEntries(
  SPEC_ROWS.map((row) => [row.key, row.label]),
);

export interface PcbSpecEntry {
  key: string;
  label: string;
  value: string;
}

const textOf = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** specJson → 레거시 순서·명칭의 표시 행. 미지 키는 원키 라벨로 후미에 남긴다. */
export function pcbSpecEntries(spec: Record<string, unknown>): PcbSpecEntry[] {
  const out: PcbSpecEntry[] = [];
  const width = textOf(spec.width);
  const length = textOf(spec.length);
  const consumed = new Set<string>();

  // 레거시 순서에서 PCB크기는 메탈코어위치 다음(원본 SPEC_ROWS 4번째) — 동일 위치에 합성.
  for (const row of SPEC_ROWS) {
    if (row.key === 'layers' && width !== null && length !== null) {
      out.push({ key: 'size-composite', label: SIZE_LABEL, value: `${width} X ${length}` });
      consumed.add('width');
      consumed.add('length');
    }
    const value = textOf(spec[row.key]);
    if (value !== null) {
      out.push({ key: row.key, label: row.label, value });
      consumed.add(row.key);
    }
  }
  // 한쪽만 있는 크기 값·미지 키 — 정보 손실 없이 후미에 원키로.
  for (const [key, raw] of Object.entries(spec)) {
    if (consumed.has(key)) continue;
    const value = textOf(raw);
    if (value === null) continue;
    out.push({ key, label: key, value });
  }
  return out;
}
