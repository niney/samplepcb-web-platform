// 제조사 정규화 + 별칭 해소 — supplier-search-engine(normalization/matcher) 정합 이식.
// 목적: "Murata Electronics" / "muRata" / "TI" 가 같은 부품으로 묶이도록
// (mpnNorm, manufacturerNorm) upsert 키의 manufacturerNorm 을 안정화한다.

// 엔진 _CORPORATE_SUFFIXES 와 동일 — 임의 확장 금지(과도한 스트립은 다른 회사를 합쳐버린다).
const CORPORATE_SUFFIXES =
  /\b(?:incorporated|inc|corp(?:oration)?|co|company|ltd|limited|llc|plc|group|electronics?)\b/gi;

/** 엔진 normalize_manufacturer 정합: NFKC → casefold → 법인 접미 제거 → 영숫자·한글만. */
export function normalizeManufacturerName(raw: string): string {
  const text = raw.normalize('NFKC').toLowerCase().replace(CORPORATE_SUFFIXES, ' ');
  return text.replace(/[^a-z0-9가-힣]+/g, '');
}

// 엔진 _MANUFACTURER_ALIASES 이식 + 흔한 변형 소폭 보강(보수적 — 확실한 것만).
const ALIASES: Record<string, string> = {
  ti: 'texasinstruments',
  texasinstruments: 'texasinstruments',
  stmicro: 'stmicroelectronics',
  stmicroelectronics: 'stmicroelectronics',
  st: 'stmicroelectronics',
  onsemi: 'onsemi',
  onsemiconductor: 'onsemi',
  mps: 'monolithicpowersystems',
  monolithicpowersystems: 'monolithicpowersystems',
  maxim: 'maximintegrated',
  maximintegrated: 'maximintegrated',
  analogdevicesmaximintegrated: 'maximintegrated',
  yageo: 'yageo',
  muratamanufacturing: 'murata',
  murata: 'murata',
  nxpsemiconductors: 'nxp',
  nxp: 'nxp',
  infineontechnologies: 'infineon',
  infineon: 'infineon',
  microchiptechnology: 'microchip',
  microchip: 'microchip',
  adi: 'analogdevices',
  analogdevices: 'analogdevices',
};

export interface ResolvedManufacturer {
  /** 표시명 — 원문 트림(첫 발견 표기 유지). */
  name: string;
  /** upsert 키 — 정규화 + 별칭 해소. */
  norm: string;
}

export function resolveManufacturer(raw: string | null | undefined): ResolvedManufacturer {
  const name = (raw ?? '').trim();
  if (name === '') return { name: '(unknown)', norm: 'unknown' };
  const normalized = normalizeManufacturerName(name);
  if (normalized === '') return { name, norm: 'unknown' };
  return { name, norm: ALIASES[normalized] ?? normalized };
}
