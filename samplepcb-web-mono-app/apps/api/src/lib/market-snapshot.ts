import type { SpMarketBid, SpMarketProject } from '@prisma/client';
import { z } from 'zod';
import { MarketDevReview } from '@sp/api-contract';
import {
  asBudgetRange,
  asProjectMethod,
  asRequestType,
  toCategoryCodes,
  toDevReview,
  toProjectToolCodes,
  toServiceAreaCodes,
} from './market';

const MarketRequestSnapshot = z.object({
  version: z.literal(1),
  capturedAt: z.string(),
  request: z.object({
    projectId: z.number(),
    title: z.string(),
    requestType: z.string(),
    serviceAreas: z.array(z.string()),
    categories: z.array(z.string()),
    cadTools: z.array(z.string()),
    description: z.string(),
    // AI 사전 검토서(2026-08-28) — 옛 스냅샷엔 없으므로 default(null). 옛 AI 필드
    // (diagramHtml·diagramSpec·rocMd·postings·interviewAnswers·aiGenerationMetaJson)는
    // 스키마에서 뺐다: zod 기본 strip 이라 **옛 스냅샷도 그대로 파싱된다**(계약 캡처 시각
    // 조회가 null 로 무너지지 않는다). 저장분 자체는 손대지 않는다.
    devReview: MarketDevReview.nullable().default(null),
    ndaRequired: z.boolean(),
    budgetRange: z.string(),
    startHopeDate: z.string().nullable(),
    dueHopeDate: z.string().nullable(),
    bidDeadlineAt: z.string(),
    method: z.string(),
    targetExpertId: z.number().nullable(),
  }),
  selectedBid: z.object({
    bidId: z.number(),
    expertId: z.number(),
    expertMbId: z.string(),
    amount: z.number(),
    durationDays: z.number(),
    warranty: z.string().nullable(),
    message: z.string(),
  }),
});
export type MarketRequestSnapshotType = z.infer<typeof MarketRequestSnapshot>;

export function buildMarketRequestSnapshot(
  project: SpMarketProject,
  bid: SpMarketBid,
  capturedAt: Date,
): MarketRequestSnapshotType {
  return MarketRequestSnapshot.parse({
    version: 1,
    capturedAt: capturedAt.toISOString(),
    request: {
      projectId: Number(project.id),
      title: project.title,
      requestType: asRequestType(project.requestType),
      serviceAreas: toServiceAreaCodes(project.serviceAreas),
      categories: toCategoryCodes(project.categories),
      cadTools: toProjectToolCodes(project.cadTools),
      description: project.description,
      devReview: toDevReview(project.devReview),
      ndaRequired: project.ndaRequired,
      budgetRange: asBudgetRange(project.budgetRange),
      startHopeDate: project.startHopeDate,
      dueHopeDate: project.dueHopeDate,
      bidDeadlineAt: project.bidDeadlineAt.toISOString(),
      method: asProjectMethod(project.method),
      targetExpertId: project.targetExpertId === null ? null : Number(project.targetExpertId),
    },
    selectedBid: {
      bidId: Number(bid.id),
      expertId: Number(bid.expertId),
      expertMbId: bid.mbId,
      amount: bid.amount,
      durationDays: bid.durationDays,
      warranty: bid.warranty,
      message: bid.message,
    },
  });
}

export function requestSnapshotCapturedAt(value: unknown): string | null {
  const parsed = MarketRequestSnapshot.safeParse(value);
  return parsed.success ? parsed.data.capturedAt : null;
}
