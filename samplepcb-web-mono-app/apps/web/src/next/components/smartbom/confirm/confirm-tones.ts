import type { AdminBomConfirmIssueType } from '@sp/api-contract';
import type { BomConfirmPreviewOption } from '@/admin/bomConfirmPreview';

// 결제 후 부품 확인 요청(D43) 화면의 글자색 헬퍼 — 요청 상태 배지 색은 smartbom/smartbom-badges.ts
// (bomConfirmStatusVariant)가 정한다. 뜻: info=진행, warning=관리자 차례, success=끝남, 흐림=이력.

/** 품목(이슈) 상태 글자색 — 배지 안이 아니라 한 줄 텍스트라 토큰 글자색만. */
export const confirmIssueStatusClass = (status: AdminBomConfirmIssueType['status']): string =>
  status === 'pending'
    ? 'text-info'
    : status === 'decided'
      ? 'text-warning'
      : status === 'applied'
        ? 'text-success'
        : 'text-muted-foreground';

/** 고객 미리보기 금액 효과 글자색 — 추가결제는 고객이 더 내는 돈이라 주의, 환불은 받는 돈이라 끝남. */
export const confirmPreviewToneClass = (tone: BomConfirmPreviewOption['tone']): string =>
  tone === 'plus'
    ? 'text-destructive'
    : tone === 'minus'
      ? 'text-success'
      : tone === 'zero'
        ? 'text-muted-foreground'
        : 'text-warning';
