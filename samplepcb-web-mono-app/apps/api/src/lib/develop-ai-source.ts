import type { SpDevelopRequest, SpFile } from '@prisma/client';
import {
  DEVELOP_CURRENT_STAGE_LABELS,
  DEVELOP_DELIVERY_FORM_LABELS,
  DEVELOP_PRIORITY_LABELS,
  DEVELOP_REGISTRY,
  DEVELOP_REQUEST_MODE_LABELS,
  DEVELOP_SOURCING_MODE_LABELS,
  DEVELOP_TARGET_STAGE_LABELS,
  MARKET_ATTACHMENT_FIELD,
  developFollowupAnswerText,
  developProductionSummary,
  developWishCode,
  developWishLabel,
  isDevelopFollowupAnswered,
} from '@sp/api-contract';
import {
  REF_DEVELOP_REQUEST,
  asDevelopCurrentStage,
  asDevelopRequestMode,
  asDevelopTargetStage,
  toDevelopAiQuestions,
  toDevelopAreaCodes,
  toDevelopProduction,
} from './develop';
import { downloadFromFileServer } from './file-server';
import { toAnswers } from './market';
import { expandAiArchives } from './ai/archive';
import { prepareAiAttachments } from './ai/attachment-extractor';
import { devReviewAttachmentHashes } from './ai/dev-review';
import type { DevReviewSource } from './ai/dev-review';
import { hashAiInput } from './ai/hash';
import { prisma } from './prisma';

// ── 개발의뢰 AI 근거 코퍼스(docs/DEVELOP_FLOW.md §6) ─────────────────────────────
// 러너(검토서·구성도)와 관리자 라우트가 같은 소스를 만든다 — 마켓 buildProjectDevReviewSourceWithImages 와
// 같은 집합(참고 자료 = area null, 슬롯 자료 제외)에 **담당자 보충 메모**(aiSupplement)가 더해진다.
// 보충 메모는 첨부 텍스트 블록으로 합류한다 — 후처리 R1/R2 의 근거 코퍼스에 들어가므로 전화 상담으로 알게 된
// 수치·품번이 "자료에 없는 값"으로 지워지지 않는다. 이 파일은 러너를 import 하지 않는다(순환 방지).
// 위저드 v2(2026-09-08): 분야·질문 레지스트리는 DEVELOP_REGISTRY(기구 분야·시스템개발 문항), 컬럼으로 옮겨간
// 프로젝트 조건(의뢰 방식·단계·희망 시기·시제품 계획)은 conditionLines 로 프롬프트·코퍼스에 합류한다.

const SUPPLEMENT_HEADER = '[담당자 보충 자료 — 고객 상담에서 확인한 내용]';

export const developReferenceFiles = (requestId: bigint): Promise<SpFile[]> =>
  prisma.spFile.findMany({
    where: { refType: REF_DEVELOP_REQUEST, refId: requestId, area: null, fileType: 'attachment' },
    orderBy: { id: 'asc' },
  });

type SourceColumns = Pick<
  SpDevelopRequest,
  | 'title'
  | 'serviceAreas'
  | 'description'
  | 'answers'
  | 'aiSupplement'
  | 'requestMode'
  | 'currentStage'
  | 'targetStage'
  | 'wishDate'
  | 'wishNote'
  | 'expertDelegate'
  | 'production'
  | 'aiQuestions'
>;

// AI 후속 질문(§7.2.2)의 답 줄 — 프롬프트 "질문 답변"과 근거 코퍼스에 합류(답한 것만).
export function developAiAnswerLines(r: Pick<SpDevelopRequest, 'aiQuestions'>): string[] {
  const stored = toDevelopAiQuestions(r.aiQuestions);
  if (stored === null) return [];
  return stored.questions.filter(isDevelopFollowupAnswered).map((q) => `- ${q.question} → ${developFollowupAnswerText(q)}`);
}

// 프로젝트 조건 줄 — 프롬프트 "■ 프로젝트 조건" 과 근거 코퍼스(R1 인용 대조)에 같은 문자열로 들어간다.
export function developConditionLines(r: SourceColumns): string[] {
  const lines: string[] = [`- 의뢰 방식 → ${DEVELOP_REQUEST_MODE_LABELS[asDevelopRequestMode(r.requestMode)]}`];
  const cur = asDevelopCurrentStage(r.currentStage);
  const tgt = asDevelopTargetStage(r.targetStage);
  if (cur !== null) lines.push(`- 현재 개발단계 → ${DEVELOP_CURRENT_STAGE_LABELS[cur]}`);
  if (tgt !== null) lines.push(`- 목표 개발단계 → ${DEVELOP_TARGET_STAGE_LABELS[tgt]}`);
  const wish = developWishLabel(r.wishDate, r.wishNote);
  if (wish !== '') lines.push(`- 희망 완료 시기 → ${wish}`);
  const production = toDevelopProduction(r.production);
  if (production !== null) {
    lines.push(`- 시제품·생산 계획 → ${developProductionSummary(production)}`);
    if (production.priority !== null) lines.push(`- 가장 중요한 우선순위 → ${DEVELOP_PRIORITY_LABELS[production.priority]}`);
    if (production.sourcing !== null) lines.push(`- 자재 조달 방식 → ${DEVELOP_SOURCING_MODE_LABELS[production.sourcing]}`);
    if (production.delivery !== null) lines.push(`- 납품 형태 → ${DEVELOP_DELIVERY_FORM_LABELS[production.delivery]}`);
  }
  if (r.expertDelegate) lines.push('- 후속 질문 → 전문가에게 맡김(기술 사양 미입력)');
  return lines;
}

// 원천 서명 — 초안이 어떤 입력으로 만들어졌는지. 파일은 내용 해시 대신 id·크기(상세 조회마다 파일서버를
// 다녀오지 않기 위해). 제목·분야·설명·답변·조건 줄·참고 자료·보충 메모가 바뀌면 달라진다 → stale 배지.
export const developSourceSignature = (r: SourceColumns, files: readonly Pick<SpFile, 'id' | 'size'>[]): string =>
  hashAiInput({
    title: r.title,
    serviceAreas: toDevelopAreaCodes(r.serviceAreas),
    description: r.description,
    answers: toAnswers(r.answers),
    conditions: developConditionLines(r),
    aiAnswers: developAiAnswerLines(r),
    files: files.map((f) => [f.id.toString(), f.size.toString()]),
    supplement: (r.aiSupplement ?? '').trim(),
  });

export interface DevelopReviewSourceBundle {
  source: DevReviewSource;
  images: string[];
  attachmentHashes: string[];
  signature: string;
}

export async function buildDevelopReviewSource(request: SpDevelopRequest): Promise<DevelopReviewSourceBundle> {
  const files = await developReferenceFiles(request.id);
  const downloaded = await Promise.all(
    files.map(async (f) => {
      const d = await downloadFromFileServer(f.pathToken);
      if (d === null) return null;
      return { buffer: d.buffer, filename: f.originFileName, mimetype: d.contentType };
    }),
  );
  const present = downloaded.filter((d): d is NonNullable<typeof d> => d !== null);
  const expanded = expandAiArchives(present);
  const prepared = await prepareAiAttachments(
    expanded.files.map((f) => ({ ...f, filename: f.displayPath })),
    { maxFiles: 50 },
  );
  const supplement = (request.aiSupplement ?? '').trim();
  const supplementBlock = supplement === '' ? '' : `${SUPPLEMENT_HEADER}\n${supplement}`;
  const attachmentContext = [prepared.context, supplementBlock].filter((s) => s !== '').join('\n\n');
  return {
    source: {
      title: request.title,
      serviceAreas: toDevelopAreaCodes(request.serviceAreas),
      description: request.description,
      answers: toAnswers(request.answers),
      attachmentContext,
      attachmentFiles: files.map((f) => f.originFileName).slice(0, 20),
      registry: DEVELOP_REGISTRY,
      conditionLines: developConditionLines(request),
      wishCode: developWishCode(request.wishDate, request.createdAt),
      extraAnswerLines: developAiAnswerLines(request),
    },
    images: prepared.images,
    attachmentHashes: devReviewAttachmentHashes(
      present.map((f) => ({ field: MARKET_ATTACHMENT_FIELD, buffer: f.buffer })),
    ),
    signature: developSourceSignature(request, files),
  };
}
