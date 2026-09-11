import type { AdminMenuItem } from './menu';
export const developMenu: AdminMenuItem[] = [
  {
    to: { name: 'admin-develop' },
    labelKey: 'admin.menu.developHome',
    badge: 'developReplyOverdue',
  },
  {
    to: { name: 'admin-develop-intake' },
    labelKey: 'admin.menu.developIntake',
    badge: 'developReceived',
  },
  {
    to: { name: 'admin-develop-contracts' },
    labelKey: 'admin.menu.developContracts',
    badge: 'developAccepted',
  },
  {
    to: { name: 'admin-develop-projects' },
    labelKey: 'admin.menu.developProjects',
    badge: 'developDocsAwaiting',
  },
  {
    to: { name: 'admin-develop-deliveries' },
    labelKey: 'admin.menu.developDeliveries',
    badge: 'developDelivered',
  },
  {
    to: { name: 'admin-develop-inquiries' },
    labelKey: 'admin.menu.developInquiries',
    badge: 'developInquiries',
  },
  {
    to: { name: 'admin-develop-requests' },
    labelKey: 'admin.menu.developRequests',
    activeRouteNames: ['admin-develop-request'],
  },
  { to: { name: 'admin-develop-settings' }, labelKey: 'admin.menu.developSettings' },
];
