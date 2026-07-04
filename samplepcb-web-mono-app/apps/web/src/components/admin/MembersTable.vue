<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AdminMemberListItemType } from '@sp/api-contract';
import UiBadge from '../ui/UiBadge.vue';

const props = defineProps<{ items: AdminMemberListItemType[]; loading: boolean }>();
const emit = defineEmits<{ select: [mbId: string] }>();
const { t } = useI18n();

// joinedAt/lastLoginAt 은 서버가 이미 KST 로 포맷한 문자열("YYYY-MM-DD HH:mm")이라
// 재파싱하지 않고 그대로 쓴다(sp_* 의 ISO 와 달리 g5 native). 가입일은 날짜만 노출.
const dateOnly = (s: string): string => s.slice(0, 10);

// 상태 → 뱃지 variant(정상=green · 차단=amber · 탈퇴=gray)
const statusVariant = (status: AdminMemberListItemType['status']): 'success' | 'warn' | 'muted' =>
  status === 'normal' ? 'success' : status === 'intercepted' ? 'warn' : 'muted';

// 회원구분(mb_1) 기업/파트너는 blue 뱃지, 그 외(개인·빈값)는 뱃지 없음
const memberTypeLabel = (memberType: string | null): string | null => {
  if (memberType === '기업') return t('admin.members.badge.corp');
  if (memberType === '파트너') return t('admin.members.badge.partner');
  return null;
};
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
    <table class="w-full min-w-[64rem] text-left text-sm" :class="{ 'opacity-60': props.loading }">
      <thead class="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
        <tr>
          <th class="px-3 py-2 font-medium">{{ t('admin.members.table.id') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.members.table.member') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.members.table.contact') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.members.table.company') }}</th>
          <th class="px-3 py-2 text-right font-medium">{{ t('admin.members.table.projects') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.members.table.lastLogin') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.members.table.joinedAt') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.members.table.status') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!props.loading && props.items.length === 0">
          <td colspan="8" class="px-3 py-12 text-center text-gray-400">
            {{ t('admin.members.table.empty') }}
          </td>
        </tr>
        <tr
          v-for="item in props.items"
          :key="item.mbId"
          class="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-blue-50/40"
          @click="emit('select', item.mbId)"
        >
          <td class="px-3 py-2 font-medium text-gray-900">{{ item.mbId }}</td>
          <td class="px-3 py-2">
            <p class="text-gray-900">{{ item.name !== '' ? item.name : '-' }}</p>
            <p class="text-xs text-gray-400">{{ item.nick !== '' ? item.nick : '-' }}</p>
          </td>
          <td class="px-3 py-2">
            <p class="text-gray-700">{{ item.email ?? '-' }}</p>
            <p class="text-xs text-gray-400">{{ item.phone ?? '-' }}</p>
          </td>
          <td class="px-3 py-2">
            <div class="flex items-center gap-1.5">
              <span class="text-gray-700">{{ item.companyName ?? '-' }}</span>
              <UiBadge
                v-if="memberTypeLabel(item.memberType) !== null"
                variant="info"
                :label="memberTypeLabel(item.memberType) ?? ''"
              />
            </div>
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            <span v-if="item.projectCount > 0" class="text-gray-800">{{ item.projectCount }}</span>
            <span v-else class="text-gray-300">0</span>
          </td>
          <td class="px-3 py-2 text-gray-500">{{ item.lastLoginAt ?? '-' }}</td>
          <td class="px-3 py-2 text-gray-500">{{ dateOnly(item.joinedAt) }}</td>
          <td class="px-3 py-2">
            <UiBadge
              :variant="statusVariant(item.status)"
              :label="t(`admin.members.badge.${item.status}`)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
