import type { SpDevelopRequest, SpFile } from '@prisma/client';
import { MARKET_ATTACHMENT_FIELD } from '@sp/api-contract';
import { REF_DEVELOP_REQUEST } from './develop';
import { downloadFromFileServer } from './file-server';
import { toAnswers, toAreaCodes } from './market';
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

const SUPPLEMENT_HEADER = '[담당자 보충 자료 — 고객 상담에서 확인한 내용]';

export const developReferenceFiles = (requestId: bigint): Promise<SpFile[]> =>
  prisma.spFile.findMany({
    where: { refType: REF_DEVELOP_REQUEST, refId: requestId, area: null, fileType: 'attachment' },
    orderBy: { id: 'asc' },
  });

// 원천 서명 — 초안이 어떤 입력으로 만들어졌는지. 파일은 내용 해시 대신 id·크기(상세 조회마다 파일서버를
// 다녀오지 않기 위해). 제목·분야·설명·답변·참고 자료·보충 메모가 바뀌면 달라진다 → stale 배지.
export const developSourceSignature = (
  r: Pick<SpDevelopRequest, 'title' | 'serviceAreas' | 'description' | 'answers' | 'aiSupplement'>,
  files: readonly Pick<SpFile, 'id' | 'size'>[],
): string =>
  hashAiInput({
    title: r.title,
    serviceAreas: toAreaCodes(r.serviceAreas),
    description: r.description,
    answers: toAnswers(r.answers),
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
      serviceAreas: toAreaCodes(request.serviceAreas),
      description: request.description,
      answers: toAnswers(request.answers),
      attachmentContext,
      attachmentFiles: files.map((f) => f.originFileName).slice(0, 20),
    },
    images: prepared.images,
    attachmentHashes: devReviewAttachmentHashes(
      present.map((f) => ({ field: MARKET_ATTACHMENT_FIELD, buffer: f.buffer })),
    ),
    signature: developSourceSignature(request, files),
  };
}
