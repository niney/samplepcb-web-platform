// phase 04 — 기타: 상품분류 · 쿠폰(+로그) · 1:1문의 설정/데이터.
import { buildCopyPlan, rowFromLegacy } from '../lib/context';
import type { MigrateCtx } from '../lib/context';
import type { Row } from '../lib/g5-writer';
import { asInt, asStr, chunk } from '../lib/util';

export async function runMiscPhase(ctx: MigrateCtx): Promise<void> {
  const { g5, legacy, report } = ctx;
  console.log('\n── phase 04: misc (분류·쿠폰·1:1문의) ──');

  // 1) 상품분류(g5_shop_category — 템플릿 상품 ca_id=10 의 실체 행 포함)
  const caPlan = await buildCopyPlan(ctx.schema, 'g5_shop_category');
  for (const row of await legacy(`SELECT * FROM g5_shop_category`)) {
    const caId = asStr(row.ca_id);
    if (caId === '' || (await g5.exists('g5_shop_category', { ca_id: caId }))) continue;
    if (!ctx.dryRun) await g5.insertRow('g5_shop_category', rowFromLegacy(row, caPlan));
    report.count('misc.상품분류 삽입');
  }

  // 2) 쿠폰 — cp_id UNIQUE(게이트에서 충돌 사전 검사됨)
  const cpPlan = await buildCopyPlan(ctx.schema, 'g5_shop_coupon', { dropAutoIncrement: true });
  for (const row of await legacy(`SELECT * FROM g5_shop_coupon ORDER BY cp_no`)) {
    const cpId = asStr(row.cp_id);
    if (cpId === '' || (await g5.exists('g5_shop_coupon', { cp_id: cpId }))) continue;
    if (!ctx.dryRun) await g5.insertRow('g5_shop_coupon', rowFromLegacy(row, cpPlan));
    report.count('misc.쿠폰 삽입');
  }
  const clPlan = await buildCopyPlan(ctx.schema, 'g5_shop_coupon_log', { dropAutoIncrement: true });
  const targetClCount = asInt((await g5.select(`SELECT COUNT(*) c FROM g5_shop_coupon_log`))[0]?.c);
  if (targetClCount === 0) {
    const rows = (await legacy(`SELECT * FROM g5_shop_coupon_log ORDER BY cl_id`)).map((r) =>
      rowFromLegacy(r, clPlan),
    );
    if (!ctx.dryRun && rows.length > 0) {
      await g5.insertMany('g5_shop_coupon_log', clPlan.insertCols, rows);
    }
    report.count('misc.쿠폰 사용로그 삽입', rows.length);
  }

  // 3) 1:1문의 설정 — 타깃이 비어있을 때만(신규에서 이미 설정했다면 존중)
  const qaConfigCount = asInt((await g5.select(`SELECT COUNT(*) c FROM g5_qa_config`))[0]?.c);
  if (qaConfigCount === 0) {
    const qcPlan = await buildCopyPlan(ctx.schema, 'g5_qa_config');
    const legacyConfig = (await legacy(`SELECT * FROM g5_qa_config LIMIT 1`))[0];
    if (legacyConfig !== undefined) {
      if (!ctx.dryRun) await g5.insertRow('g5_qa_config', rowFromLegacy(legacyConfig, qcPlan));
      report.count('misc.1:1문의 설정 삽입');
    }
  }

  // 4) 1:1문의 데이터(qa_id 보존 — 원글/답변 참조(qa_related) 정합)
  const qaPlan = await buildCopyPlan(ctx.schema, 'g5_qa_content');
  const existingQa = new Set(
    (await g5.select(`SELECT qa_id FROM g5_qa_content`)).map((r) => asInt(r.qa_id)),
  );
  const qaRows: Row[] = [];
  for (const row of await legacy(`SELECT * FROM g5_qa_content ORDER BY qa_id`)) {
    if (existingQa.has(asInt(row.qa_id))) continue;
    qaRows.push(rowFromLegacy(row, qaPlan));
  }
  if (!ctx.dryRun && qaRows.length > 0) {
    for (const part of chunk(qaRows, 200)) {
      await g5.insertMany('g5_qa_content', qaPlan.insertCols, part);
    }
  }
  report.count('misc.1:1문의 삽입', qaRows.length);

  // 5) 사이트 설정 중 "서비스 필수" 항목 — 소셜 로그인 키(g5_config cf_social_*/제공자 키).
  //    g5_config 는 "신규 설정 유지"가 원칙이지만, 소셜 키가 없으면 소셜 가입 회원(네이버 다수)의
  //    로그인 연속성이 끊긴다(P3 실증 — docs §8). qa_config 와 같은 규칙: **타깃이 미설정
  //    (cf_social_login_use=0 이고 servicelist 빈값)일 때만** 레거시 값을 이식한다(기설정 존중·멱등).
  await migrateSocialConfig(ctx);

  if (!ctx.dryRun) await ctx.ledger.markPhaseDone('misc');
}

/** 소셜 로그인 설정 이식 — 양쪽에 실존하는 컬럼 교집합만 복사(스키마 드리프트 안전). */
const SOCIAL_CF_COLS = [
  'cf_social_login_use',
  'cf_social_servicelist',
  'cf_naver_clientid',
  'cf_naver_secret',
  'cf_kakao_rest_key',
  'cf_kakao_client_secret',
  'cf_kakao_js_apikey',
  'cf_google_clientid',
  'cf_google_secret',
  'cf_facebook_appid',
  'cf_facebook_secret',
  'cf_twitter_key',
  'cf_twitter_secret',
  'cf_payco_clientid',
  'cf_payco_secret',
] as const;

async function migrateSocialConfig(ctx: MigrateCtx): Promise<void> {
  const { g5, legacy, report } = ctx;
  const targetRow = (await g5.select(
    `SELECT cf_social_login_use, cf_social_servicelist FROM g5_config LIMIT 1`,
  ))[0];
  if (targetRow === undefined) return;
  const alreadySet =
    asInt(targetRow.cf_social_login_use) !== 0 || asStr(targetRow.cf_social_servicelist) !== '';
  if (alreadySet) {
    report.count('misc.소셜 설정 스킵(타깃 기설정)');
    return;
  }
  const [legacyCols, targetCols] = await Promise.all([
    ctx.schema.legacyColumns('g5_config'),
    ctx.schema.targetColumns('g5_config'),
  ]);
  const legacyNames = new Set(legacyCols.map((c) => c.name));
  const targetNames = new Set(targetCols.map((c) => c.name));
  const cols = SOCIAL_CF_COLS.filter((c) => legacyNames.has(c) && targetNames.has(c));
  if (cols.length === 0) return;
  const legacyRow = (await legacy(
    `SELECT ${cols.map((c) => `\`${c}\``).join(', ')} FROM g5_config LIMIT 1`,
  ))[0];
  if (legacyRow === undefined) return;
  if (!ctx.dryRun) {
    await g5.execute(
      `UPDATE g5_config SET ${cols.map((c) => `\`${c}\` = ?`).join(', ')}`,
      cols.map((c) => legacyRow[c]),
    );
  }
  report.count('misc.소셜 설정 이식(컬럼 수)', cols.length);
}
