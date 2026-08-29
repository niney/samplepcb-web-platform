import { createHash } from 'node:crypto';

// AI 입력 해시 — 잡 재사용(캐시)과 등록 시점 신선도(REVIEW_STALE) 판정의 공용 원천.
// jobs.ts 가 DB 저장소가 되면서(2026-08-28) 순수 함수만 여기로 분리했다 — 첨부 전처리
// (attachment-extractor)가 prisma 를 끌어오지 않게 하려는 목적도 겸한다.

export const hashAiText = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const hashAiBytes = (value: Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

export const hashAiInput = (value: unknown): string => hashAiText(JSON.stringify(value));
