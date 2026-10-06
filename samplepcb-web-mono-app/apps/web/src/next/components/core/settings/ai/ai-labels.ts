import type { AiThinkLevelType } from '@sp/api-contract';
import type { BadgeVariant } from '@/next/components/common/badge-types';

// AI 연동 탭의 라벨·배지 사전 — 옛 components/admin/AiSettingsForm.vue 의 thinkLabel·jobStatusLabel·
// jobStageLabel 과 같은 i18n 키. t 를 받아 순수 함수로 둔다(구역 조각들이 함께 쓴다).
type Translate = (key: string) => string;

export const aiThinkLabel = (t: Translate, level: AiThinkLevelType): string =>
  level === 'off'
    ? t('admin.settings.ai.devDiagram.thinkOff')
    : level === 'low'
      ? t('admin.settings.ai.devDiagram.thinkLow')
      : level === 'medium'
        ? t('admin.settings.ai.devDiagram.thinkMedium')
        : level === 'high'
          ? t('admin.settings.ai.devDiagram.thinkHigh')
          : t('admin.settings.ai.devDiagram.thinkMax');

export type AiJobStatus = 'running' | 'done' | 'error';

export const aiJobStatusBadge = (t: Translate, status: AiJobStatus): { label: string; variant: BadgeVariant } =>
  status === 'running'
    ? { label: t('admin.settings.ai.jobs.statusRunning'), variant: 'info' }
    : status === 'done'
      ? { label: t('admin.settings.ai.jobs.statusDone'), variant: 'success' }
      : { label: t('admin.settings.ai.jobs.statusError'), variant: 'danger' };

export const aiJobStageLabel = (t: Translate, stage: string | null): string =>
  stage === 'attachments'
    ? t('admin.settings.ai.jobs.stageAttachments')
    : stage === 'review'
      ? t('admin.settings.ai.jobs.stageReview')
      : stage === 'diagram'
        ? t('admin.settings.ai.jobs.stageDiagram')
        : stage === 'followup'
          ? t('admin.settings.ai.jobs.stageFollowup')
          : stage === 'docmail'
            ? t('admin.settings.ai.jobs.stageDocmail')
            : '-';

/** AI 유스케이스 구역(AiUseCaseSection)의 문구 i18n 키 — 구역마다 옛 화면이 쓰던 키를 그대로 넘긴다. */
export interface AiUseCaseKeys {
  title: string;
  enabled: string;
  enabledHint: string;
  model: string;
  modelHint: string;
  think?: string;
  thinkHint?: string;
  extra: string;
  extraHint: string;
  count: string;
  promptVersion: string;
  promptVersionHint: string;
  updatedAt: string;
}
