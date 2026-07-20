const UNIKEYIC_SUPPLIER = 'unikeyic';

const UNIKEYIC_PACKAGING_TRANSLATIONS: Readonly<Record<string, string>> = {
  卷带装: 'Tape & Reel',
  托盘装: 'Tray',
  管装: 'Tube',
  散装: 'Bulk',
  盒装: 'Box',
  袋装: 'Bag',
};

/**
 * UniKeyIC가 현지화된 공급 포장명을 반환하는 경우 표준 영문 표시로 바꾼다.
 * 물리 패키지는 별도 필드이므로 이 함수에서 추론하거나 치환하지 않는다.
 */
export function normalizeSupplierPackaging(
  supplier: string,
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (supplier.trim().toLocaleLowerCase() !== UNIKEYIC_SUPPLIER) return trimmed;

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const token of trimmed.split(/[,，]/u).map((item) => item.trim()).filter((item) => item !== '')) {
    const translated = UNIKEYIC_PACKAGING_TRANSLATIONS[token] ?? token;
    const key = translated.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(translated);
  }
  return normalized.join(', ') || null;
}
