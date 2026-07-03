import { z } from 'zod';

// 거버 뷰어가 보내는 spec 키 전집(camelCase 정규화 후).
// 근거: .tmp/gerber-project-migration-prompt.md 3장 매핑표 + 클라이언트 실전송 추가 키 5종.
export const KNOWN_SPEC_KEYS = [
  'length',
  'width',
  'layers',
  'pcbThickness',
  'material',
  'panel',
  'minTraceSpacing',
  'minHole',
  'solderMask',
  'silkscreen',
  'surfaceFinish',
  'viaProcess',
  'copperWeights',
  'kindPcb',
  'goldFingers',
  'finishedCopperAdvance',
  'differentDesign', // 파일 개수 — 레거시 DB EAV(it_25 subj)의 'diffDesign' 은 별칭으로만 취급
  'impedance',
  'etest',
  'halfHole',
  'stiffener',
  'tape3m',
  'framework',
  'stencilSide',
  'stThickness',
  'fiducial',
  'electroPolish',
  'metalCore',
  'edgeRail',
  'placeOfOrigin',
  'coordinate',
  'size',
  'sizeCustom',
  'cutting',
  'mqty',
  // 레거시 it_N 슬롯이 없던 클라이언트 실전송 키
  'layersRigid',
  'mat',
  'surfaceFinishWeights',
  'wvoltage',
] as const;

// 값은 자유 텍스트가 많아(단위 혼재, "4type Merge" 등) 파싱하지 않고 문자열로 받는다.
// 숫자로 오는 값도 허용(어댑터가 원본 그대로 보내는 경우).
const SpecValue = z.union([z.string(), z.number()]);

// 알려진 키는 열거하되, 미지 키도 수신은 허용(catchall) — 스텁이 unknownSpecKeys 로 보고해
// 계약 위반을 "차단"이 아니라 "발견"하기 위함. 본 구현 전환 시 strict 여부 재결정.
export const PcbProjectSpec = z
  .object(
    Object.fromEntries(
      KNOWN_SPEC_KEYS.map((key) => [key, SpecValue.optional()]),
    ) as Record<(typeof KNOWN_SPEC_KEYS)[number], z.ZodOptional<typeof SpecValue>>,
  )
  .catchall(SpecValue);
export type PcbProjectSpecType = z.infer<typeof PcbProjectSpec>;

// multipart 의 payload 파트(JSON 문자열) 계약.
// category = 제품군(구 state.menu), orderCategory = 샘플/양산(구 state.category) — 스왑 주의.
export const PcbProjectPayload = z.object({
  flow: z.enum(['order', 'rfq']),
  projectName: z.string().min(1),
  category: z.string().min(1),
  orderCategory: z.enum(['sample', 'mass']),
  qty: z.number().int().positive(),
  message: z.string(),
  spec: PcbProjectSpec,
});
export type PcbProjectPayloadType = z.infer<typeof PcbProjectPayload>;

// ── 견적관리(/quotes, sp-php) 목록·액션 계약 ────────────────────────────────
// cartState 는 저장하지 않는 파생 상태(HANDOFF 3장): ct_id → g5_shop_cart 조인.
export const PcbProjectListItem = z.object({
  projectId: z.number(),
  quoteId: z.string(),
  projectName: z.string(),
  category: z.string(),
  orderCategory: z.enum(['sample', 'mass']),
  qty: z.number(),
  optionSummary: z.string(), // cart 의 ct_option 과 같은 사양 요약 문자열 — 두 화면 표기 통일용
  message: z.string().nullable(),
  quoteStatus: z.enum(['priced', 'rfq', 'quoted']),
  price: z.number().nullable(), // finalPrice(관리자 확정) ?? autoPrice ?? null
  eta: z.string().nullable(),
  cartState: z.enum(['none', 'cart', 'ordered']), // none=견적 보관, cart=담김('쇼핑'), ordered=주문됨
  createdAt: z.string(), // ISO
});
export type PcbProjectListItemType = z.infer<typeof PcbProjectListItem>;

export const PcbProjectListResponse = z.object({
  result: z.literal(true),
  data: z.object({ items: z.array(PcbProjectListItem) }),
});
export type PcbProjectListResponseType = z.infer<typeof PcbProjectListResponse>;

// [주문하기] — 확정가/자동견적가 있는 프로젝트를 장바구니에 담는다.
export const PcbProjectCartAddResponse = z.object({
  result: z.literal(true),
  data: z.object({ ctId: z.number(), redirectUrl: z.string() }),
});
export type PcbProjectCartAddResponseType = z.infer<typeof PcbProjectCartAddResponse>;

// [바로 주문] — 선택 프로젝트들을 담고(ct_select 행 단위 선택) 주문서로 직행.
// 코어 cartupdate act=buy 는 it_id 단위 선택이라 공유 템플릿에서 부정확 → sp-node 가 수행.
export const PcbProjectOrderRequest = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});
export type PcbProjectOrderRequestType = z.infer<typeof PcbProjectOrderRequest>;

export const PcbProjectOrderResponse = z.object({
  result: z.literal(true),
  data: z.object({
    orderedCtIds: z.array(z.number()),
    redirectUrl: z.string(), // /shop/orderform.php
    // 일부 실패 시에만 존재 — projectId 별 실패 사유 코드
    failed: z.array(z.object({ projectId: z.number(), error: z.string() })).optional(),
  }),
});
export type PcbProjectOrderResponseType = z.infer<typeof PcbProjectOrderResponse>;

// 수량 수정 — 서버 재견적(가격은 항상 서버 계산). 관리자 확정(quoted)·담김 상태는 거부.
export const PcbProjectQtyPatch = z.object({ qty: z.number().int().positive() });
export type PcbProjectQtyPatchType = z.infer<typeof PcbProjectQtyPatch>;

export const PcbProjectQtyPatchResponse = z.object({
  result: z.literal(true),
  data: z.object({
    qty: z.number(),
    quoteId: z.string(), // 재견적으로 새 quoteId 발급
    quoteStatus: z.enum(['priced', 'rfq']),
    price: z.number().nullable(),
    eta: z.string().nullable(),
  }),
});
export type PcbProjectQtyPatchResponseType = z.infer<typeof PcbProjectQtyPatchResponse>;

// 삭제 — 소프트(status='deleted'). 보관함("지난 견적")에서 재견적 가능, 파일 보존.
export const PcbProjectDeleteResponse = z.object({
  result: z.literal(true),
  data: z.object({
    projectId: z.number(),
    status: z.literal('deleted'),
  }),
});
export type PcbProjectDeleteResponseType = z.infer<typeof PcbProjectDeleteResponse>;

export const PcbProjectCreateResponse = z.object({
  result: z.literal(true),
  data: z.object({
    projectId: z.number(),
    quoteId: z.string(),
    quoteStatus: z.enum(['priced', 'rfq']),
    price: z.number().nullable(), // null = rfq(자동견적 불가/양산)
    eta: z.string(), // 'YYYY.MM.DD' 또는 ''
    cartAdded: z.boolean(),
    redirectUrl: z.string(),
    // 개발 검증용(옵션) — 어댑터가 보낸 미지 spec 키 보고
    unknownSpecKeys: z.array(z.string()).optional(),
  }),
});
export type PcbProjectCreateResponseType = z.infer<typeof PcbProjectCreateResponse>;
