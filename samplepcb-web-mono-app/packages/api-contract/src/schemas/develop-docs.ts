import { z } from 'zod';
import { MarketFileMeta } from './market';

// ── 개발의뢰 프로젝트 문서·업무표(docs/DEVELOP_FLOW.md §13, 2026-09-09 · 2026-09-11 간소화) ──────────
// 프로토타입 「개발프로젝트 업무관리 서식」 10장을 계약 이후(in_progress) 구간의 문서 층으로 옮긴 계약.
// 2026-09-11 간소화(간편 서식 6장, 사용자 결정): 문서 8종 → 5종.
//   · 착수회의록+계약서 → 「계약·개발착수 확인」(계약 부분은 수락 견적 스냅샷·읽기 전용 — 손으로 다시 적어 견적과 어긋나지 않게)
//   · 중간검토·제작승인·시험검토 → 「단계별 검토·승인」 1종(검토 단계 select 8종, 제작 단계에서만 승인 범위 체크리스트)
//   · 수행계획 문서 → 의뢰 컬럼 3개(baseStartOn·plannedEndOn·expectedEndOn, 바뀌면 schedule_changed 이벤트가 이력)
//   · 승인형 4종은 같은 결정 블록(라디오+의견+이름), 라벨만 종류별 사전 — 메일 초안도 같은 사전에서 선택지를 읽는다
// 문서는 한 테이블(sp_develop_document — type + 필드 스펙 JSON)이고 업무표(WBS)는 sp_develop_task 다.
// 프로토타입에서 일부러 안 가져온 것: localStorage 저장 · 키워드 조합 가짜 AI · 순서 기반 가짜 간트 위치 · 단순 평균 달성도(기간 가중으로).

// ── 문서 종류 ──────────────────────────────────────────────────────────────────
export const DEVELOP_DOC_TYPES = [
  'kickoff', // 01 계약 및 개발착수 확인 (승인형 — 계약 요약은 수락 견적에서 스냅샷, 읽기 전용)
  'stage_review', // 03 단계별 검토 및 승인 (승인형 — 설계 검토·제작 승인·시험 결과를 한 서식으로)
  'change_request', // 04 개발 변경요청 (승인형 — 승인되면 change 견적 초안)
  'delivery_confirm', // 05 최종 납품 및 개발완료 확인 (승인형 — delivered 에서 승인=검수 확정)
  'progress_report', // 00/06 정기 진행보고 (공유형 — 현황 화면의 여섯 칸)
] as const;
export type DevelopDocTypeType = (typeof DEVELOP_DOC_TYPES)[number];
export const DevelopDocType = z.enum(DEVELOP_DOC_TYPES);
export const DEVELOP_DOC_TYPE_LABELS = {
  kickoff: '계약·개발착수 확인',
  stage_review: '단계별 검토·승인',
  change_request: '개발 변경요청서',
  delivery_confirm: '최종 납품·개발완료 확인서',
  progress_report: '정기 진행보고',
} as const satisfies Record<DevelopDocTypeType, string>;
// 문서번호 접두 — `REV-01` 처럼 종류별 일련번호(seq)와 합친다(간편 서식 REV-001·CR-001 계승).
export const DEVELOP_DOC_TYPE_CODES = {
  kickoff: 'KO',
  stage_review: 'REV',
  change_request: 'CR',
  delivery_confirm: 'DC',
  progress_report: 'PR',
} as const satisfies Record<DevelopDocTypeType, string>;
export const developDocNo = (type: DevelopDocTypeType, seq: number): string =>
  `${DEVELOP_DOC_TYPE_CODES[type]}-${String(seq).padStart(2, '0')}`;
// 2026-09-11 전 종류 → 새 종류. 서버 읽기 폴백과 마이그레이션이 같은 표를 쓴다(plan 은 문서가 아니라 의뢰 컬럼이 됐다).
export const DEVELOP_DOC_LEGACY_TYPES: Readonly<Record<string, DevelopDocTypeType>> = {
  design_review: 'stage_review',
  production_approval: 'stage_review',
  test_report: 'stage_review',
};

// 승인형(고객 결정을 받는다) / 공유형(보내면 끝, 의견은 기존 문의로). 사용자 결정 2(2026-09-09) · 2026-09-11 결정 1(계약·착수 확인도 승인형).
export const DEVELOP_DOC_APPROVAL_TYPES = ['kickoff', 'stage_review', 'change_request', 'delivery_confirm'] as const;
export const isDevelopDocApproval = (type: DevelopDocTypeType): boolean =>
  (DEVELOP_DOC_APPROVAL_TYPES as readonly string[]).includes(type);

// 어느 상태에서 만들 수 있나 — 착수 뒤 문서라 accepted 이후. delivery_confirm 은 납품 뒤에만 뜻이 있다.
export const DEVELOP_DOC_ALLOWED_STATUSES = ['accepted', 'in_progress', 'delivered', 'completed'] as const;

// ── 상태·결정 ──────────────────────────────────────────────────────────────────
export const DEVELOP_DOC_DECISIONS = ['approved', 'conditional', 'changes_requested', 'discuss_requested', 'rejected'] as const;
export type DevelopDocDecisionType = (typeof DEVELOP_DOC_DECISIONS)[number];
export const DevelopDocDecision = z.enum(DEVELOP_DOC_DECISIONS);

export const DEVELOP_DOC_STATUSES = ['draft', 'sent', ...DEVELOP_DOC_DECISIONS, 'superseded'] as const;
export type DevelopDocStatusType = (typeof DEVELOP_DOC_STATUSES)[number];
export const DevelopDocStatus = z.enum(DEVELOP_DOC_STATUSES);
export const DEVELOP_DOC_STATUS_LABELS = {
  draft: '작성 중',
  sent: '고객 확인 대기',
  approved: '승인',
  conditional: '조건부 승인',
  changes_requested: '수정 후 재검토',
  discuss_requested: '협의 필요',
  rejected: '기존 범위 유지',
  superseded: '이전 버전',
} as const satisfies Record<DevelopDocStatusType, string>;

// 문서 종류별 고객 결정 선택지(프로토타입 4택 — 변경요청·납품확인은 문안이 다르다). 순서가 화면 순서.
export interface DevelopDocDecisionOption {
  code: DevelopDocDecisionType;
  label: string;
}
const DEFAULT_DECISIONS: readonly DevelopDocDecisionOption[] = [
  { code: 'approved', label: '승인합니다' },
  { code: 'changes_requested', label: '수정 후 다시 검토해 주세요' },
  { code: 'discuss_requested', label: '담당자 협의가 필요합니다' },
  { code: 'conditional', label: '조건부 승인합니다' },
];
export const DEVELOP_DOC_DECISION_OPTIONS: Record<DevelopDocTypeType, readonly DevelopDocDecisionOption[]> = {
  kickoff: DEFAULT_DECISIONS,
  stage_review: DEFAULT_DECISIONS,
  change_request: [
    { code: 'approved', label: '변경 적용 승인' },
    { code: 'rejected', label: '기존 범위 유지' },
    { code: 'changes_requested', label: '내용 수정 후 재검토' },
    { code: 'discuss_requested', label: '담당자 협의 필요' },
  ],
  delivery_confirm: [
    { code: 'approved', label: '납품 승인' },
    { code: 'changes_requested', label: '보완 후 승인' },
    { code: 'discuss_requested', label: '추가 협의' },
  ],
  progress_report: [],
};
export const developDocDecisionLabel = (type: DevelopDocTypeType, decision: DevelopDocDecisionType): string =>
  DEVELOP_DOC_DECISION_OPTIONS[type].find((o) => o.code === decision)?.label ?? DEVELOP_DOC_STATUS_LABELS[decision];

// 상태 라벨(종류 반영) — 공유형 문서의 sent 는 고객 결정을 받지 않으므로 '고객 확인 대기'가 아니라 '공유됨'. 결정 상태는 종류별 문안.
export function developDocStatusLabel(type: DevelopDocTypeType, status: DevelopDocStatusType): string {
  if (status === 'sent') return isDevelopDocApproval(type) ? DEVELOP_DOC_STATUS_LABELS.sent : '공유됨';
  if (status === 'draft' || status === 'superseded') return DEVELOP_DOC_STATUS_LABELS[status];
  return developDocDecisionLabel(type, status);
}

// ── 필드 스펙 — 문서 5종의 폼·뷰·메일 본문을 한 스펙으로 그린다 ────────────────────────────
export type DevelopDocFieldKind = 'text' | 'textarea' | 'date' | 'datetime' | 'select' | 'checklist' | 'table';
export interface DevelopDocOption {
  code: string;
  label: string;
}
export interface DevelopDocColumn {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'select';
  options?: readonly DevelopDocOption[];
  width?: 'narrow' | 'wide';
}
export interface DevelopDocFieldSpec {
  key: string;
  label: string;
  kind: DevelopDocFieldKind;
  placeholder?: string;
  hint?: string;
  options?: readonly DevelopDocOption[]; // select·checklist
  columns?: readonly DevelopDocColumn[]; // table
  meta?: boolean; // 문서 머리(번호·일자·참석자) 줄에 작게 — 본문 2열 격자가 아니라 한 줄 메타
  readonly?: boolean; // 서버가 채우는 스냅샷(계약 요약) — 편집기는 값만 보여 주고 PATCH 는 원값을 되돌린다
  when?: { key: string; in: readonly string[] }; // 조건부 필드 — content[key] 가 목록에 있을 때만 폼·행·메일에 나타난다
}

// 조건부 필드 판정 — 스펙에 when 이 없으면 항상 활성. 비활성 필드의 값은 저장은 되지만(검증 통과) 화면·메일에는 안 나온다.
export const developDocFieldActive = (spec: DevelopDocFieldSpec, content: DevelopDocContentType): boolean => {
  if (spec.when === undefined) return true;
  const v = content[spec.when.key];
  return typeof v === 'string' && spec.when.in.includes(v);
};

const ta = (key: string, label: string, placeholder?: string): DevelopDocFieldSpec =>
  placeholder === undefined ? { key, label, kind: 'textarea' } : { key, label, kind: 'textarea', placeholder };
const tx = (key: string, label: string, meta = true): DevelopDocFieldSpec => ({ key, label, kind: 'text', meta });
const dt = (key: string, label: string, meta = true): DevelopDocFieldSpec => ({ key, label, kind: 'date', meta });
const sel = (key: string, label: string, options: readonly DevelopDocOption[], meta = true): DevelopDocFieldSpec => ({ key, label, kind: 'select', options, meta });
// 읽기 전용 스냅샷 필드 — 계약 요약(kickoff). 짧은 값은 머리 줄(meta), 긴 값은 본문.
const ro = (key: string, label: string, kind: 'text' | 'textarea' | 'date' = 'text'): DevelopDocFieldSpec =>
  kind === 'textarea' ? { key, label, kind, readonly: true } : { key, label, kind, readonly: true, meta: true };

// 검토 단계 8종(간편 서식 03) — 설계 검토·제작 승인·시험 결과를 한 서식이 나눠 쓴다. 제작 단계(fabrication·smt)에서만 승인 범위 체크리스트가 뜬다.
export const DEVELOP_DOC_REVIEW_STAGES: readonly DevelopDocOption[] = [
  { code: 'system', label: '요구사항·시스템 구성' },
  { code: 'circuit', label: '회로설계' },
  { code: 'pcb', label: 'PCB 부품배치·배선' },
  { code: 'firmware_app', label: '펌웨어·앱·서버' },
  { code: 'mech', label: '기구설계' },
  { code: 'fabrication', label: 'PCB·부품 제작' },
  { code: 'smt', label: 'SMT·조립' },
  { code: 'test', label: '시험·인증' },
];
export const DEVELOP_DOC_PRODUCTION_STAGES = ['fabrication', 'smt'] as const;
export const DEVELOP_DOC_CHECK_RESULTS: readonly DevelopDocOption[] = [
  { code: 'checked', label: '확인' },
  { code: 'unchecked', label: '미확인' },
  { code: 'na', label: '해당 없음' },
];

// 계약 요약 키(kickoff) — 문서 생성 때 수락 견적에서 스냅샷하고 이후엔 읽기 전용. 견적 없이 관리자 착수한 건은 빈 채로 둔다.
export const DEVELOP_DOC_KICKOFF_CONTRACT_KEYS = ['contractOn', 'contractNo', 'contractAmount', 'contractDuration', 'contractScope', 'contractDeliverables'] as const;

export const DEVELOP_DOC_FIELDS: Record<DevelopDocTypeType, readonly DevelopDocFieldSpec[]> = {
  // 01 계약 및 개발착수 확인 — 계약 부분(읽기 전용 스냅샷) + 착수회의 부분(입력 4)
  kickoff: [
    ro('contractOn', '계약일', 'date'),
    ro('contractNo', '계약번호'),
    ro('contractAmount', '계약 금액'),
    ro('contractDuration', '개발 기간'),
    { key: 'meetingAt', label: '착수회의일', kind: 'datetime', meta: true },
    sel('meetingMode', '회의방식', [
      { code: 'online', label: '온라인' },
      { code: 'onsite', label: '대면' },
      { code: 'phone', label: '전화' },
    ]),
    ro('contractScope', '계약 업무범위', 'textarea'),
    ro('contractDeliverables', '납품 결과물', 'textarea'),
    ta('goal', '개발 목적과 주요 기능'),
    ta('customerProvides', '고객 제공자료·장비와 제공일'),
    ta('decisions', '착수회의 결정사항과 다음 업무'),
  ],
  // 03 단계별 검토 및 승인 — 설계 검토·제작 승인·시험 결과 공용. 승인 범위 체크리스트는 제작 단계에서만(실비가 걸리는 승인이라 범위를 남긴다).
  stage_review: [
    sel('stage', '검토 단계', DEVELOP_DOC_REVIEW_STAGES),
    ta('doneWork', '완료 및 검토 내용'),
    ta('asks', '고객에게 확인받을 사항'),
    ta('evidence', '첨부자료·시험결과'),
    {
      key: 'approvalScope',
      label: '제작 승인 범위',
      kind: 'checklist',
      hint: '제작 승인은 부품·PCB 실비가 걸리므로 고객이 승인하는 범위를 체크로 남깁니다.',
      when: { key: 'stage', in: DEVELOP_DOC_PRODUCTION_STAGES },
      options: [
        { code: 'key_parts_preorder', label: '주요 부품 선발주' },
        { code: 'pcb_fab', label: 'PCB 제작' },
        { code: 'all_parts', label: '전체 부품 발주' },
        { code: 'smt', label: 'SMT·수삽' },
        { code: 'assembly', label: '완제품 조립' },
        { code: 'test', label: '시험·검사' },
      ],
    },
    ta('nextAfter', '승인 후 다음 업무와 일정 영향'),
  ],
  // 04 개발 변경요청 — 계약 범위·비용·일정이 달라지는 변경만. 확정 금액은 승인 뒤 자동 생성되는 change 견적이 정한다.
  change_request: [
    tx('requester', '요청자'),
    dt('requestedOn', '요청일'),
    ta('change', '변경 요청내용과 사유'),
    ta('impact', '비용·일정·기술 영향'),
    ta('opinion', '샘플피씨비 검토 및 적용방안'),
  ],
  // 05 최종 납품 및 개발완료 확인 — 하자보수 기간은 날짜 2개(생성 때 납품일+견적 하자보수 일수로 미리 채운다).
  delivery_confirm: [
    dt('deliveredOn', '납품일'),
    dt('warrantyFrom', '하자보수 시작일'),
    dt('warrantyTo', '하자보수 종료일'),
    ta('result', '개발 완료 결과'),
    {
      key: 'deliverables',
      label: '최종 납품물과 파일 버전',
      kind: 'table',
      columns: [
        { key: 'item', label: '납품물', kind: 'text', width: 'wide' },
        { key: 'fileName', label: '파일·제품명과 버전', kind: 'text', width: 'wide' },
        { key: 'check', label: '확인', kind: 'select', options: DEVELOP_DOC_CHECK_RESULTS, width: 'narrow' },
      ],
    },
    ta('remaining', '미완료·제외·추가 협의사항', "없으면 '없음'"),
    ta('followup', '하자보수 및 후속지원'),
  ],
  // 00/06 정기 진행보고 — 간편 서식 00 의 여섯 칸. 보낼 때마다 새 PR-nn 이라 "언제 무엇을 보고했나"가 판으로 남는다.
  progress_report: [
    dt('reportOn', '보고 기준일'),
    dt('nextReportOn', '다음 보고 예정일'),
    ta('doneWork', '완료한 업무', '예: 전원부 및 센서 입력부 회로설계 완료'),
    ta('currentWork', '현재 진행 중인 업무', '예: MCU와 통신 인터페이스 회로설계 진행'),
    ta('nextWork', '다음 예정 업무', '예: 회로검토 후 PCB 부품배치'),
    ta('customerChecks', '고객이 확인하거나 결정할 내용', "없으면 '해당 없음'"),
    ta('issues', '문제점 및 일정 영향', "없으면 '현재 일정 영향 없음'"),
  ],
};

// 납품확인서 납품물 기본 행(프로토타입 placeholder 4줄) — 새 문서에 미리 채운다.
export const DEVELOP_DOC_DELIVERABLE_PRESETS = ['회로·PCB 설계자료', '펌웨어·앱·서버 소스', '시제품·시험·인증자료', '매뉴얼·기타 문서'] as const;

// 종류별 읽기 전용 키 — 서버 PATCH 가 저장된 원값으로 되돌린다(화면이 보내도 무시).
export const developDocReadonlyKeys = (type: DevelopDocTypeType): string[] =>
  DEVELOP_DOC_FIELDS[type].filter((f) => f.readonly === true).map((f) => f.key);

// ── 계약 요약 스냅샷(kickoff) — 수락 견적 → 읽기 전용 본문. 서버가 문서 생성 때 호출한다 ─────────────────
export interface DevelopContractSnapshotSource {
  requestId: number;
  quoteVersion: number;
  acceptedOn: string | null; // YYYY-MM-DD(KST)
  vatMode: 'separate' | 'included' | 'exempt';
  supplyAmount: number;
  vatAmount: number;
  totalAmount: number;
  durationDays: number | null;
  warrantyDays: number | null;
  items: readonly { title: string }[];
  deliverables: readonly string[];
}
const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`;
export function developKickoffContractContent(q: DevelopContractSnapshotSource | null): Record<(typeof DEVELOP_DOC_KICKOFF_CONTRACT_KEYS)[number], string> {
  if (q === null) return { contractOn: '', contractNo: '', contractAmount: '', contractDuration: '', contractScope: '', contractDeliverables: '' };
  const amount =
    q.vatMode === 'exempt'
      ? `합계 ${won(q.totalAmount)} (VAT 면세)`
      : q.vatMode === 'included'
        ? `합계 ${won(q.totalAmount)} (VAT 포함)`
        : `합계 ${won(q.totalAmount)} (공급가 ${won(q.supplyAmount)} + VAT ${won(q.vatAmount)})`;
  const duration = [q.durationDays === null ? '' : `${String(q.durationDays)}일`, q.warrantyDays === null ? '' : `하자보수 ${String(q.warrantyDays)}일`]
    .filter((s) => s !== '')
    .join(' · ');
  return {
    contractOn: q.acceptedOn ?? '',
    contractNo: `DEV-${String(q.requestId)}-Q${String(q.quoteVersion)}`,
    contractAmount: amount,
    contractDuration: duration,
    contractScope: q.items.map((it, i) => `${String(i + 1)}. ${it.title}`).join('\n'),
    contractDeliverables: q.deliverables.join('\n'),
  };
}

// ── 본문(content) — 키 → 값. 값 형태는 스펙 kind 가 정한다 ─────────────────────────────
// text·textarea·date·datetime·select → string(select 는 옵션 코드 또는 '') · checklist → 코드 배열 · table → 행 객체 배열.
const DocText = z.string().max(20000);
const DocCodes = z.array(z.string().max(64)).max(50);
const DocRows = z.array(z.record(z.string().max(64), z.string().max(2000))).max(50);
export const DevelopDocFieldValue = z.union([DocText, DocCodes, DocRows]);
export type DevelopDocFieldValueType = z.infer<typeof DevelopDocFieldValue>;
export const DevelopDocContent = z.record(z.string().max(64), DevelopDocFieldValue);
export type DevelopDocContentType = z.infer<typeof DevelopDocContent>;

export const DEVELOP_DOC_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?$/;

const isRows = (v: DevelopDocFieldValueType): v is Record<string, string>[] =>
  Array.isArray(v) && v.every((row) => typeof row === 'object');
const isCodes = (v: DevelopDocFieldValueType): v is string[] => Array.isArray(v) && v.every((c) => typeof c === 'string');

// 스펙 대조 — 모르는 키·형태 불일치·없는 옵션 코드를 이슈 문자열로. 빈 배열 = 통과. 부분 본문(없는 키)은 허용한다.
export function developDocContentIssues(type: DevelopDocTypeType, content: DevelopDocContentType): string[] {
  const issues: string[] = [];
  const specs = new Map(DEVELOP_DOC_FIELDS[type].map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(content)) {
    const spec = specs.get(key);
    if (spec === undefined) {
      issues.push(`UNKNOWN_FIELD:${key}`);
      continue;
    }
    switch (spec.kind) {
      case 'text':
      case 'textarea':
        if (typeof value !== 'string') issues.push(`TYPE:${key}`);
        break;
      case 'date':
        if (typeof value !== 'string') issues.push(`TYPE:${key}`);
        else if (value !== '' && !DEVELOP_DOC_DATE_RE.test(value)) issues.push(`DATE:${key}`);
        break;
      case 'datetime':
        if (typeof value !== 'string') issues.push(`TYPE:${key}`);
        else if (value !== '' && !DATETIME_RE.test(value)) issues.push(`DATE:${key}`);
        break;
      case 'select':
        if (typeof value !== 'string') issues.push(`TYPE:${key}`);
        else if (value !== '' && !(spec.options ?? []).some((o) => o.code === value)) issues.push(`OPTION:${key}`);
        break;
      case 'checklist':
        if (!isCodes(value)) issues.push(`TYPE:${key}`);
        else if (value.some((c) => !(spec.options ?? []).some((o) => o.code === c))) issues.push(`OPTION:${key}`);
        else if (new Set(value).size !== value.length) issues.push(`DUPLICATE:${key}`);
        break;
      case 'table': {
        if (!isRows(value)) {
          issues.push(`TYPE:${key}`);
          break;
        }
        const cols = new Map((spec.columns ?? []).map((c) => [c.key, c]));
        for (const row of value) {
          for (const [ck, cv] of Object.entries(row)) {
            const col = cols.get(ck);
            if (col === undefined) issues.push(`UNKNOWN_COLUMN:${key}.${ck}`);
            else if (col.kind === 'date' && cv !== '' && !DEVELOP_DOC_DATE_RE.test(cv)) issues.push(`DATE:${key}.${ck}`);
            else if (col.kind === 'select' && cv !== '' && !(col.options ?? []).some((o) => o.code === cv)) issues.push(`OPTION:${key}.${ck}`);
          }
        }
        break;
      }
    }
  }
  return issues;
}

// 빈 본문 — 스펙의 모든 키를 빈 값으로. 납품확인서는 납품물 행을 미리 깐다.
export function emptyDevelopDocContent(type: DevelopDocTypeType): DevelopDocContentType {
  const out: DevelopDocContentType = {};
  for (const f of DEVELOP_DOC_FIELDS[type]) {
    if (f.kind === 'checklist') out[f.key] = [];
    else if (f.kind === 'table') out[f.key] = [];
    else out[f.key] = '';
  }
  if (type === 'delivery_confirm') {
    out.deliverables = DEVELOP_DOC_DELIVERABLE_PRESETS.map((item) => ({ item, fileName: '', check: '' }));
  }
  return out;
}

// 본문이 비었나(보낼 것이 있나) — 문자열 하나라도 있거나 배열에 값 있는 행이 있으면 내용 있음.
export function developDocContentEmpty(content: DevelopDocContentType): boolean {
  for (const v of Object.values(content)) {
    if (typeof v === 'string') {
      if (v.trim() !== '') return false;
    } else if (isRows(v)) {
      if (v.some((row) => Object.values(row).some((c) => c.trim() !== ''))) return false;
    } else if (v.length > 0) return false;
  }
  return true;
}

// 표시·메일용 행 — 스펙 순서대로 라벨·텍스트(빈 값·조건부 비활성 필드는 뺀다). 표는 줄 단위로 편다.
export interface DevelopDocContentRow {
  key: string;
  label: string;
  text: string;
  kind: DevelopDocFieldKind;
}
export function developDocContentRows(type: DevelopDocTypeType, content: DevelopDocContentType): DevelopDocContentRow[] {
  const rows: DevelopDocContentRow[] = [];
  for (const f of DEVELOP_DOC_FIELDS[type]) {
    if (!developDocFieldActive(f, content)) continue;
    const v = content[f.key];
    if (v === undefined) continue;
    let text: string;
    if (typeof v === 'string') {
      text = f.kind === 'select' ? ((f.options ?? []).find((o) => o.code === v)?.label ?? '') : v.trim();
    } else if (isRows(v)) {
      const cols = f.columns ?? [];
      text = v
        .filter((row) => Object.values(row).some((c) => c.trim() !== ''))
        .map((row, i) => {
          const cells = cols
            .map((c) => {
              const raw = row[c.key] ?? '';
              const shown = c.kind === 'select' ? ((c.options ?? []).find((o) => o.code === raw)?.label ?? '') : raw.trim();
              return shown === '' ? null : `${c.label}: ${shown}`;
            })
            .filter((s): s is string => s !== null);
          return `${String(i + 1)}. ${cells.join(' · ')}`;
        })
        .join('\n');
    } else {
      text = v.map((code) => (f.options ?? []).find((o) => o.code === code)?.label ?? code).join(' · ');
    }
    if (text === '') continue;
    rows.push({ key: f.key, label: f.label, text, kind: f.kind });
  }
  return rows;
}

// ── 고객 메일 초안(결정적 — 프로토타입 makeDraft 계승). AI(develop.doc-mail)는 이 초안을 다듬는 선택지 ────
export interface DevelopDocMailDraftInput {
  type: DevelopDocTypeType;
  docNo: string;
  requestTitle: string;
  customerName: string;
  customerCompany: string | null;
  replyDueOn: string | null;
  content: DevelopDocContentType;
}
export interface DevelopDocMailDraft {
  subject: string;
  body: string;
}
export const DEVELOP_DOC_MAIL_SUBJECT_MAX = 200;
export const DEVELOP_DOC_MAIL_BODY_MAX = 20000;

export function buildDevelopDocMailDraft(p: DevelopDocMailDraftInput): DevelopDocMailDraft {
  const label = DEVELOP_DOC_TYPE_LABELS[p.type];
  const approval = isDevelopDocApproval(p.type);
  const rows = developDocContentRows(p.type, p.content);
  const lines = rows.length > 0 ? rows.map((r) => `• ${r.label}: ${r.text.replace(/\n/g, '\n  ')}`) : ['(문서 내용은 의뢰 화면에서 확인해 주세요.)'];
  const who = p.customerCompany === null || p.customerCompany === '' ? `${p.customerName} 담당자님` : `${p.customerCompany} ${p.customerName} 담당자님`;
  const options = DEVELOP_DOC_DECISION_OPTIONS[p.type].map((o) => `- ${o.label}`).join('\n');
  const body = [
    `${who}, 안녕하세요.`,
    `「${p.requestTitle}」 개발 프로젝트의 ${label}(${p.docNo}) 내용을 전달드립니다.`,
    lines.join('\n'),
    approval
      ? `의뢰 화면에서 문서를 확인하시고 아래 중 하나로 회신해 주시기 바랍니다.\n${options}`
      : '계획된 일정에 따라 업무를 계속 진행합니다. 궁금한 점은 의뢰 화면의 문의로 남겨 주세요.',
    p.replyDueOn === null ? '' : `회신 요청일: ${p.replyDueOn}`,
    '감사합니다.\n샘플피씨비 개발팀',
  ]
    .filter((s) => s !== '')
    .join('\n\n');
  return {
    subject: `[샘플피씨비] ${p.requestTitle} ${label}${approval ? ' 및 확인 요청' : ' 안내'}`.slice(0, DEVELOP_DOC_MAIL_SUBJECT_MAX),
    body: body.slice(0, DEVELOP_DOC_MAIL_BODY_MAX),
  };
}

// AI 메일 초안 결과(sp_ai_job resultJson, develop.doc-mail)
export const DEVELOP_DOC_MAIL_VERSION = 1 as const;
export const DevelopDocMailResult = z.object({
  version: z.literal(DEVELOP_DOC_MAIL_VERSION),
  subject: z.string().max(DEVELOP_DOC_MAIL_SUBJECT_MAX),
  body: z.string().max(DEVELOP_DOC_MAIL_BODY_MAX),
  meta: z.object({
    jobId: z.string(),
    model: z.string(),
    promptVersion: z.string(),
    generatedAt: z.string(),
  }),
});
export type DevelopDocMailResultType = z.infer<typeof DevelopDocMailResult>;

// ── 업무표(WBS) — sp_develop_task ─────────────────────────────────────────────
// 6단계는 간편 서식 「전체 진행단계」 그대로(2026-09-11: 요구사항 단계는 계약·착수로 흡수). 의뢰 status 를 늘리지 않는다(결제·잠금과
// 묶여 있다) — 단계는 업무에서 파생. 관리자 표에서 단계 열은 숨기고(칩) 기본 업무·직전 행에서 물려받는다.
export const DEVELOP_TASK_PHASES = ['contract', 'design', 'fabrication', 'assembly', 'certification', 'delivery'] as const;
export type DevelopTaskPhaseType = (typeof DEVELOP_TASK_PHASES)[number];
export const DevelopTaskPhase = z.enum(DEVELOP_TASK_PHASES);
export const DEVELOP_TASK_PHASE_LABELS = {
  contract: '계약·착수',
  design: '설계·개발',
  fabrication: '제작·입고',
  assembly: '조립·시험',
  certification: '인증·보완',
  delivery: '납품·완료',
} as const satisfies Record<DevelopTaskPhaseType, string>;
// 2026-09-11 전 단계 → 새 단계(서버 읽기 폴백·마이그레이션 공용).
export const DEVELOP_TASK_LEGACY_PHASES: Readonly<Record<string, DevelopTaskPhaseType>> = { requirements: 'contract' };

// skipped(제외) — 진행 이력이 있는 행은 지우지 않고 제외한다(G 수행관리 규칙 이식, 2026-09-10). 달성도 가중치·고객 화면에서 빠진다.
export const DEVELOP_TASK_STATUSES = ['planned', 'in_progress', 'customer_review', 'on_hold', 'delayed', 'done', 'skipped'] as const;
export type DevelopTaskStatusType = (typeof DEVELOP_TASK_STATUSES)[number];
export const DevelopTaskStatus = z.enum(DEVELOP_TASK_STATUSES);
export const DEVELOP_TASK_STATUS_LABELS = {
  planned: '예정',
  in_progress: '진행 중',
  customer_review: '고객 검토 대기',
  on_hold: '보류',
  delayed: '지연',
  done: '완료',
  skipped: '제외',
} as const satisfies Record<DevelopTaskStatusType, string>;

export const DevelopTaskInput = z.object({
  // 기존 행이면 그 id(저장이 upsert 라 taskId 가 안 바뀐다) · 새 행은 null. 2026-09-10 전엔 통째 교체라 매번 재발급됐다.
  taskId: z.number().int().positive().nullable().default(null),
  name: z.string().trim().min(1).max(200),
  phase: DevelopTaskPhase,
  status: DevelopTaskStatus.default('planned'),
  startOn: z.string().regex(DEVELOP_DOC_DATE_RE).nullable().default(null),
  endOn: z.string().regex(DEVELOP_DOC_DATE_RE).nullable().default(null),
  // 가중치(bp, 1000 = 10%) — 2026-09-11 간소화 뒤 화면은 안 묻는다(0). 전부 0 이면 달성도는 기간(일수) 가중(developProgressSummary).
  weightBp: z.number().int().min(0).max(10_000).default(0),
  progressPct: z.number().int().min(0).max(100).default(0),
  note: z.string().trim().max(500).nullable().default(null), // 선행업무·비고
  visibleToCustomer: z.boolean().default(false), // 사용자 결정 7(2026-09-11 재확인): 세부 행은 기본 비공개, 단계 요약·달성도만 공개
});
export type DevelopTaskInputType = z.infer<typeof DevelopTaskInput>;

// 상태↔진행률 정합(G 규칙 이식): 완료 ⇔ 100% · 예정 ⇒ 0%. 그 밖의 상태는 자유. 화면은 developTaskIssues 로 먼저 같은 규칙을 검사한다.
export const developTaskCoherent = (t: { status: DevelopTaskStatusType; progressPct: number }): boolean =>
  (t.status === 'done') === (t.progressPct === 100) && (t.status !== 'planned' || t.progressPct === 0);

// 프로젝트 일정 3개(간편 서식 02 머리) — 옛 수행계획(plan) 문서 대신 의뢰 컬럼. 업무표 저장과 함께 보낸다(없으면 그대로).
export const DevelopScheduleInput = z.object({
  baseStartOn: z.string().regex(DEVELOP_DOC_DATE_RE).nullable(),
  plannedEndOn: z.string().regex(DEVELOP_DOC_DATE_RE).nullable(),
  expectedEndOn: z.string().regex(DEVELOP_DOC_DATE_RE).nullable(),
});
export type DevelopScheduleInputType = z.infer<typeof DevelopScheduleInput>;

export const AdminDevelopTasksPutBody = z
  .object({
    tasks: z.array(DevelopTaskInput).max(100),
    // 낙관적 잠금 — 상세 응답 progress.tasksRevision 을 그대로 돌려보낸다. 다르면 409 REVISION_CONFLICT(다른 사람이 먼저 저장).
    // 없으면 검사하지 않는다(옛 화면 호환).
    revision: z.string().max(80).optional(),
    schedule: DevelopScheduleInput.optional(),
  })
  .superRefine((b, ctx) => {
    const s = b.schedule ?? { baseStartOn: null, plannedEndOn: null };
    if (s.baseStartOn !== null && s.plannedEndOn !== null && s.plannedEndOn < s.baseStartOn) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: '계획 완료일이 착수일보다 앞섭니다', path: ['schedule', 'plannedEndOn'] });
    }
    const seen = new Set<number>();
    for (const [i, t] of b.tasks.entries()) {
      if (t.startOn !== null && t.endOn !== null && t.endOn < t.startOn) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '완료일이 시작일보다 앞섭니다', path: ['tasks', i, 'endOn'] });
      }
      if (!developTaskCoherent(t)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: '완료는 100%, 예정은 0% 여야 합니다', path: ['tasks', i, 'progressPct'] });
      }
      if (t.taskId !== null) {
        if (seen.has(t.taskId)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '같은 업무가 두 번 들어 있습니다', path: ['tasks', i, 'taskId'] });
        seen.add(t.taskId);
      }
    }
  });
export type AdminDevelopTasksPutBodyType = z.infer<typeof AdminDevelopTasksPutBody>;

export const DevelopTaskView = DevelopTaskInput.extend({ taskId: z.number(), seq: z.number().int() });
export type DevelopTaskViewType = z.infer<typeof DevelopTaskView>;

// 기본 업무 11개(간편 서식 02 baseTasks) — 코드 상수. 착수일 기준 오프셋·기간(일)이 있어 「착수일 기준 자동배치」가 날짜를 깐다.
// 가중치는 적지 않는다(0) — 달성도는 기간 가중. 공개 여부는 결정 7(세부 행 기본 비공개, 내부 조달 행은 숨김).
export interface DevelopDefaultTaskPlan {
  name: string;
  phase: DevelopTaskPhaseType;
  offsetDays: number;
  durationDays: number;
  visibleToCustomer: boolean;
  note: string | null;
}
export const DEVELOP_DEFAULT_TASK_PLAN: readonly DevelopDefaultTaskPlan[] = [
  { name: '개발착수회의', phase: 'contract', offsetDays: 0, durationDays: 1, visibleToCustomer: true, note: '계약 체결 후' },
  { name: '회로설계', phase: 'design', offsetDays: 1, durationDays: 12, visibleToCustomer: true, note: '착수회의' },
  { name: '펌웨어개발', phase: 'design', offsetDays: 4, durationDays: 18, visibleToCustomer: true, note: '인터페이스 확정 후 병행' },
  { name: '부품발주', phase: 'design', offsetDays: 10, durationDays: 4, visibleToCustomer: false, note: '주요 부품 확정' },
  { name: 'PCB 부품배치', phase: 'design', offsetDays: 13, durationDays: 5, visibleToCustomer: false, note: '회로 검토' },
  { name: 'PCB 배선·설계완료', phase: 'design', offsetDays: 18, durationDays: 10, visibleToCustomer: true, note: '부품배치 승인' },
  { name: 'PCB 제작·입고', phase: 'fabrication', offsetDays: 28, durationDays: 10, visibleToCustomer: true, note: '제작 승인' },
  { name: '부품입고·SMT', phase: 'assembly', offsetDays: 38, durationDays: 8, visibleToCustomer: true, note: 'PCB·부품 입고' },
  { name: '검사·조립·테스트', phase: 'assembly', offsetDays: 46, durationDays: 10, visibleToCustomer: true, note: 'SMT' },
  { name: '인증·보완', phase: 'certification', offsetDays: 56, durationDays: 12, visibleToCustomer: true, note: '통합테스트' },
  { name: '최종 납품', phase: 'delivery', offsetDays: 68, durationDays: 2, visibleToCustomer: true, note: '시험·인증 완료' },
];
export const DEVELOP_DEFAULT_TASKS: readonly DevelopTaskInputType[] = DEVELOP_DEFAULT_TASK_PLAN.map((p) => ({
  taskId: null,
  name: p.name,
  phase: p.phase,
  status: 'planned',
  startOn: null,
  endOn: null,
  weightBp: 0,
  progressPct: 0,
  note: p.note,
  visibleToCustomer: p.visibleToCustomer,
}));

// 날짜 산술(YYYY-MM-DD, UTC 일 단위 — 시간대 무관한 달력 계산).
const DAY_MS = 86_400_000;
export function developAddDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}
export const developDaysBetween = (from: string, to: string): number => {
  const p = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) / DAY_MS;
  };
  return Math.round(p(to) - p(from));
};

// 착수일 기준 자동배치(간편 서식 autoSchedule) — 이름이 기본 업무와 같은 행은 그 오프셋·기간, 아니면 직전 행 완료 다음 날부터 5일.
// 행을 넣거나 이름을 바꿔도 어긋나지 않게 순서가 아니라 이름으로 맞춘다.
export function developAutoScheduleDates(rows: readonly { name: string }[], baseStartOn: string): { startOn: string; endOn: string }[] {
  const byName = new Map(DEVELOP_DEFAULT_TASK_PLAN.map((p) => [p.name, p]));
  const out: { startOn: string; endOn: string }[] = [];
  let cursor = baseStartOn; // 이름이 안 맞는 행이 이어 붙을 자리 — 지금까지 가장 늦은 완료일 다음 날
  for (const row of rows) {
    const plan = byName.get(row.name.trim());
    const startOn = plan === undefined ? cursor : developAddDays(baseStartOn, plan.offsetDays);
    const endOn = developAddDays(startOn, (plan?.durationDays ?? 5) - 1);
    out.push({ startOn, endOn });
    const next = developAddDays(endOn, 1);
    if (next > cursor) cursor = next;
  }
  return out;
}

// 진행 요약 — 달성도(가중 평균)·현재 단계·6단계 상태. 저장하지 않고 매번 계산한다(서버·화면 공용).
export const DEVELOP_PHASE_STATES = ['done', 'now', 'todo'] as const;
export type DevelopPhaseStateType = (typeof DEVELOP_PHASE_STATES)[number];
export const DevelopPhaseSummary = z.object({
  phase: DevelopTaskPhase,
  state: z.enum(DEVELOP_PHASE_STATES),
  taskCount: z.number().int(),
  progressPct: z.number().int(), // 단계 안 가중 평균
});
export type DevelopPhaseSummaryType = z.infer<typeof DevelopPhaseSummary>;

export interface DevelopProgressInputTask {
  phase: DevelopTaskPhaseType;
  status: DevelopTaskStatusType;
  weightBp: number;
  progressPct: number;
  startOn?: string | null;
  endOn?: string | null;
}
export interface DevelopProgressSummary {
  progressPct: number;
  currentPhase: DevelopTaskPhaseType | null;
  phases: DevelopPhaseSummaryType[];
}
// 행의 기간(일수) — 시작·완료일이 모두 있고 순서가 맞을 때만. 달성도 기간 가중의 재료.
const spanDays = (t: DevelopProgressInputTask): number | null => {
  const s = t.startOn ?? null;
  const e = t.endOn ?? null;
  if (s === null || e === null || !DEVELOP_DOC_DATE_RE.test(s) || !DEVELOP_DOC_DATE_RE.test(e) || e < s) return null;
  return developDaysBetween(s, e) + 1;
};
// 제외(skipped) 행은 가중치·평균에서 빠진다 — 삭제 대신 제외하라는 규칙의 짝.
// 가중치(weightBp)를 적은 표는 그대로 가중 평균. 하나도 안 적었으면(간편 서식) **기간(일수)이 무게** — 착수회의 1일과 펌웨어 18일이
// 같은 무게로 세어지는 단순 평균의 왜곡(2026-09-11 검토 모순 4)을 입력 없이 막는다. 날짜 없는 행은 날짜 있는 행들의 평균 기간으로,
// 아무 행에도 날짜가 없으면 단순 평균.
export const developTaskWeights = (input: readonly DevelopProgressInputTask[]): number[] => {
  const manual = input.reduce((a, t) => a + t.weightBp, 0);
  if (manual > 0) return input.map((t) => t.weightBp);
  const spans = input.map(spanDays);
  const dated = spans.filter((n): n is number => n !== null);
  if (dated.length === 0) return input.map(() => 1);
  const fallback = Math.max(1, Math.round(dated.reduce((a, n) => a + n, 0) / dated.length));
  return spans.map((n) => n ?? fallback);
};
const weighted = (input: readonly DevelopProgressInputTask[]): number => {
  const tasks = input.filter((t) => t.status !== 'skipped');
  if (tasks.length === 0) return 0;
  const ws = developTaskWeights(tasks);
  const w = ws.reduce((a, n) => a + n, 0);
  if (w === 0) return Math.round(tasks.reduce((a, t) => a + t.progressPct, 0) / tasks.length);
  return Math.round(tasks.reduce((a, t, i) => a + (ws[i] ?? 0) * t.progressPct, 0) / w);
};
// contractDone: 의뢰가 착수 뒤(in_progress 이후)면 '계약·착수' 단계는 업무가 없어도 done — 견적 수락·착수금이 그 단계다.
// 제외 행만 남은 단계는 업무가 없는 단계로 본다(현재 단계 판정에서 건너뛴다).
export function developProgressSummary(input: readonly DevelopProgressInputTask[], contractDone: boolean): DevelopProgressSummary {
  const tasks = input.filter((t) => t.status !== 'skipped');
  const byPhase = DEVELOP_TASK_PHASES.map((phase) => {
    const list = tasks.filter((t) => t.phase === phase);
    const allDone = list.length > 0 && list.every((t) => t.status === 'done');
    return { phase, list, allDone };
  });
  const firstOpen = byPhase.findIndex((p) => p.list.length > 0 && !p.allDone);
  const anyTasks = tasks.length > 0;
  const lastWithTasks = byPhase.map((p) => p.list.length > 0).lastIndexOf(true);
  const phases: DevelopPhaseSummaryType[] = byPhase.map((p, i) => {
    let state: DevelopPhaseStateType;
    if (p.list.length > 0) state = p.allDone ? 'done' : i === firstOpen ? 'now' : 'todo';
    else if (p.phase === 'contract') state = contractDone ? 'done' : 'todo';
    else if (firstOpen >= 0) state = i < firstOpen ? 'done' : 'todo';
    else state = anyTasks && i <= lastWithTasks ? 'done' : 'todo';
    return { phase: p.phase, state, taskCount: p.list.length, progressPct: weighted(p.list) };
  });
  const current = firstOpen >= 0 ? byPhase[firstOpen] : undefined;
  return { progressPct: weighted(tasks), currentPhase: current?.phase ?? null, phases };
}

// 지연 작업 수 — 완료일이 오늘(KST)보다 앞선데 끝나지 않은 행(제외 제외). 서버 ops·현황 띠·화면 미리보기가 같은 규칙을 쓴다.
// C 의 `delayed` 는 사람이 고르는 상태라 별개다 — 이 수치는 날짜에서 파생된다(G 워크스페이스 overdueTasks 이식).
export const developOverdueTaskCount = (
  tasks: readonly { status: DevelopTaskStatusType; endOn: string | null }[],
  today: string,
): number => tasks.filter((t) => t.endOn !== null && t.endOn < today && t.status !== 'done' && t.status !== 'skipped').length;

// ── 뷰 ────────────────────────────────────────────────────────────────────────
export const DevelopDocumentView = z.object({
  documentId: z.number(),
  requestId: z.number(),
  type: DevelopDocType,
  seq: z.number().int(),
  version: z.number().int(),
  docNo: z.string(), // DR-01
  title: z.string(),
  status: DevelopDocStatus,
  approval: z.boolean(), // 승인형 여부(결정 선택지는 DEVELOP_DOC_DECISION_OPTIONS[type])
  content: DevelopDocContent,
  replyDueOn: z.string().nullable(), // 회신 요청일(YYYY-MM-DD)
  sentAt: z.string().nullable(),
  decision: DevelopDocDecision.nullable(),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedName: z.string().nullable(),
  files: z.array(MarketFileMeta),
  isCurrent: z.boolean(), // 같은 종류·번호의 최신 버전
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DevelopDocumentViewType = z.infer<typeof DevelopDocumentView>;

export const AdminDevelopDocumentView = DevelopDocumentView.extend({
  internalNote: z.string().nullable(),
  mailSubject: z.string().nullable(), // 마지막 발송 메일(관리자 확인본)
  mailBody: z.string().nullable(),
  createdBy: z.string(),
  sentBy: z.string().nullable(),
});
export type AdminDevelopDocumentViewType = z.infer<typeof AdminDevelopDocumentView>;

// 진행 현황(00) — 고객은 공개 행만, 관리자는 전 행. 계획 일자 3개는 의뢰 컬럼(2026-09-11 전엔 최신 발송 수행계획 문서).
export const DevelopProgressView = z.object({
  progressPct: z.number().int(),
  currentPhase: DevelopTaskPhase.nullable(),
  phases: z.array(DevelopPhaseSummary),
  tasks: z.array(DevelopTaskView),
  baseStartOn: z.string().nullable(),
  plannedEndOn: z.string().nullable(),
  expectedEndOn: z.string().nullable(),
  pendingApprovals: z.number().int(), // 고객 확인 대기(sent 승인형) 건수
  overdueTasks: z.number().int(), // 완료일 경과 ∧ 미완료(제외 제외) 행 수 — 날짜 파생
  // 업무표 낙관적 잠금 토큰 — 행 id·updatedAt 의 해시. PUT …/tasks 가 이 값을 되돌려받아 대조한다(관리자 응답에서만 의미).
  tasksRevision: z.string(),
});
export type DevelopProgressViewType = z.infer<typeof DevelopProgressView>;

// ── 관리자 요청 본문 ──────────────────────────────────────────────────────────
export const AdminDevelopDocumentCreateBody = z.object({
  type: DevelopDocType,
  content: DevelopDocContent.optional(), // 없으면 빈 본문
  internalNote: z.string().trim().max(4000).nullable().default(null),
});
export type AdminDevelopDocumentCreateBodyType = z.infer<typeof AdminDevelopDocumentCreateBody>;

export const AdminDevelopDocumentPatchBody = z
  .object({
    content: DevelopDocContent,
    internalNote: z.string().trim().max(4000).nullable(),
    replyDueOn: z.string().regex(DEVELOP_DOC_DATE_RE).nullable(),
    // 낙관적 잠금 — 화면이 마지막으로 본 updatedAt(ISO). 서버 값과 다르면 409 REVISION_CONFLICT. 없으면 검사하지 않는다.
    expectedUpdatedAt: z.string().datetime(),
  })
  .partial()
  .refine((b) => Object.keys(b).some((k) => k !== 'expectedUpdatedAt'), { message: '최소 한 개 필드가 필요합니다' });
export type AdminDevelopDocumentPatchBodyType = z.infer<typeof AdminDevelopDocumentPatchBody>;

// 발송 — 관리자가 확인한 메일 제목·본문(plain text)이 그대로 나간다(사용자 결정 5·6: 발송 버튼이 메일도 보낸다, AI 초안은 확인 뒤).
export const AdminDevelopDocumentSendBody = z.object({
  replyDueOn: z.string().regex(DEVELOP_DOC_DATE_RE).nullable().default(null),
  mailSubject: z.string().trim().min(1).max(DEVELOP_DOC_MAIL_SUBJECT_MAX),
  mailBody: z.string().trim().min(1).max(DEVELOP_DOC_MAIL_BODY_MAX),
  sendMail: z.boolean().default(true),
});
export type AdminDevelopDocumentSendBodyType = z.infer<typeof AdminDevelopDocumentSendBody>;

export const AdminDevelopDocMailBody = z.object({ instructions: z.string().trim().max(2000).default('') });
export type AdminDevelopDocMailBodyType = z.infer<typeof AdminDevelopDocMailBody>;

export const AdminDevelopDocumentResponse = z.object({ result: z.literal(true), data: AdminDevelopDocumentView });
export type AdminDevelopDocumentResponseType = z.infer<typeof AdminDevelopDocumentResponse>;

export const AdminDevelopTasksResponse = z.object({
  result: z.literal(true),
  data: z.object({ tasks: z.array(DevelopTaskView), progress: DevelopProgressView }),
});
export type AdminDevelopTasksResponseType = z.infer<typeof AdminDevelopTasksResponse>;

export const AdminDevelopDocMailRunResponse = z.object({
  result: z.literal(true),
  data: z.object({ jobId: z.string(), cached: z.boolean() }),
});
export type AdminDevelopDocMailRunResponseType = z.infer<typeof AdminDevelopDocMailRunResponse>;

// ── 고객 요청 본문 ──────────────────────────────────────────────────────────
// 결정 = 동의 기록(시각·IP·이름, 견적 수락 패턴 — 사용자 결정 4). 승인형 문서의 sent 상태에서만.
export const DevelopDocumentDecideBody = z.object({
  decision: DevelopDocDecision,
  note: z.string().trim().max(2000).optional(),
  name: z.string().trim().min(1).max(100),
});
export type DevelopDocumentDecideBodyType = z.infer<typeof DevelopDocumentDecideBody>;
