// 신규 플랫폼 필수 초기 데이터 시드.
// ① PCB 4종 + SmartBOM 1종 템플릿 상품 ② 로컬 정본 사업자정보 11필드
// ③ 무통장입금 설정 2필드를 한 번에 적용한다.
// 기본 실행은 빈 값/영카트 설치 예시값만 교체하고 다른 운영값은 보존한다.
// 실행: pnpm --filter api db:seed-initial
// 강제 쇼핑몰 기본설정 교체: pnpm --filter api db:seed-initial -- --force-shop-defaults
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPool } from 'mysql2/promise';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  normalizeShopBankAccount,
  normalizeShopBusinessValue,
  planShopDefaultSeed,
  SHOP_BUSINESS_INFO_FIELDS,
} from '../lib/shop-default-seed';
import type {
  ShopBusinessInfo,
  ShopBusinessInfoColumn,
  ShopDefaultSettings,
} from '../lib/shop-default-seed';
import { seedTemplateItems } from './seed-template-items';

interface ShopDefaultRow extends RowDataPacket {
  de_admin_company_name: string | null;
  de_admin_company_saupja_no: string | null;
  de_admin_company_owner: string | null;
  de_admin_company_tel: string | null;
  de_admin_company_fax: string | null;
  de_admin_tongsin_no: string | null;
  de_admin_buga_no: string | null;
  de_admin_company_zip: string | null;
  de_admin_company_addr: string | null;
  de_admin_info_name: string | null;
  de_admin_info_email: string | null;
  de_bank_use: number | string;
  de_bank_account: string | null;
}

interface SeedInitialOptions {
  forceShopDefaults: boolean;
}

const SHOP_DEFAULT_SELECT = `SELECT
  de_admin_company_name, de_admin_company_saupja_no, de_admin_company_owner,
  de_admin_company_tel, de_admin_company_fax, de_admin_tongsin_no, de_admin_buga_no,
  de_admin_company_zip, de_admin_company_addr, de_admin_info_name, de_admin_info_email,
  de_bank_use, de_bank_account
FROM g5_shop_default`;

async function readShopDefaultRow(pool: Pool): Promise<ShopDefaultRow> {
  const [rows] = await pool.query<ShopDefaultRow[]>(SHOP_DEFAULT_SELECT);
  if (rows.length !== 1) {
    throw new Error(
      `g5_shop_default 싱글턴 행이 정확히 1개여야 합니다 (현재 ${String(rows.length)}개). 그누보드 클린 설치를 먼저 확인하세요.`,
    );
  }
  const row = rows[0];
  if (row === undefined) throw new Error('g5_shop_default 행을 읽지 못했습니다');
  return row;
}

function rowToSettings(row: ShopDefaultRow): ShopDefaultSettings {
  return {
    companyName: row.de_admin_company_name ?? '',
    businessNo: row.de_admin_company_saupja_no ?? '',
    ownerName: row.de_admin_company_owner ?? '',
    tel: row.de_admin_company_tel ?? '',
    fax: row.de_admin_company_fax ?? '',
    mailOrderNo: row.de_admin_tongsin_no ?? '',
    bugaNo: row.de_admin_buga_no ?? '',
    zip: row.de_admin_company_zip ?? '',
    addr: row.de_admin_company_addr ?? '',
    infoManagerName: row.de_admin_info_name ?? '',
    infoManagerEmail: row.de_admin_info_email ?? '',
    bankUse: Number(row.de_bank_use),
    bankAccount: row.de_bank_account ?? '',
  };
}

interface ShopDefaultDbUpdate {
  column: ShopBusinessInfoColumn | 'de_bank_use' | 'de_bank_account';
  value: string | number;
}

function businessUpdateEntries(updates: Partial<ShopBusinessInfo>): ShopDefaultDbUpdate[] {
  const entries: ShopDefaultDbUpdate[] = [];
  for (const field of SHOP_BUSINESS_INFO_FIELDS) {
    const value = updates[field.key];
    if (value !== undefined) entries.push({ column: field.column, value });
  }
  return entries;
}

export async function seedShopDefaultSettings(
  pool: Pool,
  options: SeedInitialOptions,
): Promise<void> {
  const row = await readShopDefaultRow(pool);
  const current = rowToSettings(row);
  if (!Number.isInteger(current.bankUse)) {
    throw new Error(`de_bank_use 값이 숫자가 아닙니다: ${String(row.de_bank_use)}`);
  }

  const decision = planShopDefaultSeed(current, options.forceShopDefaults);
  const updates = businessUpdateEntries(decision.business.updates);
  if (decision.bank.action === 'update') {
    updates.push(
      { column: 'de_bank_use', value: decision.bank.bankUse },
      { column: 'de_bank_account', value: decision.bank.bankAccount },
    );
  }

  if (decision.business.preservedDifferent.length > 0) {
    console.warn(
      `preserve (configured differently): shop business fields [${decision.business.preservedDifferent.join(', ')}] — use --force-shop-defaults to replace intentionally`,
    );
  } else if (Object.keys(decision.business.updates).length === 0) {
    console.log('skip (already seeded): shop business info');
  }

  if (decision.bank.action === 'skip') {
    if (decision.bank.reason === 'already-seeded') {
      console.log('skip (already seeded): shop bank settings');
    } else {
      console.warn(
        'preserve (configured differently): shop bank settings — use --force-shop-defaults to replace intentionally',
      );
    }
  }

  if (updates.length === 0) return;

  // g5_shop_default 는 MyISAM일 수 있으므로 트랜잭션 잠금 대신 읽은 13개 값을 WHERE에 다시 걸어
  // 관리자 동시 변경을 덮어쓰지 않는다. 경합 시 affectedRows=0으로 중단하고 재실행한다.
  const guardColumns = [
    ...SHOP_BUSINESS_INFO_FIELDS.map((field) => field.column),
    'de_bank_use',
    'de_bank_account',
  ] as const;
  const guardValues = [
    ...SHOP_BUSINESS_INFO_FIELDS.map((field) => row[field.column]),
    row.de_bank_use,
    row.de_bank_account,
  ];
  const setSql = updates.map((entry) => `\`${entry.column}\` = ?`).join(', ');
  const guardSql = guardColumns.map((column) => `\`${column}\` <=> ?`).join(' AND ');
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE g5_shop_default SET ${setSql} WHERE ${guardSql} LIMIT 1`,
    [...updates.map((entry) => entry.value), ...guardValues],
  );
  if (result.affectedRows !== 1) {
    throw new Error('쇼핑몰 기본설정이 실행 중 변경되어 초기화를 중단했습니다. 현재값 확인 후 재실행하세요.');
  }

  const verified = rowToSettings(await readShopDefaultRow(pool));
  for (const field of SHOP_BUSINESS_INFO_FIELDS) {
    const expected = decision.business.updates[field.key];
    if (
      expected !== undefined
      && normalizeShopBusinessValue(verified[field.key]) !== normalizeShopBusinessValue(expected)
    ) {
      throw new Error(`사업자정보 저장 후 검증값이 일치하지 않습니다: ${field.key}`);
    }
  }
  if (
    decision.bank.action === 'update'
    && (
      verified.bankUse !== decision.bank.bankUse
      || normalizeShopBankAccount(verified.bankAccount)
        !== normalizeShopBankAccount(decision.bank.bankAccount)
    )
  ) {
    throw new Error('무통장 설정 저장 후 검증값이 일치하지 않습니다');
  }

  const businessUpdateCount = Object.keys(decision.business.updates).length;
  if (businessUpdateCount > 0) {
    console.log(`seeded: shop business info (${String(businessUpdateCount)} fields)`);
  }
  if (decision.bank.action === 'update') {
    console.log(`seeded: shop bank settings (${decision.bank.reason})`);
  }
}

export async function seedInitialData(pool: Pool, options: SeedInitialOptions): Promise<void> {
  await seedTemplateItems(pool);
  await seedShopDefaultSettings(pool, options);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((arg) => arg !== '--');
  const unknownArgs = args.filter((arg) => arg !== '--force-shop-defaults');
  if (unknownArgs.length > 0) {
    throw new Error(`알 수 없는 옵션: ${unknownArgs.join(', ')}`);
  }

  const url = process.env.G5_DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error('G5_DATABASE_URL 이 필요합니다 (apps/api/.env)');
  }
  const pool = createPool({ uri: url.split('?')[0] ?? url, connectionLimit: 2 });
  try {
    await seedInitialData(pool, {
      forceShopDefaults: args.includes('--force-shop-defaults'),
    });
  } finally {
    await pool.end();
  }
}

const invokedFile = process.argv[1];
if (
  invokedFile !== undefined
  && path.resolve(invokedFile) === path.resolve(fileURLToPath(import.meta.url))
) {
  void main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
