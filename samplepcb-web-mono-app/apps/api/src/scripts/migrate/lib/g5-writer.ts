// 마이그레이션 전용 g5_* 쓰기 커넥션 — 서비스 접근 카탈로그(lib/g5-db.ts)와 의도적으로 분리한
// "도구" 모듈이다(레거시 legacy-db.ts 와 같은 지위). 서비스 라우트에서 import 금지.
//
// - dateStrings: 레거시에서 읽은 datetime 문자열을 무변환 그대로 타깃에 쓴다(시각 보존).
// - sql_mode='' : 레거시 zero-date('0000-00-00 …') 등 비-strict 값을 그대로 수용
//   (타깃 g5 는 전부 MyISAM 이라 트랜잭션도 없다 — 멱등 재실행이 원자성의 대체).
import { createPool } from 'mysql2/promise';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { asStr, chunk } from './util';

export interface ColumnMeta {
  name: string;
  dataType: string; // int, varchar, text, datetime …
  isNullable: boolean;
  hasDefault: boolean;
  isAutoIncrement: boolean;
  /** 문자 컬럼 최대 길이(character_maximum_length) — 절단 위험 게이트용. 비문자는 null. */
  maxLen: number | null;
}

export type Row = Record<string, unknown>;

function dbNameFromUrl(url: string): string {
  const clean = url.split('?')[0] ?? url;
  return new URL(clean).pathname.replace(/^\//, '');
}

export class G5Writer {
  private readonly pool: Pool;
  readonly dbName: string;

  constructor(url: string | undefined = process.env.G5_DATABASE_URL) {
    if (url === undefined || url === '') {
      throw new Error('G5_DATABASE_URL 이 설정되지 않았습니다 (.env.migration).');
    }
    const clean = url.split('?')[0] ?? url;
    this.dbName = dbNameFromUrl(clean);
    this.pool = createPool({ uri: clean, connectionLimit: 6, dateStrings: true });
    // 새 커넥션마다 strict 모드 해제 — 레거시 원본 값(제로 데이트 등) 무손실 수용.
    this.pool.pool.on('connection', (conn) => {
      conn.query("SET SESSION sql_mode = ''");
    });
  }

  async select(sql: string, params: readonly unknown[] = []): Promise<Row[]> {
    const [rows] = await this.pool.query<RowDataPacket[]>(sql, [...params]);
    return rows;
  }

  async execute(sql: string, params: readonly unknown[] = []): Promise<ResultSetHeader> {
    const [res] = await this.pool.query<ResultSetHeader>(sql, [...params]);
    return res;
  }

  async exists(table: string, where: Row): Promise<boolean> {
    const keys = Object.keys(where);
    const cond = keys.map((k) => `\`${k}\` = ?`).join(' AND ');
    const rows = await this.select(
      `SELECT 1 FROM \`${table}\` WHERE ${cond} LIMIT 1`,
      keys.map((k) => where[k]),
    );
    return rows.length > 0;
  }

  /** 단건 INSERT — insertId 반환(AUTO_INCREMENT 테이블용). */
  async insertRow(table: string, row: Row): Promise<number> {
    const keys = Object.keys(row);
    const sql = `INSERT INTO \`${table}\` (${keys.map((k) => `\`${k}\``).join(', ')})
                 VALUES (${keys.map(() => '?').join(', ')})`;
    const res = await this.execute(
      sql,
      keys.map((k) => row[k]),
    );
    return res.insertId;
  }

  /** 다건 INSERT — multi-VALUES 배치. 모든 행은 동일 컬럼 집합이어야 한다. */
  async insertMany(table: string, cols: readonly string[], rows: readonly Row[], chunkSize = 300): Promise<number> {
    if (rows.length === 0) return 0;
    let inserted = 0;
    const colSql = cols.map((c) => `\`${c}\``).join(', ');
    for (const part of chunk(rows, chunkSize)) {
      const placeholders = part.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
      const values: unknown[] = [];
      for (const row of part) for (const c of cols) values.push(row[c]);
      const res = await this.execute(
        `INSERT INTO \`${table}\` (${colSql}) VALUES ${placeholders}`,
        values,
      );
      inserted += res.affectedRows;
    }
    return inserted;
  }

  async getColumns(table: string): Promise<ColumnMeta[]> {
    const rows = await this.select(
      `SELECT COLUMN_NAME name, DATA_TYPE dataType, IS_NULLABLE nullable, COLUMN_DEFAULT dflt, EXTRA extra,
              CHARACTER_MAXIMUM_LENGTH maxLen
         FROM information_schema.columns
        WHERE table_schema = DATABASE() AND table_name = ?
        ORDER BY ORDINAL_POSITION`,
      [table],
    );
    return rows.map((r) => ({
      name: asStr(r.name),
      dataType: asStr(r.dataType),
      isNullable: asStr(r.nullable) === 'YES',
      hasDefault: r.dflt !== null,
      isAutoIncrement: asStr(r.extra).includes('auto_increment'),
      maxLen: r.maxLen === null ? null : Number(r.maxLen),
    }));
  }

  async tableExists(table: string): Promise<boolean> {
    const rows = await this.select(
      `SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1`,
      [table],
    );
    return rows.length > 0;
  }

  async showCreateTable(table: string): Promise<string> {
    const rows = await this.select(`SHOW CREATE TABLE \`${table}\``);
    const first = rows[0];
    if (first === undefined) throw new Error(`SHOW CREATE TABLE 실패: ${table}`);
    return asStr(first['Create Table']);
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}

/**
 * 타깃 전용 NOT NULL·무default·비AI 컬럼의 명시 채움값 — strict/모드 무관하게 결정적으로.
 * (예: g5_member.mb_agree_log TEXT NOT NULL, g5_shop_order.od_mod_history TEXT NOT NULL)
 */
export function notNullFiller(meta: ColumnMeta): string | number {
  const numeric = ['int', 'bigint', 'smallint', 'tinyint', 'decimal', 'float', 'double', 'mediumint'];
  if (numeric.includes(meta.dataType)) return 0;
  if (meta.dataType === 'date') return '0000-00-00';
  if (meta.dataType === 'datetime' || meta.dataType === 'timestamp') return '0000-00-00 00:00:00';
  return '';
}
