import { MARKET_ACTIVE_SERVICE_AREAS } from '@sp/api-contract';
import type { MarketActiveServiceAreaType, MarketServiceAreaType } from '@sp/api-contract';

// 저장값(전체 enum) → 활성 3종 부분집합.
// 계약은 **읽기**를 전체 enum 으로 열어 둔다(옛 의뢰·프로필 호환). 반면 표시 함수
// @sp/utils devReviewAreaBadge 는 활성 3종만 받으므로, 응답값을 넘기기 전에 여기서 좁힌다.
// 순서는 계약 상수 순서(회로 → PCB → 펌웨어)를 따른다.
export const toActiveServiceAreas = (
  areas: readonly MarketServiceAreaType[],
): MarketActiveServiceAreaType[] => MARKET_ACTIVE_SERVICE_AREAS.filter((a) => areas.includes(a));
