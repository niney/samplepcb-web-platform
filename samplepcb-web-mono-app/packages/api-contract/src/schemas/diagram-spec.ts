import { z } from 'zod';

// ── 구성 명세(DiagramSpec) — 시스템 구성도의 피벗 JSON ──────────────────────
// LLM 산출을 스키마로 정규화한다: enum 이탈은 .catch 로 안전값으로 흡수(프로빙 실측 —
// glm·deepseek 모두 flow "debug" 슬립), 알 수 없는 키는 zod 기본 strip. 구조 결함
// (미정의 그룹·끊긴 연결)은 normalizeDiagramSpec 이 보정한다 — 실패 대신 복구가 원칙.
// 렌더는 @sp/utils renderDiagramSpecHtml(결정적 SVG). 2026-08-28 ai.ts 에서 분리 —
// AI 사전 검토서(market-dev-review.ts)가 같은 명세를 품는다.

export const DIAGRAM_BLOCK_TYPES = [
  'power', 'controller', 'communication', 'sensor', 'input', 'output', 'driver',
  'storage', 'debug', 'ui', 'external', 'mechanical', 'protection',
  'client', 'service', 'api', 'database', 'cache', 'queue', 'worker', 'operations', 'other',
] as const;

const specId = z.string().trim().min(1).max(60);

export const DiagramSpec = z.object({
  project: z.object({
    name: z.string().trim().min(1).max(200),
    summary: z.string().trim().max(500).catch(''),
    stage: z.string().trim().max(40).catch(''),
    service_type: z.string().trim().max(40).catch(''),
  }),
  groups: z.array(z.object({ id: specId, label: z.string().trim().min(1).max(80) })).min(1).max(12),
  blocks: z
    .array(
      z.object({
        id: specId,
        group: specId,
        type: z.enum(DIAGRAM_BLOCK_TYPES).catch('other'),
        label: z.string().trim().min(1).max(200),
        status: z.enum(['confirmed', 'tbd', 'option']).catch('tbd'),
      }),
    )
    .min(1)
    .max(80),
  connections: z
    .array(
      z.object({
        from: specId,
        to: specId,
        interface: z.string().trim().max(60).catch(''),
        flow: z.enum(['power', 'data', 'control', 'feedback']).catch('data'),
      }),
    )
    .max(160)
    .catch([]),
  constraints: z.array(z.string().trim().min(1).max(300)).max(20).catch([]),
  feature_highlights: z.array(z.string().trim().min(1).max(200)).max(20).catch([]),
  questions_missing: z
    .array(z.object({ topic: z.string().trim().max(60).catch(''), question: z.string().trim().min(1).max(500) }))
    .max(20)
    .catch([]),
});
export type DiagramSpecType = z.infer<typeof DiagramSpec>;

// 구조 보정 — 블록이 참조하는 미정의 그룹은 자동 생성, 끊긴 연결은 제거, 중복 블록 id 는
// 뒤엣것을 버린다. LLM 재호출 없이 렌더 가능한 상태로 만드는 최소 수리.
export function normalizeDiagramSpec(spec: DiagramSpecType): DiagramSpecType {
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const groups = [...spec.groups];
  const seenBlocks = new Set<string>();
  const blocks = spec.blocks.filter((b) => {
    if (seenBlocks.has(b.id)) return false;
    seenBlocks.add(b.id);
    if (!groupIds.has(b.group)) {
      groupIds.add(b.group);
      groups.push({ id: b.group, label: b.group.replaceAll('_', ' ').toUpperCase() });
    }
    return true;
  });
  const connections = spec.connections.filter(
    (c) => seenBlocks.has(c.from) && seenBlocks.has(c.to) && c.from !== c.to,
  );
  return { ...spec, groups, blocks, connections };
}

// Ollama `format`(구조화 출력)용 JSON 스키마 — 위 zod 와 같은 형태를 유지할 것.
export const DIAGRAM_SPEC_JSON_SCHEMA = {
  type: 'object',
  required: ['project', 'groups', 'blocks', 'connections'],
  properties: {
    project: {
      type: 'object',
      required: ['name', 'summary', 'stage', 'service_type'],
      properties: {
        name: { type: 'string' },
        summary: { type: 'string' },
        stage: { type: 'string', enum: ['idea', 'spec', 'schematic', 'pcb', 'gerber', 'pcba'] },
        service_type: { type: 'string', enum: ['full', 'single', 'review', 'production'] },
      },
    },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label'],
        properties: { id: { type: 'string' }, label: { type: 'string' } },
      },
    },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'group', 'type', 'label', 'status'],
        properties: {
          id: { type: 'string' },
          group: { type: 'string' },
          type: { type: 'string', enum: [...DIAGRAM_BLOCK_TYPES] },
          label: { type: 'string' },
          status: { type: 'string', enum: ['confirmed', 'tbd', 'option'] },
        },
      },
    },
    connections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['from', 'to', 'interface', 'flow'],
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          interface: { type: 'string' },
          flow: { type: 'string', enum: ['power', 'data', 'control', 'feedback'] },
        },
      },
    },
    constraints: { type: 'array', items: { type: 'string' } },
    feature_highlights: { type: 'array', items: { type: 'string' } },
  },
} as const;
