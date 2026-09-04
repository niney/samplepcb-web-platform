import { Prisma } from '@prisma/client';
import type { SpDevelopEvent, SpDevelopRequest, SpFile } from '@prisma/client';
import {
  DEVELOP_EVENT_TYPES,
  DEVELOP_MILESTONE_STATUSES,
  DEVELOP_MILESTONE_TRIGGERS,
  DEVELOP_QUOTE_KINDS,
  DEVELOP_QUOTE_STATUSES,
  DEVELOP_REQUEST_STATUSES,
  DEVELOP_VAT_MODES,
} from '@sp/api-contract';
import type {
  DevelopContactType,
  DevelopEventTypeType,
  DevelopEventViewType,
  DevelopFileMetaType,
  DevelopMilestoneStatusType,
  DevelopMilestoneTriggerType,
  DevelopQuoteKindType,
  DevelopQuoteStatusType,
  DevelopRequestStatusType,
  DevelopVatModeType,
} from '@sp/api-contract';
import { toFileMeta } from './market';
import { prisma } from './prisma';

// ── 개발의뢰 공용 헬퍼(docs/DEVELOP_FLOW.md) — 회원·관리자 라우트·AI 러너가 공유 ──────────
// Prisma 컬럼은 String/Json — 계약의 리터럴 유니온으로 총함수 내로잉(마켓 lib/market.ts 관례).

// sp_file 폴리모픽 refType — 참조 테이블명 그대로.
export const REF_DEVELOP_REQUEST = 'sp_develop_request'; // attachment(참고 자료·슬롯) · diagram(교체 업로드)
export const REF_DEVELOP_EVENT = 'sp_develop_event'; // deliverable · review · comment
export const REF_DEVELOP_QUOTE = 'sp_develop_quote'; // po(발주서)

// 파일서버 serviceType — 마켓(market)과 분리된 버킷. 운영 전 수용 1회 실측.
export const DEVELOP_FILE_SERVICE_TYPE = process.env.DEVELOP_FILE_SERVICE_TYPE ?? 'develop';

// 영카트 앵커 상품(마일스톤 결제 카트행이 참조) — 정본은 g5-db 카탈로그 ㉑.
export { DEVELOP_ANCHOR_IT_ID } from './g5-db';

const narrow = <T extends string>(values: readonly T[], v: string, fallback: T): T =>
  (values as readonly string[]).includes(v) ? (v as T) : fallback;

export const asDevelopStatus = (v: string): DevelopRequestStatusType => narrow(DEVELOP_REQUEST_STATUSES, v, 'received');
export const asQuoteKind = (v: string): DevelopQuoteKindType => narrow(DEVELOP_QUOTE_KINDS, v, 'initial');
export const asQuoteStatus = (v: string): DevelopQuoteStatusType => narrow(DEVELOP_QUOTE_STATUSES, v, 'draft');
export const asVatMode = (v: string): DevelopVatModeType => narrow(DEVELOP_VAT_MODES, v, 'separate');
export const asMilestoneTrigger = (v: string): DevelopMilestoneTriggerType => narrow(DEVELOP_MILESTONE_TRIGGERS, v, 'manual');
export const asMilestoneStatus = (v: string): DevelopMilestoneStatusType => narrow(DEVELOP_MILESTONE_STATUSES, v, 'draft');
export const asEventType = (v: string): DevelopEventTypeType => narrow(DEVELOP_EVENT_TYPES, v, 'note');

export const toDevelopContact = (r: SpDevelopRequest): DevelopContactType => ({
  name: r.contactName,
  company: r.contactCompany,
  phone: r.contactPhone,
  email: r.contactEmail,
  hours: r.contactHours,
});

export const toDevelopFileMeta = (f: SpFile, locked = false): DevelopFileMetaType => ({ ...toFileMeta(f), locked });

// 이벤트 payload 는 JSON 컬럼 — 객체가 아니면 null 로(직렬화 스키마 record 통과).
const toPayload = (json: Prisma.JsonValue | null): Record<string, unknown> | null =>
  json !== null && typeof json === 'object' && !Array.isArray(json) ? json : null;

// 산출물 잠금 — payload.locked ∧ 아직 해제 안 됨(호출자가 판정) → 파일 메타 locked.
export const toDevelopEventView = (
  e: SpDevelopEvent,
  files: readonly SpFile[],
  actorName: string,
  deliverablesLocked: boolean,
): DevelopEventViewType => {
  const payload = toPayload(e.payload);
  const locked = deliverablesLocked && payload?.locked === true;
  return {
    eventId: Number(e.id),
    type: asEventType(e.type),
    byAdmin: e.byAdmin,
    actorName,
    visibleToCustomer: e.visibleToCustomer,
    title: e.title,
    body: e.body,
    payload,
    files: files.map((f) => toDevelopFileMeta(f, locked)),
    createdAt: e.createdAt.toISOString(),
  };
};

// 이벤트 파일 일괄 조회(refType=sp_develop_event) → eventId 별 묶음.
export const developEventFiles = async (eventIds: bigint[]): Promise<Map<string, SpFile[]>> => {
  const map = new Map<string, SpFile[]>();
  if (eventIds.length === 0) return map;
  const rows = await prisma.spFile.findMany({
    where: { refType: REF_DEVELOP_EVENT, refId: { in: eventIds } },
    orderBy: { id: 'asc' },
  });
  for (const f of rows) {
    const key = f.refId.toString();
    const list = map.get(key) ?? [];
    list.push(f);
    map.set(key, list);
  }
  return map;
};

// append-only 이벤트 기록 — 트랜잭션 안(tx)·밖(prisma) 어디서든.
export interface DevelopEventInput {
  type: DevelopEventTypeType;
  actorMbId: string | null;
  byAdmin: boolean;
  visibleToCustomer?: boolean;
  title: string;
  body?: string | null;
  payload?: Prisma.InputJsonValue;
}
export const addDevelopEvent = async (
  db: Prisma.TransactionClient | typeof prisma,
  requestId: bigint,
  input: DevelopEventInput,
): Promise<SpDevelopEvent> =>
  db.spDevelopEvent.create({
    data: {
      requestId,
      type: input.type,
      actorMbId: input.actorMbId,
      byAdmin: input.byAdmin,
      visibleToCustomer: input.visibleToCustomer ?? true,
      title: input.title,
      body: input.body ?? null,
      payload: input.payload ?? Prisma.DbNull,
    },
  });

// 상태 전이 — 조건부 updateMany(count==1 게이트)로 경합을 막고 이벤트를 남긴다. 0건이면 false(호출자가 409).
export const transitionDevelopStatus = async (
  requestId: bigint,
  from: readonly DevelopRequestStatusType[],
  to: DevelopRequestStatusType,
  actor: { mbId: string | null; byAdmin: boolean },
  extra: Prisma.SpDevelopRequestUpdateManyMutationInput = {},
  note: string | null = null,
): Promise<boolean> =>
  prisma.$transaction(async (tx) => {
    const res = await tx.spDevelopRequest.updateMany({
      where: { id: requestId, status: { in: [...from] } },
      data: { status: to, ...extra },
    });
    if (res.count !== 1) return false;
    await addDevelopEvent(tx, requestId, {
      type: 'status_changed',
      actorMbId: actor.mbId,
      byAdmin: actor.byAdmin,
      title: `상태가 바뀌었습니다`,
      body: note,
      payload: { to, from: [...from] },
    });
    return true;
  });

// 최종 산출물 잠금 여부 — unlocksDeliverables 마일스톤이 있고 아직 paid 가 아니면 잠김.
export const developDeliverablesLocked = async (requestId: bigint): Promise<boolean> => {
  const gate = await prisma.spDevelopMilestone.findFirst({
    where: { requestId, unlocksDeliverables: true, status: { in: ['pending', 'paid'] } },
    select: { status: true },
  });
  return gate !== null && gate.status !== 'paid';
};

// 이벤트 파일 다운로드 가드(고객) — 비공개 이벤트·잠긴 산출물은 403.
export type DevelopFileGate =
  | { ok: true }
  | { ok: false; status: 403 | 404; error: 'FORBIDDEN' | 'LOCKED_UNTIL_PAID' | 'NOT_FOUND' };

export const developEventFileGate = async (
  requestId: bigint,
  file: SpFile,
  viewerIsAdmin: boolean,
): Promise<DevelopFileGate> => {
  if (viewerIsAdmin) return { ok: true };
  const event = await prisma.spDevelopEvent.findFirst({
    where: { id: file.refId, requestId },
    select: { visibleToCustomer: true, payload: true },
  });
  if (event === null) return { ok: false, status: 404, error: 'NOT_FOUND' };
  if (!event.visibleToCustomer) return { ok: false, status: 403, error: 'FORBIDDEN' };
  if (toPayload(event.payload)?.locked === true && (await developDeliverablesLocked(requestId))) {
    return { ok: false, status: 403, error: 'LOCKED_UNTIL_PAID' };
  }
  return { ok: true };
};
