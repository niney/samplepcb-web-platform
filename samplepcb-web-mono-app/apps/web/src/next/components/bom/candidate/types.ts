import type {
  BomQuoteItemCandidatesType,
  BomQuoteSearchRequirementsBodyType,
  PartHitType,
} from '@sp/api-contract';
import type { OfferPick } from '@sp/utils';

// 후보 서랍(CandidateDrawer)의 공개 API — 옛 components/admin/bom/BomCandidateDrawer.vue 와 같은 props·emits.
// Case 상세·확인 요청 작성·BOM 작업대 세 곳이 이 모양으로 연결한다(바꾸면 세 곳이 함께 깨진다).

export type SelectionView = 'candidates' | 'search';

export interface CandidateDrawerProps {
  open: boolean;
  context: BomQuoteItemCandidatesType | null;
  loading: boolean;
  failed: boolean;
  readOnly?: boolean;
  selecting?: boolean;
  catalogSelecting?: boolean;
  hasCatalogPart?: boolean;
  selectionError?: string;
  selectionLockedReason?: string;
  forceSelectionAllowed?: boolean;
  requirementsSaving?: boolean;
  requirementsError?: string;
  requirementsProgress?: string;
  requirementsNotice?: string;
  externalSearchRunning?: boolean;
  externalSearchError?: string;
  interactionLocked?: boolean;
  searchRefreshEnabled?: boolean;
  initialView?: SelectionView;
  searchInitialQuery?: string;
  currentPartId?: string | null;
  needed?: number;
  usdKrwRate?: number | null;
}

/** withDefaults 를 거친 props — 기본값이 있는 항목은 값이 늘 있다. */
export type ResolvedCandidateDrawerProps = Required<
  Omit<CandidateDrawerProps, 'context' | 'currentPartId' | 'usdKrwRate'>
> & {
  context: BomQuoteItemCandidatesType | null;
  currentPartId: string | null;
  usdKrwRate: number | null;
};

/* eslint-disable @typescript-eslint/unified-signatures -- defineEmits 는 이벤트마다 따로 겹친(intersection) 시그니처를 만들어,
   합친 유니온 시그니처('close' | 'catalogOffers' …)에는 대입되지 않는다. 이벤트마다 한 줄로 둬야 서랍의 emit 을 그대로 받는다. */
export interface CandidateDrawerEmit {
  (e: 'close'): void;
  (e: 'select', candidateKey: string, offerKey: string | null): void;
  (e: 'catalogSelect', part: PartHitType, pick: OfferPick | null): void;
  (e: 'catalogOffers'): void;
  (e: 'searchRequirements', requirements: BomQuoteSearchRequirementsBodyType): void;
  (e: 'externalSupplierSearch'): void;
}
/* eslint-enable @typescript-eslint/unified-signatures */

/** 상태색 — Badge·Alert·Panel 의 뜻별 변형으로 그린다(색 클래스를 직접 들고 다니지 않는다). */
export type CandidateTone = 'success' | 'warning' | 'info' | 'danger' | 'secondary' | 'outline';
