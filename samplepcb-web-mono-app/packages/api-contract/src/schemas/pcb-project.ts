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
  'diffDesign',
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

export const PcbProjectCreateResponse = z.object({
  result: z.literal(true),
  data: z.object({
    projectId: z.number(),
    quoteStatus: z.enum(['priced', 'rfq']),
    cartAdded: z.boolean(),
    redirectUrl: z.string(),
    // 스텁 전용 검증 리포트 — 본 구현에서 제거 예정.
    stub: z
      .object({
        dumpFile: z.string(),
        unknownSpecKeys: z.array(z.string()),
        files: z.array(
          z.object({ field: z.string(), filename: z.string(), bytes: z.number() }),
        ),
      })
      .optional(),
  }),
});
export type PcbProjectCreateResponseType = z.infer<typeof PcbProjectCreateResponse>;
