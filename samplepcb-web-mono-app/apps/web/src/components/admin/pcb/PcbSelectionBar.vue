<script setup lang="ts">
// 선택 삭제 툴바 — **SmartBOM 진행현황(AdminSmartbomCases)과 같은 형태**로 맞춘다
// (사용자 지적 2026-08-06). 요지는 셋이다:
//   · 선택이 없어도 **항상 보인다** — "체크하면 삭제할 수 있다"를 먼저 알려주는 안내 줄이고,
//     버튼은 disabled 로 둔다(선택해야 나타나는 툴바는 기능의 존재 자체가 숨겨진다)
//   · 컨테이너는 중립색(gray-50), 위험색은 **버튼 하나에만** — 목록 위에 붉은 띠가 상주하지 않게
//   · 버튼은 outline danger 이고 라벨이 곧 대상 수다("선택 N건 영구 삭제")
// '선택 해제'는 두지 않는다 — 헤더 체크박스로 같은 일을 한다(BOM 동형).
defineProps<{ count: number }>();
defineEmits<{ delete: [] }>();
</script>

<template>
  <div
    class="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
  >
    <p class="text-xs text-gray-500">
      현재 페이지에서 견적을 체크해 함께 삭제할 수 있습니다.
      <b v-if="count > 0" class="ml-1 text-gray-800">{{ count }}건 선택</b>
    </p>
    <button
      type="button"
      class="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
      :disabled="count === 0"
      @click="$emit('delete')"
    >
      선택 {{ count }}건 영구 삭제
    </button>
  </div>
</template>
