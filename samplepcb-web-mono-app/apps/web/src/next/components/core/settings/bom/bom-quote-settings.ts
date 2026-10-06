import { useQuery } from '@tanstack/vue-query';
import { apiGet } from '@sp/shared';
import { BomEstimateContactResponse, BomQuoteConfigResponse, apiRoutes } from '@sp/api-contract';
import type { BadgeVariant } from '@/next/components/common/badge-types';

// BOM 견적 탭(sp_config bom_quote) 서버 상태·표시 사전 — 옛 components/admin/BomQuoteSettingsForm.vue 가
// 컴포넌트 안에 두던 조회를 같은 경로·같은 queryKey 로 옮겼다(옛 화면과 캐시를 함께 쓴다).

export const BOM_QUOTE_SETTINGS_PATH = `${apiRoutes.adminSettings}/bom-quote`;
export const BOM_QUOTE_SETTINGS_KEY = ['admin', 'settings', 'bom-quote'] as const;
export const BOM_CONTACT_PATH = `${BOM_QUOTE_SETTINGS_PATH}/contact`;
export const BOM_CONTACT_KEY = ['admin', 'settings', 'bom-quote', 'contact'] as const;

export function useBomQuoteConfig() {
  return useQuery({
    queryKey: BOM_QUOTE_SETTINGS_KEY,
    queryFn: () => apiGet(BOM_QUOTE_SETTINGS_PATH, BomQuoteConfigResponse),
    retry: false,
  });
}

export function useBomEstimateContact() {
  return useQuery({
    queryKey: BOM_CONTACT_KEY,
    queryFn: () => apiGet(BOM_CONTACT_PATH, BomEstimateContactResponse),
    retry: false,
  });
}

export function supplierLabel(value: string): string {
  return ({ digikey: 'DigiKey', mouser: 'Mouser', unikeyic: 'UniKeyIC' } as Record<string, string>)[value] ?? value;
}

export function formatDuration(value: number | null): string {
  if (value === null) return '—';
  if (value >= 60_000) return `${(value / 60_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}분`;
  if (value >= 1_000) return `${(value / 1_000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}초`;
  return `${Math.round(value).toLocaleString('ko-KR')}ms`;
}

/** 최근 검색 실행 시각 — 월·일 시:분(옛 화면 formatDate 와 같음). */
export function formatRunDate(value: string): string {
  return new Date(value).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 검색 실행 상태 — 옛 화면 글자색(완료 초록·실패 빨강·그 밖 파랑)을 배지 뜻으로. */
export function runStatusBadge(value: string): { label: string; variant: BadgeVariant } {
  const label =
    ({ preparing: '준비', running: '검색 중', completed: '완료', failed: '실패' } as Record<string, string>)[value] ??
    value;
  return { label, variant: value === 'completed' ? 'success' : value === 'failed' ? 'danger' : 'info' };
}

export function catalogStatusLabel(value: string | null): string {
  if (value === null) return '대기';
  return (
    ({ queued: '대기', running: '동기화 중', completed: '동기화 완료', failed: '동기화 실패' } as Record<string, string>)[
      value
    ] ?? value
  );
}
