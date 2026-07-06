// 레거시 마이그레이션 공용 유틸(순수) — 스크립트 전용(src/scripts/migrate/*), 서비스 코드 import 금지.
import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function asStr(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return '';
}

export function asNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'bigint') return Number(v);
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function asInt(v: unknown): number {
  return Math.trunc(asNum(v));
}

/** '0000-00-00 …'·빈값·파싱 불가를 fallback 으로 흡수하는 레거시 datetime(KST) → Date. */
export function legacyDate(v: unknown, fallback: Date): Date {
  const s = asStr(v).trim();
  if (s === '' || s.startsWith('0000')) return fallback;
  const d = new Date(`${s.replace(' ', 'T')}+09:00`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/** 마이그레이션 고정 UUID 네임스페이스 — 절대 변경 금지(결정적 quoteId=uuidV5(`od:ct`) 의 뿌리). */
export const MIGRATION_UUID_NAMESPACE = '5a3d1c2e-7b64-4f21-9c58-0da1cb21e7f4';

/** RFC 4122 v5(UUID, SHA-1 name-based). 외부 의존성 없이 node:crypto 로 구현. */
export function uuidV5(name: string, namespace: string = MIGRATION_UUID_NAMESPACE): string {
  const nsHex = namespace.replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/i.test(nsHex)) throw new Error(`잘못된 UUID 네임스페이스: ${namespace}`);
  const hash = createHash('sha1')
    .update(Buffer.concat([Buffer.from(nsHex, 'hex'), Buffer.from(name, 'utf8')]))
    .digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b.writeUInt8((b.readUInt8(6) & 0x0f) | 0x50, 6); // version 5
  b.writeUInt8((b.readUInt8(8) & 0x3f) | 0x80, 8); // variant RFC4122
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 정규화(키 정렬) JSON — specHash 계산용. 담기 API 의 관례와 동일하게 키 순서 무관 해시. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    const out: Record<string, unknown> = {};
    for (const [k, v] of entries) out[k] = sortKeysDeep(v);
    return out;
  }
  return value;
}

export function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** 동시성 제한 병렬 실행(외부 의존성 없는 p-limit 대체). 결과는 입력 순서 보존. */
export async function asyncPool<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      const item = items[i] as T; // 경계 검사 후 접근(noUncheckedIndexedAccess 완화)
      results[i] = await worker(item, i);
    }
  });
  await Promise.all(runners);
  return results;
}

/** 플랫폼 루트 .tmp/migrate — 원장·리포트 저장소(gitignore 영역). */
export async function resolveMigrateTmpDir(): Promise<string> {
  // src/scripts/migrate/lib → apps/api → apps → mono-app → 플랫폼 루트 (6단계 상위)
  const dir =
    process.env.MIGRATE_TMP_DIR ??
    fileURLToPath(new URL('../../../../../../.tmp/migrate', import.meta.url));
  await mkdir(dir, { recursive: true });
  return path.resolve(dir);
}
