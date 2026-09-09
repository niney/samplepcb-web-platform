import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { existsSync } from 'node:fs';
import type { WorkViewType } from '@sp/api-contract';
import { prisma } from './prisma';

// 로컬 실행 원장에 등록된 전용 의뢰만 대역을 사용한다. 운영에는 .tmp 원장을 배포하지 않는다.
const here = dirname(fileURLToPath(import.meta.url));
const repository = [resolve(here, '../../../../..'), resolve(here, '../../../..')].find((path) =>
  existsSync(join(path, 'samplepcb-web-mono-app/apps/api/package.json')),
);
export const gSmokeRoot = resolve(repository ?? here, '.tmp/develop-g-smoke');
export const GSmokeRunId = z.string().regex(/^\d{8}-\d{6}-[a-f0-9]{6}$/);
export const GSmokeTarget = z.object({
  database: z.string(),
  host: z.string(),
  port: z.number(),
  origin: z.string(),
});
export const GSmokeRegistration = z.object({
  format: z.literal(1),
  runId: GSmokeRunId,
  ownerId: z.string().regex(/^g_smoke_[a-f0-9]{8}$/),
  target: GSmokeTarget,
});
export type GSmokeRegistrationType = z.infer<typeof GSmokeRegistration>;

// 같은 accepted/in_progress 상태 안의 입금·자료·승인 단계도 구별한다. 조회 시각은 제외한다.
export function gSmokeCheckpoint(
  detail: {
    status: string;
    review: { publicReview: unknown };
    quotes: readonly {
      quoteId: number;
      status: string;
      milestones: readonly { milestoneId: number; status: string }[];
    }[];
  },
  workflow: Pick<WorkViewType, 'enabled' | 'state' | 'context'>,
): string {
  return JSON.stringify({
    status: detail.status,
    reviewPublished: detail.review.publicReview !== null,
    quotes: detail.quotes.map((q) => ({
      id: q.quoteId,
      status: q.status,
      milestones: q.milestones.map((m) => ({ id: m.milestoneId, status: m.status })),
    })),
    enabled: workflow.enabled,
    materialsReady: workflow.state?.materialsReady ?? false,
    locked: workflow.context?.deliverablesLocked ?? null,
    tasks:
      workflow.state?.plan.tasks.map((t) => ({
        id: t.id,
        status: t.status,
        progress: t.progress,
        dependencies: t.dependencies,
        approvals: t.approvalDocumentIds,
      })) ?? [],
    documents:
      workflow.state?.documents.map((d) => ({
        id: d.id,
        version: d.publishedVersion,
        decision: d.versions.find((v) => v.version === d.publishedVersion)?.decision ?? null,
      })) ?? [],
  });
}
export function localGSmokeTarget(): z.infer<typeof GSmokeTarget> | null {
  if (repository === undefined || process.env.NODE_ENV === 'production') return null;
  try {
    const db = new URL(process.env.DATABASE_URL ?? '');
    const g5 = new URL(process.env.G5_DATABASE_URL ?? '');
    const web = new URL(process.env.WEB_BASE_URL ?? 'https://local-web.samplepcb.co.kr');
    const loopback = (host: string): boolean => ['localhost', '127.0.0.1', '[::1]'].includes(host);
    if (
      db.protocol !== 'mysql:' ||
      g5.protocol !== 'mysql:' ||
      web.protocol !== 'https:' ||
      !loopback(db.hostname) ||
      !loopback(g5.hostname) ||
      db.pathname !== g5.pathname ||
      (db.port || '3306') !== (g5.port || '3306') ||
      web.hostname !== 'local-web.samplepcb.co.kr'
    )
      return null;
    return {
      database: decodeURIComponent(db.pathname.slice(1)),
      host: 'loopback',
      port: Number(db.port || 3306),
      origin: web.origin,
    };
  } catch {
    return null;
  }
}
export function requireLocalGSmoke(): z.infer<typeof GSmokeTarget> {
  const target = localGSmokeTarget();
  if (target === null)
    throw new Error(
      '개발(G) 보존 테스트는 local-web 도메인의 로컬 공유 DB에서만 실행할 수 있습니다.',
    );
  return target;
}
export const gSmokePrefix = (runId: string): string => `[G-TEST:${GSmokeRunId.parse(runId)}]`;
export const gSmokeRunDirectory = (runId: string): string =>
  join(gSmokeRoot, 'runs', GSmokeRunId.parse(runId));
export async function registerGSmokeRun(run: GSmokeRegistrationType): Promise<void> {
  const target = requireLocalGSmoke();
  if (JSON.stringify(target) !== JSON.stringify(run.target))
    throw new Error('테스트 DB 대상이 다릅니다.');
  await mkdir(join(gSmokeRoot, 'registry'), { recursive: true });
  await mkdir(gSmokeRunDirectory(run.runId), { recursive: true });
  await writeFile(join(gSmokeRoot, 'registry', `${run.runId}.json`), JSON.stringify(run), {
    flag: 'wx',
    mode: 0o600,
  });
}
export async function localGSmokeRun(requestId: bigint): Promise<GSmokeRegistrationType | null> {
  const target = localGSmokeTarget();
  if (target === null) return null;
  let names: string[];
  try {
    names = await readdir(join(gSmokeRoot, 'registry'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (names.length === 0) return null;
  const record = await prisma.spDevelopRequest.findUnique({
    where: { id: requestId },
    select: { mbId: true, title: true, prototype: { select: { variant: true } } },
  });
  if (
    record === null ||
    record.prototype?.variant === 'c' ||
    !/^g_smoke_[a-f0-9]{8}$/.test(record.mbId) ||
    !record.title.startsWith('[G-TEST:')
  )
    return null;
  for (const name of names) {
    if (!/^\d{8}-\d{6}-[a-f0-9]{6}\.json$/.test(name)) continue;
    const run = GSmokeRegistration.parse(
      JSON.parse(await readFile(join(gSmokeRoot, 'registry', name), 'utf8')) as unknown,
    );
    if (
      JSON.stringify(run.target) === JSON.stringify(target) &&
      run.ownerId === record.mbId &&
      record.title.startsWith(`${gSmokePrefix(run.runId)} `)
    )
      return run;
  }
  return null;
}
export async function captureGSmokeMail(
  requestId: bigint,
  mail: { to: string; subject: string; html: string },
): Promise<boolean> {
  const run = await localGSmokeRun(requestId);
  if (run === null) return false;
  const folder = join(gSmokeRunDirectory(run.runId), 'mail');
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, `${Date.now().toString()}-${randomUUID()}.json`),
    JSON.stringify(
      {
        requestId: Number(requestId),
        capturedAt: new Date().toISOString(),
        delivery: 'local-capture',
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  return true;
}
const TOKEN = /^local-g-smoke:(\d{8}-\d{6}-[a-f0-9]{6}):([a-f0-9]{32})$/;
const LocalFile = z.object({ name: z.string(), contentType: z.string(), size: z.number() });
async function localFilePath(token: string): Promise<string | null> {
  const parts = TOKEN.exec(token);
  if (parts?.[1] === undefined || parts[2] === undefined || localGSmokeTarget() === null)
    return null;
  const run = GSmokeRegistration.parse(
    JSON.parse(await readFile(join(gSmokeRoot, 'registry', `${parts[1]}.json`), 'utf8')) as unknown,
  );
  if (JSON.stringify(run.target) !== JSON.stringify(localGSmokeTarget())) return null;
  return join(gSmokeRunDirectory(run.runId), 'files', parts[2]);
}
export async function writeGSmokeFiles(
  requestId: bigint,
  files: { buffer: Buffer; filename: string; mimetype: string }[],
) {
  const run = await localGSmokeRun(requestId);
  if (run === null) return null;
  const folder = join(gSmokeRunDirectory(run.runId), 'files');
  await mkdir(folder, { recursive: true });
  const result: {
    uploadFileName: string;
    originFileName: string;
    pathToken: string;
    size: number;
  }[] = [];
  for (const file of files) {
    const id = randomUUID().replaceAll('-', '');
    const base = join(folder, id);
    await writeFile(`${base}.bin`, file.buffer, { flag: 'wx', mode: 0o600 });
    await writeFile(
      `${base}.json`,
      JSON.stringify({ name: file.filename, contentType: file.mimetype, size: file.buffer.length }),
      { flag: 'wx', mode: 0o600 },
    );
    result.push({
      uploadFileName: id,
      originFileName: file.filename,
      pathToken: `local-g-smoke:${run.runId}:${id}`,
      size: file.buffer.length,
    });
  }
  return result;
}
export async function readGSmokeFile(
  token: string,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const base = await localFilePath(token);
  if (base === null) return null;
  const metadata = LocalFile.parse(JSON.parse(await readFile(`${base}.json`, 'utf8')) as unknown);
  return { buffer: await readFile(`${base}.bin`), contentType: metadata.contentType };
}
export async function deleteGSmokeFile(token: string): Promise<void> {
  const base = await localFilePath(token);
  if (base === null) throw new Error('로컬 테스트 파일 범위를 확인할 수 없습니다.');
  for (const suffix of ['.bin', '.json'])
    await unlink(`${base}${suffix}`).catch((error: unknown) => {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    });
}
