import type {
  BomQuoteLifecycleCodeType,
  BomQuoteLifecycleSummaryType,
  BomQuoteReplacementSourceType,
} from '@sp/api-contract';

const LIFECYCLE_LABELS: Record<BomQuoteLifecycleCodeType, string> = {
  active: '생산 중',
  nrnd: 'NRND',
  eol: 'EOL',
  discontinued: '판매 단종',
  obsolete: '단종',
  inactive: '비활성',
  unknown: '상태 미확인',
};

const REPLACEMENT_SOURCE_LABELS: Record<BomQuoteReplacementSourceType, string> = {
  digikey_substitution: 'DigiKey 대체품 API',
  mouser_suggested: 'Mouser 추천 대체품',
  engine_stock_fallback: '재고 부족 스펙 검색',
  engine_mpn_fallback: 'MPN 기반 탐색 후보',
};

export function lifecycleLabel(code: BomQuoteLifecycleCodeType): string {
  return LIFECYCLE_LABELS[code];
}

export function lifecycleBadgeClass(code: BomQuoteLifecycleCodeType): string {
  if (code === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-800';
  if (code === 'nrnd' || code === 'inactive') {
    return 'border-amber-300 bg-amber-100 text-amber-900';
  }
  if (code === 'unknown') return 'border-slate-200 bg-slate-100 text-slate-600';
  return 'border-red-300 bg-red-100 text-red-800';
}

export function lifecycleRequiresAttention(code: BomQuoteLifecycleCodeType): boolean {
  return code !== 'active' && code !== 'unknown';
}

export function formatLifecycleDate(value: string | null): string | null {
  if (value === null || value.trim() === '') return null;
  const normalized = value.trim();
  const isoDate = /^\d{4}-\d{2}-\d{2}/.exec(normalized)?.[0];
  return isoDate ?? normalized;
}

export function lifecycleSummaryTitle(
  summary: BomQuoteLifecycleSummaryType,
  subject: string,
): string {
  const details = [`${subject} 수명주기: ${lifecycleLabel(summary.code)}`];
  if (summary.status !== null && summary.status.trim() !== '') {
    details.push(`공급사 원문: ${summary.status.trim()}`);
  }
  const lastBuyDate = formatLifecycleDate(summary.lastBuyDate);
  if (lastBuyDate !== null) details.push(`최종 구매 가능일: ${lastBuyDate}`);
  if (summary.sources.length > 0) {
    details.push(`확인 공급사: ${summary.sources.map((source) => source.supplier).join(', ')}`);
  }
  return details.join('\n');
}

export function replacementSourcesTitle(
  sources: readonly BomQuoteReplacementSourceType[],
): string {
  const origin = sources.some((source) =>
    source === 'engine_stock_fallback' || source === 'engine_mpn_fallback')
    ? '재고 부족으로 찾은 대체 후보'
    : '공급사가 원품번의 대체 후보로 제공';
  return `${origin}: ${sources.map((source) => REPLACEMENT_SOURCE_LABELS[source]).join(', ')}\n자동 호환을 의미하지 않으며 사양 확인 후 선택해야 합니다.`;
}

export function replacementSourceBadgeLabel(
  sources: readonly BomQuoteReplacementSourceType[],
): string {
  if (sources.includes('engine_mpn_fallback')) return 'MPN 계열 후보';
  if (sources.includes('engine_stock_fallback')) return '스펙 대체 후보';
  return '공급사 제안 대체';
}

export function replacementReviewLabel(
  sources: readonly BomQuoteReplacementSourceType[],
): string {
  if (sources.includes('engine_mpn_fallback')) return 'MPN 계열 후보';
  if (sources.includes('engine_stock_fallback')) return '스펙 대체 후보';
  return '대체 후보';
}
