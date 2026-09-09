import { z } from 'zod';
import {
  DevelopAdminTab,
  DevelopRequestStatus,
  DevelopQuoteStatus,
  DevelopMilestoneStatus,
  DevelopMilestoneTrigger,
  AdminDevelopRequestCounts,
} from './develop';
import { WORK_DOCUMENT_KINDS, WorkDecision } from './develop-workflow';

export const DEVELOP_WORKSPACE_SECTIONS = [
  'overview',
  'quotes',
  'schedule',
  'documents',
  'delivery',
  'payments',
] as const;
export const DevelopWorkspaceSection = z.enum(DEVELOP_WORKSPACE_SECTIONS);
export type DevelopWorkspaceSectionType = z.infer<typeof DevelopWorkspaceSection>;
export const AdminDevelopWorkspaceQuery = z.object({
  section: DevelopWorkspaceSection.default('overview'),
  tab: DevelopAdminTab.default('all'),
  q: z.string().trim().max(100).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type AdminDevelopWorkspaceQueryType = z.infer<typeof AdminDevelopWorkspaceQuery>;

export const DevelopWorkspaceDocument = z.object({
  id: z.string(),
  kind: z.enum(WORK_DOCUMENT_KINDS),
  title: z.string(),
  publishedVersion: z.number().nullable(),
  dueDate: z.string().nullable(),
  status: z.enum([
    'draft',
    'published',
    'pending',
    'approved',
    'changes',
    'discuss',
    'conditional',
  ]),
  decision: WorkDecision.nullable(),
});
export const AdminDevelopWorkspaceItem = z.object({
  requestId: z.number().int().positive(),
  title: z.string(),
  status: DevelopRequestStatus,
  contactName: z.string(),
  contactCompany: z.string().nullable(),
  assignee: z.string().nullable(),
  updatedAt: z.string(),
  deliveredAt: z.string().nullable(),
  reviewDays: z.number(),
  workflowEnabled: z.boolean(),
  materialsReady: z.boolean(),
  progress: z.number().min(0).max(100).nullable(),
  taskCount: z.number(),
  completedTasks: z.number(),
  overdueTasks: z.number(),
  forecastEnd: z.string().nullable(),
  pendingApprovals: z.number(),
  documents: z.array(DevelopWorkspaceDocument),
  quotes: z.array(
    z.object({
      id: z.number(),
      version: z.number(),
      title: z.string(),
      status: DevelopQuoteStatus,
      amount: z.number(),
    }),
  ),
  milestones: z.array(
    z.object({
      id: z.number(),
      quoteVersion: z.number(),
      title: z.string(),
      amount: z.number(),
      status: DevelopMilestoneStatus,
      trigger: DevelopMilestoneTrigger,
      paidAt: z.string().nullable(),
    }),
  ),
  paidAmount: z.number(),
  pendingAmount: z.number(),
});
export type AdminDevelopWorkspaceItemType = z.infer<typeof AdminDevelopWorkspaceItem>;
export const AdminDevelopWorkspaceResponse = z.object({
  result: z.literal(true),
  data: z.object({
    items: z.array(AdminDevelopWorkspaceItem),
    total: z.number(),
    page: z.number(),
    pageSize: z.number(),
    counts: AdminDevelopRequestCounts,
  }),
});
