import type { SpMarketBid, SpMarketProject } from '@prisma/client';
import { z } from 'zod';
import { MarketAiInterviewAnswer, MarketPostingCards } from '@sp/api-contract';
import {
  asBudgetRange,
  asProjectMethod,
  asRequestType,
  toCategoryCodes,
  toInterviewAnswers,
  toPostings,
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
    diagramHtml: z.string().nullable(),
    diagramSpec: z.string().nullable(),
    rocMd: z.string().nullable(),
    postings: MarketPostingCards.nullable(),
    interviewAnswers: z.array(MarketAiInterviewAnswer).nullable(),
    aiGenerationMetaJson: z.string().nullable(),
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
      diagramHtml: project.diagramHtml,
      diagramSpec: project.diagramSpec,
      rocMd: project.rocMd,
      postings: toPostings(project.postings),
      interviewAnswers:
        project.interviewAnswersSharedAt !== null
          ? toInterviewAnswers(project.interviewAnswers)
          : null,
      aiGenerationMetaJson:
        project.aiGenerationMeta === null ? null : JSON.stringify(project.aiGenerationMeta),
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
