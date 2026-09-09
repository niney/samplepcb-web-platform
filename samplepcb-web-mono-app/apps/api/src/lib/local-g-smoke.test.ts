import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyWorkState } from '@sp/api-contract';
import {
  gSmokeCheckpoint,
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
  it('같은 착수 대기 안에서도 입금·자료 준비 변경을 감지한다', () => {
    const detail = {
      status: 'accepted',
      review: { publicReview: null },
      quotes: [
        { quoteId: 1, status: 'accepted', milestones: [{ milestoneId: 1, status: 'pending' }] },
      ],
    };
    const state = emptyWorkState();
    const view = { enabled: true, state, context: null };
    const before = gSmokeCheckpoint(detail, view);
    const milestone = detail.quotes[0]?.milestones[0];
    if (!milestone) throw new Error('fixture');
    milestone.status = 'paid';
    const paid = gSmokeCheckpoint(detail, view);
    expect(paid).not.toBe(before);
    state.materialsReady = true;
    expect(gSmokeCheckpoint(detail, view)).not.toBe(paid);
  });
  it('상태 코드가 같아도 새 공개 버전과 작업 진척도를 구별한다', () => {
    const state = emptyWorkState();
    const view = { enabled: true, state, context: null };
    const detail = { status: 'in_progress', review: { publicReview: null }, quotes: [] };
    state.documents = [
      { id: 'review', kind: 'review', draft: null, publishedVersion: 1, versions: [] },
    ];
    const before = gSmokeCheckpoint(detail, view);
    const doc = state.documents[0];
    if (!doc) throw new Error('fixture');
    doc.publishedVersion = 2;
    expect(gSmokeCheckpoint(detail, view)).not.toBe(before);
    state.plan.tasks = [
      {
        id: 'pcb',
        title: '설계',
        assignee: '',
        status: 'in_progress',
        start: null,
        end: null,
        weight: 100,
        progress: 20,
        customerVisible: true,
        dependencies: [],
        approvalDocumentIds: [],
        note: '',
      },
    ];
    const progress = gSmokeCheckpoint(detail, view);
    const task = state.plan.tasks[0];
    if (!task) throw new Error('fixture');
    task.progress = 60;
    expect(gSmokeCheckpoint(detail, view)).not.toBe(progress);
  });
});
