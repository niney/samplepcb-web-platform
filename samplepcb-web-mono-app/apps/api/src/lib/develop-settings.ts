import type { SpDevelopSettings } from '@prisma/client';
import { DEVELOP_DEFAULT_EXCLUSIONS, DEVELOP_DEFAULT_TERMS, DevelopMilestonePreset } from '@sp/api-contract';
import type { AdminDevelopSettingsType, AdminDevelopSettingsUpdateType } from '@sp/api-contract';
import { z } from 'zod';
import { asVatMode } from './develop';
import { prisma } from './prisma';

// ── 개발의뢰 설정 싱글턴(id=1, docs/DEVELOP_FLOW.md §3) ───────────────────────────────
// GET 은 행이 없으면 코드 기본값으로 답하고, PATCH 가 upsert 한다(마켓 settings 관례 — 시드 불요).
// 견적 생성이 이 값을 **복사**한다(설정을 바꿔도 이미 만든 견적은 안 바뀐다).

const DEFAULT_MILESTONES: AdminDevelopSettingsType['defaultMilestones'] = [
  { title: '착수금', ratioBp: 5000, trigger: 'on_accept' },
  { title: '잔금', ratioBp: 5000, trigger: 'on_delivery' },
];

const Presets = z.array(DevelopMilestonePreset);
const Emails = z.array(z.string());

export const developSettingsDefaults = (): AdminDevelopSettingsType => ({
  defaultTerms: DEVELOP_DEFAULT_TERMS,
  defaultExclusions: DEVELOP_DEFAULT_EXCLUSIONS,
  defaultWarrantyDays: 180,
  defaultReviewDays: 7,
  defaultValidDays: 30,
  defaultVatMode: 'separate',
  defaultMilestones: DEFAULT_MILESTONES,
  notifyEmails: [],
  aiAutoDraft: true,
  aiDiagramAutoDraft: true,
  updatedAt: null,
});

const toSettings = (row: SpDevelopSettings): AdminDevelopSettingsType => {
  const presets = Presets.safeParse(row.defaultMilestones);
  const emails = Emails.safeParse(row.notifyEmails);
  return {
    defaultTerms: row.defaultTerms,
    defaultExclusions: row.defaultExclusions,
    defaultWarrantyDays: row.defaultWarrantyDays,
    defaultReviewDays: row.defaultReviewDays,
    defaultValidDays: row.defaultValidDays,
    defaultVatMode: asVatMode(row.defaultVatMode),
    defaultMilestones: presets.success && presets.data.length > 0 ? presets.data : DEFAULT_MILESTONES,
    notifyEmails: emails.success ? emails.data : [],
    aiAutoDraft: row.aiAutoDraft,
    aiDiagramAutoDraft: row.aiDiagramAutoDraft,
    updatedAt: row.updatedAt.toISOString(),
  };
};

export async function getDevelopSettings(): Promise<AdminDevelopSettingsType> {
  const row = await prisma.spDevelopSettings.findUnique({ where: { id: 1 } });
  return row === null ? developSettingsDefaults() : toSettings(row);
}

export async function updateDevelopSettings(patch: AdminDevelopSettingsUpdateType): Promise<AdminDevelopSettingsType> {
  const current = await getDevelopSettings();
  // zod partial 은 `key?: T | undefined` — 스프레드하면 undefined 가 덮어쓴다. 보낸 필드만 갱신.
  const next: AdminDevelopSettingsType = {
    defaultTerms: patch.defaultTerms ?? current.defaultTerms,
    defaultExclusions: patch.defaultExclusions ?? current.defaultExclusions,
    defaultWarrantyDays: patch.defaultWarrantyDays ?? current.defaultWarrantyDays,
    defaultReviewDays: patch.defaultReviewDays ?? current.defaultReviewDays,
    defaultValidDays: patch.defaultValidDays ?? current.defaultValidDays,
    defaultVatMode: patch.defaultVatMode ?? current.defaultVatMode,
    defaultMilestones: patch.defaultMilestones ?? current.defaultMilestones,
    notifyEmails: patch.notifyEmails ?? current.notifyEmails,
    aiAutoDraft: patch.aiAutoDraft ?? current.aiAutoDraft,
    aiDiagramAutoDraft: patch.aiDiagramAutoDraft ?? current.aiDiagramAutoDraft,
    updatedAt: current.updatedAt,
  };
  const row = await prisma.spDevelopSettings.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      defaultTerms: next.defaultTerms,
      defaultExclusions: next.defaultExclusions,
      defaultWarrantyDays: next.defaultWarrantyDays,
      defaultReviewDays: next.defaultReviewDays,
      defaultValidDays: next.defaultValidDays,
      defaultVatMode: next.defaultVatMode,
      defaultMilestones: next.defaultMilestones,
      notifyEmails: next.notifyEmails,
      aiAutoDraft: next.aiAutoDraft,
      aiDiagramAutoDraft: next.aiDiagramAutoDraft,
    },
    update: {
      defaultTerms: next.defaultTerms,
      defaultExclusions: next.defaultExclusions,
      defaultWarrantyDays: next.defaultWarrantyDays,
      defaultReviewDays: next.defaultReviewDays,
      defaultValidDays: next.defaultValidDays,
      defaultVatMode: next.defaultVatMode,
      defaultMilestones: next.defaultMilestones,
      notifyEmails: next.notifyEmails,
      aiAutoDraft: next.aiAutoDraft,
      aiDiagramAutoDraft: next.aiDiagramAutoDraft,
    },
  });
  return toSettings(row);
}
