// 타깃 g5 스키마 준비(무손실 DDL) — 게이트 통과 후, phase 실행 전에 1회.
//
// 1) mb_id 일괄 확폭: 레거시는 이메일을 회원 아이디로 쓰며 mb_id 를 varchar(255)로 넓혀
//    운영했다(실측: member/cart/order 등 255, 값 최대 29자). 표준 타깃(varchar(20))에
//    그대로 넣으면 **소리 없이 절단**되어 유니크 충돌·참조 단절이 난다(P1 리허설 실증).
//    → 타깃의 모든 `mb_id` varchar(<255) 컬럼을 255 로 MODIFY(무손실 확폭).
//    write_* 원형(g5_write_free)도 포함되므로 이후 생성되는 게시판 테이블은 자동 상속.
//    ※ 레거시도 g5_point.mb_id 는 20 그대로라 장문 아이디의 포인트 원장이 잘린 채 쌓여
//      있었다(레거시 기존 버그) — 이관은 그 실태를 보존하고 리포트만 한다.
// 2) mb_password2 선-ALTER: 구형 41자 해시 회원의 첫 로그인 때 코어가 런타임 ALTER 를
//    실행하는 것(common.lib.php:4083-4086)을 마이그레이션 시점으로 앞당긴다.
import type { MigrateCtx } from './context';
import { asInt, asStr } from './util';

/**
 * prep 이 확폭을 보장하는 컬럼별 한도 — 게이트의 절단 위험 평가가 이 값을 "준비 후 한도"로 쓴다.
 * - mb_id: 레거시 이메일 아이디(255 운영) — 타깃 전 테이블 확폭
 * - po_rel_id: 코어 insert_point 가 mb_id 를 기록(@login/@member, 실측 34자)
 * - od_name: 운영이 varchar(1000)으로 확폭해 "이름(회사/파일…)" 실사용(실측 261자, 1,880건)
 */
export const PREP_COLUMN_LIMITS: Record<string, number> = {
  mb_id: 255,
  po_rel_id: 255,
  od_name: 1000,
};

/** mb_id 외 명시 확폭 대상: [테이블, 컬럼, MODIFY 정의]. 현재 한도 미달일 때만 실행. */
const WIDEN_TARGETS: readonly [string, string, string][] = [
  ['g5_point', 'po_rel_id', `varchar(255) NOT NULL DEFAULT ''`],
  ['g5_shop_order', 'od_name', `varchar(1000) NOT NULL DEFAULT ''`],
];

export async function prepareTargetSchema(ctx: MigrateCtx): Promise<void> {
  const { g5, report } = ctx;

  // 1) mb_id 확폭(255 미만 varchar 전부)
  const narrow = await g5.select(
    `SELECT table_name t, character_maximum_length len
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND column_name = 'mb_id'
        AND data_type = 'varchar' AND character_maximum_length < 255
      ORDER BY table_name`,
  );
  for (const row of narrow) {
    const table = asStr(row.t);
    if (!ctx.dryRun) {
      await g5.execute(
        `ALTER TABLE \`${table}\` MODIFY \`mb_id\` varchar(255) NOT NULL DEFAULT ''`,
      );
      ctx.schema.invalidateTarget(table);
    }
    report.note('prep.mb_id 확폭(20→255)', `${table} (기존 ${String(asInt(row.len))})`, 60);
  }

  // 1-b) mb_id 외 명시 확폭(po_rel_id·od_name — P2 게이트 실측 근거는 PREP_COLUMN_LIMITS 주석)
  for (const [table, column, ddl] of WIDEN_TARGETS) {
    const limit = PREP_COLUMN_LIMITS[column] ?? 0;
    const cur = await g5.select(
      `SELECT character_maximum_length len FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
      [table, column],
    );
    const curLen = asInt(cur[0]?.len);
    if (curLen === 0 || curLen >= limit) continue;
    if (!ctx.dryRun) {
      await g5.execute(`ALTER TABLE \`${table}\` MODIFY \`${column}\` ${ddl}`);
      ctx.schema.invalidateTarget(table);
    }
    report.note('prep.컬럼 확폭', `${table}.${column} (${String(curLen)}→${String(limit)})`, 20);
  }

  // 2) mb_password2 (구형 해시 자동 재해시용)
  const memberCols = await ctx.schema.targetColumns('g5_member');
  if (!memberCols.some((c) => c.name === 'mb_password2')) {
    if (!ctx.dryRun) {
      await g5.execute(
        `ALTER TABLE g5_member ADD mb_password2 varchar(255) NOT NULL DEFAULT '' AFTER mb_password`,
      );
      ctx.schema.invalidateTarget('g5_member');
    }
    report.count('prep.mb_password2 선-ALTER');
  }
}
