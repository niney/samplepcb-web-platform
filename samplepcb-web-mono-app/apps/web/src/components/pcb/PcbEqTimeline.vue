<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  buildPcbEqTimeline,
  type PcbEqEventType,
  type PcbEqFileViewType,
} from '@sp/api-contract';
import { formatBytes } from '../../lib/format';

// EQ 진행을 **대화 한 줄기**로 보여 준다.
//
// EQ 왕복은 구조적으로 대화다: "이거 봐주세요(파일)" → "여기 고쳐주세요(사유+파일)" →
// "고쳤습니다(파일)". 그런데 화면은 그 대화를 네 곳(반려 배너·내 파일 칸·받은 첨부·이력)에
// 흩어 놓아 순서를 사람이 조립해야 했다. 시간축 하나로 합치면 "무엇을 봐야 하고 지금 무엇을
// 해야 하는지"가 마지막 칸에서 저절로 읽힌다.
//
// ⚠ 입력창은 두지 않는다 — 이 시스템에 자유 메시지가 없다(파일 업로드와 상태 전이뿐).
//   채팅처럼 보이는데 답을 못 쓰면 그게 더 나쁜 거짓말이다. 행동은 부모가 아래에 붙인다.
const props = defineProps<{
  history: readonly PcbEqEventType[];
  files: readonly PcbEqFileViewType[];
  /** 이 역할이 '내 말'(오른쪽)이 된다 — 협력사 포털이면 PARTNER, 관리자 화면이면 ADMIN. */
  meRole: string;
  /** 지금 첨부를 바꿀 수 있는가(EQ_LOCKED 판정은 부모가) — **내가 올린 것에만** ✕ 가 뜬다.
   *  받은 자료(관리자 회신)를 받는 쪽이 지우면 반려 근거가 사라진다. */
  editable?: boolean;
}>();
const emit = defineEmits<{
  download: [fileId: number, name: string];
  delete: [fileId: number];
}>();

const rounds = computed(() => buildPcbEqTimeline(props.history, props.files));
const lastIndex = computed(() => rounds.value.length - 1);
const showPast = ref(false);

// ⚠ 반려는 회차를 **닫는** 이벤트라 이전 회차에 들어간다. 마지막 회차만 펼치면 반려 직후엔
//   "아직 오간 것이 없습니다"만 남고 **되돌아온 이유가 접힌 채 사라진다**(e2e 로 걸렸다).
//   그래서 마지막이 비어 있으면 직전 회차까지 함께 펼친다 — 지금 봐야 할 것이 사유와 첨부다.
const openFrom = computed(() => {
  const last = rounds.value[lastIndex.value];
  return last !== undefined && last.items.length === 0 && lastIndex.value > 0
    ? lastIndex.value - 1
    : lastIndex.value;
});

const ROLE_LABEL: Record<string, string> = {
  ADMIN: '관리자',
  PARTNER: '협력사',
  MASTER_DEALER: '중개 조직',
};
const roleLabel = (r: string): string => ROLE_LABEL[r] ?? r;
const isMine = (r: string): boolean => r === props.meRole;

// 전이를 사람 말로 — 반려와 요청 취소는 **같은 전이**라 사유 유무로만 갈린다.
const eventLabel = (item: { fromStatus?: string; toStatus?: string; note?: string | null }): string => {
  const from = item.fromStatus ?? '';
  const to = item.toStatus ?? '';
  const hasNote = item.note !== null && item.note !== undefined && item.note !== '';
  if (from === 'issued' && to === 'eq_requested') return 'EQ 승인요청';
  if (from === 'eq_requested' && to === 'issued') return hasNote ? 'EQ 반려' : 'EQ 요청 취소';
  if (from === 'eq_requested' && to === 'eq_done') return 'EQ 승인';
  if (from === 'eq_done' && to === 'eq_requested') return '승인 취소';
  if (from === 'eq_done' && to === 'producing') return '생산 시작';
  if (from === 'producing' && to === 'eq_done') return '생산시작 취소';
  if (from === 'producing' && to === 'produced') return '생산 완료';
  if (from === 'produced' && to === 'producing') return '생산완료 취소';
  return `${from} → ${to}`;
};
const isReject = (item: { fromStatus?: string; toStatus?: string; note?: string | null }): boolean =>
  item.fromStatus === 'eq_requested' &&
  item.toStatus === 'issued' &&
  item.note !== null &&
  item.note !== undefined &&
  item.note !== '';

const FILE_LABEL: Record<string, string> = {
  eq: 'EQ 질의서',
  working: 'Working 데이터',
  reply: '수정 지시',
};
const when = (at: string): string => at.slice(0, 16).replace('T', ' ');
</script>

<template>
  <div class="space-y-3">
    <!-- 이전 회차는 접어 둔다 — 왕복이 서너 번이면 지금 할 일이 스크롤 밖으로 밀린다. -->
    <button
      v-if="openFrom > 0"
      type="button"
      class="rounded-md border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-500 hover:bg-gray-50"
      @click="showPast = !showPast"
    >
      {{ showPast ? '이전 회차 숨기기' : `▸ 이전 회차 ${openFrom}건 보기` }}
    </button>

    <template v-for="(round, ri) in rounds" :key="round.index">
      <section v-if="showPast || ri >= openFrom" class="space-y-2">
        <div v-if="rounds.length > 1" class="flex items-center gap-2">
          <span class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-bold text-gray-500">
            {{ round.index }}차 요청
          </span>
          <span class="h-px flex-1 bg-gray-100" />
        </div>

        <div
          v-for="(item, ii) in round.items"
          :key="`${String(round.index)}-${String(ii)}`"
          class="flex"
          :class="isMine(item.byRole) ? 'justify-end' : 'justify-start'"
        >
          <div class="max-w-[85%]">
            <p
              class="mb-0.5 text-[11px] text-gray-400"
              :class="isMine(item.byRole) ? 'text-right' : ''"
            >
              {{ roleLabel(item.byRole) }} · {{ when(item.at) }}
            </p>

            <!-- 전이 — 반려만 붉게(되돌아온 이유가 가장 먼저 읽혀야 한다) -->
            <div
              v-if="item.kind === 'event'"
              class="rounded-xl border px-3 py-2 text-sm"
              :class="
                isReject(item)
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : isMine(item.byRole)
                    ? 'border-blue-200 bg-blue-50 text-blue-900'
                    : 'border-gray-200 bg-gray-50 text-gray-700'
              "
            >
              <p class="font-semibold">{{ eventLabel(item) }}</p>
              <p
                v-if="item.note !== null && item.note !== undefined && item.note !== ''"
                class="mt-1 whitespace-pre-wrap"
              >
                {{ item.note }}
              </p>
            </div>

            <!-- 첨부 묶음 — 받은 것(수정 지시)은 파랗게 세워 "지금 볼 파일"이 눈에 걸리게 -->
            <div
              v-else
              class="rounded-xl border px-3 py-2"
              :class="
                (item.files ?? []).some((f) => f.fileType === 'reply')
                  ? 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 bg-surface'
              "
            >
              <ul class="space-y-1">
                <li
                  v-for="f in item.files ?? []"
                  :key="f.fileId"
                  class="flex items-center gap-2 text-xs"
                >
                  <span
                    class="shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold"
                    :class="f.fileType === 'reply' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'"
                  >
                    {{ FILE_LABEL[f.fileType] ?? f.fileType }}
                  </span>
                  <button
                    type="button"
                    class="truncate font-medium text-blue-700 hover:underline"
                    @click="emit('download', f.fileId, f.name)"
                  >
                    {{ f.name }}
                  </button>
                  <span class="shrink-0 text-gray-300">{{ formatBytes(f.size) }}</span>
                  <span
                    v-if="!f.isLatest"
                    class="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-700"
                    title="같은 종류로 더 나중 파일이 있습니다 — 이건 이전 것입니다."
                  >이전</span>
                  <button
                    v-if="editable === true && isMine(item.byRole)"
                    type="button"
                    class="shrink-0 text-gray-300 hover:text-red-600"
                    aria-label="파일 삭제"
                    @click="emit('delete', f.fileId)"
                  >
                    ✕
                  </button>
                </li>
              </ul>
            </div>
          </div>
        </div>

        <p v-if="round.items.length === 0" class="text-xs text-gray-400">
          아직 이 회차에 오간 것이 없습니다.
        </p>
      </section>
    </template>
  </div>
</template>
