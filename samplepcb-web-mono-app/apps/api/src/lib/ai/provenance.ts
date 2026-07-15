import { z } from 'zod';
import {
  AiDiagramRunBody,
  AiPostingsRunBody,
  AiRocRunBody,
  AiStructurizeRunBody,
  MarketPostingCards,
} from '@sp/api-contract';
import type {
  MarketAiProvenanceType,
  MarketPostingCardsType,
  MarketProjectCreatePayloadType,
} from '@sp/api-contract';
import { getAiJob, hashAiInput, hashAiText } from './jobs';
import type { AiJob } from './jobs';
import { parseDiagramSpecString } from './usecases';

const StoredArtifactMeta = z.object({
  source: z.enum(['ai', 'deterministic']),
  jobId: z.string().uuid().nullable(),
  useCase: z.string().nullable(),
  model: z.string().nullable(),
  promptVersion: z.string(),
  inputHash: z.string(),
  outputHash: z.string(),
  generatedAt: z.string(),
  invalidated: z.boolean().optional(),
});

const StoredAiGenerationMeta = z.object({
  version: z.literal(1),
  diagramSpec: StoredArtifactMeta.optional(),
  diagramHtml: StoredArtifactMeta.optional(),
  rocMd: StoredArtifactMeta.optional(),
  postings: StoredArtifactMeta.optional(),
});
export type StoredAiGenerationMetaType = z.infer<typeof StoredAiGenerationMeta>;

interface PersistedArtifacts {
  diagramSpec: string | null;
  diagramHtml: string | null;
  rocMd: string | null;
  postings: MarketPostingCardsType | null;
}

const completedOwnedJob = (
  jobId: string | undefined,
  mbId: string,
  useCase: AiJob['useCase'],
  inputHash: string,
): AiJob | null => {
  if (jobId === undefined) return null;
  const job = getAiJob(jobId);
  return job?.status === 'done' &&
    job.mbId === mbId &&
    job.useCase === useCase &&
    job.inputHash === inputHash
    ? job
    : null;
};

const aiMeta = (
  job: AiJob,
  output: string,
): z.infer<typeof StoredArtifactMeta> => ({
  source: 'ai',
  jobId: job.id,
  useCase: job.useCase,
  model: job.model,
  promptVersion: job.promptVersion,
  inputHash: job.inputHash,
  outputHash: hashAiText(output),
  generatedAt: new Date(job.finishedAt ?? job.startedAt).toISOString(),
});

const deterministicMeta = (
  input: string,
  output: string,
  generatedAt: Date,
): z.infer<typeof StoredArtifactMeta> => ({
  source: 'deterministic',
  jobId: null,
  useCase: null,
  model: null,
  promptVersion: 'diagram-spec-svg-v1',
  inputHash: hashAiText(input),
  outputHash: hashAiText(output),
  generatedAt: generatedAt.toISOString(),
});

const normalizedJobSpec = (job: AiJob): string | null => {
  if (job.json === null) return null;
  try {
    return JSON.stringify(parseDiagramSpecString(job.json));
  } catch {
    return null;
  }
};

const normalizedJobPostings = (
  job: AiJob,
  serviceAreas: readonly string[],
): string | null => {
  if (job.json === null) return null;
  try {
    const parsed = JSON.parse(job.json) as { postings?: unknown };
    const cards = MarketPostingCards.parse(parsed.postings).filter((card) =>
      serviceAreas.includes(card.serviceArea),
    );
    return cards.length > 0 ? JSON.stringify(cards) : null;
  } catch {
    return null;
  }
};

export function buildAiGenerationMeta(args: {
  mbId: string;
  payload: MarketProjectCreatePayloadType;
  artifacts: PersistedArtifacts;
  generatedAt: Date;
}): StoredAiGenerationMetaType | null {
  const { mbId, payload, artifacts, generatedAt } = args;
  const meta: StoredAiGenerationMetaType = { version: 1 };
  const answers = payload.interviewAnswers ?? [];

  if (artifacts.diagramSpec !== null) {
    const input = AiStructurizeRunBody.parse({
      title: payload.title,
      serviceAreas: payload.serviceAreas,
      categories: payload.categories,
      cadTools: payload.cadTools,
      description: payload.description,
      answers,
    });
    const job = completedOwnedJob(
      payload.aiJobIds?.structurize,
      mbId,
      'market.request-structurize',
      hashAiInput(input),
    );
    if (job !== null && normalizedJobSpec(job) === artifacts.diagramSpec) {
      meta.diagramSpec = aiMeta(job, artifacts.diagramSpec);
    }
  }

  if (artifacts.diagramHtml !== null) {
    if (artifacts.diagramSpec !== null) {
      meta.diagramHtml = deterministicMeta(
        artifacts.diagramSpec,
        artifacts.diagramHtml,
        generatedAt,
      );
    } else {
      const input = AiDiagramRunBody.parse({
        title: payload.title,
        serviceAreas: payload.serviceAreas,
        categories: payload.categories,
        cadTools: payload.cadTools,
        description: payload.description,
      });
      const job = completedOwnedJob(
        payload.aiJobIds?.legacyDiagram,
        mbId,
        'market.request-diagram',
        hashAiInput(input),
      );
      if (job?.html === artifacts.diagramHtml) {
        meta.diagramHtml = aiMeta(job, artifacts.diagramHtml);
      }
    }
  }

  const documentInput = artifacts.diagramSpec !== null
    ? {
        title: payload.title,
        serviceAreas: payload.serviceAreas,
        categories: payload.categories,
        cadTools: payload.cadTools,
        description: payload.description,
        budgetRange: payload.budgetRange,
        startHopeDate: payload.startHopeDate ?? null,
        dueHopeDate: payload.dueHopeDate ?? null,
        deadline: payload.deadline,
        method: payload.method,
        spec: artifacts.diagramSpec,
        answers,
      }
    : null;

  if (artifacts.rocMd !== null && documentInput !== null) {
    const input = AiRocRunBody.parse(documentInput);
    const job = completedOwnedJob(
      payload.aiJobIds?.roc,
      mbId,
      'market.request-roc',
      hashAiInput(input),
    );
    if (job?.md === artifacts.rocMd) meta.rocMd = aiMeta(job, artifacts.rocMd);
  }

  if (artifacts.postings !== null && documentInput !== null) {
    const input = AiPostingsRunBody.parse(documentInput);
    const job = completedOwnedJob(
      payload.aiJobIds?.postings,
      mbId,
      'market.request-postings',
      hashAiInput(input),
    );
    const output = JSON.stringify(artifacts.postings);
    if (job !== null && normalizedJobPostings(job, payload.serviceAreas) === output) {
      meta.postings = aiMeta(job, output);
    }
  }

  return Object.keys(meta).length > 1 ? meta : null;
}

const artifactProvenance = (
  value: string | null,
  meta: z.infer<typeof StoredArtifactMeta> | undefined,
): MarketAiProvenanceType['diagramSpec'] => {
  if (value === null) return null;
  if (meta === undefined) {
    return { state: 'unverified', model: null, promptVersion: null, generatedAt: null };
  }
  const modified = meta.invalidated === true || meta.outputHash !== hashAiText(value);
  return {
    state: modified
      ? 'customer-modified'
      : meta.source === 'ai'
        ? 'ai-generated'
        : 'deterministic',
    model: meta.model,
    promptVersion: meta.promptVersion,
    generatedAt: meta.generatedAt,
  };
};

export function toAiProvenance(
  stored: unknown,
  artifacts: PersistedArtifacts,
): MarketAiProvenanceType {
  const parsed = StoredAiGenerationMeta.safeParse(stored);
  const meta = parsed.success ? parsed.data : null;
  return {
    diagramSpec: artifactProvenance(artifacts.diagramSpec, meta?.diagramSpec),
    diagramHtml: artifactProvenance(artifacts.diagramHtml, meta?.diagramHtml),
    rocMd: artifactProvenance(artifacts.rocMd, meta?.rocMd),
    postings: artifactProvenance(
      artifacts.postings === null ? null : JSON.stringify(artifacts.postings),
      meta?.postings,
    ),
  };
}

export function invalidateAiGenerationMeta(stored: unknown): StoredAiGenerationMetaType | null {
  const parsed = StoredAiGenerationMeta.safeParse(stored);
  if (!parsed.success) return null;
  const invalidate = (
    entry: z.infer<typeof StoredArtifactMeta> | undefined,
  ): z.infer<typeof StoredArtifactMeta> | undefined =>
    entry === undefined ? undefined : { ...entry, invalidated: true };
  return {
    version: 1,
    ...(parsed.data.diagramSpec !== undefined
      ? { diagramSpec: invalidate(parsed.data.diagramSpec) }
      : {}),
    ...(parsed.data.diagramHtml !== undefined
      ? { diagramHtml: invalidate(parsed.data.diagramHtml) }
      : {}),
    ...(parsed.data.rocMd !== undefined ? { rocMd: invalidate(parsed.data.rocMd) } : {}),
    ...(parsed.data.postings !== undefined
      ? { postings: invalidate(parsed.data.postings) }
      : {}),
  };
}
