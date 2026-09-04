export const apiRoutes = {
  health: '/api/health',
  me: '/api/me',
  pcbProjects: '/api/pcb-projects',
  adminPcbProjects: '/api/admin/pcb-projects',
  adminPcbFiles: '/api/admin/pcb-files',
  adminMembers: '/api/admin/members',
  adminOrders: '/api/admin/orders',
  adminSettings: '/api/admin/settings',
  adminSlides: '/api/admin/slides',
  adminSeo: '/api/admin/seo',
  // BOM 추출 + 공급사 검색 (sp-engine 프록시)
  adminBom: '/api/admin/bom',
  // 부품 카탈로그 검색 (DB+ES)
  adminParts: '/api/admin/parts',
  // 고객 스마트 BOM 견적 (회원) — 잡 프록시 + 견적 CRUD
  bom: '/api/bom',
  // 고객 BOM 견적요청 관리자 검토
  adminBomQuotes: '/api/admin/bom-quotes',
  // 공용 파트너(조직) 관리 — BOM·PCB·부품 판매 트랙이 함께 사용
  adminPartners: '/api/admin/partners',
  // 스마트 BOM 주문·결제(주문 축 파생 목록, D19)
  adminBomOrders: '/api/admin/bom-orders',
  // 배송·완료 후 고객 문제 접수와 관리자 완료·클레임 워크큐(D37)
  adminBomClaims: '/api/admin/bom-claims',
  // 발주·선적 횡단 워크큐(관리자 메뉴 재편 — 발주/선적·배송 메뉴)
  adminBomPos: '/api/admin/bom-pos',
  adminBomShipments: '/api/admin/bom-shipments',
  adminBomReceiving: '/api/admin/bom-receiving', // 입고 스캔(D42)
  adminDigikey: '/api/admin/digikey', // DigiKey 3-legged 연결(D42)
  adminBomPackages: '/api/admin/bom-packages',
  // 협력사 포털(requirePartner) — 받은 RFQ 워크큐·회신 + 받은 발주 확인(D18)
  partnerAccess: '/api/partner/access',
  partnerRfqs: '/api/partner/rfqs',
  partnerPos: '/api/partner/pos',
  partnerShipments: '/api/partner/shipments',
  // 협력사 보유 부품(재고표 업로드·원장, docs/PARTNER_PARTS.md) — 포털 공통 영역
  partnerParts: '/api/partner/parts',
  adminPartnerParts: '/api/admin/partner-parts',
  // PCB 파트너 트랙(docs/PCB_PARTNER_TRACK.md) — 견적행 RFQ(P1)·발주 EQ(P2)
  adminPcbRfqs: '/api/admin/pcb-rfqs',
  adminPcbExchangeRate: '/api/admin/pcb-exchange-rate',
  partnerPcbRfqs: '/api/partner/pcb-rfqs',
  pcbRfqReply: '/api/pcb-rfq-reply',
  adminPcbPos: '/api/admin/pcb-pos',
  partnerPcbPos: '/api/partner/pcb-pos',
  partnerPcbRemittances: '/api/partner/pcb-remittances',
  adminPcbShipments: '/api/admin/pcb-shipments',
  adminPcbPackages: '/api/admin/pcb-packages',
  partnerPcbShipments: '/api/partner/pcb-shipments',
  adminPcbOrders: '/api/admin/pcb-orders',
  adminPcbCases: '/api/admin/pcb-cases',
  adminPcbRemittances: '/api/admin/pcb-remittances',
  adminPcbEqReviews: '/api/admin/pcb-eq-reviews',
  pcbEqReviews: '/api/pcb-eq-reviews',
  // PCB 고객 클레임(A/S 접수, P5) — 고객(주문내역 브리지)·관리자 워크큐
  pcbClaims: '/api/pcb-claims',
  adminPcbClaims: '/api/admin/pcb-claims',
  // 재능마켓(market)
  marketExperts: '/api/market/experts',
  marketProjects: '/api/market/projects',
  marketMyProjects: '/api/market/my/projects',
  marketMyBids: '/api/market/my/bids',
  marketMyTargetedProjects: '/api/market/my/targeted-projects',
  marketSettings: '/api/market/settings',
  ai: '/api/ai',
  pcbPricing: '/api/pcb-pricing',
  adminMarketExperts: '/api/admin/market/experts',
  adminMarketProjects: '/api/admin/market/projects',
  adminMarketContracts: '/api/admin/market/contracts',
  adminMarketFiles: '/api/admin/market/files',
  adminMarketSettings: '/api/admin/market/settings',
  // 개발의뢰(develop, docs/DEVELOP_FLOW.md) — 의뢰자 ↔ 샘플피씨비 직접
  developRequests: '/api/develop/requests',
  developMyRequests: '/api/develop/my/requests',
  adminDevelopRequests: '/api/admin/develop/requests',
  adminDevelopQuotes: '/api/admin/develop/quotes',
  adminDevelopMilestones: '/api/admin/develop/milestones',
  adminDevelopFiles: '/api/admin/develop/files',
  adminDevelopSettings: '/api/admin/develop/settings',
} as const;
