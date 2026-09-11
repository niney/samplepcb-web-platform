import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GSmokeRunId,
  localGSmokeTarget,
  readGSmokeFile,
  requireLocalGSmoke,
} from './local-g-smoke';

afterEach(() => {
  vi.unstubAllEnvs();
});
function local() {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('DATABASE_URL', 'mysql://test@localhost:3306/samplepcb');
  vi.stubEnv('G5_DATABASE_URL', 'mysql://test@127.0.0.1:3306/samplepcb');
  vi.stubEnv('WEB_BASE_URL', 'https://local-web.samplepcb.co.kr');
}
describe('보존 스모크 안전 경계', () => {
  it('운영·원격·서로 다른 DB에서는 테스트 대역을 켜지 않는다', () => {
    local();
    expect(localGSmokeTarget()).not.toBeNull();
    vi.stubEnv('NODE_ENV', 'production');
    expect(localGSmokeTarget()).toBeNull();
    expect(() => requireLocalGSmoke()).toThrow();
    local();
    vi.stubEnv('WEB_BASE_URL', 'https://www.samplepcb.co.kr');
    expect(localGSmokeTarget()).toBeNull();
    local();
    vi.stubEnv('DATABASE_URL', 'mysql://test@remote.example:3306/samplepcb');
    expect(localGSmokeTarget()).toBeNull();
    local();
    vi.stubEnv('G5_DATABASE_URL', 'mysql://test@localhost:3306/another_db');
    expect(localGSmokeTarget()).toBeNull();
  });
  it('실행 번호·파일 토큰의 경로 이동을 거부한다', async () => {
    local();
    expect(GSmokeRunId.safeParse('../other-run').success).toBe(false);
    for (const token of [
      'local-g-smoke:../../secret:abc',
      'local-g-smoke:20260910-000000-abcdef:../passwd',
      'https://external.invalid/file',
    ])
      expect(await readGSmokeFile(token)).toBeNull();
  });
});
