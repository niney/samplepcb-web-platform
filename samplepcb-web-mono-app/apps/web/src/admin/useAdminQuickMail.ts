import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { apiGet, apiSend, apiSendForm } from '@sp/shared';
import {
  AdminMailTemplateListResponse,
  AdminMailTemplateResponse,
  AdminQuickMailContextResponse,
  AdminQuickMailSendResponse,
  apiRoutes,
  type AdminMailTemplateSaveBodyType,
} from '@sp/api-contract';

// 빠른 메일(§6.15) — 템플릿 CRUD + Case 컨텍스트 발송. QuickMailComposer 전용.

const templatesUrl = '/api/admin/mail-templates';
const quoteBase = apiRoutes.adminBomQuotes;

// 컴포저가 마운트될 때만 호출되므로 enabled 게이트는 불필요.
export function useMailTemplates() {
  return useQuery({
    queryKey: ['admin', 'mail-templates'],
    queryFn: () => apiGet(templatesUrl, AdminMailTemplateListResponse),
    staleTime: 60_000,
  });
}

export function useSaveMailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminMailTemplateSaveBodyType) =>
      apiSend('POST', templatesUrl, body, AdminMailTemplateResponse),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'mail-templates'] }),
  });
}

export function useDeleteMailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (templateId: number) =>
      apiSend('DELETE', `${templatesUrl}/${String(templateId)}`, undefined, AdminMailTemplateListResponse),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin', 'mail-templates'] }),
  });
}

/** 컴포즈 프리필 — 고객 이메일·이름(열 때 1회). */
export const loadQuickMailContext = async (quoteId: string) => {
  const res = await apiGet(`${quoteBase}/${quoteId}/quick-mail-context`, AdminQuickMailContextResponse);
  return res.data;
};

export function useSendQuickMail() {
  return useMutation({
    mutationFn: ({
      quoteId,
      to,
      subject,
      body,
      files,
    }: {
      quoteId: string;
      to: string;
      subject: string;
      body: string;
      files: File[];
    }) => {
      const form = new FormData();
      form.append('to', to);
      form.append('subject', subject);
      form.append('body', body);
      for (const file of files) form.append('files', file);
      return apiSendForm('POST', `${quoteBase}/${quoteId}/quick-mail`, form, AdminQuickMailSendResponse);
    },
  });
}
