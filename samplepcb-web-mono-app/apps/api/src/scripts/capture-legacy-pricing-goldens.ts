// 레거시 가격 API(samplepcb_pricing_api.php) 골든 캡처.
//
// docs/samplepcb-pricing-api-body-cases.md 의 실캡처 body 케이스 매트릭스를 라이브
// 레거시 API 에 재생(public + ?detail)해 fixture 로 저장한다. 이 fixture 가
// src/pricing/legacy-parity.test.ts 의 기대값이 된다(테스트는 오프라인).
//
// 실행: apps/api 에서 `pnpm pricing:capture` (자가서명 인증서 도메인이라 TLS 검증 끔)
//   옵션: --base <주소>   레거시 베이스 URL (기본: local-gerber)
//
// 주의: 라이브 가격표(pricing_data.json)는 관리자가 수시로 바꾼다. 캡처 fixture 는
// "캡처 시점의 표" 기준이며, 표를 재동기화(pnpm pricing:sync)했다면 반드시 재캡처한다.
// fixture 에 캡처 시점 표의 sha256 을 박아 스냅샷과의 드리프트를 패리티 테스트가 검출한다.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { base: { type: 'string', default: 'https://local-gerber.samplepcb.co.kr' } },
});
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // 로컬 개발 도메인 자가서명 인증서

const API = `${values.base}/gerber_api/samplepcb_pricing_api.php`;
const PRICING_URL = `${values.base}/gerber_api/pricing_data.json`;

type Body = Record<string, string>;

// ── 문서의 실캡처 baseline body (CNAW_PMU_R4-2.zip, 160x156, 2층) ──────────
const STD: Body = {
  ShipType: '10',
  Country: 'Korea',
  CountryCode: 'KR',
  Postalcode: '123456',
  City: 'Seoul',
  menu: 'standard',
  mm_comp: 'DHL',
  category: 'sample',
  Material: 'FR-4',
  FR4Tg: 'TG130',
  layers: '2',
  width: '160',
  length: '156',
  qty: '5',
  panel: 'No',
  edgerail: 'no',
  pcbThickness: '1.6',
  solderMask: 'green',
  silkscreen: 'white',
  surfaceFinish: 'hasl',
  copperWeights: '1oz',
  finishedCopperAdvance: '0.5oz',
  mixTrace: '6/6mil',
  minHole: '0.3mm',
  goldfingers: 'no',
  differentDesign: '1',
  viaProcess: 'Tenting vias',
  halfHole: 'no',
  etest: 'Flying',
  cutting: 'Single',
};

const MM: Body = {
  ShipType: '10',
  Country: 'Korea',
  CountryCode: 'KR',
  Postalcode: '123456',
  City: 'Seoul',
  menu: 'metalMask',
  mm_comp: 'DHL',
  category: 'sample',
  frame: 'nonFramework',
  size: '300x400',
  sizeExtra: '',
  stencilSide: 'Top Side',
  minHoleSize: '0.12',
  qty: '1',
  gb_type: 'MetalMask',
};

const omit = (body: Body, ...keys: string[]): Body =>
  Object.fromEntries(Object.entries(body).filter(([k]) => !keys.includes(k)));

interface CaseDef {
  id: string;
  note: string;
  body: Body;
}

// 문서 §단순 필드 변경 / §수량 / §배열·지삽바 / §층수 / §Mass / §Metal Mask 재현.
const CASES: CaseDef[] = [
  { id: 'std-baseline', note: '문서 baseline (160x156 2L qty5)', body: STD },
  { id: 'std-width-170', note: '크기 X 160→170', body: { ...STD, width: '170' } },
  { id: 'std-length-165', note: '크기 Y 156→165', body: { ...STD, length: '165' } },
  { id: 'std-soldermask-red', note: 'PCB색상 green→red', body: { ...STD, solderMask: 'red' } },
  { id: 'std-silkscreen-black', note: '실크색상 Black(대문자 옵션값)', body: { ...STD, silkscreen: 'Black' } },
  { id: 'std-surface-enig', note: '표면마감 hasl→enig', body: { ...STD, surfaceFinish: 'enig' } },
  { id: 'std-thickness-0.8', note: 'PCB두께 1.6→0.8', body: { ...STD, pcbThickness: '0.8' } },
  { id: 'std-copper-2oz', note: '동박두께 1oz→2oz', body: { ...STD, copperWeights: '2oz' } },
  { id: 'std-mixtrace-8-8', note: '패턴폭/간격 6/6→8/8mil', body: { ...STD, mixTrace: '8/8mil' } },
  { id: 'std-minhole-0.2', note: '최소홀 0.3→0.2mm', body: { ...STD, minHole: '0.2mm' } },
  { id: 'std-goldfingers-yes', note: '골드핑거 yes', body: { ...STD, goldfingers: 'yes' } },
  { id: 'std-halfhole-yes', note: '반홀가공 yes', body: { ...STD, halfHole: 'yes' } },
  { id: 'std-cutting-vcut', note: '컷팅 Single→V-Cut', body: { ...STD, cutting: 'V-Cut' } },
  { id: 'std-impedance-50', note: '임피던스 50 (엔트리에서 impedence 로 별칭)', body: { ...STD, impedance: '50' } },
  { id: 'std-diffdesign-3', note: '파일갯수 1→3 (개당 가산금 x2)', body: { ...STD, differentDesign: '3' } },
  { id: 'std-diffdesign-missing', note: 'differentDesign 부재 → 가격 0원(견적요청 유도)', body: omit(STD, 'differentDesign') },
  { id: 'std-qty-1', note: '수량 타이핑 중간값 1', body: { ...STD, qty: '1' } },
  { id: 'std-qty-12', note: '수량 타이핑 중간값 12', body: { ...STD, qty: '12' } },
  { id: 'std-qty-15', note: '수량 blur 보정값 15', body: { ...STD, qty: '15' } },
  { id: 'std-panel-yes', note: '배열 Yes 직후 과도기 panel="yes" (레거시 getPanel → 수량 0)', body: { ...STD, panel: 'yes', edgerail: '7mm' } },
  { id: 'std-panel-2x0', note: 'panel X만 입력된 과도기 "2x0" (수량 0)', body: { ...STD, panel: '2x0', edgerail: '7mm' } },
  { id: 'std-panel-2x3', note: 'panel 2x3 (수량 6배)', body: { ...STD, panel: '2x3', edgerail: '7mm' } },
  { id: 'std-panel-no-lower', note: '배열 되돌림 → 소문자 "no"', body: { ...STD, panel: 'no' } },
  { id: 'std-edgerail-5mm', note: '지삽바만 5mm', body: { ...STD, edgerail: '5mm' } },
  { id: 'std-layers-4', note: '층수 2→4 (hidden finishedCopperAdvance 0.5oz 포함)', body: { ...STD, layers: '4', copperWeights: '2oz' } },
  // 엔진 골든(engine.test.ts c1~c4) 동치 케이스
  { id: 'g-c1', note: 'c1: 소형 고정가 70.200x70.200 2L qty5', body: omit({ ...STD, width: '70.200', length: '70.200', cutting: '' }, 'cutting') },
  {
    id: 'g-c2',
    note: 'c2: 150x150 2L qty20 panel 2x2 옵션다수 + differentDesign 3',
    body: {
      ...STD, width: '150', length: '150', qty: '20', panel: '2x2', edgerail: 'yes',
      surfaceFinish: 'enig', solderMask: 'blue', mixTrace: '5/5mil', minHole: '0.25mm',
      halfHole: 'yes', goldfingers: 'yes', differentDesign: '3',
    },
  },
  {
    id: 'g-c3',
    note: 'c3: 4층 소형 고정가 80x90 qty5 + 내부동박 + differentDesign 2',
    body: omit(
      {
        ...STD, width: '80', length: '90', layers: '4', pcbThickness: '0.8',
        surfaceFinish: 'osp', solderMask: 'red', copperWeights: '2oz', mixTrace: '4/4mil',
        minHole: '0.2mm', finishedCopperAdvance: '2oz', differentDesign: '2',
      },
      'halfHole', 'cutting', 'edgerail',
    ),
  },
  {
    id: 'g-c4',
    note: 'c4: 6층 200x250 qty50, differentDesign 부재',
    body: omit(
      {
        ...STD, width: '200', length: '250', layers: '6', qty: '50', pcbThickness: '2.0',
        surfaceFinish: 'haslLf', copperWeights: '0.5oz', solderMask: 'white', impedance: '50',
      },
      'differentDesign', 'halfHole', 'cutting',
    ),
  },
  // Mass (문서 §Mass — qty↔mqty 상호계산 결과값 재현)
  { id: 'mass-baseline', note: 'mass baseline mqty1/qty40', body: { ...STD, category: 'mass', mqty: '1', qty: '40' } },
  { id: 'mass-qty-80', note: 'mass qty80 → mqty 2.00', body: { ...STD, category: 'mass', mqty: '2.00', qty: '80' } },
  { id: 'mass-mqty-5', note: 'mass mqty5 → qty 200', body: { ...STD, category: 'mass', mqty: '5', qty: '200' } },
  { id: 'mass-edgerail', note: 'mass mqty5 + edgerail 5mm → qty 187', body: { ...STD, category: 'mass', mqty: '5', qty: '187', edgerail: '5mm' } },
  { id: 'g-mass-rfq', note: '양산 rfq: 100x100 2L qty1000', body: { ...STD, category: 'mass', width: '100', length: '100', qty: '1000' } },
  // Metal Mask (문서 §Metal Mask)
  { id: 'mm-baseline', note: 'nonFramework 300x400 Top Side qty1', body: MM },
  { id: 'mm-framework-650x550', note: 'framework 기본 650x550', body: { ...MM, frame: 'framework', size: '650x550' } },
  { id: 'mm-framework-736x736', note: 'framework 736x736', body: { ...MM, frame: 'framework', size: '736x736' } },
  { id: 'mm-direct', note: 'nonFramework direct + sizeExtra 123x456', body: { ...MM, size: 'direct', sizeExtra: '123x456' } },
  { id: 'mm-qty-13', note: 'qty 13 (5단위 보정 없음)', body: { ...MM, qty: '13' } },
  { id: 'g-c5', note: 'c5: framework 400x320 Both Side qty2', body: { ...MM, frame: 'framework', size: '400x320', stencilSide: 'Both Side', qty: '2' } },
  { id: 'g-c6', note: 'c6: nonFramework 미지정 사이즈', body: { ...MM, size: 'customXY' } },
  // Advance / FPCB — 기록용(라이브 가격표에 메뉴 없음 → 계산 불가/하드코딩 0원 확인)
  { id: 'adv-fr4', note: 'advanceFR4 baseline (표에 메뉴 없음 — 응답 기록용)', body: { ...STD, menu: 'advanceFR4', FR4Tg: 'TG150', etest: '프로브', cutting: 'V-Cut', impedance: 'none' } },
  { id: 'adv-metal', note: 'advanceMetal (엔트리 하드코딩 0원)', body: { ...STD, menu: 'advanceMetal' } },
  { id: 'adv-rogers', note: 'advanceRogers (표에 메뉴 없음 — 응답 기록용)', body: { ...STD, menu: 'advanceRogers', differentDesign: 'no' } },
  { id: 'fpcb', note: 'flexibleFPCB (엔트리 하드코딩 0원)', body: { ...STD, menu: 'flexibleFPCB' } },
  { id: 'rigid', note: 'flexibleRigid (표에 메뉴 없음 — 응답 기록용)', body: { ...STD, menu: 'flexibleRigid', qty: '100' } },
];

// PHP Warning 이 JSON 앞에 섞여 나오는 응답(advance 계열)도 최대한 파싱한다.
const parseLoose = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    const i = text.indexOf('{"');
    if (i >= 0) {
      try {
        return JSON.parse(text.slice(i));
      } catch {
        /* fallthrough */
      }
    }
    return null;
  }
};

const call = async (body: Body, detail: boolean): Promise<{ parsed: unknown; raw: string | null }> => {
  const res = await fetch(`${API}${detail ? '?detail' : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const parsed = parseLoose(text);
  // 정상 파싱되면 raw 는 저장하지 않는다(fixture 비대화 방지). 실패 시 원문 일부 보존.
  return { parsed, raw: parsed === null ? text.slice(0, 600) : null };
};

const outPath = fileURLToPath(new URL('../pricing/__fixtures__/legacy-pricing-goldens.json', import.meta.url));

console.log(`레거시 가격 API 캡처: ${API} (${String(CASES.length)}케이스)`);
const pricingRes = await fetch(PRICING_URL);
const pricingText = await pricingRes.text();
const pricingSha = createHash('sha256').update(pricingText).digest('hex');

// 스냅샷 정합 검증 — 캡처 시점의 "정규화된 라이브 표"와 엔진 스냅샷이 같아야
// fixture 가 엔진의 유효한 골든이 된다. (다르면 pnpm pricing:sync 후 재캡처)
const snapshotPath = fileURLToPath(new URL('../pricing/pricing-data.json', import.meta.url));
const snapshotText = await readFile(snapshotPath, 'utf8');
const snapshotSha = createHash('sha256').update(snapshotText).digest('hex');
const parsedLive: unknown = JSON.parse(pricingText);
const liveNormalized = parsedLive as { menus?: Record<string, unknown>[] };
for (const menu of liveNormalized.menus ?? []) delete menu.diffDesign;
if (JSON.stringify(liveNormalized) !== snapshotText) {
  console.warn('⚠ 라이브 표(정규화 후)와 스냅샷이 다름 — pnpm pricing:sync 실행 후 재캡처 필요');
}

const captured = [];
for (const c of CASES) {
  const pub = await call(c.body, false);
  const det = await call(c.body, true);
  captured.push({
    id: c.id,
    note: c.note,
    body: c.body,
    publicData: pub.parsed,
    publicRaw: pub.raw,
    detail: det.parsed,
    detailRaw: det.raw,
  });
  const summary =
    pub.parsed !== null && typeof pub.parsed === 'object' && 'data' in pub.parsed
      ? JSON.stringify(pub.parsed.data).slice(0, 90)
      : `(파싱불가) ${(pub.raw ?? '').slice(0, 60).replaceAll('\n', ' ')}`;
  console.log(`  ${c.id}: ${summary}`);
}

// 캡처 기준일 — 레거시 calEta 는 서버(KST) 날짜 기준이므로 KST 날짜를 고정 저장한다.
const kstDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

const fixture = {
  capturedAt: new Date().toISOString(),
  capturedDateKst: kstDate,
  source: {
    api: API,
    pricingDataUrl: PRICING_URL,
    pricingDataSha256: pricingSha,
    // 캡처 당시 엔진 스냅샷(pricing-data.json)의 해시 — 패리티 테스트가 대조해
    // "표만 갈고 재캡처 안 한" 드리프트를 잡는다.
    pricingSnapshotSha256: snapshotSha,
  },
  note: 'docs/samplepcb-pricing-api-body-cases.md 케이스 매트릭스의 라이브 실측. 재생성: pnpm pricing:capture',
  cases: captured,
};
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(fixture, null, 2), 'utf8');
console.log(`\nfixture 저장: ${outPath}`);
console.log(`라이브 가격표 sha256: ${pricingSha}`);
