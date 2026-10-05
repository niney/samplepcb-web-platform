import type { BomQuoteLifecycleCodeType, BomQuoteSheetType } from '@sp/api-contract';
import type { BadgeVariant, StatusBadge } from '@/next/components/common/badge-types';
import { smartbomQuoteStatusVariant } from '@/next/components/smartbom/smartbom-badges';

// BOM 작업대 배지 사전 — 옛 화면의 색 클래스(lifecycleBadgeClass·시트 상태·견적 상태) 대신 Badge variant 로.
// 뜻은 키트와 같다: warning=기다림·주의, info=진행, success=끝남·확정, danger=문제, secondary=중립·이력.

/** 부품 수명주기 — 생산 중은 끝남(정상), NRND·비활성은 주의, 미확인은 중립, 나머지(EOL·단종)는 문제. */
export const lifecycleVariant = (code: BomQuoteLifecycleCodeType): BadgeVariant =>
  code === 'active'
    ? 'success'
    : code === 'nrnd' || code === 'inactive'
      ? 'warning'
      : code === 'unknown'
        ? 'secondary'
        : 'danger';

const SHEET_STATUS: Record<BomQuoteSheetType['status'], StatusBadge> = {
  parsed: { label: 'BOM 인식 완료', variant: 'success' },
  not_bom: { label: 'BOM 헤더 미탐', variant: 'secondary' },
  error: { label: '분석 오류', variant: 'danger' },
};

export const sheetStatusBadge = (status: BomQuoteSheetType['status']): StatusBadge => SHEET_STATUS[status];

// 견적 상태(관리자 작업대 머리) — 라벨만 작업대 말로, 색은 SmartBOM 견적 상태 사전(smartbom-badges)과 같다.
const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: '작성 중',
  requested: '견적요청 접수',
  reviewing: '담당자 검토 중',
  answered: '회신 완료',
  closed: '마감',
  canceled: '취소됨',
};

export const workbenchQuoteStatusBadge = (status: string): StatusBadge => ({
  label: QUOTE_STATUS_LABEL[status] ?? status,
  variant: smartbomQuoteStatusVariant(status),
});
