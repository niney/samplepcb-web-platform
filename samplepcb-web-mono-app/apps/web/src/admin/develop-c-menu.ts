import type { AdminMenuItem } from './menu';
export const developCMenu: AdminMenuItem[] = [
  {
    to: { name: 'admin-develop-c-home' },
    labelKey: 'admin.menu.developCHome',
    badge: 'developCReplyOverdue',
  },
  {
    to: { name: 'admin-develop-c-intake' },
    labelKey: 'admin.menu.developCIntake',
    badge: 'developCReceived',
  },
  {
    to: { name: 'admin-develop-c-contracts' },
    labelKey: 'admin.menu.developCContracts',
    badge: 'developCAccepted',
  },
  {
    to: { name: 'admin-develop-c-projects' },
    labelKey: 'admin.menu.developCProjects',
    badge: 'developCDocsAwaiting',
  },
  {
    to: { name: 'admin-develop-c-deliveries' },
    labelKey: 'admin.menu.developCDeliveries',
    badge: 'developCDelivered',
  },
  {
    to: { name: 'admin-develop-c-inquiries' },
    labelKey: 'admin.menu.developCInquiries',
    badge: 'developCInquiries',
  },
  {
    to: { name: 'admin-develop-c-requests' },
    labelKey: 'admin.menu.developCRequests',
    activeRouteNames: ['admin-develop-c-request'],
  },
  { to: { name: 'admin-develop-c-settings' }, labelKey: 'admin.menu.developCSettings' },
];
