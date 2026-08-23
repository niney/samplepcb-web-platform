import type { RouteLocationRaw } from 'vue-router';
import type { PartnerModuleKey } from './partnerModule';

// 협력사 포털 사이드바 메뉴(포털 재설계 R3 — 관리자 admin/menu.ts 동형). 모듈(BOM 부품/
// PCB 제작)별 메뉴 + 모듈 밖 공통 그룹(수금 현황). label 은 i18n 키, badge 는 "지금
// 움직여야 하는 수"의 데이터 소스 식별자 — 해석은 PartnerLayout 이 한다(홈 카드와 같은
// 쿼리 캐시(usePartnerWork)를 구독하므로 카드 숫자와 배지가 어긋나지 않는다).
// 모듈 간 화면 공유 금지(관리자 D9 미러)는 그대로 — 메뉴도 모듈별로 따로 선다.

export type PartnerBadgeKey =
  /** 회신할 견적(requested) */
  | 'bomRfqsTodo'
  /** 확인할 발주(issued) */
  | 'bomPosTodo'
  /** 보낼 물건 + 준비 중 박스 + 내 차례 발송 */
  | 'bomShipTodo'
  /** 회신할 견적(requested) */
  | 'pcbRfqsTodo'
  /** 내 차례 발주(EQ·MD 하위 발주·입고 차례) */
  | 'pcbPosTodo'
  /** 선반(보낼 물건) + 준비 중 박스 */
  | 'pcbShipTodo'
  /** A/S 회신 대기 */
  | 'pcbAsTodo'
  /** 미수금이 남은 발주 수 */
  | 'unpaid';

/** 공통 영역 항목의 노출 조건 — 트랙별로 갈린다(수금=pcb, 보유 부품=parts). */
export type PartnerTrackKey = 'bom' | 'pcb' | 'parts';

export interface PartnerMenuItem {
  to: RouteLocationRaw;
  labelKey: string;
  badge?: PartnerBadgeKey;
  /** 상세 등 형제 라우트에서도 이 메뉴를 활성 표시할 라우트 이름. */
  activeRouteNames?: readonly string[];
  /** 공통 영역 전용 — 이 트랙이 있어야 노출한다. */
  requiresTrack?: PartnerTrackKey;
}

export interface PartnerModuleDef {
  key: PartnerModuleKey;
  labelKey: string;
  /** 헤더 스위처 클릭 시 이동하는 모듈 홈. */
  homeTo: RouteLocationRaw;
  menu: PartnerMenuItem[];
}

// BOM 부품 — 홈(오늘 할 일) / 견적요청 / 발주서 / 📦 보내기 / 완료된 발송.
const bomMenu: PartnerMenuItem[] = [
  { to: { name: 'partner-bom' }, labelKey: 'partner.menu.home' },
  {
    to: { name: 'partner-bom-rfqs' },
    labelKey: 'partner.menu.rfqs',
    badge: 'bomRfqsTodo',
    activeRouteNames: ['partner-bom-rfq'],
  },
  {
    to: { name: 'partner-bom-pos' },
    labelKey: 'partner.menu.pos',
    badge: 'bomPosTodo',
    activeRouteNames: ['partner-bom-po'],
  },
  { to: { name: 'partner-bom-ship' }, labelKey: 'partner.menu.ship', badge: 'bomShipTodo' },
  { to: { name: 'partner-bom-shipments-done' }, labelKey: 'partner.menu.shipmentsDone' },
];

// PCB 제작 — 홈 / 견적요청 / 발주서 / 📦 PCB 보내기 / 완료된 발송 / A/S.
const pcbMenu: PartnerMenuItem[] = [
  { to: { name: 'partner-pcb' }, labelKey: 'partner.menu.home' },
  {
    to: { name: 'partner-pcb-rfqs' },
    labelKey: 'partner.menu.rfqs',
    badge: 'pcbRfqsTodo',
    activeRouteNames: ['partner-pcb-rfq'],
  },
  {
    to: { name: 'partner-pcb-pos' },
    labelKey: 'partner.menu.pos',
    badge: 'pcbPosTodo',
    activeRouteNames: ['partner-pcb-po'],
  },
  { to: { name: 'partner-pcb-ship' }, labelKey: 'partner.menu.pcbShip', badge: 'pcbShipTodo' },
  { to: { name: 'partner-pcb-shipments-done' }, labelKey: 'partner.menu.shipmentsDone' },
  { to: { name: 'partner-pcb-as' }, labelKey: 'partner.menu.as', badge: 'pcbAsTodo' },
];

export const partnerModules: readonly PartnerModuleDef[] = [
  { key: 'bom', labelKey: 'partner.modules.bom', homeTo: { name: 'partner-bom' }, menu: bomMenu },
  { key: 'pcb', labelKey: 'partner.modules.pcb', homeTo: { name: 'partner-pcb' }, menu: pcbMenu },
];

// 공통 영역(모듈 밖) — 수금·보유 부품처럼 모듈 소속이 본질이 아닌 화면. 항목마다 노출
// 트랙이 다르므로(수금=pcb 발주 대금, 보유 부품=part_sale) 조건은 항목이 들고 셸이 건다.
export const partnerCommonMenu: PartnerMenuItem[] = [
  {
    to: { name: 'partner-remittances' },
    labelKey: 'partner.menu.remittances',
    badge: 'unpaid',
    requiresTrack: 'pcb',
  },
  {
    to: { name: 'partner-parts' },
    labelKey: 'partner.menu.parts',
    activeRouteNames: ['partner-parts-upload'],
    requiresTrack: 'parts',
  },
];

// 라우트 이름 → 소속 모듈(리졸버·공통 영역은 null). 활성 모듈 판정의 단일 진실 —
// 북마크·새로고침 진입에서도 메뉴가 어긋나지 않는다(관리자 resolveAdminModuleKey 미러).
export const resolvePartnerModuleKey = (routeName: string): PartnerModuleKey | null =>
  routeName.startsWith('partner-bom')
    ? 'bom'
    : routeName.startsWith('partner-pcb')
      ? 'pcb'
      : null;
