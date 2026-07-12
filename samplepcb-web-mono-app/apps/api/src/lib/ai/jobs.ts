import { randomUUID } from 'node:crypto';
import type { AiJobStatusType, AiUsecaseKeyType } from '@sp/api-contract';

// 인메모리 AI 잡 스토어 — 생성이 수 분이라 run 은 즉시 jobId 반환, 클라이언트 폴링.
// 단일 인스턴스 전제(MVP): 재시작 시 소실되며 클라이언트는 error 로 보고 재시도한다.
// 다중 인스턴스로 가면 sp_* 테이블 저장으로 승격(설계상 인터페이스 동일).

export interface AiJob {
  id: string;
  useCase: AiUsecaseKeyType;
  mbId: string; // 소유자 — 본인 잡만 조회 가능
  status: AiJobStatusType;
  html: string | null; // HTML 산출 유스케이스(구성도)
  json: string | null; // JSON 산출 유스케이스(구성 명세 — 정규화된 직렬화 문자열)
  md: string | null; // 마크다운 산출 유스케이스(작업검토지시서)
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
}

const jobs = new Map<string, AiJob>();
const JOB_TTL_MS = 60 * 60 * 1000; // 완료 후 1시간 뒤 정리(lazy)

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (job.finishedAt !== null && now - job.finishedAt > JOB_TTL_MS) jobs.delete(id);
  }
}

export function createAiJob(useCase: AiUsecaseKeyType, mbId: string): AiJob {
  sweep();
  const job: AiJob = {
    id: randomUUID(),
    useCase,
    mbId,
    status: 'running',
    html: null,
    json: null,
    md: null,
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
  };
  jobs.set(job.id, job);
  return job;
}

export function getAiJob(id: string): AiJob | undefined {
  sweep();
  return jobs.get(id);
}

export function finishAiJob(
  id: string,
  result: { html: string } | { json: string } | { md: string } | { error: string },
): void {
  const job = jobs.get(id);
  if (job === undefined) return;
  job.finishedAt = Date.now();
  if ('html' in result) {
    job.status = 'done';
    job.html = result.html;
  } else if ('json' in result) {
    job.status = 'done';
    job.json = result.json;
  } else if ('md' in result) {
    job.status = 'done';
    job.md = result.md;
  } else {
    job.status = 'error';
    job.error = result.error;
  }
}
