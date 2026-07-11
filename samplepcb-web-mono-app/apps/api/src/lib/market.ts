import type { FastifyRequest } from 'fastify';
import type { SpFile, SpMarketProject } from '@prisma/client';
import { maskName } from '@sp/utils';
import {
  MARKET_BUDGET_RANGES,
  MARKET_CAD_TOOLS,
  MARKET_CAREER_RANGES,
  MARKET_CATEGORIES,
  MARKET_PROJECT_CAD_CODES,
  MARKET_REQUEST_TYPES,
  MARKET_REGIONS,
  MARKET_SERVICE_AREAS,
  MARKET_TRAVEL_RANGES,
} from '@sp/api-contract';
import type {
  MarketBidStatusType,
  MarketBudgetRangeType,
  MarketCadToolCodeType,
  MarketCareerRangeType,
  MarketCategoryCodeType,
  MarketExpertStatusType,
  MarketExpertTypeType,
  MarketFileMetaType,
  MarketProjectCadCodeType,
  MarketRequestTypeType,
  MarketServiceAreaType,
  MarketProjectDeadlineType,
  MarketProjectListItemType,
  MarketProjectMethodType,
  MarketProjectStatusType,
  MarketRegionType,
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

// Json 컬럼(코드 문자열 배열) → 검증된 코드 배열. 우리 라우트만 쓰는 컬럼이지만
// 미지 값은 조용히 걸러 직렬화 실패를 원천 차단한다(방어적).
const toCodeArray = <T extends string>(json: unknown, allowed: readonly T[]): T[] => {
  if (!Array.isArray(json)) return [];
  const set = new Set<string>(allowed);
  return json.filter((v): v is T => typeof v === 'string' && set.has(v));
};

export const toCategoryCodes = (json: unknown): MarketCategoryCodeType[] =>
  toCodeArray(json, MARKET_CATEGORIES);

export const toServiceAreaCodes = (json: unknown): MarketServiceAreaType[] =>
  toCodeArray(json, MARKET_SERVICE_AREAS);

export const toCadCodes = (json: unknown): MarketCadToolCodeType[] =>
  toCodeArray(json, MARKET_CAD_TOOLS);

export const toProjectCadCodes = (json: unknown): MarketProjectCadCodeType[] =>
  toCodeArray(json, MARKET_PROJECT_CAD_CODES);

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
  f: Pick<SpFile, 'id' | 'fileType' | 'originFileName' | 'size'>,
): MarketFileMetaType => ({
  fileId: Number(f.id),
  fileType: f.fileType ?? '',
  name: f.originFileName,
  size: Number(f.size),
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
  serviceAreas: toServiceAreaCodes(p.serviceAreas),
  cadTools: toProjectCadCodes(p.cadTools),
  budgetRange: asBudgetRange(p.budgetRange),
  method: asProjectMethod(p.method),
  ndaRequired: p.ndaRequired,
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
