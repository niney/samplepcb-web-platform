import { getDevelopSettings as get, updateDevelopSettings as update } from './develop-settings';
import type { AdminDevelopSettingsUpdateType } from '@sp/api-contract/develop-c';

export const getDevelopSettings = () => get('c');
export const updateDevelopSettings = (patch: AdminDevelopSettingsUpdateType) => update(patch, 'c');
