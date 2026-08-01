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
  // 스마트 BOM 파트너(조직) 관리 — docs/SMARTBOM_PARTNER_RFQ.md
  adminPartners: '/api/admin/partners',
  // 스마트 BOM 주문·결제(주문 축 파생 목록, D19)
  adminBomOrders: '/api/admin/bom-orders',
  // 발주·선적 횡단 워크큐(관리자 메뉴 재편 — 발주/선적·배송 메뉴)
  adminBomPos: '/api/admin/bom-pos',
  adminBomShipments: '/api/admin/bom-shipments',
  // 협력사 포털(requirePartner) — 받은 RFQ 워크큐·회신 + 받은 발주 확인(D18)
  partnerRfqs: '/api/partner/rfqs',
  partnerPos: '/api/partner/pos',
  // 재능마켓(market)
  marketExperts: '/api/market/experts',
  marketProjects: '/api/market/projects',
  marketMyProjects: '/api/market/my/projects',
  marketMyBids: '/api/market/my/bids',
  marketMyTargetedProjects: '/api/market/my/targeted-projects',
  marketSettings: '/api/market/settings',
  ai: '/api/ai',
  rndAi: '/api/rnd/ai',
  adminMarketExperts: '/api/admin/market/experts',
  adminMarketProjects: '/api/admin/market/projects',
  adminMarketContracts: '/api/admin/market/contracts',
  adminMarketFiles: '/api/admin/market/files',
  adminMarketSettings: '/api/admin/market/settings',
} as const;
