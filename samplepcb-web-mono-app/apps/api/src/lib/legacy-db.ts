// 레거시 그누보드/영카트 DB(읽기 전용) 커넥션.
//
// ⚠️ 마이그레이션/검증 스크립트(src/scripts/*) 전용이다.
//    서비스 라우트(src/routes/*)에서 import 금지 — 그누보드 스키마 직접 결합 금지
//    원칙(AGENTS.md)은 서비스 코드 기준이며, 이 모듈은 그 예외(도구)로만 존재한다.
//
// - Prisma 로 잡지 않는 이유: 레거시 스키마는 우리 소유가 아니고 introspect 유지비만 든다.
// - legacySelect 가 SELECT 이외의 SQL 을 거부해 읽기 전용을 강제한다.

import { createPool } from 'mysql2/promise';
import type { Pool } from 'mysql2/promise';

let pool: Pool | null = null;

function getLegacyPool(): Pool {
  if (!pool) {
    const url = process.env.LEGACY_DATABASE_URL;
    if (!url) {
      throw new Error(
        'LEGACY_DATABASE_URL 이 설정되지 않았습니다. apps/api/.env 에 ' +
          'mysql://user:pass@127.0.0.1:3306/<그누보드DB> 형식으로 추가하세요.',
      );
    }
    pool = createPool({
      // JDBC 식 쿼리 파라미터(useSSL 등)는 mysql2 가 모르는 옵션이므로 제거.
      uri: url.split('?')[0] ?? url,
      connectionLimit: 4,
      // 레거시 datetime 은 변환 없이 문자열 그대로 받는다(JSON 덤프 목적).
      dateStrings: true,
    });
  }
  return pool;
}

/** 결과 행. 컬럼 타입은 호출부에서 unknown 으로 좁혀 쓴다. */
export type LegacyRow = Record<string, unknown>;

/**
 * SELECT 전용 쿼리 실행. SELECT 로 시작하지 않는 SQL 은 거부한다.
 * (커넥션 계정 자체도 읽기 전용 권한 계정을 권장)
 */
export async function legacySelect(
  sql: string,
  params: readonly (string | number)[] = [],
): Promise<LegacyRow[]> {
  if (!/^\s*select\b/i.test(sql)) {
    throw new Error('legacySelect 는 SELECT 문만 허용합니다 (레거시 DB는 읽기 전용).');
  }
  const [rows] = await getLegacyPool().query(sql, [...params]);
  if (!Array.isArray(rows)) {
    throw new Error('SELECT 결과가 행 배열이 아닙니다.');
  }
  // 구형 MySQL(5.1) 서버는 varchar 컬럼을 mysql2 가 매핑 못 하는 collation 으로
  // 내려보내 Buffer 로 돌아온다. 그누보드 DB는 utf8 이므로 여기서 일괄 디코드.
  const decoded = (rows as LegacyRow[]).map((row) => {
    for (const [key, value] of Object.entries(row)) {
      if (Buffer.isBuffer(value)) row[key] = value.toString('utf8');
    }
    return row;
  });
  return decoded;
}

/** 스크립트 종료 시 풀 정리. */
export async function closeLegacyPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
