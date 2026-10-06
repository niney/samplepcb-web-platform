import { DEVELOP_DOC_FIELDS, developDocContentRows } from '@sp/api-contract';
import type { AdminDevelopDocumentViewType, DevelopDocDecisionType } from '@sp/api-contract';
import { developDocRows } from '@/components/admin/develop/develop-doc-edit';
import type { AlertVariants } from '@/next/components/ui/alert';

// 발송된 문서 판의 읽기 모양 — 화면 읽기 뷰(DevelopDocView)와 인쇄 문서(print/DevelopDocPrintDoc)가 같은 블록을 그린다.
// 옛 components/admin/develop/DevelopDocView.vue 의 규칙 그대로: 표가 아닌 필드는 계약의 표시 행(developDocContentRows —
// 빈 값·비활성 조건부 필드는 이미 빠져 있다), 표는 빈 행을 뺀 나머지, select 칸은 코드 대신 선택지 라벨.

export type DevelopDocViewBlock =
  | { kind: 'text'; key: string; label: string; text: string }
  | { kind: 'table'; key: string; label: string; columns: { key: string; label: string }[]; rows: string[][] };

export function developDocViewBlocks(doc: AdminDevelopDocumentViewType): DevelopDocViewBlock[] {
  const textRows = new Map(developDocContentRows(doc.type, doc.content).map((r) => [r.key, r]));
  const out: DevelopDocViewBlock[] = [];
  for (const f of DEVELOP_DOC_FIELDS[doc.type]) {
    if (f.kind === 'table') {
      const columns = f.columns ?? [];
      const rows = developDocRows(doc.content, f.key)
        .filter((row) => Object.values(row).some((c) => c.trim() !== ''))
        .map((row) =>
          columns.map((c) => {
            const raw = row[c.key] ?? '';
            return c.options?.find((o) => o.code === raw)?.label ?? raw;
          }),
        );
      if (rows.length > 0) {
        out.push({ kind: 'table', key: f.key, label: f.label, columns: columns.map((c) => ({ key: c.key, label: c.label })), rows });
      }
      continue;
    }
    const row = textRows.get(f.key);
    if (row !== undefined) out.push({ kind: 'text', key: f.key, label: f.label, text: row.text });
  }
  return out;
}

/** 고객 결정 색 — 승인·조건부 승인=완료 · 수정·협의 요청=주의(관리자 차례) · 반려=위험. */
export const developDocDecisionAlert = (decision: DevelopDocDecisionType): NonNullable<AlertVariants['variant']> => {
  switch (decision) {
    case 'approved':
    case 'conditional':
      return 'success';
    case 'rejected':
      return 'destructive';
    default:
      return 'warning';
  }
};
