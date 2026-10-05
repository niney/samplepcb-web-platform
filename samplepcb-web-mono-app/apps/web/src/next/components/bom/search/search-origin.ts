import type { BadgeVariant } from '@/next/components/common/badge-types';

// 부품 검색 결과의 출처 — 공급사 추가 확인으로 새로 나온 것 / 기존 부품을 다시 확인한 것 / 원래 카탈로그.
// 옛 화면의 보라·파랑·회색 칸을 뜻별 Badge variant 로 옮겼다(새 발견=완료색, 최신 확인=진행색, 기존=중립).
export type SearchResultOrigin = 'supplier-new' | 'supplier-refreshed' | 'local-catalog';

export const searchOriginMeta: Record<
  SearchResultOrigin,
  { label: string; description: string; variant: BadgeVariant; textClass: string }
> = {
  'supplier-new': {
    label: '공급사 신규 발견',
    description: '이번 추가 확인으로 기존 결과에 새로 노출된 공급사 후보',
    variant: 'success',
    textClass: 'text-success',
  },
  'supplier-refreshed': {
    label: '공급사 최신 확인',
    description: '기존 부품의 공급 조건을 이번 검색에서 다시 확인함',
    variant: 'info',
    textClass: 'text-info',
  },
  'local-catalog': {
    label: '기존 카탈로그',
    description: '추가 확인 전부터 자체 카탈로그에 있던 결과',
    variant: 'secondary',
    textClass: 'text-muted-foreground',
  },
};
