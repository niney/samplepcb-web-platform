import type { FastifyRequest } from 'fastify';
import type { SpFile, SpMarketProject } from '@prisma/client';
import { maskName } from '@sp/utils';
import {
  EMPTY_MARKET_TOOLS,
  MARKET_ATTACHMENT_FIELD,
  MARKET_BUDGET_RANGES,
  MARKET_CAREER_RANGES,
  MARKET_REQUEST_TYPES,
  MARKET_REGIONS,
  MARKET_TRAVEL_RANGES,
  MarketAnswers,
  MarketDevDiagram,
  MarketDevReview,
  MarketTools,
  marketSlotLabel,
  parseMarketAttachmentField,
  sortMarketAreas,
} from '@sp/api-contract';
import type {
  MarketAnswersType,
  MarketDevDiagramType,
  MarketDevDiagramViewType,
  MarketDevReviewType,
  MarketBidStatusType,
  MarketBudgetRangeType,
  MarketCareerRangeType,
  MarketExpertStatusType,
  MarketExpertTypeType,
  MarketFileMetaType,
  MarketRequestTypeType,
  MarketProjectDeadlineType,
  MarketProjectListItemType,
  MarketProjectMethodType,
  MarketProjectStatusType,
  MarketRegionType,
  MarketToolsType,
  MarketTravelRangeType,
} from '@sp/api-contract';
import { deleteFromFileServer } from './file-server';
import type { UploadTarget } from './file-server';
import { getMembersByIds } from './g5-db';
import { prisma } from './prisma';

// ── 재능마켓 공용 헬퍼 — 라우트 4파일(experts/projects/bids/admin-*)이 공유 ──
// Prisma 컬럼은 String/Json — 계약의 리터럴 유니온으로 총함수 내로잉(직렬화 실패 방지,
// admin-pcb-projects 의 asXxx 관례). 코드 사전은 @sp/api-contract MARKET_* 상수가 정본.

// sp_file 폴리모픽 refType — 참조 테이블명 그대로(기존 'sp_order_spec' 관례).
export const REF_MARKET_EXPERT = 'sp_market_expert';
export const REF_MARKET_PROJECT = 'sp_market_project';
export const REF_MARKET_CONTRACT = 'sp_market_contract'; // 계약 산출물(fileType='deliverable')

// 파일서버 serviceType — 거버(FILE_SERVICE_TYPE=gerber)와 분리된 마켓 전용 버킷.
export const MARKET_FILE_SERVICE_TYPE = process.env.MARKET_FILE_SERVICE_TYPE ?? 'market';

// 기본 수수료율(bp) — sp_market_settings 행 부재 시 폴백. 전문가측 10% 단일 공제(M-1).
// 공개(market-settings)·관리자(admin-market-settings) 두 라우트가 공유해 기본값 드리프트 방지.
export const DEFAULT_FEE_RATE_BP = 1000;

// ── 코드 내로잉(총함수) ──────────────────────────────────────────────────────

const asCode = <T extends string>(v: string, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

const asCodeOrNull = <T extends string>(v: string | null, allowed: readonly T[]): T | null =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : null;

export const asExpertType = (v: string): MarketExpertTypeType =>
  v === 'company' ? 'company' : v === 'house' ? 'house' : 'individual';

export const asExpertStatus = (v: string): MarketExpertStatusType =>
  v === 'approved' ? 'approved' : v === 'rejected' ? 'rejected' : v === 'suspended' ? 'suspended' : 'pending';

export const asProjectStatus = (v: string): MarketProjectStatusType =>
  v === 'closed'
    ? 'closed'
    : v === 'awarded'
      ? 'awarded'
      : v === 'cancelled'
        ? 'cancelled'
        : v === 'working'
          ? 'working'
          : v === 'completed'
            ? 'completed'
            : 'bidding';

export const asBidStatus = (v: string): MarketBidStatusType =>
  v === 'awarded' ? 'awarded' : v === 'rejected' ? 'rejected' : v === 'withdrawn' ? 'withdrawn' : 'submitted';

export const asRequestType = (v: string): MarketRequestTypeType =>
  asCode(v, MARKET_REQUEST_TYPES, 'individual');

export const asProjectMethod = (v: string): MarketProjectMethodType =>
  v === 'targeted' ? 'targeted' : 'open';

export const asBudgetRange = (v: string): MarketBudgetRangeType =>
  asCode(v, MARKET_BUDGET_RANGES, 'undecided');

export const asCareerRange = (v: string): MarketCareerRangeType =>
  asCode(v, MARKET_CAREER_RANGES, 'under3');

export const asRegionOrNull = (v: string | null): MarketRegionType | null =>
  asCodeOrNull(v, MARKET_REGIONS);

export const asTravelRangeOrNull = (v: string | null): MarketTravelRangeType | null =>
  asCodeOrNull(v, MARKET_TRAVEL_RANGES);

// 분야 코드 배열 — 레지스트리 순서로 정렬, 레지스트리에 없는 옛 코드는 뒤에 그대로(라벨은 "(종료)").
export const toAreaCodes = (json: unknown): string[] => {
  if (!Array.isArray(json)) return [];
  const raw = [...new Set(json.filter((v): v is string => typeof v === 'string' && v !== ''))];
  const known = sortMarketAreas(raw);
  return [...known, ...raw.filter((c) => !known.includes(c))];
};

// 희망 툴(Json) — 형태가 어긋나면 빈 값(전문가 추천).
export const toTools = (json: unknown): MarketToolsType => {
  if (json === null || json === undefined) return EMPTY_MARKET_TOOLS;
  const r = MarketTools.safeParse(json);
  return r.success ? r.data : EMPTY_MARKET_TOOLS;
};

// 질문 답변(Json) — 형태가 어긋나면 빈 배열.
export const toAnswers = (json: unknown): MarketAnswersType => {
  if (json === null || json === undefined) return [];
  const r = MarketAnswers.safeParse(json);
  return r.success ? r.data : [];
};

// AI 사전 검토서(Json 컬럼) — 형태가 어긋난 저장분은 null 로 정규화(응답 500 방지).
// 계약 스키마가 바뀌어 옛 저장분이 탈락해도 상세가 죽지 않는다.
export const toDevReview = (json: unknown): MarketDevReviewType | null => {
  if (json === null || json === undefined) return null;
  const r = MarketDevReview.safeParse(json);
  return r.success ? r.data : null;
};

// 정밀 구성도 메타(Json) — 파손이면 null(시도한 적 없음과 같게 보인다).
export const toDevDiagram = (json: unknown): MarketDevDiagramType | null => {
  if (json === null || json === undefined) return null;
  const r = MarketDevDiagram.safeParse(json);
  return r.success ? r.data : null;
};

// 상세 응답용 — 본문은 done 이고 열람 가능할 때만.
export const toDevDiagramView = (
  p: Pick<SpMarketProject, 'devDiagram' | 'devDiagramHtml'>,
  visible: boolean,
): MarketDevDiagramViewType => {
  const meta = toDevDiagram(p.devDiagram);
  return {
    meta,
    html: visible && meta?.status === 'done' ? (p.devDiagramHtml ?? null) : null,
  };
};

// ── 마감 파생(cron 없는 lazy) ────────────────────────────────────────────────

// "지금 입찰 접수 중인가"의 부정 — 읽기 응답(biddingClosed)과 쓰기 가드가 같은 식을 쓴다.
export const isBiddingClosed = (status: string, bidDeadlineAt: Date, now = new Date()): boolean =>
  status !== 'bidding' || bidDeadlineAt.getTime() <= now.getTime();

// 마감 입력(프리셋 N일 뒤 or 지정일) → 절대 시각. 지정일은 그 날 23:59:59 KST.
export const deadlineToDate = (deadline: MarketProjectDeadlineType, now = new Date()): Date =>
  'days' in deadline
    ? new Date(now.getTime() + deadline.days * 86_400_000)
    : new Date(`${deadline.date}T23:59:59+09:00`);

// ── sp_file 조각 ────────────────────────────────────────────────────────────

export const toFileMeta = (
  f: Pick<SpFile, 'id' | 'fileType' | 'originFileName' | 'size'> & Partial<Pick<SpFile, 'area' | 'slot'>>,
): MarketFileMetaType => ({
  fileId: Number(f.id),
  fileType: f.fileType ?? '',
  name: f.originFileName,
  size: Number(f.size),
  area: f.area ?? null,
  slot: f.slot ?? null,
});

// 파일 1건 삭제 — 실파일(파일서버) 먼저, 성공 시에만 DB 행 삭제(quote-delete.ts 순서
// 불변식: 반대로 하면 실패 시 pathToken 이 사라져 고아 파일이 영구히 남는다).
export const deleteMarketFile = async (file: Pick<SpFile, 'id' | 'pathToken'>): Promise<void> => {
  await deleteFromFileServer(file.pathToken);
  await prisma.spFile.delete({ where: { id: file.id } });
};

// ── 프로젝트 목록 조각(projects·bids 라우트 공유) ────────────────────────────

// withdrawn 제외 입찰 수(블라인드 공개값이자 소유자 수정 가드).
export const marketBidCounts = async (projectIds: bigint[]): Promise<Map<string, number>> => {
  if (projectIds.length === 0) return new Map();
  const rows = await prisma.spMarketBid.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projectIds }, status: { not: 'withdrawn' } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.projectId.toString(), r._count._all]));
};

// 의뢰인 표시명 — 서버가 maskName 적용(원명은 응답에 실리지 않는다). 회원 행 소실
// (탈퇴 등)이면 '회원' 폴백.
export const marketOwnerNames = async (mbIds: string[]): Promise<Map<string, string>> => {
  const unique = [...new Set(mbIds)];
  const members = await getMembersByIds(unique);
  const map = new Map<string, string>();
  for (const id of unique) {
    const masked = maskName(members.get(id)?.name ?? '');
    map.set(id, masked === '' ? '회원' : masked);
  }
  return map;
};

export const toMarketProjectListItem = (
  p: SpMarketProject,
  ownerName: string,
  bidCount: number,
  now: Date,
): MarketProjectListItemType => ({
  projectId: Number(p.id),
  title: p.title,
  requestType: asRequestType(p.requestType),
  serviceAreas: toAreaCodes(p.serviceAreas),
  tools: toTools(p.tools),
  budgetRange: asBudgetRange(p.budgetRange),
  method: asProjectMethod(p.method),
  ndaRequired: p.ndaRequired,
  hasDevReview: p.devReview !== null,
  devDiagramStatus: toDevDiagram(p.devDiagram)?.status ?? null,
  ownerName,
  bidCount,
  viewCount: p.viewCount,
  bidDeadlineAt: p.bidDeadlineAt.toISOString(),
  biddingClosed: isBiddingClosed(p.status, p.bidDeadlineAt, now),
  status: asProjectStatus(p.status),
  createdAt: p.createdAt.toISOString(),
});

// ── multipart 수신 공통(pcb-projects 관례) ──────────────────────────────────

export interface MarketReceivedFile extends UploadTarget {
  field: string;
}

// 의뢰 첨부 파트 분류 — `attachment`(일반) / `attachment:<area>:<slot>`(분야별 추가자료).
// 레지스트리에 없는 분야·슬롯, 선택하지 않은 분야의 슬롯은 invalid(라우트가 400). 다른 파트 이름
// (전문가 증빙 등)은 이 함수의 대상이 아니다 — 의뢰 라우트만 쓴다.
export interface MarketAttachmentInput extends MarketReceivedFile {
  area: string | null;
  slot: string | null;
  labeledName: string; // 추출기 헤더용 "[슬롯 라벨] 파일명" — 근거 코퍼스에 분야 표기가 남는다
}
export const splitMarketAttachments = (
  files: readonly MarketReceivedFile[],
  areas: readonly string[],
): { accepted: MarketAttachmentInput[]; invalid: string[] } => {
  const accepted: MarketAttachmentInput[] = [];
  const invalid: string[] = [];
  for (const f of files) {
    if (!f.field.startsWith(MARKET_ATTACHMENT_FIELD)) continue;
    const ref = parseMarketAttachmentField(f.field);
    if (ref === undefined || (ref !== null && !areas.includes(ref.area))) {
      invalid.push(f.field);
      continue;
    }
    accepted.push({
      ...f,
      area: ref?.area ?? null,
      slot: ref?.slot ?? null,
      labeledName: ref === null ? f.filename : `[${marketSlotLabel(ref.area, ref.slot)}] ${f.filename}`,
    });
  }
  return { accepted, invalid };
};

// FormData(파일 파트들 + 텍스트 파트들)를 수집한다. 라우트는 이 호출 **뒤에** jwtVerify 를
// 해야 한다(multipart 본문을 먼저 소비해야 하는 @fastify/multipart 제약). 텍스트 파트는
// fields 맵으로도 노출한다(계약 deliver 의 평문 note 필드 등) — rawPayload 는 관례상 'payload'
// JSON 파트의 별칭(기존 등록 라우트 호환).
export const collectMultipart = async (
  request: FastifyRequest,
): Promise<{
  files: MarketReceivedFile[];
  rawPayload: string | undefined;
  fields: Record<string, string>;
}> => {
  const files: MarketReceivedFile[] = [];
  const fields: Record<string, string> = {};
  let rawPayload: string | undefined;
  for await (const part of request.parts()) {
    if (part.type === 'file') {
      files.push({
        field: part.fieldname,
        filename: part.filename,
        mimetype: part.mimetype,
        buffer: await part.toBuffer(),
      });
    } else if (typeof part.value === 'string') {
      fields[part.fieldname] = part.value;
      if (part.fieldname === 'payload') rawPayload = part.value;
    }
  }
  return { files, rawPayload, fields };
};
