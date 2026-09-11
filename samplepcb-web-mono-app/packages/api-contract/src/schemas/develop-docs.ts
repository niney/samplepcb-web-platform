import { z } from 'zod';
import { MarketFileMeta } from './market';

// ── 개발의뢰 프로젝트 문서·업무표(docs/DEVELOP_FLOW.md §13, 2026-09-09) ────────────────────────
// 프로토타입 「개발프로젝트 업무관리 서식」(.tmp/develop/Work flow.html) 10장을 계약 이후(in_progress) 구간의
// 문서 층으로 옮긴 계약. 문서 8종은 한 테이블(sp_develop_document — type + 필드 스펙 JSON)이고 업무표(WBS)는
// sp_develop_task 다. 계약서(01)는 문서가 아니라 수락 견적서의 인쇄 뷰(결정 11 "견적 승인이 곧 계약")다.
// 롤백 조건: 기존 sp_develop_* 테이블 ALTER 없음 · 기존 계약엔 additive 만.
// 프로토타입에서 일부러 안 가져온 것: localStorage 저장 · 키워드 조합 가짜 AI · 순서 기반 가짜 간트 위치.

// ── 문서 종류 ──────────────────────────────────────────────────────────────────
export const DEVELOP_DOC_TYPES = [
  'kickoff', // 02 개발착수회의록 (승인형)
  'plan', // 03 프로젝트 수행계획 (공유형 — 업무표는 sp_develop_task)
  'design_review', // 04 중간 개발검토서 (승인형 — 옛 review_request 이벤트를 대체)
  'production_approval', // 05 제작 진행 승인서 (승인형)
  'test_report', // 06 시제품 시험검토서 (공유형)
  'change_request', // 07 개발 변경요청서 (승인형 — 승인되면 change 견적 초안)
  'delivery_confirm', // 08 최종 납품·개발완료 확인서 (승인형 — delivered 에서 승인=검수 확정)
  'progress_report', // 09 정기 진행보고 (공유형 — 00 현황의 세 칸)
] as const;
export type DevelopDocTypeType = (typeof DEVELOP_DOC_TYPES)[number];
export const DevelopDocType = z.enum(DEVELOP_DOC_TYPES);
export const DEVELOP_DOC_TYPE_LABELS = {
  kickoff: '개발착수회의록',
  plan: '프로젝트 수행계획',
  design_review: '중간 개발검토서',
  production_approval: '제작 진행 승인서',
  test_report: '시제품 시험검토서',
  change_request: '개발 변경요청서',
  delivery_confirm: '최종 납품·개발완료 확인서',
  progress_report: '정기 진행보고',
} as const satisfies Record<DevelopDocTypeType, string>;
// 문서번호 접두 — `DR-01` 처럼 종류별 일련번호(seq)와 합친다(프로토타입 DEV-CON-001·DR-01·CR-001 계승).
export const DEVELOP_DOC_TYPE_CODES = {
  kickoff: 'MTG',
  plan: 'PLN',
  design_review: 'DR',
  production_approval: 'PA',
  test_report: 'TR',
  change_request: 'CR',
  delivery_confirm: 'DC',
  progress_report: 'PR',
} as const satisfies Record<DevelopDocTypeType, string>;
export const developDocNo = (type: DevelopDocTypeType, seq: number): string =>
  `${DEVELOP_DOC_TYPE_CODES[type]}-${String(seq).padStart(2, '0')}`;

// 승인형(고객 결정을 받는다) / 공유형(보내면 끝, 의견은 기존 문의로). 사용자 결정 2(2026-09-09).
export const DEVELOP_DOC_APPROVAL_TYPES = ['kickoff', 'design_review', 'production_approval', 'change_request', 'delivery_confirm'] as const;
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
  plan: [],
  design_review: DEFAULT_DECISIONS,
  production_approval: DEFAULT_DECISIONS,
  test_report: [],
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

// ── 필드 스펙 — 문서 8종의 폼·뷰·메일 본문을 한 스펙으로 그린다 ────────────────────────────
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
}

const ta = (key: string, label: string, placeholder?: string): DevelopDocFieldSpec =>
  placeholder === undefined ? { key, label, kind: 'textarea' } : { key, label, kind: 'textarea', placeholder };
const tx = (key: string, label: string, meta = true): DevelopDocFieldSpec => ({ key, label, kind: 'text', meta });
const dt = (key: string, label: string, meta = true): DevelopDocFieldSpec => ({ key, label, kind: 'date', meta });
const sel = (key: string, label: string, options: readonly DevelopDocOption[], meta = true): DevelopDocFieldSpec => ({ key, label, kind: 'select', options, meta });

export const DEVELOP_DOC_REVIEW_STAGES: readonly DevelopDocOption[] = [
  { code: 'system', label: '시스템 구성' },
  { code: 'circuit', label: '회로설계' },
  { code: 'pcb', label: 'PCB설계' },
  { code: 'firmware', label: '펌웨어' },
  { code: 'mech', label: '기구설계' },
  { code: 'app_server', label: '앱·서버' },
];
export const DEVELOP_DOC_TEST_RESULTS: readonly DevelopDocOption[] = [
  { code: 'pass', label: '적합' },
  { code: 'fix', label: '보완' },
  { code: 'fail', label: '부적합' },
  { code: 'untested', label: '미시험' },
];
export const DEVELOP_DOC_CHECK_RESULTS: readonly DevelopDocOption[] = [
  { code: 'checked', label: '확인' },
  { code: 'unchecked', label: '미확인' },
  { code: 'na', label: '해당 없음' },
];

export const DEVELOP_DOC_FIELDS: Record<DevelopDocTypeType, readonly DevelopDocFieldSpec[]> = {
  kickoff: [
    { key: 'meetingAt', label: '회의일', kind: 'datetime', meta: true },
    sel('meetingMode', '회의방식', [
      { code: 'online', label: '온라인' },
      { code: 'onsite', label: '대면' },
      { code: 'phone', label: '전화' },
    ]),
    tx('attendeesSp', '샘플피씨비 참석자'),
    tx('attendeesCustomer', '고객 참석자'),
    ta('goal', '프로젝트 목표'),
    ta('doneCriteria', '핵심 기능과 완료 판단 기준'),
    ta('scope', '확정 개발범위'),
    ta('excluded', '제외·추후 협의 범위'),
    ta('customerProvides', '고객 제공자료·장비·샘플과 제공일'),
    ta('roles', '업무분담과 외부 협업사'),
    ta('schedule', '주요 일정과 검토 시점'),
    ta('risks', '위험요소와 선결사항'),
    ta('approver', '고객 승인 담당자'),
    ta('nextSteps', '다음 업무와 예정일'),
    {
      key: 'decisions',
      label: '회의 결정사항',
      kind: 'table',
      columns: [
        { key: 'item', label: '결정사항', kind: 'text', width: 'wide' },
        { key: 'owner', label: '담당', kind: 'text' },
        { key: 'dueOn', label: '완료 예정일', kind: 'date' },
      ],
    },
  ],
  plan: [
    dt('baseStartOn', '기준 착수일'),
    dt('plannedEndOn', '계획 완료일'),
    dt('expectedEndOn', '현재 예상 완료일'),
    ta('note', '비고', '업무순서·일정은 업무표(간트)로 공유됩니다. 전제나 변경 사유를 적어 주세요.'),
  ],
  design_review: [
    sel('stage', '검토 단계', DEVELOP_DOC_REVIEW_STAGES),
    ta('purpose', '검토 목적'),
    ta('doneWork', '완료한 업무'),
    ta('decisions', '주요 설계 결정'),
    ta('open', '미확정·확인 필요사항'),
    ta('asks', '고객 결정 요청사항'),
    ta('impact', '선택에 따른 비용·일정 영향'),
    ta('attachmentsNote', '첨부 검토자료'),
    ta('nextAfter', '승인 후 다음 업무'),
  ],
  production_approval: [
    ta('target', '제작 대상과 리비전'),
    ta('qty', '제작 수량'),
    ta('pcbSpec', 'PCB 제작사양', '층수, 재질, 두께, 동박, 표면처리, 색상, 특수조건'),
    ta('sourcing', '부품 조달 및 고객 지급자재'),
    ta('mfgScope', 'SMT·수삽·조립·검사 범위'),
    ta('leadTime', '제작 예상기간과 입고 예정일'),
    ta('dataList', '제작자료 목록', 'Gerber, Drill, BOM, 좌표, 조립도, 프로그램, 검사기준'),
    ta('changeLimit', '승인 후 변경 제한과 예상 영향'),
    {
      key: 'approvalScope',
      label: '제작 승인 범위',
      kind: 'checklist',
      options: [
        { code: 'key_parts_preorder', label: '주요 부품 선발주' },
        { code: 'pcb_fab', label: 'PCB 제작' },
        { code: 'all_parts', label: '전체 부품 발주' },
        { code: 'smt', label: 'SMT·수삽' },
        { code: 'assembly', label: '완제품 조립' },
        { code: 'test', label: '시험·검사' },
      ],
    },
  ],
  test_report: [
    ta('sample', '시제품 정보와 수량'),
    ta('purpose', '시험 목적과 환경'),
    {
      key: 'results',
      label: '시험결과',
      kind: 'table',
      columns: [
        { key: 'item', label: '시험항목', kind: 'text', width: 'wide' },
        { key: 'criteria', label: '기준', kind: 'text', width: 'wide' },
        { key: 'result', label: '결과', kind: 'select', options: DEVELOP_DOC_TEST_RESULTS, width: 'narrow' },
        { key: 'note', label: '비고·증빙', kind: 'text' },
      ],
    },
    ta('issues', '발견된 문제와 원인'),
    ta('fixPlan', '수정·보완 계획'),
    ta('customerChecks', '고객 확인사항'),
    ta('nextSchedule', '인증·다음 시험·납품 일정'),
  ],
  change_request: [
    tx('requester', '요청자'),
    dt('requestedOn', '요청일'),
    sel('urgency', '긴급도', [
      { code: 'normal', label: '일반' },
      { code: 'urgent', label: '긴급' },
      { code: 'next', label: '차기 반영' },
    ]),
    ta('original', '기존 요구사항'),
    ta('change', '변경 요청내용'),
    ta('reason', '변경 사유'),
    ta('techImpact', '기술적 영향'),
    ta('costImpact', '추가·감액 비용'),
    ta('scheduleImpact', '일정 영향과 변경 완료일'),
    ta('affected', '영향받는 납품물·시험·인증'),
    ta('opinion', '샘플피씨비 검토의견'),
  ],
  delivery_confirm: [
    ta('result', '계약 범위 대비 완료 결과'),
    ta('delivery', '최종 납품일과 납품방법'),
    {
      key: 'deliverables',
      label: '납품물 확인',
      kind: 'table',
      columns: [
        { key: 'item', label: '납품물', kind: 'text', width: 'wide' },
        { key: 'fileName', label: '파일·제품명과 버전', kind: 'text', width: 'wide' },
        { key: 'check', label: '확인', kind: 'select', options: DEVELOP_DOC_CHECK_RESULTS, width: 'narrow' },
      ],
    },
    ta('remaining', '미완료·제외·추가 협의사항'),
    ta('warranty', '하자보수 범위와 기간'),
    ta('followup', '유지보수·양산·추가 개발 안내'),
  ],
  progress_report: [
    dt('reportOn', '보고 기준일'),
    ta('doneWork', '이번 기간 완료 업무', '예: 전원부 및 센서 입력부 회로설계 완료'),
    ta('currentWork', '현재 진행 업무', '예: MCU와 통신 인터페이스 회로설계 진행'),
    ta('nextWork', '다음 예정 업무', '예: 회로검토 후 PCB 부품배치'),
  ],
};

// 납품확인서 납품물 기본 행(프로토타입 placeholder 4줄) — 새 문서에 미리 채운다.
export const DEVELOP_DOC_DELIVERABLE_PRESETS = ['회로·PCB 설계자료', '펌웨어·앱·서버 소스', '시제품·시험·인증자료', '매뉴얼·기타 문서'] as const;

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

// 표시·메일용 행 — 스펙 순서대로 라벨·텍스트(빈 값은 뺀다). 표는 줄 단위로 편다.
export interface DevelopDocContentRow {
  key: string;
  label: string;
  text: string;
  kind: DevelopDocFieldKind;
}
export function developDocContentRows(type: DevelopDocTypeType, content: DevelopDocContentType): DevelopDocContentRow[] {
  const rows: DevelopDocContentRow[] = [];
  for (const f of DEVELOP_DOC_FIELDS[type]) {
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
// 7단계는 프로토타입 「고객 공유 진행단계」 그대로. 의뢰 status 를 늘리지 않는다(결제·잠금과 묶여 있다) — 단계는 업무에서 파생.
export const DEVELOP_TASK_PHASES = ['contract', 'requirements', 'design', 'fabrication', 'assembly', 'certification', 'delivery'] as const;
export type DevelopTaskPhaseType = (typeof DEVELOP_TASK_PHASES)[number];
export const DevelopTaskPhase = z.enum(DEVELOP_TASK_PHASES);
export const DEVELOP_TASK_PHASE_LABELS = {
  contract: '계약·착수',
  requirements: '요구사항',
  design: '설계·개발',
  fabrication: '제작·입고',
  assembly: '조립·시험',
  certification: '인증·검토',
  delivery: '납품·완료',
} as const satisfies Record<DevelopTaskPhaseType, string>;

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
  weightBp: z.number().int().min(0).max(10_000).default(0), // 가중치(bp, 1000 = 10%)
  progressPct: z.number().int().min(0).max(100).default(0),
  note: z.string().trim().max(500).nullable().default(null), // 선행업무·비고
  visibleToCustomer: z.boolean().default(false), // 사용자 결정 7: 세부 행은 기본 비공개, 단계 요약·달성도만 공개
});
export type DevelopTaskInputType = z.infer<typeof DevelopTaskInput>;

// 상태↔진행률 정합(G 규칙 이식): 완료 ⇔ 100% · 예정 ⇒ 0%. 그 밖의 상태는 자유. 화면은 developTaskIssues 로 먼저 같은 규칙을 검사한다.
export const developTaskCoherent = (t: { status: DevelopTaskStatusType; progressPct: number }): boolean =>
  (t.status === 'done') === (t.progressPct === 100) && (t.status !== 'planned' || t.progressPct === 0);

export const AdminDevelopTasksPutBody = z
  .object({
    tasks: z.array(DevelopTaskInput).max(100),
    // 낙관적 잠금 — 상세 응답 progress.tasksRevision 을 그대로 돌려보낸다. 다르면 409 REVISION_CONFLICT(다른 사람이 먼저 저장).
    // 없으면 검사하지 않는다(옛 화면 호환).
    revision: z.string().max(80).optional(),
  })
  .superRefine((b, ctx) => {
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

// 기본 업무 15개(프로토타입 defaultTasks) — 코드 상수. 설정 테이블에 넣으면 ALTER 가 생겨 롤백 조건을 깬다.
export const DEVELOP_DEFAULT_TASKS: readonly DevelopTaskInputType[] = [
  { taskId: null, name: '개발착수회의·요구사항 확정', phase: 'requirements', status: 'planned', startOn: null, endOn: null, weightBp: 1000, progressPct: 0, note: '계약 체결 후', visibleToCustomer: true },
  { taskId: null, name: '시스템 구성·인터페이스 정의', phase: 'requirements', status: 'planned', startOn: null, endOn: null, weightBp: 600, progressPct: 0, note: '착수회의', visibleToCustomer: true },
  { taskId: null, name: '회로설계', phase: 'design', status: 'planned', startOn: null, endOn: null, weightBp: 1400, progressPct: 0, note: '시스템 구성', visibleToCustomer: true },
  { taskId: null, name: '펌웨어 개발', phase: 'design', status: 'planned', startOn: null, endOn: null, weightBp: 1400, progressPct: 0, note: '인터페이스 정의 후 병행', visibleToCustomer: true },
  { taskId: null, name: '주요 부품 선정·발주', phase: 'design', status: 'planned', startOn: null, endOn: null, weightBp: 600, progressPct: 0, note: '회로 주요 부품 확정', visibleToCustomer: false },
  { taskId: null, name: 'PCB 부품배치', phase: 'design', status: 'planned', startOn: null, endOn: null, weightBp: 500, progressPct: 0, note: '회로 검토', visibleToCustomer: false },
  { taskId: null, name: 'PCB 배선', phase: 'design', status: 'planned', startOn: null, endOn: null, weightBp: 900, progressPct: 0, note: '부품배치 승인', visibleToCustomer: false },
  { taskId: null, name: '설계완료·제작승인', phase: 'design', status: 'planned', startOn: null, endOn: null, weightBp: 400, progressPct: 0, note: '회로·PCB 검토', visibleToCustomer: true },
  { taskId: null, name: 'PCB 제작', phase: 'fabrication', status: 'planned', startOn: null, endOn: null, weightBp: 700, progressPct: 0, note: '제작승인', visibleToCustomer: true },
  { taskId: null, name: '부품 입고', phase: 'fabrication', status: 'planned', startOn: null, endOn: null, weightBp: 300, progressPct: 0, note: '부품 발주', visibleToCustomer: false },
  { taskId: null, name: 'SMT·수삽', phase: 'assembly', status: 'planned', startOn: null, endOn: null, weightBp: 500, progressPct: 0, note: 'PCB·부품 입고', visibleToCustomer: true },
  { taskId: null, name: '검사·조립', phase: 'assembly', status: 'planned', startOn: null, endOn: null, weightBp: 400, progressPct: 0, note: 'SMT', visibleToCustomer: false },
  { taskId: null, name: '펌웨어 입력·통합테스트', phase: 'assembly', status: 'planned', startOn: null, endOn: null, weightBp: 800, progressPct: 0, note: '조립·펌웨어', visibleToCustomer: true },
  { taskId: null, name: '인증·보완', phase: 'certification', status: 'planned', startOn: null, endOn: null, weightBp: 400, progressPct: 0, note: '통합테스트', visibleToCustomer: true },
  { taskId: null, name: '최종 납품', phase: 'delivery', status: 'planned', startOn: null, endOn: null, weightBp: 500, progressPct: 0, note: '시험·인증 완료', visibleToCustomer: true },
];

// 진행 요약 — 달성도(가중 평균)·현재 단계·7단계 상태. 저장하지 않고 매번 계산한다(서버·화면 공용).
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
}
export interface DevelopProgressSummary {
  progressPct: number;
  currentPhase: DevelopTaskPhaseType | null;
  phases: DevelopPhaseSummaryType[];
}
// 제외(skipped) 행은 가중치·평균에서 빠진다 — 삭제 대신 제외하라는 규칙의 짝.
const weighted = (input: readonly DevelopProgressInputTask[]): number => {
  const tasks = input.filter((t) => t.status !== 'skipped');
  if (tasks.length === 0) return 0;
  const w = tasks.reduce((a, t) => a + t.weightBp, 0);
  if (w === 0) return Math.round(tasks.reduce((a, t) => a + t.progressPct, 0) / tasks.length);
  return Math.round(tasks.reduce((a, t) => a + t.weightBp * t.progressPct, 0) / w);
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

// 진행 현황(00) — 고객은 공개 행만, 관리자는 전 행. 계획 일자는 최신 발송 수행계획(plan) 문서에서.
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
