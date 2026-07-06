// phase 01 — 회원 도메인: g5_member + sp_member_profile + 소셜 + 포인트 원장 + 관리권한 + 주소록.
//
// 정책(계획 문서 §회원):
// - g5_member 교집합 복사, 단 여분필드 mb_1~mb_10 은 **복사하지 않는다**(여분필드 단절 —
//   내용은 sp_member_profile 명시 컬럼/legacyJson 으로 승격).
// - 충돌: 타깃에 이미 있는 mb_id(admin·kpeter)는 스킵 — 동일 mb_id 라 주문/글 참조는 정합.
// - 비밀번호: 구형 41자 해시 원문 복사(코어 login_password_check 가 첫 로그인 때 자동 재해시,
//   common.lib.php:4080-4091). 재해시가 런타임 ALTER 를 유발하지 않도록 mb_password2 를 선-ALTER.
// - 포인트 원장: 회원 단위 카운트 대조(0건→전체 삽입 / 동수→스킵 / 불일치→보고만).
import type { LegacyRow } from '../../../lib/legacy-db';
import { buildCopyPlan, rowFromLegacy } from '../lib/context';
import type { MigrateCtx } from '../lib/context';
import type { Row } from '../lib/g5-writer';
import { asInt, asStr, chunk } from '../lib/util';

const SPARE_MB_COLS = /^mb_([1-9]|10)$/; // mb_1~mb_10 — 타깃에 복사 금지(여분필드 단절)

/** mb_1 원본값 → memberType 정규화(personal/corporate/partner). 미지값은 null(원본은 legacyJson). */
export function normalizeMemberType(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === '') return null;
  if (['개인', '일반', 'normal', 'expert'].includes(v) || v === '개인회원') return 'personal';
  if (['기업', 'corporate', 'supervisor', '법인'].includes(v)) return 'corporate';
  if (['파트너', 'partner', 'business'].includes(v)) return 'partner';
  return null;
}

/** 잔여 레거시 커스텀(legacyJson 보존 대상) — 존재하는 컬럼만, 비어있지 않은 값만. */
const LEGACY_JSON_COLS = [
  'mb_1', // 정규화 전 원본
  'mb_13',
  'mb_14',
  'mb_16',
  'mb_17',
  'mb_18',
  'mb_19',
  'mb_20',
  'mb_user_bank_name',
  'mb_user_account_number',
  'mb_user_account_holder',
  'mb_company_bank_name',
  'mb_company_account_number',
  'mb_company_account_holder',
  'mb_currency', // 파트너 통화 — 기본값 'KRW'(전원)는 노이즈라 제외(P2 판정)
  'mb_sub_currency',
  'mb_country', // 파트너 국가(실정보 CN 5명)
] as const;

/** legacyJson 에서 제외할 "사실상 기본값"(정보 가치 없음 — 전 회원 일괄 세팅). */
const LEGACY_JSON_DEFAULT_VALUES: Record<string, string> = { mb_currency: 'KRW' };

interface ProfileInput {
  mbId: string;
  data: {
    memberType: string | null;
    companyName: string | null;
    bizNo: string | null;
    ceoName: string | null;
    bizType: string | null;
    bizItem: string | null;
    managerName: string | null;
    taxEmail: string | null;
    managerPhone: string | null;
    managerEmail: string | null;
    bizZip: string | null;
    bizAddr1: string | null;
    bizAddr2: string | null;
    partnerKind: string | null;
    partnerAuth: number;
    legacyJson: Record<string, string> | null;
  };
}

function nn(v: unknown): string | null {
  const s = asStr(v).trim();
  return s === '' ? null : s;
}

export function buildProfileInput(row: LegacyRow): ProfileInput | null {
  const legacyJson: Record<string, string> = {};
  for (const col of LEGACY_JSON_COLS) {
    if (!(col in row)) continue;
    const v = asStr(row[col]).trim();
    if (v === '' || LEGACY_JSON_DEFAULT_VALUES[col] === v) continue;
    legacyJson[col] = v;
  }
  const data: ProfileInput['data'] = {
    memberType: normalizeMemberType(asStr(row.mb_1)),
    companyName: nn(row.mb_2),
    bizNo: nn(row.mb_3),
    ceoName: nn(row.mb_4),
    bizType: nn(row.mb_5),
    bizItem: nn(row.mb_6),
    managerName: nn(row.mb_7),
    taxEmail: nn(row.mb_8),
    managerPhone: nn(row.mb_9),
    managerEmail: nn(row.mb_15),
    bizZip: nn(row.mb_10),
    bizAddr1: nn(row.mb_11),
    bizAddr2: nn(row.mb_12),
    partnerKind: nn(row.mb_13),
    partnerAuth: asInt(row.mb_partner_auth),
    legacyJson: Object.keys(legacyJson).length > 0 ? legacyJson : null,
  };
  const hasAny =
    Object.values(data).some((v) => typeof v === 'string' && v !== '') ||
    data.partnerAuth !== 0 ||
    data.legacyJson !== null;
  return hasAny ? { mbId: asStr(row.mb_id), data } : null;
}

export async function runMembersPhase(ctx: MigrateCtx): Promise<void> {
  const { g5, legacy, prisma, report } = ctx;
  console.log('\n── phase 01: members ──');
  // (스키마 준비 — mb_id 확폭·mb_password2 — 는 run.ts 의 prepareTargetSchema 가 선행)

  // 1) g5_member 복사
  const plan = await buildCopyPlan(ctx.schema, 'g5_member', {
    exclude: [SPARE_MB_COLS],
    dropAutoIncrement: true, // mb_no 재발급(참조 키는 mb_id)
  });
  const targetIds = new Set(
    (await g5.select(`SELECT mb_id FROM g5_member`)).map((r) => asStr(r.mb_id)),
  );
  const legacyMembers = await legacy(`SELECT * FROM g5_member ORDER BY mb_no`);
  const toInsert: Row[] = [];
  const insertedIds: string[] = [];
  for (const row of legacyMembers) {
    const mbId = asStr(row.mb_id);
    if (mbId === '') continue;
    if (targetIds.has(mbId)) {
      report.note('members.스킵(타깃 기존재)', mbId, 50);
      continue;
    }
    toInsert.push(rowFromLegacy(row, plan));
    insertedIds.push(mbId);
  }
  if (!ctx.dryRun && toInsert.length > 0) {
    await g5.insertMany('g5_member', plan.insertCols, toInsert);
  }
  report.count('members.g5_member 삽입', toInsert.length);
  const migratedIds = new Set(insertedIds);
  const allTargetIds = new Set([...targetIds, ...insertedIds]);

  // 2) sp_member_profile 승격(이관 회원만 — 타깃 기존 계정의 프로필은 건드리지 않음)
  let profileCount = 0;
  for (const row of legacyMembers) {
    const mbId = asStr(row.mb_id);
    if (!migratedIds.has(mbId)) continue;
    const profile = buildProfileInput(row);
    if (profile === null) continue;
    if (!ctx.dryRun) {
      const { legacyJson, ...rest } = profile.data;
      const data = { ...rest, ...(legacyJson === null ? {} : { legacyJson }) };
      await prisma.spMemberProfile.upsert({
        where: { mbId: profile.mbId },
        create: { mbId: profile.mbId, ...data },
        update: data,
      });
    }
    profileCount += 1;
  }
  report.count('members.sp_member_profile 승격', profileCount);

  // 3) 소셜 프로필 — (provider, identifier) 유니크 제약이 없어 존재검사 필수(계획 #6)
  const socialPlan = await buildCopyPlan(ctx.schema, 'g5_member_social_profiles', {
    dropAutoIncrement: true,
  });
  const targetSocial = new Set(
    (await g5.select(`SELECT provider, identifier FROM g5_member_social_profiles`)).map(
      (r) => `${asStr(r.provider)}${asStr(r.identifier)}`,
    ),
  );
  const legacySocial = await legacy(`SELECT * FROM g5_member_social_profiles ORDER BY mp_no`);
  const socialRows: Row[] = [];
  for (const row of legacySocial) {
    const key = `${asStr(row.provider)}${asStr(row.identifier)}`;
    if (targetSocial.has(key)) continue;
    const mbId = asStr(row.mb_id);
    if (!allTargetIds.has(mbId)) {
      report.note('members.소셜 스킵(회원 없음)', `${asStr(row.provider)}/${mbId}`, 50);
      continue;
    }
    socialRows.push(rowFromLegacy(row, socialPlan));
    targetSocial.add(key);
  }
  if (!ctx.dryRun && socialRows.length > 0) {
    await g5.insertMany('g5_member_social_profiles', socialPlan.insertCols, socialRows);
  }
  report.count('members.소셜 프로필 삽입', socialRows.length);

  // 4) 포인트 원장 — 회원 단위 카운트 대조 멱등
  const pointPlan = await buildCopyPlan(ctx.schema, 'g5_point', { dropAutoIncrement: true });
  const legacyPointCounts = new Map<string, number>();
  for (const r of await legacy(`SELECT mb_id, COUNT(*) c FROM g5_point GROUP BY mb_id`)) {
    legacyPointCounts.set(asStr(r.mb_id), asInt(r.c));
  }
  const targetPointCounts = new Map<string, number>();
  for (const r of await g5.select(`SELECT mb_id, COUNT(*) c FROM g5_point GROUP BY mb_id`)) {
    targetPointCounts.set(asStr(r.mb_id), asInt(r.c));
  }
  let pointRows = 0;
  let pointMembers = 0;
  for (const [mbId, legacyCount] of legacyPointCounts.entries()) {
    if (!migratedIds.has(mbId)) {
      if (allTargetIds.has(mbId)) report.note('members.포인트 스킵(기존 계정)', mbId, 20);
      else report.note('members.포인트 스킵(회원 없음)', mbId, 50);
      continue;
    }
    const targetCount = targetPointCounts.get(mbId) ?? 0;
    if (targetCount === legacyCount) continue; // 재실행 멱등
    if (targetCount !== 0) {
      report.note('members.포인트 불일치(수동 확인)', `${mbId}: legacy ${String(legacyCount)} vs target ${String(targetCount)}`);
      continue;
    }
    const rows = await legacy(`SELECT * FROM g5_point WHERE mb_id = ? ORDER BY po_id`, [mbId]);
    const insertRows = rows.map((r) => rowFromLegacy(r, pointPlan));
    if (!ctx.dryRun) await g5.insertMany('g5_point', pointPlan.insertCols, insertRows);
    pointRows += insertRows.length;
    pointMembers += 1;
  }
  report.count('members.포인트 원장 삽입 행', pointRows);
  report.count('members.포인트 원장 삽입 회원', pointMembers);

  // 5) 관리권한(g5_auth) — (mb_id, au_menu) 복합키 존재검사
  const authPlan = await buildCopyPlan(ctx.schema, 'g5_auth');
  for (const row of await legacy(`SELECT * FROM g5_auth`)) {
    const mbId = asStr(row.mb_id);
    if (!allTargetIds.has(mbId)) {
      report.note('members.auth 스킵(회원 없음)', mbId, 20);
      continue;
    }
    const where = { mb_id: mbId, au_menu: asStr(row.au_menu) };
    if (await g5.exists('g5_auth', where)) continue;
    if (!ctx.dryRun) await g5.insertRow('g5_auth', rowFromLegacy(row, authPlan));
    report.count('members.auth 삽입');
  }

  // 6) 배송지 주소록(g5_shop_order_address — mb_id 기준 회원 자산)
  const addrPlan = await buildCopyPlan(ctx.schema, 'g5_shop_order_address', {
    dropAutoIncrement: true,
  });
  const targetAddrCounts = new Map<string, number>();
  for (const r of await g5.select(`SELECT mb_id, COUNT(*) c FROM g5_shop_order_address GROUP BY mb_id`)) {
    targetAddrCounts.set(asStr(r.mb_id), asInt(r.c));
  }
  const legacyAddr = await legacy(`SELECT * FROM g5_shop_order_address ORDER BY ad_id`);
  const addrByMember = new Map<string, LegacyRow[]>();
  for (const row of legacyAddr) {
    const mbId = asStr(row.mb_id);
    const list = addrByMember.get(mbId) ?? [];
    list.push(row);
    addrByMember.set(mbId, list);
  }
  let addrRows = 0;
  for (const [mbId, rows] of addrByMember.entries()) {
    // 주소록은 회원 행과 달리 기존 계정(admin 등)에도 이관 — 같은 mb_id 라 자연 귀속되고
    // 타깃이 0건일 때만 넣으므로 무충돌(신규 계정의 자체 주소록이 있으면 그것을 존중).
    if (!allTargetIds.has(mbId)) {
      report.note('members.주소록 스킵(회원 없음)', mbId, 30);
      continue;
    }
    if ((targetAddrCounts.get(mbId) ?? 0) > 0) continue; // 재실행 멱등/기존 주소록 존중
    const insertRows = rows.map((r) => rowFromLegacy(r, addrPlan));
    if (!ctx.dryRun) {
      for (const part of chunk(insertRows, 200)) {
        await g5.insertMany('g5_shop_order_address', addrPlan.insertCols, part);
      }
    }
    addrRows += insertRows.length;
  }
  report.count('members.주소록 삽입', addrRows);

  // g5 datetime 은 전부 원문 문자열 복사(sql_mode='' 로 zero-date 포함 보존) — Date 가드는 sp_* 쪽만.
  if (!ctx.dryRun) await ctx.ledger.markPhaseDone('members');
}
