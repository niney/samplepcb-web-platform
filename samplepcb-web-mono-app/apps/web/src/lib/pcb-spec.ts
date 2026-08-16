// PCB 제작 사양 표시 사전 — **거버 앱이 정본이다**.
//
// 이 파일은 자동 생성된다. 손으로 고치지 말고 정본을 고친 뒤 다시 생성한다:
//   1) node .tmp/pcb-spec-redesign/extract-gerber-values.mjs   (samplepcb_gerber → gerber-spec.json)
//   2) node .tmp/pcb-spec-redesign/gen-pcb-spec.mjs            (→ 이 파일)
//
// 정본 위치: samplepcb_gerber/apps/view/src/OptionControl/{types.ts, data/*.ts}
//   - data/*.ts 의 name  = 고객이 거버 화면에서 본 항목 이름
//   - data/*.ts 의 options[].name/value = 선택지 표시명 / 저장값
//   - ResultPanel/toProjectPayload.ts 의 SPEC_KEY_MAP = specJson 키로의 정규화
//
// ⚠ 항목은 카테고리마다 다르다. 같은 키가 세트별로 다른 이름을 갖는다
//   (minTraceSpacing = 패턴폭/간격 · 최소트랙간격 · 패턴크기). 그래서 단일 목록으로는 맞출 수 없고
//   세트를 골라야 한다. 세트는 category·orderCategory·kindPcb 세 값으로 결정된다(거버 reducer 와 같은 규칙).

export type PcbSpecSetName =
  | 'flexibleFPCB'
  | 'flexibleRigid'
  | 'massAdvanceFR4'
  | 'massAdvanceMetal'
  | 'massAdvanceRogers'
  | 'massStandard'
  | 'metalMask'
  | 'sampleAdvanceFR4'
  | 'sampleAdvanceMetal'
  | 'sampleAdvanceRogers'
  | 'sampleStandard';

/** 세트 판정에 필요한 맥락 — 셋 다 sp_order_spec 에 저장돼 있다.
 *  호출부가 옵셔널 체이닝으로 넘기는 자리라 undefined 를 명시한다(exactOptionalPropertyTypes). */
export interface PcbSpecContext {
  category?: string | null | undefined; // 제품군(거버 state.menu): standard | advance | flexible | metalMask
  orderCategory?: string | null | undefined; // 주문 성격(거버 state.category): sample | mass
  kindPcb?: string | null | undefined; // 재질(거버 state.kind): FR-4 | METAL | ROGERS | FPCB | Rigid-Flex
}

/** 문자열이면 공통 라벨, 튜플이면 그 세트에서만 쓰는 라벨. */
type SetRow = string | readonly [string, string];

/** 수정 화면의 한 칸. options 는 **그 유형의 선택지만** — 전 유형 합집합이 아니다. */
export interface PcbSpecField {
  key: string;
  label: string;
  /** value = 저장값(거버가 고를 때 넣는 값) · name = 화면 표시명. 비면 자유 입력. */
  options: readonly { value: string; name: string }[];
}

const COMMON_LABELS: Record<string, string> = {
  kindPcb: 'PCB선택',
  material: 'PCB재료',
  layers: 'PCB층수',
  'size-composite': '크기',
  qty: '수량',
  panel: '배열',
  edgeRail: '자삽바',
  pcbThickness: 'PCB두께',
  solderMask: 'PCB색상',
  silkscreen: '실크색상',
  minTraceSpacing: '최소트랙간격',
  minHole: '최소홀크기',
  goldFingers: '골드핑거',
  stiffener: '보강판',
  surfaceFinish: '표면마감',
  surfaceFinishWeights: '표면마감두께',
  copperWeights: '동박두께',
  finishedCopperAdvance: '내부동박두께',
  tape3m: '3M Tape',
  etest: 'E-Test',
  differentDesign: '파일갯수',
  impedance: '임피던스',
  halfHole: '반홀가공',
  layersRigid: '층수',
  mat: '재료',
  mqty: '원판수량',
  viaProcess: 'VIA가공',
  cutting: '컷팅',
  wvoltage: '내전압',
  framework: '프레임제작',
  size: '스텐실크기',
  sizeCustom: '스텐실크기(직접입력)',
  stencilSide: '스텐실제작',
  stThickness: '스텐실두께',
  metalCore: '메탈코어위치',
  fiducial: '기준점표시',
  electroPolish: '전해연마',
  placeOfOrigin: '원산지',
  coordinate: '부품 좌표',
  thickness: '두께',
  width: '가로',
  length: '세로',
};

const SPEC_SETS: Record<PcbSpecSetName, readonly SetRow[]> = {
  flexibleFPCB: [
    ['kindPcb', 'FPCB타입'],
    ['material', 'FPCB재료'],
    'layers',
    'size-composite',
    'qty',
    'panel',
    'edgeRail',
    'pcbThickness',
    'solderMask',
    'silkscreen',
    ['minTraceSpacing', '패턴크기'],
    ['minHole', '최소 홀 크기'],
    'goldFingers',
    'stiffener',
    'surfaceFinish',
    'surfaceFinishWeights',
    'copperWeights',
    'finishedCopperAdvance',
    'tape3m',
    ['etest', 'E-TEST'],
    ['differentDesign', '파일 개수'],
    ['impedance', '임피던스제어'],
    'halfHole',
  ],
  flexibleRigid: [
    ['kindPcb', 'FPCB 타입'],
    'layersRigid',
    'size-composite',
    'qty',
    'panel',
    'edgeRail',
    'mat',
    ['pcbThickness', 'Rigid-Flex 두께'],
    ['minTraceSpacing', '패턴크기'],
    ['minHole', '최소 홀 크기'],
    'surfaceFinish',
    'goldFingers',
    ['differentDesign', '파일 개수'],
    'halfHole',
  ],
  massAdvanceFR4: [
    'kindPcb',
    'material',
    'layers',
    'size-composite',
    'mqty',
    'qty',
    'panel',
    'edgeRail',
    'pcbThickness',
    'solderMask',
    'silkscreen',
    'surfaceFinish',
    'copperWeights',
    'finishedCopperAdvance',
    'minTraceSpacing',
    'minHole',
    'goldFingers',
    'differentDesign',
    'impedance',
    'viaProcess',
    'etest',
    'cutting',
  ],
  massAdvanceMetal: [
    'kindPcb',
    'material',
    'wvoltage',
    'layers',
    'size-composite',
    'mqty',
    'qty',
    'panel',
    'edgeRail',
    'pcbThickness',
    'solderMask',
    'silkscreen',
    'surfaceFinish',
    'copperWeights',
    'minTraceSpacing',
    'minHole',
    'goldFingers',
    ['differentDesign', '여러디자인'],
    'viaProcess',
    'etest',
    'cutting',
  ],
  massAdvanceRogers: [
    'kindPcb',
    'material',
    'layers',
    'size-composite',
    'mqty',
    'qty',
    'panel',
    'edgeRail',
    'pcbThickness',
    'solderMask',
    'silkscreen',
    'surfaceFinish',
    'copperWeights',
    'finishedCopperAdvance',
    'minTraceSpacing',
    'minHole',
    'goldFingers',
    ['differentDesign', '여러디자인'],
    'impedance',
    'viaProcess',
    'etest',
    'cutting',
  ],
  massStandard: [
    'kindPcb',
    'material',
    'layers',
    'size-composite',
    'mqty',
    'qty',
    'panel',
    'edgeRail',
    'pcbThickness',
    'solderMask',
    'silkscreen',
    'surfaceFinish',
    'copperWeights',
    'finishedCopperAdvance',
    ['minTraceSpacing', '패턴폭/간격'],
    'minHole',
    'goldFingers',
    'differentDesign',
    'viaProcess',
    'halfHole',
    'etest',
    'cutting',
  ],
  metalMask: [
    'framework',
    'size',
    'sizeCustom',
    'stencilSide',
    'stThickness',
    'qty',
    'size-composite',
    'minHole',
    'layers',
  ],
  sampleAdvanceFR4: [
    'kindPcb',
    'material',
    'layers',
    'size-composite',
    'qty',
    'panel',
    'edgeRail',
    'pcbThickness',
    'solderMask',
    'silkscreen',
    'surfaceFinish',
    'copperWeights',
    'finishedCopperAdvance',
    'minTraceSpacing',
    'minHole',
    'goldFingers',
    'differentDesign',
    'impedance',
    'viaProcess',
    'etest',
    'cutting',
  ],
  sampleAdvanceMetal: [
    'kindPcb',
    'material',
    'wvoltage',
    'layers',
    'size-composite',
    'qty',
    'panel',
    'edgeRail',
    'pcbThickness',
    'solderMask',
    'silkscreen',
    'surfaceFinish',
    'copperWeights',
    'minTraceSpacing',
    'minHole',
    'goldFingers',
    ['differentDesign', '여러디자인'],
    'impedance',
    'viaProcess',
    'etest',
    'cutting',
  ],
  sampleAdvanceRogers: [
    'kindPcb',
    'material',
    'layers',
    'size-composite',
    'qty',
    'panel',
    'edgeRail',
    'pcbThickness',
    'solderMask',
    'silkscreen',
    'surfaceFinish',
    'copperWeights',
    'finishedCopperAdvance',
    'minTraceSpacing',
    'minHole',
    'goldFingers',
    ['differentDesign', '여러디자인'],
    'impedance',
    'viaProcess',
    'etest',
    'cutting',
  ],
  sampleStandard: [
    'kindPcb',
    'material',
    'layers',
    'size-composite',
    'qty',
    'panel',
    'edgeRail',
    'pcbThickness',
    'solderMask',
    'silkscreen',
    'surfaceFinish',
    'copperWeights',
    'finishedCopperAdvance',
    ['minTraceSpacing', '패턴폭/간격'],
    'minHole',
    'goldFingers',
    'differentDesign',
    'viaProcess',
    'halfHole',
    'etest',
    'cutting',
  ],
};

/** 수정 화면이 세우는 칸 — 거버가 그 유형에서 실제로 물어보는 것만, 거버가 물어본 순서로.
 *  options 가 비어 있으면 자유 입력 항목이다(크기·수량·파일 개수처럼 거버도 직접 받는다). */
const SPEC_FIELDS: Record<PcbSpecSetName, readonly PcbSpecField[]> = {
  flexibleFPCB: [
    {
      key: 'kindPcb',
      label: 'FPCB타입',
      options: [
        { value: 'FPCB', name: 'FPCB' },
        { value: 'Rigid-Flex', name: 'Rigid-Flex' },
      ],
    },
    { key: 'material', label: 'FPCB재료', options: [{ value: 'POLYAMIDE', name: 'POLYAMIDE' }] },
    {
      key: 'layers',
      label: 'PCB층수',
      options: [
        { value: '1', name: '1' },
        { value: '2', name: '2' },
        { value: '4', name: '4' },
        { value: '6', name: '6' },
        { value: '8', name: '8' },
        { value: '10', name: '10' },
      ],
    },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
      ],
    },
    {
      key: 'pcbThickness',
      label: 'PCB두께',
      options: [
        { value: '0.08', name: '0.08' },
        { value: '0.1', name: '0.1' },
        { value: '0.13', name: '0.13' },
        { value: '0.15', name: '0.15' },
        { value: '0.22', name: '0.22' },
      ],
    },
    {
      key: 'solderMask',
      label: 'PCB색상',
      options: [
        { value: 'yellow', name: '노랑' },
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'silkscreen',
      label: '실크색상',
      options: [
        { value: 'black', name: '검정' },
        { value: 'white', name: '흰색' },
      ],
    },
    { key: 'minTraceSpacing', label: '패턴크기', options: [{ value: '0.06mm', name: '0.06mm' }] },
    { key: 'minHole', label: '최소 홀 크기', options: [{ value: '0.15mm', name: '0.15mm' }] },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'stiffener',
      label: '보강판',
      options: [
        { value: 'None', name: 'None' },
        { value: 'TOP', name: 'TOP' },
        { value: 'Bottom', name: 'Bottom' },
        { value: 'Both', name: 'Both' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
        { value: 'ag', name: 'AG' },
        { value: 'tin', name: 'TIN' },
      ],
    },
    {
      key: 'surfaceFinishWeights',
      label: '표면마감두께',
      options: [
        { value: '1U', name: '1U' },
        { value: '2U', name: '2U' },
        { value: '3U', name: '3U' },
      ],
    },
    {
      key: 'copperWeights',
      label: '동박두께',
      options: [
        { value: '0.5oz', name: '0.5OZ' },
        { value: '1oz', name: '1OZ' },
      ],
    },
    {
      key: 'finishedCopperAdvance',
      label: '내부동박두께',
      options: [
        { value: '1oz', name: '1OZ' },
        { value: '1.5oz', name: '1.5OZ' },
        { value: '2oz', name: '2OZ' },
      ],
    },
    {
      key: 'tape3m',
      label: '3M Tape',
      options: [
        { value: 'None', name: 'None' },
        { value: 'Top', name: 'Top' },
        { value: 'Bottom', name: 'Bottom' },
        { value: 'Both', name: 'Both' },
      ],
    },
    {
      key: 'etest',
      label: 'E-TEST',
      options: [
        { value: '프로브', name: '프로브' },
        { value: 'BBT', name: 'BBT' },
        { value: 'No', name: 'No' },
      ],
    },
    { key: 'differentDesign', label: '파일 개수', options: [] },
    {
      key: 'impedance',
      label: '임피던스제어',
      options: [
        { value: '50', name: '50Ω' },
        { value: '90', name: '90Ω' },
        { value: '100', name: '100Ω' },
        { value: 'none', name: 'No' },
      ],
    },
    {
      key: 'halfHole',
      label: '반홀가공',
      options: [
        { value: 'yes', name: 'Yes' },
        { value: 'no', name: 'No' },
      ],
    },
  ],
  flexibleRigid: [
    {
      key: 'kindPcb',
      label: 'FPCB 타입',
      options: [
        { value: 'FPCB', name: 'FPCB' },
        { value: 'Rigid-Flex', name: 'Rigid-Flex' },
      ],
    },
    {
      key: 'layersRigid',
      label: '층수',
      options: [
        { value: '1', name: '1' },
        { value: '2', name: '2' },
        { value: '4', name: '4' },
        { value: '6', name: '6' },
        { value: '8', name: '8' },
        { value: '10', name: '10' },
      ],
    },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
      ],
    },
    { key: 'mat', label: '재료', options: [{ value: '폴리아미드+FR4', name: '폴리아미드+FR4' }] },
    {
      key: 'pcbThickness',
      label: 'Rigid-Flex 두께',
      options: [
        { value: '0.6', name: '0.6' },
        { value: '0.8', name: '0.8' },
        { value: '1.0', name: '1.0' },
        { value: '1.2', name: '1.2' },
        { value: '1.6', name: '1.6' },
        { value: '2.0', name: '2.0' },
      ],
    },
    {
      key: 'minTraceSpacing',
      label: '패턴크기',
      options: [
        { value: '4/4mil', name: '4/4mil' },
        { value: '5/5mil', name: '5/5mil' },
        { value: '6/6mil', name: '6/6mil' },
      ],
    },
    {
      key: 'minHole',
      label: '최소 홀 크기',
      options: [
        { value: '0.2mm', name: '0.2mm' },
        { value: '0.25mm', name: '0.25mm' },
        { value: '0.3mm', name: '0.3mm' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'hasl', name: 'HASL(lead)' },
        { value: 'haslLf', name: 'HASL(free)' },
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
      ],
    },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    { key: 'differentDesign', label: '파일 개수', options: [] },
    {
      key: 'halfHole',
      label: '반홀가공',
      options: [
        { value: 'yes', name: 'Yes' },
        { value: 'no', name: 'No' },
      ],
    },
  ],
  massAdvanceFR4: [
    {
      key: 'kindPcb',
      label: 'PCB선택',
      options: [
        { value: 'FR-4', name: 'FR-4' },
        { value: 'METAL', name: 'METAL' },
        { value: 'ROGERS', name: 'ROGERS' },
      ],
    },
    {
      key: 'material',
      label: 'PCB재료',
      options: [
        { value: 'TG150', name: 'TG150-160' },
        { value: 'TG170', name: 'TG170-180' },
      ],
    },
    { key: 'layers', label: 'PCB층수', options: [] },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'mqty', label: '원판수량', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
        { value: '10mm', name: '10mm' },
        { value: '고객데이터', name: '고객데이터' },
      ],
    },
    {
      key: 'pcbThickness',
      label: 'PCB두께',
      options: [
        { value: '0.2', name: '0.2' },
        { value: '0.4', name: '0.4' },
        { value: '0.6', name: '0.6' },
        { value: '0.8', name: '0.8' },
        { value: '1.0', name: '1.0' },
        { value: '1.2', name: '1.2' },
        { value: '1.6', name: '1.6' },
        { value: '2.0', name: '2.0' },
        { value: '2.4', name: '2.4' },
        { value: '2.8', name: '2.8' },
        { value: '3.2', name: '3.2' },
      ],
    },
    {
      key: 'solderMask',
      label: 'PCB색상',
      options: [
        { value: 'green', name: '녹색' },
        { value: 'red', name: '빨강' },
        { value: 'yellow', name: '노랑' },
        { value: 'blue', name: '파랑' },
        { value: 'white', name: '흰색' },
        { value: 'black', name: '유광검정' },
        { value: 'matteBlack', name: '무광검정' },
      ],
    },
    {
      key: 'silkscreen',
      label: '실크색상',
      options: [
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'hasl', name: 'HASL(lead)' },
        { value: 'haslLf', name: 'HASL(free)' },
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
        { value: 'hardGold', name: 'Hard Gold' },
        { value: 'ag', name: 'Ag' },
      ],
    },
    {
      key: 'copperWeights',
      label: '동박두께',
      options: [
        { value: '1/3oz', name: '1/3' },
        { value: '1/2oz', name: '1/2' },
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '3oz', name: '3' },
        { value: '4oz', name: '4' },
        { value: '5oz', name: '5' },
        { value: '6oz', name: '6' },
        { value: '~12oz', name: '~12' },
      ],
    },
    {
      key: 'finishedCopperAdvance',
      label: '내부동박두께',
      options: [
        { value: '1/3oz', name: '1/3' },
        { value: '1/2oz', name: '1/2' },
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '3oz', name: '3' },
        { value: '4oz', name: '4' },
        { value: '5oz', name: '5' },
        { value: '6oz', name: '6' },
        { value: '~12oz', name: '~12' },
      ],
    },
    {
      key: 'minTraceSpacing',
      label: '최소트랙간격',
      options: [
        { value: '3/3mil', name: '3/3mil' },
        { value: '4/4mil', name: '4/4mil' },
        { value: '5/5mil', name: '5/5mil' },
        { value: '6/6mil', name: '6/6mil' },
        { value: '8/8mil', name: '8/8mil' },
      ],
    },
    {
      key: 'minHole',
      label: '최소홀크기',
      options: [
        { value: '0.15mm', name: '0.15mm' },
        { value: '0.2mm', name: '0.2mm' },
        { value: '0.25mm', name: '0.25mm' },
        { value: '0.3mm', name: '0.3mm' },
        { value: 'none', name: 'none' },
      ],
    },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    { key: 'differentDesign', label: '파일갯수', options: [] },
    {
      key: 'impedance',
      label: '임피던스',
      options: [
        { value: 'none', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'viaProcess',
      label: 'VIA가공',
      options: [
        { value: 'Tenting vias', name: 'Tenting' },
        { value: 'Plugged vias', name: 'Plugged' },
        { value: 'Not Covered', name: 'Not Covered' },
        { value: 'Buried', name: 'Buried' },
        { value: 'Blind', name: 'Blind' },
      ],
    },
    {
      key: 'etest',
      label: 'E-Test',
      options: [
        { value: '프로브', name: '프로브' },
        { value: 'BBT', name: 'BBT' },
        { value: 'No', name: 'No' },
      ],
    },
    {
      key: 'cutting',
      label: '컷팅',
      options: [
        { value: 'V-Cut', name: 'V-Cut' },
        { value: 'Tap Route', name: 'Tap Route' },
        { value: 'Both', name: 'Both' },
      ],
    },
  ],
  massAdvanceMetal: [
    {
      key: 'kindPcb',
      label: 'PCB선택',
      options: [
        { value: 'FR-4', name: 'FR-4' },
        { value: 'METAL', name: 'METAL' },
        { value: 'ROGERS', name: 'ROGERS' },
      ],
    },
    {
      key: 'material',
      label: 'PCB재료',
      options: [
        { value: '알루미늄(1W)', name: '알루미늄(1W)' },
        { value: '알루미늄(2W)', name: '알루미늄(2W)' },
        { value: 'Steel', name: 'Steel' },
        { value: 'Bronze', name: 'Bronze' },
      ],
    },
    {
      key: 'wvoltage',
      label: '내전압',
      options: [
        { value: '500V', name: '500V' },
        { value: '1000V', name: '1000V' },
        { value: '1500V', name: '1500V' },
        { value: '3000V', name: '3000V' },
      ],
    },
    { key: 'layers', label: 'PCB층수', options: [] },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'mqty', label: '원판수량', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
        { value: '10mm', name: '10mm' },
      ],
    },
    {
      key: 'pcbThickness',
      label: 'PCB두께',
      options: [
        { value: '0.2', name: '0.2' },
        { value: '0.4', name: '0.4' },
        { value: '0.6', name: '0.6' },
        { value: '0.8', name: '0.8' },
        { value: '1.0', name: '1.0' },
        { value: '1.2', name: '1.2' },
        { value: '1.6', name: '1.6' },
        { value: '2.0', name: '2.0' },
        { value: '2.4', name: '2.4' },
        { value: '2.8', name: '2.8' },
        { value: '3.2', name: '3.2' },
      ],
    },
    {
      key: 'solderMask',
      label: 'PCB색상',
      options: [
        { value: 'green', name: '녹색' },
        { value: 'red', name: '빨강' },
        { value: 'yellow', name: '노랑' },
        { value: 'blue', name: '파랑' },
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'silkscreen',
      label: '실크색상',
      options: [
        { value: 'black', name: '검정' },
        { value: 'white', name: '흰색' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'hasl', name: 'HASL(lead)' },
        { value: 'haslLf', name: 'HASL(free)' },
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
        { value: 'hardGold', name: 'Hard Gold' },
        { value: 'ag', name: 'Ag' },
      ],
    },
    {
      key: 'copperWeights',
      label: '동박두께',
      options: [
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '3oz', name: '3' },
        { value: '4oz', name: '4' },
        { value: '5oz', name: '5' },
        { value: '6oz', name: '6' },
      ],
    },
    {
      key: 'minTraceSpacing',
      label: '최소트랙간격',
      options: [
        { value: '4/4mil', name: '4/4mil' },
        { value: '5/5mil', name: '5/5mil' },
        { value: '6/6mil', name: '6/6mil' },
        { value: '8/8mil', name: '8/8mil' },
      ],
    },
    {
      key: 'minHole',
      label: '최소홀크기',
      options: [
        { value: '0.2mm', name: '0.2mm' },
        { value: '0.25mm', name: '0.25mm' },
        { value: '0.3mm', name: '0.3mm' },
        { value: 'none', name: 'none' },
      ],
    },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'differentDesign',
      label: '여러디자인',
      options: [
        { value: 'yes', name: 'Yes' },
        { value: 'no', name: 'No' },
      ],
    },
    {
      key: 'viaProcess',
      label: 'VIA가공',
      options: [
        { value: 'Tenting vias', name: 'Tenting' },
        { value: 'Plugged vias', name: 'Plugged' },
        { value: 'Not Covered', name: 'Not Covered' },
      ],
    },
    {
      key: 'etest',
      label: 'E-Test',
      options: [
        { value: '프로브', name: '프로브' },
        { value: 'BBT', name: 'BBT' },
      ],
    },
    {
      key: 'cutting',
      label: '컷팅',
      options: [
        { value: 'V-Cut', name: 'V-Cut' },
        { value: 'Tap Route', name: 'Tap Route' },
        { value: 'Both', name: 'Both' },
      ],
    },
  ],
  massAdvanceRogers: [
    {
      key: 'kindPcb',
      label: 'PCB선택',
      options: [
        { value: 'FR-4', name: 'FR-4' },
        { value: 'METAL', name: 'METAL' },
        { value: 'ROGERS', name: 'ROGERS' },
      ],
    },
    {
      key: 'material',
      label: 'PCB재료',
      options: [
        { value: '4003C', name: '4003C' },
        { value: '4350B', name: '4350B' },
        { value: '직접입력', name: '직접입력' },
      ],
    },
    { key: 'layers', label: 'PCB층수', options: [] },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'mqty', label: '원판수량', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
        { value: '10mm', name: '10mm' },
      ],
    },
    {
      key: 'pcbThickness',
      label: 'PCB두께',
      options: [
        { value: '0.2', name: '0.2' },
        { value: '0.4', name: '0.4' },
        { value: '0.6', name: '0.6' },
        { value: '0.8', name: '0.8' },
        { value: '1.0', name: '1.0' },
        { value: '1.2', name: '1.2' },
        { value: '1.6', name: '1.6' },
        { value: '2.0', name: '2.0' },
        { value: '2.4', name: '2.4' },
        { value: '2.8', name: '2.8' },
        { value: '3.2', name: '3.2' },
      ],
    },
    {
      key: 'solderMask',
      label: 'PCB색상',
      options: [
        { value: 'green', name: '녹색' },
        { value: 'red', name: '빨강' },
        { value: 'yellow', name: '노랑' },
        { value: 'blue', name: '파랑' },
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'silkscreen',
      label: '실크색상',
      options: [
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'hasl', name: 'HASL(lead)' },
        { value: 'haslLf', name: 'HASL(free)' },
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
        { value: 'hardGold', name: 'Hard Gold' },
        { value: 'ag', name: 'Ag' },
      ],
    },
    {
      key: 'copperWeights',
      label: '동박두께',
      options: [
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '3oz', name: '3' },
        { value: '4oz', name: '4' },
        { value: '5oz', name: '5' },
        { value: '6oz', name: '6' },
      ],
    },
    {
      key: 'finishedCopperAdvance',
      label: '내부동박두께',
      options: [
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '3oz', name: '3' },
        { value: '4oz', name: '4' },
        { value: '5oz', name: '5' },
        { value: '6oz', name: '6' },
      ],
    },
    {
      key: 'minTraceSpacing',
      label: '최소트랙간격',
      options: [
        { value: '3/3mil', name: '3/3mil' },
        { value: '4/4mil', name: '4/4mil' },
        { value: '5/5mil', name: '5/5mil' },
        { value: '6/6mil', name: '6/6mil' },
        { value: '8/8mil', name: '8/8mil' },
      ],
    },
    {
      key: 'minHole',
      label: '최소홀크기',
      options: [
        { value: '0.15mm', name: '0.15mm' },
        { value: '0.2mm', name: '0.2mm' },
        { value: '0.25mm', name: '0.25mm' },
        { value: '0.3mm', name: '0.3mm' },
        { value: 'none', name: 'none' },
      ],
    },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'differentDesign',
      label: '여러디자인',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'impedance',
      label: '임피던스',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'viaProcess',
      label: 'VIA가공',
      options: [
        { value: 'Tenting vias', name: 'Tenting' },
        { value: 'Plugged vias', name: 'Plugged' },
        { value: 'Not Covered', name: 'Not Covered' },
        { value: 'Buried', name: 'Buried' },
        { value: 'Blind', name: 'Blind' },
      ],
    },
    {
      key: 'etest',
      label: 'E-Test',
      options: [
        { value: '프로브', name: '프로브' },
        { value: 'BBT', name: 'BBT' },
        { value: 'No', name: 'No' },
      ],
    },
    {
      key: 'cutting',
      label: '컷팅',
      options: [
        { value: 'V-Cut', name: 'V-Cut' },
        { value: 'Tap Route', name: 'Tap Route' },
        { value: 'Both', name: 'Both' },
      ],
    },
  ],
  massStandard: [
    { key: 'kindPcb', label: 'PCB선택', options: [{ value: 'FR-4', name: 'FR-4' }] },
    { key: 'material', label: 'PCB재료', options: [{ value: 'TG130', name: 'TG130-140' }] },
    {
      key: 'layers',
      label: 'PCB층수',
      options: [
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '0.5oz', name: '0.5' },
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
      ],
    },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'mqty', label: '원판수량', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
        { value: '고객사제공', name: '고객사제공' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
        { value: '10mm', name: '10mm' },
      ],
    },
    {
      key: 'pcbThickness',
      label: 'PCB두께',
      options: [
        { value: '0.8', name: '0.8' },
        { value: '1.0', name: '1.0' },
        { value: '1.2', name: '1.2' },
        { value: '1.6', name: '1.6' },
        { value: '2.0', name: '2.0' },
      ],
    },
    {
      key: 'solderMask',
      label: 'PCB색상',
      options: [
        { value: 'green', name: '녹색' },
        { value: 'red', name: '빨강' },
        { value: 'yellow', name: '노랑' },
        { value: 'blue', name: '파랑' },
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'silkscreen',
      label: '실크색상',
      options: [
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'hasl', name: 'HASL(lead)' },
        { value: 'haslLf', name: 'HASL(free)' },
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
      ],
    },
    {
      key: 'copperWeights',
      label: '동박두께',
      options: [
        { value: '0.5oz', name: '0.5' },
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
      ],
    },
    {
      key: 'finishedCopperAdvance',
      label: '내부동박두께',
      options: [
        { value: '0.5oz', name: '0.5OZ' },
        { value: '1oz', name: '1OZ' },
        { value: '2oz', name: '2OZ' },
      ],
    },
    {
      key: 'minTraceSpacing',
      label: '패턴폭/간격',
      options: [
        { value: '5/5mil', name: '5/5 mil' },
        { value: '6/6mil', name: '6/6 mil' },
        { value: '8/8mil', name: '8/8 mil' },
      ],
    },
    {
      key: 'minHole',
      label: '최소홀크기',
      options: [
        { value: '0.2mm', name: '0.2mm' },
        { value: '0.25mm', name: '0.25mm' },
        { value: '0.3mm', name: '0.3mm' },
      ],
    },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    { key: 'differentDesign', label: '파일갯수', options: [] },
    {
      key: 'viaProcess',
      label: 'VIA가공',
      options: [
        { value: 'Tenting vias', name: 'Tenting' },
        { value: 'Open', name: 'Open' },
      ],
    },
    {
      key: 'halfHole',
      label: '반홀가공',
      options: [
        { value: 'yes', name: 'Yes' },
        { value: 'no', name: 'No' },
      ],
    },
    { key: 'etest', label: 'E-Test', options: [{ value: 'Flying', name: 'Flying' }] },
    {
      key: 'cutting',
      label: '컷팅',
      options: [
        { value: 'Single', name: 'Single' },
        { value: 'V-Cut', name: 'V-Cut' },
        { value: 'Tap Route', name: 'Tap Route' },
        { value: 'Both', name: 'Both' },
      ],
    },
  ],
  metalMask: [
    {
      key: 'framework',
      label: '프레임제작',
      options: [
        { value: 'framework', name: 'Framework' },
        { value: 'nonFramework', name: 'Non Framework' },
      ],
    },
    {
      key: 'size',
      label: '스텐실크기',
      options: [
        { value: '300x400', name: '300 x 400 mm' },
        { value: 'direct', name: '직접입력' },
      ],
    },
    { key: 'sizeCustom', label: '스텐실크기(직접입력)', options: [] },
    {
      key: 'stencilSide',
      label: '스텐실제작',
      options: [
        { value: 'Top Side', name: 'TOP' },
        { value: 'Bottom Side', name: 'BOT' },
        { value: 'Both Side', name: 'BOTH' },
      ],
    },
    {
      key: 'stThickness',
      label: '스텐실두께',
      options: [
        { value: '0.05', name: '0.05mm' },
        { value: '0.08', name: '0.08mm' },
        { value: '0.10', name: '0.10mm' },
        { value: '0.12', name: '0.12mm' },
        { value: '0.15', name: '0.15mm' },
        { value: '0.20', name: '0.20mm' },
      ],
    },
    { key: 'qty', label: '수량', options: [] },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'minHole', label: COMMON_LABELS.minHole ?? 'minHole', options: [] },
    { key: 'layers', label: COMMON_LABELS.layers ?? 'layers', options: [] },
  ],
  sampleAdvanceFR4: [
    {
      key: 'kindPcb',
      label: 'PCB선택',
      options: [
        { value: 'FR-4', name: 'FR-4' },
        { value: 'METAL', name: 'METAL' },
        { value: 'ROGERS', name: 'ROGERS' },
      ],
    },
    {
      key: 'material',
      label: 'PCB재료',
      options: [
        { value: 'TG150', name: 'TG150-160' },
        { value: 'TG170', name: 'TG170-180' },
      ],
    },
    { key: 'layers', label: 'PCB층수', options: [] },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
        { value: '10mm', name: '10mm' },
      ],
    },
    {
      key: 'pcbThickness',
      label: 'PCB두께',
      options: [
        { value: '0.2', name: '0.2' },
        { value: '0.4', name: '0.4' },
        { value: '0.6', name: '0.6' },
        { value: '0.8', name: '0.8' },
        { value: '1.0', name: '1.0' },
        { value: '1.2', name: '1.2' },
        { value: '1.6', name: '1.6' },
        { value: '2.0', name: '2.0' },
        { value: '2.4', name: '2.4' },
        { value: '2.8', name: '2.8' },
        { value: '3.2', name: '3.2' },
      ],
    },
    {
      key: 'solderMask',
      label: 'PCB색상',
      options: [
        { value: 'green', name: '녹색' },
        { value: 'red', name: '빨강' },
        { value: 'yellow', name: '노랑' },
        { value: 'blue', name: '파랑' },
        { value: 'white', name: '흰색' },
        { value: 'black', name: '유광검정' },
        { value: 'matteBlack', name: '무광검정' },
      ],
    },
    {
      key: 'silkscreen',
      label: '실크색상',
      options: [
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'hasl', name: 'HASL(lead)' },
        { value: 'haslLf', name: 'HASL(free)' },
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
        { value: 'hardGold', name: 'Hard Gold' },
        { value: 'ag', name: 'Ag' },
      ],
    },
    {
      key: 'copperWeights',
      label: '동박두께',
      options: [
        { value: '1/3oz', name: '1/3' },
        { value: '1/2oz', name: '1/2' },
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '3oz', name: '3' },
        { value: '4oz', name: '4' },
        { value: '5oz', name: '5' },
        { value: '6oz', name: '6' },
        { value: '~12oz', name: '~12' },
      ],
    },
    {
      key: 'finishedCopperAdvance',
      label: '내부동박두께',
      options: [
        { value: '1/3oz', name: '1/3' },
        { value: '1/2oz', name: '1/2' },
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '3oz', name: '3' },
        { value: '4oz', name: '4' },
        { value: '5oz', name: '5' },
        { value: '6oz', name: '6' },
        { value: '~12oz', name: '~12' },
      ],
    },
    {
      key: 'minTraceSpacing',
      label: '최소트랙간격',
      options: [
        { value: '3/3mil', name: '3/3mil' },
        { value: '4/4mil', name: '4/4mil' },
        { value: '5/5mil', name: '5/5mil' },
        { value: '6/6mil', name: '6/6mil' },
        { value: '8/8mil', name: '8/8mil' },
      ],
    },
    {
      key: 'minHole',
      label: '최소홀크기',
      options: [
        { value: '0.1mm', name: '0.1mm' },
        { value: '0.15mm', name: '0.15mm' },
        { value: '0.2mm', name: '0.2mm' },
        { value: '0.25mm', name: '0.25mm' },
        { value: '0.3mm', name: '0.3mm' },
      ],
    },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    { key: 'differentDesign', label: '파일갯수', options: [] },
    {
      key: 'impedance',
      label: '임피던스',
      options: [
        { value: 'none', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'viaProcess',
      label: 'VIA가공',
      options: [
        { value: 'Tenting vias', name: 'Tenting' },
        { value: 'Plugged vias', name: 'Plugged' },
        { value: 'Not Covered', name: 'Not Covered' },
        { value: 'Buried', name: 'Buried' },
        { value: 'Blind', name: 'Blind' },
      ],
    },
    {
      key: 'etest',
      label: 'E-Test',
      options: [
        { value: '프로브', name: '프로브' },
        { value: 'BBT', name: 'BBT' },
        { value: 'No', name: 'No' },
      ],
    },
    {
      key: 'cutting',
      label: '컷팅',
      options: [
        { value: 'V-Cut', name: 'V-Cut' },
        { value: 'Tap Route', name: 'Tap Route' },
        { value: 'Both', name: 'Both' },
      ],
    },
  ],
  sampleAdvanceMetal: [
    {
      key: 'kindPcb',
      label: 'PCB선택',
      options: [
        { value: 'FR-4', name: 'FR-4' },
        { value: 'METAL', name: 'METAL' },
        { value: 'ROGERS', name: 'ROGERS' },
      ],
    },
    {
      key: 'material',
      label: 'PCB재료',
      options: [
        { value: '알루미늄(1W)', name: '알루미늄(1W)' },
        { value: '알루미늄(2W)', name: '알루미늄(2W)' },
        { value: 'Steel', name: 'Steel' },
        { value: 'Bronze', name: 'Bronze' },
      ],
    },
    {
      key: 'wvoltage',
      label: '내전압',
      options: [
        { value: '500V', name: '500V' },
        { value: '1000V', name: '1000V' },
        { value: '1500V', name: '1500V' },
        { value: '3000V', name: '3000V' },
      ],
    },
    { key: 'layers', label: 'PCB층수', options: [] },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
        { value: '10mm', name: '10mm' },
      ],
    },
    {
      key: 'pcbThickness',
      label: 'PCB두께',
      options: [
        { value: '0.2', name: '0.2' },
        { value: '0.4', name: '0.4' },
        { value: '0.6', name: '0.6' },
        { value: '0.8', name: '0.8' },
        { value: '1.0', name: '1.0' },
        { value: '1.2', name: '1.2' },
        { value: '1.6', name: '1.6' },
        { value: '2.0', name: '2.0' },
        { value: '2.4', name: '2.4' },
        { value: '2.8', name: '2.8' },
        { value: '3.2', name: '3.2' },
      ],
    },
    {
      key: 'solderMask',
      label: 'PCB색상',
      options: [
        { value: 'green', name: '녹색' },
        { value: 'red', name: '빨강' },
        { value: 'yellow', name: '노랑' },
        { value: 'blue', name: '파랑' },
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'silkscreen',
      label: '실크색상',
      options: [
        { value: 'black', name: '검정' },
        { value: 'white', name: '흰색' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'hasl', name: 'HASL(lead)' },
        { value: 'haslLf', name: 'HASL(free)' },
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
        { value: 'hardGold', name: 'Hard Gold' },
        { value: 'ag', name: 'Ag' },
      ],
    },
    {
      key: 'copperWeights',
      label: '동박두께',
      options: [
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
      ],
    },
    {
      key: 'minTraceSpacing',
      label: '최소트랙간격',
      options: [
        { value: '4/4mil', name: '4/4mil' },
        { value: '5/5mil', name: '5/5mil' },
        { value: '6/6mil', name: '6/6mil' },
        { value: '8/8mil', name: '8/8mil' },
      ],
    },
    {
      key: 'minHole',
      label: '최소홀크기',
      options: [
        { value: '0.2mm', name: '0.2mm' },
        { value: '0.25mm', name: '0.25mm' },
        { value: '0.3mm', name: '0.3mm' },
        { value: 'none', name: 'none' },
      ],
    },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'differentDesign',
      label: '여러디자인',
      options: [
        { value: 'yes', name: 'Yes' },
        { value: 'no', name: 'No' },
      ],
    },
    {
      key: 'impedance',
      label: '임피던스',
      options: [
        { value: 'none', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'viaProcess',
      label: 'VIA가공',
      options: [
        { value: 'Tenting vias', name: 'Tenting' },
        { value: 'Plugged vias', name: 'Plugged' },
        { value: 'Not Covered', name: 'Not Covered' },
      ],
    },
    {
      key: 'etest',
      label: 'E-Test',
      options: [
        { value: '프로브', name: '프로브' },
        { value: 'BBT', name: 'BBT' },
      ],
    },
    {
      key: 'cutting',
      label: '컷팅',
      options: [
        { value: 'V-Cut', name: 'V-Cut' },
        { value: 'Tap Route', name: 'Tap Route' },
        { value: 'Both', name: 'Both' },
      ],
    },
  ],
  sampleAdvanceRogers: [
    {
      key: 'kindPcb',
      label: 'PCB선택',
      options: [
        { value: 'FR-4', name: 'FR-4' },
        { value: 'METAL', name: 'METAL' },
        { value: 'ROGERS', name: 'ROGERS' },
      ],
    },
    {
      key: 'material',
      label: 'PCB재료',
      options: [
        { value: '4003C', name: '4003C' },
        { value: '4350B', name: '4350B' },
      ],
    },
    { key: 'layers', label: 'PCB층수', options: [] },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
        { value: '10mm', name: '10mm' },
      ],
    },
    {
      key: 'pcbThickness',
      label: 'PCB두께',
      options: [
        { value: '0.2', name: '0.2' },
        { value: '0.4', name: '0.4' },
        { value: '0.6', name: '0.6' },
        { value: '0.8', name: '0.8' },
        { value: '1.0', name: '1.0' },
        { value: '1.2', name: '1.2' },
        { value: '1.6', name: '1.6' },
        { value: '2.0', name: '2.0' },
        { value: '2.4', name: '2.4' },
        { value: '2.8', name: '2.8' },
        { value: '3.2', name: '3.2' },
      ],
    },
    {
      key: 'solderMask',
      label: 'PCB색상',
      options: [
        { value: 'green', name: '녹색' },
        { value: 'red', name: '빨강' },
        { value: 'yellow', name: '노랑' },
        { value: 'blue', name: '파랑' },
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'silkscreen',
      label: '실크색상',
      options: [
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'hasl', name: 'HASL(lead)' },
        { value: 'haslLf', name: 'HASL(free)' },
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
        { value: 'hardGold', name: 'Hard Gold' },
        { value: 'ag', name: 'Ag' },
      ],
    },
    {
      key: 'copperWeights',
      label: '동박두께',
      options: [
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '3oz', name: '3' },
        { value: '4oz', name: '4' },
        { value: '5oz', name: '5' },
        { value: '6oz', name: '6' },
      ],
    },
    {
      key: 'finishedCopperAdvance',
      label: '내부동박두께',
      options: [
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '3oz', name: '3' },
        { value: '4oz', name: '4' },
        { value: '5oz', name: '5' },
        { value: '6oz', name: '6' },
      ],
    },
    {
      key: 'minTraceSpacing',
      label: '최소트랙간격',
      options: [
        { value: '3/3mil', name: '3/3mil' },
        { value: '4/4mil', name: '4/4mil' },
        { value: '5/5mil', name: '5/5mil' },
        { value: '6/6mil', name: '6/6mil' },
        { value: '8/8mil', name: '8/8mil' },
      ],
    },
    {
      key: 'minHole',
      label: '최소홀크기',
      options: [
        { value: '0.15mm', name: '0.15mm' },
        { value: '0.2mm', name: '0.2mm' },
        { value: '0.25mm', name: '0.25mm' },
        { value: '0.3mm', name: '0.3mm' },
        { value: 'none', name: 'none' },
      ],
    },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'differentDesign',
      label: '여러디자인',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'impedance',
      label: '임피던스',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'viaProcess',
      label: 'VIA가공',
      options: [
        { value: 'Tenting vias', name: 'Tenting' },
        { value: 'Plugged vias', name: 'Plugged' },
        { value: 'Not Covered', name: 'Not Covered' },
        { value: 'Buried', name: 'Buried' },
        { value: 'Blind', name: 'Blind' },
      ],
    },
    {
      key: 'etest',
      label: 'E-Test',
      options: [
        { value: '프로브', name: '프로브' },
        { value: 'BBT', name: 'BBT' },
        { value: 'No', name: 'No' },
      ],
    },
    {
      key: 'cutting',
      label: '컷팅',
      options: [
        { value: 'V-Cut', name: 'V-Cut' },
        { value: 'Tap Route', name: 'Tap Route' },
        { value: 'Both', name: 'Both' },
      ],
    },
  ],
  sampleStandard: [
    { key: 'kindPcb', label: 'PCB선택', options: [{ value: 'FR-4', name: 'FR-4' }] },
    { key: 'material', label: 'PCB재료', options: [{ value: 'TG130', name: 'TG130-140' }] },
    {
      key: 'layers',
      label: 'PCB층수',
      options: [
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
        { value: '0.5oz', name: '0.5' },
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
      ],
    },
    { key: 'width', label: '가로', options: [] },
    { key: 'length', label: '세로', options: [] },
    { key: 'qty', label: '수량', options: [] },
    {
      key: 'panel',
      label: '배열',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    {
      key: 'edgeRail',
      label: '자삽바',
      options: [
        { value: 'no', name: 'No' },
        { value: '5mm', name: '5mm' },
        { value: '7mm', name: '7mm' },
      ],
    },
    {
      key: 'pcbThickness',
      label: 'PCB두께',
      options: [
        { value: '0.8', name: '0.8' },
        { value: '1.0', name: '1.0' },
        { value: '1.2', name: '1.2' },
        { value: '1.6', name: '1.6' },
        { value: '2.0', name: '2.0' },
      ],
    },
    {
      key: 'solderMask',
      label: 'PCB색상',
      options: [
        { value: 'green', name: '녹색' },
        { value: 'red', name: '빨강' },
        { value: 'yellow', name: '노랑' },
        { value: 'blue', name: '파랑' },
        { value: 'white', name: '흰색' },
        { value: 'black', name: '검정' },
      ],
    },
    {
      key: 'silkscreen',
      label: '실크색상',
      options: [
        { value: 'white', name: '흰색' },
        { value: 'Black', name: '검정' },
      ],
    },
    {
      key: 'surfaceFinish',
      label: '표면마감',
      options: [
        { value: 'hasl', name: 'HASL(lead)' },
        { value: 'haslLf', name: 'HASL(free)' },
        { value: 'enig', name: 'ENIG' },
        { value: 'osp', name: 'OSP' },
      ],
    },
    {
      key: 'copperWeights',
      label: '동박두께',
      options: [
        { value: '0.5oz', name: '0.5' },
        { value: '1oz', name: '1' },
        { value: '2oz', name: '2' },
      ],
    },
    {
      key: 'finishedCopperAdvance',
      label: '내부동박두께',
      options: [
        { value: '0.5oz', name: '0.5OZ' },
        { value: '1oz', name: '1OZ' },
        { value: '2oz', name: '2OZ' },
      ],
    },
    {
      key: 'minTraceSpacing',
      label: '패턴폭/간격',
      options: [
        { value: '5/5mil', name: '5/5 mil' },
        { value: '6/6mil', name: '6/6 mil' },
        { value: '8/8mil', name: '8/8 mil' },
      ],
    },
    {
      key: 'minHole',
      label: '최소홀크기',
      options: [
        { value: '0.2mm', name: '0.2mm' },
        { value: '0.25mm', name: '0.25mm' },
        { value: '0.3mm', name: '0.3mm' },
      ],
    },
    {
      key: 'goldFingers',
      label: '골드핑거',
      options: [
        { value: 'no', name: 'No' },
        { value: 'yes', name: 'Yes' },
      ],
    },
    { key: 'differentDesign', label: '파일갯수', options: [] },
    { key: 'viaProcess', label: 'VIA가공', options: [{ value: 'Tenting vias', name: 'Tenting' }] },
    {
      key: 'halfHole',
      label: '반홀가공',
      options: [
        { value: 'yes', name: 'Yes' },
        { value: 'no', name: 'No' },
      ],
    },
    { key: 'etest', label: 'E-Test', options: [{ value: 'Flying', name: 'Flying' }] },
    {
      key: 'cutting',
      label: '컷팅',
      options: [
        { value: 'Single', name: 'Single' },
        { value: 'V-Cut', name: 'V-Cut' },
        { value: 'Tap Route', name: 'Tap Route' },
        { value: 'Both', name: 'Both' },
      ],
    },
  ],
};

/** 선택지 표시명 — 저장값(소문자)과 표시명 둘 다 키로 넣어 레거시 표기도 받아준다.
 *  ⚠ 사전에 없는 값은 **원문 그대로** 남긴다. 실측상 differentDesign(파일 개수 숫자)·
 *  size(스텐실 직접입력)·panel(1x2 등 배열)은 자유 입력이 섞여 있어, 억지로 매핑하면 값이 뒤바뀐다. */
const VALUE_LABELS: Record<string, Record<string, string>> = {
  kindPcb: {
    fpcb: 'FPCB',
    'rigid-flex': 'Rigid-Flex',
    'fr-4': 'FR-4',
    metal: 'METAL',
    rogers: 'ROGERS',
  },
  material: {
    polyamide: 'POLYAMIDE',
    tg150: 'TG150-160',
    'tg150-160': 'TG150-160',
    tg170: 'TG170-180',
    'tg170-180': 'TG170-180',
    '알루미늄(1w)': '알루미늄(1W)',
    '알루미늄(2w)': '알루미늄(2W)',
    steel: 'Steel',
    bronze: 'Bronze',
    '4003c': '4003C',
    '4350b': '4350B',
    직접입력: '직접입력',
    tg130: 'TG130-140',
    'tg130-140': 'TG130-140',
  },
  layers: {
    '1': '1',
    '2': '2',
    '4': '4',
    '6': '6',
    '8': '8',
    '10': '10',
    '1oz': '1',
    '2oz': '2',
    '0.5oz': '0.5',
    '0.5': '0.5',
  },
  panel: {
    no: 'No',
    yes: 'Yes',
    고객사제공: '고객사제공',
  },
  edgeRail: {
    no: 'No',
    '5mm': '5mm',
    '7mm': '7mm',
    '10mm': '10mm',
    고객데이터: '고객데이터',
  },
  pcbThickness: {
    '0.08': '0.08',
    '0.1': '0.1',
    '0.13': '0.13',
    '0.15': '0.15',
    '0.22': '0.22',
    '0.6': '0.6',
    '0.8': '0.8',
    '1.0': '1.0',
    '1.2': '1.2',
    '1.6': '1.6',
    '2.0': '2.0',
    '0.2': '0.2',
    '0.4': '0.4',
    '2.4': '2.4',
    '2.8': '2.8',
    '3.2': '3.2',
  },
  solderMask: {
    yellow: '노랑',
    노랑: '노랑',
    white: '흰색',
    흰색: '흰색',
    black: '검정',
    검정: '검정',
    green: '녹색',
    녹색: '녹색',
    red: '빨강',
    빨강: '빨강',
    blue: '파랑',
    파랑: '파랑',
    유광검정: '유광검정',
    matteblack: '무광검정',
    무광검정: '무광검정',
  },
  silkscreen: {
    black: '검정',
    검정: '검정',
    white: '흰색',
    흰색: '흰색',
  },
  minTraceSpacing: {
    '0.06mm': '0.06mm',
    '4/4mil': '4/4mil',
    '5/5mil': '5/5mil',
    '6/6mil': '6/6mil',
    '3/3mil': '3/3mil',
    '8/8mil': '8/8mil',
    '5/5 mil': '5/5 mil',
    '6/6 mil': '6/6 mil',
    '8/8 mil': '8/8 mil',
  },
  minHole: {
    '0.15mm': '0.15mm',
    '0.2mm': '0.2mm',
    '0.25mm': '0.25mm',
    '0.3mm': '0.3mm',
    none: 'none',
    '0.1mm': '0.1mm',
  },
  goldFingers: {
    no: 'No',
    yes: 'Yes',
  },
  stiffener: {
    none: 'None',
    top: 'TOP',
    bottom: 'Bottom',
    both: 'Both',
  },
  surfaceFinish: {
    enig: 'ENIG',
    osp: 'OSP',
    ag: 'AG',
    tin: 'TIN',
    hasl: 'HASL(lead)',
    'hasl(lead)': 'HASL(lead)',
    hasllf: 'HASL(free)',
    'hasl(free)': 'HASL(free)',
    hardgold: 'Hard Gold',
    'hard gold': 'Hard Gold',
  },
  surfaceFinishWeights: {
    '1u': '1U',
    '2u': '2U',
    '3u': '3U',
  },
  copperWeights: {
    '1': '1',
    '2': '2',
    '3': '3',
    '4': '4',
    '5': '5',
    '6': '6',
    '0.5oz': '0.5OZ',
    '1oz': '1OZ',
    '1/3oz': '1/3',
    '1/3': '1/3',
    '1/2oz': '1/2',
    '1/2': '1/2',
    '2oz': '2',
    '3oz': '3',
    '4oz': '4',
    '5oz': '5',
    '6oz': '6',
    '~12oz': '~12',
    '~12': '~12',
    '0.5': '0.5',
  },
  finishedCopperAdvance: {
    '1': '1',
    '2': '2',
    '3': '3',
    '4': '4',
    '5': '5',
    '6': '6',
    '1oz': '1OZ',
    '1.5oz': '1.5OZ',
    '2oz': '2OZ',
    '1/3oz': '1/3',
    '1/3': '1/3',
    '1/2oz': '1/2',
    '1/2': '1/2',
    '3oz': '3',
    '4oz': '4',
    '5oz': '5',
    '6oz': '6',
    '~12oz': '~12',
    '~12': '~12',
    '0.5oz': '0.5OZ',
  },
  tape3m: {
    none: 'None',
    top: 'Top',
    bottom: 'Bottom',
    both: 'Both',
  },
  etest: {
    프로브: '프로브',
    bbt: 'BBT',
    no: 'No',
    flying: 'Flying',
  },
  impedance: {
    '50': '50Ω',
    '90': '90Ω',
    '100': '100Ω',
    '50ω': '50Ω',
    '90ω': '90Ω',
    '100ω': '100Ω',
    none: 'No',
    no: 'No',
    yes: 'Yes',
  },
  halfHole: {
    yes: 'Yes',
    no: 'No',
  },
  layersRigid: {
    '1': '1',
    '2': '2',
    '4': '4',
    '6': '6',
    '8': '8',
    '10': '10',
  },
  mat: {
    '폴리아미드+fr4': '폴리아미드+FR4',
  },
  viaProcess: {
    'tenting vias': 'Tenting',
    tenting: 'Tenting',
    'plugged vias': 'Plugged',
    plugged: 'Plugged',
    'not covered': 'Not Covered',
    buried: 'Buried',
    blind: 'Blind',
    open: 'Open',
  },
  cutting: {
    'v-cut': 'V-Cut',
    'tap route': 'Tap Route',
    both: 'Both',
    single: 'Single',
  },
  wvoltage: {
    '500v': '500V',
    '1000v': '1000V',
    '1500v': '1500V',
    '3000v': '3000V',
  },
  differentDesign: {
    yes: 'Yes',
    no: 'No',
  },
  framework: {
    framework: 'Framework',
    nonframework: 'Non Framework',
    'non framework': 'Non Framework',
  },
  size: {
    '300x400': '300 x 400 mm',
    '300 x 400 mm': '300 x 400 mm',
    direct: '직접입력',
    직접입력: '직접입력',
  },
  stencilSide: {
    'top side': 'TOP',
    top: 'TOP',
    'bottom side': 'BOT',
    bot: 'BOT',
    'both side': 'BOTH',
    both: 'BOTH',
  },
  stThickness: {
    '0.05': '0.05mm',
    '0.05mm': '0.05mm',
    '0.08': '0.08mm',
    '0.08mm': '0.08mm',
    '0.10': '0.10mm',
    '0.10mm': '0.10mm',
    '0.12': '0.12mm',
    '0.12mm': '0.12mm',
    '0.15': '0.15mm',
    '0.15mm': '0.15mm',
    '0.20': '0.20mm',
    '0.20mm': '0.20mm',
  },
};

/** 세트를 못 고를 때(이관분·사양 없는 카테고리) 쓰는 순서 — 전 세트의 합집합. */
export const SPEC_ROWS: { key: string; label: string }[] = [
  { key: 'kindPcb', label: 'PCB선택' },
  { key: 'material', label: 'PCB재료' },
  { key: 'layers', label: 'PCB층수' },
  { key: 'size-composite', label: '크기' },
  { key: 'qty', label: '수량' },
  { key: 'panel', label: '배열' },
  { key: 'edgeRail', label: '자삽바' },
  { key: 'pcbThickness', label: 'PCB두께' },
  { key: 'solderMask', label: 'PCB색상' },
  { key: 'silkscreen', label: '실크색상' },
  { key: 'surfaceFinish', label: '표면마감' },
  { key: 'copperWeights', label: '동박두께' },
  { key: 'finishedCopperAdvance', label: '내부동박두께' },
  { key: 'minTraceSpacing', label: '최소트랙간격' },
  { key: 'minHole', label: '최소홀크기' },
  { key: 'goldFingers', label: '골드핑거' },
  { key: 'differentDesign', label: '파일갯수' },
  { key: 'viaProcess', label: 'VIA가공' },
  { key: 'halfHole', label: '반홀가공' },
  { key: 'etest', label: 'E-Test' },
  { key: 'cutting', label: '컷팅' },
  { key: 'stiffener', label: '보강판' },
  { key: 'surfaceFinishWeights', label: '표면마감두께' },
  { key: 'tape3m', label: '3M Tape' },
  { key: 'impedance', label: '임피던스' },
  { key: 'layersRigid', label: '층수' },
  { key: 'mat', label: '재료' },
  { key: 'mqty', label: '원판수량' },
  { key: 'wvoltage', label: '내전압' },
  { key: 'framework', label: '프레임제작' },
  { key: 'size', label: '스텐실크기' },
  { key: 'sizeCustom', label: '스텐실크기(직접입력)' },
  { key: 'stencilSide', label: '스텐실제작' },
  { key: 'stThickness', label: '스텐실두께' },
  { key: 'metalCore', label: '메탈코어위치' },
  { key: 'fiducial', label: '기준점표시' },
  { key: 'electroPolish', label: '전해연마' },
  { key: 'placeOfOrigin', label: '원산지' },
  { key: 'coordinate', label: '부품 좌표' },
  { key: 'thickness', label: '두께' },
];

export const PCB_SPEC_LABELS: Record<string, string> = Object.fromEntries(
  SPEC_ROWS.map((row) => [row.key, row.label]),
);

export interface PcbSpecEntry {
  key: string;
  label: string;
  /** 저장된 원문 — 협력사에 그대로 전달되는 값이라 절대 잃지 않는다. */
  value: string;
  /** 거버 화면에서 고객이 본 표시명. 사전에 없으면 원문과 같다. */
  display: string;
}

/** 거버 reducer(CHANGE_SPECIFICATION)와 같은 규칙 — kind 가 menu 보다 우선한다.
 *  메탈·로저스는 menu 가 standard 여도 Advance 세트를 쓴다(거버 switch(kind) 가 그렇다). */
export function resolvePcbSpecSet(ctx: PcbSpecContext): PcbSpecSetName | null {
  const kind = (ctx.kindPcb ?? '').trim().toLowerCase();
  const menu = (ctx.category ?? '').trim();
  const mass = (ctx.orderCategory ?? '').trim() === 'mass';
  if (menu === 'metalMask') return 'metalMask';
  if (kind === 'fpcb') return 'flexibleFPCB';
  if (kind === 'rigid-flex') return 'flexibleRigid';
  if (kind === 'metal') return mass ? 'massAdvanceMetal' : 'sampleAdvanceMetal';
  if (kind === 'rogers') return mass ? 'massAdvanceRogers' : 'sampleAdvanceRogers';
  if (kind === 'fr-4') {
    if (menu === 'standard') return mass ? 'massStandard' : 'sampleStandard';
    if (menu === 'advance') return mass ? 'massAdvanceFR4' : 'sampleAdvanceFR4';
  }
  return null;
}

/**
 * 수정 화면이 세울 칸 — **그 유형에서 거버가 실제로 물어보는 것만**.
 * 세트를 못 고르면(이관분·사양 없는 카테고리) 합집합을 낸다 — 그때는 좁힐 근거가 없다.
 * 합성행은 쓰지 않는다(크기는 가로·세로를 각각 고쳐야 한다).
 */
export function pcbSpecFormFields(ctx?: PcbSpecContext): PcbSpecField[] {
  const set = ctx === undefined ? null : resolvePcbSpecSet(ctx);
  if (set !== null) return [...SPEC_FIELDS[set]];
  const out: PcbSpecField[] = [];
  const seen = new Set<string>();
  for (const r of SPEC_ROWS) {
    for (const key of r.key === 'size-composite' ? ['width', 'length'] : [r.key]) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, label: COMMON_LABELS[key] ?? r.label, options: [] });
    }
  }
  return out;
}

/** 저장된 값이 그 유형의 선택지에 있는가 — 없으면 관리자가 손으로 적은 값이다(막지 않고 표시만 한다). */
export function isPcbSpecListedValue(field: PcbSpecField, raw: string): boolean {
  if (field.options.length === 0) return true;
  const v = raw.trim().toLowerCase();
  return field.options.some((o) => o.value.toLowerCase() === v || o.name.toLowerCase() === v);
}

/** 선택지 표시명. 사전에 없으면 원문 그대로(자유 입력 항목을 망가뜨리지 않는다). */
export function pcbSpecValueLabel(key: string, raw: string): string {
  const dict = VALUE_LABELS[key];
  if (dict === undefined) return raw;
  return dict[raw.trim().toLowerCase()] ?? raw;
}

const textOf = (v: unknown): string | null => {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/**
 * specJson → 화면에 세울 행들.
 * ctx 를 주면 그 카테고리의 거버 항목 순서·이름으로, 없으면 합집합 순서로 만든다.
 * 어느 쪽이든 **값이 있는 키는 하나도 빠지지 않는다** — 세트에 없는 키는 뒤에 붙는다.
 */
export function pcbSpecEntries(
  spec: Record<string, unknown>,
  ctx?: PcbSpecContext,
): PcbSpecEntry[] {
  const set = ctx === undefined ? null : resolvePcbSpecSet(ctx);
  const rows: SetRow[] =
    set === null ? SPEC_ROWS.map((r) => [r.key, r.label] as const) : [...SPEC_SETS[set]];

  const out: PcbSpecEntry[] = [];
  const consumed = new Set<string>();
  const width = textOf(spec.width);
  const length = textOf(spec.length);

  for (const row of rows) {
    const key = typeof row === 'string' ? row : row[0];
    const label = typeof row === 'string' ? (COMMON_LABELS[key] ?? key) : row[1];
    if (consumed.has(key)) continue;
    consumed.add(key);

    if (key === 'size-composite') {
      if (width === null || length === null) continue;
      const value = `${width} X ${length}`;
      out.push({ key, label, value, display: value });
      consumed.add('width');
      consumed.add('length');
      continue;
    }
    const value = textOf(spec[key]);
    if (value === null) continue;
    out.push({ key, label, value, display: pcbSpecValueLabel(key, value) });
  }

  // 세트 밖 키 — 정보를 잃지 않도록 뒤에 붙인다(라벨은 합집합 사전, 없으면 원키).
  for (const [key, raw] of Object.entries(spec)) {
    if (consumed.has(key) || key.startsWith('_')) continue;
    const value = textOf(raw);
    if (value === null) continue;
    out.push({
      key,
      label: PCB_SPEC_LABELS[key] ?? key,
      value,
      display: pcbSpecValueLabel(key, value),
    });
  }
  return out;
}
