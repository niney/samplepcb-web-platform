// 회원 재대조(증분) — 레거시 수정시각 부재 → 전량 Node 필드 대조 후 상이분만 UPDATE.
//
// 규칙(계획 P1-6):
// - 대조 컬럼 = 교집합 복사 계획(plan.cols — mb_1~10 제외 규칙 상속) − 노이즈(mb_today_login·
//   mb_login_ip: 로그인마다 변해 매회 전원 UPDATE 되는 낭비 방지; --final 에서만 포함) − mb_password.
// - 비밀번호는 별도 앵커 규칙: 타깃이 'sha256:'(코어 자동 재해시)이고 mb_password2 == 레거시
//   구해시면 보존(재해시 유지). 불일치 = 재해시 후 레거시에서 비번 변경 → 레거시 해시 채택 +
//   mb_password2 초기화(다음 로그인 때 코어가 다시 재해시).
// - 보호 계정(admin·kpeter — 신규 플랫폼 정본)은 상이해도 리포트만.
// - 프로필(sp_member_profile)은 buildProfileInput 재실행 결과와 대조해 upsert(회사명 덮음 리포트).
// - 포인트 원장은 append-only 전제의 tail-append(OFFSET 타깃 카운트) — 계획 P2-9.
import { Prisma } from '@prisma/client';
import { buildCopyPlan, rowFromLegacy } from '../context';
import type { MigrateCtx } from '../context';
import type { Row } from '../g5-writer';
import { buildProfileInput } from '../../phases/01-members';
import { asInt, asStr, canonicalJson, chunk } from '../util';
import { diffCols } from './row-diff';

const SPARE_MB_COLS = /^mb_([1-9]|10)$/; // phases/01-members 와 동일 규칙(여분필드 미복사)
export const MEMBER_NOISE_COLS: readonly string[] = ['mb_today_login', 'mb_login_ip'];

export function protectedMbIds(): Set<string> {
  const extra = (process.env.MIGRATE_PROTECTED_MB_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return new Set(['admin', 'kpeter', ...extra]);
}

export interface PasswordSyncDecision {
  /** null = 비번 관련 변경 없음. 아니면 SET 에 병합할 필드. */
  set: { mb_password: string; mb_password2: string } | null;
}

/** 비밀번호 동기 규칙(순수 — 단위테스트 대상). */
export function resolvePasswordSync(
  legacyPw: string,
  targetPw: string,
  targetPw2: string,
): PasswordSyncDecision {
  if (targetPw.startsWith('sha256:')) {
    // 코어가 자동 재해시한 계정 — 구해시 앵커(mb_password2)가 레거시와 같으면 비번 무변경.
    if (targetPw2 === legacyPw) return { set: null };
    // 레거시에서 비번이 바뀜(새 구해시) → 레거시 채택, 앵커 초기화(재로그인 시 재해시).
    return { set: { mb_password: legacyPw, mb_password2: '' } };
  }
  if (targetPw !== legacyPw) return { set: { mb_password: legacyPw, mb_password2: '' } };
  return { set: null };
}

export interface MemberResyncOptions {
  /** --final: 노이즈 컬럼까지 최종 반영(컷오버 마지막 1회) */
  final?: boolean;
}

export async function resyncMembers(ctx: MigrateCtx, opts: MemberResyncOptions = {}): Promise<void> {
  const { g5, legacy, prisma, report } = ctx;
  console.log('── sync: members 재대조 ──');
  const protectedIds = protectedMbIds();

  const plan = await buildCopyPlan(ctx.schema, 'g5_member', {
    exclude: [SPARE_MB_COLS],
    dropAutoIncrement: true,
  });
  const noise = new Set(opts.final === true ? [] : MEMBER_NOISE_COLS);
  const compareCols = plan.cols.filter(
    (c) => c !== 'mb_id' && c !== 'mb_password' && !noise.has(c),
  );

  const legacyMembers = await legacy(`SELECT * FROM g5_member`);
  const targetRows = await g5.select(`SELECT * FROM g5_member`);
  const targetByMbId = new Map<string, Row>(targetRows.map((r) => [asStr(r.mb_id), r]));

  // 프로필 전량 로드(대조용)
  const profiles = await prisma.spMemberProfile.findMany();
  const profileByMbId = new Map(profiles.map((p) => [p.mbId, p]));

  let updated = 0;
  let profileUpserts = 0;
  for (const legacyRow of legacyMembers) {
    const mbId = asStr(legacyRow.mb_id);
    const target = targetByMbId.get(mbId);
    if (target === undefined) continue; // 신규 회원은 (a) phase01 재실행이 담당

    // ── g5_member 대조 ──
    const changed = diffCols(legacyRow, target, compareCols);
    const pw = resolvePasswordSync(
      asStr(legacyRow.mb_password),
      asStr(target.mb_password),
      asStr(target.mb_password2),
    );
    if (changed.length > 0 || pw.set !== null) {
      if (protectedIds.has(mbId)) {
        report.note(
          'sync.보호 계정 상이(미반영)',
          `${mbId}: [${changed.slice(0, 6).join(', ')}${pw.set !== null ? ', mb_password' : ''}]`,
          20,
        );
      } else {
        const changedLabels = [...changed.slice(0, 8), ...(pw.set !== null ? ['mb_password'] : [])];
        report.note('sync.회원 갱신 상세', `${mbId}: [${changedLabels.join(', ')}]`, 50);
        const set: Row = {};
        for (const c of changed) set[c] = legacyRow[c] ?? null;
        // 노이즈 컬럼은 "다른 변경이 있을 때" 최신값을 편승시켜 나른다(별도 UPDATE 유발 금지).
        if (changed.length > 0) {
          for (const c of MEMBER_NOISE_COLS) {
            if (plan.cols.includes(c)) set[c] = legacyRow[c] ?? null;
          }
        }
        if (pw.set !== null) {
          set.mb_password = pw.set.mb_password;
          set.mb_password2 = pw.set.mb_password2;
        }
        if (!ctx.dryRun) await g5.updateRow('g5_member', set, { mb_id: mbId });
        updated += 1;
      }
    }

    // ── sp_member_profile 대조(보호 계정 제외 — 신규 프로필 정본 유지) ──
    if (protectedIds.has(mbId)) continue;
    const desired = buildProfileInput(legacyRow);
    const existing = profileByMbId.get(mbId);
    if (desired === null) {
      // 레거시에 프로필 소스가 전무 — 기존 프로필은 그대로 둔다(admin 이 수기 저장했을 수 있음)
      continue;
    }
    const { legacyJson, ...rest } = desired.data;
    // MySQL JSON 컬럼은 키 순서를 재배열해 돌려준다 — 순서 무관 비교(canonicalJson) 필수
    // (baseline 실증: stringify 비교는 legacyJson 키 순서 차이로 매회 upsert 진동).
    const desiredCmp = canonicalJson({ ...rest, legacyJson: legacyJson ?? null });
    const existingCmp =
      existing === undefined
        ? null
        : canonicalJson({
            memberType: existing.memberType,
            companyName: existing.companyName,
            bizNo: existing.bizNo,
            ceoName: existing.ceoName,
            bizType: existing.bizType,
            bizItem: existing.bizItem,
            managerName: existing.managerName,
            taxEmail: existing.taxEmail,
            managerPhone: existing.managerPhone,
            managerEmail: existing.managerEmail,
            bizZip: existing.bizZip,
            bizAddr1: existing.bizAddr1,
            bizAddr2: existing.bizAddr2,
            partnerKind: existing.partnerKind,
            partnerAuth: existing.partnerAuth,
            legacyJson: existing.legacyJson ?? null,
          });
    if (desiredCmp === existingCmp) continue;
    report.note(
      'sync.프로필 upsert 상세',
      `${mbId}: desired=${desiredCmp.slice(0, 160)} | existing=${(existingCmp ?? '(없음)').slice(0, 160)}`,
      20,
    );
    if (
      existing?.companyName != null &&
      existing.companyName !== rest.companyName &&
      rest.companyName != null
    ) {
      report.note(
        'sync.프로필 회사명 덮어씀(레거시 우선)',
        `${mbId}: '${existing.companyName}' → '${rest.companyName}'`,
        30,
      );
    }
    if (!ctx.dryRun) {
      // nullable Json 을 NULL 로 지우려면 raw null 이 아니라 Prisma.DbNull 이어야 한다.
      const data = { ...rest, legacyJson: legacyJson ?? Prisma.DbNull };
      await prisma.spMemberProfile.upsert({
        where: { mbId },
        create: { mbId, ...data },
        update: data,
      });
    }
    profileUpserts += 1;
  }
  report.count('sync.회원 갱신', updated);
  report.count('sync.프로필 upsert', profileUpserts);
}

/** 포인트 tail-append(계획 P2-9) — po_id 재발급 구조라 행 매칭 불가 → 회원별 부족분만 순서 삽입. */
export async function tailAppendPoints(ctx: MigrateCtx): Promise<void> {
  const { g5, legacy, report } = ctx;
  const protectedIds = protectedMbIds();
  const pointPlan = await buildCopyPlan(ctx.schema, 'g5_point', { dropAutoIncrement: true });

  const legacyCounts = new Map<string, number>();
  for (const r of await legacy(`SELECT mb_id, COUNT(*) c FROM g5_point GROUP BY mb_id`)) {
    legacyCounts.set(asStr(r.mb_id), asInt(r.c));
  }
  const targetCounts = new Map<string, number>();
  for (const r of await g5.select(`SELECT mb_id, COUNT(*) c FROM g5_point GROUP BY mb_id`)) {
    targetCounts.set(asStr(r.mb_id), asInt(r.c));
  }
  const targetMembers = new Set(
    (await g5.select(`SELECT mb_id FROM g5_member`)).map((r) => asStr(r.mb_id)),
  );

  let appended = 0;
  for (const [mbId, legacyCount] of legacyCounts.entries()) {
    if (!targetMembers.has(mbId)) continue; // 회원 부재(레거시 절단 고아 등) — 기존 정책 유지
    if (protectedIds.has(mbId)) continue; // 보호 계정 원장은 신규 정본(기존 정책)
    const targetCount = targetCounts.get(mbId) ?? 0;
    if (targetCount === legacyCount) continue;
    if (targetCount > legacyCount) {
      report.note('sync.포인트 타깃 초과(전제 위반?)', `${mbId}: 타깃 ${String(targetCount)} > 레거시 ${String(legacyCount)}`, 20);
      continue;
    }
    const rows = await legacy(
      `SELECT * FROM g5_point WHERE mb_id = ? ORDER BY po_id LIMIT ? OFFSET ?`,
      [mbId, legacyCount - targetCount, targetCount],
    );
    const insertRows = rows.map((r) => rowFromLegacy(r, pointPlan));
    if (!ctx.dryRun && insertRows.length > 0) {
      for (const part of chunk(insertRows, 200)) {
        await g5.insertMany('g5_point', pointPlan.insertCols, part);
      }
    }
    appended += insertRows.length;
  }
  report.count('sync.포인트 tail-append 행', appended);
}
