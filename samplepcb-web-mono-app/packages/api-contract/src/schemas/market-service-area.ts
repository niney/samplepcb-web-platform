import { z } from 'zod';
import type { MarketServiceAreaType } from './market';

// ── 활성 개발 분야(회로·PCB·펌웨어) ─────────────────────────────────────────
// market.ts 에서 분리한 이유는 **순환 참조 회피** 하나다: market.ts 가 검토서 스키마
// (market-dev-review.ts)를 쓰는데, 그 파일은 활성 분야 상수를 market.ts 에서 가져간다.
// 상수를 이 leaf 로 내리면 market.ts 의 재export 가 간접 바인딩이 되어 평가 순서와 무관하게
// 초기화된 값을 가리킨다(ESM 간접 export 는 원본 모듈 바인딩으로 해소). 위 type import 는
// verbatimModuleSyntax 로 완전히 지워져 런타임 의존이 남지 않는다 — 부분집합 보증만 남긴다.
// 값 사전(MARKET_SERVICE_AREAS·라벨)의 정본은 여전히 market.ts 다.

// 2026-08-28 분야 축소 — 신규 선택(의뢰 위저드·전문가 등록·필터)은 이 3종만. 전체 enum 은
// 읽기 호환(기존 데이터·라벨)으로만 남는다(docs/AI_DEV_REVIEW.md §4).
export const MARKET_ACTIVE_SERVICE_AREAS = [
  'circuit',
  'pcb',
  'firmware',
] as const satisfies readonly MarketServiceAreaType[];
export const MarketActiveServiceArea = z.enum(MARKET_ACTIVE_SERVICE_AREAS);
export type MarketActiveServiceAreaType = z.infer<typeof MarketActiveServiceArea>;
