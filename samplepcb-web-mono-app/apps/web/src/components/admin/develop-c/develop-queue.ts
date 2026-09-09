import { DEVELOP_ADMIN_TABS } from '@sp/api-contract/develop-c';
import type { DevelopAdminTabType } from '@sp/api-contract/develop-c';

// 개발 모듈 워크큐(docs/DEVELOP_FLOW.md §14) — 공용 표 `DevelopQueueTable.vue` 가 그리는 열과
// 큐별 프리셋. 큐 페이지는 이 상수만 넘기는 얇은 래퍼라, 열 구성이 한 곳에 모인다.
// 라벨은 계약 사전(DEVELOP_ADMIN_TAB_LABELS 등)이 정본이고 여기엔 식별자만 둔다.

export const DEVELOP_QUEUE_COLUMNS = [
  'title',
  'status',
  'owner',
  'contact',
  'ai',
  'quote',
  'assignee',
  'createdAt',
  'progress',
  'docs',
  'inquiry',
  'money', // 수납·미수납(수락 견적 마일스톤) + 열어야 할 수동 청구(2026-09-10)
] as const;
export type DevelopQueueColumn = (typeof DEVELOP_QUEUE_COLUMNS)[number];

// 큐별 열 프리셋(§3.2) — 단계마다 "지금 봐야 하는 것"만 남긴다.
export const DEVELOP_QUEUE_PRESETS = {
  // 전체 의뢰(기존 워크큐) — 기존 화면과 같은 8열.
  requests: ['title', 'status', 'owner', 'contact', 'ai', 'quote', 'assignee', 'createdAt'],
  intake: ['title', 'status', 'owner', 'contact', 'ai', 'assignee', 'createdAt'],
  contracts: ['title', 'status', 'quote', 'money', 'assignee', 'createdAt'],
  projects: ['title', 'progress', 'docs', 'money', 'inquiry', 'assignee'],
  // 잔금 마일스톤 상태는 latestQuote 로 알 수 없어 견적 열 대신 수납·청구 열(ops)을 둔다.
  deliveries: ['title', 'status', 'docs', 'money', 'createdAt'],
  inquiries: ['title', 'status', 'inquiry', 'assignee'],
} as const satisfies Record<string, readonly DevelopQueueColumn[]>;

// 전체 의뢰 탭 바 — intake·contract 는 합산 탭이라 숨긴다(§5: 같은 건이 두 번 세어진다).
export const DEVELOP_REQUESTS_TABS: readonly DevelopAdminTabType[] = DEVELOP_ADMIN_TABS.filter(
  (tab) => tab !== 'intake' && tab !== 'contract',
);
