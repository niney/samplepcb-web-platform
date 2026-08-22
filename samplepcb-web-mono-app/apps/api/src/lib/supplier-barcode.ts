// ── 공급사 봉투 라벨 2D 바코드 파서(D42, docs/SMARTBOM_PARTNER_RFQ.md §6.35) ──────────────
// DigiKey·Mouser 봉투의 Data Matrix/QR 는 ECIA 라벨 규격(EIGP-114, ISO/IEC 15434 Format 06)
// 이라 API 없이 스캔 문자열만으로 품번·수량·주문번호·lot·date code 가 나온다.
//   헤더 "[)>" RS "06" GS · 필드 구분 GS · 종료 RS EOT(없을 수 있음)
//   식별자: P/30P 공급사 품번 · 1P MPN · Q 수량 · K 고객 주문번호 · 1K 공급사 주문번호 ·
//          10K 송장 · 11K 패킹리스트 · 4K/14K 주문 행 · 1T lot · 9D/10D date code · 4L 원산지 · 1V 제조사
//   구형 Mouser 라벨은 ">[)>06" GS 로 시작하고, Mouser 는 K 하나에 자기 판매주문번호를 넣는다.
// 스캐너는 제어문자를 그대로(HID) 주거나 ␞␝␄(U+241E/241D/2404)·<RS>/<GS>/<EOT> 같은 가시 문자열로
// 치환해 주므로 먼저 정규화한다. prisma 무접촉 순수 함수 — 단위 테스트가 전부를 덮는다.

const RS = '\x1e'; // Record Separator
const GS = '\x1d'; // Group Separator
const EOT = '\x04'; // End of Transmission

export type SupplierBarcodeSupplier = 'digikey' | 'mouser' | 'unknown';

export interface SupplierBarcodeFields {
  supplierSku: string | null; // 30P ?? P
  mpn: string | null; // 1P
  quantity: number | null; // Q
  customerOrderNo: string | null; // K
  supplierOrderNo: string | null; // 1K(Mouser 는 K 로 대신)
  invoiceNo: string | null; // 10K
  packingListNo: string | null; // 11K
  poLine: string | null; // 4K / 14K
  lotCode: string | null; // 1T
  dateCode: string | null; // 9D / 10D
  countryOfOrigin: string | null; // 4L
  manufacturer: string | null; // 1V
}

export interface ParsedSupplierBarcode {
  format: 'ecia2d';
  supplier: SupplierBarcodeSupplier;
  /** 제어문자로 정규화한 원문(박제용). */
  normalized: string;
  /** 식별자 → 값(같은 식별자가 두 번이면 마지막 값). */
  identifiers: Record<string, string>;
  fields: SupplierBarcodeFields;
}

const VISIBLE_SUBSTITUTIONS: readonly [RegExp, string][] = [
  [/\u241E/g, RS], // U+241E SYMBOL FOR RECORD SEPARATOR
  [/\u241D/g, GS], // U+241D SYMBOL FOR GROUP SEPARATOR
  [/\u2404/g, EOT], // U+2404 SYMBOL FOR END OF TRANSMISSION
  [/\u241C/g, ''], // U+241C SYMBOL FOR FILE SEPARATOR — 무시
  [/<RS>|\{RS\}|\[RS\]/gi, RS],
  [/<GS>|\{GS\}|\[GS\]/gi, GS],
  [/<EOT>|\{EOT\}|\[EOT\]/gi, EOT],
  [/\\x1e|\\u001e/gi, RS],
  [/\\x1d|\\u001d/gi, GS],
  [/\\x04|\\u0004/gi, EOT],
];

/** 스캐너가 준 문자열을 제어문자 기준으로 정규화한다(가시 치환·이스케이프·끝의 CR/LF/Tab 제거). */
export const normalizeSupplierBarcode = (raw: string): string => {
  let s = raw.replace(/^\uFEFF/, '');
  for (const [pattern, replacement] of VISIBLE_SUBSTITUTIONS) s = s.replace(pattern, replacement);
  return s.replace(/[\r\n\t ]+$/g, '').replace(/^[\r\n\t ]+/g, '');
};

const HEADERS = [`[)>${RS}06${GS}`, `>[)>06${GS}`, `[)>06${GS}`] as const;

const stripTrailer = (body: string): string => body.replace(new RegExp(`(${RS}${EOT}|${RS}|${EOT})+$`), '');

const FIELD_RE = /^(\d{0,2}[A-Z])([\s\S]*)$/;

const pick = (ids: Record<string, string>, ...keys: string[]): string | null => {
  for (const key of keys) {
    const value = ids[key];
    if (value !== undefined && value.trim() !== '') return value.trim();
  }
  return null;
};

const detectSupplier = (ids: Record<string, string>): SupplierBarcodeSupplier => {
  const p = ids.P ?? '';
  if ('30P' in ids || '20Z' in ids || '12Z' in ids || '13Z' in ids || '11Z' in ids) return 'digikey';
  if (/-ND$/i.test(p)) return 'digikey';
  if ('1V' in ids || '14K' in ids) return 'mouser';
  return 'unknown';
};

/** ECIA 2D 바코드 → 필드. ECIA 헤더가 아니면 null(LCSC JSON·TME 텍스트 등은 대상 외). */
export const parseSupplierBarcode = (raw: string): ParsedSupplierBarcode | null => {
  const normalized = normalizeSupplierBarcode(raw);
  const header = HEADERS.find((h) => normalized.startsWith(h));
  if (header === undefined) return null;
  const body = stripTrailer(normalized.slice(header.length));
  const identifiers: Record<string, string> = {};
  for (const field of body.split(GS)) {
    if (field === '') continue;
    const match = FIELD_RE.exec(field);
    if (match === null) continue;
    identifiers[match[1] ?? ''] = match[2] ?? '';
  }
  if (Object.keys(identifiers).length === 0) return null;
  const supplier = detectSupplier(identifiers);
  const qtyRaw = pick(identifiers, 'Q');
  const qty = qtyRaw === null ? NaN : Number(qtyRaw);
  const customerOrderNo = pick(identifiers, 'K');
  const supplierOrderNo = pick(identifiers, '1K') ?? (supplier === 'mouser' ? customerOrderNo : null);
  return {
    format: 'ecia2d',
    supplier,
    normalized,
    identifiers,
    fields: {
      supplierSku: pick(identifiers, '30P', 'P'),
      mpn: pick(identifiers, '1P'),
      quantity: Number.isInteger(qty) && qty > 0 ? qty : null,
      customerOrderNo,
      supplierOrderNo,
      invoiceNo: pick(identifiers, '10K'),
      packingListNo: pick(identifiers, '11K'),
      poLine: pick(identifiers, '4K', '14K'),
      lotCode: pick(identifiers, '1T'),
      dateCode: pick(identifiers, '9D', '10D'),
      countryOfOrigin: pick(identifiers, '4L'),
      manufacturer: pick(identifiers, '1V'),
    },
  };
};

/** 품번 비교용 정규화 — 대소문자·공백·하이픈 차이를 무시한다(Mouser "WR04X101 JTL" ↔ 라벨 "WR04X101JTL"). */
export const normalizePartKey = (value: string): string =>
  value.toUpperCase().replace(/[\s\-_.]/g, '');
