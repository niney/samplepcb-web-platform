import { useI18n } from 'vue-i18n';
import type { AdminOrderCartItemType } from '@sp/api-contract';
import { ApiRequestError } from '@sp/shared';
import { orderStatusSlug } from '@/admin/useAdminOrders';
import type { DaumPostcodeData } from '@/lib/useDaumPostcode';
import type { BadgeVariant } from '@/next/components/common/badge-types';

// 주문 상세 서랍(OrderDetailDrawer) 조각들이 함께 쓰는 순수 함수·작은 컴포저블 — 옛 서랍
// (components/admin/OrderDetailDrawer.vue) 안에 있던 것을 그대로 옮겼다. od_status 색은 목록과 같은
// ../order-badges.ts 한 곳에서 가져다 쓴다.

// 주문 상품의 고객 견적 상태(sp_order_spec.quoteStatus) — 라벨은 옛 i18n(admin.quotes.badge.*) 그대로.
const QUOTE_STATUS: Record<string, BadgeVariant> = {
  rfq: 'warning',
  priced: 'info',
  quoted: 'success',
};
export const quoteStatusVariant = (status: string): BadgeVariant => QUOTE_STATUS[status] ?? 'secondary';

/** od_status 라벨 — 미등록 slug 는 원문 그대로(운영 커스텀 상태). */
export function useOrderStatusLabel(): (status: string) => string {
  const { t } = useI18n();
  return (status: string): string => {
    const slug = orderStatusSlug(status);
    return slug !== null ? t(`admin.orders.status.${slug}`) : status;
  };
}

/** 에러 코드 → i18n(미등록이면 서버 message → UNKNOWN). 옛 서랍·확인 모달의 mapError 와 같다. */
export function useOrderErrorText(): (err: unknown) => string | null {
  const i18n = useI18n();
  const { t } = i18n;
  return (err: unknown): string | null => {
    if (err === null || err === undefined) return null;
    if (err instanceof ApiRequestError) {
      const code = err.payload?.error;
      if (code !== undefined && i18n.te(`admin.orders.error.${code}`)) return t(`admin.orders.error.${code}`);
      return err.payload?.message ?? t('admin.orders.error.UNKNOWN');
    }
    return t('admin.orders.error.UNKNOWN');
  };
}

/** 주소 조합("[우편] 기본 상세 참고") — 빈 조각 제외. 전부 비면 ''(화면이 '-' 처리). */
export const formatAddr = (a: { zip1: string; zip2: string; addr1: string; addr2: string; addr3: string }): string => {
  const zip = [a.zip1, a.zip2].filter((x) => x !== '').join('-');
  const rest = [a.addr1, a.addr2, a.addr3].filter((x) => x !== '').join(' ');
  return `${zip !== '' ? `[${zip}] ` : ''}${rest}`.trim();
};

/** 카트행 표시 금액 — 개별 io 가격(ioPrice>0)이 있으면 그것, 없으면 품목가(ctPrice). */
export const linePrice = (it: AdminOrderCartItemType): number => (it.ioPrice > 0 ? it.ioPrice : it.ctPrice);

/** 주소 형식 플래그 — '' 검색 미적용 · 'R' 도로명 · 'J' 지번(코어 win_zip 동일). */
export type AddrJibeon = '' | 'R' | 'J';

/** 주소 검색 결과를 주소 칸 다섯 개로 — 참고항목은 도로명일 때 법정동·건물명 조합(회원 서랍과 같은 규칙). */
export const addressFromPostcode = (
  d: DaumPostcodeData,
): { zip1: string; zip2: string; addr1: string; addr2: string; addr3: string } => {
  const isRoad = d.userSelectedType === 'R';
  let extra = '';
  if (isRoad) {
    if (d.bname !== '') extra += d.bname;
    if (d.buildingName !== '') extra += extra !== '' ? `, ${d.buildingName}` : d.buildingName;
  }
  return {
    zip1: d.zonecode.slice(0, 3),
    zip2: d.zonecode.slice(3),
    addr1: isRoad ? d.roadAddress : d.jibunAddress,
    addr2: '',
    addr3: extra !== '' ? `(${extra})` : '',
  };
};
