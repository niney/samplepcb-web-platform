import { computed, type Ref } from 'vue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  AdminMailLogDetailResponse,
  AdminMailLogListResponse,
  AdminQuickMailSendResponse,
} from '@sp/api-contract';
import type { MailLogChannelType, MailLogStatusType } from '@sp/api-contract';
import { apiGet, apiSend } from '@sp/shared';

// 발송 이력(sp_mail_log) 조회 훅 — 전역 이력 페이지 + Case 상세 '보낸 메일' 공용.
// 계약은 admin-mail.ts(api-contract), 필터 상태는 화면이 소유(useAdminMembers 관례).

const logsUrl = '/api/admin/mail-logs';

export interface AdminMailLogFilters {
  page: number;
  pageSize: number;
  refType: string; // '' = 전체
  refId: string; // '' = 전체
  kind: string; // '' = 전체
  channel: MailLogChannelType | ''; // '' = 전체
  status: MailLogStatusType | ''; // '' = 전체
  recipient: string; // '' = 미검색(부분 일치)
  dateFrom: string; // '' = 미지정(YYYY-MM-DD, KST)
  dateTo: string;
}

export const emptyMailLogFilters = (patch?: Partial<AdminMailLogFilters>): AdminMailLogFilters => ({
  page: 1,
  pageSize: 20,
  refType: '',
  refId: '',
  kind: '',
  channel: '',
  status: '',
  recipient: '',
  dateFrom: '',
  dateTo: '',
  ...patch,
});

const listPath = (f: AdminMailLogFilters): string => {
  const params = new URLSearchParams();
  params.set('page', String(f.page));
  params.set('pageSize', String(f.pageSize));
  if (f.refType !== '') params.set('refType', f.refType);
  if (f.refId !== '') params.set('refId', f.refId);
  if (f.kind !== '') params.set('kind', f.kind);
  if (f.channel !== '') params.set('channel', f.channel);
  if (f.status !== '') params.set('status', f.status);
  if (f.recipient.trim() !== '') params.set('recipient', f.recipient.trim());
  if (f.dateFrom !== '') params.set('dateFrom', f.dateFrom);
  if (f.dateTo !== '') params.set('dateTo', f.dateTo);
  return `${logsUrl}?${params.toString()}`;
};

export function useAdminMailLogList(filters: Ref<AdminMailLogFilters>) {
  return useQuery({
    queryKey: ['admin', 'mail-logs', 'list', filters],
    queryFn: () => apiGet(listPath(filters.value), AdminMailLogListResponse),
    placeholderData: keepPreviousData,
  });
}

/** 단건 상세(본문 원문 포함) — 행 확장 시에만 조회. */
export function useAdminMailLogDetail(logId: Ref<number | null>) {
  return useQuery({
    queryKey: ['admin', 'mail-logs', 'detail', logId],
    queryFn: () => apiGet(`${logsUrl}/${String(logId.value)}`, AdminMailLogDetailResponse),
    enabled: computed(() => logId.value !== null),
  });
}

/** 재발송 — 원문 보존 수동 메일(quick_mail)만(서버 409 가드). 성공 시 새 이력 행. */
export function useResendMailLog() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ logId, toEmail }: { logId: number; toEmail?: string }) =>
      apiSend(
        'POST',
        `${logsUrl}/${String(logId)}/resend`,
        toEmail === undefined ? {} : { toEmail },
        AdminQuickMailSendResponse,
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'mail-logs'] }),
  });
}
