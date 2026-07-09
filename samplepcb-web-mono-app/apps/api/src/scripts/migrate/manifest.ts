// 레거시 전 테이블 처분표(manifest) + 실행 전 게이트.
//
// 사용자 지시 "조금이라도 애매한 건 물어보고 하나하나 체크"의 코드화:
// 레거시 실스키마(테이블·이관 테이블의 레거시 전용 컬럼·상태값·쿠폰 cp_id·템플릿 상품)를
// 이 표와 대조해 **처분 미정 항목이 하나라도 있으면 목록을 출력하고 중단**한다.
// 로컬 2020-12 덤프와 운영의 스키마 드리프트(it_46~50·mb_18~20·계좌 6컬럼·신규 sp_*)를
// 컷오버 전에 강제로 드러내는 안전판이다. 처분은 계획 문서(플랜 cuddly-wiggling-perlis) §처분표.
import { TEMPLATE_ITEMS } from '../../lib/g5-db';
import type { MigrateCtx } from './lib/context';
import { PREP_COLUMN_LIMITS } from './lib/schema-prep';
import { asInt, asStr } from './lib/util';
import { normalizeStatus } from './lib/status-map';

export type Disposition = 'convert' | 'copy' | 'skip' | 'legacy-sp';

/** 이관 대상 게시판(레거시 실측 8종 + 운영 신설 open_market — P2 게이트 발견, 글 11건).
 *  이 밖의 g5_write_* 발견 = 처분 미정 → 게이트 중단. */
export const MIGRATE_BOARDS: readonly string[] = [
  'notice',
  'qa',
  'faq',
  'data',
  'customer_center',
  'review',
  'portfolio',
  'production_s',
  'open_market',
];

interface TableRule {
  match: string | RegExp;
  disposition: Disposition;
}

/** 첫 일치 우선. 여기 안 걸리는 레거시 테이블 = 처분 미정(게이트 위반). */
const TABLE_RULES: readonly TableRule[] = [
  { match: 'g5_shop_item', disposition: 'convert' },
  // ── 복사(+보정) ──
  { match: 'g5_member', disposition: 'copy' },
  { match: 'g5_member_social_profiles', disposition: 'copy' },
  { match: 'g5_point', disposition: 'copy' },
  { match: 'g5_shop_order', disposition: 'copy' },
  { match: 'g5_shop_cart', disposition: 'copy' },
  { match: 'g5_shop_order_address', disposition: 'copy' },
  { match: 'g5_shop_category', disposition: 'copy' },
  { match: 'g5_shop_coupon', disposition: 'copy' },
  { match: 'g5_shop_coupon_log', disposition: 'copy' },
  { match: 'g5_qa_config', disposition: 'copy' },
  { match: 'g5_qa_content', disposition: 'copy' },
  { match: 'g5_board', disposition: 'copy' },
  { match: 'g5_group', disposition: 'copy' },
  { match: 'g5_board_file', disposition: 'copy' },
  { match: 'g5_auth', disposition: 'copy' },
  { match: new RegExp(`^g5_write_(${MIGRATE_BOARDS.join('|')})$`), disposition: 'copy' },
  // ── 스킵(운영성·파생·빈·설정은 신규 유지) ──
  { match: 'g5_config', disposition: 'skip' },
  { match: 'g5_shop_default', disposition: 'skip' },
  { match: 'g5_content', disposition: 'skip' },
  { match: 'g5_menu', disposition: 'skip' }, // 사용자 지시: 미이관
  { match: 'g5_uniqid', disposition: 'skip' },
  { match: 'g5_visit', disposition: 'skip' },
  { match: 'g5_visit_sum', disposition: 'skip' },
  { match: 'g5_login', disposition: 'skip' },
  { match: 'g5_popular', disposition: 'skip' },
  { match: 'g5_autosave', disposition: 'skip' },
  { match: 'g5_board_new', disposition: 'skip' }, // 파생 캐시
  { match: 'g5_board_good', disposition: 'skip' },
  { match: 'g5_mail', disposition: 'skip' },
  { match: 'g5_memo', disposition: 'skip' },
  { match: 'g5_scrap', disposition: 'skip' },
  { match: 'g5_new_win', disposition: 'skip' },
  { match: /^g5_poll/, disposition: 'skip' },
  { match: 'g5_faq', disposition: 'skip' }, // FAQ 는 write_faq 게시판이 실데이터
  { match: 'g5_faq_master', disposition: 'skip' },
  { match: 'g5_cert_history', disposition: 'skip' },
  { match: 'g5_group_member', disposition: 'skip' },
  { match: /^(g5_)?sms5_/, disposition: 'skip' },
  { match: 'g5_shop_order_data', disposition: 'skip' }, // PG 임시
  { match: 'g5_shop_order_delete', disposition: 'skip' },
  { match: 'g5_shop_banner', disposition: 'skip' },
  { match: 'g5_shop_coupon_zone', disposition: 'skip' }, // 쿠폰존 배너(0행) — 쿠폰 본체는 copy
  { match: 'g5_shop_cart_tmp', disposition: 'skip' }, // 운영 수동 잔재(2022-04 멈춤, PHP 참조 0건 — P2 판정)

  { match: /^g5_shop_event/, disposition: 'skip' },
  { match: 'g5_shop_inicis_log', disposition: 'skip' },
  { match: 'g5_shop_item_ext', disposition: 'skip' }, // 0행 사문화
  { match: 'g5_shop_item_option', disposition: 'skip' }, // 옵션행은 변환이 신규 생성
  { match: 'g5_shop_item_qa', disposition: 'skip' },
  { match: 'g5_shop_item_relation', disposition: 'skip' },
  { match: 'g5_shop_item_stocksms', disposition: 'skip' },
  { match: 'g5_shop_item_use', disposition: 'convert' }, // 상품 별점후기 → sp_review(05-reviews)
  { match: 'g5_shop_personalpay', disposition: 'skip' },
  { match: 'g5_shop_sendcost', disposition: 'skip' },
  { match: 'g5_shop_wish', disposition: 'skip' },
  // ── 레거시 자체 sp_*(미이관 확정 — 단 sp_estimate 는 ca20 라인 변환 시 JSON 병합 소스로 읽는다) ──
  { match: /^sp_/, disposition: 'legacy-sp' },
];

export function classifyTable(table: string): Disposition | null {
  for (const rule of TABLE_RULES) {
    if (typeof rule.match === 'string' ? rule.match === table : rule.match.test(table)) {
      return rule.disposition;
    }
  }
  return null;
}

/**
 * 이관 테이블별 "레거시 전용 컬럼" 허용 목록 — 다른 경로로 승격되는 컬럼들.
 * 여기 안 걸리는 레거시 전용 컬럼 발견 = 소리 없이 버려질 데이터 → 게이트 위반.
 */
const LEGACY_ONLY_ALLOWED: Record<string, readonly (string | RegExp)[]> = {
  g5_member: [
    /^mb_(1[1-9]|20)$/, // mb_11~20 → sp_member_profile(명시/legacyJson)
    'mb_partner_auth', // → profile.partnerAuth
    /^mb_(user|company)_(bank_name|account_number|account_holder)$/, // 계좌 6컬럼 → legacyJson
    'mb_currency', // 파트너 통화(전원 KRW 기본값 + USD 5명) → legacyJson(KRW 제외) — P2 판정
    'mb_sub_currency',
    'mb_country', // 파트너 국가(CN 5명) → legacyJson
  ],
  g5_shop_item: [
    /^it_\d{1,2}_subj[23]?$/, // EAV 라벨
    /^it_(1[1-9]|[2-4]\d|50)$/, // it_11~50 EAV 값 → spec_json
    'it_company_name', // → SpOrderSpec.companyName 후보
    'it_eta', // ca30/40 납기 → spec/quote.eta
    /^it_file[1-9]0?(_subj)?$/, // 관리자 첨부 → 미이관(리포트만, 파일은 견적 원본이 아님)
    'it_member_name',
    'it_member_tel',
    'it_member_mail',
    'it_member_memo', // 비회원 회수 고객정보 → _legacy 보존
  ],
  g5_shop_order: [/^od_([1-9]|1[0-7])$/], // od_1~11 → sp_order_biz_info (12~17 미사용 확정)
  g5_shop_item_use: [
    // 후기는 sp_review 로 변환(05-reviews) — 타깃 표준 g5_shop_item_use 에 없는 커스텀 답변 컬럼만 허용.
    // (표준 컬럼 is_id/it_id/mb_id/is_score/is_content/is_confirm/is_password 등은 타깃에도 있어 통과.
    //  단 is_password 는 회원 비번 해시 사본이라 sp_review 로는 실제 이관하지 않는다 — 05-reviews.)
    'is_reply_subject',
    'is_reply_content',
    'is_reply_name',
  ],
};

export interface GateResult {
  violations: string[];
  warnings: string[];
  info: string[];
}

/** 실행 전 게이트 — 위반이 있으면 run.ts 가 중단한다(--allow-unknown 시 경고로 강등). */
export async function runGate(ctx: MigrateCtx): Promise<GateResult> {
  const violations: string[] = [];
  const warnings: string[] = [];
  const info: string[] = [];

  // 1) 테이블 처분 대조
  const legacyTables = await ctx.schema.legacyTables();
  const byDisposition = new Map<Disposition, number>();
  for (const t of legacyTables) {
    const d = classifyTable(t);
    if (d === null) {
      violations.push(`처분 미정 테이블: ${t} — manifest.ts 에 처분을 정한 뒤 재실행`);
      continue;
    }
    byDisposition.set(d, (byDisposition.get(d) ?? 0) + 1);
  }
  info.push(
    `레거시 테이블 ${String(legacyTables.length)}개 — ` +
      `convert ${String(byDisposition.get('convert') ?? 0)} · copy ${String(byDisposition.get('copy') ?? 0)} · ` +
      `skip ${String(byDisposition.get('skip') ?? 0)} · legacy-sp ${String(byDisposition.get('legacy-sp') ?? 0)}`,
  );

  // 2) 이관 테이블의 레거시 전용 컬럼 검사(누락 데이터 검출)
  const migrated = legacyTables.filter((t) => {
    const d = classifyTable(t);
    return d === 'copy' || d === 'convert';
  });
  for (const table of migrated) {
    const [legacyCols, targetCols] = await Promise.all([
      ctx.schema.legacyColumns(table),
      ctx.schema.targetColumns(table).catch(() => []),
    ]);
    if (targetCols.length === 0) {
      if (!table.startsWith('g5_write_')) {
        violations.push(`타깃에 없는 이관 테이블: ${table}`);
      }
      continue; // write_* 는 phase 03 이 신규 생성
    }
    const targetNames = new Set(targetCols.map((c) => c.name));
    const allowed = LEGACY_ONLY_ALLOWED[table] ?? [];
    for (const col of legacyCols) {
      if (targetNames.has(col.name)) continue;
      const ok = allowed.some((a) =>
        typeof a === 'string' ? a === col.name : a.test(col.name),
      );
      if (!ok) {
        violations.push(
          `이관 테이블 ${table} 의 레거시 전용 컬럼 처분 미정: ${col.name} — 승격/보존/폐기 결정 필요`,
        );
      }
    }

    // 절단 위험(P1 리허설 실증 교훈): 레거시 컬럼 정의가 타깃보다 넓으면 **실데이터** 최대
    // 길이를 대조 — sql_mode='' 라 절단이 소리 없이 지나가므로 게이트가 유일한 방어선.
    if (classifyTable(table) === 'copy') {
      const targetByName = new Map(targetCols.map((c) => [c.name, c]));
      for (const lcol of legacyCols) {
        const tcol = targetByName.get(lcol.name);
        if (tcol === undefined || lcol.maxLen === null || tcol.maxLen === null) continue;
        // 스키마 준비(prepareTargetSchema)가 확폭을 보장하는 컬럼은 "준비 후 한도"로 평가
        const prepLimit = PREP_COLUMN_LIMITS[lcol.name] ?? 0;
        const effectiveTarget = Math.max(tcol.maxLen, prepLimit);
        if (lcol.maxLen <= effectiveTarget) continue;
        const rows = await ctx.legacy(
          `SELECT MAX(CHAR_LENGTH(\`${lcol.name}\`)) m FROM \`${table}\``,
        );
        const dataMax = asInt(rows[0]?.m);
        if (dataMax > effectiveTarget) {
          violations.push(
            `절단 위험: ${table}.${lcol.name} — 레거시 실데이터 최대 ${String(dataMax)}자 > 타깃 한도 ${String(effectiveTarget)}자 (확폭 또는 처분 결정 필요)`,
          );
        }
      }
    }
  }

  // 3) 상태값 전수 대조(od + 주문 연결 ct)
  const odStatuses = await ctx.legacy(`SELECT DISTINCT od_status s FROM g5_shop_order`);
  for (const r of odStatuses) {
    const s = asStr(r.s);
    if (s === '부분취소') continue; // 전용 해소 규칙 있음(status-map)
    if (normalizeStatus(s) === null) violations.push(`미지 od_status: '${s}' — 매핑표 추가 필요`);
  }
  const ctStatuses = await ctx.legacy(
    `SELECT DISTINCT c.ct_status s, COUNT(*) cnt
       FROM g5_shop_cart c JOIN g5_shop_order o ON o.od_id = c.od_id
      GROUP BY c.ct_status`,
  );
  for (const r of ctStatuses) {
    const s = asStr(r.s);
    if (normalizeStatus(s) === null) {
      violations.push(`미지 ct_status(주문 연결분): '${s}' ${asStr(r.cnt)}건 — 매핑표 추가 필요`);
    }
  }

  // 4) 타깃 엔진 확인(정보) — MyISAM = 트랜잭션 없음 전제의 재확인
  const engines = await ctx.g5.select(`SHOW TABLE STATUS WHERE Name LIKE 'g5\\_%'`);
  const engineCount = new Map<string, number>();
  for (const r of engines) {
    const e = asStr(r.Engine);
    engineCount.set(e, (engineCount.get(e) ?? 0) + 1);
  }
  info.push(
    `타깃 g5 엔진: ${[...engineCount.entries()].map(([e, n]) => `${e} ${String(n)}`).join(' · ')} (MyISAM=무트랜잭션 → od 단위 멱등 재실행 설계)`,
  );

  // 5) 쿠폰 cp_id 충돌(UNIQUE) 사전 게이트 — 내용까지 같은 행은 기이관(재실행)으로 간주
  const legacyCp = await ctx.legacy(`SELECT cp_id, cp_subject, mb_id FROM g5_shop_coupon`);
  const legacyCpIds = legacyCp.map((r) => asStr(r.cp_id)).filter((s) => s !== '');
  if (legacyCpIds.length > 0) {
    const placeholders = legacyCpIds.map(() => '?').join(', ');
    const dup = await ctx.g5.select(
      `SELECT cp_id, cp_subject, mb_id FROM g5_shop_coupon WHERE cp_id IN (${placeholders})`,
      legacyCpIds,
    );
    for (const t of dup) {
      const l = legacyCp.find((r) => asStr(r.cp_id) === asStr(t.cp_id));
      const same =
        l !== undefined &&
        asStr(l.cp_subject) === asStr(t.cp_subject) &&
        asStr(l.mb_id) === asStr(t.mb_id);
      if (!same) {
        violations.push(`쿠폰 cp_id 충돌(타깃에 다른 내용으로 존재): ${asStr(t.cp_id)}`);
      }
    }
  }

  // 6) 템플릿 상품 4종 존재(변환 라인의 it_id 앵커)
  const templateIds = Object.values(TEMPLATE_ITEMS);
  const tmplRows = await ctx.g5.select(
    `SELECT it_id FROM g5_shop_item WHERE it_id IN (${templateIds.map(() => '?').join(', ')})`,
    templateIds,
  );
  if (tmplRows.length !== templateIds.length) {
    const found = new Set(tmplRows.map((r) => asStr(r.it_id)));
    const missing = templateIds.filter((id) => !found.has(id));
    violations.push(
      `타깃에 템플릿 상품 누락: ${missing.join(', ')} — 먼저 seed-template-items 실행 필요`,
    );
  }

  // 7) 규모 정보
  const scale = await ctx.legacy(
    `SELECT (SELECT COUNT(*) FROM g5_member) mb_cnt,
            (SELECT COUNT(*) FROM g5_shop_order) od_cnt,
            (SELECT COUNT(*) FROM g5_shop_cart c JOIN g5_shop_order o ON o.od_id = c.od_id) line_cnt,
            (SELECT COUNT(*) FROM g5_shop_order WHERE mb_id = '') guest_cnt`,
  );
  const s0 = scale[0];
  if (s0 !== undefined) {
    info.push(
      `레거시 규모: 회원 ${asStr(s0.mb_cnt)} · 주문 ${asStr(s0.od_cnt)} · 주문 라인 ${asStr(s0.line_cnt)} · 비회원 주문 ${asStr(s0.guest_cnt)}`,
    );
  }

  return { violations, warnings, info };
}
