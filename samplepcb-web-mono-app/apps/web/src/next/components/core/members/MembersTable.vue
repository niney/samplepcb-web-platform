<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { AdminMemberListItemType } from '@sp/api-contract';
import { Badge } from '@/next/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/next/components/ui/table';
import TableCard from '@/next/components/common/TableCard.vue';
import TableEmptyRow from '@/next/components/common/TableEmptyRow.vue';
import { memberStatusVariant, memberTypeLabelKey } from './member-badges';

// 회원 목록 표(옛 MembersTable 과 같은 props·emits) — 행을 누르면 상세 서랍을 연다.
const props = defineProps<{ items: AdminMemberListItemType[]; loading: boolean }>();
const emit = defineEmits<{ select: [mbId: string] }>();
const { t } = useI18n();

// joinedAt/lastLoginAt 은 서버가 이미 KST 로 포맷한 문자열("YYYY-MM-DD HH:mm")이라
// 재파싱하지 않고 그대로 쓴다(sp_* 의 ISO 와 달리 g5 native). 가입일은 날짜만 노출.
const dateOnly = (s: string): string => s.slice(0, 10);
</script>

<template>
  <TableCard>
    <!-- 다시 불러오는 동안(이전 쪽 유지) 표를 옅게 — 옛 화면과 같은 신호 -->
    <div class="transition-opacity" :class="props.loading && props.items.length > 0 ? 'opacity-60' : ''">
      <Table class="min-w-5xl">
        <TableHeader>
          <TableRow>
            <TableHead>{{ t('admin.members.table.id') }}</TableHead>
            <TableHead>{{ t('admin.members.table.member') }}</TableHead>
            <TableHead>{{ t('admin.members.table.contact') }}</TableHead>
            <TableHead>{{ t('admin.members.table.company') }}</TableHead>
            <TableHead class="text-right">{{ t('admin.members.table.projects') }}</TableHead>
            <TableHead>{{ t('admin.members.table.lastLogin') }}</TableHead>
            <TableHead>{{ t('admin.members.table.joinedAt') }}</TableHead>
            <TableHead>{{ t('admin.members.table.status') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="item in props.items"
            :key="item.mbId"
            class="cursor-pointer"
            @click="emit('select', item.mbId)"
          >
            <TableCell class="font-medium">{{ item.mbId }}</TableCell>
            <TableCell>
              <p>{{ item.name !== '' ? item.name : '-' }}</p>
              <p class="text-muted-foreground text-xs">{{ item.nick !== '' ? item.nick : '-' }}</p>
            </TableCell>
            <TableCell>
              <p>{{ item.email ?? '-' }}</p>
              <p class="text-muted-foreground text-xs tabular-nums">{{ item.phone ?? '-' }}</p>
            </TableCell>
            <TableCell>
              <span class="inline-flex items-center gap-1.5">
                <span>{{ item.companyName ?? '-' }}</span>
                <Badge v-if="memberTypeLabelKey(item.memberType) !== null" variant="info">
                  {{ t(memberTypeLabelKey(item.memberType) ?? '') }}
                </Badge>
              </span>
            </TableCell>
            <TableCell class="text-right tabular-nums" :class="item.projectCount > 0 ? '' : 'text-muted-foreground'">
              {{ item.projectCount }}
            </TableCell>
            <TableCell class="text-muted-foreground tabular-nums">{{ item.lastLoginAt ?? '-' }}</TableCell>
            <TableCell class="text-muted-foreground tabular-nums">{{ dateOnly(item.joinedAt) }}</TableCell>
            <TableCell>
              <Badge :variant="memberStatusVariant(item.status)">{{ t(`admin.members.badge.${item.status}`) }}</Badge>
            </TableCell>
          </TableRow>
          <TableEmptyRow
            v-if="props.items.length === 0"
            :colspan="8"
            :loading="props.loading"
            :text="t('admin.members.table.empty')"
          />
        </TableBody>
      </Table>
    </div>
  </TableCard>
</template>
