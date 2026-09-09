import { describe, expect, it } from 'vitest';
import { databaseTarget, restoreDatabaseSnapshot } from './db-snapshot';

describe('DB 원복 대상 보호', () => {
  it('MySQL 시스템 DB와 SQL 식별자가 아닌 이름을 거부한다', () => {
    for (const name of ['mysql', 'information_schema', 'performance_schema', 'sys', 'samplepcb%60%3Bdrop']) expect(() => databaseTarget(`mysql://user:pass@localhost/${name}`)).toThrow();
  });
  it('확인한 DB 이름이 다르면 파일 접근·DB 연결 전에 거부한다', async () => {
    await expect(restoreDatabaseSnapshot('not-a-backup', 'other', databaseTarget('mysql://user:pass@localhost/samplepcb'))).rejects.toThrow('--confirm-database samplepcb');
  });
  it('잘못된 URL 오류에 비밀번호를 포함하지 않는다', () => {
    expect(() => databaseTarget('private-password-not-a-url')).toThrow('DATABASE_URL 형식이 올바르지 않습니다');
  });
});
