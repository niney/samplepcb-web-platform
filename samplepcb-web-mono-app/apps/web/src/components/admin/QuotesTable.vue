<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AdminQuoteListItemType } from '@sp/api-contract';
import UiBadge from '../ui/UiBadge.vue';
import { formatDate, formatKrw } from '../../lib/format';

const props = defineProps<{ items: AdminQuoteListItemType[]; loading: boolean }>();
const emit = defineEmits<{ select: [projectId: number] }>();
// te 는 구조분해하면 unbound-method(lint) — 컴포저 인스턴스로 호출한다
const i18n = useI18n();
const { t } = i18n;

const categoryLabel = (category: string): string =>
  i18n.te(`admin.quotes.categories.${category}`)
    ? t(`admin.quotes.categories.${category}`)
    : category;
</script>

<template>
  <div class="overflow-x-auto rounded-lg border border-gray-200 bg-white">
    <table class="w-full min-w-[64rem] text-left text-sm" :class="{ 'opacity-60': props.loading }">
      <thead class="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
        <tr>
          <th class="px-3 py-2 font-medium" />
          <th class="px-3 py-2 font-medium">{{ t('admin.quotes.table.project') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.quotes.table.applicant') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.quotes.table.spec') }}</th>
          <th class="px-3 py-2 text-right font-medium">{{ t('admin.quotes.table.qty') }}</th>
          <th class="px-3 py-2 text-right font-medium">{{ t('admin.quotes.table.price') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.quotes.table.status') }}</th>
          <th class="px-3 py-2 font-medium">{{ t('admin.quotes.table.createdAt') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="!props.loading && props.items.length === 0">
          <td colspan="8" class="px-3 py-12 text-center text-gray-400">
            {{ t('admin.quotes.table.empty') }}
          </td>
        </tr>
        <tr
          v-for="item in props.items"
          :key="item.projectId"
          class="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-blue-50/40"
          @click="emit('select', item.projectId)"
        >
          <td class="w-16 px-3 py-2">
            <img
              v-if="item.thumbnailUrl !== null"
              :src="item.thumbnailUrl"
              alt=""
              class="h-12 w-12 rounded-md border border-gray-200 object-cover"
            >
            <div
              v-else
              class="flex h-12 w-12 items-center justify-center rounded-md border border-gray-200 bg-gray-100 text-xs font-semibold uppercase text-gray-400"
            >
              {{ item.category.slice(0, 2) }}
            </div>
          </td>
          <td class="px-3 py-2">
            <p class="font-medium text-gray-900">{{ item.projectName }}</p>
            <p class="text-xs text-gray-400">#{{ item.projectId }}</p>
          </td>
          <td class="px-3 py-2">
            <template v-if="item.applicant !== null">
              <p class="text-gray-900">
                {{ item.applicant.name !== '' ? item.applicant.name : item.applicant.mbId }}
                <span v-if="item.applicant.name !== ''" class="text-xs text-gray-400">
                  ({{ item.applicant.mbId }})
                </span>
              </p>
              <p class="text-xs text-gray-500">
                {{ item.applicant.phone !== '' ? item.applicant.phone : item.applicant.email }}
              </p>
            </template>
            <span v-else class="text-gray-400">{{ t('admin.quotes.table.guest') }}</span>
          </td>
          <td class="px-3 py-2">
            <p class="text-gray-700">{{ item.optionSummary }}</p>
            <p class="text-xs text-gray-400">
              {{ categoryLabel(item.category) }}
              · {{ t(`admin.quotes.orderCategory.${item.orderCategory}`) }}
            </p>
          </td>
          <td class="px-3 py-2 text-right tabular-nums">{{ item.qty }}</td>
          <td class="px-3 py-2 text-right font-medium tabular-nums">
            <span v-if="item.price !== null">{{ formatKrw(item.price) }}</span>
            <span v-else class="text-gray-400">{{ t('admin.quotes.table.noPrice') }}</span>
          </td>
          <td class="px-3 py-2">
            <div class="flex flex-wrap gap-1">
              <UiBadge
                :variant="item.quoteStatus"
                :label="t(`admin.quotes.badge.${item.quoteStatus}`)"
              />
              <UiBadge
                v-if="item.cartState !== 'none'"
                :variant="item.cartState"
                :label="t(`admin.quotes.badge.${item.cartState}`)"
              />
              <UiBadge
                v-if="item.status === 'deleted'"
                variant="deleted"
                :label="t('admin.quotes.badge.deleted')"
              />
            </div>
          </td>
          <td class="px-3 py-2 text-gray-500">{{ formatDate(item.createdAt) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
